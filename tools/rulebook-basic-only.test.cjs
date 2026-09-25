/* v3.26 — the published rulebook states the format in force, and states it correctly.
 *
 * Commissioner, 2026-09-25: "Make sure the rulebook shows only the current formatted rules since we
 * shelved the more detailed version with the preseason for now. Keep it in your back pocket though."
 *
 * A four-way audit of all 50 sections against public.format_rules('basic') found six places where
 * the book was FALSE as published, not merely out of format. Those are the assertions that matter
 * here: a rulebook that contradicts its own rules, or the code that enforces them, is worse than
 * one that carries a shelved paragraph.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 240))); }
}
const content = R("src/live/part3_content.js");
const rb = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).rulebook;
const find = (id) => { for (const c of rb.chapters) for (const s of c.sections) if (s.id === id) return s; return null; };
const sec = (id) => find(id).paragraphs.join(" ");
const all = rb.chapters.flatMap((c) => c.sections.flatMap((s) => s.paragraphs));

console.log("\n— six places the book was FALSE, not merely out of format");
{
  A("0.2 no longer requires all THREE seats to start the draft (Rule 2.8 and draft_management_gaps check two)",
    !/No club may draft until all three seats are held/.test(sec("0.2"))
    && /without an Owner or a General Manager/.test(sec("0.2"))
    && /Assistant General Manager's seat may be filled afterward/.test(sec("0.2")));
  A("...and 2.8, the rule it cites, still says the same thing",
    /must hold an Owner and a General Manager \(Rule 2\.6\) before the draft may begin/.test(sec("2.8")));

  A("0.5 no longer says the office drafts off a club's board when its clock expires",
    !/the league office selects the highest-ranked available player on that club's own board/.test(sec("0.5"))
    && /Nobody drafts for a club/.test(sec("0.5")) && /the selection is skipped/.test(sec("0.5")));
  A("...and 2.8 agrees", /the selection is skipped and no player is selected on the club's behalf/.test(sec("2.8")));

  A("0.6 no longer denies the first placement pass, which fills an ACTIVE roster",
    !/The active roster remains the players the club drafted and its management\./.test(sec("0.6"))
    && /onto its active roster rather than into its camp/.test(sec("0.6")));
  A("...and 2.8 describes that pass", /onto its active roster at the league minimum salary/.test(sec("2.8")));

  A("1.1 no longer sends a registration to a free agent pool the basic format does not have",
    !/assigned them to a club or to the free agent pool/.test(sec("1.1")));
  A("...and 2.2 still says there is no such market", /no free-agency period and no open market for player contracts/.test(sec("2.2")));

  A("2.6 no longer promises notices for a contract offer or a pre-season loan",
    !/a contract offer and its answer/.test(sec("2.6")) && !/pre-season loan/.test(sec("2.6")));
  A("...nor gates a contract extension that cannot be offered",
    !/a contract or extension offer/.test(sec("2.6")));
  A("...and 2.5 still says extensions do not exist here",
    /provides for no contract extension, no re-signing and no retained player rights/.test(sec("2.5")));

  A("6.2's double comma from the Rule 4.6 edit is gone", !/Rule 4\.6,,/.test(sec("6.2")));
}

console.log("\n— 2.1 states the shape that is actually in force");
{
  A("it leads with lines plus flex, the basic form",
    /The composition is published as a number of complete lines together with a number of additional players of any position/.test(sec("2.1")));
  A("...and no longer leads with the full format's per-group quota",
    !/composition by position group/.test(sec("2.1")));
  A("the quota form survives where it belongs, in the shelved twin",
    /seventeen \(17\) players/.test((find("2.1").full || []).join(" ")));
}

console.log("\n— the shelved model is described in the appendix, not inside the in-force text");
{
  A("0.4 no longer opens its rationale by describing the pre-season",
    !/A pre-season occupies two game-weeks/.test(sec("0.4")));
  A("0.6 no longer opens its rationale by describing a free-agency period",
    !/A free-agency period exists to price players/.test(sec("0.6")));
  A("0.1 still establishes the two formats and points at Appendix A, which is what makes the appendix legible",
    /one of two season formats/.test(sec("0.1")) && /preserved in Appendix A/.test(sec("0.1")));
  A("...without enumerating the shelved model's features in the binding text",
    !/a pre-season, a free-agency period, multi-season contracts/.test(sec("0.1")));
  /* the statements that REMAIN are all of the form "the basic format has no X", which is a rule,
     not a description of the other format, and a constitution should say what is not in force */
  A("what remains is the book saying what is NOT in force, which is proper",
    /The basic format has no pre-season/.test(sec("0.4"))
    && /The basic format has no free-agency period/.test(sec("0.6"))
    && /Draft picks are not tradeable assets in the basic format/.test(sec("2.3")));
}

console.log("\n— the appendix shelves only what DIFFERS");
{
  const pub2 = R("src/live/part5b_public2.js");
  A("rulebookForFormat filters the shelved copy against the in-force text",
    /var inForce = \{\};[\s\S]{0,200}var differs = other\.filter\(function\(t\)\{ return !inForce\[t\]; \}\);/.test(pub2));
  A("...and drops a section whose every paragraph matches", /if \(differs\.length\) shelved\.push\(/.test(pub2));

  /* run the real function: the appendix must not tell a member that the divisions are shelved */
  const CG = {};
  const c0 = pub2.indexOf("CG.rulebookForFormat = function");
  new Function("CG", pub2.slice(c0, pub2.indexOf("\nCG.ROUTES.rulebook", c0)))(CG);
  for (const fmt of ["basic", "full"]) {
    const book = CG.rulebookForFormat(rb, fmt);
    const ap = book.chapters.find((c) => c.num === "A");
    A(`${fmt}: the appendix exists and is marked not in force`, !!ap && ap.shelved === true);
    const dupes = [];
    ap.sections.forEach((s) => {
      const binding = find(s.of);
      const inForce = new Set(fmt === "full" && binding.full ? binding.full : binding.paragraphs);
      s.paragraphs.forEach((p) => { if (inForce.has(p)) dupes.push(s.id); });
    });
    A(`${fmt}: no in-force paragraph is reprinted under a "not in force" chip`, dupes.length === 0, dupes.join(", "));
  }
  const basic = CG.rulebookForFormat(rb, "basic");
  const a81 = basic.chapters.find((c) => c.num === "A").sections.find((s) => s.of === "8.1");
  A("Appendix A.8.1 no longer shelves the East and West divisions",
    !!a81 && !a81.paragraphs.some((p) => /East and West/.test(p)));
  A("...while the divisions are still stated in force", /East and West/.test(sec("8.1")));
}

console.log("\n— the forfeit ruling reached the shelved text too");
{
  A("the shelved 5.2 no longer carries the retired rule",
    !/A forfeited game counts toward these totals under Rule 3\.2 and cannot be undone/.test((find("5.2").full || []).join(" ")));
  A("...and carries the current one", /Ice time is the test/.test((find("5.2").full || []).join(" ")));
  A("the in-force 5.2 does too", /Ice time is the test/.test(sec("5.2")));
  A("Chapter 0 answers the question a member actually asks",
    /counts toward no player's weekly six on either club/.test(sec("0.7")));
}

console.log("\n— nothing in force names a shelved institution as if it existed");
{
  /* every surviving mention must be a denial ("has no", "not", "no club holds"), never an operative
     provision. A bare operative sentence about free agency or an extension would be a regression. */
  const bad = [];
  rb.chapters.forEach((c) => c.sections.forEach((s) => s.paragraphs.forEach((p, i) => {
    if (!/free[- ]agency period|contract extension|pre-season/i.test(p)) return;
    if (/\bno\b|\bnot\b|nothing/i.test(p)) return;          // a denial is fine
    bad.push(s.id + "[" + i + "]");
  })));
  A("no in-force paragraph asserts a shelved institution", bad.length === 0, bad.join(", "));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
