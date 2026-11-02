/* v4.43 (2026-11-01): Season 1's playoff floor is fourteen, and an ineligible player is locked out of playoff lineups.
   The commissioner, 2026-11-01: "lock out the ineligible players in playoffs so teams cannot place them on lineups", then
   "Edit the season 1 post season eligibility game requirements from 16 GP to 14 GP and edit the prorated player's numbers
   accordingly to match the percentage as well."
   The database already refused an ineligible player in set_game_lineup (Rule 8.3); the lineup builder and the line builder
   let a club pick one and learn only when the sheet was saved. CG.playoffLockout is now the one test both pages and Dress
   tonight share. The floor lives in seasons.playoff_floor_ruled (sql/2026-11-01-season1-playoff-floor-14-v443.sql), which
   season_playoff_floor keeps over the thirty percent rule. Run: node tools/playoff-lockout-v443.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 240))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sql = R("sql/2026-11-01-season1-playoff-floor-14-v443.sql");
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js");
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); return i < 0 || j < 0 ? "" : src.slice(i, j); };

console.log("1. The SQL record");
A("built as v4.41, ships as v4.43, the migration keeps its name", /-- Built as v4\.41 \(migration v441_season1_playoff_floor_14\), ships as v4\.43/.test(sql));
A("a per-season ruled floor, bounded", /alter table public\.seasons add column if not exists playoff_floor_ruled int\s+check \(playoff_floor_ruled is null or playoff_floor_ruled between 0 and 200\);/.test(sql));
A("the floor trigger keeps a ruled floor over the thirty percent rule, with an empty search_path",
  /if new\.playoff_floor_ruled is not null then\s+new\.playoff_min_gp := new\.playoff_floor_ruled;\s+return new;/.test(sql) && /set search_path to ''/.test(sql) &&
  /revoke all on function public\.season_playoff_floor\(\) from public, anon, authenticated;/.test(sql));
A("Season 1 is set to fourteen, Season 2 keeps its sixteen", /update public\.seasons set playoff_floor_ruled = 14 where number = 1;/.test(sql) &&
  /Season 2''s floor moved/.test(sql));
A("the reason it is a column: the trigger and the playoff draw would turn a hand-set 14 back into 16", /would turn back into 16 at the\s+-- next round/.test(sql));
A("rehearsed and applied", /Result: REHEARSAL OK: F1 F2/.test(sql) && /Applied as migration v441_season1_playoff_floor_14\./.test(sql));
A("the shortcut is marked", /-- shortcut: the ruled floor has no Control Center field/.test(sql));

console.log("\n2. CG.playoffLockout mirrors set_game_lineup's gate");
const helper = cut(live, "CG.playoffFloorFor = function", "CG.playoffRoad = function");
A("the helper sits beside the floor helpers it reads", /CG\.playoffLockout = function\(lg, p, game\)\{/.test(helper));
const CLOSE = Date.parse("2026-10-17T04:00:00Z");
const ctx = { CG: { lg: { playoffFloors: { a: 14, b: 12, g: 14, h: 14 } }, playoffMinGp: () => 14, SEASON: { fa_moves_closed_at: "2026-10-17T04:00:00Z" },
  movementDeadlineTs: () => CLOSE } };
vm.runInNewContext(helper, ctx);
const L = ctx.CG.playoffLockout, lg = { pstats: { a: { gp: 13 }, b: { gp: 12 }, g: { gp: 3 }, h: { gp: 2 } }, gpCredits: { h: 12 } };
const po = { stage: "playoff" }, reg = { stage: "regular" };
const a = { id: "a", tag: "Skater", pos: "C" };
A("a regular-season game locks nobody", L(lg, a, reg) === null);
A("one game short in the playoffs is locked, with the numbers", (L(lg, a, po) || {}).why === "Skater has 13 of the 14 regular-season games the playoffs need, so they cannot be dressed in a playoff game (Rule 8.3).");
A("a prorated player at their own floor plays", L(lg, { id: "b", tag: "B", pos: "LW" }, po) === null);
A("a league office credit counts toward the floor", L(lg, { id: "h", tag: "H", pos: "G" }, po) === null);
A("a goaltender seated after signings closed is exempt (Rule 2.4)", L(lg, { id: "g", tag: "G1", pos: "G", spotAt: CLOSE + 3600000 }, po) === null);
A("...one seated before is not", !!L(lg, { id: "g", tag: "G1", pos: "G", spotAt: CLOSE - 3600000 }, po));
A("...nor a skater seated after", !!L(lg, { id: "a", tag: "Skater", pos: "C", spotAt: CLOSE + 3600000 }, po));
A("the exemption reads the same close as public.fa_moves_close_at (the earlier of the free-agent close and the deadline)",
  /fa_moves_close_at/.test(helper) && /Math\.min\.apply\(null, closes\)/.test(helper) && /CG\.movementDeadlineTs/.test(helper));
A("every roster player carries the time their spot was made", /spotAt: rs\.created_at \? Date\.parse\(rs\.created_at\) : null/.test(live));
A("no em dash in the helper", !/[—–]/.test(helper.slice(helper.indexOf("CG.playoffLockout"))));

console.log("\n3. The lineup builder locks them out");
A("the bench greys them out with a Not eligible tag and the reason", /var poOut = CG\.playoffLockout \? CG\.playoffLockout\(lg, p, game\) : null;\s+var dis = suspended\[p\.id\] \|\| !!poOut;/.test(hub) &&
  /poOut\?'<span class="chip chip-loss" style="font-size:9px" title="'\+esc\(poOut\.gp\+' of '\+poOut\.min\+' regular-season games \(Rule 8\.3\)'\)\+'">NOT ELIGIBLE<\/span>'/.test(hub));
A("its own check refuses them, so assigning, auto-fill and fill-from-plan all skip them", /var poOut = CG\.playoffLockout \? CG\.playoffLockout\(lg, p, game\) : null;\s+if \(poOut\) return poOut\.why;/.test(hub) &&
  /\.find\(function\(p\)\{ return !validate\(p,pos\) \|\| state\.slots\[pos\]===p\.id; \}\)/.test(hub) && /var why = p \? validate\(p, pos\) : "no longer rostered";/.test(hub));
A("the caption says eligibility is checked", /Assignments validate position, suspension, the weekly cap, playoff eligibility and duplicates\./.test(hub));

console.log("\n4. The line builder and Dress tonight");
A("while the club's next game is a playoff game, the ineligible are found once", /var poNext = \(\(CG\.lineNights\(club\)\[0\] \|\| \{\}\)\.game\) \|\| null;/.test(hub) &&
  /if \(poNext && poNext\.stage === "playoff" && CG\.playoffLockout\) roster\.forEach/.test(hub));
A("their roster cards are locked (both the roster and the camp boards)", (hub.match(/var dis = suspended\[p\.id\] \|\| !!poOut\[p\.id\];/g) || []).length === 2 &&
  (hub.match(/poOut\[p\.id\]\?'<span class="chip chip-loss" style="font-size:9px">NOT ELIGIBLE<\/span>'/g) || []).length === 2);
A("a line already holding one says so", /\(poOut\[pid\]\?' · NOT ELIGIBLE':''\)/.test(hub));
A("they cannot be dropped onto a line", /if \(poOut\[pid\]\) return poOut\[pid\]\.why;   \/\* v4\.43 \*\//.test(hub));
A("Dress tonight names them and keeps the line instead of sending a sheet the database refuses",
  /var outs = \(gq\.stage === "playoff" && CG\.playoffLockout\)/.test(hub) && /Swap them out of "\+\(row\.name\|\|\("Line "\+slot\)\)\+" first\."/.test(hub) &&
  /var poWhy = playoffRefusal\(gq, row, slot\); if \(poWhy\)\{ done\(poWhy\); return; \}/.test(hub));

console.log("\n5. The Seasons editor names a ruled floor");
A("the field says when the commissioner set the floor", /'set by the commissioner for this season' : '30% of the season'/.test(live));

console.log("\n6. Rule 8.3, in the book as rendered");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook;
eval(R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0]);
const book = JSON.stringify(CG.rulebookForFormat(rb, "basic").chapters);
A("8.3 states Season 1's fourteen and its prorated share", book.indexOf("For Season 1 the commissioner set the floor at fourteen (14) games in place of that figure, and a player placed after opening night that season needs the same share of fourteen (14): with forty-five (45) of fifty-four (54) games left, twelve (12), since the share is 11.67.") > -1);
A("...the general rule is unchanged (thirty percent, sixteen of fifty-four)", book.indexOf("is thirty percent (30%) of a club's regular-season schedule") > -1 && book.indexOf("sixteen (16) in a season of fifty-four (54) games") > -1);
A("...and Season 2 keeps its sixteen", book.indexOf("sixteen (16) games while Season 2 is fifty-four (54) games long") > -1);
A("the worked share is right: 14 x 45 / 54 = 11.67, above .4, so 12", Math.abs(14 * 45 / 54 - 11.67) < 0.01 && (14 * 45 / 54) % 1 > 0.4);

console.log("\n7. The changelog");
const e = rb.changelog.find((c) => c.version === "4.43");
A("4.43 is recorded, keys in order", !!e && Object.keys(e).join() === "version,dateIso,summary,items" && e.dateIso === "2026-11-01");
const et = e ? JSON.stringify(e) : "";
A("it says what changed for members", /fourteen/.test(et) && /Not eligible/.test(et) && /Rule 8\.3/.test(et) && /Rule 9\.3/.test(et));
A("no em dashes or spaced hyphens", !/[—–]| - /.test(et));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
