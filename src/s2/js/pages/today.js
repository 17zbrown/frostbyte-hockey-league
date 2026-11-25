/* Today, Games and the Game Center (#/today, #/games, #/game/<id>). Owned by the today builder.
   League website v2 (commissioner, 2026-10-19: "I love the way all the stats are presented, but I feel like the design
   feels too much like a dashboard and not a League Website"; references liftfoils.com and juventus.com; imagery is "Type
   and crests only"). The stat pieces stay (the map, standings marks, last-five marks, the tale of the tape, the box
   score); the frame around them changed: statement heroes, ink match-center bands with big condensed scores, editorial
   sections with arrow links, Lift-style lineups for the things a reader chooses between. No demo notes in page copy.
   Rulings this file follows (data/understand.md):
   - 2026-10-16: Today is map first, EXCEPT while games are active; then the matchups go on top and the map follows.
   - 2026-10-16: the game band is a flat ink band of SOLID tiles, ordered live, up next, earlier finals; a game past its
     window with no final reads "Result pending" in plain gray, never warning amber. A live tile shows its status, not a
     score, because EA data arrives after the game ends.
   - "Live" has ONE definition, the model's M.gameState (CG.GAME_LIVE_MS, 30 minutes from puck drop). No second clock.
   - Box scores are keyed by club code (box[g.home], never box.home); every line counts, both roles.
   - 2026-10-19, the open concept ("The concept should be fully open for all buttons to play with so I can figure out if
     I need to make changes or not"): no control here is disabled or a toast. The rail arrows still wrap at the ends.
     v5.00 swap (i3b, 2026-11-25): the commissioner wants the new site to replace chelgamingleague.com with every tool
     native, so this file runs only its real path. Gone with the demo: the sample game night and its clock, the pretend
     Watch stream, the sample lineups and their Show anyway, the demo's transactions and Newsroom stories, the scene
     switch in the dock and ?state=. The page's scene is the season's own (autoState), the clocks are the reader's, and
     the Game Center's lineups are the two clubs' filed sheets, read once they lock (game_lineups).
   Everything printed passes through S2.esc. */
(function () {
  "use strict";
  var S2 = window.S2, M = S2.M, esc = S2.esc;
  if (!M) return;   /* the model failed to load; core's router says so */

  var ST = {};
  M.standings("league").forEach(function (r) { ST[r.code] = r; });

  /* ---------- small helpers ---------- */
  var NUMW = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  function words(n) { return NUMW[n] || S2.fmt(n); }
  function cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function list(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  var ord = S2.ord;   /* one ordinal for every page (core) */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function rec(code) { var r = ST[code]; return r ? r.w + "-" + r.l + "-" + r.otl : "0-0-0"; }
  function divPlace(code) { var r = ST[code]; return r ? S2.ord(r.rank) + " in the " + r.division : ""; }
  function teamName(code) { var t = M.team(code); return t ? t.name : code; }
  function full(code) { var t = M.team(code); return t ? t.full : code; }
  function city(code) { var t = M.team(code); return t ? t.city : code; }
  function weekday(iso) { return M.etLong(iso).split(",")[0]; }
  /* a club color from the database reaches CSS only as a plain hex, never as free text inside a style attribute */
  function clubColor(code) { var t = M.team(code), c = t && t.color; return /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : ""; }
  /* a unit never breaks across lines: "9:00 PM ET", "Week 5", "12 games" are joined with no-break spaces */
  function nb(s) { return String(s).replace(/ /g, " "); }
  /* a score is one word to the line breaker ("4-1" never splits after the hyphen); returns HTML. A hyphen, as the news,
     the awards and the league copy write it (review 2026-11-23: the house bans en dashes, and the site wrote scores two ways) */
  function scoreSpan(a, b) { return '<span class="td-nw">' + esc(a) + "-" + esc(b) + "</span>"; }
  /* a countdown runs on the reader's clock; the page's scene reads the model's (M.now, the moment the league was read),
     and the pulse repaints it when the league changes */
  function now() { return Date.now(); }
  function split(ms) { var s = Math.max(0, Math.floor(ms / 1000)); return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 }; }
  function untilShort(ms) {
    if (ms <= 0) return "now";
    var p = split(ms);
    return "in " + (p.d ? p.d + "d " + p.h + "h" : p.h ? p.h + "h " + pad2(p.m) + "m" : p.m ? p.m + " min" : p.s + " s");
  }
  function untilBig(ms) {
    var p = split(ms), u = function (n, unit) { return '<span class="td-cd-n">' + n + '</span><span class="td-cd-u">' + unit + "</span>"; };
    if (ms <= 0) return u("0", "min");
    return p.d ? u(p.d, "d") + u(pad2(p.h), "h") + u(pad2(p.m), "m") : p.h ? u(p.h, "h") + u(pad2(p.m), "m") + u(pad2(p.s), "s") : u(p.m, "m") + u(pad2(p.s), "s");
  }
  /* league calendar days (Eastern), so "Fri, Oct 30" is 11 days from Mon, Oct 19 whatever the hour; `from` defaults to
     the moment the league was read */
  function daysUntil(iso, from) { return Math.max(0, Math.round((Date.parse(M.etDay(iso)) - Date.parse(M.etDay(from || M.generated))) / 864e5)); }
  /* replace the hash without a hashchange, so a filter or toggle repaints in place instead of re-routing the page */
  function setQuery(name, q) {
    var keys = Object.keys(q).filter(function (k) { return q[k] != null && q[k] !== ""; });
    var h = "#/" + name + (keys.length ? "?" + keys.map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(q[k]); }).join("&") : "");
    try { history.replaceState(null, "", h); } catch (e) { /* file:// in some browsers: the view still changes, the address does not */ }
  }
  function swapIn(el) {   /* a changed view arrives with a short rise; under reduced motion today.css turns it into a 200 ms cross-fade */
    el.classList.remove("td-swap"); void el.offsetWidth; el.classList.add("td-swap");
  }
  /* Last five, OLDEST FIRST, in Standings' own marks (review 2026-10-19: Today read newest first in round dots, so
     Vancouver's W L W W W on #/standings read W W W L W here). The model's last5 is newest first, so it is reversed.
     shortcut: a copy of league.js form() and its .lg-form marks; move both into one kit S2.form() when the kit takes it */
  function lastFive(r) {
    var a = ((r && r.last5) || []).slice().reverse(), name = { W: "Win", L: "Loss", OT: "Overtime loss" };
    return '<span class="lg-form" role="img" aria-label="Last five, oldest first: ' + esc(a.map(function (x) { return name[x] || x; }).join(", ")) + '">' +
      a.map(function (x) { return '<i class="lg-f-' + (x === "W" ? "w" : x === "L" ? "l" : "o") + '"></i>'; }).join("") + "</span>";
  }
  /* website furniture shared by every section: the arrow link (Juventus "ALL CONTENT ->") and the section head */
  function arrow(href, text) { return '<a class="arrow" href="' + esc(href) + '"><span>' + esc(text) + "</span>" + S2.ic("chev") + "</a>"; }
  /* o.hh: a headline already built as HTML from escaped parts, so a score pair rides in a no-break span (scoreSpan) */
  /* an ink band scopes the dark tokens to itself and keeps following the chosen finish (S2.applyLook, data-look-scope) */
  /* a long gamertag (no spaces to wrap on) takes a smaller cut of the display type instead of breaking mid-name */
  function tagCls(tag) { var t = String(tag || ""), w = Math.max.apply(null, t.split(" ").map(function (x) { return x.length; })); return w > 15 ? " xlong" : w > 10 ? " long" : ""; }
  function look() { return ' data-theme="dark" data-look-scope data-finish="' + esc(S2.state.finish) + '"'; }
  /* the Juventus date block: weekday, a big day numeral, month */
  function dateBlock(iso) {
    var p = M.etFull(iso).split(", "), md = (p[1] || "").split(" ");   /* "Wed, Oct 21, 2026" */
    return '<span class="td-date"><span class="wd">' + esc(p[0]) + '</span><span class="dd d-num">' + esc(md[1]) + '</span><span class="mo">' + esc(md[0]) + "</span></span>";
  }

  /* ---------- one ticking clock per page: countdowns and "minutes in" read data attributes ---------- */
  var TICK = 0;
  function tick(root) {
    clearInterval(TICK);
    function paint() {
      if (!root.isConnected) { clearInterval(TICK); return; }
      S2.$$("[data-until]", root).forEach(function (el) {
        var ms = Date.parse(el.dataset.until) - now();
        el.innerHTML = el.dataset.fmt === "big" ? untilBig(ms) : esc(untilShort(ms));
      });
    }
    paint(); TICK = setInterval(paint, 1000);
  }

  /* ======================================================================================================
     THE LEAGUE MAP: a dot-matrix North America (Albers equal-area conic, the projection US atlases use), the eight
     clubs pinned to their home cities. Dots darken near a club so the eye finds the league before reading a label.
     Coastline is simplified by hand (about 30 km at this scale); lakes are holes so Detroit reads between them.
     ====================================================================================================== */
  var LAND = [[60,-141],[59.5,-139.5],[58.4,-136.8],[57,-135.5],[56,-134],[55,-132.5],[54.4,-130.8],[53.5,-130],[52.5,-128.8],[51.5,-127.9],[50.8,-127.9],[50,-127.3],
    [49.2,-126.2],[48.6,-124.8],[48.38,-124.7],[47.9,-124.65],[47,-124.2],[46.25,-124.05],[45,-123.95],[44,-124.12],[43,-124.5],[42,-124.25],[41,-124.1],[40.4,-124.4],
    [39.5,-123.8],[38.3,-123.05],[37.8,-122.5],[37.2,-122.4],[36.6,-121.9],[36,-121.5],[35.2,-120.9],[34.45,-120.45],[34.4,-119.6],[34,-118.5],[33.7,-118.2],[33.2,-117.4],
    [32.55,-117.12],[31.8,-116.7],[30.4,-115.95],[29.3,-114.9],[28,-114.15],[27,-113.2],[26,-112.3],[24.8,-111.6],[24,-110.6],[22.9,-109.95],[23.6,-109.45],[24.3,-110.3],
    [25.5,-111],[26.8,-111.9],[28,-112.8],[29.5,-113.6],[31.3,-114.3],[31.7,-114.7],[30.6,-113.1],[29.2,-112.4],[27.9,-110.9],[26.8,-109.6],[25.6,-109.1],[24.2,-107.6],
    [23.2,-106.4],[21.6,-105.3],[20.6,-105.3],[19.4,-104.9],[18.3,-103.4],[17.6,-101.6],[16.8,-99.9],[15.9,-97.5],[15.7,-96.2],[16.2,-94.6],[15.4,-93],[14.6,-92.2],
    [15.7,-88.4],[17.5,-88.2],[18.5,-87.8],[20.2,-87.4],[21.5,-86.9],[21.4,-88.2],[21.2,-89.6],[21,-90.4],[20,-90.5],[19,-91],[18.6,-91.8],[18.4,-93.2],[18.2,-94.4],
    [18.7,-95.4],[19.2,-96.1],[20.3,-96.9],[21.5,-97.4],[22.6,-97.8],[24,-97.7],[25,-97.5],[25.95,-97.15],[26.6,-97.35],[27.6,-97.25],[28.3,-96.5],[28.7,-95.7],[29.3,-94.8],
    [29.7,-94],[29.75,-93.3],[29.55,-92.3],[29.6,-91.5],[29.15,-90.9],[29.05,-90.1],[29.15,-89.3],[29.6,-89.6],[30.2,-89.4],[30.35,-88.6],[30.25,-87.6],[30.4,-86.6],
    [30.1,-85.7],[29.65,-85.1],[29.9,-84.3],[29.6,-83.6],[29,-83],[28.2,-82.75],[27.7,-82.7],[27,-82.3],[26.4,-81.9],[25.85,-81.6],[25.2,-81.1],[25.15,-80.6],[25.4,-80.3],
    [25.8,-80.15],[26.7,-80.04],[27.6,-80.35],[28.45,-80.55],[29.2,-81],[30.3,-81.4],[31,-81.4],[31.8,-81],[32.4,-80.6],[32.8,-79.9],[33.4,-79.2],[33.85,-78.5],[34.2,-77.8],
    [34.65,-76.75],[35,-76.2],[35.25,-75.5],[35.9,-75.6],[36.6,-75.9],[37.1,-75.95],[37.6,-75.6],[38.3,-75.1],[38.8,-75.1],[39,-74.85],[39.4,-74.4],[40,-74.05],[40.5,-74],
    [40.6,-73],[41.05,-71.9],[41.45,-71.3],[41.5,-71],[41.55,-70.6],[41.7,-70],[42.05,-70.05],[42.3,-70.95],[42.6,-70.65],[43,-70.75],[43.6,-70.2],[43.9,-69.5],[44.2,-68.9],
    [44.4,-68],[44.6,-67.2],[44.85,-66.95],[45.25,-66.1],[45.75,-64.4],[45.1,-64.9],[44.5,-65.8],[43.8,-66.15],[43.4,-65.6],[44,-64.7],[44.45,-63.9],[44.7,-63.2],[45.1,-61.9],
    [45.3,-61],[45.7,-61.4],[45.65,-62.6],[45.8,-63.7],[46.2,-64.4],[46.6,-64.7],[47.1,-64.85],[47.7,-64.9],[47.95,-65.6],[48.1,-66.4],[48.4,-64.5],[48.85,-64.2],[50.1,-66.4],
    [50.2,-63.5],[50.3,-61],[50.5,-59.5],[51.4,-57.2],[52.3,-55.7],[54.5,-57.4],[55.4,-59.8],[56.5,-61.4],[58,-62.5],[59.3,-63.6],[60.4,-64.6],[61.5,-70],[62,-77.5],
    [60.5,-77.7],[58.6,-77.3],[57.3,-76.8],[56.4,-76.6],[55.3,-77.5],[54.6,-79.4],[53.4,-78.95],[52.2,-78.6],[51.4,-79.2],[51.2,-79.8],[51.6,-80.5],[52.9,-82.2],[54.2,-82.3],
    [55.2,-82.3],[55.8,-85.5],[56.6,-87.8],[57.3,-90.5],[57.2,-92.2],[58.8,-94.2],[59.9,-94.8],[62.5,-93],[62.5,-141]];
  var LAKES = [
    [[46.78,-92.1],[46.65,-90.8],[46.6,-90.4],[46.75,-89.6],[46.95,-88.5],[47.2,-88.6],[47.45,-87.85],[46.85,-87.4],[46.45,-86.6],[46.65,-85.9],[46.55,-84.6],[47.3,-84.7],
     [47.95,-84.9],[48.65,-86.4],[48.8,-87.6],[48.45,-89],[47.95,-89.65],[47.3,-91.2]],
    [[41.65,-87.5],[42.3,-87.8],[43,-87.9],[43.75,-87.7],[44.5,-87.5],[45.6,-86.7],[46,-85.4],[45.8,-84.75],[45.4,-85],[45,-85.4],[44.8,-86.1],[44,-86.5],[43.2,-86.3],[42.4,-86.3],[41.8,-86.65]],
    [[45.8,-84.6],[46.05,-83.9],[46.2,-83],[46.05,-82],[45.6,-80.7],[45,-80],[44.5,-80.1],[45.25,-81.65],[44.5,-81.6],[43.75,-81.7],[43,-82.4],[43.6,-82.55],[43.6,-83.9],[44.05,-83.5],[44.7,-83.3],[45.4,-83.6]],
    [[41.7,-83.45],[42.05,-83.15],[42.55,-81.6],[42.65,-80.5],[42.85,-79.6],[42.88,-78.9],[42.5,-79.3],[42.15,-80.1],[41.75,-81],[41.5,-81.7],[41.45,-82.6]],
    [[43.25,-79.75],[43.65,-79.4],[43.9,-78.6],[44,-77.6],[44.2,-76.5],[43.85,-76.2],[43.3,-77.6],[43.35,-78.6]]];
  /* home cities (arena locations); a club the map does not know is still listed under the map, never dropped */
  var CITY = { BOS: [42.366, -71.062], DET: [42.341, -83.055], NYI: [40.717, -73.726], PIT: [40.439, -79.989], VAN: [49.278, -123.109], SEA: [47.622, -122.354],
    UTA: [40.768, -111.901], DAL: [32.790, -96.810] };
  /* where each crest sits relative to its city, in map units (the map is 1000 wide); close neighbors fan apart */
  /* tuned so no two crests, code labels or 44 px targets touch from a 320 px phone to 1440 (measured), and the East
     cluster fans around its four cities. UTA hangs BELOW its city: above it, its label ran into VAN's crest on phones. */
  var NUDGE = { VAN: [110, -10], SEA: [-60, 95], UTA: [45, 95], DAL: [0, -100], DET: [-70, -85], PIT: [-60, 95], BOS: [0, -105], NYI: [40, 100] };
  var MAPC = null;
  function mapData() {
    if (MAPC) return MAPC;
    var R = Math.PI / 180, p1 = 29.5 * R, p2 = 45.5 * R, p0 = 37.5 * R, l0 = -96 * R;
    var n = (Math.sin(p1) + Math.sin(p2)) / 2, C = Math.cos(p1) * Math.cos(p1) + 2 * n * Math.sin(p1), r0 = Math.sqrt(C - 2 * n * Math.sin(p0)) / n;
    var proj = function (ll) { var t = n * (ll[1] * R - l0), r = Math.sqrt(C - 2 * n * Math.sin(ll[0] * R)) / n; return [r * Math.sin(t), -(r0 - r * Math.cos(t))]; };
    /* frame: the contiguous US coastline plus the Pacific Northwest, so every club has room for its crest */
    var frame = [[49.6, -125.6], [32.4, -117.3], [24.6, -80.6], [25.6, -97.4], [45.4, -66.2], [49.2, -95.2], [49.6, -88], [29.6, -125]].map(proj);
    var xs = frame.map(function (p) { return p[0]; }), ys = frame.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var W = 1000, k = W / (x1 - x0), H = Math.round((y1 - y0) * k + 70);
    var toXY = function (ll) { var p = proj(ll); return [(p[0] - x0) * k, (p[1] - y0) * k + 50]; };
    var land = LAND.map(toXY), lakes = LAKES.map(function (l) { return l.map(toXY); });
    var inside = function (pt, poly) {
      var c = false;
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var a = poly[i], b = poly[j];
        if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
      }
      return c;
    };
    var cities = {}; Object.keys(CITY).forEach(function (c) { cities[c] = toXY(CITY[c]); });
    var codes = Object.keys(cities), step = 13, tiers = ["", "", "", ""], count = 0;
    for (var row = 0, y = step / 2; y < H; y += step * 0.866, row++) {
      for (var x = (row % 2 ? step / 2 : 0) + 4; x < W; x += step) {
        var pt = [x, y];
        if (!inside(pt, land) || lakes.some(function (l) { return inside(pt, l); })) continue;
        var d = Math.min.apply(null, codes.map(function (c) { var q = cities[c]; return Math.sqrt((q[0] - x) * (q[0] - x) + (q[1] - y) * (q[1] - y)); }));
        var t = d < 24 ? 3 : d < 48 ? 2 : d < 84 ? 1 : 0;
        tiers[t] += "M" + x.toFixed(1) + " " + y.toFixed(1) + "h0";
        count++;
      }
    }
    MAPC = { W: W, H: H, tiers: tiers, cities: cities, dots: count };
    return MAPC;
  }
  function leagueMap(opts) {
    opts = opts || {};
    var md = mapData(), W = md.W, H = md.H;
    var order = M.teams.filter(function (t) { return !opts.only || opts.only.indexOf(t.code) >= 0; }).sort(function (a, b) { return (CITY[a.code] ? CITY[a.code][1] : 0) - (CITY[b.code] ? CITY[b.code][1] : 0); });   /* west to east: the entrance order */
    var stems = "", pins = "", unknown = [];
    order.forEach(function (t, i) {
      var c = md.cities[t.code];
      if (!c) { unknown.push(t); return; }
      /* opts.bare (the off-season hero): no record on the pin, since the snapshot's table is Oct 19's, 36 of 54 games, and
         would read as Season 1's final one (review 2026-11-14) */
      var nd = NUDGE[t.code] || [0, -70], px = c[0] + nd[0], py = c[1] + nd[1], r = opts.bare ? null : ST[t.code];
      stems += '<line x1="' + c[0].toFixed(1) + '" y1="' + c[1].toFixed(1) + '" x2="' + px.toFixed(1) + '" y2="' + py.toFixed(1) + '" class="td-stem"/>' +
        '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="6.5" class="td-city"/>';
      /* the code label sits away from the stem; a tip past 70% hangs left from the pin's right edge (at 320 px a centered
         tip on PIT, at 74%, ran 1.4 px off the page and gave a desktop window a sideways scroll) */
      var side = (px / W < 0.2 ? " left" : px / W > 0.7 ? " right" : "") + (nd[1] < 0 && Math.abs(nd[1]) > Math.abs(nd[0]) ? " up" : "");
      pins += '<a class="td-pin' + side + '" href="' + esc(t.href) + '" style="left:' + (px / W * 100).toFixed(2) + "%;top:" + (py / H * 100).toFixed(2) + "%;--d:" + (i * 30) + 'ms" ' +
        'aria-label="' + esc(t.full + (r ? ", " + ord(r.rank) + " in the " + r.division + ", " + r.pts + " points" : "")) + '">' +
        '<span class="td-pin-disc">' + M.crest(t.code) + '</span><span class="td-pin-code" aria-hidden="true">' + esc(t.code) + "</span>" +
        (r ? '<span class="td-pin-tip" aria-hidden="true"><b>' + esc(t.full) + "</b><span>" + esc(rec(t.code)) + " · " + r.pts + " pts · " + esc(ord(r.rank)) + " " + esc(r.division) + "</span></span>" : "") + "</a>";
    });
    return '<div class="td-map" style="aspect-ratio:' + W + "/" + H + '">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of North America with the league\'s ' + order.length + ' clubs at their home cities">' +
      /* the crop is soft: land fades out where the map frame cuts Canada and Mexico */
      '<defs><linearGradient id="tdFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".13" stop-color="#fff"/><stop offset=".9" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<mask id="tdMask" maskUnits="userSpaceOnUse" x="0" y="0" width="' + W + '" height="' + H + '"><rect width="' + W + '" height="' + H + '" fill="url(#tdFade)"/></mask></defs>' +
      '<g mask="url(#tdMask)">' + md.tiers.map(function (d, i) { return d ? '<path class="td-dots t' + i + '" d="' + d + '"/>' : ""; }).join("") + "</g>" + stems + "</svg>" + pins + "</div>" +
      (unknown.length ? '<p class="t-foot">Not on the map yet: ' + unknown.map(function (t) { return '<a href="' + esc(t.href) + '">' + esc(t.full) + "</a>"; }).join(", ") + ".</p>" : "");
  }

  /* ---------- the schedule, read once per call ---------- */
  function nextNight() { return M.nights({ when: "upcoming" }).slice(-1)[0] || null; }
  function lastNight() { return M.nights({ when: "past" })[0] || null; }
  function lastFinal() { var f = M.games.filter(function (g) { return g.isFinal; }); return f[f.length - 1] || { at: M.generated }; }
  function maxWeek() { return M.games.reduce(function (a, g) { return g.stage === "regular" ? Math.max(a, g.week) : a; }, 0); }
  /* v5.00 swap (e7, 2026-11-24): ONE lookup of a season's dates and name, from its seasons row (M.control.season(n)),
     for Today and the profiles (review 2026-11-24: profile.js kept a viewDate of another shape, a second calendar lookup
     and its own season-name fallback). seasonDate answers the calendar row ({key, label, at, date, time}) or null.
     shortcut: defined here and read by profile.js, as S2.mine is; move both into the model (M.seasonDate, M.seasonName)
     with the next model pass, and league.js, hq.js, control.js and desk.js can drop their own copies then */
  S2.seasonDate = function (n, key) { var s = M.control.season(n); return (s && s.calendar.filter(function (c) { return c.key === key; })[0]) || null; };
  S2.seasonName = function (n) { var s = M.control.season(n); return (s && s.name) || "Season " + n; };
  /* a date of the season on screen (M.view, ?season=<n>), never Season 1's by number */
  function viewDate(key) { return S2.seasonDate(M.view.season, key); }
  function open(g) { return g.state === "upcoming" || g.state === "live" || g.state === "pending"; }
  /* the night's biggest game: most combined points, the same definition as M.gameNightDemo's `feature` (earliest on a tie) */
  function clubPts(g) { return ((ST[g.home] || {}).pts || 0) + ((ST[g.away] || {}).pts || 0); }
  function bigGame(night) { return night ? night.games.slice().sort(function (a, b) { return clubPts(b) - clubPts(a); })[0] : null; }
  function meetings(a, b, beforeAt) {
    var t = Date.parse(beforeAt);   /* compare instants, never ISO strings: the data writes +00:00, toISOString writes Z */
    return M.games.filter(function (g) { return g.isFinal && Date.parse(g.at) <= t && ((g.home === a && g.away === b) || (g.home === b && g.away === a)); });
  }
  function series(a, b, beforeAt) {
    var ms = meetings(a, b, beforeAt), w = {}; w[a] = 0; w[b] = 0;
    ms.forEach(function (m) { if (m.winner) w[m.winner]++; });
    return { ms: ms, w: w, lead: w[a] === w[b] ? null : w[a] > w[b] ? a : b, hi: Math.max(w[a], w[b]), lo: Math.min(w[a], w[b]) };
  }
  /* plain text */
  function seriesText(s) {
    if (!s.ms.length) return "This is the first meeting of the season.";
    if (!s.lead) return "The season series is level, " + s.hi + "-" + s.lo + ".";
    return city(s.lead) + " leads the season series " + s.hi + "-" + s.lo + ".";
  }

  /* ---------- match tiles: one piece for the results rail, the game-night band and "Also that night" ---------- */
  function tile(g, href) {
    var st = g.state, fin = st === "final", ff = fin && g.forfeit;
    var side = function (code, score) {
      var won = fin && g.winner === code, lost = fin && g.winner && g.winner !== code;
      return '<span class="td-mrow' + (won ? " won" : lost ? " lost" : "") + '">' + M.crest(code) + '<span class="nm">' + esc(teamName(code)) + "</span>" +
        (fin ? '<span class="sc d-num">' + esc(score) + "</span>" : '<span class="rc num">' + esc(rec(code)) + "</span>") + "</span>";
    };
    var left = st === "live" ? '<span class="td-ts live"><i class="dot-live" aria-hidden="true"></i>Live</span>' : '<span class="td-ts">' + esc(g.time) + "</span>";
    /* a live game shows its period and clock (the model's label, "2nd · 8:14"), never a minute count that keeps growing
       (audit 2026-11-09: a tab left open read "3017 min in") */
    var right = st === "live" ? (g.label !== M.STATE_LABEL.live ? '<span class="td-ts-r">' + esc(g.label) + "</span>" : "") : st === "pending" ? '<span class="td-ts-r">' + esc(M.STATE_LABEL.pending) + "</span>"
      : fin ? '<span class="td-ts-r">' + esc(ff ? "Forfeit (" + ff + ")" : g.label) + "</span>" : "";
    var said = full(g.away) + " at " + full(g.home) + ", " + (st === "live" ? "live" : st === "upcoming" ? "starts " + g.time : st === "pending" ? "result pending" : (ff ? "forfeit by " + full(ff) : g.label) + ", " + g.as + " to " + g.hs);
    var foot = fin ? '<span class="td-obtn">' + (g.hasBox === false ? "Result" : "Box score") + "</span>" : st === "upcoming" ? '<span class="td-obtn">Preview</span>'
      : st === "pending" ? '<span class="td-tnote">No final from EA yet</span>' : "";
    return '<article class="td-tile ' + st + '"><a class="td-tile-link" href="' + esc(href || g.href) + '" aria-label="' + esc(said) + '"></a>' +
      '<div class="td-tile-top">' + left + right + "</div>" + side(g.away, g.as) + side(g.home, g.hs) +
      (foot ? '<div class="td-tile-foot">' + foot + "</div>" : "") + "</article>";
  }
  function railBtn(dir) {
    return '<button class="td-rail-b" data-dir="' + dir + '" aria-controls="tdRail" aria-label="' + (dir < 0 ? "Earlier results" : "Later results") + '">' + S2.ic(dir < 0 ? "back" : "chev") + "</button>";
  }

  /* ======================================================================================================
     TODAY. Quiet day: a statement hero with the league map as its image, then the ink match center (last results,
     next match). Game night: the ink band IS the hero (live, up next, earlier finals, pending) and the map follows.
     ====================================================================================================== */
  function heroQuiet() {
    var nn = nextNight(), po = viewDate("playoffs_start_at"), h, lede, btns;
    if (nn) {
      var at = nn.games[0].at, d = daysUntil(at), when = d === 1 ? "tomorrow" : weekday(at);
      var started = M.games.some(function (g) { return g.week === nn.week && g.isFinal; });
      h = d === 0 ? "Game night tonight" : "Week " + nn.week + (started ? " resumes " : " starts ") + when;
      var wk = M.nights({ when: "upcoming" }).filter(function (n) { return n.week === nn.week; }).reverse();   /* oldest first */
      var n = wk.reduce(function (a, x) { return a + x.games.length; }, 0), days = wk.map(function (x) { return weekday(x.games[0].at); }), after = maxWeek() - nn.week;
      lede = n + " games " + (days.length > 1 ? "across " + list(days) : "on " + days[0]) + " from " + nb(nn.games[0].time + " ET") +
        (po ? (after > 0 ? ", then " + words(after) + " more " + (after === 1 ? "week" : "weeks") + " before the playoffs begin " : ". The playoffs begin ") + M.etLong(po.at) : "") + ".";
      /* commissioner, 2026-11-14: a shortcut to the reader's own Your week here, in place of the week's schedule (see YOUR
         WEEK below); then "The 'Your week' button on the front page should also show for managers, staff, and
         commissioners." So every signed-in role with a week to show gets it (hasWeek); a guest, or a member with no games
         (a waived demo persona; review 2026-11-14: the button opened an empty page), keeps the schedule */
      btns = (hasWeek() ? '<a class="btn site" href="#/you?tab=week">Your week</a>' : '<a class="btn site" href="#/games?week=' + nn.week + '">Week ' + nn.week + " schedule</a>") +
        '<a class="btn site outline" href="#/standings">Standings</a>';
    } else {
      h = po && Date.parse(po.at) > M.now.getTime() ? "The playoffs begin " + M.etMonthDay(po.at) : "The regular season is complete";
      lede = "Every regular season game is final. The top " + words(M.playoffFormat.perDiv) + " clubs in each division play for the title, best of " + words(M.playoffFormat.bestOf) + ".";
      btns = '<a class="btn site" href="#/standings?view=playoffs">Projected bracket</a><a class="btn site outline" href="#/standings">Standings</a>';
    }
    return heroShell(esc((nn ? "Week " + nn.week + " · " : "") + M.etLong(M.generated)), h, lede, btns, { bare: !M.view.finals });   /* QA nits 8: no record on a pin before the first final */
  }
  /* ONE hero for every scene: the statement, then the league map as its image (ruling 2026-10-16: Today is map first
     except while games are active, and no games are played in the off-season). kicker is HTML; a word of ten letters or
     more takes the smaller step, so a long club name never runs out of the column */
  function heroShell(kicker, h, lede, btns, map) {
    var longest = Math.max.apply(null, String(h).split(" ").map(function (w) { return w.length; }));
    return '<section class="hero td-hero reveal" aria-labelledby="tdHeroH"><div class="td-hero-copy">' +
      '<span class="kicker">' + kicker + "</span>" +
      '<h1 class="d-hero td-hero-h' + (longest > 9 ? " long" : "") + '" id="tdHeroH">' + esc(h) + "</h1>" +
      '<p class="lede-l">' + esc(lede) + '</p><div class="td-btns">' + btns + "</div></div>" +
      '<div class="td-hero-map">' + leagueMap(map) + "</div></section>";
  }

  /* ======================================================================================================
     OFF-SEASON (commissioner, 2026-11-14: "Build it out using the same Apple design skills as the rest of the site to make
     the page look built in and not bolted on ... try not to add any pointless information"). Between Season 1's final and
     Season 2's puck drop nothing is played, so the page says three things, each once: who won (the hero), what Season 1
     filed (the titles), and how to be part of Season 2 (the closing band). Left out on purpose: the match center, the race,
     the power rankings and Players of the Week (none exists between seasons, Rule 9.1), the club tiles (Season 1 records;
     Season 2's clubs are decided by Dec 5, Rule S2.2), transactions (every contract expires, Rule 0.9), and a decided
     bracket or final table, which on the Oct 19 snapshot would be four more invented series and 72 invented games.
     The champion and the titles are real (M.offseasonDemo, M.filedTitles); the champion was SAMPLE until the final was played
     (2026-11-20).
     ====================================================================================================== */
  function heroOff(od) {
    var drop = M.s2cal.puckDrop, puck = drop && Date.parse(drop) > M.now.getTime() ? " Season 2 drops the puck " + M.etLong(drop) + "." : "";
    /* no closed season in this body: the model said why in the console (M.offseasonDemo, M.partial.archive) */
    if (!od) return heroShell(esc("Off-season"), M.view.status === "complete" ? M.view.name + " is complete" : "Between seasons", cap(puck.trim()), s2Cta(), { bare: true });
    var c = od.champion, r = od.runnerUp;
    /* dated the day the league was read */
    return heroShell(esc("Off-season · " + M.etLong(M.now)), "The " + teamName(c) + " are champions",
      (od.l === 0 ? city(c) + " swept " + city(r) + " in the final" : city(c) + " beat " + city(r) + " " + words(od.w) + " games to " + words(od.l) + " in the final") + " to win the Stanley Cup." + puck,
      s2Cta(), { bare: true });
  }
  /* the one action of the off-season hero, as the Season 2 page's hero offers it (league.js): a guest joins the Discord
     first; a member registers; a member signed up for Season 2 (the season's sign-ups, M.signups, read with Season 2 on
     screen; or a sign-up the database confirmed on this page) goes to what the sign-up receipt opens */
  var FILED = false;
  function signedUp() {
    var me = S2.session && S2.session.profileId;
    return FILED || (!!me && M.view.season === 2 && M.signups.some(function (s) { return s.pid === me; }));
  }
  function s2Cta() {
    if (!S2.has("member")) return '<a class="btn site discord" href="#/you" data-cta>Join with Discord</a>';
    if (signedUp()) return '<a class="btn site" href="#/you?tab=season" data-cta>See Your season</a>';
    return '<button type="button" class="btn site" data-flow="register" data-cta>Register for Season 2</button>';
  }
  /* a sign-up the database confirmed anywhere (the hero, the band, the strip; js/flows.js fires s2:filed only then)
     turns the hero's button into the next step, in place */
  document.addEventListener("s2:filed", function (e) {
    if (!e.detail || e.detail.flow !== "register") return;
    FILED = true;
    var b = S2.$(".td .td-hero [data-cta]"); if (b) b.outerHTML = s2Cta();
  });
  /* Season 1's awards by the record (commissioner, 2026-11-21: the NHL's stat trophies "beside the titles"): the league's
     four titles as filed and the NHL's three stat trophies, grouped by who won them, in the leaders' own design. The holder
     of the most leads; their numbers are one per stat, the season total with the rate under it, since a title and a trophy
     for the same stat measure the same goals two ways. Every other holder gets a line per award. */
  var AWARD_STATS = [["points_title", "art_ross", "points"], ["goals_title", "rocket_richard", "goals"], ["assists_title", null, "assists"], ["goaltending_title", "jennings", "goals against"]];
  function titlesSection() {
    var filed = {}, troph = {}, groups = [], by = {}, od = M.offseasonDemo(), n = od ? od.season : M.view.season, name = S2.seasonName(n);
    M.filedTitles(n).forEach(function (t) { filed[t.category] = t; });
    M.trophies(n).forEach(function (t) { troph[t.key] = t; });
    var add = function (who, item) {
      var k = who.id || who.tag;
      if (!by[k]) { by[k] = { r: { tag: who.tag, club: who.club, href: who.href }, items: [] }; groups.push(by[k]); }
      by[k].items.push(item);
    };
    AWARD_STATS.forEach(function (st) {
      var t = filed[st[0]], x = st[1] ? troph[st[1]] : null;
      if (t) add(t, { stat: st, title: t, name: t.label });
      if (x) add(x, { stat: st, trophy: x, name: x.short });
    });
    if (!groups.length) { console.error("Today: " + name + " has no filed titles or trophies (M.filedTitles, M.trophies)"); return ""; }
    groups.sort(function (a, b) { return b.items.length - a.items.length; });   /* stable: a tie keeps the stat order */
    var top = groups[0];
    /* the statement's numbers: one per stat; a title and a trophy for one stat share a cell, the total over the rate */
    var cells = [], seen = {};
    top.items.forEach(function (it) {
      var k = it.stat[0], both = top.items.filter(function (o) { return o.stat[0] === k; });
      if (seen[k]) return; seen[k] = 1;
      var t = both.filter(function (o) { return o.title; })[0], x = both.filter(function (o) { return o.trophy; })[0];
      var goalie = k === "goaltending_title", noun = cap(it.stat[2]);
      cells.push(x ? { t: [k, noun + (t ? ", " + t.title.value.toFixed(2) + " a game" : ""), it.stat[2]], r: { display: String(x.trophy.total) } }
        : { t: [k, goalie ? "Goals against a game" : noun + " a game", it.stat[2]], r: { value: t.title.value } });
    });
    var lines = function (g) { return g.items.map(function (it) {
      return it.trophy ? { t: [it.stat[0], it.trophy.key === "jennings" ? city(it.trophy.club) + " allowed, the fewest" : it.stat[2], it.stat[2]], r: { display: String(it.trophy.total), label: it.name } }
        : { t: [it.stat[0], it.stat[0] === "goaltending_title" ? "goals against a game" : it.stat[2] + " a game", it.stat[2]], r: { value: it.title.value, label: it.name } };
    }); };
    var board = [{ r: top.r, races: cells }].concat(groups.slice(1).map(function (g) { return { r: g.r, races: lines(g) }; }));
    var tN = top.items.filter(function (o) { return o.title; }).map(function (o) { return o.name.replace(/ Title$/, ""); }),
        xN = top.items.filter(function (o) { return o.trophy; }).map(function (o) { return o.name.replace(/ Trophy$/, ""); });
    var named = [tN.length ? "the " + list(tN) + (tN.length > 1 ? " Titles" : " Title") : null, xN.length ? "the " + list(xN) + (xN.length > 1 ? " Trophies" : " Trophy") : null].filter(Boolean);
    var tot = top.items.filter(function (o) { return o.trophy && o.trophy.key !== "jennings"; }), any = top.items[0], gp = (any.title || any.trophy).gp;
    var lede = top.r.tag + " takes " + list(named) + (tot.length ? ", with " + list(tot.map(function (o) { return o.trophy.total + " " + o.stat[2]; })) + " in " + gp + " games." : ".");
    var all = groups.reduce(function (n, g) { return n + g.items.length; }, 0);
    var h = top.items.length > 1 ? top.r.tag + " wins " + words(top.items.length) + " awards" : cap(words(all)) + " awards, " + words(groups.length) + " winners";
    /* shortcut: each holder links to their profile, whose season numbers are the Oct 19 snapshot's while its Honors column
       lists the awards as decided; a re-snapshot past Oct 30 makes the two agree */
    return '<section class="band tint td-leaders reveal" aria-labelledby="tdTiH">' + S2.secHead({ kicker: name + " awards", id: "tdTiH", h: h, p: esc(lede), href: "#/stats?tab=awards", link: "All awards" }) +
      leadBoard(board, function (x) { return x.r.label; }) + "</section>";
  }
  function nightNews(n) {
    var fin = n.games.filter(function (g) { return g.isFinal; }), parts = [];
    var hi = fin.filter(function (g) { return !g.forfeit; }).sort(function (a, b) { return Math.max(b.hs, b.as) - Math.max(a.hs, a.as); })[0];
    if (hi) parts.push(city(hi.winner) + "'s " + Math.max(hi.hs, hi.as) + " goals against " + city(hi.loser) + " led the night");
    var ot = fin.filter(function (g) { return g.decision === "ot"; });
    if (ot.length === 1) parts.push(city(ot[0].winner) + " beat " + city(ot[0].loser) + " in overtime");
    else if (ot.length > 1) parts.push(words(ot.length) + " games went to overtime");
    var ff = fin.filter(function (g) { return g.forfeit; });
    if (ff.length === 1) parts.push(city(ff[0].forfeit) + " forfeited to " + city(ff[0].winner));
    else if (ff.length > 1) parts.push(words(ff.length) + " games ended in a forfeit");
    return cap(words(fin.length)) + (fin.length === 1 ? " final" : " finals") + " on " + n.label + (parts.length ? ". " + cap(list(parts)) : "") + ".";
  }
  function nextMatch(nn) {
    var g = bigGame(nn); if (!g) return "";
    var s = series(g.away, g.home, g.at), A = ST[g.away], H = ST[g.home];
    var side = function (code) {
      return '<span class="td-nx-side">' + M.crest(code, "xl") + '<span class="c">' + esc(city(code)) + '</span><span class="d-3">' + esc(teamName(code)) + "</span></span>";
    };
    var why = A && H ? city(g.away) + " is " + S2.ord(A.rank) + " in the " + A.division + " with " + A.pts + " points; " + city(g.home) + " is " + S2.ord(H.rank) + " in the " + H.division + " with " + H.pts + "." : "";
    /* one label, one voice (audit 2026-11-09): the kicker says both what it is and why this game */
    return '<section class="td-next" aria-labelledby="tdNextH"><div class="td-next-h"><h3 class="kicker" id="tdNextH">Next match · Game of the night</h3></div>' +
      '<div class="td-next-grid">' + dateBlock(g.at) +
        '<a class="td-nx-mu" href="' + esc(g.href) + '" aria-label="' + esc(full(g.away) + " at " + full(g.home) + ", " + M.etDateTime(g.at)) + '">' + side(g.away) + '<span class="at" aria-hidden="true">at</span>' + side(g.home) + "</a>" +
        '<div class="td-nx-info"><span class="td-nx-when">' + esc(nb(g.time + " ET") + " · " + nb("Week " + g.week)) + "</span>" +
          '<span class="td-cd" data-until="' + esc(g.at) + '" data-fmt="big" role="timer" aria-label="' + esc("Starts " + M.etDateTime(g.at)) + '">' + untilBig(Date.parse(g.at) - now()) + "</span>" +
          "<p>" + esc(seriesText(s) + " " + why) + "</p>" +
          '<div class="td-btns"><a class="btn site" href="' + esc(g.href) + '">Match preview</a><a class="btn site outline" href="#/games?week=' + g.week + '">Week ' + g.week + " schedule</a></div></div>" +
      "</div></section>";
  }
  function matchCenter() {
    var ln = lastNight(), nn = nextNight();
    if (!ln && !nn) return "";
    var html = '<section class="band ink td-mc reveal"' + look() + ' aria-labelledby="tdMcH">';
    if (ln) {
      var done = !M.games.some(function (g) { return g.week === ln.week && open(g); });
      html += S2.secHead({ kicker: "Match center", id: "tdMcH", h: done ? "Week " + ln.week + " is in the books" : weekday(ln.games[0].at) + "'s results", p: esc(nightNews(ln)),
          aside: '<div class="td-rail-ctl">' + railBtn(-1) + railBtn(1) + "</div>" }) +
        '<div class="td-rail" id="tdRail" tabindex="0" role="region" aria-label="' + esc("Results, " + ln.label) + '">' + ln.games.map(function (g) { return tile(g); }).join("") + "</div>" +
        '<div class="td-mc-more">' + arrow("#/games?week=" + ln.week, "All Week " + ln.week + " results") + "</div>";
    } else html += '<h2 class="sr" id="tdMcH">Match center</h2>';
    return html + (nn ? nextMatch(nn) : "") + "</section>";
  }

  /* ---------- game night ---------- */
  /* v5.00 swap (e7): read live, game night is tonight's real slate (the ET night of the moment the league was read), each
     game in the model's own state (M.gameState); nothing on it is sample, and a live tile names no period or clock it does
     not have (EA sends the box score after the final buzzer) */
  function liveNight() {
    var key = M.etDay(M.now), games = M.games.filter(function (g) { return g.night === key; });
    if (!games.length) return null;
    var by = function (s) { return games.filter(function (g) { return g.state === s; }); };
    return { gn: { week: games[0].week, label: M.etLong(key), now: M.now.toISOString(), nowLabel: M.etTime(M.now) + " ET" },
      live: by("live"), next: by("upcoming"), earlier: by("final").concat(by("pending")), all: games };
  }
  function nightBand(nm) {
    if (!nm) return '<section class="band ink td-nb reveal"' + look() + '><h1 class="d-1">No games tonight</h1></section>';
    var gn = nm.gn, live = nm.live.length, nx = nm.next[0], fin = nm.earlier.filter(function (g) { return g.state === "final"; }).length, pend = nm.earlier.length - fin;
    var h = live ? cap(words(live)) + (live === 1 ? " game live" : " games live") : nx ? "Puck drop " + nx.time : "Tonight's finals";
    var parts = [];
    if (nx) parts.push(words(nm.next.length) + " more " + (nm.next.length === 1 ? "starts" : "start") + " at " + nx.time);
    if (fin) parts.push(words(fin) + (fin === 1 ? " final is" : " finals are") + " in");
    if (pend) parts.push(words(pend) + (pend === 1 ? " result is" : " results are") + " pending");
    var grp = function (id, title, aside, games, href) {
      return games.length ? '<section class="td-grp" aria-labelledby="' + id + '"><h2 class="td-grp-h" id="' + id + '">' + title + (aside || "") + '</h2><div class="td-tiles">' +
        games.map(function (g) { return tile(g); }).join("") + "</div></section>" : "";
    };
    return '<section class="band ink td-nb reveal"' + look() + ' aria-labelledby="tdNbH">' +
      '<div class="td-nb-head"><div class="td-nb-copy"><span class="kicker">' + esc("Game night · Week " + gn.week + " · " + gn.label) + "</span>" +
        '<h1 class="d-1 td-nb-h" id="tdNbH">' + esc(h) + '</h1><p class="lede-l">' + esc(parts.length ? cap(list(parts)) + "." : "Every game tonight is under way.") + "</p></div>" +
        '<div class="td-nb-now"><span class="d-num">' + esc(gn.nowLabel.replace(/ ET$/, "")) + "</span><span>ET</span></div></div>" +
      grp("tdGLive", '<span><i class="dot-live" aria-hidden="true"></i>Live now</span>', "", nm.live) +
      grp("tdGNext", "<span>Up next" + (nx ? " · " + esc(nx.time) : "") + "</span>", nx ? '<span class="td-grp-a" data-until="' + esc(nx.at) + '"></span>' : "", nm.next) +
      grp("tdGDone", "<span>Earlier tonight</span>", "", nm.earlier) +
      '<p class="td-nb-note">A live game shows its status, not a score: EA sends the result a few minutes after the final buzzer.</p></section>';
  }

  /* ---------- the race: both divisions, the dashed playoff line, the model's marks ---------- */
  /* the model's standings marks (M.standings Row.mark); the legend is built from the marks on the table, never fixed */
  var MARKS = { z: "clinched the division", x: "clinched a playoff spot", e: "eliminated" };
  function raceNews() {
    var cut = M.cutLine.after, out = [];
    M.standings("division").forEach(function (d) {
      var rows = d.rows, top = rows[0], inn = rows.filter(function (r) { return r.rank <= cut; }), clin = inn.filter(function (r) { return r.clinched; });
      if (!top) return;
      var spread = top.pts - inn[inn.length - 1].pts, x = { w: 0 };
      if (top.clinched === "division") { x.h = city(top.code) + " has won the " + d.division; x.w = 3; }
      else if (clin.length) { x.h = list(clin.map(function (r) { return city(r.code); })) + (clin.length === 1 ? " is in" : " are in"); x.w = 2; }
      else if (spread <= 3) { x.h = spread === 0 ? "The " + d.division + "'s top " + words(inn.length) + " are level" : cap(words(spread)) + (spread === 1 ? " point splits" : " points split") + " the " + d.division + "'s top " + words(inn.length); x.w = 1; }
      else x.h = city(top.code) + " leads the " + d.division;
      if (clin.length) {
        var hunt = inn.filter(function (r) { return !r.clinched && r.magic > 0 && r.magic <= 6; })[0];
        x.s = city(clin[0].code) + " has clinched a playoff spot with " + clin[0].pts + " points" + (hunt ? ", and " + city(hunt.code) + "'s magic number is " + hunt.magic : "") + ".";
      } else {
        var behind = inn.slice(1).map(function (r) { var gap = top.pts - r.pts; return gap ? words(gap) + " ahead of " + city(r.code) : "level with " + city(r.code); });
        x.s = city(top.code) + " leads the " + d.division + " on " + top.pts + " points" + (behind.length ? ", " + list(behind) : "") + ".";
      }
      out.push(x);
    });
    out.sort(function (a, b) { return b.w - a.w; });
    var gl = M.standings("league").map(function (r) { return r.games_left; }), same = gl.every(function (n) { return n === gl[0]; });
    return { h: out.slice(0, 2).map(function (x) { return x.h; }).join(". ") + ".", p: out.map(function (x) { return x.s; }).join(" ") + (same && gl[0] ? " Every club has " + gl[0] + " games left." : "") };
  }
  /* the snapshot reads like the Standings page its arrow opens (review 2026-10-19): CLUB, PTS, GP, W, L, OTL, LAST 5, its
     header weight and rule, and the clinch letter in Standings' ink box (.lg-mk) */
  function raceTable(d) {
    var cut = M.cutLine.after;
    return '<div class="td-div"><h3 class="d-3 td-div-h">' + esc(d.division) + '</h3><div class="td-stw"><table class="td-st"><caption class="sr">' + esc(d.division + " Division standings") + "</caption>" +
      '<thead><tr><th scope="col" class="rk"><span class="sr">Place</span></th><th scope="col" class="cl">Club</th><th scope="col" class="pts"><abbr title="Points">PTS</abbr></th><th scope="col" class="gp"><abbr title="Games played">GP</abbr></th><th scope="col">W</th><th scope="col">L</th><th scope="col"><abbr title="Overtime losses">OTL</abbr></th><th scope="col" class="l5">Last 5</th></tr></thead><tbody>' +
      d.rows.map(function (r) {
        /* the letter is for the eye; a screen reader hears the words */
        var mk = MARKS[r.mark] ? '<abbr class="lg-mk td-mk" title="' + esc(cap(MARKS[r.mark])) + '" aria-hidden="true">' + esc(r.mark) + '</abbr><span class="sr">, ' + MARKS[r.mark] + "</span>" : "";
        return '<tr class="' + (r.rank === cut ? "cut" : "") + '"><td class="rk num">' + r.rank + "</td>" +
          '<td class="cl"><a href="' + esc(r.href) + '">' + M.crest(r.code) + '<span class="nm">' + esc(full(r.code)) + '</span><span class="cd">' + esc(r.code) + "</span>" + mk + "</a></td>" +
          '<td class="num pts"><b class="lg-pts">' + r.pts + '</b></td><td class="num gp">' + r.gp + '</td><td class="num">' + r.w + '</td><td class="num">' + r.l + '</td><td class="num">' + r.otl + '</td><td class="l5">' + lastFive(r) + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";
  }
  function raceSection() {
    if (!M.view.finals) return "";   /* v5.00 swap (e7): before the season's first final every club is level at zero; the race begins with it */
    var divs = M.standings("division"), seen = {}, news = raceNews();
    divs.forEach(function (d) { d.rows.forEach(function (r) { if (MARKS[r.mark]) seen[r.mark] = true; }); });
    return '<section class="td-sec td-race reveal" aria-labelledby="tdRaceH">' +
      S2.secHead({ kicker: "The race", id: "tdRaceH", h: news.h, p: esc(news.p), href: "#/standings", link: "All standings" }) +
      '<div class="td-race-divs">' + divs.map(raceTable).join("") + "</div>" +
      '<p class="td-legend"><span><i class="td-lg-cut" aria-hidden="true"></i>' + esc(M.cutLine.label) + "</span>" +
        Object.keys(MARKS).filter(function (k) { return seen[k]; }).map(function (k) { return '<span><abbr class="lg-mk" aria-hidden="true">' + k + "</abbr>" + esc(cap(MARKS[k])) + "</span>"; }).join("") +
        '<span><span class="lg-form" aria-hidden="true"><i class="lg-f-w"></i><i class="lg-f-o"></i><i class="lg-f-l"></i></span>Last five, oldest first: win, overtime loss, loss</span>' +
        "<span>Through " + esc(M.etDate(lastFinal().at)) + "</span></p></section>";
  }

  /* ---------- title leaders: one statement per leader, never a card per title ----------
     Review 2026-10-19: four identical KPI cards, three of them the same player and crest, read as a dashboard. Titles are
     grouped by who leads them. The leader of the most races gets the statement (the name large, one row of numerals), the
     chasers are a sentence, and any other leader is one line. #/stats Leaders keeps the full boards and the method. */
  var TITLES = [["points_title", "points a game", "points"], ["goals_title", "goals a game", "goals"], ["assists_title", "assists a game", "assists"], ["goaltending_title", "goals against a game", "goaltending"]];
  /* a rate to two decimals everywhere (audit 2026-11-09: 5.167 here, 5.17 on the profile) */
  function rate(r) { return typeof r.value === "number" ? r.value.toFixed(2) : r.display.replace(/ per game$| GAA$/, ""); }
  /* titles grouped by who holds them; top(category) gives { r, next } or null. Shared by the races (quiet) and the titles
     as filed (off-season), so the two read as one design */
  function titleGroups(top) {
    var groups = [], by = {}, none = [];
    TITLES.forEach(function (t) {
      var x = top(t[0]), r = x && x.r;
      if (!r) { none.push(t[2]); return; }
      if (!by[r.id]) { by[r.id] = { r: r, races: [] }; groups.push(by[r.id]); }
      by[r.id].races.push({ t: t, r: r, next: x.next || null });
    });
    groups.sort(function (a, b) { return b.races.length - a.races.length; });   /* stable: a tie keeps the TITLES order */
    return { groups: groups, none: none };
  }
  /* the statement (the holder of the most titles, large, with one row of numerals) and one line for each other holder;
     what(x) names a race on that line (the race's noun by default; a filed title by its own name) */
  function leadBoard(groups, what) {
    var top = groups[0];
    what = what || function (x) { return x.t[2]; };
    var more = groups.slice(1).map(function (g) {
      return '<li><a href="' + esc(g.r.href) + '">' + M.crest(g.r.club) + '<span class="who"><b>' + esc(g.r.tag) + "</b><small>" + esc(cap(list(g.races.map(what))) + " · " + full(g.r.club)) + "</small></span>" +
        g.races.map(function (x) { return '<span class="v"><b class="d-num">' + esc(rate(x.r)) + "</b><small>" + esc(x.t[1]) + "</small></span>"; }).join("") + S2.chev() + "</a></li>";
    }).join("");
    return '<div class="td-lead"><a class="td-lead-who" href="' + esc(top.r.href) + '">' + M.crest(top.r.club, "lg") +
        '<span><span class="kicker">' + esc(full(top.r.club)) + '</span><b class="d-1' + tagCls(top.r.tag) + '">' + esc(top.r.tag) + "</b></span></a>" +
        '<dl class="td-lead-n">' + top.races.map(function (x) { return "<div><dt>" + esc(cap(x.t[1])) + '</dt><dd class="d-num">' + esc(rate(x.r)) + "</dd></div>"; }).join("") + "</dl></div>" +
      (more ? '<ul class="td-lead-more">' + more + "</ul>" : "");
  }
  /* v5.00 swap (e7): live, the race board (statistical_title_board) is not in s2_league and M.partial.titles says so;
     "not loaded" must never read as "nobody has reached the floor". QA round 2 (A7, 2026-11-25): the section was simply
     left out, so Today never told the race. The board is the model's one read now (M.readTitles, which Stats and the
     profile share): Today asks for it after it draws (titlesIn) and the section takes its place in place when it lands.
     Until then the section is an unseen placeholder (#tdLeaders), and a failed read is said in plain words with Try again
     (fail loud). Before the season's first final there is no race to tell, and nothing is read for it */
  function leadersSection() {
    if (!M.view.finals) return "";
    var head = { kicker: "Title leaders", id: "tdLdH", href: "#/stats?tab=leaders", link: "All leaders" };
    if (M.partial.titles) {
      var err = M.titlesErr();
      return err ? '<section class="band tint td-leaders reveal" id="tdLeaders" aria-labelledby="tdLdH">' + S2.secHead(Object.assign(head, { h: "The title race", p: "" })) +
          /* QA round 2 review: "reported a problem", since the league's own words follow (it said "did not answer" and then
             quoted it), and no pointer to Stats, which reads the same board and fails the same way */
          S2.empty("err", "The title race did not load", "The league's data service reported a problem, so the race cannot be shown here. Try again in a moment." +
            (err.message ? '<span class="td-why">The league said: “' + esc(err.message) + "”</span>" : ""), { t: "Try again", data: { tdtitles: "retry" } }) + "</section>"
        : '<section id="tdLeaders" hidden></section>';
    }
    var tg = titleGroups(function (c) { var rows = M.titles(c); return rows[0] ? { r: rows[0], next: rows[1] } : null; }), groups = tg.groups, none = tg.none;
    var top = groups[0];
    if (!top) return '<section class="band tint td-leaders reveal" id="tdLeaders" aria-labelledby="tdLdH">' + S2.secHead(Object.assign(head, { h: "No title leaders yet", p: "Nobody has reached the games-played floor yet." })) + "</section>";
    /* numbers in sentences first: the leader's total, then who chases them in which race */
    var first = top.races[0], low = first.t[0] === "goaltending_title";
    var lede = first.r.tag + (low ? " has allowed " + first.r.total + " goals in " : " has " + first.r.total + " " + first.t[2] + " in ") + first.r.gp + " games.";
    var nextIn = {}, order = [];
    top.races.forEach(function (x) { if (!x.next) return; var k = x.next.tag; if (!nextIn[k]) { nextIn[k] = []; order.push(k); } nextIn[k].push(x.t[2]); });
    lede += order.map(function (k) { return " " + k + " is next in " + list(nextIn[k]) + "."; }).join("");
    if (none.length) lede += " Nobody has reached the games-played floor in " + list(none) + " yet.";
    var h = top.races.length > 1 ? top.r.tag + " leads " + words(top.races.length) + " title races" : cap(words(TITLES.length - none.length)) + " title races, " + words(groups.length) + " leaders";
    return '<section class="band tint td-leaders reveal" id="tdLeaders" aria-labelledby="tdLdH">' + S2.secHead(Object.assign(head, { h: h, p: esc(lede) })) +
      leadBoard(groups) + "</section>";
  }
  /* the title race, read by the model after the page draws: the section repaints in place when the read settles (the
     first landing enters as a section does; a refresh of a board on screen is quiet), never the page. again: Try again */
  function titlesIn(root, again) {
    var host = S2.$("#tdLeaders", root); if (!host) return;
    var retry = S2.$('[data-tdtitles="retry"]', host);
    if (retry) retry.addEventListener("click", function () { titlesIn(root, true); });
    if (!again && !M.titlesNeeded()) return;
    var read = M.readTitles(again);
    if (again) { host.outerHTML = leadersSection(); }   /* the failure is cleared by the ask: the placeholder holds the place */
    read.then(function () {
      var h = S2.$("#tdLeaders", root); if (!h || !root.isConnected || S2.parse().name !== "today") return;   /* the reader has moved on */
      var first = h.hasAttribute("hidden");
      h.outerHTML = leadersSection();
      var n = S2.$("#tdLeaders", root); if (!n) return;
      if (first) S2.reveal(n.parentNode); else S2.settle(n);
      titlesIn(root);   /* binds a Try again the new section brought; the board is read, so nothing is asked */
    });
  }

  /* ---------- the clubs: the Clubs page's own tile (review 2026-10-19: one object, one design). Solid club color, the
     crest on a white disc, the name and the record in condensed type; the race table above stays the place for form. ---------- */
  /* the tile's color and ink are core's one S2.clubBand (QA round 2, 2026-11-25: the copy of league.js inkOn kept here as a
     shortcut is gone with it) */
  function clubsSection(withMap) {
    var po = viewDate("playoffs_start_at"), per = M.playoffFormat.perDiv, nd = M.league.divisions.length;
    var rows = M.standings("division").reduce(function (a, d) { return a.concat(d.rows); }, []);
    /* QA nits 8 (2026-11-25): before a season's first final a table is all zeros, so the tiles and the map carry no rank or
       record ("1st East, 0-0-0, 0 pts" ranked clubs on nothing) and the tiles go in city order in each division, as the
       Clubs page draws them before its first final (league.js clubTile) */
    var bare = !M.view.finals;
    if (bare) rows = rows.slice().sort(function (a, b) { return M.league.divisions.indexOf(a.division) - M.league.divisions.indexOf(b.division) || city(a.code).localeCompare(city(b.code)); });
    return '<section class="td-sec td-clubs reveal" aria-labelledby="tdClH">' +
      S2.secHead({ kicker: "The clubs", id: "tdClH", h: cap(words(M.teams.length)) + " clubs, " + words(per * nd) + " playoff spots",
        p: esc(cap(words(M.teams.length / nd)) + " clubs in each division. The top " + words(per) + " in each make the playoffs" + (po ? ", which begin " + M.etLong(po.at) : "") + "."), href: "#/clubs", link: "All clubs" }) +
      (withMap ? '<div class="td-mapwrap">' + leagueMap({ bare: bare }) + "</div>" : "") +
      '<div class="lg-tiles">' + rows.map(function (r) {
        return '<a class="lg-ct" href="' + esc(r.href) + '" style="' + esc(S2.clubBand(M.team(r.code))) + '">' +
          (bare ? "" : '<span class="lg-ct-rk">' + esc(ord(r.rank) + " " + r.division) + "</span>") +
          '<span class="lg-ct-medal" aria-hidden="true">' + M.crest(r.code, "xl") + "</span>" +
          '<span class="lg-ct-name"><span class="lg-ct-city">' + esc(city(r.code)) + '</span><span class="d-2">' + esc(teamName(r.code)) + "</span></span>" +
          (bare ? "" : '<span class="lg-ct-rec"><span class="d-num">' + esc(rec(r.code)) + '</span><span class="lg-ct-pts">' + r.pts + " pts</span></span>") + "</a>";
      }).join("") + "</div></section>";
  }

  /* ---------- Players of the Week, set large ---------- */
  function potwSection() {
    var wk = M.honors.potwByWeek[M.honors.potwByWeek.length - 1];
    if (!wk) return '<section class="td-sec td-potw reveal" aria-labelledby="tdPoH">' + S2.secHead({ kicker: "Players of the Week", id: "tdPoH", h: "The first awards come after Week 1" }) + "</section>";
    var orderCat = { potw_forward: 1, potw_skater: 1, potw_defense: 2, potw_goalie: 3 };
    var picks = wk.picks.slice().sort(function (a, b) { return (orderCat[a.category] || 9) - (orderCat[b.category] || 9); });
    var f = picks[0], goals = f ? M.log(f.id, "S").filter(function (x) { return x.week === wk.week; }).reduce(function (a, x) { return a + (x.g || 0); }, 0) : 0;
    var h = f && goals > 1 ? f.tag + " scored " + goals + " goals in Week " + wk.week : "Week " + wk.week + "'s best";
    return '<section class="td-sec td-potw reveal" aria-labelledby="tdPoH">' +
      S2.secHead({ kicker: "Players of the Week · Week " + wk.week, id: "tdPoH", h: h, p: "Chosen automatically every Monday from the record: a forward, a defenseman and a goaltender with three or more games that week at that position (Rule 9.1).", href: "#/stats?tab=awards", link: "All awards" }) +
      '<ol class="td-potw-l">' + picks.map(function (p) {
        var c = clubColor(p.club);
        return '<li><a href="' + esc(p.href) + '"' + (c ? ' style="--club:' + c + '"' : "") + '><span class="kicker">' + esc(p.label) + "</span>" + M.crest(p.club, "lg") +
          '<span class="tag' + tagCls(p.tag) + '">' + esc(p.tag) + '</span><span class="ln">' + esc(p.line) + '</span><span class="cl">' + esc(full(p.club)) + "</span></a></li>";
      }).join("") + "</ol></section>";
  }

  /* a door's date block, "Dec" over a big "12": one definition for the Season 2 band and the calendar (review 2026-11-24) */
  function doorDate(iso) { var p = M.etMonthDay(iso).split(" "); return '<span class="td-door-d"><span>' + esc(p[0]) + '</span><b class="d-num">' + esc(p[1]) + "</b></span>"; }
  /* ---------- Season 2: the Lift call to action, with the real dates from the seasons row ---------- */
  function s2Band(off) {
    /* v5.00 swap (e7): the dates are the model's one Season 2 calendar (M.s2cal), and a door shows only while it is open,
       read against the model's clock (M.now: the moment the league was read, or the fixture's). Once sign-ups close the
       band has nothing left to open but the staff door, so it is not drawn */
    var c = M.s2cal, now = M.now.getTime(), isOpen = function (iso) { return !!iso && Date.parse(iso) > now; };
    if (!isOpen(c.signupsClose)) return "";
    /* QA function 18 (2026-11-25): a staffer or commissioner applies to own no club and is already staff (Rule 2.7), so
       neither door is theirs, as the menu's own links for them carry not: "staff" (core.js) */
    var staffer = S2.has("staff"), own = !staffer && isOpen(c.ownersClose);
    var door = function (iso, title, text, flow) {
      return '<li><a href="#/season"' + (off ? ' data-flow="' + flow + '"' : "") + ">" + (iso ? doorDate(iso) : '<span class="td-door-d ic" aria-hidden="true">' + S2.ic("people") + "</span>") +
        '<span class="td-door-t"><b>' + esc(title) + "</b><span>" + esc(text) + "</span></span>" + S2.ic("chev") + "</a></li>";
    };
    return '<section class="band td-s2 reveal" aria-labelledby="tdS2H"><div class="td-s2-grid"><div class="td-s2-copy"><span class="kicker">Season 2</span>' +
      '<h2 class="d-1" id="tdS2H">' + (staffer ? "Sign up to play." : own ? "Sign up. Own a club. Join the staff." : "Sign up. Join the staff.") + "</h2>" +
      '<p class="lede-l">' + esc((!off && isOpen(c.puckDrop) ? "Season 2 drops the puck " + M.etLong(c.puckDrop) + ". " : "") + "Everyone signs up again, Season 1 players included.") + "</p></div>" +
      '<ol class="td-doors">' +
        /* sign-ups first, as in the announcement strip (commissioner, 2026-10-19) */
        /* the sign-up close comes from the seasons row; since v4.23 it agrees with Rule S2.1 (11:59 PM the day before the draft,
           Friday, December 11 since v4.31), so no hedge */
        door(c.signupsClose, "Sign up", "Sign-ups close " + M.etLong(c.signupsClose) + " at " + nb(M.etTime(c.signupsClose) + " ET") + (c.draft ? ". The draft is " + M.etLong(c.draft) : "") + ".", "register") +
        (own ? door(c.ownersClose, "Own a club", "Owner applications close " + M.etLong(c.ownersClose) + " at " + nb(M.etTime(c.ownersClose) + " ET") + (c.ownersDecided ? ". Owners are decided by " + M.etMonthDay(c.ownersDecided) : "") + ".", "owner") : "") +
        (staffer ? "" : door(null, "Join the staff", "One staff, with six committees by topic: officiating, statistics, applications, community, transactions, and draft and bidding.", "staff")) +
      "</ol></div></section>";
  }

  /* ======================================================================================================
     SEASON 2 BEFORE ITS SCHEDULE (v5.00 swap, e7, 2026-11-24). Today follows the season on screen (M.view): a Season 2
     with no games is not a finished season, so it never says "The regular season is complete". The phase is read from
     the season's own data, and every date from the model's one Season 2 calendar (M.s2cal; a date it marks projected is
     shown as projected):
       offseason  no club has a seat yet (M.view.empty.rosters). A seat puts its holder on the club's roster
                  (trg_team_manager_sync, ensure_manager_rostered), so an empty roster table means the owners are not
                  decided. Between seasons the page is the off-season scene the commissioner ruled (2026-11-14): the last
                  champion, its awards, and the Season 2 band.
       draft      clubs are seated and the draft is not complete (draft_state.status): the draft is the news.
       schedule   the draft is complete and no game is scheduled: puck drop is the news.
       quiet, tonight   the season has a schedule (M.view.games): game nights, as for any season in play.
     shortcut: the phases read M.s2cal, Season 2's calendar; a Season 3 needs the model to give the season on screen its
     own calendar before its pre-season can be told here
     ====================================================================================================== */
  function s2Phase() {
    if (M.view.season !== 2 || M.view.games) return null;
    if (M.view.empty.rosters) return "offseason";
    return M.draftDone() ? "schedule" : "draft";   /* QA round 2 (A6): the model's one "the draft is complete" */
  }
  /* the clubs with someone on their roster this season, west to east as the map draws them */
  function seated() { var c = []; M.players.forEach(function (p) { if (p.rostered && p.club && c.indexOf(p.club) < 0) c.push(p.club); }); return c; }
  /* "Saturday" inside a week, "December 12" past it, so a headline never names a weekday a week or more away */
  function dayWord(iso) { var d = daysUntil(iso); return d === 0 ? "tonight" : d === 1 ? "tomorrow" : d < 7 ? weekday(iso) : M.etLong(iso).split(", ")[1]; }
  function heroDraft() {
    var c = M.s2cal, now = M.now.getTime(), clubs = seated(), signing = Date.parse(c.signupsClose) > now, n = M.view.signups;
    var h = now >= Date.parse(c.draft) ? "The draft is on" : daysUntil(c.draft) === 0 ? "Draft night" : "The draft is " + dayWord(c.draft);
    /* the sign-up close is said once, by the calendar and the band below */
    var lede = cap(words(clubs.length)) + (clubs.length === 1 ? " club picks " : " clubs pick ") + words(M.RULES.s2.draftRounds) + " rounds from " + (n ? "the " + S2.plural(n, "player") + " signed up so far" : "the players who sign up") +
      ", " + M.etLong(c.draft) + " at " + nb(M.etTime(c.draft) + " ET") + ". The puck drops " + M.etLong(c.puckDrop) + ".";
    var btns = (signing ? s2Cta() : "") + '<a class="btn site' + (signing ? " outline" : "") + '" href="#/draft">Draft room</a>';
    return heroShell(esc(M.view.name + " · " + M.etLong(M.now)), h, lede, btns, { bare: true, only: clubs.length ? clubs : null });
  }
  function heroSchedule() {
    var c = M.s2cal, clubs = seated(), picks = M.draft.picks.filter(function (p) { return p.used; }).length;
    var wk1 = c.nights.filter(function (n) { return n.week === 1; }), weeks = c.nights.reduce(function (a, n) { return Math.max(a, n.week); }, 0);
    var h = M.now.getTime() >= Date.parse(c.puckDrop) ? "No games scheduled yet" : "Puck drop " + dayWord(c.puckDrop);
    var lede = (picks ? "The draft is done: " + S2.plural(picks, "pick") + " to " + words(clubs.length) + (clubs.length === 1 ? " club." : " clubs.") : "The draft is done.") +
      (wk1.length ? " Game nights are " + list(wk1.map(function (n) { return weekday(n.at); })) + " from " + nb(M.etTime(wk1[0].at) + " ET") + ", " + words(weeks) + " weeks, starting " + M.etLong(c.puckDrop) + "." : "") +
      " Who plays whom is posted with the schedule.";
    return heroShell(esc(M.view.name + " · " + M.etLong(M.now)), h, lede, '<a class="btn site" href="#/clubs">The clubs</a><a class="btn site outline" href="#/draft">Draft results</a>', { bare: true, only: clubs.length ? clubs : null });
  }
  /* what is still ahead on the Season 2 calendar, from M.s2cal (the one definition the market's clock reads as well). The
     movement deadline is projected until a schedule exists (M.s2cal.deadlineProjected), and says so */
  function calSection() {
    var c = M.s2cal, now = M.now.getTime(), bid = c.bidNights.filter(function (b) { return !b.skipped; })[0], at = function (iso) { return nb(M.etTime(iso) + " ET"); };
    /* each row reads on from its date: "Saturday, December 12, at 9:00 PM ET, ten rounds." */
    var rows = [[c.ownersClose, "Owner applications close", "at " + at(c.ownersClose) + "."], [c.ownersDecided, "Owners are decided", "by " + at(c.ownersDecided) + "."],
      [c.signupsClose, "Sign-ups close", "at " + at(c.signupsClose) + "."], [c.draft, "The draft", "at " + at(c.draft) + ", " + words(M.RULES.s2.draftRounds) + " rounds."],
      [c.puckDrop, "Puck drop", "at " + at(c.puckDrop) + ", the first game night."], [bid && bid.opens, "Saturday bidding opens", "9 to 10 PM ET, each game week until the movement deadline (Rule S2.6)."],
      [c.deadline, "Movement deadline", "trades, waivers and bidding close (Rule 2.4)." + (c.deadlineProjected ? " Projected from the season's game weeks until the schedule is set." : ""), c.deadlineProjected],
      [c.ends, "The regular season ends", ""], [c.playoffs, "The playoffs begin", "at " + at(c.playoffs) + "."]]
      .filter(function (r) { return r[0] && Date.parse(r[0]) > now; }).sort(function (a, b) { return Date.parse(a[0]) - Date.parse(b[0]); });
    if (!rows.length) return "";
    return '<section class="td-sec td-cal reveal" aria-labelledby="tdCalH">' +
      S2.secHead({ kicker: "Season 2 calendar", id: "tdCalH", h: "Next: " + rows[0][1].replace(/^./, function (x) { return x.toLowerCase(); }) + ", " + M.etLong(rows[0][0]).split(", ")[1],
        p: "Every date still ahead, in Eastern time.", href: "#/season", link: "The season" }) +
      '<ol class="td-doors">' + rows.map(function (r) {
        return '<li><a href="#/season">' + doorDate(r[0]) + '<span class="td-door-t"><b>' + esc(r[1]) + (r[3] ? ' <span class="chip">projected</span>' : "") + "</b><span>" + esc(M.etLong(r[0]) + (r[2] ? ", " + r[2] : ".")) + "</span></span>" + S2.ic("chev") + "</a></li>";
      }).join("") + "</ol></section>";
  }

  function rankingsSection() {
    var pw = M.view.finals ? M.standings("power").slice(0, 3) : [];   /* no ranking before a final (v5.00 swap, e7) */
    if (!pw.length) return "";
    return '<section class="td-sec td-tx reveal" aria-labelledby="tdPwH">' +
      S2.secHead({ kicker: "Power rankings", id: "tdPwH", h: city(pw[0].code) + " tops the power rankings", href: "#/standings?view=power", link: "All rankings",
        p: esc(full(pw[0].code) + " rates " + pw[0].ovr + ", from record, goal difference, goaltending, depth and form.") }) +
      '<ol class="td-txl">' + pw.map(function (r) {
        return '<li><span class="td-tx-cr" aria-hidden="true">' + M.crest(r.code) + '</span><span class="td-tx-t"><span class="kicker">' + esc(S2.ord(r.rank)) + '</span><a href="' + esc(r.href) + '">' + esc(full(r.code)) + "</a></span>" +
          '<span class="td-tx-at">' + r.ovr + " rating · " + r.pts + " pts</span></li>";
      }).join("") + "</ol></section>";
  }

  /* ======================================================================================================
     YOUR WEEK lives on the member's own page (You, Your week: #/you?tab=week, you.js paneWeek); Today carries a shortcut.
     History: the audit of 2026-11-09 found posting availability the most used member action on the live site (21 of 37
     visitors on a weekend), and the commissioner put it at the top of Today: "availability should sit beside it on desktop
     width and above it on the phone. Allow for an easy 1 button way to mark yourself available for every game night of the
     week." Commissioner, 2026-11-14, on that block: "fix this part of the page on the top of the 'Today' page in the player
     view and just add a shortcut button to the players' 'Your week' page ... You can swap it out with the 'week 5
     schedule' button next to the 'standings' button." So the block is gone and heroQuiet's first button opens Your week.
     Then, the same day: "The 'Your week' button on the front page should also show for managers, staff, and
     commissioners." So every signed-in role with a week gets it (hasWeek). S2.mine below still answers null for staff and
     the commissioner (Standings and Games mark only a player's own club), although You shows them the demo persona's
     week. The one-tap answer stays on that page ("Available for the rest", you.js dueInner), and the answers stay in ONE
     store, S2.availability (js/pages/you.js since the e0 split, 2026-11-24; it was Team HQ's).
     ====================================================================================================== */
  /* the member a player or front-office view signs in as, with a club; a guest, a staff seat or the commissioner has
     no player of their own. shortcut: defined here and read by league.js too; move into core.js with the next kit pass */
  /* whether the reader has a week to open in You, Your week: any signed-in role (the persona's games for staff and the
     commissioner), never a guest; a missing availability store is an error, never a quiet no */
  function hasWeek() {
    if (!S2.has("member")) return false;
    if (!S2.availability) { console.error("Today: Your week needs S2.availability (js/pages/you.js), which did not load"); return false; }
    return S2.availability.week().length > 0;
  }
  S2.mine = function () {
    var r = S2.state.role; if (r !== "player" && r !== "office") return null;
    if (!S2.availability) { console.error("S2.mine: the availability store (S2.availability, js/pages/you.js) did not load"); return null; }
    var p = S2.availability.me();
    return p && p.rostered && p.club ? p : null;
  };

  /* ---------- the page ---------- */
  /* the scene the season on screen is in (v5.00 swap, e7): Season 2 before its schedule is one of its phases (s2Phase); a
     complete season is its off-season (seasons.status, set by trg_conclude_series); otherwise a night with a game live,
     or past its window with no final, is game night, read on tonight's ET night only, so a game held days ago never keeps
     the page on game night; any other day is quiet. The fixture (Season 1 active, Mon Oct 19) is a quiet day, as before */
  function autoState() {
    var ph = s2Phase(); if (ph) return ph;
    if (M.view.status === "complete") return "offseason";
    var tonight = M.etDay(M.now);
    return M.games.some(function (g) { return g.night === tonight && (g.state === "live" || g.state === "pending"); }) ? "tonight" : "quiet";
  }
  function todayBody(state) {
    if (state === "offseason") return heroOff(M.offseasonDemo()) + titlesSection() + s2Band(true);
    if (state === "draft") return heroDraft() + calSection() + s2Band(true);
    if (state === "schedule") return heroSchedule() + calSection() + s2Band(true);
    if (state === "tonight") return nightBand(liveNight()) + raceSection() + rankingsSection() + clubsSection(true) + leadersSection() + potwSection() + s2Band();
    return heroQuiet() + matchCenter() + raceSection() + rankingsSection() + leadersSection() + clubsSection(false) + potwSection() + s2Band();
  }
  /* The open concept (commissioner, 2026-10-19: "The concept should be fully open for all buttons to play with so I can
     figure out if I need to make changes or not"): an arrow is never disabled. At an end it dims and a press wraps the
     rail round to the other end; when every tile fits there is nothing to scroll, so the arrows are not shown. */
  function bindRail(root) {
    var rail = S2.$("#tdRail", root); if (!rail) return;
    var ctl = S2.$(".td-rail-ctl", root), btns = S2.$$(".td-rail-b", root);
    /* an end is reached when its tile is fully in view: on a phone scroll-snap rests a few px short of the scroll range's
       end (measured 3078 of 3082 at 375 px), so scrollLeft alone never read as the end and Later did nothing there */
    function ends() {
      var max = rail.scrollWidth - rail.clientWidth - 2, box = rail.getBoundingClientRect(), a = rail.firstElementChild, z = rail.lastElementChild;
      return { fits: max <= 0, start: rail.scrollLeft <= 2 || (a && a.getBoundingClientRect().left >= box.left - 1), end: rail.scrollLeft >= max || (z && z.getBoundingClientRect().right <= box.right + 1) };
    }
    function sync() {
      var e = ends();
      if (ctl) ctl.hidden = e.fits;
      btns.forEach(function (b) {
        var back = +b.dataset.dir < 0, at = back ? e.start : e.end;
        b.classList.toggle("at-end", at);
        b.setAttribute("aria-label", back ? (at ? "Jump to the end" : "Earlier results") : (at ? "Back to the start" : "Later results"));
      });
    }
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        var e = ends(), dir = +b.dataset.dir, how = S2.reduce.matches ? "auto" : "smooth";
        if (dir < 0 ? e.start : e.end) rail.scrollTo({ left: dir < 0 ? rail.scrollWidth : 0, behavior: how });
        else rail.scrollBy({ left: dir * rail.clientWidth * 0.9, behavior: how });
      });
    });
    rail.addEventListener("scroll", sync, { passive: true });
    var ro = new ResizeObserver(function () { if (!rail.isConnected) { ro.disconnect(); return; } sync(); });
    ro.observe(rail); sync();
  }
  S2.page("today", {
    title: "Today", tab: "today",
    render: function () {
      var state = autoState();
      return '<div class="td" data-state="' + state + '"><div class="td-body" id="tdBody">' + todayBody(state) + "</div></div>";
    },
    after: function (root) { bindRail(root); tick(root); titlesIn(root); }
  });

  /* ======================================================================================================
     GAMES: the schedule as an editorial page. Each night is a section under a big condensed date; the next game night
     is an ink band; every row reads like a fixture list (time, both clubs, the score between them, the status).
     ====================================================================================================== */
  /* one row of views (review 2026-10-19): All weeks, each week, then Playoffs as the last tab, instead of a second gray
     stage pill under the weeks. week is "all", a regular-season week number or "playoffs"; an old ?stage=playoffs link
     still lands on Playoffs. */
  function gamesFilter(q) {
    var nn = nextNight(), n = +q.week;
    var wk = q.week === "playoffs" || q.stage === "playoffs" ? "playoffs" : q.week === "all" ? "all" : n >= 1 && n <= maxWeek() && n === Math.floor(n) ? String(n) : nn ? String(nn.week) : "all";
    /* a player lands on their own club's games (audit 2026-11-09: the schedule opened on every club for everyone);
       ?club=all keeps the whole league once they choose it */
    var mine = S2.mine && S2.mine();
    return { week: wk, club: M.team(q.club) ? M.team(q.club).code : q.club === "all" || !mine ? "" : mine.club };
  }
  function gamesNights(f) {
    return M.nights().slice().reverse().map(function (n) {
      var games = n.games.filter(function (g) {
        var inView = f.week === "all" || (f.week === "playoffs" ? g.stage === "playoffs" : g.stage === "regular" && String(g.week) === f.week);
        return inView && (!f.club || g.home === f.club || g.away === f.club);
      });
      return { n: n, games: games };
    }).filter(function (x) { return x.games.length; });
  }
  /* the one line that says what the filters show; it is also the polite live region, so a screen reader hears the change */
  function gamesSum(f) {
    var nights = gamesNights(f);
    if (!nights.length) return "0 games";   /* the empty state's own headline says why */
    var total = nights.reduce(function (a, x) { return a + x.games.length; }, 0), done = nights.reduce(function (a, x) { return a + x.games.filter(function (g) { return g.isFinal; }).length; }, 0);
    return S2.plural(total, "game") + ", " + done + " final, " + (total - done) + " to play" + (f.club ? ". " + full(f.club) + " " + rec(f.club) : "");
  }
  function matchRow(g, club) {
    var fin = g.isFinal, up = g.state === "upcoming";
    var side = function (code, score, home) {
      var won = fin && g.winner === code, lost = fin && g.winner && g.winner !== code;
      return '<span class="td-mx-s ' + (home ? "h" : "a") + (won ? " won" : lost ? " lost" : "") + '">' + M.crest(code) + '<span class="nm">' + esc(teamName(code)) + "</span>" +
        (fin ? '<span class="sc d-num">' + esc(score) + "</span>" : "") + "</span>";
    };
    var res = "";
    if (club && fin) { var w = g.winner === club, otl = !w && g.decision === "ot"; res = '<span class="chip ' + (w ? "win" : otl ? "" : "loss") + '">' + (w ? "W" : otl ? "OTL" : "L") + "</span>"; }
    var st = fin ? (g.forfeit ? "Forfeit (" + g.forfeit + ")" : g.label) : up ? "Preview" : M.STATE_LABEL[g.state] || g.label;
    var said = full(g.away) + " at " + full(g.home) + ", " + (fin ? (g.forfeit ? "forfeit by " + full(g.forfeit) : g.label) + ", " + g.as + " to " + g.hs : up ? g.time : st) + (g.makeup ? ", make-up game" : "");
    return '<li><a class="td-mx' + (fin ? "" : " open") + '" href="' + esc(g.href) + '" aria-label="' + esc(said) + '">' +
      '<span class="td-mx-t">' + esc(g.time) + (g.makeup ? "<small>Make-up game</small>" : "") + "</span>" + side(g.away, g.as, false) +
      '<span class="td-mx-mid" aria-hidden="true">' + (fin ? "–" : "at") + "</span>" + side(g.home, g.hs, true) +
      '<span class="td-mx-st' + (g.state === "pending" ? " pend" : "") + '">' + res + "<span>" + esc(st) + "</span></span>" + S2.chev() + "</a></li>";
  }
  /* QA visual 6 (2026-11-25): the list's empties are the ONE empty box (S2.empty, core.js) under the list's own heading,
     as Standings and Stats draw theirs, instead of a display headline of their own; actions wear the website button */
  function gEmpty(title, text, actions) { return '<div class="td-gempty">' + S2.empty("none", title, text, actions) + "</div>"; }
  function gamesList(f) {
    var nn = nextNight(), nights = gamesNights(f);
    if (f.week === "playoffs" && !nights.length) {
      var po = viewDate("playoffs_start_at");
      return gEmpty("No playoff games yet", (po ? "The playoffs begin " + esc(M.etLong(po.at)) + " at " + esc(po.time) + " ET. " : "") + "The bracket and its games appear here once the regular season ends.",
        { t: "Projected bracket", href: "#/standings?view=playoffs" });   /* S2.empty draws the website button itself (QA round 2) */
    }
    if (M.view.empty.games) return gEmpty(M.view.name + " has no games yet", "Each game night appears here once the schedule is set.");
    if (!nights.length) return gEmpty("No games match", "Nothing is scheduled for these filters.", { t: "Clear filters", data: { clear: "" } });
    return nights.map(function (x) {
        var n = x.n, isNext = nn && nn.date === n.date, lab = n.label.split(", "), md = (lab[1] || "").split(" "), meta = [];
        meta.push(nb("Week " + n.week), nb(S2.plural(x.games.length, "game")));
        if (n.forfeits && !f.club) meta.push(nb(S2.plural(n.forfeits, "forfeit")));
        if (f.club) { var w = x.games.filter(function (g) { return g.winner === f.club; }).length, fl = x.games.filter(function (g) { return g.isFinal; }).length; if (fl) meta.push(w + "-" + (fl - w) + " that night"); }
        return '<section class="td-gn' + (isNext ? " band ink" : "") + '"' + (isNext ? look() : "") + ' id="night-' + esc(n.date) + '" aria-labelledby="nh-' + esc(n.date) + '">' +
          '<header class="td-gn-h"><h2 class="td-gdate" id="nh-' + esc(n.date) + '"><span class="wd">' + esc(lab[0]) + '</span><span class="dd d-num">' + esc(md[1]) + '</span><span class="mo">' + esc(md[0]) + "</span></h2>" +
          '<p class="td-gn-meta">' + (isNext ? '<span class="chip accent">Next game night</span>' : "") + meta.map(function (m) { return "<span>" + esc(m) + "</span>"; }).join("") + "</p></header>" +
          '<ol class="td-mxl">' + x.games.map(function (g) { return matchRow(g, f.club); }).join("") + "</ol></section>";
      }).join("");
  }
  /* the club picker is site navigation, not an app pill: uppercase condensed text with a chevron, like the .arrow links */
  function clubLabel(code) {
    return (code ? M.crest(code) + "<span>" + esc(full(code)) + "</span>" : "<span>All clubs</span>") +
      '<svg class="td-dd" viewBox="0 0 12 8" aria-hidden="true"><path d="M1.5 1.5l4.5 4.5 4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  /* the views wear the site's uppercase underline row and pin under the header like the Stats and Standings tabs
     (league.css .lg-tabsbar / .lg-utabs, one look for every public view switcher); the club picker and the count sit
     on a quiet row under it */
  function gamesFilters(f) {
    var weeks = ["all"]; for (var w = 1; w <= maxWeek(); w++) weeks.push(String(w)); weeks.push("playoffs");
    return '<div class="lg-tabs-pin" aria-hidden="true"></div><div class="lg-tabsbar reveal"><div class="lg-hscroll"><div class="lg-utabs" id="tdWeek" role="group" aria-label="Week or playoffs">' + weeks.map(function (v) {
        return '<button type="button" data-v="' + v + '" aria-pressed="' + (f.week === v) + '"' + (v === "all" ? ">All weeks" : v === "playoffs" ? ">Playoffs" : ' aria-label="Week ' + v + '"><span class="w">Week </span>' + v) + "</button>";
      }).join("") + "</div></div></div>" +
      '<div class="td-gtools reveal"><button type="button" class="td-clubbtn" id="tdClub" aria-haspopup="dialog">' + clubLabel(f.club) + "</button>" +
        '<p class="td-gsum" id="tdGSum" aria-live="polite">' + esc(gamesSum(f)) + "</p></div>";
  }
  S2.page("games", {
    title: "Games", tab: "games",
    render: function (r) {
      var f = gamesFilter(r.q), left = M.games.filter(open).length, nn = nextNight(), po = viewDate("playoffs_start_at"), end = viewDate("ends_at"), none = M.view.empty.games;
      /* a season with no schedule yet says when its first game night is (Season 2: M.s2cal), never "All 0 games played" */
      var first = none && M.view.season === 2 ? M.s2cal.puckDrop : null;
      var lede = (nn ? "The next game night is " + M.etLong(nn.games[0].at) + " at " + nn.games[0].time + " ET. " : "") +
        (first ? "The schedule is set before the first game night, " + M.etLong(first) + ". " : "") +
        /* QA worst 3 (2026-11-25): a date behind the league's clock is said in the past tense (the Season 1 archive read
           "The regular season ends Friday, October 30" weeks after it did) */
        (end && !none ? "The regular season " + (Date.parse(end.at) > M.now.getTime() ? "ends " : "ended ") + M.etLong(end.at) + (po ? " and the playoffs " + (Date.parse(po.at) > M.now.getTime() ? "begin " : "began ") + M.etLong(po.at) : "") + ". " : "") + "All times Eastern.";
      /* a top-level destination wears the same .d-hero as Standings, Stats and Clubs (review 2026-10-19: .d-1 read a level down) */
      return '<div class="td-games"><section class="hero td-ghero reveal" aria-labelledby="tdGH"><span class="kicker">' + esc(M.view.name) + ' · Schedule and results</span>' +
        '<h1 class="d-hero lg-h1" id="tdGH">' + esc(none ? "No games scheduled yet" : left ? left + " games to play" : "All " + M.games.length + " games played") + '</h1><p class="lede-l">' + esc(lede) + "</p></section>" +
        gamesFilters(f) + '<div class="td-glist reveal" id="tdGList">' + gamesList(f) + "</div></div>";
    },
    after: function (root, r) {
      var f = gamesFilter(r.q), list = S2.$("#tdGList", root), sum = S2.$("#tdGSum", root), btn = S2.$("#tdClub", root), wk;
      /* a change made while the bar is pinned starts the new list at its top, not halfway down the old one */
      function toBar() {
        var pin = S2.$(".lg-tabs-pin", root), nav = S2.$("#navbar"); if (!pin) return;
        var y = Math.round(pin.getBoundingClientRect().top + window.scrollY - (nav ? nav.offsetHeight : 0));
        if (window.scrollY > y + 1) window.scrollTo(0, y);
      }
      function paint() {
        setQuery("games", { week: f.week, club: f.club || (S2.mine && S2.mine() ? "all" : "") });
        toBar();
        list.innerHTML = gamesList(f); swapIn(list); bindList();
        sum.textContent = gamesSum(f);   /* a screen reader hears what the filter changed in one line, never the 200-row list itself */
      }
      /* clearing repaints in place: every control returns to its default, then one paint */
      function clearAll() { f = { week: "all", club: "" }; btn.innerHTML = clubLabel(""); wk.set("all"); paint(); }
      function bindList() { var c = S2.$("[data-clear]", list); if (c) c.addEventListener("click", clearAll); }
      /* a phone's week row scrolls sideways now that each numeral is a 44 px target (review 2026-10-20), so the chosen week is
         kept in view: on arrival, once the brand face widens the labels, and on every switch.
         shortcut: the same helper as league.js intoRow; move both into core.js when the kit is next opened */
      function weekInView(b, now) {
        var sc = b && b.closest(".lg-hscroll"); if (!sc) return;
        var br = b.getBoundingClientRect(), sr = sc.getBoundingClientRect(), how = now || S2.reduce.matches ? "auto" : "smooth";
        var l = br.left - sr.left + sc.scrollLeft - 16, r = br.right - sr.left + sc.scrollLeft + 16;
        if (l < sc.scrollLeft) sc.scrollTo({ left: l, behavior: how });
        else if (r > sc.scrollLeft + sc.clientWidth) sc.scrollTo({ left: r - sc.clientWidth, behavior: how });
      }
      wk = S2.segmented(S2.$("#tdWeek", root), function (v, b) { weekInView(b); if (f.week !== v) { f.week = v; paint(); } });
      var weekOn = function () { weekInView(S2.$('#tdWeek button[aria-pressed="true"]', root), true); };
      weekOn(); if (document.fonts) document.fonts.ready.then(weekOn);
      btn.addEventListener("click", function () {
        var opt = function (code, label, sub, crest) {
          return '<button class="row inset td-pick" data-club="' + esc(code) + '" aria-pressed="' + (f.club === code) + '">' + crest + '<span class="grow"><span class="title">' + esc(label) + '</span><br><span class="sub">' + esc(sub) + "</span></span>" +
            (f.club === code ? '<span class="td-tick">' + S2.ic("check") + "</span>" : "") + "</button>";
        };
        var html = '<div class="list">' + opt("", "All clubs", M.games.length + " games", '<span class="td-ofi">' + S2.ic("clubs") + "</span>") + "</div>" +
          M.league.divisions.map(function (d) {
            return '<h3 class="t-cap td-sheet-h">' + esc(d) + '</h3><div class="list">' + M.teams.filter(function (t) { return t.division === d; }).sort(function (a, b) { return ((ST[a.code] || {}).rank || 9) - ((ST[b.code] || {}).rank || 9); }).map(function (t) {
              return opt(t.code, t.full, rec(t.code) + " · " + divPlace(t.code), M.crest(t.code));
            }).join("") + "</div>";
          }).join("");
        var sh = S2.sheet({ title: "Club", html: html });
        S2.$$("[data-club]", sh.body).forEach(function (b) {
          b.addEventListener("click", function () {
            f.club = b.dataset.club;
            btn.innerHTML = clubLabel(f.club);
            if (f.club && f.week !== "all") { f.week = "all"; wk.set("all"); }   /* a club's season reads best whole; the week control follows */
            paint();
            sh.close();
          });
        });
      });
      bindList();
    }
  });

  /* ======================================================================================================
     GAME CENTER: one page per fixture. The match room is an ink band (crests large, the score in huge condensed
     numerals); the Three Stars, club stats, box score and head to head follow as editorial sections. Preview before
     puck drop, final after, each game in the model's own state (M.gameState).
     ====================================================================================================== */
  /* one comparison row for the tale of the tape and the club stats. A null side (no games yet, a rate EA never sent)
     prints "–" and draws no bar, and neither side is called better: a missing number never wins or loses a row. */
  function cmpRow(label, a, h, better, fmt, cls) {
    /* QA visual 33 (2026-11-25): a row neither club has a figure for says nothing, so it is not drawn (time on attack and
       passing are not stored yet, and read "– Time on attack –" on every game); it returns by itself once they are */
    if (a == null && h == null) return "";
    var has = a != null && h != null && isFinite(a) && isFinite(h), max = has ? Math.max(a, h) || 1 : 1;
    var aBest = has && (better === "high" ? a > h : a < h), hBest = has && (better === "high" ? h > a : h < a);
    var val = function (x) { return x == null || x === "" || (typeof x === "number" && !isFinite(x)) ? "–" : fmt(x); };
    var bar = function (x, best, side) { return '<span class="b ' + side + '">' + (has ? '<i class="' + (best ? "best" : "") + '" style="width:' + (x / max * 100).toFixed(1) + '%"></i>' : "") + "</span>"; };
    return '<div class="td-tape-r' + (cls ? " " + cls : "") + '"><span class="v d-num' + (aBest ? " best" : "") + '">' + esc(val(a)) + "</span>" + (better ? bar(a, aBest, "l") : "<span></span>") +
      '<span class="k">' + esc(label) + "</span>" + (better ? bar(h, hBest, "r") : "<span></span>") + '<span class="v d-num' + (hBest ? " best" : "") + '">' + esc(val(h)) + "</span></div>";
  }
  /* the two clubs' colors as CSS variables (--ca away, --ch home), from validated hex only; the comparison bars draw with
     them, so each bar names its club (review 2026-10-19). The match room's top strip went (audit 2026-11-09) */
  function clubVars(g) {
    var a = clubColor(g.away), h = clubColor(g.home);
    return a || h ? ' style="' + (a ? "--ca:" + a + ";" : "") + (h ? "--ch:" + h : "") + '"' : "";
  }
  function tapeHead(g) {
    return '<div class="td-tape-h"><span>' + M.crest(g.away) + esc(teamName(g.away)) + "</span><span>" + esc(teamName(g.home)) + M.crest(g.home) + "</span></div>";
  }
  function tape(g) {
    var A = ST[g.away], H = ST[g.home]; if (!A || !H) return "";
    /* Season 2 opening week: every club is at 0 games, and a per-game rate of nothing is not a comparison */
    if (!(A.gp >= 1 && H.gp >= 1)) return '<div class="td-tape"><h3 class="d-3">Stats comparison</h3><p class="t-sub">The stats comparison starts after each club\'s first game.</p></div>';
    var per = function (n, d) { return d ? n / d : null; }, wins = function (r) { return (r.last5 || []).filter(function (x) { return x === "W"; }).length; };
    var n = function (v) { return String(v); }, f2 = function (v) { return v.toFixed(2); }, pc = function (v) { return v.toFixed(1) + "%"; };
    return '<div class="td-tape"' + clubVars(g) + '><h3 class="d-3">Stats comparison</h3>' + tapeHead(g) +
      cmpRow("Points", A.pts, H.pts, "high", n) +
      cmpRow("Goals for per game", per(A.gf, A.gp), per(H.gf, H.gp), "high", f2) +
      cmpRow("Goals against per game", per(A.ga, A.gp), per(H.ga, H.gp), "low", f2) +
      cmpRow("Power play", A.pp_pct, H.pp_pct, "high", pc) +
      cmpRow("Penalty kill", A.pk_pct, H.pk_pct, "high", pc) +
      cmpRow("Wins in the last five", wins(A), wins(H), "high", n) + "</div>";
  }
  function h2hSection(g) {
    var s = series(g.away, g.home, g.at);
    var hh = !s.ms.length ? esc("First meeting of the season") : (!s.lead ? esc("The season series is level, ") : esc(city(s.lead) + " leads the series ")) + scoreSpan(s.hi, s.lo);
    return '<section class="td-sec td-h2h reveal" aria-labelledby="tdH2H">' +
      S2.secHead({ kicker: "Season series", id: "tdH2H", hh: hh, p: esc(s.ms.length ? "Every meeting this season, newest first" + (g.isFinal ? ", this game included." : ".") : seriesText(s)), href: "#/games?week=all&club=" + g.home, link: city(g.home) + " schedule" }) +
      /* 2026-11-08 (commissioner: "Add a Head to head title like the tale of the tape except change tale of the tape to stats
         comparison"; "Make sure they are aligned symmetrically"): two equal columns, each a d-3 title over a 2px ink header row of
         the same height, rows of the same height under it, so the two lists start and step on the same lines. */
      '<div class="td-h2h-grid"><div class="td-h2h-col"><h3 class="d-3">Head to head</h3>' + (s.ms.length ? '<div class="td-meet-h" aria-hidden="true"><span>Date</span><span>Score</span><span>Result</span></div><ol class="td-meet">' + s.ms.slice().reverse().map(function (m) {
          return '<li><a href="' + esc(m.href) + '"><span class="dt">' + esc(m.date) + '</span><span class="td-meet-s"><b class="' + (m.winner === m.away ? "w" : "") + '">' + esc(m.away) + ' <span class="d-num">' + m.as + '</span></b><span aria-hidden="true">–</span><b class="' + (m.winner === m.home ? "w" : "") + '"><span class="d-num">' + m.hs + "</span> " + esc(m.home) + "</b></span>" +
            '<span class="lb">' + esc(m.id === g.id ? "This game" : m.forfeit ? "Forfeit (" + m.forfeit + ")" : m.label) + "</span>" + S2.chev() + "</a></li>";
        }).join("") + "</ol>" : '<p class="t-sub">No meetings yet this season.</p>') + "</div>" + tape(g) + "</div></section>";
  }
  var SLOTS = ["LW", "C", "RW", "LD", "RD", "G"], LU_COL = { LW: "lw", C: "center", RW: "rw", LD: "ld", RD: "rd", G: "goalie" };
  function lockOf(g) { return new Date(Date.parse(g.at) - 30 * 60000).toISOString(); }   /* Rule 5.3: thirty (30) minutes before puck drop */
  /* the two clubs' filed sheets for one game (game_lineups), read once the lineups lock: the classic matchup page's read
     (CG.loadMatchupLineups, src/live/part_live.js), public from the lock by game_lineups_read (audit fixes 2026-09-17).
     Before the lock each club's sheet is its own (Rule 5.3), so nothing is read or guessed. LU[game id] is {wait} while
     reading, {rows: {code: row|null}} once read, or {err}; the section repaints itself in place when the read lands */
  var LU = {};
  function luRead(g) {
    var x = LU[g.id]; if (x && (x.wait || x.rows)) return;
    var codes = [g.away, g.home], ids = codes.map(function (c) { return S2.lobby ? S2.lobby.teamId(c) : null; });
    var paint = function () { S2.$$('[data-lu-g="' + g.id + '"]').forEach(function (el) { var n = M.game(g.id); if (n) { el.outerHTML = lineupsSection(n, lockOf(n), true); var f = S2.$('[data-lu-g="' + g.id + '"]'); if (f) f.classList.add("in"); } }); };
    LU[g.id] = { wait: true };
    Promise.resolve().then(function () {
      var c = S2.ensureSb ? S2.ensureSb() : null;
      if (!c) throw new Error("Not connected to the league. Reload the page to try again.");
      if (!ids[0] || !ids[1]) throw new Error("The league data names no club id for " + codes.join(" or ") + ".");
      return c.from("game_lineups").select("team_id,center,lw,rw,ld,rd,goalie,post_lock,post_lock_count").eq("game_id", g.id).in("team_id", ids);
    }).then(function (r) {
      if (r && r.error) throw new Error(r.error.message || "The league did not answer.");
      var rows = {}; codes.forEach(function (c, i) { rows[c] = ((r && r.data) || []).filter(function (x) { return x.team_id === ids[i]; })[0] || null; });
      LU[g.id] = { rows: rows };
    }).catch(function (e) { console.error("Game Center: the lineups of " + g.id + " could not be read", e); LU[g.id] = { err: e.message || String(e) }; }).then(paint);
  }
  function lineupsSection(g, lockAt, locked) {
    var lock = nb(M.etTime(lockAt) + " ET"), x = locked ? LU[g.id] : null;
    if (locked && !x) { luRead(g); x = LU[g.id]; }
    var side = function (code) {
      var row = x && x.rows ? x.rows[code] : null, body;
      if (!locked) body = '<ol class="td-lu-l">' + SLOTS.map(function (sl) { return '<li><span class="pos">' + esc(sl) + '</span><span class="td-lu-bar" aria-hidden="true"></span><span class="sr">revealed at ' + esc(lock) + "</span></li>"; }).join("") + "</ol>";
      else if (!x || x.wait) body = '<p class="t-foot">Reading the lineup.</p>';
      else if (x.err) body = '<p class="t-foot">The lineup could not be read.</p>';
      else if (!row) body = '<p class="t-foot">No lineup on file.</p>';
      else body = '<ol class="td-lu-l">' + SLOTS.map(function (sl) {
        var p = row[LU_COL[sl]] ? M.player(row[LU_COL[sl]]) : null;
        return '<li><span class="pos">' + esc(sl) + "</span>" + (p ? '<a href="' + esc(p.href) + '">' + esc(p.tag) + "</a>" + (p.num != null ? '<span class="t-foot num">#' + p.num + "</span>" : "") : '<span class="t-foot">Open</span>') + "</li>";
      }).join("") + "</ol>" + (row.post_lock ? '<p class="t-foot"><span class="chip warn td-late">Late change</span></p>' : "");
      return '<div class="td-lu"><h3 class="td-lu-h">' + M.crest(code) + "<span>" + esc(full(code)) + "</span></h3>" + body + "</div>";
    };
    var p = !locked ? "Each club's six are revealed at " + lock + ", when lineups lock 30 minutes before puck drop (Rule 5.3)."
      : x && x.err ? "The league did not answer: " + x.err : "Locked at " + lock + ", 30 minutes before puck drop (Rule 5.3). A change after the lock is marked.";
    return '<section class="td-sec td-lineups reveal" data-lu-g="' + esc(g.id) + '" aria-labelledby="tdLuH">' +
      S2.secHead({ kicker: "Lineups", id: "tdLuH", h: locked ? "The lineups are locked" : "Lineups lock at " + lock, p: esc(p),
        aside: locked && x && x.err ? '<button type="button" class="btn site outline td-lu-btn" data-lu="retry">Try again</button>' : "" }) +
      '<div class="td-lu-grid">' + side(g.away) + side(g.home) + "</div></section>";
  }
  function watchSection(g) {
    var top = {};
    [g.away, g.home].forEach(function (code) { top[code] = M.lines({ club: code, role: "S", former: false, sort: "p", limit: 2 }); });
    var la = top[g.away][0], lh = top[g.home][0], lead = la && (!lh || la.p >= lh.p) ? la : lh || null, other = lead === la ? lh : la;
    var col = function (code) {
      var sk = top[code], gk = M.lines({ club: code, role: "G", former: false, sort: "gp", limit: 1 })[0];
      return '<div class="td-pw"><h3 class="td-lu-h">' + M.crest(code) + "<span>" + esc(full(code)) + "</span></h3>" +
        sk.map(function (l) { return '<a class="td-pw-r" href="' + esc(l.href) + '"><span class="tag">' + esc(l.tag) + '</span><span class="t-foot">' + esc(l.pos) + " · " + l.gp + ' GP</span><span class="v"><b class="d-num">' + l.p + "</b><small>PTS</small></span></a>"; }).join("") +
        (gk ? '<a class="td-pw-r" href="' + esc(gk.href) + '"><span class="tag">' + esc(gk.tag) + '</span><span class="t-foot">G · ' + esc(gk.record) + '</span><span class="v"><b class="d-num">' + esc(M.display("sv_pct", gk.sv_pct)) + "</b><small>SV%</small></span></a>" : "") +
        (sk.length || gk ? "" : '<p class="t-sub">No games played yet.</p>') + "</div>";
    };
    var cols = col(g.away) + col(g.home);
    return '<section class="td-sec td-watchsec reveal" aria-labelledby="tdPwH">' +
      S2.secHead({ kicker: "Players to watch", id: "tdPwH", h: lead ? lead.tag + " has " + lead.p + " points for " + city(lead.club) : "Players to watch",
        p: other ? esc(other.tag + " leads " + city(other.club) + " with " + other.p + " points.") : "" }) +
      '<div class="td-lu-grid">' + cols + "</div></section>";
  }
  function starLine(s) {
    return s.lines.map(function (o) {
      return o.role === "G" ? o.sv + " saves on " + o.sa + " shots" + (o.sa ? ", " + M.display("sv_pct", o.svpct) : "")
        : o.g + (o.g === 1 ? " goal" : " goals") + ", " + o.a + (o.a === 1 ? " assist" : " assists") + ", " + o.sog + (o.sog === 1 ? " shot" : " shots");
    }).join("; in goal, ");
  }
  function starsSection(g) {
    if (!g.stars.length) return "";
    var s1 = g.stars[0];
    return '<section class="td-sec td-stars reveal" aria-labelledby="tdStH">' +
      S2.secHead({ kicker: "Three Stars", id: "tdStH", h: s1.tag + " takes the first star", p: esc(cap(starLine(s1)) + " for " + full(s1.club) + ".") }) +
      '<ol class="td-stars3">' + g.stars.map(function (s) {
        var c = clubColor(s.club);
        return '<li><a href="' + esc(s.href) + '"' + (c ? ' style="--club:' + c + '"' : "") + '><span class="n d-num" aria-label="Star ' + s.n + '">' + s.n + "</span>" + M.crest(s.club, "lg") +
          '<span class="tag' + tagCls(s.tag) + '">' + esc(s.tag) + '</span><span class="ln">' + esc(cap(starLine(s))) + '</span><span class="cl">' + esc(full(s.club)) + "</span></a></li>";
      }).join("") + "</ol></section>";
  }
  function statsSection(g) {
    var A = g.totals[g.away], H = g.totals[g.home]; if (!A || !H || !g.box[g.away].length) return "";
    var W = g.totals[g.winner], L = g.totals[g.loser], hh = esc("The club stats");
    if (W && L) hh = W.sog > L.sog ? esc(city(g.winner) + " outshot " + city(g.loser) + " ") + scoreSpan(W.sog, L.sog) : W.sog < L.sog ? esc(city(g.winner) + " won despite being outshot ") + scoreSpan(L.sog, W.sog) : esc("Both clubs had " + W.sog + " shots");
    var pa = A.toa, ph = H.toa, more = pa > ph ? g.away : g.home;
    var p = pa != null && ph != null && pa !== ph ? city(more) + " spent longer on the attack, " + M.toi(Math.max(pa, ph)) + " to " + M.toi(Math.min(pa, ph)) + "." : "";
    var n = function (v) { return String(v); }, pc = function (v) { return Math.round(v * 100) + "%"; };
    return '<section class="td-sec td-cstats reveal" aria-labelledby="tdCsH">' +
      S2.secHead({ kicker: "Club stats", id: "tdCsH", hh: hh, p: esc(p) }) +
      '<div class="td-tape td-tape-game"' + clubVars(g) + ">" + tapeHead(g) +
        cmpRow("Shots", A.sog, H.sog, "high", n) + cmpRow("Time on attack", A.toa, H.toa, "high", M.toi) + cmpRow("Passing", A.pass_pct, H.pass_pct, "high", pc) +
        cmpRow("Faceoffs won", A.fo_pct, H.fo_pct, "high", pc) + cmpRow("Hits", A.hits, H.hits, "high", n) + cmpRow("Blocks", A.blk, H.blk, "high", n) +
        cmpRow("Takeaways", A.tk, H.tk, "high", n) + cmpRow("Interceptions", A.int, H.int, "high", n) + cmpRow("Giveaways", A.gv, H.gv, "low", n) +
        cmpRow("Penalty minutes", A.pim, H.pim, "low", n) +
        cmpRow("Power play goals / chances", A.pp, H.pp, null, n, "td-pp") + "</div></section>";
  }
  /* both clubs' tables share one column plan (name first, the rest equal), so stacked on desktop their columns line up */
  var COLS = '<colgroup><col class="td-c-nm"></colgroup>';
  function boxTable(g, code, on) {
    var lines = g.box[code] || [], sk = lines.filter(function (o) { return o.role === "S"; }), gk = lines.filter(function (o) { return o.role === "G"; });
    var name = function (o) {
      var chips = (o.twoRole ? '<span class="chip accent">Both roles</span>' : o.offRole ? '<span class="chip">' + (o.role === "G" ? "Usually skates" : "Usually in goal") + "</span>" : "") + (o.former ? '<span class="chip">Former</span>' : "");
      /* QA worst 5 (2026-11-25): on the stacked desktop table the name cell is a fixed 30%, and a long tag cut the chip after
         it ("Usually skates" vanished at 1024). The tag and its chips share a row in which only the tag shrinks (today.css),
         and the tag carries its full spelling as a title */
      return '<th scope="row" class="nm"><span class="td-nmw">' + (o.href ? '<a class="td-nmt" href="' + esc(o.href) + '" title="' + esc(o.tag) + '">' + esc(o.tag) + "</a>" : '<span class="td-unid td-nmt" title="' + esc(o.tag) + '">' + esc(o.tag) + "</span>") + chips + "</span></th>";
    };
    var t = g.totals[code] || {};
    return '<div class="td-boxclub' + (on ? " on" : "") + '" data-club="' + esc(code) + '"><h3 class="td-boxclub-h">' + M.crest(code) + '<span class="nm">' + esc(full(code)) + '</span><span class="d-num td-boxsc">' + esc(code === g.home ? g.hs : g.as) + "</span></h3>" +
      (sk.length ? '<div class="tbl-wrap td-tblw"><table class="tbl td-box"><caption class="sr">' + esc(full(code)) + ' skaters</caption>' + COLS + '<thead><tr><th scope="col">Skaters</th><th scope="col" title="Position played">Pos</th><th scope="col">G</th><th scope="col">A</th><th scope="col">P</th><th scope="col" title="Plus-minus">+/-</th><th scope="col" title="Shots on goal">SOG</th><th scope="col">Hits</th><th scope="col" title="Takeaways">TK</th><th scope="col" title="Giveaways">GV</th><th scope="col" title="Faceoffs won of taken">FO</th><th scope="col" title="Time on ice">TOI</th></tr></thead><tbody>' +
        sk.map(function (o) {
          return "<tr>" + name(o) + "<td>" + esc(o.pos) + '</td><td class="num">' + o.g + '</td><td class="num">' + o.a + '</td><td class="num b">' + o.p + '</td><td class="num">' + (o.pm > 0 ? "+" + o.pm : o.pm < 0 ? "\u2212" + (-o.pm) : "0") + '</td><td class="num">' + o.sog + '</td><td class="num">' + o.hits + '</td><td class="num">' + o.tk + '</td><td class="num">' + o.gv + '</td><td class="num">' + (o.fot ? o.fow + "/" + o.fot : "–") + '</td><td class="num">' + esc(M.toi(o.toi_s)) + "</td></tr>";
        }).join("") +
        '</tbody><tfoot><tr><th scope="row">Totals</th><td></td><td class="num">' + (t.g || 0) + '</td><td class="num">' + (t.a || 0) + '</td><td class="num b">' + ((t.g || 0) + (t.a || 0)) + '</td><td></td><td class="num" title="EA\'s club count, which can run above what the players\' shots add up to">' + (t.sog || 0) + '</td><td class="num">' + (t.hits || 0) + '</td><td class="num">' + (t.tk || 0) + '</td><td class="num">' + (t.gv || 0) + '</td><td class="num">' + (t.fot ? t.fow + "/" + t.fot : "–") + "</td><td></td></tr></tfoot></table></div>" : "") +
      (gk.length ? '<div class="tbl-wrap td-tblw"><table class="tbl td-box"><caption class="sr">' + esc(full(code)) + ' goaltenders</caption>' + COLS + '<thead><tr><th scope="col">Goaltenders</th><th scope="col" title="Shots against">SA</th><th scope="col">Saves</th><th scope="col" title="Goals against">GA</th><th scope="col" title="Save percentage">SV%</th><th scope="col" title="Desperation saves">DS</th><th scope="col" title="Shutout periods: periods with no goal against">SOP</th><th scope="col" title="Penalty shots stopped">PS</th><th scope="col" title="Time on ice">TOI</th></tr></thead><tbody>' +
        gk.map(function (o) { return "<tr>" + name(o) + '<td class="num">' + o.sa + '</td><td class="num">' + o.sv + '</td><td class="num">' + o.ga + '</td><td class="num b">' + esc(M.display("sv_pct", o.svpct)) + '</td><td class="num">' + (o.dsv || 0) + '</td><td class="num">' + (o.sop || 0) + '</td><td class="num">' + (o.psa ? o.psv + "/" + o.psa : "–") + '</td><td class="num">' + esc(M.toi(o.toi_s)) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : "") + "</div>";
  }
  function boxNews(g) {
    var best = null, bestClub = null, n = {};
    [g.away, g.home].forEach(function (code) {
      var sk = (g.box[code] || []).filter(function (o) { return o.role === "S"; });
      n[code] = sk.filter(function (o) { return o.g > 0; }).length;
      sk.forEach(function (o) { if (!best || o.p > best.p || (o.p === best.p && o.g > best.g)) { best = o; bestClub = code; } });
    });
    var who = function (k) { return words(k) + (k === 1 ? " player" : " players"); }, a = n[g.away], h = n[g.home];
    /* a tie on points is said as a tie (audit 2026-11-09: one player "led with two points" while another had two as well);
       the goals tiebreak picked one name the reader could not see */
    var level = [];
    if (best) [g.away, g.home].forEach(function (code) { (g.box[code] || []).forEach(function (o) { if (o.role === "S" && o.p === best.p) level.push({ o: o, club: code }); }); });
    var oneClub = level.every(function (x) { return x.club === level[0].club; }), pts = best ? words(best.p) + (best.p === 1 ? " point" : " points") : "";
    var tied = level.length === 2 ? level[0].o.tag + " and " + level[1].o.tag : cap(words(level.length)) + " players";
    return {
      h: !best || !best.p ? "The box score" : best.g >= 2 && level.filter(function (x) { return x.o.g === best.g; }).length === 1 ? best.tag + " scored " + words(best.g) + " goals for " + city(bestClub)
        : level.length > 1 ? tied + " shared the lead with " + pts + (oneClub ? " for " + city(level[0].club) : "")
        : best.tag + " led with " + pts + " for " + city(bestClub),
      p: a && h ? cap(who(a)) + " scored for " + city(g.away) + " and " + words(h) + " for " + city(g.home) + "." : a || h ? cap(who(a || h)) + " scored for " + city(a ? g.away : g.home) + "; " + city(a ? g.home : g.away) + " did not score." : ""
    };
  }
  function boxSection(g) {
    if (!g.hasBox) return "";
    var news = boxNews(g);
    return '<section class="td-sec td-boxsec reveal" aria-labelledby="tdBoxH">' +
      S2.secHead({ kicker: "Box score", id: "tdBoxH", h: news.h, p: esc(news.p),
        aside: '<div class="lg-utabs sm td-boxseg" id="tdBoxSeg" role="group" aria-label="Club"><button type="button" data-v="' + esc(g.away) + '" aria-pressed="true">' + esc(teamName(g.away)) + '</button><button type="button" data-v="' + esc(g.home) + '" aria-pressed="false">' + esc(teamName(g.home)) + "</button></div>" }) +
      '<div class="td-box2">' + boxTable(g, g.away, true) + boxTable(g, g.home, false) + "</div></section>";
  }
  /* ONE "About this data" per page, like every league and profile page (review 2026-10-19): the method notes that sat
     under each section (the star formula, the giveaway note, EA's D without a side, the chips, the tape) live here */
  function aboutGame(g, v, boxed) {
    var ps = [];
    if (boxed && g.stars.length) ps.push("Three Stars use the league formula: goals, assists, shots and plus-minus for skaters; saves, save percentage, a win and a shutout for goaltenders.");
    if (boxed && g.totals[g.away] && g.totals[g.home]) ps.push("Club stats come from the EA box score. Shots, time on attack and passing are EA's own club figures, every sitting of a game added together; the rest add up the player lines. Giveaways count every lost puck, and for giveaways and penalty minutes fewer is better. In each row the side that did better is drawn at full strength in its club color.");
    if (boxed) {
      var box = "The box score has one line per player per role, at the position EA recorded. EA records defense as D, without a side. A club's shots in the Totals row are EA's club count, which can run above what its players' shots add up to and usually matches what the other goaltender faced, within a shot or two. For a goaltender, DS is desperation saves, SOP is shutout periods (periods with no goal against) and PS is penalty shots stopped.";
      if (g.offRoleCount) box += " A chip marks a player in the role they play less this season; their line counts in that role.";
      if (g.formerCount) box += " Former marks a player no longer on a roster; the line still counts.";
      if (g.unidentified) box += " An unidentified line is one EA recorded for a gamertag not linked to a member; staff link it in the Game desk.";
      ps.push(box);
    }
    if (v.state !== "voided") ps.push("The stats comparison covers the two clubs' " + M.view.name + " regular seasons to date. For goals against, lower is better.");
    if (!boxed && v.state !== "voided" && v.state !== "final") ps.push("Players to watch are each club's two leading scorers and its busiest goaltender this season, every game counted, at every position played.");
    if (!ps.length) return "";
    return S2.about(ps.map(esc));   /* core's one disclosure (audit 2026-11-09: three designs of About this data) */
  }
  /* the way into a case about this game: the case form (js/flows.js) opens with the game already picked */
  function reportLine(g) {
    return '<div class="td-sec td-report"><a class="arrow" href="#/you" data-flow="case" data-type="complaint" data-game="' + esc(g.id) + '"><span>Report a problem with this game</span>' + S2.ic("chev") + "</a></div>";
  }
  function alsoSection(g) {
    var n = M.nights().filter(function (x) { return x.date === g.night; })[0], others = n ? n.games.filter(function (x) { return x.id !== g.id; }) : [];
    if (!others.length) return "";
    return '<section class="td-sec td-also reveal" aria-labelledby="tdAlsoH">' +
      S2.secHead({ kicker: "Also that night", id: "tdAlsoH", h: M.etLong(g.at), aside: '<div class="td-rail-ctl">' + railBtn(-1) + railBtn(1) + "</div>" }) +
      '<div class="td-rail" id="tdRail" tabindex="0" role="region" aria-label="' + esc("Other games, " + M.etLong(g.at)) + '">' + others.map(function (x) { return tile(x); }).join("") + "</div>" +
      '<div class="td-mc-more">' + arrow("#/games?week=" + g.week, "Week " + g.week + " schedule") + "</div></section>";
  }
  function room(g, v) {
    var st = v.state, fin = st === "final";
    var side = function (code) {
      var won = fin && v.winner === code, lost = fin && v.winner && v.winner !== code;
      return '<a class="td-room-side' + (won ? " won" : lost ? " lost" : "") + '" href="#/club/' + esc(code) + '">' + M.crest(code, "xl") +
        '<span class="c">' + esc(city(code)) + '</span><span class="n d-2">' + esc(teamName(code)) + '</span><span class="r">' + esc(rec(code)) + "<br>" + esc(divPlace(code)) + "</span></a>";
    };
    var mid, note = "", other = g.forfeit === g.home ? g.away : g.home;
    if (fin) mid = '<div class="td-room-score d-num"><span class="' + (v.winner === g.away ? "w" : "l") + '">' + esc(v.as) + '</span><span class="dash" aria-hidden="true">–</span><span class="' + (v.winner === g.home ? "w" : "l") + '">' + esc(v.hs) + "</span></div>" +
      '<span class="td-room-st">' + esc(g.forfeit ? "Forfeit" : v.label) + "</span>";
    else if (st === "live") mid = '<div class="td-room-live d-2"><i class="dot-live" aria-hidden="true"></i>Live</div><span class="td-room-sub">Puck drop ' + esc(g.time) + (v.label !== M.STATE_LABEL.live ? ", " + esc(v.label) : "") + "</span>";
    else if (st === "pending") mid = '<div class="td-room-pend d-2">Result pending</div>';
    else if (st === "voided") mid = '<div class="td-room-pend d-2">Voided</div>';
    else mid = '<div class="td-room-time d-num">' + esc(g.time.replace(/ [AP]M$/, "")) + "<small>" + esc(((g.time.match(/[AP]M$/) || ["PM"])[0]) + " ET") + '</small></div><span class="td-room-sub" data-until="' + esc(g.at) + '"></span>';
    if (fin && g.forfeit) note = full(g.forfeit) + " forfeited. " + (g.kept ? "The forfeit decides the result, a win for " + full(other) + ". The game was played and its box score stands, so every line below counts in the season totals."
      : "The result counts in the standings as a win for " + full(other) + ". No box score was recorded for this game, so no player lines count from it.");
    else if (fin && !g.hasBox) note = "The result is filed, but EA sent no player lines for this game. Staff can attach them in the Game desk.";
    else if (st === "pending") note = "This game passed its 30-minute live window and no final has arrived yet. The score and box score appear as soon as EA sends them or staff file the result.";
    else if (st === "voided") note = "The league office voided this game. It does not count in the standings or in any player line.";
    /* the page title for headings and the large-title collapse; visually the crests and the score are the title */
    var said = full(g.away) + " at " + full(g.home) + ", " + (fin ? v.label + " " + v.as + " to " + v.hs : st === "live" ? "live" : st === "upcoming" ? M.etDateTime(g.at) : M.STATE_LABEL[st] || v.label);
    var arena = M.team(g.home) && M.team(g.home).arena;
    /* Juventus match center: under a final, who scored for each side (from the box lines, keyed by club code) */
    var goals = fin && g.hasBox ? [g.away, g.home].map(function (code) {
      var t = {}, order = [];
      (g.box[code] || []).forEach(function (o) { if (o.g > 0) { if (!(o.tag in t)) { t[o.tag] = 0; order.push(o.tag); } t[o.tag] += o.g; } });
      /* each scorer in a no-break span, so the line wraps between scorers, never inside a gamertag (review 2026-10-20) */
      return { code: code, html: order.sort(function (a, b) { return t[b] - t[a]; }).map(function (k) { return '<span class="nb">' + esc(k + (t[k] > 1 ? " " + t[k] : "")) + "</span>"; }).join(", ") };
    }) : null;
    /* a second row of the room's own grid, so each line sits exactly under its club whatever the score's width */
    var goalsRow = goals && (goals[0].html || goals[1].html) ? goals.map(function (x, i) {
      /* .cc: the club code shows only on a phone, where the line sits under the score instead of under its crest */
      return (i ? '<span aria-hidden="true"></span>' : "") + '<p class="td-room-goals"><span class="sr">' + esc(city(x.code) + " goals: ") + '</span><span class="cc" aria-hidden="true">' + esc(x.code) + "</span>" + (x.html || "No goals") + "</p>";
    }).join("") : "";
    return '<section class="band ink td-room reveal"' + look() + ' aria-labelledby="tdRoomH"><div class="td-room-top">' +
        '<nav class="td-crumbs" aria-label="Breadcrumb"><a href="#/games">Games</a><span aria-hidden="true">/</span><a href="' + "#/games?week=" + g.week + '">Week ' + g.week + "</a></nav>" +
        (S2.has("staff") ? '<a class="btn site outline td-deskbtn" href="#/desk/game/' + esc(g.id) + '">Open in Game desk</a>' : "") + "</div>" +
      '<div class="page-head td-room-ph"><span class="kicker">' + esc("Week " + g.week + " · " + M.etLong(g.at) + " · " + nb(g.time + " ET") + (g.makeup ? " · Make-up game" : "") + (arena ? " · " + arena : "")) + "</span>" +
        '<h1 class="t-large sr" id="tdRoomH">' + esc(said) + "</h1></div>" +
      '<div class="td-room-main">' + side(g.away) + '<div class="td-room-mid">' + mid + "</div>" + side(g.home) + goalsRow + "</div>" +
      (note ? '<p class="td-room-note">' + esc(note) + "</p>" : "") + "</section>";
  }
  /* QA function 3 (2026-11-25): the model holds the season on screen only, so a link to another season's game (a saved
     Season 1 link, a notification's link_view game, #/matchup/<id>) missed here and said "Game not found ... It may have
     been rescheduled". The page asks the league which season holds the game (games.season_id, one row by id) and opens it
     there (?season=<n>, a fresh league read); only an id no season holds is not found. One lookup per id per visit */
  var GFIND = {};
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function gameMissing(id) {
    var f = GFIND[id] || { state: UUID.test(String(id || "")) ? "looking" : "none" };
    var shell = function (h, lede, btns, role) {
      return '<div class="td-gc"><section class="hero reveal" aria-labelledby="tdNfH"' + (role ? ' role="' + role + '"' : "") + '><span class="kicker">Games</span><h1 class="d-1" id="tdNfH">' + esc(h) + "</h1>" +
        '<p class="lede-l">' + lede + "</p>" + (btns ? '<div class="td-btns">' + btns + "</div>" : "") + "</section></div>";
    };
    if (f.state === "looking") return shell("Opening the game", "Finding the season this game belongs to.", "", "status");
    if (f.state === "err") return shell("The game could not be opened", esc("The league did not answer: " + (f.err && f.err.message || "no reason given") + "."),
      '<button type="button" class="btn site" data-gfind="retry">Try again</button><a class="btn site outline" href="#/games">All games</a>');
    return shell("Game not found", "No game has this address.", '<a class="btn site" href="#/games">All games</a>');
  }
  function findGame(root, id) {
    if (GFIND[id] || !UUID.test(String(id || ""))) return;
    GFIND[id] = { state: "looking" };
    var paint = function () { var gc = S2.$(".td-gc", root); if (!gc || S2.parse().name !== "game" || S2.parse().arg !== id) return; gc.outerHTML = gameMissing(id); bindMissing(root, id); };
    Promise.resolve().then(function () {
      var c = S2.ensureSb ? S2.ensureSb() : null;
      if (!c) throw new Error("the league's data service is not on this page");
      return c.from("games").select("season_id").eq("id", id).maybeSingle();
    }).then(function (res) {
      if (res && res.error) throw new Error(res.error.message || "games did not answer");
      var sid = res && res.data && res.data.season_id, s = sid ? M.control.seasons.filter(function (x) { return x.settings && x.settings.id === sid; })[0] : null;
      if (!s || s.number === M.view.season) { GFIND[id] = { state: "none" }; paint(); return; }
      var q = new URLSearchParams(location.search); q.set("season", s.number);
      location.replace("?" + q.toString() + "#/game/" + id);
    }).catch(function (e) { console.error("Game: the season of game " + id + " could not be looked up:", e); GFIND[id] = { state: "err", err: e }; paint(); });
  }
  function bindMissing(root, id) {
    var again = S2.$('[data-gfind="retry"]', root);
    if (again) again.addEventListener("click", function () { delete GFIND[id]; var gc = S2.$(".td-gc", root); if (gc) gc.outerHTML = gameMissing(id); findGame(root, id); });
  }
  S2.page("game", {
    title: function (r) { var g = M.game(r.arg); return g ? g.away + " at " + g.home : "Game"; },
    tab: "games",
    render: function (r) {
      var g = M.game(r.arg);
      if (!g) return gameMissing(r.arg);
      var v = { state: g.state, hs: g.hs, as: g.as, winner: g.winner, label: g.label };
      var html = '<div class="td-gc">' + room(g, v), boxed = v.state === "final" && g.hasBox;
      /* no lineups and no lobby code under a final score (review 2026-11-23) */
      if (v.state === "final") html += (boxed ? starsSection(g) + statsSection(g) + boxSection(g) : "") + h2hSection(g);
      else if (v.state !== "voided") {
        var lockAt = lockOf(g), locked = v.state !== "upcoming" || now() >= Date.parse(lockAt);
        /* the lobby (Rule 4.2): the night's code and server, released at the lock to the two clubs and the office (js/lobby.js) */
        html += h2hSection(g) + watchSection(g) + lineupsSection(g, lockAt, locked) + (S2.lobby ? S2.lobby.section(g, now()) : "");
      }
      return html + alsoSection(g) + reportLine(g) + aboutGame(g, v, boxed) + "</div>";
    },
    after: function (root, r) {
      var seg = S2.$("#tdBoxSeg", root), box = S2.$(".td-box2", root), g = M.game(r.arg);
      if (!g) { findGame(root, r.arg); bindMissing(root, r.arg); return; }
      if (seg && box) S2.segmented(seg, function (v) {
        S2.$$(".td-boxclub", box).forEach(function (el) { el.classList.toggle("on", el.dataset.club === v); if (el.dataset.club === v) swapIn(el); });
      });
      /* a lineups read that failed is asked again from its own Try again; the section repaints itself in place */
      var gc = S2.$(".td-gc", root);
      if (gc && g) gc.addEventListener("click", function (e) {
        if (!e.target.closest('[data-lu="retry"]')) return;
        delete LU[g.id];
        var sec = S2.$(".td-lineups", root); if (sec) { sec.outerHTML = lineupsSection(g, lockOf(g), true); var n = S2.$(".td-lineups", root); if (n) n.classList.add("in"); }
      });
      bindRail(root); tick(root);
    }
  });
})();
