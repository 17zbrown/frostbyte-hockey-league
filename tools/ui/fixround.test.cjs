const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* The November 23 review's design and copy fixes in the concept: node tools/ui/run.cjs fixround (needs the
   s2-concept server on S2_BASE (tools/ui/run.cjs)). Pins the roots the other suites do not: the kit's lock icon, the button
   press (.985, and none under Reduce Motion), the sheet header at 320 px, the ballot and server rows that wrap on a
   phone, the Glacier swatches as tokens, the concept notes and the tokens.css header, "Nominate an Assistant General
   Manager", the Rule 9.1 Cup wording, hyphens (never en dashes) in scores, recap counts in words to twenty, the ballot's
   citation and its line per voter. Reads only; every change is the demo's own in-page state.
   v5.00 swap (i3f, 2026-11-25): on the real site (the harness's live mode, tools/ui/mock): each page is signed in as the
   persona that holds its role, and the Season 1 checks open Season 1 (?season=1; Season 2 has no final yet). Deleted with
   demo mode, each with where it stands now: the concept page's Glacier swatches, its "Where things go" list and its
   Staffing decision (the #/concept page is gone); the ballot rows at 375 and the staffer and Detroit ballot pair (the real
   ballot's phone rows and a voter's own pool are pinned live in awards.test.cjs, i3b); the night recap's count in words
   (News reads the news table since e06a523, its text is the database's; today.test.cjs pins live News). Moved: "Nominate
   an Assistant General Manager" is pinned where the live AGM sheet opens (hq-market.test.cjs, after the draft). The
   frozen server row's 260 px basis is checked on a row built in the page, since no recorded night has a frozen server. */
const PW = process.env.PLAYWRIGHT || "/Users/zackbrown/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright";
const { chromium } = require(PW);
const mock = require(process.env.S2_MOCK);
/* the role a page is opened as, signed in as the harness persona that holds it */
const PERSONA = { guest: "anon", player: "member", office: "gm", staff: "staff", commish: "commissioner" };
const BASE = S2_BASE;
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch();
  const errors = [];
  async function page(hash, o) {
    o = o || {};
    const ctx = await b.newContext(Object.assign(o.w ? { viewport: { width: o.w, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } }, o.dark ? { colorScheme: "dark" } : {}));
    await mock.install(ctx, { live: true, persona: PERSONA[o.role || "player"] });
    await ctx.addInitScript((x) => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); if (x.dark) localStorage.setItem("s2.theme", JSON.stringify("dark")); } catch (e) { /* storage blocked */ } }, { dark: !!o.dark });
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(BASE + (o.query || "") + hash);
    await p.waitForFunction(() => window.S2 && S2.M && document.querySelector("#app section, #app header"));
    await wait(450);
    return p;
  }
  const done = (p) => p.context().close();
  const go = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await wait(450); };
  let p, r;

  console.log("## the kit: the lock icon, the press, the sheet header");
  p = await page("#/pickup-import", { role: "guest" });
  r = await p.evaluate(() => {
    const rules = [], walk = (list, media) => { for (const x of list) { if (x.cssRules && x.media) walk(x.cssRules, x.media.mediaText); else if (x.selectorText) rules.push({ sel: x.selectorText, media: media || "", t: x.style.transform, o: x.style.opacity }); } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules, ""); } catch (e) { /* cross-origin font sheet */ } }
    /* QA core 2026-11-25: a press is the independent scale property, so ONE Reduce Motion rule on every element removes
       every press (a descendant's too) and no positioning transform; the .btn press dims instead */
    const sheetRules = []; const walk2 = (list, media) => { for (const x of list) { if (x.cssRules && x.media) walk2(x.cssRules, x.media.mediaText); else if (x.selectorText) sheetRules.push({ sel: x.selectorText, media: media || "", s: x.style.getPropertyValue("scale"), imp: x.style.getPropertyPriority("scale"), o: x.style.opacity }); } };
    for (const sh of document.styleSheets) { try { walk2(sh.cssRules, ""); } catch (e) { /* cross-origin font sheet */ } }
    const press = sheetRules.filter((x) => x.sel.split(/,\s*/).indexOf(".btn:active") >= 0);
    return { icon: S2.ic("lock"), box: (document.querySelector(".empty-state.lock .empty-ic svg") || {}).outerHTML || "",
      plain: press.filter((x) => !x.media).map((x) => x.s), transforms: press.filter((x) => !x.media).map((x) => rules.filter((y) => y.sel === x.sel && !y.media).map((y) => y.t).join("")).join(""),
      reduced: press.filter((x) => /reduce/.test(x.media)).map((x) => x.o),
      noScale: sheetRules.some((x) => /reduce/.test(x.media) && /^\*, (\*)?::before, (\*)?::after$/.test(x.sel) && x.s === "none" && x.imp === "important") };
  });
  A("core's icon set has a lock, so every lock state box draws one (review 2026-11-23: an empty gray disc)", /<svg[^>]*>.*<\/svg>/.test(r.icon) && /<path|<rect|<circle/.test(r.icon), r.icon.slice(0, 120));
  A("the guest state on Pickup import draws the lock", /<svg/.test(r.box), r.box.slice(0, 120));
  A("a button press scales to .985, and under Reduce Motion it dips in opacity instead", r.plain.join() === "0.985" && !r.transforms && r.reduced.join() === "0.7" && r.noScale, r);
  await done(p);
  p = await page("#/today", { w: 320 });
  await p.evaluate(() => S2.confirm({ title: "Waive Fourthgen_trucks_are_on_top?", ok: "Put on waivers", cancel: "Keep Fourthgen_trucks_are_on_top", why: ["A long name, as the waiver popup draws it."] })); await wait(500);
  r = await p.evaluate(() => { const s = [...document.querySelectorAll(".sheet")].pop(), x = s.querySelector("[data-close]").getBoundingClientRect(), h = s.querySelector(".sheet-h h2").getBoundingClientRect();
    return { right: x.right, left: x.left, h2: h.right, sheetScroll: s.scrollWidth - s.clientWidth, page: document.documentElement.scrollWidth - innerWidth }; });
  A("a long unbreakable sheet title wraps at 320 px and Close stays on screen", r.right <= 320 && r.left >= 0 && r.h2 <= r.left + 1 && r.sheetScroll <= 1 && r.page <= 1, r);
  await done(p);

  console.log("## rows that wrap on a phone");
  p = await page("#/hq?tab=nights", { role: "office", w: 375 });
  r = await p.evaluate(() => {
    /* the row as hq.js draws a frozen server (a .hqx-srv list, a .row, its settled text), built here: no recorded night has one */
    const list = document.createElement("div"); list.className = "list hqx-list hqx-srv"; list.innerHTML = '<div class="row hqx-srv-r"><span class="grow hqx-srv-s">NA Central</span></div>';
    document.getElementById("page").appendChild(list);
    const f = getComputedStyle(list.querySelector(".hqx-srv-s")); const out = { grow: f.flexGrow, basis: f.flexBasis }; list.remove(); return out;
  });
  A("a frozen server row's settled text keeps its 260 px basis over the kit's .row .grow, so the row wraps", r && r.grow === "2" && r.basis === "260px", r);
  await done(p);

  console.log("## the tokens");
  p = await page("#/today", { role: "player", dark: true });
  r = await p.evaluate(async () => (await (await fetch("css/tokens.css")).text()).split("*/")[0]);
  A("tokens.css's header says Glacier is the one finish", /The finish is Glacier, the one accent/.test(r) && !/switchable/.test(r), r);
  await done(p);

  console.log("## words (Season 1, which has its final)");
  p = await page("#/today", { role: "player", query: "?season=1" });
  const cupP = await p.evaluate(() => { const c = S2.M.seasonClose(1).cup; const pl = S2.M.player(c[0].id || c[0].pid || c[0]); return pl && pl.href; });
  await go(p, cupP);
  r = await p.evaluate(() => document.getElementById("page").textContent);
  /* QA nits 9 (2026-11-25): the words stay (the November 21 ruling), but not under "(Rule 9.1)": the live book's 9.1 says only
     that the championship trophy goes to the playoff champion, so the sentence cites no rule until the book carries it */
  const b91 = await p.evaluate(() => { for (const c of S2.RB.chapters) for (const x of c.sections) if (x.id === "9.1") return x.paragraphs.join(" "); return ""; });
  A("a Cup holder's profile says the ruling's words: the roster or the training camp when the final is decided, citing 9.1 only if 9.1 says it", /on the champion's roster or in its training camp when the final is decided/.test(r) && !/roster at the final/.test(r) &&
    (/training camp/.test(b91) || !/when the final is decided \(Rule 9\.1\)/.test(r)), cupP);
  /* i3f: Season 1 is over, so Today is its off-season scene with no score in its prose; the same prose helper (today.js
     scoreSpan) writes the Game Center's series and shots lines, read here on a Season 1 final */
  await go(p, await p.evaluate(() => S2.M.games.filter((g) => g.isFinal)[0].href));
  r = await p.evaluate(() => [...document.querySelectorAll("#page .td-nw")].map((e) => e.textContent));
  A("scores in Today's prose (the Game Center's lines) use a hyphen, never an en dash", r.length > 0 && r.every((x) => /^\d+-\d+$/.test(x)), r);
  await done(p);

  console.log("## the ballot");
  p = await page("#/stats?tab=awards", { role: "player" });
  r = await p.evaluate(() => document.getElementById("hvote").parentNode.textContent);
  A("the citation backs the vote, not the secrecy: '(Rule 9.2). Nobody sees the tally.'", /until the award is decided \(Rule 9\.2\)\. Nobody sees the tally\./.test(r) && !/tally \(Rule 9\.2\)/.test(r), r.slice(0, 200));
  await done(p);

  A("no console errors", errors.length === 0, errors.slice(0, 5));
  await b.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
