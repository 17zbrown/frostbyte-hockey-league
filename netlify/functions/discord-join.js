// Netlify Function: POST /api/discord-join  (redirected from netlify.toml)
// Makes "Sign in with Discord" double as a server invite: after a user logs in,
// the front-end sends their Discord OAuth access_token here and the bot adds them
// to the league's Discord guild. Idempotent — already-members are a no-op.
//
// The access_token must carry the `guilds.join` scope (requested at sign-in). We
// verify it by calling Discord /users/@me, then add THAT user (never a client-
// supplied id) via PUT /guilds/{guild}/members/{user} with the bot token.
//   Env: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// GET (or ?diag=1) returns a read-only self-check: whether the bot is in the guild
// and, crucially, whether it holds CREATE_INSTANT_INVITE — the permission Discord
// REQUIRES to add a member — plus whether Membership Screening would hold new
// members as "pending". No secrets are returned. Every real join also records its
// outcome to app_config.rl_discord-join_result so failures are diagnosable.
// Node 18+ runtime (global fetch, BigInt, no dependencies).

const BOT = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UA = "DiscordBot (https://chelgamingleague.com,1.0)";
const json = (o, s = 200) => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(o) });
const dh = { Authorization: `Bot ${BOT}`, "User-Agent": UA };

// Flip profiles.in_guild for the member with this Discord id (so registration can require it),
// and record their Discord @handle so the commissioner directory can show it.
async function setInGuild(discordId, value, username) {
  if (!SB_URL || !SB_KEY || !discordId) return;
  const body = { in_guild: value };
  if (username) body.discord_username = username;
  try {
    await fetch(`${SB_URL}/rest/v1/profiles?discord_id=eq.${discordId}`, {
      method: "PATCH",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
  } catch (e) { /* best effort — the 5-min sync will also set it */ }
}

// Record the last outcome so we can see WHY joins succeed or fail (same rl_*_result
// pattern the other automations use; surfaced in the Control Center Automations panel).
async function logResult(obj) {
  if (!SB_URL || !SB_KEY) return;
  try {
    await fetch(`${SB_URL}/rest/v1/app_config?on_conflict=key`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key: "rl_discord-join_result", value: JSON.stringify(Object.assign({ at: new Date().toISOString() }, obj)) }),
    });
  } catch (e) { /* best effort */ }
}

// Read-only self-check: is the bot in the guild, and does it hold CREATE_INSTANT_INVITE?
async function botDiag() {
  if (!BOT || !GUILD) return { configured: false, reason: "DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set" };
  const out = { configured: true, guildId: GUILD };
  try {
    const g = await fetch(`https://discord.com/api/v10/guilds/${GUILD}`, { headers: dh });
    if (!g.ok) { out.guildOk = false; out.guildStatus = g.status; out.detail = (await g.text()).slice(0, 200); return out; }
    const guild = await g.json();
    out.guildOk = true; out.guildName = guild.name;
    out.membershipScreening = (guild.features || []).includes("MEMBER_VERIFICATION_GATE_ENABLED");
    out.community = (guild.features || []).includes("COMMUNITY");

    // resolve the bot's own user id first (@me is NOT valid on the guild-members endpoint),
    // then read its real guild member object — the definitive "is the bot in the guild" check
    const selfRes = await fetch("https://discord.com/api/v10/users/@me", { headers: dh });
    const self = selfRes.ok ? await selfRes.json() : null;
    out.botUserId = self && self.id;
    out.botUsername = self && self.username;
    const meRes = self ? await fetch(`https://discord.com/api/v10/guilds/${GUILD}/members/${self.id}`, { headers: dh }) : { ok: false, status: 0 };
    out.botInGuild = meRes.ok;
    out.botMemberStatus = meRes.status;
    const me = meRes.ok ? await meRes.json() : null;
    const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD}/roles`, { headers: dh });
    const roles = rolesRes.ok ? await rolesRes.json() : [];
    const rolePerms = {}; roles.forEach((r) => { try { rolePerms[r.id] = BigInt(r.permissions); } catch (e) {} });

    // computed permissions = @everyone (role id === guild id) OR'd with each of the bot's roles
    let perms = rolePerms[guild.id] || 0n;
    ((me && me.roles) || []).forEach((rid) => { if (rolePerms[rid] != null) perms |= rolePerms[rid]; });
    const ADMIN = 1n << 3n, CREATE_INSTANT_INVITE = 1n << 0n;
    out.isAdmin = (perms & ADMIN) === ADMIN;
    out.hasCreateInstantInvite = out.isAdmin || (perms & CREATE_INSTANT_INVITE) === CREATE_INSTANT_INVITE;
    out.canAddMembers = out.hasCreateInstantInvite; // Discord requires exactly this to PUT a member
  } catch (e) { out.error = String(e).slice(0, 200); }
  return out;
}

export const handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (event.httpMethod === "GET" || q.diag === "1") {
    const d = await botDiag();
    await logResult({ kind: "diag", ok: !!d.canAddMembers, diag: d });
    return json({ diagnostic: d });
  }
  if (event.httpMethod !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!BOT || !GUILD) { await logResult({ ok: false, lastError: "Discord bot not configured (DISCORD_BOT_TOKEN / DISCORD_GUILD_ID missing)" }); return json({ skipped: "Discord bot not configured" }, 200); }

  let token;
  try { token = (JSON.parse(event.body || "{}") || {}).access_token; }
  catch { return json({ error: "Bad JSON" }, 400); }
  if (!token) return json({ error: "Missing access_token" }, 400);

  // Verify the OAuth token and resolve the real user id (don't trust the client).
  const me = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
  });
  // a bad/expired client token is not an automation failure (the function correctly rejected
  // it) — record it for diagnostics but keep ok:true so the watchdog stays quiet
  if (!me.ok) { await logResult({ ok: true, benign: "bad-or-expired-token", stage: "verify", status: me.status }); return json({ error: "Invalid Discord token" }, 401); }
  const user = await me.json();

  // Add to the guild (201 = added, 204 = already a member).
  const put = await fetch(`https://discord.com/api/v10/guilds/${GUILD}/members/${user.id}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token }),
  });
  if (put.status === 201) { await setInGuild(user.id, true, user.username); await logResult({ ok: true, result: "joined", user: user.id }); return json({ joined: true, inGuild: true, user: user.id }); }
  if (put.status === 204) { await setInGuild(user.id, true, user.username); await logResult({ ok: true, result: "already-member", user: user.id }); return json({ alreadyMember: true, inGuild: true, user: user.id }); }
  const detail = (await put.text()).slice(0, 300);

  // 403 / code 50025 = THIS user's token lacks guilds.join (they authorized before the
  // scope existed). That's expected and benign — they use the server invite instead — so it
  // must NOT page the commissioners. Only escalate (ok:false → watchdog) if the BOT itself
  // can no longer add members. Everything else unexpected is a genuine alert.
  if (put.status === 403 && /"code":\s*50025/.test(detail)) {
    const d = await botDiag();
    if (d.canAddMembers) {
      await logResult({ ok: true, benign: "user-token-missing-guilds.join", user: user.id });
    } else {
      await logResult({ ok: false, lastError: "Bot can no longer add members: " + JSON.stringify({ botInGuild: d.botInGuild, hasCreateInstantInvite: d.hasCreateInstantInvite, guildOk: d.guildOk }), user: user.id });
    }
    return json({ error: "Join failed", inGuild: false, status: 403, detail, hint: "User authorized before guilds.join existed — use the server invite" }, 200);
  }
  await logResult({ ok: false, lastError: "PUT " + put.status + " — " + detail, user: user.id });
  return json({ error: "Join failed", inGuild: false, status: put.status, detail }, 200);
};
