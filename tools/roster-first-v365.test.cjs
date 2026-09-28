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

console.log("\n— the lineup builder runs the same test");
const m = hub.match(/  function validate\(p, pos\)\{[\s\S]*?\n  \}\n/);
A("located validate()", !!m);
if (m) {
  const mk = (id, tag, pos, squad) => ({ id, tag, pos, squad });
  const roster = [mk("r1","R1","C","pro"), mk("r2","R2","LW","pro"), mk("r3","R3","RW","pro"), mk("r4","R4","LD","pro"), mk("r5","R5","RD","pro"),
                  mk("r6","R6","C","pro"), mk("g1","G1","G","pro"), mk("c1","C1","C","tc"), mk("cg","CG","G","tc")];
  const run = (slots, pid, pos, avail) => {
    const ctx = { Object, Array, String, Math, JSON,
      CG: { POS_NAME: {}, posGroup: (p) => (p === "G" ? "G" : /D$/.test(p) ? "D" : "F"), isWaived: () => false,
            weekGamesFor: () => 0, gameCapFor: (x) => (x.squad === "tc" ? 3 : 6), capExceptionFor: () => false },
      lg: { byTeam: { DAL: roster }, suspensions: [] }, club: "DAL", game: { id: "g", stage: "regular" },
      state: { slots }, isLocked: () => false, flex: () => true, preGame: false,
      avState: (x) => (avail.indexOf(x.id) >= 0 ? "yes" : "nr") };
    vm.createContext(ctx);
    vm.runInContext(m[0] + "\nthis.out = validate(CG_p, CG_pos);".replace("CG_p", JSON.stringify(roster.find((x) => x.id === pid))).replace("CG_pos", JSON.stringify(pos)), ctx);
    return ctx.out;
  };
  const five = { LW: "r2", C: "r1", RW: "r3", LD: "r4", RD: "r5" };
  const four = { LW: "r2", RW: "r3", LD: "r4", RD: "r5", G: "g1" };   /* C open for the camp skater */
  const r1 = run(four, "c1", "C", ["r1","r2","r3","r4","r5","r6","g1"]);
  A("a camp skater over available roster skaters left out is refused, by name", /^Roster players come first \(Rule 5\.2\): R1, R6 are available for this game and not in the lineup/.test(r1 || ""), r1);
  A("...allowed when no roster skater left out said yes", run(four, "c1", "C", ["r2","r3","r4","r5","g1"]) === null);
  const r2 = run(five, "c1", "C", ["r2","r3","r4","r5","g1"]);
  A("...and replacing a roster skater who said yes counts him as left out", r2 === null && /R1 is available/.test(run(five, "c1", "C", ["r1","r2","r3","r4","r5","g1"]) || ""));
  A("a camp goaltender is judged against goaltenders only", run(Object.assign({}, five), "cg", "G", ["r1","r2","r3","r4","r5","r6"]) === null &&
    /the goaltender’s spot/.test(run(Object.assign({}, five), "cg", "G", ["g1"]) || ""));
  A("open spots count: one camp skater with four skater spots open and one roster skater out is fine", run({ C: "r1" }, "c1", "LW", ["r1","r6"]) === null);
}

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = global.CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.65");
A("changelog records 3.65", !!e);
A("5.1.1: camp players submit availability", /Every rostered player, training-camp players included, must submit weekly availability/.test(secs["5.1"].paragraphs[0]));
A("5.2.3: roster players come first, refused on filing", /Roster players come first\. A training-camp player may be dressed in a game only when no active-roster player who is available for that game/.test(secs["5.2"].paragraphs[2]) && /A lineup that breaks this is refused when it is filed/.test(secs["5.2"].paragraphs[2]));
A("no em dashes or spaced hyphens in the 3.65 entry", !/—| - /.test(JSON.stringify(e)));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
