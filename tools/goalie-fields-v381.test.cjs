/* v3.81: the four goaltending stats the ratings engine reads (v3.49) are imported. game_stats gained diving_saves,
   shutout_periods, pen_shot_saves and pen_shots_against on 2026-09-26 and they were backfilled once, but the importer
   never mapped them: every goalie line from Sep 30 on was null, so every goaltender's rating was computed without
   them. Found by the season box-score audit of 2026-10-02. This RUNS the importer's own normalizeMatch and
   mergeSegments on a real-shaped payload, and pins that the row builder writes all four. */
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "netlify/functions/ingest-stats.js"), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 220))); } };
const fn = (name) => { const i = src.indexOf("function " + name + "("); return src.slice(i, src.indexOf("\n}\n", i) + 2); };
const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const lib = new Function("etFmt", "const etDayUnix = (s) => etFmt.format(new Date(s * 1000));\n" + fn("mapPos") + fn("normalizeMatch") + fn("mergeSegments") + "\nreturn { normalizeMatch, mergeSegments };")(etFmt);

const goalie = (o) => Object.assign({ playername: "Tender", position: "goalie", glsaves: "20", glshots: "22", glga: "2", gldsaves: "3", glsoperiods: "1", glpensaves: "1", glpenshots: "1", toiseconds: "1800" }, o);
const skater = { playername: "Winger", position: "leftWing", skgoals: "1", gldsaves: "9", glsoperiods: "9", toiseconds: "1800" };
const raw = (id, ts, g) => ({ matchId: id, timestamp: ts, clubs: { "1": { score: "2" }, "2": { score: "2" } },
  players: { "1": { "100": g, "101": skater }, "2": { "200": goalie({ playername: "Other", glga: "1", glsaves: "10", glshots: "11" }) } } });

const m = lib.normalizeMatch(raw("A", 1759453200, goalie()));
const g = m.clubs.find((c) => c.ea_club_id === "1").players.find((p) => p.ea_player_id === "100");
A("a goalie's diving saves are imported (gldsaves)", g.diving_saves === 3, g);
A("...shutout periods (glsoperiods)", g.shutout_periods === 1);
A("...penalty-shot saves and shots (glpensaves, glpenshots)", g.pen_shot_saves === 1 && g.pen_shots_against === 1);
const s = m.clubs.find((c) => c.ea_club_id === "1").players.find((p) => p.ea_player_id === "101");
A("a skater carries zeros, whatever EA reports for him", s.diving_saves === 0 && s.shutout_periods === 0 && s.pen_shot_saves === 0 && s.pen_shots_against === 0, s);

const m2 = lib.normalizeMatch(raw("B", 1759455000, goalie({ gldsaves: "2", glsoperiods: "1", glpensaves: "0", glpenshots: "1" })));
const merged = lib.mergeSegments([m, m2]);
const gm = merged.clubs.find((c) => c.ea_club_id === "1").players.find((p) => p.ea_player_id === "100");
A("a game of two sittings sums them (Rule 4.3)", gm.diving_saves === 5 && gm.shutout_periods === 2 && gm.pen_shot_saves === 1 && gm.pen_shots_against === 2, gm);

const rowsAt = src.indexOf("async function leagueBoxRows"), rowsEnd = src.indexOf("await applyCreditWithdrawals", rowsAt);
const rowsSrc = src.slice(rowsAt, rowsEnd);
A("the box-score row writes all four", /diving_saves: e\.diving_saves, shutout_periods: e\.shutout_periods,/.test(rowsSrc) && /pen_shot_saves: e\.pen_shot_saves, pen_shots_against: e\.pen_shots_against/.test(rowsSrc));
A("the backfill is recorded", /52 of 52 goalie lines/.test(fs.readFileSync(path.join(__dirname, "..", "sql/2026-10-02-goalie-fields-backfill-v381.sql"), "utf8")));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
