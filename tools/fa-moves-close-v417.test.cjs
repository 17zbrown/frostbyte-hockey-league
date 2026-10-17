/* v4.17 (2026-10-17): Season 1's signings and releases close at the ORIGINAL movement deadline; only trades and the trade
   block keep the extended one (v4.16). Commissioner, 2026-10-17: "No new signings after the original deadline. Keep the
   trade offers cancelled as a clean up tactic." Replacement signings: "Rule 2.4 applies". Releases: "Teams still have
   their TC rosters so the players can be placed on their camp if there is no room on the active rosters. Dont allow a
   team to complete a trade if the trade will result in the team going over their roster and camp limits." Then:
   "reverse all trades from the original friday trade deadline, and any trades from that day as well."
   The free-agent close is seasons.fa_moves_closed_at, read through public.fa_moves_closed / fa_moves_close_at and the
   site's CG.faMovesClosedNow / CG.faMovesCloseTs. Run: node tools/fa-moves-close-v417.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const strip = (s) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const sql = R("sql/2026-10-17-signings-and-releases-close-v417.sql"), body = strip(sql);
const vb = body.slice(body.indexOf("v_b text[] := array["), body.indexOf("v_def text; v_n int; i int;"));

console.log("\n1. The free-agent close in the database");
A("seasons.fa_moves_closed_at is added", /alter table public\.seasons add column if not exists fa_moves_closed_at timestamptz;/.test(body));
A("fa_moves_closed() = moves locked OR the free-agent close has passed", /create or replace function public\.fa_moves_closed\(p_season uuid\) returns boolean\s+language sql stable set search_path to '' as \$f\$\s+select coalesce\(public\.moves_locked\(p_season\), false\)\s+or coalesce\(\(select s\.fa_moves_closed_at is not null and now\(\) >= s\.fa_moves_closed_at/.test(body));
A("fa_moves_close_at() = the earlier of that close and the movement deadline", /select least\(s\.fa_moves_closed_at, public\.movement_deadline_at\(s\.id\)\) from public\.seasons s where s\.id = p_season/.test(body));
A("...and no API role can call either", /revoke all on function public\.fa_moves_closed\(uuid\) from public, anon, authenticated;/.test(body) && /revoke all on function public\.fa_moves_close_at\(uuid\) from public, anon, authenticated;/.test(body));
A("every patch is anchored and asserted to match exactly once", /if v_n <> 1 then raise exception 'patch % \(%\): anchor found % times'/.test(body));
for (const fn of ["sign_free_agent(uuid,bigint,uuid)", "offer_free_agent(uuid,bigint,integer,text,uuid)", "respond_offer(uuid,text,bigint,integer)", "reinstate_roster_spot(uuid)",
  "office_withdraw_registration(uuid,text)", "mgmt_request_move(text,text,jsonb,text)", "_deadline_sweep()", "_grant_replacement(uuid,uuid,uuid,text)", "guard_roster_waive()"]) {
  A("patched: " + fn, body.indexOf("'public." + fn + "'") > -1);
}
A("signing: sign_free_agent reads the free-agent close, and a replacement allowance counts from it", /if public\.fa_moves_closed\(v_season\.id\) and not public\.is_commissioner\(\) then\n    update public\.replacement_signings/.test(vb) && /or x\.created_at >= public\.fa_moves_close_at\(v_season\.id\)\)/.test(vb));
A("signing: offers, acceptances and reinstatements close with it", /a free-agent offer closes with signings[\s\S]*if public\.fa_moves_closed\(v_season\.id\) and not public\.is_commissioner\(\) then/.test(vb) && /if public\.fa_moves_closed\(v_season\.id\) and not v_comm then/.test(vb) && /if public\.fa_moves_closed\(r\.season_id\) and not public\.is_commissioner\(\) then/.test(vb));
A("release: club waivers (guard_roster_waive) and office-staff withdrawals close with it; the commissioner stays exempt", /if public\.fa_moves_closed\(old\.season_id\) and not public\.is_commissioner\(\) then\n    raise exception 'Rule 2\.4: releases have closed for this season/.test(vb) && /if v_spot and public\.fa_moves_closed\(v_reg\.season_id\) and not public\.is_commissioner\(\) then/.test(vb));
A("replacement: a removal after the free-agent close grants an allowance (Rule 2.4 applies)", /if p_team is null or not public\.fa_moves_closed\(p_season\) then return; end if;/.test(vb) && /you may sign one free agent to replace them \(Rule 2\.4\)/.test(vb));
A("queue: waivers and offers are refused at the free-agent close; trades and block listings keep the movement deadline", /p_action in \('trade_propose', 'accept_trade'\)/.test(vb) && /if public\.fa_moves_closed\(public\.current_season_id\(\)\) and p_action in \('waive_player', 'offer_free_agent'\) then/.test(vb));
A("sweep: a second block withdraws queued waivers and offers; the trade cancellation is untouched (its anchor is only the loop end)", body.indexOf("$q$  end loop;\n  insert into public.app_config(key, value) values ('rl_deadline_sweep', now()::text)$q$") > -1 && /where status = 'pending' and action in \('waive_player', 'offer_free_agent'\);/.test(vb) && !/update public\.trades/.test(vb));
A("trades keep the movement deadline: accept_trade, guard_trade_insert and the trade-block guard are not patched", !/accept_trade\(uuid\)|guard_trade_insert|guard_roster_after_deadline/.test(body.slice(body.indexOf("v_fn regprocedure[]"), body.indexOf("v_a text[]"))));
A("the emergency-goaltender exemption keys on the same close", /rs\.created_at > coalesce\(public\.fa_moves_close_at\(v_game\.season_id\), 'infinity'::timestamptz\)/.test(vb));
A("new refusals are season-agnostic: no 'original', no date, no em dash", !/original|October|Oct 1|—/.test(vb.replace(/\/\*[\s\S]*?\*\//g, "").replace(/'Free-agent signings have closed, but because[^\n]*/, "")));
A("Season 1: the close is the original deadline, the same instant as the placement close", /v_orig constant timestamptz := timestamptz '2026-10-17 00:00:00 America\/New_York'/.test(body) && /if v_pc is distinct from v_orig then raise exception/.test(body) && /update public\.seasons set fa_moves_closed_at = v_orig where id = v_s1 and fa_moves_closed_at is null;/.test(body));
A("self-checks: S1 closed, trades open, deadline unmoved, placement closed, S2 open, no door left on moves_locked, gates private", ["Season 1 signings and releases are open", "trades closed early", "the trade deadline moved", "Season 1 placement reopened", "Season 2 sign-ups closed", "still on moves_locked or missing the free-agent gate", "a free-agent gate is callable by an API role"].every((m) => body.indexOf("self-check: " + m) > -1));
A("the rolled-back rehearsal is recorded", /Boston \(no allowance\): sign_free_agent and offer_free_agent "free-agent signings have closed"/.test(sql) && /Dallas \(Simon Makienok's allowance\): sign_free_agent spends it/.test(sql) && /proposed trades 4 -> 4 and trade-block listings 9 -> 9/.test(sql));
A("nothing posts to Discord", !/discord_http_post|notify_discord|_announce_once|club_notify\(/.test(body));
{
  const b = R("sql/2026-10-17-office-removal-notice-v417b.sql"), bb = strip(b);
  A("v4.17b: the office's Remove from roster notice says signings have closed when they have", /\|\|case when public\.fa_moves_closed\(v_season\.id\)\s+then ', but signings have closed for the season, so no club may sign you this season except as a replacement signing \(Rule 2\.4\)\.'/.test(bb) && /'; they are a free agent \(Rule 2\.2\)'/.test(bb) && /notice: "The league office removed you from Bruins\. You are a free agent, but signings have closed/.test(b));
  const f = R("sql/2026-10-17-friday-trades-reversed.sql"), fb = strip(f);
  A("the Friday trade reversal is recorded: three trades, the commissioner's own profile, one transaction, a self-check", /v_ids constant uuid\[\] := array\['b8fef62d-5e57-4604-98bb-7f5b96766bd4','dbc8a605-3e57-44c1-a875-1ffb35ac1774','3264cb51-fca2-4fe3-aead-eae93a353508'\]/.test(fb) && /perform public\.reverse_trade\(v_ids\[i\], v_reason\);/.test(fb) && /self-check: not all three trades reversed/.test(fb) && /zackbrown17/.test(f));
}

console.log("\n2. The site mirrors it");
const pub = R("src/live/part5a_public.js"), live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), ui = R("src/live/part4_ui.js");
const grab = (src, re, what) => { const m = src.match(re); if (!m) { A("located " + what, false); process.exit(1); } return m[0]; };
const fnOf = (src, name) => grab(src, new RegExp("CG\\." + name + " = function[\\s\\S]*?\\n\\};"), "CG." + name);
const HOUSE = [grab(ui, /CG\.fmtTime = function\(ts\)\{[^\n]*\};/, "fmtTime"), grab(ui, /CG\.fmtDay *= function\(ts\)\{[^\n]*\};/, "fmtDay"), grab(ui, /CG\.fmtFull = function\(ts\)\{[^\n]*\};/, "fmtFull"),
  grab(live, /CG\.etYMD = function\(iso\)\{[^\n]*\};/, "etYMD"), fnOf(pub, "movementDeadlineTs"), fnOf(pub, "faMovesCloseTs"), fnOf(pub, "deadlineIsToday"), fnOf(pub, "deadlineWhen"),
  fnOf(live, "movesLockedNow"), fnOf(live, "faMovesClosedNow"), grab(live, /CG\.faMovesClosedForMe = function\(\)\{[^\n]*\};/, "faMovesClosedForMe"), grab(live, /CG\.FA_MOVES_CLOSED = "[^"]*";/, "FA_MOVES_CLOSED")].join("\n");
const orig = Date.parse("2026-10-17T04:00:00Z"), sun = Date.parse("2026-10-19T03:59:00Z");
const S1 = { movement_deadline_fixed: "2026-10-19T03:59:00Z", fa_moves_closed_at: "2026-10-17T04:00:00Z", moves_lock_override: "auto" };
const mk = (nowMs, season, role) => { const C = { now: () => nowMs, SEASON: season, role: () => role || "gm" }; new Function("CG", HOUSE)(C); return C; };
{
  const sat = mk(orig + 3600000, S1);
  A("CG.faMovesCloseTs is the earlier close (the original deadline), not Sunday", sat.faMovesCloseTs() === orig, sat.faMovesCloseTs());
  A("Saturday: signings and releases closed, trades open", sat.faMovesClosedNow() === true && sat.movesLockedNow() === false && sat.faMovesClosedForMe() === true);
  A("...and the commissioner is exempt, as in the database", mk(orig + 3600000, S1, "commish").faMovesClosedForMe() === false);
  A("Friday before the close: open", mk(orig - 60000, S1).faMovesClosedNow() === false);
  const plain = { movement_deadline_fixed: "2026-10-19T03:59:00Z", moves_lock_override: "auto" };
  A("a season with no free-agent close: the close is the movement deadline, and it opens and closes with it", mk(orig, plain).faMovesCloseTs() === sun && mk(sun - 1000, plain).faMovesClosedNow() === false && mk(sun + 1000, plain).faMovesClosedNow() === true);
  A("an office lock closes it too", mk(orig - 86400000, Object.assign({}, plain, { moves_lock_override: "locked" })).faMovesClosedNow() === true);
}
A("Team HQ's free-agent board reads the free-agent close (dlClosed) and names it", /var dlClosed = \(CG\.faMovesClosedForMe && CG\.faMovesClosedForMe\(\)\), dlRepl = lg\._replacements \|\| 0;\n  if \(dlClosed && !dlRepl\) canSign = false;/.test(live) && />Signings closed: '\+dlRepl\+' replacement signing'/.test(live) && live.indexOf("Deadline passed: '+dlRepl") === -1);
A("the replacement count keys on the same close as sign_free_agent", live.indexOf("var replDl = CG.faMovesCloseTs ? CG.faMovesCloseTs() : null;") > -1);
A("the Sign dialog says when a signing spends the replacement", live.indexOf(`" Signings have closed, so this uses your club's replacement signing (Rule 2.4)."`) > -1);
A("the Roster tab's Waive button closes with releases; To block and Trade keep the movement deadline", /if \(CG\.faMovesClosedForMe && CG\.faMovesClosedForMe\(\)\) return '<button class="btn btn-ghost btn-sm" disabled title="'\+esc\(CG\.FA_MOVES_CLOSED\)\+'">Waive<\/button>';/.test(hub) && /\(\(CG\.movesClosedForMe && CG\.movesClosedForMe\(\)\) && !onBlk\)/.test(hub));
A("the over-limit advice has a third state: waivers closed while trades are open", /var waiveShutOv = !lockedOv && !!\(CG\.faMovesClosedNow && CG\.faMovesClosedNow\(\)\);/.test(hub) && /trades stay open until the movement deadline, but waivers have closed for the season \(Rule 2\.4\)/.test(hub));
A("the waive dialog, its toast and the roster footer stop promising a signing once signings close", /"they become a free agent, but signings have closed for the season, so no club may sign them this season except as a replacement signing \(Rule 2\.4\)\."/.test(hub) && /" waived\. Signings have closed, so they stay a free agent this season\."/.test(hub) && /'until signings close \('\+esc\(CG\.fmtFull\(CG\.faMovesCloseTs\(\)\)\)\+'\)'/.test(hub) && /Waivers close with signings \(Rule 2\.4\)\./.test(hub));
A("the office's Remove from roster dialog says the same, and that a roster removal earns no replacement", /no club may sign them this season except as a replacement signing \(Rule 2\.4\)\. The club receives no replacement signing for a roster removal; withdrawing the player's sign-up instead would give it one \(Rule 1\.1\)\./.test(live));
A("the Seasons page shows when signings and releases closed", live.indexOf('["Signings and releases", s.fa_moves_closed_at?((CG.now()>=Date.parse(s.fa_moves_closed_at)?"Closed ":"Close ")') > -1);
{
  /* the home band, run for real */
  const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext("var CG = {}; var esc = function(s){ return String(s); };", ctx);
  new Function("CG", HOUSE)(ctx.CG);
  for (const f of ["deadlineBand", "teamMoves", "txText"]) vm.runInContext(fnOf(pub, f), ctx);
  const tm = pub.match(/CG\.TX_MOVE_TYPES = \[.*?\];/); if (tm) vm.runInContext(tm[0], ctx);
  ctx.CG.lg = { liveTransactions: [] };
  const band = (nowMs, season) => { ctx.CG.now = () => nowMs; ctx.CG.SEASON = season; return ctx.CG.deadlineBand(); };
  const b1 = band(orig + 3600000, S1);
  A("home band, Saturday: trades close Sunday night, signings and releases closed at the original deadline", /Trades close at 11:59\s?PM ET on Sunday\. Signings and releases closed Sat, Oct 17 · 12:00\s?AM ET \(Rule 2\.4\)\./.test(b1) && /data-dl-ends="1792382340000"/.test(b1), b1.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 220));
  const b2 = band(orig - 5 * 3600000, S1);
  A("home band, before the free-agent close: both closes named", /Signings and releases close at midnight ET tonight, and trades at 11:59\s?PM ET on Sunday \(Rule 2\.4\)\./.test(b2), b2.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 220));
  const b3 = band(orig + 3600000, { movement_deadline_fixed: "2026-10-19T03:59:00Z", moves_lock_override: "auto" });
  A("home band, a season with one close: the v4.16 caption", /Signings, trades and releases close at 11:59\s?PM ET on Sunday \(Rule 2\.4\)\./.test(b3));
}
{
  /* the Trade Hub note, run for real */
  const nSrc = fnOf(live, "tradeHubDeadlineNote");
  const H = { SEASON: S1, ic: () => "", movesClosedForMe: () => false, role: () => "gm" };
  new Function("CG", HOUSE + "\n" + nSrc)(H);
  H.now = () => orig + 3600000; H.movementDeadlineTs = () => sun;
  const t1 = H.tradeHubDeadlineNote();
  A("Trade Hub, Saturday: the clock, plus signings closed and what that means for a trade (camp, and the camp limit)", /data-dl-ends="1792382340000"/.test(t1) && /Signings and releases closed Sat, Oct 17 · 12:00\s?AM ET, so a player a trade brings you joins training camp when your active roster has no place for them, and a trade that would take either club past its training-camp limit cannot be completed \(Rule 2\.1\)\./.test(t1), t1.replace(/<[^>]+>/g, " ").slice(0, 260));
  H.SEASON = { movement_deadline_fixed: "2026-10-19T03:59:00Z" };
  A("...and a season with one close says nothing extra", !/Signings and releases closed/.test(H.tradeHubDeadlineNote()));
}

console.log("\n3. Rule 2.4, the rendered book and the changelog");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === "2.4");
const p3 = sec.paragraphs[3] || "";
A("the extension covers trades and the trade block only", /extended the movement deadline for Season 1 to 11:59 PM Eastern Time on Sunday, 18 October 2026, for trades and the trade block only\./.test(p3) && !/club-initiated signings, trades and releases and for the trade block/.test(p3));
A("signings and releases closed at the original deadline, with the Rule 2.4 replacement exception", /Signings and releases were not extended either: they closed at the same moment, and no club may sign or waive a player for Season 1 after it, except that a club whose rostered player's sign-up is removed after the original deadline may sign one free agent to replace that player under this Rule, before or after the extended deadline\./.test(p3));
A("a trade places an arrival in camp and is refused past the roster and camp limits", /a player acquired by trade for whom the active roster or the player's position group has no place joins the training camp, and a trade that would leave either club with more players than its active roster and training camp can hold shall not be completed \(Rule 2\.1\)\./.test(p3));
A("the cancelled offers stay cancelled", /A trade offer that closed at the original deadline remains closed and may be made again until the extended deadline/.test(p3));
A("the Friday trades' reversal is on record", /every trade completed on Friday, 16 October 2026, the day of the original deadline, was reversed on 17 October 2026, and its players returned to the clubs that traded them/.test(p3));
A("no lapse sentence, no em dash, no gendered pronoun", !/lapses at the extended deadline/.test(p3) && !/[—–]/.test(p3) && !/\b(he|his|him|she|her)\b/i.test(p3));
const s22 = [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === "S2.2") || { paragraphs: [] };
A("Season 2's text says registration opened at Season 1's original deadline", /Registration for Season 2 and owner applications opened at Season 1's original movement deadline, midnight Eastern Time at the end of Friday, 16 October 2026, and remain open \(Rule 2\.4\)\./.test(s22.paragraphs[0] || ""));
{
  const pub2 = R("src/live/part5b_public2.js"), c0 = pub2.indexOf("CG.rulebookForFormat = function");
  const K = {}; new Function("CG", pub2.slice(c0, pub2.indexOf("\nCG.ROUTES.rulebook", c0)))(K);
  const book = K.rulebookForFormat(rb, "basic");
  const r24 = [].concat(...book.chapters.map((c) => c.sections || [])).find((x) => x.id === "2.4");
  A("the RENDERED book carries the new paragraph and not the old one", r24 && r24.paragraphs.some((p) => /for trades and the trade block only\./.test(p)) && !r24.paragraphs.some((p) => /lapses at the extended deadline|club-initiated signings, trades and releases and for the trade block/.test(p)));
}
const e = rb.changelog.find((c) => c.version === "4.17") || {};   /* by version: a later release takes changelog[0] */
A("the changelog has its 4.17 entry, right before 4.16", e.version === "4.17" && (rb.changelog[rb.changelog.indexOf(e) + 1] || {}).version === "4.16");
A("...saying signings and releases closed, trades run to Sunday, replacements count, and the Friday trades were reversed", /signings and releases closed at the original deadline/i.test(e.summary || "") && (e.items || []).some((i) => /may still sign one free agent to replace that player/.test(i)) && (e.items || []).some((i) => /was reversed by commissioner ruling: Penguins and Islanders, Bruins and Penguins, and Red Wings and Islanders/.test(i)));
A("...with no em dash or gendered pronoun", !/[—–]/.test(JSON.stringify(e)) && !/\b(he|his|him|she|her)\b/i.test(JSON.stringify(e)));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
