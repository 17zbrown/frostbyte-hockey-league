/* v3.16 — a late sign-up is placed by a straight draw, not by who is thinnest.
 *
 * Commissioner: "make the RA completely random. Remove the line for roster count entirely unless
 * the team has zero TC players."
 *
 * The behaviour lives in a SQL function this file cannot reach, so it pins the decision record and
 * the measurements. The draw itself was simulated against the real rosters before shipping.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 200))); }
}
const rec = R("sql/2026-09-24-random-depth-assignment.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the decision record");
{
  A("it quotes the instruction", /Remove the line for roster count entirely unless/.test(flat));
  A("it explains what the old rule actually did", /ordered by\s*the club's active roster count ascending/.test(flat.replace(/\s+/g," ")));
  A("...and that the Dallas run was the rule working, not a bug",
    /which was the rule working exactly as written/.test(flat));
  A("...with the numbers that made it happen", /sat at 20\s*when everyone else was 21 or 22/.test(flat.replace(/\s+/g," ")));
}

console.log("\n— the new rule, and the one exception");
{
  A("a straight draw across all clubs", /A straight draw across all clubs/.test(flat));
  A("an empty training camp still jumps the queue", /TRAINING CAMP is empty is taken first/.test(flat));
  A("...and stops mattering once every camp has somebody",
    /that clause is false everywhere and the draw is pure random/.test(flat));
}

console.log("\n— the scope, which is the part most likely to be got wrong later");
{
  A("only the depth placement changed", /Only the depth placement/.test(flat));
  A("...named by the origin it branches on", /v_origin = 'depth_random'/.test(flat));
  A("the pre-season fill is untouched", /pre-season fill keeps its old behaviour/.test(flat));
  A("...with the reason it is a different job",
    /spread a whole registration\s*pool evenly across the league in one go/.test(flat.replace(/\s+/g," ")));
}

console.log("\n— measured, not argued");
{
  A("the simulation is recorded", /4,000 draws over 8 clubs/.test(flat));
  A("...with the spread observed", /Observed 471 to 540/.test(flat));
  A("...against a stated 3 sigma band", /3 sigma\s*for n=4000 is 437 to 563/.test(flat.replace(/\s+/g," ")));
  A("...and that the previously favoured club is no longer favoured", /Dallas drew 485, no longer/.test(flat));
  A("the exception was measured too", /took 2,000 of 2,000 draws/.test(flat));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
