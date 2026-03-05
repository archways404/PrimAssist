import fp from "fastify-plugin";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

function monthKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function registerSqlite(app) {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = process.env.STATS_DB_PATH || path.join(dataDir, "stats.sqlite");
  const db = new Database(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS api_usage (
      month TEXT NOT NULL,
      route TEXT NOT NULL,
      method TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (month, route, method)
    );

    CREATE INDEX IF NOT EXISTS idx_api_usage_month ON api_usage(month);
  `);

  const upsert = db.prepare(`
    INSERT INTO api_usage (month, route, method, count, last_seen)
    VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(month, route, method)
    DO UPDATE SET count = count + 1, last_seen = datetime('now');
  `);

  const byMonth = db.prepare(`
    SELECT route, method, count, last_seen
    FROM api_usage
    WHERE month = ?
    ORDER BY count DESC;
  `);

  const totals = db.prepare(`
    SELECT month, SUM(count) AS total
    FROM api_usage
    GROUP BY month
    ORDER BY month DESC;
  `);

  app.decorate("stats", {
    inc({ route, method }) {
      upsert.run(monthKey(), route, method);
    },
    getMonth(month) {
      return byMonth.all(month);
    },
    totalsByMonth() {
      return totals.all();
    },
  });

  app.addHook("onClose", async () => db.close());
}

export default fp(registerSqlite);