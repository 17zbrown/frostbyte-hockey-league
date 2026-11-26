const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* The header's menus and the Action Center, proved in headless Chromium: node tools/ui/run.cjs nav
   Commissioner, 2026-10-23: "In the concept, I dont see an action center button in the header tab. Can you think of some
   styles and categories we could make to make some space for the action center by adding dropdowns?", then "Create what
   you think would be the best for organization and for any future expansion. Continue our trend of working hard to make
   it feel built in and really part of the site's style." (js/core.js S2.NAV, S2.nav; css/ui.css "header v2".) Needs the
   s2-concept server on S2_BASE (tools/ui/run.cjs) (.claude/launch.json). Nothing here deploys, publishes or touches the
   database.
   v5.00 swap (i3f, 2026-11-25): on the real site (the harness's live mode, tools/ui/mock). A role is the signed-in
   persona's: p.role signs the context in as the persona that holds it and reloads (the concept's S2.setRole is gone).
   Deleted with demo mode, each a demo device: the concept viewer's sign-in (window.S2_VIEWER; a GM's real sign-in keeps
   its check below), the sample answered case c-floor (its Action Center badge "1", its panel row with the sample mark,
   and reading it to clear the badge; the real Inbox holds alerts only until action_requests is ported, js/inbox.js), and
   the Gold and Ember finishes (Glacier is the one finish, 2026-11-23; nothing on the site can choose another). A role
   switch with a menu open, and five role switches, are now the shell repaint js/live.js makes when a session lands. */
const PW = process.env.PLAYWRIGHT || "/Users/zackbrown/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright";
const { chromium } = require(PW);
const BASE = S2_BASE;
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (more !== undefined ? "  (" + JSON.stringify(more) + ")" : "")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ROLES = ["guest", "player", "office", "staff", "commish"];
const mock = require(process.env.S2_MOCK);
/* the role a page is opened as, signed in as the harness persona that holds it */
const PERSONA = { guest: "anon", player: "member", office: "gm", staff: "staff", commish: "commissioner" };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function page(opts) {
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, reducedMotion: opts.reduce ? "reduce" : "no-preference" });
    await mock.install(ctx, { live: true, persona: PERSONA[opts.role || "player"] });
    await ctx.addInitScript(() => {
      try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.theme", '"light"');
        localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-10-23T00:00:00.000Z", from: "daily" })); } catch (e) {}   /* the survey's own pop-up is tested elsewhere; here it is already answered */
    });
    const p = await ctx.newPage();
    /* the browser's own line for any non-2xx answer is not the page's error (the staffing flip's tables answer 404 before it lands) */
    p.on("pageerror", (e) => errors.push(String(e))); p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const booted = () => p.waitForFunction(() => window.S2 && S2.$ && S2.$("#navbar") && S2.$("#page") && S2.$("#page").children.length > 0);
    p.go = async (hash, query) => { await p.goto(BASE + (query || "") + hash); await booted(); await wait(200); };
    /* a role is a sign-in: the persona that holds it, then the same address loaded again (a goto that changes only the
       hash would not reload, and the persona is injected as the page loads) */
    p.role = async (r) => { await mock.install(ctx, { live: true, persona: PERSONA[r] }); await p.reload(); await booted(); await wait(350); };
    return p;
  }
  /* every link the open panel offers, as [text, href, flow, type] */
  const panelLinks = (p, id) => p.$$eval("#navP-" + id + " a[href]", (l) => l.map((a) => [a.querySelector(".nav-lt, span") ? a.querySelector(".nav-lt, span").textContent : a.textContent, a.getAttribute("href"), a.dataset.flow || "", a.dataset.type || ""]));
  /* the concept's own toasts and its survey sheet are not under test: clear them so they never sit over a trigger */
  const open = async (p, id) => { await p.evaluate(() => { while (S2.layer.top()) S2.layer.top().close(); S2.$$(".toast").forEach((t) => t.remove()); }); await wait(250); await p.click("#navT-" + id); await wait(350); };

  console.log("## the bar fits every role at 1180, the phone menu takes over at 1179");
  let p = await page({ viewport: { width: 1180, height: 800 } });
  await p.go("#/today");
  for (const r of ROLES) {
    await p.role(r);
    const m = await p.evaluate(() => {
      const ni = S2.$(".nav-in"), cs = getComputedStyle(ni), edge = ni.getBoundingClientRect().right - parseFloat(cs.paddingRight);
      return { sw: document.documentElement.scrollWidth, act: S2.$(".nav-act").getBoundingClientRect().right, edge: edge, spare: S2.$(".nav-spacer").getBoundingClientRect().width,
        labels: S2.$$("#navbar .nav-l").map((e) => e.textContent) };
    });
    A(r + ": the bar fits with room to spare (" + Math.round(m.spare) + "px)", m.sw <= 1180 && m.act <= m.edge + 0.5 && m.spare >= 24, m);
    const want = { guest: ["Today", "Games", "League", "Season", "Rulebook"], player: ["Today", "Games", "League", "Season", "Rulebook", "Action Center"],
      office: ["Today", "Games", "League", "Season", "Rulebook", "Team HQ", "Action Center"], staff: ["Today", "Games", "League", "Season", "Rulebook", "Staff Desk", "Action Center"],
      commish: ["Today", "Games", "League", "Season", "Rulebook", "Workspaces", "Action Center"] }[r];
    A(r + ": the bar reads " + want.join(", "), m.labels.join() === want.join(), m.labels);
  }
  await p.setViewportSize({ width: 1179, height: 800 }); await wait(150);
  A("at 1179 the menu button shows and the bar's links do not", await p.evaluate(() => getComputedStyle(S2.$("#menuBtn")).display !== "none" && getComputedStyle(S2.$(".nav-links")).display === "none"));
  await p.context().close();

  console.log("## what each role is offered");
  p = await page({ role: "commish" });
  await p.go("#/today");
  const offered = {};
  for (const r of ROLES) {
    await p.role(r);
    const o = {};
    for (const id of ["league", "season", "work", "action"]) {
      if (!(await p.$("#navT-" + id))) continue;
      await open(p, id);
      o[id] = await panelLinks(p, id);
      o[id + "H"] = await p.$$eval("#navP-" + id + " .nav-h", (l) => l.map((e) => e.textContent));
      await p.keyboard.press("Escape"); await wait(100);
    }
    offered[r] = o;
  }
  const has = (r, id, t) => !!(offered[r][id] || []).some((l) => l[0] === t);
  A("Statistics correction and Forfeit appeal only for a front office and a commissioner",
    ROLES.every((r) => has(r, "action", "Statistics correction") === (r === "office" || r === "commish") && has(r, "action", "Forfeit appeal") === (r === "office" || r === "commish")));
  A("Saturday bidding only for a front office and a commissioner", ROLES.every((r) => has(r, "season", "Saturday bidding") === (r === "office" || r === "commish")));
  A("Own a club and Join the staff are not offered to the league office", ROLES.every((r) => has(r, "season", "Own a club") === !(r === "staff" || r === "commish") && has(r, "season", "Join the staff") === !(r === "staff" || r === "commish")));
  A("Join with Discord only for a guest", ROLES.every((r) => has(r, "season", "Join with Discord") === (r === "guest")));
  A("a guest has no Action Center and no workspaces", !offered.guest.action && !offered.guest.work);
  A("the workspaces menu holds one column per workspace held",
    offered.office.workH.join() === "Front office" && offered.staff.workH.join() === "League staff" && offered.commish.workH.join() === "Front office,League staff,Commissioners", [offered.office.workH, offered.staff.workH, offered.commish.workH]);
  A("each workspace column lists its own tabs from its page", has("commish", "work", "Roster & cap") && has("commish", "work", "Committees") && has("commish", "work", "Growth and retention") && !has("commish", "work", "Growth &amp; retention"));
  const pages = await p.evaluate(() => Object.keys(S2.pages)), flows = await p.evaluate(() => Object.keys(S2.flows));
  const all = [].concat.apply([], ROLES.map((r) => [].concat.apply([], Object.keys(offered[r]).filter((k) => !/H$/.test(k)).map((k) => offered[r][k]))));
  /* a link to another season carries its query before the hash (S2.seasonHref: "?season=1#/standings"), so the page is
     read from the hash part; a link with no hash at all is dead */
  const pageOf = (h) => (h.indexOf("#/") < 0 ? "" : h.slice(h.indexOf("#/") + 2).split(/[?\/]/)[0]);
  const dead = all.filter((l) => pages.indexOf(pageOf(l[1])) < 0 || (l[2] && flows.indexOf(l[2]) < 0));
  A("every menu link goes to a page the concept has, and every form it opens exists (" + all.length + " links)", all.length > 100 && !dead.length, dead);
  A("every case type the Action Center offers is one the form takes", ROLES.every((r) => (offered[r].action || []).filter((l) => l[2] === "case").every((l) => l[3])));
  await p.context().close();

  console.log("## a club manager's own sign-in (a GM): Season 1 on screen, where their club has games");
  p = await page({ role: "office" });
  await p.go("#/today", "?season=1");
  for (const id of ["league", "season", "work", "action"]) { if (await p.$("#navT-" + id)) { await open(p, id); await p.keyboard.press("Escape"); await wait(80); } }
  await p.setViewportSize({ width: 390, height: 844 }); await wait(200);
  await p.click("#menuBtn"); await wait(300);
  for (const id of ["league", "season", "work", "action"]) { if (await p.$('.sm-g[data-g="' + id + '"]')) { await p.click('.sm-g[data-g="' + id + '"]'); await wait(300); await p.click("#smL-" + id + " .sm-back"); await wait(300); } }
  A("no door to the Staff Desk or the Control Center anywhere in the header or the menu", (await p.$$('#navbar a[href^="#/desk"], #navbar a[href^="#/control"], #siteMenu a[href^="#/desk"], #siteMenu a[href^="#/control"]')).length === 0);
  const own = await p.evaluate(() => { const f = S2.flows.case.steps[1].fields.filter((x) => x.k === "game")[0], g = (id) => S2.M.game(id);
    return { club: S2.session.teamCode, games: f.opts({ type: "stats_correction" }).filter((o) => g(o[0])).map((o) => g(o[0]).home + "-" + g(o[0]).away) }; });
  A("a statistics correction lists the manager's own club's games, not another club's", !!own.club && own.games.length > 0 && own.games.every((x) => x.split("-").indexOf(own.club) >= 0), own.games.slice(0, 4));
  await p.context().close();

  console.log("## a mouse: intent, switching, leaving, pinning");
  p = await page({ role: "player" });
  await p.go("#/today");
  const box = async (sel) => { const b = await p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }); return b; };
  const st = () => p.evaluate(() => ({ league: S2.$("#navT-league").getAttribute("aria-expanded"), season: S2.$("#navT-season").getAttribute("aria-expanded"), on: document.documentElement.classList.contains("nav-open"),
    lp: !S2.$("#navP-league").hidden, sp: !S2.$("#navP-season").hidden }));
  let b = await box("#navT-league");
  await p.mouse.move(b.x, b.y); await wait(80);
  A("a pointer passing over League does not open it", (await st()).league === "false");
  await wait(220);
  let s = await st();
  A("resting on League opens it", s.league === "true" && s.on && s.lp, s);
  b = await box("#navT-season"); await p.mouse.move(b.x, b.y, { steps: 3 }); await wait(160);
  s = await st();
  A("moving to Season switches at once, League's panel goes", s.season === "true" && s.sp && !s.lp && s.league === "false", s);
  await p.mouse.move(b.x, 640, { steps: 4 }); await wait(500);
  A("leaving the bar for the page closes it", !(await st()).on);
  b = await box("#navT-league"); await p.mouse.move(b.x, b.y); await wait(260); await p.mouse.click(b.x, b.y); await wait(50);
  await p.mouse.move(b.x, 640, { steps: 4 }); await wait(600);
  A("a click pins a menu the mouse opened: it stays open after the pointer leaves", (await st()).league === "true");
  const h0 = await p.evaluate(() => location.hash);
  await p.mouse.click(700, 760); await wait(300);
  A("a click on the dimmed page closes it and goes nowhere", !(await st()).on && (await p.evaluate(() => location.hash)) === h0);
  /* review 2026-10-23: a click on a menu a hover switch opened from a pinned one closed it */
  b = await box("#navT-league"); await p.mouse.click(b.x, b.y); await wait(100);
  b = await box("#navT-season"); await p.mouse.move(b.x, b.y, { steps: 3 }); await wait(200); await p.mouse.click(b.x, b.y); await wait(100);
  s = await st();
  A("click League, rest on Season, click Season: Season stays open", s.season === "true" && s.on, s);
  await p.mouse.click(b.x, b.y); await wait(250);
  A("and a second click closes it", !(await st()).on);
  /* review 2026-10-23: moving within the trigger just closed must not bring the menu back */
  await p.mouse.move(b.x + 14, b.y); await wait(300);
  A("moving within a trigger whose menu was just closed does not reopen it", !(await st()).on);
  /* review 2026-10-23: the fading dim swallowed a click meant for the page */
  await p.mouse.move(700, 640); await wait(200);
  b = await box("#navT-league"); await p.mouse.move(b.x, b.y); await wait(260); await p.mouse.move(700, 640, { steps: 2 }); await wait(290);
  A("once closed, the fading dim lets a click through to the page", await p.evaluate(() => !document.documentElement.classList.contains("nav-open") && document.elementFromPoint(700, 640) !== S2.$("#navDim")));
  await wait(300);
  /* review 2026-10-23: a keyboard reader inside a hover-opened panel lost it (and focus) when the mouse wandered off */
  b = await box("#navT-league"); await p.mouse.move(b.x, b.y); await wait(260);
  await p.focus("#navT-league"); await p.keyboard.press("Tab"); await wait(50);
  await p.mouse.move(700, 700, { steps: 3 }); await wait(500);
  A("keyboard focus in a hover-opened panel pins it", (await st()).league === "true" && (await p.evaluate(() => !!document.activeElement.closest("#navP-league"))));
  await p.keyboard.press("Escape"); await wait(100);

  console.log("## a keyboard");
  await p.focus("#navT-league"); await p.keyboard.press("Enter"); await wait(60);
  let k = await p.evaluate(() => ({ x: S2.$("#navT-league").getAttribute("aria-expanded"), kb: S2.$("#navbar").classList.contains("fly-kb"), dur: getComputedStyle(S2.$(".nav-band")).transitionDuration, f: document.activeElement.id }));
  A("Enter opens it with no motion and keeps focus on the trigger", k.x === "true" && k.kb && k.dur === "0s" && k.f === "navT-league", k);
  await p.keyboard.press("Tab");
  A("Tab goes into the panel", await p.evaluate(() => !!document.activeElement.closest("#navP-league")));
  await p.keyboard.press("Escape"); await wait(50);
  k = await p.evaluate(() => ({ x: S2.$("#navT-league").getAttribute("aria-expanded"), f: document.activeElement.id }));
  A("Escape closes it and gives focus back to the trigger", k.x === "false" && k.f === "navT-league", k);
  await p.keyboard.press("ArrowDown"); await wait(50);
  A("ArrowDown opens it on the first link", await p.evaluate(() => document.activeElement === S2.$("#navP-league a[href]")));
  await p.keyboard.press("End");
  A("End goes to the last link", await p.evaluate(() => { const l = S2.$$("#navP-league a[href]"); return document.activeElement === l[l.length - 1]; }));
  await p.keyboard.press("Tab"); await wait(50);
  A("Tab out of the panel closes it", (await st()).league === "false");

  console.log("## the Action Center");
  await open(p, "action");
  await p.click('#navP-action a[data-type="appeal"]'); await wait(500);
  A("a case type opens the form on that type, and the menu closes", !!(await p.$('.sheet input[value="appeal"]:checked')) && (await p.evaluate(() => S2.$("#navP-action").hidden)));
  await p.keyboard.press("Escape"); await wait(400);
  A("closing the form gives focus back to the Action Center", (await p.evaluate(() => document.activeElement.id)) === "navT-action");
  await p.evaluate(() => S2.flow("case", { type: "stats_correction" })); await wait(400);
  const pre = await p.evaluate(() => ({ checked: S2.$$(".sheet .fl-card input:checked").length, cards: S2.$$(".sheet .fl-card input").length }));
  await p.click('.sheet .fl-actions button[type="submit"]'); await wait(300);
  const held = await p.evaluate(() => ({ still: S2.$$(".sheet .fl-card input").length > 0, raw: /stats_correction/.test(S2.$(".sheet").textContent) }));
  A("a door pre-filling a type a player may not file leaves no card checked, and the form will not go on without one",
    pre.cards > 0 && pre.checked === 0 && held.still && !held.raw, [pre, held]);
  await p.keyboard.press("Escape"); await wait(300);
  await p.go("#/you?tab=inbox&show=cases");
  A("All your cases opens the Inbox on Cases", (await p.getAttribute('#hqxKind [data-v="cases"]', "aria-pressed")) === "true");
  await p.click("#openBell"); await wait(400);
  A("after All your cases, the bell opens the whole Inbox (the address owns the filter)", (await p.getAttribute('#hqxKind [data-v="all"]', "aria-pressed")) === "true");

  console.log("## you are here");
  await p.go("#/standings?view=race");
  A("a standings view lights League", (await p.getAttribute("#navT-league", "aria-current")) === "true");
  await open(p, "league");
  const cur = await p.$$eval('#navP-league [aria-current="page"]', (l) => l.map((a) => a.textContent));
  A("and inside League exactly one link is here: Playoff race", cur.join() === "Playoff race", cur);
  await p.go("#/rulebook"); await open(p, "league");
  A("while a menu is open only its trigger is underlined", await p.evaluate(() => getComputedStyle(S2.$('.nav-a[href="#/rulebook"] .nav-l'), "::after").transform === "matrix(0, 0, 0, 1, 0, 0)"));
  await p.keyboard.press("Escape");
  await p.go("#/draft");
  A("the draft room lights Season", (await p.getAttribute("#navT-season", "aria-current")) === "true");
  await open(p, "season");
  A("and its own link inside Season", (await p.$$eval('#navP-season [aria-current="page"]', (l) => l.map((a) => a.textContent))).join() === "Draft room");
  await p.keyboard.press("Escape");
  await p.go("#/club/DET"); await open(p, "league");
  A("a club page lights its crest", (await p.$$eval('#navP-league .nav-crest[aria-current="page"]', (l) => l.map((a) => a.getAttribute("href")))).join() === "#/club/DET");
  await p.keyboard.press("Escape");
  await p.go("#/you");
  A("You lights the avatar", (await p.getAttribute(".nav-avatar", "aria-current")) === "page");
  await p.role("commish"); await p.go("#/control");
  A("the Control Center lights Workspaces, and the page's own tabs carry no header mark",
    (await p.getAttribute("#navT-work", "aria-current")) === "true" && !(await p.$("#ccPane[aria-current], .hqx[aria-current]")));
  const hop = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await wait(300); await p.evaluate(() => { while (S2.layer.top()) S2.layer.top().close(); }); await wait(250); };
  await p.role("staff"); await hop("#/hq");
  A("a locked workspace lights nothing: it is not the viewer's place", !(await p.$("#navbar [aria-current]")));
  await p.role("commish"); await hop("#/control");
  /* the repaint js/live.js makes when a session lands (S2.applyRole, S2.shell, S2.route), with a menu open */
  /* the pointer leaves the bar first (a click pinned the menu, so it stays open): a redrawn trigger under a resting mouse
     would take a hover and open again, which is not what this checks */
  await open(p, "work"); await p.mouse.move(700, 760); await wait(100);
  await p.evaluate(() => { S2.applyRole(); S2.shell(); S2.route(true); }); await wait(300);
  A("a session repaint with a menu open leaves nothing behind", await p.evaluate(() => !document.documentElement.classList.contains("nav-open") && S2.$("#navDim").hidden));

  console.log("## no listener piles up");
  const cdp = await p.context().newCDPSession(p);
  const count = async () => {
    const out = {};
    for (const expr of ["document", "window"]) {
      const { result } = await cdp.send("Runtime.evaluate", { expression: expr });
      const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
      listeners.forEach((l) => { out[expr + ":" + l.type] = (out[expr + ":" + l.type] || 0) + 1; });
    }
    return out;
  };
  const before = await count();
  for (const r of ["office", "staff", "commish", "guest", "player"]) { await p.evaluate((x) => { S2.applyRole(x); S2.shell(); S2.route(true); }, r); await wait(150); }
  await p.evaluate(() => { S2.applyRole(); S2.shell(); S2.route(true); }); await wait(150);
  const after = await count();
  A("five shell repaints for five roles (as a session landing makes) add no document or window listener", JSON.stringify(before) === JSON.stringify(after), { before, after });

  console.log("## the look");
  await p.go("#/today"); await open(p, "league");
  const looks = [];
  for (const [theme, finish] of [["light", "glacier"], ["dark", "glacier"]]) {
    /* applyLook cross-fades a theme change (a view transition), so the new look is measured once it is applied */
    looks.push(await p.evaluate(async (o) => { S2.state.theme = o[0]; S2.state.finish = o[1]; await S2.applyLook();
      if (document.documentElement.getAttribute("data-theme") !== o[0]) return { k: o.join(" "), same: false, pill: false, theme: document.documentElement.getAttribute("data-theme") };
      const bar = getComputedStyle(S2.$("#navbar")).backgroundColor, band = getComputedStyle(S2.$(".nav-band")).backgroundColor;
      const pill = getComputedStyle(S2.$("#navT-action .nav-count")).color, on = getComputedStyle(document.documentElement).getPropertyValue("--accent-on").trim();
      const probe = document.createElement("i"); probe.style.color = on; document.body.appendChild(probe); const onc = getComputedStyle(probe).color; probe.remove();
      return { k: o.join(" "), same: bar === band, pill: pill === onc }; }, [theme, finish]));
  }
  A("the band is the bar's own color, and the badge reads, in both themes", looks.every((l) => l.same && l.pill), looks);
  await p.keyboard.press("Escape");
  const foot = await p.$$eval(".foot-col a", (l) => l.map((a) => [a.getAttribute("href"), a.dataset.flow || ""]));
  const map = await p.evaluate(() => { const out = []; S2.$$("#navbar .nav-a").forEach((a) => out.push([a.getAttribute("href"), ""]));
    ["league", "season", "action"].forEach((id) => { S2.nav.open(id, "key"); S2.$$("#navP-" + id + " a[href]").forEach((a) => out.push([a.getAttribute("href"), a.dataset.flow || ""])); });
    S2.nav.close(true); return out; });
  const miss = foot.filter((f) => !map.some((m) => f[1] ? m[1] === f[1] : m[0] === f[0]));
  A("every footer link is also in the header's map", !miss.length, miss);
  await p.context().close();

  console.log("## phones");
  for (const w of [390, 375, 320]) {
    p = await page({ role: "player", viewport: { width: w, height: 760 } });
    await p.go("#/today");
    await p.click("#menuBtn"); await wait(350);
    const rows = await p.$$eval("#smRoot .sm-a", (l) => l.map((a) => a.querySelector("span") ? a.querySelector("span").textContent : a.textContent));
    A(w + ": the menu reads Today, Games, League, Season, Rulebook, Action Center, You", rows.join() === "Today,Games,League,Season,Rulebook,Action Center,You", rows);
    await p.click('.sm-g[data-g="league"]'); await wait(350);
    let m = await p.evaluate(() => ({ on: S2.$("#smL-league").classList.contains("on"), root: S2.$("#smRoot").hidden, f: document.activeElement.id, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    A(w + ": League opens its own page of links, focus on its title, no sideways scroll", m.on && m.root && m.f === "smT-league" && m.sw <= m.iw, m);
    await p.click("#smL-league .sm-back"); await wait(350);
    m = await p.evaluate(() => ({ root: !S2.$("#smRoot").hidden && S2.$("#smRoot").classList.contains("on"), f: document.activeElement.dataset.g }));
    A(w + ": Back returns to the menu with focus on League", m.root && m.f === "league", m);
    await p.click('.sm-g[data-g="action"]'); await wait(350); await p.keyboard.press("Escape"); await wait(300);
    m = await p.evaluate(() => ({ open: document.documentElement.classList.contains("menu-open"), f: document.activeElement.id }));
    A(w + ": Escape from a menu page closes the menu, focus on the menu button", !m.open && m.f === "menuBtn", m);
    await p.click("#menuBtn"); await wait(350);
    A(w + ": reopened, the menu starts at its root", await p.evaluate(() => !S2.$("#smRoot").hidden && S2.$$(".sm-level:not(#smRoot)").every((l) => l.hidden)));
    if (w === 390) {
      await p.role("office"); await wait(200); await p.click("#menuBtn"); await wait(350);
      await p.click('.sm-g[data-g="work"]'); await wait(350);
      const solo = await p.evaluate(() => ({ title: S2.$("#smT-work").textContent, heads: S2.$$("#smL-work .nav-h").length }));
      A("a single workspace's page is titled Front office and does not print the name twice", solo.title === "Front office" && solo.heads === 0, solo);
      await p.keyboard.press("Escape"); await wait(300); await p.role("player"); await wait(200);
      await p.click("#menuBtn"); await wait(350);
      await p.keyboard.press("Meta+k"); await wait(200);
      await p.keyboard.press("Escape"); await wait(250);
      const e1 = await p.evaluate(() => ({ pal: !!S2.$(".palette"), menu: document.documentElement.classList.contains("menu-open") }));
      await p.keyboard.press("Escape"); await wait(300);
      const e2 = await p.evaluate(() => ({ menu: document.documentElement.classList.contains("menu-open"), f: document.activeElement.id }));
      A("one Escape closes only the search over the menu, the next closes the menu", !e1.pal && e1.menu && !e2.menu && e2.f === "menuBtn", [e1, e2]);
    }
    await p.context().close();
  }

  console.log("## Reduce Motion");
  p = await page({ role: "player", reduce: true });
  await p.go("#/today"); await open(p, "league");
  const rm = await p.evaluate(() => ({ band: getComputedStyle(S2.$(".nav-band")).transitionDuration, col: getComputedStyle(S2.$("#navP-league .nav-col")).transform, clip: getComputedStyle(S2.$("#navP-league")).clipPath }));
  A("no slide, no clip, no stagger: the menu cross-fades", rm.band === "0s" && rm.col === "none" && rm.clip === "none", rm);
  await p.setViewportSize({ width: 390, height: 760 }); await wait(200);
  await p.click("#menuBtn"); await wait(300); await p.click('.sm-g[data-g="league"]'); await wait(300);
  A("the phone menu's pages cross-fade too", (await p.evaluate(() => getComputedStyle(S2.$("#smL-league")).transform)) === "none");
  await p.context().close();

  /* QA pass 2026-11-25 (core): the shell's measurable promises */
  console.log("## QA: a quiet repaint plays no entrance");
  p = await page({ role: "player" });
  await p.go("#/standings");
  const soft = await p.evaluate(async () => {
    S2.route(true); const page = S2.$("#page"), els = S2.$$(".reveal", page), out = [];
    for (const t of [16, 40, 90]) { await new Promise((r) => setTimeout(r, t)); out.push(Math.min.apply(null, els.map((e) => +getComputedStyle(e).opacity))); }
    return { n: els.length, minOpacity: out, running: page.getAnimations({ subtree: true }).filter((a) => a.playState === "running" && isFinite(a.effect.getComputedTiming().endTime)).length };
  });
  A("S2.route(true) shows every section at full opacity at once and leaves no entrance running", soft.n > 0 && soft.minOpacity.every((o) => o === 1) && soft.running === 0, soft);

  console.log("## QA: the announcement strip reads the calendar");
  const strip = await p.evaluate(() => { const a = S2.$(".topstrip"); return a ? { t: a.textContent, flow: a.dataset.flow || "", href: a.getAttribute("href") } : null; });
  A("a member signed up for Season 2 reads You are signed up with their next date, never the sign-up form", strip && /You are signed up/.test(strip.t) && !/Sign-ups are open/.test(strip.t) && !strip.flow && strip.href === "#/you?tab=season", strip);
  A("the avatar shows the member's initials, never a role letter", await p.evaluate(() => !!S2.auth.profile && S2.$(".nav-avatar").textContent === S2.initials(S2.auth.profile.gamertag || S2.auth.profile.display_name) && S2.$(".nav-avatar").textContent !== "P"));
  await p.go("#/nosuchpage"); await wait(300);
  A("an unknown address lands on Today, in the bar too, and says so once", await p.evaluate(() => location.hash === "#/today" && S2.$$(".toast").filter((t) => /does not exist/.test(t.textContent)).length === 1));
  /* the ring: solid, at least 3:1 against the white canvas, and it never reshapes what it rings */
  await p.evaluate(() => { S2.$$(".toast").forEach((t) => t.remove()); S2.$(".brand").focus(); });
  await p.keyboard.press("Shift+Tab"); await p.keyboard.press("Tab");
  const ring = await p.evaluate(() => {
    const e = document.activeElement, c = getComputedStyle(e), m = /rgba?\(([^)]+)\)/.exec(c.outlineColor), v = m[1].split(",").map(Number);
    const L = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }, lum = 0.2126 * L(v[0]) + 0.7152 * L(v[1]) + 0.0722 * L(v[2]);
    return { alpha: v.length > 3 ? v[3] : 1, contrast: Math.round(105 / (lum + 0.05)) / 100, radius: c.borderRadius, w: c.outlineWidth, el: e.className };
  });
  A("the focus ring is solid, 3px and at least 3:1 on white, and leaves the element's corners alone", ring.alpha === 1 && ring.w === "3px" && ring.contrast >= 3 && ring.radius === "0px", ring);
  await p.evaluate(() => S2.$(".brand").focus()); await p.keyboard.press("Shift+Tab"); await p.keyboard.press("Shift+Tab");
  const skip = await p.evaluate(() => ({ id: document.activeElement.id, top: Math.round(document.activeElement.getBoundingClientRect().top) }));
  await p.keyboard.press("Enter");
  A("a skip link leads the keyboard order, shows when focused and goes to the page", skip.id === "skipLink" && skip.top >= 0 && (await p.evaluate(() => document.activeElement.id)) === "page", skip);
  await p.context().close();

  console.log("## QA: phone sheet and touch reach");
  p = await page({ role: "office", viewport: { width: 390, height: 844 } });
  await p.go("#/standings");
  const sheet = await p.evaluate(async () => {
    const s = S2.confirm({ title: "Check", why: "A reason." }); const lag = [];
    for (let i = 0; i < 10; i++) { await new Promise((r) => requestAnimationFrame(r)); const sc = S2.$(".scrim"); lag.push(Math.abs(+getComputedStyle(sc).opacity - +(sc.style.opacity || 0))); }
    await new Promise((r) => setTimeout(r, 600)); s.close(); await new Promise((r) => requestAnimationFrame(r));
    const hit = document.elementFromPoint(195, 300);
    return { lag: Math.max.apply(null, lag), takesTap: !!(hit && hit.classList.contains("scrim")) };
  });
  A("the phone sheet's dim follows the spring frame for frame, and a closing scrim never takes the next tap", sheet.lag < 0.02 && !sheet.takesTap, sheet);
  await p.evaluate(() => S2.$$(".toast").forEach((t) => t.remove()));
  await p.click("#menuBtn"); await wait(350);
  const menuRows = await p.evaluate(() => S2.$$("#smRoot .sm-a").map((a) => Math.round(a.getBoundingClientRect().height)));
  A("every phone menu row is at least 44px tall", menuRows.length > 5 && menuRows.every((h) => h >= 44), menuRows);
  await p.context().close();

  console.log("## QA: Reduce Motion presses and the desktop card");
  p = await page({ role: "office", reduce: true });
  await p.go("#/today");
  const qcdp = await p.context().newCDPSession(p); await qcdp.send("DOM.enable"); await qcdp.send("CSS.enable");
  const qdoc = await qcdp.send("DOM.getDocument"), qnode = await qcdp.send("DOM.querySelector", { nodeId: qdoc.root.nodeId, selector: "#openSearch" });
  await qcdp.send("CSS.forcePseudoState", { nodeId: qnode.nodeId, forcedPseudoClasses: ["active"] }); await wait(250);
  const press = await p.evaluate(() => { const c = getComputedStyle(S2.$("#openSearch")); return { scale: c.scale, transform: c.transform, opacity: +c.opacity }; });
  A("under Reduce Motion a press dims and never scales (the search button)", press.scale === "none" && press.transform === "none" && press.opacity < 1, press);
  const card = await p.evaluate(async () => {
    const s = S2.confirm({ title: "Check", why: "A reason." }); await new Promise((r) => setTimeout(r, 400));
    const open = getComputedStyle(s.el).transform; s.close(); await new Promise((r) => requestAnimationFrame(r));
    return { open, closing: getComputedStyle(s.el).transform };
  });
  A("under Reduce Motion the desktop card only cross-fades: no shrink or drop on close", card.open === card.closing, card);
  await p.context().close();

  console.log("## QA round 2: the shell's one helpers");
  p = await page({ role: "office" });
  await p.go("#/standings");
  /* A1: S2.setTitle is the one way a page names itself; the router goes through it */
  const ttl = await p.evaluate(() => {
    const routed = { doc: document.title, bar: S2.$("#inlineTitle").textContent };
    const two = S2.setTitle("Transactions", "Staff Desk"), twoDoc = document.title, twoBar = S2.$("#inlineTitle").textContent;
    S2.setTitle("", null); const none = document.title;
    S2.setTitle("News", ""); const one = document.title;
    return { routed, two, twoDoc, twoBar, none, one };
  });
  A("S2.setTitle names the tab '<page> · <section> · CGHL' and the bar '<page> · <section>', and the router's title goes through it",
    ttl.routed.doc === "Standings · CGHL" && ttl.routed.bar === "Standings" && ttl.twoDoc === "Transactions · Staff Desk · CGHL" && ttl.twoBar === "Transactions · Staff Desk" && ttl.two === "Transactions · Staff Desk", ttl);
  A("an empty part drops out: no section reads '<page> · CGHL', no name at all 'CGHL' (never 'CGHL · CGHL')", ttl.one === "News · CGHL" && ttl.none === "CGHL", ttl);
  const coreSrc = require("fs").readFileSync(require("path").join(S2_ROOT, "js/core.js"), "utf8");
  A("js/core.js writes document.title in one place, S2.setTitle", (coreSrc.match(/document\.title\s*=/g) || []).length === 1 && /S2\.setTitle = function[\s\S]{0,200}document\.title =/.test(coreSrc));
  /* A2: the footer counts the clubs from the league read, in words (S2.words) */
  const ftr = await p.evaluate(() => {
    const n = S2.M.teams.length, line = S2.$(".site-foot .foot-line").textContent, keep = S2.M.teams;
    S2.M.teams = []; const none = S2.footer(); S2.M.teams = keep;
    return { n, line, none: (/<p class="foot-line">([^<]*)</.exec(none) || [])[1], words: [S2.words(0), S2.words(0, "none"), S2.words(1), S2.words(8), S2.words(12), S2.words(13)] };
  });
  const spelled = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"][ftr.n] || String(ftr.n);
  A("the footer counts the clubs in the league read, in words", ftr.n > 1 && ftr.line === "Competitive 6v6 EA Sports NHL. " + spelled + " clubs, one league office, every line counted.", ftr);
  A("a read with no clubs leaves the count out of the footer, never 'No clubs'", ftr.none === "Competitive 6v6 EA Sports NHL. One league office, every line counted.", ftr.none);
  A("S2.words spells 0 to 12 (zero is 'no' unless the caller names its word) and gives the numeral from 13", ftr.words.join() === "no,none,one,eight,twelve,13", ftr.words);
  /* A3: S2.empty draws a given action in the page's own furniture: the website button on a public page, the pill in a workspace */
  const acts = () => p.evaluate(() => {
    const box = document.createElement("div");
    box.innerHTML = S2.empty("none", "Nothing", "Text.", [{ t: "Clear <filters>", data: { clear: "", "cc-x": "a\"b" } }, { t: "Season 1", href: "?season=1#/standings" }]);
    const b = box.querySelector(".empty-acts button"), a = box.querySelector(".empty-acts a"), one = document.createElement("div");
    one.innerHTML = S2.empty("err", "Failed", "", { t: "Try again", data: { retry: "" } });
    const own = S2.empty("none", "Own", "", '<button class="btn site discord">Join</button>');
    return { mode: document.documentElement.dataset.mode, b: b && b.className, bType: b && b.type, bText: b && b.textContent, clear: b && b.hasAttribute("data-clear"), cc: b && b.getAttribute("data-cc-x"),
      a: a && a.className, href: a && a.getAttribute("href"), one: (one.querySelector(".empty-acts [data-retry]") || {}).className, own: /<div class="empty-acts"><button class="btn site discord">Join<\/button><\/div>/.test(own) };
  });
  const siteActs = await acts();
  A("on a public page S2.empty draws an action as the website button (.btn.site.outline), a link or a bound button, its label escaped",
    siteActs.mode === "site" && siteActs.b === "btn site outline" && siteActs.bType === "button" && siteActs.bText === "Clear <filters>" && siteActs.clear && siteActs.cc === "a\"b" &&
    siteActs.a === "btn site outline" && siteActs.href === "?season=1#/standings" && siteActs.one === "btn site outline", siteActs);
  A("an action given as HTML is kept exactly as the caller built it", siteActs.own, siteActs);
  /* A4: S2.clubBand, the club color with its ink, or the ink band for a club with no readable color */
  const band = await p.evaluate(() => {
    const el = document.createElement("section"); el.className = "band club"; el.textContent = "x"; el.setAttribute("style", S2.clubBand({ code: "NEW" }));
    const ink = document.createElement("div"); ink.className = "band ink"; S2.$("#page").append(el, ink);
    const cs = getComputedStyle(el), out = { bg: cs.backgroundColor, fg: cs.color, inkBg: getComputedStyle(ink).backgroundColor };
    el.remove(); ink.remove();
    return Object.assign(out, { gold: S2.clubBand({ color: "#ffb81c" }), navy: S2.clubBand({ color: "00205b" }), none: S2.clubBand(null), short: S2.clubBand({ color: "#fff" }),
      shortRed: S2.clubBand({ color: "c00" }), inkShort: [S2.inkOn("#fff"), S2.inkOn("#c00")].join(), odd: S2.clubBand({ color: "red;x:y" }), clubs: S2.M.teams.filter((t) => t.color).every((t) => S2.clubBand(t) === "--club:" + t.color + ";--club-ink:" + S2.inkOn(t.color)) });
  });
  A("S2.clubBand: the club's color with the ink S2.inkOn picks (gold takes black, navy white), a bare hex given its #", band.gold === "--club:#ffb81c;--club-ink:#000" && band.navy === "--club:#00205b;--club-ink:#fff" && band.clubs, band);
  A("a club with no color, or one the contrast test cannot read, gets the ink band and light text, never white on white", band.none === "--club:var(--ink-band);--club-ink:#fff" && band.odd === band.none, band);
  /* QA round 2 nit: this pinned "#fff" to the ink band (band.short === band.none), so a club stored with a short hex lost
     its color; rewritten to pin the right behavior: a short hex is spelled out and keeps the club's color and its ink */
  A("a short hex is spelled out and keeps the club's own color, with the ink picked for it (#fff black, #c00 white)",
    band.short === "--club:#ffffff;--club-ink:#000" && band.shortRed === "--club:#cc0000;--club-ink:#fff" && band.inkShort === "#000,#fff", band);
  A("a colorless club's band draws on the ink band's ground with white text", band.bg === band.inkBg && band.fg === "rgb(255, 255, 255)", band);
  await p.go("#/hq");
  const appActs = await acts();
  A("in a workspace the same action is the app's small gray pill", appActs.mode === "app" && appActs.b === "btn secondary sm" && appActs.a === "btn secondary sm", appActs);
  await p.context().close();

  /* live health findings (2026-11-25), the shell's half */
  console.log("## health: Enter in the header search, and the current season's doors on an archive");
  /* crawl 4: opened with the header's button (not Command K), Enter went to the result, and the Enter's default then pressed
     the button pick() had just handed focus back to, so an empty search opened again over the result */
  p = await page({ role: "player" });
  await p.go("#/today");
  await p.click("#openSearch"); await wait(250);
  await p.fill(".palette input", "bruins"); await wait(200);
  const want = await p.evaluate(() => { const g = S2.search("bruins")[0]; return g && g.items[0] ? g.items[0].href : null; });
  await p.keyboard.press("Enter"); await wait(700);
  let hs = await p.evaluate(() => ({ hash: location.hash, pal: !!S2.$(".palette"), scrim: !!S2.$(".scrim.on"), layers: S2.layer.top() ? 1 : 0 }));
  A("Enter in a search opened with the header's button goes to the result, and the search stays closed", !!want && hs.hash === want && !hs.pal && !hs.scrim && !hs.layers, [want, hs]);
  await p.context().close();
  /* crawl 1: a bare "#/season" keeps the ?season= the address names, so an archive's Register, Own a club, Join the staff
     and Full calendar opened the archive's season page, which counted nobody signed up. Each resolves to the current
     season now (S2.seasonHref(null, "#/season")), read at each draw */
  const seasonDoors = () => p.evaluate(() => {
    const cur = (a) => { const u = new URL(a.href); return u.hash === "#/season" ? [a.textContent.trim(), u.search] : null; };
    const foot = S2.$$(".site-foot a[href]").map(cur).filter(Boolean);
    S2.nav.open("season", "key"); const menu = S2.$$("#navP-season a[href]").map(cur).filter(Boolean); S2.nav.close(true);
    const st = S2.$(".topstrip"), strip = st ? [st.textContent, new URL(st.href).search, new URL(st.href).hash] : null;
    return { search: location.search, foot, menu, strip };
  });
  for (const role of ["guest", "player"]) {
    p = await page({ role });
    await p.go("#/standings", "?season=1");
    const d = await seasonDoors();
    const all = d.foot.concat(d.menu);
    A(role + ": on the Season 1 archive every footer and Season menu door to the season page opens the current season (Register, Join the staff, Full calendar)",
      d.search === "?season=1" && ["Register", "Join the staff"].every((t) => d.foot.some((x) => x[0] === t)) && ["Register", "Full calendar"].every((t) => d.menu.some((x) => x[0].indexOf(t) === 0)) &&
      all.every((x) => x[1] === ""), d);
    A(role + ": the announcement strip's season door does too", !d.strip || d.strip[2] !== "#/season" || d.strip[1] === "", d.strip);
    await p.context().close();
  }
  /* a workspace's lock: its next step on an archive (Join the staff from the Staff Desk's) opens the current season */
  p = await page({ role: "player" });
  await p.go("#/desk", "?season=1");
  hs = await p.evaluate(() => { const a = S2.$(".ws-lock-acts a.btn"); return a ? [a.textContent, new URL(a.href).search, new URL(a.href).hash] : null; });
  A("on the archive the Staff Desk's lock offers Apply to join the staff for the current season", !!hs && hs[0] === "Apply to join the staff" && hs[1] === "" && hs[2] === "#/season", hs);
  await p.context().close();
  /* crawl 1, second pass: the router owns the rule, because pages still link "#/season" bare (the You page's doors, the bid
     room's breadcrumb, Today, the search palette) and ?season=1#/season said "0 members are in so far" (and "null members"
     once the model stopped inventing the zero). Typed, and from a bare link on the archive, the page opens on the current
     season, with its real count, at the desk and the phone width */
  const seasonLanded = async () => {
    const moved = await p.waitForURL((u) => !u.searchParams.has("season") && u.hash === "#/season", { timeout: 15000 }).then(() => true, () => false);
    await p.waitForFunction(() => window.S2 && S2.M && S2.$("#page .lg-h1-xl"), null, { timeout: 20000 }); await wait(200);
    if (!moved) return p.evaluate(() => ({ stuck: location.search + location.hash, text: S2.$("#page .lede-l") ? S2.$("#page .lede-l").textContent : null }));
    return p.evaluate(() => {
      const text = S2.$("#page").innerText, m = text.match(/(\d+) members (?:are in so far|signed up)/);
      return { search: location.search, hash: location.hash, view: S2.M.view.season, h1: S2.$("#page .lg-h1-xl").textContent, n: m ? +m[1] : null,
        nul: /\bnull\b/.test(text), zero: /(^|\D)0 members/.test(text), sr: S2.M.control.seasonReturn.signedUp };
    });
  };
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    p = await page({ role: "guest", viewport: vp });
    await p.goto(BASE + "?season=1#/season");
    let sl = await seasonLanded();
    A(vp.width + ": ?season=1#/season opens the current season's page, which counts its real sign-ups (never 0, never null)",
      sl.view === 2 && sl.h1 === "Season 2" && sl.n > 0 && sl.n === sl.sr && !sl.nul && !sl.zero, sl);
    /* a bare link on the archive, as the You page draws its guest doors: the in-page move goes the same way */
    await p.go("#/you", "?season=1");
    const bare = await p.evaluate(() => S2.$$('#page a[href="#/season"]').length);
    await p.evaluate(() => { const a = S2.$('#page a[href="#/season"]'); if (a) a.click(); else location.hash = "#/season"; });
    sl = await seasonLanded();
    A(vp.width + ": a bare #/season link on the archive" + (bare ? " (the You page's own)" : "") + " opens the current season's page too", sl.view === 2 && sl.n > 0 && !sl.nul && !sl.zero, [bare, sl]);
    await p.context().close();
  }

  A("no console or page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? "\n" + fails + " of " + n + " FAILED" : "\n" + n + "/" + n + " passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
