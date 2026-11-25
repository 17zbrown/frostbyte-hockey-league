/* CGHL Season 2: S2.market, the Season 2 player market (the league-wide training camp pool, waivers, bid boards, per-game
   pool requests and the Saturday bid room), read from the league's own market (sql v4.58 waivers, v4.59 bid nights and
   pool requests) and written only through its database doors. Spec: briefs/market-spec.md (lead, 2026-11-02).
   The commissioner, 2026-11-02 (binding): "Only training camp players with at least 6 games played can be bid on at the
   saturday bidding events. Rostered players can be sent down to the league training camps only after being placed on
   waivers. Any team can pick up a player placed on waivers up to 24 hours after they have been waived, like real life.
   Their salary cap and roster space needs to comply to be able to be waived. Teams must not waive inactive players but
   should report them to league staff", "bids always start at 750k and can only be raised by 250k at a time. a team
   cannot place two bids in a row on the same player. They need to wait for another team to bid in order to raise their
   own bid on a player.", "a team cannot place a bid on a player that would take them over their salary cap." and "I do
   want it to have its own tab similar to the trades where teams can set bid boards throughout the season on the
   different camp players before the upcoming Saturday bid nights."
   The lead's readings (spec, "my call"): a waiver claim is first come, first served; the CLAIMING club needs the spot and
   the cap room; the cap and the spots count every bid a club leads; every eligible pool player is open from 9:00 PM;
   no auto-bidding (a board is a plan, never a proxy bidder); Season 2 payroll is the ACTIVE roster (Season 2 has no club
   camps). The database enforces every one of them; this file computes no rule a door relies on.
   v5.00 swap (i3e, 2026-11-25): the market's demo engine, its sample clock, rival bidders, availability marks and
   Discord previews are gone; this is the league's market only, on every page that reads it.

   API (every read is pure and safe in render(); nothing throws on a bad id)
   ---------------------------------------------------------------------------------------------------------------
   Problems are { code, text, hard: true, club, pid }: code is the database's hint (else its error code), text its own
   sentence. Times are ms. Money is dollars. A club is a code ("DET").
   Loading
     S2.market.ensure() -> Promise<bool>   reads the market the first time a page asks, and again for a new viewer (sign-in,
                                        sign-out, another club); never rejects, and never retries a failed read (the pulse
                                        does). reload(roomOnly) reads again
     S2.market.status() -> { loaded, error (text | null), draftDone, schedule, movesLocked }   a page says a failed read
                                        (fail loud), never an empty list that reads as "none"
     S2.market.watchRoom()              Realtime on the nights, lots and bids, for the bid room (one channel a session)
   Events
     S2.market.on(fn) -> off()        fn({ type, detail }); also a "s2:market" CustomEvent on document, same detail.
       types: load ({ ok }: a read finished; pages repaint in place), tick (once a second; { now }: countdown text only)
   The season's rules (season_rules(season).mk, read with the market; null until the first read lands)
     MIN (mk.bid_open, the opening bid), STEP (mk.bid_step, every raise), SIX (mk.bid_gp, games to be bid on), LOT_MS
     (mk.lot_seconds), WAIVER_MS (mk.waiver_hours), deadline (the movement deadline, market_calendar)
   Calendar (market_calendar: the schedule and movement_deadline_at, never a date written here)
     gameNights() -> [Night]  { key "2026-12-16", label "Wednesday, December 16", short, week, at (first puck drop), ends
                              (11:30 PM), lockAt (night_lock_at), games }
     tonight() -> Night + { state: "before" | "live" | "done", requestsCloseAt, publicAt } | null: the lock, 30 minutes
                              before the night's first puck drop, closes requests, withdrawals and answers and makes a
                              request public (until then the requesting club, the player and the staff see it)
     bidNights() -> [BidNight] { key, label, short, opens, newUntil, skipped, why (skipped only), id, state, paused }
     nextBidNight() -> BidNight | null
   Pool and requests (Rule S2.5)
     pool() -> [Pool] by rating;  poolPlayer(pid) -> Pool | null;  inPool(pid) -> bool;  poolMe() -> the member signed
       in when they are in the pool or have a request, else null
       Pool = { pid, player, tag, pos, unit, ovr, gp, needs, eligible, suspended, source, lastClub, tonight: { available,
                requestedBy (the club whose game they accepted), games, asked (clubs waiting for an answer) }, nightsPlayed }
     asks(club?) / asksFor(pid) -> [{ id, pid, club, game (1, 2, 3: its place in the club's night), gameId, time, night,
       at, state: pending | accepted | declined | withdrawn | closed | lapsed, why }]
     requests(club?) -> [{ pid, club, night, at, games }] accepted tonight;  gamePlayers(club, k) -> [pid];  fillIns(pid)
     clubGames(club, nightKey?) -> [{ k, id, at, opp }]
     request(pid, { club, game | gameId }), release(pid, { club, game }) (withdraws a request or releases an accepted
       guest until the lock), accept(pid, { club, game, id }), decline(pid, { club, game, id }) (false on an accepted
       request withdraws the acceptance until the lock)
     lineupProblems(club, pids) -> problems: at least M.RULES.s2.ownMin of a lineup's players are the club's own (the
       half rule; set_game_lineup is the door that enforces it)
   Waivers
     waivers() -> open ones, soonest to run out first;  waiver(pid) -> the player's latest | null
       { id, pid, player, tag, from, salary, at, until, left, claimable, claimedBy, claimedAt, expired, voided }
     claim(pid, { club }), waive(pid, { notInactive }) (Owner approval routed by mgmt_gate), waiveDoor(pid): the ruled
       confirm popup every page uses to waive
   Bid boards (a club's private plan: its front office and the league office only; never a proxy bidder)
     board(club) -> [{ pid, player, tag, rank, ceiling, note, at, state: pool | waivers | signed | gone, signedBy,
       eligible, needs, gp }];  onBoard(club, pid);  boardAdd(club, pid, { ceiling, note }), boardSet, boardRemove,
       boardMove(club, pid, toRank): saved whole through save_market_board, one save at a time
   Club state
     clubState(code) -> { code, team, active: { F, D, G, total }, limit, spots, payroll, cap, room, leading: [{ pid, amt }],
       committed, freeSpots, freeRoom, mins } | null: the database's (market_club_state) for the acting club; the
       model's roster for another club, never its leads (Rule S2.6 keeps the bidders hidden)
   The room (Rule S2.6)
     room(nightKey?, { as }) -> { key, id, night, state: before | live | closing | closed, now, opens, newUntil, paused,
       left, lots: [Lot], running, sold, unsold, open, voided, recap } | null
       Lot = { id, pid, player, tag, pos, ovr, gp, state: open | running | sold | unsold | void, price, next (the exact
               next bid, from the season's opening price and step; null when it can take no bid), bids, history: [{ amt,
               at, mine, club (null until the lot is over) }], endsAt, left, mine, soldTo, why, board }
     onLot(pid) -> { key, state } | null;  recap(nightKey) -> { night, sold, unsold, voided, total, text } | null
     bid(pid, { club, expect }) (market_bid refuses a moved price, never pays more), pauseBidding({ reason }),
       resumeBidding(), bidPause() -> { at, by, key } | null, voidLot(pid, reason) (the Draft and Bidding manager or a
       commissioner; can_run_market decides)
   Who acts: club() is the seat holder's own club, or the club a commissioner chose with setClub(code) ("" or null:
     back to watching); everyone else watches.
   Every action returns a Promise of { ok, problems, data, queued } and resolves only after the database answered. */
(function () {
  "use strict";
  var S2 = window.S2, M = S2 && S2.M;
  if (!M) { console.error("S2.market needs S2.M: load js/market.js after js/model.js"); return; }

  var MIN_MS = 60000;
  var NUMW = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  function words(n) { return NUMW[n] || String(n); }
  function iso(ms) { return new Date(ms).toISOString(); }
  function longDay(ms) { return M.etLong(iso(ms)); }                       /* "Saturday, December 19" */
  function dayMonth(ms) { return longDay(ms).replace(/^\w+, /, ""); }      /* "December 19" */
  function P(pid) { return M.player(pid); }
  function team(code) { return M.team(code); }
  function up(code) { return code ? String(code).toUpperCase() : ""; }
  function full(code) { var t = team(code); return t ? t.full : String(code || "a club"); }
  function num(x) { return typeof x === "number" && isFinite(x) ? x : 0; }
  function prob(code, text, hard, club, pid) { return { code: code, text: text, hard: !!hard, club: club || null, pid: pid || null }; }
  function list(names) { return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]; }
  function byRating(a, b) { return (b.ovr || 0) - (a.ovr || 0) || b.gp - a.gp || String(a.tag).localeCompare(String(b.tag)); }

  /* ---------- events ---------- */
  function emit(type, detail) { document.dispatchEvent(new CustomEvent("s2:market", { detail: { type: type, detail: detail || {} } })); }
  function on(fn) { var h = function (e) { fn(e.detail); }; document.addEventListener("s2:market", h); return function () { document.removeEventListener("s2:market", h); }; }

  /* another club's figures, from the model's roster (the season's limit, cap and minimums): spots and room only, never
     its leads, which market_club_state shows only to that club and the office */
  function stateOf(code) {
    var r = M.roster(code); if (!r) return null;
    var s2 = M.RULES.s2, act = r.counts.active, spots = Math.max(0, s2.limit - act.total), room = s2.cap - r.payroll.active;
    return { code: code, team: r.team, active: { F: act.F, D: act.D, G: act.G, total: act.total }, limit: s2.limit, spots: spots, payroll: r.payroll.active, cap: s2.cap, room: room,
      leading: [], committed: 0, freeSpots: spots, freeRoom: room, mins: { F: s2.min.F, D: s2.min.D, G: s2.min.G } };
  }
  /* the lineup half rule, one definition (PROPOSED 2026-11-23): Team HQ asks it before a sheet is filed */
  function lineupProblems(club, pids) {
    var code = up(club), r = M.roster(code), own = {}, picked = (pids || []).filter(Boolean);
    (r ? r.active : []).forEach(function (p) { own[p.id] = 1; });
    var pool = picked.filter(function (id) { return !own[id]; }), need = M.RULES.s2.ownMin;
    /* "at least half the game lineup": own players at least half the sheet, three of a full six */
    return (picked.length - pool.length) * 2 >= picked.length ? [] : [prob("own_half", "At least half of a lineup, " + words(need) + " of its six players, must be on the club's own roster, and this one has " + words(pool.length) + " training camp pool players. Swap one for a rostered player (Rule S2.5).", true, code)];
  }
  /* the night's sentence: who signed, how many returned to the pool, and the lots that ended with no sale */
  function recapOf(key, b, nights, sold, unsold, voided) {
    var total = sold.reduce(function (a, s) { return a + s.amt; }, 0);
    var nb = nights.filter(function (x) { return !x.skipped && x.opens > b.opens; })[0];
    var text = "Saturday bidding, " + dayMonth(b.opens) + ": " + (sold.length ? (sold.length === 1 ? "one player" : words(sold.length) + " players") + " signed for " + M.money(total) + " in all" : "no player signed") +
      (unsold ? ", and " + (unsold === 1 ? "one" : words(unsold)) + " returned to the pool, still eligible" + (nb ? " for " + nb.label : "") : "") + "." +
      /* a called-off lot is neither a signing nor a return to the pool; its reason may be the league office's withdrawal,
         so it is said plainly */
      (voided.length ? " The bidding on " + list(voided.map(function (v) { return v.tag; })) + " ended without a sale." : "");
    return { night: key, sold: sold, unsold: unsold, voided: voided, total: total, text: text };
  }


  /* ---------- the reads ----------
     The market is not an s2_league section, so this file reads it itself (live.js: "market by the bid room"), with the
     public key and the member's own token, so RLS decides what comes back: a club reads its own bids while a lot runs and
     every bid once it is over; pool requests are the requesting club's, the player's and the staff's until the night's
     lock and everyone's after it; a board is its club's and the office's. A page asks for the market with ensure()
     (nothing is read until one does, so no other page pays for it); after that the league pulse ('market', 'rosters' and
     'signups') and, in the bid room, Realtime on the lots, the bids and the nights read it again. Every action is a
     database door through S2.write (contracts/client-api.md): nothing shows as done before the database confirms it,
     and a refusal is the database's own sentence, with its hint as the problem's code. ---------- */
  var LV = { at: 0, err: null, season: null, cal: null, mk: null, pool: [], wire: [], nights: [], lots: [], bids: [], reqs: [], cs: null, board: [], who: null };
  /* the club a commissioner acts for, null (watching) until they choose one (review 2026-11-24: the first club by default
     let one misclick claim, request or bid for a club nobody chose, and a claim wins at once); a seat holder always acts
     for their own club */
  var ACT = null;
  var ms = function (x) { return x == null ? null : Date.parse(x); };
  /* a frozen countdown (market_lots.paused_remaining, a Postgres interval such as "00:03:12.5") in ms */
  function ivl(x) { var m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(x == null ? "" : x)); return m ? Math.round(((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000) : null; }
  /* clubs by id: the market speaks in teams.id, the pages in codes. The league body carries both (s2_league teams) */
  function teamRows() { var d = S2.data && S2.data.body; return (d && d.teams) || []; }
  function codeOf(id) { if (!id) return null; var t = teamRows().filter(function (x) { return x.id === id; })[0]; return t ? t.code : null; }
  function idOf(code) { var t = teamRows().filter(function (x) { return x.code === up(code); })[0]; return t ? t.id : null; }
  function liveClub() {
    var s = S2.session || {};
    if (s.seat) return up(s.teamCode || codeOf(s.teamId)) || null;
    if (s.isCommissioner) return ACT;
    return null;
  }
  function viewer() { var s = S2.session || {}; return [s.profileId || "", s.teamId || "", liveClub() || ""].join("|"); }

  /* one read: an RPC (body given) or a table (a PostgREST query). Rejects an Error carrying the database's code and hint */
  function rest(path, body) {
    if (!S2.SB_URL || !S2.SB_KEY) return Promise.reject(new Error("js/live.js did not load, so the market cannot be read."));
    var h = { apikey: S2.SB_KEY, "Content-Type": "application/json" }, tok = S2.session && S2.session.accessToken;
    if (tok) h.Authorization = "Bearer " + tok;
    return fetch(S2.SB_URL + "/rest/v1/" + path, body ? { method: "POST", headers: h, body: JSON.stringify(body) } : { headers: h }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* a non-JSON answer is reported with its status below */ }
        if (!r.ok) { var e = new Error((j && j.message) || "The league answered " + r.status + " for " + path.split("?")[0] + "."); e.code = j && j.code; e.hint = j && j.hint; e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function sid() {
    if (LV.season) return Promise.resolve(LV.season);
    return rest("rpc/current_season_id", {}).then(function (id) { if (!id) throw new Error("The league has no current season."); LV.season = id; return id; });
  }
  /* every row a table read can see, walked by its unique id a page at a time: PostgREST answers at most 1000 rows, and a
     season's bids or pool requests can pass that (memory: keyset paging v4.12, walk a unique key, never an offset) */
  var PAGE = 1000;
  function restAll(path) {
    var out = [];
    function page(after) {
      return rest(path + "&order=id&limit=" + PAGE + (after ? "&id=gt." + after : "")).then(function (rows) {
        rows = rows || []; out = out.concat(rows);
        return rows.length === PAGE ? page(rows[rows.length - 1].id) : out;
      });
    }
    return page(null);
  }
  var BIDS = "id,lot_id,night_id,team_id,seq,amount,placed_at";
  /* the room alone (nights, lots, bids and the club's own state): what a bid changes. Everything else is the full read */
  function readRoom(S, team) {
    var q = "season_id=eq." + S;
    return Promise.all([
      rest("market_bid_nights?select=id,night,opens_at,new_until,state,paused_at,closed_at&" + q),
      rest("market_lots?select=id,night_id,profile_id,position,ord,gp_at_open,state,price,bids,last_bid_at,ends_at,paused_remaining,sold_team_id,sold_at,ended_at,why&" + q + "&order=ord"),
      team && S2.session.user ? rest("rpc/market_club_state", { p_team: team }) : Promise.resolve(null)
    ]).then(function (x) {
      var ids = (x[0] || []).map(function (n) { return n.id; });
      /* the season's visible bids, every page; each lot sorts its own by seq (lLot) */
      return (ids.length ? restAll("market_bids?select=" + BIDS + "&night_id=in.(" + ids.join(",") + ")") : Promise.resolve([])).then(function (bids) {
        return { nights: x[0] || [], lots: x[1] || [], cs: x[2], bids: bids };
      });
    });
  }
  var loading = null, again = null;
  /* -> Promise<boolean>, never rejects: a failed read is kept in LV.err and said by the pages (fail loud, never a blank
     list that reads as "none"). Reads run one at a time; one asked for during a read runs once after it */
  function reload(room) {
    if (loading) { again = again === null ? !!room : again && !!room; return loading; }
    var who = viewer(), team = idOf(liveClub());
    loading = sid().then(function (S) {
      var q = "season_id=eq." + S;
      return Promise.all([
        room && LV.at ? Promise.resolve(null) : Promise.all([
          rest("rpc/market_calendar", { p_season: S }),
          /* the price ladder and the clocks are the season's own (season_rules mk), the one definition market_bid reads */
          rest("rpc/season_rules", { p_season: S }),
          rest("rpc/market_pool", { p_season: S }),
          rest("market_waivers?select=id,profile_id,from_team_id,position,salary,waived_at,expires_at,status,claimed_team_id,claimed_at,cleared_at&" + q + "&order=waived_at.desc"),
          /* the season's visible requests, every page, oldest first */
          restAll("market_pool_requests?select=id,game_id,team_id,profile_id,game_at,created_at,status,answered_at,ended_at,note&" + q).then(function (rows) {
            return rows.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)); });
          }),
          team && S2.session.user ? rest("market_boards?select=profile_id,rank,ceiling,note,updated_at&" + q + "&team_id=eq." + team + "&order=rank") : Promise.resolve([])
        ]),
        readRoom(S, team)
      ]);
    }).then(function (x) {
      if (x[0]) {
        /* a season with a market (market_calendar says so) and no price ladder is an error said on the page, never a guess */
        var mk = x[0][1] && x[0][1].mk;
        if ((x[0][0] || {}).market !== false && (!mk || !(mk.bid_open > 0) || !(mk.bid_step > 0))) throw new Error("The season's market rules (its opening bid and raise) could not be read.");
        LV.cal = x[0][0] || {}; LV.mk = mk; LV.pool = x[0][2] || []; LV.wire = x[0][3] || []; LV.reqs = x[0][4] || []; LV.board = x[0][5] || [];
      }
      LV.nights = x[1].nights; LV.lots = x[1].lots; LV.bids = x[1].bids; LV.cs = x[1].cs;
      LV.at = Date.now(); LV.err = null; LV.who = who;
      return true;
    }).catch(function (e) {
      console.error("S2.market: the market could not be read", e);
      LV.err = e; LV.who = who;
      return false;
    }).then(function (ok) {
      loading = null; emit("load", { ok: ok });
      if (again !== null) { var r = again; again = null; reload(r); }
      return ok;
    });
    return loading;
  }
  /* a page asks for the market: the first ask reads it, and a new viewer (sign-in, sign-out, another club) reads it again.
     A failed read is never retried from here (review 2026-11-25): the pages ask on every repaint and a failed read
     repaints them, so retrying here read the market in a loop for as long as the page stayed open (162 reads a second
     against a failing server; on the fixture, where the read refuses at once, the tab froze before any timer ran). The
     pulse (below) and the room's Realtime read again after a failure, and the pages tell the reader to reload */
  function ensure() { if (!loading && ((!LV.at && !LV.err) || LV.who !== viewer())) return reload(); return loading || Promise.resolve(!LV.err); }
  var soonT = 0, soonRoom = true;
  /* one read soon after a change: the first change sets the time and later ones join it, never pushing it back (a debounce
     that restarted on every change never read a busy room at all). spread: a Realtime change reaches every open room at
     once, so each tab waits a random part of a second more and the reads do not land together; a price that moved in
     the meantime is the database's refusal at the bid (p_expect), never a wrong bid.
     shortcut: every open room re-reads on a raise; merge the Realtime rows into LV instead if a bid night's load says so */
  function soon(room, spread) {
    soonRoom = soonRoom && !!room;
    if (soonT) return;
    soonT = setTimeout(function () { var r = soonRoom; soonT = 0; soonRoom = true; reload(r); }, 250 + (spread ? Math.floor(Math.random() * 750) : 0));
  }
  ["market", "rosters", "signups"].forEach(function (d) { S2.live.on(d, function () { if (LV.at || LV.err) soon(false); }); });
  /* the bid room's sub-second view: Realtime on the nights, the lots and the bids (RLS filters each subscriber's rows). A
     raise moves only a price, a count and a clock, which the pulse does not mark (sql v4.59), so the room hears it here.
     One channel for the session, made the first time the room is shown; it reads only the room, and only while the room
     is on screen (the pulse covers every other page) */
  var roomCh = null;
  function watchRoom() {
    var sb = S2.LIVE && S2.ensureSb ? S2.ensureSb() : null; if (!sb || roomCh) return;
    var hear = function () { if (document.getElementById("bdRoom")) soon(true, true); };
    roomCh = sb.channel("market-room");
    ["market_bid_nights", "market_lots", "market_bids"].forEach(function (t) { roomCh.on("postgres_changes", { event: "*", schema: "public", table: t }, hear); });
    roomCh.subscribe();
  }
  /* the countdowns run on the real clock: a tick each second repaints their text */
  setInterval(function () { emit("tick", { now: Date.now() }); }, 1000);

  /* ---------- the calendar: the database's (market_calendar: the schedule and movement_deadline_at), never hard-coded ---------- */
  function cal() { return LV.cal || {}; }
  function lNights() {
    return (cal().game_nights || []).filter(function (n) { return n.stage === "regular"; }).map(function (n) {
      var at = ms(n.first_puck), lock = ms(n.lock_at);
      return { key: n.night, label: longDay(at), short: M.etDate(iso(at)), week: n.week, at: at, ends: Date.parse(S2.CG.etISO(n.night, "23:30")), lockAt: lock == null ? at - 30 * MIN_MS : lock, games: n.games };
    });
  }
  function lTonight() {
    var t = Date.now(), key = M.etDay(iso(t)), list = lNights(), n = list.filter(function (x) { return x.key === key; })[0] || list.filter(function (x) { return x.at > t; })[0];
    if (!n) return null;
    n.state = t < n.at ? "before" : t < n.ends ? "live" : "done"; n.requestsCloseAt = n.publicAt = n.lockAt;
    return n;
  }
  function lBidNights() {
    return (cal().bid_nights || []).map(function (b) {
      var o = ms(b.opens_at), x = { key: b.night, label: longDay(o), short: M.etDate(iso(o)), opens: o, newUntil: ms(b.new_until), skipped: !!b.skipped, id: b.id || null, state: b.state, paused: !!b.paused };
      if (b.skipped) x.why = b.why || "No league games that week, so no bidding.";
      return x;
    });
  }
  function lBidNight(key) { return lBidNights().filter(function (b) { return b.key === key; })[0] || null; }
  function lNext() { var k = cal().next_bid_night; return k ? lBidNight(k) : null; }

  /* ---------- the pool, the requests and the club's games ---------- */
  function rowOf(pid) { return LV.pool.filter(function (r) { return r.profile_id === pid; })[0] || null; }
  function gameNight(q) { return M.etDay(q.game_at); }
  /* the club's regular-season games of a night, in puck-drop order: k is the game's place in the night (1, 2, 3) */
  function lClubGames(club, key) {
    var c = up(club); key = key || (lTonight() || {}).key; if (!c || !key) return [];
    return M.games.filter(function (g) { return (g.home === c || g.away === c) && g.night === key && (g.stage || "regular") === "regular"; })
      .sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); })
      .map(function (g, i) { return { k: i + 1, id: g.id, at: Date.parse(g.at), opp: g.home === c ? g.away : g.home }; });
  }
  function askView(q) {
    var c = codeOf(q.team_id), g = lClubGames(c, gameNight(q)).filter(function (x) { return x.id === q.game_id; })[0];
    return { id: q.id, pid: q.profile_id, club: c, game: g ? g.k : 0, gameId: q.game_id, time: g ? M.etTime(iso(g.at)) : M.etTime(q.game_at), night: gameNight(q),
      at: ms(q.created_at), state: q.status, why: q.note || null };
  }
  function lAsks(club) {
    var tn = lTonight(), c = up(club); if (!tn) return [];
    return LV.reqs.filter(function (q) { return gameNight(q) === tn.key && (!c || codeOf(q.team_id) === c); }).map(askView)
      .sort(function (a, b) { return a.at - b.at || a.game - b.game; });
  }
  function lRequests(club) {
    var by = {};
    lAsks(club).filter(function (a) { return a.state === "accepted"; }).forEach(function (a) {
      var x = by[a.pid] = by[a.pid] || { pid: a.pid, club: a.club, night: a.night, at: a.at, games: [] };
      if (a.game && x.games.indexOf(a.game) < 0) x.games.push(a.game);
    });
    return Object.keys(by).map(function (k) { by[k].games.sort(); return by[k]; }).sort(function (a, b) { return a.at - b.at; });
  }
  function lEntry(r) {
    var p = P(r.profile_id), tn = lTonight(), mine = tn ? lAsks().filter(function (a) { return a.pid === r.profile_id; }) : [];
    var acc = mine.filter(function (a) { return a.state === "accepted"; }), asked = [];
    mine.forEach(function (a) { if (a.state === "pending" && asked.indexOf(a.club) < 0) asked.push(a.club); });
    return { pid: r.profile_id, player: p, tag: p ? p.tag : "A player", pos: r.position || (p ? p.pos : null), unit: r.pos_group, ovr: p && p.ovr ? p.ovr.ovr : null,
      gp: r.gp, needs: r.needs, eligible: !!r.eligible, suspended: !!r.suspended, source: r.source, lastClub: codeOf(r.last_team_id),
      /* every pool player can be asked: the per-game answer replaced the availability mark (sql v4.59) */
      tonight: { available: !!tn, requestedBy: acc.length ? acc[0].club : null, games: acc.map(function (a) { return a.game; }).filter(Boolean).sort(), asked: asked },
      nightsPlayed: [] };
  }
  function lPool() { return LV.pool.map(lEntry).sort(byRating); }
  function lPoolPlayer(pid) { var r = rowOf(pid); return r ? lEntry(r) : null; }
  function lFillIns(pid) {
    var by = {};
    LV.reqs.filter(function (q) { return q.profile_id === pid && q.status === "accepted"; }).forEach(function (q) {
      var a = askView(q), n = by[a.night] = by[a.night] || { night: a.night, label: M.etLong(q.game_at), short: M.etDate(q.game_at), club: a.club, games: [] };
      if (a.game) n.games.push(a.game);
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }
  function lGamePlayers(club, k) { return lRequests(club).filter(function (x) { return x.games.indexOf(+k) >= 0; }).map(function (x) { return x.pid; }); }
  /* the pool player the page answers for: the member signed in, when they are in the pool or have a request */
  function lPoolMe() { var me = S2.session && S2.session.profileId; return me && (rowOf(me) || LV.reqs.some(function (q) { return q.profile_id === me; })) ? me : null; }

  /* ---------- waivers ---------- */
  function lWireView(w) {
    var t = Date.now(), p = P(w.profile_id), open = w.status === "open" && ms(w.expires_at) > t;
    return { id: w.id, pid: w.profile_id, player: p, tag: p ? p.tag : "A player", from: codeOf(w.from_team_id), salary: +w.salary, at: ms(w.waived_at), until: ms(w.expires_at),
      left: open ? ms(w.expires_at) - t : 0, claimable: open, claimedBy: w.status === "claimed" ? codeOf(w.claimed_team_id) : null, claimedAt: ms(w.claimed_at),
      expired: w.status === "cleared" || (w.status === "open" && !open), voided: w.status === "void" };
  }
  function lWaivers() { return LV.wire.map(lWireView).filter(function (w) { return w.claimable; }).sort(function (a, b) { return a.until - b.until; }); }
  /* the player's latest waiver (LV.wire is newest first) */
  function lWaiver(pid) { var w = LV.wire.filter(function (x) { return x.profile_id === pid; })[0]; return w ? lWireView(w) : null; }

  /* ---------- club state: the database's for the acting club (market_club_state), the model's roster for the others ---------- */
  function lClubState(code) {
    code = up(code); var cs = LV.cs;
    if (cs && cs.team_id && cs.team_id === idOf(code)) {
      var leading = (cs.leading || []).map(function (x) { var l = LV.lots.filter(function (y) { return y.id === x.lot_id; })[0]; return { pid: l ? l.profile_id : null, amt: +x.amount }; });
      return { code: code, team: team(code), active: { F: +cs.counts.F, D: +cs.counts.D, G: +cs.counts.G, total: +cs.active }, limit: +cs.limit, spots: Math.max(0, +cs.spots),
        payroll: +cs.payroll, cap: +cs.cap, room: +cs.room, leading: leading, committed: +(cs.committed || 0),
        freeSpots: cs.free_spots != null ? +cs.free_spots : Math.max(0, +cs.spots), freeRoom: cs.free_room != null ? +cs.free_room : +cs.room,
        mins: cs.mins || M.RULES.s2.min, moves_locked: !!cs.moves_locked };
    }
    return stateOf(code);
  }

  /* ---------- bid boards: the club's own (market_boards), saved whole through save_market_board ---------- */
  function boardRows(code) { return up(code) === liveClub() ? LV.board : []; }
  function lBoardView(x, i) {
    /* on waivers while the database still holds the waiver open (boardable), so "signed" and "gone" are exactly the rows
       the next save drops */
    var p = P(x.profile_id), r = rowOf(x.profile_id);
    var st = r ? "pool" : boardable(x.profile_id) ? "waivers" : p && p.rostered ? "signed" : "gone";
    return { pid: x.profile_id, player: p, tag: p ? p.tag : "A player", rank: x.rank || i + 1, ceiling: x.ceiling == null ? null : +x.ceiling, note: x.note || "", at: ms(x.updated_at),
      state: st, signedBy: st === "signed" ? p.club : null, eligible: !!(r && r.eligible), needs: r ? r.needs : mkOf("bid_gp"), gp: r ? r.gp : 0 };
  }
  function lBoard(club) { return boardRows(club).map(lBoardView); }
  function lOnBoard(club, pid) { var b = lBoard(club); return b.filter(function (x) { return x.pid === pid; })[0] || null; }

  /* ---------- the room ---------- */
  function nightRow(key) { return LV.nights.filter(function (n) { return n.night === key; })[0] || null; }
  function lDefaultKey(t) {
    var open = LV.nights.filter(function (n) { return n.state !== "closed"; })[0]; if (open) return open.night;
    var nb = lNext(); if (nb) return nb.key;
    var held = lBidNights().filter(function (b) { return !b.skipped; }); return held.length ? held[held.length - 1].key : null;
  }
  function lLot(l, n, as, t) {
    var p = P(l.profile_id), mineId = as ? idOf(as) : null, over = l.state === "sold" || l.state === "unsold" || l.state === "void";
    var bids = LV.bids.filter(function (b) { return b.lot_id === l.id; }).sort(function (a, b) { return b.seq - a.seq; });
    var rem = l.paused_remaining != null ? ivl(l.paused_remaining) : null;
    /* a paused countdown stands still: its end is always the time it had left from now (the pause freezes every clock) */
    var ends = l.state === "running" ? (rem != null ? t + rem : ms(l.ends_at)) : null, nu = ms(n.new_until);
    var open = n.state !== "closed" && !n.paused_at && ((l.state === "open" && t < nu) || (l.state === "running" && ends != null && t < ends));
    var price = l.price == null || l.state === "void" ? null : +l.price;
    return { id: l.id, pid: l.profile_id, player: p, tag: p ? p.tag : "A player", pos: l.position, ovr: p && p.ovr ? p.ovr.ovr : null, gp: l.gp_at_open, state: l.state,
      /* "bids always start at 750k and can only be raised by 250k at a time": the season's own figures (mk), and no
         price at all without them (a read with no ladder is an error the pages say) */
      price: price, next: open && LV.mk ? (price == null ? mkOf("bid_open") : price + mkOf("bid_step")) : null, bids: l.bids,
      /* Rule S2.6: "the clubs bidding are not shown until the bidding on that player is over" (RLS hides the rest) */
      history: bids.map(function (b) { return { amt: +b.amount, at: ms(b.placed_at), mine: !!mineId && b.team_id === mineId, club: over ? codeOf(b.team_id) : null }; }),
      endsAt: ends, left: ends != null ? Math.max(0, ends - t) : null,
      mine: !!mineId && (l.state === "sold" ? l.sold_team_id === mineId : l.state === "running" && bids.some(function (b) { return b.team_id === mineId && +b.amount === price; })),
      soldTo: l.state === "sold" ? codeOf(l.sold_team_id) : null, why: l.state === "void" ? l.why : null, board: as ? lOnBoard(as, l.profile_id) : null };
  }
  function lRoom(key, o) {
    var t = Date.now(); key = key || lDefaultKey(t);
    var b = lBidNight(key); if (!b || b.skipped) return null;
    var as = o && o.as ? up(o.as) : null, n = nightRow(key), views;
    if (n) views = LV.lots.filter(function (l) { return l.night_id === n.id; }).sort(function (a, c) { return a.ord - c.ord; }).map(function (l) { return lLot(l, n, as, t); });
    /* before 9 PM the lots are a preview: the pool players eligible now, best rated first (the database fixes the list at 9) */
    else views = lPool().filter(function (x) { return x.eligible; }).map(function (x) {
      return { id: null, pid: x.pid, player: x.player, tag: x.tag, pos: x.pos, ovr: x.ovr, gp: x.gp, state: "open", price: null, next: null, bids: 0, history: [], endsAt: null, left: null, mine: false, soldTo: null, why: null, board: as ? lOnBoard(as, x.pid) : null }; });
    var nu = n ? ms(n.new_until) : b.newUntil, paused = n && n.paused_at ? ms(n.paused_at) : null;
    var state = n ? (n.state === "closed" ? "closed" : n.state === "closing" || (!paused && t >= nu) ? "closing" : "live") : b.state === "missed" ? "closed" : "before";
    /* the 10 PM cut stands still while paused too (market_resume moves it later by the pause) */
    var until = paused ? t + Math.max(0, nu - paused) : nu;
    var count = function (s) { return views.filter(function (v) { return v.state === s; }).length; };
    var lastEnd = views.reduce(function (a, v) { return v.state === "running" ? Math.max(a, v.endsAt) : a; }, 0);
    return { key: key, id: n ? n.id : null, night: b, state: state, now: t, opens: b.opens, newUntil: until, paused: paused,
      left: state === "before" ? b.opens - t : state === "live" ? until - t : state === "closing" ? Math.max(0, lastEnd - t) : 0,
      lots: views, running: count("running"), sold: count("sold"), unsold: count("unsold"), open: count("open"), voided: count("void"), recap: state === "closed" ? lRecap(key) : null };
  }
  function lRecap(key) {
    var b = lBidNight(key), n = nightRow(key); if (!b || !n || n.state !== "closed") return null;
    var lots = LV.lots.filter(function (l) { return l.night_id === n.id; }), tagOf = function (l) { var p = P(l.profile_id); return p ? p.tag : "A player"; };
    return recapOf(key, b, lBidNights(),
      lots.filter(function (l) { return l.state === "sold"; }).map(function (l) { return { pid: l.profile_id, tag: tagOf(l), club: codeOf(l.sold_team_id), amt: +l.price }; }),
      lots.filter(function (l) { return l.state === "unsold"; }).length,
      lots.filter(function (l) { return l.state === "void"; }).map(function (l) { return { pid: l.profile_id, tag: tagOf(l), why: l.why }; }));
  }
  function liveNight() { return LV.nights.filter(function (n) { return n.state === "live" || n.state === "closing"; })[0] || null; }
  function lBidPause() { var n = liveNight(); return n && n.paused_at ? { at: ms(n.paused_at), by: "The league office", key: n.night } : null; }
  function lOnLot(pid) {
    var r = lRoom(); if (!r || (r.state !== "live" && r.state !== "closing")) return null;
    var l = r.lots.filter(function (x) { return x.pid === pid; })[0];
    return l && l.next != null ? { key: r.key, state: l.state } : null;
  }

  /* ---------- the doors: S2.write, then the market read again, then the pages repaint in place on "load" ---------- */
  function no(code, text) { return Promise.resolve({ ok: false, data: null, problems: [prob(code, text, true)] }); }
  function refused(e) { return { ok: false, data: null, problems: [prob((e && (e.hint || e.code)) || "refused", (e && e.message) || "The league did not take that. Try again.", true)] }; }
  /* sections: the league read's sections the door changes (rosters for a claim or a waiver); the market itself is read
     again here. A write that landed is ok even when the read after it failed (the read says so on the page) */
  function dbAct(rpc, args, sections, approval) {
    return S2.write(rpc, args, { sections: sections || [], approval: approval || null }).then(function (res) {
      return reload(false).then(function () { return { ok: true, data: res.data, queued: !!res.queued, problems: [] }; });
    }, function (e) {
      /* a refusal is often the market moving under the page (a price raised, a waiver claimed first): read it again
         before the answer, so the refusal is said beside what is true now */
      return reload(false).then(function () { return refused(e); });
    });
  }
  var ROSTER = ["rosters", "tenures", "signups"];
  function mineOr(club) { return up(club || liveClub()); }
  function lBid(pid, o) {
    o = o || {}; var code = mineOr(o.club), r = lRoom(), l = r && r.lots.filter(function (x) { return x.pid === pid; })[0];
    if (!idOf(code)) return no("missing", "Choose the club you are bidding for.");
    if (!l || !l.id) return no("not_live", "There is no bidding on that player right now.");
    return dbAct("market_bid", { p_lot: l.id, p_team: idOf(code), p_expect: o.expect != null ? o.expect : l.next });
  }
  function lClaim(pid, o) {
    o = o || {}; var code = mineOr(o.club), w = lWaiver(pid);
    if (!idOf(code)) return no("missing", "Choose the club that is claiming.");
    if (!w) return no("not_on_waivers", "That player is not on waivers.");
    return dbAct("market_claim", { p_waiver: w.id, p_team: idOf(code) }, ROSTER);
  }
  /* the waiver itself: a GM or AGM whose Owner approves roster moves sends it to the Owner (mgmt_gate decides; Rule 2.6),
     so the result may be { queued: true } */
  function lWaive(pid, o) { return dbAct("waive_player", { p_profile: pid, p_not_inactive: o && o.notInactive === true ? true : null }, ROSTER, "owner"); }
  function askRow(pid, o, states) {
    var c = idOf(mineOr(o.club)), g = o.gameId || ((lClubGames(mineOr(o.club)).filter(function (x) { return x.k === +o.game; })[0]) || {}).id;
    return LV.reqs.filter(function (q) { return q.profile_id === pid && q.team_id === c && q.game_id === g && states.indexOf(q.status) >= 0; })[0] || null;
  }
  function lRequest(pid, o) {
    o = o || {}; var code = mineOr(o.club), g = o.gameId || ((lClubGames(code).filter(function (x) { return x.k === +o.game; })[0]) || {}).id;
    if (!idOf(code) || !g) return no("missing", "Choose one of the club's games tonight.");
    return dbAct("market_pool_request", { p_game: g, p_team: idOf(code), p_profile: pid });
  }
  /* a club withdraws its request, or releases the guest of an accepted one, until the night's lock */
  function lRelease(pid, o) { var q = askRow(pid, o || {}, ["pending", "accepted"]); return q ? dbAct("market_pool_withdraw", { p_request: q.id }) : no("not_requested", "Your club has no open request for that player and game."); }
  /* the player answers; false on an accepted request withdraws the acceptance (until the lock) */
  function lAnswer(pid, o, yes) {
    var q = LV.reqs.filter(function (x) { return x.profile_id === pid && codeOf(x.team_id) === up(o.club) && (o.id ? x.id === o.id : askView(x).game === +o.game) && (x.status === "pending" || (!yes && x.status === "accepted")); })[0];
    return q ? dbAct("market_pool_answer", { p_request: q.id, p_accept: !!yes }) : no("not_asked", "That request is no longer open.");
  }
  function lPause(o) { var n = liveNight(); return n ? dbAct("market_pause", { p_night: n.id, p_reason: (o && o.reason) || null }) : no("not_live", "No bid night is live, so there is nothing to pause."); }
  function lResume() { var n = liveNight(); return n ? dbAct("market_resume", { p_night: n.id }) : no("not_live", "No bid night is live."); }
  /* the office withdraws one player from tonight's bidding; the reason is required and stays with the office */
  function lVoidLot(pid, reason) {
    var r = lRoom(), l = r && r.lots.filter(function (x) { return x.pid === pid; })[0];
    return l && l.id ? dbAct("market_void_lot", { p_lot: l.id, p_reason: reason }) : no("missing", "That player has no auction tonight.");
  }
  /* boards save whole (save_market_board), one save at a time, each built on the board the last save read back */
  var boardQ = Promise.resolve();
  /* what save_market_board takes (sql v4.59): a player in the training camp pool (market_pool, the read LV.pool holds) or
     on an OPEN waiver (status open, even past its 24 hours until market_tick clears it), never the waiver's claimable */
  function boardable(pid) { return !!rowOf(pid) || LV.wire.some(function (w) { return w.profile_id === pid && w.status === "open"; }); }
  function boardSave(edit) {
    var run = function () {
      var code = liveClub(), rows = LV.board.map(function (x) { return { profile_id: x.profile_id, ceiling: x.ceiling == null ? null : +x.ceiling, note: x.note || null }; });
      /* review 2026-11-24: save_market_board refuses the whole board for one player who has left the pool (sold, claimed,
         drawn), and nothing in the database prunes a board, so after a club's first lost target every save failed. A row
         already on the board whose player left is dropped at this save (the board shows it as signed or gone until then,
         and says so); a row added by THIS edit is sent as typed, so a player who is not in the pool is the database's refusal */
      var left = {}; LV.board.forEach(function (x) { if (!boardable(x.profile_id)) left[x.profile_id] = 1; });
      var bad = edit(rows); if (bad) return no(bad[0], bad[1]);
      rows = rows.filter(function (x) { return !left[x.profile_id]; });
      if (!idOf(code)) return no("missing", "Only a club's front office keeps a bid board.");
      return dbAct("save_market_board", { p_team: idOf(code), p_rows: rows });
    };
    var p = boardQ.then(run, run); boardQ = p; return p;
  }
  function boardAt(rows, pid) { for (var i = 0; i < rows.length; i++) if (rows[i].profile_id === pid) return i; return -1; }
  function lBoardAdd(club, pid, o) { o = o || {}; return boardSave(function (rows) { if (boardAt(rows, pid) >= 0) return ["on_board", ((P(pid) || {}).tag || "That player") + " is already on your board."]; rows.push({ profile_id: pid, ceiling: o.ceiling == null ? null : o.ceiling, note: o.note || null }); }); }
  function lBoardSet(club, pid, o) { o = o || {}; return boardSave(function (rows) { var i = boardAt(rows, pid); if (i < 0) return ["not_on_board", "That player is not on your board."]; if (o.ceiling !== undefined) rows[i].ceiling = o.ceiling; if (o.note !== undefined) rows[i].note = String(o.note || "").trim() || null; }); }
  function lBoardRemove(club, pid) { return boardSave(function (rows) { var i = boardAt(rows, pid); if (i < 0) return ["not_on_board", "That player is not on your board."]; rows.splice(i, 1); }); }
  function lBoardMove(club, pid, toRank) { return boardSave(function (rows) { var i = boardAt(rows, pid); if (i < 0) return ["not_on_board", "That player is not on your board."]; var x = rows.splice(i, 1)[0]; rows.splice(Math.max(1, Math.min(rows.length + 1, Math.round(num(toRank)) || 1)) - 1, 0, x); }); }

  /* the confirm popup the commissioner ruled (2026-11-23: "add a confirm popup when a team tries to place someone on waivers
     acknowledging they cannot reclaim them until they have cleared waivers and become available during the Saturday
     bidding"), with the not-inactive confirmation (2026-11-02: "Teams must not waive inactive players but should report them
     to league staff"). The ONE waive door for every page: Team HQ's roster sheet and the profile call it. The popup stays
     open until the database answers; a refusal is said in it and the box stays as the member left it.
     -> Promise<{ ok, problems, queued } | { ok: false, canceled: true }> */
  function waiveDoor(pid) {
    var p = P(pid), tag = p ? p.tag : "This player", club = p && p.club ? full(p.club) : "your club";
    return new Promise(function (resolve) {
      var settled = false, fin = function (r) { if (!settled) { settled = true; resolve(r); } };
      var sh = S2.confirm({ title: "Waive " + tag + "?", danger: true, ok: "Put on waivers", cancel: "Keep " + tag,
        why: ["The " + club + " cannot reclaim " + tag + " until they have cleared waivers and become available during the Saturday bidding.",
          "For the next 24 hours any other club with an open roster spot and cap room may claim them at their salary, and the first valid claim wins at once. If no club does, they join the training camp pool (Rules S2.5 and S2.6)."],
        html: '<label class="mk-confirm"><input type="checkbox" data-mk-ok> <span>This player is not being waived for being inactive. An inactive player is reported to the league office instead.</span></label>' +
          '<p class="mk-err" role="alert" data-mk-err></p>',
        onClose: function () { fin({ ok: false, canceled: true, problems: [] }); },
        onOk: function (s) {
          var box = S2.$("[data-mk-ok]", s.el), err = S2.$("[data-mk-err]", s.el), go = S2.$('[data-cf="ok"]', s.el);
          if (!box.checked) { err.textContent = "Confirm that " + tag + " is not being waived for being inactive. Report an inactive player to the league office instead."; box.focus(); return false; }
          if (go.disabled) return false;
          go.disabled = true; go.setAttribute("aria-busy", "true"); err.textContent = "";
          lWaive(pid, { notInactive: true }).then(function (r) {
            go.disabled = false; go.removeAttribute("aria-busy");
            if (r.ok) { fin(r); s.close(); return; }
            err.textContent = r.problems.map(function (x) { return x.text; }).join(" ");
          });
          return false;
        } });
      if (!sh) fin({ ok: false, canceled: true, problems: [] });
    });
  }

  /* the season's rule figures (season_rules mk), null until the first read lands */
  function mkOf(k) { return LV.mk && LV.mk[k] != null ? +LV.mk[k] : null; }
  S2.market = {
    get MIN() { return mkOf("bid_open"); }, get STEP() { return mkOf("bid_step"); }, get SIX() { return mkOf("bid_gp"); },
    get LOT_MS() { var x = mkOf("lot_seconds"); return x == null ? null : x * 1000; },
    get WAIVER_MS() { var x = mkOf("waiver_hours"); return x == null ? null : x * 3600000; },
    get deadline() { var d = cal().deadline; return d ? ms(d) : null; },
    on: on, now: function () { return Date.now(); },
    pauseBidding: lPause, resumeBidding: lResume, bidPause: lBidPause, voidLot: lVoidLot,
    gameNights: lNights, tonight: lTonight, bidNights: lBidNights, nextBidNight: lNext,
    pool: lPool, poolPlayer: lPoolPlayer, inPool: function (pid) { return !!rowOf(pid); }, poolMe: lPoolMe,
    request: lRequest, release: lRelease, requests: lRequests, accept: function (pid, o) { return lAnswer(pid, o || {}, true); }, decline: function (pid, o) { return lAnswer(pid, o || {}, false); },
    asks: lAsks, asksFor: function (pid) { return lAsks().filter(function (a) { return a.pid === pid; }); }, gamePlayers: lGamePlayers, fillIns: lFillIns, lineupProblems: lineupProblems,
    waivers: lWaivers, waiver: lWaiver, claim: lClaim, waive: lWaive, waiveDoor: waiveDoor,
    board: lBoard, boardAdd: lBoardAdd, boardSet: lBoardSet, boardRemove: lBoardRemove, boardMove: lBoardMove, onBoard: lOnBoard,
    clubState: lClubState, room: lRoom, onLot: lOnLot, bid: lBid, recap: lRecap,
    /* a commissioner chooses the club they act for, or none ("" or null: back to watching) */
    club: liveClub, setClub: function (code) { if (!(S2.session && S2.session.isCommissioner) || (code && !team(code))) return false; ACT = code ? up(code) : null; reload(); return true; },
    clubGames: lClubGames, ensure: ensure, reload: reload, watchRoom: watchRoom,
    status: function () { var c = cal(); return { loaded: !!LV.at, error: LV.err ? LV.err.message : null, draftDone: !!c.draft_done, schedule: !!(c.game_nights && c.game_nights.length), movesLocked: !!c.moves_locked }; },
    /* three names other streams' files still call (review 2026-11-25): hq.js's Bidding tab hands its clock host to
       mountClock, and js/demo.js runs _due before a gated door and tells _waived of a waiver. The league's market has no
       clock control and keeps nothing for them, so they do nothing, never throw: a missing one threw a TypeError in Team
       HQ and in every gated door of the fixture (propose, accept, counter, reverse, waive, sign).
       shortcut: inert stubs, delete them when s2/i3c (hq.js without the clock host) and stream i3's FINAL step (js/demo.js
       gone) have both merged; tools/ui/market.test.cjs pins them inert until then */
    mountClock: function (el) { if (el) el.hidden = true; },
    _due: function () {},
    _waived: function () {}
  };
})();
