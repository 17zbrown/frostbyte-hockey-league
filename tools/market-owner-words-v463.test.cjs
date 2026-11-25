/* v463 (drafted by stream b4, 2026-11-24): a Season 2 market move never tells a seat to "send this move to the Owner".
   node tools/market-owner-words-v463.test.cjs
   public._market_ctx answers a seat whose Owner approves the page's moves in the market's own words (hint
   owner_approves), never with mgmt_gate's MGMT_APPROVAL_REQUIRED prefix, which the new site's write door reads as "queue
   this move for the Owner" (stream f's hand-over: "market claims and bids cannot be queued for the Owner, but _market_ctx
   raises the same send-to-the-Owner wording (misleading)"). Pins the record (the anchored patch, the byte proof, the
   self-checks), its rehearsal, and the client half: the market doors never ask S2.write for the Owner's queue. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;

const REC = "sql/2026-11-24-market-owner-words-v463.sql", REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC), reh = R(REH);
const part = (s, tag) => { const m = s.match(new RegExp("\\$" + tag + "\\$([\\s\\S]*?)\\$" + tag + "\\$")); return m ? m[1] : ""; };
const anchor = part(sql, "a"), block = part(sql, "b");

console.log("1. The record");
A("the header quotes stream f's hand-over and says why the prefix matters to the write door",
  /"market claims and bids cannot be\n-- queued for the Owner, but _market_ctx raises the same send-to-the-Owner wording \(misleading\)"/.test(sql) && /viaOwner/.test(sql));
A("the anchor is the gate call in the live _market_ctx (the v4.58 waivers record wrote it)",
  anchor === "  perform public.mgmt_gate(p_team, p_page);\n" && R("sql/2026-11-24-s2-waivers-v458.sql").indexOf(anchor) >= 0);
A("...asserted to match exactly once, and the new body differs from the old by the block only",
  /if n <> 1 then raise exception 'v463 market owner words: the _market_ctx anchor matched % times, expected exactly 1', n; end if;/.test(sql)
  && /execute replace\(v_old, a, b\);/.test(sql) && /if replace\(v_new, b, a\) <> v_old then/.test(sql));
A("the block answers an approving seat before the gate, in plain words, 42501 with the hint owner_approves",
  /and public\.mgmt_access\(p_team, p_page\) = 'approve' then\n    raise exception 'Your Owner approves this seat''s % moves, and a market move cannot wait for approval, so ask your Owner to make it\.',\n      public\.mgmt_page_label\(p_page\) using errcode = '42501', hint = 'owner_approves';/.test(block)
  && block.indexOf("hint = 'owner_approves'") < block.indexOf("perform public.mgmt_gate(p_team, p_page);"));
A("...never with the queue's prefix (the sentence the seat reads does not start MGMT_APPROVAL_REQUIRED)",
  !/raise exception 'MGMT_APPROVAL_REQUIRED/.test(block));
A("the Owner-approved execution still passes first, as mgmt_gate lets it",
  /coalesce\(current_setting\('app\.mgmt_approved', true\), ''\) is distinct from coalesce\(p_team::text, ''\)/.test(block));
A("every other mode is still the gate's own answer (the gate is called after the block, unchanged)",
  /\n  perform public\.mgmt_gate\(p_team, p_page\);\n$/.test(block) && !/create or replace function public\.mgmt_gate/i.test(sql));
A("preconditions: the four doors still answer an approving seat before _market_ctx",
  ["public.market_claim(uuid,uuid)", "public.market_bid(uuid,uuid,bigint)", "public.market_pool_request(uuid,uuid,uuid)", "public.market_pool_withdraw(uuid)"].every((f) => sql.indexOf("'" + f + "'") >= 0)
  && /no longer answers an approving seat before _market_ctx/.test(sql));
A("self-checks: definer with an empty search_path, no client grant, the order, the gate keeps its prefix",
  ["must stay SECURITY DEFINER with search_path", "must stay without a client grant", "the market answer must come before the gate", "mgmt_gate must keep its queue prefix"].every((t) => sql.indexOf(t) >= 0));
A("CREATE OR REPLACE keeps the signature and the grants: no DROP, no GRANT", !/drop\s+function/i.test(sql) && !/^\s*grant /im.test(sql));
A("the record posts nothing and writes no row", !/discord_http_post|notify_discord|_announce_once|discord_dms|club_notify|insert into|update public\.|delete from/i.test(sql));
A("the record has no dashes and no gendered pronouns", !DASHES.test(sql) && !/ - /.test((sql.match(/^--.*$/gm) || []).join("\n")) && !GENDERED.test(sql));

console.log("\n2. The rehearsal");
const embedded = (reh.match(/-- >>> record text: [^\n]*\n([\s\S]*?)-- <<< record text\n/) || [])[1] || "";
A("it carries the record's text byte for byte", embedded === sql.replace(/\n?$/, "\n"));
A("one transaction: begins once, never commits, ends in the uncaught verdict",
  (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh) && /raise exception 'REHEARSAL OK: R1 R2 R3 R4 R5 R6 R7';\nend \$r7\$;\n$/.test(reh));
A("the world seats a free, unsuspended Season 2 sign-up as GM the ordinary way and sets the club's policy",
  /update public\.teams set gm_profile_id = v_gm where id = v_team;/.test(reh) && /not public\.is_suspended\(r\.profile_id\)/.test(reh)
  && /'\{"gm": \{"freeagents": "approve", "lines": "hidden"\}\}'::jsonb/.test(reh));
A("R1 pins the market's sentence, hint and code; R2 the gate's own for a hidden page",
  /R1 failed/.test(reh) && /v_hint is distinct from 'owner_approves' or v_code <> '42501'/.test(reh) && /'The Owner has not given your seat access to Lineup builder\.'/.test(reh));
A("R3 to R5: full access, a commissioner and the Owner-approved run all pass the gate",
  ["R3 failed", "R4 failed", "R5 failed"].every((t) => reh.indexOf(t) >= 0) && /set_config\('app\.mgmt_approved', v_team::text, true\)/.test(reh));
A("R6: each door's own refusal comes first (owner_claims, owner_bids, owner_requests)", /a <> 'owner_claims' or b <> 'owner_bids' or c <> 'owner_requests'/.test(reh));
A("R7: a queueable move still meets MGMT_APPROVAL_REQUIRED", /if v_msg not like 'MGMT_APPROVAL_REQUIRED:%' then raise exception 'R7 failed/.test(reh));
A("the rehearsal names no member (it picks rows at run time)", !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(reh));

console.log("\n3. The client half: a market door never asks for the Owner's queue");
const mk = R("src/s2/js/market.js");
const writes = mk.match(/dbAct\("market_[a-z_]+"[^\n]*/g) || [];
A("every market door goes through dbAct() with no approval (the waiver is the one move the queue takes)",
  writes.length >= 6 && writes.every((w) => !/"owner"/.test(w)) && /function lWaive\(pid, o\) \{ return dbAct\("waive_player", [^\n]*ROSTER, "owner"\); \}/.test(mk), writes.join(" | "));
A("a refusal keeps the database's hint as the problem's code, so owner_approves reaches the page as itself",
  /function refused\(e\) \{ return \{ ok: false, data: null, problems: \[prob\(\(e && \(e\.hint \|\| e\.code\)\) \|\| "refused"/.test(mk));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
