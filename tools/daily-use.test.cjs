/* The daily-use audit's remaining 19 findings (2026-08-30).
   Run: node tools/daily-use.test.cjs

   The DB half is pinned by a rolled-back rehearsal: a game_stats row inserted without season_id
   inherited it from its parent game via trg_game_stats_season. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js");
const pub = R("src/live/part5a_public.js");
const hub = R("src/live/part6_hub.js");
const ui = R("src/live/part4_ui.js");
const css = R("src/live/part1_head.html");
const build = R("src/live/build.cjs");
const roleSync = R("bot/role-sync.mjs");
const incidents = R("bot/incidents.mjs");
const botMain = R("bot/chel-bot.mjs");
const ingest = R("netlify/functions/ingest-stats.js");
const pickup = R("netlify/functions/pickup-import.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the boot's heaviest load is bounded");
{
  A("game_stats is scoped to one season", /return _hintUsed \? qb\.eq\("season_id", _hintUsed\) : qb;/.test(live));
  A("...from a hint that survives across visits", /localStorage\.getItem\("cg_season_id"\)/.test(live));
  A("...written back after every boot", /localStorage\.setItem\("cg_season_id", CG\.SEASON\.id\)/.test(live));
  A("...unscoped rather than wrong when there is no hint", /means "no hint": load unscoped/.test(live));
  A("a stale hint self-corrects exactly once", /CG\._seasonHintFixed = true;/.test(live));
  /* part2_engine seeds a prototype CG.SEASON={id:"S1"} that is still in place during boot —
     scoping on it matched nothing and forced a second full league build on EVERY cold load */
  A("only a real season uuid may scope the query", /if \(live && CG\._UUID_RE\.test\(live\)\) return live;/.test(live));
  A("...and a non-uuid is never persisted as a hint", /CG\.SEASON\.id && CG\._UUID_RE\.test\(CG\.SEASON\.id\)/.test(live));
  A("no dead state left behind", !/_restatsPending/.test(live));
}

console.log("— silent truncation can't hide the newest rows");
{
  A("DMs load newest-first with an explicit cap", /direct_messages[\s\S]{0,180}ascending:false\}\)\.limit\(900\)/.test(live));
  A("...then restore chronological order", /r\.data = r\.data\.slice\(\)\.sort\(CG\._byCreatedAsc\)/.test(live));
  /* ISO strings compare exactly; Date.parse truncates to whole ms and left same-ms messages
     in the server's descending order */
  A("...with an exact, tie-broken comparator", /CG\._byCreatedAsc = function\(a,b\)/.test(live) && /a\.created_at < b\.created_at \? -1 : 1/.test(live));
  A("...shared by all three re-sorts", (live.match(/CG\._byCreatedAsc/g)||[]).length === 4);
  A("case messages too", /action_messages[\s\S]{0,120}ascending:false\}\)\.limit\(900\)/.test(live));
  A("...re-sorted for the thread", /fetched newest-first so the silent 1000-row cap drops the OLDEST/.test(live));
  A("application chat too", /application_messages[\s\S]{0,320}ascending:false\}\)\.limit\(900\)/.test(live));
  A("...re-sorted in the grouper", /rows arrive newest-first/.test(live));
}

console.log("— a signed-in member stays signed in");
{
  A("the profile fetch retries before giving up", /var oneProfile = function\(\)/.test(live));
  A("...and keeps the last good profile rather than nulling it", /else if \(CG\.toast\) CG\.toast\("Couldn’t reach your account just now/.test(live));
  A("...instead of silently demoting to guest", !/one\(CG\.sb\.from\("profiles"\)\.select\("\*"\)\.eq\("id", uid\)\.maybeSingle\(\)\),/.test(live));
}

console.log("— member writes can't report a success the server refused");
{
  A("saveEaId checks for a zero-row write", /update\(\{ ea_id:v \}\)[\s\S]{0,80}\.select\("id"\)/.test(live));
  A("...with an honest message", (live.match(/your sign-in may have expired/g)||[]).length === 2);
  A("the settings twin too", /update\(\{ ea_id:ea\|\|null, platform:plat\|\|null \}\)[\s\S]{0,60}\.select\("id"\)/.test(live));
}

console.log("— draft night, both rooms");
{
  /* it re-arms the channel and refreshes DATA, but must NOT repaint: this panel holds the
     commissioner's controls and a 10s repaint would fight whatever they are doing */
  A("the Team HQ tick recovers a dead socket too", /if \(CG\._draftChannel === null && CG\.subscribeDraft\) CG\.subscribeDraft\(\);/.test(live));
  A("...without repainting the Draft manager under the operator", !/CG\._draftHeartbeat\(\);\n    var st = CG\.lg\.draftState/.test(live));
  A("...only privileged browsers advance the clock", /if \(role!=="mgmt" && role!=="commish" && role!=="staff"\) return;/.test(live));
  A("...with backoff", /CG\._drAdvanceAfter = Date\.now\(\) \+ Math\.min\(60000/.test(live));
  A("...and it no longer swallows the error", /console\.error\("draft_auto_advance failed", err\)/.test(live));
}

console.log("— the app doesn't depend on someone else's CDN");
{
  A("supabase-js is served from our own origin", /src="\/vendor\/supabase-js-\$\{SUPABASE_JS\}\.min\.js"/.test(build));
  A("...with the CDN kept only as a fallback", /onerror=[\s\S]{0,200}cdn\.jsdelivr\.net/.test(build));
  A("...that rebuilds the client and re-runs the boot it rescued",
    /if\(window\.CG&&CG\.ensureSb&&CG\.ensureSb\(\)&&CG\.bootLive\)CG\.bootLive\(\)/.test(build));
  /* the client used to be created once at parse time, which made the fallback inert */
  A("...and the client can actually be created later", /CG\.ensureSb = function\(\)\{/.test(live) && /CG\.sb = null;/.test(live));
  A("...and the vendored file exists", fs.existsSync(path.join(__dirname, "..", "vendor", "supabase-js-2.110.7.min.js")));
  A("...matching the pinned integrity hash",
    require("crypto").createHash("sha384").update(fs.readFileSync(path.join(__dirname,"..","vendor","supabase-js-2.110.7.min.js"))).digest("base64")
      === (build.match(/sha384-([A-Za-z0-9+/=]+)/)||[])[1]);
}

console.log("— phones");
{
  A("chips are real touch targets", /a\.chip,button\.chip,\.chip\[data-go\][\s\S]{0,60}min-height:44px/.test(css));
  A("the iOS 16px floor is re-asserted at matching specificity", /\.tbl tr\.tbl-filter input,\.lc-nm,\.scout-in,\.fa-club,#seasonPick\{font-size:16px\}/.test(css));
  A("the lineup board keeps its scroll across a repaint", /var x = prev \? prev\.scrollLeft : 0;/.test(hub) && /now\.scrollLeft = x;/.test(hub));
  A("the enter animation only plays on real navigation", /'<div'\+\(sameRoute\?'':' class="pg"'\)\+'>'/.test(ui));
  A("the closed mobile menu leaves the tab order", /mn\.inert = true;/.test(ui) && /mnv\.inert = false;/.test(ui));
  A("the schedule opens on the week in play", /fWeek = _wk == null \? "" : String\(_wk\);/.test(pub));
}

console.log("— the Discord bot survives 200 members");
{
  A("role-sync honors 429 and Retry-After", /if \(r\.status === 429\)[\s\S]{0,120}retry-after/.test(roleSync));
  A("...and backs off on 5xx", /if \(r\.status >= 500\)[\s\S]{0,80}600 \* \(attempt \+ 1\)/.test(roleSync));
  A("...and drains serially instead of firing 500 timers at once", /async function drain\(\)/.test(roleSync) && /while \(queue\.length\)/.test(roleSync));
  A("incident rulings retry", /rate-limited after retries/.test(incidents));
  A("...claim so a retry can't double-post", /kind: "incident", ref/.test(incidents));
  A("...release only the destination that failed", (incidents.match(/await release\(_ref \+ ":" \+/g)||[]).length === 2);
  A("...and a catch-up re-sends what was missed", /async function catchUp\(minutes = 24 \* 60\)/.test(incidents) && /INC\.catchUp\(\)/.test(botMain));
  /* review round 2: the claim is per DESTINATION, so a half-delivered ruling retries only the
     club that missed it instead of re-sending to the one that already had it */
  A("...claimed per destination, not per ruling", /claim\(_ref \+ ":" \+ mine\.discord_channel_id\)/.test(incidents) && /claim\(_ref \+ ":" \+ other\.discord_channel_id\)/.test(incidents));
  A("...and an idless row can't collapse every ruling onto one ref", /row\.game_id, row\.team_id, row\.kind/.test(incidents));
  A("role-sync merges a repeat enqueue instead of dropping its callback", /existing\.onDone = prev \? function\(r\)\{ prev\(r\); onDone\(r\); \} : onDone;/.test(roleSync));
}

console.log("— nothing public burns metered resources");
{
  A("the EA diagnostics require the ingest key", /diagnostics require x-ingest-key/.test(pickup));
  A("...before any EA call is made", pickup.indexOf("_diagOk") < pickup.indexOf("puproxy9"));
  A("an already-ingested match no longer re-uploads its payload", /await touchAttempt\(norm\.ea_match_id, "ingested"/.test(ingest));
  A("...via a status-only PATCH", /async function touchAttempt\(eaMatchId, status, reason, gameId\)/.test(ingest));
}

console.log("— the operator can see what needs them");
{
  A("automations grade against their own cadence", /var fresh = mins < \(_stale \|\| 30\);/.test(live));
  /* a dead ea-poll used to read green for a whole game night on a flat 24h threshold */
  A("...and ea-poll is graded strictly inside the game window",
    /CG\.inGameWindowET\(\) \? 20 : 1440/.test(live) && /CG\.inGameWindowET = function\(\)/.test(live));
  A("...daily and weekly jobs included", /staleAfterMin:2160/.test(live) && /staleAfterMin:11520/.test(live));
  A("there is a league-wide lineup readiness view", /CG\.renderLineupReadiness = function\(\)/.test(live));
  A("...that says how long each club has left", /'m left'/.test(live));
  A("...and refuses to read a failed query as 'nobody filed'", /not the same as "nobody has filed"/.test(live));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
