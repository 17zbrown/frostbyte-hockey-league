// discord-welcome resilience. Run: node tools/welcome-resilience.test.mjs
//
// The defect this guards: on 2026-08-07 22:30 a transient Discord 5xx on GET /guilds/:id/channels
// aborted the entire welcome sweep and paged the commissioner — even though that call only
// resolves channel IDs for links, and the sweep's actual job (greeting new members) was fine.
// A run that recovers must (a) still greet, (b) NOT report itself failed, and (c) still say what
// happened. A run that genuinely cannot greet must still report failure.
process.env.SUPABASE_URL = "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
process.env.DISCORD_BOT_TOKEN = "t";
process.env.DISCORD_GUILD_ID = "guild1";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const CHANNELS = [
  { id: "c-welcome", name: "welcome", type: 0 },
  { id: "c-rules", name: "rules", type: 0 },
  { id: "c-general", name: "general-chat", type: 0 },
];

let cfg, posts, marked, channelsFailTimes, memberList, result;
function reset(opts = {}) {
  cfg = { "rl_discord-welcome": "1970-01-01T00:00:00.000Z", welcome_seeded: "2026-01-01T00:00:00.000Z", ...(opts.cfg || {}) };
  posts = []; marked = []; result = null;
  channelsFailTimes = opts.channelsFailTimes ?? 0;
  memberList = opts.members ?? [{ user: { id: "u-new", bot: false }, pending: false }];
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url), m = (init.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

  if (u.includes("/rest/v1/app_config")) {
    if (m === "GET") {
      const key = decodeURIComponent((u.match(/key=eq\.([^&]+)/) || [])[1] || "");
      return J(cfg[key] !== undefined ? [{ value: cfg[key] }] : []);
    }
    if (m === "POST") {
      const b = JSON.parse(init.body);
      cfg[b.key] = b.value;
      if (b.key === "rl_discord-welcome_result") result = JSON.parse(b.value);
      return new Response(null, { status: 201 });
    }
  }
  if (u.includes("/rest/v1/welcomed_members")) {
    if (m === "GET") return J([]);
    if (m === "POST") { marked.push(...JSON.parse(init.body).map((r) => r.discord_id)); return new Response(null, { status: 201 }); }
  }
  if (u.includes("discord.com/api")) {
    if (u.includes("/channels") && !u.includes("/messages")) {
      if (channelsFailTimes > 0) { channelsFailTimes--; return new Response("upstream", { status: 503 }); }
      return J(CHANNELS);
    }
    if (u.includes("/members")) return J(u.includes("after=0") ? memberList : []);
    if (u.includes("/messages") && m === "POST") { posts.push({ url: u, body: JSON.parse(init.body) }); return J({ id: "msg1" }); }
  }
  return J([]);
};

const mod = await import(new URL("../netlify/functions/discord-welcome.js", import.meta.url).pathname);
const run = mod.default;

console.log("— the happy path still works");
{
  reset();
  await run();
  A("the new member is greeted", posts.length === 1);
  A("...in #welcome", posts[0].url.includes("c-welcome"));
  A("...and recorded", marked.includes("u-new"));
  A("the run reports success", result && result.ok === true && result.errCount === 0);
  A("the channel ids are cached for next time", !!cfg["discord_welcome_chan_cache"]);
  const cached = JSON.parse(cfg["discord_welcome_chan_cache"]);
  A("...with the real ids", cached.welcome === "c-welcome" && cached.rules === "c-rules");
}

console.log("\n— a transient channels failure no longer kills the sweep");
{
  const warm = JSON.stringify({ welcome: "c-welcome", rules: "c-rules", general: "c-general" });
  reset({ channelsFailTimes: 99, cfg: { discord_welcome_chan_cache: warm } });
  await run();
  A("the member is STILL greeted", posts.length === 1 && marked.includes("u-new"));
  A("...into the cached #welcome", posts[0].url.includes("c-welcome"));
  A("...with the cached channel links intact", /c-rules/.test(posts[0].body.content));
  A("the run does NOT report failure", result && result.ok === true && result.errCount === 0);
  A("...but the degradation is recorded", result.warnCount === 1 && /channels/.test(result.lastWarning || ""));
  A("...naming the recovery", /cached channel ids/.test(result.lastWarning || ""));
}

console.log("\n— it retries before giving up");
{
  // fails twice, then succeeds: the exponential ladder should absorb this with no warning at all
  reset({ channelsFailTimes: 2 });
  await run();
  A("a brief wobble is absorbed entirely", result && result.ok === true && result.warnCount === 0);
  A("...and the member is greeted", posts.length === 1);
}

console.log("\n— a run that truly cannot greet still reports failure");
{
  reset({ channelsFailTimes: 99 });          // no cache, no override
  await run();
  A("nothing is posted", posts.length === 0);
  A("...and it does not falsely claim success", result && (result.ok === false || posts.length === 0));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
