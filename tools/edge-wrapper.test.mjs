// v4.06: the door every Supabase job goes through (edge/serve-job.mjs) and Netlify's side of the host switch
// (jobs/host-gate.mjs). Run: node tools/edge-wrapper.test.mjs
//
// The wrapper is the only thing between the public internet and five jobs that write to Discord and the database, and the
// lease is the only thing keeping two hosts from running one job at once. This drives both with a fake database.
process.env.SUPABASE_URL = "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
delete process.env.DISCORD_BOT_TOKEN;

const { makeHandler, runOnce, onShutdown, LEASE_S, RENEW_MS } = await import(new URL("../edge/serve-job.mjs", import.meta.url).pathname);
const { onActiveHost, NETLIFY_LEASE_S, NETLIFY_HTTP_LEASE_S } = await import(new URL("../jobs/host-gate.mjs", import.meta.url).pathname);

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const KEY = "a".repeat(64), HOLDER = "11111111-2222-4333-8444-555555555555";
const post = (headers = {}, url = "https://bz.supabase.co/functions/v1/lfg-timers") => new Request(url, { method: "POST", headers });

function harness({ lease = HOLDER, job } = {}) {
  const calls = [], runs = [], later = [];
  const call = async (name, args) => {
    calls.push({ name, args });
    if (name === "job_lease") { if (typeof lease === "function") return lease(args); if (lease instanceof Error) throw lease; return lease; }
    if (name === "job_release") return true;
    throw new Error("unexpected rpc " + name);
  };
  const run = job || (async (req) => { runs.push(req.url); return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
  const h = makeHandler({ fn: "lfg-timers", run, needs: [], call, waitUntil: (p) => later.push(p) });
  return { h, calls, runs, later, settle: () => Promise.all(later) };
}

console.log("— the door: strangers get a 404 before any database call");
{
  let t = harness();
  let r = await t.h(new Request("https://x/", { method: "GET" }));
  A("GET -> 404", r.status === 404 && t.calls.length === 0);
  r = await t.h(post());
  A("POST without a key -> 404, no database call", r.status === 404 && t.calls.length === 0);
  r = await t.h(post({ "x-cron-key": "short" }));
  A("a key of the wrong shape -> 404, no database call", r.status === 404 && t.calls.length === 0);
  r = await t.h(post({ "x-cron-key": KEY.toUpperCase() }));
  A("...upper-case hex is the wrong shape too", r.status === 404 && t.calls.length === 0);
  t = harness({ lease: "denied" });
  r = await t.h(post({ "x-cron-key": KEY }));
  A("a well-formed but wrong key -> 404 (the database said denied)", r.status === 404 && t.runs.length === 0);
  A("...the key went to job_lease, asked as the Edge host with the Edge lease", t.calls[0].args.p_key === KEY && t.calls[0].args.p_host === "edge" && t.calls[0].args.p_ttl_s === LEASE_S);
  A("...and said whether every secret the job needs is set", t.calls[0].args.p_ready === true);
  /* v4.06 review: a 420 s lease let a worker killed mid-run block the job for three ticks with no record. The lease is
     short and renewed while the job works, so a dead run blocks at most the next tick and a long one is never overlapped. */
  A("the Edge lease is shorter than the 2-minute tick and renewed well inside it", LEASE_S < 120 && RENEW_MS * 2 < LEASE_S * 1000);
}

console.log("\n— the lease decides; the job runs only with a holder id");
{
  let t = harness({ lease: "standby" });
  let r = await t.h(post({ "x-cron-key": KEY }));
  let b = await r.json();
  A("host still Netlify -> 200 standby, job not run", r.status === 200 && b.skipped === "standby" && t.runs.length === 0 && t.later.length === 0);
  A("...and the answer says which secrets are set, as yes or no only", b.secrets && typeof b.secrets === "object");
  t = harness({ lease: "busy" });
  r = await t.h(post({ "x-cron-key": KEY }));
  A("a run in progress -> 200 busy, job not run", r.status === 200 && (await r.json()).skipped === "busy" && t.runs.length === 0);
  t = harness({ lease: "something odd" });
  r = await t.h(post({ "x-cron-key": KEY }));
  A("an answer that is not a holder id -> 500, job not run", r.status === 500 && t.runs.length === 0);
  t = harness({ lease: new Error("rpc job_lease -> 503") });
  r = await t.h(post({ "x-cron-key": KEY }));
  A("the database cannot be asked -> 503, job not run (fails closed)", r.status === 503 && t.runs.length === 0);
  t = harness();
  r = await t.h(post({ "x-cron-key": KEY }, "https://bz.supabase.co/functions/v1/lfg-timers?run=casework&dry=1"));
  A("granted -> 202 at once, the run continues in the background", r.status === 202 && t.later.length === 1);
  await t.settle();
  A("...the job ran exactly once", t.runs.length === 1);
  A("...with a clean request: nothing of the caller's URL reaches it", t.runs[0] === "http://edge.invalid/lfg-timers");
  const rel = t.calls.find((c) => c.name === "job_release");
  A("...and the run was handed back as ok", rel && rel.args.p_holder === HOLDER && rel.args.p_ok === true && rel.args.p_error === null && typeof rel.args.p_ms === "number");
}

console.log("\n— a failed run is recorded as failed, and the run is always handed back");
{
  const cases = [
    ["the job throws", async () => { throw new Error("boom"); }, /boom/],
    ["the job answers 500", async () => new Response("{\"error\":\"x\"}", { status: 500 }), /answered 500/],
    ["the job answers nothing", async () => undefined, /no response/],
    ["the job skipped for missing settings", async () => new Response("skipped: missing env", { status: 200 }), /missing settings/],
  ];
  for (const [label, job, re] of cases) {
    const t = harness({ job });
    const r = await t.h(post({ "x-cron-key": KEY }));
    await t.settle();
    const rel = t.calls.find((c) => c.name === "job_release");
    A(`${label} -> released with ok false`, r.status === 202 && rel && rel.args.p_ok === false && re.test(rel.args.p_error), rel && rel.args.p_error);
  }
  const calls = [];
  const res = await runOnce("discord-sync", async () => new Response("{}"), ["DISCORD_BOT_TOKEN"], HOLDER, async (n, a) => { calls.push({ n, a }); return true; });
  A("a missing secret fails the run without starting the job, naming the secret", !res.ok && /DISCORD_BOT_TOKEN/.test(res.error) && calls[0].a.p_ok === false);
  const res2 = await runOnce("lfg-timers", async () => new Response("{}"), [], HOLDER, async () => { throw new Error("db down"); });
  A("a release that fails does not throw out of the run", res2.ok === true);
}

console.log("\n— a long run keeps its lease; a worker that stops mid-run hands its runs back as failed");
{
  const calls = [];
  let finish;
  const done = new Promise((r) => { finish = r; });
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  let tick = null, cleared = false;
  globalThis.setInterval = (fn, ms) => { tick = { fn, ms }; return 7; };
  globalThis.clearInterval = (id) => { if (id === 7) cleared = true; };
  const p = runOnce("discord-sync", () => done, [], HOLDER, async (n, a) => { calls.push({ n, a }); return true; });
  A("the renewal is scheduled every RENEW_MS", tick && tick.ms === RENEW_MS);
  await tick.fn();
  A("...and renews this holder's lease by LEASE_S", calls.some((c) => c.n === "job_renew" && c.a.p_holder === HOLDER && c.a.p_ttl_s === LEASE_S));
  const shut = [];
  await onShutdown({ detail: { reason: "CPUTime" } }, async (n, a) => { shut.push({ n, a }); return true; });
  A("a shutdown mid-run hands the run back as failed, naming the reason",
    shut.length === 1 && shut[0].n === "job_release" && shut[0].a.p_holder === HOLDER && shut[0].a.p_ok === false && /CPUTime/.test(shut[0].a.p_error));
  finish(new Response("{}"));
  await p;
  A("...and the renewal stops when the run ends", cleared);
  globalThis.setInterval = realSet; globalThis.clearInterval = realClear;
  const shut2 = [];
  await onShutdown({ detail: { reason: "EarlyDrop" } }, async (n, a) => { shut2.push(a); return true; });
  A("a shutdown with nothing running hands nothing back", shut2.length === 0);
}

console.log("\n— the probe checks the setup and never runs the job");
{
  const t = harness({ lease: (a) => (a.p_probe ? "ok" : HOLDER) });
  const r = await t.h(post({ "x-cron-key": KEY, "x-cron-probe": "1" }));
  const b = await r.json();
  A("probe -> 200 with the runtime checks", r.status === 200 && b.runtime && b.runtime.easternTime === true && b.runtime.sha256 === true, JSON.stringify(b));
  A("...asked as a probe, and the job never ran", t.calls[0].args.p_probe === true && t.runs.length === 0 && t.later.length === 0);
  A("...and nothing in it is a secret value", !JSON.stringify(b).includes("service-key"));
}

console.log("\n— Netlify's stand-ins run only while the database names Netlify (jobs/host-gate.mjs)");
{
  const mk = (answer) => {
    const calls = [];
    return { calls, call: async (n, a) => { calls.push({ n, a }); if (n === "job_lease") { if (answer instanceof Error) throw answer; return answer; } return true; } };
  };
  let ran = 0;
  const job = async () => { ran++; return new Response("{}", { status: 200 }); };
  let c = mk(HOLDER);
  let r = await onActiveHost("lfg-timers", job, { call: c.call });
  A("host Netlify -> the job runs, asked as Netlify with the scheduled lease", ran === 1 && c.calls[0].a.p_host === "netlify" && c.calls[0].a.p_ttl_s === NETLIFY_LEASE_S);
  A("...which outlives Netlify's 30 s limit for scheduled functions", NETLIFY_LEASE_S > 30);
  A("...and the HTTP door's lease outlives Netlify's 60 s limit for HTTP functions", NETLIFY_HTTP_LEASE_S > 60);
  c = mk(HOLDER);
  await onActiveHost("discord-sync", job, { call: c.call, ttlS: NETLIFY_HTTP_LEASE_S });
  A("...a caller can ask for its own lease", c.calls[0].a.p_ttl_s === NETLIFY_HTTP_LEASE_S);
  A("...and is handed back", c.calls.some((x) => x.n === "job_release" && x.a.p_holder === HOLDER && x.a.p_ok === true));
  c = mk("standby"); ran = 0;
  r = await onActiveHost("lfg-timers", job, { call: c.call });
  A("host Supabase -> standby, the job does not run here", ran === 0 && (await r.json()).skipped === "standby");
  c = mk("standby");
  r = await onActiveHost("discord-sync", job, { call: c.call, onStandby: async () => new Response("handed", { status: 200 }) });
  A("...or the caller's standby answer (discord-ops hands run=now to the database)", (await r.text()) === "handed");
  c = mk("busy"); ran = 0;
  r = await onActiveHost("lfg-timers", job, { call: c.call });
  A("a run going anywhere -> busy, nothing runs", ran === 0 && (await r.json()).skipped === "busy");
  c = mk(new Error("rpc job_lease -> 404"));  ran = 0;
  r = await onActiveHost("lfg-timers", job, { call: c.call });
  A("the database cannot be asked -> 503 and nothing runs (fails closed)", ran === 0 && r.status === 503);
  c = mk(HOLDER);
  r = await onActiveHost("lfg-timers", async () => { throw new Error("kaput"); }, { call: c.call });
  A("a job that throws -> 500, released as failed", r.status === 500 && c.calls.some((x) => x.n === "job_release" && x.a.p_ok === false && /kaput/.test(x.a.p_error)));
}

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
