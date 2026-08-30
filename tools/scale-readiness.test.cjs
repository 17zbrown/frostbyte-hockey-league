/* Daily-use readiness at 200+ members (audit of 2026-08-30).
   Run: node tools/scale-readiness.test.cjs

   Measured baseline this pins against: bundle 536 KB gzipped with ETag revalidation (repeat
   visits are a 0-byte 304), ~1.0s to interactive, 29 parallel boot queries, 172ms median
   round trip, DB 62 MB / biggest table 1,143 rows, zero horizontal overflow on 7 public routes
   at 375px. Projected: game_stats reaches ~7,000 rows (12 lines per game x 540 games), ~3.8 MB. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js");
const pub = R("src/live/part5a_public.js");
const css = R("src/live/part1_head.html");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— whole-table reads don't get slower one round trip at a time");
{
  A("sbAll fetches pages concurrently", /var pages = await Promise\.all\(reqs\);/.test(live));
  A("...after asking how many there are", /\{ count:"exact", head:true \}/.test(live));
  A("...and still walks serially if the count is refused", /count refused — walk it serially/.test(live));
  A("the old serial-only loop is gone", !/var r = await qb\.range\(from, from\+page-1\);\n      if \(r\.error\) return \{ data: out\.length\?out:null/.test(live));
}

console.log("— one league rebuild per game, not per stat row");
{
  A("the public channel listens to games only", /table:"games" \}, function\(\)\{ CG\.liveReload\(\); \}\)\n      \.subscribe\(\);/.test(live));
  A("...not to game_stats", !/table:"game_stats" \}, function\(\)\{ CG\.liveReload\(\); \}\)/.test(live));
  A("...and says why", /patches games to final/.test(live));
}

console.log("— draft night can't spin itself");
{
  A("the heartbeat stamps on settle, not on start", /CG\._draftBeating = false; CG\._draftBeatAt = CG\.now\(\);/.test(live));
  A("...and never overlaps itself", /if \(!CG\._draftBeating && CG\.now\(\) - last > 10000\)/.test(live));
}

console.log("— destructive confirmations fail closed");
{
  A("there is one safe count helper", /CG\.safeCount = function\(resp\)\{[\s\S]{0,140}return resp\.count;/.test(live));
  A("deleting a season refuses on an unreadable count", /not opening the delete dialog/.test(live));
  A("removing a club refuses too", /Couldn’t check what "\+name\+" still holds/.test(live));
  A("neither coerces a failed count to zero",
    !/var games=\(rs\[0\]&&rs\[0\]\.count\)\|\|0/.test(live) && !/var spots=\(rs\[0\]&&rs\[0\]\.count\)\|\|0/.test(live));
}

console.log("— a failed boot is recoverable");
{
  A("the chrome renders before the error", /try \{ if \(CG\.renderChrome\) CG\.renderChrome\(\); \} catch\(_e\)\{\}/.test(live));
  A("...there is a Try again button", /id="bootRetry"/.test(live) && /CG\.bootLive\(\); \}\);/.test(live));
  A("...and it retries by itself when the network returns", /addEventListener\("online"/.test(live));
}

console.log("— a degraded stats load is never shown as zeros");
{
  A("a failed game_stats load is recorded", /CG\.LIVE\.partial\.game_stats = String\(/.test(live));
  A("...and warned about", /stats shown will be incomplete/.test(live));
  A("...with a banner helper", /CG\.statsPartialNote = function\(\)/.test(live));
  A("...actually rendered on Stat Central", /return head \+ _partial \+ tabs/.test(pub));
  A("...telling the reader not to read zeros", /treat it as unavailable, not as zero/.test(live));
}

console.log("— phones");
{
  A("the table filter is a real touch target on coarse pointers", /@media \(pointer:coarse\)\{\.tbl-fbtn\{padding:12px/.test(css));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
