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
/* v2.48: basic is the league standard and `paragraphs` now carries its text; the FULL-format
   wording this file used to pin lives verbatim in `full` (or, for a section the format split
   never touched, `full` is absent and paragraphs still carries it). */
const secFull = (id) => {
  for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return (s.full || s.paragraphs).join(" ");
  throw new Error("no section " + id);
};

console.log("— the rulebook says what the announcement says");
{
  /* presence, not position: a later version legitimately takes the top slot, and this file is
     here to prove v2.22's rules are recorded — not to pin the newest release forever */
  A("the changelog records v2.22", rb.changelog.some((c) => c.version === "2.22"));
  A("...and the newest entry sits first", rb.changelog[0].version >= "2.22", rb.changelog[0].version);
  /* v2.48: basic abolished the pre-season outright (Rule 0.4 basic: "There is no pre-season in
     the basic format"), so the three-game requirement is FULL-format-only now — shelved, not
     retired. Pin it there, and pin the basic replacement: registered by the cutoff is the test. */
  A("Rule 2.8 (full format, shelved) still carries the three-game pre-season requirement (v2.46)",
    /at least three \(3\) pre-season games to remain draft-eligible/.test(secFull("2.8")));
  A("...with returning players and management exempt",
    /Returning players and club management are exempt/.test(secFull("2.8")));
  A("...and the management obligation to spread ice time",
    /obligated to distribute pre-season appearances as widely as it can/.test(secFull("2.8")));
  A("Rule 2.8 (basic) has no pre-season requirement — registered by the cutoff is the whole test",
    /There is no appearance requirement and no exemption: registration by the cutoff is the sole test/.test(sec("2.8")));
  A("Chapter 0.4 (basic) has no pre-season at all",
    /The basic format has no pre-season/.test(sec("0.4")));
  A("...and the shelved full-format text no longer sweeps management into the random assignment",
    !/management included in the split/.test(secFull("0.4")) &&
    /management group plays for its own club/.test(secFull("0.4")));
  A("Rule 8.1 orders the table by total points",
    /ordered by total points earned/.test(sec("8.1")) &&
    !/ordered by points percentage/.test(sec("8.1")));
  A("...and says games in hand are not adjusted for",
    /not adjusted for games in hand/.test(sec("8.1")));
  A("...and scores a forfeit as an ordinary result", /A forfeit counts for points as an ordinary result/.test(sec("8.1")));
  A("Rule 8.1 (basic) takes the top three in each division, a six-club field",
    /top three \(3\) clubs in each division/.test(sec("8.1")) && /six-club field/.test(sec("8.1")));
  A("...and the shelved full-format text still holds the top four, eight-club field",
    /top four \(4\) clubs in each division/.test(secFull("8.1")) && /eight-club field/.test(secFull("8.1")));
  A("Rule 2.1 caps training camp at three", /up to three \(3\) training-camp players/.test(sec("2.1")));
  A("Rule 2.4 (basic) puts the deadline at midnight Friday of the fourth game week",
    /closes at midnight Eastern Time at the end of the Friday of the fourth \(4th\) game-week/.test(sec("2.4")));
  A("...and the shelved full-format text still says midnight Friday of the deadline week",
    /midnight at the end of the Friday of the league-posted deadline week/.test(secFull("2.4")));
  A("Rule 3.2 lets only an uninvolved staff member waive the ten-minute forfeit",
    /waived by a member of league staff who is not playing in, managing, or otherwise involved/.test(sec("3.2")) &&
    !/is a hard rule and is not waivable/.test(sec("3.2")));
  A("Rule 4.5 says the ban lists apply as written until reissued for NHL 27 (v2.35)",
    /were written against NHL 26 and apply as written until the league office reissues them for NHL 27/.test(sec("4.5")));
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
  A("the pre-season requirement is mirrored client-side", /CG\.PRESEASON_MIN_GP = 3/.test(live));
  A("...the draft desk filters the pool by it", /pool\.filter\(function\(r\)\{ return CG\.isDraftEligible\(r\.profile_id\); \}\)/.test(live));
  A("...and says the DB is the authority", /is_draft_eligible, enforced inside/.test(live));
  A("no surface still claims there is no games-played minimum",
    !/no games-played minimum/.test(live) && !/no games-played minimum/.test(hub) &&
    !/there is no games-played requirement \(Rule 2\.8\)/.test(live));
  /* v2.48: the caption no longer hardcodes "3 and 6" — both numbers are now format-dependent
     (basic caps the goaltender at 3 too; full still caps it at 6), so it reads them live from
     CG.weeklyCap instead of stating either format's numbers as a literal. */
  A("the playoff caps caption reads its numbers live from CG.weeklyCap, not a hardcoded literal",
    /a skater may be dressed in at most '\+CG\.weeklyCap\(\{ pos:"C" \}\)\+' games of a series and a goaltender in at most '\+CG\.weeklyCap\(\{ pos:"G" \}\)\+'/.test(hub) &&
    !/goaltenders are exempt and can play all seven/.test(hub));
  const fmtBlock = live.slice(live.indexOf("CG.FORMAT_RULES = {"), live.indexOf("CG.FORMAT_NAME"));
  A("...which gives 3 and 3 in basic",
    /basic: \{[\s\S]*?cap_skater:3, cap_goalie:3,/.test(fmtBlock));
  A("...and 3 and 6 in the shelved full format",
    /full: *\{[\s\S]*?cap_skater:3, cap_goalie:6,/.test(fmtBlock));
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
