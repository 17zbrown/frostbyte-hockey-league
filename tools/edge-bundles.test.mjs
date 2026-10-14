// v4.06: the five Supabase Edge bundles. Run: node tools/edge-bundles.test.mjs
//
// Builds every job exactly as the deploy does (tools/edge/build.mjs) into a temp folder and checks what Supabase will run:
// one self-contained ESM file per job whose only imports are Node's own modules, stamped with the build id the site
// publishes. Then, when Deno is on this machine (the Supabase runtime is Deno), it loads each bundle in Deno with a fake
// database and a fake Discord, and drives the real door: strangers 404, standby, the probe, and a full run handed back.
// Set REQUIRE_DENO=1 to fail instead of skipping when Deno is missing (the deploy workflow does).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { bundleJob } = await import(new URL("./edge/build.mjs", import.meta.url).pathname);
const recipe = (await import(new URL("../edge/recipe.cjs", import.meta.url).pathname)).default;
const { SPEC, buildIds } = recipe;

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const out = fs.mkdtempSync(path.join(os.tmpdir(), "cghl-edge-test-"));
const JOBS = ["discord-sync", "twitch-live-sync", "lfg-timers", "discord-scheduler", "discord-welcome"];

console.log("— the five jobs, and nothing else");
A("edge/jobs.json lists exactly the five scheduled jobs", JSON.stringify(Object.keys(SPEC.jobs).sort()) === JSON.stringify([...JOBS].sort()));
A("the cadences match the old Netlify schedules", SPEC.jobs["discord-sync"].every === 2 && SPEC.jobs["twitch-live-sync"].every === 2 &&
  SPEC.jobs["lfg-timers"].every === 2 && SPEC.jobs["discord-scheduler"].every === 5 && SPEC.jobs["discord-welcome"].every === 5);
const sql = fs.readFileSync(path.join(ROOT, "sql/2026-10-14-edge-jobs-v406.sql"), "utf8");
for (const j of JOBS) {
  A(`${j}: pg_cron fires it on the same cadence`, new RegExp(`cron\\.schedule\\('edge-${j}',\\s*'\\*/${SPEC.jobs[j].every} \\* \\* \\* \\*', \\$\\$select public\\.invoke_edge_job\\('${j}'\\)\\$\\$\\)`).test(sql));
  A(`${j}: job_hosts seeds it with that cadence`, new RegExp(`\\('${j}', ${SPEC.jobs[j].every}\\)`).test(sql));
}

console.log("\n— each bundle is what Supabase will run");
const built = {};
for (const j of JOBS) {
  let r;
  try { r = bundleJob(j, out); } catch (e) { A(`${j}: builds`, false, String(e.message || e).slice(0, 300)); continue; }
  built[j] = r;
  const code = fs.readFileSync(r.outfile, "utf8");
  A(`${j}: builds, and every file it reads is listed in edge/jobs.json`, true);
  const chk = spawnSync(process.execPath, ["--check", r.outfile], { encoding: "utf8" });
  A(`${j}: parses`, chk.status === 0, chk.stderr);
  A(`${j}: starts with the process/Buffer imports`, code.startsWith(SPEC.banner));
  A(`${j}: no schedule export and no file reads of the rulebook`, !/schedule:\s*"/.test(code) && !/part3_content/.test(code));
  A(`${j}: the guild id is built in`, !/process\.env\.DISCORD_GUILD_ID/.test(code));
  A(`${j}: stamped with the build id the site publishes`, code.includes(JSON.stringify(r.id)) && buildIds()[j] === r.id);
  A(`${j}: no dynamic require that could fail at runtime`, !/\brequire\(\s*["']/.test(code));
  A(`${j}: the Staff artwork rides only in discord-sync`, (j === "discord-sync") === /data:image\/png;base64,|"iVBORw0KGgo/.test(code));
}
const ids = buildIds();
A("the ids are 12 hex and distinct", Object.values(ids).every((x) => /^[0-9a-f]{12}$/.test(x)) && new Set(Object.values(ids)).size === 5);

console.log("\n— the ids follow the code");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cghl-edge-id-"));
  for (const rel of new Set(Object.values(SPEC.jobs).flatMap((x) => x.inputs))) {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(tmp, rel));
  }
  A("the same files give the same ids", JSON.stringify(recipe.buildIds(tmp)) === JSON.stringify(ids));
  fs.appendFileSync(path.join(tmp, "shared/discord-links.cjs"), "\n// changed\n");
  const after = recipe.buildIds(tmp);
  A("a change to a shared file changes every job that bundles it, and only those",
    after["lfg-timers"] !== ids["lfg-timers"] && after["discord-sync"] !== ids["discord-sync"] && after["twitch-live-sync"] === ids["twitch-live-sync"]);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("\n— on Deno, the Supabase runtime");
const denoBin = (() => {
  const cands = [process.env.DENO_BIN, "deno"];
  try {
    const npx = path.join(os.homedir(), ".npm", "_npx");
    for (const d of fs.readdirSync(npx)) cands.push(path.join(npx, d, "node_modules", ".bin", "deno"));
  } catch (e) { /* no npx cache */ }
  for (const c of cands.filter(Boolean)) { const r = spawnSync(c, ["--version"], { encoding: "utf8" }); if (r.status === 0) return c; }
  return null;
})();
if (!denoBin) {
  A("Deno is available", !process.env.REQUIRE_DENO, "Deno not found; set DENO_BIN, or REQUIRE_DENO is set");
  if (!process.env.REQUIRE_DENO) console.log("skip  Deno is not installed here, so the runtime checks did not run");
} else {
  /* The harness replaces Deno.serve to capture the handler and fetch to play the database and Discord. Nothing leaves the
     machine: Deno also runs with no network permission at all. */
  const harness = path.join(out, "harness.mjs");
  fs.writeFileSync(harness, `
    const KEY = "a".repeat(64), HOLDER = "11111111-2222-4333-8444-555555555555";
    let lease = "standby"; const rpcs = []; const later = [];
    Deno.serve = (h) => { globalThis.__h = h; return { finished: Promise.resolve() }; };
    globalThis.EdgeRuntime = { waitUntil: (p) => later.push(p) };
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      const m = u.match(/\\/rest\\/v1\\/rpc\\/([a-z_]+)/);
      const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
      if (m) {
        const a = JSON.parse(opts.body || "{}"); rpcs.push({ n: m[1], a });
        if (m[1] === "job_lease") return J(a.p_key !== KEY ? "denied" : a.p_probe ? "ok" : lease);
        return J(true);
      }
      if (u.includes("/rest/v1/")) return (opts.method || "GET") === "GET" ? J([]) : new Response(null, { status: 201 });
      if (u.includes("discord.com/api/v10/users/@me")) return J({ id: "bot" });
      if (u.includes("discord.com")) return J([]);
      return J({});
    };
    await import(Deno.args[0]);
    const h = globalThis.__h, res = {};
    const post = (hd) => new Request("https://bz.supabase.co/functions/v1/x", { method: "POST", headers: hd });
    res.get = (await h(new Request("https://bz.supabase.co/functions/v1/x"))).status;
    res.short = (await h(post({ "x-cron-key": "abc" }))).status;
    res.wrong = (await h(post({ "x-cron-key": "b".repeat(64) }))).status;
    const s = await h(post({ "x-cron-key": KEY })); res.standby = [s.status, (await s.json()).skipped];
    const p = await h(post({ "x-cron-key": KEY, "x-cron-probe": "1" })); res.probe = await p.json();
    lease = HOLDER;
    const r = await h(post({ "x-cron-key": KEY })); res.run = r.status;
    await Promise.all(later);
    const rel = rpcs.find((x) => x.n === "job_release"); res.released = rel ? { ok: rel.a.p_ok, error: rel.a.p_error } : null;
    console.log(JSON.stringify(res));
  `);
  for (const j of Object.keys(built)) {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_URL: "https://sb.invalid", SUPABASE_SERVICE_ROLE_KEY: "svc",
      DISCORD_BOT_TOKEN: "t", TWITCH_CLIENT_ID: "i", TWITCH_CLIENT_SECRET: "s", DENO_NO_UPDATE_CHECK: "1" };
    const r = spawnSync(denoBin, ["run", "--quiet", "--no-prompt", "--allow-env", `--allow-read=${out}`, harness, `file://${built[j].outfile}`],
      { encoding: "utf8", env, timeout: 60000 });
    let res = null;
    try { res = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) { /* reported below */ }
    if (!res) { A(`${j}: loads and answers in Deno`, false, (r.stderr || r.stdout || "").slice(0, 400)); continue; }
    A(`${j}: strangers get 404 (no POST, bad key shape, wrong key)`, res.get === 404 && res.short === 404 && res.wrong === 404, JSON.stringify(res));
    A(`${j}: host still Netlify -> standby`, res.standby[0] === 200 && res.standby[1] === "standby");
    A(`${j}: probe: Eastern time, sha256 and waitUntil all work in Deno`,
      res.probe.runtime && res.probe.runtime.easternTime === true && res.probe.runtime.sha256 === true && res.probe.runtime.waitUntil === true && /^\d/.test(String(res.probe.runtime.deno)),
      JSON.stringify(res.probe.runtime));
    A(`${j}: granted -> 202, the job runs in Deno and the run is handed back`, res.run === 202 && res.released !== null, JSON.stringify(res.released));
    if (j !== "discord-sync" && j !== "discord-welcome") {
      A(`${j}: ...and with an empty league it finishes clean`, res.released && res.released.ok === true, JSON.stringify(res.released));
    }
  }
}

fs.rmSync(out, { recursive: true, force: true });
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
