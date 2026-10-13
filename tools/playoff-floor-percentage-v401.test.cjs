/* v4.01 (2026-10-13). Asked whether Season 2's floor of 17 (30% of 54 = 16.2, rounded up) should become 16 under the .4 rule,
   the commissioner: "Keep the same percentage no matter what we end up making the season length to be."
   Rehearsed on production rolled back, then applied: Season 1 stays 16, Season 2 becomes 16; set to 5 weeks Season 2 read
   45 games and 14, with two puck-drop times 36 games and 11; a hand-typed 30 was overwritten. KwikTripJesus stays 13. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-13-playoff-floor-percentage-v401.sql"), live = R("src/live/part_live.js");
let fail = 0, n = 0;
const A = (name, cond) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name); } };

console.log("— the rule, as the site works it");
const ctx = {}; vm.runInNewContext("var CG = {};" + live.match(/CG\.PLAYOFF_FLOOR_PCT = 30;/)[0] + live.match(/CG\.playoffFloorOfLength = function[^\n]*/)[0] +
  " out = [54, 48, 45, 42, 60, 36, 72].map(CG.playoffFloorOfLength);", ctx);
A("54 -> 16 (16.2), 48 -> 14 (exactly 14.4 rounds down), 45 -> 14 (13.5), 42 -> 13 (12.6), 60 -> 18, 36 -> 11 (10.8), 72 -> 22 (21.6)",
  JSON.stringify(ctx.out) === "[16,14,14,13,18,11,22]");

console.log("— the database");
A("thirty percent in whole numbers, .4 or less down",
  /select case when \(coalesce\(p_games, 0\) \* 30\) % 100 > 40 then \(coalesce\(p_games, 0\) \* 30\) \/ 100 \+ 1/.test(sql));
A("the schedule's length once built (most regular games any club has, voided aside), else the shape",
  /v_len := public\.season_schedule_length\(new\.id\);\n\s+if v_len is null then\n\s+v_len := public\.season_games_per_club\(new\.weeks, new\.nights_per_week, new\.night_slots\);/.test(sql) &&
  /new\.playoff_min_gp := least\(200, public\.playoff_floor_of_length\(v_len\)\);/.test(sql) &&
  /create trigger games_playoff_floor_ins after insert on public\.games/.test(sql) && /create trigger games_playoff_floor_del after delete on public\.games/.test(sql));
A("the season's length is read as CG.seasonShape reads it: weeks x nights a week x puck-drop times",
  /select greatest\(1, coalesce\(nullif\(p_weeks, 0\), ceil\(72\.0 \/ sh\.slots \/ sh\.nights\)::int\)\) \* sh\.nights \* sh\.slots from sh/.test(sql));
A("a trigger writes the floor onto every basic season, whatever is typed",
  /create trigger season_playoff_floor_trg before insert or update on public\.seasons/.test(sql) &&
  /if coalesce\(new\.format, 'basic'\) = 'basic' then/.test(sql));
A("Season 1 stays 16 and Season 2 becomes 16, checked as it applies",
  /where number = 1\) <> 16 then raise exception 'v4\.01: Season 1 moved'/.test(sql) && /where number = 2\) <> 16 then raise exception 'v4\.01: Season 2 is not 16'/.test(sql));

console.log("— the site");
A("CG.fmt reads the season's floor, else works it out from the season's shape as the generator reads it",
  /if \(sp && CG\.seasonShape && CG\.playoffFloorOfLength\) return CG\.playoffFloorOfLength\(CG\.seasonShape\(sp\)\.perClub\); \}/.test(live));
A("the editor shows no floor for the full format", /document\.getElementById\("ssPoMin"\)\.value = f==="basic" \? /.test(live) && /: CG\.fmt\("playoff_min_gp", s\)\) : 0;/.test(live));
A("the Seasons editor shows it read-only and never sends it",
  /<input id="ssPoMin" type="number" value="'\+CG\.fmt\("playoff_min_gp", s\)\+'" readonly/.test(live) && !/playoff_min_gp:\(poRaw/.test(live));

console.log("— the rulebook and changelog");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = (id) => { const x = rb.chapters.flatMap((c) => c.sections || []).find((s) => s.id === id); return x.paragraphs.join(" "); };
A("Rule 8.3 fixes the floor at 30% whatever the length", /\(the playoff eligibility floor\) is thirty percent \(30%\) of a club's regular-season schedule/.test(sec("8.3")) &&
  /The percentage holds whatever length a season is given/.test(sec("8.3")) && !/The commissioner shall determine, for each season, the number of regular-season games/.test(sec("8.3")));
A("Rules 0.1 and 10.1 no longer call it a season setting", /\(Rule 2\.8\) are season settings rather than fixed provisions/.test(sec("0.1")) && /is not a setting: it is thirty percent \(30%\)/.test(sec("0.1")) &&
  /The playoff eligibility floor is not a season setting/.test(sec("10.1")));
A("Rule 0.8 and Rule 2.8 say where it comes from", /at least the playoff eligibility floor, thirty percent \(30%\) of the season's regular-season games rounded to the nearest game/.test(sec("0.8")) &&
  /the playoff eligibility floor that Rule 8\.3 sets from the season's length/.test(sec("2.8")));
A("Chapter S2.7 says sixteen at fifty-four games, not seventeen", /sixteen \(16\) games while Season 2 is fifty-four \(54\) games long/.test(sec("S2.7")) && !/seventeen/.test(sec("S2.7")));
const cl = rb.changelog.find((c) => c.version === "4.01");
A("changelog 4.01 is in the book", !!cl);
A("no em dash in what v4.01 wrote", !/—/.test(JSON.stringify(cl)) && !/—/.test(sql));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
