/* v2.99 — a box score naming a player the club does not hold.
 *
 * Commissioner: "If a team ever reports a box score with a player that does not appear anywhere on
 * their active roster or TC, please notify the correct staff for them to deal with it."
 *
 * The detection itself is a database function (public.review_game_records, run by the
 * check_weekly_cap_violations trigger when a regular-season game goes final) and was rehearsed
 * against a real fixture with rollback; what this suite can hold is the repo side of it:
 *   - the decision record exists and says what was applied and why the two obvious tables were
 *     rejected, so the live function can be rebuilt from the repo;
 *   - the published rulebook carries the obligation;
 *   - fuzzyProfile escapes the LIKE metacharacters, without which the whole check has a blind
 *     spot: a ringer quietly resolved to a rostered player looks perfectly clean.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 200))); }
}

const rec = R("sql/2026-09-23-unrostered-player-flag.sql");
const ingest = R("netlify/functions/ingest-stats.js");

console.log("\n— the decision record");
{
  A("it names the commissioner's request", /does not appear anywhere on\s*--? ?their active roster or TC/.test(rec.replace(/\n/g, " ")) || rec.includes("their active roster or TC"));
  A("it records the department notifier", /create or replace function public\.notify_department/.test(rec));
  A("...and that it is not callable by members", /revoke execute on function public\.notify_department/.test(rec));
  A("it records the unrostered check", /unrostered_player/.test(rec));
  A("it records the unidentified check", /unidentified_player/.test(rec));
  A("it records the dedup", /admin_audit/.test(rec));

  /* the two rejected homes: a future reader must not re-try them */
  A("it says why game_incidents was rejected", /game_incidents/.test(rec) && /BOTH clubs/.test(rec));
  A("it says why action_requests was rejected", /action_requests/.test(rec) && /NOT NULL/.test(rec) && /ar_update/.test(rec));

  A("it records the rehearsal and its result", /REHEARSED with rollback/.test(rec) && /exactly 2 flags/.test(rec));
  A("...including that no Discord call escaped the rollback", /pg_net is transactional/.test(rec) && /never sent/.test(rec));
}

console.log("\n— the matcher cannot hide the thing the check looks for");
{
  const fz = ingest.slice(ingest.indexOf("async function fuzzyProfile"), ingest.indexOf("const cleanTag"));
  A("fuzzyProfile exists", fz.length > 50);
  A("each token is escaped before the wildcard join", /toks\.map\(escTok\)\.join\("\*"\)/.test(fz), fz.split("\n").find((l) => l.includes("for (const pat")));
  /* a regex to pin a regex is how a test starts lying; match the source text literally */
  A("...and the escape covers backslash, percent and underscore",
    fz.includes('const escTok = (t) => t.replace(/([\\\\%_])/g, "\\\\$1");'), fz.split("\n").find((l) => l.includes("escTok =")));
  A("the raw unescaped join is gone", !/\[toks\.join\("\*"\)/.test(fz), fz.split("\n").find((l) => l.includes("for (const pat")));
  A("it still refuses when two people match", /if \(ids\.length > 1\) return null/.test(fz));
  A("the reason is written down, not just the fix", /welded to the wrong/i.test(fz));

  /* run it: the pattern that reaches the database must treat an underscore as a literal */
  const asked = [];
  const fn = new Function("sbGet", `${fz}; return fuzzyProfile;`)(async (url) => { asked.push(url); return []; });
  return fn("Dangle_47").then(() => {
    A("an underscore reaches the query escaped, not as a wildcard",
      asked.length > 0 && asked.every((u) => /Dangle%5C_47|Dangle%5C%5C_47/.test(u)), asked[0]);
    A("...so the database sees a literal underscore, not any character",
      decodeURIComponent(asked[0]).includes("Dangle\\_47"), decodeURIComponent(asked[0]));
    return fn("Two Words").then(() => {
      const last = asked[asked.length - 1];
      A("a space still becomes the intended wildcard", /Two\*Words/.test(decodeURIComponent(last)), decodeURIComponent(last));
      finish();
    });
  });
}

function finish() {
  console.log("\n— the published rulebook carries the obligation");
  const content = R("src/live/part3_content.js");
  const obj = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  let s42 = null;
  for (const ch of obj.rulebook.chapters) for (const sec of ch.sections) if (sec.id === "4.2") s42 = sec;
  const body = (s42 ? s42.paragraphs : []).join(" ");
  A("4.2 says every completed game is checked against both rosters", /Every completed game is checked against the two clubs' rosters/.test(body));
  A("...covering the player the club does not hold", /neither its active roster nor its training camp/.test(body));
  A("...and the player who cannot be identified at all", /cannot be identified as a member at all/.test(body));
  A("...and that it is referred, not ruled automatically", /referred to the department that owns it/.test(body));
  A("...and points at Chapter 7 for the consequence", /Chapter 7/.test(body));
  A("the changelog opens at 2.99", obj.rulebook.changelog[0].version === "2.99", obj.rulebook.changelog[0].version);

  console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
  process.exit(fail ? 1 : 0);
}
