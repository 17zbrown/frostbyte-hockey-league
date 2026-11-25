/* #/desk?tab=games (the Games pane: what waits on the statistics desk) and #/desk/game/<id> (the Game desk, one home per
   fixture). Moved out of js/pages/desk.js by the e0 split (2026-11-24); desk.js keeps the page (routing, paint, the click
   and key dispatchers) and reaches the functions here through S2._gamedesk.
   S2 swap, stream g2 (2026-11-24): the classic Stats manager (src/live/part_live.js, CG._smS to CG._smFixGo: v4.36,
   v4.37 and v4.50) runs on this page, on the same doors. Season 2's first game night is Wednesday, December 16, and on it
   statistics staff do here everything the classic desk does:
   - a game's sittings: the staff read the classic desk uses (ingest-stats leagueSessions: the league archive first, then
     EA through the bot server), grouped under the game each belongs to, ticked, and merged into one game (leagueMerge:
     previewed, then confirmed with exactly what it will do and post, then ONE merge call);
   - a held game filed from its sittings, a decided score published at any clock (Rule 4.3.3, v4.50; a level score stays
     held, Rule 4.1), and a restarted game re-filed (Rules 4.3 and 4.5: what is left unticked is struck for good);
   - an outside EA club (Rule 4.6, v4.37): found on EA (pickup-import search, through the bot server), matched to the league
     game a club played under it (set_game_club_substitution), removed while the game is open
     (clear_game_club_substitution);
   - the forfeit (forfeit_game), its reversal (unforfeit_game, a commissioner's alone since v3.52) or, for staff, a report
     to every commissioner (report_ruling_mistake);
   - the result correction with the overtime mark (stats_game_set_result, read back before the desk says it worked, v3.42);
   - a box-score line (stats_game_row): how a goal is voided on the commissioner's order (memory: removing goals);
   - the import exceptions (ea_import_issues, ea_dismiss_import) and the EA search status line (ea_lookup_health).
   Every database write goes through S2.write (contracts/client-api.md); leagueMerge and the EA lookups are Netlify
   functions and go through S2.ea.post, the port of CG.eaPost. Nothing shows as done until the league confirms it: a
   refusal keeps the staffer's input and says why in place, and the scoreboard, the result and the box score are drawn from
   the league's data (S2.M, read again after each write), never from what was typed.
   The classic helpers that decide (which sittings are one game, what the action bar will do, which forfeit a game allows,
   what a correction posts) are ported with their classic names beside them, and tools/gamedesk-port-g2.test.cjs runs the
   classic copy and this one on the same inputs. Clubs never file box scores (RULING v4.49): this page is staff only, and
   the database and ingest-stats refuse everyone else. */
(function () {
  "use strict";
  var S2 = window.S2;
  var DESK = S2._desk;
  var $ = DESK.$, $$ = DESK.$$, M = DESK.M, MAC = DESK.MAC, TICKS = DESK.TICKS, clock = DESK.clock, comName = DESK.comName,
    confirmSheet = DESK.confirmSheet, cur = DESK.cur, esc = DESK.esc, fadeBox = DESK.fadeBox, ghostOut = DESK.ghostOut, gs = DESK.gs,
    ic = DESK.ic, landOn = DESK.landOn, manager = DESK.manager, me = DESK.me, mgrBadge = DESK.mgrBadge, nextNight = DESK.nextNight,
    plural = DESK.plural, secHead = DESK.secHead, st = DESK.st, stateBox = DESK.stateBox, sum = DESK.sum,
    tag = DESK.tag, teamName = DESK.teamName;
  var DAY = 86400000;

  /* =========================================================================================================== */
  /* DOORS: the league's read client, and the Netlify functions through the bot server's EA relay                 */
  /* =========================================================================================================== */
  /* a staff read: S2.rd (js/live.js), the one read door (QA round 2, A10). Anything without a read client has no
     connection and says so, so an empty list here always means the league answered empty, never that nothing was asked */
  function rd(q) { return S2.rd(q); }
  /* v4.34 (2026-10-29): the site's EA lookups go through the bot's server, the only host EA serves (Akamai refuses Netlify
     and Supabase; CORS refuses a browser). Commissioner: "Also this box in the staff desk never works. Can you make sure you
     check regularly that it works and functions so I can use it so I dont need to ask you each time?" An action with no
     stored answer files a request and replies { eaPending: id }; this waits on ea_lookup_state(id) about once a second (25 s
     at most), then posts the same action again with eaLookup: id, which reads the bot's answer. Every Season 2 action that
     can reach EA comes through here, so no box can forget the wait. eaLookup rides on the action's own object: the payload
     for pickup-import ({ action }), its one sub-object for ingest-stats ({ leagueSessions: {...} }).
     Port of CG.eaPost (part_live.js), the ONE definition on the new site: S2.ea. desk.js's S2.eaSearch and S2.eaStatusLine
     (the Control Center's club sheet) call it. shortcut: it lives in this file until js/live.js (stream f) takes it. */
  var EA = S2.ea = S2.ea || {};
  EA.WAIT_MS = 25000;
  EA.post = function (url, payload) {
    function post(p) {
      var tok = S2.session && S2.session.accessToken;
      if (!tok) return Promise.reject(new Error("Sign in again: no session token"));
      return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify(p) }).then(function (r) {
        /* v4.36: a crashed function answers non-2xx with no "error" key, which must never read as success */
        return r.json().then(function (o) { return r.ok === false && !(o && o.error) ? { error: "The server failed (HTTP " + r.status + "). Nothing is confirmed: check before trying again." } : o; },
          function () { throw new Error(r.ok === false ? "The server failed (HTTP " + r.status + "). Check before trying again." : "The server’s answer was unreadable."); });
      });
    }
    function withLookup(id) {
      var p = JSON.parse(JSON.stringify(payload)), k = p.action ? null : Object.keys(p)[0];
      if (k && p[k] && typeof p[k] === "object") p[k].eaLookup = id; else p.eaLookup = id;
      return p;
    }
    function wait(id, t0) {
      return rd(function (c) { return c.rpc("ea_lookup_state", { p_id: id }); }).then(function (d) {
        if (!d) throw new Error("That EA lookup is gone. Search again.");
        if (d.pending === false) return id;
        if (Date.now() - t0 > EA.WAIT_MS) throw new Error("The bot server did not answer within 25 seconds. Try again in a minute; the EA status line on this box says whether it is up.");
        return new Promise(function (res) { setTimeout(res, 1000); }).then(function () { return wait(id, t0); });
      }, function (e) { throw new Error("Could not check on the EA lookup: " + e.message); });
    }
    var waited = false;
    function round(p, n) {
      return post(p).then(function (o) {
        if (!o || !o.eaPending) return o;
        if (n >= 2) throw new Error("The EA lookup did not settle. Try again in a minute.");
        waited = true;
        return wait(o.eaPending, Date.now()).then(function (id) { return round(withLookup(id), n + 1); });
      });
    }
    /* a lookup that went to the bot also refreshes the status lines, so a failure shows where it happened */
    return round(payload, 0).then(function (o) { if (waited) EA.paintStatus(); return o; }, function (e) { if (waited) EA.paintStatus(); throw e; });
  };
  /* v4.34: the status line under each EA box, from the bot's own self-test every 10 minutes. ea_lookup_health reads the
     same ledgers the Automations panel and the watchdog read, so the box, the panel and the alert cannot disagree. Painted
     in place (never a re-render). Port of CG.eaStatusLine and CG.paintEaStatus */
  EA.statusLine = function () {
    return '<p class="ea-status" data-ea-status><span class="ea-dot" aria-hidden="true" style="background:var(--muted)"></span><span>Checking EA search…</span></p>';
  };
  EA.paintStatus = function (root) {
    if (!$$("[data-ea-status]", root || document).length) return Promise.resolve();
    /* the lines are found when the answer lands, not before: a repaint in between replaces them (and carries the last reading over) */
    var paint = function (color, text) { $$("[data-ea-status]", root && root.isConnected ? root : document).forEach(function (el) { el.firstChild.style.background = color; el.lastChild.textContent = text; }); };
    return rd(function (c) { return c.rpc("ea_lookup_health"); }).then(function (h) {
      if (!h) paint("var(--muted)", "EA search status is unavailable.");
      /* v4.35: one failed self-test leaves the ledger ok (a second in a row turns it red and alerts), with lastError set;
         the Automations panel shows that as amber "Check", so the box does too instead of a green "working" */
      else if (h.state === "working" && h.error) paint("var(--warn)", "The bot server's last EA test failed: " + h.error + " One more failure in a row turns this red and alerts the commissioners.");
      else if (h.state === "working") paint("var(--win)", "EA search is working. The bot server tested it " + M.ago(Math.round((Date.now() - Date.parse(h.at)) / 60000)) +
        (h.latencyMs != null ? " (answered in " + (Math.round(h.latencyMs / 100) / 10) + " s)" : "") + ".");
      else if (h.state === "failing") paint("var(--loss)", "EA search is not working right now: " + (h.error || "the bot server's last two tests failed.") + " The commissioners are alerted automatically.");
      else paint("var(--warn)", "EA search has not been tested in over 30 minutes, so the bot server may be down. The commissioners are alerted automatically.");
    }, function (e) { paint("var(--muted)", "EA search status is unavailable (" + e.message + ")."); });
  };
  /* -- league lag-out merge and sittings API (the ingest function, staff JWT); EA club search (pickup-import) -- */
  function leagueApi(payload) { return EA.post("/api/ingest-stats", payload); }
  function searchApi(payload) { return EA.post("/api/pickup-import", payload); }

  /* the league clubs' EA ids and row ids, read for each fixture opened (the league body never carries ea_club_id) */
  var TEAMS = { byCode: {}, byEa: {}, byId: {}, at: 0, err: null };
  function loadTeams() {
    return rd(function (c) { return c.from("teams").select("id,code,ea_club_id"); }).then(function (rows) {
      var o = { byCode: {}, byEa: {}, byId: {}, at: Date.now(), err: null };
      (rows || []).forEach(function (t) { var x = { id: t.id, code: t.code, ea: t.ea_club_id == null ? null : String(t.ea_club_id) }; o.byCode[t.code] = x; o.byId[t.id] = x; if (x.ea) o.byEa[x.ea] = x; });
      TEAMS = o; return o;
    }, function (e) { TEAMS.err = e.message; throw e; });
  }

  /* =========================================================================================================== */
  /* THE CLASSIC HELPERS, ported (no DOM)                                                                         */
  /* =========================================================================================================== */
  function now() { return Date.now(); }
  function etDay(ts) { return M.etDay(new Date(ts)); }                                       /* CG._smEtDay */
  function commish() { return S2.session && S2.session.user ? !!S2.session.isCommissioner : !!me().commish; }   /* CG._smCommish; display only, the database decides */
  function fx(g) { return g.away + " at " + g.home; }                                         /* CG._smFx, in the site's words */
  /* every score on the desk reads away first, the way every scoreboard on the site does: "DAL 2, PIT 3" */
  function scoreText(away, home, a, h) { return away + " " + a + ", " + home + " " + h; }      /* CG._smScoreText */
  /* leagueMerge and forfeit_game answer "H-A", home first */
  function HA(s) { var m = /^(\d+)-(\d+)$/.exec(String(s || "")); return m ? { h: +m[1], a: +m[2] } : null; }   /* CG._smHA */
  /* a game the classic desk's way (a CG.lg.schedule row), from the league model: one adapter, so the ported helpers read
     the same fields. held: a sitting on file and no result (the importer stamps ea_match_id, v3.18; js/model.js maps it as
     eaMatchId) */
  function eaMatchOf(g) { return g.eaMatchId || null; }
  function sched(g) {
    if (!g) return null;
    return { id: g.id, home: g.home, away: g.away, at: Date.parse(g.at) || 0, status: g.status || (g.isFinal ? "final" : "scheduled"),
      forfeit: g.forfeit || null, voided: !!g.voided, eaMatchId: eaMatchOf(g), homeScore: g.hs == null ? null : g.hs, awayScore: g.as == null ? null : g.as,
      ot: !!g.ot, week: g.week, stage: g.stage || "regular", makeup: !!g.makeup, lines: +g.lines || (g.hasBox ? 1 : 0), kept: !!g.kept };
  }
  function game(id) { if (!id) return null; for (var i = 0; i < M.games.length; i++) if (M.games[i].id === id) return sched(M.games[i]); return null; }   /* CG._smGame */
  function stageText(g) { return (g.stage === "playoff" ? "Playoffs" : g.stage === "preseason" ? "Pre-season" : "Week " + g.week) + (g.makeup ? " · Make-up" : ""); }   /* CG._smStage */
  /* the two forfeit kinds a game allows. forfeit_game refuses a no-show on a game that was played, and a kept result on a
     game with nothing filed; the desk says so before the click instead of after it. (CG._smKinds) */
  function kinds(g) {
    var lines = g.lines;
    var noshow = (g.eaMatchId || lines > 0)
      ? { ok: false, why: "Not possible: this game has a box score, so it was played. Use the option below." } : { ok: true, why: null };
    var dc3 = (g.status !== "final" && !g.eaMatchId)
      ? { ok: false, why: "Not possible yet: no sitting of this game is on file. If it was played, file its sittings first." } : { ok: true, why: null };
    return { noshow: noshow, dc3: dc3, pre: noshow.ok && !dc3.ok ? "noshow" : (!noshow.ok && dc3.ok ? "dc3" : null), lines: lines };
  }
  /* what #game-scores will show, so the confirm can say it. v4.50: a kept result on a final posts its own Forfeit line
     (forfeit_game), closing backend gap G1: a decided hand filing is now a plain final before its Rule 4.3.7 ruling (CG._smFfPosts) */
  function ffPosts(g, kind) {
    if (kind === "noshow") return g.status === "final" ? "The score changes, so a Corrected line posts in #game-scores." : "Final (forfeit) posts in #game-scores.";
    if (g.status !== "final" && g.eaMatchId) return "Final (forfeit) posts in #game-scores, with the score its box score adds up to.";
    return "A Forfeit line posts in #game-scores with the score unchanged. Neither club is notified in its room.";
  }
  function ffWill(g, kind, code) {   /* CG._smFfWill */
    if (!kind || !code) return "";
    var other = code === g.home ? g.away : g.home;
    if (kind === "noshow") return "Will record: " + other + " wins 1-0 by forfeit, with no player stats.";
    if (g.status === "final") return "Will record: " + scoreText(g.away, g.home, g.awayScore, g.homeScore) + " stands with every stat line, and " + code + " takes the forfeit loss.";
    return "Will record: the score its box score adds up to stands with every stat line, and " + code + " takes the forfeit loss.";
  }
  function fixCheck(g, f) {   /* CG._smFixCheck */
    var hs = String(f.h == null ? "" : f.h).trim(), as = String(f.a == null ? "" : f.a).trim();
    if (!/^\d{1,2}$/.test(hs) || !/^\d{1,2}$/.test(as)) return { ok: false, bad: false, msg: "Enter both scores." };
    var h = +hs, a = +as;
    if (h === a) return { ok: false, bad: true, msg: "A league game cannot end level. Check the score." };
    if (f.ot && Math.abs(h - a) !== 1) return { ok: false, bad: true, msg: "An overtime game is decided by one goal. Check the score or the overtime switch." };
    var same = h === g.homeScore && a === g.awayScore, txt = scoreText(g.away, g.home, a, h);
    if (same && !!f.ot === !!g.ot) return { ok: false, bad: false, msg: "Change the score or the overtime switch to correct it." };
    if (!same) return { ok: true, bad: false, msg: "Will read: " + txt + (f.ot ? " in overtime" : "") + ". A Corrected line posts in #game-scores, and the standings update at once." };
    return { ok: true, bad: false, msg: "Will read: " + txt + (f.ot ? " in overtime" : " in regulation") + ". Only the overtime mark changes, so nothing is posted in #game-scores. The standings update at once." };
  }
  /* Rule 7.1: an official does not rule on a game of a club they play for or manage, but "the league's tools do not stop
     an official mechanically", so this only WARNS (CG._smInvolved). The session's club: the seat held, else the roster */
  function involved(g) {
    var mine = S2.session && S2.session.teamCode;
    return mine && (g.away === mine || g.home === mine) ? mine : null;
  }
  /* the newer answer wins per sitting; a sitting only the earlier answer had (EA's, after an archive-only reload) stays (CG._smUnion) */
  function union(prev, next) {
    var old = {}, by = {}, out = [];
    (prev || []).forEach(function (s) { old[s.matchId] = s; });
    (next || []).forEach(function (s) {
      var p = old[s.matchId];
      /* an archive-only reload does not know EA still lists it: keep that, and with it the pickup door (the rule is the
         server's: an EA sitting the archive holds only as ignored, nothing else) */
      if (p && s.source === "archive" && (p.source === "ea" || p.source === "both")) {
        s.source = "both";
        if (s.kind === "not-league" && !s.pickupGameId && !s.struck && s.archive && s.archive.status === "ignored") { s.canPickup = true; s.why = null; }
      }
      by[s.matchId] = 1; out.push(s);
    });
    (prev || []).forEach(function (s) { if (!by[s.matchId]) out.push(s); });
    return out.sort(function (a, b) { return (Date.parse(b.endedAt) || 0) - (Date.parse(a.endedAt) || 0); });
  }
  function withMerge(req, extra) {   /* CG._smWith */
    var m = {}, k;
    for (k in req.leagueMerge) if (Object.prototype.hasOwnProperty.call(req.leagueMerge, k)) m[k] = req.leagueMerge[k];
    for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) m[k] = extra[k];
    return { leagueMerge: m };
  }
  /* a server fixture { gameId, home, away, at, status, held, forfeit } as a schedule row, for a game the model does not hold (CG._smFxGame) */
  function fxGame(x) {
    return game(x.gameId) || { id: x.gameId, home: x.home, away: x.away, at: Date.parse(x.at) || 0, status: x.status,
      forfeit: x.forfeit || null, eaMatchId: x.held ? "held" : null, homeScore: null, awayScore: null, week: null, stage: "regular" };
  }
  /* sittings grouped under the game they belong to: one group is one game, so "one game per merge" needs no words (CG._smGroups) */
  function groups(sessions, f) {
    var by = {}, order = [];
    (sessions || []).forEach(function (s) {
      var key, kind = s.kind, gid = null, ended = Date.parse(s.endedAt) || 0;
      if (kind === "league" && s.fixture) { gid = f.moved[s.matchId] || s.fixture.gameId; key = "g:" + gid; }
      else if (kind === "needs-substitution" && s.fixture) { gid = s.fixture.gameId; key = "s:" + gid; }
      else { kind = "not-league"; key = "p:" + (s.clubs || []).map(function (c) { return c.eaId; }).sort().join("-") + ":" + etDay(ended || now()); }
      var gr = by[key];
      if (!gr) { gr = by[key] = { key: key, kind: kind, gameId: gid, fx: null, sessions: [], latest: 0 }; order.push(gr); }
      if (gid && !gr.fx) gr.fx = [s.fixture].concat(s.alternatives || []).filter(function (x) { return x && x.gameId === gid; })[0] || null;
      gr.sessions.push(s);
      gr.latest = Math.max(gr.latest, ended);
    });
    order.forEach(function (gr) {
      gr.sessions.sort(function (a, b) { return (Date.parse(a.endedAt) || 0) - (Date.parse(b.endedAt) || 0); });
      gr.sessions.forEach(function (s, i) { s._k = i + 1; });
      gr.game = gr.gameId ? (game(gr.gameId) || (gr.fx ? fxGame(gr.fx) : null)) : null;
      gr.focus = !!(gr.gameId && f.focus === gr.gameId);
      gr.locked = !!(gr.kind === "league" && gr.game && gr.game.forfeit && !commish());
      gr.complete = gr.kind === "league" && !!gr.game && (gr.game.status === "final" || !!gr.game.forfeit) &&
        gr.sessions.every(function (s) { return s.onGame || s.struck; });
    });
    return order.sort(function (a, b) { return (b.focus - a.focus) || (b.latest - a.latest); });
  }
  /* what is ticked, and in which groups. The sitting already on a game is part of every merge of that game (the merge
     REPLACES the box score), so it counts as ticked unless the game is being re-filed from a restart. (CG._smSelection) */
  function selection(f, grs0) {
    var byId = {}, ticked = [], grs = [];
    grs0.forEach(function (gr) { gr.sessions.forEach(function (s) { byId[s.matchId] = { s: s, gr: gr }; }); });
    /* v4.37: a tick counts only while its row can still be ticked (the row's own rule): a reload can turn a ticked sitting
       unmergeable (its substitution removed, its game filed by the importer), and the row then shows it unticked */
    var tickable = function (x) { return !x.s.struck && !x.gr.locked && (x.s.onGame || (x.gr.kind === "league" ? x.s.canMerge : x.s.canPickup)); };
    Object.keys(f.picked).forEach(function (id) { if (f.picked[id] && byId[id] && tickable(byId[id])) { ticked.push(id); if (grs.indexOf(byId[id].gr) < 0) grs.push(byId[id].gr); } });
    var one = grs.length === 1 ? grs[0] : null, reFile = false;
    /* a game whose every sitting is already on it but no result is published (held, or put back to scheduled by a forfeit
       undo): it can be filed again from those sittings with nothing ticked */
    if (!ticked.length) {
      var fg = grs0.filter(function (gr) { return gr.focus && gr.kind === "league" && gr.game && gr.game.status !== "final" && !gr.game.forfeit && !gr.locked &&
        gr.sessions.some(function (s) { return s.onGame && !s.struck; }); })[0];
      if (fg) { one = fg; grs = [fg]; reFile = true; }
    }
    var locked = one && one.kind === "league" && !f.restart ? one.sessions.filter(function (s) { return s.onGame && !s.struck; }).map(function (s) { return s.matchId; }) : [];
    var sel = locked.concat(ticked.filter(function (id) { return locked.indexOf(id) < 0; }));
    return { ticked: ticked, groups: grs, one: one, locked: locked, sel: sel, byId: byId, reFile: reFile,
      restartable: !!(one && one.kind === "league" && one.sessions.some(function (s) { return s.onGame && !s.struck; })) };
  }
  /* v4.37 (commissioner, 2026-10-29: "add the ability to seach a non-league club and match it to a team so we can file the
     league games by searching the club they used and entering their league game"): the games a group's outside club could
     have been (the server's subCandidates, one list per group) and the outside clubs still to name (Rule 4.6) (CG._smMatchInfo) */
  function matchInfo(gr) {
    var seen = {}, cands = [], unres = {}, order = [];
    gr.sessions.forEach(function (s) {
      (s.subCandidates || []).forEach(function (c) { if (!seen[c.gameId]) { seen[c.gameId] = 1; cands.push(c); } });
      (s.clubs || []).forEach(function (c) { if (!c.team && !unres[c.eaId]) { unres[c.eaId] = c.name || "EA club " + c.eaId; order.push(c.eaId); } });
    });
    var end = gr.latest || 0;
    cands.sort(function (a, b) { return ((b.inWindow ? 1 : 0) - (a.inWindow ? 1 : 0)) || (Math.abs((Date.parse(a.at) || 0) - end) - Math.abs((Date.parse(b.at) || 0) - end)); });
    return { cands: cands, unresolved: order.map(function (id) { return { eaId: id, name: unres[id] }; }) };
  }
  /* which league club each outside club played as, for the picked game. With one league club in the sittings the answer is
     the game's other club; with none, the desk asks which club the first outside club was, and the second is the other.
     null while it still has to ask; { err } when the game cannot take it (one club, one substitution per game). (CG._smMatchMap) */
  function matchMap(info, m) {
    var c = info.cands.filter(function (x) { return x.gameId === m.gameId; })[0], u = info.unresolved, map = {};
    if (!c || !u.length) return null;
    if (c.borrower) {
      if (u.length > 1) return { err: "Two different outside clubs can’t both stand in for " + c.borrower + " in one game." };
      map[u[0].eaId] = c.borrower; return { map: map, fx: c };
    }
    if (u.length > 2) return { err: "These sittings hold more than two outside clubs, so they are not one game." };
    if (!m.side || (m.side !== c.home && m.side !== c.away)) return null;
    map[u[0].eaId] = m.side;
    if (u[1]) map[u[1].eaId] = m.side === c.home ? c.away : c.home;
    return { map: map, fx: c };
  }
  function lengthText(s) {   /* CG._smLengthText */
    return s.length === "full" ? "Full game" : s.length === "full-ot" ? "Full game, overtime" : s.length === "level" ? "60 min, tied"
      : (s.minutes != null ? s.minutes + " of 60 min" : "Part of a game");
  }
  /* a sitting's score in its game's order (away first), or by club name for a game outside the league (CG._smSitScore) */
  function sitScore(s, g) {
    var cl = s.clubs || [];
    if (g) {
      var a = cl.filter(function (c) { return c.team === g.away; })[0], h = cl.filter(function (c) { return c.team === g.home; })[0];
      if (a && h) return scoreText(g.away, g.home, a.score, h.score);
    }
    return cl.map(function (c) { return (c.team || c.name || "EA club " + c.eaId) + " " + c.score; }).join(", ");
  }
  /* the action bar: one button, worded for exactly what the ticks will do (CG._smBar). v4.50 (commissioner, 2026-11-12: "If I
     manually file a game from multiple sittings on the stats manager desk, it should file even if the time does not add up
     to 60 minutes excactly"): a decided score publishes at any clock (Rule 4.3.3); a level one stays held (Rule 4.1) */
  function bar(f, grs, sel) {
    if (!sel.sel.length || (!sel.ticked.length && !sel.reFile)) return null;
    var max = sel.sel.length >= 4 ? " Four sittings is the most one game can take." : "";
    if (sel.groups.length > 1) {
      var nm = function (gr) { return gr.game ? fx(gr.game) : (gr.sessions[0].clubs || []).map(function (c) { return c.name || c.team; }).join(" vs "); };
      return { err: true, title: "Tick sittings from one game only", caption: "You have ticks under " + nm(sel.groups[0]) + " and under " + nm(sel.groups[1]) + ".", btn: "Clear ticks", act: "clear" };
    }
    var gr = sel.one, n = sel.sel.length;
    if (gr.kind === "not-league") {
      return n === 1
        ? { mode: "pickup", title: "Import 1 sitting as a pickup game", caption: "Player profiles only. It never touches standings, eligibility or ratings." + max, btn: "Import as a pickup game", busy: "Importing…" }
        : { mode: "pickup", title: "Import " + n + " sittings as one pickup game", caption: "Stats are added up and the scores combined. Player profiles only." + max, btn: "Import as one pickup game", busy: "Importing…" };
    }
    var G = gr.game ? fx(gr.game) : "this game";
    if (sel.reFile && !f.restart) return { mode: "league", title: "File " + G + " from its " + n + " sitting" + (n === 1 ? "" : "s"),
      caption: "Its sittings are on file, but no result is published. Filing them publishes the game on a decided score, even short of sixty minutes (Rule 4.3.3); a level score stays held (Rule 4.1).",
      btn: "File the game", busy: "Checking…" };
    if (f.restart) return { mode: "league", restart: true, title: "Re-file " + G + " from " + n + " sitting" + (n === 1 ? "" : "s"), caption: "Every other sitting on this game is struck, with its stats, for good." + max, btn: "Re-file the game", busy: "Checking…" };
    if (n === 1 && !sel.locked.length) return { mode: "league", title: "File 1 sitting into " + G, caption: "A decided score publishes, even short of sixty minutes (Rule 4.3.3); a level score stays held (Rule 4.1)." + max, btn: "File the sitting", busy: "Checking…" };
    var k = sel.locked.length, m = n - k;
    return { mode: "league", title: "Merge " + n + " sittings into " + G,
      caption: (k ? k + " already on the game, " + m + " you ticked. " : "") + "Stats are added up into one game (Rule 4.3)." + max,
      btn: "Merge " + n + " sittings", busy: "Checking…" };
  }
  /* v4.37: after a substitution is recorded, the sittings it matched are ticked once they read as that game's (CG._smApplyTicks) */
  function applyTicks(f, done, tick) {
    var t = f.tickAfter; if (!t || t !== tick) return;
    var ok = (f.sess || []).filter(function (s) { return t.ids.indexOf(s.matchId) >= 0 && s.kind === "league" && s.fixture && s.fixture.gameId === t.gameId && s.canMerge && !s.onGame && !s.struck; });
    /* v4.37 review: ticked only when the game's sittings, those already on it included, can be one plain game. A full-length
       sitting beside another is a second game (a rematch, a full replay) or a restart; a first sitting of ten (10) minutes
       or less with more after it is a restart (Rule 4.3: its stub is struck, never added). Those the staffer picks by hand,
       with the Restarted fold. */
    var all = (f.sess || []).filter(function (s) { return !s.struck && ((s.kind === "league" && s.fixture && s.fixture.gameId === t.gameId) || t.ids.indexOf(s.matchId) >= 0); })
      .sort(function (a, b) { return (Date.parse(a.endedAt) || 0) - (Date.parse(b.endedAt) || 0); });
    var full = all.filter(function (s) { return s.length === "full" || s.length === "full-ot"; }).length;
    /* the stub is the earliest of the game's OWN sittings (on it, or matched now and not moved away), with anything after it:
       an unrelated earlier sitting tagged to the fixture never hides it */
    var own = all.filter(function (s) { return (s.onGame || ok.indexOf(s) >= 0) && !(f.moved[s.matchId] && f.moved[s.matchId] !== t.gameId); }), first = own[0];
    var stub = !!first && first.minutes != null && first.minutes <= 10 && all.some(function (s) { return (Date.parse(s.endedAt) || 0) > (Date.parse(first.endedAt) || 0); });
    /* a later phase sees more (EA adds the restart the archive had not yet): it takes back only its OWN earlier ticks; a
       tick the staffer made ended the automatic ones already */
    (t.auto || []).forEach(function (id) { delete f.picked[id]; });
    t.auto = [];
    if (ok.length && !stub && (!full || all.length === 1)) ok.forEach(function (s) { f.picked[s.matchId] = true; t.auto.push(s.matchId); });
    if (done) f.tickAfter = null;
  }
  /* v4.37 review: a phase that failed takes back the ticks it set and spends the rest (a phase that never completed leaves
     nothing ticked), and says whether the list must be repainted (CG._smDropTicks) */
  function dropTicks(f, tick) {
    if (!tick || f.tickAfter !== tick) return false;
    var had = (tick.auto || []).length > 0;
    (tick.auto || []).forEach(function (id) { delete f.picked[id]; });
    f.tickAfter = null;
    return had;
  }

  /* =========================================================================================================== */
  /* THE DESK'S STATE: per fixture, never the league's (that is S2.M, read again after each confirmed write)       */
  /* =========================================================================================================== */
  var GD = {};
  function gd(id) {
    if (!GD[id]) GD[id] = { id: id, owed: false, acts: [],
      /* the classic desk's find state (CG._smS().find), for this fixture: main is the club whose EA record is read, extra an
         outside club found by name (both clubs' records hold a league game; a borrowed club's holds only its own) */
      find: { focus: id, main: null, extra: null, before: null, sess: null, from: null, err: null, picked: {}, restart: false, adv: false, moved: {},
        busy: null, res: null, match: null, tickAfter: null, open: {} },
      search: { q: "", seq: 0, searching: 0, t0: 0, clubs: null, err: null },
      box: { rows: null, err: null, req: 0, q: Promise.resolve(), msg: "", pending: 0 },
      ff: { open: false, kind: null, who: null, why: "", busy: false, res: null, err: "" },
      fix: { busy: false, res: null, err: "" } };
    return GD[id];
  }
  /* the working copy desk.js keeps (gs) holds the editors' state (resEdit, the club tab, the edit stack); its result fields
     follow the league after every write, so nothing on screen is what was typed */
  function resync(s) {
    var g = M.game(s.g.id); if (!g) return;
    s.g = g; s.as = g.as; s.hs = g.hs; s.ot = !!g.ot; s.ruling = g.forfeit ? { club: g.forfeit, kept: !!g.kept } : null;
  }
  function act(D, what) { D.acts.unshift({ at: Date.now(), what: what }); }
  function teamOf(code) { return TEAMS.byCode[code] || null; }

  /* =========================================================================================================== */
  /* GAMES: the lists                                                                                             */
  /* =========================================================================================================== */
  /* games waiting on this desk: held short of a full game, or with no result two hours after puck drop (CG._smTodoHtml) */
  function waiting() {
    var n = now();
    return M.games.map(sched).filter(function (g) {
      if (g.status === "final" || g.forfeit || g.voided) return false;
      return !!g.eaMatchId || g.at < n - 2 * 3600000;
    }).sort(function (a, b) { return a.at - b.at; });
  }
  var GV = [["ruling", "Needs a ruling"], ["box", "Missing box score"], ["imports", "Recent exceptions"], ["tonight", "Tonight"]];
  function finalsNoBox() { return M.games.filter(function (g) { return g.isFinal && !g.forfeit && !g.hasBox && !g.voided; }); }
  /* the import exceptions (ea_import_issues): a sitting the importer could not place, kept until staff clear it */
  var IMP = { rows: null, err: null, at: 0, req: 0, busy: false };
  function gcount(v) { var n = nextNight(); return v === "ruling" ? waiting().length : v === "box" ? finalsNoBox().length : v === "imports" ? (IMP.rows ? IMP.rows.length : 0) : n.tonight ? n.tonight.games.length : 0; }
  function gameRow(g, chip, extra, o) {
    o = o || {};
    var mg = M.game(g.id) || g, res = mg.isFinal && mg.hs != null ? "Final: " + mg.away + " " + mg.as + ", " + mg.home + " " + mg.hs + (mg.forfeit ? " (forfeit by " + mg.forfeit + ")" : mg.ot ? " in overtime" : "") : mg.label;
    return '<a class="row dk-grow" href="#/desk/game/' + mg.id + '" data-kbd-item><span class="dk-pair">' + M.crest(mg.away) + M.crest(mg.home) + '</span><span class="grow">' + tag(o.c || "officiating") + '<span class="title">' + esc(mg.away + " at " + mg.home) +
      '</span><span class="sub">' + esc(o.slate ? res : mg.date + " · " + mg.time + " ET · " + res) + (extra ? " · " + esc(extra) : "") + "</span></span>" + (chip || "") + S2.chev() + "</a>";
  }
  function gameList(v) {
    var body, cap = "";
    if (v === "ruling") {
      var L = waiting();
      body = L.length ? '<div class="dk-rows" data-kbd-list>' + L.map(function (g) {
          var held = !!g.eaMatchId;
          return gameRow(g, '<span class="chip warn">' + (held ? "Held" : "No result") + "</span>",
            held ? "its sittings are on file, but no result is published" : "no result two hours after puck drop", { c: held ? "statistics" : "officiating" });
        }).join("") + "</div>"
        : stateBox("ok", "No game waits on this desk", "Every game played has a result on record.");
      cap = "Games waiting on this desk: held short of a full game (a sitting EA recorded short of 60:00 after a disconnect), or with no result two hours after puck drop. Each opens its Game desk, where its sittings are filed or a forfeit is ruled.";
    } else if (v === "box") {
      var nb = finalsNoBox(), ff = M.games.filter(function (g) { return g.forfeit && !g.hasBox; });
      body = (nb.length ? '<div class="dk-rows" data-kbd-list>' + nb.map(function (g) { return gameRow(g, '<span class="chip warn">No box</span>', "", { c: "statistics" }); }).join("") + "</div>"
        : stateBox("ok", "Every final has a box score", "Checked against all " + M.games.filter(function (g) { return g.isFinal; }).length + " finals this season.")) +
        '<details class="dk-more-d"><summary class="row"><span class="grow">Forfeits with no game played</span><span class="num t-foot">' + ff.length + "</span>" + S2.chev() + "</summary>" +
        '<div class="dk-rows">' + ff.map(function (g) { return gameRow(g, '<span class="dk-flag">No box by design</span>', "", { c: "officiating" }); }).join("") + "</div></details>";
      cap = "A forfeit with no game played keeps no box score, so those are listed apart and never counted as missing.";
    } else if (v === "imports") {
      if (!IMP.rows && !IMP.err && !IMP.busy) { IMP.busy = true; setTimeout(loadImports, 0); }
      body = IMP.err ? stateBox("err", "Couldn't load the import exceptions", esc(IMP.err), '<button type="button" class="btn sm secondary" data-gd="imp-retry">Try again</button>')
        : !IMP.rows ? '<p class="t-foot dk-pad">Loading the import exceptions…</p>'
        : !IMP.rows.length ? stateBox("ok", "Every import is checked", "Nothing the importer could not place is waiting.")
        : '<div class="dk-rows" id="dkImp" data-kbd-list>' + IMP.rows.map(impRow).join("") + "</div>";
      body += '<div class="dk-pad">' + EA.statusLine() + "</div>";
      cap = "Sittings the importer could not file. Ones near a league fixture open its Game desk, where they are matched and filed; the rest are cleared here" + (matchMedia("(pointer: coarse)").matches ? "." : ", and E clears the selected row.");
    } else {
      var n = nextNight(), t = n.tonight;
      body = t ? slate(t) : stateBox("muted", "No games tonight", "It is " + esc(M.etLong(new Date(now()))) + ". " + (n.next ? "The next game night is " + esc(n.next.label) + ", " + n.next.games.length + " games in " + n.next.slots.length + " slots." : "No game night is scheduled."));
      if (!t && n.next) body += '<div class="dk-slate-h"><span class="t-head">' + esc(n.next.label) + '</span><span class="t-foot">Week ' + n.next.week + "</span></div>" + slate(n.next);
      cap = "On a game night this shows each slot as it plays. Each fixture opens its Game desk.";
    }
    return '<p class="dk-lead" id="dkGLead">' + cap + '</p><section class="card pad-0" id="dkGList">' + body + "</section>";
  }
  /* an exception's clubs, by league code where the league knows the EA club, and the fixture that night it is nearest */
  function impInfo(x) {
    var codes = (x.clubs || []).map(function (id) { var t = TEAMS.byEa[String(id)]; return t ? t.code : null; }).filter(Boolean);
    var day = x.day || (x.at ? etDay(Date.parse(x.at)) : null), end = Date.parse(x.at) || 0;
    var g = codes.length && day ? M.games.filter(function (y) { return y.night === day && (codes.indexOf(y.home) >= 0 || codes.indexOf(y.away) >= 0); })
      .sort(function (a, b) { return Math.abs(Date.parse(a.at) - end) - Math.abs(Date.parse(b.at) - end); })[0] || null : null;
    return { codes: codes, outside: (x.clubs || []).length - codes.length, game: g, day: day };
  }
  function impRow(x, i) {
    var inf = impInfo(x), who = inf.codes.length ? inf.codes.join(" and ") + (inf.outside ? " against an outside club" : "") : "Two clubs outside the league";
    var when = inf.day ? M.etDate(inf.day) : "Date not recorded";
    return '<div class="row dk-irow" tabindex="0" data-imp="' + i + '" data-kbd-item><span class="dk-dot warn" aria-hidden="true"></span><span class="grow">' + tag("statistics") +
      '<span class="title">' + esc(who) + '</span><span class="sub">' + esc(when + " · " + (x.reason || "Not placed")) + "</span></span>" +
      (inf.game ? '<a class="btn sm secondary" href="#/desk/game/' + inf.game.id + '">Open ' + esc(inf.game.away + " at " + inf.game.home) + "</a>" : "") +
      '<button type="button" class="btn sm secondary" data-act="clear-imp" data-i="' + i + '">Clear</button></div>';
  }
  function loadImports() {
    var req = ++IMP.req;
    return Promise.all([loadTeams().catch(function () { return null; }), rd(function (c) { return c.rpc("ea_import_issues"); })]).then(function (r) {
      if (req !== IMP.req) return;
      IMP.busy = false; IMP.err = null; IMP.at = Date.now(); IMP.rows = ((r[1] || {}).unmatched || []).slice(0, 40);
      repaintImports();
    }, function (e) { if (req !== IMP.req) return; IMP.busy = false; IMP.err = e.message; IMP.rows = null; repaintImports(); });
  }
  function repaintImports() {
    var c = $('[data-gview="imports"] .dk-chipn'); if (c) { c.textContent = IMP.rows ? IMP.rows.length : 0; c.hidden = !(IMP.rows && IMP.rows.length); }
    if (st.view !== "games" || st.gview !== "imports") return;
    var gw = $("#dkGWrap"); if (!gw || gw.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    gw.innerHTML = gameList("imports"); EA.paintStatus(gw);
  }
  function slate(n) {
    return '<div class="dk-rows" data-kbd-list>' + n.slots.map(function (s) {
      return '<div class="dk-slot-h">' + esc(s.time) + " ET</div>" + s.games.map(function (g) { return gameRow(g, "", "", { slate: true, c: "officiating" }); }).join("");
    }).join("") + "</div>";
  }
  function paneGames(r) {
    leaving();
    var v = GV.some(function (x) { return x[0] === r.q.view; }) ? r.q.view : st.gview; st.gview = v;
    if (v === "imports" && IMP.at && Date.now() - IMP.at > 30000) { IMP.rows = null; IMP.err = null; }   /* a visit reads it again; nothing polls */
    if (v === "imports") setTimeout(function () { EA.paintStatus($("#dkGWrap")); }, 0);
    return '<div class="dk-views ' + DESK.R + '" role="group" aria-label="Game lists" id="dkGViews">' + GV.map(function (x) {
      return '<button class="dk-chip" data-gview="' + x[0] + '" aria-pressed="' + (x[0] === v) + '">' + x[1] + ' <span class="num dk-chipn"' + (gcount(x[0]) ? "" : " hidden") + ">" + gcount(x[0]) + "</span></button>";   /* a zero count says nothing (audit 2026-11-09) */
    }).join("") + '</div><div class="' + DESK.R + '" id="dkGWrap">' + gameList(v) + "</div>" +
      /* i3d (g5's hand-over): the pickup tools (js/pages/pickups.js) are statistics staff's too */
      '<p class="t-foot dk-gpu ' + DESK.R + '"><a class="arrow" href="' + esc(S2.pickups.href()) + '"><span>Pickup games</span>' + S2.ic("chev") + "</a> Games imported from EA outside league play: the list, the import and the line editor.</p>";
  }
  /* "Clear" (ea_dismiss_import): marked checked only when the exceptions read again no longer hold it */
  function clearImport(i, kb) {
    var x = IMP.rows && IMP.rows[i]; if (!x) return;
    var row = $('[data-imp="' + i + '"]'), btn = row && $('[data-act="clear-imp"]', row);
    if (btn) { btn.disabled = true; btn.textContent = "Clearing…"; }
    S2.write("ea_dismiss_import", { p_match_id: String(x.match_id) }).then(function () {
      return rd(function (c) { return c.rpc("ea_import_issues"); });
    }).then(function (d) {
      var rows = ((d || {}).unmatched || []).slice(0, 40), still = rows.some(function (y) { return String(y.match_id) === String(x.match_id); });
      if (still) throw new Error("The league still lists this sitting as unplaced. Reload the page and try again.");
      var after = row ? row.nextElementSibling : null;
      IMP.rows = rows; IMP.at = Date.now();
      var gw = $("#dkGWrap"); if (gw) { gw.innerHTML = gameList("imports"); EA.paintStatus(gw); }
      var nl2 = $("#dkImp"); if (!kb && row && nl2) ghostOut(nl2, row, after ? $('[data-imp="' + after.dataset.imp + '"]', nl2) : null);
      repaintImports();
      var nx = $('[data-imp="' + Math.min(i, rows.length - 1) + '"]'); if (kb && nx) { nx.classList.add("is-sel"); nx.focus(); }
      S2.toast("Import marked checked", "ok");
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Clear"; }
      S2.toast("Not cleared: " + e.message, "err");
    });
  }

  /* =========================================================================================================== */
  /* GAME DESK: one fixture                                                                                       */
  /* =========================================================================================================== */
  function pct(s) { return (s / 3600 * 100).toFixed(2) + "%"; }
  /* a segment can never be wider than the 60:00 track it sits on */
  function seg(cls, from, dur) { from = Math.max(0, Math.min(3600, from)); dur = Math.max(0, Math.min(3600 - from, dur)); return '<span class="dk-seg ' + cls + '" style="left:' + pct(from) + ";width:" + pct(dur) + '"></span>'; }
  function held(s) { var g = sched(s.g); return g.status !== "final" && !g.forfeit && !g.voided && !!g.eaMatchId; }
  function decided(s) {
    var g = s.g;
    if (g.voided) return "void";
    if (s.ruling) return "forfeit";
    if (g.isFinal) return s.ot ? "ot" : "reg";
    if (held(s)) return "held";
    return Date.parse(g.at) < now() ? "pending" : "upcoming";
  }
  function stateLabel(s) { return { "void": "Voided", forfeit: "Forfeit", ot: "Final/OT", reg: "Final", held: "Held", pending: "No result yet", upcoming: "Upcoming" }[decided(s)]; }
  function topic(s) { return held(s) ? "statistics" : "officiating"; }
  /* a substitution on record for this game, read from the sittings loaded (clubs[].via, v4.37) */
  function subsOn(id) {
    var out = [], f = gd(id).find;
    (f.sess || []).forEach(function (s) { (s.clubs || []).forEach(function (c) { if (c.via === "substitution" && c.team && c.subGame === id && !out.some(function (x) { return x.eaId === c.eaId; })) out.push(c); }); });
    return out;
  }
  /* the match center: a sharp-edged ink band with big condensed scores, crests as the imagery */
  function scoreHead(s) {
    var g = s.g, side = function (c) {
      return '<div class="dk-sb-side">' + M.crest(c, "xl") + '<div class="dk-sb-name"><span class="d-3">' + esc(c) + '</span><span class="dk-sb-full">' + esc(teamName(c)) + "</span></div></div>";
    };
    var score = function (v, k) { return '<span class="d-num dk-sb-score" data-k="' + k + '">' + (v == null ? "–" : v) + "</span>"; };
    var flags = [g.makeup ? "Make-up game" : "", s.ruling ? "Forfeit by " + s.ruling.club + (s.ruling.kept ? ", result kept" : "") : "",
      held(s) ? "Held sitting" : "", subsOn(g.id).length ? "Played under an outside club" : ""].filter(Boolean);
    return '<section class="band ink dk-sb ' + DESK.R + '" id="dkSB" aria-label="Score" data-theme="dark" data-look-scope data-finish="' + esc(S2.state.finish) + '">' +
      '<div class="dk-sb-top"><span class="kicker">CGHL · Week ' + g.week + " · " + esc(g.stage === "regular" ? "Regular season" : g.stage) + "</span>" + tag(topic(s)) + "</div>" +
      '<div class="dk-sb-row">' + side(g.away) +
      '<div class="dk-sb-mid">' + score(s.as, "as") + '<span class="dk-sb-dash" aria-hidden="true"></span>' + score(s.hs, "hs") + "</div>" + side(g.home) + "</div>" +
      '<div class="dk-sb-foot"><span class="dk-sb-state" data-k="label">' + esc(stateLabel(s)) + '</span><span class="dk-sb-when">' + esc(g.date + ", " + g.time + " ET") + "</span>" +
      flags.map(function (f) { return '<span class="chip warn">' + esc(f) + "</span>"; }).join("") +
      '<a class="arrow dk-sb-link" href="#/game/' + g.id + '"><span>Game Center</span>' + S2.ic("chev") + "</a></div></section>";
  }
  /* the sentence under the fixture's title: what stands and what still waits, repainted with the scoreboard */
  function gameLede(s) {
    var g = s.g, dd = decided(s);
    if (dd === "upcoming") return "Puck drop " + esc(g.date + ", " + g.time) + " ET. Its sittings, the box score and any ruling land here once it is played.";
    if (dd === "void") return "This game was voided: it counts for no one.";
    if (dd === "held") return "A sitting is on file, but no result is published: file its sittings below, or rule on it.";
    if (dd === "pending") return "No result is on record yet. Find its sittings below, or rule on it.";
    return (s.ruling ? "The " + esc(teamName(s.ruling.club)) + " forfeited" + (s.ruling.kept ? " with the result kept, so every line still counts" : "")
      : "Final" + (s.ot ? " in overtime" : "") + ": " + esc(g.away + " " + s.as + ", " + g.home + " " + s.hs)) + ".";
  }
  function gameHeadHtml(s) {
    var t = s ? s.g.away + " at " + s.g.home : "Game desk";
    return '<header class="page-head dk-head dk-ghead ' + DESK.R + '"><nav class="dk-crumbs" aria-label="Breadcrumb"><a href="#/desk" data-pane="today">Staff Desk</a><span aria-hidden="true">/</span>' +
      '<a href="#/desk?tab=games" data-pane="games">Games</a><span aria-hidden="true">/</span><span aria-current="page">' + esc(t) + "</span></nav>" +
      '<span class="kicker">Game desk</span><h1 class="d-1" id="dkTitle" tabindex="-1">' + esc(t) + '</h1><p class="lede-l" id="dkSub">' +
      (s ? gameLede(s) : "No fixture matches this link.") + "</p></header>";
  }
  /* the committee this fixture's question belongs to and its manager. One staff (S2 ruling, 2026-10-19): anyone on staff
     may act on it; the escalation the concept sketched has no door yet, so it is not offered */
  function comCard(s) {
    var c = topic(s), mg = manager(c), mine = me().manages === c;
    return '<section class="dk-gsec dk-com ' + DESK.R + '" id="dkCom" aria-labelledby="dkComH">' + secHead({ lvl: 2, sm: true, id: "dkComH", k: "Committee", h: comName(c),
        p: (mg ? "Managed by " + esc(mg) + (mine ? " (you)" : "") + " " + mgrBadge() + ". " : "") + "Anyone on staff may act on this fixture." }) + "</section>";
  }

  /* ---------- sittings: the classic desk's find, for this fixture ---------- */
  var SM_LEN = function (s) { return s.length === "full" || s.length === "full-ot" || s.length === "level" ? 3600 : s.minutes != null ? s.minutes * 60 : null; };
  /* one sitting row: a real checkbox (a repaint waits while it is focused). The row's rule is the classic one
     (CG._smSitRowHtml); only this fixture's own group can be ticked here, so one merge is always this game's */
  function sitRow(s, gr, f, sel, here) {
    var g = gr.game, checked = false, disabled = false, state;
    var restartOn = f.restart && sel.one === gr;
    if (s.onGame && !s.struck && !restartOn) { checked = true; disabled = true; state = "On this game. Every merge keeps it."; }
    else if (s.struck) { disabled = true; state = "Struck when the game restarted. A struck sitting stays struck."; }
    else if (s.onGame && restartOn) { checked = !!f.picked[s.matchId]; state = "On this game. Leave it unticked to strike it."; }
    else if (gr.kind === "league" ? !s.canMerge : !s.canPickup) {
      disabled = true;
      state = s.why || (s.pickupGameId ? "Imported as a pickup game." : gr.kind !== "not-league" ? "EA’s record of this sitting can’t be read." : "Not a league game.");
    }
    else { checked = !!f.picked[s.matchId]; state = gr.kind === "not-league" ? "Not a league game." : "Not on any game yet."; }
    if (gr.locked || !here) disabled = true;
    if (!here && !s.onGame && !s.struck && gr.kind === "league") state = "On " + (g ? fx(g) : "another game") + ", not this one.";
    if (!checked && !disabled && sel.sel.length >= 4) disabled = true;
    if (s.fixture && s.fixture.inWindow === false && gr.kind === "league") state += " Ended outside this game’s window.";
    var ended = Date.parse(s.endedAt) || 0, score = sitScore(s, g), len = SM_LEN(s);
    var b = (gr.kind === "league" ? "Sitting " + s._k + " · " : "") + lengthText(s) + (score ? " · " + score : "");
    /* an unreadable sitting can come with no end time: say so rather than print the epoch */
    var small = (ended ? "Ended " + M.etTime(new Date(ended)) + " ET" + (gr.kind === "league" ? "" : ", " + M.etDate(new Date(ended))) : "No end time from EA") + " · " + state;
    var tone = s.struck ? "unknown struck" : s.onGame ? "ok a" : checked ? "cand" : "cand2";
    /* i3d (g5's hand-over): a sitting imported as a pickup game links to that game (js/pages/pickups.js) */
    var pu = s.pickupGameId ? ' <a href="' + esc(S2.pickups.href(s.pickupGameId)) + '">Open the pickup game</a>' : "";
    return '<div class="dk-sitrow" data-sit="' + esc(s.matchId) + '"><label class="dk-radio"><input type="checkbox" name="gdSit" value="' + esc(s.matchId) + '"' + (checked ? " checked" : "") + (disabled ? " disabled" : "") + ">" +
      '<span><span class="title">' + esc(b) + '</span><span class="t-foot">' + esc(small) + pu + "</span></span></label>" +
      '<div class="dk-track">' + (len == null ? seg("unknown", 0, 3600) : seg(tone, 0, len)) + TICKS + (s.struck ? '<span class="dk-strikeline" aria-hidden="true"></span>' : "") + "</div></div>";
  }
  /* v4.37: a substitution on record shows on its game, in any group. Remove names the game the substitution is recorded on
     (subGame) and stands only while that game is open: not filed, not held, no sitting on it. The database refuses the rest
     for everyone but a commissioner (sql/2026-10-29-substitution-clear-guard-v437.sql). (CG._smSubNotes) */
  function subNotes(gr) {
    var subs = [];
    gr.sessions.forEach(function (s) { (s.clubs || []).forEach(function (c) { if (c.via === "substitution" && c.team && c.subGame && !subs.some(function (x) { return x.eaId === c.eaId && x.subGame === c.subGame; })) subs.push(c); }); });
    return subs.map(function (c) {
      var g = game(c.subGame) || (gr.game && gr.game.id === c.subGame ? gr.game : null);
      var open = !!g && g.status === "scheduled" && !g.eaMatchId && !gr.sessions.some(function (s) { return s.onGame; });
      /* v4.37 review: on a filed or held game the desk offers no Remove to anyone. Removing it there would leave a filed box
         score under a club that stands for no one, and nothing on this desk can record it again; a commissioner rules on a
         wrong one (Rule 4.6), from the report */
      return '<p class="t-foot dk-note">' + esc((c.name || "EA club " + c.eaId) + " counts as " + teamName(c.team) + " in " + (g && !(gr.game && gr.game.id === g.id) ? fx(g) + ", " + M.etDateTime(new Date(g.at)) : "this game") + " only (Rule 4.6).") +
        (open ? ' <button type="button" class="btn sm secondary" data-gd="unsub" data-game="' + esc(c.subGame) + '" data-ea="' + esc(c.eaId) + '" data-name="' + esc(c.name || "") + '">Remove</button>'
          : g ? ' <button type="button" class="btn sm secondary" data-gd="report" data-game="' + esc(c.subGame) + '">Report a mistake</button>' : "") + "</p>";
    }).join("");
  }
  /* v4.37: match an outside club's sittings to the league game a CGHL club played under it (Rule 4.6) (CG._smMatchHtml) */
  function matchHtml(gr, f) {
    var m = f.match, info = matchInfo(gr);
    if (!info.cands.length || !info.unresolved.length) return "";
    var names = info.unresolved.map(function (u) { return u.name; }).join(" and "), many = info.unresolved.length > 1;
    /* said once, above the button; the open panel only asks */
    if (!m || m.key !== gr.key)
      return '<p class="t-foot">' + esc(names + " " + (many ? "are not league clubs" : "is not a league club") + ". If a CGHL club played its league game under " + (many ? "them" : "it") + " (Rule 4.6), match " + (many ? "them" : "it") + " to that game.") + "</p>" +
        '<div class="dk-actions"><button type="button" class="btn sm secondary" data-gd="m-open" data-key="' + esc(gr.key) + '">Match to a league game</button></div>';
    var h = '<div class="dk-ea-match" id="gdMatch"><p class="t-head" id="gdMatchQ" tabindex="-1">Which league game was it?</p><div class="dk-rows">';
    info.cands.forEach(function (c) {
      var g = fxGame(c);
      h += '<label class="dk-radio"><input type="radio" name="gdMatchGame" value="' + esc(c.gameId) + '"' + (m.gameId === c.gameId ? " checked" : "") + '><span><span class="title">' + esc(fx(g)) + '</span><span class="t-foot">' +
        esc(M.etDateTime(new Date(g.at)) + (c.inWindow ? " · in the game’s window" : "")) + "</span></span></label>";
    });
    h += "</div>";
    var mm = m.gameId ? matchMap(info, m) : null, c = info.cands.filter(function (x) { return x.gameId === m.gameId; })[0];
    if (c && mm && mm.err) h += '<p class="dk-err" role="alert">' + esc(mm.err) + "</p>";
    else if (c && c.borrower) h += '<p class="t-foot">' + esc(teamName(c.borrower) + " played as " + info.unresolved[0].name + ".") + "</p>";
    else if (c) {
      h += '<fieldset class="dk-ea-side"><legend class="t-head">Which club played as ' + esc(info.unresolved[0].name) + "?" + (info.unresolved[1] ? ' <span class="t-foot">' + esc(info.unresolved[1].name + " was the other club.") + "</span>" : "") +
        '</legend><div class="dk-clubpick">' + [c.away, c.home].map(function (code) {
          return '<button type="button" class="dk-chip" data-gd="m-side" data-club="' + esc(code) + '" aria-pressed="' + (m.side === code) + '">' + M.crest(code) + esc(code) + '<span class="t-foot">' + (code === c.away ? "Away" : "Home") + "</span></button>";
        }).join("") + "</div></fieldset>";
    }
    h += '<label class="field dk-ea-why"><span>Why couldn’t they use their own club?</span><input class="input" id="gdMatchWhy" maxlength="200" autocomplete="off" placeholder="e.g. Their club would not load" value="' + esc(m.why || "") + '">' +
      '<span class="t-foot">Kept with the substitution in the league’s audit log.</span></label>' +
      (m.err ? '<p class="dk-err" role="alert">' + esc(m.err) + "</p>" : "") +
      '<div class="dk-actions"><button type="button" class="btn sm secondary" data-gd="m-cancel">Cancel</button><button type="button" class="btn sm" data-gd="m-go"' + (m.busy ? " aria-busy=\"true\"" : "") + ">" + (m.busy ? "Recording…" : "Record it") + "</button></div></div>";
    return h;
  }
  function groupHtml(gr, f, sel, id) {
    var g = gr.game, here = gr.kind === "league" && gr.gameId === id, head, notes = "";
    if (gr.kind === "league" && g) {
      head = (here ? "This game" : fx(g)) + (gr.complete ? " · " + plural(gr.sessions.length, "1 sitting", "sittings") + " on file" : "");
      notes = subNotes(gr);
      if (g.forfeit) notes += gr.locked
        ? '<p class="t-foot dk-note">Forfeit on record against ' + esc(g.forfeit) + '. Only a commissioner can change this game. <button type="button" class="btn sm secondary" data-gd="report" data-game="' + esc(g.id) + '">Report a mistake</button></p>'
        : '<p class="t-foot dk-note">The forfeit against ' + esc(g.forfeit) + " stays on record. Undo it under Ruling if it should not stand.</p>";
    } else {
      var s0 = gr.sessions[0], cl = s0.clubs || [], other = cl.filter(function (c) { return !c.team; })[0], ours = cl.filter(function (c) { return c.team; })[0];
      head = (ours ? ours.team : (cl[0] && (cl[0].name || cl[0].team)) || "?") + " vs " + (other ? (other.name || "EA club " + other.eaId) : (cl[1] && (cl[1].name || cl[1].team)) || "?");
      notes = subNotes(gr) + (matchHtml(gr, f) || (gr.kind === "needs-substitution" ? '<p class="t-foot dk-note">' + esc((other ? (other.name || "EA club " + other.eaId) : "One club") + " is not a league club, and no open game is near it to match it to.") + "</p>" : ""));
    }
    var alts = "";
    gr.sessions.forEach(function (s) {
      if (gr.kind !== "league" || s.onGame || s.struck) return;
      (s.alternatives || []).concat(f.moved[s.matchId] && s.fixture ? [s.fixture] : []).filter(function (x) { return x && x.gameId !== gr.gameId; }).slice(0, 2).forEach(function (x) {
        if (!(s.ambiguous || (s.fixture && s.fixture.inWindow === false) || f.moved[s.matchId])) return;   /* the classic rule: only a sitting that could be either */
        alts += '<p class="t-foot dk-note">' + esc("Sitting " + s._k + " could also be " + (x.gameId === id ? "this game" : x.away + " at " + x.home + ", " + M.etDateTime(new Date(Date.parse(x.at) || 0))) + ".") +
          ' <button type="button" class="btn sm secondary" data-gd="move" data-match="' + esc(s.matchId) + '" data-to="' + esc(x.gameId) + '">' + (x.gameId === id ? "Move it here" : "Move it there") + "</button></p>";
      });
    });
    return '<div class="dk-cand" data-key="' + esc(gr.key) + '"><div class="dk-cand-h"><span class="t-head">' + esc(head) + '</span><span class="t-foot">' + esc(g ? M.etDateTime(new Date(g.at)) : etDay(gr.latest || now())) + "</span></div>" + notes +
      gr.sessions.map(function (s) { return sitRow(s, gr, f, sel, here); }).join("") + alts + "</div>";
  }
  /* a tick counts only under this fixture's own group: a reply that moved a ticked sitting to another game drops the tick,
     so the bar can never merge into a game this page is not about */
  function prune(f, grs, id) {
    var mine = {};
    grs.forEach(function (gr) { if (gr.gameId === id && gr.kind === "league") gr.sessions.forEach(function (x) { mine[x.matchId] = 1; }); });
    Object.keys(f.picked).forEach(function (k) { if (!mine[k]) delete f.picked[k]; });
    return grs;
  }
  /* the groups that belong on this fixture's desk: its own, and any whose sittings could be this game (an outside club's
     sittings near it, a sitting tagged to a sibling fixture that could be this one) */
  function relevant(gr, id) {
    if (gr.gameId === id) return true;
    return gr.sessions.some(function (s) {
      return (s.subCandidates || []).some(function (c) { return c.gameId === id; }) || (s.fixture && s.fixture.gameId === id) ||
        (!s.onGame && !s.struck && (s.ambiguous || (s.fixture && s.fixture.inWindow === false)) && (s.alternatives || []).some(function (x) { return x && x.gameId === id; }));
    });
  }
  function eaLine(f) {
    var src = f.main, e = src && src.ea, x = f.extra && f.extra.ea, out = "";
    if (e && e.state === "wait") out += '<p class="t-foot dk-ea-wait" id="gdEaLine">Checking EA for newer sittings. This can take up to 25 seconds.</p>';
    else if (e && e.state === "fail") out += '<p class="dk-err" id="gdEaLine" role="alert">EA didn’t answer, so this shows only what the league archive holds. Sittings from the last few minutes may be missing. ' + esc(e.error || "") +
      ' <button type="button" class="btn sm secondary" data-gd="ea-again">Check EA again</button></p>';
    else if (e && e.state === "ok") out += '<p class="t-foot" id="gdEaLine">' + (e.added ? "EA checked just now: " + plural(e.added, "1 newer sitting", "newer sittings") + " added." : "EA checked just now: nothing newer.") + "</p>";
    if (x && x.state === "fail") out += '<p class="dk-err" role="alert">EA didn’t answer for ' + esc(f.extra.name) + ". " + esc(x.error || "") + "</p>";
    return out;
  }
  function resHtml(f) {
    var res = f.res; if (!res) return "";
    if (res.kind === "merge") {
      var r = res.r, g = game(res.gid), G = g ? fx(g) : "The game", sc = HA(r.score), score = g && sc ? scoreText(g.away, g.home, sc.a, sc.h) : String(r.score || "");
      var n = plural(r.sittings, "1 sitting", "sittings");
      return r.held
        ? '<div class="dk-warnbar" id="gdSitRes" role="status" tabindex="-1">' + ic("alert") + "<span><b>Merged and held.</b> " + esc(n + ", " + score + " so far. " + (r.heldWhy || "")) + (r.struck ? " " + esc(plural(r.struck, "1 sitting", "sittings") + " struck.") : "") + "</span></div>"
        : '<p class="dk-com-done" id="gdSitRes" role="status" tabindex="-1">' + S2.ic("check") + "<span><b>Merged.</b> " +
          esc(G + " is final: " + score + (r.wentOt ? (r.inferredOt ? ", in overtime, read from the clock" : ", in overtime") : "") + ". " + n + (r.short ? " (" + r.minutes + " of 60 minutes, filed as entered here)" : "") + ", " + r.players + " player lines, " + r.linked + " matched to profiles.") +
          (r.struck ? " " + esc(plural(r.struck, "1 sitting", "sittings") + " struck.") : "") +
          (r.overlong ? " The sittings run past sixty minutes by more than a goal, so statistics staff were flagged (Rule 4.3)." : "") + "</span></p>";
    }
    if (res.kind === "sub") return '<p class="dk-com-done" id="gdSitRes" role="status" tabindex="-1">' + S2.ic("check") + "<span>" + (res.b ? "<b>" + esc(res.b) + "</b> " : "") + esc(res.text) + "</span></p>";
    return '<p class="dk-err" id="gdSitRes" role="alert" tabindex="-1">' + esc(res.error) + "</p>";
  }
  /* the restart fold and the action bar share one slot: both change with every tick (CG._smBarSlotHtml) */
  function barSlot(f, grs, sel) {
    var h = '<div id="gdBar">';
    if (sel.restartable) {
      var G = sel.one.game ? fx(sel.one.game) : "This game";
      h += '<details class="dk-more-d" id="gdAdv"' + (f.restart || f.adv ? " open" : "") + '><summary class="row"><span class="grow">Restarted game?</span>' + S2.chev() + "</summary>" +
        '<label class="dk-radio"><input type="checkbox" id="gdRestart"' + (f.restart ? " checked" : "") + '><span><span class="title">' + esc(G) + " was restarted from 0:00</span>" +
        '<span class="t-foot">Only for an illegal loadout (Rule 4.5) or a stop in the first ten minutes (Rule 4.3). Every sitting on this game you leave unticked is struck, with its stats, for good.</span></span></label></details>';
    }
    if (f.err) h += '<p class="dk-err" id="gdSitErr" role="alert">' + esc(f.err) + "</p>";
    var b = bar(f, grs, sel);
    if (b && b.mode !== "pickup") {
      var busy = !!f.busy;
      h += '<div class="dk-cand" id="gdBarBox" role="region" aria-label="Selected sittings"><div class="dk-cand-h"><span class="t-head' + (b.err ? " dk-err" : "") + '">' + esc(b.title) + "</span></div>" +
        '<p class="t-foot">' + esc(b.caption) + '</p><div class="dk-actions">' +
        (b.err ? '<button type="button" class="btn sm secondary" data-gd="clear">' + esc(b.btn) + "</button>"
          : '<button type="button" class="btn sm" data-gd="go"' + (busy ? ' aria-busy="true"' : "") + ">" + esc(busy ? (f.busy === "merge" ? "Merging…" : b.busy) : b.btn) + "</button>") + "</div></div>";
    }
    return h + "</div>";
  }
  /* the Sittings headline says what EA's record amounts to right now */
  function sitHead(s, D) {
    var f = D.find, mine = (f.sess || []).filter(function (x) { return x.kind === "league" && x.fixture && (f.moved[x.matchId] || x.fixture.gameId) === s.g.id; });
    var on = mine.filter(function (x) { return x.onGame && !x.struck; }).length;
    if (!f.sess) return f.main ? "Reading the sittings" : "No EA club to read";
    if (!mine.length) return s.g.isFinal ? "No sitting found" : decided(s) === "upcoming" ? "Not played yet" : "No sitting found yet";
    if (held(s)) return "Held: " + plural(on, "1 sitting", "sittings") + " on file, no result";
    if (s.g.isFinal && on) return on > 1 ? on + " sittings, one game" : "One sitting, one game";
    return plural(mine.length, "1 sitting", "sittings") + " near this game";
  }
  function sitCard(s) {
    var id = s.g.id, D = gd(id), f = D.find, body;
    if (TEAMS.err && !f.main) body = '<p class="dk-err" role="alert">Couldn’t read the clubs’ EA records: ' + esc(TEAMS.err) + ' <button type="button" class="btn sm secondary" data-gd="retry">Try again</button></p>';
    else if (!f.main && f.noClub) body = '<p class="t-foot dk-note">' + esc("Neither " + s.g.away + " nor " + s.g.home + " has an EA club on file, so this game’s sittings can’t be listed. The league office links a club’s EA club in the Control Center.") + "</p>";
    else if (f.main && f.main.loadErr && !f.sess) body = '<p class="dk-err" role="alert">Couldn’t load the sittings: ' + esc(f.main.loadErr) + ' <button type="button" class="btn sm secondary" data-gd="retry">Try again</button></p>';
    else if (!f.sess) body = '<p class="t-foot dk-note">Loading ' + esc(f.main ? f.main.name : "the clubs") + "’s sittings from the league archive…</p>";
    else {
      var grs = groups(f.sess, f), sel = selection(f, prune(f, grs, id)), mine = grs.filter(function (gr) { return gr.gameId === id && gr.kind === "league"; }),
        rest = grs.filter(function (gr) { return !(gr.gameId === id && gr.kind === "league") && relevant(gr, id); });
      body = "";
      if (!mine.length) {
        var eaSaid = f.main && f.main.ea && f.main.ea.state === "ok" ? " or on EA" : f.main && f.main.ea && f.main.ea.state === "wait" ? " (EA is still being checked)" : f.before ? " for these dates (EA keeps only a club’s last few games)" : "";
        var other = f.main && (f.main.team === s.g.home ? s.g.away : s.g.home), ot = other && teamOf(other);
        body += '<p class="t-foot dk-note">' + esc("No sittings for this game are in " + (f.main ? f.main.team : "the club") + "’s league archive" + eaSaid + ". If a club played it under another EA club, search that club below (Rule 4.6).") +
          (ot && ot.ea ? ' <button type="button" class="btn sm secondary" data-gd="switch">Look under ' + esc(other) + " instead</button>" : "") + "</p>";
      }
      if (mine.length || rest.length) body += '<div class="dk-axis" aria-hidden="true"><span>0:00</span><span>20:00</span><span>40:00</span><span>60:00</span></div>';
      body += mine.map(function (gr) { return groupHtml(gr, f, sel, id); }).join("");
      if (rest.length) body += '<p class="t-cap">Also recorded near this game</p>' + rest.map(function (gr) { return groupHtml(gr, f, sel, id); }).join("");
      if (f.main && f.main.loadErr) body += '<p class="dk-err" role="alert">' + esc(f.main.loadErr) + ' <button type="button" class="btn sm secondary" data-gd="retry">Try again</button></p>';
      body += barSlot(f, grs, sel);
    }
    return '<section class="dk-gsec dk-sit ' + DESK.R + '" id="dkSit" aria-labelledby="dkSitH">' + secHead({ lvl: 2, id: "dkSitH", focus: true, k: "Sittings", h: sitHead(s, D),
        p: "What EA recorded for these clubs, in game time. A game that lagged out and was resumed has two or more sittings: tick them, then merge them into this game. A restart stopped inside the first ten minutes is struck for good." }) +
      eaLine(f) + resHtml(f) + body + "</section>";
  }

  /* ---------- the outside EA club (Rule 4.6): search EA by name, read that club's sittings ---------- */
  function outsideCard(s) {
    var g = s.g, D = gd(g.id), q = D.search, f = D.find;
    if (decided(s) === "upcoming" || decided(s) === "void") return '<section class="dk-gsec dk-ea" id="dkEa" hidden></section>';
    var head = function (h, p) { return secHead({ lvl: 2, id: "dkEaH", focus: true, k: "Outside EA club", h: h, p: p }); };
    var subs = subsOn(g.id);
    var done = subs.length ? '<div class="dk-ea-done">' + subs.map(function (c) { return M.crest(c.team) + '<span class="dk-ea-done-t"><span><b>' + esc(teamName(c.team)) + "</b> played as <b>" + esc(c.name || "an outside club") + "</b></span>" +
      '<span class="t-foot">Matched to this game under Rule 4.6. Its sittings count as this game, and every line in them counts.</span></span>'; }).join("") + "</div>" : "";
    var out = "";
    if (q.searching) out = '<p class="t-foot dk-ea-wait">Searching EA for “' + esc(q.q) + '”. This can take up to 25 seconds.</p>';
    else if (q.err) out = '<p class="dk-err" role="alert">' + esc(q.err) + ' <button type="button" class="btn sm secondary" data-act="ea-search">Try again</button></p>';
    else if (q.clubs && !q.clubs.length) out = '<p class="t-foot">EA found no club named “' + esc(q.q) + '”. Check the spelling.</p>';
    else if (q.clubs) out = '<p class="t-cap dk-ea-pick">Pick the club</p><div class="list dk-ea-list">' + q.clubs.map(function (c, i) {
      var lt = TEAMS.byEa[String(c.clubId)], picked = f.extra && f.extra.eaId === String(c.clubId);
      return '<div class="row"><span class="grow"><span class="title">' + esc(c.name) + '</span><span class="sub">' + esc(lt ? teamName(lt.code) + "’s own EA club" : (c.memberCount ? c.memberCount + " members" : "Not a league club")) + "</span></span>" +
        (picked ? '<span class="chip">' + (f.extra.loaded ? "Sittings read" : "Reading…") + "</span>" : '<button type="button" class="btn sm secondary" data-gd="ea-club" data-i="' + i + '">Use this club</button>') + "</div>";
    }).join("") + "</div>" + (f.extra && f.extra.loaded ? '<p class="t-foot">' + esc(f.extra.name) + "’s sittings near this game are under Sittings, above, with a way to match them to this game.</p>" : "");
    return '<section class="dk-gsec dk-ea ' + DESK.R + '" id="dkEa" aria-labelledby="dkEaH">' +
      head(subs.length ? teamName(subs[0].team) + " played as " + (subs[0].name || "an outside club") : "Played under another EA club?",
        subs.length ? "A substitution is on record for this game (Rule 4.6)." : "If a club played this game under an EA club outside the league (Rule 4.6), search that club on EA, then match its sittings to this game under Sittings.") + done +
      '<div class="dk-ea-q"><label class="field"><span>EA club name</span><span class="dk-ea-row"><input class="input" type="search" id="dkEaQ" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. Chel Gaming Blades" value="' + esc(q.q) + '">' +
        '<button type="button" class="btn sm secondary" data-act="ea-search">Search EA</button></span></label>' + EA.statusLine() +
      '<div id="dkEaOut" aria-live="polite">' + out + "</div></div></section>";
  }
  /* the club search (CG._smSearch), through pickup-import's EA search and the bot server */
  function eaSearch() {
    var s = cur(); if (!s) return;
    var D = gd(s.g.id), q = D.search, inp = $("#dkEaQ"); if (inp) q.q = inp.value;
    var t = String(q.q || "").trim();
    if (t.length < 2) { q.clubs = null; q.err = "Type at least two letters of the club’s EA name."; paintParts(s.g.id, ["dkEa"]); return; }
    var req = ++q.seq;
    q.searching = req; q.t0 = Date.now(); q.err = null; q.clubs = null; paintParts(s.g.id, ["dkEa"]);
    searchApi({ action: "search", clubName: t }).then(function (o) {
      if (req !== q.seq) return;
      q.searching = 0;
      if (!o || o.error) q.err = (o && o.error) || "The server did not answer."; else q.clubs = o.clubs || [];
      paintParts(s.g.id, ["dkEa"]);
      var first = $('#dkEaOut [data-gd="ea-club"]'); if (first) first.focus({ preventScroll: true });
    }, function (e) { if (req !== q.seq) return; q.searching = 0; q.err = e.message; paintParts(s.g.id, ["dkEa"]); });
  }

  /* ---------- loading: the classic desk's two phases (CG._smLoad, CG._smLoadEa) for one club of this fixture ---------- */
  /* opts: keep (union with what is held), ea (then EA through the bot server), tick (the ticks a substitution earned) */
  function loadClub(id, which, opts) {
    var D = gd(id), f = D.find, src = f[which]; if (!src) return;
    opts = opts || {};
    var req = ++src.seq, club = src.eaId;
    if (which === "main") f.match = null;   /* every load is the staffer's: it closes the match panel, as Record does (v4.37 review) */
    if (opts.keep && src.ea && src.ea.state === "wait") opts.ea = true;   /* the old EA reply is dropped with the old sequence */
    src.loadErr = null;
    if (which === "main" && !opts.keep) { f.sess = null; src.ea = null; f.from = null; }
    paintSit(id);
    var p1 = { clubId: club, ea: false }; if (f.before) p1.before = f.before;
    leagueApi({ leagueSessions: p1 }).then(function (o) {
      if (req !== src.seq || f[which] !== src) return;
      /* a failed load drops the pending ticks, as a failed EA phase does: a later load must not tick them unasked */
      if (!o || o.error) { dropTicks(f, opts.tick); src.loadErr = (o && o.error) || "The server did not answer."; paintSit(id); return; }
      f.sess = union(f.sess, o.sessions || []); src.loaded = true;
      applyTicks(f, !opts.ea, opts.tick);
      if (o.archiveFrom && (!f.from || o.archiveFrom < f.from)) f.from = o.archiveFrom;
      paintSit(id);
      if (opts.ea) loadEa(id, which, req, opts.tick);
    }).catch(function (e) {
      if (req !== src.seq) return;
      dropTicks(f, opts.tick); src.loadErr = e.message; paintSit(id);
    });
  }
  function loadEa(id, which, req, tick) {
    var D = gd(id), f = D.find, src = f[which]; if (!src) return;
    var club = src.eaId;
    src.ea = { state: "wait", t0: Date.now() }; paintSit(id);
    leagueApi({ leagueSessions: { clubId: club, ea: true } }).then(function (o) {
      if (req !== src.seq || f[which] !== src) return;
      if (!o || o.error) { dropTicks(f, tick); src.ea = { state: "fail", error: (o && o.error) || "The server did not answer." }; paintSit(id); return; }
      var seen = {}; (f.sess || []).forEach(function (s) { seen[s.matchId] = 1; });
      var added = (o.sessions || []).filter(function (s) { return !seen[s.matchId]; }).length;
      f.sess = union(f.sess, o.sessions || []); src.loaded = true;
      applyTicks(f, true, tick);
      src.ea = o.ea && o.ea.ok === false && !o.ea.skipped ? { state: "fail", error: o.ea.error || "" } : { state: "ok", added: added };
      paintSit(id);
    }).catch(function (e) {
      if (req !== src.seq) return;
      dropTicks(f, tick); src.ea = { state: "fail", error: e.message }; paintSit(id);
    });
  }
  /* v4.37 review: after a substitution is recorded or removed, read the sittings again: an older game's sit on an archive
     page (the same rule as the first load), a recent one's on the newest page and EA (CG._smReloadFor). The pending ticks
     ride THIS load (its phases carry the object): no other load ever runs them again */
  function reloadFor(id) {
    var f = gd(id).find, tick = f.tickAfter || null;
    var eaOnly = (f.sess || []).some(function (s) { return s.source === "ea" && ((tick && tick.ids.indexOf(s.matchId) >= 0) || (s.fixture && s.fixture.gameId === id)); });
    loadClub(id, "main", f.before ? { keep: true, ea: eaOnly, tick: tick } : { ea: true, keep: true, tick: tick });
    if (f.extra) loadClub(id, "extra", { keep: true, ea: !f.before });
  }
  /* entering a fixture: its clubs' EA ids, then the first club with one (home first, as CG._smFocusGame); an older game is
     read from the archive only, from the two days after it back (EA keeps only a club's last few games) */
  var LAST = null;
  function enter(id) {
    var D = gd(id), f = D.find, s = gs(id); if (!s) return;
    f.picked = {}; f.moved = {}; f.restart = false; f.adv = false; f.res = null; f.err = null; f.match = null; f.tickAfter = null; f.sess = null; f.noClub = false;
    var g = sched(s.g), older = now() - g.at >= 9 * DAY;
    f.before = older ? etDay(g.at + 2 * DAY) : null;
    loadTeams().then(function () {
      var keep = f.main && f.main.team, t = [keep, g.home, g.away].map(teamOf).filter(function (x) { return x && x.ea; })[0];
      if (!t) { f.main = null; f.noClub = true; paintSit(id); return; }
      f.main = { eaId: t.ea, name: teamName(t.code), team: t.code, seq: f.main ? f.main.seq : 0, ea: null, loadErr: null, loaded: false };
      loadClub(id, "main", { ea: !older });
      if (f.extra) loadClub(id, "extra", { keep: true, ea: !older });
    }, function () { paintSit(id); });
    loadBox(id);
    setTimeout(function () { EA.paintStatus($("#dkEa")); }, 0);
  }
  /* the hash left this fixture: the next visit reads everything again (no polling; a page entry is a fresh read) */
  function leaving() { LAST = null; }
  window.addEventListener("hashchange", function () { var r = S2.parse(); if (!(r.name === "desk" && r.arg === "game" && r.sub === LAST)) LAST = null; });

  /* ---------- box score: the lines as the league holds them; a line is changed through stats_game_row ---------- */
  var SKC = [["g", "G", "Goals"], ["a", "A", "Assists"], ["p", "P", "Points", 1], ["pm", "+/-", "Plus-minus"], ["sog", "SOG", "Shots on goal"], ["hits", "Hits", "Hits"]];
  var GKC = [["sv", "SV", "Saves"], ["sa", "SA", "Shots against"], ["ga", "GA", "Goals against"], ["svp", "SV%", "Save percentage", 1]];
  var COL = { g: "goals", a: "assists", pm: "plus_minus", sog: "shots", hits: "hits", sv: "saves", sa: "shots_against", ga: "goals_against" };
  var LBL = { g: "goals", a: "assists", pm: "plus-minus", sog: "shots on goal", hits: "hits", sv: "saves", sa: "shots against", ga: "goals against" };
  var BOXSEL = "id,game_id,team_id,profile_id,skater_name,position,is_goalie,goals,assists,plus_minus,shots,hits,saves,shots_against,goals_against,time_on_ice_seconds";
  function cellVal(l, k) { return k === "p" ? (l.g || 0) + (l.a || 0) : k === "svp" ? (l.sa ? (l.sv / l.sa).toFixed(3).replace(/^0/, "") : "–") : l[k]; }
  /* a game_stats row as a box line (the shape the table draws); its id is what stats_game_row needs */
  function lineOf(r) {
    var t = TEAMS.byId[r.team_id], p = r.profile_id ? M.player(r.profile_id) : null;
    return { id: r.id, club: t ? t.code : null, tag: p ? p.tag : r.profile_id ? "Unknown player" : (r.skater_name || "Unidentified player"), href: r.profile_id ? "#/player/" + r.profile_id : null,
      pos: r.is_goalie ? "G" : r.position || "", role: r.is_goalie ? "G" : "S", goalie: !!r.is_goalie, unidentified: !r.profile_id,
      g: r.goals || 0, a: r.assists || 0, pm: r.plus_minus || 0, sog: r.shots || 0, hits: r.hits || 0, sv: r.saves || 0, sa: r.shots_against || 0, ga: r.goals_against || 0, toi_s: r.time_on_ice_seconds || 0 };
  }
  function loadBox(id) {
    var bx = gd(id).box, req = ++bx.req;
    return Promise.all([TEAMS.at ? null : loadTeams(), rd(function (c) { return c.from("game_stats").select(BOXSEL).eq("game_id", id); })]).then(function (r) {
      if (req !== bx.req) return;
      bx.err = null; bx.rows = r[1] || [];
      paintParts(id, ["dkBox"]);
    }, function (e) { if (req !== bx.req) return; bx.err = e.message; paintParts(id, ["dkBox"]); });
  }
  /* the lines on screen: the staff read (each line carries its id, so it can be changed) or, until that read answers, the
     league's own box score, read only */
  function boxLines(s) {
    var bx = gd(s.g.id).box, out = {};
    out[s.g.away] = []; out[s.g.home] = [];
    if (bx.rows) {
      bx.rows.map(lineOf).forEach(function (l) { (out[l.club] = out[l.club] || []).push(l); });
      Object.keys(out).forEach(function (c) { out[c].sort(function (a, b) { return a.role === b.role ? (M.POS_RANK[a.pos] || 9) - (M.POS_RANK[b.pos] || 9) : a.role === "S" ? -1 : 1; }); });
      return { lines: out, live: true };
    }
    var g = M.game(s.g.id) || { box: {} };
    Object.keys(g.box || {}).forEach(function (c) { out[c] = g.box[c]; });
    return { lines: out, live: false };
  }
  function boxTable(s, club, rows, cols, cap, live) {
    var tot = function (k) { return k === "svp" ? "" : sum(rows.map(function (r) { return cellVal(r[0], k); })); };
    return '<table class="tbl dk-btbl"><caption class="sr">' + esc(cap) + '</caption><thead><tr><th scope="col">' + (cols === GKC ? "Goaltender" : "Skater") + '</th><th scope="col">Pos</th>' +
      cols.map(function (c) { return '<th scope="col"><abbr title="' + c[2] + '">' + c[1] + "</abbr></th>"; }).join("") + '<th scope="col">TOI</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var l = r[0], i = r[1];
        /* a long gamertag ellipsizes (full tag in the title) so the stat columns stay in view; chips sit on their own line */
        var chips = (l.offRole ? '<span class="chip">' + (l.goalie ? "In goal this game" : "Skating this game") + "</span>" : "") + (l.former ? '<span class="chip">Former</span>' : "") + (l.unidentified ? '<span class="chip warn">Unlinked</span>' : "");
        return '<tr><th scope="row" class="dk-bname" title="' + esc(l.tag) + '"><span class="dk-bn">' + (l.href ? '<a href="' + esc(l.href) + '">' + esc(l.tag) + "</a>" : esc(l.tag)) + "</span>" +
          (chips ? '<span class="dk-bchips">' + chips + "</span>" : "") + "</th>" +
          "<td>" + esc(l.pos) + "</td>" + cols.map(function (c) {
            var v = cellVal(l, c[0]), shown = c[0] === "pm" && v > 0 ? "+" + v : v;
            if (c[3] || !live) return '<td class="num' + (c[3] ? " dk-calc" : "") + '">' + shown + "</td>";
            var ed = s.edits.some(function (e) { return e.id === l.id && e.k === c[0]; });
            return '<td class="num dk-ed' + (ed ? " edited" : "") + '" tabindex="-1" data-cell="' + club + "|" + i + "|" + c[0] + '" aria-label="' + esc(l.tag + ", " + c[2] + " " + v + (ed ? ", changed this session" : "") + ". Enter to change") + '">' + shown + "</td>";
          }).join("") + '<td class="num">' + clock(l.toi_s || 0) + "</td></tr>";
      }).join("") + '</tbody><tfoot><tr><th scope="row">Total</th><td></td>' + cols.map(function (c) { var v = tot(c[0]); return '<td class="num">' + (c[0] === "pm" && v > 0 ? "+" + v : v) + "</td>"; }).join("") + "<td></td></tr></tfoot></table>";
  }
  /* the box is checked against the result on record: a club's goals must add up to its score (a voided goal is taken off
     the line AND off the score, memory: removing goals) */
  function boxCheck(s, club, lines) {
    var ng = sum((lines[club] || []).map(function (l) { return l.g; })), score = club === s.g.home ? s.hs : s.as;   /* every line, a goaltender's too (CG._smBoxGoals) */
    return { ng: ng, score: score, off: s.g.isFinal && score != null && (lines[club] || []).length > 0 && ng !== score };
  }
  function boxBody(s) {
    var B = boxLines(s), lines = B.lines, bx = gd(s.g.id).box, club = s.club, sk = [], gl = [];
    (lines[club] || []).forEach(function (l, i) { (l.role === "G" ? gl : sk).push([l, i]); });
    var ck = boxCheck(s, club, lines), warn = "";
    if (ck.off) warn = '<div class="dk-warnbar" role="status">' + ic("alert") + "<span>Goals in " + esc(club) + "'s box total <b class=\"num\">" + ck.ng + "</b>; the result says <b class=\"num\">" + ck.score + "</b>. Correct the result or fix a line.</span></div>";
    var msg = bx.msg ? bx.msg : bx.err ? "The lines can't be changed here: " + bx.err : !B.live ? "Reading the lines…" : s.edits.length ? plural(s.edits.length, "One change", "changes") + " this session." : "Select a number to change it. Enter saves, Esc cancels, arrows move.";
    return '<div id="dkBoxBody">' + warn + '<div class="tbl-wrap">' + boxTable(s, club, sk, SKC, club + " skaters", B.live) + "</div>" + (gl.length ? '<div class="tbl-wrap">' + boxTable(s, club, gl, GKC, club + " goaltenders", B.live) + "</div>" : "") +
      '<div class="dk-boxbar"><span class="t-foot' + (bx.err || /^(Not|Couldn)/.test(bx.msg) ? " err" : "") + '" id="dkBoxMsg" aria-live="polite">' + esc(msg) + "</span>" +
      (s.edits.length && !bx.pending ? '<button class="btn sm secondary" data-act="undo">' + ic("undo") + 'Undo <span class="dk-kbd">' + (MAC ? "⌘Z" : "Ctrl Z") + "</span></button>" : "") + "</div></div>";
  }
  function boxCard(s) {
    var g = s.g, B = boxLines(s), any = (B.lines[g.away] || []).length + (B.lines[g.home] || []).length;
    if (!any) return '<section class="dk-gsec dk-box ' + DESK.R + '" id="dkBox" aria-labelledby="dkBoxH">' + secHead({ lvl: 2, id: "dkBoxH", k: "Box score", h: g.isFinal ? "No box score" : "No lines yet",
      p: s.ruling && !s.ruling.kept ? "A forfeit with no game played keeps no box score; there is nothing to count." : gd(g.id).box.err ? "The lines could not be read: " + esc(gd(g.id).box.err) : g.isFinal ? "This final has no box score. File its sittings to build one." : "Lines arrive from EA after the game." }) + "</section>";
    var off = [g.away, g.home].some(function (c) { return boxCheck(s, c, B.lines).off; });
    return '<section class="dk-gsec dk-box ' + DESK.R + '" id="dkBox" aria-labelledby="dkBoxH">' + secHead({ lvl: 2, id: "dkBoxH", k: "Box score",
        h: !g.isFinal ? "Lines on file, no result yet" : off ? "The lines disagree with the result" : "The lines match the result",
        p: "Every line counts toward season totals, at every position played. A goal voided on the commissioner's order comes off the scorer, the assists, the shots and the goaltender's line, then off the result.",
        arrow: '<div class="dk-clubs" role="tablist" aria-label="Club">' + [g.away, g.home].map(function (c) { return '<button role="tab" class="dk-clubtab" data-act="club" data-club="' + c + '" aria-selected="' + (c === s.club) + '">' + M.crest(c) + esc(c) + "</button>"; }).join("") + "</div>" }) +
      '<div class="dk-panel dk-sheet">' + boxBody(s) + "</div></section>";
  }

  /* ---------- result: the classic correction, on the concept's steppers ---------- */
  function resNote(res, id) {
    if (!res) return "";
    return res.ok ? '<p class="dk-com-done" id="' + id + '" role="status" tabindex="-1">' + S2.ic("check") + "<span>" + (res.b ? "<b>" + esc(res.b) + "</b> " : "") + esc(res.text) + "</span></p>"
      : '<p class="dk-err" id="' + id + '" role="alert" tabindex="-1">' + esc(res.text) + "</p>";
  }
  function r71(g) {
    var c = involved(g);
    return c ? '<p class="t-foot dk-note">This game involves your club (' + esc(c) + "). Under Rule 7.1 an official does not rule on a forfeit or correct a result in a game involving a club they play for or manage: hand it to another staffer or a commissioner.</p>" : "";
  }
  function resCard(s) {
    var g = s.g, D = gd(g.id), ed = s.resEdit, dd = decided(s), r = s.ruling, body = "";
    var h = dd === "upcoming" ? "Not played yet" : dd === "void" ? "Voided" : dd === "held" ? "Held, no result yet" : dd === "pending" ? "No result yet"
      : r ? "Win awarded to " + (r.club === g.home ? g.away : g.home) : s.ot ? "Final in overtime" : "Final in regulation";
    var dec = dd === "upcoming" ? "Puck drop " + esc(g.date + ", " + g.time) + " ET."
      : dd === "void" ? "A voided game counts for no one."
      : dd === "held" || dd === "pending" ? "A result is published by filing the game's sittings (Sittings, on this page), or by a forfeit ruling."
      : esc(r ? "Forfeit by the " + teamName(r.club) + (r.kept ? ". The forfeit decides the winner whatever the score; the box score still counts." : ". No box score counts.") : s.ot ? "Decided in overtime." : "Decided in regulation.");
    if (g.isFinal && !g.voided) {
      body = '<div class="dk-res"><div class="dk-res-line">' + M.crest(g.away) + "<span>" + esc(g.away) + '</span><b class="d-num" data-swap="ras">' + s.as + "</b></div>" +
        '<div class="dk-res-line">' + M.crest(g.home) + "<span>" + esc(g.home) + '</span><b class="d-num" data-swap="rhs">' + s.hs + "</b></div></div>";
      /* v3.52: once a forfeit is recorded only a commissioner changes its score; staff report the mistake instead */
      if (r && !commish()) body += '<p class="t-foot dk-note">This game carries a forfeit ruling. Only a commissioner can change its score.</p><div class="dk-actions"><button type="button" class="btn sm secondary" data-gd="report" data-game="' + esc(g.id) + '">Report a mistake</button></div>';
      else body += ed ? resEditor(s) : '<div class="dk-actions"><button class="btn sm secondary" data-act="res-edit">Correct the result</button></div>';
    }
    return '<section class="dk-gsec dk-rescard ' + DESK.R + '" id="dkRes" aria-labelledby="dkResH">' + secHead({ lvl: 2, sm: true, id: "dkResH", focus: true, swap: "lbl", k: "Result", h: h, p: dec }) +
      resNote(D.fix.res, "gdFixRes") + (g.isFinal ? r71(sched(g)) : "") + body + "</section>";
  }
  function resEditor(s) {
    var g = s.g, e = s.resEdit, D = gd(g.id), box = boxLines(s), sg = sched(g), step = function (side, c) {
      return '<div class="dk-step"><span class="dk-step-l">' + M.crest(c) + esc(c) + '</span><button class="dk-stepbtn" data-act="step" data-side="' + side + '" data-d="-1" aria-label="One fewer ' + esc(c) + ' goal">−</button>' +
        '<output class="num" id="dkStep_' + side + '" aria-live="polite">' + e[side] + '</output><button class="dk-stepbtn" data-act="step" data-side="' + side + '" data-d="1" aria-label="One more ' + esc(c) + ' goal">+</button></div>';
    };
    var bh = boxCheck(s, g.home, box.lines).ng, ba = boxCheck(s, g.away, box.lines).ng, any = (box.lines[g.home] || []).length + (box.lines[g.away] || []).length;
    return '<div class="dk-reseditor" role="group" aria-label="Correct the result">' + step("as", g.away) + step("hs", g.home) +
      '<div class="dk-switchrow"><span>Decided in overtime<span class="t-foot"> A one-goal game decided after sixty minutes</span></span><button class="switch" role="switch" aria-checked="' + e.ot + '" aria-label="Decided in overtime" data-act="ot"></button></div>' +
      '<p class="t-foot">' + esc("On record: " + scoreText(g.away, g.home, sg.awayScore, sg.homeScore) + (sg.ot ? " in overtime." : " in regulation.") + (any ? " The box score adds up to " + scoreText(g.away, g.home, ba, bh) + "." : "")) + "</p>" +
      '<p class="t-foot">A sitting missing from the game? Merge it under Sittings instead: that rebuilds the score and the stats together.</p>' +
      (D.fix.err ? '<p class="dk-err" role="alert" id="gdFixErr">' + esc(D.fix.err) + "</p>" : "") +
      '<div class="dk-actions"><button class="btn sm secondary" data-act="res-cancel">Cancel</button><button class="btn sm" data-act="res-save"' + (D.fix.busy ? ' aria-busy="true"' : "") + ">" + (D.fix.busy ? "Correcting…" : "Save correction") + "</button></div></div>";
  }

  /* ---------- ruling: the classic forfeit card (CG._smFfFormHtml) ---------- */
  function rulCard(s) {
    var g = s.g, sg = sched(g), D = gd(g.id), F = D.ff, r = s.ruling, body;
    var noIce = r && !r.kept, winner = r ? (r.club === g.home ? g.away : g.home) : null;
    var head = secHead({ lvl: 2, sm: true, id: "dkRulH", focus: true, k: "Ruling", h: r ? "Forfeit by " + r.club : g.voided ? "Voided" : "No ruling",
      p: r ? esc(noIce ? "No-show, ruled 1-0 to " + winner + "." : "Result kept: " + (g.hs != null ? scoreText(g.away, g.home, g.as, g.hs) : "the played score") + " stands, and " + r.club + " takes the forfeit loss.")
        : g.voided ? "A voided game counts for no one." : g.isFinal ? "EA's result stands." : "No forfeit is on record." });
    if (r) {
      body = commish()
        ? (noIce ? "" : '<p class="t-foot">Undo erases the played score too: the game goes back to scheduled with no score, held until its sittings are filed again.</p>') +
          '<div class="dk-rev"><div><p class="t-head">Undo the forfeit</p><p class="t-foot">A Reversed line posts in #game-scores. Commissioner only (Rule 3.2).</p></div><button type="button" class="btn sm danger" data-gd="ff-undo">Undo</button></div>'
        : '<p class="t-foot">Only a commissioner can change or undo a forfeit. If this one is wrong, report it and every commissioner is told at once.</p><div class="dk-actions"><button type="button" class="btn sm secondary" data-gd="report" data-game="' + esc(g.id) + '">Report a mistake</button></div>';
    } else if (g.voided) body = "";
    else if (!F.open) body = '<div class="dk-actions"><button type="button" class="btn sm secondary" data-gd="ff-open">Rule a forfeit</button></div>';
    else {
      var kd = kinds(sg), kind = F.kind && kd[F.kind] && kd[F.kind].ok ? F.kind : kd.pre;
      var opt = function (v, b, t, ko) {
        return '<label class="dk-radio"><input type="radio" name="gdFfKind" value="' + v + '"' + (kind === v ? " checked" : "") + (ko.ok ? "" : " disabled") + "><span><span class=\"title\">" + b + '</span><span class="t-foot">' + t + "</span>" +
          (ko.why ? '<span class="t-foot">' + esc(ko.why) + "</span>" : "") + "</span></label>";
      };
      var fin = sg.status === "final" && sg.homeScore != null;
      var who = function (code, side) {
        var mine = side === "Away" ? sg.awayScore : sg.homeScore, theirs = side === "Away" ? sg.homeScore : sg.awayScore;
        var lead = fin ? (mine > theirs ? " · ahead " + mine + "-" + theirs : mine < theirs ? " · behind " + mine + "-" + theirs : " · level " + mine + "-" + theirs) : "";
        return '<button type="button" class="dk-chip" data-gd="ff-who" data-club="' + esc(code) + '" aria-pressed="' + (F.who === code) + '">' + M.crest(code) + esc(code) + '<span class="t-foot">' + esc(side + lead) + "</span></button>";
      };
      body = '<form class="dk-rulform" data-form="ruling" onsubmit="return false">' + r71(sg) +
        '<fieldset><legend class="t-cap">What happened?</legend>' +
        opt("noshow", "No-show or late", "Didn’t show, wasn’t ready ten minutes after puck drop, or conceded ahead of time (Rule 3.2). The other club wins 1-0 with no player stats.", kd.noshow) +
        opt("dc3", "Three disconnections, or abandoned", "The game was played. The score and every stat line stand; the club charged takes a forfeit loss (Rule 4.3).", kd.dc3) + "</fieldset>" +
        '<p class="t-foot">Neither club showed? That is a void, not a forfeit (Rule 3.2): the league office voids it.</p>' +
        '<fieldset><legend class="t-cap">' + (kind === "dc3" ? "Which club is charged?" : "Which club didn’t show?") + "</legend>" +
        (kind === "dc3" ? '<p class="t-foot">The club with the third disconnection. For an abandoned game, the club that was behind when play stopped (Rule 4.3).</p>' : "") +
        '<div class="dk-clubpick">' + who(g.away, "Away") + who(g.home, "Home") + "</div></fieldset>" +
        '<label class="field"><span>Note for the record (optional)</span><input class="input" id="gdFfWhy" maxlength="300" autocomplete="off" placeholder="e.g. They had four players at 9:45 PM" value="' + esc(F.why) + '">' +
          '<span class="t-foot">Kept in the league’s audit log. Not posted anywhere.</span></label>' + ffState(sg, F, kind) + "</form>";
    }
    return '<section class="dk-gsec dk-rul ' + DESK.R + '" id="dkRul" aria-labelledby="dkRulH">' + head + resNote(F.res, "gdFfRes") + body +
      '<p class="t-foot dk-note">Discipline from a game is issued from the member record in People, like every suspension.</p></section>';
  }
  /* the part of the forfeit form a kind or club change repaints: never the input being typed in */
  function ffState(sg, F, kind) {
    var will = ffWill(sg, kind, F.who);
    return '<div id="gdFfState">' + (will ? '<p class="t-foot">' + esc(will) + "</p>" : "") + (F.err ? '<p class="dk-err" role="alert">' + esc(F.err) + "</p>" : "") +
      '<div class="dk-actions"><button type="button" class="btn sm secondary" data-gd="ff-cancel">Cancel</button><button type="button" class="btn sm" data-gd="ff-go"' + (F.busy ? ' aria-busy="true"' : "") + ">" + (F.busy ? "Ruling…" : "Rule the forfeit") + "</button></div></div>";
  }

  /* ---------- history: what the league holds for this game, and what this tab did (each one confirmed) ---------- */
  function histCard(s) {
    var g = s.g, D = gd(g.id), f = D.find, base = [{ at: Date.parse(g.at), what: "Puck drop scheduled, " + g.time + " ET", who: "Schedule" }];
    (f.sess || []).filter(function (x) { return x.kind === "league" && x.fixture && x.fixture.gameId === g.id && (x.onGame || x.struck); }).forEach(function (x) {
      base.push({ at: Date.parse(x.endedAt) || null, what: "EA recorded a sitting: " + lengthText(x) + (x.struck ? ", struck" : ", on this game"), who: "EA import" });
    });
    if (g.isFinal) base.push({ at: null, what: s.ruling ? "Forfeit on record against " + s.ruling.club + (s.ruling.kept ? ", result kept" : "") : "Final on record: " + g.away + " " + s.as + ", " + g.home + " " + s.hs + (s.ot ? " in overtime" : ""), who: "League record" });
    base.sort(function (a, b) { return (b.at || 9e15) - (a.at || 9e15); });
    var items = D.acts.map(function (x) { return { at: x.at, what: x.what, who: "You", mine: true }; }).concat(base);
    return '<section class="dk-gsec dk-hist ' + DESK.R + '" id="dkHist" aria-labelledby="dkHistH">' + secHead({ lvl: 2, sm: true, id: "dkHistH", k: "History", h: plural(items.length, "One event", "events"),
        p: "Newest first: what the league holds for this game, and what you did here (each one confirmed by the league)." }) + '<ol class="dk-tl">' +
      items.map(function (h) {
        var when = h.mine ? "This session" : h.at ? M.etDateTime(new Date(h.at)) : "Time not recorded";
        return "<li" + (h.mine ? ' class="mine"' : "") + '><span class="dk-tl-dot"></span><span class="title">' + esc(h.what) + '</span><span class="t-foot">' + esc(h.who + " · " + when) + "</span></li>";
      }).join("") + "</ol></section>";
  }
  function paneGame(id) {
    var s = gs(id);
    if (!s) { leaving(); return gameHeadHtml(null) + stateBox("err", "No fixture with that link", "The link may be old or mistyped. Every Game desk opens from a game list.", '<a class="btn sm secondary" href="#/desk?tab=games" data-pane="games">Back to games</a>'); }
    resync(s);
    if (LAST !== id) { LAST = id; setTimeout(function () { if (LAST === id) enter(id); }, 0); }   /* a page entry is a fresh read; a repaint is not */
    else setTimeout(function () { EA.paintStatus($("#dkEa")); }, 0);
    return gameHeadHtml(s) + scoreHead(s) +
      '<div class="dk-gd"><div class="dk-gd-main">' + sitCard(s) + outsideCard(s) + boxCard(s) + '</div><div class="dk-gd-aside">' + resCard(s) + rulCard(s) + comCard(s) + histCard(s) + "</div></div>";
  }

  /* =========================================================================================================== */
  /* REPAINT IN PLACE                                                                                             */
  /* =========================================================================================================== */
  var GPART = { dkSB: scoreHead, dkSit: sitCard, dkBox: boxCard, dkRes: resCard, dkRul: rulCard, dkCom: comCard, dkHist: histCard, dkEa: outsideCard };
  /* the control focused inside a part, as a selector that finds it again after the part is redrawn (CG._smPaint) */
  function focusKey(root) {
    var a = document.activeElement; if (!a || a === document.body || !root.contains(a)) return null;
    if (a.id) return "#" + a.id;
    if (a.dataset.cell) return '[data-cell="' + a.dataset.cell + '"]';
    if (a.name && a.value) return 'input[name="' + a.name + '"][value="' + a.value + '"]';
    var k = a.getAttribute("data-gd") || a.getAttribute("data-act");
    return k ? '[data-' + (a.getAttribute("data-gd") ? "gd" : "act") + '="' + k + '"]' + (a.dataset.club ? '[data-club="' + a.dataset.club + '"]' : "") : null;
  }
  function repaintGame(parts) {
    var s = cur(); if (!s) return;
    var keep = DESK.R; DESK.R = "";
    resync(s);
    /* the scoreboard carries the topic and the state, so the title's sentence and the committee section follow it */
    if (parts.indexOf("dkSB") >= 0) { if (parts.indexOf("dkCom") < 0) parts = parts.concat(["dkCom"]); var sub = $("#dkSub"); if (sub) sub.innerHTML = gameLede(s); }
    parts.forEach(function (p) {
      var el = $("#" + p); if (!el || !GPART[p]) return;
      var key = focusKey(el), oldEa = $("[data-ea-status]", el);
      el.outerHTML = GPART[p](s);
      var nu = $("#" + p); if (!nu) return;
      if (oldEa) { var ne = $("[data-ea-status]", nu); if (ne) ne.innerHTML = oldEa.innerHTML; }
      if (key) { var back = $(key, nu); if (back) try { back.focus({ preventScroll: true }); } catch (e) { /* a control that cannot take focus */ } }
    });
    DESK.R = keep;
    if (parts.indexOf("dkBox") >= 0) fadeBox();
  }
  /* repaint a fixture's parts only while its Game desk is the page on screen */
  function paintParts(id, parts) {
    var s = cur(); if (!s || s.g.id !== id) return;
    if ($(".dk-cell-in")) parts = parts.filter(function (p) { return p !== "dkBox"; });   /* a cell being typed in: finishing it redraws the box */
    repaintGame(parts);
  }
  /* never under someone typing (the match reason, the forfeit note, the search): the reply is kept and drawn when they leave
     the field (CG._smPaintSessIdle) */
  function typingIn() { var a = document.activeElement; return !!(a && a.tagName === "INPUT" && /^(text|search)$/.test(a.type) && a.closest("#dkSit, #dkEa, #dkRul")); }
  function paintSit(id) {
    var D = gd(id);
    if (typingIn()) { D.owed = true; var line = $("#gdEaLine"); if (line) line.outerHTML = eaLine(D.find) || '<p class="t-foot" id="gdEaLine"></p>'; return; }
    D.owed = false;
    paintParts(id, ["dkSit", "dkEa", "dkHist", "dkSB"]);
  }
  /* the league after a change made through a Netlify function (a merge): read this game again, then draw it */
  function refresh(id, parts) {
    var p = S2.reread ? S2.reread(["games", "box"], { gameIds: [id] }) : Promise.resolve(false);
    return p.then(function () { paintParts(id, parts || ["dkSB", "dkRes", "dkRul", "dkBox", "dkHist"]); }, function () { paintParts(id, parts || ["dkSB", "dkRes", "dkRul", "dkBox", "dkHist"]); });
  }

  /* =========================================================================================================== */
  /* ACTIONS                                                                                                      */
  /* =========================================================================================================== */
  /* the bar's button: a league group is previewed (nothing written), confirmed with exactly what will happen and what gets
     posted, then merged in ONE call (one box score, one notice: never one leagueMerge per sitting) (CG._smGo) */
  function go() {
    var s = cur(); if (!s) return;
    var id = s.g.id, D = gd(id), f = D.find; if (f.busy || !f.sess) return;
    var grs = prune(f, groups(f.sess, f), id), sel = selection(f, grs), b = bar(f, grs, sel);
    if (!b || b.err || b.mode !== "league") return;
    var paintBar = function () { paintParts(id, ["dkSit"]); };
    f.err = null;
    var gr = sel.one, g = gr.game, gid = gr.gameId, ids = sel.sel.slice(), restart = !!f.restart;
    /* a sitting only EA lists comes through the bot's stored answer for the club it was read under */
    var fromEa = ids.filter(function (x) { var t = sel.byId[x] && sel.byId[x].s; return t && t.source === "ea"; });
    var req = { leagueMerge: { gameId: gid, matchIds: ids, restart: restart } };
    if (fromEa.length) {
      var srcClub = f.extra && f.extra.loaded && (f.sess || []).some(function (x) { return fromEa.indexOf(x.matchId) >= 0 && (x.clubs || []).some(function (c) { return c.eaId === f.extra.eaId; }); }) &&
        !(f.sess || []).some(function (x) { return fromEa.indexOf(x.matchId) >= 0 && (x.clubs || []).some(function (c) { return f.main && c.eaId === f.main.eaId; }); }) ? f.extra.eaId : f.main.eaId;
      req.leagueMerge.eaClubId = srcClub;
    }
    var G = g ? fx(g) : "this game", n = ids.length;
    f.busy = "preview"; paintBar();
    leagueApi(withMerge(req, { preview: true })).then(function (r) {
      f.busy = null;
      if (!r || r.error || !r.ok) { f.err = (r && r.error) || "The server did not confirm the preview. Nothing was changed."; paintBar(); return; }
      var sc = HA(r.score), score = g && sc ? scoreText(g.away, g.home, sc.a, sc.h) : String(r.score || "");
      var cr = r.current && r.current.score ? HA(r.current.score) : null, curT = g && cr ? scoreText(g.away, g.home, cr.a, cr.h) : "";
      var ps = [];
      if (r.unpublish) ps.push(G + " is final now (" + curT + "). " + (r.heldWhy || "These sittings leave the game level, and a game can’t end level (Rule 4.1).") + " Going ahead takes that result off the standings and holds the game. Nothing is posted, so #game-scores keeps the old final until the game is published again.");
      else if (r.held) ps.push(G + " is held, and no result is published. " + (r.heldWhy || ""));
      else ps.push(G + " files as final: " + score + (r.wentOt ? (r.inferredOt ? " in overtime, read from the clock." : " in overtime.") : " in regulation.") + " The box score is rebuilt from these sittings, each player’s stats added up.");
      /* v4.50 (commissioner, 2026-11-12): a filing here publishes a decided score at any clock (Rule 4.3.3); say so plainly */
      if (r.short) ps.push("These sittings add up to " + r.minutes + " of 60 minutes. Filed here, the game stands as final anyway (Rule 4.3.3), and the import won’t add a later sitting to it on its own: merge one here if it turns up.");
      if (!r.unpublish) ps.push(r.posts === "final" ? "The final score posts in #game-scores." : r.posts === "corrected" ? "The score changes from " + curT + ", so a Corrected line posts in #game-scores." : "Nothing is posted in #game-scores.");
      var label = function (x) { var t = sel.byId[x] && sel.byId[x].s, e = t && Date.parse(t.endedAt); return t ? "Sitting " + t._k + " (" + (t.minutes != null ? t.minutes + " min" : "length unknown") + (e ? ", ended " + M.etTime(new Date(e)) + " ET" : "") + ")" : "sitting " + x; };
      if ((r.strike || []).length) ps.push("Struck for good, with their stats: " + r.strike.map(label).join(", ") + ".");
      if ((r.outsideWindow || []).length) ps.push(r.outsideWindow.map(label).join(" and ") + " ended outside this game’s window.");
      if ((r.fromEa || []).length) ps.push(r.fromEa.length === 1 ? "1 sitting is taken from EA and saved to the league archive." : r.fromEa.length + " sittings are taken from EA and saved to the league archive.");
      if (r.overlong) ps.push("The sittings run past sixty minutes and the margin is more than one goal, so statistics staff will be flagged (Rule 4.3).");
      if (r.links) ps.push("This also links " + r.links.team + "’s EA club to “" + (r.links.name || "EA club " + r.links.eaId) + "”, so its games import on their own from now on. Make sure that is " + r.links.team + "’s own club.");
      if (g && g.forfeit) ps.push("The forfeit stays on record. Undo it under Ruling if it should not stand.");
      var inv = g && involved(g); if (inv) ps.push("This game involves your club (" + inv + ") (Rule 7.1).");
      var title = restart ? "Re-file " + G + " from " + n + " sitting" + (n === 1 ? "" : "s") + "?" : sel.reFile ? "File " + G + " from its " + n + " sitting" + (n === 1 ? "" : "s") + "?"
        : n === 1 ? "File 1 sitting into " + G + "?" : "Merge " + n + " sittings into " + G + "?";
      var ok = r.unpublish ? "Hold the game" : restart ? "Strike and re-file" : n === 1 || sel.reFile ? "File it" : "Merge";
      confirmSheet({ title: title, ok: ok, danger: !!(restart || r.unpublish), body: ps.map(function (x) { return '<p class="t-sub">' + esc(x) + "</p>"; }).join(""),
        focus: function () { return $("#gdSitRes") || $("#gdSitErr") || $("#dkSitH"); },
        onOk: function () {
          f.busy = "merge"; paintBar();
          leagueApi(r.unpublish ? withMerge(req, { unpublish: true }) : req).then(function (r2) {
            f.busy = null;
            if (!r2 || r2.error || !r2.ok) { f.err = (r2 && r2.error) || "The server did not confirm the merge. Check the game before trying again."; paintBar(); var e0 = $("#gdSitErr"); if (e0) landOn(e0); return; }
            f.res = { kind: "merge", gid: gid, r: r2 }; f.picked = {}; f.tickAfter = null; f.restart = false; f.adv = false;
            /* the merged rows read right at once, whichever archive page they came from; then the sittings are read again */
            (f.sess || []).forEach(function (x) {
              if (ids.indexOf(x.matchId) >= 0) { x.onGame = true; x.struck = false; x.archive = { status: "merged", gameId: gid }; }
              else if ((r.strike || []).indexOf(x.matchId) >= 0) { x.onGame = false; x.struck = true; x.canMerge = false; }
            });
            act(D, (restart ? "Re-filed from " : "Merged ") + plural(ids.length, "1 sitting", "sittings") + (r2.held ? ", held" : ", final " + (HA(r2.score) && g ? scoreText(g.away, g.home, HA(r2.score).a, HA(r2.score).h) : r2.score)));
            loadClub(id, "main", f.before ? { keep: true } : { ea: false, keep: true });
            loadBox(id);
            refresh(id).then(function () { var n0 = $("#gdSitRes"); if (n0) landOn(n0); });
          }).catch(function (e2) { f.busy = null; f.err = e2.message; paintBar(); });
        } });
    }).catch(function (e) { f.busy = null; f.err = e.message; paintBar(); });
  }
  /* v4.37: record the Rule 4.6 substitution (set_game_club_substitution: statistics staff or a commissioner; its trigger
     refuses a club another league club owns, a club outside the fixture and a game already filed), then read again so the
     sittings read as that game's and come back ticked. This step files nothing itself; while the game window is open the
     importer may file the game on its own (it reads substitutions), which the confirm says. (CG._smMatchGo) */
  function matchGo() {
    var s = cur(); if (!s) return;
    var id = s.g.id, D = gd(id), f = D.find, m = f.match; if (!m || m.busy) return;
    var w = $("#gdMatchWhy"); if (w) m.why = w.value;
    var gr = groups(f.sess, f).filter(function (x) { return x.key === m.key; })[0];
    /* the list changed under the open panel (a reply moved these sittings): say so, never a silent no-op */
    if (!gr) { f.match = null; f.err = "The list changed while the panel was open. Open Match to a league game again."; paintSit(id); return; }
    var info = matchInfo(gr), mm = matchMap(info, m), why = String(m.why || "").trim();
    /* never disabled (the concept): a press with something missing says what, in place */
    m.err = !m.gameId ? "Pick the league game first." : mm && mm.err ? mm.err : !mm ? "Pick the club that played as " + info.unresolved[0].name + "." : why.length < 3 ? "Say why they could not use their own club (three letters or more)." : null;
    if (m.err) { paintParts(id, ["dkSit"]); var fe = $("#gdMatch .dk-err"); if (fe) landOn(fe); return; }
    var g = fxGame(mm.fx), G = fx(g);
    var pairs = Object.keys(mm.map).map(function (eid) { return { eaId: eid, code: mm.map[eid], name: (info.unresolved.filter(function (u) { return u.eaId === eid; })[0] || {}).name || "EA club " + eid }; });
    var said = pairs.map(function (p) { return teamName(p.code) + " played " + G + " (" + M.etDateTime(new Date(g.at)) + ") as " + p.name + "."; });
    confirmSheet({ title: "Record the substitution for " + G + "?", ok: "Record it",
      body: said.concat(["That EA club counts as that club in this one game and in no other (Rule 4.6).", "Nothing is filed by this step. While the game window is open, the league’s importer may file the game by itself within a few minutes; otherwise its sittings come back ticked under Sittings, ready to merge into the game."]).map(function (x) { return '<p class="t-sub">' + esc(x) + "</p>"; }).join(""),
      focus: function () { return $("#gdSitRes") || $("#gdMatch .dk-err") || $("#dkSitH"); },
      onOk: function () {
        m.busy = true; m.err = null; paintParts(id, ["dkSit"]);
        var done = [];
        pairs.reduce(function (p, x) {
          return p.then(function () {
            var tm = teamOf(x.code);
            if (!tm || !tm.id) throw new Error("No league club " + x.code + ".");
            return S2.write("set_game_club_substitution", { p_game: g.id, p_ea_club_id: x.eaId, p_team: tm.id, p_reason: why }).then(function (r) {
              if (!r || !r.data) throw new Error("The server did not confirm the substitution.");
              done.push(x);
            });
          });
        }, Promise.resolve()).then(function () {
          f.match = null; f.tickAfter = { gameId: g.id, ids: gr.sessions.map(function (x) { return x.matchId; }) };
          f.res = { kind: "sub", b: "Recorded.", text: said.join(" ") + " Its sittings now read as that game’s. Tick the ones that were this game (a restart or a second game is left for you to pick), then use the button to file it." };
          act(D, "Recorded a substitution: " + pairs.map(function (x) { return x.code + " as " + x.name; }).join(", ") + " (Rule 4.6)");
          reloadFor(id);
        }, function (e) {
          /* a second substitution that fails leaves the first on record: read again so the desk shows exactly that */
          m.busy = false; m.err = e.message + (done.length ? " (" + done.map(function (x) { return x.name + " as " + x.code; }).join(", ") + " was recorded.)" : "");
          if (done.length) { f.err = m.err; if (f.match === m) f.match = null; f.tickAfter = null; reloadFor(id); }
          else if (f.match === m) paintParts(id, ["dkSit"]);
          else { f.err = m.err; paintParts(id, ["dkSit"]); }
        });
      } });
  }
  function unsub(t) {
    var s = cur(); if (!s) return;
    var id = s.g.id, D = gd(id), f = D.find, ug = t.dataset.game, ue = t.dataset.ea, un = t.dataset.name || "EA club " + ue, ugm = game(ug);
    confirmSheet({ title: "Remove the substitution?", ok: "Remove it", danger: true,
      body: '<p class="t-sub">' + esc(un + " stops counting as a league club for " + (ugm ? fx(ugm) : "this game") + ". Its sittings go back to unmatched.") + "</p>",
      focus: function () { return $("#gdSitRes") || $("#gdSitErr") || $("#dkSitH"); },
      onOk: function () {
        S2.write("clear_game_club_substitution", { p_game: ug, p_ea_club_id: ue }).then(function () {
          f.res = { kind: "sub", b: "Removed.", text: un + " no longer counts for " + (ugm ? fx(ugm) : "that game") + "." }; f.picked = {}; f.tickAfter = null;
          act(D, "Removed the substitution of " + un);
          reloadFor(id);
        }, function (e) { f.err = e.message; paintParts(id, ["dkSit"]); });
      } });
  }
  /* v3.52 (commissioner, 2026-09-28): "Do not allow a staffer to undo any forfeits, if there is a mistake entered by staff,
     a commissioner must be notified to step in to fix the problem." Staff get this instead of a reversal: it rings every
     commissioner's bell, posts to the staff casework channel and writes the audit log. Nothing about the game changes.
     (CG.reportRulingPrompt) */
  function report(gid) {
    var g = game(gid), what = g ? (g.voided ? "the void" : g.forfeit ? "the forfeit against " + g.forfeit : g.status === "final" ? "the filed result" : "this game") : "this game";
    S2.confirm({ title: "Report a mistake" + (g ? ": " + fx(g) : ""), ok: "Send to the commissioners",
      why: "Only a commissioner can reverse or change a ruling. Say what is wrong with " + what + " and what it should have been; every commissioner is told at once.",
      html: '<label class="field"><span>What went wrong</span><textarea class="input" id="gdRrNote" rows="4" maxlength="1000" placeholder="e.g. I charged the forfeit to the wrong club: the away club did not show, not the home club."></textarea></label><p class="dk-err" id="gdRrErr" role="alert"></p>',
      onOk: function (sh) {
        var el = $("#gdRrNote"), note = (el && el.value || "").trim(), err = $("#gdRrErr"), okB = $('[data-cf="ok"]', sh.el);
        if (note.length < 10) { if (err) err.textContent = "Say what is wrong and what it should have been."; if (el) el.focus(); return false; }
        if (okB) { okB.disabled = true; okB.textContent = "Sending…"; }
        S2.write("report_ruling_mistake", { p_game: gid, p_note: note }).then(function () {
          sh.close(); S2.toast("Sent. The commissioners have it", "ok");
          var s = cur(); if (s && s.g.id === gid) { act(gd(gid), "Reported a mistake to the commissioners"); paintParts(gid, ["dkHist"]); }
        }, function (e) { if (err) err.textContent = e.message; if (okB) { okB.disabled = false; okB.textContent = "Send to the commissioners"; } });
        return false;
      } });
  }
  function ffGo() {
    var s = cur(); if (!s) return;
    var id = s.g.id, D = gd(id), F = D.ff, sg = sched(s.g); if (F.busy) return;
    var w = $("#gdFfWhy"); if (w) F.why = w.value;
    var kd = kinds(sg), kind = F.kind && kd[F.kind] && kd[F.kind].ok ? F.kind : kd.pre, code = F.who, tm = code && teamOf(code);
    F.err = !kind ? "Pick what happened." : !code ? "Pick the club." : !tm ? "The clubs could not be read: " + (TEAMS.err || "reload the page and try again.") : "";
    if (F.err) { paintRul(id); return; }
    var inv = involved(sg);
    confirmSheet({ title: "Rule a forfeit against " + code + "?", ok: "Rule the forfeit", danger: true,
      body: [ffWill(sg, kind, code), ffPosts(sg, kind), "Only a commissioner can undo a forfeit."].concat(inv ? ["This game involves your club (" + inv + ") (Rule 7.1)."] : []).map(function (x) { return '<p class="t-sub">' + esc(x) + "</p>"; }).join(""),
      focus: function () { return $("#gdFfRes") || $("#dkRulH"); },
      onOk: function () {
        F.busy = true; F.err = ""; paintRul(id);
        S2.write("forfeit_game", { p_game: id, p_forfeiting_team: tm.id, p_reason: F.why.trim() || null, p_keep_result: kind === "dc3" }, { sections: ["games", "box"], gameIds: [id] }).then(function (r) {
          F.busy = false;
          var d = r && r.data;
          if (!d || !d.ok) { F.err = "The server did not confirm the ruling. Check the game before trying again."; paintRul(id); return; }
          var wcode = (TEAMS.byId[d.winner] || {}).code || (code === sg.home ? sg.away : sg.home), sc = HA(d.score);
          var txt = d.kept_result ? fx(sg) + ": " + (sc ? scoreText(sg.away, sg.home, sc.a, sc.h) : "the played score") + " stands with every stat line, and " + code + " takes the forfeit loss."
            : fx(sg) + ": " + wcode + " wins 1-0 by forfeit (no-show).";
          F.res = { ok: true, b: "Forfeit ruled.", text: txt + (d.was_held ? " It was held; it is final now." : "") };
          F.open = false; F.kind = null; F.who = null; F.why = "";
          act(D, "Ruled a forfeit against " + code + (d.kept_result ? ", result kept" : ", no-show"));
          loadBox(id);
          repaintGame(["dkSB", "dkRes", "dkRul", "dkBox", "dkHist", "dkSit"]);
          var n0 = $("#gdFfRes"); if (n0) landOn(n0);
        }, function (e) { F.busy = false; F.err = e.message; paintRul(id); var e0 = $("#gdFfState .dk-err"); if (e0) landOn(e0); });
      } });
  }
  function paintRul(id) { if (typingIn() && $("#gdFfState")) { var s = cur(), F = gd(id).ff, sg = sched(s.g), kd = kinds(sg); $("#gdFfState").outerHTML = ffState(sg, F, F.kind && kd[F.kind] && kd[F.kind].ok ? F.kind : kd.pre); return; } paintParts(id, ["dkRul"]); }
  /* the reversal, a commissioner's alone (unforfeit_game, v3.52): the game goes back to scheduled, a Reversed line posts */
  function reverseForfeit() {
    var s = cur(); if (!s || !s.ruling) return;
    var id = s.g.id, D = gd(id), sg = sched(s.g), noIce = !s.ruling.kept;
    confirmSheet({ title: "Undo the forfeit on " + fx(sg) + "?", ok: "Undo the forfeit", danger: true,
      body: (noIce ? ["The game goes back to scheduled with no score, and a Reversed line posts in #game-scores."]
        : ["The game goes back to scheduled and its played score " + (sg.homeScore != null ? scoreText(sg.away, sg.home, sg.awayScore, sg.homeScore) + " " : "") + "is cleared too. A Reversed line posts in #game-scores. The game is then held until its sittings are filed again under Sittings."])
        .map(function (x) { return '<p class="t-sub">' + esc(x) + "</p>"; }).join(""),
      focus: function () { return $("#gdFfRes") || $("#dkRulH"); },
      onOk: function () {
        S2.write("unforfeit_game", { p_game: id }, { sections: ["games", "box"], gameIds: [id] }).then(function (r) {
          if (!r || !r.data || !r.data.ok) throw new Error("The server did not confirm the reversal. Check the game before trying again.");
          D.ff.res = { ok: true, b: "Forfeit undone.", text: fx(sg) + " is back to scheduled with no score. A Reversed line posts in #game-scores." };
          act(D, "Undid the forfeit against " + s.ruling.club);
          loadBox(id); enter(id);
          repaintGame(["dkSB", "dkRes", "dkRul", "dkBox", "dkHist"]);
          var n0 = $("#gdFfRes"); if (n0) landOn(n0);
        }).catch(function (e) { D.ff.res = { ok: false, text: e.message }; paintParts(id, ["dkRul"]); });
      } });
  }
  function openResEdit() {
    var s = cur(); if (!s) return;
    if (s.ruling && !commish()) { report(s.g.id); return; }
    gd(s.g.id).fix.err = ""; gd(s.g.id).fix.res = null;
    s.resEdit = { as: s.as, hs: s.hs, ot: s.ot }; repaintGame(["dkRes"]); var st0 = $('#dkRes [data-act="step"]'); if (st0) st0.focus();
  }
  /* v3.42: stats_game_set_result returns nothing, so the game row is read back before the desk says it worked (CG._smFixGo) */
  function saveResult() {
    var s = cur(); if (!s || !s.resEdit) return;
    var id = s.g.id, D = gd(id), e = s.resEdit, sg = sched(s.g); if (D.fix.busy) return;
    var chk = fixCheck(sg, { h: e.hs, a: e.as, ot: e.ot });
    if (!chk.ok) { D.fix.err = chk.msg; repaintGame(["dkRes"]); var e0 = $("#gdFixErr"); if (e0) landOn(e0); return; }
    D.fix.err = "";
    var hs = e.hs, as = e.as, ot = !!e.ot, was = scoreText(sg.away, sg.home, sg.awayScore, sg.homeScore) + (sg.ot ? " in overtime" : ""), nowT = scoreText(sg.away, sg.home, as, hs) + (ot ? " in overtime" : "");
    var scoreChanged = hs !== sg.homeScore || as !== sg.awayScore, inv = involved(sg);
    confirmSheet({ title: "Correct " + fx(sg) + "?", ok: "Correct the result",
      body: ["Now: " + was + ".", "After: " + nowT + ".", scoreChanged ? "A Corrected line posts in #game-scores." : "Only the overtime mark changes, so nothing is posted in #game-scores.",
        "The standings update at once." + (sg.stage === "playoff" ? " The playoff series updates too." : "")].concat(inv ? ["This game involves your club (" + inv + ") (Rule 7.1)."] : []).map(function (x) { return '<p class="t-sub">' + esc(x) + "</p>"; }).join(""),
      focus: function () { return $("#gdFixRes") || $("#dkResH"); },
      onOk: function () {
        D.fix.busy = true; repaintGame(["dkRes"]);
        S2.write("stats_game_set_result", { p_game: id, p_home: hs, p_away: as, p_final: true, p_ot: ot }, { sections: ["games", "box"], gameIds: [id] }).then(function () {
          return rd(function (c) { return c.from("games").select("status,home_score,away_score,went_ot").eq("id", id).maybeSingle(); }).then(function (row) {
            var good = row && row.status === "final" && row.home_score === hs && row.away_score === as && !!row.went_ot === ot;
            D.fix.res = good ? { ok: true, b: "Corrected.", text: fx(sg) + " now reads " + nowT + "." }
              : !row ? { ok: false, text: "The correction was sent, but the desk could not read " + fx(sg) + " back to confirm it. Check the game before trying again." }
              : { ok: false, text: "The correction did not save: " + fx(sg) + " still reads " + scoreText(sg.away, sg.home, row.away_score, row.home_score) + ". Nothing was posted. Try again, or tell a commissioner." };
            if (good) { s.resEdit = null; act(D, "Corrected the result to " + nowT); }
          }, function (e2) { D.fix.res = { ok: false, text: "The correction was sent, but the desk could not read " + fx(sg) + " back to confirm it (" + e2.message + "). Check the game before trying again." }; });
        }, function (e1) { D.fix.res = { ok: false, text: e1.message }; }).then(function () {
          D.fix.busy = false;
          repaintGame(["dkSB", "dkRes", "dkBox", "dkHist"]);
          var n0 = $("#gdFixRes"); if (n0) landOn(n0);
        });
      } });
  }

  /* ---------- the box-score editor: one cell at a time, through stats_game_row, confirmed by the row it returns ---------- */
  function editCell(td, seed) {
    if (!td || td.classList.contains("editing")) return;
    var p = td.dataset.cell.split("|"), s = cur(); if (!s) return;
    var B = boxLines(s); if (!B.live) return;
    var l = B.lines[p[0]][+p[1]], k = p[2], v = l[k];
    td.classList.add("editing");
    td.innerHTML = '<input class="dk-cell-in num" type="text" inputmode="' + (k === "pm" ? "text" : "numeric") + '" enterkeyhint="done" autocomplete="off" value="' + (seed != null ? seed : v) + '" aria-label="' + esc(l.tag + " " + LBL[k]) + '">';
    var inp = $("input", td), done = false; inp.focus(); if (seed == null) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
    function bad(msg) { inp.setAttribute("aria-invalid", "true"); inp.title = msg; var m = $("#dkBoxMsg"); if (m) { m.textContent = msg; m.classList.add("err"); } }
    function finish(commit, move) {
      if (done) return;
      var raw = inp.value.trim(), nv = parseInt(raw, 10);
      if (commit && raw !== String(v)) {
        if (!/^-?\d+$/.test(raw)) { bad("Numbers only. Esc cancels."); return; }
        if (k !== "pm" && nv < 0) { bad("This number can't be negative."); return; }
        if (Math.abs(nv) > 99) { bad("That is more than a game allows."); return; }
        if (k === "sv" && nv > l.sa) { bad("Saves can't be more than shots against (" + l.sa + ")."); return; }
        if (k === "sa" && nv < l.sv) { bad("Shots against can't be fewer than saves (" + l.sv + ")."); return; }
      }
      done = true;
      var next = move ? neighbor(td, move) : td, key = next ? next.dataset.cell : td.dataset.cell;
      if (commit && !isNaN(nv) && nv !== v) saveLine(s, l, k, v, nv, false);
      repaintGame(["dkBox"]);
      var t = $('[data-cell="' + key + '"]'); if (t) focusCell(t);
    }
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); finish(true, e.shiftKey ? "up" : "down"); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === "Tab") { e.preventDefault(); finish(true, e.shiftKey ? "left" : "right"); }
    });
    inp.addEventListener("blur", function () { setTimeout(function () { if (!done && document.activeElement !== inp) finish(true); }, 0); });
  }
  /* one change, queued behind the last so they land in order; the cell shows the league's number until the row the
     database returns says the new one. The History names the line by club and position, never by gamertag */
  function saveLine(s, l, k, from, to, undo) {
    var id = s.g.id, bx = gd(id).box, D = gd(id), what = l.club + " " + (l.goalie ? "goaltender" : l.pos || "skater") + ", " + LBL[k] + " " + from + " to " + to, patch = {};
    patch[COL[k]] = to;
    bx.pending++; bx.msg = "Saving: " + what + "…"; paintParts(id, ["dkBox"]);
    bx.q = bx.q.then(function () {
      return S2.write("stats_game_row", { p_row_id: l.id, p_game: id, p: patch }, { sections: ["box"], gameIds: [id] }).then(function (r) {
        var row = r && r.data;
        if (!row || row.id !== l.id || row[COL[k]] !== to) throw new Error("The league did not confirm the change. Reload the page to see the line as it stands.");
        (bx.rows || []).forEach(function (x, i) { if (x.id === row.id) bx.rows[i] = Object.assign({}, x, row); });
        if (undo) s.edits.pop(); else s.edits.push({ id: l.id, club: l.club, k: k, from: from, to: to, tag: l.club + " " + (l.goalie ? "goaltender" : l.pos || "skater") });
        act(D, (undo ? "Undid: " : "Box score: ") + what);
        bx.msg = "";
      }, function (e) { bx.msg = "Not saved: " + e.message; S2.toast("Not saved: " + e.message, "err"); });
    }).then(function () { bx.pending--; paintParts(id, ["dkBox", "dkHist"]); });
  }
  function focusCell(td) { $$(".dk-ed[tabindex='0']").forEach(function (x) { x.setAttribute("tabindex", "-1"); }); td.setAttribute("tabindex", "0"); td.focus({ preventScroll: false }); }
  function neighbor(td, dir) {
    var tr = td.parentNode, tbl = tr.closest("table"), cells = $$(".dk-ed", tr), ci = cells.indexOf(td);
    if (dir === "left" || dir === "right") return cells[ci + (dir === "right" ? 1 : -1)] || td;
    var rows = $$("tbody tr", tbl), ri = rows.indexOf(tr), nr = rows[ri + (dir === "down" ? 1 : -1)];
    return nr ? $$(".dk-ed", nr)[ci] || td : td;
  }
  function undoEdit() {
    var s = cur(); if (!s || !s.edits.length || gd(s.g.id).box.pending) return;
    var e = s.edits[s.edits.length - 1], l = (gd(s.g.id).box.rows || []).map(lineOf).filter(function (x) { return x.id === e.id; })[0];
    if (!l) return;
    s.club = e.club;
    saveLine(s, l, e.k, l[e.k], e.from, true);
  }

  /* =========================================================================================================== */
  /* EVENTS: this file's own controls ([data-gd]); desk.js routes the shared ones (res-*, step, ot, club, undo, cells) */
  /* =========================================================================================================== */
  function onGd(t) {
    var s = cur(), a = t.dataset.gd; if (!s && a !== "imp-retry") return;
    var id = s && s.g.id, D = s && gd(id), f = D && D.find;
    switch (a) {
      case "go": go(); break;
      case "clear": f.picked = {}; f.tickAfter = null; f.restart = false; f.adv = false; f.err = null; paintParts(id, ["dkSit"]); break;
      case "retry": enter(id); break;
      case "ea-again": if (f.match) f.match = null; if (f.main) loadEa(id, "main", f.main.seq, null); break;
      case "switch":
        var other = f.main && (f.main.team === s.g.home ? s.g.away : s.g.home), ot = other && teamOf(other);
        if (!ot || !ot.ea) break;
        f.main = { eaId: ot.ea, name: teamName(ot.code), team: ot.code, seq: f.main.seq + 1, ea: null, loadErr: null, loaded: false };
        f.picked = {}; f.tickAfter = null; f.res = null; f.err = null;
        loadClub(id, "main", { ea: !f.before });
        break;
      case "move": f.moved[t.dataset.match] = t.dataset.to; delete f.picked[t.dataset.match]; f.tickAfter = null; paintParts(id, ["dkSit"]); break;
      case "m-open":
        if (f.busy) break;   /* not while a merge is in flight: its reload would close the panel under the typing */
        var mk = t.dataset.key, mg = groups(f.sess, f).filter(function (x) { return x.key === mk; })[0];
        var cands = mg ? matchInfo(mg).cands : [], only = cands.filter(function (c) { return c.inWindow; });
        var pre = cands.some(function (c) { return c.gameId === id; }) ? id : only.length === 1 ? only[0].gameId : null;
        f.match = { key: mk, gameId: pre, side: null, why: "", busy: false, err: null };
        paintParts(id, ["dkSit"]); var mq = $("#gdMatchQ"); if (mq) mq.focus({ preventScroll: true });
        break;
      case "m-side": if (f.match) { var mw = $("#gdMatchWhy"); if (mw) f.match.why = mw.value; f.match.side = t.dataset.club; f.match.err = null; paintParts(id, ["dkSit"]); var sb = $('#gdMatch [data-club="' + t.dataset.club + '"]'); if (sb) sb.focus(); } break;
      case "m-cancel":
        var ck = f.match && f.match.key; f.match = null; paintParts(id, ["dkSit"]);
        /* Cancel removes the panel and the button it was on: focus goes back to the group's Match button */
        var mb = $$('#dkSit [data-gd="m-open"]').filter(function (el) { return el.dataset.key === ck; })[0]; if (mb) mb.focus({ preventScroll: true });
        break;
      case "m-go": matchGo(); break;
      case "unsub": unsub(t); break;
      case "report": report(t.dataset.game || id); break;
      case "ea-club":
        var c = D.search.clubs && D.search.clubs[+t.dataset.i]; if (!c) break;
        var lt = TEAMS.byEa[String(c.clubId)];
        f.extra = { eaId: String(c.clubId), name: c.name || "EA club " + c.clubId, team: lt ? lt.code : null, seq: f.extra ? f.extra.seq + 1 : 0, ea: null, loadErr: null, loaded: false };
        loadClub(id, "extra", { keep: true, ea: !f.before });
        paintParts(id, ["dkEa"]);
        break;
      case "ff-open": D.ff.open = true; D.ff.err = ""; D.ff.res = null; paintParts(id, ["dkRul"]); var k0 = $('#dkRul input[name="gdFfKind"]:not(:disabled)'); if (k0) k0.focus(); break;
      case "ff-cancel": D.ff.open = false; D.ff.err = ""; paintParts(id, ["dkRul"]); landOn($('#dkRul [data-gd="ff-open"]')); break;
      case "ff-who": var fw = $("#gdFfWhy"); if (fw) D.ff.why = fw.value; D.ff.who = t.dataset.club; D.ff.err = ""; paintParts(id, ["dkRul"]); var wb = $('#dkRul [data-gd="ff-who"][data-club="' + t.dataset.club + '"]'); if (wb) wb.focus(); break;
      case "ff-go": ffGo(); break;
      case "ff-undo": reverseForfeit(); break;
      case "imp-retry": IMP.err = null; IMP.rows = null; var gw = $("#dkGWrap"); if (gw) gw.innerHTML = gameList("imports"); break;
    }
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-gd]");
    if (!t || !t.closest("#dk") || t.disabled || t.getAttribute("aria-busy") === "true") return;
    e.preventDefault(); onGd(t);
  });
  document.addEventListener("change", function (e) {
    var t = e.target, s = cur(); if (!s || !t.closest || !t.closest("#dk")) return;
    var id = s.g.id, D = gd(id), f = D.find;
    if (t.name === "gdSit") {
      /* the staffer's own tick or untick ends the automatic ticks: a later reply never re-ticks what they cleared */
      f.picked[t.value] = t.checked; t.defaultChecked = t.checked; f.err = null; f.tickAfter = null;
      var sel = selection(f, groups(f.sess, f));
      if (!sel.restartable || !sel.ticked.length) f.restart = false;
      paintParts(id, ["dkSit"]);
    } else if (t.id === "gdRestart") {
      f.restart = t.checked; f.adv = true; t.defaultChecked = t.checked; f.tickAfter = null;
      if (f.restart) { var s2 = selection(f, groups(f.sess, f)); if (s2.one) s2.one.sessions.forEach(function (x) { if (x.onGame) delete f.picked[x.matchId]; }); }
      paintParts(id, ["dkSit"]);
    } else if (t.name === "gdFfKind") { var fw = $("#gdFfWhy"); if (fw) D.ff.why = fw.value; D.ff.kind = t.value; D.ff.err = ""; paintParts(id, ["dkRul"]); }
    else if (t.name === "gdMatchGame" && f.match) { var mw = $("#gdMatchWhy"); if (mw) f.match.why = mw.value; f.match.gameId = t.value; f.match.side = null; f.match.err = null; paintParts(id, ["dkSit"]); }
  });
  document.addEventListener("input", function (e) {
    var t = e.target, s = cur(); if (!s) return;
    var D = gd(s.g.id);
    if (t.id === "gdMatchWhy" && D.find.match) D.find.match.why = t.value;
    else if (t.id === "gdFfWhy") D.ff.why = t.value;
    else if (t.id === "dkEaQ") D.search.q = t.value;
  });
  document.addEventListener("toggle", function (e) { var s = cur(); if (s && e.target && e.target.id === "gdAdv") gd(s.g.id).find.adv = e.target.open; }, true);
  /* the league pulse (js/live.js): a box score that changed for the fixture on screen is read again (one Supabase read, never
     a Netlify call: the sittings are read again only when the staffer asks, so game night adds no load there) */
  if (S2.live && S2.live.on) S2.live.on("stats", function (p) {
    var s = cur(); if (!s) return;
    var id = s.g.id; if (p && p.gameIds && p.gameIds.indexOf(id) < 0) return;
    if (!gd(id).box.pending) loadBox(id);
  });
  /* a reply that came in while the staffer typed is drawn when they leave the field */
  document.addEventListener("focusout", function () { setTimeout(function () { var s = cur(); if (s && gd(s.g.id).owed && !typingIn()) paintSit(s.g.id); }, 0); });

  /* what js/pages/desk.js uses from this file, looked up by name when called; pure: the ported helpers, for the port test */
  S2._gamedesk = { clearImport: clearImport, eaSearch: eaSearch, editCell: editCell, focusCell: focusCell, gameList: gameList,
    neighbor: neighbor, openResEdit: openResEdit, paneGame: paneGame, paneGames: paneGames, repaintGame: repaintGame,
    reverseForfeit: reverseForfeit, saveResult: saveResult, undoEdit: undoEdit, waiting: waiting,
    pure: { sched: sched, kinds: kinds, ffPosts: ffPosts, ffWill: ffWill, fixCheck: fixCheck, union: union, withMerge: withMerge, groups: groups,
      selection: selection, matchInfo: matchInfo, matchMap: matchMap, lengthText: lengthText, sitScore: sitScore, bar: bar, applyTicks: applyTicks, dropTicks: dropTicks } };
})();
