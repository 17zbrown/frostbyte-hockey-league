/* v5.00 swap, the staffing flip (stream h, 2026-11-24). Pins tools/s2-rulebook-splice.cjs and its data,
   tools/s2-rulebook/rulebook-s2.json: the rulebook text that becomes true when the held staffing records apply at the
   switch (staff powers and all-staff voting, branch db/s2-committees). Commissioner, 2026-10-19: "for Season 2, we will
   remove the different departments, and we will allow every staff member to be a part of one big group"; 2026-11-23:
   every staff member votes on owner, staff and front-office applications, 50% + 1; only committee managers or
   commissioners suspend, up to 14 days or 18 games, anything longer applied for and approved by a commissioner.
   The splice runs only in the flip commit, so this test splices a TEMP COPY of src/live/part3_content.js (through the
   CLI, as the flip commit will), renders it through the real CG.rulebookForFormat in both formats, and checks that every
   new phrase is in force, every stale one is gone from the whole book (Appendix A included), the held phrases arrive,
   nothing else moved, a second run changes nothing, and a drifted book stops the splice with nothing written. It passes
   before the flip (every edit applies to the copy) and after it (every edit is already in place).
   Run: node tools/s2-rulebook.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm"), os = require("os"), cp = require("child_process");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 240))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const { splice, SPEC } = require("./s2-rulebook-splice.cjs");
const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"));
const RENDER = R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0];
const load = (text) => { const ctx = { console, CG: {} }; vm.createContext(ctx); vm.runInContext(text, ctx); vm.runInContext(RENDER, ctx); return ctx.CG; };

const source = R("src/live/part3_content.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "s2-rulebook-"));
const file = path.join(tmp, "part3_content.js");
fs.writeFileSync(file, source);

console.log("# the splice, through the CLI, on a temp copy");
const run = () => cp.spawnSync(process.execPath, [path.join(__dirname, "s2-rulebook-splice.cjs"), file], { encoding: "utf8" });
const r1 = run();
A("the first run succeeds", r1.status === 0, r1.stderr || r1.stdout);
const once = fs.readFileSync(file, "utf8");
const r2 = run();
A("a second run applies nothing and says every edit is in place", r2.status === 0 && new RegExp("0 applied, " + spec.edits.length + " already in place").test(r2.stdout), r2.stdout + r2.stderr);
A("a second run leaves the file byte for byte", fs.readFileSync(file, "utf8") === once);
console.log("(the live source is " + (once === source ? "already spliced: the flip has landed" : "not spliced yet: the flip has not landed") + ")");

const before = load(source), after = load(once);
const rbB = before.CONTENT.rulebook, rbA = after.CONTENT.rulebook;
const secsB = rbB.chapters.flatMap((c) => c.sections), secsA = rbA.chapters.flatMap((c) => c.sections);
const sec = (secs, id) => secs.find((s) => s.id === id);

console.log("\n# only the rulebook's chapters change, and no paragraph moves");
A("the changelog is untouched (the flip commit writes its own entry)", JSON.stringify(rbB.changelog) === JSON.stringify(rbA.changelog));
const strip = (C) => JSON.stringify(Object.assign({}, C, { rulebook: { changelog: C.rulebook.changelog } }));
A("nothing outside the rulebook changes", strip(before.CONTENT) === strip(after.CONTENT));
A("the same sections, in the same order", secsB.map((s) => s.id).join() === secsA.map((s) => s.id).join());
A("every section keeps its paragraph count and its full count, so tests that read by index still line up",
  secsB.every((s, i) => s.paragraphs.length === secsA[i].paragraphs.length && (s.full || []).length === (secsA[i].full || []).length));

const books = { basic: after.rulebookForFormat(rbA, "basic"), full: after.rulebookForFormat(rbA, "full") };
const bound = (book, id) => (book.chapters.filter((c) => !c.shelved).flatMap((c) => c.sections).find((s) => s.id === id) || { paragraphs: [] }).paragraphs.join(" ");

console.log("\n# every edit is in force where it binds, and the text it replaces is gone");
spec.edits.forEach((e) => {
  /* paragraphs bind in the basic format (the league's format), and in the full format too where the section has no full
     text; a full array binds in the full format */
  const fmts = e.field === "full" ? ["full"] : sec(secsA, e.id).full ? ["basic"] : ["basic", "full"];
  fmts.forEach((fmt) => {
    const text = bound(books[fmt], e.id);
    A(fmt + ": Rule " + e.id + " says \"" + e.new.slice(0, 70) + "\"", text.indexOf(e.new) >= 0);
    if (!e.new.includes(e.old)) A(fmt + ": Rule " + e.id + " no longer says \"" + e.old.slice(0, 70) + "\"", text.indexOf(e.old) < 0);
  });
});

console.log("\n# the held phrases arrive with the flip, in both formats");
for (const f of Object.keys(books)) {
  const inForce = JSON.stringify(books[f].chapters.filter((c) => !c.shelved));
  spec.held.forEach((t) => A(f + ": in force: \"" + t + "\"", inForce.indexOf(t) >= 0));
}

console.log("\n# no department-era phrase is left anywhere in the book, Appendix A included");
for (const f of Object.keys(books)) {
  let whole = JSON.stringify(books[f].chapters);
  spec.held.forEach((t) => { whole = whole.split(t).join(""); });   // "with no departments" is the new rule itself
  spec.stale.forEach((t) => A(f + ": nowhere: \"" + t + "\"", whole.toLowerCase().indexOf(t.toLowerCase()) < 0));
}

console.log("\n# the rulings the text must carry (the staffing drafts at db/s2-committees 3c7e23d), in both formats");
for (const f of Object.keys(books)) {
const b = (id) => bound(books[f], id);
A(f + ": Rule 7.2: only a committee manager or a commissioner suspends", /Only a committee manager \(Rule S2\.8\) or a commissioner may issue a suspension\./.test(b("7.2")));
A(f + ": Rule 7.2: eighteen games in steps of three, or fourteen days from the start", /steps of three \(3\), from three \(3\) to eighteen \(18\) games, and a member who holds no roster spot to a date no more than fourteen \(14\) days from the start of the suspension/.test(b("7.2")));
A(f + ": Rule 7.2: anything longer, and every suspension for the rest of a season, is a commissioner's or waits for one", /A longer suspension, and any suspension for the remainder of a season other than under paragraph 7 of this rule, is imposed by a commissioner, or is applied for by a suspension request and takes effect only when a commissioner approves it\./.test(b("7.2")));
A(f + ": Rule 7.2: other staff file a suspension request", /files a suspension request stating its grounds/.test(b("7.2")));
A(f + ": Rule 7.2: an approved request imposes exactly what was approved", /An approved request imposes exactly the suspension approved/.test(b("7.2")));
/* staff powers draft: _issue_suspension refuses a manager's second suspension unless p_keep_length; a commissioner's still
   defaults to the rest of the season */
A(f + ": Rule 7.2: a committee manager's second suspension keeps its length or goes to a commissioner for the rest of the season",
  /A committee manager imposing a second suspension in a season must set its length within the limits of paragraph 1 of this rule, or file a suspension request for the remainder of the season, which only a commissioner may approve; a commissioner's second suspension runs for the remainder of the season unless the commissioner sets a shorter length\./.test(b("7.2")));
/* staff powers draft: a request against a member serving a suspension is an extension in its own terms, with a written
   reason; approval extends the running one; a manager approves within 18 games or 14 days from the day it was issued */
A(f + ": Rule 7.2: an extension is in the suspension's own terms, games in steps of three or a later last day",
  /extending it, in the suspension's own terms: games added in steps of three \(3\) to a suspension counted in games, or a later last day for a suspension to a date\./.test(b("7.2")));
A(f + ": Rule 7.2: a committee manager extends to eighteen games, or fourteen days from the day it was issued; past that, a commissioner",
  /A committee manager may extend a suspension to a total of eighteen \(18\) games, or to a last day no more than fourteen \(14\) days from the day the suspension was issued; an extension past those limits is made only by a commissioner\./.test(b("7.2")));
A(f + ": Rule 7.2: a request against a member already suspended asks to extend it, with a written reason, and approval extends the running one",
  /A suspension request filed against a member who is serving a suspension is a request to extend it: it states in writing why the suspension should be extended, the member is told that reason, and its approval extends the running suspension by exactly the games or days approved\. A committee manager may approve such a request only within those limits; past them, only a commissioner may\./.test(b("7.2")));
A(f + ": Rule 7.2: a suspension for the rest of a season has nothing to extend", /A member serving a suspension for the remainder of a season has none to extend, and a commissioner rules on further misconduct\./.test(b("7.2")));
A(f + ": Rules 7.2 and 7.7: bans stay a commissioner's alone", /An expulsion, and any sanction against a commissioner or a member of league staff, are imposed only by a commissioner\./.test(b("7.2")) && /an expulsion from the league, and any sanction against a commissioner or a member of league staff, are imposed only by a commissioner/.test(b("7.7")));
A(f + ": Rule 7.6: a committee manager or a commissioner decides an appeal", /An appeal is decided by a committee manager \(Rule S2\.8\) or a commissioner;/.test(b("7.6")));
/* staff powers draft: guard_appeal_decider sends an appeal by, or about, a staffer or a commissioner to a commissioner */
A(f + ": Rule 7.6: an appeal by or about league staff or a commissioner is a commissioner's alone",
  /an appeal made by a member of league staff or a commissioner, or against a sanction imposed on one, is decided only by a commissioner\./.test(b("7.6"))
  && b("7.6").indexOf("an appeal by a member of league staff is decided by a commissioner.") < 0);
}
const b = (id) => bound(books.basic, id);
A("Rule 2.6: every staff member and every commissioner votes, more than half decides, banned and staff-suspended members excluded",
  /decided by a vote of every member of league staff and every commissioner, each vote counting the same; a member who is banned, or suspended from staff duties, does not vote and is not counted\. The application is approved once more than half of all of them approve it/.test(b("2.6")));
A("Rule S2.8: one staff group, one staff notifications channel, the manager powers", /The league staff is one group, with no departments/.test(b("S2.8")) && /goes to one staff notifications channel/.test(b("S2.8")) && /save that a committee manager may issue a suspension within the limits of Rule 7\.2/.test(b("S2.8")));
A("Rule S2.8: the committee list and the seat vote are unchanged (the v4.59 pins)",
  b("S2.8").indexOf("Season 2 has six (6) staff committees: Officiating; Statistics and imports; Applications; Community; Transactions; and Draft and Bidding.") >= 0
  && b("S2.8").indexOf("it is approved once more than half of all league staff and commissioners approve it") >= 0);
A("Rule 7.7: no thirty-day ceiling, no community-only suspension", !/thirty \(30\)|community suspension/i.test(b("7.7")));

console.log("\n# the register");
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]| - ");
spec.edits.forEach((e, i) => {
  A("edit " + (i + 1) + " (Rule " + e.id + "): no dash as punctuation, no gendered pronoun, American spelling, no version number",
    !DASHES.test(e.new) && !/\b(he|his|him|she|her|hers)\b/i.test(e.new) && !/defence|centre|cancelled|colour|honour|prioritis|organis|licence/i.test(e.new) && !/\bv?\d+\.\d\d\b/.test(e.new));
});
A("the limits are written as the book writes figures: fourteen (14) days, eighteen (18) games, never a bare numeral",
  spec.edits.every((e) => !/(^|[^(])\b\d+ (days?|games?)\b/.test(e.new)));

console.log("\n# a drifted book stops the splice, and nothing is written");
const drifted = source.split(JSON.stringify(spec.edits[0].old).slice(1, -1)).join("a sentence someone changed;");
let threw = "";
try { splice(drifted, spec); } catch (err) { threw = err.message; }
A("the splice throws when an anchor no longer matches", /the splice stopped, nothing written/.test(threw) || source === once, threw);
const dfile = path.join(tmp, "drifted.js");
fs.writeFileSync(dfile, drifted);
const r3 = cp.spawnSync(process.execPath, [path.join(__dirname, "s2-rulebook-splice.cjs"), dfile], { encoding: "utf8" });
A("the CLI exits 1 on a drifted book and leaves it as it was", (r3.status === 1 && fs.readFileSync(dfile, "utf8") === drifted) || source === once, r3.status + " " + r3.stderr);
const dup = JSON.parse(JSON.stringify(spec)); dup.edits.push(Object.assign({}, dup.edits.find((e) => e.id === "2.3" && e.old === "the department acts promptly or not at all." && e.field === "paragraphs"), { field: "paragraphs", id: "2.4" }));
let threw2 = "";
try { splice(source, dup); } catch (err) { threw2 = err.message; }
A("an edit aimed at a section that lacks its text stops the splice", /matched 0 times/.test(threw2) || source === once, threw2);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
