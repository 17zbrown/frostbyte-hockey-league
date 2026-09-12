// CommonJS on purpose: netlify/functions/ingest-stats.js is a v1-style function that Netlify
// transpiles to CommonJS, and CommonJS cannot require() an ES module — the first deploy as .mjs
// 502'd every import. A .cjs file is loadable from CommonJS AND from Node ESM (the bot, the v2
// Netlify poller) with named imports, because Node's lexer reads the `exports.x =` lines below.
//
// The ONE definition of a fixture's game window — when a league game can legitimately have been
// played, and therefore the only time the EA auto-import may attach a box score to it — plus the
// one fact about EA's clock that the lag-out merge depends on.
//
// Imported by both score-poller lanes (bot/ea-poll.mjs on the VM, netlify/functions/ea-poll.js)
// and by the importer itself (netlify/functions/ingest-stats.js), so "during the designated game
// time window, for the scheduled matchup" is enforced from one rule:
//   1. the pollers ask EA only while a fixture's window (plus a short polling grace) contains now,
//      and only for the clubs in those fixtures;
//   2. everything EA returns for those clubs is forwarded — the importer is the authority, and the
//      archive it keeps (every payload, replayable by a commissioner) and the lag-out merge (which
//      needs each club's recent history) both depend on seeing the whole picture;
//   3. the importer files a box score ONLY on the fixture between exactly those two clubs whose
//      window contains the match's end time. A scrimmage between the same clubs earlier that day,
//      a rematch after the night, a Tuesday lobby before a Wednesday fixture, a game against a club
//      other than the scheduled opponent — refused, archived, and left for the fixture desk.
//
// The window is measured against the match END time, which is what EA stamps on a match:
//   opens  = puck drop − GAME_WINDOW_BEFORE_MS  (lobby codes go out at T-30, so a game that starts
//            the moment they land and runs fast can end a few minutes before its slot)
//   closes = puck drop + GAME_WINDOW_AFTER_MS   (a night that runs late: a lag-out replayed in full
//            under Rule 4.3, a slow first game pushing the 9:35 and 10:10 slots back, overtime)
// Anything later than that is the fixture desk's to judge, not the robot's.

const GAME_WINDOW_BEFORE_MS = 10 * 60_000;
const GAME_WINDOW_AFTER_MS = 3 * 3_600_000;

/* The pollers keep asking EA this long after a window closes. EA publishes a match a minute or
   two after the final horn and the pollers run every ~2 min (VM) / 5 min (Netlify), so a game that
   ended in the window's last minutes would otherwise never be fetched — and nothing retries. The
   grace is for FETCHING only; the importer still files nothing that ended after the window. */
const POLL_GRACE_MS = 15 * 60_000;

/* EA's `toiseconds` runs on the DISPLAYED clock: three 20-minute periods = 3600 for a player who
   never left the ice in a full regulation game, more with overtime (4014 seen), less when the
   game ended early — a disconnection or a quit. Measured on real payloads (2026-09-11: 30 of 36
   archived lines read exactly 3600; the one overtime game 4014). The league's four-minute real
   periods (Rule 4.3 P4) do NOT change this: EA reports the game clock, not wall time. */
const FULL_GAME_CLOCK_S = 3600;

const ms = (t) => (typeof t === "number" ? t : Date.parse(t));

/** {opens, closes} in epoch ms for a fixture's scheduled_at (ISO string or ms). */
function fixtureWindow(scheduledAt, before = GAME_WINDOW_BEFORE_MS, after = GAME_WINDOW_AFTER_MS) {
  const t = ms(scheduledAt);
  return { opens: t - before, closes: t + after };
}

/** Does a match that ENDED at matchEndMs fall inside this fixture's window? Unknown end = no. */
function matchInWindow(matchEndMs, scheduledAt, before, after) {
  if (!Number.isFinite(matchEndMs) || matchEndMs <= 0) return false;
  const w = fixtureWindow(scheduledAt, before, after);
  return matchEndMs >= w.opens && matchEndMs <= w.closes;
}

/** PostgREST filter selecting fixtures whose window contains `nowMs`:
 *  scheduled_at ∈ [now − after, now + before]. Append to a games query. Pollers pass
 *  after = GAME_WINDOW_AFTER_MS + POLL_GRACE_MS so they keep fetching through the grace. */
function openFixtureFilter(nowMs, before = GAME_WINDOW_BEFORE_MS, after = GAME_WINDOW_AFTER_MS) {
  const from = new Date(nowMs - after).toISOString(), to = new Date(nowMs + before).toISOString();
  return `scheduled_at=gte.${encodeURIComponent(from)}&scheduled_at=lte.${encodeURIComponent(to)}`;
}

/** The fixture (from `fixtures`, each {id?, home_team_id, away_team_id, scheduled_at}) that a
 *  match between teams a and b, ending at matchEndMs, belongs to — the EARLIEST one whose window
 *  contains the end time. Matches arrive oldest first, and claimed fixtures leave the open list,
 *  so a playoff night that plays the same two clubs twice (2-2-3, Rule 8.3) files each box score
 *  on the slot it was played in. Null when none fits.
 *  `siblings` (default: `fixtures`) is the pair's whole night, claimed slots included: a series
 *  that runs ahead of the clock can finish game two before slot two's own window opens, so a
 *  later sibling's window opens no later than the previous sibling's puck drop. The earliest-open
 *  rule still files game one on slot one; only a claimed slot one lets game two reach slot two. */
function fixtureForMatch(fixtures, teamA, teamB, matchEndMs, before, after, siblings) {
  const pair = (g) => (g.home_team_id === teamA && g.away_team_id === teamB) || (g.home_team_id === teamB && g.away_team_id === teamA);
  const byTime = (x, y) => ms(x.scheduled_at) - ms(y.scheduled_at);
  const all = (siblings || fixtures || []).filter(pair).sort(byTime);
  const same = (x, g) => x === g || (x.id != null && g.id != null && x.id === g.id);
  return (fixtures || []).filter(pair).sort(byTime).filter((g) => {
    const i = all.findIndex((x) => same(x, g));
    const prev = i > 0 ? all[i - 1] : null;
    const b = prev && ms(g.scheduled_at) - ms(prev.scheduled_at) < 6 * 3_600_000
      ? Math.max(before ?? GAME_WINDOW_BEFORE_MS, ms(g.scheduled_at) - ms(prev.scheduled_at)) : before;
    return matchInWindow(matchEndMs, g.scheduled_at, b, after);
  })[0] || null;
}

/** Human wording for messages and tooltips. */
function describeWindow(before = GAME_WINDOW_BEFORE_MS, after = GAME_WINDOW_AFTER_MS) {
  const span = (v) => { const m = Math.round(v / 60_000); return m % 60 === 0 && m >= 60 ? m / 60 + " h" : m + " min"; };
  return `${span(before)} before puck drop to ${span(after)} after`;
}

exports.GAME_WINDOW_BEFORE_MS = GAME_WINDOW_BEFORE_MS;
exports.GAME_WINDOW_AFTER_MS = GAME_WINDOW_AFTER_MS;
exports.POLL_GRACE_MS = POLL_GRACE_MS;
exports.FULL_GAME_CLOCK_S = FULL_GAME_CLOCK_S;
exports.fixtureWindow = fixtureWindow;
exports.matchInWindow = matchInWindow;
exports.openFixtureFilter = openFixtureFilter;
exports.fixtureForMatch = fixtureForMatch;
exports.describeWindow = describeWindow;
