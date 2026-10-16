/* v4.00 (2026-10-13). Commissioner, on KwikTripJesus (placed with 45 of Detroit's 54 games left, 16 x 45 / 54 = 13.33,
   which v3.94 rounded up to 14): "Round down at .4". Rehearsed on production rolled back, then applied: KwikTripJesus 13,
   Roadamerica04 15 (15.11), TBizzy_15 8 (8.30), LogicalSense1 15 (14.81) and i2sweat977760 12 (11.56) unchanged; the site's
   playoff_floors read 13 for KwikTripJesus. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-13-floor-rounding-v400.sql");
let fail = 0, n = 0;
const A = (name, cond) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name); } };

/* the rule itself, as the database applies it */
const round4 = (floor, left, total) => { const x = floor * left / total; return Math.min(floor, (x - Math.floor(x) > 0.4) ? Math.ceil(x) : Math.floor(x)); };
A("13.33 rounds down to 13 (KwikTripJesus)", round4(16, 45, 54) === 13);
A("15.11 rounds down to 15", round4(16, 51, 54) === 15);
A("8.30 rounds down to 8", round4(16, 28, 54) === 8);
A("14.81 rounds up to 15", round4(16, 50, 54) === 15);
A("11.56 rounds up to 12", round4(16, 39, 54) === 12);
A("a whole number stays put", round4(16, 27, 54) === 8);
A("never above the season's floor", round4(16, 54, 54) === 16);

console.log("— the database");
A("the share rounds to the nearest game, .4 or less down",
  /v_x := v_floor::numeric \* v_left \/ v_total;\n\s+return least\(v_floor, \(case when v_x - floor\(v_x\) > 0\.4 then ceil\(v_x\) else floor\(v_x\) end\)::int\);/.test(sql));
A("the old round-up anchor is replaced, not left beside it", /c text := '  return least\(v_floor, ceil\(v_floor::numeric \* v_left \/ v_total\)::int\);';/.test(sql) && /execute replace\(replace\(v_def, a, b\), c, d\);/.test(sql));
A("the migration checks KwikTripJesus reads 13", /public\.player_playoff_floor\(v_s, v_kw\) <> 13/.test(sql));

console.log("— the site");
const hub = R("src/live/part6_hub.js"), live = R("src/live/part_live.js");
A("the Road card's caption states the same rule and works its example with it",
  /rounded to the nearest game, a fraction of \.4 or less down: '\+CG\.roundFloorShare\(minGp\/2\)\+' with half the season left/.test(hub) &&
  !/Math\.ceil\(minGp\/2\)/.test(hub) && !/fractions round up/.test(hub));
A("the page's helper is the database's rule", /CG\.roundFloorShare = function\(x\)\{ var f = Math\.floor\(x\); return \(x - f > 0\.4\) \? Math\.ceil\(x\) : f; \};/.test(live));
{ const ctx = {}; vm.runInNewContext("var CG = {};" + live.match(/CG\.roundFloorShare = function[^\n]*/)[0] + " out = [CG.roundFloorShare(8), CG.roundFloorShare(8.5), CG.roundFloorShare(13.333), CG.roundFloorShare(14.815)];", ctx);
  A("...16/2 = 8, 17/2 = 8.5 -> 9, 13.33 -> 13, 14.81 -> 15", JSON.stringify(ctx.out) === "[8,9,13,15]"); }

console.log("— the rulebook and changelog");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, r83 = rb.chapters.flatMap((c) => c.sections || []).find((x) => x.id === "8.3").paragraphs[3];
A("Rule 8.3 states the rounding with both examples", /The result is rounded to the nearest game, with a fraction of four tenths or less rounded down and anything above it rounded up\./.test(r83) &&
  /needs thirteen \(13\), since the share is 13\.33/.test(r83) && /needs fifteen \(15\), since 14\.81 rounds up/.test(r83) && !/rounded up:/.test(r83));
const cl = rb.changelog.find((c) => c.version === "4.00");
A("changelog 4.00 is in the book", !!cl);
A("no em dash in what v4.00 wrote", !/—/.test(JSON.stringify(cl)) && !/—/.test(sql));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
