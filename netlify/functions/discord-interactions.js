// Discord interactions endpoint for the all-in-Discord #pickup-games pickup system.
// Flow: each player runs /join and picks a position from a private (ephemeral) picker that shows the
// open spots. A public roster SUMMARY in #pickup-games updates as people join and gets bumped to the
// bottom (discord-scheduler keeps it there and expires an idle lobby). On the 12th signup a dedicated
// CHANNEL is spun up (under "Pickup Lobbies") with a full how-to briefing; two players run /captain to
// volunteer (first two become the captains — discord-scheduler auto-assigns the first two signups if
// nobody claims it), then the captains' snake draft -> server pick -> a private lobby code.
// State lives in lfg_lobbies: the summary message id in message_id, the room channel id in thread_id.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_BOT_TOKEN. Node 18+ (global fetch). ESM.
// The interaction PUBLIC KEY is not a secret (Discord uses it so anyone can verify its signatures),
// so it is inlined; update it only if the Discord application's key is regenerated.

import crypto from "node:crypto";

const PUBLIC_KEY = "4a2af92fd2cdfa5fdad8d2f1e3fd2eb9e8e17f76dc2c82a154491ebabac3d369";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT = process.env.DISCORD_BOT_TOKEN;   // for the public summary + spinning up the per-lobby channel
const CLUB_SEARCH = "chelgamingleague.com/#/hub/statsmgr";   // staff stats-manager (add game by club search)

const POS = [
  { key: "C",  label: "Center" },
  { key: "LW", label: "Left Wing" },
  { key: "RW", label: "Right Wing" },
  { key: "LD", label: "Left Defense" },
  { key: "RD", label: "Right Defense" },
  { key: "G",  label: "Goaltender" },
];
const POS_LABEL = POS.reduce((m, p) => (m[p.key] = p.label, m), {});
const PER_POS = 2;
const FULL = POS.length * PER_POS;            // 12
const SERVERS = ["NA East", "NA Northeast", "NA Central"];
const BRAND = 0xFFE500;

/* ---------- Discord response envelopes ---------- */
const PONG = { type: 1 };
const UPDATE = 7;              // edit the message the component is attached to
const REPLY = 4;              // new message (channel or ephemeral)
const EPHEMERAL = 64;
// Classic Netlify handler responses: { statusCode, headers, body } (matches ingest-stats / parse-screenshots)
const respond = (obj) => ({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });
const ephemeral = (content) => respond({ type: REPLY, data: { content, flags: EPHEMERAL } });

/* ---------- Ed25519 signature verification (dependency-free) ---------- */
function loadEdKey(pubHex) {
  // wrap the raw 32-byte ed25519 public key in a DER SPKI header so Node can load it
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubHex, "hex")]);
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
}
function verifySignature(rawBody, sig, ts, pubHex) {
  try {
    if (!sig || !ts) return false;
    // rawBody may be a Buffer (from req.arrayBuffer, byte-exact) or a string; concat the timestamp
    // as bytes either way so the signed message matches Discord exactly.
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const msg = Buffer.concat([Buffer.from(String(ts)), body]);
    return crypto.verify(null, msg, loadEdKey(pubHex || PUBLIC_KEY), Buffer.from(sig, "hex"));
  } catch (e) { return false; }
}

/* ---------- Supabase REST (service role) ---------- */
const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
// hard 2.5s cap on every DB call so a slow round-trip surfaces as an error, never a Discord timeout
const withTimeout = (opts) => ({ ...opts, signal: AbortSignal.timeout(2500) });
async function sbRpc(fn, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, withTimeout({ method: "POST", headers: sbHead(), body: JSON.stringify(args) }));
  if (!r.ok) throw new Error(`rpc ${fn}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbGetLobby(id) {
  const r = await fetch(`${SB_URL}/rest/v1/lfg_lobbies?id=eq.${id}&select=*`, withTimeout({ headers: sbHead() }));
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] : null;
}
// the open lobby (signup phase) for a channel, or null — read-only, used by /join to show live counts
async function sbGetOpenLobby(channelId) {
  const r = await fetch(`${SB_URL}/rest/v1/lfg_lobbies?channel_id=eq.${encodeURIComponent(channelId)}&status=eq.open&select=*&order=updated_at.desc&limit=1`, withTimeout({ headers: sbHead() }));
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}
// the lobby whose per-lobby room channel is `channelId` and is still awaiting captains, or null
async function sbGetRoomLobby(channelId, status) {
  const r = await fetch(`${SB_URL}/rest/v1/lfg_lobbies?thread_id=eq.${encodeURIComponent(channelId)}&status=eq.${status}&select=*&limit=1`, withTimeout({ headers: sbHead() }));
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}
// optimistic compare-and-swap on updated_at so two simultaneous clicks can't clobber each other
async function sbSaveLobby(id, prevUpdatedAt, state, status) {
  const r = await fetch(`${SB_URL}/rest/v1/lfg_lobbies?id=eq.${id}&updated_at=eq.${encodeURIComponent(prevUpdatedAt)}`, withTimeout({
    method: "PATCH",
    headers: { ...sbHead(), Prefer: "return=representation" },
    body: JSON.stringify({ state, status, updated_at: new Date().toISOString() }),
  }));
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;   // null => CAS lost, caller retries
}
// best-effort: stash the room channel id on the lobby (draft still works via lobby id if this misses)
async function sbStashThread(id, threadId) {
  await fetch(`${SB_URL}/rest/v1/lfg_lobbies?id=eq.${id}`, { method: "PATCH", headers: sbHead(),
    body: JSON.stringify({ thread_id: threadId }), signal: AbortSignal.timeout(1200) }).catch(() => {});
}
// best-effort: remember the public summary's message id so discord-scheduler can bump/expire it.
async function sbStashMessage(id, messageId) {
  await fetch(`${SB_URL}/rest/v1/lfg_lobbies?id=eq.${id}`, { method: "PATCH", headers: sbHead(),
    body: JSON.stringify({ message_id: messageId }), signal: AbortSignal.timeout(1200) }).catch(() => {});
}
// Sign-up gate: does this Discord user have a Chel Gaming website account (a profile linked to their id)?
async function sbHasAccount(discordId) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/profiles?discord_id=eq.${encodeURIComponent(discordId)}&select=id&limit=1`, withTimeout({ headers: sbHead() }));
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) { return true; }   // fail-open on a transient DB error (the join's own DB call will fail anyway)
}
// app_config lookup (used for the Pickup Lobbies category id that new lobby channels are created under)
async function sbGetConfig(key) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/app_config?key=eq.${encodeURIComponent(key)}&select=value`, withTimeout({ headers: sbHead() }));
    const rows = await r.json().catch(() => []);
    return (Array.isArray(rows) && rows[0] && rows[0].value) || null;
  } catch (e) { return null; }
}
// Delete gate: only statistics staff or a commissioner may remove a lobby channel (they're the ones
// entering the box score). Fail-CLOSED — a transient DB error blocks the delete rather than allowing it.
async function sbIsStatsStaff(discordId) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/profiles?discord_id=eq.${encodeURIComponent(discordId)}&select=role,departments&limit=1`, withTimeout({ headers: sbHead() }));
    const rows = await r.json().catch(() => []);
    const p = Array.isArray(rows) && rows[0];
    if (!p) return false;
    if (p.role === "commissioner") return true;
    return p.role === "staff" && Array.isArray(p.departments) && p.departments.includes("statistics");
  } catch (e) { return false; }
}

/* ---------- Discord REST (bot token) — the public summary + per-lobby channel ---------- */
async function dApi(method, path, body, ms) {
  const r = await fetch(`https://discord.com/api/v10${path}`, {
    method, headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(ms || 1600),
  });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 140)}`);
  const t = await r.text();               // tolerate 204 (DELETE) with an empty body
  return t ? JSON.parse(t) : null;
}
// Keep the public roster summary current + at the bottom of #pickup-games: edit it in place if it's
// still the last message, otherwise repost it at the bottom (deleting the buried one). Returns the
// live message id.
async function ensureSummary(channelId, state, curMsgId) {
  const view = summaryView(state);
  let last = null;
  try { const arr = await dApi("GET", `/channels/${channelId}/messages?limit=1`, undefined, 1400); last = arr && arr[0]; } catch (e) {}
  if (curMsgId && last && last.id === curMsgId) {
    try { await dApi("PATCH", `/channels/${channelId}/messages/${curMsgId}`, { embeds: view.embeds }, 1400); return curMsgId; } catch (e) {}
  }
  let posted;
  try { posted = await dApi("POST", `/channels/${channelId}/messages`, { embeds: view.embeds, allowed_mentions: { parse: [] } }, 1600); }
  catch (e) { return curMsgId; }
  if (curMsgId) { dApi("DELETE", `/channels/${channelId}/messages/${curMsgId}`, undefined, 1400).catch(() => {}); }  // remove the buried one (fire-and-forget)
  return posted && posted.id ? posted.id : curMsgId;
}
// On fill: create the dedicated lobby channel (under the Pickup Lobbies category if configured) and
// post the how-to briefing + Delete button, pinging the 12. Returns the channel id. Throws if the
// channel can't be made (caller still confirms the signup).
async function launchLobbyRoom(lobby, guildId, categoryId) {
  const shortId = String(lobby.id).slice(0, 4).toLowerCase();
  const body = { name: `pickup-${shortId}`, type: 0,
    topic: "Pickup lobby — run /captain to set captains, draft, play, report by club search, then delete." };
  if (categoryId) body.parent_id = categoryId;
  const ch = await dApi("POST", `/guilds/${guildId}/channels`, body);
  const ids = (lobby.state.signups || []).map((p) => p.id);
  const pings = ids.map((id) => `<@${id}>`).join(" ");
  await dApi("POST", `/channels/${ch.id}/messages`, {
    content: `${pings}\n**Lobby's full — let's set it up! 🏒**`,
    embeds: [instructionsEmbed()],
    components: [{ type: 1, components: [{ type: 2, style: 4, label: "🗑 Delete lobby", custom_id: `lfg:closelobby:${lobby.id}` }] }],
    allowed_mentions: { users: ids.slice(0, 100) },
  });
  return ch.id;
}
function instructionsEmbed() {
  return {
    title: "🏒 Pickup lobby — how to run it",
    description:
      "**1 · Captains** — two of you run **/captain** to volunteer. The first two become **Team A** & **Team B**. " +
      "(Nobody claims it within ~8 min? The first two who signed up are set automatically.)\n\n" +
      "**2 · Mini draft** — the captains take turns picking players from a dropdown (snake order) until both teams are full.\n\n" +
      "**3 · Server & code** — Team A's captain picks the server, then the bot drops a **private 6-digit lobby code**.\n\n" +
      "**4 · Play** — set a private match with that code on the chosen server.\n\n" +
      `**5 · Stats** — after the game, statistics staff enter the box score by **club search** at ${CLUB_SEARCH}.\n\n` +
      "**6 · Done** — staff press **🗑 Delete lobby** below to clear this channel (it also auto-clears later).",
    color: BRAND,
  };
}
const fullSummaryEmbed = (roomId) => ({
  title: "🔒 Lobby full — 12/12",
  description: `Head to <#${roomId}> to set captains and draft.\n\nRun **/join** anytime to start the next lobby.`,
  color: BRAND,
});

/* ---------- state helpers ---------- */
const nameOf = (interaction) => {
  const m = interaction.member || {};
  const u = m.user || interaction.user || {};
  return m.nick || u.global_name || u.username || "Player";
};
const userIdOf = (interaction) => (interaction.member && interaction.member.user && interaction.member.user.id) || (interaction.user && interaction.user.id);
const posCount = (s, pos) => (s.signups || []).filter((x) => x.pos === pos).length;
const teamNames = (s, side) => (s.teams[side] || []).map((id) => `<@${id}>`).join(", ") || "—";
const draftOrder = () => ["A", "B", "B", "A", "A", "B", "B", "A", "A", "B"]; // snake for 2 teams x 10 picks
const currentCaptain = (s) => (s.turn === "A" ? s.captains[0] : s.captains[1]);
const remainingPool = (s) => (s.signups || []).filter((x) => x.id !== s.captains[0] && x.id !== s.captains[1] &&
  !s.teams.A.includes(x.id) && !s.teams.B.includes(x.id));

/* ---------- view builders ---------- */
// The private per-player picker (ephemeral): six position buttons showing what's open, plus Leave if
// they're already in. Buttons are keyed by CHANNEL id so the lobby is created lazily on first click.
function pickerView(channelId, s, userId) {
  const mine = (s.signups || []).find((x) => x.id === userId);
  return {
    embeds: [{
      title: "🏒 Pick your position",
      description: (mine ? `You're in at **${POS_LABEL[mine.pos]}**. Press **Leave** to drop, then /join again to switch.` : "Tap your position to jump in.") +
        `\n\n**${(s.signups || []).length}/${FULL}** signed up — the number on each button is how many spots are left.`,
      color: BRAND,
    }],
    components: [
      { type: 1, components: POS.slice(0, 5).map((p) => ({ type: 2, style: 1, label: `${p.label} (${PER_POS - posCount(s, p.key)} left)`, custom_id: `lfg:join:${channelId}:${p.key}`, disabled: posCount(s, p.key) >= PER_POS })) },
      { type: 1, components: [
        { type: 2, style: 1, label: `Goaltender (${PER_POS - posCount(s, "G")} left)`, custom_id: `lfg:join:${channelId}:G`, disabled: posCount(s, "G") >= PER_POS },
        { type: 2, style: 2, label: "Leave", custom_id: `lfg:leave:${channelId}`, disabled: !mine },
      ] },
    ],
  };
}
// The public roster summary (no buttons) that lives in #pickup-games and gets bumped to the bottom.
function summaryView(s) {
  const fields = POS.map((p) => {
    const who = (s.signups || []).filter((x) => x.pos === p.key).map((x) => `<@${x.id}>`).join(", ");
    return { name: `${p.label} (${posCount(s, p.key)}/${PER_POS})`, value: who || "_open_", inline: true };
  });
  return {
    embeds: [{
      title: "🏒 Pickup Lobby — who's in",
      description: `**${(s.signups || []).length}/${FULL}** signed up. Run **/join** to grab an open spot — first ${FULL} (2 per position) locks the lobby and moves to its own channel.`,
      color: BRAND, fields,
    }],
  };
}
function draftView(lobby) {
  const s = lobby.state;
  const pool = remainingPool(s);
  const capName = `<@${currentCaptain(s)}>`;
  const options = pool.slice(0, 25).map((x) => ({ label: `${x.name}`.slice(0, 100), description: POS_LABEL[x.pos], value: x.id }));
  return {
    embeds: [{
      title: "🧢 Captains' draft",
      description: `${capName} is on the clock — pick a player.\n\n**Team A** (<@${s.captains[0]}>): ${teamNames(s, "A")}\n**Team B** (<@${s.captains[1]}>): ${teamNames(s, "B")}`,
      color: BRAND,
      footer: { text: `${pool.length} player${pool.length === 1 ? "" : "s"} left on the board` },
    }],
    components: [{ type: 1, components: [{ type: 3, custom_id: `lfg:pick:${lobby.id}`, placeholder: "Captain — pick a player", options, min_values: 1, max_values: 1 }] }],
  };
}
function serverView(lobby) {
  const s = lobby.state;
  return {
    embeds: [{
      title: "🌐 Pick the server",
      description: `Teams are set. <@${s.captains[0]}>, choose the server.\n\n**Team A**: ${teamNames(s, "A")}\n**Team B**: ${teamNames(s, "B")}`,
      color: BRAND,
    }],
    components: [{ type: 1, components: SERVERS.map((sv, i) => ({ type: 2, style: 1, label: sv, custom_id: `lfg:server:${lobby.id}:${i}` })) }],
  };
}
function doneView(lobby) {
  const s = lobby.state;
  return {
    embeds: [{
      title: "✅ Lobby ready — good luck out there",
      description: `**Team A** (<@${s.captains[0]}>): ${teamNames(s, "A")}\n**Team B** (<@${s.captains[1]}>): ${teamNames(s, "B")}\n\n**Server:** ${s.server}\n**Private lobby code:** \`${s.code}\`\n\n📊 After the game, staff enter the box score by **club search** at ${CLUB_SEARCH} (players can also self-import at chelgamingleague.com/#/pickup-import).`,
      color: BRAND,
      footer: { text: "Set a private match with this code on the chosen server." },
    }],
    components: [],
  };
}

/* ---------- mutations (return { status, state, ... } to render, or { error } ephemeral) ---------- */
function applyJoin(lobby, userId, name, pos) {
  const s = lobby.state;
  if (!POS_LABEL[pos]) return { error: "Unknown position." };
  if ((s.signups || []).some((x) => x.id === userId)) return { error: "You're already in this lobby — press **Leave** first to switch positions." };
  if (posCount(s, pos) >= PER_POS) return { error: `${POS_LABEL[pos]} is full — pick another spot.` };
  s.signups = (s.signups || []).concat([{ id: userId, name, pos }]);
  if (s.signups.length >= FULL) {
    lobby.status = "captains";
    s.filledAt = new Date().toISOString();
    s.captains = [];
    return { status: "captains", state: s, filled: true };
  }
  return { status: "open", state: s };
}
function applyLeave(lobby, userId) {
  const s = lobby.state;
  if (!(s.signups || []).some((x) => x.id === userId)) return { error: "You're not in this lobby." };
  s.signups = s.signups.filter((x) => x.id !== userId);
  return { status: "open", state: s };
}
// Set up the snake draft once both captains are known (from /captain or the scheduler's fallback).
function startDraft(s, capA, capB) {
  s.captains = [capA, capB];
  s.teams = { A: [capA], B: [capB] };
  s.order = draftOrder();
  s.pickIndex = 0;
  s.turn = s.order[0];
  return s;
}
// /captain: volunteer. First volunteer -> Team A, second -> Team B (which starts the draft).
function applyCaptain(lobby, userId) {
  const s = lobby.state;
  if (!(s.signups || []).some((x) => x.id === userId)) return { error: "Only players signed up in this lobby can be captains." };
  s.captains = s.captains || [];
  if (s.captains.includes(userId)) return { error: "You're already a captain." };
  if (s.captains.length >= 2) return { error: "Both captains are already set." };
  s.captains.push(userId);
  if (s.captains.length === 2) {
    startDraft(s, s.captains[0], s.captains[1]);
    lobby.status = "drafting";
    return { status: "drafting", state: s, started: true };
  }
  return { status: "captains", state: s, started: false };
}
function applyPick(lobby, userId, pickId) {
  const s = lobby.state;
  if (userId !== currentCaptain(s)) return { error: "Only the captain on the clock can pick right now." };
  if (!remainingPool(s).some((x) => x.id === pickId)) return { error: "That player is no longer on the board." };
  s.teams[s.turn] = s.teams[s.turn].concat([pickId]);
  s.pickIndex += 1;
  if (s.pickIndex >= s.order.length || remainingPool(s).length === 0) {
    lobby.status = "server";
    return { view: serverView(lobby), status: "server", state: s };
  }
  s.turn = s.order[s.pickIndex];
  return { view: draftView(lobby), status: "drafting", state: s };
}
function applyServer(lobby, userId, idx) {
  const s = lobby.state;
  if (userId !== s.captains[0]) return { error: "Only Team A's captain picks the server." };
  s.server = SERVERS[idx] || SERVERS[0];
  s.code = String(Math.floor(100000 + Math.random() * 900000));
  lobby.status = "done";
  return { view: doneView(lobby), status: "done", state: s };
}

/* ---------- the one sanctioned room ---------- */
// The signup sheet lives in exactly ONE channel. Interactions carry a partial channel object
// with its name, so the gate needs no config and no extra API call. The per-lobby rooms are
// named pickup-<id> and can never equal "pickup-games", so /join and /leave are dead there —
// and everywhere else — by construction. Fails closed: no channel name, no signup.
const PICKUP_CHANNEL = "pickup-games";
const inPickupChannel = (interaction) =>
  String((interaction.channel && interaction.channel.name) || "").toLowerCase() === PICKUP_CHANNEL;

/* ---------- component dispatch with CAS retry ---------- */
const SIGNUP_ACTIONS = { join: 1, leave: 1 };
const CLOSED_STATES = { cancelled: 1, done: 1, expired: 1, closed: 1 };
async function handleComponent(interaction) {
  const parts = (interaction.data.custom_id || "").split(":");   // lfg:<action>:<channelId|lobbyId>:<arg?>
  const action = parts[1], key = parts[2], arg = parts[3];
  const userId = userIdOf(interaction);
  const name = nameOf(interaction);
  const guildId = interaction.guild_id || "";

  // Signup buttons only act in #pickup-games — a picker left open in another channel (or a
  // forwarded message) must not mint a shadow lobby keyed to that channel.
  if (SIGNUP_ACTIONS[action] && !inPickupChannel(interaction)) {
    return ephemeral("Pickup signups live in **#pickup-games** — head there and run **/join**.");
  }
  // Only players with a Chel Gaming website account may sign up. Checked before any lobby is touched.
  if (action === "join" && !(await sbHasAccount(userId))) {
    return ephemeral("You need a Chel Gaming account to join pickup games — sign in at **chelgamingleague.com** first (10 seconds with Discord), then run /join again.");
  }

  // Delete-lobby button (in the lobby channel): staff-only. Marks it closed; discord-sync removes the
  // channel on its next sweep (avoids responding to an interaction whose channel you just deleted).
  if (action === "closelobby") {
    if (!(await sbIsStatsStaff(userId))) {
      return ephemeral("Only statistics staff or a commissioner can delete a lobby — it's tied to entering the box score. If you think this one should be removed, open a ticket on **chelgamingleague.com** and staff will handle it.");
    }
    const lobby = await sbGetLobby(key);
    if (!lobby || lobby.status === "closed") return ephemeral("This lobby is already closed.");
    await fetch(`${SB_URL}/rest/v1/lfg_lobbies?id=eq.${lobby.id}`, { method: "PATCH", headers: sbHead(),
      body: JSON.stringify({ status: "closed", updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(2000) }).catch(() => {});
    return respond({ type: UPDATE, data: { embeds: [{ title: "🗑 Lobby closed",
      description: `Closed by <@${userId}> — this channel will be removed shortly.`, color: BRAND }], components: [] } });
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    // signup buttons carry the CHANNEL id and get-or-create the lobby; draft/server buttons carry the lobby id
    let lobby;
    if (SIGNUP_ACTIONS[action]) {
      lobby = await sbRpc("lfg_open_lobby", { p_guild: guildId, p_channel: key });
      lobby = Array.isArray(lobby) ? lobby[0] : lobby;
    } else {
      lobby = await sbGetLobby(key);
    }
    if (!lobby || CLOSED_STATES[lobby.status]) {
      return ephemeral("This lobby has closed. Run `/join` to start a fresh one.");
    }
    let out;
    if (action === "join") {
      if (lobby.status !== "open") return ephemeral("Signups are closed — the lobby is already full.");
      out = applyJoin(lobby, userId, name, arg);
    } else if (action === "leave") {
      if (lobby.status !== "open") return ephemeral("Signups are closed — the lobby is already full.");
      out = applyLeave(lobby, userId);
    } else if (action === "pick") {
      out = applyPick(lobby, userId, (interaction.data.values || [])[0]);
    } else if (action === "server") {
      out = applyServer(lobby, userId, parseInt(arg, 10));
    } else return ephemeral("Unknown action.");

    if (out.error) return ephemeral(out.error);
    if (action === "join" || action === "leave") out.state.lastSignupAt = new Date().toISOString();

    const saved = await sbSaveLobby(lobby.id, lobby.updated_at, out.state, out.status);
    if (!saved) continue;   // CAS lost — another click landed first; re-read and retry

    // Signup actions: keep the public summary fresh + at the bottom; on the 12th, spin up the room.
    if (action === "join" || action === "leave") {
      if (out.filled && BOT && guildId) {
        try {
          const categoryId = await sbGetConfig("pickup_lobby_category_id");
          const roomId = await launchLobbyRoom({ id: lobby.id, state: out.state }, guildId, categoryId);
          sbStashThread(lobby.id, roomId);
          if (lobby.message_id) { try { await dApi("PATCH", `/channels/${lobby.channel_id}/messages/${lobby.message_id}`, { embeds: [fullSummaryEmbed(roomId)] }, 1400); } catch (e) {} }
          return respond({ type: UPDATE, data: { embeds: [{ title: "🔒 Lobby full!", description: `You're in — head to <#${roomId}> to set captains and draft.`, color: BRAND }], components: [] } });
        } catch (e) {
          return respond({ type: UPDATE, data: { embeds: [{ title: "🔒 Lobby full — 12/12", description: "You're in! Captains, set up the draft in the lobby channel.", color: BRAND }], components: [] } });
        }
      }
      let newMsgId = lobby.message_id;
      if (BOT) { try { newMsgId = await ensureSummary(lobby.channel_id, out.state, lobby.message_id); } catch (e) {} }
      if (newMsgId && newMsgId !== lobby.message_id) await sbStashMessage(lobby.id, newMsgId);  // await: the fn freezes on response, so a fire-and-forget PATCH never lands
      const confirm = action === "join"
        ? { title: "✅ You're in", description: `Signed up at **${POS_LABEL[arg]}**. Watch <#${lobby.channel_id}> for the roster — run /join again to switch or leave.`, color: BRAND }
        : { title: "👋 You left the lobby", description: "Run /join again anytime to jump back in.", color: BRAND };
      return respond({ type: UPDATE, data: { embeds: [confirm], components: [] } });
    }

    // Draft / server actions edit the draft message in the lobby channel.
    return respond({ type: UPDATE, data: out.view });
  }
  return ephemeral("The lobby was busy — try that again.");
}

/* ---------- slash commands ---------- */
async function handleCommand(interaction) {
  const cmd = interaction.data.name || "";
  if (cmd === "join" || cmd === "lfg") {                                 // /lfg kept as a legacy alias
    if (!inPickupChannel(interaction)) return ephemeral("Pickup signups live in **#pickup-games** — run **/join** there.");
    return handleJoin(interaction);
  }
  if (cmd === "leave") {
    if (!inPickupChannel(interaction)) return ephemeral("**/leave** only works in **#pickup-games**, where the signup sheet lives. A full lobby that's moved to its own room can't be left — flag a staff member there instead.");
    return handleLeaveCmd(interaction);
  }
  if (cmd === "captain") return handleCaptain(interaction);
  return ephemeral("Unknown command.");
}
// /join -> a private position picker showing what's open. Reads the lobby (no create) so counts are live.
async function handleJoin(interaction) {
  const channelId = interaction.channel_id;
  const userId = userIdOf(interaction);
  let state = { signups: [] };
  try { const lobby = await sbGetOpenLobby(channelId); if (lobby && lobby.state) state = lobby.state; } catch (e) {}
  return respond({ type: REPLY, data: { ...pickerView(channelId, state, userId), flags: EPHEMERAL } });
}
// /leave -> drop off the open signup sheet without reopening the picker. Same CAS loop as the
// buttons so a simultaneous click can't eat the write; only ever touches an OPEN lobby (a full
// one has moved to its own room and is out of reach by the channel gate anyway).
async function handleLeaveCmd(interaction) {
  const channelId = interaction.channel_id;
  const userId = userIdOf(interaction);
  for (let attempt = 0; attempt < 4; attempt++) {
    let lobby = null;
    try { lobby = await sbGetOpenLobby(channelId); } catch (e) {}
    if (!lobby || lobby.status !== "open") return ephemeral("There's no open signup sheet here right now — nothing to leave.");
    const onSheet = ((lobby.state && lobby.state.signups) || []).some((x) => x.id === userId);
    if (!onSheet) return ephemeral("You're not on the current signup sheet.");
    const out = applyLeave(lobby, userId);
    if (out.error) return ephemeral(out.error);
    out.state.lastSignupAt = new Date().toISOString();
    const saved = await sbSaveLobby(lobby.id, lobby.updated_at, out.state, out.status);
    if (!saved) continue;   // CAS lost — re-read and retry
    let newMsgId = lobby.message_id;
    if (BOT) { try { newMsgId = await ensureSummary(lobby.channel_id, out.state, lobby.message_id); } catch (e) {} }
    if (newMsgId && newMsgId !== lobby.message_id) await sbStashMessage(lobby.id, newMsgId);
    return respond({ type: REPLY, data: { embeds: [{ title: "👋 You left the lobby",
      description: "Your spot is open again. Run **/join** anytime to jump back in.", color: BRAND }], flags: EPHEMERAL } });
  }
  return ephemeral("The lobby was busy — try that again.");
}
// /captain (in a full lobby's channel) -> volunteer as a captain; the second volunteer starts the draft.
async function handleCaptain(interaction) {
  const channelId = interaction.channel_id;
  const userId = userIdOf(interaction);
  for (let attempt = 0; attempt < 4; attempt++) {
    const lobby = await sbGetRoomLobby(channelId, "captains");
    if (!lobby) return ephemeral("There's no lobby waiting on captains here — run **/captain** inside a full lobby's channel.");
    const out = applyCaptain(lobby, userId);
    if (out.error) return ephemeral(out.error);
    const saved = await sbSaveLobby(lobby.id, lobby.updated_at, out.state, out.status);
    if (!saved) continue;   // CAS lost — retry
    if (out.started) {
      const dv = draftView({ id: lobby.id, state: out.state });
      return respond({ type: REPLY, data: { content: `🧢 Captains set: <@${out.state.captains[0]}> (Team A) & <@${out.state.captains[1]}> (Team B). Draft time!`, embeds: dv.embeds, components: dv.components } });
    }
    return respond({ type: REPLY, data: { content: `🧢 <@${userId}> is **Team A captain**. One more — someone else run **/captain** to take **Team B** and start the draft.` } });
  }
  return ephemeral("The lobby was busy — try /captain again.");
}

const DIAG = "lfgdiag9x";

export const handler = async (event) => {
  const q = event.queryStringParameters || {};

  // GET — health check + Ed25519 self-test (confirms the crypto path works in the deployed runtime)
  if (event.httpMethod === "GET") {
    if (q.diag !== DIAG) return { statusCode: 200, body: "ok" };
    let selftest = false, realKeyLoads = false, err = null;
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const rawPub = publicKey.export({ format: "der", type: "spki" }).slice(-32).toString("hex");
      const ts = "1700000000", body = JSON.stringify({ type: 1 });
      const sig = crypto.sign(null, Buffer.from(ts + body), privateKey).toString("hex");
      selftest = verifySignature(body, sig, ts, rawPub);
      loadEdKey(PUBLIC_KEY); realKeyLoads = true;
    } catch (e) { err = String(e.message || e); }
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ selftest, realKeyLoads, pubKeyLen: PUBLIC_KEY.length, node: process.version, err }) };
  }

  const h = event.headers || {};
  const sig = h["x-signature-ed25519"] || h["X-Signature-Ed25519"];
  const ts = h["x-signature-timestamp"] || h["X-Signature-Timestamp"];
  // event.body is the raw request body (base64 only for binary content-types); decode if flagged.
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  if (!verifySignature(raw, sig, ts)) return { statusCode: 401, body: "invalid request signature" };

  let interaction;
  try { interaction = JSON.parse(raw); } catch (e) { return { statusCode: 400, body: "bad json" }; }

  // PING is answered instantly with zero backend work — required for endpoint verification + keep-alive
  if (interaction.type === 1) return respond(PONG);

  try {
    if (interaction.type === 2) return await handleCommand(interaction);
    if (interaction.type === 3) return await handleComponent(interaction);
    return respond(PONG);
  } catch (e) {
    console.error("lfg-interaction error", e && (e.stack || e.message || e));
    // surface the failure to the user instead of letting Discord report a silent "did not respond"
    return ephemeral("The pickup bot hit an error: " + String(e && (e.message || e)).slice(0, 180));
  }
};

// Exposed for local unit tests only; Netlify invokes the named handler export.
export const _internals = { verifySignature, applyJoin, applyLeave, applyCaptain, applyPick, applyServer,
  startDraft, pickerView, summaryView, draftView, serverView, doneView, remainingPool, draftOrder, POS, FULL, SERVERS };
