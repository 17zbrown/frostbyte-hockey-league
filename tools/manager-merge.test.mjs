// Club management repairing its OWN lag-out game. The whole risk of opening this beyond staff is
// scope: a manager must reach their own fixtures and nothing else, must not be able to graft an
// unrelated meeting between the same two clubs onto a game, and every rebuild must stay
// attributable. Run: node tools/manager-merge.test.mjs
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.INGEST_KEY ||= "machine-key";

const { handler } = await import(new URL("../netlify/functions/ingest-stats.js", import.meta.url).pathname);

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* EA payload as the poller archives it; flip=true reverses club order (EA really does this) */
const rawSitting = (id, ts, homeGoals, awayGoals, flip, toi) => {
  const clubs = {
    "111": { details: { name: "Bruins EA" }, score: String(homeGoals), ppg: "1", ppo: "2", result: "1" },
    "222": { details: { name: "Leafs EA" }, score: String(awayGoals), ppg: "0", ppo: "1", result: "2" },
  };
  const players = {
    "111": { h1: { playername: "HomeGuy", position: "center", skgoals: String(homeGoals), skshots: "4", toiseconds: String(toi), ratingOffense: "80", ratingDefense: "70", ratingTeamplay: "75" } },
    "222": { t1: { playername: "AwayGuy", position: "goalie", glsaves: "5", glshots: String(5 + homeGoals), glga: String(homeGoals), toiseconds: String(toi) } },
  };
  const order = flip ? ["222", "111"] : ["111", "222"];
  return { matchId: id, timestamp: ts,
    clubs: Object.fromEntries(order.map((k) => [k, clubs[k]])),
    players: Object.fromEntries(order.map((k) => [k, players[k]])) };
};

/* the fixture: BOS (T1) hosts TOR (T2) on 2026-10-21 ET */
const GAME = { id: "g1", season_id: "s1", week: 3, scheduled_at: "2026-10-21T21:00:00-04:00",
  status: "final", home_team_id: "T1", away_team_id: "T2", ea_match_id: "m1", home_score: 1, away_score: 0, voided: false };
/* Derived from the dates themselves rather than hand-copied epochs: the window guard compares
   the SITTING's ET day to the FIXTURE's, so a fixture-relative literal that silently drifts a
   year (as a hard-coded epoch did) would turn this whole file green against the wrong thing. */
const ET = (iso) => Math.floor(Date.parse(iso) / 1000);
const SAME_NIGHT = ET("2026-10-21T21:05:00-04:00");
const SAME_NIGHT_LATER = ET("2026-10-21T22:10:00-04:00");
const WEEKS_LATER = ET("2026-11-10T21:00:00-05:00");   // a different meeting between the same two clubs

const SEATS = [
  { id: "T1", code: "BOS", owner_profile_id: "bos-owner", gm_profile_id: "bos-gm", agm_profile_id: null },
  { id: "T2", code: "TOR", owner_profile_id: "tor-owner", gm_profile_id: null, agm_profile_id: "tor-agm" },
];
const EACLUBS = [{ id: "T1", code: "BOS", ea_club_id: "111" }, { id: "T2", code: "TOR", ea_club_id: "222" }];

const PROFILES = {
  "bos-gm":     { role: "member", departments: [], gamertag: "BosGM", banned: false },
  "tor-agm":    { role: "member", departments: [], gamertag: "TorAGM", banned: false },
  "bos-owner":  { role: "member", departments: [], gamertag: "BosOwner", banned: true },   // banned
  "rando":      { role: "member", departments: [], gamertag: "Rando", banned: false },
  "other-gm":   { role: "member", departments: [], gamertag: "OtherGM", banned: false },   // runs a club, but not this one
  "statsguy":   { role: "staff", departments: ["statistics"], gamertag: "StatsGuy", banned: false },
};

let UID = "bos-gm";
let LOG = [];
const writes = { statDeletes: 0, statRows: [], gamePatches: [], logPatches: [], webhooks: [] };
const reset = () => { writes.statDeletes = 0; writes.statRows = []; writes.gamePatches = []; writes.logPatches = []; writes.webhooks = []; };

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  if (u.includes("/auth/v1/user")) return UID ? J({ id: UID }) : J({ error: "bad" }, 401);
  if (u.includes("/rest/v1/profiles?id=eq.")) {
    const id = decodeURIComponent(u.match(/id=eq\.([^&]+)/)[1]);
    return J(PROFILES[id] ? [PROFILES[id]] : []);
  }
  if (u.includes("/rest/v1/games?id=eq.g1") && m === "GET") return J([GAME]);
  if (u.includes("/rest/v1/teams?id=in.")) return J(u.includes("owner_profile_id") ? SEATS : EACLUBS);
  if (u.includes("/rest/v1/app_config")) return J([{ key: "discord_staff_webhook", value: "https://discord.test/hook" }]);
  if (u.startsWith("https://discord.test/hook")) { writes.webhooks.push(JSON.parse(opts.body)); return J(null); }
  if (u.includes("/rest/v1/ea_ingest_log") && m === "GET") return J(LOG);
  if (u.includes("/rest/v1/ea_ingest_log") && m === "PATCH") { writes.logPatches.push({ url: u, body: JSON.parse(opts.body) }); return J(null); }
  if (u.includes("/rest/v1/game_stats") && m === "DELETE") { writes.statDeletes++; return J(null); }
  if (u.includes("/rest/v1/game_stats") && m === "POST") { writes.statRows.push(...JSON.parse(opts.body)); return J(null); }
  if (u.includes("/rest/v1/games?id=eq.") && m === "PATCH") { writes.gamePatches.push(JSON.parse(opts.body)); return J(null); }
  return J([]);
};
const call = (body) => handler({ httpMethod: "POST", headers: { authorization: "Bearer jwt" }, body: JSON.stringify(body) });
const twoSittings = () => [
  { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", SAME_NIGHT, 1, 0, false, 300) },
  { ea_match_id: "m2", status: "unmatched", game_id: null, et_day: "2026-10-21", payload: rawSitting("m2", SAME_NIGHT_LATER, 2, 1, true, 420) },
];

console.log("— who may open a fixture");
{
  LOG = twoSittings();
  UID = "bos-gm";
  A("the home club's GM may load its sittings", (await call({ leagueCandidates: { gameId: "g1" } })).statusCode === 200);
  UID = "tor-agm";
  A("the away club's AGM may too", (await call({ leagueCandidates: { gameId: "g1" } })).statusCode === 200);
  UID = "statsguy";
  A("statistics staff still may", (await call({ leagueCandidates: { gameId: "g1" } })).statusCode === 200);
  UID = "rando";
  A("a rostered player may not", (await call({ leagueCandidates: { gameId: "g1" } })).statusCode === 401);
  UID = "other-gm";
  A("a manager of a DIFFERENT club may not touch this fixture", (await call({ leagueCandidates: { gameId: "g1" } })).statusCode === 401);
  UID = "bos-owner";
  A("a banned manager may not, even holding the seat", (await call({ leagueCandidates: { gameId: "g1" } })).statusCode === 401);
  UID = null;
  A("no session at all is refused", (await call({ leagueCandidates: { gameId: "g1" } })).statusCode === 401);
  UID = "bos-gm";
  const res = JSON.parse((await call({ leagueCandidates: { gameId: "g1" } })).body);
  A("the response says which hat opened it", res.role === "management");
}

console.log("\n— the same gate guards the write, not just the read");
{
  LOG = twoSittings();
  UID = "rando";
  A("a non-manager cannot merge", (await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"] } })).statusCode === 401);
  UID = "other-gm";
  A("another club's manager cannot merge this game", (await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"] } })).statusCode === 401);
  A("...and nothing was written", writes.statDeletes === 0 && writes.gamePatches.length === 0);
}

console.log("\n— a club merges its own lag-out");
{
  LOG = twoSittings(); reset();
  UID = "bos-gm";
  const res = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"] } })).body);
  A("the merge succeeds", res.ok === true && res.sittings === 2, JSON.stringify(res).slice(0, 120));
  A("the score aggregates across sittings", res.score === "3-1");
  A("the old box score is replaced, not appended", writes.statDeletes === 1);
  const home = writes.statRows.find((r) => r.skater_name === "HomeGuy");
  A("stats sum on the right side despite EA flipping the clubs", home && home.goals === 3 && home.team_id === "T1");
  A("provenance names the human and the club", /BosGM \(BOS management\)/.test(JSON.stringify(writes.logPatches)));
  A("...on the merged sitting too", writes.logPatches.filter((p) => /BosGM/.test(JSON.stringify(p.body))).length === 2);
  A("staff are told a club rebuilt a game", writes.webhooks.length === 1 && /BosGM/.test(writes.webhooks[0].content));
  A("the notice names the fixture and the new score", /TOR @ BOS/.test(writes.webhooks[0].content) && /3-1/.test(writes.webhooks[0].content));
}

console.log("\n— a club cannot reach past its own fixture");
{
  /* the same two clubs meet again weeks later; that sitting is real, archived, unattached, and
     between the right pair — only the date keeps it out of this game */
  LOG = [
    { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", SAME_NIGHT, 1, 0, false, 300) },
    { ea_match_id: "mLater", status: "unmatched", game_id: null, et_day: "2026-11-10", payload: rawSitting("mLater", WEEKS_LATER, 5, 0, false, 700) },
  ];
  reset(); UID = "bos-gm";
  const mgmt = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "mLater"] } })).body);
  A("a different meeting can't be grafted on by a club", /wasn.t played around this fixture/.test(mgmt.error || ""), mgmt.error);
  A("...and the game was left untouched", writes.statDeletes === 0 && writes.gamePatches.length === 0);
  reset(); UID = "statsguy";
  const staff = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "mLater"] } })).body);
  A("staff keep the unrestricted reach", staff.ok === true, staff.error);
  A("a staff merge is NOT announced as a club rebuild", writes.webhooks.length === 0);
  A("staff provenance says stats staff", /StatsGuy \(stats staff\)/.test(JSON.stringify(writes.logPatches)));
}

console.log("\n— the protections that already existed still hold for managers");
{
  LOG = [
    { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", SAME_NIGHT, 1, 0, false, 300) },
    { ea_match_id: "mX", status: "ingested", game_id: "gOther", et_day: "2026-10-21", payload: rawSitting("mX", SAME_NIGHT_LATER, 3, 3, false, 700) },
  ];
  reset(); UID = "bos-gm";
  const stolen = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "mX"] } })).body);
  A("another game's sitting still can't be stolen", /already belongs to another game/.test(stolen.error || ""));

  LOG = [{ ea_match_id: "m2", status: "unmatched", game_id: null, et_day: "2026-10-21", payload: rawSitting("m2", SAME_NIGHT_LATER, 2, 1, false, 420) }];
  const orphan = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m2"] } })).body);
  A("dropping the sitting already on the game is still refused", /Include the sitting/.test(orphan.error || ""));
  A("nothing was written by either refusal", writes.statDeletes === 0 && writes.gamePatches.length === 0);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
