/* CGHL Season 2: core. One global (S2), no framework, no build. Pages register with S2.page(name, {title,
   render, after}). Motion follows Apple's fluid-interface rules: springs start from the on-screen value, carry the
   finger's velocity, project a flick to where it is going, and rubber-band at edges.
   v5.00 swap (i3f, 2026-11-25): demo mode is gone. The role is who is signed in (S2.session), never a choice on the page:
   the dock, its View as and its rule override, the concept's automatic-update carry and the sample clock went with
   js/demo.js, js/share.js and the concept's About page. */
(function () {
  "use strict";
  var S2 = window.S2 = window.S2 || {};
  S2.pages = {};
  S2.reduce = matchMedia("(prefers-reduced-motion: reduce)");

  /* v5.00 swap contract (frozen 2026-11-23; owner f from wave 2). Pages call only these. */
  S2.session = S2.session || { user: null, profileId: null, accessToken: null, isStaff: false, isCommissioner: false, teamId: null, seat: null };
  S2.write = function (rpc, args, opts) { /* opts: {approval: "owner"|null, repaint: fn}; resolves {data} or rejects Error{code, hint, message} */
    if (!S2._writeImpl) return Promise.reject(new Error("S2.write is not wired (no client and no test mock)"));
    return S2._writeImpl(rpc, args || {}, opts || {});
  };
  S2.live = S2.live || (function () { var h = {}; return {
    on: function (d, fn) { (h[d] = h[d] || []).push(fn); },
    off: function (d, fn) { h[d] = (h[d] || []).filter(function (x) { return x !== fn; }); },
    emit: function (d, p) { (h[d] || []).forEach(function (fn) { fn(p); }); } }; })();
  /* v5.00 swap (f, 2026-11-24): live mode is the real league site: the league data is live (js/load.js read s2_league,
     S2.load.source "live") and the sign-in library is on the page, which the site build puts there. window.S2_MODE = "live"
     forces it (tools/ui/live.test.cjs runs the live client over the fixture data that way). Fixture data, or live data with
     no sign-in library (a read-only rehearsal), is not live: no sign-in, no writes, no pulse. ONE flag for every file */
  S2.LIVE = window.S2_MODE === "live" || !!(S2.load && S2.load.source === "live" && window.supabase && window.supabase.createClient);
  /* the role always follows S2.session (i3f: the switch that let the demo pick its own is gone). j1's page mock
     injects a persona's S2.session before this file runs, so a page suite sees that persona's pages */

  /* ---------- tiny DOM helpers ---------- */
  S2.$ = function (sel, root) { return (root || document).querySelector(sel); };
  S2.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  S2.esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  S2.fmt = function (n, d) { if (n == null || isNaN(n)) return "–"; return Number(n).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  S2.pct = function (n, d) { return n == null || isNaN(n) ? "–" : (n * 100).toFixed(d == null ? 1 : d) + "%"; };
  /* one ordinal and one plural for every page (review 2026-10-19: four pages each kept a copy, and pctBar printed "1th") */
  S2.ord = function (n) { n = Math.round(n); var t = Math.abs(n) % 100, u = Math.abs(n) % 10; return S2.fmt(n) + (t >= 11 && t <= 13 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"); };
  S2.plural = function (n, one, many) { return S2.fmt(n) + " " + (n === 1 ? one : many || one + "s"); };
  /* the ONE test for a database id (a uuid) in an address or a notification's parameter, so a page can refuse a mistyped
     id before it asks PostgREST, which answers 22P02 and logs a 400 (health crawl 9, 2026-11-25: core.js, today.js and
     trade.js each kept a copy of the pattern, and pickups.js read with none) */
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  S2.isUuid = function (x) { return UUID.test(String(x == null ? "" : x)); };
  /* a count in words, as prose spells a small number: "eight"; zero is "no" unless the caller names its own word ("none",
     "zero"), and from 13 up the numeral (QA round 2, 2026-11-25: the footer said "Eight clubs" by hand, and seven pages
     each kept their own list of these words) */
  var NUM_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  S2.words = function (n, zero) { return n === 0 && zero != null ? zero : NUM_WORDS[n] || S2.fmt(n); };
  /* a member's initials for an avatar: the first two letters or digits of the name (QA worst-case 2026-11-25: moved here
     from js/pages/desk.js, whose copy js/pages/control.js repeated, so the header avatar shows the member, not a role) */
  S2.initials = function (t) { var c = String(t || "").replace(/[^\p{L}\p{N}]/gu, ""); return (c.slice(0, 2) || "?").toUpperCase(); };
  /* an address on another season (?season=<n>), or on the current season when n is null, keeping the rest of the query
     (QA functional 2026-11-25: the Season menu's Season 1 kept Season 2's page; "#/season" alone keeps whatever season
     the address already names) */
  S2.seasonHref = function (n, hash) {
    var q = new URLSearchParams(location.search); if (n == null) q.delete("season"); else q.set("season", n);
    /* no query left: the bare hash while the address has none, else the path, which drops the old query */
    var s = q.toString(); return (s ? "?" + s : location.search ? location.pathname : "") + hash;
  };
  /* a stored color as "#rrggbb", or null when it is none or unreadable: a bare hex gets its #, and a short one ("#c00")
     is spelled out, so the club keeps its own color (QA round 2 nit: "#fff" fell back to the ink band) */
  function hex6(x) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(x || ""); if (!m) return null;
    var h = m[1]; return "#" + (h.length === 3 ? h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2) : h);
  }
  /* text on a club color: black or white, whichever has the higher WCAG contrast (BOS gold takes black, DET red white).
     shortcut: league.js and today.js still keep their own copies of this (hq.js folded its into this one), and four
     places still write the band's fallback by hand (league.js's club tiles, today.js's, tradebuild.js's trade header and
     hq.js's Team HQ band object); QA round 2 Phase B moves every one onto S2.clubBand */
  S2.inkOn = function (hex) {
    var h = hex6(hex); if (!h) return "#fff";
    var n = parseInt(h.slice(1), 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    var L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#000" : "#fff";
  };
  /* a club's band, as a style attribute's declarations ("--club:#00205b;--club-ink:#fff", escaped), which .band.club and
     every club tile read: the club's own color with the ink S2.inkOn picks for it, or the ink band with its light text for
     a club with no color, or a color the contrast test cannot read (QA round 2, 2026-11-25: league.js, today.js,
     tradebuild.js and hq.js each wrote the fallback by hand, and a color the test could not read, like a short "#fff",
     would have kept white text on white; a short hex is now spelled out and keeps the club's color) */
  S2.clubBand = function (t) {
    var c = hex6(t && t.color);
    return "--club:" + (c || "var(--ink-band)") + ";--club-ink:" + S2.inkOn(c);
  };
  S2.store = { get: function (k, d) { try { var v = localStorage.getItem("s2." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
               set: function (k, v) { try { localStorage.setItem("s2." + k, JSON.stringify(v)); } catch (e) { /* private window: the choice simply is not remembered */ } } };

  /* ---------- icons: SF-Symbols-like strokes, 24 grid, currentColor ---------- */
  var P = {
    today: '<path d="M4 9h16M8 3v3M16 3v3"/><rect x="4" y="5" width="16" height="15" rx="3"/><circle cx="12" cy="14" r="2.2" fill="currentColor" stroke="none"/>',
    scores: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M12 5v14M3 12h18"/>',
    games: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M10.5 13.2l4 2.3-4 2.3z" fill="currentColor" stroke="none"/>',
    standings: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="1.6" fill="currentColor" stroke="none"/>',
    stats: '<path d="M5 20V11M10 20V5M15 20v-7M20 20V8"/>',
    clubs: '<path d="M12 3l7 3v6c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z"/>',
    you: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    bell: '<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 00-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 005.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    gavel: '<path d="M14 4l6 6M11 7l6 6M12.5 5.5l-6 6 3 3 6-6M8 15l-5 5"/>',
    chart: '<path d="M4 19h16"/><path d="M5 15l4-4 3 3 7-7"/>',
    people: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.9-3 3-4.6 5.5-4.6s4.6 1.6 5.5 4.6"/><circle cx="17" cy="8" r="2.4"/><path d="M16 13.2c2.4 0 4 1.4 4.6 3.8"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8 3v4M16 3v4"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chev: '<path d="M9 5l7 7-7 7"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
    swatch: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17" opacity=".0"/><path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor" stroke="none" opacity=".35"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
    map: '<path d="M9 4L3 6.5v13.5L9 17.5l6 2.5 6-2.5V4L15 6.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H4.5a3 3 0 003.6 3M16 6h3.5a3 3 0 01-3.6 3M12 13v4M8.5 20h7"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    shield: '<path d="M12 3l7 3v6c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
    /* S2.empty draws "lock" and "alert" (review 2026-11-23: they lived only in desk.js, so every lock state box drew an empty disc) */
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
    alert: '<path d="M12 4.2l8.6 15H3.4z"/><path d="M12 10v4"/><circle cx="12" cy="16.9" r=".7" fill="currentColor" stroke="none"/>'
  };
  S2.ic = function (name, cls) {
    return '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || "") + "</svg>";
  };
  S2.chev = function () { return '<svg class="chev" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5"/></svg>'; };
  /* the league's C/G power-mark (light C, accent crossbar) drawn inline so it follows the finish */
  /* v4.67: /favicon.svg is this mark in its light colors (ink tile, white C, Glacier crossbar) and the three app
     icons are it on a full-bleed tile; change the paths or colors here and redraw them too (tools/favicon-glacier-v467.test.cjs) */
  S2.mark = function (size) {
    return '<svg viewBox="0 0 32 32" width="' + (size || 26) + '" height="' + (size || 26) + '" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--ink)"/>' +
      '<path d="M22.5 10.2A8.4 8.4 0 1016 24.4a8.4 8.4 0 006.5-3.1" fill="none" stroke="var(--canvas)" stroke-width="3.2" stroke-linecap="round"/>' +
      '<path d="M15.5 16.2h8" stroke="var(--accent-2)" stroke-width="3.2" stroke-linecap="round"/></svg>';
  };

  /* ---------- springs: Apple's damping ratio + response, integrated per frame, retargetable mid-flight ---------- */
  S2.spring = function (opts) {
    var s = { x: opts.from || 0, v: opts.velocity || 0, target: opts.to || 0, damping: opts.damping == null ? 1 : opts.damping,
              response: opts.response || 0.35, onUpdate: opts.onUpdate, onRest: opts.onRest, raf: 0, last: 0 };
    function step(t) {
      if (!s.last) s.last = t;
      var dt = Math.min(0.032, (t - s.last) / 1000); s.last = t;
      var k = Math.pow(2 * Math.PI / s.response, 2), c = 4 * Math.PI * s.damping / s.response;   /* stiffness, damping coefficient */
      var sub = 4, h = dt / sub;
      for (var i = 0; i < sub; i++) { var a = -k * (s.x - s.target) - c * s.v; s.v += a * h; s.x += s.v * h; }
      s.onUpdate && s.onUpdate(s.x, s.v);
      /* rest at pixel scale (QA motion 2026-11-25): at 0.02 px/s and 0.05 px a spring kept a frame loop and a style write
         going for about half a second after the motion was visibly over, and every onRest (the phone sheet's removal)
         came that late. Every S2.spring animates pixels; the snap below hides the last half pixel */
      if (Math.abs(s.v) < 2 && Math.abs(s.x - s.target) < 0.5) {
        s.x = s.target; s.v = 0; s.onUpdate && s.onUpdate(s.x, 0); s.raf = 0; s.last = 0; s.onRest && s.onRest(); return;
      }
      s.raf = requestAnimationFrame(step);
    }
    s.to = function (target, velocity) {   /* retarget from the CURRENT value and velocity: no jump, no brick wall */
      s.target = target; if (velocity != null) s.v = velocity;
      if (S2.reduce.matches) { s.x = target; s.v = 0; s.onUpdate && s.onUpdate(s.x, 0); s.onRest && s.onRest(); return s; }
      if (!s.raf) { s.last = 0; s.raf = requestAnimationFrame(step); }
      return s;
    };
    s.set = function (x) { s.x = x; s.v = 0; if (s.raf) cancelAnimationFrame(s.raf); s.raf = 0; s.onUpdate && s.onUpdate(x, 0); return s; };
    s.stop = function () { if (s.raf) cancelAnimationFrame(s.raf); s.raf = 0; return s; };
    return s;
  };
  /* Apple's momentum projection (Designing Fluid Interfaces): where a flick would come to rest */
  S2.project = function (v, d) { d = d || 0.998; return (v / 1000) * d / (1 - d); };
  S2.rubber = function (over, dim, c) { c = c || 0.55; return (over * dim * c) / (dim + c * Math.abs(over)); };

  /* ---------- segmented control: one thumb element springs between options ---------- */
  S2.segmented = function (el, onChange) {
    var btns = S2.$$("button", el), thumb = document.createElement("span");
    thumb.className = "thumb"; el.insertBefore(thumb, el.firstChild);
    /* the pill (.seg) keeps its width (its columns are 1fr) and its 8px corners and shadow, which a scale would distort.
       An underline (.lg-utabs, .pfx-tabs) spans labels of different widths, so its width rides a second spring on the
       same timeline as a scaleX of a 100px bar (QA motion 2026-11-25: the width used to land at once while the bar still
       sat under the old label, so it overhung the next one for a frame and then slid). A 2 to 3px bar with square ends
       does not distort, and no frame lays out */
    var line = !el.classList.contains("seg");
    function paint() { thumb.style.transform = "translateX(" + sx.x + "px)" + (line ? " scaleX(" + sw.x / 100 + ")" : ""); }
    var sx = S2.spring({ response: 0.32, onUpdate: paint }), sw = S2.spring({ response: 0.32, onUpdate: paint });
    if (line) { thumb.style.width = "100px"; thumb.style.transformOrigin = "0 0"; thumb.style.transform = "scaleX(0)"; }
    function place(b, animate) {
      if (!line) thumb.style.width = b.offsetWidth + "px";
      if (animate) { sx.to(b.offsetLeft); if (line) sw.to(b.offsetWidth); }
      else { sx.set(b.offsetLeft); if (line) sw.set(b.offsetWidth); }
    }
    var cur = btns.filter(function (b) { return b.getAttribute("aria-pressed") === "true"; })[0] || btns[0];
    /* one observer per control instead of a window listener that outlived it: it places the thumb on first layout, after
       late font loads and on every resize, and lets go once the control leaves the page */
    var ro = new ResizeObserver(function () { if (!el.isConnected) { ro.disconnect(); return; } place(cur, false); });
    ro.observe(el);
    btns.forEach(function (b) {
      b.addEventListener("pointerdown", function () { b.style.opacity = ".7"; });
      ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { b.addEventListener(ev, function () { b.style.opacity = ""; }); });
      b.addEventListener("click", function () {
        if (b === cur) return;
        btns.forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        cur = b; place(b, true); onChange && onChange(b.dataset.v, b);
      });
    });
    return { set: function (v) { var b = btns.filter(function (x) { return x.dataset.v === v; })[0]; if (b) b.click(); } };
  };

  /* ---------- overlay stack: sheets and the palette are modal. While any is open the page behind is inert (no Tab, no
     clicks, no scroll), every layer but the top one is inert too, and Escape closes only the top layer (review
     2026-10-19: Tab walked out of a sheet, the page scrolled under the scrim, one Escape closed the palette AND the sheet) */
  var layers = [];
  /* the open header menu (header v2). Module level, so a shell re-render resets it and adds no listener */
  var NAV = { id: null, by: null, pinned: false, press: false, y: 0, t: 0, hide: 0 };
  function syncLayers() {
    var app = document.getElementById("app"), on = layers.length > 0;
    if (app) app.inert = on;
    document.documentElement.classList.toggle("locked", on);
    layers.forEach(function (l, i) { l.el.inert = i < layers.length - 1; });
    if (on && NAV.id) S2.nav.close(true);   /* a sheet or the palette takes over: the header menu steps aside at once */
  }
  S2.layer = {
    /* each layer notes the page it was opened on (read at push, so a sheet opened right after S2.go belongs to the new
       page, whose hashchange has not fired yet) */
    push: function (l) { if (layers.indexOf(l) < 0) { l.at = S2.parse().name; layers.push(l); } syncLayers(); },
    pop: function (l) { var i = layers.indexOf(l); if (i >= 0) layers.splice(i, 1); syncLayers(); },
    top: function () { return layers[layers.length - 1] || null; }
  };

  /* ---------- sheet: bottom sheet on phones (drag, flick, rubber-band, velocity handoff), centered card on desktop ---------- */
  S2.sheet = function (opts) {
    var scrim = document.createElement("div"), el = document.createElement("section"), wide = matchMedia("(min-width: 900px)").matches;
    /* the desktop card and Reduce Motion (any width) open and close with a class transition (a cross-fade under Reduce
       Motion); the phone sheet is driven by the spring */
    var fade = wide || S2.reduce.matches;
    scrim.className = "scrim"; el.className = "sheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", opts.label || opts.title || "Details");
    el.innerHTML = '<div class="grabber" aria-hidden="true"></div><header class="sheet-h"><h2 class="t-title2" style="margin:0">' + S2.esc(opts.title || "") + '</h2>' +
      '<button class="icon-btn" data-close aria-label="Close">' + S2.ic("x") + '</button></header><div class="sheet-b">' + (opts.html || "") + "</div>";
    document.body.appendChild(scrim); document.body.appendChild(el);
    var prevFocus = document.activeElement, h = 0, closing = false, timer = 0, layer = { el: el, close: function () { close(); } };
    var sp = S2.spring({ response: 0.34, damping: 1, onUpdate: function (y) {
      el.style.transform = "translateY(" + y + "px)"; scrim.style.opacity = String(Math.max(0, 1 - y / Math.max(1, h)));
    } });
    /* the phone keyboard (QA phone 2026-11-25; moved here from js/survey.js, which held the only copy, after the
       2026-10-20 device review where it covered Next): dvh does not shrink for the iOS keyboard, so every other sheet with
       a field kept its action row under it. The sheet is lifted onto the keyboard and fits what is left of the screen. Not
       while zoomed in, where the smaller visual viewport is the zoom. Android Chrome resizes the page for its keyboard
       (interactive-widget=resizes-content in demo.html), so innerHeight shrinks with the visual viewport there and the
       lift is 0: nothing is lifted twice.
       shortcut: the desktop card (900px and up, an iPad in landscape) is not lifted; lift it too if tablets show up */
    var vv = !wide && window.visualViewport;
    function lift() {
      var kb = vv.scale > 1.01 ? 0 : Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
      el.style.bottom = kb ? kb + "px" : ""; el.style.maxHeight = kb ? Math.round(vv.height - 8) + "px" : "";
    }
    /* a field focused low in a long sheet scrolls into the sheet's own list once the keyboard is up (never the page
       behind, which the open sheet holds still) */
    if (vv) el.addEventListener("focusin", function (e) {
      if (!e.target.matches("input, textarea, select")) return;
      setTimeout(function () {
        var b = S2.$(".sheet-b", el); if (!b || !e.target.isConnected) return;
        var r = e.target.getBoundingClientRect(), br = b.getBoundingClientRect();
        if (r.bottom > br.bottom) b.scrollTop += r.bottom - br.bottom + 8; else if (r.top < br.top) b.scrollTop -= br.top - r.top + 8;
      }, 300);
    });
    /* open, or reopened mid-close: the scrim takes taps again */
    function shown() { closing = false; clearTimeout(timer); sp.onRest = null; scrim.style.pointerEvents = ""; S2.layer.push(layer); }
    function open() {
      shown();
      if (vv) { vv.addEventListener("resize", lift); vv.addEventListener("scroll", lift); }
      if (fade) { requestAnimationFrame(function () { scrim.classList.add("on"); el.classList.add("open"); }); }
      /* the scrim follows the spring frame for frame: its 280ms CSS fade (the desktop and Reduce Motion path) restarted on
         every frame's write, so the dim trailed far behind the sheet (QA motion 2026-11-25) */
      else { h = el.offsetHeight; scrim.style.transition = "none"; sp.set(h); scrim.style.opacity = "0"; scrim.classList.add("on"); sp.to(0); }
      setTimeout(function () { var f = S2.$("[data-autofocus]", el) || S2.$("[data-close]", el); f && f.focus(); }, 30);
    }
    function close(v) {
      if (closing) return; closing = true; S2.layer.pop(layer);
      /* the page is live again at once, so the fading scrim must not take the next tap (QA motion 2026-11-25: on a phone it
         stayed hit-testable until the spring came to rest, and a tap on a page link 300ms after a close was lost) */
      scrim.style.pointerEvents = "none";
      if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true });   /* keyboard users carry on at once */
      var done = function () { if (vv) { vv.removeEventListener("resize", lift); vv.removeEventListener("scroll", lift); } el.remove(); scrim.remove(); opts.onClose && opts.onClose(); };
      if (fade) { scrim.style.opacity = ""; scrim.classList.remove("on"); el.classList.remove("open"); timer = setTimeout(done, 220); return; }
      h = el.offsetHeight; sp.onRest = done; sp.to(h, v || 0);     /* exits the way it came in: down */
    }
    /* opts.holdScrim: a sheet mid-task keeps a stray tap above it (review 2026-10-20: the tap that puts a phone keyboard
       away closed the survey mid-way); X, Escape and a flick down still close it */
    scrim.addEventListener("click", function () { if (!(opts.holdScrim && opts.holdScrim())) close(); });
    S2.$("[data-close]", el).addEventListener("click", function () { close(); });
    if (!wide) {   /* direct manipulation: the sheet tracks the finger 1:1 from where it was grabbed */
      var startY = 0, base = 0, hist = [], dragging = false;
      var grip = function (e) {
        if (e.target.closest("button, a, input, select, textarea")) return;
        /* grabbed while it was closing: it is open again under the finger, so the close callback must not fire when the
           spring comes to rest (review 2026-10-19: it sprang back, then vanished) */
        if (closing) { if (fade) { scrim.classList.add("on"); el.classList.add("open"); } shown(); }
        h = el.offsetHeight;
        dragging = true; startY = e.clientY; base = sp.x; hist = [{ y: e.clientY, t: performance.now() }]; sp.stop();
        el.setPointerCapture(e.pointerId);
      };
      var move = function (e) {
        if (!dragging) return;
        var y = base + (e.clientY - startY);
        if (y < 0) y = -S2.rubber(-y, h || 400);     /* soft ceiling instead of a wall */
        sp.set(y); hist.push({ y: e.clientY, t: performance.now() }); if (hist.length > 5) hist.shift();
      };
      var end = function () {
        if (!dragging) return; dragging = false;
        var a = hist[0], b = hist[hist.length - 1], dt = Math.max(1, b.t - a.t), v = (b.y - a.y) / dt * 1000;   /* px/s */
        var rest = sp.x + S2.project(v);
        if (rest > h * 0.5 || v > 900) close(v); else sp.to(0, v);
      };
      [S2.$(".grabber", el), S2.$(".sheet-h", el)].forEach(function (g) { g.addEventListener("pointerdown", grip); });
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    }
    open();
    return { el: el, body: S2.$(".sheet-b", el), close: close };
  };

  /* ---------- toast: enters and leaves the same way, pauses while the tab is hidden ---------- */
  /* the live region exists before the first message (S2.boot), because screen readers often miss one born with its text */
  /* an error is announced at once (role="alert") and stays long enough to read: at least six seconds, longer for a long
     refusal, and a tap closes it (WCAG 2.2.1; audit 2026-11-09: a joined list of refusal reasons left after 2.6 s).
     Both regions share one stack, so a confirmation and an error never overlap */
  function toastRoot() {
    var r = S2.$(".toast-root"); if (r) return r;
    r = document.createElement("div"); r.className = "toast-root"; document.body.appendChild(r);
    ["status", "alert"].forEach(function (role) {
      var x = document.createElement("div"); x.className = "toast-lane"; x.setAttribute("role", role); x.setAttribute("aria-live", role === "alert" ? "assertive" : "polite"); r.appendChild(x);
    });
    return r;
  }
  /* opts (audit 2026-11-09, so the desk's Undo toast is this toast and not a copy): action { label, run } puts one
     text button in the capsule and keeps it six seconds; group names a kind of toast that replaces its own earlier
     one (one Undo at a time); onGone runs when it leaves. Returns { close }. v5.00 (f): sticky keeps it until its action
     or close runs (the "new version" and "new updates" offers, which must not vanish while the reader finishes a form) */
  S2.toast = function (msg, kind, opts) {
    opts = opts || {};
    var root = toastRoot(), err = kind === "err", act = !err && opts.action, lane = root.children[err ? 1 : 0];
    if (opts.group) S2.$$('.toast[data-group="' + opts.group + '"]', root).forEach(function (x) { x.remove(); });
    var t = document.createElement(err ? "button" : "div"); t.className = "toast enter" + (err ? " err" : "");
    if (opts.group) t.setAttribute("data-group", opts.group);
    if (err) { t.type = "button"; t.setAttribute("aria-label", msg + ". Close"); }
    t.innerHTML = (kind === "ok" ? '<span class="toast-ic ok">' + S2.ic("check") + "</span>" : err ? '<span class="toast-ic err">' + S2.ic("x") + "</span>" : "") + "<span>" + S2.esc(msg) + "</span>" +
      (act ? '<button type="button" class="toast-act">' + S2.esc(act.label) + "</button>" : "");
    lane.appendChild(t); requestAnimationFrame(function () { requestAnimationFrame(function () { t.classList.remove("enter"); }); });
    var left = opts.sticky ? Infinity : err ? Math.max(6000, String(msg).length * 70) : act ? 6000 : 2600, last = performance.now(), timer = 0, gone = false;
    function leave() { if (gone) return; gone = true; clearInterval(timer); t.classList.add("leave"); setTimeout(function () { t.remove(); }, 200); if (opts.onGone) opts.onGone(); }
    if (err) t.addEventListener("click", leave);
    if (act) S2.$(".toast-act", t).addEventListener("click", function () { leave(); act.run(); });
    timer = setInterval(function () {
      var n = performance.now(); if (!document.hidden) left -= n - last; last = n;
      if (left <= 0 || !t.isConnected) leave();
    }, 100);
    return { close: leave };
  };

  /* ---------- the one orchestrated reveal per page ---------- */
  S2.reveal = function (root) {
    var els = S2.$$(".reveal", root);
    els.forEach(function (e, i) { e.style.setProperty("--i", Math.min(i, 6)); });
    requestAnimationFrame(function () { requestAnimationFrame(function () { els.forEach(function (e) { e.classList.add("in"); }); }); });
  };
  /* the ONE way a repainted region skips its entrances (QA motion 2026-11-25; promoted from js/pages/profile.js settle and
     the Control Center's hydrateQuiet): every reveal is shown, and every entrance already started under root (the chart
     draw-ins of S2.charts.hydrate, a page's after() WAAPI calls, CSS keyframes on new markup, a reveal's transition)
     finishes in this frame. getAnimations flushes style first, so it sees them all. An endless one (the live dot's ring,
     a skeleton's shimmer) is left running: finish() throws on an infinite effect. A soft route (the pulse, S2.quietRepaint)
     is an edit, not a visit, so S2.route settles instead of replaying the page (the standing rule: an edit never resets
     the page) */
  S2.settle = function (root) {
    if (!root) return;
    S2.$$(".reveal", root).forEach(function (e) { e.classList.add("in"); });
    if (root.getAnimations) root.getAnimations({ subtree: true }).forEach(function (a) { var t = a.effect && a.effect.getComputedTiming(); if (t && isFinite(t.endTime)) a.finish(); });
  };
  /* numbers that count up when they first appear (stat moments, not every number). The markup already holds the final
     number, so a page that skips this (a soft route) shows the right one */
  S2.countUp = function (root) {
    S2.$$("[data-count]", root).forEach(function (el) {
      var to = parseFloat(el.dataset.count), d = parseInt(el.dataset.dec || "0", 10), suf = el.dataset.suf || "";
      if (S2.reduce.matches) { el.textContent = S2.fmt(to, d) + suf; return; }
      var t0 = performance.now(), dur = 500;   /* QA motion 2026-11-25: inside the half second a page's entrance takes */
      (function tick(t) { var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4); el.textContent = S2.fmt(to * e, d) + suf; if (p < 1) requestAnimationFrame(tick); })(t0);
    });
  };

  /* ---------- website furniture shared by every page (review 2026-10-19: five pages drew "About this data" five ways and
     three drew breadcrumbs three ways). Styles: .about and .crumbs in ui.css ---------- */
  /* the ONE sources-and-method disclosure. body: an html string, or an array of html strings (one paragraph each;
     falsy entries are dropped). Callers escape their own data, as with any html they pass */
  /* ---------- the ONE section head (audit 2026-11-09: control, desk, today and league each built their own) ----------
     A kicker (sentence case, the topic), a .d-2 headline and one sentence, with an optional aside on the right (a control,
     a figure or an arrow link). o: kicker (text, escaped) or kh (kicker HTML already escaped); h (text, escaped) or hh (HTML already built from escaped parts); id; lvl
     (heading level, default 2); size (default "d-2"); sm (one step down for a narrow column); p (sentence, HTML);
     aside (HTML); href + link (an arrow link); cls (extra classes on the head); focus (tabindex -1, a focus target
     after a repaint); swap (data-swap on the heading) */
  S2.secHead = function (o) {
    var h = "h" + (o.lvl || 2), esc = S2.esc;
    return '<div class="sec-head' + (o.cls ? " " + o.cls : "") + '"><div class="copy">' + (o.kh || o.kicker ? '<span class="kicker">' + (o.kh || esc(o.kicker)) + "</span>" : "") +
      "<" + h + ' class="' + (o.size || "d-2") + (o.sm ? " sec-h-sm" : "") + '"' + (o.id ? ' id="' + esc(o.id) + '"' : "") + (o.focus ? ' tabindex="-1"' : "") + (o.swap ? ' data-swap="' + esc(o.swap) + '"' : "") + ">" +
        (o.hh != null ? o.hh : esc(o.h)) + "</" + h + ">" + (o.p ? "<p>" + o.p + "</p>" : "") + "</div>" + (o.aside || "") +
      (o.href ? '<a class="arrow" href="' + esc(o.href) + '"><span>' + esc(o.link) + "</span>" + S2.ic("chev") + "</a>" : "") + "</div>";
  };
  /* ---------- the ONE empty or state box (audit 2026-11-09: the desk's stateBox, the Control Center's .cc-empty and
     Team HQ's .hqx-empty were three designs for "nothing here") ----------
     kind: "none" (nothing to show), "ok" (all clear), "err" (a failure; announced), "lock" (not open to this role).
     title is plain text; text is HTML the caller built from escaped parts. actions is HTML the caller built (its own
     buttons, as before), or one action or a list of them, { t: label, href } for a link or { t: label, data: { key:
     value } } for a button the page binds by its data-key, which the box draws in the furniture of the page it is on:
     the website button (.btn.site.outline) on a public page, the app's small gray pill in a workspace (QA round 2,
     2026-11-25: every public page's caller had to remember the website button, and the gray pill kept turning up there) */
  function emptyAct(a) {
    var cls = document.documentElement.getAttribute("data-mode") === "app" ? "btn secondary sm" : "btn site outline", d = a.data || {};
    var attrs = Object.keys(d).map(function (k) { return " data-" + k + '="' + S2.esc(d[k]) + '"'; }).join("");
    return a.href != null ? '<a class="' + cls + '" href="' + S2.esc(a.href) + '"' + attrs + ">" + S2.esc(a.t) + "</a>"
      : '<button type="button" class="' + cls + '"' + attrs + ">" + S2.esc(a.t) + "</button>";
  }
  S2.empty = function (kind, title, text, actions) {
    var icon = kind === "err" ? "alert" : kind === "ok" ? "check" : kind === "lock" ? "lock" : "eye";
    if (actions && typeof actions === "object") actions = [].concat(actions).map(emptyAct).join("");
    return '<div class="empty-state ' + (kind || "none") + '"' + (kind === "err" ? ' role="alert"' : "") + '><span class="empty-ic">' + S2.ic(icon) + '</span><div class="empty-t"><p class="t-head">' + S2.esc(title) + "</p>" +
      (text ? '<p class="t-foot">' + text + "</p>" : "") + (actions ? '<div class="empty-acts">' + actions + "</div>" : "") + "</div></div>";
  };
  /* a small count drawn as dots (one per item waiting), read aloud by its label; one look on the desk and the Control
     Center (audit 2026-11-09: one drew dots, the other gray bars). cls adds a class (a page's narrow-pane copy) */
  S2.shapes = function (n, label, cls) {
    var s = ""; for (var i = 0; i < n; i++) s += "<i></i>";
    return '<span class="shapes' + (cls ? " " + cls : "") + '" role="img" aria-label="' + S2.esc(label) + '">' + s + "</span>";
  };
  S2.about = function (body, title) {
    var html = Array.isArray(body) ? body.filter(Boolean).map(function (p) { return "<p>" + p + "</p>"; }).join("") : body || "";
    return '<details class="about reveal"><summary><span class="kicker">' + S2.esc(title || "About this data") + '</span><span class="about-x" aria-hidden="true"></span></summary>' +
      '<div class="about-b">' + html + "</div></details>";
  };
  /* breadcrumbs for deep pages: [[href, label], ...]; the LAST entry is the page itself (its href is ignored), so the
     trail always ends where the reader is */
  S2.crumbs = function (trail) {
    var last = trail.length - 1;
    return '<nav class="crumbs" aria-label="Breadcrumb">' + trail.map(function (c, i) {
      return i === last ? '<span aria-current="page">' + S2.esc(c[1]) + "</span>" : '<a href="' + S2.esc(c[0]) + '">' + S2.esc(c[1]) + '</a><span aria-hidden="true">/</span>';
    }).join("") + "</nav>";
  };

  /* ---------- router + shell ---------- */
  S2.page = function (name, def) { S2.pages[name] = def; };
  S2.go = function (hash) { location.hash = hash; };
  /* the one query parser for S2.parse and S2.alias: a malformed escape is kept as typed and said in the console, never
     thrown (review 2026-11-23: "%E0%A4%A" in an old link stopped the page from routing) */
  function dec(x) { try { return decodeURIComponent(x); } catch (e) { console.warn("S2: a malformed escape in the address was kept as typed:", x); return x; } }
  S2.query = function (s) { var q = {}; (s || "").split("&").forEach(function (kv) { if (!kv) return; var p = kv.split("="); q[dec(p[0])] = dec(p[1] || ""); }); return q; };
  S2.parse = function () {
    var h = (location.hash || "#/today").slice(2), parts = h.split("?"), path = parts[0].split("/");
    return { name: path[0] || "today", arg: path[1] || "", sub: path[2] || "", q: S2.query(parts[1]) };
  };
  /* header v2 (commissioner, 2026-10-23: "Create what you think would be the best for organization and for any future
     expansion", after "I dont see an action center button in the header tab"). ONE map of the site: the desktop bar and
     its menus, the phone menu and the wayfinding in S2.route all read it, so a new page, tab or menu is one line here.
     The league is on the left, what is yours on the right: the bar holds five league items for everyone, then the
     workspaces a person holds, then the Action Center beside search. New pages fold into a menu; the bar does not widen.
     An entry is a page link { id, t, href, here } or a menu { id, t, here, cols }. here: the route names that light it.
     side "work" sits after the divider, "end" in the right-hand cluster; align "end" sets a menu's columns under its
     trigger; count names an S2.nav.info entry for the trigger's badge. A column is { h, lead (big links), wide | fit,
     draw (an S2.nav.draw list above its links), links (an array, or a function read at each open), tabs (a workspace id:
     its page's views) }. A link is { t, href, flow?, type?, small?, arrow?, accent?, info? }. hat and not (on an entry,
     column or link) go through S2.has, and a guest-only link is not: "member".
     shortcut: a menu link to another tab of the page already open re-renders it from the top, until core has a
     def.update hook (control.js names it, at its replaceState tab switch) */
  /* the current season's page, read each time a link is drawn: a bare "#/season" keeps whatever ?season= the address
     names, so on an archive Register, Own a club, Join the staff and Full calendar opened the archive's season page,
     which counted nobody signed up (health crawl 1, 2026-11-25). A NAV link reads it through a getter (get href) */
  function seasonNow() { return S2.seasonHref(null, "#/season"); }
  S2.WORKSPACES = [["hq", "Team HQ", "office", "Front office"], ["desk", "Staff Desk", "staff", "League staff"], ["control", "Control Center", "commish", "Commissioners"]];
  function heldWorkspaces() { return S2.WORKSPACES.filter(function (w) { return S2.has(w[2]); }); }
  S2.NAV = [
    { id: "today", t: "Today", href: "#/today", here: ["today"] },
    { id: "games", t: "Games", href: "#/games", here: ["games", "game"] },
    /* News came back 2026-11-23 (the cutover list's live features: "go ahead on all of these") */
    { id: "league", t: "League", here: ["standings", "stats", "clubs", "club", "player", "news"], cols: [
      { h: "Explore the league", lead: 1, links: [{ t: "Standings", href: "#/standings" }, { t: "Stats", href: "#/stats" }, { t: "Clubs", href: "#/clubs" }, { t: "News", href: "#/news" }] },
      { h: "Standings", links: [{ t: "Division", href: "#/standings?view=division" }, { t: "League table", href: "#/standings?view=league" },
        { t: "Playoff race", href: "#/standings?view=race" }, { t: "Projected playoffs", href: "#/standings?view=playoffs" }, { t: "Power rankings", href: "#/standings?view=power" }] },
      { h: "Stats", links: [{ t: "Leaders", href: "#/stats?tab=leaders" }, { t: "Skaters", href: "#/stats?tab=skaters" }, { t: "Goaltenders", href: "#/stats?tab=goalies" },
        { t: "Club stats", href: "#/stats?tab=teams" }, { t: "Players", href: "#/stats?tab=players" }, { t: "Awards", href: "#/stats?tab=awards" }] },
      { h: "Clubs", fit: 1, draw: "crests", links: [{ t: "League moves", href: "#/clubs?view=moves" }, { t: "Trades", href: "#/clubs?view=moves&kind=trade" }] }] },
    { id: "season", t: "Season", here: ["season", "draft", "bidding", "camp", "pickup-import"], cols: [
      /* the current season, then each finished season's archive (QA functional 2026-11-25: "Season 1" opened Season 2's
         page with only its calendar switched, and the real archive was linked from nowhere) */
      { h: "Seasons", lead: 1, links: function () { return seasonLinks().concat([{ t: "Draft room", href: "#/draft" },
        /* Season 2 player market (commissioner, 2026-11-02): the Saturday bid room and the league-wide training camp pool */
        { t: "Bid room", href: "#/bidding" }, { t: "Training camp", href: "#/camp" }]); } },
      { h: "Take part", links: [{ t: "Join with Discord", href: "#/you", not: "member" }, { t: "Register", get href() { return seasonNow(); }, flow: "register", accent: 1 },
        /* only while owner applications are open (QA functional 2026-11-25: after the close the database refuses them) */
        { t: "Own a club", get href() { return seasonNow(); }, flow: "owner", not: "staff", when: function () { return !S2.forms || S2.forms.ownerAppsOpen(); } },
        { t: "Join the staff", get href() { return seasonNow(); }, flow: "staff", not: "staff" },
        { t: "Saturday bidding", href: "#/hq?tab=bidding", hat: "office" }, { t: "Import a pickup game", href: "#/pickup-import", hat: "member" }] },
      { h: "Key dates", wide: 1, draw: "dates", links: [{ t: "Full calendar", get href() { return seasonNow(); }, arrow: 1 }] }] },
    { id: "rulebook", t: "Rulebook", href: "#/rulebook", here: ["rulebook"] },
    { id: "work", side: "work", count: "work", here: ["hq", "trade", "desk", "control"],   /* trade: the Team HQ trade builder (js/pages/tradebuild.js) */
      t: function () { var w = heldWorkspaces(); return w.length === 1 ? w[0][1] : "Workspaces"; },
      cols: function () { return heldWorkspaces().map(function (w) { return { h: w[3], lead: 1, tabs: w[0], links: [{ t: w[1], href: "#/" + w[0], info: w[0] }] }; }); } },
    /* the Action Center is back (the live rulebook names it): the door to the league office, beside search. A utility
       menu, so its case types are plain links, not the big type of a destination; your cases sit under the trigger */
    { id: "action", side: "end", align: "end", t: "Action Center", hat: "member", count: "action", here: [], cols: [
      { h: "File a case", links: function () { return S2.caseTypes().map(function (c) { return { t: c[1], href: "#/you?tab=inbox", flow: "case", type: c[0] }; })
        /* a message goes to the member the sender picks, so the door says so (QA functional 2026-11-25: "Message the league
           office" opened a form asking which member to write to). A case is the door to the league office */
        .concat([{ t: "New message", href: "#/you?tab=inbox", flow: "message", small: 1 }]); } },
      { h: "Your cases", wide: 1, draw: "cases", links: [{ t: "All your cases", href: "#/you?tab=inbox&show=cases", arrow: 1 }] }] }
  ];
  /* hats: "member" is anyone signed in; "office" a club's Owner, GM or AGM (and a commissioner); "staff" every staffer
     and a commissioner; "manager" a commissioner or a staffer who HOLDS a committee manager seat now (who may issue a
     suspension, 2026-11-23); "draftbid" a commissioner or the staffer who holds the Draft and Bidding seat now (who may
     pause Saturday bidding and run the draft room). A seat is the member's own (public.committees.manager_profile_id,
     read at sign-in into S2.session.committees, js/live.js), so moving a seat moves the powers. A display hint: the
     database decides every power. An unknown hat is a mistake, said in the console */
  S2.has = function (hat) {
    var r = S2.state.role;
    if (hat === "member") return r !== "guest";
    if (hat === "office") return r === "office" || r === "commish";
    if (hat === "staff") return r === "staff" || r === "commish";
    if (hat === "manager" || hat === "draftbid") {
      if (r === "commish") return true;
      var mine = S2.session.committees || [];
      return r === "staff" && (hat === "manager" ? mine.length > 0 : mine.indexOf("draft") >= 0);
    }
    if (hat === "commish") return r === "commish";
    console.error("S2.has: no hat named " + hat); return true;
  };
  S2.state = { role: "guest", theme: S2.store.get("theme", "light"), finish: "glacier" };   /* commissioner, 2026-11-23: "I prefer glacier and keep the current fonts shown on the concept site": Glacier is the one finish; a stored Gold or Ember from an earlier visit is ignored */
  /* v5.00 swap (f, 2026-11-24): the role is who is signed in, never a choice on the page or a role kept in storage. The
     order is the current site's (CG.computeRole): a commissioner, then a club seat (league office and club front office
     never overlap, Rule 2.7), then staff, then any signed-in member; the database decides every permission either way */
  S2.roleOf = function (s) {
    if (!s || !s.user) return "guest";
    return s.isCommissioner ? "commish" : s.seat ? "office" : s.isStaff ? "staff" : "player";
  };
  /* hint: the first paint's guess before the session lands (js/live.js: a stored sign-in paints as a member, not a guest).
     S2.roleGuessed says the role on screen is that guess, so an old link whose page depends on the role waits for the
     real one (S2.route) */
  S2.applyRole = function (hint) { S2.state.role = hint || S2.roleOf(S2.session); S2.roleGuessed = !!hint; };
  S2.applyRole();
  /* the look changes in place: every color is a token, so nothing re-renders (review 2026-10-19: a re-render blanked the
     page for four frames, replayed every entrance and dropped focus). An element that scopes the look locally (a dark band
     with data-theme="dark") marks itself data-look-scope and keeps following the chosen finish. Pages that print the
     look (a settings row) listen for "s2:look" on document. */
  /* the status bar wears the header's color. --bar depends on the theme AND the page mode (white site bar, gray workspace
     bar), so it is read again whenever either changes (review 2026-10-19: set once at boot, before S2.route had set the
     mode, it gave a white site header a gray status bar) */
  function syncBar() {
    var m = S2.$('meta[name="theme-color"]'); if (m) m.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--bar").trim());
  }
  /* a theme change cross-fades the whole page in one 200ms view transition (QA motion 2026-11-25: only the body faded, so
     the header and the bands went black on frame one over a body still gray, with gray headlines between). A solid
     cross-fade of the two pictures, no glass. The first paint and Reduce Motion switch at once */
  S2.applyLook = function () {
    var r = document.documentElement, st = S2.state, was = r.getAttribute("data-theme");
    /* everything that reads the new look runs inside the switch, so the status bar and the chart ink read the new colors */
    var go = function () {
      r.setAttribute("data-theme", st.theme); r.setAttribute("data-finish", st.finish);
      S2.$$("[data-look-scope]").forEach(function (e) { e.setAttribute("data-finish", st.finish); });
      syncBar();
      S2.charts && S2.charts.ink(document);
      document.dispatchEvent(new CustomEvent("s2:look", { detail: { theme: st.theme, finish: st.finish } }));
    };
    /* -> a promise that settles once the new look is applied (a caller that measures it waits for it) */
    if (was && was !== st.theme && document.startViewTransition && !S2.reduce.matches) return document.startViewTransition(go).updateCallbackDone;
    go(); return Promise.resolve();
  };
  function paras(x) { return (Array.isArray(x) ? x : x ? [x] : []).filter(Boolean).map(function (t) { return '<p class="lk-why">' + S2.esc(t) + "</p>"; }).join(""); }
  /* a door this reader does not hold: who may use it and the rule behind it, then Close. v5.00 swap (i3f, 2026-11-25): a
     plain statement; the concept's View as and Carry on are gone (the role is who is signed in), and the database decides
     every permission whatever the page shows. o: { title, who: "A club's Owner, GM or AGM", why: rule text (string or array) } */
  S2.locked = function (o) {
    o = o || {};
    var sh = S2.sheet({ title: o.title || "Not open to you", html: '<div class="lk"><p class="lk-who"><span class="kicker">Who may do this</span><span class="lk-whot">' +
      S2.esc(o.who || "Another member") + "</span></p>" + paras(o.why) + '<div class="fl-actions"><button type="button" class="btn secondary" data-lk data-autofocus>Close</button></div></div>' });
    S2.$("[data-lk]", sh.el).addEventListener("click", function () { sh.close(); });
    return sh;
  };
  /* ---------- the ONE confirm sheet (audit 2026-11-09: core, the desk and the Control Center each built their own, and
     all three put focus on the action). Focus lands on the SAFE button, as Apple's alerts do: Return or Space never runs
     a destructive or rule-breaking action by accident.
     o: { title; why (string or array, escaped); html (more HTML, already escaped); ok (the action's label); cancel
     (default "Cancel"); danger (red action); note (HTML under the buttons); open (a page's own sheet opener, for its
     focus return; default S2.sheet); onOk(sh) (return false to keep the sheet open); onClose(ok) } */
  S2.confirm = function (o) {
    var done = false, open = o.open || S2.sheet;
    var sh = open({ title: o.title, label: o.title, onClose: function () { if (o.onClose) o.onClose(done); },
      html: '<div class="cf">' + paras(o.why) + (o.html || "") + '<div class="fl-actions cf-acts"><button type="button" class="btn' + (o.danger ? " danger" : "") + '" data-cf="ok">' + S2.esc(o.ok || "Confirm") + "</button>" +
        '<button type="button" class="btn secondary" data-cf="no" data-autofocus>' + S2.esc(o.cancel || "Cancel") + "</button></div>" + (o.note || "") + "</div>" });
    sh.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cf]"); if (!b) return;
      if (b.dataset.cf === "no") { sh.close(); return; }
      done = true; if (!o.onOk || o.onOk(sh) !== false) sh.close(); else done = false;
    });
    return sh;
  };
  /* the site footer (league website v2): the sitemap, the league office, the Discord door and the small print */
  S2.footer = function () {
    var col = function (h, links) { return '<div class="foot-col"><span class="foot-h">' + h + "</span>" + links.map(function (l) { return '<a href="' + l[1] + '"' + (l[2] ? ' data-flow="' + l[2] + '"' : "") + ">" + l[0] + "</a>"; }).join("") + "</div>"; };
    var G = {}; S2.navGroups().forEach(function (g) { G[g.id] = g; });
    var top = function (id) { var g = G[id]; return g && g.href ? [[g.label, g.href]] : []; };
    var links = function (id, i) { var c = G[id] && G[id].cols && G[id].cols[i]; return c && Array.isArray(c.links) ? c.links.filter(may).map(function (l) { return [l.t, l.href, l.flow]; }) : []; };
    /* the clubs counted from the league read (QA round 2, 2026-11-25: "Eight clubs" was typed in, and would have outlived an
       added franchise); a read with no clubs leaves the count out rather than saying "No clubs" */
    var nc = S2.M && Array.isArray(S2.M.teams) ? S2.M.teams.length : 0, cw = S2.words(nc);
    return '<footer class="site-foot" data-theme="dark" data-look-scope><div class="foot-in">' +
      '<div class="foot-brand">' + S2.mark(40) + '<p class="d-2">Chel Gaming<br>Hockey League</p><p class="foot-line">Competitive 6v6 EA Sports NHL. ' +
        (nc ? cw.charAt(0).toUpperCase() + cw.slice(1) + (nc === 1 ? " club" : " clubs") + ", one league office" : "One league office") + ", every line counted.</p>" +
        '<span data-foot-door>' + footDoor() + "</span></div>" +
      '<div class="foot-cols">' +
        /* drawn from S2.NAV through may(), so the footer never offers a door the menu hides from this role (audit
           2026-11-09: it showed Own a club and Join the staff to staff, and its File a case went somewhere else) */
        col("League", top("today").concat(top("games"), links("league", 0))) +
        col("Season", seasonLinks().slice(0, 1).map(function (l) { return [l.t, l.href]; }).concat(links("season", 1))) +
        col("League office", top("rulebook").concat([["Players", "#/stats?tab=players"], ["Awards", "#/stats?tab=awards"]],
          G.action ? [["File a case", "#/you?tab=inbox", "case"]] : [])) +
      "</div></div>" +
      /* the small print. Commissioner, 2026-10-21, for the concept only: "Keep the fact that none of the edits on the
         concept site actually change anything for the actual league on the current site". That note and the concept's
         About link are gone (i2 hid them on the real site, i3f deleted them): everything done here changes the league */
      /* Terms and Privacy wrap as a pair (QA phone 2026-11-25: at 390 and 430 Privacy dropped alone onto a second line) */
      '<div class="foot-small"><span>Chel Gaming Hockey League</span><span>All times Eastern</span><span class="foot-legal"><a href="#/terms">Terms</a><a href="#/privacy">Privacy</a></span></div></footer>';
  };
  /* the footer's Discord door, only where it is the reader's next step (QA visual 2026-11-25: every signed-in member was
     asked to join a server most are already in): a guest joins with Discord (the header's and the hero's words, since it
     opens the sign-in), and a member the league reads as outside the server is sent to the re-check in Settings. Website
     furniture wears the website button (review 2026-10-19) */
  function footDoor() {
    if (!S2.has("member")) return '<a class="btn site discord" href="#/you">Join with Discord</a>';
    var pr = S2.auth && S2.auth.profile;
    return pr && pr.in_guild === false ? '<a class="btn site discord" href="#/you?tab=settings">Join the Discord</a>' : "";
  }
  /* ---------- the announcement strip (QA visual and functional 2026-11-25: it was a literal "Season 2 · Sign-ups are open
     · Sign up" on every page for every role, never read from the calendar, and it opened the sign-up form for members
     already signed up). ONE reading of the season taking sign-ups (S2.forms.regSeason: the seasons row with
     registration_open) and its dates against the moment the league was read (M.now, as the Today band reads it):
     - signed up for it: "You are signed up" and the next date (the draft, then puck drop), to their sign-up, never the form;
     - not signed up (or a guest): before signup_deadline_at the day sign-ups close; after it, late sign-ups join the
       training camp pool (the rulebook's cutoff is for the draft, not a close); the strip opens the sign-up form;
     - on another season's page the member's sign-up is not in the read, so the strip links the season without the form;
     - no season taking sign-ups: the next date of the current season, or no strip.
     S2.paintChrome repaints it in place on every route and soft repaint, and after a filed sign-up; never the router */
  S2.stripHtml = function () {
    var M = S2.M, F = S2.forms; if (!M || !F || !M.etDate) return "";
    var now = (M.now || new Date()).getTime(), fut = function (iso) { return iso && Date.parse(iso) > now ? iso : null; };
    var nextOf = function (s) { var d = fut(s.draft_at), p = fut(s.starts_at); return d ? "Draft " + M.etDate(d) : p ? "Puck drop " + M.etDate(p) : ""; };
    var strip = function (s, line, go, href, flow) {
      return '<a class="topstrip" href="' + S2.esc(href) + '"' + (flow ? ' data-flow="' + flow + '"' : "") + "><span>" + S2.esc(s.name || "Season " + s.number) + '</span><span class="dot" aria-hidden="true"></span><span>' +
        S2.esc(line) + '</span><span class="go">' + S2.esc(go) + S2.ic("chev") + "</span></a>";
    };
    var s = F.regSeason();
    if (s) {
      var mine = S2.has("member") ? F.signedUp() : false, close = fut(s.signup_deadline_at || s.registration_deadline);
      var line = close ? "Sign-ups close " + M.etDate(close) : "Late sign-ups join the training camp pool";
      if (mine) return strip(s, "You are signed up", nextOf(s) || "Your sign-up", "#/you?tab=season");
      if (mine == null) return strip(s, line, "See the season", S2.seasonHref(null, "#/season"));
      return strip(s, line, "Sign up", seasonNow(), "register");
    }
    var cur = currentSeason(), nx = cur ? nextOf(cur) : "";
    return nx ? strip(cur, nx, "See the season", S2.seasonHref(null, "#/season")) : "";
  };
  /* the parts of the shell that follow the league and the session, repainted in place when they changed (S2.route runs
     it on every route and every soft repaint; a filed sign-up and a Discord re-check run it too) */
  S2.paintChrome = function () {
    var host = S2.$("#stripHost"), html = call(S2.stripHtml, "the announcement strip");
    if (host && html != null && host.innerHTML !== html) {
      var had = host.contains(document.activeElement); host.innerHTML = html;
      if (had) { var a = S2.$(".topstrip", host); if (a) a.focus({ preventScroll: true }); }
    }
    var door = S2.$("[data-foot-door]"), d = footDoor();
    if (door && door.innerHTML !== d) door.innerHTML = d;
  };
  document.addEventListener("s2:filed", function (e) { if (e.detail && e.detail.flow === "register") S2.paintChrome(); });
  /* the phone and tablet menu: a full-screen panel under the header (Apple.com), links arrive in a short stagger */
  S2.menu = function (open) {
    var m = S2.$("#siteMenu"), b = S2.$("#menuBtn"); if (!m || !b) return;
    if (open == null) open = m.hidden;
    b.setAttribute("aria-expanded", String(open)); b.setAttribute("aria-label", open ? "Close menu" : "Menu");
    document.documentElement.classList.toggle("menu-open", open);
    /* the menu is modal: Tab and VoiceOver stay inside it, not in the page hidden behind it (review 2026-10-19). Not
       S2.layer, which inerts #app, and #app holds the menu and the header with its close button */
    [S2.$("#page"), S2.$(".site-foot"), S2.$(".topstrip")].forEach(function (e) { if (e) e.inert = open; });
    /* the panel starts where the header ends: below the announcement strip when the page sits at the top */
    var nb = S2.$("#navbar"); if (nb) m.style.top = Math.max(0, nb.getBoundingClientRect().bottom) + "px";
    if (open) { m.hidden = false; requestAnimationFrame(function () { m.classList.add("on"); var f = S2.$("#smRoot .sm-a", m); f && f.focus({ preventScroll: true }); }); }
    else { m.classList.remove("on"); setTimeout(function () { if (!m.classList.contains("on")) { m.hidden = true; smReset(); } }, S2.reduce.matches ? 0 : 220); }
  };

  /* ---------- header v2 menus: S2.NAV drawn as WAI-ARIA disclosure navigation (buttons with aria-expanded, never
     role="menu"). One solid band in the bar's own color grows out of the bar's edge and each panel is clipped to that
     same edge, so the surface and its content move as one (transform and clip-path only, no glass). A mouse opens a
     menu after 150ms of intent and moves between menus in 60ms; a click or tap pins it; a keyboard open never animates.
     Not modal: the page stays live under a light dim. ---------- */
  S2.nav = { info: {}, draw: {} };
  /* the Workspaces trigger counts what waits in every workspace this role holds, each workspace's own count (hq.js
     wsInfo), so staff see their queue from any page (audit 2026-11-09: only the Action Center carried a badge) */
  S2.nav.info.work = function () {
    var n = heldWorkspaces().reduce(function (a, w) { var f = S2.nav.info[w[0]], o = f ? f() : null; return a + ((o && o.n) || 0); }, 0);
    return { n: n, label: n === 1 ? "1 item waiting" : n + " items waiting" };
  };
  var HATS = { member: 1, office: 1, staff: 1, commish: 1 };
  /* S2.has answers true for a hat it does not know, so a typo would show a door to everyone: refuse it, loudly */
  /* when (on a link): a condition read at each draw, for a door that opens and closes with the calendar */
  function may(o) {
    var bad = [o.hat, o.not].filter(function (h) { return h && !HATS[h]; });
    if (bad.length) { console.error("S2.NAV: no hat named " + bad.join(", ")); return false; }
    return (!o.hat || S2.has(o.hat)) && (!o.not || !S2.has(o.not)) && (!o.when || !!call(o.when, "a link's condition"));
  }
  /* the league's seasons (the league read's seasons rows), newest first */
  function seasonRows() { var c = S2.M && S2.M.control; return (c ? c.seasons.map(function (s) { return s.settings; }) : []).filter(Boolean).sort(function (a, b) { return b.number - a.number; }); }
  /* the season the site opens on (?season= absent): the active one, else the nearest upcoming one */
  function currentSeason() { var r = seasonRows(); return r.filter(function (s) { return s.status === "active"; })[0] || r.filter(function (s) { return s.status === "upcoming"; }).slice(-1)[0] || r[0] || null; }
  S2.currentSeason = currentSeason;   /* -> the seasons row (settings) the site opens on, for a door that writes to it */
  function seasonLinks() {
    var cur = currentSeason(), out = [{ t: cur ? cur.name || "Season " + cur.number : "This season", href: S2.seasonHref(null, "#/season") }];
    seasonRows().filter(function (s) { return s.status === "complete"; }).forEach(function (s) { out.push({ t: (s.name || "Season " + s.number) + " archive", href: S2.seasonHref(s.number, "#/standings") }); });
    return out;
  }
  function call(f, what) { try { return f(); } catch (e) { console.error("S2.nav: " + what + " failed", e); return null; } }
  function later(fn, ms) { clearTimeout(NAV.t); NAV.t = setTimeout(fn, ms); }
  function navReset() { clearTimeout(NAV.t); clearTimeout(NAV.hide); NAV.id = null; NAV.by = null; NAV.pinned = false; NAV.press = false; document.documentElement.classList.remove("nav-open"); }
  /* the map resolved for the role now viewing: labels and columns that are functions are read, gated entries dropped */
  S2.navGroups = function () {
    return S2.NAV.filter(may).map(function (g) {
      var cols = typeof g.cols === "function" ? call(g.cols, g.id + " columns") || [] : g.cols;
      return { id: g.id, href: g.href, here: g.here || [], side: g.side, align: g.align, count: g.count,
        label: typeof g.t === "function" ? call(g.t, g.id + " label") || g.id : g.t, cols: cols ? cols.filter(may) : null };
    }).filter(function (g) { return g.href || (g.cols && g.cols.length); });
  };
  function navGroup(id) { return S2.navGroups().filter(function (g) { return g.id === id; })[0] || null; }
  /* a workspace's tabs come from its own page definition (views), so a new tab shows in the menu by itself; the first
     view is the bare route, which the workspace's big link already is */
  function navTabs(ws) {
    var v = (S2.pages[ws] || {}).views;
    if (!v) { console.error("S2.nav: the " + ws + " page lists no views"); return []; }
    return v.slice(1).map(function (x) { return { t: x[1], href: "#/" + ws + "?tab=" + x[0], small: 1 }; });
  }
  function navLink(l, big) {
    var cls = l.arrow ? "arrow" : big && !l.small ? "big" : "nav-s" + (l.accent ? " accent" : ""), info = null;
    if (l.info) { var f = S2.nav.info[l.info]; if (!f) console.error("S2.nav: no info named " + l.info); info = f ? call(f, "the " + l.info + " info") : null; }
    var sub = info ? [info.sub, info.n ? info.label : ""].filter(Boolean).join("\u00a0· ") : "";   /* a wrap never starts a line with the dot */
    return '<li><a class="' + cls + '" href="' + S2.esc(l.href) + '"' + (l.flow ? ' data-flow="' + S2.esc(l.flow) + '"' + (l.type ? ' data-type="' + S2.esc(l.type) + '"' : "") : "") + ">" +
      (l.arrow ? "<span>" + S2.esc(l.t) + "</span>" + S2.ic("chev") : '<span class="nav-lt">' + S2.esc(l.t) + "</span>" + (sub ? '<span class="nav-sub">' + S2.esc(sub) + "</span>" : "")) + "</a></li>";
  }
  /* titled: the id of a heading already naming a menu's ONLY column (a phone level), so that column prints no heading of its own */
  function navCols(g, where, titled) {
    return '<div class="nav-cols' + (g.align === "end" ? " end" : "") + '">' + g.cols.map(function (c, i) {
      var hid = titled || "navH-" + where + "-" + g.id + "-" + i, body = "";
      var links = (typeof c.links === "function" ? call(c.links, g.id + " links") || [] : c.links || []).filter(may).concat(c.tabs ? navTabs(c.tabs) : []);
      if (c.draw) {
        var f = S2.nav.draw[c.draw];
        if (!f) console.error("S2.nav: no list named " + c.draw);
        body = f ? call(function () { return f(where); }, "the " + c.draw + " list") : null;
        if (body == null) body = '<p class="nav-empty">This list could not be drawn. The details are in the console.</p>';
      }
      return '<div class="nav-col' + (c.lead ? " lead" : "") + (c.wide ? " wide" : "") + (c.fit ? " fit" : "") + '">' + (titled ? "" : '<p class="nav-h" id="' + hid + '">' + S2.esc(c.h) + "</p>") + body +
        (links.length ? '<ul aria-labelledby="' + hid + '">' + links.map(function (l) { return navLink(l, c.lead); }).join("") + "</ul>" : "") + "</div>";
    }).join("") + "</div>";
  }
  /* you are here, inside a menu: worked out at each open, because in-page tabs change the address with replaceState and
     never run S2.route. The exact address first, else the first big link to the page showing */
  function navMark(root) {
    var at = location.hash || "#/today", name = S2.parse().name, links = S2.$$("a[href]:not([data-flow]):not(.arrow):not(.nav-req)", root);
    var hit = links.filter(function (a) { return a.getAttribute("href") === at; });
    if (!hit.length) hit = links.filter(function (a) { return a.classList.contains("big") && a.getAttribute("href").slice(2).split(/[?\/]/)[0] === name; }).slice(0, 1);
    hit.forEach(function (a) { a.setAttribute("aria-current", "page"); });
  }
  var COUNT = '<span class="nav-count" aria-hidden="true" hidden></span><span class="sr nav-cnt-sr"></span>';
  function navItem(g, tag) {
    var here = ' data-here="' + g.here.join(" ") + '"';
    if (g.href) return "<" + tag + '><a class="nav-a" href="' + g.href + '"' + here + '><span class="nav-l">' + S2.esc(g.label) + "</span></a></" + tag + ">";
    return "<" + tag + ' class="nav-g' + (g.side === "work" ? " work" : "") + '"><button type="button" class="nav-t" id="navT-' + g.id + '" data-g="' + g.id + '"' + here +
      (g.count ? ' data-count="' + g.count + '"' : "") + ' aria-expanded="false" aria-controls="navP-' + g.id + '"><span class="nav-l">' + S2.esc(g.label) + "</span>" + (g.count ? COUNT : "") +
      S2.chev().replace('class="chev"', 'class="chev nav-caret"') + '</button><div class="nav-p" id="navP-' + g.id + '" hidden></div></' + tag + ">";
  }
  /* the phone menu's root rows: a page is a link, a menu is a button that opens its own level (apple.com) */
  function smRow(g, i) {
    var sd = ' style="--sd:' + Math.min(150, 25 * i) + 'ms"', here = ' data-here="' + g.here.join(" ") + '"';
    if (g.href) return '<a class="sm-a" href="' + g.href + '"' + here + sd + ">" + S2.esc(g.label) + "</a>";
    return '<button type="button" class="sm-a sm-g" data-g="' + g.id + '"' + here + (g.count ? ' data-count="' + g.count + '"' : "") + ' aria-expanded="false" aria-controls="smL-' + g.id + '"' + sd +
      "><span>" + S2.esc(g.label) + "</span>" + (g.count ? COUNT : "") + S2.chev() + "</button>";
  }
  /* how: "hover" (a mouse resting on the trigger), "click" (pins it) or "key" (no motion) */
  S2.nav.open = function (id, how) {
    clearTimeout(NAV.t);
    var nb = S2.$("#navbar"), fly = S2.$("#navFly"), band = fly && S2.$(".nav-band", fly), dim = S2.$("#navDim"), p = S2.$("#navP-" + id), t = S2.$("#navT-" + id), g = navGroup(id), was = NAV.id;
    if (!nb || !band || !dim || !p || !t || !g) { console.error("S2.nav.open: the header has no menu named " + id); return; }
    if (how !== "hover") NAV.pinned = true; else if (!was) NAV.pinned = false;
    if (was !== id || how !== "hover") NAV.by = how;   /* how THIS menu came open: a click on one a hover opened pins it, never closes it */
    if (was === id) return;
    clearTimeout(NAV.hide);
    /* Apple: start from the presentation value. The surface's height on screen now, so a switch or a reopen mid-close
       grows or shrinks from where it is instead of jumping */
    var x = fly.hidden ? 0 : Math.max(0, band.getBoundingClientRect().bottom - fly.getBoundingClientRect().top);
    S2.$$(".nav-t", nb).forEach(function (o) { if (o !== t) o.setAttribute("aria-expanded", "false"); });
    S2.$$(".nav-p", nb).forEach(function (o) { if (o !== p) { o.classList.remove("on"); o.hidden = true; } });
    p.innerHTML = navCols(g, "bar"); navMark(p);   /* drawn at each open, so counts and cases are never stale */
    nb.classList.toggle("fly-kb", how === "key"); nb.classList.toggle("fly-swap", x > 0);
    fly.hidden = false; dim.hidden = false; p.hidden = false; p.inert = false;
    /* one read: the start styles commit here, so every change below transitions (no requestAnimationFrame, which stalls
       in a hidden window) */
    var h = p.offsetHeight;
    if (x > 0 && how !== "key" && !S2.reduce.matches) {   /* both from the measured edge, so the band never runs ahead of the panel's clip */
      band.style.transition = "none"; band.style.transform = "translateY(calc(" + x + "px - 100%))";
      p.style.transition = "none"; p.style.clipPath = "inset(0 0 " + Math.max(0, h - x) + "px 0)";
      p.getBoundingClientRect(); band.style.transition = ""; p.style.transition = ""; p.style.clipPath = "";
    }
    band.style.transform = "translateY(calc(" + h + "px - 100%))";
    p.classList.add("on"); dim.classList.add("on"); document.documentElement.classList.add("nav-open");
    t.setAttribute("aria-expanded", "true");
    NAV.id = id; NAV.y = window.scrollY;
  };
  S2.nav.close = function (instant) {
    clearTimeout(NAV.t);
    var id = NAV.id; if (!id) return;
    var nb = S2.$("#navbar"), fly = S2.$("#navFly"), band = fly && S2.$(".nav-band", fly), dim = S2.$("#navDim"), p = S2.$("#navP-" + id), t = S2.$("#navT-" + id);
    NAV.id = null; NAV.by = null; NAV.pinned = false;
    document.documentElement.classList.remove("nav-open");
    if (t) t.setAttribute("aria-expanded", "false");
    if (nb) { nb.classList.toggle("fly-kb", !!instant); nb.classList.remove("fly-swap"); }
    if (p && t && p.contains(document.activeElement)) t.focus({ preventScroll: true });   /* a scroll or resize close never drops focus to the page's top */
    if (p) { p.classList.remove("on"); p.inert = true; }   /* a fast Tab never lands in a closing panel */
    if (dim) dim.classList.remove("on");
    if (band && !S2.reduce.matches) band.style.transform = "";   /* Reduce Motion: the surface keeps its height while it fades */
    function done() { if (p) p.hidden = true; if (NAV.id) return; if (fly) fly.hidden = true; if (dim) dim.hidden = true; if (band) band.style.transform = ""; }
    clearTimeout(NAV.hide);
    /* an instant close commits its end state, then lets the bar's own hover motion back (fly-kb would freeze it) */
    if (instant) { done(); if (nb) { void nb.offsetWidth; nb.classList.remove("fly-kb"); } } else NAV.hide = setTimeout(done, S2.reduce.matches ? 150 : 180);
  };
  /* the badges on the triggers (bar and phone menu); a page calls it when what they count changes */
  S2.nav.sync = function () {
    S2.$$("#navbar [data-count], #siteMenu [data-count]").forEach(function (b) {
      var name = b.dataset.count, f = S2.nav.info[name], o = f ? call(f, "the " + name + " count") : null;
      if (!f) console.error("S2.nav.sync: no count named " + name);
      var n = (o && o.n) || 0, c = S2.$(".nav-count", b), s = S2.$(".nav-cnt-sr", b);
      c.textContent = n ? String(n) : ""; c.hidden = !n; s.textContent = n ? ", " + o.label : "";
    });
  };
  /* the phone menu's levels: the root slides left and the menu's own level comes in from the right; Back mirrors it */
  function smDrill(id) {
    var m = S2.$("#siteMenu"), root = S2.$("#smRoot"), lv = S2.$("#smL-" + id), b = S2.$('.sm-g[data-g="' + id + '"]', m), g = navGroup(id);
    if (!lv || !g || !b) { console.error("S2.menu: no menu named " + id); return; }
    /* a menu with one column (a single workspace) is titled by that column, so its name is not printed twice in a row */
    var solo = g.cols.length === 1;
    lv.innerHTML = '<button type="button" class="sm-back" aria-label="Back to the menu">' + S2.chev() + 'Menu</button><p class="sm-title" id="smT-' + id + '" tabindex="-1">' + S2.esc(solo ? g.cols[0].h : g.label) + "</p>" +
      navCols(g, "menu", solo ? "smT-" + id : null);
    navMark(lv); lv.hidden = false; lv.inert = false; lv.className = "sm-level right"; void lv.offsetWidth;
    lv.className = "sm-level on"; root.className = "sm-level left"; root.inert = true;
    b.setAttribute("aria-expanded", "true"); m.scrollTop = 0; S2.$(".sm-title", lv).focus({ preventScroll: true });
    setTimeout(function () { if (root.classList.contains("left")) root.hidden = true; }, S2.reduce.matches ? 0 : 240);
  }
  function smBack() {
    var m = S2.$("#siteMenu"), root = S2.$("#smRoot"), lv = S2.$(".sm-level.on:not(#smRoot)", m); if (!lv) return;
    var b = S2.$('.sm-g[data-g="' + lv.id.slice(4) + '"]', m);
    root.hidden = false; void root.offsetWidth; root.className = "sm-level on"; root.inert = false; lv.className = "sm-level right"; lv.inert = true;
    if (b) { b.setAttribute("aria-expanded", "false"); b.focus({ preventScroll: true }); } m.scrollTop = 0;
    setTimeout(function () { if (lv.classList.contains("right")) lv.hidden = true; }, S2.reduce.matches ? 0 : 240);
  }
  function smReset() {
    var root = S2.$("#smRoot"); if (!root) return;
    root.hidden = false; root.inert = false; root.className = "sm-level on";
    S2.$$("#siteMenu .sm-level:not(#smRoot)").forEach(function (l) { l.hidden = true; l.className = "sm-level right"; l.innerHTML = ""; });
    S2.$$("#siteMenu .sm-g").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
  }
  S2.shell = function () {
    var role = S2.state.role;
    navReset();   /* the markup is about to be replaced: no timer or open state may outlive it */
    /* header v2: everything the bar and the phone menu list comes from S2.NAV, resolved for this role */
    var groups = S2.navGroups(), main = groups.filter(function (g) { return !g.side; }), work = groups.filter(function (g) { return g.side === "work"; }),
      end = groups.filter(function (g) { return g.side === "end"; }), mine = work.concat(end);
    var bar = main.concat(work).map(function (g) { return navItem(g, "li"); }).join(""), act = end.map(function (g) { return navItem(g, "div"); }).join("");
    var phone = main.map(smRow).join("") + '<span class="sm-sep" aria-hidden="true"></span>' + mine.map(function (g, i) { return smRow(g, main.length + i); }).join("") +
      '<a class="sm-a site-menu-you" href="#/you" data-here="you" style="--sd:150ms">' + (role === "guest" ? "Join the league" : "You") + "</a>";
    var levels = groups.filter(function (g) { return !g.href; }).map(function (g) { return '<div class="sm-level right" id="smL-' + g.id + '" role="group" aria-labelledby="smT-' + g.id + '" hidden></div>'; }).join("");
    /* .nav-in holds the bar's contents to the page column, so the brand and the controls line up with the page on wide
       screens; the collapsed title is a flex item that takes only the free space, so it never moves the links or pushes
       a control off a phone screen */
    /* league website v2 (commissioner, 2026-10-19: "feels too much like a dashboard and not a League Website"; references
       liftfoils.com and juventus.com): an announcement strip, a website header with uppercase links, an Apple.com-style
       full-screen menu on phones and tablets instead of an app tab bar, and a full footer under every page */
    /* the member's initials, never a role letter (QA worst-case 2026-11-25: a GM saw "O"); the person glyph until the
       profile is read */
    var pr = S2.auth && S2.auth.profile, who = pr && (pr.gamertag || pr.display_name);
    document.getElementById("app").innerHTML =
      /* the first stop for a keyboard: straight to the page, past the strip and the header's dozen stops (QA visual
         2026-11-25). A button, not a "#page" link, which the hash router would read as a page name */
      '<button type="button" class="skip-link" id="skipLink">Skip to content</button>' +
      /* season sign-ups lead the site, ahead of owner applications (commissioner, 2026-10-19: "I would rather have season
         signups at the top of the landing page instead of owner applications"); S2.stripHtml reads the calendar */
      '<div id="stripHost">' + (call(S2.stripHtml, "the announcement strip") || "") + "</div>" +
      /* the band (.nav-fly) is the menus' one surface, first in the header so it paints under the bar's own contents */
      '<header class="navbar" id="navbar"><div class="nav-fly" id="navFly" aria-hidden="true" hidden><div class="nav-band"></div></div>' +
      '<div class="nav-in"><a class="brand" href="#/today" aria-label="CGHL home">' + S2.mark(28) + '<span class="wordmark">CGHL</span></a>' +
      '<span class="inline-title" id="inlineTitle" aria-hidden="true"></span>' +
      '<nav class="nav-links" aria-label="Primary"><ul class="nav-ul">' + bar + '</ul></nav><span class="nav-spacer"></span>' +
      '<div class="nav-act">' + act + '<button class="icon-btn" id="openSearch" aria-label="Search (Command K)">' + S2.ic("search") + "</button>" +
      (role === "guest" ? '<a class="btn discord sm nav-join" href="#/you"><span class="long">Join with Discord</span><span class="short">Join</span></a>' :
        '<button class="icon-btn" id="openBell" aria-label="Notifications">' + S2.ic("bell") + '</button><a class="avatar nav-avatar" href="#/you" data-here="you" aria-label="You">' + (who ? S2.esc(S2.initials(who)) : S2.ic("you")) + "</a>") +
      '<button class="menu-btn" id="menuBtn" aria-label="Menu" aria-expanded="false" aria-controls="siteMenu"><span></span><span></span></button></div></div></header>' +
      '<div class="nav-dim" id="navDim" aria-hidden="true" hidden></div>' +
      '<nav class="site-menu" id="siteMenu" aria-label="Menu" hidden><div class="site-menu-in"><div class="sm-level on" id="smRoot">' + phone + "</div>" + levels + "</div></nav>" +
      '<main class="page" id="page" tabindex="-1"></main>' + S2.footer();
    S2.$("#menuBtn").addEventListener("click", function () { S2.menu(); });
    S2.$("#skipLink").addEventListener("click", function () { S2.$("#page").focus(); });
    /* a link to the page already showing fires no hashchange, so S2.route never closed the menu and the page stayed
       scroll-locked under it (review 2026-10-19: TODAY on Today). Any link in the menu, or the home mark, closes it on
       the tap itself; focus goes to the page as a route would leave it */
    var menuLink = function (e) {
      var g = e.target.closest(".sm-g"); if (g) return smDrill(g.dataset.g);
      if (e.target.closest(".sm-back")) return smBack();
      if (!document.documentElement.classList.contains("menu-open") || !e.target.closest("a")) return;
      S2.menu(false); S2.$("#page").focus({ preventScroll: true });
    };
    S2.$("#siteMenu").addEventListener("click", menuLink); S2.$("#navbar .brand").addEventListener("click", menuLink);
    /* the desktop menus. Element listeners die with the shell, so a role switch adds no document listener */
    var nb = S2.$("#navbar");
    nb.addEventListener("pointerover", function (e) {
      if (e.pointerType !== "mouse") return;   /* a trackpad is a mouse; touch and pen use the click */
      var t = e.target.closest(".nav-t"), open = NAV.id && S2.$("#navP-" + NAV.id);
      if ((open && open.contains(e.target)) || (t && t.dataset.g === NAV.id)) return clearTimeout(NAV.t);
      if (t && e.relatedTarget && t.contains(e.relatedTarget)) return;   /* moving within a trigger is not arriving: a menu just closed stays closed */
      if (t) {
        if (open && open.contains(document.activeElement)) return;   /* a keyboard reader is inside the open menu: hover never moves it */
        var id = t.dataset.g; return later(function () { S2.nav.open(id, "hover"); }, NAV.id ? 60 : 150);
      }
      clearTimeout(NAV.t); if (NAV.id && !NAV.pinned) later(function () { S2.nav.close(); }, 150);
    });
    nb.addEventListener("pointerleave", function (e) { if (e.pointerType !== "mouse") return; clearTimeout(NAV.t); if (NAV.id && !NAV.pinned) later(function () { S2.nav.close(); }, 250); });
    /* the press that moves focus: the focus change and its focusout run in this same task (a right-click or a drag that
       never clicks must not leave it set) */
    nb.addEventListener("pointerdown", function () { NAV.press = true; setTimeout(function () { NAV.press = false; }, 0); });
    /* keyboard focus inside an open panel pins it: a mouse wandering off never closes it under the reader */
    nb.addEventListener("focusin", function (e) { if (NAV.id && e.target.closest("#navP-" + NAV.id)) NAV.pinned = true; });
    nb.addEventListener("click", function (e) {
      NAV.press = false;
      var t = e.target.closest(".nav-t");
      if (t) {
        var id = t.dataset.g, how = e.detail === 0 ? "key" : "click";
        if (NAV.id === id && (how === "key" || NAV.by !== "hover")) return S2.nav.close(how === "key");
        return S2.nav.open(id, how);   /* a click on a menu that hover opened pins it: it never closes under the pointer */
      }
      var a = e.target.closest(".nav-p a[href]");
      if (a) {
        var tr = NAV.id && S2.$("#navT-" + NAV.id); S2.nav.close(true);
        if (a.hasAttribute("data-flow")) { if (tr) tr.focus({ preventScroll: true }); }   /* before the delegated data-flow listener in js/flows.js opens the sheet, so it hands focus back here */
        else if (a.getAttribute("href") === (location.hash || "#/today")) S2.$("#page").focus({ preventScroll: true });   /* the same page: no route runs */
        return;
      }
      if (NAV.id && !e.target.closest("#navP-" + NAV.id)) S2.nav.close(true);
    });
    /* Tab out of the open menu closes it; a press on another trigger does not (the click switches menus, keeping the morph) */
    nb.addEventListener("focusout", function (e) {
      var r = e.relatedTarget, t = NAV.id && S2.$("#navT-" + NAV.id);
      if (!t || !r || t.parentNode.contains(r) || (NAV.press && r.closest && r.closest(".nav-t"))) return;
      S2.nav.close(true);
    });
    nb.addEventListener("keydown", function (e) {
      var k = e.key, t = e.target.closest(".nav-t"), p = e.target.closest(".nav-p");
      if (t && k === "ArrowDown") { e.preventDefault(); S2.nav.open(t.dataset.g, "key"); var f = S2.$("a[href]", S2.$("#navP-" + t.dataset.g)); if (f) f.focus(); return; }
      if (!p || (k !== "ArrowDown" && k !== "ArrowUp" && k !== "Home" && k !== "End")) return;
      var all = S2.$$("a[href]", p), i = all.indexOf(document.activeElement); if (!all.length) return;
      e.preventDefault();
      if (k === "ArrowUp" && i <= 0) { var tr = S2.$("#navT-" + NAV.id); if (tr) tr.focus(); return; }
      all[k === "Home" ? 0 : k === "End" ? all.length - 1 : Math.min(all.length - 1, i + (k === "ArrowDown" ? 1 : -1))].focus();
    });
    S2.$("#navDim").addEventListener("click", function () { S2.nav.close(); });
    S2.$("#openSearch").addEventListener("click", S2.palette);
    /* v5.00 (f): opening the bell marks this member's notifications read, as the current site's CG.openBell does */
    var bell = S2.$("#openBell"); if (bell) bell.addEventListener("click", function () { S2.go("#/you?tab=inbox"); if (S2.notifs) S2.notifs.seen(); });
    document.dispatchEvent(new CustomEvent("s2:shell"));
  };
  /* Back returns to where you were (review 2026-10-19: Back from a player always landed at the top of the stats table).
     Each history entry carries a key; the scroll position is noted when the entry is left (hashchange, before the new
     page renders) and given back when Back or Forward returns to it. A new entry has no key yet, so it starts at the top. */
  var spots = {}, here = "";
  function entryKey() {
    var s = history.state; if (s && s.k) return s.k;
    var k = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    history.replaceState(Object.assign({}, s, { k: k }), "");
    return k;
  }
  /* a page that throws must not leave the previous page on screen under the new title: say so on the page and in the console */
  function failed(where, e) {
    console.error("S2 page " + where + " failed:", e);
    return '<section class="page-head reveal"><h1 class="t-large">This page could not be drawn.</h1><p class="t-sub">' + S2.esc(where) + " stopped with: <span class=\"mono\">" +
      S2.esc(e && e.message || e) + '</span>. The details are in the console.</p><p><a class="btn secondary" href="#/today">Back to Today</a></p></section>';
  }
  /* ---------- the page a person meets at a workspace that is not theirs (S2.route draws it for a workspace the role does
     not hold, js/pages/tradebuild.js for Team HQ's trade builder): a site page in the website type, saying who it is for and
     what to do next (review 2026-10-19: it was the old app layout, centered, with demo instructions in the copy). What a
     signed-in member reads and the real next step for them (audit 2026-11-09: a member already signed in read "opens ...
     after they sign in" and had nowhere to go but Today). v5.00 swap (i3f, 2026-11-25): moved here from the concept page's
     file, without its View as door (the role is who is signed in). A row: [title, headline, a guest's sentence, a member's
     sentence, the member's next step [label, href, form]] ---------- */
  /* QA functional 2026-11-25: Team HQ's lock kept inviting owner applications after they closed (the database refuses
     them), so its sentence and door follow S2.forms.ownerAppsOpen and name the season taking sign-ups; the Control Center's
     door is a case, the one way to the league office (a message goes to a member the sender picks) */
  function locks() {
    var F = S2.forms, s = F && F.regSeason(), sn = s ? s.name || "Season " + s.number : "", open = !!(F && F.ownerAppsOpen()), M = S2.M;
    var hq = open ? ["Team HQ is for a club's Owner, GM and AGM. " + sn + " owner applications are open to every member who signed up.", ["Apply to own a club", seasonNow(), "owner"]]
      : s && s.owner_app_deadline && M && M.etDate ? ["Team HQ is for a club's Owner, GM and AGM. " + sn + " owner applications closed on " + M.etDate(s.owner_app_deadline) + ".", ["See the " + sn + " calendar", S2.seasonHref(null, "#/season"), ""]]
      : ["Team HQ is for a club's Owner, GM and AGM.", ["See the season", S2.seasonHref(null, "#/season"), ""]];
    return {
      hq: ["Team HQ", "Front offices only", "Team HQ opens for a club's Owner, GM and AGM after they sign in.", hq[0], hq[1]],
      desk: ["Staff Desk", "Staff only", "The Staff Desk opens for the league's staff after they sign in.",
        "The Staff Desk is for the league's staff." + (sn ? " Staff applications for " + sn + " are open." : ""), ["Apply to join the staff", seasonNow(), "staff"]],
      control: ["Control Center", "Commissioners only", "The Control Center opens for the league's commissioners after they sign in.",
        "The Control Center is for the league's commissioners. To reach the league office, file a case.", ["File a case", "#/you?tab=inbox", "case"]]
    };
  }
  S2.page("locked", {
    title: function (r) { var L = locks(); return (L[r.name] || L.hq)[0]; }, tab: "", mode: "site",
    render: function (r) {
      var L = locks(), l = L[r.name] || L.hq, mem = S2.has("member"), next = l[4];
      return '<section class="hero ws-lock reveal"><span class="kicker">' + l[0] + '</span><h1 class="d-1">' + l[1] + '</h1><p class="lede-l">' + S2.esc(mem ? l[3] : l[2]) + "</p>" +
        '<div class="ws-lock-acts">' + (mem ? '<a class="btn site outline" href="' + S2.esc(next[1]) + '"' + (next[2] ? ' data-flow="' + next[2] + '"' : "") + ">" + S2.esc(next[0]) + "</a>" + '<a class="arrow" href="#/today"><span>Back to Today</span>' + S2.ic("chev") + "</a>"
          : '<a class="btn site discord" href="#/you">Join with Discord</a>') + "</div></section>";
    }
  });
  /* ---------- old addresses (commissioner, 2026-11-23, on the cutover list's "permanent aliases for old links": "go ahead
     and fix"). Discord posts, twelve database functions (staff_vote_create, declare_forfeit, notify_action_request,
     staff_briefing, availability_nudge_tick, notify_trade_proposed, post_night_recap, notify_suspension,
     notify_role_change, weekly_staff_report, undo_forfeit, report_ruling_mistake), the LFG bot (#/pickup-import) and about
     18,500 notifications point at the live site's addresses. ONE table maps each old address to its page here, so none of
     them falls through to Today. A key is the old route name, or name/arg for a page under it (hub/staffdesk); a value is
     the new address, or fn(r) -> address where it depends on the old address or the role (a case opens in the Staff
     Desk for staff and in the member's inbox for everyone else). A name this table does not hold and no page holds still
     lands on Today, as before. Test: tools/ui/aliases.test.cjs walks every entry, and tools/s2-site-modes.test.cjs checks
     every route the backend writes (jobs/, bot/, shared/, netlify/functions, sql/ and the database functions) resolves. ---------- */
  /* an alias whose page depends on a hat the reader holds (S2.has): yes for a holder, no for anyone else, each an address
     or fn(r) -> address that reads the old route. f.byRole marks it for S2.route, which holds it until the role is known.
     Health links 0 to 3 (2026-11-25): the old helper took no route, so every case and application link lost its id */
  function byHat(hat, yes, no) {
    var f = function (r) { var v = S2.has(hat) ? yes : no; return typeof v === "function" ? v(r) : v; };
    f.byRole = true; return f;
  }
  /* a case link keeps its case: the Staff Desk opens ?case=<id> (a staffer told about a case opened the first one in the
     list instead); the member's inbox has no address per case. The id-less old pages (complaints, archive) open the tab */
  var casesFor = byHat("staff", function (r) { var id = r && r.q && r.q.id; return "#/desk?tab=cases" + (id ? "&case=" + encodeURIComponent(id) : ""); }, "#/you?tab=inbox&show=cases");
  /* an application link (link_param "id=<uuid>&type=owner|staff|management|committee") opens that application's own desk
     page for staff; a type the desk does not know stays on the board rather than a not-found page */
  var APP_TYPES = /^(owner|staff|management|committee)$/;
  var appFor = byHat("staff", function (r) {
    var q = r && r.q || {};
    return q.id && APP_TYPES.test(q.type || "") ? "#/desk/application/" + encodeURIComponent(q.type + "-" + q.id) : "#/desk?tab=applications";
  }, "#/you?tab=applications");
  /* a club room's lineup and availability notices are read by every player on the club (club_notify): a front office plans
     the night in Team HQ, a player reads their own week there (Team HQ is front offices only, so it locked players out) */
  var lineupsFor = byHat("office", "#/hq?tab=lineups", "#/you?tab=week");
  function arg(base, list) { return function (r) { return r.arg ? base + encodeURIComponent(r.arg) : list; }; }
  S2.ALIASES = {
    /* the twelve database functions' links */
    "hub/staffdesk": "#/desk", "schedule": "#/games", "hub/complaint": casesFor, "hub/availability": "#/you?tab=week", "hub/tradehub": "#/hq?tab=trades",
    "hub/actions": "#/you?tab=inbox&show=cases", "matchup": arg("#/game/", "#/games"),
    /* the rest of the live hub: the member's own pages to You, the front office's to Team HQ, the staff's to the Staff Desk */
    "hub": "#/you", "hub/complaints": casesFor, "hub/archive": casesFor, "hub/officials": "#/desk", "hub/messages": "#/you?tab=inbox", "hub/notifications": "#/you?tab=inbox",
    "hub/settings": "#/you?tab=settings", "hub/application": appFor,
    "hub/draft": "#/draft", "hub/lineups": lineupsFor, "hub/lineup": lineupsFor, "hub/lines": lineupsFor, "hub/roster": "#/hq?tab=roster",
    "hub/clubrequests": "#/hq?tab=roster", "hub/management": "#/hq?tab=office", "hub/schedule": "#/hq?tab=nights", "hub/freeagents": "#/camp",
    "hub/statsmgr": "#/desk?tab=games", "hub/statsentry": "#/desk?tab=games", "hub/gamestats": "#/desk?tab=games",
    /* v5.00 swap (i2): the department desks bot/staff-alerts.mjs links (DESK_PATH). Season 2 has no departments (ruling
       2026-10-19): each desk's work is a Staff Desk tab and the draft room is the draft page. They used to fall through
       to You, which is wrong for staff.
       The Newsroom was NOT retired: the 2026-10-22 ruling that dropped the Media role kept it (power rankings and the
       night recap are automatic, stories are any staffer's), as the Staff Desk's Newsroom pane. So the old media desk link opens that
       pane for staff and the public news page for anyone else, as casesFor does (review fix: it had sent staff to #/news) */
    "hub/reviewboard": "#/desk?tab=applications", "hub/opsdesk": "#/desk?tab=games", "hub/draftroom": "#/draft", "hub/transdesk": "#/desk?tab=transactions",
    "hub/community": "#/desk?tab=cases", "hub/newsroom": byHat("staff", "#/desk?tab=newsroom", "#/news"),
    /* the live public pages, merged here (the concept's "Where things go" list) */
    "home": "#/today", "team": function (r) { return r.arg ? "#/club/" + encodeURIComponent(r.arg.toUpperCase()) : "#/clubs"; }, "teams": "#/clubs", "awards": "#/stats?tab=awards",
    "players": "#/stats?tab=players", "rankings": "#/standings?view=power", "register": "#/season", "owner": "#/season", "staffapply": "#/season",
    "signin": "#/you", "messages": "#/you?tab=inbox", "search": "#/today", "brand": "#/today", "legal": "#/terms",
    /* a classic story link carries the bare news id; a story's address here is n-<id> (js/pages/office.js), so the bare id
       always said Story not found (health links 2, 2026-11-25). Finding a story from another season is office.js's */
    "article": arg("#/news/n-", "#/news"),
    /* a pickup game's box score (the classic CG.ROUTES.pickup, linked from profiles' Pickup tab and the LFG bot's posts)
       opens that game on the pickups page (js/pages/pickups.js S2.pickups.href); a bare #/pickup the list (g5's hand-over,
       i3f 2026-11-25; it used to land on Games) */
    "pickup": arg("#/pickups/", "#/pickups"),
    /* forums are retired (commissioner, 2026-11-23): their old links land on Today */
    "forums": "#/today", "thread": "#/today", "forum": "#/today",
    /* the live Control Center's twelve tabs, folded into Control Center and the Staff Desk */
    "admin": "#/control", "admin/automations": "#/control?tab=system", "admin/audit": "#/control?tab=system", "admin/preseason": "#/control?tab=setup",
    "admin/seasons": "#/control?tab=setup", "admin/schedule": "#/control?tab=setup", "admin/codes": "#/control?tab=tonight", "admin/teams": "#/control?tab=clubs",
    "admin/clubs": "#/control?tab=clubs", "admin/users": "#/control?tab=staff", "admin/complaints": "#/desk?tab=cases", "admin/eastats": "#/desk?tab=games",
    "admin/results": "#/desk?tab=games", "admin/players": "#/desk?tab=people", "admin/awards": "#/stats?tab=awards"
  };
  /* -> the new address for an old one, or null when the address is already a page here */
  /* -> { hit, r } for an old address (hit: the table's value), or null */
  function aliasOf(hash) {
    var h = String(hash || "").replace(/^#?\/?/, ""), parts = h.split("?"), path = parts[0].split("/"), q = S2.query(parts[1]);
    var r = { name: path[0] || "", arg: path[1] || "", sub: path[2] || "", q: q };
    if (!r.name || S2.pages[r.name]) return null;
    var hit = S2.ALIASES[r.name + "/" + r.arg];
    if (hit) r = { name: r.name, arg: r.sub, sub: "", q: q };   /* hub/lineup?game=..: what follows the page name is its own argument */
    else hit = S2.ALIASES[r.name] || (r.name === "hub" ? "#/you" : r.name === "admin" ? "#/control" : null);
    return hit ? { hit: hit, r: r } : null;
  }
  S2.alias = function (hash) { var a = aliasOf(hash); return a ? (typeof a.hit === "function" ? a.hit(a.r) : a.hit) : null; };
  /* a notification row names a view and a parameter (public.notifications link_view and link_param), not an address. The
     live site turns them into addresses in CG.notifRoute (src/live/part_live.js, read 2026-11-23 from origin/main); this
     is that switch word for word, ending in the alias table, so a bell written before the switch opens the same thing */
  /* v5.00 (f, 2026-11-24), four views the switch above got wrong or never had, read from production's notifications:
     - discord (378 rows, "sign-up withdrawn" after leaving the server): the live site opens the server invite
       (site_config.discord_invite, in the league read's config); without one, You, which holds the Discord door here;
     - teams (12 rows, owner_remove_manager's notice to commissioners that a club's seat is empty): the Control Center's
       Clubs tab, where the seat is filled; both sites sent it to the default page;
     - manager (5,251 rows) carries the Team HQ page it is about (roster, lines, management, freeagents); the live site
       dropped it and opened the dashboard, so here it opens that tab, and Team HQ when there is none;
     - hub with "schedule" (27 rows, a game moved): the schedule, not the dashboard. */
  S2.notifRoute = function (view, param) {
    var p = String(param == null ? "" : param).trim();
    if (view === "discord") { var inv = S2.siteConfig("discord_invite"); return /^https:\/\//.test(inv || "") ? inv : "#/you"; }
    if (view === "teams") return S2.alias("#/admin/teams");
    if (view === "manager") return S2.ALIASES["hub/" + p] ? S2.alias("#/hub/" + p) : "#/hq";
    if (view === "hub" && p === "schedule") return S2.alias("#/schedule");
    var isId = S2.isUuid(p), isQs = p.indexOf("id=") === 0;
    var caseUrl = isId ? "#/hub/complaint?id=" + encodeURIComponent(p) : null, appUrl = isQs ? "#/hub/application?" + p : null;
    var old = ({
      team: p ? "#/team/" + encodeURIComponent(p) : "#/teams", game: p ? "#/matchup/" + encodeURIComponent(p) : "#/schedule", draft: "#/hub/draft",
      availability: "#/hub/availability", lineups: "#/hub/lineups", lineup: p ? "#/hub/lineup?game=" + encodeURIComponent(p) : "#/hub/lineups", manager: "#/hub",
      mgmtapprovals: "#/hub/management",
      /* a trade notice (completed, reversed): the league's trades, public to every recipient (the live site opened its home,
         which says nothing about the trade; health links 4, 2026-11-25) */
      transactions: "#/clubs?view=moves&kind=trade", automations: "#/admin/automations", preseason: "#/admin/preseason", rulebook: "#/rulebook",
      stafftasks: "#/hub/staffdesk", actions: caseUrl || "#/hub/complaints", complaints: caseUrl || "#/hub/complaints",
      admin: caseUrl || (p ? "#/admin/" + encodeURIComponent(p) : "#/hub/staffdesk"), application: appUrl || "#/hub/staffdesk", staffdesk: appUrl || "#/hub/staffdesk",
      users: appUrl || "#/admin/users", hub: p === "staffdesk" ? "#/hub/staffdesk" : "#/hub", offers: "#/hub", ownerapp: "#/owner", staffapp: "#/staffapply",
      forum: isId ? "#/thread?id=" + encodeURIComponent(p) : "#/forums"
    })[view] || "#/hub";
    return S2.alias(old) || old;
  };
  /* one value from site_config (the league read's config.site), or null when this copy has none (the demo, a partial load) */
  S2.siteConfig = function (key) { var c = S2.M && S2.M.config, v = c && c.site ? c.site[key] : null; return v == null ? null : typeof v === "string" ? v : String(v); };
  /* every link_view a notification can carry: the 23 kinds production holds (read-only SELECT, 2026-11-24 evening: 17,251
     rows with a link_view, plus 1,222 with none) and the switch's other cases. v5.00 swap (i2): "teams" joins
     (owner_remove_manager's 12 rows) */
  S2.NOTIF_VIEWS = ["team", "game", "draft", "availability", "lineups", "lineup", "manager", "mgmtapprovals", "transactions", "automations", "preseason", "rulebook",
    "stafftasks", "actions", "complaints", "admin", "application", "staffdesk", "users", "hub", "offers", "ownerapp", "staffapp", "forum", "discord", "teams"];
  /* v5.00 (f): what a Discord sign-in sends back. Supabase answers with a bare fragment, #access_token=... on success or
     #error=...&error_description=... on failure, that is not a route. -> null, { pending: true } or { error, desc } */
  S2.authFragment = function (hash) {
    var h = String(hash || "");
    if (!/^#(error|access_token|provider_token|code)=/.test(h) && h.indexOf("error_description=") < 0) return null;
    var f = new URLSearchParams(h.slice(1));
    if (f.get("error") || f.get("error_description"))
      return { error: f.get("error_code") || f.get("error") || "sign_in_failed", desc: f.get("error_description") || "Discord sign-in did not complete." };
    return { pending: true };
  };
  /* the ONE way a page names itself (QA round 2, 2026-11-25: the router, the Staff Desk's and News's in-place repaints each
     wrote document.title, and You and Team HQ named a tab with no section): the tab and history title "<page> · <section>
     · CGHL" and the bar's collapsed title, from the parts given, page first. An empty part drops out, so a page with no
     section reads "<page> · CGHL" and a page with no name "CGHL" (the router once wrote "CGHL · CGHL") */
  S2.setTitle = function () {
    var t = Array.prototype.slice.call(arguments).filter(Boolean).join(" · ");
    document.title = t ? t + " · CGHL" : "CGHL";
    var it = S2.$("#inlineTitle"); if (it) it.textContent = t;
    return t;
  };
  /* the page head while the router is about to move on: no motion and no wheel, since what follows (a session landing, or
     the next page's own boot screen) shows its own */
  function opening(head, line) {
    var page = S2.$("#page"); if (!page) return;
    page.innerHTML = '<section class="page-head"><h1 class="t-large">' + S2.esc(head || "Opening the link") + '</h1><p class="t-sub">' +
      S2.esc(line || "Checking who is signed in. This page moves on by itself.") + "</p></section>";
    S2.setTitle("Opening");
  }
  /* the Season page is the current season's: its title, its doors and its sign-up count are that season's (the Season
     menu's own design, where a finished season's archive opens on its standings). A bare "#/season" keeps whatever
     ?season= the address names, so from an archive the page drew Season 2's doors over Season 1's data and said "0
     members are in so far" (health crawl 1, 2026-11-25; second pass: you.js, bidding.js, today.js and the search palette
     still link it bare, and so might any later page, so the router owns the rule instead of each link). -> the current
     season's address, or null. Only an address that names a season is moved, so the move cannot repeat: the address it
     goes to names none */
  function seasonPageMove(r) {
    var named = S2.load && S2.load.season != null, cur = currentSeason(), view = S2.M && S2.M.view;
    if (r.name !== "season" || !named || (cur && view && view.season === cur.number)) return null;
    return { to: S2.seasonHref(null, location.hash), name: cur ? cur.name || "Season " + cur.number : "the current season" };
  }
  function completing() {
    var page = S2.$("#page"); if (!page) return;
    page.innerHTML = '<section class="page-head"><h1 class="t-large">Completing sign-in</h1><p class="t-sub">Finishing up with Discord. This page moves on by itself.</p></section>';
    S2.setTitle("Signing in");
  }
  /* soft: repaint in place and keep the scroll; restore: a history move, so give back the entry's scroll position */
  S2.route = function (soft, restore) {
    /* v5.00 (f, 2026-11-24): the sign-in intercept, the twin of the current site's CG.router (memory
       discord-account-switching, 2026-08-11: the router once treated Supabase's #error= fragment as a route, the error
       evaporated, and the cached OLD session survived looking like a wrong-account sign-in; "NEVER remove this
       intercept"). An error is said in Supabase's own words over the You page, which holds the Discord door. A success
       fragment stays in the address, because supabase-js reads it after this first paint and clears it itself; until the
       session lands the page says so, and then S2._authReturn (js/live.js) sends the reader back where they started. */
    if (S2.LIVE) {
      var oa = S2.authFragment(location.hash);
      if (oa && oa.error) { S2._oauthErr = oa; history.replaceState(history.state, "", location.pathname + location.search + "#/you"); }
      else if (oa) { S2._oauthPending = true; completing(); return; }
      else if (S2._authReturn && !/^#\/./.test(location.hash)) { history.replaceState(history.state, "", S2._authReturn); S2._authReturn = null; }
    }
    /* an old live address becomes its page here, in place, so Back never returns to the old one (S2.ALIASES). One whose
       page depends on the role waits while the role is only the first paint's guess (i3f, 2026-11-25: a staffer's
       #/hub/complaint link from Discord opened their own inbox, resolved for the guessed member before the session
       landed); js/live.js routes again once it has, and the address is resolved then */
    var old = aliasOf(location.hash);
    if (old && old.hit.byRole && S2.roleGuessed) { opening(); return; }
    var to = S2.alias(location.hash); if (to) history.replaceState(history.state, "", to);
    var r = S2.parse(), def = S2.pages[r.name] || S2.pages.today;
    var sm = seasonPageMove(r);
    if (sm) { opening("Opening " + sm.name, "The season page is the current season's. This page moves on by itself."); location.replace(sm.to); return; }
    /* an address no page and no alias holds lands on Today and says so once (QA visual 2026-11-25: a mistyped or stale
       link silently drew Today with the bad address left in the bar) */
    if (!S2.pages[r.name] && r.name !== "today") {
      history.replaceState(history.state, "", location.pathname + location.search + "#/today"); r = S2.parse();
      if (!soft) S2.toast("That page does not exist, so here is Today.");
    }
    var ws = S2.WORKSPACES.filter(function (w) { return w[0] === r.name; })[0]; if (ws && !S2.has(ws[2])) def = S2.pages.locked || def;
    var page = S2.$("#page"), key = entryKey(), y = soft ? window.scrollY : restore ? spots[key] || 0 : 0;
    here = key;
    /* wayfinding (header v2): each bar item, phone row and the avatar lists the routes it holds (data-here, from S2.NAV),
       so a deep page lights the menu it lives under. Swept inside the header and the menu only: pages keep their own
       data-tab (control.js, hq.js). A menu trigger is current, not a page, so it says aria-current="true" */
    var at = def === S2.pages.locked ? "locked" : S2.pages[r.name] ? r.name : "today";   /* a locked workspace is not the viewer's place */
    S2.$$("#navbar [data-here], #siteMenu [data-here]").forEach(function (el) {
      if ((" " + el.dataset.here + " ").indexOf(" " + at + " ") >= 0) el.setAttribute("aria-current", el.tagName === "A" ? "page" : "true"); else el.removeAttribute("aria-current");
    });
    /* public pages are a white website; workspaces keep the gray app canvas (tokens.css, data-mode) */
    document.documentElement.setAttribute("data-mode", def.mode || (/^(hq|desk|control)$/.test(r.name) ? "app" : "site"));
    syncBar();
    if (document.documentElement.classList.contains("menu-open")) S2.menu(false);
    S2.nav.close(true); S2.nav.sync();
    var title, html;
    try { title = typeof def.title === "function" ? def.title(r) : def.title || ""; html = def.render(r); }
    catch (e) { title = "Page error"; html = failed("render", e); def = { }; }
    page.innerHTML = html;
    S2.setTitle(title);
    if (def.after) { try { def.after(page, r); } catch (e) { console.error("S2 page after() failed:", e); S2.toast("Part of this page did not load. The details are in the console.", "err"); } }
    S2.charts && S2.charts.hydrate(page);
    /* a page whose last element (at any depth) is a full-width band runs straight into the footer, no white seam */
    var tail = page, endsBand = false;
    while (tail && tail.lastElementChild) { tail = tail.lastElementChild; if (tail.classList.contains("band")) { endsBand = true; break; } }
    page.classList.toggle("ends-band", endsBand);
    if (soft) S2.settle(page); else { S2.reveal(page); S2.countUp(page); }
    S2.paintChrome();
    window.scrollTo(0, y);
    if (!soft) page.focus({ preventScroll: true });
    if (S2._oauthErr && S2.showAuthError) { var oe = S2._oauthErr; S2._oauthErr = null; S2.showAuthError(oe); }
  };
  /* large title collapses into the bar as it scrolls under (iOS) */
  S2.onScroll = function () {
    var nb = S2.$("#navbar"); if (!nb) return;
    var lt = S2.$(".page-head .t-large, .page-head .t-hero, .page-head .d-1, .page-head .d-hero, .hero .d-hero, .hero .d-1"), y = window.scrollY;
    nb.classList.toggle("scrolled", y > 4);
    nb.classList.toggle("titled", !!lt && lt.getBoundingClientRect().bottom < 60);
    if (NAV.id && Math.abs(y - NAV.y) > 24) S2.nav.close();   /* reading on: the menu gets out of the way */
  };

  /* ---------- command palette: keyboard first, so no open animation. A combobox: the input keeps focus while the arrow
     keys move the selection, which screen readers follow through aria-activedescendant ---------- */
  S2.palette = function () {
    if (S2.$(".palette")) return;
    var prev = document.activeElement, scrim = document.createElement("div"), el = document.createElement("div");
    scrim.className = "scrim on"; scrim.style.transition = "none"; el.className = "palette";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Search");
    /* phones (review 2026-10-19): a visible Cancel (with the keyboard up, the scrim strip above the panel was the only way
       out), a return key that says Go, and no solid "selected" fill on the first result until an arrow key moves the
       selection (.kb), because on touch it read as already pressed */
    el.innerHTML = '<div class="pal-h"><input type="search" enterkeyhint="go" role="combobox" aria-expanded="true" aria-controls="palRes" aria-autocomplete="list" placeholder="Players, clubs, games, rules, tools" aria-label="Search" autocomplete="off" spellcheck="false">' +
      '<button type="button" class="btn plain pal-cancel" data-close>Cancel</button></div>' +
      '<div class="res" id="palRes" role="listbox" aria-label="Results"></div>';
    document.body.appendChild(scrim); document.body.appendChild(el);
    var inp = S2.$("input", el), res = S2.$(".res", el), sel = 0, items = [], layer = { el: el, close: close };
    S2.$("[data-close]", el).addEventListener("click", close);
    function close() { if (vv) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); } S2.layer.pop(layer); el.remove(); scrim.remove(); if (prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true }); }
    /* the phone keyboard (QA phone 2026-11-25): vh does not shrink for it, so the results list is sized from its own top to
       what the keyboard leaves of the screen, and every result can be scrolled into view while typing */
    var vv = window.visualViewport && matchMedia("(pointer: coarse)").matches ? window.visualViewport : null;
    function fit() { res.style.maxHeight = Math.max(120, Math.round(vv.offsetTop + vv.height - res.getBoundingClientRect().top - 8)) + "px"; }
    /* the results come grouped from S2.search (js/search.js: role-gated, the rulebook included, matched words marked);
       the arrow keys walk one flat list across the groups */
    function draw() {
      if (!S2.search) { console.error("S2.palette: js/search.js is not loaded"); res.innerHTML = '<p class="t-sub pal-none">Search did not load. The console names the error.</p>'; return; }
      var groups = S2.search(inp.value.trim()), n = 0;
      items = []; groups.forEach(function (g) { g.items.forEach(function (x) { items.push(x); }); });
      sel = Math.min(sel, Math.max(0, items.length - 1));
      res.innerHTML = items.length ? groups.map(function (g) {
        return '<div class="pal-g" role="group" aria-labelledby="palG-' + g.g + '"><p class="pal-gh" id="palG-' + g.g + '" role="presentation">' + S2.esc(g.label) + "</p>" + g.items.map(function (x) {
          var i = n++;
          return '<button role="option" id="palO' + i + '" tabindex="-1" aria-selected="' + (i === sel) + '" data-i="' + i + '">' + S2.ic(x.icon || "search") + '<span class="grow"><span class="pal-l">' + x.html + '</span><span class="t-foot pal-s">' + x.sub + "</span></span></button>";
        }).join("") + "</div>";
      }).join("") : '<p class="t-sub pal-none">Nothing matches “' + S2.esc(inp.value) + '”.</p>';
      inp.setAttribute("aria-expanded", String(items.length > 0));
      var cur = S2.$('[aria-selected="true"]', res);
      if (!cur) { inp.removeAttribute("aria-activedescendant"); return; }
      inp.setAttribute("aria-activedescendant", cur.id);
      /* keep the selection in view inside the list only (scrollIntoView could also move the locked page) */
      var top = cur.offsetTop, bot = top + cur.offsetHeight;
      if (top < res.scrollTop) res.scrollTop = top - 6; else if (bot > res.scrollTop + res.clientHeight) res.scrollTop = bot - res.clientHeight + 6;
    }
    function pick(i) { var x = items[i]; if (!x) return; close(); S2.go(x.href); }
    inp.addEventListener("input", function () { sel = 0; draw(); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { el.classList.add("kb"); sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { el.classList.add("kb"); sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      /* the Enter is the palette's: pick() hands focus back to the opener (the header's search button) inside this keydown,
         and an Enter left to its default then pressed that button, so the palette opened again, empty, over the result
         (health crawl 4, 2026-11-25). A composing Enter (an input method's) only confirms the characters */
      else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); pick(sel); }
    });
    res.addEventListener("click", function (e) { var b = e.target.closest("[data-i]"); if (b) pick(+b.dataset.i); });
    scrim.addEventListener("click", close);
    S2.layer.push(layer); draw(); inp.focus();
    if (vv) { vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); fit(); }
  };

  /* ONE ordered Escape, registered once (S2.shell runs again on every role switch, and a listener added there piled up
     one more copy per switch, review 2026-10-20): the top layer only, else the open header menu, else the phone menu.
     Two listeners let one Escape close the palette AND the phone menu under it (header v2). #menuBtn and the triggers are
     redrawn by each shell, so they are looked up each time */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !e.isComposing) {
      if (layers.length) { e.preventDefault(); e.stopImmediatePropagation(); layers[layers.length - 1].close(); return; }
      if (NAV.id) {
        e.preventDefault();
        var t = S2.$("#navT-" + NAV.id), inside = t && t.parentNode.contains(document.activeElement);
        S2.nav.close(true); if (inside) t.focus({ preventScroll: true });   /* never a focus ring on a trigger the reader never touched */
        return;
      }
      if (document.documentElement.classList.contains("menu-open")) { S2.menu(false); var b = S2.$("#menuBtn"); if (b) b.focus(); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      /* the palette hands focus back to where it was opened: the trigger, never a link in a panel about to hide */
      if (NAV.id) { var tk = S2.$("#navT-" + NAV.id); if (tk && tk.parentNode.contains(document.activeElement)) tk.focus({ preventScroll: true }); S2.nav.close(true); }
      S2.palette();
    }
  });
  /* crossing the bar's width closes whichever menu belongs to the other side (the phone menu stayed open and scroll
     locked when a window widened past 1180); a resize moves the panel's edge, so an open desktop menu closes too */
  matchMedia("(min-width: 1180px)").addEventListener("change", function () { S2.nav.close(true); if (document.documentElement.classList.contains("menu-open")) S2.menu(false); });
  window.addEventListener("resize", function () { if (NAV.id) S2.nav.close(true); });
  window.addEventListener("scroll", S2.onScroll, { passive: true });
  /* a sheet belongs to the page it opened on: leaving that page (Back, a swipe back, a link) closes it, or it stayed
     modal over the next page with #app inert and its buttons acting on the page that was left (review 2026-10-19). Keyed
     on the route NAME, so in-page hash updates and the desk's member record (#/desk/person/<id>) keep their sheets */
  window.addEventListener("hashchange", function () {
    if (here) spots[here] = window.scrollY;
    var n = S2.parse().name;
    layers.slice().forEach(function (l) { if (l.at !== n) l.close(); });
    S2.route(false, true);
  });
  S2.boot = function () {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    toastRoot(); S2.applyLook(); S2.shell(); S2.route(); S2.onScroll();
    document.dispatchEvent(new CustomEvent("s2:boot"));   /* the first page is drawn */
  };
})();
