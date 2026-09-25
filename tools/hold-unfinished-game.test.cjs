/* v3.18 — a sitting that did not reach the end of regulation is not a result.
 *
 * SEA v PIT, Sep 24: a 40-minute sitting was filed as SEA 2 PIT 3 and announced; the continuation
 * merged to the true SEA 4 PIT 3 twelve minutes later. The winner had flipped.
 *
 * The end-to-end behaviour (hold, then merge, then final) is exercised for real in
 * tools/game-window.test.mjs against the importer. This file pins the wiring and the record.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const ing = R("netlify/functions/ingest-stats.js");
const sync = R("netlify/functions/discord-sync.js");
const rec = R("sql/2026-09-25-hold-unfinished-games.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const iflat = ing.replace(/\s+/g, " ");

console.log("\n— the gate");
{
  A("completeness is decided before anything is published",
    /const complete = elapsed >= REGULATION_S \|\| !!norm\.went_ot;/.test(ing));
  A("...from the clock the merge already used", /const elapsed = segElapsed\(norm\);/.test(ing));
  A("a short sitting still writes its box score", /The box score is still written/i.test(iflat));
  A("...and still claims the fixture", /still stamped so the fixture is claimed/.test(iflat));
  A("...but publishes NO status and NO score",
    /\{ ea_match_id: norm\.ea_match_id,\s+home_ppg: homeClub\.ppg/.test(ing));
  A("...so the Discord post never fires", /notify_discord_game_final never fires/.test(iflat));
  A("the archive says incomplete", /archive\(ctx, norm, raw, "incomplete", why, game\.id\)/.test(ing));
  A("...and says how much was played", /of \$\{Math\.round\(REGULATION_S \/ 60\)\} minutes played/.test(ing));
}

console.log("\n— EA's own flag is carried, as a second witness");
{
  A("normalizeMatch reads winnerByDnf and winnerByGoalieDnf",
    /\+\(c\.winnerByDnf \|\| 0\) === 1 \|\| \+\(c\.winnerByGoalieDnf \|\| 0\) === 1/.test(ing));
  A("...surfaced on the match", /dnf: clubs\.some\(\(c\) => c\.dnf\)/.test(ing));
  A("...and named in the reason when a game is held", /EA flagged a disconnect/.test(ing));
}

console.log("\n— the merge must still be able to find it, which is the part that could have broken");
{
  A("the candidate search takes scheduled games too", /status=in\.\(final,scheduled\)/.test(ing));
  A("...but only ones that have taken a sitting", /ea_match_id=not\.is\.null/.test(ing));
  A("...with the reason recorded", /an untouched game is never a merge target/.test(iflat));
  /* the bug the test caught: without this the held game merges and never becomes a result */
  A("the automatic merge now sets status final",
    /\{ status: "final", home_score: homeClub\.score, away_score: awayClub\.score, went_ot: !!merged\.went_ot/.test(ing));
  A("...and says why that is no longer redundant",
    /without the status the game would carry a correct merged score and never actually be a result/.test(iflat));
}

console.log("\n— a held game is never held in silence");
{
  A("the sweep exists and is called", /rpc\/review_held_games/.test(sync));
  A("...from the scheduled sync", /sum\.heldGames = held\.map/.test(sync));
  A("...and a failure is reported", /sum\.errors\.push\(\{ heldGames:/.test(sync));
  A("the reason is recorded at the call site", /abandoned rather than disconnected/.test(sync.replace(/\s+/g, " ")));
}

console.log("\n— the decision record");
{
  A("it names the game and both times", /SEA v PIT/.test(flat) && /10:02:40 PM/.test(flat) && /10:14:40 PM/.test(flat));
  A("it says the winner flipped", /THE WINNER FLIPPED/.test(flat));
  A("it names both signals EA gave", /clock read 2400 of 3600/.test(flat) && /winnerByDnf and winnerByGoalieDnf were both 1/.test(flat));
  A("it explains why it was not a one-line fix", /`final` was load-bearing for the merge/.test(flat));
  A("...and what holding alone would have broken", /the game would never have filed at all/.test(flat));
  A("it records the bug the test caught", /The test caught it; nothing else would have/.test(flat));
  A("the already-announced score is covered too", /posts when the SCORE CHANGES on a game that is already final/.test(flat));
  A("...and that it was rehearsed", /a no-op update stays silent/.test(flat));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
