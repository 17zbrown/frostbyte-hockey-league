// The VM-side EA score poller (bot/ea-poll.mjs). Run: node tools/ea-poll-vm.test.mjs
//
// What must never break: EA is only asked when a fixture is due (and never inside a 403 backoff
// or within 90 s of the last poll); one club's failure never costs the others their box scores;
// the same match reported by both clubs reaches ingest once; the ingest hand-off carries the
// service key; the result record says which lane ran and why it failed; and the loop survives a
// cycle that throws. Clock and network are injected — no real timer here runs longer than ~40 ms.
import { createEaPoller, EA_HEADERS } from "../bot/ea-poll.mjs";
import fs from "node:fs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* ---- stubbed world ---- */
const env = { SB_URL: "https://sb.invalid", SB_KEY: "service-role-key-123" };
let T = Date.parse("2026-09-16T23:30:00Z");                 // a Wednesday night, mid game window
const now = () => T;
const advance = (ms) => { T += ms; };
/* a match between the two clubs of tonight's fixture that ENDED 40 minutes after puck drop
   (inside the fixture's window) unless told otherwise */
const PUCK = Date.parse("2026-09-16T23:00:00Z");          // tonight's fixture: 7:00 PM ET
const M = (id, ts, home = 111, away = 222) => ({ matchId: id, timestamp: ts || Math.floor((PUCK + 40 * 60_000) / 1000), clubs: { [home]: { score: 3 }, [away]: { score: 2 } } });
const FIXTURE = { id: "g1", home_team_id: "tA", away_team_id: "tB", scheduled_at: new Date(PUCK).toISOString() };

const world = {
  due: [FIXTURE],
  dueThrows: false,
  clubs: [{ id: "tA", ea_club_id: 111 }, { id: "tB", ea_club_id: 222 }, { id: "tA", ea_club_id: 111 }],   // 111 twice: must poll once
  ea: {},                                     // clubId -> array | () => Response
  ingestReply: { ingested: [{ ea_match_id: "m1" }], unmatched: [], skipped: [], errors: [] },
  ingestStatus: 200,
  ingestThrows: false,
};
const calls = [];          // ordered log of every fetch
const cfg = {};            // app_config upserts, latest value per key
const cfgWrites = [];      // every app_config upsert, in order
const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
const F = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  if (u.includes("proclubs.ea.com")) {
    calls.push({ kind: "ea", url: u, opts });
    const id = (u.match(/clubIds=(\d+)/) || [])[1];
    const h = world.ea[id];
    if (typeof h === "function") return h();
    return J(h || []);
  }
  if (u.includes("/api/ingest-stats")) {
    calls.push({ kind: "ingest", url: u, opts });
    if (world.ingestThrows) throw new Error("ECONNRESET");
    return J(world.ingestReply, world.ingestStatus);
  }
  if (u.includes("/rest/v1/app_config") && m === "POST") {
    const b = JSON.parse(opts.body);
    cfg[b.key] = b.value;
    cfgWrites.push({ key: b.key, value: b.value, prefer: opts.headers.Prefer });
    calls.push({ kind: "cfg", key: b.key });
    return new Response(null, { status: 201 });
  }
  if (u.includes("/rest/v1/games")) {
    calls.push({ kind: "due", url: u, opts });
    if (world.dueThrows) return new Response("upstream connect error", { status: 503 });
    return J(world.due);
  }
  if (u.includes("/rest/v1/teams")) { calls.push({ kind: "clubs", url: u }); return J(world.clubs); }
  throw new Error("unexpected fetch " + u);
};
const mk = (over) => createEaPoller(env, { fetch: F, now, sleep: async () => {}, log: () => {}, ...over });
const eaCalls = () => calls.filter((c) => c.kind === "ea");
const ingestCalls = () => calls.filter((c) => c.kind === "ingest");
const resultWrites = () => cfgWrites.filter((w) => w.key === "rl_ea-poll_result");
const lastResult = () => JSON.parse(cfg["rl_ea-poll_result"]);
const reset = () => {
  calls.length = 0; cfgWrites.length = 0;
  for (const k of Object.keys(cfg)) delete cfg[k];
  world.due = [FIXTURE]; world.dueThrows = false;
  world.clubs = [{ id: "tA", ea_club_id: 111 }, { id: "tB", ea_club_id: 222 }, { id: "tA", ea_club_id: 111 }];
  world.ea = { 111: [M("m1"), M("m2")], 222: [M("m2"), M("m3")] };
  world.ingestReply = { ingested: [{ ea_match_id: "m1" }], unmatched: [{ ea_match_id: "m2" }], skipped: [], errors: [] };
  world.ingestStatus = 200; world.ingestThrows = false;
};

console.log("— idle: no fixture due, so EA is never asked");
{
  reset(); world.due = [];
  const P = mk();
  const r = await P.runOnce();
  A("the cycle reports the skip", r && r.skipped === "no fixture in its game window", r && r.skipped);
  A("no EA call", eaCalls().length === 0);
  A("no ingest call", ingestCalls().length === 0);
  A("the heartbeat rl_ea-poll-vm is stamped with the injected clock", cfg["rl_ea-poll-vm"] === new Date(T).toISOString());
  const hb = cfgWrites.find((w) => w.key === "rl_ea-poll-vm");
  A("...as a merge-duplicates upsert", hb && hb.prefer === "resolution=merge-duplicates");
  const due = calls.find((c) => c.kind === "due");
  A("the gate asks for fixtures (scheduled OR already final — a replay still has to be collected; ruled or voided ones too, so what was played is archived) whose game window plus the fetching grace holds now (puck drop within [now-3h15, now+10min])",
    due && due.url.includes("status=in.(scheduled,final)") && !due.url.includes("voided=") && !due.url.includes("forfeit_team_id=")
      && !due.url.includes("ea_match_id=is.null") && due.url.includes("select=id,home_team_id,away_team_id,scheduled_at,status,ea_match_id")
      && due.url.includes("scheduled_at=gte." + encodeURIComponent(new Date(T - (3 * 3600e3 + 15 * 60e3)).toISOString()))
      && due.url.includes("scheduled_at=lte." + encodeURIComponent(new Date(T + 10 * 60e3).toISOString())), due && due.url);
  A("...with the service key", due && due.opts.headers.apikey === env.SB_KEY && due.opts.headers.Authorization === `Bearer ${env.SB_KEY}`);
  const res = lastResult();
  A("the idle result is written once: ok, lane vm, 'no fixture in its game window'",
    resultWrites().length === 1 && res.ok === true && res.lane === "vm" && res.skipped === "no fixture in its game window" && res.at === new Date(T).toISOString());
  advance(60_000);
  await P.runOnce();
  A("a minute later the heartbeat is stamped again", cfg["rl_ea-poll-vm"] === new Date(T).toISOString());
  A("...but the idle result is NOT rewritten within 30 minutes", resultWrites().length === 1);
  advance(29 * 60_000);
  await P.runOnce();
  A("...and is rewritten once 30 minutes have passed", resultWrites().length === 2);
  A("rl_ea-poll (the real-poll marker) is never touched while idle", cfg["rl_ea-poll"] === undefined);
  A("no EA call across all three idle cycles", eaCalls().length === 0);
}

console.log("\n— due: one EA call per linked club, deduped matches, one ingest hand-off");
{
  reset();
  const P = mk();
  const r = await P.runOnce();
  A("EA is called once per DISTINCT linked club (111 listed twice → 2 calls)", eaCalls().length === 2, `calls=${eaCalls().length}`);
  const clubQ = calls.find((c) => c.kind === "clubs");
  A("...and only for the clubs IN the open fixtures (teams?id=in.(tA,tB)), never every linked club",
    clubQ && /teams\?id=in\.\(tA,tB\)&ea_club_id=not\.is\.null&select=id,ea_club_id/.test(clubQ.url), clubQ && clubQ.url);
  const urls = eaCalls().map((c) => c.url);
  A("the URL is the Netlify poller's, verbatim",
    urls[0] === "https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=common-gen5&clubIds=111"
      && urls[1] === "https://proclubs.ea.com/api/nhl/clubs/matches?matchType=club_private&platform=common-gen5&clubIds=222", urls.join(" | "));
  const h = eaCalls()[0].opts.headers;
  A("the browser fingerprint rides on every EA call",
    h["User-Agent"] === EA_HEADERS["User-Agent"] && h.Referer === "https://www.ea.com/" && h.Origin === "https://www.ea.com"
      && h["sec-ch-ua"] && h["sec-fetch-site"] === "same-site" && h["Accept-Language"] === "en-US,en;q=0.9");
  A("...with an abort signal (a hung EA socket cannot stall the cycle)", eaCalls()[0].opts.signal instanceof AbortSignal);
  A("one ingest call", ingestCalls().length === 1);
  const ing = ingestCalls()[0];
  A("ingest goes to the live site endpoint", ing.url === "https://chelgamingleague.com/api/ingest-stats");
  A("...as a JSON POST", ing.opts.method === "POST" && ing.opts.headers["Content-Type"] === "application/json");
  A("...carrying x-ingest-key = env.SB_KEY (the service key IS the ingest key now)", ing.opts.headers["x-ingest-key"] === env.SB_KEY);
  const body = JSON.parse(ing.opts.body);
  A("the body is {matches:[...]} with the raw EA objects", Array.isArray(body.matches) && body.matches[0].clubs && body.matches[0].timestamp);
  A("matches deduped by matchId (m1, m2, m3 — m2 seen from both clubs, sent once)",
    body.matches.length === 3 && body.matches.map((m) => m.matchId).sort().join() === "m1,m2,m3", body.matches.map((m) => m.matchId).join());
  A("rl_ea-poll is stamped after a real poll", cfg["rl_ea-poll"] === new Date(T).toISOString());
  const res = lastResult();
  A("the result record: lane vm, ok, counts from the ingest reply",
    res.lane === "vm" && res.ok === true && res.polled === 2 && res.matches === 3 && res.ingest === 200
      && res.ingested === 1 && res.unmatched === 1 && res.skipped === 0 && res.errors === 0 && res.errCount === 0 && res.lastError === null,
    JSON.stringify(res));
  A("runOnce returns the same summary", r.ok === true && r.polled === 2 && r.matches === 3 && r.ingested === 1 && r.lane === "vm");
  A("sum reflects the poll for the heartbeat", P.sum.live === true && P.sum.polls === 1 && P.sum.matches === 3 && P.sum.ingested === 1
      && P.sum.lastPollAt === new Date(T).toISOString() && P.sum.lastError === null && P.sum.backoffUntil === null, JSON.stringify(P.sum));
  A("the fingerprint is the Netlify poller's, byte for byte (KEEP IN SYNC)", (() => {
    const src = fs.readFileSync(new URL("../netlify/functions/ea-poll.js", import.meta.url), "utf8");
    const ua = (src.match(/const UA = "([^"]+)"/) || [])[1];
    const chua = (src.match(/"sec-ch-ua": ('[^']+')/) || [])[1];
    return ua === EA_HEADERS["User-Agent"] && chua && chua.slice(1, -1) === EA_HEADERS["sec-ch-ua"];
  })());
}

console.log("\n— a club that fails never costs the others their box scores");
{
  reset();
  world.ea[111] = () => { throw new Error("socket hang up"); };
  world.ea[222] = [M("m3")];
  const P = mk();
  const r = await P.runOnce();
  A("both clubs were attempted", eaCalls().length === 2);
  A("the surviving club's match still reaches ingest", ingestCalls().length === 1 && JSON.parse(ingestCalls()[0].opts.body).matches.map((m) => m.matchId).join() === "m3");
  const res = lastResult();
  A("the run is NOT ok, with the club error as lastError", res.ok === false && res.errCount === 1 && /club 111: socket hang up/.test(res.lastError), res.lastError);
  A("...and the ingest counts are still recorded", res.ingest === 200 && res.matches === 1 && r.clubErrors.length === 1);
  A("sum.lastError carries it for the heartbeat", /socket hang up/.test(P.sum.lastError));
}

console.log("\n— a 403 is named, fails the run, and backs EA off for five minutes");
{
  reset();
  world.ea[111] = () => new Response("<html>Access Denied</html>", { status: 403 });
  world.ea[222] = [M("m3")];
  const P = mk();
  await P.runOnce();
  A("the other club is still polled in the same cycle", eaCalls().length === 2);
  const res = lastResult();
  A("ok false, lastError names the Akamai block", res.ok === false && /club 111: EA blocked the request \(Akamai 403\)/.test(res.lastError), res.lastError);
  A("the survivor's match still went to ingest", ingestCalls().length === 1);
  A("sum.backoffUntil = now + 5 min", P.sum.backoffUntil === new Date(T + 5 * 60_000).toISOString(), P.sum.backoffUntil);
  calls.length = 0;
  advance(120_000);                                          // past the 90-s spacing, inside the backoff
  const r2 = await P.runOnce();
  A("the next cycle makes NO EA call", eaCalls().length === 0 && /backoff/.test(r2.skipped), r2.skipped);
  A("...but still heartbeats", calls.some((c) => c.kind === "cfg" && c.key === "rl_ea-poll-vm"));
  A("...and force does not override a 403 backoff either", (await P.runOnce({ force: true })).skipped && eaCalls().length === 0);
  world.ea[111] = [M("m9")];
  advance(4 * 60_000);                                       // 6 min after the 403
  calls.length = 0;
  const r3 = await P.runOnce();
  A("after five minutes EA is polled again", eaCalls().length === 2 && r3.polled === 2);
  A("...and a clean run clears the backoff and the error", P.sum.backoffUntil === null && P.sum.lastError === null && lastResult().ok === true);
}

console.log("\n— an expired backoff clears from the heartbeat even when no poll follows");
{
  reset();
  world.ea[111] = () => new Response("Access Denied", { status: 403 });
  const P = mk();
  await P.runOnce();
  A("the 403 sets a backoff", P.sum.backoffUntil === new Date(T + 5 * 60_000).toISOString());
  world.due = [];                                              // a quiet stretch: idle cycles, no poll
  advance(2 * 60_000);
  await P.runOnce();
  A("inside the window an idle cycle still reports it", P.sum.backoffUntil === new Date(T - 2 * 60_000 + 5 * 60_000).toISOString());
  advance(4 * 60_000);
  await P.runOnce();
  A("once it has expired, an idle cycle reports no backoff — without any poll having run", P.sum.backoffUntil === null && eaCalls().length === 2);
}

console.log("\n— the other failure classes are named, and do not back off");
{
  reset();
  world.ea[111] = () => new Response(JSON.stringify({ error: "CLUBS_ERR_INVALID_CLUB_ID" }), { status: 404 });
  const P = mk();
  await P.runOnce();
  A("a dead club id says so and asks for a re-link", /club 111: EA says this club id no longer exists/.test(lastResult().lastError) && /Re-link/.test(lastResult().lastError));
  A("...without a backoff", P.sum.backoffUntil === null);
  reset();
  world.ea[222] = () => new Response("bad gateway", { status: 502 });
  const P2 = mk();
  await P2.runOnce();
  A("a 5xx reads as transient", /club 222: EA 502 \(transient\?\)/.test(lastResult().lastError), lastResult().lastError);
  A("...without a backoff", P2.sum.backoffUntil === null);
  A("...and the good club's matches still ingest", ingestCalls().length === 1);
}

console.log("\n— ingest outcomes decide ok");
{
  reset(); world.ingestStatus = 500; world.ingestReply = {};
  const P = mk();
  await P.runOnce();
  let res = lastResult();
  A("an ingest 500 fails the run with 'ingest HTTP 500'", res.ok === false && res.ingest === 500 && res.lastError === "ingest HTTP 500", JSON.stringify(res));
  reset(); world.ingestReply = { ingested: [], unmatched: [], skipped: [], errors: [{ ea_match_id: "m1", error: "boom in ingestOne" }] };
  const P2 = mk();
  await P2.runOnce();
  res = lastResult();
  A("an ingest error entry fails the run and surfaces the reason", res.ok === false && res.errors === 1 && res.errCount === 1 && res.lastError === "boom in ingestOne");
  reset(); world.ingestThrows = true;
  const P3 = mk();
  const r = await P3.runOnce();
  res = lastResult();
  A("an ingest transport failure is recorded, not thrown", res.ok === false && res.ingest === null && /^ingest: ECONNRESET/.test(res.lastError) && r.ok === false);
  reset(); world.ea = { 111: [], 222: [] };
  const P4 = mk();
  const r4 = await P4.runOnce();
  A("no matches: no ingest call, still ok, still stamped", ingestCalls().length === 0 && r4.ok === true && lastResult().ok === true && lastResult().matches === 0 && cfg["rl_ea-poll"]);
}

console.log("\n— force bypasses the due gate only");
{
  reset(); world.due = [];
  const P = mk();
  await P.runOnce();
  A("without force, no EA call", eaCalls().length === 0);
  const r = await P.runOnce({ force: true });
  A("with force, EA is polled although nothing is due", eaCalls().length === 2 && r.polled === 2 && r.fixtureDue === false);
  A("...and the result is a real poll record, not the idle stamp", lastResult().polled === 2 && lastResult().skipped === 0);
  A("...and with no fixture in window every match found is counted offWindow (the importer will refuse them all)",
    r.matches === 3 && r.offWindow === 3 && r.fixturesOpen === 0, JSON.stringify(r));
}

console.log("\n— never more than one EA poll per 90 s");
{
  reset();
  const P = mk();
  await P.runOnce();
  A("first cycle polls", eaCalls().length === 2);
  advance(30_000);
  const r = await P.runOnce();
  A("30 s later: skipped, no EA call", eaCalls().length === 2 && r.skipped === "polled moments ago", r.skipped);
  advance(59_000);
  await P.runOnce();
  A("89 s later: still skipped", eaCalls().length === 2);
  advance(1_000);
  await P.runOnce();
  A("at 90 s: polled again", eaCalls().length === 4 && P.sum.polls === 2);
  A("the heartbeat was stamped on every one of the four cycles", cfgWrites.filter((w) => w.key === "rl_ea-poll-vm").length === 4);
}

console.log("\n— no linked club is a red result, not a quiet skip");
{
  reset(); world.clubs = [];
  const P = mk();
  const r = await P.runOnce();
  A("no EA call, no ingest", eaCalls().length === 0 && ingestCalls().length === 0);
  A("ok false, with the fix in the message", lastResult().ok === false && /EA club linked|ea_club_id/.test(lastResult().lastError) && r.ok === false, lastResult().lastError);
}

console.log("\n— the loop survives a cycle that throws");
{
  reset(); world.dueThrows = true;
  const logs = [];
  const P = mk({ cycleMs: 4, log: (s) => logs.push(String(s)) });
  P.start();
  await new Promise((r) => setTimeout(r, 40));
  const failedCycles = calls.filter((c) => c.kind === "due").length;
  A("cycles keep running after a throw", failedCycles >= 2, `cycles=${failedCycles}`);
  A("the failure is logged with the ea-poll: prefix", logs.some((s) => /^ea-poll: cycle failed — GET games -> 503/.test(s)), logs[0]);
  A("...and recorded red for the watchdog", lastResult().ok === false && /503/.test(lastResult().lastError));
  A("sum.lastError carries it", /503/.test(P.sum.lastError));
  world.dueThrows = false; world.due = [];
  await new Promise((r) => setTimeout(r, 30));
  A("once the database answers again the cycle goes through", calls.some((c) => c.kind === "due") && lastResult().skipped === "no fixture in its game window");
  P.stop();
  A("stop() marks the lane not live", P.sum.live === false);
  const after = calls.length;
  await new Promise((r) => setTimeout(r, 20));
  A("...and nothing runs after stop", calls.length === after);
  A("start() is idempotent", (P.start(), P.start(), true));
  P.stop();
  /* stop() clears the timer; the cycle that start() kicked off is still in flight and must be
     let drain, or its calls leak into the next block's log */
  await new Promise((r) => setTimeout(r, 10));
}

console.log("\n— a slow cycle never overlaps the next");
{
  reset();
  let release;
  world.ea[111] = () => new Promise((r) => { release = () => r(J([M("m1")])); });
  const P = mk({ cycleMs: 3 });
  P.start();
  await new Promise((r) => setTimeout(r, 30));
  A("one cycle is in flight while EA is slow", eaCalls().length === 1 && calls.filter((c) => c.kind === "due").length === 1);
  release();
  await new Promise((r) => setTimeout(r, 10));
  P.stop();
  A("...and it completes normally", ingestCalls().length === 1);
}

console.log("\n— wired into the gateway bot");
{
  const src = fs.readFileSync(new URL("../bot/chel-bot.mjs", import.meta.url), "utf8");
  A("chel-bot imports the poller", /import \{ createEaPoller \} from "\.\/ea-poll\.mjs"/.test(src));
  A("...creates it from the shared env and starts it", /const EA = createEaPoller\(env, \{ log: console\.log \}\);\s*\n\s*EA\.start\(\);/.test(src));
  A("...only after the env check", src.indexOf("EA.start()") > src.indexOf("check /etc/chel-bot.env"));
  A("...and reports its counters in the heartbeat extra", /eaPoll: EA\.sum/.test(src));
  const poller = fs.readFileSync(new URL("../bot/ea-poll.mjs", import.meta.url), "utf8");
  A("the poller has no discord.js or supabase-js dependency", !/from "discord\.js"|from "@supabase/.test(poller));
  A("...and stays on plain global fetch — no undici, no proxy (the VM reaches EA directly)", !/from "undici"|ProxyAgent|HTTPS_PROXY/.test(poller));
  A("the interval is unref'd", /timer\.unref\(\)/.test(poller));
}

console.log("\n— everything found for the fixture's clubs is forwarded; the importer is the one place that files");
{
  reset();
  const minAfter = (n) => Math.floor((PUCK + n * 60_000) / 1000);
  world.clubs = [{ id: "tA", ea_club_id: 111 }, { id: "tB", ea_club_id: 222 }];
  world.ea = {
    111: [M("real", minAfter(38)),                         // tonight's game, ended 38 min after puck drop
          M("scrim", minAfter(-300)),                      // the same two clubs, a scrimmage that afternoon
          M("late", minAfter(185)),                        // a rematch after the window
          M("wrong-pair", minAfter(40), 111, 333)],        // tA vs a club not in tonight's fixtures
    222: [M("real", minAfter(38)), M("early", minAfter(-11))],
  };
  const P = mk();
  const r = await P.runOnce();
  const body = JSON.parse(ingestCalls()[0].opts.body);
  A("all five distinct matches reach the importer (its archive and its Rule 4.3 merge need the whole history)",
    ingestCalls().length === 1 && body.matches.map((m) => m.matchId).sort().join() === "early,late,real,scrim,wrong-pair", JSON.stringify(body.matches.map((m) => m.matchId)));
  A("the record says how many the importer is expected to refuse: 4 of 5 are outside any fixture's window or not a matchup",
    r.matches === 5 && r.offWindow === 4, JSON.stringify(r));
  A("the result record carries the counts and the fixture tally", lastResult().offWindow === 4 && lastResult().fixturesOpen === 1 && lastResult().matches === 5);
}

console.log("\n— a night with two fixtures: only the four clubs playing are asked, and an unlinked club is flagged");
{
  reset();
  const minAfter = (n) => Math.floor((PUCK + n * 60_000) / 1000);
  world.due = [FIXTURE, { id: "g2", home_team_id: "tC", away_team_id: "tD", scheduled_at: new Date(PUCK).toISOString() }];
  world.clubs = [{ id: "tA", ea_club_id: 111 }, { id: "tB", ea_club_id: 222 }, { id: "tC", ea_club_id: 333 }];   // tD has no EA club
  world.ea = { 111: [M("ab", minAfter(35))], 222: [M("ab", minAfter(35))], 333: [M("cd", minAfter(41), 333, 444)] };
  const P = mk();
  const r = await P.runOnce();
  A("three clubs polled (the linked ones among the four playing)", eaCalls().length === 3 && r.polled === 3);
  const clubQ = calls.find((c) => c.kind === "clubs");
  A("...requested by fixture team ids", clubQ && /teams\?id=in\.\(tA,tB,tC,tD\)/.test(clubQ.url), clubQ && clubQ.url);
  A("the unlinked club is named in a warning on the record — ok stays true", r.ok === true && r.unlinkedInFixtures === 1 && /no EA club linked/.test(r.warning), JSON.stringify(r));
}

console.log("\n— a fixture a first sitting has already filed stays in the poll set until its window closes (the replay still has to be collected)");
{
  reset();
  world.due = [{ ...FIXTURE, status: "final", ea_match_id: "first-sitting" }];
  const P = mk();
  const r = await P.runOnce();
  A("EA is still asked for its clubs, and its matches are forwarded", eaCalls().length === 2 && r.polled === 2 && r.fixtureDue === true && r.matches === 3 && r.offWindow === 0, JSON.stringify(r));
}

console.log("\n— the one-shot's --help names the window so the operator knows what it will and will not do");
{
  const src = fs.readFileSync(new URL("../bot/ea-poll.mjs", import.meta.url), "utf8");
  A("the usage text derives the window from the shared definition", /describeWindow\(\)/.test(src) && /shared\/game-window\.cjs/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
