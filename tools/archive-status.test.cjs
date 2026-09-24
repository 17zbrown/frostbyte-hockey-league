/* v3.08 — the EA archive must actually record that an import succeeded.
 *
 * Game night one: all ten clean imports sat at status `unmatched` while owning their game, so
 * bot/staff-alerts.mjs kept routing "EA import needs a match, link it by hand" to the Statistics
 * desk for games that were already filed, correct and final.
 *
 * THE CAUSE, and it is the reason this file exists rather than a comment: touchAttempt UPSERTed
 * without `payload`, which is NOT NULL with no default. Postgres checks NOT NULL against the
 * proposed tuple BEFORE the ON CONFLICT arbiter resolves to an UPDATE, so the statement died
 * with 23502 on a row that existed and would only have been updated. Verified live against a
 * real row: `null value in column "payload" of relation "ea_ingest_log" violates not-null`.
 * The throw was caught and logged, so it had failed every time since it was written.
 *
 * Two rules come out of it, and both are pinned below:
 *   - a status write must not be an upsert that omits a NOT NULL column;
 *   - an UPDATE that matches no row returns 200 and an empty array with NO error, so a write
 *     that claims success without looking at the representation is claiming nothing.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}

const ing = R("netlify/functions/ingest-stats.js");
const rec = R("sql/2026-09-24-archive-status-23502.sql");
/* the slice starts at the comment block, not the function: the reasoning this file pins lives
   in the comment, and a slice that began at `async function` would silently test nothing. */
const touch = ing.slice(ing.indexOf("/* Status-only touch"), ing.indexOf("/* ---- The batch context"));

console.log("\n— the status write");
{
  A("it is a PATCH on the match id", /method: "PATCH"/.test(touch) && /ea_ingest_log\?ea_match_id=eq\./.test(touch));
  A("it is NOT an upsert any more", !/on_conflict=ea_match_id/.test(touch), touch.split("\n").find((l) => l.includes("on_conflict")));
  /* THE rule this file exists for, checked structurally rather than by counting call sites:
     an upsert on ea_ingest_log must carry `payload`, because NOT NULL is checked before the
     ON CONFLICT arbiter can turn the insert into an update. */
  A("every upsert on the archive still sends payload", (() => {
    /* the row literal sits after the call at two sites and BEFORE it at the third (the
       fixture-desk fetch builds `rows` in a loop first), so look both ways. */
    const lines = ing.split("\n");
    const bad = [];
    lines.forEach((l, i) => {
      if (!l.includes("ea_ingest_log?on_conflict")) return;
      const near = lines.slice(Math.max(0, i - 12), i + 10).join("\n");
      if (!/payload:/.test(near)) bad.push(i + 1);
    });
    return bad.length ? bad.join(", ") : true;
  })() === true);

  A("it asks for the row back", /Prefer: "return=representation"/.test(touch));
  A("...and only claims success when a row actually came back",
    /if \(Array\.isArray\(back\) && back\.length\) return true;/.test(touch));
  A("a miss is reported, not swallowed", /touch matched no row for match/.test(touch));
  A("a transport failure is reported too", /ea_ingest_log touch failed/.test(touch) && /console\.warn/.test(touch));
}

console.log("\n— a lost status is no longer silent at the call site");
{
  A("the successful filing checks the archive landed",
    /if \(!\(await archive\(ctx, norm, raw, "ingested"/.test(ing));
  A("...and says so where a human will see it",
    /its archive row could not be marked ingested/.test(ing));
  A("the merge path still checks its own archive", /const logged = await archive\(ctx, norm, raw, "merged"/.test(ing));
}

console.log("\n— the cause is written down next to the code, with its SQLSTATE");
{
  const flat = touch.replace(/\s+/g, " ");
  A("the file names the constraint that broke it", /`payload` is NOT NULL with no default/.test(flat));
  A("...and the ordering rule that makes it surprising",
    /checks NOT NULL against the proposed tuple BEFORE the ON CONFLICT arbiter resolves/.test(flat));
  A("...and the SQLSTATE", /23502/.test(flat));
  A("...and what it cost", /EA import needs a match/.test(flat) && /merged a lag-out sitting twice/.test(flat));
  A("...and the false-success rule", /comes back 200 with an empty array and no error/.test(flat));
}

console.log("\n— the decision record");
{
  const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
  A("it shows how the defect was spotted", /last_attempt_at on all ten was earlier than the game_stats rows/.test(flat));
  A("it quotes the live error", /violates not-null/.test(flat));
  A("it records that the upsert was chosen over a PATCH on purpose",
    /The upsert was chosen OVER a PATCH/.test(flat));
  A("it carries the backfill", /set status  = 'ingested'/.test(rec) || /set status = 'ingested'/.test(rec));
  A("...with an assertion that no filed game still reads unmatched",
    /still read unmatched/.test(flat));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
