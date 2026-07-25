// Discord interactions endpoint for the all-in-Discord #lfg pickup system.
// Flow: /lfg -> players join a position (2 per position, 12 total) -> snake draft between the two
// captains -> server veto -> a private lobby code is handed off. Every step edits its own message
// in place (UPDATE_MESSAGE), so no message-id bookkeeping is needed. State lives in lfg_lobbies.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Node 18+ (global fetch). Netlify Functions v2 (ESM).
// The interaction PUBLIC KEY is not a secret (Discord uses it so anyone can verify its signatures),
// so it is inlined; update it only if the Discord application's key is regenerated.

import crypto from "node:crypto";

const PUBLIC_KEY = "4a2af92fd2cdfa5fdad8d2f1e3fd2eb9e8e17f76dc2c82a154491ebabac3d369";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

/* ---------- state helpers ---------- */
const nameOf = (interaction) => {
  const m = interaction.member || {};
  const u = m.user || interaction.user || {};
  return m.nick || u.global_name || u.username || "Player";
};
const posCount = (s, pos) => (s.signups || []).filter((x) => x.pos === pos).length;
const teamNames = (s, side) => (s.teams[side] || []).map((id) => `<@${id}>`).join(", ") || "—";
const draftOrder = () => ["A", "B", "B", "A", "A", "B", "B", "A", "A", "B"]; // snake for 2 teams x 10 picks
const currentCaptain = (s) => (s.turn === "A" ? s.captains[0] : s.captains[1]);
const remainingPool = (s) => (s.signups || []).filter((x) => x.id !== s.captains[0] && x.id !== s.captains[1] &&
  !s.teams.A.includes(x.id) && !s.teams.B.includes(x.id));

/* ---------- view builders ---------- */
function signupView(lobby) {
  const s = lobby.state;
  const fields = POS.map((p) => {
    const who = (s.signups || []).filter((x) => x.pos === p.key).map((x) => `<@${x.id}>`).join(", ");
    return { name: `${p.label} (${posCount(s, p.key)}/${PER_POS})`, value: who || "_open_", inline: true };
  });
  const rows = [
    { type: 1, components: POS.slice(0, 5).map((p) => ({ type: 2, style: 1, label: `${p.key} (${posCount(s, p.key)}/${PER_POS})`, custom_id: `lfg:join:${lobby.id}:${p.key}`, disabled: posCount(s, p.key) >= PER_POS })) },
    { type: 1, components: [
      { type: 2, style: 1, label: `G (${posCount(s, "G")}/${PER_POS})`, custom_id: `lfg:join:${lobby.id}:G`, disabled: posCount(s, "G") >= PER_POS },
      { type: 2, style: 2, label: "Leave", custom_id: `lfg:leave:${lobby.id}` },
      { type: 2, style: 4, label: "Cancel lobby", custom_id: `lfg:cancel:${lobby.id}` },
    ] },
  ];
  return {
    embeds: [{
      title: "🏒 Pickup Lobby — signups open",
      description: `Click your position to join. First **${FULL}** players (**${PER_POS} per position**) locks the lobby and starts the captains' draft.\n\n**${(s.signups || []).length}/${FULL}** in.`,
      color: BRAND, fields,
    }],
    components: rows,
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
      description: `**Team A** (<@${s.captains[0]}>): ${teamNames(s, "A")}\n**Team B** (<@${s.captains[1]}>): ${teamNames(s, "B")}\n\n**Server:** ${s.server}\n**Private lobby code:** \`${s.code}\``,
      color: BRAND,
      footer: { text: "Set a private match with this code on the chosen server." },
    }],
    components: [],
  };
}

/* ---------- mutations (return {view,status,state} to render, or {error} ephemeral) ---------- */
function applyJoin(lobby, userId, name, pos) {
  const s = lobby.state;
  if (!POS_LABEL[pos]) return { error: "Unknown position." };
  if ((s.signups || []).some((x) => x.id === userId)) return { error: "You're already in this lobby — use **Leave** to switch positions." };
  if (posCount(s, pos) >= PER_POS) return { error: `${POS_LABEL[pos]} is full.` };
  s.signups = (s.signups || []).concat([{ id: userId, name, pos }]);
  if (s.signups.length >= FULL) {
    // lock and open the draft: first two signups captain the two teams
    s.captains = [s.signups[0].id, s.signups[1].id];
    s.teams = { A: [s.captains[0]], B: [s.captains[1]] };
    s.order = draftOrder();
    s.pickIndex = 0;
    s.turn = s.order[0];
    lobby.status = "drafting";
    return { view: draftView(lobby), status: "drafting", state: s };
  }
  return { view: signupView(lobby), status: "open", state: s };
}
function applyLeave(lobby, userId) {
  const s = lobby.state;
  if (!(s.signups || []).some((x) => x.id === userId)) return { error: "You're not in this lobby." };
  s.signups = s.signups.filter((x) => x.id !== userId);
  return { view: signupView(lobby), status: "open", state: s };
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

/* ---------- component dispatch with CAS retry ---------- */
async function handleComponent(interaction) {
  const parts = (interaction.data.custom_id || "").split(":");   // lfg:<action>:<lobbyId>:<arg?>
  const action = parts[1], lobbyId = parts[2], arg = parts[3];
  const userId = (interaction.member && interaction.member.user && interaction.member.user.id) || (interaction.user && interaction.user.id);
  const name = nameOf(interaction);

  for (let attempt = 0; attempt < 4; attempt++) {
    const lobby = await sbGetLobby(lobbyId);
    if (!lobby || lobby.status === "cancelled" || lobby.status === "done") {
      return ephemeral("This lobby has closed. Run `/lfg` to start a fresh one.");
    }
    let out;
    if (action === "join")        out = applyJoin(lobby, userId, name, arg);
    else if (action === "leave")  out = applyLeave(lobby, userId);
    else if (action === "cancel") out = { view: { embeds: [{ title: "Lobby cancelled", description: `Cancelled by <@${userId}>. Run \`/lfg\` to start again.`, color: BRAND }], components: [] }, status: "cancelled", state: lobby.state };
    else if (action === "pick")   out = applyPick(lobby, userId, (interaction.data.values || [])[0]);
    else if (action === "server") out = applyServer(lobby, userId, parseInt(arg, 10));
    else return ephemeral("Unknown action.");

    if (out.error) return ephemeral(out.error);

    const saved = await sbSaveLobby(lobby.id, lobby.updated_at, out.state, out.status);
    if (saved) return respond({ type: UPDATE, data: out.view });
    // CAS lost — another click landed first; re-read and retry
  }
  return ephemeral("The lobby was busy — try that again.");
}

/* ---------- slash command ---------- */
async function handleCommand(interaction) {
  if ((interaction.data.name || "") !== "lfg") return ephemeral("Unknown command.");
  const lobby = await sbRpc("lfg_open_lobby", { p_guild: interaction.guild_id || "", p_channel: interaction.channel_id });
  const row = Array.isArray(lobby) ? lobby[0] : lobby;
  return respond({ type: REPLY, data: signupView(row) });
}

const DIAG = "lfgdiag9x";
async function logDebug(row) {
  try { await fetch(`${SB_URL}/rest/v1/_lfg_debug`, withTimeout({ method: "POST", headers: sbHead(), body: JSON.stringify(row) })); } catch (e) {}
}

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
  const verified = verifySignature(raw, sig, ts);
  let itype = null; try { itype = JSON.parse(raw).type; } catch (e) {}
  await logDebug({ method: event.httpMethod, ua: (h["user-agent"] || h["User-Agent"] || "").slice(0, 60), has_sig: !!sig, has_ts: !!ts, raw_len: (raw || "").length, verified, itype, note: "v1" });
  if (!verified) return { statusCode: 401, body: "invalid request signature" };

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

// Exposed for local unit tests only; Netlify invokes the default export.
export const _internals = { verifySignature, applyJoin, applyLeave, applyPick, applyServer,
  signupView, draftView, serverView, doneView, remainingPool, draftOrder, POS, FULL, SERVERS };
