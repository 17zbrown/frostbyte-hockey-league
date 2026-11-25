/* v5.00 swap (d, live-model): writes src/s2/js/cg-engine.js, the live site's own engine definitions copied out of src/live,
   so the Season 2 site counts standings, season lines and game nights with the SAME code as the current site instead of a
   port plus a parity test (briefs/judged_reasoning.md, the GRAFT list; PLAN section 6.5).
     node tools/s2-engine-build.cjs           rebuild the file
   tools/s2-engine-drift.test.cjs (npm test) fails when the committed file differs from a fresh build, so a change to any
   copied definition in src/live must be followed by this command in the same change.
   Each piece is a top-level `CG.<name> = ...` statement at the start of a line in its source file. The anchor must be
   found EXACTLY once, or the build throws (a renamed, duplicated or deleted definition is an error, never a silent skip).
   A statement is one line when its brackets balance and it ends in ";", else it runs to the first line that is only a
   closing bracket and a semicolon ("};", "];"), the house grab convention (tools/club-shots-v445.test.cjs). Only the
   statements are copied, never the comments above them (they name members); the bodies are byte for byte. The copy runs
   inside one function scope bound to S2.CG, so the Season 2 page gains no second global. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const REPO = path.resolve(__dirname, ".."), OUT = path.join(REPO, "src/s2/js/cg-engine.js");

const PIECES = [
  ["src/live/part2_engine.js", [
    /* the season line, the box entry and the one adder (v4.08, v4.11, v4.13) */
    "DEFAULT_WEIGHTS", "blankStatLine", "boxLines", "boxPut", "statPlayers", "addStatLine", "clubLine", "clubsPlayed",
    /* standings and season lines, every stage kept apart (v4.09), the EA extras (ice time, passing, specials) */
    "aggregate", "splitStages", "aggregateStages", "addEaRow", "addEaMetrics",
    /* Rule 8.1 order and Rule 8.2 tiebreakers */
    "h2hPoints", "standings"]],
  ["src/live/part_live.js", [
    /* game_stats rows and games rows as box lines and results (v4.10 fot is faceoffs taken, v4.45 club shots, v4.54) */
    "boxSides", "eaSkaterLine", "eaGoalieLine", "liveGame", "countedFinal", "gameBox",
    /* the format table (basic: three clubs a division make the playoffs) */
    "FORMAT_RULES",
    /* game nights from a season row: holidays skipped by week, the Wednesday anchor (CG.gameNights, CG.holidayWeek) */
    "NIGHTS_PER_WEEK", "HOLIDAY_RULES", "HOLIDAYS", "HOLIDAY_BY_KEY", "HOLIDAY_DEFAULTS", "holidayDate", "seasonHolidayKeys",
    "dayAdd", "dayOfWeek", "etISO", "etYMD", "holidayWeek", "gameNights",
    /* g3 (2026-11-24): the schedule generator itself, byte for byte, with the season shape and the holiday checks it
       reads. control.js runs CG.generateSchedule against a recorder (its confirm, toasts and writes captured), shows the
       rows it would insert, and writes exactly those rows through S2.write (tools/schedule-port-g3.test.cjs) */
    "GAMES_PER_CLUB", "PRESEASON_WEEKS", "NIGHT_SLOTS", "NIGHT_NAMES", "seasonShape", "tickedHolidays", "sameHolidaySet",
    "holidayWeekLabel", "generateSchedule",
    /* g3: the classic logo uploader (shrink to 384 px, the team-logos bucket, a fresh timestamped name), so a club logo
       is stored exactly as the current site stores it; control.js lends it the read client */
    "shrinkImage", "UPLOAD_MIME", "assertCommissioner", "uploadArtwork", "uploadTeamLogo",
    /* g3 (review 2026-11-24): the newsroom categories, so the Control Center offers the classic six and no second list */
    "NEWS_CATS"]]
];
/* names the copied bodies use bare, as the classic bundle's own globals: CG.generateSchedule calls esc (part4_ui.js) on the
   season name in its confirm title. It reads S2.esc (core.js) when called, so the copy does not depend on load order */
const FREE = "var esc = function (s) { return S2.esc(s); };\n";

/* bracket balance of one line, quotes skipped (enough for the one-line statements this copies; the vm check below
   catches anything it gets wrong) */
function balance(line) {
  let d = 0, q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "(" || c === "[" || c === "{") d++;
    else if (c === ")" || c === "]" || c === "}") d--;
  }
  return d;
}

function grab(src, file, name) {
  const lines = src.split("\n"), head = "CG." + name + " = ";
  const at = lines.map((l, i) => (l.startsWith(head) ? i : -1)).filter((i) => i >= 0);
  if (at.length !== 1) throw new Error(file + ": the anchor `" + head + "` is found " + at.length + " times; it must be found exactly once");
  const first = lines[at[0]];
  if (balance(first) === 0 && /;\s*$/.test(first)) return first;
  for (let j = at[0] + 1; j < lines.length; j++) {
    if (/^CG\.[A-Za-z_$][\w$]* *=/.test(lines[j])) throw new Error(file + ": CG." + name + " runs into the next definition (" + lines[j].slice(0, 40) + ") before its closing line");
    if (/^[\]}][\])}]*;\s*$/.test(lines[j])) return lines.slice(at[0], j + 1).join("\n");
  }
  throw new Error(file + ": CG." + name + " has no closing line");
}

/* the piece list in the header, as comment lines of at most 120 characters */
function wrap(text) {
  const out = []; let line = "  ";
  for (const w of text.split(" ")) { if ((line + " " + w).length > 120) { out.push(line); line = "  "; } line += " " + w; }
  return out.concat([line]).join("\n") + "\n";
}

function build() {
  const parts = [];
  for (const [file, names] of PIECES) {
    const src = fs.readFileSync(path.join(REPO, file), "utf8");
    parts.push("/* ---------- " + file + " ---------- */");
    for (const n of names) parts.push(grab(src, file, n));
  }
  const text = "/* GENERATED by tools/s2-engine-build.cjs from src/live: do not edit. Change the definition in src/live, then run\n" +
    "   `node tools/s2-engine-build.cjs`; tools/s2-engine-drift.test.cjs fails until the two agree.\n" +
    "   v5.00 swap (d): the live site's engine, so the Season 2 site keeps ONE definition of standings, season lines, box\n" +
    "   lines and game nights. It defines only these, on S2.CG:\n" + wrap(PIECES.map((p) => p[1].join(", ")).join(", ") + ".") +
    "   S2.CG.TEAMS, S2.CG.TEAM and S2.CG.SEASON are set by js/model.js before each count, as the live boot sets them. */\n" +
    "(function () {\n\"use strict\";\nvar S2 = window.S2 = window.S2 || {};\nvar CG = S2.CG = {};\n" + FREE + parts.join("\n") + "\n})();\n";
  /* the copy must run, and define every piece it names */
  const ctx = { console, Intl, Date, Math, Object, Array, String, Number, JSON };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(text, ctx, { filename: "cg-engine.js" });
  for (const [, names] of PIECES) for (const n of names) if (ctx.S2.CG[n] === undefined) throw new Error("cg-engine.js does not define CG." + n);
  return text;
}

module.exports = { build, grab, OUT, PIECES };
if (require.main === module) {
  const text = build();
  fs.writeFileSync(OUT, text);
  console.log("wrote " + path.relative(REPO, OUT) + " (" + PIECES.reduce((a, p) => a + p[1].length, 0) + " definitions, " + Math.round(text.length / 1024) + " KB)");
}
