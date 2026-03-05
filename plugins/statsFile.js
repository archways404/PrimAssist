import fp from "fastify-plugin";
import path from "node:path";
import fs from "node:fs/promises";

function monthKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function readJson(file) {
  try {
    const buf = await fs.readFile(file, "utf8");
    return JSON.parse(buf);
  } catch (e) {
    if (e?.code === "ENOENT") return { api_usage: {} };
    throw e;
  }
}

async function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export default fp(async function statsFile(app) {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  const filePath = process.env.STATS_FILE_PATH || path.join(dataDir, "stats.json");

  // In-memory cache + debounced flush
  let state = await readJson(filePath);
  let flushTimer = null;
  let dirty = false;

  function scheduleFlush() {
    dirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      if (!dirty) return;
      dirty = false;
      await writeJsonAtomic(filePath, state);
    }, 1000);
  }

  function key(month, route, method) {
    return `${month}::${method}::${route}`;
  }

  app.decorate("stats", {
    inc({ route, method }) {
      const month = monthKey();
      state.api_usage ||= {};
      const k = key(month, route, method);

      const row =
        state.api_usage[k] ||
        (state.api_usage[k] = {
          month,
          route,
          method,
          count: 0,
          last_seen: null,
        });

      row.count += 1;
      row.last_seen = new Date().toISOString();
      scheduleFlush();
    },

    getMonth(month) {
      const rows = Object.values(state.api_usage || {}).filter((r) => r.month === month);
      rows.sort((a, b) => b.count - a.count);
      return rows;
    },

    totalsByMonth() {
      const totalsMap = new Map();
      for (const r of Object.values(state.api_usage || {})) {
        totalsMap.set(r.month, (totalsMap.get(r.month) || 0) + r.count);
      }
      return Array.from(totalsMap.entries())
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([month, total]) => ({ month, total }));
    },
  });

  app.addHook("onClose", async () => {
    // flush immediately on shutdown
    if (flushTimer) clearTimeout(flushTimer);
    await writeJsonAtomic(filePath, state);
  });
});