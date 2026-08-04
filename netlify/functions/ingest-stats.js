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
async function resolveProfile(entry, seasonId, cache) {
  if (cache.has(entry.ea_player_id)) return cache.get(entry.ea_player_id);
  let pid = null;
  const gt = (entry.gamertag || "").replace(/[%,()]/g, "").trim();
  if (gt) {
    // 1) prior link by EA persona id
    const prev = await sbGet(`game_stats?ea_player_id=eq.${encodeURIComponent(entry.ea_player_id)}&profile_id=not.is.null&select=profile_id&limit=1`);
    if (prev[0]) pid = prev[0].profile_id;
    // 2) site gamertag
    if (!pid) { const pr = await sbGet(`profiles?gamertag=ilike.${encodeURIComponent(gt)}&select=id&limit=1`); if (pr[0]) pid = pr[0].id; }
    // 3) EA id captured at signup for this season
    if (!pid && seasonId) { const rg = await sbGet(`season_registrations?season_id=eq.${seasonId}&ea_id=ilike.${encodeURIComponent(gt)}&select=profile_id&limit=1`); if (rg[0]) pid = rg[0].profile_id; }
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

export const _internals = { normalizeMatch, mergeSegments, segElapsed, isStatsStaff };

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
  summary.ingested.push({ ea_match_id: norm.ea_match_id, game_id: game.id, score: `${homeScore}-${awayScore}`, players: rows.length, linked });
  await logAttempt(norm, raw, "ingested", `${homeScore}-${awayScore}, ${rows.length} players (${linked} linked)`, game.id);
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
    if (!jwt || !(await isStatsStaff(jwt))) return { statusCode: 401, body: JSON.stringify({ error: "Statistics staff only." }) };
    const gameId = String(body.leagueCandidates.gameId || body.leagueCandidates);
    const game = (await sbGet(`games?id=eq.${encodeURIComponent(gameId)}&select=id,season_id,week,scheduled_at,status,home_team_id,away_team_id,ea_match_id,home_score,away_score`))[0];
    if (!game) return { statusCode: 404, body: JSON.stringify({ error: "No such game." }) };
    const teams = await sbGet(`teams?id=in.(${game.home_team_id},${game.away_team_id})&select=id,code,ea_club_id`);
    const home = teams.find((t) => t.id === game.home_team_id), away = teams.find((t) => t.id === game.away_team_id);
    if (!home || !away || !home.ea_club_id || !away.ea_club_id)
      return { statusCode: 422, body: JSON.stringify({ error: "Both clubs need their EA club id linked (EA stats tab) before sittings can be found." }) };
    const dayS = Math.floor(Date.parse(game.scheduled_at) / 1000);
    const days = [etDayUnix(dayS - 86400), etDayUnix(dayS), etDayUnix(dayS + 86400)];
    const logRows = await sbGet(`ea_ingest_log?ea_club_ids=cs.{${encodeURIComponent(home.ea_club_id)},${encodeURIComponent(away.ea_club_id)}}` +
      `&et_day=in.(${days.map(encodeURIComponent).join(",")})&select=ea_match_id,status,game_id,et_day,payload&order=et_day`);
    const pair = [String(home.ea_club_id), String(away.ea_club_id)].sort().join("|");
    const candidates = [];
    for (const row of logRows || []) {
      const nrm = normalizeMatch(row.payload); if (!nrm) continue;
      if (nrm.clubs.map((c) => c.ea_club_id).sort().join("|") !== pair) continue;
      const homeClub = nrm.clubs.find((c) => c.ea_club_id === String(home.ea_club_id));
      const awayClub = nrm.clubs.find((c) => c.ea_club_id === String(away.ea_club_id));
      candidates.push({
        matchId: nrm.ea_match_id, ts: nrm.ts, minutes: Math.round(segElapsed(nrm) / 60),
        homeScore: homeClub.score, awayScore: awayClub.score, status: row.status,
        attached: row.game_id === game.id || game.ea_match_id === nrm.ea_match_id,
        usedElsewhere: !!(row.game_id && row.game_id !== game.id)
      });
    }
    candidates.sort((x, y) => (x.ts || 0) - (y.ts || 0));
    return { statusCode: 200, body: JSON.stringify({ game: { id: game.id, week: game.week, status: game.status,
      home: home.code, away: away.code, score: game.status === "final" ? `${game.home_score}-${game.away_score}` : null }, candidates }) };
  }

  if (!authed && body && body.leagueMerge) {
    const jwt = String(event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    if (!jwt || !(await isStatsStaff(jwt))) return { statusCode: 401, body: JSON.stringify({ error: "Statistics staff only." }) };
    const gameId = String(body.leagueMerge.gameId || "");
    const matchIds = (Array.isArray(body.leagueMerge.matchIds) ? body.leagueMerge.matchIds : []).map(String).filter(Boolean);
    if (!gameId || !matchIds.length) return { statusCode: 400, body: JSON.stringify({ error: "Missing gameId/matchIds." }) };
    if (matchIds.length > 4) return { statusCode: 400, body: JSON.stringify({ error: "Four sittings is the limit." }) };
    if (new Set(matchIds).size !== matchIds.length) return { statusCode: 400, body: JSON.stringify({ error: "The same sitting is selected twice." }) };
    const game = (await sbGet(`games?id=eq.${encodeURIComponent(gameId)}&select=id,season_id,week,scheduled_at,status,home_team_id,away_team_id,ea_match_id,voided`))[0];
    if (!game) return { statusCode: 404, body: JSON.stringify({ error: "No such game." }) };
    if (game.voided) return { statusCode: 422, body: JSON.stringify({ error: "That game is voided." }) };
    const teams = await sbGet(`teams?id=in.(${game.home_team_id},${game.away_team_id})&select=id,code,ea_club_id`);
    const home = teams.find((t) => t.id === game.home_team_id), away = teams.find((t) => t.id === game.away_team_id);
    if (!home || !away || !home.ea_club_id || !away.ea_club_id)
      return { statusCode: 422, body: JSON.stringify({ error: "Both clubs need their EA club id linked first." }) };
    /* the sitting already on the game must be part of the selection — leaving it out would orphan
       a box score the standings already counted */
    if (game.ea_match_id && matchIds.indexOf(String(game.ea_match_id)) < 0)
      return { statusCode: 422, body: JSON.stringify({ error: `Include the sitting already on this game (${game.ea_match_id}) in the selection — the merge REPLACES the box score.` }) };
    const logRows = await sbGet(`ea_ingest_log?ea_match_id=in.(${matchIds.map(encodeURIComponent).join(",")})&select=ea_match_id,status,game_id,payload`);
    if ((logRows || []).length !== matchIds.length)
      return { statusCode: 404, body: JSON.stringify({ error: "A selected sitting has no archived payload — it was never seen by the poller." }) };
    const stolen = logRows.find((r) => r.game_id && r.game_id !== game.id);
    if (stolen) return { statusCode: 422, body: JSON.stringify({ error: `Sitting ${stolen.ea_match_id} already belongs to another game — it can't be merged here.` }) };
    const pair = [String(home.ea_club_id), String(away.ea_club_id)].sort().join("|");
    const norms = [];
    for (const row of logRows) {
      const nrm = normalizeMatch(row.payload);
      if (!nrm) return { statusCode: 422, body: JSON.stringify({ error: `Couldn't read sitting ${row.ea_match_id}.` }) };
      if (nrm.clubs.map((c) => c.ea_club_id).sort().join("|") !== pair)
        return { statusCode: 422, body: JSON.stringify({ error: `Sitting ${nrm.ea_match_id} is not between ${home.code} and ${away.code}.` }) };
      norms.push(nrm);
    }
    norms.sort((x, y) => (x.ts || 0) - (y.ts || 0));
    const merged = norms.length > 1 ? mergeSegments(norms) : norms[0];
    if (merged.error) return { statusCode: 422, body: JSON.stringify({ error: merged.error }) };
    const clubByClubId = Object.fromEntries(merged.clubs.map((c) => [String(c.ea_club_id), c]));
    const clubByTeam = { [game.home_team_id]: clubByClubId[String(home.ea_club_id)], [game.away_team_id]: clubByClubId[String(away.ea_club_id)] };
    const rows = await leagueBoxRows(game, clubByTeam);
    await sbSend("DELETE", `game_stats?game_id=eq.${game.id}`);
    if (rows.length) await sbSend("POST", "game_stats", rows, "return=minimal");
    const homeClub = clubByTeam[game.home_team_id], awayClub = clubByTeam[game.away_team_id];
    await sbSend("PATCH", `games?id=eq.${game.id}`,
      { status: "final", home_score: homeClub.score, away_score: awayClub.score,
        ea_match_id: merged.ea_match_id, went_ot: !!merged.went_ot,
        home_ppg: homeClub.ppg || 0, home_ppo: homeClub.ppo || 0, away_ppg: awayClub.ppg || 0, away_ppo: awayClub.ppo || 0 },
      "return=minimal");
    /* provenance: the first sitting owns the game, the rest are merged — the SAME marks the
       automatic path leaves, so its dedupe logic treats this game identically from now on */
    for (const row of logRows) {
      const first = row.ea_match_id === merged.ea_match_id;
      await sbSend("PATCH", `ea_ingest_log?ea_match_id=eq.${encodeURIComponent(row.ea_match_id)}`,
        { status: first ? "ingested" : "merged", game_id: game.id, reason: first
          ? `manual lag-out merge (${norms.length} sitting${norms.length === 1 ? "" : "s"})`
          : `manually merged into ${merged.ea_match_id}` });
    }
    const linked = rows.filter((r) => r.profile_id).length;
    return { statusCode: 200, body: JSON.stringify({ ok: true, gameId: game.id,
      score: `${homeClub.score}-${awayClub.score}`, wentOt: !!merged.went_ot,
      sittings: norms.length, players: rows.length, linked }) };
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
