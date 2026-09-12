// Netlify Scheduled Function — the FALLBACK lane of the EA stats poller.
//
// The poll runs in two lanes:
//   1. VM lane (PRIMARY): bot/ea-poll.mjs on the always-on Oracle VM runs the same cycle from an
//      egress EA serves, stamps app_config rl_ea-poll-vm every cycle, and owns rl_ea-poll_result.
//      While that stamp is under 10 minutes old this function returns "VM poller active" right
//      after the debounce — before any EA call, before the NHL 27 canary, and without writing a
//      result record of its own.
//   2. Netlify lane (FALLBACK): this file, every 5 min on Netlify's scheduler. It takes over only
//      when the VM stamp is stale or cannot be read (fail open), and it can reach EA only through
//      HTTPS_PROXY (a residential proxy) or from an egress EA is not blocking.
// Both lanes obey shared/game-window.cjs: EA is asked only while a fixture's game window
// (puck drop − 10 min … + 3 h, plus a 15-min fetching grace) contains now, and only for the clubs
// in those fixtures. Everything found is forwarded; the importer alone decides what files.
//
// Reads club ids from Supabase, pulls each club's recent private matches from EA, and forwards
// them to /api/ingest-stats which does the schedule-matching + DB writes.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (SUPABASE_ANON_KEY as a read fallback), INGEST_KEY,
//      optional HTTPS_PROXY (residential proxy), optional PLATFORM.
// No-ops safely if required env is missing. Node 18+.

export const config = { schedule: "*/5 * * * *" };

import { openFixtureFilter, fixtureForMatch, describeWindow, GAME_WINDOW_BEFORE_MS, GAME_WINDOW_AFTER_MS, POLL_GRACE_MS } from "../../shared/game-window.cjs";

const SB_URL = process.env.SUPABASE_URL;
/* service role first (v2.35): the reads ran on the anon key, a leftover of the retired GitHub
   fetcher, and worked only because RLS happens to let anon read teams — a policy change would
   have returned [] and read as "no club has an ea_club_id". The anon key remains a fallback. */
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
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

/* The VM lane's heartbeat. bot/ea-poll.mjs stamps rl_ea-poll-vm each cycle; while it is fresh the
   Netlify lane stands down. A stamp that is missing, unparseable, or unreadable (a Supabase error,
   an RLS surprise on the anon key) reads as NOT fresh, so the Netlify lane fails OPEN and polls —
   the failure mode is a redundant poll, never a missed box score. */
const VM_FRESH_MS = 10 * 60 * 1000;
async function vmPollerActive() {
  try {
    const rows = await sbGet(`app_config?key=eq.rl_ea-poll-vm&select=value`);
    const at = rows && rows[0] && rows[0].value ? Date.parse(rows[0].value) : NaN;
    /* bounded on BOTH sides: a future-dated stamp (a VM clock ahead, a bad manual write) must not
       keep this lane standing down forever after the VM has died */
    return Number.isFinite(at) && Math.abs(Date.now() - at) < VM_FRESH_MS;
  } catch (e) {
    console.warn("ea-poll: VM lane stamp unreadable, falling back to the Netlify lane:", String(e && e.message || e));
    return false;
  }
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
    console.log("ea-poll: missing env (need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + INGEST_KEY) — skipping");
    return new Response("skipped: missing env", { status: 200 });
  }
  if (await ranRecently("ea-poll", 90)) return json({ skipped: "ran moments ago" });
  /* VM lane first: while the always-on bot is polling, do nothing here — no EA call, no canary,
     and no rl_ea-poll_result write (the VM owns that record, so a write here would overwrite the
     run that actually happened) */
  if (await vmPollerActive()) return json({ skipped: "VM poller active" });
  try {
    /* the canary runs OUTSIDE the game-window gate: pre-launch there are no games, and the
       whole point is to hear the registry come back on whatever day EA flips it on */
    {
      const { ProxyAgent, fetch: uFetch } = await import("undici");
      const noClubs = !(await sbGet(`teams?ea_club_id=not.is.null&select=ea_club_id&limit=1`)).length;
      if (noClubs) await nhl27Canary(PROXY ? new ProxyAgent(PROXY) : undefined, uFetch);
    }
    /* THE GATE (shared/game-window.cjs, the same rule the VM lane and the importer apply): EA is
       asked only while a fixture's game window (puck drop − 10 min to + 3 h, plus the fetching
       grace) contains now, and only for the clubs in those fixtures. A fixture a first sitting has
       already filed stays in the set: its Rule 4.3 replay still has to be collected and merged. A
       poll on a night with no fixture used to record a failing run on any EA hiccup and page the
       commissioners; now it simply does not happen. Recording the skip keeps rl_ea-poll_result
       honest ("nothing to do" rather than a stale success the chip and the watchdog read as green). */
    const fixtures = await sbGet(`games?status=in.(scheduled,final)&${openFixtureFilter(Date.now(), GAME_WINDOW_BEFORE_MS, GAME_WINDOW_AFTER_MS + POLL_GRACE_MS)}&select=id,home_team_id,away_team_id,scheduled_at,status`);
    const open = fixtures.filter((g) => g && g.home_team_id && g.away_team_id && g.scheduled_at);
    if (!open.length) {
      await recordResult("ea-poll", { ok: true, skipped: "no fixture in its game window", at: new Date().toISOString() });
      return json({ skipped: `no fixture in its game window (${describeWindow()})` });
    }
    const teamIds = [...new Set(open.flatMap((g) => [g.home_team_id, g.away_team_id]))];
    const linked = await sbGet(`teams?id=in.(${teamIds.map(encodeURIComponent).join(",")})&ea_club_id=not.is.null&select=id,ea_club_id`);
    const teamByClub = Object.fromEntries(linked.filter((t) => t.ea_club_id != null && t.ea_club_id !== "").map((t) => [String(t.ea_club_id), t.id]));
    const clubs = Object.keys(teamByClub);
    if (!clubs.length) {
      /* NOT ok. Without a linked club no box score can ever import — no scores, no stats, no
         standings, and no on-ice basis for the draft order. This is the one skip that must show
         red rather than pass quietly. */
      await recordResult("ea-poll", { ok: false, errCount: 1,
        lastError: `None of the ${teamIds.length} clubs in tonight's open fixtures has an EA club linked — their box scores cannot import. Link each club's EA id in Control Center → Clubs.`,
        linkedClubs: 0, at: new Date().toISOString() });
      return json({ skipped: "no linked EA club among the open fixtures", ok: false });
    }

    // uFetch (undici's own) is used below because a PROXIED attempt needs it: Node's global fetch
    // silently drops the `dispatcher` option, which would ignore the ProxyAgent entirely.
    const { ProxyAgent, fetch: uFetch } = await import("undici");
    /* Direct first, proxy only as a fallback — EA blocks by client FINGERPRINT, not by datacenter
       IP (verified 2026-09-07: curl 403, undici 200, from both a residential and a datacenter
       address). Keeping the poller on a paid residential proxy is what took the whole import down
       when IPRoyal lapsed; now a dead proxy costs nothing because it is never the first route. */
    const EA_HEADERS = {
      "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.ea.com/", "Origin": "https://www.ea.com",
      "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-site",
    };
    async function eaGet(url) {
      const routes = PROXY ? [null, PROXY] : [null];
      /* Keep BOTH the best response and the last transport error. Returning a bare null on failure
         threw away the reason, and — worse — a direct 403 followed by a proxy that throws would
         discard the 403 too, turning "EA blocked us (Akamai)" into a blank "unreachable". Each
         attempt is capped like the eaFetch siblings so two routes across seven clubs cannot run
         past the function timeout. */
      let r = null, why = "";
      for (const proxy of routes) {
        const opts = { headers: EA_HEADERS, signal: AbortSignal.timeout(2800) };
        if (proxy) opts.dispatcher = new ProxyAgent(proxy);
        let res = null;
        try { res = await uFetch(url, opts); }
        catch (e) { why = (proxy ? "proxy: " : "direct: ") + String((e && e.message) || e); }
        if (res) {
          r = res;                                  // never let a later throw erase an earlier answer
          if (res.ok) return res;
          why = (proxy ? "proxy: " : "direct: ") + "EA " + res.status;
          if (res.status !== 403) return res;       // a non-403 will not be fixed by another route
        }
      }
      return { response: r, why: why || "no route answered" };
    }

    const byId = new Map();
    const clubErrors = [];
    for (const c of clubs) {
      try {
        const url = `https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=${PLATFORM}&clubIds=${c}`;
        /* full fingerprint, KEPT IN SYNC with eaFetch in ingest-stats.js/pickup-import.js —
           and no title-pinned referer, so nothing here needs touching when a new NHL ships */
        const got = await eaGet(url);
        /* eaGet returns a Response directly on success; on failure it returns {response, why} so the
           cause survives. clubErrors is a STRING channel — its first entry becomes lastError and is
           rendered straight into the Automations chip tooltip, where an object reads "[object Object]". */
        const r = (got && typeof got.ok === "boolean") ? got : (got && got.response) || null;
        if (!r) {
          const msg = `club ${c}: EA unreachable — ${(got && got.why) || "no route answered"}`;
          clubErrors.push(msg); console.error("ea-poll " + msg); continue;
        }
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

    /* everything EA returned for these clubs goes to the importer — the one place that files, and
       it needs the whole picture (its archive, and the Rule 4.3 merge's "did either club play
       anyone else in between" test). Half-formed single-club records are dropped here; offWindow
       counts what the importer is expected to refuse (not a scheduled matchup, or ended outside
       the fixture's window). */
    let offWindow = 0, incomplete = 0;
    const matches = [...byId.values()].filter((m) => {
      const cl = Object.keys(m.clubs || {});
      if (cl.length < 2) { incomplete++; return false; }
      const a = teamByClub[String(cl[0])], b = teamByClub[String(cl[1])];
      if (!(a && b && fixtureForMatch(open, a, b, (+m.timestamp || 0) * 1000))) offWindow++;
      return true;
    });
    const unlinked = teamIds.filter((id) => !linked.some((t) => t.id === id));
    const warning = unlinked.length ? `${unlinked.length} club${unlinked.length === 1 ? "" : "s"} in tonight's fixtures ${unlinked.length === 1 ? "has" : "have"} no EA club linked — their games cannot import until they are linked in Team HQ` : undefined;
    /* the VM lane may have come back during the 10-20 s of EA fetching above — re-check before
       ANY result write or hand-off, so this lane never overwrites the VM's record with a lane-less
       one nor ingests a batch the VM is already handling */
    if (await vmPollerActive()) return json({ skipped: "VM poller active (resumed mid-run)", matches: matches.length });
    if (!matches.length) {
      await recordResult("ea-poll", { ok: clubErrors.length === 0, polled: clubs.length, matches: 0, offWindow, incomplete, fixturesOpen: open.length,
        errCount: clubErrors.length, lastError: clubErrors[0] || null, ...(warning ? { warning, unlinkedInFixtures: unlinked.length } : {}) });
      return json({ polled: clubs.length, matches: 0, offWindow, incomplete, clubErrors });
    }

    const ir = await fetch(`${ORIGIN}/api/ingest-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-key": INGEST_KEY },
      body: JSON.stringify({ matches }),
    });
    const out = await ir.json().catch(() => ({}));
    const ingestErrs = (out.errors || []).length;
    const summary = { polled: clubs.length, matches: matches.length, offWindow, incomplete, fixturesOpen: open.length, ingest: ir.status, ingested: (out.ingested || []).length, unmatched: (out.unmatched || []).length, skipped: (out.skipped || []).length, errors: ingestErrs, ...(warning ? { warning, unlinkedInFixtures: unlinked.length } : {}) };
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
