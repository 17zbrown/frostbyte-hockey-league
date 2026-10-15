/* Every game of a night is addressable and dressable — not just the first.
   Run: node tools/lineup-per-game.test.cjs

   The bug this pins: with three games a night (21:00 / 21:35 / 22:10), every lineup write path
   resolved to the EARLIEST non-final game of the night. Games 2 and 3 lock (T-30) before game 1
   finals, so no one could ever submit a lineup for two-thirds of every night's games — starting
   with the first pre-season night, Sept 16. Verified by driving CG.lineupGameFor / clubUpcomingGames
   / nightGames with a real three-games-a-night fixture. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part6_hub.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const ctx = { console, Math, Object, Array, String, Number, JSON, Date, Intl };
ctx.window = ctx; ctx.globalThis = ctx;
const NOW = Date.parse("2026-09-16T18:00:00-04:00");   // 6pm ET on the first pre-season night
ctx.CG = { now: () => NOW, gameNight: (g) => g.night, hqClub: () => "TOR", me: () => ({ team: "TOR" }) };
vm.createContext(ctx);
for (const fn of ["lineupGameFor", "clubUpcomingGames", "clubWeekGames", "isMakeUp", "etDay", "nightGames"]) {
  const m = src.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};"));
  if (!m) { A("located CG." + fn, false); process.exit(1); }
  vm.runInContext(m[0], ctx);
}

// TOR plays all three Wednesday slots plus one Thursday game
const wed1 = { id: "11111111-1111-4111-8111-111111111111", home: "TOR", away: "BOS", night: "wed", status: "scheduled", at: Date.parse("2026-09-16T21:00:00-04:00") };
const wed2 = { id: "22222222-2222-4222-8222-222222222222", home: "MTL", away: "TOR", night: "wed", status: "scheduled", at: Date.parse("2026-09-16T21:35:00-04:00") };
const wed3 = { id: "33333333-3333-4333-8333-333333333333", home: "TOR", away: "PIT", night: "wed", status: "scheduled", at: Date.parse("2026-09-16T22:10:00-04:00") };
const thu1 = { id: "44444444-4444-4444-8444-444444444444", home: "TOR", away: "SEA", night: "thu", status: "scheduled", at: Date.parse("2026-09-17T21:00:00-04:00") };
/* NEXT week's Wednesday: "whole night" used to match on the weekday alone and swept these in too,
   dressing games weeks away — the checkbox reported "3 games" and wrote ~45. */
const wedNext1 = { id: "55555555-5555-4555-8555-555555555555", home: "TOR", away: "VAN", night: "wed", status: "scheduled", at: Date.parse("2026-09-23T21:00:00-04:00") };
const wedNext2 = { id: "66666666-6666-4666-8666-666666666666", home: "PIT", away: "TOR", night: "wed", status: "scheduled", at: Date.parse("2026-09-23T21:35:00-04:00") };
ctx.CG.lg = { schedule: [wed1, wed2, wed3, thu1, wedNext1, wedNext2], tonight: [wed1, wed2, wed3] };

function hashTo(qs) { ctx.location = { hash: "#/hub/lineup" + (qs ? "?" + qs : "") }; }

console.log("— every game of the night is reachable by id");
{
  hashTo("game=22222222-2222-4222-8222-222222222222"); A("?game= jumps straight to the 21:35 game", ctx.CG.lineupGameFor(ctx.CG.me()).id === "22222222-2222-4222-8222-222222222222");
  hashTo("game=33333333-3333-4333-8333-333333333333"); A("...and to the 22:10 game", ctx.CG.lineupGameFor(ctx.CG.me()).id === "33333333-3333-4333-8333-333333333333");
  hashTo("game=44444444-4444-4444-8444-444444444444"); A("...and to tomorrow's game", ctx.CG.lineupGameFor(ctx.CG.me()).id === "44444444-4444-4444-8444-444444444444");
  hashTo(""); A("with no query it still lands on a real game", !!ctx.CG.lineupGameFor(ctx.CG.me()));
  hashTo("game=does-not-exist"); A("a bogus id falls back rather than crashing", !!ctx.CG.lineupGameFor(ctx.CG.me()));
}

console.log("\n— the night is all its games, not one");
{
  const wed = ctx.CG.nightGames("TOR", "wed");
  A("Wednesday has all three TOR games", wed.length === 3, wed.map((g) => g.id).join(","));
  A("...and ONLY tonight's — not next Wednesday's as well",
    !wed.some((g) => g.id.startsWith("55555555") || g.id.startsWith("66666666")));
  A("...in slot order", wed[0].id === "11111111-1111-4111-8111-111111111111" && wed[2].id === "33333333-3333-4333-8333-333333333333");
  A("Thursday has one", ctx.CG.nightGames("TOR", "thu").length === 1);
  const up = ctx.CG.clubUpcomingGames("TOR");
  A("all six upcoming games are seen", up.length === 6);
  /* v4.07: there is no cap any more; a week is a week, however many games it holds */
  A("...and no count cap exists to ask for", ctx.CG.clubUpcomingGames("TOR", 2).length === 6 && !/clubUpcomingGames = function\(club, limit\)/.test(src));
}

/* v4.07, commissioner 2026-10-14: "They should still have all their normal games, just the rescheduled game tacked on
   after the fact." The game lineup page took a club's next NINE games for its buttons, so DAL and NYI, each with ten in
   Week 4 (the Fri Oct 9 game made up Wed Oct 14 at 8:25 PM), had no button for their Fri Oct 16 10:10 PM game. Real
   ids and times from the database. */
console.log("\n— a week with a make-up game: every game has its button (v4.07)");
{
  const ET = (s) => Date.parse(s + "-04:00");
  const nowWas = ctx.CG.now, schedWas = ctx.CG.lg;
  ctx.CG.now = () => ET("2026-10-14T19:44:00");
  const W4 = [
    ["d6359d09-9414-4bea-9f67-9a153b01ee49", "DAL", "NYI", "2026-10-14T20:25:00", Date.parse("2026-10-09T21:00:00-04:00")],
    ["79e725e9-5cbd-44bb-a92e-b7032b1bd7c8", "DAL", "DET", "2026-10-14T21:00:00"], ["a48f8421-7414-44a0-aaeb-e789f62a2b17", "PIT", "DAL", "2026-10-14T21:35:00"],
    ["ce3fbf7e-ddb7-429a-b0e2-fc9361e12ec5", "SEA", "DAL", "2026-10-14T22:10:00"], ["4f4d5a2c-304c-4da9-b1f3-8a020af4320d", "DAL", "VAN", "2026-10-15T21:00:00"],
    ["fbe9a7e7-cb21-4de0-aed3-71c17e05972a", "NYI", "DAL", "2026-10-15T21:35:00"], ["77035c24-65e2-4f6d-89f7-57de544b2a09", "BOS", "DAL", "2026-10-15T22:10:00"],
    ["1bf9e6a2-ff9b-4d88-8886-aeae390cf078", "DAL", "UTA", "2026-10-16T21:00:00"], ["b516833a-2cb3-4416-a71d-04365e5805b5", "DET", "DAL", "2026-10-16T21:35:00"],
    ["b6651e64-af5a-4795-94bb-4c86a2833432", "DAL", "PIT", "2026-10-16T22:10:00"],
    /* PIT's own nine-game week, for the club that has no make-up */
    ["8cac9db2-3a91-467a-bb78-a56716a72c12", "PIT", "NYI", "2026-10-14T21:00:00"], ["p3", "PIT", "UTA", "2026-10-14T22:10:00"],
    ["p4", "DET", "PIT", "2026-10-15T21:00:00"], ["p5", "BOS", "PIT", "2026-10-15T21:35:00"], ["p6", "PIT", "SEA", "2026-10-15T22:10:00"],
    ["p7", "VAN", "PIT", "2026-10-16T21:00:00"], ["0ed8e782-5e2d-45dc-bbb8-84c3b1e1a2fb", "NYI", "PIT", "2026-10-16T21:35:00"],
  ].map(([id, home, away, at, from]) => ({ id, home, away, week: 4, stage: "regular", status: "scheduled", at: ET(at), rescheduledFrom: from || null, night: "x" }));
  const W5 = [["f4ea37f9-928f-4184-aca0-209b7e2ea117", "DAL", "SEA", "2026-10-21T21:00:00"], ["f764542f-da82-4c82-9958-831b94341c89", "PIT", "DAL", "2026-10-23T21:00:00"]]
    .map(([id, home, away, at]) => ({ id, home, away, week: 5, stage: "regular", status: "scheduled", at: ET(at), night: "x" }));
  ctx.CG.lg = { schedule: W4.concat(W5), tonight: [] };
  const dal = ctx.CG.clubWeekGames("DAL", W4[0]);
  A("DAL's week shows all ten games, the make-up on top of the normal nine", dal.length === 10, dal.length + " games");
  A("...including Fri Oct 16 10:10 PM, the game the nine-cap dropped", dal.some((g) => g.id === "b6651e64-af5a-4795-94bb-4c86a2833432"));
  A("...and nothing from the next week", !dal.some((g) => g.week === 5));
  A("...in time order, the make-up first", dal[0].id === "d6359d09-9414-4bea-9f67-9a153b01ee49" && dal[9].id === "b6651e64-af5a-4795-94bb-4c86a2833432");
  A("PIT (no make-up) still shows its own week, nothing more", ctx.CG.clubWeekGames("PIT", null).every((g) => g.week === 4 && (g.home === "PIT" || g.away === "PIT")));
  const nextWk = ctx.CG.clubWeekGames("DAL", W5[0]);
  A("opened on a next-week game, that week comes too", nextWk.length === 12 && nextWk.some((g) => g.id === W5[0].id));
  ctx.CG.now = () => ET("2026-10-14T23:30:00");
  const late = ctx.CG.clubWeekGames("DAL", W4[0]);
  A("the open game keeps its button even after it leaves the upcoming window", late.some((g) => g.id === W4[0].id));
  ctx.CG.now = nowWas; ctx.CG.lg = schedWas;
  A("the lineup page's buttons come from the week, not a count",
    /var upcoming = CG\.clubWeekGames\(club, game\);/.test(src) && !/clubUpcomingGames\(club, \d+\)/.test(src));
  A("...and a moved game's button says where it came from", /\(mu \? ", make-up of " : ", moved from "\)\+CG\.fmtDay\(g\.rescheduledFrom\)/.test(src));
  A("...with a make-up marked on the button itself, not only in a tooltip phones never show", /\(mu\?' · make-up':''\)/.test(src));
  /* review, v4.07: only a game moved LATER into another game-week is a make-up */
  const mv = (from, at) => ({ rescheduledFrom: ET(from), at: ET(at) });
  A("the Oct 9 game played Oct 14 is a make-up", ctx.CG.isMakeUp(W4[0]) === true);
  A("a game pulled EARLIER into this week is moved, not a make-up", ctx.CG.isMakeUp(mv("2026-10-21T21:00:00", "2026-10-15T20:25:00")) === false);
  A("a game nudged within its night is moved, not a make-up", ctx.CG.isMakeUp(mv("2026-10-21T21:00:00", "2026-10-21T21:15:00")) === false);
  A("a game moved later but inside its own week is moved, not a make-up", ctx.CG.isMakeUp(mv("2026-10-14T21:00:00", "2026-10-16T22:45:00")) === false);
  A("a game nobody moved is neither", ctx.CG.isMakeUp(W4[1]) === false && ctx.CG.isMakeUp(null) === false);
}

console.log("\n— the old single-game-per-night resolution is gone from the write paths");
{
  A("the per-night dress button now keys on the night, dressing all its games",
    /var night = el\.getAttribute\("data-night"\)/.test(src) && /dressNight\(night, null, function\(err, okN, qN\)/.test(src));
  /* v2.84: the night's games now come through the picker, whose DEFAULT is every open game of
     the night; a club may narrow it to one or two, which is the point, but never to the first
     game by accident. */
  /* v2.89: dressNight walks the night's OPEN games and gives each the line set for it */
  A("...via a helper that walks the night's open games",
    /function dressNight\(nightKey, slot, done\)\{[\s\S]{0,420}CG\.lcOpenGames\(club, nightKey\)\.filter\(function\(g\)\{ return CG\.lcGameSlot\(club, nightKey, g\.id\) != null; \}\)/.test(src));
  A("...and each game is submitted with ITS OWN line",
    /dressGame\(games\[i\]\.id, CG\.lcGameSlot\(club, nightKey, games\[i\]\.id\)/.test(src));
  A("...with the open set still every not-yet-locked game of the night",
    /CG\.lcOpenGames = function\(club, nightKey\)\{[\s\S]{0,220}CG\.nightGames\(club, nightKey\)\.filter/.test(src));
  A("Dress-the-week dresses whole nights, not first games", /dressNight\(n\.key, null, function\(err, dressed, queued\)/.test(src));
  A("the builder switcher is per game", /href="#\/hub\/lineup\?game='\+g\.id/.test(src));
  A("the tasks tile counts all of tonight's games", /subN \+ ' \/ ' \+ tonightGs\.length \+ ' submitted'/.test(src) || /subN\+' \/ '\+tonightGs\.length/.test(src));
}

console.log("\n— the whole-night checkbox and its submit path");
{
  A("the builder renders a whole-night checkbox when the night has >1 game",
    /id="luWholeNight"/.test(src) && /whole night \('\+nightGs\.length\+' games\)/.test(src));
  /* v3.05: there is no emergency mode any more. The one state that suppresses it is a game
     already under way, which is also when the sheet stops being editable at all. */
  A("...never once the game is under way", /if \(shut \|\| nightGs\.length < 2\) return "";/.test(src));
  A("checked, the submit targets every not-yet-locked game of the night",
    /wholeNight[\s\S]{0,120}CG\.nightGames\(club, CG\.gameNight\(game\)\)\.filter\(CG\.lcDressable\)/.test(src)
    && /CG\.lcDressable = function\(g\)\{ return CG\.role\(\)==="commish" \? !CG\.gameUnderWay\(g\) : CG\.now\(\) < g\.at - 30\*60000; \};/.test(src));   /* v3.79: a club until T-30, the office until under way */
  A("...submitting the current game as emergency if it is, the rest normally",
    /p_emergency:\(g\.id===game\.id\?emg:false\)/.test(src));
  A("...and reports per-game refusals without aborting the batch", /errs\.push\(CG\.fmtTime\(g\.at\)/.test(src));
  A("the reveal copy says T-30, not 60 minutes",
    !/60 minutes before puck drop/.test(src) && /published to the opponent when the sheet locks, 30 minutes/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
