/* The application waitlist — office wiring + copy. Run: node tools/waitlist.test.cjs
   The BEHAVIOR (auto-fill on vacancy, guard-flag bracketing, eligibility re-check, rollback
   safety) was verified against the live database in a fully rolled-back rehearsal:
   OWNER seat=FILLED app=approved club recorded; STAFF promoted with departments; notifications
   created. These assertions hold the frontend wiring and the published copy.
   SUPERSEDED (spec change, not a weakened check): the auto-fill was retired 2026-09-07 (commissioner: "The waitlist
   should not automatically accept someone when a position opens up") and restated 2026-10-19 for v4.22 ("Waitlist
   applications should not fill automatically"). The promise pins below are inverted on purpose and scoped to Rule
   2.6, so the v2.20 changelog entry (history) cannot keep them green. tools/staff-app-withdraw-v422.test.cjs pins the
   database side. */
const fs = require("fs"), path = require("path");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const live = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part_live.js"), "utf8");
const book = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part3_content.js"), "utf8");

console.log("— the office can waitlist from the application detail");
A("the Waitlist button renders beside the override pair", /data-app-waitlist="1"/.test(live));
A("...not for already-waitlisted apps (a chip instead)", /On the waitlist/.test(live));
A("...calling the RPC", /CG\.sb\.rpc\("waitlist_application", \{ p_type:t, p_id:id \}\)/.test(live));
A("...and the confirm says nobody is admitted automatically (v4.22; no auto-appointment, no first-on promise)",
  /Nobody is admitted automatically: when a "\+\(t==="owner"\?"club owner seat":"staff seat"\)\+" opens, the reviewers admit from the Waitlist card on the Staff Desk, in any order they choose\./.test(live) &&
  !/the oldest waitlisted application is appointed automatically/.test(live) && !/first on, first served/.test(live) && !/appointed automatically when a spot opens/.test(live));
A("a refusal is surfaced verbatim", /Couldn’t waitlist: /.test(live));

console.log("\n— the applicant sees the waitlist as a queue, not a rejection");
A("the staff-apply page has waitlisted copy", /You’re on the staff waitlist\./.test(live));
A("...saying nobody is admitted automatically, and that an edit keeps the place (v4.22)", /Nobody is admitted automatically: when a seat opens, the league office’s reviewers admit from the waitlist/.test(live) &&
  /Updating your application keeps your place; withdrawing it gives the place up\./.test(live) && !/appointed automatically, and you’ll be notified/.test(live));
A("...styled as good news, not a denial", /app\.status==="waitlisted"\?"chip-chrome"/.test(live));

console.log("\n— the rulebook states the rule");
global.window = global; global.CG = {}; eval(book);
const sec26 = [].concat(...CG.CONTENT.rulebook.chapters.map((c) => c.sections || [])).find((x) => x.id === "2.6") || {};
const both = [(sec26.paragraphs || [])[3] || "", (sec26.full || [])[3] || ""];
A("Rule 2.6 (basic and full) says no application leaves the waitlist automatically (v4.22)",
  both.every((t) => /No application leaves the waitlist automatically: when a seat opens/.test(t) && /the reviewers' votes do not decide a waitlisted application/.test(t)));
A("...with eligibility checked again at admission against 2.7", both.every((t) => /Eligibility is checked again at admission against Rule 2\.7/.test(t)));
A("...and no automatic fill or automatic appointment left in Rule 2.6", !/fills it automatically|automatic appointment|in the order applications were waitlisted\./.test(JSON.stringify(sec26)));
A("changelog 2.20 records it", /"version":"2\.20"/.test(book));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
