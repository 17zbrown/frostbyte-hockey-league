/* v3.81: a commissioner disciplines a member directly, without a case. Commissioner, 2026-10-02: "allow me to suspend
   players through the control centers without the need of a case to be filed." The database half was rehearsed in
   Postgres (recorded at the foot of the SQL file); this pins the record, the client and the book. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-10-02-discipline-without-a-case-v381.sql"), live = R("src/live/part_live.js"), desk = R("src/live/part9_staffdesks.js");

console.log("— the database door");
A("suspend_player carries the season, and passes it on", /p_until_season integer default null\)/.test(sql) && /_issue_suspension\(p_profile, p_mode, p_games, p_ends_at, p_until_season,/.test(sql));
A("dropped and recreated, exactly one left (no overload)", /drop function if exists public\.suspend_player\(uuid, text, timestamptz, integer, text, text\[\], text, boolean\);/.test(sql) && /expected exactly one/.test(sql));
A("signed-in members only; the rules stay in _issue_suspension", /from public, anon;/.test(sql) && /to authenticated;/.test(sql));
A("rehearsed and applied", /REHEARSAL OK: S1 seasons, S2 warning, S3 old shape, S4 member refused, S5 grants/.test(sql) && /APPLIED 2026-10-02/.test(sql));

console.log("— the client");
const su = live.slice(live.indexOf("CG.suspendUser = function"), live.indexOf("CG.disciplinePickPrompt = function"));
A("the form offers a warning and the rest of the season (not on the community desk's conduct form)", /CG\.disciplineLengthFields\(ctx, !conduct, true\)/.test(su));
A("the rest of the season is no longer refused without a case", !/A suspension through a season is issued from a case/.test(live));
A("the season goes to the database", /CG\.sb\.rpc\("suspend_player", Object\.assign\(\{ p_profile:profileId/.test(su) && /out\.p_until_season = /.test(live));
A("a member picker opens the same form", /CG\.disciplinePickPrompt = function\(\)\{/.test(live) && /CG\.suspendUser\(pick\.id, pick\.name\);/.test(live));
A("the officiating desk offers it to a commissioner", /\(commishNow \? '<button class="btn btn-ink btn-sm" data-desk-discipline/.test(desk) && /CG\.disciplinePickPrompt\(\);/.test(desk));

console.log("— the book");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, s72 = rb.chapters.flatMap((c) => c.sections || []).find((s) => s.id === "7.2");
A("Rule 7.2: a commissioner may impose any sanction directly, without a case", /A commissioner may impose any of these sanctions directly, from Users and roles in the Control Center or from the officiating desk, without a case being filed/.test(s72.paragraphs[0]));
A("changelog 3.81", !!rb.changelog.find((c) => c.version === "3.81"));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
