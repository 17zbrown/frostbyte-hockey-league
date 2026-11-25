/* CGHL Season 2: the Bid room, #/bidding (Season menu). The Saturday bid night as a live event, built on
   S2.market (js/market.js), the one definition of the rules; this page only reads it and calls S2.market.bid.
   The commissioner, 2026-11-02 (binding): "bids always start at 750k and can only be raised by 250k at a time. a team
   cannot place two bids in a row on the same player. They need to wait for another team to bid in order to raise their
   own bid on a player.", "a team cannot place a bid on a player that would take them over their salary cap." and
   "Build the live room as you see fit that matches the style and flow of the concept site using the Apple design rules
   and other skills." Spec: data/market-spec.md, "Design".
   What is where: the ink band is the event (the night, its state, one big clock, the night picker); the club rail is the
   acting club's spots, Season 2 cap room, the bids it leads and its board's targets (pinned on a desktop, a sticky
   summary that opens a sheet on a phone); the lots are one card per player with ONE button carrying the exact next price
   (no amount box: the price is the season's opening bid, then the top bid plus the season's step). A front office, or a
   commissioner once they choose the club they act for, bids; every other role watches, and the rail says how to take part.
   The room is the league's own (sql v4.59): the nights come from the database's calendar (the schedule and the movement
   deadline, never a date written here), a bid is market_bid through S2.write with the price the page showed (a moved
   price is refused, never paid), and the Draft and Bidding manager or a commissioner pauses, resumes and withdraws a lot
   through market_pause, market_resume and market_void_lot. The room hears raises through Realtime (S2.market.watchRoom)
   and the rest through the league pulse; nothing shows as done before the database confirms it, and the button waits
   while a bid is open.
   Repaint rule (BRIEF: interactions never reset the page): every market read ("load") marks the room and one microtask
   later the touched widgets are swapped in place; the once-a-second "tick" changes text and ring offsets only. Focus
   survives a swap through data-key. Also fills the "Bids" list in the Control Center's Season setup pool step
   (S2.bidding.ccBids, the data-w="ccbids" spot in control.js).
   v5.00 swap (i3e, 2026-11-25): the room runs only on the league's market; the demo's sample clock bar, rival bidders,
   Discord previews and forced bids are gone. */
(function () {
  "use strict";
  var S2 = window.S2, M = S2 && S2.M, K = S2 && S2.market, esc = S2 && S2.esc;
  if (!M || !K) {
    console.error("bidding.js needs S2.M and S2.market: load it after js/market.js");
    if (S2 && S2.page) S2.page("bidding", { title: "Bid room", render: function () { return '<section class="page-head"><h1 class="t-large">Bid room</h1><p class="t-sub" role="alert">The Season 2 market did not load, so the room cannot be shown. Reload the page.</p></section>'; } });
    return;
  }

  /* ---------- small helpers ---------- */
  var WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  function word(n) { return WORD[n] || String(n); }
  function cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  /* M.money prints "$0K" and "$-1,250K" (break-ui: a club pushed over the cap by a forced bid); the room says "$0" and
     never prints a negative amount (a club over the cap is said in words where it shows) */
  function money(n) { return n === 0 ? "$0" : M.money(Math.abs(n)); }
  function pad(n) { return ("0" + n).slice(-2); }
  function mmss(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + pad(s % 60); }
  function hms(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 3600) + ":" + pad(Math.floor(s % 3600 / 60)) + ":" + pad(s % 60); }
  /* the band's clock: days when far off, hours inside a day, minutes and seconds inside the hour */
  function far(ms) { return ms >= 172800000 ? plural(Math.floor(ms / 86400000), "day") : ms >= 3600000 ? hms(ms) : mmss(ms); }
  /* bid times carry seconds: at 10x a run of raises lands inside one minute */
  function clockAt(ms) { try { return new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" }); } catch (e) { return M.etTime(new Date(ms).toISOString()); } }
  function city(code) { var t = M.team(code); return t ? t.city : String(code || ""); }
  function full(code) { var t = M.team(code); return t ? t.full : String(code || ""); }
  function crest(code) { return '<span class="bd-cr" aria-hidden="true">' + M.crest(code) + "</span>"; }
  function unitOf(pos) { return (M.UNIT && M.UNIT[pos]) || ""; }
  function posName(pos) { return M.posName(pos) || pos || ""; }
  function rule(id) { return '<a href="#/rulebook?rule=' + id + '">Rule ' + id + "</a>"; }

  /* who acts: a front office for its own club, a commissioner for the club they chose (S2.market.club); everyone else
     watches */
  function acts() { return S2.has("office"); }
  function club() { return acts() ? K.club() : null; }

  /* ---------- the page's own state: which night, which filter, what was said on a lot (kept across repaints) ---------- */
  var VIEW = { pick: null, want: null, filter: "all", unit: "all" };   /* want: the ?night= asked for, kept until the real market's nights arrive */
  var SAY = {};                 /* pid -> { problems, at }: a refusal said in place on the lot until that lot moves */
  var LS = null, RS = null;     /* the open lot sheet { pid, sh } and the phone rail sheet */

  /* the night shown: the one picked, else a live room, else a night that closed in the last 24 hours (its recap is the
     news), else the next bid night, so a room that just closed keeps its result in front of someone who watched it */
  function autoKey() {
    var r = K.room(); if (!r) return null;
    if (r.state === "live" || r.state === "closing") return r.key;
    return justHeld() || r.key;
  }
  /* the bid night that closed in the last 24 hours (its results are still the news), else null; the room and the Control
     Center's pool step both read it */
  function justHeld() {
    var t = K.now(), held = K.bidNights().filter(function (b) { return !b.skipped && b.newUntil <= t; }), last = held[held.length - 1];
    if (last && t - last.newUntil < 86400000) { var lr = K.room(last.key); if (lr && lr.state === "closed") return last.key; }
    return null;
  }
  function shownKey() { return VIEW.pick || (VIEW.want && bidNight(VIEW.want) ? VIEW.want : null) || autoKey(); }
  function bidNight(key) { return K.bidNights().filter(function (b) { return b.key === key; })[0] || null; }
  function nextAfter(key) { var b = bidNight(key); return b ? K.bidNights().filter(function (x) { return !x.skipped && x.opens > b.opens; })[0] || null : null; }
  /* the address follows the picked night without a navigation (S2.route runs only on hashchange) */
  function setQ(key) {
    try { history.replaceState(history.state, "", "#/bidding" + (key ? "?night=" + encodeURIComponent(key) : "")); }
    catch (e) { console.warn("bidding: the address could not be updated (" + e.message + "); the night still changed"); }
  }

  function read() {
    var key = shownKey(), b = bidNight(key), as = club();
    return { key: key, night: b, skipped: !!(b && b.skipped), room: b && !b.skipped ? K.room(key, { as: as }) : null, as: as, cs: as ? K.clubState(as) : null };
  }
  function roomCls(R) { return "bd" + (R.skipped || !R.room ? " is-skipped" : "") + (R.room && R.room.state === "closed" ? " is-closed" : ""); }
  function lotOf(R, pid) { return R.room ? R.room.lots.filter(function (l) { return l.pid === pid; })[0] || null : null; }
  function recapTotal(room) { return room && room.recap ? room.recap.total : 0; }

  /* ---------- the ink band: the event head ---------- */
  var STATE_WORD = { before: "Opens 9:00 PM", live: "Live", closing: "Last clocks running", closed: "Closed" };
  /* no room to show and no bid night at all: the schedule is not set yet (no schedule or no deadline, no nights:
     public._market_bid_nights), which is "not yet", never "none left". QA 2026-11-25: the empty room said no bid night was
     left before the movement deadline under a hero that said the nights come with the schedule. Every empty-room line
     below reads this one test */
  function noNights() { return !K.bidNights().length; }
  /* the room a pause holds (2026-11-23): only the live or closing room it was paused in */
  function pausedRoom(R) { var bp = K.bidPause(); return bp && R.room && R.room.key === bp.key && (R.room.state === "live" || R.room.state === "closing") ? bp : null; }
  function headline(R) {
    var r = R.room;
    if (R.skipped) return "No bidding this Saturday";
    if (!r) { var st = K.status(); if (st.error) return "The bid room could not be read"; if (!st.loaded) return "Reading the bid room"; if (noNights()) return "No bid nights yet"; }
    if (!r) return "No bid night left";
    if (pausedRoom(R)) return "Bidding is paused";
    if (r.state === "before") return r.lots.length ? cap(word(r.lots.length)) + (r.lots.length === 1 ? " player can" : " players can") + " be bid on" : "No player has six games yet";
    if (r.state === "live") return r.sold ? cap(word(r.sold)) + " signed" + (r.running ? ", " + word(r.running) + " running" : " so far") : r.running ? cap(word(r.running)) + (r.running === 1 ? " player" : " players") + " in play" : "Bidding is open";
    /* review 2026-11-03: the state label beside it already says LAST CLOCKS RUNNING, so the headline names who is still
       in play (BRIEF: "Headlines that say something") */
    if (r.state === "closing") {
      var still = r.lots.filter(function (l) { return l.state === "running"; });
      return still.length === 1 ? still[0].tag + " is the last player in play" : still.length ? cap(word(still.length)) + " players still in play" : "The last countdown is ending";
    }
    return r.sold ? cap(word(r.sold)) + (r.sold === 1 ? " player signed" : " players signed") : "No player signed";
  }
  /* the lots section's headline is the news of the list itself: how many still wait for a first bid, then how many went
     back to the pool, then the night's top sale (the BRIEF: a headline says something, not what the control is) */
  function lotsHead(R) {
    var r = R.room; if (!r) return "No lots";
    if (r.state === "before" || r.state === "live") {
      var wait = r.state === "before" ? r.lots.length : r.open;
      if (wait) return cap(word(wait)) + (wait === 1 ? " player still waiting" : " players still waiting") + " for a first bid";
      return r.running ? "Every lot is open, " + word(r.running) + " still in play" : "Every lot is decided";
    }
    if (r.state === "closing") return r.unsold ? cap(word(r.unsold)) + (r.unsold === 1 ? " player went" : " players went") + " back to the pool without a bid" : "Every player drew a bid";
    var top = r.lots.filter(function (l) { return l.state === "sold"; }).sort(function (a, b) { return b.price - a.price; })[0];
    return top ? top.tag + " went to " + city(top.soldTo) + " for " + money(top.price) : "No player signed";
  }
  function meta(R) {
    var r = R.room, n = R.night, nx = n && nextAfter(n.key);
    if (R.skipped) return n.why.replace(/[^.]$/, "$&.") + (nx ? " The next bid night is " + nx.label + "." : "");
    if (!r) { var st = K.status(); if (st.error) return "The league did not answer just now (" + st.error + "). Reload the page to try again."; if (!st.loaded) return "One moment while the league's market is read.";
      if (noNights()) return "Saturday bidding runs from 9 to 10 PM ET on the Saturday of every game week after the draft and before the movement deadline. The nights show here once the Season 2 schedule is set (Rule S2.6)."; }
    if (!r) return "Saturday bidding runs only before the movement deadline. After it, clubs use single-game requests from the training camp pool (Rule S2.5).";
    var nb = K.nextBidNight(), bp = pausedRoom(R);
    if (bp) return bp.by + " paused the room at " + M.etTime(new Date(bp.at).toISOString()) + " ET. No bid is taken and every countdown waits where it stopped until the bidding resumes; waivers and the rest of the market carry on (Rules S2.6 and S2.8).";
    if (r.state === "before") return "Bidding opens at 9:00 PM ET on " + n.label + " and runs one hour. Every pool player with six games is open at once, in rating order" +
      (nb && nb.key === r.key ? "; the list is fixed at 9:00 PM." : ". This is a preview from today's pool: the list is fixed when that night opens.");
    if (r.state === "live") return "New bidding closes at 10:00 PM. Each bid starts a five-minute countdown and a raise starts it again; the clubs bidding stay hidden until the bidding on a player is over (Rule S2.6).";
    if (r.state === "closing") return (r.sold ? cap(word(r.sold)) + (r.sold === 1 ? " player has" : " players have") + " signed so far. " : "") +
      "No bidding opens on a new player after 10:00 PM; the countdowns already running finish, and the top bid on each signs when its countdown ends.";
    /* the recap's own sentence leads the section under the band; the band says what closing means */
    return "Every countdown has run out and the room is closed. Each signing is a contract to the end of the season, and now that the bidding is over the clubs are named (Rule S2.6)." +
      (nx ? " The next bid night is " + nx.label + "." : "");
  }
  function clockHtml(R) {
    var r = R.room, t = K.now();
    if (R.skipped || !r) return '<p class="bd-state"><span class="bd-state-w">No bidding</span></p>';
    var bp = pausedRoom(R), st = '<p class="bd-state" data-bd-state="' + (bp ? "paused" : r.state) + '">' + (r.state === "live" && !bp ? '<span class="dot-live" aria-hidden="true"></span>' : "") + '<span class="bd-state-w">' + esc(bp ? "Paused" : STATE_WORD[r.state]) + "</span></p>";
    if (r.state === "closed") return st + '<p class="bd-big"><span class="d-num bd-big-n">' + esc(money(recapTotal(r))) + '</span><span class="bd-big-l">Signed in all</span></p>';
    var to = r.state === "before" ? r.opens : r.state === "live" ? r.newUntil : t + r.left, fmt = r.state === "before" ? "far" : "mmss";
    var lab = r.state === "before" ? "Until 9:00 PM" : r.state === "live" ? "Left" : "Last clock";
    return st + '<p class="bd-big"><span class="d-num bd-big-n' + (r.state !== "before" && to - t < 60000 ? " low" : "") + '" role="timer" aria-label="' + esc(lab) + '" data-bd-ends="' + to + '" data-bd-fmt="' + fmt + '">' +
      esc(fmt === "far" ? far(to - t) : mmss(to - t)) + '</span><span class="bd-big-l">' + esc(lab) + "</span></p>";
  }
  /* the pause control (2026-11-23), while a room is live or closing, shown only to who holds it: the Draft and Bidding
     manager and a commissioner (can_run_market decides; S2.has("draftbid") is the hint) */
  function pauseHtml(R) {
    var r = R.room; if (!S2.has("draftbid") || !r || (r.state !== "live" && r.state !== "closing")) return "";
    var bp = pausedRoom(R);
    return '<button type="button" class="btn site' + (bp ? "" : " outline") + ' bd-pause" data-bd-pause="' + (bp ? "resume" : "pause") + '" data-key="pause">' + (bp ? "Resume bidding" : "Pause bidding") + "</button>";
  }
  /* a later read that failed while the room still shows the last one (review wf_74093353-9c3): said in the band, so
     prices and clocks never stand there as current without a word */
  function staleHtml(R) {
    var st = K.status(); if (!R.room || !st.error) return "";
    return '<p class="bd-stale" role="alert">' + esc("The league did not answer the last read (" + st.error + "), so the prices and clocks here may be out of date. The room reads again with the next change; reload the page to read it now.") + "</p>";
  }
  function nowHtml(R) {
    var n = R.night;
    return '<div class="bd-now"><div class="bd-who"><h1 class="kicker bd-h1">Bid room' + (n ? '<span class="bd-h1-n">' + esc(n.label) + (n.skipped ? "" : ", 9 to 10 PM ET") + "</span>" : "") + "</h1>" +
      '<p class="d-1 bd-head">' + esc(headline(R)) + '</p><p class="bd-meta">' + esc(meta(R)) + "</p>" + staleHtml(R) + pauseHtml(R) + "</div>" +
      '<div class="bd-clockbox">' + clockHtml(R) + "</div></div>";
  }
  function pickerHtml(key) {
    return '<div class="seg bd-nights" id="bdNights" role="group" aria-label="Bid night" data-keys="' + esc(K.bidNights().map(function (b) { return b.key; }).join()) + '">' + K.bidNights().map(function (b) {
      var lab = String(b.short).replace(/^\w+, /, "");
      return '<button type="button" data-v="' + esc(b.key) + '" data-key="night-' + esc(b.key) + '" aria-pressed="' + (b.key === key) + '"' + (b.skipped ? ' class="skip" aria-label="' + esc(b.label + ": no bidding, holiday week") + '"' : ' aria-label="' + esc(b.label) + '"') + ">" + esc(lab) + "</button>";
    }).join("") + "</div>";
  }

  /* ---------- the club rail ---------- */
  function boardLine(e, lot, R) {
    var r = R.room;
    /* the board drops a player who left the pool at its next save (js/market.js boardSave, review 2026-11-24) */
    var off = ", off the board at its next save";
    if (e.state === "signed") return (e.signedBy ? "Signed by " + city(e.signedBy) : "Signed") + off;
    if (e.state === "gone") return "No longer in the pool" + off;
    if (e.state === "waivers") return "On waivers: a claim, not a bid";
    if (!e.eligible) return "Needs " + plural(e.needs, "more game", "more games") + " to be bid on";
    if (!lot) return r && r.state !== "before" ? "Not on this night's list" : "Eligible";
    if (lot.state === "sold") return lot.mine ? "Your club signed them, " + money(lot.price) : "Sold to " + city(lot.soldTo) + ", " + money(lot.price);
    if (lot.state === "unsold") return "No bids: back to the pool";
    if (lot.state === "void") return "Sale voided: left the pool";
    if (lot.state === "running") return "At " + money(lot.price) + (lot.mine ? ", your club leads" : "");
    return r.state === "before" ? "Opens at 9:00 PM" : "No bid yet";
  }
  /* "past your ceiling": the next raise costs more than the ceiling the club set on its board */
  function pastCeiling(e, lot) { return !!(e && e.ceiling != null && lot && lot.next != null && !lot.mine && lot.next > e.ceiling); }
  function railHtml(R) {
    if (!R.as) return watchHtml();
    var cs = R.cs, r = R.room, code = R.as, lots = r ? r.lots : [], lead = lots.filter(function (l) { return l.mine && l.state === "running"; });
    var commish = S2.has("commish"), pick = pickHtml(code);
    var board = K.board(code);
    var bl = board.length ? '<ol class="bd-board">' + board.slice(0, 8).map(function (e) {
      var lot = lots.filter(function (l) { return l.pid === e.pid; })[0], past = pastCeiling(e, lot);
      return '<li class="' + (past ? "past" : "") + '"><span class="bd-bn num">' + e.rank + '</span><span class="bd-bt"><button type="button" class="bd-link" data-bd-open="' + esc(e.pid) + '" data-key="rb-' + esc(e.pid) + '">' + esc(e.tag) + "</button>" +
        '<span class="bd-bs">' + esc(boardLine(e, lot, R)) + "</span>" + (past ? '<span class="bd-warn">' + S2.ic("flag") + "Past your ceiling: the next raise is " + esc(money(lot.next)) + "</span>" : "") + "</span>" +
        '<span class="bd-bc num">' + (e.ceiling != null ? esc(money(e.ceiling)) : '<span class="bd-dim">No ceiling</span>') + "</span></li>";
    }).join("") + "</ol>" + (board.length > 8 ? '<p class="bd-more">And ' + plural(board.length - 8, "more target") + " on the board.</p>" : "")
      : '<p class="bd-note">No targets yet. A board is the club&rsquo;s private plan, kept all season in Team HQ: who to bid on, in order, and the most to pay. It never bids by itself.</p>';
    var full15 = cs.freeSpots < 1;
    return '<div class="bd-rail-in"><div class="bd-rail-h"><span class="kicker">' + (commish ? "Commissioner" : "Your club") + "</span>" + pick + "</div>" +
      '<p class="bd-club">' + crest(code) + '<span class="d-3">' + esc(full(code)) + "</span></p>" +
      '<dl class="bd-figs"><div><dt>Open spots</dt><dd class="d-num" data-bd-spots>' + cs.spots + "</dd><dd class=\"bd-figs-s\">" + cs.active.total + " of " + cs.limit + " active" + (lead.length ? ", " + plural(lead.length, "held by a bid", "held by bids") + " you lead" : "") + "</dd></div>" +
        '<div><dt>Season 2 cap room</dt><dd class="d-num' + (cs.room < 0 ? " bd-over" : "") + '" data-bd-room>' + esc(money(cs.room)) + '</dd><dd class="bd-figs-s">' +
          (cs.room < 0 ? '<span class="bd-over">Over the ' + esc(money(cs.cap)) + " cap by " + esc(money(cs.room)) + "</span>" : esc(money(cs.cap)) + " less the active roster") + (cs.committed ? ", " + esc(money(cs.committed)) + " held by bids you lead" : "") + "</dd></div></dl>" +
      (full15 ? '<p class="bd-alert">' + S2.ic("flag") + "<span>No open spot" + (lead.length ? " left after the bids you lead" : "") + ": the room refuses a bid that would take the club past " + cs.limit + " (Rule S2.4). Waive a player in Team HQ to make room.</span></p>" : "") +
      '<div class="bd-rs"><h2 class="bd-rs-h">Bids you lead<span class="num">' + lead.length + "</span></h2>" + (lead.length ? '<ul class="bd-lead">' + lead.map(function (l) {
        return '<li><button type="button" class="bd-link" data-bd-open="' + esc(l.pid) + '" data-key="rl-' + esc(l.pid) + '">' + esc(l.tag) + '</button><span class="num">' + esc(money(l.price)) + '</span><span class="num bd-dim" data-bd-ends="' + l.endsAt + '" data-bd-fmt="mmss">' + mmss(l.left) + "</span></li>";
      }).join("") + "</ul>" + '<p class="bd-note">Free to bid after them: ' + plural(Math.max(0, cs.freeSpots), "spot") + " and " + esc(money(Math.max(0, cs.freeRoom))) + ".</p>"
        : '<p class="bd-note">' + (!r ? (noNights() ? "None yet. No bid night is set." : "No bid night is left.") : r.state === "closed" ? "None: this night is over." : r.state === "before" ? "None yet. Bidding opens at 9:00 PM." :
          "None right now. A bid you lead holds a roster spot and its amount of your cap room until it is over.") + "</p>") + "</div>" +
      '<div class="bd-rs"><h2 class="bd-rs-h">Your board<span class="num">' + board.length + "</span></h2>" + bl +
        '<a class="arrow" href="#/hq?tab=bidding"><span>Edit your board</span>' + S2.ic("chev") + "</a></div></div>";
  }
  /* the commissioner's Acting for. A commissioner only watches until they choose a club (review 2026-11-24: acting for
     the first club by default let one misclick bid or save a board for a club nobody chose), so the picker opens on
     Watching */
  function pickHtml(code) {
    if (!S2.has("commish")) return "";
    return '<label class="bd-pickclub"><span class="kicker">Acting for</span><select class="input" data-bd-club data-key="club">' +
      '<option value=""' + (code ? "" : " selected") + ">Watching</option>" + M.teams.map(function (t) {
      return '<option value="' + t.code + '"' + (t.code === code ? " selected" : "") + ">" + esc(t.full) + "</option>"; }).join("") + "</select></label>";
  }
  function watchHtml() {
    var role = S2.state.role, commish = S2.has("commish");
    /* review 2026-11-03: every game of the season counts toward the six, at any club (Rule S2.5 "tracks each pool
       player's games across every club"), not only games played from the pool; being bid on is Rule S2.6 */
    var how = role === "guest" ? "Join with Discord and register for Season 2. A player who goes undrafted joins the training camp pool, and six games this season make them eligible here (Rule S2.6)."
      : commish ? "A commissioner watches the room until they choose the club they act for under Acting for; only then do a bid or a board save go through, for that club."
      : S2.has("staff") ? "The league office watches the room; staff never bid. A club bids through its Owner, GM or AGM."
      : "Clubs bid through their front office: the Owner, GM or AGM. A player in the training camp pool can be requested for a club's games (Rule S2.5), and six games this season, at any club, make them eligible here (Rule S2.6).";
    return '<div class="bd-rail-in"><div class="bd-rail-h"><span class="kicker">' + (commish ? "Commissioner" : "Watching") + "</span>" + (commish ? pickHtml(null) : "") + '</div><p class="d-3 bd-watch-h">You are watching the room</p>' +
      '<p class="bd-note">' + esc(how) + "</p><p class=\"bd-note\">Bids are open to see, but the clubs bidding stay hidden until the bidding on a player is over.</p>" +
      /* QA 2026-11-25: the website button, as the footer's Join the Discord on the same page (js/core.js S2.footer) */
      '<div class="bd-watch-a">' + (role === "guest" ? '<a class="btn site discord" href="#/you">Join with Discord</a>' : "") +
        '<a class="arrow" href="#/camp"><span>Training camp pool</span>' + S2.ic("chev") + "</a></div></div>";
  }
  function sumHtml(R) {
    if (!R.as) return '<button type="button" class="bd-sum" data-bd-sum data-key="sum" aria-haspopup="dialog"><span class="bd-sum-t"><b>Watching</b><span>How to take part</span></span>' + S2.chev() + "</button>";
    var cs = R.cs, lead = cs.leading.length;
    return '<button type="button" class="bd-sum" data-bd-sum data-key="sum" aria-haspopup="dialog" aria-label="' + esc(full(R.as) + ": " + plural(cs.spots, "open spot") + ", " + money(cs.room) + (cs.room < 0 ? " over the cap" : " cap room") + ", leading " + lead + ". Open the club rail") + '">' +
      crest(R.as) + '<span class="bd-sum-t"><b class="num">' + plural(cs.spots, "spot") + '</b><span class="num' + (cs.room < 0 ? ' bd-over">' + esc(money(cs.room)) + " over the cap" : '">' + esc(money(cs.room)) + " room") + '</span><span class="num">Leads ' + lead + "</span></span>" + S2.chev() + "</button>";
  }

  /* ---------- a lot ---------- */
  /* review 2026-11-03: a refusal belongs to the price it answered. A lot that can take no bid now (sold, back to the
     pool, voided, or a closed room) keeps no refusal (an override button once opened a "Bid $0" sheet on a sold lot) */
  function sayHtml(l) {
    var s = SAY[l.pid]; if (!s || l.next == null) return "";
    return '<div class="bd-say" role="alert" data-bd-say>' + s.problems.map(function (x) { return "<p>" + esc(x.text) + "</p>"; }).join("") + "</div>";
  }
  function ring(l) {
    var C = 2 * Math.PI * 19, f = Math.max(0, Math.min(1, K.LOT_MS ? l.left / K.LOT_MS : 1));
    return '<span class="bd-ring' + (l.left < 60000 ? " low" : "") + '" data-bd-ends="' + l.endsAt + '" data-bd-fmt="ring" role="timer" aria-label="Time left on ' + esc(l.tag) + '">' +
      '<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="bd-ring-t" cx="22" cy="22" r="19"/><circle class="bd-ring-v" cx="22" cy="22" r="19" stroke-dasharray="' + C.toFixed(2) + '" style="stroke-dashoffset:' + (C * (1 - f)).toFixed(2) + '"/></svg>' +
      '<span class="bd-ring-n num">' + mmss(l.left) + "</span></span>";
  }
  function stateLine(l, room) {
    if (l.state === "sold") return l.mine ? "Your club signed them" : "Sold to " + city(l.soldTo) + ", " + money(l.price);
    if (l.state === "unsold") return "No bids: back to the pool";
    /* the engine's own sentence for a lot whose player left the pool while it ran (no sale, no more bids) */
    if (l.state === "void") return l.why || "The player left the pool while the countdown ran, so there is no sale.";
    if (l.state === "running") return (l.mine ? "Your club leads" : "Bidder hidden") + " · " + plural(l.bids, "bid");
    return room.state === "before" ? "Opens at 9:00 PM" : room.state === "live" ? "No bid yet" : "No new bidding after 10:00 PM";
  }
  function actionHtml(l, R) {
    var room = R.room, pid = esc(l.pid);
    if (room.state === "before") {
      if (!R.as) return "";
      return l.board ? '<a class="btn secondary bd-act" href="#/hq?tab=bidding" data-key="act-' + pid + '">On your board, #' + l.board.rank + "</a>"
        : '<button type="button" class="btn secondary bd-act" data-bd-board="' + pid + '" data-key="act-' + pid + '">Add to board</button>';
    }
    if (l.next == null) return "";
    /* ONE button, the exact next price; the club that leads keeps it (a press says the rule in place), quieter */
    /* the accent fill is for the contests running now; a lot nobody has opened yet stays quiet, so 25 untouched lots do
       not shout over the two that matter */
    return '<button type="button" class="btn bd-act' + (l.mine ? " plain" : l.bids ? "" : " secondary") + '" data-bd-bid="' + pid + '" data-price="' + l.next + '" data-key="act-' + pid + '">' +
      (l.bids ? "Raise to " : "Open at ") + esc(money(l.next)) + "</button>";
  }
  /* what the lot's big numeral says: a void lot never sold, so its last bid does not stand as a price */
  function priceKey(l) { return l.state === "sold" ? "Sold for" : l.state === "running" ? "Top bid" : l.state === "unsold" ? "No bids" : l.state === "void" ? "No sale" : "Opens at"; }
  function priceText(l) { return l.state === "unsold" ? "None" : l.state === "void" ? "Void" : l.price != null ? money(l.price) : K.MIN != null ? money(K.MIN) : "–"; }
  function lotHtml(l, R) {
    var room = R.room, pid = esc(l.pid), b = l.board, past = pastCeiling(b, l);
    SEEN[l.pid] = lotSig(l);
    var k = priceKey(l), price = priceText(l);
    /* a sale replaces the state line with the club that signed them, so the card does not grow when it is over */
    var sold = l.state === "sold" ? '<p class="bd-sold bd-lot-st">' + crest(l.soldTo) + "<span>" + esc(l.mine ? "Your club signed them" : "Sold to the " + full(l.soldTo)) + "</span></p>" : "";
    /* the card is the size container and .bd-lot-in its grid, so the phone's two-column lot follows the CARD's own
       width (css/bidding.css; review 2026-11-03: a list query squeezed three 250px cards into the phone layout) */
    return '<article class="bd-lot is-' + l.state + (l.mine ? " is-mine" : "") + (past ? " is-past" : "") + '" data-pid="' + pid + '" data-state="' + l.state + '" data-price="' + (l.price || 0) + '" data-bids="' + l.bids + '" tabindex="-1" aria-labelledby="bdT-' + pid + '">' +
      '<span class="bd-flash" aria-hidden="true"></span><div class="bd-lot-in">' +
      '<div class="bd-lot-top"><button type="button" class="bd-lot-name" id="bdT-' + pid + '" data-bd-open="' + pid + '" data-key="open-' + pid + '">' + esc(l.tag) + "</button>" +
        '<span class="bd-lot-meta"><abbr title="' + esc(posName(l.pos)) + '">' + esc(l.pos || "") + "</abbr><span>" + (l.ovr != null ? '<b class="num">' + l.ovr + "</b> OVR" : "No rating") + '</span><span><b class="num">' + l.gp + "</b> GP</span></span></div>" +
      (b ? '<p class="bd-lot-b">Board #' + b.rank + (b.ceiling != null ? " · ceiling " + esc(money(b.ceiling)) : " · no ceiling") + "</p>" : "") +
      '<div class="bd-lot-body"><div class="bd-lot-mid"><p class="bd-price"><span class="bd-price-k">' + esc(k) + '</span><span class="bd-price-w"><span class="d-num bd-price-n">' + esc(price) + "</span></span></p>" +
        (l.state === "running" ? ring(l) : "") + "</div>" + (sold || '<p class="bd-lot-st">' + esc(stateLine(l, room)) + "</p>") +
        (past ? '<p class="bd-warn">' + S2.ic("flag") + "Past your ceiling: the next raise is " + esc(money(l.next)) + "</p>" : "") + "</div>" +
      actionHtml(l, R) + sayHtml(l) + "</div></article>";
  }
  function filtered(R) {
    var r = R.room; if (!r) return [];
    return r.lots.filter(function (l) {
      if (VIEW.unit !== "all" && unitOf(l.pos) !== VIEW.unit) return false;
      if (VIEW.filter === "running") return l.state === "running";
      if (VIEW.filter === "board") return !!l.board;
      if (VIEW.filter === "over") return l.state === "sold" || l.state === "unsold" || l.state === "void";
      return true;
    });
  }
  var EMPTY = { all: "No player fits this filter.", running: "No countdown is running right now.", board: "None of this night's players is on your board.", over: "No lot is over yet." };
  function lotsHtml(R) {
    if (R.skipped) {
      var nx = nextAfter(R.key);
      return '<div class="bd-empty"><p>No lots this Saturday: the league takes the holiday weeks off.</p>' +
        (nx ? '<button type="button" class="btn secondary" data-bd-night="' + esc(nx.key) + '" data-key="go-' + esc(nx.key) + '">See ' + esc(nx.label) + "</button>" : "") + "</div>";
    }
    var r = R.room; if (!r) return '<p class="bd-empty">' + (noNights() ? "No lots yet. Each bid night lists every pool player with six games or more, best rated first." : "There is no bid night left before the movement deadline.") + "</p>";
    if (!r.lots.length) return '<p class="bd-empty">No pool player has six games yet, so there is nobody to bid on. Clubs request pool players on game nights, three games a night (Rule S2.5).</p>';
    var ls = filtered(R);
    return ls.length ? ls.map(function (l) { return lotHtml(l, R); }).join("") : '<p class="bd-empty">' + esc(VIEW.unit !== "all" && VIEW.filter === "all" ? EMPTY.all : EMPTY[VIEW.filter] || EMPTY.all) + "</p>";
  }
  function countText(R) {
    var r = R.room; if (!r || !r.lots.length) return "";
    if (r.state === "before") return plural(r.lots.length, "player") + " with six games or more, best rating first. The order never changes during the night.";
    var vd = r.lots.filter(function (l) { return l.state === "void"; }).length, vs = vd ? ", " + vd + " voided (left the pool)" : "";
    if (r.state === "closed") return r.sold + " signed, " + r.unsold + " back to the pool" + vs + ".";
    return r.running + " running, " + r.sold + " sold, " + (r.open + r.unsold) + " without a bid" + vs + ".";
  }

  /* ---------- the closed night: the recap and the players back in the pool ---------- */
  function recapHtml(R) {
    var r = R.room; if (!r || r.state !== "closed" || !r.recap) return "";
    var rc = r.recap, back = r.lots.filter(function (l) { return l.state === "unsold"; }), vd = rc.voided || [];
    /* the headline is the night's news: the top price, or one price for everyone */
    var top = rc.sold.slice().sort(function (a, b) { return b.amt - a.amt; })[0], flat = top && rc.sold.every(function (s) { return s.amt === top.amt; });
    var h = !top ? "No club bid this night" : flat && rc.sold.length > 1 ? cap(word(rc.sold.length)) + " signed at " + money(top.amt) + " each" : top.tag + " went to " + city(top.club) + " for " + money(top.amt);
    return '<section class="bd-recap" aria-labelledby="bdRecapH"><div class="sec-head"><div class="copy"><span class="kicker">The night</span><h2 class="d-2" id="bdRecapH">' +
        esc(h) + "</h2><p>" + esc(rc.text) + "</p></div></div>" +
      '<div class="bd-recap-g"><div>' + (rc.sold.length ? '<ol class="bd-signed">' + rc.sold.map(function (s) {
          var p = M.player(s.pid);
          return "<li>" + crest(s.club) + '<span class="bd-signed-t"><button type="button" class="bd-link" data-bd-open="' + esc(s.pid) + '" data-key="rc-' + esc(s.pid) + '">' + esc(s.tag) + '</button><span class="bd-dim">' + esc(full(s.club) + (p ? ", " + posName(p.pos) : "")) + '</span></span><span class="d-num bd-signed-p">' + esc(money(s.amt)) + "</span></li>";
        }).join("") + "</ol>" : '<p class="bd-note">No club bid on anyone this night.</p>') +
        (back.length ? '<h3 class="bd-rs-h bd-back-h">Back to the pool<span class="num">' + back.length + '</span></h3><p class="bd-note">No bid, so they stay in the training camp pool and stay eligible for the next bid night without six more games.</p><ul class="bd-back">' +
          back.map(function (l) { var p = l.player; return '<li><a href="' + esc(p ? p.href : "#/camp") + '">' + esc(l.tag) + '</a><span class="bd-dim">' + esc((l.pos || "") + (l.ovr != null ? " · " + l.ovr : "")) + "</span></li>"; }).join("") +
          '</ul><a class="arrow" href="#/camp"><span>The training camp pool</span>' + S2.ic("chev") + "</a>" : "") +
        /* a lot whose player left the pool while its countdown ran: no sale, and the engine's sentence says why */
        (vd.length ? '<h3 class="bd-rs-h bd-back-h">Sales voided<span class="num">' + vd.length + '</span></h3><p class="bd-note">These players left the training camp pool while the bidding on them ran, so no club signed them here.</p><ul class="bd-void">' +
          vd.map(function (v) { var p = M.player(v.pid); return '<li><a href="' + esc(p ? p.href : "#/camp") + '">' + esc(v.tag) + '</a><span class="bd-dim">' + esc(v.why || "Left the pool while the countdown ran.") + "</span></li>"; }).join("") + "</ul>" : "") + "</div></div></section>";
  }

  /* ---------- the lot sheet: the history ---------- */
  function sheetHtml(l, R) {
    var p = l.player, pp = K.poolPlayer(l.pid), room = R.room;
    /* market_pool's source: waivers, late (signed up after the draft began) or undrafted */
    var src = pp ? ({ waivers: "Joined the pool from waivers", late: "Signed up after the draft", undrafted: "Went undrafted" }[pp.source] || "Unrostered") + (pp.lastClub ? ", last with " + city(pp.lastClub) : "") : "";
    /* the office withdraws a player from tonight's bidding (market_void_lot; the reason stays with the office) */
    var vd = S2.has("draftbid") && l.id && (l.state === "open" || l.state === "running") && (room.state === "live" || room.state === "closing")
      ? '<button type="button" class="btn sm secondary bd-void" data-bd-void="' + esc(l.pid) + '" data-key="void-' + esc(l.pid) + '">Withdraw from tonight&rsquo;s bidding</button>' : "";
    var hist = l.history.length ? '<ol class="bd-hist">' + l.history.map(function (h) {
      /* the clubs bidding stay hidden until the bidding is over; then the winning bid names its club */
      var who = h.mine ? "Your club" : h.club ? full(h.club) : "A club";   /* bidders show once the lot is over (Rule S2.6) */
      return '<li class="' + (h.mine ? "mine" : "") + '"><span class="num bd-hist-a">' + esc(money(h.amt)) + '</span><span class="bd-hist-w">' + esc(who) + '</span><span class="num bd-dim">' + esc(clockAt(h.at)) + "</span></li>";
    }).join("") + "</ol>" : '<p class="bd-note">' + (room.state === "before" ? "Bidding opens at 9:00 PM." : "No bid yet.") + "</p>";
    return '<div class="bd-sheet" data-pid="' + esc(l.pid) + '"><p class="bd-sh-meta">' + esc([posName(l.pos), l.ovr != null ? l.ovr + " rating" : "No rating", plural(l.gp, "game")].join(" · ")) + "</p>" +
      (src ? '<p class="bd-note">' + esc(src) + "</p>" : "") +
      (l.board ? '<p class="bd-lot-b">On your board, #' + l.board.rank + (l.board.ceiling != null ? ", ceiling " + esc(money(l.board.ceiling)) : ", no ceiling") + (l.board.note ? ": " + esc(l.board.note) : "") + "</p>" : "") +
      '<div class="bd-sh-now"><p class="bd-price"><span class="bd-price-k">' + esc(priceKey(l)) + '</span><span class="bd-price-w"><span class="d-num bd-price-n">' +
        esc(priceText(l)) + "</span></span></p>" + (l.state === "running" ? ring(l) : "") + "</div>" +
      '<p class="bd-lot-st">' + esc(stateLine(l, room)) + "</p>" + actionHtml(l, R) + sayHtml(l) + vd +
      '<h3 class="bd-rs-h">Bids<span class="num">' + l.bids + "</span></h3>" + hist +
      (l.history.length ? '<p class="bd-note">Amounts and times are open to everyone. The clubs bidding stay hidden until the bidding on ' + esc(l.tag) + " is over (Rule S2.6).</p>" : "") +
      (p ? '<a class="arrow" href="' + esc(p.href) + '"><span>Player page</span>' + S2.ic("chev") + "</a>" : "") + "</div>";
  }
  function openLot(pid) {
    var R = read(), l = lotOf(R, pid); if (!l) return;
    if (LS) LS.sh.close();
    var sh = S2.sheet({ title: l.tag, label: "Lot: " + l.tag, html: sheetHtml(l, R), onClose: function () { if (LS && LS.sh === sh) LS = null; } });
    sh.el.classList.add("bd-sheet-w");
    sh.body.addEventListener("click", onClick);
    LS = { pid: pid, sh: sh };
  }
  function openRail() {
    var R = read();
    if (RS) RS.close();
    var sh = S2.sheet({ title: R.as ? full(R.as) : "The bid room", html: railHtml(R), onClose: function () { if (RS === sh) RS = null; } });
    sh.el.classList.add("bd-sheet-w");
    sh.body.addEventListener("click", onClick); sh.body.addEventListener("change", onChange);
    RS = sh;
  }

  /* ---------- actions ---------- */
  var live = null, NIGHTS = null;   /* the polite live region; the night picker (S2.segmented, so a jump moves its thumb) */
  function say(text) { if (live) { live.textContent = ""; setTimeout(function () { if (live) live.textContent = text; }, 30); } }
  function lockedBid(pid, tag) {
    S2.locked({ title: "Bid on " + tag, who: "A club's front office: its Owner, GM and AGM",
      why: "A club bids through its front office, in this room on Saturday nights from 9:00 to 10:00 PM ET (Rule S2.6). Everyone else watches." });
  }
  /* expect: the price the page showed, so a raise that landed first refuses ("The price moved to $X") instead of
     silently paying more */
  var OPEN = {};   /* pid -> true while a real bid on that lot waits for the database */
  function bidOn(pid, expect) {
    var R = read(), l = lotOf(R, pid); if (!l) return;
    if (!acts()) return lockedBid(pid, l.tag);
    if (OPEN[pid]) return;
    if (expect == null) expect = l.next;
    OPEN[pid] = true; S2.$$('[data-bd-bid="' + pid + '"]').forEach(function (b) { b.disabled = true; b.setAttribute("aria-busy", "true"); });
    K.bid(pid, { club: K.club(), expect: expect }).then(function (res) {
      delete OPEN[pid];
      var text = res.problems.map(function (x) { return x.text; }).join(" "), now = res.ok ? null : lotOf(read(), pid);
      /* the amount said is the database's own (market_bid's answer) */
      var amt = res.ok ? res.data && res.data.amount : null;
      if (res.ok) { delete SAY[pid]; say("Your club bid " + money(amt) + " on " + l.tag + ". It leads, and the countdown starts again."); }
      /* the lot ended while the press was open: nothing is left to bid on, so the answer is a toast, not a refusal parked
         on a finished card */
      else if (!now || now.next == null) { delete SAY[pid]; S2.toast(text, "err"); say(text); }
      else { SAY[pid] = { problems: res.problems, at: K.now(), bids: now.bids }; say(text); }
      mark({ pid: pid, rail: true });
      /* the waiting button was disabled, which drops focus to the page: once the lot is repainted (mark's microtask), the
         lot's door takes it back, unless the reader has moved on (i3e, 2026-11-25) */
      Promise.resolve().then(function () {
        var a = document.activeElement; if (a && a !== document.body) return;
        var f = S2.$('[data-key="act-' + pid + '"]') || S2.$('.bd-lot[data-pid="' + pid + '"]'); if (f) f.focus({ preventScroll: true });
      });
    });
  }
  function addBoard(pid) {
    var R = read(), l = lotOf(R, pid); if (!l) return;
    if (!acts()) return S2.locked({ title: "Add " + l.tag + " to a board", who: "A club's front office: its Owner, GM and AGM", why: "A bid board is a club's private plan, seen only by its front office and the league office." });
    K.boardAdd(K.club(), pid, {}).then(function (res) {
      if (res.ok) S2.toast(l.tag + " is on your board. Set a ceiling in Team HQ.", "ok");
      else S2.toast(res.problems.map(function (x) { return x.text; }).join(" "), "err");
    });
  }
  function onClick(e) {
    var b = e.target.closest("[data-bd-bid],[data-bd-open],[data-bd-board],[data-bd-sum],[data-bd-night],[data-bd-pause],[data-bd-void]"); if (!b || b.disabled) return;
    if (b.hasAttribute("data-bd-pause")) return pauseDoor(b.dataset.bdPause, b);
    if (b.hasAttribute("data-bd-void")) return voidDoor(b.dataset.bdVoid);
    if (b.hasAttribute("data-bd-night")) { if (NIGHTS) NIGHTS.set(b.dataset.bdNight); return; }
    if (b.hasAttribute("data-bd-bid")) return bidOn(b.dataset.bdBid, +b.dataset.price);
    if (b.hasAttribute("data-bd-open")) { if (RS) RS.close(); return openLot(b.dataset.bdOpen); }
    if (b.hasAttribute("data-bd-board")) return addBoard(b.dataset.bdBoard);
    if (b.hasAttribute("data-bd-sum")) return openRail();
  }
  function pauseDoor(what, btn) {
    /* RULED 2026-11-23: until a Draft and Bidding manager is seated, only a commissioner pauses and resumes bidding. The
       control shows only to who holds the power (pauseHtml); can_run_market decides */
    if (!S2.has("draftbid")) return S2.locked({ title: what === "pause" ? "Pause Saturday bidding" : "Resume Saturday bidding", who: "The Draft and Bidding committee manager, or a commissioner",
      why: "The Draft and Bidding committee manager, or a commissioner, pauses and resumes Saturday bidding; it is the seat's own power beside the draft room's controls (Rule S2.8)." });
    if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
    (what === "pause" ? K.pauseBidding() : K.resumeBidding()).then(function (res) {
      if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); }
      if (!res.ok) { S2.toast(res.problems.map(function (x) { return x.text; }).join(" "), "err"); return; }
      S2.toast(what === "pause" ? "Bidding is paused. Every countdown waits." : "Bidding resumed. The countdowns run on from where they stopped.", "ok");
      say(what === "pause" ? "Bidding is paused." : "Bidding resumed.");
    });
  }
  /* the office withdraws one player from tonight's bidding. The reason is required and stays with the office; the sheet
     stays open until the database answers, and a refusal is said in it with the reason kept as typed */
  function voidDoor(pid) {
    var l = lotOf(read(), pid); if (!l) return;
    S2.confirm({ title: "Withdraw " + l.tag + " from tonight's bidding?", danger: true, ok: "Withdraw", cancel: "Keep bidding open",
      why: ["The public reads \"Withdrawn by the league office.\" " + l.tag + " stays in the training camp pool and stays eligible for the next bid night. A club that leads the bidding is told its bid no longer counts."],
      html: '<label class="bd-why"><span>Reason (seen by the league office only)</span><textarea class="input" rows="3" maxlength="300" data-bd-why></textarea></label><p class="bd-err" role="alert" data-bd-err></p>',
      onOk: function (sh) {
        var why = S2.$("[data-bd-why]", sh.el), err = S2.$("[data-bd-err]", sh.el), go = S2.$('[data-cf="ok"]', sh.el);
        if (!why.value.trim()) { err.textContent = "Give the reason for withdrawing " + l.tag + "."; why.focus(); return false; }
        if (go.disabled) return false;
        go.disabled = true; go.setAttribute("aria-busy", "true"); err.textContent = "";
        K.voidLot(pid, why.value.trim()).then(function (res) {
          go.disabled = false; go.removeAttribute("aria-busy");
          if (res.ok) { sh.close(); S2.toast(l.tag + " is withdrawn from tonight's bidding.", "ok"); say(l.tag + " withdrawn."); return; }
          err.textContent = res.problems.map(function (x) { return x.text; }).join(" ");
        });
        return false;
      } });
  }
  function onChange(e) {
    var s = e.target.closest("[data-bd-club]"); if (!s) return;
    if (S2.has("commish")) { SAY = {}; K.setClub(s.value); }   /* the refusals were said to the last club; the market reads this one's state, then "load" repaints */
  }

  /* ---------- repaint in place ---------- */
  function swap(el, html) {
    if (!el) return null;
    var a = document.activeElement, key = a && el.contains(a) ? a.getAttribute("data-key") : null;
    var box = document.createElement("div"); box.innerHTML = html;
    var n = box.firstElementChild; if (!n) return null;
    el.replaceWith(n);
    if (key) { var f = n.querySelector('[data-key="' + key + '"]'); (f || n).focus({ preventScroll: true }); }
    else if (a && el.contains(a)) n.focus({ preventScroll: true });
    return n;
  }
  function fill(el, html) {
    if (!el) return;
    var a = document.activeElement, key = a && el.contains(a) ? a.getAttribute("data-key") : null;
    el.innerHTML = html;
    if (key) { var f = el.querySelector('[data-key="' + key + '"]'); if (f) f.focus({ preventScroll: true }); }
  }
  /* the motion a lot earns when it changes: the price rolls up (translateY + opacity, 200ms ease-out), a new bid flashes
     the edge once, a lot that is over cross-fades to its result. Reduced motion keeps the fades and drops the travel */
  var EASE = "cubic-bezier(0.23, 1, 0.32, 1)", OVER = { sold: 1, unsold: 1, "void": 1 };
  /* what a lot looked like before a repaint: its state, its bid count, its height and its old content (kept, detached,
     so a lot that is over can cross-fade from what was there to its result) */
  function snap(el) { return { state: el.dataset.state, bids: +el.dataset.bids, h: el.getBoundingClientRect().height, inner: el.querySelector(".bd-lot-in") }; }
  function animateLot(n, was) {
    if (!n || !n.animate || !was) return;
    var bids = +n.dataset.bids, st = n.dataset.state, reduce = S2.reduce.matches;
    if (st !== was.state && OVER[st]) {
      /* review 2026-11-03: the sold lot used to fade in over nothing (its old content was already gone), and on a phone
         the card lost its button and every lot below jumped 16px. Now the old content lies over the new and fades out
         while the result fades in (opacity only, so reduced motion keeps it), and the card eases to its new height so
         the list below slides instead of snapping (a sale is rare: one card, 220ms) */
      var inner = n.querySelector(".bd-lot-in"), ghost = was.inner, h = n.getBoundingClientRect().height, left = 0;
      var done = function () { if (--left > 0) return; if (ghost && ghost.parentNode) ghost.remove(); n.classList.remove("is-swapping"); };
      n.classList.add("is-swapping");
      if (ghost) {
        /* a picture of what was there, not a second lot: no ids, no data hooks (the tick, focus restore and the click
           handler never find it) and no live roles */
        S2.$$("*", ghost).concat([ghost]).forEach(function (x) {
          for (var i = x.attributes.length - 1; i >= 0; i--) { var a = x.attributes[i].name; if (a === "id" || a === "role" || a.indexOf("data-") === 0) x.removeAttribute(a); }
        });
        ghost.className += " bd-lot-ghost"; ghost.setAttribute("aria-hidden", "true"); ghost.inert = true;
        n.appendChild(ghost); left++;
        ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-out", fill: "forwards" }).onfinish = done;
      }
      if (inner) inner.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
      if (!reduce && was.h && Math.abs(h - was.h) > 1) { left++; n.animate([{ height: was.h + "px" }, { height: h + "px" }], { duration: 220, easing: EASE }).onfinish = done; }
      if (!left) n.classList.remove("is-swapping");
      return;
    }
    if (bids > was.bids) {
      var pn = n.querySelector(".bd-price-n");
      if (pn) pn.animate(reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: "translateY(45%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 200, easing: EASE });
      var fl = n.querySelector(".bd-flash"); if (fl) fl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, easing: "ease-out" });
    }
  }
  var DIRTY = null;
  function mark(o) {
    if (!DIRTY) { DIRTY = { all: false, pids: {}, rail: false }; Promise.resolve().then(flush); }
    if (o.all) DIRTY.all = true;
    if (o.rail) DIRTY.rail = true;
    if (o.pid) DIRTY.pids[o.pid] = 1;
  }
  function flush() {
    var d = DIRTY; DIRTY = null; if (!d) return;
    S2.$$('[data-w="ccbids"]').forEach(function (el) { fill(el, ccInner()); });
    var root = S2.$("#bdRoom"); if (!root) return;
    var R = read();
    /* the nights themselves can change (the real market's calendar arrives after the first paint): the picker and the
       how-it-works line follow, the picker swapped in place and bound again */
    var nk = S2.$("#bdNights", root), keys = K.bidNights().map(function (b) { return b.key; }).join();
    if (nk && nk.dataset.keys !== keys) { NIGHTS = picker(swap(nk, pickerHtml(R.key))); }
    var hh = S2.$("#bdHowH", root), hp = S2.$("#bdHowP", root);
    if (hh) hh.textContent = howTitle();
    if (hp) hp.textContent = nightsLine();
    var ld = S2.$("#bdLadder", root), fx = S2.$("#bdFacts", root);
    if (ld) ld.textContent = ladderLine();
    if (fx && fx.dataset.k !== String(K.MIN)) { fx.innerHTML = factsInner(); fx.dataset.k = String(K.MIN); }
    fill(S2.$("#bdNow", root), nowHtml(R));
    fill(S2.$("#bdRail", root), railHtml(R));
    fill(S2.$("#bdSumHost", root), sumHtml(R));
    var ct = S2.$("#bdCount", root); if (ct) ct.textContent = countText(R);
    root.className = roomCls(R);
    /* the recap changes only with the night or its state (a closed night's Discord card is not redrawn on every bid) */
    var recap = S2.$("#bdRecap", root), rk = R.key + "|" + (R.room ? R.room.state : "none");
    if (recap && (d.all || recap.dataset.k !== rk)) { fill(recap, recapHtml(R)); recap.dataset.k = rk; }
    var lh = S2.$("#bdLotsH", root); if (lh) lh.textContent = lotsHead(R);
    var host = S2.$("#bdLots", root);
    /* a touched lot is swapped where it stands; one that now enters or leaves the filter redraws the list (order is the
       room's fixed order, so nothing moves under the pointer). A full redraw reads every old lot first, so a lot that
       changed in it still rolls, flashes or cross-fades */
    var shown = filtered(R).map(function (l) { return l.pid; }), have = S2.$$(".bd-lot", host).map(function (x) { return x.dataset.pid; });
    if (d.all || shown.join() !== have.join()) {
      var was = {}; S2.$$(".bd-lot", host).forEach(function (el) { was[el.dataset.pid] = snap(el); });
      fill(host, lotsHtml(R));
      S2.$$(".bd-lot", host).forEach(function (n) { animateLot(n, was[n.dataset.pid]); });
    } else Object.keys(d.pids).forEach(function (pid) {
      var el = host.querySelector('.bd-lot[data-pid="' + pid + '"]'), l = lotOf(R, pid); if (!el || !l) return;
      var w = snap(el);
      animateLot(swap(el, lotHtml(l, R)), w);
    });
    if (LS && LS.sh.el.isConnected) { var l = lotOf(R, LS.pid); if (l) fill(LS.sh.body, sheetHtml(l, R)); }
    if (RS && RS.el.isConnected) fill(RS.body, railHtml(R));
  }
  /* once a second: text and ring offsets only, never a re-render */
  function tick() {
    if (K.bidPause()) return;   /* a paused room's countdowns stand still (2026-11-23) */
    var t = K.now(), C = 2 * Math.PI * 19;
    S2.$$("[data-bd-ends]").forEach(function (el) {
      var left = Math.max(0, +el.dataset.bdEnds - t), f = el.dataset.bdFmt;
      if (f === "ring") {
        var v = el.querySelector(".bd-ring-v"), n = el.querySelector(".bd-ring-n");
        if (v) v.style.strokeDashoffset = (C * (1 - Math.min(1, K.LOT_MS ? left / K.LOT_MS : 1))).toFixed(2);
        if (n) n.textContent = mmss(left);
        el.classList.toggle("low", left < 60000);
      } else {
        el.textContent = f === "far" ? far(left) : mmss(left);
        if (el.classList.contains("bd-big-n") && f !== "far") el.classList.toggle("low", left < 60000);
      }
    });
  }
  /* what a lot showed when it was last drawn: a read that changes nothing on a lot leaves its card (and the button under
     a finger) where it is (review 2026-11-03: redrawing all 25 lots for one sale cut every other lot's motion short and
     swapped a button mid-press). A Realtime raise reads the whole room again, so the room swaps only what moved */
  var SEEN = {};
  function lotSig(l) { return [l.state, l.bids, l.price, l.next, l.endsAt, l.mine, l.soldTo, l.why, l.board ? l.board.rank + ":" + l.board.ceiling : "", !!SAY[l.pid]].join("|"); }
  document.addEventListener("s2:market", function (e) {
    var d = e.detail || {}, t = d.type;
    if (t === "tick") { tick(); return; }
    if (t !== "load") return;
    /* a refusal said on a lot ends with that price: it stands only while its lot is where it was (no new bid since).
       Kept before the on-screen check, because the refusals outlive the page: review 2026-11-03 (second pass), a Dec 19
       "no open roster spot" said while the viewer was elsewhere came back on 21 lots of Jan 9 */
    var R = read();
    Object.keys(SAY).forEach(function (pid) { var l = lotOf(R, pid); if (!l || l.bids !== SAY[pid].bids || l.next == null) delete SAY[pid]; });
    if (!S2.$("#bdRoom") && !S2.$('[data-w="ccbids"]')) return;
    var moved = (R.room ? R.room.lots : []).filter(function (l) { return SEEN[l.pid] !== lotSig(l); });
    if (!moved.length) mark({ rail: true });
    moved.forEach(function (l) { mark({ pid: l.pid, rail: true }); });
  });

  /* ---------- the Control Center's pool step: a short read of the room, bidders hidden while it runs ---------- */
  /* review 2026-11-03: the engine's default room moves to the next night the moment a room closes, which took the
     night's signings away from the commissioner's step; for a day after a room closes the step leads with that night's
     recap and a link to its results, then the next night's preview */
  function ccLink(key) {
    var b = bidNight(key);
    return b ? '<a class="arrow" href="#/bidding?night=' + encodeURIComponent(key) + '"><span>' + esc(b.short + " results in the bid room") + "</span>" + S2.ic("chev") + "</a>" : "";
  }
  function ccHeld(key) {
    var rc = K.recap(key), b = bidNight(key); if (!rc || !b) return "";
    return '<div class="bd-cc"><h4 class="t-cap bd-cc-h">' + esc("Last bid night, " + b.short + " · closed") + '</h4><p class="t-foot">' + esc(rc.text) + "</p>" + ccLink(key) + "</div>";
  }
  function ccInner() {
    /* the step reads the market itself, so the Control Center never needs the room open first; ensure() reads only the
       first time (or for a new viewer), never again after a failure, so asking on every repaint is safe */
    K.ensure();
    var st = K.status();
    if (st.error) return '<p class="t-foot" role="alert">' + esc("The bids could not be read (" + st.error + "). Reload the page to try again.") + "</p>";
    if (!st.loaded) return '<p class="t-foot">Reading the bids.</p>';
    var r = K.room(null, { as: null }), jk = justHeld(), held = jk && (!r || r.key !== jk) ? ccHeld(jk) : "";
    if (!r) return held || '<p class="t-foot">' + (noNights() ? "No bid night is set yet; the nights come with the Season 2 schedule." : "No bid night is left before the movement deadline.") + "</p>";
    var withBids = r.lots.filter(function (l) { return l.bids; });
    var rows = withBids.filter(function (l) { return l.state === "running"; }).concat(withBids.filter(function (l) { return l.state === "sold"; })).slice(0, 6);
    var head = r.night.short + " · " + (r.state === "before" ? "opens 9:00 PM" : STATE_WORD[r.state].toLowerCase()) + " · " + plural(r.lots.length, "lot");
    return held + '<div class="bd-cc"><h4 class="t-cap bd-cc-h">Bids, ' + esc(head) + "</h4>" +
      (rows.length ? '<div class="list bd-cc-l">' + rows.map(function (l) {
        return '<div class="row"><span class="grow"><span class="title">' + esc(l.tag) + '</span><span class="sub">' +
          esc(l.state === "sold" ? "Sold to " + full(l.soldTo) + " · " + plural(l.bids, "bid") : "Running · bidder hidden · " + plural(l.bids, "bid")) + '</span></span><span class="trail num">' + esc(money(l.price)) + "</span></div>";
      }).join("") + "</div>" + (withBids.length > rows.length ? '<p class="t-foot">And ' + plural(withBids.length - rows.length, "more lot") + " with bids in the bid room.</p>" : "")
        : '<p class="t-foot">' + esc(r.state === "before" ? "No bids yet: " + plural(r.lots.length, "player") + " open at 9:00 PM on " + r.night.label + "." : r.state === "closed" ? "No player was bid on." : "No bid yet tonight.") + "</p>") +
      (r.state === "closed" ? ccLink(r.key) : "") + "</div>";
  }
  S2.bidding = { ccBids: ccInner };

  /* ---------- the page ---------- */
  var FILTERS = [["all", "All"], ["running", "Running"], ["board", "Board"], ["over", "Over"]];
  var UNITS = [["all", "All", "All positions"], ["F", "F", "Forwards"], ["D", "D", "Defense"], ["G", "G", "Goaltenders"]];
  function segHtml(id, opts, cur, label) {
    return '<div class="seg" id="' + id + '" role="group" aria-label="' + esc(label) + '">' + opts.map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" data-key="' + id + "-" + o[0] + '" aria-pressed="' + (o[0] === cur) + '"' + (o[2] ? ' aria-label="' + esc(o[2]) + '"' : "") + ">" + esc(o[1]) + "</button>"; }).join("") + "</div>";
  }
  /* the price ladder in words: the season's own opening bid and step (S2.market.MIN and STEP, season_rules mk) once the
     market is read, never figures written here */
  function ladderLine() {
    return "Each lot has one button with the exact price: " + (K.MIN != null ? "bids open at " + money(K.MIN) + " and every raise is exactly " + money(K.STEP) + " more" : "bids open at the season's opening price and every raise is exactly one step more") +
      ", so there is no amount to type. A club that holds the top bid waits for another club to raise (Rule S2.6).";
  }
  function factsInner() {
    var known = K.MIN != null;
    return [
      ["Who may be bid on", "A training camp pool player with six (6) games or more, every one of them from 9:00 PM. The list is fixed then."],
      ["First bid", known ? money(K.MIN) + ", from any club" : "The season's opening price, from any club"], ["Each raise", known ? "Exactly " + money(K.STEP) + " more than the last bid" : "Exactly one step more than the last bid"],
      ["Two in a row", "Never. A club holding the top bid waits until another club raises it."],
      ["The countdown", "Five minutes from each bid; a raise starts it again. When it runs out, the top bid signs the player to the end of the season."],
      ["At 10:00 PM", "No bidding opens on a new player. Countdowns already running finish."],
      ["Room to bid", "An open roster spot and cap room for the bid, counting every bid the club already leads"],
      ["Bidders", "Hidden until the bidding on that player is over"], ["No bid", "The player returns to the pool, still eligible"]
    ].map(function (f) { return "<div><dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd></div>"; }).join("");
  }
  /* the bid nights in words, from the market's calendar (the database's on the real site), never a date written here */
  /* the kit's segmented control needs a button to place its thumb on: no nights yet (the real calendar before the
     schedule is set), no control */
  function picker(el) { return el && S2.$("button", el) ? S2.segmented(el, onNight) : null; }
  function onNight(v) { VIEW.pick = v; setQ(v); SAY = {}; mark({ all: true }); }
  function heldNights() { return K.bidNights().filter(function (b) { return !b.skipped; }); }
  function howTitle() { var n = heldNights().length; return n ? "One hour, " + word(n) + (n === 1 ? " Saturday" : " Saturdays") : "One hour on Saturdays"; }
  function nightsLine() {
    var h = heldNights().map(function (b) { return b.label.replace(/^\w+, /, ""); }), off = K.bidNights().some(function (b) { return b.skipped; });
    if (!h.length) return "Bid nights fall on the Saturday of every game week after the draft and before the movement deadline; they show here once the Season 2 schedule is set (Rule S2.6).";
    return "Bid nights fall on the Saturdays after the draft and before the movement deadline: " + (h.length < 2 ? h[0] : h.slice(0, -1).join(", ") + " and " + h[h.length - 1]) + "." + (off ? " The holiday weeks have none" : "") + " (Rule S2.6).";
  }
  /* the league pulse never re-routes the room (a soft route mid-hour swapped every lot under the bidders): the market's
     own domains read the market again and arrive as "load" above, and the rest (ratings, schedule, clubs, people) repaint
     the room in place from the model the pulse just refilled */
  if (S2.LIVE_DOMAINS) Object.keys(S2.LIVE_DOMAINS).forEach(function (d) {
    if (d === "market" || d === "rosters" || d === "signups") return;
    S2.live.on(d, function () { if (S2.$("#bdRoom") || S2.$('[data-w="ccbids"]')) mark({ all: true }); });
  });
  S2.page("bidding", {
    title: "Bid room", tab: "season", repaintsItself: true,
    render: function (rq) {
      K.ensure();   /* the market is read when a page asks; each answer repaints the room in place */
      if (rq && rq.q && rq.q.night && bidNight(rq.q.night)) VIEW.pick = rq.q.night;
      VIEW.want = rq && rq.q && rq.q.night || null;
      if (!acts() && VIEW.filter === "board") VIEW.filter = "all";
      var R = read(), filters = acts() ? FILTERS : FILTERS.filter(function (f) { return f[0] !== "board"; });
      return '<div id="bdRoom" class="' + roomCls(R) + '">' +
        '<div class="bd-crumbs">' + S2.crumbs([["#/season", "Season 2"], ["", "Bid room"]]) + "</div>" +
        '<section class="band ink bd-band reveal" data-theme="dark" data-look-scope data-finish="' + esc(S2.state.finish) + '" aria-label="The bid night">' +
          '<div id="bdNow">' + nowHtml(R) + "</div>" +
          '<div class="bd-band-ctl">' + pickerHtml(R.key) + "</div></section>" +
        '<section class="bd-main" aria-label="The lots and your club">' +
          '<aside class="bd-rail" id="bdRail" aria-label="' + (R.as ? "Your club" : "Taking part") + '">' + railHtml(R) + "</aside>" +
          '<div class="bd-lots-col"><div class="bd-sum-host" id="bdSumHost">' + sumHtml(R) + "</div>" +
            /* a closed night shows its recap in place of the lots: who signed where, the players back in the pool and the
               #news post; each signing still opens its lot and bid history */
            '<div id="bdRecap" data-k="' + esc(R.key + "|" + (R.room ? R.room.state : "none")) + '">' + recapHtml(R) + "</div>" +
            /* review 2026-11-03: the headline carries the list's news ("22 players still waiting for a first bid"); how the
               one button works moved into the sentence under it */
            '<div class="sec-head bd-lots-h"><div class="copy"><span class="kicker">The lots</span><h2 class="d-2" id="bdLotsH">' + esc(lotsHead(R)) + "</h2>" +
              '<p id="bdLadder">' + esc(ladderLine()) + "</p></div></div>" +
            '<div class="bd-tools">' + segHtml("bdFilter", filters, VIEW.filter, "Show") + segHtml("bdUnit", UNITS, VIEW.unit, "Position group") + "</div>" +
            /* not a live region: rival bids would read it out all hour; the viewer's own results go through #bdLive */
            '<p class="bd-count" id="bdCount">' + esc(countText(R)) + "</p>" +
            '<div class="bd-lots" id="bdLots">' + lotsHtml(R) + "</div></div></section>" +
        '<section class="bd-sec" aria-labelledby="bdHowH"><div class="sec-head"><div class="copy"><span class="kicker">How Saturday bidding works</span><h2 class="d-2" id="bdHowH">' + esc(howTitle()) + "</h2>" +
          '<p id="bdHowP">' + esc(nightsLine()) + "</p></div>" +
          '<a class="arrow" href="#/rulebook?rule=S2.6"><span>Rule S2.6</span>' + S2.ic("chev") + "</a></div>" +
          '<dl class="bd-facts" id="bdFacts" data-k="' + esc(String(K.MIN)) + '">' + factsInner() + "</dl></section>" +
        S2.about(["The room is the league's own: the nights, the lots, the prices and the countdowns come from the league's market as it runs, and a bid counts only once the league has taken it.",
          "Season 2 cap room is the " + esc(money(M.RULES.s2.cap)) + " cap less the active roster, since Season 2 has no club camps. The rules are " + rule("S2.5") + " and " + rule("S2.6") + "."]) +
        '<p class="sr" aria-live="polite" id="bdLive"></p></div>';
    },
    after: function (root) {
      var room = S2.$("#bdRoom", root); if (!room) return;
      live = S2.$("#bdLive", room);
      K.watchRoom();
      NIGHTS = picker(S2.$("#bdNights", room));
      S2.segmented(S2.$("#bdFilter", room), function (v) { VIEW.filter = v; mark({ all: true }); });
      S2.segmented(S2.$("#bdUnit", room), function (v) { VIEW.unit = v; mark({ all: true }); });
      room.addEventListener("click", onClick);
      room.addEventListener("change", onChange);
    }
  });
})();
