// v3.02 — a box-score name is matched against EA identities first, and never against Discord.
// Run: node tools/ea-identity-order.test.mjs
//
// Commissioner, game night 1: "make sure you are tracking player EA IDs instead of using their
// discord usernames."
//
// What went wrong that night: EA reported "Lokharov l14l". The resolver asked the SITE gamertag
// second and the EA ID third, so it landed on a duplicate, unrostered profile whose gamertag
// happened to be "Lokharov l14l", while the profile actually on DAL's roster, carrying
// ea_id "Lokharovl14l", was never reached. The stat line went to the wrong human and the
// unrostered-player check then correctly reported a player DAL does not hold.
//
// What must never break:
//   - the EA persona id link is first (it IS an EA identity, and the strongest one);
//   - both EA ID fields are asked BEFORE the site gamertag;
//   - discord_username is not consulted anywhere;
//   - the ambiguity rule survives: two people matching a name means nobody.
process.env.SUPABASE_URL = "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const fs = await import("node:fs");
const src = fs.readFileSync(new URL("../netlify/functions/ingest-stats.js", import.meta.url), "utf8");

console.log("— the order is written down in the order it runs");
{
  const body = src.slice(src.indexOf("async function resolveProfile"), src.indexOf("cache.set(key, pid)"));
  const at = (needle) => body.indexOf(needle);
  A("1st: EA's persona id, held on the profile", at("L.profilePersona(entry.ea_player_id)") > -1);
  A("2nd: the same persona seen in an earlier box score", at("L.prior(entry.ea_player_id)") > at("L.profilePersona(entry.ea_player_id)"));
  A("3rd: the EA ID on the profile", at("L.profileEaId(gt)") > at("L.prior(entry.ea_player_id)"));
  A("4th: the EA ID from registration", at("L.regEaId(gt)") > at("L.profileEaId(gt)"));
  A("5th: only then the site gamertag", at("L.gamertag(gt)") > at("L.regEaId(gt)"),
    `gamertag at ${at("L.gamertag(gt)")}, regEaId at ${at("L.regEaId(gt)")}`);
  A("last: the squashed fallback", at("fuzzyProfile(gt)") > at("L.gamertag(gt)"));
  A("the id is asked before any name at all",
    at("L.profilePersona(entry.ea_player_id)") < at("L.profileEaId(gt)") && at("L.profilePersona(entry.ea_player_id)") < at("L.gamertag(gt)"));
  A("the reason is recorded next to the code, not just in a commit",
    /box-score name is an EA identity/i.test(body) && /Lokharov/.test(body));
}

console.log("\n— Discord is not asked who was on the ice");
{
  A("the fuzzy step no longer queries discord_username", !/discord_username\.ilike/.test(src));
  A("...and says why", /A Discord handle is not evidence about who was/.test(src));
  /* prose may say the word; a QUERY may not. Strip comments, then look. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  A("no query anywhere in the file reads discord_username", !/discord_username/.test(code),
    (code.split("\n").find((l) => l.includes("discord_username")) || "").trim());
  const fz = src.slice(src.indexOf("async function fuzzyProfile"), src.indexOf("const cleanTag"));
  A("the fields it does read are all in-game identities",
    /ea_id\.ilike\.\$\{q\},platform_gamertag\.ilike\.\$\{q\},gamertag\.ilike\.\$\{q\}/.test(fz), fz.split("\n").find((l) => l.includes("or=(")));
}

console.log("\n— both lookup sources offer the new step, or a whole box score would skip it");
{
  /* liveLookups answers one player; gameLookups prefetches a whole roster. A step present in one
     and missing from the other resolves differently alone than in a game, which is precisely the
     bug class this file exists to stop. */
  const live = src.slice(src.indexOf("function liveLookups"), src.indexOf("/* The same three lookups"));
  const game = src.slice(src.indexOf("function gameLookups"), src.indexOf("async function resolveProfile"));
  for (const step of ["profilePersona", "prior", "profileEaId", "regEaId", "gamertag"]) {
    A(`liveLookups offers ${step}`, new RegExp(`\\b${step}:`).test(live));
    A(`gameLookups offers ${step}`, new RegExp(`\\b${step}:`).test(game));
  }
  A("the prefetch has its own memo for the new step", /profEaP \|\|= sbGet/.test(game));
  A("...declared with the others", /let priorP = null, tagP = null, regP = null, profEaP = null, personaP = null;/.test(game));
  A("...and it is case-insensitive like its siblings", /orIlike\("ea_id", names\)/.test(game));
}

console.log("\n— two people matching a name is still nobody");
{
  const body = src.slice(src.indexOf("async function resolveProfile"), src.indexOf("cache.set(key, pid)"));
  A("every exact step demands exactly one", (body.match(/ids\.length === 1/g) || []).length === 3,
    String((body.match(/ids\.length === 1/g) || []).length));
  const fz = src.slice(src.indexOf("async function fuzzyProfile"), src.indexOf("const cleanTag"));
  A("the fuzzy step refuses on two", /if \(ids\.length > 1\) return null/.test(fz));
  A("...and each lookup asks for two so it can tell", (src.match(/limit=2/g) || []).length >= 4);
}

console.log("\n— the system only has to recognise a member once");
{
  A("personas are learned after the rows are built", /await learnPersonas\(rows\);/.test(src));
  A("...only filling a NULL, never overwriting", /ea_player_id=is\.null/.test(src));
  A("...and the reason that filter is there is written down", /a concurrent writer cannot be clobbered/.test(src));
  A("a persona already claimed by another profile is logged, not thrown",
    /r\.status === 409/.test(src) && /duplicate account\?/.test(src));
  A("...so learning can never fail an import", /the import is unaffected/.test(src));
  A("a row with no profile or no persona is skipped", /if \(!r\.profile_id \|\| !r\.ea_player_id\) continue;/.test(src));
  A("one profile is written at most once per box score", /if \(!seen\.has\(key\)\) seen\.set\(key/.test(src));
  A("the database refuses two profiles claiming one persona (recorded)",
    /a unique index refuses to give one persona to two profiles/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
