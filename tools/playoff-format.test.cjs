/* Playoff series: best-of-7, 2-2-3 in one week, higher seed home Wed+Fri (Rule 8.3).
   Run: node tools/playoff-format.test.cjs

   The scheduler used to lay one game per night, alternating home — contradicting a rulebook that
   already described best-of-7 2-2-3, and a DB trigger (trg_conclude_series) that already ends a
   series at four wins and deletes the rest. Only the client scheduler was wrong; this pins its
   2-2-3 shape and the corrected series-cap flag. */
const fs = require("fs"), path = require("path");
const live = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");
const pub2 = fs.readFileSync(path.join(__dirname, "..", "src/live/part5b_public2.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "..", "src/live/part3_content.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* the exact packing logic from CG.generatePlayoffRound, replicated to drive it */
function schedule(bestOf, higher, lower) {
  const SLOTS = ["21:00", "21:35", "22:10"], wk = ["Wed", "Thu", "Fri"];
  const perNight = [Math.min(2, bestOf), Math.min(2, Math.max(0, bestOf - 2)), Math.max(0, bestOf - 4)];
  const hostHigher = [true, false, true];
  const rows = []; let gi = 0;
  for (let ni = 0; ni < 3; ni++) for (let k = 0; k < perNight[ni] && gi < bestOf; k++, gi++) {
    const host = hostHigher[ni] ? higher : lower;
    rows.push({ game: gi + 1, night: wk[ni], slot: SLOTS[k], home: host, away: host === higher ? lower : higher });
  }
  return rows;
}

console.log("— best-of-7 lays out exactly 2-2-3");
{
  const g = schedule(7, "TOR", "BOS");
  const wed = g.filter((r) => r.night === "Wed"), thu = g.filter((r) => r.night === "Thu"), fri = g.filter((r) => r.night === "Fri");
  A("seven games total", g.length === 7);
  A("2 Wednesday, 2 Thursday, 3 Friday", wed.length === 2 && thu.length === 2 && fri.length === 3);
  A("higher seed home Wednesday and Friday", [...wed, ...fri].every((r) => r.home === "TOR"));
  A("lower seed home Thursday", thu.every((r) => r.home === "BOS"));
  A("each night uses distinct time slots", new Set(fri.map((r) => r.slot)).size === 3 && new Set(wed.map((r) => r.slot)).size === 2);
  A("the source schedules by night with a 2/2/rest split, not one-per-night alternating",
    /var perNight=\[Math\.min\(2,bestOf\), Math\.min\(2,Math\.max\(0,bestOf-2\)\), Math\.max\(0,bestOf-4\)\];/.test(live) &&
    /var hostHigher=\[true,false,true\];/.test(live));
  A("...and the old alternating one-per-night loop is gone", !/host = gi%2===0 \? m\[0\] : m\[1\]/.test(live));
}

console.log("\n— the config and copy agree on best-of-7");
{
  A("the client default is best of 7", /playoff_format\.bestOf\) \|\| 7;/.test(live));
  A("the panel offers 3/5/7", /\[3,5,7\]\.map/.test(live));
  A("...and notes the single-week 2-2-3 cadence", /2 games Wednesday, 2 Thursday, up to 3 Friday, higher seed home Wednesday and Friday/.test(live));
  const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
  const r83 = (() => { for (const c of rb.chapters) for (const s of c.sections) if (s.id === "8.3") return s.paragraphs.join(" "); })();
  A("Rule 8.3 already describes best-of-seven 2-2-3", /best-of-seven series played inside a single game week in a 2-2-3 format/.test(r83));
  A("...and win-4-and-advance with the rest cancelled", /wins four \(4\) games advances immediately, and the remaining games of the series are cancelled/.test(r83));
}

console.log("\n— the series-cap flag uses the right cap per position");
{
  A("the flag is cap-aware (skater 3, goalie 6)", /var cap = isGoalie \? 6 : 3;/.test(pub2));
  A("...flagging strictly ABOVE the cap", /return n>cap \?/.test(pub2));
  A("...called with isGoalie at both sites", /capFlag\(row\.pid, false\)/.test(pub2) && /capFlag\(gl\.pid, true\)/.test(pub2));
  A("the old flat 'more than four' flag is gone", !/n>4 \?/.test(pub2) && !/5TH GAME/.test(pub2));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
