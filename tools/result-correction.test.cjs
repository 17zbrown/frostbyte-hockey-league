/* v3.42 — correcting a filed league result, and the overtime flag a merged game cannot carry. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const live = R("src/live/part_live.js"), ing = R("netlify/functions/ingest-stats.js");
const rec = R("sql/2026-09-26-overtime-correction.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the control exists and calls the RPC that was never called");
{
  A("the card is in the Stats Manager", /<h3>Correct a filed result<\/h3>/.test(live));
  A("...between the merge and the forfeit cards",
    /body\.innerHTML = addCard \+ leagueCard \+ fixCard \+ forfeitCard \+ incidentCard \+ listCard;/.test(live));
  A("it calls stats_game_set_result", /rpc\("stats_game_set_result", \{ p_game:id, p_home:hs, p_away:as, p_final:true, p_ot:ot\.checked \}\)/.test(live));
  A("...which is the only CALL to it in the client (the other mention is the comment that explains it)",
    (live.match(/rpc\("stats_game_set_result"/g) || []).length === 1);
  A("it offers an overtime box", /id="smFixOt" type="checkbox"/.test(live));
  A("only final games are listed", /lgGames\.filter\(function\(g\)\{ return g\.status==="final"; \}\)/.test(live));
  A("picking one prefills from the record", /h\.value = o\.getAttribute\("data-h"\)/.test(live) && /ot\.checked = o\.getAttribute\("data-ot"\) === "1"/.test(live));
  A("the standings are reloaded after", /if \(CG\.reloadLeague\) CG\.reloadLeague\(\);/.test(live.slice(live.indexOf("smFixGo"))));
}

console.log("\n— the two guards on a hand-typed correction");
{
  A("a league game cannot end level", /if \(hs === as\)\{ CG\.toast\("A league game cannot end level/.test(live));
  A("overtime means a one-goal margin", /if \(ot\.checked && Math\.abs\(hs-as\) !== 1\)/.test(live));
  A("...and the record explains why that one matters",
    /SEA 9-5 NYI also ran past regulation, 3912 seconds, and is NOT an overtime game/.test(flat));
  A("...naming what time past regulation cannot tell you",
    /Time past regulation alone cannot tell the two apart/.test(flat));
}

console.log("\n— why the importer could not have known");
{
  A("the importer still reads OT from the result code", /const wentOt = clubs\.some\(\(c\) => c\.result === 5 \|\| c\.result === 6\);/.test(ing));
  A("...and only from the deciding sitting of a merge", /only the final sitting can end in OT/.test(ing));
  A("the record quotes the codes this game actually carried", /result codes of 16385 and 10/.test(flat));
  A("...and reads 16385 as a bit set", /16385 is 0x4001: the field is a bit set/.test(flat));
  A("...without guessing the rest of the bits",
    /I am not guessing at the rest of the bits on the strength of one game/.test(flat));
  A("the merge card's own claim is named as the failed assumption",
    /overtime from the deciding sitting/.test(flat) && /exactly the assumption that failed/.test(flat));
  A("the merge card still carries that wording, so the record matches the code",
    /overtime from the deciding sitting/.test(live));
}

console.log("\n— the correction itself, and the survey");
{
  A("it quotes the heads-up", /the game between the penguins and mammoth that resulted in a 4-3 win for the penguins was an overtime win/.test(flat));
  A("it used the sanctioned door, not an UPDATE", /the sanctioned door, not a raw UPDATE/.test(flat));
  A("the standings movement is recorded", /6 losses -> 5 losses and 1 OTL/.test(flat) && /6 points -> 7 points/.test(flat));
  A("...and that PIT did not move", /PIT\s+unchanged, a win is a win/.test(flat));
  A("the clock corroborated before anything changed", /4605 seconds, 1005 past regulation/.test(flat));
  A("every over-regulation game was surveyed", /SURVEYED, since one wrong flag suggests others/.test(flat));
  A("...all four listed with margins", /UTA 5-4 NYI/.test(flat) && /VAN 1-2 SEA/.test(flat) && /SEA 9-5 NYI/.test(flat) && /PIT 4-3 UTA/.test(flat));
  A("...and the conclusion stated", /No other game is mismarked/.test(flat));
  A("no em dash or spaced hyphen", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
