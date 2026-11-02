/* v4.41 (2026-11-01): "member-facing text written by Postgres functions still uses gendered pronouns." The Season 1
   playoff seeding ended the GM and AGM seats with "He keeps his roster spot and his position; his cap hit is now $X
   (Rule 2.6)." The sweep found 55 such sentences in 34 public functions; each is patched by an exact anchor asserted
   to match once, and rewritten in the neutral register (they, them, their, or "the player").
   The SQL ran as a rolled-back rehearsal on production before it was applied (results recorded in the SQL file).
   Run: node tools/neutral-pronouns-db-v441.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const FILE = "2026-11-01-neutral-pronouns-db-v441.sql";
const sql = R("sql/" + FILE);
const body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|himself|she|her|hers|herself)\b/i;

/* the patch rows: (ord, 'public.fn(args)', $a$old$a$, $b$new$b$) */
const rows = [...body.matchAll(/\((\d+), '([^']+)',\s*\$a\$([\s\S]*?)\$a\$,\s*\$b\$([\s\S]*?)\$b\$\)/g)]
  .map((m) => ({ ord: +m[1], fn: m[2], a: m[3], b: m[4] }));
const row = (ord) => rows.find((r) => r.ord === ord) || { a: "", b: "" };

console.log("# the patch list");
A("55 sentences, numbered 1 to 55", rows.length === 55 && rows.every((r, i) => r.ord === i + 1), rows.length);
A("across 34 functions", new Set(rows.map((r) => r.fn)).size === 34, new Set(rows.map((r) => r.fn)).size);
A("every old sentence had a gendered pronoun or a dash to remove", rows.every((r) => GENDERED.test(r.a) || DASHES.test(r.a)),
  rows.filter((r) => !(GENDERED.test(r.a) || DASHES.test(r.a))).map((r) => r.ord).join(","));
A("no new sentence says he, his, him, she or her", rows.every((r) => !GENDERED.test(r.b)),
  rows.filter((r) => GENDERED.test(r.b)).map((r) => r.ord).join(","));
A("no new sentence carries an em or en dash", rows.every((r) => !DASHES.test(r.b)),
  rows.filter((r) => DASHES.test(r.b)).map((r) => r.ord).join(","));
A("every row changes something", rows.every((r) => r.a !== r.b));
A("anchors are unique within each function", rows.every((r) => rows.filter((x) => x.fn === r.fn && x.a === r.a).length === 1));

console.log("\n# the sentences members saw");
A("the seat that ends: They keep their roster spot and their position; their cap hit is now $",
  row(1).fn === "public._set_team_seat(uuid,text,uuid,text)" &&
  row(1).b === "'||v_seat||'. They keep their roster spot and their position; their cap hit is now $'||");
A("a served suspension: <gamertag> has served their suspension",
  row(2).fn === "public.mark_served_suspensions()" && row(2).b === "'A player')||' has served their suspension',");
A("...and says what Rule 7.2 says (scheduled again, waiver bar lifted), not the lock v4.25 removed",
  row(3).b === "'They may be scheduled again, and the bar on waiving them is lifted (Rule 7.2).'" && /moved/.test(row(3).a));
A("contract offers: They can accept, counter or decline (offer_extension and offer_free_agent)",
  [44, 47].every((o) => row(o).b === "'. They can accept, counter or decline.'") &&
  row(44).fn.startsWith("public.offer_extension(") && row(47).fn.startsWith("public.offer_free_agent("));
A("the Rule 2.4 waiver refusal no longer says traded (its only caller is waive_player)",
  /before they can be waived\.'$/.test(row(26).b) && !/traded/.test(row(26).b));
A("the trade-arrival notice says Call them for one player or several", row(10).b === "(Rule 2.1). Call them'");
A("the lineup-lock notice keeps the club and the player apart: that club's roster, their own position",
  /on that club''s roster or in its camp and plays their own position/.test(row(15).b));

console.log("\n# the method (CLAUDE.md, database change protocol step 3)");
A("each anchor must match its live definition exactly once", /if n <> 1 then raise exception 'v4\.41: % anchor % found % times'/.test(body));
A("patched from pg_get_functiondef and re-created in place", /v_def := pg_get_functiondef\(f::regprocedure\)/.test(body) && /execute v_def;/.test(body));
A("the patch counts the 34 functions it re-created", /if v_fns <> 34 then raise exception/.test(body));
A("self-check: every old sentence gone and every new one present",
  /position\(r\.a in v_def\) > 0 then raise exception/.test(body) && /position\(r\.b in v_def\) = 0 then raise exception/.test(body));
A("self-check: no gendered line outside comments, one roster-reason key allowed in notify_roster_remove",
  /x ~\* '\\m\(he\|his\|him\|himself\|she\|her\|hers\|herself\)\\M'/.test(body) &&
  /k := case when r\.fn = 'public\.notify_roster_remove\(\)' then 1 else 0 end;/.test(body));
A("the patch table lives only for the transaction", /create temp table _v441_patch .* on commit drop;/.test(body));
A("rehearsal recorded", /Result: REHEARSAL OK: T1 T2 T3 T4\./.test(sql));
A("applied, and the grant audit returned zero rows",
  /Applied as migration v441_neutral_pronouns_db; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
A("the record names nothing of unpublished work", !/abandon/i.test(sql));

console.log("\n# no later record brings a retired sentence back");
{
  const later = fs.readdirSync(path.join(ROOT, "sql")).filter((f) => f.endsWith(".sql") && f > FILE);
  const back = [];
  for (const f of later) { const t = R("sql/" + f); for (const r of rows) if (t.includes(r.a)) back.push(f + " #" + r.ord); }
  A("no sql/ record after this one holds an old sentence (" + later.length + " later records)", back.length === 0, back.join(", "));
}

console.log("\n# the rulebook and the changelog");
{
  const CG = {}; new Function("CG", R("src/live/part3_content.js"))(CG);
  const rb = CG.CONTENT.rulebook;
  const e = rb.changelog.find((c) => c.version === "4.41") || {};   /* by version: a later release takes changelog[0] */
  A("the changelog has its 4.41 entry", typeof e.summary === "string" && Array.isArray(e.items) && e.items.length > 0);
  A("...dated 2026-11-01", e.dateIso === "2026-11-01", e.dateIso);
  const quoted = (e.items || []).join(" ");
  A("...quoting the new seat sentence", /They keep their roster spot and their position/.test(quoted));
  A("...with no dashes", !DASHES.test(JSON.stringify(e)));
  A("...and no gendered pronoun", !GENDERED.test(JSON.stringify(e)));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
