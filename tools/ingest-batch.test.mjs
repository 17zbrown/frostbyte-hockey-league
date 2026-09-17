// The importer's batch path (netlify/functions/ingest-stats.js, the poller's POST): what it
// writes, in what order, and how little it asks. Run: node tools/ingest-batch.test.mjs
//
// What must never break: the EA payload is archived BEFORE any game row is touched (a killed
// invocation can leave a half-filed game, never a filed game whose payload is gone when EA's
// short history rolls over); a match already filed costs the batch nothing further; a box score
// another writer filed a moment earlier is left standing rather than clobbered or failed; and a
// roster resolves to profiles with one query per lookup step, not one per player.
// The real importer runs here against a stubbed Supabase; nothing touches the network.
process.env.SUPABASE_URL = "https://sb.invalid"; process.env.SUPABASE_SERVICE_ROLE_KEY = "svc"; process.env.INGEST_KEY = "ingest";
const { handler, _internals: I } = await import("../netlify/functions/ingest-stats.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const ms = (s) => Date.parse(s);
const MIN = 60_000;

/* ---- the stubbed world ---- */
const TEAMS = [{ id: "tA", ea_club_id: 111 }, { id: "tB", ea_club_id: 222 }];
const PUCK = "2026-10-21T21:00:00-04:00";
const G900 = { id: "g900", season_id: "s1", home_team_id: "tA", away_team_id: "tB", scheduled_at: PUCK };
const fx = (over) => ({ ...G900, ea_match_id: null, ...over });   // a fresh copy: the stub marks a fixture claimed when it is filed
const at = (minsAfter) => new Date(ms(PUCK) + minsAfter * MIN).toISOString();
const world = {
  open: [],          // open fixtures
  finals: [],        // final fixtures (each {…, ea_match_id})
  filed: {},         // ea_match_id -> game id, what games.ea_match_id already says
  archived: {},      // ea_match_id -> {status, game_id}, archive rows WITH a payload
  logs: [],          // ea_ingest_log rows for the resume check (payloads)
  prior: {},         // ea_player_id -> profile_id, prior links in game_stats
  profiles: [],      // [{id, gamertag}]
  statPostStatus: 204,
};
const calls = [];                 // every fetch, in order: {m, u, body}
const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
const NIL = () => new Response(null, { status: 204 });
const pairOf = (u) => { const m = u.match(/home_team_id\.eq\.([^,)]+),away_team_id\.eq\.([^,)]+)/); return m ? [m[1], m[2]] : null; };
const inList = (u) => decodeURIComponent(u.match(/in\.\(([^)]+)\)/)[1]).split(",");
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  calls.push({ m, u, body: opts.body ? JSON.parse(opts.body) : null, prefer: (opts.headers || {}).Prefer || null });
  if (u.includes("proclubs.ea.com")) throw new Error("the importer must never call EA in this test");
  if (u.includes("/rest/v1/games?ea_match_id=in.")) return J(inList(u).filter((id) => world.filed[id]).map((id) => ({ id: world.filed[id], ea_match_id: id })));
  if (u.includes("/rest/v1/ea_ingest_log?ea_match_id=in.") && u.includes("payload=not.is.null"))
    return J(inList(u).filter((id) => world.archived[id]).map((id) => ({ ea_match_id: id, ...world.archived[id] })));
  const pairRows = (rows) => { const p = pairOf(u); return rows.filter((g) => p && ((g.home_team_id === p[0] && g.away_team_id === p[1]) || (g.home_team_id === p[1] && g.away_team_id === p[0]))); };
  if (u.includes("/rest/v1/games?") && u.includes("status=eq.final")) return J(pairRows(world.finals).map((g) => ({ ...g, status: "final" })));
  if (u.includes("/rest/v1/games?") && u.includes("scheduled_at=gte.")) {
    const open = pairRows(world.open).map((g) => ({ status: "scheduled", ea_match_id: null, voided: false, forfeit_team_id: null, ...g }));
    const fin = pairRows(world.finals).map((g) => ({ status: "final", voided: false, forfeit_team_id: null, ...g }));
    return J(open.concat(fin));
  }
  if (u.includes("/rest/v1/games?id=eq.") && m === "PATCH") {
    /* a filed fixture leaves the open set, as games.ea_match_id does in the real schedule */
    const id = u.match(/id=eq\.([^&]+)/)[1], b = JSON.parse(opts.body);
    for (const g of world.open) if (g.id === id && b.ea_match_id) g.ea_match_id = b.ea_match_id;
    return NIL();
  }
  if (u.includes("/rest/v1/teams?ea_club_id=in.")) { const ids = inList(u); return J(TEAMS.filter((t) => ids.includes(String(t.ea_club_id)))); }
  if (u.includes("/rest/v1/teams?id=in.")) { const ids = inList(u); return J(TEAMS.filter((t) => ids.includes(t.id)).map((t) => ({ ...t, name: t.id, code: t.id }))); }
  if (u.includes("/rest/v1/ea_ingest_log?or=")) return J(world.logs);
  if (u.includes("/rest/v1/ea_ingest_log") && m === "POST") return NIL();
  if (u.includes("/rest/v1/game_stats?ea_player_id=in.")) return J(inList(u).filter((id) => world.prior[id]).map((id) => ({ ea_player_id: id, profile_id: world.prior[id] })));
  if (u.includes("/rest/v1/game_stats") && m === "DELETE") return NIL();
  if (u.includes("/rest/v1/game_stats") && m === "POST") {
    if (world.statPostStatus === 409) return J({ code: "23505", message: "duplicate key value violates unique constraint \"game_stats_one_row_per_player\"" }, 409);
    return NIL();
  }
  if (u.includes("/rest/v1/profiles?or=(")) {
    /* the roster-wide ILIKE list: gamertag.ilike.<escaped name>, exact, case-insensitive */
    const pats = decodeURIComponent(u.match(/or=\(([^)]*)\)/)[1]).split(",").map((s) => s.replace(/^gamertag\.ilike\./, "").replace(/\\([\\%_])/g, "$1").toLowerCase());
    return J(world.profiles.filter((p) => pats.includes(String(p.gamertag).toLowerCase())));
  }
  if (u.includes("/rest/v1/profiles?")) return J([]);
  if (u.includes("/rest/v1/season_registrations?")) return J([]);
  if (u.includes("/rest/v1/notifications") && (m === "DELETE" || m === "POST")) return NIL();
  if (u.includes("/rest/v1/app_config")) return J([]);
  throw new Error("unexpected fetch " + m + " " + u);
};
const reset = () => {
  calls.length = 0;
  world.open = []; world.finals = []; world.filed = {}; world.archived = {}; world.logs = []; world.prior = {}; world.profiles = []; world.statPostStatus = 204;
};
/* an EA match between two clubs that ENDED at `end` and ran `toi` seconds of game clock, with the
   given rosters ({eaPlayerId: name}) on each side */
const ea = (id, end, home, away, toi = 3600, scores = [3, 2], rosterH = { p1: "HomeGuy" }, rosterA = { p2: "AwayGuy" }) => ({
  matchId: id, timestamp: Math.floor(ms(end) / 1000),
  clubs: { [home]: { score: scores[0], details: { name: "H" } }, [away]: { score: scores[1], details: { name: "A" } } },
  players: {
    [home]: Object.fromEntries(Object.entries(rosterH).map(([pid, nm]) => [pid, { playername: nm, position: "center", skgoals: "1", toiseconds: String(toi) }])),
    [away]: Object.fromEntries(Object.entries(rosterA).map(([pid, nm]) => [pid, { playername: nm, position: "goalie", glsaves: "5", glshots: "8", glga: "3", toiseconds: String(toi) }])),
  },
});
const post = async (matches) => JSON.parse((await handler({ httpMethod: "POST", headers: { "x-ingest-key": "ingest" }, body: JSON.stringify({ matches }) })).body);
const of = (pred) => calls.filter((c) => pred(c));
const isLogPost = (c) => c.m === "POST" && c.u.includes("/rest/v1/ea_ingest_log");
const isStatDel = (c) => c.m === "DELETE" && c.u.includes("/rest/v1/game_stats");
const isStatPost = (c) => c.m === "POST" && c.u.includes("/rest/v1/game_stats");
const isGamePatch = (c) => c.m === "PATCH" && c.u.includes("/rest/v1/games?id=eq.");
const idx = (pred) => calls.findIndex(pred);

console.log("— a fresh filing: the payload is archived BEFORE the box score and the game row are written");
{
  reset(); world.open = [fx()];
  const s = await post([ea("m1", at(38), 111, 222)]);
  A("filed", s.ingested.length === 1 && s.ingested[0].game_id === "g900", JSON.stringify(s));
  const stage = of(isLogPost)[0];
  A("the first archive write carries the payload, as `unmatched` (true until the game row is stamped) with a reason that names the game",
    stage && stage.body[0].payload && stage.body[0].payload.matchId === "m1" && stage.body[0].status === "unmatched" && /ahead of filing on game g900/.test(stage.body[0].reason), stage && JSON.stringify(stage.body[0]).slice(0, 200));
  A("...as an upsert on the match id", stage && /on_conflict=ea_match_id/.test(stage.u) && /merge-duplicates/.test(stage.prefer));
  A("...and it lands before game_stats is deleted, before it is posted, and before the game is patched",
    idx(isLogPost) < idx(isStatDel) && idx(isStatDel) < idx(isStatPost) && idx(isStatPost) < idx(isGamePatch),
    calls.filter((c) => isLogPost(c) || isStatDel(c) || isStatPost(c) || isGamePatch(c)).map((c) => `${c.m} ${c.u.replace(/^.*\/rest\/v1\//, "").split("?")[0]}`).join(" → "));
  const final = of(isLogPost).slice(-1)[0];
  A("the archive row is then finished as `ingested` with the game id — a status touch, no second upload of the body",
    final !== stage && final.body[0].status === "ingested" && final.body[0].game_id === "g900" && !("payload" in final.body[0]), JSON.stringify(final.body[0]));
  A("the game row is patched exactly once, to final", of(isGamePatch).length === 1 && of(isGamePatch)[0].body.status === "final" && of(isGamePatch)[0].body.ea_match_id === "m1");
  A("no per-match dedupe lookups: the batch prefetch is the only games?ea_match_id query, and the only archive lookup",
    of((c) => c.m === "GET" && c.u.includes("games?ea_match_id=")).length === 1 && of((c) => c.m === "GET" && c.u.includes("ea_ingest_log?ea_match_id=")).length === 1
      && !calls.some((c) => c.u.includes("ea_match_id=eq.")));
}

console.log("\n— a Rule 4.3 resume: the replay's payload is archived before the merged box score is written");
{
  reset();
  const first = ea("r1", at(20), 111, 222, 1500, [1, 0]);
  world.finals = [{ ...G900, ea_match_id: "r1" }];
  world.filed = { r1: "g900" }; world.archived = { r1: { status: "ingested", game_id: "g900" } };
  world.logs = [{ ea_match_id: "r1", payload: first }];
  const s = await post([ea("r1b", at(55), 111, 222, 3600, [2, 1])]);
  A("merged into the 9:00 game", s.ingested.length === 1 && s.ingested[0].resumed === true, JSON.stringify(s));
  const stage = of(isLogPost)[0];
  A("the replay's payload is archived first", stage && stage.body[0].payload && stage.body[0].payload.matchId === "r1b" && idx(isLogPost) < idx(isStatDel) && idx(isStatDel) < idx(isGamePatch),
    calls.filter((c) => isLogPost(c) || isStatDel(c) || isStatPost(c) || isGamePatch(c)).map((c) => `${c.m} ${c.u.replace(/^.*\/rest\/v1\//, "").split("?")[0]}`).join(" → "));
  const final = of(isLogPost).slice(-1)[0];
  A("...and finished as `merged` (what the next poll's dedupe reads) without re-uploading the body",
    final.body[0].status === "merged" && final.body[0].game_id === "g900" && !("payload" in final.body[0]), JSON.stringify(final.body[0]));
}

console.log("\n— a batch: filed matches cost nothing, one prefetch covers the whole delivery");
{
  reset(); world.open = [fx()];
  world.filed = { done: "gX", stale: "gY" };
  world.archived = { done: { status: "ingested", game_id: "gX" }, stale: { status: "unmatched", game_id: null }, mrg: { status: "merged", game_id: "gZ" } };
  const s = await post([
    ea("done", at(-2000), 111, 222),      // filed, archive consistent: zero further trips
    ea("stale", at(-1500), 111, 222),     // filed, but the archive row was left `unmatched` (an interrupted filing): one touch
    ea("mrg", at(-1000), 111, 222),       // merged into a resumed game: skipped from the prefetch alone
    ea("new", at(38), 111, 222),          // tonight's game
    ea("new", at(38), 111, 222),          // ...delivered twice in one body
  ]);
  A("the new match files once, the rest are skipped with their reasons",
    s.ingested.length === 1 && s.ingested[0].ea_match_id === "new" && s.skipped.length === 4 && s.errors.length === 0, JSON.stringify(s));
  A("skips: filed ×2, merged ×1, and the duplicate delivery as already ingested",
    s.skipped.filter((x) => x.reason === "already ingested").length === 3 && s.skipped.some((x) => /already merged/.test(x.reason)), JSON.stringify(s.skipped));
  const pre = of((c) => c.m === "GET" && c.u.includes("games?ea_match_id=in."));
  A("ONE games?ea_match_id=in.(…) prefetch, naming every distinct match in the body",
    pre.length === 1 && inList(pre[0].u).sort().join() === "done,mrg,new,stale", pre.map((c) => c.u).join(" | "));
  const preLog = of((c) => c.m === "GET" && c.u.includes("ea_ingest_log?ea_match_id=in."));
  A("ONE archive prefetch, counting only rows that hold a payload", preLog.length === 1 && /payload=not\.is\.null/.test(preLog[0].u));
  A("the consistent filed match touched nothing (no lookups, no writes)",
    !calls.some((c) => c.u.includes("done") && c.m !== "GET") && !calls.some((c) => c.m === "GET" && c.u.includes("ea_match_id=eq.done")));
  const heal = of((c) => isLogPost(c) && c.body[0].ea_match_id === "stale");
  A("the filed match with a stale archive row got exactly one status touch, to `ingested` + its game, without the body",
    heal.length === 1 && heal[0].body[0].status === "ingested" && heal[0].body[0].game_id === "gY" && !("payload" in heal[0].body[0]), JSON.stringify(heal.map((c) => c.body[0])));
  A("the merged match wrote nothing", !calls.some((c) => c.m !== "GET" && JSON.stringify(c.body || "").includes("mrg")));
  A("no fixture lookups ran for any skipped match — only the new one asked for the pair's night",
    of((c) => c.m === "GET" && c.u.includes("games?or=") && c.u.includes("scheduled_at=gte.")).length === 1);
}

console.log("\n— a box score another writer filed a moment earlier is left standing");
{
  reset(); world.open = [fx()]; world.statPostStatus = 409;
  const s = await post([ea("race", at(38), 111, 222)]);
  A("the match is skipped, naming the other writer — not an error, so the poll stays green",
    s.ingested.length === 0 && s.errors.length === 0 && s.skipped.length === 1 && /another writer filed this game first/.test(s.skipped[0].reason), JSON.stringify(s));
  A("the game row was not patched — the other writer's filing stands", of(isGamePatch).length === 0);
  A("...but the payload was archived before the attempt, so nothing is lost", of(isLogPost).length === 1 && of(isLogPost)[0].body[0].payload.matchId === "race");
}

console.log("\n— a roster resolves with one query per lookup step, not one per player");
{
  reset(); world.open = [fx()];
  world.prior = { p1: "prof-1" };                                          // p1 has skated before
  world.profiles = [{ id: "prof-2", gamertag: "away_guy" }, { id: "prof-3", gamertag: "Twin" }, { id: "prof-4", gamertag: "twin" }];
  const s = await post([ea("m9", at(38), 111, 222, 3600, [3, 2],
    { p1: "HomeGuy", p3: "Twin", p5: "Nobody" }, { p2: "Away_Guy" })]);
  A("filed", s.ingested.length === 1, JSON.stringify(s));
  const rows = of(isStatPost)[0].body;
  A("the prior link is honored from the roster-wide prefetch", rows.find((r) => r.ea_player_id === "p1").profile_id === "prof-1");
  A("a gamertag matches exactly, case-insensitively, with its underscore taken literally", rows.find((r) => r.ea_player_id === "p2").profile_id === "prof-2");
  A("two people behind one name link NOBODY, per name", rows.find((r) => r.ea_player_id === "p3").profile_id === null);
  A("a stranger stays unlinked", rows.find((r) => r.ea_player_id === "p5").profile_id === null);
  const priorQ = of((c) => c.m === "GET" && c.u.includes("game_stats?ea_player_id="));
  A("ONE prior-link query for the whole roster (ea_player_id=in.(…))", priorQ.length === 1 && /ea_player_id=in\./.test(priorQ[0].u) && inList(priorQ[0].u).sort().join() === "p1,p2,p3,p5", priorQ.map((c) => c.u).join(" | "));
  /* the roster-wide list is the query that selects id,gamertag; the fuzzy fallback's per-player
     or-lists (step 4, for the two names nothing exact could place) select id alone */
  const tagQ = of((c) => c.m === "GET" && c.u.includes("profiles?or=(") && c.u.includes("select=id,gamertag"));
  A("ONE gamertag query for the whole roster, an ILIKE list of every name on it",
    tagQ.length === 1 && decodeURIComponent(tagQ[0].u).match(/gamertag\.ilike\./g).length === 4 && !/ea_id\.ilike/.test(tagQ[0].u), tagQ.map((c) => c.u).join(" | "));
  A("the fuzzy fallback ran only for the names the exact steps could not place (Twin, Nobody)",
    of((c) => c.m === "GET" && c.u.includes("profiles?or=(") && c.u.includes("select=id&limit=2")).every((c) => /Twin|Nobody/.test(c.u) && !/HomeGuy|Away/.test(c.u)));
  A("...with LIKE metacharacters escaped (Away\\_Guy)", decodeURIComponent(tagQ[0].u).includes("gamertag.ilike.Away\\_Guy"));
  A("no per-player gamertag query at all", !calls.some((c) => c.u.includes("profiles?gamertag=ilike.")));
  A("the summary counts the links", s.ingested[0].linked === 2 && s.ingested[0].players === 4);
}

console.log("\n— the resolver cache spans the batch: a replay sitting's roster is not looked up twice");
{
  reset(); world.open = [fx(), fx({ id: "g935", scheduled_at: "2026-10-21T21:35:00-04:00" })];
  world.prior = { p1: "prof-1" };
  const s = await post([ea("a", at(40), 111, 222), ea("b", at(78), 111, 222)]);
  A("both games file, each on its own slot", s.ingested.length === 2 && s.ingested[0].game_id === "g900" && s.ingested[1].game_id === "g935", JSON.stringify(s));
  A("the roster's prior links were fetched once for the whole batch", of((c) => c.m === "GET" && c.u.includes("game_stats?ea_player_id=")).length === 1);
  A("...and the gamertag list once", of((c) => c.m === "GET" && c.u.includes("profiles?or=(") && c.u.includes("select=id,gamertag")).length === 1);
  A("...and the fuzzy fallback for the unlinked goalie once, not once per game", of((c) => c.m === "GET" && c.u.includes("profiles?or=(") && c.u.includes("limit=2")).length === 2);
}

console.log("\n— a lone ingestOne (the commissioner re-ingest, the tests) builds its own context");
{
  reset(); world.open = [fx()];
  const raw = ea("solo", at(38), 111, 222);
  const norm = I.normalizeMatch(raw);
  const summary = { received: 1, ingested: [], skipped: [], unmatched: [], errors: [] };
  const { ingestOne } = await import("../netlify/functions/ingest-stats.js");
  await ingestOne(norm, raw, summary, [norm]);
  A("filed", summary.ingested.length === 1);
  A("with the same two prefetches, for just that match", of((c) => c.m === "GET" && c.u.includes("games?ea_match_id=in.(solo)")).length === 1
    && of((c) => c.m === "GET" && c.u.includes("ea_ingest_log?ea_match_id=in.(solo)")).length === 1);
}

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
