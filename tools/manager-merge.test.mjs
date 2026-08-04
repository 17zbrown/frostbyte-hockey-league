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
let EA_LINK = { T1: "111", T2: "222" };          // mutable: tests unlink sides
const eaTeams = () => [{ id: "T1", code: "BOS", ea_club_id: EA_LINK.T1 ?? null }, { id: "T2", code: "TOR", ea_club_id: EA_LINK.T2 ?? null }];
let EA_SEARCH = [];                                // what proclubs search returns
let EA_MATCHES = [];                               // what proclubs matches returns

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
const writes = { statDeletes: 0, statRows: [], gamePatches: [], logPatches: [], webhooks: [], teamPatches: [], logInserts: [] };
const reset = () => { writes.statDeletes = 0; writes.statRows = []; writes.gamePatches = []; writes.logPatches = []; writes.webhooks = []; writes.teamPatches = []; writes.logInserts = []; };

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  if (u.includes("/auth/v1/user")) return UID ? J({ id: UID }) : J({ error: "bad" }, 401);
  if (u.includes("/rest/v1/profiles?id=eq.")) {
    const id = decodeURIComponent(u.match(/id=eq\.([^&]+)/)[1]);
    return J(PROFILES[id] ? [PROFILES[id]] : []);
  }
  if (u.includes("proclubs.ea.com") && u.includes("clubs/search")) return J(EA_SEARCH);
  if (u.includes("proclubs.ea.com") && u.includes("clubs/matches")) return J(EA_MATCHES);
  if (u.includes("/rest/v1/games?id=eq.g1") && m === "GET") return J([GAME]);
  if (u.includes("/rest/v1/teams?id=in.")) return J(u.includes("owner_profile_id") ? SEATS : eaTeams());
  if (u.includes("/rest/v1/teams?id=eq.") && m === "GET") {
    const id = u.match(/id=eq\.([^&]+)/)[1];
    return J(eaTeams().filter((t) => t.id === id));
  }
  if (u.includes("/rest/v1/teams?ea_club_id=eq.") && m === "GET") {
    const cid = u.match(/ea_club_id=eq\.([^&]+)/)[1];
    const neq = (u.match(/id=neq\.([^&]+)/) || [])[1];
    return J(eaTeams().filter((t) => String(t.ea_club_id) === cid && t.id !== neq));
  }
  if (u.includes("/rest/v1/teams?id=eq.") && m === "PATCH") {
    const id = u.match(/id=eq\.([^&]+)/)[1], b = JSON.parse(opts.body);
    writes.teamPatches.push({ id, body: b });
    if (b.ea_club_id !== undefined) EA_LINK[id] = b.ea_club_id;
    return J(null);
  }
  if (u.includes("/rest/v1/ea_ingest_log") && m === "POST") {
    writes.logInserts.push({ prefer: (opts.headers || {}).Prefer, rows: JSON.parse(opts.body) });
    return J(null);
  }
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

console.log("\n— the live-EA fallback: search, link, fetch");
{
  EA_SEARCH = [{ clubId: 900111, name: "Chel Bruins", memberCount: 14 }, { clubId: 900999, name: "Chel Bruins Alumni", memberCount: 6 }];
  UID = "rando";
  A("search is gated like everything else", (await call({ leagueEaSearch: { gameId: "g1", clubName: "Chel" } })).statusCode === 401);
  UID = "bos-gm";
  const sr = JSON.parse((await call({ leagueEaSearch: { gameId: "g1", clubName: "Chel Bruins" } })).body);
  A("the manager can search EA by club name", sr.clubs && sr.clubs.length === 2 && sr.clubs[0].name === "Chel Bruins");

  reset(); EA_LINK = { T1: null, T2: null };
  const lk = JSON.parse((await call({ leagueEaLink: { gameId: "g1", clubId: "900111", clubName: "Chel Bruins" } })).body);
  A("a manager links their OWN club", lk.ok === true && lk.teamCode === "BOS" && EA_LINK.T1 === "900111");
  A("...and staff hear about the linkage", writes.webhooks.length === 1 && /Chel Bruins/.test(writes.webhooks[0].content));
  A("linking is idempotent for the same id", JSON.parse((await call({ leagueEaLink: { gameId: "g1", clubId: "900111" } })).body).ok === true);
  const relink = JSON.parse((await call({ leagueEaLink: { gameId: "g1", clubId: "900222" } })).body);
  A("re-pointing an established linkage is refused", /already linked to a different EA club/.test(relink.error || ""));
  UID = "tor-agm";
  const steal = JSON.parse((await call({ leagueEaLink: { gameId: "g1", clubId: "900111" } })).body);
  A("one EA club can't back two league clubs", /already linked to BOS/.test(steal.error || ""));

  reset(); UID = "bos-gm";
  EA_MATCHES = [rawSitting("mNew1", SAME_NIGHT, 1, 0, false, 300), rawSitting("mNew2", SAME_NIGHT_LATER, 2, 1, true, 420)];
  const fr = JSON.parse((await call({ leagueEaFetch: { gameId: "g1" } })).body);
  A("the fetch archives what EA returned", fr.ok === true && fr.fetched === 2 && writes.logInserts.length === 1);
  A("...WITHOUT clobbering rows the pipeline owns", /ignore-duplicates/.test(writes.logInserts[0].prefer));
  A("...stamped with who pulled them", writes.logInserts[0].rows.every((r2) => /BosGM/.test(r2.reason)));
  EA_LINK = { T1: null, T2: null };
  const nofetch = JSON.parse((await call({ leagueEaFetch: { gameId: "g1" } })).body);
  A("fetching with nothing linked points at the search step", /Link your club/.test(nofetch.error || ""));
}

console.log("\n— one linked side is enough: the opponent is derived, then proven");
{
  EA_LINK = { T1: "111", T2: null };               // TOR never linked
  LOG = twoSittings();
  UID = "bos-gm";
  const res = JSON.parse((await call({ leagueCandidates: { gameId: "g1" } })).body);
  A("candidates surface from one linked side", res.candidates.length === 2 && res.linked.home === true && res.linked.away === false);
  A("the opposing EA club is named on each sitting", res.candidates.every((c) => c.oppEaId === "222" && c.oppEaName === "Leafs EA"));
  A("scores still read home-first", res.candidates[1].homeScore === 2 && res.candidates[1].awayScore === 1);

  reset();
  const mg = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "m2"] } })).body);
  A("the one-sided merge succeeds", mg.ok === true && mg.score === "3-1", mg.error);
  A("the merge PROVES the opponent's EA club and links it", EA_LINK.T2 === "222" && writes.teamPatches.some((tp) => tp.id === "T2" && tp.body.ea_club_id === "222"));
  A("...and tells staff about the evidence linkage", writes.webhooks.some((w) => /linked by evidence/.test(w.content)));
  A("a merge clears any forfeit ruling", writes.gamePatches[0] && writes.gamePatches[0].forfeit_team_id === null);
}
{
  EA_LINK = { T1: "111", T2: null };
  /* the second sitting is against a DIFFERENT EA club — one game can't have two opponents */
  LOG = [
    { ea_match_id: "m1", status: "ingested", game_id: "g1", et_day: "2026-10-21", payload: rawSitting("m1", SAME_NIGHT, 1, 0, false, 300) },
    { ea_match_id: "mAlien", status: "unmatched", game_id: null, et_day: "2026-10-21",
      payload: (() => { const r2 = rawSitting("mAlien", SAME_NIGHT_LATER, 2, 1, false, 420);
        const c = r2.clubs["222"]; delete r2.clubs["222"]; r2.clubs["333"] = c;
        const p2 = r2.players["222"]; delete r2.players["222"]; r2.players["333"] = p2; return r2; })() },
  ];
  reset(); UID = "bos-gm";
  const mixed = JSON.parse((await call({ leagueMerge: { gameId: "g1", matchIds: ["m1", "mAlien"] } })).body);
  A("sittings against different opponents are refused", /different opponents/.test(mixed.error || ""), mixed.error);
  A("...and no linkage happened", EA_LINK.T2 === null && writes.teamPatches.length === 0);
  EA_LINK = { T1: "111", T2: "222" };
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
