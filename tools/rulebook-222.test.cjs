/* Rulebook v2.22 — the rules that changed, pinned against the code that enforces them.
   Run: node tools/rulebook-222.test.cjs   (build index.html first)

   Every assertion here exists because the claim lives in more than one place: the published
   rulebook, the site's own copy, and the code that decides. v2.7 abolished the five-game
   pre-season requirement in the UI but left it standing in the database, and the two disagreed
   for a season. That is the failure this file is here to prevent. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const html = R("index.html");
const content = R("src/live/part3_content.js");
const live = R("src/live/part_live.js");
const engine = R("src/live/part2_engine.js");
const hub = R("src/live/part6_hub.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
const sec = (id) => {
  for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" ");
  throw new Error("no section " + id);
};

console.log("— the rulebook says what the announcement says");
{
  /* presence, not position: a later version legitimately takes the top slot, and this file is
     here to prove v2.22's rules are recorded — not to pin the newest release forever */
  A("the changelog records v2.22", rb.changelog.some((c) => c.version === "2.22"));
  A("...and the newest entry sits first", rb.changelog[0].version >= "2.22", rb.changelog[0].version);
  A("Rule 2.8 carries the five-game pre-season requirement",
    /at least five \(5\) pre-season games to remain draft-eligible/.test(sec("2.8")));
  A("...with returning players and management exempt",
    /Returning players and club management are exempt/.test(sec("2.8")));
  A("...and the management obligation to spread ice time",
    /obligated to distribute pre-season appearances as widely as it can/.test(sec("2.8")));
  A("Chapter 0.4 no longer sweeps management into the random assignment",
    !/management included in the split/.test(sec("0.4")) &&
    /management group plays for its own club/.test(sec("0.4")));
  A("Rule 8.1 orders the table by total points",
    /ordered by total points earned/.test(sec("8.1")) &&
    !/ordered by points percentage/.test(sec("8.1")));
  A("...and says games in hand are not adjusted for",
    /not adjusted for games in hand/.test(sec("8.1")));
  A("...and scores a forfeit as an ordinary result", /forfeit counts for points exactly as an ordinary result/.test(sec("8.1")));
  A("Rule 8.1 takes the top four in each division",
    /top four \(4\) clubs in each division/.test(sec("8.1")) && /eight-club field/.test(sec("8.1")));
  A("Rule 2.1 caps training camp at three", /up to three \(3\) training-camp players/.test(sec("2.1")));
  A("Rule 2.4 puts the deadline at midnight Friday",
    /midnight at the end of the Friday of the league-posted deadline week/.test(sec("2.4")));
  A("Rule 3.2 lets only an uninvolved staff member waive the ten-minute forfeit",
    /waived by a member of league staff who is not playing in, managing, or otherwise involved/.test(sec("3.2")) &&
    !/is a hard rule and is not waivable/.test(sec("3.2")));
  A("Rule 4.5 flags the ban lists as changing at NHL 27",
    /subject to change on the release of NHL 27/.test(sec("4.5")));
}

console.log("\n— the code agrees with the rulebook");
{
  A("standings sort on total points, not percentage",
    /clubs are ordered by TOTAL POINTS EARNED/i.test(engine) && !/group by points percentage first/.test(engine));
  /* the field size became a Control Center setting; Rule 8.1's "top four" is now the DEFAULT,
     and the bracket shape is derived from it rather than hardcoded (see playoff-shape.test.cjs) */
  A("the rulebook's four-per-division is the shipped default", /CG\.PLAYOFF_PER_DIV_DEFAULT = 4/.test(live));
  A("...the qualifier count is read as a setting", /CG\.playoffPerDiv = function/.test(live));
  A("...the bracket needs a full field before it will build", /Need \"\+need\+\" seeds/.test(live));
  A("...frozen seeds are validated against that field size", /v\.length===CG\.playoffFieldSize\(\)/.test(live));
  A("...round 1 is derived per division, not hardcoded to four", /CG\.playoffRound1\(seedCodes\.slice/.test(live));
  A("...and the round names are derived too", /CG\.playoffRoundName = function/.test(live));
  A("the pre-season requirement is mirrored client-side", /CG\.PRESEASON_MIN_GP = 5/.test(live));
  A("...the draft desk filters the pool by it", /pool\.filter\(function\(r\)\{ return CG\.isDraftEligible\(r\.profile_id\); \}\)/.test(live));
  A("...and says the DB is the authority", /is_draft_eligible, enforced inside/.test(live));
  A("no surface still claims there is no games-played minimum",
    !/no games-played minimum/.test(live) && !/no games-played minimum/.test(hub) &&
    !/there is no games-played requirement \(Rule 2\.8\)/.test(live));
  A("the playoff caps caption states 3 and 6, not 4 and exempt",
    /at most three games of a series and a goaltender in at most six/.test(hub) &&
    !/goaltenders are exempt and can play all seven/.test(hub));
}

console.log("\n— the bundle still boots with these changes in it");
{
  A("index.html contains the new eligibility helper", /CG\.isDraftEligible = function/.test(html));
  A("...and the divisional playoff default", /CG\.PLAYOFF_PER_DIV_DEFAULT = 4/.test(html));
  const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  A("every inline script parses", scripts.every((s) => { try { new vm.Script(s); return true; } catch { return false; } }));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
