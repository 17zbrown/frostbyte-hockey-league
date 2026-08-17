/* The playoff bracket shape, for every qualifier count the setting allows.
   Run: node tools/playoff-shape.test.cjs

   Why this file exists: the qualifier count used to be a constant, and the round-1 pairing was
   written as seedCodes[b] vs seedCodes[b+3] — correct for four per division and silently wrong
   for anything else (3 reached into the next division's block, 2 built a series against undefined).
   Now the shape is derived, so every allowed value has to produce a bracket that actually closes:
   every qualifier accounted for in each round, and exactly one champion at the end. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part_live.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, parseInt, Error };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.CG = { DIVISIONS: ["East", "West"], _siteCfg: {} };
ctx.esc = (v) => String(v);
vm.createContext(ctx);
/* the default is a plain assignment, not a function — playoffPerDiv falls back to it, so without
   this the fallback tests measure an undefined and pass for the wrong reason */
{
  const d = src.match(/CG\.PLAYOFF_PER_DIV_DEFAULT = \d+;/);
  if (!d) { A("located CG.PLAYOFF_PER_DIV_DEFAULT", false); process.exit(1); }
  vm.runInContext(d[0], ctx);
}
for (const name of ["playoffDivisions", "playoffPerDiv", "playoffSeeds", "playoffFieldSize",
                    "playoffRound1", "playoffRounds", "playoffBracketBlurb", "playoffRoundName"]) {
  const m = src.match(new RegExp("CG\\." + name + " = function[\\s\\S]*?\\n\\};"));
  if (!m) { A("located CG." + name, false); process.exit(1); }
  vm.runInContext(m[0], ctx);
}
const CG = ctx.CG;
const setPer = (n) => { CG._siteCfg.playoff_format = { perDiv: n }; };

console.log("— the setting is read, and nonsense falls back to four");
{
  setPer(2); A("a valid setting is used", CG.playoffPerDiv() === 2);
  CG._siteCfg.playoff_format = {}; A("unset falls back to 4", CG.playoffPerDiv() === 4);
  CG._siteCfg.playoff_format = { perDiv: 0 }; A("zero falls back", CG.playoffPerDiv() === 4);
  CG._siteCfg.playoff_format = { perDiv: 99 }; A("out of range falls back", CG.playoffPerDiv() === 4);
  CG._siteCfg.playoff_format = { perDiv: "3" }; A("a string setting still parses", CG.playoffPerDiv() === 3);
}

console.log("\n— round 1 inside one division, for every allowed count");
{
  const shape = (n) => {
    const seeds = []; for (let i = 1; i <= n; i++) seeds.push(i);
    const r = CG.playoffRound1(seeds);
    return { pairs: r.pairs.map((p) => p.join("v")).join(" "), byes: r.byes.join(",") };
  };
  A("1 → nobody plays, the lone seed advances", shape(1).pairs === "" && shape(1).byes === "1");
  A("2 → 1v2, no byes",                          shape(2).pairs === "1v2" && shape(2).byes === "");
  A("3 → play-in 2v3, seed 1 waits",             shape(3).pairs === "2v3" && shape(3).byes === "1");
  A("4 → 1v4 and 2v3, no byes",                  shape(4).pairs === "1v4 2v3" && shape(4).byes === "");
  A("5 → play-in 4v5, top three wait",           shape(5).pairs === "4v5" && shape(5).byes === "1,2,3");
  A("6 → 3v6 and 4v5, seeds 1-2 wait",           shape(6).pairs === "3v6 4v5" && shape(6).byes === "1,2");
  A("7 → 2v7, 3v6, 4v5, seed 1 waits",           shape(7).pairs === "2v7 3v6 4v5" && shape(7).byes === "1");
  A("8 → a full first round",                    shape(8).pairs === "1v8 2v7 3v6 4v5" && shape(8).byes === "");

  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const seeds = []; for (let i = 1; i <= n; i++) seeds.push(i);
    const r = CG.playoffRound1(seeds);
    const seen = r.byes.concat(...r.pairs).sort((a, b) => a - b);
    A(`  ${n}: every qualifier is either playing or waiting, none twice`,
      seen.length === n && seen.every((v, i) => v === i + 1));
    const survivors = r.byes.length + r.pairs.length;
    const pow2 = survivors > 0 && (survivors & (survivors - 1)) === 0;
    A(`  ${n}: round 1 leaves a power of two, so no later round needs a bye`, pow2, `${survivors} survive`);
  }
}

console.log("\n— the bracket closes: rounds, names, field size");
{
  const expect = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 4, 8: 4 };
  for (const n of Object.keys(expect).map(Number)) {
    setPer(n);
    A(`top ${n}: ${expect[n]} round(s)`, CG.playoffRounds() === expect[n], String(CG.playoffRounds()));
    A(`  …field is ${2 * n} clubs`, CG.playoffFieldSize() === 2 * n);
    A(`  …last round is the Final`, CG.playoffRoundName(CG.playoffRounds()) === "Final");
    /* simulate the whole bracket: halve the survivors each round until one champion per division */
    let alive = CG.playoffRound1(Array.from({ length: n }, (_, i) => i + 1));
    let survivors = alive.byes.length + alive.pairs.length;
    let rounds = 1;
    while (survivors > 1) { survivors = survivors / 2; rounds++; }
    A(`  …one champion per division after ${rounds} divisional round(s), + the final`,
      rounds + 1 === CG.playoffRounds() || (n === 1 && CG.playoffRounds() === 1),
      `sim=${rounds + 1} cfg=${CG.playoffRounds()}`);
  }
  setPer(4);
  A("four names the middle round Division finals", CG.playoffRoundName(2) === "Division finals");
  A("...and opens with Division semi-finals", CG.playoffRoundName(1) === "Division semi-finals");
  setPer(2);
  A("two opens straight at Division finals", CG.playoffRoundName(1) === "Division finals");
}

console.log("\n— the panel's description is generated from the generator, so it cannot lie");
{
  setPer(6);
  const b = CG.playoffBracketBlurb();
  A("six describes its real pairings", /3v6 · 4v5/.test(b), b);
  A("...and names who sits out", /Seeds 1 and 2 sit out round 1/.test(b), b);
  setPer(4);
  A("four says nobody sits out", !/sit/.test(CG.playoffBracketBlurb()), CG.playoffBracketBlurb());
}

console.log("\n— the generator and the UI read the setting, not a constant");
{
  A("the old hardcoded constant is gone", !/CG\.PLAYOFF_PER_DIV\b(?!_DEFAULT)/.test(src));
  A("the b+3 pairing that only worked for four is gone", !/seedCodes\[b\+3\]/.test(src));
  A("round 1 is built by playoffRound1", /CG\.playoffRound1\(seedCodes\.slice/.test(src));
  A("the final is round K, not hardcoded 3", /if \(round === K\)/.test(src));
  A("round-1 byes rejoin in round 2", /if \(round === 2\) adv = adv\.concat\(round1Byes\(\)\)/.test(src));
  A("the setting merges instead of overwriting the series length",
    /Object\.assign\(\{\}, cur, \{ perDiv:n \}\)/.test(src) && /Object\.assign\(\{\}, cur0, \{ bestOf:n \}\)/.test(src));
  A("the panel warns that this is published law", /This is published law/.test(src));
  A("...and the control locks once the postseason starts", /data-perdiv[\s\S]{0,220}poLive/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
