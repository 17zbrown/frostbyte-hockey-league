/* NHL 27 readiness of the EA transport (2026-09-07).
   Run: node tools/ea-nhl27-transport.test.cjs

   Verified live against EA that day, from a real browser and from Node:
     - platform=common-gen5 is the ONLY accepted token (gen4/gen6/ps5/xbox-series-xs -> 400)
     - matchType=club_private is still accepted (club/club_public -> 400)
     - every field the parsers read is present on an NHL 27 match payload: all 25 skater fields
       and glsaves/glshots/glga, plus matchId, timestamp, clubs[].score, clubs[].details.name
     - EA blocks by CLIENT FINGERPRINT, not by datacenter IP: curl 403 from a residential address
       while undici/global fetch returned 200 from BOTH a residential and a datacenter address.
   That last point is why the transport now goes DIRECT first and treats the residential proxy as a
   fallback. A lapsed IPRoyal subscription had taken every EA import down while the code insisted on
   routing through it. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const pickup = R("netlify/functions/pickup-import.js");
const ingest = R("netlify/functions/ingest-stats.js");
const poll   = R("netlify/functions/ea-poll.js");
const live   = R("src/live/part_live.js");
const fetcher = R("tools/ea-fetcher/fetch-and-post.mjs");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the EA transport tries DIRECT before the paid proxy");
/* v3.06: the route list gained a one-try mode for interactive callers, so pin the PROPERTY (the
   direct attempt is first, and a missing proxy never arms one) rather than the literal line. */
A("pickup-import puts the direct route first", /const routes = PROXY\s*\n?\s*\? \(opts\.tries === 1 \? \[null, PROXY\] : \[null, PROXY, PROXY\]\)/.test(pickup));
A("ingest-stats puts the direct route first", /const routes = EA_PROXY\s*\n?\s*\? \(opts\.tries === 1 \? \[null, EA_PROXY\] : \[null, EA_PROXY, EA_PROXY\]\)/.test(ingest));
A("...and with no proxy configured every route is direct",
  /: \(opts\.tries === 1 \? \[null\] : \[null, null, null\]\)/.test(pickup) && /: \(opts\.tries === 1 \? \[null\] : \[null, null, null\]\)/.test(ingest));
A("ea-poll puts the direct route first", /const routes = PROXY \? \[null, PROXY\] : \[null\];/.test(poll));
A("...and none of them arms a dispatcher before the first attempt",
  !/if \(PROXY\) opts\.dispatcher = new ProxyAgent\(PROXY\);\s*\n\s*const r = await \(PROXY \? uFetch : fetch\)/.test(pickup) &&
  !/let dispatcher;\s*\n\s*if \(PROXY\) \{ dispatcher = new ProxyAgent\(PROXY\); \}/.test(poll));
A("a proxied attempt still uses undici's fetch (global fetch drops `dispatcher`)",
  /await \(proxy \? uFetch\(url, o\) : fetch\(url, o\)\)/.test(pickup) &&
  /await \(proxy \? uFetch\(url, o\) : fetch\(url, o\)\)/.test(ingest));
/* clubErrors is a STRING channel: its first entry becomes lastError and is rendered straight into
   the Automations chip tooltip, so an object there reads "[object Object]" and the operator learns
   nothing. The first cut of this change pushed an object — caught in adversarial review. */
A("ea-poll survives an unreachable club", /const msg = `club \$\{c\}: EA unreachable/.test(poll));
A("...pushing a STRING, never an object, into the operator-facing error channel",
  !/clubErrors\.push\(\{/.test(poll));
A("...and logging it like every sibling failure branch",
  /clubErrors\.push\(msg\); console\.error\("ea-poll " \+ msg\); continue;/.test(poll));
A("eaGet keeps the failure cause instead of collapsing it to null", /return \{ response: r, why: why \|\| "no route answered" \};/.test(poll));
A("...and a proxy that throws cannot erase a direct 403 (Akamai message survives)",
  /r = res;\s+\/\/ never let a later throw erase an earlier answer/.test(poll));
A("...with each attempt capped like the eaFetch siblings",
  /const opts = \{ headers: EA_HEADERS, signal: AbortSignal\.timeout\(2800\) \};/.test(poll));

console.log("\n— the title is not pinned anywhere");
A("no NHL 26 reference survives in the EA callers", !/NHL ?26|nhl-26/i.test(pickup + ingest + poll + fetcher));
A("...nor in player-facing copy", !/NHL ?26/i.test(live));
A("the standalone fetcher sends a generic ea.com referer", /Referer: "https:\/\/www\.ea\.com\/"/.test(fetcher));

console.log("\n— the platform token stays overridable without a deploy");
for (const [n, s] of [["pickup-import", pickup], ["ingest-stats", ingest], ["ea-poll", poll]])
  A(`${n} reads PLATFORM from the environment`, /process\.env\.PLATFORM \|\| "common-gen5"/.test(s));
A("club_private is still the match type queried", /matchType=club_private/.test(pickup) && /matchType=club_private/.test(poll));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
