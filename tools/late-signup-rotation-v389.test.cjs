/* v3.89: mid-season random assignments go round the league. Commissioner, 2026-10-07: "Make the mid-season random
   assignments random but run through each team once before a team can get a 2nd RA." Answers: "Catch up first" and
   "No, mid-season only" (the post-draft placement keeps its straight draw).
   The draw itself was rehearsed against production in a rolled-back transaction: 24 real late registrations, every one
   placed on a club at the lowest count among clubs with camp room (Boston, camp full, passed over every time), an office
   correction giving the turn back, a reinstatement taking it again, a waiver leaving it used, the post-draft placement
   writing no turn, and the deferred roster checks passing. This file pins that record, RUNS the Control Center's
   rotation panel, and pins the book. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-07-late-signup-rotation-v389.sql");
const fix = R("sql/2026-10-08-late-signup-rotation-fixes-v389.sql");
const live = R("src/live/part_live.js");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 260))); } };

console.log("— the record (sql/2026-10-07-late-signup-rotation-v389.sql)");
A("one row per placement, on the club at that moment (a trade moves the roster row, never this one)", /create table if not exists public\.random_assignments/.test(sql) && /team_id\s+uuid not null references public\.teams/.test(sql) && /counts\s+boolean not null default true/.test(sql));
A("born writable by the API roles, so revoked by role; authenticated may only read", /revoke all on public\.random_assignments from public, anon, authenticated;/.test(sql) && /grant select on public\.random_assignments to authenticated;/.test(sql) && /enable row level security/.test(sql));
A("the draw takes the FEWEST turns first, then an empty camp, then chance", /order by e\.turns asc, \(e\.camp_n = 0\) desc, random\(\)/.test(sql));
A("...turns are counted rows this season, for late sign-ups only (post-draft reads every club at 0)",
  /case when p_origin = 'latecomer_random'\s+then \(select count\(\*\) from public\.random_assignments ra\s+where ra\.season_id = v_reg\.season_id and ra\.team_id = t\.id and ra\.counts\)\s+else 0 end as turns/.test(sql));
A("...among clubs with camp room and cap room for the league minimum (a club passed over keeps its count)", /where public\.cap_has_room\(v_reg\.season_id, t\.id, 750000\)\) e/.test(sql) && /where e\.camp_n < public\.camp_max\(v_reg\.season_id\)/.test(sql));
A("each late sign-up placement writes its turn, and only a late sign-up's", /if v_origin = 'depth_random' and p_origin = 'latecomer_random' then\s+insert into public\.random_assignments \(season_id, team_id, profile_id\)/.test(sql));
A("the patch is anchored and asserted (exactly one match each)", /the depth draw anchor matched % times/.test(sql) && /the insert anchor matched % times/.test(sql));
A("an office correction gives the turn back: removed by the league office, a withdrawn sign-up, a reversal", /\(by the league office\|\^league office: revers\|\^reversing a placement\)/.test(sql) && /new\.origin = 'depth_random'/.test(sql));
A("...matched on season, player AND the club he was placed on (a traded player's later removal is not that club's)", /r2\.season_id = new\.season_id and r2\.profile_id = new\.profile_id\s+and r2\.team_id = new\.team_id and r2\.counts/.test(sql));
A("...and reinstating that removal takes the turn again", /elsif new\.reinstated_at is not null and old\.reinstated_at is null then\s+update public\.random_assignments set counts = true/.test(sql));
A("the trigger function cannot be called through the API", /revoke execute on function public\.random_assignment_undone\(\) from public, anon, authenticated;/.test(sql));
const rows = (sql.match(/\('(?:PIT|UTA|NYI|BOS|DET|DAL|VAN|SEA)','2026-/g) || []).length;
const counted = (sql.match(/\('(?:PIT|UTA|NYI|BOS|DET|DAL|VAN|SEA)','2026-[^']+','[^']*(?:''[^']*)*',true,/g) || []).length;
A("Season 1 catch-up: the 43 late sign-up placements from the transactions log, 30 counted", rows === 43 && counted === 30, { rows, counted });
A("...and the migration refuses to finish on any other total", /if v_rows <> 43 or v_counted <> 30 then/.test(sql));
A("...each of the 13 that do not count says why", (sql.match(/,false,'(?:[^']|'')+'\)/g) || []).length === 13);

console.log("— the review's fixes (sql/2026-10-08-late-signup-rotation-fixes-v389.sql), rehearsed and applied 2026-10-08");
A("the post-draft cron places all season too, so the season's FIRST post-draft round marks itself done",
  /insert into public\.app_config \(key, value\) values \('postdraft_done_' \|\| v_season\.id::text/.test(fix) && /on conflict \(key\) do nothing;/.test(fix));
A("...and every depth placement after it goes round the league, whichever job made it (turns and the log alike)",
  (fix.match(/or exists \(select 1 from public\.app_config ac where ac\.key = 'postdraft_done_' \|\| v_reg\.season_id::text\)/g) || []).length === 2);
A("...the first round itself keeps its straight draw (no marker yet while it runs)", /the first round itself keeps its straight draw/i.test(fix));
A("Season 1's first round was the batch at 02:23 UTC on Sep 20", /'2026-09-20T02:23:28Z' from public\.seasons s where s\.number = 1/.test(fix));
A("an office removal gives the turn back only within a day of the placement (a correction, not a removal weeks later)", /and r2\.placed_at > coalesce\(new\.removed_at, now\(\)\) - interval '24 hours'/.test(fix));
A("the seven Season 1 corrections are linked to their removals, so reinstating one restores the turn", /if n <> 7 then raise exception 'v3\.89 fix: expected to link 7 Season 1 corrections/.test(fix) && /r\.spot_created_at = ra\.placed_at and r\.reinstated_at is null/.test(fix));

console.log("— the Control Center panel (runs the real CG.raRotationHtml)");
const fnSrc = (name) => { const i = live.indexOf("CG." + name + " = function"); return live.slice(i, live.indexOf("\n};\n", i) + 3); };
const ctx = { CG: {}, esc: (s) => String(s == null ? "" : s).replace(/[<>&"']/g, (c) => "&#" + c.charCodeAt(0) + ";") };
vm.createContext(ctx);
vm.runInContext(fnSrc("raRotationHtml"), ctx);
const T = (code) => ({ id: "t-" + code, code });
ctx.CG.TEAMS = ["BOS", "DAL", "DET", "NYI", "PIT", "SEA", "UTA", "VAN"].map(T);
ctx.CG.CAMP_MAX = 10;
const camp = (k) => Array.from({ length: k }, () => ({ status: "active", squad: "tc" }));
const lg = { byTeam: { BOS: camp(10), DAL: camp(5), DET: camp(5), NYI: camp(6), PIT: camp(7), SEA: camp(6), UTA: camp(8), VAN: camp(3) } };
const turns = { BOS: 2, DAL: 6, DET: 5, NYI: 4, PIT: 4, SEA: 4, UTA: 3, VAN: 2 };
const data = [];
Object.keys(turns).forEach((c) => { for (let i = 0; i < turns[c]; i++) data.push({ team_id: "t-" + c, counts: true }); });
data.push({ team_id: "t-VAN", counts: false }, { team_id: "t-NYI", counts: false });   // undone by the office: not counted
const html = ctx.CG.raRotationHtml(data, lg);
A("the next late sign-up goes to Vancouver: lowest count with camp room", /The next late sign-up goes to VAN\./.test(html), html.slice(0, 400));
A("Boston (2, camp full) is passed over and keeps its place in line", /Passed over until its camp has room, keeping its place in line: BOS \(2\)/.test(html) && /BOS 2 · camp full/.test(html));
A("placements the office undid are not counted", /VAN 2</.test(html) && /NYI 4</.test(html));
A("every club is listed with its count, fewest first", html.indexOf(">BOS 2") < html.indexOf(">VAN 2") && html.indexOf(">VAN 2") < html.indexOf(">UTA 3") && html.indexOf(">UTA 3") < html.indexOf(">DAL 6"));
const tie = ctx.CG.raRotationHtml(data.concat([{ team_id: "t-VAN", counts: true }]), lg);
A("a tie at the bottom is drawn at random among them", /The next late sign-up goes to UTA or VAN, drawn at random\./.test(tie), tie.slice(0, 500));
const emptyLg = { byTeam: Object.assign({}, lg.byTeam, { UTA: camp(0) }) };
const emptyTie = ctx.CG.raRotationHtml(data.concat([{ team_id: "t-VAN", counts: true }]), emptyLg);
A("within a tie an empty camp goes first, as the database draws", /The next late sign-up goes to UTA \(an empty training camp goes first\)\./.test(emptyTie), emptyTie.slice(0, 500));
const allFull = ctx.CG.raRotationHtml(data, { byTeam: Object.fromEntries(ctx.CG.TEAMS.map((t) => [t.code, camp(10)])) });
A("no camp room anywhere says so instead of naming a club", /No club has room in its training camp/.test(allFull));
A("the panel loads after render, for the season on the page, and says so if it fails",
  /var rot=document\.getElementById\("raRotation"\); if \(rot\) CG\.loadRaRotation\(rot\);/.test(live)
  && /CG\.sb\.from\("random_assignments"\)\.select\("team_id,counts,in_rotation"\)\.eq\("season_id", sid\)/   /* v3.92 adds in_rotation */.test(live)
  && /The late sign-up rotation did not load/.test(live));
A("only in the basic format, and only for the season being played (camp counts are that season's)", /\(basicS && s\.id && s\.id === \(CG\.SEASON\|\|\{\}\)\.id \? '<div id="raRotation" data-season="/.test(live));
A("the office copy beside it describes the rotation, not the old emptiest-club rule", !/emptiest club with an open roster spot/.test(live) && /drawn at random from the clubs with the fewest late sign-ups this season that have camp room \(Rule 2\.8\)/.test(live) && !/late sign-ups are placed the same way until the movement deadline/.test(live));

console.log("— the book");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = (id) => rb.chapters.flatMap((c) => c.sections || []).find((x) => x.id === id);
const p8 = sec("2.8").paragraphs[7];
A("Rule 2.8: after the first post-draft round, every placement goes round the league, every club once before any twice", /once that first round of placement after the draft is done, every player the league office places goes round the league in turn/.test(p8) && /so that every club receives one before any club receives a second/.test(p8));
A("Rule 2.8: passed over for no room keeps its place; an office undo within a day does not use the turn; a waiver does", /keeps its place in line and is the first to receive one once it has room/.test(p8) && /A placement the league office undoes within a day does not use up the club's turn; a player the club later waives, or who leaves, or whom the league office removes after that, does/.test(p8));
A("Rule 2.8: the count begins again each season", /The count begins again each season\./.test(p8));
A("Chapter 0, step two: the clubs take turns", /assigns each late registrant to a club as depth, the clubs taking turns/.test(sec("0.3").paragraphs[1]));
const cl = rb.changelog.find((c) => c.version === "3.89");
A("changelog 3.89, with this season's starting counts", !!cl && /Rule 2\.8/.test(cl.summary) && cl.items.some((i) => /Boston and Vancouver 2, Utah 3/.test(i)));
A("no em dash in what v3.89 added", !/—/.test(JSON.stringify(cl)) && !/—/.test(p8.slice(p8.indexOf("with one difference"))) && !/—/.test(fnSrc("raRotationHtml")));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
