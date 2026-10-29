// Merging a lagged-out pickup game's sessions into one box score.
// Run: node tools/pickup-merge.test.mjs
//
// The two failure modes that matter: summing one club's stats into the other because EA flipped
// club order between sessions, and a merged game's segment being importable again on its own.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
delete process.env.HTTPS_PROXY;   // force the global-fetch path so the stub intercepts EA calls

const { _internals: P, handler } = await import(new URL("../netlify/functions/pickup-import.js", import.meta.url).pathname);
const { createLookupsFake } = await import(new URL("./ea-lookups-fake.mjs", import.meta.url).pathname);

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
  /* v4.34: the list the staffer picked from is the one the bot stored when they listed the club's games */
  const LOOKUPS = createLookupsFake();
  LOOKUPS.seed("matches", "111", [rawMatch("m1", 1700000000), rawMatch("m2", 1700002000)], 5 * 60 * 1000);
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || "GET";
    const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
    if (u.includes("/auth/v1/user")) return J({ id: "uid1" });
    if (u.includes("proclubs.ea.com")) throw new Error("Netlify must never call EA itself (v4.34): " + u);
    if (u.includes("/rest/v1/ea_lookups")) return LOOKUPS.handle(u, opts);
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
  A("the import read the stored match list (five minutes old) without asking EA again", LOOKUPS.posts.length === 0);

  /* a picked session missing from the stored list: ask EA once more, then read exactly that answer */
  writes.games = []; writes.stats = [];
  const call = (extra) => handler({ httpMethod: "POST", headers: { authorization: "Bearer tok" },
    body: JSON.stringify({ action: "import", clubId: "111", matchIds: ["m1", "m3"], ...extra }) });
  const w = JSON.parse((await call()).body);
  A("a session missing from the stored list files one fresh request for the bot", typeof w.eaPending === "number" && LOOKUPS.posts.length === 1 && LOOKUPS.posts[0].requested_by === "uid1");
  LOOKUPS.answerAll(() => [rawMatch("m1", 1700000000), rawMatch("m3", 1700004000)]);
  const done = JSON.parse((await call({ eaLookup: w.eaPending })).body);
  A("...and the import completes from the bot's answer", done.ok === true && writes.games.length === 1 && (writes.games[0].ea_match_ids || []).join(",") === "m1,m3", JSON.stringify(done).slice(0, 160));
  const still = JSON.parse((await call({ matchIds: ["m1", "m9"], eaLookup: w.eaPending })).body);
  A("a session EA no longer lists after that fresh answer is a plain refusal, not another request", /no longer in the club's recent history/.test(still.error || "") && LOOKUPS.posts.length === 1, JSON.stringify(still).slice(0, 160));

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

/* v4.36: a league sitting is never imported as a pickup game; the guard runs before EA is asked for anything */
console.log("\n# v4.36: a league sitting is never a pickup game");
{
  const rawMatch = (id, ts) => ({ matchId: id, timestamp: ts,
    clubs: { "111": { details: { name: "Alpha" }, score: "1", result: "1" }, "222": { details: { name: "Bravo" }, score: "0", result: "2" } },
    players: { "111": { p1: { playername: "P1", position: "center", skgoals: "1", toiseconds: "800" } },
               "222": { p2: { playername: "P2", position: "goalie", glsaves: "3", glshots: "4", glga: "1", toiseconds: "800" } } } });
  let FILED = [], LOGROWS = [];
  const writes = { games: [], stats: [] };
  let LOOKUPS;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || "GET";
    const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
    if (u.includes("/auth/v1/user")) return J({ id: "uid1" });
    if (u.includes("proclubs.ea.com")) throw new Error("Netlify must never call EA itself (v4.34): " + u);
    if (u.includes("/rest/v1/ea_lookups")) return LOOKUPS.handle(u, opts);
    if (u.includes("/rest/v1/games?ea_match_id=in.") && m === "GET") return J(FILED);
    if (u.includes("/rest/v1/ea_ingest_log") && m === "GET") return J(LOGROWS);
    if (u.includes("/rest/v1/pickup_games") && m === "POST") { writes.games.push(JSON.parse(opts.body)); return J([{ id: "game9" }]); }
    if (u.includes("/rest/v1/pickup_stats") && m === "POST") { writes.stats.push(...JSON.parse(opts.body)); return J([]); }
    return J([]);
  };
  const imp = async () => { const r = await handler({ httpMethod: "POST", headers: { authorization: "Bearer tok" },
    body: JSON.stringify({ action: "import", clubId: "111", matchId: "m1" }) }); return { code: r.statusCode, o: JSON.parse(r.body) }; };
  const FILED_TXT = "That session is a filed league game. League games are kept by the statistics desk, never as pickup games.";
  const MAYBE_TXT = "The statistics desk has that session on its list as a possible league game. Ask them before importing it.";
  for (const [label, filed, log, txt, gid] of [
    ["the filed sitting of a game", [{ id: "gL" }], [], FILED_TXT, "gL"],
    ["a merged sitting", [], [{ ea_match_id: "m1", status: "merged", game_id: "gL" }], FILED_TXT, "gL"],
    ["a struck sitting", [], [{ ea_match_id: "m1", status: "struck", game_id: "gL" }], FILED_TXT, "gL"],
    ["an incomplete (held) sitting", [], [{ ea_match_id: "m1", status: "incomplete", game_id: "gL" }], FILED_TXT, "gL"],
    ["an unmatched sitting (a possible league game)", [], [{ ea_match_id: "m1", status: "unmatched", game_id: null }], MAYBE_TXT, null]]) {
    FILED = filed; LOGROWS = log; writes.games = []; writes.stats = [];
    LOOKUPS = createLookupsFake();
    const { code, o } = await imp();
    A(`${label} is refused (409)`, code === 409 && o.error === txt && o.leagueGameId === gid, JSON.stringify(o));
    A("...with no pickup write and no EA request", !writes.games.length && !writes.stats.length && LOOKUPS.posts.length === 0 && LOOKUPS.rows.length === 0);
  }
  for (const [label, log] of [["an `ignored` sitting", [{ ea_match_id: "m1", status: "ignored", game_id: null }]], ["a sitting the archive never saw", []]]) {
    FILED = []; LOGROWS = log; writes.games = []; writes.stats = [];
    LOOKUPS = createLookupsFake(); LOOKUPS.seed("matches", "111", [rawMatch("m1", 1700000000)], 60000);
    const { o } = await imp();
    A(`${label} imports`, o.ok === true && writes.games.length === 1, JSON.stringify(o).slice(0, 160));
    A("...and the reply names both clubs", o.clubA === "Alpha" && o.clubB === "Bravo", JSON.stringify({ a: o.clubA, b: o.clubB }));
  }
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
