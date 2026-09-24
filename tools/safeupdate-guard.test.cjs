/* v3.01 — no database function may carry an unqualified UPDATE or DELETE.
 *
 * Game night 1: box scores imported and then no game could be marked final. The failing request was
 *   PATCH games?id=eq.… -> 400 {"code":"21000","message":"DELETE requires a WHERE clause"}
 * That is pg_safeupdate, which Supabase preloads on the API roles' sessions. public.check_playoff_
 * clinches ran `delete from _clinch_calc;` inside a trigger on games, so every attempt to final a
 * game through PostgREST aborted, leaving the stats written and the game still 'scheduled'.
 *
 * It survived every rehearsal because a rehearsal is a direct SQL connection, which does NOT
 * preload the extension. "It works in the SQL editor" is not evidence about the API path.
 *
 * This file cannot reach the database, so it holds the two things the repo owns: the decision
 * record, and the sweep a future migration has to keep passing.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}

const rec = R("sql/2026-09-23-safeupdate-blocked-finals.sql");
/* the record is a wrapped SQL comment block, so prose runs across lines and `-- ` prefixes.
   Match against a flattened copy; a pin that depends on where a line happens to wrap is a pin
   that fails on the next reflow. */
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

console.log("\n— the decision record");
{
  A("it names the symptom the commissioner saw", /notifications to add them manually/i.test(rec));
  A("it quotes the actual error", /"code":"21000"/.test(rec) && /DELETE requires a WHERE clause/.test(rec));
  A("it names pg_safeupdate as the cause", /pg_safeupdate/.test(rec));
  A("...and that Supabase preloads it on the API roles only", /preloads on the API roles' sessions/.test(flat));
  A("it explains the half-written state that resulted",
    /stats present, game still 'scheduled'/.test(rec));
  A("...and why that produced manual-entry alerts",
    /archives the EA payload as 'unmatched' BEFORE filing/.test(rec) && /Statistics desk/.test(rec));
  A("it lists all three unqualified writes", (rec.match(/_clinch_calc|role_conflict_exemptions/g) || []).length >= 4);
  A("it records the lesson about rehearsing on the wrong connection",
    /a rehearsal on a direct SQL connection does not exercise the API role's session settings/.test(flat));
  A("it says a temp table is not an exemption", /A temp table is not an exemption/.test(rec));
  A("it carries the sweep to re-run after any migration", /select p\.proname/.test(rec) && /prosrc ~\*/.test(rec));
}

console.log("\n— the repo's own SQL records carry no unqualified write");
{
  /* the sql/ directory is the record of what was applied; an unqualified write recorded here
     would be copied back into the database by anyone rebuilding from it */
  const dir = path.join(__dirname, "..", "sql");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  A("there are SQL records to check", files.length > 0, String(files.length));
  const offenders = [];
  for (const f of files) {
    const body = fs.readFileSync(path.join(dir, f), "utf8")
      .split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");   // comments describe the bug on purpose
    const re = /\bdelete\s+from\s+[a-zA-Z_."]+\s*;/gi;
    let m;
    while ((m = re.exec(body))) offenders.push(`${f}: ${m[0].trim()}`);
  }
  A("no executable line in sql/ deletes without a WHERE", offenders.length === 0, offenders.join(" | "));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
