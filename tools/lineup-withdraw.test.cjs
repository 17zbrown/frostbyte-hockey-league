/* v2.85 — withdrawing a filed lineup. Run: node tools/lineup-withdraw.test.cjs
 *
 * Every route into game_lineups WROTE six players; nothing could unfile a game. A club that had
 * filled its week could therefore never give a player his games back, only swap in someone who
 * still had room, and Boston ran out of players with room the night before the first games.
 *
 * What must never break: the withdraw goes through clear_game_lineup and nothing else (no direct
 * delete from the table); it is offered only while the sheet is unlocked, because a locked sheet
 * is the lineup of record (Rule 5.3); it clears BOTH the league's copy and this browser's draft,
 * or the page keeps showing a lineup that no longer exists; and the copy says what it costs, that
 * the game is left unfiled and exposed under Rule 3.2.
 */
const fs = require("fs"), path = require("path");
const hub = fs.readFileSync(path.join(__dirname, "..", "src/live/part6_hub.js"), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the per-game builder");
A("a Remove button appears only when something is actually FILED, and only before the lock",
  /\(dbLu && !rawLocked \? '<button class="btn btn-ghost btn-sm" id="luRemove"/.test(hub));
A("...it goes through the RPC, never a direct delete",
  /CG\.sb\.rpc\("clear_game_lineup", \{ p_game: game\.id, p_team: \(lg\._codeToId\|\|\{\}\)\[club\] \}\)/.test(hub) &&
  !/from\("game_lineups"\)[\s\S]{0,80}\.delete\(\)/.test(hub));
A("...and clears the league's copy AND this browser's draft",
  /delete lg\._lineups\[club\+":"\+game\.id\];/.test(hub) && /delete st\[key\]; CG\.store\.set\("lineups", st\);/.test(hub));
A("the confirmation says the players get the game back", /gets this game back in his week \(Rule 5\.2\)|Each of them gets this game back in his week/.test(hub));
A("...and warns the game is then unfiled (Rule 3.2)", /the club plays with no sheet of record \(Rule 3\.2\)/.test(hub));
A("a refusal is shown as the rule's own message", /if \(r\.error\)\{ CG\.toast\(r\.error\.message, "err"\); return; \}/.test(hub));
A("nothing claims success before the server answers",
  hub.indexOf('CG.sb.rpc("clear_game_lineup"') < hub.indexOf('CG.toast(r.data === false ? "There was no lineup on file'));

console.log("\n— the night row");
A("a Clear button appears only when that night has something filed", /\(dressedN \? '<button class="btn btn-ghost btn-sm lc-clear"/.test(hub));
/* v2.89: the per-game picker became a per-game LINE select, so Clear withdraws the night's open
   games rather than a selected subset of them */
A("...and clears the night's open games", /var night = el\.dataset\.night, picks = CG\.lcOpenGames\(club, night\);/.test(hub));
A("...one RPC per game, refusals collected per game", /CG\.sb\.rpc\("clear_game_lineup", \{ p_game: picks\[i\]\.id, p_team: tid \}\)/.test(hub) &&
  /errs\.push\(CG\.fmtTime\(picks\[i\]\.at\)\+": "\+r\.error\.message\)/.test(hub));
A("...and the in-memory copy follows each success", /\{ n\+\+; if \(lg\._lineups\) delete lg\._lineups\[club\+":"\+picks\[i\]\.id\]; \}/.test(hub));

console.log("\n— what must NOT have changed");
A("dressing still goes through set_game_lineup", /CG\.sb\.rpc\("set_game_lineup"/.test(hub));
A("no route writes game_lineups directly", !/from\("game_lineups"\)\s*\.(insert|upsert|update|delete)/.test(hub));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
