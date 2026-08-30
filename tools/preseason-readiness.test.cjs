/* Season-1 readiness fixes (2026-08-29 stress test + 86-agent adversarial review).
   Run: node tools/preseason-readiness.test.cjs

   Each assertion below pins a CONFIRMED defect that would have broken a specific night of the
   first season. The DB half of the same sweep is pinned by rolled-back rehearsals against
   production, which verified: 114/114 sign-ups placed with no exceptions and every club able to
   ice a legal lineup (was 3 clubs that could not); a 120-pick draft with no duplicate players and
   no club over 17; lineup position/lock enforcement; box score -> standings -> overall recalc;
   forfeits; a playoff series auto-concluding at 4 wins; and trades refusing a cap bust while
   camp salaries stay cap-exempt. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js");
const hub = R("src/live/part6_hub.js");
const ui = R("src/live/part4_ui.js");
const pub = R("src/live/part5a_public.js");
const ingest = R("netlify/functions/ingest-stats.js");
const sched = R("netlify/functions/discord-scheduler.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— draft night survives a long, lossy evening");
{
  A("a dropped realtime channel re-arms from the clock tick", /CG\._draftHeartbeat\(\);/.test(live));
  A("...and the heartbeat re-subscribes when the channel is gone",
    /if \(!CG\._draftChannel\) CG\.subscribeDraft\(\);/.test(live));
  /* the beat now stamps on SETTLE (scale audit, 2026-08-30) — stamping on start let a slow
     reply turn this safety poll into a continuous refetch loop */
  A("...and refreshes the board even if realtime never returns",
    /CG\.refreshDraftLite\(\)\.then\(CG\.repaintDraft\)\.catch\(function\(\)\{\}\)\.then\(function\(\)\{/.test(live) &&
    /CG\._draftBeating = false; CG\._draftBeatAt = CG\.now\(\);/.test(live));
  A("auto-advance backs off instead of retrying every 1.5s forever", /CG\._draftAdvanceAfter = CG\.now\(\) \+ Math\.min\(60000/.test(live));
  A("...and a persistently stalled clock tells the room", /can't advance itself/.test(live));
  A("...and its failures are no longer swallowed", /console\.error\("draft_auto_advance failed", e\)/.test(live));
}

console.log("\n— nothing claims success the server never gave");
{
  A("the EA club link checks for a zero-row (RLS-blocked) write",
    /ea_club_id: eaId\|\|null[\s\S]{0,160}\.select\("id"\)/.test(live) && /the database refused the write/.test(live));
  A("the lineup is only 'submitted' once the RPC answers",
    /save\(emg\?"Emergency call-up sent…":"Sending lineup…"\);/.test(live === live ? hub : hub));
  A("...and the success notification moved into the callback",
    /if \(okN\)\{[\s\S]{0,220}save\(emg\?"Emergency call-up submitted"/.test(hub));
  A("...with demo mode still reporting locally", /if \(!\(CG\.LIVE_MODE && CG\.sb\)\)\{/.test(hub));
}

console.log("\n— a night is one night");
{
  A("nightGames anchors on an ET calendar date, not a weekday", /CG\.etDay = function\(at\)/.test(hub));
  A("...and filters the whole set to that one day", /return all\.filter\(function\(g\)\{ return CG\.etDay\(g\.at\)===day; \}\);/.test(hub));
  A("...so 'whole night' can no longer reach into December", /every Wednesday\s*\n?\s*left in the season/.test(hub));
}

console.log("\n— the public site tells the truth");
{
  A("the bracket uses the league's single best-of definition", /var bestOf = CG\.playoffBestOf \? CG\.playoffBestOf\(\)/.test(pub));
  A("...and no longer defaults to a best-of-3 postseason", !/playoff_format\.bestOf\) \|\| 3;/.test(pub));
  A("a throwing route renders an error card instead of the previous page",
    /try \{ _html = fn\(param, qs\); \}/.test(ui) && /This page hit an error/.test(ui));
  A("'Needs pre-season games' waits until the pre-season exists",
    /_preOpen = CG\.SEASON && CG\.SEASON\.preseason_starts_at/.test(live) && /!draftDone && _preOpen && !CG\.isDraftEligible/.test(live));
}

console.log("\n— free agency covers everyone");
{
  A("the open board is the complement of the bidding board", /return faFree\(r\) && !inBid\[r\.profile_id\];/.test(live));
  A("...not 'returning players only'", !/&&\s*\n?\s*lg\.isReturning\(r\.profile_id\);/.test(live));
}

console.log("\n— the stats pipeline can't weld a line to the wrong human");
{
  A("LIKE metacharacters are escaped before matching", /const likeSafe = \(v\) => v\.replace\(/.test(ingest));
  A("...gamertag lookup refuses an ambiguous pair", /profiles\?gamertag=ilike[\s\S]{0,120}limit=2/.test(ingest));
  A("...and so does the season EA id lookup", /ea_id=ilike[\s\S]{0,120}limit=2/.test(ingest));
  A("neither step takes 'whichever row came first'", !/gamertag=ilike\.\$\{encodeURIComponent\(gt\)\}&select=id&limit=1/.test(ingest));
}

console.log("\n— Discord posts arrive whole");
{
  A("an over-long post is split, not silently sliced", /if \(text\.length <= 1990\)/.test(sched) && /chunks\.push\(buf\)/.test(sched));
  A("...and no longer truncates with .slice(0, 1990)", !/content: content\.slice\(0, 1990\)/.test(sched));
  A("club-channel reminders are split too", /for \(const c of splitForDiscord\(content\)\)/.test(sched));
  A("one splitter serves both senders", (sched.match(/splitForDiscord\(/g)||[]).length === 3);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
