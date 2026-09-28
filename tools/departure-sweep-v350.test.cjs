/* v3.50: the Rule 1.1 departure sweep runs again, and the club-room writers are closed. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 200))); } };
const rec = R("sql/2026-09-28-departure-sweep-and-notice-grants.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const sync = R("netlify/functions/discord-sync.js");
const ga = R("tools/sql/grant-audit.sql");

console.log("\n— the record explains the failure");
A("names the date it stopped", /dead since 2026-09-25 23:49 ET/i.test(flat));
A("names the mechanism", /closed notice on the \(profile_id, season_id\) primary key/.test(flat) && /23505/.test(flat));
A("reopen with a fresh window", /REOPENS the notice with a fresh 24-hour window \(ON CONFLICT DO UPDATE\)/.test(flat));
A("per-row savepoints", /Every row runs in its own savepoint/.test(flat));
A("the latent second abort is recorded", /touched no roster spot/.test(flat) && /closes the notice and leaves the sign-up to Rule 1\.1\.4/.test(flat));
A("the rehearsal is recorded", /3 notices queued, exactly the three players still out/.test(flat));

console.log("\n— the security revoke");
for (const f of ["club_notify(uuid,text,text,text,uuid,text,text,text,boolean)", "_post_lineup_notice(", "_notify_lineup_pulled(", "_notify_lineup_moves("])
  A("revokes " + f.split("(")[0] + " from public, anon and authenticated", new RegExp("revoke execute on function public\\." + f.replace(/[()]/g, (m) => "\\" + m).replace(/\\\($/, "\\(") + "[^;]*from public, anon, authenticated").test(rec));
for (const f of ["offer_extension", "offer_free_agent", "request_extension", "reverse_trade", "waitlist_admit", "waitlist_remove"])
  A("revokes " + f + " from anon and keeps authenticated", new RegExp("revoke execute on function public\\." + f + "\\([^;]*from public, anon;").test(rec) && new RegExp("grant  execute on function public\\." + f + "\\([^;]*to authenticated, service_role;").test(rec));
A("explains why grant-audit missed it", /DEFAULT for the actor column/.test(flat) && /write THROUGH club_notify/.test(flat));

console.log("\n— grant-audit learned both blind spots");
A("check 5 lists the internal writers by name", /internal-writer-callable/.test(ga) && /'club_notify','_post_lineup_notice','_notify_lineup_pulled','_notify_lineup_moves'/.test(ga));
A("check 6 refuses auth.uid() as a gate", /notice-writer-caller-without-gate/.test(ga) && !/\(auth\\\.uid\|/.test(ga.split("-- 6)")[1] || ""));

console.log("\n— discord-sync fails loudly on a bad row");
A("error rows are pushed to sum.errors", /const bad = acted\.filter\(\(a\) => a\.action === "error"\);/.test(sync) && /if \(bad\.length\) sum\.errors\.push\(\{ rosterDepartures:/.test(sync));

console.log("\n— the book");
const rb = JSON.parse((function(){ const c = R("src/live/part3_content.js"); return c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1); })()).rulebook;
const p115 = rb.chapters.flatMap((c) => c.sections).find((s) => s.id === "1.1").paragraphs[4];
A("1.1.5 says each departure starts its own window", /Each departure starts its own window: a player who rejoins and later leaves again is noticed again/.test(p115));
A("v3.50 is in the changelog", rb.changelog.some((e) => e.version === "3.50"));
A("no dash as punctuation in the new prose", !/—| - /.test(JSON.stringify(rb.changelog.find((e) => e.version === "3.50"))));
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
