/* v463 (DRAFT, applied at the flip): the application waitlist leaves the database.
   node tools/waitlist-dropped-v463.test.cjs
   Commissioner, 2026-11-23: "remove the waitlist entirely from the website and rulebook." The site and the book dropped it
   in v4.58; this pins the flip record (refuse while anything is waitlisted, archive, drop the three functions, close the
   status), its reverse (the 2026-11-24 definitions byte for byte: the md5s are recomputed here from the file), the
   rehearsal that runs both, and that no code still calls a waitlist function. */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;

const REC = "sql/2026-11-24-waitlist-dropped-v463.sql";
const REV = REC.replace(/\.sql$/, ".reverse.sql");
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC), rev = R(REV), reh = R(REH);
const MD5 = { "waitlist_admit(text,uuid)": "7bec84439da5ab2bd27a47cde68744c7", "waitlist_application(text,uuid)": "21fbfa893e581923d8daf7ae51201558",
              "waitlist_remove(text,uuid,text)": "779b4cffffc9aee816af2fac25f1ff2b" };
const OLD_CHECK = "CHECK ((status = ANY (ARRAY[''pending''::text, ''approved''::text, ''denied''::text, ''waitlisted''::text, ''withdrawn''::text])))";
const NEW_CHECK = "CHECK ((status = ANY (ARRAY[''pending''::text, ''approved''::text, ''denied''::text, ''withdrawn''::text])))";

console.log("1. The record");
A("a DRAFT for the flip, quoting the ruling", /^-- v463 \(DRAFT, 2026-11-24; apply at the flip, once the Season 2 site is live\)/.test(sql)
  && /"remove the waitlist entirely from the website and rulebook\."/.test(sql));
A("it records what still calls or references each object, with the row counts",
  /No other function calls\n--    them/.test(sql) && /Rows: 0\n--    waitlisted owner applications of 32 and 0 waitlisted staff applications of 12/.test(sql)
  && /waitlisted_at is set on 3 denied\n--    owner applications/.test(sql) && /guard_owner_app_hold, stamp_app_filed_at,\n--    guard_app_role_conflict, guard_app_decision, guard_app_insert, withdraw_owner_application and\n--    withdraw_staff_application/.test(sql));
A("it refuses to run while any application is waitlisted, naming the counts",
  /raise exception 'v463 waitlist: % owner and % staff applications are still waitlisted\. Decide each one first/.test(sql));
A("it refuses to run if a function or a status check changed since the reverse was written (the same md5s as the reverse)",
  Object.entries(MD5).every(([k, m]) => sql.includes("('public." + k + "', '" + m + "')") && rev.includes("('public." + k + "', '" + m + "')"))
  && sql.split(OLD_CHECK).length === 3 && /so the reverse would not put it back exactly/.test(sql));
A("it archives the three full definitions in admin_audit before the drop",
  /select public\.log_admin_action\('waitlist_dropped', 'database', 'application waitlist', jsonb_build_object\(/.test(sql)
  && Object.keys(MD5).every((k) => sql.includes("'" + k + "', pg_get_functiondef('public." + k + "'::regprocedure)"))
  && sql.indexOf("log_admin_action('waitlist_dropped'") < sql.indexOf("drop function"));
A("it drops exactly the three functions, without CASCADE, and no table",
  (sql.match(/^drop function public\.waitlist_(admit\(text, uuid\)|application\(text, uuid\)|remove\(text, uuid, text\));$/gm) || []).length === 3
  && !/cascade/i.test(sql.replace(/--[^\n]*/g, "")) && !/drop table|drop column|truncate/i.test(sql.replace(/--[^\n]*/g, "")));
A("both status checks lose 'waitlisted', and the self-check reads them back", /check \(status = any \(array\['pending'::text, 'approved'::text, 'denied'::text, 'withdrawn'::text\]\)\);\nalter table public\.staff_applications/.test(sql)
  && sql.split(NEW_CHECK).length === 3);
A("self-checks: nothing named waitlist_ is left, nothing calls one, the archive row is there",
  /like 'waitlist\\_%'/.test(sql) && /p\.prosrc ~ 'waitlist_\(admit\|application\|remove\)\\s\*\\\('/.test(sql) && /the archive row is missing/.test(sql));
A("the kept columns and dead branches carry a shortcut marker", /^-- shortcut: dead 'waitlisted' branches stay in seven application functions, remove them when each is next rewritten$/m.test(sql));
A("nothing posts or notifies", !/discord_http_post|net\.http_post|notify_|create_notification|_announce_once|club_notify|discord_dms/.test(sql.replace(/--[^\n]*/g, "")));
A("the record's own prose keeps the house rules", !DASHES.test(sql) && !GENDERED.test(sql) && !/ - /.test((sql.match(/--[^\n]*/g) || []).join("\n")));
A("the rehearsal result has a place to go", /\n\/\* REHEARSAL: /.test(sql));

console.log("\n2. The reverse");
for (const [k, m] of Object.entries(MD5)) {
  const name = k.split("(")[0], i = rev.indexOf("CREATE OR REPLACE FUNCTION public." + name + "(");
  const j = rev.indexOf("$function$\n;", rev.indexOf("AS $function$", i) + 13);
  const def = i >= 0 && j > i ? rev.slice(i, j + "$function$\n".length) : "";
  A(name + " comes back byte for byte (md5 of the definition in the file equals production's on 2026-11-24)",
    crypto.createHash("md5").update(def, "utf8").digest("hex") === m);
}
A("it refuses to run while a waitlist function still exists", /a waitlist function still exists, so the drop is not applied and there is nothing to reverse/.test(rev));
A("the comments come back, and the grants: authenticated and service_role, never anon or PUBLIC",
  /comment on function public\.waitlist_admit\(text, uuid\) is 'Review Board admits a waitlisted applicant\./.test(rev)
  && /comment on function public\.waitlist_remove\(text, uuid, text\) is 'Review Board takes a waitlisted applicant off the list/.test(rev)
  && (rev.match(/^revoke all on function public\.waitlist_[a-z]+\([a-z, ]+\) from public, anon, authenticated, service_role;$/gm) || []).length === 3
  && (rev.match(/^grant execute on function public\.waitlist_[a-z]+\([a-z, ]+\) to authenticated, service_role;$/gm) || []).length === 3);
A("both status checks come back with 'waitlisted', and the self-check compares them and the md5s",
  /check \(status = any \(array\['pending'::text, 'approved'::text, 'denied'::text, 'waitlisted'::text, 'withdrawn'::text\]\)\);\nalter table public\.staff_applications/.test(rev)
  && rev.split(OLD_CHECK).length === 3 && /is not as it stood on 2026-11-24/.test(rev));
A("the one em dash in it is waitlist_admit's old refusal, carried as it was and said so",
  (rev.match(DASHES) || []).length === 1 && /so the\n-- one em dash in waitlist_admit's refusal stays/.test(rev));

console.log("\n3. The rehearsal");
const embedded = (reh.match(/-- >>> record text: [^\n]*\n([\s\S]*?)-- <<< record text\n/) || [])[1] || "";
const embeddedRev = (reh.match(/-- >>> reverse text: [^\n]*\n([\s\S]*?)-- <<< reverse text\n/) || [])[1] || "";
A("it carries the record byte for byte up to its REHEARSAL note, then the reverse byte for byte",
  sql.indexOf("\n/* REHEARSAL") > 0 && embedded === sql.slice(0, sql.indexOf("\n/* REHEARSAL") + 1) && embeddedRev === rev
  && reh.indexOf("-- <<< record text") < reh.indexOf("-- >>> reverse text"));
/* a bare "commit;" or "end;" line ends the transaction; waitlist_application's own body ends "end;$function$", which does not */
A("one transaction: begins once, never commits, ends in the uncaught REHEARSAL OK",
  (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;\s*$/im.test(reh) && /  raise exception 'REHEARSAL OK: T1 T2 T3 /.test(reh)
  && reh.trim().endsWith("end $t3$;"));
A("T1 the door is gone for a commissioner through the API role; T2 the archive matches; T3 everything is as before",
  /exception when undefined_function then/.test(reh) && !/exception when others/.test(reh) && /T2 failed: the archived definition of % is not the one the reverse recreates/.test(reh)
  && /T3 failed: the functions, grants or comments differ from before the record/.test(reh) && /T3 failed: the status checks differ from before the record/.test(reh));
A("it names its lock and when to run it", /hold an exclusive lock on owner_applications and\n-- staff_applications until the rollback/.test(reh));

console.log("\n4. Nothing still calls the waitlist");
const files = [];
const walk = (d) => { if (!fs.existsSync(path.join(root, d))) return; for (const f of fs.readdirSync(path.join(root, d))) { const p = d + "/" + f;
  if (fs.statSync(path.join(root, p)).isDirectory()) { if (f !== "node_modules") walk(p); } else if (/\.(js|mjs|cjs|ts|html)$/.test(f)) files.push(p); } };
["src", "bot", "jobs", "edge", "netlify/functions", "shared"].forEach(walk);
const callers = files.filter((f) => /rpc\(\s*["'`]waitlist_|waitlist_(admit|application|remove)\s*\(/.test(R(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")));
A("no site, bot, job, Edge or Netlify code calls a waitlist function (" + files.length + " files read)", files.length > 20 && callers.length === 0, callers.join(", "));
A("the grant audit's client RPC list names none of them", !/waitlist_/.test(R("tools/sql/grant-audit.sql")));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
