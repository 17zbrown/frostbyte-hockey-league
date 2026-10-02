/* v3.65: roster players come first in a lineup (Q14). The database half was rehearsed in Postgres (recorded
   at the foot of the SQL file); this pins the record and the book, and RUNS the lineup builder's check. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 260))); } };
const sql = R("sql/2026-09-28-roster-first-v365.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const hub = R("src/live/part6_hub.js");

console.log("\n— the ruling is quoted");
A("Q14", /training camp player availability does matter\. They can play up to 3 games a week while roster players can play up to 6\. Roster players also must be prioritized in a lineup when available\./.test(sqlF));

console.log("\n— the database");
A("available means an explicit yes for this exact game", /n\.value->'games'->>p_game::text = 'yes'/.test(sql) && /when 'preseason' then 'pre' when 'playoff' then 'po' else 'w' end \|\| g\.week/.test(sql));
A("...not callable from the API", /revoke all on function public\.available_for_game\(uuid, uuid\) from public, anon, authenticated;/.test(sql));
A("skaters against skaters, goaltenders against goaltenders", /foreach v_kind in array array\[''skater'',''goal''\] loop/.test(sql) && /case when v_kind = ''goal'' then rs\.position::text = ''G'' else rs\.position::text <> ''G'' end/.test(sql));
A("eligible means available, not suspended, playoff-eligible and within his limit (or excepted)", /public\.available_for_game\(rs\.profile_id, p_game\)/.test(sql) && /not public\.is_suspended\(rs\.profile_id\)/.test(sql) && /public\.regular_gp\(v_game\.season_id, rs\.profile_id\) >= public\.playoff_min_gp/.test(sql) && /or public\.has_cap_exception\(p_game, rs\.profile_id\)\);/.test(sql));
A("counted against the open spots of that kind", /if coalesce\(array_length\(v_left, 1\), 0\) > v_empty then/.test(sql));
A("the anchor is asserted unique", /set_game_lineup: the anchor is not unique/.test(sql));
A("the rehearsal and the refile notice are recorded", /Result: REHEARSAL OK \(all five\)/.test(sql) && /Only DAL had any/.test(sql));

console.log("\n— v3.80: withdrawn (commissioner, 2026-10-02: \"I know this is a rule, but remove the mechanic for it\")");
/* the v3.65 record above stays: it is the history of the rule. What is pinned now is that nothing applies it. */
A("the lineup builder no longer applies it", !/Roster players come first \(Rule 5\.2\)/.test(hub) && /the v3\.65 roster-first check \(Q14\) is withdrawn/.test(hub));
A("set_game_lineup no longer applies it (the v3.80 record removes the block whole)", /v380_camp_players_dress_freely/.test(R("sql/2026-10-02-camp-players-dress-freely-v380.sql")));
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = global.CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
A("changelog keeps 3.65 as history", !!rb.changelog.find((c) => c.version === "3.65"));
A("5.1.1: camp players still submit availability", /Every rostered player, training-camp players included, must submit weekly availability/.test(secs["5.1"].paragraphs[0]));
A("5.2 no longer says roster players come first, in either format", !/Roster players come first/.test(secs["5.2"].paragraphs.join(" ")) && !/given preference over training-camp players/.test((secs["5.2"].full || []).join(" "))
  && /whether or not an active-roster player is left out of it/.test(secs["5.2"].paragraphs[2]));
A("5.1 no longer says an available roster player comes before a camp player", !/comes before a training-camp player/.test(secs["5.1"].paragraphs.join(" ")));


console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
