/* Read scoping for the playoff floor readers (sql/2026-11-24-playoff-floor-reads-scoped.sql): playoff_floors keeps
   the public floor and returns its credit column only to the player, league staff, commissioners and the CURRENT front
   office of the player's club (today's seats, for the current season only: teams carry over and have no season column),
   null to everyone else; regular_gp and can_move_player are no longer callable through the API, can_move_player's refusal
   names the minimum and never the count, and their database callers (all SECURITY DEFINER) are unaffected. Pins the
   record and its rehearsal, and RUNS the site's floor helpers on what a viewer outside that circle now receives. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 220))); } };
const REC = "sql/2026-11-24-playoff-floor-reads-scoped.sql";
const sql = R(REC), reh = R(REC.replace(/\.sql$/, ".rehearsal.sql"));
const live = R("src/live/part_live.js");
const fn = (sql.match(/create or replace function public\.playoff_floors\(p_season uuid\)[\s\S]*?\$function\$;/) || [""])[0];
const cmp = (sql.match(/create or replace function public\.can_move_player\(p_season uuid, p_profile uuid\)[\s\S]*?\$function\$;/) || [""])[0];
const applied = sql.slice(0, sql.indexOf("\n/* REHEARSAL") + 1);   // what the migration runs; results are appended after it
const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

// the record
A("playoff_floors keeps its return type (so CREATE OR REPLACE keeps its grants)", /returns table\(profile_id uuid, floor integer, credit integer\)/.test(fn));
A("playoff_floors stays SECURITY DEFINER, now with search_path ''", /security definer\n set search_path to ''/.test(fn));
A("the credit column is gated: the player, staff, commissioners", /case when rs\.profile_id = auth\.uid\(\) or public\.is_staff\(\) or public\.is_commissioner\(\)/.test(fn));
A("...and the CURRENT front office of the player's club, for the current season only (teams carry over)",
  /or \(p_season = public\.current_season_id\(\)\n\s+and exists \(select 1 from public\.roster_spots f\n\s+where f\.season_id = p_season and f\.profile_id = rs\.profile_id and public\.is_gm_of\(f\.team_id\)\)\)/.test(fn));
A("the circle is stated plainly: never 'that season's' front office", !/front office of the player's club that season/.test(sql + reh) &&
  /CURRENT front office of the player's club: today's Owner, GM and AGM \(public\.is_gm_of\) of the club the player\n--\s+is rostered on in the current season/.test(sql) && /the CURRENT front office of the player's club \(today's/.test(reh));
A("...and is null for everyone else (no else branch)", /\), 0\)\n         end\n/.test(fn) && !/\belse\b/.test(fn.replace(/\/\*[\s\S]*?\*\//g, "")));
A("the floor itself stays public and comes from the one floor definition", /select rs\.profile_id, public\.player_playoff_floor\(p_season, rs\.profile_id\),/.test(fn));
A("every name in the body is schema-qualified", !/(from|join) (?!public\.)[a-z_]+ [a-z]/.test(fn.replace(/\/\*[\s\S]*?\*\//g, "")));
A("playoff_floors keeps its client grants", /revoke all on function public\.playoff_floors\(uuid\) from public;\ngrant execute on function public\.playoff_floors\(uuid\) to anon, authenticated, service_role;/.test(sql));
A("regular_gp: no API grant", /revoke all on function public\.regular_gp\(uuid, uuid\) from public, anon, authenticated;/.test(sql) &&
  !/grant execute on function public\.regular_gp\(uuid, uuid\) to (anon|authenticated)/.test(sql));
A("self-checks: grants, no invoker caller of regular_gp or can_move_player, the season gate, no count in the text, no credit for nobody, full figure",
  /still callable through the API: %/.test(sql) && /an invoker function calls regular_gp/.test(sql) && /an invoker function calls can_move_player/.test(sql) &&
  /a policy or view calls regular_gp or can_move_player/.test(sql) && /the front office arm is not limited to the current season/.test(sql) &&
  /must not print the games-played count/.test(sql) && /returned % credits to a caller who is nobody/.test(sql) &&
  /no longer counts the full figure for its database callers/.test(sql));

// can_move_player: same signature and return type (so CREATE OR REPLACE keeps working), the minimum only, database callers only
A("can_move_player: returns text, STABLE, SECURITY DEFINER, now with search_path ''", /\n returns text\n language plpgsql\n stable\n security definer\n set search_path to ''/.test(cmp));
A("can_move_player: the refusal names the minimum, never the count", /'Rule 2\.4: ' \|\| v_name \|\| ' has not yet played the ' \|\| v_need \|\| ' regular-season games a player needs this season before they can be waived\.'/.test(cmp) &&
  !/has played|\|\| v_gp/.test(noComments(cmp)));
A("can_move_player: the comparison still uses the full figure", /v_gp := public\.regular_gp\(p_season, p_profile\);\n  if v_gp >= v_need then return null; end if;/.test(cmp));
A("can_move_player: the v3.40 ruling comment is kept, and the Privacy fix 2026-11-24 why is added", /v3\.40: this is now the WAIVE check only\. The commissioner's announcement of 2026-09-26 removed/.test(cmp) &&
  /v3\.68 \(Q63\) put the call back in guard_trade_insert/.test(cmp));
A("can_move_player: every name schema-qualified", !/(from|join) (?!public\.)[a-z_]+ [a-z]/.test(noComments(cmp)) && /public\.min_service_gp\(p_season\)/.test(cmp));
A("can_move_player: no API grant", /revoke all on function public\.can_move_player\(uuid, uuid\) from public, anon, authenticated;\ngrant execute on function public\.can_move_player\(uuid, uuid\) to service_role;/.test(sql) &&
  !/grant execute on function public\.can_move_player\(uuid, uuid\) to (anon|authenticated)/.test(sql));
A("the header no longer says can_move_player answers true or false", !/award_eligible and can_move_player[^.]*true or false/.test(sql) && /can_move_player \(Rule 2\.4, the minimum-service check\) returns a refusal TEXT/.test(sql));
A("nothing outside the database calls can_move_player, and no grant audit list expects it", !/rpc\(\s*["']can_move_player["']/.test(fs.readdirSync(path.join(__dirname, "..", "src/live")).filter((f) => /\.js$/.test(f)).map((f) => R("src/live/" + f)).join("")) &&
  !/'can_move_player'/.test(R("tools/sql/grant-audit.sql")));
A("the record carries its rehearsal block", /\/\* REHEARSAL/.test(sql));

// the rehearsal: one transaction, the viewers, definer callers unchanged, an uncaught closing raise
const cases = reh.slice(reh.indexOf("do $r$"));
A("rehearsal: the record's text verbatim, inside the transaction, before the cases", reh.indexOf(applied) > reh.indexOf("\nbegin;\n") &&
  reh.indexOf(applied) + applied.length <= reh.indexOf("do $r$") && reh.indexOf("do $before$") < reh.indexOf(applied));
A("rehearsal: anon, another club's member, a seat filled today, a staffer (and media-only), the player, a commissioner, the current front office",
  ["T1 anon", "T2 member of another club", "T3 a seat filled today on the player's club", "T4 staffer", "T5 the player", "T6 commissioner", "T7 current front office"].every((t) => cases.includes(t)));
A("rehearsal T0 (D-ROLLOVER): the rollover is modeled first, conditionally, as a commissioner, never by expiring contracts by hand",
  /if exists \(select 1 from public\.contracts c where c\.status in \('active', 'signed'\) and not coalesce\(c\.is_manager, false\)\n\s+and c\.start_season < 2\) then\n\s+perform set_config\('request\.jwt\.claims', json_build_object\('sub', v_comm, 'role', 'authenticated'\)::text, true\);\n\s+v_roll := public\.start_next_season\(v_s2\);/.test(cases) &&
  cases.indexOf("start_next_season") < cases.indexOf("update public.teams") && !/update public\.contracts/.test(cases));
A("rehearsal T3: the seats are the league's change (no actor), quiet (app.mgmt_quiet), refused on an already seated club",
  /perform set_config\('request\.jwt\.claims', '', true\);\n  perform set_config\('app\.mgmt_quiet', 'on', true\);\n  update public\.teams set owner_profile_id = v_mate2 where id = v_team;\n  update public\.teams set gm_profile_id = v_mate where id = v_team;/.test(cases) &&
  /T3 expects the player''s club unseated: rehearse before the Season 2 seating/.test(cases));
A("rehearsal T3: a seat filled today gets no past-season credit, and only its own row", /T3 a seat filled today reads the past season''s credit/.test(cases) && /f\.credit is not null and f\.profile_id <> v_mate;/.test(cases));
A("rehearsal T5: the player sees exactly one row with a credit, their own", /T5 the player sees % rows with a credit \(expected only their own\)/.test(cases));
A("rehearsal T7: the current GM reads a current-season credit; another club's member and anon do not", /insert into public\.gp_credits \(season_id, profile_id, games, reason\) values \(v_cur, v_mate2, 1,/.test(cases) &&
  /T7 the current GM does not see their current-season player''s credit/.test(cases) && /T7 a member of another club sees the current-season credit/.test(cases) && /T7 anon sees a current-season credit/.test(cases) &&
  cases.indexOf("T6 regular_gp changed") < cases.indexOf("insert into public.gp_credits"));
A("rehearsal: award eligibility, title boards and floors compared with the values read before the change",
  /'eligible', \(select jsonb_object_agg/.test(reh) && /T1 award_eligible changed/.test(reh) && /T1 statistical_title_board changed/.test(reh) && /T1 a floor changed/.test(reh));
A("rehearsal: regular_gp and can_move_player refused for anon and a member", (cases.match(/sqlerrm not like '%permission denied%'/g) || []).length === 4 &&
  (cases.match(/perform public\.can_move_player\(v_s, v_p\);/g) || []).length === 2);
A("rehearsal: expected refusals re-raise anything unexpected", !/exception when others then null/.test(reh));
A("rehearsal: ends in an uncaught REHEARSAL OK raise", /raise exception 'REHEARSAL OK: %', v_out;\nend \$r\$;\s*$/.test(reh));
A("rehearsal: no hard-coded member, club or season id", !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i.test(cases));
A("rehearsal: the player comes from the office table, never by name", /from public\.gp_credits c\n   where exists \(select 1 from public\.roster_spots r/.test(reh) && !/gamertag\s*=/.test(reh));
A("rehearsal: no dblink, no http, no commit", !/dblink|http_post|http_get|\bcommit\b/i.test(reh.replace(/--.*$/gm, "")));

// the site: the only reader of the credit column treats a null as no credit
A("the site reads playoff_floors in one place", (live.match(/sbAllRpc\("playoff_floors"/g) || []).length === 1);
A("...and keeps a credit only when one is present", /if \(x\.credit\) c\[x\.profile_id\] = x\.credit;/.test(live));
A("nothing outside the database calls regular_gp", !/rpc\(\s*["']regular_gp["']/.test(["src/live/part_live.js"].map(R).join("") +
  fs.readdirSync(path.join(__dirname, "..", "src/live")).filter((f) => /\.js$/.test(f)).map((f) => R("src/live/" + f)).join("")));
A("grant audit check 4 still expects playoff_floors to be callable", /'playoff_floors'/.test(R("tools/sql/grant-audit.sql")));

// RUN the loader's mapping and CG.floorGp on what a viewer outside the circle now receives (credit null)
const grab = (src, re) => { const m = src.match(re); return m ? m[0] : ""; };
const floorGp = grab(live, /CG\.floorGp = function\(lg, pid\)\{[\s\S]*?\n\};/);
const load = grab(live, /CG\.loadPlayoffFloors = function\(\)\{[\s\S]*?\n\};/);
A("found CG.floorGp and CG.loadPlayoffFloors", !!floorGp && !!load);
const ctx = { CG: {}, Promise };
vm.createContext(ctx);
vm.runInContext(floorGp + "\n" + load, ctx);
ctx.CG.SEASON = { id: "s1" };
ctx.CG.lg = { pstats: { a: { gp: 13 }, b: { gp: 9 } } };
const rows = (credit) => [{ profile_id: "a", floor: 16, credit }, { profile_id: "b", floor: 12, credit: null }];
ctx.CG.sb = {};
ctx.CG.sbAllRpc = () => Promise.resolve({ data: rows(null), error: null });
ctx.CG.loadPlayoffFloors().then((ok) => {
  A("outside the circle: floors load, no credit is kept", ok === true && ctx.CG.lg.playoffFloors.a === 16 && Object.keys(ctx.CG.lg.gpCredits).length === 0, ctx.CG.lg.gpCredits);
  A("outside the circle: games toward the floor are games played", ctx.CG.floorGp(ctx.CG.lg, "a") === 13 && ctx.CG.floorGp(ctx.CG.lg, "b") === 9);
  ctx.CG.sbAllRpc = () => Promise.resolve({ data: rows(1), error: null });
  return ctx.CG.loadPlayoffFloors();
}).then(() => {
  A("inside the circle: the credit still counts toward the floor, as before", ctx.CG.floorGp(ctx.CG.lg, "a") === 14 && ctx.CG.floorGp(ctx.CG.lg, "b") === 9);
  console.log(`\n${n - fail}/${n} passed`);
  if (fail) process.exit(1);
});
