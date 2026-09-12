// The game window — "only during the designated game time window, only for the scheduled
// matchup" — enforced by shared/game-window.mjs and the importer. Run: node tools/game-window.test.mjs
//
// What must never break: a box score attaches ONLY to an open fixture between exactly its two
// clubs whose window (puck drop − 10 min … + 3 h) holds the match's END time. A scrimmage that
// afternoon, a rematch after the night, a Tuesday lobby before a Wednesday fixture, a match
// between two league clubs that are not scheduled against each other — all refused. A playoff
// night that plays the same clubs twice files each match on the slot it was played in; a
// disconnected game's replay (Rule 4.3 — full length, or one period) is merged into the sitting it
// continues rather than filed as the next game; a COMPLETE game is never resumed. EA's clock is
// the displayed one (3600 for a full game), and the tests use it.
// The real importer runs here against a stubbed Supabase; nothing touches the network.
import { fixtureWindow, matchInWindow, openFixtureFilter, fixtureForMatch, describeWindow,
  GAME_WINDOW_BEFORE_MS, GAME_WINDOW_AFTER_MS, POLL_GRACE_MS, FULL_GAME_CLOCK_S } from "../shared/game-window.mjs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const ms = (s) => Date.parse(s);
const MIN = 60_000, H = 3_600_000;

console.log("— shared/game-window.mjs: one definition");
{
  const puck = "2026-10-21T21:00:00-04:00";              // Wed Oct 21, 9:00 PM ET
  const w = fixtureWindow(puck);
  A("the window opens 10 minutes before puck drop", w.opens === ms(puck) - 10 * MIN);
  A("...and closes three hours after", w.closes === ms(puck) + 3 * H);
  A("the constants say the same", GAME_WINDOW_BEFORE_MS === 10 * MIN && GAME_WINDOW_AFTER_MS === 3 * H && POLL_GRACE_MS === 15 * MIN);
  A("EA's clock: a full game reads 3600 (three displayed 20-minute periods)", FULL_GAME_CLOCK_S === 3600);
  A("a match ending 40 minutes after puck drop is in", matchInWindow(ms(puck) + 40 * MIN, puck));
  A("a match ending 5 minutes before puck drop is in (codes go out at T-30)", matchInWindow(ms(puck) - 5 * MIN, puck));
  A("a match ending 11 minutes before is out", !matchInWindow(ms(puck) - 11 * MIN, puck));
  A("a match ending 3 h 1 min after is out", !matchInWindow(ms(puck) + 181 * MIN, puck));
  A("an unknown end time is never in", !matchInWindow(0, puck) && !matchInWindow(NaN, puck));
  A("the open-fixture filter selects fixtures whose window holds now",
    openFixtureFilter(ms(puck) + 30 * MIN) === `scheduled_at=gte.${encodeURIComponent(new Date(ms(puck) + 30 * MIN - 3 * H).toISOString())}&scheduled_at=lte.${encodeURIComponent(new Date(ms(puck) + 30 * MIN + 10 * MIN).toISOString())}`);
  A("...and with the polling grace it keeps a just-closed window in reach (a match ending at the buzzer is still fetched)",
    openFixtureFilter(ms(puck) + 3 * H + 5 * MIN, GAME_WINDOW_BEFORE_MS, GAME_WINDOW_AFTER_MS + POLL_GRACE_MS).includes(encodeURIComponent(new Date(ms(puck) - 10 * MIN).toISOString())));
  A("the description reads as a human sentence", describeWindow() === "10 min before puck drop to 3 h after", describeWindow());
  A("...on both sides, in the same units", describeWindow(86400000, 86400000) === "24 h before puck drop to 24 h after", describeWindow(86400000, 86400000));

  const fx = [
    { id: "g935", home_team_id: "A", away_team_id: "B", scheduled_at: "2026-10-21T21:35:00-04:00" },
    { id: "g900", home_team_id: "B", away_team_id: "A", scheduled_at: "2026-10-21T21:00:00-04:00" },
    { id: "other", home_team_id: "A", away_team_id: "C", scheduled_at: "2026-10-21T21:00:00-04:00" },
  ];
  A("fixtureForMatch takes the EARLIEST open fixture in window for the pair, either home/away order",
    fixtureForMatch(fx, "A", "B", ms(puck) + 40 * MIN).id === "g900");
  A("...and the later slot once the earlier one is claimed", fixtureForMatch(fx.filter((g) => g.id !== "g900"), "A", "B", ms(puck) + 40 * MIN).id === "g935");
  A("...never a fixture against a different opponent", fixtureForMatch(fx, "A", "C", ms(puck) + 40 * MIN).id === "other" && fixtureForMatch(fx, "B", "C", ms(puck) + 40 * MIN) === null);
  A("...and nothing when the end time is outside every window", fixtureForMatch(fx, "A", "B", ms(puck) - 4 * H) === null);
}

/* ---- the real importer against a stubbed Supabase ---- */
process.env.SUPABASE_URL = "https://sb.invalid"; process.env.SUPABASE_SERVICE_ROLE_KEY = "svc"; process.env.INGEST_KEY = "ingest";
const { ingestOne, normalizeMatch } = await import("../netlify/functions/ingest-stats.js");

const TEAMS = [{ id: "tA", ea_club_id: 111 }, { id: "tB", ea_club_id: 222 }, { id: "tC", ea_club_id: 333 }];
const world = { open: [], finals: [], logs: [] };
let seenLog = false;   // does ea_ingest_log already hold the match? (drives archive-vs-touch)
const writes = { gamePatches: [], statPosts: [], logPosts: [], logPatches: [] };
const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
const NIL = () => new Response(null, { status: 204 });
const pairOf = (u) => { const m = u.match(/home_team_id\.eq\.([^,)]+),away_team_id\.eq\.([^,)]+)/); return m ? [m[1], m[2]] : null; };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  if (u.includes("proclubs.ea.com")) throw new Error("the importer must never call EA in this test");
  if (u.includes("/rest/v1/games?ea_match_id=eq.")) return J([]);                 // never seen before
  const pairRows = (rows, u) => { const p = pairOf(u); return rows.filter((g) => p && ((g.home_team_id === p[0] && g.away_team_id === p[1]) || (g.home_team_id === p[1] && g.away_team_id === p[0]))); };
  if (u.includes("/rest/v1/games?") && u.includes("status=eq.final")) {
    /* the resume-candidate query: finals only, never ruled or voided */
    return J(pairRows(world.finals, u).filter((g) => !g.voided && g.forfeit_team_id == null).map((g) => ({ ...g, status: "final" })));
  }
  if (u.includes("/rest/v1/games?") && u.includes("scheduled_at=gte.")) {
    /* the pair's whole night, every status — the importer sorts open from claimed itself */
    const open = pairRows(world.open, u).map((g) => ({ status: "scheduled", ea_match_id: null, voided: false, forfeit_team_id: null, ...g }));
    const fin = pairRows(world.finals, u).map((g) => ({ status: "final", voided: false, forfeit_team_id: null, ...g }));
    return J(open.concat(fin));
  }
  if (u.includes("/rest/v1/games?id=eq.") && m === "PATCH") { writes.gamePatches.push({ url: u, body: JSON.parse(opts.body) }); return NIL(); }
  if (u.includes("/rest/v1/teams?ea_club_id=in.")) {
    const ids = decodeURIComponent(u.match(/in\.\(([^)]+)\)/)[1]).split(",");
    return J(TEAMS.filter((t) => ids.includes(String(t.ea_club_id))));
  }
  if (u.includes("/rest/v1/teams?id=in.")) { const ids = decodeURIComponent(u.match(/in\.\(([^)]+)\)/)[1]).split(","); return J(TEAMS.filter((t) => ids.includes(t.id)).map((t) => ({ ...t, name: t.id, code: t.id }))); }
  if (u.includes("/rest/v1/ea_ingest_log?ea_match_id=eq.") && u.includes("status=eq.merged")) return J([]);
  if (u.includes("/rest/v1/ea_ingest_log?ea_match_id=eq.") && u.includes("select=status")) return J(seenLog ? [{ status: "unmatched" }] : []);
  if (u.includes("/rest/v1/ea_ingest_log?or=")) return J(world.logs);
  if (u.includes("/rest/v1/ea_ingest_log") && m === "POST") { writes.logPosts.push(JSON.parse(opts.body)); return NIL(); }
  if (u.includes("/rest/v1/ea_ingest_log") && m === "PATCH") { writes.logPatches.push(JSON.parse(opts.body)); return NIL(); }
  if (u.includes("/rest/v1/game_stats?ea_player_id=")) return J([]);
  if (u.includes("/rest/v1/game_stats") && m === "DELETE") return NIL();
  if (u.includes("/rest/v1/game_stats") && m === "POST") { writes.statPosts.push(JSON.parse(opts.body)); return NIL(); }
  if (u.includes("/rest/v1/profiles?")) return J([]);
  if (u.includes("/rest/v1/season_registrations?")) return J([]);
  if (u.includes("/rest/v1/notifications") && (m === "DELETE" || m === "POST")) return NIL();
  if (u.includes("/rest/v1/app_config")) return J([]);
  throw new Error("unexpected fetch " + m + " " + u);
};
const reset = () => { world.open = []; world.finals = []; world.logs = []; for (const k of Object.keys(writes)) writes[k].length = 0; };
const summary = () => ({ received: 1, ingested: [], skipped: [], unmatched: [], errors: [] });
/* an EA match between two clubs that ENDED at `end` (ISO) and ran `toi` seconds of game clock */
const ea = (id, end, home, away, toi = 3600, scores = [3, 2]) => ({ matchId: id, timestamp: Math.floor(ms(end) / 1000),
  clubs: { [home]: { score: scores[0], details: { name: "H" } }, [away]: { score: scores[1], details: { name: "A" } } },
  players: { [home]: { p1: { playername: "HomeGuy", position: "center", skgoals: String(scores[0]), toiseconds: String(toi) } },
             [away]: { p2: { playername: "AwayGuy", position: "goalie", glsaves: "5", glshots: String(5 + scores[0]), glga: String(scores[0]), toiseconds: String(toi) } } } });
const run = async (raw, opts) => { const s = summary(); await ingestOne(normalizeMatch(raw), raw, s, [normalizeMatch(raw)], opts); return s; };
const PUCK = "2026-10-21T21:00:00-04:00";
const G900 = { id: "g900", season_id: "s1", home_team_id: "tA", away_team_id: "tB", scheduled_at: PUCK };
const G935 = { id: "g935", season_id: "s1", home_team_id: "tA", away_team_id: "tB", scheduled_at: "2026-10-21T21:35:00-04:00" };
const at = (minsAfter) => new Date(ms(PUCK) + minsAfter * MIN).toISOString();

console.log("— the scheduled matchup, inside its window: filed");
{
  reset(); world.open = [G900];
  const s = await run(ea("m1", at(38), 111, 222));
  A("ingested onto the fixture", s.ingested.length === 1 && s.ingested[0].game_id === "g900", JSON.stringify(s));
  A("the game is marked final with the EA score", writes.gamePatches.some((p) => p.url.includes("id=eq.g900") && p.body.status === "final" && p.body.home_score === 3 && p.body.away_score === 2 && p.body.ea_match_id === "m1"));
  A("nothing unmatched", s.unmatched.length === 0);
}

console.log("— the same two clubs, outside the window: refused, nothing written");
for (const [label, end] of [["a scrimmage four hours before puck drop", at(-240)], ["a lobby ending 11 minutes before", at(-11)],
                            ["a rematch 3 h 1 min after puck drop", at(181)], ["the night before", "2026-10-20T21:40:00-04:00"], ["the next afternoon", "2026-10-22T15:00:00-04:00"]]) {
  reset(); world.open = [G900];
  const s = await run(ea("mx", end, 111, 222));
  A(`${label}: unmatched, naming the window`, s.ingested.length === 0 && s.unmatched.length === 1 && /game window/.test(s.unmatched[0].reason), s.unmatched[0] && s.unmatched[0].reason);
  A(`${label}: no game row touched`, writes.gamePatches.length === 0 && writes.statPosts.length === 0);
  A(`${label}: the attempt is archived as unmatched for the fixture desk`, writes.logPosts.some((r) => (Array.isArray(r) ? r[0] : r).status === "unmatched"));
}

console.log("— two league clubs that are NOT scheduled against each other: archived as a scrimmage, not staff work");
{
  reset(); world.open = [G900];                                            // tA vs tB is tonight's fixture
  const s = await run(ea("m2", at(40), 111, 333));                         // tA vs tC is not
  A("skipped — not a scheduled matchup", s.ingested.length === 0 && s.unmatched.length === 0 && s.skipped.length === 1 && /not a scheduled matchup/.test(s.skipped[0].reason), JSON.stringify(s));
  A("...archived with status ignored (replayable, never flagged for staff)", writes.logPosts.some((r) => (Array.isArray(r) ? r[0] : r).status === "ignored"));
  A("the tA–tB fixture is untouched", writes.gamePatches.length === 0);
}

console.log("— a match with no end time is never guessed onto a fixture");
{
  reset(); world.open = [G900];
  const raw = ea("m3", at(40), 111, 222); raw.timestamp = 0;
  const s = await run(raw);
  A("unmatched, for the desk", s.ingested.length === 0 && s.unmatched.length === 1 && /no end time/.test(s.unmatched[0].reason), s.unmatched[0] && s.unmatched[0].reason);
}

console.log("— a playoff night plays the same clubs twice (2-2-3): each match files on its own slot");
{
  reset(); world.open = [G935, G900];                                       // deliberately out of order
  const s1 = await run(ea("p1", at(40), 111, 222));                         // game one ends 9:40
  A("the first full game files on the 9:00 slot, not the 9:35 one", s1.ingested[0] && s1.ingested[0].game_id === "g900", JSON.stringify(s1));
  world.open = [G935];                                                      // the 9:00 slot is now claimed
  const s2 = await run(ea("p2", at(78), 111, 222));                         // game two ends 10:18
  A("the second files on the 9:35 slot", s2.ingested[0] && s2.ingested[0].game_id === "g935", JSON.stringify(s2));
}

console.log("— Rule 4.3: a disconnected game's full-length replay is merged into its abandoned sitting (a regular-season night: no sibling slot competes)");
{
  reset();
  const first = ea("p1", at(20), 111, 222, 1500, [1, 0]);                   // game one abandoned at 1500 of 3600 on the clock
  world.finals = [{ ...G900, ea_match_id: "p1" }];
  world.logs = [{ ea_match_id: "p1", payload: first }];
  const replay = ea("p1b", at(55), 111, 222, 3600, [2, 1]);                 // the whole game replayed, per Rule 4.3 P1
  const s = await run(replay);
  A("merged into the 9:00 game", s.ingested.length === 1 && s.ingested[0].resumed === true && s.ingested[0].game_id === "g900", JSON.stringify(s));
  A("the 9:00 game carries the combined score (everything earned in the abandoned sitting counts, 4.3 P0)", writes.gamePatches.some((p) => p.url.includes("id=eq.g900") && p.body.home_score === 3 && p.body.away_score === 1));
  A("the merge is archived as merged", writes.logPosts.some((r) => (Array.isArray(r) ? r[0] : r).status === "merged"));
}

console.log("— ...and a single-period replay (drop early in the third, 4.3 P5) merges the same way");
{
  reset();
  const first = ea("p3", at(25), 111, 222, 2500, [2, 2]);
  world.finals = [{ ...G900, ea_match_id: "p3" }];
  world.logs = [{ ea_match_id: "p3", payload: first }];
  const s = await run(ea("p3b", at(45), 111, 222, 1200, [1, 0]));
  A("merged into the 9:00 game, combined 3-2", s.ingested.length === 1 && s.ingested[0].resumed === true && writes.gamePatches.some((p) => p.url.includes("id=eq.g900") && p.body.home_score === 3 && p.body.away_score === 2), JSON.stringify(s));
}

console.log("— a COMPLETE game is never resumed: on a playoff night, game two's short first sitting files on game two's slot");
{
  reset();
  const first = ea("c1", at(30), 111, 222, 3600, [4, 2]);                   // game one complete
  world.finals = [{ ...G900, ea_match_id: "c1" }];
  world.logs = [{ ea_match_id: "c1", payload: first }];
  world.open = [G935];
  const s = await run(ea("c2", at(50), 111, 222, 900, [0, 1]));            // game two, abandoned early
  A("filed on the 9:35 slot, not merged into the finished game", s.ingested.length === 1 && s.ingested[0].game_id === "g935" && !s.ingested[0].resumed, JSON.stringify(s));
  A("the finished game's score is untouched", !writes.gamePatches.some((p) => p.url.includes("id=eq.g900")));
  reset();
  const ot = ea("o1", at(35), 111, 222, 4014, [3, 2]);                      // game one complete in overtime
  world.finals = [{ ...G900, ea_match_id: "o1" }];
  world.logs = [{ ea_match_id: "o1", payload: ot }];
  world.open = [G935];
  const s2 = await run(ea("o2", at(60), 111, 222, 3600, [1, 0]));
  A("an overtime game is complete too: the next full game files on the next slot", s2.ingested.length === 1 && s2.ingested[0].game_id === "g935" && !s2.ingested[0].resumed, JSON.stringify(s2));
}

console.log("— with no open sibling, a rematch after a COMPLETE game is refused for staff, not merged");
{
  reset();
  world.finals = [{ ...G900, ea_match_id: "d1" }];
  world.logs = [{ ea_match_id: "d1", payload: ea("d1", at(30), 111, 222, 3600, [2, 1]) }];
  const s = await run(ea("d2", at(75), 111, 222, 3600, [5, 5]));
  A("unmatched, naming the window rule", s.ingested.length === 0 && s.unmatched.length === 1 && /game window/.test(s.unmatched[0].reason), s.unmatched[0] && s.unmatched[0].reason);
  A("nothing written", writes.gamePatches.length === 0);
}

console.log("— a forfeit-ruled game between the same clubs is never a resume target (Rule 4.3 P7: the ruling stands)");
{
  reset();
  world.finals = [{ ...G900, ea_match_id: "f1", forfeit_team_id: "tB" }];   // ruled FFL with its sittings kept
  world.logs = [{ ea_match_id: "f1", payload: ea("f1", at(20), 111, 222, 1500, [2, 1]) }];
  world.open = [G935];
  const s = await run(ea("f2", at(60), 111, 222, 3600, [0, 5]));
  A("the next full game files on the open slot; the ruled game is untouched", s.ingested.length === 1 && s.ingested[0].game_id === "g935" && !writes.gamePatches.some((p) => p.url.includes("id=eq.g900")), JSON.stringify(s));
}

console.log("— an UNFINISHED first game and an open sibling slot both fit: nobody can tell a replay from game two, so staff decide");
{
  reset();
  world.finals = [{ ...G900, ea_match_id: "u1" }];
  world.logs = [{ ea_match_id: "u1", payload: ea("u1", at(12), 111, 222, 2000, [5, 0]) }];   // a quit at 2000? a lag-out? EA cannot say
  world.open = [G935];
  const s = await run(ea("u2", at(45), 111, 222, 3600, [2, 3]));
  A("neither merged nor filed — unmatched for the statistics desk, naming both candidates",
    s.ingested.length === 0 && s.unmatched.length === 1 && /could be the Rule 4\.3 replay/.test(s.unmatched[0].reason) && /9:35 PM/.test(s.unmatched[0].reason), s.unmatched[0] && s.unmatched[0].reason);
  A("nothing written to either game", writes.gamePatches.length === 0);
  A("...archived as unmatched (the staff desk counts those)", writes.logPosts.some((r) => (Array.isArray(r) ? r[0] : r).status === "unmatched"));
}

console.log("— a series that runs ahead of the clock: game two ending before slot two's own window opens still files on slot two");
{
  reset();
  world.finals = [{ ...G900, ea_match_id: "a1" }];                        // game one already filed (complete)
  world.logs = [{ ea_match_id: "a1", payload: ea("a1", at(14), 111, 222, 3600, [1, 0]) }];
  world.open = [G935];
  const s = await run(ea("a2", at(22), 111, 222, 3600, [2, 2]));           // ends 9:22, before 9:25
  A("filed on the 9:35 slot (its window opened at the previous sibling's puck drop)", s.ingested.length === 1 && s.ingested[0].game_id === "g935" && !s.ingested[0].resumed, JSON.stringify(s));
}

console.log("— refusals are archived once, then only touched (EA re-serves the same matches every poll)");
{
  reset(); world.open = [G900];
  const raw = ea("t1", at(-240), 111, 222);
  await run(raw);
  const firstPosts = writes.logPosts.length;
  seenLog = true; await run(raw); seenLog = false;
  A("the second sighting is a status touch, not a payload upload", writes.logPosts.length === firstPosts && writes.logPatches.length === 1, `posts=${writes.logPosts.length} patches=${writes.logPatches.length}`);
}

console.log("— the commissioner's re-ingest is deliberately relaxed to a day either side");
{
  reset(); world.open = [G900];
  const s = await run(ea("r1", "2026-10-22T15:00:00-04:00", 111, 222), { relaxed: true });
  A("a payload the robot refused can be replayed onto the fixture", s.ingested.length === 1 && s.ingested[0].game_id === "g900", JSON.stringify(s));
  reset(); world.open = [G900];
  const s2 = await run(ea("r2", "2026-10-24T15:00:00-04:00", 111, 222), { relaxed: true });
  A("...but not from three days away", s2.ingested.length === 0 && s2.unmatched.length === 1);
  reset();
  const THU = { id: "gthu", season_id: "s1", home_team_id: "tA", away_team_id: "tB", scheduled_at: "2026-10-22T21:00:00-04:00" };
  world.open = [G900, THU];                                                // Wednesday's slot still open, Thursday's too
  const s3 = await run(ea("r3", "2026-10-23T00:05:00-04:00", 111, 222), { relaxed: true });   // Thursday's game, 3 h 5 min after its puck drop
  A("relaxed picks the NEAREST fixture, so Thursday's box score never lands on Wednesday's open slot", s3.ingested.length === 1 && s3.ingested[0].game_id === "gthu", JSON.stringify(s3));
}

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
