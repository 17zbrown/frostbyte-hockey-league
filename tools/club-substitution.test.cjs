/* v3.20 Rule 4.6 — a club that could not use its own EASHL club played one fixture under another.
 *
 * Commissioner, 2026-09-25: "The VAN vs PIT game was unique. VAN had to use an outside club due to
 * a game problem so treat that outside club as VAN for this game 1 game only."
 *
 * The BEHAVIOR is proved end to end in tools/game-window.test.mjs (the Rule 4.6 block: the file,
 * the sides, the team_id on the rows, and four refusals). This file holds what the repo owns and
 * that file cannot reach: the published rule, and the decision record with its traps.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 240))); }
}

const rec = R("sql/2026-09-25-club-substitution.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const ingest = R("netlify/functions/ingest-stats.js");

console.log("\n— the importer: one seam, and the pin that makes it a substitution and not an alias");
{
  A("the club map is built before the refusal, so a substitution can fill it",
    ingest.indexOf("const teamByClub = Object.fromEntries") < ingest.indexOf("if (Object.keys(teamByClub).length < 2)"));
  A("the refusal counts RESOLVED clubs, not rows returned by teams",
    /if \(Object\.keys\(teamByClub\)\.length < 2\) \{/.test(ingest));
  A("only UNRESOLVED club ids are looked up", /const unresolved = ids\.filter\(\(c\) => !teamByClub\[c\]\);/.test(ingest));
  A("a substitution is scoped by its own fixture's window, not by the club id alone",
    /matchInWindow\(matchEndMs, when\[s\.game_id\], winBefore, winAfter\)/.test(ingest));
  A("two candidates in one window is nobody", /if \(mine\.length !== 1\) continue;/.test(ingest));
  A("THE PIN: the match may file only on the fixture the substitution names",
    /\.filter\(\(g\) => !pinnedGames \|\| pinnedGames\.includes\(g\.id\)\);/.test(ingest));
  A("...applied to the open set, so the relaxed replay inherits it too",
    /const gamesAll = pairAll[\s\S]{0,400}pinnedGames\.includes\(g\.id\)\);/.test(ingest));
}

console.log("\n— the refusal offers BOTH answers, because one of them is the wrong one here");
{
  A("it no longer says only 'link the EA id'", !/one club is not linked to an EA club \(teams\.ea_club_id\)/.test(ingest));
  A("it offers the link", /link that club's EA id/.test(ingest));
  A("it offers the substitution", /record a club substitution on/.test(ingest));
  A("...and names the rule", /\(Rule 4\.6\)/.test(ingest));
}

console.log("\n— the published rule");
{
  const content = R("src/live/part3_content.js");
  const obj = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  const ch4 = obj.rulebook.chapters.find((c) => c.num === 4);
  const r46 = ch4.sections.find((s) => s.id === "4.6");
  A("Rule 4.6 exists, in the chapter that governs how a game is set up", !!r46 && /Playing under another club/.test(r46.title));
  const body = (r46 ? r46.paragraphs.join(" ") : "");
  A("the game counts in full", /counts in full/.test(body) && /the result and every statistic stand/.test(body));
  A("the office must be told, and records it BEFORE the game is filed",
    /records the substitution against that one fixture before the game is filed/.test(body));
  A("one fixture, and no effect on any other game", /recorded for a single fixture and has no effect on any other game/.test(body));
  A("a club's own EA club is never repointed", /never repointed/.test(body));
  A("every player is still held to the roster, position, limit and lineup rules",
    /Rule 2\.1/.test(body) && /Rule 5\.2/.test(body) && /Rule 5\.3/.test(body));
  A("...and a borrowed club cannot dress a player the club does not hold", /may not use the borrowed club to dress a player it does not hold/.test(body));
  A("playing under another club unannounced is not a result until the office rules", /is not a result until the office rules on it/.test(body));

  const r62 = obj.rulebook.chapters.find((c) => c.num === 6).sections.find((s) => s.id === "6.2");
  A("Rule 6.2 was amended in the same pass, not left contradicting 4.6",
    /or under a club substitution recorded for that fixture under Rule 4\.6/.test(r62.paragraphs.join(" ")),
    r62.paragraphs[0].slice(0, 200));
  A("...and 6.2 says what happens when the office was not told", /without the office recording it under Rule 4\.6/.test(r62.paragraphs.join(" ")));
  A("the changelog records it", obj.rulebook.changelog[0].version === "3.20");
}

console.log("\n— the decision record");
{
  A("it quotes the instruction", /treat that outside club as VAN for this game 1 game only/.test(flat));
  A("it names the borrowed club and the EA id", /LG ThunderBirds/.test(flat) && /10200/.test(flat));
  A("it names the fixture and the scoreline", /PIT 5 VAN 6/.test(flat));
  A("it says why repointing ea_club_id was refused",
    /every ThunderBirds lobby, forever, a Vancouver league game/.test(flat)
    && /would make Vancouver's own club stop importing/.test(flat));
  A("the three trigger guards are each written down",
    /never a third party/.test(flat) && /mis-link to correct in the Control Center/.test(flat)
    && /must still be 'scheduled'/.test(flat));
  A("the grant trap is carried forward", /pg_default_acl still grants a new table arwdDxtm/.test(flat));
  A("the overload trap is asserted, not just remembered", /a defaulted argument makes an overload, not a replacement/.test(flat));
  A("the reason is recorded as mandatory, with why",
    /indistinguishable from a mistake six weeks later/.test(flat));
  A("the outcome is recorded with real numbers", /12 of 12 linked to members/.test(flat));
  A("...including that the cross check came back clean", /review_game_records then raised nothing/.test(flat));
  A("THE (f()).* TRAP is recorded", /RE-EVALUATES the function ONCE PER OUTPUT COLUMN/.test(flat));
  A("...with why it was easy to miss", /the visible state was correct and the audit trail was not/.test(flat));
  A("...and the correct call form", /select \* from public\.set_game_club_substitution/.test(flat));
  A("no em dash or spaced hyphen in the record", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
