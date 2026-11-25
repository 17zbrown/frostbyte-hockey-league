const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The Season 2 player market on the REAL site, proved in headless Chromium: node tools/ui/run.cjs --suite market --mode live
   (any mode works: every context opts into the real site itself). v5.00 swap (i3e, 2026-11-25): S2.market is the
   league's market only (sql v4.58 and v4.59), so this suite drives the camp page, the bid room, the waiver door and the
   Inbox as the site build ships them (tools/ui/mock live mode: supabase-js from vendor/, S2.LIVE true, signed in as a
   persona), over the world in tools/ui/market-world.cjs: every read of *.supabase.co is answered there as production's
   RLS would answer that persona, and every write goes through S2.write into the world's write doors, so nothing reaches
   production, writes nothing and posts nothing. Each check proves a door's exact arguments, that nothing shows as done
   before the database answers, that a refusal is the database's own sentence said in place with the input kept, and
   that the page repaints in place.
   The commissioner's rulings it carries (2026-11-02): "bids always start at 750k and can only be raised by 250k at a
   time. a team cannot place two bids in a row on the same player. They need to wait for another team to bid in order to
   raise their own bid on a player." and "a team cannot place a bid on a player that would take them over their salary
   cap." The database enforces them (sql v4.59 and its rehearsal); the page shows the season's own price ladder
   (season_rules mk) and says the database's refusal. The checks that pinned the demo engine (its sample clock, rival
   bidders, availability marks, Discord previews, forced moves and the automatic-update carry) went with it. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)) + ")")); if (!cond) fails++; };

(async () => {
  const b = await chromium.launch();
  await realMarket(b);
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

async function realMarket(b) {
  const X = require("./market-world.cjs")(mock);
  const { uuid, ID, MINE, CA, CB, CC, CD, MEMBER, STAFF, L1, L2, L3, S1, S2P, W1, W2, F1, G, NIGHT, GAMES, NOW, BK } = X;
  const iso = X.iso, calls = X.calls, txt = X.txt, settled = X.settled;
  const errs = X.errs;
  /* the trap this layer met once (2026-11-24): market.js is one function scope, and a function declared twice hoists the
     later one over the earlier (a board helper named at() replaced the sample clock's at() and every clock read 1969).
     One name, one declaration */
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(process.env.S2_ROOT, "js/market.js"), "utf8").split("\n"), seen = {};
  src.forEach((l) => { const m = /^  function ([A-Za-z_$][\w$]*)/.exec(l); if (m) seen[m[1]] = (seen[m[1]] || 0) + 1; });
  const twice = Object.keys(seen).filter((k) => seen[k] > 1);
  A("js/market.js declares each top-level function once", twice.length === 0, twice);
  async function open(persona, hash, w, o) {
    const x = await X.open(b, persona, hash, Object.assign(w ? { width: w } : {}, o || {}));
    const st = await x.p.evaluate(() => S2.market.status());
    A(persona + ": the market was read on " + hash + " with no error", st.loaded && !st.error, st);
    return x;
  }

  console.log("## the search finds the market's pages; the Season 1 floor stays 14 (v4.43)");
  {
    const { ctx, p } = await open("gm", "#/camp");   /* Team HQ's tabs are a front office's, so its search entries are too */
    const r = await p.evaluate(() => ({ search: S2.searchIndex().filter((x) => /Bid room|Training camp|^Bidding$/.test(x.label)).map((x) => x.label + " " + x.href),
      rules1: S2.M.RULES.s1.floor, s1sum: S2.M.control.season(1).summary.filter((x) => /floor/.test(x.label))[0].value }));
    A("search finds Bid room, Training camp and the HQ Bidding tab", r.search.join("|") === "Bid room #/bidding|Training camp #/camp|Bidding #/hq?tab=bidding", r.search);
    A("Season 1's playoff floor is 14 (v4.43)", r.rules1 === 14 && r.s1sum === "14", r);
    await ctx.close();
  }

  console.log("## the market: the API, no demo device left, the GM on the camp page");
  let W = X.w;
  let { ctx, p } = await open("gm", "#/camp");
  let r = await p.evaluate(() => {
    const K = S2.market, t = (s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
    return { club: K.club(), names: ["on", "now", "pool", "poolPlayer", "inPool", "poolMe", "waivers", "waiver", "claim", "request", "release", "accept", "decline", "asks", "asksFor",
      "requests", "gamePlayers", "fillIns", "board", "boardAdd", "boardSet", "boardRemove", "boardMove", "onBoard", "clubState", "room", "onLot", "bid", "recap", "bidNights", "nextBidNight",
      "tonight", "gameNights", "pauseBidding", "resumeBidding", "bidPause", "lineupProblems", "waive", "waiveDoor", "voidLot", "clubGames", "ensure", "reload", "watchRoom", "status", "club", "setClub"].filter((n) => typeof K[n] !== "function"),
      gone: ["clock", "setClock", "skip", "available", "setAvailable", "setPoolMe", "discordFor", "live"].filter((n) => n in K), discord: "discord" in S2,
      /* QA round 2 integration (2026-11-25): "same" compares every field the database sets on a waiver, never `left`,
         the live countdown (expires_at minus Date.now()): the whole view raced the clock, and the commissioner persona's
         run failed once when the two reads straddled a millisecond with an open waiver in the world */
      inert: (() => { const rows = () => JSON.stringify(K.waivers().map((w) => [w.id, w.pid, w.from, w.salary, w.at, w.until, w.claimedBy, w.voided]));
        const el = document.createElement("div"), before = rows(); const out = [K.mountClock(el), K._due(), K._waived({ pid: "x", from: "DET", salary: 750000, at: 0, until: 1 })];
        return { hidden: el.hidden, empty: el.childNodes.length === 0, none: out.every((x) => x === undefined), same: rows() === before }; })(),
      ladder: [K.MIN, K.STEP, K.SIX, K.LOT_MS, K.WAIVER_MS], clock: !!document.querySelector("#cpClock"), sample: document.querySelectorAll("#cpRoot .chip.sample").length,
      cards: document.querySelectorAll("#cpRoot .dc").length, h1: t("#cpHeroIn h1"), wv: t("#cpWvH"), tn: t("#cpTnH"), pool: K.pool().length, el: K.pool().filter((x) => x.eligible).length,
      mineRow: t('#cpWv li[data-row] .cp-act'), claims: document.querySelectorAll('#cpWv [data-cp="claim"]').length, deadline: K.deadline, next: (K.nextBidNight() || {}).key,
      demoWords: (document.getElementById("cpRoot").textContent.match(/.{0,40}(sample clock|marked themselves available|\(demo\)|stand in for the Season 2|preview time).{0,40}/i) || [null])[0] };
  });
  A("S2.market acts for the GM's own club", r.club === MINE, r);
  A("every name a page reads is there on the market, nothing missing", r.names.length === 0, r.names);
  A("the demo devices are gone: no sample clock, skip, availability mark, pool player stand-in, Discord preview or S2.discord", r.gone.length === 0 && !r.discord, r.gone);
  /* shortcut: the three stubs go when s2/i3c (hq.js) and stream i3's FINAL step (js/demo.js) have merged; this check goes with them */
  A("the three names other streams' files still call are inert: mountClock hides its host and draws nothing, _due and _waived change nothing", r.inert.hidden && r.inert.empty && r.inert.none && r.inert.same, r.inert);
  A("the price ladder and the clocks are the season's own (season_rules mk): $750K, $250K, six games, five minutes, 24 hours",
    r.ladder.join() === "750000,250000,6,300000,86400000" && X.reads.indexOf("season_rules") >= 0, r.ladder);
  A("no demo device on the page: no sample clock, no sample chip, no preview card, no word of one", !r.clock && r.sample === 0 && r.cards === 0 && r.demoWords === null, r);
  A("the hero and the sections read the database: pool and eligibility counts, the waivers, the next game night", r.h1 === r.pool + " players, " + r.el + " ready for Saturday" && r.wv === "Two players on waivers" && /^Requests are open for /.test(r.tn), r);
  A("the calendar is the database's: the deadline and the next bid night come from market_calendar", r.deadline === NOW + 20 * 86400e3 && r.next === BK, [r.deadline, r.next]);
  A("one Claim door, on the other club's waiver; the club's own waiver says it placed them", r.claims === 1, r);

  /* a claim the database refuses: its sentence under the row, nothing done, the button free again */
  mock.respond(ctx, "market_claim", mock.fail("23514", "Claiming that player at $1.00M would put your club at $31.00M, over the $30.00M cap.", "over_cap"));
  await p.click('#cpWv [data-cp="claim"]'); await settled(p);
  r = await p.evaluate(() => ({ say: (document.querySelector("#cpWv .cp-say") || {}).textContent || null, still: document.querySelectorAll('#cpWv [data-cp="claim"]').length, ok: !!S2.$$(".toast").filter((x) => /claimed/.test(x.textContent)).length }));
  A("a refused claim says the database's own sentence in place, and nothing shows as claimed", /over the \$30\.00M cap\./.test(r.say) && r.still === 1 && !r.ok, r);
  let c = calls(ctx, "market_claim");
  A("the claim went to market_claim with the waiver and the club, never through the Owner's queue", c.length === 1 && c[0].args.p_waiver === uuid(701) && c[0].args.p_team === ID(MINE) && c[0].approval === null, c);
  /* the claim the database takes: the button waits while the door is open, then the waiver is gone from the list */
  mock.respond(ctx, "market_claim", X.writes().market_claim); X.hold.on = true;
  const root = await p.evaluate(() => (window.__cp = document.getElementById("cpRoot"), true));
  await p.click('#cpWv [data-cp="claim"]');
  const waiting = await p.evaluate(() => { const b = document.querySelector('#cpWv [data-cp="claim"]'); return !!b && b.disabled && b.getAttribute("aria-busy") === "true" && !S2.$$(".toast").some((x) => /claimed/.test(x.textContent)); });
  await settled(p); X.hold.on = false;
  r = await p.evaluate(() => ({ wv: document.querySelector("#cpWvH").textContent, claims: document.querySelectorAll('#cpWv [data-cp="claim"]').length, toast: S2.$$(".toast").some((x) => /claimed .* off waivers/.test(x.textContent)), same: document.getElementById("cpRoot") === window.__cp }));
  A("while the claim is open the button waits (disabled, busy) and nothing says claimed", waiting && root);
  A("once the database confirms, the page reads the market again and repaints in place: one waiver left, the toast, same page", r.wv === "One player on waivers" && r.claims === 0 && r.toast && r.same, r);
  A("the claim asked the league read for the roster sections it changed", calls(ctx, "market_claim").length === 2);

  /* a request for one of the club's games tonight, and the withdrawal of the pending one */
  await p.evaluate((id) => S2.$('#cpTn [data-cp="games"][data-pid="' + id + '"]').click(), MEMBER);
  await p.waitForSelector(".cp-gsheet");
  r = await p.evaluate(() => ({ games: S2.$$(".cp-gsheet .cp-game .title").map((x) => x.textContent), btns: S2.$$(".cp-gsheet button").map((x) => x.textContent) }));
  A("the request sheet lists the club's own games tonight from the schedule, with their opponents", r.games.length === 3 && /^Game 1 · 9:00 PM vs /.test(r.games[0]) && /^Game 2 · 9:35 PM vs /.test(r.games[1]) && /^Game 3 · 10:10 PM vs /.test(r.games[2]), r);
  await p.click('.cp-gsheet [data-cg="release"][data-game="1"]'); await settled(p);
  c = calls(ctx, "market_pool_withdraw");
  A("Withdraw on the pending request calls market_pool_withdraw with that request", c.length === 1 && c[0].args.p_request === uuid(401) && c[0].approval === null, c);
  await p.click('.cp-gsheet [data-cg="request"][data-game="2"]'); await settled(p);
  c = calls(ctx, "market_pool_request");
  A("Request this game calls market_pool_request with that game, the club and the player", c.length === 1 && c[0].args.p_game === G.g2 && c[0].args.p_team === ID(MINE) && c[0].args.p_profile === MEMBER, c);
  r = await p.evaluate(() => S2.$$(".cp-gsheet .cp-game .sub").map((x) => x.textContent));
  A("the sheet repaints from the database: game 1 withdrawn, game 2 waiting for the answer", r[0] === "Withdrawn" && r[1] === "Waiting for their answer", r);
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);

  /* the bid board: the add saves the whole board, keeping the targets and ceilings already on it */
  await p.evaluate((id) => { const b = S2.$('#cpPoolList [data-cp="board"][data-pid="' + id + '"]'); b.click(); }, L2); await settled(p);
  c = calls(ctx, "save_market_board");
  A("Add to bid board saves the whole board through save_market_board, the earlier target and its ceiling kept",
    c.length === 1 && c[0].args.p_team === ID(MINE) && JSON.stringify(c[0].args.p_rows) === JSON.stringify([{ profile_id: L1, ceiling: 1500000, note: "first target" }, { profile_id: L2, ceiling: null, note: null }]), c);
  r = await p.evaluate((id) => ({ on: !!S2.$('#cpPoolList tr[data-row="' + id + '"] .cp-onb'), board: S2.market.board(S2.market.club()).map((x) => x.rank + ":" + x.state) }), L2);
  A("the row then reads On board, as the database's board says", r.on && r.board.join() === "1:pool,2:pool", r);
  A("no market door asked for the Owner's queue", mock.calls(ctx).filter((x) => x.rpc !== "waive_player").every((x) => x.approval === null));

  console.log("## the waiver door: the ruled confirm popup, the not-inactive box, the database's refusal kept in the popup");
  await p.evaluate((id) => { window.__wd = S2.market.waiveDoor(id); }, F1);
  await p.waitForSelector(".cf [data-mk-ok]");
  r = await p.evaluate(() => ({ text: S2.$(".cf").innerText, title: S2.$$(".sheet h2, .sheet [role=heading], .sheet .sh-title").map((x) => x.textContent).join("|") }));
  A("the popup says the ruled words: the club cannot reclaim them until they clear waivers and become available during the Saturday bidding",
    /cannot reclaim .+ until they have cleared waivers and become available during the Saturday bidding\./.test(r.text) && /not being waived for being inactive/.test(r.text), r.text);
  await p.click('.cf [data-cf="ok"]'); await p.waitForTimeout(100);
  r = await p.evaluate(() => ({ err: S2.$("[data-mk-err]").textContent, open: !!S2.$(".cf") }));
  A("without the box ticked nothing is sent and the popup asks for it", /not being waived for being inactive/.test(r.err) && r.open && calls(ctx, "waive_player").length === 0, r);
  await p.check(".cf [data-mk-ok]"); await p.click('.cf [data-cf="ok"]'); await settled(p);
  r = await p.evaluate(() => ({ err: S2.$("[data-mk-err]") && S2.$("[data-mk-err]").textContent, box: S2.$("[data-mk-ok]") && S2.$("[data-mk-ok]").checked, open: !!S2.$(".cf") }));
  A("a waiver the database refuses keeps the popup open with its sentence and the box as ticked", /short of the Season 2 roster minimums/.test(r.err) && r.box && r.open, r);
  await p.click('.cf [data-cf="ok"]'); await settled(p);
  await p.waitForFunction(() => !document.querySelector(".cf [data-mk-ok]"), null, { timeout: 3000 }).catch(() => null);
  r = await p.evaluate(() => window.__wd.then((x) => ({ ok: x.ok, open: !!S2.$(".cf [data-mk-ok]") })));
  c = calls(ctx, "waive_player");
  A("the waiver goes to waive_player with the confirmation, by the Owner's queue when the club's policy asks (mgmt_gate decides)",
    c.length === 2 && c[1].args.p_profile === F1 && c[1].args.p_not_inactive === true && c[1].approval === "owner" && r.ok && !r.open, [c, r]);
  await ctx.close();

  console.log("## the member in the pool: the request, accept, then withdraw the acceptance");
  W = X.reset();
  ({ ctx, p } = await open("member", "#/camp"));
  r = await p.evaluate(() => ({ card: !!S2.$("#cpAsk"), rows: S2.$$("#cpAsk .cp-ask-r .title").map((x) => x.textContent), btns: S2.$$("#cpAsk button").map((x) => x.textContent), sample: S2.$$("#cpAsk .chip.sample").length, office: S2.$$('#cpRoot [data-cp="claim"], #cpRoot [data-cp="games"], #cpRoot [data-cp="board"]').length }));
  A("the member's own request shows as theirs to answer, no sample, and no club doors", r.card && r.rows.length === 1 && new RegExp("game 1, 9:00").test(r.rows[0]) && r.btns.join() === "Accept,Decline" && r.sample === 0 && r.office === 0, r);
  X.hold.on = true;
  await p.click('#cpAsk [data-cp="accept"]');
  const wait2 = await p.evaluate(() => { const b = S2.$('#cpAsk [data-cp="accept"]'); return !!b && b.disabled; });
  await settled(p); X.hold.on = false;
  c = calls(ctx, "market_pool_answer");
  A("Accept waits while the answer is open, then calls market_pool_answer with the request and true", wait2 && c.length === 1 && c[0].args.p_request === uuid(401) && c[0].args.p_accept === true, c);
  r = await p.evaluate(() => ({ sub: S2.$$("#cpAsk .cp-ask-r .sub").map((x) => x.textContent), btns: S2.$$("#cpAsk button").map((x) => x.textContent) }));
  A("the card repaints in place from the database: accepted, with Withdraw until the lock", /^Accepted/.test(r.sub[0]) && r.btns.join() === "Withdraw", r);
  await p.click('#cpAsk [data-cp="decline"]'); await settled(p);
  c = calls(ctx, "market_pool_answer");
  A("Withdraw sends market_pool_answer false on the accepted request (sql v4.59: a player may withdraw an acceptance)", c.length === 2 && c[1].args.p_accept === false && c[1].args.p_request === uuid(401), c);
  await ctx.close();

  console.log("## the bid room as the GM: the lots, a raise, a moved price, the pulse");
  W = X.reset();
  W.board[MINE].push(X.boardRow(L3, 2));   /* sold tonight: off the board at its next save */
  ({ ctx, p } = await open("gm", "#/bidding"));
  r = await p.evaluate(() => {
    const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
    return { lots: S2.$$("#bdLots .bd-lot").map((x) => x.dataset.state + ":" + (x.querySelector("[data-bd-bid]") ? x.querySelector("[data-bd-bid]").textContent : "-")),
      state: t("[data-bd-state]"), rail: t("#bdRail [data-bd-room]"), spots: t("#bdRail [data-bd-spots]"), clock: !!S2.$("#bdClock, .mk-clock"), how: t("#bdHowH"), howp: t("#bdHowP"),
      nights: S2.$$("#bdNights button").length, sold: t('#bdLots .bd-lot[data-state="sold"] .bd-sold'), sample: S2.$$("#bdRoom .chip.sample").length, dc: S2.$$("#bdRoom .dc").length,
      board: S2.$$("#bdRail .bd-board li .bd-bs").map((x) => x.textContent), words: document.getElementById("bdRoom").textContent };
  });
  A("the lots come in the database's fixed order with ONE button each carrying the exact next price",
    r.lots.join("|") === "open:Open at $750K|running:Raise to $1.25M|sold:-", r.lots);
  A("the room is live, the rail is the database's club state ($10M room, 3 open spots), no sample clock bar", r.state === "Live" && r.rail === "$10M" && r.spots === "3" && !r.clock, r);
  A("the nights and how-it-works come from the calendar, the holiday Saturday struck", r.nights === 3 && r.how === "One hour, two Saturdays" && /holiday weeks have none/.test(r.howp), r);
  A("a lot that is over names its club", /Sold to the /.test(r.sold), r.sold);
  A("the rail's board says a target who left the pool comes off the board at its next save", r.board.length === 2 && /off the board at its next save$/.test(r.board[1]) && !/next save/.test(r.board[0]), r.board);
  A("no demo device in the real room: no sample chip, no Discord preview, no word of a sample clock, rival bidders or (demo)",
    r.sample === 0 && r.dc === 0 && !/sample clock|Rival clubs|\(demo\)|stand in for the Season 2/i.test(r.words), [r.sample, r.dc, (r.words.match(/.{0,40}(sample clock|Rival clubs|\(demo\)|stand in for the Season 2).{0,40}/i) || [])[0]]);
  delete r.words;
  X.hold.on = true;
  await p.evaluate(() => { window.__lots = S2.$("#bdLots"); window.__room = S2.$("#bdRoom"); });
  await p.click('#bdLots .bd-lot[data-state="running"] [data-bd-bid]');
  const wait3 = await p.evaluate(() => { const b = S2.$('#bdLots .bd-lot[data-state="running"] [data-bd-bid]'); return !!b && b.disabled && b.getAttribute("aria-busy") === "true" && !/leads/.test(S2.$('#bdLots .bd-lot[data-state="running"]').textContent); });
  await settled(p); X.hold.on = false;
  c = calls(ctx, "market_bid");
  A("Raise calls market_bid with the lot, the club and the price the page showed, never through the Owner's queue",
    c.length === 1 && c[0].args.p_lot === uuid(602) && c[0].args.p_team === ID(MINE) && c[0].args.p_expect === 1250000 && c[0].approval === null, c);
  r = await p.evaluate(() => ({ st: S2.$('#bdLots .bd-lot[data-pid] .bd-lot-st') && S2.$$("#bdLots .bd-lot")[1].querySelector(".bd-lot-st").textContent, mine: S2.$$("#bdLots .bd-lot")[1].classList.contains("is-mine"),
    btn: S2.$$("#bdLots .bd-lot")[1].querySelector("[data-bd-bid]").textContent, same: S2.$("#bdRoom") === window.__room, live: S2.$("#bdLive").textContent }));
  A("while the bid is open the button waits and nothing says the club leads", wait3);
  A("once the database takes it the lot reads the club's lead at $1.25M, in place (same room)", /Your club leads/.test(r.st) && r.mine && r.same && /bid \$1\.25M/.test(r.live), r);
  /* a raise from another club lands first: the page still shows $750K on the first lot, the database refuses the price */
  W.lots[0].price = 750000; W.lots[0].bids = 1; W.lots[0].state = "running"; W.lots[0].ends_at = iso(Date.now() + 290e3);
  W.bids.push(X.bid(590, uuid(601), CC, 1, 750000, Date.now()));
  await p.click('#bdLots .bd-lot[data-state="open"] [data-bd-bid]'); await settled(p);
  r = await p.evaluate(() => { const l = S2.$$("#bdLots .bd-lot")[0]; return { say: (l.querySelector("[data-bd-say]") || {}).textContent || null, any: !!l.querySelector("[data-bd-anyway]"), btn: l.querySelector("[data-bd-bid]").textContent, state: l.dataset.state }; });
  A("a moved price is refused in the database's words, beside the lot read again at its new price",
    /The price moved to \$1\.00M/.test(r.say || "") && r.btn === "Raise to $1M" && r.state === "running", r);
  A("...the refusal offers no Bid anyway (demo)", !r.any, r);
  /* the pulse: the league marks the market, the room reads it again and repaints in place */
  W.lots[0].price = 1250000; W.lots[0].bids = 2;
  W.bids.push(X.bid(591, uuid(601), CD, 2, 1250000, Date.now()));
  await p.evaluate(() => S2.live.emit("market", {})); await p.waitForTimeout(700);
  r = await p.evaluate(() => { const l = S2.$$("#bdLots .bd-lot")[0]; return { btn: l.querySelector("[data-bd-bid]").textContent, say: !!l.querySelector("[data-bd-say]"), st: l.querySelector(".bd-lot-st").textContent, same: S2.$("#bdRoom") === window.__room }; });
  A("on the market pulse the room re-reads: the raise shows, the bidder hidden, the stale refusal gone, the page not re-routed",
    r.btn === "Raise to $1.50M" && /Bidder hidden/.test(r.st) && !r.say && r.same, r);
  /* live.js re-routes after a pulse unless the page repaints itself (contracts/client-api.md, The pulse) */
  await p.evaluate(() => S2.live.emit("scores", {})); await p.waitForTimeout(100);
  r = await p.evaluate(() => ({ b: S2.pages.bidding.repaintsItself, c: S2.pages.camp.repaintsItself, same: S2.$("#bdRoom") === window.__room }));
  A("the bid room and the camp page repaint themselves on every pulse domain, so live.js never re-routes them mid-hour", r.b === true && r.c === true && r.same, r);
  /* a debounce that restarts on every change never reads a busy room: changes every 100ms must still bring a read */
  const lotsReads = () => X.reads.filter((x) => /^market_lots\?/.test(x)).length, before = lotsReads();
  await p.evaluate(() => { window.__hot = setInterval(() => S2.live.emit("market", {}), 100); });
  await p.waitForTimeout(1200);
  const mid = lotsReads();
  await p.evaluate(() => clearInterval(window.__hot)); await p.waitForTimeout(600);
  A("a busy market is still read while the changes keep coming (the first change sets the time, later ones join it)", mid > before, [before, mid]);
  await p.click('#bdLots .bd-lot[data-state="running"] .bd-lot-name'); await p.waitForSelector(".bd-sheet");
  r = await p.evaluate(() => ({ dc: S2.$$(".bd-sheet .dc").length, vd: !!S2.$(".bd-sheet [data-bd-void]"), who: S2.$$(".bd-sheet .bd-hist-w").map((x) => x.textContent) }));
  A("the lot sheet: no Discord preview, no withdraw door for a club, and no club named while it runs", r.dc === 0 && !r.vd && r.who.every((w) => w === "Your club" || w === "A club"), r);
  await ctx.close();

  console.log("## the bid room as the commissioner: pause, resume, withdraw a lot, act for a club");
  W = X.reset();
  ({ ctx, p } = await open("commissioner", "#/bidding"));
  r = await p.evaluate(() => ({ pause: (S2.$("[data-bd-pause]") || {}).textContent, club: S2.market.club(), watch: !!S2.$("#bdRail .bd-watch-h"),
    sel: (S2.$("#bdRail [data-bd-club]") || {}).value, first: (S2.$("#bdRail [data-bd-club] option") || {}).textContent }));
  /* review 2026-11-24: the first club by default let one misclick write for a club nobody chose */
  A("the commissioner sees the pause control and only watches until they choose a club: Acting for opens on Watching", r.pause === "Pause bidding" && r.club === null && r.watch && r.sel === "" && r.first === "Watching", r);
  await p.click('#bdLots .bd-lot[data-state="running"] [data-bd-bid]'); await settled(p);
  r = await p.evaluate(() => (S2.$('#bdLots .bd-lot[data-state="running"] [data-bd-say]') || {}).textContent || null);
  A("...a Raise while watching writes nothing, and the lot says to choose the club", calls(ctx, "market_bid").length === 0 && /Choose the club you are bidding for/.test(r || ""), r);
  await p.click("[data-bd-pause]"); await settled(p);
  c = calls(ctx, "market_pause");
  A("Pause calls market_pause for tonight's night", c.length === 1 && c[0].args.p_night === NIGHT, c);
  r = await p.evaluate(() => ({ head: S2.$(".bd-head").textContent, state: S2.$("[data-bd-state]").dataset.bdState, ring: S2.$('#bdLots .bd-lot[data-state="running"] .bd-ring-n').textContent, btn: S2.$("[data-bd-pause]").textContent, bids: S2.$$("#bdLots [data-bd-bid]").length }));
  await p.waitForTimeout(1300);
  const ring2 = await p.evaluate(() => S2.$('#bdLots .bd-lot[data-state="running"] .bd-ring-n').textContent);
  A("paused: the room says so, takes no bid, and every countdown stands still", r.head === "Bidding is paused" && r.state === "paused" && r.ring === "4:00" && ring2 === "4:00" && r.bids === 0 && r.btn === "Resume bidding", [r, ring2]);
  await p.click("[data-bd-pause]"); await settled(p);
  A("Resume calls market_resume for the night", calls(ctx, "market_resume").length === 1 && calls(ctx, "market_resume")[0].args.p_night === NIGHT);
  await p.click('#bdLots .bd-lot[data-state="running"] .bd-lot-name'); await p.waitForSelector(".bd-sheet [data-bd-void]");
  await p.click(".bd-sheet [data-bd-void]"); await p.waitForSelector("[data-bd-why]");
  await p.click('.cf [data-cf="ok"]'); await p.waitForTimeout(100);
  r = await p.evaluate(() => S2.$("[data-bd-err]").textContent);
  A("withdrawing a lot needs a reason: nothing is sent without one", /Give the reason/.test(r) && calls(ctx, "market_void_lot").length === 0, r);
  await p.fill("[data-bd-why]", "Asked to be withdrawn tonight"); await p.click('.cf [data-cf="ok"]'); await settled(p);
  c = calls(ctx, "market_void_lot");
  A("Withdraw calls market_void_lot with the lot and the reason", c.length === 1 && c[0].args.p_lot === uuid(602) && c[0].args.p_reason === "Asked to be withdrawn tonight", c);
  r = await p.evaluate(() => S2.$$("#bdLots .bd-lot").map((x) => x.dataset.state).join());
  A("the room repaints in place: the lot is void", r === "open,void,sold", r);
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await p.evaluate((code) => { const s = S2.$("#bdRail [data-bd-club]"); s.value = code; s.dispatchEvent(new Event("change", { bubbles: true })); }, CB); await p.waitForTimeout(500);
  r = await p.evaluate(() => ({ club: S2.market.club(), team: S2.$("#bdRail .bd-club").textContent }));
  A("the commissioner's Acting for picks the club the room reads (market_club_state for it)", r.club === CB && X.reads.some((x) => x === "market_club_state"), r);
  await p.evaluate(() => { const s = S2.$("#bdRail [data-bd-club]"); s.value = ""; s.dispatchEvent(new Event("change", { bubbles: true })); }); await p.waitForTimeout(500);
  r = await p.evaluate(() => ({ club: S2.market.club(), watch: !!S2.$("#bdRail .bd-watch-h"), sel: S2.$("#bdRail [data-bd-club]").value }));
  A("...and Watching takes them back to watching", r.club === null && r.watch && r.sel === "", r);
  await ctx.close();

  console.log("## the commissioner on the camp page: no club doors until Acting for names a club, then that club's");
  W = X.reset();
  ({ ctx, p } = await open("commissioner", "#/camp"));
  const doorsSel = '#cpRoot [data-cp="claim"], #cpRoot [data-cp="games"], #cpRoot [data-cp="board"]';
  r = await p.evaluate((s) => ({ club: S2.market.club(), doors: S2.$$(s).length, sel: (S2.$("#cpHeroIn [data-cp-club]") || {}).value, fo: !!S2.$('#cpHeroIn [data-cp="office"]') }), doorsSel);
  A("watching: no Claim, Request or board door, and Acting for opens on Watching", r.club === null && r.doors === 0 && r.sel === "" && !r.fo, r);
  await p.focus("#cpHeroIn [data-cp-club]"); await p.selectOption("#cpHeroIn [data-cp-club]", CB); await p.waitForTimeout(500);   /* a person's click focuses the select first */
  r = await p.evaluate((s) => ({ club: S2.market.club(), claims: S2.$$('#cpWv [data-cp="claim"]').length, doors: S2.$$(s).length, sel: S2.$("#cpHeroIn [data-cp-club]").value, focus: document.activeElement && document.activeElement.matches("[data-cp-club]") }), doorsSel);
  A("choosing a club opens its doors in place (both waivers claimable, neither is that club's), the picker keeps focus", r.club === CB && r.claims === 2 && r.doors > 2 && r.sel === CB && r.focus, r);
  await p.click('#cpWv [data-cp="claim"][data-pid="' + W1 + '"]'); await settled(p);
  c = calls(ctx, "market_claim");
  A("...and a claim then goes for the chosen club", c.length === 1 && c[0].args.p_team === ID(CB) && c[0].args.p_waiver === uuid(701), c);
  await ctx.close();

  console.log("## a visitor: the room and the pool, no doors, no hidden bids");
  W = X.reset();
  ({ ctx, p } = await open("anon", "#/bidding"));
  r = await p.evaluate(() => ({ watch: !!S2.$("#bdRail .bd-watch-h"), pause: !!S2.$("[data-bd-pause]"), btn: S2.$$("#bdLots [data-bd-bid]").length, club: S2.market.club() }));
  A("a visitor watches: no club, no pause, and a bid press is a sign-in matter, not a write", r.watch && !r.pause && r.club === null, r);
  await ctx.close();

  console.log("## the GM's pool requests: the database's refusal kept in the sheet, and the release of an accepted guest");
  W = X.reset();
  W.reqs.push(X.req(420, 2, MINE, S2P, "accepted", NOW - 600e3));
  ({ ctx, p } = await open("gm", "#/camp"));
  mock.respond(ctx, "market_pool_request", mock.fail("23514", "Your club already has three training camp players tonight, the most a club may use in one night.", "pool_night_limit"));
  await p.evaluate((id) => S2.$('#cpTn [data-cp="games"][data-pid="' + id + '"]').click(), S2P);
  await p.waitForSelector(".cp-gsheet");
  r = await p.evaluate(() => S2.$$(".cp-gsheet .cp-game").map((x) => x.querySelector(".sub").textContent + ":" + ((x.querySelector("button") || {}).textContent || "-")));
  A("an accepted guest's game offers Release until the lock (sql v4.59), the others a request", r[2] === "Accepted: add them to this game's lineup in Team HQ:Release" && r[0] === "Not requested:Request this game", r);
  await p.click('.cp-gsheet [data-cg="request"][data-game="1"]'); await settled(p);
  r = await p.evaluate(() => ({ say: S2.$(".cp-gsheet [data-cg-say]").textContent, sub: S2.$('.cp-gsheet .cp-game[data-game="1"] .sub').textContent, btn: S2.$('.cp-gsheet .cp-game[data-game="1"] button').textContent, demo: !!S2.$(".ov, [data-ov]") }));
  A("the three-a-night limit is the database's: its sentence in the sheet, nothing marked requested, no Request anyway (demo)",
    /three training camp players tonight/.test(r.say) && r.sub === "Not requested" && r.btn === "Request this game" && calls(ctx, "market_pool_request").length === 1, r);
  await p.click('.cp-gsheet [data-cg="release"][data-game="3"]'); await settled(p);
  c = calls(ctx, "market_pool_withdraw");
  A("Release calls market_pool_withdraw on the accepted request, then the sheet repaints from the database",
    c.length === 1 && c[0].args.p_request === uuid(420) && (await txt(p, '.cp-gsheet .cp-game[data-game="3"] .sub')) === "Withdrawn", c);
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  /* the board's other doors through the API, each one save of the whole board in the order the database keeps */
  W.board[MINE].push(X.boardRow(L2, 2));
  await p.evaluate(() => S2.market.reload());
  r = await p.evaluate(async (a) => {
    const K = S2.market, club = K.club(), out = [];
    out.push((await K.boardMove(club, a.L2, 1)).ok);
    out.push((await K.boardSet(club, a.L2, { ceiling: 2000000, note: "  late target " })).ok);
    out.push((await K.boardRemove(club, a.L1)).ok);
    const no = await K.boardRemove(club, "00000000-0000-4000-8000-000000000000");
    return { out, board: K.board(club).map((x) => x.rank + ":" + x.ceiling + ":" + x.note), no: no.ok === false && no.problems[0].code };
  }, { L1, L2 });
  c = calls(ctx, "save_market_board");
  A("move, ceiling and remove each save the whole board through save_market_board, in order",
    r.out.join() === "true,true,true" && c.length === 3 && c[0].args.p_rows.map((x) => x.profile_id).join() === [L2, L1].join() &&
    c[1].args.p_rows[0].ceiling === 2000000 && c[1].args.p_rows[0].note === "late target" && c[2].args.p_rows.length === 1 && r.board.join() === "1:2000000:late target", [r, c.map((x) => x.args.p_rows)]);
  A("...and a player not on the board is refused here, with nothing sent", r.no === "not_on_board" && calls(ctx, "save_market_board").length === 3, r.no);
  /* review 2026-11-24: two players on the board leave the pool (one sold at bidding, one never in it now). save_market_board
     refuses a whole board for one such row and nothing prunes a board, so every later save would fail: each save drops
     them, while a player added now who is not in the pool is still the database's refusal */
  const row = (pid, rank) => X.boardRow(pid, rank);
  const seed = (list) => { W.board[MINE] = list.map((pid, i) => row(pid, i + 1)); return p.evaluate(() => S2.market.reload()); };
  await seed([L2, L3, F1]);
  r = await p.evaluate(async (a) => {
    const K = S2.market, club = K.club(), states = K.board(club).map((x) => x.state);
    const add = await K.boardAdd(club, a.L1, {});
    return { states, add: add.ok, after: K.board(club).map((x) => x.pid) };
  }, { L1, L2, L3, F1 });
  c = calls(ctx, "save_market_board");
  A("a board holding two players who left the pool shows them as signed or gone, and Add still saves, without them",
    r.states[0] === "pool" && /^(signed|gone)$/.test(r.states[1]) && /^(signed|gone)$/.test(r.states[2]) && r.add &&
    JSON.stringify(c[c.length - 1].args.p_rows.map((x) => x.profile_id)) === JSON.stringify([L2, L1]) && r.after.join() === [L2, L1].join(), [r, c[c.length - 1].args.p_rows]);
  await seed([L2, L1, L3, F1]);
  r = await p.evaluate(async (a) => { const K = S2.market, club = K.club(), x = await K.boardRemove(club, a.L2); return { ok: x.ok, after: K.board(club).map((y) => y.pid) }; }, { L2 });
  c = calls(ctx, "save_market_board");
  A("...Remove saves too, the two who left dropped with it", r.ok && JSON.stringify(c[c.length - 1].args.p_rows.map((x) => x.profile_id)) === JSON.stringify([L1]) && r.after.join() === L1, [r, c[c.length - 1].args.p_rows]);
  await seed([L1, L3]);
  r = await p.evaluate(async (a) => { const K = S2.market, club = K.club(), x = await K.boardRemove(club, a.L3); return { ok: x.ok, after: K.board(club).map((y) => y.pid) }; }, { L3 });
  c = calls(ctx, "save_market_board");
  A("...and removing a player who left is a save of the rest, never 'not on your board'", r.ok && c[c.length - 1].args.p_rows.length === 1 && r.after.join() === L1, r);
  const n0 = calls(ctx, "save_market_board").length;
  r = await p.evaluate(async (a) => { const K = S2.market, club = K.club(), x = await K.boardAdd(club, a.F1, {}); return { ok: x.ok, text: x.problems.map((y) => y.text).join(" "), after: K.board(club).map((y) => y.pid) }; }, { F1 });
  c = calls(ctx, "save_market_board");
  A("...a player added now who is not in the pool is sent as typed, and the database's refusal is said, the board unchanged",
    !r.ok && /not in the training camp pool or on waivers/.test(r.text) && c.length === n0 + 1 && c[c.length - 1].args.p_rows.some((x) => x.profile_id === F1) && r.after.join() === L1, r);
  await ctx.close();

  console.log("## a season's worth of bids: every page is read (PostgREST answers 1000 rows at most)");
  W = X.reset();
  for (let i = 0; i < 1100; i++) W.bids.push(X.bid(100000 + i, uuid(603), i % 2 ? CA : CB, 2 + i, 750000 + 250000 * (i + 1), NOW - 400e3 + i));
  const r0 = X.reads.length;
  ({ ctx, p } = await open("gm", "#/camp"));
  r = await p.evaluate((pid) => { const l = S2.market.room().lots.filter((x) => x.pid === pid)[0]; return { n: l.history.length, top: l.history[0].amt }; }, L3);
  A("the bids read walks every page by id: all 1,101 bids on the sold lot, newest first", r.n === 1101 && r.top === 750000 + 250000 * 1100, r);
  r = X.reads.slice(r0).filter((x) => /^market_bids\?/.test(x));
  A("...in pages of market_bids ordered by id, the second starting after the first page's last id", r.length >= 2 && r.every((x) => /order=id/.test(x)) && r.some((x) => /id=gt\./.test(x)), r.map((x) => x.replace(/select=[^&]*&/, "")).slice(0, 3));
  await ctx.close();

  console.log("## a staffer who does not run the market: the room without the office's doors");
  W = X.reset();
  ({ ctx, p } = await open("staff", "#/bidding"));
  r = await p.evaluate(() => ({ pause: !!S2.$("[data-bd-pause]"), club: S2.market.club() }));
  await p.click('#bdLots .bd-lot[data-state="running"] .bd-lot-name'); await p.waitForSelector(".bd-sheet");
  r.vd = await p.evaluate(() => !!S2.$(".bd-sheet [data-bd-void]"));
  A("no pause, no withdraw and no club for a staffer outside the Draft and Bidding seat (can_run_market decides at the door)", !r.pause && !r.vd && r.club === null, r);
  await ctx.close();

  console.log("## production today: the draft not done, no schedule, an empty pool (market_calendar as it answers on 2026-11-24)");
  W = X.reset(); Object.assign(W, { pool: [], wire: [], nights: [], lots: [], bids: [], reqs: [], board: {}, calendar: X.EMPTY_CAL });
  ({ ctx, p } = await open("gm", "#/camp"));
  r = await p.evaluate(() => ({ h1: S2.$("#cpHeroIn h1").textContent, lede: S2.$("#cpHeroIn .lede-l").textContent, doors: S2.$$('#cpRoot [data-cp="claim"], #cpRoot [data-cp="games"], #cpRoot [data-cp="board"]').length,
    deadline: S2.market.deadline, nights: S2.market.bidNights().length, tonight: S2.market.tonight(), wv: S2.$("#cpWvH").textContent }));
  A("the camp page says the pool opens after the draft, with no door and no date it does not have", r.h1 === "The pool opens after the draft" && r.doors === 0 && r.deadline === null && r.nights === 0 && r.tonight === null && r.wv === "Nobody is on waivers", r);
  /* QA 2026-11-25 (visual, phone, worst case and function lenses): before the draft the page said "The regular season is
     over", "Everyone in the pool has six" and "0 players in the pool" under that hero. Game nights, Road to six and The
     whole pool wait for the draft, and appear in place once the market says it is done */
  const campNow = () => p.evaluate(() => ({ hid: ["cpTn", "cpRoad", "cpPool"].map((id) => { const e = S2.$("#" + id); return !!e && e.hidden && !e.getClientRects().length; }),
    shown: S2.$$("#cpRoot h2").filter((h) => h.getClientRects().length).map((h) => h.textContent), words: S2.$("#cpRoot").innerText,
    tn: S2.$("#cpTnH").textContent, tnp: S2.$("#cpTn .sec-head p").textContent, road: S2.$("#cpRoadH").textContent, count: S2.$("#cpPoolList .cp-count").textContent }));
  r = await campNow();
  A("before the draft the page is the hero, On waivers and How the pool works: Game nights, Road to six and The whole pool wait for the draft",
    r.hid.every(Boolean) && r.shown.join("|") === "Nobody is on waivers|Six games, then Saturday", r.shown);
  A("...and nothing on it says the season is over, that everyone in the pool has six, or counts an empty pool",
    !/regular season is over|game nights remain|in the pool has six|players in the pool|matches these filters/i.test(r.words), r.words.length);
  A("...even hidden, the sections say not yet: no game nights yet (the schedule), nobody in the pool, the pool forms at the draft",
    r.tn === "No game nights yet" && /which is not set yet/.test(r.tnp) && r.road === "Nobody in the pool yet" && /^The pool forms when the draft is complete, \w+day, \w+ \d+\.$/.test(r.count), [r.tn, r.road, r.count]);
  W.calendar = Object.assign({}, X.EMPTY_CAL, { draft_done: true }); W.pool = X.fresh().pool;
  await X.pulse(p);
  r = await campNow();
  A("once the draft is done the three sections appear in place, and with no schedule yet Game nights says so, never that the season is over",
    r.hid.every((h) => !h) && r.tn === "No game nights yet" && !/regular season is over|game nights remain/i.test(r.words) && /short of six$/.test(r.road) && /^Showing \d+ players/.test(r.count), [r.hid, r.tn, r.road, r.count]);
  W.calendar = X.EMPTY_CAL; W.pool = [];
  await X.pulse(p);
  await p.evaluate(() => { location.hash = "#/bidding"; });
  await p.waitForSelector("#bdRoom"); await p.waitForTimeout(200);
  r = await p.evaluate(() => ({ head: S2.$(".bd-head").textContent, meta: S2.$(".bd-meta").textContent, how: S2.$("#bdHowH").textContent, howp: S2.$("#bdHowP").textContent, nights: S2.$$("#bdNights button").length, bids: S2.$$("[data-bd-bid]").length }));
  A("the bid room says no bid nights yet and when they come (the schedule), never a hard-coded Saturday",
    r.head === "No bid nights yet" && /once the Season 2 schedule is set/.test(r.meta) && r.how === "One hour on Saturdays" && /once the Season 2 schedule is set/.test(r.howp) && r.nights === 0 && r.bids === 0 && !/December|January/.test(r.meta + r.howp), r);
  /* QA 2026-11-25: under that head the lots said no bid night was LEFT before the movement deadline, the rail and the
     Control Center the same, and the empty night picker drew its padded fill as a 4px dot under the band's hairline */
  r = await p.evaluate(() => { const ctl = S2.$(".bd-band-ctl"), seg = S2.$("#bdNights");
    return { lots: S2.$("#bdLots").textContent, rail: S2.$("#bdRail").textContent, cc: S2.bidding.ccBids(), seg: !!seg && !seg.getClientRects().length, ctl: !!ctl && getComputedStyle(ctl).display === "none" }; });
  A("the empty room says not yet, never none left: the lots, the rail and the Control Center's Bids step",
    /^No lots yet\./.test(r.lots) && /None yet\. No bid night is set\./.test(r.rail) && /No bid night is set yet/.test(r.cc) && !/ left/.test(r.lots + r.rail + r.cc), [r.lots, r.cc]);
  A("the empty night picker draws nothing, and its row and hairline go with it (it stays in the page for the nights to come)", r.seg && r.ctl, r);
  await ctx.close();

  console.log("## the member's requests on the Inbox: read there, before any market page has been opened");
  W = X.reset();
  ({ ctx, p } = await open("member", "#/you?tab=inbox"));
  await p.waitForFunction(() => S2.$("#cpAsk") && !S2.$("#cpAsk").hidden, null, { timeout: 5000 }).catch(() => null);
  r = await p.evaluate(() => ({ card: !!S2.$("#cpAsk.cp-ask"), btns: S2.$$("#cpAsk button").map((x) => x.textContent) }));
  A("the Inbox reads the market itself and fills the requests card in place, with Accept and Decline", r.card && r.btns.join() === "Accept,Decline", r);
  await ctx.close();

  /* review 2026-11-24: S2.roleOf ranks staff before player, and the card asked for the Player role, so a staffer (or a
     commissioner) in the pool never saw Accept and their requests lapsed at the lock. A staffer reads every club's
     requests before the lock (the route above), so the card must also offer no other member to answer for */
  console.log("## a staffer in the training camp pool answers their own request, on the camp page and the Inbox");
  const staffWorld = () => { W = X.reset(); W.pool.push({ profile_id: STAFF, position: X.posOf(STAFF), pos_group: X.grp(X.posOf(STAFF)), gp: 2, needs: 4, eligible: false, suspended: false, source: "undrafted", last_team_id: null, available_next: null });
    W.reqs.push(X.req(430, 2, MINE, STAFF, "pending", NOW - 300e3)); };
  staffWorld();
  ({ ctx, p } = await open("staff", "#/camp"));
  r = await p.evaluate(() => ({ role: S2.state.role, rows: S2.$$("#cpAsk .cp-ask-r .title").map((x) => x.textContent), btns: S2.$$("#cpAsk button").map((x) => x.textContent), pick: !!S2.$("#cpAsk [data-cp-me]") }));
  A("the staffer's own request shows with Accept and Decline, theirs alone (no Viewing as)", r.role === "staff" && r.rows.length === 1 && /game 3, 10:10/.test(r.rows[0]) && r.btns.join() === "Accept,Decline" && !r.pick, r);
  await p.click('#cpAsk [data-cp="accept"]'); await settled(p);
  c = calls(ctx, "market_pool_answer");
  A("...and Accept calls market_pool_answer with their request", c.length === 1 && c[0].args.p_request === uuid(430) && c[0].args.p_accept === true, c);
  await ctx.close();
  staffWorld();
  ({ ctx, p } = await open("staff", "#/you?tab=inbox"));
  await p.waitForFunction(() => S2.$("#cpAsk") && !S2.$("#cpAsk").hidden, null, { timeout: 5000 }).catch(() => null);
  r = await p.evaluate(() => ({ btns: S2.$$("#cpAsk button").map((x) => x.textContent) }));
  A("the staffer's Inbox carries the same card", r.btns.join() === "Accept,Decline", r);
  await p.click('#cpAsk [data-cp="decline"]'); await settled(p);
  c = calls(ctx, "market_pool_answer");
  A("...and Decline there calls market_pool_answer false", c.length === 1 && c[0].args.p_request === uuid(430) && c[0].args.p_accept === false, c);
  await ctx.close();
  W = X.reset();
  ({ ctx, p } = await open("gm", "#/camp"));
  r = await p.evaluate(() => ({ card: !!S2.$("#cpAsk.cp-ask") }));
  A("a GM with no request and not in the pool gets no requests card", !r.card, r);
  await ctx.close();


  console.log("## the price ladder is the season's own (season_rules mk), never a figure written in the page");
  W = X.reset(); W.rules = Object.assign({}, X.MK, { bid_open: 1000000, bid_step: 500000 });
  ({ ctx, p } = await open("gm", "#/bidding"));
  r = await p.evaluate(() => ({ lots: S2.$$("#bdLots .bd-lot").map((x) => x.dataset.state + ":" + (x.querySelector("[data-bd-bid]") ? x.querySelector("[data-bd-bid]").textContent : "-")),
    ladder: S2.$("#bdLadder").textContent, facts: S2.$$("#bdFacts div").slice(1, 3).map((x) => x.textContent), K: [S2.market.MIN, S2.market.STEP] }));
  A("a season whose rules open at $1M and step by $500K: the lots offer Open at $1M and Raise to $1.50M (one definition of the price ladder)",
    r.lots.join("|") === "open:Open at $1M|running:Raise to $1.50M|sold:-" && r.K.join() === "1000000,500000", r);
  A("...and the room says the same ladder in words", /bids open at \$1M and every raise is exactly \$500K more/.test(r.ladder) && r.facts.join("|") === "First bid$1M, from any club|Each raiseExactly $500K more than the last bid", r);
  await ctx.close();
  W = X.reset(); W.rules = null;
  ({ ctx, p } = await X.open(b, "gm", "#/bidding", { quiet: /the market could not be read/ }));
  r = await p.evaluate(() => ({ st: S2.market.status(), head: S2.$(".bd-head").textContent, bids: S2.$$("[data-bd-bid]").length }));
  A("a season with a market and no price ladder is an error said on the page, never a guessed price", /market rules/.test(r.st.error || "") && r.head === "The bid room could not be read" && r.bids === 0, r);
  await ctx.close();

  console.log("## a later read that fails: the room says so and keeps what it showed (review wf_74093353-9c3)");
  W = X.reset();
  ({ ctx, p } = await X.open(b, "gm", "#/bidding", { quiet: /the market could not be read|Failed to load resource/ }));
  await p.evaluate(() => { window.__room = S2.$("#bdRoom"); });
  mock.respond(ctx, "table:market_lots", mock.fail("57014", "canceling statement due to statement timeout"));
  await p.evaluate(() => S2.live.emit("market", {})); await p.waitForTimeout(800);
  r = await p.evaluate(() => ({ stale: (S2.$("#bdNow .bd-stale") || {}).textContent || null, role: S2.$("#bdNow .bd-stale") && S2.$("#bdNow .bd-stale").getAttribute("role"), lots: S2.$$("#bdLots .bd-lot").length, same: S2.$("#bdRoom") === window.__room }));
  A("the band says the last read failed, in the league's words, and the lots it showed stay", /did not answer the last read \(canceling statement due to statement timeout\)/.test(r.stale || "") && r.role === "alert" && r.lots === 3 && r.same, r);
  mock.respond(ctx, "table:market_lots", X.tables("gm").market_lots);
  await p.evaluate(() => S2.live.emit("market", {})); await p.waitForTimeout(800);
  r = await p.evaluate(() => ({ stale: !!S2.$("#bdNow .bd-stale"), st: S2.market.status().error }));
  A("...and the next read that lands takes the notice away", !r.stale && r.st === null, r);
  await ctx.close();

  console.log("## a raise heard through Realtime: the room reads itself again and swaps only the lot that moved");
  W = X.reset();
  ({ ctx, p } = await open("gm", "#/bidding"));
  await p.evaluate(() => { window.__l = S2.$$("#bdLots .bd-lot"); });
  const lotsBefore = X.reads.filter((x) => /^market_lots\?/.test(x)).length, calBefore = X.reads.filter((x) => x === "market_calendar").length;
  const l2 = W.lots[1]; l2.price = 1250000; l2.bids = 3; l2.last_bid_at = iso(Date.now()); l2.ends_at = iso(Date.now() + 300e3);
  W.bids.push(X.bid(592, l2.id, CC, 3, 1250000, Date.now()));
  const reached = mock.push(ctx, "market_lots", "UPDATE", l2);
  await p.waitForFunction(() => /\$1\.50M/.test((S2.$$("#bdLots .bd-lot")[1].querySelector("[data-bd-bid]") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => null);
  r = await p.evaluate(() => { const now = S2.$$("#bdLots .bd-lot"); return { btn: now[1].querySelector("[data-bd-bid]").textContent, st: now[1].querySelector(".bd-lot-st").textContent, mine: now[1].classList.contains("is-mine"),
    keep0: now[0] === window.__l[0], keep2: now[2] === window.__l[2], swapped: now[1] !== window.__l[1] }; });
  A("the market-room channel hears the change (Realtime on market_lots)", reached > 0, reached);
  A("the raised lot reads the new price, its bidder hidden and the club no longer leading", r.btn === "Raise to $1.50M" && /Bidder hidden · 3 bids/.test(r.st) && !r.mine, r);
  A("...only that lot was swapped: the other two cards (and any button under a finger) are the same nodes", r.swapped && r.keep0 && r.keep2, r);
  A("...and only the room was read again, not the calendar, the pool or the waivers", X.reads.filter((x) => /^market_lots\?/.test(x)).length > lotsBefore && X.reads.filter((x) => x === "market_calendar").length === calBefore);
  await ctx.close();

  console.log("## the Control Center's Bids step reads the market itself");
  W = X.reset();
  ({ ctx, p } = await open("commissioner", "#/camp"));
  r = await p.evaluate(() => { const el = document.createElement("div"); el.innerHTML = S2.bidding.ccBids(); return el.textContent.replace(/\s+/g, " ").trim(); });
  A("the step names tonight's lots with bids, the running one with its bidder hidden", /Running · bidder hidden · 2 bids/.test(r) && /Sold to /.test(r), r.length);
  await ctx.close();

  /* review 2026-11-25: ensure() read again whenever no read had landed, and a failed read repaints the pages that ask on
     every repaint (the Control Center's step 7, the Inbox's requests card), so a failing first read looped for as long
     as the page stayed open. The market fails here as a statement timeout; a read the market makes once is counted */
  console.log("## a first read that fails is not read again in a loop: the Control Center's step 7 and a pool member's Inbox");
  const failPool = { market_pool: () => { X.reads.push("market_pool"); return mock.fail("57014", "canceling statement due to statement timeout"); } };
  const poolReads = () => X.reads.filter((x) => x === "market_pool").length;
  W = X.reset();
  ({ ctx, p } = await X.open(b, "commissioner", "#/control?tab=setup", { wait: false, rpcs: failPool, quiet: /the market could not be read|Failed to load resource/ }));
  await p.waitForSelector('[data-cc-step="7"]');
  let k0 = poolReads();
  await p.click('[data-cc-step="7"]');
  await p.waitForFunction(() => /could not be read/.test((S2.$('[data-w="ccbids"]') || {}).textContent || ""), null, { timeout: 5000 }).catch(() => null);
  await p.waitForTimeout(2000);
  r = await p.evaluate(() => ({ say: (S2.$('[data-w="ccbids"]') || {}).textContent || null, loads: window.__loads }));
  let k1 = poolReads() - k0;
  A("step 7 says the failed read and to reload", /The bids could not be read \(canceling statement due to statement timeout\)\. Reload the page to try again\./.test(r.say || ""), r);
  A("...and reads the market once, not again on each repaint the failure causes (two seconds open)", k1 === 1 && r.loads <= 1, { reads: k1, loads: r.loads });
  k0 = poolReads();
  await p.evaluate(() => S2.live.emit("market", {})); await p.waitForTimeout(1200);
  A("...the pulse reads it again once after a failure (the retry the page relies on)", poolReads() - k0 === 1, poolReads() - k0);
  await ctx.close();
  W = X.reset();
  const nb = poolReads();
  ({ ctx, p } = await X.open(b, "member", "#/you?tab=inbox", { wait: false, rpcs: failPool, quiet: /the market could not be read|Failed to load resource/ }));
  await p.waitForFunction(() => S2.market.status().error, null, { timeout: 5000 }).catch(() => null);
  k0 = poolReads(); const l0 = await p.evaluate(() => window.__loads); await p.waitForTimeout(2000);
  r = await p.evaluate(() => ({ err: S2.market.status().error, host: !!S2.$("#cpAsk"), loads: window.__loads }));
  A("a pool member's Inbox after a failed first read: one read, none more in two seconds, the card's host kept", k0 - nb === 1 && /statement timeout/.test(r.err || "") && poolReads() - k0 === 0 && r.host && r.loads === l0, Object.assign(r, { first: k0 - nb, more: poolReads() - k0 }));
  await ctx.close();

  console.log("## a voided waiver says what happened, in plain words (review wf_74093353-9c3)");
  W = X.reset();
  W.wire.push({ id: uuid(703), season_id: X.S, profile_id: S1, from_team_id: ID(CC), position: X.posOf(S1), salary: 750000, waived_at: iso(NOW - 30 * 3600e3), expires_at: iso(NOW - 6 * 3600e3), status: "void", claimed_team_id: null, claimed_at: null, cleared_at: iso(NOW - 20 * 3600e3) });
  W.wire.push({ id: uuid(704), season_id: X.S, profile_id: F1, from_team_id: ID(CC), position: X.posOf(F1), salary: 750000, waived_at: iso(NOW - 28 * 3600e3), expires_at: iso(NOW - 4 * 3600e3), status: "void", claimed_team_id: null, claimed_at: null, cleared_at: iso(NOW - 26 * 3600e3) });
  W.spots.push(X.spot(950, CD, F1));
  ({ ctx, p } = await open("anon", "#/camp"));
  r = await p.evaluate((a) => ({ gone: (S2.$('#cpWv .cp-past[data-row="' + a.S1 + '"] .cp-from') || {}).textContent || null, placed: (S2.$('#cpWv .cp-past[data-row="' + a.F1 + '"] .cp-from') || {}).textContent || null,
    team: S2.M.team(a.CD).full }), { S1, F1, CD });
  A("a waiver voided for a player no longer signed up says so, and that no club could claim them", r.gone === "Waiver ended early: they are no longer signed up for the season, so no club could claim them and they did not join the pool", r);
  A("a waiver voided by a placement names the club that has them now", r.placed === "Waiver ended early: they were placed with the " + r.team + ", so no club could claim them", r);
  A("...and never the office's reason (market_waivers.void_why is not read)", !X.reads.some((x) => /^market_waivers\?/.test(x) && /void_why/.test(x)));
  await ctx.close();

  const mine = errs.filter((e) => !/Failed to load resource/.test(e));
  A("no console or page errors on the real market", mine.length === 0, mine.slice(0, 5));
}
