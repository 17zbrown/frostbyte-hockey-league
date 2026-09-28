/* v3.51: the suspension overhaul. The engine is in Postgres and was rehearsed there (the scenario
   battery is recorded in sql/2026-09-28-suspensions-v351-issue.sql); this pins the records, drives the
   client helpers, and checks the book and the Discord timeout. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const flat = (t) => t.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const eng = flat(R("sql/2026-09-28-suspensions-v351-engine.sql"));
const iss = R("sql/2026-09-28-suspensions-v351-issue.sql"), issF = flat(iss);
const lk = R("sql/2026-09-28-suspensions-v351-locks.sql");
const enf = flat(R("sql/2026-09-28-suspensions-v351-enforce.sql"));
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), pub = R("src/live/part5a_public.js");
const desks = R("src/live/part9_staffdesks.js"), sync = R("netlify/functions/discord-sync.js");

console.log("\n— the rulings are quoted");
A("the lock", /Lock a player in the team HQ by graying them out/.test(eng));
A("11:59 PM", /end automatically at 11:59PM ET on the last day/.test(eng));
A("commissioners only for staff", /only possible commissioners can suspend staff/.test(eng));
A("the ladder", /intervals of 3, up to 18/.test(eng));
A("second suspension", /remainder of the season unless otherwise specified/.test(eng));

console.log("\n— the engine");
A("served state and scope", /status gains 'served'/.test(eng) && /scope \(play \| staff \| both\)/.test(eng));
A("carry-over per game", /suspension_games records each game served/.test(eng) && /follows him and carries over/.test(eng));
A("the edge the battery found", /the engine never defaults a member to suspended/.test(eng) && /coalesce\(\(max\(g\.game_at\)/.test(R("sql/2026-09-28-suspensions-v351-engine.sql")));
A("staff scope switches off has_department and is_staff", /has_department\(\) and is_staff\(\) return false while a staff-scope suspension runs/.test(eng));

console.log("\n— issuing");
A("one definition", /create or replace function public\._issue_suspension\(/.test(iss) && /return public\._issue_suspension\(p_profile, p_mode, p_games, p_ends_at, null/.test(iss));
A("ladder in the gate", /p_games % 3 <> 0 or p_games > 18/.test(iss));
A("staff protected", /v_role in \('staff','commissioner'\)/.test(iss) && /Only a commissioner can discipline a member of league staff/.test(iss));
A("one at a time", /is already suspended\. Extend the suspension he is serving/.test(iss));
A("second in season becomes the rest of it", /v_mode := 'seasons'; v_until := v_snum; v_auto := true;/.test(iss));
A("dated ends 23:59:59 ET", /time '23:59:59'\) at time zone 'America\/New_York'/.test(iss));
A("community date only without a roster spot", /A date is for a member with no roster spot/.test(iss));
A("extend in steps of three to 18", /s\.games_total \+ p_games > 18/.test(iss));
A("typed row, not record", /declare s public\.suspensions; v_commish/.test(iss) && !/declare s record; v_commish/.test(iss));
A("pulled from filed lineups on issue", /create trigger trg_pull_suspended_from_lineups after insert on public\.suspensions/.test(iss));
A("the battery is recorded", /T7 his own club's non-commissioner manager could not move him/.test(issF) && /T12 a dated suspension ends at 23:59:59 ET/.test(issF));

console.log("\n— the locks");
A("lineup and line tables guarded", /create trigger guard_lineup_suspended_trg before insert or update on public\.game_lineups/.test(lk) && /guard_line_suspended_trg before insert or update on public\.team_lines/.test(lk));
A("only a filled slot is checked", /if tg_op = 'UPDATE' and v in \(old\.center/.test(lk));
A("locked where he is", /is suspended and is locked where he is/.test(lk));
A("forums read the one definition", /'  if public\.is_suspended\(me\) then'/.test(lk));

console.log("\n— playing while suspended, appeals, the public record");
A("forfeit + warnings + department", /forfeit_team_id = that club, score and every statistic standing/.test(enf) && /Owner, GM and AGM each get a written warning/.test(enf) && /flagged to decide an extension/.test(enf));
A("both clubs: no automatic forfeit", /Both clubs offending: no automatic forfeit/.test(enf));
A("one appeal per suspension, routed, issuer barred", /refuses a second appeal of the same suspension/.test(enf) && /the official who imposed it never decides it/.test(enf));
A("public record view", /SELECT is revoked from anon and authenticated; the site reads public\.suspension_record/.test(enf));

console.log("\n— the site");
A("reads the view", /CG\.sbAll\("suspension_record","\*","created_at",false\)/.test(live) && !/CG\.sbAll\("suspensions"/.test(live));
A("status is the database's running", /\(sx\.status==="active" && sx\.running!==false\) \? "active"/.test(live));
A("both shapes kept for the desks", /return Object\.assign\(\{\}, sx, \{ id:sx\.id, playerId:sx\.profile_id/.test(live));
A("public fallback is not 'Commissioner'", /\|\| "League office" \}\);/.test(live));
A("ladder 3 to 18", /CG\.SUSPENSION_LADDER = \[3, 6, 9, 12, 15, 18\];/.test(live));
A("extend dialog calls extend_suspension", /CG\.extendSuspensionPrompt = function/.test(live) && /rpc\("extend_suspension"/.test(live));
A("case dialog sends headings, scope, keep", /p_codes: codes\.length \? codes : null/.test(live) && /p_keep_length = !!kp\.checked/.test(live) && /p_scope = sc\.value/.test(live));
A("lineup builders lock only a running one", (hub.match(/if \(s\.status==="active"\) suspended\[s\.playerId\]=true;/g) || []).length === 2 && !/s\.team===club && s\.status!=="served"/.test(hub));
A("Team HQ lock helper", /CG\.suspensionOf = function\(pid\)/.test(hub) && /disabled title="'\+esc\(CG\.suspensionText\(sus\)\)/.test(hub));
A("Team HQ row grayed", /\(susp\?" susp-row":""\)/.test(hub));
A("Extend on the desks", /data-desk-extend=/.test(desks) && /data-comm-extend=/.test(desks));
A("community copy says 3 to 18", /3 to 18 games in steps of three/.test(desks) && !/runs <b>3, 6 or 9 games<\/b>/.test(desks));
A("public helpers: length and headings", /CG\.suspensionLen = function/.test(pub) && /CG\.suspensionHeadings = function/.test(pub));
A("no public surface prints the reason bare", !/esc\(x\.reason\)\+'<\/p>/.test(pub));

console.log("\n— the helpers, driven");
{
  const ctx = { console, Math, Object, String, Number, JSON, Date, CG: {} };
  ctx.esc = (v) => String(v == null ? "" : v);
  vm.createContext(ctx);
  ctx.CG.fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  ctx.CG.CONDUCT_REASONS = [{ code:"vulgar", label:"Vulgar language" }, { code:"other", label:"Other" }];
  for (const fn of ["suspensionLen", "suspensionHeadings", "suspensionStateWord"]) {
    const m = pub.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};"));
    if (!m) { A("located CG." + fn, false); continue; }
    vm.runInContext(m[0], ctx);
  }
  const g = { mode:"games", games:6, gamesServed:2, status:"active", codes:["vulgar","other"], venue:"discord" };
  A("games length shows served", ctx.CG.suspensionLen(g) === "6 games (2 served)", ctx.CG.suspensionLen(g));
  A("headings are the labels", ctx.CG.suspensionHeadings(g) === "Vulgar language, Other");
  A("an ice suspension with no headings", ctx.CG.suspensionHeadings({ venue:"ice" }) === "Conduct on the ice");
  A("rest of season", ctx.CG.suspensionLen({ mode:"seasons", untilSeason:1 }) === "rest of Season 1");
  A("state word", ctx.CG.suspensionStateWord({ status:"active" }) === "running" && ctx.CG.suspensionStateWord({ status:"served" }) === "served");
}

console.log("\n— the Discord timeout");
A("timeouts from running Discord-conduct date suspensions", /suspensions\?status=eq\.active&venue=eq\.discord&mode=eq\.date/.test(sync));
A("renewed under Discord's 28-day cap", /Date\.now\(\) \+ 28 \* 864e5/.test(sync));
A("clears only the timeouts it set", /discord_timeouts_applied/.test(sync) && /clear the timeout this sync set, and only that one/.test(sync));

console.log("\n— the book");
const rb = JSON.parse((function(){ const c = R("src/live/part3_content.js"); return c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1); })()).rulebook;
const sec = (id) => rb.chapters.flatMap((c) => c.sections).find((s) => s.id === id);
const s72 = sec("7.2").paragraphs.join("\n");
A("7.2 ladder", /in steps of three \(3\), from three \(3\) to eighteen \(18\) games/.test(s72));
A("7.2 lock", /locked where he stands on his club's roster/.test(s72));
A("7.2 carries over and ends 11:59 PM", /carries into the next season/.test(s72) && /ends at 11:59 PM Eastern Time on its last day/.test(s72));
A("7.2 one at a time + second in season", /A member is under one suspension at a time/.test(s72) && /suspended a second time in the same season is suspended for the remainder of that season/.test(s72));
A("7.2 appearing while suspended", /recorded as a forfeit loss for his club/.test(s72) && /each receive a written warning/.test(s72));
A("7.2 public record", /public record of a suspension shows its length, its headings/.test(s72));
A("7.6 once, routed, issuer barred", /Each sanction may be appealed once/.test(sec("7.6").paragraphs[0]) && /never decides its appeal/.test(sec("7.6").paragraphs[1]) && !/decided by a panel/.test(sec("7.6").paragraphs[1]));
A("7.7 new scale + timeout", /three \(3\) to eighteen \(18\) games in steps of three/.test(sec("7.7").paragraphs[1]) && /timeout in the league Discord/.test(sec("7.7").paragraphs[1]));
A("7.7 bans entered on the site", /entered on the site by a commissioner/.test(sec("7.7").paragraphs.join(" ")));
A("2.1.4 names the lock", /A suspended player is locked where he stands/.test(sec("2.1").paragraphs[3]));
A("v3.51 recorded", rb.changelog[0].version === "3.51");
A("no dash as punctuation in Chapter 7 or the changelog entry", !/—| - /.test(JSON.stringify(["7.1","7.2","7.5","7.6","7.7"].map((k) => sec(k).paragraphs)) + JSON.stringify(rb.changelog[0])));
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
