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

export default async () => {
  if (!SB_URL || !SB_KEY || !INGEST_KEY) {
    console.log("ea-poll: missing env (need SUPABASE_URL/ANON_KEY + INGEST_KEY) — skipping");
    return new Response("skipped: missing env", { status: 200 });
  }
  try {
    // Gate: only poll when a not-final game is scheduled within [now-12h, now+8h].
    const lo = new Date(Date.now() - 12 * 3600e3).toISOString();
    const hi = new Date(Date.now() + 8 * 3600e3).toISOString();
    const due = await sbGet(`games?status=neq.final&scheduled_at=gte.${encodeURIComponent(lo)}&scheduled_at=lte.${encodeURIComponent(hi)}&select=id&limit=1`);
    if (!due.length) return json({ skipped: "no games scheduled around now" });

    const clubs = [...new Set((await sbGet(`teams?ea_club_id=not.is.null&select=ea_club_id`)).map((t) => String(t.ea_club_id)).filter(Boolean))];
    if (!clubs.length) return json({ skipped: "no teams have an ea_club_id set" });

    let dispatcher;
    if (PROXY) { const { ProxyAgent } = await import("undici"); dispatcher = new ProxyAgent(PROXY); }

    const byId = new Map();
    for (const c of clubs) {
      try {
        const url = `https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=${PLATFORM}&clubIds=${c}`;
        const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.ea.com/games/nhl/nhl-26" }, dispatcher });
        if (!r.ok) { console.error(`ea-poll club ${c}: EA ${r.status}${r.status === 403 ? " (IP blocked — needs residential HTTPS_PROXY)" : ""}`); continue; }
        const data = await r.json();
        if (Array.isArray(data)) for (const m of data) if (m && m.matchId) byId.set(String(m.matchId), m);
      } catch (e) { console.error(`ea-poll club ${c}: ${e.message}`); }
      await sleep(1200);
    }

    const matches = [...byId.values()];
    if (!matches.length) return json({ polled: clubs.length, matches: 0 });

    const ir = await fetch(`${ORIGIN}/api/ingest-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-key": INGEST_KEY },
      body: JSON.stringify({ matches }),
    });
    const out = await ir.json().catch(() => ({}));
    const summary = { polled: clubs.length, matches: matches.length, ingest: ir.status, ingested: (out.ingested || []).length, unmatched: (out.unmatched || []).length, skipped: (out.skipped || []).length };
    console.log("ea-poll:", JSON.stringify(summary));
    return json(summary);
  } catch (e) {
    console.error("ea-poll fatal:", e.message);
    return json({ error: e.message }, 200);
  }
};

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } }); }
