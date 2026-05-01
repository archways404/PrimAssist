// fetch.js
import { getBearerToken, invalidateTokenCache } from './token.js';

/**
 * Minimal helper so we can always call log.info(...) even if no logger was passed.
 */
function noopLogger() {
	return {
		error: () => {},
		info: () => {},
		verbose: () => {},
		trace: () => {},
	};
}

async function readTextSafe(res) {
	try {
		return await res.text();
	} catch {
		return '';
	}
}

function truncate(s, n = 400) {
	if (!s) return s;
	return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * Create an Error that carries an HTTP-ish statusCode (useful for retry logic).
 */
function graphHttpError(status, text, url) {
	const err = new Error(`Graph error ${status}: ${text}`);
	err.statusCode = status;
	err.url = url;
	return err;
}

/**
 * Core Graph request helper with "retry once on 401/403".
 *
 * IMPORTANT: We deliberately refresh token only on auth failures (401/403),
 * not on all non-2xx responses.
 */
async function graphRequestJson({ url, method = 'GET', body, log }) {
	log = log || noopLogger();

	async function doFetch(accessToken) {
		log.verbose('Graph', method, ':', url);

		const res = await fetch(url, {
			method,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: body ? JSON.stringify(body) : undefined,
		});

		const text = await readTextSafe(res);

		if (!res.ok) {
			log.error('Graph error:', res.status, truncate(text));
			throw graphHttpError(res.status, truncate(text, 2000), url);
		}

		// Some Graph endpoints can return empty bodies; guard just in case
		if (!text) return null;
		return JSON.parse(text);
	}

	// 1st try with current token (auto-refreshes if expired)
	const debugOpts = undefined; // not needed here unless your getBearerToken requires it
	let token = await getBearerToken({ log, debugOpts });

	try {
		return await doFetch(token);
	} catch (err) {
		const status = err?.statusCode;

		// Retry once on auth issues
		if (status === 401 || status === 403) {
			log.info(`Graph returned ${status}; refreshing token and retrying once…`);
			invalidateTokenCache();
			token = await getBearerToken({ log, debugOpts });
			return await doFetch(token);
		}

		throw err;
	}
}

// ---- Public API ----

export async function graphRequestUserID(accessToken, log = noopLogger()) {
	// Keep signature compatible, but ignore passed token and use our retrying wrapper
	const url = 'https://graph.microsoft.com/v1.0/me?$select=id';
	const resp = await graphRequestJson({ url, method: 'GET', log });
	log.info('Graph user id fetched.');
	log.trace('Graph /me response:', resp);
	return resp.id;
}

export async function graphRequestExternalUserID(accessToken, MAU_EMAIL, log = noopLogger()) {
	const url = `https://graph.microsoft.com/v1.0/users/${MAU_EMAIL}`;
	const resp = await graphRequestJson({ url, method: 'GET', log });
	log.info('Graph external user id fetched.');
	log.trace('Graph MAU_EMAIL - ID response:', resp?.id);
	return resp.id;
}

export async function graphRequestSchedule(accessToken, log = noopLogger()) {
	const url =
		'https://graph.microsoft.com/v1.0/teams/85cbf237-9110-4755-9bc4-d7e16fdbb68a/schedule/shifts';
	const data = await graphRequestJson({ url, method: 'GET', log });
	log.info('Graph schedule fetched.');
	log.trace('Graph schedule response:', data);
	return data;
}
