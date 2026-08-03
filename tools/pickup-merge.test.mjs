// Merging a lagged-out pickup game's sessions into one box score.
// Run: node tools/pickup-merge.test.mjs
//
// The two failure modes that matter: summing one club's stats into the other because EA flipped
// club order between sessions, and a merged game's segment being importable again on its own.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
delete process.env.HTTPS_PROXY;   // force the global-fetch path so the stub intercepts EA calls

const { _internals: P, handler } = await import(new URL("../netlify/functions/pickup-import.js", import.meta.url).pathname);

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* normalized-session fixture builder */
const player = (id, over = {}) => ({ ea_player_id: id, gamertag: "gt" + id, position: "C",
  goals: 0, assists: 0, shots: 0, hits: 0, pim: 0, plus_minus: 0, takeaways: 0, giveaways: 0,
  faceoffs_won: 0, faceoffs_lost: 0, time_on_ice_seconds: 0, is_goalie: false,
  saves: 0, shots_against: 0, goals_against: 0, shutout: false, ...over });
const session = (matchId, at, clubs, wentOt = false) => ({ ea_match_id: matchId, played_at: at, went_ot: wentOt, clubs });

console.log("— sides align by club id, never by array order");
{
  const s1 = session("m1", "2026-08-03T01:00:00Z", [
    { ea_club_id: "111", name: "Alpha", score: 2, result: 1, players: [player("a1", { goals: 2, shots: 5, time_on_ice_seconds: 700 }), player("g1", { is_goalie: true, saves: 4, shots_against: 5, goals_against: 1 })] },
    { ea_club_id: "222", name: "Bravo", score: 1, result: 2, players: [player("b1", { goals: 1, shots: 3, time_on_ice_seconds: 700 })] },
  ]);
  /* the resume comes back with the clubs REVERSED — exactly what must not corrupt the merge */
  const s2 = session("m2", "2026-08-03T01:25:00Z", [
    { ea_club_id: "222", name: "Bravo", score: 2, result: 1, players: [player("b1", { goals: 2, shots: 4, time_on_ice_seconds: 900 })] },
    { ea_club_id: "111", name: "Alpha", score: 0, result: 2, players: [player("a1", { assists: 1, shots: 2, time_on_ice_seconds: 900 }), player("g1", { is_goalie: true, saves: 6, shots_against: 8, goals_against: 2 })] },
  ], true);

  const m = P.mergeMatches([s1, s2]);
  const alpha = m.clubs.find((c) => c.ea_club_id === "111");
  const bravo = m.clubs.find((c) => c.ea_club_id === "222");
  A("Alpha's aggregate score is 2+0", alpha.score === 2, alpha.score);
  A("Bravo's aggregate score is 1+2", bravo.score === 3, bravo.score);
  const a1 = alpha.players.find((p) => p.ea_player_id === "a1");
  A("a1's goals stayed on Alpha despite the flip", a1.goals === 2 && a1.assists === 1 && a1.shots === 7);
  A("time on ice sums", a1.time_on_ice_seconds === 1600);
  const b1 = bravo.players.find((p) => p.ea_player_id === "b1");
  A("b1 sums on Bravo", b1.goals === 3 && b1.shots === 7);
  A("overtime comes from the deciding session", m.went_ot === true);
  A("the game keeps the FIRST session's time and id", m.ea_match_id === "m1" && m.played_at === "2026-08-03T01:00:00Z");
  A("every session id is recorded", m.ea_match_ids.join(",") === "m1,m2");
}

console.log("\n— merge rules");
{
  const g = (ga) => [
    { ea_club_id: "111", name: "A", score: 0, result: 1, players: [player("g1", { is_goalie: true, saves: 5, shots_against: 5 + ga, goals_against: ga })] },
    { ea_club_id: "222", name: "B", score: ga, result: 2, players: [player("b1", {})] },
  ];
  const clean = P.mergeMatches([session("m1", "t1", g(0)), session("m2", "t2", g(0))]);
  A("a clean sheet across both sessions is a shutout", clean.clubs[0].players[0].shutout === true);
  const dirty = P.mergeMatches([session("m1", "t1", g(0)), session("m2", "t2", g(1))]);
  A("a goal in EITHER session kills the shutout", dirty.clubs[0].players[0].shutout === false);

  const s1 = session("m1", "t1", [
    { ea_club_id: "111", name: "A", score: 1, result: 1, players: [player("a1", { goals: 1 }), player("a2", { hits: 3 })] },
    { ea_club_id: "222", name: "B", score: 0, result: 2, players: [player("b1")] },
  ]);
  const s2 = session("m2", "t2", [
    { ea_club_id: "111", name: "A", score: 1, result: 1, players: [player("a1", { goals: 1 })] },   // a2 missed the resume
    { ea_club_id: "222", name: "B", score: 0, result: 2, players: [player("b1")] },
  ]);
  const m = P.mergeMatches([s1, s2]);
  const a2 = m.clubs[0].players.find((p) => p.ea_player_id === "a2");
  A("a player who missed the resume keeps their line", a2 && a2.hits === 3);
  A("no duplicate player rows", m.clubs[0].players.length === 2);

  let threw = false;
  try { P.mergeMatches([s1, session("m3", "t3", [
    { ea_club_id: "111", name: "A", score: 0, result: 1, players: [] },
    { ea_club_id: "999", name: "Stranger", score: 0, result: 2, players: [] },
  ])]); } catch (e) { threw = true; }
  A("sessions between different club pairs refuse to merge", threw);
}

console.log("\n— the handler: merged import persists, and segments can't re-enter");
{
  const writes = { games: [], stats: [] };
  let dupHit = false;
  const rawMatch = (id, ts) => ({ matchId: id, timestamp: ts,
    clubs: { "111": { details: { name: "Alpha" }, score: "1", result: "1" },
             "222": { details: { name: "Bravo" }, score: "0", result: "2" } },
    players: { "111": { p1: { playername: "P1", position: "center", skgoals: "1", toiseconds: "800" } },
               "222": { p2: { playername: "P2", position: "goalie", glsaves: "3", glshots: "4", glga: "1", toiseconds: "800" } } } });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || "GET";
    const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
    if (u.includes("/auth/v1/user")) return J({ id: "uid1" });
    if (u.includes("proclubs.ea.com")) return J([rawMatch("m1", 1700000000), rawMatch("m2", 1700002000)]);
    if (u.includes("/rest/v1/pickup_games") && m === "GET") { dupHit = u.includes("ea_match_ids.ov"); return J([]); }
    if (u.includes("/rest/v1/pickup_games") && m === "POST") { writes.games.push(JSON.parse(opts.body)); return J([{ id: "game1" }]); }
    if (u.includes("/rest/v1/pickup_stats") && m === "POST") { writes.stats.push(...JSON.parse(opts.body)); return J([]); }
    return J([]);   // profiles lookups, lobbies, etc.
  };
  const res = await handler({ httpMethod: "POST", headers: { authorization: "Bearer tok" },
    body: JSON.stringify({ action: "import", clubId: "111", matchIds: ["m1", "m2"] }) });
  const out = JSON.parse(res.body);
  A("the merged import succeeds", out.ok === true && out.sessions === 2, res.body.slice(0, 120));
  A("one game row, both session ids on it", writes.games.length === 1 && (writes.games[0].ea_match_ids || []).join(",") === "m1,m2");
  A("stats are the SUM of both sessions", writes.stats.find((r) => r.skater_name === "P1").goals === 2);
  A("goalie totals sum too", writes.stats.find((r) => r.skater_name === "P2").saves === 6);
  A("the duplicate check consults the session-id array", dupHit);

  const dupRes = await (async () => {
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url), m = opts.method || "GET";
      const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
      if (u.includes("/auth/v1/user")) return J({ id: "uid1" });
      if (u.includes("/rest/v1/pickup_games") && m === "GET") return J([{ id: "existing" }]);   // a segment already lives in a merged game
      return J([]);
    };
    return handler({ httpMethod: "POST", headers: { authorization: "Bearer tok" },
      body: JSON.stringify({ action: "import", clubId: "111", matchId: "m2" }) });
  })();
  A("a segment of a merged game refuses to import alone", dupRes.statusCode === 409);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
