/* v4.16 (2026-10-17): Season 1's movement deadline is extended for club moves while automatic placement stays closed
   and Season 2 stays open. Commissioner, 2026-10-17: "Keep the signups and applications open and lock the late signups
   for season 1, but extend the trade deadline to 11:59PM on Sunday."
   One deadline used to do three jobs (club moves, placement, the sign-up switch), so placement gets its own close
   (seasons.placement_closed_at, public.placement_closed) and the two placement jobs read it. The SQL ran as a rolled-back
   rehearsal on production (recorded in the file). v4.16b moves the sign-up trigger onto the same gate and lets a
   replacement signing that the extension overtook lapse. Run: node tools/trade-deadline-extended-v416.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sql = R("sql/2026-10-17-trade-deadline-extended-v416.sql");
const body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

console.log("\n1. Placement has its own close");
A("seasons.placement_closed_at is added", /alter table public\.seasons add column if not exists placement_closed_at timestamptz;/.test(body));
A("placement_closed() = moves locked OR the placement close has passed", /create or replace function public\.placement_closed\(p_season uuid\) returns boolean\s+language sql stable set search_path to '' as \$f\$\s+select coalesce\(public\.moves_locked\(p_season\), false\)\s+or coalesce\(\(select s\.placement_closed_at is not null and now\(\) >= s\.placement_closed_at/.test(body));
A("...and no API role can call it", /revoke all on function public\.placement_closed\(uuid\) from public, anon, authenticated;/.test(body));
A("late sign-up placement reads the placement gate (anchored once)", /pg_get_functiondef\('public\.auto_assign_latecomers\(boolean\)'::regprocedure\)/.test(body) && /if public\.placement_closed\(v_season\.id\) and not p_force then return 0; end if;\$q\$;\s+v_n := \(length\(v_def\) - length\(replace\(v_def, v_a, ''\)\)\) \/ length\(v_a\);\s+if v_n <> 1 then raise exception 'auto_assign_latecomers: anchor found % times'/.test(body));
A("post-draft depth placement reads it too (anchored once)", /if v_n <> 1 then raise exception 'distribute_unproven_rookies: anchor found % times'/.test(body));

console.log("\n2. Season 1: club moves until 11:59 PM ET Sunday, placement closed at the original deadline");
A("the deadline moves only from the original Saturday 12:00 AM ET", /if v_orig is distinct from timestamptz '2026-10-17 00:00:00 America\/New_York' then/.test(body));
A("placement closes at the original deadline", /update public\.seasons set placement_closed_at = v_orig where id = v_s1 and placement_closed_at is null;/.test(body));
A("the deadline becomes 11:59 PM ET Sunday, October 18", /v_new constant timestamptz := timestamptz '2026-10-18 23:59:00 America\/New_York'/.test(body) && /update public\.seasons set movement_deadline_fixed = v_new where id = v_s1;/.test(body));
A("it is logged", /log_admin_action\('movement_deadline_extended', 'season'/.test(body));
A("self-checks: moves open, placement closed, Season 1 sign-ups closed, Season 2 open", /self-check: club moves are still locked/.test(body) && /self-check: Season 1 placement reopened/.test(body) && /self-check: Season 1 sign-ups reopened/.test(body) && /self-check: Season 2 sign-ups closed/.test(body));
A("the rolled-back rehearsal is recorded", /latecomer placed 0, post-draft placed 0/.test(sql) && /moves_locked=f, S1 reg open=f, S2 reg open=t/.test(sql));
A("nothing posts to Discord", !/discord_http_post|notify_discord|club_notify|_announce_once/.test(body));

console.log("\n3. The site shows the deadline's real time");
const pub = R("src/live/part5a_public.js"), live = R("src/live/part_live.js"), ui = R("src/live/part4_ui.js");
A("the countdown caption reads CG.deadlineWhen, not a fixed midnight", pub.indexOf("Signings, trades and releases close '+CG.deadlineWhen(ts)+' (Rule 2.4).") > -1 && pub.indexOf("close at midnight ET'+") === -1);
/* the real house formatters (part4_ui.js, part_live.js), never hand copies */
const grab = (src, re, what) => { const m = src.match(re); if (!m) { A("located " + what, false); process.exit(1); } return m[0]; };
const HOUSE = [grab(ui, /CG\.fmtTime = function\(ts\)\{[^\n]*\};/, "CG.fmtTime"), grab(ui, /CG\.fmtDay *= function\(ts\)\{[^\n]*\};/, "CG.fmtDay"),
  grab(live, /CG\.etYMD = function\(iso\)\{[^\n]*\};/, "CG.etYMD"),
  pub.slice(pub.indexOf("CG.deadlineIsToday = function"), pub.indexOf("};", pub.indexOf("CG.deadlineWhen = function")) + 2)].join("\n");
const mk = (nowMs, extra) => { const C = Object.assign({ now: () => nowMs }, extra || {}); new Function("CG", HOUSE)(C); return C; };
const sun = Date.parse("2026-10-19T03:59:00Z"), mid = Date.parse("2026-10-17T04:00:00Z");
const when = (deadline, nowMs) => mk(nowMs).deadlineWhen(deadline);
A("Saturday noon reads 'at 11:59 PM ET on Sunday'", /^at 11:59\s?PM ET on Sunday$/.test(when(sun, sun - 36 * 3600000)), when(sun, sun - 36 * 3600000));
A("11:59:30 PM Saturday is NOT 'tonight' (inside 24 hours, but tomorrow night)", /^at 11:59\s?PM ET on Sunday$/.test(when(sun, sun - 86400000 + 30000)), when(sun, sun - 86400000 + 30000));
A("Sunday 1 AM reads 'at 11:59 PM ET tonight'", /^at 11:59\s?PM ET tonight$/.test(when(sun, sun - 23 * 3600000)), when(sun, sun - 23 * 3600000));
A("a midnight deadline on its Friday reads 'at midnight ET tonight'", when(mid, mid - 23 * 3600000) === "at midnight ET tonight", when(mid, mid - 23 * 3600000));
A("...and from Thursday names the day it ends", when(mid, mid - 36 * 3600000) === "at midnight ET at the end of Friday", when(mid, mid - 36 * 3600000));
A("more than six days out the date is named, not a bare weekday", /^at 11:59\s?PM ET on Sun, Oct 18$/.test(when(sun, sun - 10 * 86400000)), when(sun, sun - 10 * 86400000));
A("the home band's headline follows the same day test", pub.indexOf('(CG.deadlineIsToday(ts)?"Deadline day.":"The trade deadline is coming.")') > -1);
A("the Seasons page shows the fixed time", live.indexOf('["Trade deadline", s.movement_deadline_fixed?(CG.fmtDay(Date.parse(s.movement_deadline_fixed))+", "+CG.fmtTime(Date.parse(s.movement_deadline_fixed)))') > -1);
A("...and the placement close in the right tense ('With the trade deadline' when none is set)", live.indexOf('["Late sign-up placement", s.placement_closed_at?((CG.now()>=Date.parse(s.placement_closed_at)?"Closed ":"Closes ")+CG.fmtDay(Date.parse(s.placement_closed_at))+", "+CG.fmtTime(Date.parse(s.placement_closed_at))):"With the trade deadline"]') > -1);

{
  const tagSrc = grab(ui, /CG\.seasonTag = function\(season\)\{[^\n]*\};/, "CG.seasonTag(season)");
  const T = { SEASON: { number: 1 } }; new Function("CG", tagSrc)(T);
  A("the sign-up strip names the season taking sign-ups, not the one being played", pub.indexOf("esc(CG.seasonTag(sR))+' registration is open</span>'") > -1 && pub.indexOf("esc(CG.seasonTag())+' registration is open") === -1 && T.seasonTag({ number: 2 }) === "Season 2" && T.seasonTag() === "Season 1");
}

console.log("\n3b. The Trade Hub countdown (commissioner, 2026-10-17: \"Add a countdown in the trade hub\")");
A("one shared clock: CG.armDeadlineClock ticks every data-dl-ends element", /CG\.armDeadlineClock = function\(\)\{\n  if \(CG\._dlTimer \|\| !document\.querySelector\("\[data-dl-ends\]"\)\) return;/.test(pub));
A("...on its own attribute, never the draft room's data-ends pick clock", pub.indexOf('querySelectorAll("[data-ends]")') === -1 && /id="draftClock" data-status="'\+dstatus\+'" data-ends=/.test(live));
A("...and at zero repaints the home band and the Trade Hub note in place", /var band = document\.getElementById\("dlBand"\);\s+if \(band\) band\.outerHTML = CG\.deadlineBand\(\);\s+var hub = document\.getElementById\("thDeadline"\);\s+if \(hub && CG\.tradeHubDeadlineNote\) hub\.outerHTML = CG\.tradeHubDeadlineNote\(\);/.test(pub));
A("the home page arms the shared clock", /  CG\.armDeadlineClock\(\);\n/.test(pub.slice(pub.indexOf("CG.AFTER.home = function"))));
A("the Trade Hub renders the note and arms the clock", /h\+=CG\.tradeHubDeadlineNote\(\);/.test(live) && /CG\.AFTER\._tradehubLive = function\(qs\)\{\n  CG\.armDeadlineClock\(\);/.test(live));
{
  const nSrc = live.slice(live.indexOf("CG.tradeHubDeadlineNote = function"), live.indexOf("};", live.indexOf("CG.tradeHubDeadlineNote = function")) + 2);
  let nowMs = 0;
  const H = { SEASON: {}, ic: () => "", movesClosedForMe: () => false, movementDeadlineTs: () => sun };
  new Function("CG", HOUSE + "\n" + nSrc)(H);
  H.now = () => nowMs;
  nowMs = sun - 36 * 3600000;
  const open1 = H.tradeHubDeadlineNote();
  A("open: a ticking clock and the closing time", /id="thDeadline"/.test(open1) && open1.indexOf('data-dl-ends="' + sun + '"') > -1 && /role="timer"/.test(open1) && /Trade deadline\.<\/b> Proposals and acceptances close at 11:59\s?PM ET on Sunday \(Rule 2\.4\)/.test(open1), open1.slice(0, 260));
  nowMs = sun - 2 * 3600000;
  A("deadline day says so", /Deadline day\.<\/b> Proposals and acceptances close at 11:59\s?PM ET tonight/.test(H.tradeHubDeadlineNote()));
  nowMs = sun - 86400000 + 30000;
  A("...but not at 11:59:30 PM the night before", /Trade deadline\.<\/b>/.test(H.tradeHubDeadlineNote()));
  nowMs = sun + 1000; H.movesClosedForMe = () => true;
  A("after the deadline: the closed notice, same id so the clock can repaint it", /id="thDeadline"[\s\S]*Trades are closed\./.test(H.tradeHubDeadlineNote()) && !/data-dl-ends/.test(H.tradeHubDeadlineNote()));
  H.movesClosedForMe = () => false;
  A("a commissioner after the deadline sees nothing (exempt)", H.tradeHubDeadlineNote() === "");
  nowMs = sun - 3600000; H.SEASON = { moves_lock_override: "open" };
  A("an office override that reopens movement hides the clock", H.tradeHubDeadlineNote() === "");
  H.SEASON = {}; H.movementDeadlineTs = () => null;
  A("no deadline known: nothing, never a made-up time", H.tradeHubDeadlineNote() === "");
}

console.log("\n3c. v4.16b: the third placement path, and replacement signings the extension overtook");
const sqlB = R("sql/2026-10-17-placement-trigger-and-replacements-v416b.sql");
const bodyB = sqlB.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
A("the sign-up trigger reads the placement gate (anchored once)", bodyB.indexOf("v_a := $q$     and not public.moves_locked(v_season.id)   -- v3.93: placement closes at the movement deadline (Rule 2.4)$q$;") > -1 && bodyB.indexOf("v_b := $q$     and not public.placement_closed(v_season.id)") > -1 && /if v_n <> 1 then raise exception 'trg_autoassign_new_reg: anchor found % times'/.test(bodyB));
A("...and the self-check fails if it still reads moves_locked", /position\('public\.moves_locked' in pg_get_functiondef\('public\.trg_autoassign_new_reg\(\)'::regprocedure\)\) > 0/.test(bodyB));
A("all three placement paths are on the gate (the two jobs in v4.16, the trigger in v4.16b)", (body.match(/if public\.placement_closed\(v_season\.id\) and not p_force then return 0; end if;/g) || []).length === 2 && /and not public\.placement_closed\(v_season\.id\)/.test(bodyB));
A("sign_free_agent spends only an allowance granted at or after the deadline in force, unless the office locked moves (anchored once)", /and \(v_season\.moves_lock_override = 'locked'\s+or x\.created_at >= public\.movement_deadline_at\(v_season\.id\)\)/.test(bodyB) && /if v_n <> 1 then raise exception 'sign_free_agent: anchor found % times'/.test(bodyB));
A("the rolled-back rehearsal is recorded (lapsed, counts, office lock)", /A, deadline moved to a minute ago[^\n]*"Roster moves are locked" \(allowance lapsed\)/.test(sqlB) && /B, deadline before the 8:34 AM grant: allowance spent/.test(sqlB) && /C, office lock \(override 'locked'\) before the deadline: allowance counts/.test(sqlB));
A("no allowance row is changed or deleted, and nothing posts to Discord", !/(update|delete from|insert into) public\.replacement_signings/.test(bodyB) && !/discord_http_post|notify_discord|club_notify|_announce_once/.test(bodyB));
A("Team HQ counts allowances by the same test", live.indexOf('var replFrom = (CG.SEASON || {}).moves_lock_override !== "locked" && replDl ? replDl : 0;') > -1 && live.indexOf('.is("used_at", null).gte("created_at", new Date(replFrom).toISOString()), "replacement_signings")') > -1);

console.log("\n4. Rule 2.4 and the changelog");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === "2.4");
const p3 = sec.paragraphs[3] || "";
/* v4.17 (commissioner, 2026-10-17: "No new signings after the original deadline."): the extension covers trades and the
   trade block only; tools/fa-moves-close-v417.test.cjs pins the rest of the new paragraph */
A("Rule 2.4 records the Season 1 extension to 11:59 PM ET Sunday, 18 October 2026", /extended the movement deadline for Season 1 to 11:59 PM Eastern Time on Sunday, 18 October 2026, for trades and the trade block only\./.test(p3));
A("...that placement was not extended and closed at the original deadline", /Automatic placement was not extended: it closed at the original deadline, midnight Eastern Time at the end of Friday, 16 October 2026, and the league office places no newly registered player for Season 1 after that moment\./.test(p3));
A("...and that Season 2 registration and owner applications remain open", /Registration and owner applications for Season 2 opened at the original deadline and remain open \(Rule 1\.1\)\./.test(p3));
A("...with no em dash or gendered pronoun", !/[—–]/.test(p3) && !/\b(he|his|him|she|her)\b/i.test(p3));
const e = rb.changelog.find((c) => c.version === "4.16") || {};   /* by version: a later release takes changelog[0] */
A("the changelog has its 4.16 entry, right after 4.15", e.version === "4.16" && (rb.changelog[rb.changelog.indexOf(e) + 1] || {}).version === "4.15");
A("...naming the new deadline and the placement lock", /11:59 PM ET on Sunday, October 18/.test(e.summary || "") && (e.items || []).some((i) => /placement/.test(i)));
A("...and the Trade Hub countdown", (e.items || []).some((i) => /Trade Hub shows a live countdown/.test(i)));
A("Rule 2.4 no longer says an allowance lapses at the extended deadline (v4.17: replacements count from the original one)", !/lapses at the extended deadline/.test(p3) && /may sign one free agent to replace that player under this Rule, before or after the extended deadline\./.test(p3));
A("...and the changelog says so in plain words", (e.items || []).some((i) => /replacement signing a club received after the original deadline ends at the new deadline/.test(i)));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
