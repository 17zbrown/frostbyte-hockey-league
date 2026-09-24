/* v3.09 — a game with problems raises ONE notice, and only for the three things the league
 * actually wants to be interrupted for.
 *
 * Commissioner, 2026-09-24: "dont send so many alerts about problems with games. Send out 1
 * message per alert and send them all in one notice instead of spamming... Only remind the staff
 * when you see a player breaking their position lock rules depending on if they are Roster or TC,
 * if they break their game limit rules, or if you sense a player not linked to anyone on the team."
 *
 * This file cannot reach the database, so it holds what the repo owns: the decision record, and
 * the one piece of client code that must not start alerting again.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}

const rec = R("sql/2026-09-24-one-notice-per-game.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const alerts = R("bot/staff-alerts.mjs");
/* the reasoning lives in a wrapped block comment; a pin that depends on where a line happens to
   wrap is a pin that fails on the next reflow */
const alertsFlat = alerts.replace(/\s+/g, " ");

console.log("\n— the statistics room is no longer sent to manual entry");
{
  const code = alerts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  A("the ea_ingest_log branch returns nothing", /if \(table === "ea_ingest_log"\) return null;/.test(code));
  A("...so no CTA points at the Stats manager any more", !/Link it by hand in the Stats manager/.test(code),
    (code.split("\n").find((l) => /Stats manager/.test(l)) || "").trim());
  A("...and no 'EA import needs a match' alert is built", !/EA import needs a match/.test(code));
  A("the catch-up sweep skips the table rather than fetching 200 rows to discard",
    /if \(table === "ea_ingest_log"\) continue;/.test(code));
  A("the reason is recorded next to the code", /they can do that at their staff desk/.test(alertsFlat));
  A("...including why it was noisy on the first night", /TEN clean imports sat marked unmatched/.test(alertsFlat));
}

console.log("\n— the decision record");
{
  A("it quotes the instruction", /Send out 1 message per alert/.test(flat));
  A("it names the two calls that each finding used to fire",
    /notify_department/.test(flat) && /notify_staff_ch/.test(flat));
  A("it counts the cost that was actually being paid", /21 notifications and 3 pings/.test(flat));
  A("...with the first night's real numbers", /12 unidentified-player findings/.test(flat));
  A("it keeps the audit row, and says why", /the audit row IS the dedup key/.test(flat));
  A("it records what stopped alerting", /lineup_not_filed is still recorded, but no longer pings/.test(flat));
  A("...and that commissioners still see the cap finding",
    /notify_department includes every commissioner/.test(flat));
  A("it records WHY consolidation is even possible here",
    /FOR EACH STATEMENT/.test(flat) && /A row-level trigger would have fragmented the notice/.test(flat));
  A("it carries the rehearsal numbers", /notifications created 7, distinct titles 1/.test(flat));
  A("...and that the rehearsal could not reach Discord", /pg_net is transactional/.test(flat));
}

console.log("\n— the three findings the league still wants are named in the record");
{
  for (const [label, re] of [
    ["position locks", /position lock/i],
    ["game limits", /game limit/i],
    ["a player nobody can account for", /not linked to anyone on the team/i],
  ]) A(`the record names ${label}`, re.test(flat));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
