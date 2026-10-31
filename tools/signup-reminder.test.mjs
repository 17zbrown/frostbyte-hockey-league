// The recurring sign-up notice. Run: node tools/signup-reminder.test.mjs
//
// It posts every N days (commissioner's setting, currently 3). From 2026-09-08 it pinged nobody; since v4.39
// (commissioner, 2026-10-31: "ensure you tag the not signed up role in the season signup reminders") it tags the
// sign-up role and ONLY that role. This file is the runtime half of that guarantee: it asserts the actual posted body
// AND its allowed_mentions, which a static grep cannot see.
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
  /* a deadline still ahead of the real clock — the notice drops the date once it has passed, and a
     fixed date here quietly started failing the day the real deadline went by (2026-09-14) */
  signup_deadline_at: new Date(Date.now() + 10 * 86400000).toISOString(), registration_deadline: null };

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
    /* v4.39: the role the notice tags (a real snowflake shape; anything else posts untagged) */
    { key: "discord_not_signed_up_role_id", value: "123456789012345678" },
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

const mod = await import(new URL("../jobs/discord-scheduler.js", import.meta.url).pathname);
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
  A("...tagging the sign-up role, first thing (v4.39)", posts[0].content.startsWith("<@&123456789012345678> "), posts[0].content.slice(0, 40));
  A("...and only that role can fire at the API level (no broad parse, no users, no everyone)",
    JSON.stringify(posts[0].allowed_mentions) === JSON.stringify({ parse: [], roles: ["123456789012345678"] }),
    JSON.stringify(posts[0].allowed_mentions));
  A("...and the result says so", /tagging the sign-up role/.test(String(body.signups)), String(body.signups));
  A("...while still naming how many are outstanding", /2 members haven't registered/.test(posts[0].content),
    posts[0].content.split("\n")[0]);
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

console.log("\n— the off switch");
{
  for (const v of ["off", "false", "0", "no", "paused", "OFF"]) {
    reset();
    cfgRows.push({ key: "signup_reminder_enabled", value: v });
    const body = await (await call()).json();
    A(`"${v}" pauses it`, posts.length === 0 && /^paused/.test(String(body.signups)), String(body.signups));
  }
  reset();                                   // unset = on, so a fresh environment still runs
  let body = await (await call()).json();
  A("unset leaves it running", posts.length === 1, String(body.signups));
  reset();
  cfgRows.push({ key: "signup_reminder_enabled", value: "on" });
  body = await (await call()).json();
  A("...and \"on\" turns it back on with no deploy", posts.length === 1, String(body.signups));
}

console.log("\n— no usable role id: it still posts, untagged, and says the ping is unconfigured");
{
  for (const v of [null, "ROLE1", "<@&1> everyone"]) {
    reset();
    cfgRows = cfgRows.filter((r) => r.key !== "discord_not_signed_up_role_id");
    if (v !== null) cfgRows.push({ key: "discord_not_signed_up_role_id", value: v });
    const body = await (await call()).json();
    A(`role id ${JSON.stringify(v)}: posted with no mention and nothing pingable`,
      posts.length === 1 && !/<@/.test(posts[0].content) && JSON.stringify(posts[0].allowed_mentions) === JSON.stringify({ parse: [] }),
      posts[0] && JSON.stringify(posts[0].allowed_mentions));
    A("...and reported as unconfigured", (body.unconfigured || []).some((u) => /sign-up reminder ping/.test(u)), JSON.stringify(body.unconfigured));
  }
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
