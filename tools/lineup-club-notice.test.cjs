/* v3.13 — a club's own room hears when its lineup is set, changed or withdrawn.
 *
 * Commissioner: "send out notifications to each team's channel whenever their lineups are set and
 * edited if that happens?"
 *
 * Before this, set_game_lineup told the PLAYERS it dressed and _post_lock_notices told the
 * OPPONENT about a post-lock change. The club's own front office and room were told nothing.
 *
 * This file cannot reach the database, so it holds the decision record and the rehearsal.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const rec = R("sql/2026-09-24-lineup-club-notices.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the decision record");
{
  A("it quotes the instruction", /whenever their lineups\s+are set and edited/.test(flat) || /are set and edited/.test(flat));
  A("it says what already existed, so the new notice is not a duplicate",
    /told the PLAYERS it dressed/.test(flat) && /told the OPPONENT about a post-lock change/.test(flat));
  A("...and what was missing", /own front office and room were told nothing/.test(flat));
  A("it names both call sites", /set_game_lineup/.test(flat) && /clear_game_lineup/.test(flat));
}

console.log("\n— the bug the rehearsal caught before it shipped");
{
  A("the record names it", /THE BUG THE REHEARSAL CAUGHT/.test(flat));
  A("...that v_diff is only computed when locked",
    /computes v_diff ONLY inside `if v_locked then`/.test(flat));
  A("...so every ordinary pre-lock edit was silent",
    /0\s+for every ordinary pre-lock edit/.test(flat) || /is 0 for every ordinary pre-lock edit/.test(flat));
  A("...and that p_diff is now ignored on purpose", /p_diff is now ignored on purpose/.test(flat));
  A("the fix compares the sheet that was on file against the one that is",
    /from the sheet that WAS on file against the sheet that is on file now/.test(flat));
}

console.log("\n— what counts as an edit");
{
  A("the comparison is positional, not set-based", /POSITIONAL, not set-based/.test(flat));
  A("...so a shuffle of the same six is still an edit to the club",
    /The same six, moved between positions/.test(flat));
  A("...while a save that moved nobody stays silent", /still says nothing/.test(flat));
  A("withdrawing an empty sheet says nothing", /withdrawing an EMPTY sheet says nothing/.test(flat));
  A("the sheet prints in rink order", /rink order, LW C RW LD RD G/.test(flat));
  A("a routine filing does not ping anyone", /No role ping/.test(flat));
}

console.log("\n— the rehearsal, with its numbers");
{
  A("five calls, three notices", /Five calls,\s+three notices/.test(flat) || /Five calls, three notices/.test(flat));
  A("the set notice is quoted", /Lineup set vs PIT/.test(flat));
  A("the change notice is quoted", /Out All Of Toxic, in CorRye/.test(flat));
  A("the withdraw notice is quoted", /Lineup withdrawn vs PIT/.test(flat));
  A("...and both silent cases are recorded", (flat.match(/-> silent/g) || []).length === 2,
    String((flat.match(/-> silent/g) || []).length));
  A("it was rolled back", /rolled back/.test(flat));
}

console.log("\n— the created_at trap");
{
  A("recorded, because it made a correct notice look wrong",
    /share created_at, because now\(\) is the\s+transaction's start time/.test(flat) ||
    /share created_at, because now\(\) is the transaction's start time/.test(flat));
  A("...with the remedy", /Order by ctid instead/.test(flat));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
