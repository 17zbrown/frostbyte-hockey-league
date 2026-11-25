const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* The header search, the shell's shared parts and the guest's join door, proved in headless Chromium:
   node tools/ui/run.cjs search. Audit 2026-11-09. Commissioner, 2026-11-09: "The main search box should be able to
   search anything available to the player searching based on their league role. This includes showing rulebook items."
   (js/search.js, js/core.js S2.palette, S2.confirm, S2.toast, S2.empty, S2.joinSheet in js/flows.js.)
   The real site (i3a, 2026-11-25): node tools/ui/run.cjs --suite search --mode live. Every context is
   mock.install(ctx, {live: true, persona}): the page as the build ships it, the recorded league read, js/live.js signed in
   as the persona (guest = anon, player = member, commish = commissioner), so a role is the session's, never the dock's.
   Deleted with demo mode: "S2.override starts on Not now" (S2.override is a demo device) and "joining signs the tab in as
   a player" (the real Join goes to Discord's sign-in, checked below instead). Nothing here deploys, publishes or touches
   the database. */
const mock = require(process.env.S2_MOCK);
const PERSONA = { guest: "anon", player: "member", commish: "commissioner", office: "gm", staff: "staff" };
/* the league as production answered anonymously on 2026-11-24 (18:12 UTC, after the Season 2 row took its $30M cap; the
   harness's shared Season 2 recording is older and still reads $50M), Season 1 beside it (private fixtures, never in git) */
const FIX = require("path").join(require("os").homedir(), "Developer/cghl-private/fixtures");
const LEAGUE = { 2: JSON.parse(require("fs").readFileSync(require("path").join(FIX, "s2_league-anon-2026-11-24b-current.json"), "utf8")),
  1: JSON.parse(require("fs").readFileSync(require("path").join(FIX, "s2_league-anon-2026-11-24b-season1.json"), "utf8")) };
function s2League(a) {
  const n = a.p_season == null ? 2 : +a.p_season, b = LEAGUE[n];
  if (!b) return mock.fail("P0002", "no season " + n);
  if (!a.p_sections) return mock.ok(b);
  return mock.ok(Object.assign({ generated: b.generated, source: b.source, season: b.season, sections: a.p_sections, pulse: b.pulse }, ...a.p_sections.map((k) => ({ [k]: b[k] }))));
}
const PW = process.env.PLAYWRIGHT || "/Users/zackbrown/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright";
const { chromium } = require(PW);
const BASE = S2_BASE;
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (more !== undefined ? "  (" + JSON.stringify(more) + ")" : "")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  /* the survey stays shut (season_survey_done answers true), so no pop-up opens over a check */
  async function signedIn(role, vp, hash) {
    const ctx = await browser.newContext({ viewport: vp || { width: 1440, height: 900 } });
    await mock.install(ctx, { live: true, persona: PERSONA[role], rpcs: { season_survey_done: mock.ok(true), s2_league: s2League } });
    /* Discord's sign-in page stands in for the league's authorize redirect (a Join press leaves for it) */
    await ctx.route(/\/auth\/v1\/authorize\?/, (rt) => rt.fulfill({ status: 200, contentType: "text/html", body: "<p>Discord sign-in</p>" }));
    await ctx.addInitScript(() => {
      try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.theme", '"light"');
        localStorage.setItem("s2.surveyLoadDay", new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })); } catch (e) {}
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await p.goto(BASE + (hash || "#/today"));
    await p.waitForFunction((r) => window.S2 && S2.LIVE && S2.search && S2.$("#page") && S2.$("#page").children.length > 0 && S2.state.role === r, role, { timeout: 30000 }); await wait(200);
    return p;
  }
  const page = (role, vp) => signedIn(role, vp);
  const hrefs = (p, q) => p.evaluate((x) => S2.search(x).reduce((a, g) => a.concat(g.items.map((i) => i.href)), []), q);
  const groups = (p, q) => p.evaluate((x) => S2.search(x).map((g) => g.label), q);
  const staffDoor = (h) => /^#\/(desk|control|hq)\b/.test(h);

  console.log("## the search offers only doors the role can open");
  let p = await page("guest");
  let h = await hrefs(p, "desk");
  A("a guest's search for desk finds no staff door", !h.some(staffDoor), h);
  h = await hrefs(p, "cases");
  A("a guest's search for cases finds no Staff Desk or Action Center door", !h.some((x) => staffDoor(x) || /tab=inbox/.test(x)), h);
  h = await hrefs(p, "waiver");
  A("waiver finds Rule S2.5 for a guest too (the rulebook is public)", h.indexOf("#/rulebook?rule=S2.5") >= 0, h);
  await p.context().close();

  p = await page("player");
  h = await hrefs(p, "lineup");
  A("a player's search finds no Team HQ door", !h.some(staffDoor), h);
  await p.context().close();

  p = await page("commish");
  h = await hrefs(p, "desk");
  A("a commissioner's search for desk finds the Staff Desk", h.indexOf("#/desk") >= 0, h);
  A("results come grouped, workspaces under Workspaces", (await groups(p, "desk")).indexOf("Workspaces") >= 0, await groups(p, "desk"));
  h = await hrefs(p, "control");
  A("a commissioner finds the Control Center", h.indexOf("#/control") >= 0, h);
  const g = await groups(p, "S2.6");
  A("a rule number finds its rule, under Rules", g.indexOf("Rules") >= 0 && (await hrefs(p, "S2.6")).indexOf("#/rulebook?rule=S2.6") >= 0, g);

  console.log("## the palette draws the groups, marks the words and opens a rule at that rule");
  await p.keyboard.press("Meta+k"); await wait(150);
  if (!(await p.$(".palette"))) { await p.keyboard.press("Control+k"); await wait(150); }
  await p.fill(".palette input", "waiver"); await wait(150);
  const pal = await p.evaluate(() => ({ heads: S2.$$(".palette .pal-gh").map((x) => x.textContent), marks: S2.$$(".palette mark").length,
    /* v5.00 swap (e6): the label, not the whole option: in the full book other rules' snippets quote "(Rule S2.5)" */
    rule: S2.$$(".palette [role=option] .pal-l").map((b) => b.textContent).filter((t) => /^Rule S2\.5 · /.test(t)).length, ad:S2.$(".palette input").getAttribute("aria-activedescendant") }));
  A("the palette shows group heads, marked words and the rule", pal.heads.indexOf("Rules") >= 0 && pal.marks > 0 && pal.rule === 1 && !!pal.ad, pal);
  const idx = await p.evaluate(() => S2.$$(".palette [role=option]").findIndex((b) => /Rule S2\.5/.test(b.textContent)));
  for (let i = 0; i < idx; i++) await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter"); await wait(700);
  const at = await p.evaluate(() => ({ hash: location.hash, focus: document.activeElement && document.activeElement.id }));
  A("Enter on the rule opens the rulebook at Rule S2.5", /#\/rulebook\?rule=S2\.5/.test(at.hash) && at.focus === "rb-S2.5", at);
  await p.context().close();

  console.log("## the shared parts");
  p = await page("commish");
  const cf = await p.evaluate(() => { var hit = 0; S2.confirm({ title: "Test", why: "Why", ok: "Do it", danger: true, onOk: function () { hit++; } }); return new Promise((r) => setTimeout(() => r({ focus: document.activeElement.textContent, hit: hit }), 120)); });
  A("S2.confirm puts focus on the safe button", cf.focus === "Cancel" && cf.hit === 0, cf);
  await p.click('[data-cf="ok"]'); await wait(300);
  A("its action runs and the sheet closes", !(await p.$(".sheet [data-cf]")));
  const t = await p.evaluate(() => { var undone = 0; S2.toast("Case closed", "ok", { group: "undo", action: { label: "Undo", run: function () { undone++; window.__u = 1; } } }); S2.toast("Case moved", "ok", { group: "undo", action: { label: "Undo", run: function () {} } });
    return { n: S2.$$('.toast[data-group="undo"]').length, btn: !!S2.$('.toast[data-group="undo"] .toast-act') }; });
  A("an action toast replaces its own group: one Undo at a time", t.n === 1 && t.btn, t);
  const err = await p.evaluate(() => { S2.toast("A long refusal reason that must stay on screen long enough to read", "err"); var e = S2.$(".toast.err"); return { role: e.parentNode.getAttribute("role"), tag: e.tagName }; });
  A("an error toast is announced as an alert and closes on a tap", err.role === "alert" && err.tag === "BUTTON", err);
  const em = await p.evaluate(() => S2.empty("none", "Nothing yet", "A sentence.", '<button class="btn">Go</button>'));
  A("S2.empty draws the one state box", /class="empty-state none"/.test(em) && /empty-acts/.test(em), em.slice(0, 60));
  const w = await p.evaluate(() => { var b = S2.$('#navbar [data-count="work"]'); return b ? { n: S2.$(".nav-count", b).textContent, hidden: S2.$(".nav-count", b).hidden } : null; });
  A("the Workspaces trigger carries the waiting count", !!w && (w.hidden ? w.n === "" : +w.n > 0), w);
  await p.context().close();

  console.log("## a guest at a member door meets Join with Discord, then the form");
  p = await page("guest", { width: 390, height: 800 });
  await p.click(".topstrip"); await wait(450);
  const js = await p.evaluate(() => ({ title: (S2.$(".sheet .sheet-h h2") || {}).textContent, first: (document.activeElement || {}).textContent, lock: !!S2.$(".sheet .lk-who") }));
  A("the sheet leads with Join with Discord and no lock language", js.first === "Join with Discord" && !js.lock, js);
  /* the real Join: Discord's sign-in through the league's auth (js/live.js S2.signIn), identify only, coming back here */
  const auth = p.waitForRequest((r) => /\/auth\/v1\/authorize\?/.test(r.url()), { timeout: 8000 }).then((r) => new URL(r.url()), () => null);
  await p.click(".sheet [data-join]");
  const au = await auth;
  A("Join with Discord goes to the league's Discord sign-in (identify only), back to this page", !!au && au.searchParams.get("provider") === "discord" && au.searchParams.get("scopes") === "identify" && /demo\.html/.test(au.searchParams.get("redirect_to") || ""), au && au.href);
  await p.context().close();

  /* v5.00 swap (e6, one book; main session 2026-11-24): the rulebook page is the live book, S2.RB from js/rulebook.js
     (tools/s2-rulebook-js-build.cjs renders src/live/part3_content.js with the live CG.rulebookForFormat; the drift test in
     npm test keeps it current). Here: the page shows exactly that book, and search reads it */
  console.log("## the one book: the rulebook page is the live book, word for word");
  /* the season on screen: Season 2 (the current season, the recorded live read) or ?season=1 (the recorded Season 1 read) */
  const open = (hash, season) => signedIn("guest", null, (season ? "?season=" + season : "") + hash);
  const book = (pg) => pg.evaluate(() => {
    const RB = S2.RB, fill = S2._league.rbText, num = (x) => x.querySelector(".lg-rb-pn").textContent.length;
    const page = [...document.querySelectorAll(".lg-rb-ch")].map((ch) => ({ kick: ch.querySelector(".lg-rb-cht .kicker").textContent, title: ch.querySelector(".lg-rb-cht .d-2").textContent,
      intro: (ch.querySelector(".lg-rb-intro") || {}).textContent || null,
      secs: [...ch.querySelectorAll(".lg-rb-sec")].map((s) => ({ id: s.dataset.rule, title: s.querySelector(".lg-rb-st").childNodes[1].textContent, chip: (s.querySelector(".lg-rb-chip") || {}).textContent || null,
        p: [...s.querySelectorAll(".lg-rb-p")].map((x) => x.textContent.slice(num(x))) })) }));
    const want = RB.chapters.map((c) => ({ kick: (c.shelved ? "Appendix " : "Chapter ") + c.num, title: c.title, intro: c.intro || null,
      secs: c.sections.map((s) => ({ id: s.id, title: s.title, chip: c.shelved ? "Shelved" : null, p: s.paragraphs.map(fill) })) }));
    const n = (b) => [b.length, b.reduce((a, c) => a + c.secs.length, 0)];
    return { same: JSON.stringify(page) === JSON.stringify(want), counts: n(page), want: n(want), version: RB.version, head: document.querySelector(".lg-hero .kicker").textContent,
      toc: document.querySelectorAll(".lg-rb-side .lg-toc-a").length, last: page.length ? page[page.length - 1].kick : null, s2: page.filter((c) => c.kick === "Chapter S2")[0] || null,
      r25: (page.reduce((a, c) => a.concat(c.secs), []).filter((x) => x.id === "2.5")[0] || { p: [""] }).p[0], cap: S2.M.control.season(S2.M.view.season).settings.salary_cap,
      stale: /\{\{|Proposed|Abridged|About this edition/.test(document.getElementById("page").textContent) };
  });
  p = await open("#/rulebook", 1);
  let rb = await book(p);
  A("every chapter and section of the live book, in its order, with its words (" + rb.counts.join(" chapters, ") + " sections)", rb.same && JSON.stringify(rb.counts) === JSON.stringify(rb.want), [rb.counts, rb.want]);
  A("thirteen chapters: 0 to 10, S2, then Appendix A last, its every section marked Shelved", rb.counts[0] === 13 && rb.last === "Appendix A", rb.last);
  A("Chapter S2 keeps its stored title and intro", !!rb.s2 && rb.s2.title === "Season 2: what changes" && /^These provisions govern Season 2\./.test(rb.s2.intro || ""), rb.s2 && rb.s2.title);
  A("the contents list every section, and the hero names the live version", rb.toc === rb.counts[1] && rb.head === "Rulebook, version " + rb.version, [rb.toc, rb.head]);
  A("Rule 2.5 states the cap of the season on screen ($50M for Season 1), never the token", rb.r25.indexOf("The cap for the current season is $50M.") >= 0 && rb.cap === 50000000, rb.r25.slice(0, 200));
  A("no proposed text, no abridged-edition words and no raw token anywhere on the page", !rb.stale);
  await p.context().close();

  p = await open("#/rulebook");
  rb = await book(p);
  A("Season 2 on screen: the same book, and Rule 2.5 states Season 2's cap ($30M)", rb.same && rb.r25.indexOf("The cap for the current season is $30M.") >= 0 && rb.cap === 30000000, rb.r25.slice(0, 200));
  console.log("## live mode: search reads the model and the book");
  const live = await p.evaluate(() => {
    const flat = (q) => S2.search(q).reduce((a, g) => a.concat(g.items.map((i) => [g.label, i.href])), []);
    const someone = S2.M.signups.map((x) => x.player).filter((pl) => pl && pl.tag && pl.tag.length > 3)[0];
    return { view: S2.M.view.name, club: flat("bruins"), page: flat("standings"), pickups: flat("pickup games"), player: someone ? flat(someone.tag) : [], href: someone ? someone.href : null,
      rule: flat("waiver"), shelved: flat("free agency").concat(flat("A.2")).filter((x) => /rule=A\./.test(x[1])) };
  });
  A("live: a club is found from the model's clubs", live.view === "Season 2" && live.club.some((x) => x[0] === "Clubs" && x[1] === "#/club/BOS"), live.club);
  A("live: a page is found", live.page.some((x) => x[0] === "Pages" && x[1] === "#/standings"), live.page);
  A("live: the Pickup games page is found (js/pages/pickups.js, public)", live.pickups.some((x) => x[0] === "Pages" && x[1] === "#/pickups"), live.pickups);
  A("live: a member signed up for Season 2 is found under Players (the example read from the model)", !!live.href && live.player.some((x) => x[0] === "Players" && x[1] === live.href), live.href);
  A("live: a rule is found in the live book; Appendix A's shelved text is never offered", live.rule.some((x) => x[1] === "#/rulebook?rule=S2.5") && live.shelved.length === 0, live.shelved);
  await p.context().close();

  A("no console or page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? "\n" + fails + " of " + n + " FAILED" : "\n" + n + "/" + n + " passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
