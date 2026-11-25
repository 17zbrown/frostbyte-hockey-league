/* #/desk, #/desk/game/<id> and #/desk/application/<id>: the Staff Desk, organized by object (Today, Cases, Games,
   Applications, People, Committees, Transactions, Newsroom), the Game desk (the one home for a fixture) and the page of
   one application (its answers, every ballot with its reason, and the conversation with the applicant). Season 2 staffing (commissioner
   ruling, 2026-10-19): no departments; every staffer sees and works the whole desk, each item carries a committee TOPIC
   tag, and each committee has a manager (the default escalation for its topic). Where the ruling is silent (who may
   reverse, discipline caps, reserved actions) the desk shows a "Your call" note instead of inventing a rule.
   League website v2 (commissioner, 2026-10-19: "too much like a dashboard and not a League Website"): the desk wears the
   site's type (kicker, condensed uppercase title, a sentence that carries the number), the queue comes first, and the
   charts live together in one Reports band after the work instead of on top of it.
   i3d (2026-11-25): the desk runs only its real path. Everything on it is the league office's own records, read through
   the live layer below (cases, applications, ballots, discipline, the committees and the staff list) and S2.M (games,
   members, clubs); every act is a write through S2.write.
   Pro-tool rules (Linear, Mail): keyboard first (j and k move, Enter opens, c claims, e resolves, arrows walk the box
   score), keyboard actions never animate, edits repaint the widget in place and never reset the page, and the
   sitting merge is the one choreographed moment. Owned by the desk builder: js/pages/desk.js and css/desk.css only. */
(function () {
  "use strict";
  var S2 = window.S2, $ = S2.$, $$ = S2.$$, esc = S2.esc, M = S2.M, initials = S2.initials;   /* QA round 2: the one avatar initials, js/core.js */

  /* ---------- icons the kit lacks (same 24 grid and stroke as S2.ic) ---------- */
  var XP = {
    merge: '<path d="M6 4v4.5a5 5 0 005 5h1a5 5 0 005-5V4"/><path d="M12 13.5V20M9.5 17.5L12 20l2.5-2.5"/>',
    undo: '<path d="M8.5 6.5L4.5 10.5l4 4"/><path d="M4.5 10.5h9.5a5 5 0 010 10H12"/>',
    strike: '<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>',
    send: '<path d="M12 19.5V5M6.5 10.5L12 5l5.5 5.5"/>'
  };
  function ic(n, cls) {
    if (!XP[n]) return S2.ic(n, cls);
    return '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + XP[n] + "</svg>";
  }

  /* ---------- small helpers ---------- */
  var EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)", EASE_IO = "cubic-bezier(0.77, 0, 0.175, 1)";
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  function sum(a) { return a.reduce(function (x, y) { return x + (+y || 0); }, 0); }
  function plural(n, one, many) { return n === 1 ? one : n + " " + many; }
  function ageShort(h) { if (h == null) return ""; if (h < 1) return Math.max(1, Math.round(h * 60)) + " min"; if (h < 24) return Math.round(h) + " h"; return Math.round(h / 24) + " d"; }
  function ageLong(h) { return h == null ? "" : h < 0.02 ? "just now" : M.ago(Math.round(h * 60)); }
  function clock(s) { return M.toi(Math.round(s)); }
  function narrow() { return window.innerWidth < 1000; }
  /* change the address in place, keeping the entry's state (the kit keys its scroll memory on history.state.k) */
  function setHash(h) { history.replaceState(history.state, "", h); }
  function moving() { return !S2.reduce.matches; }
  function teamName(c) { var t = M.team(c); return t ? t.full : c; }

  /* ---------- the EA club search (live v4.34 to v4.37), shared with the Control Center's club sheet (control.js) ----------
     Every staff box that searches EA goes through the bot's server, the only host EA answers (CG.eaPost waits on
     ea_lookup_state up to 25 s), and each box carries a status line from the bot server's self-test every ten minutes
     (CG.eaStatusLine, CG.paintEaStatus). The commissioner, 2026-10-29: "Also this box in the staff desk never works. Can
     you make sure you check regularly that it works". No EA club id is ever shown (data/README.md privacy).
     g1 (2026-11-24, g2's hand-over): both names call S2.ea (js/pages/gamedesk.js, the port of CG.eaPost and
     CG.eaStatusLine), the one EA door on the new site. S2.eaSearch answers a Promise (the bot server can take 25 seconds) */
  S2.eaSearch = function (q) {
    q = String(q || "").trim().replace(/\s+/g, " ");
    if (q.length < 3) return Promise.resolve({ ok: false, text: "Type three letters or more of the club’s EA name." });
    if (!S2.ea || !S2.ea.post) return Promise.resolve({ ok: false, text: "The EA search is not on this page (js/pages/gamedesk.js did not load), so nothing was searched." });
    return S2.ea.post("/api/pickup-import", { action: "search", clubName: q }).then(function (o) {
      if (!o || o.error) return { ok: false, text: (o && o.error) || "The server did not answer." };
      return { ok: true, clubs: (o.clubs || []).map(function (c) { return { name: c.name, members: c.memberCount == null ? null : c.memberCount, clubId: c.clubId }; }) };
    }, function (e) { return { ok: false, text: e.message }; });
  };
  /* the bot server's real self-test, painted in place once the caller has put the line on the page */
  S2.eaStatusLine = function () {
    if (!S2.ea || !S2.ea.statusLine) return '<p class="ea-status"><span class="ea-dot" aria-hidden="true"></span><span>The EA search status could not be read: js/pages/gamedesk.js did not load. Reload the page.</span></p>';
    setTimeout(function () { S2.ea.paintStatus(); }, 0);
    return S2.ea.statusLine();
  };
  /* motion: a value that changed in place gets a quick blurred cross-fade (the blur bridges the two states) */
  function swapIn(el, delay) {
    if (!el) return;
    if (!moving()) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: delay || 0, fill: "backwards" }); return; }
    el.animate([{ opacity: 0, filter: "blur(4px)", transform: "translateY(3px)" }, { opacity: 1, filter: "blur(0)", transform: "none" }], { duration: 240, delay: delay || 0, easing: EASE_OUT, fill: "backwards" });
  }
  function enterIn(el, dx, dy) {
    if (!el) return;
    if (!moving()) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 }); return; }
    el.animate([{ opacity: 0, transform: "translate(" + (dx || 0) + "px," + (dy == null ? -6 : dy) + "px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: EASE_OUT });
  }
  /* a row leaving a list: a ghost of it closes the gap so nothing below jumps (the real DOM is already final) */
  function ghostOut(parent, node, before) {
    if (!node || !parent || !moving()) return;
    var g = node.cloneNode(true);
    ["data-case", "data-kbd-item", "data-imp", "data-app", "id", "href", "tabindex", "role", "aria-selected"].forEach(function (a) { g.removeAttribute(a); });
    g.setAttribute("aria-hidden", "true"); g.inert = true; g.classList.add("dk-ghost");
    parent.insertBefore(g, before || null);
    var h = g.offsetHeight, done = false, fin = function () { if (!done) { done = true; g.remove(); } };
    var a = g.animate([{ height: h + "px", opacity: 1 }, { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", marginBottom: "0px" }], { duration: 220, easing: EASE_OUT, fill: "forwards" });
    a.onfinish = fin; setTimeout(fin, 400);   /* a hidden tab may pause the timeline; the ghost still leaves */
  }

  /* ---------- who is looking: the signed-in member, and the hats the database gives them ---------- */
  /* committees are TOPICS, not permissions (S2 ruling, 2026-10-19): one staff, and anyone may pick up any item. Six since
     2026-11-23, from the one definition (S2.COMMITTEE_DEFS, js/flows.js); Game Operations' work is Officiating's now.
     covers: the charter as a sentence */
  var COMMITTEES = S2.COMMITTEE_DEFS.map(function (c) { return { key: c.key, name: c.name, covers: S2.committeeCovers(c), charter: c.charter, powers: !!c.powers }; });
  function com(key) { return COMMITTEES.filter(function (c) { return c.key === key; })[0] || null; }
  function comName(key) { var c = com(key); return c ? c.name : ""; }
  /* who holds a seat: the one read of public.committees (loadComs, below; i3f deleted the second copy in js/flows.js). A
     seat is filled by staff applying and the other staff voting (RULING 2026-11-23); the desk's own vote on a committee
     manager application fills it below */
  function manager(key) {
    /* the seat as public.committees holds it (manager_profile_id; a seat is filled by a staff vote, Rule S2.8) */
    var c0 = (LV.coms || []).filter(function (x) { return x.key === key; })[0]; return c0 && c0.manager_profile_id ? nameOf(c0.manager, "A staff member") : null;
  }
  /* who is signed in, and what the database says they are (the gates, read by the live layer below) */
  function me() { var G = LV.G || {}, nm = myName(); return { name: nm, id: myId(), short: initials(nm), commish: !!G.commish, manager: !!G.cm, manages: ((S2.session && S2.session.committees) || [])[0] || null }; }
  /* the topic tag every item wears: quiet text, never a colored chip (committees have no colors of their own) */
  function tag(key) { return key ? '<span class="dk-tag">' + esc(comName(key)) + "</span>" : ""; }
  function mgrBadge() { return '<span class="dk-mgr">Manager</span>'; }
  function yourCall() { return '<span class="dk-call">Your call</span>'; }

  /* Committees sits below every work pane (commissioner, 2026-10-22: "move the Committees page to be below all the specific
     staff role tabs"), right above "You manage" */
  var PANES = [["today", "Today"], ["cases", "Cases"], ["games", "Games"], ["applications", "Applications"],
    ["people", "People"], ["transactions", "Transactions"], ["newsroom", "Newsroom"], ["committees", "Committees"]];
  var PANE_KEYS = PANES.map(function (p) { return p[0]; });
  function paneLabel(k) { return (PANES.filter(function (p) { return p[0] === k; })[0] || PANES[0])[1]; }

  /* session state: survives route renders, never written anywhere */
  var st = { psheet: null, scope: "open", caseId: null, gview: "ruling", appType: "all", pfilter: "all", pq: "", listY: 0,
    games: {}, view: "today", pushed: false, focus: null };
  var R = "reveal";   /* the page entrance class; empty during in-place repaints so the entrance does not run again */

  /* ---------- the attention queue: real aggregates until this session acts, then the session's own state ---------- */
  /* a group of one is a shape and a sentence, never the number 1 */
  function group(n, one, many) { return n === 1 ? { count: 1, display: null, shape: true, label: "One " + one } : { count: n, display: String(n), shape: false, label: n + " " + many }; }
  /* one definition of staff casework, as the live CG.staffCases (v3.23, Rule 2.3; commissioner, 2026-09-25: "trade
     requests go to the team management of the player requesting the trade... Not the league staff"). A trade request is a
     club matter: it never appears in a desk list, count, committee queue or attention row, so every case read goes
     through this filter */
  function staffType(type) { return type !== "trade_request"; }
  function attention() { return lvAttention(); }
  /* the ONE live "what waits on the desk": the Control Center reads it too, so a case resolved or a held sitting ruled here
     stops waiting there (review 2026-10-19: the Control Center read the snapshot and kept "One complaint in review") */
  S2.deskAttention = attention;

  function cases() { return LV.cases || []; }
  /* ids compare as text (the league's are uuids; a link carries them as text) */
  function caseById(id) { return id == null ? null : cases().filter(function (c) { return String(c.id) === String(id); })[0] || null; }
  function isOpen(c) { return c.status !== "resolved" && c.status !== "denied"; }
  function caseScope(scope) {
    return cases().filter(function (c) {
      var o = isOpen(c);
      return scope === "open" ? o : scope === "unclaimed" ? o && !c.claimant : scope === "mine" ? o && c.claimantId === myId() : !o;
    }).sort(function (a, b) { return scope === "closed" ? a.ageHours - b.ageHours : b.ageHours - a.ageHours; });
  }
  var STATUS = { open: ["Open", "s-open"], reviewing: ["In review", "s-rev"], resolved: ["Resolved", "s-ok"], denied: ["Denied", "s-no"] };

  /* ---------- applications: the league's (owner, staff, front office and committee seats), decided ones counted by type ---------- */
  function apps() {
    var L0 = LV.apps || [], dn = function (t, stt, role) { return L0.filter(function (a) { return a.type === t && a.outcome === stt && (!role || a.row.role === role); }).length; };
    return { list: L0.filter(function (a) { return a.stage !== "closed"; }), d: { owner: dn("owner", "approved"), staffOk: dn("staff", "approved"), staffNo: dn("staff", "denied"), gm: dn("management", "approved", "gm"), agm: dn("management", "approved", "agm") } };
  }
  function appById(id) { return (LV.apps || []).filter(function (a) { return a.id === id; })[0] || null; }

  /* ---------- games ---------- */
  /* the sidebar counts, from the same helpers the lists use; repainted in place after every act */
  /* g2's hand-over: the games count is the Game desk's own list of what waits (held, or no result two hours after puck drop) */
  function gamesWaiting() { return S2._gamedesk && S2._gamedesk.waiting ? S2._gamedesk.waiting() : []; }
  function counts() { return { today: attention().length, cases: caseScope("open").length, games: gamesWaiting().length }; }
  function syncCounts() { var c = counts(); $$("[data-count-of]").forEach(function (el) { var v = c[el.dataset.countOf]; if (v != null && el.textContent !== String(v)) el.textContent = v; }); }
  function nextNight() {
    var today = M.etDay(M.generated), up = M.nights({ when: "upcoming" }).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return { tonight: up.filter(function (n) { return n.date === today; })[0] || null, next: up.filter(function (n) { return n.date > today; })[0] || null };
  }
  function gs(id) {   /* the Game desk's working copy of one fixture */
    if (st.games[id]) return st.games[id];
    var g = M.game(id); if (!g) return null;
    var box = {}; Object.keys(g.box || {}).forEach(function (k) { box[k] = g.box[k].map(function (l) { return Object.assign({}, l); }); });
    st.games[id] = { g: g, as: g.as, hs: g.hs, ot: !!g.ot, ruling: g.forfeit ? { type: null, club: g.forfeit, kept: !!g.kept } : null, reversed: false,
      box: box, club: g.away, edits: [], merged: false, struck: false, hist: [], resEdit: null, rulEdit: null,
      ea: { q: "", busy: false, res: null, msg: "", club: null, side: null, why: "", err: "", done: null } };
    return st.games[id];
  }
  function cur() { var r = S2.parse(); return r.arg === "game" ? gs(r.sub) : null; }
  function hist(s, what) { s.hist.unshift({ at: Date.now(), what: what, who: me().name, session: true }); }
  /* which committee a fixture belongs to right now: a held sitting is an import question; a forfeit and every other
     game-night matter are Officiating's (Game Operations folded into it, 2026-11-23) */
  function gameTopic(s) {
    var held = M.sittings(s.g.id).some(function (x) { return x.held; }) && !s.merged;
    return held ? "statistics" : "officiating";
  }

  /* ---------- committees: each one's queue, from the same helpers the panes use (one definition, session-aware) ---------- */
  var AGE_B = [24, 72, 168];   /* the four age buckets of the case-aging report: under 1 day, 1 to 3, 3 to 7, over 7 days */
  function bucket4(h) { return h < AGE_B[0] ? 0 : h < AGE_B[1] ? 1 : h < AGE_B[2] ? 2 : 3; }
  function committeeItems(key) {
    var out = caseScope("open").filter(function (c) { return c.c === key; }).map(function (c) {
      return { kind: "case", id: c.id, label: c.title, sub: c.typeLabel + " · #" + c.id, ageHours: c.ageHours, claimant: c.claimant, toMgr: c.toMgr, escalated: c.escalated,
        href: "#/desk?tab=cases&amp;case=" + c.id, pane: "cases" };
    });
    attention().forEach(function (a) {
      if (a.kind === "case" || a.c !== key) return;
      out.push({ kind: a.kind, label: a.label, sub: a.note || "", ageHours: a.ageHours, shapes: a.shapes, shape: a.shape, display: a.display, confidential: a.confidential,
        href: a.href, pane: a.pane, watch: a.kind === "discipline", icon: a.icon });
    });
    /* escalated to the manager first, then the oldest; standing watch items (discipline in force) last */
    return out.sort(function (a, b) { return (a.watch ? 1 : 0) - (b.watch ? 1 : 0) || (b.toMgr ? 1 : 0) - (a.toMgr ? 1 : 0) || (b.ageHours == null ? -1 : b.ageHours) - (a.ageHours == null ? -1 : a.ageHours); });
  }
  function committeeHealth(key) {
    var items = committeeItems(key), open = items.filter(function (x) { return !x.watch; }), aged = open.filter(function (x) { return x.ageHours != null; });
    var ages = [0, 0, 0, 0]; aged.forEach(function (x) { ages[bucket4(x.ageHours)]++; });
    var n = open.length;
    return { items: items, open: open, n: n, ages: ages, oldest: aged.length ? Math.max.apply(null, aged.map(function (x) { return x.ageHours; })) : null,
      openSay: countSay(n),
      unclaimed: open.filter(function (x) { return x.kind === "case" && !x.claimant; }).length,
      toMgr: open.filter(function (x) { return x.toMgr; }).length };
  }
  /* a committee count in words, "None" for zero, through S2.words (QA round 2 review: the lineup read "4 open" beside "One
     open", the desk's own None/One/numeral rule beside core's words) */
  function countSay(n) { return cap1(nw(n)); }

  function shapes(n, label) { return S2.shapes(n, label); }   /* core's one count of dots */

  /* =========================================================================================================== */
  /* shell: head and sidebar                                                                                      */
  /* =========================================================================================================== */
  function stateBox(kind, title, text, actions) { return S2.empty(kind, title, text, actions); }   /* core's one state box */
  /* every pane opens with a sentence that carries its number (league website v2: "numbers in sentences first") */
  /* Season 2 is what the desk checks (review 2026-11-03: the Season 1 group limits, 7 F, 5 D and 3 G, flagged legal
     waiver claims and Saturday bidding signings in red, and the camp-inclusive payroll gave a third cap-room figure).
     S2.market.clubState (js/market.js) is the one definition: 12 active, at least 3 F, 2 D and 1 G (2026-11-23), payroll is the active
     roster, cap room is the season's cap less that ($30M in Season 2, commissioner 2026-11-09). Room and spots are read BEFORE the bids a club leads in a live room, never
     freeSpots or freeRoom: the bidding clubs stay hidden until a lot is over, from staff too (Rule S2.6). Without the
     market there is nothing true to show, so the pane says so instead of falling back to Season 1 figures */
  /* qa (visual 19, function 15): the 3/2/1 minimums run "from the draft onward" (Rule S2.4), so before the season's draft
     is complete an empty group is the expected state, never a club outside a limit. Complete is draft_state.status, the
     test the market itself opens on (public._market_draft_done, v4.58) and Team HQ's draftPhase reads: the league read's
     draft section (S2.M.draft, kept current by the pulse), or the market's own draft_done once a page has read the market.
     QA round 2 (2026-11-25): that test is now M.draftDone (js/model.js), the one definition the Control Center and Team HQ
     call too; S2.draftDone, the round-1 export, stays as its other name and only forwards to it */
  function draftDone() { return M.draftDone(); }
  S2.draftDone = draftDone;
  function txOut(cs, pre) {
    var o = {}; if (cs.active.total > cs.limit) o.total = true; if (cs.room < 0) o.room = true;
    if (!pre) ["F", "D", "G"].forEach(function (k) { if (cs.active[k] < cs.mins[k]) o[k] = true; });
    return o;
  }
  function txOver() {
    if (!S2.market) return null;
    var pre = !draftDone();
    var rows = M.teams.map(function (t) { var cs = S2.market.clubState(t.code), r = M.roster(t.code); return cs && r ? { cs: cs, seats: r.seats, out: txOut(cs, pre) } : null; }).filter(Boolean);
    return { rows: rows, cs: rows[0] ? rows[0].cs : null, pre: pre, over: rows.filter(function (x) { return Object.keys(x.out).length; }) };
  }
  /* the sentence the desk says about the minimums before the draft: the day rosters are built */
  function txPreSay() { return "Rosters are built at the draft on " + esc(M.etDate(M.s2cal.draft)) + "; the minimums apply from the draft (Rule S2.4)."; }
  var TX_NONE = "The Season 2 market (js/market.js) did not load, so no club's Season 2 roster or cap room can be read.";
  var LEDE = {
    today: function () {
      var L = attention(), n = L.length, old = L[0] && L[0].ageHours != null ? Math.round(L[0].ageHours / 24) : 0;
      if (!n) return "Nothing waits for staff. Checked at " + esc(deskTime()) + " ET.";
      return (n === 1 ? "One item waits" : n + " items wait") + " for staff, oldest first." + (old >= 1 ? " The oldest has waited about " + plural(old, "a day", "days") + "." : "");
    },
    cases: function () {
      var o = caseScope("open").length, u = caseScope("unclaimed").length;
      return (o === 1 ? "One case is open, and " + (u ? "nobody is on it yet." : "it is claimed.")
        : o ? o + " cases are open" + (u ? " and " + (u === 1 ? "one has nobody on it yet." : u + " have nobody on them yet.") : ", and every one is claimed.") : "No case is open.") +
        " Every staffer sees every filing; the committee tag says whose topic it is. Trade requests go to the club's front office (Rule 2.3), not here.";
    },
    games: function () {
      var n = gamesWaiting().length;
      return (n === 1 ? "One game waits on this desk." : n ? n + " games wait on this desk." : "No game waits on this desk.") +
        " Open any game to file its sittings, rule on it or fix its box score.";
    },
    /* qa (function 25): the same flip test the pane's body (lvAppsLead) and its ballots read */
    applications: function () { return (LV.flip ? "Every staffer and commissioner votes" : "The applications reviewers vote, every staffer and commissioner on a committee seat") + ", and the applicant only ever sees the decision. Owner applications stay confidential to the league office until owners are decided."; },
    people: function () { return M.players.length + " people on record. Open one for their club, their lines this season and the discipline tools."; },
    committees: function () { return "One staff, " + S2.words(COMMITTEES.length, "zero") + " committees. Anyone on staff may pick up any item; each committee has a manager who knows the topic best and is the first stop when something needs a second look."; },
    transactions: function () {
      var t = txOver();
      if (!t || !t.cs) return TX_NONE;
      if (t.pre) return (t.over.length ? (t.over.length === 1 ? "One club is" : t.over.length + " clubs are") + " outside a Season 2 limit: over " + t.cs.limit + " active or over the cap. Each row shows where. " : "") + txPreSay();
      return t.over.length ? (t.over.length === 1 ? "One club is" : t.over.length + " clubs are") + " outside a Season 2 limit: over " + t.cs.limit + " active, short of a minimum or over the cap. Each row shows where."
        : "All " + t.rows.length + " clubs sit inside the Season 2 roster limit of " + t.cs.limit + ", the minimums and the " + esc(M.money(t.cs.cap)) + " cap.";
    },
    newsroom: function () {
      var p = powerNow()[0], nx = nextNight().next;
      return (p ? "The " + esc(p.team.full) + " lead the power rankings with a club rating of " + p.ovr + "." : "No club leads the power rankings until a game is played.") +
        (nx ? " The next recap posts after the last final on " + esc(nx.label) + "." : "");
    }
  };
  /* the workspace is the title, as on You, Team HQ and Control Center; the pane is named by the rail and by an sr-only h2
     at the top of the main column, and the lede stays the pane's own sentence */
  function head(v) {
    return '<header class="page-head dk-head ' + R + '"><span class="kicker">' + esc(M.etDate(M.generated)) + "</span>" +
      '<h1 class="d-1" id="dkTitle" tabindex="-1">Staff Desk</h1><p class="lede-l" id="dkSub">' +
      (LV.state === "error" ? "The desk did not load, so nothing below can be read as clear." : LV.state !== "ready" || !may("desk") ? (LV.G && !may("desk") ? "The Staff Desk is for league staff." : "Reading the league office's records.")
        : LEDE[v.pane]()) + "</p></header>";
  }
  /* the HQ rail: condensed uppercase labels, an ink rule on the current section, counts as small numerals (no icons, no
     filled pill); under 1000px it becomes underlined tabs that scroll sideways, as Control Center's strip */
  function sidebar(pane) {
    var n = counts(), m = me();
    /* a manager's own committee is one more door into the Committees view (its focus), never a scope on the desk */
    return '<nav class="sidebar dk-side" aria-label="Staff Desk">' + PANES.map(function (p) {
      return '<a href="#/desk?tab=' + p[0] + '" data-pane="' + p[0] + '"' + (pane === p[0] ? ' aria-current="page"' : "") + "><span>" + p[1] + "</span>" +
        (n[p[0]] != null ? '<span class="count" data-count-of="' + p[0] + '">' + n[p[0]] + "</span>" : "") + "</a>";
    }).join("") + (m.manages ? '<div class="side-h dk-side-you">You manage</div><a class="dk-side-you" href="#/desk?tab=committees&amp;c=' + m.manages + '" data-pane="committees">' +
      "<span>" + esc(comName(m.manages)) + "</span>" + mgrBadge() + "</a>" : "") + "</nav>";
  }

  /* =========================================================================================================== */
  /* TODAY                                                                                                       */
  /* =========================================================================================================== */
  /* the kit's section head, as Control Center and Team HQ open a section: a kicker (the committee or topic), a .d-2
     headline and one 16px sentence. A head in a narrow column takes one step down (sm), as HQ's .hqx-h-sm. Panes sit
     under the sr-only pane h2, so their heads are h3; the Game desk (h1 = the fixture) passes lvl 2 */
  function secHead(o) {   /* core's one section head (S2.secHead, audit 2026-11-09) */
    return S2.secHead({ kicker: o.k, h: o.h, id: o.id, lvl: o.lvl || 3, sm: o.sm, focus: o.focus, swap: o.swap, p: o.p, aside: o.arrow, cls: "dk-sh" });
  }
  function arrowLink(href, text, pane) { return '<a class="arrow" href="' + href + '"' + (pane ? ' data-pane="' + pane + '"' : "") + "><span>" + esc(text) + "</span>" + S2.ic("chev") + "</a>"; }
  function attRow(a) {
    var trail;
    if (a.shapes) trail = shapes(a.shapes, a.label + ": " + a.display);
    else if (a.ageHours != null) trail = '<span class="dk-age num" title="Waiting since ' + esc(ageLong(a.ageHours)) + '">' + ageShort(a.ageHours) + "</span>";
    else if (a.trail) trail = '<span class="t-foot">' + esc(a.trail) + "</span>";
    else trail = a.shape ? shapes(1, a.label) : "";
    return '<a class="row dk-arow' + (a.kind === "import" ? " warn" : "") + '" href="' + esc(a.href) + '"' + (a.pane ? ' data-pane="' + a.pane + '"' : "") + " data-kbd-item>" +
      '<span class="grow">' + tag(a.c) + '<span class="title">' + esc(a.label) + '</span><span class="sub">' + esc(a.note || "") + "</span></span>" + trail + S2.chev() + "</a>";
  }
  function attCard() {
    var list = attention(), body;
    if (!list.length) body = stateBox("ok", "Nothing needs attention", "Every case is claimed, no game waits on the desk and no ballot or suspension request is waiting. Checked at " + esc(deskTime()) + " ET.");
    else body = '<div class="dk-rows" id="dkAtt" data-kbd-list>' + list.map(attRow).join("") + "</div>";
    return '<section class="dk-att ' + R + '" id="dkAttCard" aria-labelledby="dkAttH">' + secHead({ id: "dkAttH", k: "Every committee", h: "Needs attention",
        p: !list.length ? "" : "Oldest first. Each item wears its committee; anyone on staff may pick it up.", arrow: arrowLink("#/desk?tab=cases", "All cases", "cases") }) +
      '<div class="dk-panel">' + body + "</div></section>";
  }
  /* qa (function 28): one time per pane, the desk read's (LV.at, set when loadAll lands): the head, Needs attention and
     Reports said three times from three reads (the league read, the desk read and s2_desk's generated) */
  function deskTime() { return M.etTime(new Date(LV.at || Date.now()).toISOString()); }
  /* a label after a big numeral starts the line, so it is capitalized */
  function cap1(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function discCard() { return lvDiscCard(); }
  function paneToday() { return lvGate(function () { return '<div class="dk-today"><div class="dk-top">' + attCard() + '<div class="dk-aside">' + discCard() + lvActCard() + "</div></div></div>"; }); }

  /* =========================================================================================================== */
  /* CASES: a Mail-style split, list then detail                                                                 */
  /* =========================================================================================================== */
  var SCOPES = [["open", "Open"], ["unclaimed", "Unclaimed"], ["mine", "Mine"], ["closed", "Closed"]];
  /* a listbox with a roving tabindex: one tab stop (the selected row), arrows and J/K move inside it */
  /* one line for type and committee, the age (with "Unclaimed" beside it when nobody is on it), the title, then only the
     state that matters: who has it, an escalation, and Resolved or Denied in the closed view. "Open" and "In review" are
     never chips: the filter says the first, the claimer's name says the second */
  function caseRow(c, sel, stop) {
    var s = STATUS[c.status], closed = !isOpen(c), meta = (c.claimant ? '<span class="dk-who"><span class="avatar dk-av xs">' + esc(initials(c.claimant)) + "</span>" + esc(c.claimant) + "</span>" : "") +
      (c.toMgr ? '<span class="dk-status s-esc">With the manager</span>' : "") + (c.escalated ? '<span class="dk-status s-esc">Commissioners</span>' : "") + (closed ? '<span class="dk-status ' + s[1] + '">' + s[0] + "</span>" : "");
    return '<button class="dk-crow" role="option" aria-selected="' + (sel ? "true" : "false") + '" tabindex="' + (stop ? "0" : "-1") + '" data-case="' + c.id + '" data-kbd-item>' +
      '<span class="dk-crow-top"><span>' + esc(c.typeLabel + " · " + comName(c.c)) + '</span><span class="dk-age num" title="Filed ' + esc(ageLong(c.ageHours)) + '">' + (!closed && !c.claimant ? '<span class="dk-unc">Unclaimed · </span>' : "") + ageShort(c.ageHours) + "</span></span>" +
      '<span class="dk-crow-title">' + esc(c.title) + "</span>" + (meta ? '<span class="dk-crow-meta">' + meta + "</span>" : "") + "</button>";
  }
  function caseRows(list, sel) {
    var body, stop = sel && list.some(function (c) { return c.id === sel.id; }) ? sel.id : list[0] ? list[0].id : null;
    if (!list.length) body = stateBox("ok", st.scope === "mine" ? "Nothing claimed by you" : st.scope === "closed" ? "No closed cases yet" : st.scope === "unclaimed" ? "Every open case is claimed" : "No open cases",
      st.scope === "mine" ? "Claim a case with C or the Claim button and it will wait for you here." : st.scope === "closed" ? "Resolved and denied cases collect here." : "Every filing has been answered.");
    else body = list.map(function (c) { return caseRow(c, sel && c.id === sel.id, c.id === stop); }).join("");
    return '<div class="dk-crows" id="dkCaseRows" role="listbox" aria-label="Cases" data-kbd-list>' + body + "</div>";
  }
  function caseDetail(c) {
    if (!c) return '<div class="dk-mdetail-in">' + stateBox("muted", "No case open", !caseScope(st.scope).length ? "There is no case in this view." : "Choose a case from the list. J and K move through it.") + "</div>";
    return lvCaseDetail(c);
  }
  function noteHtml(list) { return esc(st.scope === "closed" ? list.length + " closed, newest first" : list.length + " shown, oldest first"); }
  function paneCases(r) { return lvGate(function () { return casesBody(r); }); }
  function casesBody(r) {
    var hs = history.state && history.state.dkCase;   /* a phone case entry reached again by Back or Forward from another page */
    var list = caseScope(st.scope), q = r.q["case"] ? caseById(r.q["case"]) : narrow() && hs ? caseById(hs) : null;
    st.pushed = !!(narrow() && hs && q);
    var sel = q || (st.caseId && list.filter(function (c) { return c.id === st.caseId; })[0]) || list[0] || null;
    st.caseId = sel ? sel.id : null;
    /* the desk's one view switcher (Games, Applications and People use it too): the underlined uppercase row */
    return '<div class="dk-views ' + R + '" role="group" aria-label="Which cases" id="dkScope">' +
      SCOPES.map(function (s) { return '<button class="dk-chip" data-scope="' + s[0] + '" aria-pressed="' + (st.scope === s[0]) + '">' + s[1] + "</button>"; }).join("") + "</div>" +
      '<div class="dk-mail' + (narrow() && q ? " show-detail" : "") + '" id="dkMail">' +
      '<section class="card pad-0 dk-mlist ' + R + '" aria-label="Case list"><div class="dk-mlist-h">' +
      '<p class="t-foot dk-mlist-note" id="dkCaseNote">' + noteHtml(list) + "</p></div>" + caseRows(list, sel) + "</section>" +
      /* not a live region: J/K would read the whole case aloud; #dkCaseLive says only what changed */
      '<section class="card dk-mdetail ' + R + '" id="dkCaseDetail" aria-label="Case detail">' + caseDetail(sel) + "</section></div>" +
      '<p class="sr" id="dkCaseLive" role="status" aria-live="polite"></p>' +
      '<p class="t-foot dk-keys">Keyboard: <span class="dk-kbd">J</span> <span class="dk-kbd">K</span> or the arrow keys move, <span class="dk-kbd">C</span> claims, <span class="dk-kbd">E</span> resolves, ' +
      "a decision asks for its statement first.</p>";
  }
  function announce(text) { var l = $("#dkCaseLive"); if (!l) return; l.textContent = ""; setTimeout(function () { l.textContent = text; }, 40); }
  function caseSay(c) { return "Case #" + c.id + ", " + c.typeLabel + ", " + STATUS[c.status][0]; }
  function rove(row) { $$("#dkCaseRows [data-case]").forEach(function (r) { r.setAttribute("tabindex", r === row ? "0" : "-1"); }); }
  function repaintCases(kb, info) {
    var rows = $("#dkCaseRows"); if (!rows) return;
    var gone = info && info.gone ? rows.querySelector('[data-case="' + info.gone + '"]') : null, ghost = gone && !kb ? gone : null;
    var idx = ghost ? Array.prototype.indexOf.call(rows.children, ghost) : -1;
    var list = caseScope(st.scope), sel = caseById(st.caseId), hadFocus = rows.contains(document.activeElement);
    rows.outerHTML = caseRows(list, sel);
    rows = $("#dkCaseRows");
    if (ghost && idx >= 0) ghostOut(rows, ghost, rows.children[idx] || null);
    var d = $("#dkCaseDetail"); if (d && !(info && info.gone && narrow())) { d.innerHTML = caseDetail(sel); lvOpenThread(sel); }   /* a phone detail that is backing out keeps its case */
    var note = $("#dkCaseNote"); if (note) note.innerHTML = noteHtml(list);
    var sub = $("#dkSub"); if (sub) sub.innerHTML = LEDE.cases();   /* the title's sentence carries the open count too */
    syncCounts();
    if (!kb && info && info.changed && sel && info.changed === sel.id) {
      $$("[data-swap]", d).forEach(function (el) { swapIn(el); });
    }
    if (hadFocus || kb) { var sr = rows.querySelector('[aria-selected="true"]') || rows.querySelector('[tabindex="0"]'); if (sr) sr.focus({ preventScroll: true }); }
  }
  /* phone: the detail pushes in from the right over the list, and Back returns to the same row at the same scroll.
     The open case rides in history.state, not in the hash: the kit answers every hashchange with a full route (its
     window listener runs before any a page adds), so a hash entry would repaint the page, replay the entrance and lose
     the scroll on Back. Same-URL entries fire only popstate, which the desk answers in place. A deep link with &case=
     still opens the case on load. */
  function openNarrow(c, kb, fromHistory) {
    var mail = $("#dkMail"), already = mail.classList.contains("show-detail");
    if (!already) st.listY = window.scrollY;
    if (!fromHistory) {
      if (already) history.replaceState(Object.assign({}, history.state, { dkCase: c.id }), "");
      else { history.pushState({ dkCase: c.id }, ""); st.pushed = true; }
    }
    mail.classList.add("show-detail");
    $("#dkCaseDetail").innerHTML = caseDetail(c);
    lvOpenThread(c);
    window.scrollTo(0, Math.max(0, mail.getBoundingClientRect().top + window.scrollY - 64));
    if (!kb && !already) enterIn($("#dkCaseDetail"), 24, 0);
    var b = $("#dkCaseDetail .dk-back"); if (b) b.focus({ preventScroll: true });
    announce(caseSay(c));
  }
  function showList() {
    var mail = $("#dkMail"); if (!mail || !mail.classList.contains("show-detail")) return;
    var det = $("#dkCaseDetail"), done = false;
    var fin = function () {
      if (done) return; done = true;
      mail.classList.remove("show-detail");
      window.scrollTo(0, st.listY || 0);
      var row = $('#dkCaseRows [data-case="' + st.caseId + '"]');
      if (row) { rove(row); row.focus({ preventScroll: true }); }
      enterIn($(".dk-mlist", mail), -12, 0);
    };
    if (!det) { fin(); return; }
    /* it leaves the way it came in: back out to the right (a plain fade under reduced motion) */
    var a = det.animate(moving() ? [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(24px)" }] : [{ opacity: 1 }, { opacity: 0 }], { duration: moving() ? 180 : 120, easing: EASE_OUT });
    a.onfinish = fin; setTimeout(fin, 320);   /* a hidden tab may pause the timeline; the list still returns */
  }
  /* Back and Forward between the list and a case (same URL, so popstate only) */
  window.addEventListener("popstate", function (e) {
    if (st.view !== "cases" || !$("#dkMail") || !narrow()) return;
    var c = e.state && e.state.dkCase ? caseById(e.state.dkCase) : null;
    if (c) { st.caseId = c.id; st.pushed = true; openNarrow(c, false, true); }
    else { st.pushed = false; showList(); }
  });
  function selectCase(id, kb) {
    var c = caseById(id); if (!c) return;
    st.caseId = c.id;
    if (narrow()) { openNarrow(c, kb, false); return; }
    setHash("#/desk?tab=cases&case=" + c.id);
    $$("#dkCaseRows [data-case]").forEach(function (r) { var on = r.dataset.case === String(c.id); r.setAttribute("aria-selected", String(on)); r.setAttribute("tabindex", on ? "0" : "-1"); });
    $("#dkCaseDetail").innerHTML = caseDetail(c);   /* Mail: selection is instant, no transition */
    lvOpenThread(c);
    announce(caseSay(c));
  }
  function moveCase(dir, from) {
    var items = $$("#dkCaseRows [data-case]"); if (!items.length) return;
    var at = items.indexOf(from && from.closest ? from.closest("[data-case]") : null);
    if (at < 0) at = items.findIndex(function (x) { return x.getAttribute("aria-selected") === "true"; });
    var nx = items[Math.max(0, Math.min(items.length - 1, at < 0 ? 0 : at + dir))];
    if (narrow() && !$("#dkMail").classList.contains("show-detail")) { rove(nx); nx.focus(); return; }
    selectCase(nx.dataset.case, true);
    var r2 = $('#dkCaseRows [data-case="' + nx.dataset.case + '"]'); if (r2) r2.focus();
  }
  /* every case act is a write (the live layer's lvCaseAct): claim, assign, mark in review, resolve and deny */
  function caseAct(act, kb, arg) { lvCaseAct(act, kb, arg); }
  /* the officials a case can go to: the league's staff list (s2_desk) */
  function assignees(c) { return LV.staff.map(function (s) { return { key: s.id, name: s.gamertag || "Staff member", sub: s.role === "commissioner" ? "Commissioner" : "Staff", on: c.claimantId === s.id }; }); }
  function assignMenu(btn, kb) {
    var c = caseById(st.caseId); if (!c) return;
    var L = assignees(c);
    /* touch: the officials open in a sheet with 44px rows, like the role picker */
    if (narrow() || matchMedia("(pointer: coarse)").matches) {
      closePop();
      var sh = S2.sheet({ title: "Assign case", html: '<div class="list dk-assign">' + L.map(function (s) {
          return '<button class="row" data-name="' + esc(s.key) + '"><span class="avatar dk-av">' + esc(initials(s.name)) + '</span><span class="grow"><span class="title">' + esc(s.name) + '</span><span class="sub">' + esc(s.sub) + "</span></span>" +
            (s.on ? '<span class="dk-assign-on">' + S2.ic("check") + "</span>" : "") + "</button>";
        }).join("") + "</div>",
        onClose: function () { var b = $('#dkCaseDetail [data-act="assign"]') || $("#dkCaseH"); if (b) b.focus({ preventScroll: true }); } });
      $$("[data-name]", sh.body).forEach(function (b) { b.addEventListener("click", function () { var n = b.dataset.name; sh.close(); caseAct("assign", false, n); }); });
      return;
    }
    var wrap = btn.parentNode, old = $(".dk-pop", wrap);
    if (old) { closePop(); return; }
    closePop();
    var pop = document.createElement("div");
    pop.className = "dk-pop"; pop.setAttribute("role", "menu"); pop.setAttribute("aria-label", "Assign to");
    pop.innerHTML = '<p class="t-cap">Assign to</p>' + L.map(function (s) {
      return '<button role="menuitem" data-act="assign-to" data-name="' + esc(s.key) + '"><span class="avatar dk-av xs">' + esc(initials(s.name)) + '</span><span class="grow">' + esc(s.name) + '</span><span class="t-foot">' + esc(s.sub) + "</span></button>";
    }).join("");
    wrap.appendChild(pop); btn.setAttribute("aria-expanded", "true");
    /* placed from the button (the menu is fixed, so the detail card's scroll edges never cut it): leftward when the right
       edge would run past the card, upward when the viewport's end leaves more room above, scrolling inside */
    var host = $("#dkCaseDetail"), br = btn.getBoundingClientRect(), hr = host ? host.getBoundingClientRect() : { right: window.innerWidth };
    var flip = br.left + pop.offsetWidth > hr.right - 8;
    var floor = window.innerHeight - 12, ceil = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 64) + 12;
    var below = floor - br.bottom - 6, above = br.top - 6 - ceil, up = pop.offsetHeight > below && above > below;
    pop.classList.toggle("flip", flip); pop.classList.toggle("up", up);
    pop.style.left = Math.max(8, flip ? br.right - pop.offsetWidth : br.left) + "px";
    if (up) pop.style.bottom = (window.innerHeight - br.top + 6) + "px"; else pop.style.top = (br.bottom + 6) + "px";
    pop.style.maxHeight = Math.max(160, up ? above : below) + "px";
    /* a fixed menu would stay put while its button scrolls away, so any scroll outside it closes it */
    popScroll = function (e) { if (!pop.contains(e.target)) closePop(); };
    window.addEventListener("scroll", popScroll, true);
    /* qa (motion 15): a keyboard open never animates (the desk's rule above), and the menu grows out of its trigger: down
       from a button above it, up from a button below it (.up sets transform-origin to its bottom edge) */
    if (moving() && !kb) pop.animate([{ opacity: 0, transform: "scale(.96) translateY(" + (up ? 4 : -4) + "px)" }, { opacity: 1, transform: "none" }], { duration: 160, easing: EASE_OUT });
    if (kb) { var f = $("button", pop); if (f) f.focus(); }   /* keyboard opens land on the first name; a click opens with nothing chosen */
    pop.addEventListener("keydown", function (e) {
      var items = $$("button", pop), i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { (items[i + 1] || items[0]).focus(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { (items[i - 1] || items[items.length - 1]).focus(); e.preventDefault(); }
      else if (e.key === "Escape") { closePop(); btn.focus(); e.preventDefault(); e.stopPropagation(); }
    });
  }
  var popScroll = null;
  function closePop() { if (popScroll) { window.removeEventListener("scroll", popScroll, true); popScroll = null; }
    $$(".dk-pop").forEach(function (p) { var b = p.parentNode && $("[aria-expanded]", p.parentNode); if (b) b.setAttribute("aria-expanded", "false"); p.remove(); }); }
  var TICKS = '<span class="dk-tick" style="left:33.333%"></span><span class="dk-tick" style="left:66.667%"></span>';
  /* a table or a view strip wider than its column fades at the right edge until it is scrolled to the end, so what is
     hidden reads as "scroll for more", never as a number or a label cut short */
  function fadeBox() { $$(".dk .tbl-wrap, .dk .dk-views").forEach(function (w) { w.classList.toggle("is-clipped", w.scrollLeft + w.clientWidth < w.scrollWidth - 1); }); }
  document.addEventListener("scroll", function (e) { var w = e.target; if (w && w.classList && (w.classList.contains("tbl-wrap") || w.classList.contains("dk-views")) && w.closest(".dk")) fadeBox(); }, true);
  /* a confirmed act repaints the card that held its trigger, so the sheet's own focus return would land on a removed
     button (BODY); o.focus names what to land on instead, the result of the act, once the sheet has gone */
  function landOn(el) { if (!el) return; if (!el.matches("a, button, input, select, textarea, [tabindex]")) el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest" }); }
  /* core's one confirm sheet (S2.confirm, audit 2026-11-09): focus starts on Cancel; after the action, focus lands where
     the desk says (o.focus) */
  function confirmSheet(o) {
    return S2.confirm({ title: o.title, html: o.body, ok: o.ok, danger: o.danger, onOk: function () { o.onOk(); },
      onClose: function (ok) { if (ok && o.focus) landOn(o.focus()); } });
  }

  /* =========================================================================================================== */
  /* APPLICATIONS                                                                                                */
  /* =========================================================================================================== */
  var AT = [["all", "All"], ["owner", "Owner"], ["staff", "Staff"], ["management", "Management"]];
  function appShown(a) { return st.appType === "all" || (st.appType === "owner" && a.kind === "owner2") || (st.appType === "staff" && (a.kind === "staff" || a.kind === "cm")) || (st.appType === "management" && a.kind === "mgmt"); }
  /* every application opens its own page (commissioner, 2026-10-22); a confidential one stays a shape on the board */
  function appCard(a) {
    var href = "#/desk/application/" + a.id, decided = a.stage === "decided", voted = !!myVote(a);
    return '<a class="dk-lock" href="' + href + '" data-app="' + a.id + '" aria-label="' + esc(AKIND[a.kind] + ", Applications committee" + (a.kind === "owner2" ? ", confidential" : "") + (decided ? ", decided" : voted ? ", you voted " + myVote(a) : ", ballot open")) + '">' +
      ic("lock") + '<span class="dk-lock-l">' + (a.kind === "owner2" ? "Owner" : a.kind === "cm" ? esc(comName(a.seat)) + " seat" : a.kind === "mgmt" ? (a.row.role === "agm" ? "AGM" : "GM") + " nomination" : "Staff") + '</span><span class="t-foot">' + (decided ? "Decided" : voted ? "You voted" : "Ballot open") + "</span>" + (voted && !decided ? '<span class="dk-voted">' + S2.ic("check") + "</span>" : "") + "</a>";
  }
  function column(key, title, items, extra) {
    var owner2 = items.some(function (a) { return a.kind === "owner2"; }), n = items.length;
    /* confidential owner shapes get words, never a number, and "a handful" only when there are a handful */
    var no = items.filter(function (a) { return a.kind === "owner2"; }).length;
    var count = owner2 ? (no >= 3 ? "A handful" : "") : n === 1 && items[0].kind !== "owner2" ? "One" : n ? String(n) : "";
    return '<section class="dk-col" data-stage="' + key + '" aria-label="' + esc(title) + '"><div class="dk-col-h"><h3 class="d-3">' + esc(title) + '</h3><span class="t-foot">' + esc(count) + "</span></div>" +
      '<div class="dk-col-b' + (items.length ? " grid-shapes" : "") + '">' + (items.length ? items.map(appCard).join("") : '<p class="t-foot dk-col-empty">' + esc(extra || "Nothing here") + "</p>") + "</div></section>";
  }
  function board() {
    if (!LV.G || LV.state !== "ready" || !may("desk")) return lvGate(function () { return ""; });
    var A = apps(), L = A.list.filter(appShown), d = A.d;
    var own = function (a) { return a.profile_id === myId(); };
    /* "needs my ballot" is the database's answer (may vote, no ballot of mine yet), never a seat or a name */
    var waitsOnMe = function (a) { return a.stage === "ballot" && may("vote", a) && !lvMine(a) && !own(a); };
    var by = function (stg) { return L.filter(function (a) { return stg === "ballot" ? waitsOnMe(a) : stg === "voting" ? a.stage === "ballot" && !waitsOnMe(a) : a.stage === stg; }); };
    /* Commissioner, 2026-11-04: "remove the application waitlists feature on the concept site. Make sure to blend it the newly
       free space from that removal." The board reads as one flow now: the two columns that still need people side by side, and
       Decided closing them as one row across both, its figures filling a fixed grid from the left (css/desk.css) */
    var dec = '<section class="dk-col dk-col-wide" data-stage="decided" aria-label="Decided"><div class="dk-col-h"><h3 class="d-3">Decided</h3><span class="t-foot">Every season</span></div><div class="dk-tallies">' +
      ((st.appType === "all" || st.appType === "owner") ? tally("Owners", d.owner, "approved", "") : "") +
      ((st.appType === "all" || st.appType === "staff") ? tally("Staff", d.staffOk, "approved", d.staffNo + " denied") : "") +
      ((st.appType === "all" || st.appType === "management") ? tally("General managers", d.gm, "approved", "") + tally("Assistant GMs", d.agm, "approved", "") : "") +
      "</div></section>";
    return '<div class="dk-board" id="dkBoard">' +
      column("ballot", "Needs my ballot", by("ballot"), st.appType === "management" ? "Management seats are decided by the club; nothing to vote on" : "No ballots waiting on you") +
      column("voting", "Voting", by("voting"), "Nothing waiting on other staff") + dec + "</div>";
  }
  function tally(t, n, what, more) { return '<div class="dk-tally"><span class="t-stat-sm num">' + n + '</span><span><span class="title">' + esc(t) + '</span><span class="t-foot">' + esc(what + (more ? " · " + more : "")) + "</span></span></div>"; }
  function paneApps(r) {
    return '<div class="dk-views ' + R + '" role="group" aria-label="Application type">' + AT.map(function (x) { return '<button class="dk-chip" data-apptype="' + x[0] + '" aria-pressed="' + (st.appType === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div>" +
      '<p class="dk-lead">' + tag("applications") + " " + lvAppsLead() + "</p>" +
      '<div class="' + R + '" id="dkBoardWrap">' + board() + "</div>";
  }
  /* ---------- one application, its own page: #/desk/application/<id> ----------
     Commissioner, 2026-10-22: "opening up a staff or ownership application in the staff desk should open up its own page
     for the application where you can see the staff votes and their reasoning, as well as the chat box with the
     applications to ask questions and chat about the application as well, and also see the answers given when they
     filled out their application." It replaces the ballot sheet with a deep page built like the Game desk: a breadcrumb,
     the applicant as the title, an ink band that reads the vote like a scoreboard, then the answers and the conversation
     beside your ballot, every ballot with its reason, and the history. The page reads the league's three records: the
     filed answers, application_ballots (vote and note) and application_messages (the thread the applicant reads and
     answers).
     Follow-up, commissioner, 2026-10-22: "can you spread the chat box out more to fill in the empty gap on the right, or you
     can add something else of importance instead maybe?" The two columns ended wherever their content did, and which one
     ran short flipped with the data (one ballot left a gap beside the chat, seven ballots left one under it). So
     the record (answers, your ballot, every ballot, the history) is now the one column whose height varies, and the
     conversation is a rail as tall as the record whose switch and panel stay pinned at the height of the screen
     (css/desk.css, .dk-agd). Whatever the record holds, the chat fills the right side and stays in reach while reading. */
  /* cm: a committee manager application (RULING 2026-11-23: "current staff members can apply for committee manager
     positions that are not filled and are voted on by all other staff members") */
  var AKIND = { owner2: "Season 2 owner application", staff: "Staff application", cm: "Committee manager application", mgmt: "Front office nomination" };
  /* a count in words, zero said "none": S2.words (js/core.js), the one list of these words (QA round 2: the desk kept two) */
  function nw(n) { return S2.words(n, "none"); }
  function applicant(a) { return a.who; }
  function agoIso(h) { return new Date(Date.now() - h * 3600e3).toISOString(); }
  function dayOf(h) { return M.etFull(agoIso(h)).replace(/, \d{4}$/, ""); }
  function appX(a) { return lvAppX(a); }
  function myVote(a) { var mb = lvMine(a); return mb ? mb.vote : null; }
  /* every ballot, this reader's counting one first; mine marks it */
  function ballotsOf(a) { var mb = lvMine(a); return (mb ? [{ who: myName(), v: mb.vote, note: mb.note || "", h: (Date.now() - Date.parse(mb.updated_at)) / 36e5, mine: true }] : []).concat(appX(a).ballots.map(function (b) { return Object.assign({ mine: false }, b); })); }
  function tallyOf(a) { var lb = lvBallots(a), of = lvOf(a); return { ap: lb.filter(function (b) { return b.vote === "approve"; }).length, dn: lb.filter(function (b) { return b.vote === "deny"; }).length, n: lb.length, of: of, need: of ? Math.floor(of / 2) + 1 : null }; }
  function appState(a) {
    if (a.stage === "decided") return a.outcome === "denied" ? ["Denied", "loss"] : ["Approved", "win"];
    var t = tallyOf(a);
    return t.need && t.ap >= t.need ? ["Majority to approve", "win"] : t.need && t.dn >= t.need ? ["Majority to deny", "loss"] : may("vote", a) && !lvMine(a) && a.profile_id !== myId() ? ["Needs your ballot", "accent"] : ["Voting", ""];
  }
  /* the voters are the staff and the commissioners (2026-11-23), so the count says voters, not staff */
  function votedText(t) { if (t.of == null) return !t.n ? "No one has voted yet" : t.n === 1 ? "One ballot cast" : t.n + " ballots cast"; return !t.n ? "No one has voted yet" : t.n === t.of ? "All " + nw(t.of) + " voters have voted" : cap1(nw(t.n)) + " of the " + nw(t.of) + " voters " + (t.n === 1 ? "has" : "have") + " voted"; }
  function curApp() { return st.appId ? appById(st.appId) : null; }
  /* the owner application deadline of an application's season, while it is still ahead (null once it has passed) */
  function ownerAppClose(a) {
    var row = ((M.control && M.control.seasons) || []).filter(function (x) { return x.settings && x.settings.id === a.row.season_id; })[0], d = row && row.settings.owner_app_deadline;
    return d && Date.parse(d) > Date.now() ? d : null;
  }

  function appHead(a) {
    var t = a ? applicant(a) : "Application";
    return '<header class="page-head dk-head dk-ghead ' + R + '"><nav class="dk-crumbs" aria-label="Breadcrumb"><a href="#/desk" data-pane="today">Staff Desk</a><span aria-hidden="true">/</span>' +
      '<a href="#/desk?tab=applications" data-pane="applications">Applications</a><span aria-hidden="true">/</span><span aria-current="page">' + esc(t) + "</span></nav>" +
      '<span class="kicker">' + esc(a ? AKIND[a.kind] : "Applications") + '</span><h1 class="d-1" id="dkTitle" tabindex="-1">' + esc(t) + '</h1><p class="lede-l" id="dkSub">' +
      (a ? appLede(a) : "No application matches this link.") + "</p></header>";
  }
  /* the sentence under the name: what they asked for, when, and who may see it */
  function appLede(a) {
    var x = appX(a), A = x.ans, filed = "Filed " + dayOf(x.filedH), r0 = a.row, t0 = r0.team_id && M.teams.filter(function (t) { return t.id === r0.team_id; })[0];
    return a.kind === "mgmt" ? "Nominated as " + (r0.role === "agm" ? "assistant general manager" : "general manager") + (t0 ? " of the " + esc(t0.full) : "") + " by " + esc(nameOf(r0.owner, "the Owner")) + ". " + filed + "."
      : a.kind === "cm" ? "Applying for the " + esc(comName(a.seat)) + " committee manager seat. " + filed + "."
      : a.kind === "staff" ? "Applying to join the staff. " + filed + "."
      : "Wants the " + esc(A.f1 || "club of their choice") + (A.f2 ? ", then the " + esc(A.f2) + (A.f3 ? " and the " + esc(A.f3) : "") : "") + ". " + filed + ". Confidential to the league office until owners are decided.";
  }
  /* the vote as a scoreboard: approvals against denials, and one slot per reviewer filling in from each end. The
     middle slot is the deciding ballot: whichever side reaches it first decides the application */
  function appBand(a) {
    var t = tallyOf(a), s = appState(a), slots = "";
    for (var i = 0; i < (t.of || 0); i++) slots += '<span class="dk-ab-slot' + (i < t.ap ? " ap" : i >= t.of - t.dn ? " dn" : "") + (i === t.need - 1 ? " line" : "") + '"></span>';
    var key = function (k) { return '<i class="dk-ab-key ' + k + '" aria-hidden="true"></i>'; };
    var side = function (k, lbl) { return '<div class="dk-sb-side"><div class="dk-sb-name"><span class="d-3">' + (k === "ap" ? key(k) + lbl : lbl + key(k)) + '</span><span class="dk-sb-full">' + esc(t.need ? cap1(nw(t.need)) + (k === "ap" ? " to approve" : " to deny") : "A majority " + (k === "ap" ? "to approve" : "to deny")) + "</span></div></div>"; };
    var score = function (v, k) { return '<span class="d-num dk-sb-score" data-k="' + k + '">' + v + "</span>"; };
    /* qa (nits 10): an owner application is held until its season's owner applications close (guard_owner_app_hold,
       _owner_app_decidable), so no side decides it the moment it reaches the line before then */
    var od = a.type === "owner" && a.stage !== "decided" ? ownerAppClose(a) : null;
    var when = a.stage === "decided" ? "Decided" : od ? "Decided once owner applications close on " + M.etDate(od) + ", by more than half of the voters"
      : t.need ? "Decided the moment a side reaches " + nw(t.need) : "Decided by more than half of the applications reviewers";
    return '<section class="band ink dk-sb dk-ab ' + R + '" id="dkAB" aria-label="Ballots" data-theme="dark" data-look-scope data-finish="' + esc(S2.state.finish) + '">' +
      '<div class="dk-sb-top"><span class="kicker">CGHL · ' + esc(AKIND[a.kind]) + "</span>" + tag("applications") + "</div>" +
      '<div class="dk-sb-row">' + side("ap", "Approve") + '<div class="dk-sb-mid">' + score(t.ap, "ap") + '<span class="dk-sb-dash" aria-hidden="true"></span>' + score(t.dn, "dn") + "</div>" + side("dn", "Deny") + "</div>" +
      (t.of ? '<div class="dk-ab-meter" style="--n:' + t.of + '" role="img" aria-label="' + esc(t.ap + " to approve, " + t.dn + " to deny, " + (t.of - t.n) + " still to vote, of " + t.of + " voters; " + t.need + " decide it") + '">' + slots + "</div>" : "") +
      '<div class="dk-sb-foot"><span class="dk-sb-state" data-k="state">' + esc(s[0]) + '</span><span class="dk-sb-when">' + esc(votedText(t) + " · " + when) + "</span></div></section>";
  }

  /* ---- what they filed: the form's own steps and labels (js/flows.js), so the page can never drift from the form ---- */
  function franchiseAns(name) {
    var t = M.teams.filter(function (x) { return x.full === name; })[0];
    return '<span class="dk-ans-fr">' + (t ? M.crest(t.code) : '<span class="dk-ans-new" aria-hidden="true">' + S2.ic("plus") + "</span>") + '<span><span class="dk-ans-fn">' + esc(name) + '</span><span class="t-foot">' +
      (t ? "In the CGHL" : "New to the league: a club only with a commissioner's go-ahead") + "</span></span></span>";
  }
  function ansRow(f, v, solo) {
    var label = String(typeof f.label === "function" ? f.label({}) : f.label).replace(/ \(optional\)$/i, ""), body, wide = f.type === "textarea" && f.rows > 2;
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) body = '<span class="muted">Left blank</span>';
    else if (f.type === "select" && /^f\d$/.test(f.k)) body = franchiseAns(v);
    else if (f.type === "multi") body = v.map(function (c) { return '<span class="dk-ans-pill">' + esc(c) + "</span>"; }).join("");
    else if (f.k === "seat") body = esc(comName(v));
    else if (f.type === "textarea") body = '<p class="dk-ans-long">' + esc(v) + "</p>";
    else body = esc(v);
    return '<div class="dk-ans-r' + (wide ? " wide" : "") + (/^f\d$/.test(f.k) ? " fr" : "") + (solo ? " solo" : "") + '"><dt' + (solo ? ' class="sr"' : "") + ">" + esc(label) + "</dt><dd>" + body + "</dd></div>";
  }
  function ansCard(a) {
    if (a.kind === "mgmt") {
      var r0 = a.row, t0 = r0.team_id && M.teams.filter(function (t) { return t.id === r0.team_id; })[0];
      return '<section class="dk-gsec dk-a-ans ' + R + '" id="dkAAns" aria-labelledby="dkAAnsH">' + secHead({ lvl: 2, id: "dkAAnsH", k: "Filed " + dayOf(appX(a).filedH), h: "The nomination", p: "As the club's Owner filed it (Rule 2.6)." }) +
        '<dl class="dk-ans">' + [["Club", t0 ? t0.full : "A club"], ["Seat", r0.role === "agm" ? "Assistant general manager" : "General manager"], ["Nominated by", nameOf(r0.owner, "The Owner")], ["Why them", r0.pitch]].map(function (x) {
          return '<div class="dk-ans-r"><dt>' + esc(x[0]) + "</dt><dd>" + (x[1] ? esc(x[1]) : '<span class="muted">Left blank</span>') + "</dd></div>"; }).join("") + "</dl></section>";
    }
    var fk = a.kind === "cm" ? "committee" : a.kind === "staff" ? "staff" : "owner", x = appX(a), flow = S2.flows && S2.flows[fk];
    if (!flow) throw new Error("the " + fk + " application form is missing (js/flows.js)");
    return '<section class="dk-gsec dk-a-ans ' + R + '" id="dkAAns" aria-labelledby="dkAAnsH">' + secHead({ lvl: 2, id: "dkAAnsH", k: "Filed " + dayOf(x.filedH), h: "Their answers",
        p: "As " + esc(applicant(a)) + " filed them, step by step. " + (a.kind === "owner2" ? "Only the league office sees them until owners are decided." : "No other member can see them.") }) +
      flow.steps.map(function (s) { return '<div class="dk-ans-g"><h3 class="t-cap">' + esc(s.t) + '</h3><dl class="dk-ans">' + s.fields.map(function (f) { return ansRow(f, x.ans[f.k], s.fields.length === 1); }).join("") + "</dl></div>"; }).join("") + "</section>";
  }

  /* ---- the conversation: the thread the applicant reads (application_messages) ---- */
  function threadCard(a) {
    var who = applicant(a), L0 = LV.amsgs[a.id], body0 = a.type === "committee" ? stateBox("muted", "No message thread", "A committee seat application is between staff: talk it over in the staff channel.")
      : L0 && L0.err ? stateBox("err", "The conversation did not load", esc(L0.err)) : L0 === undefined ? '<p class="t-foot">Loading the conversation…</p>' : convHtml(a);
    return '<section class="dk-gsec dk-a-thread ' + R + '" id="dkAThread" aria-labelledby="dkAThreadH">' + secHead({ lvl: 2, sm: true, id: "dkAThreadH", k: "Conversation", h: "Messages",
        p: a.type === "committee" ? "" : "Ask " + esc(who) + " anything about their application; they read and reply here. They never see a ballot." }) +
      /* the conversation sits straight in the pane, as the rail's flex column needs it (css/desk.css .dk-a-rail): a wrapper
         between them left the pinned log 30px tall (i3d, 2026-11-25) */
      '<div class="dk-a-pane">' + body0 + "</div></section>";
  }
  /* the head of a thread, as Messages opens one: who it is with and what about. It sits at the top of a short thread and
     pushes the messages down onto the composer (an auto margin, so a long thread still scrolls to its top), and it
     scrolls away with the history once the thread outgrows the panel. Never a .dk-msg: the tests count those */
  function chatStart(a) {
    var x = appX(a), who = applicant(a);
    return '<div class="dk-chat-start"><span class="avatar" aria-hidden="true">' + esc(initials(who)) + '</span><p class="title">' + esc(who) +
      '</p><p class="t-foot">' + esc(AKIND[a.kind] + " · Filed " + dayOf(x.filedH)) + "</p></div>";
  }
  function msgsHtml(a) {
    var x = appX(a), L = x.msgs.app, who = applicant(a), mine = me().name, out = chatStart(a), lastDay = null, lastKey = null;
    if (!L.length) return out + '<p class="dk-chat-empty">No messages yet. Ask ' + esc(who) + " about anything in their application.</p>";
    L.forEach(function (m) {
      var d = dayOf(m.h), key = m.by + "|" + (m.who || "");
      if (d !== lastDay) { out += '<p class="dk-chat-day">' + esc(d) + "</p>"; lastDay = d; lastKey = null; }
      var side = m.by === "app" ? "them" : m.who === mine ? "me" : "office";
      var name = m.by === "app" ? who : m.who === mine ? "You" : m.who, time = M.etTime(agoIso(m.h));
      out += '<div class="dk-msg ' + side + (key === lastKey ? " cont" : "") + '">' + (key === lastKey ? "" : '<p class="dk-msg-by">' + esc(name) + " <span>" + esc(time) + "</span></p>") +
        '<p class="dk-msg-b">' + esc(m.t) + "</p></div>";
      lastKey = key;
    });
    return out;
  }
  function convHtml(a) {
    var x = appX(a), who = applicant(a), k = MAC ? "⌘" : "Ctrl";
    return '<div class="dk-chat" id="dkAConv"><div class="dk-chat-log" id="dkALog" role="log" aria-live="polite" tabindex="0" aria-label="' + esc("Messages with " + who) + '">' + msgsHtml(a) + "</div>" +
      '<div class="dk-chat-comp"><label class="sr" for="dkAMsg">' + esc("Message " + who) + '</label>' +
      '<textarea class="input dk-chat-in" id="dkAMsg" rows="1" enterkeyhint="send" placeholder="' + esc("Message " + who) + '">' + esc(x.draft.app) + "</textarea>" +
      '<button class="btn dk-chat-send" data-act="a-send" aria-label="' + esc("Send to " + who) + '">' + ic("send") + "</button></div>" +
      '<p class="t-foot dk-chat-foot"><span id="dkAMsgErr" class="dk-a-err" role="alert"></span><span>' + esc(who) + " reads this thread." +
      '</span><span class="dk-keys"><span class="dk-kbd" aria-hidden="true">' + k + '</span><span class="dk-kbd" aria-hidden="true">Enter</span> sends</span></p></div>';
  }

  /* ---- your part: a ballot with a reason (staff), Decide now (commissioner): lvMineCard ---- */
  function mineCard(a) { return lvMineCard(a); }
  function rollCard(a) {
    var tl = tallyOf(a), LB = ballotsOf(a);
    return '<section class="dk-gsec dk-a-roll ' + R + '" id="dkARoll" aria-labelledby="dkARollH">' + secHead({ lvl: 2, id: "dkARollH", k: "The staff vote", h: "Ballots", p: votedText(tl) + ". The applicant never sees a ballot." }) +
      (LB.length ? '<ol class="dk-roll">' + LB.map(function (b) {
        return '<li class="dk-bal' + (b.mine ? " mine" : "") + (b.earlier ? " earlier" : "") + '"><span class="avatar" aria-hidden="true">' + esc(initials(b.who)) + '</span><div class="dk-bal-b"><p class="dk-bal-h"><span class="title">' + esc(b.mine ? "You" : b.who) + "</span>" +
          '<span class="chip ' + (b.v === "approve" ? "win" : "loss") + '">' + (b.v === "approve" ? "Approve" : "Deny") + '</span><span class="t-foot">' + esc(ageLong(b.h) + (b.earlier ? ", before it was filed again, so it does not count" : "")) + "</span></p>" +
          '<p class="dk-bal-n' + (b.note ? "" : " muted") + '">' + esc(b.note || "No reason given") + "</p></div></li>"; }).join("") + "</ol>" : '<p class="t-sub dk-roll-none">No ballots yet.</p>') + "</section>";
  }
  function appHistCard(a) {
    /* every ballot, this reader's own among them (ballotsOf leads with it; x.ballots holds the others) */
    var x = appX(a), items = [{ h: x.filedH, what: "Filed by " + applicant(a), who: applicant(a) }].concat(ballotsOf(a).map(function (b) { return { h: b.h, what: b.v === "approve" ? "Voted to approve" : "Voted to deny", who: b.who }; }))
      .concat(x.msgs.app.map(function (m) { return m.by === "app" ? { h: m.h, what: "Replied to the league office", who: applicant(a) } : { h: m.h, what: "Messaged " + applicant(a), who: m.who }; }));
    if (a.row.decided_at) items.push({ h: (Date.now() - Date.parse(a.row.decided_at)) / 36e5, what: a.outcome === "approved" ? "Approved" : "Denied", who: "The league" });
    items.sort(function (p, q) { return p.h - q.h; });
    /* not .dk-hist: that class is the Game desk's, and its order: 6 put History after Messages in one column */
    return '<section class="dk-gsec dk-a-hist ' + R + '" id="dkAHist" aria-labelledby="dkAHistH">' + secHead({ lvl: 2, id: "dkAHistH", k: "History", h: plural(items.length, "One event", "events"), p: "Newest first." }) +
      '<ol class="dk-tl">' + items.map(function (e) {
        return '<li><span class="dk-tl-dot"></span><span class="title">' + esc(e.what) + '</span><span class="t-foot">' + esc(e.who + " · " + ageLong(e.h)) + "</span></li>";
      }).join("") + "</ol></section>";
  }
  function paneApp(id) {
    if (!LV.G || LV.state !== "ready" || !may("desk")) return '<header class="page-head dk-head dk-ghead"><nav class="dk-crumbs" aria-label="Breadcrumb"><a href="#/desk" data-pane="today">Staff Desk</a><span aria-hidden="true">/</span><a href="#/desk?tab=applications" data-pane="applications">Applications</a></nav><h1 class="d-1" id="dkTitle" tabindex="-1">Application</h1></header>' + lvGate(function () { return ""; });
    var a = appById(id);
    if (!a) return appHead(null) + stateBox("err", "No application with that link", "The link may be old or mistyped. Every application opens from Applications.", '<a class="btn sm secondary" href="#/desk?tab=applications" data-pane="applications">Back to applications</a>');
    return appHead(a) + appBand(a) + '<div class="dk-gd dk-agd"><div class="dk-gd-main">' + ansCard(a) + mineCard(a) + rollCard(a) + appHistCard(a) + '</div><div class="dk-gd-aside dk-a-rail">' + threadCard(a) + "</div></div>";
  }
  var APART = { dkAB: appBand, dkAMine: mineCard, dkARoll: rollCard, dkAHist: appHistCard, dkAConv: convHtml, dkAThread: threadCard };
  function repaintApp(parts) {
    var a = curApp(); if (!a) return;
    var keep = R; R = "";
    /* the conversation is drawn inside its thread card once the messages are read */
    parts = parts.map(function (p) { return p === "dkAConv" && !$("#dkAConv") ? "dkAThread" : p; });
    parts.forEach(function (p) { var el = $("#" + p); if (el) el.outerHTML = APART[p](a); });
    R = keep;
    if (parts.indexOf("dkAConv") >= 0 || parts.indexOf("dkAThread") >= 0) settleLog();
  }
  /* the pinned pane takes its height from the window, and a growing message box takes height from the log: a reader at
     the newest message stays on it through either, as in Messages; one scrolled up into the thread keeps their place.
     settleLog lands on the newest message and watches each log it draws (repaintApp replaces the log) */
  var logPinned = true, logRO = window.ResizeObserver ? new ResizeObserver(function (en) {
    en.forEach(function (x) { var l = x.target; if (!l.isConnected) logRO.unobserve(l); else if (logPinned) l.scrollTop = l.scrollHeight; });
  }) : null;
  document.addEventListener("scroll", function (e) { var l = e.target; if (l && l.id === "dkALog") logPinned = l.scrollTop + l.clientHeight >= l.scrollHeight - 24; }, true);
  function settleLog() { var l = $("#dkALog"); if (l) { l.scrollTop = l.scrollHeight; logPinned = true; if (logRO) logRO.observe(l); } grow($("#dkAMsg")); }
  function grow(t) { if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 168) + "px"; }
  function mountApp() { lvMountApp(); settleLog(); }
  function pickVote(v) {
    var a = curApp(); if (!a) return; var x = appX(a); x.pick = v; x.err = "";
    $$('#dkAMine [data-act="a-pick"]').forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === v)); });
    var e = $("#dkAErr"); if (e) e.textContent = "";
  }
  function castBallot(kb) { lvCast(kb); }
  function decideApp(v) { lvDecide(v); }
  function sendMsg(kb) { lvSend(kb); }

  /* =========================================================================================================== */
  /* PEOPLE                                                                                                      */
  /* =========================================================================================================== */
  /* short labels, so the strip stays one row at 1024 (a wrapped underline bar reads as broken); Rostered is CG.poolState's */
  var PF = [["all", "Everyone"], ["active", "Rostered"], ["camp", "Camp"], ["former", "Former"], ["office", "Front office"], ["staff", "Staff"], ["suspended", "Suspended"]];
  function people(f, q) {
    var l = M.players.filter(function (p) { return f === "active" ? p.rostered && p.squad === "pro" : f === "camp" ? p.squad === "tc" : f === "former" ? p.former : f === "office" ? !!p.seat : true; });
    if (q) { q = q.toLowerCase(); l = l.filter(function (p) { return (p.tag + " " + (p.club || "") + " " + (p.team ? p.team.full : "")).toLowerCase().indexOf(q) >= 0; }); }
    return l;
  }
  function squadLabel(p) { return p.former ? "Former player" : p.squad === "tc" ? "Training camp" : p.squad === "pro" ? "Active roster" : "Not rostered"; }
  /* the name is cut with an ellipsis on one line, so it carries the full tag as its title (QA round 2) */
  function personRow(p) {
    return '<a class="dk-prow" href="#/desk/person/' + p.id + '" data-person="' + p.id + '" data-kbd-item><span class="avatar">' + esc(initials(p.tag)) + '</span><span class="dk-pname"><span class="title" title="' + esc(p.tag) + '">' + esc(p.tag) + '</span><span class="sub">' +
      esc([p.posName, squadLabel(p), p.seat].filter(Boolean).join(" · ")) + '</span></span><span class="dk-pclub">' + M.crest(p.club) + "<span>" + esc(p.club || "None") + '</span></span><span class="num dk-pc">' + esc(p.pos || "–") +
      '</span><span class="num dk-pc">' + (p.ovr ? p.ovr.ovr + (p.ovr.provisional ? "*" : "") : "–") + '</span><span class="num dk-pc">' + p.gp + "</span></a>";
  }
  function peopleBody(f, q) {
    if (f === "staff") return '<p class="dk-lead">One staff, one group: every staffer works every part of the desk.</p><section class="card pad-0" id="dkPList"><div class="dk-rows">' +
      (LV.staff.length ? LV.staff.map(function (s) { return '<div class="row"><span class="avatar">' + esc(initials(s.gamertag)) + '</span><span class="grow"><span class="title">' + esc(s.gamertag || "Staff member") + '</span><span class="sub">' + esc(s.role === "commissioner" ? "Commissioner" : "Staff") + "</span></span></div>"; }).join("")
        : stateBox("muted", "No staff list", "The league returned no staff list.")) + "</div></section>";
    if (f === "suspended") return '<section class="card pad-0" id="dkPList">' + stateBox("lock", "Names stay on each person record", "Discipline in force: " + esc(lvDiscCounts()) + ". Open a member's record for their reasons and games left.") + "</section>";
    var l = people(f, q);
    return '<section class="card pad-0" id="dkPList"><div class="dk-phead" aria-hidden="true"><span></span><span>Member</span><span>Club</span><span class="dk-pc">Pos</span><span class="dk-pc">OVR</span><span class="dk-pc">GP</span></div>' +
      (l.length ? '<div class="dk-prows" id="dkPeopleRows" data-kbd-list>' + l.map(personRow).join("") + "</div>" : stateBox("muted", q ? "No one matches “" + esc(q) + "”" : "Nobody here", q ? "Search covers gamertags, club codes and club names." : "This filter has no members right now.")) +
      '<p class="caption dk-pad" id="dkPCount">' + l.length + " of " + M.players.length + " shown. OVR with * is provisional (under " + M.SETTLE_GP + " games at that position).</p></section>";
  }
  function panePeople(r) {
    var f = PF.some(function (x) { return x[0] === r.q.filter; }) ? r.q.filter : st.pfilter; st.pfilter = f;
    var n = function (k) { return k === "staff" ? LV.staff.length : k === "suspended" ? null : people(k, "").length; };
    return '<div class="dk-views ' + R + '" role="group" aria-label="Filter people">' + PF.map(function (x) { var c = n(x[0]); return '<button class="dk-chip" data-pf="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + (c ? ' <span class="num dk-chipn">' + c + "</span>" : "") + "</button>"; }).join("") + "</div>" +
      '<div class="dk-psearch ' + R + '"' + (f === "staff" || f === "suspended" ? " hidden" : "") + '><label class="sr" for="dkPSearch">Search people</label><input class="input" id="dkPSearch" type="search" autocomplete="off" placeholder="Search by gamertag or club" value="' + esc(st.pq) + '"></div>' +
      '<div class="' + R + '" id="dkPWrap">' + peopleBody(f, st.pq) + "</div>";
  }
  function personHtml(p, tab) {
    var mine = me(), body;
    if (tab === "discipline") body = lvDiscBody(p);
    else if (tab === "roles") body = mine.commish ? '<div class="dk-ps"><p class="t-cap">Club seat</p><div class="list"><div class="row"><span class="grow"><span class="title">' + esc(p.seat ? p.seat + " of " + teamName(p.club) : "No seat") + '</span><span class="sub">Seats are set in the club editor (Rule 2.6, one seat, one holder) and show here read-only.</span></span></div></div>' +
      '<p class="t-cap dk-mt">Committee</p>' + stateBox("muted", "Staff and committee roles", "Staff is one group in Season 2. A member joins the staff through an approved staff application, and a committee manager seat is filled by staff applying and the other staff voting (Rule S2.8).", '<a class="btn sm secondary" href="#/control?tab=staff">See the seats in the Control Center</a>') + "</div>"
      : '<div class="dk-ps">' + stateBox("lock", "Commissioner only", "Staff membership changes only from a commissioner's record. Committee managers are chosen by a staff vote.", '<button class="btn sm secondary" data-lock="roles">' + ic("lock") + "Manage roles</button>") + "</div>";
    else {
      var S = p.lines.S, G = p.lines.G;
      /* the gamertag appears only here, beside public data; the sheet title stays "Member record" so a screenshot of the
         Discipline or Roles tab never reads as a named member's file */
      body = '<div class="dk-ps"><h3 class="t-title2 dk-ps-name">' + esc(p.tag) + '</h3><div class="dk-ps-top">' + M.crest(p.club, "lg") + '<div><p class="t-head">' + esc(p.team ? p.team.full : "No club") + '</p><p class="t-foot">' + esc([p.posName, p.num != null ? "#" + p.num : null, squadLabel(p), p.seat].filter(Boolean).join(" · ")) + "</p></div></div>" +
        '<div class="dk-ps-kpis"><div><span class="t-foot">Rating</span><span class="t-stat-sm num">' + (p.ovr ? p.ovr.ovr : "–") + '</span><span class="t-foot">' + esc(p.ovr ? M.GROUP_NAME[p.ovr.pos] + (p.ovr.provisional ? ", provisional" : "") : "No games yet") + "</span></div>" +
        '<div><span class="t-foot">Games</span><span class="t-stat-sm num">' + p.gp + '</span><span class="t-foot">Every role counted</span></div><div><span class="t-foot">Salary</span><span class="t-stat-sm num">' + esc(p.salary ? M.money(p.salary) : "–") + '</span><span class="t-foot">' + esc(p.origin === "assigned" ? "Placed" : p.origin === "free_agency" ? "Free agency" : p.origin === "depth_random" ? "Depth placement" : "–") + "</span></div></div>" +
        '<p class="t-cap dk-mt">Season ' + esc(M.view.season) + ' lines</p><div class="list">' + (S ? '<div class="row"><span class="grow"><span class="title">Skating</span><span class="sub">' + S.gp + " games</span></span><span class=\"num\">" + S.g + " G · " + S.a + " A · " + S.p + " P</span></div>" : "") +
        (G ? '<div class="row"><span class="grow"><span class="title">In goal</span><span class="sub">' + G.gp + " games" + (G.record ? " · " + esc(G.record) : "") + '</span></span><span class="num">' + esc(M.display("sv_pct", G.svpct)) + " SV%</span></div>" : "") + (!S && !G ? '<div class="row"><span class="sub">No games this season</span></div>' : "") + "</div>" +
        '<p class="t-cap dk-mt">Clubs this season</p><ol class="dk-tl">' + (p.tenures.length ? p.tenures.slice().reverse().map(function (t) { return '<li><span class="dk-tl-dot"></span><span class="title">' + esc(t.club + " · " + t.pos) + '</span><span class="t-foot">' + esc(t.fromLabel + " to " + t.toLabel + (t.how_in ? " · " + t.how_in : "")) + "</span></li>"; }).join("") : '<li><span class="t-foot">No club tenures</span></li>') + "</ol>" +
        '<a class="btn sm secondary dk-mt" href="' + esc(p.href) + '">Open public profile</a></div>';
    }
    return '<div class="dk-views dk-pstabs" id="dkPsTabs" role="group" aria-label="Member record">' + [["overview", "Overview"], ["discipline", "Discipline"], ["roles", "Roles"]].map(function (t) { return '<button class="dk-chip" data-v="' + t[0] + '" aria-pressed="' + (tab === t[0]) + '">' + t[1] + "</button>"; }).join("") + '</div><div id="dkPsBody">' + body + "</div>";
  }
  /* the member record is one sheet at a time. A View as from inside it switches the role, and the re-route that follows
     finds the record still open: it repaints in place (the new role's tools) instead of stacking a second sheet */
  function paintPerson(ps) {
    if (ps.tab === "discipline" && LV.rec[ps.p.id] === undefined) lvRecord(ps.p.id);
    var el = ps.sh.el, tmp = document.createElement("div"), b = $("#dkPsBody", el);
    $$("#dkPsTabs [data-v]", el).forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.v === ps.tab)); });
    tmp.innerHTML = personHtml(ps.p, ps.tab); if (b) b.innerHTML = $("#dkPsBody", tmp).innerHTML;
  }
  function personLock(ps) {
    S2.locked({ title: "Staff and committee roles", who: "A commissioner",
      why: ["Staff membership changes only from a commissioner's record.", "A member joins the staff through an approved staff application. A committee manager seat is filled by staff applying and the other staff voting (Rule S2.8)."] });
  }
  function openPerson(id, tab) {
    var p = M.players.filter(function (x) { return x.id === id; })[0];
    if (!p) { S2.toast("No member with that link", "err"); setHash("#/desk?tab=people"); return; }
    var ps = st.psheet;
    if (ps && ps.p.id === id && ps.sh.el.isConnected) { if (tab) ps.tab = tab; paintPerson(ps); return; }
    if (ps) { ps.quiet = true; ps.sh.close(); }
    setHash("#/desk/person/" + id);
    ps = st.psheet = { p: p, tab: tab || "overview", quiet: false };
    if (ps.tab === "discipline" && LV.rec[p.id] === undefined) lvRecord(p.id);
    ps.sh = S2.sheet({ title: "Member record", label: "Member record", html: personHtml(p, ps.tab), onClose: function () {
      if (st.psheet === ps) st.psheet = null;
      if (!ps.quiet && /^#\/desk\/person\//.test(location.hash)) setHash("#/desk?tab=people");
    } });
    ps.sh.el.addEventListener("click", function (e) {
      if (e.target.closest('a[href^="#/"]')) { ps.sh.close(); return; }   /* a link leaves the record: no sheet left over a new page */
      var lk = e.target.closest("[data-lock]"); if (lk) { personLock(ps); return; }
      var t = e.target.closest("#dkPsTabs [data-v]"); if (!t || t.getAttribute("aria-pressed") === "true") return;
      ps.tab = t.dataset.v; paintPerson(ps);
    });
  }

  /* =========================================================================================================== */
  /* COMMITTEES: the S2 staffing model. One staff; committees are topics with a manager, never a scope or a gate     */
  /* =========================================================================================================== */
  /* where each committee's work lives on the desk (the focus view's arrow) */
  var COM_HOME = { officiating: ["#/desk?tab=cases", "Cases", "cases"], statistics: ["#/desk?tab=games&amp;view=ruling", "Games", "games"], applications: ["#/desk?tab=applications", "Applications", "applications"],
    community: ["#/desk?tab=people", "People", "people"], transactions: ["#/desk?tab=transactions", "Transactions", "transactions"], draft: ["#/bidding", "Bid room", "bidding"] };
  /* what is next for a committee with nothing open: the next game night for Officiating (the Control Center's calendar
     and the market are read by their own pages, not the desk) */
  function comNext(key) { var n = nextNight().next; return key === "officiating" && n ? "Next game night: " + n.label + ", " + n.games.length + " games." : ""; }
  function ageStrip(h) {
    var aged = h.ages[0] + h.ages[1] + h.ages[2] + h.ages[3];
    if (!aged) return '<span class="dk-strip-none">' + (h.n ? "No wait time is kept for these items." : "Nothing waiting.") + "</span>";
    var lab = ["under a day", "1 to 3 days", "3 to 7 days", "over a week"];
    return '<span class="dk-strip" role="img" aria-label="' + esc("Open items by wait: " + h.ages.map(function (n, i) { return n + " " + lab[i]; }).join(", ")) + '">' +
      h.ages.map(function (n, i) { var m = ""; for (var j = 0; j < n; j++) m += "<i></i>"; return '<span class="dk-strip-c' + (i === 3 ? " old" : "") + '">' + m + "</span>"; }).join("") +
      '</span><span class="dk-strip-l" aria-hidden="true"><span>New</span><span>Over a week</span></span>';
  }
  function comCardHtml(c, focus) {
    var h = committeeHealth(c.key), mg = manager(c.key), mine = me().manages === c.key, nx = comNext(c.key);
    /* a clear committee says what is next instead of a grid of "None" */
    var body = h.n ? ageStrip(h) + '<dl class="spec"><div><dt>Oldest</dt><dd>' + esc(h.oldest == null ? "Not timed" : ageLong(h.oldest).replace(/ ago$/, "")) + "</dd></div>" +
        (h.open.some(function (x) { return x.kind === "case"; }) ? "<div><dt>Unclaimed</dt><dd>" + countSay(h.unclaimed) + "</dd></div>" : "<div><dt>Items</dt><dd>" + esc(h.openSay) + "</dd></div>") + "</dl>" +
        (h.toMgr ? '<span class="dk-flag on">' + countSay(h.toMgr) + " escalated to the manager</span>" : "")
      : '<span class="dk-ccard-next">' + esc(nx || "Nothing waiting.") + "</span>";
    return '<a class="dk-ccard' + (focus ? " on" : "") + '" href="#/desk?tab=committees&amp;c=' + c.key + '" data-committee="' + c.key + '"' + (focus ? ' aria-current="true"' : "") + ">" +
      '<span class="kicker">' + esc(!h.n ? "Clear" : h.openSay + " open") + "</span>" +
      '<span class="d-3">' + esc(c.name) + "</span>" +
      '<span class="dk-ccard-mgr"><span class="avatar dk-av xs">' + esc(mg ? initials(mg) : "?") + "</span>" + esc(mg || "Open: staff apply and vote") + (mine ? " (you)" : "") + (mg ? mgrBadge() : "") + "</span>" +
      '<span class="dk-ccard-covers">' + esc(c.covers) + '</span><span class="dk-ccard-body">' + body + "</span>" +
      '<span class="arrow dk-ccard-go"><span>' + (focus ? "In focus" : "Focus") + "</span>" + S2.ic("chev") + "</span></a>";
  }
  function focusRow(x) {
    var trail = x.shapes ? shapes(x.shapes, x.label + ": " + x.display) : x.ageHours != null ? '<span class="dk-age num" title="Waiting since ' + esc(ageLong(x.ageHours)) + '">' + ageShort(x.ageHours) + "</span>" : x.shape ? shapes(1, x.label) : "";
    var who = x.kind === "case" ? (x.claimant ? "Claimed by " + x.claimant : "Unclaimed") : x.sub;
    return '<a class="row dk-frow" href="' + x.href + '"' + (x.pane ? ' data-pane="' + x.pane + '"' : "") + " data-kbd-item>" +
      '<span class="grow"><span class="title">' + esc(x.label) + '</span><span class="sub">' + esc([x.kind === "case" ? x.sub : "", who].filter(Boolean).join(" · ")) + "</span></span>" +
      (x.toMgr ? '<span class="dk-flag on">With the manager</span>' : x.watch ? '<span class="dk-flag">On watch</span>' : "") + trail + S2.chev() + "</a>";
  }
  function focusSection(key) {
    var c = com(key), h = committeeHealth(key), mg = manager(key), mine = me().manages === key, home = COM_HOME[key], nx = comNext(key);
    var say = h.n ? (h.openSay === "One" ? "One item is open" : h.openSay + " items are open") + (h.unclaimed ? ", " + S2.words(h.unclaimed) + " unclaimed" : "") + "." : "Nothing is open." + (nx ? " " + esc(nx) : "");
    var list = h.items.length ? '<div class="dk-panel"><div class="dk-rows" id="dkFocusRows" data-kbd-list>' + h.items.map(focusRow).join("") + "</div></div>"
      : '<div class="dk-panel">' + stateBox("ok", "Nothing open for " + c.name, "When something on this topic needs staff it appears here, and anyone may pick it up.") + "</div>";
    return '<section class="dk-focus" id="dkFocus" aria-labelledby="dkFocusH"><div class="sec-head"><div class="copy"><span class="kicker">In focus</span><h3 class="d-2" id="dkFocusH" tabindex="-1">' + esc(c.name) + "</h3>" +
      "<p>" + (mg ? esc(mg) + (mine ? " (you)" : "") + " manages this committee and is the first stop when one of its items needs a second look. " : "") + say + (h.n ? " Anyone on staff may pick up any of them." : "") + "</p></div>" +
      (home ? arrowLink(home[0], home[1], home[2]) : "") +
      /* i3d (g5's hand-over): the pickup tools (js/pages/pickups.js) are Statistics' too */
      (key === "statistics" ? arrowLink(S2.pickups.href(), "Pickup games") : "") + "</div>" + list + "</section>";
  }
  /* the commissioner's rulings of 2026-11-23 (Rule S2.8 and Rule 7.2) */
  var CALLS = [
    /* qa (function 9): every manager suspends within Rule 7.2 and decides appeals (Rule 7.6), as "Who suspends" below says;
       the Draft and Bidding manager's own powers are the bidding pause and the draft room (Rule S2.8) */
    ["What a manager adds", "A manager sets the committee's priorities and is the go-to person for its topic. Every staffer has the same vote. Every manager may suspend within the limits of Rule 7.2 and decide appeals (Rule 7.6); the Draft and Bidding manager also pauses Saturday bidding and runs the draft room (Rule S2.8)."],
    ["Who suspends", "Only a committee manager or a commissioner. A manager issues up to 14 days, or up to 18 games in steps of three; anything longer is applied for and a commissioner approves it. Other staff may request a suspension. Bans are a commissioner's alone."],
    ["Who votes on applications", "Every staffer and every commissioner, on owner, staff, GM or AGM and committee manager applications. One passes when more than half of them approve, and a commissioner, who votes like everyone, may also decide one alone (Rule 2.6)."],
    ["How a manager is chosen", "Staff apply for an open manager seat, and the other staff and the commissioners vote on it. No one appoints a manager."]
  ];
  function paneCommittees(r) {
    var keys = COMMITTEES.map(function (c) { return c.key; });
    var busiest = COMMITTEES.slice().sort(function (a, b) { return committeeHealth(b.key).n - committeeHealth(a.key).n; })[0].key;
    var f = keys.indexOf(r.q.c) >= 0 ? r.q.c : st.focus || me().manages || busiest; st.focus = f;
    var commish = me().commish;
    return '<section class="dk-lineup-sec ' + R + '" aria-labelledby="dkComsH">' + secHead({ id: "dkComsH", k: "Season 2 staffing", h: "The committees", p: "Each one is a topic, not a team: its manager knows it best, and every item on it is open to the whole staff.",
        /* RULING 2026-11-23: a seat is filled by staff applying and the other staff voting; nobody appoints one */
        arrow: !commish ? '<button type="button" class="btn sm secondary" data-flow="committee">Apply for an open seat</button>' : "" }) +
      '<div class="lineup dk-lineup" id="dkLineup">' + COMMITTEES.map(function (c) { return comCardHtml(c, c.key === f); }).join("") + "</div></section>" +
      '<div class="' + R + '">' + focusSection(f) + "</div>" +
      '<section class="dk-calls ' + R + '" aria-labelledby="dkCallsH">' + secHead({ id: "dkCallsH", k: "The commissioner's rulings, November 23", h: "How the committees work", p: "Rule S2.8 holds each committee's charter; Rule 7.2 holds who may suspend." }) +
      '<div class="dk-panel"><div class="dk-rows">' + CALLS.map(function (x) {
        return '<div class="row dk-callrow"><span class="grow"><span class="title">' + esc(x[0]) + '</span><span class="sub">' + esc(x[1]) + "</span></span></div>";
      }).join("") + "</div></div></section>";
  }
  function setFocus(key, kb) {
    if (!com(key) || !$("#dkFocus")) return;
    st.focus = key; setHash("#/desk?tab=committees&c=" + key);
    $$("#dkLineup [data-committee]").forEach(function (a) {
      var on = a.dataset.committee === key; a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
      var go = $(".dk-ccard-go span", a); if (go) go.textContent = on ? "In focus" : "Focus";
    });
    var keep = R; R = ""; $("#dkFocus").outerHTML = focusSection(key); R = keep;
    var sec = $("#dkFocus"), h = $("#dkFocusH");
    if (!kb) swapIn(sec);
    /* stacked layouts put the focus below the lineup: bring it into view (instantly for the keyboard) */
    if (sec.getBoundingClientRect().top > window.innerHeight * 0.6) sec.scrollIntoView({ block: "start", behavior: kb || !moving() ? "auto" : "smooth" });
    if (kb && h) h.focus({ preventScroll: true });
  }

  /* =========================================================================================================== */
  /* TRANSACTIONS and NEWSROOM                                                                                   */
  /* =========================================================================================================== */
  /* the Transactions desk (part9_staffdesks.js _deskTransactions): the compliance table, the Season 2 rules it checks,
     and (gaps, 2026-11-25) the classic desk's Trades on the table and Trade history with its two doors, Reverse on a
     completed trade and Resend on a declined or withdrawn offer (the site's one reversal and resend doors, js/flows.js
     S2.reverseTrade and S2.resendTrade: reverse_trade and resend_trade). The public transaction log is the wire on the
     league pages. Offers are private to the two front offices and the league office (Rule 2.3). */
  function txInner() {
    var t = txOver(), s2 = M.RULES.s2;
    var cs0 = t && t.cs, over = t ? t.over : [];
    /* a flagged cell says why in words as well as in red: "short" under a minimum, "over" past the limit or the cap */
    var cell = function (txt, bad, why, quiet) { return '<td class="num' + (bad ? " dk-over" : quiet ? " dk-pre" : "") + '">' + txt + (bad ? '<span class="sr"> (' + why + ")</span>" : "") + "</td>"; };
    var pre = !!(t && t.pre);   /* before the draft the group counts are read quietly: no minimum applies yet */
    return '<section class="' + R + '" aria-labelledby="dkTxH">' + secHead({ id: "dkTxH", k: comName("transactions"), h: "Roster limits and the cap", p: !cs0 ? TX_NONE :
        /* before the draft the minimums are said as what starts at the draft; the pane's lede names the day */
        (pre ? "Season 2 limits: " + cs0.limit + " active under a " + esc(M.money(cs0.cap)) + " cap, and from the draft at least " + cs0.mins.F + " forwards, " + cs0.mins.D + " defense and " + cs0.mins.G + " goaltender (Rule S2.4). "
          : "Season 2 limits in force: " + cs0.limit + " active, with at least " + cs0.mins.F + " forwards, " + cs0.mins.D + " defense and " + cs0.mins.G + " goaltender, under a " + esc(M.money(cs0.cap)) + " cap (Rule S2.4). ") +
        "Season 2 cap room: " + esc(M.money(cs0.cap)) + " less the active roster; Season 2 has no club camps. Bids a club leads in a live room stay hidden until the lot ends (Rule S2.6), so they are not counted here." +
        (over.length ? " " + (over.length === 1 ? "One club is" : over.length + " clubs are") + " outside a limit, marked in red." : "") }) +
      (!cs0 ? stateBox("err", "Couldn't read the Season 2 figures", esc(TX_NONE) + " Reload the page; if it stays, check that js/market.js loads.") :
      '<div class="card pad-0"><div class="tbl-wrap"><table class="tbl dk-tx"><thead><tr><th scope="col">Club</th><th scope="col" title="Forwards">F</th><th scope="col" title="Defense">D</th><th scope="col" title="Goaltenders">G</th><th scope="col">Active</th><th scope="col">Payroll</th><th scope="col">Cap room</th><th scope="col">Seats</th></tr></thead><tbody>' +
      t.rows.map(function (x) {
        /* the AGM is named after the draft from the club's own roster (RULING 2026-11-23), so before it the seat is not open */
        var cs = x.cs, c = cs.active, o = x.out, open = Object.keys(x.seats).filter(function (k) { return !x.seats[k] && !(pre && k === "AGM"); });
        return '<tr><th scope="row"><span class="dk-tclub">' + M.crest(cs.code) + esc(cs.code) + "</span></th>" + cell(c.F, o.F, "short", pre) + cell(c.D, o.D, "short", pre) + cell(c.G, o.G, "short", pre) + cell(c.total + " of " + cs.limit, o.total, "over") +
          '<td class="num">' + esc(M.money(cs.payroll)) + "</td>" + cell(esc(M.money(cs.room)), o.room, "over the cap") + "<td>" + (open.length ? '<span class="chip warn">' + esc(open.join(", ")) + " open</span>" : '<span class="t-foot">' + (pre && !x.seats.AGM ? "Owner and GM" : "All three") + "</span>") + "</td></tr>";
      }).join("") + "</tbody></table></div></div>") + "</section>" + tradesHtml() +
      '<div class="dk-two">' +
      '<section class="dk-aside-sec ' + R + '" aria-labelledby="dkTrH">' + secHead({ id: "dkTrH", k: comName("transactions"), h: "Trades", sm: true,
          p: "A trade is made in the Trade Hub by the two clubs agreeing; the office takes no part as it is made, and the cap and roster checks run at acceptance (Rule 2.3). Only completed trades are public." }) + "</section>" +
      '<section class="dk-aside-sec ' + R + '" aria-labelledby="dkS2H">' + secHead({ id: "dkS2H", k: "Season 2", h: "Rules this desk will check", sm: true, p: "From the Season 2 rulebook chapter." }) +
        '<div class="dk-rows dk-hair"><div class="row"><span class="grow"><span class="title">Roster size</span><span class="sub">All season, the draft included</span></span><span class="num">' + s2.limit + "</span></div>" +
        '<div class="row"><span class="grow"><span class="title">Minimums</span><span class="sub">A club’s own move below them is refused; an involuntary shortfall is filled by a random draw from the pool at $750K, with no draw after the movement deadline (Rule S2.4)</span></span><span class="num">' + s2.min.F + "F, " + s2.min.D + "D, " + s2.min.G + "G</span></div>" +
        '<div class="row"><span class="grow"><span class="title">Salary cap</span></span><span class="num">' + esc(M.money(s2.cap)) + "</span></div></div></section></div>";
  }
  function paneTx() { return '<div id="dkTx">' + txInner() + "</div>"; }
  /* -------- the trade ledger (gaps, 2026-11-25; part9_staffdesks.js CG.AFTER._deskTransactions). Read when the pane opens:
     the season on screen's offers, newest first. trades RLS shows them to a commissioner and to has_department
     ('transactions') (every staffer once the held staff powers record applies), so the desk asks that gate first and
     never reads an RLS-emptied list as a quiet league; a failed read is said, never "no trades".
     shortcut: the newest sixty, as the classic desk; page them by key if a season ever nears it -------- */
  var TR_COLS = "id,season_id,from_team_id,to_team_id,offered_profile_ids,requested_profile_ids,offered_pick_ids,requested_pick_ids,note,status,created_at,updated_at";
  /* trade_status in the pages' words through S2.trade.STATUS (js/trade.js, one definition: a withdrawal is "withdrawn") */
  var TR_SAY = { pending: "Open", accepted: "Completed", declined: "Declined", withdrawn: "Withdrawn", reversed: "Reversed" };
  function trStatus(t) { return S2.trade.STATUS[t.status] || t.status; }
  function loadTrades() {
    var sid = (M.control && M.view && (M.control.season(M.view.season) || {}).settings || {}).id;
    LV.trades = Object.assign(LV.trades || {}, { busy: true });
    return Promise.resolve().then(function () {
      if (!sid) throw new Error("The season on screen was not read from the league, so its trades cannot be listed. Reload the page.");
      return rd(function (c) { return c.from("trades").select(TR_COLS).eq("season_id", sid).order("created_at", { ascending: false }).limit(60); });
    }).then(function (rows) { LV.trades = { rows: rows || [], err: null, at: Date.now(), sid: sid }; }, function (e) { console.error("Staff Desk: the trades could not be read", e); LV.trades = { rows: null, err: e.message, at: Date.now(), sid: sid }; });
  }
  function repaintTrades() { var h = $("#dkTrades"); if (h) { var keep = R; R = ""; h.outerHTML = tradesHtml(); R = keep; } }
  function ensureTrades() { if (LV.G && (LV.G.commish || LV.G.tx) && !(LV.trades && (LV.trades.busy || LV.trades.at))) loadTrades().then(repaintTrades); }
  function codeOfTeam(id) { var t = M.teams.filter(function (x) { return x.id === id; })[0]; return t ? t.code : null; }
  function tradeWho(ids, picks) { var n = (ids || []).map(function (id) { var pl = M.player(id); return pl ? pl.tag : "a player"; }); if (picks && picks.length) n.push(picks.length === 1 ? "a draft pick" : picks.length + " draft picks"); return n.length ? n.join(", ") : "nothing"; }
  function tradeRow(t) {
    var f = codeOfTeam(t.from_team_id), to = codeOfTeam(t.to_team_id), ts = trStatus(t);
    var act = ts === "accepted" ? "reverse" : ts === "declined" || ts === "withdrawn" ? "resend" : null;
    return '<div class="row dk-trow"><span class="dk-tclub">' + (f ? M.crest(f) + esc(f) : "?") + '</span><span class="t-foot" aria-hidden="true">to</span><span class="dk-tclub">' + (to ? M.crest(to) + esc(to) : "?") + "</span>" +
      '<span class="grow"><a class="title" href="' + esc(S2.tradePage ? S2.tradePage.offer(t.id) : "#/trade?offer=" + t.id) + '">' + esc(tradeWho(t.offered_profile_ids, t.offered_pick_ids) + " for " + tradeWho(t.requested_profile_ids, t.requested_pick_ids)) + "</a>" +
      '<span class="sub">' + esc((TR_SAY[ts] || ts) + " · " + ago(ts === "pending" ? t.created_at : t.updated_at || t.created_at)) + "</span></span>" +
      (act ? '<button type="button" class="btn secondary sm" data-act="tx-' + act + '" data-id="' + esc(t.id) + '">' + (act === "reverse" ? "Reverse" : "Resend") + "</button>" : "") + "</div>";
  }
  function tradesHtml() {
    var G = LV.G || {}, T0 = LV.trades, head = function (p) { return secHead({ id: "dkTradesH", k: comName("transactions"), h: "Trades this season", p: p }); }, body;
    if (!G.commish && !G.tx) body = head(LV.flip ? "Offers are private to the two front offices; completed trades are listed on the league's transaction wire (Rule 2.3)."
      : "The league shows offers to the transactions staff and the commissioners only, so none are listed for this account (Rule 2.3).");
    else if (!T0 || !T0.at) body = head("Reading the season's trades.") + stateBox("muted", "Reading the trades", "One moment.");
    else if (T0.err) body = head("The trades could not be read.") + stateBox("err", "Couldn't read the trades", esc(T0.err) + " This is not the same as no trades.", '<button type="button" class="btn sm secondary" data-act="tx-retry">Try again</button>');
    else {
      var open = T0.rows.filter(function (t) { return trStatus(t) === "pending"; }), done = T0.rows.filter(function (t) { return trStatus(t) !== "pending"; }).slice(0, 15);
      body = head((open.length ? (open.length === 1 ? "One offer is" : open.length + " offers are") + " on the table." : "Nothing is on the table.") + " A completed trade may be reversed with a reason both clubs read, and a declined or withdrawn offer resent as it was (Rule 2.3).") +
        '<p class="t-cap dk-mt">On the table</p><div class="dk-rows dk-hair">' + (open.length ? open.map(tradeRow).join("") : '<p class="t-foot">No open offers.</p>') + "</div>" +
        '<p class="t-cap dk-mt">History</p><div class="dk-rows dk-hair">' + (done.length ? done.map(tradeRow).join("") : '<p class="t-foot">No answered offers this season.</p>') + "</div>";
    }
    return '<section class="' + R + '" id="dkTrades" aria-labelledby="dkTradesH">' + body + "</section>";
  }
  function txAct(t) {
    var id = t.dataset.id, row = ((LV.trades && LV.trades.rows) || []).filter(function (x) { return x.id === id; })[0]; if (!row) return;
    var f = codeOfTeam(row.from_team_id), to = codeOfTeam(row.to_team_id), nm = function (c) { var tm = c && M.team(c); return tm ? tm.full : "another club"; };
    var after = function () { loadTrades().then(repaintTrades); };
    if (t.dataset.act === "tx-reverse") S2.reverseTrade(id, { text: "The trade between the " + nm(f) + " and the " + nm(to) + ".", done: after });
    else S2.resendTrade(id, { text: "The " + nm(f) + " offer to the " + nm(to) + ".", to: nm(to), done: after });
  }
  var FRONT = { recap: "Night recap", rankings: "Power rankings", stories: "Top stories" };   /* the heading already says modules */
  /* the switches are public.feature_flags rows home_<module> (s2_league's config.flags), the current site's homepage door
     (CG.AFTER._admHomepage: an absent row is shown) */
  function frontOn(k) { var f = M.config && M.config.flags, v = f ? f["home_" + k] : undefined; return v === undefined ? true : !!v; }
  function toggleFront(k) {
    if (!FRONT[k]) return;
    /* me().commish is the database's is_commissioner(), the same test as the feature_flags write policy */
    if (!me().commish) {
      S2.locked({ title: "Front page modules", who: "A commissioner", why: "Which modules lead the site's front page is a commissioner's choice." });
      return;
    }
    /* nothing flips until the database confirms the row; a refusal leaves the switch where it was and says why */
    var sw0 = $('[data-act="front"][data-k="' + k + '"]'); if (!sw0 || sw0.getAttribute("aria-busy") === "true") return;
    var next = !frontOn(k);
    sw0.setAttribute("aria-busy", "true");
    S2.write("feature_flags.upsert", { row: { key: "home_" + k, enabled: next, label: "Homepage: " + k }, onConflict: "key", select: "key" }, { sections: ["config"] }).then(function () {
      var sw1 = $('[data-act="front"][data-k="' + k + '"]'); if (sw1) { sw1.removeAttribute("aria-busy"); sw1.setAttribute("aria-checked", String(next)); }
      S2.toast(FRONT[k] + " module " + (next ? "shown on" : "hidden from") + " the front page, for everyone", "ok");
    }, function (e) {
      var sw1 = $('[data-act="front"][data-k="' + k + '"]'); if (sw1) sw1.removeAttribute("aria-busy");
      S2.toast("The front page did not change: " + e.message, "err");
    });
  }
  /* the power rankings as the desk shows them: none before the season's first final, when every club is level at zero
     (QA round 2, 2026-11-25: the Newsroom named a club as leading before a game was played; Today and the public
     standings already wait for the first final, by M.view.finals) */
  function powerNow() { return M.view.finals ? M.standings("power") : []; }
  function paneNews(r) {
    var pw = powerNow(), commish = me().commish, nx = nextNight().next;
    return '<div class="dk-two dk-two-main">' +
      '<section class="' + R + '" aria-labelledby="dkPwH">' + /* no Media committee in Season 2 (2026-10-22): the recap and the rankings are automatic, and in one staff anyone may write a story */
      secHead({ id: "dkPwH", k: "Automatic", h: "Power rankings", p: "Automatic, from the table: the club rating mixes record, goal difference, goaltending, depth and form. Anyone on staff may check the order before it publishes.",
        arrow: arrowLink("#/standings?view=power", "Public rankings") }) +
      '<div class="card pad-0">' + (!pw.length ? stateBox("muted", "No rankings yet", "The power rankings start with the season&rsquo;s first final; until then every club is level.") : '<div class="dk-rows">' + pw.map(function (p) {
        var mv = p.move > 0 ? '<span class="delta up num">▲' + p.move + "</span>" : p.move < 0 ? '<span class="delta down num">▼' + (-p.move) + "</span>" : '<span class="t-foot">Same</span>';
        return '<a class="row" href="' + esc(p.href) + '"><span class="d-num dk-rank">' + p.rank + "</span>" + M.crest(p.code) + '<span class="grow"><span class="title">' + esc(p.team.full) + '</span><span class="sub">' + p.pts + " points</span></span>" + mv + '<span class="num dk-ovr">' + p.ovr + "</span></a>";
      }).join("") + "</div>") + "</div></section>" +
      '<div class="dk-aside">' +
      '<section class="dk-aside-sec ' + R + '" aria-labelledby="dkRcH">' + secHead({ id: "dkRcH", k: "Automatic", h: "Night recap", sm: true, p: "One post per game night in the news channel, written by the recap job after the last final. Spotlights stay on the site." }) +
        '<p class="dk-next">' + esc(nx ? "Next: " + nx.label + ", " + nx.games.length + " games" : "No game night is scheduled") + "</p></section>" +
      '<section class="dk-aside-sec ' + R + '" aria-labelledby="dkStH">' + secHead({ id: "dkStH", k: "Any staffer", h: "Stories", sm: true, p: "Anyone on staff drafts and publishes stories, on the site and in the Discord news channel." }) +
        '<button class="btn sm secondary" data-flow="story">Write a story</button></section>' +
      '<section class="dk-aside-sec ' + R + '" aria-labelledby="dkFpH">' + secHead({ id: "dkFpH", k: "The site", h: "Front page", sm: true, p: "Which modules lead the site's front page, saved for every visitor. " + (commish ? "" : '<span class="chip dk-lockchip">' + ic("lock") + "Commissioner only</span>") }) +
        '<div class="dk-rows dk-hair">' + Object.keys(FRONT).map(function (k) {
          /* a staffer's switch stays live at full strength and opens S2.locked; the one lock sits in the sentence above
             (review 2026-10-20: a chip and a dimmed switch on every row read as disabled three times over) */
          return '<div class="row"><span class="grow"><span class="title">' + FRONT[k] + '</span></span>' +
            '<button class="switch" role="switch" aria-label="' + FRONT[k] + " module" + (commish ? "" : ", commissioner only") + '" aria-checked="' + frontOn(k) + '" data-act="front" data-k="' + k + '"></button></div>';
        }).join("") + "</div></section></div></div>";
  }

  /* =========================================================================================================== */
  /* LIVE: the real Staff Desk (v5.00 swap, stream g1, 2026-11-24)                                                */
  /* =========================================================================================================== */
  /* In live mode (S2.LIVE, js/core.js) the desk reads the league office's own records through f's client (S2.rd, the one
     read door every staff page uses) and writes only through S2.write (contracts/client-api.md), on the doors the
     current site uses (src/live/part_live.js CG.AFTER._complaintsLive, CG.suspendUser, CG.caseDisciplineModal,
     CG.appBallotSection, CG.wireAppChat; write-paths.md section 3 "Staff Desk" and "Filed forms"):
       cases        action_requests (read, and update with the final decision statement, v4.32), action_messages (read,
                    insert, the staff-only note), assign_case, decide_position_change, decide_forfeit_appeal, discipline_from_case
       discipline   suspend_player (a warning is one), extend_suspension, lift_suspension, ban_player and unban_player
       applications application_ballots (upsert, delete), application_messages (insert), override_application_decision
     Nothing shows as done until the database confirms it, a refusal shows the database's own words in place and keeps what
     was typed, and every repaint is in place (never the router).
     WHO SEES A CONTROL is the database's answer, never a JavaScript copy of who may act: is_commissioner(), is_staff(),
     has_department('officiating' | 'community'), is_app_reviewer(me) and can_vote_committee_app(app, me), all callable by a
     signed-in member and STABLE. The Season 2 staffing flip (records held on db/s2-committees) adds is_any_committee_manager,
     request_suspension, decide_suspension_request, withdraw_suspension_request and the suspension_requests read. Until it
     applies PostgREST cannot find them (PGRST202 for a function, PGRST205 for a table): that means "not yet", said once in
     the console, and the desk shows today's flow; the moment they answer, the Season 2 flow (only committee managers and
     commissioners suspend, everyone else requests; the keep-length choice; extension requests in the suspension's own terms;
     staff appeals decided by a commissioner) shows with no code change. The one per-row reading is the conflict rule (a
     staffer who filed a case or is named in it does not rule on it; ar_update, assign_case and discipline_from_case refuse
     the same), read from the case's own ids, as the current site's actionCard does.
     shortcut: the conflict rule is read from the row, not asked of the database; add a can_rule_on_request(id) read if
     that rule ever changes. */
  var LV = { state: "idle", err: null, at: 0, G: null, flip: null, cases: null, msgs: {}, apps: null, ballots: null, amsgs: {},
    desk: null, staff: [], voters: null, cmVote: {}, reqs: null, rec: {}, run: null };
  function myId() { return (S2.session && S2.session.profileId) || null; }
  /* every desk read goes through S2.rd (js/live.js), the one read door (QA round 2, A10): no read client is an error in the
     desk's own words, never an empty answer, and a refusal carries the database's message, code and hint */
  function rd(q) { return S2.rd(q, { offline: "Not connected to the league, so the desk cannot be read here. Reload the page and try again." }); }
  function rpcRd(name, args) { return rd(function (c) { return c.rpc(name, args || {}); }); }
  /* qa (nits 19): only PostgREST's "no such function" and "no such table" mean a Season 2 record is not applied yet; an
     undefined function or table INSIDE a gate that exists (42883, 42P01) is a broken gate and stays a failure, never a
     quiet fall back to the pre-flip flow */
  var NOT_YET = { PGRST202: 1, PGRST205: 1 }, toldNotYet = {};
  function notYet(e, what) {
    if (!e || !NOT_YET[e.code]) return false;
    if (!toldNotYet[what]) { toldNotYet[what] = true; console.info("Staff Desk: " + what + " is not in the database yet (the Season 2 staffing records are not applied), so the desk shows today's flow."); }
    return true;
  }
  /* a Season 2 read: {v} when it answers, null while it does not exist yet; any other failure stays a failure */
  function maybe(p, what) { return p.then(function (v) { return { v: v }; }, function (e) { if (notYet(e, what)) return null; throw e; }); }
  function nameOf(p, dflt) { return (p && p.gamertag) || dflt; }
  function staffRole(p) { return !!p && (p.role === "staff" || p.role === "commissioner"); }
  /* qa (nits 11): the season the league runs or is about to run, as current_season_id() picks it (the active season, else
     the next upcoming one), never the season on screen: ?season=1 (league.js seasonHref) points that at the archive.
     Falls back to the season on screen only when the league read carried no seasons rows */
  function curSeason() {
    var L = (M.control && M.control.seasons) || [];
    return L.filter(function (x) { return x.status === "active"; })[0] || L.filter(function (x) { return x.status === "upcoming"; }).sort(function (a, b) { return a.number - b.number; })[0] || null;
  }
  function curSeasonNo() { var c = curSeason(); return c ? c.number : M.view.season; }
  /* qa (nits 19): the position change deadline as public.position_change_deadline reads it for a basic season: the sign-up
     cutoff (signup_deadline_at, else registration_deadline); after it decide_position_change lets only a commissioner
     approve. shortcut: the full format's Tuesday-before-pre-season rule is not mirrored (every season runs basic, standing
     order), so a full season offers Approve and the database rules; read the RPC if a full season is ever designated */
  function posDeadline() { var c = curSeason(), x = c && c.settings; return x && x.format === "basic" ? x.signup_deadline_at || x.registration_deadline || null : null; }
  function posClosed() { var d = posDeadline(); return !!d && Date.now() > Date.parse(d); }
  /* qa (nits 19): a committee manager decides a suspension request only inside their ceiling (decide_suspension_request in
     the staff powers record): 18 games, or a last day at most 15 days from now (manager_date_ceiling), never a season;
     past it a commissioner decides. shortcut: an extension's total also counts the running suspension, which this list
     does not carry, so only an extension past the ceiling on its own is held back here; the door refuses the rest and
     says why */
  function reqInCeiling(q) {
    if (q.mode === "seasons") return false;
    if (q.mode === "games") return (+q.games || 0) <= 18;
    if (q.mode === "date") return q.extends_id ? (+q.days || 0) <= 14 : !!q.ends_at && M.etDay(q.ends_at) < M.etDay(new Date(Date.now() + 15 * 864e5).toISOString());
    return false;
  }
  function staffName(id) { var s = LV.staff.filter(function (x) { return x.id === id; })[0]; return s ? s.gamertag : null; }
  function myName() { return (S2.auth && S2.auth.profile && S2.auth.profile.gamertag) || staffName(myId()) || "You"; }
  function involved(a) { var me0 = myId(); return !!me0 && (a.profile_id === me0 || a.target_profile_id === me0); }

  /* -------- the gates: the database's own answers, read once per visit to the desk and after each write -------- */
  function loadGates() {
    var me0 = myId();
    return Promise.all([rpcRd("is_commissioner"), rpcRd("is_staff"), rpcRd("has_department", { p_key: "officiating" }), rpcRd("has_department", { p_key: "community" }),
      rpcRd("is_app_reviewer", { p_uid: me0 }), maybe(rpcRd("is_any_committee_manager", { p_profile: me0 }), "is_any_committee_manager()"), rpcRd("has_department", { p_key: "transactions" })]).then(function (r) {
      LV.flip = !!r[5];
      LV.G = { commish: r[0] === true, staff: r[1] === true, off: r[2] === true, com: r[3] === true, reviewer: r[4] === true, cm: !!(r[5] && r[5].v === true), tx: r[6] === true };
    });
  }
  /* what the database lets this reader do, from the gates above (the doors re-check every call) */
  function may(what, x) {
    var G = LV.G || {}, office = G.commish || G.staff;
    switch (what) {
      case "desk": return office;
      /* before the flip: a commissioner, officiating or community (_issue_suspension); after: a committee manager or a commissioner */
      case "suspend": return G.commish || (LV.flip ? G.cm : G.off || G.com);
      case "warn": return G.commish || (LV.flip ? G.staff : G.off || G.com);
      /* after the flip any staffer files a request (request_suspension), and a committee manager applies the same way for
         anything past 14 days or 18 games, or through a season, which a commissioner approves (Rule 7.2; the flip's refusals
         say "Anything longer is applied for"). A commissioner issues any length, so has nothing to apply for */
      case "request": return LV.flip === true && office && !G.commish;
      case "ban": return G.commish;
      case "decide-request": return LV.flip === true && (G.commish || (G.cm && x.filed_by !== myId() && x.profile_id !== myId() && !staffRole(x.member) && reqInCeiling(x)));
      case "rule": return office && (G.commish || !involved(x));
      /* an appeal (guard_appeal_decider): before the flip the department it was routed to; after it a committee manager, and an
         appeal by a member of league staff only a commissioner (Rule 7.6) */
      case "appeal": return may("rule", x) && (G.commish || (LV.flip ? G.cm && !staffRole(x.filer) : x.dept === "community" ? G.com : G.off));
      case "forfeit-appeal": return G.commish;
      case "position": return office && (G.commish || x.profile_id !== myId());
      case "note": return office;
      case "vote": return x.type === "committee" ? LV.cmVote[x.uuid] === true : G.reviewer;
      case "override": return G.commish;
      case "app-message": return office && x.type !== "committee";
    }
    return false;
  }

  /* -------- the reads -------- */
  var CASE_TYPE = { complaint: "Complaint", appeal: "Appeal", position_change: "Position change", stats_correction: "Statistics correction", forfeit_appeal: "Forfeit appeal" };
  var CASE_COLS = "id,type,route,status,subject,details,target,target_profile_id,profile_id,assigned_to,assigned_at,response,created_at,updated_at,current_position,requested_position,dept,suspension_id,game_id,team_id," +
    "filer:profiles!action_requests_profile_id_fkey(gamertag,role),about:profiles!action_requests_target_profile_id_fkey(gamertag,role),claimer:profiles!action_requests_assigned_to_fkey(gamertag)";
  function caseOf(a) {
    var closed = a.status === "resolved" || a.status === "denied";
    return { id: a.id, live: true, raw: a, type: a.type, typeLabel: CASE_TYPE[a.type] || a.type, c: S2.caseCommittee(a.type), status: a.status === "acknowledged" ? "reviewing" : a.status,
      ageHours: (Date.now() - Date.parse(a.created_at)) / 36e5, title: a.subject || CASE_TYPE[a.type] || "Case", claimant: a.assigned_to ? nameOf(a.claimer, "A colleague") : null,
      claimantId: a.assigned_to || null, filer: nameOf(a.filer, "A member"), resolveHours: closed && a.updated_at ? (Date.parse(a.updated_at) - Date.parse(a.created_at)) / 36e5 : null,
      escalated: false, toMgr: null, log: [] };
  }
  /* staff casework only: a trade request is the club's (Rule 2.3), and the manager route never reaches staff (ar_read) */
  function loadCases() {
    return rd(function (c) { return c.from("action_requests").select(CASE_COLS).neq("type", "trade_request").order("created_at", { ascending: false }); })
      .then(function (rows) { LV.cases = (rows || []).filter(function (a) { return staffType(a.type) && a.route !== "manager"; }).map(caseOf); });
  }
  var MSG_COLS = "id,request_id,author_id,body,internal,created_at,deleted_at,author:profiles!action_messages_author_id_fkey(gamertag,role)";
  function loadMsgs(id) {
    return rd(function (c) { return c.from("action_messages").select(MSG_COLS).eq("request_id", id).order("created_at", { ascending: true }); })
      .then(function (rows) { LV.msgs[id] = rows || []; }, function (e) { LV.msgs[id] = { err: e.message }; throw e; });
  }
  var APP_SRC = {
    owner: { table: "owner_applications", kind: "owner2", cols: "id,season_id,profile_id,ea_id,timezone,availability,preferred_club,franchise_2,franchise_3,experience,pitch,status,response,created_at,filed_at,decided_at,applicant:profiles!owner_applications_profile_id_fkey(gamertag)" },
    staff: { table: "staff_applications", kind: "staff", cols: "id,profile_id,timezone,availability,experience,pitch,departments,status,response,created_at,filed_at,decided_at,applicant:profiles!staff_applications_profile_id_fkey(gamertag)" },
    management: { table: "management_applications", kind: "mgmt", cols: "id,team_id,role,submitted_by,nominee_id,pitch,status,response,created_at,decided_at,nominee:profiles!management_applications_nominee_id_fkey(gamertag),owner:profiles!management_applications_submitted_by_fkey(gamertag)" },
    committee: { table: "committee_applications", kind: "cm", cols: "id,committee_key,profile_id,pitch,status,response,created_at,decided_at,applicant:profiles!committee_applications_profile_id_fkey(gamertag)" }
  };
  function appOf(type, row) {
    return { id: type + "-" + row.id, uuid: row.id, type: type, kind: APP_SRC[type].kind, live: true, row: row, seat: row.committee_key || null,
      who: type === "management" ? nameOf(row.nominee, "A member") : nameOf(row.applicant, "A member"), profile_id: type === "management" ? row.nominee_id : row.profile_id,
      stage: row.status === "pending" ? "ballot" : row.status === "approved" || row.status === "denied" ? "decided" : "closed", outcome: row.status };
  }
  function loadApps() {
    var types = Object.keys(APP_SRC);
    return Promise.all(types.map(function (t) { return rd(function (c) { return c.from(APP_SRC[t].table).select(APP_SRC[t].cols).order("created_at", { ascending: false }); }); })
      .concat([rd(function (c) { return c.from("application_ballots").select("app_type,application_id,voter_id,vote,note,updated_at,voter:profiles!application_ballots_voter_id_fkey(gamertag)"); }),
        rpcRd("staff_voter_count")])).then(function (r) {
      var list = [];
      types.forEach(function (t, i) { (r[i] || []).forEach(function (row) { list.push(appOf(t, row)); }); });
      LV.apps = list; LV.ballots = r[types.length] || []; LV.voters = typeof r[types.length + 1] === "number" ? r[types.length + 1] : null;
      /* the committee seat ballot has its own gate (can_vote_committee_app: a voter, never the applicant) */
      var cm = list.filter(function (a) { return a.type === "committee" && a.stage === "ballot"; });
      return Promise.all(cm.map(function (a) { return rpcRd("can_vote_committee_app", { p_app: a.uuid, p_uid: myId() }).then(function (v) { LV.cmVote[a.uuid] = v === true; }); }));
    });
  }
  function loadAppMsgs(a) {
    if (a.type === "committee") { LV.amsgs[a.id] = []; return Promise.resolve(); }
    return rd(function (c) { return c.from("application_messages").select("id,app_type,application_id,sender_id,body,created_at,deleted_at,sender:profiles!application_messages_sender_id_fkey(gamertag,role)")
      .eq("app_type", a.type).eq("application_id", a.uuid).order("created_at", { ascending: true }); })
      .then(function (rows) { LV.amsgs[a.id] = rows || []; }, function (e) { LV.amsgs[a.id] = { err: e.message }; throw e; });
  }
  var REQ_COLS = "id,profile_id,mode,games,ends_at,until_season,days,extends_id,reason,filed_by,case_id,status,created_at," +
    "member:profiles!suspension_requests_profile_id_fkey(gamertag,role),filer:profiles!suspension_requests_filed_by_fkey(gamertag)";
  function loadReqs() {
    return maybe(rd(function (c) { return c.from("suspension_requests").select(REQ_COLS).eq("status", "pending").order("created_at", { ascending: true }); }), "the suspension_requests table")
      .then(function (r) { LV.reqs = r ? r.v || [] : null; });
  }
  /* a member's discipline record (suspension_record: staff read reasons, issuers and warnings) and whether they are banned */
  var REC_COLS = "id,profile_id,mode,games_total,games_served,ends_at,until_season,status,running,lifted_at,created_at,season_id,scope,venue,reason,created_by,grounds";
  function loadRecord(pid) {
    return Promise.all([rd(function (c) { return c.from("suspension_record").select(REC_COLS).eq("profile_id", pid).order("created_at", { ascending: false }); }),
      rd(function (c) { return c.from("profiles").select("id,banned,ban_reason").eq("id", pid).maybeSingle(); })]).then(function (r) {
      LV.rec[pid] = { rows: r[0] || [], banned: !!(r[1] && r[1].banned), why: r[1] && r[1].ban_reason || null };
    }, function (e) { LV.rec[pid] = { err: e.message }; throw e; });
  }
  /* the six committees and who holds each seat (public.committees, readable by everyone) */
  function loadComs() { return rd(function (c) { return c.from("committees").select("key,name,manager_profile_id,manager:profiles!committees_manager_profile_id_fkey(gamertag)").order("sort", { ascending: true }); }).then(function (rows) { LV.coms = rows || []; }); }
  /* everything the desk shows, in one go; the desk paints a loading state until it lands and an error state if it fails */
  function loadAll() {
    if (LV.run) return LV.run;
    LV.state = LV.at ? LV.state : "loading";
    LV.run = loadGates().then(function () {
      if (!may("desk")) return null;
      return Promise.all([loadCases(), loadApps(), loadReqs(), loadComs(), rpcRd("s2_desk").then(function (d) { LV.desk = d || {}; LV.staff = (LV.desk.staff || []).filter(function (s) { return s && s.id; }); })]);
    }).then(function () { LV.state = "ready"; LV.err = null; LV.at = Date.now(); }, function (e) { console.error("Staff Desk: the desk could not be read", e); LV.state = "error"; LV.err = e.message; })
      .then(function () { LV.run = null; });
    return LV.run;
  }
  /* the whole desk again, in place, once the reads land (never under someone typing or with a sheet open) */
  function lvRepaint() {
    if (!$("#dk") || $(".sheet")) return;
    var a = document.activeElement;
    if (a && a.closest && a.closest("#dk") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    swapTo(location.hash, false);
  }
  function lvGate(inner) {
    if (LV.state === "error") return stateBox("err", "The desk did not load", esc(LV.err || "The league did not answer.") + " Nothing here can be read as clear until it loads.", '<button type="button" class="btn sm secondary" data-act="lv-retry">Try again</button>');
    if (!LV.G || LV.state === "loading" || LV.state === "idle") return stateBox("muted", "Loading the desk", "Reading the league office's cases, applications and discipline.");
    if (!may("desk")) return stateBox("lock", "The Staff Desk is for league staff", "The league says this account is not on the league staff, so it has nothing to show here.");
    return inner();
  }
  function ago(iso) { var t = Date.parse(iso); return isNaN(t) ? "" : M.ago(Math.max(0, (Date.now() - t) / 60000)); }

  /* -------- the writes: one door, a confirmed answer, then the re-read and an in-place repaint -------- */
  function busyBtn(b, on, label) {
    if (!b) return;
    if (on) { b.dataset.idle = b.innerHTML; b.disabled = true; b.setAttribute("aria-busy", "true"); b.textContent = label || "Saving…"; }
    else { b.disabled = false; b.removeAttribute("aria-busy"); if (b.dataset.idle != null) { b.innerHTML = b.dataset.idle; delete b.dataset.idle; } }
  }
  /* one sheet for every decision, discipline form and confirmation that writes: the form is read, the door is called, and the
     sheet closes only on a confirmed write; a refusal is shown in the sheet with the database's own words, input kept */
  function writeSheet(o) {
    var sh = S2.confirm({ title: o.title, ok: o.ok, danger: o.danger, why: o.why, html: (o.html || "") + '<p class="dk-a-err dk-lv-err" role="alert" data-lv-err></p>',
      onOk: function (s) {
        var errEl = $("[data-lv-err]", s.el), okb = $('[data-cf="ok"]', s.el);
        if (okb && okb.getAttribute("aria-busy") === "true") return false;
        var args = o.read(s.el, function (msg) { errEl.textContent = msg; });
        if (!args) return false;
        errEl.textContent = ""; busyBtn(okb, true, o.busy || "Saving…");
        o.run(args).then(function (res) {
          busyBtn(okb, false); s.close();
          if (o.done) o.done(res, args);
        }, function (e) {
          busyBtn(okb, false); errEl.textContent = e.message || String(e);
          if (o.failed) o.failed(e, s.el, args);
        });
        return false;
      } });
    if (o.mounted) o.mounted(sh.el);
    return sh;
  }
  function stmtField(caption) {
    return '<label class="dk-a-lbl" for="dkStmt">Final decision statement<span class="t-foot">Required (Rule 1.4)</span></label>' +
      '<textarea class="input" id="dkStmt" rows="4" maxlength="2000" placeholder="What was decided, and why"></textarea><p class="t-foot">' + esc(caption) + "</p>";
  }
  function readStmt(el, err) {
    var t = ($("#dkStmt", el) || {}).value; t = String(t || "").trim();
    if (!t) { err("Write the final decision statement first: the member sees it with the decision (Rule 1.4)."); var f = $("#dkStmt", el); if (f) f.focus(); return null; }
    if (t.length > 2000) { err("Keep the statement to 2,000 characters."); return null; }
    return t;
  }

  /* -------- CASES -------- */
  function msgHtml(m) {
    if (m.deleted_at) return '<li class="dk-lv-msg gone"><span class="t-foot">A message was deleted.</span></li>';
    var office = staffRole(m.author);
    return '<li class="dk-lv-msg' + (m.internal ? " note" : "") + (office ? " office" : "") + '"><p class="dk-msg-by">' + esc(nameOf(m.author, "A member")) + (office ? " · league office" : "") + (m.internal ? " · staff-only note" : "") +
      " <span>" + esc(M.etDateTime(m.created_at)) + '</span></p><p class="dk-msg-b">' + esc(m.body || "") + "</p></li>";
  }
  function lvThread(c) {
    var L = LV.msgs[c.id];
    if (L === undefined) return '<p class="t-foot" data-lv-thread="' + esc(c.id) + '">Loading the conversation…</p>';
    if (L && L.err) return stateBox("err", "The conversation did not load", esc(L.err), '<button type="button" class="btn sm secondary" data-act="lv-msgs">Try again</button>');
    return L.length ? '<ol class="dk-lv-thread" id="dkLvThread">' + L.map(msgHtml).join("") + "</ol>" : '<p class="t-foot">No messages on this case yet.</p>';
  }
  function lvComposer(c) {
    if (!isOpen(c)) return "";
    var d = st.lvDraft && st.lvDraft.id === c.id ? st.lvDraft : { body: "", internal: false };
    return '<div class="dk-chat-comp dk-lv-comp"><label class="sr" for="dkLvReply">Reply on this case</label><textarea class="input dk-chat-in" id="dkLvReply" rows="2" placeholder="Reply to ' + esc(c.filer) + ' or add a note">' + esc(d.body) + "</textarea>" +
      '<button type="button" class="btn dk-chat-send" data-act="lv-reply" aria-label="Send">' + ic("send") + "</button></div>" +
      (may("note") ? '<label class="dk-lv-check"><input type="checkbox" id="dkLvInternal"' + (d.internal ? " checked" : "") + "> Staff-only note (the member never sees it)</label>" : "") +
      '<p class="dk-a-err" id="dkLvReplyErr" role="alert"></p>';
  }
  function lvCaseDetail(c) {
    var a = c.raw, o = isOpen(c), mine = c.claimantId === myId(), rule = may("rule", a), k = function (x) { return '<span class="dk-kbd" aria-hidden="true">' + x + "</span>"; }, decide = "", note = "";
    if (o && a.type === "position_change") {
      var late = posClosed() && !(LV.G || {}).commish;
      decide = may("position", a) ? (late ? "" : '<button class="btn sm" data-act="lv-pos" data-v="approve">Approve ' + esc((a.current_position || "?") + " to " + (a.requested_position || "?")) + "</button>") + '<button class="btn sm danger" data-act="lv-pos" data-v="deny">Deny</button>' : "";
      if (late && decide) note = "After the deadline only a commissioner approves a change.";
    }
    else if (o && a.type === "forfeit_appeal") { if (may("forfeit-appeal")) decide = '<button class="btn sm" data-act="lv-ffa" data-v="overturn">Overturn the forfeit</button><button class="btn sm danger" data-act="lv-ffa" data-v="deny">Deny the appeal</button>'; else note = "Only a commissioner decides a forfeit appeal (Rule 5.2)."; }
    else if (o && a.type === "appeal") { if (may("appeal", a)) decide = '<button class="btn sm secondary" data-act="resolve">' + S2.ic("check") + "Resolve" + k("E") + '</button><button class="btn sm danger" data-act="deny">Deny</button>';
      else if (rule) note = LV.flip && staffRole(a.filer) ? "An appeal by a member of league staff is decided by a commissioner (Rule 7.6)." : LV.flip ? "A committee manager or a commissioner decides an appeal (Rule 7.6)." : "The " + (a.dept === "community" ? "community" : "officiating") + " department or a commissioner decides this appeal (Rule 7.6)."; }
    else if (o && rule) decide = '<button class="btn sm secondary" data-act="resolve">' + S2.ic("check") + "Resolve" + k("E") + '</button><button class="btn sm danger" data-act="deny">Deny</button>';
    /* after the flip a staffer who manages no committee warns from the case, and files a suspension request for anything more */
    var disc = o && rule && a.type === "complaint" ? (may("suspend") || may("warn") ? '<button class="btn sm plain" data-act="lv-disc">Issue discipline</button>' : "") +
      (may("request") ? '<button class="btn sm plain" data-act="lv-disc-req">Request a suspension</button>' : "") : "";
    /* assign_case sets who has it and nothing else; "in review" is its own update, as on the current site (Mark reviewing) */
    var review = o && rule && c.status === "open" ? '<button class="btn sm secondary" data-act="lv-review">Mark in review</button>' : "";
    var bar = o && rule ? '<div class="dk-toolbar" role="toolbar" aria-label="Case actions"><button class="btn sm' + (mine ? " secondary" : "") + '" data-act="claim">' + (mine ? "Release" : "Claim") + k("C") + "</button>" + review +
      (LV.staff.length ? '<span class="dk-popwrap"><button class="btn sm secondary" data-act="assign" aria-haspopup="menu" aria-expanded="false">Assign' + S2.chev().replace('class="chev"', 'class="chev dk-down"') + "</button></span>" : "") + decide + disc + "</div>" : "";
    if (o && !rule) note = "You filed this case or you are named in it, so another official rules on it. You can still reply as a participant.";
    var s = STATUS[c.status] || [c.status, ""];
    return '<div class="dk-mdetail-in" data-lv-case="' + esc(c.id) + '"><button class="dk-back" data-act="case-back">' + S2.ic("back") + "Cases</button>" +
      '<div class="dk-dh-top"><span class="num t-foot">#' + esc(String(c.id).slice(0, 8)) + '</span><span class="chip">' + esc(c.typeLabel) + '</span><span class="dk-status ' + s[1] + '" data-swap="status">' + esc(s[0]) + "</span></div>" +
      '<h3 class="t-title2 dk-dh-title" id="dkCaseH" tabindex="-1">' + esc(c.title) + "</h3>" + bar +
      (note ? '<p class="t-foot dk-lv-note">' + ic("lock") + esc(note) + "</p>" : "") + (!o ? '<p class="t-foot dk-final">' + ic("lock") + (c.status === "resolved" ? "Resolved" : "Denied") + " cases are final.</p>" : "") +
      '<dl class="dk-meta"><dt>Filed</dt><dd>' + esc(ago(a.created_at)) + " by " + esc(c.filer) + "</dd>" + (a.about || a.target ? "<dt>About</dt><dd>" + esc(nameOf(a.about, a.target)) + "</dd>" : "") +
      (a.type === "position_change" ? "<dt>Asks for</dt><dd>" + esc((a.current_position || "?") + " to " + (a.requested_position || "?")) + "</dd>" : "") +
      "<dt>Committee</dt><dd>" + esc(comName(c.c)) + '</dd><dt>Claimed by</dt><dd data-swap="claimant">' + (c.claimant ? esc(c.claimant) : '<span class="muted">Nobody yet</span>') + "</dd></dl>" +
      '<p class="dk-private">' + ic("lock") + "Private filing</p>" + (a.details ? '<p class="dk-lv-details">' + esc(a.details) + "</p>" : "") +
      (a.response ? '<div class="dk-lv-stmt"><p class="t-cap">' + (o ? "Earlier decision statement" : "Final decision statement") + '</p><p class="dk-lv-details">' + esc(a.response) + "</p></div>" : "") +
      '<h4 class="t-cap dk-mt">Conversation</h4><div id="dkLvConv">' + lvThread(c) + "</div>" + lvComposer(c) + "</div>";
  }
  /* after a confirmed case write: the case list and this case's conversation again, then the list and detail in place */
  function lvAfterCase(id, msg) {
    if (msg) S2.toast(msg, "ok");
    return Promise.all([loadCases(), loadMsgs(id)]).then(function () {
      var gone = !caseScope(st.scope).some(function (x) { return x.id === id; });
      if (gone) { var next = caseScope(st.scope)[0]; st.caseId = next ? next.id : null; }
      repaintCases(false, { changed: id, gone: gone ? id : null });
      syncCounts();
    }, function (e) { S2.toast("Saved. The case list could not be read again: " + e.message, "err"); });
  }
  function lvOpenThread(c) {
    if (!c || LV.msgs[c.id] !== undefined) return;
    loadMsgs(c.id).then(null, function (e) { console.error("Staff Desk: the conversation could not be read", e); }).then(function () {
      var box = $("#dkLvConv"), d = $('[data-lv-case="' + c.id + '"]');
      if (box && d) box.innerHTML = lvThread(c);
    });
  }
  function lvCaseAct(act, kb, arg) {
    var c = caseById(st.caseId); if (!c || !isOpen(c)) return;
    var a = c.raw;
    if (act === "claim" || act === "assign") {
      if (!may("rule", a)) return;
      var to = act === "claim" ? (c.claimantId === myId() ? null : myId()) : arg;
      if (act === "assign" && to === c.claimantId) return;
      var b = $('#dkCaseDetail [data-act="' + (act === "claim" ? "claim" : "assign") + '"]'); busyBtn(b, true, act === "claim" ? "Saving…" : "Assigning…");
      S2.write("assign_case", { p_request: a.id, p_assignee: to }).then(function () {
        return lvAfterCase(a.id, to === null ? "Released back to the queue" : to === myId() ? "Case claimed: it is yours" : "Assigned to " + (staffName(to) || "a colleague"));
      }, function (e) { busyBtn(b, false); S2.toast(e.message, "err"); });
      return;
    }
    if (act === "review") {
      if (!may("rule", a) || c.status !== "open") return;
      var rb = $('#dkCaseDetail [data-act="lv-review"]'); busyBtn(rb, true);
      /* not a decision, so no statement (guard_decision_statement allows a status move that leaves the response alone) */
      S2.write("action_requests.update", { set: { status: "reviewing", updated_at: new Date().toISOString() }, match: { id: a.id } }).then(function () {
        return lvAfterCase(a.id, "Case marked in review");
      }, function (e) { busyBtn(rb, false); S2.toast(e.message, "err"); });
      return;
    }
    if (act === "resolve" || act === "deny") {
      var ok = act === "resolve";
      if (!(a.type === "appeal" ? may("appeal", a) : a.type !== "position_change" && a.type !== "forfeit_appeal" && may("rule", a))) return;
      writeSheet({ title: (ok ? "Resolve" : "Deny") + " this " + c.typeLabel.toLowerCase(), ok: ok ? "Resolve" : "Deny", danger: !ok, busy: ok ? "Resolving…" : "Denying…",
        html: stmtField("The member who filed sees this on the case and in the notice that tells them of the decision. The case closes as final."),
        read: readStmt,
        run: function (t) { return S2.write("action_requests.update", { set: { status: ok ? "resolved" : "denied", response: t, updated_at: new Date().toISOString() }, match: { id: a.id } }); },
        done: function () { lvAfterCase(a.id, "Case " + (ok ? "resolved" : "denied")); } });
    }
  }
  function lvDecidePos(v) {
    var c = caseById(st.caseId); if (!c || !isOpen(c) || !may("position", c.raw)) return;
    if (v === "approve" && posClosed() && !(LV.G || {}).commish) return;   /* after the deadline only a commissioner approves (decide_position_change) */
    var a = c.raw, ok = v === "approve", line = (a.current_position || "?") + " to " + (a.requested_position || "?");
    writeSheet({ title: ok ? "Approve this position change" : "Deny this position change", ok: ok ? "Approve the change" : "Deny the request", danger: !ok,
      why: ok ? "Their registration changes to the requested position (" + line + ") and the case closes." : "The registration stays as it is and the case closes as denied.",
      html: stmtField("They see this on the request and in the notice that tells them of the decision."), read: readStmt,
      run: function (t) { return S2.write("decide_position_change", { p_request: a.id, p_approve: ok, p_note: t }, { sections: ["signups", "rosters"] }); },
      done: function () { lvAfterCase(a.id, ok ? "Approved: their registration is updated" : "Request denied"); } });
  }
  function lvDecideFfa(v) {
    var c = caseById(st.caseId); if (!c || !isOpen(c) || !may("forfeit-appeal")) return;
    var a = c.raw, over = v === "overturn";
    writeSheet({ title: over ? "Overturn the forfeit" : "Deny the appeal", ok: over ? "Overturn" : "Deny", danger: !over,
      why: over ? "The forfeit is cleared and the result as played stands. Both clubs and the scores channel are told." : "The forfeit stands. The club is told, with your statement.",
      html: stmtField(over ? "Both clubs' front offices see this in their notices." : "The club's Owner, GM and AGM see this on the appeal and in their notices."), read: readStmt,
      run: function (t) { return S2.write("decide_forfeit_appeal", { p_request: a.id, p_overturn: over, p_response: t }, { sections: ["games", "ratings"] }); },
      done: function () { lvAfterCase(a.id, over ? "Overturned: the result as played stands" : "Appeal denied: the forfeit stands"); } });
  }
  function lvReply() {
    var c = caseById(st.caseId); if (!c) return;
    var inp = $("#dkLvReply"), body = inp ? inp.value.trim() : "", inEl = $("#dkLvInternal"), internal = !!(inEl && inEl.checked), err = $("#dkLvReplyErr"), b = $('[data-act="lv-reply"]');
    if (!body) { if (err) err.textContent = "Write the reply first."; if (inp) inp.focus(); return; }
    if (b && b.getAttribute("aria-busy") === "true") return;
    busyBtn(b, true, "…");
    S2.write("action_messages.insert", { row: { request_id: c.id, author_id: myId(), body: body, internal: internal } }).then(function () {
      st.lvDraft = null;
      S2.toast(internal ? "Staff-only note added" : "Reply sent", "ok");
      return loadMsgs(c.id).then(function () {
        var d = $("#dkCaseDetail"); if (d && $('[data-lv-case="' + c.id + '"]', d)) { d.innerHTML = lvCaseDetail(c); var ni = $("#dkLvReply"); if (ni) ni.focus({ preventScroll: true }); }
      }, function (e) { S2.toast("Sent. The conversation could not be read again: " + e.message, "err"); });
    }, function (e) { busyBtn(b, false); if (err) err.textContent = e.message; });
  }

  /* -------- DISCIPLINE: the member record, the forms, the requests -------- */
  function recWhat(r) {
    return r.mode === "warning" ? "Formal warning" : r.mode === "games" ? r.games_total + "-game suspension" + (r.games_served != null ? " (" + r.games_served + " served)" : "")
      : r.mode === "seasons" ? "Suspension through Season " + r.until_season : r.mode === "date" ? "Suspension through " + M.etDate(r.ends_at) : r.mode;
  }
  function lvRunning(pid) { var R0 = LV.rec[pid]; return R0 && R0.rows ? R0.rows.filter(function (r) { return r.mode !== "warning" && r.running && r.status === "active" && r.grounds !== "departure"; })[0] || null : null; }
  function lvDiscBody(p) {
    var R0 = LV.rec[p.id];
    if (!LV.G) return stateBox("muted", "Loading", "Reading what this account may do.");
    if (R0 === undefined) return '<div class="dk-ps" data-lv-rec="' + esc(p.id) + '">' + stateBox("muted", "Loading the record", "Reading every warning and suspension on file.") + "</div>";
    if (R0.err) return '<div class="dk-ps" data-lv-rec="' + esc(p.id) + '">' + stateBox("err", "The record did not load", esc(R0.err) + " An empty record here would not mean a clean one.", '<button type="button" class="btn sm secondary" data-lv-tool="reload" data-pid="' + esc(p.id) + '">Try again</button>') + "</div>";
    var run = lvRunning(p.id), rows = R0.rows, canSusp = may("suspend"), cm = (LV.G || {}).commish;
    var rec = rows.length ? '<ol class="dk-tl dk-lv-rec">' + rows.map(function (r) {
      var live0 = r.status === "active" && (r.mode === "warning" || r.running);
      var lift = live0 && (canSusp || (r.mode === "warning" && LV.flip && r.created_by === myId())) ? '<button type="button" class="btn sm secondary" data-lv-tool="lift" data-id="' + esc(r.id) + '">' + (r.mode === "warning" ? "Withdraw" : "Lift") + "</button>" : "";
      /* a committee manager has both: Extend inside their limits, Request an extension past them */
      var ext = r.mode !== "warning" && r.running && r.mode !== "seasons" && r.status === "active" ? (canSusp ? '<button type="button" class="btn sm secondary" data-lv-tool="extend" data-id="' + esc(r.id) + '">Extend</button>' : "") +
        (may("request") ? '<button type="button" class="btn sm secondary" data-lv-tool="extend-request" data-id="' + esc(r.id) + '">Request an extension</button>' : "") : "";
      return '<li><span class="dk-tl-dot"></span><span class="title">' + esc(recWhat(r)) + '</span><span class="t-foot">' + esc([r.status === "active" ? (r.mode === "warning" ? "On record" : r.running ? "In force" : "Not running") : r.status === "lifted" ? "Lifted" : r.status, M.etDate(r.created_at), r.reason].filter(Boolean).join(" · ")) +
        "</span>" + (lift || ext ? '<span class="dk-lv-acts">' + ext + lift + "</span>" : "") + "</li>";
    }).join("") + "</ol>" : '<p class="t-foot">No warning or suspension on file.</p>';
    var tools = [];
    if (may("warn")) tools.push(["Warn", "warn", "A formal warning on their record; it is not a suspension."]);
    if (!run) { /* one suspension at a time (Rule 7.2): a member already serving one is extended, never suspended twice */
      /* the limits _issue_suspension holds: 18 games either side of the flip; 30 days before it, 14 after (and longer is
         applied for through a request instead of going to the commissioner's office) */
      var past = LV.flip ? "longer is applied for." : "longer goes to the commissioner's office.";
      if (canSusp) tools.push(p.rostered ? ["Suspend for games", "games", cm ? "Any length, in games." : "In steps of three games, up to 18; " + past] : ["Suspend until a date", "date", cm ? "To any last day." : "Up to " + (LV.flip ? 14 : 30) + " days; " + past]);
      if (canSusp && cm) tools.push(["Suspend through a season", "seasons", "A commissioner's ruling."]);
      if (may("request")) tools.push(["Request a suspension", "request", canSusp ? "Longer than you may issue, or through a season: a commissioner approves it (Rule 7.2)." : "A committee manager or a commissioner acts on it (Rule 7.2)."]);
    }
    if (may("ban")) tools.push(R0.banned ? ["Lift the ban", "unban", "They regain access to the league."] : ["Ban", "ban", "Removes them from every roster, seat and sign-up (Rule 7.2)."]);
    return '<div class="dk-ps" data-lv-rec="' + esc(p.id) + '">' + (R0.banned ? '<p class="dk-private">' + ic("lock") + "Banned" + (R0.why ? ": " + esc(R0.why) : "") + "</p>" : "") +
      '<p class="t-cap">On record</p>' + rec + (run ? '<p class="t-foot dk-mt">They are serving a suspension now, so another one extends it (one suspension at a time, Rule 7.2).</p>' : "") +
      (tools.length ? '<p class="t-cap dk-mt">Tools</p><div class="list dk-tools">' + tools.map(function (t) {
        return '<div class="row"><span class="grow"><span class="title">' + esc(t[0]) + '</span><span class="sub">' + esc(t[2]) + '</span></span><button type="button" class="btn sm ' + (t[1] === "ban" ? "danger" : "secondary") + '" data-lv-tool="' + t[1] + '" data-pid="' + esc(p.id) + '">' + esc(t[0].split(" ")[0]) + "</button></div>";
      }).join("") + "</div>" : '<p class="t-foot dk-mt">The league gives this account no discipline tools.</p>') + "</div>";
  }
  function lvPaintRecord(pid) {
    var ps = st.psheet; if (!ps || ps.p.id !== pid || ps.tab !== "discipline" || !ps.sh.el.isConnected) return;
    var b = $("#dkPsBody", ps.sh.el); if (b) b.innerHTML = lvDiscBody(ps.p);
  }
  function lvRecord(pid) { return loadRecord(pid).then(null, function (e) { console.error("Staff Desk: the discipline record could not be read", e); }).then(function () { lvPaintRecord(pid); }); }
  var DSECTIONS = ["suspensions", "rosters", "signups", "teams"];
  function lvAfterDisc(pid, msg, extra) {
    S2.toast(msg, "ok");
    return Promise.all([pid ? loadRecord(pid) : null, LV.flip ? loadReqs() : null, rpcRd("s2_desk").then(function (d) { LV.desk = d || LV.desk; })].concat(extra || [])).then(function () {
      if (pid) lvPaintRecord(pid);
      var dc = $("#dkDiscCard"); if (dc) { var keep = R; R = ""; dc.outerHTML = discCard(); R = keep; }
      syncCounts();
    }, function (e) { S2.toast("Saved. The record could not be read again: " + e.message, "err"); });
  }
  function gamesField(id, label, min) {
    return '<label class="dk-a-lbl" for="' + id + '">' + esc(label) + '<span class="t-foot">In steps of three</span></label><input class="input dk-lv-num" id="' + id + '" type="number" inputmode="numeric" min="' + (min || 3) + '" step="3" value="3">';
  }
  function dateField(id, label) { return '<label class="dk-a-lbl" for="' + id + '">' + esc(label) + '<span class="t-foot">Through 11:59 PM ET</span></label><input class="input" id="' + id + '" type="date">'; }
  function reasonField(req) { return '<label class="dk-a-lbl" for="dkLvWhy">Grounds<span class="t-foot">' + (req ? "Required. " : "") + 'The member and league staff see them</span></label><textarea class="input" id="dkLvWhy" rows="3" placeholder="What happened, and the rule it breaks"></textarea>'; }
  function memberPick(pid) {
    if (pid) return "";
    var opts = M.players.filter(function (p) { return p.id; }).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.tag) + "</option>"; }).join("");
    return '<label class="dk-a-lbl" for="dkLvWho">Member</label><select class="input" id="dkLvWho"><option value="">Choose the member</option>' + opts + "</select>";
  }
  function val(el, id) { var x = $("#" + id, el); return x ? x.value : ""; }
  /* the length the form names, in the doors' own arguments (CG.readDisciplineLength); a missing part is said, never skipped */
  function readLength(el, kind, err) {
    var o = { p_mode: kind, p_games: null, p_ends_at: null, p_until_season: null };
    if (kind === "games") { var g = parseInt(val(el, "dkLvGames"), 10); if (!(g >= 1)) { err("Enter how many games."); return null; } o.p_games = g; }
    if (kind === "date") { var d = val(el, "dkLvDate"); if (!d) { err("Pick the last day."); return null; } o.p_ends_at = S2.CG.etISO(d, "23:59"); }
    if (kind === "seasons") { var s = parseInt(val(el, "dkLvSeason"), 10); if (!(s >= 1)) { err("Enter the final season."); return null; } o.p_until_season = s; }
    return o;
  }
  /* one discipline form for every kind: o = { pid, kind: warn|games|date|seasons|request|extend|extend-request, caseId, susp } */
  function lvDiscSheet(o) {
    var p = o.pid ? M.player(o.pid) : null, who = p ? p.tag : null, kind = o.kind, fromCase = !!o.caseId, s0 = o.susp;
    var pick = fromCase && kind !== "request";   /* from a case the sanction is chosen in the form (CG.caseDisciplineModal) */
    var title = { warn: "Formal warning", games: "Suspend for games", date: "Suspend until a date", seasons: "Suspend through a season", request: "Request a suspension", extend: "Extend the suspension", "extend-request": "Request an extension" }[kind];
    var fields = memberPick(o.pid);
    if (kind === "request") fields += '<label class="dk-a-lbl" for="dkLvMode">Suspension</label><select class="input" id="dkLvMode"><option value="games">Games</option><option value="date">To a date</option><option value="seasons">Through a season</option></select>' +
      gamesField("dkLvGames", "Games") + dateField("dkLvDate", "Last day") + '<label class="dk-a-lbl" for="dkLvSeason">Final season</label><input class="input dk-lv-num" id="dkLvSeason" type="number" min="1" value="' + esc(curSeasonNo()) + '">';
    if (kind === "games" && !pick) fields += gamesField("dkLvGames", "Games");
    if (kind === "date" && !pick) fields += dateField("dkLvDate", "Last day");
    if (kind === "seasons" && !pick) fields += '<label class="dk-a-lbl" for="dkLvSeason">Final season</label><input class="input dk-lv-num" id="dkLvSeason" type="number" min="1" value="' + esc(curSeasonNo()) + '">';
    /* an extension is in the running suspension's own terms (Rule 7.2: one suspension at a time) */
    if (kind === "extend" || kind === "extend-request") fields += s0.mode === "games" ? gamesField("dkLvGames", "Games to add") : dateField("dkLvDate", "New last day (after " + M.etDate(s0.ends_at) + ")");
    if (pick) fields += '<label class="dk-a-lbl" for="dkLvKind">Sanction</label><select class="input" id="dkLvKind">' + [["warn", "Formal warning", may("warn")], ["games", "Games", may("suspend")], ["date", "To a date", may("suspend")], ["seasons", "Through a season", (LV.G || {}).commish]]
      .filter(function (x) { return x[2]; }).map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === kind ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select>" +
      gamesField("dkLvGames", "Games") + dateField("dkLvDate", "Last day") + '<label class="dk-a-lbl" for="dkLvSeason">Final season</label><input class="input dk-lv-num" id="dkLvSeason" type="number" min="1" value="' + esc(curSeasonNo()) + '">';
    var reqWhy = kind === "request" || kind === "extend-request" || kind === "extend";
    fields += reasonField(reqWhy);
    /* Rule 7.2 paragraph 3: a second suspension in a season runs for the rest of it unless the official sets a shorter
       length; the database takes that choice as p_keep_length (after the flip a committee manager must keep the length or
       ask a commissioner for the rest of the season) */
    var keep = kind === "games" || kind === "date" || pick;
    if (keep) fields += '<label class="dk-lv-check" data-lv-keep><input type="checkbox" id="dkLvKeep"' + (LV.flip && !(LV.G || {}).commish ? " checked" : "") + "> If this is their second suspension this season, keep the length set here</label>";
    if (pick) fields += stmtField("The member who filed sees this on the case. Leave out the sanction and its grounds: Rule 7.2 shows those only to the member disciplined and league staff.");
    var ask = function (el) { return el ? $("#dkLvKind", el) : null; };
    function showFor(el) {
      var k = kind === "request" ? val(el, "dkLvMode") : ask(el) ? ask(el).value : kind;
      if (kind === "extend" || kind === "extend-request") return;
      [["dkLvGames", "games"], ["dkLvDate", "date"], ["dkLvSeason", "seasons"]].forEach(function (x) {
        var f = $("#" + x[0], el); if (!f) return; var on = k === x[1]; f.hidden = !on; var l = $('label[for="' + x[0] + '"]', el); if (l) l.hidden = !on; });
      var kp = $("[data-lv-keep]", el); if (kp) kp.hidden = !(k === "games" || k === "date");
    }
    return writeSheet({ title: title + (who ? ": " + who : ""), ok: kind === "request" || kind === "extend-request" ? "File the request" : kind === "warn" ? "Issue the warning" : title, danger: kind !== "warn" && kind !== "request" && kind !== "extend-request",
      why: kind === "request" ? (may("suspend") ? "Anything past 14 days or 18 games, or through a season, is applied for: a commissioner approves it, with your grounds (Rule 7.2)." : "Only a committee manager or a commissioner suspends a member. Your request goes to them with your grounds (Rule 7.2).")
        : kind === "extend-request" ? "They are serving a suspension, so this asks to extend it, in its own terms. " + (may("suspend") ? "Past your limits a commissioner decides it (Rule 7.2)." : "A committee manager or a commissioner decides it (Rule 7.2).")
        : pick ? "This resolves the case, tells the member disciplined (with appeal instructions, Chapter 7) and posts to the staff channel." : "The member is told at once, with their right to appeal (Rule 7.6).",
      html: '<div class="dk-lv-form">' + fields + "</div>", busy: "Saving…",
      mounted: function (el) { showFor(el); el.addEventListener("change", function (e) { if (e.target.id === "dkLvKind" || e.target.id === "dkLvMode") showFor(el); }); },
      read: function (el, err) {
        var pid = o.pid || val(el, "dkLvWho"); if (!pid && !s0) { err("Choose the member."); return null; }
        var why = val(el, "dkLvWhy").trim();
        if (reqWhy && !why) { err("Write the grounds: the member is told the reason (Rule 7.6)."); return null; }
        if (kind === "extend" || kind === "extend-request") {
          var add = { p_games: null, p_days: null, p_ends_at: null };
          if (s0.mode === "games") { var g = parseInt(val(el, "dkLvGames"), 10); if (!(g >= 1)) { err("Enter how many games to add."); return null; } add.p_games = g; }
          else { var d = val(el, "dkLvDate"); if (!d) { err("Pick the new last day."); return null; } add.p_ends_at = S2.CG.etISO(d, "23:59");
            add.p_days = Math.round((Date.parse(d + "T12:00:00Z") - Date.parse(S2.CG.etYMD(s0.ends_at) + "T12:00:00Z")) / 864e5);
            if (!(add.p_days >= 1)) { err("Pick a last day after " + M.etDate(s0.ends_at) + "."); return null; } }
          return Object.assign({ pid: s0.profile_id, why: why }, add);
        }
        var k = kind === "request" ? val(el, "dkLvMode") : ask(el) ? ask(el).value : kind;
        var len = k === "warn" ? { p_mode: "warning", p_games: null, p_ends_at: null, p_until_season: null } : readLength(el, k, err); if (!len) return null;
        var stmt = null; if (pick) { stmt = readStmt(el, err); if (!stmt) return null; }
        var kp = $("#dkLvKeep", el);
        return { pid: pid, why: why, len: len, keep: !!(kp && !kp.closest("[hidden]") && kp.checked), stmt: stmt };
      },
      run: function (x) {
        if (kind === "extend") return S2.write("extend_suspension", { p_id: s0.id, p_games: x.p_games, p_days: x.p_days, p_reason: x.why || null }, { sections: ["suspensions"] });
        if (kind === "extend-request") return S2.write("request_suspension", { p_profile: x.pid, p_mode: s0.mode, p_games: x.p_games, p_ends_at: x.p_ends_at, p_until_season: null, p_reason: x.why, p_codes: null, p_scope: s0.scope || "play", p_case: o.caseId || null });
        if (kind === "request") return S2.write("request_suspension", Object.assign({ p_profile: x.pid, p_reason: x.why || null, p_codes: null, p_scope: "play", p_case: o.caseId || null }, x.len));
        if (pick) return S2.write("discipline_from_case", Object.assign({ p_request: o.caseId, p_profile: x.pid, p_reason: x.why || null, p_codes: null, p_scope: "play", p_keep_length: x.keep, p_statement: x.stmt }, x.len), { sections: DSECTIONS });
        return S2.write("suspend_player", Object.assign({ p_profile: x.pid, p_reason: x.why || null, p_codes: null, p_scope: "play", p_keep_length: x.keep }, x.len), { sections: DSECTIONS });
      },
      done: function (res, x) {
        var d = res && res.data, ext = d && typeof d === "object" && d.extends;
        var msg = kind === "extend" ? "Suspension extended" : kind === "request" || kind === "extend-request" ? (ext ? "Extension request filed: a committee manager or a commissioner decides it" : "Suspension request filed: a committee manager or a commissioner decides it")
          : x.len.p_mode === "warning" ? "Formal warning issued" : "Suspension issued";
        if (pick) { lvAfterDisc(x.pid, msg + ". The case is resolved."); lvAfterCase(o.caseId, null); return; }
        lvAfterDisc(x.pid || (s0 && s0.profile_id), msg);
      },
      /* after the flip a committee manager's refusal names the way on, and the sheet offers it in one tap, from what the
         form holds: a second suspension in a season (keep the length, or ask a commissioner for the rest of the season), and
         anything past their limits, a suspension or an extension ("Anything longer is applied for", the flip's
         _issue_suspension and extend_suspension), which is filed as a request in the same terms */
      failed: function (e, el, x) {
        if (!LV.flip || !x || $("[data-lv-apply]", el)) return;
        var m = e.message || "", req = null;
        if (x.len && /already suspended this season/i.test(m)) req = { label: "Ask a commissioner for the rest of the season", done: "Request filed: a commissioner decides the rest of the season",
          terms: { p_mode: "seasons", p_games: null, p_ends_at: null, p_until_season: curSeasonNo() } };
        else if (/is applied for/i.test(m) && kind === "extend") req = { label: "Apply for this extension", done: "Extension request filed: a commissioner decides it",
          terms: { p_mode: s0.mode, p_games: x.p_games, p_ends_at: s0.mode === "date" ? x.p_ends_at : null, p_until_season: null } };
        else if (/is applied for/i.test(m) && x.len && x.len.p_mode !== "warning") req = { label: "Apply for these terms", done: "Suspension request filed: a commissioner decides it", terms: x.len };
        if (!req) return;
        var b = document.createElement("button"); b.type = "button"; b.className = "btn sm secondary"; b.setAttribute("data-lv-apply", ""); b.textContent = req.label;
        b.addEventListener("click", function () {
          busyBtn(b, true, "Filing…");
          S2.write("request_suspension", Object.assign({ p_profile: x.pid, p_reason: x.why || null, p_codes: null, p_scope: kind === "extend" ? s0.scope || "play" : "play", p_case: o.caseId || null }, req.terms)).then(function () {
            var shEl = b.closest(".sheet"); var cl = shEl && $("[data-close]", shEl); if (cl) cl.click();
            lvAfterDisc(x.pid, req.done);
          }, function (e2) { busyBtn(b, false); var er = $("[data-lv-err]", el); if (er) er.textContent = e2.message; });
        });
        var er = $("[data-lv-err]", el); if (er) er.parentNode.insertBefore(b, er.nextSibling);
      } });
  }
  function lvTool(t, pid, id) {
    var R0 = LV.rec[pid || ""] || null, row = null;
    if (id) Object.keys(LV.rec).forEach(function (k) { (LV.rec[k].rows || []).forEach(function (r) { if (r.id === id) { row = r; pid = r.profile_id; } }); });
    if (t === "reload") { delete LV.rec[pid]; lvPaintRecord(pid); lvRecord(pid); return; }
    if (st.psheet) st.psheet.sh.close();   /* every tool's form replaces the record, as every Issue door does (one sheet at a time) */
    if (t === "warn" || t === "games" || t === "date" || t === "seasons" || t === "request") { if (st.psheet) st.psheet.sh.close(); lvDiscSheet({ pid: pid, kind: t }); return; }
    if ((t === "extend" || t === "extend-request") && row) { if (st.psheet) st.psheet.sh.close(); lvDiscSheet({ pid: pid, kind: t, susp: row }); return; }
    if (t === "lift" && row) {
      writeSheet({ title: row.mode === "warning" ? "Withdraw this warning?" : "Lift this suspension?", ok: row.mode === "warning" ? "Withdraw" : "Lift", danger: true, why: recWhat(row) + ". The member is told at once.",
        read: function () { return {}; }, run: function () { return S2.write("lift_suspension", { p_id: row.id }, { sections: DSECTIONS }); },
        done: function () { lvAfterDisc(pid, row.mode === "warning" ? "Warning withdrawn" : "Suspension lifted"); } });
      return;
    }
    if (t === "ban") {
      var p = M.player(pid);
      writeSheet({ title: "Ban " + (p ? p.tag : "this member") + "?", ok: "Ban", danger: true, why: "They leave every roster, seat and sign-up for a season not yet completed, and lose access to the league (Rule 7.2).",
        html: reasonField(true), read: function (el, err) { var w = val(el, "dkLvWhy").trim(); if (!w) { err("Write the grounds for the ban."); return null; } return { why: w }; },
        run: function (x) { return S2.write("ban_player", { p_profile: pid, p_reason: x.why }, { sections: DSECTIONS }); }, done: function () { lvAfterDisc(pid, "Ban issued"); } });
      return;
    }
    if (t === "unban") {
      writeSheet({ title: "Lift the ban?", ok: "Lift the ban", why: "They regain access to the league. Rosters, seats and sign-ups are not restored by this (the office does that).",
        read: function () { return {}; }, run: function () { return S2.write("unban_player", { p_profile: pid }, { sections: ["people"] }); }, done: function () { lvAfterDisc(pid, "Ban lifted"); } });
    }
  }
  /* the suspension requests waiting on a decision (the flip's suspension_requests; none before it) */
  function reqWhat(q) {
    var who = nameOf(q.member, "A member");
    if (q.extends_id) return "Extend " + who + "'s suspension by " + (q.mode === "games" ? q.games + " games" : q.days + " days, through " + M.etDate(q.ends_at));
    return who + ": " + (q.mode === "games" ? q.games + " games" : q.mode === "date" ? "through " + M.etDate(q.ends_at) : "through Season " + q.until_season);
  }
  function lvWaiting() {
    var L = LV.reqs || []; if (!L.length) return "";
    return '<div class="dk-rows dk-hair dk-wait" id="dkDiscWait"><p class="t-cap">Waiting</p>' + L.map(function (q) {
      var dec = may("decide-request", q), mine = q.filed_by === myId();
      return '<div class="row dk-wait-r" data-wait="' + esc(q.id) + '"><span class="grow"><span class="title">' + esc(reqWhat(q)) + '</span><span class="sub">' + esc(["Filed by " + nameOf(q.filer, "a staff member"), ago(q.created_at), q.reason].filter(Boolean).join(" · ")) + "</span></span>" +
        '<span class="dk-wait-b">' + (dec ? '<button class="btn sm" data-lv-req="approve" data-id="' + esc(q.id) + '">Approve</button><button class="btn sm secondary" data-lv-req="deny" data-id="' + esc(q.id) + '">Deny</button>' : "") +
        (mine ? '<button class="btn sm plain" data-lv-req="withdraw" data-id="' + esc(q.id) + '">Withdraw</button>' : "") + "</span></div>";
    }).join("") + "</div>";
  }
  function lvReq(act, id) {
    var q = (LV.reqs || []).filter(function (x) { return x.id === id; })[0]; if (!q) return;
    if (act === "withdraw") {
      writeSheet({ title: "Withdraw this request?", ok: "Withdraw", why: reqWhat(q) + ".", read: function () { return {}; },
        run: function () { return S2.write("withdraw_suspension_request", { p_id: id }); }, done: function () { lvAfterDisc(null, "Request withdrawn"); } });
      return;
    }
    var ok = act === "approve";
    writeSheet({ title: ok ? "Approve this request?" : "Deny this request?", ok: ok ? "Approve" : "Deny", danger: !ok,
      why: ok ? reqWhat(q) + ". It takes effect at once, exactly as requested, and the member is told with their right to appeal." : reqWhat(q) + ". The staff member who filed it is told why.",
      html: '<label class="dk-a-lbl" for="dkLvNote">' + (ok ? "Note (optional)" : "Why it is denied") + '</label><textarea class="input" id="dkLvNote" rows="3"></textarea>',
      read: function (el, err) { var n = val(el, "dkLvNote").trim(); if (!ok && !n) { err("Say why it is denied: the staff member who filed it is told."); return null; } return { note: n || null }; },
      run: function (x) { return S2.write("decide_suspension_request", { p_id: id, p_approve: ok, p_note: x.note }, { sections: ok ? DSECTIONS : [] }); },
      done: function () { lvAfterDisc(q.profile_id, ok ? (q.extends_id ? "Approved: the suspension is extended" : "Approved: the suspension is in force") : "Request denied"); } });
  }

  /* -------- APPLICATIONS -------- */
  function lvAllBallots(a) { return (LV.ballots || []).filter(function (b) { return b.app_type === a.type && b.application_id === a.uuid; }); }
  /* v4.22 ("Fresh vote", commissioner 2026-10-19): the ballots that COUNT are the ones cast or changed since the application
     was last filed (filed_at), exactly as resolve_application_if_ready counts them; older ones stay on the roll, marked.
     Management nominations and committee seats have no filed_at, so every ballot counts. The one reader for the tally,
     "you voted", "your ballot" and what waits on a ballot (CG.appCountingBallots on the current site) */
  function lvCounts(a, b) { var f = a.row.filed_at ? Date.parse(a.row.filed_at) : 0; return !f || Date.parse(b.updated_at) >= f; }
  function lvBallots(a) { return lvAllBallots(a).filter(function (b) { return lvCounts(a, b); }); }
  function lvMine(a) { return lvBallots(a).filter(function (b) { return b.voter_id === myId(); })[0] || null; }
  function lvMineEarlier(a) { return lvAllBallots(a).filter(function (b) { return b.voter_id === myId() && !lvCounts(a, b); })[0] || null; }
  /* the electorate is the database's: staff_voter_count() decides a committee seat vote now, and every application once
     the all-staff voting record applies (until then the applications reviewers decide one, a count no member may read) */
  function lvOf(a) { return a.type === "committee" || LV.flip ? LV.voters : null; }
  /* the answers, keyed as the forms ask them (js/flows.js), so the page can never drift from the form */
  function lvAns(a) {
    var r = a.row;
    if (a.type === "owner") return { ea: r.ea_id, avail: r.availability, exp: r.experience, f1: r.preferred_club, f2: r.franchise_2, f3: r.franchise_3, why: r.pitch };
    if (a.type === "staff") return { areas: r.departments || [], avail: r.availability, exp: r.experience, why: r.pitch };
    if (a.type === "committee") return { seat: r.committee_key, why: r.pitch };
    return { why: r.pitch };
  }
  function lvAppX(a) {
    var x = a.x || (a.x = { thread: "app", draft: { app: "", staff: "" }, pick: null, note: null, err: "", hist: [] });
    x.filedH = (Date.now() - Date.parse(a.row.filed_at || a.row.created_at)) / 36e5;
    x.ans = lvAns(a);
    /* the roll: every ballot but this reader's counting one (ballotsOf leads with that), an earlier one marked as not counted */
    var mine0 = lvMine(a);
    x.ballots = lvAllBallots(a).filter(function (b) { return b !== mine0; }).map(function (b) { var my = b.voter_id === myId();
      return { who: my ? myName() : nameOf(b.voter, "A voter"), mine: my, earlier: !lvCounts(a, b), v: b.vote, note: b.note || "", h: (Date.now() - Date.parse(b.updated_at)) / 36e5 }; });
    var L = LV.amsgs[a.id];
    x.msgs = { app: L && !L.err ? L.filter(function (m) { return !m.deleted_at; }).map(function (m) { var off = m.sender_id !== a.profile_id; return { by: off ? "office" : "app", who: off ? nameOf(m.sender, "League office") : a.who, t: m.body || "", h: (Date.now() - Date.parse(m.created_at)) / 36e5 }; }) : [], staff: [] };
    return x;
  }
  function lvAfterApp(a, msg, parts) {
    if (msg) S2.toast(msg, "ok");
    /* qa (nits 11): a committee seat decided by the vote changes public.committees, so the seats are read again with it */
    return (a.type === "committee" ? Promise.all([loadApps(), loadComs()]) : loadApps()).then(function () {
      var n = appById(a.id); if (n && n !== a) { n.x = a.x; }
      repaintApp(parts || ["dkAB", "dkAMine", "dkARoll", "dkAHist"]);
    }, function (e) { S2.toast("Saved. The applications could not be read again: " + e.message, "err"); });
  }
  function lvCast(kb) {
    var a = curApp(); if (!a || !may("vote", a) || a.stage === "decided") return;
    var x = appX(a), mb = lvMine(a), v = x.pick || (mb && mb.vote), inp = $("#dkANote"), note = (inp ? inp.value : x.note || "").trim(), b = $('#dkAMine [data-act="a-cast"]');
    if (!v) { x.err = "Choose Approve or Deny first."; var e0 = $("#dkAErr"); if (e0) e0.textContent = x.err; return; }
    if (mb && mb.vote === v && (mb.note || "") === note) { S2.toast("Your ballot already says that", "ok"); return; }
    busyBtn(b, true, "Saving…");
    S2.write("application_ballots.upsert", { row: { app_type: a.type, application_id: a.uuid, voter_id: myId(), vote: v, note: note || null }, onConflict: "app_type,application_id,voter_id" }, { sections: a.type === "management" ? ["teams", "rosters"] : [] }).then(function () {
      x.pick = null; x.note = null; x.err = "";
      lvAfterApp(a, (mb ? "Ballot updated: " : "Ballot cast: ") + v).then(function () { landOn($("#dkAMineH")); });
    }, function (e) { busyBtn(b, false); x.err = e.message; var e1 = $("#dkAErr"); if (e1) e1.textContent = e.message; });
  }
  function lvRetract() {
    var a = curApp(); if (!a || !lvMine(a)) return;
    writeSheet({ title: "Withdraw your ballot?", ok: "Withdraw", why: "Your vote and your reason come off the record. You may vote again while the application is open.", read: function () { return {}; },
      run: function () { return S2.write("application_ballots.delete", { match: { app_type: a.type, application_id: a.uuid, voter_id: myId() } }); },
      done: function () { lvAfterApp(a, "Ballot withdrawn").then(function () { landOn($("#dkAMineH")); }); } });
  }
  function lvWithdrawCm() {
    var a = curApp(); if (!a || a.type !== "committee" || a.profile_id !== myId() || a.stage !== "ballot") return;
    writeSheet({ title: "Withdraw your application?", ok: "Withdraw", danger: true, why: "The staff stop voting on it, and the ballots cast stay on the record. You may apply again while the seat is open, as a new application voted afresh.", read: function () { return {}; },
      run: function () { return S2.write("withdraw_committee_application", { p_app: a.uuid }).then(function (r) { if (!r.data || !r.data.ok || r.data.status !== "withdrawn") throw new Error("The league did not confirm the withdrawal. Reload the page and check the application."); return r; }); },
      done: function () { lvAfterApp(a, "Application withdrawn").then(function () { landOn($("#dkAMineH")); }); } });
  }
  function lvDecide(v) {
    var a = curApp(); if (!a || a.stage === "decided" || !may("override")) return; var ok = v === "approve";
    writeSheet({ title: ok ? "Approve this application?" : "Deny this application?", ok: ok ? "Approve" : "Deny", danger: !ok,
      why: a.who + "'s " + AKIND[a.kind].toLowerCase() + " is " + (ok ? "approved" : "denied") + " now, without waiting for a majority. Every ballot stays on the record, and " + a.who + " sees the decision, never the votes.",
      read: function () { return {}; }, run: function () { return S2.write("override_application_decision", { p_type: a.type, p_id: a.uuid, p_approve: ok }, { sections: a.type === "management" ? ["teams", "rosters"] : [] }); },
      done: function () { lvAfterApp(a, (ok ? "Approved" : "Denied") + " by commissioner decision").then(function () { landOn($("#dkAMineH")); }); } });
  }
  function lvSend(kb) {
    var a = curApp(); if (!a || !may("app-message", a)) return;
    var x = appX(a), inp = $("#dkAMsg"), t = inp ? inp.value.trim() : "", b = $('[data-act="a-send"]'), err = $("#dkAMsgErr");
    if (!t) { if (err) err.textContent = "Write a message first."; if (inp) inp.focus(); return; }
    busyBtn(b, true, "…");
    S2.write("application_messages.insert", { row: { app_type: a.type, application_id: a.uuid, sender_id: myId(), body: t } }).then(function () {
      x.draft.app = "";
      S2.toast("Sent to " + a.who, "ok");
      return loadAppMsgs(a).then(function () { repaintApp(["dkAConv", "dkAHist"]); var ni = $("#dkAMsg"); if (ni) ni.focus({ preventScroll: true }); }, function (e) { S2.toast("Sent. The conversation could not be read again: " + e.message, "err"); });
    }, function (e) { busyBtn(b, false); if (err) err.textContent = e.message; });
  }
  function lvMountApp() {
    var a = curApp(); if (!a || LV.amsgs[a.id] !== undefined) return;
    loadAppMsgs(a).then(null, function (e) { console.error("Staff Desk: the application's messages could not be read", e); }).then(function () { if (curApp() === a) repaintApp(["dkAConv", "dkAHist"]); });
  }

  /* -------- TODAY, live: what waits, discipline in force and the office's recent work -------- */
  function lvAttention() {
    if (!LV.G || LV.state !== "ready") return [];
    var out = [], oldest = function (L) { return L.length ? Math.max.apply(null, L.map(function (c) { return c.ageHours; })) : null; };
    var open = (LV.cases || []).filter(isOpen), unc = open.filter(function (c) { return !c.claimant; }), held = open.filter(function (c) { return c.claimant; });
    if (unc.length) out.push(Object.assign({ key: "lc", kind: "case", c: "officiating", note: "Nobody is on " + (unc.length === 1 ? "it" : "them") + " yet", href: "#/desk?tab=cases", pane: "cases", ageHours: oldest(unc) }, group(unc.length, "case with nobody on it", "cases with nobody on them")));
    if (held.length) out.push(Object.assign({ key: "lh", kind: "case", c: "officiating", note: "Claimed and in review", href: "#/desk?tab=cases", pane: "cases", ageHours: oldest(held) }, group(held.length, "case in review", "cases in review")));
    var mine = (LV.apps || []).filter(function (a) { return a.stage === "ballot" && may("vote", a) && !lvMine(a) && a.profile_id !== myId(); });
    if (mine.length) out.push(Object.assign({ key: "la", kind: "application", c: "applications", note: "Your ballot is waiting", href: "#/desk?tab=applications", pane: "applications" }, group(mine.length, "application waiting on your ballot", "applications waiting on your ballot")));
    var rq = LV.reqs || [];
    if (rq.length) out.push(Object.assign({ key: "lr", kind: "discipline", c: "officiating", note: "A committee manager or a commissioner decides each one", href: "#/desk", pane: "today" }, group(rq.length, "suspension request waiting", "suspension requests waiting")));
    var gw = gamesWaiting();
    if (gw.length) out.push(Object.assign({ key: "lg", kind: "import", c: "statistics", note: "Held, or no result two hours after puck drop", href: "#/desk?tab=games", pane: "games" }, group(gw.length, "game waiting on the desk", "games waiting on the desk")));
    return out.sort(function (a, b) { return (b.ageHours == null ? -1 : b.ageHours) - (a.ageHours == null ? -1 : a.ageHours); });
  }
  var DISC_SAY = { games: ["suspension counted in games", "suspensions counted in games"], date: ["suspension to a date", "suspensions to a date"], seasons: ["season-long suspension", "season-long suspensions"] };
  /* s2_desk().suspensions is one row per (status, mode, scope): n counts every row in the group and running is a COUNT
     (count(*) filter (where sr.running)), never a flag. In force now is the running count; an active suspension that is
     not running yet (or any more) is on record, not in force (review 2026-11-24: reading n here overcounted it) */
  function lvDiscCounts() {
    var by = {};
    ((LV.desk && LV.desk.suspensions) || []).forEach(function (d) { if (d.status === "active" && d.mode !== "warning") by[d.mode] = (by[d.mode] || 0) + (+d.running || 0); });
    var parts = Object.keys(by).filter(function (k) { return by[k]; }).map(function (k) { var w = DISC_SAY[k] || [k, k]; return by[k] === 1 ? "one " + w[0] : by[k] + " " + w[1]; });
    return parts.length ? parts.join(", ") : "nothing";
  }
  function lvDiscCard() {
    return '<section class="dk-aside-sec dk-disc ' + R + '" id="dkDiscCard" aria-labelledby="dkDiscH">' + secHead({ id: "dkDiscH", k: comName("officiating"), h: "Discipline on record", sm: true,
        p: "In force now: " + esc(lvDiscCounts()) + ". Names and reasons stay on each member's record." }) + lvWaiting() + arrowLink("#/desk?tab=people", "People", "people") + "</section>";
  }
  function lvActCard() {
    var L = (LV.desk && LV.desk.activity) || [];
    /* qa (visual 23): a row's title is a sentence-case label, never the raw audit key */
    var label = function (k) { k = String(k || ""); return ACTION_LABEL[k] || cap1(k.replace(/_/g, " ")) || "League office action"; };
    return '<section class="dk-aside-sec dk-act ' + R + '" aria-labelledby="dkActH">' + secHead({ id: "dkActH", k: "Staff", h: "Recent activity", sm: true, p: "What the league office did lately." }) +
      (L.length ? '<div class="dk-rows dk-hair">' + L.map(function (a) {
        return '<div class="row"><span class="avatar dk-av">' + esc(initials(a.actor || "Staff")) + '</span><span class="grow"><span class="title">' + esc(label(a.action)) + '</span><span class="sub">' + esc((a.actor || "Staff") + " · " + ago(a.at)) + "</span></span></div>";
      }).join("") + "</div>" : '<p class="t-foot">Nothing recorded lately.</p>') + "</section>";
  }
  /* the league office's audit keys (public.admin_audit.action) as Recent activity says them; a key not listed here reads as
     its own words, capitalized */
  var ACTION_LABEL = { season_rollover: "Season rolled over", role_change: "Role changed", trade_request_deleted: "Trade request deleted",
    club_season_closed: "Club season closed", owner_app_withdrawn: "Owner application withdrawn", playoff_round_drawn: "Playoff round drawn",
    application_message_removed: "Application message removed", box_score_goals_removed: "Goals removed from a box score",
    manager_departure_flagged: "Manager departure reported", case_assign: "Case assigned" };
  /* gaps (2026-11-25): the Reports band, in plain words from the league office's own counts (s2_desk(), read with the rest of
     the desk): it said the figures were "not in s2_league", engineering text a staffer cannot use. Staff cases leave the
     club's trade requests out (Rule 2.3), as the queue does; the counts are the ones RLS lets this reader see */
  function lvReports() {
    var head = function (p) { return '<section class="band tint dk-reports" id="dkReports" aria-labelledby="dkRepH"><div class="sec-head"><div class="copy"><span class="kicker">Reports</span><h2 class="d-2" id="dkRepH">How the desk is running</h2>' + (p ? "<p>" + p + "</p>" : "") + "</div></div>"; };
    if (LV.state === "error") return head("") + stateBox("err", "The figures did not load", esc(LV.err || "The league did not answer.") + " Nothing here can be read as quiet until they load.") + "</section>";
    if (LV.state !== "ready" || !LV.desk) return head("") + stateBox("muted", "Reading the figures", "From the league office's records.") + "</section>";
    var D = LV.desk, sum = function (l, k) { return l.reduce(function (a, x) { return a + (+x[k] || 0); }, 0); };
    var cs = (D.cases || []).filter(function (x) { return staffType(x.type) && x.route !== "manager"; }), open = cs.filter(function (x) { return x.status !== "resolved" && x.status !== "denied"; });
    var nOpen = sum(open, "n"), unc = nOpen - sum(open, "assigned"), answered = sum(cs, "n") - nOpen;
    var oldest = open.map(function (x) { return x.oldest; }).filter(Boolean).sort()[0];
    var ap = (D.applications || []).filter(function (x) { return x.status === "pending"; }), apN = function (k) { return sum(ap.filter(function (x) { return x.kind === k; }), "n"); };
    var apParts = [[apN("owner"), "owner"], [apN("staff"), "staff"], [apN("management"), "front office"]].filter(function (x) { return x[0]; }).map(function (x) { return (x[0] === 1 ? "one " : x[0] + " ") + x[1] + (x[0] === 1 ? " application" : " applications"); });
    var warns = sum((D.suspensions || []).filter(function (x) { return x.status === "active" && x.mode === "warning"; }), "n");
    var ea = D.ea_import || {}, um = (ea.unmatched || []).length, ms = (ea.missing_stats || []).length, au = D.audit || [];
    var rows = [
      ["Staff cases", nOpen ? plural(nOpen, "One case is open", "cases are open") + (unc ? ", " + (unc === nOpen ? (nOpen === 1 ? "not yet claimed" : "none of them claimed") : (unc === 1 ? "one" : unc) + " unclaimed") : ", every one claimed") + (oldest ? ". The oldest was filed " + ago(oldest) : "") + "." : "No staff case is open.",
        plural(answered, "One case answered in all.", "cases answered in all.")],
      ["Applications", ap.length ? "Waiting on the staff vote: " + apParts.join(", ") + "." : "No owner, staff or front office application is waiting on the staff vote.", "Committee seat applications are on the Applications tab."],
      ["Discipline", "In force now: " + lvDiscCounts() + ".", warns ? plural(warns, "One warning is on record.", "warnings are on record.") : "No warning is on record."],
      ["EA imports", um || ms ? [um ? plural(um, "One EA match", "EA matches") + " could not be matched to a league game" : "", ms ? plural(ms, "one final has", "finals have") + " no box score" : ""].filter(Boolean).join(", and ") + "." : "Every EA match found its game, and every final has its box score.",
        "The Games tab works each one."],
      ["League office", sum(au, "n_7d") + " recorded actions in the last seven days, " + sum(au, "n_30d") + " in the last thirty.", "What was done lately is under Recent activity."]
    ];
    return head("From the league office's own records, as of " + esc(M.etDate(new Date(LV.at).toISOString()) + ", " + deskTime()) + " ET.") +
      '<div class="dk-panel"><div class="dk-rows dk-hair">' + rows.map(function (r) {
        return '<div class="row"><span class="grow"><span class="title">' + esc(r[0]) + '</span><span class="sub">' + esc(cap1(r[1])) + '</span><span class="t-foot">' + esc(r[2]) + "</span></span></div>";
      }).join("") + "</div></div></section>";
  }
  /* -------- APPLICATIONS, live: the lead sentence and your part -------- */
  function lvAppsLead() {
    var n = LV.voters, need = n ? Math.floor(n / 2) + 1 : null;
    return (LV.flip ? "Every staffer and every commissioner votes on owner, staff and front office applications and on committee seats; one is approved when more than half of them approve it" + (need ? " (" + need + " of " + n + " today)" : "") + ", and denied once that can no longer happen."
      : "The applications reviewers vote on owner, staff and front office applications, and every staffer and commissioner on a committee seat" + (need ? " (" + need + " of " + n + " decide a seat today)" : "") + ".") +
      " A commissioner may also decide one alone. The applicant only ever sees the decision.";
  }
  function lvMineCard(a) {
    var x = appX(a), mb = lvMine(a), v = x.pick || (mb && mb.vote), note = x.note != null ? x.note : mb ? mb.note || "" : "", s = appState(a), k, h, p, body = "";
    if (a.stage === "decided") { k = "Decision"; h = s[0]; p = esc(a.who) + " sees the decision, never the votes."; }
    else if (a.profile_id === myId()) { k = "Your application"; h = "The staff are voting"; p = "You do not vote on your own application.";
      /* gaps (2026-11-25): withdraw_committee_application, the applicant's own pending seat application (apply_committee_seat
         refuses a second one with "Withdraw that application to file a new one") */
      if (a.type === "committee") body = '<div class="dk-actions"><button class="btn secondary" data-act="a-withdraw">Withdraw my application</button></div>'; }
    else {
      k = "Your ballot";
      if (may("vote", a)) {
        h = mb ? (mb.vote === "approve" ? "You voted to approve" : "You voted to deny") : "Cast your ballot";
        p = (!mb && lvMineEarlier(a) ? "Your earlier ballot was cast before this application was filed again, so it no longer counts (Rule 2.6). " : "") +
          "Your reason goes to the rest of the league office with your vote. " + esc(a.who) + " never sees a ballot.";
        body = '<div class="dk-ballot" role="group" aria-label="Your ballot">' + [["approve", "Approve", "check"], ["deny", "Deny", "x"]].map(function (o) {
            return '<button class="dk-vote ' + o[0] + '" data-act="a-pick" data-v="' + o[0] + '" aria-pressed="' + (v === o[0]) + '">' + S2.ic(o[2]) + o[1] + "</button>"; }).join("") + "</div>" +
          '<label class="dk-a-lbl" for="dkANote">Your reason<span class="t-foot">Staff only</span></label><textarea class="input dk-a-note" id="dkANote" rows="3" placeholder="What decided it for you">' + esc(note) + "</textarea>" +
          '<div class="dk-actions"><button class="btn" data-act="a-cast">' + (mb ? "Update ballot" : "Cast ballot") + "</button>" + (mb ? '<button class="btn secondary" data-act="a-retract">Withdraw my ballot</button>' : "") + "</div>" +
          '<p class="dk-a-err" id="dkAErr" role="alert">' + esc(x.err) + '</p><p class="t-foot dk-a-fine">You may change or withdraw it until the application is decided.</p>';
      } else { h = "No ballot from this account"; p = "The league does not count a ballot from this account on this application."; }
      if (may("override")) body += '<p class="t-cap dk-mt">Decide now</p><p class="t-foot">A commissioner may decide without waiting for a majority. Every ballot stays on the record.</p>' +
        '<div class="dk-actions"><button class="btn secondary" data-act="a-decide" data-v="approve">' + S2.ic("check") + 'Approve now</button><button class="btn danger" data-act="a-decide" data-v="deny">' + S2.ic("x") + "Deny now</button></div>";
    }
    return '<section class="dk-gsec dk-a-mine ' + R + '" id="dkAMine" aria-labelledby="dkAMineH">' + secHead({ lvl: 2, id: "dkAMineH", k: k, h: h, p: p, focus: true, swap: "mine" }) + body + "</section>";
  }

  /* -------- the dispatcher's live doors -------- */
  function lvClick(t) {
    var act = t.dataset.act;
    if (act === "lv-retry") { LV.state = "loading"; lvRepaint(); loadAll().then(lvRepaint); return true; }
    if (act === "lv-msgs") { var c0 = caseById(st.caseId); if (c0) { delete LV.msgs[c0.id]; lvOpenThread(c0); } return true; }
    if (act === "lv-reply") { lvReply(); return true; }
    if (act === "lv-review") { lvCaseAct("review"); return true; }
    if (act === "lv-pos") { lvDecidePos(t.dataset.v); return true; }
    if (act === "lv-ffa") { lvDecideFfa(t.dataset.v); return true; }
    if (act === "lv-disc" || act === "lv-disc-req") { var c1 = caseById(st.caseId); if (c1) lvDiscSheet({ pid: c1.raw.target_profile_id || null, kind: act === "lv-disc-req" ? "request" : may("warn") ? "warn" : "games", caseId: c1.id }); return true; }
    if (act === "a-retract") { lvRetract(); return true; }
    if (act === "a-withdraw") { lvWithdrawCm(); return true; }
    if (act === "tx-reverse" || act === "tx-resend") { txAct(t); return true; }
    if (act === "tx-retry") { LV.trades = null; ensureTrades(); repaintTrades(); return true; }
    return false;
  }
  function lvChange(e) {
    if (e.target.id === "dkLvInternal") { var c = caseById(st.caseId); if (c) st.lvDraft = { id: c.id, body: ($("#dkLvReply") || {}).value || "", internal: e.target.checked }; }
  }
  /* gaps (2026-11-25): a committee seat application filed from the Committees pane (js/flows.js FLOWS.committee) is on the
     desk once the database confirms it: the applications are read again and the desk repaints in place, owed while the
     form's receipt is still open (S2.quietRepaint, js/live.js) */
  document.addEventListener("s2:filed", function (e) { if (e.detail && e.detail.flow === "committee" && LV.at) loadApps().then(function () { if (S2.quietRepaint) S2.quietRepaint(); else lvRepaint(); }, function (er) { S2.toast("Filed. The applications could not be read again: " + er.message, "err"); }); });
  /* the member record's tools and the waiting requests live outside #dk (a sheet, the aside), so they are heard here */
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-lv-tool],[data-lv-req]");
    if (!t || t.disabled || t.getAttribute("aria-busy") === "true") return;
    if (t.dataset.lvTool) lvTool(t.dataset.lvTool, t.dataset.pid || null, t.dataset.id || null); else lvReq(t.dataset.lvReq, t.dataset.id);
  });

  /* =========================================================================================================== */
  /* page assembly, routing inside the desk, events                                                              */
  /* =========================================================================================================== */
  function view(r) {
    if (r.arg === "game") return { pane: "games", game: r.sub || "missing" };
    if (r.arg === "person") return { pane: "people", person: r.sub };
    if (r.arg === "application") return { pane: "applications", app: r.sub || "missing" };
    return { pane: PANE_KEYS.indexOf(r.q.tab) >= 0 ? r.q.tab : "today" };
  }
  var PANE_FN = { today: paneToday, cases: paneCases, games: paneGames, applications: paneApps, people: panePeople, committees: paneCommittees, transactions: paneTx, newsroom: paneNews };
  /* qa (visual 31): a pane's title names the workspace too, so the desk's Games and the public Games page (and every other
     shared name) stay apart in the tab strip, the history list and a screen reader's window title */
  function titleFor(r) {
    var v = view(r), t;
    if (v.app) { var ap = appById(v.app); t = ap ? applicant(ap) : "Application"; }
    else if (v.game) { var g = M.game(v.game); t = g ? g.away + " at " + g.home : "Game desk"; }
    else if (v.pane === "today") return "Staff Desk";
    else t = paneLabel(v.pane);
    return t + " · Staff Desk";
  }
  function paint(r) {
    var v = view(r); st.view = v.game ? "game" : v.app ? "app" : v.pane; st.appId = v.app || null;
    var main;
    /* every pane waits for the desk's reads and opens only to a reader the database calls staff (the Game desk keeps its own gate) */
    try { main = v.game ? paneGame(v.game) : v.app ? paneApp(v.app) : lvGate(function () { return PANE_FN[v.pane](r); }); }
    catch (err) { main = stateBox("err", "This part of the desk failed to draw", esc(String(err && err.message || err)), '<a class="btn sm secondary" href="#/desk">Back to Today</a>'); if (window.console) console.error(err); }
    /* the Game desk and an application are deep pages: a breadcrumb instead of the sidebar, so the ink band runs full width */
    if (v.game || v.app) return '<div class="dk dk-game" id="dk" data-view="' + st.view + '">' + main + "</div>";
    /* Today ends in the Reports band, which spans the page under the sidebar and the queue */
    var band = "";
    if (v.pane === "today") band = lvReports();
    return '<div class="dk" id="dk" data-view="' + st.view + '">' + head(v) + '<div class="split dk-split">' + sidebar(v.pane) + '<div class="dk-main" id="dkMain"><h2 class="sr" id="dkPaneH" tabindex="-1">' + esc(paneLabel(v.pane)) + "</h2>" + main + "</div></div>" + band + "</div>";
  }
  function mount(r) {
    var dk = $("#dk"); if (!dk) return;
    /* the desk's own reads on the first visit (and again after a minute away), then the desk repaints in place */
    if (!LV.run && (LV.state === "idle" || (LV.state === "ready" && Date.now() - LV.at > 60000))) loadAll().then(lvRepaint);
    if (st.view === "cases") lvOpenThread(caseById(st.caseId));
    if (st.view === "transactions") ensureTrades();
    dk.addEventListener("click", onClick);
    dk.addEventListener("keydown", onKeyLocal);
    dk.addEventListener("input", onInput);
    dk.addEventListener("change", onChange);
    var v = view(r);
    if (v.person) openPerson(v.person);
    if (st.view === "app") mountApp();
    /* the phone's section tabs scroll sideways: the current one is brought to the middle, never left off-screen */
    var side = $(".dk-side", dk), on = side && $('[aria-current="page"]', side);
    if (on && side.scrollWidth > side.clientWidth) side.scrollLeft += on.getBoundingClientRect().left - side.getBoundingClientRect().left - (side.clientWidth - on.offsetWidth) / 2;
    /* the phone rail opens on the committee in focus, not always on the first card */
    var rail = $("#dkLineup", dk), onCard = rail && $(".dk-ccard.on", rail);
    if (onCard && rail.scrollWidth > rail.clientWidth) rail.scrollLeft += onCard.getBoundingClientRect().left - rail.getBoundingClientRect().left - parseFloat(getComputedStyle(rail).paddingLeft || 0);
    if (st.view === "game") { var first = $(".dk-ed", dk); if (first) first.setAttribute("tabindex", "0"); }
    fadeBox();   /* the box score, the cap table and a view strip fade at a clipped edge */
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fadeBox);   /* the condensed face lands after mount and widens the labels */
  }
  /* switching desk sections repaints in place (no page entrance, no scroll to a stale place) and keeps Back working */
  function swapTo(hash, push) {
    history[push ? "pushState" : "replaceState"](null, "", hash);
    var dk = $("#dk"); if (!dk) { S2.route(); return; }
    var r = S2.parse(), keep = R; R = "";
    closePop();
    dk.outerHTML = paint(r); R = keep;
    S2.setTitle(titleFor(r));   /* the tab and the bar's collapsed title, as the router names a page (QA round 2) */
    mount(r); S2.charts.hydrate($("#dk"));
    /* a new section: focus its name (the sr-only pane h2; the Game desk's h1), never BODY */
    if (push) { window.scrollTo(0, 0); var ph = $("#dkPaneH"); if (ph) ph.focus({ preventScroll: true }); else landOn($("#dkTitle")); }
    S2.onScroll && S2.onScroll();
  }
  function onClick(e) {
    if (!e.target.closest(".dk-pop") && !e.target.closest('[data-act="assign"]')) closePop();
    var kb = e.detail === 0;   /* Enter or Space on a button: keyboard, so no animation */
    var cell = e.target.closest(".dk-ed");
    if (cell && !cell.classList.contains("editing")) { focusCell(cell); editCell(cell); return; }
    var pane = e.target.closest("[data-pane]");
    if (pane && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); swapTo(pane.getAttribute("href"), true); return; }
    var cm = e.target.closest("[data-committee]");
    if (cm && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); setFocus(cm.dataset.committee, kb); return; }
    var t = e.target.closest("[data-case],[data-scope],[data-gview],[data-pf],[data-apptype],[data-person],[data-act]");
    if (!t) return;
    if (t.dataset.case) { selectCase(t.dataset.case, kb); return; }
    if (t.dataset.scope) {
      if (st.scope === t.dataset.scope) return;
      st.scope = t.dataset.scope; $$("[data-scope]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === t)); });
      var sl = caseScope(st.scope); st.caseId = sl[0] ? sl[0].id : st.caseId;
      setHash("#/desk?tab=cases" + (st.caseId && !narrow() ? "&case=" + st.caseId : ""));
      repaintCases(true);
      return;
    }
    if (t.dataset.gview) {
      st.gview = t.dataset.gview; setHash("#/desk?tab=games&view=" + st.gview);
      $$("[data-gview]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === t)); });
      var gw = $("#dkGWrap"); if (gw) gw.innerHTML = gameList(st.gview);
      return;
    }
    if (t.dataset.pf) { e.preventDefault(); var pf = t.dataset.pf; swapTo("#/desk?tab=people&filter=" + pf, false); var inp = $("#dkPSearch"); if (inp && !inp.closest("[hidden]") && st.pq) inp.focus(); else landOn($('[data-pf="' + pf + '"]')); return; }
    if (t.dataset.apptype) { st.appType = t.dataset.apptype; $$("[data-apptype]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === t)); }); $("#dkBoardWrap").innerHTML = board(); return; }
    if (t.dataset.person && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openPerson(t.dataset.person); return; }
    var act = t.dataset.act, s;
    if (act && lvClick(t)) return;
    switch (act) {
      /* resolve and deny ask for the final decision statement first (lvCaseAct's sheet) */
      case "claim": case "resolve": case "deny": caseAct(act, kb); break;
      case "assign": assignMenu(t, kb); break;
      case "assign-to": closePop(); caseAct("assign", kb, t.dataset.name); var ab = $('#dkCaseDetail [data-act="assign"]'); if (ab) ab.focus({ preventScroll: true }); break;
      case "case-back":
        if (st.pushed) { st.pushed = false; history.back(); }   /* the hashchange guard above returns to the list in place */
        else { showList(); setHash("#/desk?tab=cases"); }
        break;
      case "clear-imp": clearImport(+t.dataset.i, kb); break;
      case "club": s = cur(); if (s && s.club !== t.dataset.club) { s.club = t.dataset.club; repaintGame(["dkBox"]); var f0 = $(".dk-ed"); if (f0) f0.setAttribute("tabindex", "0"); var tab = $('.dk-clubtab[data-club="' + s.club + '"]'); if (tab) tab.focus(); } break;
      case "undo": undoEdit(); break;
      case "ea-search": eaSearch(); break;
      case "res-edit": openResEdit(); break;
      case "res-cancel": s = cur(); s.resEdit = null; repaintGame(["dkRes"]); landOn($('#dkRes [data-act="res-edit"]')); break;
      case "step": s = cur(); var side = t.dataset.side; s.resEdit[side] = Math.max(0, Math.min(99, s.resEdit[side] + (+t.dataset.d))); var o = $("#dkStep_" + side); if (o) { o.textContent = s.resEdit[side]; if (!kb) swapIn(o); } break;
      case "ot": s = cur(); s.resEdit.ot = !s.resEdit.ot; t.setAttribute("aria-checked", String(s.resEdit.ot)); break;
      case "res-save": saveResult(kb); break;
      case "a-pick": pickVote(t.dataset.v); break;
      case "a-cast": castBallot(kb); break;
      case "a-decide": decideApp(t.dataset.v); break;
      case "a-send": sendMsg(kb); break;
      case "front": toggleFront(t.dataset.k); break;
    }
  }
  function onInput(e) {
    if (e.target.id === "dkPSearch") {
      st.pq = e.target.value;
      var l = $("#dkPList"); if (l) { var keep = R; R = ""; l.outerHTML = peopleBody(st.pfilter, st.pq); R = keep; }   /* only the list repaints; the field keeps its caret */
    }
    /* an application's drafts live on its item, so a repaint or an update never loses what was typed */
    var ap = (e.target.id === "dkAMsg" || e.target.id === "dkANote") && curApp();
    if (ap && e.target.id === "dkAMsg") { appX(ap).draft[appX(ap).thread] = e.target.value; grow(e.target); var me0 = $("#dkAMsgErr"); if (me0) me0.textContent = ""; }
    if (ap && e.target.id === "dkANote") appX(ap).note = e.target.value;
    /* a case reply being written survives the repaint after a claim or an assignment */
    if (e.target.id === "dkLvReply") { var ic0 = $("#dkLvInternal"); st.lvDraft = { id: st.caseId, body: e.target.value, internal: !!(ic0 && ic0.checked) }; var re = $("#dkLvReplyErr"); if (re) re.textContent = ""; }
  }
  function onChange(e) { lvChange(e); }
  /* the box score walks like a spreadsheet: arrows move, Enter or a digit edits */
  function onKeyLocal(e) {
    if (e.key === "Enter" && e.target.id === "dkEaQ") { e.preventDefault(); eaSearch(); return; }
    /* Command or Control and Enter sends a message or casts the ballot; Enter alone is a new line */
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.target.id === "dkAMsg" || e.target.id === "dkANote")) { e.preventDefault(); if (e.target.id === "dkAMsg") sendMsg(true); else castBallot(true); return; }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target.id === "dkLvReply") { e.preventDefault(); lvReply(); return; }
    /* the case listbox: arrows move like J and K */
    var row = e.target.closest && e.target.closest("#dkCaseRows [data-case]");
    if (row && (e.key === "ArrowDown" || e.key === "ArrowUp") && !e.metaKey && !e.ctrlKey && !e.altKey) { moveCase(e.key === "ArrowDown" ? 1 : -1, row); e.preventDefault(); return; }
    var td = e.target.closest && e.target.closest(".dk-ed");
    if (!td || td.classList.contains("editing")) return;
    var map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    if (map[e.key]) { focusCell(neighbor(td, map[e.key])); e.preventDefault(); }
    else if (e.key === "Enter" || e.key === "F2") { editCell(td); e.preventDefault(); }
    else if (/^[0-9-]$/.test(e.key) && !e.metaKey && !e.ctrlKey) { editCell(td, e.key); e.preventDefault(); }
  }
  /* one global listener for the desk's keyboard: j and k move, c claims, e resolves or clears; never while typing */
  document.addEventListener("keydown", function (e) {
    var dk = $("#dk"); if (!dk || e.defaultPrevented) return;
    if ($(".sheet") || $(".palette")) return;
    var t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !typing) {
      if (st.view === "game") { var s = cur(); if (s && s.edits.length) { undoEdit(); e.preventDefault(); } }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") { if ($(".dk-pop")) { closePop(); e.preventDefault(); } return; }
    if (e.key !== "j" && e.key !== "k" && e.key !== "c" && e.key !== "e") return;
    var list = $("[data-kbd-list]", dk); if (!list) return;
    var items = $$("[data-kbd-item]", list);
    if (!items.length) return;
    var at = items.indexOf(t.closest ? t.closest("[data-kbd-item]") : null);
    if (at < 0) at = items.findIndex(function (x) { return x.classList.contains("is-sel") || x.getAttribute("aria-selected") === "true"; });
    if (e.key === "j" || e.key === "k") {
      var nx = items[Math.max(0, Math.min(items.length - 1, at < 0 ? 0 : at + (e.key === "j" ? 1 : -1)))];
      if (st.view === "cases" && nx.dataset.case) { moveCase(e.key === "j" ? 1 : -1, t); e.preventDefault(); return; }
      items.forEach(function (x) { x.classList.toggle("is-sel", x === nx); });
      nx.focus();
      e.preventDefault(); return;
    }
    if (st.view === "cases" && (e.key === "c" || e.key === "e")) { caseAct(e.key === "c" ? "claim" : "resolve", true); e.preventDefault(); return; }
    if (st.view === "games" && st.gview === "imports" && e.key === "e") { var cur0 = items[at]; if (cur0 && $('[data-act="clear-imp"]', cur0)) { clearImport(+cur0.dataset.imp, true); e.preventDefault(); } }
  });
  /* charts are drawn for a width; redraw in place when the layout bucket changes */
  function bucketOf(w) { return w < 760 ? 0 : w < 1000 ? 1 : w < 1180 ? 2 : 3; }   /* reports pair at 1000; the page column stops growing at 1180 */
  var bucket = bucketOf(window.innerWidth), rz = 0;
  window.addEventListener("resize", function () {
    if ($(".dk-pop")) closePop();   /* the menu is placed for the old layout */
    clearTimeout(rz); rz = setTimeout(function () {
      var b = bucketOf(window.innerWidth); if (b === bucket) { fadeBox(); return; } bucket = b;
      /* an application draws nothing for a width (its rail is CSS, its log follows by logRO): a redraw here only threw a
         reader who had scrolled up in the thread back to the newest message and dropped focus (review 2026-10-22) */
      if (st.view === "app") { fadeBox(); return; }
      /* never under someone typing: the search, a message or a ballot reason keeps its caret (2026-10-22) */
      var typing = document.activeElement && document.activeElement.matches && document.activeElement.matches("#dk input, #dk textarea");
      if ($("#dk") && !$(".sheet") && !$(".dk-cell-in") && !typing) swapTo(location.hash, false);
    }, 180);
  });

  /* e0 split (2026-11-24): the Games pane (#/desk?tab=games, the Stats manager) and the Game desk (#/desk/game/<id>)
     moved to js/pages/gamedesk.js, which loads after this file. The desk's paint and dispatcher reach their functions
     through these forwarders, looked up by name at call time, and gamedesk.js reads this file's pieces from S2._desk
     (R, the entrance class, through a getter and a setter, because both files change it) */
  function clearImport() { return S2._gamedesk.clearImport.apply(this, arguments); }
  function eaSearch() { return S2._gamedesk.eaSearch.apply(this, arguments); }
  function editCell() { return S2._gamedesk.editCell.apply(this, arguments); }
  function focusCell() { return S2._gamedesk.focusCell.apply(this, arguments); }
  function gameList() { return S2._gamedesk.gameList.apply(this, arguments); }
  function neighbor() { return S2._gamedesk.neighbor.apply(this, arguments); }
  function openResEdit() { return S2._gamedesk.openResEdit.apply(this, arguments); }
  function paneGame() { return S2._gamedesk.paneGame.apply(this, arguments); }
  function paneGames() { return S2._gamedesk.paneGames.apply(this, arguments); }
  function repaintGame() { return S2._gamedesk.repaintGame.apply(this, arguments); }
  function saveResult() { return S2._gamedesk.saveResult.apply(this, arguments); }
  function undoEdit() { return S2._gamedesk.undoEdit.apply(this, arguments); }
  S2._desk = { $: $, $$: $$, EASE_IO: EASE_IO, EASE_OUT: EASE_OUT, M: M, MAC: MAC, TICKS: TICKS, clock: clock,
    comName: comName, confirmSheet: confirmSheet, cur: cur, esc: esc, fadeBox: fadeBox, gameTopic: gameTopic,
    ghostOut: ghostOut, gs: gs, hist: hist, ic: ic, landOn: landOn, manager: manager, me: me, mgrBadge: mgrBadge,
    moving: moving, nextNight: nextNight, plural: plural, secHead: secHead, st: st,
    stateBox: stateBox, sum: sum, swapIn: swapIn, syncCounts: syncCounts, tag: tag, teamName: teamName,
    yourCall: yourCall, get R() { return R; }, set R(v) { R = v; },
    /* the live layer's state and its one read, for the suites (tools/ui/desklive.cjs) */
    LV: LV, may: may, loadAll: loadAll };

  if (!M) {
    S2.page("desk", { title: "Staff Desk", tab: "desk", render: function () { return '<div class="page-head"><h1 class="t-large">Staff Desk</h1></div>' + stateBox("err", "Couldn't load the league", "The league read did not load, so nothing here can be trusted as empty. Reload the page."); } });
    return;
  }
  S2.page("desk", {
    title: titleFor, tab: "desk", views: PANES,   /* the header's Workspaces menu lists these (js/core.js navTabs) */
    render: function (r) { R = "reveal"; return paint(r); },
    after: function (root, r) { mount(r); }
  });
})();
