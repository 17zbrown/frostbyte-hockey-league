// v463 (Season 2 flip): the Netlify statistics gates ask the database who holds the statistics key, instead of reading
// profiles.departments. Run: node tools/s2-staff-gates-v463.test.mjs
// Rulings (memory s2-staffing-model.md): no departments in Season 2, one staff group where everyone can do any staff role
// (commissioner, 2026-10-19 and 2026-11-23). After the staff powers record (sql/2026-11-24-s2-staff-powers-v463.sql) every
// staff member who is not banned or suspended from staff duties holds the statistics key; a staffer with no departments
// array must pass here exactly where the database says yes, and the old behavior holds until the record applies.
// What must never break: commissioners pass, banned members are refused, the answer is the database's (never the
// departments column), a failed or missing database door refuses (fails closed) and says so in the log.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.INGEST_KEY ||= "machine-key";
process.env.DISCORD_BOT_TOKEN ||= "t";
import fs from "fs";

const { _internals: ING } = await import(new URL("../netlify/functions/ingest-stats.js", import.meta.url).pathname);
const { _internals: DIS } = await import(new URL("../netlify/functions/discord-interactions.js", import.meta.url).pathname);

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  got: " + x : ""}`); };

let PROFILE = null, DB = null, CALLS = [];
const errs = [];
console.error = (m) => errs.push(String(m));
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  CALLS.push({ u, opts });
  if (u.includes("/auth/v1/user")) return J({ id: "u1" });
  if (u.includes("/rest/v1/profiles?id=eq.u1") || u.includes("/rest/v1/profiles?discord_id=eq.d1")) return J(PROFILE ? [PROFILE] : []);
  if (u.includes("/rest/v1/rpc/is_stats_staff") || u.includes("/rest/v1/rpc/profile_has_department")) {
    if (DB === "missing") return J({ code: "PGRST202", message: "Could not find the function" }, 404);
    if (DB === "down") return new Response("upstream down", { status: 500 });
    return J(DB);
  }
  return J({ error: "unexpected " + u }, 500);
};
const rpcCalls = () => CALLS.filter((c) => c.u.includes("/rest/v1/rpc/"));
const ing = async (p, db) => { PROFILE = p; DB = db; CALLS = []; return ING.isStatsStaff("member-jwt"); };
const dis = async (p, db) => { PROFILE = p; DB = db; CALLS = []; return DIS.sbIsStatsStaff("d1"); };

console.log("# ingest-stats: staffActor (the importer desk), under the member's own JWT");
A("a commissioner passes without asking", (await ing({ role: "commissioner", gamertag: "K", banned: false }, false)) === true && rpcCalls().length === 0);
A("a banned commissioner is refused", (await ing({ role: "commissioner", gamertag: "K", banned: true }, true)) === false);
A("a staffer with no departments passes where the database says yes (the flip)", (await ing({ role: "staff", gamertag: "S", banned: false }, true)) === true);
const call = rpcCalls()[0] || { opts: { headers: {} } };
A("...asked as the member: rpc/is_stats_staff with the member's JWT, not the service role",
  /\/rest\/v1\/rpc\/is_stats_staff$/.test(call.u || "") && call.opts.method === "POST" && call.opts.headers.Authorization === "Bearer member-jwt");
A("a staffer listed in statistics is refused where the database says no (the departments column is never read)",
  (await ing({ role: "staff", gamertag: "S", banned: false, departments: ["statistics"] }, false)) === false);
A("...and the profile read asks for no departments", CALLS.some((c) => /profiles\?id=eq\.u1&select=role,gamertag,banned&limit=1/.test(c.u)) && !CALLS.some((c) => /departments/.test(c.u)));
A("a banned staffer is refused before the question", (await ing({ role: "staff", gamertag: "S", banned: true }, true)) === false && rpcCalls().length === 0);
A("a member is refused (the database says no)", (await ing({ role: "member", gamertag: "M", banned: false }, false)) === false);
errs.length = 0;
A("a failing database refuses, and logs it", (await ing({ role: "staff", gamertag: "S", banned: false }, "down")) === false && errs.some((e) => /is_stats_staff -> 500/.test(e)));
A("authForGame follows the same answer", (await (async () => { PROFILE = { role: "staff", gamertag: "S", banned: false }; DB = true; return ING.authForGame("member-jwt", { id: "g1" }); })()).ok === true);

console.log("# discord-interactions: the pickup lobby delete gate, with the service role (a Discord click has no JWT)");
A("a commissioner passes without asking", (await dis({ id: "p1", role: "commissioner", banned: false }, false)) === true && rpcCalls().length === 0);
A("a banned member is refused before the question", (await dis({ id: "p1", role: "staff", banned: true }, true)) === false && rpcCalls().length === 0);
A("a staffer with no departments passes where the database says yes", (await dis({ id: "p1", role: "staff", banned: false }, true)) === true);
const body = JSON.parse((rpcCalls()[0] || { opts: { body: "{}" } }).opts.body);
A("...asking profile_has_department for that profile and the statistics key", /\/rest\/v1\/rpc\/profile_has_department$/.test((rpcCalls()[0] || {}).u || "")
  && body.p_profile === "p1" && body.p_key === "statistics");
A("a staffer is refused where the database says no", (await dis({ id: "p1", role: "staff", banned: false, departments: ["statistics"] }, false)) === false);
errs.length = 0;
A("before the staff powers record applies (no such door) a staffer is refused and it is logged; a commissioner still passes",
  (await dis({ id: "p1", role: "staff", banned: false }, "missing")) === false && errs.some((e) => /lobby delete gate/.test(e))
  && (await dis({ id: "p1", role: "commissioner", banned: false }, "missing")) === true);
A("an unknown Discord id is refused", (await dis(null, true)) === false);

console.log("# no second list");
const ingest = fs.readFileSync(new URL("../netlify/functions/ingest-stats.js", import.meta.url), "utf8");
const interactions = fs.readFileSync(new URL("../netlify/functions/discord-interactions.js", import.meta.url), "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
A("neither gate reads a departments list any more", !/departments/.test(code(ingest)) && !/departments/.test(code(interactions.slice(interactions.indexOf("async function sbIsStatsStaff"), interactions.indexOf("/* ---------- Discord REST")))));
A("the door they ask is the staff powers record's, service role only",
  /grant execute on function public\.profile_has_department\(uuid, text\) to service_role;/.test(fs.readFileSync(new URL("../sql/2026-11-24-s2-staff-powers-v463.sql", import.meta.url), "utf8")));

console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
