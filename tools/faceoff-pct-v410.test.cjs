/* v4.10: Stat Central's FO% read over 100% for some players on the live site (Saqoy showed 153.9). The engine, CG.aggregate
   and every reader treat a line's fot as faceoffs TAKEN and fow as faceoffs WON (FO% = fow / fot), but the live box mapper
   filled fot with faceoffs LOST alone, so FO% read won over lost: Saqoy's 254 won and 165 lost showed 153.9 instead of 60.6,
   and a player who never lost a draw showed no rate at all. The mapper (now CG.eaSkaterLine) sets fot to won + lost.
   This pins the mapper and runs the real engine (CG.splitStages, CG.aggregateStages, CG.aggregate) and the real Stat
   Central route on game_stats rows with a known won/lost split.
   Run: node tools/faceoff-pct-v410.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const eng = R("src/live/part2_engine.js"), pub = R("src/live/part5a_public.js"), live = R("src/live/part_live.js");
const grab = (src, fn) => { const m = src.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};")); if (!m) throw new Error("no CG." + fn); return m[0]; };

const TEAMS = ["NYI", "DAL"].map((code) => ({ code, name: code + " club", color: "#000", div: "East" }));
const ctx = { console, Math, Object, Array, String, Number, JSON, Date, Intl };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.CG = {
  TEAMS, TEAM: Object.fromEntries(TEAMS.map((t) => [t.code, t])), SEASON: { completedWeeks: 0 },
  DEFAULT_WEIGHTS: { skater: { production: 46, efficiency: 16, defense: 14, discipline: 8, form: 16 }, goalie: { saves: 52, workload: 18, wins: 22, discipline: 8 },
    team: { record: 38, goalDiff: 22, goaltending: 14, depth: 14, form: 12 } },
  crest: () => "", fmtToi: (s) => Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0"), seasonTag: () => "Season 2",
  playerRoute: (p) => "#/player/" + p.id, isCamp: () => false, ic: () => "",
  pageHead: (eyebrow, title, sub, side) => "<header><h1>" + title + "</h1><p>" + sub + "</p>" + (side || "") + "</header>",
};
ctx.esc = (s) => String(s);
vm.createContext(ctx);
vm.runInContext(grab(live, "eaSkaterLine"), ctx);
for (const f of ["boxLines", "boxPut", "glogGames", "blankStatLine", "statPlayers", "statPlayerById", "addStatLine", "clubLine", "clubsPlayed", "aggregate", "splitStages",   /* v4.11: boxLines */ "aggregateStages", "addEaRow", "addEaMetrics",
  "playerById", "standings", "h2hPoints", "skaterLeaders", "goalieLeaders", "roleLine", "lineRoles", "offRoleTag"]) vm.runInContext(grab(eng, f), ctx);
ctx.CG.ROUTES = {};
for (const f of ["emptyRow", "playoffView", "ROUTES\\.stats"]) vm.runInContext(grab(pub, f), ctx);
const CG = ctx.CG;

console.log("— the mapper: fow is faceoffs won, fot faceoffs taken");
{
  const L = CG.eaSkaterLine({ faceoffs_won: 254, faceoffs_lost: 165, goals: 3, assists: 4, shots: 9, profile_id: "x" });
  A("254 won and 165 lost: fow 254, fot 419", L.fow === 254 && L.fot === 419, JSON.stringify([L.fow, L.fot]));
  A("...so the rate is 60.6, not the 153.9 that won over lost gave", (100 * L.fow / L.fot).toFixed(1) === "60.6" && (100 * 254 / 165).toFixed(1) === "153.9");
  const sweep = CG.eaSkaterLine({ faceoffs_won: 5, faceoffs_lost: 0 });
  A("a player who never lost a draw: fot is the 5 draws won (so 100.0, not no rate)", sweep.fow === 5 && sweep.fot === 5);
  const lost = CG.eaSkaterLine({ faceoffs_won: 0, faceoffs_lost: 4 });
  A("a player who lost every draw: fow 0, fot 4", lost.fow === 0 && lost.fot === 4);
  const none = CG.eaSkaterLine({});
  A("no faceoff columns at all: 0 and 0, never NaN", none.fow === 0 && none.fot === 0);
  const str = CG.eaSkaterLine({ faceoffs_won: "7", faceoffs_lost: "3" });
  A("string counts from PostgREST are added as numbers (7 + 3 = 10, not \"73\")", str.fow === 7 && str.fot === 10, JSON.stringify([str.fow, str.fot]));
  A("fot is never below fow", [L, sweep, lost, none, str].every((x) => x.fot >= x.fow));
  A("the line keeps every other key it carried", JSON.stringify(Object.keys(L)) === JSON.stringify(["goalie", "g", "a", "pm", "shots", "hits", "blk", "gv", "tk", "pim",
    "fow", "fot", "gwg", "ppg", "shg", "toi", "pass", "passAtt", "sat", "poss", "intc", "pdrawn", "defl", "saucer", "ratOff", "ratDef", "ratTeam",
    "name", "pos", "eaId", "pid"]) && L.g === 3 && L.a === 4 && L.shots === 9 && L.pid === "x");
}

console.log("\n— the live build uses that one mapper");
{
  A("buildLiveLeague maps every skater row through CG.eaSkaterLine", /var eaSkaterLine = CG\.eaSkaterLine;/.test(live) &&
    /CG\.boxPut\(box\[code\], key, r\.is_goalie \? eaGoalieLine\(r, gWon, forfeit \? false : g\.ot\) : eaSkaterLine\(r\), "ea:"\+r\.id\);/.test(live));   /* v4.11: filed through boxPut */
  A("...and no mapper anywhere on the site fills fot from faceoffs lost alone",
    !/fot\s*:\s*\+?\s*r\.faceoffs_lost/.test(live + pub + eng + R("src/live/part5b_public2.js") + R("src/live/part6_hub.js") + R("src/live/part7_admin.js")));
  A("the prototype engine already meant faceoffs taken (fow is a share of fot)", /b\.fot = 8\+Math\.floor\(rng\(\)\*14\); b\.fow = Math\.round\(b\.fot\*/.test(eng));
  A("CG.aggregate adds fow and fot straight through", /s\.fow\+=b\.fow; s\.fot\+=b\.fot;/.test(eng));
}

/* ---- the fixture: game_stats rows with a known won/lost split, through the real engine ---- */
const players = [
  { id: "saq", tag: "Saqoy", team: "NYI", pos: "C" },
  { id: "nd", tag: "No draws", team: "NYI", pos: "RD" },
  { id: "gN", tag: "Islander tender", team: "NYI", pos: "G" },
  { id: "sw", tag: "Clean sweep", team: "DAL", pos: "C" },
  { id: "nw", tag: "Never won", team: "DAL", pos: "LW" },
  { id: "gD", tag: "Dallas tender", team: "DAL", pos: "G" },
];
const sk = (pid, won, lost, g, a) => CG.eaSkaterLine({ profile_id: pid, goals: g || 0, assists: a || 0, shots: 3, hits: 1, faceoffs_won: won, faceoffs_lost: lost, time_on_ice_seconds: 1200 });
const G = (sv, sa, w, l) => ({ goalie: true, pos: "G", sv, sa, ga: sa - sv, w, l, otl: 0, so: 0, qs: sv / sa >= .885 ? 1 : 0 });
let gid = 0;
const results = [];
const game = (stage, week, hs, as, nyi, dal) => results.push({ id: stage[0] + (++gid), week, stage, home: "NYI", away: "DAL", at: 1e12 + gid * 3600000,
  score: { NYI: hs, DAL: as }, box: { NYI: nyi, DAL: dal }, ot: false, stars: [] });
/* regular season: Saqoy 100/60, 90/55, 64/50 = 254 won, 165 lost (his real Season 2 split) */
game("regular", 1, 3, 2, { saq: sk("saq", 100, 60, 1, 1), nd: sk("nd", 0, 0), gN: G(20, 22, 1, 0) }, { sw: sk("sw", 3, 0), nw: sk("nw", 0, 4, 1), gD: G(18, 21, 0, 1) });
game("regular", 1, 2, 1, { saq: sk("saq", 90, 55, 0, 2), nd: sk("nd", 0, 0), gN: G(19, 20, 1, 0) }, { sw: sk("sw", 2, 0), nw: sk("nw", 0, 0), gD: G(20, 22, 0, 1) });
game("regular", 2, 4, 3, { saq: sk("saq", 64, 50, 2, 0), nd: sk("nd", 0, 0, 0, 1), gN: G(25, 28, 1, 0) }, { sw: sk("sw", 0, 0, 1), nw: sk("nw", 0, 0), gD: G(16, 20, 0, 1) });
/* one playoff game: Saqoy 12 won, 8 lost */
game("playoff", 1, 2, 0, { saq: sk("saq", 12, 8, 1), nd: sk("nd", 0, 0), gN: G(24, 24, 1, 0) }, { sw: sk("sw", 1, 3), nw: sk("nw", 0, 0), gD: G(20, 22, 0, 1) });

const byTeam = {}; TEAMS.forEach((t) => (byTeam[t.code] = players.filter((p) => p.team === t.code)));
const lg = { players, formerPlayers: [], byTeam, results: [] };
const st = CG.splitStages(results);
CG.aggregateStages(lg, st, { pre: 0, all: 3, reg: 2 });
CG.addEaMetrics(lg, lg.pstats, st.reg, [], lg.posSplitRows = {});
CG.addEaMetrics(lg, lg.playoff.pstats, st.po, [], null);
CG.lg = lg;

console.log("\n— the season line: faceoffs taken add up");
{
  const s = lg.pstats.saq;
  A("Saqoy's regular-season line: 254 won of 419 taken", s.fow === 254 && s.fot === 419, JSON.stringify([s.fow, s.fot]));
  A("...and the playoff line keeps its own 12 of 20", lg.playoff.pstats.saq.fow === 12 && lg.playoff.pstats.saq.fot === 20);
  A("goals, points and games played are what they were (3 GP, 3G 3A)", s.gp === 3 && s.sgp === 3 && s.g === 3 && s.a === 3 && s.p === 6);
}

/* the FO% cell is the last cell of a player's Stat Central row */
const row = (html, tag) => { const i = html.indexOf(tag + "</span>"); return i < 0 ? "" : html.slice(i, html.indexOf("</tr>", i)); };
const foCell = (html, tag) => { const m = row(html, tag).match(/<td data-v="([^"]*)">([^<]*)<\/td>$/); return m ? { v: m[1], shown: m[2] } : null; };

console.log("\n— Stat Central reads wins over wins plus losses");
{
  const reg = CG.ROUTES.stats(null, { tab: "skaters", min: "1" });
  const saq = foCell(reg, "Saqoy");
  A("Saqoy: FO% 60.6, sorted on 60.6", saq && saq.shown === "60.6" && saq.v === "60.6", JSON.stringify(saq));
  const sw = foCell(reg, "Clean sweep");
  A("a player who won every draw taken: 100.0, not a dash", sw && sw.shown === "100.0" && sw.v === "100.0", JSON.stringify(sw));
  const nw = foCell(reg, "Never won");
  A("a player who lost every draw taken: 0.0", nw && nw.shown === "0.0" && nw.v === "0.0", JSON.stringify(nw));
  const nd = foCell(reg, "No draws");
  A("a player who took no draws: a dash, sorted as 0", nd && nd.shown === "—" && nd.v === "0.0", JSON.stringify(nd));
  const all = (reg.match(/<td data-v="[^"]*">[^<]*<\/td><\/tr>/g) || []).map((c) => +c.match(/data-v="([^"]*)"/)[1]);
  A("no FO% in the table is over 100", all.length === 4 && all.every((v) => v >= 0 && v <= 100), JSON.stringify(all));
  const po = CG.ROUTES.stats(null, { tab: "skaters", stage: "playoff" });
  const psaq = foCell(po, "Saqoy");
  A("the Playoffs view reads the playoff line: Saqoy 60.0 (12 of 20)", psaq && psaq.shown === "60.0", JSON.stringify(psaq));
  const psw = foCell(po, "Clean sweep");
  A("...and Clean sweep 25.0 (1 of 4)", psw && psw.shown === "25.0", JSON.stringify(psw));
  A("the definitions say what FO% is", /FO% faceoffs won out of faceoffs taken/.test(reg));
  A("no NaN or undefined", ![reg, po].some((h) => /NaN|undefined/.test(h)));
}

console.log("\n— the changelog");
{
  const C = {}; new Function("CG", R("src/live/part3_content.js"))(C);
  const rb = C.CONTENT.rulebook;
  const e = rb.changelog.find((c) => c.version === "4.10") || {};   /* by version, never by position: a later release takes changelog[0] */
  A("the changelog's 4.10 entry is about FO%", e.version === "4.10" && /FO%/.test(e.summary) && /faceoffs won/.test(JSON.stringify(e)), e.version);
  A("no em dashes or spaced hyphens in the new copy", !/—| - /.test(JSON.stringify(e) + grab(live, "eaSkaterLine")));
  A("American spelling", !/practis|colour|centre|organis|defence|cancelled/i.test(JSON.stringify(e)));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
