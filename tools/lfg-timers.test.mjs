// Exercise the REAL lfg-timers handler and the REAL applyJoin against a stubbed network.
// Run: node tools/lfg-timers.test.mjs   (exit 0 = all good)
//
// This covers the pickup lobby's per-player queue clock, which is timing-critical and otherwise
// only observable in production 30 minutes after somebody clicks. The invariant that matters most,
// and the one every drop path is asserted against: NOBODY IS EVER DROPPED WITHOUT A WARNING FIRST.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";

const HERE = new URL(".", import.meta.url).pathname;
const TIMERS = HERE + "../netlify/functions/lfg-timers.js";
const INTERACTIONS = HERE + "../netlify/functions/discord-interactions.js";

const MIN = 60000;
const ago = (m) => new Date(Date.now() - m * MIN).toISOString();
let ok = true;
const assert = (label, pass, extra) => {
  if (!pass) ok = false;
  console.log(`${pass ? "ok  " : "FAIL"} ${label}${extra ? "  — " + extra : ""}`);
};

/* ---------- stubbed Supabase + Discord ---------- */
let LOBBIES = [], CAPT = [], CAS_LOSES = false, DISCORD_POST = "ok";   // "ok" | "throw" | "null"
const log = { posts: [], patches: [] };
const asJson = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  if (u.includes("/rest/v1/lfg_lobbies") && m === "GET") return asJson(u.includes("status=eq.open") ? LOBBIES : CAPT);
  if (u.includes("/rest/v1/lfg_lobbies") && m === "PATCH") {
    if (CAS_LOSES && u.includes("updated_at=eq.")) return asJson([]);   // 0 rows = someone clicked first
    const body = JSON.parse(opts.body);
    log.patches.push(body);
    const id = (u.match(/id=eq\.([^&]+)/) || [])[1];
    const row = LOBBIES.find((l) => l.id === id) || CAPT.find((l) => l.id === id);
    if (row) Object.assign(row, body);
    return asJson([row || { id }]);
  }
  if (u.includes("/rest/v1/app_config")) return asJson([]);
  if (u.includes("discord.com")) {
    if (m === "GET") return asJson([{ id: "some-other-message" }]);
    if (m === "DELETE") return new Response("", { status: 204 });
    log.posts.push(JSON.parse(opts.body || "{}"));
    if (DISCORD_POST === "throw") return new Response("nope", { status: 403 });   // dApi throws
    if (DISCORD_POST === "null") return new Response("", { status: 404 });        // dApi returns null
    return asJson({ id: "posted" });
  }
  return asJson([]);
};

const timers = await import(TIMERS);
const { _internals: I } = await import(INTERACTIONS);

const sweep = async (lobbies, captains = [], casLoses = false, discordPost = "ok") => {
  LOBBIES = structuredClone(lobbies); CAPT = structuredClone(captains); CAS_LOSES = casLoses; DISCORD_POST = discordPost;
  log.posts.length = log.patches.length = 0;
  const out = await (await timers.default()).json();
  const state = (log.patches.find((p) => p.state) || {}).state;
  const said = (re) => log.posts.find((p) => re.test(JSON.stringify(p)));
  return { out, state, said, kept: state ? state.signups.map((x) => x.id) : null };
};
const P = (id, minsAgo, pos = "C", extra = {}) => ({ id, name: id, pos, at: ago(minsAgo), ...extra });
const lobby = (signups, extra = {}) => ({
  id: "L1", channel_id: "chan", message_id: "msg", created_at: ago(40), updated_at: ago(40),
  state: { signups, captains: [], teams: { A: [], B: [] } }, ...extra });

console.log("— per-player queue clock");
{
  const r = await sweep([lobby([P("fresh", 5), P("soon", 27), P("lapsed", 31, "RW", { warned: true }), P("already", 28, "LW", { warned: true })])]);
  assert("fresh + near-lapse + already-warned are kept, the warned-and-lapsed one goes", r.kept.join(",") === "fresh,soon,already", `kept ${r.kept.join(",")}`);
  const warn = r.said(/about to lapse/);
  assert("only the newly-at-risk player is pinged", warn && /soon/.test(warn.content) && !/already/.test(warn.content));
  assert("the ping states real minutes remaining", warn && /\*\*3 min\*\*/.test(warn.content), warn && warn.content.split("\n")[0]);
  assert("the ping actually mentions them", warn && warn.allowed_mentions.users.includes("soon"));
  assert("the warned flag is persisted so nobody is pinged twice", r.state.signups.find((x) => x.id === "soon").warned === true);
  assert("the drop is announced", !!r.said(/Taken off the board/));
}

console.log("\n— the guarantee: never dropped without a warning");
{
  const r = await sweep([lobby([P("nevertold", 45)])]);           // 15 min overdue, never warned
  assert("a long-overdue player who was never warned is HELD, not dropped", r.out.dropped === 0 && r.out.warned === 1);
  const left = (30 - (Date.now() - Date.parse(r.state.signups[0].at)) / MIN);
  assert("they are handed a fresh warning window", Math.abs(left - 4) < 0.2, `${left.toFixed(1)} min granted`);
  const r2 = await sweep([lobby([P("nevertold", 45, "C", { warned: true })])]);
  assert("on the next sweep, now warned, they are dropped", r2.out.retired === 1);
}

console.log("\n— an undelivered warning must never count as a warning");
for (const [mode, label] of [["throw", "Discord rejects the post (403)"], ["null", "the channel is gone (404)"]]) {
  const r = await sweep([lobby([P("atrisk", 27), P("safe", 5)])], [], false, mode);
  assert(`${label}: the warned flag is NOT persisted`, !r.state || !(r.state.signups.find((x) => x.id === "atrisk") || {}).warned);
  assert(`${label}: the failure is surfaced, not swallowed`, r.out.errors.length > 0, r.out.errors[0]);
  assert(`${label}: warned is not counted as delivered`, r.out.warned === 0);
  // the decisive one: the next sweep must re-warn rather than drop
  const later = await sweep([lobby([P("atrisk", 33), P("safe", 5)])], [], false, "ok");
  assert(`${label}: two ticks on, the player is re-warned and HELD, not dropped`, later.out.dropped === 0 && later.out.warned === 1 && later.kept.includes("atrisk"));
}

console.log("\n— lobby lifecycle");
{
  assert("an empty lobby inside the creation grace window is untouched", (await sweep([lobby([], { created_at: ago(1) })])).out.retired === 0);
  assert("an abandoned empty lobby is retired", (await sweep([lobby([], { created_at: ago(20) })])).out.retired === 1);
  const q = await sweep([lobby([P("x", 2), P("y", 3)])]);
  assert("a quiet tick warns nobody and drops nobody", q.out.warned === 0 && q.out.dropped === 0);
  assert("a quiet tick still keeps the summary at the bottom", q.out.refreshed === 1);
  const all = await sweep([lobby([P("a", 33, "C", { warned: true }), P("b", 40, "LW", { warned: true })])]);
  assert("a lobby whose every spot lapsed is retired", all.out.retired === 1 && !!all.said(/lobby reset/i));
}

console.log("\n— races against a live click (compare-and-swap)");
{
  const r = await sweep([lobby([P("a", 31, "C", { warned: true }), P("b", 27)])], [], true);
  assert("a lost CAS drops nobody", r.out.dropped === 0 && r.out.raced === 1);
  assert("a lost CAS announces no drop", !r.said(/Taken off the board/));
  assert("a lost CAS is not an error", r.out.errors.length === 0);
  const r2 = await sweep([lobby([P("a", 40, "C", { warned: true })])], [], true);
  assert("a lost CAS does not retire the lobby", r2.out.retired === 0 && !r2.said(/lobby reset/i));
}

console.log("\n— auto-captain fallback (5 min)");
{
  const full = (mins) => ({ id: "L9", thread_id: "room", updated_at: ago(mins),
    state: { filledAt: ago(mins), signups: Array.from({ length: 12 }, (_, i) => P("u" + i, mins)), captains: [], teams: { A: [], B: [] } } });
  const late = await sweep([], [full(6)]);
  assert("captains are auto-assigned after 5 min", late.out.autoCaptained === 1);
  assert("the first two signups become the captains", JSON.stringify(late.state.captains) === '["u0","u1"]');
  assert("the draft starts on Team A", late.state.turn === "A" && late.state.pickIndex === 0);
  assert("nothing happens before 5 min", (await sweep([], [full(3)])).out.autoCaptained === 0);
  assert("a real /captain landing first is not overridden", (await sweep([], [full(6)], true)).out.autoCaptained === 0);
}

console.log("\n— /join renewal (the action the warning asks for)");
{
  const lb = { id: "L", status: "open", state: { signups: [P("u1", 27, "C", { warned: true }), P("u2", 2, "LW")], captains: [], teams: { A: [], B: [] } } };
  const same = I.applyJoin(lb, "u1", "U1", "C");
  const u1 = same.state.signups.find((x) => x.id === "u1");
  assert("re-joining renews instead of erroring", !same.error && same.renewed === true);
  assert("the clock is reset", (Date.now() - Date.parse(u1.at)) / MIN < 0.2);
  assert("the warned flag is cleared so they can be warned again", u1.warned === undefined);
  assert("no duplicate signup is created", same.state.signups.length === 2);

  const moved = I.applyJoin(lb, "u1", "U1", "RD");
  assert("re-joining at an open position moves them", moved.moved === true && moved.state.signups.find((x) => x.id === "u1").pos === "RD");

  lb.state.signups.push(P("u3", 1, "LW"));                        // LW now full (2)
  lb.state.signups.find((x) => x.id === "u1").at = ago(29);
  const blocked = I.applyJoin(lb, "u1", "U1", "LW");
  const after = blocked.state.signups.find((x) => x.id === "u1");
  assert("re-joining into a FULL position still renews rather than failing", !blocked.error && blocked.renewed === true && (Date.now() - Date.parse(after.at)) / MIN < 0.2);
  assert("...and says which position was full", blocked.blocked === "Left Wing" && after.pos === "RD");

  const fresh = I.applyJoin(lb, "u9", "New", "G");
  assert("a new joiner is stamped with a clock", !!fresh.state.signups.find((x) => x.id === "u9").at);
  assert("position quotas still bind newcomers", !!I.applyJoin(lb, "u10", "X", "LW").error);
}

console.log(`\n${ok ? "PASS — all assertions held" : "FAIL — see above"}`);
process.exit(ok ? 0 : 1);
