// Netlify Scheduled Function — the pickup lobby clock. Sole owner of every timer on lfg_lobbies,
// so there is exactly one writer and no two jobs can clobber each other's state.
//
//   (1) Per-player queue timer. Each signup holds its own spot for 30 minutes from the moment it was
//       made. This replaced a lobby-wide idle timer that wiped EVERYONE the moment the room went
//       quiet for half an hour — which is why no lobby ever accumulated 12 players.
//       At a few minutes left the player is pinged once in the lobby channel; at zero they're
//       dropped from the board. Running /join again renews their full 30 minutes.
//   (2) The public summary stays the last message in the channel, rebuilt whenever the roster
//       actually moves — never on a quiet tick, which would be pure churn.
//   (3) A lobby that empties out is retired, so the next /join starts clean.
//   (4) A full lobby nobody claimed /captain on within 5 minutes gets the first two signups as
//       captains and starts the draft itself.
//
// Cadence is every 2 minutes and the warning band is deliberately WIDER than the tick (4 min vs 2),
// so some tick always lands inside it: nobody is ever dropped without being warned first. The ping
// prints the real remaining minutes rather than a fixed number, because the tick that catches a
// player may find them at 2 minutes rather than 4 — a message promising "3 minutes" would be a lie
// most of the time.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_BOT_TOKEN. Node 18+.

export const config = { schedule: "*/2 * * * *" };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT = process.env.DISCORD_BOT_TOKEN;
const UA = "DiscordBot (https://chelgamingleague.com,1.0)";
const BRAND = 0xFFE500;

const HOLD_MS = 30 * 60 * 1000;      // how long one signup holds its spot
const WARN_MS = 4 * 60 * 1000;       // ping once when this little is left (> the tick, so it can't be skipped)
const CAPTAIN_MS = 5 * 60 * 1000;    // full lobby, nobody volunteered -> auto-assign captains
const EMPTY_GRACE_MS = 5 * 60 * 1000; // don't retire a row in the seconds between its creation and the click that made it

const json = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${(await r.text()).slice(0, 140)}`);
  return r.json();
}
// Column-scoped patch (PostgREST only writes the keys you send, so this never touches `state`).
async function patchLobby(id, body) {
  const r = await fetch(`${SB_URL}/rest/v1/lfg_lobbies?id=eq.${id}`, { method: "PATCH", headers: sbHead(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH lobby -> ${r.status} ${(await r.text()).slice(0, 140)}`);
}
// Every write that replaces `state` goes through the same optimistic compare-and-swap the
// interactions endpoint uses. Without it a warning tick that read the lobby a moment before
// someone's 12th join would write its own stale roster back and erase that player.
// A lost CAS is not an error — the row moved under us, so we simply re-read it next tick.
async function casState(id, prevUpdatedAt, body) {
  const r = await fetch(`${SB_URL}/rest/v1/lfg_lobbies?id=eq.${id}&updated_at=eq.${encodeURIComponent(prevUpdatedAt)}`, {
    method: "PATCH", headers: { ...sbHead(), Prefer: "return=representation" },
    body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`CAS lobby -> ${r.status} ${(await r.text()).slice(0, 140)}`);
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}
// Retries on 429 / 5xx: a rate limit mid-sweep must not silently drop a player's only warning.
async function dApi(method, path, body) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://discord.com/api/v10${path}`, {
      method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 404) return null;
    if (r.status === 429) {
      const j = await r.json().catch(() => ({}));
      await new Promise((s) => setTimeout(s, ((+j.retry_after || 1) + 0.25) * 1000));
      continue;
    }
    if (r.status >= 500) { await new Promise((s) => setTimeout(s, 600 * (i + 1))); continue; }
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  throw new Error(`${method} ${path} -> gave up after retries (rate limit or Discord 5xx)`);
}

/* ---------- shared shape with discord-interactions.js ---------- */
const POS = [
  { key: "C", label: "Center" }, { key: "LW", label: "Left Wing" }, { key: "RW", label: "Right Wing" },
  { key: "LD", label: "Left Defense" }, { key: "RD", label: "Right Defense" }, { key: "G", label: "Goaltender" },
];
const POS_LABEL = POS.reduce((m, p) => (m[p.key] = p.label, m), {});
const PER_POS = 2, FULL = POS.length * PER_POS;
const posCount = (s, pos) => (s.signups || []).filter((x) => x.pos === pos).length;
const teamNames = (s, side) => ((s.teams && s.teams[side]) || []).map((id) => `<@${id}>`).join(", ") || "—";

function summaryEmbed(s) {
  const fields = POS.map((p) => {
    const who = (s.signups || []).filter((x) => x.pos === p.key).map((x) => `<@${x.id}>`).join(", ");
    return { name: `${p.label} (${posCount(s, p.key)}/${PER_POS})`, value: who || "_open_", inline: true };
  });
  return { title: "🏒 Pickup Lobby — who's in",
    description: `**${(s.signups || []).length}/${FULL}** signed up. Run **/join** to grab an open spot — first ${FULL} (2 per position) locks the lobby and moves to its own channel.\n\nEach spot is held for **30 minutes**. You'll get a ping here before yours lapses — run **/join** again to renew it.`,
    color: BRAND, fields };
}
function draftView(lobby) {
  const s = lobby.state;
  const cur = s.turn === "A" ? s.captains[0] : s.captains[1];
  const pool = (s.signups || []).filter((x) => x.id !== s.captains[0] && x.id !== s.captains[1] && !s.teams.A.includes(x.id) && !s.teams.B.includes(x.id));
  /* KEEP IN SYNC with discord-interactions.js: only legal picks appear in the dropdown */
  const posOf = {}; (s.signups || []).forEach((x) => { posOf[x.id] = x.pos; });
  const filled = ((s.teams && s.teams[s.turn]) || []).map((id) => posOf[id]);
  const options = pool.filter((x) => !filled.includes(x.pos)).slice(0, 25).map((x) => ({ label: `${x.name}`.slice(0, 100), description: POS_LABEL[x.pos], value: x.id }));
  return { embeds: [{ title: "🧢 Captains' draft",
    description: `<@${cur}> is on the clock — pick a player.\n\n**Team A** (<@${s.captains[0]}>): ${teamNames(s, "A")}\n**Team B** (<@${s.captains[1]}>): ${teamNames(s, "B")}`,
    color: BRAND, footer: { text: `${pool.length} player${pool.length === 1 ? "" : "s"} left on the board` } }],
    components: [{ type: 1, components: [{ type: 3, custom_id: `lfg:pick:${lobby.id}`, placeholder: "Captain — pick a player", options, min_values: 1, max_values: 1 }] }] };
}

// Wind a lobby down and turn its summary into a "start a fresh one" notice. Claims the row FIRST:
// announcing a reset for a lobby somebody just joined would be worse than a tick's delay.
async function retire(lo, why, errors) {
  const cleared = { ...(lo.state || {}), signups: [], captains: [], teams: { A: [], B: [] } };
  if (!(await casState(lo.id, lo.updated_at, { status: "expired", state: cleared }))) return false;
  if (lo.message_id) {
    try {
      await dApi("PATCH", `/channels/${lo.channel_id}/messages/${lo.message_id}`, {
        embeds: [{ title: "♻️ Pickup lobby reset", description: `${why} Run \`/join\` to start a fresh one.`, color: BRAND }], components: [] });
    } catch (e) { errors.push(`lfg reset embed: ${String(e.message || e)}`); }
  }
  return true;
}

/* ---------- (1)(2)(3) open lobbies: per-player clock + the summary ---------- */
async function sweepOpen(errors, out) {
  let open = [];
  try { open = await sbGet("lfg_lobbies?status=eq.open&select=id,channel_id,message_id,state,updated_at,created_at"); }
  catch (e) { errors.push(`lfg open load: ${String(e.message || e)}`); return; }

  for (const lo of open || []) {
    const now = Date.now();
    const st = lo.state || {};
    const signups = Array.isArray(st.signups) ? st.signups : [];

    if (!signups.length) {
      const born = Date.parse(lo.created_at || lo.updated_at) || now;
      if (now - born > EMPTY_GRACE_MS) {
        try { if (await retire(lo, "No one joined.", errors)) out.retired++; }
        catch (e) { errors.push(`lfg retire: ${String(e.message || e)}`); }
      }
      continue;
    }

    // Classify WITHOUT mutating. `warned` is the record that a ping actually landed, so nothing may
    // be stamped onto a signup until Discord has confirmed the message — see the post below.
    const keep = [], dropped = [], atRisk = [];
    for (const p of signups) {
      // `at` is stamped by applyJoin; a signup made before this shipped falls back to the row's clock.
      const since = Date.parse(p.at || lo.updated_at) || now;
      const left = HOLD_MS - (now - since);
      if (left <= 0) {
        // Being warned first is an absolute guarantee, not a best effort. Normally the 4-minute band
        // is wider than the 2-minute tick so a tick always lands inside it — but two consecutive
        // missed ticks (a Netlify hiccup, a long cold start), or a spell where the ping could not be
        // delivered, could otherwise carry a player straight past the band to zero. Anyone who
        // reaches zero un-warned is held and warned now, never dropped.
        if (!p.warned) { atRisk.push({ p, mins: Math.round(WARN_MS / 60000), rescue: true }); keep.push(p); continue; }
        dropped.push(p); continue;
      }
      if (left <= WARN_MS && !p.warned) atRisk.push({ p, mins: Math.max(1, Math.round(left / 60000)), rescue: false });
      keep.push(p);
    }

    // Post first, and only mark players warned once Discord has confirmed it. Setting the flag before
    // the send would let one failed post (a 403 in the channel, exhausted 429/5xx retries, or a 404
    // that returns null without throwing) silently consume somebody's only warning — and the next
    // tick, seeing the flag, would drop them having told them nothing. That is the precise failure
    // the guarantee above exists to prevent, so the flag has to mean "delivered", not "attempted".
    const warned = [];
    if (atRisk.length) {
      const ids = atRisk.map((w) => w.p.id);
      const lines = atRisk.map((w) => `<@${w.p.id}> — **${w.mins} min** left at ${POS_LABEL[w.p.pos] || w.p.pos}`);
      try {
        const posted = await dApi("POST", `/channels/${lo.channel_id}/messages`, {
          content: lines.join("\n"),
          embeds: [{ title: "⏳ Your spot is about to lapse",
            description: "Run **/join** again to renew your 30 minutes and stay on the board. Do nothing and you'll be taken off so the queue stays honest about who's actually around.",
            color: BRAND }],
          allowed_mentions: { users: ids.slice(0, 100) },
        });
        if (posted && posted.id) {
          for (const w of atRisk) {
            w.p.warned = true;
            // the rescue only hands back its window once the player has actually been told
            if (w.rescue) w.p.at = new Date(now - (HOLD_MS - WARN_MS)).toISOString();
            warned.push(w);
          }
          out.warned += warned.length;
        } else {
          // dApi maps 404 to null: the channel is gone, so nobody was told. Leave the flags unset —
          // they stay held and we retry next tick rather than dropping them on an undelivered ping.
          errors.push(`lfg warn post: no message id returned for channel ${lo.channel_id} (deleted?)`);
        }
      } catch (e) { errors.push(`lfg warn post: ${String(e.message || e)}`); }
    }
    // Nothing actually changed (a quiet tick, or a warning that could not be delivered) — leave the
    // row alone so the un-warned players are picked up again next tick.
    if (!dropped.length && !warned.length) { await keepSummaryLast(lo, st, errors, out); continue; }

    if (!keep.length) {
      try { if (await retire(lo, "Everyone's 30 minutes lapsed.", errors)) out.retired++; }
      catch (e) { errors.push(`lfg retire: ${String(e.message || e)}`); }
      continue;
    }

    const next = { ...st, signups: keep };
    let won = false;
    try { won = await casState(lo.id, lo.updated_at, { state: next }); }
    catch (e) { errors.push(`lfg save: ${String(e.message || e)}`); continue; }
    // Someone clicked between our read and our write. Their version is authoritative; the next tick
    // re-reads and re-decides. Worst case a player who was warned gets warned once more.
    if (!won) { out.raced++; continue; }

    if (dropped.length) {
      out.dropped += dropped.length;
      try {
        await dApi("POST", `/channels/${lo.channel_id}/messages`, {
          embeds: [{ title: "⌛ Taken off the board",
            description: `${dropped.map((p) => `<@${p.id}>`).join(", ")} — your 30 minutes ran out. Run **/join** to get back on.`,
            color: BRAND }],
          allowed_mentions: { parse: [] },
        });
      } catch (e) { errors.push(`lfg drop post: ${String(e.message || e)}`); }
    }
    await keepSummaryLast(lo, next, errors, out, true);
  }
}

// Keep the roster summary as the channel's last message. `force` reposts even if it already is,
// which is what a roster change needs so the embed shows the new board.
async function keepSummaryLast(lo, st, errors, out, force) {
  if (!lo.message_id || !BOT) return;
  if (!force) {
    let last;
    try { const arr = await dApi("GET", `/channels/${lo.channel_id}/messages?limit=1`); last = arr && arr[0]; }
    catch (e) { return; }
    if (!last || last.id === lo.message_id) return;
  }
  let posted;
  try { posted = await dApi("POST", `/channels/${lo.channel_id}/messages`, { embeds: [summaryEmbed(st)], allowed_mentions: { parse: [] } }); }
  catch (e) { errors.push(`lfg repost: ${String(e.message || e)}`); return; }
  if (!posted || !posted.id) return;
  try { await patchLobby(lo.id, { message_id: posted.id }); } catch (e) { errors.push(`lfg msgid: ${String(e.message || e)}`); }
  try { await dApi("DELETE", `/channels/${lo.channel_id}/messages/${lo.message_id}`); } catch (e) {}
  out.refreshed++;
}

/* ---------- (4) full lobbies nobody captained ---------- */
async function sweepCaptains(errors, out) {
  let awaiting = [];
  try { awaiting = await sbGet("lfg_lobbies?status=eq.captains&thread_id=not.is.null&select=id,thread_id,state,updated_at"); }
  catch (e) { errors.push(`lfg captains load: ${String(e.message || e)}`); return; }
  for (const lo of awaiting || []) {
    const st = lo.state || {};
    const filledAt = st.filledAt ? Date.parse(st.filledAt) : Date.parse(lo.updated_at);
    if (Date.now() - filledAt < CAPTAIN_MS) continue;
    const ids = (st.signups || []).map((x) => x.id);
    const have = st.captains || [];
    const capA = have[0] || ids[0];
    const capB = have[1] || ids.find((id) => id !== capA);
    if (!capA || !capB) continue;
    st.captains = [capA, capB];
    st.teams = { A: [capA], B: [capB] };
    /* KEEP IN SYNC with startDraft in discord-interactions.js: the other player at a captain's
       position can only legally land on the opposite team (one of each position per side), so
       they are placed there up front. Same-position captains are each other's twins — no-op. */
    const posOf = {}; (st.signups || []).forEach((x) => { posOf[x.id] = x.pos; });
    if (posOf[capA] !== posOf[capB]) {
      const twinA = (st.signups || []).find((x) => x.pos === posOf[capA] && x.id !== capA);
      const twinB = (st.signups || []).find((x) => x.pos === posOf[capB] && x.id !== capB);
      if (twinA) st.teams.B.push(twinA.id);
      if (twinB) st.teams.A.push(twinB.id);
    }
    st.order = ["A", "B", "B", "A", "A", "B", "B", "A", "A", "B"];
    st.pickIndex = 0; st.turn = "A";
    let claimed = false;
    try { claimed = await casState(lo.id, lo.updated_at, { state: st, status: "drafting" }); }
    catch (e) { errors.push(`lfg autocap save: ${String(e.message || e)}`); continue; }
    if (!claimed) { out.raced++; continue; }   // a real /captain landed first — let it run the draft
    try {
      const dv = draftView({ id: lo.id, state: st });
      await dApi("POST", `/channels/${lo.thread_id}/messages`, {
        content: `🧢 No one claimed **/captain**, so the first two signups are your captains: <@${capA}> (Team A) & <@${capB}> (Team B). Draft time!`,
        embeds: dv.embeds, components: dv.components });
    } catch (e) { errors.push(`lfg autocap post: ${String(e.message || e)}`); }
    out.autoCaptained++;
  }
}

export default async () => {
  // Without Supabase there is nowhere to record anything, so this is the one unavoidable silent exit.
  if (!SB_URL || !SB_KEY) return json({ skipped: "missing supabase env" });
  const errors = [];
  const out = { warned: 0, dropped: 0, retired: 0, refreshed: 0, autoCaptained: 0, raced: 0 };
  // A missing bot token is recorded as a FAILING run, never as a quiet skip. Returning early here
  // would leave no heartbeat and no result at all, so a clock that never ran would look identical to
  // one that ran with nothing to do — dead and invisible rather than dead and loud.
  if (!BOT) errors.push("DISCORD_BOT_TOKEN is not set — the pickup clock cannot warn or drop anyone");
  else try {
    await sweepOpen(errors, out);
    await sweepCaptains(errors, out);
  } catch (e) { errors.push(String(e.message || e)); }
  if (errors.length) console.error("lfg-timers:", JSON.stringify(errors));
  // Heartbeat + result for the Automations page and the database watchdog.
  const stamp = new Date().toISOString();
  try {
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([
        { key: "rl_lfg-timers", value: stamp, updated_at: stamp },
        { key: "rl_lfg-timers_result", value: JSON.stringify({ at: stamp, ok: errors.length === 0, ...out,
            errCount: errors.length, lastError: errors[0] ? String(errors[0]).slice(0, 200) : null }), updated_at: stamp },
      ]) });
  } catch {}
  return json({ ok: errors.length === 0, ...out, errors });
};
