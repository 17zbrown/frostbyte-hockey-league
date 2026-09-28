/* v3.54: the weekly limit is hard, with a rare recorded exception; the line builder warns (yellow,
   red) instead of refusing. The database half was rehearsed in Postgres (recorded at the foot of the
   SQL file); this pins the record and the site, and drives CG.lineCapState on a stubbed week. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-weekly-limit-v354.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const hub = R("src/live/part6_hub.js"), live = R("src/live/part_live.js"), desks = R("src/live/part9_staffdesks.js"), head = R("src/live/part1_head.html");

console.log("\n— the rulings are quoted");
A("the hard limit and the rare overrule", /hard limit of 6 games per week for roster players and 3 for training camp players\. This limit can be overruled by staff or the commissioners, but very rarely/.test(sqlF));
A("yellow and red", /make the player's box outline yellow/.test(sqlF) && /outline their box red/.test(sqlF));

console.log("\n— the database");
A("one exception per player per game", /unique \(game_id, profile_id\)/.test(sql));
A("new table: RLS on, members read, no anon, service writes", /enable row level security/.test(sql) && /revoke all on public\.weekly_cap_exceptions from public, anon;/.test(sql) && /grant select on public\.weekly_cap_exceptions to authenticated;/.test(sql) && /grant all on public\.weekly_cap_exceptions to service_role;/.test(sql));
A("officiating or a commissioner grants", /if v_me is null or not \(public\.is_commissioner\(\) or public\.has_department\('officiating'\)\) then/.test(sql));
A("a reason is required", /if length\(v_reason\) < 10 then/.test(sql));
A("only a player already at his limit", /if v_n < v_cap then\s+raise exception '% still has room/.test(sql));
A("before the game, not after", /An exception is granted before a game is played, not after\./.test(sql));
A("every commissioner and the club are told", /notify_commissioners\(array\[v_me\], 'flag', 'A weekly limit exception was granted'/.test(sql) && /'Weekly limit exception granted'/.test(sql));
A("the filer honors it, both checks", /if v_dressed >= v_cap and not public\.has_cap_exception\(p_game, v_p\) then/.test(sql) && /patch the longer\s+one first/.test(sql));
A("the post-game review honors it", /if v_n > v_cap and not public\.has_cap_exception\(p_game, r\.profile_id\)/.test(sql));
A("the line saver no longer refuses a goaltender", /no refusal for a goaltender on more lines than his week allows/.test(sql) && /position\('already backstops' in substr\(d0, i, j - i\)\) = 0/.test(sql));
A("the rehearsal is recorded", /T4\s+the excepted game files; the NEXT game is still refused/.test(sql));

console.log("\n— the site");
A("exceptions are loaded for signed-in members", /from\("weekly_cap_exceptions"\)\.select\("id,game_id,profile_id,team_id,reason,granted_by,created_at"\)\.eq\("season_id", CG\.SEASON\.id\)/.test(live));
A("the per-game builder honors an exception", /if \(used >= cap && !\(CG\.capExceptionFor && CG\.capExceptionFor\(game\.id, p\.id\)\)\) return/.test(hub));
A("the goaltender refusal is gone from the builder", !/function goalieCapped/.test(hub) && !/goalieCapped\(/.test(hub));
A("placements warn, never refuse, on the limit", /capWarnAfter\(pid\);/.test(hub) && /var why = fits\(pid, pos\);\n/.test(hub));
A("saving flagged lines asks first", /"Save lines that may go over the weekly limit\?"/.test(hub) && /"Save anyway", doSave\)/.test(hub));
A("the outlines exist in both themes' ink", /\.lc-slot\.cap-warn,\.lc-pc\.cap-warn\{outline:2px solid var\(--amber-ink\)/.test(head) && /\.lc-slot\.cap-over,\.lc-pc\.cap-over\{outline:2px solid var\(--red-ink\)/.test(head));
A("...and say it in words, not only color", /' · OVER LIMIT' : ' · MAY GO OVER'/.test(hub));
A("the Officials' desk grants and withdraws", /CG\.sb\.rpc\("grant_cap_exception", \{ p_game: gid, p_profile: pid, p_reason: why \}\)/.test(desks) && /CG\.sb\.rpc\("revoke_cap_exception"/.test(desks) && /CG\.wireCapExceptions\(\);/.test(desks));
A("...counting both clubs' filed sheets, not only the viewer's own", /from\("game_lineups"\)\.select\("game_id,team_id,center,lw,rw,ld,rd,goalie"\)\.in\("game_id"/.test(desks));

console.log("\n— CG.lineCapState on a stubbed week (cap 6, three games a night)");
{
  const src = hub.slice(hub.indexOf("CG.lineCapState = function"), hub.indexOf("CG.lineNights = function"));
  const now = Date.parse("2026-09-30T20:00:00-04:00");
  const at = (d, h) => Date.parse(`2026-${d}T${h}:00-04:00`);
  const G = (id, day, h, status) => ({ id, week: 2, stage: "regular", home: "BOS", away: "TOR", at: at(day, h), status: status || "scheduled" });
  const schedule = [G("w1","09-30","21:00"), G("w2","09-30","21:35"), G("w3","09-30","22:10"),
                    G("t1","10-01","21:00"), G("t2","10-01","21:35"), G("t3","10-01","22:10"),
                    G("f1","10-02","21:00"), G("f2","10-02","21:35"), G("f3","10-02","22:10")];
  const night = (g) => ({ "09-30": "wed", "10-01": "thu", "10-02": "fri" })[new Date(g.at - 4 * 3600e3).toISOString().slice(5, 10)];
  const mk = (played, lines, plan, exc) => {
    const CG = { lg: { schedule, _lineups: {}, capExceptions: exc || [] }, now: () => now,
      lineNights: () => [{ key: "wed", game: schedule[0] }],
      weekLoad: () => ({ played, cap: 6 }),
      gameNight: night, lcGameSlot: (club, nk) => plan[nk] == null ? null : plan[nk],
      capExceptionFor: (gid, pid) => (exc || []).some((e) => e.game_id === gid && e.profile_id === pid) };
    vm.runInNewContext(src, { CG, Object, isFinite });
    return CG.lineCapState({ id: "p1", tag: "Goalie" }, "BOS", (n) => lines[n] || {});
  };
  const on = { G: "p1" };
  let st = mk(0, { 1: on, 2: on }, { wed: 1, thu: 2, fri: 3 });
  A("on two lines, nothing played: six ahead, no warning", st && st.level === null && st.ahead === 6, JSON.stringify(st));
  st = mk(0, { 1: on, 2: on, 3: on }, { wed: 1, thu: 2, fri: 3 });
  A("on three lines: nine ahead against six, YELLOW", st && st.level === "warn" && st.projected === 9, JSON.stringify(st));
  st = mk(6, { 3: on }, { wed: 1, thu: 2, fri: 3 });
  A("already played six, still on a line: RED", st && st.level === "over", JSON.stringify(st));
  st = mk(6, {}, { wed: 1, thu: 2, fri: 3 });
  A("played six, on no line: no outline", st && st.level === null, JSON.stringify(st));
  st = mk(3, { 1: on, 2: on }, { wed: 1, thu: 2, fri: 3 });
  A("played three, two lines ahead: YELLOW (3 + 6 > 6)", st && st.level === "warn", JSON.stringify(st));
  st = mk(0, { 1: on, 2: on, 3: on }, { wed: 1, thu: 2, fri: 3 }, [{ game_id: "f1", profile_id: "p1" }, { game_id: "f2", profile_id: "p1" }, { game_id: "f3", profile_id: "p1" }]);
  A("a game the office excepted him for is left out", st && st.level === null && st.ahead === 6, JSON.stringify(st));
  st = mk(0, { 1: on }, { wed: 1 });
  A("a night with no line counts by its filed sheet (none filed): three ahead", st && st.ahead === 3 && st.level === null, JSON.stringify(st));
}

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.54");
A("changelog records 3.54", !!e);
A("5.2.2: hard, with the rare exception", /The limit is hard\. Very rarely, the league office may except one named player from it for one named game/.test(secs["5.2"].paragraphs[1]));
A("5.2.2: the line builder outlines instead of refusing", /outlines him in yellow where his lines may take him past his limit, and in red/.test(secs["5.2"].paragraphs[1]));
A("5.2.2: the em dashes are gone from the sentence it touched", !/active-roster player —/.test(secs["5.2"].paragraphs[1]));
A("5.2.3 and 8.3.3 carry the exception", /exception included/.test(secs["5.2"].paragraphs[2]) && /exception under Rule 5\.2 applies to this cap/.test(secs["8.3"].paragraphs[2]));
A("no em dashes or spaced hyphens in the 3.54 entry", !/—| - /.test(JSON.stringify(e)));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
