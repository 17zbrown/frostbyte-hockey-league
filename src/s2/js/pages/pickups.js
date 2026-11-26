/* #/pickups (the pickup games on file, and for statistics staff the import from EA) and #/pickups/<id> (one pickup game: its
   box score, and for statistics staff its editor). S2 swap, stream g5 (2026-11-24): the commissioner ruled every tool must
   be native on the new site before the switch, and the Game desk port (g2) left pickup games out. This is a PORT of the
   classic site's pickup tools (src/live), on the same doors, not a rewrite:
   - the import: CG.ROUTES["pickup-import"] and the Stats manager's pickup path (v4.34 to v4.36). Search an EASHL club, list
     its recent private matches, tick one, or up to four sittings of a game that lagged out, and import them
     (netlify/functions/pickup-import.js, through the bot server's EA relay: S2.ea.post, g2's port of CG.eaPost, the new
     site's one fetch to the Netlify functions);
   - the list and its delete: CG._smListHtml, CG._smLoadList and the "pudel" action (stats_pickup_delete);
   - one game: the public box score (CG.ROUTES.pickup, part5a_public.js) and, for statistics staff, the editor
     (CG._smRenderDetail: stats_pickup_row, stats_pickup_row_delete, stats_pickup_update_game, stats_pickup_delete).
   Pickup statistics are walled off from league play (memory pickup-stats-import, 2026-07-25): they live in pickup_games and
   pickup_stats, which no league rule, total or rating reads, and this page reads and writes nothing else of the league's
   (the profiles list feeds the "who played this line" picker). Every write goes through S2.write
   (contracts/client-api.md) and is confirmed by the database before the page says it worked: the row the door returns, or
   a read back of the game. A refusal shows the league's own words and keeps what was typed; each change repaints only its
   own part of the page. Who sees the controls is the database's answer (is_stats_staff: the statistics department and the
   commissioners today, every staffer after the staffing flip), never a copy kept here; everyone else reads the games and
   their box scores, which both tables publish to anyone.
   - a member's pickup lines on their profile: CG.renderPickupStats and AFTER.player's pickup read (part5a_public.js), here
     as S2.pickups.profileHtml(profileId), which js/pages/profile.js (stream e7) places with one call (review, 2026-11-24:
     the page and the import said "They show on player profiles" while no profile showed them).
   Not ported, on purpose: stats_pickup_add_game (no classic screen calls it), the screenshot importer (never built), and
   the profile's DNA radar and gauges (the Season 2 radar lives inside profile.js and scores against league medians). The
   member-facing #/pickup-import page (js/pages/office.js, e7) can carry this importer through S2.pickups.importHtml and
   S2.pickups.bindImport. */
(function () {
  "use strict";
  var S2 = window.S2, esc = S2.esc;
  /* CG._smNum: the numbers a line carries, in the classic editor's order */
  var NUM = [["goals", "G", "Goals"], ["assists", "A", "Assists"], ["shots", "S", "Shots"], ["hits", "HIT", "Hits"], ["pim", "PIM", "Penalty minutes"],
    ["plus_minus", "+/-", "Plus-minus"], ["saves", "SV", "Saves"], ["shots_against", "SA", "Shots against"], ["goals_against", "GA", "Goals against"]];
  var LIST_MAX = 60, MERGE_MAX = 4, SHORT_MIN = 45;
  /* the API answers at most 1,000 rows. shortcut: the player picker says when it stopped there (330 members on
     2026-11-24); page it by gamertag when the league passes 900 members */
  var API_MAX = 1000;
  var LIST_SEL = "id,played_at,club_a,club_b,score_a,score_b,went_ot,pickup_stats(count)";

  /* =========================================================================================================== */
  /* DOORS                                                                                                        */
  /* =========================================================================================================== */
  /* a read through S2.rd (js/live.js), the one read door (QA round 2, A10). Anything without a read client has no
     connection and says so, so an empty list here always means the league answered empty, never that nothing was asked */
  function rd(q) { return S2.rd(q); }
  function ea() {
    if (!S2.ea || !S2.ea.post) throw new Error("The EA search did not load on this page (js/pages/gamedesk.js). Reload the page.");
    return S2.ea;
  }
  function eaPost(payload) { return Promise.resolve().then(function () { return ea().post("/api/pickup-import", payload); }); }

  /* =========================================================================================================== */
  /* THE CLASSIC HELPERS, ported (no DOM): tools/pickups-g5.test.cjs runs them, and the classic result text beside   */
  /* =========================================================================================================== */
  /* "2026-12-16" in Eastern time: the whole site shows played_at in ET, so the editor's date never disagrees with the list
     by a day (CG._smRenderDetail etDate) */
  function etDate(iso) {
    if (!iso) return "";
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); }
    catch (e) { return String(iso).slice(0, 10); }
  }
  function scoreText(g) {
    return (g.club_a || "Club A") + " " + (g.score_a == null ? "?" : g.score_a) + ", " + (g.club_b || "Club B") + " " + (g.score_b == null ? "?" : g.score_b);
  }
  /* a line's fields as the jsonb patch stats_pickup_row reads (CG._smRenderDetail collect): the linked member only when the
     staffer changed it, never a silent unassign; a number as an integer, a blank as 0 */
  function linePatch(vals, origProfile) {
    var p = {};
    Object.keys(vals).forEach(function (k) {
      var v = vals[k];
      if (k === "profile_id") { if (v !== (origProfile || "")) p.profile_id = v; }
      else if (k === "is_goalie") p.is_goalie = !!v;
      else p[k] = String(parseInt(v, 10) || 0);
    });
    return p;
  }
  /* the game's fields as the patch stats_pickup_update_game reads (CG._smRenderDetail, Save game): the date only when it
     changed, anchored at midday Eastern so the day shown never moves; a blank score leaves the score as it is */
  function metaPatch(vals, origDate) {
    var p = {};
    Object.keys(vals).forEach(function (k) {
      var v = vals[k];
      if (k === "played_at") { if (v && v !== (origDate || "")) p.played_at = v + "T17:00:00.000Z"; return; }
      if (k === "went_ot") p.went_ot = !!v;
      else if (k === "score_a" || k === "score_b") { if (v === "" || v == null) return; p[k] = parseInt(v, 10); }
      else p[k] = v;
    });
    return p;
  }
  /* what the league reads back after Save game must be what was sent (the door returns nothing: a game no longer on file
     changes nothing and says nothing). A blank club name keeps the old one (the door's nullif), so it is not compared */
  function metaHeld(p, g) {
    var bad = [];
    if (p.club_a && p.club_a !== g.club_a) bad.push("Club A");
    if (p.club_b && p.club_b !== g.club_b) bad.push("Club B");
    if (p.score_a != null && !isNaN(p.score_a) && p.score_a !== g.score_a) bad.push("Score A");
    if (p.score_b != null && !isNaN(p.score_b) && p.score_b !== g.score_b) bad.push("Score B");
    if (p.went_ot != null && p.went_ot !== !!g.went_ot) bad.push("Overtime");
    if (p.played_at && p.played_at.slice(0, 10) !== etDate(g.played_at)) bad.push("Date");
    return bad;
  }
  /* the import's answer in words (CG._puResultHtml, one definition for the desk and the import page) */
  function result(o) {
    var players = (o.players || []).slice().sort(function (a, b) { return (a.matched ? 1 : 0) - (b.matched ? 1 : 0); });
    var matched = players.filter(function (p) { return p.matched; }).length, unmatched = players.length - matched;
    var club = function (p) { return p.side === "A" ? (o.clubA || "Club A") : p.side === "B" ? (o.clubB || "Club B") : ("Club " + (p.side || "?")); };
    return {
      head: ((o.sessions || 1) > 1 ? o.sessions + " sittings merged into one pickup game. " : "") + matched + " of " + players.length + " players matched to CGHL profiles" +
        (unmatched ? ", " + unmatched + " unmatched (their EA name didn’t match a gamertag)" : "") + ". Pickup stats now show on the matched profiles.",
      lines: players.map(function (p) { return { ok: !!p.matched, text: (p.name || "?") + " · " + club(p) + " · " + (+p.goals || 0) + " G, " + (+p.assists || 0) + " A" + (p.matched ? "" : " · no profile") }; })
    };
  }
  /* a game that lagged out is always the same two clubs, so sittings between different clubs never combine (the concept's
     review, 2026-11-23: "vs Harbor Wolves" and "vs Iron Range" imported as one game) */
  function samePair(matches, picked) {
    var pairs = {};
    (matches || []).forEach(function (m) { if (picked[m.matchId]) pairs[[String(m.a && m.a.name), String(m.b && m.b.name)].sort().join("|")] = 1; });
    return Object.keys(pairs).length <= 1;
  }
  /* one line's result from its side and the game's score (CG.renderPickupStats sideScores): W, OTL, L, or null when the
     side or a score is missing */
  function lineResult(x) {
    var gm = x.pickup_games || {}, side = String(x.team_side == null ? "" : x.team_side).trim().toUpperCase();
    var my = side === "A" ? gm.score_a : side === "B" ? gm.score_b : null, opp = side === "A" ? gm.score_b : side === "B" ? gm.score_a : null;
    return my == null || opp == null ? null : my > opp ? "W" : gm.went_ot ? "OTL" : "L";
  }
  /* a role's figures on the profile, the classic's KPI cells and words. The classic showed one set, by the role played in
     most games, with skater totals summed over every line; here each role gets its own set from its own lines (by is_goalie,
     every line counts at every position played, v4.11), which also stands in for the classic's position split */
  function roleFigures(list, goalie) {
    var t = { gp: list.length, g: 0, a: 0, sh: 0, hit: 0, pim: 0, pm: 0, sv: 0, sa: 0, ga: 0, so: 0, w: 0, l: 0, otl: 0 };
    list.forEach(function (x) {
      t.g += x.goals || 0; t.a += x.assists || 0; t.sh += x.shots || 0; t.hit += x.hits || 0; t.pim += x.pim || 0; t.pm += x.plus_minus || 0;
      t.sv += x.saves || 0; t.sa += x.shots_against || 0; t.ga += x.goals_against || 0; if (x.shutout) t.so++;
      var r = lineResult(x); if (r === "W") t.w++; else if (r === "OTL") t.otl++; else if (r === "L") t.l++;
    });
    return goalie
      ? [["Games", t.gp], ["Record", t.w + "-" + t.l + "-" + t.otl], ["Save %", t.sa ? (t.sv / t.sa).toFixed(3).replace(/^0/, "") : "–"], ["GAA", t.gp ? (t.ga / t.gp).toFixed(2) : "–"],
        ["Saves", t.sv], ["Goals against", t.ga], ["Shutouts", t.so]]
      : [["Games", t.gp], ["Goals", t.g], ["Assists", t.a], ["Points", t.g + t.a], ["Plus-minus", (t.pm > 0 ? "+" : "") + t.pm], ["Shots", t.sh],
        ["Shooting %", t.sh ? Math.round(100 * t.g / t.sh) + "%" : "–"], ["Hits", t.hit], ["Penalty minutes", t.pim]];
  }

  /* =========================================================================================================== */
  /* STATE: one object per part, kept across repaints and a soft route                                            */
  /* =========================================================================================================== */
  var GATE = { who: undefined, ok: null, err: null, req: 0, pending: false };
  var IMP = { q: "", asked: "", seq: 0, searching: false, clubs: null, err: null, club: null, mseq: 0, mLoading: false, matches: null, mErr: null, picked: {}, busy: false, res: null, onDone: null };
  var LIST = { rows: null, err: null, req: 0, at: 0, res: null, flash: null, busy: null };
  var G = { id: null, g: undefined, rows: null, err: null, req: 0, at: 0 };
  var PROFS = { rows: null, err: null, req: 0, pending: false };
  var BUSY = 0;   /* writes in flight: a version reload waits for them (S2.holds, js/live.js) */
  if (S2.holds) S2.holds.push(function () { return BUSY > 0 || IMP.busy; });

  function me() { return (S2.session && S2.session.user && S2.session.profileId) || null; }
  /* true, false, or null while the league is asked. Signed out is never statistics staff, so nothing is asked */
  function gate() { var who = me(); return !who ? false : GATE.who === who ? GATE.ok : null; }
  function ensureGate() {
    var who = me();
    if (GATE.who === who && (GATE.ok !== null || GATE.pending)) return;
    GATE.who = who; GATE.ok = who ? null : false; GATE.err = null; GATE.pending = false;
    if (!who) return;
    var req = ++GATE.req; GATE.pending = true;
    rd(function (c) { return c.rpc("is_stats_staff"); }).then(function (ok) {
      if (req !== GATE.req) return;
      GATE.pending = false; GATE.ok = ok === true; afterGate();
    }, function (e) {
      if (req !== GATE.req) return;
      GATE.pending = false; GATE.ok = false; GATE.err = e.message; afterGate();
    });
  }
  function afterGate() {
    paint("puImp"); paint("puList"); paint("puGame");
    if (GATE.ok && S2.ea && document.getElementById("puImp")) S2.ea.paintStatus(document.getElementById("puImp"));
    if (GATE.ok && G.id) loadProfiles();
  }

  /* =========================================================================================================== */
  /* PAINT: each part is drawn from its state and replaced in place; focus stays on the control it was on        */
  /* =========================================================================================================== */
  var PARTS = {};
  function paint(id) {
    var el = document.getElementById(id); if (!el || !PARTS[id]) return null;
    var a = document.activeElement, back = a && el.contains(a) ? (a.id ? "#" + a.id : a.dataset && a.dataset.pu ? '[data-pu="' + a.dataset.pu + '"]' : null) : null;
    el.outerHTML = PARTS[id]();
    var now = document.getElementById(id);
    if (back && now) { var f = now.matches(back) ? now : now.querySelector(back); if (f && f.focus) f.focus({ preventScroll: true }); }
    return now;
  }
  function say(id, text, bad) {
    var el = document.getElementById(id); if (!el) return;
    el.textContent = text || "";
    if (el.classList.contains("pu-say")) el.className = "pu-say" + (bad ? " pu-err" : text ? " pu-good" : "");   /* a screen-reader line (.sr) stays unseen */
    el.setAttribute("role", bad ? "alert" : "status");
  }
  function note(res, id) {
    if (!res) return "";
    return '<p class="' + (res.ok ? "pu-good" : "pu-err") + '" id="' + id + '" role="' + (res.ok ? "status" : "alert") + '" tabindex="-1">' + (res.ok ? S2.ic("check") : S2.ic("alert")) + "<span>" + esc(res.text) +
      (res.gameId ? ' <a href="#/pickups/' + esc(res.gameId) + '">Open it</a>' : "") + "</span></p>";
  }
  function when(iso) { var M = S2.M; return iso && M && M.etDateTime ? M.etDateTime(iso) || "" : ""; }
  function day(iso) { var M = S2.M; return iso && M && M.etFull ? M.etFull(iso) || "" : ""; }
  function plural(n, one, many) { return S2.plural ? S2.plural(n, one, many) : n + " " + (n === 1 ? one : many || one + "s"); }
  function picks() { return Object.keys(IMP.picked).filter(function (k) { return IMP.picked[k]; }); }

  /* ---------------------------------------- the import (statistics staff here; members on #/pickup-import) ---------------------------------------- */
  function importHtml() {
    return '<div class="pu-imp" id="puImpBox"><div class="field pu-q"><label for="puQ">EASHL club name</label><span class="pu-qrow">' +
      '<input class="input" type="search" id="puQ" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. Chel Gaming Blades" value="' + esc(IMP.q) + '">' +
      '<button type="button" class="btn sm" data-pu="search">Search EA</button></span></div>' + (S2.ea ? S2.ea.statusLine() : "") +
      PARTS.puImpOut() + '<p class="sr" id="puSay" aria-live="polite"></p></div>';
  }
  PARTS.puImpOut = function () {
    var I = IMP, h = "";
    if (I.res && I.res.kind === "ok") h = resultHtml(I.res.o);
    else if (I.searching) h = '<p class="t-foot pu-wait">Searching EA for “' + esc(I.asked) + '”. This can take up to 25 seconds.</p>';
    else if (I.err) h = '<p class="pu-err" role="alert">' + S2.ic("alert") + "<span>" + esc(I.err) + ' <button type="button" class="btn sm secondary" data-pu="search">Try again</button></span></p>';
    else if (I.club) h = matchesHtml();
    else if (I.clubs && !I.clubs.length) h = '<p class="t-foot">EA found no club named “' + esc(I.asked) + '”. Check the exact spelling.</p>';
    else if (I.clubs) h = '<p class="t-cap pu-cap">Pick the club</p><div class="list pu-list">' + I.clubs.map(function (c, i) {
      return '<button type="button" class="row" data-pu="club" data-i="' + i + '"><span class="grow"><span class="title">' + esc(c.name) + '</span><span class="sub">EA club ' + esc(c.clubId) +
        (c.memberCount ? " · " + esc(plural(+c.memberCount, "member")) : "") + "</span></span>" + S2.chev() + "</button>";
    }).join("") + "</div>";
    return '<div id="puImpOut">' + h + "</div>";
  };
  function matchesHtml() {
    var I = IMP, c = I.club;
    var head = '<div class="pu-club"><span class="t-head">' + esc(c.name) + '</span><button type="button" class="btn sm plain" data-pu="back">Another club</button></div>';
    if (I.mLoading) return head + '<p class="t-foot pu-wait">Loading ' + esc(c.name) + "’s recent private matches. This can take up to 25 seconds.</p>";
    if (I.mErr) return head + '<p class="pu-err" role="alert">' + S2.ic("alert") + "<span>" + esc(I.mErr) + ' <button type="button" class="btn sm secondary" data-pu="matches">Try again</button></span></p>';
    if (!I.matches || !I.matches.length) return head + '<p class="t-foot">No recent private matches for ' + esc(c.name) + ". EA keeps only a club’s last few private matches, so import soon after playing.</p>";
    return head + '<p class="t-cap pu-cap">Tick the game</p><div class="list pu-list">' + I.matches.map(function (m) {
      var short = m.minutes && m.minutes < SHORT_MIN, line = [when(m.playedAt), m.minutes ? plural(+m.minutes, "minute") : ""].filter(Boolean).join(" · ");
      return '<label class="row pu-m"><input type="checkbox" name="puMatch" value="' + esc(m.matchId) + '"' + (I.picked[m.matchId] ? " checked" : "") + (I.busy ? " disabled" : "") + ">" +
        '<span class="grow"><span class="title">' + esc((m.a && m.a.name || "?") + " " + (m.a ? m.a.score : "?") + ", " + (m.b && m.b.name || "?") + " " + (m.b ? m.b.score : "?")) + "</span>" +
        '<span class="sub">' + esc(line + (short ? (line ? " · " : "") + "likely one sitting of a game that lagged out" : "")) + "</span></span>" +
        (m.wentOt ? '<span class="chip">OT</span>' : "") + (short ? '<span class="chip warn">~' + esc(m.minutes) + " min</span>" : "") + "</label>";
    }).join("") + "</div>" + PARTS.puImpBar();
  }
  PARTS.puImpBar = function () {
    var I = IMP, n = picks().length;
    var label = I.busy ? "Importing…" : n > 1 ? "Import " + n + " sittings as one game" : "Import this game";
    var cap = n > 1 ? "The sittings combine into one game: stats are added up, the scores combined, and overtime is taken from the last sitting only."
      : n ? "Its box score goes onto each matched player’s profile as pickup stats." : "Tick the game to import. For a game that lagged out, tick every sitting of it (up to four).";
    var err = I.res && I.res.kind === "err" ? note({ ok: false, text: I.res.text, gameId: I.res.gameId }, "puImpErr") : "";
    return '<div class="pu-bar" id="puImpBar">' + err + '<p class="t-foot">' + esc(cap) + '</p><button type="button" class="btn" data-pu="import"' + (n && !I.busy ? "" : " disabled") +
      (I.busy ? ' aria-busy="true"' : "") + ">" + esc(label) + "</button></div>";
  };
  function resultHtml(o) {
    var r = result(o);
    return '<div class="pu-done" id="puImpRes" tabindex="-1"><p class="pu-good">' + S2.ic("check") + "<span><b>Imported.</b> " + esc(r.head) + "</span></p>" +
      '<ul class="pu-players">' + r.lines.map(function (l) { return '<li class="' + (l.ok ? "is-ok" : "is-miss") + '">' + esc(l.text) + "</li>"; }).join("") + "</ul>" +
      '<div class="pu-acts"><a class="btn sm secondary" href="#/pickups/' + esc(o.pickupGameId) + '">Open the game</a><button type="button" class="btn sm plain" data-pu="again">Import another game</button></div></div>';
  }
  function impPaint(focusSel) {
    paint("puImpOut");
    if (focusSel) { var f = document.querySelector(focusSel); if (f && f.focus) f.focus({ preventScroll: true }); }
  }
  /* the club search (CG._smSearch / the pickup page's doSearch), through the bot server */
  function search() {
    var inp = document.getElementById("puQ"); if (inp) IMP.q = inp.value;
    var t = String(IMP.q || "").trim(), I = IMP;
    I.res = null; I.club = null; I.matches = null; I.picked = {};
    if (t.length < 2) { I.clubs = null; I.err = "Type at least two letters of the club’s EA name."; impPaint(); return; }
    var req = ++I.seq; I.asked = t; I.searching = true; I.err = null; I.clubs = null; impPaint();
    say("puSay", "Searching EA.");
    eaPost({ action: "search", clubName: t }).then(function (o) {
      if (req !== I.seq) return;
      I.searching = false;
      if (!o || o.error) I.err = (o && o.error) || "The server did not answer.";
      else if (!Array.isArray(o.clubs)) I.err = "The server’s answer had no club list. Nothing was searched; try again.";
      else I.clubs = o.clubs;
      impPaint(I.clubs && I.clubs.length ? '#puImpOut [data-pu="club"]' : null);
      say("puSay", I.err ? "" : plural(I.clubs.length, "club") + " found.");
    }, function (e) { if (req !== I.seq) return; I.searching = false; I.err = e.message; impPaint(); });
  }
  function loadMatches() {
    var I = IMP, c = I.club; if (!c) return;
    var req = ++I.mseq; I.mLoading = true; I.mErr = null; I.matches = null; I.picked = {}; I.res = null; impPaint();
    eaPost({ action: "matches", clubId: c.clubId }).then(function (o) {
      if (req !== I.mseq || I.club !== c) return;
      I.mLoading = false;
      if (!o || o.error) I.mErr = (o && o.error) || "The server did not answer.";
      else if (!Array.isArray(o.matches)) I.mErr = "The server’s answer had no match list. Try again.";
      else I.matches = o.matches;
      impPaint(I.matches && I.matches.length ? '#puImpOut input[name="puMatch"]' : '#puImpOut [data-pu="back"]');
      say("puSay", I.mErr ? "" : c.name + ": " + plural((I.matches || []).length, "recent match", "recent matches") + ".");
    }, function (e) { if (req !== I.mseq || I.club !== c) return; I.mLoading = false; I.mErr = e.message; impPaint(); });
  }
  /* the import (CG._pu doImport / the Stats manager's pickup bar): one id imports a game, several merge one game's sittings */
  function doImport() {
    var I = IMP, ids = picks(), c = I.club;
    if (!ids.length || I.busy || !c) return;
    if (ids.length > MERGE_MAX || !samePair(I.matches, I.picked)) return;   /* the tick handler already refused both */
    I.busy = true; I.res = null; impPaint('#puImpBar [data-pu="import"]');
    var payload = ids.length > 1 ? { action: "import", clubId: c.clubId, matchIds: ids } : { action: "import", clubId: c.clubId, matchId: ids[0] };
    var fail = function (text, gameId) { I.busy = false; I.res = { kind: "err", text: text, gameId: gameId || null }; impPaint("#puImpErr"); };
    eaPost(payload).then(function (o) {
      if (!o || o.error || !o.pickupGameId) return fail((o && o.error) || "The server did not say the game was imported. Nothing is confirmed: check the list before trying again.", o && o.pickupGameId);
      /* confirmed by the league, not by the function's word: the game is read back before the page says Imported */
      return rd(function (cl) { return cl.from("pickup_games").select("id").eq("id", o.pickupGameId).maybeSingle(); }).then(function (row) {
        if (!row || row.id !== o.pickupGameId) return fail("The import answered, but the league has no such game on file. Check the list before trying again.");
        I.busy = false; I.res = { kind: "ok", o: o }; I.picked = {};
        impPaint("#puImpRes");
        say("puSay", "Imported.");
        if (I.onDone) I.onDone(o);
      }, function (e) { fail("The import answered, but the page could not read the game back to confirm it (" + e.message + "). Check the list before importing again."); });
    }, function (e) { fail("Import failed: " + e.message); });
  }
  function onImpClick(e) {
    var b = e.target.closest ? e.target.closest("[data-pu]") : null; if (!b) return false;
    var a = b.dataset.pu, I = IMP;
    if (a === "search") search();
    else if (a === "club") { var c = (I.clubs || [])[+b.dataset.i]; if (!c) return true; I.club = c; loadMatches(); }
    else if (a === "matches") loadMatches();
    else if (a === "back") { I.club = null; I.matches = null; I.mErr = null; I.picked = {}; I.res = null; ++I.mseq; I.mLoading = false; impPaint('#puImpOut [data-pu="club"]'); }
    else if (a === "again") { I.club = null; I.matches = null; I.picked = {}; I.res = null; impPaint(I.clubs && I.clubs.length ? '#puImpOut [data-pu="club"]' : "#puQ"); }
    else if (a === "import") doImport();
    else return false;
    return true;
  }
  /* a tick changes the bar only: the checkbox under the finger is never redrawn */
  function onImpChange(e) {
    var t = e.target; if (t.name !== "puMatch") return false;
    IMP.picked[t.value] = t.checked; IMP.res = null;
    if (t.checked && picks().length > MERGE_MAX) { IMP.picked[t.value] = false; t.checked = false; S2.toast("Four sittings is the most one game can be imported from.", "err"); }
    else if (t.checked && !samePair(IMP.matches, IMP.picked)) { IMP.picked[t.value] = false; t.checked = false; S2.toast("Those sittings are not all between the same two clubs; a game that lagged out always is.", "err"); }
    paint("puImpBar");
    return true;
  }
  function onImpKey(e) {
    if (e.target.id === "puQ" && e.key === "Enter" && !e.isComposing) { e.preventDefault(); search(); return true; }
    return false;
  }
  function onImpInput(e) { if (e.target.id === "puQ") IMP.q = e.target.value; }

  /* ---------------------------------------- the list ---------------------------------------- */
  PARTS.puImp = function () {
    var ok = gate();
    if (ok === true) return '<section class="pu-sec" id="puImp" aria-labelledby="puImpH">' + S2.secHead({ kicker: "From EA", id: "puImpH", h: "Import a pickup game",
      p: "Search the EASHL club, then tick the game. A game that lagged out comes back as several short sittings: tick them together and they import as one game." }) + importHtml() + "</section>";
    if (GATE.err) return '<section class="pu-sec" id="puImp">' + S2.empty("err", "Couldn’t check your statistics access", esc(GATE.err), '<button type="button" class="btn sm secondary" data-pu="gate">Try again</button>') + "</section>";
    return '<section id="puImp" hidden></section>';
  };
  PARTS.puList = function () {
    var L = LIST, staff = gate() === true, body;
    if (L.err) body = S2.empty("err", "Couldn’t load the pickup games", esc(L.err), '<button type="button" class="btn sm secondary" data-pu="list-retry">Try again</button>');
    else if (!L.rows) body = '<p class="t-foot pu-wait">Loading the pickup games…</p>';
    else if (!L.rows.length) body = S2.empty("none", "No pickup games yet", staff ? "Import one above." : "Games from the #pickup-games lobbies show here once their box score is imported.");
    else body = '<div class="tbl-wrap"><table class="tbl pu-tbl"><caption class="sr">Pickup games on file, newest first</caption><thead><tr><th scope="col">Game</th><th scope="col">Played</th><th scope="col">Lines</th>' +
      (staff ? '<th scope="col"><span class="sr">Delete</span></th>' : "") + "</tr></thead><tbody>" + L.rows.map(function (g) {
        var n = (g.pickup_stats && g.pickup_stats[0] && g.pickup_stats[0].count) || 0, busy = L.busy === g.id;
        return "<tr><td><a href=\"#/pickups/" + esc(g.id) + '">' + esc(scoreText(g)) + "</a>" + (g.went_ot ? ' <span class="chip">OT</span>' : "") + "</td><td>" + esc(day(g.played_at)) + "</td><td>" + n + "</td>" +
          (staff ? '<td><button type="button" class="btn sm danger" data-pu="list-del" data-id="' + esc(g.id) + '"' + (busy ? ' disabled aria-busy="true"' : "") + ">" + (busy ? "Deleting…" : "Delete") + "</button></td>" : "") + "</tr>";
      }).join("") + "</tbody></table></div>" + (L.rows.length >= LIST_MAX ? '<p class="t-foot">Showing the newest ' + LIST_MAX + ".</p>" : "");
    return '<section class="pu-sec" id="puList" aria-labelledby="puListH">' + S2.secHead({ kicker: "Profiles only", id: "puListH", focus: true, h: "Pickup games on file",
      p: "Imported from EA. They show on player profiles and never count toward league standings, eligibility, ratings or awards." }) + note(L.res, "puListRes") + body + "</section>";
  };
  function loadList() {
    var req = ++LIST.req;
    return rd(function (c) { return c.from("pickup_games").select(LIST_SEL).order("played_at", { ascending: false }).limit(LIST_MAX); }).then(function (rows) {
      if (req !== LIST.req) return LIST.rows;
      LIST.err = null; LIST.rows = rows || []; LIST.at = Date.now(); paint("puList");
      return LIST.rows;
    }, function (e) { if (req !== LIST.req) return null; LIST.err = e.message; paint("puList"); throw e; });
  }
  /* CG._smOnClick "pudel": confirmed, then read back: the game is gone from the league's list before the page says so */
  function listDelete(id) {
    var g = (LIST.rows || []).filter(function (x) { return x.id === id; })[0]; if (!g || LIST.busy) return;
    var n = (g.pickup_stats && g.pickup_stats[0] && g.pickup_stats[0].count) || 0, name = (g.club_a || "Club A") + " vs " + (g.club_b || "Club B");
    S2.confirm({ title: "Delete " + name + "?", danger: true, ok: "Delete the game",
      why: ["The pickup game and its " + plural(n, "player line") + " come off player profiles. It can’t be undone. League results are not affected."],
      onOk: function () {
        LIST.busy = id; LIST.res = null; BUSY++; paint("puList");
        S2.write("stats_pickup_delete", { p_game: id }).then(function () {
          return loadList().then(function (rows) {
            var still = (rows || []).some(function (x) { return x.id === id; });
            LIST.res = still ? { ok: false, text: "The league did not confirm the delete: " + name + " is still on file. Try again, or tell a commissioner." } : { ok: true, text: name + " was deleted." };
            if (!still && G.id === id) G = { id: null, g: undefined, rows: null, err: null, req: G.req, at: 0 };   /* qa (nits 17): Back never redraws it */
          }, function (e) { LIST.res = { ok: false, text: "The delete was sent, but the list could not be read back to confirm it (" + e.message + "). Check before trying again." }; });
        }, function (e) { LIST.res = { ok: false, text: "Couldn’t delete it: " + e.message }; }).then(function () {
          LIST.busy = null; BUSY--; paint("puList");
          var r = document.getElementById("puListRes"); if (r) r.focus({ preventScroll: true });
        });
      } });
  }
  function listPage() {
    /* a result says what just happened: a later visit starts clean, unless it is the landing after a delete on the game page */
    LIST.res = LIST.flash; LIST.flash = null;
    return '<div class="pu" id="puRoot">' + '<header class="hero pu-hero reveal"><span class="kicker">Statistics desk</span><h1 class="d-hero">Pickup games</h1>' +
      '<p class="lede-l">Games from the #pickup-games lobbies, imported from EA. They show on player profiles and never count toward league standings, eligibility, ratings or awards.</p></header>' +
      PARTS.puImp() + PARTS.puList() +
      S2.about(["Pickup lines live in their own two tables, which no league rule reads: the playoff floor, draft and bidding eligibility, ratings, standings and leaders never see them.",
        "EA keeps only each club’s last few private matches, so import soon after playing. Statistics staff import, correct and delete pickup games here; the import reaches EA through the league’s bot server."]) + "</div>";
  }

  /* ---------------------------------------- one game ---------------------------------------- */
  function enterGame(id) { if (G.id !== id) G = { id: id, g: undefined, rows: null, err: null, req: G.req, at: 0 }; }
  PARTS.puHead = function () {
    var g = G.g, h;
    if (G.err) h = S2.empty("err", "Couldn’t load this game", esc(G.err), '<button type="button" class="btn sm secondary" data-pu="game-retry">Try again</button>');
    else if (g === undefined) h = '<p class="t-foot pu-wait">Loading the box score…</p>';
    else if (!g) h = S2.empty("none", "Pickup game not found", "It may have been deleted, or the link is out of date.", '<a class="btn sm secondary" href="#/pickups">All pickup games</a>');
    else h = '<span class="kicker">Pickup game · not league play' + (g.played_at ? " · " + esc(day(g.played_at)) : "") + '</span><h1 class="d-1" id="puH1">' + esc(scoreText(g)).replace(/ (\d+|\?)(,|$)/g, "&nbsp;$1$2") + "</h1>" +
      '<p class="lede-l">' + (g.went_ot ? "Overtime final." : "Final.") + " Pickup lines show on player profiles and never count toward league standings, draft or bidding eligibility, or ratings.</p>";
    return '<header class="hero pu-hero" id="puHead">' + h + "</header>";
  };
  PARTS.puGame = function () {
    if (!G.g) return '<div id="puGame"></div>';
    /* qa (nits 18): a failed is_stats_staff read is said above the read-only box score, with Try again, so a staffer never
       silently loses the editor (the list page's import part says the same) */
    var gateErr = gate() !== true && GATE.err ? '<section class="pu-sec">' + S2.empty("err", "Couldn’t check your statistics access", esc(GATE.err) + " The box score shows read-only until it is checked.", '<button type="button" class="btn sm secondary" data-pu="gate">Try again</button>') + "</section>" : "";
    return '<div id="puGame">' + (gate() === true ? PARTS.puMeta() + PARTS.puBox() : gateErr + boxRead()) + "</div>";
  };
  /* the public box score (CG.ROUTES.pickup / CG.AFTER.pickup): one table per side, skaters by points, then the goaltenders */
  function boxRead() {
    var g = G.g, rows = G.rows || [], side = function (x) { return String(x.team_side == null ? "" : x.team_side).trim().toUpperCase(); };
    var A = rows.filter(function (x) { return side(x) === "A"; }), B = rows.filter(function (x) { return side(x) === "B"; });
    var other = rows.filter(function (x) { return side(x) !== "A" && side(x) !== "B"; });
    if (other.length) A = A.concat(other);   /* never drop a line that can't be bucketed */
    return sideBox(g.club_a || "Club A", g.score_a, A, "a") + sideBox(g.club_b || "Club B", g.score_b, B, "b");
  }
  function nameCell(x, fallback) {
    var gt = x.profiles && x.profiles.gamertag, label = gt || x.skater_name || fallback;
    return x.profile_id && gt ? '<a href="#/player/' + esc(x.profile_id) + '">' + esc(label) + "</a>" : esc(label);
  }
  function sideBox(title, score, list, k) {
    var pts = function (x) { return (x.goals || 0) + (x.assists || 0); };
    var sk = list.filter(function (x) { return !x.is_goalie; }).sort(function (a, b) { return pts(b) - pts(a); }), gl = list.filter(function (x) { return x.is_goalie; });
    var body = !sk.length && !gl.length ? '<p class="t-foot">No player lines were imported for this side.</p>' : "";
    if (sk.length) body += '<div class="tbl-wrap"><table class="tbl"><caption class="sr">' + esc(title) + ' skaters</caption><thead><tr><th scope="col">Skater</th>' +
      '<th scope="col"><abbr title="Goals">G</abbr></th><th scope="col"><abbr title="Assists">A</abbr></th><th scope="col"><abbr title="Points">P</abbr></th><th scope="col"><abbr title="Shots">S</abbr></th>' +
      '<th scope="col"><abbr title="Hits">HIT</abbr></th><th scope="col"><abbr title="Penalty minutes">PIM</abbr></th><th scope="col"><abbr title="Plus-minus">+/-</abbr></th></tr></thead><tbody>' +
      sk.map(function (x) {
        var pm = x.plus_minus || 0;
        return "<tr><td>" + nameCell(x, "Player") + (x.position ? ' <span class="t-foot">' + esc(x.position) + "</span>" : "") + "</td><td>" + (x.goals || 0) + "</td><td>" + (x.assists || 0) + "</td><td><b>" + pts(x) + "</b></td><td>" +
          (x.shots || 0) + "</td><td>" + (x.hits || 0) + "</td><td>" + (x.pim || 0) + "</td><td>" + (pm > 0 ? "+" : "") + pm + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    if (gl.length) body += '<div class="tbl-wrap"><table class="tbl"><caption class="sr">' + esc(title) + ' goaltenders</caption><thead><tr><th scope="col">Goaltender</th>' +
      '<th scope="col"><abbr title="Saves">SV</abbr></th><th scope="col"><abbr title="Shots against">SA</abbr></th><th scope="col"><abbr title="Save percentage">SV%</abbr></th>' +
      '<th scope="col"><abbr title="Goals against">GA</abbr></th><th scope="col"><abbr title="Shutout">SO</abbr></th></tr></thead><tbody>' +
      gl.map(function (x) {
        var sa = x.shots_against || 0, sv = x.saves || 0;
        return "<tr><td>" + nameCell(x, "Goaltender") + "</td><td>" + sv + "</td><td>" + sa + "</td><td>" + (sa ? (sv / sa).toFixed(3).replace(/^0/, "") : "–") + "</td><td>" + (x.goals_against || 0) + "</td><td>" + (x.shutout ? 1 : 0) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    return '<section class="pu-sec pu-side" aria-labelledby="puSide' + k + '">' + S2.secHead({ kicker: "Box score", id: "puSide" + k, h: title + ", " + (score == null ? "?" : score), sm: true }) + body + "</section>";
  }
  /* ---- the editor (statistics staff): CG._smRenderDetail ---- */
  PARTS.puMeta = function () {
    var g = G.g, d = etDate(g.played_at);
    var f = function (lbl, k, type, v) { return '<div class="field"><label for="puM-' + k + '">' + lbl + '</label><input class="input" id="puM-' + k + '" data-m="' + k + '" type="' + type + '"' + (type === "number" ? ' inputmode="numeric"' : "") + ' value="' + esc(v == null ? "" : v) + '"' + (k === "played_at" ? ' data-orig="' + esc(d) + '"' : "") + "></div>"; };
    return '<section class="pu-sec" id="puMeta" aria-labelledby="puMetaH">' + S2.secHead({ kicker: "Statistics desk", id: "puMetaH", h: "The game",
      p: "Correct a club name, the score, the date or the overtime mark. Player profiles show the change at once; league results are not affected." }) +
      '<div class="pu-meta">' + f("Club A", "club_a", "text", g.club_a) + f("Score A", "score_a", "number", g.score_a) + f("Score B", "score_b", "number", g.score_b) + f("Club B", "club_b", "text", g.club_b) +
      f("Date played", "played_at", "date", d) + '<label class="pu-check"><input type="checkbox" data-m="went_ot"' + (g.went_ot ? " checked" : "") + "> Overtime</label></div>" +
      '<p class="pu-say" id="puMetaMsg" role="status"></p><div class="pu-acts"><button type="button" class="btn sm" data-pu="meta-save">Save the game</button>' +
      '<button type="button" class="btn sm danger" data-pu="game-del">Delete the game</button></div></section>';
  };
  function profLabel(p) { return (p.gamertag || p.display_name || "(no name)") + (p.ea_id ? " · EA: " + p.ea_id : ""); }
  function profOpts(sel, gt) {
    var o = '<option value="">Unassigned</option>';
    if (!PROFS.rows) return o + (sel ? '<option value="' + esc(sel) + '" selected>' + esc(gt || "Linked member") + "</option>" : "");
    PROFS.rows.forEach(function (p) { o += '<option value="' + esc(p.id) + '"' + (p.id === sel ? " selected" : "") + ">" + esc(profLabel(p)) + "</option>"; });
    return o;
  }
  function rowHtml(x) {
    var gt = x.profiles && x.profiles.gamertag, who = x.skater_name || "this line";
    return '<tr id="puRow-' + esc(x.id) + '" data-row="' + esc(x.id) + '"><td class="pu-who"><select class="input pu-sel" data-f="profile_id" data-orig="' + esc(x.profile_id || "") + '" aria-label="Member who played ' + esc(who) + '"' + (PROFS.rows ? "" : " disabled") + ">" +
      profOpts(x.profile_id, gt) + '</select><span class="t-foot">EA: ' + esc(x.skater_name || "?") + (x.team_side ? " · Team " + esc(x.team_side) : "") + (gt ? "" : ' · <span class="pu-miss">unmatched</span>') + "</span></td>" +
      '<td><input type="checkbox" data-f="is_goalie"' + (x.is_goalie ? " checked" : "") + ' aria-label="' + esc(who) + ' played goaltender"></td>' +
      NUM.map(function (k) { return '<td><input class="input pu-n" type="number" inputmode="numeric" data-f="' + k[0] + '" value="' + esc(x[k[0]] == null ? 0 : x[k[0]]) + '" aria-label="' + esc(who + ", " + k[2]) + '"></td>'; }).join("") +
      '<td class="pu-rowacts"><button type="button" class="btn sm secondary" data-pu="row-save">Save</button><button type="button" class="btn sm plain pu-del" data-pu="row-del">Remove</button></td></tr>';
  }
  function emptyRow() { return '<tr class="pu-none"><td colspan="' + (NUM.length + 3) + '"><span class="t-foot">No player lines. Add one below.</span></td></tr>'; }
  /* qa (nits 14): the member list's state is one note above the lines, repainted in place (paintProfsNote): repainting the
     whole box when the list came back capped or failed wiped numbers a staffer had typed and not saved */
  function profsNote() {
    return PROFS.err ? '<p class="pu-err" role="alert">' + S2.ic("alert") + "<span>The member list didn’t load, so lines can’t be linked to a member until it does: " + esc(PROFS.err) +
        ' <button type="button" class="btn sm secondary" data-pu="profs-retry">Try again</button></span></p>'
      : PROFS.capped ? '<p class="t-foot">The member list stopped at ' + API_MAX + " members, so the picker may not list everyone.</p>" : "";
  }
  function paintProfsNote() {
    var el = document.getElementById("puProfsNote"); if (!el) return;
    var had = el.contains(document.activeElement);
    el.innerHTML = profsNote();
    if (had) el.focus({ preventScroll: true });   /* the Try again that had focus is gone: focus stays in the note, never BODY */
  }
  PARTS.puBox = function () {
    var rows = G.rows || [], g = G.g;
    var profs = '<div id="puProfsNote" tabindex="-1">' + profsNote() + "</div>";
    return '<section class="pu-sec" id="puBox" aria-labelledby="puBoxH">' + S2.secHead({ kicker: "Box score", id: "puBoxH", h: "Player lines",
      p: "Link each line to the member who played it, mark goaltenders and correct the numbers. Each line saves on its own.", aside: '<span class="chip" id="puBoxN">' + esc(plural(rows.length, "line")) + "</span>" }) + profs +
      '<p class="pu-say" id="puBoxMsg" role="status"></p><div class="tbl-wrap"><table class="tbl pu-ed"><caption class="sr">Player lines of this pickup game, editable</caption><thead><tr><th scope="col">Player</th><th scope="col"><abbr title="Goaltender">G?</abbr></th>' +
      NUM.map(function (k) { return '<th scope="col"><abbr title="' + k[2] + '">' + k[1] + "</abbr></th>"; }).join("") + '<th scope="col"><span class="sr">Save or remove</span></th></tr></thead><tbody id="puRows">' +
      (rows.length ? rows.map(rowHtml).join("") : emptyRow()) + "</tbody></table></div>" +
      '<div class="pu-add"><div class="field"><label for="puNewName">Add a line: EA name</label><input class="input" id="puNewName" autocomplete="off" placeholder="Player name"></div>' +
      '<div class="field"><label for="puNewSide">Side</label><select class="input" id="puNewSide"><option value="A">Team A, ' + esc(g.club_a || "Club A") + '</option><option value="B">Team B, ' + esc(g.club_b || "Club B") + "</option></select></div>" +
      '<label class="pu-check"><input type="checkbox" id="puNewG"> Goaltender</label><button type="button" class="btn sm secondary" data-pu="row-add">Add the line</button></div></section>';
  };
  function loadGame() {
    var id = G.id, req = ++G.req;
    /* a pickup game's address is its uuid: anything else is no game, said as not found without asking the league (health
       crawl 9, 2026-11-25: #/pickup/abc read pickup_games and pickup_stats with "abc", logged two 400s and printed
       Postgres's 22P02 to the visitor, and Try again repeated the same doomed reads). S2.isUuid is core's one test */
    if (!S2.isUuid(id)) { G.err = null; G.g = null; G.rows = []; G.at = Date.now(); paint("puHead"); paint("puGame"); return Promise.resolve(); }
    return Promise.all([
      rd(function (c) { return c.from("pickup_games").select("*").eq("id", id).maybeSingle(); }),
      rd(function (c) { return c.from("pickup_stats").select("*, profiles(gamertag)").eq("pickup_game_id", id).order("team_side"); })
    ]).then(function (r) {
      if (req !== G.req || G.id !== id) return;
      G.err = null; G.g = r[0] || null; G.rows = r[1] || []; G.at = Date.now();
      paint("puHead"); paint("puGame");
      if (gate() === true) loadProfiles();
    }, function (e) { if (req !== G.req || G.id !== id) return; G.err = e.message; paint("puHead"); paint("puGame"); });
  }
  /* the member picker (CG._smLoadProfiles): a failure is said and never cached; the open selects fill in place */
  function loadProfiles() {
    if (PROFS.rows || PROFS.pending) return;
    var req = ++PROFS.req; PROFS.pending = true; PROFS.err = null;
    rd(function (c) { return c.from("profiles").select("id,gamertag,display_name,ea_id").order("gamertag").limit(API_MAX); }).then(function (rows) {
      if (req !== PROFS.req) return;
      PROFS.pending = false; PROFS.rows = rows || []; PROFS.capped = PROFS.rows.length >= API_MAX;
      Array.prototype.forEach.call(document.querySelectorAll('#puRows select[data-f="profile_id"]'), function (s) {
        if (s === document.activeElement) return;
        var tr = s.closest("[data-row]"), x = (G.rows || []).filter(function (r) { return r.id === tr.dataset.row; })[0];
        s.innerHTML = profOpts(s.value || (x && x.profile_id) || "", x && x.profiles && x.profiles.gamertag); s.disabled = false;
      });
      paintProfsNote();
    }, function (e) { if (req !== PROFS.req) return; PROFS.pending = false; PROFS.err = e.message; paintProfsNote(); });
  }
  function rowVals(tr) {
    var v = {};
    Array.prototype.forEach.call(tr.querySelectorAll("[data-f]"), function (el) { v[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value; });
    return v;
  }
  function rowName(x) { return (x && (x.profiles && x.profiles.gamertag || x.skater_name)) || "the line"; }
  function withTag(row) {
    /* qa (nits 16): a line whose link did not move keeps the member it was linked to, even while the member list has not
       loaded (or failed, or stopped short): rebuilt from the list alone it read "unmatched" although still linked */
    var prev = (G.rows || []).filter(function (y) { return y.id === row.id; })[0];
    if (prev && prev.profile_id === row.profile_id && prev.profiles && prev.profiles.gamertag) { row.profiles = prev.profiles; return row; }
    var p = row.profile_id && PROFS.rows ? PROFS.rows.filter(function (x) { return x.id === row.profile_id; })[0] : null;
    row.profiles = row.profile_id ? { gamertag: p ? p.gamertag : null } : null;
    return row;
  }
  /* qa (nits 15): a read-back after a write the league took: its failure is marked, so the page says the change was sent
     but not confirmed instead of "Not saved" (listDelete's wording) */
  function readBack(p) { return p.then(null, function (e) { var x = new Error((e && e.message) || "The league did not answer."); x.readBack = true; throw x; }); }
  function setCount() { var n = document.getElementById("puBoxN"); if (n) n.textContent = plural((G.rows || []).length, "line"); }
  function rowSave(tr) {
    var rid = tr.dataset.row, gid = G.id, sel = tr.querySelector('[data-f="profile_id"]'), btn = tr.querySelector('[data-pu="row-save"]');
    var x = (G.rows || []).filter(function (r) { return r.id === rid; })[0], p = linePatch(rowVals(tr), sel ? sel.dataset.orig : "");
    btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Saving…"; BUSY++;
    say("puBoxMsg", "Saving " + rowName(x) + "’s line…");
    S2.write("stats_pickup_row", { p_row_id: rid, p_game: gid, p: p }).then(function (r) {
      var row = r && r.data;
      if (!row || row.id !== rid) throw new Error("The league did not confirm the change. Reload the page to see the line as it stands.");
      row = withTag(Object.assign({}, x || {}, row));
      G.rows = (G.rows || []).map(function (y) { return y.id === rid ? row : y; });
      var now = document.getElementById("puRow-" + rid);
      if (now) { now.outerHTML = rowHtml(row); var b = document.querySelector("#puRow-" + CSS.escape(rid) + ' [data-pu="row-save"]'); if (b) b.focus({ preventScroll: true }); }
      say("puBoxMsg", "Saved " + rowName(row) + "’s line.");
    }).catch(function (e) {
      btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = "Save";
      say("puBoxMsg", "Not saved: " + e.message, true);
    }).then(function () { BUSY--; });
  }
  function rowDelete(tr) {
    var rid = tr.dataset.row, x = (G.rows || []).filter(function (r) { return r.id === rid; })[0];
    S2.confirm({ title: "Remove this line?", danger: true, ok: "Remove the line",
      why: [rowName(x) + "’s line comes off this pickup game and their profile. League results are not affected."],
      onOk: function () {
        BUSY++; say("puBoxMsg", "Removing " + rowName(x) + "’s line…");
        S2.write("stats_pickup_row_delete", { p_row_id: rid }).then(function () {
          /* the door returns nothing, so the line is read back: gone from the league before it goes from the page */
          return readBack(rd(function (c) { return c.from("pickup_stats").select("id").eq("id", rid).maybeSingle(); })).then(function (still) {
            if (still) throw new Error("The league did not confirm the removal: the line is still on file.");
            G.rows = (G.rows || []).filter(function (y) { return y.id !== rid; });
            var now = document.getElementById("puRow-" + rid); if (now) now.remove();
            var tb = document.getElementById("puRows"); if (tb && !tb.children.length) tb.innerHTML = emptyRow();
            setCount(); say("puBoxMsg", "Removed " + rowName(x) + "’s line.");
            var h = document.getElementById("puBoxH"); if (h) h.focus({ preventScroll: true });
          });
        }).catch(function (e) { say("puBoxMsg", e.readBack ? "The removal was sent, but the line could not be read back to confirm it (" + e.message + "). Reload before trying again." : "Not removed: " + e.message, true); }).then(function () { BUSY--; });
      } });
  }
  function rowAdd(btn) {
    var gid = G.id, nm = document.getElementById("puNewName"), sd = document.getElementById("puNewSide"), gk = document.getElementById("puNewG");
    var name = (nm && nm.value || "").trim(), side = sd ? sd.value : "A", goalie = !!(gk && gk.checked);
    btn.disabled = true; btn.setAttribute("aria-busy", "true"); BUSY++;
    say("puBoxMsg", "Adding the line…");
    S2.write("stats_pickup_row", { p_row_id: null, p_game: gid, p: { skater_name: name || "New player", team_side: side, is_goalie: goalie } }).then(function (r) {
      var row = r && r.data;
      if (!row || !row.id || row.pickup_game_id !== gid) throw new Error("The league did not confirm the new line. Reload the page to see the box score as it stands.");
      row = withTag(row); G.rows = (G.rows || []).concat([row]);
      var tb = document.getElementById("puRows");
      if (tb) { var none = tb.querySelector(".pu-none"); if (none) none.remove(); tb.insertAdjacentHTML("beforeend", rowHtml(row)); }
      if (nm) nm.value = ""; if (gk) gk.checked = false;
      setCount(); say("puBoxMsg", "Added " + rowName(row) + "’s line. Link the member and enter the numbers, then save it.");
      var s = document.querySelector("#puRow-" + CSS.escape(row.id) + " select"); if (s) s.focus({ preventScroll: true });
    }).catch(function (e) { say("puBoxMsg", "Not added: " + e.message, true); }).then(function () {
      btn.disabled = false; btn.removeAttribute("aria-busy"); BUSY--;
    });
  }
  function metaSave(btn) {
    var gid = G.id, box = document.getElementById("puMeta"); if (!box) return;
    var vals = {}, orig = "";
    Array.prototype.forEach.call(box.querySelectorAll("[data-m]"), function (el) { vals[el.dataset.m] = el.type === "checkbox" ? el.checked : el.value; if (el.dataset.m === "played_at") orig = el.dataset.orig || ""; });
    var p = metaPatch(vals, orig);
    btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Saving…"; BUSY++;
    say("puMetaMsg", "Saving the game…");
    S2.write("stats_pickup_update_game", { p_game: gid, p: p }).then(function () {
      /* the door returns nothing: the game is read back, and the page shows what the league holds */
      return readBack(rd(function (c) { return c.from("pickup_games").select("*").eq("id", gid).maybeSingle(); })).then(function (g) {
        if (!g) throw new Error("The league has no such game any more. It may have been deleted.");
        var bad = metaHeld(p, g);
        G.g = g; paint("puHead"); paint("puMeta");
        var b = document.querySelector('#puMeta [data-pu="meta-save"]'); if (b) b.focus({ preventScroll: true });
        say("puMetaMsg", bad.length ? "The league did not take every change: " + bad.join(", ") + " still read" + (bad.length === 1 ? "s" : "") + " as shown. Try again, or tell a commissioner." : "Saved.", bad.length > 0);
      });
    }).catch(function (e) {
      var b2 = document.querySelector('#puMeta [data-pu="meta-save"]');
      if (b2) { b2.disabled = false; b2.removeAttribute("aria-busy"); b2.textContent = "Save the game"; }
      say("puMetaMsg", e.readBack ? "The change was sent, but the game could not be read back to confirm it (" + e.message + "). Reload before trying again." : "Not saved: " + e.message, true);
    }).then(function () { BUSY--; });
  }
  function gameDelete() {
    var gid = G.id, g = G.g; if (!g) return;
    S2.confirm({ title: "Delete this game?", danger: true, ok: "Delete the game",
      why: ["The game and every one of its player lines come off player profiles. It can’t be undone. League results are not affected."],
      onOk: function () {
        BUSY++; say("puMetaMsg", "Deleting the game…");
        S2.write("stats_pickup_delete", { p_game: gid }).then(function () {
          return readBack(rd(function (c) { return c.from("pickup_games").select("id").eq("id", gid).maybeSingle(); })).then(function (still) {
            if (still) throw new Error("The league did not confirm the delete: the game is still on file.");
            LIST.flash = { ok: true, text: scoreText(g) + " was deleted." }; LIST.rows = null; LIST.at = 0;
            /* qa (nits 17): the deleted game leaves the page's state too, so Back never redraws it from a fresh-looking copy */
            G = { id: null, g: undefined, rows: null, err: null, req: G.req, at: 0 };
            S2.go("#/pickups");
          });
        }).catch(function (e) { say("puMetaMsg", e.readBack ? "The delete was sent, but the game could not be read back to confirm it (" + e.message + "). Reload before trying again." : "Not deleted: " + e.message, true); }).then(function () { BUSY--; });
      } });
  }
  function gamePage(id) {
    enterGame(id);
    return '<div class="pu" id="puRoot">' + S2.crumbs([["#/pickups", "Pickup games"], ["", "Pickup game"]]) + PARTS.puHead() + PARTS.puGame() + "</div>";
  }

  /* ---------------------------------------- a member's pickup lines, on their profile ---------------------------------------- */
  /* CG.renderPickupStats and AFTER.player's pickup read (part5a_public.js 3344 and 3541). js/pages/profile.js (e7) places
     the section with one call, S2.pickups.profileHtml(p.id), in its render; the read starts there and the section fills in
     place when the league answers (the router has drawn the page by then). It stays hidden while it loads and when the member
     has no pickup game, as most profiles have none, so the page never jumps for nothing; a failed read is said, with Try
     again. The note says these games are not league play, as the classic's did: nothing here reaches a league total. */
  var PROF = {}, PROF_TTL = 60000;
  var PROF_SEL = "id,goals,assists,shots,hits,pim,plus_minus,is_goalie,saves,shots_against,goals_against,shutout,team_side,pickup_games(id,club_a,club_b,score_a,score_b,played_at,went_ot)";
  function profileHtml(pid) {
    if (!pid) throw new Error("S2.pickups.profileHtml needs the member's profile id");
    /* i3d (2026-11-25): the site always has the league client now; a page without one fails the read, which is said */
    var s = PROF[pid];
    if (!s || (!s.pending && (s.err || Date.now() - s.at > PROF_TTL))) profLoad(pid);
    return profSec(pid);
  }
  function profLoad(pid, refocus) {   /* refocus: Try again was pressed, and the button it disables has lost focus by the answer */
    var s = PROF[pid] = PROF[pid] || { rows: null, err: null, at: 0, req: 0, pending: false };
    var req = ++s.req; s.pending = true;
    rd(function (c) { return c.from("pickup_stats").select(PROF_SEL).eq("profile_id", pid).limit(API_MAX); }).then(function (rows) {
      if (req !== s.req) return;
      rows = rows || [];
      /* CG.sbCapped: one member's lines are a scoped read, so a full page may be missing lines; said, never shown short */
      if (rows.length >= API_MAX) throw new Error("The pickup lines came back at the " + API_MAX + "-row limit and may be missing some, so none are shown.");
      s.rows = rows; s.err = null; s.at = Date.now();
    }).catch(function (e) { if (req === s.req) { s.err = e.message; s.rows = null; } }).then(function () {
      if (req !== s.req) return;
      s.pending = false;
      var el = document.getElementById("puProf"); if (!el || el.dataset.pid !== pid) return;
      var had = refocus || el.contains(document.activeElement);
      el.outerHTML = profSec(pid);
      if (had) { var f = document.querySelector('#puProf [data-pu="prof-retry"], #puProfH'); if (f) f.focus({ preventScroll: true }); }
    });
  }
  function profSec(pid) {
    var s = PROF[pid] || {}, open = '<section class="pu-sec pu-prof" id="puProf" data-pid="' + esc(pid) + '"';
    var head = function (o) { return S2.secHead(Object.assign({ kicker: "Not league play", id: "puProfH", focus: true, h: "Pickup games" }, o)); };
    if (s.err) return open + ' aria-labelledby="puProfH">' + head({}) +
      S2.empty("err", "Couldn’t load pickup stats", esc(s.err), '<button type="button" class="btn sm secondary" data-pu="prof-retry"' + (s.pending ? ' disabled aria-busy="true">Trying again…' : ">Try again") + "</button>") + "</section>";
    if (!s.rows || !s.rows.length) return open + (s.pending ? ' aria-busy="true"' : "") + " hidden></section>";
    var sk = s.rows.filter(function (x) { return !x.is_goalie; }), gl = s.rows.filter(function (x) { return x.is_goalie; }), both = sk.length > 0 && gl.length > 0;
    return open + ' aria-labelledby="puProfH">' + head({ aside: '<span class="chip">' + esc(plural(s.rows.length, "game")) + "</span>",
      p: "Games from the #pickup-games lobbies, with the same statistics as league play, kept apart from it: they never count toward league totals, draft or bidding eligibility, ratings or awards." }) +
      (sk.length ? profRole(sk, false, both) : "") + (gl.length ? profRole(gl, true, both) : "") + "</section>";
  }
  function profRole(list, goalie, both) {
    var name = goalie ? "In goal" : "As a skater", w = function (x) { return String((x.pickup_games || {}).played_at || ""); };
    var cols = goalie ? [["SA", "Shots against"], ["SV", "Saves"], ["GA", "Goals against"], ["Result", ""]] : [["G", "Goals"], ["A", "Assists"], ["P", "Points"], ["S", "Shots"], ["+/-", "Plus-minus"], ["PIM", "Penalty minutes"]];
    var log = list.slice().sort(function (a, b) { return w(b).localeCompare(w(a)); }).map(function (x) {
      var gm = x.pickup_games || {}, pm = x.plus_minus || 0;
      var game = gm.id ? '<a href="#/pickups/' + esc(gm.id) + '">' + esc(scoreText(gm)) + "</a>" : esc(scoreText(gm));
      var cells = goalie ? [x.shots_against || 0, x.saves || 0, x.goals_against || 0, lineResult(x) || "–"]
        : [x.goals || 0, x.assists || 0, "<b>" + ((x.goals || 0) + (x.assists || 0)) + "</b>", x.shots || 0, (pm > 0 ? "+" : "") + pm, x.pim || 0];
      return "<tr><td>" + esc(gm.played_at ? day(gm.played_at) : "–") + "</td><td>" + game + (gm.went_ot ? ' <span class="chip">OT</span>' : "") + "</td><td>" + cells.join("</td><td>") + "</td></tr>";
    }).join("");
    return '<div class="pu-role">' + (both ? '<h3 class="t-head">' + name + "</h3>" : "") +
      '<dl class="pu-figs">' + roleFigures(list, goalie).map(function (f) { return '<div class="metric"><dt class="label">' + f[0] + '</dt><dd class="t-stat-sm num">' + esc(f[1]) + "</dd></div>"; }).join("") + "</dl>" +
      '<div class="tbl-wrap"><table class="tbl pu-tbl"><caption class="sr">Pickup game log, ' + name.toLowerCase() + '</caption><thead><tr><th scope="col">Date</th><th scope="col">Game</th>' +
      cols.map(function (c) { return '<th scope="col">' + (c[1] ? '<abbr title="' + c[1] + '">' + c[0] + "</abbr>" : c[0]) + "</th>"; }).join("") + "</tr></thead><tbody>" + log + "</tbody></table></div></div>";
  }
  /* Try again on the profile's section: the profile page's root has its own click handler, so this one listens once on the
     document and answers only inside the section */
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest('#puProf [data-pu="prof-retry"]') : null; if (!b || b.disabled) return;
    b.disabled = true; b.setAttribute("aria-busy", "true"); b.textContent = "Trying again…";
    profLoad(b.closest("#puProf").dataset.pid, true);
  });

  /* =========================================================================================================== */
  /* EVENTS (on the page's own root, which each visit draws anew, so nothing piles up)                           */
  /* =========================================================================================================== */
  function onClick(e) {
    if (onImpClick(e)) return;
    var b = e.target.closest ? e.target.closest("[data-pu]") : null; if (!b) return;
    var a = b.dataset.pu, tr = b.closest("[data-row]");
    if (a === "gate") { GATE.who = undefined; ensureGate(); }
    else if (a === "list-retry") { LIST.err = null; LIST.rows = null; paint("puList"); loadList().catch(function () { /* said in the list */ }); }
    else if (a === "list-del") listDelete(b.dataset.id);
    else if (a === "game-retry") { G.err = null; G.g = undefined; paint("puHead"); loadGame(); }
    /* aria-disabled, not disabled: a disabled button drops focus to BODY, and the note's repaint keeps it in the note */
    else if (a === "profs-retry") { if (PROFS.pending) return; b.setAttribute("aria-disabled", "true"); b.setAttribute("aria-busy", "true"); b.textContent = "Reading the members…"; PROFS.err = null; loadProfiles(); }
    else if (a === "row-save" && tr) rowSave(tr);
    else if (a === "row-del" && tr) rowDelete(tr);
    else if (a === "row-add") rowAdd(b);
    else if (a === "meta-save") metaSave(b);
    else if (a === "game-del") gameDelete();
  }
  function bindImport(root, onDone) {
    IMP.onDone = onDone || null;
    root.addEventListener("click", onImpClick);
    root.addEventListener("change", onImpChange);
    root.addEventListener("keydown", onImpKey);
    root.addEventListener("input", onImpInput);
    if (S2.ea && root.querySelector("[data-ea-status]")) S2.ea.paintStatus(root);
  }

  S2.page("pickups", {
    title: function (r) { return r.arg ? "Pickup game" : "Pickup games"; },
    /* nothing here comes from the league read, so the pulse has nothing to repaint; each write repaints its own part */
    repaintsItself: true,
    render: function (r) { return r.arg ? gamePage(r.arg) : listPage(); },
    after: function (root, r) {
      var el = S2.$("#puRoot", root); if (!el) return;
      el.addEventListener("click", onClick);
      el.addEventListener("change", onImpChange);
      el.addEventListener("keydown", onImpKey);
      el.addEventListener("input", onImpInput);
      IMP.onDone = function () { loadList().catch(function () { /* said in the list */ }); };
      ensureGate();
      if (r.arg) { if (G.g === undefined || Date.now() - G.at > 60000) loadGame(); else if (gate() === true) loadProfiles(); }
      else if (!LIST.rows || Date.now() - LIST.at > 60000) loadList().catch(function () { /* said in the list */ });
      if (S2.ea && el.querySelector("[data-ea-status]")) S2.ea.paintStatus(el);
    }
  });

  /* the importer, for a page that offers it to members (js/pages/office.js #/pickup-import), the profile's section
     (js/pages/profile.js), and the ported helpers */
  S2.pickups = { importHtml: importHtml, bindImport: bindImport, profileHtml: profileHtml, href: function (id) { return id ? "#/pickups/" + encodeURIComponent(id) : "#/pickups"; } };
  S2._pickups = { pure: { etDate: etDate, scoreText: scoreText, linePatch: linePatch, metaPatch: metaPatch, metaHeld: metaHeld, result: result, samePair: samePair, lineResult: lineResult, roleFigures: roleFigures } };
})();
