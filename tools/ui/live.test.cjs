const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* The live client (js/live.js, v5.00 swap stream f), proved in headless Chromium on the real site:
   node tools/ui/run.cjs --suite live --mode live
   Sign-in with Discord (the OAuth fragment intercept, the relink twin of tools/discord-relink.test.cjs, the auth-event
   thrash guards of tools/auth-thrash.test.cjs), the ONE write door S2._writeImpl (fail loud, ids back from every table
   write, Owner approval decided by the database, re-read then repaint), the bell and the
   notifRoute fixes, and the league pulse (memory live-pulse-v405).
   i3a (2026-11-25): every context is mock.install(ctx, {live: true, page: false}): the page exactly as the site build
   ships it, the REAL supabase-js (vendor/) and js/live.js's own sign-in, write door and channels, with the harness
   answering every request (tools/ui/mock/index.cjs: the recorded league read, the persona's sign-in, table and RPC
   answers, routes for the table writes, mock.push for Realtime). The suite's own stand-in for supabase-js is gone. Auth
   events a test cannot cause through the network (a burst of SIGNED_IN, a token refresh, another account) are told to
   live.js through the client's own listener list (GoTrueClient._notifyAllSubscribers), as supabase-js itself tells it.
   Every Supabase request is recorded here (net). Nothing here reaches Supabase, Netlify or Discord.
   Deleted with demo mode: "S2.LIVE is false, no client is made, the dock's role stands" and "S2.write still rejects: the
   demo installs no write door" (the demo is gone), "j1's page mock ... nothing goes live" (the page mock now runs the real
   site: S2_MODE mock is no longer a mode of the page), and "the dock cannot make a guest a commissioner" (no dock).
   i3f (2026-11-25): "a write made once is sent once; replaying the carried log sends nothing" (S2.carry, the concept's
   automatic-update replay, is gone with js/share.js: the real update reloads the page and sends nothing again), and the role
   list checks read S2.roleOf(S2.session) now that S2.ROLES is gone. */
const fs = require("fs"), path = require("path");
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const BASE = S2_BASE;
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more === undefined ? "" : "  (" + JSON.stringify(more).slice(0, 700) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (p, fn, arg, ms) => { try { await p.waitForFunction(fn, arg, { timeout: ms || 8000 }); return true; } catch (e) { return false; } };
const MEMBER = mock.sessionOf("member"), GM = mock.liveSessionOf("gm"), STAFF = mock.sessionOf("staff");
const STORE_KEY = "sb-bzbuyclwdhmhdzujxeqd-auth-token";

/* runs in the page before any script: the intro and the survey stay shut, a return trip can be stashed, window.open is
   recorded, the visibility can be turned, and the pulse's jitter can be pinned */
function init(cfg) {
  try {
    localStorage.setItem("s2.introSeen", "true");
    localStorage.setItem("s2.surveyLoadDay", new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
    if (cfg.ret) localStorage.setItem("s2_return", JSON.stringify({ h: cfg.ret, at: Date.now() }));
    if (cfg.unsigned) localStorage.removeItem(cfg.key);
    if (cfg.user) { var st = JSON.parse(localStorage.getItem(cfg.key)); st.user = cfg.user; localStorage.setItem(cfg.key, JSON.stringify(st)); }
  } catch (e) { /* about:blank has no storage */ }
  if (cfg.random != null) Math.random = function () { return cfg.random; };
  window.__vis = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: function () { return window.__vis; } });
  window.__opened = []; window.open = function (u, t, f) { window.__opened.push([u, t, f]); return null; };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  /* o: { persona, session, tables, rpcs, routes, ret, unsigned (no stored sign-in), user (the stored sign-in's user),
     random, pageMock (keep the harness's write mock: the page layer) }; -> { p, ctx, st, net } */
  async function page(hash, o, opts) {
    o = o || {};
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const net = [];
    ctx.on("request", (q) => { const u = new URL(q.url()); if (/\.supabase\.co$/.test(u.hostname)) net.push({ m: q.method(), p: u.pathname, q: u.search, body: q.postData() }); });
    const st = await mock.install(ctx, { live: true, persona: o.persona || "anon", page: o.pageMock ? undefined : false, session: o.session, writes: o.writes,
      tables: o.tables, rpcs: Object.assign({ season_survey_done: mock.ok(true) }, o.rpcs), routes: o.routes });
    await ctx.addInitScript(init, { key: STORE_KEY, ret: o.ret || null, unsigned: !!o.unsigned, user: o.user || null, random: o.random == null ? null : o.random });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text()) && !(opts && opts.expectErrors && opts.expectErrors.test(m.text()))) errors.push(m.text()); });
    await p.goto(BASE + hash);
    await p.waitForFunction(() => window.S2 && S2.$ && S2.$("#page") && S2.$("#page").children.length > 0, null, { timeout: 30000 });
    await wait(250);
    return { p, ctx, st, net };
  }
  const done = (x) => x.ctx.close();
  const sb = (x, fn, arg) => x.p.evaluate(fn, arg);
  const reqs = (x, m, pth) => x.net.filter((r) => r.m === m && r.p === pth);
  const count = (x, m, pth) => reqs(x, m, pth).length;
  const lastBody = (x, m, pth) => { const r = reqs(x, m, pth).pop(); return r && r.body ? JSON.parse(r.body) : null; };
  const signedIn = (x, pid) => until(x.p, (id) => S2.session.profileId === id && S2.state.role !== "guest", pid, 10000);
  /* an auth event as supabase-js tells it to its listeners (live.js's onAuthStateChange); sess: a session object */
  const tell = (x, ev, sess) => sb(x, (a) => S2.sb.auth._notifyAllSubscribers(a[0], a[1]), [ev, sess]);
  const sessionFor = (persona, extra) => { const s = mock.sessionOf(persona); return Object.assign({ access_token: s.accessToken, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "mock-refresh", user: s.user }, extra || {}); };
  const league = mock.league({});
  const club = league.teams.filter((t) => t.id === GM.teamId)[0];
  let x, r;

  console.log("## the source: one project, one key, ES5 like the rest of the concept");
  {
    const live = fs.readFileSync(path.join(S2_ROOT, "js/live.js"), "utf8"), cur = fs.readFileSync(path.join(S2_ROOT, "../live/part_live.js"), "utf8");
    const get = (src, re) => (re.exec(src) || [])[1];
    A("the project URL and anon key are the current site's, byte for byte", get(live, /S2\.SB_URL = "([^"]+)"/) === get(cur, /CG\.SB_URL = "([^"]+)"/) && get(live, /S2\.SB_KEY = "([^"]+)"/) === get(cur, /CG\.SB_KEY = "([^"]+)"/) && !!get(cur, /CG\.SB_KEY = "([^"]+)"/));
    A("the client options are the current site's (one shared session per origin)", /createClient\(S2\.SB_URL, S2\.SB_KEY, \{ auth: \{ persistSession: true, autoRefreshToken: true \} \}\)/.test(live));
    A("no let, const, class or arrow function in js/live.js", !/(^|[;{(])\s*(let|const|class)\s+[A-Za-z_$]/m.test(live) && !/=>/.test(live));
    const html = fs.readFileSync(path.join(S2_ROOT, "demo.html"), "utf8");
    const srcs = Array.from(html.matchAll(/ src="([^"]+)"/g), (m) => m[1]);
    A("demo.html loads js/live.js right after js/core.js", srcs.indexOf("js/core.js") >= 0 && srcs[srcs.indexOf("js/core.js") + 1] === "js/live.js", srcs.slice(0, 4));
  }

  console.log("## a test's write mock stays the write door");
  x = await page("#/today", { persona: "member", pageMock: true, writes: { waive_player: mock.ok("mock:waive_player") } });
  r = await sb(x, () => S2.write("waive_player", {}).then((y) => y.data, (e) => e.message));
  A("a test mock injected before the page loads is never replaced by the real door", r === "mock:waive_player" && count(x, "POST", "/rest/v1/rpc/waive_player") === 0
    && (await sb(x, () => window.S2_MOCK.blocked.indexOf("_writeImpl") < 0)), r);
  await done(x);

  console.log("## signed out");
  x = await page("#/today", {});
  /* Discord's sign-in page stands in for the league's authorize redirect */
  await x.ctx.route(/\/auth\/v1\/authorize\?/, (rt) => rt.fulfill({ status: 200, contentType: "text/html", body: "<p>Discord sign-in</p>" }));
  r = await sb(x, () => ({ live: S2.LIVE, role: S2.state.role, roleOf: S2.roleOf(S2.session), user: S2.session.user, join: !!S2.$(".nav-join") }));
  A("live mode with no session is a guest, the role the session gives (i3f: no role list to pick from)", r.live && r.role === "guest" && r.roleOf === "guest" && r.user === null && r.join, r);
  await wait(300);
  A("the client joins the one public league channel", mock.realtime(x.ctx).some((t) => /league-live$/.test(t)), mock.realtime(x.ctx));
  r = await sb(x, () => S2.write("waive_player", {}).then(() => null, (e) => ({ code: e.code, m: e.message })));
  A("a write while signed out is refused before anything is sent", r && r.code === "S2_SIGNED_OUT" && count(x, "POST", "/rest/v1/rpc/waive_player") === 0, r);
  await sb(x, () => { location.hash = "#/standings?view=race"; }); await wait(200);
  const oauth = x.p.waitForRequest((q) => /\/auth\/v1\/authorize\?/.test(q.url()), { timeout: 8000 }).then((q) => new URL(q.url()), () => null);
  r = await sb(x, () => { S2.signIn(); return { here: location.origin + location.pathname, ret: JSON.parse(localStorage.getItem("s2_return")) }; });
  const au = await oauth;
  A("Sign in asks Discord for identify only and comes back to this page", !!au && au.searchParams.get("provider") === "discord" && au.searchParams.get("scopes") === "identify" && au.searchParams.get("redirect_to") === r.here && /\/demo\.html$/.test(r.here), [au && au.search, r.here]);
  A("the page it started on is kept for the return trip", r.ret.h === "#/standings?view=race" && Date.now() - r.ret.at < 60000, r.ret);
  await done(x);

  console.log("## who is signed in: role, club and seat from the league, not the dock");
  for (const [label, persona, session, want] of [["a rostered member", "member", { teamId: GM.teamId }, { role: "player", seat: null, team: GM.teamId, code: club.code }],
    ["a GM", "gm", null, { role: "office", seat: "gm", team: GM.teamId, code: club.code }],
    ["an Owner", "gm", { seat: "owner" }, { role: "office", seat: "owner", team: GM.teamId, code: club.code }],
    ["a commissioner", "commissioner", null, { role: "commish", seat: null, team: null, code: null }],
    ["a member with no club", "member", null, { role: "player", seat: null, team: null, code: null }]]) {
    x = await page("#/today", { persona, session });
    const me = mock.sessionOf(persona);
    await signedIn(x, me.profileId); await wait(300);
    r = await sb(x, () => ({ role: S2.state.role, s: Object.assign({}, S2.session, { user: !!S2.session.user }), roleOf: S2.roleOf(S2.session) }));
    A(label + ": role " + want.role + ", seat " + want.seat + ", club " + want.code, r.role === want.role && r.s.seat === want.seat && r.s.teamId === want.team && r.s.teamCode === want.code
      && r.s.profileId === me.profileId && r.s.accessToken === me.accessToken && r.roleOf === want.role, r);
    await done(x);
  }
  x = await page("#/today", { persona: "staff", session: { committees: ["draft"] } });
  await signedIn(x, STAFF.profileId); await wait(300);
  r = await sb(x, () => ({ role: S2.state.role, m: S2.has("manager"), d: S2.has("draftbid"), st: S2.has("staff"), c: S2.session.committees, isStaff: S2.session.isStaff }));
  A("a staffer who holds the Draft and Bidding seat has both hats, read from public.committees", r.role === "staff" && r.m && r.d && r.st && r.isStaff && r.c.join() === "draft", r);
  await done(x);
  x = await page("#/today", { persona: "staff" });
  await signedIn(x, STAFF.profileId); await wait(300);
  r = await sb(x, () => ({ m: S2.has("manager"), d: S2.has("draftbid") }));
  A("a staffer with no seat has neither", !r.m && !r.d, r);
  await done(x);

  console.log("## the auth-event thrash guards (memory auth-event-thrash)");
  x = await page("#/standings", { persona: "member" });
  await signedIn(x, MEMBER.profileId); await wait(400);
  const profReads = () => count(x, "GET", "/rest/v1/profiles");
  await sb(x, () => { window.__nav = S2.$("#navbar"); });
  let n0 = profReads();
  for (const ev of ["INITIAL_SESSION", "SIGNED_IN", "SIGNED_IN", "SIGNED_IN"]) await tell(x, ev, sessionFor("member"));
  await wait(400);
  r = await sb(x, () => ({ same: S2.$("#navbar") === window.__nav }));
  A("a burst of events for the member already applied reads nothing and repaints nothing", r.same && profReads() - n0 === 0, [r, profReads() - n0]);
  n0 = profReads();
  await tell(x, "TOKEN_REFRESHED", sessionFor("member", { access_token: MEMBER.accessToken + "-2" })); await wait(400);
  r = await sb(x, () => ({ same: S2.$("#navbar") === window.__nav, tok: S2.session.accessToken }));
  A("the hourly token refresh re-reads quietly: fresh data and token, no repaint", r.same && profReads() - n0 === 1 && /-2$/.test(r.tok), [r, profReads() - n0]);
  /* another account: the league now answers as that account (the harness switches persona), and its session is told */
  await mock.install(x.ctx, { live: true, persona: "gm", page: false, rpcs: { season_survey_done: mock.ok(true) } });
  await tell(x, "SIGNED_IN", sessionFor("gm")); await wait(600);
  r = await sb(x, () => ({ role: S2.state.role, seat: S2.session.seat, id: S2.session.profileId, same: S2.$("#navbar") === window.__nav, hash: location.hash }));
  A("another account signing in repaints once, in place, as that account", r.role === "office" && r.seat === "gm" && r.id === GM.profileId && !r.same && r.hash === "#/standings", r);
  await mock.install(x.ctx, { live: true, persona: "staff", page: false, rpcs: { season_survey_done: mock.ok(true) } });
  await sb(x, (a) => { S2.sb.auth._notifyAllSubscribers("SIGNED_IN", a[0]); S2.sb.auth._notifyAllSubscribers("SIGNED_IN", a[1]); }, [sessionFor("member"), sessionFor("staff")]); await wait(800);
  A("two identities in one burst: the newest wins", (await sb(x, () => S2.session.profileId)) === STAFF.profileId);
  await sb(x, () => S2.signOut()); await wait(600);
  r = await sb(x, () => ({ role: S2.state.role, user: S2.session.user, team: S2.session.teamId, notifs: S2.sb.getChannels().filter((c) => /notifs-/.test(c.topic)).length, hash: location.hash }));
  A("sign-out is a guest again, the member's channel closes, Today opens", r.role === "guest" && r.user === null && r.team === null && r.notifs === 0 && r.hash === "#/today" && count(x, "POST", "/auth/v1/logout") === 1, r);
  await done(x);

  console.log("## the Discord identity refresh, and a refused one never shakes the page");
  /* the account's Discord identity carries a new name; the profile on file still has the old one */
  const renamed = Object.assign({}, MEMBER.user, { identities: [{ provider: "discord", id: "i-1", identity_data: { provider_id: "d-1", full_name: "New Name", avatar_url: null }, last_sign_in_at: "2026-11-24T00:00:00Z" }] });
  /* the league's people as the harness answers profiles (liveDefaults), this member's row carrying the old Discord name */
  const PEOPLE = league.people.map((y) => ({ id: y.id, gamertag: y.gamertag, display_name: y.display_name, avatar_url: y.avatar_url, role: y.role, banned: !!y.banned, ban_reason: null,
    discord_id: y.id === MEMBER.profileId ? "d-1" : null, discord_username: y.id === MEMBER.profileId ? "Old Name" : null, in_guild: true }));
  let patches = [];
  const patchProfiles = (answer) => ({ "PATCH /rest/v1/profiles": (url, body) => { patches.push({ url, body }); return answer(url); } });
  x = await page("#/today", { persona: "member", user: renamed, tables: { profiles: PEOPLE }, routes: patchProfiles((url) => ({ status: 200, json: [{ id: url.searchParams.get("id").replace(/^eq\./, "") }] })) });
  await signedIn(x, MEMBER.profileId); await wait(800);
  r = patches[patches.length - 1];
  A("the profile follows the account's new Discord name, asking for its id back", !!r && r.body.discord_username === "New Name" && r.url.searchParams.get("select") === "id" && r.url.searchParams.get("id") === "eq." + MEMBER.profileId, r && { body: r.body, q: r.url.search });
  await done(x);
  patches = [];
  x = await page("#/today", { persona: "member", user: renamed, tables: { profiles: PEOPLE }, routes: patchProfiles(() => ({ status: 200, json: [] })) }, { expectErrors: /Discord|profile|S2_NO_ROWS|Nothing was saved/ });
  await signedIn(x, MEMBER.profileId); await wait(800);
  A("the refused refresh was tried once, asking for its id back", patches.length === 1 && patches[0].url.searchParams.get("select") === "id", patches.length);
  await sb(x, () => { window.__nav = S2.$("#navbar"); });
  n0 = count(x, "GET", "/rest/v1/profiles");
  await tell(x, "SIGNED_IN", sessionFor("member", { user: renamed })); await tell(x, "SIGNED_IN", sessionFor("member", { user: renamed })); await wait(400);
  r = await sb(x, () => ({ same: S2.$("#navbar") === window.__nav }));
  A("a refused refresh is remembered: refocusing does not re-run the whole sign-in", count(x, "GET", "/rest/v1/profiles") - n0 === 0 && r.same && patches.length === 1, [r, patches.length]);
  await done(x);

  console.log("## the sign-in intercept (the twin of tools/discord-relink.test.cjs)");
  x = await page("#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user", {}, { expectErrors: /identity|Identity|sign-in/ });
  await until(x.p, () => !!S2.$(".sheet"));
  r = await sb(x, () => ({ hash: location.hash, sheet: (S2.$(".sheet") || {}).textContent || "", broken: /could not be drawn/.test(document.body.textContent) }));
  A("an error fragment opens You and says Supabase's words, with the switch advice", r.hash === "#/you" && /Discord sign-in did not complete/.test(r.sheet) && /Identity is already linked to another user/.test(r.sheet) && /Link a new Discord account/.test(r.sheet) && !r.broken, r);
  await done(x);
  /* the round trip back from Discord: supabase-js reads the fragment and asks the league who the token is; the answer is
     held here until the check has seen the page waiting for it */
  let release; const gate = new Promise((res) => { release = res; });
  const userAnswer = { "GET /auth/v1/user": async () => { await gate; return { status: 200, json: MEMBER.user }; } };
  x = await page("#access_token=" + MEMBER.accessToken + "&expires_at=4102444800&expires_in=3600&refresh_token=mock-refresh&token_type=bearer", { persona: "member", unsigned: true, ret: "#/standings?view=race", routes: userAnswer });
  r = await sb(x, () => ({ hash: location.hash, text: S2.$("#page").textContent }));
  A("a success fragment stays for supabase-js and the page says it is completing", /^#access_token=/.test(r.hash) && /Completing sign-in/.test(r.text), { hash: r.hash.slice(0, 20), text: r.text.slice(0, 80) });
  release();
  await until(x.p, () => S2.session.profileId && S2.state.role !== "guest" && !S2._oauthPending && location.hash === "#/standings?view=race", null, 10000);
  r = await sb(x, () => ({ hash: location.hash, role: S2.state.role, text: S2.$("#page").textContent.slice(0, 80), pending: !!S2._oauthPending, ret: localStorage.getItem("s2_return") }));
  A("the session lands and the reader is back where they started, signed in", r.hash === "#/standings?view=race" && r.role === "player" && !/Completing/.test(r.text) && !r.pending && r.ret === null, r);
  await done(x);
  x = await page("#access_token=" + MEMBER.accessToken + "&expires_at=4102444800&expires_in=3600&refresh_token=mock-refresh&token_type=bearer", { persona: "member", unsigned: true, ret: "#/clubs",
    routes: { "GET /auth/v1/user": () => new Promise(() => {}) } }, { expectErrors: /sign-in|session/ });
  await wait(15600);
  r = await sb(x, () => ({ hash: location.hash, text: S2.$("#page").textContent.slice(0, 60), pending: !!S2._oauthPending }));
  A("an abandoned round trip falls back to the page after 15 seconds", r.hash === "#/clubs" && !/Completing/.test(r.text) && !r.pending, r);
  await done(x);
  /* Link a new Discord account: supabase-js asks the league for Discord's address, then goes there (here: back to Settings) */
  let linkRefused = false;
  x = await page("#/you?tab=settings", { persona: "member", rpcs: { my_discord_accounts: mock.ok([]) }, routes: { "GET /auth/v1/user/identities/authorize": (url) => linkRefused
    ? { status: 422, json: { code: 422, error_code: "manual_linking_disabled", msg: "Manual linking is disabled" } }
    : { status: 200, json: { url: process.env.S2_BASE + "#/you?tab=settings", provider: url.searchParams.get("provider"), scopes: url.searchParams.get("scopes") } } } });
  await signedIn(x, MEMBER.profileId); await wait(300);
  r = await sb(x, () => S2.linkDiscord().then(() => ({ sw: JSON.parse(localStorage.getItem("s2_dc_switch")), ret: JSON.parse(localStorage.getItem("s2_return")).h })));
  const link = reqs(x, "GET", "/auth/v1/user/identities/authorize").map((q) => new URLSearchParams(q.q)).pop();
  A("Link a new Discord account keeps identify only, and comes back to Settings to switch", !!link && link.get("provider") === "discord" && link.get("scopes") === "identify" && r.sw.at > 0 && r.ret === "#/you?tab=settings", [link && link.toString(), r]);
  r = await sb(x, () => { const at = Date.now(); localStorage.setItem("s2_dc_switch", JSON.stringify({ at }));
    const pick = S2.takeDiscordSwitch([{ discord_id: "1", linked_at: new Date(at - 3600e3).toISOString() }, { discord_id: "2", linked_at: new Date(at + 1000).toISOString() }, { discord_id: "cur", linked_at: new Date(at + 2000).toISOString() }], "cur");
    return { pick: pick && pick.discord_id, again: S2.takeDiscordSwitch([{ discord_id: "2", linked_at: new Date(at + 1000).toISOString() }], "cur") }; });
  A("the switch goes to the account linked since the stash, once", r.pick === "2" && r.again === null, r);
  linkRefused = true;
  r = await sb(x, () => S2.linkDiscord().then(() => null, (e) => ({ m: e.message, sw: localStorage.getItem("s2_dc_switch") })));
  A("a refused link says Supabase's words and leaves no switch waiting", r && r.m === "Manual linking is disabled" && r.sw === null, r);
  await done(x);

  console.log("## a banned member keeps the session but not the league");
  x = await page("#/today", { persona: "member", tables: { profiles: PEOPLE.map((y) => (y.id === MEMBER.profileId ? Object.assign({}, y, { banned: true, ban_reason: "Test ban" }) : y)) } });
  await until(x.p, () => !!document.getElementById("banScreen"), null, 10000);
  r = await sb(x, () => (document.getElementById("banScreen") || {}).textContent);
  A("the revoked screen shows the reason and a way to sign out", /access has been revoked/.test(r) && /Test ban/.test(r) && /Sign out/.test(r), r);
  await done(x);

  console.log("## S2.write: fail loud, ids back, nothing faked");
  x = await page("#/today", { persona: "gm", rpcs: { set_my_jersey_number: mock.ok({ chosen: 19 }) } });
  await until(x.p, () => S2.session.teamCode); await wait(300);
  /* the re-read is the real one (S2.reread: s2_league again, as the harness records it); a spy keeps its order */
  await sb(x, () => { window.__order = []; const read = S2.load.read; S2.load.read = function (season, s, ids) { window.__order.push(["reread", s.join(), ids || null]); return read.apply(this, arguments); }; });
  r = await sb(x, () => S2.write("set_my_jersey_number", { p_number: 19 }, { sections: ["rosters"], repaint: (y) => window.__order.push(["repaint", !!y.data || y.data === null]) })
    .then((y) => ({ y, order: window.__order })));
  A("an RPC is called with its named arguments and resolves after the database answers", lastBody(x, "POST", "/rest/v1/rpc/set_my_jersey_number").p_number === 19 && r.y.data.chosen === 19 && r.y.reread === true, r);
  A("the writer re-reads what it changed, then the page repaints its widget", JSON.stringify(r.order) === JSON.stringify([["reread", "rosters", null], ["repaint", true]]), r.order);
  await done(x);
  /* a re-read of named games: Season 1 on screen (its games carry box scores); the league answers the narrowed read with
     one line for the first game (its LAST line alone, told apart from what was on file) and none for the second, and a
     career section carrying a marker (one player's count raised by 1000) */
  const S1 = mock.league({ p_season: 1 });
  const [g1, g2] = Object.keys(S1.box.byGame).slice(0, 2), NEW1 = S1.box.byGame[g1].slice(-1);
  const CK = Object.keys(S1.career)[0], CAREER = Object.assign({}, S1.career, { [CK]: S1.career[CK] + 1000 });
  /* the narrowed read is a minute later than the first: the model's moment follows it (QA round 2, M.generated and M.now) */
  const LATER = new Date(Date.parse(S1.generated) + 60000).toISOString();
  x = await page("?season=1#/today", { persona: "gm", rpcs: { s2_league: (a) => (a.p_game_ids ? mock.ok({ generated: LATER, season: 1, sections: a.p_sections, box: { cols: S1.box.cols, byGame: { [g1]: NEW1 } }, career: CAREER })
    : mock.ok(mock.league(a))) } });
  await until(x.p, () => S2.session.teamCode); await wait(300);
  r = await sb(x, (a) => { window.__built = 0; const build = S2.buildModel; S2.buildModel = function () { window.__built++; return build.apply(this, arguments); };
    /* the whole box the merge must leave: every other game exactly as it was, the second game gone, the first the answered line */
    const want = JSON.parse(JSON.stringify(S2.data.body.box.byGame)); delete want[a.g1]; delete want[a.g2]; want[a.g1] = a.new1;
    const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    return S2.reread(["box", "career", "news"], { gameIds: [a.g1, a.g2] }).then((ok) => { const by = S2.data.body.box.byGame, c = S2.data.body.career;
      return { ok, box: sorted(by) === sorted(want), g1: JSON.stringify(by[a.g1]) === JSON.stringify(a.new1), g2: a.g2 in by, games: Object.keys(by).length + " of " + Object.keys(want).length,
        career: c[a.ck], careerAll: JSON.stringify(c) === JSON.stringify(a.career), built: window.__built, gen: S2.M.generated, now: S2.M.now.toISOString() }; }); }, { g1, g2, new1: NEW1, ck: CK, career: CAREER });
  A("a re-read of named games replaces only their lines (a game left with none drops out), the career section lands, then the model is rebuilt in place",
    r.ok && r.box && r.g1 && r.g2 === false && r.career === CAREER[CK] && r.careerAll && r.built === 1, r);
  A("the rebuilt model's moment is the re-read's (M.generated and M.now), so what keys on it reads again", r.gen === LATER && r.now === LATER, { gen: r.gen, now: r.now, want: LATER });
  const reads0 = count(x, "POST", "/rest/v1/rpc/s2_league");
  r = await sb(x, () => S2.reread(["news"]));
  A("a section the page never loaded (news is lazy) is not read", r === true && count(x, "POST", "/rest/v1/rpc/s2_league") === reads0, r);
  await done(x);
  x = await page("#/today", { persona: "gm" });
  await until(x.p, () => S2.session.teamCode); await wait(300);
  mock.respond(x.ctx, "rpc:waive_player", mock.fail("23514", "Rule 7.2: this player is suspended and cannot be waived.", "suspended"));
  r = await sb(x, () => S2.write("waive_player", { p_profile: "x" }).then(() => null, (e) => ({ m: e.message, c: e.code, h: e.hint })));
  A("a refusal rejects with the database's own message, code and hint", r && r.m === "Rule 7.2: this player is suspended and cannot be waived." && r.c === "23514" && r.h === "suspended", r);
  x.st.routes["PATCH /rest/v1/roster_spots"] = () => ({ status: 200, json: [] });
  r = await sb(x, () => S2.write("roster_spots.update", { set: { on_block: true }, match: { id: "spot-1" } }).then(() => null, (e) => ({ m: e.message, c: e.code })));
  const patch = reqs(x, "PATCH", "/rest/v1/roster_spots").map((q) => new URLSearchParams(q.q)).pop();
  A("an update RLS filters out (0 rows, no error) is a failure, and asked for its ids", r && r.c === "S2_NO_ROWS" && /Nothing was saved/.test(r.m) && patch.get("select") === "id" && patch.get("id") === "eq.spot-1", [r, patch && patch.toString()]);
  n0 = x.net.length;
  r = await sb(x, () => Promise.all([
    S2.write("trades.delete", { match: {} }).then(() => "sent", (e) => e.code), S2.write("trades.update", { match: { id: "t" } }).then(() => "sent", (e) => e.code),
    S2.write("trades.insert", {}).then(() => "sent", (e) => e.code), S2.write("x; drop", {}).then(() => "sent", (e) => e.code),
    S2.write("waive_player", {}, { sections: ["standings"] }).then(() => "sent", (e) => e.code), S2.write("waive_player", {}, { approval: "gm" }).then(() => "sent", (e) => e.code)
  ]));
  A("an unqualified delete, an empty update, a missing row, a bad name, an unknown section or approval: refused, nothing sent", r.every((y) => y === "S2_BAD_CALL") && x.net.length === n0, [r, x.net.slice(n0).map((q) => q.m + " " + q.p)]);
  x.st.routes["POST /rest/v1/trades"] = (url, body) => ({ status: 201, json: body.map((y, i) => ({ id: "t" + i })) });
  r = await sb(x, () => S2.write("trades.insert", { row: [{ a: 1 }, { a: 2 }] }).then((y) => y.data.length));
  A("an insert resolves with the rows that came back", r === 2, r);
  x.st.routes["POST /rest/v1/trades"] = () => ({ status: 201, json: [{ id: "t0" }] });
  r = await sb(x, () => S2.write("trades.insert", { row: [{ a: 1 }, { a: 2 }] }).then(() => null, (e) => e.code));
  A("an insert that comes back short is a failure", r === "S2_NO_ROWS", r);
  await done(x);

  console.log("## Owner approval: the database decides, the client keeps no copy of the policy");
  x = await page("#/today", { persona: "gm", rpcs: { waive_player: mock.fail("42501", "MGMT_APPROVAL_REQUIRED: the Owner approves Roster moves for your seat — send this move to the Owner instead."),
    mgmt_request_move: mock.ok("move-1"), set_game_lineup: mock.ok(null), market_claim: mock.fail("23514", "Rule S2.5: the club needs a roster spot.") } });
  await until(x.p, () => S2.session.teamCode); await wait(300);
  r = await sb(x, () => { window.__rep = 0; return S2.write("waive_player", { p_profile: "p1", p_not_inactive: true }, { approval: "owner", sections: ["rosters"], repaint: () => window.__rep++ })
    .then((y) => ({ y, rep: window.__rep })); });
  let q = lastBody(x, "POST", "/rest/v1/rpc/mgmt_request_move");
  A("a GM under approval: the door refuses, the move goes to the Owner with the same arguments", r.y.queued === true && r.y.data === "move-1" && q.p_team_code === club.code && q.p_action === "waive_player" && q.p_args.p_profile === "p1" && r.rep === 1, [r, q]);
  n0 = count(x, "POST", "/rest/v1/rpc/mgmt_request_move");
  await sb(x, () => S2.write("set_game_lineup", { p_game: "g" }, { approval: "owner" }));
  A("a seat with full access makes the move itself; nothing is queued", count(x, "POST", "/rest/v1/rpc/mgmt_request_move") === n0 && count(x, "POST", "/rest/v1/rpc/set_game_lineup") === 1);
  x.st.routes["PATCH /rest/v1/roster_spots"] = () => ({ status: 403, json: { code: "42501", message: "MGMT_APPROVAL_REQUIRED: the Owner approves Roster moves for your seat.", hint: null, details: null } });
  r = await sb(x, () => S2.write("roster_spots.update", { set: { on_block: true }, match: { id: "s1" } }, { approval: "owner", action: "roster_block", queueArgs: { p_profile: "p1", on_block: true } }).then((y) => y.queued));
  q = lastBody(x, "POST", "/rest/v1/rpc/mgmt_request_move");
  A("a table door under approval queues its named move with the queue's arguments", r === true && q.p_action === "roster_block" && q.p_args.on_block === true, [r, q]);
  mock.respond(x.ctx, "rpc:mgmt_request_move", mock.fail("P0001", "This move does not need the Owner's approval — make it directly."));
  r = await sb(x, () => S2.write("waive_player", { p_profile: "p1" }, { approval: "owner" }).then(() => null, (e) => e.message));
  A("a queue refusal is said in the database's words", r === "This move does not need the Owner's approval — make it directly.", r);
  n0 = count(x, "POST", "/rest/v1/rpc/mgmt_request_move");
  r = await sb(x, () => S2.write("market_claim", { p_profile: "p1" }, { approval: "owner" }).then(() => null, (e) => ({ m: e.message })));
  A("any other refusal is never sent to the Owner", r && /roster spot/.test(r.m) && count(x, "POST", "/rest/v1/rpc/mgmt_request_move") === n0, r);
  await done(x);

  console.log("## a write lands even when the page cannot redraw");
  x = await page("#/today", { persona: "member", rpcs: { set_my_jersey_number: mock.ok({ chosen: 9 }) } }, { expectErrors: /no league read to repeat|the repaint after the save failed|boom|again failed/ });
  await signedIn(x, MEMBER.profileId); await wait(300);
  /* the league read fails after the save (a refused re-read), and the page's repaint throws */
  mock.respond(x.ctx, "rpc:s2_league", mock.fail("57014", "canceling statement due to statement timeout"));
  r = await sb(x, () => S2.write("set_my_jersey_number", { p_number: 9 }, { sections: ["rosters"], repaint: () => { throw new Error("boom"); } })
    .then((y) => ({ ok: true, reread: y.reread, toasts: S2.$$(".toast").map((t) => t.textContent).join(" | ") }), (e) => ({ ok: false, m: e.message })));
  A("a refused re-read and a throwing repaint: the save still resolves, and the reader is told to reload", r.ok && r.reread === false && /could not refresh itself/.test(r.toasts) && /could not redraw/.test(r.toasts), r);
  await done(x);

  console.log("## the bell");
  const own = (y) => Object.assign({ profile_id: GM.profileId, body: "", silent: false }, y);
  const notifs = [own({ id: "n1", type: "trade", title: "Offer", link_view: "manager", link_param: "roster", read: false, created_at: "2026-11-24T01:00:00Z" }),
    own({ id: "n2", type: "discord", title: "Sign-up withdrawn", link_view: "discord", link_param: null, read: false, created_at: "2026-11-24T00:00:00Z" }),
    own({ id: "n3", type: "flag", title: "Seat empty", link_view: "teams", link_param: null, read: true, created_at: "2026-11-23T00:00:00Z" })];
  x = await page("#/today", { persona: "gm", tables: { notifications: notifs }, routes: { "PATCH /rest/v1/notifications": () => ({ status: 200, json: [{ id: "n1" }, { id: "n2" }] }) } });
  await until(x.p, () => S2.notifs.list && S2.notifs.list.length === 3, null, 10000); await wait(500);
  r = await sb(x, () => { const b = S2.$("#openBell"); return { dot: b.classList.contains("has-dot"), label: b.getAttribute("aria-label"), routes: S2.notifs.list.map((y) => y.route) }; });
  A("unread alerts light the bell and say how many", r.dot && r.label === "Notifications, 2 unread", r);
  const elsewhere = mock.push(x.ctx, "notifications", "INSERT", own({ id: "nx", profile_id: MEMBER.profileId, type: "flag", title: "Not yours", read: false, created_at: "2026-11-24T01:30:00Z" }));
  A("the member's own channel, filtered to their rows", elsewhere === 0 && (await sb(x, () => S2.notifs.list.length)) === 3, elsewhere);
  /* the recorded league config carries the server invite, so "no invite yet" is asked of the route with it taken away */
  const noInvite = await sb(x, () => { const c = S2.M.config; S2.M.config = { site: {} }; const v = S2.notifRoute("discord", null); S2.M.config = c; return v; });
  A("a manager alert opens its Team HQ tab, the empty-seat alert the Clubs tab, no invite yet You", r.routes[0] === "#/hq?tab=roster" && r.routes[2] === "#/control?tab=clubs" && noInvite === "#/you", [r.routes[0], r.routes[2], noInvite]);
  n0 = count(x, "GET", "/rest/v1/profiles");
  const reached = mock.push(x.ctx, "notifications", "INSERT", own({ id: "n4", type: "role", title: "GM approved", link_view: "manager", link_param: "management", read: false, created_at: "2026-11-24T02:00:00Z" }));
  await wait(600);
  r = await sb(x, () => ({ label: S2.$("#openBell").getAttribute("aria-label"), first: S2.notifs.list[0].route }));
  A("a new alert lights the bell at once, and a seat change re-reads who the member is", reached === 1 && r.label === "Notifications, 3 unread" && r.first === "#/hq?tab=office" && count(x, "GET", "/rest/v1/profiles") - n0 >= 1, [reached, r]);
  await x.p.click("#openBell"); await wait(500);
  const seen = reqs(x, "PATCH", "/rest/v1/notifications").pop();
  r = await sb(x, () => ({ hash: location.hash, dot: S2.$("#openBell").classList.contains("has-dot"), unread: S2.notifs.unread() }));
  const sq = seen && new URLSearchParams(seen.q);
  A("opening the bell goes to the inbox and marks the member's unread rows read", !!seen && r.hash === "#/you?tab=inbox" && JSON.parse(seen.body).read === true && sq.get("profile_id") === "eq." + GM.profileId
    && sq.get("read") === "eq.false" && sq.get("select") === "id" && !r.dot && r.unread === 0, [r, seen && seen.q]);
  r = await sb(x, () => { const box = S2.$('#page [data-w="inbox"]'); window.__inboxEl = box; return box ? { titles: S2.$$(".hqx-msg-t", box).map((t) => t.textContent), sample: !!S2.$("#page .chip.sample") } : null; });
  A("the Inbox lists the member's own alerts, newest first, and no sample", r && r.titles.join("|") === "GM approved|Offer|Sign-up withdrawn|Seat empty" && !r.sample, r);
  mock.push(x.ctx, "notifications", "INSERT", own({ id: "n5", type: "flag", title: "Lineup due", link_view: "lineup", link_param: null, read: false, created_at: "2026-11-24T03:00:00Z" }));
  await wait(500);
  r = await sb(x, () => ({ first: (S2.$('#page [data-w="inbox"] .hqx-msg-t') || {}).textContent, same: S2.$('#page [data-w="inbox"]') === window.__inboxEl, hash: location.hash }));
  A("a new alert joins the open Inbox in place: same widget, no route", r.first === "Lineup due" && r.same && r.hash === "#/you?tab=inbox", r);
  r = await sb(x, () => { S2.M.config = { site: { discord_invite: "https://discord.gg/test-invite" } };
    const inv = S2.notifRoute("discord", null); S2.notifs.open({ route: inv }); S2.notifs.open({ route: "#/standings" });
    return { inv, opened: window.__opened, hash: location.hash, sched: S2.notifRoute("hub", "schedule"), mgr: S2.notifRoute("manager", ""), odd: S2.notifRoute("manager", "nonsense"), fa: S2.notifRoute("manager", "freeagents") }; });
  A("with the invite in the league's config, the Discord alert opens it in a new tab", r.inv === "https://discord.gg/test-invite" && r.opened.length === 1 && r.opened[0][0] === r.inv && r.opened[0][2] === "noopener" && r.hash === "#/standings", r);
  A("a moved game opens the schedule; a manager alert with no page or an unknown one opens Team HQ", r.sched === "#/games" && r.mgr === "#/hq" && r.odd === "#/hq" && r.fa === "#/camp", r);
  await done(x);

  /* QA core 2026-11-25 (function 1): the member's own cases and conversations, which the case and message receipts promise */
  console.log("## the Inbox: the member's cases and conversations");
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString(), CASE = "6a1d0d6e-0000-4000-8000-0000000000c1";
  const other = league.people.filter((y) => y.id !== MEMBER.profileId)[2].id, official = league.people.filter((y) => y.id !== MEMBER.profileId)[5].id;
  const inboxTables = {
    action_requests: [{ id: CASE, profile_id: MEMBER.profileId, type: "complaint", route: "league", status: "reviewing", subject: "A no-show", details: "They did not show.", response: null, created_at: ago(600), updated_at: ago(30) }],
    action_messages: [{ id: "m1", request_id: CASE, author_id: official, body: "We are looking at it.", internal: false, created_at: ago(30), deleted_at: null }],
    direct_messages: [{ id: "d1", sender_id: other, recipient_id: MEMBER.profileId, body: "Free Thursday?", created_at: ago(90), read_at: null, deleted_at: null }] };
  x = await page("#/you?tab=inbox", { persona: "member", tables: inboxTables, routes: {
    "POST /rest/v1/action_messages": () => ({ status: 201, json: [{ id: "m2" }] }), "POST /rest/v1/rpc/mark_dm_read": () => ({ status: 200, json: null }) } });
  await until(x.p, () => S2.notifs.cases && S2.notifs.dms && S2.$('#page .hqx-msg[data-id^="c-"]'), null, 10000); await wait(300);
  r = await sb(x, () => ({ rows: S2.$$("#page .hqx-msg").map((b) => b.dataset.id.slice(0, 2)), head: S2.$('#page [data-w="inboxh"]').textContent, badge: S2.nav.info.action().n }));
  A("the Inbox lists the member's case (with the official's answer) and their conversation, both unread", r.rows.join() === "c-,d-" && /2 unread items/.test(r.head) && r.badge === 1, r);
  const thq = reqs(x, "GET", "/rest/v1/action_messages").pop();
  A("the case thread is read without a staff-only note, for the member's own cases only", !!thq && new URLSearchParams(thq.q).get("internal") === "eq.false" && new URLSearchParams(reqs(x, "GET", "/rest/v1/action_requests").pop().q).get("profile_id") === "eq." + MEMBER.profileId, thq && thq.q);
  await sb(x, () => S2.$('#page .hqx-msg[data-id^="c-"]').click()); await wait(500);
  r = await sb(x, () => ({ t: S2.$(".sheet").textContent, badge: S2.nav.info.action().n }));
  A("opening the case shows the filing and the answer, and its badge clears", /They did not show\./.test(r.t) && /We are looking at it\./.test(r.t) && r.badge === 0, r);
  await x.p.fill("#ibReply", "Thank you."); await sb(x, () => S2.$("[data-inbox-reply] button[type=submit]").click()); await wait(700);
  const sent = lastBody(x, "POST", "/rest/v1/action_messages");
  A("a reply goes in as the member's own message on that case, never a staff-only note", sent && sent.request_id === CASE && sent.author_id === MEMBER.profileId && sent.body === "Thank you." && sent.internal === false, sent);
  await x.p.keyboard.press("Escape"); await wait(400);
  await sb(x, () => S2.$('#page .hqx-msg[data-id^="d-"]').click()); await wait(600);
  r = await sb(x, () => S2.$(".sheet").textContent);
  A("opening a conversation shows it and marks it read through mark_dm_read", /Free Thursday\?/.test(r) && count(x, "POST", "/rest/v1/rpc/mark_dm_read") === 1 && JSON.parse(reqs(x, "POST", "/rest/v1/rpc/mark_dm_read")[0].body).p_other === other, r.slice(0, 80));
  await done(x);
  x = await page("#/you?tab=inbox", { persona: "member", tables: { direct_messages: () => mock.fail("42501", "permission denied for table direct_messages") } }, { expectErrors: /could not be read/ });
  await until(x.p, () => S2.notifs.mineErr, null, 10000); await wait(300);
  r = await sb(x, () => S2.$('#page [data-w="inbox"]').textContent);
  A("a failed read is said with the database's words and Try again, never drawn as nothing here", /could not be read/.test(r) && /permission denied/.test(r) && /Try again/.test(r) && !/Nothing here/.test(r), r);
  /* QA round 2 nit: the Inbox's Try again is an action S2.empty draws in the page's own furniture (a member's You page is a
     workspace, so the app's pill; a public page would get the website button), and pressing it reads again */
  const dms0 = count(x, "GET", "/rest/v1/direct_messages");
  r = await sb(x, () => { const b = S2.$('#page [data-w="inbox"] [data-inbox-retry]'), d = document.createElement("div"); d.innerHTML = S2.empty("err", "t", "", { t: "x", data: { y: "" } });
    const o = { mode: document.documentElement.getAttribute("data-mode"), cls: b && b.className, type: b && b.type, kit: d.querySelector("[data-y]").className }; if (b) b.click(); return o; });
  await wait(600);
  A("the Inbox's Try again is S2.empty's action in the page's furniture (the member's You page is a workspace: the app's pill), and pressing it reads the cases and messages again",
    r.mode === "app" && r.cls === r.kit && r.cls === "btn secondary sm" && r.type === "button" && count(x, "GET", "/rest/v1/direct_messages") > dms0, Object.assign(r, { dms0, dms: count(x, "GET", "/rest/v1/direct_messages") }));
  await done(x);

  console.log("## the league pulse");
  /* Season 1 on screen (a long standings page to scroll); the re-reads are the real ones, a spy keeps what each asked */
  x = await page("?season=1#/standings", { persona: "member", random: 0 });
  await signedIn(x, MEMBER.profileId); await wait(400);
  await sb(x, () => { window.__rr = []; window.__em = []; const read = S2.load.read;
    S2.load.read = function (season, s, ids) { window.__rr.push([s.slice().sort().join(), ids || null]); return read.apply(this, arguments); };
    ["scores", "stats", "codes", "rosters", "picks"].forEach((k) => S2.live.on(k, () => window.__em.push(k)));
    S2.pulse.baseline({ d: { scores: { v: 5 }, stats: { v: 3 }, rosters: { v: 2 }, codes: { v: 1 }, picks: { v: 1 } } }); window.__nav = S2.$("#page").firstElementChild; window.scrollTo(0, 300); });
  const pulse = async (row) => { const k = mock.push(x.ctx, "live_pulse", "UPDATE", Object.assign({ id: 1 }, row)); if (k !== 1) console.log("pulse reached " + k + " channels"); };
  await pulse({ d: { scores: { v: 5 }, stats: { v: 3 } } }); await wait(400);
  A("the baseline itself re-reads nothing", (await sb(x, () => window.__rr.length)) === 0);
  await pulse({ d: { scores: { v: 6 }, stats: { v: 4, log: [[4, ["g1", "g2"]]] } } }); await wait(900);
  r = await sb(x, () => ({ rr: window.__rr, em: window.__em, fresh: S2.$("#page").firstElementChild !== window.__nav, y: window.scrollY }));
  A("a final re-reads games, ratings and only that game's box scores", r.rr.length === 1 && r.rr[0][0] === "box,career,games,ratings" && JSON.stringify(r.rr[0][1]) === '["g1","g2"]', r.rr);
  A("each kind is said on S2.live, and the page repaints in place, scroll kept", r.em.join() === "scores,stats" && r.fresh && Math.abs(r.y - 300) < 2, r);
  await sb(x, () => { window.__rr = []; }); await pulse({ d: { stats: { v: 9, log: [[9, null]] } } }); await wait(900);
  A("a log with no ids (more than 40 games) re-reads the season's box scores", JSON.stringify(await sb(x, () => window.__rr)) === '[["box,career",null]]', await sb(x, () => window.__rr));
  await sb(x, () => { window.__rr = []; window.__vis = "hidden"; }); await pulse({ d: { rosters: { v: 3 } } }); await wait(500);
  r = await sb(x, () => window.__rr.length);
  await sb(x, () => { window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); }); await wait(900);
  A("a hidden tab owes the re-read and does it when looked at again", r === 0 && JSON.stringify(await sb(x, () => window.__rr)) === '[["rosters,tenures",null]]', [r, await sb(x, () => window.__rr)]);
  await sb(x, () => { window.__rr = []; window.__em = []; }); await pulse({ d: { codes: { v: 2 } } }); await wait(500);
  A("lobby codes are said to a signed-in reader (the lobby reads them itself)", (await sb(x, () => window.__em.join())) === "codes");
  await sb(x, () => { window.__rr = []; const i = document.createElement("input"); i.id = "__typing"; S2.$("#page").appendChild(i); i.focus(); window.__pg = S2.$("#page").firstElementChild; });
  await pulse({ d: { scores: { v: 7 } } }); await wait(900);
  r = await sb(x, () => ({ kept: S2.$("#page").firstElementChild === window.__pg && !!document.getElementById("__typing"), rr: window.__rr.length }));
  A("a reader typing is never repainted under: the data is read, the repaint waits", r.kept && r.rr === 1, r);
  await sb(x, () => document.getElementById("__typing").blur()); await wait(1800);
  A("and the owed repaint lands once they are done", await sb(x, () => !document.getElementById("__typing")));
  await sb(x, () => { location.hash = "#/rulebook"; window.__rr = []; }); await wait(400); await pulse({ d: { people: { v: 4 } } }); await wait(500);
  r = await sb(x, () => window.__rr.length);
  await sb(x, () => { location.hash = "#/standings"; }); await wait(2000);
  A("the rulebook reads no league data: the change is owed to the next page", r === 0 && JSON.stringify(await sb(x, () => window.__rr)) === '[["people",null]]', [r, await sb(x, () => window.__rr)]);
  await sb(x, () => { window.__rr = []; S2.M.draft = { state: { status: "live" } }; location.hash = "#/draft"; }); await wait(400);
  await pulse({ d: { rosters: { v: 9 }, picks: { v: 9 } } }); await wait(600);
  A("draft night: the draft room keeps its own pace, its picks are not re-read here", (await sb(x, () => window.__rr.length)) === 0);
  await done(x);
  x = await page("#/standings", { random: 0 });
  await wait(500);
  await sb(x, () => { window.__em = []; S2.live.on("codes", () => window.__em.push("codes")); S2.pulse.baseline({ d: { codes: { v: 1 } } }); });
  mock.push(x.ctx, "live_pulse", "UPDATE", { id: 1, d: { codes: { v: 2 } } }); await wait(500);
  A("a guest is never told about lobby codes (Rule 4.2)", (await sb(x, () => window.__em.length)) === 0);
  A("joining the channel catches up with one read of the one pulse row", count(x, "GET", "/rest/v1/live_pulse") === 1, count(x, "GET", "/rest/v1/live_pulse"));
  await done(x);

  console.log("## QA round 2: the one read door (S2.rd)");
  x = await page("#/standings", { persona: "member", tables: { club_notices: [{ id: "n1", body: "one" }, { id: "n2", body: "two" }] },
    rpcs: { statistical_title_board: mock.fail("57014", "canceling statement due to statement timeout", "slow") } });
  r = await sb(x, async () => {
    const out = {};
    const caught = (pr) => pr.then((d) => ({ ok: d }), (e) => ({ msg: e.message, code: e.code, hint: e.hint, isErr: e instanceof Error }));
    out.rows = await caught(S2.rd((c) => c.from("club_notices").select("id").order("id")));
    out.none = await caught(S2.rd((c) => c.from("club_notices").select("id").eq("id", "nope").maybeSingle()));
    out.noneList = await caught(S2.rd((c) => c.from("club_notices").select("id").eq("id", "nope").maybeSingle(), { list: true }));
    out.refused = await caught(S2.rd((c) => c.rpc("statistical_title_board", { p_season: "x", p_top: 5 })));
    const keep = S2.ensureSb; S2.ensureSb = () => null;
    out.offline = await caught(S2.rd(() => { throw new Error("never asked"); }));
    out.offlineSaid = await caught(S2.rd(() => null, { offline: "Not connected to the league, so the front office can't be read here. Reload the page and try again." }));
    S2.ensureSb = keep;
    return out;
  });
  A("S2.rd answers what the league gave: rows as read, null for no row, and [] for no row when the caller reads a list",
    JSON.stringify(r.rows.ok) === '[{"id":"n1"},{"id":"n2"}]' && r.none.ok === null && JSON.stringify(r.noneList.ok) === "[]", r);
  A("a refusal is an Error carrying the database's message, code and hint", r.refused.isErr && r.refused.msg === "canceling statement due to statement timeout" && r.refused.code === "57014" && r.refused.hint === "slow", r.refused);
  A("no read client is an error, never an empty answer, in the page's own words when it gives them, and nothing is asked",
    r.offline.isErr && r.offline.msg === "Not connected to the league, so this can't be read here. Reload the page and try again." && r.offlineSaid.msg === "Not connected to the league, so the front office can't be read here. Reload the page and try again.", r);
  const liveSrc = fs.readFileSync(path.join(S2_ROOT, "js/live.js"), "utf8");
  A("S2.rd is written in the site's ES5 (var and function, no arrow or let)", /S2\.rd = function \(q, o\) \{[\s\S]*?\n  \};/.test(liveSrc) && !/=>|\blet\b|\bconst\b/.test(/S2\.rd = function \(q, o\) \{[\s\S]*?\n  \};/.exec(liveSrc)[0]));
  await done(x);

  A("no console errors", errors.length === 0, errors.slice(0, 6));
  await browser.close();
  console.log(n + " checks, " + (fails ? fails + " FAILED" : "ALL PASSED"));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
