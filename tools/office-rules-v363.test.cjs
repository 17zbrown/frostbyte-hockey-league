/* v3.63: Q48 access settings reset with ownership; Q53 no salary retention in a basic trade; Q64 the full
   format's playoff figures are fixed; book-only Q51, Q54, Q55, Q56, Q57. The database half was rehearsed in
   Postgres (recorded at the foot of the SQL file); this pins the record, the site and the book. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-office-rules-v363.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const live = R("src/live/part_live.js");

console.log("\n— the rulings are quoted");
A("Q48", /when ownership changes hands, access settings reset \(every manager same access\)/.test(sqlF));
A("Q53", /retention unused in basic/.test(sqlF));
A("Q64", /full-format playoff figures fixed/.test(sqlF));

console.log("\n— the database");
A("Q48: the reset fires only on a real change of Owner", /after update of owner_profile_id on public\.teams\s+for each row when \(old\.owner_profile_id is distinct from new\.owner_profile_id\)/.test(sql));
A("...the club's policy returns to the default", /delete from public\.team_mgmt_policy where team_id = new\.id/.test(sql));
A("...a queued move is withdrawn with a reason", /set status = 'withdrawn'[\s\S]{0,200}The club''s Owner changed, so its access settings reset/.test(sql));
A("...and the front office is told, not the whole club", /'Access settings reset'[\s\S]{0,700}null, 'manager', null, null, false\);/.test(sql));
A("Q53: retention refused in a basic season", /new\.retention not in \(''\{\}''::jsonb, ''\[\]''::jsonb, ''null''::jsonb\)/.test(sql) && /no salary is retained in a trade/.test(sql));
A("Q64: qualifiers and series length read the format in every format", /select \(public\.season_rules\(p_season\)->>'playoff_per_div'\)::int/.test(sql) && /select \(public\.season_rules\(p_season\)->>'playoff_best_of'\)::int/.test(sql) && !/site_config/.test(sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "")));
A("...a season's floor applies to the basic format only", /'playoff_min_gp', case when public\.season_format\(p_season\) = 'basic' then s\.playoff_min_gp end/.test(sql));
A("the rehearsal is recorded", /Result: REHEARSAL OK: Q48 reset on owner change/.test(sql));

console.log("\n— the site");
A("the permissions card says a new Owner resets it", /When the Owner seat changes hands, these settings return to the defaults and any move still waiting for approval is withdrawn \(Rule 2\.6\)/.test(live));
A("the client's floor overlay is basic-only", /if \(key === "playoff_min_gp" && CG\.seasonFormat\(s\) === "basic"\)/.test(live));
A("qualifiers and series length come from the format", /return CG\.fmt\("playoff_per_div"\) \|\| CG\.PLAYOFF_PER_DIV_DEFAULT;/.test(live) && /CG\.playoffBestOf = function\(\)\{ return CG\.fmt\("playoff_best_of"\) \|\| 7; \};/.test(live));
A("the Control Center controls are a read-only record in every format", /var poLive = pog\.length>0, fmtLocked = true;/.test(live));

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.63");
const all = JSON.stringify(rb.chapters);
A("changelog records 3.63", !!e);
A("1.3.1 (Q55): the site's rulebook is authoritative; the commissioner decides announcements", /holds its only authoritative text/.test(secs["1.3"].paragraphs[0]) && /The commissioner decides which amendments are announced to the membership/.test(secs["1.3"].paragraphs[0]));
A("2.3.1 (Q53): no retention", /No salary is retained in a trade/.test(secs["2.3"].paragraphs[0]));
A("2.5.5 (Q51): salaries public, in both formats", ["paragraphs", "full"].every((k) => /Every player's salary and cap hit is public/.test(secs["2.5"][k][4])));
A("2.6.2 (Q48): the reset, in both formats", ["paragraphs", "full"].every((k) => /When the Owner's seat changes hands, or falls vacant, the settings return to this default for every seat/.test(secs["2.6"][k][1])));
A("2.7.3 (Q54): the office holder's conduct duty", /shall not use it for his club's advantage; doing so is a conduct violation under Chapter 7/.test(secs["2.7"].paragraphs[2]));
A("4.6.1 (Q57): rare, outside the league, recorded by staff", /one outside the league/.test(secs["4.6"].paragraphs[0]) && /statistics staff or a commissioner record the substitution/.test(secs["4.6"].paragraphs[0]));
A("Q56: no 'settings sheet' left anywhere; the Lobby settings box instead", !/settings sheet/.test(all) && /Lobby settings box of each game's match card/.test(secs["4.1"].paragraphs[0]));
A("no em dashes or spaced hyphens in the 3.63 entry", !/—| - /.test(JSON.stringify(e)));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
