// The request-reachable door to the Discord sweep, and the discord-join gate.
// Run: node tools/discord-ops.test.mjs
//
// discord-sync is a scheduled function and Netlify refuses external HTTP to it, so its diag /
// register / setup / reconcile / run-now branches were dead (P2-0). discord-ops.js is the HTTP
// function that reaches them; this pins its contract and its gate. discord-join.js was reachable
// by anyone (P2-14); this pins that a POST needs a session and the GET diagnostic needs the key.
process.env.SUPABASE_URL = "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.SUPABASE_ANON_KEY = "anon-key";
process.env.DISCORD_BOT_TOKEN = "t";
process.env.DISCORD_GUILD_ID = "guild1";

import fs from "node:fs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

let cfg = { diag_key: "the-key" }, discordCalls = [], authChecks = [], validJwt = "good-jwt";
function reset() { cfg = { diag_key: "the-key" }; discordCalls = []; authChecks = []; validJwt = "good-jwt"; }
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = (opts.method || "GET").toUpperCase();
  if (u.includes("/auth/v1/user")) {
    const bearer = String((opts.headers || {}).Authorization || "").replace(/^Bearer /, "");
    authChecks.push({ bearer, apikey: (opts.headers || {}).apikey });
    return bearer === validJwt ? J({ id: "user-1" }) : J({ msg: "invalid" }, 401);
  }
  if (u.includes("/rest/v1/app_config")) {
    if (m === "GET") { const eq = u.match(/key=eq\.([^&]+)/); return J(eq && cfg[eq[1]] !== undefined ? [{ value: cfg[eq[1]] }] : []); }
    if (m === "POST") { const b = JSON.parse(opts.body); cfg[b.key] = b.value; return new Response(null, { status: 201 }); }
  }
  if (u.includes("/rest/v1/")) return J([]);
  if (u.includes("discord.com/api")) {
    discordCalls.push({ m, path: u.split("/api/v10")[1] });
    if (/\/roles$/.test(u)) return J([{ id: "guild1", name: "@everyone", permissions: "0", position: 0 }, { id: "r1", name: "Commissioner", permissions: "8", position: 5, color: 0 }]);
    if (/\/channels$/.test(u) && m === "GET") return J([{ id: "c1", name: "general-chat", type: 0, position: 1, permission_overwrites: [] }]);
    if (/\/applications\/@me$/.test(u)) return J({ id: "app1" });
    if (/\/commands$/.test(u) && m === "PUT") return J([{ name: "join" }, { name: "leave" }]);
    if (/\/guilds\/guild1$/.test(u)) return J({ id: "guild1", name: "CGHL", features: [] });
    if (/\/users\/@me$/.test(u)) return J({ id: "bot1", username: "Chel" });
    if (/\/members\//.test(u)) return J({ roles: [] });
    return J([]);
  }
  return J([]);
};

const ops = (await import(new URL("../netlify/functions/discord-ops.js", import.meta.url).pathname)).default;
const { handler: join } = await import(new URL("../netlify/functions/discord-join.js", import.meta.url).pathname);
const req = (qs, init = {}) => new Request("https://chelgamingleague.com/api/discord-ops" + qs, init);

console.log("— the ops door: nothing without the key, and a miss is a 404 (never a 401)");
{
  reset();
  let r = await ops(req("?diag=guild"));
  A("no key -> 404", r.status === 404);
  A("...and Discord was never called", discordCalls.length === 0);
  r = await ops(req("?diag=guild&key=wrong"));
  A("wrong key -> 404", r.status === 404 && discordCalls.length === 0);
  r = await ops(req("?diag=guild", { headers: { "x-diag-key": "wrong" } }));
  A("wrong header key -> 404", r.status === 404);
  cfg.diag_key = undefined;
  r = await ops(req("?diag=guild&key=anything"));
  A("no key on file -> nothing reachable", r.status === 404);
  reset();
  r = await ops(req("?nonsense=1&key=the-key"));
  A("an unknown parameter -> 404 even with the key", r.status === 404);
  r = await ops(req("?diag=members&key=the-key"));
  A("an unknown value -> 404 even with the key", r.status === 404);
  r = await ops(req("?diag=guild", { method: "DELETE" }));
  A("a method other than GET/POST -> 405", r.status === 405);
  r = await ops(req(""));
  A("a bare call -> 404", r.status === 404);
}

console.log("\n— the ops door: with the key, every old entry point answers");
{
  reset();
  let r = await ops(req("?diag=guild&key=the-key"));
  let body = await r.json();
  A("?diag=guild (query key) -> 200 with the structure dump", r.status === 200 && Array.isArray(body.roles) && Array.isArray(body.channels), JSON.stringify(body).slice(0, 120));
  A("...names only, no ids", !JSON.stringify(body).includes('"id"'));
  reset();
  r = await ops(req("?diag=guild", { headers: { "x-diag-key": "the-key" } }));
  A("?diag=guild (header key) -> 200", r.status === 200);
  reset();
  r = await ops(req("?register=commands&key=the-key"));
  body = await r.json();
  A("?register=commands -> the bulk overwrite is sent and echoed", r.status === 200 && body.appId === "app1" && body.registered.includes("join"),
    JSON.stringify(body));
  A("...via PUT /applications/{id}/guilds/{guild}/commands", discordCalls.some((c) => c.m === "PUT" && c.path === "/applications/app1/guilds/guild1/commands"));
  reset();
  r = await ops(req("?diag=staff&key=the-key"));
  A("?diag=staff -> 200", r.status === 200 && Array.isArray((await r.json()).staffChannels));
  reset();
  r = await ops(req("?diag=teamrooms&key=the-key"));
  A("?diag=teamrooms -> 200", r.status === 200 && /clean|room/.test((await r.json()).verdict));
  reset();
  r = await ops(req("?setup=staffmod&key=the-key"));
  body = await r.json();
  A("?setup=staffmod -> 200 (reports the missing role rather than throwing)", r.status === 200 && body.error === "staff role not found", JSON.stringify(body));
  reset();
  r = await ops(req("?reconcile=teams&key=the-key"));
  body = await r.json();
  A("?reconcile=teams -> 200 with the reconcile report", r.status === 200 && Array.isArray(body.deletedRooms) && Array.isArray(body.errors), JSON.stringify(body).slice(0, 120));
  A("...which names the missing category rather than inventing one", body.errors.some((e) => e.teamRooms === "category not found"));
  /* the routing table is the contract the site is re-pointed to */
  const { OPS_ROUTES } = await import(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname);
  A("the routing table lists exactly the old entry points",
    JSON.stringify(OPS_ROUTES) === JSON.stringify({ diag: { guild: "diagGuild", staff: "diagStaff", teamrooms: "diagTeamrooms", rolecheck: "diagRolecheck" },
      register: { commands: "registerCommands" }, setup: { community: "setupCommunity", staffmod: "setupStaffmod" }, reconcile: { teams: "reconcileTeams" } }),
    JSON.stringify(OPS_ROUTES));
}

console.log("\n— run=now: the key or a member session; the service key is never a session");
{
  reset();
  let r = await ops(req("?run=now", { method: "POST" }));
  A("anonymous run=now -> 404", r.status === 404 && !cfg["rl_discord-sync_started"]);
  reset();
  r = await ops(req("?run=now", { method: "POST", headers: { authorization: "Bearer bad-jwt" } }));
  A("a bad session -> 404", r.status === 404 && authChecks.length === 1 && !cfg["rl_discord-sync_started"]);
  A("...checked against GoTrue with the anon apikey", authChecks[0].apikey === "anon-key" && authChecks[0].bearer === "bad-jwt");
  reset();
  r = await ops(req("?run=now", { method: "POST", headers: { authorization: "Bearer service-key" } }));
  A("the service key presented as a bearer -> 404, and GoTrue is not even asked", r.status === 404 && authChecks.length === 0);
  reset();
  r = await ops(req("?run=now", { method: "POST", headers: { authorization: "Bearer good-jwt" } }));
  A("a valid member session reaches the sweep (the start stamp is written)", r.status !== 404 && !!cfg["rl_discord-sync_started"], String(r.status));
  A("...and the sweep's own debounce heartbeat too", !!cfg["rl_discord-sync"]);
  reset();
  r = await ops(req("?run=now&key=the-key"));
  A("the ops key reaches the sweep as well, by GET", r.status !== 404 && !!cfg["rl_discord-sync_started"]);
  reset();
  cfg["rl_discord-sync"] = new Date().toISOString();
  r = await ops(req("?run=now&key=the-key"));
  A("a run moments after the last is debounced, not re-run", r.status === 200 && (await r.json()).skipped === "ran moments ago");
}

console.log("\n— the redirect and the wiring");
{
  const toml = fs.readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  A("netlify.toml routes /api/discord-ops to the function with status 200",
    /from = "\/api\/discord-ops"\s*\n\s*to = "\/\.netlify\/functions\/discord-ops"\s*\n\s*status = 200/.test(toml));
  const opsSrc = fs.readFileSync(new URL("../netlify/functions/discord-ops.js", import.meta.url), "utf8");
  A("discord-ops carries no schedule (it must stay HTTP-invocable)", !/schedule:/.test(opsSrc));
  A("...and imports the sweep rather than copying it", /from "\.\/discord-sync\.js"/.test(opsSrc) && !/async function ensure|dApi\(/.test(opsSrc));
  const syncSrc = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");
  A("discord-sync no longer parses a request of its own", !/req\.url/.test(syncSrc.slice(syncSrc.indexOf("export async function runSweep"))));
}

console.log("\n— discord-join: a session for the POST, the ops key for the diagnostic, 401 otherwise");
{
  const ev = (method, extra = {}) => ({ httpMethod: method, headers: {}, queryStringParameters: {}, body: null, ...extra });
  reset();
  let r = await join(ev("GET"));
  A("GET without the key -> 401", r.statusCode === 401);
  A("...with no Discord call and no app_config write", discordCalls.length === 0 && !cfg["rl_discord-join_result"]);
  reset();
  r = await join(ev("GET", { queryStringParameters: { key: "the-key" } }));
  A("GET with the key -> the diagnostic", r.statusCode === 200 && !!JSON.parse(r.body).diagnostic);
  reset();
  r = await join(ev("GET", { headers: { "X-Diag-Key": "the-key" } }));
  A("...the header form works, in any case", r.statusCode === 200);
  reset();
  r = await join(ev("POST", { body: JSON.stringify({ access_token: "discord-oauth" }) }));
  A("POST without a session -> 401", r.statusCode === 401);
  A("...before any Discord call (the bot's invalid-request budget is not spent)", discordCalls.length === 0 && authChecks.length === 0);
  reset();
  r = await join(ev("POST", { headers: { authorization: "Bearer bad-jwt" }, body: JSON.stringify({ access_token: "discord-oauth" }) }));
  A("POST with a bad session -> 401", r.statusCode === 401 && authChecks.length === 1 && discordCalls.length === 0);
  reset();
  r = await join(ev("POST", { headers: { Authorization: "Bearer service-key" }, body: JSON.stringify({ access_token: "discord-oauth" }) }));
  A("the service key is not a session here either", r.statusCode === 401 && authChecks.length === 0);
  reset();
  r = await join(ev("POST", { headers: { Authorization: "Bearer good-jwt" }, body: JSON.stringify({}) }));
  A("a valid session passes the gate (the next check, the missing token, answers)", r.statusCode === 400 && /access_token/.test(r.body));
  reset();
  r = await join(ev("PUT"));
  A("any other method -> 401", r.statusCode === 401);
  reset();
  r = await join(ev("POST", { queryStringParameters: { diag: "1" } }));
  A("?diag=1 on a POST is the diagnostic, so it needs the key too", r.statusCode === 401);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
