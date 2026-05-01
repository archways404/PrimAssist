import dotenv from 'dotenv';
import Fastify from 'fastify';
import registerEndpoints from './endpoints/index.js';
import { parseDebugOptions } from './functions/helpers.js';
import { createLogger } from './functions/log.js';
import { getBearerToken } from './functions/token.js';
import registerCors from './plugins/cors.js';
import registerStatsFile from './plugins/statsFile.js';

async function main() {
	dotenv.config();
	const mau_id = process.env.MAU_ID;
	const pwd = process.env.MAU_PWD;
	const mfa_secret = process.env.MFA_SECRET;

	if (!mau_id || !pwd) throw new Error('Missing MAU_ID or MAU_PWD in .env');

	const debugOpts = parseDebugOptions();

	// CREATE LOGGER
	const log = createLogger(debugOpts);

	log.info('Debug options:', debugOpts);

	const app = Fastify({
		logger: false,
	});

	await app.register(registerCors);
	await app.register(registerStatsFile);
	log.info('stats exists:', Boolean(app.stats));

	// Attach shared objects so routes can use them
	app.decorate('logx', log);
	app.decorate('debugOpts', debugOpts);

	const port = Number(process.env.PORT ?? 3000);
	const host = process.env.HOST ?? '127.0.0.1';

	app.decorate('isReady', false);

	await app.register(registerEndpoints);

	// readiness gate
	app.addHook('onRequest', async (req, reply) => {
		if (req.url.startsWith('/health')) return;
		if (req.method === 'OPTIONS') return;

		if (!app.isReady) {
			return reply.code(503).send({
				ok: false,
				ready: false,
				reason: 'starting_up',
			});
		}
	});

	// count usage (after route is known)
	app.addHook('onResponse', async (req, reply) => {
		if (req.url.startsWith('/health')) return;
		if (req.method === 'OPTIONS') return;

		const route = (req.routeOptions && req.routeOptions.url) || req.url.split('?')[0];

		app.stats.inc({ route, method: req.method });
	});

	await app.listen({ port, host });
	log.info(`Fastify listening on http://${host}:${port}`);

	// Prime token AFTER listen (async)
	(async () => {
		try {
			await getBearerToken({ log, debugOpts });
			log.info('Bearer token primed.');
			app.isReady = true;
		} catch (e) {
			log.error('Token prime failed at boot:', e?.message ?? e);
			// keep isReady=false -> endpoints will return 503 (except /health)
		}
	})();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
