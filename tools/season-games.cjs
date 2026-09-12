#!/usr/bin/env node
/* tools/season-games.cjs — build a season's games OUTSIDE the browser, with the SAME code the
   Control Center runs.

   Run:  node tools/season-games.cjs <input.json> [--out out.json] [--seed N]

   Nothing here is a re-implementation. The generator (CG.generateSchedule), the season shape,
   the holiday calendar, the ET date helpers and the week planner are sliced verbatim out of
   src/live/part_live.js and run in a vm sandbox with a hand-built CG: the browser globals it
   touches (CG.sb, CG.confirm, CG.toast, CG.assertCommissioner, CG.reloadLeague, esc) are stubs
   that RECORD instead of write. What comes out is exactly the rows the browser would insert into
   public.games, in the order it would insert them, plus the seasons-row patch (ends_at,
   playoffs_start_at) the regular-season run makes.

   input.json:
     { season:    { id, number, name?, preseason_starts_at, starts_at, weeks, nights_per_week,
                    night_slots, skip_holidays, div_games?, nondiv_games? },
       teams:     [ { id, code, div } ... ],
       divisions: [ "East", "West" ] }

   - skip_holidays: an array of holiday keys (see CG.HOLIDAYS). OMITTED/null means the league
     defaults, the same as a season that was never configured; [] means "skip nothing".
   - night_slots: "21:00,21:35,22:10" (a comma string, as the seasons row stores it; an array is
     accepted too).
   - div_games / nondiv_games are accepted and IGNORED: the generator plays every opponent the
     same number of times (seasonShape.evenOnly) and does not read them.
   - Teams are sorted the way buildLiveLeague sorts CG.TEAMS (division, then code) before the
     generator sees them, so the pairings match what the browser would produce for the same
     clubs regardless of the order in the input file.

   --seed N: the rotation in CG.generateSchedule is deterministic today (a circle-method
   round-robin; it never calls Math.random), so two runs already agree byte for byte. The seed
   substitutes a mulberry32 PRNG for Math.random inside the sandbox anyway, so that if the
   generator ever starts shuffling (CG.shuffleArr is loaded alongside it) a seeded run stays
   reproducible. Without --seed the host Math.random is used.

   Output (stdout, or --out file):
     { games: [ { season_id, week, stage, home_team_id, away_team_id, scheduled_at, status } ... ],
       summary: { preseason, regular, perClubRegular, perClubPreseason, perNight, weeks,
                  holidayWeeksSkipped, seasonUpdate, messages } }

   Exit codes: 0 generated; 1 the generator refused (its toast is printed — the same words the
   commissioner would have seen); 2 bad input / could not load the site code. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");

const LIVE_PATH = path.join(__dirname, "..", "src", "live", "part_live.js");

/* Everything the generator reaches for, in an order that lets each definition see the ones
   before it (HOLIDAY_BY_KEY and HOLIDAY_DEFAULTS are computed from HOLIDAYS at load time). */
const NEEDED = [
  "GAMES_PER_CLUB", "PRESEASON_WEEKS", "OFFSEASON_DARK_DAYS", "FA_WINDOW_DAYS",
  "NIGHT_SLOTS", "NIGHTS_PER_WEEK", "NIGHT_NAMES",
  "dayAdd", "dayOfWeek", "etISO", "etYMD",
  "seasonShape",
  "HOLIDAY_RULES", "HOLIDAYS", "HOLIDAY_BY_KEY", "HOLIDAY_DEFAULTS",
  "holidayDate", "seasonHolidayKeys", "tickedHolidays", "sameHolidaySet",
  "holidayWeek", "gameNights",
  "shuffleArr", "generateSchedule"
];

/* Slice "CG.<name> = ..." (a function OR a value) out of the site source, up to the next
   top-level "CG." assignment. Anchored on a leading newline so a mention inside a comment or a
   nested call can never be mistaken for the definition. */
function grab(src, name){
  const key = "\nCG." + name + " = ";
  const i = src.indexOf(key);
  if (i < 0) throw new Error("could not find CG." + name + " in " + LIVE_PATH);
  if (src.indexOf(key, i + 1) >= 0) throw new Error("CG." + name + " is defined more than once in " + LIVE_PATH + " — refusing to guess which one the site uses");
  const end = src.indexOf("\nCG.", i + key.length);
  return src.slice(i + 1, end < 0 ? src.length : end);
}

function mulberry32(seed){
  let a = (Number(seed) >>> 0) || 0x9E3779B9;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* the same HTML escaper the site defines as a bare global in part4_ui.js — the confirm copy
   calls it on the season name */
function esc(s){ return (s == null ? "" : String(s)).replace(/[<>&"']/g, function(c){
  return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]; }); }

function validateInput(input){
  const bad = (m) => { const e = new Error(m); e.code = "EINPUT"; throw e; };
  if (!input || typeof input !== "object") bad("input must be a JSON object");
  const s = input.season;
  if (!s || typeof s !== "object") bad("input.season is required");
  if (!s.id) bad("input.season.id is required (the rows hang off it)");
  if (!Array.isArray(input.teams)) bad("input.teams must be an array of { id, code, div }");
  const codes = {}, ids = {};
  input.teams.forEach((t, i) => {
    if (!t || !t.id || !t.code) bad("input.teams[" + i + "] needs both id and code");
    if (codes[t.code]) bad("duplicate team code " + t.code);
    if (ids[t.id]) bad("duplicate team id " + t.id);
    codes[t.code] = 1; ids[t.id] = 1;
  });
  if (input.divisions != null && !Array.isArray(input.divisions)) bad("input.divisions must be an array of names");
}

/* Build the CG the site code expects, load the real functions into it, and wire the stubs. */
function buildContext(input, opts){
  const src = fs.readFileSync(LIVE_PATH, "utf8");
  const CG = {};

  /* season row, as the Control Center would have saved it */
  CG.SEASON = Object.assign({}, input.season);
  if (Array.isArray(CG.SEASON.night_slots)) CG.SEASON.night_slots = CG.SEASON.night_slots.join(",");

  /* team registry: the same fields and the same sort buildLiveLeague applies */
  CG.TEAMS = input.teams.map((t) => ({
    id: t.id, code: t.code, name: t.name || t.code,
    div: t.div || t.division || "East"
  })).sort((a, b) => (a.div === b.div ? 0 : (a.div < b.div ? -1 : 1)) || (a.code < b.code ? -1 : 1));
  CG.TEAM = {}; CG.TEAMS.forEach((t) => { CG.TEAM[t.code] = t; });
  CG.DIVISIONS = Array.isArray(input.divisions) && input.divisions.length
    ? input.divisions.slice()
    : CG.TEAMS.map((t) => t.div).filter((d, i, a) => a.indexOf(d) === i);

  /* the league snapshot: an empty schedule so the "already exists" guard passes, plus the
     code<->id maps the row builder reads */
  CG.lg = { schedule: [], _codeToId: {}, _idToCode: {} };
  CG.TEAMS.forEach((t) => { CG.lg._codeToId[t.code] = t.id; CG.lg._idToCode[t.id] = t.code; });

  /* ---- recording stubs ---- */
  const sink = { rows: [], toasts: [], seasonUpdate: null, confirms: [], resolve: null };
  CG.toast = function(msg, kind){
    sink.toasts.push({ msg: String(msg), kind: kind || "info" });
    if (sink.resolve){ const r = sink.resolve; sink.resolve = null; r({ msg: String(msg), kind: kind || "info" }); }
  };
  CG.confirm = function(title, body, label, fn){
    sink.confirms.push({ title: String(title), body: String(body), label: String(label) });
    if (typeof fn === "function") fn();   /* auto-confirm: the commissioner said yes */
  };
  CG.reloadLeague = function(){};
  CG.closeOverlay = function(){};
  CG.modal = function(){};
  CG.assertCommissioner = function(){ return Promise.resolve({ access_token: "stub", user: { id: "stub" } }); };
  CG.sb = {
    from: function(table){
      if (table === "games") return {
        insert: function(rows){
          const copy = (Array.isArray(rows) ? rows : [rows]).map((r) => Object.assign({}, r));
          copy.forEach((r) => sink.rows.push(r));
          const res = Promise.resolve({ data: copy, error: null });
          /* the site calls .insert(chunk).then(...) directly; .select() is offered in case a
             future revision adds it, resolving the same way */
          return { then: res.then.bind(res), catch: res.catch.bind(res), select: () => res };
        }
      };
      if (table === "seasons") return {
        update: function(patch){
          const rec = { patch: Object.assign({}, patch), eq: null };
          return { eq: function(col, val){ rec.eq = [col, val]; return {
            select: function(){ sink.seasonUpdate = rec; return Promise.resolve({ data: [{ id: val }], error: null }); },
            then: function(ok, ko){ sink.seasonUpdate = rec; return Promise.resolve({ data: null, error: null }).then(ok, ko); }
          }; } };
        }
      };
      throw new Error("the generator touched a table this script does not stub: " + table);
    },
    rpc: function(name){ throw new Error("the generator called an RPC this script does not stub: " + name); }
  };

  /* Math with a seeded random when asked for one. Object.create keeps every other Math method
     reachable through the prototype; only random is overridden. */
  let M = Math;
  if (opts && opts.seed != null){ M = Object.create(Math); M.random = mulberry32(opts.seed); }

  const code = NEEDED.map((n) => grab(src, n)).join("\n");
  vm.runInNewContext(code, { CG, Date, Intl, Math: M, console, esc, isNaN, JSON });
  NEEDED.forEach((n) => { if (CG[n] === undefined) throw new Error("CG." + n + " did not load"); });

  return { CG, sink };
}

/* Run one stage to completion. The generator is callback/promise driven and ends — success or
   refusal — with exactly one toast, so the toast is the completion signal. */
function runStage(CG, sink, stage){
  const before = sink.rows.length;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the " + stage + " generator never finished — no toast within 15s")), 15000);
    sink.resolve = (t) => { clearTimeout(timer); resolve(t); };
    try { CG.generateSchedule(stage); }
    catch (e){ clearTimeout(timer); sink.resolve = null; reject(e); }
  }).then((toast) => {
    if (toast.kind === "err"){
      const e = new Error(toast.msg); e.code = "EREFUSED"; e.stage = stage; throw e;
    }
    /* mirror the reload the browser would do: the stage now exists in lg.schedule, so a second
       run of the same stage is refused just as it would be on the site */
    sink.rows.slice(before).forEach((r) => CG.lg.schedule.push({ stage: r.stage }));
    return toast;
  });
}

/* the invariants the browser trusts the math for — checked here so a wrong count or a club
   double-booked in a slot fails the run instead of landing in a JSON file that looks fine */
function checkInvariants(CG, rows, stage, expectedRounds){
  const shape = CG.seasonShape(CG.SEASON);
  const n = CG.TEAMS.length, pairsPerRound = Math.floor(n / 2);
  const mine = rows.filter((r) => r.stage === stage);
  const want = expectedRounds * pairsPerRound;
  if (mine.length !== want) throw new Error(stage + ": built " + mine.length + " games but " + expectedRounds + " rounds x " + pairsPerRound + " pairs = " + want + " were expected — the week planner ran short (guard hit?) or rows were dropped");
  const seen = {};
  mine.forEach((r) => {
    if (!r.home_team_id || !r.away_team_id) throw new Error(stage + ": a row is missing a team id (" + JSON.stringify(r) + ") — a code had no id in the team registry");
    if (r.home_team_id === r.away_team_id) throw new Error(stage + ": a club is scheduled against itself");
    const key = r.scheduled_at;   /* one ET date+slot == one instant */
    seen[key] = seen[key] || {};
    [r.home_team_id, r.away_team_id].forEach((id) => {
      if (seen[key][id]) throw new Error(stage + ": " + CG.lg._idToCode[id] + " is booked twice at " + key);
      seen[key][id] = 1;
    });
  });
  return { shape, games: mine.length };
}

function summarize(CG, sink, plans){
  const rows = sink.rows;
  const code = (id) => CG.lg._idToCode[id] || id;
  const perClub = (stage) => {
    const out = {}; CG.TEAMS.forEach((t) => { out[t.code] = 0; });
    rows.filter((r) => r.stage === stage).forEach((r) => { out[code(r.home_team_id)]++; out[code(r.away_team_id)]++; });
    return out;
  };
  const perNight = {};
  rows.forEach((r) => { const d = CG.etYMD(r.scheduled_at); perNight[d] = (perNight[d] || 0) + 1; });
  const weeksMap = {};
  rows.forEach((r) => {
    const k = r.stage + "|" + r.week, d = CG.etYMD(r.scheduled_at);
    const w = weeksMap[k] || (weeksMap[k] = { stage: r.stage, week: r.week, firstNightET: d, lastNightET: d });
    if (d < w.firstNightET) w.firstNightET = d;
    if (d > w.lastNightET) w.lastNightET = d;
  });
  const stageRank = { preseason: 0, regular: 1 };
  const weeks = Object.values(weeksMap).sort((a, b) => (stageRank[a.stage] - stageRank[b.stage]) || (a.week - b.week));
  const holidayWeeksSkipped = [];
  Object.keys(plans).forEach((stage) => {
    plans[stage].skipped.forEach((h) => holidayWeeksSkipped.push({ stage, key: h.key, name: h.name, date: h.date, week: h.week }));
  });
  return {
    preseason: rows.filter((r) => r.stage === "preseason").length,
    regular: rows.filter((r) => r.stage === "regular").length,
    perClubRegular: perClub("regular"),
    perClubPreseason: perClub("preseason"),
    perNight,
    weeks,
    holidayWeeksSkipped,
    /* what the regular-season run writes back onto the seasons row (null if only the
       pre-season was built) */
    seasonUpdate: sink.seasonUpdate ? Object.assign({ season_id: sink.seasonUpdate.eq && sink.seasonUpdate.eq[1] }, sink.seasonUpdate.patch) : null,
    /* the toasts the commissioner would have read, in order */
    messages: sink.toasts.map((t) => t.msg)
  };
}

/* The week plan the generator built for a stage, recomputed through the same function with the
   same inputs (it is internal to generateSchedule and deterministic) — this is where the
   skipped-holiday list and the expected round count come from. */
function planFor(CG, stage){
  const s = CG.SEASON, shape = CG.seasonShape(s);
  const anchorIso = stage === "preseason" ? s.preseason_starts_at : s.starts_at;
  const rounds = stage === "preseason" ? CG.PRESEASON_WEEKS * shape.nights * shape.perNight : shape.perClub;
  const weeks = Math.ceil(rounds / shape.perNight / shape.nights);
  const plan = CG.gameNights(CG.etYMD(anchorIso), weeks, shape.nights, CG.seasonHolidayKeys(s));
  return { plan, rounds, weeks };
}

async function generate(input, opts){
  opts = opts || {};
  validateInput(input);
  const { CG, sink } = buildContext(input, opts);
  const stages = opts.stages || ["preseason", "regular"];
  const plans = {};
  for (const stage of stages){
    await runStage(CG, sink, stage);
    const p = planFor(CG, stage);
    plans[stage] = p.plan;
    checkInvariants(CG, sink.rows, stage, p.rounds);
  }
  /* strip the internal back-reference the schedule mirror keeps */
  const games = sink.rows.map((r) => Object.assign({}, r));
  return { games, summary: summarize(CG, sink, plans) };
}

function parseArgs(argv){
  const out = { input: null, out: null, seed: null, stages: null };
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (a === "--out"){ out.out = argv[++i]; if (!out.out) throw Object.assign(new Error("--out needs a path"), { code: "EINPUT" }); }
    else if (a.startsWith("--out=")) out.out = a.slice(6);
    else if (a === "--seed"){ out.seed = argv[++i]; if (out.seed == null || out.seed === "") throw Object.assign(new Error("--seed needs a number"), { code: "EINPUT" }); }
    else if (a.startsWith("--seed=")) out.seed = a.slice(7);
    else if (a === "--stage"){ out.stages = [argv[++i]]; }
    else if (a.startsWith("--stage=")) out.stages = [a.slice(8)];
    else if (a === "-h" || a === "--help") out.help = true;
    else if (a.startsWith("-")) throw Object.assign(new Error("unknown option " + a), { code: "EINPUT" });
    else if (!out.input) out.input = a;
    else throw Object.assign(new Error("unexpected argument " + a), { code: "EINPUT" });
  }
  if (out.seed != null){
    if (!/^-?\d+$/.test(String(out.seed))) throw Object.assign(new Error("--seed must be an integer, got " + out.seed), { code: "EINPUT" });
    out.seed = Number(out.seed);
  }
  if (out.stages && ["preseason", "regular"].indexOf(out.stages[0]) < 0) throw Object.assign(new Error("--stage must be preseason or regular"), { code: "EINPUT" });
  return out;
}

const USAGE = "usage: node tools/season-games.cjs <input.json> [--out out.json] [--seed N] [--stage preseason|regular]";

async function main(){
  process.on("unhandledRejection", (e) => { console.error("season-games: unhandled rejection inside the generator — " + (e && e.stack || e)); process.exit(2); });
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e){ console.error("season-games: " + e.message + "\n" + USAGE); process.exit(2); }
  if (args.help || !args.input){ console.error(USAGE); process.exit(args.help ? 0 : 2); }
  let input;
  try { input = JSON.parse(fs.readFileSync(args.input, "utf8")); }
  catch (e){ console.error("season-games: could not read " + args.input + " — " + e.message); process.exit(2); }
  let result;
  try { result = await generate(input, { seed: args.seed, stages: args.stages || undefined }); }
  catch (e){
    if (e.code === "EREFUSED"){ console.error("season-games: the " + e.stage + " generator refused — " + e.message); process.exit(1); }
    console.error("season-games: " + (e.code === "EINPUT" ? e.message : (e.stack || e.message)));
    process.exit(2);
  }
  const json = JSON.stringify(result, null, 2);
  if (args.out){
    fs.writeFileSync(args.out, json + "\n");
    const s = result.summary;
    console.error("season-games: " + s.preseason + " pre-season + " + s.regular + " regular games -> " + args.out +
      (s.holidayWeeksSkipped.length ? " (skipped " + s.holidayWeeksSkipped.map((h) => h.name + " week of " + h.week).join(", ") + ")" : ""));
  } else {
    process.stdout.write(json + "\n");
  }
}

module.exports = { generate, grab, mulberry32, NEEDED, LIVE_PATH };

if (require.main === module) main();
