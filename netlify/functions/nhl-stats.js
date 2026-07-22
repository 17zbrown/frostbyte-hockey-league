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

exports.handler = async (event) => {
  try {
    const q = (event && event.queryStringParameters) || {};
    /* ?club=COL&season=20252026 → the club's completed games as a trend series */
    if (q.club && CODES.includes(q.club)) {
      const season = /^\d{8}$/.test(q.season || "") ? q.season : "20252026";
      const res = await fetch("https://api-web.nhle.com/v1/club-schedule-season/" + q.club + "/" + season,
        { headers: { "user-agent": "chelgamingleague.com namesake-watch" } });
      if (!res.ok) throw new Error("NHL API " + res.status);
      const j = await res.json();
      let pts = 0;
      const games = (j.games || [])
        .filter((g) => g.gameState === "OFF" || g.gameState === "FINAL")
        .filter((g) => g.gameType === 2)
        .map((g) => {
          const home = g.homeTeam.abbrev === q.club;
          const us = home ? g.homeTeam : g.awayTeam;
          const them = home ? g.awayTeam : g.homeTeam;
          const win = (us.score ?? 0) > (them.score ?? 0);
          const extra = g.gameOutcome && g.gameOutcome.lastPeriodType !== "REG";
          const p = win ? 2 : (extra ? 1 : 0);
          pts += p;
          return { d: g.gameDate, opp: them.abbrev, gf: us.score ?? 0, ga: them.score ?? 0,
            r: win ? "W" : (extra ? "OTL" : "L"), pts };
        });
      return {
        statusCode: 200,
        headers: { "content-type": "application/json", "cache-control": "public, max-age=900, s-maxage=3600" },
        body: JSON.stringify({ club: q.club, season, games }),
      };
    }
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
