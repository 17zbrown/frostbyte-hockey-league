/* v5.00 swap (d, live-model): src/s2/js/cg-engine.js is the live engine copied by tools/s2-engine-build.cjs. This fails
   when the committed copy differs from a fresh build (a definition changed in src/live and the copy was not rebuilt), so
   the Season 2 site can never count standings or season lines differently from the current site.
   Fix a failure by running `node tools/s2-engine-build.cjs` and committing the result, never by editing the copy. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const { build, grab, OUT, PIECES } = require("./s2-engine-build.cjs");
let n = 0, fail = 0;
const A = (name, cond, info) => { n++; if (cond) console.log("PASS " + name); else { fail++; console.log("FAIL " + name + (info !== undefined ? " :: " + JSON.stringify(info).slice(0, 300) : "")); } };

console.log("— the copy is the live engine");
const fresh = build(), have = fs.readFileSync(OUT, "utf8");
let at = -1; if (fresh !== have) for (let i = 0; i < Math.max(fresh.length, have.length); i++) if (fresh[i] !== have[i]) { at = i; break; }
A("src/s2/js/cg-engine.js equals a fresh build from src/live (run node tools/s2-engine-build.cjs)", fresh === have,
  at < 0 ? undefined : { line: have.slice(0, at).split("\n").length, committed: have.slice(at, at + 80), fresh: fresh.slice(at, at + 80) });
const live = fs.readFileSync(path.join(__dirname, "../src/live/part2_engine.js"), "utf8");
A("every body is byte for byte its source (CG.aggregate)", have.indexOf(live.slice(live.indexOf("CG.aggregate = function"), live.indexOf("\n};", live.indexOf("CG.aggregate = function")) + 3)) > 0);

console.log("\n— it is a classic script with one global");
A("one function scope bound to S2.CG, strict, no second global", /^\(function \(\) \{\n"use strict";\nvar S2 = window\.S2 = window\.S2 \|\| \{\};\nvar CG = S2\.CG = \{\};\n/m.test(have) && /\n\}\)\(\);\n$/.test(have));
A("no let, const, class or arrow function at the top of the copy (ES5, as the live bundle)", !/^(let|const|class) /m.test(have));
A("no comment above a piece is copied (they name members); only the file markers sit above one", (have.match(/\*\/\nCG\./g) || []).length === PIECES.length && (have.match(/ ---------- \*\/\nCG\./g) || []).length === PIECES.length);

console.log("\n— the build refuses a missing or doubled anchor");
const throws = (f) => { try { f(); return false; } catch (e) { return true; } };
A("an anchor found twice throws", throws(() => grab("CG.x = 1;\nCG.x = 2;\n", "t.js", "x")));
A("an anchor not found throws", throws(() => grab("CG.y = 1;\n", "t.js", "x")));
A("a block with no closing line throws", throws(() => grab("CG.x = function(){\n  return 1;\n", "t.js", "x")));
A("a block that runs into the next definition throws", throws(() => grab("CG.x = function(){\nCG.y = 2;\n};\n", "t.js", "x")));
A("a one-line statement is one line", grab("CG.x = function(a){ return a; };\nCG.z = 3;\n", "t.js", "x") === "CG.x = function(a){ return a; };");

console.log("\n— the copy runs");
const ctx = { console, Intl, Date, Math, Object, Array, String, Number, JSON }; ctx.window = ctx; vm.createContext(ctx); vm.runInContext(have, ctx);
const CG = ctx.S2.CG;
A("it defines every piece it names, and nothing on window but S2", PIECES.every((p) => p[1].every((k) => CG[k] !== undefined)) && !("CG" in ctx));
/* Season 2 as ruled (v4.31): Dec 16, then the Christmas and New Year weeks skipped, then Jan 6 to Feb 3 */
const s2 = { skip_holidays: ["us-thanksgiving", "new-years-day", "easter", "canada-day", "independence-day", "christmas-eve", "christmas-day", "boxing-day", "new-years-eve"] };
const gn = CG.gameNights("2026-12-16", 6, 3, CG.seasonHolidayKeys(s2));
A("CG.gameNights lays Season 2 on Dec 16 and Jan 6 to Feb 3, two holiday weeks skipped", JSON.stringify(gn.nights.map((w) => w.wed)) === JSON.stringify(["2026-12-16", "2027-01-06", "2027-01-13", "2027-01-20", "2027-01-27", "2027-02-03"]) && gn.skipped.length === 2, gn.nights.map((w) => w.wed));
A("CG.etISO is Eastern across the change of clocks", CG.etISO("2026-12-16", "21:00") === "2026-12-17T02:00:00.000Z" && CG.etISO("2026-10-21", "21:00") === "2026-10-22T01:00:00.000Z");

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
