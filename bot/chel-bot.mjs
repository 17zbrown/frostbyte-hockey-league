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
import { createIncidentNotifier } from "./incidents.mjs";
import { createClient } from "@supabase/supabase-js";

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

/* The heartbeat must answer "is this bot hearing Discord", not "is this process running".
   Without this the timer below keeps stamping a healthy row while the gateway is dead, and
   both the Automations panel and automation_watchdog stay green over a deaf bot. */
let ready = false;
const H = createHandlers(env, {
  gatewayState: () => {
    // discord.js Status.Ready === 0; ws.status is the live shard state, not a cached flag.
    const st = client && client.ws ? client.ws.status : null;
    return { connected: ready && st === 0, detail: ready ? `ws status ${st}` : "never reached ready" };
  },
});

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
  ready = true;
  console.log(`gateway-bot: connected as ${c.user.tag} — watching guild ${env.GUILD}`);
  H.beat().catch((e) => console.error("first heartbeat failed:", e.message));
});
client.on(Events.Error, (e) => console.error("gateway error:", e.message));
/* Events.ShardError carries the real reason for a fatal close ("Used disallowed intents",
   "Authentication failed"). discord.js does not surface it anywhere else, so without this
   listener the one useful line is discarded. */
client.on(Events.ShardError, (e) => console.error("shard error:", (e && e.message) || e));
client.on(Events.ShardReconnecting, () => console.warn("gateway reconnecting…"));
/* discord.js emits ShardDisconnect ONLY for close codes it will NOT recover from — bad token,
   disallowed/invalid intents, invalid shard. It does not reconnect, does not throw, and does not
   exit: the process would sit here forever, event loop held open by the heartbeat interval,
   looking healthy to systemd and to the watchdog while hearing nothing. Exit instead, so
   Restart=always cycles it and — if the cause is permanent — the start limit trips, the
   heartbeat goes stale, and the watchdog pages. The Netlify sweeps carry the load throughout. */
client.on(Events.ShardDisconnect, (event) => {
  const code = event && event.code;
  console.error(`gateway closed unrecoverably (code ${code}) — exiting so this cannot sit here deaf`);
  H.beat({ fatal: `gateway closed with code ${code}` })
    .catch(() => {})
    .finally(() => process.exit(1));
});

/* ---- instant game-incident rulings (Rules 3.2 / 4.3) ----
   Late starts and disconnections get argued out in club chats in seconds, so the ruling has to
   land in seconds too — a sweep that runs every couple of minutes always arrives after the
   argument. Supabase Realtime pushes the row the moment staff log it, and both clubs are told
   at the same instant, which is the point: no "my guy said one penalty". */
const INC = createIncidentNotifier(env);
let incidentsLive = false;
if (env.SB_URL && env.SB_KEY) {
  const sb = createClient(env.SB_URL, env.SB_KEY, { auth: { persistSession: false } });
  sb.channel("game-incidents")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_incidents" }, (payload) => {
      INC.announce(payload.new).then((r) => console.log(`incident ${payload.new && payload.new.id}: ${r}`));
    })
    .subscribe((status) => {
      incidentsLive = status === "SUBSCRIBED";
      console.log(`game-incident rulings: ${status}`);
    });
}

// The heartbeat is the watchdog's view of this process: rl_gateway-bot every minute, and the
// per-run result alongside it. Stop beating and the automation_watchdog pages within ~25 min.
setInterval(() => H.beat({ extra: { incidentsLive, incidentsAnnounced: INC.sum.announced } })
  .catch((e) => console.error("heartbeat failed:", e.message)), 60_000);

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
