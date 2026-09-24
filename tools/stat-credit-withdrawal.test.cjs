/* v3.08 — Rule 6.3: the club keeps the line, the player loses the credit, and a re-import
 * cannot undo it.
 *
 * Commissioner, after game night one: "we dont need their personal stats anymore but the team
 * should still hold those stats."
 *
 * The shape that makes this work already existed and must not be broken: game_stats.profile_id
 * is nullable, skater_name carries the EA name, and part_live keys an unlinked line as
 * `ea:<row id>` so it renders for the club without touching anyone's totals.
 *
 * The part that is easy to get wrong is WHERE the withdrawal is applied. Putting it in the
 * matcher would do nothing: resolveProfile finds the player again from his persona and from the
 * `prior` step taught by his other games. It has to be applied to the finished rows, after
 * resolution, because every filing path DELETEs a game's lines and re-POSTs them.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 200))); }
}

const ing = R("netlify/functions/ingest-stats.js");
const live = R("src/live/part_live.js");
const rec = R("sql/2026-09-24-withdraw-stat-credit.sql");

console.log("\n— the withdrawal is the last word, not a step in the matcher");
{
  const box = ing.slice(ing.indexOf("async function leagueBoxRows"), ing.indexOf("async function applyCreditWithdrawals"));
  A("leagueBoxRows applies withdrawals", /await applyCreditWithdrawals\(game\.id, rows\);/.test(box));
  A("...after every row has been resolved",
    box.indexOf("applyCreditWithdrawals") > box.indexOf("await resolveProfile"));
  A("...and before personas are learned, so a withdrawn line teaches nothing",
    ing.indexOf("await applyCreditWithdrawals") < ing.indexOf("await learnPersonas(rows)"));
  const res = ing.slice(ing.indexOf("async function resolveProfile"), ing.indexOf("cache.set(key, pid)"));
  A("the matcher itself is untouched by it", !/withdraw/i.test(res));
  A("the reason it cannot live in the matcher is written down",
    /resolveProfile would find the member again/.test(ing.replace(/\s+/g, " ")));
}

console.log("\n— only the person goes; the line stays with the club");
{
  const fn = ing.slice(ing.indexOf("async function applyCreditWithdrawals"), ing.indexOf("/* v3.04"));
  A("it clears the member link", /r\.profile_id = null/.test(fn));
  A("...and nothing else on the row", !/r\.(goals|assists|skater_name|team_id|shots)\s*=/.test(fn));
  A("it only touches a line that names that EA account",
    /r\.ea_player_id && off\.has\(String\(r\.ea_player_id\)\)/.test(fn));
  A("no withdrawals means no work", /if \(!Array\.isArray\(list\) \|\| !list\.length\) return;/.test(fn));
}

console.log("\n— a read it cannot trust must not be treated as 'nobody was withdrawn'");
{
  const fn = ing.slice(ing.indexOf("async function applyCreditWithdrawals"), ing.indexOf("/* v3.04"));
  A("the lookup is not wrapped in a swallowing try/catch", !/try\s*{/.test(fn), fn.slice(0, 120));
  A("...and the file says why it is allowed to throw",
    /Re-crediting someone the league office removed is worse than not filing/.test(ing));
}

console.log("\n— the downstream shape this depends on");
{
  A("an unlinked line still renders, under a synthetic key", /var key = r\.profile_id \|\| \("ea:"\+r\.id\);/.test(live));
  A("...and is excluded from three stars rather than crashing them",
    /if \(String\(pid\)\.indexOf\("ea:"\)===0\) return;/.test(live));
  A("the EA name is kept on the row so the club box score still names him",
    /name:r\.skater_name\|\|null/.test(live));
}

console.log("\n— the decision record");
{
  const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
  A("it quotes the commissioner", /the team should still hold those stats/.test(flat));
  A("it names who it was, and how that was established",
    /ATLASX27X/.test(rec) && /1448733393/.test(rec));
  A("it records that both sittings had the same goalies", /BOTH sittings had the same goalies/.test(flat));
  A("it records the grant trap for every future table",
    /born world-writable at the grant level/.test(flat) && /Name the roles/.test(flat));
  A("it says why a plain UPDATE would not have held", /a hand-edit would have been undone by the next poll/i.test(flat));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
