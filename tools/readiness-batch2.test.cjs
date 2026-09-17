/* Second readiness batch (2026-08-29): the remaining ranked findings from the 86-agent review.
   Run: node tools/readiness-batch2.test.cjs */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js");
const pub = R("src/live/part5a_public.js");
const desks = R("src/live/part9_staffdesks.js");
const ingest = R("netlify/functions/ingest-stats.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the public site stops publishing wrong numbers");
{
  A("club standing words cover a full division", /var ORD = \["","","Second","Third","Fourth","Fifth"/.test(pub));
  A("...with a numeric fallback beyond the list", /\(ORD\[rank\] \|\| \("#"\+rank\)\)/.test(pub));
  A("...so 'undefined in the' can no longer render", !/\["","","Second","Third"\]\[rank\]/.test(pub));
  A("playoff spots are derived, not hardcoded 3×2", !/<b class="num">3×2<\/b>/.test(pub) &&
    /<b class="num">'\+\(CG\.playoffPerDiv\?CG\.playoffPerDiv\(\):4\)\+'<\/b><span>Playoff spots per division<\/span>/.test(pub));
  A("the home ladder orders by the standings comparator", /var authoritative = \(CG\.standings \? CG\.standings\(CG\.lg, dv\) : null\)/.test(pub));
  A("...falling back only when it can't", /\} else scored\.sort\(function\(a,b\)\{ return \(b\.pts\|\|0\) - \(a\.pts\|\|0\); \}\);/.test(pub));
}

console.log("\n— playoff series are counted the way games are actually won");
{
  A("seriesWinners honors a forfeit", /if \(res\.forfeit\) w = \(res\.forfeit===g\.home\) \? g\.away : g\.home;/.test(live));
  A("...and refuses to award a tie", /else if \(res\.score\[g\.away\] > res\.score\[g\.home\]\) w = g\.away;/.test(live));
  A("the public bracket uses the same rule", /if \(res\.forfeit\) winner = \(res\.forfeit===g\.home\) \? g\.away : g\.home;/.test(pub));
  A("a later round refuses while a division is unfinished", /division hasn|divisions haven/.test(live) &&
    /every division must be decided before round/.test(live));
  A("playoff games use the season's own puck-drop times", /CG\.etISO\(day, CG\.playoffSlot\(shpP, k\)\)/.test(live));
  A("...and never reuse a slot for two games of one series", /mins = \(parseInt\(parts\[0\],10\)\|\|21\)\*60/.test(live));
  A("Clear season counts only what it deletes", /g\.stage!=="preseason" && g\.stage!=="playoff"/.test(live));
}

console.log("\n— draft night refuses what the database refuses");
{
  A("a declined registration is out of the draft pool", /!picked\[r\.profile_id\] && r\.status!=="declined"/.test(live));
  A("board coverage counts only draft-eligible names", /return inPool\[id\] && \(!counts \|\| eligible\(id\)\);/.test(live));
  A("...but not while the pre-season is still being played", /var counts = !preLeft;/.test(live));
  A("...and reports the ineligible remainder", /var ineligibleN = /.test(live) && /ineligible:ineligibleN/.test(live));
  A("...to the GM in words", /ranked but not draft-eligible yet \(Rule 2\.8\)/.test(live));
}

console.log("\n— one cap definition, one roster definition");
{
  A("the transactions desk uses CG.teamPayroll", /byClub\[c\]\.used = CG\.teamPayroll\(lg, c\) \|\| 0;/.test(desks));
  A("...and no longer hand-sums playerSalary", !/e\.used \+= \(CG\.playerSalary\(lg, p\.id\) \|\| 0\)/.test(desks));
  A("...counting camp outside the 17", /if \(p\.squad !== "tc"\) e\.n\+\+;/.test(desks));
  A("accepting a trade reloads the whole league", /CG\.toast\("Trade completed — rosters updated for both clubs","ok"\); CG\.loadTrades\(\)\.then\(function\(\)\{ CG\.reloadLeague\(\); \}\);/.test(live));
}

console.log("\n— a same-night double-header can't misfile a box score (v2.37: the game window, one shared definition)");
{
  A("the importer files only on an open fixture whose game window holds the match END time (siblings from the pair's whole night)", /let game = fixtureForMatch\(gamesAll, tA, tB, matchEndMs, undefined, undefined, siblings\);/.test(ingest));
  A("...taking the EARLIEST open fixture in window (a 2-2-3 night files each match on its own slot)", /function fixtureForMatch\(fixtures, teamA, teamB, matchEndMs[\s\S]{0,900}\.filter\(pair\)\.sort\(byTime\)\.filter\(/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "shared", "game-window.cjs"), "utf8")));
  A("...a match with no end time is never guessed onto a fixture", /EA gave this match no end time — it cannot be placed in a game window/.test(ingest));
  A("...and the day-either-side fallback is gone from the automatic path (a commissioner replay is the one relaxed caller)", !/days <= 1/.test(ingest) && !/no scheduled game for these clubs within a day of/.test(ingest));
  A("...logged as unmatched, never silently dropped", /await archive\(ctx, norm, raw, "unmatched", why\);/.test(ingest));
  A("the behavior itself is exercised end to end by tools/game-window.test.mjs", require("fs").existsSync(require("path").join(__dirname, "game-window.test.mjs")));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
