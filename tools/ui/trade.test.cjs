const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The trade reading and the trade doors, proved on the real site: node tools/ui/run.cjs --suite trade --mode live
   (every context opts in with live: true, so any mode runs it). The page runs as the site build ships it (tools/ui/mock,
   h0's live mode) over the recorded Season 1 (?season=1): its clubs, rosters, lines, ratings and box scores.
   Commissioner, 2026-10-20: "can the trade page itself be more detailed with stats and comparisons, to show the strength
   of the trade per side". The value (S2.trade.tradeValue, the engine moved from js/demo.js into js/pages/tradebuild.js by
   i3c) must equal the live v2.72 formula (src/live/part_live.js CG.tradeValue), worked out here BY HAND: 10 x (headline
   OVR read back to the old scale, 39 - (99 - overall) x 29 / 14, an unrated player at 85) floored at 0, plus production
   (skater P/GP x 40; goaltender (SV% - .880) x 2000 floored at 0, plus 3 a win; split by role games) weighted by
   min(1, games / 5), minus 8 per $1M, floored at 0. The verdict (CG.tradeBalanceCard): Even under 8%, else "Favors" the
   club that receives more, by |A - B| / max(A, B). The formula's inputs (each player's season lines, games, headline
   rating and salary) are the model's on the real site: the raw Oct 19 snapshot the hand once read is not on the page
   any more (i3c, 2026-11-25), and the model's lines are proved against the league read by the stats suites.
   Review 2026-10-20 added: the headline's value words agree with the verdict, one rating in every part, both lines of a
   two-role player, a player off every roster counting 0, a reversed trade, and one rounding of the share.
   Commissioner, 2026-10-20: "Instead of showing stats in percentile, can you just list it like 1st in this category or
   tied for 24th or something?" So the ranks (S2.M.rank) are proved too: worked out again here by a second method from
   M.lines for every line and measure, with a printed table of real cases, and no reading prints a percentile. Ranks from
   different position groups are never set against each other (no bold, the pool sentence) in the trade head to head or
   the profile compare sheet, which also prints every rank in visible words; a tie that runs down to last place draws at
   the middle of its places; and a line's group is the group with the most games summed over its positions.
   The doors (S2.trade.door, js/trade.js): the exact rpc and arguments of every door, Owner approval on every club door
   and on none of the league office's, the Owner move each table door names, the counter's second write and what happens
   when it fails, a refusal passed through with the database's code, hint and words, no write without a club id, and the
   one offer read.
   Deleted with demo mode (i3c), each pinning only the demo engine: a seeded sample offer naming no pool player, a pool
   player refused by S2.demo.propose and a counter refused by S2.demo.counter (the database's guards refuse both), File
   all lineups on the demo sheets (the real one is proved in tools/ui/lineups.test.cjs), the trade notice drawn from the
   demo's transactions (the real one is the database's, through the bell), a demo sample offer id, and the in-page
   stand-in for the client contract. The waived player in a pending offer is now a player off every roster. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (more ? "  (" + more + ")" : "")); if (!cond) fails++; };
const LEAGUE = mock.league({ p_season: 1 }), CITY = {}, TIDS = {};
LEAGUE.teams.forEach((t) => { CITY[t.code] = t.city; TIDS[t.code] = t.id; });
const SID = LEAGUE.seasons.filter((s) => s.number === 1)[0].id;
const QUIET = /Failed to load resource|^S2\.market:/;

/* one player's inputs, as the model holds them (runs in the page) */
function inputs() {
  const M = S2.M, out = {};
  M.players.filter((p) => p.rostered).forEach((p) => {
    const S = p.lines.S, G = p.lines.G, games = {}, head = M.ratings(p.id).filter((r) => r.headline)[0];
    ["S", "G"].forEach((r) => { if (p.lines[r]) M.log(p.id, r).forEach((x) => { games[x.game] = 1; }); });
    out[p.id] = { tag: p.tag, club: p.club, seat: p.seat || null, salary: p.salary || 0, head: head ? head.ovr : null, gp: Object.keys(games).length,
      S: S ? { gp: S.gp || 0, p: S.p || 0 } : null, G: G ? { gp: G.gp || 0, sv: G.sv || 0, sa: G.sa || 0, w: G.w || 0 } : null };
  });
  return out;
}
let roster = {}, line = {}, rostered = [];
function hand(pid) {
  const r = roster[pid], S = line[pid + "|S"], G = line[pid + "|G"];
  const overall = r.head != null ? r.head : 85;
  const sgp = S ? S.gp : 0, gs = G ? G.gp : 0, gp = r.gp;
  const ppg = sgp ? S.p / sgp : 0, svp = G && G.sa ? G.sv / G.sa : null, w = G ? G.w : 0;
  let prod = 0;
  if (gp >= 1) {
    const gProd = gs ? Math.max(0, ((svp || 0) - 0.880) * 2000) + w * 3 : 0, sProd = sgp ? ppg * 40 : 0;
    prod = Math.round(((sProd * sgp + gProd * gs) / Math.max(1, sgp + gs)) * Math.min(1, gp / 5));
  }
  const ovr = Math.round(Math.max(0, 39 - (99 - overall) * 29 / 14) * 10), cap = -Math.round((r.salary / 1e6) * 8);
  return { tag: r.tag, overall, gp, sgp, gs, ovr, prod, cap, value: Math.max(0, Math.round(ovr + prod + cap)) };
}
function verdict(aV, bV, aCode, bCode) {   /* aV: what aCode sends */
  const total = aV + bV, diff = total ? Math.abs(aV - bV) / Math.max(aV, bV, 1) : 0;
  return diff < 0.08 ? { state: "even", favors: null, pct: Math.round(diff * 100) } : { state: "favors", favors: aV > bV ? bCode : aCode, pct: Math.round(diff * 100) };
}
/* the Season 2 cap as production holds it since v4.58 ($30M, the commissioner's ruling of 2026-11-09); the recorded league
   read predates v4.58 and still says $50M */
/* QA core 2026-11-25: js/trade.js sends trades and block changes only for the current season (never from an archive on
   screen), so the recorded Season 1 this suite trades in is made the current season, as a live season would be */
function capped(b) { (b.seasons || []).forEach((x) => { if (x.number === 2) x.salary_cap = 30000000; if (x.number === 1) x.status = "active"; }); return b; }
/* a context on the real site as `persona` (session: install's session option), over the recorded Season 1 */
async function liveOpen(b, errs, persona, session, extra) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await mock.install(ctx, Object.assign({ live: true, persona, session, writes: {}, tables: { trades: [], game_lineups: [], availability: [], market_pool_requests: [], team_lines: [], team_line_plan: [] }, rpcs: { s2_league: (a) => mock.ok(capped(mock.league(a))) } }, extra));
  await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" })); } catch (e) {} });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error" && !QUIET.test(m.text())) errs.push(m.text()); });
  await p.goto(S2_BASE + "?season=1#/today", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.S2 && S2.M && S2.trade && S2.trade.evaluate && S2.trade.door && S2.auth && S2.auth.sub && document.querySelector("#page") && document.querySelector("#page").children.length > 0, null, { timeout: 20000 });
  return { ctx, p };
}

/* ===================================================================================================================
   THE TRADE DOORS (v5.00 swap, stream e4, 2026-11-24): S2.trade.door and S2.trade.read (js/trade.js), each call proved
   against the current site's own door (src/live/part_live.js CG.proposeTrade, CG.acceptTrade, CG.declineTrade,
   CG.cancelTrade, CG.setOnBlock; part9_staffdesks.js reverse_trade, resend_trade), on the real site: the gm persona
   seated as Detroit's GM (install's session option) for the club doors, the staff persona for the league office's. The
   write mock records rpc, args and approval; core's S2.write is wrapped in the page to record the other options the
   page passes (action, queueArgs, sections, summary). Nothing reaches Supabase. */
async function doorSuite(b, errs) {
  console.log("\n## the trade doors (S2.trade.door, js/trade.js), on the real site");
  const MOVED = "rosters,tenures,wire", TID = "00000000-0000-4000-8000-00000000b001", MIN = "Season 2 roster minimums: this would leave the club under its minimum of 2 defense players (Rule S2.4).";
  let H = null;
  const DOORS = { "trades.insert": () => mock.ok([{ id: "00000000-0000-4000-8000-000000000123" }]), "trades.update": () => mock.ok([{ id: "u" }]), accept_trade: () => mock.ok(null), reverse_trade: () => mock.ok(null),
    resend_trade: () => mock.ok("00000000-0000-4000-8000-000000000456"), "roster_spots.update": () => mock.ok([{ id: "rs" }]) };
  async function open(persona, session) {
    const writes = {}; Object.keys(DOORS).forEach((k) => { writes[k] = () => { const s = H.script[k]; if (s) { delete H.script[k]; return s; } return DOORS[k](); }; });
    H = { script: {}, T: [] };
    const x = await liveOpen(b, errs, persona, session, { writes, tables: { trades: () => H.T } });
    /* the defect pinned by tools/ui/tradepage.test.cjs: the model's clubs carry no teams.id, which js/trade.js reads; put
       on here so the doors themselves are proved */
    H.noIds = await x.p.evaluate(() => S2.M.teams.filter((t) => !t.id).map((t) => t.code));
    await x.p.evaluate(() => {
      (S2.data.body.teams || []).forEach((row) => { const t = S2.M.team(row.code); if (t && !t.id) t.id = row.id; });
      window.__opts = []; const w0 = S2.write;
      S2.write = function (rpc, args, o) { window.__opts.push({ rpc, action: (o && o.action) || null, queueArgs: o && o.queueArgs ? JSON.parse(JSON.stringify(o.queueArgs)) : null, sections: (o && o.sections) || [], summary: (o && o.summary) || null }); return w0.apply(this, arguments); };
      /* runs a door, settles to { res } or { err: { code, hint, message, why } } */
      window.__run = (f) => Promise.resolve().then(f).then((res) => ({ res: JSON.parse(JSON.stringify(res, (k, v) => (v instanceof Error ? { code: v.code, message: v.message, why: S2.trade.why(v) } : v))) }),
        (e) => ({ err: { code: e.code || null, hint: e.hint || null, message: e.message, why: S2.trade.why(e) } }));
    });
    return x;
  }
  /* the mock's record and the page's options, call by call */
  const calls = async (x) => { const o = await x.p.evaluate(() => window.__opts.slice()), m = mock.calls(x.ctx);
    return m.map((k, i) => Object.assign({ rpc: k.rpc, args: k.args, approval: k.approval }, o[i] && o[i].rpc === k.rpc ? { action: o[i].action, queueArgs: o[i].queueArgs, sections: o[i].sections, summary: o[i].summary } : {})); };
  const run = (x, src, arg) => x.p.evaluate((q) => window.__run(() => (0, eval)("(" + q.src + ")")(q.arg)), { src: src.toString(), arg });
  const script = (rpc, a) => { H.script[rpc] = a; };
  const same = (a, b2) => JSON.stringify(a) === JSON.stringify(b2);
  let x = await open("gm", { teamId: TIDS.DET, seat: "gm" }), r, c, n0;

  /* propose: CG.proposeTrade's row, through trades.insert, under Owner approval */
  const P = await x.p.evaluate(() => { const det = S2.M.roster("DET").active.filter((p) => !p.seat), bos = S2.M.roster("BOS").active.filter((p) => !p.seat);
    return { a: det[0].id, b: bos[0].id, c: det[1].id, det: S2.M.team("DET").id, bos: S2.M.team("BOS").id }; });
  r = await run(x, (q) => S2.trade.door.propose({ from: "DET", to: "BOS", send: [q.a], get: [q.b], note: "  A fair swap  " }), P);
  c = await calls(x);
  const row = await x.p.evaluate((k) => { const w = k.args.row; return Object.assign({}, w, { from_profile_id: w.from_profile_id === S2.session.profileId ? "(session)" : "(other)" }); }, c[0]);
  A("propose: trades.insert, the one call, with the season, both clubs, the proposer, the players and the trimmed note", c.length === 1 && c[0].rpc === "trades.insert" &&
    same(row, { season_id: SID, from_team_id: P.det, to_team_id: P.bos, from_profile_id: "(session)", offered_profile_ids: [P.a], requested_profile_ids: [P.b], note: "A fair swap" }), JSON.stringify(row));
  A("propose: under Owner approval, and it resolves with the new offer's id", c[0].approval === "owner" && r.res && r.res.id === "00000000-0000-4000-8000-000000000123" && !r.res.counterOpen, JSON.stringify(r));
  A("propose: the Owner move is trade_propose, with the arguments _mgmt_describe and _mgmt_execute read", c[0].action === "trade_propose" &&
    same(c[0].queueArgs, { to_team_id: P.bos, season_id: SID, offered_profile_ids: [P.a], requested_profile_ids: [P.b], offered_pick_ids: [], requested_pick_ids: [], note: "A fair swap", countered_id: null }) && /^propose a trade to the Bruins \(1 for 1\)$/.test(c[0].summary), JSON.stringify(c[0]));
  /* a counter: the new offer, then the offer it answers declined (CG.proposeTrade's counteredId) */
  n0 = c.length;
  r = await run(x, (q) => S2.trade.door.propose({ from: "DET", to: "BOS", send: [q.a, q.c], get: [q.b], counter: q.t }), Object.assign({ t: TID }, P));
  c = (await calls(x)).slice(n0);
  A("counter: the new offer, then trades.update declining the offer it answers, only while it is still proposed", c.length === 2 && c[0].rpc === "trades.insert" && c[1].rpc === "trades.update" &&
    c[1].args.set.status === "declined" && /^\d{4}-\d\d-\d\dT/.test(c[1].args.set.updated_at) && same(c[1].args.match, { id: TID, status: "proposed" }) && c[1].approval === "owner" && r.res.id && !r.res.counterOpen, JSON.stringify(c));
  A("counter: the queued move carries countered_id, and the decline names trade_decline", c[0].queueArgs.countered_id === TID && c[1].action === "trade_decline" && same(c[1].queueArgs, { p_trade: TID }), JSON.stringify(c));
  n0 += c.length;
  script("trades.update", mock.fail("S2_NO_ROWS", "Nothing was saved."));
  r = await run(x, (q) => S2.trade.door.propose({ from: "DET", to: "BOS", send: [q.a], get: [q.b], counter: q.t }), Object.assign({ t: TID }, P));
  A("counter: when the decline finds the offer already answered, the counter still stands and says why", r.res && r.res.id && r.res.counterOpen && r.res.counterOpen.code === "S2_NO_ROWS" && /no longer open/.test(r.res.counterOpen.why), JSON.stringify(r));
  n0 = (await calls(x)).length;
  script("trades.insert", Object.assign(mock.ok("move-1"), { queued: true }));
  r = await run(x, (q) => S2.trade.door.propose({ from: "DET", to: "BOS", send: [q.a], get: [q.b], counter: q.t }), Object.assign({ t: TID }, P));
  c = (await calls(x)).slice(n0);
  A("counter sent to the Owner: one queued move and no decline (the executor closes their offer on approval)", c.length === 1 && r.res.queued === true && !r.res.id, JSON.stringify({ c, r }));
  n0 += c.length;
  /* the answers */
  r = await run(x, (q) => S2.trade.door.accept(q), TID);
  c = (await calls(x)).slice(n0); n0 += c.length;
  A("accept: accept_trade with the offer's id, under Owner approval", c.length === 1 && c[0].rpc === "accept_trade" && same(c[0].args, { p_trade: TID }) && c[0].approval === "owner" && r.res, JSON.stringify(c));
  A("accept: the rosters, tenures and the wire are read again after it", c[0].sections.join() === MOVED && c[0].action === null, c[0].sections.join());
  script("accept_trade", mock.fail("23514", MIN, "below_minimum"));
  r = await run(x, (q) => S2.trade.door.accept(q), TID); n0++;
  A("accept: a refusal comes back with the database's code, hint and words", r.err && r.err.code === "23514" && r.err.hint === "below_minimum" && r.err.message === MIN && r.err.why === MIN, JSON.stringify(r));
  for (const [door, status, action] of [["decline", "declined", "trade_decline"], ["cancel", "cancelled", "trade_cancel"]]) {
    r = await run(x, (q) => S2.trade.door[q.d](q.t), { d: door, t: TID });
    c = (await calls(x)).slice(n0); n0 += c.length;
    A(door + ": trades.update to " + status + ", only while the offer is still proposed, under Owner approval", c.length === 1 && c[0].rpc === "trades.update" && c[0].args.set.status === status && same(c[0].args.match, { id: TID, status: "proposed" }) && c[0].approval === "owner" && r.res, JSON.stringify(c));
    A(door + ": the Owner move is " + action, c[0].action === action && same(c[0].queueArgs, { p_trade: TID }), JSON.stringify(c[0]));
  }
  script("trades.update", mock.fail("S2_NO_ROWS", "Nothing was saved. The league's rules did not let this change through, or the record has changed."));
  r = await run(x, (q) => S2.trade.door.decline(q), TID); n0++;
  A("decline: an offer answered in the meantime is said as no longer open", r.err && r.err.code === "S2_NO_ROWS" && /^That offer is no longer open/.test(r.err.why), JSON.stringify(r));
  r = await run(x, (q) => S2.trade.door.block(q, false), P.a);
  c = (await calls(x)).slice(n0); n0 += c.length;
  A("block: roster_spots.on_block for the season on screen and the player, under Owner approval", c.length === 1 && c[0].rpc === "roster_spots.update" && same(c[0].args, { set: { on_block: false }, match: { season_id: SID, profile_id: P.a } }) && c[0].approval === "owner", JSON.stringify(c));
  A("block: the Owner move is roster_block with the player, and the rosters are read again", c[0].action === "roster_block" && same(c[0].queueArgs, { p_profile: P.a, on_block: false }) && c[0].sections.join() === "rosters", JSON.stringify(c[0]));
  /* no club id: an error before anything is sent, never a guess */
  r = await x.p.evaluate((q) => { const t = S2.M.team("BOS"), id = t.id; delete t.id; return window.__run(() => S2.trade.door.propose({ from: "DET", to: "BOS", send: [q.a], get: [q.b] })).then((v) => { t.id = id; return v; }); }, P);
  c = (await calls(x)).slice(n0);
  A("propose: a club with no id in the league data is refused before anything is sent", r.err && r.err.code === "S2_NO_TEAM_ID" && !c.length, JSON.stringify(r));
  /* the one offer read, through the real client and the trades table */
  H.T = [{ id: TID, season_id: "s", from_team_id: P.det, to_team_id: P.bos, from_profile_id: "u", offered_profile_ids: [P.a], requested_profile_ids: [P.b], note: "N", status: "cancelled", created_at: "2026-11-24T12:00:00Z", updated_at: "2026-11-24T13:00:00Z" }];
  const seen = []; mock.respond(x.ctx, "table:trades", (q) => { seen.push({ select: q.select, filters: q.filters }); return H.T; });
  r = { o: await x.p.evaluate((t) => S2.trade.read(t), TID) };
  r.reads = seen.slice(); seen.length = 0;
  r.demo = await x.p.evaluate(() => S2.trade.read("os-NYI-DET")); r.demoReads = seen.length;
  H.T = []; r.none = await x.p.evaluate((t) => S2.trade.read(t), TID);
  mock.respond(x.ctx, "table:trades", mock.fail("42501", "permission denied for table trades"));
  r.err = await x.p.evaluate((t) => S2.trade.read(t).then(() => null, (e) => e.message), TID);
  /* a missing client (fault injection: the page's own client taken away for one call) */
  r.off = await x.p.evaluate((t) => { const keep = S2.ensureSb; S2.ensureSb = () => null; return S2.trade.read(t).then(() => null, (e) => e.message).then((v) => { S2.ensureSb = keep; return v; }); }, TID);
  r.unknown = await x.p.evaluate((t) => { try { S2.trade.offerOf({ id: t, from_team_id: "nobody", to_team_id: S2.M.team("BOS").id }); return null; } catch (e) { return e.message; } }, TID);
  A("read: one row by id, through the trades table, mapped to the pages' offer (a withdrawal is \"withdrawn\")", r.o && r.o.from === "DET" && r.o.to === "BOS" && r.o.send.join() === P.a && r.o.get.join() === P.b && r.o.status === "withdrawn" && r.o.note === "N" && r.o.live === true &&
    r.reads.length === 1 && r.reads[0].select === "id,season_id,from_team_id,to_team_id,from_profile_id,offered_profile_ids,requested_profile_ids,note,status,created_at,updated_at" && r.reads[0].filters.some((f) => f[0] === "id" && f[1] === "eq." + TID), JSON.stringify(r).slice(0, 400));
  A("read: no row the reader may see is no offer; a demo id is never asked for", r.none === null && r.demo === null && r.demoReads === 0, JSON.stringify({ none: r.none, demo: r.demo, n: r.demoReads }));
  A("read: a failed read and a missing client are errors, never an empty answer", r.err === "permission denied for table trades" && /^Not connected to the league/.test(r.off || "") && /names a club the league data does not carry/.test(r.unknown || ""), JSON.stringify({ err: r.err, off: r.off, unknown: r.unknown }));
  await x.ctx.close();

  /* the league office's doors, never queued for an Owner */
  x = await open("staff");
  r = await run(x, (q) => S2.trade.door.reverse(q, "  A lopsided giveaway between allied clubs  "), TID);
  c = await calls(x);
  A("reverse: reverse_trade with the offer and the trimmed reason, never queued for an Owner", c.length === 1 && c[0].rpc === "reverse_trade" && same(c[0].args, { p_trade: TID, p_reason: "A lopsided giveaway between allied clubs" }) && c[0].approval === null && r.res, JSON.stringify(c));
  A("reverse: the rosters, tenures and the wire are read again after it", c[0].sections.join() === MOVED && c[0].action === null, c[0].sections.join());
  r = await run(x, (q) => S2.trade.door.resend(q), TID);
  c = (await calls(x)).slice(1);
  A("resend: resend_trade with the offer, never queued, and it resolves with the new offer's id", c.length === 1 && c[0].rpc === "resend_trade" && same(c[0].args, { p_trade: TID }) && c[0].approval === null && r.res && r.res.data === "00000000-0000-4000-8000-000000000456", JSON.stringify({ c, r }));
  script("reverse_trade", mock.fail("P0001", "Only the transactions department or a commissioner can reverse a trade."));
  r = await run(x, (q) => S2.trade.door.reverse(q, "A lopsided giveaway between allied clubs"), TID);
  A("reverse: the database's own gate is the only gate, and its words come back as they are", r.err && r.err.message === "Only the transactions department or a commissioner can reverse a trade.", JSON.stringify(r));
  await x.ctx.close();
  return H.noIds;
}

(async () => {
  const b = await chromium.launch(), errs = [];
  const { p } = await liveOpen(b, errs, "anon");
  roster = await p.evaluate(inputs);
  Object.keys(roster).forEach((pid) => { const r = roster[pid]; if (r.S) line[pid + "|S"] = r.S; if (r.G) line[pid + "|G"] = r.G; });
  rostered = Object.keys(roster).filter((pid) => !roster[pid].seat);

  /* ---------- the players: skaters, goaltenders, a two-role player, players under five games, unplayed, big salaries ---------- */
  const by = (f) => rostered.slice().sort((a, b2) => f(b2) - f(a));
  const pick = [], add = (pid, why) => { if (pid && !pick.some((x) => x.pid === pid)) pick.push({ pid, why }); };
  add(by((q) => (line[q + "|S"] ? line[q + "|S"].p : -1))[0], "top scorer");
  add(by((q) => (line[q + "|S"] ? line[q + "|S"].p : -1))[6], "skater, seventh in points");
  by((q) => (line[q + "|G"] ? line[q + "|G"].gp : -1)).slice(0, 3).forEach((q) => add(q, "goaltender"));
  add(rostered.filter((q) => line[q + "|S"] && line[q + "|G"])[0], "two roles");
  rostered.filter((q) => { const g = hand(q).gp; return g >= 1 && g < 5; }).slice(0, 3).forEach((q) => add(q, "under five games"));
  add(rostered.filter((q) => hand(q).gp === 0)[0], "no games");
  add(by((q) => roster[q].salary)[0], "biggest salary");
  add(rostered.filter((q) => roster[q].head != null && roster[q].head < 80)[0], "rated under 80");
  const got = await p.evaluate((ids) => ids.map((id) => S2.trade.tradeValue(id)), pick.map((x) => x.pid));
  console.log("\nplayer | why | OVR | games (skate/goal) | rating pts | production | salary | by hand | the page");
  pick.forEach((x, i) => {
    const h = hand(x.pid), c = got[i];
    console.log([h.tag, x.why, h.overall, h.gp + " (" + h.sgp + "/" + h.gs + ")", h.ovr, h.prod, h.cap, h.value, c.value].join(" | "));
    A("value of " + h.tag + " (" + x.why + ")", c.value === h.value && c.ovr === h.ovr && c.prod === h.prod && c.cap === h.cap, "hand " + h.value + ", page " + c.value);
  });
  A("at least ten players checked", pick.length >= 10, pick.length + " players");
  /* every rostered player, not only the ten above */
  const all = await p.evaluate((ids) => ids.map((id) => S2.trade.tradeValue(id).value), rostered);
  const off = rostered.filter((id, i) => all[i] !== hand(id).value);
  A("every rostered player matches the hand formula", !off.length, rostered.length + " players" + (off.length ? ", differ: " + off.map((id) => hand(id).tag).join(", ") : ""));

  /* ---------- three trades: one even, one lopsided each way ---------- */
  const clubs = [...new Set(rostered.map((pid) => roster[pid].club))].sort(), one = {};
  clubs.forEach((c) => { one[c] = rostered.filter((pid) => roster[pid].club === c); });
  let even = null, toWins = null, fromWins = null;
  for (const a of clubs) for (const c of clubs) { if (a >= c) continue;
    for (const x of one[a]) for (const y of one[c]) {
      const va = hand(x).value, vb = hand(y).value, v = verdict(va, vb, a, c);
      if (!even && v.state === "even" && va > 150 && va !== vb) even = { from: a, to: c, send: [x], get: [y], v };
      if (!toWins && v.state === "favors" && v.favors === c && v.pct >= 30 && v.pct <= 60) toWins = { from: a, to: c, send: [x], get: [y], v };
      if (!fromWins && v.state === "favors" && v.favors === a && v.pct >= 15 && v.pct <= 24) fromWins = { from: a, to: c, send: [x], get: [y], v };
    } }
  console.log("\ntrade | from sends (value) | to sends (value) | live by hand | concept");
  for (const [name, t] of [["even", even], ["lopsided, favors the receiving club", toWins], ["lopsided, favors the proposing club", fromWins]]) {
    if (!t) { A(name + " trade found", false); continue; }
    const ev = await p.evaluate((o) => { const e = S2.trade.evaluate(o); return { r: e.reading, html: S2.trade.detail(e, {}), mini: S2.trade.verdict(e, o.from), head: e.headline }; }, { from: t.from, to: t.to, send: t.send, get: t.get });
    const want = t.v.state === "even" ? "Even" : "Favors " + CITY[t.v.favors] + " by " + t.v.pct + "%";
    console.log([name, t.from + " " + hand(t.send[0]).tag + " (" + hand(t.send[0]).value + ")", t.to + " " + hand(t.get[0]).tag + " (" + hand(t.get[0]).value + ")", want, ev.r.text].join(" | "));
    A("reading, " + name, ev.r.text === want && ev.r.favors === t.v.favors && ev.r.pct === t.v.pct, ev.r.text + " / " + want);
    A("detail says it is a guide, not a ruling, and what value counts (" + name + ")", /not a ruling/.test(ev.html) && /Rule 2\.3/.test(ev.html) && /rating, this season(&#39;|')s production and their salary/.test(ev.html));
    A("no em dash or spaced hyphen in the reading (" + name + ")", !/—|\s-\s/.test(ev.html.replace(/<[^>]+>/g, " ")));
    if (t.v.favors === t.from) A("the proposing club reads it as \"Favors you\"", ev.mini === "Favors you by " + t.v.pct + "%", ev.mini);
  }

  /* ---------- review 2026-10-20: the sentence, the rating and the parts agree with the numbers ---------- */
  const cityOf = (code) => CITY[code];
  /* every player below is chosen by what they are, never by a member's name (the repository is public at the hand-off,
     COMMON.md: no real gamertag hard-coded in a committed file); the names print only in this run's output */
  const tags = (pids) => pids.map((x) => hand(x).tag).join("+");
  const byValue = (c, n, skip, low) => one[c].slice().sort((a, b) => (low ? -1 : 1) * (hand(b).value - hand(a).value)).slice(skip || 0, (skip || 0) + n);
  const keeper = (c) => one[c].filter((pid) => line[pid + "|G"]).sort((a, b) => line[b + "|G"].gp - line[a + "|G"].gp)[0];
  const fewGames = (c) => one[c].filter((pid) => { const g = hand(pid).gp; return g >= 1 && g < 5; })[0] || one[c][0];
  /* the headline never says a club gets more value unless the verdict's own numbers say so: one for two, two for one, the
     clubs' busiest goaltenders, a player under five games, and the three trades above */
  const cases = [["DET", "BOS", byValue("DET", 1), byValue("BOS", 2, 1)], ["DAL", "VAN", byValue("DAL", 2, 0, true), byValue("VAN", 1)], ["BOS", "VAN", byValue("BOS", 2), byValue("VAN", 1, 1)],
    ["BOS", "DAL", [keeper("BOS")], [keeper("DAL")]], ["PIT", "NYI", [fewGames("PIT")], byValue("NYI", 1, 0, true)]].filter((t) => t[2].concat(t[3]).every(Boolean))
    .concat([even, toWins, fromWins].filter(Boolean).map((t) => [t.from, t.to, t.send, t.get]));
  /* the model's own groups pick the rest: the best-scoring winger, and a center and a defender on other clubs, each with six
     games in their group; another center and another winger on other clubs again; the goaltender with the most games; a
     two-role player with six games in goal; a skater with one to five games */
  const PK = await p.evaluate(() => {
    const M = S2.M, SET = M.SETTLE_GP, P = (id) => M.player(id), ok = (l) => { const x = P(l.pid); return x && x.rostered && !x.seat; }, club = (l) => P(l.pid).club;
    const best = (g) => M.lines({ role: "S" }).filter((l) => ok(l) && l.group === g && l.groupGp >= SET).sort((a, b) => b.pts_pg - a.pts_pg);
    const away = (list, c, not) => list.filter((l) => club(l) !== c && l.pid !== not)[0], pick = (l) => (l ? { pid: l.pid, club: club(l) } : null);
    const W = best("W"), C = best("C"), Dl = best("D"), G = M.lines({ role: "G" }).filter((l) => ok(l) && l.groupGp >= SET).sort((a, b) => b.groupGp - a.groupGp);
    const w = W[0], c = away(C, club(w)), c2 = away(C, club(c), c.pid), w2 = away(W, club(w), w.pid);
    const two = M.players.filter((x) => x.rostered && !x.seat && x.lines.S && x.lines.G && x.lines.G.groupGp >= SET).sort((a, b) => b.lines.G.groupGp - a.lines.G.groupGp)[0];
    const few = M.players.filter((x) => x.rostered && !x.seat && x.lines.S && !x.lines.G && x.lines.S.groupGp >= 1 && x.lines.S.groupGp < SET)[0];
    return { W: pick(w), C: pick(c), C2: pick(c2), W2: pick(w2), D: pick(away(Dl, club(w))), G: pick(G[0]), Gaway: pick(away(W, club(G[0]))),
      two: two && { pid: two.id, club: two.club }, twoC: two && pick(away(C, two.club)), few: few && { pid: few.id, club: few.club }, fewAway: few && pick(away(W, few.club)) };
  });
  A("every chosen player exists in the data", Object.keys(PK).every((k) => PK[k] && PK[k].pid), JSON.stringify(Object.keys(PK).filter((k) => !PK[k] || !PK[k].pid)));
  const deal = (a, b) => ({ from: a.club, to: b.club, send: [a.pid], get: [b.pid] });
  for (const [from, to, send, get] of cases) {
    const e = await p.evaluate((o) => { const e = S2.trade.evaluate(o); return { h: e.headline, r: e.reading, rec: e.receives,
      rates: e.sides[0].players.concat(e.sides[1].players).map((x) => [x.tag, x.headline.ovr, x.value.overall]), html: S2.trade.detail(e, { me: o.from }).replace(/<[^>]+>/g, " ") }; },
      { from, to, send, get });
    const said = (e.h.lead + ". " + e.h.rest), m = said.match(/(?:^|\. )([A-Z][\w ]*?) (?:gets|got) more value, (\d+) to (\d+)/), ev2 = /about even/.test(said);
    const name = from + " " + tags(send) + " for " + to + " " + tags(get);
    A("headline value words agree with the verdict (" + name + ")", (!m || (m[1] === cityOf(e.r.favors) && +m[2] === e.rec[e.r.favors])) && (!ev2 || e.r.state === "even") && !/most value/.test(said), said + " / " + e.r.text);
    A("one rating: the row and the value read the same number (" + name + ")", e.rates.every((x) => x[1] === x[2]), JSON.stringify(e.rates));
    const top = Math.max(...e.rates.map((x) => x[2]));
    A("the sentence's rating is the value's (" + name + ")", !/rated (\d+)/.test(said) || +said.match(/rated (\d+)/)[1] === top, said);
    A("no stand-in wording left in the detail (" + name + ")", !/live default|Not rated yet|v2\.72/.test(e.html));
  }
  /* a two-role player shows both lines in full: the goaltending line, its record and its rank pool, worked out from the
     model's own line (the snapshot's two-role player has one skating game and six in goal) */
  const hz = await p.evaluate((o) => { const M = S2.M, g = M.player(o.send[0]).lines.G, n = M.lines({ role: "G" }).filter((l) => l.group === "G" && l.groupGp >= M.SETTLE_GP).length;
    return { text: S2.trade.detail(S2.trade.evaluate(o), {}).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), line: "In goal " + g.gp + " GP · " + M.display("sv_pct", g.sv_pct) + " SV%", rec: g.w + "-" + g.l + "-" + g.otl + " W-L-OTL", pool: "Rank among " + n + " goaltenders with six or more games" }; },
    deal(PK.two, PK.twoC));
  A("a two-role player's second line is shown in full", hz.text.indexOf(hz.line) >= 0 && hz.text.indexOf(hz.rec) >= 0 && hz.text.indexOf(hz.pool) >= 0, [hz.line, hz.rec, hz.pool].join(" / "));
  /* ---------- ranks, by a second method: sort the pool from M.lines best first, walk it, give equal shown values one rank
     (competition ranking, 1 2 2 4); the model counts how many are better instead ---------- */
  const rk = await p.evaluate((PK) => {
    const M = S2.M, SET = M.SETTLE_GP;
    const key = (k, v) => M.display(k, v).replace(/^\+/, "").replace(/^-(0(\.0+)?%?)$/, "$1");   /* the text a reader sees; +0.00, 0.00 and -0.00 are one value */
    const hand = (l, k) => {
      const st = M.STATS[k];
      if (l[k] == null || st.role !== l.role || (k === "fo_pct" && (l.group !== "C" || l.fot < 10))) return null;
      const pool = M.lines({ role: l.role }).filter((x) => x.group === l.group && x.groupGp >= SET && x[k] != null && (k !== "fo_pct" || x.fot >= 10));
      pool.sort((a, b) => (st.better === "low" ? a[k] - b[k] : b[k] - a[k]));
      const n = pool.length, mine = key(k, l[k]);
      if (l.groupGp < SET) return { few: true, n };
      let r = 0, at = null;
      pool.forEach((x, i) => { if (i === 0 || key(k, x[k]) !== key(k, pool[i - 1][k])) r = i + 1; if (at == null && key(k, x[k]) === mine) at = r; });
      const tied = pool.filter((x) => key(k, x[k]) === mine).length, ord = S2.ord(at);
      /* a tie down to last place sits at the middle of the places it shares (11 goaltenders with no shutouts: 8th to 18th) */
      const place = tied > 1 && at + tied - 1 === n ? (at + at + tied - 1) / 2 : at;
      return { few: false, n, rank: at, tied, text: (tied > 1 ? "Tied for " : "") + ord + " of " + n, shortText: (tied > 1 ? "T-" : "") + ord, score: n === 1 ? 100 : (n - place) / (n - 1) * 100 };
    };
    const same = (h, m) => (!h && !m) || (h && m && h.few === m.few && h.n === m.n && (h.few ? m.rank === null && m.text === null : h.rank === m.rank && h.tied === m.tied && h.text === m.text && h.shortText === m.shortText && Math.abs(h.score - m.score) < 1e-9));
    const off = [];
    let checked = 0;
    M.lines({}).forEach((l) => M.rankKeys(l.role).forEach((k) => { checked++; const h = hand(l, k), m = M.rank(l, k); if (!same(h, m)) off.push(l.tag + " " + l.role + " " + k + " hand " + JSON.stringify(h) + " model " + JSON.stringify(m && { n: m.n, rank: m.rank, tied: m.tied, text: m.text })); }));
    /* the printed cases */
    const L = (k, r) => { const p = M.player(PK[k].pid); return p && p.lines[r]; };
    const firstTie = (role, k) => M.lines({ role }).filter((l) => l.groupGp >= SET).map((l) => M.rank(l, k)).filter((x) => x && x.tied > 1)[0];
    const tieLine = (role, k) => M.lines({ role }).filter((l) => l.groupGp >= SET && (M.rank(l, k) || {}).tied > 1)[0];
    const topD = M.lines({ role: "S", group: "D", minGp: SET, sort: "pts_pg" }).filter((l) => l.groupGp >= SET)[0];
    const worstG = M.lines({ role: "G" }).filter((l) => l.groupGp >= SET && l.gaa != null).sort((a, b) => b.gaa - a.gaa)[0];
    const bestG = M.lines({ role: "G" }).filter((l) => l.groupGp >= SET && l.gaa != null).sort((a, b) => a.gaa - b.gaa)[0];
    const cases = [["skater, winger", L("W", "S"), "pts_pg"], ["skater, shooting", L("W", "S"), "shot_pct"], ["skater, fewer is better", L("W", "S"), "gv_pg"],
      ["skater, center", L("C", "S"), "pts_pg"], ["skater, defense", topD, "pts_pg"], ["skater, defense, fewer is better", topD, "pim_pg"],
      ["goaltender", L("G", "G"), "sv_pct"], ["goaltender, GAA lowest", bestG, "gaa"], ["goaltender, GAA highest", worstG, "gaa"],
      ["two roles, in goal", L("two", "G"), "sv_pct"], ["two roles, skating (few games)", L("two", "S"), "pts_pg"],
      ["a tie, goaltenders", tieLine("G", "so_pg"), "so_pg"], ["a tie, skaters", tieLine("S", "g_pg"), "g_pg"]];
    const rows = cases.map(([why, l, k]) => { const h = hand(l, k), m = M.rank(l, k);
      return { why, tag: l.tag, role: l.role, group: l.group, groupGp: l.groupGp, stat: k, shown: M.display(k, l[k]), hand: h ? (h.few ? "no rank (few), pool " + h.n : h.text) : "null", model: m ? (m.few ? "no rank (few), pool " + m.n : m.text) : "null", score: m && m.score != null ? m.score.toFixed(1) : "-", ok: !!same(h, m) }; });
    const sizes = {}; ["C", "W", "D", "G"].forEach((g) => { sizes[g] = M.lines({ role: g === "G" ? "G" : "S" }).filter((l) => l.group === g && l.groupGp >= SET).length; });
    /* the rank after a tie skips (1, 2, 2, 4): every tie of k at rank r is followed by rank r + k, in every pool */
    let skips = 0, skipOff = [];
    M.lines({}).filter((l) => l.groupGp >= SET).forEach((l) => M.rankKeys(l.role).forEach((k) => { const x = M.rank(l, k); if (!x || x.few || x.tied < 2 || x.rank + x.tied > x.n) return;
      const pool = M.lines({ role: l.role }).filter((y) => y.group === l.group && y.groupGp >= SET).map((y) => M.rank(y, k)).filter((y) => y && !y.few);
      const next = Math.min.apply(null, pool.filter((y) => y.rank > x.rank).map((y) => y.rank)); skips++; if (next !== x.rank + x.tied) skipOff.push(l.tag + " " + k + " " + x.text + " next " + next); }));
    /* values that differ underneath but print the same share a rank (the precision shown decides, not the stored float) */
    let level = null;
    M.lines({}).filter((l) => l.groupGp >= SET).some((l) => M.rankKeys(l.role).some((k) => {
      const twin = M.lines({ role: l.role }).filter((y) => y !== l && y.group === l.group && y.groupGp >= SET && y[k] != null && l[k] != null && y[k] !== l[k] && M.display(k, y[k]) === M.display(k, l[k]) && (k !== "fo_pct" || (y.fot >= 10 && l.fot >= 10)))[0];
      if (twin) level = { k, a: l.tag + " " + l[k], b: twin.tag + " " + twin[k], shown: M.display(k, l[k]), ra: M.rank(l, k).text, rb: M.rank(twin, k).text };
      return !!twin; }));
    /* a line's group is the group with the most games summed over its EA positions (LW and RW are one group, LD and RD
       another); on a level count, the group of its most-played position */
    const groupOff = [];
    M.lines({ role: "S" }).forEach((l) => { const sum = {}; Object.keys(l.positions).forEach((k) => { const g = M.GROUP[k]; if (g) sum[g] = (sum[g] || 0) + l.positions[k]; });
      const gs = Object.keys(sum); if (!gs.length) { if (l.group !== (M.GROUP[l.regPos] || null)) groupOff.push(l.tag + " no games, group " + l.group); return; }
      const top = Math.max.apply(null, gs.map((g) => sum[g])), lead = gs.filter((g) => sum[g] === top);
      const want = lead.length > 1 && lead.indexOf(M.GROUP[l.posPlayed]) >= 0 ? M.GROUP[l.posPlayed] : lead[0];
      if (lead.indexOf(l.group) < 0 || (lead.length > 1 && l.group !== want) || l.groupGp !== sum[l.group]) groupOff.push(l.tag + " " + JSON.stringify(l.positions) + " group " + l.group + " " + l.groupGp); });
    /* a tie that runs down to last place never draws past the middle (it holds the pool's worst value) */
    let lastTies = 0; const lastOff = [];
    M.lines({}).filter((l) => l.groupGp >= SET).forEach((l) => M.rankKeys(l.role).forEach((k) => { const x = M.rank(l, k); if (!x || x.few || x.tied < 2 || x.rank + x.tied - 1 !== x.n || x.rank === 1) return;
      lastTies++; if (!(x.score < 50)) lastOff.push(l.tag + " " + k + " " + x.text + " " + x.score.toFixed(1)); }));
    return { off, checked, rows, sizes, summary: (S2.data.body.pct || {}), firstTie: !!firstTie("G", "so_pg"), skips, skipOff, level, groupOff, groupLines: M.lines({ role: "S" }).length, lastTies, lastOff,
      gaaOrder: bestG && worstG ? [M.rank(bestG, "gaa").rank, M.rank(worstG, "gaa").rank, M.rank(worstG, "gaa").n] : null,
      foD: M.rank(topD, "fo_pct"), other: M.rank(L("W", "S"), "sv_pct"),
      noPct: typeof M.percentile === "undefined" && typeof M.percentiles === "undefined" };
  }, PK);
  console.log("\nline | why | role, group, games there | measure | shown | by hand | M.rank | score");
  rk.rows.forEach((r) => console.log([r.tag, r.why, r.role + " " + r.group + " " + r.groupGp, r.stat, r.shown, r.hand, r.model, r.score].join(" | ")));
  console.log("pool sizes (6+ games at the most-played group): " + JSON.stringify(rk.sizes) + "; the league read's pct: " + JSON.stringify(rk.summary));
  rk.rows.forEach((r) => A("rank by hand, " + r.why + " (" + r.tag + " " + r.stat + ")", r.ok, r.hand + " / " + r.model));
  A("every line and measure ranks the same by hand", !rk.off.length && rk.checked > 2000, rk.checked + " checked" + (rk.off.length ? "; differ: " + rk.off.slice(0, 5).join(" || ") : ""));
  A("ties exist in the data and read as \"Tied for\"", rk.rows.some((r) => /^Tied for \d+(st|nd|rd|th) of \d+$/.test(r.model)) && rk.firstTie);
  A("GAA: the lowest is 1st and the highest is last", rk.gaaOrder && rk.gaaOrder[0] === 1 && rk.gaaOrder[1] === rk.gaaOrder[2], JSON.stringify(rk.gaaOrder));
  A("no defense faceoff rank and no rank across roles", rk.foD === null && rk.other === null);
  A("the model no longer offers a percentile", rk.noPct);
  A("the rank after a tie skips (1, 2, 2, 4)", rk.skips > 20 && !rk.skipOff.length, rk.skips + " ties checked" + (rk.skipOff.length ? "; off: " + rk.skipOff.slice(0, 3).join(" || ") : ""));
  A("values that print the same share a rank, though they differ underneath", rk.level && rk.level.ra === rk.level.rb, JSON.stringify(rk.level));
  A("every skater line's group is its most-played group, summed over positions", rk.groupLines > 100 && !rk.groupOff.length, rk.groupLines + " lines" + (rk.groupOff.length ? "; off: " + rk.groupOff.slice(0, 3).join(" || ") : ""));
  A("a tie down to last place draws below the middle (zero shutouts is not above the pack)", rk.lastTies > 5 && !rk.lastOff.length, rk.lastTies + " such ranks" + (rk.lastOff.length ? "; off: " + rk.lastOff.slice(0, 3).join(" || ") : ""));
  /* the reading prints ranks in words and never a percentile, in text or in what a reader hears */
  const rd = await p.evaluate((o) => { const e = S2.trade.evaluate(o), d = document.createElement("div"); d.innerHTML = S2.trade.detail(e, {}) + S2.trade.compact(e, {});
    const attrs = Array.from(d.querySelectorAll("*")).map((x) => [x.getAttribute("aria-label"), x.getAttribute("title")].join(" ")).join(" ");
    return { text: d.textContent.replace(/\s+/g, " "), attrs, vals: Array.from(d.querySelectorAll(".tr-pc-v")).map((x) => x.textContent), cells: Array.from(d.querySelectorAll(".tr-cmp-t td")).map((x) => [x.querySelector(".tr-rk-s").textContent, x.title, x.querySelector(".tr-rk-l").textContent, x.querySelector(".sr").textContent]),
      cmp: e.compare && e.compare.ok, ranks: e.sides[0].players.concat(e.sides[1].players).map((x) => x.ranks.concat(x.other ? x.other.ranks : [])) }; },
    deal(PK.W, PK.C));
  A("the reading prints no percentile anywhere", !/percentile/i.test(rd.text + " " + rd.attrs), (rd.text.match(/.{40}percentile.{40}/i) || [""])[0]);
  A("each key stat shows its rank in words", rd.vals.length >= 10 && rd.vals.every((v) => /^(Tied for )?\d+(st|nd|rd|th) of \d+$/.test(v.replace(/^.*, /, ""))), rd.vals.slice(0, 4).join(" / "));
  A("the caption names the rank pool", rd.text.indexOf("Rank among " + rk.sizes.W + " wingers with six or more games") >= 0 && rd.text.indexOf("Rank among " + rk.sizes.C + " centers with six or more games") >= 0, JSON.stringify(rk.sizes));
  /* the narrow cell keeps the pool size ("T-9th of 18") when the two rank in different pools, as the winger and the center
     do here, and its pool is the full rank's */
  A("the head to head table: the short rank for a narrow column, the full rank beside it, as its title and for a reader", rd.cmp && rd.cells.length >= 6 && rd.cells.every((c) => { const m = c[0].match(/^(T-)?(\d+)(st|nd|rd|th)(?: of (\d+))?$/), f = c[2].match(/(\d+)(st|nd|rd|th) of (\d+)$/);
    return m && f && m[2] === f[1] && !!m[1] === /^Tied/.test(c[2]) && (m[4] == null || m[4] === f[3]) && /^(Tied for )?\d+(st|nd|rd|th) of \d+ \w+/.test(c[1]) && c[1].indexOf(c[2]) === 0 && c[3] === c[1]; }), JSON.stringify(rd.cells.slice(0, 2)));
  A("tone: top quarter good, bottom quarter weak", rd.ranks.every((rs) => rs.every((x) => x.few || x.tone === (x.score >= 75 ? "hi" : x.score <= 25 ? "lo" : ""))));
  const dp = await p.evaluate((o) => S2.trade.detail(S2.trade.evaluate(o), {}).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), deal(PK.W, PK.D));
  A("defense reads as defense players in the caption and the table", dp.indexOf("Rank among " + rk.sizes.D + " defense players with six or more games") >= 0 && !new RegExp("of " + rk.sizes.D + " defense(?! players)").test(dp), (dp.match(/Rank among \d+ [a-z ]+ with/) || [""])[0]);
  const fw = await p.evaluate((o) => S2.trade.detail(S2.trade.evaluate(o), {}).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), deal(PK.few, PK.fewAway));
  A("too few games: ranks need six games at a position", /Too few skating games to rank: ranks need six games at a position\./.test(fw), (fw.match(/Too few[^.]*\./) || [""])[0]);
  /* the head to head says "ranks higher" only within one pool, by the ranks it prints, and bolds the same cells. Players in
     different position groups rank in pools of different sizes, so nothing is bold and the sentence names both pools
     (review 2026-10-20: "ranks higher on 3 of 5" for a center 9th of 18 over a defender 13th of 35, while the radar drew
     the defender outside on every spoke) */
  const h2hKinds = { same: 0, cross: 0 };
  /* two pairs across position groups (a winger for a center, a winger for a defender) and two within one (two centers, two
     wingers), besides the cases above */
  const pairs = [[PK.W, PK.C], [PK.W, PK.D], [PK.C, PK.C2], [PK.W, PK.W2], [PK.two, PK.twoC]].map((x) => { const t = deal(x[0], x[1]); return [t.from, t.to, t.send, t.get]; });
  for (const [from, to, send, get] of cases.concat(pairs)) {
    const h = await p.evaluate((o) => { const e = S2.trade.evaluate(o), d = document.createElement("div"); d.innerHTML = S2.trade.detail(e, { me: o.from });
      const c = e.compare; if (!c || !c.ok) return null;
      const sec = d.querySelector(".tr-cmp"), rows = Array.from(sec.querySelectorAll(".tr-cmp-t tbody tr")).map((r) => Array.from(r.querySelectorAll("td")).map((td) => [td.title, td.classList.contains("lead"), td.querySelector(".tr-rk-s").textContent]));
      return { say: sec.querySelector("p").textContent, a: c.a.tag, b: c.b.tag, ar: c.ar.map((x) => [x.rank, x.group, x.n, x.groupMany]), br: c.br.map((x) => [x.rank, x.group, x.n, x.groupMany]), rows }; },
      { from, to, send, get });
    if (!h) continue;
    const name = from + " " + tags(send) + " for " + to + " " + tags(get);
    const cross = h.ar.some((x, i) => x[1] !== h.br[i][1] || x[2] !== h.br[i][2]);
    if (cross) {
      h2hKinds.cross++;
      const want = "They rank in different position groups (" + h.ar[0][2] + " " + h.ar[0][3] + ", " + h.br[0][2] + " " + h.br[0][3] + "), so neither is marked higher; the radar shows where each stands in their own group.";
      A("head to head across position groups: no bold, the pool sentence, the pool size in the narrow cell (" + name + ")", h.say.indexOf(want) === 0 && h.rows.every((r) => !r[0][1] && !r[1][1] && r.every((c) => / of \d+$/.test(c[2]))), h.say);
      continue;
    }
    h2hKinds.same++;
    const ar = h.ar.map((x) => x[0]), br = h.br.map((x) => x[0]);
    const aw = ar.filter((r, i) => r < br[i]).length, bw = br.filter((r, i) => r < ar[i]).length, m = h.say.match(/^(.+) ranks higher on (\d+) of (\d+) measures\./);
    const ok = m ? (m[1] === h.a ? aw : m[1] === h.b ? bw : -1) === +m[2] && +m[3] === ar.length && Math.max(aw, bw) === +m[2] && aw !== bw
      : aw === bw && (aw ? new RegExp("^Each ranks higher on " + aw + " measures? of " + ar.length + "\\.").test(h.say) : /^Neither ranks higher/.test(h.say));
    const rank = (t) => +String(t).match(/(\d+)(st|nd|rd|th)/)[1];
    A("head to head in one pool: the sentence and the bold cells follow the printed ranks (" + name + ")", ok && h.rows.every((r) => r[0][1] === rank(r[0][0]) < rank(r[1][0]) && r[1][1] === rank(r[1][0]) < rank(r[0][0])), h.say + " " + JSON.stringify([ar, br]));
  }
  A("the head to head was checked both within one pool and across pools", h2hKinds.same >= 2 && h2hKinds.cross >= 2, JSON.stringify(h2hKinds));
  /* every player page, each line: no percentile anywhere, the caption names the pool in words, and each headline built from
     ranks says what M.rank says (2026-10-20: a goaltender read "3rd in the league" above "1st of 18 goaltenders", two players
     on 71 points both read "2nd") */
  const pids = await p.evaluate(() => S2.M.players.filter((x) => x.roles.length).map((x) => [x.id, x.roles]));
  const prof = { pages: 0, bad: [], heads: 0, kinds: {} };
  for (const [id, roles] of pids) for (const role of roles) {
    await p.evaluate((h) => { location.hash = h; }, "#/player/" + id + "?role=" + role);
    await p.waitForFunction((x) => { const r = document.querySelector("#pfRoot"); return r && r.dataset.pid === x; }, id);
    const r = await p.evaluate(([id, role]) => {
      const M = S2.M, L = M.player(id).lines[role], out = [], kind = [];
      const root = document.querySelector("#pfRoot"), all = root.innerText + " " + Array.from(root.querySelectorAll("[aria-label],[title]")).map((x) => (x.getAttribute("aria-label") || "") + " " + (x.getAttribute("title") || "")).join(" ");
      if (/percentil/i.test(all)) out.push("prints a percentile");
      const lbl = (x) => x.label.replace(" (EA counts every lost puck)", "").replace(" (seconds)", "").toLowerCase();
      const rated = M.ranks(L).filter((x) => x.stat !== "sv_pg" && x.stat !== "sa_pg"), by = {}; rated.forEach((x) => { by[lbl(x)] = x; });
      const h = (document.querySelector("#pfPctH") || {}).textContent || "", sec = document.querySelector("#pfPctH") && document.querySelector("#pfPctH").closest("section");
      const lede = sec ? sec.querySelector("p").textContent : "", grp = { C: "centers", W: "wingers", D: "defense players", G: "goaltenders" }[L.group];
      let m;
      if (!rated.length || rated[0].few) { kind.push("not ranked"); if (h !== "Not ranked yet.") out.push("few but headed " + h); }
      else {
        if (lede.indexOf("ranks among " + rated[0].n + " " + grp + " with six or more games at the position") < 0) out.push("caption: " + lede);
        const ones = rated.filter((x) => x.rank === 1), best = Math.min.apply(null, rated.map((x) => x.rank));
        if ((m = h.match(/^(First|First or tied for first) among (.+) in (\d+) of (\d+) measures\.$/))) { kind.push("first"); if (m[2] !== grp || +m[3] !== ones.length || +m[4] !== rated.length || (m[1] !== "First") !== ones.some((x) => x.tied > 1)) out.push(h); }
        else if ((m = h.match(/^Top three among (.+) in (\d+) of (\d+) measures\.$/))) { kind.push("top three"); if (m[1] !== grp || +m[2] !== rated.filter((x) => x.rank <= 3).length || +m[3] !== rated.length) out.push(h); }
        else if ((m = h.match(/^Best at (.+): 1st of (\d+) (.+)\.$/))) { kind.push("best"); const x = by[m[1]]; if (!x || x.rank !== 1 || x.tied !== 1 || +m[2] !== x.n || m[3] !== grp) out.push(h); }
        else if ((m = h.match(/^Ranks highest in (.+): (.+) (\w[\w ]*)\.$/))) { kind.push("highest"); const x = by[m[1]]; if (!x || m[2] + " " + m[3] !== x.text.charAt(0).toLowerCase() + x.text.slice(1) + " " + grp || x.rank !== best) out.push(h); }
        else if ((m = h.match(/^((?:Tied for )?\d+(?:st|nd|rd|th) of \d+) (.+?) in (.+)\.$/))) { kind.push("plain"); const x = by[m[3]]; if (!x || m[1] !== x.text || m[2] !== grp) out.push(h); }
        else out.push("unparsed: " + h);
      }
      /* the season headline's league claims */
      const sh = (document.querySelector("#pfSeasonH") || {}).textContent || "";
      if ((m = sh.match(/save percentage, (.+) goaltenders\.$/))) { kind.push("sv rank"); const x = M.rank(L, "sv_pct"); if (!x || x.few || m[1] !== x.text.charAt(0).toLowerCase() + x.text.slice(1)) out.push(sh); }
      if ((m = sh.match(/points?, (tied for )?(\d+)(st|nd|rd|th) in the league\.$/))) { kind.push("points place"); const ls = M.leaders("p", 400, { role: "S", minGp: 1 }), me = ls.filter((x) => x.id === id)[0];
        if (!me || me.rank !== +m[2] || !!m[1] !== (ls.filter((x) => x.rank === me.rank).length > 1)) out.push(sh); }
      const sp = (document.querySelector("#pfSeasonH") && document.querySelector("#pfSeasonH").closest("section").querySelector("p") || {}).textContent || "";
      if (/The rank counts the/.test(sp) !== /save percentage, .+ goaltenders\.$/.test(sh)) out.push("pool sentence without its rank: " + sh + " / " + sp);
      if (/in the league\.$/.test(sh) && !/points?, (tied for )?\d+(st|nd|rd|th) in the league\.$/.test(sh)) out.push("unchecked league claim: " + sh);
      return { out, kind, heads: [h, sh] };
    }, [id, role]);
    prof.pages++; r.kind.forEach((k) => { prof.kinds[k] = (prof.kinds[k] || 0) + 1; });
    r.out.forEach((x) => prof.bad.push(id + " " + role + ": " + x));
  }
  console.log("\nprofile headlines by kind: " + JSON.stringify(prof.kinds));
  A("every player page prints ranks, never a percentile, and every rank headline is true", prof.pages > 150 && !prof.bad.length && prof.kinds.first && prof.kinds.highest && prof.kinds["sv rank"] && prof.kinds["points place"], prof.pages + " pages" + (prof.bad.length ? "; " + prof.bad.slice(0, 4).join(" || ") : ""));
  /* club ranks share a place when clubs are level at the precision shown */
  const cl = await p.evaluate(async () => { const out = [];
    for (const t of S2.M.teams) { location.hash = "#/club/" + t.code + "?tab=stats"; await new Promise((r) => setTimeout(r, 80));
      const tx = document.body.innerText; if (/percentil/i.test(tx)) out.push(t.code + " prints a percentile");
      const pp = tx.match(/Power play ([\d.]+)%, (tied for )?(\d+)(st|nd|rd|th) of (\d+)\./i), L = S2.M.standings("league");
      if (!pp) { out.push(t.code + " no power play line"); continue; }
      const mine = Math.round(+pp[1] * 10), better = L.filter((r) => Math.round(r.pp_pct * 10) > mine).length, level = L.filter((r) => Math.round(r.pp_pct * 10) === mine).length;
      if (+pp[3] !== better + 1 || !!pp[2] !== level > 1) out.push(t.code + " " + pp[0]); }
    return out; });
  A("club pages: power play place is true, ties shared, no percentile", !cl.length, cl.join(" | "));
  /* a club left with no goaltender is told once */
  const g3 = await p.evaluate(() => { const gs = S2.M.roster("DET").active.filter((x) => x.unit === "G" && !x.seat).map((x) => x.id);   /* the roster's goaltenders: a pool stand-in is never a club's to trade */ const e = S2.trade.evaluate({ from: "DET", to: "BOS", send: gs, get: [S2.M.roster("BOS").active.filter((x) => x.unit !== "G" && !x.seat)[0].id] }); return e.clubs ? e.clubs.DET.flags : null; });
  A("no goaltender left is said once", g3 && g3.filter((t) => /goaltender/.test(t)).length === 1, JSON.stringify(g3));
  /* a trade the office sent back says where the players are, never that it passes the check now */
  const rv = await p.evaluate((o) => S2.trade.detail(S2.trade.evaluate(o), {}), { from: even.from, to: even.to, send: even.send, get: even.get, status: "reversed" });
  A("a reversed trade does not read as passing the check now", !/Passes the roster and cap checks/.test(rv) && /sent back by the league office/.test(rv));
  /* the balance prints each club's value, the same in the live reading and the detail, and the share is rounded once */
  const bal = await p.evaluate((o) => { const e = S2.trade.evaluate(o), d = document.createElement("div"); d.innerHTML = S2.trade.compact(e, { me: o.from }) + S2.trade.detail(e, { me: o.from });
    return { rec: e.receives, ends: Array.from(d.querySelectorAll(".tr-l-v, .tr-r-v")).map((x) => x.textContent), labels: Array.from(d.querySelectorAll(".tr-bar")).map((x) => x.getAttribute("aria-label")) }; },
    deal(PK.G, PK.Gaway));
  const shares = bal.labels.map((l) => (l.match(/(\d+)%/g) || []).map((x) => parseInt(x, 10)));
  A("the ends print the value each club receives, the same in both views", bal.ends.join(",") === [bal.rec[PK.G.club], bal.rec[PK.Gaway.club], bal.rec[PK.G.club], bal.rec[PK.Gaway.club]].join(","), bal.ends.join(","));
  A("the share is rounded once (the two shares add to 100, the same in both views)", shares.length === 2 && shares.every((x) => x[0] + x[1] === 100) && shares[0].join() === shares[1].join(), JSON.stringify(shares));

  /* the profile compare sheet bolds by the same rule as the head to head (M.rankBetter), and every row prints its rank in
     visible words (review 2026-10-20: across groups it bolded 0.06 goals a game over 0.91, by the fuller bar, and the
     ranks lived only in a title a phone never shows) */
  const jid = PK.C2.pid, cmpTags = await p.evaluate((q) => ({ cross: S2.M.player(q[0]).tag, one: S2.M.player(q[1]).tag }), [PK.W.pid, PK.C.pid]);
  await p.evaluate((h) => { location.hash = h; }, "#/player/" + jid + "?role=S");
  await p.waitForFunction((x) => { const r = document.querySelector("#pfRoot"); return r && r.dataset.pid === x; }, jid);
  await p.click('[data-act="compare"]'); await p.waitForSelector("#pfCmpQ");
  const sheet = {};
  for (const [key, q] of [["cross", cmpTags.cross], ["one", cmpTags.one]]) {
    await p.fill("#pfCmpQ", q); await p.waitForSelector("#pfCmpL [data-pick]"); await p.click("#pfCmpL [data-pick]"); await p.waitForFunction((t) => (document.querySelector("#pfCmpBn") || {}).textContent === t, q);
    sheet[key] = await p.evaluate(() => Array.from(document.querySelectorAll("#pfCmpRows .pf-bf")).map((r) => ["va", "vb"].map((s) => { const v = r.querySelector(".pf-bf-" + s), k = v.querySelector(".pf-bf-rk");
      return { win: v.classList.contains("win"), rk: k ? k.textContent : null, shown: !!k && k.getBoundingClientRect().height > 0 && getComputedStyle(k).visibility !== "hidden" }; })));
  }
  await p.keyboard.press("Escape");
  const rkRe = /^(T-)?\d+(st|nd|rd|th) of \d+$/, num1 = (t) => +t.match(/\d+/)[0];
  A("compare sheet across position groups: nothing in bold, and every rank in visible words", sheet.cross.length >= 8 && sheet.cross.every((r) => r.every((c) => !c.win && c.shown && rkRe.test(c.rk))), JSON.stringify(sheet.cross.slice(0, 2)));
  A("compare sheet in one group: the bold follows the printed rank", sheet.one.length >= 8 && sheet.one.some((r) => r[0].win || r[1].win) && sheet.one.every((r) => r.every((c) => c.shown && rkRe.test(c.rk)) && r[0].win === num1(r[0].rk) < num1(r[1].rk) && r[1].win === num1(r[1].rk) < num1(r[0].rk)), JSON.stringify(sheet.one.slice(0, 2)));

  A("no console errors", !errs.length, errs.join(" | ").slice(0, 900));
  /* a player off every roster counts 0 in an offer, as CG.tPlayer finds rostered players only */
  const wv = await p.evaluate(() => { const gone = S2.M.players.filter((x) => !x.rostered && (x.lines.S || x.lines.G))[0], bos = S2.M.roster("BOS").active.filter((x) => !x.seat)[0];
    const e = S2.trade.evaluate({ from: "DET", to: "BOS", send: [gone.id], get: [bos.id] }); return { get: [bos.id], r: e.reading, rec: e.receives, html: S2.trade.detail(e, { me: "DET" }) }; });
  const wvWant = verdict(0, hand(wv.get[0]).value, "DET", "BOS");
  A("a player off every roster counts 0 in a pending offer, as the live reading counts them", wv.rec.BOS === 0 && wv.r.state === wvWant.state && wv.r.favors === wvWant.favors && wv.r.pct === wvWant.pct && /Not on a roster/.test(wv.html), wv.r.text + " " + JSON.stringify(wv.rec));

  /* ---------- audit 2026-11-09: the Season 2 cap and payroll, one definition ---------- */
  console.log("\n## Season 2 trade rules (audit 2026-11-09)");
  const s2 = await p.evaluate(() => {
    const M = S2.M, det = M.roster("DET").active.filter((x) => !x.seat && x.unit === "F")[0], bos = M.roster("BOS").active.filter((x) => !x.seat)[0];
    const chk = S2.trade.check({ from: "DET", to: "BOS", send: [det.id], get: [bos.id] }), pay = M.roster("DET").active.reduce((a, x) => a + (+x.salary || 0), 0);
    return { cap: M.RULES.s2.cap, csCap: S2.market.clubState("DET").cap, chkCap: chk.after.DET.cap, chkRoom: chk.after.DET.room, chkSquads: chk.placements.map((x) => x.squad).join(), pay, payDet: +det.salary || 0, payBos: +bos.salary || 0 };
  });
  /* the ruled $30M (v4.58), the seasons row liveOpen answers (the recording predates v4.58), read alike by the market's
     club state (S2.market.clubState), the model (M.RULES.s2.cap) and the trade check */
  A("the Season 2 cap is $30M, one definition read by the market and the trade check (commissioner, 2026-11-09)", s2.cap === 30000000 && s2.csCap === 30000000 && s2.chkCap === 30000000, [s2.cap, s2.csCap, s2.chkCap]);
  A("the trade check counts the active payroll, and every arrival joins the active roster", s2.chkRoom === s2.cap - (s2.pay - s2.payDet + s2.payBos) && /^(pro,?)+$/.test(s2.chkSquads), JSON.stringify(s2));
  await p.context().close();

  const noIds = await doorSuite(b, errs);
  A("the model's clubs carry their league ids, which js/trade.js reads for every door (M.team(code).id)", noIds && !noIds.length, "no id on " + (noIds || []).join(","));
  A("no page errors in the door checks", !errs.length, errs.join(" | ").slice(0, 900));
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL TRADE READING CHECKS PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
