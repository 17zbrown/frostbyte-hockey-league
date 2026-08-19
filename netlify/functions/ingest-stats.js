// Netlify Function: POST /api/ingest-stats  (redirected from netlify.toml)
// Receives raw EA Pro Clubs match objects (forwarded by the home/VPS fetcher),
// matches each to a scheduled league game by club-id pair + ET date, and writes
// the final score + per-player box score into Supabase. Idempotent: a match whose
// id already lives on a game (games.ea_match_id) is skipped.
//
// Auth: the fetcher must send  x-ingest-key: <INGEST_KEY>.  Writes use the Supabase
// SERVICE ROLE key (bypasses RLS) — both are Netlify env vars, never in the browser.
//   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_KEY
// Node 18+ runtime (global fetch, no dependencies).

export { normalizeMatch, mergeSegments, segElapsed, ingestOne };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INGEST_KEY = process.env.INGEST_KEY;

// ---- Supabase REST helpers (PostgREST) ----
const sbHeaders = (extra) => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...extra });
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
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
    return { ea_club_id: String(cid), name: c.details ? c.details.name : null, score: +(c.score || 0),
             ppg: +(c.ppg || 0), ppo: +(c.ppo || 0), result: +(c.result || 0), players };
  };
  const clubs = [club(clubIds[0]), club(clubIds[1])];
  // EA's per-club `result` code: 1 = regulation win, 2 = regulation loss, 5 = OT win, 6 = OT loss.
  // CGHL plays continuous sudden-death OT and no shootout (Rule 4.1), so any non-regulation
  // finish is overtime. If either club reports 5 or 6, the game went to OT.
  const wentOt = clubs.some((c) => c.result === 5 || c.result === 6);
  return { ea_match_id: String(raw.matchId), et_day: etDayUnix(raw.timestamp), ts: +raw.timestamp || 0, clubs, went_ot: wentOt };
}

// ---- Merge the segments of a disconnected game into one box score ----
//
// A mid-game disconnect produces TWO EA matches: the partial first sitting, then a fresh lobby
// where the clubs replay only the remaining time. League rule: that is ONE game. The segments are
// summed per player; the win/OT outcome comes from the FINAL sitting; a shutout is re-derived from
// the combined line (a goalie clean in the resume but scored on in the first sitting has no
// shutout); the per-game ratings are time-on-ice-weighted rather than summed. The game-winning
// goal cannot be attributed without goal timings, so it is zeroed rather than guessed.
/* ---- live EA transport for the fixture desk's on-demand fetch ----
   KEEP IN SYNC with eaFetch in pickup-import.js — same proxy dance, same reasons:
   undici's fetch honours `dispatcher` (Node's global fetch silently drops it), a NEW ProxyAgent
   per attempt = a fresh rotating IP for EA's flaky 403s, and proxyless falls back to global
   fetch so tests can stub it. */
const PLATFORM = process.env.PLATFORM || "common-gen5";
const EA_PROXY = process.env.HTTPS_PROXY;
const EA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function eaFetch(url) {
  const { ProxyAgent, fetch: uFetch } = await import("undici");
  const headers = {
    "User-Agent": EA_UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.ea.com/", "Origin": "https://www.ea.com",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-site",
  };
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const opts = { headers, signal: AbortSignal.timeout(2800) };
      if (EA_PROXY) opts.dispatcher = new ProxyAgent(EA_PROXY);
      const r = await (EA_PROXY ? uFetch : fetch)(url, opts);
      if (r.ok) return r.json();
      last = `EA ${r.status}`;
      if (r.status !== 403) throw new Error(last);
    } catch (e) { last = String(e.message || e); }
  }
  throw new Error(`EA unreachable (${last}${last.includes("403") ? " — EA is throttling; try again in a moment" : ""})`);
}
const eaSearchClubs = (name) =>
  eaFetch(`https://proclubs.ea.com/api/nhl/clubs/search?platform=${PLATFORM}&clubName=${encodeURIComponent(name)}`);
const eaClubMatches = (clubId) =>
  eaFetch(`https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=${PLATFORM}&clubIds=${encodeURIComponent(clubId)}`);

const REGULATION_S = 720;                 // 3 periods x 4 minutes
const RESUME_WINDOW_S = 3 * 3600;         // segments further apart than this are not one game
const COMBINED_CAP_S = Math.round(REGULATION_S * 1.7);   // room for OT on the resumed end

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
  for (const pat of [toks.join("*"), `*${toks.join("*")}*`]) {
    const q = encodeURIComponent(pat);
    const rows = await sbGet(`profiles?or=(ea_id.ilike.${q},platform_gamertag.ilike.${q},gamertag.ilike.${q},discord_username.ilike.${q})&select=id&limit=2`);
    const ids = [...new Set((rows || []).map((r) => r.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) return null;   // ambiguous — a looser pattern can only get MORE ambiguous
  }
  return null;
}

async function resolveProfile(entry, seasonId, cache) {
  if (cache.has(entry.ea_player_id)) return cache.get(entry.ea_player_id);
  let pid = null;
  const gt = (entry.gamertag || "").replace(/[%,()*]/g, "").trim();
  if (gt) {
    // 1) prior link by EA persona id
    const prev = await sbGet(`game_stats?ea_player_id=eq.${encodeURIComponent(entry.ea_player_id)}&profile_id=not.is.null&select=profile_id&limit=1`);
    if (prev[0]) pid = prev[0].profile_id;
    // 2) site gamertag
    if (!pid) { const pr = await sbGet(`profiles?gamertag=ilike.${encodeURIComponent(gt)}&select=id&limit=1`); if (pr[0]) pid = pr[0].id; }
    // 3) EA id captured at signup for this season
    if (!pid && seasonId) { const rg = await sbGet(`season_registrations?season_id=eq.${seasonId}&ea_id=ilike.${encodeURIComponent(gt)}&select=profile_id&limit=1`); if (rg[0]) pid = rg[0].profile_id; }
    // 4) squashed-pattern fallback across every name field a player owns
    if (!pid) pid = await fuzzyProfile(gt);
  }
  cache.set(entry.ea_player_id, pid);
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
  } catch (e) { console.log("ea_ingest_log write failed:", String(e.message || e)); }
}

export const _internals = { normalizeMatch, mergeSegments, segElapsed, isStatsStaff, authForGame, resolveProfile };

// ---- Ingest ONE normalized match ----
async function ingestOne(norm, raw, summary, batch) {
  // dedupe — a match that owns a game, or was merged into one as a resume segment, is done.
  // Without the second check every later poll would re-merge the resume segment and double it.
  const dup = await sbGet(`games?ea_match_id=eq.${encodeURIComponent(norm.ea_match_id)}&select=id&limit=1`);
  if (dup[0]) {
    summary.skipped.push({ ea_match_id: norm.ea_match_id, reason: "already ingested" });
    await logAttempt(norm, raw, "ingested", "already ingested (dedupe)", dup[0].id);
    return;
  }
  const mdup = await sbGet(`ea_ingest_log?ea_match_id=eq.${encodeURIComponent(norm.ea_match_id)}&status=eq.merged&select=game_id&limit=1`);
  if (mdup[0]) {
    summary.skipped.push({ ea_match_id: norm.ea_match_id, reason: "already merged into a resumed game" });
    return;
  }

  // map both clubs -> our teams
  const ids = norm.clubs.map((c) => c.ea_club_id);
  const teams = await sbGet(`teams?ea_club_id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,ea_club_id`);
  if (teams.length < 2) {
    summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: "one or both clubs not registered (teams.ea_club_id)" });
    await logAttempt(norm, raw, "unmatched", "one or both clubs not registered (teams.ea_club_id)");
    return;
  }
  const teamByClub = Object.fromEntries(teams.map((t) => [String(t.ea_club_id), t.id]));
  const tA = teamByClub[ids[0]], tB = teamByClub[ids[1]];

  // find a scheduled, not-yet-ingested game between these two clubs. Prefer the exact ET day;
  // otherwise fall back to the nearest game within +/-1 ET day. A game that finishes after
  // midnight ET (or spills into OT) reports the *next* ET day while the fixture stays on game
  // night — exact-day matching would silently drop those box scores, so widen the window.
  const or = `or=(and(home_team_id.eq.${tA},away_team_id.eq.${tB}),and(home_team_id.eq.${tB},away_team_id.eq.${tA}))`;
  const gamesAll = await sbGet(`games?${or}&ea_match_id=is.null&select=id,scheduled_at,home_team_id,away_team_id,season_id`);
  // A match cannot belong to a fixture that had not started when the match ENDED (codes go out at
  // T-30). Without this, a stray payload could mark a future game final with someone else's score.
  const matchEndMs = (norm.ts || 0) * 1000;
  const games = matchEndMs
    ? gamesAll.filter((g) => Date.parse(g.scheduled_at) <= matchEndMs + 2 * 3600000)
    : gamesAll;
  const DAY = 86400000;
  const matchDayUnix = Date.parse(`${norm.et_day}T12:00:00Z`); // noon avoids DST edge wobble
  let game = games.find((g) => etDayISO(g.scheduled_at) === norm.et_day);
  if (!game) {
    const near = games
      .map((g) => ({ g, days: Math.abs(Date.parse(`${etDayISO(g.scheduled_at)}T12:00:00Z`) - matchDayUnix) / DAY }))
      .filter((x) => x.days <= 1)
      .sort((a, b) => a.days - b.days);
    if (near[0]) game = near[0].g;
  }
  if (!game) {
    // No unclaimed fixture. If a FINAL game between these same clubs sits close by in time, this
    // payload may be the second sitting of a disconnected game — the league replays only the
    // remaining time in a fresh lobby, and that lobby reports as a brand-new EA match.
    const done = await ingestContinuation(norm, raw, summary, batch, tA, tB);
    if (done) return;
    summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: `no scheduled game for these clubs within a day of ${norm.et_day}` });
    await logAttempt(norm, raw, "unmatched", `no scheduled game for these clubs within a day of ${norm.et_day}`);
    return;
  }

  // home/away scores from the schedule's perspective
  const clubByTeam = { [tA]: norm.clubs[0], [tB]: norm.clubs[1] };
  const homeScore = clubByTeam[game.home_team_id].score;
  const awayScore = clubByTeam[game.away_team_id].score;

  // build box-score rows (EA data supersedes any prior manual entry for this game)
  const cache = new Map();
  const rows = [];
  for (const tid of [game.home_team_id, game.away_team_id]) {
    const c = clubByTeam[tid];
    for (const e of c.players) {
      const profile_id = await resolveProfile(e, game.season_id, cache);
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
  await sbSend("DELETE", `game_stats?game_id=eq.${game.id}`);
  if (rows.length) await sbSend("POST", "game_stats", rows, "return=minimal");
  // flip the game to final LAST — this fires notify_discord_game_final + updates standings
  const homeClub = clubByTeam[game.home_team_id], awayClub = clubByTeam[game.away_team_id];
  await sbSend("PATCH", `games?id=eq.${game.id}`,
    { status: "final", home_score: homeScore, away_score: awayScore, ea_match_id: norm.ea_match_id,
      went_ot: !!norm.went_ot,
      home_ppg: homeClub.ppg, home_ppo: homeClub.ppo, away_ppg: awayClub.ppg, away_ppo: awayClub.ppo },
    "return=minimal");

  const linked = rows.filter((r) => r.profile_id).length;
  // Your night: every linked player gets their own line back, with a link to the box score.
  // The stats used to land in silence — nobody was ever told they had three points.
  // postGameRecaps replaces this game's recaps rather than appending, so re-imports are safe.
  await postGameRecaps(game, rows, homeScore, awayScore, summary).catch((e) =>
    console.warn("recap notifications failed (the import itself is unaffected):", String(e && e.message || e)));
  summary.ingested.push({ ea_match_id: norm.ea_match_id, game_id: game.id, score: `${homeScore}-${awayScore}`, players: rows.length, linked });
  await logAttempt(norm, raw, "ingested", `${homeScore}-${awayScore}, ${rows.length} players (${linked} linked)`, game.id);
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
// commissioner decides:
//   1. a FINAL game between the same two clubs exists within the day window;
//   2. the sittings are close in time (RESUME_WINDOW_S);
//   3. NEITHER club played anyone else in between — a club that moved on to a different opponent
//      finished its game (a quit still counts in full; it is not a disconnect);
//   4. the incoming sitting is shorter than a whole game, and all sittings together fit inside
//      one game plus overtime — two full-length games are a replay for the commissioner to rule
//      on, never an automatic merge.
async function ingestContinuation(norm, raw, summary, batch, tA, tB) {
  const orC = `or=(and(home_team_id.eq.${tA},away_team_id.eq.${tB}),and(home_team_id.eq.${tB},away_team_id.eq.${tA}))`;
  const finals = await sbGet(`games?${orC}&status=eq.final&ea_match_id=not.is.null&select=id,scheduled_at,home_team_id,away_team_id,season_id,ea_match_id`);
  const matchEndMs = (norm.ts || 0) * 1000;
  const cand = finals
    .filter((g) => Math.abs(Date.parse(g.scheduled_at) - matchEndMs) < 86400000)
    .sort((a, b) => Math.abs(Date.parse(a.scheduled_at) - matchEndMs) - Math.abs(Date.parse(b.scheduled_at) - matchEndMs))[0];
  if (!cand) return false;

  // every prior sitting of this fixture: the one on the game row + any already merged into it
  const logRows = await sbGet(`ea_ingest_log?or=(ea_match_id.eq.${encodeURIComponent(cand.ea_match_id)},and(game_id.eq.${cand.id},status.eq.merged))&select=ea_match_id,payload`);
  const priors = [];
  for (const rowL of logRows) {
    if (!rowL.payload) continue;
    const n2 = normalizeMatch(rowL.payload);
    if (n2 && !priors.some((x) => x.ea_match_id === n2.ea_match_id)) priors.push(n2);
  }
  if (!priors.length) {
    const why = "looks like a resume of an ingested game, but its first sitting is not archived — commissioner re-ingest needed";
    summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: why });
    await logAttempt(norm, raw, "unmatched", why);
    return true;
  }

  // 2. time proximity, against the nearest prior sitting
  const nearest = priors.reduce((m, p2) => Math.min(m, Math.abs((norm.ts || 0) - (p2.ts || 0))), Infinity);
  if (nearest > RESUME_WINDOW_S) return false;

  // 3. neither club played a DIFFERENT opponent between the sittings. The poll batch carries each
  //    club's recent history, so an intervening game is visible right here.
  const pair = norm.clubs.map((c) => c.ea_club_id).sort().join("|");
  const t0 = Math.min(...priors.map((p2) => p2.ts || 0)), t1 = Math.max(norm.ts || 0, ...priors.map((p2) => p2.ts || 0));
  for (const other of (batch || [])) {
    if (!other || other.ea_match_id === norm.ea_match_id) continue;
    if (priors.some((p2) => p2.ea_match_id === other.ea_match_id)) continue;
    const ids2 = other.clubs.map((c) => c.ea_club_id);
    const involvesUs = ids2.some((id2) => pair.includes(id2));
    const samePair = ids2.slice().sort().join("|") === pair;
    if (involvesUs && !samePair && (other.ts || 0) > t0 && (other.ts || 0) < t1) {
      const why = "a different opponent came between the two sittings — not a disconnect resume";
      summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: why });
      await logAttempt(norm, raw, "unmatched", why);
      return true;
    }
  }

  // 4. the sittings must LOOK like one game split in two
  const incomingLen = segElapsed(norm);
  const totalLen = priors.reduce((a, p2) => a + segElapsed(p2), 0) + incomingLen;
  if (incomingLen >= REGULATION_S || totalLen > COMBINED_CAP_S) {
    const why = `same clubs back to back but the sittings do not fit one game (${incomingLen}s incoming, ${totalLen}s combined) — flagged for commissioner`;
    summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: why });
    await logAttempt(norm, raw, "unmatched", why);
    return true;
  }

  const merged = mergeSegments(priors.concat([norm]));
  if (merged.error) {
    summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: merged.error });
    await logAttempt(norm, raw, "unmatched", merged.error);
    return true;
  }

  // write exactly as a normal ingest writes, from the merged line
  const clubByTeam = {};
  const teamRows = await sbGet(`teams?id=in.(${tA},${tB})&select=id,ea_club_id`);
  for (const tr of teamRows) clubByTeam[tr.id] = merged.clubs.find((c) => c.ea_club_id === String(tr.ea_club_id));
  const homeClub = clubByTeam[cand.home_team_id], awayClub = clubByTeam[cand.away_team_id];
  if (!homeClub || !awayClub) {
    summary.errors.push({ ea_match_id: norm.ea_match_id, error: "resume merge could not map clubs to teams" });
    await logAttempt(norm, raw, "error", "resume merge could not map clubs to teams");
    return true;
  }

  const cache = new Map();
  const rows = [];
  for (const tid of [cand.home_team_id, cand.away_team_id]) {
    const c = clubByTeam[tid];
    for (const e of c.players) {
      const profile_id = await resolveProfile(e, cand.season_id, cache);
      rows.push({
        game_id: cand.id, team_id: tid, profile_id, skater_name: e.gamertag, position: e.position,
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
  await sbSend("DELETE", `game_stats?game_id=eq.${cand.id}`);
  if (rows.length) await sbSend("POST", "game_stats", rows, "return=minimal");
  await sbSend("PATCH", `games?id=eq.${cand.id}`,
    { home_score: homeClub.score, away_score: awayClub.score, went_ot: !!merged.went_ot,
      home_ppg: homeClub.ppg, home_ppo: homeClub.ppo, away_ppg: awayClub.ppg, away_ppo: awayClub.ppo },
    "return=minimal");

  // the first sitting already told everyone they lost 2-3; reissue from the merged truth
  await postGameRecaps({ id: cand.id, home_team_id: cand.home_team_id, away_team_id: cand.away_team_id },
    rows, homeClub.score, awayClub.score, summary).catch((e) =>
    console.warn("recap re-issue failed (the merge itself is unaffected):", String(e && e.message || e)));

  await logAttempt(norm, raw, "merged",
    `second sitting of a disconnected game — merged into ${cand.ea_match_id} (${priors.length + 1} sittings, ${totalLen}s)`, cand.id);
  summary.ingested.push({ ea_match_id: norm.ea_match_id, game_id: cand.id, merged_into: cand.ea_match_id,
    score: `${homeClub.score}-${awayClub.score}`, players: rows.length, resumed: true });
  return true;
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
  if (mine) return { ok: true, uid, who, via: "management", club: mine.code, teamId: mine.id };
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
      body: JSON.stringify({ content: text.slice(0, 1800), allowed_mentions: { parse: [] } }) });
  } catch { /* never breaks the merge */ }
}

/* KEEP IN SYNC with the row builders in ingestOne and the auto-resume path — same columns, same
   order, so a manually merged game is indistinguishable from an auto-ingested one downstream. */
async function leagueBoxRows(game, clubByTeam) {
  const cache = new Map();
  const rows = [];
  for (const tid of [game.home_team_id, game.away_team_id]) {
    const c = clubByTeam[tid];
    for (const e of c.players) {
      const profile_id = await resolveProfile(e, game.season_id, cache);
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
  return rows;
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  if (!SB_URL || !SB_KEY) return { statusCode: 500, body: JSON.stringify({ error: "Server not configured (SUPABASE_URL / SERVICE_ROLE_KEY)" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: e.message }) }; }

  const key = event.headers["x-ingest-key"] || event.headers["X-Ingest-Key"];
  const authed = INGEST_KEY && key === INGEST_KEY;

  /* ---- Manual lag-out merge (statistics staff): the override for the sittings the automatic
     resume-merge refused — too far apart, over the length cap, a missed poll, or a wrong call.
     Candidates come from ea_ingest_log, which archives every payload precisely so this stays
     possible after EA's short history ages out. Selection is HUMAN; the guards that make the
     auto path conservative deliberately do not apply here, except the ones that protect other
     games' data. */
  if (!authed && body && body.leagueCandidates) {
    const jwt = String(event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    const gameId = String(body.leagueCandidates.gameId || body.leagueCandidates);
    const game = (await sbGet(`games?id=eq.${encodeURIComponent(gameId)}&select=id,season_id,week,scheduled_at,status,home_team_id,away_team_id,ea_match_id,home_score,away_score`))[0];
    if (!game) return { statusCode: 404, body: JSON.stringify({ error: "No such game." }) };
    const actor = await authForGame(jwt, game);
    if (!actor.ok) return { statusCode: 401, body: JSON.stringify({ error: "Statistics staff, or the Owner/GM/AGM of a club in this game." }) };
    const teams = await sbGet(`teams?id=in.(${game.home_team_id},${game.away_team_id})&select=id,code,ea_club_id`);
    const home = teams.find((t) => t.id === game.home_team_id), away = teams.find((t) => t.id === game.away_team_id);
    if (!home || !away) return { statusCode: 422, body: JSON.stringify({ error: "This game's clubs no longer exist." }) };
    const linked = { home: home.ea_club_id != null, away: away.ea_club_id != null };
    const gameInfo = { id: game.id, week: game.week, status: game.status, home: home.code, away: away.code,
      score: game.status === "final" ? `${game.home_score}-${game.away_score}` : null };
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
    if (!actor.ok) return { statusCode: 401, body: JSON.stringify({ error: "Statistics staff, or the Owner/GM/AGM of a club in this game." }) };
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
    if (!actor.ok) return { statusCode: 401, body: JSON.stringify({ error: "Statistics staff, or the Owner/GM/AGM of a club in this game." }) };
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
    if (!actor.ok) return { statusCode: 401, body: JSON.stringify({ error: "Statistics staff, or the Owner/GM/AGM of a club in this game." }) };
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
    const game = (await sbGet(`games?id=eq.${encodeURIComponent(gameId)}&select=id,season_id,week,scheduled_at,status,home_team_id,away_team_id,ea_match_id,voided`))[0];
    if (!game) return { statusCode: 404, body: JSON.stringify({ error: "No such game." }) };
    const actor = await authForGame(jwt, game);
    if (!actor.ok) return { statusCode: 401, body: JSON.stringify({ error: "Statistics staff, or the Owner/GM/AGM of a club in this game." }) };
    if (game.voided) return { statusCode: 422, body: JSON.stringify({ error: "That game is voided." }) };
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
    await sbSend("DELETE", `game_stats?game_id=eq.${game.id}`);
    if (rows.length) await sbSend("POST", "game_stats", rows, "return=minimal");
    const homeClub = clubByTeam[game.home_team_id], awayClub = clubByTeam[game.away_team_id];
    await sbSend("PATCH", `games?id=eq.${game.id}`,
      { status: "final", home_score: homeClub.score, away_score: awayClub.score,
        ea_match_id: merged.ea_match_id, went_ot: !!merged.went_ot,
        /* real sittings supersede any forfeit ruling — a game that was actually played is not
           a forfeit (Rule 3.2's mutual-consent clause) */
        forfeit_team_id: null,
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
    /* provenance: the first sitting owns the game, the rest are merged — the SAME marks the
       automatic path leaves, so its dedupe logic treats this game identically from now on */
    const byWhom = actor.via === "management" ? `${actor.who} (${actor.club} management)` : `${actor.who} (stats staff)`;
    for (const row of logRows) {
      const first = row.ea_match_id === merged.ea_match_id;
      await sbSend("PATCH", `ea_ingest_log?ea_match_id=eq.${encodeURIComponent(row.ea_match_id)}`,
        { status: first ? "ingested" : "merged", game_id: game.id, reason: first
          ? `manual lag-out merge (${norms.length} sitting${norms.length === 1 ? "" : "s"}) by ${byWhom}`
          : `manually merged into ${merged.ea_match_id} by ${byWhom}` });
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
    const summary = { received: 1, ingested: [], skipped: [], unmatched: [], errors: [] };
    try {
      const norm = normalizeMatch(row.payload);
      if (!norm) summary.errors.push({ reason: "archived payload is unparseable" });
      else await ingestOne(norm, row.payload, summary, [norm]);
    } catch (e) { summary.errors.push({ ea_match_id: body.reingest, error: String(e.message || e) }); }
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(summary) };
  }

  if (!authed) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  const matchesRaw = Array.isArray(body) ? body : (Array.isArray(body.matches) ? body.matches : (body.matchId ? [body] : null));
  // oldest first: the first sitting of a disconnected game must be ingested before its resume
  const matches = matchesRaw && matchesRaw.slice().sort((a, b) => (+a?.timestamp || 0) - (+b?.timestamp || 0));
  if (!matches) return { statusCode: 400, body: JSON.stringify({ error: "Expected { matches: [...] } or a single match object." }) };

  const summary = { received: matches.length, ingested: [], skipped: [], unmatched: [], errors: [] };
  /* the whole batch, normalized, is the adjacency context: the resume check needs to see whether a
     club played someone else between two sittings, and the poll's per-club history is right here */
  const batch = matches.map((m) => { try { return normalizeMatch(m); } catch (e) { return null; } }).filter(Boolean);
  for (const raw of matches) {
    try {
      const norm = normalizeMatch(raw);
      if (!norm) { summary.errors.push({ reason: "unparseable match (need 2 clubs + matchId)" }); continue; }
      await ingestOne(norm, raw, summary, batch);
    } catch (e) {
      summary.errors.push({ ea_match_id: raw && raw.matchId, error: String(e.message || e) });
      // best-effort archive even when the attempt blew up, so the payload is never lost
      try { const n = normalizeMatch(raw); if (n) await logAttempt(n, raw, "error", String(e.message || e)); } catch {}
    }
  }
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(summary) };
};
