// "Scout on ChelHead" redirect. Tries the player's EA ID on ChelHead first; if that
// player isn't found (404), pivots to their PSN/Xbox gamertag. Goalies land on the goalie tab.
//   GET /api/scout?pid=<profile uuid>&pos=<position>   (ea/gt may also be passed directly)
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (to resolve pid -> ea_id + platform_gamertag).

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = "https://chelhead.com/view-player/common-gen5/";
const UA = "Mozilla/5.0 (compatible; ChelGamingBot/1.0; +https://chelgamingleague.com)";

// Returns the HTTP status of a ChelHead player page (-1 if it couldn't be checked in time).
async function chelStatus(name) {
  if (!name) return 0;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2800);
    const r = await fetch(BASE + encodeURIComponent(name), { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": UA } });
    clearTimeout(t);
    return r.status;
  } catch (e) { return -1; }
}

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const pid = q.get("pid"), pos = q.get("pos") || "";
  const tab = pos === "G" ? "?tab=goalie" : "";
  const dest = (name) => BASE + encodeURIComponent(String(name).trim()) + tab;

  let ea = q.get("ea"), gt = q.get("gt");
  // pid is interpolated into a service-role PostgREST query (bypasses RLS), so it MUST be a
  // strict UUID — otherwise a crafted value could inject extra filters and read other rows.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (pid && UUID_RE.test(pid) && SB_URL && SB_KEY) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${pid}&select=ea_id,platform_gamertag`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
      const rows = await r.json();
      if (rows && rows[0]) { ea = ea || rows[0].ea_id; gt = gt || rows[0].platform_gamertag; }
    } catch (e) { /* fall through to whatever we have */ }
  }

  let url;
  if (ea) {
    const st = await chelStatus(ea);
    if (st === 404 && gt) {
      // EA ID isn't on ChelHead — pivot to the console gamertag. If it's also missing, land on the EA
      // page so the viewer sees the "not found" rather than a wrong page.
      const st2 = await chelStatus(gt);
      url = (st2 === 404) ? dest(ea) : dest(gt);
    } else {
      url = dest(ea); // found, or couldn't verify in time → use the EA ID
    }
  } else if (gt) {
    url = dest(gt);
  } else {
    url = "https://chelhead.com/";
  }
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
};
