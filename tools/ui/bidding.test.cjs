const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The Bid room (#/bidding, js/pages/bidding.js) on the REAL site, driven through its UI in headless Chromium:
   node tools/ui/run.cjs --suite bidding --mode live   (any mode works: every context opts into the real site itself)
   The commissioner, 2026-11-02: "bids always start at 750k and can only be raised by 250k at a time. a team cannot place
   two bids in a row on the same player. They need to wait for another team to bid in order to raise their own bid on a
   player.", "a team cannot place a bid on a player that would take them over their salary cap." and "Build the live room
   as you see fit that matches the style and flow of the concept site". The database enforces the rules; this file
   proves the room says and does them: the night picker with the skipped Saturdays, the one exact-price button, the
   database's refusals said in place, another club's raise, a sale and its cross-fade, the 10 PM lock, the closed recap,
   the lot sheet's history, the watcher's lock, the Control Center's Bids list, the phone layout, large text, and
   repaints that never re-render the page.
   v5.00 swap (i3e, 2026-11-25): the room runs on the league's market (tools/ui/market-world.cjs over tools/ui/mock's
   live mode; nothing reaches production). Deleted with the demo (each pinned only demo behavior): the sample clock bar
   and its skips and 10x, the seeded rival bidders (their opening and answering bids, a rival's waiver before it bids),
   Bid anyway (demo) and the forced bids and override sheets it ran, the Discord previews (the DM in the lot sheet, the
   #news recap card, the #transactions card), the demo's sale toast, Team HQ's roster after a demo sale, the demo
   engine's own no_new_lots refusal, and View as on the watcher's role lock. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)) + ")")); if (!cond) fails++; };

(async () => {
  const b = await chromium.launch();
  const X = require("./market-world.cjs")(mock);
  const { MINE, CA, CB, CC, CD, L1, L2, L3, BK, BK2, BK3, uuid, calls, settled, pulse } = X;
  const open = (persona, o) => X.open(b, persona, (o && o.hash) || "#/bidding", o);
  const full = (p, code) => p.evaluate((c) => S2.M.team(c).full, code);
  /* a lot that ended cross-fades for 220ms with its old content laid over it (.bd-lot-ghost); read after it */
  const fade = (p) => p.waitForTimeout(300);
  /* the size a finger gets: the box, or the ::after reach around it when it has one (the kit's .btn.sm pattern) */
  const reach = (p, sel) => p.evaluate((s) => S2.$$(s).filter((el) => el.offsetParent).map((el) => {
    const r = el.getBoundingClientRect(), a = getComputedStyle(el, "::after"), on = a.content && a.content !== "none" && a.position === "absolute";
    return { t: el.textContent.slice(0, 16), w: Math.round(Math.max(r.width, on ? parseFloat(a.width) || 0 : 0)), h: Math.round(Math.max(r.height, on ? parseFloat(a.height) || 0 : 0)) };
  }), sel);
  const card = (p, pid) => p.evaluate((id) => {
    const el = S2.$('.bd-lot[data-pid="' + id + '"]'); if (!el) return null;
    const btn = S2.$("[data-bd-bid]", el), say = S2.$("[data-bd-say]", el);
    return { state: el.dataset.state, k: S2.$(".bd-price-k", el).textContent, price: S2.$(".bd-price-n", el).textContent, st: S2.$(".bd-lot-st", el).textContent, btn: btn ? btn.textContent : null,
      btnPrice: btn ? +btn.dataset.price : null, say: say ? say.textContent : null, override: !!S2.$("[data-bd-anyway]", el), ring: !!S2.$(".bd-ring", el), mine: el.classList.contains("is-mine"), act: !!S2.$(".bd-act", el) };
  }, pid);
  const rail = (p) => p.evaluate(() => { const r = S2.$("#bdRail"); return { text: r.textContent, spots: S2.$("[data-bd-spots]", r) && S2.$("[data-bd-spots]", r).textContent, room: S2.$("[data-bd-room]", r) && S2.$("[data-bd-room]", r).textContent }; });
  const band = (p) => p.evaluate(() => ({ state: (S2.$("[data-bd-state]") || {}).dataset ? S2.$("[data-bd-state]").dataset.bdState : null, head: S2.$(".bd-head").textContent,
    meta: S2.$(".bd-meta").textContent, clock: S2.$(".bd-big-n") ? S2.$(".bd-big-n").textContent : null, label: S2.$(".bd-big-l") ? S2.$(".bd-big-l").textContent : null, stateText: S2.$(".bd-state").textContent }));
  const tagOf = (p, pid) => p.evaluate((id) => S2.M.player(id).tag, pid);
  const lotRow = (pid) => X.w.lots.find((l) => l.profile_id === pid);

  console.log("## a commissioner acting for a club, before the night");
  let W = X.reset(); X.before(); X.crowd(12);
  let { ctx, p } = await open("commissioner");
  await p.selectOption("[data-bd-club]", CB); await pulse(p).catch(() => null); await p.waitForTimeout(300);
  let r = await p.evaluate(() => ({ club: S2.market.club(), rail: S2.$(".bd-club").textContent, sel: S2.$("[data-bd-club]").value }));
  A("the rail's Acting for picks the club the room acts for (S2.market.setClub), and the rail follows it", r.club === CB && r.rail.indexOf(await full(p, CB)) >= 0 && r.sel === CB, r);
  r = await band(p);
  A("the band says the night is ahead: OPENS 9:00 PM, players that can be bid on", r.state === "before" && /Opens 9:00 PM/i.test(r.stateText) && /can be bid on/i.test(r.head) && /Until 9:00 PM/i.test(r.label), r);
  r = await p.evaluate(() => S2.$$("#bdNights button").map((x) => [x.dataset.v, x.classList.contains("skip"), x.getAttribute("aria-label"), x.getAttribute("aria-pressed")]));
  A("the night picker lists the database's bid nights, the skipped Saturday struck and labeled", r.map((x) => x[0]).join() === [BK, BK2, BK3].join() &&
    r.filter((x) => x[1]).map((x) => x[0]).join() === BK2 && /no bidding/.test(r[1][2]) && r[0][3] === "true", r);
  await p.click('#bdNights button[data-v="' + BK2 + '"]'); await p.waitForTimeout(120);
  const bk3Label = await p.evaluate((k) => S2.market.bidNights().filter((x) => x.key === k)[0].label, BK3);
  r = await p.evaluate(() => ({ head: S2.$(".bd-head").textContent, meta: S2.$(".bd-meta").textContent, hash: location.hash, cards: S2.$$(".bd-lot").length, go: S2.$("[data-bd-night]") && S2.$("[data-bd-night]").dataset.bdNight }));
  A("a skipped Saturday says no bidding, the database's reason and the next night; the address keeps the pick",
    /No bidding this Saturday/i.test(r.head) && /No league games that week, so no bidding\./.test(r.meta) && r.meta.indexOf("The next bid night is " + bk3Label) >= 0 && r.hash.indexOf("night=" + BK2) >= 0 && r.cards === 0 && r.go === BK3, r);
  await p.click('[data-bd-night="' + BK3 + '"]'); await p.waitForTimeout(120);
  r = await p.evaluate(() => ({ pressed: S2.$('#bdNights [aria-pressed="true"]').dataset.v, head: S2.$(".bd-h1").textContent, cards: S2.$$(".bd-lot").length }));
  A("See the next night moves the picker there and shows its preview", r.pressed === BK3 && r.head.indexOf(bk3Label) >= 0 && r.cards > 0, r);
  await p.click('#bdNights button[data-v="' + BK + '"]'); await p.waitForTimeout(120);
  const lots0 = await p.evaluate(() => S2.market.room().lots.map((l) => ({ pid: l.pid, tag: l.tag })));
  r = await p.evaluate(() => ({ cards: S2.$$(".bd-lot").length, bids: S2.$$("[data-bd-bid]").length, adds: S2.$$("[data-bd-board]").length, h: S2.$("#bdLotsH").textContent, sub: S2.$(".bd-lots-h p").textContent }));
  A("before 9 PM every eligible pool player is a lot, with Add to board and no bid button", r.cards === lots0.length && r.cards > 10 && r.bids === 0 && r.adds === r.cards, r);
  A("the lots headline is the news (how many still wait for a first bid), and how the one button works is the sentence under it (review 2026-11-03)",
    new RegExp("^" + r.cards + " players still waiting for a first bid$").test(r.h) && /one button with the exact price: bids open at \$750K and every raise is exactly \$250K more/.test(r.sub), r);
  const first = lots0[0];
  await p.evaluate(() => { window.__head = S2.$("#bdNow .bd-head"); window.__lot = S2.$$(".bd-lot")[1]; });
  await p.click('.bd-lot[data-pid="' + first.pid + '"] [data-bd-board]'); await settled(p);
  let c = calls(ctx, "save_market_board");
  r = await p.evaluate((id) => ({ act: S2.$('.bd-lot[data-pid="' + id + '"] .bd-act').textContent, rail: S2.$("#bdRail").textContent, kept: S2.$$(".bd-lot")[1] === window.__lot }), first.pid);
  A("Add to board saves the club's board (save_market_board for the club acted for); the lot and the rail say so, the other lots untouched",
    c.length === 1 && c[0].args.p_team === X.ID(CB) && c[0].args.p_rows.map((x) => x.profile_id).join() === first.pid && /On your board, #1/.test(r.act) && r.rail.indexOf(first.tag) >= 0 && r.kept, [c, r.act, r.kept]);
  const tick = await p.evaluate(async () => {
    const lotEl = S2.$(".bd-lot"), head = S2.$("#bdNow .bd-head"), before = S2.$(".bd-big-n").textContent;
    await new Promise((res) => setTimeout(res, 1300));
    return { before, after: S2.$(".bd-big-n").textContent, sameLot: lotEl === S2.$(".bd-lot"), sameHead: head === S2.$("#bdNow .bd-head") };
  });
  A("the band's clock ticks in place each second, without re-rendering the lots or the headline", tick.before !== tick.after && tick.sameLot && tick.sameHead, tick);
  await ctx.close();

  console.log("## live: the one exact-price button, the database's refusals in place, another club's raise");
  W = X.reset();
  ({ ctx, p } = await open("gm"));
  r = await band(p);
  A("the band says LIVE with the time left until new bidding closes", r.state === "live" && /^\d{1,2}:\d{2}$/.test(r.clock || "") && /Left/i.test(r.label), r);
  r = await card(p, L1);
  A("an unopened lot has ONE button with the exact price: Open at $750K", r.btn === "Open at $750K" && r.btnPrice === 750000 && !r.ring, r);
  r = await card(p, L2);
  A("a running lot names no bidder, runs its ring and offers the next exact price: Raise to $1.25M", /Bidder hidden · 2 bids/.test(r.st) && r.ring && r.btn === "Raise to $1.25M" && r.btnPrice === 1250000, r);
  const roomEl = await p.evaluateHandle(() => S2.$("#bdRoom"));
  await p.click('.bd-lot[data-pid="' + L2 + '"] [data-bd-bid]'); await settled(p);
  r = { card: await card(p, L2), rail: await rail(p) };
  A("the club's raise is exactly $250K: $1.25M, Your club leads, the lot marked as the club's", r.card.price === "$1.25M" && /Your club leads · 3 bids/.test(r.card.st) && r.card.ring && r.card.mine, r.card);
  A("the club rail counts the bid it leads (market_club_state)", /Bids you lead1/.test(r.rail.text) && /held by a bid you lead/.test(r.rail.text), r.rail.text.slice(0, 300));
  A("the page was not re-rendered (the room element is the same)", await p.evaluate((el) => el === S2.$("#bdRoom"), roomEl));
  A("focus is back on the lot's button after the database answered (the waiting button had dropped it)", await p.evaluate((pid) => document.activeElement && document.activeElement.dataset.key === "act-" + pid, L2));
  A("the leading club's button keeps the exact next price: Raise to $1.50M", r.card.btn === "Raise to $1.50M" && r.card.btnPrice === 1500000, r.card);
  await p.click('.bd-lot[data-pid="' + L2 + '"] [data-bd-bid]'); await settled(p);
  r = await card(p, L2);
  A("bidding again on its own top bid is the database's refusal, said in place (Rule S2.6), with no override", /You hold the top bid\. Another club must bid before you can bid on this player again \(Rule S2\.6\)/.test(r.say || "") && !r.override && /3 bids/.test(r.st), r);
  A("...and nothing was bid", lotRow(L2).bids === 3 && calls(ctx, "market_bid").length === 2);
  W.bids.push(X.bid(593, lotRow(L2).id, CC, 4, 1500000, Date.now())); Object.assign(lotRow(L2), { price: 1500000, bids: 4, ends_at: X.iso(Date.now() + 300e3) });
  await pulse(p);
  r = { card: await card(p, L2), rail: await rail(p) };
  A("another club's raise lands on the next read: $1.50M, Bidder hidden, the refusal gone, Raise to $1.75M", r.card.price === "$1.50M" && /Bidder hidden · 4 bids/.test(r.card.st) && r.card.say === null && r.card.btn === "Raise to $1.75M" && !r.card.mine, r.card);
  A("the rail no longer counts a bid the club leads", /Bids you lead0/.test(r.rail.text), r.rail.text.slice(0, 200));
  W.active[MINE] = 12; await pulse(p);
  await p.click('.bd-lot[data-pid="' + L1 + '"] [data-bd-bid]'); await settled(p);
  r = { card: await card(p, L1), rail: await rail(p) };
  A("a full club (12 of 12): the rail says no open spot, and a bid is the database's no-spot refusal in place (Rule S2.4)", /No open spot/.test(r.rail.text) && /active roster has no open spot: 12 of 12 active/.test(r.card.say || "") && /Rule S2\.4/.test(r.card.say || "") && !r.card.override, r);

  console.log("## the lot sheet: the history, the clubs hidden while it runs");
  await p.click('.bd-lot[data-pid="' + L2 + '"] [data-bd-open]'); await p.waitForTimeout(350);
  r = await p.evaluate(() => { const s = S2.$(".sheet.bd-sheet-w"); return s ? { rows: S2.$$(".bd-hist li", s).map((li) => li.textContent), n: S2.$$(".bd-rs-h .num", s).map((x) => x.textContent).join(), btn: S2.$("[data-bd-bid]", s) ? S2.$("[data-bd-bid]", s).textContent : null, dc: S2.$$(".dc", s).length } : null; });
  const T = "\\d{1,2}:\\d{2}:\\d{2} (AM|PM)$";
  /* sql v4.59: while a lot runs a club reads only its own bids (RLS); the count is the lot's own */
  A("while the lot runs the club's sheet lists its own bids, newest first, with amounts and times, and counts all four",
    r && r.rows.length === 2 && new RegExp("^\\$1\\.25MYour club" + T).test(r.rows[0]) && new RegExp("^\\$750KYour club" + T).test(r.rows[1]) && r.n === "4", r);
  A("the sheet carries the same one-price button, and no Discord preview", r && r.btn === "Raise to $1.75M" && r.dc === 0, r);
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  console.log("## the Control Center's Bids list repaints in place on a market read");
  await p.evaluate(() => { const h = document.createElement("div"); h.dataset.w = "ccbids"; h.innerHTML = S2.bidding.ccBids(); document.body.appendChild(h); window.__cc = h; });
  const ccBefore = await p.evaluate(() => window.__cc.textContent);
  A("the list names the running lots with their top price and bid count, the bidder hidden", /Running · bidder hidden · 4 bids/.test(ccBefore) && /\$1\.50M/.test(ccBefore), ccBefore.length);
  W.bids.push(X.bid(594, lotRow(L2).id, CD, 5, 1750000, Date.now())); Object.assign(lotRow(L2), { price: 1750000, bids: 5 });
  await pulse(p);
  r = await p.evaluate(() => ({ same: window.__cc === S2.$('[data-w="ccbids"]') && window.__cc.isConnected, text: window.__cc.textContent }));
  A("...and refills in place when the market is read again (same node, the new price)", r.same && /5 bids/.test(r.text) && /\$1\.75M/.test(r.text), r.same);
  await ctx.close();

  console.log("## a refusal on a lot that then ends leaves the sold card clean");
  W = X.reset(); W.bids.push(X.bid(595, lotRow(L2).id, MINE, 3, 1250000, Date.now() - 30e3)); Object.assign(lotRow(L2), { price: 1250000, bids: 3 });
  ({ ctx, p } = await open("gm"));
  await p.click('.bd-lot[data-pid="' + L2 + '"] [data-bd-bid]'); await settled(p);
  A("the press on the club's own top bid is refused in place", /You hold the top bid/.test((await card(p, L2)).say || ""));
  X.sell(lotRow(L2), MINE, 1250000); await pulse(p); await fade(p);
  r = { card: await card(p, L2), sheets: await p.evaluate(() => S2.$$(".sheet").length) };
  A("the lot sold with a refusal on it: the sold card parks no refusal and no override, and no sheet opened", r.card.state === "sold" && r.card.say === null && !r.card.override && r.sheets === 0, r);
  await ctx.close();

  console.log("## a sale cross-fades on its own lot, and the other lots keep their nodes");
  for (const reduce of [false, true]) {
    W = X.reset(); X.crowd(16); W.bids.push(X.bid(596, lotRow(L2).id, MINE, 3, 1250000, Date.now() - 30e3)); Object.assign(lotRow(L2), { price: 1250000, bids: 3 });
    ({ ctx, p } = await open("gm", { width: 375, ctx: { hasTouch: true, isMobile: true, reducedMotion: reduce ? "reduce" : "no-preference" } }));
    const railBefore = await rail(p);
    await p.evaluate(() => {
      window.__anim = []; const orig = Element.prototype.animate;
      Element.prototype.animate = function (k, o) { const l = this.closest(".bd-lot"); window.__anim.push({ pid: l && l.dataset.pid, cls: String(this.className), k: JSON.stringify(k) }); return orig.call(this, k, o); };
      window.__nodes = S2.$$(".bd-lot").map((el) => ({ pid: el.dataset.pid, el }));
    });
    X.sell(lotRow(L2), MINE, 1250000); await pulse(p); await fade(p);
    r = await p.evaluate((sold) => { const a = window.__anim.filter((x) => x.pid === sold), others = window.__nodes.filter((x) => x.pid !== sold);
      return { kept: others.filter((x) => x.el.isConnected).length, others: others.length, swapped: !window.__nodes.filter((x) => x.pid === sold)[0].el.isConnected,
        ghost: a.some((x) => /bd-lot-ghost/.test(x.cls) && /"opacity":1\},\{"opacity":0/.test(x.k)), inner: a.some((x) => /bd-lot-in/.test(x.cls) && !/ghost/.test(x.cls) && /"opacity":0\},\{"opacity":1/.test(x.k)),
        height: a.some((x) => /height/.test(x.k)), left: S2.$$(".bd-lot-ghost").length }; }, L2);
    A(reduce ? "with reduced motion the sale still cross-fades (opacity only) and the card's height does not animate"
      : "a sale swaps only its own lot (every other lot node is kept), its old content fades out over the result, and the card eases to its new height on a phone",
      r.others > 15 && r.kept === r.others && r.swapped && r.ghost && r.inner && r.height === !reduce && r.left === 0, r);
    if (!reduce) {
      r = { card: await card(p, L2), rail: await rail(p) };
      A("the sold lot reads Your club signed them at the price, with no button", /Your club signed them/.test(r.card.st) && r.card.price === "$1.25M" && r.card.btn === null, r.card);
      A("the club's figures follow the database: one spot fewer, the cap room less the price", railBefore.room === "$10M" && r.rail.room === "$8.75M", [railBefore.room, r.rail.room]);
    }
    await ctx.close();
  }

  console.log("## after 10 PM: the last clocks run, unopened lots go back to the pool");
  W = X.reset(); X.closing(); lotRow(L1).state = "unsold"; lotRow(L1).ended_at = X.iso(Date.now() - 100e3);
  ({ ctx, p } = await open("gm"));
  r = await band(p);
  const l2tag = await tagOf(p, L2);
  A("the band says LAST CLOCKS RUNNING while countdowns finish", r.state === "closing" && /Last clocks running/i.test(r.stateText) && /Last clock/i.test(r.label), r);
  A("the closing headline names who is still in play, and the sentence spells its number out (review 2026-11-03)",
    !/last clocks running/i.test(r.head + " " + r.meta) && r.head === l2tag + " is the last player in play" && !/^\d/.test(r.meta), r);
  r = { h: await X.txt(p, "#bdLotsH"), un: await card(p, L1), run: await card(p, L2) };
  A("the lots headline says how many went back to the pool without a bid", r.h === "One player went back to the pool without a bid", r.h);
  A("an unopened lot reads No bids: back to the pool, with no button; the running countdown keeps its ring", r.un.st === "No bids: back to the pool" && r.un.btn === null && r.run.ring, r);
  await ctx.close();

  console.log("## closed: the recap and the players back in the pool");
  W = X.reset(); X.closed(); lotRow(L1).state = "unsold"; X.sell(lotRow(L2), CB, 1000000);
  ({ ctx, p } = await open("gm"));
  const rec = await p.evaluate((k) => S2.market.recap(k), BK);
  const bkLabel = await p.evaluate((k) => S2.market.bidNights().filter((x) => x.key === k)[0], BK);
  r = { band: await band(p), page: await p.evaluate(() => ({ h2: S2.$("#bdRecapH") && S2.$("#bdRecapH").textContent, signed: S2.$$(".bd-signed li").map((li) => li.textContent),
    back: S2.$$(".bd-back li").length, lotsShown: getComputedStyle(S2.$("#bdLots")).display, h1: S2.$(".bd-h1").textContent, dc: S2.$$("#bdRoom .dc").length })) };
  A("the band says CLOSED and how many signed; the big figure is the total", r.band.state === "closed" && /^Two players signed$/i.test(r.band.head) && r.band.clock === "$1.75M" && rec.total === 1750000, r.band);
  const fb = await full(p, CB), fa = await full(p, CA);
  A("the recap lists every signing with its club and price", r.page.signed.length === 2 && r.page.signed.some((t) => t.indexOf(fb) >= 0 && /\$1M$/.test(t)) && r.page.signed.some((t) => t.indexOf(fa) >= 0 && /\$750K$/.test(t)), r.page.signed.length);
  A("the players back in the pool are listed, the lots give way to the recap, and no Discord preview", r.page.back === 1 && rec.unsold === 1 && r.page.lotsShown === "none" && r.page.dc === 0, r.page);
  A("the room stays on the night just held (its recap), not the next night", r.page.h1.indexOf(bkLabel.label) >= 0, r.page.h1);
  await p.click(".bd-signed [data-bd-open]"); await p.waitForTimeout(350);
  r = await p.evaluate(() => { const s = S2.$(".sheet.bd-sheet-w"); return s ? { hist: S2.$$(".bd-hist li", s).length, named: S2.$$(".bd-hist-w", s).map((x) => x.textContent) } : null; });
  A("a signing opens its lot: the history, the clubs named now that the bidding is over (Rule S2.6)", r && r.hist >= 1 && r.named.every((w) => w !== "A club"), r);
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  r = await p.evaluate(() => { const el = document.createElement("div"); el.innerHTML = S2.bidding.ccBids(); return { text: el.textContent, links: S2.$$("a", el).map((a) => a.getAttribute("href")) }; });
  const bn = await p.evaluate((k) => [S2.market.bidNights().filter((x) => x.key === k[0])[0].short, S2.market.bidNights().filter((x) => x.key === k[1])[0].short], [BK, BK3]);
  /* review 2026-11-03: the default room moves to the next night the moment a room closes; for a day after it closes the
     step leads with that night's recap and a link to its results */
  A("after the room closes, the Control Center's step keeps that night's recap with a link to its results, then the next night's preview",
    r.text.indexOf("Last bid night, " + bn[0] + " · closed") >= 0 && r.text.indexOf(rec.text) >= 0 && r.links.indexOf("#/bidding?night=" + BK) >= 0 && r.text.indexOf("Bids, " + bn[1] + " · opens 9:00 PM") >= 0, r);
  await ctx.close();

  console.log("## a lot called off while the room runs (void), and the recap after it");
  W = X.reset(); Object.assign(lotRow(L2), { state: "void", why: "Withdrawn by the league office.", ended_at: X.iso(Date.now() - 50e3) });
  ({ ctx, p } = await open("gm"));
  r = { card: await card(p, L2), count: await X.txt(p, "#bdCount") };
  A("the void lot says the database's reason, shows No sale, and has no button", r.card.state === "void" && r.card.k === "No sale" && r.card.price === "Void" && r.card.st === "Withdrawn by the league office." && !r.card.act && /1 voided/.test(r.count), r);
  X.closed(); lotRow(L1).state = "unsold"; await pulse(p);
  r = await p.evaluate((k) => ({ voided: (S2.market.recap(k) || {}).voided || [], list: S2.$$("ul.bd-void li").map((li) => li.textContent) }), BK);
  const l2t = await tagOf(p, L2);
  A("the closed night's recap lists the voided sale with its reason", r.voided.length === 1 && r.list.length === 1 && r.list[0].indexOf(l2t) === 0 && r.list[0].indexOf("Withdrawn by the league office.") > 0, r.list.length);
  await ctx.close();

  console.log("## a refusal ends with its night, even one said while the viewer was on another page (second pass, 2026-11-03)");
  W = X.reset(); X.crowd(12); W.active[MINE] = 12;
  ({ ctx, p } = await open("gm"));
  r = await p.evaluate(async () => { for (const btn of S2.$$('.bd-lot[data-state="open"] [data-bd-bid]').slice(0, 4)) { btn.click(); await new Promise((res) => setTimeout(res, 400)); }
    return S2.$$("[data-bd-say]").filter((x) => /active roster has no open spot/.test(x.textContent)).length; });
  A("with no open spot, each lot the club presses says the database's roster refusal in place", r === 4, r);
  await p.evaluate(() => { location.hash = "#/today"; }); await p.waitForTimeout(300);
  X.closed(); W.lots.forEach((l) => { if (l.state === "open") l.state = "unsold"; });
  await pulse(p);
  await p.evaluate(() => { location.hash = "#/bidding"; }); await p.waitForSelector("#bdRoom"); await p.waitForTimeout(150);
  r = await p.evaluate((k) => ({ state: S2.market.room(k).state, shown: S2.$("#bdNights [aria-pressed=true]").dataset.v === k, says: S2.$$("[data-bd-say]").length }), BK);
  A("back in the room once the night has closed, none of its refusals came back (the night closed while the viewer was away)", r.state === "closed" && r.shown && r.says === 0, r);
  await ctx.close();

  console.log("## a member watches: the bid is a role lock, the rail says how to take part");
  W = X.reset();
  ({ ctx, p } = await open("member"));
  r = await p.evaluate(() => ({ rail: S2.$("#bdRail").textContent, sum: S2.$(".bd-sum").textContent, btns: S2.$$("[data-bd-bid]").length, board: S2.$$('#bdFilter [data-v="board"]').length }));
  A("a member sees the room and a rail that says how to take part (no board filter, no board)", /You are watching the room/.test(r.rail) && /Watching/.test(r.sum) && r.btns > 0 && r.board === 0, r);
  /* second pass, 2026-11-03: every game of the season counts toward the six, at any club (S2.5), and being bid on is S2.6 */
  A("a member's rail counts six games this season, at any club, and cites Rule S2.6 for being bid on",
    /six games this season, at any club, make them eligible here \(Rule S2\.6\)/.test(r.rail) && /can be requested for a club's games \(Rule S2\.5\)/.test(r.rail), r.rail);
  await p.click(".bd-lot [data-bd-bid]"); await p.waitForTimeout(350);
  r = await p.evaluate(() => { const s = S2.$$(".sheet").pop(); return s ? { text: s.textContent, as: !!S2.$('[data-lk="as"]', s) } : null; });
  A("pressing a bid as a member opens the role lock (a club's front office), with no View as on the real site", r && /A club's front office/.test(r.text) && !r.as, r);
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  A("...and no bid was sent", calls(ctx, "market_bid").length === 0);
  await ctx.close();
  W = X.reset();
  ({ ctx, p } = await open("anon"));
  r = await p.evaluate(() => S2.$("#bdRail").textContent);
  A("a visitor's rail counts every game of the season toward the six, and cites Rule S2.6 for being bid on (review 2026-11-03)",
    /six games this season make them eligible here \(Rule S2\.6\)/.test(r) && !/six games in the pool/.test(r), r);
  /* QA 2026-11-25 (visual lens): the rail's Join with Discord was the app's full-width pill while the footer's Join the
     Discord on the same page is the website's rectangle (.btn.site, js/core.js S2.footer) */
  r = await p.evaluate(() => [].map.call(document.querySelectorAll('#bdRail a.btn[href="#/you"]'), (e) => ({ site: e.classList.contains("site") && e.classList.contains("discord"), rad: parseFloat(getComputedStyle(e).borderRadius) })));
  A("a visitor's Join with Discord in the rail is the website's Discord button, squared like the footer's", r.length === 1 && r[0].site && r[0].rad < 12, r);
  await ctx.close();

  /* QA round 2 (2026-11-25): a club adds a pool player game by game (Rule S2.5: per-game requests since v4.59), so the
     room never says "nightly requests". Every Saturday left is a holiday week here, so the room has no night to show */
  console.log("## no bid night to show: the way in after the deadline is the single-game request");
  W = X.reset(); W.nights = []; W.lots = []; W.bids = [];
  W.calendar = { season_id: X.S, market: true, deadline: X.iso(Date.now() + 9 * 86400e3), moves_locked: false, draft_done: true, game_nights: [],
    bid_nights: [{ night: BK, skipped: true, why: "No league games that week, so no bidding.", opens_at: X.iso(Date.now() + 2 * 86400e3), new_until: X.iso(Date.now() + 2 * 86400e3 + 3600e3), id: null, state: "upcoming", paused: false }], next_bid_night: BK };
  ({ ctx, p } = await open("gm"));
  r = await p.evaluate(() => ({ room: S2.market.room(), meta: S2.$(".bd-meta").textContent }));
  A("with no bid night to show, the room points to single-game requests from the training camp pool (Rule S2.5), never nightly ones",
    !r.room && /clubs use single-game requests from the training camp pool \(Rule S2\.5\)\./.test(r.meta) && !/nightly/i.test(r.meta), r);
  await ctx.close();

  console.log("## phone: the rail is a sticky summary that opens a sheet");
  W = X.reset(); X.crowd(12);
  ({ ctx, p } = await open("gm", { width: 375, ctx: { hasTouch: true } }));
  r = await p.evaluate(() => ({ rail: getComputedStyle(S2.$("#bdRail")).display, sum: getComputedStyle(S2.$("#bdSumHost")).position, sw: document.documentElement.scrollWidth, small: S2.$$(".bd-lot [data-bd-bid], .bd-sum").filter((x) => x.getBoundingClientRect().height < 44).length }));
  A("at 375px the rail hides, the summary is sticky, nothing scrolls sideways, every target is 44px", r.rail === "none" && r.sum === "sticky" && r.sw <= 375 && r.small === 0, r);
  await p.click(".bd-sum"); await p.waitForTimeout(500);
  r = await p.evaluate(() => { const s = S2.$(".sheet.bd-sheet-w"); return s ? s.textContent : null; });
  const fm = await full(p, MINE);
  A("the summary opens the club rail in a sheet: the club's spots, cap room and board", r && r.indexOf(fm) >= 0 && /Season 2 cap room/.test(r) && /Your board/.test(r), (r || "").length);
  const railLinks = await reach(p, ".sheet .bd-link");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  const names = await reach(p, ".bd-lot-name");
  A("every lot name (the door to its sheet) and every rail link reaches 44px on a phone (review 2026-11-03: 33px)",
    names.length > 10 && names.every((x) => x.h >= 44 && x.w >= 44) && railLinks.every((x) => x.h >= 44 && x.w >= 44), { names: names.filter((x) => x.h < 44 || x.w < 44).length, rail: railLinks.filter((x) => x.h < 44).length });
  X.closed(); W.lots.forEach((l) => { if (l.state === "open") l.state = "unsold"; if (l.state === "running") X.sell(l, CD, l.price); });
  await pulse(p);
  r = await reach(p, ".bd-signed-t .bd-link, .bd-back a, .bd-void a");
  A("the closed night's signings and back-to-the-pool links reach 44px too", r.length > 3 && r.every((x) => x.h >= 44 && x.w >= 44), r.filter((x) => x.h < 44 || x.w < 44).length);
  await ctx.close();

  console.log("## large text and in-between widths: the lot follows its own card, the rail grows with the text");
  for (const [w, t] of [[560, null], [1280, "150%"], [1280, "200%"], [375, "200%"]]) {
    W = X.reset(); X.crowd(16);
    ({ ctx, p } = await open("gm", { width: w, height: 900 }));
    if (t) { await p.evaluate((x) => { document.documentElement.style.fontSize = x; }, t); await p.waitForTimeout(100); }
    r = await p.evaluate(() => {
      const ov = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5), bad = [], rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      S2.$$(".bd-lot").forEach((lot) => {
        const q = (s) => { const x = lot.querySelector(".bd-lot-in " + s); return x && x.getBoundingClientRect(); }, name = lot.querySelector(".bd-lot-name"), cw = lot.getBoundingClientRect().width;
        const two = getComputedStyle(lot.querySelector(".bd-lot-in")).gridTemplateColumns.split(" ").length === 2;
        if (two !== (cw >= 19 * rem - 0.5)) bad.push("layout " + Math.round(cw) + "px two=" + two);
        if (Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)) > 2) bad.push("a name wraps past two lines");
        const parts = [q(".bd-lot-name"), q(".bd-ring"), q(".bd-price-n"), q(".bd-lot-st"), q(".bd-act"), q(".bd-lot-meta")].filter((x) => x && x.width);
        for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (ov(parts[i], parts[j])) bad.push("overlap in a lot");
      });
      const rail = S2.$("#bdRail .bd-rail-in");
      if (rail && rail.offsetParent) { const rr = rail.getBoundingClientRect(); S2.$$(".bd-figs dt, .bd-figs dd", rail).forEach((x) => { if (x.getBoundingClientRect().right > rr.right + 1 || x.scrollWidth > x.clientWidth + 1) bad.push("rail spill: " + x.textContent); }); }
      const room = S2.$("#bdRoom").getBoundingClientRect(); if (room.right > innerWidth + 1) bad.push("room wider than the screen");
      return { bad: bad.slice(0, 6), lots: S2.$$(".bd-lot").length };
    });
    A("at " + w + "px with " + (t || "100%") + " text no lot squeezes, wraps a name past two lines or overlaps, and the rail figures stay inside the rail (review 2026-11-03)", r.lots > 10 && r.bad.length === 0, r.bad);
    await ctx.close();
  }

  console.log("## the pinned rail fits the window and its figures share one layout (second pass, 2026-11-03)");
  for (const [w, h, t] of [[1000, 800, null], [1440, 900, null], [1280, 900, "200%"]]) {
    W = X.reset(); const more = X.crowd(9);
    W.board[MINE] = more.map((pid, i) => X.boardRow(pid, i + 1, 1000000 + i * 250000));
    W.bids.push(X.bid(597, lotRow(L2).id, MINE, 3, 1250000, Date.now() - 30e3)); Object.assign(lotRow(L2), { price: 1250000, bids: 3 });
    ({ ctx, p } = await open("gm", { width: w, height: h }));
    if (t) { await p.evaluate((x) => { document.documentElement.style.fontSize = x; }, t); await p.waitForTimeout(100); }
    r = await p.evaluate(() => {
      const rail = S2.$("#bdRail"), nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 0, bad = [];
      if (rail.getBoundingClientRect().height > innerHeight - nav - 36 + 1) bad.push("rail " + Math.round(rail.getBoundingClientRect().height) + "px in a " + innerHeight + "px window");
      rail.scrollTop = 1e6;
      const edit = rail.querySelector('a.arrow[href="#/hq?tab=bidding"]');
      if (!edit || edit.getBoundingClientRect().bottom > rail.getBoundingClientRect().bottom + 1) bad.push("Edit your board out of reach");
      /* the widest Season 2 figure, "$48.75M", fits its column with room to spare, and each label holds one line */
      S2.$$(".bd-figs .d-num", rail).forEach((d) => { const was = d.textContent; d.textContent = "$48.75M"; const g = document.createRange(); g.selectNodeContents(d);
        if (g.getBoundingClientRect().width > d.getBoundingClientRect().width - 8) bad.push("figure fills its column: " + Math.round(g.getBoundingClientRect().width) + " of " + Math.round(d.getBoundingClientRect().width));
        d.textContent = was; });
      S2.$$(".bd-figs dt", rail).forEach((dt) => { if (dt.getBoundingClientRect().height > parseFloat(getComputedStyle(dt).lineHeight) * 1.5) bad.push("label wraps: " + dt.textContent); });
      return { bad, board: S2.$$(".bd-board li", rail).length, lead: /Bids you lead1/.test(rail.textContent) };
    });
    A("at " + w + "x" + h + " with " + (t || "100%") + " text, a full board and a bid led, the rail fits the window, scrolls to Edit your board, and its figures fit on one-line labels",
      r.board === 8 && r.lead && r.bad.length === 0, r);
    await ctx.close();
  }

  console.log("## the skipped Saturdays read at AA in dark mode (review 2026-11-03: 3.91:1)");
  W = X.reset();
  ({ ctx, p } = await open("gm", { theme: "dark", ctx: { colorScheme: "dark" } }));
  await p.evaluate(() => Promise.all(document.body.getAnimations().map((a) => a.finished)));
  r = await p.evaluate(() => {
    const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
    const lum = (m) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const x = S2.$("#bdNights button.skip"), layers = []; let el = x;
    while (el) { const c = parse(getComputedStyle(el).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; el = el.parentElement; }
    let base = layers.length && layers[layers.length - 1][3] >= 1 ? layers.pop() : [255, 255, 255, 1];
    while (layers.length) { const l = layers.pop(); base = [0, 1, 2].map((i) => l[i] * l[3] + base[i] * (1 - l[3])).concat(1); }
    const a = lum(parse(getComputedStyle(x).color)), c = lum(base); return { ratio: +((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)).toFixed(2), dark: S2.state.theme };
  });
  A("a struck-through skipped Saturday in the picker measures at least 4.5:1 on the band, in dark mode", r.ratio >= 4.5 && r.dark === "dark", r);
  await ctx.close();

  const errs = X.errs.filter((e) => !/Failed to load resource/.test(e));
  A("no console or page errors", errs.length === 0, errs.slice(0, 5));
  await b.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
