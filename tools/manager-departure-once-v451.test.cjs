/* v4.51: the league office is told ONCE when a club manager leaves the league Discord. node tools/manager-departure-once-v451.test.cjs
   Commissioner, 2026-11-13: "Why has the website sent me the same notification multiple times of someone leaving the
   league? I only need one notification that." sweep_roster_departures runs every discord-sync tick; a seat holder wrote no
   notice row, so every tick told the office again (416 copies for one departure on Oct 1). Pins the SQL record (the
   anchored patch, the once-per-departure mark, the backfill, the self-checks, the rehearsal) and the changelog entry. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");

console.log("1. The database record");
const sql = R("sql/2026-11-14-manager-departure-once-v451.sql");
const part = (tag) => { const m = sql.match(new RegExp("\\$" + tag + "\\$([\\s\\S]*?)\\$" + tag + "\\$")); return m ? m[1] : ""; };
const oldBranch = part("old"), newBranch = part("new");
A("the header quotes the commissioner", /"Why has the website sent me the same notification multiple times of someone leaving the\n-- league\? I only need one notification that\."/.test(sql));
A("the patch anchors on the whole v4.44 manager branch", oldBranch.length > 0
  && R("sql/2026-11-03-no-departure-suspension-v444.sql").indexOf(oldBranch) >= 0 && /return next; continue;\n      end if;$/.test(oldBranch));
A("...asserts it matches exactly once, then replaces the live definition (grants kept)",
  /if v_n <> 1 then raise exception 'v4\.51 patch: the manager branch matched % times, expected exactly 1', v_n; end if;/.test(sql)
  && /execute replace\(v_def, v_old, v_new\);/.test(sql) && !/drop function/i.test(sql));
A("the office is told only when no mark is newer than the member's last sighting",
  /if not exists \(select 1 from public\.admin_audit a\s+where a\.action = 'manager_departure_flagged' and a\.target_type = 'profile'\s+and a\.target_id = r\.profile_id::text\s+and a\.created_at > coalesce\(\(select max\(g\.last_seen\) from public\.guild_members g\s+where g\.profile_id = r\.profile_id\), '-infinity'::timestamptz\)\) then/.test(newBranch));
A("...the same notice as before, then the mark", /perform public\.notify_department\('operations','flag','A club manager has left the Discord',/.test(newBranch)
  && /perform public\.log_admin_action\('manager_departure_flagged','profile',r\.profile_id::text,\s+jsonb_build_object\('player',r\.gt,'club',r\.tc\)\);/.test(newBranch)
  && newBranch.indexOf("notify_department") < newBranch.indexOf("log_admin_action"));
A("...and a seat holder is still never noticed or removed (the branch always continues)",
  /return next;\n        end if;\n        continue;\n      end if;$/.test(newBranch) && !/roster_departure_notices|club_notify/.test(newBranch));
A("the branch carries its v4.51 note", /v4\.51 \(commissioner, 2026-11-13\)/.test(newBranch));
A("the backfill marks only a manager already told about the departure under way",
  /insert into public\.admin_audit\(action, target_type, target_id, detail\)\nselect 'manager_departure_flagged', 'profile', p\.id::text,/.test(sql)
  && /'backfill', true/.test(sql) && /n\.created_at > coalesce\(\(select max\(g\.last_seen\)/.test(sql));
A("the self-checks raise on a second function, the old branch, or a changed grant",
  ["expected exactly one sweep_roster_departures", "the manager branch is not the once-per-departure form", "sweep_roster_departures grants changed"].every((t) => sql.indexOf(t) >= 0));
A("the rehearsal and the apply are recorded", /Result: REHEARSAL OK: T1 T2 T3 T4/.test(sql)
  && /Applied as migration v451_manager_departure_once; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
A("the record has no dashes", !DASHES.test(sql));

console.log("\n2. The changelog");
{
  const CG = {}; new Function("CG", R("src/live/part3_content.js"))(CG);
  const e = CG.CONTENT.rulebook.changelog.find((c) => c.version === "4.51") || {};   /* by version: a later release takes changelog[0] */
  const t = JSON.stringify(e);
  A("the changelog has its 4.51 entry", e.dateIso === "2026-11-14" && typeof e.summary === "string" && Array.isArray(e.items) && e.items.length > 0);
  A("...saying the office hears once per departure", /once/i.test(t) && /Rule 1\.1/.test(t) && /manager/i.test(t));
  A("...with no dashes, no gendered pronouns, no code identifiers",
    !DASHES.test(t) && !/ - /.test(t) && !/\b(he|his|him|she|her|hers)\b/i.test(t) && !/admin_audit|sweep_|notify_|last_seen|discord-sync/.test(t));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
