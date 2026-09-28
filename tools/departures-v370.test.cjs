/* v3.70: Q11 a replacement signing after the deadline; Q13 departure takes the staff role; Q3 dress + the week
   column. The database half was rehearsed in Postgres (recorded at the foot of the SQL file). */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-departures-v370.sql"), hub = R("src/live/part6_hub.js");
A("Q11: allowances are granted only past the deadline, one per removal", /if p_team is null or not public\.moves_locked\(p_season\) then return; end if;/.test(sql) && /insert into public\.replacement_signings\(season_id, team_id, departed_profile_id, reason\)/.test(sql));
A("...by the departure sweep and by an office withdrawal", /perform public\._grant_replacement\(r\.season_id, r\.team_id, r\.profile_id, ''he left the league Discord''\)/.test(sql) && /_grant_replacement\(v_reg\.season_id, \(select id from public\.teams where code = v_club\), v_reg\.profile_id, ''withdrawn by the league office''\)/.test(sql));
A("...and spent by one signing, otherwise the lock stands", /update public\.replacement_signings rsg set used_at = now\(\), used_registration_id = p_registration/.test(sql) && /if not found then\s+raise exception ''Roster moves are locked/.test(sql));
A("...clubs read their allowances; nobody writes them directly", /revoke insert, update, delete on public\.replacement_signings from anon, authenticated;/.test(sql));
A("Q13: a left_discord removal takes the staff role, never a commissioner's", /if new\.reason <> 'left_discord' then return new; end if;/.test(sql) && /update public\.profiles set role = 'member', departments = '\{\}' where id = new\.profile_id;/.test(sql) && /A commissioner''s role is never removed automatically/.test(sql));
A("the rehearsal is recorded", /a second\s+signing was refused/.test(sql));
A("Q3: Team HQ shows the week, played plus filed against the limit", /This week<\/th>/.test(hub) && /var wkLoad = \(wkRefR && CG\.weekLoad\) \? CG\.weekLoad\(p, club, wkRefR\) : null;/.test(hub) && !/colspan="9"/.test(hub.slice(hub.indexOf("CG.hubRoster = function"), hub.indexOf("CG.hubRoster = function") + 20000)));
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.70");
A("changelog records 3.70", !!e);
A("1.1.5: the staff role goes; one replacement after the deadline", /also loses his league staff role and departments/.test(secs["1.1"].paragraphs[4]) && /his club may sign one free agent to replace him, as an exception to Rule 2\.4/.test(secs["1.1"].paragraphs[4]));
A("2.4.1: the exception is written into the deadline", /may sign one free agent to replace him \(Rule 1\.1\)\./.test(secs["2.4"].paragraphs[0]));
A("10.1.1: dress means in the lineup, confirmed by the box score", /“dress” means to be named in a club's lineup for a game, confirmed by appearing in that game's box score/.test(secs["10.1"].paragraphs[0]));
A("no em dashes or spaced hyphens in the 3.70 entry", !/—| - /.test(JSON.stringify(e)));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
