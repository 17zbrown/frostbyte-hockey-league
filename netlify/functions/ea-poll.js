// Netlify Scheduled Function — reliable EA stats poller.
// Replaces the unreliable GitHub Actions cron (GitHub delays/skips */5 schedules).
// Runs every 5 min on Netlify's scheduler, but ONLY hits EA when there's a
// scheduled, not-yet-final game around now (±window) — so it uses the residential
// proxy / EA bandwidth only when there's actually a game to catch.
//
// Reads club ids from Supabase (public read), pulls each club's recent private
// matches from EA (through the residential proxy, since Netlify runs on a
// datacenter IP EA blocks), and forwards them to /api/ingest-stats which does the
// schedule-matching + DB writes.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY (or SERVICE_ROLE), INGEST_KEY, HTTPS_PROXY
//      (residential proxy, same value as the old GitHub secret), optional PLATFORM.
// No-ops safely if required env is missing. Node 18+.

export const config = { schedule: "*/5 * * * *" };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const INGEST_KEY = process.env.INGEST_KEY;
const PLATFORM = process.env.PLATFORM || "common-gen5";
const PROXY = process.env.HTTPS_PROXY;
const ORIGIN = process.env.URL || "https://chelgamingleague.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

// This endpoint is publicly HTTP-invocable; debounce so anonymous floods can't burn paid-proxy
// bandwidth / hammer EA. Needs the service-role key to write the marker (SB_KEY here may be anon).
const SB_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function ranRecently(key, sec) {
  if (!SB_SVC) return false;
  const h = { apikey: SB_SVC, Authorization: `Bearer ${SB_SVC}`, "Content-Type": "application/json" };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/app_config?key=eq.rl_${key}&select=value`, { headers: h });
    const rows = await r.json();
    const last = rows && rows[0] && rows[0].value ? Date.parse(rows[0].value) : 0;
    if (Date.now() - last < sec * 1000) return true;
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: `rl_${key}`, value: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    return false;
  } catch (e) { return false; }
}

// Per-run result record — the Automations panel reads rl_<key>_result and turns the chip red
// when the last run failed, instead of greening on "it ran" alone.
async function recordResult(key, obj) {
  if (!SB_SVC) return;
  const h = { apikey: SB_SVC, Authorization: `Bearer ${SB_SVC}`, "Content-Type": "application/json" };
  try {
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: `rl_${key}_result`, value: JSON.stringify({ at: new Date().toISOString(), ...obj }), updated_at: new Date().toISOString() }) });
  } catch {}
}

/* --- NHL 27 pre-launch canary (self-disabling) ---
   EA drained the club registry when the backend flipped to the NHL 27 environment
   (observed 2026-08-28: clubs/search returns {} for every name; title rollovers reset all
   club ids). While NO club is linked, check every ~6h whether the registry is serving clubs
   again — the moment a common-word search returns results, ping #league-staff ONCE:
   that is the signal that clubs can be created in-game and linked in Control Center.
   One-shot via the ea27_canary_alerted flag; linking any club stops the canary entirely. */
async function nhl27Canary(dispatcher, uFetch) {
  if (!SB_SVC) return;
  const h = { apikey: SB_SVC, Authorization: `Bearer ${SB_SVC}`, "Content-Type": "application/json" };
  try {
    const fl = await (await fetch(`${SB_URL}/rest/v1/app_config?key=eq.ea27_canary_alerted&select=value`, { headers: h })).json();
    if (fl && fl[0] && fl[0].value) return;
    if (await ranRecently("ea27-canary", 6 * 3600)) return;
    const r = await uFetch(`https://proclubs.ea.com/api/nhl/clubs/search?platform=${PLATFORM}&clubName=hockey`, {
      headers: { "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Referer": "https://www.ea.com/", "Origin": "https://www.ea.com" },
      dispatcher, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return;                       /* API down/blocked — just try again next window */
    const data = await r.json();
    const n = Array.isArray(data) ? data.length : Object.keys(data || {}).length;
    if (!n) return;                          /* registry still empty — keep waiting */
    const wh = await (await fetch(`${SB_URL}/rest/v1/app_config?key=eq.discord_staff_webhook&select=value`, { headers: h })).json();
    const hook = wh && wh[0] && wh[0].value;
    if (hook) await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "**EA's club registry is live again** — clubs/search is returning NHL 27 clubs (" + n + " for \"hockey\"). Clubs can now be created in-game and their EA ids linked in Control Center \u2192 Clubs / Team HQ. The stats auto-import starts working as soon as clubs are linked.\n\nContract check first: https://chelgamingleague.com/api/pickup-import?diag=ea27check&club=<your club name>", username: "CGHL Automations" }) });
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "ea27_canary_alerted", value: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    console.log("ea-poll: NHL 27 canary fired — registry live, staff alerted");
  } catch (e) { console.warn("ea-poll canary:", String(e && e.message || e)); }
}

export default async () => {
  if (!SB_URL || !SB_KEY || !INGEST_KEY) {
    console.log("ea-poll: missing env (need SUPABASE_URL/ANON_KEY + INGEST_KEY) — skipping");
    return new Response("skipped: missing env", { status: 200 });
  }
  if (await ranRecently("ea-poll", 90)) return json({ skipped: "ran moments ago" });
  try {
    /* the canary runs OUTSIDE the game-window gate: pre-launch there are no games, and the
       whole point is to hear the registry come back on whatever day EA flips it on */
    {
      const { ProxyAgent, fetch: uFetch } = await import("undici");
      const noClubs = !(await sbGet(`teams?ea_club_id=not.is.null&select=ea_club_id&limit=1`)).length;
      if (noClubs) await nhl27Canary(PROXY ? new ProxyAgent(PROXY) : undefined, uFetch);
    }
    // Only poll during the league's game window: Wed 6pm ET -> Sat 2am ET (continuous, every week).
    // Enforced in America/New_York so it stays correct across daylight saving (a fixed-UTC cron can't).
    if (!inGameWindow()) {
      /* Record the skip. Returning silently left rl_ea-poll_result showing the last SUCCESSFUL run,
         so the Automations chip and the watchdog read green while the poller had done nothing for
         seventeen days — "the function runs" and "the pipeline works" were indistinguishable. */
      await recordResult("ea-poll", { ok: true, skipped: "outside game window", at: new Date().toISOString() });
      return json({ skipped: "outside game window (Wed 6pm - Sat 2am ET)" });
    }

    const clubs = [...new Set((await sbGet(`teams?ea_club_id=not.is.null&select=ea_club_id`)).map((t) => String(t.ea_club_id)).filter(Boolean))];
    if (!clubs.length) {
      /* NOT ok. Without a single linked club no box score can ever import — no scores, no stats,
         no standings, and no on-ice basis for the draft order. This is the one skip that must
         show red rather than pass quietly. */
      await recordResult("ea-poll", { ok: false, errCount: 1,
        lastError: "No club has an ea_club_id — the EA import cannot run. Link each club's EA id in Control Center → Clubs.",
        linkedClubs: 0, at: new Date().toISOString() });
      return json({ skipped: "no teams have an ea_club_id set", ok: false });
    }

    // Use undici's OWN fetch (uFetch) below, not Node's global fetch: on Node 24 the global fetch
    // silently drops the `dispatcher` option, so the ProxyAgent is ignored and EA sees the datacenter
    // IP. undici.fetch honours dispatcher, routing through the residential proxy.
    const { ProxyAgent, fetch: uFetch } = await import("undici");
    let dispatcher;
    if (PROXY) { dispatcher = new ProxyAgent(PROXY); }

    const byId = new Map();
    const clubErrors = [];
    for (const c of clubs) {
      try {
        const url = `https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=${PLATFORM}&clubIds=${c}`;
        /* full fingerprint, KEPT IN SYNC with eaFetch in ingest-stats.js/pickup-import.js —
           and no title-pinned referer, so nothing here needs touching when a new NHL ships */
        const r = await uFetch(url, { headers: {
          "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.ea.com/", "Origin": "https://www.ea.com",
          "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-site",
        }, dispatcher });
        if (!r.ok) {
          /* three distinct failure classes, so the Automations chip says what actually broke:
             a stale club id (title rollover reset it), an Akamai block, or a transient EA error.
             None of them may ever read as "0 new games". */
          const body = await r.text().catch(() => "");
          const msg = /CLUBS_ERR_INVALID_CLUB_ID/i.test(body)
            ? `club ${c}: EA says this club id no longer exists — an NHL title rollover resets every club id. Re-link the club's EA id (Team HQ \u2192 Club game stats, or Control Center \u2192 Clubs).`
            : (r.status === 403 || /Access Denied|edgesuite/i.test(body))
              ? `club ${c}: EA blocked the request (Akamai 403) — rotating residential proxy should retry next run`
              : `club ${c}: EA ${r.status} (transient?)`;
          clubErrors.push(msg); console.error("ea-poll " + msg); continue;
        }
        const data = await r.json();
        if (Array.isArray(data)) for (const m of data) if (m && m.matchId) byId.set(String(m.matchId), m);
      } catch (e) { clubErrors.push(`club ${c}: ${e.message}`); console.error(`ea-poll club ${c}: ${e.message}`); }
      await sleep(1200);
    }

    const matches = [...byId.values()];
    if (!matches.length) {
      await recordResult("ea-poll", { ok: clubErrors.length === 0, polled: clubs.length, matches: 0,
        errCount: clubErrors.length, lastError: clubErrors[0] || null });
      return json({ polled: clubs.length, matches: 0, clubErrors });
    }

    const ir = await fetch(`${ORIGIN}/api/ingest-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-key": INGEST_KEY },
      body: JSON.stringify({ matches }),
    });
    const out = await ir.json().catch(() => ({}));
    const ingestErrs = (out.errors || []).length;
    const summary = { polled: clubs.length, matches: matches.length, ingest: ir.status, ingested: (out.ingested || []).length, unmatched: (out.unmatched || []).length, skipped: (out.skipped || []).length, errors: ingestErrs };
    console.log("ea-poll:", JSON.stringify(summary));
    await recordResult("ea-poll", { ok: ir.status === 200 && ingestErrs === 0 && clubErrors.length === 0,
      ...summary, errCount: clubErrors.length + ingestErrs,
      lastError: clubErrors[0] || (out.errors && out.errors[0] && (out.errors[0].error || out.errors[0].reason)) || (ir.status !== 200 ? `ingest HTTP ${ir.status}` : null) });
    return json(summary);
  } catch (e) {
    console.error("ea-poll fatal:", e.message);
    await recordResult("ea-poll", { ok: false, errCount: 1, lastError: e.message });
    return json({ error: e.message }, 200);
  }
};

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } }); }

// League game window: Wed 6:00pm ET -> Sat 2:00am ET, continuous. DST-safe (evaluated in ET).
function inGameWindow() {
  /* Wednesday 6pm through Saturday 2am ET. Deliberately wider than the current schedule: a poll
     that runs when no game exists costs one cheap query, while a poll that does NOT run when a
     game just finished loses that box score until someone notices. The schedule's night pattern is
     a per-season setting now, so widening beats trying to track it here. */
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hour12: false })
    .formatToParts(new Date());
  const wdName = (p.find((x) => x.type === "weekday") || {}).value;
  const hr = +((p.find((x) => x.type === "hour") || {}).value || 0);
  const wd = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[wdName];
  if (wd === 3) return hr >= 18;          // Wednesday from 6pm ET
  if (wd === 4 || wd === 5) return true;  // all of Thursday and Friday
  if (wd === 6) return hr < 2;            // Saturday until 2am ET
  return false;                           // Sun / Mon / Tue: off
}
