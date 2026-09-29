/* v3.47 — harder to reach the 90s, especially 95+.
 *
 * The formula is in Postgres, so this pins the record and re-implements the published curve to check
 * its own arithmetic: continuity at the knee, a fixed ceiling, and monotonic compression above it.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const rec = R("sql/2026-09-26-harder-to-reach-the-nineties.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the curve's own arithmetic, from the formula as published in the record");
{
  const m = rec.match(/88 \+ \(raw-88\)\^([\d.]+) \/ 11\^([\d.]+)/);
  A("the record states the curve", !!m, (rec.match(/raw >  88.*/) || [])[0]);
  const p1 = m ? parseFloat(m[1]) : 0, p2 = m ? parseFloat(m[2]) : 0;
  const curve = (raw) => (raw <= 88 ? raw : 88 + Math.pow(raw - 88, p1) / Math.pow(11, p2));

  A("it is continuous at the knee", Math.abs(curve(88) - 88) < 1e-9, curve(88));
  A("...and approaching it from above", Math.abs(curve(88.0001) - 88) < 1e-3, curve(88.0001));
  A("the ceiling is fixed at 99", Math.abs(curve(99) - 99) < 1e-9, curve(99));
  A("below the knee nothing changes at all",
    [40, 60, 72, 85, 87.9].every((v) => curve(v) === v));
  A("above the knee every raw point is worth LESS than one",
    [89, 91, 94, 97].every((v) => curve(v) < v), [89, 91, 94, 97].map(curve).map((x) => x.toFixed(2)).join(","));
  A("...and it is still monotonic, so better play never lowers a rating",
    (function () { for (let v = 88; v <= 99; v += 0.25) if (curve(v) >= curve(v + 0.25)) return false; return true; })());
  A("...and it gets progressively harder: the last point costs more than the first",
    (curve(99) - curve(98)) > (curve(89) - curve(88)), ((curve(99) - curve(98)) / (curve(89) - curve(88))).toFixed(2) + "x");
  A("a raw 93 lands in the low 90s", Math.round(curve(93)) === 91, curve(93).toFixed(2));
  A("a raw 96 is needed for a 95", Math.round(curve(96)) === 95, curve(96).toFixed(2));
  A("...so 95 now costs what 96 used to", curve(95) < 95);
}

console.log("\n— it was measured before it was changed");
{
  A("it quotes the instruction", /lets adjust the difficulty to reach the 90 overall score especially 95/.test(flat));
  A("the before state is recorded", /Three at 90 or above, two at 95 or above, and all three were goalies/.test(flat));
  A("...with the actual lines", /\.952 SV%, 1\.00 GAA/.test(flat) && /\.885 SV%, 2\.00 GAA/.test(flat));
  A("...and the diagnosis", /held a PERFECT component score: 100 on all four/.test(flat));
  A("the after state is recorded", /at 90 or above\s+3\s+->\s+1/.test(flat) && /at 95 or above\s+2\s+->\s+0/.test(flat));
  A("...including what did NOT move", /league average\s+72\.6 -> 72\.6/.test(flat) && /The bottom of the league did not move one point/.test(flat));
  A("...and how few players were touched", /12 of 75/.test(flat));
}

console.log("\n— the anchors, and the one left alone");
{
  A("save % anchor", /save %\s+\.920 was a perfect score\s+->\s+\.950/.test(flat));
  A("GAA anchor", /GAA\s+2\.00 was a perfect score\s+->\s+1\.20/.test(flat));
  A("shutout anchor", /shutouts\s+0\.30 per game was perfect\s+->\s+0\.50/.test(flat));
  A("the breakaway sample guard", /under five attempts it reads neutral/.test(flat));
  A("...and why it mattered most", /faced two breakaways and stopped both took the whole 12% weight at 100/.test(flat));
  A("skater anchors were deliberately untouched", /The skater anchors were NOT touched/.test(flat));
  A("...with the reason", /punished the wrong players for a problem they did not cause/.test(flat));
}

console.log("\n— the silent-revert trap");
{
  A("the false success is recorded", /reported "104 refreshed" and changed NOTHING/.test(flat));
  A("the guard is named", /guard_profile_role/.test(flat));
  A("...and what it reverts", /silently reverts overall \(and role, banned, departments, in_guild, discord_id\)/.test(flat));
  A("...and the cause", /had never set request\.jwt\.claims/.test(flat));
  A("the fix asserts on rows that moved", /counts rows whose value actually moved, raising if that count is zero/.test(flat));
  A("...with the lesson stated", /Count what changed, never what you attempted/.test(flat));
}

console.log("\n— no rulebook change, and it was checked");
{
  const rb = JSON.parse((function(){ const c = R("src/live/part3_content.js"); return c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1); })()).rulebook;
  const all = rb.chapters.flatMap((c) => c.sections.flatMap((s) => s.paragraphs)).join("\n");
  A("the book says ratings come from regular-season play", /Overall ratings are compiled from regular-season play/.test(all));
  A("...and never states the formula", !/0\.59/.test(all) && !/save percentage of \./.test(all));
  A("the record says it checked", /NO RULEBOOK CHANGE, AND THAT WAS CHECKED/.test(flat));
  A("the client carries no twin", /The client carries no twin of the formula either/.test(flat));
  /* superseded by v3.49 (five games) and again by v3.74 (six games at a position) */
  A("...and the client copy of the day is true (v3.74: six games at a position)",
    /A rating is held toward 70 until a player’s sixth game at a position/.test(R("src/live/part_live.js")));
  A("the changelog records it", rb.changelog.some((e) => e.version === "3.47"));
  A("no em dash or spaced hyphen", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
