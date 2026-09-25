/* v3.19 — the box score names the commissioner fixed were linked, and a ruling on an unrostered
 * player now has somewhere to live.
 *
 * Commissioner, 2026-09-25: "I believe I fixed all the missing box score gamertags. Please link and
 * cross check with roster vs tc and positioning rules and such."
 *
 * This file cannot reach the database. It holds the two things the repo owns: the decision record,
 * and the live import code whose matching rule the manual pass had to copy.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}

const rec = R("sql/2026-09-25-link-box-scores-and-cross-check.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the six links, each named with its member and its persona");
{
  for (const [box, member, persona] of [
    ["LSF_Chunkydunks", "Chunkydunks21", "1825808738"],
    ["BeLchy01", "Reno Garden Shed", "1884272681"],
    ["KrautKillaKody", "cako", "311682661"],
    ["Masterpip16", "Pip", "1873861402"],
    ["I Cashout X", "oKniesy", "1874324022"],
    ["Scorezeaux", "Scorezov", "306408512"],
  ]) {
    A(`${box} -> ${member}`, flat.includes(box) && flat.includes(member) && flat.includes(persona));
  }
  A("the count reconciles: 13 unmatched, 12 resolved", /13 of 241 rows carried no member; 12 now resolve/.test(flat));
  A("each link was checked four ways, not one", /exactly one candidate, on the club the row was recorded for, on that club's ACTIVE roster, and in the position group he played/.test(flat));
  A("ambiguity means nobody", /Two candidates is nobody/.test(flat));
}

console.log("\n— the underscore blind spot is recorded as the reason for lower(), not ilike");
{
  A("the record names the rule", /deliberately NOT ilike/.test(flat));
  A("...and says what an underscore means in a LIKE pattern",
    /an underscore is a single-character wildcard/.test(flat));
  A("...with the concrete wrong match it would have allowed", /LSFxChunkydunks/.test(flat));
  A("...and credits where the same blind spot was first hit", /Same blind spot recorded in v3\.00/.test(flat));
}

console.log("\n— the live import escapes it, so this stayed a hand-written-SQL problem");
{
  const ing = R("netlify/functions/ingest-stats.js");
  A("likeSafe escapes backslash, percent AND underscore",
    /const likeSafe = \(v\) => v\.replace\(\/\(\[\\\\%_\]\)\/g, "\\\\\$1"\);/.test(ing),
    (ing.split("\n").find((l) => /const likeSafe/.test(l)) || "").trim());
  for (const col of ["profiles?gamertag=ilike.", "profiles?ea_id=ilike."]) {
    A(`${col} goes through likeSafe`, new RegExp(col.replace(/[?.]/g, "\\$&") + "\\$\\{encodeURIComponent\\(likeSafe\\(").test(ing));
  }
  A("the fuzzy pass escapes each token too", /const escTok = \(t\) => t\.replace\(\/\(\[\\\\%_\]\)\/g, "\\\\\$1"\);/.test(ing));
  A("the persona lookup is eq, not ilike (it is a number, not a name)",
    /profiles\?ea_player_id=eq\./.test(ing) && !/ea_player_id=ilike/.test(ing));
}

console.log("\n— the cross check, and that nothing found was new");
{
  A("weekly limits came back clean", /Weekly game limits \(Rule 5\.2\): clean/.test(flat));
  A("the seven flags are each accounted for", /Seven rows read as violations\. All seven are explained and none is new/.test(flat));
  A("atlasx27x's reason is the order of events, not a violation",
    /waived AFTER those games/.test(flat));
  A("Maniac's ruling is named as already made", /Already ruled and logged/.test(flat));
  A("biz is recorded as never flagged before this pass", /NEVER FLAGGED until this pass/.test(flat));
  A("...and cleared on the club notice timestamps, not on an assumption",
    /To training camp: biz/.test(flat) && /To the active roster: biz/.test(flat)
    && /both games \(9:35 and 10:10\) fall inside that window/.test(flat));
  A("...with the reason he slipped through at the time",
    /the check reads the squad as it stands now/.test(flat));
  A("the re-run result is recorded", /raised ZERO new findings/.test(flat));
  A("the withdrawal was respected, and that is stated",
    /never re-credited by a linking pass/.test(flat));
  A("only NULL personas were filled", /a persona already claimed by another member was refused rather than overwritten/i.test(flat));
}

console.log("\n— unrostered_cleared: a ruling needs somewhere to live");
{
  A("the record carries the actual guard clause",
    /a\.action in \('unrostered_player','unrostered_cleared'\)/.test(rec));
  A("it says what it mirrors", /Mirroring 'position_cleared'/.test(flat));
  A("it names the root cause: the roster is read as it stands now",
    /the roster is read as it stands NOW and not as it stood that night/.test(flat));
  A("it says what would have happened without it",
    /would have paged the Officials' desk again on the next run/.test(flat));
  A("it adds no new table", /adds no new table and no new place to look/.test(flat));
}

console.log("\n— the row that is still open is reported open, not guessed");
{
  A("the unmatched row is named with its persona", /vDarkiee___/.test(flat) && /1004486290545/.test(flat));
  A("elimination is recorded as unavailable, with the reason",
    /Elimination does not close it/.test(flat) && /share only two names/.test(flat));
  A("both lists are written down so the next person need not re-derive them",
    /filed:/.test(rec) && /played:/.test(rec) && /FluffyPanda789/.test(rec) && /PghReaper/.test(rec));
  A("the filed goaltender is named as a different member", /The filed goaltender was Zurion, who is a different member/.test(flat));
  A("guessing is refused in writing",
    /guessing a member into a box score is worse than leaving the row unmatched/.test(flat));
  A("it is left where a person will see it", /It stays on the Officials' desk/.test(flat));
}

console.log("\n— no dashes as punctuation (standing rule)");
{
  A("the record has no em dash and no spaced hyphen",
    !/—/.test(rec) && !/ - /.test(rec.replace(/^--.*$/gm, (m) => m.replace(/^--/, ""))),
    (rec.split("\n").find((l) => /—| - /.test(l)) || "").trim());
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
