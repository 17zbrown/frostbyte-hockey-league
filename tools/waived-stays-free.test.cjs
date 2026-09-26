/* v3.45 — no automatic placement hands a waived player back to a club. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const rec = R("sql/2026-09-26-waived-player-stays-free.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const ops = R("netlify/functions/discord-ops.js"), sync = R("netlify/functions/discord-sync.js");

console.log("\n— the event is on the record to the second");
{
  A("it quotes the question", /jglehan29 was randomly placed on the redwings just now, after they waived them about 5 minutes ago/.test(flat));
  A("the waiver time is recorded", /6:05:46 PM ET\s+DET waived jglehan29/.test(flat));
  A("the re-placement time is recorded", /6:10:00 PM ET\s+auto_assign_latecomers ran and placed him back/.test(flat));
  A("...and the gap named", /Four minutes and fourteen seconds later/.test(flat));
}

console.log("\n— the cause: one guard, four callers");
{
  A("v3.06's single guard is quoted", /and sr\.waived_at is null/.test(flat) && /a waived player is a free agent, not an undrafted one/.test(flat));
  A("all four callers are listed with their status",
    /trg_autoassign_new_reg\s+no check/.test(flat) && /preseason_random_assign\s+no check/.test(flat) &&
    /auto_assign_latecomers\s+NO CHECK, and this is the one that ran/.test(flat) &&
    /distribute_unproven_rookies\s+has it/.test(flat));
  A("...and why a waived player looks like a late sign-up",
    /the waiver deleted his spot and ended his contract, and his registration stays 'pending'/.test(flat));
}

console.log("\n— the fix goes in the placer");
{
  A("it is stated as one definition", /The guard now sits in _assign_reg_random itself/.test(flat));
  A("...and why not in the sweep", /would have repeated the v3\.06 mistake in a different place/.test(flat));
  A("the rule is cited", /A club signs a waived player itself \(Rule 2\.2\)\. The league office does not do it for them/.test(flat));
}

console.log("\n— the rehearsal replayed the real event");
{
  A("it put him back in the state the waiver left", /jglehan29's spot deleted to put him back in the state the waiver left him/.test(flat));
  A("the placer itself was checked", /_assign_reg_random returned false for him directly/.test(flat));
  A("the sweep that did it was re-run", /auto_assign_latecomers\(force\) ran and left him with no roster spot/.test(flat));
  A("...and the guard was proved narrow", /the guard stops a waived player and nothing else/.test(flat));
  A("...with the reason that matters", /A guard that also froze ordinary placement would be a worse bug/.test(flat));
}

console.log("\n— blast radius, and what was deliberately left");
{
  A("the survey is recorded", /Every registration in the season with waived_at set and a roster spot created AFTER it/.test(flat));
  A("...with its answer", /jglehan29 alone/.test(flat));
  A("his spot is left for the commissioner", /removing a player from a club is his call and not a cleanup/.test(flat));
}

console.log("\n— Toine, settled by reading the channels");
{
  A("the trade-block line is quoted with its timestamp", /Sep 25 11:38:43 PM\s+"UTA have listed Toine on the trade block"/.test(flat));
  A("the transactions line is quoted with its timestamp", /Sep 26\s+2:59:38 PM\s+"SEA traded Jonsyy- to UTA for Toine, I WeaponX I"/.test(flat));
  A("...and the conclusion drawn", /Utah listed him; Seattle acquired him fifteen hours later and never listed him/.test(flat));
  A("it is named the last stale listing", /the second and last stale listing/.test(flat));
  A("no em dash or spaced hyphen", !/—/.test(rec) && !/ - /.test(rec));
}

console.log("\n— the door that made the reading possible");
{
  A("the reader is exported", /export async function readChannel\(\{ id, limit = 50, before = null \} = \{\}\)/.test(sync));
  A("it is key-gated at the door", /if \(params\.get\("read"\) === "channel"\) \{\s*\n\s*if \(!\(await opsKeyOk\(req\)\)\) return notFound\(\);/.test(ops));
  A("...and refuses a channel outside this guild", /That channel is not in this guild/.test(sync));
  A("...and is read-only by construction", /read-only: no argument of this function can write/.test(sync));
  A("the header documents it", /\?read=channel&id=…&limit=…&before=…/.test(ops));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
