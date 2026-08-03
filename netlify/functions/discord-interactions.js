// Discord interactions endpoint for the all-in-Discord #pickup-games pickup system.
// Flow: each player runs /join and picks a position from a private (ephemeral) picker that shows the
// open spots. A public roster SUMMARY in #pickup-games updates as people join and gets bumped to the
// bottom (lfg-timers keeps it there and runs each signup's own 30-minute clock). On the 12th signup a dedicated
// CHANNEL is spun up (under "Pickup Lobbies") with a full how-to briefing; two players run /captain to
// volunteer (first two become the captains — lfg-timers auto-assigns the first two signups if
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
// the lobby whose room channel is `channelId`, in ANY post-fill state — /kick works from the moment
// the room exists to the moment the game is reported, including "done" (a no-show is usually
// discovered at puck drop, well after the code went out)
const KICKABLE_STATES = "captains,drafting,server,done";
async function sbGetRoomLobbyAny(channelId) {
  const r = await fetch(`${SB_URL}/rest/v1/lfg_lobbies?thread_id=eq.${encodeURIComponent(channelId)}&status=in.(${KICKABLE_STATES})&select=*&limit=1`, withTimeout({ headers: sbHead() }));
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
// Stash the room channel id on the lobby. NOT best-effort: /captain, the auto-captain sweep and the
// room cleanup all look the lobby up by thread_id, so a lost write here has no fallback path.
// Verified + retried rather than fire-and-forget: a PATCH that 200s with zero rows is a silent loss,
// and this is the one write in the whole flow that has no second chance.
async function sbStashThread(id, threadId) {
  let last = "no attempt";
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/lfg_lobbies?id=eq.${id}`, { method: "PATCH",
        headers: { ...sbHead(), Prefer: "return=representation" },
        body: JSON.stringify({ thread_id: threadId }), signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        const rows = await r.json().catch(() => []);
        if (Array.isArray(rows) && rows.length) return true;
        last = "patch matched 0 rows";
      } else last = `${r.status} ${(await r.text()).slice(0, 80)}`;
    } catch (e) { last = String(e.message || e); }
  }
  throw new Error(`thread_id stash failed: ${last}`);
}
// best-effort: remember the public summary's message id so lfg-timers can bump/expire it.
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
  const ids = (lobby.state.signups || []).map((p) => p.id);
  /* Private to the twelve players in this lobby, granted in the SAME create call that denies
     @everyone so the room is never even briefly public. The bot itself operates on admin.
     /kick keeps these overwrites in step when the roster changes. */
  const ALLOW = "68608";   // VIEW + SEND + READ_HISTORY
  const body = { name: `pickup-${shortId}`, type: 0,
    topic: "Pickup lobby — run /captain to set captains, draft, play, report by club search.",
    permission_overwrites: [{ id: guildId, type: 0, deny: "1024", allow: "0" }]
      .concat(ids.map((id) => ({ id, type: 1, allow: ALLOW, deny: "0" }))) };
  if (categoryId) body.parent_id = categoryId;
  const ch = await dApi("POST", `/guilds/${guildId}/channels`, body);
  const pings = ids.map((id) => `<@${id}>`).join(" ");
  await dApi("POST", `/channels/${ch.id}/messages`, {
    content: `${pings}\n**Lobby's full — let's set it up! 🏒**`,
    embeds: [instructionsEmbed()],
    allowed_mentions: { users: ids.slice(0, 100) },
  });
  return ch.id;
}
function instructionsEmbed() {
  return {
    title: "🏒 Pickup lobby — how to run it",
    description:
      "**1 · Captains** — two of you run **/captain** to volunteer. The first volunteer captains **Home**, the second **Away**. " +
      "(Nobody claims it within ~5 min? The first two who signed up are set automatically.)\n\n" +
      "**2 · Mini draft** — the other player at each captain's position starts on the opposite team automatically. Captains then take turns picking (snake order), one of each position per team — the dropdown only shows who's legal.\n\n" +
      "**3 · Server & code** — the **Home** captain picks the server, then the bot drops a **private 6-digit lobby code**.\n\n" +
      "**4 · Play** — set a private match with that code on the chosen server.\n\n" +
      `**5 · Stats** — after the game, statistics staff enter the box score by **club search** at ${CLUB_SEARCH}.\n\n` +
      "**6 · Done** — entering the box score clears this channel on its own a couple of minutes later. Want it gone sooner? When a **majority of the lobby runs /delete**, it closes — and any quiet room clears within 12 hours regardless. Someone no-show or out of line? A captain can start a vote with **/kick** — the other captain approves, and the spot refills from #pickup-games.",
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
function pickerView(channelId, s, userId, renewedPos) {
  const mine = (s.signups || []).find((x) => x.id === userId);
  return {
    embeds: [{
      title: renewedPos ? "\uD83D\uDD04 Spot renewed" : "\uD83C\uDFD2 Pick your position",
      description: (renewedPos
          ? `Thirty fresh minutes at **${POS_LABEL[renewedPos] || renewedPos}** — you're safe. Tap a different position to move there, or just dismiss this.`
          : mine ? `You're in at **${POS_LABEL[mine.pos]}**. Tap a different position to move there, or **Leave** to drop.`
                 : "Tap your position to jump in.") +
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
  /* the dropdown only offers LEGAL picks — a position the team already holds isn't a choice */
  const posOf = {}; (s.signups || []).forEach((x) => { posOf[x.id] = x.pos; });
  const filled = ((s.teams && s.teams[s.turn]) || []).map((id) => posOf[id]);
  const options = pool.filter((x) => !filled.includes(x.pos)).slice(0, 25).map((x) => ({ label: `${x.name}`.slice(0, 100), description: POS_LABEL[x.pos], value: x.id }));
  return {
    embeds: [{
      title: "🧢 Captains' draft",
      description: `${capName} is on the clock — pick a player.\n\n**Home** (<@${s.captains[0]}>): ${teamNames(s, "A")}\n**Away** (<@${s.captains[1]}>): ${teamNames(s, "B")}`,
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
      description: `Teams are set. <@${s.captains[0]}> (Home), choose the server.\n\n**Home**: ${teamNames(s, "A")}\n**Away**: ${teamNames(s, "B")}`,
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
      description: `**Home** (<@${s.captains[0]}>): ${teamNames(s, "A")}\n**Away** (<@${s.captains[1]}>): ${teamNames(s, "B")}\n\n**Server:** ${s.server}\n**Private lobby code:** \`${s.code}\`\n\n📊 After the game, staff enter the box score by **club search** at ${CLUB_SEARCH} (players can also self-import at chelgamingleague.com/#/pickup-import).`,
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
  const now = new Date().toISOString();
  // Every signup carries its own clock: lfg-timers holds the spot for 30 minutes from `at`, warns
  // once when it's nearly up, then takes the player off the board. Running /join again is the
  // renewal that warning asks for, so an existing member is refreshed here rather than rejected —
  // and moved, if they named a different position and it has room.
  const mine = (s.signups || []).find((x) => x.id === userId);
  if (mine) {
    // Renew unconditionally, even when the position they asked for is taken — someone racing their
    // own clock must never lose their spot just because their preferred slot filled up meanwhile.
    const blocked = mine.pos !== pos && posCount(s, pos) >= PER_POS ? POS_LABEL[pos] : null;
    const moved = mine.pos !== pos && !blocked;
    if (moved) mine.pos = pos;
    mine.at = now; delete mine.warned;
    return { status: "open", state: s, renewed: true, moved, blocked };
  }
  if (posCount(s, pos) >= PER_POS) return { error: `${POS_LABEL[pos]} is full — pick another spot.` };
  s.signups = (s.signups || []).concat([{ id: userId, name, pos, at: now }]);
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
// Set up the snake draft once both captains are known (from /captain or lfg-timers' fallback).
function startDraft(s, capA, capB) {
  s.captains = [capA, capB];
  s.teams = { A: [capA], B: [capB] };
  /* Each team ends with ONE of every position and a captain fills their own slot — so the other
     player at a captain's position can only legally land on the opposite team. Place them there up
     front rather than letting a doomed pick happen. (Two same-position captains ARE each other's
     twins, so there is nothing to place.) The draft then runs 8 picks instead of 10; the existing
     pool-empty check ends it, and the snake's first eight turns split 4/4. KEEP IN SYNC with the
     auto-captain path in lfg-timers.js. */
  const posOf = {}; (s.signups || []).forEach((x) => { posOf[x.id] = x.pos; });
  if (posOf[capA] !== posOf[capB]) {
    const twinA = (s.signups || []).find((x) => x.pos === posOf[capA] && x.id !== capA);
    const twinB = (s.signups || []).find((x) => x.pos === posOf[capB] && x.id !== capB);
    if (twinA) s.teams.B.push(twinA.id);
    if (twinB) s.teams.A.push(twinB.id);
  }
  s.order = draftOrder();
  s.pickIndex = 0;
  s.turn = s.order[0];
  return s;
}
// /captain: volunteer. First volunteer -> Home (team key A), second -> Away (key B) — the keys
// stay A/B in state and custom_ids; Home/Away is the display language.
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
/* ---------- /kick: captain vote-kick with position-matched replacement ----------
   A kick is a two-key launch: one captain proposes, the OTHER captain approves. The kicked spot
   refills from the public #pickup-games signup sheet with someone at the same position, who
   inherits the kicked player's team slot if the draft had already placed them. */
function applyKickPropose(lobby, byId, targetId) {
  const s = lobby.state;
  const caps = s.captains || [];
  if (caps.length < 2) return { error: "Captains aren't set yet — run **/captain** first; kicks are a captains' vote." };
  if (!caps.includes(byId)) return { error: "Only a captain can start a kick vote." };
  if (caps.includes(targetId)) return { error: "Captains can't be vote-kicked — flag a staff member instead." };
  if (byId === targetId) return { error: "You can't kick yourself." };
  const entry = (s.signups || []).find((x) => x.id === targetId);
  if (!entry) return { error: "They're not in this lobby." };
  s.kickVote = { target: targetId, by: byId, at: new Date().toISOString() };
  return { state: s, targetName: entry.name, otherCaptain: caps.find((c) => c !== byId) };
}
function applyKickDecline(lobby, presserId) {
  const s = lobby.state;
  if (!s.kickVote) return { error: "There's no kick vote open." };
  if (!(s.captains || []).includes(presserId)) return { error: "Only a captain can rule on a kick vote." };
  const kv = s.kickVote;
  delete s.kickVote;
  return { state: s, target: kv.target };
}
/* openSignups: the CURRENT public signup sheet (may be null/empty). Mutates only the ROOM state;
   the caller removes the chosen replacement from the open lobby afterwards under its own CAS. */
function applyKickApprove(lobby, presserId, openSignups) {
  const s = lobby.state;
  const kv = s.kickVote;
  if (!kv) return { error: "There's no kick vote open." };
  const caps = s.captains || [];
  if (!caps.includes(presserId)) return { error: "Only a captain can approve a kick." };
  if (presserId === kv.by) return { error: "Your vote is already counted — the **other** captain has to approve." };
  const entry = (s.signups || []).find((x) => x.id === kv.target);
  delete s.kickVote;
  if (!entry) return { error: "They already left the lobby — vote closed.", state: s };
  s.signups = s.signups.filter((x) => x.id !== kv.target);
  s.kicked = (s.kicked || []).concat([kv.target]);
  /* same position, not previously kicked from this lobby, not already in this lobby */
  const inRoom = {}; s.signups.forEach((x) => { inRoom[x.id] = 1; });
  const sub = (openSignups || []).find((x) => x.pos === entry.pos && !inRoom[x.id] && (s.kicked || []).indexOf(x.id) < 0);
  let side = null;
  ["A", "B"].forEach(function(k){
    const i = ((s.teams && s.teams[k]) || []).indexOf(kv.target);
    if (i >= 0){ side = k; if (sub) s.teams[k][i] = sub.id; else s.teams[k].splice(i, 1); }
  });
  if (sub) s.signups = s.signups.concat([{ id: sub.id, name: sub.name, pos: sub.pos, at: new Date().toISOString() }]);
  return { state: s, target: kv.target, targetName: entry.name, pos: entry.pos, replacement: sub || null, side: side };
}
/* ---------- /delete: majority vote to close the lobby ----------
   The only manual way a lobby room goes away: each member runs /delete, and when a MAJORITY of the
   current roster has voted, the lobby closes (the sync sweep then removes the channel). Votes are
   idempotent and there is no withdraw — walking a vote back on a room half the lobby wants gone
   buys nothing but confusion. */
function applyDeleteVote(lobby, userId) {
  const s = lobby.state;
  const roster = (s.signups || []).map((x) => x.id);
  if (!roster.includes(userId)) return { error: "Only players in this lobby can vote to close it." };
  s.deleteVotes = (s.deleteVotes || []).filter((id) => roster.includes(id));   // a kicked voter's vote dies with them
  const already = s.deleteVotes.includes(userId);
  if (!already) s.deleteVotes.push(userId);
  const needed = Math.floor(roster.length / 2) + 1;
  return { state: s, votes: s.deleteVotes.length, needed, already, closed: s.deleteVotes.length >= needed };
}
function applyPick(lobby, userId, pickId) {
  const s = lobby.state;
  if (userId !== currentCaptain(s)) return { error: "Only the captain on the clock can pick right now." };
  if (!remainingPool(s).some((x) => x.id === pickId)) return { error: "That player is no longer on the board." };
  /* one of each position per team — the captain already fills their own slot, so their position is
     blocked from the start and every other position caps at one */
  const posOf = {}; (s.signups || []).forEach((x) => { posOf[x.id] = x.pos; });
  const filled = (s.teams[s.turn] || []).map((id) => posOf[id]);
  if (filled.includes(posOf[pickId])) return { error: `${s.turn === "A" ? "Home" : "Away"} already has a ${POS_LABEL[posOf[pickId]] || posOf[pickId]} — pick a different position.` };
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
  if (userId !== s.captains[0]) return { error: "Only the Home captain picks the server." };
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

  // Kick-vote buttons. Handled ahead of the generic loop: its closed-lobby guard treats "done" as
  // closed, and a done lobby (code issued, game about to start) is exactly when a no-show surfaces.
  if (action === "kickok" || action === "kickno") {
    for (let attempt = 0; attempt < 4; attempt++) {
      const lobby = await sbGetLobby(key);
      if (!lobby || KICKABLE_STATES.indexOf(lobby.status) < 0) return ephemeral("This lobby has closed — the vote is moot.");
      if (action === "kickno") {
        const out = applyKickDecline(lobby, userId);
        if (out.error) return ephemeral(out.error);
        const saved = await sbSaveLobby(lobby.id, lobby.updated_at, out.state, lobby.status);
        if (!saved) continue;
        return respond({ type: UPDATE, data: { content: `Kick vote declined by <@${userId}>.`, embeds: [], components: [], allowed_mentions: { parse: [] } } });
      }
      /* approve: the replacement pool is the CURRENT public signup sheet in #pickup-games */
      let openLobby = null;
      try { openLobby = await sbGetOpenLobby(lobby.channel_id); } catch (e) {}
      const out = applyKickApprove(lobby, userId, (openLobby && openLobby.state && openLobby.state.signups) || []);
      if (out.error && !out.state) return ephemeral(out.error);
      const saved = await sbSaveLobby(lobby.id, lobby.updated_at, out.state, lobby.status);
      if (!saved) continue;
      if (out.error) return respond({ type: UPDATE, data: { content: out.error, embeds: [], components: [], allowed_mentions: { parse: [] } } });
      /* Take the replacement OFF the public sheet. Room-first ordering on purpose: if this write
         loses, the player is briefly on both lists and their public-sheet 30-minute clock
         self-heals it — the reverse order could lose their signup entirely. */
      if (out.replacement && openLobby) {
        for (let a2 = 0; a2 < 4; a2++) {
          const ol = await sbGetLobby(openLobby.id);
          if (!ol || ol.status !== "open") break;
          const st = ol.state || {};
          if (!((st.signups || []).some((x) => x.id === out.replacement.id))) break;
          st.signups = st.signups.filter((x) => x.id !== out.replacement.id);
          if (await sbSaveLobby(ol.id, ol.updated_at, st, ol.status)) {
            if (BOT) { try { const mid = await ensureSummary(ol.channel_id, st, ol.message_id); if (mid && mid !== ol.message_id) await sbStashMessage(ol.id, mid); } catch (e) {} }
            break;
          }
        }
      }
      /* the room is member-private, so access must follow the roster: the kicked player loses the
         channel, the replacement gains it. Best-effort — a miss leaves a readable-but-consistent
         room and the errors surface in the Netlify log. */
      if (lobby.thread_id && BOT) {
        try { await dApi("DELETE", `/channels/${lobby.thread_id}/permissions/${out.target}`); } catch (e) {}
        if (out.replacement) {
          try { await dApi("PUT", `/channels/${lobby.thread_id}/permissions/${out.replacement.id}`, { type: 1, allow: "68608", deny: "0" }); } catch (e) {}
        }
      }
      const posName = POS_LABEL[out.pos] || out.pos || "player";
      const line = out.replacement
        ? `\u2705 **${out.targetName}** was kicked. <@${out.replacement.id}> steps in at **${posName}**${out.side ? (out.side === "A" ? " for Home" : " for Away") : ""} — welcome!`
        : `\u2705 **${out.targetName}** was kicked. Nobody is waiting at **${posName}** on the #pickup-games sheet right now, so the lobby plays one short — anyone who signs up there can be pulled in by staff.`;
      return respond({ type: UPDATE, data: { content: line, embeds: [], components: [],
        allowed_mentions: out.replacement ? { users: [out.replacement.id] } : { parse: [] } } });
    }
    return ephemeral("The lobby was busy — try that again.");
  }
  // Delete-lobby button — NO LONGER RENDERED anywhere (removed 2026-08-03 so a delete control
  // never sits in front of players; cleanup is the stats-import auto-close plus the 12-hour
  // sweep). The handler stays because messages posted before the removal still carry the button,
  // and a click on one of those must degrade gracefully, not error. Staff-only, as it always was. Marks it closed; discord-sync removes the
  // channel on its next sweep (avoids responding to an interaction whose channel you just deleted).
  if (action === "closelobby") {
    /* the delete button is retired — messages posted before the removal still carry it, and a
       click must degrade into directions, not an error */
    return ephemeral("The delete button is retired \u2014 a lobby closes when a **majority of its players run /delete**, when its box score is entered, or on its own after 12 quiet hours.");
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
          await sbStashThread(lobby.id, roomId);   // await: the fn freezes on response, and /captain,
          // the auto-captain sweep and the room cleanup ALL find the lobby by thread_id — losing this
          // write strands a filled lobby permanently and orphans its channel.
          if (lobby.message_id) { try { await dApi("PATCH", `/channels/${lobby.channel_id}/messages/${lobby.message_id}`, { embeds: [fullSummaryEmbed(roomId)] }, 1400); } catch (e) {} }
          return respond({ type: UPDATE, data: { embeds: [{ title: "🔒 Lobby full!", description: `You're in — head to <#${roomId}> to set captains and draft.`, color: BRAND }], components: [] } });
        } catch (e) {
          // Loud in the Netlify log: if this was the thread_id stash, the room exists but no sweep
          // can see it, and staff need to know rather than wonder why /captain says "no lobby here".
          console.error("lfg: lobby", lobby.id, "filled but room setup failed:", String(e.message || e));
          return respond({ type: UPDATE, data: { embeds: [{ title: "🔒 Lobby full — 12/12", description: "You're in! Captains, set up the draft in the lobby channel.", color: BRAND }], components: [] } });
        }
      }
      let newMsgId = lobby.message_id;
      if (BOT) { try { newMsgId = await ensureSummary(lobby.channel_id, out.state, lobby.message_id); } catch (e) {} }
      if (newMsgId && newMsgId !== lobby.message_id) await sbStashMessage(lobby.id, newMsgId);  // await: the fn freezes on response, so a fire-and-forget PATCH never lands
      const held = `Your spot is held for **30 minutes** — you'll get a ping in <#${lobby.channel_id}> before it lapses, and running **/join** again renews it.`;
      const confirm = action === "join"
        ? { title: out.renewed ? "🔄 Spot renewed" : "✅ You're in",
            description: (out.blocked ? `${out.blocked} is full, so you're still at **${POS_LABEL[(out.state.signups.find((x) => x.id === userId) || {}).pos] || POS_LABEL[arg]}**. `
                        : out.moved ? `Moved to **${POS_LABEL[arg]}**. `
                        : `${out.renewed ? "Renewed at" : "Signed up at"} **${POS_LABEL[arg]}**. `) + held, color: BRAND }
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
  if (cmd === "kick") return handleKick(interaction);
  if (cmd === "delete") return handleDelete(interaction);
  return ephemeral("Unknown command.");
}
// /join -> a private position picker showing what's open. For someone already on the sheet, the
// slash command ITSELF is the renewal: the lapse warning says "run /join again to renew", so the
// renewal cannot hide behind a second click on the position button — a player racing a two-minute
// clock through Discord's command UI would lose their spot to a technicality.
async function handleJoin(interaction) {
  const channelId = interaction.channel_id;
  const userId = userIdOf(interaction);
  let state = { signups: [] };
  let renewed = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    let lobby = null;
    try { lobby = await sbGetOpenLobby(channelId); } catch (e) {}
    if (!lobby || !lobby.state) break;
    state = lobby.state;
    const mine = (state.signups || []).find((x) => x.id === userId);
    if (!mine) break;                       // not on the sheet — just show the picker
    mine.at = new Date().toISOString();     // fresh 30 minutes
    delete mine.warned;                     // eligible to be warned again next time
    state.lastSignupAt = new Date().toISOString();
    const saved = await sbSaveLobby(lobby.id, lobby.updated_at, state, lobby.status);
    if (saved) { renewed = mine.pos; break; }
    // CAS lost — a click landed at the same moment; re-read and retry
  }
  return respond({ type: REPLY, data: { ...pickerView(channelId, state, userId, renewed), flags: EPHEMERAL } });
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
// /kick @player (in a lobby's room channel) -> a captain proposes; the OTHER captain approves via
// buttons. On approval the player is removed and the spot refills from the public signup sheet with
// someone at the same position, who inherits the team slot if the draft had placed the kicked player.
async function handleKick(interaction) {
  const channelId = interaction.channel_id;
  const userId = userIdOf(interaction);
  const opt = ((interaction.data && interaction.data.options) || []).find((o) => o.name === "player");
  const targetId = opt ? String(opt.value || "") : "";
  if (!targetId) return ephemeral("Pick the player to kick: **/kick player:@name**");
  for (let attempt = 0; attempt < 4; attempt++) {
    const lobby = await sbGetRoomLobbyAny(channelId);
    if (!lobby) return ephemeral("There's no active pickup lobby in this channel — **/kick** works inside a lobby's own room.");
    const out = applyKickPropose(lobby, userId, targetId);
    if (out.error) return ephemeral(out.error);
    const saved = await sbSaveLobby(lobby.id, lobby.updated_at, out.state, lobby.status);
    if (!saved) continue;   // CAS lost — re-read and retry
    return respond({ type: REPLY, data: {
      content: `\u2696\uFE0F <@${userId}> proposes kicking <@${targetId}> — <@${out.otherCaptain}>, your call.`,
      embeds: [{ title: "Kick vote", color: BRAND,
        description: `**${out.targetName}** would be removed and their **${POS_LABEL[(out.state.signups.find((x)=>x.id===targetId)||{}).pos] || "spot"}** refilled from the #pickup-games signup sheet if anyone's waiting at that position.\n\nOnly the other captain's vote counts.` }],
      components: [{ type: 1, components: [
        { type: 2, style: 4, label: "Approve kick", custom_id: `lfg:kickok:${lobby.id}:${targetId}` },
        { type: 2, style: 2, label: "Decline", custom_id: `lfg:kickno:${lobby.id}` },
      ] }],
      allowed_mentions: { users: [targetId, out.otherCaptain] },
    } });
  }
  return ephemeral("The lobby was busy — try that again.");
}
// /delete (in a lobby's room) -> vote to close it; a majority of the current roster closes the
// lobby and the sync sweep removes the channel a couple of minutes later.
async function handleDelete(interaction) {
  const channelId = interaction.channel_id;
  const userId = userIdOf(interaction);
  for (let attempt = 0; attempt < 4; attempt++) {
    const lobby = await sbGetRoomLobbyAny(channelId);
    if (!lobby) return ephemeral("There's no active pickup lobby in this channel — **/delete** works inside a lobby's own room.");
    const out = applyDeleteVote(lobby, userId);
    if (out.error) return ephemeral(out.error);
    const saved = await sbSaveLobby(lobby.id, lobby.updated_at, out.state, out.closed ? "closed" : lobby.status);
    if (!saved) continue;   // CAS lost — re-read and retry
    if (out.closed) return respond({ type: REPLY, data: { embeds: [{ title: "\uD83D\uDDD1 Lobby closed by majority vote",
      description: `**${out.votes} of ${out.state.signups.length}** voted to close — this channel clears itself in a couple of minutes. Run **/join** in #pickup-games any time to start the next one.`,
      color: BRAND }], allowed_mentions: { parse: [] } } });
    return respond({ type: REPLY, data: { embeds: [{ title: "\uD83D\uDDF3\uFE0F Vote to close this lobby",
      description: (out.already ? `<@${userId}>'s vote was already counted.` : `<@${userId}> voted to close.`) +
        `\n\n**${out.votes} / ${out.needed}** needed — a majority of the lobby closes it. Run **/delete** to add yours.`,
      color: BRAND }], allowed_mentions: { parse: [] } } });
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
      return respond({ type: REPLY, data: { content: `🧢 Captains set: <@${out.state.captains[0]}> (Home) & <@${out.state.captains[1]}> (Away). Draft time!`, embeds: dv.embeds, components: dv.components } });
    }
    return respond({ type: REPLY, data: { content: `🧢 <@${userId}> is the **Home captain**. One more — someone else run **/captain** to take **Away** and start the draft.` } });
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
  applyKickPropose, applyKickApprove, applyKickDecline, applyDeleteVote, handleJoin, pickerView,
  startDraft, pickerView, summaryView, draftView, serverView, doneView, remainingPool, draftOrder, POS, FULL, SERVERS };
