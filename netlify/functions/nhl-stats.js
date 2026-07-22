/* NHL Stats API proxy for the preview's Namesake Watch module.
 * Same-origin so the browser needs no CORS; response cached at the edge.
 * Returns the standings rows for the eight CGHL namesake franchises —
 * live standings when the NHL season is running, the final table of the
 * most recent season otherwise. No API key required (public NHL API).
 */
const CODES = ["BOS", "CHI", "PIT", "TOR", "ANA", "COL", "DAL", "WPG"];

const ab = (r) => (r.teamAbbrev && (r.teamAbbrev.default || r.teamAbbrev)) || "";

async function grab(url) {
  const res = await fetch(url, { headers: { "user-agent": "chelgamingleague.com namesake-watch" } });
  if (!res.ok) throw new Error("NHL API " + res.status);
  const j = await res.json();
  return Array.isArray(j.standings) ? j.standings : [];
}

exports.handler = async () => {
  try {
    let rows = await grab("https://api-web.nhle.com/v1/standings/now");
    if (!rows.length) rows = await grab("https://api-web.nhle.com/v1/standings/2026-04-18");
    const teams = rows.filter((r) => CODES.includes(ab(r))).map((r) => ({
      code: ab(r),
      gp: r.gamesPlayed ?? 0,
      w: r.wins ?? 0,
      l: r.losses ?? 0,
      otl: r.otLosses ?? 0,
      pts: r.points ?? 0,
      gf: r.goalFor ?? null,
      ga: r.goalAgainst ?? null,
      l10: (r.l10Wins != null) ? r.l10Wins + "-" + r.l10Losses + "-" + r.l10OtLosses : null,
      season: r.seasonId ?? null,
    }));
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300, s-maxage=900",
      },
      body: JSON.stringify({ teams, fetched: new Date().toISOString() }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: String((e && e.message) || e) }),
    };
  }
};
