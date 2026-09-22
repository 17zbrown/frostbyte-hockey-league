// Direct messages — what the league asks the gateway bot to say to one member, in his DMs
// (2026-09-20, v2.75). The database is the writer: public.discord_dms holds one row per message
// (the first use is the Rule 5.1 nudge: "your Week N availability is not in"). This lane listens to
// the table and sends each row once: open the member's DM channel (POST /users/@me/channels), post
// the content, stamp sent_at.
//
// Exactly-once the same way club notices are (bot/club-notices.mjs): a row is claimed on
// discord_post_log (kind "dm", ref "dm:<id>") before it is sent, so the live path and the catch-up
// cannot both send it. A provable refusal (a 4xx: the member has DMs closed, 50007, or left the
// server) releases the claim, stamps send_error and is NOT retried — a closed door does not open
// on the fifth knock, and the site notification written in the same transaction still reaches him.
// A 5xx or a timeout is an unknown outcome: the claim is kept and the row is marked unconfirmed.
import { timedFetch, withRetries, SB_TIMEOUT_MS, DISCORD_TIMEOUT_MS } from "./handlers.mjs";

const UA = "DiscordBot (https://chelgamingleague.com,1.0)";

export function createDms(env, opts = {}) {
  const { SB_URL, SB_KEY, BOT } = env;
  const SB_MS = opts.sbTimeoutMs ?? SB_TIMEOUT_MS;
  const D_MS = opts.discordTimeoutMs ?? DISCORD_TIMEOUT_MS;
  const sum = { sent: 0, skipped: 0, refused: 0, deferred: 0, failed: 0, unconfirmed: 0, stampFailed: 0, errors: 0, lastErrorAt: null, lastError: null };
  const errors = [];
  const note = (e) => {
    const msg = String((e && e.message) || e).slice(0, 180);
    errors.push(msg); if (errors.length > 20) errors.shift();
    sum.errors++; sum.lastErrorAt = Date.now(); sum.lastError = msg;
  };
  const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
  async function sbGet(path) {
    const r = await timedFetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() }, SB_MS);
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return r.json();
  }
  async function sbPatch(path, body) {
    const r = await timedFetch(`${SB_URL}/rest/v1/${path}`, { method: "PATCH", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify(body) }, SB_MS);
    if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status}`);
  }
  /* one attempt apart from a 429; 4xx = provable refusal, 5xx/timeout = ambiguous (see club-notices.mjs) */
  async function discord(method, path, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await timedFetch(`https://discord.com/api/v10${path}`, {
        method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
        body: body == null ? undefined : JSON.stringify(body),
      }, D_MS);
      if (r.status === 429) { const ra = +(r.headers.get("retry-after") || 1); await new Promise((res) => setTimeout(res, ra * 1000 + 250)); continue; }
      if (r.status >= 500) { const e = new Error(`${method} ${path} -> ${r.status} (delivery unknown)`); e.ambiguous = true; throw e; }
      if (!r.ok) { const t = await r.text().catch(() => ""); const e = new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 120)}`); e.provable = true; throw e; }
      const t = await r.text();
      const j = t ? JSON.parse(t) : null;
      if (!j || !j.id) { const e = new Error(`${method} ${path} returned no id`); e.provable = true; throw e; }
      return j;
    }
    /* v2.78: a 429 means Discord stored NOTHING, so this is not a refusal like a closed DM — it is
       "not yet". Tagged neither provable nor ambiguous: the claim is released and send_error is left
       null, so the next catch-up tries again instead of the row being excluded forever. */
    const e = new Error(`${method} ${path} -> rate-limited after retries`); e.retry = true; throw e;
  }
  async function claim(ref) {
    const r = await timedFetch(`${SB_URL}/rest/v1/discord_post_log`, { method: "POST", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify({ kind: "dm", ref }) }, SB_MS);
    if (r.status === 201) return true;
    if (r.status === 409) return false;
    note(new Error(`claim ${ref} -> ${r.status}`));
    return false;
  }
  async function release(ref) {
    try { await timedFetch(`${SB_URL}/rest/v1/discord_post_log?kind=eq.dm&ref=eq.${encodeURIComponent(ref)}`, { method: "DELETE", headers: { ...sbHead(), Prefer: "return=minimal" } }, SB_MS); }
    catch (e) { note(e); }
  }
  const stamp = (rowId, body) => sbPatch(`discord_dms?id=eq.${encodeURIComponent(rowId)}`, body);
  const unstamped = new Map();   // ref -> row id: Discord has it, sent_at does not
  const unconfirmed = new Set(); // ref: outcome unknown, claim held, never re-sent
  const dmChannels = new Map();  // discord_id -> DM channel id (Discord returns the same channel every time)

  async function send(row) {
    const ref = row && row.id ? "dm:" + row.id : null;
    try {
      if (!row || !row.id || !row.discord_id || !row.content) { sum.skipped++; return "skip"; }
      if (row.sent_at || row.send_error) { sum.skipped++; return "already"; }
      if (unconfirmed.has(ref)) { sum.skipped++; return "unconfirmed"; }
      if (unstamped.has(ref)) {
        try { await stamp(row.id, { sent_at: new Date().toISOString(), send_error: null }); unstamped.delete(ref); return "stamped-late"; }
        catch (e) { note(e); return "unstamped"; }
      }
      if (!(await claim(ref))) { sum.skipped++; return "claimed-elsewhere"; }
      try {
        let ch = dmChannels.get(row.discord_id);
        if (!ch) { const c = await discord("POST", "/users/@me/channels", { recipient_id: row.discord_id }); ch = c.id; dmChannels.set(row.discord_id, ch); }
        /* flags 4 = SUPPRESS_EMBEDS: a DM carries a link to the site and the unfurled card buried it */
        await discord("POST", `/channels/${ch}/messages`, { content: String(row.content).slice(0, 1990), allowed_mentions: { parse: [] }, flags: 4 });
      } catch (e) {
        const msg = String(e.message || e).slice(0, 200);
        if (e.retry) {
          await release(ref);
          sum.deferred++;
          note(new Error(`${ref}: ${msg} — left for the next sweep`));
          return "deferred";
        }
        if (e.provable) {
          /* the door is closed (DMs off, left the server): record it, hand the claim back, do not knock again */
          await release(ref);
          sum.refused++;
          try { await stamp(row.id, { send_error: msg }); } catch (e2) { note(e2); }
          return "refused";
        }
        unconfirmed.add(ref);
        sum.unconfirmed++;
        note(new Error(`${ref}: delivery unconfirmed (${msg}) — claim kept, not re-sent`));
        try { await stamp(row.id, { send_error: `unconfirmed: ${msg}`.slice(0, 200) }); } catch { /* observability only */ }
        return "unconfirmed";
      }
      sum.sent++;
      try { await withRetries(() => stamp(row.id, { sent_at: new Date().toISOString(), send_error: null })); }
      catch (e) {
        unstamped.set(ref, row.id);
        sum.stampFailed++;
        note(new Error(`${ref}: delivered but sent_at would not write (${String(e.message || e).slice(0, 120)}) — claim kept`));
        return "sent-unstamped";
      }
      return "sent";
    } catch (e) { sum.failed++; note(e); return "error"; }
  }

  /* anything unsent and unrefused after a couple of minutes: a realtime event that never arrived, a restart mid-send */
  async function catchUp(minAgeMs = opts.catchUpAgeMs ?? 2 * 60 * 1000) {
    const before = new Date(Date.now() - minAgeMs).toISOString();
    let rows = [];
    try { rows = await sbGet(`discord_dms?sent_at=is.null&send_error=is.null&created_at=lt.${encodeURIComponent(before)}&order=created_at.asc&limit=100`); }
    catch (e) { note(e); return 0; }
    let n = 0;
    for (const row of rows) {
      if (String(await send(row)).startsWith("sent")) n++;
      await new Promise((r) => setTimeout(r, opts.gapMs ?? 350));
    }
    return n;
  }

  /* Discord's DM limits are per-recipient AND global, and the availability nudge writes one row per
     player in a single statement — a hundred realtime events at once. Everything funnels through one
     queue with a small gap between messages, so the burst is paced instead of being half-refused. */
  const GAP_MS = opts.gapMs ?? 350;
  let chain = Promise.resolve(), lastAt = 0;
  function enqueue(row){
    const run = chain.then(async () => {
      const wait = Math.max(0, GAP_MS - (Date.now() - lastAt));
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try { return await send(row); } finally { lastAt = Date.now(); }
    });
    chain = run.catch(() => {});
    return run;
  }
  async function catchUpQueued(minAgeMs){ return catchUp(minAgeMs); }
  return { send: enqueue, sendNow: send, catchUp: catchUpQueued, sum, errors };
}
