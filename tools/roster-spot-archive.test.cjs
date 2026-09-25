/* v3.17 — a removed roster spot is kept, so a reinstatement is a lookup.
 *
 * Written after three Utah waivers had to be reversed by reconstructing position, salary, jersey,
 * squad and origin out of club notices, because roster_spots keeps none of it. One value was lost
 * for good in that exercise: a jersey number nothing had ever recorded.
 *
 * The behaviour is in SQL and unreachable from here, so this pins the decision record.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const rec = R("sql/2026-09-25-roster-spot-archive.sql");
const prior = R("sql/2026-09-24-reverse-toine-waivers.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const pflat = prior.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— it exists because a real reversal was archaeology");
{
  A("the earlier reversal named the gap", /roster_spots is deleted outright on a waive/.test(pflat));
  A("...and asked for this table", /roster_spots should have one too/.test(pflat));
  A("this record points back at that", /had to be reversed by hand/.test(flat));
  A("...and names what was lost for good", /jersey number was never\s*written anywhere/.test(flat.replace(/\s+/g," ")));
  A("...and the precedent it follows", /season_registrations has had an\s*archive table/.test(flat.replace(/\s+/g," ")));
}

console.log("\n— every removal is captured, not just the polite ones");
{
  A("an AFTER DELETE FOR EACH ROW trigger", /AFTER DELETE FOR EACH ROW trigger/.test(flat));
  A("...so no caller has to remember", /Nothing has to remember to call it/.test(flat));
  A("the reason rides on the existing GUC", /app\.roster_reason/.test(flat));
  A("...and all three writers are named",
    /waive_player/.test(flat) && /admin_remove_from_roster/.test(flat) && /departure sweep/.test(flat));
  A("a removal with NO reason is still archived", /is still\s*archived, unlabelled/.test(flat.replace(/\s+/g," ")));
  A("...and why that one matters most", /unexplained removal is the one most worth having/.test(flat));
}

console.log("\n— the three guards the reinstatement has to answer");
{
  A("one contract, the most recent", /Revive exactly ONE/.test(flat));
  A("...or the unique index rejects the lot", /rejects the lot/.test(flat));
  A("the real original origin, not a made-up one", /'reinstated' is not an allowed/.test(flat));
  A("...because inventing one would misstate how he arrived", /lie about how he arrived/.test(flat));
  A("depth_random is forced to camp unconditionally", /forces a depth_random origin into camp UNCONDITIONALLY/.test(flat));
  A("...so an active-roster player is promoted back", /promotion is replayed as an UPDATE/.test(flat));
}

console.log("\n— it refuses the cases that would corrupt a roster");
{
  A("a removal cannot be reinstated twice", /refuses a removal that was already reinstated/.test(flat));
  A("a player already on a roster is refused", /refuses if he is on a roster again/.test(flat));
  A("and it fails loud on the wrong squad", /fails\s*loud if he does not end up on the squad/.test(flat.replace(/\s+/g," ")));
}

console.log("\n— the rehearsal");
{
  A("a real player was removed and put back", /Ciznasty, C #7/.test(flat));
  A("...and came back identical", /every field came back IDENTICAL/.test(flat));
  A("...with his contract active again", /contract went back to active/.test(flat));
  A("...a second reinstatement refused", /second reinstatement of the same removal was refused/.test(flat));
  A("...and a camp player came back to CAMP", /came back to CAMP, not the active roster/.test(flat));
  A("it was rolled back", /rolled back/.test(flat));
}

console.log("\n— the enum choice is explained, not incidental");
{
  A("status archived as text", /status is archived as TEXT/.test(flat));
  A("...with the reason", /must not make an old archive row unreadable/.test(flat));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
