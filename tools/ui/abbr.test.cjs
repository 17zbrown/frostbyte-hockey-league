const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* The abbreviation popup, driven in headless Chromium: node tools/ui/run.cjs abbr
   Needs the s2-concept server on S2_BASE (tools/ui/run.cjs).
   The commissioner, 2026-11-04: "when you hover over an abbreviation of any kind on the site that a small popup with the full name
   will appear so people dont get confused."
   Holds the popup to its text on every kind of abbreviation, to no false matches, to the browser's own tooltip never doubling it, to
   the first wait and the instant neighbor, to the keyboard and a phone, and to leaving the page exactly as it found it.
   A sweep of every page and role fails when a page starts printing an abbreviation nobody has named.
   Reads only; nothing is sent anywhere.
   Deleted with demo mode (i3f, 2026-11-25): "nothing of it is carried across an update" (S2.carry, the concept's automatic
   update, is gone; the real update reloads the page). Deleted with demo mode (i3a, 2026-11-25), each pinned the demo's sample data or its dock: "#/games: ET" (the real
   Season 1 schedule says "All times Eastern" and has no upcoming time; ET stays held on Today, Season and the Control
   Center), "a position letter on the lineup board" (the sample week; the GM's club has no upcoming game; position
   letters stay held in the box score) and the dock half of "the dock and the sticky header are untouched". Rewritten to
   the real pages (review 2026-11-25): "#/bidding: C" and "OVR" and "#/camp: LW" read the suite's own bid night and
   pool (MARKET below), and "OT on a game tile" reads a Season 1 overtime final on the Game Center's "Also that night"
   rail, under the same link overlay. Changed to the live
   league: the gamertag guard reads words of two or more characters (a single letter is only ever a whole label, and a
   live tag is spelled in single letters), and the phone's tap reads a sentence on the Season page that is no door. */
const PW = process.env.PLAYWRIGHT || "/Users/zackbrown/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright";
const { chromium } = require(PW);
const fs = require("fs"), path = require("path");
const BASE = S2_BASE;
const mock = require(process.env.S2_MOCK);
const SHOTS = process.env.ABBR_SHOTS || "";
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)) + ")")); if (!cond) fails++; };
const wait = (p, ms) => p.waitForTimeout(ms);
const REST = 460;   /* past the first wait and the entrance */

/* a page, in a role and a theme, on a mouse or (width) a phone */
const errors = [];
let browser;
/* the real site (i3a, 2026-11-25: node tools/ui/run.cjs --suite abbr --mode live): every context is
   mock.install(ctx, {live: true, persona}), signed in as the role's persona (guest = anon, player = member, office = gm,
   staff = staff, commish = commissioner), with Season 1 on screen (?season=1: the recorded read whose games carry the box
   scores, stat tables and titles the popups are held to; Season 2 has no game yet). The survey stays shut */
const PERSONA = { guest: "anon", player: "member", office: "gm", staff: "staff", commish: "commissioner" };
/* what the workspaces read beyond the league read, answered as Season 2 stands before its draft (no trade, no move, no
   market night, no application on file, no department: Season 2 has none), so every page draws its real empty state */
const EMPTY = ["trades", "team_mgmt_moves", "team_mgmt_policy", "management_applications", "club_notices", "action_requests", "market_waivers",
  "market_pool_requests", "market_boards", "game_stats", "staff_applications", "owner_applications", "draft_boards",
  "application_ballots", "committee_applications", "suspension_requests", "award_ballots"];
/* the market as a Saturday bid night shows it (review 2026-11-25: the bid lot and camp checks run on the real pages with
   the suite's own rows, not the empty market Season 2 has before its draft): one live night whose one lot is a Center,
   and a training camp pool of that Center and a Left Wing, in the shapes market_calendar and market_pool return (sql
   v4.58, v4.59). The two are a Season 1 center and winger picked from the recorded ratings at run time (pos_cat C and
   W), so no member's name or id is written here */
const L2 = mock.league({}), CUR = L2.seasons.filter((x) => x.number === L2.season)[0].id;
const RATED = mock.league({ p_season: 1 }).ratings.filter((x) => x.headline), FWD = ["C", "W"].map((c) => (RATED.filter((x) => x.pos_cat === c)[0] || {}).profile_id);
if (!FWD[0] || !FWD[1]) throw new Error("abbr: the recorded Season 1 ratings have no rated center and winger for the market rows");
const NOW = Date.now(), at = (min) => new Date(NOW + min * 60e3).toISOString();
const NIGHT = new Date(NOW - 5 * 3600e3).toISOString().slice(0, 10);   /* the night's Eastern date, near enough for a key */
const MARKET = {
  market_bid_nights: [{ id: "night-1", season_id: CUR, night: NIGHT, opens_at: at(-10), new_until: at(50), state: "live", paused_at: null, closed_at: null }],
  market_lots: [{ id: "lot-1", season_id: CUR, night_id: "night-1", profile_id: FWD[0], position: "C", ord: 1, gp_at_open: 3, state: "open", price: null, bids: 0,
    last_bid_at: null, ends_at: null, paused_remaining: null, sold_team_id: null, sold_at: null, ended_at: null, why: null }],
  market_bids: []
};
const POOL = [["C", FWD[0]], ["LW", FWD[1]]].map(([pos, id]) => ({ profile_id: id, position: pos, pos_group: "F", gp: 3, needs: 3, eligible: true, suspended: false,
  source: "undrafted", last_team_id: null, available_next: true }));
const CALENDAR = { season_id: CUR, market: true, deadline: at(7 * 24 * 60), moves_locked: false, draft_done: true, game_nights: [], next_bid_night: NIGHT,
  bid_nights: [{ night: NIGHT, skipped: false, why: null, opens_at: at(-10), new_until: at(50), id: "night-1", state: "live", paused: false }] };
const RPCS = { season_survey_done: mock.ok(true), has_department: mock.ok(false), is_app_reviewer: mock.ok(false), is_any_committee_manager: mock.ok(false),
  ea_lookup_health: mock.ok(null), staff_voter_count: mock.ok(11), market_calendar: mock.ok(CALENDAR), market_pool: mock.ok(POOL), market_club_state: mock.ok(null), my_discord_accounts: mock.ok([]),
  statistical_title_board: mock.ok([]) };   /* QA visual 3 (2026-11-25): the Leaders and Goaltenders tabs read the title race; answered empty here */
async function page(hash, o) {
  o = o || {};
  const role = o.role || "guest";
  const ctx = await browser.newContext(Object.assign(o.width ? { viewport: { width: o.width, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: o.vw || 1280, height: 900 } }, o.reduced ? { reducedMotion: "reduce" } : {}));
  await mock.install(ctx, { live: true, persona: PERSONA[role], rpcs: RPCS, tables: Object.assign(Object.fromEntries(EMPTY.map((t) => [t, []])), JSON.parse(JSON.stringify(MARKET))) });
  await ctx.addInitScript((a) => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.surveyLoadDay", new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })); if (a.theme) localStorage.setItem("s2.theme", JSON.stringify(a.theme)); } catch (e) {} }, { theme: o.theme || null });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await p.goto(BASE + "?season=1" + hash);
  await p.waitForFunction((r) => window.S2 && S2.M && S2.LIVE && S2.state.role === r && document.querySelector("#app main, #app .page, #app section"), role === "office" ? "office" : role === "player" ? "player" : role, { timeout: 30000 });
  await wait(p, 300);
  return p;
}
const tip = (p) => p.evaluate(() => { const t = document.getElementById("abbrTip"); if (!t) return { none: true, open: false };
  const r = t.getBoundingClientRect(), c = getComputedStyle(t);
  return { open: t.hasAttribute("data-open"), instant: t.hasAttribute("data-instant"), text: t.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, dur: c.transitionDuration, opacity: +c.opacity, transform: c.transform, vis: c.visibility, bg: c.backgroundColor, fg: c.color, origin: c.transformOrigin, blur: c.backdropFilter, img: c.backgroundImage, pe: c.pointerEvents, pos: c.position, vw: document.documentElement.clientWidth, vh: innerHeight, sw: document.documentElement.scrollWidth }; });
/* the middle of the first visible element matching sel (or, with text, whose own text is exactly that), scrolled into view */
const spot = (p, sel, text) => p.evaluate(([sel, text]) => {
  const el = [].filter.call(document.querySelectorAll(sel), (x) => (!text || x.textContent.replace(/\s+/g, " ").trim() === text) && x.getClientRects().length)[0];
  if (!el) return null;
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}, [sel, text]);
/* the middle of one word inside a sentence: text nodes only, whole word, exact case */
const wordSpot = (p, sel, word) => p.evaluate(([sel, word]) => {
  const re = new RegExp("(^|[\\s·,(])" + word.replace(/[+%/]/g, "\\$&") + "(?=$|[\\s·,).;:])");
  for (const el of document.querySelectorAll(sel)) {
    if (!el.getClientRects().length || !el.checkVisibility()) continue;   /* a closed details keeps its rects */
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue;
      const m = re.exec(n.nodeValue); if (!m) continue;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = document.createRange(), at = m.index + m[1].length; r.setStart(n, at); r.setEnd(n, at + word.length);
      const b = r.getBoundingClientRect();
      if (!b.width) continue;
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, sentence: n.nodeValue.trim().slice(0, 90) };
    }
  }
  return null;
}, [sel, word]);
const away = async (p) => { await p.mouse.move(2, 880); await wait(p, 120); };
const hoverOn = async (p, at) => { await p.mouse.move(at.x, at.y); };
async function hoverText(p, sel, text, ms) { const at = await spot(p, sel, text); if (!at) return null; await wait(p, 60); await away(p); await wait(p, 400); await hoverOn(p, at); await wait(p, ms == null ? REST : ms); return tip(p); }
async function hoverWord(p, sel, word, ms) { const at = await wordSpot(p, sel, word); if (!at) return null; await wait(p, 60); await away(p); await wait(p, 400); await hoverOn(p, at); await wait(p, ms == null ? REST : ms); const t = await tip(p); t.sentence = at.sentence; return t; }
const lum = (rgb) => { const m = rgb.match(/[\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

(async () => {
  browser = await chromium.launch();

  console.log("## nothing until it is needed, and the page left as it was");
  let p = await page("#/stats?tab=skaters");
  A("no popup element in the page before the first hover", (await tip(p)).none === true);
  await p.evaluate(() => { window.__walks = 0; const o = document.createTreeWalker; document.createTreeWalker = function () { window.__walks++; return o.apply(document, arguments); };
    window.__muts = 0; new MutationObserver((l) => { window.__muts += l.length; }).observe(document.getElementById("app"), { childList: true, subtree: true, characterData: true }); });
  await wait(p, 400);
  A("an idle page reads nothing", (await p.evaluate(() => window.__walks)) === 0);
  await p.evaluate(() => { S2.route(true); });
  await wait(p, 300);
  A("a repaint costs it nothing: no read of the new table", (await p.evaluate(() => window.__walks)) === 0);
  await p.evaluate(() => { window.__muts = 0; });
  let t = await hoverText(p, "#skT thead th", "HIT");
  A("hovering adds no element and changes no text in the page", (await p.evaluate(() => window.__muts)) === 0, await p.evaluate(() => window.__muts));
  A("the popup is built once, on body, outside the repainted app", await p.evaluate(() => { const a = document.getElementById("abbrTip"); return a.parentNode === document.body && document.querySelectorAll("#abbrTip").length === 1 && a.getAttribute("role") === "tooltip"; }));

  console.log("## the words");
  const heads = [["HIT", "Hits"], ["G", "Goals"], ["A", "Assists"], ["P/GP", "Points per game"], ["SOG", "Shots on goal"], ["TOI/GP", "Time on ice per game"], ["PPG", "Power-play goals"], ["PIM", "Penalty minutes"]];
  for (const [w, full] of heads) { t = await hoverText(p, "#skT thead th", w); A("the stat heading " + w + " says " + full, t && t.open && t.text === full, t && t.text); }
  t = await hoverText(p, "#skT tbody abbr", "C");
  A("a position in a table: C says Center", t && t.open && t.text === "Center", t);
  t = await hoverText(p, "#skT tbody abbr", "LW");
  A("LW says Left Wing", t && t.open && t.text === "Left Wing", t);
  await p.close();

  p = await page("#/stats?tab=goalies");
  for (const [w, full] of [["SV%", "Save percentage"], ["GAA", "Goals against average"], ["W", "Wins"], ["L", "Regulation losses"], ["SO", "Shutouts"], ["DS", "Desperation saves"]]) { t = await hoverText(p, "#gkT thead th", w); A("the goalie heading " + w + " says " + full, t && t.open && t.text === full, t && t.text); }
  await p.close();

  p = await page("#/stats?tab=teams");
  for (const w of ["TOA/GP", "PASS%", "HIT/GP", "FO%", "GF/GP", "GA/GP", "PP%", "PK%"]) { t = await hoverText(p, "table thead th", w); A("the club heading " + w + " is named: " + (t && t.text), t && t.open && t.text.length > 4 && t.text !== w, t); }
  await p.close();

  p = await page("#/standings?view=league");
  t = await hoverText(p, "table thead th", "OTL");
  A("a standings heading: OTL says Overtime losses", t && t.open && /^Overtime loss/.test(t.text), t && t.text);
  t = await hoverText(p, "table thead th", "RW");
  A("RW under a standings heading keeps the page's meaning, not Right Wing", t && t.open && /^Regulation wins/.test(t.text), t && t.text);
  t = await hoverText(p, "abbr.lg-mk", "x");
  A("a clinch letter says what it means", !t || (t.open && /Clinched/.test(t.text)), t && t.text);
  await p.close();

  p = await page("#/today");
  t = await hoverText(p, ".td-pin-code", "BOS");
  A("on the home map a club code opens nothing: the pin's own card already names the club", t && !t.open, t);
  { const q = await page("#/standings"); t = await hoverText(q, ".lg-strip-a span", "BOS"); A("a club code: BOS says Boston Bruins, from the model", t && t.open && t.text === "Boston Bruins", t); await q.close(); }
  t = await hoverWord(p, "p, span", "ET");
  A("a word inside a sentence: ET says Eastern Time", t && t.open && t.text === "Eastern Time", t);
  t = await hoverWord(p, "p.foot-line", "EA");
  A("EA in the footer's sentence says EA Sports", t && t.open && t.text === "EA Sports", t);
  t = await hoverWord(p, "p.foot-line", "NHL");
  A("NHL in the same sentence", t && t.open && t.text === "National Hockey League", t);
  t = await hoverText(p, ".wordmark", "CGHL");
  if (t) A("the wordmark says the league's whole name", t.open && t.text === "Chel Gaming Hockey League", t);
  const wordmark = await p.evaluate(() => S2.abbr.term("CGHL"));
  A("CGHL comes from the model's league name", wordmark === "Chel Gaming Hockey League", wordmark);
  await p.close();

  const glossary = await (async () => { p = await page("#/today"); const o = await p.evaluate(() => { const M = S2.M, miss = [];
    Object.keys(M.STATS).forEach((k) => { if (M.STATS[k].short && !S2.abbr.term(M.STATS[k].short)) miss.push(M.STATS[k].short); });
    Object.keys(M.POS_NAME).forEach((k) => { if (S2.abbr.term(k) !== M.POS_NAME[k] ) miss.push(k); });
    M.teams.forEach((c) => { if (S2.abbr.term(c.code) !== c.full) miss.push(c.code); });
    return { miss, tagsAsTerms: M.players.map((x) => x.tag).filter((tag) => String(tag).split(/\s+/).some((w) => w.length > 1 && S2.abbr.term(w))), tagCount: M.players.length,
      s: S2.abbr.term("S2"), s1: S2.abbr.term("S1"), r: S2.abbr.term("R3"), wk: S2.abbr.term("W4"), t30: S2.abbr.term("T-30"), g: S2.abbr.term("16G"), a1: S2.abbr.term("1A"), none: S2.abbr.term("constructor") || S2.abbr.term("PM") || S2.abbr.term("AM") || S2.abbr.term("S2.5") }; }); await p.close(); return o; })();
  A("every stat, position and club in the model has its name in the glossary, one definition each", glossary.miss.length === 0, glossary.miss);
  A("the shapes: S2, S1, R3, W4, T-30, 16G, 1A", glossary.s === "Season 2" && glossary.s1 === "Season 1" && glossary.r === "Round 3" && glossary.wk === "Week 4" && glossary.t30 === "30 minutes before puck drop" && glossary.g === "16 goals" && glossary.a1 === "1 assist", glossary);
  A("not a term: PM, AM, a rule number, an object's own property", !glossary.none, glossary.none);
  /* a single letter is read only as a whole label (a heading or a position cell), never inside a sentence, and a whole
     gamertag is a name (abbr.js TAGS), so only a word of two or more characters could be misread (the live league has a
     tag spelled in single letters) */
  A("no gamertag word spells a term today (" + glossary.tagCount + " players)", glossary.tagsAsTerms.length === 0, glossary.tagsAsTerms);

  console.log("## a real title beats the glossary, and the browser's own tooltip never doubles it");
  p = await page("#/stats?tab=skaters");
  const before = await p.evaluate(() => [].map.call(document.querySelectorAll("#skT thead [title]"), (x) => x.getAttribute("title")));
  t = await hoverText(p, "#skT thead th", "FO%");
  A("FO% says what the page says: in games played at center", t && t.open && /at center/.test(t.text) && t.text === before.filter((x) => /at center/.test(x))[0], t && t.text);
  const chain = await p.evaluate(() => { const b = [].filter.call(document.querySelectorAll("#skT thead th"), (x) => x.textContent.trim() === "FO%")[0]; let n = 0; for (let e = b.querySelector("button"); e; e = e.parentElement) if (e.hasAttribute("title")) n++; return { n, describedby: b.querySelector("button").getAttribute("aria-describedby") }; });
  A("while it shows, nothing up the chain holds a title for the browser to raise", chain.n === 0, chain);
  A("and the popup is the element's description for a screen reader meanwhile", chain.describedby === "abbrTip", chain);
  await away(p); await wait(p, 300);
  let after = await p.evaluate(() => [].map.call(document.querySelectorAll("#skT thead [title]"), (x) => x.getAttribute("title")));
  A("on leaving, every title is back as rendered", JSON.stringify(before) === JSON.stringify(after), after);
  A("and the description is gone again", await p.evaluate(() => !document.querySelector("#skT [aria-describedby]")));
  await hoverText(p, "#skT thead th", "FO%"); await away(p); await wait(p, 200);
  t = await hoverText(p, "#skT thead th", "FO%");
  A("hovered twice, still the page's meaning", t && /at center/.test(t.text), t && t.text);
  await away(p);
  /* a title on something that is not an abbreviation stays the browser's: this popup never prints a person */
  await p.close();
  p = await page("#/stats?tab=players");
  t = await hoverText(p, ".lg-tag", "+G");
  A("+G carries its own title through the popup", !t || (t.open && /in goal/.test(t.text)), t && t.text);
  await p.close();
  const gid = await (async () => { p = await page("#/today"); const g = await p.evaluate(() => S2.M.games.filter((x) => x.isFinal && x.hasBox)[0].id); await p.close(); return g; })();
  p = await page("#/desk/game/" + gid, { role: "staff" });
  const bn = await spot(p, "th.dk-bname");
  if (bn) { await hoverOn(p, bn); await wait(p, REST);
    const g = await p.evaluate(() => { const e = document.querySelector("th.dk-bname"); return { title: e.getAttribute("title"), text: (document.getElementById("abbrTip") || {}).textContent || "" }; });
    t = await tip(p);
    A("a gamertag's own title stays native, no popup and no name in it", !t.open && g.title && g.text.indexOf(g.title) < 0, [t, g]); }
  await p.close();

  console.log("## timing");
  p = await page("#/stats?tab=skaters");
  const g0 = await spot(p, "#skT thead th", "G"), a0 = await spot(p, "#skT thead th", "A"), p0 = await spot(p, "#skT thead th", "P");
  await wait(p, 100); await away(p); await wait(p, 500);
  await hoverOn(p, g0); await wait(p, 140);
  A("the first one waits: closed 140ms in", !(await tip(p)).open);
  await wait(p, 300);
  t = await tip(p);
  A("open after the short wait", t.open && t.text === "Goals", t);
  A("the first one is animated", !t.instant && /^0\.13s/.test(t.dur), t && t.dur);
  await hoverOn(p, a0); await wait(p, 40);
  t = await tip(p);
  A("the neighbor opens at once", t.open && t.text === "Assists", t);
  A("and with no animation", t.instant && /^0s/.test(t.dur) && t.opacity === 1, t);
  await hoverOn(p, p0); await wait(p, 40);
  t = await tip(p);
  A("and the next", t.open && t.text.length > 0 && t.instant, t);
  await wait(p, 500);
  A("it stays while the pointer rests on the abbreviation", (await tip(p)).open);
  await hoverOn(p, { x: p0.x + 2, y: p0.y + 1 }); await wait(p, 80);
  A("moving inside the abbreviation does not blink it", (await tip(p)).open);
  await p.mouse.move(2, 880); await wait(p, 30);
  A("the exit waits a beat for a neighbor", (await tip(p)).open);
  await wait(p, 300);
  t = await tip(p);
  A("then a fast exit, down to nothing", !t.open && t.opacity === 0 && t.vis === "hidden" && t.transform !== "none", t);
  await wait(p, 400);
  /* a pointer crossing the table flashes nothing */
  const cols = await p.$$eval("#skT thead th button", (b) => b.slice(1, 9).map((x) => { const r = x.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
  let flashed = false;
  for (const c of cols) { await p.mouse.move(c[0], c[1]); await wait(p, 45); if ((await tip(p)).open) flashed = true; }
  A("a pointer crossing the headings flashes nothing", !flashed);
  await away(p); await wait(p, 300);
  /* the text is not a hover target by accident: the popup itself lets everything through */
  t = await hoverText(p, "#skT thead th", "HIT");
  A("the popup is fixed and takes no pointer", t.pos === "fixed" && t.pe === "none", t);
  await p.close();

  console.log("## no false matches");
  p = await page("#/rulebook");
  await p.evaluate(() => { const d = document.createElement("div"); d.id = "probe"; d.style.cssText = "position:fixed;left:40px;top:120px;z-index:300;width:900px;background:var(--surface);padding:12px;font:16px/1.6 var(--font)";
    d.innerHTML = '<p id="pr1">A I SO far HIT the OTHER HOT SOUTH POT at 9 PM or 10 AM with PMS GPS GPU and BOSTON, then C G D F W L here. Official C and Official G. NOTE: AG S2.5 constructor</p>' +
      '<p id="pr2"><span id="pr3">C</span> <span id="pr4">G</span> <span id="pr5">SO</span> <span id="pr6">HIT</span> <h3 id="pr7" class="lg-dir-h">D</h3></p>'; document.body.appendChild(d); });
  for (const w of ["A", "I", "SO", "HIT", "OTHER", "HOT", "SOUTH", "POT", "PM", "AM", "PMS", "GPS", "GPU", "BOSTON", "C", "G", "D", "F", "W", "L", "NOTE", "AG", "S2.5", "constructor"]) {
    t = await hoverWord(p, "#pr1", w);
    A('"' + w + '" in a sentence never opens it', t && !t.open, t && t.text);
  }
  for (const id of ["pr3", "pr4", "pr5", "pr6", "pr7"]) { const at = await spot(p, "#" + id); await away(p); await hoverOn(p, at); await wait(p, REST); t = await tip(p); A("a lone " + (await p.evaluate((i) => document.getElementById(i).textContent, id)) + " that is not a label stays quiet", !t.open, t.text); }
  await p.evaluate(() => { const pr = document.getElementById("probe"); pr.innerHTML = '<p id="pr8">Sold under 12 GP, 87 OVR, in S2 at 9 PM ET: SV% .905 and P/GP 1.2, Final/OT, BOS-VAN, 5 F, 3 D, 1 G.</p><p id="pr9">C · 3 to six · SEA</p><p id="pr10">Minimums: 5F, 3D, 1G</p><p id="pr11">0 G · 2 A · 0 +/- · 2 shots</p><p id="pr12">16G 9A, 4 SO, Official C · 2 h ago</p>'; });
  for (const [w, full] of [["GP", "Games played"], ["OVR", "Overall rating"], ["S2", "Season 2"], ["ET", "Eastern Time"], ["SV%", "Save percentage"], ["P/GP", "Points per game"], ["F", "Forwards"], ["D", "Defense"], ["G", "Goaltenders"]]) {
    t = await hoverWord(p, "#pr8", w); A(w + " in a sentence says " + full, t && t.open && t.text === full, t && t.text); }
  for (const [id, w, full] of [["#pr9", "C", "Center"], ["#pr9", "SEA", "Seattle Kraken"], ["#pr10", "5F", "5 forwards"], ["#pr10", "3D", "3 defense"], ["#pr10", "1G", "1 goaltender"], ["#pr11", "G", "Goals"], ["#pr11", "A", "Assists"], ["#pr11", "+/-", "Plus/minus"], ["#pr12", "16G", "16 goals"], ["#pr12", "9A", "9 assists"], ["#pr12", "SO", "Shutouts"]]) {
    t = await hoverWord(p, id, w); A(w + " in a meta line (" + id + ") says " + full, t && t.open && t.text === full, t && t.text); }
  t = await hoverWord(p, "#pr12", "C"); A("the C in Official C stays a letter", t && !t.open, t && t.text);
  t = await hoverWord(p, "#pr8", "PM"); A("PM beside ET stays quiet", t && !t.open, t && t.text);
  /* OT inside Final/OT and VAN inside BOS-VAN: the whole run does not match, its parts do */
  const pm = await p.evaluate(() => { const n = document.getElementById("pr8").firstChild, r = document.createRange(), at = (w) => { const i = n.nodeValue.indexOf(w), rr = document.createRange(); rr.setStart(n, i); rr.setEnd(n, i + w.length); const b = rr.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }; return { ot: at("OT,"), van: at("VAN") }; });
  await away(p); await hoverOn(p, { x: pm.ot.x - 3, y: pm.ot.y }); await wait(p, REST); t = await tip(p); A("OT in Final/OT says Overtime", t.open && t.text === "Overtime", t.text);
  await away(p); await hoverOn(p, pm.van); await wait(p, REST); t = await tip(p); A("VAN in BOS-VAN says Vancouver Canucks", t.open && t.text === "Vancouver Canucks", t.text);
  await away(p); await p.close();
  p = await page("#/stats?tab=players");
  t = await hoverText(p, "h3.lg-dir-h", "G"); A("the A to Z directory's letter G stays a letter", t && !t.open, t && t.text);
  await p.close();
  p = await page("#/desk", { role: "staff" });
  const av = await spot(p, ".avatar");
  if (av) { await away(p); await hoverOn(p, av); await wait(p, REST); t = await tip(p); A("a person's initials in an avatar stay initials", !t.open, t.text); }
  await p.close();
  p = await page("#/today");
  t = await hoverWord(p, ".td-ts, .td-mx-t, p, span", "PM");
  A("PM in a real time on the page stays quiet", t && !t.open, t && [t.text, t.sentence]);
  await p.close();

  console.log("## Escape, focus and scroll");
  p = await page("#/stats?tab=skaters");
  await p.keyboard.press("Tab");
  await p.evaluate(() => { const b = [].filter.call(document.querySelectorAll("#skT thead button"), (x) => x.textContent.trim() === "HIT")[0]; b.focus(); b.scrollIntoView({ block: "center", inline: "center" }); });
  await wait(p, 260);
  t = await tip(p);
  A("keyboard focus on a sort button shows it", t.open && t.text === "Hits", t);
  A("at once and with no motion", t.instant && /^0s/.test(t.dur), t.dur);
  const fdesc = await p.evaluate(() => [document.activeElement.getAttribute("aria-describedby"), document.activeElement.getAttribute("title")]);
  A("the focused button keeps its description for a screen reader", fdesc[0] === "abbrTip" || fdesc[1] === "Hits", fdesc);
  let foc = await p.evaluate(() => document.activeElement.textContent.trim());
  await p.keyboard.press("Escape"); await wait(p, 200);
  t = await tip(p);
  A("Escape dismisses it", !t.open);
  A("without moving focus", (await p.evaluate(() => document.activeElement.textContent.trim())) === foc);
  await p.keyboard.press("Tab"); await wait(p, 260);
  t = await tip(p);
  const nextFoc = await p.evaluate(() => document.activeElement.textContent.trim());
  A("Tab to the next heading shows that one, even when the table scrolls to it", t.open && t.text.length > 0 && nextFoc !== foc, [t.text, nextFoc]);
  await p.evaluate(() => document.activeElement.blur()); await wait(p, 200);
  A("leaving focus closes it", !(await tip(p)).open);
  /* a title on the focused element stays where it is: focus raises no native tooltip, and the reader keeps it */
  await p.keyboard.press("Tab");
  await p.evaluate(() => { const b = [].filter.call(document.querySelectorAll("#skT thead button"), (x) => x.textContent.trim() === "SOG")[0]; b.focus(); });
  await wait(p, 260);
  const kept = await p.evaluate(() => document.activeElement.getAttribute("title"));
  t = await tip(p);
  A("focus reads the title and leaves it in place", t.open && t.text === "Shots on goal" && kept === "Shots on goal", [t.text, kept]);
  await p.evaluate(() => document.activeElement.blur()); await wait(p, 200);
  /* a mouse click focuses the button too; no popup is asked for by that */
  /* Escape on a hover stays closed until the pointer goes elsewhere */
  t = await hoverText(p, "#skT thead th", "BLK");
  A("hover shows it", t.open);
  await p.keyboard.press("Escape"); await wait(p, 200);
  A("Escape on a hover closes it", !(await tip(p)).open);
  /* read where the heading is WITHOUT scrolling: "the pointer stays" means the page stays too. spot() scrolls it into view,
     and on the sticky head that second scroll moved the page 6px once the v4.48 label voice narrowed the columns (audit
     2026-11-09), which is the page moving under the pointer, a new place, and rightly reopens the popup */
  const blk = await p.evaluate(() => { const el = [].filter.call(document.querySelectorAll("#skT thead th"), (x) => x.textContent.replace(/\s+/g, " ").trim() === "BLK")[0]; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.move(blk.x + 1, blk.y + 1); await wait(p, REST);
  A("and it stays closed while the pointer stays", !(await tip(p)).open);
  await away(p); await wait(p, 300);
  t = await hoverText(p, "#skT thead th", "BLK");
  A("coming back opens it again", t.open);
  /* scrolling hides it, the page or a table sideways */
  await p.evaluate(() => window.scrollBy(0, 60)); await wait(p, 120);
  A("scrolling the page hides it", !(await tip(p)).open);
  await away(p); await wait(p, 300);
  t = await hoverText(p, "#skT thead th", "BLK");
  A("hover again", t.open);
  const scrolled = await p.evaluate(() => { const w = document.querySelector("#skT").closest(".tbl-wrap") || document.querySelector("#skT").parentElement; const was = w.scrollLeft; w.scrollLeft = was + 80; return w.scrollLeft !== was; });
  await wait(p, 120);
  if (scrolled) A("scrolling the table sideways hides it", !(await tip(p)).open);
  await away(p); await p.close();
  /* a sheet: the first Escape is the popup's, the second the sheet's */
  p = await page("#/today");
  await p.evaluate(() => { window.__sh = S2.sheet({ title: "Test", html: '<p id="shw">Sold at <b id="shb">GP</b> tonight.</p>' }); });
  await wait(p, 500);
  const shb = await spot(p, "#shb");
  await hoverOn(p, shb); await wait(p, REST);
  t = await tip(p);
  const z = await p.evaluate((pt) => { const t = document.getElementById("abbrTip"); return { tz: +getComputedStyle(t).zIndex, sz: +getComputedStyle(document.querySelector(".sheet")).zIndex }; }, shb);
  A("inside a sheet: it shows, above the sheet", t.open && t.text === "Games played" && z.tz > z.sz, [t.text, z]);
  await p.keyboard.press("Escape"); await wait(p, 200);
  let sheetOpen = await p.evaluate(() => !!document.querySelector(".sheet.open, .sheet.in, .sheet") && document.querySelector(".sheet").getClientRects().length > 0);
  A("the first Escape closes the popup and leaves the sheet", !(await tip(p)).open && sheetOpen);
  await p.keyboard.press("Escape"); await wait(p, 500);
  A("the second closes the sheet", await p.evaluate(() => { const s = document.querySelector(".sheet"); return !s || !s.classList.contains("open") && !s.getClientRects().length || getComputedStyle(s).visibility === "hidden" || !document.body.contains(s); }));
  await away(p); await p.close();

  console.log("## where it sits");
  p = await page("#/stats?tab=skaters");
  t = await hoverText(p, "#skT thead th", "HIT");
  let hb = await spot(p, "#skT thead th", "HIT");
  A("above the heading, with a small gap", t.bottom <= hb.y && t.top >= 8, t);
  A("its origin sits toward the abbreviation: the bottom edge", /px \d+(\.\d+)?px$/.test(t.origin) && Math.abs(parseFloat(t.origin.split(" ")[1]) - (t.bottom - t.top)) < 3, t.origin);
  await away(p); await p.close();
  /* no room above: the header row at the very top of the viewport */
  p = await page("#/today");
  await p.evaluate(() => { const d = document.createElement("b"); d.id = "topGP"; d.textContent = "GP"; d.style.cssText = "position:fixed;left:1262px;top:2px;z-index:300;font:600 14px var(--font)"; document.body.appendChild(d); });
  const wm = await spot(p, "#topGP");
  await hoverOn(p, wm); await wait(p, REST);
  t = await tip(p);
  A("no room above: it flips below the abbreviation", t.open && t.top >= wm.y + wm.h / 2, [t, wm]);
  A("its origin moves to the top edge", parseFloat(t.origin.split(" ")[1]) < 1, t.origin);
  A("at the right edge it stays 8px inside", t.right <= t.vw - 8, t);
  await away(p);
  /* a link with no title of its own: the popup is its description, on focus, and only while it shows */
  await p.keyboard.press("Tab");
  await p.evaluate(() => document.querySelector(".navbar .brand").focus());
  await wait(p, 200);
  t = await tip(p);
  A("focus on the wordmark link names the league", t.open && t.text === "Chel Gaming Hockey League", t);
  A("the popup describes it while it shows", (await p.evaluate(() => document.querySelector(".navbar .brand").getAttribute("aria-describedby"))) === "abbrTip");
  await p.evaluate(() => document.activeElement.blur()); await wait(p, 200);
  A("and no longer after", (await p.evaluate(() => document.querySelector(".navbar .brand").getAttribute("aria-describedby"))) === null);
  await p.close();

  console.log("## light, dark and an ink band");
  for (const theme of ["light", "dark"]) {
    p = await page("#/stats?tab=skaters", { theme });
    A(theme + " mode is on", (await p.evaluate(() => document.documentElement.getAttribute("data-theme"))) === theme);
    t = await hoverText(p, "#skT thead th", "HIT");
    const tok = await p.evaluate(() => { const c = getComputedStyle(document.documentElement); return { raised: c.getPropertyValue("--raised").trim(), ink: c.getPropertyValue("--ink").trim() }; });
    A(theme + ": solid surface, the site's tokens", t.open && !/rgba\([^)]*, 0(\.\d+)?\)/.test(t.bg) && t.blur === "none" && t.img === "none", [t.bg, t.blur, t.img, tok]);
    A(theme + ": readable, " + contrast(t.fg, t.bg).toFixed(1) + ":1", contrast(t.fg, t.bg) >= 7, [t.fg, t.bg]);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, "desktop-" + theme + ".png"), clip: { x: Math.max(0, t.left - 260), y: Math.max(0, t.top - 90), width: 620, height: 240 } });
    await away(p); await p.close();
    /* an ink band: Game Center's scoreboard, its Eastern Time in a sentence */
    p = await page("#/game/" + gid, { theme });
    t = await hoverWord(p, ".band.ink *", "ET");
    const band = await p.evaluate(() => getComputedStyle(document.querySelector(".band.ink")).backgroundColor);
    A(theme + ": in an ink band ET says Eastern Time, and stands off the band", t && t.open && t.text === "Eastern Time" && contrast(t.bg, band) >= 1.2 && contrast(t.fg, t.bg) >= 7, t && [t.text, t.bg, band]);
    if (SHOTS && t) await p.screenshot({ path: path.join(SHOTS, "ink-" + theme + ".png"), clip: { x: Math.max(0, t.left - 260), y: Math.max(0, t.top - 90), width: 620, height: 260 } });
    await p.close();
  }

  console.log("## reduced motion");
  p = await page("#/stats?tab=skaters", { reduced: true });
  t = await hoverText(p, "#skT thead th", "HIT", 80);
  await hoverOn(p, await spot(p, "#skT thead th", "HIT"));
  await wait(p, 400);
  t = await tip(p);
  A("a plain fade, no scale", t.open && t.transform === "none" && /^0\.12s/.test(t.dur), t);
  await away(p); await wait(p, 300);
  t = await tip(p);
  A("closed, it never scaled", !t.open && t.transform === "none" && t.opacity === 0, t);
  await p.close();

  console.log("## a phone at 375px");
  p = await page("#/stats?tab=skaters", { width: 375 });
  const tap = async (at) => { await p.touchscreen.tap(at.x, at.y); };
  const noScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  A("no page overflow to begin with", await noScroll());
  let tb = await spot(p, "#skT thead th", "HIT");
  let sortBefore = await p.evaluate(() => { const th = document.querySelector('#skT thead th[aria-sort]'); return th && th.textContent.trim(); });
  await tap(tb); await wait(p, 220);
  t = await tip(p);
  let sortAfter = await p.evaluate(() => { const th = document.querySelector('#skT thead th[aria-sort]'); return th && th.textContent.trim(); });
  A("a heading tap still sorts", sortAfter === "HIT" && sortBefore !== "HIT", [sortBefore, sortAfter]);
  A("and the same tap names it", t.open && t.text === "Hits", t);
  A("inside the viewport by 8px, no overflow", t.left >= 8 && t.right <= t.vw - 8 && t.top >= 8 && t.bottom <= t.vh - 8 && (await noScroll()), t);
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, "phone-heading.png") });
  await wait(p, 2800);
  A("it goes by itself", !(await tip(p)).open);
  /* the far edge of the table: pushed back inside the viewport */
  await p.evaluate(() => { const w = document.querySelector("#skT").closest(".tbl-wrap") || document.querySelector("#skT").parentElement; w.scrollLeft = 99999; });
  await wait(p, 120);
  const last = await p.evaluate(() => { const ths = document.querySelectorAll("#skT thead th"), th = ths[ths.length - 1], b = th.getBoundingClientRect(); return { x: Math.min(b.left + b.width / 2, innerWidth - 4), y: b.top + b.height / 2, text: th.textContent.trim() }; });
  await tap(last); await wait(p, 220);
  t = await tip(p);
  A("a heading at the screen's edge: " + last.text + " stays 8px inside", t.open && t.left >= 8 && t.right <= t.vw - 8 && (await noScroll()), t);
  await p.evaluate(() => { document.querySelector("#skT").closest(".tbl-wrap").scrollLeft = 0; });
  await wait(p, 200);
  A("a scroll hides a tapped one", !(await tip(p)).open);
  /* a tap on nothing closes; a tap on a word in a sentence reads it */
  await p.close();
  /* the Season page's calendar sentences (the live Today's only ET sits in its sign-up band, a door) */
  p = await page("#/season", { width: 375 });
  /* a sentence that is no door (the live Today's sign-up band is one: a tap there opens the form) */
  const PLAIN = ["p", "span"].map((t) => "#app " + t + ":not([data-flow] *):not(a *):not(button *)").join(", ");
  const w0 = await wordSpot(p, PLAIN, "ET");
  await wait(p, 200);
  const w1 = await wordSpot(p, PLAIN, "ET");
  await p.touchscreen.tap(w1.x, w1.y); await wait(p, 220);
  t = await tip(p);
  A("a tap on a word in a sentence reads it", t.open && t.text === "Eastern Time", [t, w1.sentence]);
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, "phone-word.png") });
  await p.close();
  p = await page("#/standings?view=league", { width: 375 });
  const lk = await p.evaluate(() => { const codes = S2.M.teams.map((x) => x.code); const a = [].filter.call(document.querySelectorAll("#app a[href^='#/club/']"), (x) => x.getClientRects().length && [].some.call(x.querySelectorAll("*"), (y) => y.children.length === 0 && codes.indexOf(y.textContent.trim()) >= 0))[0]; if (!a) return null; const el = [].filter.call(a.querySelectorAll("*"), (y) => y.children.length === 0 && codes.indexOf(y.textContent.trim()) >= 0)[0]; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, code: el.textContent.trim() }; });
  if (!lk) { const any = await p.evaluate(() => { const a = document.querySelector("#app a[href^='#/club/']"); if (!a) return null; a.scrollIntoView({ block: "center" }); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await wait(p, 100); await p.touchscreen.tap(any.x, any.y); await wait(p, 300); A("a link still navigates", /#\/club\//.test(await p.evaluate(() => location.hash))); }
  else {
    /* a long press reads a link without following it */
    await wait(p, 120);
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: lk.x, y: lk.y }] });
    await wait(p, 560);
    t = await tip(p);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await wait(p, 200);
    const full = await p.evaluate((c) => S2.M.team(c).full, lk.code);
    A("a long press on a link names it", t.open && t.text === full, [t.text, full]);
    A("and does not follow it", /standings/.test(await p.evaluate(() => location.hash)), await p.evaluate(() => location.hash));
    await wait(p, 100);
    await p.touchscreen.tap(lk.x, lk.y); await wait(p, 320);
    const h = await p.evaluate(() => location.hash);
    A("the next plain tap on that link still navigates", /#\/club\//.test(h), h);
    A("and leaves no popup behind", !(await tip(p)).open);
    A("the new page does not overflow either", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await p.close();

  console.log("## it does not disturb what is there");
  p = await page("#/stats?tab=skaters");
  const reports = await p.evaluate(() => { const o = { nav: getComputedStyle(document.querySelector(".navbar, #navbar")).position }; return o; });
  const titlesBefore = await p.$$eval("#skT thead [title]", (x) => x.length);
  t = await hoverText(p, "#skT thead th", "SOG");
  /* a mouse click on a heading sorts under an open popup: the header is repainted in place and nothing stale is read */
  let at = await spot(p, "#skT thead th", "SOG");
  await p.mouse.click(at.x, at.y); await wait(p, 300);
  const sorted = await p.evaluate(() => document.querySelector('#skT thead th[aria-sort]').textContent.trim());
  A("a click on a heading still sorts", sorted === "SOG", sorted);
  t = await tip(p);
  A("the popup outlives the repaint under the pointer", t.open && t.text === "Shots on goal", t);
  await p.mouse.move(at.x + 2, at.y + 1); await wait(p, 120);
  A("the new heading's title is lent too, so the browser cannot double it", await p.evaluate(() => { const b = [].filter.call(document.querySelectorAll("#skT thead button"), (x) => x.textContent.trim() === "SOG")[0]; return !b.hasAttribute("title"); }));
  await away(p); await wait(p, 300);
  A("and every heading has its title back after", (await p.$$eval("#skT thead [title]", (x) => x.length)) === titlesBefore);
  /* a route away from an open popup */
  t = await hoverText(p, "#skT thead th", "HIT");
  await p.evaluate(() => { location.hash = "#/standings"; }); await wait(p, 300);
  A("a route closes it", !(await tip(p)).open);
  await away(p); await wait(p, 300);
  await p.evaluate(() => { location.hash = "#/stats?tab=skaters"; }); await wait(p, 400);
  /* a drag owns the pointer */
  at = await spot(p, "#skT thead th", "HIT");
  await away(p); await wait(p, 200);
  await p.mouse.down(); await p.mouse.move(at.x, at.y, { steps: 3 }); await wait(p, REST);
  A("no popup while a button is held", !(await tip(p)).open);
  await p.mouse.up();
  await away(p); await wait(p, 200);
  A("the sticky header is untouched", /sticky|fixed/.test(reports.nav), reports);
  /* the search box: typing under a resting pointer repaints nothing and opens nothing */
  const inp = await spot(p, "#app input[type=search], #app input");
  if (inp) { await p.mouse.move(inp.x, inp.y); await wait(p, REST); A("no popup on a text box", !(await tip(p)).open); }
  await p.close();

  console.log("## on the real pages");
  const top = await (async () => { p = await page("#/today"); const o = await p.evaluate(() => S2.M.lines({ role: "S", sort: "p" })[0].pid); await p.close(); return o; })();
  /* [role, page, how, selector, the abbreviation, its meaning]: "t" a whole element, "w" a word in a sentence */
  const REAL = [
    ["guest", "#/game/" + gid, "t", "table thead th", "TOI", /^Time on ice$/],
    ["guest", "#/game/" + gid, "t", "table tbody td", "C", /^Center$/],
    ["guest", "#/game/" + gid, "t", "table thead th", "G", /^Goals$/],
    ["guest", "#/standings?view=league", "t", "table thead th", "GF", /^Goals for/],
    ["guest", "#/standings?view=league", "t", "table thead th", "DIFF", /^Goal difference$/],
    ["guest", "#/clubs", "w", "#app main *", "pts", /^Points$/],
    ["guest", "#/club/BOS", "w", "#app main *", "GM", /^General Manager$/],
    ["guest", "#/player/" + top, "t", ".pfx-hon-n", "W1", /^Week 1$/],
    ["guest", "#/player/" + top, "w", "#app *", "22G", /^22 goals$/],
    ["guest", "#/season", "w", "#app main *", "ET", /^Eastern Time$/],
    ["guest", "#/bidding", "t", ".bd-lot-meta abbr", "C", /^Center$/],
    ["guest", "#/bidding", "w", "#app main *", "OVR", /^Overall rating$/],
    ["guest", "#/camp", "t", "#app abbr", "LW", /^Left Wing$/],
    ["guest", "#/draft", "t", ".lg-dr-rr", "R1", /^Round 1$/],
    ["guest", "#/rulebook", "w", "#app main *", "NHL", /^National Hockey League$/],
    ["guest", "#/rulebook", "w", "#app main *", "HQ", /^Headquarters$/],
    ["office", "#/hq?tab=lineups", "w", "p.hqx-lede", "AGM", /^Assistant General Manager$/],
    ["office", "#/hq?tab=roster", "w", "#app .sub", "OVR", /^Overall rating$/],
    ["office", "#/hq?tab=overview", "t", ".hqx-mark5 span", "W", /^Win$/],
    ["office", "#/trade?with=BOS", "t", ".tp-slot-p", "G", /^Goaltender$/],
    ["office", "#/trade?with=BOS", "t", "table thead th", "P/GP", /^Points per game/],
    ["staff", "#/desk?tab=people", "t", ".dk-phead span", "OVR", /^Overall rating$/],
    /* the Season 2 minimums are 3 F / 2 D / 1 G since 2026-11-23 (commissioner: "do 3 forwards, 2 defensemen, and 1 goalie") */
    ["staff", "#/desk?tab=transactions", "w", "#app main *", "3F", /^3 forwards$/],
    ["commish", "#/control", "w", "#app .sub", "GM", /^General Manager$/],
    ["commish", "#/control?tab=system", "w", "#app td", "ET", /^Eastern Time$/],
    ["commish", "#/control?tab=growth", "w", "#app main *", "COL", /^Colorado Avalanche$/],
    ["commish", "#/control?tab=setup", "w", "#app .t-foot", "ET", /^Eastern Time$/]
  ];
  let onRole = null;
  for (const [role, hash, how, sel, w, re] of REAL) {
    if (onRole !== role) { if (p && onRole) await p.close(); p = await page("#/today", { role }); onRole = role; }
    await p.evaluate((h) => { location.hash = h; }, hash); await wait(p, 500);
    await p.evaluate(() => { const d = document.querySelector("details.cc-all"); if (d) d.open = true; });   /* the System tab's heartbeats, behind Show all */
    t = how === "t" ? await hoverText(p, sel, w) : await hoverWord(p, sel, w);
    A(hash.slice(0, 26) + " (" + role + "): " + w + " says " + re.source.replace(/[\^$]/g, ""), t && t.open && re.test(t.text), t ? t.text + (t.open ? "" : " [closed]") : "not on the page");
  }
  await p.close();

  console.log("## every page and role: an abbreviation with no name fails here");
  /* left out on purpose: times and everyday words (AM, PM, OK), the word Hits in capitals (HITS), a font's name on the concept page (SF), rule numbers (S2.5). Single
     letters are held to the rules above. Everything else uppercase on a page must have a name, or be someone's gamertag */
  const LEFT = { AM: 1, PM: 1, OK: 1, SF: 1, HITS: 1,
    /* v5.00 swap (e6, one book): words, not abbreviations, that the published rulebook and its version history set in capitals
       (Appendix A's UNRESTRICTED and RESTRICTED free agents, v2.48's BASIC and FULL formats, v3.02's DELETE, v3.03's LIVE) */
    UNRESTRICTED: 1, RESTRICTED: 1, FOLLOWS: 1, LIVE: 1, DELETE: 1, ONE: 1, SUBMIT: 1, BASIC: 1, FULL: 1, NO: 1 };
  const ROUTES = { guest: ["#/today", "#/today?state=tonight", "#/today?state=offseason", "#/games", "#/game/" + gid, "#/standings?view=division", "#/standings?view=league", "#/standings?view=race", "#/standings?view=playoffs", "#/standings?view=power", "#/stats?tab=leaders", "#/stats?tab=skaters", "#/stats?tab=goalies", "#/stats?tab=teams", "#/stats?tab=players", "#/stats?tab=awards", "#/clubs", "#/clubs?view=moves", "#/club/BOS", "#/season", "#/season?season=1", "#/rulebook", "#/draft", "#/bidding", "#/camp", "#/you"],
    player: ["#/you?tab=week", "#/you?tab=season", "#/you?tab=inbox", "#/you?tab=applications", "#/you?tab=settings"],
    office: ["#/hq?tab=overview", "#/hq?tab=roster", "#/hq?tab=trades", "#/hq?tab=bidding", "#/hq?tab=lineups", "#/hq?tab=nights", "#/trade?with=BOS", "#/trade", "#/bidding", "#/camp", "#/draft"],
    staff: ["#/desk", "#/desk?tab=cases", "#/desk?tab=games", "#/desk?tab=applications", "#/desk?tab=people", "#/desk?tab=transactions", "#/desk?tab=newsroom", "#/desk?tab=committees", "#/desk/game/" + gid],
    commish: ["#/control", "#/control?tab=tonight", "#/control?tab=setup", "#/control?tab=growth", "#/control?tab=clubs", "#/control?tab=staff", "#/control?tab=system"] };
  const unnamed = {};
  for (const role of Object.keys(ROUTES)) {
    p = await page("#/today", { role });
    for (const r of ROUTES[role]) {
      await p.evaluate((h) => { location.hash = h; }, r); await wait(p, 450);
      const found = await p.evaluate((left) => { const tags = {}; S2.M.players.forEach((x) => { String(x.tag).split(/[\s]+/).forEach((w) => { tags[w] = 1; }); tags[x.tag] = 1; });
        const out = {}, tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
        while ((n = tw.nextNode())) { const pe = n.parentElement; if (!pe || /^(SCRIPT|STYLE|OPTION|TITLE)$/i.test(pe.tagName) || pe.closest(".sr, .avatar, .dc-av, .dk-kbd, svg title, #abbrTip")) continue;
          if (pe.closest("a[href^='#/player/']") && tags[n.nodeValue.trim()]) continue;
          n.nodeValue.split(/[\s·,;:()\[\]"“”!?]+/).forEach((raw) => { const w = raw.replace(/(?:['’]s)?\.*$/, ""); if (w.length < 2 || !/^[+-]?[A-Z0-9][A-Z0-9%/+\-.]*$/.test(w) || !/[A-Z]/.test(w)) return;
            if (left[w] || tags[w] || /^S\d+\.\d+$/.test(w) || S2.abbr.term(w)) return;
            if (/[-/]/.test(w) && w.split(/[-/]/).every((x) => !x || x.length < 2 || left[x] || S2.abbr.term(x))) return;
            out[w] = (out[w] || "") || (pe.tagName.toLowerCase() + "." + (pe.getAttribute("class") || "")); }); }
        return out; }, LEFT);
      Object.keys(found).forEach((w) => { unnamed[w] = unnamed[w] || []; if (unnamed[w].length < 2) unnamed[w].push(r + " " + found[w]); });
    }
    await p.close();
  }
  A("every abbreviation printed on every page has a name", Object.keys(unnamed).length === 0, unnamed);

  console.log("## from the review");
  {
    const q = await page("#/stats?tab=skaters");
    const at = await q.evaluate(() => { const b = [].filter.call(document.querySelectorAll("#skT thead th button"), (x) => x.textContent.trim() === "SOG")[0]; b.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = b.closest("th").getBoundingClientRect(), s = b.getBoundingClientRect(); return { x: s.left + s.width / 2, y: s.top + s.height / 2, thY: r.bottom - 1 }; });
    const title = () => q.evaluate(() => [].filter.call(document.querySelectorAll("#skT thead th button"), (x) => x.textContent.trim() === "SOG")[0].getAttribute("title"));
    await away(q); await wait(q, 400); await q.mouse.move(at.x, at.thY); await wait(q, 40); await q.mouse.move(at.x, at.y, { steps: 4 }); await wait(q, REST);
    t = await tip(q); const lent = await title();
    A("entering a heading through its padding lends the button's title too, so no native tooltip rises over the popup", t.open && lent === null, [t.text, lent]);
    await away(q); await wait(q, 200);
    A("...and the title comes back when the pointer leaves", (await title()) === "Shots on goal", await title());
    await q.keyboard.press("Shift");
    await q.evaluate(() => [].filter.call(document.querySelectorAll("#skT thead th button"), (x) => x.textContent.trim() === "GP")[0].focus()); await wait(q, 60);
    const gp = await tip(q);
    await q.mouse.move(at.x, at.y); await wait(q, 120);
    const sog = await tip(q);
    await away(q); await wait(q, 300);
    const back = await tip(q);
    A("focus on GP, the pointer over SOG and off again: the popup returns to the focused GP, never stuck on SOG", gp.open && sog.open && sog.text !== gp.text && back.open && back.text === gp.text, [gp.text, sog.text, back.text]);
    await q.keyboard.press("Escape"); await wait(q, 150);
    A("...and Escape still closes it", !(await tip(q)).open);
    await q.close();
    const w = await page("#/standings", { vw: 844 });
    const cdp = await w.context().newCDPSession(w); await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 47, bottom: 0, right: 47 } }); await wait(w, 200);
    t = await hoverText(w, "*", "CGHL");
    A("the popup keeps out of a notch, as the site's other fixed layers do", t && t.open && t.left >= 47, t && [t.text, t.left]);
    await w.close();
    const css = fs.readFileSync(path.join(S2_ROOT, "css/abbr.css"), "utf8");
    A("iOS keeps its link menu: the popup removes no touch callout from the site's links", !/touch-callout/.test(css));
  }

  console.log("## from the behavior review");
  {
    let q = await page("#/club/BOS?tab=stats");
    t = await hoverText(q, "th", "P↓");
    A("a sorted heading with a typed arrow keeps its popup", t && t.open && t.text === "Points", t);
    const arrow = await q.evaluate(() => { const s = [].filter.call(document.querySelectorAll("th span[aria-hidden]"), (x) => /[↑↓]/.test(x.textContent))[0], r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await q.mouse.move(arrow.x, arrow.y); await wait(q, 200);
    t = await tip(q);
    A("...and resting on the arrow itself keeps it too", t.open && t.text === "Points", t);
    await q.close();
    q = await page("#/club/BOS?tab=games");
    t = await hoverText(q, "i.pfx-res.w", "W");
    A("a W mark on a result row names itself, as OTL beside it does", t && t.open && t.text === "Win", t);
    await q.close();
    q = await page("#/desk?tab=transactions", { role: "staff" });
    t = await hoverText(q, ".dk-tx thead th", "G");
    A("G over a roster count says Goaltenders", t && t.open && t.text === "Goaltenders", t);
    await q.close();
    /* OT on a game tile: Season 1's Game Center draws the other games of its night as tiles ("Also that night"), each under
       an empty link that covers it; opened on a night with an overtime final, from another of its games */
    q = await page("#/today");
    const otg = await q.evaluate(() => { const n = S2.M.nights().filter((x) => x.games.length > 1 && x.games.some((g) => g.label === "Final/OT"))[0]; if (!n) return null;
      const ot = n.games.filter((g) => g.label === "Final/OT")[0]; return n.games.filter((g) => g.id !== ot.id)[0].id; });
    if (otg) { await q.evaluate((h) => { location.hash = h; }, "#/game/" + otg); await wait(q, 600); }
    const final = otg && await q.evaluate(() => { const rail = document.getElementById("tdRail"); if (!rail) return null;
      const w = document.createTreeWalker(rail, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.nodeValue.indexOf("Final/OT"); if (i < 0 || !n.parentElement.closest(".td-tile")) continue;
      n.parentElement.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); const r = document.createRange(); r.setStart(n, i + 6); r.setEnd(n, i + 8); const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2).className }; } return null; });
    if (final) { await away(q); await wait(q, 400); await q.mouse.move(final.x, final.y); await wait(q, REST); t = await tip(q);
      A("OT on a game tile reads through the tile's empty link", /td-tile-link/.test(final.top) && t.open && t.text === "Overtime", [final.top, t.text]); }
    else A("a tile with Final/OT was on the Game Center's rail to test", false, otg);
    await q.close();
    q = await page("#/trade?with=BOS", { role: "office" });
    t = await hoverText(q, "thead th", "OVR");
    A("OVR on the trade page says Overall rating", t && t.open && t.text === "Overall rating", t);
    await q.close();
    q = await page("#/stats?tab=skaters");
    /* a click on the sorted heading during the first wait repaints it: the popup still opens */
    const pb = await spot(q, "#skT thead th button", "P"); await wait(q, 60); await away(q); await wait(q, 400);
    await q.mouse.move(pb.x, pb.y); await wait(q, 100); await q.mouse.down(); await q.mouse.up(); await wait(q, 700);
    t = await tip(q);
    A("a repaint during the first wait does not cancel the popup", t.open && t.text === "Points", t);
    await away(q); await wait(q, 300);
    /* a keyboard popup comes back after a scroll only if its label is still on screen */
    await q.keyboard.press("Shift");
    await q.evaluate(() => { const b = [].filter.call(document.querySelectorAll("#skT thead th button"), (x) => x.textContent.trim() === "HIT")[0]; b.focus(); }); await wait(q, 80);
    const was = await tip(q);
    await q.mouse.wheel(0, 1800); await wait(q, 500);
    t = await tip(q);
    const off = await q.evaluate(() => document.activeElement.getBoundingClientRect().bottom);
    A("a keyboard popup does not float away from a heading scrolled off the screen", was.open && off < 0 && !t.open, [was.open, off, t.open, t.top]);
    await q.close();
    /* words in real sentences */
    q = await page("#/stats?tab=skaters");
    await q.evaluate(() => { const d = document.createElement("div"); d.id = "abbrProbe"; d.style.cssText = "position:fixed;left:40px;top:300px;z-index:50;background:#fff;font:16px sans-serif"; d.innerHTML = "<p>1 G · 8 A · 9 P</p><p>W 5-1</p><p>7 F (min 5)</p><p>Max 7, min 5</p><p>Took 5 min to load</p><p>Winner of DET vs NYI</p><p>Competitive 6v6 play</p><p>T-6th of 31</p>"; document.body.appendChild(d); });
    const said = async (w, i) => { const at = await q.evaluate(([w, i]) => { const n = document.querySelectorAll("#abbrProbe p")[i].firstChild, k = n.nodeValue.search(new RegExp("(^|[\\s(])" + w + "($|[\\s,])")), s = k + (n.nodeValue[k] === " " || n.nodeValue[k] === "(" ? 1 : 0), r = document.createRange(); r.setStart(n, s); r.setEnd(n, s + w.length); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, [w, i]); await away(q); await wait(q, 400); await q.mouse.move(at.x, at.y); await wait(q, REST); const v = await tip(q); return v.open ? v.text : null; };
    const cases = [["P", 0, "Points"], ["W", 1, "Win"], ["min", 2, "Minimum"], ["Max", 3, "Maximum"], ["min", 4, null], ["vs", 5, "Versus"], ["6v6", 6, "Six on six"], ["T-6th", 7, "Tied for 6th"]];
    for (const c of cases) { const v = await said(c[0], c[1]); A(c[0] + " in a sentence " + (c[2] ? "says " + c[2] : "is left alone"), v === c[2], v); }
    const terms = await q.evaluate(() => ({ fo: S2.abbr.term("FO%"), sh: S2.abbr.term("SH"), opp: S2.abbr.term("Opp") }));
    A("FO% in prose is the plain name, so it cannot contradict a club's figure; the player heading keeps its own title", terms.fo === "Faceoff percentage", terms);
    A("SH and Opp have names", terms.sh === "Shooting percentage" && terms.opp === "Opponent", terms);
    await q.close();
    /* a tap on a heading in a sideways-scrolled table */
    q = await page("#/club/BOS?tab=stats", { width: 375 });
    const side = await q.evaluate(() => { const s = document.getElementById("pfcTS"); s.scrollLeft = 100; const b = [].filter.call(s.querySelectorAll("thead th"), (x) => /^SOG/.test(x.textContent.trim()))[0]; b.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: s.scrollLeft }; });
    await wait(q, 200); await q.touchscreen.tap(side.x, side.y); await wait(q, 200);
    t = await tip(q);
    A("a tap on a heading in a sideways-scrolled table still shows its popup", t.open && t.text === "Shots on goal", [side.left, t.open, t.text]);
    await q.close();
  }

  console.log("## no errors");
  A("no console errors or page errors anywhere", errors.length === 0, errors.slice(0, 5));
  await browser.close();
  console.log(fails ? "FAILED " + fails : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
