/* v3.23 — a trade request is a club matter and goes to the club's front office.
 *
 * Commissioner, 2026-09-25: "Remember trade requests go to the team management of the player
 * requesting the trade... Not the league staff."
 *
 * The routing itself is a DB trigger and was rehearsed against the live schema (see the record).
 * This file pins the client half, which is where it would silently come back: four staff surfaces
 * each filtered the case list by STATUS and none of them by ROUTE.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const live = R("src/live/part_live.js"), desks = R("src/live/part9_staffdesks.js"),
      rec = R("sql/2026-09-25-trade-request-routing.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— ONE definition of league casework, and every staff surface reads it");
{
  A("CG.staffCases exists and excludes manager-routed cases",
    /CG\.staffCases = function\(\)\{[\s\S]{0,220}\(a\.route \|\| ""\) !== "manager"/.test(live));
  A("CG.clubCases is the other half, scoped to one club",
    /CG\.clubCases = function\(teamId\)\{[\s\S]{0,240}\(a\.route \|\| ""\) === "manager" && a\.team_id === teamId/.test(live));
  /* the real test: NO staff surface may reach the raw list any more */
  const code = live.replace(/\/\*[\s\S]*?\*\//g, "");
  const raw = code.split("\n").map((l, i) => [i + 1, l])
    .filter(([, l]) => /_actionReqs/.test(l) && !/CG\.lg\._actionReqs = |CG\.lg\._actionReqs=\[\]|_actionReqs","|_actionReqs\|\|\[\]\)\.map\(function\(a\)\{ return a\.id/.test(l));
  A("the only readers of the raw list left are the two definitions, the case-thread lookup, and the member's own cases",
    raw.length <= 5, raw.map(([i, l]) => i + ": " + l.trim()).join(" | "));
  A("the league office's case QUEUE is staff cases", /var queue = review && !opts\.mineOnly \? CG\.staffCases\(\) : mine;/.test(live));
  A("...while the member's own list stays raw, so he sees the request he filed",
    /var mine = CG\.auth\.user \? all\.filter\(function\(a\)\{ return a\.profile_id===uid; \}\) : \[\];/.test(live));
  A("the league-office dashboard counts are staff cases too", /CG\.visibleComplaints = function\(\)\{\s*\n\s*return CG\.staffCases\(\)\.map/.test(live));
  A("the staff-desk attention fallback counts staff cases", /var oc = CG\.staffCases\(\)\.filter/.test(live));
  A("the ticket archive builds from staff cases", /CG\.staffCases\(\)\.forEach\(function\(a\)\{/.test(live));
  A("the Staff Desk builds from staff cases", /var reqs = CG\.staffCases\(\);/.test(live));
  A("the Officials' desk builds from staff cases", /var open = CG\.staffCases\(\)\.filter/.test(desks));
  A("...and part9 loads after part_live, so the helper exists when it runs",
    R("src/live/build.cjs").indexOf("part_live") < R("src/live/build.cjs").indexOf("part9_staffdesks"));
}

console.log("\n— the archive stops advertising club matters as staff work");
{
  A("the Trade requests filter chip is gone", !/\["trade_request","Trade requests"\]/.test(live));
  A("...while complaints, appeals and position changes stay",
    /\["complaint","Complaints"\],\["appeal","Appeals"\],\["position_change","Position changes"\]/.test(live));
}

console.log("\n— what the player is told");
{
  A("the type blurb names the three seats and the rule",
    /Ask your club’s front office for a move\. It goes to your Owner, GM and AGM, and to nobody else \(Rule 2\.3\)/.test(live));
  A("the form says the league office does not receive it",
    /The league office does not receive it \(Rule 2\.3\)/.test(live));
  A("...and that both the site and Discord are used", /notified on the site and on Discord/.test(live));
  A("the confirmation says front office, not management", /Sent to your club’s front office/.test(live));
  A("no em dash survives in the copy that was touched",
    !/private to your club’s management\. —/.test(live) && !/Filed — the league office has it/.test(live));
}

console.log("\n— the published rule");
{
  const content = R("src/live/part3_content.js");
  const obj = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  const r23 = obj.rulebook.chapters.find((c) => c.num === 2).sections.find((s) => s.id === "2.3");
  const body = r23.paragraphs.join(" ");
  A("Rule 2.3 covers a player asking to be traded", /A player may ask to be traded/.test(body));
  A("...naming all three seats and nobody else",
    /the Owner, General Manager and Assistant General Manager, and to nobody else/.test(body));
  A("...and saying the league office neither receives it nor rules on it",
    /the league office neither receives it nor rules on it/.test(body));
  A("...that a club need not act and a player need not explain",
    /under no obligation to act on a request/.test(body) && /under no obligation to explain one/.test(body));
  A("...the no-front-office case", /Where a club has no front office at all/.test(body));
  A("...and that a request is not a trade", /A request is not a trade/.test(body));
  A("the changelog records it", obj.rulebook.changelog.some((e) => e.version === "3.23"));
}

console.log("\n— the record");
{
  A("it quotes the instruction", /Not the league staff/.test(flat));
  A("it names all four faults", /notified teams\.gm_profile_id ALONE/.test(flat)
    && /notify_commissioners for every manager-routed case/.test(flat)
    && /_staff_attention counted manager-routed rows/.test(flat)
    && /did not scope its staff clause by route/.test(flat));
  A("...and why the GM-only bug was invisible", /the right people could see it, so it looked like it worked/.test(flat));
  A("it justifies the one exception", /a club with NO front office at all/.test(flat));
  A("...and why commissioners keep the read", /They are the appeal path/.test(flat));
  A("the rehearsal proved the OPPOSITE case too", /Then filed a COMPLAINT in the same transaction/.test(flat));
  A("...and says why that matters", /would otherwise have looked like a success/.test(flat));
  A("the NOT IN NULL trap is recorded", /is NULL for every row when any seat is NULL/.test(flat));
  A("...with the real symptom", /no non-management player.*club carrying twenty/.test(flat));
  A("the link_param trap is recorded", /column is link_param, not param/.test(flat));
  A("no em dash or spaced hyphen in the record", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
