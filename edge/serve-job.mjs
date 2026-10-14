// The one door every scheduled job goes through on Supabase (v4.06). pg_cron calls public.invoke_edge_job(<job>) on the
// job's schedule, and that POSTs here with the cron key, which exists only in the database's Vault. This file:
//   1. answers 404 to anything that is not a POST carrying a key of the right shape, before any I/O, so a stranger's
//      request costs one invocation and learns nothing (the same miss = 404 rule as opsKeyOk in jobs/discord-sync.js);
//   2. asks the database for the run (public.job_lease). The key is checked there. A job whose host is still Netlify
//      answers "standby", and a run already in progress answers "busy", so one job never runs twice at once on any host;
//   3. answers 202 at once and runs the job in the background (EdgeRuntime.waitUntil), handing it a clean request, so
//      nothing in the caller's URL or body can reach a job (discord-scheduler's ?run= and &dry= stay unreachable);
//   4. holds the run with a short lease it renews while the job works (public.job_renew), so a worker that dies mid-run
//      blocks the job for at most one more tick, and the next grant records the run as lost;
//   5. always hands the run back (public.job_release) with how it went. A crash, a 5xx, a missing secret or a worker the
//      platform stops mid-run (its CPU or time limit, a deploy) is recorded there and the database watchdog pages on it.
// x-cron-probe: 1 (public.invoke_edge_job(<job>, true)) checks the setup without running the job: which secrets are set
// (yes or no only), whether Discord and Twitch accept them (status codes only), and the runtime features the jobs use.
//
// Env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase sets both), plus each job's own secrets.
import process from "node:process";
import crypto from "node:crypto";

/* stamped by tools/edge/build.mjs (edge/recipe.cjs); "dev" when this file runs unbundled, as in the tests */
const BUILD = typeof __CGHL_EDGE_BUILD__ === "string" ? __CGHL_EDGE_BUILD__ : "dev";
const KEY_SHAPE = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/* The run's lease, renewed every RENEW_MS while the job works. Short, so a worker that dies without handing the run back
   (killed past its CPU or time limit) blocks at most the next tick; renewed, so a long run is never overlapped. */
export const LEASE_S = 90;
export const RENEW_MS = 30000;
const UA = "DiscordBot (https://chelgamingleague.com,1.0)";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const notFound = () => new Response("Not found", { status: 404 });
const env = (k) => process.env[k];
const short = (e, n = 300) => String((e && e.message) || e).slice(0, n);

async function rpc(name, args) {
  const SB_URL = env("SUPABASE_URL"), SB_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`rpc ${name} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

export function secretsReport(needs) {
  return Object.fromEntries(needs.map((n) => [n, !!env(n)]));
}

/* The jobs return 200 with a "skipped: missing env" note when a secret was absent as they loaded. That is a failed run,
   never a quiet one (the secret may have been added after this worker started; it starts fresh on the next deploy). */
const MISSING_ENV = /missing (supabase )?env/i;

/* runs in progress in this worker, so a shutdown can hand them back as failed (onShutdown below) */
const inflight = new Map();

export async function runOnce(fn, run, needs, holder, release = rpc) {
  const t0 = Date.now();
  let ok = true, error = null;
  inflight.set(holder, fn);
  const renew = setInterval(() => {
    release("job_renew", { p_fn: fn, p_holder: holder, p_ttl_s: LEASE_S }).catch((e) => console.error(`${fn}: lease renewal failed: ${short(e)}`));
  }, RENEW_MS);
  try {
    const missing = needs.filter((n) => !env(n));
    if (missing.length) {
      throw new Error(`missing secret${missing.length > 1 ? "s" : ""} ${missing.join(", ")} (Supabase Dashboard, Edge Functions, Secrets)`);
    }
    const res = await run(new Request(`http://edge.invalid/${fn}`));
    if (!res || typeof res.status !== "number") throw new Error("the job returned no response");
    const text = await res.clone().text().catch(() => "");
    if (res.status >= 500) { ok = false; error = `answered ${res.status}: ${text.slice(0, 200)}`; }
    else if (MISSING_ENV.test(text.slice(0, 200))) { ok = false; error = `skipped for missing settings: ${text.slice(0, 200)}`; }
  } catch (e) { ok = false; error = short(e); }
  finally { clearInterval(renew); }
  if (!ok) console.error(`${fn}: ${error}`);
  try { await release("job_release", { p_fn: fn, p_holder: holder, p_ok: ok, p_error: error, p_ms: Date.now() - t0 }); }
  catch (e) { console.error(`${fn}: could not hand the run back: ${short(e)}`); }
  inflight.delete(holder);
  return { ok, error };
}

/* Supabase announces a worker's shutdown with a beforeunload event naming the reason (CPUTime, WallClockTime, Memory,
   TerminationRequested...). A run still going at that moment is lost: hand it back as failed, naming why, so the
   watchdog pages with the cause instead of only noticing a run that never finished. Best effort; if even this cannot
   reach the database, the next grant records the run as lost. */
export function onShutdown(ev, release = rpc) {
  const why = (ev && ev.detail && ev.detail.reason) || "shutdown";
  const sent = [];
  for (const [holder, fn] of inflight) {
    console.error(`${fn}: the worker is stopping mid-run (${why})`);
    sent.push(release("job_release", { p_fn: fn, p_holder: holder, p_ok: false, p_error: `the worker was stopped mid-run (${why})`, p_ms: null }).catch(() => {}));
  }
  inflight.clear();
  return Promise.all(sent);
}

/* What the probe can say without running the job. Status codes and yes/no only: nothing secret ever leaves. */
export async function probe(fn, needs) {
  const out = { fn, build: BUILD, secrets: secretsReport(needs), runtime: {}, checks: {} };
  try { out.runtime.deno = (globalThis.Deno && globalThis.Deno.version && globalThis.Deno.version.deno) || null; } catch (e) { out.runtime.deno = null; }
  out.runtime.region = env("SB_REGION") || null;
  try {
    /* 17:00 UTC on Jan 15 is noon in New York; every Eastern-time gate in the jobs depends on this zone data */
    out.runtime.easternTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" })
      .format(new Date("2026-01-15T17:00:00Z")) === "12";
  } catch (e) { out.runtime.easternTime = false; }
  try { out.runtime.sha256 = crypto.createHash("sha256").update("x").digest("hex").slice(0, 8) === "2d711642"; }
  catch (e) { out.runtime.sha256 = false; }
  out.runtime.waitUntil = !!(globalThis.EdgeRuntime && typeof globalThis.EdgeRuntime.waitUntil === "function");
  if (needs.includes("DISCORD_BOT_TOKEN") && env("DISCORD_BOT_TOKEN")) {
    try {
      const r = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${env("DISCORD_BOT_TOKEN")}`, "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
      out.checks.discord = r.status;
    } catch (e) { out.checks.discord = short(e, 120); }
  }
  if (needs.includes("TWITCH_CLIENT_SECRET") && env("TWITCH_CLIENT_ID") && env("TWITCH_CLIENT_SECRET")) {
    try {
      const r = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: env("TWITCH_CLIENT_ID"), client_secret: env("TWITCH_CLIENT_SECRET"), grant_type: "client_credentials" }),
        signal: AbortSignal.timeout(10000) });
      out.checks.twitch = r.status;
      await r.body?.cancel?.();
    } catch (e) { out.checks.twitch = short(e, 120); }
  }
  return out;
}

/* The request handler, separate from Deno.serve so tools/edge-wrapper.test.mjs can drive it. */
export function makeHandler({ fn, run, needs = [], call = rpc, waitUntil }) {
  const later = waitUntil || ((p) => {
    try { if (globalThis.EdgeRuntime && typeof globalThis.EdgeRuntime.waitUntil === "function") return globalThis.EdgeRuntime.waitUntil(p); }
    catch (e) { /* fall through: the promise still runs */ }
    return p;
  });
  return async (req) => {
    if (String(req.method || "").toUpperCase() !== "POST") return notFound();
    const key = String(req.headers.get("x-cron-key") || "").trim();
    if (!KEY_SHAPE.test(key)) return notFound();
    if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) return json({ error: "Supabase environment missing" }, 500);
    const isProbe = req.headers.get("x-cron-probe") === "1";
    /* whether every secret this job needs is set: the database will not let a job move here until it is (job_hosts) */
    const ready = needs.every((n) => !!env(n));
    let lease;
    try {
      lease = await call("job_lease", { p_fn: fn, p_host: "edge", p_build: BUILD, p_ttl_s: LEASE_S, p_key: key, p_probe: isProbe, p_ready: ready });
    } catch (e) {
      console.error(`${fn}: lease failed: ${short(e)}`);
      return json({ error: "lease failed", detail: short(e, 160) }, 503);
    }
    if (lease === "denied") return notFound();
    if (isProbe) return json(await probe(fn, needs));
    if (lease === "standby" || lease === "busy") return json({ skipped: lease, fn, build: BUILD, secrets: secretsReport(needs) });
    if (!UUID.test(String(lease))) return json({ error: "unexpected lease answer", fn }, 500);
    later(runOnce(fn, run, needs, lease, call));
    return json({ started: true, fn, build: BUILD }, 202);
  };
}

export function serveJob(opts) {
  try { globalThis.addEventListener("beforeunload", (ev) => { onShutdown(ev); }); } catch (e) { /* not on this runtime */ }
  globalThis.Deno.serve(makeHandler(opts));
}
