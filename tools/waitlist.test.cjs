/* The application waitlist — office wiring + copy. Run: node tools/waitlist.test.cjs
   The BEHAVIOR (auto-fill on vacancy, guard-flag bracketing, eligibility re-check, rollback
   safety) was verified against the live database in a fully rolled-back rehearsal:
   OWNER seat=FILLED app=approved club recorded; STAFF promoted with departments; notifications
   created. These assertions hold the frontend wiring and the published copy. */
const fs = require("fs"), path = require("path");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const live = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part_live.js"), "utf8");
const book = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part3_content.js"), "utf8");

console.log("— the office can waitlist from the application detail");
A("the Waitlist button renders beside the override pair", /data-app-waitlist="1"/.test(live));
A("...not for already-waitlisted apps (a chip instead)", /On the waitlist/.test(live));
A("...calling the RPC", /CG\.sb\.rpc\("waitlist_application", \{ p_type:t, p_id:id \}\)/.test(live));
A("...with the auto-appointment consequence spelled out in the confirm",
  /appointed automatically/.test(live) && /first on, first served/.test(live));
A("a refusal is surfaced verbatim", /Couldn’t waitlist: /.test(live));

console.log("\n— the applicant sees the waitlist as a queue, not a rejection");
A("the staff-apply page has waitlisted copy", /You’re on the staff waitlist\./.test(live));
A("...promising the automatic appointment", /appointed automatically, and you’ll be notified/.test(live));
A("...styled as good news, not a denial", /app\.status==="waitlisted"\?"chip-chrome"/.test(live));

console.log("\n— the rulebook states the rule");
A("Rule 2.6 carries the waitlist paragraph",
  /longest-waiting eligible application fills it automatically/.test(book));
A("...with eligibility re-checked at appointment against 2.7", /re-checked at appointment against Rule 2\.7/.test(book));
A("...and the office able to reverse", /reverse any automatic appointment on review/.test(book));
A("changelog 2.20 records it", /"version":"2\.20"/.test(book));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
