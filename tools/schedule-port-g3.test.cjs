/* S2 swap (g3, 2026-11-24): the Season 2 Control Center's schedule generator is the classic one, and writes the same rows.
   Run: node tools/schedule-port-g3.test.cjs

   The classic side is tools/season-games.cjs, which runs CG.generateSchedule straight out of src/live/part_live.js with a
   recording stub. The Season 2 side is S2._control.genRun in src/s2/js/pages/control.js, which runs the copy of the same
   function in src/s2/js/cg-engine.js (tools/s2-engine-build.cjs) against its own recorder; the page then writes exactly
   genRun's rows and season patch through S2.write (tools/ui/control.test.cjs pins that). Both run here on Season 1's real
   settings (the seasons row as read on 2026-11-24: puck drop Sep 23 2026 9 PM ET, 6 weeks, 3 nights, 9:00/9:35/10:10, the
   nine holidays it skips) and the eight clubs in their divisions. The club ids are placeholders: an id only rides along
   on the row, the pairing comes from the codes and their order. When a check fails, fix the code, never the check. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { generate } = require("./season-games.cjs");

let n = 0, fail = 0;
const A = (name, cond, info) => { n++; if (cond) console.log("PASS " + name); else { fail++; console.log("FAIL " + name + (info !== undefined ? " :: " + JSON.stringify(info).slice(0, 400) : "")); } };

const S1 = {
  id: "00000000-0000-4000-8000-0000000005e1", number: 1, name: "Season 1", status: "upcoming", format: "basic",
  preseason_starts_at: null, starts_at: "2026-09-24T01:00:00+00:00", weeks: 6, nights_per_week: 3, night_slots: "21:00,21:35,22:10",
  skip_holidays: ["us-thanksgiving", "new-years-day", "easter", "canada-day", "independence-day", "christmas-eve", "christmas-day", "boxing-day", "new-years-eve"]
};
const CLUBS = [["BOS", "East"], ["DET", "East"], ["NYI", "East"], ["PIT", "East"], ["DAL", "West"], ["SEA", "West"], ["UTA", "West"], ["VAN", "West"]]
  .map(([code, division], i) => ({ id: "00000000-0000-4000-8000-0000000000" + (10 + i), code, division }));

/* the Season 2 page in a sandbox: core's kit stubbed to what control.js touches while it loads, then the engine copy and
   the page itself, each exactly as the site serves them */
function loadPage() {
  const noop = () => {};
  const S2 = {
    esc: (s) => String(s == null ? "" : s), fmt: String, COMMITTEE_DEFS: [], committeeCovers: () => "", page: noop,
    carry: { register: noop, op: (name, fn) => fn }, ic: () => "", chev: () => "", $: () => null, $$: () => [], on: noop
  };
  const win = { S2, addEventListener: noop, removeEventListener: noop, requestAnimationFrame: noop };
  const ctx = { window: win, S2, document: { addEventListener: noop, querySelectorAll: () => [] }, console, Intl, Date, Math, Object, Array, String, Number, JSON,
    setTimeout, clearTimeout, Promise, Element: function () {}, getComputedStyle: () => ({}), CSS: { escape: String } };
  win.window = win;
  vm.createContext(ctx);
  for (const f of ["src/s2/js/cg-engine.js", "src/s2/js/pages/control.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f });
  return S2;
}

(async () => {
  console.log("## the classic generator, Season 1's settings");
  const classic = await generate({ season: S1, teams: CLUBS.map((t) => ({ id: t.id, code: t.code, div: t.division })), divisions: ["East", "West"] }, { stages: ["regular"] });
  const want = classic.games, wantPatch = classic.summary.seasonUpdate;
  A("the classic builds Season 1's 216 games (8 clubs, 54 each)", want.length === 216, want.length);

  console.log("## the Season 2 page's generator, the same inputs");
  const S2 = loadPage();
  A("control.js exposes the ported generator", S2._control && typeof S2._control.genRun === "function");
  const CG = S2.CG, before = { SEASON: CG.SEASON, TEAMS: CG.TEAMS, lg: CG.lg, sb: CG.sb, toast: CG.toast };
  const out = S2._control.genRun(JSON.parse(JSON.stringify(S1)), CLUBS.slice(), []);
  A("it builds a schedule and refuses nothing", !out.refused && out.rows.length > 0, out.refused);
  A("EQUALITY: the same rows, in the same order, field for field", JSON.stringify(out.rows) === JSON.stringify(want),
    (() => { for (let i = 0; i < Math.max(out.rows.length, want.length); i++) if (JSON.stringify(out.rows[i]) !== JSON.stringify(want[i])) return { i, port: out.rows[i], classic: want[i] }; return null; })());
  A("EQUALITY: the same season patch (ends_at, playoffs_start_at) on the same row", out.patch && out.patch.match.id === S1.id && wantPatch &&
    out.patch.set.ends_at === wantPatch.ends_at && out.patch.set.playoffs_start_at === wantPatch.playoffs_start_at && Object.keys(out.patch.set).length === 2, { port: out.patch, classic: wantPatch });
  A("the classic confirm it would have shown is the same (title and summary)", out.ask && /Generate the Season 1 schedule\?/.test(out.ask.title) && /^8 clubs · 54 games each · 3 a night, 9 a week/.test(out.ask.body), out.ask);
  A("S2.CG is handed back exactly as it was lent (season, clubs, league, client, toast)", CG.SEASON === before.SEASON && CG.TEAMS === before.TEAMS && CG.lg === before.lg && CG.sb === before.sb && CG.toast === before.toast);
  const shuffled = CLUBS.slice().reverse();
  A("the clubs' input order does not matter (the classic CG.TEAMS order is applied)", JSON.stringify(S2._control.genRun(S1, shuffled, []).rows) === JSON.stringify(want));
  A("the plan skips no week in Season 1's span and the season ends Fri Oct 30, playoffs Wed Nov 4 9 PM ET",
    out.plan && out.plan.skipped.length === 0 && out.patch.set.ends_at === "2026-10-31T03:59:00.000Z" && out.patch.set.playoffs_start_at === "2026-11-05T02:00:00.000Z", { plan: out.plan && out.plan.skipped, patch: out.patch && out.patch.set });

  console.log("## the rows themselves");
  const per = {}, slot = {};
  out.rows.forEach((r) => { [r.home_team_id, r.away_team_id].forEach((id) => { per[id] = (per[id] || 0) + 1; const k = r.scheduled_at + id; slot[k] = (slot[k] || 0) + 1; }); });
  A("every club plays 54 and nobody twice in one slot", Object.values(per).every((v) => v === 54) && Object.keys(per).length === 8 && Object.values(slot).every((v) => v === 1), per);
  A("each row is exactly what the classic inserts: season, week, stage regular, both ids, the instant, status scheduled",
    out.rows.every((r) => JSON.stringify(Object.keys(r)) === JSON.stringify(["season_id", "week", "stage", "home_team_id", "away_team_id", "scheduled_at", "status"]) && r.season_id === S1.id && r.stage === "regular" && r.status === "scheduled"));

  console.log("## refusals: the classic's own reasons, and the standing order before it");
  const again = S2._control.genRun(S1, CLUBS, [{ stage: "regular" }]);
  A("a season that already has a regular schedule is refused with the classic's reason, without its dash, and no rows", again.refused === "A regular-season schedule already exists: clear it first" && !again.rows.length && !again.patch, again.refused);
  const noStart = S2._control.genRun(Object.assign({}, S1, { starts_at: null }), CLUBS, []);
  A("a season with no puck drop is refused (the classic's reason)", /^Set the season start date in Seasons first/.test(noStart.refused || ""), noStart.refused);
  A("one club is refused (the classic's reason)", /at least two clubs/.test(S2._control.genRun(S1, CLUBS.slice(0, 1), []).refused || ""));
  A("holidays never set (NULL): the standing order refuses before the generator runs", /^Standing order: a season's schedule is never generated before its holidays are set/.test(S2._control.holidayGate(Object.assign({}, S1, { skip_holidays: null })) || ""));
  A("holidays set to skip nothing ([]) are set: no refusal", S2._control.holidayGate(Object.assign({}, S1, { skip_holidays: [] })) === null && S2._control.holidayGate(S1) === null);

  console.log("## Season 2 as ruled (v4.31): the Christmas and New Year weeks are stepped over");
  const S2row = Object.assign({}, S1, { id: "00000000-0000-4000-8000-0000000005e2", number: 2, name: "Season 2", starts_at: "2026-12-17T02:00:00+00:00" });
  const c2 = await generate({ season: S2row, teams: CLUBS.map((t) => ({ id: t.id, code: t.code, div: t.division })), divisions: ["East", "West"] }, { stages: ["regular"] });
  const p2 = S2._control.genRun(S2row, CLUBS, []);
  A("Season 2: equal to the classic too", JSON.stringify(p2.rows) === JSON.stringify(c2.games) && p2.patch.set.playoffs_start_at === c2.summary.seasonUpdate.playoffs_start_at);
  A("Season 2: weeks Dec 16, then Jan 6 to Feb 3; two holiday weeks skipped; playoffs Wed Feb 10", p2.plan.skipped.length === 2 &&
    JSON.stringify(p2.plan.nights.map((w) => w.wed)) === JSON.stringify(["2026-12-16", "2027-01-06", "2027-01-13", "2027-01-20", "2027-01-27", "2027-02-03"]) && p2.patch.set.playoffs_start_at === "2027-02-11T02:00:00.000Z", p2.plan && p2.plan.nights.map((w) => w.wed));

  console.log("## the page source keeps the port honest");
  const src = fs.readFileSync(path.join(__dirname, "../src/s2/js/pages/control.js"), "utf8");
  A("control.js writes the generator's own rows (games.insert of out.rows) and its own patch (seasons.update of out.patch)", /S2\.write\("games\.insert", \{ row: out\.rows \}/.test(src) && /S2\.write\("seasons\.update", \{ set: out\.patch\.set, match: out\.patch\.match/.test(src));
  A("control.js has no rotation of its own (no second generator)", !/function buildSchedule|rrRotate|roundPairs/.test(src));
  A("control.js refuses before generating when the holidays are not set", /var gate = holidayGate\(inp\.season\);\s*\n\s*if \(gate\) return refusal/.test(src));

  console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL the test crashed: " + (e && e.stack || e)); process.exit(1); });
