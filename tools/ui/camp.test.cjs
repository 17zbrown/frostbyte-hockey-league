const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The training camp pool page, #/camp, on the REAL site, driven through its UI in headless Chromium:
   node tools/ui/run.cjs --suite camp --mode live   (any mode works: every context opts into the real site itself)
   The commissioner, 2026-11-02: "2. I would like that" (a training camp pool board) and "Only training camp players with
   at least 6 games played can be bid on at the saturday bidding events. Rostered players can be sent down to the league
   training camps only after being placed on waivers. Any team can pick up a player placed on waivers up to 24 hours after
   they have been waived, like real life." The database holds the rules (sql v4.58 and v4.59); this proves the page says
   them and its doors work: the hero, the sections, the request sheet of the club's own games, the requests a club made
   and the one a player accepted, who sees which club before and after the lock, the player's own answers, the waivers
   with their claim door and the database's refusals said in place, a voided or cleared waiver, the bid board door,
   filters and sort, the hero after the last bid night and after the movement deadline, a visitor's door, the phone
   layout, and the copy rules.
   v5.00 swap (i3e, 2026-11-25): the page runs on the league's market (tools/ui/market-world.cjs over tools/ui/mock's
   live mode; nothing reaches production). Deleted with the demo (each pinned only demo behavior): the sample clock bar
   and its skips (to tonight, past puck drop, +24 hours), the demo's game accounting after a night (games now come from
   box scores, market_pool), the Discord previews (the request DM, the #transactions cards and their example heading),
   Claim, Request and Accept anyway (demo), the Player role standing in for a pool player and its bell dot, the demo
   engine's dropped-request notice, the commissioner's availability control, and View as on the visitor's role lock. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)) + ")")); if (!cond) fails++; };

(async () => {
  const b = await chromium.launch();
  const X = require("./market-world.cjs")(mock);
  const { MINE, CA, CB, CC, CD, L1, L2, S1, S2P, W1, W2, F1, MEMBER, BK, uuid, calls, settled, pulse, iso } = X;
  const open = (persona, o) => X.open(b, persona, (o && o.hash) || "#/camp", o);
  const city = (p, code) => p.evaluate((c) => S2.M.team(c).city, code);
  const fullName = (p, code) => p.evaluate((c) => S2.M.team(c).full, code);
  const text = (p, sel) => X.txt(p, sel);

  console.log("## the page");
  let W = X.reset(); X.before();
  let { ctx, p } = await open("gm");
  const mineCity = await city(p, MINE);
  let r = await p.evaluate(() => {
    const K = S2.market, pool = K.pool(), el = pool.filter((x) => x.eligible).length, nb = K.nextBidNight();
    const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
    return { n: pool.length, el, nb: nb && [nb.label, nb.short], h1: t("#cpHeroIn h1"), lede: t("#cpHeroIn .lede-l"), side: t("#cpHeroSide"), wv: t("#cpWvH"), tn: t("#cpTnH"), road: t("#cpRoadH"), pool: t("#cpPoolH"),
      short: pool.filter((x) => !x.eligible).length, clock: !!document.querySelector("#cpClock, .mk-clock"), about: document.querySelectorAll("#cpRoot details.about").length,
      rules: ["S2.4", "S2.5", "S2.6"].filter((x) => document.querySelector('#cpRoot a[href="#/rulebook?rule=' + x + '"]')),
      bidroom: !!document.querySelector('#cpRoot a[href="#/bidding"]'), board: !!document.querySelector('#cpRoot a[href="#/hq?tab=bidding"]'),
      title: document.title, here: !!document.querySelector('#navT-season[aria-current="true"]'), mode: document.documentElement.dataset.mode,
      inactive: !!document.querySelector('#cpRoot [data-flow="case"][data-type="complaint"]'), cards: document.querySelectorAll("#cpRoot .dc").length, samples: document.querySelectorAll("#cpRoot .chip.sample").length,
      you: t("#cpTn .cp-you"), words: document.getElementById("cpRoot").innerText };
  });
  A("the hero states the pool and how many can be bid on Saturday, from the league's market", r.h1 === r.n + " players, " + r.el + " ready for Saturday", r.h1);
  A("the hero names the next bid night and counts down to it", r.lede.indexOf("next on " + r.nb[0] + " from 9:00 PM ET") >= 0 && r.side.indexOf("until Saturday bidding opens, " + r.nb[1] + ", 9:00 PM ET") >= 0 && /\d h \d+ min/.test(r.side), [r.lede.length, r.side]);
  A("sections: On waivers, Tonight, Road to six, The whole pool", r.wv === "Two players on waivers" && /^Requests are open for /.test(r.tn) && r.road === r.short + " players short of six" && (/ tops the pool at \d+$/.test(r.pool) || r.pool === r.n + " players in the pool"), [r.wv, r.tn, r.road]);
  A("Rules S2.4, S2.5 and S2.6 link to the rulebook; the bid room and the bid board are one tap away", r.rules.join() === "S2.4,S2.5,S2.6" && r.bidroom && r.board, r.rules);
  A("no sample clock, no sample chip, no Discord preview, and one About this data", !r.clock && r.samples === 0 && r.cards === 0 && r.about === 1, r);
  A("a public website page under the Season menu", /^Training camp/.test(r.title) && r.here && r.mode === "site", [r.title, r.here, r.mode]);
  A("an inactive player is reported to the league office, never waived (the case door)", r.inactive);
  A("the club line says what the club has asked for tonight", r.you === mineCity + " has no camp player yet; 1 request waits for an answer.", r.you);
  A("copy: no em dash, no spaced hyphen, never the word the brief bans, no concept or sample wording", !/—| - /.test(r.words) && !/abandon/i.test(r.words) && !/concept|sample|\(demo\)|stand in/i.test(r.words));   /* escaped, so this file never spells either out */
  await ctx.close();

  console.log("## per-game requests: the club's own games, the request it made and the one a player accepted");
  W = X.reset(); W.reqs.push(X.req(405, 0, MINE, S2P, "accepted", Date.now() - 400e3));
  ({ ctx, p } = await open("gm"));
  const cityA = await city(p, CA), cityB = await city(p, CB), cityC = await city(p, CC), myCity = await city(p, MINE);
  await p.click('#cpTn [data-cp="games"][data-pid="' + L1 + '"]'); await p.waitForSelector(".cp-gsheet");
  r = await p.evaluate(() => [...document.querySelectorAll(".sheet .cp-game .title")].map((x) => x.textContent));
  A("Request opens the club's own games tonight from the schedule, with their opponents, one request each",
    JSON.stringify(r) === JSON.stringify(["Game 1 · 9:00 PM vs " + cityA, "Game 2 · 9:35 PM vs " + cityB, "Game 3 · 10:10 PM vs " + cityC]), r);
  await p.click('.sheet [data-cg="request"][data-game="1"]'); await settled(p);
  r = await p.evaluate(() => ({ line: document.querySelector('.sheet .cp-game[data-game="1"] .sub').textContent, wd: !!document.querySelector('.sheet [data-cg="release"][data-game="1"]') }));
  let c = calls(ctx, "market_pool_request");
  A("asking for game 1 sends market_pool_request and, once the database has it, the sheet says it waits for the player, with Withdraw",
    c.length === 1 && c[0].args.p_game === X.G.g1 && c[0].args.p_profile === L1 && r.line === "Waiting for their answer" && r.wd, [c.length, r]);
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  r = await p.evaluate((pid) => ({ row: document.querySelector('#cpTn li[data-row="' + pid + '"]').textContent.replace(/\s+/g, " "), btn: (document.querySelector('#cpTn [data-cp="games"][data-pid="' + pid + '"]') || {}).textContent,
    you: document.querySelector("#cpTn .cp-you").textContent }), L1);
  const s2pTag = await p.evaluate((id) => S2.M.player(id).tag, S2P);
  A("the row says the game asked for is waiting and the door reads Requests", /Asked for game 1, waiting for an answer/.test(r.row) && r.btn === "Requests", r.row.length);
  A("the club line names the camp player who accepted, the game, the count against three, and the requests that wait",
    r.you === myCity + " has " + s2pTag + " for game 1 (1 of 3 camp players for the night); 2 requests wait for an answer.", r.you.length);
  r = await p.evaluate((pid) => document.querySelector('#cpTn li[data-row="' + pid + '"]').textContent.replace(/\s+/g, " "), S2P);
  A("the accepted player's row names the game and the club", r.indexOf("Accepted game 1, " + myCity) >= 0, r.length);
  r = await p.evaluate((pid) => document.querySelector('#cpRoad li[data-row="' + pid + '"] .cp-road-n').textContent, S2P);
  A("Road to six shows what the accepted game will add once the night ends", r === "Filling in for " + myCity + " tonight: 2 of 6 after it", r);
  /* management withdraws a request before it is accepted; focus stays on that game */
  await p.click('#cpTn [data-cp="games"][data-pid="' + L2 + '"]'); await p.waitForSelector(".cp-gsheet");
  await p.click('.sheet [data-cg="request"][data-game="2"]'); await settled(p);
  await p.click('.sheet [data-cg="release"][data-game="2"]'); await settled(p);
  r = await p.evaluate(() => ({ line: document.querySelector('.sheet .cp-game[data-game="2"] .sub').textContent, focus: document.activeElement && document.activeElement.closest(".cp-game") && document.activeElement.closest(".cp-game").dataset.game }));
  A("Withdraw takes back a request not yet accepted (market_pool_withdraw), in place, focus kept on that game", r.line === "Withdrawn" && r.focus === "2" && calls(ctx, "market_pool_withdraw").length === 1, r);
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  /* a request the database closed (the player left the pool, signed at Saturday bidding): the sheet says why */
  W.reqs.push(X.req(406, 2, MINE, L2, "closed", Date.now() - 300e3, { note: "They signed with another club at Saturday bidding." }));
  await pulse(p);
  await p.click('#cpTn [data-cp="games"][data-pid="' + L2 + '"]'); await p.waitForSelector(".cp-gsheet");
  r = await p.evaluate(() => document.querySelector('.sheet .cp-game[data-game="3"] .sub').textContent);
  A("a request the database closed says why, in the database's words", r === "Closed: They signed with another club at Saturday bidding.", r);
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await ctx.close();

  console.log("## the camp player answers their own requests");
  W = X.reset(); W.reqs.push(X.req(407, 1, CB, MEMBER, "pending", Date.now() - 200e3));
  ({ ctx, p } = await open("member"));
  const fullMine = await fullName(p, MINE), fullB = await fullName(p, CB);
  r = await p.evaluate(() => ({ card: (document.getElementById("cpAsk") || {}).textContent || "", acc: document.querySelectorAll('#cpAsk [data-cp="accept"]').length, doors: document.querySelectorAll('#cpRoot [data-cp="games"], #cpRoot [data-cp="claim"], #cpRoot [data-cp="board"]').length }));
  /* a game is numbered in its club's own night: the second club plays once tonight, so its game is its game 1 */
  A("the pool player sees each club's game with Accept and Decline, and no club doors", /Requests for you/.test(r.card) && r.card.indexOf(fullMine + " · game 1, 9:00 PM") >= 0 && r.card.indexOf(fullB + " · game 1, 9:35 PM") >= 0 && r.acc === 2 && r.doors === 0, r.acc);
  await p.click('#cpAsk [data-cp="accept"][data-club="' + CB + '"]'); await settled(p);
  r = await p.evaluate(() => S2.$$("#cpAsk .cp-ask-r").map((x) => x.querySelector(".sub").textContent));
  c = calls(ctx, "market_pool_answer");
  A("Accept answers that club's game (market_pool_answer), and the card repaints from the database", c.length === 1 && c[0].args.p_request === uuid(407) && c[0].args.p_accept === true && r.indexOf("Accepted: the lobby code reaches you by bot DM for this game") >= 0, r);
  await p.click('#cpAsk [data-cp="decline"][data-club="' + MINE + '"]'); await settled(p);
  r = await p.evaluate(() => S2.$$("#cpAsk .cp-ask-r .sub").map((x) => x.textContent));
  A("Decline answers the other club's game", r.indexOf("You declined") >= 0 && calls(ctx, "market_pool_answer")[1].args.p_accept === false, r);
  await ctx.close();

  console.log("## who sees which club: the club and the staff until the lineup lock, everyone after (2026-11-23)");
  W = X.reset();
  ({ ctx, p } = await open("commissioner"));
  const s1row = () => p.evaluate((pid) => { const li = document.querySelector('#cpTn li[data-row="' + pid + '"]'); return li ? { row: li.textContent.replace(/\s+/g, " "), door: !!li.querySelector("[data-cp]") } : null; }, S1);
  r = await s1row();
  A("a commissioner (staff) sees another club's acceptance before the lock, and has no club door until they act for a club", r && new RegExp("Accepted game \\d, " + cityA).test(r.row) && !r.door, r && r.door);
  await ctx.close();
  W = X.reset();
  ({ ctx, p } = await open("gm"));
  r = await s1row();
  A("a club's front office does not see another club's request before the lock (RLS); the player reads as one it may ask", r && /Available/.test(r.row) && r.row.indexOf(cityA) < 0, r && r.row.length);
  await ctx.close();
  W = X.reset(); W.locked = true;
  ({ ctx, p } = await open("gm"));
  r = Object.assign(await s1row() || {}, await p.evaluate(() => ({ doors: document.querySelectorAll('#cpTn [data-cp="games"]').length, h: document.getElementById("cpTnH").textContent, you: !!document.querySelector("#cpTn .cp-you") })));
  A("after the lineup lock the acceptance is public, requests are closed, and no request door is offered", new RegExp("Accepted game \\d, " + cityA).test(r.row || "") && r.doors === 0 && r.h === "Requests closed when lineups locked" && !r.you, r.h);
  await ctx.close();
  W = X.reset();
  ({ ctx, p } = await open("member"));
  r = await p.evaluate(() => document.querySelector(".cp-how").textContent);
  A("How the pool works says per game, first acceptance, one club a night, three and three, the withdrawals, the lapse, the permission slip", /A club requests them for one of its games, and they accept or decline each game on the site: the first acceptance wins, a camp player plays for one club a night/.test(r) &&
    /up to three different camp players a night and three in any one game/.test(r) && /Until the lock a club may withdraw a request or release a player who accepted, and the player may withdraw an acceptance; an unanswered request lapses at the lock/.test(r) &&
    /one-game permission slip, with no roster spot, contract or cap figure/.test(r) && !/marks themselves available/.test(r), r.length);
  A("and says who sees a request, and that #free-agency is private to staff, management and the pool, where only a site request counts", /until then only the requesting club and the staff see who asked, and after it everyone does/.test(r) && /#free-agency, is private to league staff, club management and the pool: management may ask there who can fill in, but only a request on the site counts/.test(r) && /one automatic post at the movement deadline\./.test(r) && !/proposed/.test(r), r.length);
  A("and the bid ladder in the season's own figures", /Bids open at \$750K and rise by exactly \$250K/.test(r), r.length);
  await ctx.close();

  console.log("## waivers: the claim door, the database's refusals in place, the waiving club, a claim, the 24 hours run out");
  W = X.reset();
  ({ ctx, p } = await open("gm"));
  r = await p.evaluate((pid) => ({ h: document.getElementById("cpWvH").textContent, row: document.querySelector('#cpWv li[data-row="' + pid + '"]').textContent.replace(/\s+/g, " "),
    btn: (document.querySelector('#cpWv [data-cp="claim"][data-pid="' + pid + '"]') || {}).textContent, lede: document.querySelector("#cpHeroIn .lede-l").textContent, until: S2.M.etDateTime(new Date(S2.market.waiver(pid).until).toISOString()) }), W1);
  A("a waived player shows with the club that waived them, the salary and the time left of the 24 hours", r.h === "Two players on waivers" && r.row.indexOf("Waived by " + cityA) >= 0 && /(19 h 59|20 h 0) min left/.test(r.row) && r.row.indexOf("Claims close " + r.until) >= 0, r.h);
  A("the Claim door names the salary; the hero counts the waivers", r.btn === "Claim at $1M" && /Two players are on waivers\./.test(r.lede), r.btn);
  r = await p.evaluate((pid) => ({ btn: !!document.querySelector('#cpWv [data-cp="claim"][data-pid="' + pid + '"]'), note: (document.querySelector('#cpWv li[data-row="' + pid + '"] .cp-note') || {}).textContent }), W2);
  A("the club that waived a player is offered no Claim, and says it placed them", !r.btn && r.note === "Your club placed them", r);
  mock.respond(ctx, "market_claim", mock.fail("23514", "Your club's active roster has no open spot: 12 of 12 active (Rule S2.4).", "no_spot"));
  await p.click('#cpWv [data-cp="claim"][data-pid="' + W1 + '"]'); await settled(p);
  r = await p.evaluate((pid) => ({ say: (document.querySelector('#cpWv li[data-row="' + pid + '"] .cp-say') || {}).textContent, sheet: !!document.querySelector(".sheet"), btn: !!document.querySelector('#cpWv [data-cp="claim"][data-pid="' + pid + '"]') }), W1);
  A("a claim the database refuses (no open spot) is said under the row in its words, with no override sheet, the door still there", /no open spot: 12 of 12 active \(Rule S2\.4\)/.test(r.say || "") && !r.sheet && r.btn, r);
  mock.respond(ctx, "market_claim", mock.fail("23514", "The " + "other club claimed that player first. The first claim wins (Rule S2.5).", "claimed"));
  await p.click('#cpWv [data-cp="claim"][data-pid="' + W1 + '"]'); await settled(p);
  r = await p.evaluate((pid) => (document.querySelector('#cpWv li[data-row="' + pid + '"] .cp-say') || {}).textContent, W1);
  A("the first claim wins: a later claim is the database's refusal, said in place", /claimed that player first\. The first claim wins/.test(r || ""), r);
  mock.respond(ctx, "market_claim", X.writes().market_claim);
  await p.click('#cpWv [data-cp="claim"][data-pid="' + W1 + '"]'); await settled(p);
  r = await p.evaluate(() => ({ h: document.getElementById("cpWvH").textContent, past: [].map.call(document.querySelectorAll("#cpWv .cp-past"), (e) => e.textContent.replace(/\s+/g, " ")).join(" | "),
    toast: S2.$$(".toast").some((x) => /claimed .* off waivers/.test(x.textContent)) }));
  A("a claim the database takes: the waiver leaves the list and Earlier waivers says who claimed them", r.h === "One player on waivers" && r.past.indexOf("Claimed by " + myCity) >= 0 && r.toast, r.h);
  /* the 24 hours run out with no claim: the waiver clears and the player joins the pool, off waivers */
  const w2 = W.wire.find((x) => x.profile_id === W2); Object.assign(w2, { status: "cleared", cleared_at: iso(Date.now()), expires_at: iso(Date.now() - 1000) });
  W.pool.push({ profile_id: W2, position: X.posOf(W2), pos_group: X.grp(X.posOf(W2)), gp: 4, needs: 2, eligible: false, suspended: false, source: "waivers", last_team_id: X.ID(MINE), available_next: null });
  await pulse(p);
  if (await p.$('#cpPoolList [data-cp="more"][aria-expanded="false"]')) await p.click('#cpPoolList [data-cp="more"]');
  r = await p.evaluate((pid) => ({ h: document.getElementById("cpWvH").textContent, past: (document.querySelector('#cpWv .cp-past[data-row="' + pid + '"]') || {}).textContent || "", tr: (document.querySelector('#cpPoolList tr[data-row="' + pid + '"]') || {}).textContent || "" }), W2);
  A("when the 24 hours run out the player leaves waivers and joins the pool, listed off waivers", r.h === "Nobody is on waivers" && /Joined the pool, /.test(r.past) && r.tr.indexOf(MINE + ", off waivers") >= 0, r.h);
  await ctx.close();

  console.log("## the whole pool: bid board door, filters, sort");
  W = X.reset(); X.crowd(14);
  ({ ctx, p } = await open("gm"));
  await p.evaluate(() => { window.__root = document.getElementById("cpRoot"); });
  await p.focus('#cpPoolList [data-cp="board"][data-pid="' + L2 + '"]');
  await p.click('#cpPoolList [data-cp="board"][data-pid="' + L2 + '"]'); await settled(p);
  r = await p.evaluate((pid) => { const a = document.querySelector('#cpPoolList tr[data-row="' + pid + '"] a.cp-onb');
    return { link: a && a.getAttribute("href"), txt: a && a.textContent.trim(), toast: (document.querySelector(".toast-root .toast a.cp-toast-a") || { getAttribute: () => null }).getAttribute("href"), focus: document.activeElement && document.activeElement.dataset.k }; }, L2);
  c = calls(ctx, "save_market_board");
  A("Add to bid board saves the board (save_market_board) and the row links to it as On board #2, after the target already there",
    c.length === 1 && c[0].args.p_rows.map((x) => x.profile_id).join() === [L1, L2].join() && r.link === "#/hq?tab=bidding" && r.txt === "On board #2", r);
  A("the toast links to the Bidding tab in Team HQ, and focus stays on the row", r.toast === "#/hq?tab=bidding" && r.focus === "pl:" + L2, r);
  await p.click('#cpUnit button[data-v="F"]');
  await p.click('#cpElig button[data-v="yes"]');
  r = await p.evaluate(() => ({ pos: [].map.call(document.querySelectorAll("#cpPoolList tbody tr"), (tr) => S2.market.poolPlayer(tr.dataset.row)).map((x) => x.unit + (x.eligible ? "+" : "-")),
    hash: location.hash, want: S2.market.pool().filter((x) => x.unit === "F" && x.eligible).length, same: document.getElementById("cpRoot") === window.__root }));
  A("filters: forwards with six or more only, and the address says so, the page not re-rendered", r.want > 0 && r.pos.length === Math.min(r.want, 30) && r.pos.every((x) => x === "F+") && r.hash === "#/camp?pos=F&elig=yes" && r.same, r);
  await p.click('#cpUnit button[data-v="all"]'); await p.click('#cpElig button[data-v="all"]');
  await p.click('#cpPoolList [data-cp="sort"][data-key="gp"]');
  r = await p.evaluate(() => ({ gp: [].map.call(document.querySelectorAll("#cpPoolList tbody tr"), (tr) => S2.market.poolPlayer(tr.dataset.row).gp), sort: document.querySelector('#cpPoolList th[aria-sort]').textContent + " " + document.querySelector('#cpPoolList th[aria-sort]').getAttribute("aria-sort") }));
  A("sort by games, most first, marked with aria-sort", r.gp.length > 10 && r.gp.every((g, i) => !i || r.gp[i - 1] >= g) && /^GP/.test(r.sort) && /descending$/.test(r.sort), r.sort);
  await p.click('#cpPoolList [data-cp="sort"][data-key="gp"]');
  r = await p.evaluate(() => [].map.call(document.querySelectorAll("#cpPoolList tbody tr"), (tr) => S2.market.poolPlayer(tr.dataset.row).gp));
  A("a second tap turns it to fewest first", r.every((g, i) => !i || r[i - 1] <= g));
  await ctx.close();

  console.log("## the hero after the last bid night: before and after the movement deadline");
  const heldCal = (deadline) => ({ season_id: X.S, market: true, deadline: iso(deadline), moves_locked: Date.now() > deadline, draft_done: true,
    game_nights: [], bid_nights: [{ night: BK, skipped: false, why: null, opens_at: iso(Date.now() - 3 * 86400e3), new_until: iso(Date.now() - 3 * 86400e3 + 3600e3), id: null, state: "missed", paused: false }], next_bid_night: null });
  W = X.reset(); W.nights = []; W.lots = []; W.bids = []; W.calendar = heldCal(Date.now() + 2 * 86400e3);
  ({ ctx, p } = await open("gm"));
  r = await p.evaluate(() => ({ lede: document.querySelector("#cpHeroIn .lede-l").textContent, nb: S2.market.nextBidNight(), label: S2.market.bidNights()[0].label, dl: S2.M.etLong(new Date(S2.market.deadline).toISOString()) }));
  /* review 2026-11-02: between the last bid night and the movement deadline the hero said bidding "ended at the movement
     deadline" while waivers and claims still ran */
  A("between the last bid night and the movement deadline, the hero names both and never says the deadline passed",
    !r.nb && r.lede.indexOf("The last bid night was " + r.label + ". No Saturday bidding is left before the movement deadline, " + r.dl + ".") >= 0 && !/ended at the movement deadline/.test(r.lede), r.lede.length);
  await ctx.close();
  W = X.reset(); W.nights = []; W.lots = []; W.bids = []; W.calendar = heldCal(Date.now() - 86400e3);
  ({ ctx, p } = await open("gm"));
  r = await p.evaluate(() => document.querySelector("#cpHeroIn .lede-l").textContent);
  A("after the movement deadline, the hero says bidding ended at it", /Bidding ended at the movement deadline/.test(r) && !/No Saturday bidding is left/.test(r), r.length);
  await ctx.close();

  /* QA 2026-11-25 (phone, worst case and function lenses): no night tonight and none ahead read as the end of the season,
     also before the schedule existed. Over only once the season's regular nights exist and every one has passed */
  console.log("## Game nights: not scheduled yet is never over; over once every regular night has passed");
  const pastDay = new Date(Date.now() - 5 * 86400e3).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const tnHead = (pp) => pp.evaluate(() => ({ h: document.querySelector("#cpTnH").textContent, p: document.querySelector("#cpTn .sec-head p").textContent, shown: !document.querySelector("#cpTn").hidden }));
  W = X.reset(); W.nights = []; W.lots = []; W.bids = []; W.reqs = []; W.calendar = Object.assign({}, X.EMPTY_CAL, { draft_done: true });
  ({ ctx, p } = await open("anon"));
  r = await tnHead(p);
  A("after the draft with no schedule yet, Game nights says there are none yet and why, never that the season is over",
    r.shown && r.h === "No game nights yet" && /^The game nights follow the Season 2 schedule, which is not set yet/.test(r.p) && !/over|remain/.test(r.h + r.p), r);
  await ctx.close();
  W = X.reset(); W.nights = []; W.lots = []; W.bids = []; W.reqs = [];
  W.calendar = Object.assign({}, heldCal(Date.now() - 20 * 86400e3), { game_nights: [{ night: pastDay, week: 9, stage: "regular", games: 4, first_puck: iso(Date.now() - 5 * 86400e3), lock_at: iso(Date.now() - 5 * 86400e3 - 1800e3) }] });
  ({ ctx, p } = await open("anon"));
  r = await tnHead(p);
  A("once every regular night of the season has passed, Game nights says the regular season is over (no pool players in the playoffs, Rule S2.7)",
    r.shown && r.h === "The regular season is over" && /Rule S2\.7/.test(r.p), r);
  await ctx.close();
  /* an empty pool after the draft is nobody: never "everyone in the pool has six", never a filter that matched nobody */
  W = X.reset(); W.pool = []; W.wire = []; W.reqs = [];
  ({ ctx, p } = await open("anon"));
  r = await p.evaluate(() => ({ road: document.querySelector("#cpRoadH").textContent, count: document.querySelector("#cpPoolList .cp-count").textContent }));
  A("an empty pool after the draft: Road to six says nobody is in it yet, and the list says so instead of blaming the filters",
    r.road === "Nobody in the pool yet" && r.count === "Nobody is in the pool right now.", r);
  await ctx.close();

  console.log("## a visitor, and the phone");
  W = X.reset();
  ({ ctx, p } = await open("anon"));
  r = await p.evaluate(() => ({ doors: document.querySelectorAll('#cpRoot [data-cp="games"], #cpRoot [data-cp="claim"], #cpRoot [data-cp="board"]').length, ask: !!document.getElementById("cpAsk") }));
  await p.click('#cpRoot [data-cp="office"]'); await p.waitForSelector(".sheet");
  r.sheet = await p.evaluate(() => ({ who: document.querySelector(".sheet .lk-whot").textContent, as: !!document.querySelector('.sheet [data-lk="as"]') }));
  A("a visitor gets no front office doors and no requests card; the hero's door opens the role lock, with no View as on the real site", r.doors === 0 && !r.ask && r.sheet.who === "A club's Owner, GM or AGM" && !r.sheet.as, r);
  /* QA 2026-11-25 (visual lens): the hero's doors were the app's sentence-case pills on a public page whose footer and
     sister pages (Season, Today) wear the website's rectangle (.btn.site, js/core.js S2.footer) */
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  r = await p.evaluate(() => [].map.call(document.querySelectorAll("#cpHeroIn .btn"), (e) => ({ t: e.textContent, site: e.classList.contains("site"), rad: parseFloat(getComputedStyle(e).borderRadius), up: getComputedStyle(e).textTransform })));
  A("the hero's doors are the website's buttons: .btn.site, squared corners, the brand's capitals", r.length === 2 && r.every((x) => x.site && x.rad < 12 && x.up === "uppercase"), r);
  await ctx.close();
  W = X.reset(); X.crowd(30);
  ({ ctx, p } = await open("gm", { width: 375, ctx: { isMobile: true, hasTouch: true } }));
  r = await p.evaluate(() => {
    /* a door's reach is its box or, when larger, an absolutely placed ::after (the kit's .btn.sm pattern) at its used size.
       Review 2026-11-02: gamertags were 27 to 29px tall and the "GP" sort button 28px wide. Rule links inside a sentence
       are inline text links and are not measured */
    const reach = (e) => { const b = e.getBoundingClientRect(), a = getComputedStyle(e, "::after"), abs = a.content !== "none" && a.position === "absolute";
      return { w: Math.max(b.width, abs ? parseFloat(a.width) : 0), h: Math.max(b.height, abs ? parseFloat(a.height) : 0) }; };
    const small = [].filter.call(document.querySelectorAll("#cpRoot button, #cpRoot a.btn, #cpRoot a.cp-onb, #cpRoot a.cp-tag, #cpRoot .cp-how-l a"), (e) => { const s = reach(e); return e.getBoundingClientRect().width && (s.h < 43.5 || s.w < 43.5); })
      .map((e) => Math.round(reach(e).w) + "x" + Math.round(reach(e).h));
    return { coarse: matchMedia("(pointer: coarse)").matches, over: document.documentElement.scrollWidth - window.innerWidth,
      hidden: ["cp-c-pos", "cp-c-club", "cp-c-tn"].every((c) => getComputedStyle(document.querySelector("#cpPoolList th." + c)).display === "none"), small: small.slice(0, 5), n: small.length, tags: document.querySelectorAll("#cpRoot a.cp-tag").length,
      more: [].map.call(document.querySelectorAll("#cpRoot .cp-more"), (e) => e.classList.contains("site") && parseFloat(getComputedStyle(e).borderRadius) < 12) };
  });
  /* QA 2026-11-25: Show all is website furniture, the website's outline button as on the league, draft and profile pages */
  A("Show all wears the website's outline button, never the app's pill", r.more.length > 0 && r.more.every(Boolean), r.more);
  A("at 375px the page never scrolls sideways", r.over <= 0, r.over);
  A("the table drops to player, rating, games and the door on a phone", r.hidden);
  A("on a touch phone every door on the page reaches 44 by 44px, gamertag links and sort buttons included", r.coarse && r.tags > 30 && r.n === 0, r);
  await ctx.close();

  const errs = X.errs.filter((e) => !/Failed to load resource/.test(e));
  A("no console or page errors", errs.length === 0, errs.slice(0, 5));
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
