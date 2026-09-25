/* v3.27 — losing a front-office seat costs the seat, not the roster spot.
 *
 * Commissioner, 2026-09-25: "If a member of management is removed by their owner, that player should
 * not be demoted on the roster, but only of their management duties. They shall assume a league
 * minimum salary OR if they were in a management position that has a salary, they retain that
 * number."
 *
 * The behavior is a database function, rehearsed against the live schema and rolled back. This file
 * holds the client copy, the published rule, and the decision record.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 240))); }
}
const live = R("src/live/part_live.js"), rec = R("sql/2026-09-25-seat-ends-not-the-spot.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const content = R("src/live/part3_content.js");
const rb = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).rulebook;
const sec = (id) => { for (const c of rb.chapters) for (const s of c.sections) if (s.id === id) return s.paragraphs.join(" "); return ""; };

console.log("\n— the published rule now says what happens when a seat is vacated");
{
  const r26 = sec("2.6");
  A("it keeps the roster spot", /the person keeps his roster spot with that club/.test(r26));
  A("...and says what that rules out", /not waived, not moved to the training camp, and not returned to any pool/.test(r26));
  A("...including the position and the number", /the same position and the same number he held the moment before/.test(r26));
  A("the salary rule is stated as the commissioner gave it",
    /cap hit becomes the league minimum, unless the seat he held carried a higher figure, in which case he retains that figure/.test(r26));
  A("...with both cases worked", /Assistant General Manager keeps his \$2,000,000/.test(r26) && /Owner or General Manager, whose seats count \$0, takes the league minimum/.test(r26));
  A("...and the earned-salary case", /A player who earned a larger salary before taking the seat keeps that salary/.test(r26));
  A("the trade and waiver protection ends with the role", /he may be waived or traded like any other player/.test(r26));
}

console.log("\n— the Owner's confirmation says the same thing");
{
  A("it tells the Owner the player keeps his spot",
    /keeps his roster spot with the club, at the same position and the same number/.test(live));
  A("...and what happens to the money", /his cap hit becomes the league minimum unless the seat he held paid more/.test(live));
  A("it no longer claims the management contract simply ends",
    !/their management contract ends with it/.test(live));
  /* the same falsehood v3.26 took out of Chapter 0 was sitting in this dialog */
  A("it no longer claims the draft needs all three seats",
    !/every club must hold all three seats before the entry draft begins/.test(live)
    && !/the draft will not start while a seat is empty/.test(live));
  A("...and states the real requirement", /only the Owner and GM seats are needed before the draft/.test(live));
}

console.log("\n— the record");
{
  A("it quotes the instruction", /should not be demoted on the roster, but only of their management duties/.test(flat));
  A("it names the DELETE as the cause, not the status change", /THE DELETE WAS/.test(flat));
  A("...and quotes the predicate that made it dangerous",
    /not exists \(select 1 from public\.roster_spots rs where rs\.season_id = \.\.\. and rs\.profile_id = \.\.\.\)/.test(flat));
  A("the two-minute timeline is on the record", /14:22:06/.test(flat) && /14:24:00/.test(flat) && /Two minutes from removed to another club's training camp/.test(flat));
  A("greatest() is explained as the rule itself", /greatest\(\) IS the commissioner's sentence in one expression/.test(flat));
  A("...with all three cases", /greatest\(0, 750000\)/.test(flat) && /greatest\(2000000, 750000\)/.test(flat) && /keeps what he earned/.test(flat));
  A("the salary guard trap is recorded", /block_noncommish_salary\(\) refuses any salary change by a non commissioner/.test(flat));
  A("...including why the AGM case passed silently", /greatest\(2000000, 750000\) changes nothing/.test(flat));
  A("the contract handling is justified", /expiring his would have left him rostered with none/.test(flat));
  A("the reversal is recorded with its end state", /NYI \/ pro \/ C \/ #2 \/ \$2M/.test(flat));
  A("...and why the Detroit contract had to go first", /an expired Detroit row would have been newer/.test(flat));
  A("...and that the removal itself still stands", /it is the demotion that was undone, not the removal/.test(flat));
  A("what was NOT reversed is named, with the reason", /NOT REVERSED/.test(flat) && /Toine and HAGERS/.test(flat)
    && /landed back on their OWN club rather than another one/.test(flat));
  A("...and left as the commissioner's decision", /it is the commissioner's/.test(flat));
  A("the gap the old code complained about is closed", /Rule 2\.6 does not say what his salary becomes/.test(flat));
  A("no em dash or spaced hyphen in the record", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
