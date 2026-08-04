// The gateway bot's handlers — the instant lane for welcomes and departures. What must never
// break: the exactly-once interlock with the sweeps (post-first-then-record for welcomes,
// record-then-announce for departures, present=false as the shared "handled" marker), the
// screening gate, and the burst guards. Run: node tools/gateway-bot.test.mjs
import { createHandlers } from "../bot/handlers.mjs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* ---- stubbed world ---- */
const env = { SB_URL: "https://sb.invalid", SB_KEY: "k", BOT: "tok", GUILD: "G1" };
const world = {
  seeded: "2026-08-01T00:00:00Z",
  welcomeOverride: null,
  channels: [
    { id: "CW", type: 0, name: "welcome" }, { id: "CR", type: 0, name: "rules" },
    { id: "CG", type: 0, name: "general-chat" }, { id: "CD", type: 0, name: "member-departures" },
  ],
  welcomed: new Set(["oldtimer"]),
  guildMembers: {},          // discord_id -> row
  links: {},                 // discord_id -> {profile_id, gamertag, team_id}
  teams: { T1: "BOS" },
  registered: new Set(),
  failDiscordPosts: false,
  /* channels the cache still knows about but that Discord has since deleted — the real race
     between resolving a channel and posting into it */
  deadPostChannels: new Set(),
};
const events = [];           // ordered log of writes, for interlock-order assertions
const cfg = {};              // app_config upserts (heartbeat etc.)

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  /* Discord */
  if (u.includes("discord.com")) {
    if (u.includes(`/guilds/G1/channels`)) return J(world.channels);
    if (/\/channels\/\w+\/messages$/.test(u) && m === "POST") {
      if (world.failDiscordPosts) return J({ message: "boom" }, 500);
      /* Discord 404s a post to a channel that no longer exists — the stub has to model that or
         the delivered-vs-attempted assertions below would pass against a fiction. */
      const chId = u.match(/channels\/(\w+)\//)[1];
      if (world.deadPostChannels.has(chId) || !world.channels.some((c) => c.id === chId))
        return J({ message: "Unknown Channel" }, 404);
      events.push({ post: chId, body: JSON.parse(opts.body) });
      return J({ id: "msg1" });
    }
    return J({});
  }
  /* Supabase */
  if (u.includes("app_config") && m === "GET") {
    if (u.includes("welcome_seeded")) return J(world.seeded ? [{ value: world.seeded }] : []);
    if (u.includes("discord_welcome_channel_id")) return J(world.welcomeOverride ? [{ value: world.welcomeOverride }] : []);
    return J([]);
  }
  if (u.includes("app_config") && m === "POST") { const b = JSON.parse(opts.body); cfg[b.key] = b.value; return J(null); }
  if (u.includes("welcomed_members") && m === "GET") {
    const id = decodeURIComponent(u.match(/discord_id=eq\.([^&]+)/)[1]);
    return J(world.welcomed.has(id) ? [{ discord_id: id }] : []);
  }
  if (u.includes("welcomed_members") && m === "POST") {
    for (const r of JSON.parse(opts.body)) { world.welcomed.add(r.discord_id); events.push({ welcomedMark: r.discord_id }); }
    return J(null);
  }
  if (u.includes("guild_members") && m === "GET") {
    const id = decodeURIComponent(u.match(/discord_id=eq\.([^&]+)/)[1]);
    return J(world.guildMembers[id] ? [world.guildMembers[id]] : []);
  }
  if (u.includes("guild_members") && m === "POST") {
    for (const r of JSON.parse(opts.body)) { world.guildMembers[r.discord_id] = { ...world.guildMembers[r.discord_id], ...r }; events.push({ memberUpsert: r.discord_id, present: r.present }); }
    return J(null);
  }
  if (u.includes("discord_links")) {
    const id = decodeURIComponent(u.match(/discord_id=eq\.([^&]+)/)[1]);
    return J(world.links[id] ? [world.links[id]] : []);
  }
  if (u.includes("/teams?id=eq.")) { const id = u.match(/id=eq\.([^&]+)/)[1]; return J(world.teams[id] ? [{ code: world.teams[id] }] : []); }
  if (u.includes("season_registrations")) { const p = u.match(/profile_id=eq\.([^&]+)/)[1]; return J(world.registered.has(p) ? [{ profile_id: p }] : []); }
  if (u.includes("guild_departures") && m === "POST") { events.push({ departure: JSON.parse(opts.body)[0] }); return J(null); }
  return J([]);
};

const mk = (over) => createHandlers(env, { chanTtlMs: 0, ...over });
const member = (id, over) => ({ id, bot: false, pending: false, username: "u_" + id, globalName: "g_" + id, nick: null, joinedAt: "2026-07-01T00:00:00Z", ...over });

console.log("— welcomes");
{
  const H = mk();
  events.length = 0;
  A("a fresh member is welcomed", (await H.onMemberAdd(member("new1"))) === "welcomed");
  const post = events.find((e) => e.post), mark = events.find((e) => e.welcomedMark);
  A("the greeting lands in #welcome and pings only them", post && post.post === "CW" && post.body.allowed_mentions.users[0] === "new1");
  A("the greeting links rules and general-chat", post.body.content.includes("<#CR>") && post.body.content.includes("<#CG>"));
  A("post first, record after", events.indexOf(post) < events.indexOf(mark) && mark.welcomedMark === "new1");
  A("an already-welcomed member is left alone", (await H.onMemberAdd(member("oldtimer"))) === "already");
  A("bots are ignored", (await H.onMemberAdd(member("b1", { bot: true }))) === "skip");
  A("a member still in screening waits", (await H.onMemberAdd(member("p1", { pending: true }))) === "pending");
  A("...and is welcomed when screening clears",
    (await H.onMemberUpdate(member("p1", { pending: true }), member("p1"))) === "welcomed");
  A("an unrelated member update is ignored", (await H.onMemberUpdate(member("x"), member("x"))) === "ignored");
}
{
  world.seeded = null;
  const H = mk();
  A("before the sweep has seeded, the bot stays silent", (await H.onMemberAdd(member("early"))) === "unseeded" && !world.welcomed.has("early"));
  world.seeded = "2026-08-01T00:00:00Z";
}
{
  world.failDiscordPosts = true;
  const H = mk();
  const r = await H.onMemberAdd(member("unlucky"));
  A("a failed greeting is NOT recorded, so the sweep retries it", r === "error" && !world.welcomed.has("unlucky"));
  A("...and the error surfaces in the result", H.errors.length === 1);
  world.failDiscordPosts = false;
}
{
  const H = mk({ burstCap: 2 });
  await H.onMemberAdd(member("r1")); await H.onMemberAdd(member("r2"));
  events.length = 0;
  const r = await H.onMemberAdd(member("r3"));
  A("a join burst is recorded without pinging", r === "burst" && world.welcomed.has("r3") && !events.some((e) => e.post));
}

console.log("\n— departures");
{
  world.guildMembers["vet"] = { discord_id: "vet", username: "VetUser", display_name: "Vet", profile_id: "P1",
    joined_guild_at: "2026-06-01T00:00:00Z", is_bot: false, present: true };
  world.links["vet"] = { profile_id: "P1", gamertag: "VetTag", team_id: "T1" };
  world.registered.add("P1");
  const H = mk();
  events.length = 0;
  A("a known member's departure is announced", (await H.onMemberRemove(member("vet"))) === "announced");
  const dep = events.find((e) => e.departure), up = events.find((e) => e.memberUpsert), post = events.find((e) => e.post);
  A("the departure row carries the league context", dep && dep.departure.club === "BOS" && dep.departure.was_registered === true && dep.departure.profile_id === "P1");
  A("record before announce", events.indexOf(dep) < events.indexOf(post));
  A("present flips false — the census diff now skips them", up && up.present === false);
  A("the embed goes to #member-departures with no pings", post.post === "CD" && post.body.allowed_mentions.parse.length === 0);
  const emb = post.body.embeds[0];
  A("the embed names the club and the sign-up", JSON.stringify(emb.fields).includes("BOS") && JSON.stringify(emb.fields).includes("registered to play"));
  events.length = 0;
  A("a second remove event is a no-op", (await H.onMemberRemove(member("vet"))) === "already-recorded" && events.length === 0);
}
{
  const H = mk();
  events.length = 0;
  const r = await H.onMemberRemove(member("ghost"));   // never censused, no link
  A("a never-censused leaver is still recorded", r === "announced" && events.some((e) => e.departure && e.departure.discord_id === "ghost"));
  const post = events.find((e) => e.post);
  A("...flagged as having no site account", post.body.embeds[0].description.includes("never signed in"));
}
{
  world.channels = world.channels.filter((c) => c.name !== "member-departures");
  const H = mk();
  events.length = 0;
  const r = await H.onMemberRemove(member("quiet"));
  A("no departures channel: recorded, not announced", r === "recorded-unannounced" && events.some((e) => e.departure) && !events.some((e) => e.post));
  world.channels.push({ id: "CD", type: 0, name: "member-departures" });
}
{
  const H = mk({ burstCap: 1 });
  await H.onMemberRemove(member("m1"));
  events.length = 0;
  const r = await H.onMemberRemove(member("m2"));
  A("a mass departure is recorded but not announced", r === "recorded-burst" && events.some((e) => e.departure) && !events.some((e) => e.post));
  A("...and flagged as an error for the watchdog", H.errors.some((e) => e.error.includes("depart-sanity")));
}

console.log("\n— heartbeat");
{
  const H = mk();
  await H.onMemberAdd(member("hb1"));
  await H.beat();
  A("the heartbeat stamps rl_gateway-bot", !!cfg["rl_gateway-bot"]);
  const res = JSON.parse(cfg["rl_gateway-bot_result"]);
  A("a clean run reports ok with its counters", res.ok === true && res.welcomed === 1 && res.errCount === 0);
  world.failDiscordPosts = true;
  await H.onMemberAdd(member("hb2"));
  world.failDiscordPosts = false;
  await H.beat();
  const res2 = JSON.parse(cfg["rl_gateway-bot_result"]);
  A("a recent error flips ok false with the detail", res2.ok === false && /welcome hb2/.test(res2.lastError));
}

console.log("\n— a post that didn't deliver is never recorded as delivered");
{
  /* Discord answers a deleted channel with 404, which dApi turns into {__notfound:true} rather
     than throwing. Treating that as a successful post would burn the exactly-once claim and the
     member would never be greeted by either lane. */
  const gone = { ...world };
  world.channels = world.channels.filter((c) => c.name !== "welcome");
  world.welcomeOverride = "DEAD";     // resolves, but the channel 404s
  const H = mk();
  const r = await H.onMemberAdd(member("ghosted"));
  A("a 404'd welcome is an error, not a success", r === "error");
  A("...and the member stays unwelcomed so the sweep retries", !world.welcomed.has("ghosted"));
  world.welcomeOverride = null;
  world.channels = gone.channels.concat([{ id: "CW", type: 0, name: "welcome" }]);
}
{
  world.deadPostChannels.add("CD");    // still in the channel list, already deleted on Discord
  const H = mk();
  events.length = 0;
  const r = await H.onMemberRemove(member("silent"));
  A("a departure whose post 404s is recorded, not counted as announced", r === "recorded-postfail");
  A("...the row is still written so the census won't re-announce it", events.some((e) => e.departure));
  A("...and it surfaces as an error for the watchdog", H.errors.some((e) => /depart-post/.test(e.error)));
  world.deadPostChannels.clear();
}

console.log("\n— the heartbeat reports the GATEWAY, not the timer");
{
  let connected = true;
  const H = mk({ gatewayState: () => ({ connected, detail: connected ? "ws status 0" : "ws status 5" }) });
  await H.beat();
  let res = JSON.parse(cfg["rl_gateway-bot_result"]);
  A("a connected bot reports ok", res.ok === true && res.connected === true);
  connected = false;
  await H.beat();
  res = JSON.parse(cfg["rl_gateway-bot_result"]);
  A("a DEAF bot reports ok:false even with no errors", res.ok === false && res.connected === false);
  A("...and says why, so the page isn't a mystery", /not connected to Discord/.test(res.lastError));
  A("the heartbeat still writes — staleness is a separate signal", !!cfg["rl_gateway-bot"]);
  await H.beat({ fatal: "gateway closed with code 4014" });
  res = JSON.parse(cfg["rl_gateway-bot_result"]);
  A("a fatal close is reported verbatim", res.ok === false && /4014/.test(res.lastError));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
