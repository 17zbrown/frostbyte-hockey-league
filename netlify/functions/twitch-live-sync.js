// Netlify Scheduled Function — runs every 2 minutes.
// Detects which members (profiles.twitch) are ACTUALLY live on Twitch and flips
// profiles.live accordingly, so the site's LIVE badges + the "Live Now" Twitch
// chips light up on their own — no manual Go Live toggle needed.
//
// Twitch's API is reachable from cloud IPs (no proxy needed).
// Env: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Node 18+ runtime (global fetch, no dependencies).

export const config = { schedule: "*/2 * * * *" };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TW_ID = process.env.TWITCH_CLIENT_ID;
const TW_SECRET = process.env.TWITCH_CLIENT_SECRET;

const sbHeaders = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method: "PATCH", headers: { ...sbHeaders(), Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status} ${await r.text()}`);
}
// This endpoint is publicly HTTP-invocable; debounce so anonymous floods can't burn Twitch API calls.
async function ranRecently(key, sec) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/app_config?key=eq.rl_${key}&select=value`, { headers: sbHeaders() });
    const rows = await r.json();
    const last = rows && rows[0] && rows[0].value ? Date.parse(rows[0].value) : 0;
    if (Date.now() - last < sec * 1000) return true;
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: `rl_${key}`, value: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    return false;
  } catch (e) { return false; }
}

// normalize a stored handle to a bare Twitch login (strip @, URL, trailing path, lowercase)
function cleanHandle(h) {
  return String(h || "").trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

export default async () => {
  if (!SB_URL || !SB_KEY || !TW_ID || !TW_SECRET) {
    console.log("twitch-live-sync: missing env (need TWITCH_CLIENT_ID/SECRET + Supabase) — skipping");
    return new Response("skipped: missing env", { status: 200 });
  }
  if (await ranRecently("twitch-live-sync", 60)) return new Response("skipped: ran moments ago", { status: 200 });

  try {
  // 1. members who have set a Twitch handle
  const profs = await sbGet("profiles?twitch=not.is.null&select=id,twitch,live");
  const withHandle = profs.filter((p) => cleanHandle(p.twitch));
  if (!withHandle.length) return new Response("no twitch handles set", { status: 200 });

  // 2. mint an app access token (client-credentials)
  const tokRes = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(TW_ID)}&client_secret=${encodeURIComponent(TW_SECRET)}&grant_type=client_credentials`, { method: "POST" });
  if (!tokRes.ok) throw new Error(`twitch token -> ${tokRes.status} ${await tokRes.text()}`);
  const token = (await tokRes.json()).access_token;

  // 3. ask Twitch who's live (streams endpoint only returns CURRENTLY-live channels), 100 logins/call
  const live = new Set();
  const logins = [...new Set(withHandle.map((p) => cleanHandle(p.twitch)))];
  for (let i = 0; i < logins.length; i += 100) {
    const qs = logins.slice(i, i + 100).map((l) => `user_login=${encodeURIComponent(l)}`).join("&");
    const r = await fetch(`https://api.twitch.tv/helix/streams?${qs}`, { headers: { "Client-Id": TW_ID, Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`twitch streams -> ${r.status} ${await r.text()}`);
    (await r.json()).data.forEach((s) => live.add(String(s.user_login).toLowerCase()));
  }

  // 4. reconcile profiles.live (only write the ones that changed)
  let changed = 0;
  for (const p of withHandle) {
    const isLive = live.has(cleanHandle(p.twitch));
    if (Boolean(p.live) !== isLive) { await sbPatch(`profiles?id=eq.${p.id}`, { live: isLive }); changed++; }
  }
  const msg = `twitch-live-sync: ${logins.length} handles checked, ${live.size} live, ${changed} updated`;
  console.log(msg);
  try {
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "rl_twitch-live-sync_result", value: JSON.stringify({
        at: new Date().toISOString(), ok: true, checked: logins.length, live: live.size
      }), updated_at: new Date().toISOString() }) });
  } catch {}
  return new Response(msg, { status: 200 });
  } catch (e) {
    console.error("twitch-live-sync error:", e && (e.message || e));
    try {
      await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: "rl_twitch-live-sync_result", value: JSON.stringify({
          at: new Date().toISOString(), ok: false, errCount: 1, lastError: String(e && (e.message || e))
        }), updated_at: new Date().toISOString() }) });
    } catch {}
    return new Response("skipped: error", { status: 200 });
  }
};
