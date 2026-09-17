#!/usr/bin/env node
/* Read-only load test against the live site + Supabase REST (anon key), the way real visitors
   hit it (2026-09-17). Never writes. Usage: SB_KEY=… node tools/loadtest.mjs [scenario]
   scenarios: site (CDN), boot (the per-visitor query set), draft (170 clients reconciling at once),
   herd (a game goes final: every open tab rebuilds the league at once, three games a minute apart) */
const SB = "https://bzbuyclwdhmhdzujxeqd.supabase.co", KEY = process.env.SB_KEY;
if (!KEY) { console.error("SB_KEY missing"); process.exit(2); }
const H = { apikey: KEY, Authorization: "Bearer " + KEY, Accept: "application/json" };
const scenario = process.argv[2] || "all";
const S1 = "0f1198ee-c6e0-451b-b108-2c7b1e7b6bcc";
const BOOT = [
  "/rest/v1/teams?select=*", "/rest/v1/divisions?select=*&order=sort_order", "/rest/v1/seasons?select=*&order=number.desc",
  "/rest/v1/profiles?select=id,gamertag,display_name,avatar_url,role,created_at,twitch,live,overall,banned,ea_id,platform,jersey_number,in_guild,departments,timezone&order=id&limit=1000",
  "/rest/v1/roster_spots?select=*&order=id&limit=1000", "/rest/v1/contracts?select=*&order=id&limit=1000",
  "/rest/v1/games?select=*&order=scheduled_at&limit=1000", "/rest/v1/transactions?select=*&order=occurred_at.desc&limit=1000",
  "/rest/v1/news?select=*&order=published_at.desc&limit=1000",
  "/rest/v1/draft_picks?select=id,season_number,round,original_team_id,current_team_id,player_id,used,overall_pick,skipped&order=season_number,round&limit=1000",
  "/rest/v1/leagues?select=*&order=sort_order", `/rest/v1/game_stats?select=*&season_id=eq.${S1}&order=id&limit=1000`,
  "/rest/v1/feature_flags?select=key,enabled", "/rest/v1/site_config?select=key,value",
];
const RPCS = ["registration_pool", "career_games_played"];
const DRAFT = ["/rest/v1/draft_picks?select=id,season_number,round,original_team_id,current_team_id,player_id,used,overall_pick,skipped,picked_at&order=overall_pick&limit=1000", "/rest/v1/draft_state?select=*"];
const stats = {};
function rec(k, ms, status) { const s = (stats[k] ||= { n: 0, ms: [], err: 0, s429: 0, bytes: 0, codes: {} }); s.n++; s.ms.push(ms); if (status >= 400) s.err++; if (status === 429) s.s429++; if (status >= 400) s.codes[status] = (s.codes[status] || 0) + 1; }
async function get(url, k, opts) {
  const t = performance.now();
  try { const r = await fetch(url, opts); const b = await r.arrayBuffer(); rec(k, performance.now() - t, r.status); (stats[k].bytes += b.byteLength); return r.status; }
  catch (e) { rec(k, performance.now() - t, 599); return 599; }
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
function report(title) {
  console.log("\n== " + title);
  for (const [k, s] of Object.entries(stats)) console.log(`${k.padEnd(28)} n=${String(s.n).padStart(5)}  p50=${String(pct(s.ms, .5)).padStart(5)}ms  p95=${String(pct(s.ms, .95)).padStart(5)}ms  max=${String(Math.round(Math.max(...s.ms))).padStart(5)}ms  err=${s.err} 429=${s.s429}  avg=${Math.round(s.bytes / s.n / 1024)}KB${Object.keys(s.codes).length ? '  codes=' + JSON.stringify(s.codes) : ''}`);
  for (const k of Object.keys(stats)) delete stats[k];
}
async function pool(n, jobs) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const j = jobs[i++]; await j(); } })); }

if (scenario === "site" || scenario === "all") {
  const jobs = Array.from({ length: 300 }, () => () => get("https://chelgamingleague.com/?lt=" + Math.random(), "site index (CDN)", { cache: "no-store" }));
  const t0 = performance.now(); await pool(60, jobs); report(`site: 300 page fetches, 60 concurrent, ${Math.round(performance.now() - t0)} ms wall`);
}
if (scenario === "boot" || scenario === "all") {
  /* 150 visitors arriving over ~60 s, each firing the whole boot set at once (as the SPA does) */
  const visitors = 150, t0 = performance.now();
  await Promise.all(Array.from({ length: visitors }, (_, v) => new Promise((res) => setTimeout(res, Math.floor(v * 60000 / visitors))).then(async () => {
    await Promise.all([
      ...BOOT.map((p) => get(SB + p, "boot " + p.split("?")[0].replace("/rest/v1/", ""), { headers: H })),
      ...RPCS.map((r) => get(SB + "/rest/v1/rpc/" + r, "rpc " + r, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: "{}" })),
    ]);
  })));
  report(`boot: ${visitors} visitors over 60 s × ${BOOT.length + RPCS.length} requests each, ${Math.round(performance.now() - t0)} ms wall`);
}
if (scenario === "herd" || scenario === "all") {
  /* league-live realtime: a games row changes and EVERY connected tab (guests too) re-runs the
     whole boot set after a 1 s debounce. Three finals landing ~20 s apart on a slot end. */
  const tabs = +(process.env.TABS || 150);
  for (let g = 0; g < 3; g++) {
    const t0 = performance.now();
    await Promise.all(Array.from({ length: tabs }, () => Promise.all([
      ...BOOT.map((p) => get(SB + p, "herd " + p.split("?")[0].replace("/rest/v1/", ""), { headers: H })),
      ...RPCS.map((r) => get(SB + "/rest/v1/rpc/" + r, "herd rpc " + r, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: "{}" })),
    ])));
    console.log(`herd wave ${g + 1}: ${tabs * (BOOT.length + RPCS.length)} requests in ${Math.round(performance.now() - t0)} ms`);
    if (g < 2) await new Promise((r) => setTimeout(r, 20000));
  }
  report(`herd: 3 waves × ${tabs} tabs × ${BOOT.length + RPCS.length} requests`);
}
if (scenario === "draft" || scenario === "all") {
  /* a pick lands: 170 open draft rooms reconcile within the same second, five times in a row */
  for (let round = 0; round < 5; round++) {
    const t0 = performance.now();
    await Promise.all(Array.from({ length: 170 }, () => Promise.all(DRAFT.map((p) => get(SB + p, "draft " + p.split("?")[0].replace("/rest/v1/", ""), { headers: H })))));
    console.log(`draft burst ${round + 1}: 340 requests in ${Math.round(performance.now() - t0)} ms`);
  }
  report("draft: 5 bursts × 170 clients × 2 tables");
}
