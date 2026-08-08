// Netlify Scheduled Function — keeps Discord in sync with the site every 5 min.
//  (1) Username sync: sets each profile's gamertag to the member's current Discord
//      display name (server nick > global name > username), so name changes flow in.
//  (2) Role sync: reconciles each member's MANAGED Discord roles with the DB —
//      team role (from their roster spot), Owner/GM/AGM (from the team's front-office
//      slots), Commissioner (league role), Player, Free Agent, and a position role
//      (Center/Left Wing/Right Wing/Left Defense/Right Defense/Goalie, auto-created).
//      Never touches non-managed roles (boosters, custom, etc.).
//  (3) Server resolution: once a game's 30-min pick-lock passes, compute its
//      server from the teams' private veto/preference picks (auto-fills the match card).
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/* The role rules are SHARED with the Oracle gateway bot (bot/role-sync.mjs), which applies the
   same computation the moment a member's database row changes instead of on the next sweep. Both
   sides importing one module is what stops the two processes from ever disagreeing about what a
   member's roles should be — they can only disagree about when. */
import { STAFF_DEPARTMENTS, POS_LABEL, POSITION_ROLES, MANAGED_STATIC,
  desiredRolesFor, applyManagedRoles, managedRoleIds } from "../../shared/roles.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));

// Env: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// No-ops safely if the bot token / guild id aren't set. Node 18+ (global fetch).

export const config = { schedule: "*/2 * * * *" };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const UA = "DiscordBot (https://chelgamingleague.com,1.0)";

const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });

// A transient network failure ("fetch failed" from undici — a DNS blip, connection reset, or
// timeout) throws BEFORE any HTTP response, so the 429 handling in dApi never sees it and one blip
// aborts the whole sweep (this is what kept failing lockPrivate). Retry the fetch itself a few
// times with backoff so a momentary hiccup doesn't fail the run.
async function rfetch(url, opts, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); }
    catch (e) { err = e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
  }
  throw err;
}

// This endpoint is publicly HTTP-invocable (the site pings it for instant sync). Debounce so a
// flood of anonymous POSTs can't drive endless Discord/DB work. Fail-open on any guard error.
async function ranRecently(key, sec) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/app_config?key=eq.rl_${key}&select=value`, { headers: sbHead() });
    const rows = await r.json();
    const last = rows && rows[0] && rows[0].value ? Date.parse(rows[0].value) : 0;
    if (Date.now() - last < sec * 1000) return true;
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: `rl_${key}`, value: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    return false;
  } catch (e) { return false; }
}
async function sbGet(path) {
  const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbPatch(path, body) {
  const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { method: "PATCH", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status} ${await r.text()}`);
}
async function dApi(method, path, body) {
  // Retry on 429 (respect Retry-After) so a busy run doesn't skip members and mis-flag them.
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await rfetch(`https://discord.com/api/v10${path}`, {
      method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (r.status === 404) return { __notfound: true };
    if (r.status === 429) { const ra = +(r.headers.get("retry-after") || 1); await new Promise((res) => setTimeout(res, ra * 1000 + 250)); continue; }
    // A Discord-side 5xx is transient. Only 429 was retried, so one blip aborted the sweep.
    if (r.status >= 500) { await new Promise((res) => setTimeout(res, 600 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  throw new Error(`${method} ${path} -> rate-limited after retries`);
}

async function sbPost(path, body, prefer) {
  const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { method: "POST",
    headers: { ...sbHead(), Prefer: prefer || "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

// Discord channel-name slug (lowercase, hyphens) to compare against team names
function slug(n) { return String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

/* ---- who left the server ----------------------------------------------------------------
   Discord keeps no "who left" record and this league runs no gateway bot, so a departure is only
   ever visible as the difference between two census sweeps. The census above already pulls the
   whole member list; this gives it a memory to diff against and posts what changed into a
   commissioner-only room.

   The one thing that must never happen is a false mass-departure. Three guards:
     1. memberListOk — set only AFTER every page came back, so a throw mid-pagination leaves it
        false and this is skipped entirely.
     2. an empty census is treated as a failed one, never as "everybody left".
     3. a drop of more than a quarter of the server in a single 2-minute tick is recorded but NOT
        announced, and flagged in the run result instead. Real servers do not do that; a partial
        read does.
*/
const DEPART_SANITY = 0.25;
async function trackDepartures(memberById, memberListOk, links, teams, sum) {
  if (!memberListOk || memberById.size === 0) { sum.departSkipped = "no complete census"; return; }
  let known = [];
  try { known = await sbGet("guild_members?present=is.true&select=discord_id,username,display_name,profile_id,joined_guild_at,is_bot"); }
  catch (e) { sum.errors.push({ departLoad: String(e.message || e) }); return; }

  const now = new Date().toISOString();
  const profByDiscord = new Map(links.filter((l) => l.discord_id).map((l) => [String(l.discord_id), l]));
  const codeByTeam = Object.fromEntries((teams || []).map((t) => [t.id, t.code]));
  /* whether a leaver had signed up for the season is the part a commissioner actually reacts to,
     so it is worth one small extra read */
  let registered = new Set();
  try { registered = new Set((await sbGet("season_registrations?select=profile_id")).map((r) => r.profile_id)); }
  catch (e) { /* the log is still worth writing without it */ }

  // 1) everyone seen now is present
  const rows = [...memberById.entries()].map(([id, m]) => {
    const link = profByDiscord.get(id);
    return { discord_id: id,
      username: (m.user && (m.user.username || m.user.global_name)) || null,
      display_name: m.nick || (m.user && m.user.global_name) || null,
      profile_id: (link && link.profile_id) || null,
      is_bot: !!(m.user && m.user.bot),
      joined_guild_at: m.joined_at || null,
      last_seen: now, present: true };
  });
  try {
    for (let i = 0; i < rows.length; i += 200) {
      await sbPost("guild_members?on_conflict=discord_id", rows.slice(i, i + 200), "resolution=merge-duplicates,return=minimal");
    }
  } catch (e) { sum.errors.push({ departUpsert: String(e.message || e) }); return; }

  // 2) anyone we knew about who is no longer in the list has left
  const gone = known.filter((k) => !memberById.has(String(k.discord_id)));
  sum.departed = gone.length;
  if (!gone.length) return;
  const share = known.length ? gone.length / known.length : 0;
  const suspicious = share > DEPART_SANITY && gone.length > 5;

  for (const g of gone) {
    const link = profByDiscord.get(String(g.discord_id));
    const days = g.joined_guild_at ? Math.max(0, Math.round((Date.now() - Date.parse(g.joined_guild_at)) / 86400000)) : null;
    try {
      await sbPost("guild_departures", [{
        discord_id: g.discord_id, username: g.username, display_name: g.display_name,
        profile_id: g.profile_id || (link && link.profile_id) || null,
        joined_guild_at: g.joined_guild_at, left_at: now, days_in_server: days,
        was_registered: registered.has(g.profile_id || (link && link.profile_id)),
        club: (link && codeByTeam[link.team_id]) || null,
        had_roles: null
      }]);
      await sbPatch(`guild_members?discord_id=eq.${encodeURIComponent(g.discord_id)}`, { present: false, last_seen: now });
    } catch (e) { sum.errors.push({ departWrite: g.discord_id, error: String(e.message || e) }); }
  }

  if (suspicious) {
    sum.departSuspicious = `${gone.length}/${known.length} in one tick — recorded, not announced`;
    sum.errors.push({ departSanity: sum.departSuspicious });
    return;
  }
  await announceDepartures(gone, profByDiscord, codeByTeam, registered, sum);
}

/* The commissioner-only room the log posts into. Created private in the SAME call that denies
   @everyone, so it is never briefly visible. Commissioners only — deliberately NOT the staff role,
   because who left is league-office information and the ask was commissioners. */
async function ensureDeparturesChannel(guildChannels, roleId, sum) {
  const commish = roleId["commissioner"];
  if (!commish) return null;
  const NAME = "member-departures";
  let ch = guildChannels.find((c) => c.type === 0 && c.name === NAME);
  if (ch) return ch;
  let cat = guildChannels.find((c) => c.type === 4 && /^staff\b/i.test(c.name || ""));
  try {
    ch = await dApi("POST", `/guilds/${GUILD}/channels`, {
      name: NAME, type: 0, parent_id: cat ? cat.id : undefined,
      topic: "Who left the server, posted automatically. Commissioners only.",
      permission_overwrites: [
        { id: GUILD, type: 0, deny: "1024", allow: "0" },          /* @everyone: no VIEW */
        { id: commish, type: 0, allow: "68608", deny: "0" }        /* VIEW + SEND + READ_HISTORY */
      ]
    });
    if (ch && ch.id) {
      guildChannels.push(ch);
      sum.departChanCreated = 1;
      /* the category may be readable by staff, so re-deny at the channel to keep it commissioner-only */
      await dApi("POST", `/channels/${ch.id}/messages`, { embeds: [{
        title: "👋 Member departures",
        description: "Anyone who leaves the server is logged here within a couple of minutes, with how long they were around and whether they had signed up or held a club seat.\n\nDiscord does not tell a bot who left unless it is running a live gateway connection, so this is worked out by comparing each member sweep to the last one. A sweep that fails is skipped rather than guessed at, so a quiet day here means a quiet day, not a broken job.",
        color: 0xFFE500 }] });
    }
    return ch;
  } catch (e) { sum.errors.push({ departChan: String(e.message || e) }); return null; }
}

async function announceDepartures(gone, profByDiscord, codeByTeam, registered, sum) {
  const chId = sum.__departChanId;
  if (!chId) { sum.departUnannounced = gone.length; return; }
  /* one message per departure, so each can be replied to — a thread on "why did X leave" is a
     normal thing for a league office to want */
  for (const g of gone) {
    const link = profByDiscord.get(String(g.discord_id));
    const pid = g.profile_id || (link && link.profile_id);
    const club = link && codeByTeam[link.team_id];
    const days = g.joined_guild_at ? Math.max(0, Math.round((Date.now() - Date.parse(g.joined_guild_at)) / 86400000)) : null;
    const who = g.display_name || g.username || (link && link.gamertag) || g.discord_id;
    const fields = [];
    if (link && link.gamertag) fields.push({ name: "Site account", value: String(link.gamertag), inline: true });
    if (club) fields.push({ name: "Club", value: String(club), inline: true });
    if (days != null) fields.push({ name: "In the server", value: days === 0 ? "less than a day" : days + " day" + (days === 1 ? "" : "s"), inline: true });
    if (pid && registered.has(pid)) fields.push({ name: "Season sign-up", value: "was registered to play", inline: true });
    try {
      await dApi("POST", `/channels/${chId}/messages`, { embeds: [{
        title: "👋 " + who + " left the server",
        description: (link ? "" : "No linked site account — they never signed in at chelgamingleague.com.\n") +
          "`" + g.discord_id + "`",
        color: 0xC2410C, fields: fields.length ? fields : undefined,
        timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } });
      sum.departAnnounced = (sum.departAnnounced || 0) + 1;
    } catch (e) { sum.errors.push({ departPost: g.discord_id, error: String(e.message || e) }); }
  }
}

async function sbUpsertCfg(key, value) {
  await rfetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key, value: String(value), updated_at: new Date().toISOString() }) });
}

// Ensure the "Team Management" category + its rooms exist, private to the front office. Idempotent:
// looks up by name, creates only what's missing, and drops a webhook on #management-moves so the DB
// trigger can post appointments/removals. VIEW(1024)+SEND(2048)+READ_HISTORY(65536)=68608.
async function ensureMgmtCategory(guildChannels, roleId, sum) {
  const owner = roleId["owner"], gm = roleId["general manager"], agm = roleId["assistant general manager"];
  const office = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  if (!owner || !gm || !agm || office.length < 2) return; // roles not provisioned yet — try next run
  const MGMT_ALLOW = "68608";
  const ow = (ids) => [{ id: GUILD, type: 0, deny: "1024", allow: "0" }, ...ids.map((id) => ({ id, type: 0, allow: MGMT_ALLOW, deny: "0" }))];
  const ownerAud = [owner, ...office];
  const mgmtAud = [owner, gm, agm, ...office];

  let cat = guildChannels.find((c) => c.type === 4 && (c.name || "").toLowerCase() === "team management");
  if (!cat) {
    cat = await dApi("POST", `/guilds/${GUILD}/channels`, { name: "Team Management", type: 4, permission_overwrites: ow(mgmtAud) });
    guildChannels.push(cat); sum.mgmtCatCreated = 1;
  }
  const catId = cat.id;
  async function ensure(name, type, allowIds, topic) {
    const found = guildChannels.find((c) => c.name === name && c.parent_id === catId);
    if (found) return found;
    const base = { name, parent_id: catId, permission_overwrites: ow(allowIds) };
    if (type === 0 || type === 15) base.topic = topic;
    try {
      const ch = await dApi("POST", `/guilds/${GUILD}/channels`, { ...base, type });
      guildChannels.push(ch); sum.mgmtChansCreated = (sum.mgmtChansCreated || 0) + 1; return ch;
    } catch (e) {
      // a forum (type 15) needs a Community server; fall back to a text room so the space still exists
      if (type === 15) {
        try { const ch = await dApi("POST", `/guilds/${GUILD}/channels`, { ...base, type: 0 }); guildChannels.push(ch); sum.mgmtHelpFellBackToText = 1; return ch; }
        catch (e2) { sum.errors.push({ mgmtChan: name, error: String(e2.message || e2) }); return null; }
      }
      sum.errors.push({ mgmtChan: name, error: String(e.message || e) }); return null;
    }
  }
  await ensure("owners-chat", 0, ownerAud, "Club owners only (plus the league office). Talk shop with your fellow owners.");
  await ensure("management-chat", 0, mgmtAud, "Everyone in club management — owners, GMs, and AGMs. Anything goes.");
  await ensure("management-help", 15, mgmtAud, "Ask the league office anything — post a thread and staff will help.");
  const moves = await ensure("management-moves", 0, mgmtAud, "Front-office moves: new owners, GMs, and AGMs voted in, and departures. Auto-posted.");
  if (moves && moves.id) {
    try {
      const hooks = await dApi("GET", `/channels/${moves.id}/webhooks`);
      let hook = Array.isArray(hooks) ? hooks.find((h) => h.name === "CGHL Moves" && h.token) : null;
      if (!hook) hook = await dApi("POST", `/channels/${moves.id}/webhooks`, { name: "CGHL Moves" });
      if (hook && hook.id && hook.token) { await sbUpsertCfg("discord_mgmt_moves_webhook", `https://discord.com/api/webhooks/${hook.id}/${hook.token}`); sum.mgmtMovesHook = 1; }
    } catch (e) { sum.errors.push({ mgmtMovesHook: String(e.message || e) }); }
  }
}

// Club rooms and roles are created once and then left alone, which meant a club that rebranded or
// relocated kept its old Discord identity forever — the site said Canucks, Discord still said
// Senators. Reconcile the name, colour and topic against the DB every run, PATCHing in place so the
// role keeps its id, position and members and the channel keeps its history. Rename only: nothing
// here creates or deletes.
async function syncClubIdentity(guildChannels, guildRoles, teams, sum) {
  const snapshot = [];
  /* One gradient probe per sweep: if Discord refuses the first colors PATCH because the guild
     lacks ENHANCED_ROLE_COLORS (a boost-gated feature), every later club skips straight to flat
     color this sweep instead of burning nine more doomed API calls every two minutes. The flag
     resets next sweep, so the moment the server is boosted the gradients apply themselves. */
  let gradientBlocked = false;
  for (const t of teams) {
    if (!t.name) continue;
    const wantRole = t.name;
    const wantChan = slug(t.name);
    const wantColor = /^#?[0-9a-f]{6}$/i.test(t.color || "") ? parseInt(String(t.color).replace("#", ""), 16) : 0;
    /* null = no secondary on file; 0 is a legitimate value (pure black), so the sentinel must
       not be falsy-conflated with it */
    const wantColor2 = /^#?[0-9a-f]{6}$/i.test(t.color2 || "") ? parseInt(String(t.color2).replace("#", ""), 16) : null;

    if (t.discord_role_id) {
      const role = guildRoles.find((r) => r.id === t.discord_role_id);
      if (role && !role.managed) {
        const patch = {};
        if (role.name !== wantRole) patch.name = wantRole;
        /* Both club colors on file -> a two-color gradient role (Discord's enhanced role styles).
           The `colors` object supersedes the flat `color`; primary_color doubles as the fallback
           everywhere gradients don't render. Requires the ENHANCED_ROLE_COLORS guild feature
           (server boosts) — if Discord refuses, fall back to the flat primary and record why,
           rather than erroring the whole sweep. */
        const curColors = role.colors || {};
        const cur1 = curColors.primary_color != null ? curColors.primary_color : role.color;
        const curSecondary = curColors.secondary_color != null ? curColors.secondary_color : null;
        if (wantColor && wantColor2 != null && !gradientBlocked) {
          if (cur1 !== wantColor || curSecondary !== wantColor2) {
            patch.colors = { primary_color: wantColor, secondary_color: wantColor2 };
          }
        } else if (wantColor) {
          /* no secondary wanted: clear a stale gradient if one is showing, else fix flat drift */
          if (wantColor2 == null && curSecondary != null && !gradientBlocked) {
            patch.colors = { primary_color: wantColor, secondary_color: null };
          } else if (role.color !== wantColor) patch.color = wantColor;
        }
        if (Object.keys(patch).length) {
          try {
            await dApi("PATCH", `/guilds/${GUILD}/roles/${role.id}`, patch);
            if (patch.colors) { role.colors = patch.colors; role.color = patch.colors.primary_color; sum.roleGradients = (sum.roleGradients || 0) + 1; }
            Object.assign(role, patch.colors ? { name: patch.name || role.name } : patch);
            sum.clubRolesRenamed = (sum.clubRolesRenamed || 0) + 1;
          } catch (e) {
            const msg = String(e.message || e);
            /* Only a 400 means "this guild can't do gradients" — a 5xx or a network blip is
               transient, must NOT set the blocked flag, and simply retries next sweep. */
            if (patch.colors && / -> 400\b/.test(msg)) {
              gradientBlocked = true;
              sum.roleGradientUnsupported = msg.slice(0, 100);
              const flat = {};
              if (patch.name) flat.name = patch.name;
              if (role.color !== wantColor) flat.color = wantColor;
              if (Object.keys(flat).length) {
                try {
                  await dApi("PATCH", `/guilds/${GUILD}/roles/${role.id}`, flat);
                  Object.assign(role, flat);
                  sum.clubRolesRenamed = (sum.clubRolesRenamed || 0) + 1;
                } catch (e2) { sum.errors.push({ clubRole: t.code, error: String(e2.message || e2) }); }
              }
            } else sum.errors.push({ clubRole: t.code, error: msg });
          }
        }
      }
    }
    if (t.discord_channel_id) {
      const chan = guildChannels.find((c) => c.id === t.discord_channel_id);
      if (chan) {
        const wantTopic = `Private room for the ${t.name} — roster, lineups, and team talk. Visible only to the club and staff.`;
        const patch = {};
        if (chan.name !== wantChan) patch.name = wantChan;
        if ((chan.topic || "") !== wantTopic) patch.topic = wantTopic;
        if (Object.keys(patch).length) {
          try {
            await dApi("PATCH", `/channels/${chan.id}`, patch);
            Object.assign(chan, patch);
            sum.clubRoomsRenamed = (sum.clubRoomsRenamed || 0) + 1;
          } catch (e) { sum.errors.push({ clubRoom: t.code, error: String(e.message || e) }); }
        }
      }
    }
    snapshot.push(`${t.code}=${wantRole}/#${wantChan}`);
  }
  // the ?diag= endpoints are unreachable on a scheduled function, so leave the mapping readable
  try { await sbUpsertCfg("discord_club_identity", JSON.stringify(snapshot)); } catch (e) { /* observability only */ }
}

// Role icons — the club crest on the club role, the referee jersey on Staff, the server icon on
// Commissioner.
//
// Needs Boost Level 2; without it Discord rejects the PATCH, so the guild's feature list is checked
// first and the run records WHY it skipped rather than failing silently. If the boosts lapse the
// icons stay on the roles Discord-side and this simply stops reconciling them.
//
// Every mark is now fetched at run time from its own source of truth: a club's from the logo on the
// site, Commissioner's from the guild icon, Staff's from the one fixed PNG in the repo. Nothing is
// pre-rendered, so "the shipped image no longer matches the site" is not a state that can exist.
//
// Idempotent by source: an applied-map of roleId -> source is compared each run, and a role is only
// fetched and PATCHed when its source actually changes. A normal tick does no image work at all.
/* A club's role icon, rendered LIVE from the logo the club uploaded on the site.

   The old pipeline shipped hand-rendered PNGs in assets/role-icons/ keyed by a manifest, because
   the site stores logos as WebP and Discord refuses WebP — decoding it inside the function would
   have meant a native image dependency. That made every new club and every re-brand a manual
   commit, and Montreal sat without an icon for days as a result.

   Supabase's own image transformer removes the problem: request the object through
   /storage/v1/render/image/... and it returns image/png, resized, with no dependency at all.
   So the logo a commissioner uploads becomes the Discord role icon on the next sweep. */
async function fetchClubLogoPng(logoUrl) {
  if (!logoUrl) return null;
  /* /object/public/<bucket>/<path>  ->  /render/image/public/<bucket>/<path> */
  let url = logoUrl.includes("/storage/v1/object/public/")
    ? logoUrl.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") +
      (logoUrl.includes("?") ? "&" : "?") + "width=128&height=128&resize=contain"
    : logoUrl;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`logo ${r.status}`);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  /* Discord accepts png/jpeg/gif only. The transformer answers png; a non-Supabase URL might not,
     and silently PATCHing a WebP would fail per-role every sweep forever. */
  if (!/^image\/(png|jpe?g|gif)/.test(ct)) throw new Error(`logo is ${ct || "unknown"}, not png/jpeg/gif`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 240 * 1024) throw new Error(`logo is ${Math.round(buf.length/1024)}KB, over Discord's limit`);
  return { data: `data:${ct.split(";")[0]};base64,${buf.toString("base64")}` };
}

/* Fixed artwork shipped with the repo — Staff's referee jersey, and only that. Clubs used to come
   from here too, keyed by a manifest that recorded which logo_url each PNG had been rendered from;
   they now render live, and the manifest is gone with them. It was worse than redundant: the version
   marker lived in two places (the `local:` string below and the manifest entry), so following the
   manifest's own instruction to "bump the version to force a re-apply" made the two disagree and
   parked the icon in `stale-render` permanently. The marker is a single string in this file now. */
function readRoleIcon(code) {
  const roots = [process.env.LAMBDA_TASK_ROOT, process.cwd(), HERE,
                 path.join(HERE, "..", ".."), path.join(HERE, "..", "..", "..")].filter(Boolean);
  for (const r of roots) {
    /* assets/, not netlify/functions/: Netlify treats every subdirectory of the functions dir as a
       function candidate, so bundled assets have to sit outside it. */
    for (const rel of [["assets", "role-icons"], ["role-icons"]]) {
      try {
        const img = path.join(r, ...rel, `${code}.png`);
        if (!fs.existsSync(img)) continue;
        return { data: "data:image/png;base64," + fs.readFileSync(img).toString("base64") };
      } catch (e) { /* try the next candidate root */ }
    }
  }
  return null;
}

/* The guild icon straight off Discord's CDN, already PNG. size=128 keeps it well inside the 256KB
   role-icon limit without any resampling on our side. */
async function fetchGuildIconPng(hash) {
  if (!hash) return null;
  try {
    const r = await rfetch(`https://cdn.discordapp.com/icons/${GUILD}/${hash}.png?size=128`,
      { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 240 * 1024) return null;
    return { data: "data:image/png;base64," + buf.toString("base64") };
  } catch (e) { return null; }
}

async function syncRoleIcons(guildRoles, teams, roleId, sum) {
  const guild = await dApi("GET", `/guilds/${GUILD}`);
  const features = (guild && guild.features) || [];
  /* answers "do we even have a screening gate?" from the horse's mouth, and the true member count
     with it — the client sidebar rounds, this does not */
  sum.gate = features.includes("MEMBER_VERIFICATION_GATE_ENABLED");
  sum.guildMemberCount = guild && guild.approximate_member_count;
  if (!features.includes("ROLE_ICONS")) {
    await sbUpsertCfg("discord_role_icons", JSON.stringify({
      at: new Date().toISOString(), skipped: "guild lacks ROLE_ICONS (needs Boost Level 2)" }));
    return;
  }

  const want = {};                                  // roleId -> { code, src }
  for (const t of teams) {
    if (t.discord_role_id && t.logo_url) want[t.discord_role_id] = { code: t.code, src: t.logo_url };
  }
  /* Staff wears the referee jersey — fixed artwork in the repo rather than anything from the DB, so
     its "source" is a version marker. Bump this string to force a re-apply; it is the only copy. */
  const staffId = roleId["staff"];
  if (staffId) want[staffId] = { code: "STAFF", src: "local:referee-jersey-v1" };

  /* Commissioner wears the server's own icon. Taken live from the guild rather than shipped:
     Discord's CDN already serves it as PNG, so there is nothing to pre-render and nothing to keep
     in sync — change the server icon and this follows on the next tick. */
  const commishId = roleId["commissioner"];
  const guildIcon = guild && guild.icon;
  if (commishId && guildIcon) want[commishId] = { code: "GUILD", src: `guild-icon:${guildIcon}` };

  let applied = {};
  try {
    const rows = await sbGet("app_config?key=eq.discord_role_icons_applied&select=value");
    if (rows && rows[0] && rows[0].value) applied = JSON.parse(rows[0].value);
  } catch (e) { /* first run, or unreadable — treat as nothing applied */ }

  const todo = Object.keys(want).filter((rid) => applied[rid] !== want[rid].src);
  if (!todo.length) return;                         // nothing changed: read no files, call nothing

  const snap = [];
  /* One-shot diagnostic for the single remaining bundled file. If STAFF.png cannot be found, record
     WHERE the function actually looked and what is there, rather than reporting "no-image" forever
     with no way to tell whether the included_files glob, the path or the deploy is at fault. */
  if (!readRoleIcon("STAFF")) {
    const probe = [];
    const roots = [process.env.LAMBDA_TASK_ROOT, process.cwd(), HERE,
                   path.join(HERE, ".."), path.join(HERE, "..", "..")].filter(Boolean);
    for (const r of roots) {
      let listing = "unreadable";
      try { listing = fs.readdirSync(r).slice(0, 14).join(","); } catch (e) { listing = String(e.code || e); }
      probe.push({ root: r, entries: listing,
                   hasAssets: (() => { try { return fs.existsSync(path.join(r, "assets")); } catch (e) { return "?"; } })() });
    }
    try { await sbUpsertCfg("discord_role_icons_probe", JSON.stringify(probe).slice(0, 3000)); } catch (e) { /* observability */ }
  }
  for (const rid of todo) {
    const w = want[rid];
    const role = guildRoles.find((r) => r.id === rid);
    if (!role || role.managed) { snap.push(`${w.code}=no-role`); continue; }
    let img;
    try {
      if (w.code === "GUILD") {
        img = await fetchGuildIconPng(guildIcon);
      } else if (w.src && /^https?:/.test(w.src)) {
        /* a club: render straight from the uploaded logo, so a new or re-branded club needs no
           commit. `applied[rid]` is keyed on the logo URL, so this re-applies exactly when the
           club changes its logo and never otherwise. */
        img = await fetchClubLogoPng(w.src);
      } else {
        img = readRoleIcon(w.code);                // STAFF: fixed artwork shipped with the repo
      }
    } catch (e) {
      snap.push(`${w.code}=logo-error`);
      sum.errors.push({ roleIcon: w.code, error: String(e.message || e) });
      continue;
    }
    if (!img) { snap.push(`${w.code}=no-image`); continue; }
    try {
      await dApi("PATCH", `/guilds/${GUILD}/roles/${rid}`, { icon: img.data });
      applied[rid] = w.src;
      sum.roleIcons = (sum.roleIcons || 0) + 1;
      snap.push(`${w.code}=ok`);
    } catch (e) {
      snap.push(`${w.code}=error`);
      sum.errors.push({ roleIcon: w.code, error: String(e.message || e) });
    }
  }
  /* The bot's own avatar, matched to the server icon. PATCH /users/@me is rate-limited far harder
     than role edits (a couple of changes an hour), so this is gated on the icon hash and runs at
     most once per change — never on a normal tick. A failure here is recorded and dropped: the
     avatar is cosmetic and must not cost the sync its role work. */
  if (guildIcon && applied.__botAvatar !== guildIcon) {
    const av = await fetchGuildIconPng(guildIcon);
    if (av) {
      try {
        await dApi("PATCH", "/users/@me", { avatar: av.data });
        applied.__botAvatar = guildIcon;
        snap.push("BOT=ok");
      } catch (e) {
        snap.push("BOT=error");
        sum.errors.push({ botAvatar: String(e.message || e) });
      }
    }
  }
  try { await sbUpsertCfg("discord_role_icons_applied", JSON.stringify(applied)); } catch (e) { /* retried next run */ }
  try { await sbUpsertCfg("discord_role_icons", JSON.stringify({ at: new Date().toISOString(), result: snap })); } catch (e) { /* observability only */ }
}

// #announcements under an Information category: everyone reads, only the league office writes.
// Its webhook is stored so the site can post league news without a bot token. Creation only —
// if the channel already exists under Information we adopt it and just make sure the hook is on
// file, so this never fights a channel the commissioners set up by hand.
// VIEW(1024)+SEND(2048)+READ_HISTORY(65536)=68608; members get VIEW+READ_HISTORY (66560) and no SEND.
async function ensureAnnouncements(guildChannels, roleId, sum) {
  const office = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  if (office.length < 2) return;                       // roles not provisioned yet — try next run

  let cat = guildChannels.find((c) => c.type === 4 && (c.name || "").toLowerCase() === "information");
  if (!cat) {
    try {
      cat = await dApi("POST", `/guilds/${GUILD}/channels`, { name: "Information", type: 4 });
      guildChannels.push(cat); sum.infoCatCreated = 1;
    } catch (e) { sum.errors.push({ infoCat: String(e.message || e) }); return; }
  }

  let ch = guildChannels.find((c) => c.type !== 4 && (c.name || "").toLowerCase() === "announcements");
  if (!ch) {
    try {
      ch = await dApi("POST", `/guilds/${GUILD}/channels`, {
        name: "announcements", type: 0, parent_id: cat.id,
        topic: "League announcements from the commissioners. Read-only — discussion goes in the forums or #general.",
        permission_overwrites: [
          { id: GUILD, type: 0, allow: "66560", deny: "2048" },        // everyone: read, don't post
          ...office.map((id) => ({ id, type: 0, allow: "68608", deny: "0" })),
        ],
      });
      guildChannels.push(ch); sum.announcementsCreated = 1;
    } catch (e) { sum.errors.push({ announcements: String(e.message || e) }); return; }
  }

  try {
    const hooks = await dApi("GET", `/channels/${ch.id}/webhooks`);
    let hook = Array.isArray(hooks) ? hooks.find((h) => h.name === "CGHL Announcements" && h.token) : null;
    if (!hook) hook = await dApi("POST", `/channels/${ch.id}/webhooks`, { name: "CGHL Announcements" });
    if (hook && hook.id && hook.token) {
      await sbUpsertCfg("discord_announcements_webhook", `https://discord.com/api/webhooks/${hook.id}/${hook.token}`);
      sum.announcementsHook = 1;
    }
  } catch (e) { sum.errors.push({ announcementsHook: String(e.message || e) }); }
}

// Community + game-night channels: a public #pickup-games and #draft-hub, per-club voice rooms (private to
// the club + office, mirroring the club text rooms), and a couple of public Game Voice lobbies for
// scrims. Creation only — never deletes an existing channel. Idempotent by name+parent.
async function ensureCommunityChannels(guildChannels, teams, roleId, sum) {
  const cat = (name) => guildChannels.find((c) => c.type === 4 && (c.name || "").toLowerCase() === name);
  const office = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  const generalCat = cat("general"), gamesCat = cat("games"), teamRoomsCat = cat("team rooms");

  // Creates the channel if missing. If oldNames is given and a channel by one of those names still
  // exists, it's RENAMED in place (keeping its position, history, and id) instead of a duplicate being
  // made — this is how #lfg was migrated to #pickup-games without the sweep recreating the old name.
  async function ensurePublicText(name, parentId, topic, oldNames) {
    if (!parentId) return;
    const existing = guildChannels.find((c) => c.type === 0 && c.name === name);
    if (existing) {
      // keep the topic current on an already-present channel (e.g. the /lfg -> /join wording) without recreating it
      if (topic && existing.topic !== topic) {
        try { await dApi("PATCH", `/channels/${existing.id}`, { topic }); existing.topic = topic; sum.communityChansRetopic = (sum.communityChansRetopic || 0) + 1; }
        catch (e) { sum.errors.push({ communityChanTopic: name, error: String(e.message || e) }); }
      }
      return;
    }
    const prev = (oldNames && oldNames.length)
      ? guildChannels.find((c) => c.type === 0 && oldNames.includes(c.name)) : null;
    if (prev) {
      try { await dApi("PATCH", `/channels/${prev.id}`, { name, topic }); prev.name = name;
        sum.communityChansRenamed = (sum.communityChansRenamed || 0) + 1; return;
      } catch (e) { sum.errors.push({ communityChanRename: name, error: String(e.message || e) }); }
    }
    try { const ch = await dApi("POST", `/guilds/${GUILD}/channels`, { name, type: 0, parent_id: parentId, topic });
      guildChannels.push(ch); sum.communityChansCreated = (sum.communityChansCreated || 0) + 1;
    } catch (e) { sum.errors.push({ communityChan: name, error: String(e.message || e) }); }
  }
  // #pickup-games (formerly #lfg) — the /join pickup lobbies live here.
  await ensurePublicText("pickup-games", generalCat && generalCat.id, "Pickup games — run /join to line up 6s and scrims. Call your position and go.", ["lfg"]);
  await ensurePublicText("draft-hub", gamesCat && gamesCat.id, "Watch the CGHL entry draft live and talk picks — the draft itself runs on the site.");

  // "Pickup Lobbies" category — each filled /join lobby gets its own channel here (created by the
  // interactions endpoint on fill, removed by the sweep below). Stash its id so that endpoint finds it.
  try {
    let plCat = cat("pickup lobbies");
    if (!plCat) {
      plCat = await dApi("POST", `/guilds/${GUILD}/channels`, { name: "Pickup Lobbies", type: 4 });
      if (plCat && plCat.id) { guildChannels.push(plCat); sum.pickupCatCreated = 1; }
    }
    if (plCat && plCat.id) await sbUpsertCfg("pickup_lobby_category_id", plCat.id);
  } catch (e) { sum.errors.push({ pickupCat: String(e.message || e) }); }

  // Sweep spent pickup-lobby channels: any lobby marked closed (staff hit Delete), or untouched for
  // 12h, has its channel (thread_id) removed and the marker cleared. Idempotent; a 404 is fine.
  try {
    const rooms = await sbGet("lfg_lobbies?thread_id=not.is.null&select=id,thread_id,status,updated_at&order=updated_at.asc&limit=100");
    const now = Date.now();
    for (const lo of (rooms || [])) {
      const stale = lo.status === "closed" || (now - Date.parse(lo.updated_at) > 12 * 3600 * 1000);
      if (!stale) continue;
      try { await dApi("DELETE", `/channels/${lo.thread_id}`); } catch (e) { /* already gone */ }
      await sbPatch(`lfg_lobbies?id=eq.${lo.id}`, { thread_id: null });
      sum.pickupRoomsSwept = (sum.pickupRoomsSwept || 0) + 1;
    }
  } catch (e) { sum.errors.push({ pickupSweep: String(e.message || e) }); }

  // Clubs do NOT get their own voice rooms — teams use the shared Game Voice lobbies below.
  // (?reconcile=teams removes any per-club voice channel left over from the old behavior.)
  // public Game Voice lobbies for scrims / mixed groups on game night
  if (gamesCat) {
    for (const vn of ["Game Voice 1", "Game Voice 2"]) {
      if (guildChannels.find((c) => c.type === 2 && c.name === vn && c.parent_id === gamesCat.id)) continue;
      try { const ch = await dApi("POST", `/guilds/${GUILD}/channels`, { name: vn, type: 2, parent_id: gamesCat.id });
        guildChannels.push(ch); sum.gameVoiceCreated = (sum.gameVoiceCreated || 0) + 1;
      } catch (e) { sum.errors.push({ gameVoice: vn, error: String(e.message || e) }); }
    }
  }

  // One-time cleanup: remove the stray duplicate #league-advertisement (a topic-less Staff dup of
  // #advertisement). Guarded by a config flag so this runs exactly once and the recurring sweep
  // never deletes a future channel someone deliberately names that.
  try {
    const done = await sbGet("app_config?key=eq.cleanup_league_advertisement_done&select=value");
    if (!(Array.isArray(done) && done.length)) {
      const dup = guildChannels.find((c) => c.type === 0 && c.name === "league-advertisement");
      if (dup) { await dApi("DELETE", `/channels/${dup.id}`); sum.dupAdChanDeleted = 1;
        const i = guildChannels.indexOf(dup); if (i >= 0) guildChannels.splice(i, 1); }
      await sbUpsertCfg("cleanup_league_advertisement_done", "1");
    }
  } catch (e) { sum.errors.push({ dupAdCleanup: String(e.message || e) }); }
}

// Staff departments — one Discord role + one private room per office lane, all under the Staff
// category. Each room is visible to its department AND the commissioners (oversight), not to all
// staff. The list itself lives in shared/roles.mjs (imported above) because the gateway bot's
// instant role sync grants the same department roles and the two must never diverge.

// Ensure the department roles (mentionable) and a private room per department under the Staff
// category. Idempotent: creates only what's missing, never deletes. VIEW+SEND+READ_HISTORY=68608.
/* Give every club a Discord role + private room. This used to run only from the gated
   ?reconcile=teams action, which was fine while clubs were created by hand — but an owner
   application can now stand a club up on its own, and that club would sit on the site with no
   Discord presence until someone remembered to reconcile. Runs on the normal sweep instead:
   it's a no-op for clubs that already have both. */
async function ensureClubRooms(guildChannels, guildRoles, teams, roleId, sum) {
  const teamRoomsCat = guildChannels.find((c) => c.type === 4 && (c.name || "").toLowerCase() === "team rooms");
  // A club room is for THAT club plus the league office — and the office is Commissioner + Staff
  // ONLY. The seat roles (Owner / General Manager / Assistant GM) are worn by every club's front
  // office at once, so granting them here would have handed all five front offices a key to all
  // five rooms. A club's own management reaches its room through the club role they already wear.
  const office = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  for (const t of teams) {
    if (t.discord_role_id && t.discord_channel_id) continue;   // already provisioned
    try {
      let trole = t.discord_role_id;
      if (!trole || !guildRoles.find((r) => r.id === trole)) {
        const existing = guildRoles.find((r) => !r.managed && slug(r.name) === slug(t.name));
        if (existing) trole = existing.id;
        else {
          const wantColor = /^#?[0-9a-f]{6}$/i.test(t.color || "") ? parseInt(String(t.color).replace("#", ""), 16) : 0;
          const cr = await dApi("POST", `/guilds/${GUILD}/roles`, { name: t.name, color: wantColor, mentionable: false });
          if (cr && cr.id) { trole = cr.id; guildRoles.push(cr); sum.clubRolesCreated = (sum.clubRolesCreated || 0) + 1; }
        }
        if (trole) { await sbPatch(`teams?id=eq.${t.id}`, { discord_role_id: trole }); t.discord_role_id = trole; }
      }
      let tchan = t.discord_channel_id;
      if (teamRoomsCat && (!tchan || !guildChannels.find((c) => c.id === tchan))) {
        const existing = guildChannels.find((c) => c.type === 0 && c.parent_id === teamRoomsCat.id && slug(c.name) === slug(t.name));
        if (existing) tchan = existing.id;
        else {
          const allow = String(1024 | 2048 | 65536);   // VIEW + SEND + READ_HISTORY
          const overwrites = [{ id: GUILD, type: 0, deny: "1024", allow: "0" }];
          if (trole) overwrites.push({ id: trole, type: 0, allow, deny: "0" });
          for (const oid of office) overwrites.push({ id: oid, type: 0, allow, deny: "0" });
          const topic = `Private room for the ${t.name} — roster, lineups, and team talk. Visible only to the club and staff.`;
          const cc = await dApi("POST", `/guilds/${GUILD}/channels`,
            { name: slug(t.name), type: 0, parent_id: teamRoomsCat.id, topic, permission_overwrites: overwrites });
          if (cc && cc.id) { tchan = cc.id; guildChannels.push(cc); sum.clubRoomsCreated = (sum.clubRoomsCreated || 0) + 1; }
        }
        if (tchan) { await sbPatch(`teams?id=eq.${t.id}`, { discord_channel_id: tchan }); t.discord_channel_id = tchan; }
      }
    } catch (e) { sum.errors.push({ clubProvision: t.name, error: String(e.message || e) }); }
  }
}
// Discord paints a member's name with the colour of their HIGHEST colour-bearing role, and
// POST /guilds/{id}/roles always creates a role at the BOTTOM of the list. So every club role
// was created underneath Owner / General Manager / Assistant GM, and anyone holding a seat wore
// the seat's colour instead of their club's. Sort the roles we manage into three tiers, lowest
// first:
//
//     everything else we manage   <   club colours   <   league office
//
// A player therefore reads as their club, while Commissioner and Staff still read as the office.
//
// This only ever reuses positions ALREADY held by these roles — it permutes the band rather than
// reaching for a higher slot. Discord refuses to move any role above the bot's own, and a
// permutation can never ask for that, so this can't fail on hierarchy no matter where the bot sits.
// Runs every sync, so a club role created a minute ago is in the right place on the next tick.
/* ---------- @everyone / @here is the league office's alone ----------
   MENTION_EVERYONE (bit 17) also covers @here and all-role pings, so a single role holding it
   hands every wearer a server-wide megaphone. Every registered player wears a position role and
   every staffer a department role, so a stray grant on any of those is effectively a grant to
   the whole league. This re-strips it on every sweep: a permission changed by hand in the UI, or
   inherited by a role recreated from the @everyone template, is corrected within two minutes
   rather than discovered after a 3am mass ping.

   KEPT deliberately: Commissioner and Staff — the two roles Rule 1.3 names — and managed
   integration roles the API refuses to edit, except the premium-subscriber role, which is managed
   but editable and would otherwise let anyone buy a megaphone with a boost.

   MEDIA WAS ONCE KEPT AND IS NOT ANYMORE. Media-only staffers wear only the Media role (they were
   deliberately taken off the Staff role), so exempting Media handed the megaphone to someone
   carrying neither Commissioner nor Staff — exactly what this guard exists to stop, and it went
   unnoticed because the role audit looked clean while the wearer list did not. Rule 1.3 already
   said "only commissioners and league staff"; the code was the thing that was wrong. */
/* BigInt is load-bearing, not style: Discord permissions are a 64-bit bitfield and JavaScript's
   bitwise operators coerce to INT32. `2248473465835073 & ~(1<<17)` evaluates to -2043294143 —
   writing that back would not clear one bit, it would rewrite the role's entire permission set
   with garbage. Every value here stays a BigInt until it is stringified for the API. */
const MENTION_EVERYONE = 1n << 17n;
/* ADMINISTRATOR implies EVERY permission, so a role holding it can ping the whole server without
   bit 17 ever being set. Stripping bit 17 from such a role would change nothing and hide the fact.
   This guard therefore cannot enforce the policy against an admin role — so it REPORTS them
   (sum.mentionViaAdmin) rather than pretending the server is clean. Commissioner is admin by
   design; anything else appearing there is a real finding. */
const ADMINISTRATOR = 1n << 3n;
/* Exactly the two the rulebook names (Rule 1.3). Media is NOT here: a media-only staffer wears
   only the Media role in Discord, and exempting that role let someone with no Commissioner or
   Staff role ping the entire server — which is the thing this guard exists to prevent. Media asks
   the office to post, like everyone else. */
const MENTION_ALLOWED = new Set(["commissioner", "staff"]);
async function enforceMentionPolicy(guildRoles, sum) {
  for (const r of guildRoles || []) {
    let perms;
    try { perms = BigInt(r.permissions || 0); } catch (e) { continue; }
    const name0 = String(r.name || "").toLowerCase();
    /* surfaced whether or not bit 17 is set — an admin role bypasses this policy entirely */
    if ((perms & ADMINISTRATOR) !== 0n && !MENTION_ALLOWED.has(name0) && !r.managed) {
      sum.mentionViaAdmin = (sum.mentionViaAdmin || []).concat(r.name);
    }
    if ((perms & MENTION_EVERYONE) === 0n) continue;
    const name = name0;
    if (MENTION_ALLOWED.has(name)) continue;
    /* the bot's OWN integration role must keep it — the bot posts league-wide announcements —
       and Discord refuses PATCH on integration roles anyway. The booster role is managed but
       editable, so it is not exempt. */
    if (r.managed && name !== "server booster") continue;
    const cleared = (perms & ~MENTION_EVERYONE).toString();
    try {
      await dApi("PATCH", `/guilds/${GUILD}/roles/${r.id}`, { permissions: cleared });
      sum.mentionStripped = (sum.mentionStripped || 0) + 1;
      r.permissions = cleared;
    } catch (e) { sum.errors.push({ mentionPolicy: r.name, error: String(e.message || e) }); }
  }
}

/* ---- posting policy: links and images require a league role (Rule 1.3) ----
   Ad bots join, post a link, and leave. The counter is that posting a LINK or an IMAGE requires
   proof of being a real member — a role that only exists once you have signed in to the site and
   registered — while reading and chatting stay open to everyone.

   THE TRAP THIS GUARD EXISTS FOR: "Not Signed Up" is granted by THIS SWEEP to every unlinked human
   within two minutes, ad accounts included. It carried EMBED_LINKS and ATTACH_FILES, so the gate
   was decorative until those were stripped (2026-08-08). Any role that is handed out automatically
   must never be a qualifying role — hence DENY below is enforced, not assumed.

   CREATE_INSTANT_INVITE rides along: a drive-by account should not be able to mint invites. */
const EMBED_LINKS = 1n << 14n;
const ATTACH_FILES = 1n << 15n;
const CREATE_INSTANT_INVITE = 1n << 0n;
const POST_BITS = EMBED_LINKS | ATTACH_FILES;
/* Roles that must NEVER carry the posting bits: @everyone (handled by id) and any role this sweep
   grants automatically without the member proving anything. */
const POST_DENY = new Set(["not signed up"]);
/* Roles that must ALWAYS carry them: earning any of these means a real registration or a league
   office seat. Club and position roles are added dynamically below — they are data, not names. */
const POST_ALLOW_STATIC = ["player", "free agent", "commissioner", "staff", "owner",
  "general manager", "assistant general manager"];

async function enforcePostingPolicy(guildRoles, teams, sum) {
  const allow = new Set(POST_ALLOW_STATIC);
  for (const p of POSITION_ROLES) allow.add(p.toLowerCase());
  for (const d of STAFF_DEPARTMENTS) allow.add(d.role.toLowerCase());
  const clubRoleIds = new Set((teams || []).map((t) => t.discord_role_id).filter(Boolean));

  for (const r of guildRoles || []) {
    let perms;
    try { perms = BigInt(r.permissions || 0); } catch (e) { continue; }
    const name = String(r.name || "").toLowerCase();
    const isEveryone = r.id === GUILD;
    /* integration roles belong to their app and Discord refuses to PATCH them */
    if (r.managed) continue;

    if (isEveryone || POST_DENY.has(name)) {
      /* @everyone also loses invite creation; a named auto-granted role keeps whatever else it has */
      const strip = isEveryone ? (POST_BITS | CREATE_INSTANT_INVITE) : (POST_BITS | CREATE_INSTANT_INVITE);
      if ((perms & strip) === 0n) continue;
      const cleared = (perms & ~strip).toString();
      try {
        await dApi("PATCH", `/guilds/${GUILD}/roles/${r.id}`, { permissions: cleared });
        sum.postingStripped = (sum.postingStripped || 0) + 1;
        r.permissions = cleared;
      } catch (e) { sum.errors.push({ postingPolicy: r.name, error: String(e.message || e) }); }
      continue;
    }

    if (allow.has(name) || clubRoleIds.has(r.id)) {
      if ((perms & POST_BITS) === POST_BITS) continue;
      const granted = (perms | POST_BITS).toString();
      try {
        await dApi("PATCH", `/guilds/${GUILD}/roles/${r.id}`, { permissions: granted });
        sum.postingGranted = (sum.postingGranted || 0) + 1;
        r.permissions = granted;
      } catch (e) { sum.errors.push({ postingPolicy: r.name, error: String(e.message || e) }); }
    }
  }
}

/* The server's own join gate. HIGH = a new account must be in the guild ten minutes before it can
   post at all, which defeats the join-post-leave pattern outright. Raised by hand on 2026-08-08;
   re-asserted here so it cannot be quietly lowered. Never LOWERS a stricter setting the
   commissioner may have chosen (VERY HIGH = 4). */
const MIN_VERIFICATION_LEVEL = 3;
async function enforceVerificationLevel(guild, sum) {
  const cur = guild && guild.verification_level;
  if (typeof cur !== "number" || cur >= MIN_VERIFICATION_LEVEL) return;
  try {
    await dApi("PATCH", `/guilds/${GUILD}`, { verification_level: MIN_VERIFICATION_LEVEL });
    sum.verificationRaised = `${cur} -> ${MIN_VERIFICATION_LEVEL}`;
  } catch (e) { sum.errors.push({ verificationLevel: String(e.message || e) }); }
}

async function ensureRoleOrder(guildRoles, teams, roleId, sum) {
  const byId = new Map(guildRoles.map((r) => [r.id, r]));
  // @everyone shares the guild id and integration-managed roles can't be moved at all
  const movable = (id) => { const r = byId.get(id); return !!r && r.id !== GUILD && !r.managed; };
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  const idsOf = (names) => uniq(names.map((n) => roleId[String(n).toLowerCase()]));

  const office = idsOf(["commissioner", "staff"]).filter(movable);
  const club = uniq(teams.map((t) => t.discord_role_id)).filter(movable);
  const rest = uniq([
    ...idsOf(["owner", "general manager", "assistant general manager", "player", "free agent",
              "not signed up", "center", "left wing", "right wing", "left defense", "right defense", "goalie"]),
    ...STAFF_DEPARTMENTS.map((d) => roleId[String(d.role).toLowerCase()]),
  ]).filter((id) => movable(id) && !club.includes(id) && !office.includes(id));

  const tiers = [rest, club, office];
  const all = tiers.flat();
  if (!club.length || all.length < 2) return;

  const slots = all.map((id) => byId.get(id).position).sort((a, b) => a - b);
  const byPos = (a, b) => byId.get(a).position - byId.get(b).position;  // keep each tier's own order
  const ordered = tiers.flatMap((t) => t.slice().sort(byPos));
  const moves = ordered.map((id, i) => ({ id, position: slots[i] }))
                       .filter((m) => byId.get(m.id).position !== m.position);

  if (moves.length) {
    const res = await dApi("PATCH", `/guilds/${GUILD}/roles`, moves);
    if (Array.isArray(res)) for (const r of res) { const cur = byId.get(r.id); if (cur) cur.position = r.position; }
    sum.roleOrderMoved = moves.length;
  }
  // The ?diag= endpoints can't be reached (Netlify refuses public HTTP on a scheduled function),
  // so leave the resulting order somewhere readable for whoever debugs the next colour complaint.
  try {
    await sbUpsertCfg("discord_role_order", JSON.stringify({
      tiers: "other < club < office",
      moved: moves.length,
      order: ordered.map((id) => `${byId.get(id).position}:${byId.get(id).name}`),
    }));
  } catch (e) { /* observability only — never fail the sync over it */ }
}

/* The guild slash commands, self-registered by the sweep. The old GET ?register=commands path
   still exists but Netlify refuses public HTTP to scheduled functions, so it can never run again —
   without this, a new command could be coded but never registered. The desired set is hashed into
   app_config (discord_cmds_hash) so steady-state sweeps cost zero Discord calls. */
const GUILD_COMMANDS = [
  { name: "join", type: 1, description: "Join or start a pickup game lobby — run in #pickup-games" },
  { name: "leave", type: 1, description: "Leave the pickup signup sheet — run in #pickup-games" },
  { name: "captain", type: 1, description: "Volunteer as a captain — run in a full pickup lobby's channel" },
  { name: "kick", type: 1, description: "Captains: vote to kick a player from this pickup lobby",
    options: [{ type: 6, name: "player", description: "Who to kick", required: true }] },
  { name: "delete", type: 1, description: "Vote to close this pickup lobby — a majority of the lobby closes it" },
];
async function ensureGuildCommands(sum) {
  /* the marker only needs to CHANGE when the command set changes — the JSON itself is the
     simplest collision-free fingerprint and avoids importing crypto for a config stamp */
  const hash = JSON.stringify(GUILD_COMMANDS);
  try {
    const cur = await sbGet(`app_config?key=eq.discord_cmds_hash&select=value`);
    if (cur && cur[0] && cur[0].value === hash) return;
    const app = await dApi("GET", `/applications/@me`);
    const res = await dApi("PUT", `/applications/${app.id}/guilds/${GUILD}/commands`, GUILD_COMMANDS);
    await sbUpsertCfg("discord_cmds_hash", hash);
    sum.commandsRegistered = (res || []).map((c) => c.name);
  } catch (e) { sum.errors.push({ commands: String(e.message || e) }); }
}

async function ensureStaffDepartments(guildChannels, roleId, roleNameById, sum) {
  const commish = roleId["commissioner"], staff = roleId["staff"];
  if (!commish || !staff) return; // office roles not provisioned yet — next run
  const ALLOW = "68608";
  // (a) a Discord role per department
  for (const d of STAFF_DEPARTMENTS) {
    if (roleId[d.role.toLowerCase()]) continue;
    try {
      const created = await dApi("POST", `/guilds/${GUILD}/roles`, { name: d.role, mentionable: true });
      if (created && created.id) { roleId[d.role.toLowerCase()] = created.id; roleNameById[created.id] = d.role; sum.rolesCreated = (sum.rolesCreated || 0) + 1; }
    } catch (e) { sum.errors.push({ deptRole: d.role, error: String(e.message || e) }); }
  }
  // (b) the Staff category (created office-private if it doesn't exist)
  let cat = guildChannels.find((c) => c.type === 4 && /^staff\b/i.test(c.name || ""));
  if (!cat) {
    try {
      cat = await dApi("POST", `/guilds/${GUILD}/channels`, { name: "Staff", type: 4,
        permission_overwrites: [{ id: GUILD, type: 0, deny: "1024", allow: "0" },
          { id: commish, type: 0, allow: ALLOW, deny: "0" }, { id: staff, type: 0, allow: ALLOW, deny: "0" }] });
      guildChannels.push(cat); sum.staffCatCreated = 1;
    } catch (e) { sum.errors.push({ staffCat: String(e.message || e) }); return; }
  }
  // (c) one private room per department — visible to that department + the commissioners. The grant
  //     goes in the SAME create call as the @everyone deny, so the room is never briefly public.
  for (const d of STAFF_DEPARTMENTS) {
    const rid = roleId[d.role.toLowerCase()];
    if (!rid) continue;
    if (guildChannels.find((c) => c.name === d.channel && c.parent_id === cat.id)) continue;
    // a room created under a prior name (e.g. before a rename to dodge a public channel clash) is
    // renamed in place rather than duplicated
    if (d.alt) {
      const old = guildChannels.find((c) => d.alt.includes(c.name) && c.parent_id === cat.id);
      if (old) {
        try { await dApi("PATCH", `/channels/${old.id}`, { name: d.channel, topic: d.topic }); old.name = d.channel; sum.deptChansRenamed = (sum.deptChansRenamed || 0) + 1; continue; }
        catch (e) { sum.errors.push({ deptRename: d.channel, error: String(e.message || e) }); }
      }
    }
    try {
      const ch = await dApi("POST", `/guilds/${GUILD}/channels`, { name: d.channel, type: 0, parent_id: cat.id, topic: d.topic,
        permission_overwrites: [{ id: GUILD, type: 0, deny: "1024", allow: "0" },
          { id: commish, type: 0, allow: ALLOW, deny: "0" }, { id: rid, type: 0, allow: ALLOW, deny: "0" }] });
      if (ch && ch.id) { guildChannels.push(ch); sum.deptChansCreated = (sum.deptChansCreated || 0) + 1; }
    } catch (e) { sum.errors.push({ deptChan: d.channel, error: String(e.message || e) }); }
  }
}

export default async (req) => {
  // Read-only diagnostics. ?diag=staff proves who can actually see the staff rooms (the sync
  // reporting "changed nothing" is ambiguous between already-correct and wrongly-judged-correct,
  // and privacy is not something to infer); ?diag=guild dumps the server's structure for audits.
  // GATED: describing a private room — even just its name and who may read it — is itself
  // information about the league office, so this requires app_config.diag_key and 404s otherwise.
  // Never returns ids, tokens, or message content.
  const diag = (() => { try { return new URL(req.url).searchParams; } catch { return new URLSearchParams(); } })();
  const diagMode = diag.get("diag");
  const regMode = diag.get("register");   // ?register=commands (re)registers the guild slash commands
  const setupMode = diag.get("setup");    // ?setup=community configures the welcome screen + onboarding
  const reconcileMode = diag.get("reconcile"); // ?reconcile=teams prunes team voice + orphan rooms/roles, provisions new clubs
  if (diagMode || regMode || setupMode || reconcileMode) {
    const keyRow = await sbGet("app_config?key=eq.diag_key&select=value").catch(() => []);
    const want = keyRow[0] && keyRow[0].value;
    const got = diag.get("key") || req.headers.get("x-diag-key") || "";
    // constant-length compare is overkill for a diagnostic, but never 401 — a 404 doesn't
    // confirm the endpoint exists to someone probing for it
    if (!want || got !== want) return new Response("Not found", { status: 404 });
  }
  try {
    // Register the guild slash commands (idempotent bulk-overwrite). Only /join is advertised — this
    // replaces the old /lfg. (The handler still accepts an "lfg" name as a harmless safety net.)
    if (BOT && GUILD && regMode === "commands") {
      const app = await dApi("GET", `/applications/@me`);
      const res = await dApi("PUT", `/applications/${app.id}/guilds/${GUILD}/commands`, GUILD_COMMANDS);
      return new Response(JSON.stringify({ appId: app.id, registered: (res || []).map((c) => c.name) }, null, 2),
        { status: 200, headers: { "content-type": "application/json" } });
    }

    // Ground truth for the office: does every member's PARTICIPATION role match the database?
    // Compares the live guild against season_registrations for the three roles the sweep manages
    // around sign-ups (Not Signed Up / Player / Free Agent context). Read-only, names only.
    // "The sync reported no errors" is not the same as "the roles are right" — this proves it.
    if (BOT && GUILD && diagMode === "rolecheck") {
      const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
      const rid = {}; for (const r of roles) rid[(r.name || "").toLowerCase()] = r.id;
      const members = [];
      let after = "0";
      for (let page = 0; page < 10; page++) {
        const chunk = await dApi("GET", `/guilds/${GUILD}/members?limit=1000&after=${after}`);
        if (!Array.isArray(chunk) || !chunk.length) break;
        members.push(...chunk);
        if (chunk.length < 1000) break;
        after = chunk[chunk.length - 1].user.id;
      }
      /* Rule 1.1 (v2.8): registration stays open until the NEXT season's opens — the deadline is
         only the draft-eligibility line. Prefer the season whose registration is open. */
      const season = (await sbGet("seasons?select=id,registration_open&registration_open=is.true&order=number.desc&limit=1"))[0]
        || (await sbGet("seasons?select=id,registration_open&order=number.desc&limit=1"))[0] || {};
      const regOpen = !!season.registration_open;
      const registered = new Set((await sbGet(`season_registrations?season_id=eq.${season.id}&select=profile_id&limit=10000`)).map((r) => r.profile_id));
      const linkRows = await sbGet("discord_links?select=profile_id,gamertag,discord_id");
      const byDiscord = {}; for (const l of linkRows) if (l.discord_id) byDiscord[String(l.discord_id)] = l;
      const nsu = rid["not signed up"], player = rid["player"];
      const out = {
        guildMembers: members.length, linked: 0, registeredInDb: registered.size, regOpen,
        registeredWearingNotSignedUp: [], registeredMissingPlayer: [],
        unregisteredMissingNotSignedUp: [], unlinkedWearingNotSignedUp: [],
      };
      for (const m of members) {
        if (m.user && m.user.bot) continue;
        const link = byDiscord[String(m.user.id)];
        const has = new Set(m.roles || []);
        const nm = m.nick || (m.user && (m.user.global_name || m.user.username));
        if (!link) { if (nsu && has.has(nsu)) out.unlinkedWearingNotSignedUp.push(nm); continue; }
        out.linked++;
        const isReg = registered.has(link.profile_id);
        if (isReg && nsu && has.has(nsu)) out.registeredWearingNotSignedUp.push(nm);
        if (isReg && player && !has.has(player)) out.registeredMissingPlayer.push(nm);
        if (!isReg && regOpen && nsu && !has.has(nsu)) out.unregisteredMissingNotSignedUp.push(nm);
      }
      out.verdict = (out.registeredWearingNotSignedUp.length || out.registeredMissingPlayer.length || out.unregisteredMissingNotSignedUp.length)
        ? "MISMATCHES — the 2-minute sweep should clear these; if one persists, that member's top role likely outranks the bot"
        : "clean — every linked member's participation roles match the database";
      out.note = "unlinkedWearingNotSignedUp = in the Discord but never signed into the site; the role is telling them the truth";
      return new Response(JSON.stringify(out, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Grant the Staff role its moderation powers: "Timeout Members" (the modern mute — blocks
    // sending, reacting and speaking) plus voice Mute. Additive and idempotent: it ORs the bits
    // into whatever the role already has and never takes a permission away. One-shot (not enforced
    // every sync) so the office can still adjust the role by hand in Discord.
    if (BOT && GUILD && setupMode === "staffmod") {
      const MODERATE_MEMBERS = 1n << 40n;   // "Timeout Members" — mutes text + voice for a duration
      const MUTE_MEMBERS = 1n << 22n;       // voice mute
      const wanted = MODERATE_MEMBERS | MUTE_MEMBERS;
      const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
      const role = roles.find((r) => (r.name || "").toLowerCase() === "staff");
      if (!role) return new Response(JSON.stringify({ error: "staff role not found" }), { status: 200, headers: { "content-type": "application/json" } });
      const cur = BigInt(role.permissions || "0");
      const next = cur | wanted;
      const out = { role: role.name, alreadyHad: { timeout: (cur & MODERATE_MEMBERS) !== 0n, voiceMute: (cur & MUTE_MEMBERS) !== 0n } };
      if (next === cur) out.changed = false;
      else {
        await dApi("PATCH", `/guilds/${GUILD}/roles/${role.id}`, { permissions: next.toString() });
        out.changed = true;
      }
      // A role can only time out members whose HIGHEST role sits below it, so surface the blockers.
      const above = roles.filter((r) => r.position > role.position && r.name !== "@everyone" && !r.managed).map((r) => r.name);
      out.cannotModerate = above;   // members whose top role is one of these are out of Staff's reach
      return new Response(JSON.stringify(out, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Reconcile the Team Rooms with the live club list: delete every per-club VOICE channel (clubs
    // no longer get voice), delete text rooms + roles for clubs that no longer exist, and provision a
    // private text room + role (no voice) for any current club missing one — e.g. a newly added club.
    if (BOT && GUILD && reconcileMode === "teams") {
      const out = { deletedVoice: [], deletedRooms: [], deletedRoles: [], createdRoles: [], createdRooms: [], errors: [] };
      const chans = await dApi("GET", `/guilds/${GUILD}/channels`);
      const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
      const teams = await sbGet("teams?select=id,code,name,color,color2,discord_role_id,discord_channel_id");
      const teamRoomsCat = chans.find((c) => c.type === 4 && (c.name || "").toLowerCase() === "team rooms");
      const currentSlugs = new Set(teams.map((t) => slug(t.name)));
      const roleIdByName = {}; for (const r of roles) roleIdByName[(r.name || "").toLowerCase()] = r.id;
      const orphanSlugs = new Set();

      if (teamRoomsCat) {
        const inCat = chans.filter((c) => c.parent_id === teamRoomsCat.id);
        // every per-club voice channel goes — clubs don't get their own voice
        for (const c of inCat.filter((c) => c.type === 2)) {
          try { await dApi("DELETE", `/channels/${c.id}`); out.deletedVoice.push(c.name); }
          catch (e) { out.errors.push({ voice: c.name, error: String(e.message || e) }); }
        }
        // text rooms for clubs that no longer exist
        for (const c of inCat.filter((c) => c.type === 0)) {
          if (currentSlugs.has(slug(c.name))) continue;
          orphanSlugs.add(slug(c.name));
          try { await dApi("DELETE", `/channels/${c.id}`); out.deletedRooms.push(c.name); }
          catch (e) { out.errors.push({ room: c.name, error: String(e.message || e) }); }
        }
      } else { out.errors.push({ teamRooms: "category not found" }); }

      // orphaned team roles: a role whose slug matches a room we just removed. Never a managed/booster role.
      for (const r of roles) {
        if (r.managed || (r.name || "").toLowerCase() === "@everyone") continue;
        if (orphanSlugs.has(slug(r.name))) {
          try { await dApi("DELETE", `/guilds/${GUILD}/roles/${r.id}`); out.deletedRoles.push(r.name); }
          catch (e) { out.errors.push({ role: r.name, error: String(e.message || e) }); }
        }
      }

      // provision a role + private text room (no voice) for any current club missing one
      // Commissioner + Staff only — the seat roles are worn across every club, so putting them on
      // one club's room opens it to all five front offices (same rule as ensureClubRooms).
      const office = ["commissioner", "staff"].map((n) => roleIdByName[n]).filter(Boolean);
      for (const t of teams) {
        try {
          let trole = t.discord_role_id;
          if (!trole || !roles.find((r) => r.id === trole)) {
            const existing = roles.find((r) => !r.managed && slug(r.name) === slug(t.name));
            if (existing) trole = existing.id;
            else {
              const wantColor = /^#?[0-9a-f]{6}$/i.test(t.color || "") ? parseInt(String(t.color).replace("#", ""), 16) : 0;
              const cr = await dApi("POST", `/guilds/${GUILD}/roles`, { name: t.name, color: wantColor, mentionable: false });
              if (cr && cr.id) { trole = cr.id; out.createdRoles.push(t.name); }
            }
            if (trole) await sbPatch(`teams?id=eq.${t.id}`, { discord_role_id: trole });
          }
          let tchan = t.discord_channel_id;
          if (teamRoomsCat && (!tchan || !chans.find((c) => c.id === tchan))) {
            const existing = chans.find((c) => c.type === 0 && c.parent_id === teamRoomsCat.id && slug(c.name) === slug(t.name));
            if (existing) tchan = existing.id;
            else {
              const allow = String(1024 | 2048 | 65536); // VIEW + SEND + READ_HISTORY
              const overwrites = [{ id: GUILD, type: 0, deny: "1024", allow: "0" }];
              if (trole) overwrites.push({ id: trole, type: 0, allow, deny: "0" });
              for (const oid of office) overwrites.push({ id: oid, type: 0, allow, deny: "0" });
              const topic = `Private room for the ${t.name} — roster, lineups, and team talk. Visible only to the club and staff.`;
              const cc = await dApi("POST", `/guilds/${GUILD}/channels`, { name: slug(t.name), type: 0, parent_id: teamRoomsCat.id, topic, permission_overwrites: overwrites });
              if (cc && cc.id) { tchan = cc.id; out.createdRooms.push(cc.name); }
            }
            if (tchan) await sbPatch(`teams?id=eq.${t.id}`, { discord_channel_id: tchan });
          }
        } catch (e) { out.errors.push({ provision: t.name, error: String(e.message || e) }); }
      }

      return new Response(JSON.stringify(out, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Configure Community onboarding + welcome screen (idempotent). Prompt options reveal CHANNELS
    // only — never roles — so nothing here fights the managed role sync. Enabling onboarding turns on
    // the low-friction rules-accept gate; the welcome bot already skips members still in that gate.
    if (BOT && GUILD && setupMode === "community") {
      const chans = await dApi("GET", `/guilds/${GUILD}/channels`);
      const idByName = {};
      for (const c of chans) { if (c.type === 0) { const n = (c.name || "").toLowerCase(); if (!idByName[n]) idByName[n] = c.id; } }
      const pick = (names) => names.map((n) => idByName[n]).filter(Boolean);
      const out = {};

      // Welcome screen — the panel a prospective member sees on the invite.
      const ws = [
        { name: "welcome", desc: "Start here — what Chel Gaming is", emoji: "👋" },
        { name: "season-signups", desc: "Register to play this season", emoji: "📝" },
        { name: "pickup-games", desc: "Jump into pickup 6s — run /join", emoji: "🏒" },
        { name: "rules", desc: "The league rulebook", emoji: "📖" },
      ].filter((w) => idByName[w.name]).slice(0, 5);
      try {
        await dApi("PATCH", `/guilds/${GUILD}/welcome-screen`, {
          enabled: true,
          description: "Competitive 6v6 EA NHL — a full season with automated stats, and clubs you can own and run.",
          welcome_channels: ws.map((w) => ({ channel_id: idByName[w.name], description: w.desc, emoji_name: w.emoji })),
        });
        out.welcomeScreen = "set";
      } catch (e) { out.welcomeScreenError = String(e.message || e); }

      // Onboarding — a solid set of default channels + one optional, channel-only routing question.
      const defaults = pick(["welcome", "rules", "announcements", "season-signups", "schedule", "standings", "news", "general-chat", "trash-talk", "highlight-reel", "league-suggestions", "pickup-games"]);
      const opt = (id, title, desc, names) => ({ id, title, description: desc, channel_ids: pick(names), role_ids: [] });
      const onboarding = {
        default_channel_ids: defaults,
        enabled: true,
        mode: 0,
        prompts: [{
          id: "1", type: 0, title: "What brings you to Chel Gaming?",
          single_select: true, required: false, in_onboarding: true,
          options: [
            opt("11", "I want to play this season", "Sign up and get into pickup games.", ["season-signups", "pickup-games"]),
            opt("12", "I want to own or manage a club", "Run a franchise — draft, cap, and trades.", ["season-signups", "announcements", "website"]),
            opt("13", "Just following along", "Scores, standings, and league news.", ["standings", "game-scores", "news"]),
          ],
        }],
      };
      try {
        await dApi("PUT", `/guilds/${GUILD}/onboarding`, onboarding);
        out.onboarding = "enabled";
        out.defaultChannels = defaults.length;
      } catch (e) { out.onboardingError = String(e.message || e); }

      return new Response(JSON.stringify(out, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (BOT && GUILD && diagMode === "guild") {
      const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
      const chans = await dApi("GET", `/guilds/${GUILD}/channels`);
      const TYPE = { 0: "text", 2: "voice", 4: "category", 5: "announcement", 13: "stage", 15: "forum" };
      const catName = Object.fromEntries(chans.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
      const priv = (c) => {
        const ev = (c.permission_overwrites || []).find((o) => o.id === GUILD);
        return !!ev && (BigInt(ev.deny || "0") & 1024n) === 1024n;
      };
      return new Response(JSON.stringify({
        roles: roles.filter((r) => r.name !== "@everyone")
          .sort((a, b) => b.position - a.position)
          .map((r) => ({ name: r.name, color: r.color, hoisted: r.hoist, mentionable: r.mentionable, managed: r.managed })),
        channels: chans.filter((c) => c.type !== 4).sort((a, b) => a.position - b.position).map((c) => ({
          name: c.name, type: TYPE[c.type] || c.type, category: catName[c.parent_id] || null,
          private: priv(c), topic: c.topic || null, nsfw: !!c.nsfw, slowmode: c.rate_limit_per_user || 0,
        })),
        categories: chans.filter((c) => c.type === 4).sort((a, b) => a.position - b.position).map((c) => c.name),
      }, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (BOT && GUILD && diagMode === "staff") {
      const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
      const byId = Object.fromEntries(roles.map((r) => [r.id, r.name]));
      const office = roles.filter((r) => ["commissioner", "staff"].includes(r.name.toLowerCase()));
      const cfg = await sbGet("app_config?key=eq.discord_staff_channel_ids&select=value");
      const configured = String((cfg[0] && cfg[0].value) || "").split(",").map((s) => s.trim()).filter(Boolean);
      const chans = await dApi("GET", `/guilds/${GUILD}/channels`);
      // same target set the sync enforces: every room under a private category, plus pinned ids
      const privCatIds = chans.filter((c) => c.type === 4 && (/^staff\b/i.test(c.name || "") || /^commissioners?\b/i.test(c.name || ""))).map((c) => c.id);
      const ids = [...new Set([...configured, ...chans.filter((c) => c.type !== 4 && privCatIds.includes(c.parent_id)).map((c) => c.id)])];
      const report = ids.map((cid) => {
        const c = chans.find((x) => x.id === cid);
        if (!c) return { channel: null, configuredId: cid, exists: false };
        const ow = c.permission_overwrites || [];
        const ev = ow.find((o) => o.id === GUILD);
        return {
          channel: "#" + c.name, exists: true,
          hiddenFromEveryone: !!ev && (BigInt(ev.deny || "0") & 1024n) === 1024n,
          canView: ow.filter((o) => (BigInt(o.allow || "0") & 1024n) === 1024n)
            .map((o) => (o.type === 0 ? byId[o.id] || "(role)" : "(member)")),
        };
      });
      return new Response(JSON.stringify({
        officeRoles: office.map((r) => r.name),
        privateCategories: chans.filter((c) => privCatIds.includes(c.id)).map((c) => c.name),
        staffChannels: report,
      }, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Who can actually read each club's room. A club room is for THAT club plus the league
    // office — an Owner/GM/AGM role allow would open every club's room to every club's front
    // office, which is a scouting leak rather than a permission subtlety. Read-only; names only.
    if (BOT && GUILD && diagMode === "teamrooms") {
      const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
      const byId = Object.fromEntries(roles.map((r) => [r.id, r.name]));
      const chans = await dApi("GET", `/guilds/${GUILD}/channels`);
      const teams = await sbGet("teams?select=code,name,discord_role_id,discord_channel_id");
      const seatNames = ["owner", "general manager", "assistant general manager"];
      const seatIds = roles.filter((r) => seatNames.includes((r.name || "").toLowerCase())).map((r) => r.id);
      const report = teams.map((t) => {
        const c = t.discord_channel_id && chans.find((x) => x.id === t.discord_channel_id);
        if (!c) return { club: t.code, room: null, provisioned: false };
        const ow = c.permission_overwrites || [];
        const ev = ow.find((o) => o.id === GUILD);
        const viewers = ow.filter((o) => (BigInt(o.allow || "0") & 1024n) === 1024n);
        return {
          club: t.code, room: "#" + c.name, provisioned: true,
          hiddenFromEveryone: !!ev && (BigInt(ev.deny || "0") & 1024n) === 1024n,
          clubRoleCanView: viewers.some((o) => o.id === t.discord_role_id),
          canView: viewers.map((o) => (o.type === 0 ? byId[o.id] || "(role)" : "(member)")),
          // the whole point of this check: seat roles must NOT appear above
          seatRolesWithAccess: viewers.filter((o) => seatIds.includes(o.id)).map((o) => byId[o.id]),
        };
      });
      const leaking = report.filter((r) => (r.seatRolesWithAccess || []).length);
      const catsWithSeats = chans.filter((c) => c.type === 4 && /^team rooms$/i.test(c.name || ""))
        .map((c) => ({ category: c.name,
          seatRolesWithAccess: (c.permission_overwrites || [])
            .filter((o) => seatIds.includes(o.id) && (BigInt(o.allow || "0") & 1024n) === 1024n)
            .map((o) => byId[o.id]) }));
      return new Response(JSON.stringify({
        verdict: leaking.length
          ? `${leaking.length} club room(s) still grant a seat role — every front office can read them`
          : "clean — each club room is visible to its own club plus the league office only",
        teamRooms: report,
        teamRoomsCategory: catsWithSeats,
      }, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }
  } catch (e) { return new Response(JSON.stringify({ diagError: String(e.message || e) }), { status: 500, headers: { "content-type": "application/json" } }); }

  if (!SB_URL || !SB_KEY || !BOT || !GUILD) {
    console.log("discord-sync: missing env (need bot token + guild id + Supabase) — skipping");
    return new Response("skipped: missing env", { status: 200 });
  }
  // collapse rapid repeat invocations (spam / abuse); scheduled runs are 5 min apart so this never blocks them
  if (await ranRecently("discord-sync", 6)) return new Response("skipped: ran moments ago", { status: 200 });

  const links = await sbGet("discord_links?select=profile_id,gamertag,role,discord_id,team_id,discord_username");
  // staff department picks (site) -> department Discord roles for the officials who chose them
  const deptByProfile = {};
  try { for (const p of await sbGet("profiles?select=id,departments&role=in.(staff,commissioner)")) deptByProfile[p.id] = p.departments || []; } catch (e) {}
  const bannedIds = new Set((await sbGet("profiles?banned=eq.true&select=id")).map((p) => p.id));
  // current in_guild per profile, so we only write when it changes
  const inGuildById = {};
  for (const p of await sbGet("profiles?select=id,in_guild")) inGuildById[p.id] = p.in_guild;
  const markGuild = async (pid, v) => { if (inGuildById[pid] !== v) { await sbPatch(`profiles?id=eq.${pid}`, { in_guild: v }); inGuildById[pid] = v; } };
  const teams = await sbGet("teams?select=id,code,name,color,color2,logo_url,owner_profile_id,gm_profile_id,agm_profile_id,discord_role_id,discord_channel_id");
  const teamRoleId = Object.fromEntries(teams.filter((t) => t.discord_role_id).map((t) => [t.id, t.discord_role_id]));
  // team management role now lives on the team's slots (owner/gm/agm), not profiles.role
  const mgmtRoleByProfile = {};
  for (const t of teams) {
    if (t.owner_profile_id) mgmtRoleByProfile[t.owner_profile_id] = "owner";
    if (t.gm_profile_id) mgmtRoleByProfile[t.gm_profile_id] = "gm";
    if (t.agm_profile_id) mgmtRoleByProfile[t.agm_profile_id] = "agm";
  }

  // player position (current season) -> for position-based Discord roles
  // POS_LABEL / POSITION_ROLES come from shared/roles.mjs (imported at top)
  const posOf = {};
  try {
    const seasons = await sbGet("seasons?select=id&order=number.desc&limit=1");
    const seasonId = seasons[0] && seasons[0].id;
    if (seasonId) {
      for (const r of await sbGet(`season_registrations?season_id=eq.${seasonId}&select=profile_id,position`)) if (r.position) posOf[r.profile_id] = r.position;
      for (const s of await sbGet(`roster_spots?season_id=eq.${seasonId}&select=profile_id,position`)) if (s.position) posOf[s.profile_id] = s.position; // roster spot wins over signup
    }
  } catch (e) { /* positions optional */ }

  // guild roles + channels (id -> current name) for auto-rename + id-based assignment
  const guildRoles = await dApi("GET", `/guilds/${GUILD}/roles`);
  const roleNameById = Object.fromEntries(guildRoles.map((r) => [r.id, r.name]));
  const roleColorById = Object.fromEntries(guildRoles.map((r) => [r.id, r.color]));
  const roleObjById = Object.fromEntries(guildRoles.map((r) => [r.id, r]));
  const roleId = {};
  for (const r of guildRoles) roleId[r.name.toLowerCase()] = r.id;
  const guildChannels = await dApi("GET", `/guilds/${GUILD}/channels`);
  const chanNameById = Object.fromEntries(guildChannels.map((c) => [c.id, c.name]));

  const sum = { checked: 0, renamed: 0, roleUpdated: 0, roleRenamed: 0, chanRenamed: 0, notInServer: 0,
    staffChecked: 0, staffLocked: 0, staffMissing: 0, errors: [] };

  /* @everyone/@here stays with the league office — re-checked every sweep, not just once.
     Must run AFTER `sum` exists: this call sat nine lines above the declaration for one deploy,
     and because the catch block also touches `sum`, the temporal-dead-zone ReferenceError threw
     twice and killed the whole sweep before it could write its result. */
  try { await enforceMentionPolicy(guildRoles, sum); }
  catch (e) { sum.errors.push({ mentionPolicy: String(e.message || e) }); }

  /* Anti-spam baseline, re-asserted every sweep for the same reason the mention policy is: a
     permission changed by hand in the UI, or a role recreated from a template, silently reopens
     the hole and nothing would say so. `teams` (line above) supplies the club role ids; both it
     and `sum` are declared before this point — see the TDZ note above, that mistake cost a sweep. */
  try { await enforcePostingPolicy(guildRoles, teams, sum); }
  catch (e) { sum.errors.push({ postingPolicy: String(e.message || e) }); }
  try {
    const g0 = await dApi("GET", `/guilds/${GUILD}`);
    if (g0 && !g0.__notfound) await enforceVerificationLevel(g0, sum);
  } catch (e) { sum.errors.push({ verificationLevel: String(e.message || e) }); }

  // Department roles + their Staff-category rooms first, so the private-channel sweep below can
  // self-heal them the same run. deptRoleByChannel lets that sweep keep each room department-private
  // (its role + commissioners) instead of the category default (all staff).
  try { await ensureStaffDepartments(guildChannels, roleId, roleNameById, sum); } catch (e) { sum.errors.push({ staffDepts: String(e.message || e) }); }
  try { await ensureGuildCommands(sum); } catch (e) { sum.errors.push({ commands: String(e.message || e) }); }
  /* One-shot Discord reap: when a club is removed from the league, its role and channel objects
     outlive the database row — the sync creates guild furniture but deliberately never deletes any
     on its own. The commissioner tooling writes the ids to reap into app_config (discord_reap:
     {"roles":[],"channels":[]}); this consumes the list, deletes exactly those ids, and clears the
     key. Explicit ids only — this must never infer what to delete. */
  try {
    const reapCfg = await sbGet(`app_config?key=eq.discord_reap&select=value`);
    if (reapCfg && reapCfg[0] && reapCfg[0].value) {
      const reap = JSON.parse(reapCfg[0].value);
      for (const rid of (reap.roles || [])) {
        try { await dApi("DELETE", `/guilds/${GUILD}/roles/${rid}`); sum.reapedRoles = (sum.reapedRoles || 0) + 1; }
        catch (e) { sum.errors.push({ reapRole: rid, error: String(e.message || e) }); }
      }
      for (const cid of (reap.channels || [])) {
        try { await dApi("DELETE", `/channels/${cid}`); sum.reapedChannels = (sum.reapedChannels || 0) + 1; }
        catch (e) { sum.errors.push({ reapChannel: cid, error: String(e.message || e) }); }
      }
      /* consumed — errors above are surfaced but do NOT re-run forever on a dead id (dApi maps
         404 to null, so an already-gone object counts as reaped) */
      await fetch(`${SB_URL}/rest/v1/app_config?key=eq.discord_reap`, { method: "DELETE", headers: sbHead() });
    }
  } catch (e) { sum.errors.push({ reap: String(e.message || e) }); }
  /* the commissioner-only departures room, and its id for the announcer further down */
  try { const dch = await ensureDeparturesChannel(guildChannels, roleId, sum); if (dch && dch.id) sum.__departChanId = dch.id; }
  catch (e) { sum.errors.push({ departChan: String(e.message || e) }); }
  const deptRoleByChannel = {};
  for (const d of STAFF_DEPARTMENTS) { const rid = roleId[d.role.toLowerCase()]; if (rid) deptRoleByChannel[d.channel] = rid; }
  try {
    const dmap = {};
    for (const d of STAFF_DEPARTMENTS) if (roleId[d.role.toLowerCase()]) dmap[d.key] = roleId[d.role.toLowerCase()];
    if (Object.keys(dmap).length) await sbUpsertCfg("discord_dept_role_ids", JSON.stringify(dmap));
  } catch (e) { sum.errors.push({ deptRoleIds: String(e.message || e) }); }
  /* The department -> room map, the twin of discord_dept_role_ids above. The gateway bot's instant
     desk alerts (bot/staff-alerts.mjs) resolve a room from this rather than searching the guild by
     name, so a room renamed here is followed there on the next sweep. Matched under the Staff
     category only — a public channel that happens to share the name must never be posted into. */
  try {
    const staffCat = guildChannels.find((c) => c.type === 4 && /^staff\b/i.test(c.name || ""));
    const cmap = {};
    if (staffCat) {
      for (const d of STAFF_DEPARTMENTS) {
        const ch = guildChannels.find((c) => c.name === d.channel && c.parent_id === staffCat.id);
        if (ch && ch.id) cmap[d.key] = ch.id;
      }
    }
    if (Object.keys(cmap).length) await sbUpsertCfg("discord_dept_channel_ids", JSON.stringify(cmap));
    sum.deptChanMapped = Object.keys(cmap).length;
  } catch (e) { sum.errors.push({ deptChannelIds: String(e.message || e) }); }

  // #trade-block and #free-agency self-heal to their intended audience if @everyone view ever
  // gets re-added. They are NOT the same audience: #trade-block is team management only, but
  // #free-agency exists for free agents AND clubs to talk deals, so the Free Agent role must be
  // able to see it — locking it to management hid the channel from the very people it is for.
  // VIEW_CHANNEL(1024)+SEND_MESSAGES(2048)+READ_HISTORY(65536)=68608.
  const MGMT_ALLOW = "68608";
  const mgmtRoleIds = ["owner", "general manager", "assistant general manager", "commissioner"].map((n) => roleId[n]).filter(Boolean);
  const faRoleId = roleId["free agent"];
  const CHANNEL_AUDIENCE = {
    "trade-block": mgmtRoleIds,
    "free-agency": [...mgmtRoleIds, faRoleId].filter(Boolean),
  };
  for (const cname of Object.keys(CHANNEL_AUDIENCE)) {
    const allowIds = CHANNEL_AUDIENCE[cname];
    const chan = guildChannels.find((c) => c.name === cname && c.type === 0);
    if (!chan || !allowIds.length) continue;
    const ow = chan.permission_overwrites || [];
    const everyone = ow.find((o) => o.id === GUILD);
    const hidden = everyone && (BigInt(everyone.deny || "0") & 1024n) === 1024n;
    // Fast-path skip only when it's hidden from @everyone AND every intended role can already
    // view it — otherwise a missing role allow (e.g. Free Agent) would never be healed.
    const allAllowed = allowIds.every((rid) => {
      const o = ow.find((x) => x.id === rid);
      return o && (BigInt(o.allow || "0") & 1024n) === 1024n;
    });
    if (hidden && allAllowed) continue;
    try {
      // Grant the audience FIRST, then deny @everyone — never deny-then-stop, or a mid-sweep
      // failure would leave the channel hidden from everyone including its own audience.
      for (const rid of allowIds) await dApi("PUT", `/channels/${chan.id}/permissions/${rid}`, { type: 0, allow: MGMT_ALLOW, deny: "0" });
      await dApi("PUT", `/channels/${chan.id}/permissions/${GUILD}`, { type: 0, deny: "1024", allow: "0" });
      sum.mgmtLocked = (sum.mgmtLocked || 0) + 1;
    } catch (e) { sum.errors.push({ lockChannel: cname, error: String(e.message || e) }); }
  }

  // Team channels self-heal the same way: private to the club + the league office (Commissioner +
  // Staff). The club-role allow goes in the SAME pass as the @everyone deny (never deny first and
  // stop — the club would lose sight of its own room).
  //
  // The fast-path checks FOUR things, not two. Checking only "hidden + club can view" let two
  // real faults survive indefinitely, because a room that was hidden with its club allowed was
  // never looked at again: #hurricanes and #maple-leafs sat without Staff access, and #penguins
  // kept the Owner/GM/AGM allows its creation pass had added — which let every club's front
  // office read another club's room.
  const staffRoleIds = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  // Seat roles are worn across clubs, so they must never appear on a single club's room.
  const seatRoleIds = ["owner", "general manager", "assistant general manager"].map((n) => roleId[n]).filter(Boolean);
  for (const t of teams) {
    if (!t.discord_channel_id || !t.discord_role_id) continue;
    const chan = guildChannels.find((c) => c.id === t.discord_channel_id);
    if (!chan) continue;
    const ow = chan.permission_overwrites || [];
    const everyone = ow.find((o) => o.id === GUILD);
    const clubAllow = ow.find((o) => o.id === t.discord_role_id);
    const hidden = everyone && (BigInt(everyone.deny || "0") & 1024n) === 1024n;
    const clubOk = clubAllow && (BigInt(clubAllow.allow || "0") & 1024n) === 1024n;
    const officeOk = staffRoleIds.every((rid) => {
      const o = ow.find((x) => x.id === rid);
      return o && (BigInt(o.allow || "0") & 1024n) === 1024n;
    });
    // any seat-role overwrite at all, granting or not — none belongs on a club room
    const strays = ow.filter((o) => seatRoleIds.includes(o.id));
    if (hidden && clubOk && officeOk && !strays.length) continue;
    try {
      await dApi("PUT", `/channels/${chan.id}/permissions/${t.discord_role_id}`, { type: 0, allow: MGMT_ALLOW, deny: "0" });
      for (const rid of staffRoleIds) await dApi("PUT", `/channels/${chan.id}/permissions/${rid}`, { type: 0, allow: MGMT_ALLOW, deny: "0" });
      // remove the cross-club seat roles only — a member-specific overwrite or the bot's own
      // integration role is somebody's deliberate choice and is left exactly as it is
      for (const o of strays) {
        await dApi("DELETE", `/channels/${chan.id}/permissions/${o.id}`);
        sum.teamSeatRolesRemoved = (sum.teamSeatRolesRemoved || 0) + 1;
      }
      await dApi("PUT", `/channels/${chan.id}/permissions/${GUILD}`, { type: 0, deny: "1024", allow: "0" });
      sum.teamLocked = (sum.teamLocked || 0) + 1;
    } catch (e) { sum.errors.push({ lockChannel: t.name, error: String(e.message || e) }); }
  }

  // Private categories, and exactly who may read each. The league office is NOT one audience:
  // #commissioner-chat is commissioners only, while the staff rooms are commissioners AND staff.
  // Widening one regex to cover both categories would quietly hand Staff the commissioners' room,
  // so the permitted roles are declared per category instead.
  const PRIVATE_CATEGORIES = [
    { match: /^staff\b/i,          roles: ["commissioner", "staff"] },
    { match: /^commissioners?\b/i, roles: ["commissioner"] },
  ];

  // Each private room is self-healed on every pass, exactly like the club rooms. Membership comes
  // from the category a channel sits in, so a room added months from now is covered without anyone
  // remembering to register it — plus any ids pinned in app_config.discord_staff_channel_ids.
  // SAFETY: a category whose roles don't resolve is skipped entirely. Denying @everyone with no
  // allow in place would hide the room from everybody, including the people who need it.
  try {
    const cfgRows = await sbGet("app_config?key=eq.discord_staff_channel_ids&select=value");
    const pinned = String((cfgRows[0] && cfgRows[0].value) || "")
      .split(",").map((s) => s.trim()).filter(Boolean);

    // channel id -> the role ids permitted to see it
    const target = new Map();
    for (const spec of PRIVATE_CATEGORIES) {
      const allowIds = spec.roles.map((n) => roleId[n]).filter(Boolean);
      if (allowIds.length !== spec.roles.length) {
        sum.errors.push({ lockPrivate: `roles ${spec.roles.join("+")} did not all resolve — category skipped rather than risk hiding it from everyone` });
        continue;
      }
      const catIds = guildChannels.filter((c) => c.type === 4 && spec.match.test(c.name || "")).map((c) => c.id);
      // every channel type, not just text — a private voice room or forum is exactly as private as
      // a text room, and VIEW_CHANNEL is what gates all of them
      for (const c of guildChannels) {
        if (c.type !== 4 && catIds.includes(c.parent_id)) {
          // a department room stays private to ITS role + the commissioners, not all of staff
          const deptRid = deptRoleByChannel[c.name];
          target.set(c.id, deptRid ? [roleId["commissioner"], deptRid].filter(Boolean) : allowIds);
        }
      }
    }
    // pinned ids default to the staff audience, which is what they were registered for
    if (staffRoleIds.length) for (const id of pinned) if (!target.has(id)) target.set(id, staffRoleIds);

    if (target.size) {
      for (const [cid, allowIds] of target) {
        sum.staffChecked++;
        const chan = guildChannels.find((c) => c.id === cid);
        // a pinned room that no longer exists is a misconfiguration, not an outage — count it
        // so the Automations panel shows it, but don't page the watchdog over a deleted channel
        if (!chan) { sum.staffMissing++; continue; }
        const ow = chan.permission_overwrites || [];
        const everyone = ow.find((o) => o.id === GUILD);
        const hidden = everyone && (BigInt(everyone.deny || "0") & 1024n) === 1024n;
        const officeOk = allowIds.every((rid) => {
          const a = ow.find((o) => o.id === rid);
          return a && (BigInt(a.allow || "0") & 1024n) === 1024n;
        });
        if (hidden && officeOk) continue; // already correct
        // grant the permitted roles FIRST, then hide from @everyone (never the other way round)
        for (const rid of allowIds) await dApi("PUT", `/channels/${chan.id}/permissions/${rid}`, { type: 0, allow: MGMT_ALLOW, deny: "0" });
        await dApi("PUT", `/channels/${chan.id}/permissions/${GUILD}`, { type: 0, deny: "1024", allow: "0" });
        sum.staffLocked++;
      }
    }
  } catch (e) { sum.errors.push({ lockPrivate: String(e.message || e) }); }

  // A room's topic states who it's for, and the sweep above states who can actually read it — when
  // those disagree the topic is the one that misleads (#design-suggestions announced itself as
  // "Staff-only" while sitting in the commissioners-only category). Canonical topics live in
  // app_config.discord_channel_topics as {"channel-name": "topic"} so they can be corrected without
  // a deploy, and are reconciled here the same way club topics are.
  try {
    const rows = await sbGet("app_config?key=eq.discord_channel_topics&select=value");
    const want = rows[0] && rows[0].value ? JSON.parse(rows[0].value) : null;
    if (want) {
      // Only text-like channels carry a topic — voice and stage reject it outright with a 400.
      const TOPIC_TYPES = [0, 5, 15];
      for (const [name, topic] of Object.entries(want)) {
        const chan = guildChannels.find((c) => c.name === name && TOPIC_TYPES.includes(c.type));
        if (!chan || (chan.topic || "") === topic) continue;
        // one unhappy channel must not abandon the rest of the map
        try {
          await dApi("PATCH", `/channels/${chan.id}`, { topic });
          sum.topicsFixed = (sum.topicsFixed || 0) + 1;
        } catch (e) { sum.errors.push({ channelTopic: name, error: String(e.message || e).slice(0, 140) }); }
      }
    }
  } catch (e) { sum.errors.push({ channelTopics: String(e.message || e) }); }

  // (0) keep each team's Discord ROLE (name + color) + CHANNEL name in sync with the site
  for (const t of teams) {
    try {
      if (t.discord_role_id && roleNameById[t.discord_role_id]) {
        const patch = {};
        if (roleNameById[t.discord_role_id] !== t.name) { patch.name = t.name; sum.roleRenamed++; }
        // role color mirrors the club's primary color from the site (teams.color hex -> int)
        const wantColor = /^#?[0-9a-f]{6}$/i.test(t.color || "") ? parseInt(String(t.color).replace("#", ""), 16) : null;
        if (wantColor != null && roleColorById[t.discord_role_id] !== wantColor) {
          patch.color = wantColor; sum.roleRecolored = (sum.roleRecolored || 0) + 1;
        }
        if (Object.keys(patch).length) await dApi("PATCH", `/guilds/${GUILD}/roles/${t.discord_role_id}`, patch);
      }
      const wantSlug = slug(t.name);
      // The topic names the club, so a rename has to carry into it too. Syncing only the name is how
      // every team room ended up advertising a club that no longer exists ("Private room for the
      // Aurora Blades" sitting on #dallas-stars). Name and topic go in one PATCH — same rate limit.
      const wantTopic = `Private room for the ${t.name} — roster, lineups, and team talk. Visible only to the club and staff.`;
      if (t.discord_channel_id && chanNameById[t.discord_channel_id]) {
        const cur = guildChannels.find((c) => c.id === t.discord_channel_id);
        const cpatch = {};
        if (chanNameById[t.discord_channel_id] !== wantSlug) { cpatch.name = wantSlug; sum.chanRenamed++; }
        if (cur && (cur.topic || "") !== wantTopic) { cpatch.topic = wantTopic; sum.chanRetopic = (sum.chanRetopic || 0) + 1; }
        if (Object.keys(cpatch).length) await dApi("PATCH", `/channels/${t.discord_channel_id}`, cpatch);
      }
    } catch (e) { sum.errors.push({ team: t.name, error: String(e.message || e) }); }
  }

  // ensure a Discord role exists for every position (created once, then reused)
  for (const pn of POSITION_ROLES) {
    if (!roleId[pn.toLowerCase()]) {
      try {
        const created = await dApi("POST", `/guilds/${GUILD}/roles`, { name: pn, mentionable: false });
        if (created && created.id) { roleId[pn.toLowerCase()] = created.id; roleNameById[created.id] = pn; sum.rolesCreated = (sum.rolesCreated || 0) + 1; }
      } catch (e) { sum.errors.push({ role: pn, error: String(e.message || e) }); }
    }
  }

  // managed role ids = static roles + position roles (by name) + every team's role (by stored id)
  // MANAGED_STATIC comes from shared/roles.mjs (imported at top)
  // ensure the mentionable roles the automations depend on exist (created once, then reused):
  //  Staff (members ping the officials), the front-office roles (gate the Team Management rooms),
  //  and "Not Signed Up" (the daily sign-up reminder pings this one role).
  const ENSURE_ROLES = [["Staff", true], ["Owner", true], ["General Manager", true], ["Assistant General Manager", true], ["Not Signed Up", true]];
  for (const [name, mentionable] of ENSURE_ROLES) {
    if (roleId[name.toLowerCase()]) continue;
    try {
      const created = await dApi("POST", `/guilds/${GUILD}/roles`, { name, mentionable });
      if (created && created.id) { roleId[name.toLowerCase()] = created.id; roleNameById[created.id] = name; sum.rolesCreated = (sum.rolesCreated || 0) + 1; }
    } catch (e) { sum.errors.push({ role: name, error: String(e.message || e) }); }
  }
  // Reconcile properties on the EXISTING static roles — ENSURE_ROLES only sets them at creation,
  // so roles seeded before the intent changed drifted (Owner and AGM ended up mentionable:false,
  // and the senior Owner role sat un-hoisted below the hoisted GM). Enforce the declared config.
  //   [name, mentionable, hoist]
  const ROLE_PROPS = [
    ["Owner", true, true], ["General Manager", true, true], ["Assistant General Manager", true, false],
    ["Staff", true, true], ["Commissioner", true, true], ["Not Signed Up", true, false],
  ];
  for (const [name, mentionable, hoist] of ROLE_PROPS) {
    const rid = roleId[name.toLowerCase()];
    const cur = rid && roleObjById[rid];
    if (!cur) continue;
    if (cur.mentionable !== mentionable || cur.hoist !== hoist) {
      try {
        await dApi("PATCH", `/guilds/${GUILD}/roles/${rid}`, { mentionable, hoist });
        sum.roleUpdated = (sum.roleUpdated || 0) + 1;
      } catch (e) { sum.errors.push({ roleProps: name, error: String(e.message || e) }); }
    }
  }
  if (roleId["not signed up"]) await sbUpsertCfg("discord_not_signed_up_role_id", roleId["not signed up"]);
  // Publish a name->id map of the league roles so the DATABASE can render @role pills too
  // (public._role_tag reads this). Without it the DB can only bold a role name.
  try {
    const wanted = ["staff", "commissioner", "owner", "general manager", "assistant general manager", "player", "free agent", "not signed up"];
    const map = {};
    for (const n of wanted) if (roleId[n]) map[n] = roleId[n];
    if (Object.keys(map).length) await sbUpsertCfg("discord_role_ids", JSON.stringify(map));
  } catch (e) { sum.errors.push({ roleIdMap: String(e.message || e) }); }
  // the Team Management category + its rooms (private to the front office)
  try { await ensureMgmtCategory(guildChannels, roleId, sum); } catch (e) { sum.errors.push({ mgmtCategory: String(e.message || e) }); }
  try { await ensureAnnouncements(guildChannels, roleId, sum); } catch (e) { sum.errors.push({ announcements: String(e.message || e) }); }
  try { await ensureCommunityChannels(guildChannels, teams, roleId, sum); } catch (e) { sum.errors.push({ communityChannels: String(e.message || e) }); }
  /* after the Team Rooms category is in place: give any club still missing a role or room one
     (a club created by an approved owner application arrives with neither) */
  try { await ensureClubRooms(guildChannels, guildRoles, teams, roleId, sum); } catch (e) { sum.errors.push({ clubRooms: String(e.message || e) }); }
  /* a club that rebranded or relocated: bring its role + room name/colour back in line with the DB */
  try { await syncClubIdentity(guildChannels, guildRoles, teams, sum); } catch (e) { sum.errors.push({ clubIdentity: String(e.message || e) }); }
  try { await syncRoleIcons(guildRoles, teams, roleId, sum); } catch (e) { sum.errors.push({ roleIcons: String(e.message || e) }); }
  /* club colours above the front-office seats, so a player's name shows their club */
  try { await ensureRoleOrder(guildRoles, teams, roleId, sum); } catch (e) { sum.errors.push({ roleOrder: String(e.message || e) }); }

  const managedIds = managedRoleIds(roleId, teams);

  // Current-season registration drives the three participation roles. `registered` is populated
  // year-round (not only while the window is open) so Player and Free Agent stay coherent all
  // season; `regOpen` is the narrower "sign-ups still open" flag that drives Not Signed Up.
  let regOpen = false; const registered = new Set();
  try {
    const s = (await sbGet("seasons?select=id,registration_open&registration_open=is.true&order=number.desc&limit=1"))[0]
      || (await sbGet("seasons?select=id,registration_open&order=number.desc&limit=1"))[0];
    if (s) {
      regOpen = !!s.registration_open;   /* Rule 1.1 (v2.8): the deadline never closes registration */
      for (const r of await sbGet(`season_registrations?season_id=eq.${s.id}&select=profile_id`)) registered.add(r.profile_id);
    }
  } catch (e) { sum.errors.push({ regStatus: String(e.message || e) }); }

  // Guild ban list (paginated), fetched once per run. Two jobs:
  //  * stop re-PUTting the same ban every 5 minutes for already-banned members
  //  * UNBAN reconciliation — a site Unban must lift the Discord ban too, or the member can
  //    never rejoin the server and (since registration requires membership) is locked out forever
  const guildBans = new Set();
  try {
    let after = null;
    for (let page = 0; page < 10; page++) {
      const batch = await dApi("GET", `/guilds/${GUILD}/bans?limit=1000${after ? "&after=" + after : ""}`);
      if (!Array.isArray(batch) || !batch.length) break;
      for (const b of batch) if (b.user && b.user.id) guildBans.add(String(b.user.id));
      if (batch.length < 1000) break;
      after = batch[batch.length - 1].user.id;
    }
  } catch (e) { sum.errors.push({ banList: String(e.message || e) }); }

  /* One bulk member list per run instead of a GET per linked member. That was ~40 requests against
     the same route every sweep, which exhausted the rate-limit bucket (and every retry) once the
     cadence moved to 2 minutes. Uses the same paginated endpoint as discord-welcome, so it needs
     no extra intent. If the listing fails we fall back to per-member fetches rather than skipping
     the sweep entirely. */
  const memberById = new Map();
  let memberListOk = false;
  try {
    let after = "0";
    for (let page = 0; page < 10; page++) {
      const chunk = await dApi("GET", `/guilds/${GUILD}/members?limit=1000&after=${after}`);
      if (!Array.isArray(chunk) || !chunk.length) break;
      for (const mm of chunk) if (mm.user && mm.user.id) memberById.set(String(mm.user.id), mm);
      if (chunk.length < 1000) break;
      after = chunk[chunk.length - 1].user.id;
    }
    memberListOk = true;
    sum.memberList = memberById.size;
    sum.pendingAtGate = [...memberById.values()].filter((mm) => mm.pending === true).length;
    sum.bots = [...memberById.values()].filter((mm) => mm.user && mm.user.bot).length;
  } catch (e) { sum.errors.push({ memberList: String(e.message || e) }); }

  /* Diff this census against the last one to see who left. Runs before the per-member passes below
     so a departure is logged on the same tick it is noticed, not the next one. */
  try { await trackDepartures(memberById, memberListOk, links, teams, sum); }
  catch (e) { sum.errors.push({ departures: String(e.message || e) }); }

  for (const m of links) {
    if (!m.discord_id) continue;
    try {
      // banned players are removed from the server and kept out (no return)
      if (bannedIds.has(m.profile_id)) {
        if (!guildBans.has(String(m.discord_id))) {
          const res = await dApi("PUT", `/guilds/${GUILD}/bans/${m.discord_id}`, { delete_message_seconds: 0 });
          if (!(res && res.__notfound)) sum.banned = (sum.banned || 0) + 1;
        }
        await markGuild(m.profile_id, false);
        continue;
      }
      // not banned on the site but still banned on Discord → lift it (site Unban made real)
      if (guildBans.has(String(m.discord_id))) {
        await dApi("DELETE", `/guilds/${GUILD}/bans/${m.discord_id}`);
        guildBans.delete(String(m.discord_id));
        sum.unbanned = (sum.unbanned || 0) + 1;
      }
      // read from the bulk listing; only fall back to a single fetch if that listing failed
      const mem = memberListOk
        ? (memberById.get(String(m.discord_id)) || { __notfound: true })
        : await dApi("GET", `/guilds/${GUILD}/members/${m.discord_id}`);
      if (mem.__notfound) { sum.notInServer++; await markGuild(m.profile_id, false); continue; }
      sum.checked++;
      await markGuild(m.profile_id, true);

      // (1) username sync — site gamertag follows Discord display name
      const disp = mem.nick || (mem.user && (mem.user.global_name || mem.user.username));
      if (disp && disp !== m.gamertag) { await sbPatch(`profiles?id=eq.${m.profile_id}`, { gamertag: disp }); sum.renamed++; }
      // (1b) store the Discord @handle so the commissioner directory can show it
      const handle = mem.user && mem.user.username;
      if (handle && handle !== m.discord_username) { await sbPatch(`profiles?id=eq.${m.profile_id}`, { discord_username: handle }); }

      // (2) role sync — desired managed roles for this member. The rules live in
      // shared/roles.mjs, shared verbatim with the gateway bot's instant per-member sync.
      const desired = desiredRolesFor(m, { roleId, teamRoleId, registered, regOpen,
        mgmtRoleByProfile, deptByProfile, posOf });
      const { next, changed } = applyManagedRoles(mem.roles, desired, managedIds);
      if (changed) {
        const res = await dApi("PATCH", `/guilds/${GUILD}/members/${m.discord_id}`, { roles: next });
        if (!(res && res.__notfound)) sum.roleUpdated++;
      }
    } catch (e) {
      // owner + higher-role members can't be modified by the bot — log and continue
      sum.errors.push({ discord_id: m.discord_id, error: String(e.message || e) });
    }
  }
  /* Pass 2 — guild members with NO site link. The loop above walks site profiles that carry a
     discord_id, so a member who joined the server but never signed into the website was never
     visited: with ~150 members and ~80 linked, some seventy people sat outside the sweep, which is
     why "Not Signed Up" held 18 members when it should have held roughly 85. They cannot be
     reached from the profiles side because there is nothing to join on — so walk the guild list
     and reconcile everyone the first pass did not cover. An unlinked member's managed roles are
     exactly {Not Signed Up} while sign-ups are open (they have not signed up, by definition), and
     none once the window closes. Their non-managed roles are left alone, same as pass 1. */
  try {
    if (memberListOk && roleId["not signed up"]) {
      const linkedIds = new Set(links.filter((l) => l.discord_id).map((l) => String(l.discord_id)));
      sum.unlinkedSeen = 0;
      for (const [uid, mem] of memberById) {
        if (linkedIds.has(uid)) continue;                       // pass 1 owned this member
        if (mem.user && mem.user.bot) continue;                 // bots never sign up
        sum.unlinkedSeen++;
        const desired = new Set();
        if (regOpen) desired.add(roleId["not signed up"]);
        const { next, changed } = applyManagedRoles(mem.roles, desired, managedIds);
        if (!changed) continue;
        try {
          const res = await dApi("PATCH", `/guilds/${GUILD}/members/${uid}`, { roles: next });
          if (!(res && res.__notfound)) sum.unlinkedTagged = (sum.unlinkedTagged || 0) + 1;
        } catch (e) {
          // the owner and anyone above the bot cannot be edited — count it rather than fail the run
          sum.unlinkedSkipped = (sum.unlinkedSkipped || 0) + 1;
        }
      }
    }
  } catch (e) { sum.errors.push({ unlinkedPass: String(e.message || e) }); }

  // (3) resolve the server for any game whose 30-min pick-lock has passed (auto-fills the match card)
  try {
    const rr = await fetch(`${SB_URL}/rest/v1/rpc/resolve_due_servers`, { method: "POST", headers: sbHead(), body: "{}" });
    sum.serversResolved = rr.ok ? await rr.json() : `err ${rr.status}`;
  } catch (e) { sum.errors.push({ rpc: "resolve_due_servers", error: String(e.message || e) }); }

  console.log("discord-sync:", JSON.stringify(sum));
  // per-run result for the Automations panel — red chip + last error when a run fails
  try {
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "rl_discord-sync_result", value: JSON.stringify({
        at: new Date().toISOString(), ok: sum.errors.length === 0, checked: sum.checked,
        unlinkedSeen: sum.unlinkedSeen, unlinkedTagged: sum.unlinkedTagged,
        gate: sum.gate, guildMemberCount: sum.guildMemberCount, memberList: sum.memberList,
        departed: sum.departed || 0, departAnnounced: sum.departAnnounced || 0,
        roleGradients: sum.roleGradients || 0, roleGradientUnsupported: sum.roleGradientUnsupported || null,
        reapedRoles: sum.reapedRoles || 0, reapedChannels: sum.reapedChannels || 0,
        postingStripped: sum.postingStripped || 0, postingGranted: sum.postingGranted || 0,
        verificationRaised: sum.verificationRaised || null,
        mentionStripped: sum.mentionStripped || 0,
        pendingAtGate: sum.pendingAtGate, bots: sum.bots,
        staffChecked: sum.staffChecked, staffLocked: sum.staffLocked, staffMissing: sum.staffMissing,
        errCount: sum.errors.length, lastError: sum.errors[0] ? JSON.stringify(sum.errors[0]).slice(0, 200) : null
      }), updated_at: new Date().toISOString() }) });
  } catch {}
  return new Response(JSON.stringify(sum), { status: 200, headers: { "content-type": "application/json" } });
};

/* Exposed for tools/departures.test.mjs. The departure tracker is the one part of this file whose
   failure mode is silent and public — a false mass-departure would page the commissioners with a
   fake exodus — so it is tested directly rather than only through the whole sync. */
export const _internals = { fetchClubLogoPng, readRoleIcon, enforcePostingPolicy, enforceVerificationLevel, POST_BITS,
  CREATE_INSTANT_INVITE, POST_DENY, POST_ALLOW_STATIC, MIN_VERIFICATION_LEVEL,
  trackDepartures, announceDepartures, ensureDeparturesChannel, DEPART_SANITY,
  enforceMentionPolicy, MENTION_EVERYONE, MENTION_ALLOWED };
