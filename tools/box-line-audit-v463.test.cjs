/* S2 swap, stream g2 (2026-11-24): pins the DRAFT record sql/2026-11-24-box-line-audit-v463.sql and its rehearsal. The
   Season 2 Game desk changes a box-score line through public.stats_game_row (a goal voided on the commissioner's order, cell
   by cell); the record makes the RPC write its own audit row, move the club's EA shot count with a line's shots (v4.45),
   and refuse a line of another game or a line that does not exist. Plain Node: node tools/box-line-audit-v463.test.cjs */
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const REC = fs.readFileSync(path.join(ROOT, "sql/2026-11-24-box-line-audit-v463.sql"), "utf8");
const REH = fs.readFileSync(path.join(ROOT, "sql/2026-11-24-box-line-audit-v463.rehearsal.sql"), "utf8");
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + more + ")")); if (!cond) fails++; };
const body = (REC.match(/\$function\$([\s\S]*?)\$function\$/) || [])[1] || "";
const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

A("the header says why, and that it is a draft for the main session", /DRAFT/.test(REC.slice(0, 400)) && /first client of public\.stats_game_row/.test(REC) && /removing goals/.test(REC));
A("one function, same signature and return type (CREATE OR REPLACE keeps the grants)", (REC.match(/create or replace function/g) || []).length === 1 &&
  /create or replace function public\.stats_game_row\(p_row_id uuid, p_game uuid, p jsonb\)\s+returns public\.game_stats/.test(REC));
A("SECURITY DEFINER with search_path '' (protocol step 1)", /security definer\s+set search_path to ''/.test(REC));
const bare = code.replace(/'[^']*'/g, "''");   /* names inside string literals (the error messages) are words, not objects */
A("every table, type and function is schema-qualified", !/(?<![.\w])(game_stats|games|admin_audit|is_stats_staff|log_admin_action|hockey_position)\b/.test(bare), (bare.match(/(?<![.\w])(game_stats|games|admin_audit|is_stats_staff|log_admin_action|hockey_position)\b/) || [])[0]);
A("the gate is the first statement and is unchanged", /begin\s+if not public\.is_stats_staff\(\) then raise exception 'Only statistics staff can manage games\.' using errcode = '42501'; end if;/.test(code));
A("an update names its game and a missing line is an error (fail loud)", /if not found then raise exception 'No such box-score line\.' using errcode = 'P0002'/.test(code) && /v_old\.game_id is distinct from p_game then raise exception '[^']+' using errcode = '22023'/.test(code));
A("each change writes one audit row, added or changed", (code.match(/public\.log_admin_action\(/g) || []).length === 2 && /'box_score_line_added'/.test(code) && /'box_score_line_changed'/.test(code) && /'shots_moved', v_dshots/.test(code));
A("a line's shots move the club's shot count, never below zero, and a null stays null", /v_dshots := coalesce\(v\.shots, 0\) - coalesce\(v_old\.shots, 0\)/.test(code) && /home_shots is not null then greatest\(0, home_shots \+ v_dshots\)/.test(code) && /away_shots is not null then greatest\(0, away_shots \+ v_dshots\)/.test(code));
A("an added line moves no shot count (EA's club count already holds it)", !/v_dshots/.test(code.split("if p_row_id is null then")[1].split("return v;")[0]));
A("the jsonb patch reading is the old one: a key absent keeps the value, profile_id '' unlinks", /profile_id = case when p \? 'profile_id' then nullif\(p->>'profile_id', ''\)::uuid else profile_id end/.test(code) && /goals = coalesce\(\(p->>'goals'\)::int, goals\)/.test(code));
A("the record ends with self-checks that raise", /do \$check\$[\s\S]*search_path=""[\s\S]*anon can EXECUTE[\s\S]*\$check\$;\s*$/.test(REC));
A("the record carries no transaction of its own (apply_migration and the rehearsal own it)", !/^\s*(begin|commit);/m.test(REC));
const inner = (REH.split("-- ===== RECORD (byte for byte) =====\n")[1] || "").split("-- ===== END RECORD =====")[0];
A("the rehearsal carries the record byte for byte", inner === REC);
A("the rehearsal is one transaction that ends in an uncaught raise", /^begin;$/m.test(REH) && /raise exception 'REHEARSAL OK \(rolled back\)[^']*';\s*end\s*\$post\$;\s*$/.test(REH) && !/^commit;/m.test(REH) && !/when others/.test(REH));
A("it checks every case it names, and that nothing is queued for Discord", ["T1", "T2", "T3", "T4", "T5", "T6"].every((t) => new RegExp("raise notice '" + t + " ok").test(REH)) && /net\.http_request_queue/.test(REH));
A("no ids or names in the rehearsal", !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(REH));
console.log("\n" + (n - fails) + "/" + n + " checks passed");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
