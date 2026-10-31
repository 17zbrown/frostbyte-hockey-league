/* The recurring #season-signups notice pings the sign-up role and NOTHING else.
   Run: node tools/signup-notice-no-ping.test.cjs

   History: it mentioned the bot-maintained "Not Signed Up" role every window until the commissioner removed the ping on
   2026-09-08, and this file then pinned "mentions nobody". v4.39 (commissioner, 2026-10-31: "ensure you tag the not
   signed up role in the season signup reminders") reverses that ruling, so these pins are inverted with intent: the
   name stays so the history is findable. Two independent guards, because either alone would let a wider ping in:
     1. the copy tags exactly the stored sign-up role, and
     2. the post sends allowed_mentions {parse:[], roles:[that id]} (no broad `ping`), so nothing else can fire. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sched = R("jobs/discord-scheduler.js");
const sync = R("jobs/discord-sync.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

// isolate the sign-up reminder so a ping elsewhere can't mask a regression here
const fn = sched.slice(sched.indexOf("async function signupReminder"));
const body = fn.slice(0, fn.indexOf("\nfunction json("));

console.log("— the sign-up notice tags the sign-up role and nothing else (v4.39)");
A("the role id comes from the stored sign-up role", /String\(cfg\.discord_not_signed_up_role_id \|\| ""\)\.trim\(\)/.test(body));
A("...used only when it is a real id", /\/\^\\d\{15,25\}\$\/\.test\(nsu\)/.test(body));
A("the copy opens with that one mention", /const tag = [^\n]*`<@&\$\{nsu\}> `/.test(body) && /const content = `\$\{tag\}/.test(body));
A("the post names exactly that role, never the broad ping", /postWebhook\(url, content, tag \? \{ roles: \[nsu\] \} : \{\}\)/.test(body) && !/ping: true/.test(body));
A("postWebhook turns a role list into parse:[] plus that list",
  /\(opts\.roles && opts\.roles\.length\) \? \{ parse: \[\], roles: opts\.roles\.map\(String\) \}/.test(sched));
A("a missing id is reported, not silent", /unconfigured\.push\("sign-up reminder ping \(discord_not_signed_up_role_id\)"\)/.test(body));
A("the notice still carries the deadline and the sign-up link",
  /sign-ups are open/.test(body) && /#\/register/.test(body));

console.log("\n— what must NOT have changed");
A("the staff casework nudge keeps its ping", /postWebhook\(url, content, \{ ping: true \}\)/.test(sched));
A("the Not Signed Up role is still provisioned by discord-sync", /discord_not_signed_up_role_id/.test(sync));
A("...and still used for channel permissions", /Not Signed Up/.test(sync));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
