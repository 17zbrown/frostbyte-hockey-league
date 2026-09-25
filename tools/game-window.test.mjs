// The game window — "only during the designated game time window, only for the scheduled
// matchup" — enforced by shared/game-window.cjs and the importer. Run: node tools/game-window.test.mjs
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
  GAME_WINDOW_BEFORE_MS, GAME_WINDOW_AFTER_MS, POLL_GRACE_MS, FULL_GAME_CLOCK_S } from "../shared/game-window.cjs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const ms = (s) => Date.parse(s);
const MIN = 60_000, H = 3_600_000;

console.log("— shared/game-window.cjs: one definition");
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
let seenLog = false;   // does ea_ingest_log already hold the match's payload? (drives archive-vs-touch)
const writes = { gamePatches: [], statPosts: [], logPosts: [], logPatches: [] };
const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
const NIL = () => new Response(null, { status: 204 });
const pairOf = (u) => { const m = u.match(/home_team_id\.eq\.([^,)]+),away_team_id\.eq\.([^,)]+)/); return m ? [m[1], m[2]] : null; };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  if (u.includes("proclubs.ea.com")) throw new Error("the importer must never call EA in this test");
  /* the batch context: one prefetch each for games.ea_match_id and the archive (rows WITH a payload) */
  if (u.includes("/rest/v1/games?ea_match_id=in.")) return J([]);                 // never filed before
  if (u.includes("/rest/v1/ea_ingest_log?ea_match_id=in.") && u.includes("payload=not.is.null")) {
    const ids = decodeURIComponent(u.match(/in\.\(([^)]+)\)/)[1]).split(",");
    return J(seenLog ? ids.map((id) => ({ ea_match_id: id, status: "unmatched", game_id: null })) : []);
  }
  const pairRows = (rows, u) => { const p = pairOf(u); return rows.filter((g) => p && ((g.home_team_id === p[0] && g.away_team_id === p[1]) || (g.home_team_id === p[1] && g.away_team_id === p[0]))); };
  if (u.includes("/rest/v1/games?") && u.includes("status=in.(final,scheduled)")) {
    /* v3.18 — the resume-candidate query takes HELD games as well as finals. A first sitting that
       fell short leaves the game 'scheduled' but carrying its ea_match_id, and that is exactly
       what a continuation belongs to. Never a ruled or voided game. */
    const fin = pairRows(world.finals, u).filter((g) => !g.voided && g.forfeit_team_id == null)
      .map((g) => ({ ...g, status: "final" }));
    const held = pairRows(world.held || [], u).map((g) => ({ ...g, status: "scheduled" }));
    return J(fin.concat(held));
  }
  if (u.includes("/rest/v1/games?or=(home_team_id.eq.") && !u.includes(",away_team_id.eq.") === false && /or=\(home_team_id\.eq\.(\w+),away_team_id\.eq\.\1\)/.test(u)) {
    /* the known-club-only query (one linked side): its fixtures whose window holds the match */
    const t = u.match(/home_team_id\.eq\.(\w+)/)[1];
    const from = Date.parse(decodeURIComponent(u.match(/scheduled_at=gte\.([^&]+)/)[1])), to = Date.parse(decodeURIComponent(u.match(/scheduled_at=lte\.([^&]+)/)[1]));
    return J(((world.clubOnly || {})[t] || []).filter((g) => ms(g.scheduled_at) >= from && ms(g.scheduled_at) <= to));
  }
  if (u.includes("/rest/v1/games?") && u.includes("scheduled_at=gte.")) {
    /* the pair's whole night, every status — the importer sorts open from claimed itself */
    const open = pairRows(world.open, u).map((g) => ({ status: "scheduled", ea_match_id: null, voided: false, forfeit_team_id: null, ...g }));
    const fin = pairRows(world.finals, u).map((g) => ({ status: "final", voided: false, forfeit_team_id: null, ...g }));
    return J(open.concat(fin));
  }
  if (u.includes("/rest/v1/games?id=eq.") && m === "PATCH") { writes.gamePatches.push({ url: u, body: JSON.parse(opts.body) }); return NIL(); }
  /* v3.20 Rule 4.6 — a club that borrowed an outside EASHL club for ONE fixture. Answering [] by
     default is what keeps every other case in this file honest: the substitution must be the only
     thing that changes behavior. */
  if (u.includes("/rest/v1/game_club_substitutions?ea_club_id=in.")) {
    const ids = decodeURIComponent(u.match(/in\.\(([^)]+)\)/)[1]).split(",");
    return J((world.subs || []).filter((x) => ids.includes(String(x.ea_club_id))));
  }
  if (u.includes("/rest/v1/games?id=in.")) {
    const ids = decodeURIComponent(u.match(/in\.\(([^)]+)\)/)[1]).split(",");
    return J(world.open.concat(world.finals, world.held || []).filter((g) => ids.includes(g.id))
      .map((g) => ({ id: g.id, scheduled_at: g.scheduled_at })));
  }
  if (u.includes("/rest/v1/teams?ea_club_id=in.")) {
    const ids = decodeURIComponent(u.match(/in\.\(([^)]+)\)/)[1]).split(",");
    return J(TEAMS.filter((t) => ids.includes(String(t.ea_club_id))));
  }
  if (u.includes("/rest/v1/teams?id=in.")) { const ids = decodeURIComponent(u.match(/in\.\(([^)]+)\)/)[1]).split(","); return J(TEAMS.filter((t) => ids.includes(t.id)).map((t) => ({ ...t, name: t.id, code: t.id }))); }
  if (u.includes("/rest/v1/ea_ingest_log?or=")) return J(world.logs);
  if (u.includes("/rest/v1/ea_ingest_log") && m === "POST") { writes.logPosts.push(JSON.parse(opts.body)); return NIL(); }
  if (u.includes("/rest/v1/ea_ingest_log") && m === "PATCH") {
    const body = JSON.parse(opts.body);
    writes.logPatches.push(body);
    /* v3.08 — the status touch now asks for the row back, because an UPDATE that matches nothing
       returns 200 and an empty array with no error. A 204 here would model a PostgREST that was
       never asked for a representation, and would read to the importer as "no such row". */
    const id = decodeURIComponent((u.match(/ea_match_id=eq\.([^&]+)/) || [])[1] || "");
    return J([{ ea_match_id: id, ...body }]);
  }
  if (u.includes("/rest/v1/game_stats?ea_player_id=in.")) return J([]);          // the roster's prior links, one query
  if (u.includes("/rest/v1/game_stats") && m === "DELETE") return NIL();
  if (u.includes("/rest/v1/game_stats") && m === "POST") { writes.statPosts.push(JSON.parse(opts.body)); return NIL(); }
  /* v3.08 — Rule 6.3 withdrawals, read once per game before the rows are filed */
  if (u.includes("/rest/v1/stat_credit_withdrawals?")) {
    const g = (u.match(/game_id=eq\.([^&]+)/) || [])[1];
    return J((world.withdrawals || []).filter((w) => w.game_id === g).map((w) => ({ ea_player_id: w.ea_player_id })));
  }
  /* only the PERSONA lookup answers, so each EA player resolves to his own profile or to nobody;
     answering every profiles query with the same list would link all three to one member */
  if (u.includes("/rest/v1/profiles?ea_player_id=in.") && m === "GET") {
    const ids = decodeURIComponent(u.match(/in\.\(([^)]+)\)/)[1]).split(",");
    return J((world.profiles || []).filter((pr) => ids.includes(String(pr.ea_player_id))));
  }
  if (u.includes("/rest/v1/profiles?") && m === "PATCH") return J([]);   // learnPersonas
  if (u.includes("/rest/v1/profiles?")) return J([]);
  if (u.includes("/rest/v1/season_registrations?")) return J([]);
  if (u.includes("/rest/v1/notifications") && (m === "DELETE" || m === "POST")) return NIL();
  if (u.includes("/rest/v1/app_config")) return J([]);
  throw new Error("unexpected fetch " + m + " " + u);
};
const reset = () => { world.open = []; world.finals = []; world.held = []; world.logs = []; world.clubOnly = {}; world.withdrawals = []; world.subs = []; world.profiles = []; for (const k of Object.keys(writes)) writes[k].length = 0; };
const summary = () => ({ received: 1, ingested: [], skipped: [], unmatched: [], errors: [] });
/* an EA match between two clubs that ENDED at `end` (ISO) and ran `toi` seconds of game clock */
const ea = (id, end, home, away, toi = 3600, scores = [3, 2]) => ({ matchId: id, timestamp: Math.floor(ms(end) / 1000),
  clubs: { [home]: { score: scores[0], details: { name: "H" } }, [away]: { score: scores[1], details: { name: "A" } } },
  /* v3.06: the away club needs a SKATER holding its goals. With only a goalie there, the club's
     `score` claimed goals no player had scored, which real EA data never does and which the
     importer no longer believes: the score is the sum of the players' goals now. */
  players: { [home]: { p1: { playername: "HomeGuy", position: "center", skgoals: String(scores[0]), toiseconds: String(toi) } },
             [away]: { p2: { playername: "AwayGuy", position: "goalie", glsaves: "5", glshots: String(5 + scores[0]), glga: String(scores[0]), toiseconds: String(toi) },
                       p3: { playername: "AwaySkater", position: "center", skgoals: String(scores[1]), toiseconds: String(toi) } } } });
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

console.log("— an unknown opponent: staff work only when the known club has a fixture in that window");
{
  reset(); world.open = [G900];                                            // tA plays tB at 9:00
  world.clubOnly = { tA: [G900] };
  const s1 = await run(ea("x1", at(30), 111, 999));                        // tA vs an EA club nobody linked, inside tA's window
  /* v3.20: the reason now offers BOTH answers. Telling staff only "link the EA id" is how a
     one-night substitution gets "fixed" by repointing a club's ea_club_id at somebody else's club
     permanently, which is the opposite of what happened. */
  A("inside the known club's window: unmatched, and staff are told both answers",
    s1.unmatched.length === 1 && /not a league club/.test(s1.unmatched[0].reason)
      && /link that club's EA id/.test(s1.unmatched[0].reason)
      && /record a club substitution/.test(s1.unmatched[0].reason)
      && /Rule 4\.6/.test(s1.unmatched[0].reason), JSON.stringify(s1));
  reset(); world.open = [G900]; world.clubOnly = { tA: [G900] };
  const s2 = await run(ea("x2", at(-300), 111, 999));                      // the same pair five hours before tA's game
  A("outside it: a scrimmage against an outside club — archived as ignored, not flagged", s2.skipped.length === 1 && s2.unmatched.length === 0 && writes.logPosts.some((r) => (Array.isArray(r) ? r[0] : r).status === "ignored"), JSON.stringify(s2));
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
  /* v3.08 — the merge's own archive row is a status TOUCH now (a PATCH), not an upsert. */
  A("the merge is archived as merged",
    writes.logPatches.some((r) => r.status === "merged") ||
    writes.logPosts.some((r) => (Array.isArray(r) ? r[0] : r).status === "merged"));
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
  /* v3.18 — the point of this block is unchanged: the short sitting belongs to game TWO's slot and
     must not be merged into the completed game one. What changed is that a 15-minute sitting is no
     longer filed as a RESULT; it is held on that slot until the rest of the game turns up. */
  A("lands on the 9:35 slot, not merged into the finished game",
    (s.held || []).length === 1 && s.held[0].game_id === "g935" && !s.ingested.length, JSON.stringify(s));
  A("...and no result was published for it",
    !writes.gamePatches.some((p) => p.url.includes("id=eq.g935") && p.body.status === "final"));
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
  const first = writes.logPosts[writes.logPosts.length - 1][0];
  A("the first sighting uploads the payload", writes.logPosts.length === 1 && first.payload && first.payload.matchId === "t1" && first.status === "unmatched");
  seenLog = true; await run(raw); seenLog = false;
  const touch = writes.logPatches[writes.logPatches.length - 1];
  A("the second sighting is a status touch, not a payload upload",
    writes.logPosts.length === 1 && writes.logPatches.length === 1 && !("payload" in touch) && touch.status === "unmatched",
    JSON.stringify(touch));
  /* v3.08 — this pin used to read "as an upsert keyed on the match id, never a PATCH", on the
     reasoning that a PATCH on a row that is not there affects nothing and says nothing. The
     upsert said nothing either, and worse: `payload` is NOT NULL, and Postgres checks NOT NULL
     against the proposed tuple BEFORE the ON CONFLICT arbiter can turn the insert into an update,
     so an upsert that omits payload dies 23502 on a row that exists. It had never once worked.
     The answer to "a write that says nothing" is not a different verb, it is to LOOK at what came
     back, which is what the touch does now. */
  A("...as a PATCH that asks for the row back, so a miss cannot read as success",
    writes.logPatches.length === 1 && writes.logPosts.length === 1);
}

console.log("— a sitting short of regulation is HELD, and the continuation finals it (SEA v PIT, Sep 24)");
{
  /* The real one: a 40-minute sitting arrived first and was filed as SEA 2 PIT 3, the score went
     out, and the 20-minute continuation corrected it to 4-3 twelve minutes later. The announced
     winner was wrong for those twelve minutes. */
  reset(); world.open = [G900];
  const first = ea("dnf1", at(38), 111, 222, 2400, [2, 3]);
  const s1 = await run(first);
  A("the short sitting is held, not filed", (s1.held || []).length === 1 && !s1.ingested.length, JSON.stringify(s1));
  A("...it says how much was played", /40 of 60 minutes played/.test(s1.held[0].reason), s1.held[0].reason);
  A("...the box score is still written", writes.statPosts.length === 1 && writes.statPosts[0].length > 0);
  A("...the fixture is claimed, so the same sitting is not reprocessed",
    writes.gamePatches.some((p) => p.url.includes("id=eq.g900") && p.body.ea_match_id === "dnf1"));
  A("...but NO result is published: no status, no score",
    !writes.gamePatches.some((p) => p.body.status !== undefined || p.body.home_score !== undefined));
  A("...and the archive says it is incomplete",
    writes.logPatches.concat(writes.logPosts.flat()).some((r) => r && r.status === "incomplete"));

  /* now the rest of the game arrives and finds the HELD fixture */
  reset(); world.held = [{ ...G900, ea_match_id: "dnf1" }];
  world.logs = [{ ea_match_id: "dnf1", payload: first }];
  const s2 = await run(ea("dnf2", at(58), 111, 222, 1200, [2, 0]));
  A("the continuation merges into the held game", s2.ingested.length === 1 && s2.ingested[0].resumed === true
    && s2.ingested[0].game_id === "g900", JSON.stringify(s2));
  A("...and only NOW is it final, with both sittings added up",
    writes.gamePatches.some((p) => p.url.includes("id=eq.g900") && p.body.status === "final"
      && p.body.home_score === 4 && p.body.away_score === 3), JSON.stringify(writes.gamePatches.map((p) => p.body)));
}

console.log("— Rule 6.3: a withdrawn credit survives the filing that would otherwise restore it");
{
  /* the whole point of the withdrawal record: every filing path DELETEs a game's lines and
     re-POSTs them, and the matcher WILL find the member again from his persona. Proved here by
     filing the same match twice: once linked, once withdrawn, with nothing else changed. */
  reset(); world.open = [G900]; world.profiles = [{ id: "pfHome", ea_player_id: "p1" }];
  await run(ea("w1", at(38), 111, 222));
  const linked = writes.statPosts[0].find((r) => r.ea_player_id === "p1");
  A("without a withdrawal the persona resolves to its member", linked && linked.profile_id === "pfHome", JSON.stringify(linked));

  reset(); world.open = [G900]; world.profiles = [{ id: "pfHome", ea_player_id: "p1" }];
  world.withdrawals = [{ game_id: "g900", ea_player_id: "p1" }];
  const s = await run(ea("w1", at(38), 111, 222));
  const rows = writes.statPosts[0];
  const off = rows.find((r) => r.ea_player_id === "p1");
  A("with one on record the line is filed to nobody", off && off.profile_id === null, JSON.stringify(off));
  A("...but the line itself is still filed, in full",
    off && off.goals === 3 && off.skater_name === "HomeGuy" && off.team_id === "tA", JSON.stringify(off));
  A("...the club keeps every one of its lines", rows.length === 3, String(rows.length));
  A("...the game still goes final with the same score",
    writes.gamePatches.some((pt) => pt.url.includes("id=eq.g900") && pt.body.status === "final" && pt.body.home_score === 3 && pt.body.away_score === 2));
  A("...and nobody else on the sheet is touched",
    rows.filter((r) => r.profile_id === null).length === 3 && s.ingested.length === 1);
  A("the summary counts him as unlinked, not as a missing player",
    s.ingested[0].players === 3 && s.ingested[0].linked === 0, JSON.stringify(s.ingested[0]));

  /* and it is scoped to the game it was recorded against */
  reset(); world.open = [G935]; world.profiles = [{ id: "pfHome", ea_player_id: "p1" }];
  world.withdrawals = [{ game_id: "g900", ea_player_id: "p1" }];
  await run(ea("w2", "2026-10-21T22:13:00-04:00", 111, 222));
  const other = writes.statPosts[0].find((r) => r.ea_player_id === "p1");
  A("a withdrawal on one game does not follow him to another", other && other.profile_id === "pfHome", JSON.stringify(other));
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

/* ============================================================================
 * v3.20 Rule 4.6 — a club that could not use its own EASHL club played one fixture under an
 * outside club. 2026-09-24: Vancouver played PIT v VAN as "LG ThunderBirds" (EA club 10200).
 * ========================================================================= */
console.log("\n— Rule 4.6: a borrowed club files on the ONE fixture its substitution names");
{
  reset(); world.open = [G900]; world.clubOnly = { tA: [G900] };
  world.subs = [{ game_id: "g900", ea_club_id: "999", team_id: "tB" }];
  const s1 = await run(ea("s1", at(30), 111, 999));
  A("the outside club is read as tB, and the game is filed",
    s1.ingested.length === 1 && s1.ingested[0].game_id === "g900", JSON.stringify(s1));
  A("...with the score on the right side",
    writes.gamePatches.some((w) => w.body.status === "final" && w.body.home_score === 3 && w.body.away_score === 2),
    JSON.stringify(writes.gamePatches.map((w) => w.body)));
  A("...and the box score rows carry tB, never the outside club",
    writes.statPosts.flat().some((r) => r.team_id === "tB") && !writes.statPosts.flat().some((r) => r.team_id === "999"));

  /* THE POINT OF THE PIN. The same outside club, the same two sides, a DIFFERENT open fixture in
     window. Without pinnedGames the borrowed club would be a permanent second identity for tB and
     this would file too. */
  reset(); world.open = [{ ...G900, id: "gOTHER" }]; world.clubOnly = { tA: [{ ...G900, id: "gOTHER" }] };
  world.subs = [{ game_id: "g900", ea_club_id: "999", team_id: "tB" }];
  const s2 = await run(ea("s2", at(30), 111, 999));
  A("a fixture the substitution does NOT name is refused", s2.ingested.length === 0, JSON.stringify(s2));
  A("...and no game row is touched", writes.gamePatches.length === 0);

  /* scoped by the fixture's own window too, so the club can be borrowed again another night */
  reset(); world.open = [G900]; world.clubOnly = { tA: [G900] };
  world.subs = [{ game_id: "g900", ea_club_id: "999", team_id: "tB" }];
  const s3 = await run(ea("s3", at(-300), 111, 999));
  A("a lobby five hours before the fixture is still not the league game", s3.ingested.length === 0, JSON.stringify(s3));

  /* two substitutions live in one window is nobody, the same rule as every other ambiguity here */
  reset(); world.open = [G900, { ...G900, id: "gTWIN" }]; world.clubOnly = { tA: [G900] };
  world.subs = [{ game_id: "g900", ea_club_id: "999", team_id: "tB" },
                { game_id: "gTWIN", ea_club_id: "999", team_id: "tB" }];
  const s4 = await run(ea("s4", at(30), 111, 999));
  A("two fixtures claiming the same borrowed club is refused, not guessed",
    s4.ingested.length === 0 && s4.unmatched.length + s4.skipped.length === 1, JSON.stringify(s4));

  /* and with NO substitution recorded, nothing changed */
  reset(); world.open = [G900]; world.clubOnly = { tA: [G900] };
  const s5 = await run(ea("s5", at(30), 111, 999));
  A("with no substitution on record the match is still refused", s5.ingested.length === 0, JSON.stringify(s5));
}

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
