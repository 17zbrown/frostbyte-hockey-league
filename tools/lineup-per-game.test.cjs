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

const ctx = { console, Math, Object, Array, String, Number, JSON, Date };
ctx.window = ctx; ctx.globalThis = ctx;
const NOW = Date.parse("2026-09-16T18:00:00-04:00");   // 6pm ET on the first pre-season night
ctx.CG = { now: () => NOW, gameNight: (g) => g.night, hqClub: () => "TOR", me: () => ({ team: "TOR" }) };
vm.createContext(ctx);
for (const fn of ["lineupGameFor", "clubUpcomingGames", "nightGames"]) {
  const m = src.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};"));
  if (!m) { A("located CG." + fn, false); process.exit(1); }
  vm.runInContext(m[0], ctx);
}

// TOR plays all three Wednesday slots plus one Thursday game
const wed1 = { id: "11111111-1111-4111-8111-111111111111", home: "TOR", away: "BOS", night: "wed", status: "scheduled", at: Date.parse("2026-09-16T21:00:00-04:00") };
const wed2 = { id: "22222222-2222-4222-8222-222222222222", home: "MTL", away: "TOR", night: "wed", status: "scheduled", at: Date.parse("2026-09-16T21:35:00-04:00") };
const wed3 = { id: "33333333-3333-4333-8333-333333333333", home: "TOR", away: "PIT", night: "wed", status: "scheduled", at: Date.parse("2026-09-16T22:10:00-04:00") };
const thu1 = { id: "44444444-4444-4444-8444-444444444444", home: "TOR", away: "SEA", night: "thu", status: "scheduled", at: Date.parse("2026-09-17T21:00:00-04:00") };
ctx.CG.lg = { schedule: [wed1, wed2, wed3, thu1], tonight: [wed1, wed2, wed3] };

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
  A("...in slot order", wed[0].id === "11111111-1111-4111-8111-111111111111" && wed[2].id === "33333333-3333-4333-8333-333333333333");
  A("Thursday has one", ctx.CG.nightGames("TOR", "thu").length === 1);
  const up = ctx.CG.clubUpcomingGames("TOR");
  A("all four upcoming games are seen", up.length === 4);
  A("...capped when asked", ctx.CG.clubUpcomingGames("TOR", 2).length === 2);
}

console.log("\n— the old single-game-per-night resolution is gone from the write paths");
{
  A("the per-night dress button now keys on the night, dressing all its games",
    /var night = el\.getAttribute\("data-night"\)/.test(src) && /dressNight\(night, slot, function\(err, okN\)/.test(src));
  A("...via a helper that loops every not-yet-locked game", /function dressNight\(nightKey, slot, done\)\{[\s\S]{0,260}CG\.nightGames\(club, nightKey\)/.test(src));
  A("Dress-the-week dresses whole nights, not first games", /dressNight\(n\.key, pl, function\(err, dressed\)/.test(src));
  A("the builder switcher is per game", /href="#\/hub\/lineup\?game='\+g\.id/.test(src));
  A("the tasks tile counts all of tonight's games", /subN \+ ' \/ ' \+ tonightGs\.length \+ ' submitted'/.test(src) || /subN\+' \/ '\+tonightGs\.length/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
