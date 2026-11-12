/* v4.50 (2026-11-12): a filing by hand on the Stats manager is a ruling. Commissioner: "If I manually file a game from
   multiple sittings on the stats manager desk, it should file even if the time does not add up to 60 minutes excactly."
   The desk's merge publishes a decided score at any game clock; a level score is still held (Rule 4.1: no ties). And
   because a final short of sixty minutes can now only be a filing by hand, the importer never resumes a final or rules
   one abandoned: before this, such a final would have taken the next sitting between the clubs into it on its own, or
   been charged as an abandoned forfeit (with a #game-scores post) once a club played someone else.
   This pins the source, the rule and the desk's words. The behavior runs in tools/league-merge.test.mjs (the merge),
   tools/ingest-batch.test.mjs (resume and sweep) and tools/game-window.test.mjs (the playoff-night sibling).
   Run: node tools/manual-file-any-clock-v450.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got))); } };
const ROOT = path.join(__dirname, ".."), R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ing = R("netlify/functions/ingest-stats.js"), live = R("src/live/part_live.js"), sql = R("sql/2026-11-12-forfeit-kept-result-post-v450.sql");
const merge = ing.slice(ing.indexOf("const st = sittingsState(sideNorms);"), ing.indexOf("// Commissioner re-ingest: { reingest:"));

console.log("— the desk's merge (leagueMerge)");
A("it quotes the commissioner", /it should file even if the time does not add up to 60 minutes excactly\./.test(ing));
A("a decided score files, whatever the clock", /const filed = st\.margin > 0;/.test(merge) && /const clockShort = filed && !st\.reachedFull;/.test(merge));
A("an unreadable game is refused in words, not filed", /if \(st\.error\) return \{ statusCode: 422/.test(merge));
A("the clock no longer decides anything in the merge", !/st\.finished/.test(merge), (merge.match(/.*st\.finished.*/g) || []).slice(0, 3));
A("the game row, the archive and the notes all follow `filed`",
  /sbSend\("PATCH", `games\?id=eq\.\$\{game\.id\}`, filed\s*\? \{ status: "final"/.test(merge)
  && /status: first \? \(filed \? "ingested" : "incomplete"\)/.test(merge)
  && /if \(filed\) await noteGameLength\(game, st,/.test(merge) && /if \(filed\) await noteUnattributed\(game, homeClub, awayClub,/.test(merge));
A("only a level score holds, and its reason names the score and Rule 4.1",
  /const heldWhy = filed \? null/.test(merge) && /a game can't end level \(Rule 4\.1\), so it is held until the rest of the game is merged \(Rule 4\.3\)\./.test(merge)
  && /held for the overtime reload \(Rule 4\.3\)\./.test(merge));
A("only a level merge can take a final down", /const unpublish = game\.status === "final" && !filed;/.test(merge)
  && /error: `\$\{heldWhy\} Filing it would take the game's published result off the standings/.test(merge));
A("a short game never reads \"60 of 60\": the minutes round down when the clock fell short", /const minutes = st\.reachedFull \? Math\.round\(st\.total \/ 60\) : Math\.floor\(st\.total \/ 60\);/.test(merge));
A("a sitting staged on this game rides along (every line counts), and one staged elsewhere is refused in words",
  /const need = onGameAll\.filter\(\(r\) => \/\^\(ingested\|incomplete\|merged\)\$\/\.test\(r\.status\) \|\| stagedGame\(r\) === game\.id\)/.test(ing)
  && /select=ea_match_id,status,game_id`/.test(ing) && /if \(stolen && stagedGame\(stolen\)\)/.test(ing) && /was being filed on another game when an import stopped part way, so its stats may already be there\./.test(ing));
A("the shared test's header says the desk no longer follows `finished`", /v4\.50: the manual merge \(the Stats manager, leagueMerge\) no longer follows `finished`\./.test(ing));
A("the archive records a short filing, the clock and the rule", /published by hand at \$\{minutes\} of 60 minutes of game clock \(Rule 4\.3\.3\)/.test(merge));
A("the preview and the answer both say it is short", (merge.match(/held: !filed, heldWhy, short: clockShort,/g) || []).length === 2);

console.log("\n— the importer never reopens a final");
A("the resume candidates are held games; a final is read only when an open sibling slot could take the match",
  /const pairGames = await sbGet\(`games\?\$\{orC\}&status=\$\{probe \|\| stagedOn \? "in\.\(final,scheduled\)" : "eq\.scheduled"\}&ea_match_id=not\.is\.null&voided=not\.is\.true&forfeit_team_id=is\.null/.test(ing));
/* v4.50 review: a reload after a game filed short, on a night that plays the same clubs again, would otherwise be held on
   the next slot and the next game merged into it and published */
A("...and then the probe sends the sitting to the desk, naming the game filed short",
  /const which = cand\.status === "final" \? `the \$\{cand\.id\} game, filed by hand short of sixty minutes,` : `the unfinished \$\{cand\.id\} game`;/.test(ing));
A("the abandoned-game sweep reads held games only", /held = await sbGet\(`games\?or=\(home_team_id\.eq\.\$\{t\.id\},away_team_id\.eq\.\$\{t\.id\}\)&status=eq\.scheduled&ea_match_id=not\.is\.null/.test(ing));
A("no other games read still asks for finals and held together (only the probe's)", (ing.match(/in\.\(final,scheduled\)/g) || []).length === 1);
A("one definition of a staged row: unmatched or error, naming a game", /const stagedGame = \(row\) => \(row && row\.game_id && \(row\.status === "unmatched" \|\| row\.status === "error"\) \? row\.game_id : null\);/.test(ing));
A("a staged sitting names its game (still unmatched), a row already archived is staged by a touch, and a failed stage fails the match",
  /status: "unmatched", game_id: gameId, reason,/.test(ing) && /if \(!\(await touchAttempt\(id, "unmatched", reason, gameId\)\)\) throw new Error\(`sitting \$\{id\} could not be staged on game \$\{gameId\}`\);/.test(ing)
  && (ing.match(/ctx\.log\.set\(id, \{ status: "unmatched", game_id: gameId \}\);/g) || []).length === 2);
A("the archive keeps a staged game through a refusal, a probe or an error", /if \(!gameId && \(status === "unmatched" \|\| status === "error"\)\) gameId = stagedGame\(ctx\.log\.get\(id\)\);/.test(ing));
A("a final it was staged on is resumed (the importer's own cut-off merge), never probed, and never handed to a sibling",
  /const stagedOn = stagedGame\(ctx\.log\.get\(String\(norm\.ea_match_id\)\)\);/.test(ing)
  && /\.filter\(\(g\) => \(g\.status !== "final" \|\| probe \|\| g\.id === stagedOn\) && matchInWindow\(/.test(ing)
  && /if \(cand\.id === stagedOn\) probe = false;/.test(ing) && /const refuse = async \(why\) => \{\n    if \(probe\) return R\(false\);/.test(ing));
A("the old candidate list never shows a staged sitting as attached", /row\.status !== "struck" && !stagedGame\(row\)\) \|\| game\.ea_match_id === nrm\.ea_match_id/.test(ing));
A("the desk's listing counts a final filed short as waiting for a reload, like a held game",
  /const shortFinal = new Set\(\);/.test(ing) && /\|\| shortFinal\.has\(g\.id\)\) && g\.forfeit_team_id == null && matchInWindow\(endMs, g\.scheduled_at\)/.test(ing)
  && /if \(stF\.error\) stF = sittingsState\(bySide\(ns, fixtureSides\(/.test(ing));
A("the probe's reason has no em dash", /between the same clubs: assign it by hand \(merge it, or file it on the \$\{slotEt\} slot\) from the Stats manager`;/.test(ing));
A("the branch for a game published before v3.53 is gone with it", !/Published game still unfinished/.test(ing) && /if \(!st\.finished \|\| officeHold\) \{/.test(ing));

console.log("\n— what people read");
const sb = { CG: {} }; vm.runInNewContext(R("src/live/part3_content.js"), sb);
const rb = sb.CG.CONTENT.rulebook, secs = [].concat.apply([], rb.chapters.map((c) => c.sections || []));
const r43 = secs.find((s) => s.id === "4.3"), r62 = secs.find((s) => s.id === "6.2");
A("Rule 4.3.3: staff may publish a decided game at any clock, and it stands",
  r43.paragraphs[2].indexOf("Statistics staff or a commissioner who file a game's sittings by hand, one or several, may publish the game on a decided score whatever game clock they add up to. A game so published stands as filed: the league's import shall not add a later sitting to it, though statistics staff or a commissioner may merge one by hand. No game is published on a level score (Rule 4.1).") >= 0);
A("...and the sixty-minute test is the import's", r43.paragraphs[2].indexOf("The league's import publishes a game as a result only once its sittings together make a full game of sixty (60) minutes") >= 0);
A("Rule 4.3.9: only a held game is ruled abandoned, and never a hand filing automatically", r43.paragraphs[8].indexOf("an unfinished game that is being held, and one of its clubs afterwards playing someone else. A game published by hand under Rule 4.3.3 is a result, and the league never rules it abandoned automatically.") >= 0
  && r43.paragraphs[8].indexOf("whether it was published or is being held") < 0);
A("Rule 6.2: the import never resumes a hand filing; staff may merge into it by hand", r62.paragraphs[0].indexOf("the league's import never resumes a completed game or one published by hand under Rule 4.3.3, though statistics staff or a commissioner may merge a later sitting into the latter by hand.") >= 0);
const r83 = secs.find((s) => s.id === "8.3");
A("Rule 8.3: a split playoff game follows Rule 4.3.3", r83.paragraphs[1].indexOf("A playoff game split by a disconnection is held by the league's import until its sittings make a full game with a decided score, and statistics staff or a commissioner who file its sittings by hand may publish it on a decided score at any game clock, exactly as in the regular season (Rule 4.3.3).") >= 0
  && !/is held until its sittings make a full game/.test(r83.paragraphs[1]));
A("the forfeit desk says a kept result on a final posts a Forfeit line", live.indexOf("A Forfeit line posts in #game-scores with the score unchanged. Neither club is notified in its room.") >= 0 && live.indexOf("backend gap G1)") < 0);
A("the desk's confirm says a short filing stands", live.indexOf("Filed here, the game stands as final anyway (Rule 4.3.3), and the import won’t add a later sitting to it on its own: merge one here if it turns up.") >= 0
  && /if \(r\.short\) ps\.push\("These sittings add up to "\+r\.minutes\+" of 60 minutes\./.test(live));
A("the desk's two captions say it before the confirm does", live.indexOf("Filing them publishes the game on a decided score, even short of sixty minutes (Rule 4.3.3); a level score stays held (Rule 4.1).") >= 0
  && live.indexOf("A decided score publishes, even short of sixty minutes (Rule 4.3.3); a level score stays held (Rule 4.1).") >= 0
  && live.indexOf("publishes the game if they make a full game with a decided score") < 0 && live.indexOf("It publishes only as a full game with a decided score") < 0);
A("the result note says it too", /\(r\.short \? " \("\+r\.minutes\+" of 60 minutes, filed as entered here\)" : ""\)/.test(live));
console.log("\n— the database record (forfeit_game)");
A("it quotes the commissioner and says why", /"If I manually file a game from multiple sittings on the stats manager desk, it should file/.test(sql) && /60 minutes excactly\."/.test(sql) && /backend gap G1/.test(sql));
A("the anchor is exact and asserted to match once", /v_a := \$a\$    update public\.games set forfeit_team_id = p_forfeiting_team where id = p_game;/.test(sql) && /if v_n <> 1 then raise exception/.test(sql));
A("it posts one Forfeit line, no pings, only when the forfeit changes, and a failed post only warns",
  /if v_g\.forfeit_team_id is distinct from p_forfeiting_team then/.test(sql) && /takes the forfeit loss \(FFL\)\. Every statistic earned in it counts\./.test(sql)
  && /public\.team_mention\(p_forfeiting_team\)\), false\);/.test(sql) && /raise warning 'forfeit_game scores post failed for game %: %', p_game, sqlerrm;/.test(sql));
A("its self-checks pin the post, the other branches and the grants", /forfeit_game should post from exactly one place/.test(sql) && /the held branch changed/.test(sql) && /the no-show branch changed/.test(sql) && /anon can run forfeit_game/.test(sql));
A("the rehearsal is recorded", /Result: REHEARSAL OK: T1 one scores post \| T2 Forfeit line, score 4-2, FFL, no pings \| T3 row final, score kept,/.test(sql));
A("it was applied and the grant audit came back empty", /Applied as migration v450_forfeit_kept_result_post; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
const entry = rb.changelog.find((c) => c.version === "4.50");
A("4.50 has a changelog entry naming the rules", !!entry && /Rules 4\.3\.3 and 8\.3/.test(JSON.stringify(entry)) && /Rule 4\.1/.test(JSON.stringify(entry)) && /Rules 4\.3\.9 and 6\.2/.test(JSON.stringify(entry)) && /Rule 4\.3\.7/.test(JSON.stringify(entry)), entry);
A("no em dashes in it", !!entry && !/[—–]/.test(JSON.stringify(entry)));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
