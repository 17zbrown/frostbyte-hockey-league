// The EA-name -> profile resolvers, hardened after four real players went unlinked in one pickup
// import (UCHL Penguins 6-2 LG Latvia, 2026-08-05). Each failure shape from that night is a case
// here: a space of drift, a variant spelling, an emoji-wrapped gamertag, a Discord-only handle.
// The one rule that must never bend: an ambiguous pattern links NOBODY — crediting the wrong
// person's stats is worse than leaving a line for staff. Run: node tools/profile-match.test.mjs
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.INGEST_KEY ||= "machine-key";
delete process.env.HTTPS_PROXY;

const { _internals: PU } = await import(new URL("../netlify/functions/pickup-import.js", import.meta.url).pathname);
const { _internals: LG } = await import(new URL("../netlify/functions/ingest-stats.js", import.meta.url).pathname);

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* the profile pool, mirroring the real failure night */
const PROFILES = [
  { id: "p-mags",  ea_id: "MagsinEH",         platform_gamertag: "Magsin EH", gamertag: "magsineh",          discord_username: "magsineh" },
  { id: "p-porta", ea_id: "MOUF uh duh SOUF", platform_gamertag: null,        gamertag: "🇺🇲PORTA DUMP🇺🇲",   discord_username: "moufuhduhsouf_17314" },
  { id: "p-fat",   ea_id: "SomeFatDude85",    platform_gamertag: null,        gamertag: "Some Fat Kid 85",   discord_username: "somefatkid85" },
  { id: "p-spear", ea_id: null,               platform_gamertag: null,        gamertag: "Spearing",          discord_username: "spearing15" },
  /* ambiguous by design: BOTH match "Night Owl" only through the fuzzy step */
  { id: "p-owl1",  ea_id: "NightOwl",         platform_gamertag: null,        gamertag: "whatever1",         discord_username: "owl-one" },
  { id: "p-owl2",  ea_id: null,               platform_gamertag: null,        gamertag: "whatever2",         discord_username: "night-owl" },
  { id: "p-exact", ea_id: "CleanMatch",       platform_gamertag: null,        gamertag: "whatever",          discord_username: "clean" },
];
const PRIOR = {};   // ea_player_id -> profile_id, the "seen before" table

/* PostgREST-faithful stub: eq, single-column ilike, and or=(col.ilike.pat,...) with * wildcards */
const ilike = (val, pat) => {
  if (val == null) return false;
  const rx = new RegExp("^" + pat.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  return rx.test(val);
};
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  const J = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (u.includes("pickup_stats?ea_player_id=eq.") || u.includes("game_stats?ea_player_id=eq.")) {
    const id = u.match(/ea_player_id=eq\.([^&]+)/)[1];
    return J(PRIOR[id] ? [{ profile_id: PRIOR[id] }] : []);
  }
  if (u.includes("profiles?ea_id=ilike.")) {
    const pat = u.match(/ea_id=ilike\.([^&]+)/)[1];
    return J(PROFILES.filter((p) => ilike(p.ea_id, pat)).slice(0, 1).map((p) => ({ id: p.id })));
  }
  if (u.includes("profiles?gamertag=ilike.")) {
    const pat = u.match(/gamertag=ilike\.([^&]+)/)[1];
    return J(PROFILES.filter((p) => ilike(p.gamertag, pat)).slice(0, 1).map((p) => ({ id: p.id })));
  }
  if (u.includes("season_registrations?")) return J([]);
  if (u.includes("profiles?or=(")) {
    const pat = u.match(/ea_id\.ilike\.([^,]+),/)[1];
    const hits = PROFILES.filter((p) => [p.ea_id, p.platform_gamertag, p.gamertag, p.discord_username].some((v) => ilike(v, pat)));
    return J(hits.slice(0, 2).map((p) => ({ id: p.id })));
  }
  return J([]);
};

const pu = (name, eaPlayerId) => PU.resolveProfile({ gamertag: name, ea_player_id: eaPlayerId || name }, new Map());
const lg = (name, eaPlayerId) => LG.resolveProfile({ gamertag: name, ea_player_id: eaPlayerId || name }, "s1", new Map());

console.log("— the four real failure shapes, now caught (pickup resolver)");
{
  A("a space of drift matches (Magsin EH -> MagsinEH)", (await pu("Magsin EH")) === "p-mags");
  A("an emoji-wrapped gamertag matches (PORTA DUMP)", (await pu("PORTA DUMP")) === "p-porta");
  A("a site gamertag matches when ea_id is a variant", (await pu("Some Fat Kid 85")) === "p-fat");
  A("a Discord-only handle matches (Spearing15)", (await pu("Spearing15")) === "p-spear");
}

console.log("\n— the rules that keep it honest");
{
  A("an exact ea_id match still wins first", (await pu("CleanMatch")) === "p-exact");
  A("an ambiguous name links NOBODY", (await pu("Night Owl")) === null);
  A("a total stranger stays unlinked", (await pu("NeverHeardOfHim")) === null);
  PRIOR["seen-before"] = "p-exact";
  A("a prior EA-persona link outranks everything", (await pu("Night Owl", "seen-before")) === "p-exact");
  delete PRIOR["seen-before"];
  A("an empty name never queries anything", (await pu("   ")) === null);
}

console.log("\n— the league resolver walks the same path");
{
  A("space drift", (await lg("Magsin EH")) === "p-mags");
  A("emoji wrap", (await lg("PORTA DUMP")) === "p-porta");
  A("discord handle", (await lg("Spearing15")) === "p-spear");
  A("ambiguity still refuses", (await lg("Night Owl")) === null);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
