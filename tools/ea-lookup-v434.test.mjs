// v4.34: the site's EA club search and match lookups run through the bot's server.
// Run: node tools/ea-lookup-v434.test.mjs
//
// Commissioner, 2026-10-29: "Also this box in the staff desk never works. Can you make sure you check regularly that it
// works and functions so I can use it so I dont need to ask you each time?" (the Stats Manager's "Add an EA game");
// asked how the boxes should reach EA, chose "Through the bot's server". EA (behind Akamai) refuses Netlify and
// Supabase and CORS refuses the browser, so the three boxes file a request in public.ea_lookups, the bot's lane
// (bot/ea-lookup.mjs) answers it, and a self-test every 10 minutes feeds the status line, the Automations panel and
// the watchdog. Pinned here: the lane (driven with a fake Supabase, a fake EA and a fake clock), the shared URL
// builder and backoff in the poller, the service wiring, the relay (shared/ea-relay.cjs), the SQL record, the site
// helper (run in a sandbox) and its three boxes, the README and the changelog entry. The two Netlify actions are
// driven end to end in tools/manager-merge.test.mjs and tools/pickup-merge.test.mjs.
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createEaLookup } from "../bot/ea-lookup.mjs";
import { createEaPoller, eaUrl, EA_HEADERS } from "../bot/ea-poll.mjs";
import { createEaPollService } from "../bot/ea-poll-service.mjs";

const require = createRequire(import.meta.url);
const { eaRelay, cleanArg } = require("../shared/ea-relay.cjs");
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });

/* ---- a fake world: Supabase (ea_lookups + app_config), EA, a clock that moves only when the lane sleeps ---- */
function world({ ea, realtime = true } = {}) {
  const W = { T: Date.parse("2026-10-29T23:00:00Z"), rows: [], cfg: {}, eaCalls: [], slept: [], seq: 0, onRow: null, onStatus: null };
  W.now = () => W.T;
  W.sleep = (ms) => { W.slept.push(ms); W.T += ms; return Promise.resolve(); };
  W.ea = ea || (() => J([{ clubId: 1, name: "CGHL Test" }]));
  W.add = (o) => { const row = { id: ++W.seq, kind: "search", arg: "Chel", source: "site", created_at: new Date(W.T).toISOString(), answered_at: null, ok: null, error: null, raw: null, ...o }; W.rows.push(row); return row; };
  W.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || "GET";
    if (u.startsWith("https://proclubs.ea.com/")) { W.eaCalls.push({ url: u, headers: opts.headers, at: W.T }); return W.ea(u); }
    const q = new URL(u).searchParams;
    if (u.includes("/rest/v1/app_config") && m === "POST") { const b = JSON.parse(opts.body); W.cfg[b.key] = b.value; return J(null, 201); }
    if (!u.includes("/rest/v1/ea_lookups")) return J({ message: "unexpected " + u }, 404);
    const cut = () => Date.parse(decodeURIComponent((q.get("created_at") || "").replace(/^(gte|lt)\./, "")));
    if (m === "POST") {
      const row = W.add(JSON.parse(opts.body));
      if (realtime && W.onRow) W.onRow({ ...row });   // Realtime can deliver before the insert's reply
      return J([{ id: row.id }], 201);
    }
    if (m === "PATCH" && q.get("id")) {
      const row = W.rows.find((r) => "eq." + r.id === q.get("id"));
      if (!row || row.answered_at) return J([]);
      Object.assign(row, JSON.parse(opts.body));
      return J([row]);
    }
    if (m === "PATCH") {   // the expiry: unanswered and older than the cutoff
      const t = cut(); const out = [];
      for (const r of W.rows) if (!r.answered_at && Date.parse(r.created_at) < t) { Object.assign(r, JSON.parse(opts.body)); out.push(r); }
      return J(out);
    }
    if (m === "DELETE") { const t = cut(); const n = W.rows.length; W.rows = W.rows.filter((r) => Date.parse(r.created_at) >= t); W.purged = n - W.rows.length; return new Response(null, { status: 204 }); }
    if (q.get("id")) return J(W.rows.filter((r) => "eq." + r.id === q.get("id")));
    const t = cut();
    return J(W.rows.filter((r) => !r.answered_at && Date.parse(r.created_at) >= t));
  };
  W.subscribe = (onRow, onStatus) => { W.onRow = onRow; W.onStatus = onStatus; };
  return W;
}
function lane(W, extra = {}) {
  return createEaLookup({ SB_URL: "https://sb.test", SB_KEY: "k" },
    { fetch: W.fetch, now: W.now, sleep: W.sleep, log: () => {}, subscribe: realtimeOf(W), ...extra });
}
const realtimeOf = (W) => (onRow, onStatus) => W.subscribe(onRow, onStatus);
const fakePoller = (until = 0) => { const P = { held: [], until, holdOff(t) { P.held.push(t); P.until = Math.max(P.until, t); }, blockedUntil() { return P.until; } }; return P; };

console.log("— the shared URL builder (bot/ea-poll.mjs eaUrl): only a club search or a club's matches");
{
  A("a search names the club, encoded", eaUrl("search", "  Chel Gaming & Co ") === "https://proclubs.ea.com/api/nhl/clubs/search?platform=common-gen5&clubName=Chel%20Gaming%20%26%20Co");
  A("a matches lookup is the poller's own club_private URL", eaUrl("matches", "12345", "common-gen5") === "https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=common-gen5&clubIds=12345");
  const refused = (k, a) => { try { eaUrl(k, a); return false; } catch { return true; } };
  A("a club id that is not digits is refused (a row cannot steer the server to another EA path)", refused("matches", "1&matchType=x") && refused("matches", "../x"));
  A("a one-character search, a 41-character one and an unknown kind are refused", refused("search", "C") && refused("search", "x".repeat(41)) && refused("members", "1"));
  A("the score poller builds its URL here too", /const url = eaUrl\("matches", c, platform\);/.test(read("../bot/ea-poll.mjs")));
}

console.log("\n— the poller's 403 backoff is shared with the lane (one address leaves for EA)");
{
  const calls = [];
  const P = createEaPoller({ SB_URL: "https://sb.test", SB_KEY: "k" }, { now: () => 1_000_000, log: () => {},
    fetch: async (u) => { calls.push(String(u)); return J([]); } });
  A("nothing is blocked to begin with", P.blockedUntil() === 0);
  P.holdOff(1_000_000 + 300_000);
  A("holdOff blocks until the given time", P.blockedUntil() === 1_300_000 && P.sum.backoffUntil === new Date(1_300_000).toISOString());
  P.holdOff(1_100_000);
  A("an earlier holdOff never shortens a longer one", P.blockedUntil() === 1_300_000);
  A("the first-cycle seed from the ledger keeps the longer of the two", /backoffUntil = Math\.max\(backoffUntil, t\)/.test(read("../bot/ea-poll.mjs")));
}

console.log("\n— the lane answers a site request with EA's raw answer");
{
  const W = world({ ea: () => J({ "777": { name: "Chel Bruins", clubId: 777 } }) });
  const L = lane(W);
  const row = W.add({ kind: "search", arg: "Chel Bruins" });
  await L.handle({ ...row }, "realtime");
  A("one EA call, to the search URL", W.eaCalls.length === 1 && W.eaCalls[0].url === eaUrl("search", "Chel Bruins"));
  A("...with the poller's browser headers (EA serves by fingerprint)", W.eaCalls[0].headers === EA_HEADERS);
  A("the row carries EA's JSON untouched", row.ok === true && row.raw && row.raw["777"].name === "Chel Bruins" && !!row.answered_at && row.error === null);
  await L.handle({ ...row }, "catch-up");
  A("an answered row is never asked again", W.eaCalls.length === 1);
  A("served counts it", L.sum.served === 1);
}

console.log("\n— a row heard twice (Realtime and the catch-up) is asked once");
{
  const W = world();
  const L = lane(W);
  const row = W.add({});
  await Promise.all([L.handle({ ...row }, "realtime"), L.handle({ ...row }, "catch-up")]);
  A("one EA call", W.eaCalls.length === 1, String(W.eaCalls.length));
}

console.log("\n— pacing: one EA call at a time, at least 1.5 s apart");
{
  const W = world();
  const L = lane(W);
  const a = W.add({ arg: "Alpha" }), b = W.add({ arg: "Bravo" }), c = W.add({ kind: "matches", arg: "4242" });
  await Promise.all([L.handle({ ...a }, "realtime"), L.handle({ ...b }, "realtime"), L.handle({ ...c }, "realtime")]);
  const gaps = W.eaCalls.slice(1).map((x, i) => x.at - W.eaCalls[i].at);
  A("three calls, each at least 1.5 s after the last", W.eaCalls.length === 3 && gaps.every((g) => g >= 1500), gaps.join(","));
  A("all three answered", [a, b, c].every((r) => r.ok === true));
}

console.log("\n— an Akamai 403 pauses the lane AND the box-score poller, and says so in plain words");
{
  const W = world({ ea: () => new Response("<HTML>Access Denied</HTML>", { status: 403 }) });
  const P = fakePoller();
  const L = lane(W, { poller: P });
  const row = W.add({});
  await L.handle({ ...row }, "realtime");
  A("the poller is told to hold off five minutes", P.held.length === 1 && P.held[0] === W.T + 0 + 300_000 - (W.T - W.eaCalls[0].at), String(P.held[0] - W.eaCalls[0].at));
  A("...and the backoff is persisted for a restarted process", W.cfg["rl_ea-poll_backoff"] === new Date(P.held[0]).toISOString());
  A("the row says EA refused the bot server, and until when", row.ok === false && /Akamai 403/.test(row.error) && / ET\./.test(row.error), row.error);
  const next = W.add({ arg: "Later" });
  await L.handle({ ...next }, "realtime");
  A("while blocked, the next request is answered without calling EA", W.eaCalls.length === 1 && next.ok === false && /refusing the bot server until/.test(next.error), next.error);
}

console.log("\n— other failures are sentences too, and never throw out of the lane");
{
  const W = world({ ea: (u) => u.includes("clubIds=999") ? new Response('{"error":"CLUBS_ERR_INVALID_CLUB_ID"}', { status: 400 })
    : u.includes("clubName=Boom") ? Promise.reject(new Error("socket hang up")) : new Response("oops", { status: 500 }) });
  const L = lane(W);
  const gone = W.add({ kind: "matches", arg: "999" }), boom = W.add({ arg: "Boom" }), five = W.add({ arg: "Five" }), bad = W.add({ kind: "matches", arg: "12a" });
  for (const r of [gone, boom, five, bad]) await L.handle({ ...r }, "realtime");
  A("a club id EA no longer knows", gone.ok === false && /no longer exists/.test(gone.error), gone.error);
  A("a dropped connection", boom.ok === false && /EA did not answer \(socket hang up\)/.test(boom.error), boom.error);
  A("an EA 500", five.ok === false && /EA answered 500/.test(five.error), five.error);
  A("a malformed club id is refused without calling EA", bad.ok === false && /EA club id/.test(bad.error) && !W.eaCalls.some((c) => c.url.includes("12a")), bad.error);
}

console.log("\n— bounded: at most 20 waiting, the rest told the server is busy");
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const W = world({ ea: async () => { await gate; return J([]); } });
  const L = lane(W, { maxWaiting: 2 });
  const rows = [1, 2, 3, 4, 5].map((i) => W.add({ arg: "Club" + i }));
  const work = rows.map((r) => L.handle({ ...r }, "realtime"));
  await new Promise((r) => setTimeout(r, 10));
  const busy = rows.filter((r) => r.ok === false && /busy/.test(r.error || ""));
  A("with one in flight and two waiting, the other two are told the server is busy", busy.length === 2, String(busy.length));
  release(); await Promise.all(work); await new Promise((r) => setTimeout(r, 10));
  A("the three it took are answered", rows.filter((r) => r.ok === true).length === 3);
}

console.log("\n— the catch-up answers what Realtime missed, and expires what is too old to matter");
{
  const W = world();
  const L = lane(W);
  const old = W.add({ arg: "Old", created_at: new Date(W.T - 5 * 60_000).toISOString() });
  const fresh = W.add({ arg: "Fresh", created_at: new Date(W.T - 20_000).toISOString() });
  await L.handle({ ...old }, "realtime");
  A("a request older than two minutes is not asked", W.eaCalls.length === 0 && old.answered_at === null);
  const r = await L.catchUp();
  A("the catch-up asks the fresh one", fresh.ok === true && W.eaCalls.length === 1);
  A("...and expires the old one in plain words", old.ok === false && /did not get to this lookup in time/.test(old.error) && r.expired === 1);
  W.add({ arg: "Ancient", created_at: new Date(W.T - 25 * 3600_000).toISOString(), answered_at: new Date(W.T - 25 * 3600_000).toISOString(), ok: true });
  await L.purge();
  A("the hourly purge removes rows older than a day", W.purged === 1 && !W.rows.some((x) => x.arg === "Ancient"));
}

console.log("\n— the self-test: Realtime delivery, EA and the write-back, timed end to end");
{
  const W = world();
  const L = lane(W);
  L.start(); W.onStatus("SUBSCRIBED"); L.stop();   // start registers the feed; stop clears the timers
  const rec = await L.selftest();
  const t = W.rows.find((r) => r.source === "selftest");
  A("it files its own search, marked as the self-test", t && t.kind === "search" && t.arg === "CGHL");
  A("a healthy run records ok with the latency", rec.ok === true && rec.lastError === null && typeof rec.latencyMs === "number");
  A("...stamped where the panel, the watchdog and ea_lookup_health read it", W.cfg["rl_ea-lookup"] && JSON.parse(W.cfg["rl_ea-lookup_result"]).ok === true);
}
{
  const W = world({ realtime: false });
  const L = lane(W);
  L.start(); W.onStatus("CLOSED"); L.stop();
  const r1 = await L.selftest();
  A("Realtime silent: the first failure is a warning, not an alert", r1.ok === true && /Realtime did not deliver/.test(r1.lastError) && !!r1.warning, r1.lastError);
  const r2 = await L.selftest();
  A("...the second in a row turns it red", r2.ok === false && /Realtime did not deliver/.test(r2.lastError));
  A("...and the record says so for the watchdog", JSON.parse(W.cfg["rl_ea-lookup_result"]).ok === false);
}
{
  const W = world({ ea: () => new Response("<HTML>Access Denied</HTML>", { status: 403 }) });
  const L = lane(W, { poller: fakePoller() });
  L.start(); L.stop();
  await L.selftest(); const r = await L.selftest();
  A("EA refusing the bot server fails the self-test with EA's reason", r.ok === false && /refus/.test(r.lastError), r.lastError);
  const W2 = world();
  W2.fetch = ((inner) => async (u, o) => (String(u).includes("ea_lookups") && (o || {}).method === "POST" ? J({ message: "boom" }, 500) : inner(u, o)))(W2.fetch);
  const L2 = lane(W2); L2.start(); L2.stop();
  const r3 = await L2.selftest();
  A("a self-test that cannot even file its request is a failure, never a crash", r3.ok === true && /self-test: POST ea_lookups -> 500/.test(r3.lastError), r3.lastError);
}

console.log("\n— the service hosts the lane beside the poller and hands it the poller");
{
  const seen = {};
  const fakeP = () => ({ start() { seen.p = (seen.p || 0) + 1; }, stop() { seen.ps = 1; }, holdOff() {}, blockedUntil() { return 0; } });
  const S = createEaPollService({ SB_URL: "https://sb.invalid", SB_KEY: "k" }, { createPoller: fakeP, keepaliveMs: 10, log: () => {},
    createLookup: (env, o) => { seen.env = env; seen.o = o; return { start() { seen.l = (seen.l || 0) + 1; }, stop() { seen.ls = 1; } }; },
    subscribe: () => {} });
  A("the lane gets the same env and the poller itself (the shared backoff)", seen.env.SB_KEY === "k" && seen.o.poller === S.poller && typeof seen.o.subscribe === "function");
  S.start(); S.start(); S.stop();
  A("start starts both once; stop stops both", seen.p === 1 && seen.l === 1 && seen.ps === 1 && seen.ls === 1 && S.running() === false);
  const src = read("../bot/ea-poll-service.mjs");
  A("the entry loads supabase-js only for the lane's Realtime feed, and survives without it", /import\("@supabase\/supabase-js"\)/.test(src) && /table: "ea_lookups"/.test(src) && /once-a-minute catch-up answers them/.test(src) && !/^import .*supabase-js/m.test(src));
}

console.log("\n— the relay (shared/ea-relay.cjs): read the bot's answer, else file one request");
{
  const T = Date.parse("2026-10-29T23:00:00Z");
  const mk = (rows) => {
    const D = { posts: [], rows };
    D.get = async (p) => { const q = new URLSearchParams(p.split("?")[1]); return D.rows.filter((r) => (!q.get("id") || q.get("id") === "eq." + r.id) && q.get("kind") === "eq." + r.kind && q.get("arg") === "eq." + r.arg).sort((a, b) => b.id - a.id); };
    D.send = async (m, p, b) => { D.posts.push(b); if (D.fail) throw new Error(D.fail); return [{ id: 99 }]; };
    return D;
  };
  const ago = (ms) => new Date(T - ms).toISOString();
  let D = mk([{ id: 5, kind: "search", arg: "Chel", created_at: ago(30_000), answered_at: ago(29_000), ok: true, raw: [1] }]);
  let r = await eaRelay(D, "search", " Chel ", { now: () => T });
  A("a fresh stored answer is returned, no request filed", r.raw[0] === 1 && r.id === 5 && r.viaAnswer === false && D.posts.length === 0);
  r = await eaRelay(D, "search", "Chel", { now: () => T + 61_000 });
  A("past a minute it files a new request (search results go stale)", r.pending === 99 && D.posts[0].kind === "search" && D.posts[0].arg === "Chel" && D.posts[0].source === "site");
  D = mk([{ id: 7, kind: "matches", arg: "42", created_at: ago(10_000), answered_at: null, ok: null }]);
  r = await eaRelay(D, "matches", "42", { now: () => T });
  A("a young unanswered request for the same question is joined, not duplicated", r.pending === 7 && D.posts.length === 0);
  D = mk([{ id: 8, kind: "search", arg: "Chel", created_at: ago(5_000), answered_at: ago(4_000), ok: false, error: "EA refused the bot server (Akamai 403)." }]);
  let threw = null; try { await eaRelay(D, "search", "Chel", { answerId: 8, now: () => T }); } catch (e) { threw = e.message; }
  A("the answer the browser waited on is read exactly, and a failure is the bot's sentence", threw === "EA refused the bot server (Akamai 403).", threw);
  D = mk([{ id: 9, kind: "search", arg: "Other", created_at: ago(5_000), answered_at: ago(4_000), ok: true, raw: ["secret"] }]);
  r = await eaRelay(D, "search", "Chel", { answerId: 9, now: () => T });
  A("an answer id for a different question is ignored (it files its own)", r.pending === 99);
  D = mk([]); D.fail = 'POST ea_lookups?select=id -> 400 {"code":"23514","message":"EA lookups: that is 20 in ten minutes. Wait a few minutes and try again."}';
  threw = null; try { await eaRelay(D, "search", "Chel", { now: () => T }); } catch (e) { threw = e.message; }
  A("the database's cap reaches the staffer as its own sentence", threw === "that is 20 in ten minutes. Wait a few minutes and try again.", threw);
  const bad = (k, a) => { try { cleanArg(k, a); return null; } catch (e) { return e.message; } };
  A("inputs are checked before anything is filed", /at least 2/.test(bad("search", "x")) && /not an EA club id/.test(bad("matches", "1 OR 1")) && /Unknown EA lookup kind/.test(bad("members", "1")));
  A("the relay never calls EA (the bot is the only EA client)", !/proclubs\.ea\.com\/api|fetch\(/.test(read("../shared/ea-relay.cjs")));
}

console.log("\n— the database record (sql/2026-10-29-ea-lookup-relay-v434.sql)");
{
  const sql = read("../sql/2026-10-29-ea-lookup-relay-v434.sql");
  A("the request table: RLS on, every API role revoked, in Realtime", /create table public\.ea_lookups/.test(sql) && /enable row level security/.test(sql)
    && /revoke all on table public\.ea_lookups from public, anon, authenticated/.test(sql) && /alter publication supabase_realtime add table public\.ea_lookups/.test(sql));
  A("an answer is whole or absent", /check \(\(answered_at is null\) = \(ok is null\)\)/.test(sql));
  A("the guard caps the site (20 per member in 10 minutes, 12 a minute league-wide), never the self-test", />= 20 then/.test(sql) && />= 12 then/.test(sql) && /if new\.source = 'site' then/.test(sql));
  A("the browser reads progress only, never EA's answer", /jsonb_build_object\('pending', l\.answered_at is null, 'ok', l\.ok, 'error', l\.error\)/.test(sql) && !/'raw'/.test(sql.split("create or replace function public.ea_lookup_state")[1].split("$function$;")[0]));
  A("both client functions are signed-in only", /grant execute on function public\.ea_lookup_state\(bigint\) to authenticated/.test(sql) && /grant execute on function public\.ea_lookup_health\(\) to authenticated/.test(sql));
  A("the watchdog alerts on 30 silent minutes, naming the unit to check", /\('ea-lookup', interval '30 minutes'\)/.test(sql) && /systemctl status chel-ea-poll/.test(sql));
  A("rehearsed, applied, audited", /Result: REHEARSAL OK: P1 P2 P3 P4 P5 P6 P7 P8 P9/.test(sql) && /Applied as migration v434_ea_lookup_relay; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
  A("the grant audit's client list carries the two functions", /'ea_lookup_state','ea_lookup_health'/.test(read("../tools/sql/grant-audit.sql")));
}

console.log("\n— the site: one helper waits for the bot, every EA box shows its status");
{
  const live = read("../src/live/part_live.js");
  A("both API callers go through CG.eaPost", /CG\._smLeagueApi = function\(payload\)\{ return CG\.eaPost\("\/api\/ingest-stats", payload\); \};/.test(live)
    && /CG\._smApi = function\(payload\)\{ return CG\.eaPost\("\/api\/pickup-import", payload\); \};/.test(live));
  A("the pickup page uses the same caller", /var api = CG\._smApi;/.test(live));
  const direct = live.match(/fetch\("\/api\/ingest-stats",\{[^]*?body: JSON\.stringify\(\{ [a-zA-Z]+:/g) || [];
  A("no other site code posts an EA action: the one direct ingest-stats call is the archive replay", !/fetch\("\/api\/pickup-import"/.test(live)
    && direct.length === 1 && /\{ reingest:$/.test(direct[0]) && (live.match(/fetch\("\/api\/ingest-stats"/g) || []).length === 1, direct.map((d) => d.slice(-30)).join(" | "));
  A("a status line on all three boxes, painted in place", (live.match(/CG\.eaStatusLine\(\)/g) || []).length === 4
    && /CG\.paintEaStatus\(res\.parentNode\);/.test(live) && /CG\.paintEaStatus\(body\);/.test(live) && /CG\.paintEaStatus\(out\);/.test(live));
  A("the Automations panel lists the lane", /key:"ea-lookup", noRun:true, staleAfterMin:30, name:"EA club search \(bot server\)"/.test(live));

  /* run the helper itself, with a fake session, endpoint and ea_lookup_state */
  const start = live.indexOf("CG.EA_WAIT_MS = 25000;"), end = live.indexOf("/* -- league lag-out merge API");
  const code = live.slice(start, end);
  const mkSandbox = (answers, states) => {
    const posts = [], rpcs = [];
    const CG = { sb: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "tok" } } }) },
      rpc: (fn, a) => { rpcs.push([fn, a]); return Promise.resolve(fn === "ea_lookup_state" ? states.shift() : { data: { state: "working", at: new Date().toISOString(), latencyMs: 900 } }); } },
      fmtAgo: () => "just now" };
    const ctx = { CG, Promise, JSON, Date, Array, Object, setTimeout: (f) => setTimeout(f, 0), document: { querySelectorAll: () => [] },
      fetch: (url, o) => { posts.push({ url, body: JSON.parse(o.body), auth: o.headers.Authorization }); return Promise.resolve({ json: () => Promise.resolve(answers.shift()) }); } };
    vm.runInNewContext(code, ctx);
    return { CG, posts, rpcs };
  };
  let S = mkSandbox([{ eaPending: 41 }, { clubs: [{ clubId: "1", name: "Chel" }] }], [{ data: { pending: true } }, { data: { pending: false, ok: true } }]);
  let o = await S.CG.eaPost("/api/ingest-stats", { leagueEaSearch: { gameId: "g1", clubName: "Chel" } });
  A("ingest-stats: pending, wait, then the same action again with eaLookup on its own object", o.clubs.length === 1 && S.posts.length === 2
    && S.posts[1].body.leagueEaSearch.eaLookup === 41 && S.posts[1].body.leagueEaSearch.clubName === "Chel" && S.rpcs.filter((r) => r[0] === "ea_lookup_state").length === 2, JSON.stringify(S.posts[1].body));
  A("...signed in", S.posts.every((p) => p.auth === "Bearer tok"));
  S = mkSandbox([{ eaPending: 7 }, { matches: [] }], [{ data: { pending: false, ok: false } }]);
  o = await S.CG.eaPost("/api/pickup-import", { action: "matches", clubId: "42" });
  A("pickup-import: eaLookup rides on the payload itself", S.posts[1].body.eaLookup === 7 && S.posts[1].body.action === "matches" && Array.isArray(o.matches));
  S = mkSandbox([{ ok: true }], []);
  o = await S.CG.eaPost("/api/ingest-stats", { leagueMerge: { gameId: "g1", matchIds: ["m1"] } });
  A("an action with no EA in it is one plain post", o.ok === true && S.posts.length === 1 && S.rpcs.length === 0);
  S = mkSandbox([{ eaPending: 3 }], [{ data: null }]);
  let err = null; try { await S.CG.eaPost("/api/pickup-import", { action: "search", clubName: "Chel" }); } catch (e) { err = e.message; }
  A("a lookup that vanished is an error, not a silent empty list", /That EA lookup is gone/.test(err || ""), err);
  S = mkSandbox([{ eaPending: 3 }], Array.from({ length: 5 }, () => ({ data: { pending: true } })));
  S.CG.EA_WAIT_MS = -1;
  err = null; try { await S.CG.eaPost("/api/pickup-import", { action: "search", clubName: "Chel" }); } catch (e) { err = e.message; }
  A("a bot server that never answers is an error naming it", /did not answer within 25 seconds/.test(err || ""), err);
  S = mkSandbox([{ eaPending: 3 }, { eaPending: 4 }, { eaPending: 5 }], [{ data: { pending: false } }, { data: { pending: false } }]);
  err = null; try { await S.CG.eaPost("/api/pickup-import", { action: "search", clubName: "Chel" }); } catch (e) { err = e.message; }
  A("it never loops: two waits at most", /did not settle/.test(err || "") && S.posts.length === 3, err);
}

console.log("\n— the build ships it");
{
  const html = fs.existsSync(new URL("../index.html", import.meta.url)) ? read("../index.html") : "";
  A("index.html carries the helper, the status line and the panel entry", /CG\.eaPost = function/.test(html) && /data-ea-status/.test(html) && /EA club search \(bot server\)/.test(html));
}

console.log("\n— the README and the changelog");
{
  const readme = read("../bot/README.md");
  A("the README documents the lane, its self-test and how to check it", /ea-lookup\.mjs/.test(readme) && /rl_ea-lookup/.test(readme) && /journalctl -u chel-ea-poll \| grep ea-lookup/.test(readme));
  const line = read("../src/live/part3_content.js");
  const rb = JSON.parse(line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1)).rulebook || {};
  const e = (rb.changelog || []).find((c) => c.version === "4.34");
  A("the 4.34 changelog entry exists", !!e);
  const txt = e ? e.summary + " " + e.items.join(" ") : "";
  A("...in plain words: the three boxes, the bot server, the status line, the alert", /Add an EA game/.test(txt) && /bot server/.test(txt) && /status line/.test(txt) && /commissioners/.test(txt));
  A("...house style: no dashes as punctuation", !/[–—]| - /.test(txt));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
