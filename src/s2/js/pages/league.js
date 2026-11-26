/* The league pages of the Season 2 site: #/standings, #/stats, #/clubs, #/season and #/rulebook (#/draft moved to
   js/pages/draft.js in e0's split, 2026-11-24). Everything printed comes from S2.M (js/model.js: the s2_league read live, the
   private Oct 19 fixture in the suites), and the rulebook from S2.RB (js/rulebook.js, the published book). What a member
   does here (an award vote) is a database door through S2.write, shown as done only once the league confirms it (the real
   path only since the v5.00 swap, i3b, 2026-11-25; it replaced the open concept's tab-only votes of 2026-10-19). No
   control here is disabled or a dead end: a role the database would refuse meets S2.locked or says so.
   League website v2 (commissioner, 2026-10-19: "I love the way all the stats are presented, but I feel like the design
   feels too much like a dashboard and not a League Website"; references liftfoils.com and juventus.com; imagery is "Type
   and crests only"): every page opens with a statement hero whose headline carries the real number, the views are
   editorial sections (kicker, uppercase headline, one sentence, an arrow link) and full-width bands, the stat pictures
   stay exactly as capable as before, and sources and method live in ONE "About this data" disclosure per page instead of
   a caption under every box. Views, sorts, filters and searches repaint their own widget in place and rewrite the
   address with replaceState, so a tap never resets the page or loses the scroll position (the seamless-interactions rule). */
(function () {
  "use strict";
  var S2 = window.S2, M = S2.M, esc = S2.esc;
  var FLOOR = M ? M.playoffFormat.minGp : 14;    /* Rule 8.3: Season 1's games-played floor, 14 by the v4.43 ruling (Season 2's is six, v4.52) */
  var SETTLE = M ? M.SETTLE_GP : 6;              /* a rate means little before 6 games (cghl_settle_gp) */
  var MARK = { x: "Clinched a playoff spot", z: "Clinched the division", e: "Eliminated from the playoffs" };

  /* ---------- shared pieces ---------- */
  function fail(title, why) {
    return '<header class="hero lg-hero"><span class="kicker">League</span><h1 class="d-hero lg-h1">' + esc(title) + '</h1><p class="lede-l" role="alert">' + esc(why ||
      "The league data did not load, so nothing here can be shown. Reload the page.") + "</p></header>";
  }
  /* the statement hero (Lift): a widely tracked kicker, a huge condensed headline that states the news with the real number,
     one sentence, and optionally a button row (cta), a figure beside it (side) and a strip under it (foot) */
  function hero(o) {
    var long = String(o.title).length > 26;
    /* the headline gets the full width; the sentence, the buttons and a figure share the row under it */
    return '<header class="hero lg-hero reveal' + (o.side ? " has-side" : "") + '"><div class="lg-hero-copy"><span class="kicker">' + esc(o.kicker) + "</span>" +
      '<h1 class="d-hero lg-h1' + (long ? " long" : "") + (o.cls ? " " + o.cls : "") + '">' + esc(o.title) + "</h1></div>" +
      '<div class="lg-hero-foot"><div class="lg-hero-text">' + (o.lede ? '<p class="lede-l">' + o.lede + "</p>" : "") + (o.cta ? '<div class="lg-cta">' + o.cta + "</div>" : "") + "</div>" +
      (o.side ? '<div class="lg-hero-side">' + o.side + "</div>" : "") + "</div></header>" + (o.foot || "");
  }
  /* section head (kit .sec-head): kicker, uppercase headline, one sentence of news, an arrow link or a control */
  /* the league pages' names for core's one section head (S2.secHead, audit 2026-11-09): title, text, h ("h3") */
  function secHead(o) { return S2.secHead({ kicker: o.kicker, id: o.id, h: o.title, p: o.text, aside: o.aside, lvl: o.h ? +String(o.h).slice(1) : 2, size: o.size, cls: "lg-sh" }); }
  /* an arrow link; data-view keeps a jump between views of the same page in place (no route, no reset) */
  function arrow(href, label, view) {
    return '<a class="arrow" href="' + esc(href) + '"' + (view ? ' data-view="' + view + '"' : "") + "><span>" + esc(label) + "</span>" + S2.ic("chev") + "</a>";
  }
  function rule(id) { return '<a href="#/rulebook?rule=' + id + '">Rule ' + id + "</a>"; }
  /* the signed-in member (S2.mine, today.js): their club row and their own line are marked, and Find me jumps to them
     (audit 2026-11-09: the league pages knew nothing about who was reading) */
  function me() { return S2.mine ? S2.mine() : null; }
  var YOU = '<span class="lg-tag lg-you">You</span>';
  /* Find me: clear what hides the row, then bring it to the middle of the screen with focus on it */
  function findMeBtn(id) { return me() ? '<button type="button" class="btn secondary sm lg-findme" id="' + id + '">' + S2.ic("you") + "Find me</button>" : ""; }
  function bindFindMe(root, id, reset, sel) {
    var b = S2.$("#" + id, root); if (!b) return;
    b.addEventListener("click", function () {
      reset();
      var row = S2.$(sel, root); if (!row) { S2.toast("You have no line here yet.", "err"); return; }
      var link = row.querySelector("a") || row, wrap = row.closest(".tbl-wrap");
      if (wrap) wrap.scrollLeft = 0;
      row.scrollIntoView({ block: "center", behavior: S2.reduce.matches ? "auto" : "smooth" });
      link.focus({ preventScroll: true });
      row.classList.remove("lg-flash"); void row.offsetWidth; row.classList.add("lg-flash");
    });
  }
  /* ONE disclosure per page for sources and method (website direction: no caption footnotes under every box) */
  /* core's one disclosure (S2.about, audit 2026-11-09: three designs of About this data), with the ids a tab switch
     repaints its body through */
  function about(html, title) {
    return S2.about(html, title).replace('<details class="about', '<details id="lgAbout" class="about').replace('<div class="about-b"', '<div class="about-b" id="lgAboutB"');
  }
  function paras(list) { return list.filter(Boolean).map(function (p) { return "<p>" + p + "</p>"; }).join(""); }
  /* a crest beside a visible name is decoration: hide it from screen readers so the name is not read twice */
  function cr(code, cls) { return '<span class="lg-cr" aria-hidden="true">' + M.crest(code, cls) + "</span>"; }
  function teamName(code) { var t = M.team(code); return t ? t.full : code; }
  function city(x) { var t = typeof x === "string" ? M.team(x) : x && x.team; return t ? t.city : String(x && x.code || x || ""); }
  function list(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  function cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function signed(v) { v = Math.round(v * 10) / 10; return v > 0 ? "+" + v : v < 0 ? "−" + Math.abs(v) : "0"; }
  function dec3(v) { return v == null ? "–" : v.toFixed(3).replace(/^0/, ""); }
  function fix(v, d) { return v == null ? "–" : v.toFixed(d); }
  function pct1(v) { return v == null ? "–" : v.toFixed(1) + "%"; }
  /* games left, true for every row: a make-up game leaves clubs on different counts, so "each" only when they agree */
  function leftNote(rows, each) {
    var n = rows.map(function (r) { return r.games_left || 0; }).concat(rows.length ? [] : [0]), lo = Math.min.apply(null, n), hi = Math.max.apply(null, n);
    return lo === hi ? plural(hi, "game", "games") + " left" + (each ? " each" : "") : lo + " to " + hi + " games left";
  }
  function ord(n) { return S2.ord(n); }
  function word(n) { return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][n] || String(n); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function cal(n, key) { var s = M.control.season(n); return s ? s.calendar.filter(function (c) { return c.key === key; })[0] || null : null; }
  function md(c) { return c ? c.date.replace(/, \d{4}$/, "") : "to be set"; }
  /* a closed season's Stanley Cup (M.trophies), or null while it has none, and its final said one way wherever a page
     names the champion: "Boston swept Vancouver in the final, 4-0" (the Awards hero's words; health crawls 1 and 10,
     2026-11-25: the Season page's card and the standings hero now name it too, so it lives here once). The Awards tab's
     trophy room reads it too, so its hero and its Cup panel agree on whether there is a Cup to show.
     shortcut: model.js keeps a private copy (its cupOf, for M.offseasonDemo); export it as M.cup(n) with this both-clubs
     guard and read it here and in profile.js when model.js is next opened (owner: live-model) */
  function cupOf(n) { return M.trophies(n).filter(function (t) { return t.key === "stanley_cup" && M.team(t.club) && M.team(t.over); })[0] || null; }
  function finalLine(cup) { return city(cup.club) + (cup.l === 0 ? " swept " : " beat ") + city(cup.over) + " in the final, " + cup.w + "-" + cup.l; }
  function chev() { return '<svg class="lg-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
  /* a club tile's color and the text on it are core's one S2.clubBand (QA round 2, 2026-11-25: this page kept its own
     inkOn, black or white by luminance with 0.179 where both clear 4.5:1 equally, and wrote the ink-band fallback by hand
     at three tiles, passing a color the test could not read straight into the style) */
  /* an ink band is dark in both themes and keeps following the chosen finish (S2.applyLook updates data-look-scope) */
  function inkBand(cls, inner, label) {
    return '<section class="band ink lg-band ' + cls + '" data-theme="dark" data-look-scope data-finish="' + esc(S2.state.finish) + '"' + (label ? ' aria-label="' + esc(label) + '"' : "") + ">" + inner + "</section>";
  }

  /* change the address without a navigation: S2.route only runs on hashchange, which replaceState does not fire */
  function setQ(name, q) {
    var s = Object.keys(q).filter(function (k) { return q[k] != null && q[k] !== ""; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(q[k]); }).join("&");
    try { history.replaceState(history.state, "", "#/" + name + (s ? "?" + s : "")); }
    catch (e) { console.warn("league: the address could not be updated (" + e.message + "); the view still changed"); }
  }
  /* repaint one widget in place: a short ease-out settle, a cross-fade only when motion is reduced. The host's own fade is
     the only entrance: S2.reveal runs once per page load, so a .reveal inside the new html stayed at opacity 0 and whole
     stats tabs went blank after a switch (review 2026-10-19); it is stripped here. quiet is for in-section toggles used
     tens of times (a stat, a group of skaters, a filter): a 160ms opacity settle, and the chart entrance hydrate just
     started is finished at once, so ten bars do not regrow from zero on every tap (Emil's frequency rule). */
  function swap(host, html, quiet) {
    host.innerHTML = html;
    S2.$$(".reveal", host).forEach(function (e) { e.classList.remove("reveal"); });
    S2.charts.hydrate(host);
    /* QA visual 3 (2026-11-25): an endless animation (a skeleton's shimmer, a live dot) cannot be finished, and finish()
       threw on it, so only the ones that end are */
    if (quiet) { if (host.getAnimations) host.getAnimations({ subtree: true }).forEach(function (a) { if (a.effect && a.effect.getComputedTiming().endTime !== Infinity) a.finish(); }); }
    else S2.countUp(host);
    if (!host.animate) return;
    var fade = quiet || S2.reduce.matches;
    host.animate(quiet ? [{ opacity: 0.4 }, { opacity: 1 }] : fade ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      { duration: fade ? 160 : 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  }

  /* ---------- the view switcher, website style: uppercase condensed labels with ONE underline that springs between them
     (S2.segmented moves its .thumb with S2.spring). On the long pages it pins under the header like an Apple.com local
     nav, so the views stay one tap away from anywhere on the page ---------- */
  function utabs(id, items, cur, label, cls) {
    return '<div class="lg-utabs ' + (cls || "") + '" id="' + id + '" role="group" aria-label="' + esc(label) + '">' + items.map(function (it) {
      return '<button type="button" data-v="' + it[0] + '" aria-pressed="' + (it[0] === cur) + '">' + it[1] + "</button>"; }).join("") + "</div>";
  }
  function tabsBar(id, items, cur, label) {
    return '<div class="lg-tabs-pin" aria-hidden="true"></div><div class="lg-tabsbar reveal"><div class="lg-hscroll">' + utabs(id, items, cur, label) + "</div></div>";
  }
  /* a switch made while the bar is pinned starts the new view at its top, not halfway down whatever was there before */
  function toTabs(root) {
    var pin = S2.$(".lg-tabs-pin", root), nav = S2.$("#navbar"); if (!pin) return;
    var y = Math.round(pin.getBoundingClientRect().top + window.scrollY - (nav ? nav.offsetHeight : 60));
    if (window.scrollY > y + 1) window.scrollTo(0, y);
  }
  /* keep the chosen tab inside a sideways-scrolling row without moving the page. Measured against the scroller itself:
     offsetLeft was relative to .lg-utabs, not the padded .lg-hscroll, so a tab opened by link stayed cut off at the screen
     edge (review 2026-10-20: POWE, AWA). now: place it at once (arrival), not with a glide */
  function intoRow(b, now) {
    var sc = b && b.closest(".lg-hscroll"); if (!sc) return;
    var br = b.getBoundingClientRect(), sr = sc.getBoundingClientRect(), how = now || S2.reduce.matches ? "auto" : "smooth";
    var l = br.left - sr.left + sc.scrollLeft - 16, r = br.right - sr.left + sc.scrollLeft + 16;
    if (l < sc.scrollLeft) sc.scrollTo({ left: l, behavior: how });
    else if (r > sc.scrollLeft + sc.clientWidth) sc.scrollTo({ left: r - sc.clientWidth, behavior: how });
  }
  /* on arrival the chosen tab is brought into its row, and again once the brand face loads and widens the labels */
  function intoRowOnLoad(seg) {
    var on = function () { intoRow(seg && S2.$('button[aria-pressed="true"]', seg), true); };
    on(); if (document.fonts) document.fonts.ready.then(on);
  }
  /* an arrow link to another view of the same page switches in place through the switcher itself */
  function bindViewLinks(root, ctl) {
    root.addEventListener("click", function (e) {
      var a = e.target.closest("a[data-view]"); if (!a || !ctl) return;
      e.preventDefault(); toTabs(root); ctl.set(a.dataset.view);
    });
  }

  /* ---------- one sortable table for every list here: every heading sorts (v3.12 ruling), the name column stays put
     while the numbers scroll on a phone, and a sort repaints only the table so the sideways scroll survives ---------- */
  var TBL = {};
  /* a column can settle on its own games: FO% counts only games at center, so a three-game sample there does not lead the column */
  function unsettled(T, c, r) { return c.settle ? c.settle(r) : !!(T.settle && T.settle(r)); }
  function sortRows(T, col) {
    var mul = T.st.dir === "asc" ? 1 : -1;
    return T.rows().slice().sort(function (a, b) {
      if (col.rate) { var sa = unsettled(T, col, a), sb = unsettled(T, col, b); if (sa !== sb) return sa ? 1 : -1; }
      var x = col.v(a), y = col.v(b);
      if (x == null && y == null) return T.tie ? T.tie(a, b) : 0;
      if (x == null) return 1; if (y == null) return -1;       /* blanks sink whichever way the column sorts */
      var c = typeof x === "string" ? x.localeCompare(y) : x - y;
      return mul * c || (T.tie ? T.tie(a, b) : 0);
    });
  }
  function sortIcon(dir) { return '<svg class="lg-sort' + (dir === "asc" ? " up" : "") + '" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 3.8L5 6.3l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
  function tableInner(T) {
    var col = T.cols.filter(function (c) { return c.key === T.st.key; })[0] || T.cols[0];
    var rows = sortRows(T, col);
    var th = T.cols.map(function (c) {
      var on = c.key === col.key;
      return '<th scope="col" class="' + (c.cls || "") + '"' + (on ? ' aria-sort="' + (T.st.dir === "asc" ? "ascending" : "descending") + '"' : "") + ">" +
        '<button type="button" data-k="' + c.key + '"' + (c.title ? ' title="' + esc(c.title) + '"' : "") + ">" + esc(c.label) + (on ? sortIcon(T.st.dir) : "") + "</button></th>";
    }).join("");
    var body = rows.map(function (r, i) {
      return "<tr" + (T.rowCls ? ' class="' + T.rowCls(r) + '"' : "") + ">" + T.cols.map(function (c, ci) {
        var cell = c.f ? c.f(r) : M.display(c.key, c.v(r)), un = c.rate && unsettled(T, c, r);
        return (ci === 0 ? '<th scope="row"' : "<td") + ' class="' + (c.cls || "") + (un ? " lg-un" : "") + '"' + (un ? ' title="Fewer than ' + SETTLE + (c.settle ? " games at center" : " games") + ': ranked after settled lines"' : "") + ">" + cell + (ci === 0 ? "</th>" : "</td>");
      }).join("") + "</tr>" + (T.after ? T.after(r, i, rows, col) : "");
    }).join("");
    if (!rows.length) body = '<tr><td class="lg-none" colspan="' + T.cols.length + '">' + (T.empty ? T.empty() : "Nothing to show.") + "</td></tr>";
    return (T.caption ? '<caption class="sr">' + esc(T.caption) + "</caption>" : "") + "<thead><tr>" + th + "</tr></thead><tbody>" + body + "</tbody>";
  }
  function Table(T) {
    TBL[T.id] = T;
    T.html = function () { return '<div class="tbl-wrap lg-tw ' + (T.cls || "") + '" id="' + T.id + '" tabindex="0" role="region" aria-label="' + esc(T.caption || "Table") + '"><table class="tbl lg-tbl">' + tableInner(T) + "</table></div>"; };
    T.repaint = function () { if (T.table) T.table.innerHTML = tableInner(T); };
    T.bind = function (root) {
      var wrap = S2.$("#" + T.id, root); if (!wrap) return;
      T.table = S2.$("table", wrap);
      wrap.addEventListener("click", function (e) {
        var b = e.target.closest("thead button"); if (!b) return;
        var k = b.dataset.k, c = T.cols.filter(function (x) { return x.key === k; })[0];
        if (T.st.key === k) T.st.dir = T.st.dir === "asc" ? "desc" : "asc"; else { T.st.key = k; T.st.dir = c.dir || "desc"; }
        T.repaint(); T.onSort && T.onSort(T.st);
        var nb = S2.$('thead button[data-k="' + k + '"]', T.table); if (nb) nb.focus({ preventScroll: true });
      });
      /* a hairline appears on the pinned column only once the numbers slide under it; while more columns sit off the right
         edge, the edge fades (lg-more), since macOS hides the scrollbar (review 2026-10-20: PASS% cut to "59.") */
      var edge = function () { wrap.classList.toggle("lg-slid", wrap.scrollLeft > 2); wrap.classList.toggle("lg-more", wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 2); };
      wrap.addEventListener("scroll", edge, { passive: true }); edge();
      if (window.ResizeObserver) { var ro = new ResizeObserver(edge); ro.observe(wrap); ro.observe(T.table); }   /* a resize, a font load or a sort can change the overflow */
    };
    return T;
  }
  function bindTables(root) { Object.keys(TBL).forEach(function (k) { TBL[k].bind(root); }); }

  /* league state the pages share.
     v5.00 swap (e6): the season on screen (js/model.js M.view) names every label, so the same page reads Season 1 from the
     fixture or an archive and Season 2 live. A season with no final yet is said as such, with the way back to the last
     complete season (?season=, a fresh read by js/load.js), never drawn as tables of zeros (live-model's hand-over note).
     sync() reads it all again whenever js/model.js has rebuilt S2.M in place (S2.reread after a pulse or a write builds a
     new M.view each time): a tab opened before Season 2's first final drops its empty state at the next repaint, with no
     reload (review 2026-11-24: read once at load, it said "No Season 2 games played yet" all night). Every page render, and
     each in-place view switch that builds from these, calls it first; the caches built from the old model go with it. */
  var VIEW = null, PAST, UP, NEXT, FINALS, BOXED, BOXLINES, THROUGH, NOGAMES, PREV, AW, THROUGH_K, STARS_K;
  function sync() {
    if (!M || M.view === VIEW) return;
    VIEW = M.view;
    FLOOR = M.playoffFormat.minGp; SETTLE = M.SETTLE_GP;
    var past = M.nights({ when: "past" });
    PAST = past[0] || null;
    UP = M.nights({ when: "upcoming" });
    NEXT = UP.length ? UP[UP.length - 1] : null;     /* nights are newest first */
    /* the tables, the lines and the club figures are the regular season's (the model counts no other stage in them), so
       their counts and their "through" date are too: the newest night with a regular-season game. Health crawl 10
       (2026-11-25): Season 1's archive dated its regular-season tables "through Thu, Nov 19", the Cup's last night, and
       its source counted the 25 playoff finals into "all 241 Season 1 finals" */
    var regNight = past.filter(function (n) { return n.games.some(function (g) { return g.stage === "regular"; }); })[0] || null;
    var regular = function (g) { return g.isFinal && g.stage === "regular"; };
    FINALS = M.games.filter(regular).length;
    BOXED = M.games.filter(function (g) { return regular(g) && g.hasBox; });
    BOXLINES = BOXED.reduce(function (s, g) { return s + (g.lines || 0); }, 0);
    THROUGH = regNight ? "through " + regNight.short : "";
    /* the page kicker: a complete season names itself as final, never a date (it read "Standings, through Nov 19" with
       nothing on the page naming Season 1); else "through Oct 16" */
    THROUGH_K = VIEW.status === "complete" ? VIEW.name + ", final" : regNight ? "through " + M.etMonthDay(regNight.games[0].at) : VIEW.name;
    /* the Three Stars board counts every game with a box score, playoffs included, so it runs to the newest night of any stage */
    STARS_K = PAST ? "through " + M.etMonthDay(PAST.games[0].at) : VIEW.name;
    NOGAMES = !!VIEW.empty.finals;
    PREV = M.control.seasons.filter(function (s) { return s.status === "complete" && s.number < VIEW.season; }).map(function (s) { return s.number; }).sort(function (a, b) { return a - b; }).pop() || null;
    /* the awards tab shows the season on screen once it has closed, else the last one that has (Season 1's trophy room while
       Season 2 is played) */
    AW = M.control.seasons.map(function (s) { return s.number; }).filter(function (n) { return n <= VIEW.season && M.seasonClose(n); }).sort(function (a, b) { return a - b; }).pop() || VIEW.season;
    STARS = null; MOVES = null;
  }
  sync();
  /* the one empty state for a season with no final: what fills in, puck drop, and the last complete season's page */
  function noGames(hash, what, label) {
    var start = cal(VIEW.season, "starts_at");
    return S2.empty("none", "No " + VIEW.name + " games played yet", esc(what + (start ? " Puck drop is " + M.etLong(start.at) + "." : "")),
      /* QA visual 6 (2026-11-25): website furniture wears the website button (core.js, 2026-10-19), not the app's gray pill;
         QA round 2: S2.empty draws it from the action itself, and the address is core's one S2.seasonHref (this page kept
         its own copy) */
      PREV ? { t: "Season " + PREV + " " + label, href: S2.seasonHref(PREV, hash) } : "");
  }
  function source() { return "Source: all " + FINALS + " " + VIEW.name + " finals " + THROUGH + (BOXED.length ? ", and the " + S2.fmt(BOXLINES) + " box-score lines of the " + BOXED.length + " games with a box score" : "") + "."; }

  /* =====================================================================================================
     STANDINGS: division, league, race, playoffs, power (one page, five views; views repaint in place)
     ===================================================================================================== */
  var ST_VIEWS = [["division", "Division"], ["league", "League"], ["race", "Race"], ["playoffs", "Playoffs"], ["power", "Power"]];
  function stView(v) { return ST_VIEWS.some(function (x) { return x[0] === v; }) ? v : "division"; }

  function form(last5) {
    var a = (last5 || []).slice().reverse(), name = { W: "Win", L: "Loss", OT: "Overtime loss" };
    return '<span class="lg-form" role="img" aria-label="Last five, oldest first: ' + esc(a.map(function (x) { return name[x] || x; }).join(", ")) + '">' +
      a.map(function (x) { return '<i class="lg-f-' + (x === "W" ? "w" : x === "L" ? "l" : "o") + '"></i>'; }).join("") + "</span>";
  }
  function clubCell(r, league) {
    var t = r.team || { city: "", name: r.code };
    return '<a class="lg-club" href="' + esc(r.href) + '"><span class="lg-rk num">' + (league ? r.leagueRank : r.rank) + "</span>" + cr(r.code) +
      '<span class="lg-club-n"><span class="lg-city">' + esc(t.city) + ' </span><span class="lg-nm">' + esc(t.name) + "</span>" +
      (league ? '<span class="lg-div">' + esc(r.division) + "</span>" : "") + "</span>" +
      (r.mark ? '<abbr class="lg-mk" title="' + MARK[r.mark] + '">' + r.mark + "</abbr>" : "") + (me() && me().club === r.code ? YOU : "") +
      (r.inPlayoffs ? '<span class="sr">, in a playoff position</span>' : "") + (me() && me().club === r.code ? '<span class="sr">, your club</span>' : "") + "</a>";
  }
  function wins(rec) { return parseInt(String(rec || "0").split("-")[0], 10) || 0; }
  function stTable(id, rows, league) {
    var n = function (k) { return function (r) { return r[k]; }; };
    var cols = [
      { key: "rank", label: league ? "League" : "Club", cls: "lg-c1", dir: "asc", v: function (r) { return league ? r.leagueRank : r.rank; }, f: function (r) { return clubCell(r, league); } },
      { key: "pts", label: "PTS", title: "Points: two for any win, one for an overtime loss", cls: "lg-c2", v: n("pts"), f: function (r) { return '<b class="lg-pts">' + r.pts + "</b>"; } },
      { key: "gp", label: "GP", title: "Games played", v: n("gp"), f: function (r) { return r.gp; } },
      { key: "w", label: "W", title: "Wins", v: n("w"), f: function (r) { return r.w; } },
      { key: "l", label: "L", title: "Regulation losses", v: n("l"), dir: "asc", f: function (r) { return r.l; } },
      { key: "otl", label: "OTL", title: "Overtime losses", v: n("otl"), f: function (r) { return r.otl; } },
      { key: "pts_pct", label: "P%", title: "Share of the points available so far", v: n("pts_pct"), f: function (r) { return dec3(r.pts_pct); } },
      { key: "rw", label: "RW", title: "Regulation wins, the first tiebreaker after head-to-head", v: n("rw"), f: function (r) { return r.rw; } },
      { key: "gf", label: "GF", title: "Goals for", v: n("gf"), f: function (r) { return r.gf; } },
      { key: "ga", label: "GA", title: "Goals against", v: n("ga"), dir: "asc", f: function (r) { return r.ga; } },
      { key: "diff", label: "DIFF", title: "Goal difference", v: n("diff"), f: function (r) { return '<span class="' + (r.diff > 0 ? "lg-pos" : r.diff < 0 ? "lg-neg" : "") + '">' + signed(r.diff) + "</span>"; } },
      { key: "home", label: "Home", title: "Home record, wins, losses and overtime losses", v: function (r) { return wins(r.home); }, f: function (r) { return r.home; } },
      { key: "away", label: "Away", title: "Away record", v: function (r) { return wins(r.away); }, f: function (r) { return r.away; } },
      { key: "l5", label: "Last 5", title: "The last five results, newest on the right", v: function (r) { return (r.last5 || []).filter(function (x) { return x === "W"; }).length; }, f: function (r) { return form(r.last5); } },
      { key: "pp_pct", label: "PP%", title: "Power-play success", v: n("pp_pct"), f: function (r) { return pct1(r.pp_pct); } },
      { key: "pk_pct", label: "PK%", title: "Penalty-kill success", v: n("pk_pct"), f: function (r) { return pct1(r.pk_pct); } },
      { key: "games_left", label: "Left", title: "Regular-season games left", v: n("games_left"), f: function (r) { return r.games_left; } }
    ];
    return Table({ id: id, cols: cols, rows: function () { return rows; }, st: { key: "rank", dir: "asc" }, cls: "lg-st",
      caption: (league ? "League standings" : rows[0].division + " Division standings") + ", " + THROUGH,
      tie: function (a, b) { return (league ? a.leagueRank - b.leagueRank : a.rank - b.rank); },
      rowCls: function (r) { return (league && r.inPlayoffs ? "lg-in" : "") + (me() && me().club === r.code ? " lg-me" : ""); },
      after: league ? null : function (r, i, sorted, col) {
        /* the dashed playoff line only means something in table order */
        return col.key === "rank" && TBL[id].st.dir === "asc" && r.rank === M.cutLine.after && i < sorted.length - 1 ?
          '<tr class="lg-cut" aria-hidden="true"><td colspan="' + cols.length + '"><span>Playoff line</span></td></tr>' : "";
      } });
  }
  /* the legend reads the marks in the table; it is not a source note (those are in About this data) */
  function legendLine(league) {
    return '<p class="lg-legend">' + (league ? '<span><i class="lg-inmark" aria-hidden="true"></i>In a playoff spot today</span>' : "") +
      '<span><abbr class="lg-mk">x</abbr>Clinched a playoff spot</span><span><abbr class="lg-mk">z</abbr>Clinched the division</span><span><abbr class="lg-mk">e</abbr>Eliminated</span>' +
      (league ? "" : '<span><i class="lg-dash" aria-hidden="true"></i>The playoff line</span>') + "</p>";
  }
  /* the division's news in one headline: a tight top three beats a lead, a won division beats both */
  function divHead(d) {
    var r = d.rows, a = r[0], b = r[1], cut = M.cutLine.after, c = r[cut - 1];
    if (!a) return d.division + " Division";
    if (a.clinched === "division") return city(a) + " has won the " + d.division;
    var spread = c && c !== a ? a.pts - c.pts : null;
    if (r.length > cut && spread != null && spread <= 3) return spread === 0 ? "The " + d.division + "’s top three are level" : cap(word(spread)) + (spread === 1 ? " point splits" : " points split") + " the " + d.division + "’s top three";
    if (b && a.pts === b.pts) return city(a) + " and " + city(b) + " are level at the top";
    return city(a) + " leads the " + d.division + " by " + plural(a.pts - (b ? b.pts : 0), "point", "points");
  }
  function divStory(d) {
    var r = d.rows, cut = M.cutLine.after, inn = r.slice(0, cut), out = r.slice(cut), third = r[cut - 1], s = [];
    var won = inn.filter(function (x) { return x.clinched; }), open = inn.filter(function (x) { return !x.clinched; });
    if (won.length) {
      s.push(list(won.map(city)) + (won.length > 1 ? " have" : " has") + " clinched " + (won.length === 1 && won[0].clinched === "division" ? "the division." : won.length > 1 ? "playoff spots." : "a playoff spot."));
      var m = open.slice().sort(function (a, b) { return a.magic - b.magic; })[0];
      if (m) s.push(city(m) + "’s magic number is " + m.magic + ".");
    } else if (inn.length) s.push(list(inn.map(city)) + " hold the " + word(inn.length) + " playoff spots on " + list(inn.map(function (x) { return x.pts; })) + " points.");
    var f = out[0];
    if (f && third) {
      var gap = third.pts - f.pts;
      s.push(f.eliminated ? city(f) + " is eliminated." : city(f) + (gap > 0 ? " is " + plural(gap, "point", "points") + " behind " + city(third) + " for the last spot" : " is level with " + city(third) + " for the last spot") + ", with " + leftNote(r, true) + ".");
    }
    return esc(s.join(" "));
  }
  function stDivision() {
    TBL = {};
    return M.standings("division").map(function (d, i) {
      var T = stTable("st" + d.division, d.rows, false);
      return '<section class="lg-sec" aria-labelledby="hst' + i + '">' + secHead({ kicker: d.division + " Division", id: "hst" + i, title: divHead(d), text: divStory(d),
        aside: i === 0 ? arrow("#/standings?view=race", "The playoff race", "race") : arrow("#/standings?view=playoffs", "Projected bracket", "playoffs") }) + T.html() + "</section>";
    }).join("") + legendLine(false);
  }
  function stLeague() {
    TBL = {};
    var rows = M.standings("league"), a = rows[0], b = rows[1], z = rows[rows.length - 1];
    var T = stTable("stLeague", rows, true);
    var title = !a ? "All " + word(M.teams.length) + " clubs" : b && a.pts === b.pts ? city(a) + " and " + city(b) + " share the league lead" : city(a) + " leads the league on " + a.pts + " points";
    var text = "Playoff spots are won inside each division, so this table is for comparison." + (b && z ? " " + city(b) + " is second on " + b.pts + ", and " + plural(a.pts - z.pts, "point separates", "points separate") + " first from last." : "");
    return '<section class="lg-sec" aria-labelledby="hstl">' + secHead({ kicker: "All " + word(rows.length) + " clubs", id: "hstl", title: title, text: esc(text), aside: arrow("#/standings", "Division tables", "division") }) +
      T.html() + "</section>" + legendLine(true);
  }

  /* the race: today's points, the most each club can still reach, and the total that clinches outright */
  function raceHead(d) {
    var inn = d.rows.slice(0, M.cutLine.after), open = inn.filter(function (x) { return !x.clinched && !x.eliminated; });
    if (inn.length && !open.length) return "The " + d.division + "’s playoff spots are decided";
    var m = open.slice().sort(function (a, b) { return a.magic - b.magic; })[0];
    return m ? city(m) + "’s magic number is " + m.magic : d.division + " Division race";
  }
  function stRace() {
    var race = M.standings("race"), all = [];
    race.forEach(function (d) { d.rows.forEach(function (r) { all.push(r); }); });
    var target = function (r) { return r.pts + r.magic; };            /* magic = the clinch line minus today's points */
    var scale = Math.ceil(Math.max.apply(null, all.map(function (r) { return Math.max(r.maxPts, r.pts + r.magic); }).concat([10])) / 10) * 10;
    var pctOf = function (v) { return Math.min(100, v / scale * 100).toFixed(2) + "%"; };
    return race.map(function (d, i) {
      var third = d.rows[M.cutLine.after - 1];
      return '<section class="lg-sec" aria-labelledby="hrc' + i + '">' + secHead({ kicker: d.division + " Division", id: "hrc" + i, title: raceHead(d),
        /* the magic-number explanation is said once, in the first division; each row then states only its own fact */
        text: esc(cap(leftNote(d.rows, true)) + "." + (i === 0 ? " Every point a club in a spot earns, and every point its chaser misses, counts its magic number down by one." : "")),
        aside: i === 0 ? arrow("#/standings", "Division tables", "division") : "" }) +
        '<ol class="lg-race-list">' + d.rows.map(function (r) {
          var tgt = target(r), alone = r.magic <= r.maxPts - r.pts;
          var status = r.clinched === "division" ? '<span class="chip win">Clinched division</span>' : r.clinched ? '<span class="chip win">Clinched a spot</span>' :
            r.eliminated ? '<span class="chip loss">Eliminated</span>' : r.inPlayoffs ? '<span class="lg-race-mg">Magic number <b class="num">' + r.magic + "</b></span>" :
            '<span class="lg-race-mg">' + (alone ? "Chasing" : "Needs help") + "</span>";
          var why = r.clinched === "division" ? "No club can catch them for first." : r.clinched ? "They can no longer finish below third." : r.eliminated ? "Three clubs are out of reach." :
            r.inPlayoffs ? "" : third ? plural(third.pts - r.pts, "point", "points") + " behind " + esc(third.code) + " for third" : "";
          var cut = r.rank === M.cutLine.after && d.rows.length > M.cutLine.after ? '<li class="lg-race-cut" aria-hidden="true"><span>Playoff line</span></li>' : "";
          return '<li class="lg-race-row' + (r.inPlayoffs ? " in" : "") + '"><a class="lg-race-club" href="' + esc(r.href) + '"><span class="lg-rk num">' + r.rank + "</span>" + cr(r.code) +
            '<span class="lg-race-nm">' + esc(r.team.name) + "</span></a>" +
            '<div class="lg-race-track" role="img" aria-label="' + esc(r.team.full + ": " + r.pts + " points, can reach " + r.maxPts + ", clinches outright at " + tgt) + '">' +
              /* each club's points in its own color, so eight clubs read as eight clubs; the reachable bar stays neutral */
              '<span class="lg-race-max" style="width:' + pctOf(r.maxPts) + '"></span><span class="lg-race-pts c-pct" style="--p:' + pctOf(r.pts) + (r.team.color ? ";--club:" + esc(r.team.color) : "") + '"></span>' +
              '<span class="lg-race-tick' + (tgt > r.maxPts ? " out" : "") + '" style="left:' + pctOf(tgt) + '"></span></div>' +
            '<div class="lg-race-num"><b class="d-num">' + r.pts + '</b><span>of ' + r.maxPts + "</span></div>" +
            '<div class="lg-race-st">' + status + (why ? '<span class="lg-race-why">' + why + "</span>" : "") + "</div></li>" + cut;
        }).join("") + "</ol></section>";
    }).join("") +
      '<ul class="lg-key" aria-label="How to read the race"><li><i class="k-pts" aria-hidden="true"></i>Points today, in the club&rsquo;s color</li><li><i class="k-max" aria-hidden="true"></i>The most a club can still reach</li>' +
      '<li><i class="k-tick" aria-hidden="true"></i>The total that clinches a spot outright</li><li><i class="k-tick out" aria-hidden="true"></i>Past the bar: cannot clinch alone</li></ul>';
  }

  /* the projected bracket on the ink band, the match center of the page (Juventus): three clubs a division (Rule 8.1) */
  function slot(row, seed, empty) {
    if (!row) return '<div class="lg-slot tbd"><span class="lg-seed d-num">' + (seed || "") + '</span><span class="lg-slot-n"><span class="lg-slot-t">' + esc(empty || "To be decided") + "</span></span></div>";
    return '<a class="lg-slot" href="' + esc(row.href) + '"><span class="lg-seed d-num">' + seed + "</span>" + cr(row.code) +
      '<span class="lg-slot-n"><span class="lg-slot-t">' + esc(row.team.name) + '</span><span class="lg-slot-r num">' + row.w + "-" + row.l + "-" + row.otl + ", " + row.pts + " pts</span></span></a>";
  }
  function stPlayoffs() {
    var P = M.standings("playoffs"), f = P.format, start = cal(VIEW.season, "playoffs_start_at"), byes = [], ties = [];
    P.divisions.forEach(function (d) { var s = d.rounds[0]; if (s.bye) byes.push(city(s.bye)); var x = s.series[0]; if (x && x.high && x.low) ties.push(city(x.high) + " would meet " + city(x.low)); });
    var text = (byes.length ? list(byes) + " would take the byes" + (ties.length ? "; " : ". ") : "") + (ties.length ? list(ties) + ". " : "") +
      "Every series is best of " + word(f.bestOf) + (start ? ", from " + M.etLong(start.at) : "") + ".";
    var div = function (d) {
      var semi = d.rounds[0], fin = d.rounds[1], s = semi.series[0];
      return '<section class="lg-br-div" aria-label="' + esc(d.division) + ' Division bracket"><h3 class="d-3">' + esc(d.division) + '</h3><div class="lg-br-rounds">' +
        '<div class="lg-br-col"><span class="lg-br-k">' + esc(cap(semi.name)) + '</span><div class="lg-mu">' + slot(s.high, 2) + slot(s.low, 3) + "</div>" +
          '<div class="lg-mu bye">' + slot(semi.bye, 1) + '<span class="lg-bye">Bye to the division final</span></div></div>' +
        '<div class="lg-br-col"><span class="lg-br-k">' + esc(cap(fin.name)) + '</span><div class="lg-mu">' + slot(fin.series[0].high, 1) +
          slot(null, "", "Winner of " + (s.high ? s.high.code : "2") + " vs " + (s.low ? s.low.code : "3")) + "</div></div></div></section>";
    };
    var band = inkBand("lg-po", secHead({ kicker: "Projected bracket", id: "hpo", title: "If the season ended today", text: esc(text), aside: arrow("#/rulebook?rule=8.1", "Rule 8.1") }) +
      '<div class="lg-bracket">' + div(P.divisions[0]) +
        '<section class="lg-br-final" aria-label="Final"><span class="lg-br-k">' + esc(cap(P.final.name)) + '</span><span class="lg-cup" aria-hidden="true">' + S2.ic("trophy") + "</span>" +
          '<p class="d-3">East champion vs West champion</p><p class="lg-br-sub">Best of ' + word(f.bestOf) + ". The Stanley Cup goes to the winner.</p></section>" +
      div(P.divisions[1]) + "</div>" +
      /* v4.42 (live 2026-11-01): the rounds draw themselves, round 1 from the final table, each later round once the one
         before it is decided; the live public bracket says so in this sentence (part5a_public.js) */
      '<p class="lg-br-auto">Drawn automatically once every series of the previous round is decided (Rule 8.3).</p>', "Projected bracket");
    var spots = f.perDiv * P.divisions.length;
    return band + '<section class="lg-sec" aria-labelledby="hfmt">' + secHead({ kicker: "Format", id: "hfmt", title: cap(word(spots)) + " clubs, " + word(f.rounds) + " rounds, best of " + word(f.bestOf),
      text: "The top " + word(f.perDiv) + " in each division qualify. The first seed waits for the winner of second against third, and the two division champions meet in the final." }) +
      '<dl class="spec lg-spec">' +
        fact("Field", "Top " + word(f.perDiv) + " in each division, " + spots + " clubs") + fact("Series", "Best of " + word(f.bestOf) + ", every round") +
        fact("First seed", "A bye through the " + f.roundNames[0]) + fact("Starts", start ? md(start) + ", " + start.time + " ET" : "To be announced") +
        fact("To be dressed", FLOOR + " regular-season games, prorated for a late arrival (Rule 8.3)") + fact("Seeds", "Fixed when the league office certifies the final table") +
        fact("The draw", "Automatic: round 1 when the regular season ends, each later round once the one before it is decided") +
      "</dl></section>";
  }
  function fact(k, v) { return "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>"; }

  /* power rankings: tap a club to see the five ingredients (the live team OVR, part2_engine.js:710) */
  var PARTS = [["record", "Record", 38], ["goalDiff", "Goal difference", 22], ["goaltending", "Goaltending", 14], ["depth", "Depth", 14], ["form", "Form, last five", 12]];
  function move(m) {
    if (!m) return '<span class="lg-mv flat" title="No change"><span class="sr">No change</span><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>';
    return '<span class="lg-mv ' + (m > 0 ? "up" : "down") + '"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="' + (m > 0 ? "M2.5 6.2L5 3.7l2.5 2.5" : "M2.5 3.8L5 6.3l2.5-2.5") + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="num">' + Math.abs(m) + '</span><span class="sr">' + (Math.abs(m) === 1 ? " place" : " places") + (m > 0 ? " up" : " down") + "</span></span>";
  }
  function stPower() {
    var rows = M.standings("power"), a = rows[0], b = rows[1], lg = M.standings("league");
    var up = rows.filter(function (p) { return p.move > 0; }).sort(function (x, y) { return y.move - x.move; })[0], dn = rows.filter(function (p) { return p.move < 0; }).sort(function (x, y) { return x.move - y.move; })[0];
    var text = (b ? city(b) + " is second at " + b.ovr + ". " : "") + (up ? city(up) + " climbed " + plural(up.move, "place", "places") + (dn ? " and " + city(dn) + " fell " + plural(-dn.move, "place", "places") : "") + " since the last completed week. " : "") +
      "A reading of form, not the standings: the table decides the playoffs.";
    return '<section class="lg-sec" aria-labelledby="hpw">' + secHead({ kicker: "Power rankings", id: "hpw", title: a ? city(a) + " tops the power rankings at " + a.ovr : "Power rankings", text: esc(text),
      aside: arrow("#/standings", "Division tables", "division") }) +
      '<ol class="lg-pw">' + rows.map(function (p) {
        var st = lg.filter(function (x) { return x.code === p.code; })[0] || {};
        return '<li class="lg-pw-row"><button type="button" class="lg-pw-btn" aria-expanded="false" aria-controls="pw-' + p.code + '">' +
          '<span class="lg-pw-rk d-num">' + p.rank + "</span>" + move(p.move) + cr(p.code) +
          '<span class="lg-pw-n"><span class="lg-pw-t"><span class="lg-city">' + esc(p.team.city) + ' </span>' + esc(p.team.name) + '</span><span class="lg-pw-s num">' + (st.w != null ? st.w + "-" + st.l + "-" + st.otl + ", " : "") + p.pts + " pts</span></span>" +
          '<span class="lg-pw-ovr"><span class="d-num">' + p.ovr + '</span><span class="lg-pw-k">OVR</span></span>' + chev() + "</button>" +
          '<div class="lg-pw-more" id="pw-' + p.code + '"><div class="lg-pw-in">' + PARTS.map(function (x) {
            var v = p.parts[x[0]];
            return '<div class="lg-part"><span class="lg-part-k">' + x[1] + ' <span class="lg-part-w">' + x[2] + '%</span></span><span class="lg-part-bar"><i style="width:' + v + '%"></i></span><span class="num lg-part-v">' + v + "</span></div>";
          }).join("") + '<a class="arrow lg-pw-open" href="' + esc(p.href) + '"><span>Open ' + esc(p.team.name) + "</span>" + S2.ic("chev") + "</a></div></div></li>";
      }).join("") + "</ol></section>";
  }
  function bindPower(root) {
    S2.$$(".lg-pw-btn", root).forEach(function (b) {
      b.addEventListener("click", function () {
        var li = b.parentNode, open = !li.classList.contains("open");
        /* the 0fr grid only hides the panel from the eye; league.css hides it with visibility (after the collapse ends), which
           keeps its link out of the tab order and the tree without an inert control on the page (the open concept, v2) */
        li.classList.toggle("open", open); b.setAttribute("aria-expanded", String(open));
        if (open && !S2.reduce.matches) S2.$$(".lg-part-bar i", li).forEach(function (i, k) {
          i.animate([{ transform: "scaleX(0.02)" }, { transform: "scaleX(1)" }], { duration: 520, delay: 60 + k * 35, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "backwards" });
        });
      });
    });
  }
  function stBody(v) {
    TBL = {};
    return v === "league" ? stLeague() : v === "race" ? stRace() : v === "playoffs" ? stPlayoffs() : v === "power" ? stPower() : stDivision();
  }
  function stAbout(v) {
    var tie = "Clubs are ordered by points, then head-to-head among tied clubs, regulation wins, goal difference and goals scored (" + rule("8.2") + "). A forfeit counts as a regulation result. Tap any heading to sort; tap it again to flip the order.";
    var P = M.standings("playoffs");
    return paras([
      v === "race" ? "Two points for any win, one for an overtime loss (" + rule("8.1") + "). The solid bar is a club&rsquo;s points today and the light bar the most it can still reach, two for each game left. The tick is the total that clinches a playoff spot whatever anyone else does; a dotted tick past the end of the light bar means the club cannot clinch on its own. The magic number is how far a club in a playoff spot is from that tick." :
      v === "playoffs" ? esc(P.note) + " Seeds are fixed when the league office certifies the final table (" + rule("8.1") + ")." :
      v === "power" ? "One rating from 60 to 96 that blends record (38%), goal difference (22%), goaltending (14%), roster depth from position ratings (14%) and the last five results (12%); tap a club to see each part scored out of 100. Arrows compare with the order before the last completed week. Depth uses today&rsquo;s position ratings." : tie,
      v === "division" ? "The dashed playoff line sits under the third club: " + esc(M.cutLine.label.toLowerCase()) + "." : "",
      esc(source())
    ]);
  }
  function bindSt(root, v) { bindTables(root); if (v === "power") bindPower(root); }
  function crestStrip() {
    return '<nav class="lg-strip reveal" aria-label="Clubs">' + M.standings("league").map(function (r) {
      return '<a class="lg-strip-a" href="' + esc(r.href) + '" aria-label="' + esc(r.team.full + ", " + ord(r.leagueRank) + " in the league, " + r.pts + " points") + '">' + cr(r.code, "lg") + '<span aria-hidden="true">' + esc(r.code) + "</span></a>";
    }).join("") + "</nav>";
  }
  function stHero() {
    var lg = M.standings("league"), divs = M.standings("division"), spots = M.cutLine.after * divs.length, top = lg[0];
    /* health crawl 10 (2026-11-25): a complete season is titled from its result, its final table's first club, with the
       champion in the sentence; Season 1's archive read "The playoff field is set" three weeks after the Cup was won */
    if (VIEW.status === "complete") {
      var cup = cupOf(VIEW.season), endsC = cal(VIEW.season, "ends_at");
      return hero({ kicker: "Standings, " + THROUGH_K, title: top ? city(top) + " finished first with " + top.pts + " points" : "Final standings",
        lede: esc((cup ? finalLine(cup) + ", to win the Stanley Cup. " : "") + (endsC ? "The regular season ended " + M.etLong(endsC.at) + "." : "")), foot: crestStrip() });
    }
    var won = lg.filter(function (r) { return r.clinched; }), open = spots - won.length, title;
    if (won.length && open > 0) title = (won.length === 1 ? city(won[0]) + " is in. " : list(won.map(city)) + " are in. ") + cap(word(open)) + (open === 1 ? " spot remains." : " spots remain.");
    else if (won.length) title = "The playoff field is set";
    else title = top ? city(top) + " leads the league on " + top.pts + " points" : "Standings";
    var s = [];
    if (won.length) s.push(city(won[0]) + " clinched " + (won[0].clinched === "division" ? "the division" : "a playoff spot") + " with " + won[0].pts + " points" + (won[0] === top ? ", the most in the league." : "."));
    var tight = divs.map(function (d) { var c = d.rows[M.cutLine.after - 1]; return { d: d, spread: c && d.rows.length > M.cutLine.after ? d.rows[0].pts - c.pts : 99 }; }).sort(function (a, b) { return a.spread - b.spread; })[0];
    if (tight && tight.spread <= 3) s.push("In the " + tight.d.division + ", " + word(tight.spread) + (tight.spread === 1 ? " point splits " : " points split ") + list(tight.d.rows.slice(0, M.cutLine.after).map(city)) + ".");
    var ends = cal(VIEW.season, "ends_at"), lo = Math.min.apply(null, lg.map(function (r) { return r.games_left; })), hi = Math.max.apply(null, lg.map(function (r) { return r.games_left; }));
    /* QA visual 11 and worst 3 (2026-11-25): a played-out schedule is never "Every club has 0 games left", and a date behind
       the league's clock is said in the past tense */
    var endsW = ends ? "the regular season " + (ahead(ends) ? "ends " : "ended ") + M.etLong(ends.at) : "";
    if (!hi) s.push(endsW ? cap(endsW) + "." : "Every club has played its schedule.");
    else s.push((lo === hi ? "Every club has " + plural(hi, "game", "games") + " left" : "Clubs have " + lo + " to " + hi + " games left") + (endsW ? "; " + endsW + "." : "."));
    return hero({ kicker: "Standings, " + THROUGH_K, title: title, lede: esc(s.join(" ")), foot: crestStrip() });
  }

  function stEmpty() {
    var start = cal(VIEW.season, "starts_at");
    return hero({ kicker: "Standings, " + VIEW.name, title: start ? VIEW.name + " starts " + M.etLong(start.at).replace(/^\w+, /, "") : "No games played yet",
        lede: esc("Two points for any win, one for an overtime loss, and the top " + word(M.cutLine.after) + " in each division make the playoffs") + " (" + rule("8.1") + ")." }) +
      '<div class="lg-body reveal">' + noGames("#/standings", "Every club starts on zero; the tables, the race, the bracket and the power rankings fill in from the first final.", "final standings") + "</div>";
  }
  S2.page("standings", {
    title: "Standings", tab: "standings",
    render: function (r) {
      if (!M) return fail("Standings");
      sync();
      if (NOGAMES) return stEmpty();
      var v = stView(r.q.view);
      return stHero() + tabsBar("stSeg", ST_VIEWS, v, "Standings view") +
        '<div id="stBody" class="lg-body reveal">' + stBody(v) + "</div>" + about(stAbout(v));
    },
    after: function (root, r) {
      if (!M || NOGAMES) return;
      var v = stView(r.q.view);
      bindSt(root, v);
      var ctl = S2.segmented(S2.$("#stSeg", root), function (nv, b) {
        sync();
        setQ("standings", { view: nv === "division" ? "" : nv });
        toTabs(root); intoRow(b);
        swap(S2.$("#stBody", root), stBody(nv)); bindSt(root, nv);
        S2.$("#lgAboutB", root).innerHTML = stAbout(nv);
      });
      bindViewLinks(root, ctl);
      intoRowOnLoad(S2.$("#stSeg", root));
    }
  });

  /* =====================================================================================================
     STATS: leaders (the title board), skaters, goaltenders, clubs, players directory, awards
     ===================================================================================================== */
  var SX_TABS = [["leaders", "Leaders"], ["skaters", "Skaters"], ["goalies", "Goaltenders"], ["teams", "Clubs"], ["players", "Players"], ["awards", "Awards"]];
  function sxTab(t) { return SX_TABS.some(function (x) { return x[0] === t; }) ? t : "leaders"; }
  var TITLE = {
    points_title: ["Scoring Title", "Points per game skated", "points", "pts_pg"],
    goals_title: ["Goal-scoring Title", "Goals per game skated", "goals", "g_pg"],
    assists_title: ["Playmaking Title", "Assists per game skated", "assists", "a_pg"],
    goaltending_title: ["Goaltending Title", "Fewest goals against per game in goal", "goals against", "gaa"]
  };
  /* QA visual 3 (2026-11-25): the title race board. s2_league carries none (model.js M.partial.titles: "read by the pages
     that show it"), and no page read it, so every title said "not loaded" in the Season 1 archive and would all of Season 2.
     QA round 2 (A7, 2026-11-25): this page read statistical_title_board itself (its own TB, tbRead and tbApply); the read is
     the model's one now (M.readTitles: the season on screen, five a title, once per league read, kept by season across a
     rebuild and put back until the next read lands), which Today's titles and the profile's race places share. A failure
     is said on the board with its reason (M.titlesErr) */
  /* the board's own repaint: the titles section, the players short of the floor and the hero's mention of the race, each in
     place (the page is never routed again). Bound once per drawn page; a reader who has left the tab is not repainted */
  function tbLoad(root, t, again) {
    if (NOGAMES || (t !== "leaders" && t !== "goalies") || (!again && !M.titlesNeeded())) return;
    M.readTitles(again).then(function () {
      if (!root.isConnected || S2.parse().name !== "stats") return;   /* the reader has moved on */
      var now = sxTab(S2.parse().q.tab), host = S2.$("#ttHost", root);
      /* the first board in place of the placeholder enters as a section does (its numbers count up); a refresh of a board
         on screen is the quiet swap. A quiet swap finishes the host's animations, which the placeholder's endless shimmer
         cannot do, so the placeholder never takes the quiet path */
      if (host) { swap(host, titlesBlock(), !S2.$(".lg-tt-skel", host)); bindTitles(root); }
      /* the hero names the race leader on these two tabs; it is swapped only when its words change */
      var old = S2.$(".lg-hero", root), box = document.createElement("div"); box.innerHTML = sxHero(now);
      if ((now === "leaders" || now === "goalies") && old && old.textContent !== box.textContent) heroSwap(root, now);
    });
  }
  /* every column's Try again (QA round 2: only the first of the four was bound). The read is asked for first, which clears
     the model's failure, so the board drawn meanwhile is the placeholder */
  function bindTitles(root) {
    S2.$$('#ttHost [data-tb="retry"]', root).forEach(function (again) {
      again.addEventListener("click", function () { tbLoad(root, "leaders", true); var host = S2.$("#ttHost", root); if (host) host.innerHTML = titlesBlock(); });
    });
  }
  /* a shared place reads as a tie, "T2", so two players level on the board never look first and second (audit 2026-11-09;
     commissioner on the leaderboards: "easy to understand at a glance") */
  function rankCell(rank, all) {
    var n = all.filter(function (x) { return x === rank; }).length;
    return '<span class="lg-rk num"' + (n > 1 ? ' title="Tied for ' + ord(rank) + '"' : "") + ">" + (n > 1 ? "T" : "") + rank + (n > 1 ? '<span class="sr"> (tied)</span>' : "") + "</span>";
  }
  /* one title as an editorial column: the leader large, the chasers as bars against the leader's rate. The sub line says
     what is measured and who qualifies, so the board reads without the method (audit 2026-11-09) */
  function titleCol(cat) {
    var rows = M.honors.titles[cat] || [], meta = TITLE[cat], top = rows[0], g = cat === "goaltending_title", dec = 2;   /* every rate to two decimals, as the profile and the tables (audit 2026-11-09) */
    var ranks = rows.map(function (t) { return t.rank; }), level = rows.filter(function (t) { return top && t.rank === top.rank; }).length;
    var h = '<h3 class="d-3">' + meta[0] + '</h3><p class="lg-tt-sub">' + meta[1] + ". " + (g ? "At least " + FLOOR + " games in goal" : "At least " + FLOOR + " games skated") + ".</p>";
    /* the board is the model's read (M.readTitles, tbLoad): while it is on its way the column holds its place, and a failed
       read says so with the reason; never that nobody qualifies, and never the old "not loaded on this page".
       QA round 2 review: in plain words first and the league's own words after them, marked as its own, as Today and News
       say the same failed read (it printed the database's message as the end of its sentence).
       shortcut: a third copy of that pattern (today.js leadersSection, office.js readFailed); one helper beside S2.empty
       when core next opens */
    var tbErr = M.partial.titles ? M.titlesErr() : null;
    if (M.partial.titles) return '<article class="lg-tt">' + h + (tbErr
      ? '<p class="lg-tt-none" role="alert">The league\'s data service reported a problem, so this race cannot be shown. Try again in a moment.</p>' +
        (tbErr.message ? '<p class="lg-tt-none lg-tt-why">The league said: “' + esc(tbErr.message) + "”</p>" : "") + '<p><button type="button" class="btn site outline sm" data-tb="retry">Try again</button></p>'
      : '<div class="lg-tt-skel" role="status"><span class="sr">Loading the ' + esc(meta[0]) + ' race</span><span class="skeleton lg-tt-sk-hero" aria-hidden="true"></span>' +
        '<span class="skeleton lg-tt-sk-val" aria-hidden="true"></span><span class="skeleton lg-tt-sk-row" aria-hidden="true"></span><span class="skeleton lg-tt-sk-row" aria-hidden="true"></span><span class="skeleton lg-tt-sk-row" aria-hidden="true"></span></div>') + "</article>";
    if (!top) return '<article class="lg-tt">' + h + '<p class="lg-tt-none">Nobody has reached the ' + FLOOR + "-game floor at this position yet.</p></article>";
    return '<article class="lg-tt" aria-label="' + meta[0] + '">' + h +
      '<a class="lg-tt-hero" href="' + esc(top.href) + '">' + cr(top.club, "lg") + '<span class="lg-tt-who"><span class="lg-tt-tag">' + esc(top.tag) + '</span><span class="lg-tt-line">' + esc(teamName(top.club)) + ", " + top.total + " " + meta[2] + " in " + top.gp + " games" + (level > 1 ? ", tied for first" : "") + "</span></span></a>" +
      '<p class="lg-tt-val"><span class="d-num" data-count="' + top.value + '" data-dec="' + dec + '">' + top.value.toFixed(dec) + '</span><span>' + (g ? "goals against a game" : meta[2] + " a game") + "</span></p>" +
      '<ol class="lg-tt-list">' + rows.slice(1).map(function (t) {
        var w = g ? top.value / t.value : t.value / top.value;
        return "<li>" + rankCell(t.rank, ranks) + cr(t.club) + '<a href="' + esc(t.href) + '" class="lg-tt-name">' + esc(t.tag) + "</a>" +
          '<span class="lg-tt-bar" aria-hidden="true"><i class="c-pct" style="--p:' + (w * 100).toFixed(1) + '%"></i></span><span class="num lg-tt-v">' + t.value.toFixed(dec) + "</span></li>";
      }).join("") + "</ol>" +
      (rows.length < 5 ? '<p class="lg-tt-none">Only ' + word(rows.length) + " " + (g ? (rows.length === 1 ? "goaltender has" : "goaltenders have") + " reached the floor in goal" :
        (rows.length === 1 ? "skater has" : "skaters have") + " reached the floor in games skated") + " so far.</p>" : "") + "</article>";
  }
  function titlesHead() {
    var cats = Object.keys(TITLE), by = {}, best = null;
    cats.forEach(function (k) { var t = (M.honors.titles[k] || [])[0]; if (t) { by[t.id] = by[t.id] || { t: t, n: 0 }; by[t.id].n++; } });
    Object.keys(by).forEach(function (k) { if (!best || by[k].n > best.n) best = by[k]; });
    if (M.partial.titles) return cap(word(cats.length)) + " title races";   /* the board is still on its way (M.readTitles): no leader count to state */
    return best && best.n > 1 ? best.t.tag + " leads " + word(best.n) + " of the " + word(cats.length) + " title races" : cap(word(cats.length)) + " title races, " + word(Object.keys(by).length) + " leaders";
  }
  /* players whose rate would make the board, but who are short of the floor at that position today: one row per player */
  function notYet() {
    if (M.partial.titles) return "";   /* the board is still on its way or failed (titleCol says which) */
    var by = {};
    Object.keys(TITLE).forEach(function (cat) {
      var board = M.honors.titles[cat] || [], g = cat === "goaltending_title", key = TITLE[cat][3], on = {};
      if (!board.length) return;
      board.forEach(function (b) { on[b.id] = 1; });
      var worst = board[board.length - 1].value;      /* must beat the last qualifier, so a short board is not a free pass */
      M.lines({ role: g ? "G" : "S", minGp: SETTLE }).forEach(function (l) {
        var v = l[key]; if (l.former || on[l.pid] || l.gp >= FLOOR || v == null || !(g ? v < worst : v > worst)) return;
        var place = board.filter(function (b) { return g ? b.value <= v : b.value >= v; }).length + 1;
        var o = by[l.pid + l.role] = by[l.pid + l.role] || { l: l, g: g, items: [] };
        o.items.push({ cat: cat, v: v, place: place });
      });
    });
    var rows = Object.keys(by).map(function (k) { var o = by[k]; o.items.sort(function (a, b) { return a.place - b.place; }); return o; })
      .sort(function (a, b) { return b.l.gp - a.l.gp || a.items[0].place - b.items[0].place; }).slice(0, 6);
    if (!rows.length) return "";
    var short = function (cat) { return TITLE[cat][0].replace(" Title", ""); };
    /* everyone level on the most games is closest, not just the first of them in the list */
    var near = rows.filter(function (x) { return x.l.gp === rows[0].l.gp; }).map(function (x) { return x.l.tag; });
    return '<section class="lg-sec lg-sec-tight" aria-labelledby="hny">' + secHead({ kicker: "Short of the floor", id: "hny", size: "d-3", h: "h3", title: "Not on the board yet",
      text: esc(cap(word(rows.length)) + (rows.length === 1 ? " player has" : " players have") + " a rate good enough for the board and fewer than " + FLOOR + " games at that position. " + list(near) + (near.length > 1 ? " are" : " is") + " closest, at " + rows[0].l.gp + ".") }) +
      '<ul class="lg-ny-list">' + rows.map(function (x) {
        var top = x.items[0];
        return '<li><a href="' + esc(x.l.href) + '" class="lg-ny-a">' + cr(x.l.club) + '<span class="lg-ny-n"><span class="lg-ny-t">' + esc(x.l.tag) + '</span><span class="lg-ny-s">Would be ' +
          x.items.map(function (it) { return ord(it.place) + " in " + short(it.cat); }).join(", ") + "</span></span>" +
          '<span class="lg-ny-v"><span class="num">' + top.v.toFixed(2) + '</span><span class="lg-ny-s">' + (x.g ? "GAA" : TITLE[top.cat][2] + " a game") + "</span></span>" +
          '<span class="lg-ny-gp" aria-label="' + x.l.gp + " of " + FLOOR + ' games"><span class="lg-ny-meter" aria-hidden="true"><i style="width:' + Math.min(100, x.l.gp / FLOOR * 100).toFixed(1) + '%"></i></span><span class="lg-ny-s num">' + x.l.gp + "/" + FLOOR + " GP</span></span></a></li>";
      }).join("") + "</ul></section>";
  }

  /* the play style map: a scatter of two rates with a median crosshair, so a skater's kind of game reads at a glance */
  var MAP_UNITS = [["all", "All"], ["F", "Forwards"], ["D", "Defense"]];
  function mapPoints(unit) {
    var lines = M.lines({ role: "S", minGp: SETTLE }).filter(function (l) { return unit === "all" || (unit === "D" ? l.group === "D" : l.group !== "D"); });
    var top = lines.slice().sort(function (a, b) { return b.pts_pg - a.pts_pg; }).slice(0, window.innerWidth < 600 ? 2 : 3).map(function (l) { return l.pid; });
    return lines.map(function (l) { return { x: l.pts_pg, y: l.hits_pg, label: l.tag, href: l.href, hi: top.indexOf(l.pid) >= 0, l: l }; })
      .sort(function (a, b) { return (a.hi ? 1 : 0) - (b.hi ? 1 : 0); });          /* the labeled leaders draw last, on top */
  }
  function nice(max) { if (max <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(max))), m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }   /* the scale charts.scatter uses */
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; }
  var MAP = { unit: "all", pts: [], W: 640, H: 380, mx: 0, my: 0, dx: 1, dy: 1 };
  var QUADS = [["Grinders", "Fewer points, more hits"], ["Two-way threats", "More points and more hits"], ["Depth", "Fewer points, fewer hits"], ["Pure scorers", "More points, fewer hits"]];
  function mapChart(unit) {
    var pts = MAP.pts = mapPoints(unit), phone = window.innerWidth < 600;
    if (!pts.length) return '<p class="lg-none-p">No skater in this group has ' + SETTLE + " games yet.</p>";
    MAP.W = phone ? 360 : 760; MAP.H = phone ? 340 : 440;
    MAP.mx = median(pts.map(function (p) { return p.x; })); MAP.my = median(pts.map(function (p) { return p.y; }));
    /* each axis ends at the next whole number above its data. The kit's scatter rounds its range up to a 1, 2, 5 or 10 step
       and takes no range of its own, so 5.2 points a game made an axis to 10 with the right half empty; the points go in
       rescaled so that step lands exactly on our end (v / dx * nice(dx) never passes nice(dx)).
       shortcut: rescaled units, until charts.js scatter accepts o.xMax/o.yMax (then pass dx and dy and drop sx/sy);
       bindMap checks that the kit still draws where this expects and says so in the console if not */
    MAP.dx = Math.max(1, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.x; }))));
    MAP.dy = Math.max(1, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.y; }))));
    var sx = function (v) { return v / MAP.dx * nice(MAP.dx); }, sy = function (v) { return v / MAP.dy * nice(MAP.dy); };
    return S2.charts.scatter({ points: pts.map(function (p) { return { x: sx(p.x), y: sy(p.y), label: p.label, href: p.href, hi: p.hi }; }),
      w: MAP.W, h: MAP.H, mx: sx(MAP.mx), my: sy(MAP.my),
      xLabel: "Points per game", yLabel: "Hits per game", quads: QUADS.map(function (q) { return q[0]; }),
      label: "Play style map: points per game against hits per game for " + pts.length + " skaters" });
  }
  /* who sits deepest in each corner: the furthest from both medians, measured against each axis's own range */
  function mapSide() {
    var pts = MAP.pts; if (!pts.length) return "";
    var sx = Math.max.apply(null, pts.map(function (p) { return p.x; })) || 1, sy = Math.max.apply(null, pts.map(function (p) { return p.y; })) || 1;
    return QUADS.map(function (q, i) {
      var right = i % 2 === 1, top = i < 2;
      var inQ = pts.filter(function (p) { return (right ? p.x >= MAP.mx : p.x < MAP.mx) && (top ? p.y >= MAP.my : p.y < MAP.my); });
      var deep = inQ.slice().sort(function (a, b) { return (Math.abs(b.x - MAP.mx) / sx + Math.abs(b.y - MAP.my) / sy) - (Math.abs(a.x - MAP.mx) / sx + Math.abs(a.y - MAP.my) / sy); }).slice(0, 3);
      return '<div class="lg-q"><div class="lg-q-h"><span class="lg-q-t">' + q[0] + '</span><span class="lg-q-c num">' + plural(inQ.length, "skater", "skaters") + '</span></div><span class="lg-q-s">' + q[1] + "</span>" +
        /* QA phone 13 (2026-11-25): one name a row, not a comma-joined line of 17 px links 20 px apart that broke inside names */
        (deep.length ? '<ul class="lg-q-n">' + deep.map(function (p) { return '<li><a href="' + esc(p.href) + '">' + esc(p.label) + "</a></li>"; }).join("") + "</ul>" : "") + "</div>";
    }).join("");
  }
  function mapDesc(p) { return p.l.tag + ", " + p.l.club + ", " + (M.posName(p.l.pos) || p.l.pos) + ": " + p.x.toFixed(2) + " points and " + p.y.toFixed(2) + " hits a game in " + p.l.gp + " games"; }
  /* the kit redraws a scatter at the width it really gets (and again when that changes by 8%), replacing the svg: the scale
     marks, hit rings and label placement below are added to whichever svg is current, once each (data-lg-bound), and the
     geometry is read from that svg's own viewBox, so a redraw can never leave ticks where the dots are not */
  function bindMap(root) {
    var host = S2.$("#mapHost", root), read = S2.$("#mapRead", root); if (!host) return;
    var svg = S2.$("svg", host); if (!svg || svg.dataset.lgBound) return;
    svg.dataset.lgBound = "1";
    var vb = svg.viewBox && svg.viewBox.baseVal, W = vb && vb.width || MAP.W, H = vb && vb.height || MAP.H;
    var NS = "http://www.w3.org/2000/svg", l = 40, t = 14, iw = W - 54, ih = H - 50;
    var X = function (v) { return l + v / MAP.dx * iw; }, Y = function (v) { return t + ih - v / MAP.dy * ih; };
    var mk = function (name, at, parent) { var e = document.createElementNS(NS, name); Object.keys(at).forEach(function (k) { e.setAttribute(k, at[k]); }); (parent || svg).appendChild(e); return e; };
    var txt = function (x, y, s, anchor, cls) { mk("text", { x: x, y: y, "text-anchor": anchor, "class": cls }).textContent = s; };
    /* scale marks the kit's scatter leaves out: zero, half and full on each axis, plus the two medians */
    [0, .5, 1].forEach(function (f) {
      txt(X(MAP.dx * f), t + ih + 15, String(+(MAP.dx * f).toFixed(1)), f === 0 ? "start" : f === 1 ? "end" : "middle", "lg-tick");
      txt(l - 6, Y(MAP.dy * f) + 4, String(+(MAP.dy * f).toFixed(1)), "end", "lg-tick");
    });
    txt(X(MAP.mx) + 4, t + ih - 4, "median " + MAP.mx.toFixed(2), "start", "lg-tick lg-med");
    txt(l + iw, Y(MAP.my) - 5, "median " + MAP.my.toFixed(2), "end", "lg-tick lg-med");
    /* corner names drawn last so the dots never cover them */
    S2.$$("text", svg).forEach(function (e) { if (QUADS.some(function (q) { return q[0] === e.textContent; })) { e.setAttribute("class", "lg-quad"); svg.appendChild(e); } });
    var dots = S2.$$("a", svg);       /* the kit's dot links, in MAP.pts order */
    /* fingertip-sized hit rings, all in one group drawn BELOW every dot. A ring inside each dot's own link sat on top of the
       dots drawn before it, so a tap in the cluster opened a neighbor (69 of 95 dots at 375px, review 2026-10-19). The
       rings are links of their own that skip the tab order and the accessibility tree; only the labeled leaders are tab
       stops, because the corner names and the Skaters table reach every other player (95 stops were a wall). */
    var rings = document.createElementNS(NS, "g"); rings.setAttribute("class", "lg-hits");
    if (dots[0]) svg.insertBefore(rings, dots[0]);
    dots.forEach(function (a, i) {
      var p = MAP.pts[i], dot = S2.$("circle", a); if (!p || !dot) return;
      a.setAttribute("aria-label", mapDesc(p));
      if (!p.hi) a.setAttribute("tabindex", "-1");
      var ring = mk("a", { href: p.href, tabindex: "-1", "aria-hidden": "true" }, rings);
      mk("circle", { cx: dot.getAttribute("cx"), cy: dot.getAttribute("cy"), r: 15, fill: "transparent" }, ring);
      var show = function () { if (read) read.innerHTML = "<b>" + esc(p.l.tag) + "</b>, " + esc(teamName(p.l.club)) + ": " + p.x.toFixed(2) + " points and " + p.y.toFixed(2) + " hits a game in " + p.l.gp + " games"; };
      a.addEventListener("pointerenter", show); ring.addEventListener("pointerenter", show); a.addEventListener("focus", show);
    });
    /* fail loud if the kit's scale ever stops matching the rescaling in mapChart: the ticks and medians would lie */
    var far = MAP.pts.reduce(function (b, p, i) { return p.x > MAP.pts[b].x ? i : b; }, 0), fc = dots[far] && S2.$("circle", dots[far]);
    if (fc && (Math.abs(+fc.getAttribute("cx") - X(MAP.pts[far].x)) > 1 || Math.abs(+fc.getAttribute("cy") - Y(MAP.pts[far].y)) > 1))
      console.error("league: the play style map no longer lines up with charts.js scatter, so its ticks and medians are misplaced");
    /* leader names stay clear of each other, the corner names, the two median labels and the plot edges: right of the dot,
       then left, then a line below or above, then two lines; if nothing is clear, the place inside the plot that covers least.
       QA phone 1 (2026-11-25): the old fallback put a crowded label right of the right-most dot, and the svg is overflow:
       visible, so the name ran past a phone's edge (x 350 to 401 at 375); the medians were not counted as taken, so a
       label could sit on "median 1.84". The labeled leaders' own dots count too: two leaders side by side drew one's name
       under the other's dot */
    var taken = S2.$$(".lg-quad, .lg-med", svg).concat(S2.$$("a > text", svg).map(function (tx) { return S2.$("circle", tx.parentNode); }).filter(Boolean)).map(function (q) { return q.getBBox(); });
    var clash = function (b) { return b.x < l || b.x + b.width > W - 2 || b.y < 0 || taken.some(function (o) { return b.x < o.x + o.width + 4 && o.x < b.x + b.width + 4 && b.y < o.y + o.height && o.y < b.y + b.height; }); };
    /* right-most first: a leader near the right edge has the fewest places, so it chooses before its neighbors do */
    var cxOf = function (tx) { var c = S2.$("circle", tx.parentNode); return c ? +c.getAttribute("cx") : 0; };
    S2.$$("a > text", svg).sort(function (p1, p2) { return cxOf(p2) - cxOf(p1); }).forEach(function (tx) {
      var c = S2.$("circle", tx.parentNode); if (!c) return;
      var cx = +c.getAttribute("cx"), cy = +c.getAttribute("cy"), tries = [[10, 4], [-10, 4], [10, 18], [-10, 18], [10, -10], [-10, -10], [-10, 32], [-10, -24], [-10, -38], [10, -24], [10, -38]];
      var put = function (k) { tx.setAttribute("x", cx + tries[k][0]); tx.setAttribute("y", cy + tries[k][1]); tx.setAttribute("text-anchor", tries[k][0] > 0 ? "start" : "end"); };
      /* when no place is clear, the place inside the plot that covers the least of what is already drawn */
      var cost = function (b) {
        if (b.x < l || b.x + b.width > W - 2 || b.y < 0) return Infinity;
        return taken.reduce(function (sum, o) { var w = Math.min(b.x + b.width, o.x + o.width) - Math.max(b.x, o.x), h = Math.min(b.y + b.height, o.y + o.height) - Math.max(b.y, o.y); return sum + (w > 0 && h > 0 ? w * h : 0); }, 0);
      };
      for (var k = 0; k < tries.length; k++) { put(k); if (!clash(tx.getBBox())) break; }
      if (k === tries.length) {
        var best = 1, least = Infinity;
        for (k = 0; k < tries.length; k++) { put(k); var c2 = cost(tx.getBBox()); if (c2 < least) { least = c2; best = k; } }
        put(best);
      }
      taken.push(tx.getBBox());
    });
  }
  /* whenever the kit (or a toggle) puts a new svg in the host, bind it; the observer lets go with the page */
  function watchMap(root) {
    var host = S2.$("#mapHost", root); if (!host || !window.MutationObserver) return;
    var mo = new MutationObserver(function () { if (!host.isConnected) { mo.disconnect(); return; } bindMap(root); });
    mo.observe(host, { childList: true });
  }
  function styleMap() {
    var n = mapPoints(MAP.unit).length;
    return '<section class="band tint lg-band lg-map" aria-labelledby="hmap">' + secHead({ kicker: "Play style map", id: "hmap", title: plural(n, "skater", "skaters") + ", four kinds of game",
      text: "Points per game across, hits per game up, for every skater with " + SETTLE + " games or more. The dashed lines are the medians, so each corner holds about a quarter of them.",
      aside: utabs("mapSeg", MAP_UNITS, MAP.unit, "Which skaters", "sm") }) +
      '<div class="lg-map-grid"><div><div id="mapHost" class="lg-map-host">' + mapChart(MAP.unit) + "</div>" +
      '<p class="lg-map-read" id="mapRead" aria-live="polite">Tap a dot to open that player.</p></div><div id="mapSide" class="lg-map-side">' + mapSide() + "</div></div></section>";
  }
  /* totals: a big total belongs next to games played, so each list shows both */
  var TOT_S = [["p", "Points"], ["g", "Goals"], ["a", "Assists"], ["pm", "+/−"], ["hits", "Hits"]];
  var TOT_G = [["w", "Wins"], ["sv", "Saves"], ["so", "Shutouts"], ["qs", "Quality starts"]];
  function totList(stat) {
    var rows = M.leaders(stat, 10, { minGp: 1 }), max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.value); }).concat([1])), ranks = rows.map(function (r) { return r.rank; });
    if (!rows.length) return '<p class="lg-none-p">No lines yet.</p>';
    return '<ol class="lg-bars">' + rows.map(function (r) {
      return "<li>" + rankCell(r.rank, ranks) + cr(r.club) + '<a href="' + esc(r.href) + '" class="lg-bars-n"><span class="lg-bars-t">' + esc(r.tag) + '</span><span class="lg-bars-gp"><span class="sr">, </span>' + r.gp + " GP</span></a>" +
        '<span class="lg-bars-bar" aria-hidden="true"><i class="c-pct" style="--p:' + (Math.max(0, r.value) / max * 100).toFixed(1) + '%"></i></span><span class="num lg-bars-v">' + esc(r.display) + "</span></li>";
    }).join("") + "</ol>";
  }
  var TOT = { S: "p", G: "w" };
  function totCol(role) {
    var opts = role === "S" ? TOT_S : TOT_G;
    return '<div class="lg-tot" aria-label="' + (role === "S" ? "Skater" : "Goaltender") + ' totals"><div class="lg-tot-h"><h3 class="d-3">' + (role === "S" ? "Skaters" : "Goaltenders") + "</h3>" +
      '<div class="lg-hscroll lg-hscroll-in">' + utabs("tot" + role, opts, TOT[role], "Stat", "sm") + '</div></div><div id="totHost' + role + '">' + totList(TOT[role]) + "</div></div>";
  }
  function sxLeaders() {
    var w = M.leaders("w", 1, { minGp: 1 })[0], sv = M.leaders("sv", 1, { minGp: 1 })[0];
    return '<div id="ttHost">' + titlesBlock() + "</div>" + styleMap() +
      '<section class="lg-sec" aria-labelledby="htot">' + secHead({ kicker: "Season totals", id: "htot", title: w ? w.tag + " has " + plural(w.value, "win", "wins") + " in goal" : "Season totals",
        text: esc((w && sv ? (sv.id === w.id ? w.tag + " also leads in saves, with " + S2.fmt(sv.value) + ". " : sv.tag + " leads in saves, with " + S2.fmt(sv.value) + ". ") : "") + "Totals count every game at every position played; ties share a rank."),
        aside: arrow("#/stats?tab=skaters", "Every skater", "skaters") }) +
      '<div class="lg-tots">' + totCol("S") + totCol("G") + "</div></section>";
  }
  function titlesBlock() {
    return '<section class="lg-sec" aria-labelledby="htt">' + secHead({ kicker: "Statistical titles", id: "htt", title: titlesHead(),
        text: "Titles go to the best rate per game, not the biggest total, among playoff-eligible players with " + FLOOR + " games at that position. " + (function () {   /* QA worst 3: a regular season behind the clock is said as over, and its board as final */
          var e = cal(VIEW.season, "ends_at");
          return e && !ahead(e) ? "The regular season ended " + esc(md(e)) + ", so this board is final." : "The board is the race until the last regular-season game is final" + (e ? " on " + esc(md(e)) : "") + ".";
        })(),
        aside: arrow("#/rulebook?rule=9.2", "Rule 9.2") }) +
      '<div class="lg-titles">' + Object.keys(TITLE).map(titleCol).join("") + "</div></section>" + notYet();
  }
  function bindLeaders(root) {
    bindMap(root); watchMap(root);
    var ms = S2.$("#mapSeg", root);
    if (ms) S2.segmented(ms, function (u) { MAP.unit = u; swap(S2.$("#mapHost", root), mapChart(u), true); bindMap(root); var sd = S2.$("#mapSide", root); if (sd) swap(sd, mapSide(), true); var rd = S2.$("#mapRead", root); if (rd) rd.textContent = "Tap a dot to open that player."; });
    ["S", "G"].forEach(function (role) {
      var s = S2.$("#tot" + role, root);
      if (s) S2.segmented(s, function (k, b) { TOT[role] = k; intoRow(b); swap(S2.$("#totHost" + role, root), totList(k), true); });
    });
  }

  /* skaters and goaltenders: full tables with a pinned name column; rates rank settled lines first */
  function playerCell(l) {
    var p = M.player(l.pid), both = p && p.roles && p.roles.length > 1;
    return '<a class="lg-pl" href="' + esc(l.href) + '">' + cr(l.club) + '<span class="lg-pl-n"><span class="lg-pl-t">' + esc(l.tag) + "</span>" +
      (l.former ? '<span class="lg-tag">Former</span>' : "") + (me() && me().id === l.pid ? YOU : "") +
      (both ? '<span class="lg-tag" title="Has a line ' + (l.role === "S" ? "in goal" : "as a skater") + ' too: every line counts">' + (l.role === "S" ? "+G" : "+S") + "</span>" : "") + "</span></a>";
  }
  function stat(k, label, title, o) {
    o = o || {};
    var s = M.STATS[k] || {};
    return { key: k, label: label, title: title || s.label, rate: !!o.rate, settle: o.settle, dir: o.dir || (s.better === "low" ? "asc" : "desc"),
      v: function (l) { return l[k]; }, f: o.f || function (l) { return M.display(k, l[k]); } };
  }
  var SK = { q: "", group: "all" }, GK = { q: "" };
  function match(q) { q = q.trim().toLowerCase(); return function (l) { return !q || l.tag.toLowerCase().indexOf(q) >= 0; }; }
  function skTable() {
    var cols = [
      { key: "tag", label: "Player", cls: "lg-c1", dir: "asc", v: function (l) { return l.tag.toLowerCase(); }, f: playerCell },
      stat("gp", "GP", "Games played as a skater"), stat("g", "G"), stat("a", "A"),
      stat("p", "P", "Points", { f: function (l) { return "<b>" + l.p + "</b>"; } }),
      stat("pm", "+/−", "Plus/minus", { f: function (l) { return '<span class="' + (l.pm > 0 ? "lg-pos" : l.pm < 0 ? "lg-neg" : "") + '">' + signed(l.pm) + "</span>"; } }),
      stat("pts_pg", "P/GP", null, { rate: true }), stat("sog", "SOG", "Shots on goal"), stat("shot_pct", "S%", "Shooting percentage", { rate: true }), stat("onnet_pct", "NET%", "Shots on net: shots on goal out of shot attempts", { rate: true }),
      stat("hits", "HIT"), stat("blk", "BLK", "Blocked shots"), stat("tk", "TK", "Takeaways"), stat("int", "INT", "Interceptions"),
      stat("gv", "GV", "Giveaways: EA counts every lost puck, so a winger averages about 8.5 a game"), stat("pim", "PIM", "Penalty minutes"),
      stat("ppg", "PPG", "Power-play goals"), stat("shg", "SHG", "Shorthanded goals"), stat("gwg", "GWG", "Game-winning goals"),
      stat("fo_pct", "FO%", "Faceoffs won of faceoffs taken, in games played at center", { rate: true, settle: function (l) { return (l.fo_games || 0) < SETTLE; } }), stat("pass_pct", "PASS%", "Pass completion", { rate: true }),
      { key: "toi_pg", label: "TOI/GP", title: "Time on ice per game", rate: true, v: function (l) { return l.toi_pg; }, f: function (l) { return M.toi(l.toi_pg); } },
      { key: "pos", label: "Pos", title: "Registered position (for a goaltender skating, the position played most)", dir: "asc", v: function (l) { return M.POS_RANK[l.pos] || 9; }, f: function (l) { return '<abbr title="' + esc(M.posName(l.pos) || l.pos) + '">' + esc(l.pos) + "</abbr>"; } }
    ];
    return Table({ id: "skT", cols: cols, cls: "lg-pt", caption: "Skater lines, " + VIEW.name,
      rows: function () { return M.lines({ role: "S" }).filter(function (l) { return SK.group === "all" || l.group === SK.group; }).filter(match(SK.q)); },
      st: { key: "p", dir: "desc" }, settle: function (l) { return l.gp < SETTLE; }, tie: function (a, b) { return b.gp - a.gp || a.tag.localeCompare(b.tag); },
      rowCls: function (l) { return (l.former ? "lg-former" : "") + (me() && me().id === l.pid ? " lg-me" : ""); },
      empty: function () { return "No skater matches “" + esc(SK.q) + "”" + (SK.group !== "all" ? " among " + M.GROUP_NAME[SK.group].toLowerCase() : "") + "."; } });
  }
  function gkTable() {
    var cols = [
      { key: "tag", label: "Goaltender", cls: "lg-c1", dir: "asc", v: function (l) { return l.tag.toLowerCase(); }, f: function (l) {
        return playerCell(l).replace("</span></a>", (l.regPos && l.regPos !== "G" ? '<span class="lg-tag" title="Registered at ' + esc(M.posName(l.regPos) || l.regPos) + '; these games were in goal">Skater</span>' : "") + "</span></a>"); } },
      stat("gp", "GP", "Games played in goal"), stat("sv_pct", "SV%", null, { rate: true }), stat("gaa", "GAA", null, { rate: true }), stat("w", "W", "Wins"),
      { key: "l", label: "L", title: "Regulation losses", dir: "asc", v: function (l) { return l.l; }, f: function (l) { return l.l; } },
      { key: "otl", label: "OTL", title: "Overtime losses", v: function (l) { return l.otl; }, f: function (l) { return l.otl; } },
      stat("sv", "SV", "Saves"), { key: "sa", label: "SA", title: "Shots against", v: function (l) { return l.sa; }, f: function (l) { return l.sa; } },
      { key: "ga", label: "GA", title: "Goals against", dir: "asc", v: function (l) { return l.ga; }, f: function (l) { return l.ga; } },
      stat("so", "SO", "Shutouts"), stat("qs", "QS", "Quality starts: games saved at .885 or better"),
      stat("sv_pg", "SV/GP", null, { rate: true }), stat("brk_sv_pct", "BRK%", "Breakaway save percentage", { rate: true }),
      stat("dsv", "DS", "Desperation saves"), stat("sop", "SOP", "Shutout periods: periods with no goal against"),
      stat("psv_pct", "PS%", "Penalty shot save percentage", { rate: true, f: function (l) { return l.psa ? '<span title="' + l.psv + " of " + l.psa + (l.psa === 1 ? " penalty shot" : " penalty shots") + ' stopped">' + esc(M.display("psv_pct", l.psv_pct)) + "</span>" : "–"; } })
    ];
    return Table({ id: "gkT", cols: cols, cls: "lg-pt", caption: "Goaltender lines, " + VIEW.name,
      rows: function () { return M.lines({ role: "G" }).filter(match(GK.q)); },
      st: { key: "sv_pct", dir: "desc" }, settle: function (l) { return l.gp < SETTLE; }, tie: function (a, b) { return b.gp - a.gp || a.tag.localeCompare(b.tag); },
      rowCls: function (l) { return (l.former ? "lg-former" : "") + (me() && me().id === l.pid ? " lg-me" : ""); },
      empty: function () { return "No goaltender matches “" + esc(GK.q) + "”."; } });
  }
  function searchBox(id, ph, val) {
    return '<label class="lg-search"><span class="sr">' + esc(ph) + "</span>" + S2.ic("search") + '<input class="input" type="search" id="' + id + '" placeholder="' + esc(ph) + '" value="' + esc(val) + '" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>';
  }
  function countLine(rows, role) {
    var all = M.lines({ role: role }), former = all.filter(function (l) { return l.former; }).length, both = M.players.filter(function (p) { return p.roles.length > 1; }).length;
    return (rows === all.length ? "All " + all.length : rows + " of " + all.length) + (role === "S" ? " skating" : " goaltending") + " lines. " +
      former + " belong to former players and " + both + " players have a line in both roles.";
  }
  function sxSkaters() {
    TBL = {}; var T = skTable();
    /* the tab's headline is the page hero (sxHero), so the section opens straight on its tools */
    return '<section class="lg-sec" aria-label="Skaters">' +
      '<div class="lg-tools">' + searchBox("skQ", "Filter by gamertag", SK.q) + findMeBtn("skMe") +
      '<div class="lg-hscroll lg-hscroll-in">' + utabs("skG", [["all", "All"], ["C", "Centers"], ["W", "Wingers"], ["D", "Defense"]], SK.group, "Position group", "sm") + "</div></div>" +
      '<p class="lg-count" id="skCount" aria-live="polite">' + countLine(T.rows().length, "S") + "</p>" + T.html() + "</section>";
  }
  function sxGoalies() {
    TBL = {}; var T = gkTable();
    return '<section class="lg-sec" aria-label="Goaltenders">' +
      '<div class="lg-tools">' + searchBox("gkQ", "Filter by gamertag", GK.q) + findMeBtn("gkMe") + "</div>" +
      '<p class="lg-count" id="gkCount" aria-live="polite">' + countLine(T.rows().length, "G") + "</p>" + T.html() + "</section>";
  }
  function bindPlayerTable(root, id, qId, state, role, countId) {
    bindTables(root);
    var T = TBL[id], q = S2.$("#" + qId, root), cnt = S2.$("#" + countId, root);
    if (q) q.addEventListener("input", function () { state.q = q.value; T.repaint(); if (cnt) cnt.textContent = countLine(T.rows().length, role); });
    var g = S2.$("#skG", root), seg = g && role === "S" ? S2.segmented(g, function (v, b) { SK.group = v; intoRow(b); T.repaint(); if (cnt) cnt.textContent = countLine(T.rows().length, "S"); }) : null;
    bindFindMe(root, role === "S" ? "skMe" : "gkMe", function () {
      state.q = ""; if (q) q.value = ""; if (role === "S" && SK.group !== "all") { SK.group = "all"; if (seg && seg.set) seg.set("all"); }
      T.repaint(); if (cnt) cnt.textContent = countLine(T.rows().length, role);
    }, "#" + id + " tr.lg-me");
  }

  /* clubs as a whole: goals and special teams from every final, the rest from the box scores (M.clubStats, the one definition) */
  function sxTeams() {
    TBL = {};
    var rows = M.standings("league").map(function (r) { return Object.assign({ a: M.clubStats(r.code) || {} }, r); });
    var club = function (k, label, title, dir) { return { key: k, label: label, title: title, dir: dir, v: function (r) { return r.a[k]; }, f: function (r) { return M.clubDisplay(k, r.a[k]); } }; };
    var per = function (k) { return function (r) { return r.a.bx ? r.a[k] / r.a.bx : null; }; };
    var pg = function (k) { return function (r) { return r.gp ? r[k] / r.gp : null; }; };   /* a club with no games has no rate, not NaN */
    var cols = [
      { key: "name", label: "Club", cls: "lg-c1", dir: "asc", v: function (r) { return r.team.name; }, f: function (r) {
        return '<a class="lg-club" href="' + esc(r.href) + '">' + cr(r.code) + '<span class="lg-club-n"><span class="lg-city">' + esc(r.team.city) + ' </span><span class="lg-nm">' + esc(r.team.name) + "</span></span></a>"; } },
      { key: "gp", label: "GP", title: "Games played", v: function (r) { return r.gp; }, f: function (r) { return r.gp; } },
      { key: "gfpg", label: "GF/GP", title: "Goals for per game", v: pg("gf"), f: function (r) { return fix(pg("gf")(r), 2); } },
      { key: "gapg", label: "GA/GP", title: "Goals against per game", dir: "asc", v: pg("ga"), f: function (r) { return fix(pg("ga")(r), 2); } },
      { key: "diff", label: "DIFF", title: "Goal difference", v: function (r) { return r.diff; }, f: function (r) { return '<span class="' + (r.diff > 0 ? "lg-pos" : r.diff < 0 ? "lg-neg" : "") + '">' + signed(r.diff) + "</span>"; } },
      { key: "pp", label: "PP%", title: "Power-play success", v: function (r) { return r.pp_pct; }, f: function (r) { return pct1(r.pp_pct); } },
      { key: "pk", label: "PK%", title: "Penalty-kill success", v: function (r) { return r.pk_pct; }, f: function (r) { return pct1(r.pk_pct); } },
      { key: "sog", label: "SOG/GP", title: "Shots on goal per game, EA's club count", v: per("sog"), f: function (r) { var v = per("sog")(r); return v == null ? "–" : v.toFixed(1); } },
      { key: "sa", label: "SA/GP", title: "Shots against per game, EA's count for the opposing club", dir: "asc", v: per("sa"), f: function (r) { var v = per("sa")(r); return v == null ? "–" : v.toFixed(1); } },
      club("toa_pg", "TOA/GP", "Time on attack per game, EA's club clock"), club("pass_pct", "PASS%", "Passes completed of passes attempted, EA's club figures"),
      club("fo_pct", "FO%", "Faceoffs won of faceoffs taken, every position"), club("hits_pg", "HIT/GP", "Hits per game"), club("blk_pg", "BLK/GP", "Blocked shots per game"),
      club("tk_pg", "TK/GP", "Takeaways per game"), club("int_pg", "INT/GP", "Interceptions per game"),
      club("gv_pg", "GV/GP", "Giveaways per game, fewer is better", "asc"), club("pim_pg", "PIM/GP", "Penalty minutes per game, fewer is better", "asc"),
      { key: "bx", label: "Box", title: "Games with a box score", v: function (r) { return r.a.bx; }, f: function (r) { return r.a.bx; } }
    ];
    var T = Table({ id: "clT", cols: cols, cls: "lg-st", caption: "Club statistics, " + VIEW.name, rows: function () { return rows; }, st: { key: "gfpg", dir: "desc" },
      tie: function (a, b) { return a.leagueRank - b.leagueRank; } });
    /* only clubs that have played get a bar: one 0-GP club made every width NaN and the whole chart vanished */
    var played = rows.filter(function (r) { return r.gp; });
    var maxAbs = Math.max.apply(null, played.map(function (r) { return Math.abs(r.diff / r.gp); }).concat([0.1]));
    var sorted = played.slice().sort(function (a, b) { return b.diff / b.gp - a.diff / a.gp; });
    var bars = sorted.map(function (r) {
      var v = r.diff / r.gp, w = (Math.abs(v) / maxAbs * 50).toFixed(1);
      return '<li><span class="lg-dv-n">' + cr(r.code) + '<a href="' + esc(r.href) + '">' + esc(r.team.name) + '</a></span><span class="lg-dv-track" aria-hidden="true"><i class="lg-dv-bar ' + (v >= 0 ? "pos" : "neg") + '" style="width:' + w + '%"></i></span>' +
        '<span class="num lg-dv-v ' + (v > 0 ? "lg-pos" : v < 0 ? "lg-neg" : "") + '">' + signed(Math.round(v * 100) / 100) + "</span></li>";
    }).join("") + rows.filter(function (r) { return !r.gp; }).map(function (r) {
      return '<li class="lg-dv-none"><span class="lg-dv-n">' + cr(r.code) + '<a href="' + esc(r.href) + '">' + esc(r.team.name) + '</a></span><span class="lg-ny-s">No games yet</span><span class="lg-dv-v"></span></li>';
    }).join("");
    var hit = rows.filter(function (r) { return r.a.bx; }).sort(function (a, b) { return per("hits")(b) - per("hits")(a); })[0];
    return '<section class="lg-sec" aria-label="Goal difference per game"><p class="lg-lead">Right of the center line, a club outscores its opponents on average; left, it is outscored.</p>' +
      '<ol class="lg-dv-list" aria-label="Goal difference per game">' + bars + "</ol></section>" +
      '<section class="lg-sec" aria-labelledby="hcl2">' + secHead({ kicker: "Club statistics", id: "hcl2", size: "d-3", h: "h3",
        title: hit ? city(hit) + " leads the league in hits, " + per("hits")(hit).toFixed(1) + " a game" : "Shots, hits, faceoffs and passing",
        text: "Goals and special teams count every final; everything else counts the games with a box score." }) + T.html() + "</section>";
  }

  /* the players directory, labeled with the live site's player states (CG.poolState, part_live.js:6569) */
  function poolState(p) {
    if (p.seat) return { key: "management", label: "Management", sub: p.seat };
    if (p.rostered) return { key: "rostered", label: "Rostered", sub: p.squad === "tc" ? "Training camp" : null };
    /* v5.00 swap (e6): a sign-up for the season on screen (M.signups, js/model.js p.signup), read as CG.poolState reads the
       registration: waived outranks it, a declined one says so, else Signed up. Season 2 placed every club-less player in
       the pool before the draft (Rule S2.5), so the live site's later states (late, rights) are not ported here.
       shortcut: Signed up covers every pending sign-up; port CG.poolState's late sign-up state when the draft opens */
    if (p.signup) return p.signup.waivedAt ? { key: "free_agent", label: "Waived", sub: null } : p.signup.status === "declined" ? { key: "declined", label: "Declined", sub: null } : { key: "signup", label: "Signed up", sub: null };
    /* the snapshot holds Season 1 roster history, not registrations: a waived player is a free agent labeled Waived (v3.33);
       leaving the Discord or a season-long removal withdraws the sign-up, which reads Not signed up */
    var last = (p.tenures || []).slice().sort(function (a, b) { return String(b.to || "").localeCompare(String(a.to || "")); })[0];
    if (last && last.how_out === "waived") return { key: "free_agent", label: "Waived", sub: null };
    return { key: "unregistered", label: "Not signed up", sub: null };
  }
  var DIR = { q: "", state: "all" };
  var STATES = [["all", "All"], ["rostered", "Rostered"], ["management", "Management"], ["signup", "Signed up"], ["free_agent", "Waived"], ["unregistered", "Not signed up"]];
  function dirRows() {
    var q = DIR.q.trim().toLowerCase();
    return M.players.filter(function (p) { return (DIR.state === "all" || poolState(p).key === DIR.state) && (!q || p.tag.toLowerCase().indexOf(q) >= 0); });
  }
  /* a row's line under the name: position, then club (and squad) or the player's state, each only when there is one (health
     crawl 7, 2026-11-25: a player with no position for the season on screen read ", Not signed up", 237 rows of 324) */
  function dirSub(p, st) {
    return [p.posName || p.pos, p.rostered && p.team ? p.team.full : st.label, p.rostered && p.team ? st.sub : null].filter(Boolean).map(esc).join(", ");
  }
  function dirList() {
    var rows = dirRows(), groups = {}, order = [];
    /* QA worst 16 (2026-11-25): a tag files under its letter however it is written. NFKD folds an accented capital (Š to S)
       and the styled Mathematical Alphanumeric letters (𝐀, 𝓐 to A), which NFD leaves alone; digits, underscores and
       symbols stay under #, as in iOS Contacts. Within a letter the folded spelling orders the rows too */
    var fold = function (t) { return String(t).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); };
    rows.forEach(function (p) {
      var c = fold(p.tag).charAt(0).toUpperCase(); c = /[A-Z]/.test(c) ? c : "#";
      if (!groups[c]) { groups[c] = []; order.push(c); } groups[c].push(p);
    });
    order.forEach(function (c) { groups[c].sort(function (a, b) { return fold(a.tag).localeCompare(fold(b.tag)); }); });
    order.sort(function (a, b) { return a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b); });
    /* QA visual 6: the ONE empty box (S2.empty, core.js), as Standings and Stats draw theirs */
    if (!rows.length) return S2.empty("none", "No one matches", "Nobody " + (DIR.state !== "all" ? "labeled " + esc(STATES.filter(function (s) { return s[0] === DIR.state; })[0][1]) + " " : "") + (DIR.q ? "has a gamertag containing “" + esc(DIR.q) + "”" : "is in this group") + ". Clear the filter to see everyone.");
    return order.map(function (c) {
      return '<section class="lg-dir-g" aria-label="' + (c === "#" ? "Other characters" : c) + '"><h3 class="lg-dir-h d-2">' + c + '</h3><div class="lg-dir-rows">' + groups[c].map(function (p) {
        var st = poolState(p), team = p.team;
        var mine = me() && me().id === p.id;
        return '<a class="lg-dir-row' + (mine ? " lg-me" : "") + '" href="' + esc(p.href) + '">' + (p.rostered && team ? cr(p.club) : '<span class="lg-cr lg-mark" aria-hidden="true">' + S2.mark(28) + "</span>") +
          '<span class="lg-dir-b"><span class="lg-dir-t">' + esc(p.tag) + (mine ? " " + YOU : "") + '</span><span class="lg-dir-s">' + dirSub(p, st) + "</span></span>" +
          '<span class="lg-dir-st">' + st.label + "</span>" +
          (p.ovr ? '<span class="lg-ovr num' + (p.ovr.provisional ? " prov" : "") + '" title="Rating ' + p.ovr.ovr + " at " + esc(M.GROUP_NAME[p.ovr.pos] || p.ovr.pos) + (p.ovr.provisional ? ", provisional: fewer than " + SETTLE + " games there" : "") + '">' + p.ovr.ovr + "</span>" : '<span class="lg-ovr none" title="No rating yet">–</span>') +
          "</a>";
      }).join("") + "</div></section>";
    }).join("");
  }
  function dirCounts() { var counts = {}; M.players.forEach(function (p) { var k = poolState(p).key; counts[k] = (counts[k] || 0) + 1; }); return counts; }
  function sxPlayers() {
    var counts = dirCounts();
    return '<section class="lg-sec" aria-label="Players">' +
      '<div class="lg-tools">' + searchBox("dirQ", "Find a player", DIR.q) + findMeBtn("dirMe") + "</div>" +
      '<div class="lg-hscroll lg-filters">' + utabs("dirSeg", STATES.map(function (s) { return [s[0], esc(s[1]) + ' <span class="num">' + (s[0] === "all" ? M.players.length : counts[s[0]] || 0) + "</span>"]; }), DIR.state, "Player state", "sm") + "</div>" +
      '<div id="dirHost" class="lg-dir">' + dirList() + "</div></section>";
  }
  function bindPlayers(root) {
    var host = S2.$("#dirHost", root), q = S2.$("#dirQ", root);
    if (q) q.addEventListener("input", function () { DIR.q = q.value; host.innerHTML = dirList(); });
    var s = S2.$("#dirSeg", root);
    var seg = s ? S2.segmented(s, function (v, b) { DIR.state = v; intoRow(b); swap(host, dirList(), true); }) : null;
    bindFindMe(root, "dirMe", function () { DIR.q = ""; if (q) q.value = ""; if (DIR.state !== "all") { DIR.state = "all"; if (seg && seg.set) seg.set("all"); } host.innerHTML = dirList(); }, "#dirHost .lg-me");
  }

  /* awards: Players of the Week (real), the Three Stars count from every box, and the season awards still to come */
  var STARS = null;
  function starBoard() {
    if (STARS) return STARS;
    var by = {};
    M.games.forEach(function (g) {
      if (!g.isFinal || !g.hasBox) return;
      (M.game(g.id) || { stars: [] }).stars.forEach(function (s) {
        var o = by[s.pid] = by[s.pid] || { pid: s.pid, tag: s.tag, club: s.club, href: s.href, n: [0, 0, 0], pts: 0 };
        o.n[s.n - 1]++; o.pts += 4 - s.n;
      });
    });
    return (STARS = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.pts - a.pts || b.n[0] - a.n[0] || a.tag.localeCompare(b.tag); }));
  }
  /* Season 1's trophies (commissioner, 2026-11-21: "add team awards for winning the Presidents' Trophy, Stanley Cup trophy,
     and any other stat based awards that are handed out in real life ... Make sure everything is built in with purpose").
     The tab reads as the season's trophy room, in order of weight: the team trophies (the Cup as the club's own color, with
     every name on it, then the other three as the Clubs page's own tile), then the awards by the record (the league's
     titles beside the NHL's stat trophies, one row per stat, so rate and total read side by side), then the weekly honors.
     Real (M.trophies, M.filedTitles), so nothing here is marked sample. */
  function trophyTile(x) {
    var t = M.team(x.club), row = (M.seasonClose(x.season) || { table: [] }).table.filter(function (r) { return r.club === x.club; })[0], o = M.team(x.over);
    var rec = x.key === "presidents_trophy" && row ? '<span class="d-num">' + row.pts + '</span><span class="lg-ct-pts">points, ' + row.w + "-" + row.l + "-" + row.otl + "</span>"
      : '<span class="d-num">' + esc(t.division) + '</span><span class="lg-ct-pts">over ' + esc(o ? o.city : x.over) + "</span>";
    return '<a class="lg-ct lg-tr" href="' + esc(t.href) + '" style="' + esc(S2.clubBand(t)) + '">' +
      '<span class="lg-ct-top"><span class="lg-ct-rk">' + esc(x.name) + "</span></span>" +
      '<span class="lg-ct-medal" aria-hidden="true">' + M.crest(t.code, "xl") + "</span>" +
      '<span class="lg-ct-name"><span class="lg-ct-city">' + esc(t.city) + '</span><span class="d-2">' + esc(t.name) + "</span></span>" +
      '<span class="lg-ct-rec">' + rec + "</span></a>";
  }
  function cupPanel(x) {
    var t = M.team(x.club), o = M.team(x.over), close = M.seasonClose(x.season);
    /* plainly alphabetical (review 2026-11-23: grouped by position with no labels, the list read as an alphabet restarting) */
    var names = close.cup.map(function (id) { return M.player(id); }).filter(Boolean).sort(function (a, b) { return String(a.tag).toLowerCase().localeCompare(String(b.tag).toLowerCase()); });
    if (names.length !== close.cup.length) console.error("Awards: " + (close.cup.length - names.length) + " names on the Cup are not in the snapshot");
    var line = (x.l === 0 ? "Swept " : "Beat ") + (o ? o.city : x.over) + " in the final, " + x.w + "-" + x.l + ".";
    /* the run to the Cup, round by round (Rule 8.1: a division's first seed has a bye through the opening round) */
    var mine = close.table.filter(function (r) { return r.club === x.club; })[0], div = M.trophies(x.season).filter(function (d) { return (d.key === "wales_trophy" || d.key === "campbell_bowl") && d.club === x.club; })[0];
    var path = [mine && mine.divRank === 1 ? ["Opening round", "A bye, first in the " + t.division] : null,
      div ? [t.division + " Division final", (div.l === 0 ? "Swept " : "Beat ") + (M.team(div.over) ? M.team(div.over).city : div.over) + ", " + div.w + "-" + div.l] : null,
      ["Final", (x.l === 0 ? "Swept " : "Beat ") + (o ? o.city : x.over) + ", " + x.w + "-" + x.l]].filter(Boolean);
    /* under the name, the regular season; the playoffs are the rows under it, so no score is said twice */
    var reg = mine ? mine.w + "-" + mine.l + "-" + mine.otl + " and " + mine.pts + " points in the regular season, " + S2.ord(mine.divRank) + " in the " + t.division + "." : line;
    return '<div class="lg-sc" style="' + esc(S2.clubBand(t)) + '">' +
      '<div class="lg-sc-a"><a class="lg-sc-id" href="' + esc(t.href) + '"><span class="lg-ct-medal" aria-hidden="true">' + M.crest(t.code, "xl") + "</span>" +
        '<span class="lg-sc-t"><span class="lg-ct-rk">' + esc(x.name) + '</span><span class="d-1">' + esc(t.full) + '</span><span class="lg-sc-l">' + esc(reg) + "</span></span></a>" +
        '<ol class="lg-sc-path" aria-label="' + esc(t.city + "'s run to the Cup") + '">' + path.map(function (r) { return '<li><span class="lg-ct-rk">' + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></li>"; }).join("") + "</ol></div>" +
      '<div class="lg-sc-n"><h3 class="lg-ct-rk" id="hcupn">On the Cup, ' + names.length + " names</h3>" +
        '<ul aria-labelledby="hcupn">' + names.map(function (p) { return '<li><a href="' + esc(p.href) + '">' + esc(p.tag) + "</a></li>"; }).join("") + "</ul></div></div>";
  }
  /* the awards by the record: one row per stat, the league's title (rate) and the NHL's trophy (total) side by side */
  var REC_ROWS = [["points_title", "Points", "points", "a game"], ["goals_title", "Goals", "goals", "a game"], ["assists_title", "Assists", "assists", "a game"], ["goaltending_title", "Goaltending", "goals against", "goals against a game"]];
  function recCell(cls, award, x, big, small) {
    return '<div role="cell" class="lg-rec-c ' + cls + '">' + (x.href ? '<a href="' + esc(x.href) + '">' : "<span>") + cr(x.club) +
      '<span class="lg-rec-w"><span class="lg-rec-a">' + esc(award) + "</span><b>" + esc(x.tag) + "</b></span>" +
      '<span class="lg-rec-v"><b class="d-num">' + esc(big) + "</b><small>" + esc(small) + "</small></span>" + (x.href ? "</a>" : "</span>") + "</div>";
  }
  function recBoard(n) {
    var filed = {}, troph = {};
    M.filedTitles(n).forEach(function (t) { filed[t.category] = t; });
    M.trophies(n).forEach(function (t) { if (t.pair) troph[t.pair] = t; });
    return '<div class="lg-rec" role="table" aria-label="Season ' + n + ' awards by the record">' +
      '<div class="lg-rec-r lg-rec-h" role="row"><span role="columnheader" class="lg-rec-k">Stat</span><span role="columnheader">League title, the best rate</span><span role="columnheader">NHL trophy, the best total</span></div>' +
      REC_ROWS.map(function (r) {
        var a = filed[r[0]], b = troph[r[0]];
        return '<div class="lg-rec-r" role="row"><span role="rowheader" class="lg-rec-k d-3">' + r[1] + "</span>" +
          (a ? recCell("t", a.label, a, a.value.toFixed(2), r[3]) : '<div role="cell" class="lg-rec-c none">Not filed</div>') +
          (b ? recCell("n", b.short, b, String(b.total), b.key === "jennings" ? M.team(b.club).city + " allowed" : b.unit) : '<div role="cell" class="lg-rec-c none">The NHL gives no trophy for ' + r[2] + "</div>") + "</div>";
      }).join("") + "</div>";
  }
  /* ---------- the award ballot, back (commissioner, 2026-11-23, on the cutover list's live features: "go ahead on all of
     these"). The live CG.awardBallotCard (src/live/part5b_public2.js, read 2026-11-23): every rostered player and league
     staff vote, one vote per award, for a player on another club and never themselves, and may change it until the award
     is decided; Best Goaltender takes a goaltender, Best Defenseman a defenseman, Rookie of the Year a player in their first
     CGHL season (everyone, in Season 1). The voter sees their own votes, never the tally (Rule 9.2 holds the vote, not its
     secrecy); a guest reads who votes and how. v5.00 swap (i3b, 2026-11-25): the votes are the league's, the classic door
     (CG.AFTER.awards, src/live/part5b_public2.js): the voter's own ballot read from award_ballots (RLS: a voter reads their
     own rows), and a vote written as an upsert on (season_id, category, voter_id) through S2.write. Who may vote, for whom,
     and whether the award is still open are the database's (can_vote_awards in the policies, guard_award_ballot): its
     refusal is shown in its own words beside the vote, and the select goes back to the vote on file. A vote can be
     changed, never withdrawn (no delete policy), so a ballot with a vote on file offers no empty choice. The ballot is the
     season on screen's. ---------- */
  var BALLOT = [["mvp", "Most Valuable Player", null], ["best_goalie", "Best Goaltender", "G"], ["best_defenseman", "Best Defenseman", "D"], ["rookie_of_year", "Rookie of the Year", null]];
  /* the voter's ballot for one season: {sid, who, votes: {category: profile id}} once read, {err} if the read failed */
  var VOTES = { sid: null, who: null, votes: null, err: null, wait: null };
  function ballotSid() { var s = M.control.season(VIEW.season); return (s && s.settings && s.settings.id) || null; }
  function ballotWho() { return (S2.session && S2.session.profileId) || null; }
  function ballotRead() {
    var sid = ballotSid(), who = ballotWho();
    if (VOTES.wait || (VOTES.votes && VOTES.sid === sid && VOTES.who === who)) return VOTES.wait || Promise.resolve();
    VOTES = { sid: sid, who: who, votes: null, err: null, wait: null };
    VOTES.wait = Promise.resolve().then(function () {
      if (!sid) throw new Error("The league data names no id for " + VIEW.name + ".");
      var c = S2.ensureSb ? S2.ensureSb() : null;
      if (!c) throw new Error("Not connected to the league. Reload the page to try again.");
      return c.from("award_ballots").select("category,profile_id").eq("season_id", sid).eq("voter_id", who);
    }).then(function (r) {
      if (r && r.error) throw new Error(r.error.message || "The league did not answer.");
      var v = {}; ((r && r.data) || []).forEach(function (x) { v[x.category] = x.profile_id; });
      VOTES.votes = v;
    }).catch(function (e) { console.error("Awards: your ballot could not be read", e); VOTES.err = e.message || String(e); })
      .then(function () { VOTES.wait = null; });
    return VOTES.wait;
  }
  function ballotPool(cat, self, clubs) {
    return M.players.filter(function (pl) { return pl.rostered && pl.id !== self && clubs.indexOf(pl.club) < 0 && (!cat[2] || pl.unit === cat[2]); })
      .sort(function (a, b) { return a.tag.toLowerCase() < b.tag.toLowerCase() ? -1 : 1; });
  }
  /* a voter's own clubs, as guard_award_ballot reads them (Rule 9.2.1): the club they are rostered on in the ballot's
     season, and the club whose seat they hold. Read from the voter's own profile, never S2.mine(), which answers null for a
     staffer or commissioner (review 2026-11-25: a staffer who played for a club was offered that club's players, which the
     database refuses) */
  function ballotClubs() {
    var self = M.player(ballotWho()), s = S2.session || {}, out = self && self.rostered && self.club ? [self.club] : [];
    if (s.seat && s.teamCode && out.indexOf(s.teamCode) < 0) out.push(s.teamCode);
    return out;
  }
  /* v465 (commissioner, 2026-11-25: "set the award announcement date to be the same date as the owner application
     deadline"): the vote closes at the next season's owner application deadline (M.awardsCloseAt, after the database's
     public.awards_close_at), when the league office decides and announces each award (Rule 9.2); a tie at the top, or an
     award with no vote for an eligible player, waits for a commissioner. The ballot says when it closes; after the close
     it says the vote has closed and the winners are being announced; a decided award shows its winner (M.votedAwards),
     to everyone, and takes no vote. A page left open across the close keeps its selects until its next repaint, and
     the database refuses a late vote in its own words beside the select */
  function voteNow(n) {
    var at = M.awardsCloseAt(n), won = M.votedAwards(n), all = BALLOT.every(function (c) { return !!won[c[0]]; });
    return { at: at, won: won, all: all, any: BALLOT.some(function (c) { return !!won[c[0]]; }), over: all || (!!at && Date.now() >= Date.parse(at)) };
  }
  function closeWords(at) { return M.etTime(at) + " ET on " + M.etLong(at); }   /* the time, then the weekday and the date, as Rule 9.2 says it */
  /* an award's line once it is decided, or once the vote has closed: its winner, else "Being announced" */
  function votedRow(cat, V) {
    var w = V.won[cat[0]];
    return '<div class="row lg-bal-r" data-bal-row="' + cat[0] + '"><span class="grow"><span class="title">' + esc(cat[1]) + '</span><span class="sub" data-bal-say="' + cat[0] + '">' +
      (w ? "Winner: " + (w.tag ? '<a href="' + esc(w.href) + '">' + esc(w.tag) + "</a>" : "decided") : V.over ? "Being announced" : "Voting is open") + "</span></span></div>";
  }
  function votedList(V) { return '<div class="list lg-ballot" id="lgVoted">' + BALLOT.map(function (c) { return votedRow(c, V); }).join("") + "</div>"; }
  function ballotRow(cat) {
    var V = voteNow(VIEW.season); if (V.won[cat[0]]) return votedRow(cat, V);
    var self = ballotWho(), pool = ballotPool(cat, self, ballotClubs()), v = VOTES.votes ? VOTES.votes[cat[0]] : null, pick = v ? M.player(v) : null;
    return '<label class="row lg-bal-r" data-bal-row="' + cat[0] + '"><span class="grow"><span class="title">' + esc(cat[1]) + '</span><span class="sub" data-bal-say="' + cat[0] + '">' + esc(pick ? "Your vote: " + pick.tag : "No vote yet") + "</span></span>" +
      '<select class="input lg-bal-s" data-bal="' + cat[0] + '" aria-label="' + esc("Your vote for " + cat[1]) + '">' + (v ? "" : '<option value="">Pick a player</option>') + pool.map(function (pl) {
        return '<option value="' + esc(pl.id) + '"' + (v === pl.id ? " selected" : "") + ">" + esc(pl.tag + " · " + pl.club) + "</option>"; }).join("") + "</select></label>";
  }
  function ballotList() {
    if (VOTES.err) return '<div class="lg-ballot" id="lgBallot"><p class="lg-rec-note">Your ballot could not be read: ' + esc(VOTES.err) + ' <button type="button" class="btn site outline" data-bal-retry>Try again</button></p></div>';
    if (!VOTES.votes) return '<div class="lg-ballot" id="lgBallot"><p class="lg-rec-note">Reading your ballot.</p></div>';
    return '<div class="list lg-ballot" id="lgBallot">' + BALLOT.map(ballotRow).join("") + "</div>";
  }
  function ballotSec() {
    /* a display hint only (the database decides): rostered this season (S2.mine), staff or a commissioner */
    var member = S2.has("member"), can = member && (S2.has("staff") || S2.has("commish") || !!me()), V = voteNow(VIEW.season);
    var when = V.at ? "Voting closes at " + closeWords(V.at) + ", when the winners are announced." : "Voting closes when owner applications for Season " + (VIEW.season + 1) + " close, when the winners are announced.";
    if (V.over) return '<section class="lg-sec" aria-labelledby="hvote">' + secHead({ kicker: "Voted awards", id: "hvote", title: V.all ? "The winners" : "The vote has closed",
      text: (V.at && Date.now() >= Date.parse(V.at) ? "The vote closed at " + esc(closeWords(V.at)) + ". " : "") + (V.all ? "Each award went to the playoff-eligible player with the most votes (" + rule("9.2") + ")."
        : "The winners are being announced. A tie at the top, or an award with no vote for a playoff-eligible player, goes to a commissioner (" + rule("9.2") + ").") }) +
      votedList(V) + "</section>";
    var head = secHead({ kicker: "Voted awards", id: "hvote", title: can ? "Your ballot" : "Every rostered player and staffer votes",
      text: "One vote per award, for a player on another club and never yourself, and you may change it until the vote closes (" + rule("9.2") + "). Nobody sees the tally. " + esc(when) });
    if (!member) return '<section class="lg-sec" aria-labelledby="hvote">' + head + (V.any ? votedList(V) : "") + '<p class="lg-rec-note">The ballot opens to members when they join. <a href="#/you">Join with Discord</a></p></section>';
    if (!can) return '<section class="lg-sec" aria-labelledby="hvote">' + head + (V.any ? votedList(V) : "") + '<p class="lg-rec-note">Your ballot opens once you hold a roster spot in ' + esc(VIEW.name) + ", or join the staff.</p></section>";
    return '<section class="lg-sec" aria-labelledby="hvote">' + head + ballotList() +
      '<p class="lg-rec-note">Every rostered player, staffer and commissioner votes in ' + esc(VIEW.name) + ". Only a playoff-eligible player can win (" + rule("9.3") + ").</p></section>";
  }
  /* a vote is written the moment it changes and said only once the league confirms it; only its own line repaints, so
     the select stays under the finger. A refusal puts the select back to the vote on file and says the league's words */
  function ballotBind(root) {
    var host = S2.$("#lgBallot", root); if (!host) return;
    var sec = host.parentNode;
    var paint = function () { var h = S2.$("#lgBallot", sec); if (h) h.outerHTML = ballotList(); };
    sec.addEventListener("click", function (e) { if (e.target.closest("[data-bal-retry]")) { VOTES = { sid: null, who: null, votes: null, err: null, wait: null }; paint(); ballotRead().then(paint); } });
    sec.addEventListener("change", function (e) {
      var k = e.target.dataset && e.target.dataset.bal; if (!k || !e.target.value || !VOTES.votes) return;
      var sel = e.target, pid = sel.value, pl = M.player(pid), say = S2.$('[data-bal-say="' + k + '"]', sec), was = VOTES.votes[k] || "";
      sel.disabled = true; if (say) say.textContent = "Saving your vote.";
      S2.write("award_ballots.upsert", { row: { season_id: VOTES.sid, category: k, voter_id: VOTES.who, profile_id: pid, updated_at: new Date().toISOString() }, onConflict: "season_id,category,voter_id" })
        .then(function () {
          VOTES.votes[k] = pid;
          var row = S2.$('[data-bal-row="' + k + '"]', sec); if (row) row.outerHTML = ballotRow(BALLOT.filter(function (c) { return c[0] === k; })[0]);
          S2.toast("Vote saved for " + (pl ? pl.tag : "that player") + ". You can change it until the vote closes.", "ok");
        }, function (er) {
          sel.disabled = false; sel.value = was;
          if (say) say.textContent = (er.code === "S2_NO_ROWS" ? "Nothing was saved: the league did not take this vote." : er.message) + (was && M.player(was) ? " Your vote stays " + M.player(was).tag + "." : "");
        });
    });
    if (!VOTES.votes && !VOTES.err) ballotRead().then(paint);
  }
  /* v465: the record board's word on the voted awards of the season it shows: none decided yet; with the vote below (the
     same season); or, for an earlier season (Season 1's trophy room while Season 2 is on screen), each winner named */
  function votedNote(n) {
    var V = voteNow(n);
    if (!V.any) return "Season " + n + "&rsquo;s have not been awarded yet.";
    if (n === VIEW.season) return "Season " + n + "&rsquo;s are with the vote below.";
    return "Season " + n + "&rsquo;s: " + BALLOT.map(function (c) { var w = V.won[c[0]];
      return esc(c[1]) + ", " + (w && w.tag ? '<a href="' + esc(w.href) + '">' + esc(w.tag) + "</a>" : w ? "decided" : "not decided yet"); }).join("; ") + ".";
  }
  function sxAwards() {
    /* the whole season's Players of the Week (weeks 5 and 6 came after the snapshot: M.honors.potwSeason); Three Stars are
       counted from the snapshot's box scores, so that board says where it stops */
    var weeks = M.honors.potwSeasonByWeek(AW).slice().reverse(), latest = weeks[0], stars = starBoard().slice(0, 8);
    /* forward, defense, goaltender: the order Today shows the same picks in (today.js potwSection orderCat; review 2026-10-20)
       shortcut: the order is written twice, here and in today.js; move it into M.honors.potwByWeek when model.js is next opened */
    var ORD = { potw_forward: 1, potw_skater: 1, potw_defense: 2, potw_goalie: 3 };
    var inOrder = function (picks) { return picks.slice().sort(function (a, b) { return (ORD[a.category] || 9) - (ORD[b.category] || 9); }); };
    var s1 = stars[0], tr = M.trophies(AW), cup = cupOf(AW), teamT = tr.filter(function (x) { return x.team && x.key !== "stanley_cup"; });
    var filed = M.filedTitles(AW), byWho = {};
    filed.concat(tr.filter(function (x) { return !x.team; })).forEach(function (x) { byWho[x.tag] = (byWho[x.tag] || 0) + 1; });
    var most = Object.keys(byWho).sort(function (a, b) { return byWho[b] - byWho[a]; })[0], nRec = filed.length + tr.filter(function (x) { return !x.team; }).length;
    var clubs = {}; tr.filter(function (x) { return x.team; }).forEach(function (x) { clubs[x.club] = (clubs[x.club] || 0) + 1; });
    var ck = Object.keys(clubs);
    var times = {}; M.honors.potwSeason(AW).forEach(function (p) { times[p.id] = times[p.id] || { p: p, n: 0 }; times[p.id].n++; });
    var pw = Object.keys(times).map(function (k) { return times[k]; }).sort(function (a, b) { return b.n - a.n; })[0];
    return (cup ? '<section class="lg-sec" aria-labelledby="htt">' + secHead({ kicker: "Team trophies", id: "htt",
        title: ck.length === 2 && clubs[ck[0]] === clubs[ck[1]] ? cap(word(clubs[ck[0]])) + " for " + M.team(ck[0]).city + ", " + word(clubs[ck[1]]) + " for " + M.team(ck[1]).city : plural(tr.filter(function (x) { return x.team; }).length, "team trophy", "team trophies"),
        /* QA nits 9 (2026-11-25): no Rule 9.1 on the Cup's sharing or the NHL trophies. The live book's 9.1 says only that the
           championship trophy goes to the playoff champion; the November 21 trophy rulings are not published in it yet (a
           question for the commissioner in the QA report), so these sentences cite no rule until they are */
        text: "The Stanley Cup goes to the playoff champion and every player on its roster or in its training camp when the final is decided, the Presidents' Trophy to the best regular-season record, and the Prince of Wales Trophy and the Clarence S. Campbell Bowl to the East and West Division champions." }) +
      cupPanel(cup) + '<div class="lg-tiles lg-trs">' + teamT.map(trophyTile).join("") + "</div></section>" : "") +
      (nRec ? '<section class="lg-sec" aria-labelledby="hrec">' + secHead({ kicker: "By the record", id: "hrec",
        title: most && byWho[most] > 1 ? most + " takes " + word(byWho[most]) + " of the " + word(nRec) : cap(word(nRec)) + " awards by the record",
        text: "The league's titles go to the best rate per game among playoff-eligible players (" + rule("9.2") + "). Beside them, the NHL's three trophies decided by the numbers count season totals, the NHL's way." }) +
        recBoard(AW) + '<p class="lg-rec-note">Four more are decided by vote: Most Valuable Player, Best Goaltender, Best Defenseman and Rookie of the Year (' + rule("9.2") + "). " + votedNote(AW) + "</p></section>" : "") +
      ballotSec() +
      '<section class="lg-sec" aria-labelledby="hpotw">' + secHead({ kicker: "Players of the Week", id: "hpotw", title: pw && pw.n > 1 ? pw.p.tag + ", " + word(pw.n) + " times" : plural(M.honors.potwSeason(AW).length, "Player of the Week", "Players of the Week"),
        text: "Named automatically every Monday from the record: at least three games that week, every one at that position (" + rule("9.1") + "). All " + word(weeks.length) + " weeks of the regular season." }) +
      (latest ? '<h3 class="lg-wk d-3">Week ' + latest.week + '</h3><div class="lineup lg-potw">' + inOrder(latest.picks).map(function (p) {
        return '<a class="lineup-card lg-potw-c" href="' + esc(p.href) + '">' + cr(p.club, "xl") + '<span class="kicker">' + esc(p.label) + '</span><span class="d-2 lg-potw-t">' + esc(p.tag) + '</span><span class="lg-potw-l">' + esc(p.line) + "</span></a>";
      }).join("") + "</div>" : "") +
      '<ol class="lg-weeks">' + weeks.slice(1).map(function (w) {
        return '<li><span class="lg-wk-n d-3">Week ' + w.week + '</span><span class="lg-wk-p">' + inOrder(w.picks).map(function (p) {
          return '<a href="' + esc(p.href) + '">' + cr(p.club) + '<span><span class="lg-wk-k">' + esc(p.label) + "</span>" + esc(p.tag) + "</span></a>"; }).join("") + "</span></li>";
      }).join("") + "</ol></section>" +
      (stars.length ? '<section class="lg-sec" aria-labelledby="hstars">' + secHead({ kicker: "Three Stars", id: "hstars", title: s1 ? s1.tag + " has " + plural(s1.n[0], "first star", "first stars") : "Three Stars board",
        text: "Three Stars are picked for every game with a box score. The board counts three points for a first star, two for a second and one for a third, and runs " + esc(STARS_K) + "." }) +
      '<ol class="lg-stars">' + stars.map(function (s, i) {
        return '<li><span class="lg-rk num">' + (i + 1) + "</span>" + cr(s.club) + '<a href="' + esc(s.href) + '" class="lg-stars-n" title="' + esc(s.tag) + '">' + esc(s.tag) + "</a>" +   /* QA round 2: the name cuts with an ellipsis on one line, so its full tag is its title */
          '<span class="lg-stars-c" aria-label="' + s.n[0] + " first, " + s.n[1] + " second, " + s.n[2] + ' third stars">' + s.n.map(function (c, k) { return '<span class="lg-st' + (k + 1) + '"><b class="d-num">' + c + '</b><span>' + ["1st", "2nd", "3rd"][k] + "</span></span>"; }).join("") + "</span></li>";
      }).join("") + "</ol></section>" : "");
  }

  /* the tabs that count the season's lines; an empty season shows its empty state there, and keeps the directory and awards */
  var LINE_TABS = { leaders: 1, skaters: 1, goalies: 1, teams: 1 };
  function sxBody(t) {
    TBL = {};
    if (NOGAMES && LINE_TABS[t]) return noGames("#/stats" + (t === "leaders" ? "" : "?tab=" + t), "Season lines, the title races and the club figures count from the first final, every game at every position played.", t === "teams" ? "club stats" : "stats");
    return t === "skaters" ? sxSkaters() : t === "goalies" ? sxGoalies() : t === "teams" ? sxTeams() : t === "players" ? sxPlayers() : t === "awards" ? sxAwards() : sxLeaders();
  }
  function bindSx(root, t) {
    if (NOGAMES && LINE_TABS[t]) return;
    if (t === "skaters") bindPlayerTable(root, "skT", "skQ", SK, "S", "skCount");
    else if (t === "goalies") bindPlayerTable(root, "gkT", "gkQ", GK, "G", "gkCount");
    else if (t === "teams") bindTables(root);
    else if (t === "players") bindPlayers(root);
    else if (t === "awards") ballotBind(root);
    else if (t === "leaders") { bindLeaders(root); bindTitles(root); }
  }
  function sxAbout(t) {
    var by = {
      leaders: ["The four statistical titles go to the best rate per game. To qualify, a player must be playoff eligible and must have played at least " + FLOOR + " games at that position: games skated for the three scoring titles, games in goal for the Goaltending Title. " + FLOOR + " is 30% of the 54-game schedule, lower for a player who joined after opening night (" + rule("9.2") + ", with the floor from " + rule("8.3") + "). The board is the league&rsquo;s own: top five per title, bars compared with the leader&rsquo;s rate.",
        "Not on the board yet lists players closest to the floor first; former players are left out because they cannot be playoff eligible.",
        "The play style map uses every game and position played. Its names beside each corner are the skaters furthest into it. Plus/minus counts even-strength and shorthanded goals on ice; a quality start is a game saved at .885 or better."],
      skaters: [VIEW.name + " regular season, every game at every position played, disconnects included. Rates (per game and percentages) need " + SETTLE + " games: when you sort by one, lines under " + SETTLE + " games drop below the rest and show in gray italics. Groups follow the position played. Giveaways run high because EA counts every lost puck.",
        "FO% counts only games played at center, whatever position the player is registered at, so a player with no games at center has none, and it needs " + SETTLE + " games at center to sort with the settled lines. NET% is shots on goal out of shot attempts, capped at 100%, because EA can credit a shot on goal without an attempt."],
      goalies: ["Every game in goal counts, including skaters who went in net (marked Skater). GAA is goals against per game played in goal, the measure the Goaltending Title uses. A quality start is a game saved at .885 or better.",
        "DS is desperation saves, SOP is shutout periods (periods with no goal against, which a goaltender can earn in a loss) and PS% is the save percentage on penalty shots. All three are EA's own counts."],
      teams: ["Goals and special teams come from all " + FINALS + " finals. Everything else comes from the games with a box score; a forfeit without one has none, so the Box column shows how many games each club&rsquo;s figures cover. Shots, time on attack and PASS% are EA&rsquo;s own club figures, every sitting of a game added together, and a club&rsquo;s shots can run above what its players&rsquo; shots add up to. Hits, blocks, takeaways, interceptions, giveaways, penalty minutes and faceoffs add up every player line, so a club&rsquo;s FO% counts every position. Tap any heading to sort; tap it again to flip the order."],
      players: ["Everyone in the league&rsquo;s records for " + VIEW.name + " (" + M.players.length + "): those who played, were rostered or signed up. The labels are the league&rsquo;s player states: Management for an Owner, GM or AGM, Rostered, Signed up, Waived for a waived free agent, and Not signed up. A dashed ring on a rating means fewer than " + SETTLE + " games at that position."],
      awards: ["Trophies and titles are Season " + AW + "&rsquo;s as decided, read from the league&rsquo;s records. The Stanley Cup goes to the playoff champion and to every player on its roster or in its training camp when the final is decided; the Presidents&rsquo; Trophy to the most points in the regular season; the Prince of Wales Trophy and the Clarence S. Campbell Bowl to the East and West Division champions.",
        "The NHL hands out three trophies by the numbers alone, and here they count season totals the NHL&rsquo;s way: the Art Ross Trophy (points), the Maurice &ldquo;Rocket&rdquo; Richard Trophy (goals) and the William M. Jennings Trophy (the goaltender of the club that allowed the fewest goals, with 17 or more games in goal: the NHL&rsquo;s 25 of 82, scaled to the 54-game season). The league&rsquo;s own four titles go to the best rate per game (" + rule("9.2") + "). The trophies are proposed for the rulebook in " + rule("9.1") + " and " + rule("9.2") + " (the commissioner&rsquo;s rulings of November 21, 2026).",
        "Players of the Week: weeks 1 and 2 named a Skater and a Goaltender; from week 3, a Forward, a Defenseman and a Goaltender (" + rule("9.1") + ").",
        "Three Stars use the live formula: goals, assists, shots and plus/minus for skaters; saves, the win and a shutout for goaltenders.",
        "Rostered players and staff vote for the individual awards; nobody votes for themselves or their own club&rsquo;s players. Only playoff-eligible players can win (" + rule("9.2") + ", " + rule("9.3") + ")."]
    };
    if (NOGAMES && LINE_TABS[t]) return paras(["Every game at every position played counts, disconnects included, from " + VIEW.name + "&rsquo;s first final."]);
    return paras((by[t] || by.leaders).concat(NOGAMES ? [] : [esc(source())]));
  }
  /* the map picks its drawing size from the screen; redraw it once if the screen crosses the phone line */
  var mapMode = null;
  window.addEventListener("resize", function () {
    var host = document.getElementById("mapHost"), m = window.innerWidth < 600;
    if (!host || mapMode === m) { mapMode = m; return; }
    mapMode = m; host.innerHTML = mapChart(MAP.unit); S2.charts.hydrate(host); bindMap(document);
    var side = document.getElementById("mapSide"); if (side) side.innerHTML = mapSide();
  });
  /* the hero follows the tab (a deep link to Goaltenders opened on a skater's points total): each tab's lead story is its
     headline, and the tab's body opens on its content under it */
  function sxLead(t) {
    if (NOGAMES && LINE_TABS[t]) return { kicker: "Stats, " + VIEW.name, title: VIEW.name + " stats start with the first game", lede: "Every line counts from the first final, at every position played, disconnects included." };
    var top = M.leaders("p", 1)[0];
    if (t === "skaters") return { title: (top ? top.tag + "’s " + top.value + " points top " : "") + plural(M.lines({ role: "S" }).length, "skating line", "skating lines"),
      lede: "Every game at every position played counts, disconnects included.", cta: arrow("#/stats?tab=goalies", "Goaltenders", "goalies") };
    if (t === "goalies") { var g = (M.honors.titles.goaltending_title || [])[0];
      return { title: g ? g.tag + " leads the goaltending race at " + g.value.toFixed(2) : "Every game in goal",
        lede: "Every game in goal counts, including skaters who went in net. Sorted by save percentage; lines under " + SETTLE + " games rank after the rest.", cta: arrow("#/stats?tab=skaters", "Skaters", "skaters") }; }
    if (t === "teams") {
      var played = M.standings("league").filter(function (r) { return r.gp; }).sort(function (a, b) { return b.diff / b.gp - a.diff / a.gp; }), best = played[0], worst = played[played.length - 1];
      var g2 = function (r) { return (Math.round(Math.abs(r.diff / r.gp) * 100) / 100).toFixed(2); };
      return { title: best ? city(best) + " outscores opponents by " + g2(best) + " a game" : "Club statistics",
        lede: (worst && worst !== best && worst.diff < 0 ? city(worst) + " is outscored by " + g2(worst) + " a game. " : "") + "Goal difference per game for all " + word(M.teams.length) + " clubs, from every final.", cta: arrow("#/standings", "Standings", null) };
    }
    if (t === "players") {
      var c = dirCounts(), rostered = M.players.filter(function (p) { return p.rostered; }), seats = rostered.filter(function (p) { return p.seat; }).length;
      /* audit 2026-11-09: the headline said 171 on a roster while the Rostered filter said 148, because the 23 front-office
         seats were in one and not the other. The headline now counts as the filters do */
      /* health crawl 7 (2026-11-25): an empty count is said in words, never "0 players on rosters, 0 in front offices" (Season
         2 before its draft). A seat is held by a rostered player, so with nobody rostered there is no seat either.
         shortcut: an archive whose seats have ended still reads "139 players on rosters, 0 in front offices", since
         tools/ui/today.test.cjs (stream e7) pins the seat count as a numeral; say it with S2.words(seats, "none") when e7
         rewrites that check */
      var waived = c.free_agent || 0, on = rostered.length - seats;
      /* the players count in words too: once Season 2's Owners and GMs are seated, before the draft, every rostered player
         holds a seat ("No players on rosters, 16 in front offices") */
      return { title: rostered.length ? cap(S2.words(on)) + (on === 1 ? " player" : " players") + " on rosters, " + seats + " in front offices" : "No players on rosters yet",
        lede: "Of the " + M.players.length + " players in the records, " + S2.words(waived, "none") + (waived === 1 ? " was" : " were") + " waived and " + S2.words(c.unregistered || 0, "none") + ((c.unregistered || 0) === 1 ? " is" : " are") + " not signed up. The number beside each name is the headline rating, 75 to 99 with a league median of 85.",
        cta: arrow("#/stats?tab=skaters", "Every line", "skaters") };
    }
    if (t === "awards") {
      /* the season's lead story is its champion; the week-by-week honors follow under the trophies */
      var tr = M.trophies(AW), cup = cupOf(AW), pres = tr.filter(function (x) { return x.key === "presidents_trophy"; })[0];
      var pRow = pres ? (M.seasonClose(AW) || { table: [] }).table.filter(function (r) { return r.club === pres.club; })[0] : null;
      if (cup) return { kicker: "Awards, Season " + AW, title: "The " + M.team(cup.club).name + " win the Stanley Cup",
        lede: esc(finalLine(cup) + "." +
          (pres && pRow ? " " + M.team(pres.club).city + "'s " + pRow.pts + " points won the Presidents' Trophy, the best record in the league." : "")),
        cta: arrow(M.team(cup.club).href + "?tab=history", M.team(cup.club).city + "'s honors") };
      var times = {}; M.honors.potw.forEach(function (p) { times[p.id] = times[p.id] || { p: p, n: 0 }; times[p.id].n++; });
      var most = Object.keys(times).map(function (k) { return times[k]; }).sort(function (a, b) { return b.n - a.n; })[0];
      return { title: most && most.n > 1 ? most.p.tag + ", Player of the Week " + word(most.n) + " times" : plural(M.honors.potw.length, "Player of the Week", "Players of the Week") + " so far",
        lede: "Players of the Week are named automatically every Monday from the record: at least three games that week, every one at that position.", cta: arrow("#/rulebook?rule=9.1", "Rule 9.1") };
    }
    var t1 = (M.honors.titles.points_title || [])[0];
    return { title: top ? top.tag + " has " + top.value + " points in " + top.gp + " games" : VIEW.name + " stats",
      lede: (t1 && top && t1.id === top.id ? "That is " + t1.value.toFixed(2) + " a game, first in the Scoring Title race. " : "") +
        "Every game at every position counts: " + S2.fmt(BOXLINES) + " box-score lines from " + BOXED.length + " games, with a separate line for every player who skated and played goal." };
  }
  function sxHero(t) { var L = sxLead(t); return hero({ kicker: L.kicker || "Stats, " + THROUGH_K, title: L.title, lede: t === "awards" ? L.lede : esc(L.lede), cta: L.cta }); }
  /* a tab switch rewrites the hero in place: a short cross-fade, no entrance replay (S2.reveal runs once per page) */
  function heroSwap(root, t) {
    var old = S2.$(".lg-hero", root); if (!old) return;
    var box = document.createElement("div"); box.innerHTML = sxHero(t);
    var nu = box.firstElementChild; nu.classList.remove("reveal"); old.replaceWith(nu);
    if (nu.animate) nu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  }

  S2.page("stats", {
    title: "Stats", tab: "stats",
    render: function (r) {
      if (!M) return fail("Stats");
      sync();
      var t = sxTab(r.q.tab); mapMode = window.innerWidth < 600;
      return sxHero(t) + tabsBar("sxSeg", SX_TABS, t, "Stats section") +
        '<div id="sxBody" class="lg-body reveal">' + sxBody(t) + "</div>" + about(sxAbout(t));
    },
    after: function (root, r) {
      if (!M) return;
      var t = sxTab(r.q.tab); bindSx(root, t); tbLoad(root, t);
      var ctl = S2.segmented(S2.$("#sxSeg", root), function (nt, b) {
        sync();
        setQ("stats", { tab: nt === "leaders" ? "" : nt });
        heroSwap(root, nt); toTabs(root); intoRow(b);
        swap(S2.$("#sxBody", root), sxBody(nt)); bindSx(root, nt); tbLoad(root, nt);
        S2.$("#lgAboutB", root).innerHTML = sxAbout(nt);
      });
      bindViewLinks(root, ctl);
      intoRowOnLoad(S2.$("#sxSeg", root));
    }
  });

  /* =====================================================================================================
     CLUBS: the crest index and the league moves log
     ===================================================================================================== */
  /* a club as its colors and crest (imagery is type and crests only): a solid club-color tile, the crest on a white
     medallion so a crest that shares the club color still reads, the record in big condensed numerals */
  function clubTile(t, st) {
    return '<a class="lg-ct" href="' + esc(t.href) + '" style="' + esc(S2.clubBand(t)) + '">' +
      /* the club page hero's flag, word for word (profile.js clubHero): Clinched or Eliminated from the standings mark */
      (st ? '<span class="lg-ct-top"><span class="lg-ct-rk">' + ord(st.rank) + " " + esc(t.division) + "</span>" +
        (st.mark ? '<span class="lg-ct-flag">' + (st.mark === "e" ? "Eliminated" : "Clinched") + "</span>" : "") + "</span>" : "") +
      '<span class="lg-ct-medal" aria-hidden="true">' + M.crest(t.code, "xl") + "</span>" +
      '<span class="lg-ct-name"><span class="lg-ct-city">' + esc(t.city) + '</span><span class="d-2">' + esc(t.name) + "</span></span>" +
      (st ? '<span class="lg-ct-rec"><span class="d-num">' + st.w + "-" + st.l + "-" + st.otl + '</span><span class="lg-ct-pts">' + st.pts + " pts</span></span>" : "") + "</a>";
  }

  /* roster tenures turned into a public moves log: trades grouped by the moment they completed, both sides together */
  var MOVES = null;
  var MV_KINDS = [["all", "All"], ["trade", "Trades"], ["signed", "Signings"], ["waived", "Waivers"], ["placed", "Placements"], ["other", "Other"]];
  function moves() {
    if (MOVES) return MOVES;
    var draft = cal(VIEW.season, "draft_at"), draftDay = draft ? M.etDay(draft.at) : "", out = [], trades = {}, opening = 0;
    M.players.forEach(function (p) {
      var ts = (p.tenures || []).slice().sort(function (a, b) { return String(a.from).localeCompare(String(b.from)); });
      ts.forEach(function (t, i) {
        var prev = i ? ts[i - 1] : null, from = prev && prev.club !== t.club ? prev.club : null;
        /* trades, reversals and office moves that completed in the same second are one transaction: both sides together */
        if (t.how_in === "trade" || t.how_in === "trade reversed" || (t.how_in === "moved" && from)) {
          var k = t.how_in + "|" + String(t.from).slice(0, 19);
          var g = trades[k] = trades[k] || (t.how_in === "moved" ? { kind: "other", sub: "moved", at: t.from, legs: [] } : { kind: "trade", reversed: t.how_in === "trade reversed", at: t.from, legs: [] });
          g.legs.push({ p: p, from: from, to: t.club });
        } else if (t.how_in === "placed" || t.how_in === "drafted") {
          if (M.etDay(t.from) <= draftDay) opening++; else out.push({ kind: "placed", at: t.from, p: p, to: t.club, pos: t.pos });
        } else if (t.how_in === "signed") out.push({ kind: "signed", at: t.from, p: p, to: t.club, pos: t.pos });
        /* a Season 2 waiver claim (js/demo.js place, 2026-11-02) is a signing of its own kind: filed under Signings */
        else if (t.how_in === "claimed") out.push({ kind: "signed", sub: "claim", at: t.from, p: p, to: t.club, pos: t.pos });
        if (t.to && t.how_out === "waived") out.push({ kind: "waived", at: t.to, p: p, from: t.club });
        /* a departure keeps its reason private (a Discord exit or an office removal): the log only says the player left */
        else if (t.to && (t.how_out === "left Discord" || t.how_out === "league office")) out.push({ kind: "other", sub: "left", at: t.to, p: p, from: t.club });
      });
    });
    Object.keys(trades).forEach(function (k) { out.push(trades[k]); });
    out.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    return (MOVES = { list: out, opening: opening, draftDay: draft });
  }
  var MV = { kind: "all", shown: 24 };
  function tag(p) { return '<a href="' + esc(p.href) + '">' + esc(p.tag) + "</a>"; }
  function moveRow(m) {
    var text, side = "";
    if (m.legs) {
      var clubs = []; m.legs.forEach(function (l) { [l.from, l.to].forEach(function (c) { if (c && clubs.indexOf(c) < 0) clubs.push(c); }); });
      side = clubs.slice(0, 2).map(function (c) { return cr(c); }).join("");
      text = '<span class="lg-mv-k">' + (m.kind === "trade" ? (m.reversed ? "Trade reversed" : "Trade") : "Moved between clubs") + ", " + esc(list(clubs)) + '</span><span class="lg-mv-legs">' + clubs.map(function (c) {
        var got = m.legs.filter(function (l) { return l.to === c; });
        return got.length ? '<span class="lg-leg"><b>' + esc(c) + "</b> get " + got.map(function (l) { return tag(l.p); }).join(", ") + "</span>" : "";
      }).join("") + "</span>";
    } else if (m.kind === "signed" && m.sub === "claim") { side = cr(m.to); text = '<span class="lg-mv-k">Claimed off waivers, ' + esc(m.to) + "</span><span>" + tag(m.p) + " claimed by the " + esc(teamName(m.to)) + "</span>"; }
    else if (m.kind === "signed") { side = cr(m.to); text = '<span class="lg-mv-k">Signed, ' + esc(m.to) + "</span><span>" + tag(m.p) + " signed with the " + esc(teamName(m.to)) + "</span>"; }
    else if (m.kind === "placed") { side = cr(m.to); text = '<span class="lg-mv-k">Placed, ' + esc(m.to) + "</span><span>" + tag(m.p) + " placed with the " + esc(teamName(m.to)) + "</span>"; }
    else if (m.kind === "waived") { side = cr(m.from); text = '<span class="lg-mv-k">Waived, ' + esc(m.from) + "</span><span>" + tag(m.p) + " waived by the " + esc(teamName(m.from)) + "</span>"; }
    else { side = cr(m.from); text = '<span class="lg-mv-k">Left, ' + esc(m.from) + "</span><span>" + tag(m.p) + " left the " + esc(teamName(m.from)) + " roster</span>"; }
    return '<li class="lg-mv-row k-' + m.kind + (m.sub ? " k-" + m.sub : "") + '"><span class="lg-mv-t">' + text + '</span><span class="lg-mv-side">' + side + '<span class="lg-mv-time num">' + esc(M.etTime(m.at)) + "</span></span></li>";
  }
  function movesList() {
    var all = moves(), list = all.list.filter(function (m) { return MV.kind === "all" || m.kind === MV.kind; }), shown = list.slice(0, MV.shown), days = [], by = {};
    shown.forEach(function (m) { var d = M.etDay(m.at); if (!by[d]) { by[d] = []; days.push(d); } by[d].push(m); });
    if (!list.length) return S2.empty("none", "No moves of this kind yet", "They land here the moment they are complete.");   /* QA visual 6: the one empty box */
    return days.map(function (d) {
      var at = by[d][0].at;
      return '<section class="lg-mv-day"><h3 class="lg-mv-d"><span class="d-num">' + esc(M.etMonthDay(at)) + '</span><span class="lg-mv-wd">' + esc(M.etLong(at).split(",")[0]) + '</span></h3><ol class="lg-mv-list">' + by[d].map(moveRow).join("") + "</ol></section>";
    }).join("") +
      (list.length > MV.shown ? '<button type="button" class="btn site outline lg-more" id="mvMore">Show ' + Math.min(24, list.length - MV.shown) + " more of " + (list.length - MV.shown) + "</button>" : "") +
      (MV.kind === "all" || MV.kind === "placed" ? (list.length <= MV.shown ? '<p class="lg-mv-open"><b>Opening rosters, ' + esc(all.draftDay ? md(all.draftDay) : "draft night") + ":</b> " + all.opening + " players placed at and before the draft.</p>" : "") : "");
  }
  function bindMoves(root) {
    var host = S2.$("#mvHost", root); if (!host) return;
    host.addEventListener("click", function (e) {
      if (!e.target.closest("#mvMore")) return;
      /* the button replaces itself, so focus moves to the first new row instead of falling to the page */
      var y = window.scrollY, n = S2.$$(".lg-mv-row", host).length; MV.shown += 24; host.innerHTML = movesList(); window.scrollTo(0, y);
      var first = S2.$$(".lg-mv-row", host)[n]; if (first) { first.setAttribute("tabindex", "-1"); first.focus({ preventScroll: true }); }
    });
    S2.segmented(S2.$("#mvSeg", root), function (k, b) { MV.kind = k; MV.shown = 24; intoRow(b); setQ("clubs", { view: "moves", kind: k === "all" ? "" : k }); swap(host, movesList(), true); });
    intoRowOnLoad(S2.$("#mvSeg", root));
  }
  /* the log's head: the last move and the counts, one sentence. The door beside it opens the trade builder (js/flows.js),
     which a front office uses and any other role meets as S2.locked */
  function movesHead() {
    var all = moves(), counts = {}, last = all.list[0];
    all.list.forEach(function (m) { counts[m.kind] = (counts[m.kind] || 0) + 1; });
    /* QA worst 11 and visual 30 (2026-11-25): no row of zero counts, and no "since" a draft still to come. With no move yet
       the sentence says when moves start; once there are moves it names only the kinds that happened */
    var KINDS = [["trade", "trade", "trades"], ["signed", "signing", "signings"], ["waived", "waiver", "waivers"], ["placed", "placement", "placements"], ["other", "other move", "other moves"]];
    var said = KINDS.filter(function (k) { return counts[k[0]]; }).map(function (k) { return plural(counts[k[0]], k[1], k[2]); });
    var text = said.length ? list(said) + " since the draft." :
      all.draftDay && Date.parse(all.draftDay.at) > M.now.getTime() ? "Moves appear here from the draft on " + md(all.draftDay) + "." : "No moves yet.";
    /* QA function 18: a completed season's log is a record, so it offers no trade door */
    return secHead({ kicker: "League moves", id: "hmv", title: last ? "Last move: " + M.etLong(last.at) : "League moves", text: esc(text + " Only completed moves are public."),
      aside: M.view.status === "complete" ? "" : '<button type="button" class="btn site outline" data-flow="trade">Propose a trade</button>' });
  }
  S2.page("clubs", {
    title: "Clubs", tab: "clubs",
    render: function (r) {
      if (!M) return fail("Clubs");
      sync();
      MV.kind = MV_KINDS.some(function (k) { return k[0] === r.q.kind; }) ? r.q.kind : "all";
      var all = moves(), lg = M.standings("league");
      var stOf = function (code) { return lg.filter(function (x) { return x.code === code; })[0]; };
      var leaders = NOGAMES ? [] : M.league.divisions.map(function (d) { var top = lg.filter(function (x) { return x.division === d; })[0]; return top ? city(top) + " leads the " + d : ""; }).filter(Boolean);
      var drafted = all.draftDay && Date.parse(all.draftDay.at) <= M.now.getTime();
      if (NOGAMES) stOf = function () { return null; };   /* no record yet: the tiles carry no rank or record, in city order */
      return hero({ kicker: "Clubs, " + VIEW.name, title: cap(word(M.teams.length)) + " clubs" + (all.list.length || drafted ? ", " + all.list.length + " moves since the draft" : ""),
          lede: esc(cap(word(M.league.divisions.length)) + " divisions of " + word(M.teams.length / M.league.divisions.length) + ". " + (leaders.length ? list(leaders) + ". " : NOGAMES ? "Records start with " + VIEW.name + "’s first final. " : "") +
            (drafted || !all.draftDay ? "Every completed trade, signing, waiver and placement since the draft is below, newest first." : "Every completed trade, signing, waiver and placement after the draft on " + md(all.draftDay) + " lands below, newest first.")) }) +
        M.league.divisions.map(function (d, i) {
          return '<section class="lg-cdiv reveal" aria-labelledby="hcd' + i + '"><h2 class="kicker lg-cdiv-h" id="hcd' + i + '">' + esc(d) + ' Division</h2><div class="lg-tiles">' +
            M.teams.filter(function (t) { return t.division === d; }).sort(function (a, b) { return ((stOf(a.code) || {}).rank || 9) - ((stOf(b.code) || {}).rank || 9) || a.city.localeCompare(b.city); })
              .map(function (t) { return clubTile(t, stOf(t.code)); }).join("") + "</div></section>";
        }).join("") +
        '<section class="lg-sec lg-moves reveal" id="moves" aria-labelledby="hmv"><div id="mvHead">' + movesHead() + "</div>" +
          '<div class="lg-hscroll lg-filters">' + utabs("mvSeg", MV_KINDS, MV.kind, "Kind of move", "sm") + '</div><div class="lg-mvlog" id="mvHost">' + movesList() + "</div></section>" +
        about(paras([NOGAMES ? "Clubs are shown by city until " + VIEW.name + "&rsquo;s first final; then in table order with records and points." : "Clubs are shown in table order with records and points from all " + FINALS + " " + VIEW.name + " finals " + THROUGH + ".",
          "A trade appears once both clubs and the league office are done with it; trades and office moves that completed in the same second are shown as one move, both sides together. A player who left a roster is listed without the reason. Times are Eastern.",
          "Opening rosters: " + all.opening + " players were placed at and before the draft" + (all.draftDay ? " on " + esc(md(all.draftDay)) : "") + "; they are not listed as moves. Source: " + VIEW.name + " roster history."]));
    },
    after: function (root, r) {
      if (!M) return;
      bindMoves(root);
      if (r.q.view === "moves") { var m = S2.$("#moves", root); if (m) setTimeout(function () { m.scrollIntoView({ block: "start" }); }, 0); }
    }
  });

  /* =====================================================================================================
     SEASON: the public Season page the rulebook keeps citing ("appear on the Seasons page"), as a Lift-style page
     ===================================================================================================== */
  var SN = { n: 2 };
  /* Eastern calendar days, the count Today and the Control Center use (a millisecond ceiling said 55 where they say 54) */
  function daysTo(iso) { return Math.round((Date.parse(M.etDay(iso)) - Date.parse(M.etDay(M.generated || M.now.toISOString()))) / 864e5); }
  function inDays(d) { return d <= 0 ? "today" : d === 1 ? "tomorrow" : "in " + d + " days"; }
  /* the Season 2 sign-up close, said ONE way on this page. Rule S2.1 closes registration at 11:59 PM the day before the
     draft; while the seasons record says another day, every mention carries the same hedge (the hero, the Register card,
     its sheet and the calendar), and only a commissioner is told why. regEve returns the rule's day when they differ */
  function regEve() {
    var reg = cal(2, "registration_deadline"), dr = cal(2, "draft_at"); if (!reg || !dr) return null;
    var eve = new Date(Date.parse(M.etDay(dr.at)) - 864e5).toISOString().slice(0, 10);
    return M.etDay(reg.at) === eve ? null : eve;
  }
  function regWhen(long, time) {
    var reg = cal(2, "registration_deadline"); if (!reg) return "a date still to be set";
    return (long ? M.etLong(reg.at) : md(reg)) + (time ? ", " + reg.time + " ET" : "") + (regEve() ? " (date to be confirmed)" : "");
  }
  /* the calendar as a big date list: the date is the headline of each row */
  function timeline(n) {
    var s = M.control.season(n); if (!s) return '<p class="lg-none-p">No calendar for this season.</p>';
    var items = s.calendar.slice().sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); }), now = M.now.toISOString(), nextDone = false, html = "", todayPut = false;
    var today = '<li class="lg-date-today"><span class="lg-date-tk">Today</span><span>' + esc(M.etLong(now)) + "</span></li>";
    items.forEach(function (c) {
      var past = c.at < now, isNext = !past && !nextDone;
      if (!past && !todayPut) { todayPut = true; html += today; }
      if (isNext) nextDone = true;
      /* the seasons record and Rule S2.1 disagree on this date: the public sees a neutral note, only a commissioner sees why */
      var flag = c.key === "registration_deadline" && n === 2 && regEve();
      html += '<li class="lg-date' + (past ? " done" : isNext ? " next" : "") + '"><span class="lg-date-d"><span class="d-num">' + esc(M.etMonthDay(c.at)) + '</span><span class="lg-date-wd">' + esc(c.date.split(",")[0]) + " " + esc((c.date.match(/\d{4}$/) || [""])[0]) + "</span></span>" +
        '<span class="lg-date-b"><span class="lg-date-l">' + esc(c.label) + '</span><span class="lg-date-t">' + esc(c.time) + " ET" + (c.source && c.source !== "seasons" ? ", set by the commissioner" : "") + (flag ? ", date to be confirmed" : "") + "</span>" +
        (flag && S2.has("commish") ? '<span class="lg-date-note">The seasons record says ' + esc(M.etLong(c.at)) + "; " + rule("S2.1") + " says " + esc(M.etLong(flag + "T17:00:00Z")) + ", the day before the draft. One of them needs correcting.</span>" : "") + "</span>" +
        '<span class="lg-date-s">' + (past ? S2.ic("check") + '<span class="sr">Done</span>' : isNext ? "Next, " + inDays(daysTo(c.at)) : "") + "</span></li>";
    });
    if (!todayPut) html += today;
    return '<ol class="lg-dates" aria-label="' + esc(s.name) + ' calendar">' + html + "</ol>";
  }
  /* the season's shape, read from its own settings so the sentence cannot go stale */
  function tlText(n) {
    var s = M.control.season(n), sv = function (label) { var x = s ? s.summary.filter(function (y) { return y.label === label; })[0] : null; return x ? x.value : null; };
    var wk = +sv("Weeks"), nt = +sv("Nights per week");
    return "League time, Eastern. Season " + n + " is basic format" + (wk ? ", " + word(wk) + " weeks" : "") + (nt ? ", " + word(nt) + " nights a week" : "") + ".";
  }
  function tlHead(n) {
    var s = M.control.season(n), c = s ? s.calendar.slice().sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); }) : [];
    return secHead({ kicker: "Calendar", id: "htl", title: c.length ? cap(word(c.length)) + " dates, " + M.etMonthDay(c[0].at) + " to " + M.etMonthDay(c[c.length - 1].at) : "Calendar",
      text: tlText(n),
      aside: utabs("snSeg", M.control.seasons.slice().sort(function (a, b) { return b.number - a.number; }).map(function (s) { return [String(s.number), esc(s.name)]; }), String(n), "Season", "sm") });
  }
  /* the settings in force as a two-column spec list: Season 2's value, with Season 1's under it where it differs */
  function settingRows() {
    var a = M.control.season(1), b = M.control.season(2); if (!a || !b) return [];
    var sv = function (s, label) { var x = s.summary.filter(function (y) { return y.label === label; })[0]; return x ? x.value : "–"; };
    var R = M.RULES;
    return [
      ["Format", "Basic", "Basic"],
      ["Weeks", sv(a, "Weeks"), sv(b, "Weeks")],
      ["Game nights", sv(a, "Nights per week") + " a week, Wednesday to Friday", sv(b, "Nights per week") + " a week, Wednesday to Friday"],
      ["Puck drops (ET)", sv(a, "Game slots (ET)"), sv(b, "Game slots (ET)")],
      ["Roster limit", String(R.s1.composition.total), R.s2.limit + " all season, the Owner, GM and AGM included"],
      ["Roster shape", "At most " + R.s1.composition.F + " forwards, " + R.s1.composition.D + " defense, " + R.s1.composition.G + " goaltenders", "At least " + R.s2.min.F + " forwards, " + R.s2.min.D + " defense, " + R.s2.min.G + " goaltender, from the draft"],
      ["Draft", sv(a, "Draft rounds") + " rounds", sv(b, "Draft rounds") + " rounds"],
      ["Training camp", "Each club keeps its own", "One league-wide pool, requested game by game (Rule S2.5)"],   /* QA function 11: per game since 2026-11-24 (Rule S2.5), never "night by night" */
      ["Adding players", "Free agency", "Saturday bidding, 9 to 10 PM ET, for pool players with six games (Rule S2.6)"],
      ["Waivers", "A waived player is a free agent (Rule 2.2)", "Twenty-four hours for any other club to claim, then the pool (Rule S2.5)"],
      ["Weekly game limit", "Yes (Rule 5.2)", "None (Rule S2.7)"],
      ["Salary cap", sv(a, "Salary cap"), sv(b, "Salary cap")],
      ["AGM salary", sv(a, "AGM salary"), sv(b, "AGM salary")],
      ["Trade deadline", sv(a, "Trade deadline"), sv(b, "Trade deadline")],
      ["Playoff floor", sv(a, "Playoff games-played floor") + " games, prorated", sv(b, "Playoff games-played floor") + " games, prorated"],
      ["Holidays skipped", sv(a, "Holidays skipped"), sv(b, "Holidays skipped")],
      ["Sign-ups", sv(a, "Sign-ups"), sv(b, "Sign-ups")]
    ];
  }
  function settings(rows) {
    return '<dl class="lg-specs">' + rows.map(function (x) {
      var changed = x[1] !== x[2] && x[0] !== "Sign-ups";
      return '<div class="lg-spec-r' + (changed ? " ch" : "") + '"><dt>' + esc(x[0]) + "</dt><dd>" + linkRules(esc(x[2])) + (changed ? '<span class="lg-was">Season 1: ' + linkRules(esc(x[1])) + "</span>" : "") + "</dd></div>";
    }).join("") + "</dl>";
  }
  var DOORS = null;
  /* the Season 2 bid nights from the market's calendar (js/market.js, Rule S2.6 as ruled 2026-11-02): held ones and the
     holiday Saturdays skipped. The list is read whole, never "the next one" */
  /* QA function 5 (2026-11-25): the market's calendar loads with the market pages only, so a first visit to this page found
     no nights and the door said "After the draft" for good; until the market has read its calendar, the nights are the
     model's own from the seasons row (M.s2cal.bidNights, the same rule: each Saturday after the draft before the movement
     deadline, holiday weeks skipped), in the market's shape (opens and newUntil as epoch milliseconds) */
  function bidNights() {
    var L = S2.market && S2.market.bidNights ? S2.market.bidNights() : [];
    return L.length ? L : (M.s2cal.bidNights || []).map(function (b) {
      return { key: b.key, label: M.etLong(b.opens), short: M.etDate(b.opens), opens: Date.parse(b.opens), newUntil: Date.parse(b.newUntil), skipped: b.skipped, why: b.why };
    });
  }
  function dayOnly(short) { return String(short || "").replace(/^\w+, /, ""); }
  /* QA function 5 and visual 8 (2026-11-25): each door's state is read from the seasons row against the model's clock (M.now,
     the moment the league was read), as Today's Season 2 band reads it (today.js s2Band), so the page never says sign-ups
     are open after they close or offers a door that has shut. The hero, the doors and the count of open doors all read
     these. A date the row does not carry yet leaves its door open, as before. ahead: the date is still to come */
  function ahead(c) { return !c || Date.parse(c.at) > M.now.getTime(); }
  /* the reader's own Season 2 sign-up, the signal Your season reads (you.js s2RegInner); the model holds the sign-ups of
     the season on screen only, so on another season's view it is unknown and the page offers Register as before */
  function signedUp() {
    var id = S2.session && S2.session.profileId, p = id && M.view.season === 2 ? M.player(id) : null;
    return !!(p && p.signup && p.signup.status !== "declined");
  }
  /* Season 2's sign-ups so far (M.control.seasonReturn), or null when this read does not hold them: with another season on
     screen the model says "not read" with a null count (core half, c7011e8), and the object itself is always there, so a
     bare `sr ?` never fell back (health crawl 1, 2026-11-25: ?season=1#/season said "0 members are in so far", then "null
     members"). Every count on this page reads it here, and a count it does not hold is left out, never said as 0 */
  function signups() { var sr = M.control.seasonReturn; return sr && sr.signedUp != null ? sr : null; }
  /* a count of members in words as prose spells it (S2.words): "no members", "one member", "87 members" */
  function members(n) { return S2.words(n) + (n === 1 ? " member" : " members"); }
  function doorList() {
    var draft = cal(2, "draft_at"), own = cal(2, "owner_app_deadline"), dec = cal(2, "owners_decided_by"), reg = cal(2, "registration_deadline"), sr = signups(), R = M.RULES.s2;
    var regOpen = ahead(reg), ownOpen = ahead(own);
    /* the draft room's state is the draft's own (draft_state) when Season 2 is on screen, else its date */
    var dst = M.view.season === 2 && M.draft.state ? M.draft.state.status : null, drLive = dst === "live" || dst === "paused";
    /* QA round 2 (A6, 2026-11-25): done is the model's one definition (M.draftDone: draft_state, or the market's draft_done) */
    var drDone = M.view.season === 2 && M.draftDone();
    var drState = drLive ? (dst === "paused" ? "Paused" : "Live now") : drDone ? "Done" : ahead(draft) ? "Opens " + md(draft) : "Held " + md(draft);
    /* Rule 2.7 (the menu's not: "staff", core.js): a staffer or commissioner applies to neither, so those doors are not theirs */
    var staffer = S2.has("staff");
    return [
      { k: "register", state: regOpen ? "Open now" : "Closed " + md(reg), open: regOpen, t: "Register", line: "Sign up to play in Season 2. Everyone signs up again, including every Season 1 player.",
        spec: [[regOpen ? "Closes" : "Closed", regWhen(false, true)], ["Signed up", sr ? cap(members(sr.signedUp)) + " " + (regOpen ? "so far" : "in all") : regOpen ? "Open" : "Closed"], ["Draft", md(draft)], ["Format", "Basic"]] },
      staffer ? null : { k: "owner", state: (ownOpen ? "Closes " : "Closed ") + md(own), open: ownOpen, t: "Own a club", line: "Apply to own any of the thirty-two NHL franchises for Season 2.",
        spec: [["Decided by", md(dec)], ["Who may apply", "Members signed up for Season 2"], ["Franchises", "Name up to three"], ["Sitting owners", "Apply again"]] },
      staffer ? null : { k: "staff", state: "Open now", open: true, t: "Join the staff", line: "Help run the league as one staff group, with committees by topic, each led by a committee manager.",
        spec: [["Decided by", "A vote of all staff and commissioners, more than half"], ["Committees", "Six, from officiating to draft and bidding"], ["Front offices", "Kept separate (Rule 2.7)"], ["Desk", "Every staffer works all of it"]] },
      /* opens: each door still to come names its own first day (review 2026-11-03: one "open once the draft begins" clause
         put Saturday bidding on draft night, a week before the first bid night) */
      { k: "draft", state: drState, open: drLive, opens: drLive || drDone || !ahead(draft) ? "" : "The draft room opens " + (draft ? "on " + M.etLong(draft.at) : "on a date still to be set"), t: "Draft room", line: cap(word(R.draftRounds)) + " rounds, live, " + (draft ? draft.time : "9:00 PM") + " ET. Anyone can watch.",
        spec: [["Rounds", String(R.draftRounds)], ["Seated first", "Owner and GM, required"], ["Roster", R.limit + " all season"], ["Minimums", R.min.F + " F, " + R.min.D + " D, " + R.min.G + " G"], ["Not drafted", "Joins the camp pool"]] },
      /* commissioner, 2026-11-02: "Only training camp players with at least 6 games played can be bid on at the saturday
         bidding events." and "bids always start at 750k and can only be raised by 250k at a time" */
      (function () {
        /* the market's nights carry opens and newUntil as epoch milliseconds (js/market.js lBidNights) */
        var now = M.now.getTime(), held = bidNights().filter(function (b) { return !b.skipped; }), soonDraft = ahead(draft);
        var on = held.filter(function (b) { return b.opens <= now && now < b.newUntil; })[0], next = held.filter(function (b) { return b.opens > now; })[0];
        var state = on ? "Live now" : !held.length ? (soonDraft ? "After the draft" : "Dates to come") : next ? (next === held[0] ? "From " : "Next ") + next.short : "Over for the season";
        var opens = on || (held.length && !next) ? "" : !held.length ? (soonDraft ? "Saturday bidding opens after the draft" : "Saturday bidding's nights are still to be set") :
          "Saturday bidding " + (next === held[0] ? "opens on " : "is next on ") + next.label;
        return { k: "bidding", state: state, open: !!on, opens: opens, t: "Saturday bidding", line: "Live every Saturday, 9 to 10 PM ET, for training camp players with six games played.",
          spec: [["First bid", "$750K"], ["Each raise", "Exactly $250K"], ["Back-to-back bids", "Never by one club"], ["Bid nights", held.length ? list(held.map(function (b) { return dayOnly(b.short); })) : "Before the movement deadline"]] };
      })()
    ].filter(Boolean);
  }
  /* the Register button, said one way in the hero and on the door: a guest joins first, a member who is signed up goes to
     Your season (signing up again is a change there, not a second sign-up), and nobody is offered it once sign-ups close */
  function registerBtn(d, inHero) {
    if (!d.open) return "";
    if (S2.state.role === "guest") return '<a class="btn site discord" href="#/you">Join with Discord</a>';
    if (signedUp()) return '<a class="btn site outline" href="#/you?tab=season">You are signed up</a>';
    return inHero ? '<button type="button" class="btn site" data-flow="register">Register for Season 2</button>' : '<button type="button" class="btn site" data-door="register" aria-label="Register for Season 2">Register</button>';
  }
  function doors() {
    return '<div class="lineup lg-doors">' + (DOORS = doorList()).map(function (d) {
      var btn = d.k === "register" && d.open ? registerBtn(d) :
        '<button type="button" class="btn site outline" data-door="' + d.k + '" aria-label="Details: ' + esc(d.t) + '">Details</button>';
      return '<article class="lg-door"><span class="kicker lg-door-st' + (d.open ? " open" : "") + '">' + esc(d.state) + '</span><h3 class="d-2">' + esc(d.t) + "</h3>" +
        '<p class="lg-door-l">' + esc(d.line) + '</p><dl class="spec">' + d.spec.map(function (s) { return fact(s[0], s[1]); }).join("") + "</dl>" + btn + "</article>";
    }).join("") + "</div>";
  }
  function doorSheet(k) {
    var guest = S2.state.role === "guest", draft = cal(2, "draft_at"), own = cal(2, "owner_app_deadline");
    var door = (DOORS || doorList()).filter(function (d) { return d.k === k; })[0], shut = !!door && !door.open && (k === "register" || k === "owner");
    var T = { register: ["Register for Season 2", ["Every player signs up again for Season 2, including everyone who played in Season 1. Signing up changes nothing about a Season 1 club (Rule S2.2).", "Sign-ups " + (shut ? "closed " : "close ") + regWhen(false, true) + ", before the draft on " + md(draft) + "."]],
      /* AGM after the draft and the 3 F / 2 D / 1 G minimums: commissioner, 2026-11-23 */
      draft: ["Draft room", ["The draft is " + word(M.RULES.s2.draftRounds) + " rounds. Every club must have its General Manager seated before it, so the Owner, the General Manager and the " + word(M.RULES.s2.draftRounds) + " picks make a club's " + word(M.RULES.s2.limit) + "; the Assistant General Manager is named after it, from those players (Rules S2.3 and 2.6). The room refuses a pick that would leave a club unable to reach " + word(DR_MIN.F) + " forwards, " + word(DR_MIN.D) + " defense and " + word(DR_MIN.G) + " goaltender inside its " + word(M.RULES.s2.limit) + " (Rule S2.4).", "Players not selected join the league-wide training camp pool (Rule S2.5).", "The room opens on draft night, " + (draft ? M.etLong(draft.at) + " at " + draft.time + " ET" : "a date still to be set") + ". Anyone can watch it live there."]],
      bidding: ["Saturday bidding", biddingCopy()],
      owner: ["Own a club", ["Every club's ownership is decided again for Season 2, and a sitting Owner applies like anyone else (Rule S2.2).", "An applicant may name any three of the thirty-two NHL franchises. No application is decided before applications close on " + md(own) + "." + (shut ? " Applications are now closed." : "")]],
      staff: ["Join the staff", ["In Season 2 the staff is one group: every staffer can work the whole Staff Desk, and each of the six committees has a manager who sets its priorities. A staff application is decided by a vote of all staff and commissioners, and it passes when more than half of them approve (Rule S2.8).", "League staff and club front offices are kept separate (Rule 2.7), and an official never rules on a game they play in or manage (Rule 3.2)."]] }[k];
    if (!T) return;
    var sh = S2.sheet({ title: T[0], html: '<div class="lg-sheet">' + T[1].map(function (p) { return '<p class="t-body">' + linkRules(esc(p)) + "</p>"; }).join("") +
      /* every door opens something (commissioner, 2026-10-19): the forms are js/flows.js's filings and the draft room is
         #/draft. Bidding has no form of its own (2026-11-02: the bid sheet flow is retired): anyone may watch the bid room
         and the pool, and a front office plans on its bid board in Team HQ */
      (k === "draft" ? '<a class="btn site" href="#/draft">Open the draft room</a>' :
        k === "bidding" ? '<div class="lg-sheet-acts"><a class="btn site" href="#/bidding">Watch the bid room</a><a class="btn site outline" href="#/camp">See the training camp pool</a>' +
          (S2.has("office") ? '<a class="btn site outline" href="#/hq?tab=bidding">Your club&rsquo;s bid board</a>' : "") + "</div>" +
          (S2.has("office") ? "" : '<p class="t-foot">A club&rsquo;s front office sets its bid board in Team HQ, any time before a bid night.</p>') :
        shut ? "" : guest ? '<a class="btn site discord" href="#/you">Join with Discord to continue</a>' :
        '<button type="button" class="btn site" data-flow="' + ({ register: "register", owner: "owner", staff: "staff" })[k] + '">' + (k === "register" ? "Start registration" : "Start your application") + "</button>") + "</div>" });
    /* a rule link or Join changes the page behind, so the sheet closes and the page is no longer scroll-locked */
    sh.el.addEventListener("click", function (e) { if (e.target.closest('a[href^="#/"]')) sh.close(); });
  }
  /* the bidding door's sheet: the pool, waivers and Saturday bidding as ruled (commissioner, 2026-11-02), in the order a
     player meets them. "Any team can pick up a player placed on waivers up to 24 hours after they have been waived" and
     "Teams must not waive inactive players but should report them" (the league office handles inactive players; see
     BRIEF.md, privacy) */
  function biddingCopy() {
    var bn = bidNights(), held = bn.filter(function (b) { return !b.skipped; }), off = bn.filter(function (b) { return b.skipped; });
    return ["Players without a club roster spot form one league-wide training camp pool. A club requests an available pool player for one of its games and the player accepts or declines it; the first acceptance wins, a pool player plays for one club a night, and at least half of every lineup comes from the club's own roster (Rule S2.5).",
      "A rostered player joins the pool only through waivers. For twenty-four hours any other club with an open roster spot and room under the cap may claim them at their salary, and the first claim wins. A club never waives a player for being inactive; it reports them to the league office instead (Rule S2.5).",
      String(M.RULES.s2.bidding).replace(/\.?$/, "."),
      "Only a pool player with six games played may be bid on. Bids open at $750K and rise by exactly $250K. A club holding the top bid on a player waits for another club to raise it before bidding on that player again, and no bid may take a club over its roster limit or the salary cap, counting every bid it leads (Rule S2.6).",
      held.length ? "Bid nights: " + list(held.map(function (b) { return b.label; })) + ", 9 to 10 PM ET." + (off.length ? " None on " + list(off.map(function (b) { return dayOnly(b.short); })) + ", which fall in holiday weeks (Rule S2.6)." : "")
        : "After the movement deadline, clubs add players only through single-game requests from the training camp pool (Rule S2.5)."];
  }
  /* where the season on screen stands: not started, its regular season, its playoffs, or complete. The table counts are the
     regular season's (the standings count no other stage) */
  function seasonNow() {
    var lg = M.standings("league"), end = cal(VIEW.season, "ends_at"), po = cal(VIEW.season, "playoffs_start_at");
    var reg = M.games.filter(function (g) { return g.stage === "regular"; }), left = reg.filter(function (g) { return !g.isFinal; }).length;
    var band = function (title, text, aside) {
      return '<section class="band tint lg-band lg-now reveal" aria-labelledby="hnow">' + secHead({ kicker: VIEW.name + " now", id: "hnow", title: title, text: esc(text), aside: aside }) + "</section>";
    };
    if (NOGAMES) {
      var dr = cal(VIEW.season, "draft_at"), go = cal(VIEW.season, "starts_at"), cup = PREV ? cupOf(PREV) : null;
      return band(VIEW.name + " has not started", (dr ? "The draft " + (ahead(dr) ? "is " : "was ") + M.etLong(dr.at) + (go ? " and puck drop " + M.etLong(go.at) : "") + ". " : go ? "Puck drop " + (ahead(go) ? "is " : "was ") + M.etLong(go.at) + ". " : "") +
          (cup ? "Season " + PREV + " is complete: the " + M.team(cup.club).full + " won the Stanley Cup." : ""),
        PREV ? arrow(S2.seasonHref(PREV, "#/standings"), "Season " + PREV + " standings") : "");
    }
    /* health crawl 1 (2026-11-25): a complete season (an archive, or the current season before the next one opens) is said
       as decided, with its champion and its final table; it read "Season 1's regular season is complete" over a link to the
       playoff race, three weeks after the Cup was won. A bare #/standings keeps the address's season, so the link opens the
       final table of the season this card describes */
    if (VIEW.status === "complete") {
      var won = cupOf(VIEW.season);
      return band(VIEW.name + " is complete", (won ? finalLine(won) + ", to win the Stanley Cup. " : "") + (lg[0] ? lg[0].team.full + " finished first in the regular season on " + lg[0].pts + " points." : ""),
        arrow("#/standings", VIEW.name + " final standings"));
    }
    /* a playoff night is a round, never a regular-season week (health crawl 3's labels, M.stageText). The season is in the
       playoffs once a playoff final is played: between the regular season's last night and the first playoff final its
       regular season is complete (review 2026-11-25: it read "is in the playoffs" beside "the playoffs begin <date>") */
    var inPo = M.games.some(function (g) { return g.stage === "playoff" && g.isFinal; });
    /* QA visual 11 and worst 3 (2026-11-25): a finished schedule is said as played, never "0 of 241 games are left", and a
       date already behind the league's clock is said in the past tense */
    return band(inPo ? VIEW.name + " is in the playoffs" : NEXT && left ? VIEW.name + " is in week " + NEXT.week : VIEW.name + "'s regular season is complete",
      (left ? left + " of " + reg.length + " regular-season games are left. " : "All " + reg.length + " regular-season games are played. ") + (lg[0] ? lg[0].team.full + " lead the league on " + lg[0].pts + " points. " : "") +
        (end ? "The regular season " + (ahead(end) ? "ends " : "ended ") + M.etLong(end.at) + (po ? " and the playoffs " + (ahead(po) ? "begin " : "began ") + M.etLong(po.at) : "") + "." : ""),
      /* once the regular season is played the link opens the real playoff games (M.stageHref, the address a playoff game
         gives), never the standings' projected bracket ("If the season ended today") */
      left ? arrow("#/standings?view=race", "The playoff race") : arrow(M.stageHref({ stage: "playoff" }), "Playoff games"));
  }

  S2.page("season", {
    title: "Season", tab: "season",
    render: function (r) {
      if (!M) return fail("Season");
      sync();
      SN.n = r.q.season === "1" ? 1 : 2;
      var s2 = M.control.season(2), now = M.now.toISOString(), next = s2 ? s2.calendar.filter(function (c) { return c.at > now; }).sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); })[0] : null;
      var drop = cal(2, "starts_at"), reg = cal(2, "registration_deadline"), sr = signups();
      var rows = settingRows(), changed = rows.filter(function (x) { return x[1] !== x[2] && x[0] !== "Sign-ups"; }).length, dl = doorList(), open = dl.filter(function (d) { return d.open; }).length;
      var regDoor = dl.filter(function (d) { return d.k === "register"; })[0], soon = dl.filter(function (d) { return !d.open && d.opens; });
      return hero({ kicker: "Chel Gaming Hockey League", title: "Season 2", cls: "lg-h1-xl",
          lede: esc((drop ? "Puck drop " + (ahead(drop) ? "is " : "was ") + M.etLong(drop.at) + ", " + (drop.date.match(/\d{4}$/) || [""])[0] + ". " : "") +
            (regDoor.open ? "Sign-ups are open" + (reg ? " until " + regWhen(true) : "") + (sr ? ", and " + members(sr.signedUp) + (sr.signedUp === 1 ? " is" : " are") + " in so far." : ".")
              : "Sign-ups closed " + (reg ? regWhen(true) : "") + (sr ? ", with " + members(sr.signedUp) + " signed up." : "."))),
          cta: registerBtn(regDoor, true) + '<button type="button" class="btn site outline" id="snDates">See the dates</button>',
          side: next ? '<div class="lg-cd"><span class="d-num lg-cd-n" data-count="' + daysTo(next.at) + '">' + daysTo(next.at) + '</span><span class="lg-cd-l">' + (daysTo(next.at) === 1 ? "day" : "days") + " until " + esc(next.label.toLowerCase()) + ", " + esc(md(next)) + "</span></div>" : "" }) +
        seasonNow() +
        '<section class="lg-sec reveal" aria-labelledby="hdoors">' + secHead({ kicker: "Take part", id: "hdoors", title: cap(word(dl.length)) + " ways into Season 2",
          text: [open ? cap(word(open)) + (open === 1 ? " is" : " are") + " open today." : "None is open today."].concat(soon.map(function (d) { return d.opens + "."; })).join(" ") }) + doors() + "</section>" +
        '<section class="lg-sec reveal" id="snCal" aria-labelledby="htl"><div id="tlHead">' + tlHead(SN.n) + '</div><div id="tlHost">' + timeline(SN.n) + "</div></section>" +
        '<section class="lg-sec reveal" aria-labelledby="hset">' + secHead({ kicker: "Settings in force", id: "hset", title: plural(changed, "setting changes", "settings change") + " for Season 2",
          text: "Both seasons run the basic format. Each value is Season 2&rsquo;s, with Season 1&rsquo;s beneath it where it differs.", aside: arrow("#/rulebook?rule=S2.1", "Chapter S2") }) + settings(rows) + "</section>" +
        about(paras(["League time is Eastern. Dates come from each season&rsquo;s record; Season 2&rsquo;s owner decision date comes from the commissioner&rsquo;s ruling.",
          "Season 2 changes are set out in the rulebook&rsquo;s Season 2 chapter (" + rule("S2.1") + " to " + rule("S2.8") + "). The salary cap counts the whole roster.",
          sr ? "The sign-up count is everyone signed up for Season 2 now, " + S2.words(sr.playedS1, "none") + " of whom played in Season 1." : ""]));
    },
    after: function (root) {
      if (!M) return;
      var paint = function (v) { SN.n = +v; setQ("season", { season: v === "2" ? "" : v }); swap(S2.$("#tlHost", root), timeline(SN.n)); };
      /* the head carries its own switcher, so only its words change: the control the reader just used stays put */
      S2.segmented(S2.$("#snSeg", root), function (v) {
        var h = S2.$("#htl", root), s = M.control.season(+v), c = s ? s.calendar.slice().sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); }) : [];
        if (h && c.length) h.textContent = cap(word(c.length)) + " dates, " + M.etMonthDay(c[0].at) + " to " + M.etMonthDay(c[c.length - 1].at);
        var p = S2.$("#tlHead .sec-head p", root); if (p) p.textContent = tlText(+v);
        paint(v);
      });
      root.addEventListener("click", function (e) { var b = e.target.closest("[data-door]"); if (b) doorSheet(b.dataset.door); });
      var dates = S2.$("#snDates", root);
      if (dates) dates.addEventListener("click", function () { var c = S2.$("#snCal", root); if (c) c.scrollIntoView({ block: "start", behavior: S2.reduce.matches ? "auto" : "smooth" }); });
    }
  });
  var DR_MIN = M ? M.RULES.s2.min : { F: 3, D: 2, G: 1 }, DR_LIMIT = M ? M.RULES.s2.limit : 12;

  /* =====================================================================================================
     RULEBOOK: the published book, with sticky contents and find-in-page that never re-routes
     ===================================================================================================== */
  /* v5.00 swap (e6, one book; main session 2026-11-24): the page shows the ONE live rulebook, S2.RB from js/rulebook.js,
     which tools/s2-rulebook-js-build.cjs renders from src/live/part3_content.js with the live site's own
     CG.rulebookForFormat (tools/s2-rulebook-js-drift.test.cjs fails until it is rebuilt after a change). It replaced the
     concept's abridged copy of 60 sections and its proposed-text marks: what the commissioner rules reaches this page only
     by being published in the live book. Same chapters, same order, same words as the current site: Chapters 0 to 10,
     Chapter S2 and Appendix A, the full format's text held in reserve, each A.x section marked Shelved as the live site does. */
  var RB = S2.RB || null;
  var RB_IDS = {};
  if (RB) RB.chapters.forEach(function (c) { c.sections.forEach(function (s) { RB_IDS[s.id] = s; }); });
  /* a citation in the prose becomes links: every number in it links the whole number to its section ("Rule 4.3.6" is one
     link to 4.3, the book's sections having two parts), through a list ("Rules 2.3, 2.4 and 6.3", "Rules 9.1 to 9.3",
     "Rules 4.3.4, 4.3.7 and 4.3.10"); the words between stay text, and a number with no section in the book stays text.
     Health crawl 8 (2026-11-25): the pattern read two parts and at most two numbers, so "Rule 4.3.6" underlined "4.3" and
     left ".6" plain (11 citations on the book's page), and a list linked only its first two numbers */
  var CITE_N = "S?\\d+(?:\\.\\d+)+", CITE = new RegExp("\\b(Rules?) (" + CITE_N + "(?:(?:,? and |, | to | or )" + CITE_N + ")*)", "g");
  function linkRules(html) {
    return html.replace(CITE, function (m, w, nums) {
      return w + " " + nums.replace(new RegExp(CITE_N, "g"), function (x) {
        var id = /^S?\d+\.\d+/.exec(x)[0];
        return RB_IDS[id] ? '<a href="#/rulebook?rule=' + id + '" data-rule="' + id + '">' + x + "</a>" : x;
      });
    });
  }
  function chLabel(c) { return (c.shelved ? "Appendix " : "Chapter ") + c.num; }
  /* season settings are written in the book as tokens, never figures, so it cannot quote a stale cap (the live site's rule):
     {{CAP}} is the cap of the season on screen, as the live site reads CG.CAP from the season it shows */
  function rbText(t) {
    if (t.indexOf("{{CAP}}") < 0) return t;
    var s = M && M.control.season(M.view.season), cap = s && s.settings.salary_cap;
    return t.split("{{CAP}}").join(cap ? M.money(cap) : "the published cap");
  }
  function rbToc() {
    return RB.chapters.map(function (c) {
      return '<div class="lg-toc-ch"><span class="lg-toc-cn">' + chLabel(c) + '</span><span class="lg-toc-ct">' + esc(c.title) + "</span></div>" +
        c.sections.map(function (s) { return '<a class="lg-toc-a" href="#/rulebook?rule=' + s.id + '" data-rule="' + s.id + '"><span class="num">' + s.id + "</span><span>" + esc(s.title) + "</span></a>"; }).join("");
    }).join("");
  }
  function rbBody() {
    return RB.chapters.map(function (c) {
      /* the current site's chapter chips (src/live/part5b_public2.js): "Season 2" on the upcoming season's chapter, "not
         in force" on the format held in reserve */
      var chip = c.upcomingSeason ? '<span class="chip lg-rb-chip">Season ' + esc(c.upcomingSeason) + "</span>" : c.shelved ? '<span class="chip lg-rb-chip">not in force</span>' : "";
      return '<section class="lg-rb-ch" aria-labelledby="rbc-' + c.num + '"><h2 class="lg-rb-cht" id="rbc-' + c.num + '"><span class="kicker">' + chLabel(c) + '</span><span class="d-2">' + esc(c.title) + "</span>" + chip + "</h2>" +
        (c.intro ? '<p class="lg-rb-intro">' + linkRules(esc(c.intro)) + "</p>" : "") +
        c.sections.map(function (s) {
          return '<section class="lg-rb-sec" id="rb-' + s.id + '" data-rule="' + s.id + '"><h3 class="lg-rb-st"><span class="lg-rb-no num">' + s.id + "</span>" + esc(s.title) +
            (c.shelved ? '<span class="chip warn lg-rb-chip" title="' + esc("The other format's text for Rule " + s.of + ", preserved and not in force") + '">Shelved</span>' : "") + "</h3>" +
            s.paragraphs.map(function (p, i) { return '<p class="lg-rb-p" data-i="' + i + '"><span class="lg-rb-pn num" aria-hidden="true">' + (i + 1) + "</span>" + linkRules(esc(rbText(p))) + "</p>"; }).join("") + "</section>";
        }).join("") + "</section>";
    }).join("");
  }
  function rbJump(root, id, smooth) {
    var el = document.getElementById("rb-" + id); if (!el) return false;
    el.scrollIntoView({ block: "start", behavior: smooth && !S2.reduce.matches ? "smooth" : "auto" });
    var h = S2.$(".lg-rb-st", el);
    if (h && h.animate) h.animate([{ backgroundColor: "var(--accent-soft)" }, { backgroundColor: "transparent" }], { duration: 1400, easing: "ease-out" });
    el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true });     /* the reader's place moves with the jump */
    setQ("rulebook", { rule: id });
    return true;
  }
  function rbFind(root) {
    var input = S2.$("#rbQ", root), body = S2.$("#rbBody", root), count = S2.$("#rbCount", root), bar = S2.$("#rbFind", root), marks = [], cur = -1;
    var paras = S2.$$(".lg-rb-p, .lg-rb-intro", body).map(function (p) { return { el: p, html: p.innerHTML, text: p.textContent }; });
    /* the arrows are never disabled (the open concept): with nothing found, a press says so where the count is, with a small
       nudge (an opacity blink under reduced motion), instead of doing nothing */
    function go(i) {
      if (!marks.length) {
        var q = input.value.trim();
        count.textContent = q.length < 2 ? "Type two letters or more" : "No matches for “" + q + "”";
        if (count.animate) count.animate(S2.reduce.matches ? [{ opacity: 0.3 }, { opacity: 1 }] : [{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
        return;
      }
      if (cur >= 0 && marks[cur]) marks[cur].classList.remove("cur");
      cur = (i + marks.length) % marks.length; marks[cur].classList.add("cur");
      marks[cur].scrollIntoView({ block: "center", behavior: S2.reduce.matches ? "auto" : "smooth" });
      count.textContent = (cur + 1) + " of " + marks.length;
    }
    function run() {
      var q = input.value.trim(), ql = q.toLowerCase(); marks = []; cur = -1;
      paras.forEach(function (p) {
        if (q.length < 2 || p.text.toLowerCase().indexOf(ql) < 0) { if (p.el.innerHTML !== p.html) p.el.innerHTML = p.html; return; }
        /* while searching, a paragraph shows plain text with its matches marked; clearing the search restores its rule links */
        var t = p.text, out = "", i = 0, j, lt = t.toLowerCase(), num = p.el.querySelector(".lg-rb-pn");
        var start = num ? num.textContent.length : 0;
        out = num ? num.outerHTML : ""; i = start;
        while ((j = lt.indexOf(ql, i)) >= 0) { out += esc(t.slice(i, j)) + "<mark>" + esc(t.slice(j, j + q.length)) + "</mark>"; i = j + q.length; }
        p.el.innerHTML = out + esc(t.slice(i));
      });
      marks = S2.$$("mark", body);
      bar.hidden = q.length < 2;
      /* sections without a match fade only when something matched: with no match at all, the whole book faded and looked
         disabled (review 2026-10-20) */
      S2.$$(".lg-rb-sec", body).forEach(function (s) { s.classList.toggle("lg-dim", q.length >= 2 && marks.length > 0 && !S2.$("mark", s)); });
      if (q.length >= 2) { if (marks.length) go(0); else count.textContent = "No matches"; }
      bar.classList.toggle("none", !marks.length);
    }
    input.addEventListener("input", run);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(cur + (e.shiftKey ? -1 : 1)); } else if (e.key === "Escape") { input.value = ""; run(); } });
    S2.$("#rbPrev", root).addEventListener("click", function () { go(cur - 1); });
    S2.$("#rbNext", root).addEventListener("click", function () { go(cur + 1); });
    return run;
  }
  function rbSpy(root) {
    if (!("IntersectionObserver" in window)) return;
    var links = S2.$$(".lg-rb-side .lg-toc-a", root);
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var id = e.target.dataset.rule;
        links.forEach(function (a) { if (a.dataset.rule === id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    S2.$$(".lg-rb-sec", root).forEach(function (s) { io.observe(s); });
    /* stop watching once the page is replaced */
    window.addEventListener("hashchange", function stop() { io.disconnect(); window.removeEventListener("hashchange", stop); });
  }

  S2.page("rulebook", {
    title: "Rulebook", tab: "rulebook",
    render: function (r) {
      if (!M) return fail("Rulebook");
      if (!RB) return fail("Rulebook", "js/rulebook.js did not load, so the rulebook cannot be shown. Reload the page.");
      var day = function (iso) { return M.etLong(iso + "T16:00:00Z").replace(/^\w+, /, "") + ", " + iso.slice(0, 4); };   /* "November 24, 2026" */
      var d = day(RB.dateIso), full = RB.format === "full", first = RB.changelog[RB.changelog.length - 1];
      var inForce = RB.chapters.filter(function (c) { return !c.shelved; }), n = inForce.reduce(function (a, c) { return a + c.sections.length; }, 0);
      return hero({ kicker: "Rulebook, version " + RB.version, title: "The CGHL rulebook",
          lede: esc("Amended " + d + ". Start with Chapter 0, which explains how the season works step by step. " + (full ? "This season runs the full format; the basic format is preserved in Appendix A." :
            "This season runs the basic format, the league standard; the full format is preserved in Appendix A.") + " Cite any rule by its number anywhere in the league.") }) +
        '<div class="lg-rb">' +
          '<aside class="lg-rb-side reveal" aria-label="Contents and search"><div class="lg-rb-tools">' +
            '<label class="lg-search"><span class="sr">Search the rulebook</span>' + S2.ic("search") + '<input class="input" type="search" id="rbQ" placeholder="Search the rulebook" autocomplete="off" spellcheck="false" enterkeyhint="search" value="' + esc(r.q.q || "") + '"></label>' +
            /* one sticky row on a phone: the button drops to its icon below 400px, and the find counter and arrows take its
               place while a search is open, so the chrome over a reading page stays one row tall */
            '<button type="button" class="btn site outline lg-rb-toc-btn" id="rbToc" aria-label="Contents"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".6" fill="currentColor"/><circle cx="4.5" cy="12" r=".6" fill="currentColor"/><circle cx="4.5" cy="18" r=".6" fill="currentColor"/></svg><span class="lg-rb-toc-l">Contents</span></button>' +
            '<div class="lg-rb-find" id="rbFind" hidden><span class="num" id="rbCount" aria-live="polite"></span>' +
              '<button type="button" class="icon-btn" id="rbPrev" aria-label="Previous match"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg></button>' +
              '<button type="button" class="icon-btn" id="rbNext" aria-label="Next match"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button></div>' +
          '</div><nav class="lg-toc" aria-label="Contents">' + rbToc() + "</nav></aside>" +
          '<article class="lg-rb-body reveal" id="rbBody">' + rbBody() + "</article></div>" +
        about(paras(["This is the published rulebook, version " + esc(RB.version) + ", word for word: " + word(inForce.length) + " chapters and " + n + " sections in force, and Appendix A, which keeps the " + (full ? "basic" : "full") +
            " format&rsquo;s text and is not in force. It has had " + RB.changelog.length + " releases since " + esc(day(first.dateIso)) + ".",
          "Search marks every match in the book; Enter moves to the next match and Shift+Enter to the previous one. Rule numbers in the text link to the section they name."]) +
          /* the version history, newest first, as the live site lists it; the few releases whose summary names a member, or
             describes the application waitlist Season 2 removes entirely, carry none in S2.RB (tools/s2-rulebook-js-build.cjs
             NO_SUMMARY and WAITLIST_SUMMARY) and show their version and date only */
          '<ol class="lg-rb-hist" aria-label="Version history">' + RB.changelog.map(function (c) {
            return '<li><span class="num">v' + esc(c.version) + '</span><span class="lg-rb-hd">' + esc(day(c.dateIso)) + "</span>" + (c.summary ? "<p>" + esc(c.summary) + "</p>" : "") + "</li>";
          }).join("") + "</ol>", "About the rulebook");
    },
    after: function (root, r) {
      if (!M || !RB) return;
      var run = rbFind(root);
      S2.$(".lg-rb", root).addEventListener("click", function (e) {
        var a = e.target.closest("a[data-rule]"); if (!a) return;
        e.preventDefault(); rbJump(root, a.dataset.rule, true);
      });
      S2.$("#rbToc", root).addEventListener("click", function () {
        /* the page starts moving while the sheet slides away; the sheet hands focus back to Contents once it is gone, so
           focus is taken on to the chosen section after that */
        var pick = null, sh = S2.sheet({ title: "Contents", html: '<nav class="lg-toc lg-toc-sheet" aria-label="Contents">' + rbToc() + "</nav>",
          onClose: function () { var el = pick && document.getElementById("rb-" + pick); if (el) el.focus({ preventScroll: true }); } });
        sh.body.addEventListener("click", function (e) {
          var a = e.target.closest("a[data-rule]"); if (!a) return;
          e.preventDefault(); pick = a.dataset.rule; sh.close(); setTimeout(function () { rbJump(root, pick, true); }, 260);
        });
      });
      rbSpy(root);
      if (r.q.q) run();
      if (r.q.rule) setTimeout(function () { rbJump(root, r.q.rule, false); }, 0);
    }
  });

  /* ---------- the header's League and Season menus (header v2, js/core.js S2.NAV): this page owns clubs and seasons ---------- */
  /* every club's crest, a row per division, each club by its code (the crest image says the full name) */
  S2.nav.draw.crests = function (where) {
    if (!M) throw new Error("S2.M is missing");
    return '<div class="nav-crests">' + M.league.divisions.map(function (d, i) {
      var id = "navD-" + where + "-" + i, ts = M.teams.filter(function (t) { return t.division === d; }).sort(function (a, b) { return a.city < b.city ? -1 : a.city > b.city ? 1 : 0; });
      return '<p class="nav-sub-h" id="' + id + '">' + esc(d) + ' Division</p><ul class="nav-crest-row" aria-labelledby="' + id + '">' + ts.map(function (t) {
        return '<li><a class="nav-crest" href="' + esc(t.href) + '">' + M.crest(t.code) + '<span aria-hidden="true">' + esc(t.code) + "</span></a></li>"; }).join("") + "</ul>";
    }).join("") + "</div>";
  };
  /* the next three Season 2 dates from the season's own calendar */
  S2.nav.draw.dates = function () {
    if (!M) throw new Error("S2.M is missing");
    var s = M.control && M.control.season(2);   // shortcut: Season 2 is named here, read the registering season when Season 3 opens
    if (!s) throw new Error("the model has no Season 2 record");
    var now = M.now.getTime(), next = s.calendar.filter(function (c) { return Date.parse(c.at) > now; }).slice(0, 3);
    if (!next.length) return '<p class="nav-empty">Every Season 2 date has passed.</p>';
    return '<ul class="nav-dates">' + next.map(function (c) { return "<li><span>" + esc(c.label) + '</span><time datetime="' + esc(c.at) + '">' + esc(M.etMonthDay(c.at)) + "</time></li>"; }).join("") + "</ul>";
  };
  /* e0 split (2026-11-24): the draft room moved to js/pages/draft.js, which loads after this file and reads the
     league pieces it shares with these pages from S2._league (one definition each, never a copy) */
  S2._league = { DR_LIMIT: DR_LIMIT, DR_MIN: DR_MIN, M: M, about: about, arrow: arrow, cal: cal, cap: cap, cr: cr,
    esc: esc, fact: fact, fail: fail, hero: hero, inkBand: inkBand, intoRow: intoRow, list: list, md: md, ord: ord,
    paras: paras, plural: plural, rbText: rbText, rule: rule, searchBox: searchBox, secHead: secHead, swap: swap,
    teamName: teamName, utabs: utabs, word: word };
})();
