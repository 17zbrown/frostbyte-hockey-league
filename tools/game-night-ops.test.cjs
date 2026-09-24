/* v2.78 — game-night operations: the lobby codes reaching a tab that was open before they
   released, the availability week's night keys, the emergency-call-up door, the office's
   readiness card, the club reminders landing before the lock, and a resumed game that ends level.
   Run: node tools/game-night-ops.test.cjs

   Pins, each of them a defect found in the September 22 audit the night before Season 1's first
   games: a code that never arrived without a manual refresh; a night key that shifted as soon as
   a night went final, so the rest of the week's answers read as "no answer"; an emergency button
   still offered after the database had closed the door; a readiness card frozen at the moment the
   page was opened; a reminder that could land after the lineups had locked; and a Rule 4.3 merge
   that could file a tie in a league with no ties. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), pub = R("src/live/part5b_public2.js");
const sched = R("netlify/functions/discord-scheduler.js"), poll = R("bot/ea-poll.mjs"), ingest = R("netlify/functions/ingest-stats.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* ---- the code watch, run for real ---- */
const block = live.slice(live.indexOf("CG.refreshCodes = function"), live.indexOf("CG.buildLiveLeague = async function"));
function world(over){
  const now = over.now, ivs = [];
  const CG = {
    now: () => now, sb: {}, lg: { schedule: over.schedule },
    _codesToday: () => Promise.resolve({ data: over.codes || [] }),
    role: () => over.role || "member",
    me: () => over.me || null,
    myManagedTeam: () => over.managed || null,
    myClub: () => { throw new Error("armCodeWatch must not use CG.myClub — it invents a club for the unaffiliated"); },
    rerenderKeepScroll: () => { CG._repaints = (CG._repaints || 0) + 1; },
  };
  const ctx = {
    CG, Date, Math, Infinity, Promise, console,
    document: { visibilityState: over.hidden ? "hidden" : "visible", getElementById: () => over.overlay ? { innerHTML: "<div>x</div>" } : null },
    window: { pageYOffset: 0, scrollTo: () => {} },
    setInterval: (fn, ms) => { ivs.push({ fn, ms, live: true }); return ivs.length; },
    clearInterval: (h) => { if (ivs[h - 1]) ivs[h - 1].live = false; },
  };
  vm.createContext(ctx); vm.runInContext(block, ctx);
  return { CG, ivs };
}
const T = Date.parse("2026-09-23T21:00:00-04:00");
const night = () => ([
  { id: "g1", at: T, status: "scheduled", home: "BOS", away: "TOR", code: null, server: null },
  { id: "g2", at: T + 35 * 60000, status: "scheduled", home: "NYR", away: "DAL", code: null, server: null },
]);

console.log("— CG.refreshCodes: the masked view is re-read in place");
{
  const w = world({ now: T - 20 * 60000, schedule: night(), codes: [{ id: "g1", game_code: "ABC123", server: "NA Central" }] });
  return w.CG.refreshCodes().then((n) => {
    A("the code lands on the game already in memory", n === 1 && w.CG.lg.schedule[0].code === "ABC123" && w.CG.lg.schedule[0].server === "NA Central");
    A("...and the page is repainted once, not rebuilt", w.CG._repaints === 1);
    const same = world({ now: T, schedule: [{ ...night()[0], code: "ABC123", server: "NA Central" }], codes: [{ id: "g1", game_code: "ABC123", server: "NA Central" }] });
    return same.CG.refreshCodes().then((m) => {
      A("nothing changed means nothing repaints (no flicker every minute)", m === 0 && !same.CG._repaints);
      const over = world({ now: T, schedule: night(), codes: [{ id: "g1", game_code: "ABC123" }], overlay: true });
      return over.CG.refreshCodes().then(() => {
        A("a dialog on screen keeps its place: the code is stored, the repaint waits", over.CG.lg.schedule[0].code === "ABC123" && !over.CG._repaints);
        rest();
      });
    });
  });
}

function rest(){
console.log("\n— CG.armCodeWatch: who it arms for, and when it stops");
{
  const guest = world({ now: T - 60 * 60000, schedule: night(), role: "guest" });
  guest.CG.armCodeWatch();
  A("a signed-out visitor never polls (the view answers null for them by design)", guest.ivs.length === 0);

  const stranger = world({ now: T - 60 * 60000, schedule: night(), role: "member", me: { id: "u1", team: null } });
  stranger.CG.armCodeWatch();
  A("a member with no club and no game tonight does not poll", stranger.ivs.length === 0);

  const club = world({ now: T - 60 * 60000, schedule: night(), role: "member", me: { id: "u1", team: "BOS" } });
  club.CG.armCodeWatch();
  A("a player whose club plays tonight is watched", club.ivs.length === 1 && club.ivs[0].ms === 60000);

  const office = world({ now: T - 60 * 60000, schedule: night(), role: "commish", me: { id: "c1", team: null } });
  office.CG.armCodeWatch();
  A("the league office is watched for every game", office.ivs.length === 1);

  const late = world({ now: T + 3 * 3600000, schedule: night(), role: "commish" });
  late.CG.armCodeWatch();
  A("hours after the last puck drop nothing is armed", late.ivs.length === 0);
}

console.log("\n— the night's answers keep their keys");
A("the week's nights are built from the whole schedule, not the unplayed remainder",
  /schedule\.filter\(function\(g\)\{ return \(g\.week\|\|1\)===avWk && \(g\.stage\|\|"regular"\)===avStage; \}\)\.forEach/.test(live)
  && !/futureG\.filter\(function\(g\)\{ return \(g\.week\|\|1\)===avWk/.test(live));

console.log("\n— the emergency call-up door (Rule 5.3)");
A("one definition of when it closes, ten minutes after puck drop", /CG\.emergencyClosed = function\(g\)\{ return CG\.now\(\) >= \(g\.at \|\| Date\.parse\(g\.scheduled_at\)\) \+ 10\*60000; \};/.test(pub));
A("the header stops offering the button once it is shut", /CG\.emergencyClosed\(game\)\s*\n?\s*\? '<span class="caption">The door closed 10 minutes after puck drop/.test(hub));
A("...and the submit handler says so rather than letting the RPC refuse", /if \(pastLock && CG\.emergencyClosed\(game\)\)\{ CG\.toast\("Emergency call-ups closed 10 minutes after puck drop/.test(hub));
/* v2.81: the door costs one in-game minor per player changed (Rule 5.3 second paragraph). Every
   place that offers it must say so, or it reads as a free grace period. The submit confirm always
   did; the button, the banner, the locked-edit refusal and the confirm that OPENS the mode did not. */
A("the price is named where the mode is opened", /Each player you change costs the club ONE IN-GAME MINOR, served in this game/.test(hub));
A("...on the banner that stays on screen while it is open", /Each player you change costs the club one in-game minor, served in this game<\/b>/.test(hub));
A("...on the button that opens it", /title="Swap a player after the lock: one in-game minor per player changed \(Rule 5\.3\)"/.test(hub));
A("...and when an edit to a locked sheet is refused", /An emergency call-up can still swap a player, at one in-game minor per player changed/.test(hub));
A("...and the submit confirm still does", /EACH player changed costs the club one in-game penalty, served in this game \(Rule 5\.3\)/.test(hub));
A("nothing offers the door as free", !/emergency call-up to swap a player now/.test(hub) && !/The change is recorded against the club\./.test(hub));
{
  const src = pub.slice(pub.indexOf("CG.emergencyClosed = function"), pub.indexOf("\n", pub.indexOf("CG.emergencyClosed = function")));
  const CG = { now: () => T + 9 * 60000 }; new Function("CG", src)(CG);
  A("open at nine minutes past", CG.emergencyClosed({ at: T }) === false);
  const CG2 = { now: () => T + 11 * 60000 }; new Function("CG", src)(CG2);
  A("shut at eleven", CG2.emergencyClosed({ at: T }) === true);
}

console.log("\n— the desk cards that people watch a game night through");
/* v2.97: the same night-vs-game distinction on the resolver call. Rule 4.2 settles a night
   together; gating on each game's own T-30 left the later games reading "resolving..." for an
   hour after the database had answered. */
A("the browser asks the resolver on the NIGHT's lock, not each game's own",
  /var lock = CG\.codeReleaseAt \? CG\.codeReleaseAt\(g\) : g\.at - \(CG\.VETO_LOCK_MS\|\|1800000\);/.test(live));
A("the club's schedule reads the NIGHT's release, not each game's own puck drop",
  /var codeReleased = CG\.now\(\) >= \(CG\.codeReleaseAt \? CG\.codeReleaseAt\(g\) : g\.at - 30\*60000\);/.test(live));
A("the office's readiness card repaints itself every 30 seconds", /CG\._readyIv = setInterval\(function\(\)\{/.test(live) && /\}, 30000\);/.test(live.slice(live.indexOf("CG._readyIv = setInterval"))));
A("...and stops when the office leaves the page or a dialog opens",
  /location\.hash\.indexOf\("\/admin\/schedule"\) < 0\)\{ clearInterval\(CG\._readyIv\)/.test(live)
  && /if \(ov && ov\.innerHTML\.trim\(\)\) return;/.test(live.slice(live.indexOf("CG._readyIv = setInterval"), live.indexOf("CG._readyIv = setInterval") + 700)));

console.log("\n— the club's game-night post waits for the night to lock");
/* Commissioner's ruling (2026-09-23), reversing the v2.78 lead: the post must WAIT for the night
   to lock so the codes and the settled servers can be in ONE message. A lead constant here would
   be the old bug. The gate is the database's night board, not this file's clock. */
A("there is no early-lead constant left", !/REMINDER_LEAD_MAX/.test(sched));
A("the post is gated on the night board, not on a clock", /await sbRpc\("night_board", \{ p_day: ymd \}\)/.test(sched));
A("an empty board posts nothing and says when the night locks",
  /if \(!Array\.isArray\(board\) \|\| !board\.length\) \{/.test(sched) && /nothing to post yet/.test(sched));
A("one message carries the time, the server and the code", /\$\{srv\} \u00b7 \$\{code\}/.test(sched));
A("a voided game is not announced", /for \(const g of games\) \{\n    if \(g\.voided\) continue;/.test(sched));
A("the window closes when the night's LAST game starts, so a dead cron cannot post at midnight",
  /\.find\(\(d\) => Math\.max\(\.\.\.nights\[d\]\.map\(\(g\) => Date\.parse\(g\.scheduled_at\)\)\) > nowMs\)/.test(sched));
A("the whole night goes in one post, claimed once per club per night", /claim\("game_reminder", ref\)/.test(sched) && /const ref = `\$\{tid\}:\$\{ymd\}`;/.test(sched));
A("a club with no Discord room is REPORTED, not skipped in silence", /errors\.push\(\{ gameReminder: /.test(sched));

console.log("\n— a Rule 4.3 merge that ends level");
A("the officials are told, with the rule and where to rule on it", /Resumed game ended level/.test(ingest) && /Rule 4\.1/.test(ingest) && /Stats manager/.test(ingest));
A("it rides as a warning, not an error (the import worked)", /summary\.warnings = summary\.warnings \|\| \[\]/.test(ingest) && /warnings: \[\] \};/.test(ingest));
A("...and the poller keeps the run green while still recording it",
  /const ingestWarns = Array\.isArray\(out\.warnings\) \? out\.warnings : \[\];/.test(poll)
  && /const ok = clubErrors\.length === 0 && ingestOk;/.test(poll)
  && /ingestWarning: /.test(poll));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
}
