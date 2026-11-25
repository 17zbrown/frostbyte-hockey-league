/* #/draft, the Season 2 draft room. Moved whole from js/pages/league.js by the e0 split (2026-11-24). It loads after
   league.js and reads the league pages' shared pieces (the hero, section heads, tabs) from S2._league.
   v5.00 swap (g4, 2026-11-24): the room is the REAL draft: the board, the clock and every pick come from s2_league's
   draft section (S2.M.draft) and the Realtime channel the current site's room uses, and every action is a database door
   through S2.write (THE LIVE ROOM, below). v5.00 swap (i3b, 2026-11-25): the mock room the commissioner played with
   (commissioner, 2026-10-19: "The concept should be fully open for all buttons to play with") is gone, with its sample
   pool, its simulated clubs, its rule overrides and its carried state; the room runs only its real path.
   The rules the room mirrors (the database is the gate; the room only explains), from the rulebook (part3_content.js):
     Rule 2.8   the order is drawn at random (a snake when the board was generated as one); one clock a pick (120 seconds
                by default, a commissioner sets it); a clock that runs out skips the pick; pay is by round, the last round
                $750,000 and each round above it one $250,000 step (CG.draftRoundSalary); the commissioner pauses, resets the
                clock, skips, reverses a pick, picks for a club or concludes the draft.
     Rule S2.3  ten rounds (the board's own), the Owner and GM seated before the night; the AGM is nominated only after the
                draft, from the club's own roster (commissioner, 2026-11-23); every selection a club never used is replaced
                after the draft by a random registered player who fits, at $750,000 (RULED 2026-11-23), and a pick with no
                fill that fits lapses.
     Rule S2.4  twelve players for the whole season, and the database refuses a pick that would leave a club unable to reach
                three forwards, two defensemen and one goaltender inside its twelve (draft_fits).
     Rule S2.5  everyone not drafted joins the league-wide training camp pool. */
(function () {
  "use strict";
  var S2 = window.S2;
  var LEAGUE = S2._league;
  var M = LEAGUE.M, about = LEAGUE.about, arrow = LEAGUE.arrow,
    cal = LEAGUE.cal, cap = LEAGUE.cap, cr = LEAGUE.cr, esc = LEAGUE.esc, fact = LEAGUE.fact, fail = LEAGUE.fail,
    hero = LEAGUE.hero, inkBand = LEAGUE.inkBand, intoRow = LEAGUE.intoRow, list = LEAGUE.list,
    ord = LEAGUE.ord, paras = LEAGUE.paras, plural = LEAGUE.plural, rule = LEAGUE.rule, searchBox = LEAGUE.searchBox,
    secHead = LEAGUE.secHead, swap = LEAGUE.swap, teamName = LEAGUE.teamName, utabs = LEAGUE.utabs, word = LEAGUE.word;

  /* the room's state, rebuilt from S2.M on every paint (drFromLive); the database holds the draft, so nothing is carried */
  var DR = null, DR_IV = 0;
  var DR_SECS = [15, 30, 60, 120];
  var DR_UNIT = { F: ["forward", "forwards"], D: ["defenseman", "defensemen"], G: ["goaltender", "goaltenders"] };
  var DR_UNITS = [["all", "All"], ["F", "Forwards"], ["D", "Defense"], ["G", "Goaltenders"]];
  var DR_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  /* the rounds are the board's (draft_pick_salary sizes the pay scale from the board that exists) */
  function drRounds() { return DR.rounds; }
  function drPay(round) { return 750000 + (drRounds() - round) * 250000; }
  function drTaken() { var t = {}; DR.picks.forEach(function (k) { if (k.pid) t[k.pid] = k.club; }); return t; }
  function drOn() { return DR.status === "done" ? null : DR.picks[DR.cur] || null; }
  function drLast() { return drLastLive(); }
  /* the club this reader drafts for: the club whose seat they hold (S2.session), and nobody else */
  function drMine() { return drMeLive().mine; }
  function drShown() { return drMine() || (DR.watch && M.team(DR.watch) ? DR.watch : DR.order[0] || (M.teams[0] || {}).code); }
  /* the season's rules, read each time (S2.buildModel refills S2.M in place, so a copy taken at load would go stale) */
  function drMin() { return M.RULES.s2.min; }
  function drLimit() { return drRow().roster_max || M.RULES.s2.limit; }
  function drNeed(c) { var o = { total: 0 }, mn = drMin(); ["F", "D", "G"].forEach(function (g) { o[g] = Math.max(0, mn[g] - c[g]); o.total += o[g]; }); return o; }
  function drNeedText(n) {
    return list(["F", "D", "G"].filter(function (g) { return n[g]; }).map(function (g) { return n[g] === 1 ? (g === "G" ? "a goaltender" : "one more " + DR_UNIT[g][0]) : n[g] + " " + DR_UNIT[g][1]; }));
  }
  function drWhen() { var d = cal(2, "draft_at"); return d ? M.etLong(d.at) + " at " + d.time + " ET" : "on draft night"; }

  /* ---------- the clock: one interval while the room is on screen ---------- */
  function drArm() { if (!DR_IV) DR_IV = setInterval(drTickLive, 100); }
  function drStop() { clearInterval(DR_IV); DR_IV = 0; }
  function drClock() {
    var el = document.getElementById("drClock"), bar = document.getElementById("drBar"); if (!el) return;
    var ms = DR.status === "live" ? Math.max(0, DR.endsAt - Date.now()) : DR.status === "paused" ? DR.left : DR.secs * 1000;
    var s = Math.ceil(ms / 1000), t = Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2);
    if (el.textContent !== t) el.textContent = t;
    if (bar) bar.style.transform = "scaleX(" + Math.max(0, Math.min(1, ms / (DR.secs * 1000))).toFixed(3) + ")";
    var k = drOn(); el.classList.toggle("low", DR.status === "live" && ms <= 10000 && !!k && k.club === drMine());
  }
  /* a board cell shows its round below and points to the pick */
  function drCell(n) {
    var k = DR.picks.filter(function (x) { return x.n === n; })[0], cur = drOn(); if (!k) return;
    DR.view = k.round; DR.follow = !!cur && cur.round === k.round;
    var h = document.getElementById("drRoundHost"); if (h) h.innerHTML = drRoundHtml();
    var li = document.getElementById("drp" + n); if (!li) return;
    li.scrollIntoView({ block: "center", behavior: S2.reduce.matches ? "auto" : "smooth" });
    if (li.animate) li.animate([{ backgroundColor: "var(--accent-soft)" }, { backgroundColor: "transparent" }], { duration: 1400, easing: "ease-out" });
  }
  function drRound(v) {
    var cur = drOn();
    if (v === "live") { DR.follow = true; if (cur) DR.view = cur.round; }
    else { DR.view = +v; DR.follow = !!cur && cur.round === DR.view; }
    var h = document.getElementById("drRoundHost"); if (h) h.innerHTML = drRoundHtml();
    var b = h && h.querySelector('[data-round="' + (v === "live" ? DR.view : v) + '"]'); if (b) { b.focus({ preventScroll: true }); intoRow(b); }
  }

  /* ---------- the room's widgets, each repainted in place (never the page) ---------- */
  function drNowHtml() {
    var k = drOn(), st = DR.status, mine = drMine(), last = drLast(), head;
    if (st === "done") {
      var open = DR.picks.filter(function (x) { return !x.pid; }).length, made = DR.picks.length - open;
      head = '<div class="lg-dr-who"><span class="kicker">Complete</span><p class="d-1 lg-dr-club" id="drHead" tabindex="-1">The draft is over</p>' +
        '<p class="lg-dr-meta">' + esc(plural(made, "selection", "selections") + " made." + (open ? (open === 1 ? " The skipped pick is" : " Each of the " + open + " skipped picks is") +
          " filled at random about ten minutes after the draft, at $750K, by an undrafted player who keeps the club able to reach the minimums; a pick with no such player lapses (Rule S2.3)." : "") +
          " Players not drafted join the league-wide training camp pool (Rule S2.5).") + "</p></div>";
    } else if (!k) {
      /* between a pick and the state that names the next one (or a board whose current pick is not on it): the room says
         so instead of guessing; the next state or the reconcile read settles it */
      head = '<div class="lg-dr-who"><span class="kicker">' + (st === "paused" ? "Paused" : "Live") + '</span><p class="d-1 lg-dr-club" id="drHead" tabindex="-1">Moving to the next pick</p></div>';
    } else {
      var you = k.club === mine;
      head = '<div class="lg-dr-who"><span class="kicker">' + (st === "idle" ? "First on the clock" : st === "paused" ? "Paused" : you ? "You are on the clock" : "On the clock") + "</span>" +
        '<div class="lg-dr-team">' + cr(k.club, "lg") + '<p class="d-1 lg-dr-club" id="drHead" tabindex="-1">' + esc(M.team(k.club).name) + "</p></div>" +
        '<p class="lg-dr-meta">' + esc("Round " + k.round + ", pick " + k.slot + ", " + ord(k.n) + " overall. The pick pays " + M.money(drPay(k.round)) + ".") + "</p></div>" +
        '<div class="lg-dr-clockbox' + (you ? " you" : "") + '"><span class="d-num lg-dr-clock" id="drClock" role="timer" aria-label="Time left on the clock">0:00</span><span class="lg-dr-bar" aria-hidden="true"><i id="drBar"></i></span>' +
        '<span class="lg-dr-secl">' + DR.secs + " seconds a pick</span></div>";
    }
    var lp = last && last.pid && M.player(last.pid);
    var lastLine = last ? '<p class="lg-dr-last"><span class="kicker">Last pick</span><span>' + (lp ? '<a href="' + esc(lp.href) + '">' + esc(lp.tag) + "</a>, " + esc(lp.posName || lp.pos || drPosName(last.pid)) + ", to the " + esc(teamName(last.club)) + " (" + ord(last.n) + " overall)" :
      "The " + esc(teamName(last.club)) + " pick (" + ord(last.n) + " overall) was skipped") + "</span></p>" : "";
    return '<div class="lg-dr-now">' + head + "</div>" + lastLine + drSyncLine() + drActsLive();
  }
  function drMineHtml() { return drMineHtmlLive(); }
  function drBoardHtml() { return drBoardHtmlLive(); }
  function drPoolCount() { return drPoolCountLive(); }
  function drPoolHtml() { return drPoolHtmlLive(); }
  /* the board: clubs across in the drawn order, rounds down, so the snake reads in the pick numbers */
  function drGridHtml() {
    var mine = drMine(), cur = drOn(), html = '<span class="lg-dr-gh lg-dr-g0" aria-hidden="true"></span>';
    DR.order.forEach(function (c) { html += '<span class="lg-dr-gh' + (c === mine ? " me" : "") + '" title="' + esc(teamName(c)) + '">' + cr(c) + '<span class="lg-dr-gc">' + esc(c) + "</span></span>"; });
    for (var r = 1; r <= drRounds(); r++) {
      html += '<span class="lg-dr-gr num" aria-hidden="true">R' + r + "</span>";
      DR.order.forEach(function (c) {
        /* the cell is the pick of the club across, its original owner (orig), so a pick traded away keeps its column and
           names the club that holds it now (draft_make_pick follows current_team_id) */
        var k = DR.picks.filter(function (x) { return x.round === r && (x.orig || x.club) === c; })[0];
        if (!k) { html += '<span class="lg-dr-cell" aria-hidden="true"></span>'; return; }
        var p = k.pid && M.player(k.pid), u = p && drUnitOf(k.pid);
        var state = p ? "made u-" + u : k.skipped ? "skip" : k === cur ? "now" : "";
        var via = k.club !== c ? ", held by the " + teamName(k.club) : "";
        var label = ord(k.n) + " overall, round " + r + ", " + teamName(c) + via + ": " + (p ? p.tag + ", " + (p.posName || p.pos || drPosName(k.pid)) : k.skipped ? "skipped" : k === cur ? "on the clock" : "still to come");
        html += '<button type="button" class="lg-dr-cell ' + state + (k.club === mine ? " me" : "") + '" data-cell="' + k.n + '" data-key="g-' + k.n + '" aria-label="' + esc(label) + '">' +
          '<span class="lg-dr-cn num">' + k.n + '</span><span class="lg-dr-ct">' + (p ? esc(p.tag) : k.skipped ? "Skipped" : k === cur ? "On the clock" : "") + '</span><span class="lg-dr-cu">' + (p ? u : "") + "</span></button>";
      });
    }
    return '<div class="lg-dr-grid" role="group" aria-label="Draft board: clubs in the drawn order, one row a round">' + html + "</div>";
  }
  function drRoundHtml() {
    var cur = drOn(), live = cur ? cur.round : null, chips = [];
    if (DR.follow && live) DR.view = live;
    for (var r = 1; r <= drRounds(); r++) chips.push('<button type="button" class="lg-dr-rt" data-round="' + r + '" data-key="r-' + r + '" aria-pressed="' + (r === DR.view) + '">Round ' + r + (r === live ? '<i class="lg-dr-dot" aria-label=", on the clock"></i>' : "") + "</button>");
    if (live && !DR.follow) chips.push('<button type="button" class="lg-dr-rt live" data-round="live" data-key="r-live">Follow the clock</button>');
    var picks = DR.picks.filter(function (x) { return x.round === DR.view; });
    return '<div class="lg-hscroll"><div class="lg-dr-rtabs" role="group" aria-label="Round">' + chips.join("") + "</div></div>" +
      '<p class="lg-dr-rh">' + esc("Round " + DR.view + " pays " + M.money(drPay(DR.view)) + " a pick and runs " + (DR.view % 2 || !DR.snake ? "in the drawn order." : "in reverse order.")) + "</p>" +
      '<ol class="lg-dr-rl">' + picks.map(function (k) {
        var p = k.pid && M.player(k.pid);
        var what = p ? '<a href="' + esc(p.href) + '">' + esc(p.tag) + '</a><span class="lg-dr-rs">' + esc(p.posName || p.pos || drPosName(k.pid)) + "</span>" :
          k.skipped ? '<span class="lg-dr-rs">Skipped, filled at random after the draft</span>' : k === cur ? '<span class="chip live">On the clock</span>' : "";
        var from = k.orig && k.orig !== k.club ? ", from the " + teamName(k.orig) : "";
        return '<li id="drp' + k.n + '" class="' + (k === cur ? "now" : "") + (k.club === drMine() ? " me" : "") + '"><span class="lg-dr-on d-num">' + k.n + "</span>" + cr(k.club) +
          '<span class="lg-dr-rb"><span class="lg-dr-rc">' + esc(M.team(k.club).name) + '</span><span class="lg-dr-rs">' + esc("Pick " + k.slot + from) + "</span></span>" + '<span class="lg-dr-rw">' + what + "</span></li>";
      }).join("") + "</ol>";
  }
  function drPaint() {
    var room = document.getElementById("drRoom"); if (!room) return;
    /* QA motion 4 (2026-11-25): the pick on the clock before this paint, so the pick that just landed can be marked once
       the hosts are drawn again (below). None on the first paint */
    var was = DR && DR.picks && DR.picks.length && DR.status !== "done" ? (drOn() || {}).n || null : null;
    DR = drFromLive(DR);
    /* a board that appears (generated) or goes (regenerated to nothing) changes the room's shape: the room's body is drawn
       again in place and its fields bound again, never the page (the router) */
    if (!!DR.picks.length !== !!document.getElementById("drNow")) { room.innerHTML = drRoomInner(); drBindParts(room); }
    drOnClockToast();
    if (DR.status !== "done" && DR.picks.length) drArm();
    var act = document.activeElement, key = act && room.contains(act) ? act.getAttribute("data-key") : null, had = act && room.contains(act);
    [["drNow", drNowHtml], ["drMineHost", drMineHtml], ["drBoardHost", drBoardHtml], ["drPoolList", drPoolHtml], ["drPoolCount", drPoolCount], ["drGrid", drGridHtml], ["drRoundHost", drRoundHtml]].forEach(function (x) {
      var h = document.getElementById(x[0]); if (h) h.innerHTML = x[1]();
    });
    drClock();
    drFlash(was);
    /* focus stays on the control that was pressed; if that control is gone (the player was drafted), it goes to the clock.
       A field the repaint did not touch (the search, the club to follow) keeps its focus: a pick that lands while the
       reader types never takes the field from them (picks arrive from other clubs at any moment) */
    if (had && !act.isConnected) { var n = key && room.querySelector('[data-key="' + key + '"]'); (n || document.getElementById("drHead") || room).focus({ preventScroll: true }); }
  }
  /* QA motion 4 (2026-11-25): a pick that lands from Realtime (draft_picks or draft_state) is marked where the eye is, its
     board cell and its row in the round list, with the bid room's 900 ms accent fade (bidding.js) and the same fill as a
     cell the reader opens (drCell). Color only, so Reduce Motion keeps it. Only the pick that was on the clock, and only
     when the clock moved one pick (or the draft ended on it): a jump of several picks is a catch-up, not a pick landing */
  function drFlash(was) {
    if (!was) return;
    var k = DR.picks.filter(function (x) { return x.n === was; })[0]; if (!k || !(k.pid || k.skipped)) return;
    var cur = drOn(), last = DR.picks.reduce(function (m, x) { return Math.max(m, x.n); }, 0);
    if (cur ? cur.n !== was + 1 : !(DR.status === "done" && was === last)) return;
    [document.getElementById("drp" + was), document.querySelector('#drRoom [data-cell="' + was + '"]')].forEach(function (el) {
      if (el && el.animate) el.animate([{ backgroundColor: "var(--accent-soft)" }, { backgroundColor: "transparent" }], { duration: 900, easing: "ease-out" });
    });
  }
  function drBind(root) {
    var room = S2.$("#drRoom", root); if (!room) return;
    room.addEventListener("click", function (e) {
      var b = e.target.closest("[data-dr], [data-draft], [data-star], [data-cell], [data-round], [data-sec]"); if (!b) return;
      if (b.dataset.dr) drActLive(b.dataset.dr);
      else if (b.dataset.draft) drTryLive(b.dataset.draft);
      else if (b.dataset.star) drStarLive(b.dataset.star);
      else if (b.dataset.cell) drCell(+b.dataset.cell);
      else if (b.dataset.round) drRound(b.dataset.round);
      else if (b.dataset.sec) drSecsLive(+b.dataset.sec);
    });
    drBindParts(room);
    drClock();
    drEnterLive();
  }
  /* the room's own fields (the search, the position tabs, the club to follow), bound again whenever the room's body is
     drawn again; the clicks are the room's, bound once above */
  function drBindParts(room) {
    var q = S2.$("#drQ", room), list = S2.$("#drPoolList", room), count = S2.$("#drPoolCount", room);
    if (q) q.addEventListener("input", function () { DR.q = q.value; DR.shown = 30; list.innerHTML = drPoolHtml(); count.innerHTML = drPoolCount(); });
    var seg = S2.$("#drUnit", room);
    if (seg) S2.segmented(seg, function (v, b) { DR.unit = v; DR.shown = 30; intoRow(b); swap(list, drPoolHtml(), true); count.innerHTML = drPoolCount(); });
    var sel = S2.$("#drClubSel", room);
    if (sel) sel.addEventListener("change", function () { DR.watch = sel.value; drPaint(); });
  }

  /* =====================================================================================================
     THE LIVE ROOM (v5.00 swap, stream g4, 2026-11-24). The Season 2 draft runs here when the switch lands before
     Saturday, December 12. The current site's room is the reference for every action and every database call
     (src/live/part_live.js CG.ROUTES.draft, CG.hubDraftLive, CG.admDraftLive, CG.draftMinFit, CG.subscribeDraft):
       reads    S2.M.draft {state, picks} from s2_league (draft_state and draft_picks of the season on screen), the
                season's sign-ups (registration_pool), its rosters and the season row; the club's private board from
                draft_boards (RLS: the club's management and the league office), which s2_league does not carry.
       writes   every door through S2.write, nothing shown as done before the database answers: draft_make_pick (the
                club's own pick while live; a commissioner or the draft department for the club on the clock, paused
                too), start_draft, draft_conclude, draft_reverse_pick and generate_draft_board (commissioners only),
                draft_pause, draft_resume, draft_skip_pick and draft_reset_clock (a commissioner or the draft department;
                after the staffing flip, has_department('draft') is a commissioner or the seated Draft and Bidding
                manager), save_draft_board (the club's management, Owner approval through mgmt_gate) and
                draft_auto_advance (any signed-in member; only front offices, staff and commissioners call it).
       live     the Realtime channel "draft-live" on draft_state and draft_picks: the payload is applied to S2.M.draft at
                once and the room repaints in place; a jittered draft-only re-read through S2.reread, the one re-read
                (js/live.js; 1.5 to 9 s, front offices, staff and commissioners) covers a partial event; a safety re-read every 45 s (90 s for everyone else), never from
                a hidden tab, covers a socket that died quietly, and the channel is joined again on the next tick. Memory
                draft-night-api-stall-2026-09-19: that night 25 tabs stalled the API, so nothing here re-reads per pick
                for spectators, and when the draft completes every open room re-reads once, spread over two minutes.
     The rules the room mirrors (the database is the gate; the room only explains): Rule 2.8 (the order, the clock, a
     skipped pick, pay by round, the commissioner's controls), Rule S2.3 (ten rounds; a skipped pick filled at random
     after the draft at $750K, or lapsing) and Rule S2.4 (twelve players; 3 F / 2 D / 1 G reachable after every pick,
     draft_fits with roster_min_gap and _undrafted_left, D-SUPPLY 2026-11-23).
     ===================================================================================================== */
  /* knobs the room's suite turns down (tools/ui/draftroom.test.cjs); the numbers are the current site's (v2.71) */
  var DRL = S2._draftRoom = { reconcile: [1500, 9000], beat: [45000, 90000], done: 120000, boardSave: 1200, refire: 15000, resub: 5000 };
  var SYNC = { ch: null, ok: false, tried: false, none: false, subAt: 0, beatAt: 0, beating: false, recon: 0, doneT: 0, told: null, enterAt: 0 };
  var ADV = { busy: false, fails: 0, after: 0, fired: 0, jit: Math.floor(Math.random() * 1500) };
  var BOARD = { t: 0, pending: null };
  var DR_SEAT = { Owner: "Owner", GM: "General Manager", AGM: "Assistant General Manager" };
  function drSess() { return S2.session || {}; }
  function drCodeOf(id) { var t = id && M.teams.filter(function (x) { return x.id === id; })[0]; return t ? t.code : null; }
  /* who is reading, from the session (display hints only: the database decides every write). mine: the club whose
     seat they hold; runs: who may run the clock, skip and pick for the club on the clock, which is the database's own
     answer (DEPT below) or a commissioner; priv: a front office, staff or a commissioner, the browsers that advance an
     expired clock and reconcile within seconds (v2.71) */
  function drMeLive() {
    var s = drSess(), mine = s.seat ? s.teamCode || drCodeOf(s.teamId) : null;
    return { mine: mine && M.team(mine) ? mine : null, commish: !!s.isCommissioner, runs: !!s.isCommissioner || drDeptOk(), manager: (s.committees || []).indexOf("draft") >= 0,
      signedIn: !!s.user, priv: !!s.user && (!!s.seat || !!s.isStaff || !!s.isCommissioner) };
  }
  /* the draft key, asked of the database once per signed-in staffer (coordinator, 2026-11-24: mirror the gate, never guess
     it). draft_pause, draft_resume, draft_skip_pick, draft_reset_clock and a pick for the club on the clock allow
     is_commissioner() or has_department('draft'): before the staffing flip that is staff in the draft department, after
     it the seated Draft and Bidding manager (profile_has_department), and ordinary staff stay refused either way. So the
     room shows those controls exactly when has_department answers true (granted to authenticated, STABLE, a read), and
     needs no change when the flip lands. A commissioner is never asked; a failed answer is said, never read as no */
  var DEPT = { uid: null, ok: null, err: null, asking: false };
  function drDeptUid() { var s = drSess(); return s.user && !s.isCommissioner && (s.isStaff || (s.committees || []).length) ? s.user.id || s.profileId || "me" : null; }
  function drDeptOk() { var u = drDeptUid(); return !!u && DEPT.uid === u && DEPT.ok === true; }
  function drDeptAsk() {
    var u = drDeptUid(); if (!u || (DEPT.uid === u && (DEPT.asking || DEPT.ok !== null))) return;
    var sb = S2.ensureSb && S2.ensureSb();
    DEPT.uid = u; DEPT.ok = null; DEPT.err = null;
    if (!sb) { DEPT.err = "the league could not be reached"; drPaint(); return; }
    DEPT.asking = true;
    Promise.resolve(sb.rpc("has_department", { p_key: "draft" })).then(function (r) {
      if (r && r.error) throw r.error;
      DEPT.ok = !!(r && r.data === true);
    }).then(null, function (e) { DEPT.ok = null; DEPT.err = drErr(e); console.error("draft room: has_department('draft') could not be read", e); })
      .then(function () { DEPT.asking = false; drPaint(); });
  }
  function drSeasonNo() { var st = M.draft && M.draft.state; return (st && st.season_number) || (M.view && M.view.season) || null; }
  function drRow() { var s = M.control && M.control.season(DR && DR.season || drSeasonNo()); return (s && s.settings) || {}; }
  /* the room's state from the league's records; what the reader chose (search, tab, round, the club followed, the board,
     the seconds a commissioner will start with, writes in flight) is kept from the room before */
  function drFromLive(prev) {
    prev = prev || {};
    var D = M.draft || {}, st = D.state || null, codeOf = {}, sign = {};
    M.teams.forEach(function (t) { if (t.id) codeOf[t.id] = t.code; });
    (M.signups || []).forEach(function (r) { sign[r.pid] = r; });
    var rows = (D.picks || []).filter(function (r) { return r.overall_pick != null; }).slice().sort(function (a, b) { return a.overall_pick - b.overall_pick; });
    var slot = {}, rounds = 0;
    var picks = rows.map(function (r) {
      slot[r.round] = (slot[r.round] || 0) + 1; rounds = Math.max(rounds, r.round);
      /* the id first: a pick traded during the draft changes current_team_id, and the realtime row carries ids only */
      return { id: r.id, n: r.overall_pick, round: r.round, slot: slot[r.round], club: codeOf[r.current_team_id] || r.current_team || null,
        orig: codeOf[r.original_team_id] || r.original_team || null, pid: r.used ? r.player_id : null, skipped: !!r.skipped && !r.used, at: r.picked_at || null, by: null, forced: false };
    });
    var order = []; picks.forEach(function (k) { if (k.round === 1 && order.indexOf(k.orig) < 0) order.push(k.orig); });
    /* the board snakes when round two opens with the club that closed round one (generate_draft_board, format_rules
       draft_snake); read from the picks, so the room never disagrees with the board it shows */
    var r1 = picks.filter(function (k) { return k.round === 1; }), r2 = picks.filter(function (k) { return k.round === 2; });
    var snake = r1.length > 1 && r2.length > 0 && r2[0].orig === r1[r1.length - 1].orig;
    var status = !st || st.status === "setup" ? "idle" : st.status === "complete" ? "done" : st.status;
    var cur = 0;
    if (status === "live" || status === "paused") { cur = -1; picks.forEach(function (k, i) { if (k.n === st.current_overall) cur = i; }); }
    else if (status === "done") cur = picks.length;
    var secs = status === "idle" ? prev.chosen || (st && st.pick_seconds) || 120 : (st && st.pick_seconds) || 120;
    return { live: true, season: st ? st.season_number : drSeasonNo(), rounds: rounds || drRow().draft_rounds || M.RULES.s2.draftRounds, snake: snake,
      order: order, picks: picks, sign: sign, status: status, cur: cur, secs: secs, chosen: prev.chosen || null,
      endsAt: st && st.clock_ends_at ? Date.parse(st.clock_ends_at) : 0, left: (st && st.paused_remaining != null ? st.paused_remaining : secs) * 1000,
      placed: [], board: prev.board || {}, boardAt: prev.boardAt || 0, boardErr: prev.boardErr || null, busy: prev.busy || {},
      q: prev.q || "", unit: prev.unit || "all", shown: prev.shown || 30, view: prev.view || 1, follow: prev.follow == null ? true : prev.follow,
      watch: prev.watch || null, away: false, fast: false, reserved: null };
  }
  /* a player's position group in the draft: the sign-up's (draft_make_pick and draft_fits read season_registrations) */
  function drUnitOf(pid) { var s = DR.sign[pid], p = M.player(pid); return (s && M.UNIT[s.pos]) || (p && p.unit) || "F"; }
  function drPosName(pid) { var s = DR && DR.sign && DR.sign[pid]; return (s && M.posName(s.pos)) || ""; }
  function drLastLive() {
    return DR.picks.filter(function (k) { return k.pid; }).sort(function (a, b) { return (Date.parse(b.at || "") || 0) - (Date.parse(a.at || "") || 0) || b.n - a.n; })[0] || null;
  }
  /* the club's active roster now (the Owner's and GM's spots among it, Rule 2.6) plus every pick it has made that the
     rosters read has not brought in yet: the realtime pick lands before the roster does (CG.applyPickToRoster) */
  function drClubLive(code) {
    var c = { F: 0, D: 0, G: 0, total: 0, pay: 0, made: 0, next: null, left: 0, unused: 0, fills: 0, roster: [] }, seen = {};
    var r = M.roster(code);
    (r ? r.active : []).forEach(function (p) {
      seen[p.id] = true; c.roster.push(p); if (p.unit) c[p.unit]++; c.total++; c.pay += p.salary || 0;
      if (p.origin === "postdraft_random") c.fills++;
    });
    DR.picks.forEach(function (k, i) {
      if (k.club !== code) return;
      if (k.pid) { c.made++; if (!seen[k.pid]) { seen[k.pid] = true; c[drUnitOf(k.pid)]++; c.total++; c.pay += drPay(k.round); } return; }
      c.unused++;
      if (!k.skipped && DR.status !== "done" && i >= DR.cur) { c.left++; if (!c.next) c.next = k; }
    });
    return c;
  }
  /* the players a club may draft (draft_make_pick): signed up for the season and not declined (registration_pool leaves
     out the banned), on no club's roster, not yet picked, and signed up by the cutoff (is_draft_eligible, basic format:
     signup_deadline_at, else registration_deadline). A late sign-up joins the training camp pool after the draft */
  function drCutoff() { var r = drRow(), c = r.signup_deadline_at || r.registration_deadline; return c ? Date.parse(c) : null; }
  function drPoolLive() {
    if (DR._pool) return DR._pool;
    var taken = drTaken(), cut = drCutoff(), late = 0;
    var list = (M.signups || []).filter(function (s) {
      var p = M.player(s.pid);
      if (s.status === "declined" || taken[s.pid] || (p && p.rostered)) return false;
      if (cut && s.at && Date.parse(s.at) > cut) { late++; return false; }
      return true;
    }).map(function (s) { return M.player(s.pid) || { id: s.pid, tag: s.tag, href: "#/player/" + s.pid, lines: {} }; });
    list.sort(function (a, b) { return ((b.ovr || {}).ovr || 0) - ((a.ovr || {}).ovr || 0) || String(a.tag).localeCompare(String(b.tag)); });
    DR._late = late;
    return (DR._pool = list);
  }
  /* _undrafted_left: is a player of this group still left to draft or to fill a skipped pick with? The pool, less anyone
     who has held a roster spot this season (a tenure) and anyone serving a suspension.
     shortcut: "serving a suspension" reads suspension_record.running, a mirror of is_suspended; the database decides,
     and revisit if a refused pick ever disagrees with this */
  function drSupply(g, except) {
    var susp = {}; (M.suspensions || []).forEach(function (x) { if (x.running) susp[x.profile_id] = true; });
    return drPoolLive().some(function (p) { return p.id !== except && drUnitOf(p.id) === g && !susp[p.id] && !(p.tenures || []).length; });
  }
  /* draft_fits for a market season (Rule S2.4), the same question in the same order: null when the pick fits, else the
     shortfall in words. After the pick the club must still reach 3 F / 2 D / 1 G with the spots and the picks it has
     left (its unused picks, less the fills already made for them, less this one); a pick in a short group always fits,
     and a group nobody is left to draft never blocks another (D-SUPPLY). The room never refuses on this: the pick goes to
     the database, which is the gate, and its own words come back if it refuses */
  function drFitsLive(code, pid) {
    var c = drClubLive(code), g = drUnitOf(pid), before = drNeed(c);
    var after = { F: c.F, D: c.D, G: c.G }; after[g]++;
    var open = drLimit() - (c.total + 1);
    if (open < 0) return "The " + teamName(code) + " roster is full (" + drLimit() + " players, management included).";
    var gap = drNeed(after);
    if (gap.total < before.total) return null;
    var need = { F: 0, D: 0, G: 0 }, short = 0;
    ["F", "D", "G"].forEach(function (x) { if (gap[x] && drSupply(x, pid)) { need[x] = gap[x]; short += gap[x]; } });
    if (!short) return null;
    var picks = Math.max(0, c.unused - c.fills - 1);
    if (short <= Math.min(open, picks)) return null;
    return "After this pick the " + teamName(code) + " would still need " + drNeedText(need) + " to reach the minimums, with " +
      (picks <= open ? (picks ? plural(picks, "pick", "picks") + " left" : "no picks left") : "only " + plural(open, "roster spot", "roster spots") + " left") + " (Rule S2.4).";
  }

  /* ---------- the live room's widgets ---------- */
  function drSyncLine() {
    if (DR.status === "done" || !DR.picks.length) return "";
    var t = SYNC.none ? "Live updates are off on this page. Reload it to see new picks." :
      SYNC.tried && !SYNC.ok ? "Reconnecting to the live board. Until it is back, the board refreshes itself every " + (drMeLive().priv ? 45 : 90) + " seconds." : "";
    return t ? '<p class="lg-dr-meta" role="status">' + esc(t) + "</p>" : "";
  }
  /* each button names its door's state: a door in flight is disabled until the database answers */
  function drBtn(id, label, cls, small) {
    var busy = !!DR.busy[id];
    return '<button type="button" class="btn ' + (small ? "sm secondary" : "site" + (cls ? " " + cls : "")) + '" data-dr="' + id + '" data-key="' + (small ? "c-" : "a-") + id + '"' + (busy ? " disabled" : "") + ">" + label + "</button>";
  }
  function drActsLive() {
    var me = drMeLive(), st = DR.status, b = [];
    if (st === "idle" && me.commish) b.push(drBtn("start", "Start the draft"));
    if (st === "live" && me.runs) b.push(drBtn("pause", "Pause", "outline"));
    if (st === "paused" && me.runs) b.push(drBtn("resume", "Resume"));
    var said = drDeptUid() && DEPT.err ? '<p class="lg-dr-meta" role="status">' + esc("Whether you may run the room could not be checked (" + DEPT.err + "). Reload the page to try again.") + "</p>" : "";
    return (b.length ? '<div class="lg-dr-acts">' + b.join("") + "</div>" : "") + said + (me.runs ? drCCLive(me) : "");
  }
  /* the controls that mean something now, each shown only to who the database lets use it: the clock and a skip to a
     commissioner or the Draft and Bidding manager, the season-shaping ones (reverse, conclude, redraw) to a
     commissioner (the split CG.admDraftLive keeps). A pick that went (a skip, the clock) cannot be undone: only a pick
     made can be reversed (draft_reverse_pick) */
  function drCCLive(me) {
    var st = DR.status, run = st === "live" || st === "paused", c = [];
    if (run) c.push(drBtn("reset", "Reset the clock", null, true), drBtn("skip", "Skip this pick", null, true));
    if (me.commish && run && drLastLive()) c.push(drBtn("undo", "Reverse the last pick", null, true));
    if (me.commish && run) c.push(drBtn("conclude", "Conclude the draft", null, true));
    if (me.commish && st === "idle" && !DR.picks.some(function (k) { return k.pid; })) c.push(drBtn("redraw", "Redraw the order", null, true));
    var secs = run || (st === "idle" && me.commish);
    if (!c.length && !secs) return "";
    return '<div class="lg-dr-cc" role="group" aria-label="Draft controls"><span class="kicker">' + (me.commish ? "Commissioner" : me.manager ? "Draft and Bidding manager" : "Draft staff") + "</span>" +
      (secs ? '<span class="lg-dr-secs" role="group" aria-label="Seconds per pick">' + DR_SECS.map(function (s) {
        return '<button type="button" class="lg-dr-sec num" data-sec="' + s + '" data-key="s-' + s + '" aria-pressed="' + (s === DR.secs) + '"' + (DR.busy.secs ? " disabled" : "") + ">" + s + "s</button>"; }).join("") + "</span>" : "") +
      c.join("") + "</div>";
  }
  function drMineHtmlLive() {
    var code = drShown(); if (!code || !M.team(code)) return '<p class="lg-dr-note">No club to follow yet.</p>';
    var c = drClubLive(code), n = drNeed(c), cur = drOn(), rows = [], picked = {}, mn = drMin(), lim = drLimit();
    var meter = function (g) {
      var ok = c[g] >= mn[g];
      return '<li class="' + (ok ? "ok" : "") + '"><span class="lg-dr-mk" aria-hidden="true">' + (ok ? S2.ic("check") : "") + '</span><span class="lg-dr-ml">' + cap(DR_UNIT[g][1]) + '</span><span class="num lg-dr-mv">' + c[g] + " of " + mn[g] + "</span></li>";
    };
    DR.picks.forEach(function (k) { if (k.club === code && k.pid) picked[k.pid] = true; });
    /* the club's own players who are not picks of this draft: its seat holders (Rule 2.6), and after the draft the
       players placed at random for its skipped picks (Rule S2.3) */
    c.roster.forEach(function (p) {
      if (picked[p.id]) return;
      var what = p.seat ? DR_SEAT[p.seat] || p.seat : p.origin === "postdraft_random" ? "Placed for a skipped pick" : "On the roster";
      rows.push('<li class="seat"><span class="lg-dr-rr">' + (p.seat ? "Seated" : "Roster") + '</span><span class="lg-dr-rn">' + esc(what) +
        '<span class="lg-dr-rs"><a href="' + esc(p.href) + '">' + esc(p.tag) + "</a>" + esc(p.unit ? ", " + DR_UNIT[p.unit][0] : "") + '</span></span><span class="num lg-dr-rp">' + M.money(p.salary || 0) + "</span></li>");
    });
    DR.picks.forEach(function (k) {
      if (k.club !== code) return;
      var p = k.pid && M.player(k.pid);
      var what = p ? '<a href="' + esc(p.href) + '">' + esc(p.tag) + '</a><span class="lg-dr-rs">' + esc(p.posName || p.pos || drPosName(k.pid)) + "</span>" :
        k.skipped ? '<span class="lg-dr-rs">' + esc(DR.status === "done" ? "Skipped: filled at random after the draft at $750K, or lapses if no player fits" : "Skipped, filled at random after the draft") + "</span>" :
        k === cur ? '<span class="chip live">On the clock</span>' : '<span class="lg-dr-rs">' + ord(k.n) + " overall" + esc(k.orig !== k.club ? ", from the " + teamName(k.orig) : "") + "</span>";
      rows.push('<li class="' + (p ? "made" : k === cur ? "now" : "") + '"><span class="lg-dr-rr num">R' + k.round + '</span><span class="lg-dr-rn">' + what + '</span><span class="num lg-dr-rp">' +
        (p ? M.money(drPay(k.round)) : '<span class="lg-dr-rs">' + M.money(drPay(k.round)) + "</span>") + "</span></li>");
    });
    var status = DR.status === "done" ? "The draft is over" : c.next ? (c.next === cur ? "On the clock now" : "Next pick: round " + c.next.round + ", pick " + c.next.slot + ", " + ord(c.next.n) + " overall") : "Every selection made";
    return '<div class="lg-dr-mh">' + cr(code, "lg") + '<span><span class="d-3">' + esc(M.team(code).full) + '</span><span class="lg-dr-ms">' + esc(status) + "</span></span></div>" +
      '<p class="lg-dr-sum">' + esc(c.total + " of " + lim + " spots filled, payroll " + M.money(c.pay) + "." + (n.total ? " Still needs " + drNeedText(n) + "." : " The minimums are met.")) + "</p>" +
      '<ul class="lg-dr-need" aria-label="Minimums">' + ["F", "D", "G"].map(meter).join("") + "</ul>" +
      '<ol class="lg-dr-roster" aria-label="' + esc(M.team(code).full) + ' draft">' + rows.join("") + "</ol>";
  }
  /* the board is the club's own (draft_boards: its management and the league office read it), saved whole by
     save_draft_board, as CG.saveMyBoard does */
  function drBoardHtmlLive() {
    var me = drMeLive(), mine = me.mine;
    if (!mine) return '<p class="lg-dr-note">Each club keeps a private board, a ranked list only its management and the league office see (Rule 2.8).</p>';
    if (DR.boardErr) return '<p class="lg-dr-note" role="alert">' + esc("Your board could not be read: " + DR.boardErr + ". It reads again when you reopen the room.") + "</p>";
    var ids = DR.board[mine];
    if (!ids) return '<p class="lg-dr-note">Reading your board.</p>';
    if (!ids.length) return '<p class="lg-dr-note">Star players in the pool to rank them here, in the order you add them. Your club&rsquo;s management shares one board. On the clock, draft from it in one tap.</p>';
    var taken = drTaken(), open = DR.status !== "done";
    return '<ol class="lg-dr-bl">' + ids.map(function (pid, i) {
      var p = M.player(pid) || { tag: "A player", href: "#/player/" + pid }, by = taken[pid], gone = by || p.rostered;
      return '<li class="' + (gone ? "gone" : "") + '"><span class="lg-rk num">' + (i + 1) + '</span><span class="lg-dr-bn"><a href="' + esc(p.href) + '">' + esc(p.tag) + '</a><span class="lg-dr-rs">' + esc(drPosName(pid) || p.pos || "") + (by ? ", drafted by " + esc(by) : "") + "</span></span>" +
        (gone || !open ? "" : '<button type="button" class="btn sm" data-draft="' + pid + '" data-key="b-' + pid + '"' + (DR.busy.pick ? " disabled" : "") + ">" + (DR.busy.pick === pid ? "Drafting" : "Draft") + "</button>") +
        '<button type="button" class="icon-btn lg-dr-x" data-star="' + pid + '" data-key="x-' + pid + '" aria-label="Remove ' + esc(p.tag) + ' from your board">' + S2.ic("x") + "</button></li>";
    }).join("") + "</ol>";
  }
  function drPoolRowsLive() {
    var q = DR.q.trim().toLowerCase();
    return drPoolLive().filter(function (p) { return (DR.unit === "all" || drUnitOf(p.id) === DR.unit) && (!q || String(p.tag).toLowerCase().indexOf(q) >= 0); });
  }
  function drPoolCountLive() {
    var rows = drPoolRowsLive(), left = drPoolLive().length, late = DR._late || 0;
    return esc((DR.status === "done" ? left + " players were not drafted and join the training camp pool (Rule S2.5). " : left + " players are still available. ") +
      (rows.length === left ? "" : rows.length + " match the filter. ") + (late ? plural(late, "player", "players") + " signed up after the cutoff and " + (late === 1 ? "joins" : "join") + " the training camp pool after the draft. " : "") +
      "Best rating first.");
  }
  /* who may draft now: the club on the clock while the draft is live, and a commissioner or the Draft and Bidding
     manager for the club on the clock, paused too (draft_make_pick: v3.79, the league office picks while paused) */
  function drForClub(me) {
    var k = drOn(), st = DR.status;
    return k && ((st === "live" && k.club === me.mine) || (me.runs && (st === "live" || st === "paused"))) ? k.club : null;
  }
  function drPoolHtmlLive() {
    var rows = drPoolRowsLive(), me = drMeLive(), done = DR.status === "done", board = me.mine ? DR.board[me.mine] || [] : [];
    var forClub = drForClub(me), fitFor = forClub || me.mine, canDraft = !done && (me.runs || (!!me.mine && !!drClubLive(me.mine).next));
    if (!rows.length) return '<div class="lg-empty"><p class="d-3">No one matches</p><p>' + (DR.q ? "Nobody available has a gamertag containing “" + esc(DR.q) + "”." : "Nobody in this group is still available.") + " Clear the filter to see everyone.</p></div>";
    return '<ul class="lg-dr-pool">' + rows.slice(0, DR.shown).map(function (p) {
      var gp = (M.careerGames || {})[p.id] || 0, on = board.indexOf(p.id) >= 0, why = fitFor && !done ? drFitsLive(fitFor, p.id) : null, busy = DR.busy.pick;
      var text = drPosName(p.id) + ", " + (gp ? plural(gp, "league game", "league games") + " before this season" : "new to the league") + (why ? ", would leave the club short of the minimums" : "");
      return '<li class="lg-dr-pr"><span class="lg-ovr num' + (p.ovr ? (p.ovr.provisional ? " prov" : "") : " none") + '"' + (p.ovr ? ' title="Rating ' + p.ovr.ovr + (p.ovr.provisional ? ", provisional" : "") + '"' : ' title="No rating yet"') + ">" + (p.ovr ? p.ovr.ovr : "–") + "</span>" +
        '<span class="lg-dr-pb"><a class="lg-dr-pt" href="' + esc(p.href) + '">' + esc(p.tag) + '</a><span class="lg-dr-rs">' + esc(text) + "</span></span>" +
        (done ? '<span class="lg-tag">Pool</span>' :
          (me.mine ? '<button type="button" class="icon-btn lg-dr-star" data-star="' + p.id + '" data-key="t-' + p.id + '" aria-pressed="' + on + '" aria-label="' + (on ? "On your board: " : "Add to your board: ") + esc(p.tag) + '">' + DR_STAR + "</button>" : "") +
          (canDraft ? '<button type="button" class="btn sm' + (forClub && !why ? "" : " secondary") + '" data-draft="' + p.id + '" data-key="d-' + p.id + '"' + (why ? ' title="' + esc(why) + '"' : "") + (busy ? " disabled" : "") + ">" + (busy === p.id ? "Drafting" : "Draft") + "</button>" : "")) + "</li>";
    }).join("") + "</ul>" +
      (rows.length > DR.shown ? '<button type="button" class="btn site outline lg-more" data-dr="more" data-key="a-more">Show ' + Math.min(30, rows.length - DR.shown) + " more of " + (rows.length - DR.shown) + "</button>" : "");
  }
  function drEmptyHtml() {
    var me = drMeLive();
    return '<div class="lg-empty"><p class="d-3">No draft board yet</p><p>' + esc("A commissioner draws the order before draft night, " + drWhen() + ". The board appears here the moment they do, and every pick lands on it live.") + "</p>" +
      (me.commish ? drBtn("redraw", "Draw the order") : "") + "</div>";
  }

  /* ---------- the live room's doors: each one waits for the database, says what it did, or says why not ---------- */
  function drErr(e) { return (e && e.message) || "The league did not answer. Try again."; }
  function drWrite(id, rpc, args, ok, o) {
    o = o || {};
    if (DR.busy[id]) return Promise.resolve(null);
    DR.busy[id] = true; drPaint();
    return S2.write(rpc, args, { sections: o.sections || ["draft"], repaint: function () { drPaint(); } })
      .then(function (res) { S2.toast(ok, "ok"); return res; }, function (e) { S2.toast(drErr(e), "err"); return null; })
      .then(function (res) { delete DR.busy[id]; drPaint(); return res; });
  }
  function drAsk(id, o) {
    S2.confirm({ title: o.title, why: o.why, ok: o.ok, danger: !!o.danger, onOk: function () { drWrite(id, o.rpc, o.args, o.done, o); } });
  }
  function drActLive(id) {
    var k = drOn(), sn = DR.season, me = drMeLive();
    if (id === "more") { DR.shown += 30; var h = document.getElementById("drPoolList"); if (h) h.innerHTML = drPoolHtml(); return; }
    if (!sn) { S2.toast("The room does not know which season's draft this is. Reload the page.", "err"); return; }
    if (id === "start") drAsk(id, { title: "Start the draft", ok: "Start the draft", rpc: "start_draft", args: { p_season_number: sn, p_pick_seconds: DR.secs },
      why: ["The first club goes on the clock with " + DR.secs + " seconds, and every club then picks in the drawn order (Rule 2.8). Each club needs its Owner and General Manager seated; the league refuses to start otherwise and names who is missing (Rule S2.3)."],
      done: "The draft is live" });
    else if (id === "pause") drWrite(id, "draft_pause", { p_season_number: sn }, "The draft is paused: the clock is frozen until it resumes");
    else if (id === "resume") drWrite(id, "draft_resume", { p_season_number: sn }, "The draft resumes: the clock is running");
    else if (id === "reset") drWrite(id, "draft_reset_clock", { p_season_number: sn, p_seconds: null }, "The clock is back to " + DR.secs + " seconds");
    else if (id === "skip" && k) drAsk(id, { title: "Skip this pick", ok: "Skip it", danger: true, rpc: "draft_skip_pick", args: { p_season_number: sn },
      why: ["The " + teamName(k.club) + " pick (round " + k.round + ", pick " + k.slot + ") is skipped and cannot be made up, and this cannot be reversed.",
        "Once the draft is over, a random undrafted player who keeps the club able to reach the minimums fills it at $750K; if none fits, the pick lapses (Rule S2.3)."],
      done: "The " + teamName(k.club) + " pick is skipped; a random undrafted player fills it after the draft at $750K (Rule S2.3)" });
    else if (id === "undo") {
      var l = drLastLive(), lp = l && M.player(l.pid); if (!l) return;
      drAsk(id, { title: "Reverse the last pick", ok: "Reverse it", danger: true, rpc: "draft_reverse_pick", args: { p_pick: l.id },
        why: [(lp ? lp.tag : "The player") + " comes off the " + teamName(l.club) + " roster and back into the pool, and the pick (" + ord(l.n) + " overall) reopens. The draft moves back to the first open pick, with a fresh clock if it is running."],
        done: (lp ? lp.tag : "The player") + " is back in the pool, and the " + teamName(l.club) + " pick reopens", sections: ["draft", "rosters"] });
    }
    else if (id === "conclude") drAsk(id, { title: "Conclude the draft", ok: "Conclude it", danger: true, rpc: "draft_conclude", args: { p_season_number: sn },
      why: ["Every pick not yet made is skipped and the draft ends. About ten minutes later each club receives one random undrafted player who fits for each pick it missed, at $750K; a pick with no such player lapses (Rule S2.3). Everyone else joins the training camp pool (Rule S2.5)."],
      done: "The draft is concluded" });
    else if (id === "redraw" && me.commish) {
      var rounds = drRow().draft_rounds || M.RULES.s2.draftRounds;
      drAsk(id, { title: DR.picks.length ? "Redraw the order" : "Draw the order", ok: DR.picks.length ? "Draw again" : "Draw it", rpc: "generate_draft_board",
        args: { p_season_number: sn, p_rounds: rounds, p_style: "random", p_manual: null },
        why: ["The order of all " + M.teams.length + " clubs is drawn at random, " + rounds + " rounds, and every club sees it at once (Rule 2.8)." + (DR.picks.length ? " It replaces the order drawn before; the league refuses once a pick is made or traded." : "")],
        done: "The order is drawn", sections: ["draft", "seasons"] });
    }
  }
  function drSecsLive(v) {
    if (DR_SECS.indexOf(v) < 0) return;
    var st = DR.status;
    if (st === "idle") { if (v === DR.secs) return; DR.chosen = v; drPaint(); S2.toast("The draft starts with " + v + " seconds a pick"); return; }
    if (st !== "live" && st !== "paused") return;
    /* draft_reset_clock sets the seconds a pick AND restarts the clock on the pick now, so the toast says both */
    drWrite("secs", "draft_reset_clock", { p_season_number: DR.season, p_seconds: v }, "The clock is reset to " + v + " seconds, and every pick from now gets " + v + " seconds");
  }
  function drTryLive(pid) {
    var me = drMeLive(), p = M.player(pid), tag = p ? p.tag : "That player", k = drOn(), st = DR.status;
    if (st === "done" || (!me.mine && !me.runs)) return;
    var by = drTaken()[pid];
    if (by) { S2.toast(tag + " has already gone to the " + teamName(by)); return; }
    var forClub = drForClub(me);
    if (!forClub) {
      var next = me.mine ? drClubLive(me.mine).next : null;
      S2.toast(st === "idle" ? "The draft has not started. A commissioner starts the clock on draft night, " + drWhen() + "." :
        st === "paused" ? "The draft is paused, so no selection can be made until it resumes." :
        !k ? "The room is moving to the next pick. Try again in a moment." :
        !next ? "The " + teamName(me.mine) + " have no selection left in this draft." :
        "The " + teamName(k.club) + " are on the clock (round " + k.round + ", pick " + k.slot + "). Your next selection is round " + next.round + ", pick " + next.slot + ", " + ord(next.n) + " overall.");
      return;
    }
    if (DR.busy.pick) return;   /* one pick at a time: the first answer decides the next */
    var seat = forClub === me.mine && !me.runs, args = { p_pick: k.id, p_player: pid };
    DR.busy.pick = pid; drPaint();
    /* a GM or AGM whose Owner approves draft moves is queued by the database's own gate (mgmt_gate), never by the room */
    S2.write("draft_make_pick", args, { approval: seat ? "owner" : null, queueArgs: seat ? args : undefined, sections: ["draft", "rosters"], repaint: function () { drPaint(); } })
      .then(function (res) {
        if (res && res.queued) S2.toast("Sent to your Owner for approval: " + tag + " is drafted only if they approve it while your club is still on the clock");
        else S2.toast(tag + " to the " + teamName(forClub) + (forClub === me.mine ? "" : ", picked on their behalf (Rule 2.8)"), "ok");
      }, function (e) { S2.toast("Not drafted: " + drErr(e), "err"); })
      .then(function () { DR.busy.pick = null; drPaint(); });
  }
  function drStarLive(pid) {
    var mine = drMeLive().mine; if (!mine || DR.status === "done") return;
    if (!DR.board[mine]) { S2.toast("Your board is still being read. Try again in a moment."); return; }
    var b = DR.board[mine], i = b.indexOf(pid);
    if (i >= 0) b.splice(i, 1);
    else if (b.length >= 60) { S2.toast("A board holds at most 60 players. Remove one first.", "err"); return; }
    else b.push(pid);
    drPaint(); drBoardSave(mine);
  }
  /* one save once the ranking settles, as CG.saveMyBoard; a refusal says why and reads the board back from the league */
  function drBoardSave(mine) {
    clearTimeout(BOARD.t);
    BOARD.pending = (DR.board[mine] || []).slice();
    BOARD.t = setTimeout(function () {
      var ids = BOARD.pending, tid = drSess().teamId || (M.team(mine) || {}).id; BOARD.pending = null;
      if (!ids) return;
      S2.write("save_draft_board", { p_team: tid, p_players: ids }, { approval: "owner", action: "save_draft_board", queueArgs: { p_players: ids } })
        .then(function (res) { if (res && res.queued) S2.toast("Your board went to the Owner for approval: it changes when they approve it"); },
          function (e) { S2.toast("Your board did not save: " + drErr(e), "err"); drBoardRead(true); });
    }, DRL.boardSave);
  }
  if (S2.holds && S2.holds.push) S2.holds.push(function () { return !!BOARD.pending; });
  function drBoardRead(force) {
    var mine = drMeLive().mine; if (!mine || (DR.boardAt && !force)) return;
    var sb = S2.ensureSb && S2.ensureSb(), sid = drRow().id, tid = drSess().teamId || (M.team(mine) || {}).id;
    DR.boardAt = Date.now();
    if (!sb || !sid || !tid) { DR.boardErr = "the league could not be reached"; drPaint(); return; }
    sb.from("draft_boards").select("profile_id,rank").eq("season_id", sid).eq("team_id", tid).order("rank").then(function (r) {
      if (r && r.error) DR.boardErr = r.error.message; else { DR.board[mine] = ((r && r.data) || []).map(function (x) { return x.profile_id; }); DR.boardErr = null; }
      drPaint();
    }, function (e) { DR.boardErr = drErr(e); drPaint(); });
  }

  /* ---------- the live room's clock and its line to the league ---------- */
  function drTickLive() {
    if (!document.getElementById("drRoom")) { drStop(); return; }   /* leaving the room stops the tick; the draft runs on */
    drBeat();
    var k = drOn();
    if (DR.status === "live" && k && DR.endsAt && Date.now() >= DR.endsAt + ADV.jit) drAdvance();
    drClock();
  }
  /* an expired clock: the database skips the pick (draft_auto_advance, v2.70: never an automatic choice). Only front
     offices, staff and commissioners ask, one at a time, at most every 15 s, backing off after a refusal and saying so
     after three (CG._armDraftTick) */
  function drAdvance() {
    var now = Date.now();
    if (!drMeLive().priv || ADV.busy || now < ADV.after || now - ADV.fired < DRL.refire) return;
    ADV.fired = now; ADV.busy = true;
    S2.write("draft_auto_advance", { p_season_number: DR.season }, {}).then(function () { ADV.fails = 0; ADV.after = 0; }, function (e) {
      ADV.fails++; ADV.after = Date.now() + Math.min(60000, 1500 * Math.pow(2, ADV.fails - 1));
      console.error("draft room: draft_auto_advance failed", e);
      if (ADV.fails === 3) S2.toast("The draft clock cannot advance itself (" + drErr(e) + "). A commissioner or the Draft and Bidding manager should skip the pick.", "err");
    }).then(function () { ADV.busy = false; });
  }
  /* a read of the named sections through S2.reread, the one re-read (js/live.js: s2_league p_sections for the season on
     screen, merged into the body, S2.M refilled in place, one at a time); the room keeps its own jitter and spacing */
  function drReread(sections) {
    return Promise.resolve().then(function () { return S2.reread(sections, {}); }).then(function (ok) { drPaint(); return ok; },
      function (e) { console.error("draft room: reading " + sections.join(", ") + " again failed", e); return false; });
  }
  function drReconcileSoon(everyone) {
    if (SYNC.recon || document.visibilityState === "hidden") return;
    if (!everyone && !drMeLive().priv) return;   /* spectators already have the pick from the payload (v2.71) */
    var d = DRL.reconcile;
    SYNC.recon = setTimeout(function () { SYNC.recon = 0; drReread(["draft"]); }, d[0] + Math.floor(Math.random() * Math.max(0, d[1] - d[0])));
  }
  /* the safety net under a socket that died quietly: the channel is joined again, and the board read again every 45 s
     (90 s for spectators), stamped when the read settles, never from a hidden tab (v2.71) */
  function drBeat() {
    if (DR.status === "done" || !DR.picks.length) return;
    if (!SYNC.ch) drSubscribe();
    var ms = drMeLive().priv ? DRL.beat[0] : DRL.beat[1];
    if (SYNC.beating || Date.now() - SYNC.beatAt < ms || document.visibilityState === "hidden") return;
    SYNC.beating = true;
    drReread(["draft"]).then(function () { SYNC.beating = false; SYNC.beatAt = Date.now(); });
  }
  function drSubscribe() {
    /* at most one join every five seconds, so a socket that keeps failing is not hammered from the tick */
    if (SYNC.ch || Date.now() - SYNC.subAt < DRL.resub) return;
    SYNC.subAt = Date.now();
    var sb = S2.ensureSb && S2.ensureSb();
    /* the line under the board says it to every reader. A page that is not live (S2.LIVE false: a read-only rehearsal, the
       fixture suites) has no client by contract (client-api.md, as the pulse and the market's room channel), so only a
       live page with none is a fault worth the console (i3b, review 2026-11-25) */
    if (!sb) { if (!SYNC.none) { SYNC.none = true; if (S2.LIVE) console.error("draft room: there is no league client on this page, so the board cannot update itself"); drPaint(); } return; }
    SYNC.none = false;
    var ch = SYNC.ch = sb.channel("draft-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_state" }, drOnState)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_picks" }, drOnPick)
      .subscribe(function (status) {
        if (SYNC.ch !== ch) return;
        SYNC.tried = true; SYNC.ok = status === "SUBSCRIBED";
        /* a dead socket must not look like a live one: let the channel go, so the next tick joins a new one */
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          SYNC.ch = null; SYNC.ok = false;
          try { sb.removeChannel(ch); } catch (e) { console.warn("draft room: removing the dead channel", e); }
        }
        drPaint();
      });
  }
  function drOnState(p) {
    var row = p && p["new"], D = M.draft = M.draft || { state: null, picks: [] };
    if (!row || row.season_number == null || row.season_number !== drSeasonNo()) return;
    var was = D.state && D.state.status;
    D.state = Object.assign({}, D.state || {}, row);
    drPaint(); drReconcileSoon(false);
    if (row.status === "complete" && was !== "complete") drAfterDone();
  }
  function drOnPick(p) {
    var D = M.draft = M.draft || { state: null, picks: [] };
    /* a DELETE carries only the key (the board regenerated): everyone reads the board again, spread out */
    if (!p || p.eventType === "DELETE") { drReconcileSoon(true); return; }
    var row = p["new"]; if (!row || row.season_number !== drSeasonNo()) return;
    var i = -1; D.picks = D.picks || [];
    D.picks.forEach(function (x, j) { if (x.id === row.id) i = j; });
    var merged = Object.assign({}, i >= 0 ? D.picks[i] : {}, row);
    if (i >= 0) D.picks[i] = merged; else D.picks.push(merged);
    drPaint(); drReconcileSoon(false);
  }
  /* the draft is complete: every open room reads the draft, the rosters, their stints and the sign-ups once, spread over
     two minutes, and a hidden tab when it is looked at again (v2.72: rosters, team pages and the pool agree with the
     record for everyone, without every tab asking at once) */
  function drAfterDone() {
    clearTimeout(SYNC.doneT);
    SYNC.doneT = setTimeout(function go() {
      if (document.visibilityState === "hidden") {
        var once = function () { if (document.visibilityState === "hidden") return; document.removeEventListener("visibilitychange", once); go(); };
        document.addEventListener("visibilitychange", once); return;
      }
      drReread(["draft", "rosters", "tenures", "signups"]).then(function () { if (S2.quietRepaint && S2.parse().name !== "draft") S2.quietRepaint(); });
    }, Math.floor(Math.random() * DRL.done));
  }
  function drOnClockToast() {
    var k = drOn(), mine = drMine();
    if (DR.status === "live" && k && mine && k.club === mine && SYNC.told !== k.id) { SYNC.told = k.id; S2.toast("You are on the clock: " + DR.secs + " seconds"); }
  }
  /* entering the room: join the channel, read the draft once for this visit while it has not started (draft_state is
     not on the league pulse, so a page opened before the start would not know it had begun; once the draft runs, every
     pick is on the pulse, which keeps S2.M.draft current on the other pages, and the channel, the reconcile and the
     safety re-read keep it here, so the crowd that opens the room at 9 PM does not read it again), read the club's
     board, run the tick */
  function drEnterLive() {
    drSubscribe();
    /* once per visit: a repaint of this page (a theme or role change re-runs it) within ten seconds does not read again */
    var st = M.draft && M.draft.state, running = !!st && (st.status === "live" || st.status === "paused");
    if (!running && Date.now() - SYNC.enterAt > 10000) drReread(["draft"]);
    SYNC.enterAt = SYNC.beatAt = Date.now();
    drDeptAsk();
    drBoardRead(false);
    drOnClockToast();
    if (DR.status !== "done" && DR.picks.length) drArm();
  }
  /* the league pulse re-reads its sections on every other page; on this one the room repaints itself in place */
  ["picks", "rosters", "signups", "people", "scores", "discipline", "league"].forEach(function (d) {
    S2.live.on(d, function () { if (DR && document.getElementById("drRoom")) { DR._pool = null; drPaint(); } });
  });

  /* the room's body: the clock band, the pool and the club, the board and how the night works (or, with no board yet,
     the empty state and how the night works) */
  function drRoomInner() {
    var n = DR.order.length || M.teams.length, R = drRounds(), lim = drLimit(), mn = drMin(), mine = drMine(), code = drShown();
    var pick = !mine ? '<label class="lg-dr-sel"><span class="sr">Follow</span><select class="input" id="drClubSel">' + M.teams.map(function (t) {
      return '<option value="' + t.code + '"' + (t.code === code ? " selected" : "") + ">" + esc(t.full) + "</option>"; }).join("") + "</select></label>" : "";
    var scale = []; for (var r = 1; r <= R; r++) scale.push('<li><span class="lg-dr-sk">Round ' + r + '</span><span class="num">' + M.money(drPay(r)) + "</span></li>");
    var drafter = !!mine || drMeLive().runs;
    var how = '<section class="lg-sec" aria-labelledby="hdrh">' + secHead({ kicker: "How draft night works", id: "hdrh", title: "One clock, " + word(n) + " front offices",
        text: "The draft rebuilds every roster. A club drafts to " + word(lim) + " with its Owner and GM seated first, names its AGM from them after, and the room holds it to the minimums." }) +
      '<dl class="spec lg-spec">' +
        fact("Order", "Drawn at random before the night" + (DR.snake ? ", reversed every other round" : ", the same every round")) + fact("Clock", "Set by a commissioner or the Draft and Bidding manager; 120 seconds a pick by default") +
        fact("Roster", cap(word(lim)) + " all season, Owner, GM and AGM included") + fact("Minimums", cap(word(mn.F)) + " forwards, " + word(mn.D) + " defense, " + word(mn.G) + " goaltender") +
        fact("A missed pick", "Goes empty; a random player who fits is placed right after the draft at $750K, and if none fits, the pick lapses") + fact("Not drafted", "Joins the league-wide training camp pool") +
      '</dl><h3 class="kicker lg-dr-sch">Salary by round</h3><ol class="lg-dr-scale">' + scale.join("") + "</ol></section>";
    if (!DR.picks.length) return drEmptyHtml() + how;
    return inkBand("lg-dr-band", '<div id="drNow">' + drNowHtml() + "</div>", "Draft clock") +
      '<section class="lg-sec lg-dr-main" aria-label="The pool and your club">' +
        '<div class="lg-dr-pcol">' + secHead({ kicker: "The pool", title: "Best available", size: "d-2",
            text: drafter ? "Tap Draft when your club is on the clock, or star a player to rank them on your board." : "Every player still available, best rating first. Each pick leaves this list the moment the league records it." }) +
          '<div class="lg-tools">' + searchBox("drQ", "Find a player", DR.q) + '<div class="lg-hscroll lg-hscroll-in">' + utabs("drUnit", DR_UNITS, DR.unit, "Position group", "sm") + "</div></div>" +
          '<p class="lg-count" id="drPoolCount" aria-live="polite">' + drPoolCount() + '</p><div id="drPoolList">' + drPoolHtml() + "</div></div>" +
        '<aside class="lg-dr-side" aria-label="' + (mine ? "Your club" : "A club") + '"><div class="lg-dr-sideh"><span class="kicker">' + (mine ? "Your club" : "Follow a club") + "</span>" + pick + "</div>" +
          '<div id="drMineHost">' + drMineHtml() + "</div>" +
          '<div class="lg-dr-boardw"><span class="kicker">Your board</span><div id="drBoardHost">' + drBoardHtml() + "</div></div></aside>" +
      "</section>" +
      '<section class="lg-sec" aria-labelledby="hdrb">' + secHead({ kicker: "The board", id: "hdrb", title: "Every pick, round by round",
          text: DR.snake ? "Clubs run across in the drawn order. Pick numbers run forward in odd rounds and back in even rounds, so the club that picks last in one round picks first in the next." : "Clubs run across in the drawn order, the same order every round." }) +
        '<div class="lg-dr-gridw" id="drGrid">' + drGridHtml() + '</div><div id="drRoundHost">' + drRoundHtml() + "</div></section>" + how;
  }

  S2.page("draft", {
    title: "Draft room", tab: "season", repaintsItself: true,
    render: function () {
      if (!M) return fail("Draft room");
      DR = drFromLive(DR);
      var R = drRounds(), n = DR.order.length || M.teams.length, mine = drMine(), me = drMeLive();
      var total = DR.picks.length ? DR.picks.length : R * n, sn = DR.season || 2;
      var who = mine ? "You pick for the " + teamName(mine) + "." + (me.runs ? " You also run the room." : "") : me.runs ? "You run the room, and may pick for the club on the clock (Rule 2.8)." : "You are watching: every club picks for itself.";
      return '<div class="lg-dr-crumbs">' + S2.crumbs([["#/season", "Season " + sn], ["", "Draft room"]]) + "</div>" +
        hero({ kicker: "Season " + sn + " draft", title: cap(word(R)) + " rounds, " + total + " picks",
          lede: esc("Draft night, " + drWhen() + ". " + who),
          cta: arrow("#/rulebook?rule=S2.3", "Rule S2.3") }) +
        '<div id="drRoom" class="lg-dr">' + drRoomInner() + "</div>" +
        about(paras(["This is the league&rsquo;s draft room. The order, the clock and every pick are the league&rsquo;s own records, and they update here for everyone at once. A pick shows as made only once the league has recorded it; a refused pick shows the league&rsquo;s reason.",
          "The pool is every player signed up for the season by the cutoff and not yet on a club, best headline rating first. Each club&rsquo;s Owner and General Manager are seated before the draft and hold roster spots; the Assistant General Manager is named from the club&rsquo;s twelve after the draft (" + rule("2.6") + ").",
          "The rules are Rule 2.8 (the random order, the snake, the clock, a skipped pick, pay by round, replacing unused picks, the commissioner&rsquo;s controls), " + rule("S2.3") + " (" + word(drRounds()) + " rounds, the Owner and General Manager seated first), " + rule("S2.4") + " (" + word(drLimit()) + " players all season and the minimums) and " + rule("S2.5") + " (the training camp pool)."]));
    },
    after: function (root) { if (M) drBind(root); }
  });
})();
