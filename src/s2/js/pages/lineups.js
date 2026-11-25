/* Team HQ's Lineups tab (#/hq?tab=lineups): the night's plan, the playoff panel and the per-game lineup sheet with
   its drag. Moved whole from js/pages/hq.js by the e0 split (2026-11-24), with no change in behavior. Every statement
   below the imports is hq.js's own, byte for byte. It loads after hq.js, js/inbox.js and js/pages/you.js, reads
   hq.js's pieces from S2._hq, and hq.js reaches the functions here, and the open sheet (OPEN, through a getter),
   through S2._lineups.
   v5.00 swap (e2, 2026-11-24): THE LIVE SHEET. In live mode (S2.LIVE, js/core.js) every sheet is the club's real one, read
   from the database, and every change is a database door through S2.write, as on the current site (part6_hub.js
   CG.AFTER._lineup and _lines, part_live.js CG.availSave): set_game_lineup files or changes a sheet, clear_game_lineup
   withdraws it, set_team_line saves a line, set_team_line_night plans a night, availability.upsert answers a game. A GM or
   AGM whose Owner approves lineup moves is sent to the Owner by the database's own gate (mgmt_gate, client-api.md). Nothing
   shows as filed until the database answers with the row; a refusal is shown in the database's own words and the sheet
   keeps what was placed. The sheet's work in progress lives in the shared store (HQ.ST.lu, the same entry the plan rows
   read): L.saved is the six on file, L.slots the six on screen, and L.filed is set while a full six is on file (unsaved
   work on screen is dirty(L), not a lost filing). Season 2's rules are the database's: no weekly limit (Rule S2.7), a full six by each game's lock or the
   game is forfeited (Rule 3.2), at least three of the six from the club and at most three camp players a night (Rule
   S2.5); the page shows each rule and leaves the refusing to the doors.
   v5.00 swap (i3c, 2026-11-25): demo mode is gone, so this is the only sheet: the demo's sample sheets, game-night clock,
   sample playoff series and its box-score button, the rule overrides and the in-tab filing went with it. Nothing on the page
   locks a player out of a sheet: the playoff floor is only marked (hq.js floorShort; the database's count adds private
   credits no page may read) and the series limits are the database's (set_game_lineup refuses in its own words). */
(function () {
  "use strict";
  var S2 = window.S2;
  if (!S2 || !S2.page) return;
  var HQ = S2._hq;
  var M = HQ.M, SLOTS = HQ.SLOTS,
    availWord = HQ.availWord, byNight = HQ.byNight,
    cd = HQ.cd, clock = HQ.clock, club = HQ.club, curNight = HQ.curNight, empty = HQ.empty,
    esc = HQ.esc, filledN = HQ.filledN, head = HQ.head, ic = HQ.ic,
    keep = HQ.keep, lockOf = HQ.lockOf, lockState = HQ.lockState,
    luOf = HQ.luOf, nextInner = HQ.nextInner,
    nightSeg = HQ.nightSeg, now = HQ.now, opp = HQ.opp, planRow = HQ.planRow,
    plural = HQ.plural, readyInner = HQ.readyInner,
    refreshNav = HQ.refreshNav, repaint = HQ.repaint,
    sheet = HQ.sheet, slotOf = HQ.slotOf, stamp = HQ.stamp,
    startTicker = HQ.startTicker, vs = HQ.vs, weekGames = HQ.weekGames;

  /* ======================================== THE SHEET ======================================== */
  var COL = { LW: "lw", C: "center", RW: "rw", LD: "ld", RD: "rd", G: "goalie" }, CAMP_NIGHT = 3;
  /* LV: what was read for one club (code): sheets come into HQ.ST.lu; avail[pid] each roster player's nights; guests[gid]
     and asks[gid] the camp players who accepted or still have to answer that game; lines[slot] and plan[night] the club's
     lines; queued[gid] a sheet sent to the Owner. The viewer's own row is read fresh at each answer (saveAvailability),
     and what You shows of it is MINE (loadMine, below) */
  var LV = { code: null, state: "idle", err: null, p: null, avail: {}, guests: {}, asks: {}, lines: {}, plan: {}, queued: {}, week: null };
  function ls(g) { return lockState(g, now()); }
  function sess() { return S2.session || {}; }
  function seasonId() { var s = M.control && M.control.season(M.view.season); return (s && s.settings && s.settings.id) || null; }
  /* the club's row id: one definition, js/lobby.js S2.lobby.teamId (the seat's own, the model's, else the league body's) */
  function teamIdOf(code) { return S2.lobby.teamId(code); }
  /* a read through f's client (js/live.js S2.ensureSb): an empty answer always means the league answered empty */
  function rd(q) {
    return Promise.resolve().then(function () {
      var c = S2.ensureSb ? S2.ensureSb() : null;
      if (!c) throw new Error("Not connected to the league, so the lineups cannot be read. Reload the page and try again.");
      return q(c);
    }).then(function (r) { if (r && r.error) throw new Error(r.error.message || "The league did not answer."); return (r && r.data) || []; });
  }
  function slotsOf(row) { var o = {}; SLOTS.forEach(function (s) { if (row && row[COL[s]]) o[s] = row[COL[s]]; }); return o; }
  function same(a, b) { return SLOTS.every(function (s) { return (a[s] || null) === (b[s] || null); }); }
  function six(o) { return SLOTS.every(function (s) { return o && o[s]; }); }
  function dirty(L) { return !same(L.slots, L.saved || {}); }
  /* a sheet is set (Rule 3.2, Season 2: a full lineup of six) while six are on file, whatever is on screen: hq.js's plan
     rows, counts and luStatus read L.filed as "on file". Unsaved work is dirty(L), said beside it (planInner), never a
     drop to draft or forfeit (review 2026-11-24: an unsaved swap after the lock read as "Forfeit: no lineup") */
  function sync(L) { L.filed = six(L.saved) ? L.at : null; }
  function histOf(row) {
    if (!row) return [];
    var n = SLOTS.filter(function (s) { return row[COL[s]]; }).length, h = [{ at: Date.parse(row.updated_at), text: n === 6 ? "On file: all six named" : "On file with " + n + " of 6 named, not set" }];
    if (row.post_lock && row.post_lock_at) h.unshift({ at: Date.parse(row.post_lock_at), text: "Changed after the lock" + (row.post_lock_count > 1 ? " (" + row.post_lock_count + " times)" : "") + ", reported to the opponent (Rule 5.3)" });
    return h;
  }
  /* the database's row becomes the sheet; work in progress on screen is kept unless it already matches what was on file */
  function applyRow(code, g, row) {
    var L = luOf(code, g), had = L.saved !== undefined && dirty(L);   /* a sheet never read holds no work */
    L.row = row || null; L.saved = row ? slotsOf(row) : null; L.at = row ? Date.parse(row.updated_at) : null; L.hist = histOf(row);
    if (!had) L.slots = Object.assign({}, L.saved || {});
    sync(L);
    return L;
  }
  /* availability is a week's row per member (week_key w<N>, po<N>, pre<N>); a night is n1, n2, n3 by its place among
     the league's game days of that week, as the current site keys them (part_live.js CG.WEEK8, CG.avGame) */
  function weekKey(g) { return (g.stage === "preseason" ? "pre" : g.stage === "playoff" ? "po" : "w") + g.week; }
  function nightKey(g) {
    var days = []; M.games.forEach(function (x) { if (x.week === g.week && (x.stage || "regular") === (g.stage || "regular") && days.indexOf(x.night) < 0) days.push(x.night); });
    return "n" + (days.sort().indexOf(g.night) + 1);
  }
  function avGame(nights, g) {
    var n = nights && nights[nightKey(g)]; if (!n) return null;
    if (n.games && n.games[g.id]) return n.games[g.id] === "yes" ? "yes" : n.games[g.id] === "no" ? "no" : null;
    if (!n.games || !Object.keys(n.games).length) return n.st === "yes" ? "yes" : n.st === "no" ? "no" : null;
    return null;
  }
  function avail(p, g) { var a = LV.avail[p.id]; return a ? avGame(a, g) : null; }
  function guestsOf(g) { return LV.guests[g.id] || []; }
  /* camp players the club holds across the night (Rule S2.5: three at most), each counted once */
  function nightGuests(code, g) { var o = {}; weekGames(code).forEach(function (x) { if (x.night === g.night) guestsOf(x).forEach(function (id) { o[id] = 1; }); }); return Object.keys(o).length; }
  /* who may dress: the active roster, and in a regular-season game the camp players who accepted THAT game (Rule S2.5) */
  function canDress(code, g) {
    var r = M.roster(code); if (!r) return [];
    var list = g.stage === "playoff" ? r.all : r.active, have = {}; list.forEach(function (p) { have[p.id] = 1; });
    return g.stage === "playoff" ? list : list.concat(guestsOf(g).filter(function (id) { return !have[id]; }).map(function (id) { return M.player(id); }).filter(Boolean));
  }
  function isGuest(g, pid) { return guestsOf(g).indexOf(pid) >= 0; }
  /* Fill from ratings: the club's own players who said Available for this game, best fit first. "No answer yet" counts as a
     no (commissioner, 2026-10-19: "Make the 'No answer yet' treated as a no"); the live site's auto-fill (part6_hub.js
     luAuto) still ranks no-answer players after the yeses. An unrated player sorts below every rated one: the bottom of
     the 75 to 99 scale (v4.48). The one definition since the demo's copy in hq.js (suggest) went (i3c, 2026-11-25) */
  function fit(p, s) { return ((p.ovr && p.ovr.ovr) || M.OVR_FLOOR) + (p.pos === s ? 30 : M.GROUP[p.pos] === M.GROUP[s] ? 18 : M.UNIT[p.pos] === M.UNIT[s] ? 10 : 0); }
  function fill(code, g, slots) {
    var out = {}, used = {}, r = M.roster(code); if (!r) return out;
    SLOTS.forEach(function (s) { if (slots[s]) { out[s] = slots[s]; used[slots[s]] = 1; } });
    ["G", "C", "LD", "RD", "LW", "RW"].forEach(function (s) {
      if (out[s]) return;
      var c = (g.stage === "playoff" ? r.all : r.active).filter(function (p) { return !used[p.id] && !p.suspended && avail(p, g) === "yes" && (s === "G" ? p.pos === "G" : p.pos !== "G"); })
        .sort(function (a, b) { return fit(b, s) - fit(a, s); })[0];
      if (c) { out[s] = c.id; used[c.id] = 1; }
    });
    return out;
  }

  /* one read for the club's week: its sheets, the roster's availability, its camp requests, its lines and night plans.
     Fails loud: a sheet that could not be read is never drawn as empty */
  function load(code) {
    var sid = seasonId(), tid = teamIdOf(code), wk = weekGames(code), ids = wk.map(function (g) { return g.id; }), r = M.roster(code);
    if (!sid || !tid) { LV.code = code; LV.state = "error"; LV.err = new Error("This club or season has no league record to read lineups from."); LV.p = null; return Promise.reject(LV.err); }
    var people = r ? r.all.map(function (p) { return p.id; }) : [], keys = {};
    wk.forEach(function (g) { keys[weekKey(g)] = 1; });
    /* a re-read of the club on screen keeps its sheets drawn until the answer lands */
    if (!(LV.code === code && LV.state === "ready")) { LV.code = code; LV.state = "loading"; }
    LV.err = null;
    var p = LV.p = Promise.all([
      ids.length ? rd(function (c) { return c.from("game_lineups").select("game_id,team_id,center,lw,rw,ld,rd,goalie,updated_at,post_lock,post_lock_at,post_lock_count").eq("team_id", tid).in("game_id", ids); }) : [],
      ids.length && people.length ? rd(function (c) { return c.from("availability").select("profile_id,week_key,nights,submitted_at,late").eq("season_id", sid).in("week_key", Object.keys(keys)).in("profile_id", people); }) : [],
      ids.length ? rd(function (c) { return c.from("market_pool_requests").select("id,game_id,profile_id,status").eq("team_id", tid).in("game_id", ids).in("status", ["pending", "accepted"]); }) : [],
      rd(function (c) { return c.from("team_lines").select("slot,name,lw,center,rw,ld,rd,goalie").eq("season_id", sid).eq("team_id", tid); }),
      rd(function (c) { return c.from("team_line_plan").select("night,slot").eq("season_id", sid).eq("team_id", tid); })
    ]).then(function (x) {
      if (LV.p !== p) return false;   /* a newer read for another club replaced this one */
      var rows = {}; x[0].forEach(function (row) { rows[row.game_id] = row; });
      wk.forEach(function (g) { applyRow(code, g, rows[g.id] || null); });
      LV.avail = {};
      x[1].forEach(function (a) { LV.avail[a.profile_id] = Object.assign(LV.avail[a.profile_id] || {}, a.nights || {}); });
      LV.guests = {}; LV.asks = {};
      x[2].forEach(function (q) { var m = q.status === "accepted" ? LV.guests : LV.asks; (m[q.game_id] = m[q.game_id] || []).push(q.profile_id); });
      LV.lines = {}; x[3].forEach(function (l) { LV.lines[l.slot] = l; });
      LV.plan = {}; x[4].forEach(function (n) { LV.plan[n.night] = n.slot; });
      LV.state = "ready"; LV.at = Date.now();
      return true;
    }, function (e) {
      if (LV.p !== p) return false;
      console.error("S2 lineups: the club's lineups could not be read", e);
      /* a failed re-read leaves the sheets already drawn, and says so; a failed first read draws no sheet at all */
      if (LV.state === "ready" && LV.code === code) S2.toast("The lineups could not be read again: " + e.message + " What is shown may be out of date.", "err");
      else { LV.state = "error"; LV.err = e; }
      throw e;
    });
    return p;
  }
  /* read the club's sheets when its pane or a sheet opens, unless this club was read in the last minute (the pulse
     re-reads it on every roster, score or camp change in between) */
  function ensure(code) {
    if (LV.code === code && (LV.state === "loading" || (LV.state === "ready" && Date.now() - LV.at < 60000))) return;
    reread(code);
  }
  function reread(code) { var done = function () { afterLineupChange(); if (OPEN && !DRAG) paintSheet(); }; load(code).then(done, done); }
  /* the pulse: a roster or score change (a box score, a pulled player, a camp player's answer) re-reads the sheets, and the
     open sheet repaints in place with what was being placed kept */
  ["rosters", "scores", "market"].forEach(function (d) { S2.live.on(d, function () { if (LV.code && LV.state === "ready") ensureAgain(); }); });
  function ensureAgain() { if (LV.code) reread(LV.code); }
  /* the member's OWN answers: v5.00 swap (av, 2026-11-24). The club read above carries only the people on the club's
     roster, so a member it does not list (a camp player, a member just placed, moved or not yet in the league read) read no
     answers at all on You after e2's review fix dropped the viewer from it. MINE is the ONE place You, Your week and Today
     read the member's answers from: their own rows for the weeks asked, for the season on screen, kept per member and
     season (a sign-out or another sign-in starts it over). A confirmed answer (saveAvailability) puts the database's row
     here, so the page repaints with it in place. gen guards a read that left before a save landed from undoing it */
  /* late: each week row's own late flag (stamp_availability sets it on an answer after the week's deadline, staff exempt;
     it never clears), kept beside the nights so a reload still shows a late week (QA nits 35, 2026-11-25) */
  var MINE = { who: null, sid: null, state: "idle", err: null, p: null, weeks: {}, late: {}, read: {}, saved: {}, gen: 0 };
  function mineFor(uid, sid) {
    if (MINE.who !== uid || MINE.sid !== sid) MINE = { who: uid, sid: sid, state: "idle", err: null, p: null, weeks: {}, late: {}, read: {}, saved: {}, gen: 0 };
    return MINE;
  }
  function uniq(keys) { return (keys || []).filter(function (k, i, a) { return k && a.indexOf(k) === i; }); }
  function loadMine(weekKeys) {
    var sid = seasonId(), uid = sess().profileId, keys = uniq(weekKeys);
    if (!uid) return Promise.reject(new Error("Sign in with Discord to read your answers."));
    if (!sid) return Promise.reject(new Error("This season has no league record to read your answers from."));
    if (!keys.length) return Promise.reject(new Error("S2.lineups.loadMine: name the weeks to read."));
    var m = mineFor(uid, sid), g0 = m.gen, had = keys.every(function (k) { return m.read[k]; });
    if (!had) m.state = "loading";
    m.err = null;
    var p = m.p = rd(function (c) { return c.from("availability").select("week_key,nights,late").eq("season_id", sid).eq("profile_id", uid).in("week_key", keys); }).then(function (rows) {
      if (MINE !== m || m.p !== p) return false;   /* another member signed in, or a newer read replaced this one */
      var got = {}, late = {}; rows.forEach(function (r) { got[r.week_key] = r.nights || {}; late[r.week_key] = !!r.late; });
      keys.forEach(function (k) { if ((m.saved[k] || 0) <= g0) { m.weeks[k] = got[k] || null; m.late[k] = !!late[k]; m.read[k] = true; } });
      m.state = "ready";
      return true;
    }, function (e) {
      if (MINE !== m || m.p !== p) return false;
      console.error("S2 lineups: the member's own answers could not be read", e);
      /* a failed re-read leaves the answers already shown, and says so; a failed first read shows none */
      if (had) { m.state = "ready"; S2.toast("Your answers could not be read again: " + e.message + " What is shown may be out of date.", "err"); }
      else { m.state = "error"; m.err = e; }
      throw e;
    });
    return p;
  }
  /* the state of the member's own read for these weeks: idle, loading, ready or error */
  function mineState(weekKeys) {
    var m = MINE, keys = uniq(weekKeys);
    if (m.who !== (sess().profileId || null) || m.sid !== seasonId() || m.who == null) return { state: "idle", error: null };
    if (keys.length && keys.every(function (k) { return m.read[k]; })) return { state: "ready", error: null };
    if (m.state === "error") return { state: "error", error: m.err ? m.err.message : "The league did not answer." };
    return { state: m.state === "loading" ? "loading" : "idle", error: null };
  }
  /* the member's own answer for a game, as the database holds it: "yes", "no" or null (not read, or no answer) */
  function myAnswer(g) {
    var m = MINE; if (!g || m.who !== (sess().profileId || null) || m.sid !== seasonId()) return null;
    var nights = m.weeks[weekKey(g)]; return nights ? avGame(nights, g) : null;
  }
  /* the database's late flag on the member's row for a game's week: true, false, or null (not read) */
  function myLate(g) {
    var m = MINE; if (!g || m.who !== (sess().profileId || null) || m.sid !== seasonId() || !m.read[weekKey(g)]) return null;
    return !!m.late[weekKey(g)];
  }
  function liveWait() {
    if (LV.state === "error") return empty("The lineups could not be read", (LV.err && LV.err.message) || "The league did not answer.") + '<div class="hqx-lu-retry"><button class="btn secondary sm" data-lux="reload">Try again</button></div>';
    return '<p class="t-sub hqx-lu-wait" aria-live="polite">Reading this club\'s lineups…</p>';
  }

  /* availability, live: the member answers a game; the whole week's row goes back, as the current site sends it, with the
     night's summary (st) kept for every reader of the older shape. Resolves after the database confirms; rejects with its
     words. For You, Your week (js/pages/you.js) and Today.
     review 2026-11-24 (a trap): availability.upsert REPLACES nights (neither trigger merges), so the week is built from the
     member's own row read fresh right here, never from what a pane happened to load: built from nothing, one answer wiped
     every other game, night and note of the week. A failed read stops the answer. Answers from this page go one at a time,
     so a second tap cannot read the row before the first one lands.
     shortcut: two tabs answering in the same second can still race (read, then write); a merging RPC closes it if that is
     ever seen */
  var AV_Q = Promise.resolve();
  function saveAvailability(gid, v) {
    var p = AV_Q.then(function () { return saveAvailabilityNow(gid, v); });
    AV_Q = p.then(null, function () {});
    return p;
  }
  function saveAvailabilityNow(gid, v) {
    if (v !== "yes" && v !== "no") return Promise.reject(new Error("An answer is yes or no."));
    var g = M.games.filter(function (x) { return x.id === gid; })[0], sid = seasonId(), uid = sess().profileId;
    if (!g) return Promise.reject(new Error("That game is not on the schedule."));
    if (!sid || !uid) return Promise.reject(new Error("Sign in with Discord to answer."));
    var wk = weekKey(g), nk = nightKey(g);
    return rd(function (c) { return c.from("availability").select("nights").eq("season_id", sid).eq("profile_id", uid).eq("week_key", wk); }).then(null, function (e) {
      throw new Error("Your answers for this week could not be read, so nothing was changed: " + e.message);
    }).then(function (rows) {
      var nights = JSON.parse(JSON.stringify((rows[0] && rows[0].nights) || {})), n = nights[nk] = nights[nk] || {};
      n.games = n.games || {}; n.games[gid] = v;
      var vals = Object.keys(n.games).map(function (k) { return n.games[k]; }), yes = vals.filter(function (x) { return x === "yes"; }).length;
      n.st = !vals.length ? "nr" : yes === vals.length ? "yes" : yes === 0 ? "no" : "part";
      return S2.write("availability.upsert", { row: { season_id: sid, profile_id: uid, week_key: wk, nights: nights }, onConflict: "season_id,profile_id,week_key", select: "id,week_key,nights,late" }).then(function (res) {
        var row = (res.data || [])[0] || {}, m = mineFor(uid, sid);
        LV.avail[uid] = Object.assign(LV.avail[uid] || {}, row.nights || nights);
        /* the database's row is the member's whole week now: You, Your week and Today read it from MINE (loadMine) */
        m.weeks[wk] = row.nights || nights; m.late[wk] = !!row.late; m.read[wk] = true; m.saved[wk] = ++m.gen;
        if (OPEN) paintSheet();
        return res;
      });
    });
  }

  function ownCount(code, L) { var r = M.roster(code), own = {}; (r ? r.active : []).forEach(function (p) { own[p.id] = 1; }); return SLOTS.filter(function (s) { return L.slots[s] && own[L.slots[s]]; }).length; }
  /* set_game_lineup's own test: camp players are at most half of the players named (Rule S2.5) */
  function halfProblem(code, g, L) {
    if (g.stage === "playoff") return null;
    var named = SLOTS.filter(function (s) { return L.slots[s]; }), camp = named.filter(function (s) { return isGuest(g, L.slots[s]); }).length;
    return 2 * camp > named.length ? { text: "At least half of a lineup must be the club's own players: " + camp + " camp players in a lineup of " + named.length + " is too many (Rule S2.5)." } : null;
  }
  function paneLineups(code) {
    var nights = byNight(weekGames(code)); if (!nights.length) return empty("No games ahead", "Lineups open when the schedule has a night for this club.");
    var n = curNight(nights);
    ensure(code);
    /* a playoff round's games are this week's games */
    return '<div class="hqx-stack"><section class="hqx-block"><div class="hqx-tools">' + nightSeg(nights, n, "hqxNightL") + "</div>" +
      '<div data-w="plan">' + planInner(code) + "</div></section>" + '<section class="hqx-block" data-w="lulines">' + linesInner(code) + "</section></div>";
  }
  function planInner(code) {
    var n = curNight(byNight(weekGames(code))), t = now(); if (!n) return "";
    if (LV.state !== "ready") return liveWait();
    var filed = n.games.filter(function (g) { return luOf(code, g).filed; }).length;
    var gn = nightGuests(code, n.games[0]), unsaved = n.games.filter(function (g) { var L = luOf(code, g); return L.saved && dirty(L) && ls(g) !== "underway"; });
      return head({ k: "Week " + n.games[0].week + " · " + filed + " of " + n.games.length + " set", h: esc(n.label),
          p: "Each lineup locks 30 minutes before its puck drop and is published to the opponent; until 10 minutes after puck drop a club may still swap players, and the opponent is told at once (Rule 5.3). A club that has not set a full lineup of six by a game's lock forfeits that game (Rule 3.2)." +
            (n.games[0].stage === "playoff" ? " In the playoffs a player may play four games of a series and two of its first four, goaltenders included (Rule S2.7)." :
              " Camp players tonight: " + gn + " of " + CAMP_NIGHT + "; at least three of each six must be the club's own players (Rule S2.5)."),
          side: '<div class="hqx-plan-acts"><button class="btn secondary sm" data-lux="fill-night">Fill empty spots from ratings</button>' +
            (n.games.some(function (g) { var L = luOf(code, g); return (!L.filed || dirty(L)) && ls(g) !== "underway"; }) ? '<button class="btn sm" data-act="file-night">File all lineups</button>' : "") + "</div>" }) +
        '<div class="list hqx-list hqx-plan-l">' + n.games.map(function (g) { return planRow(code, g, t); }).join("") + "</div>" +
        /* a filed sheet with changes on screen stays filed; the changes are named here until saved or discarded.
           shortcut: said under the rows, not in them (planRow is hq.js's, e1's; handed over to put it in the row) */
        (unsaved.length ? '<p class="t-foot hqx-lu-note" data-lu-unsaved role="status">Unsaved changes: ' + esc(unsaved.map(function (g) { return g.gameNo ? "Game " + g.gameNo : vs(g, code); }).join(", ")) +
          ". What is on file is the lineup of record until the changes are saved.</p>" : "");
  }
  /* why a sheet is not ready for File all lineups ("" when it is): all six spots set (Rules 3.2 and 5.3) and at least half
     of them the club's own (Rule S2.5), the same checks fileLive makes one sheet at a time */
  function fileGap(code, g, L) {
    var missing = SLOTS.filter(function (s) { return !L.slots[s]; });
    /* QA nits 31 (2026-11-25): the half rule counts camp players against the players named, so a partial sheet breaks it
       with two ("more than three pool players" was false there), and the page says camp, not pool */
    if (halfProblem(code, g, L)) return missing.length ? plural(missing.length, "spot") + " empty and too many camp players" : "too many camp players for the half rule";
    return missing.length ? plural(missing.length, "spot") + " empty" : "";
  }
  /* commissioner, 2026-11-09 (File all lineups: "yes"): one press files every ready sheet of the night; a sheet that is
     not ready stays a draft and is named */
  function fileNight(code) {
    var n = curNight(byNight(weekGames(code))); if (!n) return;
    return fileNightLive(code, n);
  }
  /* live: File all lineups sends each ready sheet of the night, one at a time (a club's filings take one lock in the
     database, set_game_lineup), and names every sheet it held back and every refusal in the database's words */
  var NIGHT_BUSY = false;
  function fileNightLive(code, n) {
    if (NIGHT_BUSY) return;
    var jobs = [], held = [], done = [], sent = [], failed = [];
    n.games.forEach(function (g) {
      var L = luOf(code, g), st = ls(g), what = g.gameNo ? "Game " + g.gameNo : vs(g, code); if ((L.filed && !dirty(L)) || st === "underway") return;
      var gap = fileGap(code, g, L); if (gap) { held.push(what + " (" + gap + ")"); return; }
      jobs.push(function () { return sendSheet(code, g, L).then(function (r) { (r.queued ? sent : done).push(what); }, function (e) { failed.push(what + ": " + e.message); }); });
    });
    if (!jobs.length) return S2.toast("Nothing filed. " + (held.length ? "Not ready: " + held.join("; ") + "." : "Every lineup tonight is already set."), held.length ? "err" : undefined);
    NIGHT_BUSY = true;
    var b0 = S2.$('[data-act="file-night"]'); if (b0) { b0.disabled = true; b0.setAttribute("aria-busy", "true"); }
    jobs.reduce(function (p, j) { return p.then(j); }, Promise.resolve()).then(function () {
      NIGHT_BUSY = false; afterLineupChange(); if (OPEN) paintSheet();
      var b = S2.$('[data-act="file-night"]') || S2.$('[data-lux="fill-night"]'); if (b) b.focus();
      var msg = (done.length ? "Filed " + plural(done.length, "lineup") + ". " : "") + (sent.length ? "Sent to your Owner for approval: " + sent.join(", ") + ". " : "") +
        (failed.length ? "Refused: " + failed.join("; ") + ". " : "") + (held.length ? "Not ready: " + held.join("; ") + "." : "");
      S2.toast(msg.trim(), failed.length || held.length ? "err" : "ok");
    });
  }
  /* file or change one sheet: set_game_lineup with the six on screen. The database answers with the sheet as filed, which
     becomes the sheet; a seat whose Owner approves lineup moves is sent to the Owner (resolves {queued: true}). A change
     made while the filing was on its way stays on screen */
  function sendSheet(code, g, L) {
    var tid = teamIdOf(code); if (!tid) return Promise.reject(new Error("This club has no league record to file for."));
    var sent = Object.assign({}, L.slots);
    var args = { p_game: g.id, p_team: tid, p_center: sent.C || null, p_lw: sent.LW || null, p_rw: sent.RW || null, p_ld: sent.LD || null, p_rd: sent.RD || null, p_goalie: sent.G || null, p_emergency: ls(g) !== "open" };
    return S2.write("set_game_lineup", args, { approval: "owner" }).then(function (res) {
      if (res.queued) { LV.queued[g.id] = Date.now(); return res; }
      delete LV.queued[g.id];
      var row = res.data;
      if (!row || row.game_id !== g.id) { ensureAgain(); return res; }   /* filed, but the answer did not carry the sheet: read it */
      if (same(L.slots, sent)) L.slots = slotsOf(row);
      applyRow(code, g, row);
      return res;
    });
  }

  /* ---- the per-game sheet: drag or tap players into LW C RW / LD RD / G; springs carry every move ---- */
  var OPEN = null;
  function gameById(id) { return M.games.filter(function (g) { return g.id === id; })[0] || null; }
  function openSheet(code, gid) {
    var g = gameById(gid); if (!g) { S2.toast("That game is not on the schedule", "err"); return; }
    var o = opp(g, code);
    OPEN = { code: code, g: g, sel: null };
    ensure(code);
    /* the body goes in at creation, so a phone sheet measures its real height and rises from fully below; the actions sit
       in a footer outside the scrolling body (moved there after the kit measures), so nothing scrolls under them */
    var sh = sheet({ title: (g.gameNo ? "Game " + g.gameNo + " · " : "") + (g.home === code ? code + " vs " + o : code + " at " + o) + " · " + g.time, label: code + " lineup " + vs(g, code) + ", " + g.date,
      back: ['[data-act="sheet"][data-g="' + gid + '"]'],
      html: '<div class="hqx-sh" data-g="' + gid + '">' + sheetBody() + '</div><div class="hqx-sh-foot">' + sheetFoot() + "</div>", onClose: function () { OPEN = null; DRAG && endDrag(); } });
    var foot = S2.$(".hqx-sh-foot", sh.el); sh.el.appendChild(foot);
    sh.el.classList.add("hqx-lineup"); sh.el.setAttribute("tabindex", "-1");   /* the dialog itself is focus's last stand-in */
    OPEN.sh = sh; OPEN.host = S2.$(".hqx-sh", sh.el); OPEN.foot = foot;
    sh.el.addEventListener("click", onSheetClick);
    sh.el.addEventListener("pointerdown", onDown);
    startTicker();
  }
  /* who may change this sheet now: live, nobody once the game is under way but the league office (set_game_lineup, v3.79) */
  function readOnly() { return ls(OPEN.g) === "underway" && !sess().isCommissioner; }
  function sheetBody() {
    var o = OPEN, code = o.code, g = o.g; if (LV.state !== "ready" || LV.code !== code) return liveWait();
    var L = luOf(code, g), st = ls(g), k = lockOf(g), opc = opp(g, code), ro = readOnly(), n = filledN(L), po = g.stage === "playoff", q = LV.queued[g.id];
    var bench = canDress(code, g).filter(function (p) { return !slotOf(L, p.id); }), guests = guestsOf(g), asks = (LV.asks[g.id] || []);
    var line = function (cls, icon, a, b) { return '<div class="hqx-sh-st' + (cls ? " " + cls : "") + '"><span class="hqx-tile ' + (cls || "mute") + '">' + ic(icon) + '</span><span class="grow"><span class="t-sub hqx-ink">' + a + '</span><span class="t-foot">' + b + "</span></span></div>"; };
    /* Rule 3.2 (Season 2, every stage): no full six on file at the game's own lock forfeits it; said before the lock too */
    var banner = st === "open" ? line("", "clock", L.filed ? "Set: all six are on file. You can still change it or withdraw it." : L.saved ? "On file with " + filledN({ slots: L.saved }) + " of 6 named: not set yet." : "Not set yet.",
        "Locks in " + cd(k.lock) + " at " + esc(clock(k.lock)) + ", then " + esc(opc) + " can see it. A club that has not set a full lineup of six by the lock forfeits this game (Rule 3.2).") :
      !six(L.saved) ? line("bad", "lock", "No full lineup of six was on file at the " + esc(clock(k.lock)) + " lock.", "A club that has not set a full lineup for a game by its lock forfeits that game (Rule 3.2).") :
      st === "locked" ? line("warn", "lock", "Published to " + esc(opc) + " at " + esc(clock(k.lock)) + ".", "A swap now is reported to " + esc(opc) + " at once (Rule 5.3). Changes close in " + cd(k.close) + ".") :
      line("", "lock", "Under way.", "Who played is read from the box score (Rule 5.3)." + (ro ? "" : " The league office may still change the sheet while the game is scheduled."));
    if (dirty(L)) banner += '<p class="t-foot hqx-lu-note" role="status">' + (L.saved ? "Your changes are not saved yet; what is on file is what " + esc(opc) + " will see." : "Nothing here is on file until you file it.") + "</p>";
    if (q) banner += '<p class="t-foot hqx-lu-note" role="status">Sent to your Owner for approval at ' + esc(clock(q)) + ". It is not on file until they approve it; a game without a full six at its lock is forfeited (Rule 3.2).</p>";
    if (po) banner += '<p class="t-foot hqx-po-note">A player may play four games of a series and two of its first four, goaltenders included, counted from the box scores; the league refuses a sheet past either limit (Rule S2.7). A player short of the playoff floor at their signed-up position group stays on the bench (Rule 8.3).</p>';
    var units = [["F", "Forwards"], ["D", "Defense"], ["G", "Goaltenders"]], lines = [1, 2, 3].filter(function (x) { return LV.lines[x]; });
    var own = ownCount(code, L), counter = po ? "" : '<p class="hqx-own' + (own < 3 && n >= 4 ? " is-short" : "") + '" aria-live="polite"><b class="num">' + own + "</b> of 6 from your club (minimum 3)</p>";
    var tag = function (id) { return esc((M.player(id) || {}).tag || "a camp player"); };
    return banner +
      '<div class="hqx-rink" role="group" aria-label="Lineup spots">' + [["f", ["LW", "C", "RW"]], ["d", ["LD", "RD"]], ["g", ["G"]]].map(function (row) {
        return '<div class="hqx-rink-row ' + row[0] + '">' + row[1].map(function (s2) { return slotHtml(code, g, L, s2, ro); }).join("") + "</div>"; }).join("") + "</div>" +
      (ro ? "" : '<div class="hqx-sh-tools"><p class="t-foot hqx-hint">' + (o.sel ? (o.sel.slot ? "Tap another spot to move " : "Tap a spot for ") + esc((M.player(o.sel.pid) || {}).tag || "the player") + ", or tap them again to cancel." : "Tap a player, then a spot. Or drag a player onto a spot.") + "</p>" +
        '<span class="hqx-sh-tb">' + (n < 6 ? '<button class="btn secondary sm" data-x="fill">Fill from ratings</button>' : "") +
          lines.map(function (x) { return '<button class="btn secondary sm" data-x="line-fill" data-n="' + x + '">Fill from ' + esc(LV.lines[x].name || "line " + x) + "</button>"; }).join("") +
          (n ? '<button class="btn plain sm" data-x="save-line">Save as a line</button>' : "") + (n && !(st !== "open" && L.filed) ? '<button class="btn plain sm" data-x="clear">Clear</button>' : "") + "</span></div>") +
      counter + (po ? "" : '<div class="hqx-pooled"><p class="t-foot">' + (guests.length ? "Camp players who accepted this game: " + guests.map(tag).join(", ") + ". They are on the bench for this game only. " : "No camp player has accepted this game. ") +
        (asks.length ? "Waiting for an answer: " + asks.map(tag).join(", ") + ". " : "") + "A club may use up to three camp players a night (" + nightGuests(code, g) + " of 3 tonight), and at least three of each six must be its own players (Rule S2.5). Requests are made on the site and close at the night's lock.</p>" +
        (st === "open" ? '<a class="btn secondary sm" href="#/camp">Request a camp player</a>' : "") + "</div>") +
      '<div class="hqx-bench' + (o.sel && o.sel.slot ? " is-target" : "") + '" data-bench>' + units.map(function (u) {
        var list = bench.filter(function (p) { return p.unit === u[0]; });
        return list.length ? '<div class="hqx-bench-g"><h4 class="t-cap">' + u[1] + '</h4><div class="hqx-chips">' + list.map(function (p) { return chipHtml(code, g, p, ro); }).join("") + "</div></div>" : "";
      }).join("") + (bench.length ? "" : '<p class="t-foot">Everyone who can dress is in this lineup.</p>') + "</div>" +
      (L.hist.length ? '<div class="hqx-hist"><h4 class="t-cap">History</h4><ol>' + L.hist.map(function (h) { return '<li><span class="num t-foot">' + esc(stamp(h.at).replace(/^[A-Za-z]+, /, "")) + '</span><span class="t-sub hqx-ink">' + esc(h.text) + "</span></li>"; }).join("") + "</ol></div>" : "");
  }
  function sheetFoot() {
    var o = OPEN, L = luOf(o.code, o.g), st = ls(o.g), dis = o.busy ? ' disabled aria-busy="true"' : "", ch = dirty(L);
    if (LV.state !== "ready" || readOnly()) return '<p class="hqx-err" role="alert"></p>';
    var b = (o.sel && o.sel.slot && !(st !== "open" && L.filed) ? '<button class="btn secondary" data-x="bench">Move to bench</button>' : "") +
      (ch || !L.saved ? '<button class="btn" data-x="file"' + dis + ">" + (L.saved ? (st === "open" ? "Save changes" : "Save the swap") : st === "open" ? "File lineup" : "File now") + "</button>" : "") +
      (ch && L.saved ? '<button class="btn secondary" data-x="discard"' + dis + ">Discard changes</button>" : "") +
      (!ch && L.saved && st === "open" ? '<button class="btn danger" data-x="withdraw"' + dis + ">Withdraw sheet</button>" : "");
    return '<p class="hqx-err" role="alert"></p>' + (b ? '<div class="hqx-actions">' + b + "</div>" : "");
  }
  function slotHtml(code, g, L, s, ro) {
    var pid = L.slots[s], p = pid && M.player(pid), flags = [], sel = OPEN.sel && OPEN.sel.slot === s;
    if (p) {
      if (avail(p, g) === "no") flags.push(["warn", "Said not available"]);
      if (p.suspended) flags.push(["loss", "Suspended"]);
      if (s === "G" && p.pos !== "G") flags.push(["", "Skater in goal"]); else if (s !== "G" && p.pos === "G") flags.push(["", "Goaltender skating"]);
      else if (M.GROUP[p.pos] !== M.GROUP[s]) flags.push(["", "Off position"]);
      if (g.stage !== "playoff" && isGuest(g, pid)) flags.push(["", "Camp, this game"]);
    }
    return '<button class="hqx-slot' + (p ? " is-full" : "") + (sel ? " is-sel" : "") + '" data-slot="' + s + '"' + (p ? ' data-pid="' + pid + '"' : "") + (ro ? ' data-ro="1"' : "") +
      ' aria-label="' + esc(M.posName(s) + ": " + (p ? p.tag + (flags.length ? ", " + flags.map(function (f) { return f[1]; }).join(", ") : "") : "empty")) + '"' + (sel ? ' aria-pressed="true"' : "") + ">" +
      '<span class="hqx-slot-pos">' + s + "</span>" +
      (p ? '<span class="hqx-slot-card" data-fpid="' + pid + '"><span class="num hqx-slot-n">' + (p.num != null ? "#" + p.num : "") + '</span><span class="hqx-slot-tag" title="' + esc(p.tag) + '">' + esc(p.tag) + '</span><span class="hqx-slot-sub">' + esc(p.pos) + (p.ovr ? " · " + p.ovr.ovr : "") + "</span>" +
        (flags.length ? '<span class="hqx-flags">' + flags.map(function (f) { return '<span class="hqx-flag ' + f[0] + '">' + esc(f[1]) + "</span>"; }).join("") + "</span>" : "") + "</span>" :
        '<span class="hqx-slot-empty">' + esc(M.posName(s)) + "</span>") + "</button>";
  }
  /* the bench chip: its availability for this game; no lock and no weekly count (Season 2 has no weekly limit, Rule S2.7) */
  function chipHtml(code, g, p, ro) {
    var a = avail(p, g), sel = OPEN.sel && OPEN.sel.pid === p.id && !OPEN.sel.slot, camp = isGuest(g, p.id);
    return '<button class="hqx-chip' + (sel ? " is-sel" : "") + (a === "no" ? " is-no" : "") + '" data-pid="' + p.id + '" aria-pressed="' + !!sel + '"' + (ro ? ' data-ro="1"' : "") +
      ' aria-label="' + esc(p.tag + ", " + p.posName + ", " + availWord(a) + (camp ? ", camp player for this game" : "") + (p.suspended ? ", suspended" : "")) + '">' +
      '<span class="hqx-chip-in" data-fpid="' + p.id + '"><span class="hqx-grip" data-grip aria-hidden="true">' + ic("grip") + '</span><span class="num hqx-chip-n">' + (p.num != null ? p.num : "") + "</span>" +
      '<span class="hqx-chip-m"><span class="hqx-chip-t" title="' + esc(p.tag) + '">' + esc(p.tag) + '</span><span class="hqx-chip-s">' +
        esc(p.pos + (p.ovr ? " · " + p.ovr.ovr : "") + (camp ? " · camp, this game" : "") + (p.suspended ? " · suspended" : "")) + "</span></span>" +
      '<span class="hqx-chip-r"><i class="hqx-adot ' + (a || "none") + '" aria-hidden="true"></i></span></span></button>';
  }
  /* every edit: mutate, then repaint in place (FLIP from ov, with vel). The work stays on screen until it is filed
     (sendSheet); a sheet published at the lock keeps six (Rule 5.3), so an edit that empties a spot then is refused and
     the card springs home */
  function commit(mut, ov, vel) {
    var o = OPEN, L = luOf(o.code, o.g), was = {}, k;
    for (k in L.slots) was[k] = L.slots[k];
    mut(L);
    var hole = SLOTS.filter(function (x) { return !L.slots[x]; });
    if (hole.length && ls(o.g) !== "open" && six(L.saved)) { L.slots = was; paintSheet(ov, vel); return err("A published lineup keeps all six spots (Rule 5.3). Swap a player in instead of leaving " + hole.join(", ") + " empty."); }
    sync(L); paintSheet(ov, vel); afterLineupChange();
  }
  function afterLineupChange() {
    var code = LV.code || club();
    if (S2.$('[data-w="lulines"]')) repaint("lulines", function () { return linesInner(code); });
    if (S2.$('[data-w="plan"]')) repaint("plan", function () { return planInner(code); });
    if (S2.$('[data-w="next"]')) repaint("next", function () { return nextInner(code); });
    if (S2.$('[data-w="ready"]')) repaint("ready", function () { return readyInner(code); });
    refreshNav();
  }
  /* FLIP with springs: capture where every player card is, repaint, then let each card spring from its old place */
  function rects() { var m = {}; if (OPEN) S2.$$("[data-fpid]", OPEN.host).forEach(function (el) { m[el.dataset.fpid] = el.getBoundingClientRect(); }); return m; }
  function paintSheet(override, vel) {
    if (!OPEN) return;
    var prev = rects(), k, O = OPEN; if (override) for (k in override) prev[k] = override[k];
    keep(O.sh.el, function () { O.host.innerHTML = sheetBody(); O.foot.innerHTML = sheetFoot(); }, O.sh.el);
    if (S2.reduce.matches) return;
    S2.$$("[data-fpid]", OPEN.host).forEach(function (el) {
      var a = prev[el.dataset.fpid]; if (!a) return;
      var b = el.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top; if (Math.abs(dx) + Math.abs(dy) < 1.5) return;
      var v = (vel && vel[el.dataset.fpid]) || [0, 0], x = dx, y = dy, rest = 0;
      var put = function () { el.style.transform = "translate(" + x.toFixed(2) + "px," + y.toFixed(2) + "px)"; };
      var done = function () { if (++rest === 2) { el.style.transform = ""; el.classList.remove("is-flying"); } };
      el.classList.add("is-flying"); put();
      /* a card thrown by a drag keeps the finger's speed and settles with a little give; a tap-placed card does not bounce */
      var damp = vel && vel[el.dataset.fpid] ? 0.8 : 1;
      S2.spring({ from: dx, damping: damp, response: 0.34, onUpdate: function (n) { x = n; put(); }, onRest: done }).to(0, v[0]);
      S2.spring({ from: dy, damping: damp, response: 0.34, onUpdate: function (n) { y = n; put(); }, onRest: done }).to(0, v[1]);
    });
  }
  function place(L, pid, to, fromSlot) {   /* bench to spot replaces (the occupant returns to the bench); spot to spot swaps */
    var there = L.slots[to];
    if (fromSlot) { if (there) L.slots[fromSlot] = there; else delete L.slots[fromSlot]; }
    L.slots[to] = pid;
  }
  function err(msg) { var e = OPEN && S2.$(".hqx-err", OPEN.foot); if (e) e.textContent = msg || ""; }
  function onSheetClick(e) {
    if (!OPEN) return;
    if (JUST_DRAGGED) { JUST_DRAGGED = false; return; }
    var o = OPEN, L = luOf(o.code, o.g), x = e.target.closest("[data-x]"), slot = e.target.closest(".hqx-slot"), chip = e.target.closest(".hqx-chip");
    if (x) return sheetAction(x.dataset.x, L, x);
    if (o.busy) return;   /* a filing is on its way: the sheet holds still until the league answers */
    if (readOnly()) { if (slot || chip) underwayLock(); return; }
    if (chip) {
      o.sel = o.sel && o.sel.pid === chip.dataset.pid && !o.sel.slot ? null : { pid: chip.dataset.pid }; return paintSheet();
    }
    if (slot) {
      var s = slot.dataset.slot;
      if (o.sel) {
        if (o.sel.slot === s) { o.sel = null; return paintSheet(); }
        var sel = o.sel; o.sel = null;
        return commit(function (LL) { place(LL, sel.pid, s, sel.slot || null); });
      }
      if (L.slots[s]) { o.sel = { pid: L.slots[s], slot: s }; return paintSheet(); }
      err("Pick a player from the bench first, then tap this spot."); return;
    }
    if (e.target.closest("[data-bench]") && o.sel && o.sel.slot) { var s2 = o.sel.slot; o.sel = null; commit(function (LL) { delete LL.slots[s2]; }); }
  }
  function sheetAction(x, L, el) {
    var o = OPEN;
    if (o.busy) return;
    if (x === "fill") { o.sel = null; var nx = fill(o.code, o.g, L.slots); if (filledN({ slots: nx }) === filledN(L)) return err("No one else on the roster has said they are available for this game, so the empty spots stay open."); return commit(function (LL) { LL.slots = nx; }); }
    if (x === "line-fill") return lineFill(L, +el.dataset.n);
    if (x === "save-line") return saveLineSheet(o.code, L);
    if (x === "discard") { o.sel = null; L.slots = Object.assign({}, L.saved || {}); sync(L); paintSheet(); afterLineupChange(); return; }
    if (x === "withdraw") return withdrawLive();
    if (x === "file") return fileLive();
    if (x === "bench" && o.sel && o.sel.slot) { var s = o.sel.slot; o.sel = null; return commit(function (LL) { delete LL.slots[s]; }); }
    if (x === "clear") { o.sel = null; return commit(function (LL) { LL.slots = {}; }); }
  }
  function underwayLock() { return err("This game is under way, so its lineup is closed. Who played is read from the box score (Rule 5.3)."); }
  /* ---- live doors for the open sheet ---- */
  function busy(on) { if (!OPEN) return; OPEN.busy = on; OPEN.foot.innerHTML = sheetFoot(); }
  /* File lineup / Save changes: six on screen, at least half from the club; then the door */
  function fileLive() {
    var o = OPEN, code = o.code, g = o.g, L = luOf(code, g), missing = SLOTS.filter(function (s) { return !L.slots[s]; });
    var half = halfProblem(code, g, L); if (half) return err(half.text);
    if (missing.length) return err("A lineup is set only with all six spots named: three forwards, two defense and a goaltender. Still empty: " + missing.join(", ") + ". A club without a full six at the lock forfeits the game (Rule 3.2).");
    busy(true);
    sendSheet(code, g, L).then(function (res) {
      if (!OPEN || OPEN.g !== g) return afterLineupChange();
      OPEN.busy = false; OPEN.sel = null; paintSheet(); afterLineupChange();
      S2.toast(res.queued ? "Sent to your Owner for approval. It is not on file until they approve it." : ls(g) === "open" ? "Lineup filed" : "Saved and reported to " + opp(g, code), "ok");
    }, function (e) { if (OPEN && OPEN.g === g) { busy(false); err(e.message); } else S2.toast(e.message, "err"); });
  }
  /* Withdraw sheet: clear_game_lineup, before the lock only (the database refuses after it). review 2026-11-24: asked
     first, as the current site does (part6_hub.js luRemove, CG.confirm "Withdraw this lineup?"), because a withdrawal not
     filed again by the lock forfeits the game (Rule 3.2, Season 2). The six stay on screen as unsaved work, so one tap
     files them again; clear_game_lineup answers false when nothing was on file, and that is said */
  function withdrawLive() {
    var o = OPEN, code = o.code, g = o.g, tid = teamIdOf(code), k = lockOf(g);
    if (ls(g) !== "open") return err("A lineup can be withdrawn only before it locks (Rule 5.3).");
    if (!tid) return err("This club has no league record to change.");
    S2.confirm({ title: "Withdraw this lineup?", danger: true, ok: "Withdraw", cancel: "Keep it",
      why: ["The six come off " + (g.gameNo ? "Game " + g.gameNo + ", " : "") + vs(g, code) + " at " + g.time + " ET, and the game is no longer set.",
        "File a full lineup again before it locks at " + clock(k.lock) + ", or the club forfeits the game (Rule 3.2)."],
      onOk: function () { withdrawNow(code, g, tid); } });
  }
  function withdrawNow(code, g, tid) {
    if (OPEN && OPEN.g === g) busy(true);
    S2.write("clear_game_lineup", { p_game: g.id, p_team: tid }).then(function (res) {
      var L = luOf(code, g), was = Object.assign({}, L.slots);
      applyRow(code, g, null); L.slots = was; sync(L);
      if (OPEN && OPEN.g === g) { OPEN.busy = false; OPEN.sel = null; paintSheet(); }
      afterLineupChange();
      S2.toast(res.data === false ? "There was no lineup on file for this game, so nothing was withdrawn." :
        "Lineup withdrawn. The six are still on screen: file them again before the " + clock(lockOf(g).lock) + " lock, or the game is forfeited (Rule 3.2).", res.data === false ? "err" : "ok");
    }, function (e) { if (OPEN && OPEN.g === g) { busy(false); err(e.message); } else S2.toast(e.message, "err"); });
  }
  /* Fill from a line: the line's players replace the work in progress (the current site's fill-from-plan rule), except
     anyone who cannot dress for this game, who is named */
  function lineFrom(code, g, n) {
    var l = LV.lines[n], ok = {}, slots = {}, skipped = []; if (!l) return null;
    canDress(code, g).forEach(function (p) { if (!p.suspended) ok[p.id] = 1; });
    SLOTS.forEach(function (s) { var id = l[COL[s]]; if (!id) return; if (ok[id]) slots[s] = id; else skipped.push((M.player(id) || {}).tag || "a player"); });
    return { slots: slots, skipped: skipped, name: l.name || "Line " + n };
  }
  function lineFill(L, n) {
    var o = OPEN, f = lineFrom(o.code, o.g, n); if (!f) return err("That line is no longer saved.");
    o.sel = null; commit(function (LL) { LL.slots = f.slots; });
    if (f.skipped.length) err(f.skipped.join(", ") + " cannot dress for this game and stayed off the sheet.");
  }
  /* Save as a line: set_team_line, one of the club's three lines (the club's own players only, by the database) */
  function saveLineSheet(code, L) {
    var opts = [1, 2, 3].map(function (n) { var l = LV.lines[n]; return '<option value="' + n + '">Line ' + n + (l ? (l.name ? ", " + esc(l.name) : "") + " (replace it)" : " (empty)") + "</option>"; }).join("");
    var sh = sheet({ title: "Save as a line", back: ['[data-x="save-line"]'], html: '<div class="hqx-lusave"><p class="t-sub">Saves the players on this sheet as one of the club\'s three lines, to fill a sheet from later. A line holds the club\'s own players only.</p>' +
      '<label class="hqx-srv-f"><span class="t-foot">Line</span><select class="input" data-ls="slot">' + opts + '</select></label>' +
      '<label class="hqx-srv-f"><span class="t-foot">Name, if you like</span><input class="input" data-ls="name" maxlength="40" autocomplete="off"></label>' +
      '<p class="hqx-err" role="alert"></p><div class="hqx-actions"><button class="btn" data-ls="save">Save line</button></div></div>' });
    var slots = Object.assign({}, L.slots);
    sh.el.addEventListener("click", function (e) {
      var b = e.target.closest('[data-ls="save"]'); if (!b || b.disabled) return;
      var n = +S2.$('[data-ls="slot"]', sh.el).value, name = S2.$('[data-ls="name"]', sh.el).value.trim(), say = S2.$(".hqx-err", sh.el);
      b.disabled = true; b.setAttribute("aria-busy", "true"); say.textContent = "";
      S2.write("set_team_line", { p_season: seasonId(), p_team: teamIdOf(code), p_slot: n, p_name: name || null, p_lw: slots.LW || null, p_center: slots.C || null, p_rw: slots.RW || null,
        p_ld: slots.LD || null, p_rd: slots.RD || null, p_goalie: slots.G || null }, { approval: "owner" }).then(function (res) {
        if (!res.queued) LV.lines[n] = res.data && res.data.slot ? res.data : { slot: n, name: name || null, lw: slots.LW || null, center: slots.C || null, rw: slots.RW || null, ld: slots.LD || null, rd: slots.RD || null, goalie: slots.G || null };
        sh.close(); repaint("lulines", function () { return linesInner(code); }); if (OPEN) paintSheet();
        S2.toast(res.queued ? "Sent to your Owner for approval." : "Line " + n + " saved", "ok");
      }, function (er) { b.disabled = false; b.removeAttribute("aria-busy"); say.textContent = er.message; });
    });
  }
  /* the night's line (set_team_line_night): Fill empty spots for that night starts from it */
  function nightOf(g) { return new Date(g.at).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" }).toLowerCase(); }
  function linesInner(code) {
    if (LV.state !== "ready") return "";
    var n = curNight(byNight(weekGames(code))); if (!n) return "";
    var nk = nightOf(n.games[0]), cur = LV.plan[nk] || "", saved = [1, 2, 3].filter(function (x) { return LV.lines[x]; });
    var who = function (l) { return SLOTS.map(function (s) { var p = M.player(l[COL[s]]); return p ? s + " " + p.tag : null; }).filter(Boolean).join(" · ") || "Empty"; };
    return head({ k: "Lines", size: "d-2 sec-h-sm", h: saved.length ? plural(saved.length, "line") + " saved" : "No lines saved yet",
        p: "A line is a saved six, private to the club's front office. Save one from a lineup sheet; Fill empty spots for a night starts from that night's line, then fills the rest from ratings." }) +
      (saved.length ? '<div class="list hqx-list">' + saved.map(function (x) { var l = LV.lines[x]; return '<div class="row"><span class="grow"><span class="title">' + esc(l.name || "Line " + x) + '</span><span class="sub">' + esc(who(l)) + "</span></span></div>"; }).join("") + "</div>" +
        '<label class="hqx-srv-f hqx-lu-night"><span class="t-foot">Line for ' + esc(n.label.split(",")[0]) + '</span><select class="input" data-lux="night-line" data-night="' + nk + '">' +
          [["", "No line"]].concat(saved.map(function (x) { return [String(x), LV.lines[x].name || "Line " + x]; })).map(function (o) { return '<option value="' + o[0] + '"' + (String(cur) === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>" : "");
  }
  /* Fill empty spots from ratings, live: each open sheet of the night starts from the night's line, then ratings; nothing
     is filed until File all lineups or the sheet's own File */
  function fillNightLive(code) {
    var n = curNight(byNight(weekGames(code))), changed = 0; if (!n) return;
    var plan = LV.plan[nightOf(n.games[0])];
    n.games.forEach(function (g) {
      var L = luOf(code, g); if (ls(g) !== "open") return;
      var base = Object.assign({}, L.slots), f = plan ? lineFrom(code, g, plan) : null;
      if (f) SLOTS.forEach(function (s) { var id = f.slots[s]; if (!base[s] && id && avail(M.player(id) || {}, g) === "yes" && slotOf({ slots: base }, id) == null) base[s] = id; });
      var nx = fill(code, g, base); if (filledN({ slots: nx }) > filledN(L)) { L.slots = nx; sync(L); changed++; }
    });
    afterLineupChange();
    S2.toast(changed ? "Filled " + plural(changed, "sheet") + (plan ? " from the night's line and ratings" : " from ratings") + ", with players who said they are available. Review, then file each one." : "Nothing to fill: no one else has said they are available", changed ? "ok" : undefined);
  }
  /* the pane's controls are this file's own (data-lux), so hq.js's dispatcher never sees them */
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-lux]"); if (!b || b.tagName === "SELECT") return;
    if (b.dataset.lux === "reload") return ensureAgain();
    if (b.dataset.lux === "fill-night" && LV.code) return fillNightLive(LV.code);
  });
  document.addEventListener("change", function (e) {
    var el = e.target; if (!el.dataset || el.dataset.lux !== "night-line" || !LV.code) return;
    var code = LV.code, nk = el.dataset.night, v = el.value ? +el.value : null, was = LV.plan[nk] || "";
    el.disabled = true;
    /* the select stays under the finger; it is put back if the league refuses */
    S2.write("set_team_line_night", { p_season: seasonId(), p_team: teamIdOf(code), p_night: nk, p_slot: v }, { approval: "owner" }).then(function (res) {
      el.disabled = false;
      if (res.queued) { el.value = String(was); return S2.toast("Sent to your Owner for approval.", "ok"); }
      if (v) LV.plan[nk] = v; else delete LV.plan[nk];
      S2.toast(v ? (LV.lines[v].name || "Line " + v) + " is this night's line" : "This night has no line now", "ok");
    }, function (er) { el.disabled = false; el.value = String(was); S2.toast(er.message, "err"); });
  });

  /* drag: a mouse drags a card from anywhere on it; a finger drags from the grip (so the bench still scrolls) or a filled spot */
  var DRAG = null, JUST_DRAGGED = false;
  function onDown(e) {
    if (!OPEN || DRAG || e.button > 0 || OPEN.busy || readOnly()) return;   /* one finger at a time */
    var src = e.target.closest(".hqx-chip, .hqx-slot.is-full"); if (!src || src.disabled) return;
    if (e.pointerType !== "mouse" && src.classList.contains("hqx-chip") && !e.target.closest("[data-grip]")) return;
    var vis = S2.$("[data-fpid]", src) || src, r = vis.getBoundingClientRect();
    DRAG = { src: src, vis: vis, pid: src.dataset.pid, from: src.dataset.slot || null, x0: e.clientX, y0: e.clientY, gx: e.clientX - r.left, gy: e.clientY - r.top, r: r, on: false, hist: [], id: e.pointerId, x: r.left, y: r.top };
    window.addEventListener("pointermove", onMove, { passive: false }); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
  }
  function onMove(e) {
    var d = DRAG; if (!d || e.pointerId !== d.id) return;
    if (!d.on) {
      if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 6) return;   /* a few pixels of hysteresis before it counts as a drag */
      d.on = true; OPEN.sel = null; err("");
      var c = d.vis.cloneNode(true); c.classList.add("hqx-ghost"); c.style.width = d.r.width + "px"; c.style.height = d.r.height + "px";
      document.body.appendChild(c); d.ghost = c; d.vis.classList.add("is-lifted");
    }
    e.preventDefault();
    d.x = e.clientX - d.gx; d.y = e.clientY - d.gy;   /* 1:1 from the grab point */
    /* QA motion 16 (2026-11-25): position rides the translate property and the lift rides scale, so hq.css can lift the
       ghost once from the pressed card (.97, @starting-style) to 1.04 instead of popping 7% in one frame. Not transform:
       a transform translate would be scaled by the scale property and drift 4% from the finger */
    d.ghost.style.translate = d.x + "px " + d.y + "px";
    d.hist.push({ x: e.clientX, y: e.clientY, t: performance.now() }); if (d.hist.length > 6) d.hist.shift();
    var over = dropAt(e.clientX, e.clientY);
    S2.$$(".is-over", OPEN.host).forEach(function (el) { if (el !== over) el.classList.remove("is-over"); });
    if (over) over.classList.add("is-over");
  }
  function dropAt(x, y) {
    var el = document.elementFromPoint(x, y), s = el && el.closest(".hqx-slot");
    if (s && OPEN.host.contains(s)) return s;
    var b = el && el.closest("[data-bench]");
    return b && DRAG && DRAG.from && OPEN.host.contains(b) ? b : null;
  }
  function onUp(e) {
    var d = DRAG; if (!d || (e && e.pointerId !== d.id)) return;
    window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp);
    if (!d.on) { DRAG = null; return; }
    JUST_DRAGGED = true; setTimeout(function () { JUST_DRAGGED = false; }, 60);
    var a = d.hist[0], b = d.hist[d.hist.length - 1], dt = a && b ? Math.max(16, b.t - a.t) : 16;
    var vx = a ? (b.x - a.x) / dt * 1000 : 0, vy = a ? (b.y - a.y) / dt * 1000 : 0;   /* px/s at release */
    var target = e && e.type === "pointerup" ? dropAt(e.clientX, e.clientY) : null, ghostRect = d.ghost.getBoundingClientRect();
    S2.$$(".is-over", OPEN ? OPEN.host : document).forEach(function (el) { el.classList.remove("is-over"); });
    if (target && OPEN && (target.dataset.slot ? target.dataset.slot !== d.from : d.from)) {
      var ov = {}, vel = {}; ov[d.pid] = ghostRect; vel[d.pid] = [vx, vy];
      d.ghost.remove(); DRAG = null;
      var to = target.dataset.slot, from = d.from;
      commit(function (LL) { if (to) place(LL, d.pid, to, from); else delete LL.slots[from]; }, ov, vel);
      return;
    }
    /* no target: the card springs back to where it came from, starting at the finger's speed */
    var g = d.ghost, x = d.x, y = d.y, rest = 0, put = function () { g.style.translate = x + "px " + y + "px"; };
    var fin = function () { if (++rest < 2) return; g.remove(); d.vis.classList.remove("is-lifted"); };
    DRAG = null;
    g.style.scale = "1";   /* it settles to the card's own size on the way back (hq.css transitions scale) */
    S2.spring({ from: x, damping: 0.8, response: 0.36, onUpdate: function (n) { x = n; put(); }, onRest: fin }).to(d.r.left, vx);
    S2.spring({ from: y, damping: 0.8, response: 0.36, onUpdate: function (n) { y = n; put(); }, onRest: fin }).to(d.r.top, vy);
  }
  function endDrag() { if (DRAG && DRAG.ghost) DRAG.ghost.remove(); DRAG = null; window.removeEventListener("pointermove", onMove); }
  /* what js/pages/hq.js uses from this file, looked up by name when called */
  /* the live sheets' public face: Your week and Today answer availability through it, and hq.js may read a game's answer */
  S2.lineups = { load: function (code) { return load(code); }, availOf: avail, saveAvailability: saveAvailability, state: function () { return { code: LV.code, state: LV.state, error: LV.err ? LV.err.message : null }; },
    /* the member's own answers (MINE): read for weeks, their state, a game's answer, and a game's week key */
    loadMine: loadMine, mineState: mineState, myAnswer: myAnswer, myLate: myLate, weekKey: weekKey,
    /* for hq.js planRow (handed to e1): a filed sheet whose screen differs from the six on file */
    unsaved: function (code, g) { var L = luOf(code, g); return !!L.saved && dirty(L); } };
  S2._lineups = { get OPEN() { return OPEN; }, afterLineupChange: afterLineupChange, fileNight: fileNight,
    gameById: gameById, openSheet: openSheet, paintSheet: paintSheet, paneLineups: paneLineups, planInner: planInner };
})();
