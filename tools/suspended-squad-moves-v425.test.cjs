/* v4.25 (2026-10-21). Commissioner: "allow suspended players to be moved between training camp and the active roster, or
   traded but not waived."
   Before: v3.51 locked a running playing suspension in place on the roster (guard_squad_move refused a squad change
   for anyone but the league office), v4.18 let a suspended player be traded, and nothing stopped a club from waiving
   one (waive_player only asked whether the MANAGER was suspended).
   After: the squad lock is gone (database, Team HQ buttons, the swap picker); waive_player and mgmt_request_move refuse
   a suspended player, for the league office too; the Waive button says why before the click; the two suspension
   notices and Rules 2.1, 2.2, 2.6 and 7.2 say the new rule. The SQL ran as rolled-back rehearsals on production before
   it was applied (results recorded in the SQL file).
   Run: node tools/suspended-squad-moves-v425.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const strip = (s) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const fnBody = (src, name) => { const i = src.indexOf("create or replace function public." + name); return i < 0 ? "" : src.slice(i, src.indexOf("$function$;", i)); };

console.log("\n1. The database record");
const sql = R("sql/2026-10-21-suspended-squad-moves-v425.sql"), body = strip(sql);
const g = fnBody(body, "guard_squad_move"), w = fnBody(body, "waive_player"), m = fnBody(body, "mgmt_request_move");
A("guard_squad_move no longer reads a suspension", !!g && !/is_suspended/.test(g));
A("...and keeps the management, freeze and camp checks and the move counter", /Management is never sent to training camp/.test(g) && /public\.roster_freeze_at\(\) and not \(public\.is_commissioner\(\) or public\.trusted_writer\(\)\)/.test(g) && /v_camp >= public\.camp_max\(NEW\.season_id\)/.test(g) && /insert into public\.squad_move_history/.test(g));
A("...and still records the v3.51 ruling it supersedes", /v3\.51 \(commissioner, 2026-09-28\) locked a suspended player/.test(g) && /v4\.25 \(commissioner, 2026-10-21/.test(g));
A("waive_player refuses a suspended player, before the delete", /if public\.is_suspended\(p_profile\) then\s+raise exception 'Rule 7\.2: % is suspended and cannot be waived until the suspension is served/.test(w) && w.indexOf("is_suspended(p_profile)") < w.indexOf("delete from public.roster_spots"));
A("...for the league office too (no commissioner exception around it)", !/if not public\.is_commissioner\(\) then\s+if public\.is_suspended\(p_profile\)/.test(w) && w.indexOf("is_suspended(p_profile)") < w.indexOf("if not public.is_commissioner() then\n    v_why"));
A("mgmt_request_move refuses the waiver before it is queued", /if p_action = 'waive_player' and public\.is_suspended\(nullif\(p_args->>'p_profile', ''\)::uuid\) then/.test(m) && m.indexOf("p_action = 'waive_player' and public.is_suspended") < m.indexOf("insert into public.team_mgmt_moves"));
A("all three move to an empty search_path and stay CREATE OR REPLACE (grants kept)", [g, w, m].every((x) => /set search_path to ''/.test(x)) && !/drop function/i.test(body));
A("the self-check asserts the result", /v4\.25 check: guard_squad_move still reads is_suspended/.test(body) && /v4\.25 check: the waive guard must run before the delete/.test(body) && /v4\.25 check: waive_player or mgmt_request_move grants changed/.test(body));
A("part b rewrites both notices with anchors asserted once", /v4\.25b: notify_suspension anchor found % times/.test(body) && /v4\.25b: pull_suspended_from_lineups anchor % found % times/.test(body)
  && /Your club may still move you between its roster and training camp or trade you, but may not waive you while it runs\./.test(body)
  && /They may still be called up, sent down ''\|\|',\s+'''or traded, but your club may not waive them until it is served \(Rule 7\.2\)\./.test(body));
A("the rehearsals are recorded", /Result: REHEARSAL OK: T0 T1 T2 T3 T4 T5 T6 T7\./.test(sql) && /Result: REHEARSAL OK: T1 T2 T3 T4\(owner notification\)\./.test(sql)
  && /swap_roster_squad\(Tager, DaBallerTv\) goes through/.test(sql) && /refused with "training camp is full"/.test(sql));
A("all three parts applied and audited", ["v425_suspended_squad_moves", "v425b_suspension_notice_text", "v425c_waiver_bar_on_the_trigger"].every((m) => new RegExp("Applied as migration " + m + "; tools/sql/grant-audit\\.sql returned zero rows\\.").test(sql)));
const rw = fnBody(body, "guard_roster_waive");
A("part c: the delete trigger bars a suspended player's waiver for every door", /if public\.is_suspended\(old\.profile_id\)\s+and \(coalesce\(current_setting\('app\.roster_reason', true\), ''\) = 'waived'\s+or \(auth\.uid\(\) is not null and not \(public\.is_commissioner\(\) or public\.trusted_writer\(\)\)\)\) then/.test(rw));
A("...after the office-removal bypass and before the release close", rw.indexOf("app.office_removal") < rw.indexOf("is_suspended(old.profile_id)") && rw.indexOf("is_suspended(old.profile_id)") < rw.indexOf("fa_moves_closed(old.season_id)"));
A("...with an empty search_path", /set search_path to ''/.test(rw));
A("part c: the member notice has its own sentence for a season-long and for an unrostered suspension", /when new\.mode = 'seasons'\s+then 'While it runs you may not be scheduled, dress or play, or appear in a league lobby\. A suspension for the rest of a season also takes you off your club''s roster/.test(body)
  && /when not exists \(select 1 from public\.roster_spots rs where rs\.profile_id = new\.profile_id and rs\.season_id = public\.current_season_id\(\)\)\s+then 'While it runs you may not be scheduled, dress or play, or appear in a league lobby, and no club may sign you \(Rule 7\.2\)\.'/.test(body));
A("part c rehearsal recorded: the RLS delete refused, the office removal and jobs untouched, three notices", /Result: REHEARSAL OK: T0 T1 T2 T3 T4 T5 T6 T7 T8\./.test(sql) && /a direct DELETE of Tager's roster row through RLS \(the door that skips waive_player\) is refused/.test(sql) && /a commissioner's removal \(no waiver reason, the admin_remove_from_roster shape\) still deletes the row/.test(sql));
A("nothing in the record posts to Discord directly", !/net\.http_post|discord_http_post\(/.test(body));

console.log("\n2. Team HQ");
const hub = R("src/live/part6_hub.js"), live = R("src/live/part_live.js");
const sb = hub.slice(hub.indexOf("function squadBtn(p){"), hub.indexOf("function squadBtn(p){") + 2600);
A("the squad buttons have no suspension lock", !!sb && !/suspensionOf|\bsus\b/.test(sb.slice(0, sb.indexOf("if (fz.on && !fzOffice)"))));
A("the swap picker offers a suspended counterpart", !/CG\.suspensionOf\(x\.id\)/.test(live) && /return x\.spotId && !x\.mgmt && !CG\.isWaived\(x\.id\) && x\.squad===wantSquad &&\n\s+CG\.posGroup\(x\.pos\)===CG\.posGroup\(me\.pos\);/.test(live));
/* v4.27 (commissioner, 2026-10-21: "Commissioners may move remove or edit any player at any time. Commissioners always
   have more ability that team managers, even in the team HQ."): the waiver bar is the club's, not the office's */
A("the Waive button is locked for a suspended player, for the club (the office keeps it since v4.27)", /if \(susp && CG\.role\(\)!=="commish"\) return '<button class="btn btn-ghost btn-sm" disabled title="'\+esc\(CG\.suspensionText\(susp\)\)\+'">'\+CG\.ic\("lock",12\)\+' Waive<\/button>';/.test(hub));
A("...after the season's own close, before minimum service", hub.indexOf("if (susp && CG.role()!==\"commish\") return '<button") > hub.indexOf("FA_MOVES_CLOSED)+'\">Waive</button>';") && hub.indexOf("if (susp && CG.role()!==\"commish\") return '<button") < hub.indexOf("var mv = (CG.role()!==\"commish\" && CG.canMovePlayer)"));
A("one client twin of public.is_suspended: a staff-only suspension never locks a player", /CG\.playSuspensionOf = function\(pid\)\{\n  return \(\(CG\.lg && CG\.lg\.suspensions\) \|\| \[\]\)\.find\(function\(s\)\{ return s\.playerId===pid && s\.status==="active" && s\.scope!=="staff"; \}\) \|\| null;\n\};/.test(hub));
A("...read by the roster row (and so the Waive lock), the trade chip and both lineup boards", /var susp = CG\.playSuspensionOf\(p\.id\);/.test(hub) && /var s = CG\.playSuspensionOf \? CG\.playSuspensionOf\(pid\) : null;/.test(live)
  && (hub.match(/if \(s\.status==="active" && s\.scope!=="staff"\) suspended\[s\.playerId\]=true;/g) || []).length === 2);
{
  const src = hub.match(/CG\.playSuspensionOf = function\(pid\)\{[\s\S]*?\n\};/)[0];
  const C = { lg: { suspensions: [{ playerId: "a", status: "active", scope: "staff" }, { playerId: "b", status: "active", scope: "both" }, { playerId: "c", status: "served", scope: "play" }] } };
  new Function("CG", src)(C);
  A("...driven: staff-only no, both yes, served no", C.playSuspensionOf("a") === null && !!C.playSuspensionOf("b") && C.playSuspensionOf("c") === null);
}
A("the new comments use they/them for players", !/in place for his club|picker for his club/.test(hub + live));
A("a suspended row is marked, not dimmed", /\(susp\?" susp-row":""\)\+'"'\+\(waived\?' style="opacity:\.55"':""\)/.test(hub) && !/\(waived\|\|susp\)\?' style="opacity/.test(hub));
A("the lineup boards say a suspended player cannot be scheduled, not that they are locked", (hub.match(/Suspended: cannot be scheduled until it is served \(Rule 7\.2\)/g) || []).length === 3 && !/Suspended: locked until/.test(hub));
{
  /* run the tooltip for real */
  const src = hub.match(/CG\.suspensionText = function\(s\)\{[\s\S]*?\n\};/)[0];
  const C = { fmtDay: () => "Fri Oct 23" };
  new Function("CG", src)(C);
  const t = C.suspensionText({ mode: "games", games: 3, gamesServed: 1 });
  A("the tooltip, driven", t === "Suspended, 1 of 3 games served. They cannot be scheduled until it is served. The club may still call them up, send them down or trade them, and the suspension goes with them, but may not waive them (Rule 7.2).", t);
  A("...with no lock and no gendered pronoun", !/locked|\b(he|his|him)\b/.test(t));
}

console.log("\n3. The rulebook, as rendered");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = (id) => [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === id) || { paragraphs: [] };
eval(R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0]);
/* the chapters only: older changelog entries (v3.85, v4.18) describe the lock as it stood then, and history stays */
const book = (fmt) => JSON.stringify(CG.rulebookForFormat(rb, fmt).chapters);
const r72 = sec("7.2").paragraphs.join(" "), r21 = sec("2.1").paragraphs.join(" "), r22 = sec("2.2").paragraphs.join(" ");
A("7.2: no lock in place; moved and traded like any other player", /The suspension does not hold the player in place on the roster: the player's club may move the player between its active roster and its training camp under Rule 2\.1, and may trade the player under Rule 2\.3, like any other player, and any club may trade for a suspended player\./.test(r72));
A("7.2: the club may not waive; a commissioner may (v4.27)", /The club may not waive a suspended player until the suspension is served; a commissioner may, as a commissioner may move, remove or edit any player at any time \(Rule 2\.6\)\./.test(r72));
A("7.2: the suspension still travels, and a season-long one still removes", /serves the rest of the suspension on that club's games\./.test(r72) && /expelled, does not stay on the roster but is removed:/.test(r72));
A("7.2: the scheduling bar stands", /A suspended player may not be scheduled on a lineup or a line, dress, appear in a league lobby/.test(r72));
A("2.1 says it", /A suspended player may be called up, sent down and traded like any other player, but may not be waived by their club until their suspension is served \(Rule 7\.2\)\./.test(r21));
A("2.2 carves the waiver out", /A club may waive a player at any time, whether or not the player has played \(Rule 2\.4\), save a player whose suspension is running, who may not be waived until it is served \(Rule 7\.2\)\./.test(r22));
A("2.6 in both formats: the office exception is gone and the bar named", [sec("2.6").paragraphs[6], sec("2.6").full[6]].every((p) => /a commissioner may, for example, waive a suspended player, whom the club itself may not waive \(Rule 7\.2\)\./.test(p) && !/may also move a suspended player/.test(p)));
for (const fmt of ["basic", "full"]) {
  const b = book(fmt);
  A("the rendered " + fmt + " book has the new rule and none of the old lock", /may not waive a suspended player until the suspension is served/.test(b) && !/locked in place|locked where (he|they) (is|stand)|may also move a suspended player|is not held in place/.test(b));
}
A("no dash as punctuation in the changed sections", !/—| - /.test(JSON.stringify(["2.1", "2.2", "2.6", "7.2"].map((k) => [sec(k).paragraphs, sec(k).full || []]))));

console.log("\n4. The changelog");
const e = rb.changelog.find((c) => c.version === "4.25") || {};
A("4.25 is recorded, right before 4.24", e.version === "4.25" && (rb.changelog[rb.changelog.indexOf(e) + 1] || {}).version === "4.24");
A("...in key order", JSON.stringify(Object.keys(e)) === JSON.stringify(["version", "dateIso", "summary", "items"]));
A("...saying both halves and naming the rules", /called up, sent down or traded/.test(e.summary || "") && /cannot be waived/.test(e.summary || "") && (e.items || []).some((i) => /Rules 2\.1, 2\.2, 2\.6 and 7\.2/.test(i)));
A("...with no em dash or gendered pronoun", !/[—–]| - /.test(JSON.stringify(e)) && !/\b(he|his|him|she|her)\b/i.test(JSON.stringify(e)));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
