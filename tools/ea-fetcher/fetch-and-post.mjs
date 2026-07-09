#!/usr/bin/env node
// EA stats fetcher — runs on your VPS/home box (a residential/unblocked IP).
// 1) reads which EA club ids to poll straight from your site's DB (public read),
// 2) pulls each club's recent private-match history from EA,
// 3) forwards the raw matches to your Netlify ingest endpoint, which does all the
//    schedule-matching and DB writes. This script holds NO service secrets.
//
// Run on a cron every ~3-5 min. Node 18+ (global fetch, no dependencies).
//
// Required env:
//   INGEST_URL   e.g. https://chelgaming.netlify.app/api/ingest-stats
//   INGEST_KEY   the shared secret (must equal the Netlify INGEST_KEY env var)
//   SUPABASE_URL e.g. https://bzbuyclwdhmhdzujxeqd.supabase.co
//   SUPABASE_ANON_KEY   the PUBLISHABLE key (safe; public read of teams.ea_club_id)
// Optional env:
//   PLATFORM     common-gen5 (default) | common-gen4
//   HTTPS_PROXY  residential proxy URL, if this box's IP is EA-blocked (see below)

const { INGEST_URL, INGEST_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
const PLATFORM = process.env.PLATFORM || "common-gen5";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

for (const [k, v] of Object.entries({ INGEST_URL, INGEST_KEY, SUPABASE_URL, SUPABASE_ANON_KEY }))
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }

// If this IP is EA-blocked, install undici and uncomment to route EA calls via a
// residential proxy:  npm i undici  then set HTTPS_PROXY=http://user:pass@host:port
// import { ProxyAgent } from "undici";
// const eaDispatcher = process.env.HTTPS_PROXY ? new ProxyAgent(process.env.HTTPS_PROXY) : undefined;
const eaDispatcher = undefined;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clubIds() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/teams?ea_club_id=not.is.null&select=ea_club_id`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
  });
  if (!r.ok) throw new Error(`Supabase teams read ${r.status}: ${await r.text()}`);
  return [...new Set((await r.json()).map((t) => String(t.ea_club_id)).filter(Boolean))];
}

async function clubMatches(clubId) {
  const url = `https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=${PLATFORM}&clubIds=${clubId}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.ea.com/games/nhl/nhl-26" }, dispatcher: eaDispatcher });
  if (r.status === 403) throw new Error("EA 403 (this IP is blocked — use a residential proxy)");
  if (!r.ok) throw new Error(`EA ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

async function main() {
  const clubs = await clubIds();
  if (!clubs.length) { console.log("No teams have an ea_club_id set yet — nothing to poll."); return; }
  console.log(`Polling ${clubs.length} club(s) on ${PLATFORM}…`);

  const byId = new Map();
  for (const c of clubs) {
    try {
      for (const m of await clubMatches(c)) if (m && m.matchId) byId.set(String(m.matchId), m);
    } catch (e) { console.error(`  club ${c}: ${e.message}`); }
    await sleep(1500); // be gentle on EA
  }
  const matches = [...byId.values()];
  if (!matches.length) { console.log("No recent matches returned."); return; }

  const r = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-key": INGEST_KEY },
    body: JSON.stringify({ matches })
  });
  const out = await r.json().catch(() => ({}));
  console.log(`Forwarded ${matches.length} match(es) -> ingest HTTP ${r.status}`);
  console.log(`  ingested=${(out.ingested || []).length} skipped=${(out.skipped || []).length} unmatched=${(out.unmatched || []).length} errors=${(out.errors || []).length}`);
  if (out.ingested && out.ingested.length) for (const g of out.ingested) console.log(`  ✔ ${g.score}  game ${g.game_id}  (${g.linked}/${g.players} players linked)`);
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
