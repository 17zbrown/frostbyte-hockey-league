// Chel Gaming gateway bot — the VM-side EA score poller.
//
// WHY THIS EXISTS: EA's Pro Clubs API sits behind Akamai, which answers Netlify's own address
// with a 403, and the residential proxy the Netlify poller (netlify/functions/ea-poll.js) fell
// back on has lapsed. This VM reaches proclubs.ea.com directly with plain global fetch
// (verified 2026-09-11: 200 on clubs/info), so it is now the PRIMARY lane for box scores. The
// Netlify poller stays deployed as the backstop; both lanes hand every match to the same
// /api/ingest-stats endpoint, which dedupes by ea_match_id, so whichever lane reaches EA first
// wins and the other's delivery is a no-op.
//
// Same gate as the Netlify poller: EA is only asked when a league fixture could actually have
// been played — one scheduled within the last six hours or the next half hour. An idle cycle
// costs one cheap Supabase query and the heartbeat, nothing more. On game nights this polls
// about every two minutes (60-s cycles with a 90-s floor between EA calls) instead of Netlify's
// 5 min, which is the whole point of running it here.
//
// Ledgers (app_config), in the shapes the Automations panel and automation_watchdog read:
//   rl_ea-poll-vm       every cycle — "this lane is alive"
//   rl_ea-poll          after every real EA poll — the poller's shared last-run marker (the
//                       Netlify lane reads it as its 90-s debounce, so it yields while we poll)
//   rl_ea-poll_result   the per-run record, lane:'vm' (idle: at most once per 30 minutes)
//
// Dependency-free of discord.js so tools/ea-poll-vm.test.mjs can drive it with an injected
// fetch and clock. Also runnable one-shot on the VM:
//   set -a; . /etc/chel-bot.env; set +a; node /opt/chel-gaming/bot/ea-poll.mjs --once [--force]

import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

/* KEEP IN SYNC with EA_HEADERS in netlify/functions/ea-poll.js (and eaFetch in ingest-stats.js /
   pickup-import.js). EA blocks by CLIENT FINGERPRINT, not by address: this exact browser-shaped
   header set is what gets served where curl is refused. No title-pinned referer, so nothing here
   needs touching when a new NHL ships. tools/ea-poll-vm.test.mjs asserts the UA still matches. */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const EA_HEADERS = Object.freeze({
  "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.ea.com/", "Origin": "https://www.ea.com",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-site",
});

export function createEaPoller(env, opts = {}) {
  const { SB_URL, SB_KEY } = env || {};
  /* resolved per call, not captured, so a caller may stub globalThis.fetch after import (the
     tests inject opts.fetch) */
  const F = (...a) => (opts.fetch || globalThis.fetch)(...a);
  const now = opts.now || Date.now;
  const site = String(opts.site || "https://chelgamingleague.com").replace(/\/+$/, "");
  const log = opts.log || console.log;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const platform = opts.platform || "common-gen5";

  const CYCLE_MS = opts.cycleMs ?? 60_000;                 // how often a cycle runs
  const MIN_GAP_MS = opts.minPollGapMs ?? 90_000;          // floor between two EA polls
  const IDLE_STAMP_MS = opts.idleStampMs ?? 30 * 60_000;   // "no fixture due" result, at most this often
  const BACKOFF_MS = opts.backoffMs ?? 5 * 60_000;         // after any 403: no EA call for this long
  const CLUB_GAP_MS = opts.clubGapMs ?? 300;               // pause between clubs
  const EA_TIMEOUT_MS = opts.eaTimeoutMs ?? 8000;
  const INGEST_TIMEOUT_MS = opts.ingestTimeoutMs ?? 30_000;
  const DUE_BACK_MS = 6 * 3600e3, DUE_AHEAD_MS = 30 * 60e3;

  /* surfaced as eaPoll in the gateway heartbeat's extra */
  const sum = { live: true, polls: 0, matches: 0, ingested: 0, lastPollAt: null, lastError: null, backoffUntil: null };
  let lastIdleStampAt = -Infinity, lastPollAt = -Infinity, backoffUntil = 0;
  const iso = (t) => new Date(t == null ? now() : t).toISOString();

  /* ---- Supabase REST, service role ---- */
  const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
  async function sbGet(path) {
    const r = await F(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
    if (!r.ok) throw new Error(`GET ${path.split("?")[0]} -> ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`);
    return r.json();
  }
  async function cfgSet(key, value) {
    const r = await F(`${SB_URL}/rest/v1/app_config`, { method: "POST",
      headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key, value, updated_at: iso() }) });
    if (!r.ok) throw new Error(`POST app_config ${key} -> ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`);
  }
  const record = (obj) => cfgSet("rl_ea-poll_result", JSON.stringify({ at: iso(), lane: "vm", ...obj }));

  /* ---- one pass over the linked clubs. Per-club try/catch: one club failing never costs the
     others their box scores. Matches are deduped by matchId because both clubs of a league game
     report the same match. ---- */
  async function pollClubs(clubs) {
    const byId = new Map();
    const clubErrors = [];      // STRING channel: [0] becomes lastError and lands in the chip tooltip
    let blocked = false;
    for (let i = 0; i < clubs.length; i++) {
      const c = clubs[i];
      if (i) await sleep(CLUB_GAP_MS);
      try {
        const url = `https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=${platform}&clubIds=${c}`;
        const r = await F(url, { headers: EA_HEADERS, signal: AbortSignal.timeout(EA_TIMEOUT_MS) });
        if (!r.ok) {
          /* three distinct failure classes, so the Automations chip says what actually broke:
             a stale club id (title rollover reset it), an Akamai block, or a transient EA error.
             None of them may ever read as "0 new games". Same wording as the Netlify lane. */
          const body = await r.text().catch(() => "");
          const akamai = r.status === 403 || /Access Denied|edgesuite/i.test(body);
          const msg = /CLUBS_ERR_INVALID_CLUB_ID/i.test(body)
            ? `club ${c}: EA says this club id no longer exists — an NHL title rollover resets every club id. Re-link the club's EA id (Team HQ → Club game stats, or Control Center → Clubs).`
            : akamai
              ? `club ${c}: EA blocked the request (Akamai 403) — no EA calls for the next ${Math.round(BACKOFF_MS / 60000)} min`
              : `club ${c}: EA ${r.status} (transient?)`;
          if (akamai) blocked = true;
          clubErrors.push(msg); log("ea-poll: " + msg);
        } else {
          const data = await r.json();
          if (Array.isArray(data)) for (const m of data) if (m && m.matchId != null) byId.set(String(m.matchId), m);
        }
      } catch (e) {
        const msg = `club ${c}: ${String((e && e.message) || e)}`;
        clubErrors.push(msg); log("ea-poll: " + msg);
      }
    }
    return { matches: [...byId.values()], clubErrors, blocked };
  }

  /* ---- one cycle. Throws only on infrastructure failure (Supabase unreachable); every EA and
     ingest outcome is captured in the result record instead. ---- */
  async function runOnce({ force = false } = {}) {
    const t0 = now();
    /* refreshed every cycle, not only after a poll: a backoff that expired during a quiet stretch
       (nothing due, so no poll ever re-evaluated it) must not keep advertising itself in the
       heartbeat as if EA were still blocked */
    sum.backoffUntil = t0 < backoffUntil ? iso(backoffUntil) : null;
    await cfgSet("rl_ea-poll-vm", iso(t0));                       // (1) alive
    try {
      /* (2) DUE GATE — same query as the Netlify lane: a fixture scheduled within the last six
         hours (a box score lands minutes after the final horn, lag-out segments later) or the
         next half hour. Without it an EA hiccup on a night with no fixture reads as a failing run. */
      const dueFrom = iso(t0 - DUE_BACK_MS), dueTo = iso(t0 + DUE_AHEAD_MS);
      const due = await sbGet(`games?voided=not.is.true&scheduled_at=gte.${encodeURIComponent(dueFrom)}&scheduled_at=lte.${encodeURIComponent(dueTo)}&select=id&limit=1`);
      const fixtureDue = Array.isArray(due) && due.length > 0;
      if (!fixtureDue && !force) {
        /* the idle record is what keeps the chip honest ("nothing to do" rather than a stale
           success), but once per cycle would be 1,440 identical upserts a day */
        if (t0 - lastIdleStampAt >= IDLE_STAMP_MS) {
          await record({ ok: true, skipped: "no fixture due" });
          lastIdleStampAt = t0;
        }
        return { skipped: "no fixture due" };
      }
      if (t0 < backoffUntil) return { skipped: "EA backoff after a 403", backoffUntil: iso(backoffUntil) };
      if (t0 - lastPollAt < MIN_GAP_MS) return { skipped: "polled moments ago", nextPollAt: iso(lastPollAt + MIN_GAP_MS) };

      /* (3) poll */
      const rows = await sbGet("teams?ea_club_id=not.is.null&select=ea_club_id");
      const clubs = [...new Set((rows || []).map((t) => t && t.ea_club_id).filter((v) => v != null && v !== "").map(String))];
      if (!clubs.length) {
        /* NOT ok. Without a single linked club no box score can ever import — this is the one
           skip that must show red rather than pass quietly. */
        const lastError = "No club has an ea_club_id — the EA import cannot run. Link each club's EA id in Control Center → Clubs.";
        sum.lastError = lastError;
        await record({ ok: false, polled: 0, matches: 0, errCount: 1, lastError, linkedClubs: 0 });
        return { skipped: "no teams have an ea_club_id set", ok: false, lastError };
      }

      lastPollAt = t0; sum.polls++; sum.lastPollAt = iso(t0);
      const { matches, clubErrors, blocked } = await pollClubs(clubs);
      if (blocked) {
        backoffUntil = now() + BACKOFF_MS;
        log(`ea-poll: EA answered 403 — backing off, no EA calls until ${iso(backoffUntil)}`);
      }
      sum.backoffUntil = backoffUntil > now() ? iso(backoffUntil) : null;
      sum.matches += matches.length;

      let ir = null, out = {}, ingestFail = null;
      if (matches.length) {
        try {
          ir = await F(`${site}/api/ingest-stats`, { method: "POST",
            headers: { "Content-Type": "application/json", "x-ingest-key": SB_KEY },
            body: JSON.stringify({ matches }), signal: AbortSignal.timeout(INGEST_TIMEOUT_MS) });
          out = await ir.json().catch(() => ({}));
          if (!out || typeof out !== "object") out = {};
        } catch (e) { ingestFail = `ingest: ${String((e && e.message) || e)}`; }
      }
      const ingestErrs = Array.isArray(out.errors) ? out.errors : [];
      const ingestStatus = ir ? ir.status : null;
      const ingestOk = !matches.length || (ingestStatus === 200 && ingestErrs.length === 0);
      const ok = clubErrors.length === 0 && ingestOk;
      const firstIngestErr = ingestErrs[0] && (ingestErrs[0].error || ingestErrs[0].reason || JSON.stringify(ingestErrs[0]));
      const lastError = clubErrors[0] || ingestFail || firstIngestErr
        || (matches.length && ingestStatus !== 200 ? `ingest HTTP ${ingestStatus}` : null) || null;
      const res = {
        ok, polled: clubs.length, matches: matches.length,
        errCount: clubErrors.length + ingestErrs.length + (ingestFail ? 1 : 0), lastError,
        ingest: ingestStatus,
        ingested: Array.isArray(out.ingested) ? out.ingested.length : 0,
        unmatched: Array.isArray(out.unmatched) ? out.unmatched.length : 0,
        skipped: Array.isArray(out.skipped) ? out.skipped.length : 0,
        errors: ingestErrs.length,
      };
      sum.ingested += res.ingested;
      sum.lastError = lastError;
      await cfgSet("rl_ea-poll", iso());
      await record(res);
      log(`ea-poll: polled ${clubs.length} club${clubs.length === 1 ? "" : "s"}, ${matches.length} match${matches.length === 1 ? "" : "es"}` +
        (matches.length ? `, ingest ${ingestStatus} (ingested ${res.ingested}, unmatched ${res.unmatched}, skipped ${res.skipped}, errors ${res.errors})` : "") +
        (clubErrors.length ? `, ${clubErrors.length} club error${clubErrors.length === 1 ? "" : "s"}` : ""));
      return { at: iso(), lane: "vm", ...res, clubErrors, fixtureDue };
    } catch (e) {
      const msg = String((e && e.message) || e);
      sum.lastError = msg;
      try { await record({ ok: false, errCount: 1, lastError: msg }); } catch {}
      throw e;
    }
  }

  /* ---- the loop. A cycle that throws is logged and the next one runs on schedule; a slow cycle
     never overlaps the next. The interval is unref'd so it can never be what keeps a process
     alive on its own. ---- */
  let timer = null, running = null;
  function tick() {
    if (!running) {
      running = runOnce()
        .catch((e) => log("ea-poll: cycle failed — " + String((e && e.message) || e)))
        .finally(() => { running = null; });
    }
    return running;
  }
  function start() {
    if (timer) return;
    sum.live = true;
    timer = setInterval(tick, CYCLE_MS);
    if (timer && typeof timer.unref === "function") timer.unref();
    tick();
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    sum.live = false;
  }

  return { start, stop, runOnce, tick, sum };
}

/* ---- one-shot CLI, for the VM: prints the cycle's result as JSON on stdout, logs on stderr.
   Exit 0 when the cycle ran (even one that recorded ok:false — that is a result, not a crash);
   exit 1 when it threw (Supabase unreachable, missing env). ---- */
const isMain = (() => {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return false; }
})();
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: node bot/ea-poll.mjs --once [--force]\n  --once   run one poll cycle and exit (the only mode; the loop lives in chel-bot.mjs)\n  --force  poll EA even when no fixture is due\nenv: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (source /etc/chel-bot.env)");
    process.exit(0);
  }
  const force = args.includes("--force");
  /* --once is accepted for readability; one cycle is the only mode here */
  const env = { SB_URL: process.env.SUPABASE_URL, SB_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  if (!env.SB_URL || !env.SB_KEY) {
    console.error("ea-poll: missing env — need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (set -a; . /etc/chel-bot.env; set +a)");
    process.exit(1);
  }
  createEaPoller(env, { log: (...a) => console.error(...a) }).runOnce({ force })
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((e) => { console.error("ea-poll:", String((e && e.stack) || e)); process.exit(1); });
}
