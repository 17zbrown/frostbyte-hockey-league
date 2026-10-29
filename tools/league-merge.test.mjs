// The manual league lag-out merge — the staff override for sittings the automatic resume-merge
// refused. Run: node tools/league-merge.test.mjs
//
// What must never break: only statistics staff can touch it, a sitting owned by another game can
// never be pulled in, the sitting already on the game must ride along (or its box score would be
// orphaned), and club order flipping between sittings must not swap the teams' stats.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.INGEST_KEY ||= "machine-key";

const { handler, _internals: L } = await import(new URL("../netlify/functions/ingest-stats.js", import.meta.url).pathname);
const { createLookupsFake } = await import(new URL("./ea-lookups-fake.mjs", import.meta.url).pathname);

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* raw EA payload as the poller archives it; flip=true reverses club order (EA does this) */
const rawSitting = (id, ts, homeGoals, awayGoals, flip, toi) => {
  const clubs = {
    "111": { details: { name: "Bruins EA" }, score: String(homeGoals), ppg: "1", ppo: "2", result: "1" },
    "222": { details: { name: "Leafs EA" }, score: String(awayGoals), ppg: "0", ppo: "1", result: "2" },
  };
  /* v3.06: the away club needs a SKATER carrying its goals. Its only player used to be a goalie,
     so the club's `score` claimed goals no player had scored — something real EA data never does
     (checked against all eleven clean games of the first game night: club score and the sum of its
     players' goals agreed exactly, every time). The importer now takes the score from the players,
     so a fixture that disagrees with itself is testing a payload EA does not produce. */
  const players = {
    "111": { h1: { playername: "HomeGuy", position: "center", skgoals: String(homeGoals), skshots: "4", toiseconds: String(toi), ratingOffense: "80", ratingDefense: "70", ratingTeamplay: "75" } },
    "222": {
      t1: { playername: "AwayGuy", position: "goalie", glsaves: "5", glshots: String(5 + homeGoals), glga: String(homeGoals), toiseconds: String(toi) },
      t2: { playername: "AwaySkater", position: "center", skgoals: String(awayGoals), skshots: "3", toiseconds: String(toi), ratingOffense: "78", ratingDefense: "72", ratingTeamplay: "74" },
    },
  };
  const order = flip ? ["222", "111"] : ["111", "222"];
  return { matchId: id, timestamp: ts,
    clubs: Object.fromEntries(order.map((k) => [k, clubs[k]])),
    players: Object.fromEntries(order.map((k) => [k, players[k]])) };
};

const GAME = { id: "g1", season_id: "s1", week: 3, scheduled_at: "2026-10-21T21:00:00-04:00",
  status: "final", home_team_id: "T1", away_team_id: "T2", ea_match_id: "m1", home_score: 1, away_score: 0, voided: false };
const TEAMS = [{ id: "T1", code: "BOS", ea_club_id: "111" }, { id: "T2", code: "TOR", ea_club_id: "222" }];

let PROFILE = { role: "staff", departments: ["statistics"] };
let LOG = [];
const writes = { statDeletes: 0, statRows: [], gamePatches: [], logPatches: [], logInserts: [] };
/* v4.36: what the newer checks read, and the two races the merge must catch */
let GAMEX = null;          // a variant of GAME for one case
let OTHER_FILED = [];      // games rows that already file one of the sittings
let PICKUPS = [];          // pickup_games rows holding one of the sittings
let SEATED = false;        // uid1 holds BOS's Owner seat (a management caller)
let INSERT_DROP = 0;       // the poller archived this many of the EA rows a moment before (ignore-duplicates drops them)
let PATCH_EMPTY = null;    // a sitting whose conditional PATCH matches no row (struck or claimed since the checks)
let LOOKUPS = createLookupsFake();
const ORDER = [];
const SEATS = [{ id: "T1", code: "BOS", owner_profile_id: "uid1", gm_profile_id: null, agm_profile_id: null },
  { id: "T2", code: "TOR", owner_profile_id: "x", gm_profile_id: null, agm_profile_id: null }];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  if (u.includes("/auth/v1/user")) return J({ id: "uid1" });
  if (u.includes("/rest/v1/profiles?id=eq.uid1")) return J([PROFILE]);
  if (u.includes("/rest/v1/games?id=eq.g1") && m === "GET") return J([GAMEX || GAME]);
  if (u.includes("/rest/v1/teams?id=in.")) return J(SEATED && u.includes("owner_profile_id") ? SEATS : TEAMS);
  if (u.includes("/rest/v1/ea_lookups")) return LOOKUPS.handle(u, opts);
  if (u.includes("/rest/v1/games?ea_match_id=in.") && m === "GET") return J(OTHER_FILED);
  if (u.includes("/rest/v1/pickup_games") && m === "GET") return J(PICKUPS);
  if (u.includes("/rest/v1/ea_ingest_log") && m === "POST") {
    const rows = JSON.parse(opts.body); ORDER.push("insert");
    writes.logInserts.push({ prefer: (opts.headers || {}).Prefer, rows });
    return J(rows.slice(INSERT_DROP).map((r) => ({ ea_match_id: r.ea_match_id })), 201);
  }
  if (u.includes("/rest/v1/ea_ingest_log") && m === "GET") {
    /* v3.53: answer the two keyed reads by their keys (the restart reads the game's own sittings) */
    const inM = u.match(/ea_match_id=in\.\(([^)]+)\)/);
    if (inM) { const ids = decodeURIComponent(inM[1]).split(","); return J(LOG.filter((r) => ids.includes(r.ea_match_id))); }
    const gm = u.match(/game_id=eq\.([^&]+)/);
    if (gm) return J(LOG.filter((r) => r.game_id === gm[1]));
    return J(LOG);
  }
  /* v4.36: the merge marks an archived sitting conditionally and reads the representation back (an empty one is a race) */
  if (u.includes("/rest/v1/ea_ingest_log") && m === "PATCH") {
    const id = decodeURIComponent((u.match(/ea_match_id=eq\.([^&]+)/)||[])[1]||"");
    writes.logPatches.push({ url: u, body: JSON.parse(opts.body) }); ORDER.push("patch");
    return J(id === PATCH_EMPTY ? [] : [{ ea_match_id: id }]);
  }
  if (u.includes("/rest/v1/game_stats") && m === "DELETE") { writes.statDeletes++; ORDER.push("delete"); return J(null); }
  if (u.includes("/rest/v1/game_stats") && m === "POST") { writes.statRows.push(...JSON.parse(opts.body)); ORDER.push("post"); return J(null); }
  if (u.includes("/rest/v1/games?id=eq.") && m === "PATCH") { writes.gamePatches.push(JSON.parse(opts.body)); ORDER.push("game"); return J(null); }
  return J([]);   // resolveProfile lookups etc.
};
const call = (body) => handler({ httpMethod: "POST", headers: { authorization: "Bearer jwt" }, body: JSON.stringify(body) });

console.log("— the gate");
{
  PROFILE = { role: "member", departments: [] };
  A("a member is refused", (await call({ leagueCandidates: { gameId: "g1" } })).statusCode === 401);
  PROFILE = { role: "staff", departments: ["community"] };
  A("staff outside statistics are refused", (await call({ leagueMerge: { gameId: "g1", matchIds: ["m1"] } })).statusCode === 401);
  PROFILE = { role: "commissioner", departments: [] };
  LOG = [];
  A("a commissioner passes", (await call({ leagueCandidates: { gameId: "g1" } })).statusCode === 200);
  PROFILE = { role: "staff", departments: ["statistics"] };
}

console.log("\n— candidates from the archive");
{
  LOG = [
    { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", 1761090000, 1, 0, false, 300) },
    { ea_match_id: "m2", status: "unmatched", game_id: null, et_day: "2026-10-21", payload: rawSitting("m2", 1761093900, 2, 1, true, 420) },
    { ea_match_id: "mX", status: "ingested", game_id: "gOther", et_day: "2026-10-21", payload: rawSitting("mX", 1761097000, 3, 3, false, 700) },
  ];
  const res = JSON.parse((await call({ leagueCandidates: { gameId: "g1" } })).body);
  A("all archived sittings between the clubs return", res.candidates.length === 3);
  const m1 = res.candidates.find((c) => c.matchId === "m1"), m2 = res.candidates.find((c) => c.matchId === "m2"), mX = res.candidates.find((c) => c.matchId === "mX");
  A("the attached sitting is marked", m1.attached === true && m2.attached === false);
  A("another game's sitting is marked off-limits", mX.usedElsewhere === true);
  A("session length surfaces in minutes", m2.minutes === 7);
  A("scores read home-first even when EA flipped the clubs", m2.homeScore === 2 && m2.awayScore === 1);
}

console.log("\n— the merge");
{
  /* v3.53: sittings that add up to a full game (40 + 20 minutes), or the merge is held (below) */
  LOG = [
    { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", 1761090000, 1, 0, false, 2400) },
    { ea_match_id: "m2", status: "unmatched", game_id: null, et_day: "2026-10-21", payload: rawSitting("m2", 1761093900, 2, 1, true, 1200) },
  ];
  const res = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"] } })).body);
  A("the merge succeeds", res.ok === true && res.sittings === 2, JSON.stringify(res).slice(0, 100));
  A("the score is the aggregate", res.score === "3-1");
  A("the old box score is replaced, not appended", writes.statDeletes === 1);
  const homeRow = writes.statRows.find((r) => r.skater_name === "HomeGuy");
  A("the home skater's goals sum across sittings despite the flip", homeRow && homeRow.goals === 3 && homeRow.team_id === "T1");
  const goalieRow = writes.statRows.find((r) => r.skater_name === "AwayGuy");
  A("the away goalie's saves sum on the away side", goalieRow && goalieRow.saves === 10 && goalieRow.team_id === "T2");
  const gp = writes.gamePatches[0];
  A("the game goes final on the merged line", gp && gp.status === "final" && gp.home_score === 3 && gp.away_score === 1);
  A("provenance lands in the archive (first=ingested, rest=merged)",
    writes.logPatches.some((p) => p.url.includes("m1") && p.body.status === "ingested") &&
    writes.logPatches.some((p) => p.url.includes("m2") && p.body.status === "merged" && p.body.game_id === "g1"));
}

console.log("\n— v3.53: a manual merge short of a full, decided game is HELD, never published");
{
  for (const k of Object.keys(writes)) { if (Array.isArray(writes[k])) writes[k].length = 0; else writes[k] = 0; }
  LOG = [
    { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", 1761090000, 1, 0, false, 300) },
    { ea_match_id: "m2", status: "unmatched", game_id: null, et_day: "2026-10-21", payload: rawSitting("m2", 1761093900, 2, 1, true, 420) },
  ];
  /* v4.36: GAME is final, so a short merge takes its result down: the desk confirms that and sends unpublish */
  const res = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"], unpublish: true } })).body);
  A("the merge is accepted and says it is held", res.ok === true && res.held === true && /held until the rest of the game/.test(res.heldWhy || ""), JSON.stringify(res));
  const gp = writes.gamePatches[0];
  A("...the game carries no result", gp && gp.status === "scheduled" && gp.home_score === null && gp.away_score === null, JSON.stringify(gp));
  A("...the box score is still written", writes.statRows.length > 0);
  A("...and the first sitting is archived incomplete", writes.logPatches.some((p) => p.url.includes("m1") && p.body.status === "incomplete"));

  /* level after sixty minutes: held for the overtime reload */
  for (const k of Object.keys(writes)) { if (Array.isArray(writes[k])) writes[k].length = 0; else writes[k] = 0; }
  LOG = [
    { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", 1761090000, 1, 0, false, 2400) },
    { ea_match_id: "m2", status: "unmatched", game_id: null, et_day: "2026-10-21", payload: rawSitting("m2", 1761093900, 0, 1, false, 1200) },
  ];
  const lvl = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"], unpublish: true } })).body);
  A("level at sixty: held for the overtime reload", lvl.held === true && /overtime reload/.test(lvl.heldWhy || ""), JSON.stringify(lvl));

  /* past sixty by one goal: an overtime result, read from the clock */
  for (const k of Object.keys(writes)) { if (Array.isArray(writes[k])) writes[k].length = 0; else writes[k] = 0; }
  LOG = [
    { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", 1761090000, 1, 1, false, 3600) },
    { ea_match_id: "m2", status: "unmatched", game_id: null, et_day: "2026-10-21", payload: rawSitting("m2", 1761093900, 1, 0, false, 300) },
  ];
  const ot = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"] } })).body);
  A("65 minutes, one goal: filed as an overtime result", ot.held === false && ot.wentOt === true && ot.inferredOt === true && writes.gamePatches[0].went_ot === true && writes.gamePatches[0].status === "final", JSON.stringify(ot));
}

console.log("\n— v3.53: a restarted game is re-filed from the restart alone (Rules 4.3 and 4.5)");
{
  for (const k of Object.keys(writes)) { if (Array.isArray(writes[k])) writes[k].length = 0; else writes[k] = 0; }
  LOG = [
    { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", 1761090000, 1, 0, false, 900) },
    { ea_match_id: "m2", status: "unmatched", game_id: null, et_day: "2026-10-21", payload: rawSitting("m2", 1761093900, 3, 1, false, 3600) },
  ];
  PROFILE = { role: "staff", departments: ["statistics"] };
  const r = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m2"], restart: true } })).body);
  A("staff may re-file from the restart alone", r.ok === true && r.score === "3-1" && r.held === false, JSON.stringify(r));
  A("...the sitting left out is struck", r.struck >= 1 && writes.logPatches.some((p) => p.url.includes("m1") && p.body.status === "struck"), JSON.stringify(writes.logPatches));
  A("...and the game reads the restart's score", writes.gamePatches[0] && writes.gamePatches[0].home_score === 3 && writes.gamePatches[0].away_score === 1 && writes.gamePatches[0].ea_match_id === "m2");
  const noRestart = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m2"] } })).body);
  A("without the restart flag, leaving the game's sitting out is still refused", /Include the sitting/.test(noRestart.error || "") && /Restarted/.test(noRestart.error || ""), noRestart.error);
}

console.log("\n— refusals that protect other games");
{
  LOG = [
    { ea_match_id: "m2", status: "unmatched", game_id: null, et_day: "2026-10-21", payload: rawSitting("m2", 1761093900, 2, 1, false, 420) },
  ];
  const missingAttached = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m2"] } })).body);
  A("excluding the sitting already on the game is refused", /Include the sitting/.test(missingAttached.error || ""));

  LOG = [
    { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", 1761090000, 1, 0, false, 300) },
    { ea_match_id: "mX", status: "ingested", game_id: "gOther", et_day: "2026-10-21", payload: rawSitting("mX", 1761097000, 3, 3, false, 700) },
  ];
  const stolen = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "mX"] } })).body);
  A("a sitting owned by another game is refused", /already belongs to another game/.test(stolen.error || ""));

  LOG = [{ ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", 1761090000, 1, 0, false, 300) }];
  const ghost = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "mGhost"] } })).body);
  A("a sitting the poller never archived is refused", /no archived payload/.test(ghost.error || ""));
}

/* ---- v4.36: the Stats manager redesign. Every check runs before any write; the archive is still written first. ---- */
const T0 = Date.parse(GAME.scheduled_at) / 1000;   // puck drop, in EA's seconds
const clear = () => { for (const k of Object.keys(writes)) { if (Array.isArray(writes[k])) writes[k].length = 0; else writes[k] = 0; } ORDER.length = 0; };
const zero = () => writes.statDeletes === 0 && !writes.statRows.length && !writes.gamePatches.length && !writes.logPatches.length && !writes.logInserts.length;
const STAFF = { role: "staff", departments: ["statistics"] };
const row = (id, status, gameId, ts, h, a, flip, toi) => ({ ea_match_id: id, status, game_id: gameId, et_day: "2026-10-21", payload: rawSitting(id, ts, h, a, flip, toi) });
const res = async (b) => { const r = await call(b); return { code: r.statusCode, o: JSON.parse(r.body) }; };

console.log("\n# v4.36: a struck sitting stays struck (Rules 4.3 and 4.5)");
{
  LOG = [row("m1", "ingested", "g1", T0 + 2400, 1, 0, false, 2400), row("mS", "struck", "g1", T0 + 600, 0, 0, false, 500)];
  for (const [who, prof, inner] of [
    ["statistics staff", STAFF, { matchIds: ["m1", "mS"] }],
    ["a commissioner", { role: "commissioner", departments: [] }, { matchIds: ["m1", "mS"] }],
    ["a restart", STAFF, { matchIds: ["mS"], restart: true }]]) {
    clear(); PROFILE = prof;
    const { code, o } = await res({ leagueMerge: { gameId: "g1", unpublish: true, ...inner } });
    A(`refused for ${who}`, code === 422 && o.code === "struck" && /^Sitting mS was struck when its game restarted from the beginning \(Rules 4\.3 and 4\.5\)\. A struck sitting stays struck, so it can't be merged\.$/.test(o.error || ""), JSON.stringify(o));
    A("...with nothing written", zero(), ORDER.join(" "));
  }
  PROFILE = STAFF;
}

console.log("\n# v4.36: every line counts: a sitting already on the game rides along, or a restart strikes it");
{
  LOG = [row("m1", "ingested", "g1", T0 + 2400, 1, 0, false, 2400), row("m2", "merged", "g1", T0 + 3000, 0, 0, false, 600),
    row("m3", "unmatched", null, T0 + 5000, 1, 0, false, 1200)];
  clear();
  const { code, o } = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m3"] } });
  A("a merged-on sitting left out is refused", code === 422 && /This game already has sittings m1 and m2 on it\. Include every one of them: the merge REPLACES the box score\./.test(o.error || "") && /Restarted/.test(o.error || ""), o.error);
  A("...with nothing written", zero());
  clear();
  const rs = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m3"], restart: true } });
  A("with Restarted it is struck instead", rs.o.ok === true && rs.o.struck === 1 && writes.logPatches.some((p) => /ea_match_id=eq\.m2$/.test(p.url) && p.body.status === "struck"), JSON.stringify(rs.o));
}

console.log("\n# v4.36: the refusals that protect other games and the pickup tables");
{
  LOG = [row("m1", "ingested", "g1", T0 + 2400, 1, 0, false, 2400), row("m2", "unmatched", null, T0 + 3700, 2, 1, true, 1200)];
  clear(); OTHER_FILED = [{ id: "gZ", ea_match_id: "m2" }];
  let r = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"] } });
  A("another game's filed sitting (games.ea_match_id) is refused", r.code === 422 && r.o.error === "Sitting m2 is the filed sitting of another game, so it can't be merged here.", r.o.error);
  A("...with nothing written", zero());
  OTHER_FILED = []; clear(); PICKUPS = [{ id: "pu1", ea_match_id: "x", ea_match_ids: ["x", "m2"] }];
  r = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"] } });
  A("a sitting imported as a pickup game is refused, naming the pickup game", r.code === 409 && r.o.pickupGameId === "pu1" && r.o.error === "Sitting m2 was imported as a pickup game. Delete that pickup game first (Pickup games on file), then merge.", JSON.stringify(r.o));
  A("...with nothing written", zero());
  PICKUPS = []; clear(); SEATED = true; PROFILE = { role: "member", departments: [], gamertag: "BosOwner" };
  const posts0 = LOOKUPS.posts.length;
  r = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1"], eaClubId: "222" } });
  A("management may not take a sitting from EA", r.code === 403 && r.o.error === "Only statistics staff or a commissioner can merge a sitting the league archive does not hold yet.", JSON.stringify(r.o));
  A("...nothing written and EA never asked", zero() && LOOKUPS.posts.length === posts0);
  SEATED = false; PROFILE = STAFF;
}

console.log("\n# v4.36: a sitting the archive never held, taken from EA through the bot's server");
{
  LOG = [row("m1", "ingested", "g1", T0 + 2400, 1, 0, false, 2400)];
  const mNew = rawSitting("mNew", T0 + 3700, 2, 1, true, 1200);
  LOOKUPS = createLookupsFake(); clear();
  const p = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "mNew"], eaClubId: "222" } });
  A("nothing stored: ONE request for the bot, and the browser is told to wait", typeof p.o.eaPending === "number" && LOOKUPS.posts.length === 1 && LOOKUPS.posts[0].kind === "matches" && LOOKUPS.posts[0].arg === "222" && LOOKUPS.posts[0].requested_by === "uid1", JSON.stringify(p.o));
  A("...with nothing written", zero());
  LOOKUPS.answerAll(() => [mNew]);
  clear();
  const d = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "mNew"], eaClubId: "222", eaLookup: p.o.eaPending } });
  A("the merge completes from the bot's answer", d.o.ok === true && d.o.score === "3-1" && d.o.held === false && JSON.stringify(d.o.archived) === '["mNew"]', JSON.stringify(d.o));
  A("...and says what posts and how long it ran", d.o.posts === "corrected" && d.o.minutes === 60);
  const ins = writes.logInserts[0], ir = ins && ins.rows[0];
  A("the EA sitting is archived in one insert that never clobbers the poller's row", writes.logInserts.length === 1 && ins.rows.length === 1 && /resolution=ignore-duplicates/.test(ins.prefer) && /return=representation/.test(ins.prefer));
  A("...carrying its payload, day and clubs", ir && ir.ea_match_id === "mNew" && ir.payload && ir.payload.matchId === "mNew" && ir.et_day === "2026-10-21" && ir.ea_club_ids.slice().sort().join(",") === "111,222", JSON.stringify(ir && { ...ir, payload: undefined }));
  A("...with its final provenance (no `unmatched` step)", ir.status === "merged" && ir.game_id === "g1" && /manually merged into m1 by uid1 \(stats staff\) \(taken from EA by the Stats manager search: the poller never archived it\)/.test(ir.reason || ""), ir.reason);
  A("write order: insert, archive mark, delete box score, post box score, game", ORDER.join(" ") === "insert patch delete post game", ORDER.join(" "));

  /* the stored answer (a minute old) is reused: a sitting still missing asks EA once more, then refuses */
  LOOKUPS = createLookupsFake(); LOOKUPS.seed("matches", "222", [mNew], 60000); clear();
  const g1 = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "mGhost"], eaClubId: "222" } });
  A("a sitting missing from the stored list asks EA once more", typeof g1.o.eaPending === "number" && LOOKUPS.posts.length === 1, JSON.stringify(g1.o));
  LOOKUPS.answerAll(() => [mNew]);
  const g2 = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "mGhost"], eaClubId: "222", eaLookup: g1.o.eaPending } });
  A("...and when EA still does not list it, a plain 404", g2.code === 404 && /no archived payload/.test(g2.o.error || "") && /EA no longer lists it/.test(g2.o.error || "") && LOOKUPS.posts.length === 1, JSON.stringify(g2.o));
  A("...with nothing written", zero());

  /* the races: the poller archived the sitting a moment ago, or a sitting changed since the checks */
  LOOKUPS = createLookupsFake(); LOOKUPS.seed("matches", "222", [mNew], 60000); clear(); INSERT_DROP = 1;
  const ri = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "mNew"], eaClubId: "222" } });
  A("fewer rows inserted than sent: 409, the game untouched", ri.code === 409 && ri.o.error === "The poller saved one of these sittings a moment ago, so the game was not touched. Load the sittings again and merge." && writes.statDeletes === 0 && !writes.gamePatches.length && !writes.logPatches.length, JSON.stringify(ri.o));
  INSERT_DROP = 0;
  LOG = [row("m1", "ingested", "g1", T0 + 2400, 1, 0, false, 2400), row("m2", "unmatched", null, T0 + 3700, 2, 1, true, 1200)];
  clear(); PATCH_EMPTY = "m2";
  const rp = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"] } });
  A("a conditional archive mark that finds no row: 409, the game untouched", rp.code === 409 && rp.o.error === "Sitting m2 changed while merging, so the game was not touched. Load the sittings again and merge." && writes.statDeletes === 0 && !writes.gamePatches.length, JSON.stringify(rp.o));
  const marks = writes.logPatches.filter((p) => /&or=\(game_id\.is\.null/.test(p.url)), undos = writes.logPatches.filter((p) => !/&or=\(game_id\.is\.null/.test(p.url));
  A("...the mark is conditional: never over a struck row, never one another game claimed", marks.length === 2 && marks.every((p) => /&status=neq\.struck&or=\(game_id\.is\.null,game_id\.eq\.g1\)$/.test(p.url)), marks.map((p) => p.url).join(" "));
  /* v4.36 review: a race exit puts back what this request already wrote (m1 was marked before m2 failed) */
  A("...and the exit puts m1 back as it was, only while it still names this game", undos.length === 1 && /ea_match_id=eq\.m1&game_id=eq\.g1&status=neq\.struck$/.test(undos[0].url) && undos[0].body.status === "ingested" && undos[0].body.game_id === "g1", JSON.stringify(undos));
  PATCH_EMPTY = null;
}

console.log("\n# v4.36: the preview writes nothing and states what the merge will do");
{
  const full = () => [row("m1", "ingested", "g1", T0 + 2400, 1, 0, false, 2400), row("m2", "unmatched", null, T0 + 5 * 3600, 2, 1, true, 1200)];
  const pv = async (inner) => { clear(); const r = await res({ leagueMerge: { gameId: "g1", preview: true, ...inner } }); return r.o; };
  LOG = full(); GAMEX = { ...GAME, status: "scheduled", home_score: null, away_score: null };
  let o = await pv({ matchIds: ["m1", "m2"] });
  A("a held game going final: posts the final", o.ok === true && o.preview === true && o.posts === "final" && o.unpublish === false && o.held === false && o.score === "3-1" && o.minutes === 60 && o.sittings === 2, JSON.stringify(o));
  A("...says which sitting ended outside the game's window", JSON.stringify(o.outsideWindow) === '["m2"]', JSON.stringify(o.outsideWindow));
  A("...and what is on record now", o.current && o.current.status === "scheduled" && o.current.score === null);
  A("...with nothing written", zero(), ORDER.join(" "));
  GAMEX = null; LOG = full();
  o = await pv({ matchIds: ["m1", "m2"] });
  A("a final whose score changes: a Corrected line", o.posts === "corrected" && o.current.score === "1-0" && zero(), JSON.stringify(o));
  GAMEX = { ...GAME, home_score: 3, away_score: 1 };
  o = await pv({ matchIds: ["m1", "m2"] });
  A("a final whose score stays: nothing posts", o.posts === "none" && zero(), JSON.stringify(o));
  GAMEX = null;
  LOG = [row("m1", "ingested", "g1", T0 + 300, 1, 0, false, 300), row("m2", "unmatched", null, T0 + 900, 2, 1, true, 420)];
  o = await pv({ matchIds: ["m1", "m2"] });
  A("a short merge onto a final: unpublish, held, nothing posts", o.unpublish === true && o.held === true && o.posts === "none" && /held until the rest of the game is merged/.test(o.heldWhy || "") && zero(), JSON.stringify(o));
  LOG = [row("m1", "ingested", "g1", T0 + 900, 1, 0, false, 900), row("m2", "unmatched", null, T0 + 3700, 3, 1, false, 3600)];
  o = await pv({ matchIds: ["m2"], restart: true });
  A("a restart names the sittings it will strike", JSON.stringify(o.strike) === '["m1"]' && zero(), JSON.stringify(o));
  LOG = [row("m1", "ingested", "g1", T0 + 2400, 1, 0, false, 2400)];
  LOOKUPS = createLookupsFake(); LOOKUPS.seed("matches", "222", [rawSitting("mNew", T0 + 3700, 2, 1, true, 1200)], 60000);
  o = await pv({ matchIds: ["m1", "mNew"], eaClubId: "222" });
  A("a sitting taken from EA is named, and a preview never archives it", JSON.stringify(o.fromEa) === '["mNew"]' && zero(), JSON.stringify(o));
}

console.log("\n# v4.36: taking a published final down needs the desk's confirm");
{
  LOG = [row("m1", "ingested", "g1", T0 + 300, 1, 0, false, 300), row("m2", "unmatched", null, T0 + 900, 2, 1, true, 420)];
  clear();
  const r = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"] } });
  A("without unpublish: 409 wouldHold, saying how short it is", r.code === 409 && r.o.wouldHold === true && /^These sittings add up to 12 of 60 minutes, so the game would go back to held/.test(r.o.error || "") && /held until the rest/.test(r.o.heldWhy || ""), JSON.stringify(r.o));
  A("...with nothing written", zero());
  clear();
  const u = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"], unpublish: true } });
  A("with it, the merge is held", u.o.ok === true && u.o.held === true && u.o.posts === "none" && writes.gamePatches[0].status === "scheduled", JSON.stringify(u.o));
}

console.log("\n# v4.36: the club desk's candidates never show a struck sitting as attached");
{
  LOG = [row("m1", "ingested", "g1", T0 + 2400, 1, 0, false, 2400), row("mS", "struck", "g1", T0 + 600, 0, 0, false, 500)];
  const c = JSON.parse((await call({ leagueCandidates: { gameId: "g1" } })).body);
  const s = c.candidates.find((x) => x.matchId === "mS"), f = c.candidates.find((x) => x.matchId === "m1");
  A("a struck row on the game: not attached, marked struck", s && s.attached === false && s.struck === true && s.usedElsewhere === false, JSON.stringify(s));
  A("...the live sitting is still attached", f && f.attached === true && f.struck === false);
}

console.log("\n— a merge that throws part way answers in words (v4.36 review)");
{
  LOG = [row("m1", "ingested", "g1", T0 + 2400, 1, 0, false, 2400), row("m2", "unmatched", null, T0 + 3700, 2, 1, true, 1200)];
  clear();
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => (String(url).includes("/rest/v1/games?ea_match_id=in.") ? new Response("upstream down", { status: 500 }) : inner(url, opts));
  const r = await res({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"] } });
  globalThis.fetch = inner;
  A("a 500 with an error the desk shows, never a body with no error in it", r.code === 500 && /^The merge stopped part way: /.test(r.o.error || "") && /Check the game in the Stats manager/.test(r.o.error || ""), JSON.stringify(r.o));
  A("...and nothing was written before it", writes.statDeletes === 0 && !writes.gamePatches.length && !writes.logPatches.length);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
