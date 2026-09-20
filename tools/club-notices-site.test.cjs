/* v2.42 — the roster page sets pre-season loans apart; the changelog records the club-notice lane.
   Run: node tools/club-notices-site.test.cjs */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const hub = R("src/live/part6_hub.js"), head = R("src/live/part1_head.html"), content = R("src/live/part3_content.js"), bot = R("bot/chel-bot.mjs"), sync = R("netlify/functions/discord-sync.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
A("a loan is a random assignment OR a late sign-up placed the same way", /var isLoan = function\(p\)\{ return !p\.mgmt && \(p\.origin === "preseason_random" \|\| p\.origin === "latecomer_random"\); \};/.test(hub));
A("loans render in their own block below the contracted players, with the rule explained", /var sqSplit = CG\.splitSquads\(contracted\);/.test(hub) && /sqSplit\.active\.map\(rowFor\)\.join\(""\) \+/.test(hub) && /Training camp — '\+sqSplit\.camp\.length\+'/.test(hub) && /Pre-season loans — '\+loans\.length\+'/.test(hub) && /they return to the draft pool when the final pre-season game ends \(Rule 0\.4\)/.test(hub));
A("...each loan row is tinted and carries a LOAN chip first", /class="'\+\(loan\?"loan-row":""\)\+'"/.test(hub) && /status = '<span class="chip chip-ink" style="--bc:var\(--steel\)"[^>]*>Loan<\/span> '\+status;/.test(hub) && /tr\.loan-row td\{background:var\(--line-soft\)\}/.test(head));
A("...and shows the registered position when he is listed elsewhere for the pre-season", /Listed at '\+esc\(p\.pos\)\+' for the pre-season to fill an open seat; he registered as '\+esc\(rp\)/.test(hub));
A("the bot has a club-notices lane with a catch-up", /sb\.channel\("club-notices"\)/.test(bot) && /CLUB\.catchUp\(\)/.test(bot) && /clubNoticesLive/.test(bot));
A("the sweep is the backstop, under the same claim", /async function flushClubNotices\(sum\)/.test(sync) && /kind: "club", ref/.test(sync) && /clubNoticesPosted: sum\.clubNoticesPosted \|\| 0/.test(sync));
const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
A("changelog 2.42", (function(){ var e=rb.changelog.find(function(c){return c.version==="2.42";}); return !!e && /Owner, GM and AGM/.test(e.summary) && /one summary per club/.test(e.summary); })());
console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
