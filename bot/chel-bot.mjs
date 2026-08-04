// Chel Gaming gateway bot — the always-on process that runs on the Oracle Cloud VM.
//
// This is the SAME bot identity the Netlify functions use (same DISCORD_BOT_TOKEN, same
// application) — it just holds a live gateway connection so joins and departures are heard
// the second they happen, instead of on the next 2–5 minute sweep. The sweeps stay on as
// the reconciliation backstop; if this process dies, they quietly take over.
//
// All real logic lives in handlers.mjs (testable without discord.js). This file only maps
// discord.js events onto it, heartbeats every minute, and dies loudly so systemd restarts it.
//
// Env (same four the Netlify functions use):
//   DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { Client, GatewayIntentBits, Partials, Events } from "discord.js";
import { createHandlers } from "./handlers.mjs";

const env = {
  SB_URL: process.env.SUPABASE_URL,
  SB_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  BOT: process.env.DISCORD_BOT_TOKEN,
  GUILD: process.env.DISCORD_GUILD_ID,
};
const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`gateway-bot: missing env (${missing.join(", ")}) — check /etc/chel-bot.env`);
  process.exit(1);
}

const H = createHandlers(env);

// Guilds for channel metadata; GuildMembers (privileged — already enabled in the Developer
// Portal for the welcome sweep) for join/leave events. Partials so a leave still fires for
// members who joined before this process started.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember, Partials.User],
});

// discord.js members -> the plain shape handlers.mjs expects.
const shape = (m) => ({
  id: m.id,
  bot: !!(m.user && m.user.bot),
  pending: !!m.pending,
  username: (m.user && m.user.username) || null,
  globalName: (m.user && m.user.globalName) || null,
  nick: m.nickname || null,
  joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
});
const ours = (m) => m && m.guild && m.guild.id === env.GUILD;

client.on(Events.GuildMemberAdd, (m) => {
  if (!ours(m)) return;
  H.onMemberAdd(shape(m)).then((r) => console.log(`join ${m.id}: ${r}`));
});
client.on(Events.GuildMemberUpdate, (before, after) => {
  if (!ours(after)) return;
  H.onMemberUpdate(shape(before), shape(after)).then((r) => { if (r !== "ignored") console.log(`screening-pass ${after.id}: ${r}`); });
});
client.on(Events.GuildMemberRemove, (m) => {
  if (!ours(m)) return;
  H.onMemberRemove(shape(m)).then((r) => console.log(`leave ${m.id}: ${r}`));
});

client.once(Events.ClientReady, (c) => {
  console.log(`gateway-bot: connected as ${c.user.tag} — watching guild ${env.GUILD}`);
  H.beat().catch((e) => console.error("first heartbeat failed:", e.message));
});
client.on(Events.Error, (e) => console.error("gateway error:", e.message));
client.on(Events.ShardDisconnect, () => console.warn("gateway disconnected — discord.js will reconnect"));

// The heartbeat is the watchdog's view of this process: rl_gateway-bot every minute, and the
// per-run result alongside it. Stop beating and the automation_watchdog pages within ~25 min.
setInterval(() => H.beat().catch((e) => console.error("heartbeat failed:", e.message)), 60_000);

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    console.log(`gateway-bot: ${sig} — shutting down`);
    try { await client.destroy(); } catch {}
    process.exit(0);
  });
}

client.login(env.BOT).catch((e) => {
  // An invalid token can't self-heal; exit non-zero so systemd's restart budget applies.
  console.error("gateway-bot: login failed —", e.message);
  process.exit(1);
});
