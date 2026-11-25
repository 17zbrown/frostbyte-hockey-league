/* The abbreviation popup: rest on an abbreviation anywhere on the site and its full name appears.
   The commissioner, 2026-11-04: "when you hover over an abbreviation of any kind on the site that a small popup with the full
   name will appear so people dont get confused. Build it in to have that same Apple build quality feel as the rest of the site
   with a clean and simple popup animation that fits in with the feel of the site."
   One delegated layer and no page markup: pages render by string concatenation and repaint in place, so anything tagged at
   render time would need every page edited and would go stale. Nothing here walks the page or changes its text. An event says
   what is under the pointer; that one element's own short text is read then, so an idle page, a big table and a repaint all
   cost nothing. It keeps no reference to page content between events.
   Test: abbr.test.cjs. */
(function () {
  "use strict";
  var OPEN_DELAY = 300,   /* the first one waits, so a pointer crossing a table flashes nothing (the header menus use about the same) */
    LEAVE_GRACE = 70,     /* the padding between two headings must not close and reopen it */
    WARM = 350,           /* just closed: the next one still opens at once */
    TAP_HOLD = 2600,      /* a phone has no "pointer left": a tapped popup goes by itself */
    LONG_PRESS = 450,
    GAP = 6, MARGIN = 8;

  /* ---------- the glossary: one list, the model first ----------
     M.STATS (every stat's short name), M.POS_NAME, M.teams and M.league are read at the first hover (build, below). EXTRA holds only
     what the model does not. To add a term, add one line here; a page that prints it needs no change. Exact case, always. */
  var EXTRA = {
    /* stats the model's M.STATS does not name, or names for a chart ("Shots") rather than spelling the letters out */
    SOG: "Shots on goal", "S%": "Shooting percentage", SH: "Shooting percentage", "FO%": "Faceoff percentage", "BRK%": "Breakaway save percentage", "+/−": "Plus/minus",
    TOI: "Time on ice", "TOI/GP": "Time on ice per game", TOA: "Time on attack", "TOA/GP": "Time on attack per game",
    pts: "Points", OTL: "Overtime losses", "W-L-OTL": "Wins, losses and overtime losses", REC: "Record", OVR: "Overall rating", FO: "Faceoffs",
    PS: "Penalty shots", GF: "Goals for", GA: "Goals against", SA: "Shots against", DIFF: "Goal differential", "P%": "Points percentage",
    "PP%": "Power-play percentage", "PK%": "Penalty-kill percentage", "GF/GP": "Goals for per game", "GA/GP": "Goals against per game",
    "+G": "Also has a line in goal", "+S": "Also has a line as a skater",
    /* positions and results: the model's POS_NAME has the six rink spots and D; a unit letter and a result have no model name */
    F: "Forward", W: "Win", L: "Loss", Pos: "Position", Opp: "Opponent", vs: "Versus",
    /* the league */
    GM: "General Manager", GMs: "General Managers", AGM: "Assistant General Manager", AGMs: "Assistant General Managers", HQ: "Headquarters",
    NA: "North America",   /* the server names (Rule 4.2: NA Northeast, NA Southeast, NA Central, NA West), on the Lobby and server picks since 2026-11-23 */
    NHL: "National Hockey League", EA: "EA Sports", "EA ID": "EA Sports account name", EASHL: "EA Sports Hockey League", ID: "Identifier",
    OT: "Overtime", ET: "Eastern Time", "6v6": "Six on six", Wk: "Week", VM: "Virtual machine", DM: "Direct message", PSN: "PlayStation Network", PS5: "PlayStation 5", XSX: "Xbox Series X",
    /* v5.00 swap (e6, one book): the published rulebook and its version history, now on the rulebook page word for word. The
       EA builds Rule 4.5 bans by position, in the book's own names, then the rest the book and its release notes print */
    ENF: "Enforcer (an EA build)", DD: "Defensive Defenseman (an EA build)", OD: "Offensive Defenseman (an EA build)", ENFD: "Enforcer Defenseman (an EA build)",
    EFD: "Enforcer Defenseman (an EA build, as some menus tag it)", TWD: "Two-Way Defenseman (an EA build)", PMD: "Puck-Moving Defenseman (an EA build)",
    GRN: "Grinder (an EA build)", PLY: "Playmaker (an EA build)", SNP: "Sniper (an EA build)", PWF: "Power Forward (an EA build)", TWF: "Two-Way Forward (an EA build)", DNG: "Dangler (an EA build)",
    FFL: "Forfeit loss", GIF: "Animated image", API: "Application programming interface", AI: "Artificial intelligence", PC: "Personal computer", DNA: "A player's 0 to 100 style profile",
    /* NHL franchises the sign-up counts print that are not CGHL clubs yet (M.teams holds the eight that are) */
    COL: "Colorado Avalanche", VGK: "Vegas Golden Knights", SJS: "San Jose Sharks"
  };
  /* the same letter under a stat heading: G is Goals there and Goaltender in a position cell. M.STATS supplies G, A and W */
  var HEAD_EXTRA = { P: "Points", L: "Losses" };
  /* a count in front of the letter: "5 F, 3 D, 1 G", "6 W". "0 G · 2 A" is a scoring line, so G turns to Goals when an A sits beside it */
  var COUNTED = { F: "Forwards", D: "Defense", G: "Goaltenders", W: "Wins", L: "Losses", P: "Points" };
  var PATTERNS = [
    [/^S(\d+)$/, function (m) { return "Season " + m[1]; }],
    [/^R(\d+)$/, function (m) { return "Round " + m[1]; }],
    [/^W(\d+)$/, function (m) { return "Week " + m[1]; }],
    [/^T-(\d+)$/, function (m) { return m[1] + " minutes before puck drop"; }],
    [/^T-(\d+(?:st|nd|rd|th))$/, function (m) { return "Tied for " + m[1]; }],
    [/^T(\d+)$/, function (m) { return "Tied for " + S2.ord(+m[1]); }],   /* a tied rank in a leaders list ("T2"), audit 2026-11-09 */
    [/^T\+(\d+)$/, function (m) { return m[1] + " minutes after puck drop"; }],
    [/^(\d+)([GAP])$/, function (m) { return m[1] + " " + { G: "goal", A: "assist", P: "point" }[m[2]] + (m[1] === "1" ? "" : "s"); }],
    [/^(\d+)F$/, function (m) { return m[1] + (m[1] === "1" ? " forward" : " forwards"); }],
    [/^(\d+)D$/, function (m) { return m[1] + " defense"; }],
    /* v5.00 swap (e6, one book): the rulebook page now carries Appendix A, whose sections are numbered A.x.y after the rule
       they shelve (A.2.1 holds Rule 2.1's other-format text, CG.rulebookForFormat's `of`) */
    [/^A\.(\d+\.\d+)$/, function (m) { return "Rule " + m[1] + " in Appendix A: the other format's text, not in force"; }]
  ];
  /* where a lone letter is plainly a label. Anywhere else (the A to Z directory, "Official C", a sentence) it is just a letter */
  var LABELS = "th, td, abbr, .seg, .pfx-res, .hqx-mark5, .hqx-slot-pos, .tp-slot-p, .dk-pc";
  /* uppercase short names that are also English words: only as a whole label or after a count, never loose in a sentence */
  var WORDS = { SO: 1, HIT: 1, PS: 1, DIFF: 1 };
  /* never: what the reader types, a person's initials, a keyboard hint */
  var SKIP = "input, textarea, select, [contenteditable], .avatar, .dc-av, .dk-kbd";
  /* an element's own title is honored on anything shaped like an abbreviation, so a new one needs no glossary line. A title on
     other text (a truncated gamertag, "Rating 70 at Defense") stays the browser's: this popup names abbreviations and never a person */
  var LOOKS = /^(?=.*[A-Z])[A-Z0-9+\-−/%]{1,8}$/;
  /* a word in a sentence ends at a space or punctuation; a slash or a hyphen is tried whole first (P/GP), then split (Final/OT) */
  var RUN = /[^\s·,;:()\[\]"“”!?]+/g;

  var T, HEAD, TAGS;
  function build() {
    if (T) return;
    var M = S2.M, put = function (to, from) { Object.keys(from).forEach(function (k) { to[k] = from[k]; }); };
    T = Object.create(null); HEAD = Object.create(null); TAGS = Object.create(null);   /* no prototype: "constructor" in a sentence is not a term */
    Object.keys(M.STATS).forEach(function (k) { var s = M.STATS[k]; if (s.short) (s.short.length === 1 ? HEAD : T)[s.short] = s.label; });
    put(T, M.POS_NAME);
    M.teams.forEach(function (t) { T[t.code] = t.full; });
    T[M.league.code] = M.league.name;
    put(T, EXTRA); put(HEAD, HEAD_EXTRA);
    M.players.forEach(function (p) { TAGS[p.tag] = 1; });   /* a gamertag is a name even if it spells a term; abbr.test.cjs pins that none do today */
  }
  function pattern(w) {
    for (var i = 0, m; i < PATTERNS.length; i++) if ((m = PATTERNS[i][0].exec(w))) return PATTERNS[i][1](m);
    return null;
  }

  /* ---------- what is under the pointer ---------- */
  /* an element's text if it is short, else null. Bounded, so a hover on a big container stops after a few nodes */
  function shortText(el) {
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n, s = "", i = 0;
    while ((n = w.nextNode())) {
      if (n.parentElement.closest(".sr")) continue;
      s += n.nodeValue;
      if (s.length > 40 || ++i > 8) return null;
    }
    return s.replace(/[↑↓]/g, "").replace(/\s+/g, " ").trim();   /* a text sort arrow belongs to its heading */
  }
  /* the title, read through a loan (below), so hovering a heading again does not lose it */
  var loans = [];
  function titleOf(e) {
    var v = e.getAttribute("title"), i;
    if (v) return v;
    for (i = 0; i < loans.length; i++) if (loans[i][0] === e) return loans[i][1];
    return null;
  }
  function box(range, el) {
    var r = range.getBoundingClientRect();
    if (!r.width && el && el.isConnected) r = el.getBoundingClientRect();   /* an SVG label can measure empty */
    return r.width ? r : null;   /* a repaint took it away */
  }
  function make(text, el, low, range) {
    var r = box(range, el);
    return r && { text: text, el: el, low: low, range: range, key: text + "|" + Math.round(r.left) + "," + Math.round(r.top) };
  }
  /* a label: the element's whole text is the abbreviation (a heading, a position cell, a club code, a sort button) */
  function full(el, txt) {
    if (HEAD[txt] && el.closest("thead")) return HEAD[txt];
    if ((txt.length === 1 || WORDS[txt]) && !el.closest(LABELS)) return null;
    return T[txt] || pattern(txt);
  }
  function label(t) {
    var own = shortText(t), svg = t.closest("svg"), el = svg && !own ? svg.parentElement : own === "" && /[↑↓]/.test(t.textContent) ? t.parentElement : t;   /* the sort arrow inside a heading's button, drawn or typed */
    var txt = el && shortText(el), i, e, d;
    if (!txt || TAGS[txt]) return null;
    /* a th around its sort button is one label, whichever of the two the pointer is on */
    var top = el, mine = titleOf(el);
    for (i = 0, e = el.parentElement; e && i < 2 && shortText(e) === txt; i++, e = e.parentElement) { top = e; mine = mine || titleOf(e); }
    if (!mine && (d = top.querySelector("[title]")) && shortText(d) === txt) mine = titleOf(d);
    if (mine && mine.toLowerCase() === txt.toLowerCase()) mine = null;
    var known = full(el, txt);
    if (!known && !(mine && (el.closest("abbr") || LOOKS.test(txt)))) return null;
    var r = document.createRange(); r.selectNodeContents(top);
    return make(mine || known, top, el, r);
  }
  /* a word in a sentence: exact case, a whole word, and the pointer really on it */
  function counted(w, s, a) {
    if (!/(^|[\s·(,])\d+\s$/.test(s.slice(Math.max(0, a - 7), a))) return null;
    var line = /\d A\b/.test(s) && /\d G\b/.test(s);   /* "0 G · 2 A" */
    if (line && w === "G") return HEAD.G;
    if (line && w === "A") return HEAD.A;
    return COUNTED[w] || (WORDS[w] ? T[w] : null);
  }
  function prose(w, s, a, b) {
    if (/^[WL]$/.test(w) && /^ \d+-\d+/.test(s.slice(b))) return T[w];   /* "W 5-1" in a game log */
    if (/^(min|Max|max)$/.test(w) && /^ \d/.test(s.slice(b))) return w === "min" ? "Minimum" : "Maximum";   /* "min 5", and never "5 min" */
    /* "5F, 3D, 1G" is a roster minimum, so that G is a goaltender; alone, "16G" is goals */
    if (/^\d+G$/.test(w) && /\d[FD]\b/.test(s)) return parseInt(w, 10) + (w === "1G" ? " goaltender" : " goaltenders");
    if (w.length > 1 && !WORDS[w]) return T[w] || pattern(w);
    var n = counted(w, s, a);
    if (n) return n;
    if (w.length > 1 || s.indexOf("·") < 0) return null;
    /* "C · 3 to six · SEA": a letter alone between the dots */
    var l = s.lastIndexOf("·", a - 1), rr = s.indexOf("·", b);
    return s.slice(l + 1, rr < 0 ? s.length : rr).trim() === w ? T[w] || null : null;
  }
  function word(t, x, y) {
    var n, s, m, i, j, w, a, b, cand, parts, at, r, rects, mean;
    for (n = t.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 3 || TAGS[(s = n.nodeValue).trim()]) continue;
      RUN.lastIndex = 0;
      while ((m = RUN.exec(s))) {
        w = m[0].replace(/(?:['’]s)?\.*$/, ""); a = m.index; b = a + w.length;   /* "CGHL's", "GP." */
        cand = [];
        if ((mean = prose(w, s, a, b))) cand.push([a, b, mean]);
        else if (/[-–—/]/.test(w)) {
          parts = w.split(/[-–—/]/);
          for (i = 0, at = a; i < parts.length; at += parts[i].length + 1, i++) if ((mean = parts[i] && prose(parts[i], s, at, at + parts[i].length))) cand.push([at, at + parts[i].length, mean]);
        }
        for (i = 0; i < cand.length; i++) {
          r = document.createRange(); r.setStart(n, cand[i][0]); r.setEnd(n, cand[i][1]);
          rects = r.getClientRects();
          for (j = 0; j < rects.length; j++) if (x >= rects[j].left - 1 && x <= rects[j].right + 1 && y >= rects[j].top - 1 && y <= rects[j].bottom + 1) return make(cand[i][2], null, t, r);
        }
      }
    }
    return null;
  }
  function resolve(t, x, y) {
    build();
    if (!t || !t.closest || t.closest(SKIP) || t.id === "abbrTip") return null;
    if (x != null && t.matches("a:empty")) t = document.elementsFromPoint(x, y)[1] || t;   /* a tile's link overlay: what is printed sits beneath it */
    return label(t) || (x != null ? word(t, x, y) : null);
  }

  /* ---------- native titles: borrowed, never deleted ----------
     While the pointer is on an abbreviation the browser's own tooltip must not rise on top of the popup, and it fires from the
     nearest title up the tree, so that chain lends its titles for the visit and gets them back on leaving. A title lives in the page
     as rendered for anyone who never hovers, so a screen reader or a keyboard keeps it (focus raises no native tooltip, so focus
     borrows nothing), and while lent the popup itself is the element's description (aria-describedby). */
  var lentFor = null;
  function giveBack() {
    loans.forEach(function (l) { if (!l[0].hasAttribute("title")) l[0].setAttribute("title", l[1]); });
    loans = []; lentFor = null;
  }
  function borrow(res) {
    if (res.low === lentFor) return;
    giveBack(); lentFor = res.low;
    for (var e = res.low; e; e = e.parentElement) {
      var v = e.getAttribute("title");
      if (v) { loans.push([e, v]); e.removeAttribute("title"); }
    }
  }

  /* ---------- the popup ---------- */
  var tip = null, shownKey = null, pendKey = null, dismissKey = null, openTimer = 0, leaveTimer = 0, holdTimer = 0, warmUntil = 0, described = null, focusEl = null;
  function node() {
    if (tip) return tip;
    tip = document.createElement("div"); tip.id = "abbrTip"; tip.className = "abbr-tip"; tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);   /* outside #app: a repaint or a route never takes it, and no band or transform is above it */
    tip.offsetWidth;                  /* the closed state must be computed once, or the first entrance has nothing to move from */
    return tip;
  }
  function show(res, instant) {
    var r = box(res.range, res.el);
    if (!r) return;
    var el = node();
    el.textContent = res.text;
    el.toggleAttribute("data-instant", !!instant);
    var w = el.offsetWidth + 1, h = el.offsetHeight + 1, vw = document.documentElement.clientWidth, vh = window.innerHeight;   /* offset sizes round down: never 7.6px from the edge */
    var above = r.top - GAP - h >= MARGIN || r.top > vh - r.bottom;   /* above, unless there is no room there and more below */
    var top = Math.max(MARGIN, Math.min(vh - h - MARGIN, above ? r.top - GAP - h : r.bottom + GAP));
    var cs = getComputedStyle(el), sl = Math.max(MARGIN, parseFloat(cs.scrollMarginLeft) || 0), sr = Math.max(MARGIN, parseFloat(cs.scrollMarginRight) || 0);   /* the notch (css/abbr.css) */
    var cx = (r.left + r.right) / 2, left = Math.max(sl, Math.min(vw - w - sr, cx - w / 2));
    el.style.left = Math.round(left) + "px"; el.style.top = Math.round(top) + "px";
    el.style.transformOrigin = Math.round(Math.max(0, Math.min(w, cx - left))) + "px " + (above ? "100%" : "0%");   /* it grows from the abbreviation */
    if (described) { described.removeAttribute("aria-describedby"); described = null; }
    if (res.el && !res.low.hasAttribute("title") && !res.low.hasAttribute("aria-describedby")) { described = res.low; described.setAttribute("aria-describedby", "abbrTip"); }
    el.setAttribute("data-open", "");
    shownKey = res.key;
  }
  function clearTimers() { clearTimeout(openTimer); clearTimeout(leaveTimer); clearTimeout(holdTimer); openTimer = leaveTimer = holdTimer = 0; pendKey = null; }
  function close() {
    clearTimers();
    if (!shownKey) return;
    shownKey = null; warmUntil = Date.now() + WARM;
    tip.removeAttribute("data-instant"); tip.removeAttribute("data-open");   /* the exit always plays: a CSS transition, so a new show retargets it */
    if (described) { described.removeAttribute("aria-describedby"); described = null; }
  }

  /* the pointer left: the popup goes, unless a keyboard holds a label, which gets it back */
  function inView(res) { var r = box(res.range, res.el); return r && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < document.documentElement.clientWidth; }
  function settle() { var f = focusEl && resolve(focusEl); if (f && inView(f)) { clearTimers(); show(f, true); } else close(); }
  /* the one decision: what the pointer rests on now */
  function hover(res) {
    var key = res ? res.key : null;
    if (key !== dismissKey) dismissKey = null;
    if (key && key === dismissKey) return;   /* Escaped: stays closed until the pointer goes elsewhere */
    if (key && key === shownKey) { clearTimeout(leaveTimer); leaveTimer = 0; borrow(res); return; }   /* a repaint gave the same heading a new element */
    if (key && key === pendKey) { borrow(res); return; }   /* the same label through its button: that title rises on its own timer too */
    clearTimeout(openTimer); openTimer = 0; pendKey = null;
    if (!key) {
      giveBack();
      if (shownKey && !leaveTimer) leaveTimer = setTimeout(settle, LEAVE_GRACE);
      return;
    }
    borrow(res);   /* at once: the browser's own timer started when the pointer arrived */
    clearTimeout(leaveTimer); leaveTimer = 0;
    if (shownKey || Date.now() < warmUntil) { show(res, true); return; }   /* a neighbor: no wait, no animation */
    pendKey = key;
    openTimer = setTimeout(function () {
      pendKey = null; openTimer = 0; lastT = null;
      var now = atPointer(document.elementFromPoint(mx, my));   /* a repaint during the wait leaves res stale */
      if (now) { borrow(now); show(now, false); }
    }, OPEN_DELAY);
  }

  /* ---------- a mouse ---------- */
  var raf = 0, mt = null, mx = 0, my = 0, lastT = null, steady = false;
  function atPointer(t) { return !t || t.closest(".td-pin") ? null : resolve(t, mx, my); }   /* a map pin's own card names its club: two popups would cover each other */
  function frame() {
    raf = 0;
    if (!mt) return;
    if (mt === lastT && steady) return;   /* still inside the same label: nothing to read */
    var res = atPointer(mt);
    lastT = mt; steady = !!(res && res.el) && !mt.matches("a:empty");
    hover(res);
  }
  function pointer(e) {
    if (e.pointerType !== "mouse") return;
    if (e.buttons) { mt = lastT = null; close(); return; }   /* a drag, a scrub or a selection owns the pointer */
    mt = e.target; mx = e.clientX; my = e.clientY;
    if (!raf) raf = requestAnimationFrame(frame);
  }
  var LISTEN = { capture: true, passive: true };
  document.addEventListener("pointermove", pointer, LISTEN);
  document.addEventListener("pointerover", pointer, LISTEN);   /* a scroll or a repaint under a still pointer sends only this */
  document.documentElement.addEventListener("mouseleave", function () { mt = lastT = null; hover(null); });

  /* ---------- a keyboard: at once and with no motion (never animate what a key does), and Escape leaves focus where it is ---------- */
  document.addEventListener("focusin", function (e) {
    var t = e.target; focusEl = null;
    if (!t.matches || !t.matches(":focus-visible")) return;   /* a mouse click focuses a button too; that is not a request */
    var res = resolve(t);
    if (!res) { if (shownKey) close(); return; }
    focusEl = t; clearTimers(); show(res, true);
  });
  document.addEventListener("focusout", function () { if (focusEl) { focusEl = null; close(); } });
  window.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || e.isComposing) return;
    if (shownKey) {
      dismissKey = shownKey; focusEl = null; close();
      e.stopImmediatePropagation();   /* this Escape was for the popup: a sheet under it stays, and focus with it. window, capture: ahead of the one ordered Escape in core.js */
    } else if (pendKey) { dismissKey = pendKey; clearTimers(); }
  }, true);

  /* ---------- a finger: no hover, so a tap answers and the tap still does its job. Nothing here calls preventDefault on a tap ----------
     click, capture: ahead of a sort button's repaint, while the tapped element is still in the page. A link goes where it goes, and a
     long press reads a link without following it. */
  var lastType = "mouse", press = 0, pressed = false, px = 0, py = 0, tappedAt = 0;
  function byTouch(res) {
    clearTimers(); tappedAt = Date.now();
    show(res, Date.now() < warmUntil || !!shownKey);
    holdTimer = setTimeout(close, TAP_HOLD);
  }
  document.addEventListener("pointerdown", function (e) {
    lastType = e.pointerType;
    if (e.pointerType === "mouse") return;
    pressed = false;   /* every real tap starts here, so the release guard below can never eat one */
    px = e.clientX; py = e.clientY;
    var t = e.target;
    clearTimeout(press);
    press = setTimeout(function () {
      press = 0;
      var res = t.isConnected ? resolve(t, px, py) : null;
      if (res) { pressed = true; byTouch(res); }
    }, LONG_PRESS);
  }, LISTEN);
  document.addEventListener("pointermove", function (e) {
    if (press && e.pointerType !== "mouse" && (Math.abs(e.clientX - px) > 10 || Math.abs(e.clientY - py) > 10)) { clearTimeout(press); press = 0; }
  }, LISTEN);
  ["pointerup", "pointercancel"].forEach(function (n) { document.addEventListener(n, function () { clearTimeout(press); press = 0; }, LISTEN); });
  document.addEventListener("click", function (e) {
    if (lastType === "mouse" || !e.detail) return;
    if (pressed) { pressed = false; e.preventDefault(); e.stopPropagation(); return; }   /* the release of a long press is not a tap */
    var t = e.target, res = t.closest && t.closest("a[href]") ? null : resolve(t, e.clientX, e.clientY);
    if (res) byTouch(res); else close();
  }, true);
  document.addEventListener("contextmenu", function (e) { if (pressed) e.preventDefault(); }, true);

  /* ---------- whatever moves the page closes it ---------- */
  var refocus = 0;
  window.addEventListener("scroll", function () {
    if ((!shownKey && !pendKey && !focusEl) || Date.now() - tappedAt < 80) return;   /* a tap's own repaint restores the table's sideways scroll */
    close(); warmUntil = 0; lastT = null;
    /* except Tab, whose own scroll brings the next heading into view: that popup comes back when the table settles */
    if (focusEl) { clearTimeout(refocus); refocus = setTimeout(function () { var res = focusEl && resolve(focusEl); if (res && inView(res)) show(res, true); }, 140); }
  }, LISTEN);
  window.addEventListener("resize", close);
  window.addEventListener("hashchange", function () { focusEl = mt = lastT = null; close(); giveBack(); });

  /* one word out, for the test and for anyone asking what a term means */
  S2.abbr = { term: function (w) { build(); return T[w] || HEAD[w] || pattern(w); } };
})();
