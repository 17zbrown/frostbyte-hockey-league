// The daily sign-up reminder. Run: node tools/signup-reminder.test.mjs
//
// This exists because of a silent four-day outage: the v2.8 rule change (the sign-up deadline is a
// draft cutoff, not a hard close) removed the `deadline` binding while the message below still
// referenced it. Every 6pm run threw ReferenceError before posting, and nothing in the suite
// touched this path — `node --check` cannot see an undeclared identifier inside a rarely-taken
// branch, only actually RUNNING it can. So this runs it.
process.env.SUPABASE_URL = "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
process.env.DISCORD_BOT_TOKEN = "t";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const SEASON = { id: "S1", name: "Season 1", registration_open: true,
  signup_deadline_at: "2026-09-14T04:00:00.000Z", registration_deadline: null };

let DB, posts, claims, cfgRows;
function reset(over = {}) {
  DB = {
    seasons: [ { ...SEASON, ...(over.season || {}) } ],
    members: over.members ?? [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    regs: over.regs ?? [{ profile_id: "p1" }],
  };
  posts = []; claims = [];
  cfgRows = [
    { key: "discord_signup_webhook", value: "https://discord.com/api/webhooks/x/y" },
    { key: "discord_not_signed_up_role_id", value: "ROLE1" },
  ];
}
reset();

globalThis.fetch = async (url, init = {}) => {
  const u = String(url), m = (init.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (u.includes("/rest/v1/app_config")) {
    if (m === "GET") return J(cfgRows);
    return new Response(null, { status: 201 });
  }
  if (u.includes("/rest/v1/seasons")) {
    // model the filter: the reminder asks for registration_open=is.true specifically, while the
    // scheduler's own preamble asks for the latest season unfiltered. A stub that ignores the
    // filter makes "registration closed" untestable and hides the early-bail path.
    if (u.includes("registration_open=is.true")) return J(DB.seasons.filter((x) => x.registration_open));
    return J(DB.seasons);
  }
  if (u.includes("/rest/v1/profiles")) return J(DB.members);
  if (u.includes("season_registrations")) return J(DB.regs);
  if (u.includes("/rest/v1/games")) return J([]);
  if (u.includes("/rest/v1/teams")) return J([]);
  if (u.includes("/rest/v1/discord_post_log")) {
    if (m === "POST") { claims.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
    return new Response(null, { status: 204 });
  }
  if (u.includes("discord.com/api/webhooks")) { posts.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
  return J([]);
};

const mod = await import(new URL("../netlify/functions/discord-scheduler.js", import.meta.url).pathname);
const run = mod.default;
const call = () => run(new Request("https://x/.netlify/functions/discord-scheduler?run=signups"));

console.log("— it posts at all (the regression)");
{
  reset();
  const res = await call();
  const body = await res.json();
  A("the run records no error", !body.error, body.error);
  A("...specifically not a ReferenceError", !/is not defined/.test(String(body.error || "")));
  A("a reminder is actually posted", posts.length === 1);
  A("...pinging the Not Signed Up role", /<@&ROLE1>/.test(posts[0].content));
  A("...and only the unregistered are counted", /2 remaining/.test(String(body.signups)), String(body.signups));
}

console.log("\n— the deadline is described as a draft cutoff, not a close");
{
  reset();
  await call();
  const c = posts[0].content;
  A("the deadline date appears", /Sign up before \*\*/.test(c));
  A("...and says what missing it actually costs", /placed on a club/.test(c));
  A("...without claiming registration shuts", !/closes|closed|last chance/i.test(c));
  A("the register link is present", /#\/register/.test(c));
}

console.log("\n— a season with no deadline still reads correctly");
{
  reset({ season: { signup_deadline_at: null, registration_deadline: null } });
  await call();
  A("it still posts", posts.length === 1);
  A("...with no dangling 'before'", !/before \*\*/.test(posts[0].content));
  A("...and still links register", /#\/register/.test(posts[0].content));
}

console.log("\n— the quiet cases stay quiet");
{
  reset({ regs: [{ profile_id: "p1" }, { profile_id: "p2" }, { profile_id: "p3" }] });
  let body = await (await call()).json();
  A("nobody outstanding = no ping", posts.length === 0 && /everyone signed up/.test(String(body.signups)));

  reset({ season: { registration_open: false } });   // the season still exists; it just isn't open
  body = await (await call()).json();
  A("registration closed = no ping", posts.length === 0 && /registration closed/.test(String(body.signups)));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
