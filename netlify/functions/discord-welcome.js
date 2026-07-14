// Netlify Scheduled Function — welcomes new Discord members in #welcome every 5 min.
//
// There is no always-on gateway bot here (everything is serverless), so instead of
// listening for a live guildMemberAdd event we sweep the guild's member list on a
// schedule and greet anyone we haven't greeted before. Because organic invite-link
// joins never touch the site, this catches EVERY join method, not just site sign-ins.
//
// Exactly-once is enforced by the welcomed_members table (discord_id primary key):
// we post first, then record the id, so a failed post is retried next run rather than
// silently swallowed. The first run seeds the table with everyone already in the guild
// (no messages) so we don't spam a welcome for long-time members.
//
// Requires the GUILD_MEMBERS privileged intent (Developer Portal → Bot) so the member
// list is readable — already enabled for this bot.
//
// Env: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// No-ops safely if any are missing. Node 18+ (global fetch, no dependencies).

export const config = { schedule: "*/5 * * * *" };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const UA = "DiscordBot (https://chelgamingleague.com,1.0)";

// If a single sweep ever finds more than this many "new" members, treat it as an
// anomaly (misconfig / mass raid) — record them silently instead of mass-pinging.
const BURST_CAP = 15;

const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });

// Debounce public invocations so a flood of anonymous POSTs can't drive endless work.
// Scheduled runs are 5 min apart so this never blocks them. Fail-open on guard error.
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
async function cfgGet(key) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/app_config?key=eq.${key}&select=value`, { headers: sbHead() });
    const rows = await r.json();
    return rows && rows[0] ? rows[0].value : null;
  } catch (e) { return null; }
}
async function cfgSet(key, value) {
  await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
}
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
// Insert a discord_id; ON CONFLICT DO NOTHING via Prefer merge-duplicates + resolution.
async function markWelcomed(ids) {
  if (!ids.length) return;
  await fetch(`${SB_URL}/rest/v1/welcomed_members`, {
    method: "POST",
    headers: { ...sbHead(), Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(ids.map((id) => ({ discord_id: id }))),
  });
}
async function dApi(method, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://discord.com/api/v10${path}`, {
      method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 404) return { __notfound: true };
    if (r.status === 429) { const ra = +(r.headers.get("retry-after") || 1); await new Promise((res) => setTimeout(res, ra * 1000 + 250)); continue; }
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  throw new Error(`${method} ${path} -> rate-limited after retries`);
}

// Page through the full guild member list (1000 at a time, ordered by user id).
async function allMembers() {
  let after = "0"; const out = [];
  for (let page = 0; page < 50; page++) {
    const chunk = await dApi("GET", `/guilds/${GUILD}/members?limit=1000&after=${after}`);
    if (!Array.isArray(chunk) || !chunk.length) break;
    out.push(...chunk);
    after = chunk[chunk.length - 1].user.id;
    if (chunk.length < 1000) break;
  }
  return out;
}

const chanRef = (id, fallback) => (id ? `<#${id}>` : fallback);
function welcomeText(userId, ch) {
  return `🏒 Welcome to **Chel Gaming**, <@${userId}>! Glad to have you on the ice.\n\n` +
    `• New here? Skim ${chanRef(ch.rules, "**#rules**")} to get the lay of the land.\n` +
    `• Ready to play? Claim your spot in ${chanRef(ch.signups, "**#season-signups**")}.\n` +
    `• Say hey in ${chanRef(ch.general, "**#general-chat**")} — tell us your team and platform.\n\n` +
    `The full league hub lives at https://chelgamingleague.com — lace 'em up. 🥅`;
}

export default async () => {
  if (!SB_URL || !SB_KEY || !BOT || !GUILD) {
    console.log("discord-welcome: missing env (need bot token + guild id + Supabase) — skipping");
    return new Response("skipped: missing env", { status: 200 });
  }
  if (await ranRecently("discord-welcome", 6)) return new Response("skipped: ran moments ago", { status: 200 });

  const sum = { members: 0, new: 0, welcomed: 0, seeded: 0, errors: [] };
  try {
    // Resolve #welcome (+ a few channels to link) by name; allow an app_config override.
    const channels = await dApi("GET", `/guilds/${GUILD}/channels`);
    const textByName = {};
    for (const c of channels) if (c.type === 0) textByName[c.name] = c.id;
    const override = await cfgGet("discord_welcome_channel_id");
    const welcomeChan = override || textByName["welcome"];
    if (!welcomeChan) { console.log("discord-welcome: no #welcome channel found — skipping"); return new Response("skipped: no #welcome", { status: 200 }); }
    const ch = { rules: textByName["rules"], signups: textByName["season-signups"], general: textByName["general-chat"] };

    // Real, non-bot members currently in the guild.
    const members = (await allMembers()).filter((m) => m.user && !m.user.bot);
    sum.members = members.length;
    const memberIds = members.map((m) => m.user.id);

    const already = new Set((await sbGet("welcomed_members?select=discord_id")).map((r) => r.discord_id));
    const fresh = members.filter((m) => !already.has(m.user.id));
    sum.new = fresh.length;

    // First-ever run: seed everyone silently so we don't welcome long-time members.
    const seeded = await cfgGet("welcome_seeded");
    if (!seeded) {
      await markWelcomed(memberIds);
      await cfgSet("welcome_seeded", new Date().toISOString());
      sum.seeded = memberIds.length;
      console.log("discord-welcome (first run, seeded):", JSON.stringify(sum));
      return new Response(JSON.stringify(sum), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Anomaly guard: an unexpectedly large batch is recorded silently, not mass-pinged.
    if (fresh.length > BURST_CAP) {
      await markWelcomed(fresh.map((m) => m.user.id));
      sum.seeded = fresh.length;
      sum.note = `burst >${BURST_CAP}: recorded without pinging`;
      console.log("discord-welcome (burst guard):", JSON.stringify(sum));
      return new Response(JSON.stringify(sum), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Post a welcome for each new member, then record them (post-first = safe retry).
    for (const m of fresh) {
      try {
        await dApi("POST", `/channels/${welcomeChan}/messages`, {
          content: welcomeText(m.user.id, ch),
          allowed_mentions: { users: [m.user.id] },
        });
        await markWelcomed([m.user.id]);
        sum.welcomed++;
      } catch (e) {
        sum.errors.push({ discord_id: m.user.id, error: String(e.message || e) });
      }
    }
  } catch (e) {
    sum.errors.push({ fatal: String(e.message || e) });
  }
  console.log("discord-welcome:", JSON.stringify(sum));
  return new Response(JSON.stringify(sum), { status: 200, headers: { "content-type": "application/json" } });
};
