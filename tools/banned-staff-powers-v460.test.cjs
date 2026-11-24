/* v4.60: a banned member holds no staff powers (Rule 7.2). node tools/banned-staff-powers-v460.test.cjs
   Found 2026-11-24 while fixing the Season 2 staffing flip drafts: ban_player keeps profiles.role so an unban restores it,
   but is_staff() read only the role, so a staffer banned since 2026-10-05 still passed 39 staff policies, got every staff
   bell and counted as a staff vote voter. Pins the record (is_staff, notify_staff_bell, the staff vote electorate by
   exact anchor with counts, the self-checks, the is_commissioner shortcut marker), the rehearsal (the record byte for
   byte, the cases, no handler around the verdict), Rule 7.2 and the changelog entry. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;
const comments = (s) => (s.match(/--[^\n]*|\/\*[\s\S]*?\*\//g) || []).join("\n");

const REC = "sql/2026-11-24-banned-staff-powers-v460.sql";
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC), reh = R(REH);
const body = sql.slice(0, sql.indexOf("\n-- Rehearsal (2026-11-24)"));

console.log("1. The record");
A("is_staff reads the ban and the staff suspension, with search_path ''",
  /create or replace function public\.is_staff\(\)[\s\S]*?set search_path to ''[\s\S]*?role = 'staff' and not banned\)\n     and not public\.is_staff_suspended\(auth\.uid\(\)\);/.test(sql));
A("is_staff stays a CREATE OR REPLACE (a DROP would reset the anon EXECUTE that policies need)",
  !/drop function[^;]*is_staff\(/i.test(sql) && /has_function_privilege\('anon', 'public\.is_staff\(\)', 'execute'\)/.test(sql));
A("notify_staff_bell skips banned members",
  /create or replace function public\.notify_staff_bell[\s\S]*?where role = 'staff' and not banned/.test(sql));
A("the staff vote electorate reads the ban: board once, create twice, each count asserted",
  sql.indexOf("$a$p.role in ('staff','commissioner')$a$") > 0 && sql.indexOf("$b$p.role in ('staff','commissioner') and not p.banned$b$") > 0
  && /staff_vote_board anchor matched % times, expected 1/.test(sql) && /if n <> 1 then/.test(sql)
  && /staff_vote_create anchor matched % times, expected 2/.test(sql) && /if n <> 2 then/.test(sql));
A("a second run is refused, not doubled", /staff_vote_board already reads the ban/.test(sql) && /staff_vote_create already reads the ban/.test(sql));
A("self-checks raise on each part", (sql.match(/raise exception 'v4\.60 check:/g) || []).length >= 5);
A("is_commissioner is left alone on purpose, with a shortcut marker naming the trigger to revisit",
  /-- shortcut: is_commissioner\(\) still ignores the ban[\s\S]*?revisit if a commissioner is ever banned/.test(sql)
  && !/create or replace function public\.is_commissioner/.test(sql));
A("no Discord post from the record", !/discord_http_post|net\.http_post/.test(body));
A("the record carries its rehearsal result", /Result: REHEARSAL OK: T0 \(B is staff, reads 19 of 19 cases\) T1 \(B reads 1 own\) T2 \(8 bells\) T3 \(9 eligible\)/.test(sql));

console.log("\n2. The rehearsal");
A("the rehearsal carries the record byte for byte", reh.indexOf(body) > 0);
A("one transaction, opened once, never committed", (reh.match(/^begin;$/gm) || []).length === 1 && !/^commit;/m.test(reh));
A("the verdict is an uncaught raise at the very end",
  /raise exception 'REHEARSAL OK: % T1 \(B reads % own\) T2 \(% bells\) T3 \(% eligible\)'[^;]*;\nend \$post\$;\n$/.test(reh));
A("no handler around the probes", !/exception\s+when/i.test(reh.replace(body, "")));
A("T0 proves the hole before the record, T1 closes it after", /T0: B does not pass is_staff\(\) before the record/.test(reh)
  && /T1: B still passes is_staff\(\)/.test(reh) && /expected only the % B filed/.test(reh));
A("T2 and T3 check the bell and the vote electorate", /T2: B was rung/.test(reh) && /T3: eligibleCount %, expected %/.test(reh)
  && /T3: B got the vote bell/.test(reh));
A("the rehearsal names no member", !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh));
A("no dashes and no gendered pronouns in the record or rehearsal",
  !DASHES.test(sql) && !DASHES.test(reh) && !GENDERED.test(comments(sql)) && !GENDERED.test(comments(reh)));

console.log("\n3. Rule 7.2 and the changelog");
const ctx = { CG: {} }; vm.createContext(ctx); vm.runInContext(R("src/live/part3_content.js"), ctx);
const rb = ctx.CG.CONTENT.rulebook;
const ch7 = rb.chapters.find((c) => String(c.num) === "7");
const r72 = ch7 && ch7.sections.find((s) => s.id === "7.2");
const p1 = (r72 && r72.paragraphs[1]) || "";
const NEW = "An expelled member of league staff holds no desk or staff power while the expulsion stands, receives no staff notices, and is not counted among the voters of any staff vote.";
A("Rule 7.2 paragraph 1 says a banned staffer holds no staff power", p1.indexOf(NEW) > 0, p1.slice(-300));
A("the sentence sits beside the staff-duties suspension and before the enforcement line",
  p1.indexOf("removes their desks and staff powers while it runs. " + NEW + " The league") > 0);
const e = rb.changelog.find((c) => c.version === "4.60");
A("the 4.60 changelog entry exists", !!e);
A("the entry names Rule 7.2 and the appeal carve-out", !!e && /Rule 7\.2/.test(e.summary + e.items.join(" ")) && /Rule 7\.6/.test(e.items.join(" ")));
A("the entry follows the writing rules", !!e && !DASHES.test(JSON.stringify(e)) && !GENDERED.test(JSON.stringify(e)));
A("the entry never names the banned member", !!e && !/2026-10-05|since October/i.test(JSON.stringify(e)));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
