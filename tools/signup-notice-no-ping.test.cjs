/* The recurring #season-signups notice must never @-ping anyone (commissioner, 2026-09-08).
   Run: node tools/signup-notice-no-ping.test.cjs

   It used to mention the bot-maintained "Not Signed Up" role every window. The role still exists and
   discord-sync still uses it for channel permissions and the GIF carve-out — only the ping is gone.
   Two independent guards, because either alone would let a ping back in:
     1. no role mention in the copy, and
     2. no `ping` option on the post, which sends allowed_mentions {parse:[]} so a stray mention is inert. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sched = R("netlify/functions/discord-scheduler.js");
const sync = R("netlify/functions/discord-sync.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

// isolate the sign-up reminder so a ping elsewhere can't mask a regression here
const fn = sched.slice(sched.indexOf("async function signupReminder"));
const body = fn.slice(0, fn.indexOf("\nfunction json("));

console.log("— the sign-up notice mentions nobody");
A("no role mention in the copy", !/<@&/.test(body));
A("...and the not-signed-up role id is not even read", !/discord_not_signed_up_role_id/.test(body));
A("the post carries no ping option", !/postWebhook\(url, content, \{ ping: true \}\)/.test(body));
A("...it posts with mentions suppressed", /postWebhook\(url, content\);/.test(body));
A("the result line no longer claims a ping", !/pinged the not-signed-up role/.test(body) &&
  /posted the sign-up notice, no ping/.test(body));
A("the notice still carries the deadline and the sign-up link",
  /sign-ups are open/.test(body) && /#\/register/.test(body));

console.log("\n— what must NOT have changed");
A("the staff casework nudge keeps its ping", /postWebhook\(url, content, \{ ping: true \}\)/.test(sched));
A("the Not Signed Up role is still provisioned by discord-sync", /discord_not_signed_up_role_id/.test(sync));
A("...and still used for channel permissions", /Not Signed Up/.test(sync));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
