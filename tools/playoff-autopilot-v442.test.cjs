/* v4.42 (2026-11-01): the playoffs draw themselves. The commissioner, 2026-11-01: "generate the first round of season 1
   playoffs and automatically generate the following rounds when able. For the future, auto generate every playoff round."
   Then, pressing the old button: "Couldn't generate: permission denied for table games".
   The draw moved from the browser (CG.generatePlayoffRound) into the database (public._draw_playoff_round), run every five
   minutes by the pg_cron job playoff-autopilot and by the Control Center's Draw now (draw_playoff_round). Its part 6 fixed the
   browser's game inserts at the root: set_game_code read the private lobby code with the caller's rights.
   This pins the SQL record, the parts of the draw that mirror the site (holidays, the table's order, round 1's shape), the
   Control Center, Rules 0.8, 8.1 and 8.3, and the changelog. sql/2026-11-01-playoff-autopilot-v442.sql.
   Run: node tools/playoff-autopilot-v442.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 240))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sql = R("sql/2026-11-01-playoff-autopilot-v442.sql");
const live = R("src/live/part_live.js");
const engine = R("src/live/part2_engine.js");
const fnBody = (name) => { const m = sql.match(new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?as \\$function\\$([\\s\\S]*?)\\$function\\$;")); return m ? m[0] : ""; };

console.log("1. The SQL record");
const FNS = ["holiday_rules", "holiday_date", "season_holiday_keys", "holiday_week", "playoff_game_week", "standings_order",
  "_playoff_seed_draw", "_playoff_round_series", "_draw_playoff_round", "_playoff_flag", "_playoff_seed_watch", "playoff_autopilot", "draw_playoff_round"];
A("all thirteen functions are written, each with an empty search_path", FNS.every((f) => /set search_path to ''/.test(fnBody(f))), FNS.filter((f) => !/set search_path to ''/.test(fnBody(f))).join(","));
A("every internal one is revoked from the API roles", FNS.filter((f) => f !== "playoff_autopilot" && f !== "draw_playoff_round")
  .every((f) => new RegExp("revoke all on function public\\." + f + "\\([^)]*\\) from public, anon, authenticated;").test(sql)));
A("the two doors are granted to signed-in members only", /grant execute on function public\.playoff_autopilot\(\) to authenticated;/.test(sql) &&
  /grant execute on function public\.draw_playoff_round\(uuid, int, boolean\) to authenticated;/.test(sql) && !/to anon/.test(sql));
A("Draw now is a commissioner's", /if not public\.is_commissioner\(\) then\s+raise exception 'Only a commissioner can draw a playoff round\.';/.test(fnBody("draw_playoff_round")));
A("the autopilot runs for the scheduler, a trusted writer or a commissioner, and no one else",
  /if not \(public\.is_commissioner\(\) or public\.trusted_writer\(\) or coalesce\(current_setting\('request\.jwt\.claims', true\), ''\) = ''\) then\s+raise exception 'Only a commissioner can run the playoff draw\.';/.test(fnBody("playoff_autopilot")));
A("it runs every five minutes", /select cron\.schedule\('playoff-autopilot', '\*\/5 \* \* \* \*', 'select public\.playoff_autopilot\(\)'\);/.test(sql));
A("it beats a heartbeat and records its result where the watchdog reads it", /'rl_playoff-autopilot'/.test(sql) && /'rl_playoff-autopilot_result', jsonb_build_object\('ok', v_ok/.test(sql));
A("the watchdog learns the job (patched by exact anchor, asserted once)", /\(''playoff-autopilot'', interval ''1 hour''\)/.test(sql) && /automation_watchdog lists contract-enforcement % times, expected 1/.test(sql));
A("the series news drops 'set from the Control Center' (patched by exact anchor, asserted once)",
  /v_old text := 'and the next round is set from the Control Center\.'/.test(sql) && /'and the next round is drawn automatically once every series in this round is decided \(Rule 8\.3\)\.'/.test(sql) &&
  /trg_conclude_series holds the Control Center sentence % times, expected 1/.test(sql));
A("one draw at a time per season", /pg_advisory_xact_lock\(hashtextextended\('playoff_draw:' \|\| p_season::text, 0\)\)/.test(fnBody("_draw_playoff_round")));
A("a drawn round is never drawn twice, nor under a later one", /'the %s are already drawn'/.test(sql) && /a later round is already drawn, so round %s cannot be drawn under it/.test(sql));
A("round 1 waits for every regular-season game that counts", /g\.status <> 'final' and not g\.voided/.test(fnBody("_draw_playoff_round")));
A("the seeds freeze with round 1, where the site reads them", /insert into public\.site_config \(key, value\) values \('playoff_seeds_' \|\| s\.number, to_jsonb\(v_seeds\)\)/.test(sql));
A("later rounds read the frozen seeds, never the live table", /from public\.site_config c where c\.key = 'playoff_seeds_' \|\| s\.number and jsonb_typeof\(c\.value\) = 'array'/.test(sql));
A("an unbreakable tie stops the draw with Rule 8.2's play-in", /needs the one-game play-in '\s*'the league office schedules \(Rule 8\.2\)\. The draw waits until the tie is settled\./.test(sql));
A("a pause leaves the season alone", /c\.key = 'playoff_auto_' \|\| s\.number\), ''\) = 'true'/.test(fnBody("playoff_autopilot")));
A("a ruling that moves the final table after seeding is told, once per new order, and moves nothing", /Seeding does not move on its own \(Rule 8\.1\)/.test(fnBody("_playoff_seed_watch")) && /v_key text := 'po_reseed_' \|\| p_num/.test(sql));
A("a draw is audited and the commissioners told", /log_admin_action\('playoff_round_drawn', 'season'/.test(sql) && /format\('Season %s %s drawn', s\.number, v_name\)/.test(sql));
A("the shortcuts are marked", /-- shortcut: the bracket assumes exactly two divisions/.test(sql) && /-- shortcut: a tie no Rule 8\.2 tiebreaker breaks stops the draw/.test(sql));
A("the root fix: set_game_code runs with its owner's rights", /alter function public\.set_game_code\(\) security definer;/.test(sql) &&
  /revoke all on function public\.set_game_code\(\) from public, anon, authenticated;/.test(sql) && /"permission denied for table games"/.test(sql));
A("both rehearsals and both migrations are recorded", /Result: REHEARSAL OK: T0 T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11/.test(sql) && /Result: REHEARSAL OK: P0 P1/.test(sql) &&
  /Applied as migration v440_playoff_autopilot/.test(sql) && /Applied as migration v440b_set_game_code_definer/.test(sql));
A("the grant audit names the new client door", /'draw_playoff_round'/.test(R("tools/sql/grant-audit.sql")));
A("no unqualified UPDATE or DELETE anywhere a request can reach (pg_safeupdate)", !/^\s*(update|delete from) public\.\w+\s*;/m.test(sql));

console.log("\n2. The holiday calendar is the site's, row for row");
const cut = (a, b) => { const i = live.indexOf(a), j = live.indexOf(b, i); return i < 0 || j < 0 ? "" : live.slice(i, j); };
const CGh = {};
vm.runInNewContext(cut("CG.HOLIDAY_RULES = {", "CG.nightNames = function") + cut("CG.HOLIDAY_DEFAULTS =", "/* What is ticked on screen") +
  cut("CG.dayAdd = function", "CG.etISO = function") + cut("CG.holidayWeek = function", "\n};\n") + "\n};", { CG: CGh });
const rows = [...fnBody("holiday_rules").matchAll(/\('([a-z-]+)',\s*'(\w+)',\s*([\w:-]+),\s*([\w:-]+),\s*([\w:-]+),\s*([\w:-]+),\s*([\w:-]+),\s*(true|false)\)/g)]
  .map((m) => m.slice(1).map((v) => v.replace(/::int$/, "")));
const num = (v) => v === "null" ? null : Number(v);
const jsRows = CGh.HOLIDAYS.map((h) => [h.key, h.rule.type, h.rule.m ?? null, h.rule.d ?? null, h.rule.weekday ?? null, h.rule.n ?? null, h.rule.offset ?? null, !!h.on]);
A("twenty holidays in both", rows.length === 20 && jsRows.length === 20, rows.length + " / " + jsRows.length);
const sqlRows = rows.map((r) => [r[0], r[1], num(r[2]), num(r[3]), num(r[4]), num(r[5]), num(r[6]), r[7] === "true"]);
A("every rule and default matches CG.HOLIDAYS", JSON.stringify(sqlRows) === JSON.stringify(jsRows),
  sqlRows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(jsRows[i])).map((r) => r[0]).join(","));
A("the week a holiday costs is Monday to Sunday around the game Wednesday, as CG.holidayWeek has it",
  /generate_series\(0, 6\) i/.test(fnBody("holiday_week")) && /p_wed - 2 \+ i/.test(fnBody("holiday_week")) && /CG\.dayAdd\(wedYmd,-2\)/.test(live));
A("Thanksgiving 2026 costs the week of November 25, not the final's week of November 18",
  !!CGh.holidayWeek("2026-11-25", ["us-thanksgiving"]) && CGh.holidayWeek("2026-11-18", ["us-thanksgiving"]) === null);

console.log("\n3. The table is ordered as the standings page orders it");
A("points, then head-to-head, regulation wins, goal differential, goals scored (Rule 8.2)",
  /order by t\.pts desc, h\.h2h desc, t\.rw desc, t\.diff desc, t\.gf desc/.test(fnBody("standings_order")) &&
  /return \(h2h\[b\.code\] \|\| 0\) - \(h2h\[a\.code\] \|\| 0\)\s*\|\| \(b\.rw \|\| 0\) - \(a\.rw \|\| 0\)\s*\|\| b\.diff - a\.diff\s*\|\| b\.gf - a\.gf;/.test(engine));
A("head-to-head counts among every club level on points, a forfeit never earning the overtime point",
  /r\.oid in \(select b\.id from tot b where b\.pts = a\.pts and b\.id <> a\.id\)/.test(fnBody("standings_order")) &&
  /when r\.ff is null and r\.ot and r\.mine = r\.theirs - 1 then 1/.test(fnBody("standings_order")));
A("a forfeit is a regulation win and counts its played goals (Rule 8.2), as CG.aggregate scores it",
  /case when s\.ff is not null then s\.ff <> s\.tid else s\.mine > s\.theirs end as won/.test(fnBody("standings_order")) &&
  /when r\.won and \(r\.ff is not null or not r\.ot\) then 1/.test(fnBody("standings_order")) && /if \(ff \|\| !r\.ot\) t\.rw\+\+/.test(engine));
A("only regular-season finals that count", /coalesce\(x\.stage, 'regular'\) = 'regular' and x\.status = 'final'\s+and not x\.voided/.test(fnBody("standings_order")));

console.log("\n4. Round 1's shape and the later rounds match CG.playoffRound1 for every field size");
const CGs = {}; vm.runInNewContext(cut("CG.playoffRound1 = function", "/* total rounds:"), { CG: CGs });
const sqlShape = (per) => { /* the formulas the SQL draw writes, transcribed; the regexes below pin that it still writes them */
  let pow = 1; while (pow * 2 <= per) pow *= 2;
  const games1 = per === pow ? per / 2 : per - pow, byes = per - 2 * games1, s2 = games1 + byes;
  const pairs = []; for (let i = 0; i < games1; i++) pairs.push([byes + i + 1, per - i]);
  return { pairs, byes, s2 };
};
A("the SQL still writes those formulas", /v_pow := 1; while v_pow \* 2 <= v_per loop v_pow := v_pow \* 2; end loop;/.test(sql) &&
  /v_games1 := case when v_per = v_pow then v_per \/ 2 else v_per - v_pow end;/.test(sql) && /v_byes := v_per - 2 \* v_games1;/.test(sql) &&
  /v_s2 := v_games1 \+ v_byes;/.test(sql) && /v_exp := case when p_round - 1 = 1 then v_divs \* v_games1 else v_divs \* \(v_s2 \/ \(2 \^ \(p_round - 2\)\)::int\) end;/.test(sql));
for (let per = 2; per <= 8; per++) {
  const seeds = []; for (let i = 1; i <= per; i++) seeds.push(i);
  const js = CGs.playoffRound1(seeds), q = sqlShape(per);
  const rounds = 1 + Math.ceil(Math.log(per) / Math.LN2 - 1e-9);
  let left = q.s2, r = 2; while (left > 1) { left = left / 2; r++; }
  A("top " + per + ": same pairs and byes, and the division is down to one club by the final", JSON.stringify(js.pairs) === JSON.stringify(q.pairs) && js.byes.length === q.byes && (per === 2 ? true : r === rounds),
    JSON.stringify(js.pairs) + " vs " + JSON.stringify(q.pairs) + ", rounds " + r + "/" + rounds);
}
A("2-2-3 nights and home by game 2-2-1-1-1 (Rule 8.3)", /v_per_night := array\[least\(2, v_best\), least\(2, greatest\(0, v_best - 2\)\), greatest\(0, v_best - 4\)\];/.test(sql) &&
  /if v_gi < 2 or \(v_gi >= 4 and \(v_gi - 4\) % 2 = 0\) then v_host := v_hi\[v_i\];/.test(sql));
A("the final's home club is the champion higher in the league-wide table (Rule 8.3)", /public\.standings_order\(p_season, null\) x where x\.code = any\(v_adv\) order by x\.pos/.test(sql));
A("the week: the playoff start, two days after the last playoff game, or tomorrow, whichever is latest",
  /v_anchor := greatest\(coalesce\(\(s\.playoffs_start_at at time zone 'America\/New_York'\)::date, v_today \+ 2\),\s+coalesce\(v_last \+ 2, v_today \+ 1\), v_today \+ 1\);/.test(sql));

console.log("\n5. The Control Center");
const panel = cut("LIVE ADMIN: PLAYOFFS", "/* register live Control Center sections */");
A("Draw now previews and then draws through the database", /CG\.sb\.rpc\("draw_playoff_round", \{ p_season:s\.id, p_round:round, p_dry:true \}\)/.test(panel) &&
  /CG\.sb\.rpc\("draw_playoff_round", \{ p_season:s\.id, p_round:round \}\)/.test(panel));
A("the browser writes no games and keeps no second copy of the draw", !/from\("games"\)\.insert/.test(panel) && !/from\("games"\)\.delete/.test(panel) && !/CG\.seriesWinners\b/.test(live) &&
  !/CG\.playoffSlot\b/.test(live) && !/CG\.playoffHostHigher\b/.test(live));
A("a refused draw says why, from the database's own words", /CG\.playoffDrawWhy = function\(v\)/.test(panel) && (() => {
  const C = {}; vm.runInNewContext(cut("CG.playoffDrawWhy = function", "/* the Control Center's Draw now"), { CG: C });
  return C.playoffDrawWhy({ ok: false, wait: "the division finals are already drawn" }) === "The division finals are already drawn." &&
    /^The draw needs a commissioner\. BOS, DET finish level/.test(C.playoffDrawWhy({ ok: false, error: "BOS, DET finish level in the East division." }));
})());
A("the round cards say the rounds draw themselves, and offer Draw now", /Draws itself from the final table once the last regular-season game is final\./.test(panel) && /'Draw now<\/button>'/.test(panel) && !/Generate '\+rm\[1\]/.test(panel));
A("the automatic-draw switch writes the key the autopilot reads, and fails loud", /"playoff_auto_"\+\(\(CG\.SEASON&&CG\.SEASON\.number\)\|\|1\)/.test(panel) &&
  /val = \{ paused: pause \}/.test(panel) && /Nothing was saved: the database refused the change/.test(panel));
A("...and repaints in place, never through the router", /host\.outerHTML = CG\.playoffAutoCard\(\); CG\.bindPlayoffAuto\(\);/.test(panel) &&
  !/CG\.router\(\)/.test(cut("CG.bindPlayoffAuto = function", "CG.clearPlayoffRound = function")));
A("the seeding card says so when the table moved after seeding", /The standings changed after the bracket was seeded\./.test(panel));
A("Clear says the round comes back unless the draw is paused", /Unless you pause automatic draws first, the round is drawn again within five minutes/.test(panel));
A("Automations lists the job, run as the scheduler runs it", /\{ key:"playoff-autopilot", staleAfterMin:20, name:"Playoff draw"[^\n]*rpc:"playoff_autopilot" \}/.test(live));
A("the audit feed reads the draw", /playoff_round_drawn:"drew a playoff round"/.test(live));
A("no em dash in the new panel code", !/[—–]/.test(cut("CG.playoffDrawWhy = function", "CG.clearPlayoffRound = function")) && !/[—–]/.test(cut("{ key:\"playoff-autopilot\"", "\n")));

console.log("\n5b. The review's fixes (v4.42, Part 7)");
const p7 = sql.slice(sql.indexOf("-- Part 7 (v4.40c"));   /* the record keeps the build number of its applied parts */
A("Part 7 is recorded, rehearsed and applied", p7.length > 1000 && /Result: REHEARSAL OK: R0 R1 R2 R3 R4 R5 R6/.test(p7) && /Applied as migration v440c_playoff_review_fixes/.test(p7));
A("a playoff week is Wednesday to Friday whatever the night count (Rule 8.3)", /return array\(select v_wed \+ i from generate_series\(0, 2\) i order by i\);/.test(p7) && /v_day := v_nights\[v_ni \+ 1\];/.test(p7));
A("a round's stale series results go when it is drawn and when it is cleared", (p7.match(/delete from public\.app_config c where c\.key like 'series!_' \|\| s\.number \|\| '!_' \|\| p_round \|\| '!_%' escape '!';/g) || []).length === 2);
A("clearing is one commissioner-only call under the draw's lock, refused under a later round",
  /raise exception 'Only a commissioner can clear a playoff round\.';/.test(p7) && /A later round is drawn\. Clear the later rounds first/.test(p7) &&
  /grant execute on function public\.clear_playoff_round\(uuid, int\) to authenticated;/.test(p7) && /'clear_playoff_round'/.test(R("tools/sql/grant-audit.sql")));
A("a reseed ends no seat twice (seeds_out_<n>)", /v_key := 'seeds_out_' \|\| split_part\(new\.key, '_', 3\);/.test(p7) && /not \(tm\.code = any\(v_done\)\)/.test(p7));
A("a series level with no game left is sent to the commissioners", /no series winner and no game left to play/.test(p7) && /g\.status = 'scheduled' and not g\.voided/.test(p7));
A("a blocked draw shows amber in Automations, and the seed watch runs while paused", /'warning', v_warn/.test(p7) &&
  p7.indexOf("perform public._playoff_seed_watch(s.id, s.number);") < p7.indexOf("'playoff_auto_' || s.number), '') = 'true'"));
A("a final level on every tiebreaker is drawn and flagged", /v_final_tie := \(select count\(distinct/.test(p7) && /home ice needs a ruling/.test(p7));
A("Clear in the Control Center is that one call", /CG\.sb\.rpc\("clear_playoff_round", \{ p_season:s\.id, p_round:round \}\)/.test(panel) && !/from\("site_config"\)\.delete\(\)\.eq\("key",key\)/.test(panel));
A("the public bracket says the next round draws itself", R("src/live/part5a_public.js").indexOf("Drawn automatically once every series of the previous round is decided (Rule 8.3).") > -1 &&
  !/Set from the Control Center/.test(R("src/live/part5a_public.js")));

console.log("\n6. Rules 0.8, 8.1 and 8.3, in the book as rendered");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook;
eval(R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0]);
const book = JSON.stringify(CG.rulebookForFormat(rb, "basic").chapters), shelved = JSON.stringify(CG.rulebookForFormat(rb, "full").chapters);
A("0.8: the league draws each round automatically", book.indexOf("The league draws each round automatically: the first round, and with it the seeding, as soon as the last regular-season game is final, and each later round as soon as every series of the round before it is decided (Chapter 8). Seeding does not change between rounds.") > -1);
A("8.1: seeding is fixed automatically, and a ruling before the first playoff game redraws it", book.indexOf("Seeding is fixed automatically as soon as the last regular-season game is final, and does not change between rounds. If a ruling changes the final standings before the first playoff game is played, the league office redraws the bracket from the corrected standings.") > -1);
A("8.3: each later round is drawn and scheduled automatically", book.indexOf("the remaining games of the series are canceled. Each round after the first is drawn and scheduled automatically as soon as every series of the round before it is decided, and is played in the next game-week.") > -1);
A("Appendix A carries the same in the full format", shelved.indexOf("Seeds are fixed automatically when the last regular-season game is final") > -1 &&
  shelved.indexOf("Seeding is fixed automatically as soon as the last regular-season game is final, and clubs are not re-seeded between rounds.") > -1 &&
  shelved.indexOf("Each round after the first is drawn and scheduled automatically") > -1);
A("'certifies the final standings' is gone from both formats", !/certifies the final standings/.test(book) && !/certifies the final standings/.test(shelved));

console.log("\n7. The changelog");
const e = rb.changelog.find((c) => c.version === "4.42");
A("4.42 is recorded, keys in order", !!e && Object.keys(e).join() === "version,dateIso,summary,items" && e.dateIso === "2026-11-01");
const et = e ? JSON.stringify(e) : "";
A("it says what changed for members and the rules touched", /draw themselves/.test(et) && /Rules 0\.8, 8\.1 and 8\.3/.test(et) && /Islanders against the Red Wings and the Kraken against the Mammoth/.test(et));
A("no em dashes or spaced hyphens", !/[—–]| - /.test(et));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
