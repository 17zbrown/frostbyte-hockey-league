// v4.35: follow-ups to the v4.34 EA lookup relay, from the adversarial review of 29b6b83.
// Run: node tools/ea-lookup-v435.test.mjs
//
// 1. A 403 on a site lookup paused the box-score poller for five minutes, and the text that could draw it came from a
//    member (Akamai can refuse one request for its content, not the address). Now a lookup's 403 pauses only the
//    lookups, the poller is never told, and search text is held to plain characters before it leaves the VM (one
//    definition, cleanArg in shared/ea-relay.cjs, used by the Netlify relay and the bot's eaUrl).
// 2. After one failed self-test the status line still said "working" while the Automations panel showed amber; now
//    the box shows amber too.
// 3. On the club game stats desk, a link that succeeded followed by a pull that failed while waiting on the bot left
//    the "Find your club on EA" setup card up; now the desk always repaints once the link is written.
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createEaLookup } from "../bot/ea-lookup.mjs";
import { eaUrl } from "../bot/ea-poll.mjs";

const require = createRequire(import.meta.url);
const { eaRelay, cleanArg, CLUB_NAME_OK } = require("../shared/ea-relay.cjs");
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });

/* a small world: the lane's write-back, app_config and EA, with a clock that moves only when the lane sleeps */
function world(ea) {
  const W = { T: Date.parse("2026-10-29T23:00:00Z"), rows: [], cfg: {}, eaCalls: [], seq: 0 };
  W.add = (o) => { const r = { id: ++W.seq, kind: "search", arg: "Chel", source: "site", created_at: new Date(W.T).toISOString(), answered_at: null, ok: null, error: null, raw: null, ...o }; W.rows.push(r); return r; };
  W.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || "GET";
    if (u.startsWith("https://proclubs.ea.com/")) { W.eaCalls.push(u); return ea(u); }
    if (u.includes("/rest/v1/app_config") && m === "POST") { const b = JSON.parse(opts.body); W.cfg[b.key] = b.value; return J(null, 201); }
    if (u.includes("/rest/v1/ea_lookups") && m === "PATCH") {
      const q = new URL(u).searchParams, row = W.rows.find((r) => "eq." + r.id === q.get("id"));
      if (!row || row.answered_at) return J([]);
      Object.assign(row, JSON.parse(opts.body)); return J([row]);
    }
    return J([]);
  };
  W.lane = (extra) => createEaLookup({ SB_URL: "https://sb.test", SB_KEY: "k" },
    { fetch: W.fetch, now: () => W.T, sleep: (ms) => { W.T += ms; return Promise.resolve(); }, log: () => {}, ...extra });
  return W;
}

console.log("— 1. a lookup's 403 pauses only the lookups, never the box-score poller");
{
  const W = world(() => new Response("<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>", { status: 403 }));
  const poller = { told: [], holdOff(t) { poller.told.push(t); }, blockedUntil: () => 0 };
  const L = W.lane({ poller });
  const row = W.add({});
  await L.handle({ ...row }, "realtime");
  A("the poller is never told (even one that would listen)", poller.told.length === 0);
  A("...and no backoff is persisted where the poller seeds its own", !("rl_ea-poll_backoff" in W.cfg));
  A("the staffer reads that EA search paused and box scores did not", row.ok === false && /EA search pauses until .* ET; box-score imports are not paused by it\./.test(row.error), row.error);
  const next = W.add({ arg: "Next Club" });
  await L.handle({ ...next }, "realtime");
  A("lookups stay paused for five minutes without calling EA", W.eaCalls.length === 1 && next.ok === false);
  W.T += 5 * 60_000 + 1;
  const later = W.add({ arg: "Later Club" });
  await L.handle({ ...later }, "realtime");
  A("...and resume after", W.eaCalls.length === 2);
  const lane = read("../bot/ea-lookup.mjs"), poll = read("../bot/ea-poll.mjs");
  A("the lane holds no door into the poller's backoff", !/holdOff|rl_ea-poll_backoff/.test(lane.replace(/^\/\/.*$/gm, "")));
  A("the poller has no holdOff at all; only its own 403 sets its backoff", !/function holdOff|holdOff,/.test(poll) && /return \{ start, stop, runOnce, tick, sum, blockedUntil \};/.test(poll));
}

console.log("\n— 1b. search text is plain characters, checked once for both sides, before it reaches EA");
{
  const attacks = ["<script>alert(1)</script>", "x' OR 1=1", "a;b", "../../etc", "${7*7}", "%3Cscript", "a|b", "name\"x"];
  A("attack-shaped text is refused by the one definition", attacks.every((a) => { try { cleanArg("search", a); return false; } catch (e) { return /club's name only/.test(e.message); } }));
  const names = ["CGHL", "Chel Gaming's #1", "Les Canadiens Montréal", "St. Louis Blues", "Bruins & Co.", "Team_7", "Go Go Go!", "The Bruins, Inc", "Club: Reborn", "Chel Gaming’s Best"];
  A("real club-name shapes pass (apostrophes, #, accents, &, periods, commas)", names.every((n) => { try { cleanArg("search", n); return true; } catch { return false; } }));
  A("the bot's eaUrl uses it (nothing else is put on the wire)", /import \{ cleanArg \} from "\.\.\/shared\/ea-relay\.cjs";/.test(read("../bot/ea-poll.mjs")) && /const a = cleanArg\(kind, arg\);/.test(read("../bot/ea-poll.mjs")));
  let threw = null; try { eaUrl("search", "<script>alert(1)</script>"); } catch (e) { threw = e.message; }
  A("...so eaUrl refuses it with the same sentence", /club's name only/.test(threw || ""), threw);
  A("club ids are still digits only, and the poller's own club ids still build", eaUrl("matches", "123456").endsWith("clubIds=123456"));
  const W = world(() => J([]));
  const L = W.lane({ poller: { blockedUntil: () => 0 } });
  const row = W.add({ arg: "<script>alert(1)</script>" });
  await L.handle({ ...row }, "realtime");
  A("a row that somehow carries such text is answered by the bot without calling EA", W.eaCalls.length === 0 && row.ok === false && /club's name only/.test(row.error), row.error);
  const D = { posts: [], get: async () => [], send: async (m, p, b) => { D.posts.push(b); return [{ id: 1 }]; } };
  threw = null; try { await eaRelay(D, "search", "<b>Chel</b>", {}); } catch (e) { threw = e.message; }
  A("the Netlify relay refuses it before filing anything", /club's name only/.test(threw || "") && D.posts.length === 0, threw);
  A("a pasted non-breaking space or tab is a plain space, not a refusal", cleanArg("search", " Chel\u00a0Gaming\tBlades ") === "Chel Gaming Blades");
  A("the pattern is a whitelist with the Unicode flag (letters in any language)", CLUB_NAME_OK.unicode === true && CLUB_NAME_OK.test("Ærø Ålborg"));
}

console.log("\n— 2. the status line shows a failed self-test the way the Automations panel does");
{
  const live = read("../src/live/part_live.js");
  const code = live.slice(live.indexOf("CG.EA_WAIT_MS = 25000;"), live.indexOf("/* -- league lag-out merge API"));
  const paint = async (health) => {
    const el = { firstChild: { style: {} }, lastChild: { textContent: "" } };
    const CG = { sb: { rpc: () => Promise.resolve({ data: health }) }, fmtAgo: () => "3 min ago" };
    vm.runInNewContext(code, { CG, Promise, JSON, Date, Array, Object, setTimeout, document: { querySelectorAll: () => [el] } });
    CG.paintEaStatus();
    await new Promise((r) => setTimeout(r, 5));
    return el;
  };
  const at = new Date().toISOString();
  let el = await paint({ state: "working", at, error: "EA refused this lookup (Akamai 403).", latencyMs: null });
  A("one failed test: amber, the reason, and what happens next", el.firstChild.style.background === "var(--amber-ink)" && /last EA test failed: EA refused this lookup/.test(el.lastChild.textContent) && /alerts the commissioners/.test(el.lastChild.textContent), el.lastChild.textContent);
  el = await paint({ state: "working", at, error: null, latencyMs: 1026 });
  A("a passing test: green, when, and how fast", el.firstChild.style.background === "var(--green)" && /working\. The bot server tested it 3 min ago \(answered in 1 s\)/.test(el.lastChild.textContent), el.lastChild.textContent);
  el = await paint({ state: "failing", at, error: "EA did not answer the self-test within 20 s.", latencyMs: null });
  A("two in a row: red", el.firstChild.style.background === "var(--red)" && /not working right now/.test(el.lastChild.textContent));
  el = await paint({ state: "silent", at: null, error: null, latencyMs: null });
  A("no test for 30 minutes: amber, the server may be down", el.firstChild.style.background === "var(--amber-ink)" && /not been tested in over 30 minutes/.test(el.lastChild.textContent));
  el = await paint(null);
  A("no answer at all: gray and says so, never green", el.firstChild.style.background === "var(--chrome-deep)" && /unavailable/.test(el.lastChild.textContent));
}

console.log("\n— 3. a club linked on the game stats desk always repaints as linked");
{
  const live = read("../src/live/part_live.js");
  const at = live.indexOf("btn.textContent = \"Pulling sessions…\";");
  const chunk = live.slice(at, at + 900);
  A("a failed pull is told inside the link's chain and the desk reloads either way", /\}, function\(e\)\{ CG\.toast\(e\.message,"err"\); \}\)\.then\(loadCands\);/.test(chunk), chunk.slice(0, 200));
  A("...so only a failed link restores the This is us button", /\}\)\.catch\(function\(e\)\{ btn\.disabled=false; btn\.textContent="This is us"; CG\.toast\(e\.message,"err"\); \}\);/.test(live.slice(at, at + 1400)));
}

console.log("\n— the changelog");
{
  const line = read("../src/live/part3_content.js");
  const rb = JSON.parse(line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1)).rulebook || {};
  const e = (rb.changelog || []).find((c) => c.version === "4.35");
  A("the 4.35 entry exists", !!e);
  const txt = e ? e.summary + " " + e.items.join(" ") : "";
  A("...naming all three fixes in plain words", /box-score imports/.test(txt) && /status line/.test(txt) && /game stats desk/.test(txt) && /letters, numbers/.test(txt), txt.slice(0, 160));
  A("...house style: no dashes as punctuation", !/[–—]| - /.test(txt));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
