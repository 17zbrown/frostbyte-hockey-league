/* tools/season-games.cjs — the out-of-browser schedule generator, pinned against Season 1.
   Run: node tools/season-games.test.cjs

   The script runs the REAL CG.generateSchedule out of src/live/part_live.js, so what these
   assertions actually pin is the site's generator: the counts, the holiday skipping, the ET slot
   times, the home/away split. If one of them fails after a generator change, the site changed
   too — decide whether the rulebook's season shape moved with it before "fixing" the test. */
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "season-games.cjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "season-games-"));

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x !== undefined && !p ? "  — " + x : ""}`); };

/* ---- the Season 1 input: ten placeholder clubs in two divisions of five ---- */
const SEASON_ID = "00000000-0000-4000-8000-00000000c001";
const TEAMS = [
  ["00000000-0000-4000-8000-0000000000e1", "BOS", "East"], ["00000000-0000-4000-8000-0000000000e2", "BUF", "East"],
  ["00000000-0000-4000-8000-0000000000e3", "MTL", "East"], ["00000000-0000-4000-8000-0000000000e4", "OTT", "East"],
  ["00000000-0000-4000-8000-0000000000e5", "TOR", "East"], ["00000000-0000-4000-8000-0000000000a1", "CGY", "West"],
  ["00000000-0000-4000-8000-0000000000a2", "EDM", "West"], ["00000000-0000-4000-8000-0000000000a3", "SEA", "West"],
  ["00000000-0000-4000-8000-0000000000a4", "VAN", "West"], ["00000000-0000-4000-8000-0000000000a5", "WPG", "West"]
].map(([id, code, div]) => ({ id, code, div }));
const CODE = {}; TEAMS.forEach((t) => { CODE[t.id] = t.code; });
const SKIP = ["remembrance-day", "us-thanksgiving", "new-years-day", "easter", "canada-day", "independence-day",
  "christmas-eve", "christmas-day", "boxing-day", "new-years-eve"];
const season1 = (over) => ({
  season: Object.assign({
    id: SEASON_ID, number: 1, name: "Season 1",
    preseason_starts_at: "2026-09-17T01:00:00+00:00", starts_at: "2026-10-08T01:00:00+00:00",
    weeks: 8, nights_per_week: 3, night_slots: "21:00,21:35,22:10",
    skip_holidays: SKIP, div_games: 36, nondiv_games: 36
  }, over || {}),
  teams: TEAMS.slice(),
  divisions: ["East", "West"]
});

let nfile = 0;
const run = (input, args) => {
  const f = path.join(tmp, "in" + (++nfile) + ".json");
  fs.writeFileSync(f, JSON.stringify(input));
  const r = spawnSync(process.execPath, [SCRIPT, f].concat(args || []), { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: r.status === 0 && r.stdout ? JSON.parse(r.stdout) : null };
};

const etDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));
const etTime = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

console.log("— Season 1: the shape the league actually played");
const base = run(season1(), ["--seed", "1"]);
A("the script exits 0", base.status === 0, base.stderr);
if (!base.json){ console.log("FAIL no output — cannot continue"); console.log(base.stderr); process.exit(1); }
const { games, summary } = base.json;
const pre = games.filter((g) => g.stage === "preseason"), reg = games.filter((g) => g.stage === "regular");

A("90 pre-season games (2 weeks x 3 nights x 15)", pre.length === 90 && summary.preseason === 90, pre.length);
A("360 regular-season games (8 weeks x 45)", reg.length === 360 && summary.regular === 360, reg.length);
A("450 rows in all, nothing of another stage", games.length === 450 && games.every((g) => g.stage === "preseason" || g.stage === "regular"), games.length);

{
  const per = (rows) => { const m = {}; rows.forEach((g) => { m[g.home_team_id] = (m[g.home_team_id] || 0) + 1; m[g.away_team_id] = (m[g.away_team_id] || 0) + 1; }); return m; };
  const pp = per(pre), pr = per(reg);
  A("every club plays 18 pre-season games", TEAMS.every((t) => pp[t.id] === 18), JSON.stringify(pp));
  A("every club plays 72 regular-season games", TEAMS.every((t) => pr[t.id] === 72), JSON.stringify(pr));
  A("summary.perClubRegular says 72 for all ten codes", TEAMS.every((t) => summary.perClubRegular[t.code] === 72) && Object.keys(summary.perClubRegular).length === 10, JSON.stringify(summary.perClubRegular));
  A("summary.perClubPreseason says 18 for all ten codes", TEAMS.every((t) => summary.perClubPreseason[t.code] === 18) && Object.keys(summary.perClubPreseason).length === 10, JSON.stringify(summary.perClubPreseason));
}

console.log("— rows are what the browser inserts");
{
  const want = ["away_team_id", "home_team_id", "scheduled_at", "season_id", "stage", "status", "week"];
  A("every row has exactly season_id, week, stage, home_team_id, away_team_id, scheduled_at, status",
    games.every((g) => JSON.stringify(Object.keys(g).sort()) === JSON.stringify(want)), JSON.stringify(Object.keys(games[0]).sort()));
  A("every row belongs to the season", games.every((g) => g.season_id === SEASON_ID));
  A("every row is status 'scheduled'", games.every((g) => g.status === "scheduled"));
  A("every team id is one of the ten clubs and no club plays itself",
    games.every((g) => CODE[g.home_team_id] && CODE[g.away_team_id] && g.home_team_id !== g.away_team_id));
  A("scheduled_at is a UTC ISO string", games.every((g) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(g.scheduled_at)), games[0].scheduled_at);
  A("week numbers run 1..2 pre-season and 1..8 regular",
    pre.every((g) => g.week >= 1 && g.week <= 2) && reg.every((g) => g.week >= 1 && g.week <= 8) &&
    new Set(reg.map((g) => g.week)).size === 8 && new Set(pre.map((g) => g.week)).size === 2);
}

console.log("— nights and slots");
{
  const nights = {};
  games.forEach((g) => {
    const d = etDay(g.scheduled_at), t = etTime(g.scheduled_at);
    nights[d] = nights[d] || { total: 0, slots: {}, clubs: {} };
    nights[d].total++;
    nights[d].slots[t] = nights[d].slots[t] || {};
    [g.home_team_id, g.away_team_id].forEach((id) => {
      nights[d].slots[t][id] = (nights[d].slots[t][id] || 0) + 1;
      nights[d].clubs[id] = (nights[d].clubs[id] || 0) + 1;
    });
  });
  const days = Object.keys(nights).sort();
  A("30 game nights (6 pre-season + 24 regular)", days.length === 30, days.length);
  A("15 games every night", days.every((d) => nights[d].total === 15), JSON.stringify(days.map((d) => nights[d].total)));
  A("every night has exactly the 21:00 / 21:35 / 22:10 ET slots",
    days.every((d) => JSON.stringify(Object.keys(nights[d].slots).sort()) === JSON.stringify(["21:00", "21:35", "22:10"])),
    JSON.stringify(Object.keys(nights[days[0]].slots)));
  A("every club plays exactly once per slot, so 3 games a night",
    days.every((d) => Object.values(nights[d].slots).every((s) => TEAMS.every((t) => s[t.id] === 1))) &&
    days.every((d) => TEAMS.every((t) => nights[d].clubs[t.id] === 3)));
  A("summary.perNight matches: 30 dates, 15 each",
    Object.keys(summary.perNight).length === 30 && Object.values(summary.perNight).every((n) => n === 15) &&
    days.every((d) => summary.perNight[d] === 15));
  A("the three slot times account for 150 games each",
    ["21:00", "21:35", "22:10"].every((t) => games.filter((g) => etTime(g.scheduled_at) === t).length === 150));
  A("the first pre-season game is Wed Sep 16 2026 9:00 PM ET = 2026-09-17T01:00:00.000Z (EDT)",
    pre[0].scheduled_at === "2026-09-17T01:00:00.000Z", pre[0].scheduled_at);
  A("the December games are on EST: 9:00 PM ET = 02:00Z",
    reg.filter((g) => etDay(g.scheduled_at) === "2026-12-09" && etTime(g.scheduled_at) === "21:00").every((g) => g.scheduled_at === "2026-12-10T02:00:00.000Z"));
  A("no two clubs meet twice on the same night", days.every((d) => {
    const seen = {};
    return games.filter((g) => etDay(g.scheduled_at) === d).every((g) => {
      const k = [g.home_team_id, g.away_team_id].sort().join("|");
      if (seen[k]) return false; seen[k] = 1; return true;
    });
  }));
}

console.log("— holiday weeks are skipped whole");
{
  const wk = (stage, n) => summary.weeks.find((w) => w.stage === stage && w.week === n);
  const regDays = (n) => [...new Set(reg.filter((g) => g.week === n).map((g) => etDay(g.scheduled_at)))].sort();
  A("pre-season week 1 is Sep 16-18, week 2 is Sep 23-25",
    wk("preseason", 1).firstNightET === "2026-09-16" && wk("preseason", 1).lastNightET === "2026-09-18" &&
    wk("preseason", 2).firstNightET === "2026-09-23" && wk("preseason", 2).lastNightET === "2026-09-25", JSON.stringify(summary.weeks.slice(0, 2)));
  A("regular week 1 opens Oct 7-9", wk("regular", 1).firstNightET === "2026-10-07" && wk("regular", 1).lastNightET === "2026-10-09", JSON.stringify(wk("regular", 1)));
  A("regular week 5 is Nov 4-6", JSON.stringify(regDays(5)) === JSON.stringify(["2026-11-04", "2026-11-05", "2026-11-06"]), JSON.stringify(regDays(5)));
  A("regular week 6 falls on Nov 18-20 (the week of Remembrance Day skipped)",
    JSON.stringify(regDays(6)) === JSON.stringify(["2026-11-18", "2026-11-19", "2026-11-20"]) &&
    wk("regular", 6).firstNightET === "2026-11-18" && wk("regular", 6).lastNightET === "2026-11-20", JSON.stringify(regDays(6)));
  A("regular week 7 falls on Dec 2-4 (Thanksgiving week skipped)",
    JSON.stringify(regDays(7)) === JSON.stringify(["2026-12-02", "2026-12-03", "2026-12-04"]) &&
    wk("regular", 7).firstNightET === "2026-12-02" && wk("regular", 7).lastNightET === "2026-12-04", JSON.stringify(regDays(7)));
  A("regular week 8 is Dec 9-11", JSON.stringify(regDays(8)) === JSON.stringify(["2026-12-09", "2026-12-10", "2026-12-11"]), JSON.stringify(regDays(8)));
  A("no game lands on 2026-11-26 (Thanksgiving)", games.every((g) => etDay(g.scheduled_at) !== "2026-11-26"));
  A("no game lands anywhere in the week of Nov 11 or the week of Nov 25",
    games.every((g) => { const d = etDay(g.scheduled_at); return !(d >= "2026-11-09" && d <= "2026-11-15") && !(d >= "2026-11-23" && d <= "2026-11-29"); }));
  A("summary.holidayWeeksSkipped names both, on the regular stage",
    JSON.stringify(summary.holidayWeeksSkipped) === JSON.stringify([
      { stage: "regular", key: "remembrance-day", name: "Remembrance Day / Veterans Day", date: "2026-11-11", week: "2026-11-11" },
      { stage: "regular", key: "us-thanksgiving", name: "Thanksgiving (US)", date: "2026-11-26", week: "2026-11-25" }
    ]), JSON.stringify(summary.holidayWeeksSkipped));
  A("summary.weeks lists 2 pre-season + 8 regular weeks in order",
    summary.weeks.length === 10 && summary.weeks.map((w) => w.stage + w.week).join(",") === "preseason1,preseason2,regular1,regular2,regular3,regular4,regular5,regular6,regular7,regular8");
  A("the regular run derives the season end (Dec 11 11:59 PM ET) and playoffs (Wed Dec 16 9:00 PM ET)",
    summary.seasonUpdate && summary.seasonUpdate.season_id === SEASON_ID &&
    summary.seasonUpdate.ends_at === "2026-12-12T04:59:00.000Z" && summary.seasonUpdate.playoffs_start_at === "2026-12-17T02:00:00.000Z",
    JSON.stringify(summary.seasonUpdate));
}

console.log("— home/away balance");
{
  const bal = (rows) => { const m = {}; rows.forEach((g) => { m[g.home_team_id] = m[g.home_team_id] || { h: 0, a: 0 }; m[g.away_team_id] = m[g.away_team_id] || { h: 0, a: 0 }; m[g.home_team_id].h++; m[g.away_team_id].a++; }); return m; };
  const bp = bal(pre), br = bal(reg);
  A("regular season: every club's home and away counts are within 1", TEAMS.every((t) => Math.abs(br[t.id].h - br[t.id].a) <= 1),
    TEAMS.map((t) => t.code + ":" + br[t.id].h + "/" + br[t.id].a).join(" "));
  A("pre-season: every club's home and away counts are within 1", TEAMS.every((t) => Math.abs(bp[t.id].h - bp[t.id].a) <= 1),
    TEAMS.map((t) => t.code + ":" + bp[t.id].h + "/" + bp[t.id].a).join(" "));
  A("every club meets every other club 8 times in the regular season (evenOnly)", TEAMS.every((t) => TEAMS.every((u) => t === u ||
    reg.filter((g) => (g.home_team_id === t.id && g.away_team_id === u.id) || (g.home_team_id === u.id && g.away_team_id === t.id)).length === 8)));
}

console.log("— reproducibility");
{
  const again = run(season1(), ["--seed", "1"]);
  A("two runs with the same --seed produce byte-identical output", again.status === 0 && again.stdout === base.stdout);
  const other = run(season1(), ["--seed", "99"]);
  A("a different seed still produces a valid 450-game season", other.status === 0 && other.json.games.length === 450);
  const unseeded = run(season1());
  A("no --seed also works (the rotation is deterministic today)", unseeded.status === 0 && unseeded.json.games.length === 450, unseeded.stderr);
  /* the browser sorts CG.TEAMS by division then code before the generator sees them; the script
     must do the same, or the pairings would depend on the order clubs were typed into the file */
  const shuffled = season1(); shuffled.teams = TEAMS.slice().reverse();
  const sh = run(shuffled, ["--seed", "1"]);
  A("team order in the input does not change the pairings (browser sort applied)", sh.status === 0 && sh.stdout === base.stdout);
}

console.log("— --out writes the same document to a file");
{
  const f = path.join(tmp, "out.json");
  const r = run(season1(), ["--seed", "1", "--out", f]);
  A("exits 0 and writes the file", r.status === 0 && fs.existsSync(f), r.stderr);
  A("the file matches stdout output", fs.existsSync(f) && fs.readFileSync(f, "utf8") === base.stdout);
  A("stdout stays empty when --out is used", r.stdout === "");
  A("the one-line report names the skipped weeks", /Remembrance Day.*2026-11-11.*Thanksgiving.*2026-11-25/.test(r.stderr), r.stderr);
}

console.log("— the generator's refusals fail loud");
{
  const noStart = run(season1({ starts_at: null }), ["--seed", "1"]);
  A("no starts_at: exit 1 with the generator's own words", noStart.status === 1 && /start date/.test(noStart.stderr), noStart.stderr);
  /* two clubs and three slots would meet three times in one evening — indistinguishable from a
     disconnect-and-resume, so the generator refuses. (Three clubs are fine: with a bye the
     rotation brings a pair back only every third round.) */
  const tiny = season1(); tiny.teams = TEAMS.slice(0, 2);
  const t2 = run(tiny, ["--seed", "1"]);
  A("two clubs with three slots: the same-night-rematch guard refuses, exit 1", t2.status === 1 && /would meet twice/.test(t2.stderr), t2.stderr);
  const three = season1(); three.teams = TEAMS.slice(0, 3);
  const t3 = run(three, ["--seed", "1"]);
  A("three clubs generate (one sits out each slot): 2 pre-season + 8 regular weeks, 1 game a slot",
    t3.status === 0 && t3.json.games.length === (18 + 72) * 1 && t3.json.summary.regular === 72, t3.stderr);
  const bad = run({ season: { id: "x" }, teams: [{ id: "a", code: "A" }, { id: "a", code: "B" }] });
  A("duplicate team id: exit 2 with a plain message", bad.status === 2 && /duplicate team id/.test(bad.stderr), bad.stderr);
  const noArgs = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  A("no input path: exit 2 with usage", noArgs.status === 2 && /usage/.test(noArgs.stderr));
  const badSeed = run(season1(), ["--seed", "abc"]);
  A("a non-integer --seed is rejected", badSeed.status === 2 && /--seed must be an integer/.test(badSeed.stderr), badSeed.stderr);
}

console.log("— skip_holidays semantics");
{
  const none = run(season1({ skip_holidays: [] }), ["--seed", "1"]);
  A("an empty skip list skips nothing: regular week 6 is Nov 11-13", none.status === 0 &&
    none.json.summary.weeks.find((w) => w.stage === "regular" && w.week === 6).firstNightET === "2026-11-11" &&
    none.json.summary.holidayWeeksSkipped.length === 0, none.stderr);
  const dflt = run(season1({ skip_holidays: null }), ["--seed", "1"]);
  A("null uses the league defaults: Thanksgiving skipped, Remembrance Day not", dflt.status === 0 &&
    dflt.json.summary.holidayWeeksSkipped.map((h) => h.key).join(",") === "us-thanksgiving" &&
    dflt.json.summary.weeks.find((w) => w.stage === "regular" && w.week === 6).firstNightET === "2026-11-11", dflt.stderr);
  const stageOnly = run(season1(), ["--seed", "1", "--stage", "preseason"]);
  A("--stage preseason builds only the 90 pre-season rows and no seasons patch", stageOnly.status === 0 &&
    stageOnly.json.games.length === 90 && stageOnly.json.summary.regular === 0 && stageOnly.json.summary.seasonUpdate === null, stageOnly.stderr);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(ok ? "\nALL PASS" : "\nFAILURES");
process.exit(ok ? 0 : 1);
