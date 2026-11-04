/* v4.46 (2026-11-04): re-opening a final no longer un-strikes a struck sitting. Standing order: "A struck early-restart sitting stays
   struck." reopen_game_final cleared every archive row of the game, so a struck one became an ordinary skipped row and every guard
   that reads the status let it be filed again. This pins the SQL record, the guards that rely on the status, the rule and the dialog.
   The function itself was run on production in the rolled-back rehearsal recorded in the SQL file.
   Run: node tools/reopen-keeps-struck-v446.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got))); } };
const ROOT = path.join(__dirname, ".."), R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sql = R("sql/2026-11-04-reopen-keeps-struck-v446.sql"), ing = R("netlify/functions/ingest-stats.js"), live = R("src/live/part_live.js");

console.log("— the database record");
A("the anchor is the clearing update's exact text, asserted to match once", /v_a := 'game_id=null' \|\| chr\(10\) \|\| '    where game_id = p_game;';/.test(sql) && /if v_n <> 1 then raise exception/.test(sql));
A("struck rows are left out of it", /where game_id = p_game and status <> ''struck'';/.test(sql));
A("it quotes the standing order", /A struck early-restart sitting stays struck\./.test(sql));
A("the self-check also holds the v4.45 patch", /the v4\.45 patch was lost/.test(sql));
A("anon stays out and the site stays in", /anon can run reopen_game_final/.test(sql) && /the site lost reopen_game_final/.test(sql));
A("the rehearsal ran the real function on a game with two struck sittings, and the audit is recorded", /REHEARSAL OK: T1 \| T2 \| T3 cleared=1 \| T4 \| T5/.test(sql) && /Applied as migration v446_reopen_keeps_struck; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));

console.log("\n— the guards this keeps working, which all read the status");
A("the poll skips a re-served struck sitting", /if \(row && row\.status === "struck"\) \{\s+summary\.skipped\.push/.test(ing));
A("the candidate list marks it", /struck: row\.status === "struck",/.test(ing));
A("the Stats manager refuses it", /const struckRow = logRows\.find\(\(r\) => r\.status === "struck"\);/.test(ing));
A("an attach leaves it alone", /&status=neq\.struck/.test(ing));

console.log("\n— what people read");
const sb = { CG: {} }; vm.runInNewContext(R("src/live/part3_content.js"), sb);
const rb = sb.CG.CONTENT.rulebook, rule = [].concat.apply([], rb.chapters.map((c) => c.sections || [])).find((s) => s.id === "6.2");
A("Rule 6.2 says it", rule.paragraphs[1].indexOf("A sitting struck under Rule 4.3 remains struck when its game is re-opened.") >= 0);
A("the re-open dialog says it", live.indexOf("A sitting struck when the game restarted stays struck.") >= 0);
const entry = rb.changelog.find((c) => c.version === "4.46");
A("4.46 has a changelog entry naming the rule", !!entry && /Rule 6\.2/.test(JSON.stringify(entry)), entry);
A("no em dashes in it", !!entry && !/[—–]/.test(JSON.stringify(entry)));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
