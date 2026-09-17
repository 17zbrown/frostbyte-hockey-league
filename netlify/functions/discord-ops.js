// Netlify Function (HTTP): /api/discord-ops — the request-reachable door to the Discord sweep.
//
// discord-sync.js is a SCHEDULED function, and Netlify refuses external HTTP calls to those: its
// ?diag= / ?register= / ?setup= / ?reconcile= branches, the site's instant-sync POST and the
// Control Center's "Run now" all answered 403 for weeks without anyone noticing (P2-0 in the
// 2026-09-17 audit). This function is an ordinary HTTP function that imports the same code, so
// there is still exactly one implementation of every op — this file only routes and gates.
//
//   GET  /api/discord-ops?diag=guild|staff|teamrooms|rolecheck   read-only diagnostics
//   GET  /api/discord-ops?register=commands                      (re)register the guild slash commands
//   GET  /api/discord-ops?setup=community|staffmod               one-shot guild configuration
//   GET  /api/discord-ops?reconcile=teams                        prune/provision the Team Rooms
//   POST /api/discord-ops?run=now                                run the sweep now (GET works too)
//
// The key: app_config.diag_key, sent as ?key=… or the x-diag-key header — the same check those
// branches always had. A missing or wrong key is a 404, never a 401, so a probe learns nothing.
// run=now ALSO accepts a signed-in member's Supabase session (Authorization: Bearer <jwt>), because
// the site fires it after a role-affecting write on the member's own behalf and the page cannot
// hold a secret; the sweep debounces itself to one run per six seconds regardless of caller.
//
// Env: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (SUPABASE_ANON_KEY
// as the apikey for session checks when set). Node 18+.
import { OPS_ROUTES, runOp, opsKeyOk, runSweep } from "./discord-sync.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_ANON = process.env.SUPABASE_ANON_KEY || SB_KEY;

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
const notFound = () => new Response("Not found", { status: 404 });

/* A Supabase session is proven the way ingest-stats.js proves one: ask GoTrue who the bearer is.
   Any signed-in member qualifies for run=now — nothing about the sweep is scoped to the caller,
   and the old scheduled endpoint accepted the same ping from anyone at all. */
async function sessionOk(req) {
  if (!SB_URL || !SB_ANON) return false;
  const auth = (req.headers && typeof req.headers.get === "function" && req.headers.get("authorization")) || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return false;
  /* a bearer that IS the service key is never a session — refuse it rather than mint a run for it */
  if (m[1] === SB_KEY) return false;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${m[1]}` }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return false;
    const u = await r.json();
    return !!(u && u.id);
  } catch (e) { return false; }
}

export default async (req) => {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") return json({ error: "Method not allowed" }, 405);
  const params = (() => { try { return new URL(req.url).searchParams; } catch { return new URLSearchParams(); } })();

  /* run=now: the ops key or a member session; nothing else reaches the sweep */
  if (params.get("run") === "now") {
    if (!(await opsKeyOk(req)) && !(await sessionOk(req))) return notFound();
    const r = await runSweep();
    return json(r.body, r.status);
  }

  /* everything else is an op from the routing table, key-gated */
  let op = null;
  for (const param of Object.keys(OPS_ROUTES)) {
    const v = params.get(param);
    if (v && OPS_ROUTES[param][v]) { op = OPS_ROUTES[param][v]; break; }
  }
  if (!op) return notFound();
  if (!(await opsKeyOk(req))) return notFound();
  const r = await runOp(op);
  return json(r.body, r.status);
};
