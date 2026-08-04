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

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* raw EA payload as the poller archives it; flip=true reverses club order (EA does this) */
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

const GAME = { id: "g1", season_id: "s1", week: 3, scheduled_at: "2026-10-21T21:00:00-04:00",
  status: "final", home_team_id: "T1", away_team_id: "T2", ea_match_id: "m1", home_score: 1, away_score: 0, voided: false };
const TEAMS = [{ id: "T1", code: "BOS", ea_club_id: "111" }, { id: "T2", code: "TOR", ea_club_id: "222" }];

let PROFILE = { role: "staff", departments: ["statistics"] };
let LOG = [];
const writes = { statDeletes: 0, statRows: [], gamePatches: [], logPatches: [] };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  if (u.includes("/auth/v1/user")) return J({ id: "uid1" });
  if (u.includes("/rest/v1/profiles?id=eq.uid1")) return J([PROFILE]);
  if (u.includes("/rest/v1/games?id=eq.g1") && m === "GET") return J([GAME]);
  if (u.includes("/rest/v1/teams?id=in.")) return J(TEAMS);
  if (u.includes("/rest/v1/ea_ingest_log") && m === "GET") return J(LOG);
  if (u.includes("/rest/v1/ea_ingest_log") && m === "PATCH") { writes.logPatches.push({ url: u, body: JSON.parse(opts.body) }); return J(null); }
  if (u.includes("/rest/v1/game_stats") && m === "DELETE") { writes.statDeletes++; return J(null); }
  if (u.includes("/rest/v1/game_stats") && m === "POST") { writes.statRows.push(...JSON.parse(opts.body)); return J(null); }
  if (u.includes("/rest/v1/games?id=eq.") && m === "PATCH") { writes.gamePatches.push(JSON.parse(opts.body)); return J(null); }
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
  LOG = [
    { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", 1761090000, 1, 0, false, 300) },
    { ea_match_id: "m2", status: "unmatched", game_id: null, et_day: "2026-10-21", payload: rawSitting("m2", 1761093900, 2, 1, true, 420) },
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

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
