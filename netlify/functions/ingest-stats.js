// Netlify Function: POST /api/ingest-stats  (redirected from netlify.toml)
// Receives raw EA Pro Clubs match objects (forwarded by the score pollers), files each on the
// fixture between exactly its two clubs whose GAME WINDOW (shared/game-window.cjs: puck drop
// − 10 min … + 3 h) contains the match's end time, and writes the final score + per-player box
// score into Supabase. Idempotent: a match whose id already lives on a game (games.ea_match_id)
// is skipped. Anything that fits no fixture is archived, never guessed onto one.
//
// Write order, every filing path: the EA payload is archived in ea_ingest_log BEFORE a single
// game_stats or games row is touched. EA serves each club's last few matches only, so a filed
// game whose payload was never archived (an invocation killed between the writes) could never be
// replayed, re-merged or audited. The archive row is the durable thing; the game rows are derived.
//
// Auth: the fetcher must send  x-ingest-key: <INGEST_KEY>  — OR the SUPABASE_SERVICE_ROLE_KEY,
// which the always-on VM poller (bot/ea-poll.mjs) already holds, so it needs no second secret.
// Either value is compared timing-safely; a missing header fails closed. Writes use the Supabase
// SERVICE ROLE key (bypasses RLS) — all of these are Netlify env vars, never in the browser.
//   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_KEY
// Node 18+ runtime (global fetch, no dependencies).

export { normalizeMatch, mergeSegments, segElapsed, ingestOne };

import { timingSafeEqual } from "node:crypto";
import { matchInWindow, fixtureForMatch, describeWindow, FULL_GAME_CLOCK_S, GAME_WINDOW_BEFORE_MS, GAME_WINDOW_AFTER_MS } from "../../shared/game-window.cjs";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INGEST_KEY = process.env.INGEST_KEY;

/* Constant-time secret compare for the x-ingest-key header. timingSafeEqual throws on buffers of
   unequal length, so a length mismatch is answered with a plain false first; an absent header or
   an unset expected value never matches anything (fail closed). */
function keyMatches(presented, expected) {
  if (!presented || !expected) return false;
  const a = Buffer.from(String(presented)), b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- Supabase REST helpers (PostgREST) ----
const sbHeaders = (extra) => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...extra });
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
/* v2.94: an RPC call for the importer's own lane (forfeit_abandoned_game). sbSend would do, but
   naming it keeps the call sites honest about what they are: a function, not a table write. */
async function sbRpc(fn, body) {
  return sbSend("POST", `rpc/${fn}`, body || {});
}
async function sbSend(method, path, body, prefer) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method, headers: sbHeaders(prefer ? { Prefer: prefer } : undefined),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
/* PostgREST answers a unique-index collision with 409 and Postgres's own code in the body.
   game_stats is unique per (game, club, player), so a collision on a box-score POST has exactly
   one meaning: another writer filed this game between our DELETE and our POST. */
const isUniqueViolation = (e) => /"code":\s*"23505"/.test(String((e && e.message) || e));

// ---- ET calendar day (matches the site's Eastern game-day convention) ----
const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDayUnix = (s) => etFmt.format(new Date(s * 1000));
const etDayISO = (iso) => etFmt.format(new Date(iso));

// ---- EA position -> hockey_position enum ----
function mapPos(p) {
  const s = String(p || "").toLowerCase();
  if (s.includes("goalie")) return "G";
  if (s.includes("center")) return "C";
  if (s.includes("left") && s.includes("wing")) return "LW";
  if (s.includes("right") && s.includes("wing")) return "RW";
  if (s.includes("left") && s.includes("def")) return "LD";
  if (s.includes("right") && s.includes("def")) return "RD";
  if (s.includes("def")) return "D";
  return "C";
}

// ---- Normalize ONE raw EA match. All EA-field assumptions live HERE. ----
function normalizeMatch(raw) {
  const clubIds = Object.keys(raw.clubs || {});
  if (clubIds.length !== 2 || !raw.matchId) return null;
  const club = (cid) => {
    const c = raw.clubs[cid] || {};
    const roster = (raw.players && raw.players[cid]) || {};
    const players = Object.entries(roster).map(([eaPlayerId, p]) => {
      const isG = String(p.position || "").toLowerCase().includes("goalie");
      return {
        ea_player_id: eaPlayerId, gamertag: p.playername, position: mapPos(p.position),
        goals: +(p.skgoals || 0), assists: +(p.skassists || 0),
        shots: +(p.skshots || 0), hits: +(p.skhits || 0), pim: +(p.skpim || 0),
        plus_minus: +(p.skplusmin || 0), takeaways: +(p.sktakeaways || 0), giveaways: +(p.skgiveaways || 0),
        faceoffs_won: +(p.skfow || 0), faceoffs_lost: +(p.skfol || 0), time_on_ice_seconds: +(p.toiseconds || 0),
        pp_goals: +(p.skppg || 0), sh_goals: +(p.skshg || 0), gwg: +(p.skgwg || 0),
        blocked_shots: +(p.skbs || 0), interceptions: +(p.skinterceptions || 0),
        passes_completed: +(p.skpasses || 0), passes_attempted: +(p.skpassattempts || 0),
        shot_attempts: +(p.skshotattempts || 0), possession_seconds: +(p.skpossession || 0),
        penalties_drawn: +(p.skpenaltiesdrawn || 0), deflections: +(p.skdeflections || 0), saucer_passes: +(p.sksaucerpasses || 0),
        offense_rating: +(p.ratingOffense || 0), defense_rating: +(p.ratingDefense || 0), team_play_rating: +(p.ratingTeamplay || 0),
        is_goalie: isG,
        saves: isG ? +(p.glsaves || 0) : 0, shots_against: isG ? +(p.glshots || 0) : 0, goals_against: isG ? +(p.glga || 0) : 0,
        breakaway_shots: isG ? +(p.glbrkshots || 0) : 0, breakaway_saves: isG ? +(p.glbrksaves || 0) : 0,
        poke_checks: isG ? +(p.glpokechecks || 0) : 0,
        shutout: isG && +(p.glga || 0) === 0 && +(p.glshots || 0) > 0
      };
    });
    /* v3.06 — THE SCORE IS THE PLAYERS' GOALS, not EA's club `score`.
       On a clean game the two are identical: checked against all eleven full-length games of the
       first game night, every one agreed exactly. They part company on a DISCONNECTED session,
       where EA replaces the played score with its 3-0 did-not-finish placeholder. VAN vs DAL
       arrived as two sittings of 20 and 40 minutes; EA called them 3-0 and 3-0 while the players'
       own goals said 2-0 and 4-2, so the merged game was filed 3-3 (a tie, which Rule 4.1 does not
       allow) instead of 6-2 to Vancouver.
       Summing the goals is also what makes a merge arithmetically sound: two sittings of a game
       add up player by player, whereas two DNF placeholders add up to nonsense. `ea_score` is kept
       beside it so a disagreement can be reported rather than silently papered over. */
    const scored = players.reduce((n, p) => n + (p.goals || 0), 0);
    const eaScore = +(c.score || 0);
    /* v3.18: EA states a disconnect outright. winnerByDnf / winnerByGoalieDnf are set on the club
       AWARDED the did-not-finish win, and they are what turns `score` into the 3-0 placeholder
       above. Carried through as a second, independent witness to the clock: on the SEA v PIT
       sitting that was wrongly filed as a result, both flags were 1 and the clock read 2400. */
    const dnf = +(c.winnerByDnf || 0) === 1 || +(c.winnerByGoalieDnf || 0) === 1;
    return { ea_club_id: String(cid), name: c.details ? c.details.name : null,
             score: scored, ea_score: eaScore, score_disputed: scored !== eaScore, dnf,
             ppg: +(c.ppg || 0), ppo: +(c.ppo || 0), result: +(c.result || 0), players };
  };
  const clubs = [club(clubIds[0]), club(clubIds[1])];
  // EA's per-club `result` code: 1 = regulation win, 2 = regulation loss, 5 = OT win, 6 = OT loss.
  // CGHL plays continuous sudden-death OT and no shootout (Rule 4.1), so any non-regulation
  // finish is overtime. If either club reports 5 or 6, the game went to OT.
  const wentOt = clubs.some((c) => c.result === 5 || c.result === 6);
  return { ea_match_id: String(raw.matchId), et_day: etDayUnix(raw.timestamp), ts: +raw.timestamp || 0,
           clubs, went_ot: wentOt, dnf: clubs.some((c) => c.dnf) };
}

// ---- Merge the sittings of a disconnected game into one box score ----
//
// A mid-game disconnect produces TWO (or more) EA matches: the abandoned first sitting, then the
// fresh lobby in which the clubs replay the game under Rule 4.3 — the whole game, or a single
// period when the drop came early in the third. League rule (4.3 P2): however many sittings a
// game takes, they are ONE game record, and everything earned in the abandoned sitting counts in
// full. So the sittings are summed per player and per club; the win/OT outcome comes from the
// FINAL sitting; a shutout is re-derived from the combined line (a goalie clean in the replay but
// scored on in the first sitting has no shutout); the per-game ratings are time-on-ice-weighted
// rather than summed. The game-winning goal cannot be attributed without goal timings, so it is
// zeroed rather than guessed.
/* ---- live EA transport for the fixture desk's on-demand fetch ----
   KEEP IN SYNC with eaFetch in pickup-import.js and eaGet in ea-poll.js — same route order, same
   reasons: DIRECT first (EA blocks by client fingerprint, not by datacenter IP), then the
   residential proxy only if EA answers 403. A proxied attempt needs undici's own fetch because
   Node's global fetch silently drops `dispatcher`; the direct attempt uses global fetch so tests
   can stub it. */
const PLATFORM = process.env.PLATFORM || "common-gen5";
const EA_PROXY = process.env.HTTPS_PROXY;
const EA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function eaFetch(url, opts = {}) {
  const { ProxyAgent, fetch: uFetch } = await import("undici");
  const headers = {
    "User-Agent": EA_UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.ea.com/", "Origin": "https://www.ea.com",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-site",
  };
  /* EA blocks by CLIENT FINGERPRINT, not by datacenter IP — verified 2026-09-07: curl is refused
     (403) from a residential address while undici/global fetch is served (200) from BOTH a
     residential and a datacenter address. So try DIRECT first: it needs no paid proxy and is a hop
     faster. The residential proxy stays only as a fallback for the day EA starts refusing this
     range again — a lapsed proxy can no longer take the whole EA pipeline down with it, which is
     exactly what happened when IPRoyal expired and every import went dark.

     v3.06: report what EVERY route said, not just the last. This loop used to keep only the final
     error, so a lapsed proxy's "fetch failed" masked whatever the direct attempt had actually
     answered, and the staff desk showed "EA unreachable (fetch failed)" whichever leg was really
     broken. `timeoutMs` and `tries` let an interactive caller (the club search on the stats desk)
     wait longer and only once, inside Netlify's own 10-second budget, instead of spending it on
     three identical attempts. */
  const perTry = opts.timeoutMs || 2800;
  const routes = EA_PROXY
    ? (opts.tries === 1 ? [null, EA_PROXY] : [null, EA_PROXY, EA_PROXY])
    : (opts.tries === 1 ? [null] : [null, null, null]);
  const said = [];
  for (const proxy of routes) {
    const label = proxy ? "proxy" : "direct";
    try {
      const o = { headers, signal: AbortSignal.timeout(perTry) };
      if (proxy) o.dispatcher = new ProxyAgent(proxy);
      /* the direct attempt uses global fetch so tests can stub it; only a PROXIED attempt needs
         undici's own fetch, because Node's global fetch silently drops `dispatcher` */
      const r = await (proxy ? uFetch(url, o) : fetch(url, o));
      if (r.ok) return r.json();
      said.push(`${label}: EA ${r.status}`);
      if (r.status !== 403) break;   // only a 403 is worth trying another route
    } catch (e) {
      const cause = e && e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : "";
      said.push(`${label}: ${String((e && e.message) || e)}${cause}`);
    }
  }
  const all = said.join("; ") || "no route answered";
  throw new Error(`EA unreachable (${all}${all.includes("403") ? " — EA is throttling this host; the VM lane still reaches it" : ""})`);
}
/* the club search is INTERACTIVE: somebody is watching a spinner, so give EA one generous try
   rather than three impatient ones, and stay inside Netlify's 10-second budget either way */
const eaSearchClubs = (name) =>
  eaFetch(`https://proclubs.ea.com/api/nhl/clubs/search?platform=${PLATFORM}&clubName=${encodeURIComponent(name)}`,
          { timeoutMs: 7000, tries: 1 });
const eaClubMatches = (clubId) =>
  eaFetch(`https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=${PLATFORM}&clubIds=${encodeURIComponent(clubId)}`);

/* EA's toiseconds runs on the DISPLAYED 20-minute clock: 3600 for a full regulation game, more in
   overtime, less when the game ended early (a disconnection or a quit). See shared/game-window.cjs;
   the old value here (720, the real-time length of the league's four-minute periods) meant no real
   sitting ever read as unfinished, so the lag-out merge could never fire. */
const REGULATION_S = FULL_GAME_CLOCK_S;
const RESUME_WINDOW_S = 3 * 3600;         // sittings further apart than this are not one game
const SITTING_CAP_S = Math.round(REGULATION_S * 1.5);   // longer than a game plus a long overtime is not a sitting

function segElapsed(seg) {
  // the longest time-on-ice in a segment is how long that sitting actually ran
  return seg.clubs.reduce((m, c) => c.players.reduce((m2, p) => Math.max(m2, p.time_on_ice_seconds || 0), m), 0);
}

function mergeSegments(segments) {
  const segs = segments.slice().sort((a, b) => a.ts - b.ts);
  const last = segs[segs.length - 1];
  const ids = segs[0].clubs.map((c) => c.ea_club_id).sort();
  for (const sg of segs) {
    const here = sg.clubs.map((c) => c.ea_club_id).sort();
    if (here[0] !== ids[0] || here[1] !== ids[1]) return { error: "segments are not between the same two clubs" };
  }
  const outClubs = segs[0].clubs.map((c0) => {
    const cid = c0.ea_club_id;
    const parts = segs.map((sg) => sg.clubs.find((c) => c.ea_club_id === cid));
    const players = new Map();
    for (const part of parts) {
      for (const p of part.players) {
        const prev = players.get(p.ea_player_id);
        if (!prev) { players.set(p.ea_player_id, { ...p, _toiW: [(p.time_on_ice_seconds || 0)], _rat: [[p.offense_rating, p.defense_rating, p.team_play_rating]] }); continue; }
        for (const k of ["goals","assists","shots","hits","pim","plus_minus","takeaways","giveaways",
                         "faceoffs_won","faceoffs_lost","time_on_ice_seconds","pp_goals","sh_goals",
                         "blocked_shots","interceptions","passes_completed","passes_attempted",
                         "shot_attempts","possession_seconds","penalties_drawn","deflections",
                         "saucer_passes","saves","shots_against","goals_against",
                         "breakaway_shots","breakaway_saves","poke_checks"]) prev[k] = (prev[k] || 0) + (p[k] || 0);
        prev.is_goalie = prev.is_goalie || p.is_goalie;
        // the segment the player skated longest in names the position and the latest gamertag wins
        if ((p.time_on_ice_seconds || 0) > Math.max(...prev._toiW)) prev.position = p.position;
        if (p.gamertag) prev.gamertag = p.gamertag;
        prev._toiW.push(p.time_on_ice_seconds || 0);
        prev._rat.push([p.offense_rating, p.defense_rating, p.team_play_rating]);
      }
    }
    const merged = [...players.values()].map((p) => {
      const w = p._toiW, tot = w.reduce((a, b) => a + b, 0);
      const wavg = (idx) => tot ? Math.round(p._rat.reduce((a, r, i) => a + (r[i0(idx)] || 0) * w[i], 0) / tot) : (p._rat[0][i0(idx)] || 0);
      function i0(n){ return n; }
      p.offense_rating = wavg(0); p.defense_rating = wavg(1); p.team_play_rating = wavg(2);
      p.gwg = 0;                                            // not attributable across segments
      p.shutout = !!p.is_goalie && (p.goals_against || 0) === 0 && (p.shots_against || 0) > 0;
      delete p._toiW; delete p._rat;
      return p;
    });
    return {
      ea_club_id: cid, name: parts.map((x) => x.name).filter(Boolean).pop() || null,
      score: parts.reduce((a, x) => a + (x.score || 0), 0),
      ppg: parts.reduce((a, x) => a + (x.ppg || 0), 0),
      ppo: parts.reduce((a, x) => a + (x.ppo || 0), 0),
      result: parts[parts.length - 1].result,
      players: merged
    };
  });
  return {
    ea_match_id: segs[0].ea_match_id,      // the fixture keeps the FIRST sitting's id
    et_day: segs[0].et_day, ts: last.ts,
    clubs: outClubs,
    went_ot: last.clubs.some((c) => c.result === 5 || c.result === 6),   // only the final sitting can end in OT
    merged_from: segs.map((sg) => sg.ea_match_id)
  };
}

// ---- Resolve an EA roster entry to one of our profiles (best effort) ----
/* KEEP IN SYNC with fuzzyProfile in pickup-import.js — same squashed-pattern fallback, same
   refuse-on-ambiguity rule. The exact matchers below die on a single space of drift between the
   EA box-score name and whatever the player typed at signup; this catches the drift without ever
   guessing between two candidates. */
async function fuzzyProfile(gt) {
  const toks = gt.split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  /* v2.99: escape the LIKE metacharacters in each TOKEN, then join with `*`. `*` is the wildcard
     this step exists to use; `_` is one by accident, and gamertags are full of underscores, so
     "Dangle_47" matched "DangleX47" here exactly as the exact-match steps were fixed not to.
     A single wrong match is the worst outcome available: the stat line is welded to the wrong
     human, and the unrostered-player check downstream sees a rostered player and stays quiet. */
  const escTok = (t) => t.replace(/([\\%_])/g, "\\$1");
  for (const pat of [toks.map(escTok).join("*"), `*${toks.map(escTok).join("*")}*`]) {
    const q = encodeURIComponent(pat);
    /* v3.02: discord_username is gone from here. A Discord handle is not evidence about who was
       in an EA lobby, and it is the one field a member can change at will without telling the
       league. The three that remain are all in-game identities. */
    const rows = await sbGet(`profiles?or=(ea_id.ilike.${q},platform_gamertag.ilike.${q},gamertag.ilike.${q})&select=id&limit=2`);
    const ids = [...new Set((rows || []).map((r) => r.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) return null;   // ambiguous — a looser pattern can only get MORE ambiguous
  }
  return null;
}

/* The EA name as the exact-match steps see it. `*` is PostgREST's LIKE wildcard, `%,()` and `"`
   are its filter syntax — none of them belongs in a gamertag, and one in a pattern would either
   widen the match or break the query. Both lookup sources clean the name the same way, so a
   player resolves identically whether he is looked up alone or with his whole box score. */
const cleanTag = (gamertag) => String(gamertag || "").replace(/[%,()*"]/g, "").trim();
/* `_` is a single-character WILDCARD in LIKE/ILIKE, and gamertags are full of underscores:
   "Dangle_47" matched "DangleX47" just as happily. The exact-match steps escape the
   metacharacters and refuse when two people match rather than taking whichever row the database
   happened to return first — a stat line welded to the wrong human is nearly impossible to spot
   later. */
const likeSafe = (v) => v.replace(/([\\%_])/g, "\\$1");
const uniq = (xs) => [...new Set(xs)];

/* The three exact-match lookups, asked ONE PLAYER AT A TIME. This is the source for a lone
   resolve (the exported resolveProfile, the tests); a whole box score uses gameLookups below. */
function liveLookups(seasonId) {
  return {
    // 1) prior link by EA persona id
    prior: async (eaPlayerId) => {
      const prev = await sbGet(`game_stats?ea_player_id=eq.${encodeURIComponent(eaPlayerId)}&profile_id=not.is.null&select=profile_id&limit=1`);
      return prev[0] ? prev[0].profile_id : null;
    },
    // 2) site gamertag — exact (case-insensitive), and never a guess between two people
    gamertag: async (gt) =>
      uniq(((await sbGet(`profiles?gamertag=ilike.${encodeURIComponent(likeSafe(gt))}&select=id&limit=2`)) || []).map((r) => r.id)),
    // v3.04: EA's own persona id, held on the profile. The ONLY identifier in an EA payload that
    //    is not a display name, so it is asked before every name.
    profilePersona: async (eaPlayerId) =>
      uniq(((await sbGet(`profiles?ea_player_id=eq.${encodeURIComponent(String(eaPlayerId))}&select=id&limit=2`)) || []).map((r) => r.id)),
    // the EA ID on the member's own profile — the field Settings writes and registration
    //    requires. v3.02: this was missing from the exact chain entirely; a box-score name is an
    //    EA identity, so it belongs here and it belongs before the site name.
    profileEaId: async (gt) =>
      uniq(((await sbGet(`profiles?ea_id=ilike.${encodeURIComponent(likeSafe(gt))}&select=id&limit=2`)) || []).map((r) => r.id)),
    // 4) EA id captured at signup for this season — same rule
    regEaId: async (gt) => seasonId
      ? uniq(((await sbGet(`season_registrations?season_id=eq.${seasonId}&ea_id=ilike.${encodeURIComponent(likeSafe(gt))}&select=profile_id&limit=2`)) || []).map((r) => r.profile_id))
      : [],
  };
}

/* The same three lookups, prefetched for a WHOLE GAME'S roster in one query each and answered
   from memory. Twelve players used to cost up to thirty-six round trips of the same three
   queries; now a box score costs at most three, and each is fetched only the first time a
   player needs that step (a roster of returning players never asks for gamertags at all). The
   ILIKE-or list keeps step 2 and 3 case-insensitive exactly as the per-player query is — a plain
   `in.()` would be case-sensitive, and EA's spelling of a tag and the site's often differ only
   there. Rows come back for the whole list, so each is attributed to its name in memory by
   case-folded equality; the ambiguity rule (two people → nobody) is applied per name, as before. */
function gameLookups(entries, seasonId) {
  const eaIds = uniq(entries.map((e) => e.ea_player_id).filter(Boolean).map(String));
  const names = uniq(entries.map((e) => cleanTag(e.gamertag)).filter(Boolean));
  const orIlike = (col, vals) => `or=(${vals.map((v) => `${col}.ilike.${encodeURIComponent(likeSafe(v))}`).join(",")})`;
  const groupByName = (rows, nameCol, idCol) => {
    const m = new Map();
    for (const r of rows || []) {
      const k = String(r[nameCol] || "").toLowerCase();
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(r[idCol]);
    }
    return m;
  };
  let priorP = null, tagP = null, regP = null, profEaP = null, personaP = null;
  return {
    prior: async (eaPlayerId) => {
      if (!eaIds.length) return null;
      priorP ||= sbGet(`game_stats?ea_player_id=in.(${eaIds.map(encodeURIComponent).join(",")})&profile_id=not.is.null&select=ea_player_id,profile_id`)
        .then((rows) => {
          const m = new Map();   // first row per persona, as the per-player limit=1 query took it
          for (const r of rows || []) if (!m.has(String(r.ea_player_id))) m.set(String(r.ea_player_id), r.profile_id);
          return m;
        });
      return (await priorP).get(String(eaPlayerId)) || null;
    },
    gamertag: async (gt) => {
      if (!names.length) return [];
      tagP ||= sbGet(`profiles?${orIlike("gamertag", names)}&select=id,gamertag`).then((rows) => groupByName(rows, "gamertag", "id"));
      return [...((await tagP).get(gt.toLowerCase()) || [])];
    },
    profilePersona: async (eaPlayerId) => {
      if (!eaIds.length) return [];
      personaP ||= sbGet(`profiles?ea_player_id=in.(${eaIds.map(encodeURIComponent).join(",")})&select=id,ea_player_id`)
        .then((rows) => {
          const m = new Map();
          for (const r of rows || []) {
            const k = String(r.ea_player_id);
            if (!m.has(k)) m.set(k, new Set());
            m.get(k).add(r.id);
          }
          return m;
        });
      return [...((await personaP).get(String(eaPlayerId)) || [])];
    },
    profileEaId: async (gt) => {
      if (!names.length) return [];
      profEaP ||= sbGet(`profiles?${orIlike("ea_id", names)}&select=id,ea_id`).then((rows) => groupByName(rows, "ea_id", "id"));
      return [...((await profEaP).get(gt.toLowerCase()) || [])];
    },
    regEaId: async (gt) => {
      if (!seasonId || !names.length) return [];
      regP ||= sbGet(`season_registrations?season_id=eq.${seasonId}&${orIlike("ea_id", names)}&select=profile_id,ea_id`).then((rows) => groupByName(rows, "ea_id", "profile_id"));
      return [...((await regP).get(gt.toLowerCase()) || [])];
    },
  };
}

/* The lookup chain — one implementation, whichever source feeds it. `cache` spans the caller's
   batch (keyed by season + persona, so a batch that straddles two seasons cannot cross-link);
   `src` is gameLookups for a whole box score, or the per-player live source when omitted. */
async function resolveProfile(entry, seasonId, cache, src) {
  const key = `${seasonId || ""}|${entry.ea_player_id}`;
  if (cache.has(key)) return cache.get(key);
  const L = src || liveLookups(seasonId);
  let pid = null;
  const gt = cleanTag(entry.gamertag);
  if (gt) {
    /* v3.02 (commissioner, game night 1): "make sure you are tracking player EA IDs instead of
       using their discord usernames". A box-score name is an EA identity, so it is matched against
       EA identities FIRST and against site or Discord names only after. The old order asked the
       site gamertag second and the EA ID third, which is how "Lokharov l14l" resolved to a
       duplicate, unrostered profile whose gamertag happened to match, while the rostered profile
       carrying ea_id "Lokharovl14l" was never reached. Verified against the whole of game night
       one: that was the only name where the two disagreed, and nobody resolved by Discord name
       alone. */
    // 1) EA's persona id, recorded on the profile. v3.04: the one identifier EA sends that is not
    //    a display name. Once learned (below) a member matches on it forever, whatever he renames
    //    himself to and whatever he typed into the EA ID box.
    const byPersona = await L.profilePersona(entry.ea_player_id);
    if (byPersona.length === 1) pid = byPersona[0];
    // 2) the same persona seen in an earlier box score (covers anyone linked before the column existed)
    if (!pid) pid = await L.prior(entry.ea_player_id);
    // 3) the EA ID on the member's profile
    if (!pid) {
      const ids = await L.profileEaId(gt);
      if (ids.length === 1) pid = ids[0];
    }
    // 4) the EA ID captured at signup for this season
    if (!pid && seasonId) {
      const ids = await L.regEaId(gt);
      if (ids.length === 1) pid = ids[0];
    }
    // 5) only now the site gamertag — exact, and never a guess between two people
    if (!pid) {
      const ids = await L.gamertag(gt);
      if (ids.length === 1) pid = ids[0];
    }
    // 6) squashed-pattern fallback across the names a player is known by IN GAME
    if (!pid) pid = await fuzzyProfile(gt);
  }
  cache.set(key, pid);
  return pid;
}

// ---- Archive every match + attempt outcome. EA's API only returns each club's few most
// recent matches, so a payload that isn't archived ages out of EA history forever. The log
// makes every payload replayable (commissioner re-ingest) and every failure visible.
async function logAttempt(norm, raw, status, reason, gameId) {
  try {
    await sbSend("POST", "ea_ingest_log?on_conflict=ea_match_id", [{
      ea_match_id: norm.ea_match_id, payload: raw, et_day: norm.et_day,
      ea_club_ids: norm.clubs.map((c) => c.ea_club_id),
      status, reason: reason || null, game_id: gameId || null,
      last_attempt_at: new Date().toISOString()
    }], "resolution=merge-duplicates,return=minimal");
    return true;
  } catch (e) { console.log("ea_ingest_log write failed:", String(e.message || e)); return false; }
}
/* Status-only touch for a match whose payload is ALREADY archived. EA re-serves the same recent
   matches on every poll, so the dedupe path would re-upload a full match body dozens of times per
   game; this sends the status columns only.

   v3.08 — this used to be an UPSERT on the match id, chosen over a PATCH because a PATCH on a row
   that is not there affects nothing and says nothing. THE UPSERT NEVER ONCE WORKED. `payload` is
   NOT NULL with no default, and Postgres checks NOT NULL against the proposed tuple BEFORE the
   ON CONFLICT arbiter resolves to an UPDATE — so an upsert that omits payload dies with 23502
   even though the row exists and would only have been updated. The throw was caught and logged,
   so every status after the first archive was lost in silence: on game night one all ten imported
   games sat at `unmatched`, which is what the statistics desk reads as "EA import needs a match",
   and the merge dedupe (which looks for `merged`) could have merged a lag-out sitting twice.

   So: PATCH, and then actually look. An UPDATE that matches no row comes back 200 with an empty
   array and no error, which is a false success — the representation is what tells the two apart.
   When the row is genuinely missing the caller is told, and `archive` falls back to a full insert
   on the next pass because the batch prefetch counts only rows WITH a payload as archived. */
async function touchAttempt(eaMatchId, status, reason, gameId) {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/ea_ingest_log?ea_match_id=eq.${encodeURIComponent(eaMatchId)}`,
      { method: "PATCH", headers: sbHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify({ status, reason: reason || null, game_id: gameId || null,
                               last_attempt_at: new Date().toISOString() }) });
    if (!r.ok) {
      console.warn(`ea_ingest_log touch failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return false;
    }
    const back = await r.json().catch(() => []);
    if (Array.isArray(back) && back.length) return true;
    console.warn(`ea_ingest_log touch matched no row for match ${eaMatchId} — its archive row is missing`);
    return false;
  } catch (e) { console.warn("ea_ingest_log touch failed:", String(e.message || e)); return false; }
}

/* ---- The batch context: what the archive and the schedule already know about every match in
   this delivery, fetched ONCE per batch instead of once (or twice) per match. Two prefetches
   replace two lookups per match, and a match that is already filed then costs nothing further —
   on a game night EA re-serves each club's last few matches on every ~2-minute poll, and nearly
   all of them are already done.
     filed    ea_match_id → game id, from games.ea_match_id (the dedupe the whole pipeline keys on)
     log      ea_match_id → {status, game_id} for every match whose PAYLOAD is archived. A row with
              no payload is not an archive (see touchAttempt), so it is deliberately not counted.
     profiles the resolveProfile cache, batch-wide — a replay sitting shares its roster with the
              first sitting, and the same twelve players play every game of a series.
   Kept current as the batch writes (a filing adds itself to `filed` and `log`), so a match that
   is delivered twice in one body is still filed once. Built for a single match when a caller
   (the commissioner re-ingest, the tests) runs ingestOne on its own. ---- */
async function batchContext(norms) {
  const ctx = { filed: new Map(), log: new Map(), profiles: new Map() };
  const ids = uniq((norms || []).map((n) => n && n.ea_match_id).filter(Boolean).map(String));
  if (!ids.length) return ctx;
  const q = ids.map(encodeURIComponent).join(",");
  const [games, logRows] = await Promise.all([
    sbGet(`games?ea_match_id=in.(${q})&select=id,ea_match_id`),
    sbGet(`ea_ingest_log?ea_match_id=in.(${q})&payload=not.is.null&select=ea_match_id,status,game_id`)
  ]);
  for (const g of games || []) ctx.filed.set(String(g.ea_match_id), g.id);
  for (const r of logRows || []) ctx.log.set(String(r.ea_match_id), { status: r.status, game_id: r.game_id || null });
  return ctx;
}

/* Archive an outcome, uploading the payload only when the archive does not hold it yet. First
   sighting stores the payload; every later one (a scrimmage is re-served ~100 times a night)
   touches the status. The context remembers a successful upload so the same batch never sends
   the body twice. Returns whether the archive row landed — the callers whose next-poll dedupe
   READS that row (the merge) must fail loud when it did not. */
async function archive(ctx, norm, raw, status, reason, gameId) {
  const id = String(norm.ea_match_id);
  const landed = ctx.log.has(id)
    ? await touchAttempt(id, status, reason, gameId)
    : await logAttempt(norm, raw, status, reason, gameId);
  if (landed) ctx.log.set(id, { status, game_id: gameId || null });
  return landed;
}

/* ARCHIVE BEFORE FILING. Called on the way into every automatic filing (a fresh box score, a
   Rule 4.3 resume), before the first game_stats or games row is touched: an invocation killed
   mid-write may leave a half-filed game, but never a filed game whose payload is gone when EA's
   short history rolls over. Nothing to do when the payload is archived already.
   The row is written as `unmatched`, which is literally true until the game row is stamped. If
   the filing dies, that word and this reason are what the statistics desk sees, and the next
   poll (the game does not carry the match id yet) files it again. Should the other poll lane
   have archived AND filed this very match in the moment since our prefetch, this write briefly
   reads `unmatched` over its `ingested`; the next poll finds the game filed and puts the row
   right (the dedupe branch in ingestOne). Nothing here throws quietly: a failed stage write
   fails the match, because filing without the archive is the one outcome this exists to prevent. */
async function stagePayload(ctx, norm, raw, gameId) {
  const id = String(norm.ea_match_id);
  if (ctx.log.has(id)) return;
  await sbSend("POST", "ea_ingest_log?on_conflict=ea_match_id", [{
    ea_match_id: id, payload: raw, et_day: norm.et_day,
    ea_club_ids: norm.clubs.map((c) => c.ea_club_id),
    status: "unmatched", game_id: null,
    reason: `archived ahead of filing on game ${gameId} — if this row still reads this way, the filing was interrupted; the next poll retries it, or file it by hand`,
    last_attempt_at: new Date().toISOString()
  }], "resolution=merge-duplicates,return=minimal");
  ctx.log.set(id, { status: "unmatched", game_id: null });
}

/* The box-score POST, with the one collision that is not an error: game_stats is unique per
   (game, club, player), so a duplicate-key answer means another writer — the other poll lane,
   the fixture desk — filed this game between our DELETE and our POST. Their rows stand; ours
   are dropped; the caller skips the game rather than failing the batch. */
async function postBoxScore(rows) {
  try { await sbSend("POST", "game_stats", rows, "return=minimal"); return true; }
  catch (e) { if (isUniqueViolation(e)) return false; throw e; }
}

export const _internals = { normalizeMatch, mergeSegments, segElapsed, isStatsStaff, authForGame, resolveProfile, gameLookups, batchContext };

// ---- Ingest ONE normalized match ----
// opts.relaxed (commissioner re-ingest of an archived payload only): the fixture window widens to
// a day either side, because the commissioner is deliberately replaying something the robot
// refused. Every automatic path runs strict.
// opts.ctx: the batch context (batchContext) shared by every match of one delivery; a lone call
// builds its own.
async function ingestOne(norm, raw, summary, batch, opts = {}) {
  const ctx = opts.ctx || await batchContext([norm]);
  const winBefore = opts.relaxed ? 86400000 : undefined, winAfter = opts.relaxed ? 86400000 : undefined;
  // dedupe — a match that owns a game, or was merged into one as a resume segment, is done.
  // Without the second check every later poll would re-merge the resume segment and double it.
  const filedOn = ctx.filed.get(String(norm.ea_match_id));
  if (filedOn) {
    summary.skipped.push({ ea_match_id: norm.ea_match_id, reason: "already ingested" });
    /* A filed match costs nothing further — EA returns the same few recent matches on every poll,
       and this branch used to touch the archive row on each of them (before that, re-upload the
       whole body). The one exception is an archive row that disagrees with the game: no payload
       archived at all, or a status left behind by an interrupted filing or a lost race with the
       other lane. One write puts it right, and from then on the match is free again. */
    const row = ctx.log.get(String(norm.ea_match_id));
    if (!row) await archive(ctx, norm, raw, "ingested", "already ingested (dedupe) — payload archived late", filedOn);
    else if (row.status !== "ingested" || row.game_id !== filedOn) {
      await touchAttempt(norm.ea_match_id, "ingested", "already ingested (dedupe)", filedOn);
      ctx.log.set(String(norm.ea_match_id), { status: "ingested", game_id: filedOn });
    }
    return;
  }
  const row = ctx.log.get(String(norm.ea_match_id));
  if (row && row.status === "merged") {
    summary.skipped.push({ ea_match_id: norm.ea_match_id, reason: "already merged into a resumed game" });
    return;
  }

  // map both clubs -> our teams
  const ids = norm.clubs.map((c) => c.ea_club_id);
  const teams = await sbGet(`teams?ea_club_id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,ea_club_id`);
  if (teams.length < 2) {
    /* An unknown opponent is either a club outside the league (a scrimmage — never staff work) or
       a league club that has not linked its EA id yet (its game cannot import until it does — and
       THAT is staff work). The tell: does the club we do know have a fixture whose window holds
       this match? If so the unknown side is very likely the scheduled opponent, unlinked. */
    const known = teams[0] && teams[0].id, endMs = (norm.ts || 0) * 1000;
    const nearby = known && endMs
      ? await sbGet(`games?or=(home_team_id.eq.${known},away_team_id.eq.${known})&voided=not.is.true&scheduled_at=gte.${encodeURIComponent(new Date(endMs - (opts.relaxed ? 86400000 : GAME_WINDOW_AFTER_MS)).toISOString())}&scheduled_at=lte.${encodeURIComponent(new Date(endMs + (opts.relaxed ? 86400000 : GAME_WINDOW_BEFORE_MS)).toISOString())}&select=id&limit=1`)
      : [];
    if (nearby.length || opts.relaxed) {
      const why = "one club is not linked to an EA club (teams.ea_club_id) — if this is the scheduled game, link the club's EA id and file it from the fixture desk";
      summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: why });
      await archive(ctx, norm, raw, "unmatched", why);
    } else {
      const why = "a match against a club outside the league, with no fixture for the known club in this window — not a league game";
      summary.skipped.push({ ea_match_id: norm.ea_match_id, reason: why });
      await archive(ctx, norm, raw, "ignored", why);
    }
    return;
  }
  const teamByClub = Object.fromEntries(teams.map((t) => [String(t.ea_club_id), t.id]));
  const tA = teamByClub[ids[0]], tB = teamByClub[ids[1]];

  // THE MATCHUP RULE (shared/game-window.cjs): a box score is filed only on an OPEN fixture between
  // exactly these two clubs whose game window (describeWindow(): puck drop − 10 min to + 3 h)
  // contains the time the match ENDED. Not the calendar day, not "a day either side": a scrimmage between two clubs the
  // afternoon of their game, a rematch after the night, a Tuesday lobby before a Wednesday fixture
  // are all refused and left for the fixture desk, where staff file by hand if one ever was the
  // league game.
  const or = `or=(and(home_team_id.eq.${tA},away_team_id.eq.${tB}),and(home_team_id.eq.${tB},away_team_id.eq.${tA}))`;
  const matchEndMs = (norm.ts || 0) * 1000;
  // The pair's fixtures around this match, every status: the OPEN ones are where a box score may
  // file; the rest (claimed, ruled, final) tell the window rule which slot is which on a playoff
  // night and whether this pair was scheduled at all.
  const DAY = 86400000;
  const pairAll = matchEndMs
    ? await sbGet(`games?${or}&scheduled_at=gte.${encodeURIComponent(new Date(matchEndMs - DAY - (winAfter ?? 0)).toISOString())}&scheduled_at=lte.${encodeURIComponent(new Date(matchEndMs + DAY + (winBefore ?? 0)).toISOString())}&select=id,scheduled_at,home_team_id,away_team_id,season_id,status,ea_match_id,voided,forfeit_team_id`)
    : [];
  // Only auto-attach to a genuinely open fixture: scheduled, not voided, not forfeit-ruled. Without
  // these filters an EA payload could mark a voided game final again, or overwrite a staff forfeit
  // ruling's score with the played numbers while leaving the ruling in place (Rule 3.2 / 4.3).
  const gamesAll = pairAll.filter((g) => g.status === "scheduled" && g.ea_match_id == null && !g.voided && g.forfeit_team_id == null);
  const siblings = pairAll.filter((g) => !g.voided);
  if (!matchEndMs) {
    // EA stamps every match; without the end time the window cannot be checked, and a box score
    // that cannot be placed in time is never guessed onto a fixture.
    const why = "EA gave this match no end time — it cannot be placed in a game window; file it by hand if it was the league game";
    summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: why });
    await archive(ctx, norm, raw, "unmatched", why);
    return;
  }
  // A playoff series plays the SAME two clubs twice or three times on one night (2-2-3, Rule 8.3),
  // so several open fixtures can hold this match's end time. Matches are ingested oldest first and
  // a claimed fixture leaves the open set, so the EARLIEST open fixture in window is the slot the
  // match was played in.
  let game = fixtureForMatch(gamesAll, tA, tB, matchEndMs, undefined, undefined, siblings);
  if (!game && opts.relaxed) {
    // a commissioner replaying an archived payload: the NEAREST open fixture within a day, never
    // the earliest — a still-open Wednesday slot must not swallow Thursday's box score
    game = gamesAll.filter((g) => matchInWindow(matchEndMs, g.scheduled_at, winBefore, winAfter))
      .sort((a, b) => Math.abs(Date.parse(a.scheduled_at) - matchEndMs) - Math.abs(Date.parse(b.scheduled_at) - matchEndMs))[0] || null;
  }
  // Rule 4.3: a disconnected game is REPLAYED in a fresh lobby, and the abandoned sitting and the
  // replay are one record. So before this match claims an open fixture, ask whether a FINAL game
  // between the same clubs inside this window is still unfinished (its clock never reached the
  // end of regulation). A complete game is never resumed. When an open sibling slot could ALSO
  // take this match (a 2-2-3 playoff night after a short first game), nobody can tell a lag-out
  // replay from the next game — that case goes to statistics staff, never guessed.
  const cont = await ingestContinuation(ctx, norm, raw, summary, batch, tA, tB, winBefore, winAfter, game);
  if (cont.done) return;
  if (!game) {
    const endIso = new Date(matchEndMs).toISOString();
    // "a scheduled matchup" means ANY fixture between the pair within a day of this match,
    // whatever its status — a forfeit-ruled or voided one included. Those go to the staff board:
    // a same-pair match hours before or after its slot may be the league game played off the
    // clock, and the office should see it. Only a pair with no fixture at all is quietly archived.
    if (pairAll.length || cont.sawFixture || opts.relaxed) {
      // a scheduled matchup, but this match is not it (or ran past the window): staff should look
      const why = `no open fixture between these clubs has a game window containing ${endIso} (windows run ${describeWindow(winBefore, winAfter)}) — not the scheduled game, or played outside its window; file it by hand if it was`;
      summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: why });
      await archive(ctx, norm, raw, "unmatched", why);
    } else {
      // two league clubs that are not scheduled against each other in this window: a scrimmage,
      // never staff work — archived (replayable by a commissioner), not flagged
      const why = `not a scheduled matchup — no fixture between these clubs has a game window containing ${endIso}`;
      summary.skipped.push({ ea_match_id: norm.ea_match_id, reason: why });
      await archive(ctx, norm, raw, "ignored", why);
    }
    return;
  }

  // home/away scores from the schedule's perspective
  const clubByTeam = { [tA]: norm.clubs[0], [tB]: norm.clubs[1] };
  const homeScore = clubByTeam[game.home_team_id].score;
  const awayScore = clubByTeam[game.away_team_id].score;

  /* WRITE ORDER: (1) the payload into the archive, (2) the box score, (3) the game row — which
     fires notify_discord_game_final and updates standings, so it goes LAST — then (4) the
     archive row's final status. See the header: the archive is the durable record. */
  await stagePayload(ctx, norm, raw, game.id);
  // build box-score rows (EA data supersedes any prior manual entry for this game)
  const rows = await leagueBoxRows(game, clubByTeam, ctx.profiles);
  await sbSend("DELETE", `game_stats?game_id=eq.${game.id}`);
  if (rows.length && !(await postBoxScore(rows))) {
    /* the other lane (or the fixture desk) filed this game first; its rows stand, and the next
       poll finds the game carrying a match id and skips it for good */
    summary.skipped.push({ ea_match_id: norm.ea_match_id, reason: "another writer filed this game first — left to it" });
    console.log(`ingest: game ${game.id} was filed by another writer while match ${norm.ea_match_id} was being written — skipped`);
    return;
  }
  const homeClub = clubByTeam[game.home_team_id], awayClub = clubByTeam[game.away_team_id];

  /* v3.18 — A SITTING THAT DID NOT REACH THE END OF REGULATION IS NOT A RESULT.
     SEA v PIT, Sep 24: a 40-minute sitting arrived at 10:02 PM and was filed as a finished game,
     SEA 2 PIT 3. The 20-minute continuation arrived at 10:14 and merged to the true SEA 4 PIT 3,
     but the score had already gone out and the announced WINNER was wrong. EA had said so twice
     in that payload: the clock read 2400 of 3600, and winnerByDnf and winnerByGoalieDnf were both
     set. Neither was consulted on the way in; the clock was only ever read by the merge.
     The box score is still written (it is real, and the merge needs it) and ea_match_id is still
     stamped so the fixture is claimed and the same sitting is not reprocessed every poll. What is
     withheld is the RESULT: no status, no score, so notify_discord_game_final never fires and the
     standings do not move. ingestContinuation looks for scheduled games too, so the continuation
     finds this one and the merge finals it with the full clock. */
  const elapsed = segElapsed(norm);
  const complete = elapsed >= REGULATION_S || !!norm.went_ot;
  if (!complete) {
    await sbSend("PATCH", `games?id=eq.${game.id}`,
      { ea_match_id: norm.ea_match_id,
        home_ppg: homeClub.ppg, home_ppo: homeClub.ppo, away_ppg: awayClub.ppg, away_ppo: awayClub.ppo },
      "return=minimal");
    ctx.filed.set(String(norm.ea_match_id), game.id);
    const why = `held: ${Math.round(elapsed / 60)} of ${Math.round(REGULATION_S / 60)} minutes played`
      + `${norm.dnf ? " and EA flagged a disconnect" : ""} — waiting for the rest of the game (Rule 4.3)`;
    summary.held = summary.held || [];
    summary.held.push({ ea_match_id: norm.ea_match_id, game_id: game.id, elapsed, reason: why });
    console.log(`ingest: game ${game.id} held — ${why}`);
    if (!(await archive(ctx, norm, raw, "incomplete", why, game.id)))
      summary.errors.push({ ea_match_id: norm.ea_match_id, error: `game ${game.id} is held, but its archive row could not be marked incomplete` });
    return;
  }

  await sbSend("PATCH", `games?id=eq.${game.id}`,
    { status: "final", home_score: homeScore, away_score: awayScore, ea_match_id: norm.ea_match_id,
      went_ot: !!norm.went_ot,
      home_ppg: homeClub.ppg, home_ppo: homeClub.ppo, away_ppg: awayClub.ppg, away_ppo: awayClub.ppo },
    "return=minimal");
  ctx.filed.set(String(norm.ea_match_id), game.id);

  const linked = rows.filter((r) => r.profile_id).length;
  // Your night: every linked player gets their own line back, with a link to the box score.
  // The stats used to land in silence — nobody was ever told they had three points.
  // postGameRecaps replaces this game's recaps rather than appending, so re-imports are safe.
  await postGameRecaps(game, rows, homeScore, awayScore, summary).catch((e) =>
    console.warn("recap notifications failed (the import itself is unaffected):", String(e && e.message || e)));
  summary.ingested.push({ ea_match_id: norm.ea_match_id, game_id: game.id, score: `${homeScore}-${awayScore}`, players: rows.length, linked });
  /* the game is filed either way, but a lost status leaves the archive reading `unmatched`, which
     the statistics desk reads as work it has to do by hand. Say so rather than swallow it. */
  if (!(await archive(ctx, norm, raw, "ingested", `${homeScore}-${awayScore}, ${rows.length} players (${linked} linked)`, game.id)))
    summary.errors.push({ ea_match_id: norm.ea_match_id, error: `game ${game.id} is filed, but its archive row could not be marked ingested — it will read as unmatched on the statistics desk` });
}

// ---- "Your night": one notification per linked player, carrying their own stat line ----
//
// Deliberately best-effort: a failure here must never fail the import, because the box score is
// the thing that matters and it is already written by the time we get here. Notifications are
// batched into one insert so a full 12-player game is a single request.
async function postGameRecaps(game, rows, homeScore, awayScore, summary) {
  const linked = rows.filter((r) => r.profile_id);
  if (!linked.length) return;
  // Replace, never append. A lag-out arrives as two EA matches: the first sitting flips the game
  // final on a PARTIAL score and would leave every player holding "Lost 2-3 — 1 point" for a game
  // that merged into a 5-4 win with a hat trick. Clearing this game's recaps first means the
  // merge simply reissues the truth, and a re-import can never announce the night twice.
  await sbSend("DELETE", `notifications?type=eq.stat&link_view=eq.game&link_param=eq.${game.id}`);
  const teams = await sbGet(`teams?id=in.(${game.home_team_id},${game.away_team_id})&select=id,name,code`);
  const nameOf = (id) => (teams.find((t) => t.id === id) || {}).name || "your club";
  const notes = linked.map((r) => {
    const mine   = r.team_id === game.home_team_id ? homeScore : awayScore;
    const theirs = r.team_id === game.home_team_id ? awayScore : homeScore;
    const oppId  = r.team_id === game.home_team_id ? game.away_team_id : game.home_team_id;
    const won    = mine > theirs;
    const isG    = !!r.is_goalie || r.position === "G";
    let line;
    if (isG) {
      const sa = r.shots_against || 0, sv = r.saves || 0;
      line = `${sv} save${sv === 1 ? "" : "s"} on ${sa}` + (r.shutout ? " — shutout." : ".");
    } else {
      const g = r.goals || 0, a = r.assists || 0, pts = g + a;
      line = pts
        ? `${g}G ${a}A — ${pts} point${pts === 1 ? "" : "s"}.`
        : `${r.shots || 0} shot${(r.shots || 0) === 1 ? "" : "s"}, ${r.hits || 0} hit${(r.hits || 0) === 1 ? "" : "s"}.`;
    }
    return {
      profile_id: r.profile_id,
      type: "stat",
      title: `${won ? "Won" : "Lost"} ${mine}-${theirs} vs ${nameOf(oppId)}`,
      body: `${line} Tap to see the full box score.`,
      link_view: "game",
      link_param: game.id,
    };
  });
  await sbSend("POST", "notifications", notes, "return=minimal");
  if (summary) (summary.recaps = summary.recaps || []).push({ game_id: game.id, sent: notes.length });
}

// ---- A resume segment: merge it into the final game it continues ----
//
// The league's procedure for a mid-game disconnect is to restart the lobby and play only the time
// remaining, so ONE fixture arrives as TWO (or more) EA matches. This merges them, under four
// tests, every one of which must pass — anything that fails falls through to "unmatched" and a
// commissioner decides (or, when `probe` is set because an open sibling fixture also fits, falls
// back to filing the match on that fixture):
//   1. a FINAL game between the same two clubs exists whose game window holds this end time AND
//      whose last recorded sitting is UNFINISHED — its clock never reached the end of regulation
//      (a complete game, decided or gone to overtime and decided, is never resumed);
//   2. the sittings are close in time (RESUME_WINDOW_S);
//   3. NEITHER club played anyone else in between — a club that moved on to a different opponent
//      finished its game (a quit still counts in full; it is not a disconnect);
//   4. the incoming sitting is at most one game plus a long overtime — under Rule 4.3 the replay
//      IS full length (or one period), so its length is no longer evidence against a merge.
// Returns { done, sawFixture }: done = the match was handled here (merged, or refused for the
// record when not probing); sawFixture = a same-pair final existed in the window at all.
async function ingestContinuation(ctx, norm, raw, summary, batch, tA, tB, winBefore, winAfter, sibling = null) {
  const probe = !!sibling;   // an open same-pair fixture could take this match instead
  const orC = `or=(and(home_team_id.eq.${tA},away_team_id.eq.${tB}),and(home_team_id.eq.${tB},away_team_id.eq.${tA}))`;
  // a forfeit-ruled or voided game is never a resume target (Rule 3.2 / 4.3 P7: the ruling stands)
  /* v3.18: scheduled games too, not only finals. A first sitting that fell short is now HELD —
     it carries its ea_match_id and its box score but no result — and that held game is exactly
     what this continuation belongs to. ea_match_id=not.is.null still keeps the list to fixtures
     that have actually taken a sitting, so an untouched game is never a merge target. */
  const finals = await sbGet(`games?${orC}&status=in.(final,scheduled)&ea_match_id=not.is.null&voided=not.is.true&forfeit_team_id=is.null&select=id,scheduled_at,home_team_id,away_team_id,season_id,ea_match_id`);
  const matchEndMs = (norm.ts || 0) * 1000;
  const inWindow = finals
    .filter((g) => matchInWindow(matchEndMs, g.scheduled_at, winBefore, winAfter))
    .sort((a, b) => Math.abs(Date.parse(a.scheduled_at) - matchEndMs) - Math.abs(Date.parse(b.scheduled_at) - matchEndMs));
  const R = (done) => ({ done, sawFixture: inWindow.length > 0 });
  if (!inWindow.length) return R(false);
  /* when an open sibling fixture could also take this match (a playoff night), a resume test that
     fails must hand the match back rather than filing it as unmatched */
  const refuse = async (why) => {
    if (probe) return R(false);
    summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: why });
    await archive(ctx, norm, raw, "unmatched", why);
    return R(true);
  };
  /* 1. the candidate is the nearest same-pair final in window that is still UNFINISHED. A game is
     complete when its sittings' clocks add up to a full game (a single-period replay under 4.3 P5
     finishes the game it continues), when its last sitting ran the whole clock, or when it went
     to overtime — a complete game is never resumed: on a playoff night it is the previous game,
     not this one's first half. */
  let cand = null, priors = [], missingArchive = false;
  for (const g of inWindow) {
    const logRows = await sbGet(`ea_ingest_log?or=(ea_match_id.eq.${encodeURIComponent(g.ea_match_id)},and(game_id.eq.${g.id},status.eq.merged))&select=ea_match_id,payload`);
    const ps = [];
    for (const rowL of logRows) {
      if (!rowL.payload) continue;
      const n2 = normalizeMatch(rowL.payload);
      if (n2 && !ps.some((x) => x.ea_match_id === n2.ea_match_id)) ps.push(n2);
    }
    if (!ps.length) { missingArchive = true; continue; }   // cannot be judged; see below
    const sorted = ps.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const last = sorted[sorted.length - 1];
    const total = ps.reduce((a, p2) => a + segElapsed(p2), 0);
    if (segElapsed(last) >= REGULATION_S || total >= REGULATION_S || last.went_ot) continue;   // finished
    cand = g; priors = ps; break;
  }
  if (!cand) {
    /* a same-pair final with no archive cannot be judged — exactly the case a commissioner
       re-ingest exists for. Say so, unless an open sibling is waiting to take the match. */
    if (missingArchive && !probe) return refuse("looks like a resume of an ingested game, but its first sitting is not archived — commissioner re-ingest needed");
    return R(false);
  }
  /* An unfinished same-pair game AND an open same-pair slot both fit this match (a 2-2-3 playoff
     night after a short first game). A lag-out replay and the next game look identical here — a
     quit, or an abandoned game the clubs never replayed, leaves the same short sitting — so this
     is a human's call. Leave the slot open, put the match on the statistics desk, name both. */
  if (probe) {
    const slotEt = new Date(sibling.scheduled_at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
    const why = `could be the Rule 4.3 replay of the unfinished ${cand.id} game or the ${slotEt} ET game between the same clubs — assign it by hand (merge it, or file it on the ${slotEt} slot) from the Stats manager`;
    summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: why });
    await archive(ctx, norm, raw, "unmatched", why);
    return R(true);
  }

  // 2. time proximity, against the nearest prior sitting
  const nearest = priors.reduce((m, p2) => Math.min(m, Math.abs((norm.ts || 0) - (p2.ts || 0))), Infinity);
  if (nearest > RESUME_WINDOW_S) return R(false);

  // 3. neither club played a DIFFERENT opponent between the sittings. The poll batch carries each
  //    club's recent history, so an intervening game is visible right here.
  const pair = norm.clubs.map((c) => c.ea_club_id).sort().join("|");
  const t0 = Math.min(...priors.map((p2) => p2.ts || 0)), t1 = Math.max(norm.ts || 0, ...priors.map((p2) => p2.ts || 0));
  for (const other of (batch || [])) {
    if (!other || other.ea_match_id === norm.ea_match_id) continue;
    if (priors.some((p2) => p2.ea_match_id === other.ea_match_id)) continue;
    const ids2 = other.clubs.map((c) => c.ea_club_id);
    const ours = norm.clubs.map((c) => c.ea_club_id);
    const involvesUs = ids2.some((id2) => ours.includes(id2));
    const samePair = ids2.slice().sort().join("|") === pair;
    if (involvesUs && !samePair && (other.ts || 0) > t0 && (other.ts || 0) < t1) {
      const why = "a different opponent came between the two sittings — not a disconnect resume";
      return refuse(why);
    }
  }

  // 4. the incoming sitting must be a sitting: a whole replayed game (Rule 4.3 P1), one period
  //    (P5), or another abandoned attempt — never longer than a game plus a long overtime
  const incomingLen = segElapsed(norm);
  const totalLen = priors.reduce((a, p2) => a + segElapsed(p2), 0) + incomingLen;
  if (incomingLen > SITTING_CAP_S) {
    const why = `same clubs back to back but the incoming sitting (${incomingLen}s of game clock) is longer than any one game — flagged for commissioner`;
    return refuse(why);
  }

  const merged = mergeSegments(priors.concat([norm]));
  if (merged.error) {
    return refuse(merged.error);
  }
  /* Rule 4.3 resumes a lag-out game, so the sittings' goals ADD: that total is the real score.
     What cannot stand is a level total. This league plays continuous overtime and has no shootout
     (Rule 4.1), so a tie means the clubs replayed the game in full instead of resuming it, or one
     sitting was filed twice. File it anyway (the box score is still the record) and put it in front
     of the officials the same night: a level final charges BOTH clubs a loss until it is ruled on.
     It travels as a WARNING, not an error, because the import itself worked. */
  if (merged.clubs && merged.clubs.length === 2 && (merged.clubs[0].score || 0) === (merged.clubs[1].score || 0)) {
    const lvl = `\u26a0\ufe0f **Resumed game ended level** \u00b7 EA match ${merged.ea_match_id}, merged from ${(merged.merged_from || []).join(" + ")}, finished ${merged.clubs[0].score} to ${merged.clubs[1].score}. A resumed game cannot end tied (Rule 4.1): the clubs likely replayed in full rather than resuming, or one sitting was filed twice. Rule on it in Control Center, Stats manager, before the table is read. A level final charges both clubs a loss.`;
    (summary.warnings = summary.warnings || []).push({ ea_match_id: merged.ea_match_id,
      warning: `merged game ended level (${merged.clubs[0].score}-${merged.clubs[1].score}); the officials were told` });
    await tellStaff(lvl);
  }

  // write exactly as a normal ingest writes, from the merged line
  const clubByTeam = {};
  const teamRows = await sbGet(`teams?id=in.(${tA},${tB})&select=id,ea_club_id`);
  for (const tr of teamRows) clubByTeam[tr.id] = merged.clubs.find((c) => c.ea_club_id === String(tr.ea_club_id));
  const homeClub = clubByTeam[cand.home_team_id], awayClub = clubByTeam[cand.away_team_id];
  if (!homeClub || !awayClub) {
    summary.errors.push({ ea_match_id: norm.ea_match_id, error: "resume merge could not map clubs to teams" });
    await archive(ctx, norm, raw, "error", "resume merge could not map clubs to teams");
    return R(true);
  }

  /* WRITE ORDER, as in ingestOne: the replay's payload into the archive first, then the box
     score, then the game row, then the archive row's final status. */
  await stagePayload(ctx, norm, raw, cand.id);
  const rows = await leagueBoxRows(cand, clubByTeam, ctx.profiles);
  await sbSend("DELETE", `game_stats?game_id=eq.${cand.id}`);
  if (rows.length && !(await postBoxScore(rows))) {
    /* the other lane merged this replay first; its rows stand, and its archive row (status
       merged) is what the next poll's dedupe reads */
    summary.skipped.push({ ea_match_id: norm.ea_match_id, reason: "another writer filed this game first — left to it" });
    console.log(`ingest: game ${cand.id} was written by another writer while replay ${norm.ea_match_id} was being merged — skipped`);
    return R(true);
  }
  /* v3.18 — status:'final' is now REQUIRED here, not redundant. This path used to merge only into
     games that were already final, so it never had to say so. A first sitting short of regulation
     is HELD now and leaves the game 'scheduled', and this merge is what completes it: without the
     status the game would carry a correct merged score and never actually be a result. Setting it
     on a game that was already final is harmless — notify_discord_game_final posts on the
     transition, and separately on a score that changed, which is what a merge legitimately does. */
  await sbSend("PATCH", `games?id=eq.${cand.id}`,
    { status: "final", home_score: homeClub.score, away_score: awayClub.score, went_ot: !!merged.went_ot,
      home_ppg: homeClub.ppg, home_ppo: homeClub.ppo, away_ppg: awayClub.ppg, away_ppo: awayClub.ppo },
    "return=minimal");

  // the first sitting already told everyone they lost 2-3; reissue from the merged truth
  await postGameRecaps({ id: cand.id, home_team_id: cand.home_team_id, away_team_id: cand.away_team_id },
    rows, homeClub.score, awayClub.score, summary).catch((e) =>
    console.warn("recap re-issue failed (the merge itself is unaffected):", String(e && e.message || e)));

  /* this row is what the NEXT match's completeness test and the merge dedupe read — a failed
     write must be loud, or the same replay would be merged again on every poll */
  const logged = await archive(ctx, norm, raw, "merged",
    `a later sitting of a disconnected game (Rule 4.3) — merged into ${cand.ea_match_id} (${priors.length + 1} sittings, ${totalLen}s of game clock)`, cand.id);
  if (!logged) summary.errors.push({ ea_match_id: norm.ea_match_id, error: `merged into ${cand.ea_match_id} but the merge could not be archived — the next poll may merge it again; check ea_ingest_log` });
  summary.ingested.push({ ea_match_id: norm.ea_match_id, game_id: cand.id, merged_into: cand.ea_match_id,
    score: `${homeClub.score}-${awayClub.score}`, players: rows.length, resumed: true });
  return R(true);
}

// ---- Commissioner re-ingest: replay an archived payload by ea_match_id ----
async function isCommissioner(jwt) {
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return false;
    const u = await r.json();
    if (!u || !u.id) return false;
    const prof = await sbGet(`profiles?id=eq.${u.id}&select=role&limit=1`);
    return !!(prof[0] && prof[0].role === "commissioner");
  } catch { return false; }
}

// Statistics staff (or a commissioner) — the same set the Stats Manager page is gated to.
async function isStatsStaff(jwt) {
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return false;
    const u = await r.json();
    if (!u || !u.id) return false;
    const prof = await sbGet(`profiles?id=eq.${u.id}&select=role,departments&limit=1`);
    if (!prof[0]) return false;
    if (prof[0].role === "commissioner") return true;
    return prof[0].role === "staff" && (prof[0].departments || []).indexOf("statistics") >= 0;
  } catch { return false; }
}

/* Who may work a SPECIFIC game's lag-out merge.
     - statistics staff (and commissioners) may work any game, with no window limit — that
       unrestricted reach is the whole point of the staff override.
     - a club's Owner/GM/AGM may work only games THEIR OWN club played. The seat is checked
       against the two teams on THAT game, so a manager can never reach another club's fixture
       by changing the id in the request.
   Returns the actor so the merge can be stamped with who did it — once non-staff can rebuild a
   box score, "who did this" has to be recoverable from the archive. */
async function authForGame(jwt, game) {
  const deny = { ok: false };
  if (!jwt) return deny;
  let uid = null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return deny;
    const u = await r.json();
    uid = u && u.id;
  } catch { return deny; }
  if (!uid) return deny;
  let prof;
  try { prof = (await sbGet(`profiles?id=eq.${uid}&select=role,departments,gamertag,banned&limit=1`))[0]; }
  catch { return deny; }
  if (!prof || prof.banned) return deny;
  const who = prof.gamertag || uid;
  if (prof.role === "commissioner") return { ok: true, uid, who, via: "staff" };
  if (prof.role === "staff" && (prof.departments || []).indexOf("statistics") >= 0) return { ok: true, uid, who, via: "staff" };
  let seats = [];
  try { seats = await sbGet(`teams?id=in.(${game.home_team_id},${game.away_team_id})&select=id,code,owner_profile_id,gm_profile_id,agm_profile_id`); }
  catch { return deny; }
  const mine = (seats || []).find((t) => t.owner_profile_id === uid || t.gm_profile_id === uid || t.agm_profile_id === uid);
  if (mine) {
    /* v2.38 (Rule 2.6): the Owner may withhold the game stats desk from a GM or AGM. The database
       is the authority on that (public.mgmt_access_for); a refused lookup denies, never allows. */
    try {
      const mode = await sbSend("POST", "rpc/mgmt_access_for", { p_profile: uid, p_team: mine.id, p_page: "gamestats" });
      if (mode === "hidden") return { ok: false, uid, who, reason: "The Owner has not given your seat access to Game stats." };
    } catch { return deny; }
    return { ok: true, uid, who, via: "management", club: mine.code, teamId: mine.id };
  }
  return deny;
}

/* A club rebuilding its own box score is a normal, expected repair — but staff should never
   learn about it only by noticing the number changed. Fire-and-forget: a dead webhook must
   never fail the merge that already succeeded. */
async function tellStaff(text) {
  try {
    const rows = await sbGet("app_config?key=in.(discord_staff_webhook,discord_updates_webhook)&select=key,value");
    const byKey = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
    const hook = byKey.discord_staff_webhook || byKey.discord_updates_webhook;
    if (!hook) return;
    await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1800), allowed_mentions: { parse: [] }, flags: 4 }) });
  } catch { /* never breaks the merge */ }
}

/* THE box-score row builder — a fresh filing, a Rule 4.3 resume and a manual merge all build
   their rows here, so a game is indistinguishable downstream whichever path filed it (the three
   used to be hand-kept copies). `cache` is the caller's resolveProfile cache (batch-wide for the
   pollers); the lookups themselves are prefetched once for the whole roster (gameLookups). */
async function leagueBoxRows(game, clubByTeam, cache = new Map()) {
  const entries = [game.home_team_id, game.away_team_id].flatMap((tid) => clubByTeam[tid].players);
  const src = gameLookups(entries, game.season_id);
  const rows = [];
  for (const tid of [game.home_team_id, game.away_team_id]) {
    const c = clubByTeam[tid];
    for (const e of c.players) {
      const profile_id = await resolveProfile(e, game.season_id, cache, src);
      rows.push({
        game_id: game.id, team_id: tid, profile_id, skater_name: e.gamertag, position: e.position,
        goals: e.goals, assists: e.assists, shots: e.shots, hits: e.hits, pim: e.pim, is_goalie: e.is_goalie,
        saves: e.saves, shots_against: e.shots_against, goals_against: e.goals_against,
        ea_player_id: e.ea_player_id, plus_minus: e.plus_minus, takeaways: e.takeaways, giveaways: e.giveaways,
        faceoffs_won: e.faceoffs_won, faceoffs_lost: e.faceoffs_lost, time_on_ice_seconds: e.time_on_ice_seconds,
        pp_goals: e.pp_goals, sh_goals: e.sh_goals, gwg: e.gwg,
        blocked_shots: e.blocked_shots, interceptions: e.interceptions,
        passes_completed: e.passes_completed, passes_attempted: e.passes_attempted,
        shot_attempts: e.shot_attempts, possession_seconds: e.possession_seconds,
        penalties_drawn: e.penalties_drawn, deflections: e.deflections, saucer_passes: e.saucer_passes,
        offense_rating: e.offense_rating, defense_rating: e.defense_rating, team_play_rating: e.team_play_rating,
        breakaway_shots: e.breakaway_shots, breakaway_saves: e.breakaway_saves,
        poke_checks: e.poke_checks, shutout: e.shutout
      });
    }
  }
  await applyCreditWithdrawals(game.id, rows);
  await learnPersonas(rows);
  return rows;
}

/* v3.08 — Rule 6.3: a withdrawal of personal credit is the LAST word on a box-score line.
   It deliberately does NOT live inside the matcher. resolveProfile would find the member again
   anyway: his persona id is still on his profile, and his other games still teach the `prior`
   step. So the withdrawal is applied to the finished rows, after resolution, or the next poll of
   the same match (and every Rule 4.3 re-merge, which DELETEs the game's lines and re-POSTs them)
   would quietly hand the credit back.

   The line itself is untouched. Only profile_id goes, and skater_name already carries the EA name,
   so the club keeps the line in its box score and the game keeps its score; downstream, an
   unlinked row gets a synthetic `ea:<row id>` key and renders without touching anyone's totals.

   If the withdrawals cannot be read, this THROWS and the filing is abandoned with the existing
   rows left alone. Re-crediting someone the league office removed is worse than not filing. */
async function applyCreditWithdrawals(gameId, rows) {
  const list = await sbGet(
    `stat_credit_withdrawals?game_id=eq.${encodeURIComponent(gameId)}&select=ea_player_id`);
  if (!Array.isArray(list) || !list.length) return;
  const off = new Set(list.map((w) => String(w.ea_player_id)));
  let n = 0;
  for (const r of rows) {
    if (r.profile_id && r.ea_player_id && off.has(String(r.ea_player_id))) { r.profile_id = null; n++; }
  }
  if (n) console.log(`ingest: ${n} line(s) stay uncredited on game ${gameId} (Rule 6.3 withdrawal)`);
}

/* v3.04 — the system only has to recognise a member ONCE. Whenever a box-score row resolves to a
   profile by any route, EA's persona id for that row is written onto the profile if it has none.
   From the next game on he matches on the id, before any name is considered, so a rename, a
   mismatched EA ID box or a console persona that differs from the EA account name can never cost
   him his stats again.

   Deliberately conservative, because a wrong link here is worse than no link:
     - only fills a NULL; an id already on a profile is never overwritten;
     - `ea_player_id=is.null` in the filter means a concurrent writer cannot be clobbered;
     - a unique index refuses to give one persona to two profiles (that IS a duplicate account and
       should fail loudly), and a 409 is logged, not thrown, so it can never fail an import;
     - a row with no profile or no persona is skipped rather than guessed at. */
async function learnPersonas(rows) {
  const seen = new Map();
  for (const r of rows || []) {
    if (!r.profile_id || !r.ea_player_id) continue;
    const key = String(r.profile_id);
    if (!seen.has(key)) seen.set(key, String(r.ea_player_id));
  }
  if (!seen.size) return;
  let learned = 0;
  for (const [profileId, persona] of seen) {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}&ea_player_id=is.null`,
        { method: "PATCH", headers: sbHeaders({ Prefer: "return=representation" }),
          body: JSON.stringify({ ea_player_id: persona }) });
      if (r.status === 409) { console.log(`ingest: persona ${persona} is already another profile's — duplicate account?`); continue; }
      if (!r.ok) { console.warn(`ingest: could not learn persona ${persona}: ${r.status} ${(await r.text()).slice(0, 120)}`); continue; }
      const back = await r.json().catch(() => []);
      if (Array.isArray(back) && back.length) learned++;
    } catch (e) { console.warn("ingest: learning a persona failed (the import is unaffected):", String(e && e.message || e)); }
  }
  if (learned) console.log(`ingest: learned ${learned} EA persona id(s) — those members now match on id, not on a name`);
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  if (!SB_URL || !SB_KEY) return { statusCode: 500, body: JSON.stringify({ error: "Server not configured (SUPABASE_URL / SERVICE_ROLE_KEY)" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: e.message }) }; }

  const key = event.headers["x-ingest-key"] || event.headers["X-Ingest-Key"];
  /* the dedicated INGEST_KEY, or the service-role key the VM poller (bot/ea-poll.mjs) already
     carries — both timing-safe, and no header at all is never authed */
  const authed = keyMatches(key, INGEST_KEY) || keyMatches(key, process.env.SUPABASE_SERVICE_ROLE_KEY);   /* bound to the secret by name, never to an alias that might grow a fallback */

  /* ---- Manual lag-out merge (statistics staff): the override for the sittings the automatic
     resume-merge refused — too far apart, over the length cap, a missed poll, or a wrong call.
     Candidates come from ea_ingest_log, which archives every payload precisely so this stays
     possible after EA's short history ages out. Selection is HUMAN; the guards that make the
     auto path conservative deliberately do not apply here, except the ones that protect other
     games' data. */
  if (!authed && body && body.leagueCandidates) {
    const jwt = String(event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    const gameId = String(body.leagueCandidates.gameId || body.leagueCandidates);
    const game = (await sbGet(`games?id=eq.${encodeURIComponent(gameId)}&select=id,season_id,week,scheduled_at,status,home_team_id,away_team_id,ea_match_id,home_score,away_score,forfeit_team_id`))[0];
    if (!game) return { statusCode: 404, body: JSON.stringify({ error: "No such game." }) };
    const actor = await authForGame(jwt, game);
    if (!actor.ok) return { statusCode: 401, body: JSON.stringify({ error: actor.reason || "Statistics staff, or the Owner/GM/AGM of a club in this game." }) };
    const teams = await sbGet(`teams?id=in.(${game.home_team_id},${game.away_team_id})&select=id,code,ea_club_id`);
    const home = teams.find((t) => t.id === game.home_team_id), away = teams.find((t) => t.id === game.away_team_id);
    if (!home || !away) return { statusCode: 422, body: JSON.stringify({ error: "This game's clubs no longer exist." }) };
    const linked = { home: home.ea_club_id != null, away: away.ea_club_id != null };
    /* `forfeit` lets the desk say up front that a ruled game is staff's to merge (the merge
       route refuses management on it either way) */
    const gameInfo = { id: game.id, week: game.week, status: game.status, home: home.code, away: away.code,
      score: game.status === "final" ? `${game.home_score}-${game.away_score}` : null,
      forfeit: game.forfeit_team_id != null };
    /* With NEITHER club linked the archive can't be searched at all — tell the desk so it can
       walk the manager through linking their own club, instead of a dead-end error. */
    if (!linked.home && !linked.away)
      return { statusCode: 200, body: JSON.stringify({ role: actor.via, game: gameInfo, linked, needsLink: true, candidates: [] }) };
    const dayS = Math.floor(Date.parse(game.scheduled_at) / 1000);
    const days = [etDayUnix(dayS - 86400), etDayUnix(dayS), etDayUnix(dayS + 86400)];
    /* One linked side is enough to find this fixture's sittings: rows containing OUR club id,
       with the opposing club read out of each payload. The merge re-verifies consistency. */
    const ourId = linked.home ? String(home.ea_club_id) : String(away.ea_club_id);
    const containQ = linked.home && linked.away
      ? `ea_club_ids=cs.{${encodeURIComponent(home.ea_club_id)},${encodeURIComponent(away.ea_club_id)}}`
      : `ea_club_ids=cs.{${encodeURIComponent(ourId)}}`;
    const logRows = await sbGet(`ea_ingest_log?${containQ}` +
      `&et_day=in.(${days.map(encodeURIComponent).join(",")})&select=ea_match_id,status,game_id,et_day,payload&order=et_day`);
    const pair = linked.home && linked.away ? [String(home.ea_club_id), String(away.ea_club_id)].sort().join("|") : null;
    const candidates = [];
    for (const row of logRows || []) {
      const nrm = normalizeMatch(row.payload); if (!nrm) continue;
      if (pair && nrm.clubs.map((c) => c.ea_club_id).sort().join("|") !== pair) continue;
      const ourClub = nrm.clubs.find((c) => c.ea_club_id === ourId);
      const oppClub = nrm.clubs.find((c) => c.ea_club_id !== ourId);
      if (!ourClub || !oppClub) continue;
      /* map scores onto the fixture's sides: ourId belongs to whichever side is linked */
      const ourSideIsHome = linked.home && String(home.ea_club_id) === ourId;
      candidates.push({
        matchId: nrm.ea_match_id, ts: nrm.ts, minutes: Math.round(segElapsed(nrm) / 60),
        homeScore: ourSideIsHome ? ourClub.score : oppClub.score,
        awayScore: ourSideIsHome ? oppClub.score : ourClub.score,
        status: row.status,
        oppEaName: pair ? null : oppClub.name || null,
        oppEaId: pair ? null : String(oppClub.ea_club_id),
        attached: row.game_id === game.id || game.ea_match_id === nrm.ea_match_id,
        usedElsewhere: !!(row.game_id && row.game_id !== game.id)
      });
    }
    candidates.sort((x, y) => (x.ts || 0) - (y.ts || 0));
    return { statusCode: 200, body: JSON.stringify({ role: actor.via, game: gameInfo, linked, candidates }) };
  }

  /* ---- The live-EA fallback for the fixture desk: when the archive has nothing (the poller
     wasn't watching, or the club was never linked), management searches EA for their OWN club,
     links it, and pulls its recent sessions into the archive — after which the normal
     candidates/merge path takes over. Everything stays scoped to one fixture via authForGame. */
  if (!authed && body && body.leagueEaSearch) {
    const jwt = String(event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    const gameId = String(body.leagueEaSearch.gameId || "");
    const name = String(body.leagueEaSearch.clubName || "").trim();
    const game = (await sbGet(`games?id=eq.${encodeURIComponent(gameId)}&select=id,home_team_id,away_team_id`))[0];
    if (!game) return { statusCode: 404, body: JSON.stringify({ error: "No such game." }) };
    const actor = await authForGame(jwt, game);
    if (!actor.ok) return { statusCode: 401, body: JSON.stringify({ error: actor.reason || "Statistics staff, or the Owner/GM/AGM of a club in this game." }) };
    if (name.length < 2) return { statusCode: 400, body: JSON.stringify({ error: "Enter at least 2 characters." }) };
    const data = await eaSearchClubs(name).catch((e) => ({ __err: e.message }));
    if (data && data.__err) return { statusCode: 502, body: JSON.stringify({ error: data.__err }) };
    const list = Array.isArray(data)
      ? data.map((c) => ({ clubId: String(c.clubId || c.clubInfo?.clubId || ""), name: c.name || c.clubInfo?.name, memberCount: c.memberCount }))
      : Object.entries(data || {}).map(([clubId, c]) => ({ clubId: String((c && c.clubId) || clubId), name: (c && (c.name || (c.clubInfo && c.clubInfo.name))) || null, memberCount: c && c.memberCount }));
    return { statusCode: 200, body: JSON.stringify({ clubs: list.filter((c) => c.clubId && c.name).slice(0, 15) }) };
  }

  if (!authed && body && body.leagueEaLink) {
    const jwt = String(event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    const gameId = String(body.leagueEaLink.gameId || "");
    const clubId = String(body.leagueEaLink.clubId || "").trim();
    const clubName = String(body.leagueEaLink.clubName || "").trim() || null;
    const game = (await sbGet(`games?id=eq.${encodeURIComponent(gameId)}&select=id,home_team_id,away_team_id`))[0];
    if (!game) return { statusCode: 404, body: JSON.stringify({ error: "No such game." }) };
    const actor = await authForGame(jwt, game);
    if (!actor.ok) return { statusCode: 401, body: JSON.stringify({ error: actor.reason || "Statistics staff, or the Owner/GM/AGM of a club in this game." }) };
    if (!clubId || !/^\d+$/.test(clubId)) return { statusCode: 400, body: JSON.stringify({ error: "Pick a club from the search results." }) };
    /* Management may link only its OWN club, and only when it isn't linked yet — re-pointing an
       established linkage would redirect every future auto-import and is a staff decision. */
    const teamId = actor.via === "management" ? actor.teamId
      : String(body.leagueEaLink.teamId || "");
    if (!teamId || (teamId !== game.home_team_id && teamId !== game.away_team_id))
      return { statusCode: 422, body: JSON.stringify({ error: "That club isn't in this game." }) };
    const team = (await sbGet(`teams?id=eq.${encodeURIComponent(teamId)}&select=id,code,ea_club_id`))[0];
    if (!team) return { statusCode: 404, body: JSON.stringify({ error: "No such club." }) };
    if (team.ea_club_id != null && String(team.ea_club_id) !== clubId)
      return { statusCode: 422, body: JSON.stringify({ error: `${team.code} is already linked to a different EA club — ask statistics staff to change it.` }) };
    /* one EA club can back only one league club */
    const taken = await sbGet(`teams?ea_club_id=eq.${encodeURIComponent(clubId)}&id=neq.${encodeURIComponent(teamId)}&select=code&limit=1`);
    if (taken[0]) return { statusCode: 422, body: JSON.stringify({ error: `That EA club is already linked to ${taken[0].code}.` }) };
    if (team.ea_club_id == null) {
      await sbSend("PATCH", `teams?id=eq.${encodeURIComponent(teamId)}`, { ea_club_id: clubId }, "return=minimal");
      await tellStaff(`🔗 **EA club linked** — ${actor.who} (${team.code} ${actor.via === "management" ? "management" : "staff"}) linked ${team.code} to EA club “${clubName || clubId}” (${clubId}) from the fixture desk. Auto-imports now cover ${team.code}. Correct it in the Control Center if it's wrong.`);
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, teamCode: team.code, clubId }) };
  }

  if (!authed && body && body.leagueEaFetch) {
    const jwt = String(event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    const gameId = String(body.leagueEaFetch.gameId || "");
    const game = (await sbGet(`games?id=eq.${encodeURIComponent(gameId)}&select=id,home_team_id,away_team_id,scheduled_at`))[0];
    if (!game) return { statusCode: 404, body: JSON.stringify({ error: "No such game." }) };
    const actor = await authForGame(jwt, game);
    if (!actor.ok) return { statusCode: 401, body: JSON.stringify({ error: actor.reason || "Statistics staff, or the Owner/GM/AGM of a club in this game." }) };
    const teams = await sbGet(`teams?id=in.(${game.home_team_id},${game.away_team_id})&select=id,code,ea_club_id`);
    /* fetch as the actor's own club when it's linked; otherwise any linked side of the fixture */
    const mine = actor.via === "management" ? teams.find((t) => t.id === actor.teamId) : null;
    const src = (mine && mine.ea_club_id != null) ? mine : teams.find((t) => t.ea_club_id != null);
    if (!src) return { statusCode: 422, body: JSON.stringify({ error: "Link your club's EA club first (search above)." }) };
    const raw = await eaClubMatches(String(src.ea_club_id)).catch((e) => ({ __err: e.message }));
    if (raw && raw.__err) return { statusCode: 502, body: JSON.stringify({ error: raw.__err }) };
    /* Archive everything EA returned, exactly as the poller would — but NEVER clobber a row the
       pipeline already owns: ignore-duplicates leaves existing status/game_id untouched. */
    const rows = [];
    for (const m of Array.isArray(raw) ? raw : []) {
      const nrm = normalizeMatch(m); if (!nrm) continue;
      rows.push({ ea_match_id: nrm.ea_match_id, payload: m, et_day: nrm.et_day,
        ea_club_ids: nrm.clubs.map((c) => c.ea_club_id),
        status: "unmatched", reason: `fetched on demand from the fixture desk by ${actor.who}`,
        last_attempt_at: new Date().toISOString() });
    }
    if (rows.length) await sbSend("POST", "ea_ingest_log?on_conflict=ea_match_id", rows, "resolution=ignore-duplicates,return=minimal");
    return { statusCode: 200, body: JSON.stringify({ ok: true, fetched: rows.length, club: src.code }) };
  }

  if (!authed && body && body.leagueMerge) {
    const jwt = String(event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    const gameId = String(body.leagueMerge.gameId || "");
    const matchIds = (Array.isArray(body.leagueMerge.matchIds) ? body.leagueMerge.matchIds : []).map(String).filter(Boolean);
    if (!gameId || !matchIds.length) return { statusCode: 400, body: JSON.stringify({ error: "Missing gameId/matchIds." }) };
    if (matchIds.length > 4) return { statusCode: 400, body: JSON.stringify({ error: "Four sittings is the limit." }) };
    if (new Set(matchIds).size !== matchIds.length) return { statusCode: 400, body: JSON.stringify({ error: "The same sitting is selected twice." }) };
    const game = (await sbGet(`games?id=eq.${encodeURIComponent(gameId)}&select=id,season_id,week,scheduled_at,status,home_team_id,away_team_id,ea_match_id,voided,forfeit_team_id`))[0];
    if (!game) return { statusCode: 404, body: JSON.stringify({ error: "No such game." }) };
    const actor = await authForGame(jwt, game);
    if (!actor.ok) return { statusCode: 401, body: JSON.stringify({ error: actor.reason || "Statistics staff, or the Owner/GM/AGM of a club in this game." }) };
    if (game.voided) return { statusCode: 422, body: JSON.stringify({ error: "That game is voided." }) };
    /* A Rule 3.2 forfeit is a statistics-staff ruling (forfeit_game / unforfeit_game). A club's
       management could otherwise merge real sittings over it and — as this path once did by
       writing forfeit_team_id: null — erase the ruling against itself. Staff may still merge the
       sittings for the record; the ruling is untouched here by anyone (see the PATCH below), and
       staff lift it with unforfeit_game when that is the call. */
    if (game.forfeit_team_id != null && actor.via !== "staff")
      return { statusCode: 422, body: JSON.stringify({ error: "This game carries a forfeit ruling — statistics staff can merge it." }) };
    const teams = await sbGet(`teams?id=in.(${game.home_team_id},${game.away_team_id})&select=id,code,ea_club_id`);
    const home = teams.find((t) => t.id === game.home_team_id), away = teams.find((t) => t.id === game.away_team_id);
    if (!home || !away || (home.ea_club_id == null && away.ea_club_id == null))
      return { statusCode: 422, body: JSON.stringify({ error: "Link a club's EA club first — search EA from the fixture page." }) };
    /* the sitting already on the game must be part of the selection — leaving it out would orphan
       a box score the standings already counted */
    if (game.ea_match_id && matchIds.indexOf(String(game.ea_match_id)) < 0)
      return { statusCode: 422, body: JSON.stringify({ error: `Include the sitting already on this game (${game.ea_match_id}) in the selection — the merge REPLACES the box score.` }) };
    const logRows = await sbGet(`ea_ingest_log?ea_match_id=in.(${matchIds.map(encodeURIComponent).join(",")})&select=ea_match_id,status,game_id,payload`);
    if ((logRows || []).length !== matchIds.length)
      return { statusCode: 404, body: JSON.stringify({ error: "A selected sitting has no archived payload — it was never seen by the poller." }) };
    const stolen = logRows.find((r) => r.game_id && r.game_id !== game.id);
    if (stolen) return { statusCode: 422, body: JSON.stringify({ error: `Sitting ${stolen.ea_match_id} already belongs to another game — it can't be merged here.` }) };
    /* Pair check. Both linked: exact pair. One linked: every selected sitting must contain OUR
       club and agree on a single opposing club — that consistency is what lets the merge then
       LINK the opponent from evidence: the payload of the game being attached to this fixture
       IS the proof of which EA club the opponent is. A manager never asserts the opponent's
       identity directly. */
    const bothLinked = home.ea_club_id != null && away.ea_club_id != null;
    const pair = bothLinked ? [String(home.ea_club_id), String(away.ea_club_id)].sort().join("|") : null;
    const ourLinked = home.ea_club_id != null ? { team: home, side: "home" } : { team: away, side: "away" };
    /* A club may only merge sittings from its fixture's own night (±1 ET day) — exactly the set
       the desk offered it. Two clubs meet several times a season, so without this a manager
       could graft a different meeting's sitting onto this game. Staff keep the unrestricted
       reach: a legitimately resumed sitting days later is theirs to judge. The window is
       recomputed from the payload through the SAME formatter the candidate list uses, so the
       two can never disagree about which day a sitting belongs to. */
    const mgmtDays = actor.via === "management"
      ? new Set([etDayUnix(Math.floor(Date.parse(game.scheduled_at) / 1000) - 86400),
                 etDayUnix(Math.floor(Date.parse(game.scheduled_at) / 1000)),
                 etDayUnix(Math.floor(Date.parse(game.scheduled_at) / 1000) + 86400)])
      : null;
    const norms = [];
    let derivedOpp = null;   // {id, name} consistent across every selected sitting
    for (const row of logRows) {
      const nrm = normalizeMatch(row.payload);
      if (!nrm) return { statusCode: 422, body: JSON.stringify({ error: `Couldn't read sitting ${row.ea_match_id}.` }) };
      if (pair) {
        if (nrm.clubs.map((c) => c.ea_club_id).sort().join("|") !== pair)
          return { statusCode: 422, body: JSON.stringify({ error: `Sitting ${nrm.ea_match_id} is not between ${home.code} and ${away.code}.` }) };
      } else {
        const ourClub = nrm.clubs.find((c) => c.ea_club_id === String(ourLinked.team.ea_club_id));
        const oppClub = nrm.clubs.find((c) => c.ea_club_id !== String(ourLinked.team.ea_club_id));
        if (!ourClub || !oppClub)
          return { statusCode: 422, body: JSON.stringify({ error: `Sitting ${nrm.ea_match_id} doesn't involve ${ourLinked.team.code}.` }) };
        if (derivedOpp && derivedOpp.id !== String(oppClub.ea_club_id))
          return { statusCode: 422, body: JSON.stringify({ error: "The selected sittings are against different opponents — they can't be one game." }) };
        derivedOpp = { id: String(oppClub.ea_club_id), name: oppClub.name || null };
      }
      if (mgmtDays && !mgmtDays.has(nrm.et_day))
        return { statusCode: 422, body: JSON.stringify({ error: `Sitting ${nrm.ea_match_id} wasn't played around this fixture — statistics staff can merge that one for you.` }) };
      norms.push(nrm);
    }
    /* Evidence linkage must not silently re-point an EA club that's already backing another
       league club — that would let one wrong selection hijack auto-imports elsewhere. */
    if (derivedOpp) {
      const clash = await sbGet(`teams?ea_club_id=eq.${encodeURIComponent(derivedOpp.id)}&select=code&limit=1`);
      if (clash[0]) return { statusCode: 422, body: JSON.stringify({ error: `These sittings are against ${clash[0].code}'s EA club — not this fixture's opponent.` }) };
    }
    norms.sort((x, y) => (x.ts || 0) - (y.ts || 0));
    const merged = norms.length > 1 ? mergeSegments(norms) : norms[0];
    if (merged.error) return { statusCode: 422, body: JSON.stringify({ error: merged.error }) };
    const clubByClubId = Object.fromEntries(merged.clubs.map((c) => [String(c.ea_club_id), c]));
    const homeEaId = home.ea_club_id != null ? String(home.ea_club_id) : derivedOpp.id;
    const awayEaId = away.ea_club_id != null ? String(away.ea_club_id) : derivedOpp.id;
    const clubByTeam = { [game.home_team_id]: clubByClubId[homeEaId], [game.away_team_id]: clubByClubId[awayEaId] };
    const rows = await leagueBoxRows(game, clubByTeam);
    /* WRITE ORDER: the archive first. The payloads are archived by construction (they came from
       ea_ingest_log), so the archive write here is the provenance — the first sitting owns the
       game, the rest are merged, stamped with who did it — the SAME marks the automatic path
       leaves, so its dedupe treats this game identically from now on. It goes in BEFORE the game
       is touched: if the writes below die, the archive says who was rebuilding what, and the
       human who clicked sees the error and clicks again (the retry passes every check above). */
    const byWhom = actor.via === "management" ? `${actor.who} (${actor.club} management)` : `${actor.who} (stats staff)`;
    for (const row of logRows) {
      const first = row.ea_match_id === merged.ea_match_id;
      await sbSend("PATCH", `ea_ingest_log?ea_match_id=eq.${encodeURIComponent(row.ea_match_id)}`,
        { status: first ? "ingested" : "merged", game_id: game.id, reason: first
          ? `manual lag-out merge (${norms.length} sitting${norms.length === 1 ? "" : "s"}) by ${byWhom}`
          : `manually merged into ${merged.ea_match_id} by ${byWhom}` });
    }
    await sbSend("DELETE", `game_stats?game_id=eq.${game.id}`);
    if (rows.length && !(await postBoxScore(rows)))
      return { statusCode: 409, body: JSON.stringify({ error: "Another import wrote this game's box score at the same moment — reload the fixture and try again." }) };
    const homeClub = clubByTeam[game.home_team_id], awayClub = clubByTeam[game.away_team_id];
    /* forfeit_team_id is deliberately NOT in this PATCH. A merge files what was played; whether
       a Rule 3.2 ruling stands over it is statistics staff's call, made with unforfeit_game. */
    await sbSend("PATCH", `games?id=eq.${game.id}`,
      { status: "final", home_score: homeClub.score, away_score: awayClub.score,
        ea_match_id: merged.ea_match_id, went_ot: !!merged.went_ot,
        home_ppg: homeClub.ppg || 0, home_ppo: homeClub.ppo || 0, away_ppg: awayClub.ppg || 0, away_ppo: awayClub.ppo || 0 },
      "return=minimal");
    /* Evidence linkage: attaching these sittings to this fixture proves the opponent's EA club.
       Link it so auto-imports cover them from now on; staff are told either way. */
    if (derivedOpp) {
      const oppTeam = home.ea_club_id == null ? home : away;
      await sbSend("PATCH", `teams?id=eq.${oppTeam.id}`, { ea_club_id: derivedOpp.id }, "return=minimal");
      await tellStaff(`🔗 **EA club linked by evidence** — merging sittings into ${away.code} @ ${home.code} established that ` +
        `${oppTeam.code}'s EA club is “${derivedOpp.name || derivedOpp.id}” (${derivedOpp.id}). Auto-imports now cover ${oppTeam.code}. ` +
        `Correct it in the Control Center if that looks wrong.`);
    }
    const linked = rows.filter((r) => r.profile_id).length;
    /* Staff should never find out a box score changed only by noticing the number moved. */
    if (actor.via === "management") {
      await tellStaff(`🧩 **Lag-out merge by a club** — ${byWhom} rebuilt ${away.code} @ ${home.code}` +
        (game.week ? ` (week ${game.week})` : "") + ` from ${norms.length} sitting${norms.length === 1 ? "" : "s"}: ` +
        `final ${homeClub.score}-${awayClub.score}${merged.went_ot ? " (OT)" : ""}, ${rows.length} player lines. ` +
        `Review it in the Stats Manager if anything looks off.`);
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, gameId: game.id,
      score: `${homeClub.score}-${awayClub.score}`, wentOt: !!merged.went_ot,
      sittings: norms.length, players: rows.length, linked, by: byWhom }) };
  }

  // Commissioner re-ingest: { reingest: "<ea_match_id>" } with the signed-in user's JWT.
  // INGEST_KEY stays server-side only; the archived payload is replayed from ea_ingest_log.
  if (!authed && body && body.reingest) {
    const jwt = String(event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    if (!jwt || !(await isCommissioner(jwt))) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    const row = (await sbGet(`ea_ingest_log?ea_match_id=eq.${encodeURIComponent(String(body.reingest))}&select=payload&limit=1`))[0];
    if (!row) return { statusCode: 404, body: JSON.stringify({ error: "No archived payload for that match id" }) };
    const summary = { received: 1, ingested: [], skipped: [], unmatched: [], errors: [], warnings: [] };
    try {
      const norm = normalizeMatch(row.payload);
      if (!norm) summary.errors.push({ reason: "archived payload is unparseable" });
      else await ingestOne(norm, row.payload, summary, [norm], { relaxed: true });   /* a deliberate replay: window widens to a day either side */
    } catch (e) { summary.errors.push({ ea_match_id: body.reingest, error: String(e.message || e) }); }
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(summary) };
  }

  if (!authed) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  const matchesRaw = Array.isArray(body) ? body : (Array.isArray(body.matches) ? body.matches : (body.matchId ? [body] : null));
  // oldest first: the first sitting of a disconnected game must be ingested before its resume
  const matches = matchesRaw && matchesRaw.slice().sort((a, b) => (+a?.timestamp || 0) - (+b?.timestamp || 0));
  if (!matches) return { statusCode: 400, body: JSON.stringify({ error: "Expected { matches: [...] } or a single match object." }) };

  const summary = { received: matches.length, ingested: [], skipped: [], unmatched: [], errors: [], warnings: [] };
  /* the whole batch, normalized, is the adjacency context: the resume check needs to see whether a
     club played someone else between two sittings, and the poll's per-club history is right here */
  const batch = matches.map((m) => { try { return normalizeMatch(m); } catch (e) { return null; } }).filter(Boolean);
  /* what the schedule and the archive already know about every match in this delivery, fetched
     once — most of a poll is matches already filed, and those now cost nothing further */
  const ctx = await batchContext(batch);
  for (const raw of matches) {
    try {
      const norm = normalizeMatch(raw);
      if (!norm) {
        /* EA also returns half-formed records with a single club (an opponent that never
           registered, an abandoned lobby). They can never be a league game — skipped, not an
           error, so a night with one of them does not read as a failing import. */
        const nClubs = raw && raw.clubs && typeof raw.clubs === "object" ? Object.keys(raw.clubs).length : 0;
        if (raw && raw.matchId != null && nClubs < 2) { summary.skipped.push({ ea_match_id: String(raw.matchId), reason: "incomplete match (one club only — never a league game)" }); continue; }
        summary.errors.push({ reason: "unparseable match (need 2 clubs + matchId)" }); continue;
      }
      await ingestOne(norm, raw, summary, batch, { ctx });
    } catch (e) {
      summary.errors.push({ ea_match_id: raw && raw.matchId, error: String(e.message || e) });
      // best-effort archive even when the attempt blew up, so the payload is never lost
      try { const n = normalizeMatch(raw); if (n) await archive(ctx, n, raw, "error", String(e.message || e)); } catch {}
    }
  }
/* ---- Rule 4.3, the abandoned game (v2.94) --------------------------------------------------
   A game whose sittings never add up to a full clock is UNFINISHED: the clubs are expected to
   reload and resume, and ingestContinuation merges the sittings when they do. But once one of
   those clubs plays a DIFFERENT opponent, the unfinished game is over: nobody is coming back to
   it. Commissioner's ruling (2026-09-23): that game is a forfeit, the club ahead on the ice takes
   the win, and BOTH clubs keep every stat they earned.

   Deliberately conservative in three ways, because this writes a loss into the table:
     - it rules only a game this batch could see the evidence for (the later match against another
       opponent is in the same delivery, with a LATER end time than the last sitting);
     - it never rules a level game. Nobody is ahead, so there is no one to give the win to; the
       officials are told and it waits for a human;
     - it never touches a game that is already forfeit-ruled or voided.
   Everything it does is reversible with unforfeit_game, and every ruling is logged and announced. */
async function closeOutAbandoned(ctx, summary, batch) {
  if (!batch || !batch.length) return;
  const clubsOf = (n) => n.clubs.map((c) => String(c.ea_club_id));
  const pairOf = (n) => clubsOf(n).slice().sort().join("|");
  const allClubs = [...new Set(batch.flatMap(clubsOf))];
  /* EVERY club, not just this delivery's: the abandoned game's opponent is by definition the club
     that is NOT here, and without its row the game could not even be named, let alone ruled. */
  let teams;
  try { teams = await sbGet("teams?ea_club_id=not.is.null&select=id,code,ea_club_id"); } catch { return; }
  if (!teams || !teams.length) return;
  const inBatch = teams.filter((t) => allClubs.includes(String(t.ea_club_id)));
  if (!inBatch.length) return;
  const codeOf = (tid) => (teams.find((t) => t.id === tid) || {}).code || tid;
  const clubOfTeam = new Map(teams.map((t) => [t.id, String(t.ea_club_id)]));
  /* where each club appears in this delivery: which pair, and when that match ended */
  const seenAt = new Map();
  for (const m of batch) for (const c of clubsOf(m)) {
    if (!seenAt.has(c)) seenAt.set(c, []);
    seenAt.get(c).push({ ts: m.ts || 0, pair: pairOf(m) });
  }
  /* The abandoned game's OWN pair is the one NOT in this delivery, so the search starts from each
     club in the delivery and looks at its recent finals against anyone. */
  const done = new Set();
  for (const t of inBatch) {
    let finals;
    try {
      finals = await sbGet(`games?or=(home_team_id.eq.${t.id},away_team_id.eq.${t.id})&status=eq.final&ea_match_id=not.is.null&voided=not.is.true&forfeit_team_id=is.null&select=id,home_team_id,away_team_id,home_score,away_score,scheduled_at,ea_match_id,week,stage`);
    } catch { continue; }
    for (const g of finals || []) {
      if (done.has(g.id)) continue;
      const cHome = clubOfTeam.get(g.home_team_id), cAway = clubOfTeam.get(g.away_team_id);
      if (!cHome || !cAway) continue;                 /* both sides must be clubs this batch names */
      const pair = [cHome, cAway].slice().sort().join("|");
      /* the same finished/unfinished test ingestContinuation uses, read from the archive */
      let ps = [];
      try {
        const rows = await sbGet(`ea_ingest_log?or=(ea_match_id.eq.${encodeURIComponent(g.ea_match_id)},and(game_id.eq.${g.id},status.eq.merged))&select=ea_match_id,payload`);
        for (const r of rows || []) {
          if (!r.payload) continue;
          const n2 = normalizeMatch(r.payload);
          if (n2 && !ps.some((x) => x.ea_match_id === n2.ea_match_id)) ps.push(n2);
        }
      } catch { continue; }
      if (!ps.length) continue;                       /* not judgeable without the payloads */
      const sorted = ps.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const last = sorted[sorted.length - 1];
      const total = ps.reduce((a, p2) => a + segElapsed(p2), 0);
      if (segElapsed(last) >= REGULATION_S || total >= REGULATION_S || last.went_ot) continue;   /* finished */
      /* did either club play a DIFFERENT opponent after the last sitting? */
      const movedOn = [cHome, cAway].some((c) => (seenAt.get(c) || []).some((x) => x.pair !== pair && x.ts > (last.ts || 0)));
      if (!movedOn) continue;                         /* still resumable: leave it for the merge */
      done.add(g.id);
      const mins = Math.round(total / 60);
      if ((g.home_score || 0) === (g.away_score || 0)) {
        summary.warnings.push({ game_id: g.id, warning: "abandoned game is level, the officials must rule it" });
        await tellStaff(`\u26a0\ufe0f **Abandoned game, level score** \u00b7 ${codeOf(g.away_team_id)} at ${codeOf(g.home_team_id)}, week ${g.week}: ${mins} min of game clock was played, the score was level at ${g.home_score}-${g.away_score}, and a club has moved on to another opponent. Rule 4.3 gives the win to the club ahead and neither is, so this one is yours: rule it in Control Center, Stats manager.`);
        continue;
      }
      const loser = (g.home_score || 0) > (g.away_score || 0) ? g.away_team_id : g.home_team_id;
      const winner = loser === g.home_team_id ? g.away_team_id : g.home_team_id;
      const reason = `abandoned: ${mins} min of game clock played, and a club moved on to another opponent (Rule 4.3)`;
      try {
        const r = await sbRpc("forfeit_abandoned_game", { p_game: g.id, p_forfeiting_team: loser, p_reason: reason });
        const ruled = r && (Array.isArray(r) ? r[0] : r);
        if (!ruled || ruled.ok !== true) continue;
        summary.warnings.push({ game_id: g.id, warning: `abandoned game ruled a forfeit: ${codeOf(winner)} keeps the win, both clubs keep their stats` });
        await tellStaff(`\u26a0\ufe0f **Abandoned game ruled (Rule 4.3)** \u00b7 ${codeOf(g.away_team_id)} at ${codeOf(g.home_team_id)}, week ${g.week}: only ${mins} min of game clock was played and a club went on to another opponent instead of resuming. **${codeOf(winner)} takes the win ${g.home_score}-${g.away_score}; both clubs keep their statistics.** Undo it in Control Center, Stats manager, if the clubs were still going to replay it.`);
      } catch (e) {
        summary.errors.push({ game_id: g.id, error: `could not rule the abandoned game: ${String((e && e.message) || e)}` });
      }
    }
  }
}

  /* Rule 4.3 (v2.94): close out any game this delivery proved abandoned, AFTER everything in it
     has been filed — the evidence is the batch itself, and a resume in the same batch must win. */
  try { await closeOutAbandoned(ctx, summary, batch); }
  catch (e) { summary.errors.push({ reason: `abandoned-game sweep: ${String((e && e.message) || e)}` }); }
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(summary) };
};
