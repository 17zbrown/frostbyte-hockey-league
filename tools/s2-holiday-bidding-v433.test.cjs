/* v4.33 (2026-10-25). Commissioner: "Saturday bidding will not be held on those days because games are not played that
   week due to the game week postponements due to Christmas and the New Year." Those days are Saturday, December 26,
   2026 and Saturday, January 2, 2027, in the Season 2 weeks of December 21 and December 28 that Rule 3.1 skips.
   Pins Rule S2.6 as rendered (the general rule and the two dates), the carry-over wording, and the changelog entry
   (found by version). Run: node tools/s2-holiday-bidding-v433.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 240))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));   /* the project's own rulebook source */
const rb = CG.CONTENT.rulebook, sec = (id) => [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === id) || { paragraphs: [] };
eval(R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0]);

console.log("\n1. Rule S2.6");
const s26 = sec("S2.6"), t = (s26.paragraphs || []).join(" ");
A("the general rule: no event on the Saturday of a holiday week Rule 3.1 skips",
  /No bidding event is held on the Saturday of a week skipped for an observed holiday \(Rule 3\.1\), because no games are played that week;/.test(t));
A("...naming the two Season 2 Saturdays", /for Season 2, no bidding event is held on Saturday, December 26, 2026 or Saturday, January 2, 2027\./.test(t));
A("...next to the sentence on which Saturdays are held", /after it, clubs use nightly requests only\. No bidding event is held on the Saturday of a week skipped/.test(s26.paragraphs[1] || ""));
A("an unbid player carries over to the next event held, not the next Saturday", /stays eligible for the next bidding event without playing six more games\./.test(t) && !/next Saturday's event/.test(t));
A("the weekly opening is unchanged (the v3.95 pin)", /every Saturday at 9:00 PM Eastern and runs for one hour/.test(t));
A("both formats: S2.6 has no full text of its own", !s26.full && s26.paragraphs.length === 2);
A("the running Saturdays stay out of the book (the v4.31 pin)", !/December 19|January 9|January 16/.test(JSON.stringify(rb.chapters.find((c) => String(c.num) === "S2"))));
for (const fmt of ["basic", "full"]) {
  const b = JSON.stringify(CG.rulebookForFormat(rb, fmt).chapters);
  A("the rendered " + fmt + " book carries it", /no bidding event is held on Saturday, December 26, 2026 or Saturday, January 2, 2027/.test(b) && !/next Saturday's event/.test(b));
}
A("no dash as punctuation or gendered pronoun in S2.6", !/[—–]| - /.test(t) && !/\b(he|his|him|she|her|hers)\b/i.test(t));

console.log("\n2. The changelog");
const e = rb.changelog.find((c) => c.version === "4.33") || {};
A("entry 4.33, in key order", e.version === "4.33" && JSON.stringify(Object.keys(e)) === JSON.stringify(["version", "dateIso", "summary", "items"]));
A("...naming both dates and Rule S2.6", /December 26/.test(e.summary || "") && /January 2/.test(e.summary || "") && (e.items || []).some((i) => /Rule S2\.6/.test(i)));
A("...with no em dash or gendered pronoun", !/[—–]| - /.test(JSON.stringify(e)) && !/\b(he|his|him|she|her|hers)\b/i.test(JSON.stringify(e)));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
