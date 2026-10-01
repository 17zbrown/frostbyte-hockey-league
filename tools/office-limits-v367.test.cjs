/* v3.67: Q52 the league office is bound by the cap; Q59 overalls are the engine's alone; Q23 combining sittings is
   statistics staff's. The database half was rehearsed in Postgres (recorded at the foot of the SQL file). */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-office-limits-v367.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const live = R("src/live/part_live.js"), ing = R("netlify/functions/ingest-stats.js");

console.log("\n— the rulings are quoted");
A("Q52", /Q52 \(may a commissioner's own action[\s\S]{0,160}"no\."/.test(sqlF));
A("Q59", /commissioners should not be able to edit player or team overalls/.test(sqlF));
A("Q23", /Only the specific staff for that and commissioners\./.test(sqlF));

console.log("\n— the database");
A("Q52: guard_roster_cap loses the commissioner exemption", /replace\(d0,\s+'  if public\.is_commissioner\(\) then return new; end if;',/.test(sql));
A("...accept_trade checks the cap for a commissioner too", /'if true then   \/\* v3\.67 \(Q52\): a commissioner''s acceptance is bound by the cap too \*\//.test(sql));
A("...an appointment's salary rise is cap-checked", /if v_sal - coalesce\(v_now,0\) > 0 and not public\.cap_has_room\(v_season, p_team, v_sal - coalesce\(v_now,0\)\) then/.test(sql));
A("Q59: only the engine's flag changes an overall, checked before any exemption", /if new\.overall is distinct from old\.overall and coalesce\(current_setting\(''app\.ovr_engine'', true\), ''''\) <> ''on'' then\s+new\.overall := old\.overall;\s+end if;\s+if public\.trusted_writer\(\) or public\.is_commissioner\(\) then return new; end if;/.test(sql));
A("...the engine raises and clears it", /perform set_config\(''app\.ovr_engine'', ''on'', true\);[\s\S]{0,120}update public\.profiles set overall=v_ov where id=p_profile;\s+perform set_config\(''app\.ovr_engine'', '''', true\);/.test(sql));
A("...the scouting rating is frozen for everyone", /elsif new\.scout_ovr is distinct from old\.scout_ovr then new\.scout_ovr := old\.scout_ovr; end if;\s+if public\.trusted_writer\(\)/.test(sql));
A("the rehearsal is recorded", /with the cap at exactly that payroll it went\s+through/.test(sql) && /Kraken over the salary cap/.test(sql));

console.log("\n— the stats import (Q23)");
A("a club's management cannot combine two or more sittings", /if \(actor\.via === "management" && matchIds\.length > 1\)\s+return \{ statusCode: 403/.test(ing));

console.log("\n— the site");
A("no Scout OVR input or header, no scout_ovr write", !/data-scout=/.test(live) && !/update\(\{scout_ovr:/.test(live) && !/<th>Scout OVR<\/th>/.test(live));
A("lists read the engine overall", /CG\.regOverall = function\(r\)\{/.test(live) && (live.match(/CG\.regOverall\(/g) || []).length >= 6 && /jersey_number,overall\)/.test(live));
A("the club desk attaches one sitting", /Attach this sitting to the game/.test(live) && /* v3.76: one sitting for a club; the league office and statistics staff may combine */ /if \(ids\.length > 1 && !gsMulti\)\{ CG\.toast\("Statistics staff combine a game played in more than one sitting \(Rule 4\.3\)"/.test(live) && !/Combine the selected sittings/.test(live));

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.67");
A("changelog records 3.67", !!e);
A("2.5.1: the office is bound by the cap", /The league office is bound by the cap as the clubs are/.test(secs["2.5"].paragraphs[0]));
A("6.1.2: no hand edits, the commissioner included", /Ratings are not hand-edited by anyone, the commissioner included/.test(secs["6.1"].paragraphs[1]) && !/the commissioner may correct a single rating/.test(secs["6.1"].paragraphs[1]));
A("6.2.1 and 4.3.3: statistics staff or a commissioner combine", /by statistics staff or a commissioner \(Rule 4\.3\)\. A club's management may attach the single sitting/.test(secs["6.2"].paragraphs[0]) && /stats import by statistics staff or a commissioner,/.test(secs["4.3"].paragraphs[2]));
A("no em dashes or spaced hyphens in the 3.67 entry", !/—| - /.test(JSON.stringify(e)));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
