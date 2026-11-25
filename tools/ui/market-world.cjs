/* v5.00 swap (i3e, 2026-11-25): the Season 2 market world the market, bidding and camp suites drive the REAL site with
   (tools/ui/mock in live mode: the page as the site build ships it, S2.LIVE true, signed in as a persona). Built at run
   time from the Season 2 recording: real clubs, and members' ids taken from the sign-ups (no name is written here). The
   reads answer as production's RLS would for each persona (a club its own bids while a lot runs, the office every bid,
   everyone the history of a lot that is over; requests the requesting club's, the player's and the staff's), the table
   reads with PostgREST's semantics (tools/ui/mock tables: filters, order, limit, id=gt paging, 42703 on an unknown
   column), and every write door changes the world as the database would or refuses in its own words. Nothing reaches
   production, writes anything or posts anything.
     const W = require("./market-world.cjs")(mock);
     const { ctx, p } = await W.open(browser, "gm", "#/bidding", { width: 375 });
     W.w.lots[0].price = ...;  W.calls(ctx, "market_bid");  W.reads  */
const fs = require("fs"), path = require("path"), os = require("os");

module.exports = function marketWorld(mock) {
  const PDIR = path.join(os.homedir(), "Developer/cghl-private/fixtures/personas");
  const BOOK = JSON.parse(fs.readFileSync(path.join(PDIR, "personas.json"), "utf8"));
  const body = (n) => JSON.parse(fs.readFileSync(path.resolve(PDIR, BOOK.shared.s2_league[String(n)]), "utf8"));
  const S1B = body(1), S2B = body(2);
  const S = S2B.seasons.find((s) => s.number === 2).id, ID = (code) => S2B.teams.find((t) => t.code === code).id;
  const CODE = (id) => (S2B.teams.find((t) => t.id === id) || {}).code;
  const GM = BOOK.personas.gm, MEMBER = BOOK.personas.member.profileId, STAFF = BOOK.personas.staff.profileId, MINE = CODE(GM.session.teamId);
  const others = S2B.teams.map((t) => t.code).filter((c) => c !== MINE).sort(), [CA, CB, CC, CD] = others;
  const uuid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  /* Eastern time: the night keys and the instants the database would compute */
  const etDay = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const etAt = (day, hm) => { for (const off of ["-05:00", "-04:00"]) { const t = Date.parse(day + "T" + hm + ":00" + off); if (new Date(t).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }).slice(0, 5) === hm) return t; } throw new Error("no Eastern instant for " + day + " " + hm); };
  const NOW = Date.now(), iso = (ms) => new Date(ms).toISOString();
  const TK = etDay(NOW + 86400000), BK = etDay(NOW), BK2 = etDay(NOW + 7 * 86400000), BK3 = etDay(NOW + 14 * 86400000);
  const ids = S2B.signups.map((s) => s.profile_id).filter((id) => id !== MEMBER && !Object.values(BOOK.personas).some((p) => p.profileId === id));
  const posOf = (id) => (S2B.signups.find((s) => s.profile_id === id) || {}).position || "C";
  const grp = (pos) => (/^(LD|RD|D)$/.test(pos) ? "D" : pos === "G" ? "G" : "F");
  const [L1, L2, L3, S1, S2P, W1, W2, F1] = ids;
  const G = { g1: uuid(901), g2: uuid(902), g3: uuid(903), g4: uuid(904) }, NIGHT = uuid(800);
  const game = (id, home, away, hm) => ({ id, home, away, week: 1, stage: "regular", status: "scheduled", voided: false, forfeit: null, went_ot: false, season_id: S,
    home_team_id: ID(home), away_team_id: ID(away), scheduled_at: iso(etAt(TK, hm)), home_score: null, away_score: null, created_at: iso(NOW) });
  const GAMES = [game(G.g1, MINE, CA, "21:00"), game(G.g2, CB, MINE, "21:35"), game(G.g3, MINE, CC, "22:10"), game(G.g4, CA, CD, "21:00")];
  /* the season's rules as season_rules(Season 2).mk answers on production (read 2026-11-25): the harness's one copy, which
     its live defaults answer too (i3f) */
  const MK = Object.assign({}, mock.MARKET_RULES);

  const lot = (id, pid, ord, gp, state, more) => Object.assign({ id, season_id: S, night_id: NIGHT, profile_id: pid, position: posOf(pid), ord, gp_at_open: gp, state, price: null, bids: 0, last_bid_at: null,
    ends_at: null, paused_remaining: null, sold_team_id: null, sold_at: null, ended_at: null, why: null }, more || {});
  const bid = (n, lotId, code, seq, amount, at) => ({ id: uuid(n), lot_id: lotId, night_id: NIGHT, team_id: ID(code), seq, amount, placed_at: iso(at) });
  const req = (n, gameIdx, code, pid, status, at, more) => Object.assign({ id: uuid(n), season_id: S, game_id: GAMES[gameIdx].id, team_id: ID(code), profile_id: pid, game_at: GAMES[gameIdx].scheduled_at,
    created_at: iso(at), status, answered_at: status === "pending" ? null : iso(at + 100e3), ended_at: null, note: null }, more || {});
  /* a Season 2 roster spot as s2_league serves it */
  const spot = (n, code, pid) => ({ id: uuid(n), team: code, squad: "pro", origin: "assigned", salary: 750000, status: "active", team_id: ID(code), on_block: false, position: posOf(pid), created_at: iso(NOW), profile_id: pid, jersey_number: 99 });
  const boardRow = (pid, rank, ceiling, note, at) => ({ season_id: S, team_id: null, profile_id: pid, rank, ceiling: ceiling == null ? null : ceiling, note: note || null, updated_at: iso(at || NOW) });
  /* the world the reads answer from and the writes change */
  /* every reset counts its clocks from its own now, so a countdown set at the start of a long suite is still running at its end */
  function fresh() {
    const NOW = Date.now();
    const pool = (id, gp, src, last) => ({ profile_id: id, position: posOf(id), pos_group: grp(posOf(id)), gp, needs: Math.max(0, 6 - gp), eligible: gp >= 6, suspended: false, source: src, last_team_id: last ? ID(last) : null, available_next: null });
    return {
      pool: [pool(L1, 9, "undrafted"), pool(L2, 7, "undrafted"), pool(S1, 2, "late"), pool(S2P, 1, "undrafted"), pool(MEMBER, 3, "undrafted")],
      wire: [{ id: uuid(701), season_id: S, profile_id: W1, from_team_id: ID(CA), position: posOf(W1), salary: 1000000, waived_at: iso(NOW - 3600e3), expires_at: iso(NOW + 20 * 3600e3), status: "open", claimed_team_id: null, claimed_at: null, cleared_at: null },
        { id: uuid(702), season_id: S, profile_id: W2, from_team_id: ID(MINE), position: posOf(W2), salary: 2000000, waived_at: iso(NOW - 7200e3), expires_at: iso(NOW + 19 * 3600e3), status: "open", claimed_team_id: null, claimed_at: null, cleared_at: null }],
      nights: [{ id: NIGHT, season_id: S, night: BK, opens_at: iso(NOW - 600e3), new_until: iso(NOW + 3000e3), state: "live", paused_at: null, closed_at: null }],
      lots: [lot(uuid(601), L1, 1, 9, "open"),
        lot(uuid(602), L2, 2, 7, "running", { price: 1000000, bids: 2, last_bid_at: iso(NOW - 60e3), ends_at: iso(NOW + 240e3) }),
        lot(uuid(603), L3, 3, 6, "sold", { price: 750000, bids: 1, last_bid_at: iso(NOW - 500e3), ends_at: iso(NOW - 200e3), sold_team_id: ID(CA), sold_at: iso(NOW - 200e3), ended_at: iso(NOW - 200e3) })],
      bids: [bid(501, uuid(602), MINE, 1, 750000, NOW - 120e3), bid(502, uuid(602), CB, 2, 1000000, NOW - 60e3), bid(503, uuid(603), CA, 1, 750000, NOW - 500e3)],
      reqs: [req(401, 0, MINE, MEMBER, "pending", NOW - 900e3), req(402, 3, CA, S1, "accepted", NOW - 800e3)],
      board: { [MINE]: [boardRow(L1, 1, 1500000, "first target", NOW - 86400e3)] },
      /* draftDone: the default world is Season 2 under way, the draft complete; false is the schedule set with the draft
         still to come (QA round 2). The calendar's draft_done and the league read's draft both follow it */
      calendar: null, rules: MK, spots: [], draftDone: true,
      /* a club's roster as market_club_state counts it: nine active and $20M by default; active[code] overrides the count
         and signed[code] lists the players the club signed tonight ({ pid, amt }) */
      active: {}, signed: {}
    };
  }
  const X = { w: fresh() };
  /* market_club_state as the database computes it from the world: the active roster against twelve and the $30M cap, and
     the running lots whose newest bid is the club's (the leads the cap and the spots count) */
  function topOf(l) { return X.w.bids.filter((b) => b.lot_id === l.id).sort((a, b) => b.seq - a.seq)[0] || null; }
  function cs(code) {
    const W = X.w, signed = W.signed[code] || [], active = (W.active[code] != null ? W.active[code] : 9) + signed.length;
    const payroll = 20000000 + signed.reduce((a, x) => a + x.amt, 0), spots = Math.max(0, 12 - active), room = 30000000 - payroll;
    const leading = W.lots.filter((l) => l.state === "running" && topOf(l) && topOf(l).team_id === ID(code)).map((l) => ({ lot_id: l.id, amount: topOf(l).amount }));
    const committed = leading.reduce((a, x) => a + x.amount, 0);
    return { team_id: ID(code), season_id: S, counts: { F: active - 4, D: 3, G: 1 }, active, limit: 12, mins: { F: 3, D: 2, G: 1 }, cap: 30000000, payroll, room, spots,
      gap: { F: 0, D: 0, G: 0, short: 0, open: spots }, owed: 0, draft_done: W.draftDone !== false, moves_locked: false, leading, committed, free_spots: spots - leading.length, free_room: room - committed };
  }
  const cut = (bd, a) => { if (!a.p_sections) return bd; const o = { generated: bd.generated, source: bd.source, season: bd.season, sections: a.p_sections, pulse: bd.pulse }; a.p_sections.forEach((s) => { o[s] = bd[s]; }); return o; };
  const reads = [];
  /* production on 2026-11-24: the draft not done, no schedule, so no nights and no deadline */
  const EMPTY_CAL = { season_id: S, market: true, deadline: null, moves_locked: false, draft_done: false, game_nights: [], bid_nights: [], next_bid_night: null };
  function calendar() {
    const W = X.w;
    if (W.calendar) return W.calendar;
    /* W.deadline: a world whose bidding opens later than twenty days out keeps its movement deadline after it (QA round 2 nit) */
    return { season_id: S, market: true, deadline: iso(W.deadline || NOW + 20 * 86400e3), moves_locked: false, draft_done: W.draftDone !== false,
      /* W.locked: the night's lineup lock has passed (its first puck drop still ahead), so requests are closed and public */
      game_nights: [{ night: TK, week: 1, stage: "regular", games: 4, first_puck: iso(W.locked ? Date.now() + 30 * 60e3 : etAt(TK, "21:00")), lock_at: iso(W.locked ? Date.now() - 60e3 : etAt(TK, "20:30")) }],
      /* tonight's bid night: the row the database opened (W.nights), or before 9 PM the night still to open (W.opens) */
      bid_nights: [W.nights[0] ? { night: BK, skipped: false, why: null, opens_at: W.nights[0].opens_at, new_until: W.nights[0].new_until, id: NIGHT, state: W.nights[0].state, paused: !!W.nights[0].paused_at }
        : { night: BK, skipped: false, why: null, opens_at: iso(W.opens), new_until: iso(W.opens + 3600e3), id: null, state: "upcoming", paused: false },
        { night: BK2, skipped: true, why: "No league games that week, so no bidding.", opens_at: iso(etAt(BK2, "21:00")), new_until: iso(etAt(BK2, "22:00")), id: null, state: "skipped", paused: false },
        { night: BK3, skipped: false, why: null, opens_at: iso(etAt(BK3, "21:00")), new_until: iso(etAt(BK3, "22:00")), id: null, state: "upcoming", paused: false }],
      next_bid_night: W.nights[0] && W.nights[0].state === "closed" ? BK3 : BK };
  }
  /* the read RPCs, as each persona would get them */
  function rpcs(persona) {
    const office = persona === "commissioner", mine = persona === "gm" ? ID(MINE) : null;
    const r = (name, fn) => (a) => { reads.push(name); return mock.ok(fn(a || {})); };
    return {
      /* Season 2 with tonight's games, any roster spot a check adds (W.spots), and the Season 2 row as production holds it
         on 2026-11-25 (v4.58: cap $30M, roster 12, 10 rounds; the recording was made before it) */
      s2_league: r("s2_league", (a) => (a.p_season === 1 ? cut(S1B, a) : cut(Object.assign({}, S2B, { games: GAMES,
        seasons: S2B.seasons.map((x) => (x.number === 2 ? Object.assign({}, x, { salary_cap: 30000000, roster_max: 12, draft_rounds: 10 }) : x)),
        rosters: Object.assign({}, S2B.rosters, { spots: (S2B.rosters.spots || []).concat(X.w.spots || []) }),
        /* QA round 2 (2026-11-25): ONE world. After the draft (the calendar's draft_done) the league read's draft is complete
           too, as production's draft_state would be; the recorded draft (none yet) only while the calendar says before it.
           The desk read the recorded state as before the draft while the market said after it (ports 14/17) */
        draft: calendar().draft_done ? { state: { status: "complete", season_number: 2 }, picks: [] } : S2B.draft }), a))),
      current_season_id: r("current_season_id", () => S),
      market_calendar: r("market_calendar", () => calendar()),
      season_rules: r("season_rules", () => Object.assign({ format: "basic", roster_max: 12, salary_cap: 30000000 }, X.w.rules ? { mk: X.w.rules } : {})),
      market_pool: r("market_pool", () => X.w.pool),
      market_club_state: r("market_club_state", (a) => (persona === "gm" || office ? Object.assign(cs(CODE(a.p_team)), mine && a.p_team !== mine && !office ? { leading: undefined } : {}) : null))
    };
  }
  /* the table reads: rows as RLS would show them to this persona; the mock applies the query itself */
  function tables(persona) {
    const office = persona === "commissioner", mine = persona === "gm" ? ID(MINE) : null, me = BOOK.personas[persona].profileId;
    const t = (fn) => (q) => { const u = new URL(q.url); reads.push(q.table + "?" + u.searchParams.toString()); return fn(q, u); };
    return {
      market_waivers: t(() => X.w.wire),
      market_bid_nights: t(() => X.w.nights),
      market_lots: t(() => X.w.lots),
      market_bids: t(() => X.w.bids.filter((x) => { const l = X.w.lots.find((y) => y.id === x.lot_id); return office || x.team_id === mine || /sold|unsold|void/.test(l.state); })),
      /* the requesting club's, the player's and the staff's until the night's lock, everyone's after it */
      market_pool_requests: t(() => X.w.reqs.filter((q) => X.w.locked || office || persona === "staff" || q.team_id === mine || q.profile_id === me)),
      market_boards: t((q, u) => { const team = String(u.searchParams.get("team_id") || "").slice(3), code = CODE(team);
        return office || team === mine ? (X.w.board[code] || []).map((x) => Object.assign({}, x, { team_id: team })) : []; })
    };
  }
  /* the writes: each door changes the world as the database would, or refuses in the database's own words */
  const hold = { on: false };
  const later = (v) => new Promise((res) => setTimeout(() => res(v), hold.on ? 600 : 0));
  function writes() {
    const W = () => X.w;
    return {
      market_claim: (a) => { const w = W().wire.find((x) => x.id === a.p_waiver); w.status = "claimed"; w.claimed_team_id = a.p_team; w.claimed_at = iso(Date.now()); return later(mock.ok({ ok: true })); },
      market_bid: (a) => {
        const l = W().lots.find((x) => x.id === a.p_lot), next = l.price == null ? MK.bid_open : l.price + MK.bid_step;
        if (a.p_expect !== next) return mock.fail("23514", "The price moved to $" + (next / 1e6).toFixed(2) + "M. Check it and bid again.", "price_moved");
        /* the rules market_bid holds (sql v4.59): no two bids in a row, and a spot and cap room counting the bids led */
        const top = topOf(l), c = cs(CODE(a.p_team));
        if (top && top.team_id === a.p_team) return mock.fail("23514", "You hold the top bid. Another club must bid before you can bid on this player again (Rule S2.6).", "own_top");
        if (c.free_spots < 1) return mock.fail("23514", "Your club's active roster has no open spot: " + c.active + " of 12 active, counting the bids it leads (Rule S2.4).", "no_spot");
        l.price = next; l.bids += 1; l.state = "running"; l.ends_at = iso(Date.now() + 300e3);
        W().bids.push({ id: uuid(510 + W().bids.length), lot_id: l.id, night_id: NIGHT, team_id: a.p_team, seq: l.bids, amount: next, placed_at: iso(Date.now()) });
        return later(mock.ok({ ok: true, lot_id: l.id, amount: next, seq: l.bids }));
      },
      /* as sql v4.59 does: the board is replaced whole, and ONE row whose player is neither in the pool nor on an open
         waiver refuses the whole save (the trap of review 2026-11-24) */
      save_market_board: (a) => {
        const out = a.p_rows.find((x) => !W().pool.some((q) => q.profile_id === x.profile_id) && !W().wire.some((w) => w.profile_id === x.profile_id && w.status === "open"));
        if (out) return mock.fail("23514", "That player is not in the training camp pool or on waivers.", "not_in_pool");
        W().board[CODE(a.p_team)] = a.p_rows.map((x, i) => boardRow(x.profile_id, i + 1, x.ceiling, x.note, Date.now())); return mock.ok(a.p_rows.length);
      },
      market_pool_request: (a) => { const gi = GAMES.findIndex((g) => g.id === a.p_game); W().reqs.push(req(410 + W().reqs.length, gi, CODE(a.p_team), a.p_profile, "pending", Date.now())); return mock.ok({ ok: true, status: "pending" }); },
      market_pool_withdraw: (a) => { const q = W().reqs.find((x) => x.id === a.p_request); q.status = "withdrawn"; q.ended_at = iso(Date.now()); return mock.ok({ ok: true, status: "withdrawn" }); },
      market_pool_answer: (a) => { const q = W().reqs.find((x) => x.id === a.p_request); q.status = a.p_accept ? "accepted" : "declined"; q.answered_at = iso(Date.now()); return later(mock.ok({ ok: true, status: q.status })); },
      market_pause: () => { W().nights[0].paused_at = iso(Date.now()); W().lots.forEach((l) => { if (l.state === "running") { l.paused_remaining = "00:04:00"; l.ends_at = null; } }); return mock.ok({ ok: true }); },
      market_resume: () => { W().nights[0].paused_at = null; W().lots.forEach((l) => { if (l.paused_remaining) { l.ends_at = iso(Date.now() + 240e3); l.paused_remaining = null; } }); return mock.ok({ ok: true }); },
      market_void_lot: (a) => { const l = W().lots.find((x) => x.id === a.p_lot); l.state = "void"; l.why = "Withdrawn by the league office."; l.ended_at = iso(Date.now()); return mock.ok({ ok: true, state: "void" }); },
      waive_player: (a, info) => (info.calls.filter((c) => c.rpc === "waive_player").length === 1
        ? later(mock.fail("23514", "Waiving that player would leave your club short of the Season 2 roster minimums of 3 forwards, 2 defensemen and 1 goaltender.", "below_minimum"))
        : later(mock.ok({ ok: true })))
    };
  }
  /* the night's phases: before 9 PM (no night opened yet, the lots a preview of the eligible pool), after 10 PM with the
     last countdowns running, and closed (each lot's last state as given) */
  function before(inMs) { const W = X.w; W.nights = []; W.lots = []; W.bids = []; W.opens = Date.now() + (inMs || 2 * 3600e3); return W; }
  function closing() { const n = X.w.nights[0]; n.state = "closing"; n.opens_at = iso(Date.now() - 3700e3); n.new_until = iso(Date.now() - 100e3); return X.w; }
  function closed() { const n = X.w.nights[0]; n.state = "closed"; n.opens_at = iso(Date.now() - 4000e3); n.new_until = iso(Date.now() - 400e3); n.closed_at = iso(Date.now() - 60e3); return X.w; }
  /* a lot sold to a club: the lot over, the club's roster and payroll carrying the player */
  function sell(l, code, amt) {
    l.state = "sold"; l.price = amt; l.sold_team_id = ID(code); l.sold_at = l.ended_at = iso(Date.now()); l.ends_at = iso(Date.now() - 1000);
    (X.w.signed[code] = X.w.signed[code] || []).push({ pid: l.profile_id, amt });
  }
  /* every club a Season 2 roster for the desk checks: f forwards, d defense and g goaltenders each, from the sign-ups the
     market does not use, with a count per club where a check needs one ({ CODE: { F, D, G } }) */
  function fill(f, d, g, over) {
    const used = new Set([L1, L2, L3, S1, S2P, W1, W2, F1].concat(X.w.pool.map((x) => x.profile_id))), by = { F: [], D: [], G: [] };
    ids.filter((id) => !used.has(id)).forEach((id) => by[grp(posOf(id))].push(id));
    let n = 3000;
    S2B.teams.forEach((t) => {
      const want = Object.assign({ F: f, D: d, G: g }, (over || {})[t.code] || {});
      ["F", "D", "G"].forEach((u) => { for (let i = 0; i < want[u]; i++) { const pid = by[u].shift(); if (!pid) throw new Error("market-world: not enough " + u + " sign-ups to fill the rosters"); X.w.spots.push(spot(n++, t.code, pid)); } });
    });
    return X.w.spots;
  }
  /* a crowded room for the layout checks: n more eligible pool players, each a lot (every third running, every fifth sold) */
  function crowd(n) {
    const NOW = Date.now();
    const W = X.w, used = new Set(W.pool.map((x) => x.profile_id).concat(W.lots.map((x) => x.profile_id), W.wire.map((x) => x.profile_id), [F1, W1, W2]));
    const more = ids.filter((id) => !used.has(id)).slice(0, n);
    more.forEach((id, i) => {
      W.pool.push({ profile_id: id, position: posOf(id), pos_group: grp(posOf(id)), gp: 6 + (i % 5), needs: 0, eligible: true, suspended: false, source: "undrafted", last_team_id: null, available_next: null });
      if (!W.nights.length) return;
      const k = 1000 + i, running = i % 3 === 0, sold = i % 5 === 1;
      W.lots.push(lot(uuid(k), id, 10 + i, 6 + (i % 5), running ? "running" : sold ? "sold" : "open", running ? { price: 1000000, bids: 2, last_bid_at: iso(NOW - 30e3), ends_at: iso(NOW + 200e3 + i * 1000) }
        : sold ? { price: 750000, bids: 1, sold_team_id: ID(CD), sold_at: iso(NOW - 100e3), ended_at: iso(NOW - 100e3), ends_at: iso(NOW - 100e3) } : {}));
      if (running) { W.bids.push(bid(k * 10, uuid(k), CB, 1, 750000, NOW - 60e3)); W.bids.push(bid(k * 10 + 1, uuid(k), CC, 2, 1000000, NOW - 30e3)); }
      if (sold) W.bids.push(bid(k * 10, uuid(k), CD, 1, 750000, NOW - 120e3));
    });
    return more;
  }
  const errs = [];
  /* a context on the real site as persona, opened at hash, once the market has been read (or said it could not be) */
  async function open(b, persona, hash, o) {
    o = o || {};
    /* o: width, height, ctx (more context options: hasTouch, isMobile, reducedMotion, colorScheme), theme (the site's own
       light or dark choice), quiet (console errors a check causes on purpose), rpcs and tables (more reads a page outside
       the market makes), wait (false: the page is not a market page, so do not wait for the market's read) */
    const ctx = await b.newContext(Object.assign({ viewport: o.width ? { width: o.width, height: o.height || 812 } : { width: 1280, height: o.height || 900 } }, o.ctx || {}));
    await ctx.addInitScript((theme) => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" }));
      if (theme) localStorage.setItem("s2.theme", JSON.stringify(theme)); } catch (e) {} }, o.theme || null);
    await mock.install(ctx, Object.assign({ live: true, persona, rpcs: Object.assign(rpcs(persona), o.rpcs || {}), tables: Object.assign(tables(persona), o.tables || {}), writes: writes() }, o.session ? { session: o.session } : {}));
    const p = await ctx.newPage();
    /* fail fast: a page that stops responding fails its step in two minutes instead of hanging the run */
    const ev = p.evaluate.bind(p);
    p.evaluate = (fn, arg) => Promise.race([ev(fn, arg), new Promise((_, rej) => setTimeout(() => rej(new Error("the page stopped responding: one step ran past 120 s")), 120000))]);
    p.on("console", (m) => { if (m.type() === "error" && !(o.quiet && o.quiet.test(m.text()))) errs.push(persona + ": " + m.text()); });
    p.on("pageerror", (e) => errs.push(persona + ": pageerror: " + e.message));
    await p.goto(process.env.S2_BASE + hash);
    await p.waitForFunction((w) => window.S2 && S2.LIVE && S2.market && (!w || S2.market.status().loaded || S2.market.status().error) && S2.$("#page") && S2.$("#page").children.length > 0, o.wait !== false, { timeout: 20000 });
    /* every market read the page finishes is counted, so a check can wait for the next one (pulse) */
    await p.evaluate(() => { window.__loads = 0; S2.market.on((e) => { if (e.type === "load") window.__loads++; }); });
    await p.waitForTimeout(150);
    return { ctx, p };
  }
  /* the league marks the market (live.js's pulse): the page reads the market again; resolves once that read has landed
     and the page has repainted from it */
  async function pulse(p) {
    const n = await p.evaluate(() => window.__loads);
    await p.evaluate(() => S2.live.emit("market", {}));
    await p.waitForFunction((k) => window.__loads > k, n, { timeout: 5000 });
    await p.waitForTimeout(80);
  }
  return Object.assign(X, {
    BOOK, S1B, S2B, S, ID, CODE, MINE, CA, CB, CC, CD, MEMBER, STAFF, uuid, iso, NOW, TK, BK, BK2, BK3, L1, L2, L3, S1, S2P, W1, W2, F1, G, NIGHT, GAMES, MK, EMPTY_CAL,
    posOf, grp, boardRow, req, bid, spot, fresh, before, closing, closed, sell, crowd, fill, topOf, ids, reset: () => { X.w = fresh(); return X.w; }, reads, hold, writes, rpcs, tables, open, pulse, errs,
    calls: (ctx, rpc) => mock.calls(ctx).filter((c) => !rpc || c.rpc === rpc),
    txt: (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel),
    settled: (p) => p.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 5000 }).then(() => p.waitForTimeout(150))
  });
};
