// The EA score poller as its own service (bot/ea-poll-service.mjs + deploy/chel-ea-poll.service).
// Run: node tools/ea-poll-service.test.mjs
//
// What must never break: the gateway process no longer owns the poller, so its exit on an
// unrecoverable Discord close cannot take the box-score import with it (audit 2026-09-17,
// P2-15); the standalone entry actually holds its process open (the poller's own interval is
// unref'd by design); it dies loudly on a missing env; and the unit file rides the same env file
// and restart posture as chel-bot. The child-process runs here stub fetch with --import, so no
// network is touched. The poller loop itself is tools/ea-poll-vm.test.mjs's.
import { createEaPollService } from "../bot/ea-poll-service.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const ENTRY = fileURLToPath(new URL("../bot/ea-poll-service.mjs", import.meta.url));   // fileURLToPath, not .pathname: the repo path has a space

console.log("— the gateway bot no longer starts the poller");
{
  const src = read("../bot/chel-bot.mjs");
  A("chel-bot does not import ea-poll", !/from "\.\/ea-poll\.mjs"/.test(src));
  A("...nor create or start a poller", !/createEaPoller|EA\.start\(\)/.test(src));
  A("...nor report eaPoll in its heartbeat (the poller stamps its own rl_ea-poll-vm)", !/eaPoll/.test(src));
  A("...and says where the poller went", /ea-poll-service\.mjs/.test(src) && /chel-ea-poll\.service/.test(src));
  A("the gateway still exits on an unrecoverable close — that exit is exactly why the poller moved out", /ShardDisconnect[\s\S]*process\.exit\(1\)/.test(src));
}

console.log("\n— the service holds the loop around the poller, and lets go cleanly");
{
  const calls = [];
  const fake = (env, o) => ({ start: () => calls.push("start"), stop: () => calls.push("stop"), sum: { live: true }, env, o });
  const S = createEaPollService({ SB_URL: "https://sb.invalid", SB_KEY: "k" }, { createPoller: fake, keepaliveMs: 10, log: () => {} });
  A("the poller is built from the service's env", S.poller.env.SB_URL === "https://sb.invalid" && S.poller.env.SB_KEY === "k");
  A("nothing runs until start", calls.length === 0 && S.running() === false);
  S.start(); S.start();
  A("start starts the poller once", calls.join() === "start" && S.running() === true);
  S.stop();
  A("stop stops it and releases the hold", calls.join() === "start,stop" && S.running() === false);
}

/* ---- the real entry, in a child: stubbed fetch via --import, so EA/Supabase are never touched ---- */
const STUB = "data:text/javascript," + encodeURIComponent(
  "globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });");
function run(env, { signalAfterMs = 0 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", STUB, ENTRY], { env: { PATH: process.env.PATH, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", exitedOnItsOwn = null;
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    let timer = null;
    if (signalAfterMs) timer = setTimeout(() => { exitedOnItsOwn = false; child.kill("SIGTERM"); }, signalAfterMs);
    child.on("exit", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (exitedOnItsOwn === null) exitedOnItsOwn = true;
      resolve({ code, signal, out, err, exitedOnItsOwn });
    });
  });
}

console.log("\n— the entry dies loudly without its env (no poller can run on nothing)");
{
  const r = await run({});
  A("exit 1", r.code === 1, `code=${r.code}`);
  A("...naming both values and the env file", /missing env \(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY\)/.test(r.err) && /\/etc\/chel-bot\.env/.test(r.err), r.err.trim());
  const r2 = await run({ SUPABASE_URL: "https://sb.invalid" });
  A("a single missing value is named on its own", r2.code === 1 && /missing env \(SUPABASE_SERVICE_ROLE_KEY\)/.test(r2.err), r2.err.trim());
}

console.log("\n— with its env the entry runs, STAYS UP, and stops on SIGTERM");
{
  const r = await run({ SUPABASE_URL: "https://sb.invalid", SUPABASE_SERVICE_ROLE_KEY: "k" }, { signalAfterMs: 700 });
  A("it announces itself as its own unit", /ea-poll-service: EA score poller running/.test(r.out), r.out.trim().slice(0, 200));
  A("it did NOT exit on its own — the hold keeps the process alive past the poller's unref'd interval", r.exitedOnItsOwn === false, `code=${r.code} signal=${r.signal} out=${r.out.trim().slice(0, 120)} err=${r.err.trim().slice(0, 200)}`);
  A("SIGTERM shuts it down with exit 0", r.code === 0 && /SIGTERM — shutting down/.test(r.out), `code=${r.code} signal=${r.signal}`);
  A("the one-shot CLI in ea-poll.mjs did not fire (argv[1] is the service, not the poller)", !/usage: node bot\/ea-poll\.mjs/.test(r.out + r.err));
}

console.log("\n— the unit file and the deploy kit");
{
  const unit = read("../bot/deploy/chel-ea-poll.service");
  const bot = read("../bot/deploy/chel-bot.service");
  const pick = (u, k) => (u.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1];
  A("Restart=always", pick(unit, "Restart") === "always");
  A("the same env file as chel-bot", pick(unit, "EnvironmentFile") === "/etc/chel-bot.env" && pick(bot, "EnvironmentFile") === "/etc/chel-bot.env");
  A("the same service user and working directory", pick(unit, "User") === pick(bot, "User") && pick(unit, "WorkingDirectory") === pick(bot, "WorkingDirectory"));
  A("runs the standalone entry", pick(unit, "ExecStart") === "/usr/bin/node ea-poll-service.mjs");
  A("the same start-limit posture (a bad env trips the limit rather than spinning)", pick(unit, "StartLimitBurst") === pick(bot, "StartLimitBurst") && pick(unit, "RestartSec") === pick(bot, "RestartSec"));
  A("enabled at boot", /WantedBy=multi-user\.target/.test(unit));
  const setup = read("../bot/deploy/setup.sh");
  A("setup.sh installs and enables it alongside chel-bot", /install -m 644 deploy\/chel-ea-poll\.service/.test(setup) && /systemctl enable chel-bot chel-ea-poll/.test(setup));
  const update = read("../bot/deploy/update.sh");
  A("update.sh restarts both services on a bot/ or shared/ change", /SERVICES="chel-bot chel-ea-poll"/.test(update) && /systemctl restart \$SERVICES/.test(update));
  A("...installs a unit systemd does not have yet, BEFORE it pulls (the tick that pulls a new unit runs the old script)",
    update.indexOf("enable --now") > 0 && update.indexOf("enable --now") < update.indexOf("git -C \"$REPO\" fetch"));
  A("...and clears a failed state for both", /for svc in \$SERVICES; do\s*\n\s*if systemctl is-failed --quiet "\$svc"/.test(update));
  const readme = read("../bot/README.md");
  A("the README documents the second unit and its upgrade path", /chel-ea-poll/.test(readme) && /Upgrading a VM set up before/.test(readme));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
