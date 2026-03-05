
export default async function statisticsGet(app) {
  // GET /statistics?month=2026-03
  app.get("/", async (req) => {
    const month =
      (req.query?.month && String(req.query.month)) ||
      new Date().toISOString().slice(0, 7);

    return {
      ok: true,
      month,
      rows: app.stats.getMonth(month),
      totalsByMonth: app.stats.totalsByMonth(),
    };
  });
}
