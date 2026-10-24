/* v4.32 (2026-10-24). Commissioner: "Can you add a 'final decision statement' box for all action center decisions that
   are attached to the decision statement?"
   One required box on every Action Center decision (Resolve and Deny, a position change, a forfeit appeal, discipline
   from a case), saved as the request's response, shown to the filer and carried in their notice; the database refuses a
   decision without it (guard_decision_statement). Pins the site, the SQL record (rehearsed on production, rolled back,
   then applied), the rulebook as rendered (new Rule 1.4) and the changelog entry (found by version).
   Run: node tools/decision-statement-v432.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 240))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const strip = (s) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

console.log("\n1. The box");
const live = R("src/live/part_live.js");
const helpers = live.slice(live.indexOf("CG.DECISION_STATEMENT_MAX = 2000;"), live.indexOf("CG.hubComplaintsLive = function(opts){"));
A("one shared field, labeled, capped at 2,000 like the database", /<span>Final decision statement<\/span>/.test(helpers)
  && /maxlength="'\+CG\.DECISION_STATEMENT_MAX\+'"/.test(helpers) && /CG\.DECISION_STATEMENT_MAX = 2000;/.test(helpers));
A("...never prefilled", /<textarea id="decStmt"[^>]*><\/textarea>/.test(helpers) && !/id="decStmt"[^>]*>[^<]/.test(helpers));
A("...an empty statement is refused on the page", /if \(!txt\)\{ CG\.toast\("Write the final decision statement first","err"\); if \(el\) el\.focus\(\); return null; \}/.test(helpers));
A("...one modal for the decisions, which disables its button while the write runs", /CG\.decisionModal = function\(title, introHtml, caption, okLabel, run\)\{/.test(helpers)
  && /this\.disabled = true; run\(txt, this\);/.test(helpers));
A("...no dash as punctuation in the new helpers", !/[—–]/.test(helpers));

console.log("\n2. Every decision uses it");
const bind = live.slice(live.indexOf("CG.AFTER._complaintsLive = function(){"), live.indexOf("CG.hubComplaints = function"));
A("three decisions open the modal: Resolve or Deny, a position change, a forfeit appeal", (bind.match(/CG\.decisionModal\(/g) || []).length === 3);
A("Mark reviewing stays one click; Resolve and Deny write the statement with the status", /if \(st==="reviewing"\)\{ write\(\{\}\); return; \}/.test(bind)
  && /write\(\{ response:txt \}, btn\)/.test(bind) && /patch\.status = st; patch\.updated_at = new Date\(\)\.toISOString\(\);/.test(bind)
  && /\.update\(patch\)\.eq\("id",id\)\.select\("id"\)/.test(bind));
A("a position change sends the statement as its note", /CG\.sb\.rpc\("decide_position_change",\{ p_request:id, p_approve:approve, p_note:txt \}\)/.test(bind));
A("a forfeit appeal sends it as its response (the v3.93 pin holds)", /CG\.decisionModal\(overturn \? "Overturn the forfeit" : "Deny the appeal"/.test(bind)
  && /CG\.sb\.rpc\("decide_forfeit_appeal", \{ p_request:id, p_overturn:overturn, p_response:txt \}\)/.test(bind) && !/ffaResp/.test(live));
const disc = live.slice(live.indexOf("CG.caseDisciplineModal = function"), live.indexOf("CG.caseHistoryModal = function"));
A("discipline: the field sits outside #dcBody, so changing the player keeps the statement", disc.indexOf("CG.decisionStatementField(") > disc.indexOf('<div id="dcBody">')
  && disc.slice(disc.indexOf("var draw = function"), disc.indexOf("CG.modal(\"Issue discipline\"")).indexOf("decisionStatementField") < 0);
A("...it is read and sent", /var stmt = CG\.readDecisionStatement\(\); if \(stmt === null\) return;/.test(disc) && /p_codes: codes\.length \? codes : null, p_statement:stmt \}/.test(disc));
A("...the grounds label is neutral and says who sees them", /Grounds \(on the player’s record; the player and league staff see them\)/.test(disc) && !/he is shown it/.test(disc));
A("Respond is retired", !/data-act-respond|arResp|Save response/.test(live));

console.log("\n3. Where it is read");
A("the card shows it under its own heading, line breaks kept", /\(closed\?"Final decision statement":"Earlier decision statement"\)/.test(live)
  && /<span style="white-space:pre-wrap">'\+esc\(a\.response\)\+'<\/span>/.test(live) && !/>Official response</.test(live));
const card = live.slice(live.indexOf("CG.actionCard = function"), live.indexOf("CG.hubComplaintsLive = function"));
A("...closed is declared before the heading reads it, once", (card.match(/var closed = a\.status==="resolved"\|\|a\.status==="denied";/g) || []).length === 1
  && card.indexOf("var closed =") < card.indexOf('(closed?"Final decision statement"'));
A("a club's statistics correction is its whole front office's, like a forfeit appeal", /\(a\.type==="stats_correction" && myClubId && a\.team_id===myClubId\)/.test(live));
A("notices keep the statement's line breaks", /\.notif p\{[^}]*white-space:pre-line/.test(R("src/live/part1_head.html")));
A("the copy says it", /Every request is decided with a final decision statement you can read here \(Rule 1\.4\)\./.test(live)
  && /If you resolve or deny one, you write a final decision statement that the player reads on the request \(Rule 1\.4\)\./.test(live)
  && /You are under no obligation to act on one\./.test(live) && !/written decision/.test(live));

console.log("\n4. The database record");
const sql = R("sql/2026-10-24-decision-statement-v432.sql");
const mig = strip(sql.slice(0, sql.indexOf("/* REHEARSAL, 2026-10-24")));
A("one guard on every door, before insert or a change of status or response", /create trigger trg_guard_decision_statement before insert or update of status, response on public\.action_requests\s+for each row execute function public\.guard_decision_statement\(\);/.test(mig));
A("...a filing is born open with no statement", /if new\.status is distinct from 'open' or new\.response is not null then/.test(mig));
A("...a decision needs one, not blank, new, at most 2,000", /if btrim\(coalesce\(new\.response, ''\)\) = '' then/.test(mig)
  && /if new\.response is not distinct from old\.response then\s+raise exception 'Write a new final decision statement\./.test(mig)
  && /if char_length\(new\.response\) > 2000 then/.test(mig));
A("...a statement only with a decision", /raise exception 'A final decision statement is written with the decision itself\.' using errcode = 'check_violation';/.test(mig));
A("...the guard is not callable through the API", /revoke all on function public\.guard_decision_statement\(\) from public, anon, authenticated;/.test(mig));
const nas = sql.slice(sql.indexOf("create or replace function public.notify_action_status()"), sql.indexOf("-- 3. discipline from a case"));
const nasCode = nas.replace(/\/\*[\s\S]*?\*\//g, "");
A("the decision notice is the statement; the fallback and the acknowledged branch are gone", /'request', v_title, new\.response/.test(nasCode)
  && !/A reviewer updated|acknowledged/.test(nasCode) && /x\.pid <> new\.profile_id/.test(nasCode));
const dfc = sql.slice(sql.indexOf("create function public.discipline_from_case("), sql.indexOf("-- 4. position change"));
A("discipline_from_case: one signature, the statement word for word, the thread line staff-only",
  /drop function public\.discipline_from_case\(uuid, uuid, text, integer, timestamptz, integer, text, text\[\], text, boolean\);/.test(mig)
  && /p_statement text default null\)/.test(mig) && /response = nullif\(btrim\(p_statement\), ''\),/.test(mig)
  && /'Discipline issued: '\|\|v_len\|\|coalesce\('\. '\|\|s\.reason,''\)\|\|'\.', true\);/.test(dfc) && !/'Ruling: '/.test(dfc) && dfc.length > 500);
A("...grants on the 11-argument signature", /revoke all on function public\.discipline_from_case\(uuid, uuid, text, integer, timestamptz, integer, text, text\[\], text, boolean, text\) from public, anon, authenticated;/.test(mig)
  && /grant execute on function public\.discipline_from_case\(uuid, uuid, text, integer, timestamptz, integer, text, text\[\], text, boolean, text\) to authenticated, service_role;/.test(mig));
A("decide_position_change: the statement word for word, anchored once each", /response = v_resp,   -- v4\.32/.test(sql)
  && /if v_n <> 1 then raise exception 'patch: decide_position_change anchor % matched % times', i, v_n; end if;/.test(mig));
A("a statistics correction is readable by its club's seats", /or \(\(type = 'stats_correction'\) and public\.is_gm_of\(team_id\)\)\);/.test(mig)
  && /r\.type in \('forfeit_appeal', 'stats_correction'\) and public\.is_gm_of\(r\.team_id\)/.test(mig));
A("self-checks raise", (mig.match(/raise exception 'self-check:/g) || []).length >= 7);
A("rehearsed on production and rolled back", /Result: REHEARSAL OK \(rolled back\): P1 P3 P4 P5 P6 P7 P8 P9 P10 P11a P11 P12a P12 P12b P13 P14/.test(sql));
A("applied and audited", /Applied as migration v432_decision_statement; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
A("the probe never runs as part of the migration", /\/\* ---- REHEARSAL PROBE/.test(sql) && !/REHEARSAL OK/.test(mig));

console.log("\n5. The rulebook, as rendered");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = (id) => [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === id) || { paragraphs: [] };
eval(R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0]);
const r14 = sec("1.4");
A("Rule 1.4, both formats, three paragraphs", r14.title === "Requests and final decisions" && !r14.full && r14.paragraphs.length === 3);
const t14 = r14.paragraphs.join(" ");
A("...no decision without one", /No filing may be approved, denied, resolved, upheld, overturned or otherwise closed without one, and the site refuses a decision that carries none\./.test(t14));
A("...the club's seats read theirs", /also shown to that club's Owner, General Manager and Assistant General Manager/.test(t14));
A("...a complaint's statement keeps Rule 7.2's privacy", /shall not disclose a formal warning or the written grounds of a sanction/.test(t14));
A("six rules point to it", ["2.3", "2.9", "5.2", "6.3", "7.1", "7.6"].every((k) => /\(Rule 1\.4\)/.test(sec(k).paragraphs.join(" ")))
  && /Staff decide it with a final decision statement \(Rule 1\.4\)/.test((sec("2.9").full || []).join(" ")));
for (const fmt of ["basic", "full"]) {
  const b = JSON.stringify(CG.rulebookForFormat(rb, fmt).chapters);
  A("the rendered " + fmt + " book has Rule 1.4 and its references", /Requests and final decisions/.test(b) && (b.match(/\(Rule 1\.4\)/g) || []).length >= 6);
}
A("no dash or gendered pronoun in the new rule", !/[—–]| - /.test(t14) && !/\b(he|his|him|she|her|hers)\b/i.test(t14));

console.log("\n6. The changelog");
const e = rb.changelog.find((c) => c.version === "4.32") || {};
A("entry 4.32, in key order", e.version === "4.32" && JSON.stringify(Object.keys(e)) === JSON.stringify(["version", "dateIso", "summary", "items"]));
A("...says the statement, Respond retired, the club's seats and Rule 1.4", /final decision statement/.test(e.summary || "")
  && (e.items || []).some((i) => /Respond button is gone/.test(i)) && (e.items || []).some((i) => /new Rule 1\.4/.test(i))
  && (e.items || []).some((i) => /every seat of the club that filed it/.test(i)));
A("...with no em dash or gendered pronoun", !/[—–]| - /.test(JSON.stringify(e)) && !/\b(he|his|him|she|her|hers)\b/i.test(JSON.stringify(e)));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
