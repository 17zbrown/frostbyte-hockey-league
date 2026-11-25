#!/usr/bin/env node
/* v5.00 swap, the staffing flip (stream h, 2026-11-24). Applies tools/s2-rulebook/rulebook-s2.json to a
   src/live/part3_content.js: the rulebook text that becomes true when the held staffing records (staff powers and
   all-staff voting, branch db/s2-committees) apply at the switch. Commissioner, 2026-10-19: "for Season 2, we will remove
   the different departments, and we will allow every staff member to be a part of one big group."

   RUN ONLY IN THE FLIP COMMIT (PLAN.md section 6, h: "the splice runs only in the flip commit"):
     node tools/s2-rulebook-splice.cjs [path/to/part3_content.js]     (default: src/live/part3_content.js)

   How: part3_content.js is one line, `CG.CONTENT = <canonical JSON>;` (JSON.stringify output, so re-serializing changes
   only what we edit). Each edit names a section id, a field (paragraphs or full) and an exact old substring. The old text
   must occur exactly once in that field, or the splice stops and writes nothing (fail loud: the book drifted since the
   JSON was written, so the edit must be re-anchored by hand). An edit whose new text is already there once, with the old
   text gone, is skipped, so running it twice changes nothing. The changelog is not touched: the flip commit adds its own
   entry (the JSON carries a draft as changelogDraft). */
"use strict";
const fs = require("fs"), path = require("path");

const PRE = "CG.CONTENT = ";
const count = (hay, needle) => hay.split(needle).length - 1;

function splice(text, spec) {
  if (!text.startsWith(PRE)) throw new Error("not a part3_content.js: it does not start with " + JSON.stringify(PRE));
  const end = text.lastIndexOf(";");
  const tail = text.slice(end);
  if (!/^;\s*$/.test(tail)) throw new Error("not a part3_content.js: it does not end with `;`");
  const body = text.slice(PRE.length, end);
  const content = JSON.parse(body);
  if (JSON.stringify(content) !== body) throw new Error("part3_content.js is not canonical JSON, so re-serializing it would change more than the edits");
  const secs = content.rulebook.chapters.flatMap((c) => c.sections || []);
  let applied = 0, skipped = 0;
  const errors = [];
  spec.edits.forEach((e, n) => {
    const where = "edit " + (n + 1) + " (Rule " + e.id + " " + e.field + ")";
    if (!e.old || !e.new || e.old === e.new) { errors.push(where + ": old and new must both be set and differ"); return; }
    if (e.field !== "paragraphs" && e.field !== "full") { errors.push(where + ": field must be paragraphs or full"); return; }
    const sec = secs.find((s) => s.id === e.id);
    if (!sec) { errors.push(where + ": no section " + e.id); return; }
    const arr = sec[e.field];
    if (!Array.isArray(arr)) { errors.push(where + ": section " + e.id + " has no " + e.field); return; }
    const joined = arr.join("\n");
    const nNew = count(joined, e.new), nOld = count(joined, e.old);
    /* already applied: the new text once, and the old text only inside it (an edit may extend a sentence) */
    if (nNew === 1 && nOld === (e.new.includes(e.old) ? 1 : 0)) { skipped++; return; }
    if (nOld !== 1) { errors.push(where + ": the old text matched " + nOld + " times (expected once): " + JSON.stringify(e.old.slice(0, 90))); return; }
    const i = arr.findIndex((p) => p.includes(e.old));
    arr[i] = arr[i].split(e.old).join(e.new);   // split/join: no `$` patterns in a replacement
    applied++;
  });
  if (errors.length) throw new Error("the splice stopped, nothing written:\n  " + errors.join("\n  "));
  return { text: PRE + JSON.stringify(content) + tail, applied, skipped };
}

module.exports = { splice, SPEC: path.join(__dirname, "s2-rulebook", "rulebook-s2.json") };

if (require.main === module) {
  const file = path.resolve(process.argv[2] || path.join(__dirname, "..", "src", "live", "part3_content.js"));
  const spec = JSON.parse(fs.readFileSync(module.exports.SPEC, "utf8"));
  try {
    const before = fs.readFileSync(file, "utf8");
    const r = splice(before, spec);
    if (r.text !== before) fs.writeFileSync(file, r.text);
    console.log("s2 rulebook splice: " + r.applied + " applied, " + r.skipped + " already in place, " + file);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
