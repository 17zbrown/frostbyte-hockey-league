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

/* v4.58 re-pin (commissioner, 2026-11-23: "remove the waitlist entirely from the website and rulebook"; zero applications
   were waitlisted that day). The site checks below pinned the office's Waitlist button and the applicant's queue copy;
   they now pin that both are gone, with every other waitlist surface (the Review Board's Waitlist card, its Admit and
   Remove buttons, the chips). The database objects stay until they are dropped after the switch, so only comments may
   still name them. */
const desk = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part9_staffdesks.js"), "utf8");
const noCm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
console.log("# the office can no longer waitlist (v4.58)");
A("no Waitlist button beside the override pair, and no waitlist chip", !/data-app-waitlist|On the waitlist|>Waitlisted<|"Waitlisted"/.test(noCm(live)));
A("...and no call to waitlist_application, waitlist_admit or waitlist_remove anywhere on the site", !/rpc\("waitlist_(application|admit|remove)"/.test(live + desk));
A("the Review Board has no Waitlist card, Admit or Remove (its after-hook wires nothing)", !/<h3>Waitlist<\/h3>|data-wl-admit|data-wl-remove|Remove from waitlist/.test(desk) && /CG\.AFTER\._deskReviewBoard = function\(\)\{\};/.test(desk));

console.log("\n# the applicant sees no queue copy (v4.58)");
A("the staff-apply page has no waitlisted note, chip or toast", !/You’re on the staff waitlist|You are still on the waitlist|"waitlisted"\?"chip-chrome"|give up your place on the waitlist/.test(live));
A("no page treats an application as waitlisted (comments aside)", !/waitlist/i.test(noCm(live)) && !/waitlist/i.test(noCm(desk)));

console.log("\n— the rulebook states the rule");
global.window = global; global.CG = {}; eval(book);
const sec26 = [].concat(...CG.CONTENT.rulebook.chapters.map((c) => c.sections || [])).find((x) => x.id === "2.6") || {};
const both = [(sec26.paragraphs || [])[3] || "", (sec26.full || [])[3] || ""];
/* v4.58 re-pin (commissioner, 2026-11-23: "remove the waitlist entirely from the website and rulebook"): Rule 2.6 no longer
   carries the waitlist, so the rulebook checks here pin the text without it; the database and site checks are unchanged */
A("Rule 2.6 (basic and full) no longer carries the waitlist (v4.58; it said no application leaves it automatically since v4.22)",
  both.every((t) => t.length > 0 && !/waitlist/i.test(t)));
A("...and the two texts still match, so nothing is shelved", both[0] === both[1]);
A("...and no automatic fill or automatic appointment left in Rule 2.6", !/fills it automatically|automatic appointment|in the order applications were waitlisted\./.test(JSON.stringify(sec26)));
A("changelog 2.20 records it", /"version":"2\.20"/.test(book));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
