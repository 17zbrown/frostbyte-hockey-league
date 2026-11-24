/* v4.58 (2026-11-24): the lifecycle announcements speak Season 2 in a market season. announce_lifecycle still held Season 1
   copy ("placed on clubs automatically after the draft", "placed on a club as depth", free agency), with em dashes, and
   Season 2 has reg_close_24h (Dec 10, 11:59 PM ET), reg_closed, draft_tonight, season_tonight and the #free-agency posts
   left to fire. Commissioner, 2026-11-23: "Yes, apply them"; #free-agency "becomes the training camp pool channel".
   Each Season 1 expression stays in place as the ELSE branch of a market_on test; fa_open becomes the training camp pool
   notice once the draft completes, and fa_closed becomes the ONE automatic post at the movement deadline (commissioner,
   2026-11-23: "One automatic Discord post at the movement deadline"), once, in #free-agency; fa_close_6h never fires in a
   market season.
   Pins the record (sql/2026-11-24-s2-lifecycle-copy-v458.sql) and its rehearsal. Run: node tools/s2-lifecycle-copy-v458.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const REC = "sql/2026-11-24-s2-lifecycle-copy-v458.sql";
const sql = R(REC);
const reh = R(REC.replace(/\.sql$/, ".rehearsal.sql"));
const body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const rows = [...sql.matchAll(/\((\d+), '(\w+)',\s*\$a\$([\s\S]*?)\$a\$,\s*\$s\$([\s\S]*?)\$s\$\)/g)].map((m) => ({ ord: +m[1], mode: m[2], a: m[3], s2: m[4] }));
const row = (ord) => rows.find((r) => r.ord === ord) || { a: "", s2: "", mode: "" };
const lits = (s) => [...s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
/* the copy a market season will read: the string literals each row adds (the old Season 1 text is not ours to judge) */
const copy = rows.map((r) => lits(r.s2).join(" ")).join(" ");

console.log("# the record");
A("ten anchored rows on announce_lifecycle: one comment, five copy swaps, the pool notice, two closing guards, the deadline post",
  rows.length === 10 && rows.filter((r) => r.mode === "wrap").length === 5 && row(0).mode === "after" && row(6).mode === "before" &&
  row(7).mode === "replace" && row(8).mode === "replace" && row(9).mode === "before", rows.map((r) => r.ord + r.mode).join(","));
A("every anchor must match exactly once, or nothing changes", /if n <> 1 then raise exception 'v4.58: announce_lifecycle anchor % found % times'/.test(body));
A("a wrap keeps the Season 1 expression as the ELSE branch of market_on",
  /when 'wrap'\s+then E'case when public\.market_on\(s\.id\)\\n      then ' \|\| r\.s2 \|\| E'\\n      else ' \|\| r\.a \|\| ' end'/.test(body));
A("it refuses to apply without db-guards' market_on", /to_regprocedure\('public\.market_on\(uuid\)'\) is null then\s+raise exception/.test(body));
A("the patch table lives only for the transaction", /create temp table _s2_lifecycle_patch \([\s\S]*?\) on commit drop;/.test(body));
A("each replaced Season 1 text promised what Season 2 no longer does",
  /placed on a club automatically after the draft/.test(row(1).a) && /placed on clubs automatically after the draft/.test(row(2).a) &&
  /placed on a club automatically after the draft/.test(row(3).a) && /placed on a club as depth/.test(row(4).a) && /Server picks lock/.test(row(5).a));
A("reg_open keeps its app_config override: only the fallback after the override lookup is swapped",
  /^'Sign-ups for '/.test(row(1).a) && !/ann_text_/.test(rows.map((r) => r.a + r.s2).join("")));
A("late and undrafted players join the training camp pool (reg_open, reg_close_24h, reg_closed, draft_tonight, the pool notice)",
  [1, 2, 3, 4, 6].every((o) => /training camp pool/.test(lits(row(o).s2).join(" "))));
A("draft night: snake order, Owner and GM seated first, the season's roster size, a timed-out pick filled at $750K",
  /rounds in a snake order \(even rounds run in reverse\)/.test(row(4).s2) && /Owner and General Manager are seated before the first pick/.test(row(4).s2) &&
  /public\.season_rules\(s\.id\)->>'roster_max'/.test(row(4).s2) && /A pick whose clock runs out is filled after the draft with a random undrafted player/.test(row(4).s2) &&
  /\$750K/.test(row(4).s2) && /public\.season_rules\(s\.id\)->>'draft_rounds'/.test(row(4).s2));
A("puck drop: pool requests lock with the night's server picks, one per club per game night",
  /and so do training camp pool requests: a club may use up to three pool players a night, and at least half of every game lineup must be the club''s own players/.test(row(5).s2));
A("the pool notice: market seasons only, once (fa_open through _announce_once), within a day of the draft completing, to #free-agency",
  /if public\.market_on\(s\.id\)\s+and exists \(select 1 from public\.draft_state ds where ds\.season_number = s\.number and ds\.status = 'complete'\s+and ds\.updated_at > now\(\) - interval '24 hours'\) then/.test(row(6).s2) &&
  /public\._announce_once\(s\.number, 'fa_open', 'discord_freeagency_webhook', 'The training camp pool is open',/.test(row(6).s2));
A("the pool notice states the bidding rules as ruled: Saturdays of game weeks, 9 to 10 PM ET, until the deadline, $750K, 24-hour waivers",
  /bidding on the Saturday of every game week, 9 to 10 PM ET, until the movement deadline; bids open at \$750K/.test(row(6).s2) &&
  /A waived player spends 24 hours on waivers and joins the pool if no club claims them/.test(row(6).s2) &&
  /-- shortcut: the bidding hour \(9 to 10 PM ET\) and the \$750K opening bid are spelled out, revisit if a season's mk keys change/.test(row(6).s2));
A("the full format's closing posts never fire in a market season (fa_close_6h, and fa_closed keyed on free_agency_closes_at)",
  row(7).s2.startsWith(row(7).a.replace(/ then$/, "")) && /and not public\.market_on\(s\.id\) then/.test(row(7).s2) && /interval '6 hours'/.test(row(7).a) &&
  row(8).s2.startsWith(row(8).a.replace(/ then$/, "")) && /and not public\.market_on\(s\.id\) then/.test(row(8).s2) && /free_agency_closes_at > now\(\) - interval '24 hours'/.test(row(8).a));
const DEADLINE = "The movement deadline has passed. Waivers, claims and Saturday bidding are closed for the season. Clubs may still use up to three training camp pool players a night, with at least half of each game lineup from the club, until the regular season ends; pool players do not play in the playoffs.";
A("fa_closed is the ONE movement-deadline post in a market season: the commissioner-approved sentence, word for word, once, to #free-agency",
  lits(row(9).s2).includes(DEADLINE) &&
  /public\._announce_once\(s\.number, 'fa_closed', 'discord_freeagency_webhook', 'Roster movement is closed',/.test(row(9).s2) &&
  (body.match(/'fa_closed'/g) || []).length === 1);
A("the deadline post fires within a day of movement_deadline_at passing (the one deadline definition), market seasons only",
  /if public\.market_on\(s\.id\) and public\.movement_deadline_at\(s\.id\) <= now\(\)\s+and public\.movement_deadline_at\(s\.id\) > now\(\) - interval '24 hours' then/.test(row(9).s2) &&
  row(9).a === "  if s.free_agency_closes_at is not null and s.free_agency_closes_at <= now()\n");
A("the old Season 1 fa_closed now yields to the deadline post in a market season (one post, not two)",
  /a market season's fa_closed is the movement-deadline post below/.test(row(8).s2));
A("posts leave only through _announce_once (no direct pg_net or webhook call in the record)", !/net\.http_post|discord_http_post\(|discord_no_previews/.test(body));
A("self-checks: new text present, old text kept, nine market branches, SECURITY DEFINER, Season 1 not a market season, the #free-agency webhook configured",
  /the new text of row % is missing/.test(body) && /the old text of row % is gone/.test(body) && /if n <> 9 then raise exception/.test(body) &&
  /lost SECURITY DEFINER/.test(body) && /Season 1 reads as a market season/.test(body) && /discord_freeagency_webhook is not configured/.test(body));
A("the self-check refuses a dash in any literal the new copy adds, with comments stripped first", /chr\(8212\) \|\| chr\(8211\)/.test(body) && /position\(' - ' in v_lit\) > 0/.test(body) &&
  /regexp_replace\(regexp_replace\(r\.s2, '\/\\\*\.\*\?\\\*\/', '', 'g'\), '--\[\^\\n\]\*', '', 'g'\)/.test(sql));

console.log("\n# the copy (writing rules)");
A("no em or en dash, no spaced hyphen in the new copy", !DASHES.test(copy) && !/ - /.test(copy), (copy.match(DASHES) || []).join(""));
A("no em or en dash anywhere in the record outside the Season 1 anchors it replaces",
  !DASHES.test(sql.replace(/\$a\$[\s\S]*?\$a\$/g, "")));
A("neutral pronouns in the new copy", !/\b(he|his|him|she|her)\b/i.test(copy));
A("American spelling in the new copy", !/\b(centre|defence|cancelled|colour|licence|programme)\b/i.test(copy));
A("no Season 1 promise left in the new copy", !/placed on a club|placed on clubs|as depth|free agen|offers from any club/i.test(copy));
A("no rule numbers cited in the new copy (Season 2 numbers are not settled yet)", !/Rule \d|Rule S2/.test(copy));

console.log("\n# the rehearsal");
const rbody = reh.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
A("one DO block that ends in an uncaught REHEARSAL OK raise", /raise exception 'REHEARSAL OK: T0 T1 T2 T3 T4 T5%'/.test(rbody) && /end \$reh\$;\s*$/.test(rbody));
A("no exception handler at all, no dblink, no http", !/exception\s+when/i.test(rbody) && !/dblink|http_get|http_post\(/i.test(rbody));
/* file names may be renumbered and redated at apply time, so the run order is matched on the slug */
A("the run order is spelled out: db-guards, the record, this file",
  /1\. sql\/\d{4}-\d{2}-\d{2}-s2-draft-night-guards-v(?:NNN|\d+)\.sql/.test(reh) && /2\. sql\/\d{4}-\d{2}-\d{2}-s2-lifecycle-copy-v(?:NNN|\d+)\.sql/.test(reh) && /3\. this file/.test(reh));
A("T1: five posts once each, no dash, no Season 1 promise, each to its channel, fa_close_6h held",
  /'draft_tonight,playoffs_tonight,reg_close_24h,reg_open,season_tonight'/.test(rbody) && /v_txt ~ v_dash or position\(' - ' in v_txt\) > 0/.test(rbody) &&
  /discord_announcements_webhook/.test(rbody) && /discord_signup_webhook/.test(rbody) && /free_agency_closes_at = now\(\) \+ interval '1 hour'/.test(rbody));
A("T2: the reg_open override is still posted word for word", /r\.e->>'description' = v_ov_text/.test(rbody));
A("T3: reg_closed and the pool notice to #free-agency post; fa_closed does not",
  /key = 'ann_2_fa_open'/.test(rbody) && /key in \('ann_2_fa_closed', 'ann_2_fa_close_6h'\)/.test(rbody) &&
  /'The training camp pool is open' and r\.url is distinct from \(select value from public\.app_config where key = 'discord_freeagency_webhook'\)/.test(rbody));
A("T4: the movement deadline passes, fa_closed posts the sentence once to #free-agency, and a second run posts nothing",
  /update public\.seasons set movement_deadline_fixed = now\(\) - interval '1 hour'/.test(rbody) && rbody.includes("v_deadline text := '" + DEADLINE.replace(/'/g, "''") + "'") &&
  /r\.e->>'title' is distinct from 'Roster movement is closed' or r\.e->>'description' is distinct from v_deadline/.test(rbody) &&
  /if v_n <> 0 then raise exception 'REHEARSAL FAILED T4: a second run posted % more'/.test(rbody));
A("every queue count reads only lifecycle titles on the lifecycle webhooks, parsing a body only for those webhooks",
  (rbody.match(/and case when q\.url in \(select value from public\.app_config where key = any\(v_hooks\)\) then convert_from\(q\.body, 'UTF8'\)::jsonb->'embeds'->0->>'title' end = any\(v_titles\)/g) || []).length === 5);
A("the rehearsal never prints a webhook address (it compares them, never selects them into the result)", !/v_log := v_log[^;]*url/.test(rbody));

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
