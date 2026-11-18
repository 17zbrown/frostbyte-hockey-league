/* v4.52 (2026-11-17): the commissioner, while revising the Season 2 recruiting graphic: "Keep the roster size at 12 for the
   full season", "The draft should be 9 rounds since owners can select their GMs and AGMs pre-draft" and "The playoff
   eligibility game number should be 6 games since that is how many games it takes to generate a more accurate player
   rating." The roster limit became a season setting the database honors (guard_season_format allows 9 to the format's
   most; season_rules reads the season's own), Season 2 is 12 and 9 rounds, the floor is six for every basic season
   without a ruled one (Season 1 keeps fourteen), the draft-night announcement reads the season's rounds, and the
   Control Center no longer writes the format's fifteen back over a season's roster limit.
   The SQL ran as a rolled-back rehearsal on production before it was applied (results recorded in the SQL file).
   Run: node tools/season2-rulings-v452.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sql = R("sql/2026-11-17-season2-rulings-v452.sql");
const body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const live = R("src/live/part_live.js");
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const rows = [...body.matchAll(/\((\d+), '([^']+)',\s*\$a\$([\s\S]*?)\$a\$,\s*\$b\$([\s\S]*?)\$b\$\)/g)].map((m) => ({ ord: +m[1], fn: m[2], a: m[3], b: m[4] }));
const row = (ord) => rows.find((r) => r.ord === ord) || { a: "", b: "", fn: "" };

console.log("# the database");
A("seven anchored patches across five functions", rows.length === 7 && new Set(rows.map((r) => r.fn)).size === 5, rows.length);
A("each anchor must match exactly once, and five functions are re-created", /if n <> 1 then raise exception 'v4\.52: % anchor % found % times'/.test(body) && /if v_fns <> 5 then raise exception/.test(body));
A("the guard allows a season's roster from 9 to the format's most, not only the format's",
  row(1).fn === "public.guard_season_format()" && /if new\.roster_max is distinct from v_max then/.test(row(1).a) &&
  /if new\.roster_max is null or new\.roster_max > v_max or new\.roster_max < 9 then/.test(row(1).b) && !/%-man/.test(row(1).b));
A("season_rules returns the season's own roster limit", row(2).fn === "public.season_rules(uuid)" && /'roster_max', s\.roster_max,/.test(row(2).b));
A("the format's floor is six", row(4).fn === "public.format_rules(text)" && row(4).a === '"series_cap":4,"playoff_min_gp":16,' && row(4).b === '"series_cap":4,"playoff_min_gp":6,');
A("the floor trigger writes the format's six, no longer thirty percent of the length",
  row(6).fn === "public.season_playoff_floor()" && /playoff_floor_of_length\(v_len\)/.test(row(6).a) &&
  /new\.playoff_min_gp := \(public\.format_rules\('basic'\)->>'playoff_min_gp'\)::int;/.test(row(6).b) && !/v_len/.test(row(6).b) && row(5).b === "begin");
A("the ruled floor still comes first (it is outside every anchor, so it stands)", !rows.some((r) => /playoff_floor_ruled/.test(r.a)));
A("the draft-night announcement reads the season's rounds", row(7).fn === "public.announce_lifecycle()" &&
  row(7).a === "(public.format_rules(s.format)->>'draft_rounds')::int)" && row(7).b === "(public.season_rules(s.id)->>'draft_rounds')::int)");
A("Season 2 is set to 12 and 9 rounds, and only Season 2", /update public\.seasons set roster_max = 12, draft_rounds = 9 where number = 2 and status = 'upcoming';/.test(body));
A("self-checks: Season 2 12/9/6, Season 1 15/14/12, season_rules reads both, the format six, no Season 2 board",
  /s2\.roster_max <> 12 or s2\.draft_rounds <> 9 or s2\.playoff_min_gp <> 6/.test(body) && /s1\.roster_max <> 15 or s1\.playoff_min_gp <> 14 or s1\.draft_rounds <> 12/.test(body) &&
  /\(public\.season_rules\(s2\.id\)->>'roster_max'\)::int <> 12/.test(body) && /\(public\.format_rules\('basic'\)->>'playoff_min_gp'\)::int <> 6/.test(body) &&
  /exists \(select 1 from public\.draft_picks where season_number = 2\)/.test(body));
A("the patch table lives only for the transaction", /create temp table _v452_patch .* on commit drop;/.test(body));
A("rehearsal recorded", /Result: REHEARSAL OK: T1 T2 T3 T4 T5 T6\./.test(sql));
A("applied, and the grant audit returned zero rows", /Applied as migration v452_season2_rulings; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
A("no later record brings back the old guard or the thirty percent trigger",
  fs.readdirSync(path.join(ROOT, "sql")).filter((f) => f.endsWith(".sql") && f > "2026-11-17-season2-rulings-v452.sql").every((f) => { const t = R("sql/" + f); return t.indexOf(row(1).a) < 0 && t.indexOf(row(6).a) < 0; }));

console.log("\n# the site");
A("the format table's floor is six", /cap_camp:3, series_cap:4, playoff_min_gp:6, min_service_gp:0,/.test(live));
{
  const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, Infinity, parseInt, parseFloat };
  ctx.window = ctx; ctx.CG = {}; vm.createContext(ctx);
  vm.runInContext(live.slice(live.indexOf("CG.FORMAT_RULES = {"), live.indexOf("CG.GROUP_NAME = {")), ctx);
  const CG = ctx.CG;
  A("CG.fmt reads a season's own roster limit, else the format's fifteen", CG.fmt("roster_max", { format: "basic", roster_max: 12 }) === 12 && CG.fmt("roster_max", { format: "basic" }) === 15 && CG.fmt("roster_max", { format: "full" }) === 17);
  A("the floor: the season's figure, else six; none in the full format", CG.playoffMinGp({ format: "basic", playoff_min_gp: 14 }) === 14 && CG.playoffMinGp({ format: "basic" }) === 6 && CG.playoffMinGp({ format: "full" }) === 0);
  A("the draft rounds stay the season's own", CG.fmt("draft_rounds", { format: "basic", draft_rounds: 9 }) === 9);
}
A("the thirty percent is worked out nowhere on the site", !/PLAYOFF_FLOOR_PCT|playoffFloorOfLength|floor of 30%|30% of the season/.test(R("src/live/part_live.js") + R("src/live/part6_hub.js") + R("src/live/part5a_public.js") + R("src/live/part5b_public2.js")));
A("the Control Center sends the season's roster limit and refuses one outside 9 to the format's most",
  /var rosterMax=parseInt\(document\.getElementById\("ssRoster"\)\.value,10\);/.test(live) && /roster_max:rosterMax,/.test(live) && /if \(!\(rosterMax >= 9 && rosterMax <= fr\.roster_max\)\)/.test(live));
A("opening the form keeps the season's own figure; a new season or another format starts at the format's",
  /rEl\.max = r\.roster_max; rEl\.value = \(!isNew && f === \(s\.format === "full" \? "full" : "basic"\) && s\.roster_max\) \? s\.roster_max : r\.roster_max;/.test(live));

console.log("\n# the rulebook, as rendered");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook;
eval(R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0]);
const book = JSON.stringify(CG.rulebookForFormat(rb, "basic").chapters);
const sec = (id) => (rb.chapters.flatMap((c) => c.sections || []).find((s) => s.id === id) || { paragraphs: [] }).paragraphs.join(" ");
A("S2.3: nine rounds, the GM and the AGM before the draft", /^The draft is nine \(9\) rounds\. An Owner may nominate their General Manager and their Assistant General Manager before the draft, so that the club's three front-office seats and its nine \(9\) selections make up its twelve \(12\) players \(Rule S2\.4\)\.$/.test(sec("S2.3")), sec("S2.3"));
A("S2.4: twelve for the whole of Season 2, the minimums unchanged", /^A club's roster limit is twelve \(12\) players for the whole of Season 2, from the draft through the end of the playoffs\./.test(sec("S2.4")) &&
  /at least five \(5\) forwards, three \(3\) defensemen and one \(1\) goaltender/.test(sec("S2.4")));
A("S2.7: six games, prorated", /the playoff eligibility floor of Rule 8\.3, six \(6\) regular-season games, prorated for a player first placed after opening night/.test(sec("S2.7")));
A("8.3: six, why, and the rounding worked on six", /\(the playoff eligibility floor\) is six \(6\), the number of league games at a position after which a player's rating is no longer held toward the middle \(Rule 6\.1\)/.test(sec("8.3")) &&
  /forty-five \(45\) of the club's fifty-four \(54\) games left needs five \(5\)/.test(sec("8.3")) && /For Season 1 the commissioner set the floor at fourteen \(14\) games in place of that figure/.test(sec("8.3")));
A("...and 6 x 45 / 54 is 5", 6 * 45 / 54 === 5);
A("Rule 6.1 says what the six stands on", /A rating is held toward the middle until a player's sixth league game at that position/.test(sec("6.1")));
A("2.1 names Season 2's twelve", /For Season 2 the commissioner has set the roster at twelve \(12\) players for the whole season \(Rule S2\.4\)\./.test(sec("2.1")));
A("2.8, 0.1, 0.8 and 10.1 say six", /floor of six \(6\) regular-season games that Rule 8\.3 sets/.test(sec("2.8")) && /is not a setting: it is six \(6\) regular-season games/.test(sec("0.1")) &&
  /at least six \(6\) regular-season games, the playoff eligibility floor \(Rule 8\.3\)/.test(sec("0.8")) && /Rule 8\.3 fixes it at six \(6\) regular-season games/.test(sec("10.1")));
A("the rendered book has none of the old wording", book.indexOf("ten (10) rounds") < 0 && book.indexOf("fifteen (15) after it") < 0 && book.indexOf("may be selected only after the draft concludes") < 0 &&
  book.indexOf("thirty percent (30%) of a club's regular-season schedule") < 0 && book.indexOf("sixteen (16) games while Season 2") < 0 && book.indexOf("sets from the season's length") < 0);
A("the rendered book carries the new wording", book.indexOf("twelve (12) players for the whole of Season 2") > -1 && book.indexOf("The draft is nine (9) rounds") > -1);

console.log("\n# the changelog");
{
  const e = rb.changelog.find((c) => c.version === "4.52") || {};   /* by version: a later release takes changelog[0] */
  const j = JSON.stringify(e);
  A("the changelog has its 4.52 entry", typeof e.summary === "string" && Array.isArray(e.items) && e.items.length >= 4 && e.dateIso === "2026-11-17");
  A("...naming the rules it changed", /S2\.3/.test(j) && /S2\.4/.test(j) && /8\.3/.test(j) && /S2\.7/.test(j));
  A("...with no dashes and no gendered pronouns", !DASHES.test(j) && !/\b(he|his|him|she|her)\b/i.test(j));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
