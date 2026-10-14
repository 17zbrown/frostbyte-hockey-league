// One host at a time (v4.06). While the scheduled jobs move from Netlify to Supabase, Netlify keeps its schedules as
// stand-ins (netlify/functions/<job>.js) and discord-ops keeps its run=now door. Before any of them runs a job it asks the
// database for the run, exactly as the Supabase wrapper does (edge/serve-job.mjs): public.job_lease answers with a holder
// id only when public.job_hosts names Netlify as the job's host and no run of that job is in progress anywhere.
// Otherwise it answers "standby" or "busy" and nothing runs here. Switching a job is one row in the database, in either
// direction, with no deploy.
//
// Fails CLOSED: if the database cannot be asked, the job does not run here. A job that can't reach the database
// can't do its work anyway, and running blind is how two hosts would end up running it at once.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/* Netlify stops a scheduled function at 30 s and an HTTP function (discord-ops) at 60 s. Each lease outlives its caller's
   limit, so a run Netlify kills is never overlapped by the next one. */
export const NETLIFY_LEASE_S = 40;
export const NETLIFY_HTTP_LEASE_S = 75;

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

export async function hostRpc(name, args) {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_KEY) throw new Error("Supabase environment missing");
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`rpc ${name} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

/* Runs `run` (which returns a Response) only while this job's host is Netlify. `onStandby` answers instead when the
   job's host is Supabase (discord-ops hands its run=now to the database there). `ttlS` is the lease: the scheduled
   stand-ins keep the default, discord-ops passes NETLIFY_HTTP_LEASE_S. */
export async function onActiveHost(fn, run, { onStandby, call = hostRpc, ttlS = NETLIFY_LEASE_S } = {}) {
  let lease;
  try { lease = await call("job_lease", { p_fn: fn, p_host: "netlify", p_build: "netlify", p_ttl_s: ttlS }); }
  catch (e) {
    console.error(`${fn}: host check failed, not running: ${String(e.message || e)}`);
    return json({ error: `host check failed: ${String(e.message || e).slice(0, 160)}` }, 503);
  }
  if (lease === "standby" && onStandby) return onStandby();
  if (!UUID.test(String(lease))) return json({ skipped: String(lease) });
  const t0 = Date.now();
  let res, ok = true, error = null;
  try {
    res = await run();
    if (!res || res.status >= 500) { ok = false; error = `answered ${res ? res.status : "nothing"}`; }
  } catch (e) {
    ok = false; error = String(e.message || e).slice(0, 300);
    res = json({ error }, 500);
  }
  try { await call("job_release", { p_fn: fn, p_holder: lease, p_ok: ok, p_error: error, p_ms: Date.now() - t0 }); }
  catch (e) { console.error(`${fn}: could not hand the run back: ${String(e.message || e)}`); }
  return res;
}
