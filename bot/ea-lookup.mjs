// Chel Gaming bot server: the EA lookup lane (v4.34), the site's EA club search and match lookups.
//
// WHY: EA's Pro Clubs API (proclubs.ea.com, behind Akamai) answers 403 to Netlify and to Supabase, and refuses a
// browser on chelgamingleague.com (CORS); only this VM reaches it (see ea-poll.mjs). Three site boxes asked EA from
// Netlify and had been dead since September 2026: the Stats Manager's "Add an EA game", the #/pickup-import page and
// the club game stats desk. Commissioner, 2026-10-29: "Can you make sure you check regularly that it works and
// functions so I can use it so I dont need to ask you each time?"; asked how the boxes should reach EA, chose
// "Through the bot's server", a deliberate, narrow exception to the rule that no new work goes on this VM.
//
// HOW: a Netlify action that needs EA (after its own sign-in and club checks) files a request row in
// public.ea_lookups with the service role. This lane hears the INSERT through Realtime, asks EA once with the
// poller's browser headers, and writes EA's raw answer, or the reason it failed in plain words, onto the row; the
// browser waits on public.ea_lookup_state and the action, called again, reads the answer. The lane holds no opinion
// about EA's payload (the normalizers stay in the Netlify functions), so a change in EA's format never needs a
// deploy here.
//
// PACING: one EA call at a time, at least 1.5 s apart, at most 20 waiting. Box scores come first: while the poller (in
// the same chel-ea-poll process) is backing off from a 403, no lookup is sent. A 403 on a lookup pauses only this lane
// for 5 minutes and never the poller (v4.35, adversarial review): Akamai may be refusing that one request, not the
// address, and member text must never be what stops box scores on a game night. If the address really is blocked, the
// poller's own next call finds out. Search text is held to plain characters (cleanArg, shared/ea-relay.cjs), and the
// database caps the site's requests too (public.guard_ea_lookup).
//
// HEALTH: every 10 minutes the lane files its own self-test search and times it end to end (Realtime delivery, EA,
// the write-back). Ledgers, in the shapes the Automations panel and automation_watchdog read:
//   rl_ea-lookup          the time of the last self-test (silent for 30 min: the watchdog alerts)
//   rl_ea-lookup_result   { ok, lastError, latencyMs, ... }; ok goes false after two failed self-tests in a row, so
//                         one EA hiccup does not page anyone (the watchdog alerts on ok:false)
// public.ea_lookup_health() reads the same two keys for the status line on each box.
//
// Dependency-free (injected fetch, clock, sleep and Realtime subscribe) so tools/ea-lookup-v434.test.mjs drives it.

import { EA_HEADERS, eaUrl } from "./ea-poll.mjs";

const msg = (e) => String((e && e.message) || e);
const etTime = (t) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET";

export function createEaLookup(env, opts = {}) {
  const { SB_URL, SB_KEY } = env || {};
  const F = (...a) => (opts.fetch || globalThis.fetch)(...a);
  const now = opts.now || Date.now;
  const log = opts.log || console.log;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const poller = opts.poller || null;
  const platform = opts.platform || "common-gen5";
  const GAP_MS = opts.gapMs ?? 1500;                          // between two EA calls
  const MAX_WAITING = opts.maxWaiting ?? 20;
  const EXPIRE_MS = opts.expireMs ?? 120_000;                 // a request older than this is expired, not asked
  const EA_TIMEOUT_MS = opts.eaTimeoutMs ?? 8000;
  const BACKOFF_MS = opts.backoffMs ?? 5 * 60_000;            // after a 403: the poller's own pause
  const SELFTEST_EVERY_MS = opts.selftestEveryMs ?? 10 * 60_000;
  const SELFTEST_FIRST_MS = opts.selftestFirstMs ?? 30_000;   // the first one, a little after start
  const SELFTEST_WAIT_MS = opts.selftestWaitMs ?? 20_000;
  const CATCHUP_EVERY_MS = opts.catchupEveryMs ?? 60_000;
  const PURGE_EVERY_MS = opts.purgeEveryMs ?? 60 * 60_000;
  const SELFTEST_ARG = opts.selftestArg || "CGHL";
  const SB_TIMEOUT_MS = 10_000;

  const sum = { live: false, realtime: false, served: 0, failed: 0, expired: 0, errors: 0, lastError: null, lastSelftest: null };
  const iso = (t) => new Date(t == null ? now() : t).toISOString();

  /* ---- Supabase REST, service role, every call on a deadline ---- */
  const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
  async function sb(method, path, body, prefer) {
    const r = await F(`${SB_URL}/rest/v1/${path}`, { method, headers: { ...sbHead(), ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(SB_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} -> ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const cfgSet = (key, value) => sb("POST", "app_config", { key, value, updated_at: iso() }, "resolution=merge-duplicates");

  /* the answer, compare-and-set on answered_at: a row answered once (by this lane or the expiry) stays as it was */
  async function answer(id, res) {
    const rows = await sb("PATCH", `ea_lookups?id=eq.${encodeURIComponent(id)}&answered_at=is.null`,
      res.ok ? { answered_at: iso(), ok: true, error: null, raw: res.raw } : { answered_at: iso(), ok: false, error: res.error, raw: null },
      "return=representation");
    return Array.isArray(rows) && rows.length > 0;
  }

  /* ---- one EA call. A 403 pauses this lane only (see PACING); the box-score poller is never told ---- */
  async function askEa(row) {
    let url;
    try { url = eaUrl(row.kind, row.arg, platform); }
    catch (e) { return { ok: false, error: msg(e) }; }
    const r = await F(url, { headers: EA_HEADERS, signal: AbortSignal.timeout(EA_TIMEOUT_MS) });
    if (r.ok) {
      const data = await r.json().catch(() => undefined);
      return data === undefined ? { ok: false, error: "EA answered, but not with data. Try again in a minute." } : { ok: true, raw: data };
    }
    const body = await r.text().catch(() => "");
    if (r.status === 403 || /Access Denied|edgesuite/i.test(body)) {
      laneBlockedUntil = Math.max(laneBlockedUntil, now() + BACKOFF_MS);
      log(`ea-lookup: EA answered 403 to a ${row.kind} lookup; lookups pause until ${iso(laneBlockedUntil)} (box scores unaffected)`);
      return { ok: false, error: `EA refused this lookup (Akamai 403). EA search pauses until ${etTime(laneBlockedUntil)}; box-score imports are not paused by it.` };
    }
    if (/CLUBS_ERR_INVALID_CLUB_ID/i.test(body)) return { ok: false, error: "EA says this club id no longer exists (an NHL title rollover resets club ids)." };
    return { ok: false, error: `EA answered ${r.status}. Try again in a minute.` };
  }

  /* ---- the queue: one at a time, paced, bounded ---- */
  const waiting = [];
  const inFlight = new Set();
  /* self-test rows Realtime delivered. Keyed on the row's own source, not on an id the self-test registers: Realtime
     can deliver the INSERT before the insert's REST reply hands the self-test its id */
  const rtSelftests = new Set();
  let working = false, lastEaAt = -Infinity, laneBlockedUntil = 0;

  async function finish(row, res) {
    try {
      if (await answer(row.id, res)) { if (res.ok) sum.served++; else sum.failed++; }
    } catch (e) {
      /* the row stays unanswered: the next catch-up asks again */
      sum.errors++; sum.lastError = `write-back: ${msg(e)}`; log("ea-lookup: " + sum.lastError);
    } finally { inFlight.delete(row.id); }
  }

  async function pump() {
    if (working) return;
    working = true;
    try {
      while (waiting.length) {
        const row = waiting.shift();
        let res;
        const until = Math.max(laneBlockedUntil, poller && typeof poller.blockedUntil === "function" ? poller.blockedUntil() : 0);
        if (until > now()) res = { ok: false, error: `EA is refusing the bot server until ${etTime(until)} (Akamai 403). Try again after that.` };
        else {
          const gap = lastEaAt + GAP_MS - now();
          if (gap > 0) await sleep(gap);
          lastEaAt = now();
          try { res = await askEa(row); }
          catch (e) { res = { ok: false, error: `EA did not answer (${msg(e)}). Try again in a minute.` }; }
        }
        await finish(row, res);
      }
    } finally { working = false; }
  }

  /* every row comes through here, from Realtime or the catch-up. Returns the pump's promise (tests await it). */
  function handle(row, via) {
    if (!row || row.id == null || row.answered_at) return Promise.resolve();
    if (via === "realtime" && row.source === "selftest") rtSelftests.add(row.id);
    if (inFlight.has(row.id)) return Promise.resolve();
    if (now() - Date.parse(row.created_at) > EXPIRE_MS) return Promise.resolve();   // the catch-up expires it
    inFlight.add(row.id);
    if (waiting.length >= MAX_WAITING) return finish(row, { ok: false, error: "The bot server is busy with other EA lookups. Try again in a minute." });
    waiting.push(row);
    return pump();
  }

  /* ---- catch-up: Realtime does not replay what it missed (a restart, a dropped socket) ---- */
  async function catchUp() {
    const cutoff = iso(now() - EXPIRE_MS);
    const rows = await sb("GET", `ea_lookups?answered_at=is.null&created_at=gte.${encodeURIComponent(cutoff)}&order=id.asc&limit=50&select=id,kind,arg,source,created_at,answered_at`);
    const work = (rows || []).map((r) => handle(r, "catch-up"));
    const gone = await sb("PATCH", `ea_lookups?answered_at=is.null&created_at=lt.${encodeURIComponent(cutoff)}`,
      { answered_at: iso(), ok: false, error: "The bot server did not get to this lookup in time (it was restarting or behind). Search again." },
      "return=representation");
    sum.expired += Array.isArray(gone) ? gone.length : 0;
    await Promise.all(work);
    return { asked: work.length, expired: Array.isArray(gone) ? gone.length : 0 };
  }
  const purge = () => sb("DELETE", `ea_lookups?created_at=lt.${encodeURIComponent(iso(now() - 24 * 3600_000))}`);

  /* ---- the self-test: Realtime delivery, EA and the write-back, timed end to end ---- */
  let failStreak = 0;
  async function selftest() {
    const t0 = now();
    let result;
    try {
      const made = await sb("POST", "ea_lookups?select=id", { kind: "search", arg: SELFTEST_ARG, source: "selftest" }, "return=representation");
      const id = made && made[0] && made[0].id;
      if (id == null) throw new Error("the self-test request was not created");
      let row = null;
      while (now() - t0 < SELFTEST_WAIT_MS) {
        await sleep(500);
        const got = await sb("GET", `ea_lookups?id=eq.${id}&select=answered_at,ok,error,created_at`);
        row = got && got[0];
        if (row && row.answered_at) break;
      }
      const seenRealtime = rtSelftests.delete(id);
      if (rtSelftests.size > 50) rtSelftests.clear();   // rows from self-tests that threw before reading their own
      const latencyMs = row && row.answered_at ? Date.parse(row.answered_at) - Date.parse(row.created_at) : null;
      if (!seenRealtime) result = { failed: true, latencyMs, lastError: `Realtime did not deliver the self-test within ${Math.round(SELFTEST_WAIT_MS / 1000)} s, so site lookups wait for the once-a-minute catch-up (or fail). Restart chel-ea-poll if this persists.` };
      else if (!row || !row.answered_at) result = { failed: true, latencyMs, lastError: `EA did not answer the self-test within ${Math.round(SELFTEST_WAIT_MS / 1000)} s.` };
      else if (row.ok !== true) result = { failed: true, latencyMs, lastError: row.error || "the self-test lookup failed" };
      else result = { failed: false, latencyMs, lastError: null };
    } catch (e) { result = { failed: true, latencyMs: null, lastError: `self-test: ${msg(e)}` }; }
    failStreak = result.failed ? failStreak + 1 : 0;
    const rec = { at: iso(), ok: failStreak < 2, lastError: result.lastError, latencyMs: result.latencyMs,
      ...(result.failed && failStreak < 2 ? { warning: "one self-test failed; a second in a row turns this red" } : {}),
      realtime: sum.realtime, served: sum.served, failed: sum.failed, expired: sum.expired, errors: sum.errors };
    sum.lastSelftest = rec;
    try { await cfgSet("rl_ea-lookup", iso()); await cfgSet("rl_ea-lookup_result", JSON.stringify(rec)); }
    catch (e) { sum.errors++; sum.lastError = `ledger: ${msg(e)}`; log("ea-lookup: could not stamp the self-test: " + msg(e)); }
    log(`ea-lookup: self-test ${result.failed ? "FAILED" : "ok"}${result.latencyMs != null ? ` in ${result.latencyMs} ms` : ""}${result.lastError ? ` (${result.lastError})` : ""}`);
    return rec;
  }

  /* ---- the timers (unref'd: the service holds the process) ---- */
  const timers = [];
  const every = (ms, fn) => { const t = setInterval(fn, ms); if (t && typeof t.unref === "function") t.unref(); timers.push(t); };
  const later = (ms, fn) => { const t = setTimeout(fn, ms); if (t && typeof t.unref === "function") t.unref(); timers.push(t); };
  const quietly = (label, p) => Promise.resolve().then(p).catch((e) => { sum.errors++; sum.lastError = `${label}: ${msg(e)}`; log(`ea-lookup: ${label} failed: ${msg(e)}`); });

  function start() {
    if (sum.live) return;
    sum.live = true;
    if (typeof opts.subscribe === "function") {
      opts.subscribe((row) => { quietly("realtime", () => handle(row, "realtime")); },
                     (status) => { sum.realtime = status === "SUBSCRIBED"; if (sum.realtime) quietly("catch-up", catchUp); });
    } else log("ea-lookup: no Realtime subscription; lookups are answered by the once-a-minute catch-up and the self-test reports it");
    every(CATCHUP_EVERY_MS, () => quietly("catch-up", catchUp));
    every(PURGE_EVERY_MS, () => quietly("purge", purge));
    every(SELFTEST_EVERY_MS, () => quietly("self-test", selftest));
    later(SELFTEST_FIRST_MS, () => quietly("self-test", selftest));
  }
  function stop() {
    while (timers.length) { const t = timers.pop(); clearInterval(t); clearTimeout(t); }
    sum.live = false;
  }

  return { start, stop, handle, catchUp, purge, selftest, sum };
}
