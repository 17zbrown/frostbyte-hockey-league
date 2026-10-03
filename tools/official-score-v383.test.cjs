/* v3.83: a game's score is EA's official result unless the sitting was a disconnect. Commissioner, 2026-10-02, on DET v
   NYI (Oct 1, filed 6-1 while EA and the Islanders' goaltender said 7-1): "7-1 + fix importer". This RUNS the
   importer's own normalizeMatch and mergeSegments, and pins the stats-desk note, the record and the book. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "..", "netlify/functions/ingest-stats.js"), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 240))); } };
const fn = (name) => { const i = src.indexOf("function " + name + "("); return src.slice(i, src.indexOf("\n}\n", i) + 2); };
const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const lib = new Function("etFmt", "const etDayUnix = (s) => etFmt.format(new Date(s * 1000));\n" + fn("mapPos") + fn("normalizeMatch") + fn("mergeSegments") + "\nreturn { normalizeMatch, mergeSegments };")(etFmt);
const sk = (g) => ({ playername: "s" + g, position: "center", skgoals: String(g), toiseconds: "3600" });
const raw = (id, a, b, aPlayers, bPlayers, dnf) => ({ matchId: id, timestamp: 1759453200,
  clubs: { "1": { score: String(a), result: "1", winnerByDnf: dnf ? "1" : "0" }, "2": { score: String(b), result: "2" } },
  players: { "1": Object.fromEntries(aPlayers.map((g, i) => ["1" + i, sk(g)])), "2": Object.fromEntries(bPlayers.map((g, i) => ["2" + i, sk(g)])) } });
const club = (m, id) => m.clubs.find((c) => c.ea_club_id === id);

console.log("— the score");
let m = lib.normalizeMatch(raw("A", 7, 1, [4, 2], [1], false));
A("a clean sitting: EA's official 7, though the players hold 6 (DET v NYI, Oct 1)", club(m, "1").score === 7 && club(m, "1").unattributed === 1, club(m, "1"));
A("...the other club unchanged and nothing unattributed", club(m, "2").score === 1 && club(m, "2").unattributed === 0);
m = lib.normalizeMatch(raw("B", 3, 0, [2], [0], true));
A("a disconnected sitting: the players' goals, never EA's 3-0 placeholder (v3.06)", club(m, "1").score === 2 && club(m, "1").unattributed === 0, club(m, "1"));
m = lib.normalizeMatch(raw("C", 1, 0, [2], [0], false));
A("never below the players' own goals", club(m, "1").score === 2);
m = lib.normalizeMatch(raw("D", 3, 2, [3], [2], false));
A("the usual case: they agree", club(m, "1").score === 3 && club(m, "2").score === 2 && !club(m, "1").unattributed && !club(m, "2").unattributed);
const s1 = lib.normalizeMatch(raw("E", 3, 0, [2], [0], true)), s2 = lib.normalizeMatch(Object.assign(raw("F", 2, 1, [1], [1], false), { timestamp: 1759455000 }));
const mg = lib.mergeSegments([s1, s2]);
A("a merge adds each sitting by its own rule (2 played + 2 official) and carries what no player holds", club(mg, "1").score === 4 && club(mg, "1").unattributed === 1, club(mg, "1"));

console.log("— the note and the book");
A("the statistics desk is told, on every filing path", (src.match(/await noteUnattributed\(/g) || []).length === 3 && /A goal no player holds/.test(src));
global.CG = {}; vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "src/live/part3_content.js"), "utf8"));
const rb = CG.CONTENT.rulebook, s62 = rb.chapters.flatMap((c) => c.sections || []).find((x) => x.id === "6.2");
A("Rule 6.2: the score is EA's official result; the players' goals only on a disconnect", /A game's score is EA's official result for it/.test(s62.paragraphs[0]) && /only where a disconnection leaves EA's score a placeholder/.test(s62.paragraphs[0]));
A("changelog 3.83", !!rb.changelog.find((c) => c.version === "3.83"));
A("the correction is recorded", /6a71983a-2f6a-462a-9def-311f09d6baf5/.test(fs.readFileSync(path.join(__dirname, "..", "sql/2026-10-02-official-score-v383.sql"), "utf8")));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
