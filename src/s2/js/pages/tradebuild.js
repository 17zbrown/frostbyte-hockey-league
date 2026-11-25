/* #/trade: the Team HQ trade page. Builder "tradebuild": owns js/pages/tradebuild.js and css/tradebuild.css.
   Commissioner, 2026-11-03: "In the concept site, instead of the trade page being a pop-up, can you integrate it into the
   entire page to be able to show more in-depth stats and lines? I want the trade page to show teams as much valuable info
   as possible in order to make the best decision. Continue using the apple design guide and make sure the page feels
   built in and integrated well instead of looking like you just bolted it on after the site was designed."
   The three-step sheet (Partner, Players, Check) became one page in Team HQ, read top to bottom in the order a front
   office decides: who to trade with (every club's record, cap room and roster room), what the trade is (an ink match
   center that follows every pick), who is on each roster (full stat lines, sortable, each player opening to their
   ratings, ranks and form), the full reading (S2.trade.detail, the one definition Team HQ and the Staff Desk use), each
   club's lineup before and after, the two clubs side by side, and then the send. A received or sent offer opens on the
   same page (?offer=) with its answers, and Counter turns it into a build in place.
   Every pick is written to the address (history.replaceState), so back, a reload and an automatic update keep it; an
   edit repaints its widgets in place and never re-renders the page (BRIEF: interactions must not reset the page).
   Doors: every data-flow="trade" (js/flows.js hands its context to S2.tradePage.href) and Team HQ's offer rows.
   Addresses: #/trade?with=BOS&send=<pid>,<pid>&get=<pid>[&counter=<offer>][&club=<code>] and #/trade?offer=<offer>.
   THE REAL PAGE (v5.00 swap, stream e4, 2026-11-24; the only path since i3c removed demo mode, 2026-11-25): the page acts for the member's own club (their seat's,
   S2.session.teamCode or teamId; a commissioner keeps the club they preview, as hq.js club() reads it), and every action
   is the league's own door through S2.trade.door (js/trade.js): propose and counter (trades.insert, queued for the Owner
   as trade_propose), accept (accept_trade), decline and withdraw (trades.update, queued as trade_decline and
   trade_cancel), the league office's reverse_trade and resend_trade, and the trade block (roster_spots.on_block, queued
   as roster_block). Nothing shows as done until the database confirms it; a refusal (the movement deadline, the Season 2
   minimums through roster_min_gap, the cap, a stale offer) is shown in the database's own words under the button, and
   the picks and the note stay. An offer or a counter is read from the trades table by its id (S2.trade.read), so RLS
   decides who sees it: the two clubs' front offices and the league office (trade privacy, v3.35, Rule 2.3). A member
   outside them reads no offer at all. The pulse repaints the page's widgets in place (repaintsItself), never the
   note being typed, and a version reload waits while a note is typed or a write is on its way (S2.holds). The trade
   reading (S2.trade.evaluate and its parts) is the section below the state, moved here from js/demo.js. */
(function () {
  "use strict";
  var S2 = window.S2;
  if (!S2 || !S2.page) return;
  var M = S2.M, T = S2.trade, esc = S2.esc;

  /* ---------- the page's state; the address is its source of truth (read on every render) ---------- */
  /* acting: the viewer answers for ST.club (one of its two clubs, or a commissioner); false for a staffer reading an offer.
     busy: a write is on its way (its button stays pressed through any repaint) */
  var ST = { mode: "build", club: null, partner: null, send: [], get: [], counter: null, offer: null, note: "", flash: "",
    pane: "me", unit: { me: "all", them: "all" }, sort: { me: null, them: null }, open: {}, lu: "after", read: false, acting: true, busy: false, err: "" };
  /* the offers this tab has read, by id: { o: Offer | null (none the reader may see), err, at, busy } */
  var LV = {};
  var SLOTS = ["LW", "C", "RW", "LD", "RD", "G"], PICK = ["G", "C", "LD", "RD", "LW", "RW"];
  var SLOT_GROUP = { LW: "W", RW: "W", C: "C", LD: "D", RD: "D", G: "G" };
  var UNITS = [["F", "Forwards"], ["D", "Defense"], ["G", "Goaltenders"]];
  var SEG = [["all", "All"], ["F", "Forwards"], ["D", "Defense"], ["G", "Goaltenders"]];
  /* columns: key, label, what a reader hears, and 1 or 2: hidden in a narrow panel, or a phone-narrow one (css/tradebuild.css
     container queries), so a phone keeps the rating, the scoring (or saves) and the value, and every gamertag in full */
  var COLS = {
    S: [["ovr", "OVR", "Overall rating"], ["gp", "GP", "Games played", 1], ["g", "G", "Goals", 1], ["a", "A", "Assists", 1], ["p", "P", "Points"], ["ppg", "P/GP", "Points per game", 2],
      ["sal", "Cap", "Salary", 1], ["val", "Value", "Trade value"]],
    G: [["ovr", "OVR", "Overall rating"], ["gp", "GP", "Games played", 1], ["svp", "SV%", "Save percentage"], ["gaa", "GAA", "Goals against average", 2], ["w", "W", "Wins", 1],
      ["so", "SO", "Shutouts", 1], ["sal", "Cap", "Salary", 1], ["val", "Value", "Trade value"]]
  };

  function team(code) { return M.team(code) || { code: code, city: code, name: code, full: code, color: null }; }
  function city(code) { return team(code).city; }
  function money(n) { return +n ? M.money(+n) : "$0"; }
  function plural(n, one, many) { return S2.plural(n, one, many); }
  function list(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  function standing(code) { return M.standings("league").filter(function (r) { return r.code === code; })[0] || null; }
  function power(code) { return M.standings("power").filter(function (r) { return r.code === code; })[0] || null; }
  function rec(r) { return r ? r.w + "-" + r.l + "-" + r.otl : "–"; }
  function on(pid, code) { var p = M.player(pid); return !!(p && p.rostered && p.club === code); }
  function picks(s) { return s === "me" ? ST.send : ST.get; }
  function codeOf(s) { return s === "me" ? ST.club : ST.partner; }
  function tv(pid) { return T.tradeValue(pid); }
  function locked() { return ST.mode === "offer"; }
  /* an archive is read only (QA round 2, 2026-11-25; hq.js archErr, the test js/trade.js seasonId makes): the page drew a
     live builder, ticks, the block buttons and Propose, whose every door then refused. It still reads (both rosters, the
     reading, the comparison), but nothing can be picked or sent, and the send section leads to the current season's */
  function arch() { return S2._hq && S2._hq.archErr ? S2._hq.archErr() : null; }
  function arrow(label, href) { return '<a class="arrow" href="' + esc(href) + '"><span>' + esc(label) + "</span>" + S2.ic("chev") + "</a>"; }
  /* a section head in the site's grammar: kicker, a headline that says something, one sentence (all escaped by the caller) */
  /* the kit's one section head (S2.secHead, audit 2026-11-09); h and p arrive already escaped */
  function head(k, h, p, aside) { return S2.secHead({ kicker: k, hh: h, p: p, aside: aside, cls: "tp-hd" }); }

  /* =====================================================================================================================
     THE TRADE READING (S2.trade.evaluate, tradeValue, tradeStats, tradeSide, playerEval, check, side): the live
     CG.tradeValue, CG.tradeSide, CG.tradeBalanceCard and CG.tRoster ported, with the Season 2 roster and cap check. MOVED
     here verbatim from js/demo.js by stream i3c (2026-11-25), whose demo engine goes at the flip; the trade page, Team HQ's
     block rows and the Staff Desk read it, and js/trade.js draws it (S2.trade.pill, detail, playerBody). shortcut: it sits
     in this file because i3c owns it; its home is js/trade.js, one move with no call site to change, when that file's
     owner takes it. Pure: it reads S2.M and changes nothing ===================================================================== */
  (function () {
    var T = S2.trade;
    function P(pid) { return M.player(pid); }
    function team(code) { return M.team(code); }
    function full(code) { var t = team(code); return t ? t.full : String(code || "a club"); }
    function poss(code) { var f = full(code); return "the " + f + (/s$/.test(f) ? "'" : "'s"); }
    function tag(pid) { var p = P(pid); return p ? p.tag : "a player"; }
    function list(names) { return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]; }
    function num(x) { return typeof x === "number" && isFinite(x) ? x : 0; }
    function prob(code, text, hard, club, pid) { return { code: code, text: text, hard: !!hard, club: club || null, pid: pid || null }; }
    function count(ps) { return ps.reduce(function (a, p) { if (p.unit) a[p.unit]++; a.total++; return a; }, { F: 0, D: 0, G: 0, total: 0 }); }
    function plan(moves) {
      var clubs = {}, problems = [], placements = [], after = {}, s2 = M.RULES.s2, lim = s2.limit, min = s2.min, cap = s2.cap;
      var slot = function (c) { return clubs[c] = clubs[c] || { out: [], inn: [] }; };
      moves.forEach(function (m) { if (m.from) slot(m.from).out.push(m.pid); if (m.to) slot(m.to).inn.push(m.pid); });
      Object.keys(clubs).forEach(function (code) {
        var r = M.roster(code); if (!r) return;
        var c = clubs[code], gone = {};
        c.out.forEach(function (x) { gone[x] = 1; });
        var stay = r.active.filter(function (p) { return !gone[p.id]; }), act = count(stay), was = count(r.active);
        var pay = stay.reduce(function (a, p) { return a + num(p.salary); }, 0);
        c.inn.map(P).filter(Boolean).forEach(function (p) {
          if (p.unit) act[p.unit]++; act.total++; pay += num(p.salary);
          placements.push({ pid: p.id, tag: p.tag, club: code, squad: "pro" });
        });
        after[code] = { active: act, camp: r.camp.length, limit: lim, min: min, payroll: pay, cap: cap, room: cap == null ? null : cap - pay };
        var The = poss(code).replace(/^the/, "The");
        if (c.inn.length && act.total > lim) problems.push(prob("over_limit", The + " active roster would hold " + act.total + " players, over the Season 2 limit of " + lim + " (Rule S2.4).", false, code));
        if (c.inn.length && cap != null && pay > cap) problems.push(prob("over_cap", The + " payroll would be " + M.money(pay) + ", over the " + M.money(cap) + " salary cap (Rule S2.4).", false, code));
        /* the words waive() uses for the same lock */
        if (c.out.length) ["F", "D", "G"].forEach(function (u) {
          if (act[u] < min[u] && act[u] < was[u]) problems.push(prob("minimum", The + " active roster would fall to " + words(act[u]) + " " + unitWord(u, act[u]) +
            ", under the Season 2 minimum of " + min[u] + " (Rule S2.4).", false, code));
        });
      });
      moves.forEach(function (m) { if (!m.to) placements.push({ pid: m.pid, tag: tag(m.pid), club: null, squad: null }); });
      return { problems: problems, placements: placements, after: after };
    }
    /* the live builder's exclusions (CG.tRoster): a manager can't be traded (Rule 2.6); the player must be on that club */
    function sideProblems(code, pids, seen) {
      var out = [];
      (pids || []).forEach(function (pid) {
        var p = P(pid);
        if (!p) out.push(prob("missing", "A player in this offer is not in the league records.", true, code, pid));
        else if (seen[pid]) out.push(prob("both_sides", p.tag + " is on both sides of the offer.", true, code, pid));
        else if (!p.rostered || p.club !== code) out.push(prob("not_on_club", p.tag + " is no longer on " + poss(code) + " roster, so this offer cannot go through.", true, code, pid));
        else if (p.seat) out.push(prob("manager", p.tag + " holds " + poss(code) + " " + p.seat + " seat. An Owner, GM or AGM can't be traded (Rule 2.6).", true, code, pid));
        /* audit 2026-11-09: a trade moved a pool player straight onto a roster, past waivers and Saturday bidding; the
           same door squad() and waive() closed. The market reads only the snapshot here, so a replay agrees */
        else if (S2.market && S2.market.inPool(pid)) out.push(prob("pool", p.tag + " is in the training camp pool, not on " + poss(code) + " active roster. In Season 2 a pool player joins a roster only through a waiver claim or Saturday bidding (Rule S2.6).", true, code, pid));
        seen[pid] = 1;
      });
      return out;
    }
    function check(o) {
      o = o || {};
      var from = String(o.from || "").toUpperCase(), to = String(o.to || "").toUpperCase(), send = o.send || [], get = o.get || [], ps = [];
      if (!team(from) || !team(to)) ps.push(prob("no_partner", "Pick a trade partner.", true));
      else if (from === to) ps.push(prob("same_club", "Pick another club to trade with.", true));
      if (!send.length || !get.length) ps.push(prob("empty", "Add at least one player on each side. Draft picks are not traded in the basic format (Rule 2.3).", true));
      if (ps.length) return { ok: false, problems: ps, placements: [], after: {} };
      var seen = {};
      ps = sideProblems(from, send, seen).concat(sideProblems(to, get, seen));
      if (ps.length) return { ok: false, problems: ps, placements: [], after: {} };
      var pl = plan(send.map(function (x) { return { pid: x, from: from, to: to }; }).concat(get.map(function (x) { return { pid: x, from: to, to: from }; })));
      return { ok: !pl.problems.length, problems: pl.problems, placements: pl.placements, after: pl.after };
    }
    function side(x, code) { code = String(code || "").toUpperCase(); return !x ? null : x.to === code ? "in" : x.from === code ? "out" : null; }
    var NUMW = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    function words(n) { return NUMW[n] || String(n); }
    function city(code) { var t = team(code); return t ? t.city : String(code || "a club"); }
    /* M.money prints "$0K" for zero and "$-500K" below it, so the sign is said in words by the caller */
    function cash(n) { n = Math.abs(num(n)); return n === 0 ? "$0" : M.money(n); }
    /* CG.tradeStats: each role over its own games (sgp skating, gs in goal); gp counts every game once (v4.08, v4.11).
       Points, plus/minus and penalties come from skating lines only, as CG.addStatLine adds them */
    function tradeStats(pid) {
      var p = P(pid), S = p && p.lines.S, G = p && p.lines.G, games = {};
      if (p) ["S", "G"].forEach(function (rl) { if (p.lines[rl]) M.log(pid, rl).forEach(function (r) { games[r.game] = 1; }); });
      var sgp = S ? num(S.gp) : 0, gs = G ? num(G.gp) : 0, sa = G ? num(G.sa) : 0, sv = G ? num(G.sv) : 0;
      var pts = S ? num(S.p) : 0;
      return { goalie: !!(p && p.pos === "G"), gp: Object.keys(games).length, sgp: sgp, gs: gs, g: S ? num(S.g) : 0, a: S ? num(S.a) : 0, p: pts,
        pm: S ? num(S.pm) : 0, pim: S ? num(S.pim) : 0, ppg: sgp ? pts / sgp : 0, w: G ? num(G.w) : 0, l: G ? num(G.l) : 0, otl: G ? num(G.otl) : 0,
        svp: sa ? sv / sa : null, gaa: gs ? num(G.ga) / gs : null, so: G ? num(G.so) : 0 };
    }
    /* CG.tPlayer (part_live.js:14704) finds a player among ROSTERED players only, so a player waived or gone since an
       offer was made counts as missing in the live reading: value 0, "not on a roster" (CG.tradePlayerRow). Review
       2026-10-20: the port read every player in the records, so a waived player kept his full value in a pending offer */
    function TP(pid) { var p = P(pid); return p && p.rostered ? p : null; }
    /* the ONE rating every trade view shows and the value counts: profiles.overall, which the live engine sets to the
       HEADLINE row of player_position_overalls (part_live.js:1077). refresh_player_overall writes that row at the signed-up
       group even before any games there, at 70 and provisional (overall_breakdown's no-games branch,
       sql/2026-09-29-position-ratings-v374.sql:208-281), so the live picker, the live OVR and the live value all read 70.
       Review 2026-10-20: the views mixed three ratings (M.player's top row, this, and "not rated yet"), so the sentence
       contradicted the numbers beside it for 32 rostered players.
       shortcut: the snapshot's query 07 keeps only rows with games (o.gp > 0), so those zero-game headline rows are rebuilt
       here at 70; re-export 07 without that filter and the real row is read. Two players already have
       games at their roster group, so their signed-up group is not in the snapshot and pos stays null */
    var RATE_GROUP = { C: "Center", W: "Wing", D: "Defense", G: "Goaltender" };
    function headRow(pid) {
      var rows = M.ratings(pid), h = rows.filter(function (r) { return r.headline; })[0], p = P(pid);
      if (h) return { pos: h.pos, posName: h.posName, ovr: h.ovr, gp: h.gp, provisional: h.provisional, start: false };
      var g = p && M.GROUP[p.pos], known = g && !rows.some(function (r) { return r.pos === g; });
      return { pos: known ? g : null, posName: known ? RATE_GROUP[g] : null, ovr: M.OVR_CENTER, gp: 0, provisional: true, start: true };   /* cghl_center() (v4.48) */
    }
    /* CG.tradeValue: 10 per rating point above 60 on the OLD 50 to 99 scale (the headline rating, headRow above, read back
       with M.oldOvr as live v4.48 does: 39 - (99 - overall) * 29 / 14, so a typical player keeps a value near 100),
       plus production weighted in over the first five games (a skater's points per game x 40; a goaltender's save
       percentage above .880 x 2000, plus 3 a win; a two-role player's split by role games), minus 8 per $1M of salary */
    function tradeValue(pid) {
      var p = TP(pid); if (!p) return { value: 0, ovr: 0, prod: 0, cap: 0, missing: true, overall: null, weight: 0, stats: null };
      var st = tradeStats(pid), overall = headRow(pid).ovr, ovr = Math.round(Math.max(0, M.oldOvr(overall) - 60) * 10), prod = 0, weight = 0;
      if (st.gp >= 1) {
        var gProd = st.gs ? Math.max(0, ((st.svp || 0) - 0.880) * 2000) + st.w * 3 : 0;
        var sProd = st.sgp ? st.ppg * 40 : 0;
        prod = (sProd * st.sgp + gProd * st.gs) / Math.max(1, st.sgp + st.gs);
        weight = Math.min(1, st.gp / 5);
        prod = Math.round(prod * weight);
      }
      var cap = -Math.round((num(p.salary) / 1e6) * 8);
      return { value: Math.max(0, Math.round(ovr + prod + cap)), ovr: ovr, prod: Math.round(prod), cap: cap, missing: false, overall: overall, weight: weight, stats: st };
    }
    /* CG.tradeSide: one side's totals (what one club sends) */
    function tradeSide(pids) {
      var out = { n: 0, ovrSum: 0, salary: 0, value: 0, gp: 0, g: 0, a: 0, p: 0, goalies: 0, camp: 0, missing: 0 };
      (pids || []).forEach(function (pid) {
        var pl = TP(pid), v = tradeValue(pid);
        out.n++; out.value += v.value;
        if (!pl) { out.missing++; return; }
        out.ovrSum += v.overall; out.salary += num(pl.salary); if (pl.squad === "tc") out.camp++;
        out.gp += v.stats.gp; if (v.stats.goalie) out.goalies++;
        out.g += v.stats.g; out.a += v.stats.a; out.p += v.stats.p;
      });
      out.avgOvr = (out.n - out.missing) ? Math.round(out.ovrSum / (out.n - out.missing)) : 0;
      return out;
    }
    /* the verdict in CG.tradeBalanceCard: A is what aCode sends, so a lopsided trade favors the club that RECEIVES more */
    function reading(A, B, aCode, bCode) {
      var total = A.value + B.value, diff = total ? Math.abs(A.value - B.value) / Math.max(A.value, B.value, 1) : 0, favors = null, state, tone, text;
      if (!A.n && !B.n) { state = "empty"; tone = "none"; text = "Add players to read it"; }
      else if (!A.n || !B.n) { state = "one"; tone = "warn"; text = "One side is empty"; }
      else if (diff < 0.08) { state = "even"; tone = "even"; text = "Even"; }
      else { state = "favors"; favors = A.value > B.value ? bCode : aCode; tone = diff < 0.25 ? "lean" : "lopsided"; text = "Favors " + city(favors) + " by " + Math.round(diff * 100) + "%"; }
      return { state: state, tone: tone, text: text, favors: favors, pct: Math.round(diff * 100), diff: diff, total: total,
        aPct: total ? Math.round(A.value / total * 100) : 50 };   /* aPct: the live meter, the share of the value aCode sends */
    }

    /* one player as the reading shows them: rating where they would play, the role-aware season line, ranks (6+ games at
       that position, else "too few games"), the last five games, salary and squad */
    /* review 2026-10-20: saves per game measures the shots a goaltender faces, not how well they stop them, so it is not a
       measure a goaltender "ranks higher" on; breakaway save percentage is (all four are in M.rankKeys("G")) */
    var KEYS = { S: ["pts_pg", "g_pg", "a_pg", "shot_pct", "pm_pg"], G: ["sv_pct", "gaa", "so_pg", "brk_sv_pct"] };
    /* one role's season line as the reading shows it: the line, ranks (M.rank: six games at the group played) and the last
       five games. Both roles of a two-role player get one (data/README.md: "Every line counts: show both"), since the
       value counts both (review 2026-10-20: the second role had shrunk to "also 6 GP in goal") */
    function roleEval(pid, L, role) {
      var line = role === "G" ? { role: "G", gp: num(L.gp), svp: L.sv_pct, gaa: L.gaa, w: num(L.w), l: num(L.l), otl: num(L.otl), so: num(L.so), record: L.record }
        : { role: "S", gp: num(L.gp), g: num(L.g), a: num(L.a), p: num(L.p), ppg: L.pts_pg, pm: num(L.pm), sog: num(L.sog), shotPct: L.shot_pct, toi: num(L.toi_pg) > 0 ? L.toi_pg : null };
      /* commissioner, 2026-10-20: ranks, not percentiles ("1st in this category or tied for 24th"); score (best 100, last 0)
         draws the bars and the radar, and is null under six games at the position */
      var ranks = KEYS[role].map(function (k) {
        var x = M.rank(L, k); if (!x) return null;
        return { key: k, label: x.label, short: x.short, display: x.display, rank: x.rank, tied: x.tied, score: x.score, text: x.text, shortText: x.shortText, tone: x.tone,
          few: x.few, n: x.n, group: x.group, groupName: x.groupName, groupMany: x.groupMany, median: x.medianDisplay };   /* group: M.rankBetter */
      }).filter(Boolean);
      var last = M.log(pid, role).slice(-5), form = null;
      if (last.length) {
        if (role === "G") { var sv5 = last.reduce(function (a, r) { return a + num(r.sv); }, 0), sa5 = last.reduce(function (a, r) { return a + num(r.sa); }, 0);
          form = { role: "G", n: last.length, values: last.map(function (r) { return r.sa ? r.sv / r.sa : null; }), svp: sa5 ? sv5 / sa5 : null,
            record: last.filter(function (r) { return r.result === "W"; }).length + "-" + last.filter(function (r) { return r.result === "L"; }).length + "-" + last.filter(function (r) { return r.result === "OTL"; }).length }; }
        else form = { role: "S", n: last.length, values: last.map(function (r) { return num(r.p); }), p: last.reduce(function (a, r) { return a + num(r.p); }, 0) };
      }
      return { role: role, line: line, ranks: ranks, form: form };
    }
    function playerEval(pid, joins) {
      var p = TP(pid), v = tradeValue(pid);
      if (!p) { var gone = P(pid); return { pid: pid, missing: true, tag: gone ? gone.tag : "A player", href: gone ? gone.href : null, value: v, salary: 0 }; }
      /* the role they would play is their registered one, as the live reading leads with it (CG.tradeStats); a player with
         no line in that role shows the one they have first */
      var st = v.stats, role = p.pos === "G" ? "G" : "S";
      if (!p.lines[role] && p.lines[role === "G" ? "S" : "G"]) role = role === "G" ? "S" : "G";
      var oRole = role === "G" ? "S" : "G", L = p.lines[role] || null, O = p.lines[oRole] || null;
      var main = L ? roleEval(pid, L, role) : null;
      /* the position they would play is their registered one (the live builder places by position group, Rule 2.1) */
      var grp = M.GROUP[p.pos], rows = M.ratings(pid), at = rows.filter(function (r) { return r.pos === grp; })[0] || null, head = headRow(pid);
      return { pid: pid, missing: false, tag: p.tag, href: p.href, club: p.rostered ? p.club : null, pos: p.pos, posName: p.posName, unit: p.unit, squad: p.squad,
        salary: num(p.salary), seat: p.seat || null, role: role,
        line: main ? main.line : null, ranks: main ? main.ranks : [], form: main ? main.form : null,
        other: O ? roleEval(pid, O, oRole) : null,   /* the second role, in full */
        rating: at ? { pos: at.pos, posName: at.posName, ovr: at.ovr, gp: at.gp, provisional: at.provisional } : null,
        headline: head,   /* the one rating (headRow): what the value counts and every view prints */
        others: rows.filter(function (r) { return head.start || r.pos !== head.pos; }).map(function (r) { return { pos: r.pos, posName: r.posName, ovr: r.ovr, gp: r.gp }; }),
        value: v,
        joins: joins || null };   /* { club, squad } where the plan places them, when it can be placed */
    }
    function units(list) { return list.reduce(function (a, p) { if (p && p.unit) a[p.unit]++; a.total++; return a; }, { F: 0, D: 0, G: 0, total: 0 }); }
    var UNIT_WORD = { F: ["forward", "forwards"], D: ["defenseman", "defensemen"], G: ["goaltender", "goaltenders"] };
    function unitWord(u, n) { return UNIT_WORD[u][n === 1 ? 0 : 1]; }
    /* a club before and after under the Season 2 rules (Rule S2.4, audit 2026-11-09): the active roster by unit against
       the Season 2 minimums and the limit of twelve, the active payroll and the room under the season's cap. After is
       the plan's (check.after), so the reading and the check can never disagree */
    function clubState(code, out, inn, c) {
      var r = M.roster(code); if (!r) return null;
      var a = c.after[code], s2 = M.RULES.s2, cap = s2.cap, pay = r.payroll.active;
      var before = { active: units(r.active), payroll: pay, room: cap == null ? null : cap - pay };
      var after = { active: a.active, payroll: a.payroll, room: a.room };
      var lim = { total: s2.limit }, min = s2.min, cty = city(code), flags = [], needs = [];
      ["F", "D", "G"].forEach(function (u) {
        var b = before.active[u], n = after.active[u];
        if (n < b) {
          if (n < min[u]) return;   /* the check's own "minimum" problem says it, below */
          if (u === "G" && n === 1) needs.push("Leaves " + cty + " one goaltender on the active roster.");
          else if (n === min[u]) needs.push("Leaves " + cty + " at the Season 2 minimum of " + min[u] + " " + unitWord(u, min[u]) + ".");
          else needs.push(cty + " goes from " + b + " to " + n + " " + unitWord(u, n) + " on the active roster.");
        } else if (n > b) needs.push(cty + " adds depth: " + n + " " + unitWord(u, n) + " on the active roster, up from " + b + ".");
      });
      /* the limit, the cap and the minimums are the check's own words (plan above), so nothing is said twice */
      c.problems.forEach(function (x) { if (x.club === code) flags.push(x.text); });
      return { code: code, team: team(code), before: before, after: after, limits: lim, cap: cap, min: min, flags: flags, needs: needs };
    }
    function an(word) { return /^[aeiou]/i.test(String(word)) ? "an " : "a "; }
    /* what the reading leads with: a short lead (who gets the higher-rated player, or that both get the same rating) and
       one plain sentence under it (that player, then what the other club gets: cap room, depth or the players by name).
       The rating is the one the value counts (headRow), and any word about value is read from ev.receives, the same
       numbers as the verdict. Review 2026-10-20: the tie branches named the club that got the single best-valued player as
       getting "the most value" while the verdict favored the other club, and the whole sentence was set as the headline */
    function headlineOf(ev) {
      var live = ev.sides[0].players.concat(ev.sides[1].players).filter(function (x) { return !x.missing; });
      if (!ev.sides[0].n || !ev.sides[1].n) return { lead: "Pick players on both sides", rest: "The reading follows every player you add." };
      var gone = ev.sides[0].missing + ev.sides[1].missing;
      if (ev.sides.some(function (s) { return s.n === s.missing; }))
        return { lead: gone === 1 ? "A player here is no longer on a roster" : "Players here are no longer on a roster", rest: "A player who is off every roster counts 0 in the reading, and the offer cannot go through." };
      var rate = function (x) { return x.value.overall; };
      var best = live.slice().sort(function (a, b) { return rate(b) - rate(a) || b.value.value - a.value.value; })[0];
      var getsBest = ev.sides[0].players.indexOf(best) >= 0 ? ev.sides[1].club : ev.sides[0].club;   /* side 0 is what `from` sends */
      var other = getsBest === ev.from ? ev.to : ev.from, oSide = other === ev.from ? ev.sides[1] : ev.sides[0], gSide = other === ev.from ? ev.sides[0] : ev.sides[1];
      var top = [ev.sides[0], ev.sides[1]].map(function (s) { return s.players.filter(function (x) { return !x.missing; }).reduce(function (a, x) { return Math.max(a, rate(x)); }, 0); });
      var R = ev.receives, hi = ev.reading.favors, lo = hi ? (hi === ev.from ? ev.to : ev.from) : null;
      var done = ev.status === "accepted" || ev.status === "reversed", got = done ? "got " : "gets ";   /* a completed trade is told in the past tense */
      var who = best.tag + ", " + (best.posName ? an(best.posName) + best.posName.toLowerCase() : "a player") + " rated " + rate(best) + (best.headline.provisional ? " (provisional)" : "") + ".";
      var room = ev.clubs && ev.clubs[other] ? ev.clubs[other].after.room - ev.clubs[other].before.room : gSide.salary - oSide.salary;
      /* what the other club gets, as a phrase, so a tie can fold it into the value sentence when it is the same club */
      var what = room > 0 ? (done ? "cleared " : "clears ") + cash(room) + " of cap room"
        : got + (oSide.n > gSide.n ? "depth, " + words(oSide.n) + " players for " + words(gSide.n) : list(oSide.players.map(function (x) { return x.tag; })));
      var then = city(other) + " " + what + ".";
      if (top[0] !== top[1]) return { lead: city(getsBest) + " " + got + "the higher-rated player", rest: who + " " + then };
      var value = ev.reading.state === "even" ? "The value is about even, " + Math.max(R[ev.from], R[ev.to]) + " to " + Math.min(R[ev.from], R[ev.to]) + ". " + then
        : city(hi) + " " + got + "more value, " + R[hi] + " to " + R[lo] + (hi === other ? ", and " + what.replace(/^(gets|got) /, "") + "." : ". " + then);
      return { lead: "Both clubs " + (done ? "got" : "get") + " a player rated " + top[0], rest: value };
    }
    /* the paired comparison: one player each club gets, in the same role and both ranked (six games at their position),
       the pair with the most value; else the best by value on each side and the reason there is no profile */
    function compareOf(ev) {
      var ready = function (x) { return x.ranks.filter(function (y) { return y.score != null; }).length >= 3; };
      var pool = function (s) { return s.players.filter(function (x) { return !x.missing; }).sort(function (p, q) { return q.value.value - p.value.value; }); };
      var A = pool(ev.sides[1]), B = pool(ev.sides[0]), a = A[0] || null, b = B[0] || null, best = -1;   /* a: what `from` gets; b: what `to` gets */
      if (!a || !b) return null;
      A.filter(ready).forEach(function (x) { B.filter(ready).forEach(function (y) { if (x.role === y.role && x.value.value + y.value.value > best) { best = x.value.value + y.value.value; a = x; b = y; } }); });
      if (best < 0) return { ok: false, a: a, b: b, why: a.role !== b.role ? "A skater for a goaltender: their numbers are not on one scale, so each is read against their own position above."
        : "Too few games to compare their profiles: ranks need six games at a position." };
      var keys = KEYS[a.role].filter(function (k) { return a.ranks.some(function (x) { return x.key === k && x.score != null; }) && b.ranks.some(function (x) { return x.key === k && x.score != null; }); });
      var at = function (x, k) { return x.ranks.filter(function (y) { return y.key === k; })[0]; };
      return { ok: true, a: a, b: b, role: a.role, axes: keys.map(function (k) { return at(a, k).short; }), labels: keys.map(function (k) { return at(a, k).label; }),
        av: keys.map(function (k) { return at(a, k).score; }), bv: keys.map(function (k) { return at(b, k).score; }),   /* rank scores, 0 to 100 */
        ar: keys.map(function (k) { return at(a, k); }), br: keys.map(function (k) { return at(b, k); }) };              /* the ranks themselves, for their text */
    }
    /* S2.trade.evaluate({ from, to, send, get }) or an offer -> the reading. See js/trade.js for the views */
    function evaluate(o) {
      o = o || {};
      var from = String(o.from || "").toUpperCase(), to = String(o.to || "").toUpperCase(), send = (o.send || []).slice(), get = (o.get || []).slice();
      var A = tradeSide(send), B = tradeSide(get), rd = reading(A, B, from, to);
      var c = team(from) && team(to) && from !== to && send.length && get.length ? check({ from: from, to: to, send: send, get: get }) : null;
      var placed = c && c.placements.length, land = {};
      if (placed) c.placements.forEach(function (pl) { land[pl.pid] = { club: pl.club, squad: pl.squad }; });
      var side = function (code, S, pids) { var s = Object.assign({ club: code, team: team(code) }, S); s.players = pids.map(function (x) { return playerEval(x, land[x]); }); return s; };
      var ev = { from: from, to: to, send: send, get: get, status: o.status || null,
        sides: [side(from, A, send), side(to, B, get)],   /* sides[0] is what `from` sends, sides[1] what `to` sends */
        reading: rd, total: rd.total,
        receives: {}, share: {},                            /* by club: the value it receives and its share of the whole */
        check: c, clubs: null };
      ev.receives[from] = B.value; ev.receives[to] = A.value;
      ev.share[from] = rd.total ? B.value / rd.total : 0.5; ev.share[to] = rd.total ? A.value / rd.total : 0.5;
      if (placed) { ev.clubs = {}; ev.clubs[from] = clubState(from, send, get, c); ev.clubs[to] = clubState(to, get, send, c); }
      ev.headline = headlineOf(ev);
      ev.compare = compareOf(ev);
      return ev;
    }
    /* self-check at load (fail loud): the reading must agree with the live verdict on a hand-built case */
    (function () {
      var r = reading({ n: 1, value: 100 }, { n: 1, value: 120 }, "AAA", "BBB"), e = reading({ n: 1, value: 100 }, { n: 1, value: 107 }, "AAA", "BBB");
      if (r.state !== "favors" || r.favors !== "AAA" || r.pct !== 17 || e.state !== "even") console.error("S2.trade: the trade reading no longer matches the live verdict (part_live.js CG.tradeBalanceCard)", r, e);
    })();

    T.check = check; T.evaluate = evaluate; T.tradeValue = tradeValue; T.tradeStats = tradeStats; T.tradeSide = tradeSide; T.playerEval = playerEval; T.side = side;
  })();

  /* ---------- the one source for each fact ---------- */
  /* the club the viewer acts for: Team HQ's one definition (their seat's club; a commissioner's preview club) */
  function club() { return S2._hq.club(); }
  /* the offer the address names, as the league let this reader read it (null: not theirs, or none) */
  function offerOf(id) { var e = id && LV[id]; return e ? e.o : null; }
  function side(o, code) { return T.side(o, code); }
  /* the trade block as the league holds it (roster_spots.on_block for the season on screen, through the model); a
     manager's listing is a stale flag, never counted (Rule 2.6) */
  function listing(pid) { var p = M.player(pid); return !!(p && p.onBlock && p.rostered && !p.seat); }
  function listed(code) { return M.players.filter(function (p) { return p.onBlock && p.rostered && !p.seat && p.club === code; }); }
  /* who may open the page: a front office builds and answers; staff read an offer (the league office sees every offer) */
  function canSee(r) { return S2.has("office") || (S2.has("staff") && !!(r && r.q && r.q.offer)); }

  /* ---------- the address ---------- */
  function ids(s) { return String(s || "").split(",").filter(Boolean); }
  function hrefNow() {
    if (ST.mode === "offer") return "#/trade?offer=" + encodeURIComponent(ST.offer);
    var q = [];
    if (ST.partner) q.push("with=" + ST.partner);
    if (ST.send.length) q.push("send=" + ST.send.join(","));
    if (ST.get.length) q.push("get=" + ST.get.join(","));
    if (ST.counter) q.push("counter=" + encodeURIComponent(ST.counter));
    if (ST.club && ST.club !== club()) q.push("club=" + ST.club);
    return "#/trade" + (q.length ? "?" + q.join("&") : "");
  }
  function syncUrl() { var h = hrefNow(); if (location.hash !== h) history.replaceState(history.state, "", h); }
  /* the doors: js/flows.js hands a data-flow="trade" context here (club, player, counter) */
  S2.tradePage = {
    href: function (ctx) {
      ctx = ctx || {};
      if (ctx.counter) return "#/trade?counter=" + encodeURIComponent(ctx.counter);
      var me = club(), code = String(ctx.club || me || "").toUpperCase(), q = [], p = ctx.player && M.player(ctx.player);
      if (p && p.rostered) { if (p.club === code) q.push("send=" + p.id); else q.push("with=" + p.club, "get=" + p.id); }
      if (code !== me && S2.has("commish")) q.push("club=" + code);
      return "#/trade" + (q.length ? "?" + q.join("&") : "");
    },
    offer: function (id) { return "#/trade?offer=" + encodeURIComponent(id); }
  };

  /* read the address into ST. A pick that is no longer on its club (a trade or waiver since) or holds a seat is dropped,
     and the page says why once (ST.flash) */
  function init(r) {
    var q = r.q, o = q.offer ? offerOf(q.offer) : null, gone = [];
    ST.flash = ""; ST.acting = true; if (q.offer) ST.note = "";
    if (q.offer) {
      ST.mode = "offer"; ST.offer = q.offer; ST.counter = null;
      if (!o) { ST.club = null; return; }
      var mine = club(), dir = side(o, mine);
      /* offers are private to the two front offices and the league office (Rule 2.3). A commissioner answers for the club
         it was sent to; a staffer reads it from that side and answers nothing (RLS already kept everyone else out) */
      ST.club = dir ? mine : S2.has("staff") ? o.to : null;
      ST.acting = !!dir || S2.has("commish");
      if (!ST.club) return;
      dir = side(o, ST.club);
      ST.partner = dir === "in" ? o.from : o.to;
      ST.send = (dir === "in" ? o.get : o.send).slice(); ST.get = (dir === "in" ? o.send : o.get).slice();
      return;
    }
    ST.mode = "build"; ST.offer = null;
    ST.club = S2.has("commish") && q.club && M.team(q.club.toUpperCase()) ? q.club.toUpperCase() : club();
    o = q.counter ? offerOf(q.counter) : null;
    /* the league gave no row for that id (not the reader's club's offer, or none), so nothing of it is drawn */
    if (q.counter && !o) { ST.flash = "That counter link names no offer your club can see, so this opens as a new trade."; delete q.counter; }
    /* a counter belongs to the club the offer was sent to; anyone else sees neither the offer nor its players (Rule 2.3,
       audit 2026-11-09: a forged counter link opened another club's private offer). A commissioner acts for that club */
    if (o && !S2.has("commish") && side(o, ST.club) !== "in") {
      ST.flash = "That counter link is for another club's offer, so this opens as a new trade.";
      o = null; delete q.counter; delete q.send; delete q.get; delete q.with;
    }
    if (o && !("send" in q) && !("get" in q) && !("with" in q)) {
      /* a counter starts from their offer with the sides swapped (CG.counterTrade, part_live.js:15086) */
      ST.club = o.to; ST.partner = o.from; ST.send = o.get.slice(); ST.get = o.send.slice();
      ST.counter = o.status === "pending" ? o.id : null;
      if (!ST.counter) ST.flash = "That offer is no longer open (it was " + o.status + "), so this goes as a new offer.";
    } else {
      ST.counter = o && o.status === "pending" ? o.id : null;
      ST.partner = q.with && M.team(q.with.toUpperCase()) && q.with.toUpperCase() !== ST.club ? q.with.toUpperCase() : null;
      ST.send = ids(q.send); ST.get = ST.partner ? ids(q.get) : [];
    }
    ST.send = ST.send.filter(function (x) { return keep(x, ST.club, gone); });
    ST.get = ST.get.filter(function (x) { return keep(x, ST.partner, gone); });
    if (gone.length) ST.flash = gone.join(" ");
  }
  function keep(pid, code, gone) {
    var p = M.player(pid);
    if (!p || !on(pid, code)) { gone.push((p ? p.tag : "A player") + " is no longer on the " + team(code).full + ", so they are off the trade."); return false; }
    if (p.seat) { gone.push(p.tag + " holds the " + team(code).city + " " + p.seat + " seat, so they can't be traded (Rule 2.6)."); return false; }
    if (S2.market && S2.market.inPool(pid)) { gone.push(p.tag + " is in the training camp pool, so they can't be traded (Rule S2.5)."); return false; }
    return true;
  }
  function evNow() { return T.evaluate({ from: ST.club, to: ST.partner, send: ST.send, get: ST.get }); }

  /* =====================================================================================================================
     THE HEAD: Team HQ's own band in the club's color, one level deeper (crumbs back to Trades)
     ===================================================================================================================== */
  /* the tab and bar title: the page's own title in Team HQ, set through the one door (S2.setTitle) wherever the page draws
     its title again in place (QA round 2 A1, 2026-11-25: an offer that landed after its read wrote only the bar's title,
     so the tab kept "Offer · CGHL"; a repaint that changed the heading changed neither) */
  function docTitle() { return titleText() + " · Team HQ"; }
  function titleText() {
    var o = ST.offer && offerOf(ST.offer);
    if (ST.mode === "offer" && o) return (side(o, ST.club) === "in" ? "Offer from the " : "Offer to the ") + team(ST.partner).name;
    return ST.counter ? "Counter the " + team(ST.partner).name : "Build a trade";
  }
  function ledeText() {
    var o = ST.offer && offerOf(ST.offer);
    if (ST.mode === "offer" && o && !ST.acting) return "Read by the league office from the side of the " + team(o.to).full + ", the club it was sent to. Only the two clubs answer an offer (Rule 2.3).";
    if (ST.mode === "offer" && o) return o.status === "pending" ? (side(o, ST.club) === "in" ? "Every number below reads their offer from your side. Accept it, counter it with your own players, or decline it." :
      "Your offer is waiting for their answer. Every number below reads it as it stands today.") : "This offer was " + o.status + ". The page reads it as the players stand today.";
    return "Pick a club, then the players each side sends. The reading, both rosters, both lineups and the cap follow every pick, and nothing is sent until you propose.";
  }
  function crumbs() { return S2.crumbs([["#/hq", "Team HQ"], ["#/hq?tab=trades", "Trades"], ["", ST.mode === "offer" ? "Offer" : ST.counter ? "Counter" : "Build a trade"]]); }
  function headHtml() {
    var t = team(ST.club);
    return '<header class="page-head hqx-head band club tight hqx-band tp-head reveal" style="' + esc(S2.clubBand(t)) + '">' +   /* the one band (S2.clubBand, QA round 2 A4) */
      '<div data-w="crumbs">' + crumbs() + "</div>" +
      '<div class="hqx-head-in"><div class="hqx-head-copy"><span class="kicker hqx-kick">' + esc(t.full) + " · Trade Hub</span>" +
        '<h1 class="d-1" data-w="title">' + esc(titleText()) + '</h1><p class="hqx-lede" data-w="lede">' + esc(ledeText()) + "</p>" +
        (ST.flash ? '<p class="tp-flash" role="status">' + esc(ST.flash) + "</p>" : "") + "</div>" +
        '<a class="hqx-medal" href="' + esc(t.href) + '" aria-label="' + esc(t.full) + ' club page">' + M.crest(ST.club, "xl") + "</a></div></header>";
  }

  /* =====================================================================================================================
     WHO TO TRADE WITH: every other club, with what a front office checks first
     ===================================================================================================================== */
  /* a club's room in plain words: below the Season 2 minimum at a unit first (Rule S2.4), then open active spots */
  /* the club's Season 2 standing, read where Roster & cap and Bidding read it (S2.market.clubState: the active roster
     against twelve and the cap), so the trade page never shows a second cap room (audit 2026-11-09) */
  function cs(code) { return S2.market.clubState(code); }
  function roomText(code) {
    var c = cs(code); if (!c) return "";
    /* the minimums run from the draft on (Rule S2.4): before it every club is at zero and short of nothing (S2._hq) */
    var min = M.RULES.s2.min, short = S2._hq && S2._hq.minsInForce && !S2._hq.minsInForce() ? [] : UNITS.filter(function (u) { return c.active[u[0]] < min[u[0]]; });
    if (short.length) return "Below the minimum at " + list(short.map(function (u) { return u[1].toLowerCase(); }));
    return c.spots > 0 ? plural(c.spots, "open spot") : "Active roster full";
  }
  function railHtml() {
    var clubs = M.teams.filter(function (t) { return t.code !== ST.club; });
    return head("Trade partner", esc(ST.partner ? "Trading with the " + team(ST.partner).full : "Pick a club to trade with"),
        "Each club's record, cap room and roster room, so you can see who has space for what you send.") +
      '<div class="tp-rail" role="group" aria-label="Trade partner">' + clubs.map(function (t) {
        var st = standing(t.code), c = cs(t.code), blk = listed(t.code).length;
        return '<button type="button" class="tp-club" data-act="partner" data-v="' + t.code + '" aria-pressed="' + (t.code === ST.partner) + '">' +
          M.crest(t.code, "lg") + '<span class="tp-club-n">' + esc(t.city) + "</span>" +
          /* no rank over a table of zeros (QA function 16: "0-0-0 · 1st East" before any final) */
          '<span class="tp-club-r num">' + esc(!st ? "–" : M.view.empty.finals ? "No games yet" : rec(st) + " · " + S2.ord(st.div_rank) + " " + st.division) + "</span>" +
          '<span class="tp-club-f"><b class="num">' + esc(c ? money(c.room) : "–") + "</b> cap room</span>" +
          '<span class="tp-club-x">' + esc(roomText(t.code) + (blk ? " · " + blk + " on the block" : "")) + "</span></button>";
      }).join("") + "</div>";
  }

  /* =====================================================================================================================
     THE MATCH CENTER: what each side sends, the balance between them, the reading's sentence and the check.
     The bar is drawn in the order the columns are read (left: what you send, right: what you get), so its split matches
     the two numbers above it, and its accent is what you get, filled from the right under that column: the reading below
     (S2.trade.detail) also fills what you get in the accent, from its left, under its "You receive" side, so the color
     means one thing on the whole page. The verdict is S2.trade.verdict, the wording the Trades list and the reading use.
     ===================================================================================================================== */
  function matchHtml() {
    return '<div class="tp-m">' + mSide("me") + '<div class="tp-m-mid" data-w="mmid">' + midInner(evNow()) + "</div>" + mSide("them") + "</div>";
  }
  function mSide(s) {
    var code = codeOf(s);
    return '<div class="tp-m-side" data-side="' + s + '"><div class="tp-m-h">' + (code ? M.crest(code, "lg") : '<span class="tp-m-blank" aria-hidden="true"></span>') +
      '<span class="tp-m-t"><span class="kicker">' + (s === "me" ? "You send" : "You get") + '</span><span class="d-3">' + esc(code ? city(code) : "Pick a club") + "</span></span>" +
      '<b class="d-num tp-m-v" data-w="mv-' + s + '">' + sumVal(s) + "</b></div>" +
      '<ul class="tp-m-list" data-w="ml-' + s + '">' + mList(s) + "</ul></div>";
  }
  function sumVal(s) { var a = picks(s); return a.length ? a.reduce(function (n, x) { return n + tv(x).value; }, 0) : "–"; }
  function mList(s) {
    var a = picks(s), code = codeOf(s);
    if (!a.length) return '<li class="tp-m-none">' + esc(!code ? "Pick a trade partner above." : locked() ? "Nobody." : s === "me" ? "Tick players on your roster below." : "Tick players on their roster below.") + "</li>";
    return a.map(mItem).join("");
  }
  function mItem(pid) {
      var p = M.player(pid), v = tv(pid); if (!p) return "";
      return '<li class="tp-m-p" data-pid="' + esc(pid) + '"><span class="tp-m-pn"><a href="' + esc(p.href) + '">' + esc(p.tag) + '</a><span class="tp-m-pm">' + esc(p.pos + " · " + v.overall + " OVR · " + money(p.salary)) + "</span></span>" +
        '<b class="num">' + v.value + "</b>" +
        (locked() ? "" : '<button type="button" class="tp-m-x" data-act="drop" data-pid="' + pid + '" aria-label="Take ' + esc(p.tag) + ' off the trade">' + S2.ic("x") + "</button>") + "</li>";
  }
  /* keyed: a player already in the list keeps their element, so only a new pick slides in (css/tradebuild.css
     @starting-style) and the others hold still; one taken off leaves at once */
  function syncList(s) {
    var host = S2.$('[data-w="ml-' + s + '"]'), a = picks(s); if (!host) return;
    if (!a.length || S2.$(".tp-m-none", host)) { host.innerHTML = mList(s); if (!a.length) return; }
    S2.$$("li[data-pid]", host).forEach(function (li) { if (a.indexOf(li.dataset.pid) < 0) li.remove(); });
    a.forEach(function (pid) { if (!S2.$('li[data-pid="' + CSS.escape(pid) + '"]', host)) host.insertAdjacentHTML("beforeend", mItem(pid)); });
  }
  /* the share of the value both clubs receive that comes to you */
  function share(ev) { var a = ev.receives[ST.partner] || 0, b = ev.receives[ST.club] || 0; return a + b > 0 ? b / (a + b) : 0.5; }
  function checkLine(ev) {
    var o = ST.offer && offerOf(ST.offer);
    if (o && (o.status === "accepted" || o.status === "reversed")) return "";
    if (!ev.check) return "";
    var n = ev.check.problems.length;
    return '<p class="tp-chk ' + (n ? "bad" : "ok") + '">' + S2.ic(n ? "x" : "check") + "<span>" + esc(n ? (n === 1 ? "One problem" : n + " problems") + " in the roster and cap check" : "Passes the roster and cap checks") + "</span>" +
      '<a href="#tpRead" data-act="jump">' + (n ? "See why" : "The reading") + "</a></p>";
  }
  function empty() { return !ST.send.length || !ST.get.length; }
  function midInner(ev) {
    var r = ev.reading, s = share(ev), e = empty();
    return '<div class="tp-m-rd" data-tone="' + (e ? "none" : S2.trade.tone(ev, ST.club)) + '"><span class="kicker">The reading</span>' +
      '<p class="tp-m-verdict"><span class="tr-tone" aria-hidden="true"></span><b>' + esc(e ? "Waiting for players" : S2.trade.verdict(ev, ST.club)) + "</b></p>" +
      '<div class="tr-bar' + (e ? " is-empty" : "") + '" role="img" aria-label="' + esc(e ? "No players on one side yet" : "You send " + ev.receives[ST.partner] + " in value, you get " + ev.receives[ST.club]) + '">' +
        '<i class="tr-bar-a" style="transform:scaleX(' + (e ? 0 : s).toFixed(4) + ')"></i><span class="tr-bar-mid" aria-hidden="true"></span></div>' +
      '<p class="tp-m-s">' + esc(e ? "Pick players on both sides to read the trade. The bar splits the value each side sends; under 8% apart reads Even." : ev.headline.lead + ". " + ev.headline.rest) + "</p>" +
      checkLine(ev) + "</div>";
  }
  /* in place: the bar keeps its old split for one frame, then glides to the new one (an interruptible transition,
     css/trade.css .tr-bar-a), so a quick run of ticks retargets instead of restarting */
  function patchBar(host, html) {
    if (!host) return;
    var bar = S2.$(".tr-bar-a", host), was = bar && bar.style.transform;
    host.innerHTML = html;
    var nb = S2.$(".tr-bar-a", host); if (!bar || !nb || S2.reduce.matches) return;
    var to = nb.style.transform; nb.style.transform = was; nb.getBoundingClientRect(); nb.style.transform = to;
  }

  /* =====================================================================================================================
     THE ROSTERS: both clubs in full, sortable, every player opening to their ratings, ranks and form
     ===================================================================================================================== */
  function lineOf(p) { return p.unit === "G" ? p.lines.G || p.lines.S : p.lines.S || p.lines.G; }
  function stat(p, k) {
    var L = lineOf(p) || {}, v = tv(p.id);
    switch (k) {
      case "ovr": return v.overall; case "val": return v.value; case "sal": return +p.salary || 0; case "gp": return L.gp || 0;
      case "g": return L.g || 0; case "a": return L.a || 0; case "p": return L.p || 0; case "ppg": return L.pts_pg == null ? null : L.pts_pg;
      case "svp": return L.sv_pct == null ? null : L.sv_pct; case "gaa": return L.gaa == null ? null : L.gaa; case "w": return L.w || 0; case "so": return L.so || 0;
    }
    return null;
  }
  function cell(p, k) {
    var x = stat(p, k);
    if (x == null) return "–";
    return k === "sal" ? money(x) : k === "ppg" ? M.display("pts_pg", x) : k === "svp" ? M.display("sv_pct", x) : k === "gaa" ? M.display("gaa", x) : String(x);
  }
  /* a heading sorts best first (lowest first for GAA), then the other way; the unit's own heading goes back to rink order */
  function sorted(players, s) {
    var o = ST.sort[s]; if (!o) return players;
    var dir = (o.dir === "asc" ? 1 : -1) * (o.k === "gaa" ? -1 : 1);
    return players.slice().sort(function (a, b) {
      var x = stat(a, o.k), y = stat(b, o.k);
      if (x == null && y == null) return M.byRink(a, b); if (x == null) return 1; if (y == null) return -1;
      return (x - y) * dir || M.byRink(a, b);
    });
  }
  function panelHtml(s) {
    var code = codeOf(s);
    if (!code) return '<div class="tp-panel is-empty" data-side="them"><div class="tp-panel-h"><span class="tp-m-blank" aria-hidden="true"></span><div class="tp-panel-t"><span class="kicker">Their roster</span><h3 class="d-3">No club picked</h3></div></div>' +
      '<p class="t-sub tp-pad">Pick a trade partner above and their whole roster opens here, with every stat line.</p></div>';
    var t = team(code), c = cs(code);
    return '<div class="tp-panel" data-side="' + s + '">' +
      '<div class="tp-panel-h">' + M.crest(code, "lg") + '<div class="tp-panel-t"><span class="kicker">' + (s === "me" ? "Your roster · you send" : "Their roster · you get") + "</span>" +
        '<h3 class="d-3">' + esc(t.full) + "</h3>" +
        '<span class="t-foot">' + esc(c.active.total + " of " + c.limit + " active (" + c.active.F + " F, " + c.active.D + " D, " + c.active.G + " G) · " + money(c.room) + " cap room") + "</span></div>" +
        '<span class="tp-panel-n num" data-w="pn-' + s + '">' + pickCount(s) + "</span></div>" +
      '<div class="tp-tools"><div class="seg" data-seg="' + s + '" aria-label="Position">' + SEG.map(function (x) { return '<button type="button" data-v="' + x[0] + '" aria-pressed="' + (ST.unit[s] === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div></div>" +
      '<div data-w="tbl-' + s + '">' + tablesHtml(s) + "</div></div>";
  }
  function pickCount(s) { var a = picks(s); return a.length ? a.length + " picked · value " + sumVal(s) : "None picked"; }
  function tablesHtml(s) {
    var code = codeOf(s), R = M.roster(code); if (!R) return "";
    return UNITS.filter(function (u) { return ST.unit[s] === "all" || ST.unit[s] === u[0]; }).map(function (u) {
      /* the active roster only: a pool player is the league's, never a club's to trade (Rule S2.5, the pool; audit 2026-11-09) */
      var ps = sorted(R.active.filter(function (p) { return p.unit === u[0] && !(S2.market && S2.market.inPool(p.id)); }).sort(M.byRink), s), cols = COLS[u[0] === "G" ? "G" : "S"], o = ST.sort[s];
      if (!ps.length) return "";
      return '<div class="tp-tw"><table class="tp-tbl" data-unit="' + u[0] + '"><caption class="sr">' + esc(team(code).full + " " + u[1].toLowerCase()) + "</caption>" +
        '<thead><tr><th scope="col" class="tp-c-pick"><span class="sr">In the trade</span></th>' +
          '<th scope="col" class="tp-c-name"' + (o ? "" : ' aria-sort="other"') + '><button type="button" data-act="sort" data-side="' + s + '" data-k="" title="Rink order">' + esc(u[1]) + ' <span class="num tp-c-n">' + ps.length + "</span></button></th>" +
          cols.map(function (c) {
            var cur = o && o.k === c[0];
            return '<th scope="col" class="' + (c[3] ? "x" + (c[3] === 2 ? "2" : "") : "") + '"' + (cur ? ' aria-sort="' + ((o.dir === "asc") === (c[0] !== "gaa") ? "ascending" : "descending") + '"' : "") + '><button type="button" data-act="sort" data-side="' + s + '" data-k="' + c[0] + '" title="' + esc(c[2]) + '">' + esc(c[1]) + "</button></th>";
          }).join("") + "</tr></thead><tbody>" +
        ps.map(function (p) { return rowHtml(p, s, cols); }).join("") + "</tbody></table></div>";
    }).join("");
  }
  function rowHtml(p, s, cols) {
    var picked = picks(s).indexOf(p.id) >= 0, open = !!ST.open[p.id], seat = !!p.seat, blk = !!listing(p.id);
    var meta = esc([p.pos + (p.num != null ? " · #" + p.num : ""), p.squad === "tc" ? "Camp" : null, seat ? p.seat + " seat" : null].filter(Boolean).join(" · ")) + (blk ? ' · <span class="tp-blk">On the block</span>' : "");
    return '<tr class="tp-row' + (picked ? " is-picked" : "") + (seat ? " is-seat" : "") + '" data-pid="' + p.id + '">' +
      '<td class="tp-c-pick"><button type="button" class="tp-tick" data-act="pick" data-side="' + s + '" data-pid="' + p.id + '" aria-pressed="' + picked + '"' + (seat || locked() || arch() ? ' aria-disabled="true"' : "") +
        ' aria-label="' + esc(seat ? p.tag + " holds the " + p.seat + " seat and can't be traded (Rule 2.6)" : picked ? "Take " + p.tag + " off the trade" : "Add " + p.tag + " to the trade") + '">' + S2.ic("check") + "</button></td>" +
      '<th scope="row" class="tp-c-name"><button type="button" class="tp-name" data-act="more" data-pid="' + p.id + '" aria-expanded="' + open + '" aria-controls="tpMore-' + p.id + '">' +
        '<span class="tp-n" title="' + esc(p.tag) + '">' + esc(p.tag) + '</span><span class="tp-meta">' + meta + "</span>" + S2.chev() + "</button></th>" +
      cols.map(function (c) { return '<td class="num' + (c[3] ? " x" + (c[3] === 2 ? "2" : "") : "") + (c[0] === "val" ? " tp-val" : "") + '">' + esc(cell(p, c[0])) + "</td>"; }).join("") + "</tr>" +
      '<tr class="tp-more" id="tpMore-' + p.id + '"' + (open ? "" : " hidden") + '><td colspan="' + (cols.length + 2) + '">' + (open ? moreHtml(p) : "") + "</td></tr>";
  }
  /* the open row: the rating's parts, then the reading's own player block (S2.trade.playerBody: the rating in words, every
     line the player has, the ranks at their position and the last five games), then how they came to the club */
  function moreHtml(p) {
    var r = M.ratings(p.id)[0], cats = r && r.radar ? r.radar.axes.map(function (a, i) { return [a, r.radar.values[i]]; }) : [];
    var t = (p.tenures || []).filter(function (x) { return x.club === p.club && !x.to; })[0];
    return '<div class="tp-more-in">' +
      (cats.length ? '<div class="tp-cats-w"><span class="kicker">' + esc("Rating parts · " + r.ovr + " at " + r.posName + (r.provisional ? " (provisional)" : "")) + '</span><dl class="tp-cats">' + cats.map(function (c) {
        return "<div><dt>" + esc(c[0]) + '</dt><dd class="num">' + c[1] + '<span class="tp-cat-t" aria-hidden="true"><i style="transform:scaleX(' + Math.max(0, Math.min(1, (c[1] - 40) / 59)).toFixed(3) + ')"></i></span></dd></div>';
      }).join("") + "</dl></div>" : "") +
      S2.trade.playerBody(T.playerEval(p.id)) +
      '<p class="tp-more-f"><span>' + esc([t ? "With " + city(p.club) + " since " + t.fromLabel + (t.how_in ? ", " + t.how_in : "") : null, "Value " + tv(p.id).value + " counts rating, production and salary"].filter(Boolean).join(" · ")) + "</span>" +
      /* your own player can go on or come off the trade block here (Rule 2.3), through the same door as Team HQ */
      (blockable(p) ? '<button type="button" class="btn secondary sm" data-act="block" data-pid="' + esc(p.id) + '" data-v="' + (listing(p.id) ? "off" : "on") + '"' + (ST.busy ? ' aria-disabled="true" aria-busy="true"' : "") + ">" +
        (listing(p.id) ? "Take off the trade block" : "Put on the trade block") + "</button>" : "") +
      arrow("Full profile", p.href) + "</p></div>";
  }

  /* =====================================================================================================================
     THE LINEUP, BEFORE AND AFTER: each club's best six at their positions from the active roster (the six a club dresses
     in a 6v6 game: LW C RW, LD RD, G). A spot takes a player registered there first, then the same position group, then
     anyone with a rating in that group, best rating first; spots are filled scarcest first (goal, then center)
     ===================================================================================================================== */
  function rateAt(p, grp) {
    var row = M.ratings(p.id).filter(function (r) { return r.pos === grp; })[0];
    if (row) return row.ovr;
    return M.GROUP[p.pos] === grp ? tv(p.id).overall : null;
  }
  function bestSix(players) {
    var used = {}, slots = {};
    PICK.forEach(function (s) {
      var g = SLOT_GROUP[s], best = null;
      players.forEach(function (p) {
        if (used[p.id]) return;
        var r = rateAt(p, g); if (r == null) return;
        var tier = p.pos === s ? 0 : M.GROUP[p.pos] === g ? 1 : 2;
        if (!best || tier < best.tier || (tier === best.tier && r > best.r)) best = { p: p, r: r, tier: tier };
      });
      if (best) { used[best.p.id] = 1; slots[s] = best; }
    });
    var vals = SLOTS.map(function (s) { return slots[s] && slots[s].r; }).filter(function (n) { return n != null; });
    return { slots: slots, avg: vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null, n: vals.length };
  }
  function lineups(code, ev) {
    var R = M.roster(code); if (!R) return null;
    var out = code === ST.club ? ST.send : ST.get, inn = code === ST.club ? ST.get : ST.send;
    var land = {}; (ev.check ? ev.check.placements : []).forEach(function (x) { land[x.pid] = x.squad; });
    var after = R.active.filter(function (p) { return out.indexOf(p.id) < 0; })
      .concat(inn.map(function (x) { return M.player(x); }).filter(function (p) { return p && land[p.id] !== "tc"; }));
    return { before: bestSix(R.active), after: bestSix(after) };
  }
  function avgText(a) { return a == null ? "–" : a.toFixed(1); }
  function luClub(code, ev) {
    var L = lineups(code, ev); if (!L) return "";
    var aft = ST.lu === "after", show = aft ? L.after : L.before, other = aft ? L.before : L.after;
    var d = L.after.avg != null && L.before.avg != null ? L.after.avg - L.before.avg : 0, moved = Math.abs(d) >= 0.05, t = team(code);
    var tile = function (s) {
      var x = show.slots[s], y = other.slots[s], ch = aft && (x && y ? x.p.id !== y.p.id : !!x !== !!y);
      if (!x) return '<div class="tp-slot is-none' + (ch ? " is-new" : "") + '"><span class="tp-slot-p">' + s + '</span><span class="tp-slot-n">No one</span>' + (ch && y ? '<span class="tp-slot-was">Was ' + esc(y.p.tag) + "</span>" : "") + "</div>";
      return '<div class="tp-slot' + (ch ? " is-new" : "") + (x.tier ? " is-off" : "") + '"><span class="tp-slot-p">' + s + "</span>" +
        '<a class="tp-slot-n" href="' + esc(x.p.href) + '">' + esc(x.p.tag) + '</a><b class="tp-slot-r num">' + x.r + "</b>" +
        (ch && y ? '<span class="tp-slot-was">Was ' + esc(y.p.tag) + " · " + y.r + "</span>" : ch ? '<span class="tp-slot-was">New to the lineup</span>' : x.tier ? '<span class="tp-slot-was">Registered ' + esc(x.p.pos) + "</span>" : "") + "</div>";
    };
    return '<div class="tp-lu"><div class="tp-lu-h">' + M.crest(code, "lg") + '<span class="tp-lu-t"><span class="kicker">' + esc(code === ST.club ? "Your lineup" : "Their lineup") + '</span><span class="d-3">' + esc(t.full) + "</span></span>" +
        '<span class="tp-lu-r"><span class="t-foot">Lineup rating</span><b class="num">' + avgText(L.before.avg) + (moved ? '<span class="tp-to" aria-hidden="true">→</span><span class="sr"> to </span>' + avgText(L.after.avg) : "") + "</b>" +
        (moved ? '<span class="tp-d num ' + (d > 0 ? "up" : "down") + '">' + (d > 0 ? "+" : "−") + Math.abs(d).toFixed(1) + "</span>" : "") + "</span></div>" +
      '<div class="tp-rink" role="group" aria-label="' + esc(t.city + (aft ? " after the trade" : " now")) + '">' +
        '<div class="tp-rk-row f">' + ["LW", "C", "RW"].map(tile).join("") + '</div><div class="tp-rk-row d">' + ["LD", "RD"].map(tile).join("") + '</div><div class="tp-rk-row g">' + tile("G") + "</div></div></div>";
  }
  function luSay(code, L) {
    if (L.before.avg == null) return city(code) + " has no lineup to rate";
    return Math.abs(L.after.avg - L.before.avg) < 0.05 ? city(code) + " holds at " + avgText(L.before.avg) : city(code) + " goes from " + avgText(L.before.avg) + " to " + avgText(L.after.avg);
  }
  function luHead() {
    var ev = evNow(), any = ST.send.length || ST.get.length, h;
    if (!ST.partner) h = "Your best six today";
    else if (!any) h = "Both clubs' best six today";
    else h = luSay(ST.club, lineups(ST.club, ev)) + "; " + luSay(ST.partner, lineups(ST.partner, ev));
    return h;
  }
  function linesHtml(ev) {
    return head("The lineup, before and after", '<span data-w="luh">' + esc(luHead()) + "</span>",
        "Each club's six best players at their positions from the active roster, the six a club dresses in a game. A highlighted spot changes with the trade; the lineup rating is the six ratings averaged.",
        '<div class="seg" data-seg="lu" aria-label="Show the lineup">' + [["after", "After the trade"], ["now", "Now"]].map(function (x) { return '<button type="button" data-v="' + x[0] + '" aria-pressed="' + ((ST.lu === "after") === (x[0] === "after")) + '">' + x[1] + "</button>"; }).join("") + "</div>") +
      '<div class="tp-lus" data-w="lus">' + lusInner(ev) + "</div>";
  }
  function lusInner(ev) { return luClub(ST.club, ev) + (ST.partner ? luClub(ST.partner, ev) : '<div class="tp-lu is-empty"><p class="t-sub">Pick a trade partner to see their lineup beside yours.</p></div>'); }

  /* =====================================================================================================================
     THE CLUBS, SIDE BY SIDE: the season so far, from the standings and the power rankings
     ===================================================================================================================== */
  function clubsHtml() {
    if (!ST.partner) return "";
    var a = ST.club, b = ST.partner, sa = standing(a), sb = standing(b), pa = power(a), pb = power(b), ra = cs(a), rb = cs(b);
    if (!sa || !sb || !ra || !rb) return "";
    /* QA function 0 and 16 (2026-11-25): a club with no power play or penalty kill yet has pp_pct and pk_pct null
       (model.js), every Season 2 club before puck drop; .toFixed on them threw inside refresh() and the comparison and the
       Send section never drew. A figure the season does not have yet says so and is compared with nothing (lead() bolds
       neither side); before the first final no rank, standing or power ranking is drawn (every club ties at zero) */
    var raced = !M.view.empty.finals, none = "No games yet";
    var pct = function (x) { return x == null ? "No chances yet" : S2.fmt(x, 1) + "%"; };
    var per = function (s, k) { return s.gp ? s[k] / s.gp : null; }, perTxt = function (s, k) { return s.gp ? per(s, k).toFixed(2) : none; }, units = function (c) { return c.active.total + " · " + c.active.F + "\u00a0F, " + c.active.D + "\u00a0D, " + c.active.G + "\u00a0G"; };   /* a count never parts from its letter on a phone ("1 / G", audit 2026-11-09) */
    /* [label, a, b, a number to compare, b's number, lower is better] */
    var rows = [
      ["Record", rec(sa), rec(sb), sa.pts_pct, sb.pts_pct],
      ["Points", sa.pts + " in " + sa.gp + " games", sb.pts + " in " + sb.gp + " games", sa.pts_pct, sb.pts_pct],
      raced ? ["Standing", S2.ord(sa.div_rank) + " in the " + sa.division, S2.ord(sb.div_rank) + " in the " + sb.division] : ["Standing", none, none],
      ["Goals for a game", perTxt(sa, "gf"), perTxt(sb, "gf"), per(sa, "gf"), per(sb, "gf")],
      ["Goals against a game", perTxt(sa, "ga"), perTxt(sb, "ga"), per(sa, "ga"), per(sb, "ga"), 1],
      ["Goal difference", M.display("pm", sa.diff), M.display("pm", sb.diff), sa.diff, sb.diff],
      ["Power play", pct(sa.pp_pct), pct(sb.pp_pct), sa.pp_pct, sb.pp_pct],
      ["Penalty kill", pct(sa.pk_pct), pct(sb.pk_pct), sa.pk_pct, sb.pk_pct],
      ["Last five", form(sa.last5) || esc(none), form(sb.last5) || esc(none)],
      raced && pa && pb ? ["Power ranking", S2.ord(pa.rank) + ", team OVR " + pa.ovr, S2.ord(pb.rank) + ", team OVR " + pb.ovr, -pa.rank, -pb.rank] : null,
      raced && pa && pb ? ["Goaltending", pa.parts.goaltending + " of 100", pb.parts.goaltending + " of 100", pa.parts.goaltending, pb.parts.goaltending] : null,
      raced && pa && pb ? ["Depth", pa.parts.depth + " of 100", pb.parts.depth + " of 100", pa.parts.depth, pb.parts.depth] : null,
      ["Cap room", money(ra.room), money(rb.room), ra.room, rb.room],
      ["Active roster", units(ra), units(rb)],
      ["On the block", String(listed(a).length), String(listed(b).length)]
    ].filter(Boolean);
    var lead = function (r, i) { if (r[3] == null || r[4] == null || r[3] === r[4]) return false; var aw = r[5] ? r[3] < r[4] : r[3] > r[4]; return i === 0 ? aw : !aw; };
    var note = function (s, code) { return s.clinched ? " " + city(code) + " has clinched a playoff spot." : s.eliminated ? " " + city(code) + " is out of the playoffs." : ""; };
    return head("The two clubs", esc(!raced ? "Neither club has played yet" : sa.pts === sb.pts ? "Level on " + sa.pts + " points" : city(sa.pts > sb.pts ? a : b) + " leads on points, " + Math.max(sa.pts, sb.pts) + " to " + Math.min(sa.pts, sb.pts)),
        esc("Where each club stands before the trade: the season so far, how it plays, its cap and its roster. The better figure on each line is bold." + note(sa, a) + note(sb, b)), arrow("Standings", "#/standings?view=league")) +
      '<div class="tp-tw"><table class="tp-cmp"><caption class="sr">' + esc(team(a).full + " and " + team(b).full + " side by side") + "</caption>" +
      '<thead><tr><th scope="col"><span class="sr">Measure</span></th><th scope="col"><span class="tp-cmp-c">' + M.crest(a) + "<span>" + esc(city(a)) + '</span></span></th><th scope="col"><span class="tp-cmp-c">' + M.crest(b) + "<span>" + esc(city(b)) + "</span></span></th></tr></thead><tbody>" +
      rows.map(function (r) { return '<tr><th scope="row">' + esc(r[0]) + "</th>" + [1, 2].map(function (i) { return '<td class="' + (lead(r, i - 1) ? "lead" : "") + '">' + (r[0] === "Last five" ? r[i] : esc(r[i])) + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</tbody></table></div>";
  }
  /* last five, oldest first, as Team HQ and Standings draw it (hq.css .hqx-last5-m) */
  function form(last5) {
    var a = (last5 || []).slice().reverse(), name = { W: "Win", L: "Loss", OT: "Overtime loss", OTL: "Overtime loss" };
    if (!a.length) return "";
    return '<span class="hqx-last5-m" role="img" aria-label="Last five, oldest first: ' + esc(a.map(function (x) { return name[x] || x; }).join(", ")) + '">' +
      a.map(function (x) { return '<i class="' + (x === "W" ? "w" : x === "L" ? "l" : "o") + '"></i>'; }).join("") + "</span>";
  }

  /* =====================================================================================================================
     THE SEND (or, for an offer, its answers)
     ===================================================================================================================== */
  function names(a) { return list(a.map(function (x) { var p = M.player(x); return p ? p.tag : "a player"; })); }
  function isCounter() { var c = ST.counter && offerOf(ST.counter); return !!(c && c.status === "pending" && c.from === ST.partner && c.to === ST.club); }
  function sendHtml(ev) {
    var ae = arch();
    /* built from archErr's parts (shown, season), never by editing its sentence, which is Team HQ's and names its tools
       (QA round 2 nit, 2026-11-25: a regex cut that sentence's tail and kept "so Team HQ is read only here") */
    if (ae) return S2.empty("lock", "Trades run in " + ae.season, "This page shows " + esc(ae.shown) + ", so no trade can be sent from it. Trades act on " + esc(ae.season) + ".",
      '<a class="btn secondary sm" href="' + esc(S2.seasonHref(null, "#/trade")) + '">Trade in ' + esc(ae.season) + "</a>");
    if (ST.mode === "offer") return answerHtml(offerOf(ST.offer));
    /* three parts, so a repaint (a pick, the pulse) redraws the head and the buttons and never the note being typed */
    return '<div data-w="sendh">' + sendHead(ev) + "</div>" +
      '<div class="field tp-note"><label for="tpNote">' + esc(noteLabel()) + '</label><input class="input" id="tpNote" maxlength="200" placeholder="Why this works for both sides" value="' + esc(ST.note) + '"></div>' +
      '<div data-w="senda">' + sendActs(ev) + "</div>";
  }
  function noteLabel() { return "Note to the " + (ST.partner ? team(ST.partner).name : "other club") + " (optional)"; }
  function ready() { return !!(ST.partner && ST.send.length && ST.get.length); }
  function hardOf(ev) { return (ev.check ? ev.check.problems : []).some(function (x) { return x.hard; }); }
  function sendHead(ev) {
    var t = ST.partner && team(ST.partner), ctr = isCounter(), probs = ev.check ? ev.check.problems : [], hard = hardOf(ev);
    return head(ctr ? "Your counter" : "Send the offer", esc(ready() ? (ctr ? "Counter the " + t.name : "Propose to the " + t.name) : "Pick players on both sides"),
        esc(ready() ? "You send " + names(ST.send) + " to the " + t.full + " for " + names(ST.get) + ". The offer is private to the two front offices and the league office until it is accepted (Rule 2.3)."
          : "Players only: draft picks are not trade assets in the basic format (Rule 2.3). An Owner, GM or AGM can't be traded (Rule 2.6).")) +
      (ready() && probs.length ? '<ul class="tp-probs">' + probs.map(function (x) { return '<li class="' + (x.hard ? "hard" : "") + '">' + esc(x.text) + "</li>"; }).join("") + "</ul>" +
        '<p class="t-foot tp-fine">' + esc(hard ? "This can't be sent as it is." : "You can still propose it: the check runs again when they accept, and the trade is refused if it still fails.") + "</p>" : "");
  }
  /* the buttons; ST.busy keeps a write's button pressed (and the others resting) through any repaint until the league answers */
  function sendActs(ev) {
    var ctr = isCounter(), off = !ready() || hardOf(ev) || ST.busy;
    return '<p class="tp-err" role="alert">' + esc(ST.err) + '</p><div class="tp-acts"><button type="button" class="btn" data-act="propose"' + (off ? ' aria-disabled="true"' : "") + (ST.busy ? ' aria-busy="true"' : "") + ">" +
        esc(ST.busy ? "Sending" : ctr ? "Send the counter" : "Propose the trade") + "</button>" +
        /* nothing to clear is a resting button, not a live one (audit 2026-11-09) */
        '<button type="button" class="btn secondary" data-act="clear"' + ((ST.send.length || ST.get.length) && !ST.busy ? "" : ' aria-disabled="true"') + ">Clear the picks</button>" + arrow("Back to Trades", "#/hq?tab=trades") + "</div>" +
      '<p class="t-foot tp-fine">' + esc("They can accept, counter or decline. Nothing moves until they accept, and the Season 2 roster and cap checks run again then (Rules 2.3 and S2.4). " +
        "Trades close at the movement deadline (Rule 2.4).") + "</p>";
  }
  function answerHtml(o) {
    if (!o) return "";
    var dir = side(o, ST.club), them = team(ST.partner), open = o.status === "pending";
    var STATUS = { accepted: "Accepted", declined: "Declined", withdrawn: "Withdrawn", countered: "Countered", reversed: "Reversed", void: "Called off" };
    /* the league office's doors (the database lets a commissioner and the transactions staff through, and every staffer
       once the held staff powers record applies; a display hint here): a completed trade goes back, a declined or
       withdrawn offer goes out again as it was */
    var office = S2.has("staff"), acts;
    if (!open) acts = !office ? "" : o.status === "accepted" ? '<button type="button" class="btn secondary" data-act="reverse">Reverse the trade</button>'
      : o.status === "declined" || o.status === "withdrawn" ? '<button type="button" class="btn secondary" data-act="resend">Resend the offer</button>' : "";
    else if (!ST.acting) acts = "";
    else acts = dir === "in" ? '<button type="button" class="btn" data-act="accept">Accept the trade</button><button type="button" class="btn secondary" data-act="counter">Counter</button><button type="button" class="btn secondary" data-act="decline">Decline</button>'
        : '<button type="button" class="btn danger" data-act="withdraw">Withdraw the offer</button><button type="button" class="btn secondary" data-act="counter">Change it</button>';
    if (ST.busy) acts = acts.replace(/<button /g, '<button aria-disabled="true" ');
    var kick = !open ? "This offer" : !ST.acting ? "An open offer" : dir === "in" ? "Your answer" : "Your offer";
    var h = !open ? STATUS[o.status] || o.status : !ST.acting ? "Waiting on the " + team(o.to).name : dir === "in" ? "Answer the " + them.name : "Waiting on the " + them.name;
    var p = open ? (!ST.acting ? "The league office reads every offer; only the two clubs answer it, and nothing moves until the " + team(o.to).name + " accept (Rule 2.3)."
        : dir === "in" ? "Accepting completes the trade at once and posts it to the transaction log. Every player who arrives joins the active roster (Rule S2.4), and each player hears it in their inbox once the trade is done." : "They can accept, counter or decline. Change it to build a new offer from this one.")
      : o.why || (o.status === "accepted" ? "The trade is complete and on the transaction log, the only part of a trade that is public (Rule 2.3)."
        : o.status === "reversed" ? "The league office sent this trade back, and every player returned to the club that held them (Rule 2.3)." : "It is private to the two front offices and the league office (Rule 2.3).");
    return head(kick, esc(h), esc(p)) + (o.note ? '<p class="hqx-quote tp-quote">' + esc(o.note) + "</p>" : "") +
      '<p class="tp-err" role="alert">' + esc(ST.err) + '</p><div class="tp-acts">' + acts + arrow("Back to Trades", "#/hq?tab=trades") + "</div>";
  }

  /* =====================================================================================================================
     THE TRAY: the match center folded into one bar under the header once the band has scrolled away (the large title
     collapsing into the nav bar is the same move). It mirrors the band and holds nothing the band does not
     ===================================================================================================================== */
  function trayInner(ev) {
    var r = ev.reading, e = empty(), s = share(ev);
    return '<div class="tp-tray-in">' + (ST.club ? M.crest(ST.club) : "") + '<span class="tp-tray-n"><span>Send</span><b class="num">' + sumVal("me") + "</b></span>" +
      '<span class="tp-tray-rd" data-tone="' + (e ? "none" : S2.trade.tone(ev, ST.club)) + '"><span class="tp-tray-v"><span class="tr-tone" aria-hidden="true"></span><b>' + esc(e ? "Waiting for players" : S2.trade.verdict(ev, ST.club)) + "</b></span>" +
        '<span class="tr-bar sm' + (e ? " is-empty" : "") + '" aria-hidden="true"><i class="tr-bar-a" style="transform:scaleX(' + (e ? 0 : s).toFixed(4) + ')"></i><span class="tr-bar-mid"></span></span></span>' +
      '<span class="tp-tray-n r"><span>Get</span><b class="num">' + sumVal("them") + "</b></span>" + (ST.partner ? M.crest(ST.partner) : "") +
      (arch() ? "" : '<a class="btn sm" href="#tpSend" data-act="jump" tabindex="-1">' + (ST.mode === "offer" ? "Answer" : 'Review<span class="tp-long"> and send</span>') + "</a>") + "</div>";
  }

  /* =====================================================================================================================
     THE PAGE
     ===================================================================================================================== */
  function pageHtml() {
    var wait = waiting();
    if (wait) return wait;
    if (ST.mode === "offer" && !ST.club) {
      /* RLS hands a reader outside the two clubs and the league office no row at all, so the page cannot tell a private
         offer from a missing one, and says neither more nor less than that */
      return headless("No offer to show", "An offer is seen only by the two clubs' front offices and the league office (Rule 2.3), so this address shows nothing to anyone else. If the offer is your club's, the link may be wrong.");
    }
    if (!ST.club) return headless("No club to trade for", "Trades are made for the club where you hold a front-office seat, and this account holds none the league data shows. If you were seated just now, reload the page.");
    var ev = evNow(), offer = ST.mode === "offer", o = offer && offerOf(ST.offer);
    return '<div class="tp" data-mode="' + ST.mode + '">' + headHtml() +
      '<section class="tp-sec tp-railsec reveal" data-w="rail"' + (offer ? " hidden" : "") + ">" + (offer ? "" : railHtml()) + "</section>" +
      '<section class="band ink tight tp-match reveal" data-theme="dark" data-look-scope data-finish="' + esc(S2.state.finish) + '" aria-label="The trade">' +
        '<div class="tp-m-k" data-w="mk">' + mKicker(o) + "</div>" +
        '<div data-w="match">' + matchHtml() + "</div></section>" +
      '<section class="tp-sec reveal" id="tpPick"><div data-w="pickh">' + pickHead() + "</div>" +
        '<div class="seg tp-paneseg" data-seg="pane" aria-label="Roster">' + [["me", city(ST.club) + " sends"], ["them", ST.partner ? city(ST.partner) + " sends" : "Their roster"]].map(function (x) { return '<button type="button" data-v="' + x[0] + '" aria-pressed="' + (ST.pane === x[0]) + '">' + esc(x[1]) + "</button>"; }).join("") + "</div>" +
        '<div class="tp-pick" data-pane="' + ST.pane + '"><div class="tp-pick-c" data-w="panel-me">' + panelHtml("me") + '</div><div class="tp-pick-c" data-w="panel-them">' + panelHtml("them") + "</div></div></section>" +
      '<section class="tp-sec" id="tpRead" data-w="read">' + readHtml(ev) + "</section>" +
      '<section class="tp-sec" data-w="lines">' + linesHtml(ev) + "</section>" +
      '<section class="tp-sec" data-w="clubs">' + clubsHtml() + "</section>" +
      '<section class="tp-sec tp-send" id="tpSend" data-w="send" data-k="' + esc(sendKey()) + '">' + sendHtml(ev) + "</section>" +
      '<div class="tp-sec tp-foot">' + S2.about(["Rosters, salaries, ratings, statistics, standings and the power rankings are the league's own, read live.",
        "The lineup is a reading, not a sheet: the best rating at each position from the active roster, which the club's own lineup on game night may differ from.",
        "An offer is private to the two front offices and the league office until it is accepted; only a completed trade is public (Rule 2.3). Trades close at the movement deadline (Rule 2.4)."]) + "</div>" +
      '<div class="tp-tray" data-w="tray" aria-hidden="true">' + trayInner(ev) + "</div></div>";
  }
  function mKicker(o) {
    if (!o) return '<span class="kicker">The trade</span>';
    var who = !ST.acting ? "Offer from the " + team(o.from).name : side(o, ST.club) === "in" ? "Their offer" : "Your offer";
    return '<span class="kicker">' + esc(who + " · " + M.ago(Math.max(0, (Date.now() - Date.parse(o.at)) / 60000))) + "</span>";
  }
  function pickHead() {
    var offer = locked();
    return head(offer ? "The players" : "Pick the players", esc(offer ? "Both rosters, with the players in the offer ticked" : "Both rosters, every stat line"),
      esc(offer ? "Open any player for their rating parts, ranks and last five games. Counter to change who is in it." :
        "Tick a player to add them to the trade. Open a player for their rating parts, every line they have, their ranks at their position and their last five games. Every heading sorts."));
  }
  function headless(h, p) {
    return '<header class="page-head hqx-head reveal">' + S2.crumbs([["#/hq", "Team HQ"], ["#/hq?tab=trades", "Trades"], ["", "Offer"]]) + '<h1 class="d-1">' + esc(h) + '</h1><p class="hqx-lede">' + esc(p) + "</p>" +
      '<p class="tp-back">' + arrow("Back to Trades", "#/hq?tab=trades") + "</p></header>";
  }
  function readHtml(ev) {
    if (empty()) return head("The full reading", "Waiting for players on both sides", "Once both sides have a player, the full reading opens here: each player against their position, the balance, the best player each club gets head to head, and the cap and roster check after the trade.");
    return S2.trade.detail(ev, { me: ST.club, proposing: ST.mode === "build" });
  }

  /* ---------- in-place repaint (focus kept where it was) ---------- */
  function paint(name, html) {
    var el = S2.$('[data-w="' + name + '"]'); if (!el) return;
    var a = document.activeElement, key = a && el.contains(a) && a !== el ? focusKey(a) : null;
    el.innerHTML = html;
    if (key) { var n = S2.$(key, el); if (n) n.focus({ preventScroll: true }); }
  }
  function focusKey(a) {
    var k = ["data-act", "data-pid", "data-v", "data-k", "data-side", "id"].filter(function (x) { return a.hasAttribute(x); });
    return k.length ? a.tagName.toLowerCase() + k.map(function (x) { return x === "id" ? "#" + CSS.escape(a.id) : "[" + x + '="' + CSS.escape(a.getAttribute(x)) + '"]'; }).join("") : null;
  }
  /* the ticks change in place; everything that reads the picks repaints */
  function refresh(opts) {
    opts = opts || {};
    syncUrl();
    var ev = evNow();
    ["me", "them"].forEach(function (s) {
      S2.$$('.tp-tick[data-side="' + s + '"]').forEach(function (b) {
        var pk = picks(s).indexOf(b.dataset.pid) >= 0, p = M.player(b.dataset.pid);
        b.setAttribute("aria-pressed", pk); b.closest(".tp-row").classList.toggle("is-picked", pk);
        if (p && !p.seat) b.setAttribute("aria-label", pk ? "Take " + p.tag + " off the trade" : "Add " + p.tag + " to the trade");
      });
      paint("pn-" + s, pickCount(s)); syncList(s); paint("mv-" + s, String(sumVal(s)));
    });
    patchBar(S2.$('[data-w="mmid"]'), midInner(ev));
    patchBar(S2.$('[data-w="tray"]'), trayInner(ev));
    var tray = S2.$('[data-w="tray"]'); if (tray) S2.$$("a, button", tray).forEach(function (x) { x.tabIndex = tray.classList.contains("on") ? 0 : -1; });
    var rd = S2.$('[data-w="read"]'), had = !!(rd && S2.$("[data-tr]", rd));
    paint("read", readHtml(ev));
    /* the reading's entrance plays once, when it first opens; after that a pick redraws it still (a pick comes tens of
       times a session; BRIEF: no motion on what is done that often) */
    if (rd && S2.$("[data-tr]", rd)) { if (!had && !ST.read) { S2.trade.hydrate(rd); ST.read = true; } else S2.charts.ink(rd); }
    paint("luh", esc(luHead())); paint("lus", lusInner(ev));
    if (opts.clubs) paint("clubs", clubsHtml());
    paintSend(ev);
  }
  function sendKey() { return ST.mode === "offer" ? "offer:" + ST.offer : "build"; }
  /* the send in place: in a build only its head and its buttons, so the note keeps its text, caret and focus; a switch
     between an offer and a build (Counter) draws it whole */
  function paintSend(ev) {
    var sec = S2.$('[data-w="send"]'); if (!sec) return;
    if (ST.mode === "offer" || sec.dataset.k !== sendKey() || !S2.$('[data-w="sendh"]', sec)) { paint("send", sendHtml(ev)); sec.dataset.k = sendKey(); return; }
    paint("sendh", sendHead(ev)); paint("senda", sendActs(ev));
    var lb = S2.$('label[for="tpNote"]', sec); if (lb) lb.textContent = noteLabel();
  }
  function repaintAll() {
    var rail = S2.$('[data-w="rail"]'); if (rail) { rail.hidden = locked(); paint("rail", locked() ? "" : railHtml()); }
    paint("panel-me", panelHtml("me")); paint("panel-them", panelHtml("them"));
    paint("pickh", pickHead()); paint("crumbs", crumbs()); paint("mk", mKicker(ST.offer && offerOf(ST.offer)));
    var host = S2.$(".tp"); if (host) { host.dataset.mode = ST.mode; wireSegs(host); }
    var seg = S2.$('[data-seg="pane"]'), b = seg ? S2.$$("button", seg) : []; if (b[1]) b[1].textContent = ST.partner ? city(ST.partner) + " sends" : "Their roster";
    var m = S2.$('[data-w="match"]'); if (m) m.innerHTML = matchHtml();
    paint("title", esc(titleText())); paint("lede", esc(ledeText()));
    if (host) S2.setTitle(docTitle());
    refresh({ clubs: true });
  }

  /* ---------- actions ---------- */
  /* a refusal stays under its button in the league's own words (ST.err survives any repaint) until the next change */
  function setErr(t) { ST.err = t || ""; S2.$$("#tpSend .tp-err").forEach(function (e) { e.textContent = ST.err; }); }
  function togglePick(s, pid) {
    var p = M.player(pid); if (!p) return;
    if (locked()) return S2.toast("This is the offer as it was sent. Counter it to change the players.", "err");
    if (ST.busy) return S2.toast("The offer is on its way to the league. Wait for its answer.", "err");
    if (p.seat) return S2.toast(p.tag + " holds the " + team(p.club).city + " " + p.seat + " seat, so they can't be traded (Rule 2.6).", "err");
    var a = picks(s), i = a.indexOf(pid);
    if (i >= 0) a.splice(i, 1); else a.push(pid);
    ST.err = "";
    refresh();
  }
  function setPartner(code) {
    if (locked() || code === ST.partner || ST.busy) return;
    ST.partner = code; ST.get = []; ST.sort.them = null; ST.unit.them = "all"; ST.err = "";
    if (ST.counter && !isCounter()) ST.counter = null;   /* a counter to another club goes as a new offer */
    repaintAll();
  }
  function propose() {
    if (ST.busy) return;
    if (!ST.partner || !ST.send.length || !ST.get.length) return setErr(!ST.partner ? "Pick a trade partner first." : "Pick at least one player on each side.");
    var ev = evNow(), hard = ev.check && ev.check.problems.filter(function (x) { return x.hard; });
    if (hard && hard.length) return setErr(hard.map(function (x) { return x.text; }).join(" "));
    proposeLive(isCounter(), ((S2.$("#tpNote") || {}).value || "").trim());
  }
  /* the league's door (S2.trade.door.propose). Nothing is said as sent until the database has the offer, or the
     Owner's queue has the move; a refusal keeps the picks and the note and says why in the database's words */
  function proposeLive(ctr, note) {
    var to = team(ST.partner), cid = ctr ? ST.counter : null;
    ST.busy = true; ST.err = ""; paintSend(evNow());
    S2.trade.door.propose({ from: ST.club, to: ST.partner, send: ST.send.slice(), get: ST.get.slice(), note: note, counter: ctr ? ST.counter : null }).then(function (res) {
      ST.busy = false; ST.send = []; ST.get = []; ST.note = ""; ST.counter = null; ST.err = "";
      /* QA nits 26 (2026-11-25): the countered offer's read is stale now (the counter closes it), so reopening it within
         the ten seconds a read is trusted must read it again, not offer Accept on a closed offer */
      if (cid) delete LV[cid];
      /* the reader may have moved on while the league answered: then the toast says it, and the page they went to stays */
      var here = !!S2.$(".tp");
      if (res.queued) {
        S2.toast("Sent to the Owner for approval. The offer goes to the " + to.full + " once the Owner approves it" + (ctr ? ", and their offer closes then." : "."), "ok");
        return here && S2.go("#/hq?tab=trades");
      }
      /* QA nits 25 (2026-11-25): an original that had already closed (S2_NO_ROWS: answered or withdrawn meanwhile) needs
         nothing more; only a real refusal leaves it open */
      if (res.counterOpen) S2.toast(res.counterOpen.code === "S2_NO_ROWS" ? "The counter is sent. Their first offer had already closed, so nothing more is needed." :
        "The counter is sent, but their first offer is still open: " + S2.trade.why(res.counterOpen) + " Decline it from Trades.", res.counterOpen.code === "S2_NO_ROWS" ? "ok" : "err");
      S2.toast((ctr ? "Counter sent to the " : "Trade proposed to the ") + to.full + ". They can accept, counter or decline.", "ok");
      if (here) S2.go(res.id ? S2.tradePage.offer(res.id) : "#/hq?tab=trades");
    }, function (e) {
      ST.busy = false; paintSend(evNow()); setErr((e && e.message) || "The league did not answer. Nothing was sent.");
      /* QA nits 13 (2026-11-25): a reader who left the page while the league answered is told in a toast */
      if (!S2.$(".tp")) S2.toast((e && e.message) || "The league did not answer. Nothing was sent.", "err");
    });
  }
  /* a deliberate answer gets one plain question first, as Team HQ's own answer sheets ask: the kit's one confirm sheet
     (S2.confirm), which opens on the safe button, as Apple's alerts do (audit 2026-11-09), held open while the league answers. o.run(sheet) returns the write's promise, or null when it
     refused before sending (and said why); a refusal stays in the sheet in the database's words with what was typed */
  function ask(o) {
    /* QA nits 13 (2026-11-25): the sheet can be closed (Not now, X, Escape) while the league answers; a refusal then has no
       sheet to stand in, so it is said in a toast. gone: closed by its buttons at once, or by anything once it is removed */
    var gone = false;
    var cf = S2.confirm({ title: o.title, why: o.why, ok: o.ok, cancel: "Not now", danger: o.danger, html: (o.html || "") + '<p class="tp-err tp-cf-err" role="alert"></p>',
      onClose: function () { gone = true; },
      onOk: function (sh) {
        var btn = S2.$('[data-cf="ok"]', sh.el), err = S2.$(".tp-cf-err", sh.el);
        if (ST.busy) return false;
        err.textContent = "";
        var w = o.run(sh, err); if (!w) return false;
        ST.busy = true; btn.disabled = true; btn.setAttribute("aria-busy", "true");
        w.then(function (res) { ST.busy = false; sh.close(); o.done(res); },
          function (e) { ST.busy = false; btn.disabled = false; btn.removeAttribute("aria-busy");
            if (gone || !sh.el.isConnected) S2.toast(S2.trade.why(e), "err"); else err.textContent = S2.trade.why(e); });
        return false;
      } });
    cf.el.addEventListener("click", function (e) { if (e.target.closest('[data-cf="no"], [data-close]')) gone = true; });
  }
  function answer(k) {
    var o = offerOf(ST.offer); if (!o) return;
    if (ST.busy) return;
    var them = team(ST.partner).full;
    if (k === "counter") {   /* the offer becomes a build in place: its players stay ticked, now yours to change */
      var pend = o.status === "pending" && side(o, ST.club) === "in";
      ST.mode = "build"; ST.offer = null; ST.counter = pend ? o.id : null; ST.read = true; ST.err = "";
      if (!pend) S2.toast("Your first offer stays open until you withdraw it from Trades.");
      return repaintAll();
    }
    return answerLive(k, o, them);
  }
  /* each door's result is read back from the league (the offer again, by its id) and the page repaints in
     place to what the database now holds. A move the Owner must approve is said as sent to the Owner, not as made */
  function answerLive(k, o, them) {
    var T = S2.trade.door, owner = function (what) { return "Sent to the Owner for approval: " + what + ". Nothing changes until the Owner approves it."; };
    var after = function (msg) { return function (res) { S2.toast(res && res.queued ? owner(msg[1]) : msg[0], "ok"); ensure(o.id, true); }; };
    if (k === "accept") return ask({ title: "Accept this trade?", ok: "Accept the trade",
      why: ["The players change hands at once and the trade is posted to the league's transaction log, the only part of a trade that is public. The Season 2 roster and cap checks run again now, and the league refuses the trade if a club would end over the cap or under a minimum (Rules 2.3 and S2.4)."],
      run: function () { return T.accept(o.id); }, done: after(["Trade completed. Both rosters are updated, and the trade is on the transaction log.", "accepting the offer from the " + them]) });
    if (k === "decline" || k === "withdraw") {
      var dec = k === "decline";
      return ask({ title: dec ? "Decline this offer?" : "Withdraw your offer?", ok: dec ? "Decline the offer" : "Withdraw the offer", danger: true,
        why: [dec ? "The " + them + " are told it was declined. Nothing moves, and only the two clubs and the league office ever see the offer (Rule 2.3)." : "The " + them + " can no longer accept it. Nothing moves."],
        run: function () { return dec ? T.decline(o.id) : T.cancel(o.id); },
        done: after([dec ? "Offer declined. Only the two clubs and the league office see it (Rule 2.3)." : "Offer withdrawn. Nothing moved.", (dec ? "declining the offer from the " : "withdrawing the offer to the ") + them]) });
    }
    /* gaps (2026-11-25): the league office's two doors are the site's one reversal and one resend door (js/flows.js
       S2.reverseTrade, S2.resendTrade), which Team HQ and the Staff Desk use too; the page reads the offer back after */
    if (k === "reverse") return S2.reverseTrade(o.id, { text: "The trade between the " + team(o.from).full + " and the " + team(o.to).full + ".", done: function () { ensure(o.id, true); } });
    if (k === "resend") return S2.resendTrade(o.id, { text: "The " + team(o.from).full + " offer to the " + team(o.to).full + ".", to: team(o.to).full,
      done: function (res) { if (res && res.data && S2.$(".tp")) S2.go(S2.tradePage.offer(res.data)); else ensure(o.id, true); } });
  }
  /* the trade block from the trade page (Rule 2.3: a listing is the one public part of a trade before it is made) */
  function blockable(p) { return !!p && p.club === ST.club && !p.seat && ST.mode === "build" && ST.acting && !arch(); }
  function setBlock(pid, on) {
    var p = M.player(pid); if (!blockable(p) || ST.busy) return;
    var said = function (queued) { return queued ? "Sent to the Owner for approval: " + (on ? "put " : "take ") + p.tag + (on ? " on" : " off") + " the trade block."
      : on ? p.tag + " is on the trade block. Every front office sees the listing." : p.tag + " is off the trade block."; };
    ST.busy = true; paintMore(pid);
    S2.trade.door.block(pid, on).then(function (res) { ST.busy = false; S2.toast(said(res && res.queued), "ok"); repaintAll(); },
      function (e) { ST.busy = false; paintMore(pid); S2.toast(e && e.code === "S2_NO_ROWS" ? "No roster row was changed: the league's rules did not let this through. Nothing was saved." : (e && e.message) || "The league did not answer. Nothing was saved.", "err"); });
  }
  function paintMore(pid) { var row = S2.$("#tpMore-" + CSS.escape(pid)); if (row && !row.hidden) row.firstElementChild.innerHTML = moreHtml(M.player(pid)); }

  /* ---------- the offer the address names, read from the league ---------- */
  /* the offer to answer (?offer=) or to counter (?counter=), read before the page draws it */
  function wantId() { var q = S2.parse().q; return q.offer || q.counter || null; }
  function waiting() {
    var id = wantId(), e = id && LV[id]; if (!id) return "";
    if (!e || !e.at) return '<div class="tp-wait" data-tpwait="' + esc(id) + '">' + headless("Reading the offer", "One moment: the offer is read from the league as your account may see it.") + "</div>";
    if (e.err) return '<div class="tp-wait" data-tpwait="' + esc(id) + '">' + headless("The offer could not be read", e.err + " Nothing was changed.") +
      '<p class="tp-back"><button type="button" class="btn secondary" data-act="reread" data-v="' + esc(id) + '">Try again</button></p></div>';
    return "";
  }
  /* one read per offer at a time; an offer read in the last ten seconds is drawn as read (force: read it again now, after
     a write). When the read lands the page draws it in place: the waiting state is replaced, or, when the offer changed
     under the page (answered in another tab or by the other club), every widget repaints */
  function ensure(id, force) {
    var e = LV[id] || (LV[id] = { o: null, err: null, at: 0, busy: null });
    if (e.busy) return e.busy;
    if (!force && e.at && !e.err && Date.now() - e.at < 10000) return Promise.resolve();
    var was = e.at ? JSON.stringify(e.o) : null;
    e.busy = S2.trade.read(id).then(function (o) { e.o = o; e.err = null; }, function (x) { console.error("[tradebuild] reading the offer failed", x); e.err = (x && x.message) || String(x); })
      .then(function () { e.at = Date.now(); e.busy = null; landed(id, was !== JSON.stringify(e.o)); });
    return e.busy;
  }
  function landed(id, changed) {
    if (wantId() !== id) return;   /* the reader moved on */
    var host = S2.$('[data-tpwait="' + CSS.escape(id) + '"]'), page = S2.$("#page");
    if (host) {
      init(S2.parse()); host.outerHTML = pageHtml();
      /* what the router does for a page it draws: the entrance (a .reveal section is hidden until it runs) and the charts */
      S2.reveal(page); if (S2.charts) S2.charts.hydrate(page);
      if (S2.$(".tp", page)) S2.setTitle(docTitle());
      if (S2.$(".tp", page)) { syncUrl(); after(page); } else wireWait(page);
      return;
    }
    if (changed && S2.$(".tp")) { init(S2.parse()); repaintAll(); }
  }

  /* ---------- wiring ---------- */
  function wireSegs(root) {
    S2.$$(".seg[data-seg]", root).forEach(function (seg) {
      if (seg.dataset.wired) return; seg.dataset.wired = "1";
      S2.segmented(seg, function (v) {
        var k = seg.dataset.seg;
        if (k === "pane") { ST.pane = v; var pk = S2.$(".tp-pick"); if (pk) pk.dataset.pane = v; return; }
        if (k === "lu") { ST.lu = v === "now" ? "before" : "after"; return paint("lus", lusInner(evNow())); }
        ST.unit[k] = v; paint("tbl-" + k, tablesHtml(k));
      });
    });
  }
  var trayIO = null;
  /* events go on the page's own element, which each route render replaces, so a return visit never stacks handlers */
  function after(root) {
    var host = S2.$(".tp", root); if (!host) return;
    wireSegs(host);
    ST.read = !!S2.$('[data-w="read"] [data-tr]', host);
    host.addEventListener("click", function (e) {
      /* the whole roster row toggles its pick, so a phone has a row-sized target, not a 28px circle (audit 2026-11-09);
         a link or a sort button in the row keeps its own job */
      var row = !e.target.closest("a, button, input") && e.target.closest(".tp-row"), rt = row && S2.$(".tp-tick", row);
      if (rt && rt.getAttribute("aria-disabled") !== "true") return togglePick(rt.dataset.side, rt.dataset.pid);
      var b = e.target.closest("[data-act]"); if (!b) return;
      var k = b.dataset.act;
      if (k === "pick") return togglePick(b.dataset.side, b.dataset.pid);
      if (k === "drop") {   /* the chip leaves; the focus goes to the same player's tick in the roster, so a keyboard keeps its place */
        var s = ST.send.indexOf(b.dataset.pid) >= 0 ? "me" : "them"; togglePick(s, b.dataset.pid);
        var t = S2.$('.tp-tick[data-pid="' + CSS.escape(b.dataset.pid) + '"]'); if (t) t.focus({ preventScroll: true }); return;
      }
      if (k === "partner") return setPartner(b.dataset.v);
      if (k === "more") {
        var pid = b.dataset.pid, row = S2.$("#tpMore-" + CSS.escape(pid)); if (!row) return;
        ST.open[pid] = !ST.open[pid]; b.setAttribute("aria-expanded", ST.open[pid]);
        if (ST.open[pid]) { row.firstElementChild.innerHTML = moreHtml(M.player(pid)); row.hidden = false; S2.charts.ink(row); } else row.hidden = true;
        return;
      }
      if (k === "sort") {
        var sd = b.dataset.side, key = b.dataset.k, cur = ST.sort[sd];
        ST.sort[sd] = !key ? null : cur && cur.k === key ? { k: key, dir: cur.dir === "desc" ? "asc" : "desc" } : { k: key, dir: "desc" };
        return paint("tbl-" + sd, tablesHtml(sd));
      }
      if (k === "jump") { e.preventDefault(); var to = S2.$(b.getAttribute("href")); if (to) to.scrollIntoView({ behavior: S2.reduce.matches ? "auto" : "smooth", block: "start" }); return; }
      if (k === "propose") return propose();
      if (k === "block") return setBlock(b.dataset.pid, b.dataset.v === "on");
      if (k === "clear") {
        if (b.getAttribute("aria-disabled") === "true") return;
        ST.send = []; ST.get = []; refresh();
        var c = S2.$('[data-act="clear"]', host); if (c) c.focus({ preventScroll: true }); return;   /* the repaint replaced the button */
      }
      return answer(k);
    });
    host.addEventListener("input", function (e) { if (e.target.id === "tpNote") ST.note = e.target.value; });
    /* the tray follows the band: shown once the match center has gone up under the header, gone when it is back. The root
       reaches far below the screen, so the one way out of it is up past the header: a jump that skips the band (a
       reload that restores the scroll, "See why") still crosses it, where a plain viewport root saw no change and left
       the tray off (found 2026-11-03 by tradepage.test.cjs) */
    if (trayIO) trayIO.disconnect();
    var band = S2.$(".tp-match", host), tray = S2.$(".tp-tray", host);
    if (band && tray && "IntersectionObserver" in window) {
      var navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--nav-h"), 10) || 60;
      trayIO = new IntersectionObserver(function (en) {
        var up = !en[en.length - 1].isIntersecting;
        tray.classList.toggle("on", up); tray.setAttribute("aria-hidden", String(!up));
        S2.$$("a, button", tray).forEach(function (x) { x.tabIndex = up ? 0 : -1; });
      }, { rootMargin: "-" + navH + "px 0px 100000px 0px" });
      trayIO.observe(band);
    }
  }
  /* the "Try again" on an offer that could not be read (the waiting state sits outside .tp) */
  function wireWait(root) {
    var w = S2.$(".tp-wait", root); if (!w || w.dataset.wired) return; w.dataset.wired = "1";
    w.addEventListener("click", function (e) {
      var b = e.target.closest('[data-act="reread"]'); if (!b) return;
      var id = b.dataset.v; delete LV[id]; w.outerHTML = waiting(); wireWait(S2.$("#page")); ensure(id, true);
    });
  }
  /* the rosters moved (the pulse: a trade accepted in another view, a waiver): picks that left their club come off,
     and every widget reads the new rosters in place, never the note being typed (paintSend) */
  function moved(rosters) {
    if (!S2.$(".tp")) return;
    if (ST.mode === "build" && rosters) {
      var gone = [];
      ST.send = ST.send.filter(function (x) { return keep(x, ST.club, gone); });
      ST.get = ST.get.filter(function (x) { return keep(x, ST.partner, gone); });
      if (gone.length) S2.toast(gone.join(" "), "err");
    }
    repaintAll();
  }
  /* the domains the page reads (rosters and the block, scores and standings, lines, clubs, names) repaint it in place */
  ["rosters", "scores", "stats", "league", "people"].forEach(function (d) { S2.live.on(d, function () { moved(d === "rosters"); }); });
  if (S2.market && S2.market.on) S2.market.on(function (ev) { if (ev.type === "load") moved(false); });
  /* a version reload waits while a note is typed or a write is on its way; the picks themselves live in the address */
  if (S2.holds) S2.holds.push(function () { return !!S2.$(".tp") && (ST.busy || (ST.mode === "build" && !!ST.note)); });

  S2.page("trade", {
    title: function (r) { if (!canSee(r)) return "Team HQ"; init(r); return (wantId() && !(LV[wantId()] || {}).at ? (r.q.offer ? "Offer" : "Counter") : titleText()) + " · Team HQ"; },
    tab: "hq",
    /* a workspace page on the gray app canvas; anyone without a front-office seat (or, for an offer, a staff seat) meets
       Team HQ's lock (S2.pages.locked) */
    get mode() { return canSee(S2.parse()) ? "app" : "site"; },
    repaintsItself: true,
    render: function (r) {
      if (!canSee(r) && S2.pages.locked) return S2.pages.locked.render({ name: "hq", q: {} });
      ST.err = ""; ST.busy = false;
      try {
        if (!M) throw new Error("S2.M is missing");
        var id = wantId(); if (id) ensure(id);   /* read (or read again) the offer the address names */
        /* the cards read S2.market.clubState and the minimums M.draftDone, both the market's once it is read: the page asks
           for it (js/market.js ensure; QA round 2, 2026-11-25: reached straight from an address it never did, so the cap
           room was the model's and left out the bids a club leads), and its answer repaints the page in place (below) */
        if (S2.market && S2.market.ensure) S2.market.ensure();
        return pageHtml();
      } catch (e) { console.error("[tradebuild] the trade page failed to render", e); return headless("This page could not be drawn", "Something in the data was not what the page expected. The details are in the console."); }
    },
    after: function (root, r) {
      if (!canSee(r)) { if (S2.pages.locked && S2.pages.locked.after) S2.pages.locked.after(root, r); return; }
      try { if (S2.$(".tp", root)) { syncUrl(); after(root); } else wireWait(root); } catch (e) { console.error("[tradebuild] the trade page failed to wire up", e); }
    }
  });
})();
