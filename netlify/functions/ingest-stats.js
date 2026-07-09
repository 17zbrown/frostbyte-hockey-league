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
        is_goalie: isG,
        saves: isG ? +(p.glsaves || 0) : 0, shots_against: isG ? +(p.glshots || 0) : 0, goals_against: isG ? +(p.glga || 0) : 0
      };
    });
    return { ea_club_id: String(cid), name: c.details ? c.details.name : null, score: +(c.score || 0), players };
  };
  return { ea_match_id: String(raw.matchId), et_day: etDayUnix(raw.timestamp), clubs: [club(clubIds[0]), club(clubIds[1])] };
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

// ---- Ingest ONE normalized match ----
async function ingestOne(norm, summary) {
  // dedupe
  const dup = await sbGet(`games?ea_match_id=eq.${encodeURIComponent(norm.ea_match_id)}&select=id&limit=1`);
  if (dup[0]) { summary.skipped.push({ ea_match_id: norm.ea_match_id, reason: "already ingested" }); return; }

  // map both clubs -> our teams
  const ids = norm.clubs.map((c) => c.ea_club_id);
  const teams = await sbGet(`teams?ea_club_id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,ea_club_id`);
  if (teams.length < 2) { summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: "one or both clubs not registered (teams.ea_club_id)" }); return; }
  const teamByClub = Object.fromEntries(teams.map((t) => [String(t.ea_club_id), t.id]));
  const tA = teamByClub[ids[0]], tB = teamByClub[ids[1]];

  // find a scheduled, not-yet-ingested game between these two clubs on the same ET day
  const or = `or=(and(home_team_id.eq.${tA},away_team_id.eq.${tB}),and(home_team_id.eq.${tB},away_team_id.eq.${tA}))`;
  const games = await sbGet(`games?${or}&ea_match_id=is.null&select=id,scheduled_at,home_team_id,away_team_id,season_id`);
  const game = games.find((g) => etDayISO(g.scheduled_at) === norm.et_day);
  if (!game) { summary.unmatched.push({ ea_match_id: norm.ea_match_id, reason: `no scheduled game for these clubs on ${norm.et_day}` }); return; }

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
        faceoffs_won: e.faceoffs_won, faceoffs_lost: e.faceoffs_lost, time_on_ice_seconds: e.time_on_ice_seconds
      });
    }
  }
  await sbSend("DELETE", `game_stats?game_id=eq.${game.id}`);
  if (rows.length) await sbSend("POST", "game_stats", rows, "return=minimal");
  // flip the game to final LAST — this fires notify_discord_game_final + updates standings
  await sbSend("PATCH", `games?id=eq.${game.id}`,
    { status: "final", home_score: homeScore, away_score: awayScore, ea_match_id: norm.ea_match_id },
    "return=minimal");

  const linked = rows.filter((r) => r.profile_id).length;
  summary.ingested.push({ ea_match_id: norm.ea_match_id, game_id: game.id, score: `${homeScore}-${awayScore}`, players: rows.length, linked });
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  if (!SB_URL || !SB_KEY) return { statusCode: 500, body: JSON.stringify({ error: "Server not configured (SUPABASE_URL / SERVICE_ROLE_KEY)" }) };
  const key = event.headers["x-ingest-key"] || event.headers["X-Ingest-Key"];
  if (!INGEST_KEY || key !== INGEST_KEY) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  let matches;
  try {
    const body = JSON.parse(event.body || "{}");
    matches = Array.isArray(body) ? body : (Array.isArray(body.matches) ? body.matches : (body.matchId ? [body] : null));
    if (!matches) throw new Error("Expected { matches: [...] } or a single match object.");
  } catch (e) { return { statusCode: 400, body: JSON.stringify({ error: e.message }) }; }

  const summary = { received: matches.length, ingested: [], skipped: [], unmatched: [], errors: [] };
  for (const raw of matches) {
    try {
      const norm = normalizeMatch(raw);
      if (!norm) { summary.errors.push({ reason: "unparseable match (need 2 clubs + matchId)" }); continue; }
      await ingestOne(norm, summary);
    } catch (e) {
      summary.errors.push({ ea_match_id: raw && raw.matchId, error: String(e.message || e) });
    }
  }
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(summary) };
};
