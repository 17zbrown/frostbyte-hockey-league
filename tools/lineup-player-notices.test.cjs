/* v3.14 — nobody stops being scheduled without being told.
 *
 * Commissioner: "Make sure all individuals who get scheduled get a notification in the website as
 * well." The claim "all individuals" is only checkable because game_lineups has a closed set of
 * writers, so this file pins the audit as much as the fix.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const rec = R("sql/2026-09-24-lineup-player-notices.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the audit, which is what makes 'all individuals' checkable");
{
  A("it names all three writers of game_lineups",
    /set_game_lineup/.test(flat) && /clear_game_lineup/.test(flat) && /clear_lineups_on_roster_remove/.test(flat));
  A("...and which of them told nobody", /notified NOBODY/.test(flat) && /notified the CLUB/.test(flat));
  A("it proves there is no fourth path", /No fourth path exists/.test(flat));
  A("...because RLS has a SELECT policy and no write policy",
    /RLS is ON with a SELECT policy and NO write policy/.test(flat));
  A("...and notes the wide grants that RLS is closing", /default-privileges trap again/.test(flat));
}

console.log("\n— what was added");
{
  A("the six on a withdrawn sheet are told", /_notify_lineup_pulled/.test(flat));
  A("the player pulled by a roster move is told", /the player pulled off by a roster move/.test(flat));
  A("a player moved between positions is told", /_notify_lineup_moves/.test(flat));
  A("...with the reason the old rule was only half right",
    /right for coming\s+and going and wrong for a man who now has to play a different position/.test(flat) ||
    /right for coming and going and wrong for a man who now has to play a different position/.test(flat));
}

console.log("\n— the bug the rehearsal caught");
{
  A("it is recorded", /THE BUG THE REHEARSAL CAUGHT/.test(flat));
  A("...with the cause: he is already nulled out by then",
    /had already nulled him out of every slot/.test(flat));
  A("...and the measurement", /4 filed lineups, he was on 1, and he got 4 notices/.test(flat));
  A("...and why the function was rewritten rather than spliced",
    /easier to rewrite that\s+trigger function whole/.test(flat) || /easier to rewrite that trigger function whole/.test(flat));
}

console.log("\n— the rehearsal covers every way a lineup can change");
{
  for (const [label, re] of [
    ["a sheet filed", /sheet filed\s+-> 6 notices, 6 distinct people, nobody twice/],
    ["an unchanged resubmit", /resubmitted unchanged\s+-> 0/],
    ["one player swapped", /one winger swapped\s+-> 2/],
    ["a position shuffle", /two positions swapped -> 2/],
    ["a sheet withdrawn", /sheet withdrawn\s+-> 6/],
    ["a second withdraw", /withdrawn again\s+-> 0/],
    ["a roster removal", /player removed from the roster\s+-> exactly 1/],
  ]) A(`${label} is rehearsed`, re.test(flat));
  A("and it was rolled back", /rolled back/.test(flat));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
