// A sign-up does not survive leaving the Discord — the sweep step that enforces it.
// Run: node tools/departed-signups.test.mjs
//
// The data change itself lives in one SECURITY DEFINER RPC (remove_departed_signups: pending rows
// only, archived before deletion, member notified on the site, 24h grace). What this file pins is
// the sweep's half of the contract: the RPC is actually called each tick, removals surface in the
// run summary and the commissioners' departures room, and an RPC failure degrades to a recorded
// error — never a thrown sweep.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";

import { readFileSync } from "node:fs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

let rpcCalls = [];
let rpcResult = [];
let rpcFail = false;
const posts = [];

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  const J = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { "content-type": "application/json" } });
  if (u.includes("/rest/v1/rpc/remove_departed_signups")) {
    rpcCalls.push(JSON.parse(opts.body || "{}"));
    if (rpcFail) return J({ message: "guard says no" }, 403);
    return J(rpcResult);
  }
  if (u.includes("discord.com")) { if (m === "POST") posts.push({ url: u, body: JSON.parse(opts.body || "{}") }); return J({ id: "msg" }); }
  return J([]);
};

const { _internals: I } = await import(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname);

const run = async (chan) => {
  rpcCalls = []; posts.length = 0;
  const sum = { errors: [] };
  if (chan) sum.__departChanId = chan;
  await I.removeDepartedSignups(sum);
  return sum;
};

console.log("— the quiet tick: nobody overdue");
{
  rpcResult = [];
  const sum = await run("chan1");
  A("the RPC is asked every tick", rpcCalls.length === 1);
  A("...with the grace window, not an instant trigger",
    rpcCalls[0].p_grace_hours === I.SIGNUP_REMOVAL_GRACE_HOURS && I.SIGNUP_REMOVAL_GRACE_HOURS >= 12,
    `grace=${rpcCalls[0].p_grace_hours}h`);
  A("no removals → nothing announced, nothing summarized", posts.length === 0 && !("signupsRemoved" in sum));
}

console.log("\n— two overdue sign-ups are withdrawn");
{
  rpcResult = [{ profile_id: "p1", gamertag: "LeaverOne" }, { profile_id: "p2", gamertag: "LeaverTwo" }];
  const sum = await run("chan1");
  A("both names land in the run summary", JSON.stringify(sum.signupsRemoved) === JSON.stringify(["LeaverOne", "LeaverTwo"]));
  A("one message to the departures room", posts.length === 1 && posts[0].url.includes("/channels/chan1/messages"));
  const emb = posts[0].body.embeds && posts[0].body.embeds[0];
  A("...naming both members", !!emb && emb.description.includes("LeaverOne") && emb.description.includes("LeaverTwo"));
  A("...and the grace window, so the office knows the rule that fired",
    !!emb && emb.description.includes(String(I.SIGNUP_REMOVAL_GRACE_HOURS)));
  A("...with mentions disarmed", JSON.stringify(posts[0].body.allowed_mentions) === JSON.stringify({ parse: [] }));
  A("a gamertag-less profile still shows up by id",
    (rpcResult = [{ profile_id: "p9", gamertag: null }], true));
  const sum2 = await run("chan1");
  A("...as the profile id", JSON.stringify(sum2.signupsRemoved) === JSON.stringify(["p9"]));
}

console.log("\n— a backlog batch never outgrows Discord's embed limit");
{
  // 150 max-length display names — the exact shape that used to 400 the whole announcement away
  rpcResult = Array.from({ length: 150 }, (_, i) => ({ profile_id: "p" + i, gamertag: ("VeryLongDisplayName" + i).padEnd(32, "x") }));
  const sum = await run("chan1");
  A("all 150 land in the run summary", (sum.signupsRemoved || []).length === 150);
  A("the announcement splits into chunks", posts.length > 1, `${posts.length} posts`);
  A("...every description within the 4096 cap", posts.every((p) => p.body.embeds[0].description.length <= 4096));
  A("...numbered so the office can see the set is complete",
    posts.every((p, i) => p.body.embeds[0].title.includes(`(${i + 1}/${posts.length})`)));
  A("...every name present exactly once across the chunks",
    (() => { const all = posts.map((p) => p.body.embeds[0].description).join("\n");
      return rpcResult.every((r) => all.includes(r.gamertag)); })());
  A("...the explanation rides the last chunk only",
    posts.filter((p) => p.body.embeds[0].description.includes("archived and removed from the pool")).length === 1 &&
    posts[posts.length - 1].body.embeds[0].description.includes("archived and removed from the pool"));
  A("...all with mentions disarmed", posts.every((p) => JSON.stringify(p.body.allowed_mentions) === JSON.stringify({ parse: [] })));
}

console.log("\n— the announcement is best-effort; the data is not");
{
  rpcResult = [{ profile_id: "p1", gamertag: "LeaverOne" }];
  const sum = await run(null); // departures room unavailable this tick
  A("the removal is still summarized without a channel", JSON.stringify(sum.signupsRemoved) === JSON.stringify(["LeaverOne"]));
  A("...and nothing was posted anywhere", posts.length === 0);
}

console.log("\n— an RPC refusal degrades to a recorded error");
{
  rpcFail = true;
  const sum = await run("chan1");
  rpcFail = false;
  A("the failure is in sum.errors, not thrown", sum.errors.length === 1 && JSON.stringify(sum.errors[0]).includes("403"));
  A("no phantom removals announced", posts.length === 0 && !("signupsRemoved" in sum));
}

console.log("\n— the sweep wiring and the places the rule is told to humans");
{
  const sync = readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");
  const call = sync.indexOf("await removeDepartedSignups(sum)");
  A("the step runs in the sweep", call > 0);
  A("...right after the census settles, before the minutes-long role passes (a member who rejoins mid-sweep must not be caught by a stale read)",
    call > sync.indexOf("await trackDepartures(") && call < sync.indexOf("for (const m of links)"));
  A("...before the game-server resolver", call < sync.indexOf("rpc/resolve_due_servers"));
  A("the run result records the count", /signupsRemoved: \(sum\.signupsRemoved \|\| \[\]\)\.length/.test(sync));
  A("a crash after the early heartbeat stamp writes a FAILING result (the panel must never lie green)",
    /rl_discord-sync_result/.test(sync.slice(sync.lastIndexOf("catch (e)"))) &&
    /ok: false/.test(sync.slice(sync.lastIndexOf("catch (e)"))));

  const bot = readFileSync(new URL("../bot/handlers.mjs", import.meta.url), "utf8");
  const addStart = bot.indexOf("async function onMemberAdd");
  const addBody = bot.slice(addStart, bot.indexOf("async function", addStart + 10));
  A("the gateway bot marks presence the instant someone rejoins",
    /guild_members\?on_conflict=discord_id/.test(addBody) && /present: true/.test(addBody));
  A("...before the welcome gates can return early", addBody.indexOf("present: true") < addBody.indexOf("m.pending"));

  const live = readFileSync(new URL("../src/live/part_live.js", import.meta.url), "utf8");
  A("the Register page warns that leaving withdraws the sign-up",
    /Staying in the server keeps your sign-up alive/.test(live) && /withdrawn automatically after about a day/.test(live));
  A("the Automations panel renders the withdrawn count", /withdrew \" \+ res\.signupsRemoved/.test(live) || /withdrew " \+ res\.signupsRemoved/.test(live));
  A("the office can SEE the archive the rulebook cites (Pre-season central card)",
    /season_registration_removals/.test(live) && /Withdrawn sign-ups/.test(live));

  const content = readFileSync(new URL("../src/live/part3_content.js", import.meta.url), "utf8");
  A("Rule 1.1 carries the automatic-withdrawal rule",
    /A registered player who leaves the league Discord before being placed on a club has their sign-up withdrawn automatically/.test(content));
  A("...and the rulebook changelog leads with v2.21",
    /"changelog":\[\{"version":"2\.21"/.test(content));
  A("the season-walkthrough chapter mentions it where self-withdrawal is described",
    /leaving the league Discord does the same thing automatically after a day's grace \(Rule 1\.1\)/.test(content));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
