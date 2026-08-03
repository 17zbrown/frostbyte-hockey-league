// POST /api/pickup-import  — import an EASHL club-match box score as a PICKUP game.
// Pickup stats live in their own tables (pickup_games / pickup_stats) and are DISPLAY-ONLY:
// no league rule (eligibility, overall, standings, leaders) ever reads them.
//
// Actions (JSON body { action, ... }, caller must send Authorization: Bearer <supabase user JWT>):
//   { action: "search",  clubName }            -> [{ clubId, name, memberCount }]
//   { action: "matches", clubId }              -> [{ matchId, playedAt, a:{name,score}, b:{name,score}, wentOt }]
//   { action: "import",  clubId, matchId }     -> { ok, pickupGameId, players:[{name,profile_id,goals,...}], unmatched }
//
// EA blocks datacenter IPs, so EA calls go through the same residential proxy ea-poll uses (HTTPS_PROXY).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HTTPS_PROXY, optional PLATFORM. Node 18+.

const SB_URL = process.env.SUPABASE_URL;
const BOT = process.env.DISCORD_BOT_TOKEN;   // optional: lets an import announce + close its lobby room
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLATFORM = process.env.PLATFORM || "common-gen5";
const PROXY = process.env.HTTPS_PROXY;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const sbHeaders = (extra) => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...extra });
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${(await r.text()).slice(0, 140)}`);
  return r.json();
}
async function sbSend(method, path, body, prefer) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: sbHeaders(prefer ? { Prefer: prefer } : undefined),
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 140)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const reply = (obj, code) => ({ statusCode: code || 200, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });

/* ---------- close the lobby room a just-imported game came from ----------
   A pickup_games row carries no lobby reference, so the link is inferred from PEOPLE: the lobby
   whose Discord roster overlaps the imported box score's matched players. The bar is deliberately
   high — at least 6 of the lobby's 12, and a strictly unique best match — because the failure mode
   of a wrong guess is deleting a channel mid-draft. No match simply means the room waits for the
   staff Delete button or the 12-hour sweep, exactly as before. */
function matchLobbyForImport(lobbies, discordIds) {
  const ids = new Set(discordIds);
  let best = null, bestOverlap = 0, tied = false;
  for (const lo of lobbies || []) {
    const sign = ((lo.state && lo.state.signups) || []).map((x) => String(x.id));
    const overlap = sign.filter((id) => ids.has(id)).length;
    if (overlap > bestOverlap) { best = lo; bestOverlap = overlap; tied = false; }
    else if (overlap === bestOverlap && overlap > 0 && best && lo.id !== best.id) tied = true;
  }
  if (!best || bestOverlap < 6 || tied) return null;
  return { lobby: best, overlap: bestOverlap };
}
async function closePlayedLobby(rows) {
  const profileIds = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))];
  if (profileIds.length < 4) return null;   // too few matched accounts to identify a lobby safely
  const profs = await sbGet(`profiles?id=in.(${profileIds.join(",")})&select=id,discord_id`);
  const discordIds = profs.map((p) => String(p.discord_id || "")).filter(Boolean);
  if (discordIds.length < 4) return null;
  const lobbies = await sbGet("lfg_lobbies?thread_id=not.is.null&status=in.(captains,drafting,server,done)&select=id,thread_id,status,state");
  const hit = matchLobbyForImport(lobbies, discordIds);
  if (!hit) return null;
  if (BOT) {
    try {
      await fetch(`https://discord.com/api/v10/channels/${hit.lobby.thread_id}/messages`, {
        method: "POST", headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json", "User-Agent": "DiscordBot (https://chelgamingleague.com,1.0)" },
        body: JSON.stringify({ embeds: [{ title: "\uD83D\uDCCA Box score is in \u2014 GG!",
          description: `${hit.overlap} of this lobby's players matched the imported game. Stats are on your profiles at chelgamingleague.com \u2014 this channel clears itself in a couple of minutes.`,
          color: 0xFFE500 }] }), signal: AbortSignal.timeout(4000) });
    } catch (e) { /* the announcement is a courtesy; the close below is the point */ }
  }
  await sbSend("PATCH", `lfg_lobbies?id=eq.${hit.lobby.id}`, { status: "closed", updated_at: new Date().toISOString() });
  return { lobbyId: hit.lobby.id, overlap: hit.overlap };
}

// Verify the caller's Supabase JWT and return their auth user id (so an import is tied to a real login).
async function authUser(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json(); return u && u.id ? u.id : null;
  } catch (e) { return null; }
}

/* ---------- EA Pro Clubs (through the residential proxy) ---------- */
// Use undici's OWN fetch, not Node's global fetch: on Node 24 the global fetch silently drops the
// `dispatcher` option, so the ProxyAgent is ignored and EA sees the datacenter IP (403). undici.fetch
// honours dispatcher, routing the call through the residential proxy.
async function eaFetch(url) {
  const { ProxyAgent, fetch: uFetch } = await import("undici");
  const headers = {
    "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.ea.com/", "Origin": "https://www.ea.com",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-site",
  };
  // EA's NHL 26 API blocks intermittently by IP; a NEW ProxyAgent each attempt = a fresh IPRoyal
  // rotating IP, so a flaky 403 just retries on a different IP. Kept under Netlify's 10s fn timeout.
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const opts = { headers, signal: AbortSignal.timeout(2800) };
      if (PROXY) opts.dispatcher = new ProxyAgent(PROXY);
      /* undici's fetch exists ONLY to honour the dispatcher — with no proxy configured there is
         nothing to honour, and global fetch keeps the handler drivable by tests */
      const r = await (PROXY ? uFetch : fetch)(url, opts);
      if (r.ok) return r.json();
      last = `EA ${r.status}`;
      if (r.status !== 403) throw new Error(last);   // non-403 errors won't be fixed by another IP
    } catch (e) { last = String(e.message || e); }
  }
  throw new Error(`EA unreachable (${last}${last.includes("403") ? " — EA is throttling; try again in a moment" : ""})`);
}
const eaSearchClubs = (name) =>
  eaFetch(`https://proclubs.ea.com/api/nhl/clubs/search?platform=${PLATFORM}&clubName=${encodeURIComponent(name)}`);
const eaClubMatches = (clubId) =>
  eaFetch(`https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=${PLATFORM}&clubIds=${encodeURIComponent(clubId)}`);

/* ---------- EA position -> profile position ---------- */
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
// Normalize one raw EA match into { ea_match_id, played_at, clubs:[{ea_club_id,name,score,result,players[]}], went_ot }
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
        goals: +(p.skgoals || 0), assists: +(p.skassists || 0), shots: +(p.skshots || 0), hits: +(p.skhits || 0), pim: +(p.skpim || 0),
        plus_minus: +(p.skplusmin || 0), takeaways: +(p.sktakeaways || 0), giveaways: +(p.skgiveaways || 0),
        faceoffs_won: +(p.skfow || 0), faceoffs_lost: +(p.skfol || 0), time_on_ice_seconds: +(p.toiseconds || 0),
        is_goalie: isG,
        saves: isG ? +(p.glsaves || 0) : 0, shots_against: isG ? +(p.glshots || 0) : 0, goals_against: isG ? +(p.glga || 0) : 0,
        shutout: isG && +(p.glga || 0) === 0 && +(p.glshots || 0) > 0,
      };
    });
    return { ea_club_id: String(cid), name: c.details ? c.details.name : null, score: +(c.score || 0), result: +(c.result || 0), players };
  };
  const clubs = [club(clubIds[0]), club(clubIds[1])];
  return { ea_match_id: String(raw.matchId), played_at: raw.timestamp ? new Date(raw.timestamp * 1000).toISOString() : null,
           clubs, went_ot: clubs.some((c) => c.result === 5 || c.result === 6) };
}
/* Merge several normalized sessions of ONE game (a lagout chain) into a single box score.
   Sides are aligned by ea_club_id — EA does not promise the same club order across matches, and
   summing Home's stats into Away's would be a quiet catastrophe. Counting stats sum per player
   (someone who missed the resume keeps their first-session line); the score aggregates because the
   resume plays only the remaining time; overtime counts only if the DECIDING session went to OT;
   shutouts are re-judged on the combined goals against. */
const MERGE_SUM = ["goals","assists","shots","hits","pim","plus_minus","takeaways","giveaways",
  "faceoffs_won","faceoffs_lost","time_on_ice_seconds","saves","shots_against","goals_against"];
function mergeMatches(norms) {
  if (!Array.isArray(norms) || norms.length < 2) throw new Error("nothing to merge");
  norms = norms.slice().sort((a, b) => String(a.played_at || "").localeCompare(String(b.played_at || "")));
  const base = norms[0];
  const ids = base.clubs.map((c) => c.ea_club_id);
  const pairKey = ids.slice().sort().join("|");
  for (const nrm of norms.slice(1)) {
    if (nrm.clubs.map((c) => c.ea_club_id).sort().join("|") !== pairKey)
      throw new Error("Those sessions aren't all between the same two clubs — a lagout chain always is.");
  }
  const clubs = ids.map((cid) => {
    const byPlayer = {};
    let score = 0;
    for (const nrm of norms) {
      const side = nrm.clubs.find((c) => c.ea_club_id === cid);
      score += side.score || 0;
      for (const p of side.players) {
        const cur = byPlayer[p.ea_player_id];
        if (!cur) byPlayer[p.ea_player_id] = { ...p };
        else {
          MERGE_SUM.forEach((k) => { cur[k] = (cur[k] || 0) + (p[k] || 0); });
          cur.is_goalie = cur.is_goalie || p.is_goalie;
        }
      }
    }
    const players = Object.values(byPlayer);
    players.forEach((p) => { if (p.is_goalie) p.shutout = (p.goals_against || 0) === 0 && (p.shots_against || 0) > 0; });
    const first = base.clubs.find((c) => c.ea_club_id === cid);
    return { ea_club_id: cid, name: first.name, score, result: 0, players };
  });
  return {
    ea_match_id: base.ea_match_id,
    ea_match_ids: norms.map((nrm) => nrm.ea_match_id),
    played_at: base.played_at,
    went_ot: !!norms[norms.length - 1].went_ot,
    clubs,
  };
}
// Best-effort EA player -> CGHL profile (prior pickup link, then site gamertag).
async function resolveProfile(entry, cache) {
  if (cache.has(entry.ea_player_id)) return cache.get(entry.ea_player_id);
  let pid = null;
  const gt = (entry.gamertag || "").replace(/[%,()]/g, "").trim();
  const eid = encodeURIComponent(entry.ea_player_id);
  // prior EA-persona link, from pickups OR from league box scores (read-only; league data is untouched)
  let prev = await sbGet(`pickup_stats?ea_player_id=eq.${eid}&profile_id=not.is.null&select=profile_id&limit=1`);
  if (!prev[0]) prev = await sbGet(`game_stats?ea_player_id=eq.${eid}&profile_id=not.is.null&select=profile_id&limit=1`);
  if (prev[0]) pid = prev[0].profile_id;
  // Match the EA gamertag from the box score to the EA ID the player entered on their profile
  // (profiles.ea_id) — NOT their site gamertag/display name.
  if (!pid && gt) { const pr = await sbGet(`profiles?ea_id=ilike.${encodeURIComponent(gt)}&select=id&limit=1`); if (pr[0]) pid = pr[0].id; }
  cache.set(entry.ea_player_id, pid); return pid;
}

export const _internals = { matchLobbyForImport, normalizeMatch, mapPos, mergeMatches };

export const handler = async (event) => {
  // temp diag: is the residential proxy set, and does an EA call through it work?
  if (event.httpMethod === "GET" && (event.queryStringParameters || {}).diag === "puproxy9") {
    const out = { proxySet: !!PROXY, node: process.version };
    const { ProxyAgent, fetch: uFetch } = await import("undici");
    try { const d = await uFetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(6000) }); out.directIp = (await d.json()).ip; } catch (e) { out.directIp = "err: " + String(e.message || e); }
    if (PROXY) { try { const d = await uFetch("https://api.ipify.org?format=json", { dispatcher: new ProxyAgent(PROXY), signal: AbortSignal.timeout(9000) }); out.proxyIp = (await d.json()).ip; } catch (e) { out.proxyIp = "err: " + String(e.message || e); } }
    out.proxyApplied = out.proxyIp && out.proxyIp !== out.directIp && !String(out.proxyIp).startsWith("err");
    try { const d = await eaFetch(`https://proclubs.ea.com/api/nhl/clubs/search?platform=${PLATFORM}&clubName=test`); out.eaTest = "ok"; out.shape = Array.isArray(d) ? ("array " + d.length) : ("obj " + Object.keys(d || {}).length); }
    catch (e) { out.eaTest = String(e.message || e); }
    return reply(out);
  }
  if (event.httpMethod !== "POST") return reply({ error: "POST only" }, 405);
  if (!SB_URL || !SB_KEY) return reply({ error: "server not configured" }, 500);
  const h = event.headers || {};
  const token = String(h.authorization || h.Authorization || "").replace(/^Bearer\s+/i, "");
  const uid = await authUser(token);
  if (!uid) return reply({ error: "Sign in to import a game." }, 401);

  let body; try { body = JSON.parse(event.body || "{}"); } catch (e) { return reply({ error: "bad json" }, 400); }
  const action = body.action;

  try {
    if (action === "search") {
      const name = String(body.clubName || "").trim();
      if (name.length < 2) return reply({ error: "Enter at least 2 characters." }, 400);
      const data = await eaSearchClubs(name);
      // EA returns an object keyed by clubId (or sometimes an array); normalize to a small list.
      const list = Array.isArray(data)
        ? data.map((c) => ({ clubId: String(c.clubId || c.clubInfo?.clubId || ""), name: c.name || c.clubInfo?.name, memberCount: c.memberCount }))
        : Object.entries(data || {}).map(([clubId, c]) => ({ clubId: String((c && c.clubId) || clubId), name: (c && (c.name || (c.clubInfo && c.clubInfo.name))) || null, memberCount: c && c.memberCount }));
      return reply({ clubs: list.filter((c) => c.clubId && c.name).slice(0, 15) });
    }

    if (action === "matches") {
      const clubId = String(body.clubId || "").trim();
      if (!clubId) return reply({ error: "Missing clubId." }, 400);
      const raw = await eaClubMatches(clubId);
      const list = (Array.isArray(raw) ? raw : []).map((m) => {
        const n = normalizeMatch(m); if (!n) return null;
        /* the longest time-on-ice in the match is the best proxy for how much game was played —
           the UI flags visibly short sessions as likely lagout fragments */
        const toi = n.clubs.flatMap((c) => c.players.map((p) => p.time_on_ice_seconds || 0));
        return { matchId: n.ea_match_id, playedAt: n.played_at, wentOt: n.went_ot,
          minutes: Math.round(Math.max(0, ...toi) / 60),
          a: { name: n.clubs[0].name, score: n.clubs[0].score }, b: { name: n.clubs[1].name, score: n.clubs[1].score } };
      }).filter(Boolean);
      return reply({ matches: list });
    }

    if (action === "import") {
      const clubId = String(body.clubId || "").trim();
      /* one id imports a game; several ids merge a lagout chain into ONE game */
      const matchIds = (Array.isArray(body.matchIds) && body.matchIds.length
        ? body.matchIds : (body.matchId != null ? [body.matchId] : [])).map((x) => String(x).trim()).filter(Boolean);
      if (!clubId || !matchIds.length) return reply({ error: "Missing clubId/matchId." }, 400);
      if (matchIds.length > 4) return reply({ error: "That's more than four sessions — a lagout chain shouldn't need that. Merge fewer." }, 400);
      if (new Set(matchIds).size !== matchIds.length) return reply({ error: "The same session is selected twice." }, 400);

      /* already imported? Any selected session — whether it was a game of its own OR a segment of
         an earlier merge — refuses the whole import, or a merged game could be double-counted one
         session at a time. */
      const idList = matchIds.map(encodeURIComponent).join(",");
      const dup = await sbGet(`pickup_games?or=(ea_match_id.in.(${idList}),ea_match_ids.ov.{${idList}})&select=id&limit=1`);
      if (dup[0]) return reply({ error: matchIds.length > 1
        ? "One of those sessions is already part of an imported game." : "That game was already imported.", pickupGameId: dup[0].id }, 409);

      const raw = await eaClubMatches(clubId);
      const picked = matchIds.map((id) => (Array.isArray(raw) ? raw : []).find((m) => String(m.matchId) === id));
      if (picked.some((m) => !m)) return reply({ error: "A selected match is no longer in the club's recent history (EA only keeps the last few). Use the screenshot importer instead." }, 404);
      const norms = picked.map(normalizeMatch);
      if (norms.some((nrm) => !nrm)) return reply({ error: "Couldn't read one of those matches (need exactly 2 clubs)." }, 422);
      let norm;
      try { norm = matchIds.length > 1 ? mergeMatches(norms) : { ...norms[0], ea_match_ids: [norms[0].ea_match_id] }; }
      catch (e) { return reply({ error: String(e.message || e) }, 422); }

      // resolve profiles for both clubs' players
      const cache = new Map();
      const sides = ["A", "B"];
      const rows = [];
      const preview = [];
      for (let i = 0; i < 2; i++) {
        for (const p of norm.clubs[i].players) {
          const profile_id = await resolveProfile(p, cache);
          rows.push({ profile_id, ea_player_id: p.ea_player_id, skater_name: p.gamertag, team_side: sides[i], position: p.position,
            goals: p.goals, assists: p.assists, shots: p.shots, hits: p.hits, pim: p.pim, plus_minus: p.plus_minus,
            takeaways: p.takeaways, giveaways: p.giveaways, faceoffs_won: p.faceoffs_won, faceoffs_lost: p.faceoffs_lost,
            time_on_ice_seconds: p.time_on_ice_seconds, is_goalie: p.is_goalie, saves: p.saves, shots_against: p.shots_against,
            goals_against: p.goals_against, shutout: p.shutout });
          preview.push({ name: p.gamertag, matched: !!profile_id, side: sides[i], goals: p.goals, assists: p.assists });
        }
      }

      const imgProfile = await sbGet(`profiles?id=eq.${uid}&select=id&limit=1`).catch(() => []);
      const game = await sbSend("POST", "pickup_games?select=id", {
        ea_match_id: norm.ea_match_id, ea_match_ids: norm.ea_match_ids, source: "ea", played_at: norm.played_at,
        club_a: norm.clubs[0].name, club_b: norm.clubs[1].name, score_a: norm.clubs[0].score, score_b: norm.clubs[1].score,
        went_ot: norm.went_ot, imported_by: (imgProfile[0] && imgProfile[0].id) || null,
      }, "return=representation");
      const pickupGameId = Array.isArray(game) ? game[0].id : game.id;
      await sbSend("POST", "pickup_stats", rows.map((r) => ({ ...r, pickup_game_id: pickupGameId })), "return=minimal");

      const unmatched = preview.filter((p) => !p.matched).length;
      /* if this game came out of a Discord pickup lobby, thank the room and let the sweep clear it */
      let lobbyClosed = null;
      try { lobbyClosed = await closePlayedLobby(rows); } catch (e) { /* never fail an import over cleanup */ }
      return reply({ ok: true, pickupGameId, players: preview, unmatched, lobbyClosed, sessions: matchIds.length });
    }

    return reply({ error: "Unknown action." }, 400);
  } catch (e) {
    return reply({ error: String(e.message || e) }, 200);
  }
};
