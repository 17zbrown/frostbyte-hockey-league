/* Rulebook v2.31 — one $250,000 salary lattice, and draft pay set by round.
   Run: node tools/salary-250k-lattice.test.cjs   (build index.html first)

   Owners voted this in ahead of the Season 1 draft. The claim lives in five places: the published
   rulebook, the two owners' briefings, the offer forms, the shared front-end predicate, and the
   database. This file covers the first four.

   WHAT THIS FILE DOES NOT COVER: the database half — legal_salary(), draft_round_salary(),
   draft_pick_salary() and the three patched pick writers — is the REAL enforcement and no
   assertion here touches it. There is no connection from CI and the SQL is not in this repo.
   That half was verified by rolled-back rehearsals against production (an off-lattice offer
   refused, an on-lattice one accepted, a round-one pick landing at $3,000,000 on both the roster
   spot and the contract, and all three pick writers confirmed to route through the one helper).
   If you change the SQL, re-run those rehearsals — this file will not catch you.

   The failure it guards against is the one v2.7 already caused once: a rule changed in the UI and
   left standing in the database, with the two disagreeing for a season. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const content = R("src/live/part3_content.js");
const live = R("src/live/part_live.js");
const engine = R("src/live/part2_engine.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n?$/)[1]).rulebook;
const sec = (id) => {
  for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" ");
  throw new Error("no section " + id);
};

/* the engine's salary helpers, evaluated on their own so the test exercises the real code */
const CG = {};
vm.runInNewContext(engine.slice(engine.indexOf("CG.CAP =")), { CG });

console.log("— the shared front-end predicate");
{
  A("the step is $250,000", CG.SALARY_STEP === 250000, String(CG.SALARY_STEP));
  A("the minimum is $750,000", CG.MIN_SALARY === 750000, String(CG.MIN_SALARY));
  A("$750K is legal", CG.salaryProblem(750000) === null);
  A("$1.25M is legal", CG.salaryProblem(1250000) === null);
  A("$3M is legal (management, and round one)", CG.salaryProblem(3000000) === null);
  A("$700K is refused — below the minimum", /minimum/i.test(CG.salaryProblem(700000) || ""));
  A("$800K is refused — the old $50K step is gone",
    /250|0\.25/.test(CG.salaryProblem(800000) || ""), CG.salaryProblem(800000));
  A("$1.1M is refused — the old $100K step is gone",
    /250|0\.25/.test(CG.salaryProblem(1100000) || ""), CG.salaryProblem(1100000));
  A("$1.85M is refused, and names both neighbours",
    /1\.75/.test(CG.salaryProblem(1850000) || "") && /2/.test(CG.salaryProblem(1850000) || ""),
    CG.salaryProblem(1850000));
  A("a non-number is refused rather than passed through",
    CG.salaryProblem(undefined) !== null && CG.salaryProblem(NaN) !== null);

  /* exhaustive: nothing off the lattice may pass, nothing on it may fail */
  let bad = 0, blocked = 0;
  for (let v = 750000; v <= 4000000; v += 50000) {
    const legal = v % 250000 === 0;
    const problem = CG.salaryProblem(v);
    if (legal && problem) bad++;
    if (!legal && !problem) blocked++;
  }
  A("every multiple of $250K from the minimum to $4M passes", bad === 0, bad + " wrongly refused");
  A("...and every $50K figure between them is refused", blocked === 0, blocked + " wrongly allowed");
}

console.log("— draft pay by round");
{
  const want = [3000000, 2750000, 2500000, 2250000, 2000000, 1750000, 1500000, 1250000, 1000000, 750000];
  const got = want.map((_, i) => CG.draftRoundSalary(i + 1, 10));
  A("R1–R10 run $3.0M down to $750K in $250K steps",
    JSON.stringify(got) === JSON.stringify(want), got.join(","));
  A("a full ten-round class costs $18.75M",
    got.reduce((s, v) => s + v, 0) === 18750000, String(got.reduce((s, v) => s + v, 0)));
  A("every round's pay is itself a legal salary", got.every((v) => CG.salaryProblem(v) === null));
  A("the last round always pays the minimum, whatever the round count",
    [6, 8, 10, 12].every((n) => CG.draftRoundSalary(n, n) === CG.MIN_SALARY));
  A("out-of-range rounds clamp rather than inventing a salary",
    CG.draftRoundSalary(0, 10) === 3000000 && CG.draftRoundSalary(99, 10) === 750000);
}

console.log("— the offer forms carry the lattice");
{
  A("no salary input still steps by $0.05", !/step="0\.05"/.test(live));
  const steps = (live.match(/id="(faSal|coSal|ocSal)" type="number" min="0\.75" step="0\.25"/g) || []).length;
  A("all three negotiation inputs step by $0.25", steps === 3, String(steps));
  const guards = (live.match(/CG\.salaryProblem\(Math\.round\(v\*1e6\)\)/g) || []).length;
  A("...and all three validate through the shared predicate", guards === 3, String(guards));
  A("no form still accepts anything at or above $0.75M unchecked", !/if\(!\(v>=0\.75\)\)/.test(live));
  A("the captions tell managers about the step",
    (live.match(/\$0\.25M steps \(Rule 2\.5\)/g) || []).length === 3);
  A("rookie bidding routes through the shared predicate, not its own copy of the lattice",
    /var bidBad = CG\.salaryProblem\(amt\)/.test(live) && !/\(amt-750000\)%250000!==0/.test(live));
  A("the draft room shows what the pick on the clock costs",
    (live.match(/CG\.draftRoundSalary\(onClock\.round, draftRounds\)/g) || []).length === 2);
  A("...sized from the board's own round count, not a hardcoded ten",
    /var draftRounds = \(cur && cur\.length\)/.test(live));
  A("the rejection message speaks in $M, matching the fields it corrects",
    /\$1\.75M/.test(CG.salaryProblem(1850000) || ""), CG.salaryProblem(1850000));
}

console.log("— the rulebook says the same thing");
{
  A("the changelog records v2.31", rb.changelog.some((c) => c.version === "2.31"));
  A("...and the newest entry sits first", rb.changelog[0].version >= "2.31", rb.changelog[0].version);
  A("...carrying dateIso like every other entry", rb.changelog.every((e) => !!e.dateIso));
  A("Rule 2.5 states the $250,000 lattice", /multiple of \$250,000/.test(sec("2.5")));
  A("...and still states the $750,000 minimum", /league minimum salary is \$750,000/.test(sec("2.5")));
  A("...and says an off-lattice figure is refused, not rounded",
    /refused where it is entered rather than quietly rounded/.test(sec("2.5")));
  A("Rule 2.8 pays by round, not by pick", /paid by the round in which he is selected/.test(sec("2.8")));
  {
    /* the prose spells all ten figures out by hand; check every one against the computed scale
       rather than spot-checking the ends, which is where a typo would hide */
    const words = ["one","two","three","four","five","six","seven","eight","nine","ten"];
    const text = sec("2.8");
    const missing = words.filter((w, i) =>
      !new RegExp("round " + w + " \\$" + CG.draftRoundSalary(i + 1, 10).toLocaleString("en-US")).test(text));
    A("...and all ten published round figures match the computed scale",
      missing.length === 0, "wrong or missing: " + missing.join(", "));
  }
  A("...states the scale follows the round count rather than assuming ten",
    /set by the number of rounds the commissioner calls/.test(sec("2.8")));
  A("...and covers a clock expiry, not just a club picking for itself",
    /clock expires and the league picks from its board/.test(sec("2.8")));
  A("...states every pick in a round costs the same",
    /identical cap hit/.test(sec("2.8")));
  A("...and prices the full class", /\$18,750,000/.test(sec("2.8")));
  A("Chapter 0.5 tells new members the draft pays by round", /set by the round he goes in/.test(sec("0.5")));
  A("rookie bidding still reads $250,000, unchanged and now consistent",
    /rise in \$250,000 increments/.test(sec("2.2")));
  A("no rulebook section still promises the old $100,000 step",
    !/\$100,000 increments/.test(rb.chapters.map((c) => c.sections.map((s) => s.paragraphs.join(" ")).join(" ")).join(" ")));
}

console.log("— the owners' briefings, the documents owners actually work from");
{
  /* these are the sweep surface a rule change is most often left out of: the rulebook moves and
     the briefing keeps telling owners the old thing. Both copies must carry both new rules. */
  for (const f of ["CGHL-Season1-Owners-Briefing.md", "CGHL-Season1-Owners-Briefing-DISCORD.txt"]) {
    const b = R(f);
    A(`${f}: states the $250,000 step`, /every salary in the league moves in \$250,000\s*steps/.test(b));
    A(`${f}: says an off-lattice figure is refused`, /refused when you type it/.test(b));
    A(`${f}: still states the $750,000 minimum`, /Minimum salary \$750,000/.test(b));
    A(`${f}: tells owners what a pick costs`, /round 10 pays the\s*\$750,000 league minimum/.test(b));
    A(`${f}: ...and that round 1 is $3,000,000`, /round 1 is \$3,000,000/.test(b));
    A(`${f}: ...and that a full class is $18,750,000`, /\$18,750,000/.test(b));
    A(`${f}: ...and that an expired clock signs at the same price`, /if your clock expires/.test(b));
  }
}

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
