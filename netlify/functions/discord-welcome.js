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
  /* 6 attempts, not 4: with the exponential ladder below this rides out ~15s of Discord
     unavailability instead of ~3.6s, which is the difference between absorbing a wobble and
     paging a human about one. */
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`https://discord.com/api/v10${path}`, {
      method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 404) return { __notfound: true };
    if (r.status === 429) { const ra = +(r.headers.get("retry-after") || 1); await new Promise((res) => setTimeout(res, ra * 1000 + 250)); continue; }
    // Discord's own 5xx is routine and transient — GET /members in particular throws one every
    // so often — and only 429 was being retried, so a single blip aborted the whole sweep and
    // reported itself as a fatal automation failure. Back off and try again instead.
    // EXPONENTIAL with jitter, not linear: the old 600/1200/1800ms ladder spent its whole budget
    // in ~3.6s, which is shorter than a routine Discord wobble — it gave up and paged the
    // commissioner for something that cleared on its own moments later (2026-08-07 22:30).
    // Jitter matters because three functions share this token: identical ladders retry in
    // lockstep and re-collide on exactly the tick the API is unhappy.
    if (r.status >= 500) {
      const back = Math.min(8000, 500 * Math.pow(2, attempt)) + Math.floor(Math.random() * 400);
      await new Promise((res) => setTimeout(res, back));
      continue;
    }
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  throw new Error(`${method} ${path} -> gave up after retries (rate limit or Discord 5xx)`);
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
    `• Ready to play? Register at https://chelgamingleague.com/#/register — sign-ups happen on the site.\n` +
    `• Say hey in ${chanRef(ch.general, "**#general-chat**")} — tell us your team and platform.\n\n` +
    `The full league hub lives at https://chelgamingleague.com — lace 'em up. 🥅`;
}

export default async () => {
  if (!SB_URL || !SB_KEY || !BOT || !GUILD) {
    console.log("discord-welcome: missing env (need bot token + guild id + Supabase) — skipping");
    return new Response("skipped: missing env", { status: 200 });
  }
  if (await ranRecently("discord-welcome", 6)) return new Response("skipped: ran moments ago", { status: 200 });

  /* `errors` means the run FAILED at its job and the watchdog should page. `warnings` means it
     degraded around something and still did the job — recorded honestly, but not an alert. Before
     this split, recovering from a blip and being killed by one looked identical to the watchdog. */
  const sum = { members: 0, new: 0, welcomed: 0, seeded: 0, errors: [], warnings: [] };
  try {
    /* Resolve #welcome (+ a few channels to link) by name; allow an app_config override.

       This lookup used to be able to kill the whole sweep. It is a NAME->ID resolution of
       channels that essentially never change, yet a transient Discord 5xx on it aborted the run
       and paged the commissioner (2026-08-07 22:30) — while the job it was about to do, greeting
       new members, was in no way blocked. So: every success caches the ids, and a failure falls
       back to that cache. Only a failure with no cache and no override can skip the run now. */
    let textByName = null, chanResolved = false;
    try {
      const channels = await dApi("GET", `/guilds/${GUILD}/channels`);
      textByName = {};
      for (const c of channels) if (c.type === 0) textByName[c.name] = c.id;
      chanResolved = true;
      await cfgSet("discord_welcome_chan_cache", JSON.stringify({
        welcome: textByName["welcome"] || null, rules: textByName["rules"] || null,
        general: textByName["general-chat"] || null }));
    } catch (e) {
      sum.warnings.push({ channels: String(e.message || e), recovered: "using cached channel ids" });
      try {
        const cached = JSON.parse((await cfgGet("discord_welcome_chan_cache")) || "{}");
        textByName = { welcome: cached.welcome, rules: cached.rules, "general-chat": cached.general };
        chanResolved = !!cached.welcome;
      } catch (e2) { textByName = {}; }
    }
    const override = await cfgGet("discord_welcome_channel_id");
    const welcomeChan = override || textByName["welcome"];
    if (!welcomeChan) {
      /* Two very different situations that used to look identical — and BOTH returned without
         writing a run result at all, so a persistently broken sweep reported nothing and was
         only ever caught by staleness:
           - we read the guild fine and there simply is no #welcome  -> benign, nothing to do
           - we could not read the guild at all and have no cache    -> we are blind: a failure */
      if (chanResolved) sum.warnings.push({ welcome: "no #welcome channel in the guild — nothing to post into" });
      else sum.errors.push({ fatal: "could not resolve the guild's channels and no cached ids — cannot greet anyone" });
      throw new Error("__no_welcome_channel");
    }
    const ch = { rules: textByName["rules"], general: textByName["general-chat"] };

    // Real, non-bot members currently in the guild.
    const members = (await allMembers()).filter((m) => m.user && !m.user.bot);
    sum.members = members.length;
    const memberIds = members.map((m) => m.user.id);

    const already = new Set((await sbGet("welcomed_members?select=discord_id")).map((r) => r.discord_id));
    // With Community membership screening on, a member sits as `pending` until they accept the rules.
    // Skip them so we greet them only once they're actually through the gate (a later sweep catches
    // them when `pending` clears); they're not marked welcomed, so nothing is lost.
    const fresh = members.filter((m) => !already.has(m.user.id) && !m.pending);
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
    // the no-channel path already recorded the right thing (warning vs error) before rethrowing
    if (String(e.message || e) !== "__no_welcome_channel") sum.errors.push({ fatal: String(e.message || e) });
  }
  console.log("discord-welcome:", JSON.stringify(sum));
  try {
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "rl_discord-welcome_result", value: JSON.stringify({
        at: new Date().toISOString(), ok: (sum.errors || []).length === 0,
        errCount: (sum.errors || []).length, lastError: sum.errors && sum.errors[0] ? JSON.stringify(sum.errors[0]).slice(0, 200) : null,
        warnCount: (sum.warnings || []).length,
        lastWarning: sum.warnings && sum.warnings[0] ? JSON.stringify(sum.warnings[0]).slice(0, 200) : null
      }), updated_at: new Date().toISOString() }) });
  } catch {}
  return new Response(JSON.stringify(sum), { status: 200, headers: { "content-type": "application/json" } });
};
