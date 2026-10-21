/* v4.26 (2026-10-21). Audit F-2-18 (docs/audits/2026-09-27-rulebook-audit.md, Rule 2.2), raised again by the v4.25
   review: the RLS policy "gm deletes own team roster" let an Owner, GM or AGM delete their club's roster row straight
   through the API, skipping waive_player, so the release reached neither the transaction log nor the waived_at stamp.
   anon and authenticated also held every table privilege on roster_spots, TRUNCATE (which RLS never sees) included.
   After: the policy is dropped; anon may only read; authenticated may read, insert (the commissioner's assign) and
   update on_block (the trade block), nothing else; grant audit check 9 keeps it that way. The SQL ran as a rolled-back
   rehearsal on production before it was applied (results recorded in the SQL file).
   Run: node tools/roster-delete-door-v426.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");

console.log("1. The database record");
const sql = R("sql/2026-10-21-roster-delete-door-v426.sql"), body = strip(sql);
A("the club DELETE policy is dropped (plain DROP, so a missing policy fails loud)", /^drop policy "gm deletes own team roster" on public\.roster_spots;$/m.test(body));
A("every API-role privilege is revoked first", /^revoke all on table public\.roster_spots from public, anon, authenticated;$/m.test(body));
A("...then only what the site uses comes back: SELECT for both, INSERT and UPDATE (on_block) for members",
  /^grant select on table public\.roster_spots to anon, authenticated;$/m.test(body) &&
  /^grant insert on table public\.roster_spots to authenticated;$/m.test(body) &&
  /^grant update \(on_block\) on table public\.roster_spots to authenticated;$/m.test(body));
{
  const grants = body.match(/^grant [^;]*roster_spots[^;]*;$/gm) || [];
  A("...and no other grant on roster_spots", grants.length === 3, grants.join(" | "));
}
A("the self-check raises on a DELETE policy, a non-commissioner ALL policy, a missing or extra privilege, or a wider UPDATE",
  /v4\.26 check: a DELETE policy still exists on roster_spots/.test(body) &&
  /v4\.26 check: an ALL policy on roster_spots reaches someone other than a commissioner/.test(body) &&
  /v4\.26 check: a privilege the site uses is missing/.test(body) &&
  /v4\.26 check: an API role still holds a privilege the site does not use/.test(body) &&
  /v4\.26 check: authenticated may update % \(expected on_block only\)/.test(body) &&
  /v4\.26 check: service_role lost DELETE/.test(body));
A("the self-check covers TRUNCATE, REFERENCES and TRIGGER for both API roles",
  ["TRUNCATE", "REFERENCES", "TRIGGER", "DELETE"].every((p) => ["anon", "authenticated"].every((r) => body.includes("has_table_privilege('" + r + "', 'public.roster_spots', '" + p + "')"))));
A("the rehearsal is recorded with every tag and its result",
  /one transaction on the live database with the migration and the \$chk\$ block, rolled back by a\s+closing raise/.test(sql) &&
  /Result: REHEARSAL OK: T0 T1 T2 T3\(Pip\) T4\(168\) T5 T6 T7\(#11\)\./.test(sql) &&
  /as the NYI Owner \(set local role authenticated, their JWT claims\) a direct DELETE/.test(sql) &&
  /affects zero rows \(no DELETE policy is left\)/.test(sql) &&
  /waive_player\(Pip\) as the Owner removes the row, stamps waived_at/.test(sql));
A("applied and audited", /Applied as migration v426_roster_delete_door; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));

console.log("\n2. No club DELETE policy on roster_spots in any record (the newest statement wins)");
{
  const files = fs.readdirSync(path.join(ROOT, "sql")).filter((f) => /\.sql$/.test(f)).sort();
  const live = {};   /* policy name -> { file, cmd, using } as the records leave it */
  files.forEach((f) => {
    const s = strip(R("sql/" + f));
    const re = /(create|drop)\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+(?:public\.)?roster_spots\b([^;]*);/gi;
    let m;
    while ((m = re.exec(s))) {
      if (m[1].toLowerCase() === "drop") { delete live[m[2]]; continue; }
      const cmd = ((m[3].match(/\bfor\s+(select|insert|update|delete|all)\b/i) || [])[1] || "all").toLowerCase();
      live[m[2]] = { file: f, cmd: cmd, using: (m[3].match(/\busing\s*\(([\s\S]*)\)/i) || [])[1] || "" };
    }
  });
  const bad = Object.keys(live).filter((k) => live[k].cmd === "delete" ||
    (live[k].cmd === "all" && !/^\s*\(?\s*(public\.)?is_commissioner\(\)\s*\)?\s*$/.test(live[k].using)));
  A("no record leaves a DELETE policy (or a non-commissioner ALL policy) on roster_spots", bad.length === 0, bad.map((k) => k + " in " + live[k].file).join(", "));
  A("the v4.26 record is where the club DELETE policy ends", !("gm deletes own team roster" in live) && files.includes("2026-10-21-roster-delete-door-v426.sql"));
  const later = files.filter((f) => f > "2026-10-21-roster-delete-door-v426.sql")
    .filter((f) => /grant\s+(all|delete|truncate)[^;]*on\s+(table\s+)?(public\.)?roster_spots[^;]*to[^;]*(anon|authenticated|public)/i.test(strip(R("sql/" + f))));
  A("no later record grants DELETE, TRUNCATE or ALL on roster_spots back to an API role", later.length === 0, later.join(", "));
}

console.log("\n3. The grant audit keeps the door shut");
{
  const audit = R("tools/sql/grant-audit.sql");
  const i = audit.indexOf("-- 9) (v4.26)");
  const c9 = i < 0 ? "" : audit.slice(i);
  A("check 9 exists and names the record", i > 0 && /sql\/2026-10-21-roster-delete-door-v426\.sql/.test(c9));
  A("...returns a row for a DELETE policy on roster_spots", /from pg_policies where schemaname = 'public' and tablename = 'roster_spots' and cmd = 'DELETE'/.test(c9));
  A("...and for DELETE or TRUNCATE held by anon or authenticated",
    /unnest\(array\['anon','authenticated'\]\) r\(role\), unnest\(array\['DELETE','TRUNCATE'\]\) pv\(priv\)/.test(c9) &&
    /where has_table_privilege\(r\.role, 'public\.roster_spots', pv\.priv\);\s*$/.test(c9));
  A("check 9 is joined to the checks above it with union all", /\)\)\s*\nunion all\s*\n-- 9\) \(v4\.26\)/.test(audit));
}

console.log("\n4. The client asks only for what the grants allow");
{
  const dirs = ["src/live", "bot", "netlify/functions", "jobs", "edge", "shared"];
  const srcs = [];
  dirs.forEach((d) => { const p = path.join(ROOT, d); if (!fs.existsSync(p)) return;
    fs.readdirSync(p).filter((f) => /\.(js|mjs|cjs)$/.test(f)).forEach((f) => srcs.push([d + "/" + f, R(d + "/" + f)])); });
  const hits = (re) => srcs.filter(([, s]) => re.test(s)).map(([f]) => f);
  A("nothing deletes or upserts a roster row directly", hits(/roster_spots["']\)\s*\.\s*(delete|upsert)\s*\(/).length === 0, hits(/roster_spots["']\)\s*\.\s*(delete|upsert)\s*\(/).join(", "));
  const live = R("src/live/part_live.js");
  const ups = live.match(/from\("roster_spots"\)\.update\(\{([^}]*)\}\)/g) || [];
  A("every direct roster update writes on_block and nothing else (the one column members may update)",
    ups.length >= 1 && ups.every((u) => /^from\("roster_spots"\)\.update\(\{\s*on_block\s*:[^,}]*\}\)$/.test(u)), ups.join(" | "));
  A("...and no other file updates roster rows directly", hits(/roster_spots["']\)\s*\.\s*update\s*\(/).every((f) => f === "src/live/part_live.js"));
  const ins = live.indexOf('from("roster_spots").insert(');
  A("the one direct insert is the commissioner's assign (RLS: commissioner writes rosters)",
    ins > live.indexOf("CG.assignRegistration = async function") && live.indexOf("CG.assignRegistration = async function") > 0 &&
    live.indexOf('from("roster_spots").insert(', ins + 1) < 0 && hits(/roster_spots["']\)\s*\.\s*insert\s*\(/).every((f) => f === "src/live/part_live.js"));
  A("the trade-block write still treats zero rows as a refusal", /from\("roster_spots"\)\.update\(\{ on_block: !!on \}\)\s*\.eq\("season_id", CG\.SEASON\.id\)\.eq\("profile_id", pid\)\.select\("id"\)/.test(live) && /0 rows \+ no error = RLS refusal/.test(live));
}

console.log("\n5. The audit record and the changelog");
{
  A("F-2-18 is marked closed in the rulebook audit", /\*\*F-2-18\*\*[\s\S]*?- \*Closed:\* v4\.26 \(2026-10-21\)\. The policy is dropped/.test(R("docs/audits/2026-09-27-rulebook-audit.md")));
  const CG = {}; new Function("CG", R("src/live/part3_content.js"))(CG);
  const rb = CG.CONTENT.rulebook;
  const e = rb.changelog.find((c) => c.version === "4.26") || {};   /* by version: a later release takes changelog[0] */
  const txt = JSON.stringify(e);
  A("the changelog has its 4.26 entry", e.dateIso === "2026-10-21" && typeof e.summary === "string" && Array.isArray(e.items) && e.items.length > 0);
  A("...that says a release is recorded through the waiver (Rule 2.2)", /transaction log/.test(txt) && /Rule 2\.2/.test(txt) && /waive/i.test(txt));
  A("...with no dashes and no gendered pronouns", !DASHES.test(txt) && !/ - /.test(txt) && !/\b(he|his|him|she|her|hers)\b/i.test(txt));
  A("...and no code identifiers", !/roster_spots|waive_player|waived_at|on_block|anon\b|authenticated|TRUNCATE|RLS|policy "/.test(txt));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
