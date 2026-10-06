/* v3.87: Players of the Week are a forward, a defenseman and a goaltender. Commissioner, 2026-10-06: "for player of the
   week posts, can you choose one forward, one defenseman, and 1 goalie? They need to have played at least 3 games that
   week and they also can only have played that position for that week."
   Pins the database rule (sql/2026-10-06-players-of-the-week-v387.sql), the one client helper every honors surface reads
   (CG.potwPicks), the live mapping of award rows into weeks, and Rule 9.1. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-06-players-of-the-week-v387.sql");
const engine = R("src/live/part2_engine.js"), live = R("src/live/part_live.js");
const pubA = R("src/live/part5a_public.js"), pubB = R("src/live/part5b_public2.js"), content = R("src/live/part3_content.js");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };

/* ---- database ---- */
A("the category check admits potw_forward and potw_defense, and keeps potw_skater for Weeks 1 and 2",
  /'potw_skater', 'potw_forward', 'potw_defense', 'potw_goalie'/.test(sql));
A("eligible = at least 3 games that week, every line in ONE position group", /where ngrp = 1 and gp >= 3/.test(sql)
  && /count\(distinct grp\) as ngrp, count\(distinct game_id\) as gp/.test(sql));
A("the group is G for a goaltender's line, pos_group(position) otherwise",
  /case when gs\.is_goalie then 'G' else public\.pos_group\(gs\.position\) end as grp/.test(sql));
A("forward: points, goals, plus-minus, then profile id", /'potw_forward' as cat, e\.\* from elig e where e\.grp = 'F'\s+order by e\.g \+ e\.a desc, e\.g desc, e\.pm desc, e\.profile_id limit 1/.test(sql));
A("defenseman: points, plus-minus, blocks + takeaways, then profile id", /'potw_defense', e\.\* from elig e where e\.grp = 'D'\s+order by e\.g \+ e\.a desc, e\.pm desc, e\.dplay desc, e\.profile_id limit 1/.test(sql));
A("goaltender: save %, saves, then profile id; at least one shot faced", /'potw_goalie', e\.\* from elig e where e\.grp = 'G' and e\.sa > 0\s+order by e\.sv::numeric \/ e\.sa desc, e\.sv desc, e\.profile_id limit 1/.test(sql));
A("null stats count as zero, so a missing plus-minus can't sort first", /coalesce\(gs\.plus_minus, 0\) as plus_minus/.test(sql) && /coalesce\(gs\.goals, 0\) as goals/.test(sql));
A("the club named is the one his last game of the week was for", /\(array_agg\(team_id order by scheduled_at desc\)\)\[1\] as team_id/.test(sql));
A("a week already named under any POTW category is never re-minted", /a\.category like 'potw\\_%'/.test(sql));
A("a position with nobody eligible no longer cancels the week", !/if sk\.profile_id is null or gl\.profile_id is null/.test(sql)
  && /if cardinality\(v_sent\) = 0 then continue; end if;/.test(sql));
A("the news title has no em dash", /'Players of the Week: Week ' \|\| w\.week/.test(sql) && !/—/.test(sql));

/* ---- CG.potwPicks ---- */
const helper = engine.match(/CG\.potwPicks = function\(lg, w\)\{[\s\S]*?\n\};/);
A("CG.potwPicks is defined in the engine", !!helper);
const CG = { playerById: (lg, id) => lg.players.find((p) => p.id === id) };
eval(helper[0]);
const lg = { players: [{ id: "f1", tag: "Fwd" }, { id: "d1", tag: "Dman" }, { id: "g1", tag: "Goalie" }, { id: "s1", tag: "Skater" }] };
const roles = (w) => CG.potwPicks(lg, w).map((x) => x.role + ":" + x.p.tag).join(",");
A("a v3.87 week reads forward, defenseman, goaltender in that order",
  roles({ week: 3, goalie: "g1", defense: "d1", forward: "f1", fBlurb: "x" }) === "Forward:Fwd,Defenseman:Dman,Goaltender:Goalie", roles({ week: 3, goalie: "g1", defense: "d1", forward: "f1" }));
A("a Week 1 or 2 entry still reads skater, goaltender", roles({ week: 1, skater: "s1", goalie: "g1" }) === "Skater:Skater,Goaltender:Goalie");
A("a pick who has left the league drops out and the rest still show", roles({ week: 4, forward: "gone", defense: "d1", goalie: "g1" }) === "Defenseman:Dman,Goaltender:Goalie");
A("the blurb rides along", CG.potwPicks(lg, { forward: "f1", fBlurb: "3G 4A across 6 games" })[0].blurb === "3G 4A across 6 games");
A("no week, no picks", CG.potwPicks(lg, undefined).length === 0);

/* ---- live mapping: award rows into weeks ---- */
const mapBlock = live.match(/var POTW_FIELDS = [\s\S]*?lg\.potw = Object\.values\(potwByWeek\)\.sort\(function\(a,b\)\{ return \(a\.week\|\|0\)-\(b\.week\|\|0\); \}\);/);
A("part_live maps every POTW category through one table", !!mapBlock);
const seasonAwardsRaw = [
  { week: 1, category: "potw_skater", profile_id: "s1", stat_line: "a" }, { week: 1, category: "potw_goalie", profile_id: "g1", stat_line: "b" },
  { week: 3, category: "potw_forward", profile_id: "f1", stat_line: "c" }, { week: 3, category: "potw_goalie", profile_id: "g1", stat_line: "d" },
  { week: null, category: "mvp", profile_id: "f1" }];
const lg2 = {};
(function (lg) { eval(mapBlock[0]); })(lg2);
A("weeks come out in order", lg2.potw.map((w) => w.week).join(",") === "1,3");
A("a week with no defenseman named is kept (the old map dropped any week missing a pick)", lg2.potw[1].forward === "f1" && lg2.potw[1].goalie === "g1" && !lg2.potw[1].defense);
A("season awards are not mistaken for weekly picks", lg2.potw.length === 2);

/* ---- every surface reads the helper ---- */
A("awards page lists each week's picks from CG.potwPicks", /var picks = CG\.potwPicks\(lg, w\);/.test(pubB) && /pk\.role\+' of the Week/.test(pubB));
A("home carousel, honors section, club honors and player honors all read CG.potwPicks",
  (pubA.match(/CG\.potwPicks\(lg, /g) || []).length >= 5);
A("no surface still requires a skater AND a goaltender", !/CG\.playerById\(lg,\s*w\.skater\) && CG\.playerById\(lg,\s*w\.goalie\)/.test(pubB + pubA)
  && !/\.skater\)\s*\n\s*&& CG\.playerById\(lg, \(lg\.potw/.test(pubA));

/* ---- rulebook + changelog ---- */
A("Rule 9.1 states the weekly rule", /a Forward, a Defenseman and a Goaltender of the Week/.test(content) && /at least three games that week, every one of them at that position/.test(content));
A("the 3.87 changelog entry is there", /"version":"3\.87","dateIso":"2026-10-06"/.test(content));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
