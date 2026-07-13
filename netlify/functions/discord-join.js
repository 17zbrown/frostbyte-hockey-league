// Netlify Function: POST /api/discord-join  (redirected from netlify.toml)
// Makes "Sign in with Discord" double as a server invite: after a user logs in,
// the front-end sends their Discord OAuth access_token here and the bot adds them
// to the league's Discord guild. Idempotent — already-members are a no-op.
//
// The access_token must carry the `guilds.join` scope (requested at sign-in). We
// verify it by calling Discord /users/@me, then add THAT user (never a client-
// supplied id) via PUT /guilds/{guild}/members/{user} with the bot token.
//   Env: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID
// Node 18+ runtime (global fetch, no dependencies).

const BOT = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UA = "DiscordBot (https://chelgamingleague.com,1.0)";
const json = (o, s = 200) => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

// Flip profiles.in_guild for the member with this Discord id (so registration can require it).
async function setInGuild(discordId, value) {
  if (!SB_URL || !SB_KEY || !discordId) return;
  try {
    await fetch(`${SB_URL}/rest/v1/profiles?discord_id=eq.${discordId}`, {
      method: "PATCH",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ in_guild: value }),
    });
  } catch (e) { /* best effort — the 5-min sync will also set it */ }
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!BOT || !GUILD) return json({ skipped: "Discord bot not configured" }, 200);

  let token;
  try { token = (JSON.parse(event.body || "{}") || {}).access_token; }
  catch { return json({ error: "Bad JSON" }, 400); }
  if (!token) return json({ error: "Missing access_token" }, 400);

  // Verify the OAuth token and resolve the real user id (don't trust the client).
  const me = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
  });
  if (!me.ok) return json({ error: "Invalid Discord token" }, 401);
  const user = await me.json();

  // Add to the guild (201 = added, 204 = already a member).
  const put = await fetch(`https://discord.com/api/v10/guilds/${GUILD}/members/${user.id}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token }),
  });
  if (put.status === 201) { await setInGuild(user.id, true); return json({ joined: true, inGuild: true, user: user.id }); }
  if (put.status === 204) { await setInGuild(user.id, true); return json({ alreadyMember: true, inGuild: true, user: user.id }); }
  const detail = (await put.text()).slice(0, 200);
  return json({ error: "Join failed", inGuild: false, status: put.status, detail }, 200);
};
