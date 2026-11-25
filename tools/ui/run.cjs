/* v5.00 swap (W0.4, extended by j1): runs the Season 2 site's Playwright suites against this checkout's src/s2, one
   at a time.
   node tools/ui/run.cjs                              every active suite (tools/ui/*.test.cjs) in live mode (the real site)
   node tools/ui/run.cjs nav camp                     only the named suites (W0's form)
   node tools/ui/run.cjs --suite nav,camp --mode mock --persona gm
     --suite a,b      repeatable; mock/harness names tools/ui/mock/harness.test.cjs (the harness's own suite) and
                      mock/live its real-site proof, both in every mode; tools/ui/quarantine/ never runs
     --mode live          (default; h0) the REAL site: mock mode on the page as the site build ships it (supabase-js
                          from vendor/ before js/load.js, window.S2_MODE "live"), so js/load.js reads the recorded
                          s2_league, S2.LIVE is true and js/live.js signs in as the persona; table reads answer from
                          the suite's tables, and every other host is fenced (mock/index.cjs header)
            live-fixture  every browser context gets the network mock: *.supabase.co answers from the recorded
                          production reads (signed out), and nothing reaches production; no sign-in library, so the
                          page is a read-only visitor's
            mock          the network mock plus a persona's S2.session and the S2.write mock (tools/ui/mock/index.cjs),
                          with no sign-in library (S2.LIVE false)
     Every mode mocks every browser context, so no suite reaches production. i3f (2026-11-25): fixture mode (the Oct 19
     snapshot on the demo path, with no mock) is REMOVED, not aliased: demo mode is gone, the page carries no fixture tag,
     and an unmocked page would read production. --mode fixture is refused with the list of modes.
     --persona anon|member|gm|staff|commissioner   (default anon)
   It serves src/s2 on this worktree's own port (stable across runs, never 8770, the commissioner's preview; a free one
   if that is taken), links the logos and the s2_league recordings in from ~/Developer/cghl-private (they never enter
   git; the private Oct 19 snapshot stays there and is no longer linked into the page), holds ONE machine-wide lock so
   parallel worktrees never run two Chromium suites at once (waiting runs take it in arrival order; a lock whose holder is no longer a run.cjs process is stale and cleared, with the
   server and suite that holder left behind), kills any suite still running after 10 minutes and names the section it reached, reports each suite's time,
   exits nonzero on any failure (a suite that ran no check counts as a failure), and always releases the lock and stops
   the server. Suites get S2_BASE, S2_ROOT, S2_MODE, S2_MOCK (the mock module) and PLAYWRIGHT. */
const fs = require("fs"), path = require("path"), net = require("net"), http = require("http"), os = require("os");
const { spawn, execFileSync } = require("child_process");
const mock = require("./mock/index.cjs");
const REPO = path.resolve(__dirname, "../.."), ROOT = path.join(REPO, "src/s2"), PRIV = path.join(os.homedir(), "Developer/cghl-private");
const LOCK = path.join(os.homedir(), "Developer/.cghl-ui-lock"), WATCHDOG_MS = 10 * 60 * 1000, LOCK_WAIT_MS = 90 * 60 * 1000;
const MODES = ["live", "live-fixture", "mock"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null, child = null, ownLock = false;
/* main session, 2026-11-24 (commissioner: "is there anyway you can work faster without losing any quality"): THREE
   suites may run at once (12 cores, load about 4.5 while one ran; runs waited up to 50 minutes in line). Slot 0 is the
   old LOCK path, so a runner from before this change still takes only that one; slots 1 and 2 sit beside it. Each run
   has its own port (j1), so slots never share a server. CGHL_UI_SLOTS overrides the count (1 restores the old rule). */
const SLOTS = Math.max(1, Math.min(6, +process.env.CGHL_UI_SLOTS || 3));
const slotDir = (i) => (i === 0 ? LOCK : LOCK + ".s" + i);
let mySlot = null;

/* each child leads its own process group, so a kill also takes the Chromium it launched */
const killGroup = (c) => { try { process.kill(-c.pid, "SIGKILL"); } catch (e) { /* already gone */ } };
function cleanup() {
  if (child) killGroup(child);
  if (server) killGroup(server);
  if (ownLock) { fs.rmSync(mySlot, { recursive: true, force: true }); ownLock = false; }
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { console.error("run.cjs: " + sig + ", stopping"); process.exit(130); });

/* j1: a holder is live only while its pid still runs THIS harness. A run killed with SIGKILL (a tool timeout) never
   reaches cleanup, and after a reboot its pid can belong to anything, so a bare "is the pid alive" kept stale locks. */
const cmdOf = (pid) => { try { return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim(); } catch (e) { return ""; } };
const lockFile = (n, dir) => { try { return +fs.readFileSync(path.join(dir || LOCK, n), "utf8") || 0; } catch (e) { return 0; } };
function clearStale(pid, dir) {
  dir = dir || LOCK;
  /* the dead holder's server and in-flight suite, each only while its command is still ours */
  for (const [n, re] of [["server", /tools\/demo\/serve\.cjs/], ["suite", /\.test\.cjs/]]) {
    const p = lockFile(n, dir);
    if (p && re.test(cmdOf(p))) { try { process.kill(-p, "SIGKILL"); console.log("run.cjs: stopped the stale holder's " + n + " (pid " + p + ")"); } catch (e) { /* already gone */ } }
  }
  console.log("run.cjs: clearing a stale lock " + path.basename(dir) + " (pid " + (pid || "none") + ")");
  fs.rmSync(dir, { recursive: true, force: true });
}
/* j1 (2026-11-24, eight runs from five streams queued at once and one waited 50 minutes): waiting runs take the lock
   in arrival order through tickets in QUEUE (a ticket whose run is gone is dropped). A run from before this queue
   ignores it and polls every 2 s, so the head of the line tries every 200 ms and wins the release; the gap closes when
   every worktree has this file. A holder that writes "suite" (this file does) is hung only when it has started no
   suite for HANG_MS (the watchdog ends every suite within 10 minutes); one that does not keeps the 90-minute limit. */
const QUEUE = LOCK + ".queue", HANG_MS = 15 * 60 * 1000;
const isRun = (pid) => /tools\/ui\/run\.cjs/.test(cmdOf(pid));
let ticket = null;
process.on("exit", () => { if (ticket) fs.rmSync(ticket, { force: true }); });
async function takeLock() {
  fs.mkdirSync(QUEUE, { recursive: true });
  ticket = path.join(QUEUE, String(Date.now()).padStart(15, "0") + "-" + process.pid);
  fs.writeFileSync(ticket, "");
  let said = "", checked = 0;
  for (;;) {
    if (!fs.existsSync(ticket)) fs.writeFileSync(ticket, "");   /* never lose the place, whatever cleared the folder */
    const line = fs.readdirSync(QUEUE).sort();
    while (line[0] !== path.basename(ticket) && !isRun(+line[0].split("-")[1])) fs.rmSync(path.join(QUEUE, line.shift()), { force: true });
    const pos = line.indexOf(path.basename(ticket)), turn = pos >= 0 && pos < SLOTS;
    if (turn) {
      for (let i = 0; i < SLOTS; i++) {
        try { fs.mkdirSync(slotDir(i)); mySlot = slotDir(i); fs.writeFileSync(path.join(mySlot, "pid"), String(process.pid)); ownLock = true; fs.rmSync(ticket, { force: true }); ticket = null; return; }
        catch (e) { if (e.code !== "EEXIST") throw e; }
      }
    }
    if (turn && Date.now() - checked < 2000) { await wait(200); continue; }
    checked = Date.now();
    let freed = false, hung = null, holders = [];
    for (let i = 0; i < SLOTS && !freed; i++) {
      const dir = slotDir(i), pid = lockFile("pid", dir);
      let age = 0, quiet = 0;
      try { age = Date.now() - fs.statSync(dir).mtimeMs; } catch (e) { freed = true; break; /* a slot is free; the line takes it */ }
      try { quiet = Date.now() - fs.statSync(path.join(dir, "suite")).mtimeMs; } catch (e) { quiet = null; }
      if (pid ? !isRun(pid) : age > 30000) { clearStale(pid, dir); freed = true; break; }
      if (quiet !== null ? quiet > HANG_MS : age > LOCK_WAIT_MS) hung = hung || ("the UI lock holder pid " + pid + (quiet !== null ? " has started no suite for 15 minutes" : " has held it for 90 minutes") + "; check that process");
      holders.push(pid);
    }
    if (freed) { await wait(200); continue; }
    /* every slot is held: a hung holder is reported, as with one lock (a live process is never killed) */
    if (hung) throw new Error(hung);
    const pid = holders.join(", ");
    const now = "pid " + pid + (turn ? ", next in line" : ", " + pos + " run(s) ahead in line");
    if (now !== said) { console.log("run.cjs: waiting for the UI lock held by " + now); said = now; }
    await wait(turn ? 200 : 2000);
  }
}
const markLock = (n, pid) => fs.writeFileSync(path.join(mySlot || LOCK, n), String(pid || ""));

function linkPrivate(rel, target) {
  if (!fs.existsSync(target)) throw new Error("missing private input " + target + " (W0.2 copies it from the Desktop concept)");
  const at = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(at), { recursive: true });
  let cur = null; try { cur = fs.readlinkSync(at); } catch (e) { if (fs.existsSync(at)) throw new Error(at + " exists and is not a link; move it to " + target); }
  if (cur !== target) { if (cur !== null) fs.unlinkSync(at); fs.symlinkSync(target, at); }
}

/* j1: this worktree's own port, 8800 to 8999 by a hash of its path, so a failure's URL is the same on every run */
function worktreePort() { let h = 0; for (const c of REPO) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 8800 + (h % 200); }
const portFree = (p) => new Promise((res) => { const s = net.createServer(); s.once("error", () => res(false)); s.listen(p, () => s.close(() => res(true))); });
const anyPort = () => new Promise((res, rej) => { const s = net.createServer(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const get = (url) => new Promise((res) => http.get(url, (r) => { let b = ""; r.setEncoding("utf8"); r.on("data", (d) => { b += d; }); r.on("end", () => res({ status: r.statusCode, body: b })); }).on("error", () => res({ status: 0, body: "" })));

function parseArgs(argv) {
  const o = { suites: [], mode: "live", persona: null };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i], v = null;
    if (/^--[a-z]+=/.test(a)) { v = a.slice(a.indexOf("=") + 1); a = a.slice(0, a.indexOf("=")); }
    const val = () => { if (v === null) v = argv[++i]; if (!v || v.startsWith("--")) throw new Error(a + " needs a value"); return v; };
    if (a === "--suite") o.suites.push.apply(o.suites, val().split(",").filter(Boolean));
    else if (a === "--mode") o.mode = val();
    else if (a === "--persona") o.persona = val();
    else if (a.startsWith("--")) throw new Error("unknown flag " + a + " (known: --suite, --mode, --persona)");
    else o.suites.push(a);
  }
  if (MODES.indexOf(o.mode) < 0) throw new Error("--mode must be one of " + MODES.join(", ") + ", not " + o.mode);
  if (o.persona && o.mode === "live-fixture") throw new Error("--persona needs --mode live or --mode mock (live-fixture is signed out)");
  if (o.persona && mock.personas().indexOf(o.persona) < 0) throw new Error("no persona " + o.persona + " (known: " + mock.personas().join(", ") + ")");
  o.suites = o.suites.map((n) => n.replace(/\.test\.cjs$/, ""));
  return o;
}

/* the names check reports on every run; tools/ui/privacy-names.cjs lists the hits, masked
   shortcut: a hit does not fail the run while the concept still carries member names (other streams' files), make it
   gate (exit 1) once node tools/ui/privacy-names.cjs passes on s2-swap
   v5.00 swap (j2): a hit in a file on privacy-names' CLEAN list (exit 3) fails the run now, before the lock wait */
function namesCheck() {
  try { return execFileSync(process.execPath, [path.join(__dirname, "privacy-names.cjs")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").pop(); }
  catch (e) {
    if (e.status === 1) return String(e.stdout).trim().split("\n").pop();
    if (e.status === 3) throw new Error(String(e.stdout).trim().split("\n").pop() + " (node tools/ui/privacy-names.cjs lists them)");
    throw new Error("the member-names check could not run: " + String(e.stderr || e.message).trim());
  }
}

function runSuite(file, env, preload) {
  return new Promise((res) => {
    let last = "", buf = "", pass = 0, fail = 0, killed = false;
    const t0 = Date.now();
    child = spawn(process.execPath, (preload || []).flatMap((p) => ["--require", p]).concat([file]), { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    markLock("suite", child.pid);
    const eat = (d) => { process.stdout.write(d); buf += d; const lines = buf.split("\n"); buf = lines.pop();
      for (const l of lines) { if (/^##/.test(l)) last = l; else if (/^PASS /.test(l)) pass++; else if (/^FAIL /.test(l)) fail++; } };
    child.stdout.on("data", eat); child.stderr.on("data", (d) => process.stderr.write(d));
    const dog = setTimeout(() => { killed = true; console.log("WATCHDOG: killed after 10 min at: " + (last || "(no section yet)")); killGroup(child); }, WATCHDOG_MS);
    child.on("close", (code) => { clearTimeout(dog); killGroup(child); child = null;
      res({ ok: code === 0 && !killed && fail === 0 && pass > 0, code, pass, fail, killed, last, ms: Date.now() - t0 }); });
  });
}

(async () => {
  const o = parseArgs(process.argv.slice(2));
  const all = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.cjs")).map((f) => f.replace(/\.test\.cjs$/, "")).sort();
  const known = (n) => n.indexOf("/") < 0 ? all.indexOf(n) >= 0 : !/^quarantine\//.test(n) && !/\.\./.test(n) && fs.existsSync(path.join(__dirname, n + ".test.cjs"));
  const unknown = o.suites.filter((n) => !known(n));
  if (unknown.length) throw new Error("no such suite in tools/ui: " + unknown.join(", "));
  const suites = o.suites.length ? o.suites : all;
  console.log("run.cjs: " + namesCheck());
  await takeLock();
  linkPrivate("assets", path.join(PRIV, "assets"));
  const league = require(path.join(PRIV, "fixtures/personas/personas.json")).shared.s2_league;
  for (const season of Object.keys(league).filter((k) => k !== "current")) linkPrivate("data/s2_league-" + season + ".json", path.resolve(PRIV, "fixtures/personas", league[season]));
  /* h0 (2026-11-25): the port is ours only once OUR server says it is listening. Two runs from one worktree (three slots)
     both found the worktree's port free, the second server died on EADDRINUSE, the first run's page (same checkout, so
     the identity check below passed) answered for both, and the second run's later suites met ERR_CONNECTION_REFUSED
     once the first run stopped its server. A server that exits before listening lost the race: take a free port */
  let port = (await portFree(worktreePort())) ? worktreePort() : await anyPort();
  for (let tries = 0; ; tries++) {
    if (port === 8770) throw new Error("port 8770 is the commissioner's preview");
    server = spawn(process.execPath, [path.join(REPO, "tools/demo/serve.cjs"), String(port), ROOT], { stdio: ["ignore", "pipe", "ignore"], detached: true });
    /* main session, 2026-11-25 (review of h0): recorded at spawn, not after the listen wait, so a run killed during the wait
       leaves a lock clearStale can use to stop this server instead of an orphan */
    markLock("server", server.pid);
    const listening = await new Promise((res) => { let out = ""; server.stdout.on("data", (d) => { out += d; if (/demo server on/.test(out)) res(true); }); server.on("exit", () => res(false)); setTimeout(() => res(false), 10000); });
    if (listening) break;
    killGroup(server);
    if (tries >= 4) throw new Error("this checkout's server could not listen on any port (last " + port + ")");
    port = await anyPort();
  }
  markLock("server", server.pid);
  const origin = "http://localhost:" + port, base = origin + "/demo.html", demo = fs.readFileSync(path.join(ROOT, "demo.html"), "utf8");
  /* the page must be OURS: another server already on this port would answer 200 with some other checkout */
  for (let i = 0; (await get(base)).body !== demo; i++) { if (i > 50 || server.exitCode !== null) throw new Error("this checkout's server on " + port + " never answered"); await wait(100); }
  for (const rel of ["data/s2_league-" + league.current + ".json"]) if ((await get(origin + "/" + rel)).status !== 200) throw new Error("the link " + rel + " does not serve");
  const env = Object.assign({}, process.env, { S2_BASE: base, S2_ROOT: ROOT, S2_MODE: o.mode, S2_MOCK: path.join(__dirname, "mock/index.cjs"), PLAYWRIGHT: mock.PW });
  if (o.persona) env.S2_PERSONA = o.persona; else delete env.S2_PERSONA;
  /* the font fence (tools/ui/fonts-fence.cjs), then the mock, in every mode */
  const preload = [path.join(__dirname, "fonts-fence.cjs"), path.join(__dirname, "mock/preload.cjs")];
  console.log("run.cjs: " + suites.length + " suite(s), mode " + o.mode + (o.mode === "live-fixture" ? "" : ", persona " + (o.persona || "anon")) + ", against " + base);
  const results = [], t0 = Date.now();
  for (const n of suites) {
    console.log("\n=== " + n);
    const r = await runSuite(path.join(__dirname, n + ".test.cjs"), env, preload);
    results.push(Object.assign({ n }, r));
  }
  const sec = (ms) => (ms / 1000).toFixed(1) + "s";
  console.log("\n=== summary (mode " + o.mode + ")");
  for (const r of results) console.log((r.ok ? "ok   " : "FAIL ") + r.n + ": " + r.pass + "/" + (r.pass + r.fail) + " checks, exit " + r.code + ", " + sec(r.ms)
    + (r.killed ? ", WATCHDOG at " + r.last : "") + (r.pass === 0 && !r.killed ? ", NO CHECKS RAN" : ""));
  const bad = results.filter((r) => !r.ok);
  console.log((bad.length ? bad.length + " of " + results.length + " suite(s) FAILED" : "ALL " + results.length + " SUITES PASSED") + " in " + sec(Date.now() - t0)
    + ", " + results.reduce((s, r) => s + r.pass, 0) + " checks passed");
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error("run.cjs: " + (e && e.stack || e)); process.exit(1); });
