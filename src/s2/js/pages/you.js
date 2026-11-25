/* #/you, the personal tab (Your week, Your season, Inbox, Applications, Settings) and the guest's join page: moved
   whole from js/pages/hq.js by the e0 split (2026-11-24), with no change in behavior. Every statement below the imports
   is hq.js's own, byte for byte. It loads after hq.js and js/inbox.js, reads their pieces from S2._hq and S2._inbox,
   and hq.js (the shared workspace frame and its dispatcher) reaches the functions here through S2._you.
   v5.00 swap (e3, 2026-11-24): THE REAL YOU. On the real site (the role is S2.session's, also under j1's page mock) this is the
   signed-in member's own page and every action is a database door, ported from the current site (src/live part_live.js
   CG.availSave, CG.renderDiscordAccounts, CG.switchDiscordAccount, the Settings profile save, CG.saveMyJersey, CG.signOut):
     availability       S2.lineups.saveAvailability (js/pages/lineups.js, e2): the ONE writer; the member's own answers are
                        read back by S2.lineups.loadMine and myAnswer (av, 2026-11-24), never from the club's roster read
     Discord accounts   S2.discordAccounts, S2.linkDiscord, S2.takeDiscordSwitch (js/live.js, f), switch_discord_account
     league profile     profiles.update (the four columns the current site lets a member edit) and set_my_jersey_number
     applications       read and withdrawn through S2.forms (js/flows.js, e5); the forms themselves are e5's (data-flow)
     sign-up            read from the model (M.player(id).signup); the form is e5's
     sign in and out    S2.signIn, S2.signOut (js/live.js)
   Nothing shows as saved until the database confirms it; a refusal is shown in the database's own words and what was
   chosen or typed stays on screen; every repaint is in place (a row, a group, a form's hint), never the router.
   v5.00 swap (i3c, 2026-11-25): demo mode is gone. This page runs only its real path; the placeholder persona, the sample
   applications, the pretend Discord accounts and the note box that saved nothing went with it. */
(function () {
  "use strict";
  var S2 = window.S2;
  if (!S2 || !S2.page) return;
  var HQ = S2._hq;
  var M = HQ.M, ST = HQ.ST, after = HQ.after, atGroup = HQ.atGroup, byNight = HQ.byNight,
    cal = HQ.cal, calText = HQ.calText, cd = HQ.cd, clock = HQ.clock, club = HQ.club, clubGames = HQ.clubGames,
    dateBlock = HQ.dateBlock, dueOf = HQ.dueOf, empty = HQ.empty, esc = HQ.esc, fail = HQ.fail, floorOf = HQ.floorOf,
    frame = HQ.frame, head = HQ.head, hqMeta = HQ.hqMeta,
    inkAttrs = HQ.inkAttrs, iso = HQ.iso, limitOf = HQ.limitOf, lockState = HQ.lockState, luStatus = HQ.luStatus,
    mark = HQ.mark, navRow = HQ.navRow, noYear = HQ.noYear, now = HQ.now, opp = HQ.opp,
    pinFoot = HQ.pinFoot, plural = HQ.plural, refreshNav = HQ.refreshNav, repaint = HQ.repaint,
    sheet = HQ.sheet, soft = HQ.soft, squadOf = HQ.squadOf, stamp = HQ.stamp,
    tabName = HQ.tabName, tag = HQ.tag, tbc = HQ.tbc, team = HQ.team, timeHtml = HQ.timeHtml, valid = HQ.valid,
    vs = HQ.vs, vsHtml = HQ.vsHtml, weekGames = HQ.weekGames, youTabs = HQ.youTabs;
  var INBOX = S2._inbox;
  var KIND = INBOX.KIND, inbox = INBOX.inbox, isRead = INBOX.isRead, paneInbox = INBOX.paneInbox;

  /* ---------- who You is about ---------- */
  /* the member: their own player in the season on screen, else a bare record from their profile (a member with no sign-up,
     roster spot or line this season is still a member) */
  function self() {
    var s = S2.session || {};
    if ((s.profileId || null) !== WHO) forget(s.profileId || null);
    if (!s.profileId) return null;
    var p = M.player(s.profileId); if (p) return p;
    var a = (S2.auth && S2.auth.profile) || {};
    return { id: s.profileId, tag: a.gamertag || a.display_name || "Member", href: "#/player/" + s.profileId, club: null, rostered: false, former: false,
      lines: { S: null, G: null }, roles: [], pos: null, posName: null, unit: null, group: null, ovr: null, signup: null, num: null };
  }
  /* what this page read and holds belongs to one member: a sign-out or another sign-in in the same tab starts it over (the
     next look at Your week reads the club again, and S2.lineups keeps the member's own answers per member) */
  var WHO = null;
  function forget(id) {
    WHO = id;
    YW = { q: Promise.resolve(), busy: {}, unsaved: {}, at: 0 };
    PF = { state: "idle", row: null, err: null, busy: false, worn: undefined };
    DC = { state: "idle", data: null, err: null, busy: null, msg: "", at: 0 };
    AP = { state: "idle", owner: null, staff: null, err: null, at: 0 };
    Object.keys(ST.late).forEach(function (k) { delete ST.late[k]; });
  }
  /* the club whose games the member answers: the one they are rostered on (a line from a club they left is not their week) */
  function homeOf(p) { return p && p.rostered ? p.club : null; }
  /* the season on screen by name ("Season 2"), never a fixed "Season 1" */
  function sn() { return (M.view && M.view.name) || "Season"; }

  /* =====================================================================================================================
     YOU
     ===================================================================================================================== */
  function youMeta() {
    var p = self();
    if (!p) return {};
    var wk = weekGames(homeOf(p)), open = wk.filter(function (g) { return !answerOf(p, g); }).length, unread = inbox(p).filter(function (i) { return !isRead(i); }).length, fl = floorOf(p);
    var reading = wk.length && myRead(p) !== "ready";   /* no count until the answers are read */
    return {
      week: reading ? { badge: "", sub: plural(wk.length, "game") + " this week" } :
        { badge: open || "", badgeLabel: plural(open, "game") + " without an answer", sub: wk.length ? (open ? plural(open, "game") + " to answer by " + M.etDate(iso(dueOf(wk))).split(",")[0] + " " + clock(dueOf(wk)) : "Every game answered") : "No games this week" },
      season: { sub: fl.floor ? Math.min(fl.gp, fl.floor) + " of " + fl.floor + " games" + atGroup(fl) + " toward the playoff floor" : "No games required for the playoff floor" },
      inbox: { badge: unread || "", badgeLabel: plural(unread, "unread item"), sub: unread ? plural(unread, "unread item") : "All caught up" },
      applications: { sub: appSub() },
      settings: { sub: "Appearance, Discord and sign out" }
    };
  }
  /* each workspace's line and count, ONE source for the You page's Workspaces list and the header's Workspaces menu
     (header v2, js/core.js S2.NAV) */
  function wsInfo(id) {
    if (id === "hq") { var m = hqMeta(club()), n = (+m.overview.badge || 0) + (+m.lineups.badge || 0); return { sub: team(club()).full + " front office", n: n, label: plural(n, "item") + " waiting" }; }
    if (id === "desk") { var oc = (M.desk && M.desk.cases && M.desk.cases.open) || 0; return { sub: "Cases, games, applications and people", n: oc, label: plural(oc, "open case") }; }   /* M.desk is {} in a manager's copy */
    return { sub: "Season setup, growth, tonight and the system", n: 0, label: "" };
  }
  /* IA: on a phone the workspaces a person holds are reached from You (the header's Workspaces menu lists them too) */
  function workspaces() {
    var rows = S2.WORKSPACES.filter(function (w) { return S2.has(w[2]); }); if (!rows.length) return "";
    return '<div><h3 class="hqx-group-h hqx-more-h">Workspaces</h3><div class="hqx-nav hqx-wsl">' + rows.map(function (w) {
      var i = wsInfo(w[0]); return navRow("#/" + w[0], w[1], i.sub, i.n, i.label, false);
    }).join("") + "</div></div>";
  }
  S2.WORKSPACES.forEach(function (w) { S2.nav.info[w[0]] = function () { return wsInfo(w[0]); }; });
  /* who the season is about: crest, the member's name, position and the headline rating, set as a line on the page, not
     a card */
  function youSummary(p) {
    var where = p.rostered ? team(p.club).full + " · " + (squadOf(p) === "tc" ? "Training camp" : "Active roster") : unrostered(p).where;
    return '<div class="hqx-who">' + (p.rostered ? M.crest(p.club, "lg") : "") + '<span class="grow"><span class="hqx-who-n"><span class="d-3 hqx-who-t">' + esc(p.tag) + "</span>" + '</span><span class="t-foot">' +
      esc([p.posName, where].filter(Boolean).join(" · ")) + "</span></span>" +
      (p.ovr ? '<span class="hqx-ovr"><b class="d-num">' + p.ovr.ovr + "</b><small>OVR</small></span>" : "") + "</div>";
  }
  /* the borrowed line off every roster: Season 2 has no free agents (commissioner, 2026-11-02: "Any team can pick up a
     player placed on waivers up to 24 hours after they have been waived"), so a waived player is on waivers, then in the
     training camp pool (review 2026-11-02: this read "Free agent (Rule 2.2)", which Season 2 does not have) */
  /* shortcut: a member in their 24 hours on waivers reads the pool line too (the model carries no waiver row); read b4's
     live market (S2.market.waiver) here when a member is to see it */
  /* QA function 29 (2026-11-25): from Season 2 on a member off every roster is not idle. Before the draft no club has a
     roster yet; after it, a signed-up member is in the training camp pool, where a club requests them one game at a time
     and they accept or decline each on the site (Rule S2.5). The plain line stays for a season without the pool, and for a
     member who has not signed up for the season on screen */
  function unrostered(p) {
    var su = p && p.signup, signed = !!su && su.status !== "declined" && su.status !== "withdrawn", st = M.draft && M.draft.state, done = !!st && st.status === "complete";
    if (M.view.season >= 2 && signed && !done) return { where: "Not on a roster yet", say: "Rosters are built at the draft" + (cal(M.view.season, "draft_at") ? ", " + calText(M.view.season, "draft_at") : "") + " (Rule S2.3)." };
    if (M.view.season >= 2 && signed) return { where: "Training camp pool", say: "You are in the training camp pool: clubs can request you for single games, and you accept or decline each on the site (Rule S2.5)." };
    return { where: "Not on a roster", say: "You are not on a club's roster right now, so you play no games until one adds you." };
  }
  function youHtml(r) {
    var p = self();
    if (!p) return '<div class="page-head hqx-head"><h1 class="d-1">You</h1></div>' + empty("No season to show yet", "Your games, season and inbox appear here once you are on a club's roster.");
    /* privacy, every width: the gamertag line lives in Your season (and the tag in Settings), never in the head or the list
       beside the applications, the inbox or the staff workspaces */
    var wk = weekGames(homeOf(p));
    return frame("you", r, youTabs(), {
      title: "You", kicker: wk.length ? sn() + " · Week " + wk[0].week : sn(), sub: "Your games, your season and your messages, in one place.", meta: youMeta(p), more: workspaces(),
      pane: function (t) { return ({ week: paneWeek, season: paneSeason, inbox: paneInbox, applications: paneApps, settings: paneSettings })[t](p); }
    });
  }

  /* ---- Your week: one tap per game (pressed look on pointer-down, answer on release, so a scroll that starts on a
     button never records one; Rule 5.1). The club's sheets are read through S2.lineups.load (RLS lets a member read their own club's
     rows), the member's own answers through S2.lineups.loadMine (av, 2026-11-24: the club read lists only the club's
     roster, so a member it did not list saw no answers, even after saving), and each answer goes through
     S2.lineups.saveAvailability, the one availability writer ---- */
  var YW = { q: Promise.resolve(), busy: {}, unsaved: {}, at: 0 };
  /* the state of the lineups read for this club: idle (never read, or another club's), loading, ready or error */
  function luRead(code) { var st = S2.lineups && S2.lineups.state(); return st && code && st.code === code ? st.state : "idle"; }
  function luErr() { var st = S2.lineups && S2.lineups.state(); return (st && st.error) || "The league did not answer."; }
  /* the member's own answers (S2.lineups.loadMine): the week keys of their club's games, and the state of that read */
  function myKeys(p) { return S2.lineups ? weekGames(homeOf(p)).map(S2.lineups.weekKey) : []; }
  function myRead(p) { return S2.lineups ? S2.lineups.mineState(myKeys(p)).state : "idle"; }
  function myErr(p) { return (S2.lineups && S2.lineups.mineState(myKeys(p)).error) || "The league did not answer."; }
  /* Your week is read once both are: the member's answers and the club's sheets */
  function weekRead(p) {
    var a = myRead(p), b = luRead(homeOf(p));
    return a === "error" || b === "error" ? "error" : a === "ready" && b === "ready" ? "ready" : a === "loading" || b === "loading" ? "loading" : "idle";
  }
  /* the member's answer for a game: the database's, once read */
  function answerOf(p, g) { return myRead(p) === "ready" ? S2.lineups.myAnswer(g) || null : null; }
  function paneWeek(p) {
    if (!homeOf(p)) return empty("No club games for you yet", unrostered(p).say);
    return '<div class="hqx-stack" data-w="yweek">' + weekInner(p) + "</div>";
  }
  function weekInner(p) {
    var code = homeOf(p), wk = weekGames(code), st = weekRead(p), mine = myRead(p) === "error";
    if (!wk.length) return empty("No games this week", "Your club has no games on the schedule. The next week appears here once it is built.");
    var top = !S2.lineups ? '<div class="hqx-callout" role="alert"><p class="t-sub hqx-ink"><b>Your answers cannot be read.</b> Team HQ\'s lineups (js/pages/lineups.js) did not load. Reload the page.</p></div>' :
      st === "error" ? '<div class="hqx-callout" role="alert"><p class="t-sub hqx-ink"><b>' + (mine ? "Your answers could not be read." : "Your club's lineups could not be read.") + "</b> " + esc(mine ? myErr(p) : luErr()) + '</p><div class="hqx-actions"><button class="btn secondary sm" data-ya="lu-reload">Try again</button></div></div>' :
      st !== "ready" ? '<p class="t-sub yx-wait" aria-live="polite">Reading your answers and your club\'s lineups…</p>' : '<div data-w="due">' + dueInner(p) + "</div>";
    return top + byNight(wk).map(function (n) { return nightHtml(p, n); }).join("");
  }
  /* read the member's answers and the club's week when Your week is on screen: once, and again after a minute (the pulse
     re-reads the club for a roster, score or camp change in between, js/pages/lineups.js); each read's failure is its
     state, drawn by weekInner */
  function ensureWeek() {
    var p = self(), code = homeOf(p); if (!code || !weekGames(code).length || !S2.lineups) return;
    var st = weekRead(p);
    if (st === "loading" || (st === "ready" && Date.now() - YW.at < 60000)) return;
    YW.at = Date.now();
    S2.lineups.loadMine(myKeys(p)).then(paintWeek, paintWeek);
    S2.lineups.load(code).then(paintWeek, paintWeek);
    paintWeek();
  }
  function paintWeek() { var p = self(); if (p && S2.$('[data-w="yweek"]')) repaint("yweek", function () { return weekInner(p); }); refreshNav(); }
  function gameOf(gid) { return M.games.filter(function (g) { return g.id === gid; })[0] || null; }
  function paintGame(gid) { var p = self(), g = gameOf(gid); if (p && g) repaint("yg-" + gid, function () { return gameInner(p, g); }); }
  /* one answer: shown as saving, never as chosen, until the database confirms it; a refusal keeps the choice on the row with
     the database's words and Try again. One at a time: each save sends the member's whole week row (the current site's
     shape), so two at once would each carry the week without the other's answer */
  function setAvail(gid, v) {
    var p = self(), g = gameOf(gid);
    if (!p || !g || homeOf(p) !== g.home && homeOf(p) !== g.away) return Promise.reject(new Error("That game is not on your club's schedule."));
    if (YW.busy[gid]) return YW.q;
    if (!YW.unsaved[gid] && answerOf(p, g) === v) return Promise.resolve(false);
    YW.busy[gid] = v; delete YW.unsaved[gid]; paintGame(gid);
    var run = YW.q.then(function () {
      if (!S2.lineups) throw new Error("Availability cannot be saved: Team HQ's lineups (js/pages/lineups.js) did not load. Reload the page.");
      return S2.lineups.saveAvailability(gid, v);
    }).then(function (res) {
      delete YW.busy[gid];
      /* QA nits 35 (2026-11-25): the late mark is the database's, never this tab's clock. stamp_availability marks the
         week row late on an answer after the week's deadline (staff exempt) and never clears it, so a confirmed row that
         comes back late means this answer came after the deadline. The row knows only its week: after a reload the week's
         head says the week is late (dueInner, S2.lineups.myLate), and this per-game mark is this tab's record of the game
         answered late */
      var row = res && res.data && res.data[0];
      if (row && row.late && !S2.session.isStaff && !S2.session.isCommissioner) ST.late[gid] = true;
      paintGame(gid);
      if (S2.$('[data-w="due"]')) repaint("due", function () { return dueInner(p); });
      refreshNav();
      document.dispatchEvent(new CustomEvent("s2:avail", { detail: { gid: gid, value: v, late: !!ST.late[gid] } }));
      return true;
    }, function (e) {
      delete YW.busy[gid];
      YW.unsaved[gid] = { v: v, msg: (e && e.message) || "The league did not save that." };
      console.warn("You: an availability answer was refused", e);
      paintGame(gid);
      S2.toast("Not saved: " + YW.unsaved[gid].msg, "err");
      return false;
    });
    YW.q = run;
    return run;
  }
  /* Available for the rest: every game still without an answer, one save after another */
  function restYes() {
    var p = self(); if (!p) return 0;
    var todo = weekGames(homeOf(p)).filter(function (g) { return !answerOf(p, g) && !YW.busy[g.id]; });
    todo.forEach(function (g) { setAvail(g.id, "yes"); });
    return todo.length;
  }
  /* the window: the headline says how many games still need an answer; the countdown is the big number */
  function dueInner() {
    var p = self(), wk = weekGames(homeOf(p)), due = dueOf(wk), t = now(), n = wk.filter(function (g) { return answerOf(p, g); }).length, closed = t >= due, open = wk.length - n;
    var h = open ? plural(open, "game") + " to answer" : "Every game answered", late = S2.lineups && S2.lineups.myLate ? S2.lineups.myLate(wk[0]) : null;
    return '<section class="hqx-block hqx-due">' + head({ k: "Week " + wk[0].week + " availability", h: esc(h),
        p: (closed ? "The window closed " + esc(stamp(due)) + ". An answer now is marked late (Rule 5.1)." : "Due " + esc(stamp(due)) + ". After that, an answer is marked late (Rule 5.1).") +
          (late ? " Your answers for this week are on file as late." : ""),
        side: '<div class="hqx-cd">' + (closed ? '<b class="d-num">Closed</b>' : cd(due, "Closed", "d-num")) + '<span>' + (closed ? "answers are late" : "until the window closes") + "</span></div>" }) +
      '<div class="hqx-due-r"><div class="hqx-meter" role="img" aria-label="' + n + " of " + wk.length + ' games answered"><i style="width:' + (n / wk.length * 100).toFixed(1) + '%"></i></div>' +
        '<span class="t-foot"><b class="num hqx-ink">' + n + "</b> of " + wk.length + " games answered</span>" +
        (n < wk.length ? '<button class="btn secondary sm" data-ya="all-yes">Available for the rest</button>' : tag("win", "All answered")) + "</div></section>";
  }
  /* one night: the date block on the left (Juventus), its games as a list you answer in place */
  function nightHtml(p, n) {
    return '<section class="hqx-night" aria-label="' + esc(n.label) + '">' + dateBlock(n.games[0].at) + '<div class="list hqx-list">' +
      n.games.map(function (g) { return gameRow(p, g); }).join("") +
      /* shortcut: no night note yet; the current site keeps it in the week row (nights.nK.note) and
         S2.lineups.saveAvailability does not carry one (asked of e2). A box that saved nothing would be a lie */
      "</div></section>";
  }
  /* the row itself is the repaint target (yg-<game>) */
  function gameRow(p, g) { return '<div class="row hqx-g" data-g="' + g.id + '" data-w="yg-' + g.id + '">' + gameInner(p, g) + "</div>"; }
  function gameInner(p, g) {
    var code = homeOf(p), a = answerOf(p, g) || "", label = esc(g.date + " " + g.time + " " + vs(g, code));
    var st = luRead(code), busy = YW.busy[g.id], uns = YW.unsaved[g.id], off = !!busy || weekRead(p) !== "ready";
    var lu = st === "ready" ? luStatus(p, g) : st === "error" ? "Lineup not read" : "Reading the lineup…";
    var b = function (v, icon, word) {
      return '<button class="hqx-av-b ' + v + (uns && uns.v === v ? " is-unsaved" : "") + (busy === v ? " is-saving" : "") + '" data-av="' + v + '" data-g="' + g.id + '" aria-pressed="' + (a === v) + '"' + (off ? " disabled" : "") + ">" + S2.ic(icon) + word + "</button>";
    };
    return timeHtml(g) + M.crest(opp(g, code)) +
      '<div class="grow"><div class="title">' + vsHtml(g, code) + '</div><div class="sub"><span>' + esc(lu) + "</span>" + (ST.late[g.id] ? " " + tag("warn", "Late") : "") + "</div>" +
      '<p class="t-foot yx-av-say" aria-live="polite">' + (busy ? "Saving " + (busy === "yes" ? "Available" : "Not available") + "…" :
        uns ? '<span class="yx-uns">Not saved: ' + esc(uns.msg) + '</span> <button class="btn secondary sm" data-ya="av-retry" data-g="' + g.id + '" data-v="' + uns.v + '">Try again</button>' : "") + "</p></div>" +
      '<div class="hqx-av" role="group" aria-label="Availability, ' + label + '"' + (busy ? ' aria-busy="true"' : "") + ">" + b("yes", "check", "Available") + b("no", "x", "Not available") + "</div>";
  }
  /* the ONE availability door, read by Team HQ and You, Your week, and by S2.mine (today.js) for who the member is (audit
     2026-11-09: the most used member action on the live site, so it answered from the home page too; commissioner
     2026-11-14: Today now carries only a shortcut to Your week). me() is the signed-in member (null signed out), answers
     are the database's, and set() resolves once the database confirms (false when it refused: the row says why) */
  S2.availability = {
    me: function () { return self(); },
    week: function () {
      var p = self(); if (!p) return [];
      return weekGames(homeOf(p)).map(function (g) { return { game: g, answer: answerOf(p, g), late: !!ST.late[g.id], lock: lockState(g, now()) }; });
    },
    due: function () { var p = self(); return p ? dueOf(weekGames(homeOf(p))) : null; },
    now: function () { return now(); },
    set: function (gid, v) { if (v !== "yes" && v !== "no") throw new Error("S2.availability.set: answer is yes or no"); return setAvail(gid, v); },
    /* commissioner, 2026-11-09: "an easy 1 button way to mark yourself available for every game night of the week" */
    setAll: function (v) { var n = 0; S2.availability.week().forEach(function (x) { if (x.answer !== v) { setAvail(x.game.id, v); n++; } }); return n; },
    on: function (fn) { var h = function (e) { fn(e.detail); }; document.addEventListener("s2:avail", h); return function () { document.removeEventListener("s2:avail", h); }; }
  };

  /* ---- Your season: sign-up checklist, playoff-floor ring, last three games, the season line ---- */
  function paneSeason(p) {
    var fl = floorOf(p), gp = fl.gp, need = Math.max(0, fl.floor - gp), t = team(p.club), lim = limitOf(p), perWeek = {};
    var ahead = clubGames(p.club).filter(function (g) { return g.state === "upcoming" && g.stage === "regular"; }), leftG = ahead.length;
    /* Rule 5.2 caps every week, so the most a player can still add is, week by week, the fewer of that week's games and
       the weekly limit of the squad they are on today */
    ahead.forEach(function (g) { perWeek[g.week] = (perWeek[g.week] || 0) + 1; });
    /* Season 2 has no weekly limit (Rule S2.7, commissioner 2026-11-17): limitOf is Infinity from Season 2 on, so every
       club game is within reach */
    var reach = Object.keys(perWeek).reduce(function (a, w) { return a + Math.min(perWeek[w], lim); }, 0), limWords = "Rule 5.2: " + (lim === 3 ? "three a week in training camp" : "six a week on the active roster");
    var ring = S2.charts.rings({ size: 168, stroke: 16, label: fl.floor ? "Playoff floor: " + gp + " of " + fl.floor + " games" : "Playoff floor: none required",
      rings: [{ value: fl.floor ? Math.min(1, gp / fl.floor) : 1, color: "var(--accent)", label: "Playoff floor", text: fl.floor ? gp + " of " + fl.floor : gp + " played" }] });
    var head_ = !fl.floor ? "No games required" : need ? need + " more " + (need === 1 ? "game" : "games") + atGroup(fl) + " to be playoff-eligible" : "Playoff-eligible on games played";
    var sub = !p.rostered ? unrostered(p).say :
      !fl.floor ? "You were placed on " + fl.since + " with " + plural(fl.leftAtPlacement, "game") + " left, so the prorated floor is zero (Rule 8.3). You must still be on the roster at the movement deadline and not suspended." :
      need ? (leftG < need ? t.city + " has only " + plural(leftG, "regular-season game") + " left, fewer than the " + need + " you need." :
        reach < need ? "You can play at most " + reach + " more (" + limWords + "), fewer than the " + need + " you need." :
        t.city + " has " + leftG + " regular-season games left" + (reach < leftG ? " and you may play up to " + reach + " of them (" + limWords + ")" : "") + ", so the floor is within reach.") :
      "You have played the " + fl.floor + " games" + atGroup(fl) + " the floor asks for. You must also be on the roster at the movement deadline and not suspended.";
    /* any position on any night, but only games at the signed-up group count toward the floor (2026-11-24) */
    sub += fl.floor ? " Only games" + atGroup(fl) + ", the position group you signed up for, count toward it; a night elsewhere still counts for your statistics." : "";
    var logs = (p.roles || ["S"]).reduce(function (a, role) { return a.concat(M.log(p.id, role)); }, []).sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); }).slice(-3).reverse();
    return '<div class="hqx-stack">' + youSummary(p) +
      '<section class="hqx-block hqx-floor">' + head({ k: "Playoff floor · Rule 8.3", h: esc(head_), p: esc(sub) }) +
        '<div class="hqx-floor-b"><div class="hqx-ring">' + ring + '<span class="hqx-ring-c"><b class="d-num">' + gp + "</b><small>" + (fl.floor ? "of " + fl.floor + " games" : "played") + "</small></span></div>" +
          '<dl class="spec hqx-floor-spec"><div><dt>Played</dt><dd class="num">' + gp + "</dd></div><div><dt>Floor</dt><dd class=\"num\">" + (fl.floor || "None") + (fl.prorated ? " (prorated)" : "") + "</dd></div>" +
            "<div><dt>Club games left</dt><dd class=\"num\">" + leftG + "</dd></div><div><dt>Most you can add</dt><dd class=\"num\">" + reach + "</dd></div></dl></div></section>" +
      seasonLines(p) +
      '<div class="hqx-two hqx-pair">' +
        '<section class="hqx-block">' + head({ k: esc(sn()), h: "Last three games", size: "d-2 sec-h-sm" }) +
          (logs.length ? '<div class="list hqx-list">' + logs.map(function (l) { return lastRow(p, l); }).join("") + "</div>" : '<p class="t-sub">No games yet this season.</p>') + "</section>" +
        '<section class="hqx-block" data-w="s2reg">' + s2RegInner(self()) + "</section></div></div>";
  }
  /* the member's own sign-up for the season on screen, from the league read (M.player(id).signup, registration_pool). Each
     line opens the door that changes it: the form is e5's (data-flow="register"), the profile details are edited in
     Settings, a position change is a case */
  function s2RegInner(p) {
    if (!p) return "";
    var n = M.view.season, su = p.signup && p.signup.status !== "declined" ? p.signup : null, a = (S2.auth && S2.auth.profile) || {};
    var pos = su ? su.pos : p.pos, posName = pos ? (M.posName(pos) || pos) + " (" + pos + ")" : "Not set yet";
    var check = [
      [!!su, su ? "Signed up for " + sn() : "Not signed up for " + sn(), su ? stamp(Date.parse(su.at)) + " · change your sign-up" : "Sign up with your EA ID, console and position", ' data-flow="register"'],
      [!!a.in_guild, a.in_guild ? "In the CGHL Discord" : "Not in the CGHL Discord yet", a.in_guild ? "Your club talks there" : "Join it with the account the league follows (Rule 1.1)", ' href="#/you?tab=settings"'],
      [!!su, "EA ID and console", "On your league profile; change them in Settings", ' href="#/you?tab=settings"'],
      [!!pos, "Position", posName + " · ask for a change", ' data-flow="case" data-type="position_change"']];
    return head({ k: esc(sn()), h: su ? "You are signed up" : "You have not signed up", size: "d-2 sec-h-sm", p: "Sign-ups close " + esc(calText(n, "registration_deadline")) + "; the draft is " + esc(calText(n, "draft_at")) + "." }) +
      '<div class="list hqx-list hqx-checklist">' + check.map(function (c) { var el = /href/.test(c[3]) ? "a" : "button"; return "<" + el + ' class="row hqx-ck' + (c[0] ? "" : " is-todo") + '"' + c[3] + '><span class="hqx-ck-i" aria-hidden="true">' + S2.ic(c[0] ? "check" : "plus") + '</span><span class="grow"><span class="hqx-ck-t">' + esc(c[1]) + '</span><span class="t-foot">' + esc(c[2]) + "</span></span>" + S2.chev() + "</" + el + ">"; }).join("") + "</div>";
  }
  function lastRow(p, l) {
    var line = l.goalie ? (l.sv + " saves · " + (l.sa ? (l.sv / l.sa).toFixed(3).replace(/^0/, "") : "–")) :
      l.g + " G · " + l.a + " A · " + M.display("pm", l.pm) + " +/- · " + plural(l.sog, "shot");
    return '<a class="row hqx-lg" href="' + esc(l.href || "#/games") + '">' + mark(l.result) + M.crest(l.opp) +
      '<span class="grow"><span class="title">' + (l.home ? "vs " : "at ") + esc(l.opp) + ' <span class="num">' + esc(l.score) + '</span></span><span class="sub">' + esc(l.date) + " · played " + esc(M.posName(l.pos) || l.pos) + "</span></span>" +
      '<span class="hqx-line num">' + esc(line) + "</span>" + S2.chev() + "</a>";
  }
  /* the season line: the number in a sentence first, then the line as a scoreboard strip (big condensed numerals) */
  function seasonLines(p) {
    return (p.roles || []).map(function (role) {
      var L = p.lines[role]; if (!L) return "";
      var cells = role === "G" ? [["GP", "Games played", L.gp], ["REC", "Record", L.record || "–"], ["SV", "Saves", L.sv], ["SV%", "Save percentage", M.display("sv_pct", L.svpct)], ["GAA", "Goals against average", L.gaa == null ? "–" : L.gaa.toFixed(2)], ["SO", "Shutouts", L.so]] :
        [["GP", "Games played", L.gp], ["G", "Goals", L.g], ["A", "Assists", L.a], ["P", "Points", L.p], ["+/-", "Plus/minus", M.display("pm", L.pm)], ["HITS", "Hits", L.hits]];
      var h = role === "G" ? (L.svpct != null ? M.display("sv_pct", L.svpct) + " in " + plural(L.gp, "game") + " in goal" : plural(L.gp, "game") + " in goal") :
        plural(L.p, "point") + " in " + plural(L.gp, "game");
      var rating = p.ovr && role === p.mainRole ? " Rated " + p.ovr.ovr + " " + (({ C: "at center", W: "at wing", D: "on defense", G: "in goal" })[p.ovr.pos] || "") + " against a league median of " + M.OVR_CENTER + "." : "";
      return '<section class="hqx-block">' + head({ k: esc(sn()) + " line · " + (role === "G" ? "in goal" : "skating"), h: esc(h),
          p: (role === "G" ? "" : (L.pts_pg != null ? L.pts_pg.toFixed(2) + " points per game, every game and position played." : "")) + esc(rating) }) +
        '<dl class="hqx-line-strip">' + cells.map(function (c) { return '<div><dt><abbr title="' + esc(c[1]) + '">' + esc(c[0]) + '</abbr></dt><dd class="d-num">' + esc(c[2]) + "</dd></div>"; }).join("") + "</dl></section>";
    }).join("");
  }

  /* ---- Applications: owner and staff, edit once (v4.20) and withdraw (v4.21, v4.22) ---- */
  function appSub() { var r = AP.state === "ready" && AP.owner && AP.owner.row; return AP.state !== "ready" ? "Owner and staff applications" : r ? "Owner application " + String(APP_WORD[r.status] || r.status).toLowerCase() : "No owner application on file"; }
  function paneApps() { return '<div class="hqx-stack"><div class="hqx-stack" data-w="apps">' + appsInner() + "</div></div>"; }

  /* ---- the member's own owner and staff applications, read with S2.forms.mine (js/flows.js, e5:
     the one reader the forms use too) and withdrawn with S2.forms.withdrawOwner / withdrawStaff. Filing, editing and
     filing again are e5's forms (data-flow); the database decides whether each is open (the one edit, the deadline,
     Rule 2.7's conflicts) and says so in its own words ---- */
  var AP = { state: "idle", owner: null, staff: null, err: null, at: 0 };
  var APP_WORD = { pending: "In review", approved: "Approved", denied: "Not approved", waitlisted: "Waitlisted", withdrawn: "Withdrawn" };
  function said(e) { return S2.forms && S2.forms.said ? S2.forms.said(e) : String((e && e.message) || e); }
  function loadApps(force) {
    if (AP.state === "loading" || (!force && AP.state === "ready" && Date.now() - AP.at < 60000)) return;
    if (!S2.forms || !S2.forms.mine) { AP.state = "error"; AP.err = new Error("The application forms (js/flows.js, S2.forms) did not load, so your applications cannot be read. Reload the page."); paintApps(); return; }
    AP.state = "loading"; paintApps();
    var one = function (k) { return Promise.resolve().then(function () { return S2.forms.mine(k); }).then(function (row) { return { row: row || null }; }, function (e) { console.warn("You: the " + k + " application could not be read", e); return { err: e }; }); };
    return Promise.all([one("owner"), one("staff")]).then(function (x) { AP.owner = x[0]; AP.staff = x[1]; AP.state = "ready"; AP.err = null; AP.at = Date.now(); paintApps(); });
  }
  function paintApps() { if (S2.$('[data-w="apps"]')) repaint("apps", appsInner); refreshNav(); }
  function appsInner() {
    if (AP.state === "error") return '<div class="hqx-callout" role="alert"><p class="t-sub hqx-ink"><b>Your applications could not be read.</b> ' + esc(AP.err.message) + "</p></div>";
    if (AP.state !== "ready") return '<p class="t-sub yx-wait" aria-live="polite">Reading your applications…</p>';
    return appBlock("owner", AP.owner) + appBlock("staff", AP.staff);
  }
  function appBlock(kind, x) {
    /* QA nits 36 (2026-11-25): the application on file is the season taking sign-ups' (S2.forms.mine reads that season),
       so its label and its deadline are that season's too, never the season on screen (?season=1 printed a past date
       over a button that opens the Season 2 form) */
    var rs = S2.forms && S2.forms.regSeason ? S2.forms.regSeason() : null;
    var owner = kind === "owner", label = owner ? "Owner application" : "Staff application", n = rs ? rs.number : M.view.season, r = x && x.row;
    var wrap = function (h, p, body, acts) { return '<section class="hqx-block hqx-app">' + head({ k: esc(label + (owner ? " · " + (rs ? rs.name || "Season " + rs.number : sn()) : "")), h: h, p: p }) + (body || "") + '<div class="hqx-actions">' + (acts || "") + "</div></section>"; };
    if (x && x.err) return wrap("Could not be read", esc(said(x.err)), "", '<button class="btn secondary sm" data-ya="ap-reload">Try again</button>');
    if (!r) return wrap(owner ? "No owner application on file" : "No staff application on file",
      owner ? "A member signed up for the season may apply to own any of the 32 NHL franchises until " + esc(calText(n, "owner_app_deadline")) + " (Rule 2.6)." : "Season 2 has one staff group. Every staffer and commissioner votes on each application (Rule 2.6).",
      "", '<button class="btn" data-flow="' + kind + '">' + (owner ? "Apply to own a club" : "Apply to join the staff") + "</button>");
    var pend = r.status === "pending", word = APP_WORD[r.status] || r.status;
    if (owner) {
      var picks = [r.preferred_club, r.franchise_2, r.franchise_3].filter(Boolean);
      return wrap(esc(pend ? (r.preferred_club ? r.preferred_club + ", in review" : "In review") : word),
        pend ? "Every staffer and commissioner votes on each application; more than half of them must approve." : r.status === "withdrawn" ? "You withdrew this application. The league decides whether a new filing is still open." : "",
        '<dl class="spec hqx-spec4"><div><dt>Franchise' + (picks.length > 1 ? "s" : "") + "</dt><dd>" + esc(picks.join(", ") || "Not named") + '</dd></div><div><dt>Status</dt><dd>' + esc(word) + "</dd></div>" +
          '<div><dt>Applications close</dt><dd class="num">' + esc(calText(n, "owner_app_deadline")) + '</dd></div><div><dt>Your one edit</dt><dd>' + (r.edited_at ? "Used " + esc(stamp(Date.parse(r.edited_at))) : "Not used") + "</dd></div></dl>" +
          '<p class="hqx-fine">An applicant may change a submitted application once while applications are open, and may withdraw it at any time (Rule 2.6).</p>',
        pend ? (r.edited_at ? "" : '<button class="btn secondary" data-flow="owner">Use my one edit</button>') + '<button class="btn danger" data-act="app-withdraw" data-app="owner">Withdraw</button>' :
          r.status === "withdrawn" ? '<button class="btn" data-flow="owner">File again</button>' : "");
    }
    var names = (r.departments || []).map(function (k) { var c = S2.COMMITTEE_DEFS.filter(function (d) { return d.key === k || d.name === k; })[0]; return c ? c.name : k; });
    return wrap(esc(word), pend ? "Every staffer and commissioner votes on each application, and it passes when more than half of them approve (Rule 2.6)." : r.status === "withdrawn" ? "You withdrew this application. Applying again starts a new one, which is voted on afresh." : "",
      '<dl class="spec hqx-spec4"><div><dt>Committees you know best</dt><dd>' + esc(names.join(", ") || "None named") + "</dd></div><div><dt>Status</dt><dd>" + esc(word) + "</dd></div></dl>",
      pend ? '<button class="btn secondary" data-flow="staff">Change it</button><button class="btn danger" data-act="app-withdraw" data-app="staff">Withdraw</button>' :
        r.status === "withdrawn" || r.status === "denied" ? '<button class="btn secondary" data-flow="staff">Apply again</button>' : "");
  }
  /* withdraw_owner_application / withdraw_staff_application through e5's door; the sheet stays open with the database's
     words when it refuses */
  function withdrawSheet(which) {
    var owner = which === "owner", x = AP[which], r = x && x.row;
    if (!r) { S2.toast("There is no " + which + " application on file to withdraw.", "err"); return; }
    var sh = sheet({ title: "Withdraw your " + which + " application?", back: ['[data-act="app-withdraw"][data-app="' + which + '"]', '[data-w="apps"] [data-flow="' + which + '"]'],
      html: '<p class="t-body">' + (owner ? "Your application leaves the vote. Whether you may file again depends on whether applications are still open." : "Your staff application leaves the vote. Applying again starts a new one, which is voted on afresh (Rule 2.6).") + "</p>" +
        '<p class="hqx-err" role="alert"></p><div class="hqx-actions"><button class="btn danger" data-x="go" data-autofocus>Withdraw</button><button class="btn secondary" data-x="keep">Keep it</button></div>' });
    pinFoot(sh);
    sh.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-x]"); if (!b) return;
      if (b.dataset.x === "keep") return sh.close();
      if (b.disabled) return;
      var err = S2.$(".hqx-err", sh.el); b.disabled = true; b.textContent = "Withdrawing…"; err.textContent = "";
      (owner ? S2.forms.withdrawOwner(r.id) : S2.forms.withdrawStaff(r.id)).then(function (d) {
        r.status = d.status; paintApps(); sh.close();
        S2.toast(d.final ? "Application withdrawn. Applications are closed, so it cannot be filed again this season." : "Application withdrawn", "ok");
      }, function (e2) { b.disabled = false; b.textContent = "Withdraw"; err.textContent = said(e2); });
    });
  }
  /* ---- Settings: appearance, Discord, league profile, your data, sign out (grouped inset lists) ---- */
  function paneSettings(p) {
    return '<div class="hqx-stack hqx-tight">' + head({ k: "Settings", h: "Linked to Discord", p: "Your Discord sign-in is your league account. How the site looks is kept on this device." }) +
      '<div data-w="look">' + lookInner() + "</div>" +
      '<div data-w="dc">' + group("Discord", dcRow()) + "</div>" +
      '<div data-w="lprof">' + lprofInner(p) + "</div>" +
      group("Your data", '<button class="row" data-ya="data"><span class="grow title">What the league keeps about you</span>' + S2.chev() + "</button>") +
      '<div class="list hqx-list"><button class="row hqx-signout" data-ya="signout">Sign out</button></div></div>';
  }
  /* Your data: the current site's Settings card (part_live.js CG.hubSettings "Your data", last updated with the Terms and
     Privacy page of July 16, 2026), its two links pointed at this site's pages: #/terms and #/privacy (js/pages/office.js,
     the classic CG.ROUTES.legal split in two) and the inbox for a message to a commissioner (the classic Messages) */
  function dataSheet() {
    sheet({ title: "Your data", back: ['[data-ya="data"]'], html: '<div class="yx-data">' +
      '<p class="t-body">The league stores your Discord identity (id, username, avatar), your EA ID and platform, your registrations and availability, and the stats you generate in league games. Discord passes your email to our sign-in provider, but the league never uses or displays it; availability is visible only to your club\'s management and league staff.</p>' +
      '<p class="t-body">Read the <a href="#/terms">Terms of play</a> and the <a href="#/privacy">Privacy</a> page. To delete your account and data, message any commissioner from <a href="#/you?tab=inbox">your inbox</a> (or on Discord). Deletion covers everything except the league\'s permanent game record: box scores keep your gamertag.</p></div>' });
  }
  function lprofInner() { return lprofReal(self()); }

  /* ---- League profile: the current site's Settings card (part_live.js CG.hubSettings, the sSaveLive save,
     CG.myJersey, CG.jerseyHint, CG.saveMyJersey). The four columns a member may edit go through profiles.update (its id
     back, or S2_NO_ROWS); the jersey number goes through set_my_jersey_number, and only when the field was changed (an
     unrelated save once undid a management renumber, memory player-jersey-numbers-v378). The form is drawn once from
     the member's own row and never redrawn under the typing: a save repaints only the number, its hint and the message ---- */
  var PF = { state: "idle", row: null, err: null, busy: false, worn: undefined };
  var PF_COLS = "id,ea_id,platform,platform_gamertag,preferred_server,jersey_number,ea_player_id";
  function loadProfile() {
    if (PF.state === "loading" || PF.state === "ready") return;
    var sb = S2.ensureSb && S2.ensureSb(), uid = S2.session && S2.session.profileId;
    PF.state = "loading"; PF.err = null; paintProfile();
    Promise.resolve().then(function () {
      if (!uid) throw new Error("Sign in with Discord first.");
      if (!sb) throw new Error("Not connected to the league, so your profile cannot be read. Reload the page and try again.");
      return sb.from("profiles").select(PF_COLS).eq("id", uid).maybeSingle();
    }).then(function (r) {
      if (r && r.error) throw new Error(r.error.message || "The league did not answer.");
      var row = r && (Array.isArray(r.data) ? r.data[0] : r.data);
      if (!row) throw new Error("Your profile was not found. Sign out and back in, then try again.");
      PF.row = row; PF.state = "ready"; paintProfile();
    }).catch(function (e) { console.warn("You: the league profile could not be read", e); PF.state = "error"; PF.err = e; paintProfile(); });
  }
  function paintProfile() { if (S2.$('[data-w="lprof"]')) repaint("lprof", function () { return lprofInner(self()); }); }
  /* the console list and the console-name label are the profile form's own (js/flows.js, from the live CG.PLATFORMS) */
  function consoleField(k) { return ((S2.flows.profile || {}).steps || [{ fields: [] }])[0].fields.filter(function (x) { return x.k === k; })[0] || null; }
  function tagLabel(code) { var f = consoleField("tag"); return f && typeof f.label === "function" ? f.label({ console: code }) : "Xbox Gamertag or PSN Name"; }
  /* the number chosen (profiles) and the number worn on the club this season (roster_spots), which are not always the same */
  function jersey(p) {
    var r = PF.row || {}, chosen = r.jersey_number != null ? +r.jersey_number : null;
    var wearing = PF.worn !== undefined ? PF.worn : (p && p.rostered && p.num != null ? +p.num : null), takenBy = null;
    if (wearing && chosen && wearing !== chosen) {
      var ro = M.roster(p.club), mate = ro ? ro.all.filter(function (x) { return x.id !== p.id && +x.num === chosen; })[0] : null;
      if (mate) takenBy = mate.tag;
    }
    return { chosen: chosen, wearing: wearing, club: p && p.rostered && p.team ? p.team.full : null, takenBy: takenBy };
  }
  function jerseyHint(j) {
    var club = esc(j.club || "your club");
    if (j.wearing && j.chosen && j.chosen !== j.wearing && j.takenBy)
      return "You wear <b>#" + j.wearing + "</b> for the " + club + ". Your saved choice, #" + j.chosen + ", is worn there by " + esc(j.takenBy) + ", so it stays your choice for your next club. Enter another number to change it here.";
    if (j.wearing && j.chosen && j.chosen !== j.wearing)
      return "You wear <b>#" + j.wearing + "</b> for the " + club + ", and your saved choice is <b>#" + j.chosen + '</b>, which is free there. <button class="btn secondary sm" data-ya="wear" data-n="' + j.chosen + '">Wear #' + j.chosen + "</button>";
    if (j.wearing) return "You wear <b>#" + j.wearing + "</b> for the " + club + ". Enter another number and save: it changes on your club right away unless a teammate already wears it, and it goes with you if you move clubs.";
    return "Your number, 1 to 99. When you join a club you wear it there if nobody else does; if somebody does, you get a free number and can change it here.";
  }
  function lprofReal(p) {
    var foot = "Your gamertag, position and EA ID are public on your profile (Rule 1.1). Your console name is seen only by your club's management and league staff. A position change is a request to the league office.";
    if (PF.state === "error") return group("League profile", '<div class="row"><span class="grow"><span class="title">Your league profile could not be read</span><span class="sub">' + esc(PF.err.message) + '</span></span><button class="btn secondary sm" data-ya="pf-reload">Try again</button></div>');
    if (PF.state !== "ready" || !p) return group("League profile", '<div class="row"><span class="grow sub" aria-live="polite">Reading your league profile…</span></div>');
    var r = PF.row, plat = r.platform || "", j = jersey(p), num = j.wearing || j.chosen || "", cons = (consoleField("console") || { opts: [] }).opts;
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(label) + "</option>"; };
    return '<section><h3 class="hqx-group-h">League profile</h3><div class="list hqx-list">' +
        /* the name on its own line, never a trailing column: a long gamertag squeezed the sentence to one word a line at 375 */
        '<div class="row"><span class="grow"><span class="title">Gamertag</span><span class="sub"><b class="yx-tag">' + esc(p.tag) + "</b> · follows your Discord display name; change it there and it flows here.</span></span></div>" +
        '<button class="row" data-flow="case" data-type="position_change"><span class="grow title">Position</span><span class="trail">' + esc(p.posName || "Not set yet") + "</span>" + S2.chev() + "</button></div>" +
      '<div class="hqx-form yx-prof" data-w="pform">' +
        '<div class="field"><label for="yxEa">EA ID</label><input class="input" id="yxEa" data-pf="ea" autocomplete="off" spellcheck="false" value="' + esc(r.ea_id || "") + '">' +
          '<p class="hqx-fine">' + (r.ea_player_id ? "Linked to your EA account: your box scores find you automatically now, whatever you rename yourself to." :
            "Enter the name on your EA box score, exactly as it shows in game. If your EA login and your in-game name differ, the league needs the in-game one. Required to sign up.") + "</p></div>" +
        '<div class="field"><label for="yxPlat">Console</label><select class="input" id="yxPlat" data-pf="plat">' + opt("", "Pick your console", plat) + cons.map(function (c) { return opt(c[0], c[1], plat); }).join("") + "</select></div>" +
        '<div class="field"><label for="yxTag" id="yxTagL">' + esc(tagLabel(plat)) + '</label><input class="input" id="yxTag" data-pf="tag" autocomplete="off" spellcheck="false" value="' + esc(r.platform_gamertag || "") + '" placeholder="' + esc(tagLabel(plat)) + '">' +
          '<p class="hqx-fine">The name your console shows, so your club and the league can add you and get you into a party. Required to sign up.</p></div>' +
        '<div class="field"><label for="yxSrv">Suggested server</label><select class="input" id="yxSrv" data-pf="srv">' + opt("", "No preference", r.preferred_server || "") + S2.lobby.SERVERS.map(function (x) { return opt(x, x, r.preferred_server || ""); }).join("") + "</select>" +
          '<p class="hqx-fine">The server you play best on. Your club\'s management sees the roster\'s answers when it sets each game\'s server picks and veto (Rule 4.2). It is a suggestion, not a vote.</p></div>' +
        '<div class="field"><label for="yxNum">Jersey number</label><input class="input" id="yxNum" data-pf="num" type="number" min="1" max="99" step="1" inputmode="numeric" placeholder="1 to 99" value="' + num + '" data-was="' + num + '">' +
          '<p class="hqx-fine" data-w="jhint">' + jerseyHint(j) + "</p></div>" +
        '<div class="hqx-actions"><button class="btn" data-ya="pf-save"' + (PF.busy ? " disabled" : "") + ">" + (PF.busy ? "Saving…" : "Save profile") + '</button></div><p class="t-foot yx-msg" role="status" aria-live="polite"></p>' +
      '</div><p class="hqx-fine hqx-group-f">' + esc(foot) + "</p></section>";
  }
  function pfSay(msg, bad) { var m = S2.$('[data-w="pform"] .yx-msg'); if (m) { m.textContent = msg || ""; m.classList.toggle("is-bad", !!bad); } if (msg) S2.toast(msg, bad ? "err" : "ok"); }
  /* the number field and its hint say what the database holds; a refused number stays as typed */
  function paintJersey(keepTyped) {
    var p = self(), j = jersey(p), el = S2.$('[data-pf="num"]'), v = j.wearing || j.chosen || "";
    if (el && !keepTyped) { el.value = v; el.defaultValue = String(v); el.dataset.was = String(v); }
    repaint("jhint", jerseyHint(j));
  }
  function saveProfile() {
    var f = S2.$('[data-w="pform"]'); if (!f || PF.busy) return;
    var val = function (k) { var el = S2.$('[data-pf="' + k + '"]', f); return el ? String(el.value || "").trim() : ""; };
    var ea = val("ea"), plat = val("plat"), ptag = val("tag"), srv = val("srv"), jEl = S2.$('[data-pf="num"]', f), jRaw = val("num");
    var cons = ((consoleField("console") || { opts: [] }).opts).map(function (c) { return c[0]; });
    if (ea && ea.length < 2) return pfSay("That EA ID looks too short.", true);
    if (plat && cons.indexOf(plat) < 0) return pfSay("CGHL is played on console: pick Xbox or PlayStation.", true);
    if (ptag && ptag.length < 2) return pfSay("That " + tagLabel(plat) + " looks too short.", true);
    if (srv && S2.lobby.SERVERS.indexOf(srv) < 0) return pfSay("That server is not one the league plays on.", true);
    /* a typed "7a" reads as "" in a number field: refuse it rather than take it as "clear my number" */
    if ((jEl.validity && jEl.validity.badInput) || (jRaw !== "" && !/^\d{1,2}$/.test(jRaw)) || (jRaw !== "" && (+jRaw < 1 || +jRaw > 99))) return pfSay("A jersey number is a whole number from 1 to 99.", true);
    var jNum = jRaw === "" ? null : parseInt(jRaw, 10), jSend = jRaw !== String(jEl.dataset.was || ""), uid = S2.session.profileId, p = self();
    var set = { ea_id: ea || null, platform: plat || null, platform_gamertag: ptag || null, preferred_server: srv || null };
    PF.busy = true; var btn = S2.$('[data-ya="pf-save"]', f); if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    pfSay("");
    var a = S2.write("profiles.update", { set: set, match: { id: uid } }, { sections: ["people"] }).then(function () { Object.assign(PF.row, set); return null; }, function (e) {
      return e && e.code === "S2_NO_ROWS" ? "That did not save. Your sign-in may have expired: sign in again and retry." : (e && e.message) || "The league did not save that.";
    });
    var b = jSend ? jerseyWrite(jNum, p) : Promise.resolve({});
    return Promise.all([a, b]).then(function (res) {
      var pErr = res[0], jr = res[1] || {}, jErr = jr.err || null, d = jr.d;
      PF.busy = false; if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = "Save profile"; }
      paintJersey(!!jErr);
      /* what the database now holds is the form's clean state, so the pulse's repaint is not held by a field already saved */
      if (!pErr) ["ea", "plat", "tag", "srv"].forEach(function (k) {
        var el = S2.$('[data-pf="' + k + '"]', f); if (!el) return;
        if (el.tagName === "SELECT") Array.prototype.forEach.call(el.options, function (o) { o.defaultSelected = o.selected; });
        else { el.value = el.value.trim(); el.defaultValue = el.value; }
      });
      if (pErr && jErr) return pfSay("Your profile did not save: " + pErr + " Your number did not change either: " + jErr, true);
      if (pErr) return pfSay("Your profile did not save: " + pErr + (jSend ? " Your jersey number was saved." : ""), true);
      if (jErr) return pfSay("Profile saved, but your number did not change: " + jErr, true);
      var club = jersey(p).club || "club";
      pfSay(!d || d.chosen == null ? "Profile saved." : d.wearing != null ? "Profile saved. You wear #" + d.wearing + " for the " + club + "." : "Profile saved. #" + d.chosen + " is yours when you join a club, if nobody there wears it.");
      return true;
    });
  }
  /* the one jersey write (Save and Wear #N): the database decides, and the page shows its answer, never the typed number */
  function jerseyWrite(n, p) {
    return S2.write("set_my_jersey_number", { p_number: n }, p && p.rostered ? { sections: ["rosters"] } : {}).then(function (r) {
      var d = (r && r.data) || {};
      PF.row.jersey_number = d.chosen == null ? null : +d.chosen;
      PF.worn = d.wearing == null ? (p && p.rostered ? PF.worn : null) : +d.wearing;
      return { d: d };
    }, function (e) { return { err: (e && e.message) || "The league did not save that." }; });
  }
  function wear(btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    jerseyWrite(+btn.dataset.n, self()).then(function (jr) {
      paintJersey(false);
      if (jr.err) { S2.toast("Your number did not change: " + jr.err, "err"); return; }
      S2.toast("You wear #" + jr.d.wearing + " for the " + (jersey(self()).club || "club") + ".", "ok");
    });
  }

  /* ---- Discord: the current site's card (CG.loadDiscordAccounts, CG.renderDiscordAccounts, CG.switchDiscordAccount).
     The database decides a switch (switch_discord_account takes only an account linked to this login); back from Link,
     the account linked since then is switched to once (S2.takeDiscordSwitch). Auto-join is retired, so a member on an
     account outside the server gets the invite, the re-check and the Rule 1.1 warning ---- */
  var DC = { state: "idle", data: null, err: null, busy: null, msg: "", at: 0 };
  function loadDc() {
    if (DC.state === "loading" || DC.busy || (DC.state === "ready" && Date.now() - DC.at < 60000)) return;
    DC.state = "loading"; DC.err = null; paintDc();
    return S2.discordAccounts().then(function (d) {
      d = d || {}; DC.data = d; DC.state = "ready"; DC.at = Date.now();
      var pick = S2.takeDiscordSwitch(d.accounts || [], d.current);
      paintDc();
      if (pick) return switchDc(pick.discord_id, pick.username || "your new account");
    }, function (e) { console.warn("You: the Discord accounts could not be read", e); DC.state = "error"; DC.err = e; paintDc(); });
  }
  function paintDc() {
    if (S2.$('[data-w="dc"]')) repaint("dc", function () { return group("Discord", dcRow()); });
    if (S2.$('[data-w="dcs"]')) repaint("dcs", dcInner);
  }
  function dcName(d) {
    var cur = String((d && d.current) || ""), a = ((d && d.accounts) || []).filter(function (x) { return String(x.discord_id) === cur; })[0];
    return (a && a.username) || (S2.auth && S2.auth.profile && S2.auth.profile.discord_username) || "this account";
  }
  function switchDc(id, name) {
    DC.busy = String(id); DC.msg = ""; paintDc();
    return S2.write("switch_discord_account", { p_discord_id: String(id) }).then(function (r) {
      var d = (r && r.data) || {};
      DC.busy = null;
      if (S2.auth && S2.auth.profile) { S2.auth.profile.discord_id = String(d.discord_id || id); S2.auth.profile.in_guild = !!d.in_guild; }
      if (d.changed) S2.toast("Switched to " + (name || d.display || "your new account") + (d.in_guild ? ". Your Discord roles are moving over." : ". Site roles moved; join the server with it for Discord roles."), "ok");
    }, function (e) { DC.busy = null; S2.toast("Could not switch: " + ((e && e.message) || "the league refused it."), "err"); })
      .then(function () { DC.state = "idle"; return loadDc(); });
  }
  function dcRow() {
    var d = DC.data || {}, st = DC.state;
    var state = st === "ready" ? (d.in_guild ? tag("win", "In the server") : tag("loss", "Not in the server yet")) : "";
    var sub = st === "error" ? "Your Discord accounts could not be read: " + ((DC.err && DC.err.message) || "the league did not answer.") : st === "ready" ? "The league follows " + dcName(d) + ". Switch or link another." : "Checking your Discord accounts…";
    return '<button class="row hqx-dcrow" data-act="discord"><span class="grow"><span class="title">Discord account</span>' + state + '<span class="sub">' + esc(sub) + "</span></span>" + S2.chev() + "</button>";
  }
  function dcInner() {
    var d = DC.data || {}, st = DC.state;
    if (st === "error") return '<div class="hqx-callout" role="alert"><p class="t-sub hqx-ink"><b>Your Discord accounts could not be read.</b> ' + esc((DC.err && DC.err.message) || "") + '</p><div class="hqx-actions"><button class="btn secondary sm" data-x="reload">Try again</button></div></div>';
    if (st !== "ready") return '<p class="t-sub" aria-live="polite">Checking your Discord accounts…</p>';
    var cur = String(d.current || ""), others = (d.accounts || []).filter(function (a) { return String(a.discord_id) !== cur; }), inv = d.invite || S2.siteConfig("discord_invite");
    return '<p class="t-body">The league follows <b>' + esc(dcName(d)) + "</b>.</p>" +
      (d.in_guild ? "" : '<div class="hqx-callout"><p class="t-sub hqx-ink"><b>This account is not in the league Discord yet.</b> Your site roles have moved to it, but Discord roles follow only once it joins the server, and a pending sign-up is withdrawn after about a day out of the server (Rule 1.1). Join now.</p>' +
        '<div class="hqx-actions">' + (/^https:\/\//.test(inv || "") ? '<a class="btn sm discord" href="' + esc(inv) + '" target="_blank" rel="noopener">Join the server with this account</a>' : '<span class="t-foot">Ask a commissioner for the invite.</span>') +
        '<button class="btn secondary sm" data-x="recheck">I have joined, re-check</button></div></div>') +
      (others.length ? '<h4 class="hqx-group-h">Other Discord accounts linked to this login</h4><div class="list hqx-list">' + others.map(function (a) {
        var busy = DC.busy === String(a.discord_id);
        return '<div class="row"><span class="grow title">' + esc(a.username || "Discord account") + '</span><button class="btn secondary sm" data-x="use" data-v="' + esc(String(a.discord_id)) + '" data-name="' + esc(a.username || "") + '"' + (DC.busy ? " disabled" : "") + ">" + (busy ? "Switching…" : "Use this account") + "</button></div>"; }).join("") + "</div>" : "") +
      '<div class="hqx-actions"><button class="btn" data-x="link"' + (DC.busy ? " disabled" : "") + ">" + S2.ic("plus") + "Link a different Discord account</button></div>" +
      (DC.msg ? '<p class="hqx-err" role="alert">' + esc(DC.msg) + "</p>" : "") +
      '<p class="hqx-fine">Made a new Discord, or want the league on a different one? Link it and the league switches to it: your site roles move at once, your server roles follow within a couple of minutes once that account is in the server, and the old account\'s league roles come off in the same sweep. Your league name follows the new account\'s Discord display name. On Discord\'s page make sure the new account is the one signed in (log out at discord.com first if it is not).</p>';
  }
  function dcSheet() {
    var sh = sheet({ title: "Discord account", back: ['[data-act="discord"]'], html: '<div class="hqx-dc" data-w="dcs">' + dcInner() + "</div>" });
    if (DC.state !== "ready") loadDc();
    sh.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-x]"); if (!b || b.disabled) return;
      var x = b.dataset.x;
      if (x === "reload") { DC.state = "idle"; loadDc(); }
      else if (x === "use") switchDc(b.dataset.v, b.dataset.name);
      else if (x === "link") {
        b.disabled = true; DC.msg = "";
        /* the browser leaves for Discord; a refusal comes back in Supabase's words ("manual linking disabled" is a setting) */
        S2.linkDiscord().catch(function (err) { DC.msg = "Could not start the link: " + ((err && err.message) || "Supabase refused it."); paintDc(); });
      } else if (x === "recheck") {
        b.disabled = true; b.textContent = "Checking…";
        /* my_discord_accounts reads presence from the bot's guild_members row, so a join shows within seconds */
        S2.discordAccounts().then(function (d) {
          DC.data = d || {}; DC.at = Date.now();
          if (DC.data.in_guild) { if (S2.auth && S2.auth.profile) S2.auth.profile.in_guild = true; S2.toast("You are in. Your Discord roles follow within a couple of minutes.", "ok"); }
          else S2.toast("Not seeing that account in the server yet. Join with the account the league follows.", "err");
          paintDc();
        }, function (err) { b.disabled = false; b.textContent = "I have joined, re-check"; S2.toast("The check did not go through: " + ((err && err.message) || ""), "err"); });
      }
    });
  }
  function group(h, rows, foot) { return '<section><h3 class="hqx-group-h">' + esc(h) + '</h3><div class="list hqx-list">' + rows + "</div>" + (foot ? '<p class="hqx-fine hqx-group-f">' + esc(foot) + "</p>" : "") + "</section>"; }
  function lookInner() {
    var th = S2.state.theme;
    return '<section><h3 class="hqx-group-h">Appearance</h3><div class="hqx-themes" role="group" aria-label="Theme">' +
      [["light", "Light", "sun"], ["dark", "Dark", "moon"]].map(function (x) { return '<button class="hqx-theme" data-act="theme" data-v="' + x[0] + '" aria-pressed="' + (th === x[0]) + '">' + S2.ic(x[2]) + '<span class="t-head">' + x[1] + '</span><span class="hqx-radio" aria-hidden="true"></span></button>'; }).join("") + "</div>" +
      "</section>";   /* Glacier is the one finish (commissioner, 2026-11-23), so Appearance is the theme alone. QA visual 2
      (2026-11-25): a stray closing div tag here closed the [data-w=look] wrapper and then .hqx-stack, which dropped the Discord,
      League profile and Your data groups and Sign out out of the right column */
  }

  /* ---- Guest: a public join page on the white site canvas (league website v2): a statement hero with the Discord-purple
     button (ruling 2026-10-16), the clubs' crests as the imagery, three steps as a Lift lineup, the Season 2 dates on an
     ink band and the league office links. Every number is real; nothing private appears. ---- */
  function daysTo(at) { var a = M.etDay(M.generated), b = M.etDay(at); return a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : null; }
  function s2val(label) { var s = M.control && M.control.season(2); return s ? (s.summary.filter(function (x) { return x.label === label; })[0] || {}).value || "" : ""; }
  function guestHtml() {
    /* QA visual 1 (2026-11-25): a count the reader never received is never printed. A visitor never reads s2_control()
       (M.partial.control), so M.control's Discord count is a zero for them, and the page told every visitor the Discord was
       empty. The sign-up count is then the model's own count of the Season 2 sign-ups, real only while Season 2 is the
       season on screen */
    var ctl = !!M.control && !M.partial.control, mem = ctl ? M.control.members.present : null, rv = soft("you-guest") ? "" : " reveal";
    var su = M.control && (ctl || M.view.season === 2) ? M.control.seasonReturn.signedUp : null;
    var lines = M.games.reduce(function (a, g) { return a + (g.lines || 0); }, 0), s2 = M.RULES.s2, slots = s2val("Game slots (ET)");
    var dr = cal(2, "draft_at"), go = cal(2, "starts_at"), reg = cal(2, "registration_deadline"), days = go ? daysTo(go.at) : null;
    var md = function (c) { return c ? noYear(c.date).replace(/^[A-Za-z]+, /, "") : "–"; };
    /* "9:00 PM, 9:35 PM, 10:10 PM" reads "9:00, 9:35 and 10:10 PM ET" */
    var slotWords = slots ? slots.replace(/ PM/g, "").replace(/, (?=[^,]*$)/, " and ") + " PM ET" : "";
    var steps = [
      ["Sign up", "One form a season", "Your EA ID, console and position. Everyone signs up again for Season 2, Season 1 players included.", [["Signed up so far", su == null ? "–" : String(su)], ["Sign-ups close", md(reg) + (reg ? tbc(2, reg.key) : "")]], ["Season 2", "#/season"]],
      ["Get drafted", "Built on draft night", "Each club's front office builds its roster live at the draft, then runs it all season.", [["Draft", md(dr) + (dr ? ", " + dr.time : "")], ["Rounds", String(s2.draftRounds || "–")]], ["The clubs", "#/clubs"]],
      ["Play", "Every line counts", "Three nights a week" + (slotWords ? ", at " + slotWords : "") + ". Every game you play, at every position, goes on your profile from the EA box score.",
        [["Puck drop", md(go)], ["Box-score lines", S2.fmt(lines)]], ["The stats", "#/stats"]]
    ];
    var dates = ["owner_app_deadline", "registration_deadline", "draft_at", "starts_at"].map(function (k) { return cal(2, k); }).filter(Boolean);
    var office = [["Rulebook", "Every rule, searchable", "#/rulebook"], ["Season 2", "Calendar, settings and sign-ups", "#/season"], ["Own a club", "Owner applications close " + md(cal(2, "owner_app_deadline")), "#/season"],
      ["Join the staff", "One staff group, with six committees from officiating to draft and bidding", "#/season"], ["Standings", "Season 1, division by division", "#/standings"]];
    return '<div class="hqx-guest" data-ws="you-guest">' +
      '<section class="hero hqx-jhero' + rv + '"><span class="kicker">Season 2 · Sign-ups open</span><h1 class="d-hero">Join the league</h1>' +
        '<p class="lede-l">Competitive 6v6 EASHL on Wednesday, Thursday and Friday nights.' + (mem != null ? ' <b class="hqx-ink">' + S2.fmt(mem) + "</b> members are already in the league Discord" + (su != null ? ', and <b class="hqx-ink">' + su + "</b> have signed up for Season 2." : ".") :
          su != null ? ' <b class="hqx-ink">' + S2.fmt(su) + "</b> " + (su === 1 ? "member has" : "members have") + " signed up for Season 2." : "") + "</p>" +
        '<div class="hqx-jcta"><button class="btn site discord" data-act="join">Join with Discord</button><a class="btn site outline" href="#/season">See Season 2</a></div>' +
        /* auto-join is retired (sign-in asks Discord for identify only): the invite, not the sign-in, puts a member in the server */
        '<p class="hqx-fine">One Discord sign-in makes your account; the league invite takes you into the server, where your club talks.</p></section>' +
      '<nav class="hqx-clubbar' + rv + '" aria-label="The Season 1 clubs">' + M.teams.map(function (t) { return '<a href="' + esc(t.href) + '">' + M.crest(t.code, "lg") + "</a>"; }).join("") + "</nav>" +
      '<section class="hqx-jsec' + rv + '">' + head({ lv: 2, size: "d-1", k: "How a season works", h: "Sign up. Get drafted. Play.", p: "Three steps from the Discord to the ice, on the league office's own dates." }) +
        '<div class="lineup hqx-steps3">' + steps.map(function (x) {
          return '<a class="hqx-lu" href="' + x[4][1] + '"><span class="kicker">' + esc(x[0]) + '</span><span class="d-2 hqx-lu-t">' + esc(x[1]) + '</span><span class="t-sub">' + esc(x[2]) + "</span>" +
            '<dl class="spec">' + x[3].map(function (c) { return "<div><dt>" + esc(c[0]) + '</dt><dd class="num">' + esc(c[1]) + "</dd></div>"; }).join("") + "</dl>" +
            '<span class="arrow"><span>' + esc(x[4][0]) + "</span>" + S2.ic("chev") + "</span></a>";
        }).join("") + "</div></section>" +
      '<section class="band ink hqx-jcal' + rv + '"' + inkAttrs() + ">" + head({ lv: 2, size: "d-1", k: "Season 2", h: days != null ? plural(days, "day") + " to puck drop" : "Season 2 dates", p: "Every date from the league office, in Eastern time.", go: ["Season 2", "#/season"] }) +
        '<ol class="hqx-cal">' + dates.map(function (c) { return '<li><b class="d-num">' + esc(md(c)) + '</b><span class="hqx-cal-l">' + esc(c.label) + '</span><span class="t-foot">' + esc(c.date.split(",")[0] + ", " + c.time + " ET" + tbc(2, c.key)) + "</span></li>"; }).join("") + "</ol></section>" +
      '<section class="hqx-jsec hqx-office' + rv + '">' + head({ lv: 2, size: "d-1", k: "League office", h: "Everything is written down", p: "The rulebook, the calendar and the doors to run a club or join the staff." }) +
        '<div class="hqx-links">' + office.map(function (x) { return '<a class="hqx-link" href="' + x[2] + '"><span class="grow"><span class="d-3">' + esc(x[0]) + '</span><span class="t-sub">' + esc(x[1]) + "</span></span>" + S2.ic("chev") + "</a>"; }).join("") + "</div></section></div>";
  }
  function joinSheet() {
    var inv = S2.siteConfig("discord_invite");
    var sh = sheet({ title: "Join with Discord", html: '<ol class="hqx-joinsteps"><li><b>Sign in with Discord.</b> The league reads your Discord name to make your account.</li><li><b>Join the CGHL server</b>' + (/^https:\/\//.test(inv || "") ? ' with <a href="' + esc(inv) + '" target="_blank" rel="noopener">the league invite</a>' : " with the league invite") + ", where your club, the schedule and the league office live.</li>" +
      '<li><b>Sign up for Season 2</b> before ' + esc(calText(2, "registration_deadline")) + ", with your EA ID, console and position.</li></ol>" +
      '<button class="btn site discord hqx-join-b" data-x="go" data-autofocus>Continue with Discord</button><p class="hqx-fine">Discord asks you to approve the sign-in, then brings you back here.</p>' });
    sh.el.addEventListener("click", function (e) {
      if (!e.target.closest("[data-x]")) return;
      sh.close();
      S2.signIn();   /* js/live.js: Discord OAuth, identify only, back to the page the member started on */
    });
  }
  /* the look changes in place (no re-render), from Settings or the bar's buttons: the Appearance rows print it, so they
     follow it; each swatch also carries the theme it was drawn for */
  document.addEventListener("s2:look", function () { if (S2.$('[data-w="look"]')) repaint("look", lookInner); });
  S2.page("you", {
    title: function (r) { var t = S2.has("member") && valid(youTabs(), r.q.tab); return t ? tabName(youTabs(), t) : S2.has("member") ? "You" : "Join the league"; },
    tab: "you",
    /* a member's You is a workspace on the gray app canvas; a guest's is a public join page on the white site canvas */
    get mode() { return S2.has("member") ? "app" : "site"; },
    render: function (r) {
      /* the address owns the Inbox filter (&show=, written in place by the segmented control), as the other in-page views
         do: the Action Center's "All your cases" opens it on Cases, and the bell's plain address opens it on All */
      if (r.q.tab === "inbox") ST.filter = KIND.some(function (k) { return k[0] === r.q.show; }) ? r.q.show : "all";
      try { if (!M) throw new Error("S2.M is missing"); return S2.has("member") ? youHtml(r) : guestHtml(); } catch (e) { return fail("You", e); }
    },
    after: function (root, r) { try { after(root, r, "you"); afterReal(root); } catch (e) { console.error("[hq] You failed to wire up", e); } }
  });
  /* this page's own wiring, beside hq.js's dispatcher: its actions are data-ya, so hq.js's never sees them; each pane's
     read starts when its widget is on screen */
  function afterReal(root) {
    var host = S2.$(".hqx", root); if (!host) return;
    host.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ya]"); if (!b || b.disabled) return;
      var x = b.dataset.ya;
      if (x === "all-yes") restYes();
      else if (x === "av-retry") setAvail(b.dataset.g, b.dataset.v);
      else if (x === "lu-reload") { YW.at = 0; ensureWeek(); }
      else if (x === "pf-save") saveProfile();
      else if (x === "pf-reload") { PF.state = "idle"; loadProfile(); }
      else if (x === "wear") wear(b);
      else if (x === "ap-reload") loadApps(true);
      else if (x === "data") dataSheet();
      else if (x === "signout") {
        var sh = sheet({ title: "Sign out?", back: ['[data-ya="signout"]'], html: '<p class="t-body">You can sign back in with Discord at any time.</p><div class="hqx-actions"><button class="btn danger" data-x="out" data-autofocus>Sign out</button><button class="btn secondary" data-x="stay">Cancel</button></div>' });
        sh.el.addEventListener("click", function (ev) { var y = ev.target.closest("[data-x]"); if (!y) return; sh.close(); if (y.dataset.x === "out") S2.signOut(); });
      }
    });
    /* the console-name label follows the console the moment it changes (asking an Xbox player for a PSN name is the wrong
       question); only the label and placeholder change, never the field being typed in */
    host.addEventListener("change", function (e) {
      if (!e.target.dataset || e.target.dataset.pf !== "plat") return;
      var l = S2.$("#yxTagL", host), t = S2.$("#yxTag", host), w = tagLabel(e.target.value);
      if (l) l.textContent = w; if (t) t.placeholder = w;
    });
    if (S2.$('[data-w="yweek"]', host)) ensureWeek();
    if (S2.$('[data-w="dc"]', host)) loadDc();
    if (S2.$('[data-w="lprof"]', host)) loadProfile();
    if (S2.$('[data-w="apps"]', host)) loadApps();
  }
  /* a form filed through e5's flows (js/flows.js fires "s2:filed" after the database confirms): the applications are read
     again, and the sign-up checklist repaints from the league read the filing refreshed */
  document.addEventListener("s2:filed", function (e) {
    var f = e.detail && e.detail.flow;
    if ((f === "owner" || f === "staff") && S2.$('[data-w="apps"]')) loadApps(true);
    if (f === "register" && S2.$('[data-w="s2reg"]')) repaint("s2reg", function () { return s2RegInner(self()); });
  });
  /* what js/pages/hq.js uses from this file, looked up by name when called */
  S2._you = { appsInner: appsInner, dcSheet: dcSheet, dueInner: dueInner, joinSheet: joinSheet,
    lprofInner: lprofInner, s2RegInner: s2RegInner, setAvail: setAvail, withdrawSheet: withdrawSheet, youMeta: youMeta };
})();
