// Club notices — every signing, waiver, trade, loan and roster move, posted into the club's own
// private Discord room the moment the database records it (2026-09-14, v2.42).
//
// The database is the writer: public.club_notify() inserts one row per club per event into
// public.club_notices (and creates the site notifications for the Owner, GM and AGM). This lane
// listens to that table and posts each row into teams.discord_channel_id. The public feeds
// (#transactions, #trade-block, #management-moves) are untouched — this is the front office's copy.
//
// Exactly-once: a row is claimed on discord_post_log (kind "club", ref "club:<id>") before it is
// posted, so the live realtime path and the catch-up (this file's sweep, and discord-sync's) can
// both try the same row and only one message goes out. posted_at is stamped after delivery; a row
// that could not be delivered keeps posted_at null with post_error set, and is retried by the
// catch-up until it lands.
const UA = "DiscordBot (https://chelgamingleague.com,1.0)";
const SITE = "https://chelgamingleague.com";

/* one look for all of them: colour by kind, a compact title, the body as written by the database */
export const KIND_STYLE = {
  sign:  { colour: 0x2F9E44, icon: "✍️" },
  draft: { colour: 0x2F9E44, icon: "🎯" },
  loan:  { colour: 0x5C6B75, icon: "🔁" },
  waive: { colour: 0xC2410C, icon: "📤" },
  trade: { colour: 0xFFE500, icon: "🔄" },
  roster:{ colour: 0x8899A6, icon: "🧾" },
  offer: { colour: 0x1C7ED6, icon: "📨" },
};
export function buildNoticeEmbed(row, actorName) {
  const st = KIND_STYLE[row.kind] || { colour: 0x8899A6, icon: "🧾" };
  const tail = actorName ? "\n— " + actorName : "";
  return {
    title: st.icon + " " + String(row.title || "Roster move"),
    description: String(row.body || "") + tail,
    color: st.colour,
    url: SITE + "/#/hub/" + (row.kind === "trade" ? "tradehub" : row.kind === "offer" ? "freeagents" : "roster"),
    timestamp: row.created_at || new Date().toISOString(),
  };
}

export function createClubNotices(env, opts = {}) {
  const { SB_URL, SB_KEY, BOT } = env;
  const sum = { announced: 0, skipped: 0, failed: 0 };
  const errors = [];
  const note = (e) => { errors.push(String((e && e.message) || e).slice(0, 180)); if (errors.length > 20) errors.shift(); };
  const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
  async function sbGet(path) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return r.json();
  }
  async function sbPatch(path, body) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method: "PATCH", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status}`);
  }
  async function post(channelId, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST", headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.status === 429) { const ra = +(r.headers.get("retry-after") || 1); await new Promise((res) => setTimeout(res, ra * 1000 + 250)); continue; }
      if (r.status >= 500) { await new Promise((res) => setTimeout(res, 600 * (attempt + 1))); continue; }
      if (!r.ok) throw new Error(`post ${channelId} -> ${r.status}`);
      const t = await r.text();
      const j = t ? JSON.parse(t) : null;
      if (!j || !j.id) throw new Error(`post ${channelId} did not deliver`);
      return j;
    }
    throw new Error(`post ${channelId} -> rate-limited after retries`);
  }
  async function claim(ref) {
    const r = await fetch(`${SB_URL}/rest/v1/discord_post_log`, { method: "POST", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify({ kind: "club", ref }) });
    if (r.status === 201) return true;
    if (r.status === 409) return false;
    note(new Error(`claim ${ref} -> ${r.status}`));
    return false;
  }
  async function release(ref) {
    try { await fetch(`${SB_URL}/rest/v1/discord_post_log?kind=eq.club&ref=eq.${encodeURIComponent(ref)}`, { method: "DELETE", headers: { ...sbHead(), Prefer: "return=minimal" } }); }
    catch (e) { note(e); }
  }

  /* one row → one message in the club's room */
  async function announce(row) {
    const ref = row && row.id ? "club:" + row.id : null;
    try {
      if (!row || !row.id || !row.team_id) { sum.skipped++; return "skip"; }
      if (row.posted_at) { sum.skipped++; return "already"; }
      const teams = await sbGet(`teams?id=eq.${encodeURIComponent(row.team_id)}&select=id,code,discord_channel_id`);
      const t = teams[0];
      if (!t || !t.discord_channel_id) { sum.skipped++; return "no-room"; }
      let actor = null;
      if (row.actor_profile_id) {
        try { const p = await sbGet(`profiles?id=eq.${encodeURIComponent(row.actor_profile_id)}&select=gamertag`); actor = p[0] && p[0].gamertag ? p[0].gamertag : null; }
        catch { /* the notice stands without the name */ }
      }
      if (!(await claim(ref))) { sum.skipped++; return "claimed-elsewhere"; }
      try {
        await post(t.discord_channel_id, { embeds: [buildNoticeEmbed(row, actor)], allowed_mentions: { parse: [] } });
      } catch (e) {
        await release(ref);
        try { await sbPatch(`club_notices?id=eq.${encodeURIComponent(row.id)}`, { post_error: String(e.message || e).slice(0, 200) }); } catch { /* observability only */ }
        throw e;
      }
      await sbPatch(`club_notices?id=eq.${encodeURIComponent(row.id)}`, { posted_at: new Date().toISOString(), post_error: null });
      sum.announced++;
      return "announced";
    } catch (e) { sum.failed++; note(e); return "error"; }
  }

  /* anything still unposted after a couple of minutes: a realtime event that never arrived, a
     Discord blip, a restart mid-post */
  async function catchUp(minAgeMs = opts.catchUpAgeMs ?? 2 * 60 * 1000) {
    const before = new Date(Date.now() - minAgeMs).toISOString();
    let rows = [];
    try { rows = await sbGet(`club_notices?posted_at=is.null&created_at=lt.${encodeURIComponent(before)}&order=created_at.asc&limit=100`); }
    catch (e) { note(e); return 0; }
    let n = 0;
    for (const row of rows) { if ((await announce(row)) === "announced") n++; }
    return n;
  }

  return { announce, catchUp, sum, errors };
}
