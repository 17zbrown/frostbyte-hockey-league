/* #/player/<id> (the athlete page and its Compare sheet) and #/club/<code> (the club page). Owned by the profile builder.
   League website v2 (commissioner, 2026-10-19: "I love the way all the stats are presented, but I feel like the design feels
   too much like a dashboard and not a League Website"; references liftfoils.com and juventus.com; imagery is "Type and crests
   only"). The stat visuals stay exactly as the commissioner liked them (rings, radar, rank bars, scrubbable form line,
   heat strip, standings marks); the frame changed: a hero band in the club's color, editorial sections whose headline states
   the finding with the real number, one sentence above each visual, and one "About this data" disclosure at the end instead
   of a caption under every box.
   Every figure comes from S2.M: the season on screen (M.view: the current season by default, Season 1 at ?season=1), read
   live from s2_league or from the Oct 19 fixture the suites run on. Three figures the model does not carry are summed
   here from model output: category medians for the radar, club lines (box scores summed per club, the v4.13 club split) and
   club records (streaks, biggest win).
   shortcut: these three live in the page, not in model.js; move them into the model if a second page ever needs them.
   Interactions repaint the one widget they change (host.outerHTML = html), never the page, so scroll and focus stay put.
   The real path only (v5.00 swap, i3b, 2026-11-25; it replaced the open concept's demo moves of 2026-10-19): a move
   reaches these pages from the league, through the pulse's re-read and quiet repaint, and the sums cached here are
   dropped whenever the model was read again (fresh). A player's page carries the front-office doors that fit it, each a
   real door: Trade (js/flows.js, to the trade builder), the trade block (Team HQ's door, S2._hq.blockLive), a waiver claim
   (S2.claimDoor) and the bid board (S2.market); a role the database would refuse meets S2.locked. Nothing shows as done
   before the database confirms it, and the market's own reads repaint the hero in place (S2.market.on). */
(function () {
  "use strict";
  var S2 = window.S2, M = S2 && S2.M, esc = S2 && S2.esc;
  if (!M) return;

  /* ---------- small helpers ---------- */
  var EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
  var ord = S2.ord, plural = S2.plural;
  function reduced() { return !!(S2.reduce && S2.reduce.matches); }
  function num(x) { return typeof x === "number" && isFinite(x) ? x : 0; }
  function median(a) { a = a.filter(function (x) { return x != null; }).sort(function (x, y) { return x - y; }); var n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; }
  function chip(t, cls) { return '<span class="chip' + (cls ? " " + cls : "") + '">' + esc(t) + "</span>"; }
  function signed(n) { return n == null || isNaN(n) ? "–" : (n > 0 ? "+" : "") + S2.fmt(n); }
  var WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  function word(n) { return n >= 0 && n <= 10 ? WORDS[n] : S2.fmt(n); }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function lcFirst(s) { s = String(s || ""); return s.charAt(0).toLowerCase() + s.slice(1); }   /* "Tied for 2nd of 18" inside a sentence */
  /* the club band: the club's own color, and whichever of black or white reads better on it (WCAG contrast, measured),
     or the ink band for a club with no readable color: core's one S2.clubBand (QA round 2, 2026-11-25: this page kept its
     own hex, lum and clubVars). Every text on the band uses the full ink, never a faded one: a 78% white on Detroit red
     measured 3.8:1. The heroes below (#pfHero, #pfcHero) wear it */
  /* the kit's charts scale their viewBox to the space they get, so this is only a first guess at the width */
  function chartW(frac) {
    var w = window.innerWidth || 1024, content = Math.min(w, 1180) - (w >= 900 ? 56 : 32);
    return Math.max(280, Math.round(content * (frac || 1)));
  }
  /* the kit's line chart uses one label list for the axis and the scrub readout: game numbers on the axis, the full game
     and its date in the readout (the scrub closure reads o.labels when the finger moves, so swapping the list after drawing
     is enough). The games sit evenly spaced, so the axis counts games: dates there read as time, and "Oct 15" and "Oct 16"
     sat as far apart as a gap of a week (audit 2026-11-09) */
  function lineChart(o, readLabels) {
    var n = o.labels.length, step = Math.max(1, Math.ceil(n / (o.ticks || 6))), prev = null;
    /* the kit always prints the last label: drop a tick that would collide with it. Two or three games on one night share a date,
       so a date already on the axis is not printed again (v2 review: "Oct 14, Oct 14, Oct 14"); the readout names each game. */
    o.labels = o.labels.map(function (l, i) { if (!(i === n - 1 || (i % step === 0 && n - 1 - i >= step * 0.6)) || l === prev) return ""; prev = l; return l; });
    var html = S2.charts.line(o); o.labels = readLabels; return html;
  }
  /* the website's switch: an uppercase underline row (Juventus). S2.segmented springs ONE underline between the options, so
     the indicator starts from where it is and can be redirected mid-flight */
  function tabs(key, opts, cur, label, cls) {
    return '<div class="pfx-tabs' + (cls ? " " + cls : "") + '" data-seg="' + key + '" role="group" aria-label="' + esc(label) + '">' + opts.map(function (o) {
      return '<button type="button" data-v="' + esc(o[0]) + '" aria-pressed="' + (o[0] === cur) + '"' + (o[2] ? ' aria-label="' + esc(o[2]) + '"' : "") + ">" + o[1] + "</button>"; }).join("") + "</div>";
  }
  /* the section head: kicker, an uppercase headline that states the finding with its number, one sentence, then an arrow
     link or a switch on the right. copyId marks the part that repaints when a switch changes what the headline is about */
  function headCopy(o) {
    return '<div class="copy"' + (o.copyId ? ' id="' + o.copyId + '"' : "") + ">" + (o.kicker ? '<span class="kicker">' + esc(o.kicker) + "</span>" : "") +
      '<h2 class="d-2"' + (o.id ? ' id="' + o.id + '"' : "") + ">" + esc(o.h) + "</h2>" + (o.p ? "<p>" + o.p + "</p>" : "") + "</div>";
  }
  function head(o) { return '<header class="sec-head pfx-head">' + headCopy(o) + (o.side || "") + "</header>"; }
  function arrow(href, label) { return '<a class="arrow" href="' + href + '"><span>' + esc(label) + "</span>" + S2.ic("chev") + "</a>"; }
  function arrowBtn(act, label) { return '<button type="button" class="arrow pf-press" data-act="' + act + '"><span>' + esc(label) + "</span>" + S2.ic("chev") + "</button>"; }
  /* a section on the page, or a full-bleed band (tint, or the ink match-center band, which scopes the dark theme and keeps
     following the chosen finish through data-look-scope) */
  function sec(id, inner, kind, cls) {
    var band = kind === "tint" ? " band tint" : kind === "ink" ? " band ink" : "";
    return '<section class="pfx-sec reveal' + band + (cls ? " " + cls : "") + '"' + (id ? ' aria-labelledby="' + id + '"' : "") +
      (kind === "ink" ? ' data-theme="dark" data-look-scope data-finish="' + esc(S2.state.finish) + '"' : "") + ">" + inner + "</section>";
  }
  /* one disclosure per page holds the method and the sources, so no visual carries a footnote (league website v2) */
  function about(items) { return S2.about(items); }   /* core's one disclosure (audit 2026-11-09: profile wore its own, a big heading with a plus) */
  function plate(code, cls) { return '<span class="pfx-plate' + (cls ? " " + cls : "") + '">' + M.crest(code, "xl") + "</span>"; }
  function crumb(links, here) {
    return '<nav class="pfx-crumb" aria-label="Breadcrumb">' + links.map(function (l) { return '<a href="' + l[0] + '">' + esc(l[1]) + '</a><span aria-hidden="true">/</span>'; }).join("") +
      '<span aria-current="page">' + esc(here) + "</span></nav>";
  }
  /* a name too long for the hero line scales down to fit it instead of breaking mid-word. Measured, not estimated (v3 review:
     0.6em a letter broke a long all-caps gamertag after its last letter at 375, because M, G, H and W run wide in condensed Archivo): set on one line at the CSS
     size, then shrunk by the overflow ratio, never under 2rem (1.5rem on a phone under 560 px: QA phone 14, 2026-11-25, the
     widest real 20-character tag broke 19/1 at 390 with a lone letter on line two, and fits whole at 30 px). Only one
     unbroken token still too wide at that floor breaks (overflow-wrap in profile.css). It runs again when the column
     changes width and once the brand face has loaded. */
  function fitName(h) {
    if (!h) return;
    var box = h.parentNode, last = -1, text = document.createRange();
    text.selectNodeContents(h);
    function fit() {
      if (!h.isConnected) { ro.disconnect(); return; }
      if (!box.clientWidth || box.clientWidth === last) return; last = box.clientWidth;
      h.style.fontSize = ""; h.style.whiteSpace = "nowrap";
      /* the text's own sub-pixel width against the column, not the h1's (a one-line name widens the auto track it sits in, and
         scrollWidth rounds: one name measured 343 while its text ran 343.1 and broke) */
      for (var i = 0, w = box.getBoundingClientRect().width, tw; i < 3 && (tw = text.getBoundingClientRect().width) > w; i++)
        h.style.fontSize = "max(" + (innerWidth < 560 ? 1.5 : 2) + "rem, " + Math.floor(parseFloat(getComputedStyle(h).fontSize) * w / tw) + "px)";
      h.style.whiteSpace = "";
    }
    var ro = new ResizeObserver(fit); ro.observe(box);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { last = -1; fit(); });
    fit();
  }

  /* one sortable table for the game log and the club stats: every heading sorts (table-sort ruling), sort repaints the table only */
  var SORT = {};
  function sortRows(rows, cols, s) {
    var col = cols.filter(function (c) { return c.k === s.k; })[0] || cols[0], get = col.sortVal || function (r) { return r[col.k]; };
    return rows.slice().sort(function (a, b) {
      var x = get(a), y = get(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      var c = typeof x === "string" ? x.localeCompare(y) : x - y; return s.dir === "asc" ? c : -c;
    });
  }
  function table(id, cols, rows, def, label) {
    var s = SORT[id] || (SORT[id] = { k: def.k, dir: def.dir });
    var hd = cols.map(function (c) {
      var on = s.k === c.k;
      return '<th scope="col"' + (on ? ' aria-sort="' + (s.dir === "asc" ? "ascending" : "descending") + '"' : "") + (c.title ? ' title="' + esc(c.title) + '"' : "") + ">" +
        '<button type="button" data-act="sort" data-tbl="' + id + '" data-k="' + c.k + '">' + esc(c.label) + (on ? '<span aria-hidden="true">' + (s.dir === "asc" ? "↑" : "↓") + "</span>" : "") + "</button></th>";
    }).join("");
    var body = sortRows(rows, cols, s).map(function (r) {
      return "<tr>" + cols.map(function (c, i) { var v = c.cell ? c.cell(r) : esc(r[c.k] == null ? "–" : r[c.k]); return i === 0 ? '<th scope="row">' + v + "</th>" : "<td>" + v + "</td>"; }).join("") + "</tr>";
    }).join("");
    return '<div class="tbl-wrap pf-tbl-wrap" id="' + id + '"><table class="tbl pf-tbl" aria-label="' + esc(label) + '"><thead><tr>' + hd + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  /* repaint one widget in place, then wire what it brought: switches, chart scrubbing, bar entrances.
     enter = a new season line on screen (the role switch): its reveals and bars play once more. Every other change (a Form
     stat, a rating position, a sort, a club tab) cross-fades: hydrate still binds scrubbing, then the entrances it started are
     finished at once, because a state change is not a page entrance (v2 review: each Form tap redrew the line from nothing). */
  function swap(id, html, root, ctx, fade, enter) {
    var old = document.getElementById(id); if (!old) return null;
    var sl = old.scrollLeft; old.outerHTML = html;
    var el = document.getElementById(id); if (!el) return null;
    if (sl) el.scrollLeft = sl;
    S2.charts.hydrate(el); wire(el, ctx);
    var rv = S2.$$(".reveal", el).concat(el.classList.contains("reveal") ? [el] : []);
    if (enter) { rv.forEach(function (x) { x.classList.add("in"); }); grow(el); }
    else { rv.forEach(function (x) { x.classList.remove("reveal"); }); S2.settle(el); }
    if (fade && !reduced()) el.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
    return el;
  }
  /* QA round 2 (2026-11-25): this page's own settle() is core's S2.settle now, which keeps its trap: an endless animation
     (a live dot) cannot be finished, finish() throws (QA 2026-11-25), so it is left running */
  function wire(root, ctx) {
    var list = S2.$$("[data-seg]", root); if (root.matches && root.matches("[data-seg]")) list.unshift(root);
    list.forEach(function (el) {
      if (el.dataset.wired) return; el.dataset.wired = "1";
      el._seg = S2.segmented(el, function (v) { ctx.onSeg(el.dataset.seg, v); });   /* kept so a link elsewhere can move the underline (club: All results) */
    });
  }
  /* rank and comparison bars grow from their baseline once, on transform only. QA round 2 (2026-11-25): inside the half
     second a page's entrance takes (S2.countUp is 500 ms), so 480 ms, and the stagger stops at the eighth bar (8 x 24 ms);
     at 720 ms and 14 x 28 ms a long rank list kept growing for 1.1 s after the page had landed */
  var GROW_MS = 480, GROW_STEP = 24, GROW_STEPS = 8;
  function grow(root) {
    if (reduced()) return;
    S2.$$("[data-grow]", root).forEach(function (b, i) {
      var to = b.style.transform || "scaleX(1)";
      b.animate([{ transform: "scaleX(0.02)" }, { transform: to }], { duration: GROW_MS, delay: Math.min(i, GROW_STEPS) * GROW_STEP, easing: EASE, fill: "backwards" });
    });
  }
  function pressFeedback(root) {   /* Apple: answer on pointer-down, not on release */
    root.addEventListener("pointerdown", function (e) { var b = e.target.closest(".pf-press"); if (b) b.classList.add("is-down"); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { root.addEventListener(ev, function () { S2.$$(".pf-press.is-down", root).forEach(function (b) { b.classList.remove("is-down"); }); }, true); });
  }
  function arg(a) { try { return decodeURIComponent(a || ""); } catch (e) { return String(a || ""); } }   /* a malformed % in a pasted link must not throw */
  function empty(title, body, extra) {
    return '<div class="pf-empty"><p class="d-3">' + esc(title) + '</p><p class="t-sub">' + esc(body) + "</p>" + (extra || "") + "</div>";
  }

  /* one market subscription for the page on screen (js/market.js S2.market.on: a read landed, a claim or a board edit):
     the next render replaces it, and it ends itself once its root is gone */
  /* QA round 2 (A7, 2026-11-25): the title race is the model's one read (M.readTitles, shared with Stats and Today);
     s2_league carries none, so live a player's race places and a club's were simply missing. A page that shows race
     places asks for it after it draws; when the read lands and the places this page shows have changed (they move with
     every final), paint repaints them in place. A failed read leaves the places out (the model says why in the console;
     Stats > Leaders, which names the race, says it with Try again).
     QA round 2 review (2026-11-25): the race is told only while the season on screen races. Before its first final there is
     none, and once its titles are filed they replace it (the season sentence, Honors and the about all hide it), so such a
     page neither reads the board nor repaints: on the complete Season 1 the places changed from none to rows behind a
     hidden race, and the whole body was swapped for nothing. A read that lands while the page is still entering (an
     answer takes 150 to 300 ms, the reveals and the bars about 700) waits for the entrance to end (whenStill), and paint
     repaints only what tells the race: swapping the whole body settled it, so a race holder's page snapped to its end
     state partway in and keyboard focus inside it was lost */
  function raceIn(root, places, paint) {
    if (!M.view.finals || M.filedTitles(M.view.season).length || !M.titlesNeeded()) return;
    var before = places();
    M.readTitles().then(function (e) { if (e || !root.isConnected || places() === before) return; whenStill(root, paint); });
  }
  /* a link that held focus in a region the race repaints gets it back by its address and which of that address it was
     (a race row can add the column's own links above it, so a plain index would land on another link) */
  function focusKey(host) {
    var f = document.activeElement, h = host && f && host.contains(f) && f.getAttribute("href");
    return h ? { href: h, i: S2.$$("a[href]", host).filter(function (a) { return a.getAttribute("href") === h; }).indexOf(f) } : null;
  }
  function focusBack(host, k) {
    var a = host && k ? S2.$$("a[href]", host).filter(function (x) { return x.getAttribute("href") === k.href; })[k.i] : null;
    if (a) a.focus({ preventScroll: true });
  }
  /* fn once root's entrance is over: every reveal has its class (S2.reveal adds it two frames after the page's after(),
     which is where raceIn asks) and every finite animation under root has finished. An endless one (a live dot) is not
     waited on, and one canceled meanwhile (its node was repainted, so a.finished rejects) counts as over. frames bounds
     the wait for the reveals' class (about a second), so a reveal nobody shows cannot hold the repaint back for good */
  function whenStill(root, fn, frames) {
    requestAnimationFrame(function () {
      if (!root.isConnected) return;
      var left = frames == null ? 60 : frames;
      if (left > 0 && S2.$(".reveal:not(.in)", root)) { whenStill(root, fn, left - 1); return; }
      var run = root.getAnimations ? root.getAnimations({ subtree: true }).filter(function (a) { var t = a.effect && a.effect.getComputedTiming(); return a.playState === "running" && t && isFinite(t.endTime); }) : [];
      if (!run.length) { fn(); return; }
      Promise.all(run.map(function (a) { return a.finished.then(null, function () { return null; }); })).then(function () { whenStill(root, fn, 0); });
    });
  }
  var offMk = null;
  function follow(fn, root) {
    if (offMk) offMk();
    offMk = null;
    if (!S2.market || !S2.market.on) return;
    var a = S2.market.on(function (e) { if (!root.isConnected) { off(); return; } fn(e); });
    var off = offMk = function () { a(); if (offMk === off) offMk = null; };
  }
  /* the sums below (club records, the radar medians, the league table, the last final) are read from the model, which
     S2.reread and the pulse refill in place: each render starts by dropping them when the league was read again */
  var SEEN = null;
  function fresh() {
    var b = S2.data && S2.data.body;
    if (SEEN !== null && b === SEEN) return;
    SEEN = b === undefined ? null : b; CLUB = {}; LEAGUE = null; CAT_MED = null; thru();
  }

  var LEAGUE = null;
  function league() { return LEAGUE || (LEAGUE = M.standings("league")); }
  function standRow(code) { var L = league(); for (var i = 0; i < L.length; i++) if (L[i].code === code) return L[i]; return null; }
  function clubGp() { return Math.max.apply(null, league().map(function (r) { return num(r.gp); }).concat([1])); }
  var ONE = { C: "center", W: "winger", D: "defense player", G: "goaltender" };
  var MANY = M.GROUP_MANY;
  var RES_WORD = { W: "Win", L: "Loss", OTL: "Overtime loss" };
  var SEAT = { Owner: "Owner", GM: "General manager", AGM: "Assistant GM" };

  /* ---------- radar reference: the median category score of each rating group (non-provisional rows) ---------- */
  var CAT_MED = null;
  function catMedian(group) {
    if (!CAT_MED) {
      CAT_MED = {}; var by = {};
      M.ratings().forEach(function (r) { if (!r.provisional) (by[r.pos] = by[r.pos] || []).push(r); });
      Object.keys(by).forEach(function (g) {
        var rows = by[g];
        CAT_MED[g] = { n: rows.length, axes: rows[0].radar.axes, values: rows[0].radar.axes.map(function (_, i) { return median(rows.map(function (r) { return r.radar.values[i]; })); }) };
      });
    }
    return CAT_MED[group] || null;
  }
  function leagueMax(stat, role) { var l = M.leaders(stat, 1, { minGp: 1, role: role }); return l.length ? num(l[0].value) : 0; }
  /* a league place on a total (points): M.leaders gives equal totals one rank, so two players on 71 points are each
     "tied for 2nd" (2026-10-20: both read "2nd in the league") */
  function rankOf(stat, pid, role) {
    var l = M.leaders(stat, 400, { role: role, minGp: 1 }), me = l.filter(function (x) { return x.id === pid; })[0];
    return me ? { rank: me.rank, tied: l.filter(function (x) { return x.rank === me.rank; }).length } : null;
  }
  function place(r) { return (r.tied > 1 ? "tied for " : "") + ord(r.rank); }
  /* the rating that belongs with a season line: a goaltending line reads the goaltender rating, a skating line the first skater
     rating (headline first). v2 review: a two-role player opened on the goaltending line beside a Wing radar, and two goaltenders in
     Compare read "Defense rating" and "Wing rating". One definition for the breakdown, the Compare names and the Compare radar. */
  function ratingFor(pid, role) { var r = M.ratings(pid); return r.filter(function (x) { return (x.pos === "G") === (role === "G"); })[0] || r[0] || null; }
  function salaryText(n) { return n == null ? null : n === 0 ? "No salary" : M.money(n); }   /* owners and GMs carry $0, which M.money prints as "$0K" */

  /* =====================================================================================================================
     PLAYER
     ===================================================================================================================== */
  var PST = {};
  function pst(p) { return PST[p.id] || (PST[p.id] = { role: p.mainRole, rpos: null, stat: null, view: "strip", sel: null }); }
  var SQUAD = { pro: "Active roster", tc: "Training camp" };
  /* bid and claimed are Season 2's ways in (Saturday bidding and waiver claims, 2026-11-02): Season 2 has no free agency, so a Saturday signing
     never reads "Signed as a free agent" (review 2026-11-02) */
  var HOW_IN = { placed: "Placed by the league", signed: "Signed as a free agent", bid: "Signed at Saturday bidding (Rule S2.6)", claimed: "Claimed off waivers (Rule S2.5)", trade: "Acquired in a trade", "trade reversed": "Returned when a trade was reversed", drafted: "Drafted", moved: "Joined in a roster move", "squad move": "Joined from training camp", other: "Joined" };
  var HOW_OUT = { waived: "Waived", bid: "Signed elsewhere at Saturday bidding", trade: "Traded away", "trade reversed": "Sent back when a trade was reversed", moved: "Left in a roster move", "squad move": "Moved to training camp", "left Discord": "Left the roster", "league office": "Left the roster" };   /* privacy: the reason behind an office removal can be discipline, so it reads neutrally */

  /* the hero's one sentence: the season in its biggest true number */
  /* the snapshot's last final, so figures from it say when they stop (review 2026-11-23: a trophy won on 172 points sat over
     "124 points in 24 games" with no date between them) */
  var THRU = null, THRU_T = "";
  function thru() { var f = M.games.filter(function (g) { return g.isFinal; }).map(function (g) { return g.at; }).sort(); THRU = f.length ? M.etMonthDay(f[f.length - 1]) : null; THRU_T = THRU ? " through " + THRU : ""; }
  thru();
  /* v5.00 swap (e7, 2026-11-24): every season label names the season on screen (M.view), never a fixed "Season 1", so
     Season 2 reads as itself and Season 1 stays whole at ?season=1. A club page tells one season: the one on screen, or,
     while that season has no games yet, the newest closed season before it (its finish, trophies and titles are the
     newest a reader can see). Functions, not values: the model refills S2.M in place on a re-read */
  function toldN() { var n = M.view.season; if (!M.view.empty.games) return n; for (var k = n; k > 0; k--) if (M.seasonClose(k)) return k; return n; }
  /* the season on screen's roster rules, from its seasons row (M.control.season(n).rules): M.RULES.s1, Season 1's group
     limits with an unlimited camp, or M.RULES.s2, Season 2's twelve with the S2.4 minimums and no club camps. A missing
     row is the model's error to surface, so this throws rather than guessing a season (review 2026-11-24: the club About
     told of a fixed "Season 1 (Oct 19)" roster on every season) */
  function viewRules() { var s = M.control.season(M.view.season); if (!s) throw new Error("no seasons row for " + M.view.name); return s.rules; }
  /* a day of a season's calendar, "Oct 31", through Today's one lookup of a season's dates (S2.seasonDate, today.js); a
     season's name is S2.seasonName (review 2026-11-24: this file kept a second lookup of each, one of another shape) */
  function seasonDay(n, key) { var c = S2.seasonDate(n, key); return c && c.at ? M.etMonthDay(c.at) : null; }
  /* a member's games in the seasons other than the one on screen (M.careerEarlier, every season's games less this one's),
     and where they are: each other season that has had games (not an upcoming one), as a link to this player's page on it
     (S2.seasonHref: the current season is the bare address, an archive ?season=n). where names the one season when there
     is one, else "earlier seasons" (or "other seasons" from an archive, when a later one counts too). null when none */
  function elsewhere(p) {
    var n = M.careerEarlier(p.id); if (!n) return null;
    var cur = S2.currentSeason(), rows = M.control.seasons.filter(function (s) { return s.number !== M.view.season && s.status !== "upcoming"; });
    if (!rows.length) { console.error("profile: " + n + " career games outside " + M.view.name + ", and no other season in the league read"); return null; }
    var earlier = rows.every(function (s) { return s.number < M.view.season; });
    return { n: n, where: rows.length === 1 ? S2.seasonName(rows[0].number) : earlier ? "earlier seasons" : "other seasons",
      links: rows.map(function (s) { return [S2.seasonHref(cur && cur.number === s.number ? null : s.number, "#/player/" + p.id), S2.seasonName(s.number) + " career"]; }) };
  }
  function heroLine(p) {
    var L = p.mainRole ? p.lines[p.mainRole] : null;
    /* QA worst 2 (2026-11-25): the copy agrees with the rating ring beside it. The ring is right (v3.74: a provisional
       headline rating at the signed-up position even at 0 games, now 85 on the v4.48 scale), so only the words change: a
       carried-over rating is said as one, a 0-game rating as provisional, and a completed season promises no box score */
    if (!L) {
      /* QA round 2 (2026-11-25): a veteran's games in another season are said beside it (Season 2 read "No Season 2 games
         yet" over a rating earned in 14 Season 1 games); the career section below links them */
      var aw = elsewhere(p), also = aw ? ", " + plural(aw.n, "game") + " in " + aw.where : "";
      if (p.former) return "No longer on a roster, and no " + M.view.name + " games on record" + also + ".";
      if (M.view.status === "complete") return "No " + M.view.name + " games on record" + also + ".";
      var hr = M.ratings(p.id)[0];
      return "No " + M.view.name + " games yet" + also + "." + (!hr ? " A rating and stats appear after the first box score." : hr.gp > 0 ? " The rating carries over from earlier games until the first box score." :
        " The rating is provisional until " + word(M.SETTLE_GP) + " games at the position.");
    }
    var s;
    if (L.role === "G") s = (L.record ? L.record + " in goal" : plural(L.gp, "game") + " in goal") + THRU_T + (L.sv_pct != null ? " with a " + M.display("sv_pct", L.sv_pct) + " save percentage." : ".");
    else { var r = rankOf("p", p.id, "S"); s = plural(num(L.p), "point") + " in " + plural(L.gp, "game") + THRU_T + (r && r.rank === 1 ? (r.tied > 1 ? ", tied for the most in the league." : ", the most in the league.") : r && r.rank <= 10 ? ", " + place(r) + " in the league." : "."); }
    var o = p.roles.length === 2 ? p.lines[L.role === "G" ? "S" : "G"] : null;
    return s + (o ? " Also " + plural(o.gp, "game") + (o.role === "G" ? " in goal." : " as a skater.") : "");
  }
  /* the front-office doors a player's page fits. Every role sees Trade and the market's door: the trade builder and the
     bid board lock by role themselves (S2.locked), and the block toggle does the same here. A manager gets no trade or
     block door, because an Owner, GM or AGM can't be traded or listed (Rule 2.6). The club a front office acts for is the
     market's one definition (S2.market.club(): the seat's own club, or the club a commissioner chose) */
  function acting() { return S2.market && S2.market.club ? S2.market.club() : null; }
  function heroActs(p) {
    /* QA visual 41 and function 18 (2026-11-25): a completed season's page is a record, so it carries no live door (the
       Season 1 archive offered "Trade for this player"). On the season under way every role still sees the doors, which
       lock by role themselves (above) */
    if (M.view.status === "complete") return "";
    var mine = S2.has("office") && p.rostered && !!acting() && p.club === acting(), b = function (attrs, label) { return '<button type="button" class="btn site outline pf-press" ' + attrs + ">" + esc(label) + "</button>"; };
    /* the Season 2 market (2026-11-02): a player on waivers is claimed, a pool player goes on a club's bid board; the
       bidding itself happens only in the Saturday room */
    var mk = market(p), mkAct = mk.wire ? b('data-act="claim"', "Claim off waivers") : mk.pool && !mine ?
      (S2.has("office") && mk.board ? '<a class="btn site outline pf-press" href="#/hq?tab=bidding">' + S2.ic("check") + "On your bid board</a>" : b('data-act="board"', "Add to bid board")) : "";
    if (p.rostered && !p.seat) return b('data-flow="trade" data-player="' + esc(p.id) + '"', mine ? "Offer in a trade" : "Trade for this player") +
      (mine ? b('data-act="block"', p.onBlock ? "Take off the trade block" : "Put on the trade block") : "") + mkAct;
    return mkAct;
  }
  /* where the player stands in the Season 2 market (js/market.js, read once a page asks: S2.market.ensure): on waivers
     (still claimable), in the training camp pool, on the acting club's bid board */
  function market(p) {
    var K = S2.market; if (!K) return {};
    var w = K.waiver(p.id); w = w && w.claimable ? w : null;
    return { wire: w, pool: !w && K.inPool(p.id), board: acting() ? K.onBoard(acting(), p.id) : null };
  }
  /* a market action answers a Promise of { ok, problems } (js/market.js); a refusal is the league's own sentence */
  function mkSaid(r, ok) { if (!r.ok) S2.toast(r.problems.map(function (x) { return x.text; }).join(" ") || "The league did not take that. Try again.", "err"); else S2.toast(ok, "ok"); }
  /* Add to bid board: the acting club's private plan (Team HQ, Bidding), opening at the $750K first bid as its ceiling */
  function boardDoor(p, repaint) {
    var K = S2.market;
    if (!S2.has("office")) return S2.locked({ title: "Add " + p.tag + " to a bid board", who: "A club's front office: its Owner, GM and AGM",
      why: "A bid board is a club's private plan for Saturday bidding: the pool players it wants, in order, and the most it would pay. Only a pool player with six games may be bid on, at the Saturday bid room (Rule S2.6)." });
    Promise.resolve(K.boardAdd(acting(), p.id, { ceiling: K.MIN })).then(function (r) {
      mkSaid(r, p.tag + " is on your bid board. Rank them and set a ceiling in Team HQ, Bidding."); repaint();
    });
  }
  /* the trade block toggle: Team HQ's one door (S2._hq.blockLive: roster_spots.on_block, queued for the Owner when the
     club's Roster page is set to Owner approves, and refused for a manager before anything is sent). Taking a listing
     down is always open: like withdrawing an offer, it moves nobody */
  function blockToggle(p, repaint) {
    var on = !p.onBlock;
    if (!S2.has("office")) return S2.locked({ title: (on ? "Put " : "Take ") + p.tag + (on ? " on" : " off") + " the trade block", who: "A club's front office: its Owner, GM and AGM",
      why: "A club may list any of its players on the league's trade block. The listing is public: every club's front office sees it in the Trade Hub (Rule 2.3)." });
    if (!S2._hq || !S2._hq.blockLive) { console.error("[profile] S2._hq.blockLive is missing: load js/pages/hq.js"); return S2.toast("The trade block can't be changed from this page right now. Nothing was changed.", "err"); }
    S2._hq.blockLive(p, on, function (e, res) {
      if (e) { S2.toast(e.code === "S2_NO_ROWS" ? "Nothing changed: the league did not let this seat list that player." : e.message, "err"); return; }
      S2.toast(S2._hq.blockSaid(p, on, res), "ok"); repaint();
    });
  }
  function heroP(p) {
    var t = p.team, rts = M.ratings(p.id), hr = rts[0] || null, cur = p.tenures.filter(function (x) { return !x.to && x.club === p.club; })[0];
    var kick = [p.posName ? p.posName + (p.posSource === "played" ? " (most played)" : "") : null, p.num != null && p.rostered ? "#" + p.num : null].filter(Boolean).join("  ");
    /* Season 2 has no free agents: a waived player is on waivers for 24 hours, then in the training camp pool */
    var mk = market(p), poolOnly = mk.pool && !p.rostered;
    var flags = honorFlag(p) + (p.former ? '<span class="pfx-flag">Former player</span>' : "") + (mk.wire ? '<span class="pfx-flag">On waivers</span>' : poolOnly ? '<span class="pfx-flag">Training camp pool</span>' : "") +
      (p.onBlock ? '<span class="pfx-flag">On the trade block</span>' : "");
    /* the ring is decoration; the number is read with its name first ("CGHL rating 82") */
    var rate = hr ? '<div class="pfx-rate"><span class="pfx-rate-ring" aria-hidden="true">' +
        S2.charts.rings({ size: 120, stroke: 8, rings: [{ value: M.ovrUnit(hr.ovr), color: "currentColor", label: hr.posName, text: String(hr.ovr) }] }) +
        '<span class="pfx-rate-n d-num" data-count="' + hr.ovr + '">' + hr.ovr + '</span></span><span class="sr">CGHL rating ' + hr.ovr + "</span>" +
        '<span class="pfx-rate-l"><b aria-hidden="true">CGHL rating</b><span>As a ' + esc(ONE[hr.pos] || hr.posName) + ", " + plural(hr.gp, "game") + (hr.provisional ? ", provisional" : "") + "</span></span></div>"
      : '<div class="pfx-rate"><span class="pfx-rate-l"><b>CGHL rating</b><span>Not rated yet</span></span></div>';
    /* position and number live in the kicker and the numeral, so the spec row holds only what is said nowhere else (v3 review) */
    /* the waiver's end, from the league's market (S2.market.waiver) */
    var spec = [["Roster", mk.wire ? "On waivers until " + M.etDateTime(new Date(mk.wire.until).toISOString()) : poolOnly ? "Training camp pool" : p.former ? "No longer on a roster" : SQUAD[p.squad] || null],
      ["Salary", p.rostered || mk.wire ? salaryText(mk.wire ? mk.wire.salary : p.salary) : null],   /* a claim takes the salary the player carried (Rule S2.5) */ ["Front office", p.seat ? SEAT[p.seat] || p.seat : null], ["Joined", cur ? cur.fromLabel : null]].filter(function (x) { return x[1]; });
    var crumbs = [["#/stats?tab=players", "Players"]].concat(t ? [[t.href, t.full]] : []);
    /* the jersey number is the player's own numeral, set huge in the club ink behind the hero (Juventus player pages). It is
       decoration: the kicker says "#3" in full ink for every reader */
    var jersey = p.num != null && p.rostered ? '<span class="pfx-jersey d-num" aria-hidden="true">' + esc(p.num) + "</span>" : "";
    return '<header class="band club hero pfx-hero reveal" id="pfHero" style="' + S2.clubBand(t) + '">' + crumb(crumbs, p.tag) +
      '<div class="pfx-hero-g">' + jersey +
        '<div class="pfx-hero-id">' + (kick ? '<span class="kicker">' + esc(kick) + "</span>" : "") +
          '<h1 class="d-hero pfx-name">' + esc(p.tag) + "</h1>" +
          '<p class="pfx-lede">' + esc(heroLine(p)) + "</p>" + (flags ? '<div class="pfx-flags">' + flags + "</div>" : "") + "</div>" +
        '<div class="pfx-hero-art">' + (t ? '<a class="pfx-plate-a pf-press" href="' + t.href + '" aria-label="' + esc(t.full) + '">' + plate(t.code) + "</a>" : "") + rate + "</div>" +
        '<div class="pfx-hero-act">' + (p.roles.length ? '<button type="button" class="btn site pfx-btn pf-press" data-act="compare">' + S2.ic("people") + "Compare</button>" : "") + heroActs(p) + "</div>" +
      "</div>" +
      (spec.length ? '<dl class="pfx-hero-spec">' + spec.map(function (x) { return "<div><dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd></div>"; }).join("") + "</dl>" : "") + "</header>";
  }

  /* ---- season: three rings (Apple Fitness) with their numbers. The rest of the line is said in the sentence, not in a tile
     row under the rings (v3 review: "No KPI tile rows on public pages"; points and points a game were printed three times) ---- */
  /* the goalie figures with no ring of their own, for the season sentence and a game's line */
  function keeperBits(o) {
    var bits = [];
    if (num(o.dsv)) bits.push(plural(num(o.dsv), "desperation save"));
    if (num(o.sop)) bits.push(plural(num(o.sop), "shutout period"));
    if (num(o.psa)) bits.push(num(o.psv) + " of " + plural(num(o.psa), "penalty shot") + " stopped");
    return bits;
  }
  /* copyOnly: the head's copy alone (#pfSeasonHd), which the title race repaints when its places land (raceIn) */
  function seasonSec(p, L, role, copyOnly) {
    var cg = clubGp(), rings, h, sent;
    if (role === "G") {
      var mw = leagueMax("w", "G"), ms = leagueMax("sv", "G"), svr = M.rank(L, "sv_pct");
      rings = [{ v: num(L.w), max: mw, label: "Wins", color: "var(--chart-a)", note: num(L.w) >= mw ? "Most in the league" : "League high " + mw },
               { v: num(L.sv), max: ms, label: "Saves", color: "var(--accent-2)", note: num(L.sv) >= ms ? "Most in the league" : "League high " + S2.fmt(ms) },
               { v: L.gp, max: cg, label: "Games in goal", color: "var(--ink-2)", note: "Of " + cg + " club games" }];
      var svHead = !(num(L.w) && num(L.w) >= mw) && svr && !svr.few && svr.rank <= 3;   /* the save percentage rank leads, so the sentence names its pool */
      h = num(L.w) && num(L.w) >= mw ? L.w + " wins. Nobody has more." : svHead ? "A " + M.display("sv_pct", L.sv_pct) + " save percentage, " + lcFirst(svr.text) + " " + MANY.G + "." : (L.record ? "A " + L.record + " record in goal." : plural(L.gp, "game") + " in goal.");
      sent = esc(p.tag) + (L.record ? " is " + esc(L.record) + " in " + plural(L.gp, "game") + " in goal" : " has " + plural(L.gp, "game") + " in goal") + ", with " + plural(num(L.sv), "save") + " on " + plural(num(L.sa), "shot") +
        (L.sv_pct != null ? " (a " + esc(M.display("sv_pct", L.sv_pct)) + " save percentage)" : "") + ", " + esc(M.display("gaa", L.gaa)) + " goals against a game and " + (num(L.so) ? plural(num(L.so), "shutout") : "no shutouts") + "." + (keeperBits(L).length ? " Also " + keeperBits(L).join(", ") + "." : "") +
        (svHead ? " The rank counts the " + svr.n + " " + MANY.G + " with " + word(M.SETTLE_GP) + " or more games in goal." : "");
    } else {
      var mg = leagueMax("g", "S"), ma = leagueMax("a", "S"), mp = leagueMax("p", "S"), pr = rankOf("p", p.id, "S");
      var race = M.filedTitles(M.view.season).length ? null : p.honors.filter(function (x) { return x.kind === "title_race" && x.category === "points_title"; })[0];   /* a filed title ends the race */
      rings = [{ v: num(L.g), max: mg, label: "Goals", color: "var(--chart-a)", note: num(L.g) >= mg ? "Most in the league" : "League high " + mg },
               { v: num(L.a), max: ma, label: "Assists", color: "var(--accent-2)", note: num(L.a) >= ma ? "Most in the league" : "League high " + ma },
               { v: L.gp, max: cg, label: "Games", color: "var(--ink-2)", note: "Of " + cg + " club games" }];
      h = num(L.g) && num(L.g) >= mg ? L.g + " goals. Nobody has more." : num(L.p) && num(L.p) >= mp ? L.p + " points. Nobody has more." : num(L.a) && num(L.a) >= ma ? L.a + " assists. Nobody has more." :
        !num(L.p) ? plural(L.gp, "game") + ", still looking for a first point." : pr && pr.rank <= 10 ? plural(L.p, "point") + ", " + place(pr) + " in the league." : plural(L.p, "point") + " in " + plural(L.gp, "game") + ".";
      sent = esc(p.tag) + " has " + plural(num(L.g), "goal") + " and " + plural(num(L.a), "assist") + " in " + plural(L.gp, "game") + ", " + esc(M.display("pts_pg", L.pts_pg)) + " points a game" +
        (race ? ", " + ord(race.place) + " in the Scoring Title race" : "") + ", with a " + signed(num(L.pm)) + " plus/minus" +
        (num(L.sog) ? " and " + esc(M.display("shot_pct", L.shot_pct)) + " shooting on " + plural(num(L.sog), "shot") : "") + "." +
        (num(L.fot) && !M.rank(L, "fo_pct") ? " At center, " + num(L.fow) + " of " + plural(num(L.fot), "faceoff") + " won (" + esc(M.display("fo_pct", L.fo_pct)) + ") in " + plural(num(L.fo_games), "game") + "." : "");
    }
    var hd = { copyId: "pfSeasonHd", kicker: M.view.name + THRU_T, id: "pfSeasonH", h: h, p: sent + " A full ring is the league's best total.",
      side: arrow(role === "G" ? "#/stats?tab=goalies" : "#/stats?tab=skaters", role === "G" ? "All goaltenders" : "All skaters") };
    if (copyOnly) return headCopy(hd);
    var ringSvg = S2.charts.rings({ size: 220, stroke: 18, label: rings.map(function (r) { return r.label + " " + r.v; }).join(", "),
      rings: rings.map(function (r) { return { value: r.max ? r.v / r.max : 0, color: r.color, label: r.label, text: S2.fmt(r.v) }; }) });
    var bigs = rings.map(function (r) {
      return '<li><i class="pf-dot" style="background:' + r.color + '"></i><span class="pfx-big d-num">' + S2.fmt(r.v) + '</span><span class="pfx-big-l"><b>' + esc(r.label) + "</b><span>" + esc(r.note) + "</span></span></li>";
    }).join("");
    return sec("pfSeasonH", head(hd) +
      '<div class="pfx-season"><div class="pfx-rings">' + ringSvg + '</div><ul class="pfx-bigs">' + bigs + "</ul></div>");
  }

  /* ---- rating breakdown: categories against the median player at the same position ---- */
  function radarPick(p, st) { var rts = M.ratings(p.id); return rts.filter(function (x) { return x.pos === st.rpos; })[0] || rts[0] || null; }
  function radarCopy(p, st) {
    var r = radarPick(p, st), med = r ? catMedian(r.pos) : null;
    var d = r && med ? r.radar.values.map(function (v, i) { return v != null && med.values[i] != null ? Math.round(v - med.values[i]) : null; }) : [];
    var bi = -1; d.forEach(function (x, i) { if (x != null && (bi < 0 || x > d[bi])) bi = i; });
    var h = !r ? "Not rated yet." : bi >= 0 && d[bi] > 0 ? r.radar.axes[bi] + " " + r.radar.values[bi] + ", " + d[bi] + " above the median " + ONE[r.pos] + "." : "Rated " + r.ovr + " as a " + ONE[r.pos] + ".";
    return headCopy({ copyId: "pfRadarHd", kicker: "CGHL rating", id: "pfRadarH", h: h,
      p: r ? "Rated " + r.ovr + " as a " + esc(ONE[r.pos]) + " over " + plural(r.gp, "game") + (r.provisional ? ", provisional until " + M.SETTLE_GP + " games" : "") + ". The solid shape is " + esc(p.tag) + "; the dashed one is the median " + esc(ONE[r.pos]) + "." : "" });
  }
  function radarBody(p, st) {
    var r = radarPick(p, st); if (!r) return '<div id="pfRadarB"></div>';
    var med = catMedian(r.pos);
    var rows = r.radar.axes.map(function (a, i) {
      var v = r.radar.values[i], m = med ? med.values[i] : null, d = v != null && m != null ? Math.round(v - m) : null;
      return '<li><span class="pfx-cat-l">' + esc(a) + '</span><b class="d-num">' + (v == null ? "–" : v) + '</b><span class="pf-delta num ' + (d > 0 ? "up" : d < 0 ? "down" : "") + '">' + (d == null ? "" : d === 0 ? "even" : signed(d)) + "</span></li>";
    }).join("");
    return '<div id="pfRadarB" class="pfx-radar">' +
      S2.charts.radar({ size: 340, axes: r.radar.axes, a: r.radar.a, b: med ? med.values.map(function (v) { return M.ovrUnit(v); }) : null, label: p.tag + " rating categories against the median " + ONE[r.pos] }) +
      '<ul class="pfx-cats" aria-label="Category scores, with the gap to the median">' + rows + "</ul></div>";
  }
  function radarSec(p, st) {
    var rts = M.ratings(p.id); if (!rts.length) return "";
    var side = rts.length > 1 ? tabs("rpos", rts.map(function (r) {
      return [r.pos, '<span class="pf-sl">' + esc(r.posName) + '</span><span class="pf-ss">' + esc(r.pos) + "</span> " + r.ovr, r.posName + " " + r.ovr + (r.provisional ? ", provisional" : "")]; }), st.rpos, "Rating at each position played", "sm pfx-tabs-pos") : "";
    return sec("pfRadarH", '<header class="sec-head pfx-head">' + radarCopy(p, st) + side + "</header>" + radarBody(p, st), "tint");
  }

  /* ---- ranks in the position group played (M.rank) ----
     Commissioner, 2026-10-20: "Instead of showing stats in percentile, can you just list it like 1st in this category or
     tied for 24th or something? Then the numbers may not confuse people as much." The bars stay; each now says its rank
     in words and is drawn from the rank's score (full for first, empty for last, the tick at the middle of the pack) */
  var RANK_GROUPS = {
    S: [["Scoring", ["pts_pg", "g_pg", "a_pg", "sog_pg", "shot_pct", "onnet_pct"]], ["Puck play", ["poss_s_pg", "pass_pct", "fo_pct", "gv_pg", "pm_pg"]], ["Defense and grit", ["tk_pg", "int_pg", "hits_pg", "blk_pg", "pim_pg"]]],
    G: [["In goal", ["sv_pct", "gaa", "sv_pg", "sa_pg", "so_pg", "brk_sv_pct", "dsv_pg", "sop_pg"]]]
  };
  /* volume, not quality: facing more shots (and so making more saves) is a busier night, not a better one, so these rank without
     a good or bad color (v2 review: 17.75 shots against read as a red weakness) */
  var WORKLOAD = { sv_pg: 1, sa_pg: 1 };
  function statLabel(s) { return String(s || "").replace(" (EA counts every lost puck)", "").replace(" (seconds)", ""); }
  /* under six games at the position a line has no rank (M.rank few), so its row keeps the number and the median, no bar */
  function pbar(x) {
    var tone = WORKLOAD[x.stat] ? "" : x.tone;
    var poss = x.stat === "poss_s_pg", val = poss ? M.toi(Math.round(x.value)) : x.display, med = poss ? M.toi(Math.round(x.median)) : x.medianDisplay;   /* possession as minutes:seconds, not raw seconds */
    return '<div class="pf-pb"><div class="pf-pb-h"><span class="pf-pb-l">' + esc(statLabel(x.label)) + '</span><span class="pf-pb-v"><b class="num">' + esc(val) +
      "</b>" + (x.few ? "" : '<span class="pf-pb-p ' + tone + '">' + esc(x.text) + "</span>") + "</span></div>" +
      (x.few ? "" : '<div class="pf-pb-t" role="img" aria-label="' + esc(statLabel(x.label) + ": " + val + ", " + x.text + " " + (x.groupMany || MANY[x.group]) + ", median " + med) + '"><i data-grow style="transform:scaleX(' + (x.score / 100).toFixed(3) + ')"></i><span class="pf-pb-m"></span></div>') +
      '<span class="pf-pb-n">Median ' + esc(med) + (x.better === "low" ? ", fewer is better" : "") + (WORKLOAD[x.stat] ? ", workload" : "") + "</span></div>";
  }
  function rankShown(L, role) {   /* the bars the section draws (M.rank already leaves out faceoffs under 10 taken) */
    var by = {}; M.ranks(L).forEach(function (x) { by[x.stat] = x; });
    return RANK_GROUPS[role].map(function (g) { return [g[0], g[1].map(function (k) { return by[k] || null; }).filter(Boolean)]; });
  }
  /* the headline says only what the ranks say: first or top three in how many measures, else the best single rank when it
     is in the top half, else the first measure (points or save percentage) as it stands. A rank shared all the way down to
     last place is no strength: the first look headlined "Ranks highest in shutouts per game: tied for 8th" for a
     goaltender with none, because 11 of 18 have none and share 8th. Giveaways and penalty minutes never lead it alone:
     "3rd in penalty minutes" reads in hockey as the third most, though it ranks the third fewest.
     Every claim is checked against the ranks themselves (2026-10-20): a count of firsts says "or tied for first" when one
     is shared, and "Ranks highest in" is said only when no other measure (giveaways, penalty minutes and shared ranks
     included) ranks higher; otherwise the rank is stated plainly. Pools differ in size (faceoffs need ten taken), so
     "highest" is the smallest rank, not the fullest bar */
  var NOT_ALONE = { gv_pg: 1, pim_pg: 1 };
  function rankHead(rated, grp) {
    var firsts = rated.filter(function (x) { return x.rank === 1; }), k1 = firsts.length, k3 = rated.filter(function (x) { return x.rank <= 3; }).length;
    var what = function (x) { return statLabel(x.label).toLowerCase(); };
    var best = Math.min.apply(null, rated.map(function (x) { return x.rank; }));
    var top = rated.filter(function (x) { return x.rank + x.tied - 1 < x.n && !NOT_ALONE[x.stat]; }).sort(function (a, b) { return a.rank - b.rank || b.score - a.score; })[0];
    if (k1 >= 2) return (firsts.some(function (x) { return x.tied > 1; }) ? "First or tied for first" : "First") + " among " + grp + " in " + k1 + " of " + rated.length + " measures.";
    if (k3 >= 2) return "Top three among " + grp + " in " + k3 + " of " + rated.length + " measures.";
    if (top && top.rank === 1 && top.tied === 1) return "Best at " + what(top) + ": 1st of " + top.n + " " + grp + ".";
    if (top && top.score >= 50) return top.rank === best ? "Ranks highest in " + what(top) + ": " + lcFirst(top.text) + " " + grp + "." : cap(top.text) + " " + grp + " in " + what(top) + ".";
    return rated[0] ? cap(rated[0].text) + " " + grp + " in " + what(rated[0]) + "." : "Ranked among " + grp + ".";
  }
  function rankSec(p, L, role) {
    var groups = rankShown(L, role), all = [].concat.apply([], groups.map(function (g) { return g[1]; }));
    if (!all.length) return sec("pfPctH", head({ kicker: "Ranks", id: "pfPctH", h: "Not ranked yet.", p: "Ranks need a recorded stat line and " + M.SETTLE_GP + " games at a position." }));
    var any = all[0], grp = MANY[any.group], rated = all.filter(function (x) { return !WORKLOAD[x.stat]; });
    var cols = groups.map(function (g) { return g[1].length ? '<div class="pf-pgroup"><h3 class="pfx-sub">' + esc(g[0]) + "</h3>" + g[1].map(pbar).join("") + "</div>" : ""; }).join("");
    var lede = any.few ? "Ranks need " + M.SETTLE_GP + " games at a position, and " + esc(p.tag) + " has " + plural(num(L.groupGp), "game") + " as a " + ONE[any.group] + ". Each number sits beside the median of the " + any.n + " " + esc(grp) + " who have."
      : "Where " + esc(p.tag) + " ranks among " + any.n + " " + esc(grp) + " with " + word(M.SETTLE_GP) + " or more games at the position, by per-game rate. A full bar is first, and the tick is the middle of the pack.";
    return sec("pfPctH", head({ kicker: "Against other " + grp, id: "pfPctH", h: any.few ? "Not ranked yet." : rankHead(rated, grp), p: lede }) +
      '<div class="pf-pgrid' + (groups.length === 1 ? " one" : "") + '">' + cols + "</div>");
  }

  /* ---- form: a scrubbable line from the game log, against the position median ---- */
  var FORM = {
    S: [["p", "Points", "pts_pg", "points"], ["g", "Goals", "g_pg", "goals"], ["sog", "Shots", "sog_pg", "shots"], ["pm", "+/-", "pm_pg", "plus/minus"]],
    G: [["sv", "Saves", "sv_pg", "saves"], ["svp", "Save %", "sv_pct", "save percentage"], ["ga", "Goals against", "gaa", "goals against"]]
  };
  function formCalc(p, L, role, st) {
    var log = M.log(p.id, role), f = FORM[role].filter(function (x) { return x[0] === st.stat; })[0] || FORM[role][0];
    var pctv = f[0] === "svp", vals = log.map(function (r) { return pctv ? (r.sa ? r.sv / r.sa * 100 : null) : num(r[f[0]]); });
    var pc = M.rank(L, f[2]), med = pc && pc.median != null ? (pctv ? pc.median * 100 : pc.median) : null;   /* the median of the players M.rank ranks against */
    var defined = vals.filter(function (v) { return v != null; }), last = defined.slice(-5), avg = function (a) { return a.reduce(function (s, v) { return s + v; }, 0) / Math.max(1, a.length); };
    var a5 = avg(last), aS = avg(defined), low = f[0] === "ga", diff = aS ? (a5 - aS) / Math.abs(aS) : 0;
    return { log: log, f: f, pctv: pctv, vals: vals, pc: pc, med: med, last: last, a5: a5, aS: aS,
      word: Math.abs(diff) < 0.1 ? "Steady" : (diff > 0) !== low ? "Hotter lately" : "Cooler lately",
      fx: function (v) { return pctv ? v.toFixed(1) + "%" : S2.fmt(v, 2); } };
  }
  function formCopy(p, L, role, st) {
    var c = formCalc(p, L, role, st);
    if (c.log.length < 2) return headCopy({ copyId: "pfFormHd", kicker: "Form", id: "pfFormH", h: c.log.length ? "One game so far." : "No games yet.", p: "The form line appears after two games." });
    return headCopy({ copyId: "pfFormHd", kicker: "Form", id: "pfFormH", h: c.word + ": " + c.fx(c.a5) + " " + c.f[3] + " a game over the last " + word(c.last.length) + ".",
      p: "Against " + esc(c.fx(c.aS)) + " on the season" + (c.med != null ? " and " + esc(c.fx(c.med)) + " for the median " + esc(ONE[L.group]) + " (the dashed line)" : "") + ". Drag across the line to read each game." });
  }
  function formBody(p, L, role, st) {
    var c = formCalc(p, L, role, st); if (c.log.length < 2) return '<div id="pfFormB"></div>';
    var lo = Math.min.apply(null, c.vals.filter(function (v) { return v != null; }).concat(c.med != null ? [c.med] : []));
    var min = c.pctv ? Math.max(0, Math.floor((lo - 5) / 10) * 10) : Math.min(0, Math.floor(lo));
    var labels = c.log.map(function (r) { return M.etMonthDay(r.at) + " · " + (r.home ? "vs " : "at ") + r.opp + ", " + r.result + " " + r.score; });
    var series = [{ name: c.f[1], values: c.vals }];
    if (c.med != null) series.push({ name: "Median " + ONE[L.group], values: c.vals.map(function () { return Math.round(c.med * 100) / 100; }), dashed: true });
    var phone = window.innerWidth < 700;
    return '<div id="pfFormB" class="pfx-form">' + lineChart({ w: chartW(), h: phone ? 220 : 300, labels: c.log.map(function (r, i) { return "Game " + (i + 1); }), series: series, area: true, min: min, dec: c.pctv ? 1 : 0, suf: c.pctv ? "%" : "",
      ticks: phone ? 3 : 7, label: c.f[1] + " in each of " + c.log.length + " games", hint: "Drag or use the arrow keys to read a game." }, labels) + "</div>";
  }
  function formSec(p, L, role, st) {
    if (!st.stat || !FORM[role].some(function (x) { return x[0] === st.stat; })) st.stat = FORM[role][0][0];
    var side = M.log(p.id, role).length >= 2 ? tabs("stat", FORM[role].map(function (x) { return [x[0], esc(x[1])]; }), st.stat, "Form statistic", "sm") : "";
    return sec("pfFormH", '<header class="sec-head pfx-head">' + formCopy(p, L, role, st) + side + "</header>" + formBody(p, L, role, st), "tint");
  }

  /* ---- game log: a heat strip by week (stronger = bigger night), a detail line, or the full sortable table ---- */
  function heatVal(r, role, max) { return role === "G" ? (r.sa ? Math.max(0, Math.min(1, (r.sv / r.sa - 0.7) / 0.3)) : 0) : max ? num(r.p) / max : 0; }
  function stripHTML(p, log, role, st) {
    var max = Math.max.apply(null, log.map(function (r) { return num(r.p); }).concat([1])), weeks = {};
    log.forEach(function (r, i) { (weeks[r.week] = weeks[r.week] || []).push(i); });
    var sel = st.sel == null || st.sel >= log.length ? log.length - 1 : st.sel;
    var rowsH = Object.keys(weeks).sort(function (a, b) { return a - b; }).map(function (w) {
      return '<div class="pf-hrow"><span class="pf-hwk">Week ' + esc(w) + "</span><div class=\"pf-hcells\">" + weeks[w].map(function (i) {
        var r = log[i], v = heatVal(r, role, max), big = role === "G" ? S2.fmt(r.sv) : S2.fmt(r.p);
        /* the number is always ink, so the ramp stops at 44%: ink then holds AA on every theme and finish pair */
        var bg = "color-mix(in srgb, var(--chart-a) " + Math.round(8 + v * 36) + "%, var(--surface-2))";
        return '<button type="button" class="pf-hc pf-press" data-act="cell" data-i="' + i + '" aria-pressed="' + (i === sel) + '" tabindex="' + (i === sel ? 0 : -1) + '"' +
          ' style="background:' + bg + '" aria-label="' + esc(r.date + ", " + (r.home ? "vs " : "at ") + r.opp + ", " + RES_WORD[r.result] + " " + r.score + ", " + big + " " + (role === "G" ? "saves" : "points")) + '">' +
          '<span class="num">' + big + '</span><i class="pf-hc-r ' + r.result.toLowerCase() + (r.ff ? " ff" : "") + '"></i></button>';
      }).join("") + "</div></div>";
    }).join("");
    return '<div class="pf-heat-x"><div class="pf-heat-l"><div class="pf-heat" role="group" aria-label="Games by week; left and right move between games, up and down between weeks">' + rowsH + "</div>" +
      '<div class="pf-heat-key"><span>Number: ' + (role === "G" ? "saves" : "points") + '</span><span><i class="pf-hc-r w"></i>Win</span><span><i class="pf-hc-r l"></i>Loss</span><span><i class="pf-hc-r otl"></i>Overtime loss</span>' +
      '<span class="pf-ramp" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>' + (role === "G" ? "Higher save %" : "More points") + "</span></div></div>" + detailHTML(log[sel], role) + "</div>";
  }
  /* the live region stays in the page and only its contents change: a screen reader ignores a live region that arrives already
     filled (v2 review: each selection replaced #pfHd itself, so nothing was announced) */
  function detailHTML(r, role) { return '<div id="pfHd" class="pf-hd" aria-live="polite">' + detailInner(r, role) + "</div>"; }
  function detailInner(r, role) {
    if (!r) return "";
    var line = role === "G" ? plural(num(r.sv), "save") + " on " + plural(num(r.sa), "shot") + (r.sa ? " (" + M.display("sv_pct", r.sv / r.sa) + ")" : "") + ", " + plural(num(r.ga), "goal") + " against" + keeperBits(r).map(function (b) { return ", " + b; }).join("")
      : plural(num(r.g), "goal") + ", " + plural(num(r.a), "assist") + ", " + plural(num(r.sog), "shot") + ", " + signed(num(r.pm)) + " plus/minus";
    return '<div class="pfx-hd-top">' + plate(r.opp, "sm") + '<div class="grow"><span class="pfx-hd-k">' + esc(r.date) + "</span>" +
        '<p class="pfx-hd-t d-3">' + (r.home ? "vs " : "at ") + esc(r.opp) + ' <span class="pfx-res ' + r.result.toLowerCase() + '">' + esc((r.ff ? "Forfeit " + RES_WORD[r.result].toLowerCase() : RES_WORD[r.result]) + " " + r.score) + "</span></p></div></div>" +
      '<p class="pfx-hd-l">' + esc(line) + (r.toi_s ? ", " + esc(M.toi(r.toi_s)) + " on the ice" : "") + (r.pos && role !== "G" ? ", played " + esc(M.posName(r.pos) || r.pos) : "") + ".</p>" +
      arrow(r.href, "Game Center");
  }
  function logCols(role) {
    var base = [{ k: "at", label: "Date", cell: function (r) { return '<a href="' + r.href + '">' + esc(M.etMonthDay(r.at)) + "</a>"; } },
      { k: "opp", label: "Opp", cell: function (r) { return (r.home ? "vs " : "at ") + esc(r.opp); } },
      { k: "result", label: "Result", cell: function (r) { return esc(r.result + " " + r.score) + (r.ff ? " (forfeit)" : ""); } }];
    var S = [["g", "G", "Goals"], ["a", "A", "Assists"], ["p", "P", "Points"], ["pm", "+/-", "Plus/minus"], ["sog", "SOG", "Shots on goal"], ["hits", "HIT", "Hits"], ["tk", "TK", "Takeaways"], ["gv", "GV", "Giveaways (every lost puck)"]];
    var G = [["sv", "SV", "Saves"], ["sa", "SA", "Shots against"], ["ga", "GA", "Goals against"], ["dsv", "DS", "Desperation saves"], ["sop", "SOP", "Shutout periods"]];
    var cols = base.concat((role === "G" ? G : S).map(function (c) { return { k: c[0], label: c[1], title: c[2], cell: c[0] === "pm" ? function (r) { return signed(num(r.pm)); } : null }; }));
    if (role === "G") cols.push({ k: "svp", label: "SV%", title: "Save percentage", sortVal: function (r) { return r.sa ? r.sv / r.sa : null; }, cell: function (r) { return r.sa ? M.display("sv_pct", r.sv / r.sa) : "–"; } });
    if (role === "G") cols.push({ k: "psa", label: "PS", title: "Penalty shots stopped", sortVal: function (r) { return num(r.psa) ? num(r.psv) / r.psa : null; }, cell: function (r) { return num(r.psa) ? r.psv + "/" + r.psa : "–"; } });
    cols.push({ k: "toi_s", label: "TOI", title: "Time on ice", cell: function (r) { return esc(M.toi(r.toi_s)); } });
    return cols;
  }
  function logBody(p, role, st) {
    var log = M.log(p.id, role);
    if (!log.length) return '<div id="pfLogB"></div>';
    return '<div id="pfLogB">' + (st.view === "table" ? table("pfLogT", logCols(role), log, { k: "at", dir: "asc" }, "Game log") : stripHTML(p, log, role, st)) + "</div>";
  }
  function logSec(p, role, st) {
    var log = M.log(p.id, role); if (!log.length) return "";
    var key = role === "G" ? "sv" : "p", best = null;
    log.forEach(function (r) { if (!best || num(r[key]) >= num(best[key])) best = r; });   /* a tie goes to the latest night */
    var h = "Best night: " + plural(num(best[key]), role === "G" ? "save" : "point") + (best.home ? " vs " : " at ") + best.opp + ", " + M.etMonthDay(best.at) + ".";
    return sec("pfLogH", head({ kicker: "Game log", id: "pfLogH", h: h, p: plural(log.length, "game") + (role === "G" ? " in goal" : "") + ", one square each by week. The stronger the color, the bigger the night; select a square to read the game.",
      side: tabs("view", [["strip", "By week"], ["table", "Table"]], st.view, "Game log view", "sm") }) + logBody(p, role, st), "ink");
  }

  /* ---- career: every season the player has played, both roles, on any club, whatever the line switch shows, and for a
     player on no roster too (commissioner, 2026-11-20: "build in the stats page that it should always show a player's full
     history on their player stats profile"). A row is a season line (M.career); the live site's twin is the Career card. ---- */
  var STAGE = { pre: "Pre-season", reg: "Regular season", po: "Playoffs" };
  /* the columns of a career, by role; lead is the number the headline counts, set in bold */
  var CAREER_COLS = {
    S: [["gp", "GP", "Games played"], ["g", "G", "Goals"], ["a", "A", "Assists"], ["p", "P", "Points", "lead"], ["pm", "+/-", "Plus/minus"], ["pim", "PIM", "Penalty minutes"], ["sog", "SOG", "Shots on goal"]],
    G: [["gp", "GP", "Games played"], ["w", "W", "Wins", "lead"], ["l", "L", "Losses"], ["otl", "OTL", "Overtime losses"], ["sv_pct", "SV%", "Save percentage"], ["gaa", "GAA", "Goals against average"], ["so", "SO", "Shutouts"]]
  };
  function careerVal(k, v) { return k === "pm" ? signed(num(v)) : M.STATS[k] ? M.display(k, v) : (v == null ? "–" : S2.fmt(v)); }
  /* a career reads in order, so its headings are labels, not sort controls; the season sits pinned while the numbers scroll
     (phone). A club is a crest and a name that opens the club (its code on a phone), answered on pointer-down (.pf-press). */
  function careerTable(role, rows) {
    var cols = CAREER_COLS[role];
    var club = function (c) {
      var t = M.team(c);
      return '<a class="pf-car-club pf-press" href="#/club/' + esc(c) + '">' + M.crest(c) + '<span class="pf-car-nm">' + esc(t ? t.name : c) + '</span><span class="pf-car-cd">' + esc(c) + "</span></a>";
    };
    var body = rows.map(function (r) {
      return '<tr><th scope="row"><span class="pf-car-s">Season ' + r.season + '</span><span class="pf-car-st">' + esc(STAGE[r.stage]) + "</span></th>" +
        '<td class="pf-car-clubs">' + r.clubs.map(club).join("") + "</td>" +
        cols.map(function (c) { return '<td' + (c[3] ? ' class="lead"' : "") + ">" + esc(careerVal(c[0], r.line[c[0]])) + "</td>"; }).join("") + "</tr>";
    }).join("");
    /* career totals once there is more than one season of a kind of game; rates come from the summed counts, never averaged */
    ["reg", "po"].forEach(function (stage) {
      var of = rows.filter(function (r) { return r.stage === stage; });
      if (of.length < 2) return;
      var t = {};
      ["gp", "g", "a", "p", "pm", "pim", "sog", "w", "l", "otl", "so", "sv", "sa", "ga"].forEach(function (k) { t[k] = of.reduce(function (a, r) { return a + num(r.line[k]); }, 0); });
      t.sv_pct = t.sa ? t.sv / t.sa : null; t.gaa = t.gp ? t.ga / t.gp : null;
      body += '<tr class="pf-car-tot"><th scope="row"><span class="pf-car-s">Career</span><span class="pf-car-st">' + esc(STAGE[stage]) + "</span></th><td></td>" +
        cols.map(function (c) { return '<td' + (c[3] ? ' class="lead"' : "") + ">" + esc(careerVal(c[0], t[c[0]])) + "</td>"; }).join("") + "</tr>";
    });
    return '<div class="tbl-wrap pf-tbl-wrap"><table class="tbl pf-tbl pf-car" aria-label="Career, ' + (role === "G" ? "in goal" : "as a skater") + '"><thead><tr>' +
      '<th scope="col">Season</th><th scope="col" class="pf-car-clubh">Club</th>' + cols.map(function (c) { return '<th scope="col" title="' + esc(c[2]) + '">' + esc(c[1]) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }
  function careerSec(p) {
    var rows = M.career(p.id);
    var seasons = {}, games = 0, clubs = [];
    rows.forEach(function (r) { seasons[r.season] = 1; games += num(r.line.gp); r.clubs.forEach(function (c) { if (clubs.indexOf(c) < 0) clubs.push(c); }); });
    var nS = Object.keys(seasons).length, one = clubs.length === 1 ? M.team(clubs[0]) : null, where = one ? " for " + one.city : clubs.length > 1 ? " for " + word(clubs.length) + " clubs" : "";
    /* QA round 2 (2026-11-25): the rows are the season on screen's (s2_league reads one season); a member's games in any
       other season are counted beside them (M.careerEarlier) and linked to their page on that season, never "No league
       games yet" for a veteran */
    var aw = elsewhere(p), away = aw ? plural(aw.n, "game") + " in " + aw.where : "";
    var h = rows.length && aw ? cap(plural(games, "game")) + " in " + M.view.name + where + ", " + away + "."
      : rows.length ? cap(word(nS)) + " season" + (nS === 1 ? "" : "s") + ", " + plural(games, "game") + where + "."
      : aw ? cap(away) + ", none in " + M.view.name + (M.view.status === "complete" ? "." : " yet.") : "No league games yet.";
    var roles = rows.map(function (r) { return r.role; }).filter(function (r, i, a) { return a.indexOf(r) === i; })
      .sort(function (a, b) { return a === p.mainRole ? -1 : b === p.mainRole ? 1 : 0; });
    var body = roles.map(function (role) {
      return (roles.length > 1 ? '<h3 class="pf-car-role">' + (role === "G" ? "In goal" : "As a skater") + "</h3>" : "") +
        careerTable(role, rows.filter(function (r) { return r.role === role; }));
    }).join("");
    var p0 = aw ? (rows.length ? "Every " + esc(M.view.name) + " game on any club, whether or not they are on a roster now. Playoffs and pre-season get rows of their own. " : "") +
        "The games in " + esc(aw.where) + " are on " + (aw.links.length === 1 ? "that season's" : "each season's") + " page."
      : rows.length ? "Every league game, every season, on any club, whether or not they are on a roster now. Playoffs and pre-season get rows of their own." : "Every season they play will be listed here.";
    return sec("pfCarH", head({ kicker: "Career", id: "pfCarH", h: h, p: p0,
      side: aw ? aw.links.map(function (l) { return arrow(esc(l[0]), l[1]); }).join("") : "" }) + body);
  }

  /* ---- the clubs a training camp player filled in for (per-game requests they accepted, PROPOSED 2026-11-24). Every
     game counts in full and toward six; the player is never flagged as unrostered for one (Rule S2.5) ---- */
  function fillSec(p) {
    var f = S2.market && S2.market.fillIns ? S2.market.fillIns(p.id) : []; if (!f.length) return "";
    var clubs = f.map(function (x) { return x.club; }).filter(function (c, i, a) { return a.indexOf(c) === i; });
    return sec("pfFillH", head({ kicker: "Training camp", id: "pfFillH", h: "Filled in for " + (clubs.length === 1 ? "one club" : clubs.length + " clubs"),
      p: "Games a club requested and the player accepted, one game at a time. Each counts in full, and toward the six games for Saturday bidding (Rule S2.5)." }) +
      '<div class="list pf-fill">' + f.map(function (x) { var t = M.team(x.club) || { full: x.club };
        return '<div class="row">' + M.crest(x.club) + '<span class="grow"><span class="title">' + esc(t.full) + '</span><span class="sub">' + esc(x.label + " · " + (x.games.length === 1 ? "game " + x.games[0] : "games " + x.games.join(", "))) + "</span></span></div>"; }).join("") + "</div>");
  }

  /* ---- honors and club stints, side by side as two short editorial columns ---- */
  /* Trophies and titles (commissioner, 2026-11-21: "add awards to players who won the stanley cup and any other stat
     awards"): each is a row like the club page's By season rows, the season's numeral on the left (S1), its name, then what
     won it. They lead the column in one order (M.honorRank), then Players of the Week, newest first. Once a season's
     titles are filed its title races are over, so their rows go (the season sentence above keeps the snapshot's race). */
  function tcity(code) { var t = M.team(code); return t ? t.city : code; }
  /* an award in two parts (commissioner, 2026-11-23: "do not add runner ups to them, just a quick description of what the
     award is, and the stats that mattered for it"): what it is (M.TROPHY.how, M.TITLE_HOW), then the numbers that won it.
     One definition for the profile and the club page; x is a trophy, a filed title or a player's honor carrying either */
  function awardParts(x) {
    var key = x.key || x.category, what = (M.TROPHY[key] || {}).how || M.TITLE_HOW[key] || "";
    var series = function (where) { return tcity(x.club) + (x.l === 0 ? " swept " : " beat ") + tcity(x.over) + " " + x.w + "-" + x.l + " in the " + where; };
    var fin = key === "presidents_trophy" ? finOf(x.club, x.season) : null, team = M.team(x.club);
    var stats = key === "stanley_cup" ? series("final") : key === "wales_trophy" || key === "campbell_bowl" ? series((team ? team.division : "") + " Division final")
      : key === "presidents_trophy" ? (fin ? fin.pts + " points, " + fin.w + "-" + fin.l + "-" + fin.otl : "")
      : key === "jennings" ? tcity(x.club) + " allowed " + x.total + "; " + plural(x.gp, "game") + " in goal"
      : M.TROPHY[key] ? x.total + " in " + plural(x.gp, "game")
      : S2.fmt(x.value, 2) + " over " + plural(x.gp, "game") + (key === "goaltending_title" ? " in goal" : "");
    if (!what || !stats) console.error("awardParts: no description or numbers for " + key);
    return [what, stats];
  }
  function awardLine(x) { var a = awardParts(x); return a[0] + ": " + a[1] + "."; }
  function honorsCol(p) {
    var filed = M.filedTitles(M.view.season).length > 0, sorted = p.honors.slice().sort(function (a, b) { return M.honorRank(a) - M.honorRank(b); });
    var awards = sorted.filter(function (h) { return h.kind === "trophy" || h.kind === "title"; }), potw = sorted.filter(function (h) { return h.kind === "potw"; });
    var races = filed ? [] : sorted.filter(function (h) { return h.kind === "title_race"; });
    if (!awards.length && !potw.length && !races.length) return "";
    var cup = awards.filter(function (x) { return x.key === "stanley_cup"; })[0], seasonal = awards.filter(function (x) { return x !== cup; });
    var h, sent;
    if (awards.length) {
      h = awards.length > 2 ? cap(word(awards.length)) + " awards in Season " + awards[0].season + "." : awards.length === 2 ? awards[0].short + " and " + awards[1].short + "." : cup ? "Stanley Cup champion." : awards[0].name + ".";
      /* QA nits 9 (2026-11-25): no Rule 9.1 here until the book carries the Cup's sharing (league.js awards, same note) */
      sent = (cup ? "The Stanley Cup goes to every player on the champion's roster or in its training camp when the final is decided. " : "") +
        (seasonal.some(function (x) { return x.kind === "trophy"; }) ? "Trophies count season totals, the NHL's way; titles go to the best rate per game (Rule 9.2)." : seasonal.length ? "Titles go to the best rate per game among playoff-eligible players (Rule 9.2)." : "") +
        (potw.length ? " Also Player of the Week " + (potw.length > 1 ? word(potw.length) + " times" : "in Week " + potw[0].week) + "." : "");
    } else {
      h = potw.length > 1 ? cap(word(potw.length)) + " times Player of the Week." : potw.length ? "Player of the Week, Week " + potw[0].week + "." : ord(races[0].place) + " in the " + races[0].label.split(":")[0] + " race.";
      var lead = races.filter(function (x) { return x.place === 1; }).map(function (x) { return x.label.split(":")[0].replace(" Title", ""); });
      sent = lead.length ? "Leads the " + (lead.length > 1 ? lead.slice(0, -1).join(", ") + " and " + lead[lead.length - 1] : lead[0]) + " Title race" + (lead.length > 1 ? "s" : "") + ". Titles are decided when the regular season ends." :
        races.length ? "In " + plural(races.length, "title race") + ". Titles are decided when the regular season ends." : "Picked from players with 3 or more games at one position that week.";
    }
    var items = awards.map(function (x) {
      return '<li class="pfx-hon-aw"><span class="pfx-hon-n d-num">S' + esc(x.season) + '</span><span class="grow"><b>' + esc(x.name) + "</b><span>" + esc(awardLine(x)) + "</span></span></li>";
    }).join("") + potw.map(function (x) {
      return '<li><span class="pfx-hon-n d-num">W' + esc(x.week) + '</span><span class="grow"><b>Player of the Week, Week ' + esc(x.week) + "</b><span>" + esc(x.label.replace(/^Player of the Week \((.*)\), Week \d+$/, "$1")) + ", " + esc(x.line) + "</span></span></li>";
    }).join("") + races.map(function (x) {
      return '<li><span class="pfx-hon-n d-num">' + esc(ord(x.place)) + '</span><span class="grow"><b>' + esc(x.label.split(":")[0]) + " race</b><span>" +
        esc(S2.fmt(x.perGame, 2) + (x.category === "goaltending_title" ? " goals against a game" : " a game")) + " over " + plural(x.gp, "game") + "</span></span></li>";
    }).join("");
    return '<div class="pfx-col">' + head({ kicker: "Honors", id: "pfHonH", h: h, p: esc(sent.trim()), side: arrow("#/stats?tab=awards", "All awards") }) + '<ul class="pfx-rows pfx-hon">' + items + "</ul></div>";
  }
  /* the hero's honor flag: the player's highest award, one flag (the column above lists them all) */
  function honorFlag(p) {
    var top = p.honors.filter(function (h) { return h.kind === "trophy" || h.kind === "title"; }).sort(function (a, b) { return M.honorRank(a) - M.honorRank(b); })[0];
    return top ? '<span class="pfx-flag honor">' + S2.ic("trophy") + "<span>" + esc(top.key === "stanley_cup" ? "Stanley Cup champion" : top.short) + "</span></span>" : "";
  }
  function tenureCol(p, role) {
    if (!p.tenures.length) return "";
    var log = role ? M.log(p.id, role) : [], clubs = {};
    p.tenures.forEach(function (t) { clubs[t.club] = 1; });
    var nC = Object.keys(clubs).length, cur = p.tenures.filter(function (t) { return !t.to; })[0], lastT = p.tenures.slice().sort(function (a, b) { return String(b.from).localeCompare(String(a.from)); })[0];
    var city = function (t) { return t.team ? t.team.city : t.club; };
    var h = nC === 1 && cur ? "With " + city(cur) + " since " + cur.fromLabel + "." : nC === 1 ? "With " + city(lastT) + " until " + lastT.toLabel + "." : cap(word(nC)) + " clubs in " + M.view.name + ".";
    var items = p.tenures.slice().sort(function (a, b) { return String(b.from).localeCompare(String(a.from)); }).map(function (t) {
      var mine = log.filter(function (r) { return r.club === t.club && r.at >= t.from && (!t.to || r.at <= t.to); });
      var tot = mine.reduce(function (a, r) { a.g += num(r.g); a.a += num(r.a); a.sv += num(r.sv); return a; }, { g: 0, a: 0, sv: 0 });
      var line = !mine.length ? "No games in this stint" : plural(mine.length, "game") + (role === "G" ? ", " + plural(tot.sv, "save") : ", " + plural(tot.g, "goal") + ", " + plural(tot.a, "assist"));
      /* the whole row is the link (v2 review: the club name alone was a 20px target) */
      return '<li class="pf-ten' + (t.to ? "" : " now") + '"><a class="pf-rec pf-press" href="#/club/' + esc(t.club) + '">' + M.crest(t.club) +
        '<span class="grow"><b>' + esc(t.team ? t.team.full : t.club) + "</b><span>" + esc(t.fromLabel) + " to " + esc(t.to ? t.toLabel : "now") + (t.pos ? ", " + esc(M.posName(t.pos) || t.pos) : "") +
        ". " + esc(HOW_IN[t.how_in] || "Joined") + (t.how_out ? "; " + esc((HOW_OUT[t.how_out] || "Left").replace(/^./, function (c) { return c.toLowerCase(); })) : "") + ". " + esc(line) + ".</span></span>" + S2.chev() + "</a></li>";
    }).join("");
    return '<div class="pfx-col">' + head({ kicker: "Clubs", id: "pfTenH", h: h, p: nC > 1 ? "Each stint, newest first, with that stint's games. The season numbers above count every club." : "Every game in the season numbers above was played for this club." }) +
      '<ol class="pfx-rows pf-tens">' + items + "</ol></div>";
  }
  function tailSec(p, role) {
    var a = honorsCol(p), b = tenureCol(p, role);
    if (!a && !b) return '<div id="pfTail" hidden></div>';   /* kept in the page, so a demo signing can repaint the clubs column into it */
    return '<section class="pfx-sec reveal pfx-split' + (a && b ? " two" : "") + '" id="pfTail" aria-label="Honors and clubs">' + a + b + "</section>";
  }

  /* ---- the role-specific body: everything below the hero ---- */
  /* the line switch lives OUTSIDE #pfBody, so switching repaints the body and never the control that was pressed: focus stays on
     it and the underline springs (v2 review: rebuilding it dropped focus to <body>) */
  function roleBar(p, st) {
    return p.roles.length === 2 ? '<div class="pfx-rolebar reveal"><span class="pfx-rolebar-k">Season line</span>' +
      tabs("role", p.roles.map(function (r) { return [r, (r === "G" ? "In goal" : "As a skater") + ' <span class="num">' + p.lines[r].gp + " GP</span>"]; }), st.role, "Which season line") + "</div>" : "";
  }
  function bodyP(p, st) {
    var role = st.role, L = role ? p.lines[role] : null;
    if (!L) return careerSec(p) + fillSec(p) + tailSec(p, null);
    return seasonSec(p, L, role) + radarSec(p, st) + rankSec(p, L, role) + formSec(p, L, role, st) + logSec(p, role, st) + careerSec(p) + fillSec(p) + tailSec(p, role);
  }
  function aboutP(p) {
    var g = p.roles.indexOf("G") >= 0, s = p.roles.indexOf("S") >= 0;
    return about([
      "CGHL ratings run from 75 to 99, and the league's middle player at each position rates 85. Each position played gets its own rating, built from that player's games at the position against everyone who plays it; under " + M.SETTLE_GP + " games it is provisional and can still move a lot.",
      "Every line counts: season numbers include every game at every position in that role, for every club. A player who has played in goal and as a skater keeps both lines whole.",
      "Season rings: a full ring is the league's best total, and the gray ring is games played out of every game the club has had.",
      "Ranks order per-game rates among players of the same position group with " + word(M.SETTLE_GP) + " or more games there, so 1st is the best. Players level at the precision shown share a rank (tied for 24th) and the next rank skips. A full bar is first and an empty one last; the tick is the middle of the pack." +
        (s ? " For giveaways and penalty minutes, fewer ranks higher. EA counts every lost puck as a giveaway, so the numbers run high; a player's faceoff win rate counts only games played at center, and ranks among centers after 10 taken. Shots on net is shots on goal out of shot attempts, capped at 100%, because EA can credit a shot on goal without an attempt." : "") +
        (g ? " For goals against, fewer ranks higher; saves and shots against a game measure workload (1st faced the most), so they carry no good or bad color. Desperation saves and shutout periods are EA's own counts; a shutout period is a period with no goal against, which a goaltender can earn in a loss." : ""),
      "The form line plots one point per game, oldest on the left; the dashed line is the median player's per-game rate at the position.",
      "Career lists every season the player has played, a row for each season and kind of game, in each role, on any club, whether or not they are on a roster now.",
      "In the game log, each square is one game and the bar under it is the result, faded for a forfeit. Forfeits decide the result the way the standings do.",
      (function () {   /* keyed on what the Honors column shows (review 2026-11-23: the Cup alone drew a Player of the Week note) */
        var has = function (k) { return p.honors.some(function (h) { return h.kind === k; }); }, filed = M.filedTitles(M.view.season).length > 0;
        /* the seasons the awards are from, by name ("Season 1's"), never a fixed one */
        var won = function () { var n = []; p.honors.forEach(function (h) { if ((h.kind === "trophy" || h.kind === "title") && n.indexOf(h.season) < 0) n.push(h.season); });
          return n.sort(function (a, b) { return a - b; }).map(function (x) { return S2.seasonName(x) + "'s"; }).join(" and "); };
        var t = (has("potw") ? "Players of the Week are picked each week from players with 3 or more games at one position. " : "") +
          /* a closed season's awards are explained whatever season is on screen; the race rule only while the season on screen races */
          (has("trophy") || has("title") ? "Trophies and titles are " + won() + " as decided: the Stanley Cup goes to every player on the champion's roster or in its training camp when the final is decided, the NHL's trophies count season totals, and the league's titles the best rate per game (Rule 9.2)."
            : !filed && has("title_race") ? esc(M.honors.rule) : "");
        return t.trim() || null;
      })(),
      "Source: EA box scores and the CGHL rating engine, " + esc(M.view.name) + " regular season, as of " + esc(M.etFull(M.generated)) + "."
    ]);
  }

  /* a bare #/player opens the season's points leader (M.examples.pointsLeader); a season with no games has none, and says so */
  function notFound(a) {
    return '<header class="hero pfx-nf reveal">' + crumb([["#/stats?tab=players", "Players"]], a ? "Not found" : "Players") + '<h1 class="d-1">' + (a ? "Player not found" : "No points leader yet") + '</h1><p class="lede-l">' +
      (a ? "No player matches “" + esc(a) + "”. They may have changed their gamertag, or the link may be cut short." : esc(M.view.name) + (M.view.empty.games ? " has no games yet" : " has no box scores yet") + ", so nobody leads in points. Find a player by name.")   /* QA nits 32: scheduled games are games */ + "</p>" +
      '<div class="pfx-nf-act"><button type="button" class="btn site pf-press" data-act="search">' + S2.ic("search") + 'Search players</button><a class="btn site outline pf-press" href="#/stats?tab=players">Player directory</a></div></header>';
  }

  /* ---- Compare sheet: pick anyone in the same role; the two animate side by side ---- */
  var CMP = { S: ["pts_pg", "g_pg", "a_pg", "sog_pg", "shot_pct", "onnet_pct", "pm_pg", "tk_pg", "hits_pg", "pass_pct", "gv_pg"], G: ["sv_pct", "gaa", "sv_pg", "sa_pg", "brk_sv_pct", "so_pg", "dsv_pg", "sop_pg"] };
  function cmpDefault(A, role) {
    var key = role === "G" ? "sv_pct" : "pts_pg";
    var same = M.lines({ role: role, group: A.group, minGp: M.SETTLE_GP, sort: key }).filter(function (l) { return l.pid !== A.pid; });
    if (!same.length) same = M.lines({ role: role, minGp: 1, sort: key }).filter(function (l) { return l.pid !== A.pid; });
    return same[0] || null;
  }
  /* a season line keeps the club it was built for; after a demo trade the player's club is where they are now */
  function clubNow(L) { var p = M.player(L.pid); return p && p.rostered ? p.club : L.club; }
  function who(L, side) {
    var h = ratingFor(L.pid, L.role), c = clubNow(L);
    return '<div class="pf-cw pf-cw-' + side + '">' + M.crest(c, "lg") + '<a class="pf-cw-n d-3" href="' + L.href + '">' + esc(L.tag) + "</a>" +
      '<span class="t-foot">' + esc((M.posName(L.pos) || L.pos || "") + ", " + c + ", " + L.gp + " GP") + "</span>" +
      '<span class="pf-cw-o"><b class="d-num">' + (h ? h.ovr : "–") + '</b><span class="t-foot">' + (h ? esc(h.posName) + " rating" + (h.provisional ? ", provisional" : "") : "Not rated") + "</span></span></div>";
  }
  function cmpRows(A, B, role) {
    return CMP[role].map(function (k) {
      var a = M.rank(A, k), b = B ? M.rank(B, k) : null, s = M.STATS[k];
      if (!a && !b) return "";
      /* each bar is the rank's score at that player's own position; under six games there is no rank and so no bar */
      var on = function (x) { return x && !x.few; }, ap = on(a) ? a.score : 0, bp = on(b) ? b.score : 0;
      /* bold by the rank, as the trade head to head does (M.rankBetter): only in one pool, where rank, bar and value agree.
         Bolding the fuller bar across groups put 0.06 goals per game in bold over 0.91 (review 2026-10-20). Workload has
         no stronger side */
      var wl = WORKLOAD[k], cmp = wl ? null : M.rankBetter(a, b), aw = cmp === 1, bw = cmp === -1;
      var rk = function (x) { return on(x) ? x.text + " " + MANY[x.group] : x ? "not ranked, under " + M.SETTLE_GP + " games" : ""; };
      /* the rank in words under each value, for every reader (the ruling asks for "9th of 18", and a title never shows on
         touch); a screen reader hears the full one with the position instead of "T-9th". Each value names its player for a
         screen reader: the color key above is decoration (v2 review: "5.17 4.18" with no names) */
      var rkv = function (x) { return '<span class="pf-bf-rk t-foot" aria-hidden="true">' + esc(on(x) ? x.shortText + " of " + x.n : x ? "Under " + word(M.SETTLE_GP) + " games" : "") + "</span>"; };
      return '<div class="pf-bf" data-k="' + k + '"><span class="pf-bf-l">' + esc(statLabel(s.label)) + (s.better === "low" ? " (fewer is better)" : wl ? " (workload)" : "") + "</span>" +
        '<span class="pf-bf-va num' + (aw ? " win" : "") + '"><span class="sr">' + esc(A.tag) + " </span>" + esc(a ? a.display : "–") + '<span class="sr">, ' + esc(rk(a)) + "</span>" + rkv(a) + "</span>" +
        '<span class="pf-bf-a" title="' + esc(rk(a)) + '"><i data-grow style="transform:scaleX(' + (ap / 100).toFixed(3) + ')"></i></span>' +
        '<span class="pf-bf-b" title="' + esc(rk(b)) + '"><i data-grow style="transform:scaleX(' + (bp / 100).toFixed(3) + ')"></i></span>' +
        '<span class="pf-bf-vb num' + (bw ? " win" : "") + '"><span class="sr">' + esc(B ? B.tag : "") + " </span>" + esc(b ? b.display : "–") + '<span class="sr">, ' + esc(rk(b)) + "</span>" + rkv(b) + "</span></div>";
    }).join("");
  }
  function cmpRadar(A, B) {
    var ra = ratingFor(A.pid, A.role), rb = B ? ratingFor(B.pid, B.role) : null;
    if (!ra || !rb || ra.radar.axes.length !== rb.radar.axes.length) return '<div id="pfCmpR"></div>';
    return '<div id="pfCmpR" class="pf-cmp-r"><p class="pfx-cmp-s">Rating categories: ' + esc(A.tag) + " as a " + esc(ONE[ra.pos] || ra.posName) + " (solid), " + esc(B.tag) + " as a " + esc(ONE[rb.pos] || rb.posName) + " (dashed).</p>" +
      S2.charts.radar({ size: 250, axes: ra.radar.axes, a: ra.radar.a, b: rb.radar.a, label: A.tag + " and " + B.tag + " rating categories" }) + "</div>";
  }
  function openCompare(p, role) {
    var A = p.lines[role]; if (!A) return;
    var B = cmpDefault(A, role), st = { q: "" };
    var pool = M.lines({ role: role, minGp: 1, sort: role === "G" ? "gp" : "p" }).filter(function (l) { return l.pid !== A.pid; });
    var sugg = M.lines({ role: role, group: A.group, minGp: M.SETTLE_GP, sort: role === "G" ? "sv_pct" : "pts_pg" }).filter(function (l) { return l.pid !== A.pid; }).slice(0, 4);
    var mates = pool.filter(function (l) { return clubNow(l) === clubNow(A); }).slice(0, 1);
    sugg = sugg.concat(mates.filter(function (m) { return !sugg.some(function (s) { return s.pid === m.pid; }); }));
    var html = '<div class="pf-cmp">' +
      '<div class="pf-cmp-who" id="pfCmpWho">' + who(A, "a") + '<span class="pf-vs d-2" aria-hidden="true">vs.</span>' + (B ? who(B, "b") : '<div class="pf-cw pf-cw-b">' + empty("Pick a player", "Search below.") + "</div>") + "</div>" +
      '<div class="pf-cmp-pick"><label class="sr" for="pfCmpQ">Compare with</label><input id="pfCmpQ" class="input" type="search" placeholder="Compare with any ' + (role === "G" ? "goaltender" : "skater") + '" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search">' +
        '<div class="pf-cmp-sugg" id="pfCmpS">' + sugg.map(function (l) { return '<button type="button" class="chip pf-press" data-pick="' + l.pid + '" aria-pressed="' + (B && B.pid === l.pid) + '">' + esc(l.tag) + "</button>"; }).join("") + "</div>" +
        '<div class="pf-cmp-res" id="pfCmpL" aria-label="Matching players"></div></div>' +
      '<p class="pfx-cmp-s">Per-game values. Each bar is that player\'s rank at their own position among players with ' + word(M.SETTLE_GP) + " or more games there, full for 1st and empty for last. When both play the same position group, the higher rank is in bold. Under " + word(M.SETTLE_GP) + " games at the position there is no rank, so no bar.</p>" +
      '<div class="pf-cmp-key t-foot" aria-hidden="true"><span><i class="pf-dot" style="background:var(--chart-a)"></i>' + esc(A.tag) + '</span><span><i class="pf-dot" style="background:var(--chart-b)"></i><span id="pfCmpBn">' + esc(B ? B.tag : "") + "</span></span></div>" +
      '<div class="pf-bfs" id="pfCmpRows">' + cmpRows(A, B, role) + "</div>" + cmpRadar(A, B) + "</div>";
    var sh = S2.sheet({ title: "Compare " + A.tag, label: "Compare " + A.tag + " with another player", html: html });
    var body = sh.body;
    /* a name in the sheet goes to that player's page, so the sheet closes on the press (review 2026-10-19: it stayed open
       over the new page with the page inert, and the player's own name did nothing); hq.js closeOnLinks does the same */
    sh.el.addEventListener("click", function (e) { if (e.target.closest('a[href^="#/"]')) sh.close(); });
    setTimeout(function () { grow(body); }, 60);
    function list() {
      var q = st.q.trim().toLowerCase(), host = S2.$("#pfCmpL", body);
      var hits = q ? pool.filter(function (l) { return String(l.tag).toLowerCase().indexOf(q) >= 0 || String(clubNow(l)).toLowerCase() === q; }).slice(0, 6) : [];
      host.innerHTML = q && !hits.length ? '<p class="t-foot pf-cmp-none">No ' + (role === "G" ? "goaltender" : "skater") + " matches “" + esc(st.q) + "”.</p>" :
        hits.map(function (l) { var c = clubNow(l); return '<button type="button" class="row pf-press" data-pick="' + l.pid + '">' + M.crest(c) + '<span class="grow"><span class="title">' + esc(l.tag) + '</span><br><span class="sub">' + esc((M.posName(l.pos) || l.pos) + ", " + c + ", " + l.gp + " GP") + "</span></span>" + S2.chev() + "</button>"; }).join("");
    }
    function pick(pid) {
      var nb = pool.filter(function (l) { return l.pid === pid; })[0]; if (!nb) return;
      B = nb; st.q = ""; S2.$("#pfCmpQ", body).value = ""; list();
      var whoEl = S2.$("#pfCmpWho", body), bEl = S2.$(".pf-cw-b", whoEl), tmp = document.createElement("div");
      tmp.innerHTML = who(B, "b"); bEl.replaceWith(tmp.firstChild);
      if (!reduced()) S2.$(".pf-cw-b", whoEl).animate([{ opacity: 0, transform: "translateX(8px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: EASE });
      S2.$("#pfCmpBn", body).textContent = B.tag;
      S2.$$("[data-pick]", S2.$("#pfCmpS", body)).forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.pick === pid)); });
      /* retarget each bar from where it is now: CSS transitions on transform are interruptible, so a fast second pick never jumps */
      var fresh = document.createElement("div"); fresh.innerHTML = cmpRows(A, B, role);
      S2.$$(".pf-bf", fresh).forEach(function (nr) {
        var cur = S2.$('.pf-bf[data-k="' + nr.dataset.k + '"]', body); if (!cur) return;
        S2.$(".pf-bf-b i", cur).style.transform = S2.$(".pf-bf-b i", nr).style.transform;
        ["pf-bf-va", "pf-bf-vb"].forEach(function (c) { var o = S2.$("." + c, cur), n = S2.$("." + c, nr); o.innerHTML = n.innerHTML; o.className = n.className; });   /* innerHTML keeps the screen-reader name */
      });
      var r = S2.$("#pfCmpR", body);
      if (r) { r.outerHTML = cmpRadar(A, B); r = S2.$("#pfCmpR", body); S2.charts.hydrate(r); S2.settle(r); if (!reduced()) r.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 200, easing: "ease-out" }); }   /* a new pick cross-fades; the radar does not breathe out again */
    }
    var inp = S2.$("#pfCmpQ", body);
    inp.addEventListener("input", function () { st.q = inp.value; list(); });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { var f = S2.$("[data-pick]", S2.$("#pfCmpL", body)); if (f) pick(f.dataset.pick); } });
    body.addEventListener("click", function (e) { var b = e.target.closest("[data-pick]"); if (b) pick(b.dataset.pick); });
    pressFeedback(body);
  }

  var CUR = null;   /* the player on screen, for the delegated handlers */
  S2.page("player", {
    tab: "stats",
    title: function (r) { var p = M.player(arg(r.arg) || M.examples.pointsLeader); return p ? p.tag : "Player"; },
    render: function (r) {
      fresh();
      var p = M.player(arg(r.arg) || M.examples.pointsLeader);
      CUR = p;
      if (!p) return '<div class="pf" id="pfRoot">' + notFound(arg(r.arg)) + "</div>";
      var st = pst(p), role = r.q.role && p.lines[r.q.role] ? r.q.role : p.mainRole;   /* the address is the source of truth for the line on screen */
      if (role !== st.role) { st.role = role; st.sel = null; st.stat = null; st.rpos = null; }
      if (!st.rpos) { var fit = ratingFor(p.id, st.role); st.rpos = fit ? fit.pos : null; }   /* the breakdown opens on the rating of the line on screen */
      /* the member's pickup lines (js/pages/pickups.js, g5): the section reads them itself and fills in place */
      return '<div class="pf" id="pfRoot" data-pid="' + esc(p.id) + '">' + heroP(p) + roleBar(p, st) + '<div id="pfBody">' + bodyP(p, st) + "</div>" + S2.pickups.profileHtml(p.id) + aboutP(p) + "</div>";
    },
    after: function (page) {
      var root = S2.$("#pfRoot", page), p = CUR; if (!root) return;
      pressFeedback(root); fitName(S2.$(".pfx-name", root));
      if (!p) { root.addEventListener("click", function (e) { if (e.target.closest('[data-act="search"]')) S2.palette(); }); return; }
      var st = pst(p);
      var ctx = { onSeg: function (key, v) {
        var L = p.lines[st.role];
        if (key === "role") {
          var fit = ratingFor(p.id, v); st.role = v; st.sel = null; st.stat = null; st.rpos = fit ? fit.pos : null;
          try { history.replaceState(history.state, "", "#/player/" + p.id + (v === p.mainRole ? "" : "?role=" + v)); } catch (e) { /* file:// or a sandbox: the line still switches, it just is not in the address */ }
          swap("pfBody", '<div id="pfBody">' + bodyP(p, st) + "</div>", root, ctx, true, true); return; }
        if (key === "rpos") { st.rpos = v; swap("pfRadarHd", radarCopy(p, st), root, ctx); swap("pfRadarB", radarBody(p, st), root, ctx, true); return; }
        if (key === "stat") { st.stat = v; swap("pfFormHd", formCopy(p, L, st.role, st), root, ctx); swap("pfFormB", formBody(p, L, st.role, st), root, ctx); return; }
        if (key === "view") { st.view = v; swap("pfLogB", logBody(p, st.role, st), root, ctx, true); }
      } };
      wire(root, ctx); grow(root);
      /* the hero again, from the player as the model holds them now (a write's re-read refills S2.M in place); the button
         that was pressed keeps focus */
      var heroAgain = function () {
        var fa = document.activeElement, was = fa && root.contains(fa) && fa.closest("#pfHero") ? fa.dataset.act || fa.dataset.flow : null;
        var h = swap("pfHero", heroP(M.player(p.id) || p), root, ctx); if (h) fitName(S2.$(".pfx-name", h));
        var f = was && S2.$('#pfHero [data-act="' + was + '"], #pfHero [data-flow="' + was + '"]', root); if (f) f.focus({ preventScroll: true });
      };
      root.addEventListener("click", function (e) {
        var a = e.target.closest("[data-act]"); if (!a || !root.contains(a)) return;
        var act = a.dataset.act, now = M.player(p.id) || p;
        if (act === "compare") openCompare(p, st.role);
        else if (act === "block") blockToggle(now, heroAgain);
        else if (act === "board") boardDoor(now, heroAgain);
        /* the one claim door lives with Team HQ's (js/pages/hq.js S2.claimDoor): the role, the club's fit, the first claim */
        else if (act === "claim") { if (S2.claimDoor) S2.claimDoor(p.id); else console.error("[profile] S2.claimDoor is missing: load js/pages/hq.js"); }
        else if (act === "cell") selectCell(+a.dataset.i, false);
        else if (act === "sort") { var s = SORT[a.dataset.tbl], k = a.dataset.k; s.dir = s.k === k && s.dir === "desc" ? "asc" : s.k === k ? "desc" : (k === "at" || k === "opp" ? "asc" : "desc"); s.k = k;
          swap(a.dataset.tbl, table(a.dataset.tbl, logCols(st.role), M.log(p.id, st.role), s, "Game log"), root, ctx); var f = S2.$("#" + a.dataset.tbl + ' [data-k="' + k + '"]'); if (f) f.focus(); }
      });
      function selectCell(i, focus) {
        var log = M.log(p.id, st.role); if (!log[i]) return;
        st.sel = i;
        S2.$$(".pf-hc", root).forEach(function (c) { var on = +c.dataset.i === i; c.setAttribute("aria-pressed", String(on)); c.tabIndex = on ? 0 : -1; if (on && focus) c.focus(); });
        var hd = S2.$("#pfHd", root); if (hd) hd.innerHTML = detailInner(log[i], st.role);
      }
      /* the market's reads (on waivers, in the pool, on the board) repaint the hero in place. Only a player with no roster
         spot can be on waivers or in the pool, so only their page asks for the market (a rostered player's never pays for it) */
      follow(function (e) { if (e.type === "load") heroAgain(); }, root);
      /* the race places: the season sentence's copy, Honors (#pfTail) and the about's race rule, each repainted in place;
         the control that held focus in Honors or the about gets it back */
      raceIn(root, function () { return JSON.stringify((M.player(p.id) || p).honors.filter(function (h) { return h.kind === "title_race"; }).map(function (h) { return [h.category, h.place, h.perGame, h.gp]; })); }, function () {
        var now = M.player(p.id) || p, L = st.role ? now.lines[st.role] : null, fa = document.activeElement;
        if (L) swap("pfSeasonHd", seasonSec(now, L, st.role, true), root, ctx);
        var k = focusKey(S2.$("#pfTail", root));
        focusBack(swap("pfTail", tailSec(now, L ? st.role : null), root, ctx), k);
        var ab = S2.$$(":scope > details.about", root).pop(), open = ab && ab.open, abF = !!ab && ab.contains(fa);
        if (ab) { ab.outerHTML = aboutP(now); ab = S2.$$(":scope > details.about", root).pop(); if (ab) { ab.classList.remove("reveal"); ab.open = !!open; if (abF) S2.$("summary", ab).focus({ preventScroll: true }); } }
      });
      if (!p.rostered && S2.market && S2.market.ensure) S2.market.ensure();
      root.addEventListener("keydown", function (e) {   /* roving focus across the heat strip: one tab stop, arrows walk the games */
        var c = e.target.closest(".pf-hc"); if (!c) return;
        var n = S2.$$(".pf-hc", root).length, i = +c.dataset.i;
        if (e.key === "ArrowRight") { selectCell(Math.min(n - 1, i + 1), true); e.preventDefault(); }
        else if (e.key === "ArrowLeft") { selectCell(Math.max(0, i - 1), true); e.preventDefault(); }
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {   /* weeks are rows: up and down keep the column, clamped to a shorter week */
          var row = c.closest(".pf-hrow"), to = e.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
          if (to) { var cells = S2.$$(".pf-hc", to); selectCell(+cells[Math.min(S2.$$(".pf-hc", row).indexOf(c), cells.length - 1)].dataset.i, true); }
          e.preventDefault(); }
        else if (e.key === "Home") { selectCell(0, true); e.preventDefault(); } else if (e.key === "End") { selectCell(n - 1, true); e.preventDefault(); }
      });
    }
  });

  /* =====================================================================================================================
     CLUB
     ===================================================================================================================== */
  var CLUB = {};   /* dropped by fresh() whenever the league was read again */
  /* everything the club page sums from the model, once per club: results in order, club lines from box scores, moves, records */
  function clubData(code) {
    if (CLUB[code]) return CLUB[code];
    var games = M.games.filter(function (g) { return g.home === code || g.away === code; });
    var finals = games.filter(function (g) { return g.isFinal && g.stage === "regular" && g.hs != null; });
    var res = finals.map(function (g) {
      var home = g.home === code, gf = home ? g.hs : g.as, ga = home ? g.as : g.hs, opp = home ? g.away : g.home;
      return { g: g, opp: opp, home: home, gf: gf, ga: ga, r: g.winner === code ? "W" : g.decision === "ot" ? "OTL" : "L", ff: g.forfeit };   /* M.log's result rule */
    });
    /* club lines (the v4.13 club split): every line in this club's box scores, players who have left included */
    var lines = {}, unlinked = 0;
    finals.forEach(function (g) {
      if (!g.hasBox) return;
      (M.game(g.id).box[code] || []).forEach(function (o) {
        if (!o.pid) { unlinked++; return; }
        var k = o.pid + "|" + o.role, L = lines[k] || (lines[k] = { pid: o.pid, tag: o.tag, href: o.href, role: o.role, seen: {}, gp: 0, g: 0, a: 0, p: 0, pm: 0, sog: 0, hits: 0, tk: 0, sv: 0, sa: 0, ga: 0, so: 0, dsv: 0, sop: 0, psv: 0, psa: 0, pos: {} });
        if (!L.seen[g.id]) { L.seen[g.id] = 1; L.gp++; }
        ["g", "a", "p", "pm", "sog", "hits", "tk", "sv", "sa", "ga", "dsv", "sop", "psv", "psa"].forEach(function (s) { L[s] += num(o[s]); });
        if (o.so) L.so++;
        L.pos[o.pos] = (L.pos[o.pos] || 0) + 1;
      });
    });
    var lineList = Object.keys(lines).map(function (k) {
      var L = lines[k], p = M.player(L.pid);
      L.posTop = Object.keys(L.pos).sort(function (a, b) { return L.pos[b] - L.pos[a]; })[0];
      L.ppg = L.gp ? L.p / L.gp : null; L.svp = L.sa ? L.sv / L.sa : null; L.gaa = L.gp ? L.ga / L.gp : null;
      L.now = p && p.rostered ? (p.club === code ? null : p.club) : "former";
      return L;
    });
    /* moves: one arrival per tenure start, one departure per tenure end */
    var moves = [];
    M.players.forEach(function (p) { p.tenures.forEach(function (t) {
      if (t.club !== code) return;
      moves.push({ at: t.from, kind: "in", how: t.how_in, p: p, pos: t.pos });
      if (t.to) moves.push({ at: t.to, kind: "out", how: t.how_out, p: p, pos: t.pos });
    }); });
    moves.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)) || (a.kind === b.kind ? 0 : a.kind === "out" ? -1 : 1); });
    /* records: streaks count forfeits (they decide W/L); biggest win and most goals skip forfeits, whose score is administrative */
    var best = null, most = null, run = { r: null, n: 0, from: null }, longW = { n: 0 }, longL = { n: 0 }, cur = null;
    res.forEach(function (x) {
      if (!x.ff && x.r === "W" && (!best || x.gf - x.ga > best.gf - best.ga)) best = x;
      if (!x.ff && (!most || x.gf > most.gf)) most = x;
      var won = x.r === "W";
      if (run.r === won) run.n++; else run = { r: won, n: 1, from: x };
      if (won && run.n > longW.n) longW = { n: run.n, from: run.from, to: x };
      if (!won && run.n > longL.n) longL = { n: run.n, from: run.from, to: x };
    });
    if (res.length) { var lastWon = res[res.length - 1].r === "W"; cur = { won: lastWon, n: 0 }; for (var i = res.length - 1; i >= 0 && (res[i].r === "W") === lastWon; i--) cur.n++; }
    return (CLUB[code] = { games: games, finals: finals, res: res, lines: lineList, unlinked: unlinked, moves: moves, best: best, most: most, longW: longW, longL: longL, cur: cur,
      firstWin: res.filter(function (x) { return x.r === "W"; })[0] || null });
  }
  /* a club's place on a measure, best first: clubs level at the precision shown (one decimal) share it, as M.rank's players
     do, so two clubs on a 25.0% power play are each "tied for 3rd" (the first cut gave them 3rd and 4th) */
  /* QA round 2 (2026-11-25): a club with no value (a power play or penalty kill percentage before its first chance is
     null) is not ranked, and is not a 0% in anyone's rank or the average: the pool is the clubs with a value, n of them,
     and a club with none gets null. leagueAvg is null while no club has one */
  function rankIn(code, k) {
    var L = league().filter(function (r) { return r[k] != null; }), key = function (r) { return Math.round(num(r[k]) * 10); }, me = standRow(code);
    if (!me || me[k] == null) return null;
    var mine = key(me);
    return { rank: 1 + L.filter(function (r) { return key(r) > mine; }).length, tied: L.filter(function (r) { return key(r) === mine; }).length, n: L.length };
  }
  function leagueAvg(k) { var L = league().filter(function (r) { return r[k] != null; }); return L.length ? L.reduce(function (a, r) { return a + num(r[k]); }, 0) / L.length : null; }   /* plain mean of the clubs with one */
  function ppCounts(code, d) {   /* power-play goals and chances, summed from each final's "goals/chances" strings */
    var o = { g: 0, n: 0, ag: 0, an: 0, unknown: 0 };
    d.res.forEach(function (x) {
      var mine = x.home ? x.g.home_pp : x.g.away_pp, theirs = x.home ? x.g.away_pp : x.g.home_pp;
      if (!mine || !theirs) { o.unknown++; return; }
      var a = mine.split("/"), b = theirs.split("/"); o.g += num(+a[0]); o.n += num(+a[1]); o.ag += num(+b[0]); o.an += num(+b[1]);
    });
    return o;
  }
  var MARK = { z: "Clinched the division", x: "Clinched a playoff spot", e: "Eliminated" };
  /* how a closed season ended for a club (M.seasonClose), one wording for the hero and the By season row */
  function seasonOut(fin, t) { return { cup: "won the Stanley Cup", final: "lost the final", division: "lost the " + t.division + " Division championship", first: "lost in the opening round", none: "missed the playoffs" }[fin.out]; }
  /* a club's finish in a closed season, the season the page tells by default (toldN); null while that season is open */
  function finOf(code, n) { return ((M.seasonClose(n == null ? toldN() : n) || {}).table || []).filter(function (r) { return r.club === code; })[0] || null; }

  function heroC(t, row) {
    /* Team HQ opens the club the viewer acts for (acting(): the seat's own club), so a front office sees the link only on
       that club's page (v2 review: on Vancouver it opened Detroit). A commissioner may run any club's Team HQ, so theirs
       shows on every club and switches the acting club first (data-hq, S2.market.setClub) */
    var hq = S2.has("office") && (acting() === t.code || S2.has("commish"));
    var lede = "", fin = finOf(t.code);
    /* a closed season is told as it finished (review 2026-11-23: "Stanley Cup champions" sat over "18 games left") */
    /* before the season on screen's first final every club is level at zero, so the race is not told yet: no "holds a
       playoff spot, with 0 points" and no division rank drawn from tiebreakers, as Today hides its race until then
       (raceSection; review 2026-11-24). The hero says when the club's first game is, if one is scheduled */
    var level = !fin && row && !M.view.finals;
    if (fin) lede = t.city + " finished " + S2.seasonName(toldN()) + " " + fin.w + "-" + fin.l + "-" + fin.otl + " with " + plural(fin.pts, "point") + ", " + ord(fin.divRank) + " in the " + t.division + ", and " + seasonOut(fin, t) + ".";
    else if (level) {
      var ahead = M.games.filter(function (g) { return g.home === t.code || g.away === t.code; }).sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); }), g1 = ahead[0];
      if (g1) lede = t.city + " opens " + M.view.name + " " + M.etLong(g1.at) + (g1.home === t.code ? " at home to " + tcity(g1.away) : " at " + tcity(g1.home)) + (ahead.length > 1 ? ", the first of " + plural(ahead.length, "game") + " on its schedule." : ".");
    } else if (row) {
      var ends = seasonDay(M.view.season, "ends_at");
      var status = row.mark === "z" ? t.city + " has clinched the " + t.division + "," : row.mark === "x" ? t.city + " has clinched a playoff spot," : row.mark === "e" ? t.city + " has been eliminated," :
        (row.inPlayoffs ? t.city + " holds a playoff spot" : t.city + " is outside the playoff spots") + (row.magic ? ", magic number " + row.magic + "," : ",");
      lede = status + " with " + plural(row.pts, "point") + (row.games_left ? " and " + plural(row.games_left, "game") + " left" + (ends ? " before the season ends " + ends : "") : "") + ".";
    }
    var won = M.trophies(toldN()).filter(function (x) { return x.team && x.club === t.code; })[0];   /* team trophies come in honor order */
    var flag = (won ? '<span class="pfx-flag honor">' + S2.ic("trophy") + "<span>" + esc(won.key === "stanley_cup" ? "Stanley Cup champions" : won.short) + "</span></span>" : "") +
      (!fin && row && row.mark ? '<span class="pfx-flag">' + esc(row.mark === "e" ? "Eliminated" : "Clinched") + "</span>" : "");
    var nums = fin ? [["Record", fin.w + "-" + fin.l + "-" + fin.otl, null], [t.division, ord(fin.divRank), null], ["Points", S2.fmt(fin.pts), fin.pts], ["Goal difference", signed(fin.gf - fin.ga), null]]
      : row && !level ? [["Record", row.w + "-" + row.l + "-" + row.otl, null], [t.division, ord(row.rank), null], ["Points", S2.fmt(row.pts), row.pts], ["Goal difference", signed(row.diff), null]] : [];
    return '<header class="band club hero pfx-hero pfc-hero reveal" id="pfcHero" style="' + S2.clubBand(t) + '">' + crumb([["#/clubs", "Clubs"]], t.full) +
      '<div class="pfc-hero-g">' + plate(t.code, "lg") +
        '<div class="pfc-hero-id"><span class="kicker">' + esc(t.division) + " Division" + (t.founded ? ", since Season " + esc(t.founded) : "") + "</span>" + (flag ? '<div class="pfx-flags">' + flag + "</div>" : "") +
          '<h1 class="d-hero pfc-name"><span>' + esc(t.city) + "</span> <span>" + esc(t.name) + "</span></h1>" + (lede ? '<p class="pfx-lede">' + esc(lede) + "</p>" : "") +
          (hq ? '<a class="btn site pfx-btn pf-press" href="#/hq" data-hq="' + esc(t.code) + '">' + S2.ic("wrench") + "Open Team HQ</a>" : "") + "</div></div>" +
      (nums.length ? '<dl class="pfc-nums">' + nums.map(function (n) { return "<div><dt>" + esc(n[0]) + '</dt><dd class="d-num"' + (n[2] != null ? ' data-count="' + n[2] + '"' : "") + ">" + esc(n[1]) + "</dd></div>"; }).join("") + "</dl>" : "") + "</header>";
  }
  /* the season so far: the running goal difference, with every result under it */
  function seasonC(t, row, d) {
    /* QA visual 6 (2026-11-25): an empty section is its kicker and the ONE empty box (S2.empty), as the public pages draw
       "nothing yet", not a display headline saying "No games yet." */
    if (!d.res.length) return sec("pfcSzH", '<h2 class="kicker pfx-empty-k" id="pfcSzH">' + esc(M.view.name) + "</h2>" + S2.empty("none", "No " + M.view.name + " games yet", "Results appear here after the first final."), "tint");
    var l5 = row ? row.last5 : [], w5 = l5.filter(function (r) { return r === "W"; }).length, gdR = row ? rankIn(t.code, "diff") : null, n = d.res.length;
    var h = gdR && gdR.rank === 1 ? signed(row.diff) + " goal difference, " + (gdR.tied > 1 ? "tied for the best" : "best") + " in the league." : d.cur && d.cur.won && d.cur.n >= 3 ? cap(word(d.cur.n)) + " straight wins." :
      cap(word(w5)) + (w5 === 1 ? " win" : " wins") + " in the last " + word(l5.length || 5) + ".";
    var sent = row ? t.city + " is " + row.w + "-" + row.l + "-" + row.otl + " with a " + signed(row.diff) + " goal difference" +
      (d.longW.n >= 3 ? "; its longest win streak is " + d.longW.n + ", " + M.etMonthDay(d.longW.from.g.at) + " to " + M.etMonthDay(d.longW.to.g.at) : "") + ". Drag across the line to read each game." : "";
    var run = 0, vals = d.res.map(function (x) { run += x.gf - x.ga; return run; }), lo = Math.min.apply(null, vals.concat([0]));
    var chart = n >= 2 ? lineChart({ w: chartW(), h: window.innerWidth < 700 ? 200 : 280, labels: d.res.map(function (x, i) { return "Game " + (i + 1); }),
        series: [{ name: "Goal difference", values: vals }].concat(lo < 0 ? [{ name: "Even", values: vals.map(function () { return 0; }), dashed: true, color: "var(--muted)" }] : []), area: lo >= 0, min: lo < 0 ? Math.floor(lo / 10) * 10 : 0,
        ticks: window.innerWidth < 700 ? 3 : 7, label: t.full + " running goal difference over " + n + " games", hint: "Drag or use the arrow keys to read a game." },
        d.res.map(function (x) { return M.etMonthDay(x.g.at) + " · " + (x.home ? "vs " : "at ") + x.opp + ", " + x.r + " " + x.gf + "-" + x.ga; })) : "";
    var cnt = { W: 0, L: 0, OTL: 0 }; d.res.forEach(function (x) { cnt[x.r]++; });
    /* the strip is one picture with a summary, not 36 links 11px wide (v2 review); every game is a row under Games */
    var sum = plural(n, "result") + ": " + plural(cnt.W, "win") + ", " + plural(cnt.L, "loss", "losses") + ", " + plural(cnt.OTL, "overtime loss", "overtime losses") + ". Last " + Math.min(5, n) + ", oldest first: " +
      d.res.slice(-5).map(function (x) { return RES_WORD[x.r].toLowerCase(); }).join(", ") + ".";
    var cells = d.res.map(function (x, i) { return '<span class="pfc-r ' + x.r.toLowerCase() + (i >= n - 5 ? " last" : "") + '"></span>'; }).join("");
    return sec("pfcSzH", head({ kicker: M.view.name + THRU_T, id: "pfcSzH", h: h, p: esc(sent), side: arrowBtn("all-results", "All results") }) + '<div class="pfc-gd">' + chart + "</div>" +
      '<div class="pfc-strip" role="img" aria-label="' + esc(sum) + '">' + cells + "</div>" +
      '<div class="pf-heat-key"><span><i class="pf-hc-r w"></i>Win</span><span><i class="pf-hc-r l"></i>Loss</span><span><i class="pf-hc-r otl"></i>Overtime loss</span><span>Outlined: the last five</span></div>', "tint");
  }

  /* ---- tabs ---- */
  var TABS = [["roster", "Roster"], ["stats", "Stats"], ["games", "Games"], ["moves", "Moves"], ["history", "History"]];
  var CST = {};
  function cst(code) { return CST[code] || (CST[code] = { tab: "roster", stats: "S", games: "results", moves: "all" }); }

  function rosterPanel(t) {
    var R = M.roster(t.code); if (!R || !R.all.length) return sec("pfcRosH", '<h2 class="kicker pfx-empty-k" id="pfcRosH">Roster</h2>' + S2.empty("none", "No roster yet", "Nobody is on this club's roster right now."));
    /* Season 2 figures from the one definition, S2.market.clubState: a 12-player active roster (v4.52) with the S2.4 minimums (3 F, 2 D and
       1 G) and cap room = the Season 2 cap less the active roster (the lead's reading 9). The Season 1 group limits
       (7 F, 5 D, 3 G) read legal Season 2 claims and signings as violations (review 2026-11-02: "8 of 7 forwards"), and
       the camp-inclusive payroll gave Detroit a third cap-room number */
    /* v5.00 swap (e7, 2026-11-24): the roster is the season on screen's, told by that season's own rules (viewRules):
       Season 2's twelve against its minimums, or at ?season=1 Season 1's group limits with its training camp (review
       2026-11-24: a live ?season=1 club said its camp stood in for the pool "in this preview") */
    var ru = viewRules(), byGroup = !!ru.composition;
    /* shortcut: the model still trims a Season 1 club to the twelve (M.s2Standins marks the rest squad "tc"), so a
       stand-in counts here as the active player it is; drop the s2Standin test once model.js drops s2Standins (i3) */
    var inCamp = function (p) { return p.squad === "tc" && !p.s2Standin; };
    var activeP = R.all.filter(function (p) { return !inCamp(p); }), campP = R.all.filter(inCamp), camp = campP.length, nm = M.view.name;
    var cs = !byGroup && S2.market && S2.market.clubState(t.code), s2 = M.RULES.s2, ac, mins = cs ? cs.mins : s2.min, limit = cs ? cs.limit : s2.limit, capAmt, payroll;
    if (byGroup) {   /* Season 1's shape: group maximums, an unlimited camp whose salaries counted toward the cap */
      ac = activeP.reduce(function (a, p) { if (p.unit) a[p.unit]++; a.total++; return a; }, { F: 0, D: 0, G: 0, total: 0 });
      capAmt = ru.cap; payroll = R.payroll.total;
    } else { ac = cs ? cs.active : R.counts.active; capAmt = cs ? cs.cap : s2.cap; payroll = cs ? cs.payroll : R.payroll.active; }
    var room = capAmt - payroll, used = Math.min(1, payroll / Math.max(1, capAmt || 1)), lim = ru.composition;
    var h = plural(ac.total, "player") + " on the active roster.";
    var sent = byGroup
      ? ac.total + " of " + lim.total + " active spots are filled: " + plural(ac.F, "forward") + ", " + ac.D + " defense and " + plural(ac.G, "goaltender") + ", against " + nm + " limits of " + lim.F + ", " + lim.D + " and " + lim.G + " per " + ru.source + "." +
        (camp ? " " + cap(word(camp)) + " more " + (camp === 1 ? "is" : "are") + " in training camp, which had no limit." : "") +
        " Payroll is " + M.money(payroll) + " of the " + M.money(capAmt) + " cap, camp salaries included, leaving " + M.money(room) + "."
      : ac.total + " of " + limit + " active spots are filled: " + plural(ac.F, "forward") + ", " + ac.D + " defense and " + plural(ac.G, "goaltender") + ", against " + nm + " minimums of " + mins.F + ", " + mins.D + " and " + mins.G + " (Rule S2.4)." +
        " Payroll is " + M.money(payroll) + " of the " + M.money(capAmt) + " cap, leaving " + M.money(room) + " (" + nm + " cap room: " + M.money(capAmt) + " less the active roster).";
    var pay = '<div class="pfc-pay"><div class="pf-pb-h"><span class="pf-pb-l">' + esc(nm) + ' payroll</span><span class="pf-pb-v"><b class="num">' + esc(M.money(payroll)) + '</b><span class="pf-pb-p">of ' + esc(M.money(capAmt)) + "</span></span></div>" +
      '<div class="pf-pb-t" role="img" aria-label="Payroll ' + esc(M.money(payroll)) + " of a " + esc(M.money(capAmt)) + ' cap"><i data-grow style="transform:scaleX(' + used.toFixed(3) + ')"></i></div>' +
      '<span class="pf-pb-n">' + esc(M.money(payroll)) + (byGroup ? " active roster and camp, " : " active roster, ") + esc(M.money(room)) + " of room</span></div>";
    var seats = '<dl class="spec pfc-seats">' + ["Owner", "GM", "AGM"].map(function (s) { var p = R.seats[s];
      return "<div><dt>" + SEAT[s] + "</dt><dd>" + (p ? '<a href="' + p.href + '">' + esc(p.tag) + "</a>" : "Open") + "</dd></div>"; }).join("") + "</dl>";
    /* the lineup in rink order: forwards across the first row (LW C RW), then defense and goaltenders (LD RD G). Only the
       active roster sits in the columns, so their counts add up to the headline; a Season 1 club's training camp is its
       own group under them (audit 2026-11-09: Vancouver's headline said 14 while the columns added up to 19) */
    function plLi(p) {
      var tags = [p.seat ? SEAT[p.seat] : null, p.onBlock ? "On the block" : null].filter(Boolean);
      var sub = [salaryText(p.salary), p.lines.S || p.lines.G ? plural(p.gp, "game") : "no games yet"].filter(Boolean).join(", ");
      return '<li><a class="pfc-pl pf-press" href="' + p.href + '"><span class="pfc-pl-no d-num" aria-label="Number ' + esc(p.num == null ? "none" : p.num) + '">' + esc(p.num == null ? "–" : p.num) + "</span>" +
        '<span class="pfc-pl-id"><b>' + esc(p.tag) + "</b><span>" + esc(sub) + "</span>" + (tags.length ? '<span class="pfc-tags">' + tags.map(function (x) { return "<i>" + esc(x) + "</i>"; }).join("") + "</span>" : "") + "</span>" +
        '<span class="pfc-pl-r d-num' + (p.ovr && p.ovr.provisional ? " prov" : "") + '" title="' + (p.ovr ? "CGHL rating " + p.ovr.ovr + (p.ovr.provisional ? ", provisional" : "") : "Not rated") + '">' +
          '<span class="sr">Rating </span>' + (p.ovr ? p.ovr.ovr + (p.ovr.provisional ? '<span class="sr">, provisional</span>' : "") : "–") + "</span></a></li>";
    }
    var cols = M.POS.map(function (pos) {
      var list = activeP.filter(function (p) { return p.pos === pos; });
      return '<section class="pfc-col" aria-labelledby="pfcP' + pos + '"><h3 class="pfc-col-h" id="pfcP' + pos + '"><span>' + esc(M.posName(pos)) + '</span><span class="num">' + list.length + "</span></h3>" +
        (list.length ? '<ul class="pfc-pls">' + list.map(plLi).join("") + "</ul>" : '<p class="pfc-none">Nobody at ' + esc(M.posName(pos).toLowerCase()) + ".</p>") + "</section>";
    }).join("");
    var campSec = campP.length ? '<section class="pfc-col pfc-camp" aria-labelledby="pfcPcamp"><h3 class="pfc-col-h" id="pfcPcamp"><span>Training camp</span><span class="num">' + campP.length + "</span></h3>" +
      '<ul class="pfc-pls">' + campP.map(plLi).join("") + "</ul></section>" : "";
    return sec("pfcRosH", head({ kicker: "Roster", id: "pfcRosH", h: h, p: esc(sent) }) + '<div class="pfc-ros-top">' + seats + pay + "</div>" +
      '<div class="pfc-depth">' + cols + "</div>" + campSec);
  }
  function statsCols(role) {
    var w = { k: "tag", label: "Player", sortVal: function (r) { return String(r.tag).toLowerCase(); },
      cell: function (r) { return '<a href="' + r.href + '">' + esc(r.tag) + "</a>" + (r.now === "former" ? ' <span class="chip">Former</span>' : r.now ? ' <span class="chip">Now ' + esc(r.now) + "</span>" : ""); } };
    if (role === "G") return [w, { k: "gp", label: "GP", title: "Games played" }, { k: "sv", label: "SV", title: "Saves" }, { k: "sa", label: "SA", title: "Shots against" },
      { k: "svp", label: "SV%", title: "Save percentage", cell: function (r) { return r.svp == null ? "–" : M.display("sv_pct", r.svp); } },
      { k: "ga", label: "GA", title: "Goals against" }, { k: "gaa", label: "GA/GP", title: "Goals against per game", cell: function (r) { return S2.fmt(r.gaa, 2); } }, { k: "so", label: "SO", title: "Shutouts" },
      { k: "dsv", label: "DS", title: "Desperation saves" }, { k: "sop", label: "SOP", title: "Shutout periods" },
      { k: "psa", label: "PS", title: "Penalty shots stopped", sortVal: function (r) { return r.psa ? r.psv / r.psa : null; }, cell: function (r) { return r.psa ? r.psv + "/" + r.psa : "–"; } }];
    return [w, { k: "posTop", label: "Pos", title: "Most played position", cell: function (r) { return esc(r.posTop || "–"); } }, { k: "gp", label: "GP", title: "Games played" },
      { k: "g", label: "G", title: "Goals" }, { k: "a", label: "A", title: "Assists" }, { k: "p", label: "P", title: "Points" },
      { k: "pm", label: "+/-", title: "Plus/minus", cell: function (r) { return signed(r.pm); } }, { k: "sog", label: "SOG", title: "Shots on goal" }, { k: "hits", label: "HIT", title: "Hits" },
      { k: "ppg", label: "P/GP", title: "Points per game", cell: function (r) { return S2.fmt(r.ppg, 2); } }];
  }
  function statsRows(t, s) { return clubData(t.code).lines.filter(function (l) { return l.role === s.stats; }); }
  function statsCopy(t, s) {
    var rows = statsRows(t, s), top = rows.slice().sort(function (a, b) { return s.stats === "G" ? b.gp - a.gp : b.p - a.p; })[0];
    var h = !top ? "No " + (s.stats === "G" ? "goaltender" : "skater") + " lines yet." : s.stats === "G" ? top.tag + " has played " + plural(top.gp, "game") + " in goal." : top.tag + " leads " + t.city + " with " + plural(top.p, "point") + ".";
    return headCopy({ copyId: "pfcStHd", kicker: "Club lines", id: "pfcStH", h: h, p: "Every line in " + esc(t.city) + "'s box scores, players who have left included, counting only games played for " + esc(t.code) + ". Select a heading to sort." });
  }
  function statsBody(t, s) {
    var rows = statsRows(t, s);
    return '<div id="pfcStatsB">' + (rows.length ? table("pfcT" + s.stats, statsCols(s.stats), rows, s.stats === "G" ? { k: "gp", dir: "desc" } : { k: "p", dir: "desc" }, t.full + (s.stats === "G" ? " goaltenders" : " skaters")) : "") + "</div>";
  }
  /* one special-teams meter. QA round 2 (2026-11-25): a club with no chance of this kind yet (v and rank null) reads none
     ("No power plays yet"), with no rank and an empty bar; while no club has had one (avg null) there is no league average
     and no tick. Before, it read "–%, tied for 1st of 8" over a league average that counted the clubs with none as 0%.
     QA round 2 review: the note under a meter with none says only the league average (the value above already says none,
     and so does the lede), and every note ends in a period, so the two meters read alike */
  function meter(label, v, avg, rank, note, none) {
    var has = v != null && rank, said = has ? S2.fmt(v, 1) + " percent" : none, avgSaid = avg == null ? "" : ", league average " + S2.fmt(avg, 1) + " percent";
    var foot = [avg == null ? "" : "League average " + S2.fmt(avg, 1) + "% (the tick)", has ? note : ""].filter(Boolean).join(". ");
    return '<div class="pfc-meter"><div class="pf-pb-h"><span class="pf-pb-l">' + esc(label) + '</span><span class="pf-pb-v">' +
        (has ? '<b class="d-num">' + S2.fmt(v, 1) + '%</b><span class="pf-pb-p">' + cap(place(rank)) + " of " + rank.n + "</span>" : '<span class="pf-pb-p">' + esc(none) + "</span>") + "</span></div>" +
      '<div class="pf-pb-t" role="img" aria-label="' + esc(label + " " + said + avgSaid) + '">' + (has ? '<i data-grow style="transform:scaleX(' + Math.max(0, Math.min(1, v / 100)).toFixed(3) + ')"></i>' : "") +
        (avg == null ? "" : '<span class="pf-pb-m" style="left:' + Math.max(0, Math.min(100, avg)).toFixed(1) + '%"></span>') + "</div>" +
      (foot ? '<span class="pf-pb-n">' + esc(foot) + ".</span>" : "") + "</div>";
  }
  /* the club as a whole, in the player page's ranked bars (pbar). Commissioner, 2026-11-04: "Team: Time on Attack, passing
     percentage, hits, blocks, takeaways, giveaways, interceptions, PIM, face off percentage." */
  var CLUB_GROUPS = [["Puck control", ["toa_pg", "pass_pct", "fo_pct"]], ["Physical and defense", ["hits_pg", "blk_pg", "tk_pg", "int_pg"]], ["Giveaways and penalties", ["gv_pg", "pim_pg"]]];
  function clubStatsSec(t) {
    var a = M.clubStats(t.code); if (!a || !a.bx) return "";
    var groups = CLUB_GROUPS.map(function (g) { return [g[0], g[1].map(function (k) { return M.clubRank(t.code, k); }).filter(Boolean)]; });
    var top = [].concat.apply([], groups.map(function (g) { return g[1]; })).filter(function (x) { return !NOT_ALONE[x.stat]; }).sort(function (x, y) { return x.rank - y.rank || y.score - x.score; })[0];
    var val = top ? top.display + (top.stat === "pass_pct" || top.stat === "fo_pct" ? "" : " a game") : "", what = top ? top.label.toLowerCase() : "";
    var h = !top ? "Club stats." : top.rank === 1 && top.tied === 1 ? t.city + " leads the league in " + what + ", " + val + "." : cap(top.text) + " in " + what + ", " + val + ".";
    var cols = groups.map(function (g) { return g[1].length ? '<div class="pf-pgroup"><h3 class="pfx-sub">' + esc(g[0]) + "</h3>" + g[1].map(pbar).join("") + "</div>" : ""; }).join("");
    return sec("pfcTsH", head({ kicker: "Club stats", id: "pfcTsH", h: h, p: "Per game among the " + league().length + " clubs, counting the " + plural(a.bx, "game") + " with a box score. A full bar is first, and the tick is the middle of the pack." }) +
      '<div class="pf-pgrid">' + cols + "</div>", "tint");
  }
  function statsPanel(t, s) {
    var d = clubData(t.code), row = standRow(t.code), ns = d.lines.filter(function (l) { return l.role === "S"; }).length, ng = d.lines.length - ns;
    var lines = sec("pfcStH", '<header class="sec-head pfx-head">' + statsCopy(t, s) + tabs("stats", [["S", 'Skaters <span class="num">' + ns + "</span>"], ["G", 'Goaltenders <span class="num">' + ng + "</span>"]], s.stats, "Skaters or goaltenders", "sm") + "</header>" + statsBody(t, s));
    var ts = clubStatsSec(t);
    /* QA visual 12 (2026-11-25): no rank on no data. Before a club's first power play or penalty kill the section said
       "Power play –%, tied for 1st of 8", so it waits for the first game that has either */
    var c = ppCounts(t.code, d);
    if (!row || (c.n === 0 && c.an === 0)) return lines + ts;
    var ppR = rankIn(t.code, "pp_pct"), pkR = rankIn(t.code, "pk_pct");
    if (!ppR && !pkR) return lines + ts;   /* the table's percentages are the ranked ones: neither, then nothing to rank */
    /* the headline leads with the power play, or with the penalty kill while the club has had no power play */
    var ppS = ppR ? plural(c.g, "goal") + " on " + plural(c.n, "power play", "power plays") : "No power plays yet",
      pkS = pkR ? "the penalty kill stopped " + (c.an - c.ag) + " of " + c.an + " (" + place(pkR) + " in the league)" : "no penalty kills yet";
    var st = sec("pfcSpH", head({ kicker: "Special teams", id: "pfcSpH",
        h: ppR ? "Power play " + S2.fmt(row.pp_pct, 1) + "%, " + place(ppR) + " of " + ppR.n + "." : "Penalty kill " + S2.fmt(row.pk_pct, 1) + "%, " + place(pkR) + " of " + pkR.n + ".",
        p: ppS + "; " + pkS + "." }) +
      '<div class="pfc-meters">' + meter("Power play", row.pp_pct, leagueAvg("pp_pct"), ppR, plural(c.g, "goal") + " on " + plural(c.n, "chance"), "No power plays yet") +
      meter("Penalty kill", row.pk_pct, leagueAvg("pk_pct"), pkR, plural(c.an - c.ag, "kill") + " in " + plural(c.an, "time") + " shorthanded", "No penalty kills yet") + "</div>");
    return lines + ts + st;
  }
  /* the next game as the ink match-center band (Juventus): a date block, both crests, the time, one outline button. It sits
     under the hero on every club view, not inside the Games tab (v3 review: the first thing a fan wants was one click away) */
  function nextBand(t, g) {
    if (!g) return "";
    var home = g.home === t.code, md = M.etMonthDay(g.at).split(" ");
    var side = function (code) { var tm = M.team(code); return '<div class="pfc-mc-side">' + plate(code, "md") + '<span class="d-1">' + esc(code) + '</span><span class="pfc-mc-n">' + esc(tm ? tm.name : code) + "</span></div>"; };
    return sec("pfcNxH", '<div class="pfc-mc"><div class="pfc-mc-date"><span class="d-num">' + esc(md[1] || "") + '</span><span class="pfc-mc-m">' + esc(md[0] || "") + "</span><span>" + esc(g.date.split(",")[0]) + "</span></div>" +
      '<div class="pfc-mc-main"><span class="kicker" id="pfcNxH">Next game, Week ' + esc(g.week) + (g.makeup ? ", make-up" : "") + "</span>" +
        '<div class="pfc-mc-teams">' + side(g.away) + '<span class="pfc-mc-at">at</span>' + side(g.home) + "</div>" +
        '<p class="pfc-mc-t">' + esc(M.etLong(g.at)) + ", " + esc(g.time) + " ET. " + (home ? "At home." : "On the road.") + "</p></div>" +
      '<a class="btn site outline pf-press pfc-mc-go" href="' + g.href + '">Game Center</a></div>', "ink", "pfc-mc-band");
  }
  function gamesData(t) { var d = clubData(t.code); return { d: d, up: d.games.filter(function (g) { return g.state === "upcoming"; }).sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); }) }; }
  function gamesCopy(t, s) {
    var x = gamesData(t), d = x.d, w = d.res.filter(function (r) { return r.r === "W"; }).length, nx = x.up[0];
    var h = s.games === "upcoming" ? (x.up.length ? plural(x.up.length, "game") + " left." : "Nothing left to play.") : plural(w, "win") + " in " + plural(d.res.length, "game") + ".";
    var p = s.games === "upcoming" ? (nx ? "Next: " + ((nx.home === t.code ? "vs " : "at ") + ((M.team(nx.home === t.code ? nx.away : nx.home) || {}).full || "")) + ", " + nx.date + " at " + nx.time + " ET. All times are league time." : "The regular season schedule for this club is complete.")
      : "Every result, newest first. Forfeits count the way the standings count them.";
    return headCopy({ copyId: "pfcGaHd", kicker: "Games", id: "pfcGaH", h: h, p: esc(p) });
  }
  function gamesBody(t, s) {
    var x = gamesData(t), d = x.d, list = s.games === "upcoming" ? x.up : d.res.slice().reverse();
    var byWeek = {}, order = [];
    list.forEach(function (o) { var g = o.g || o, w = g.week; if (!byWeek[w]) { byWeek[w] = []; order.push(w); } byWeek[w].push(o); });
    var body = list.length ? order.map(function (w) {
      return '<section class="pfc-wk"><h3 class="pfx-sub">Week ' + esc(w) + '</h3><ul class="pfx-rows">' + byWeek[w].map(function (o) {
        var g = o.g || o, home = g.home === t.code, opp = home ? g.away : g.home;
        var right = o.g ? '<span class="pfc-score"><i class="pfx-res ' + o.r.toLowerCase() + '">' + (o.r === "OTL" ? "OTL" : o.r) + '</i><b class="d-num">' + o.gf + "-" + o.ga + "</b></span>" : '<span class="pfc-time num">' + esc(g.time) + "</span>";
        var sub = (home ? "Home" : "Away") + (g.makeup ? ", make-up game" : "") + (o.g && o.ff ? ", forfeit" : "") + (o.g && o.g.decision === "ot" ? ", overtime" : "");
        return '<li><a class="pfc-game pf-press" href="' + g.href + '"><span class="pfc-date"><b>' + esc(M.etMonthDay(g.at)) + "</b><span>" + esc(g.date.split(",")[0]) + "</span></span>" + M.crest(opp) +
          '<span class="grow"><b>' + (home ? "vs " : "at ") + esc((M.team(opp) || {}).full || opp) + "</b><span>" + esc(sub) + "</span></span>" + right + S2.chev() + "</a></li>";
      }).join("") + "</ul></section>";
    }).join("") : empty(s.games === "upcoming" ? "Nothing scheduled" : "No results yet", s.games === "upcoming" ? "The regular season schedule for this club is complete." : "Results appear after the first final.");
    return '<div id="pfcGamesB">' + body + "</div>";
  }
  function gamesPanel(t, s) {
    var x = gamesData(t);
    return sec("pfcGaH", '<header class="sec-head pfx-head">' + gamesCopy(t, s) +
      tabs("games", [["results", 'Results <span class="num">' + x.d.res.length + "</span>"], ["upcoming", 'Upcoming <span class="num">' + x.up.length + "</span>"]], s.games, "Results or upcoming", "sm") + "</header>" + gamesBody(t, s));
  }
  function movesBody(t, s) {
    var d = clubData(t.code), all = d.moves.filter(function (m) { return s.moves === "all" || m.kind === s.moves; });
    /* a long list opens on the latest two weeks and expands in place (v2 review: 71 rows made a 9,245px phone page, and it grows every season) */
    var cut = all.length ? Date.parse(all[0].at) - 14 * 864e5 : 0, recent = all.filter(function (m) { return Date.parse(m.at) >= cut; });
    var folded = !s.movesAll && recent.length < all.length, list = folded ? recent : all, noun = s.moves === "in" ? "arrival" : s.moves === "out" ? "departure" : "move";
    var byDay = {}, order = [];
    list.forEach(function (m) { var k = M.etDate(m.at); if (!byDay[k]) { byDay[k] = []; order.push(k); } byDay[k].push(m); });
    var body = list.length ? order.map(function (k) {
      return '<section class="pfc-wk"><h3 class="pfx-sub">' + esc(k) + '</h3><ul class="pfx-rows">' + byDay[k].map(function (m) {
        return '<li><a class="pfc-game pf-press" href="' + m.p.href + '"><span class="pfc-mv ' + m.kind + '" aria-hidden="true">' + S2.ic(m.kind === "in" ? "plus" : "back") + "</span>" +
          '<span class="grow"><b>' + esc(m.p.tag) + "</b><span>" + esc((m.kind === "in" ? HOW_IN[m.how] || "Joined" : HOW_OUT[m.how] || "Left") + (m.pos ? ", " + (M.posName(m.pos) || m.pos) : "")) + "</span></span>" +
          '<span class="pfc-mv-w">' + (m.kind === "in" ? "Arrived" : "Left") + "</span>" + S2.chev() + "</a></li>";
      }).join("") + "</ul></section>";
    }).join("") : empty("No moves", "Nothing matches this filter.");
    return '<div id="pfcMovesB">' + (folded ? '<p class="pfc-sum">The last two weeks: ' + list.length + " of " + plural(all.length, noun) + ".</p>" : "") + body +
      (folded ? '<button type="button" class="btn site outline pf-press pfc-more" data-act="moves-all">Show all ' + plural(all.length, noun) + "</button>" : "") + "</div>";
  }
  function movesPanel(t, s) {
    var d = clubData(t.code), nin = d.moves.filter(function (m) { return m.kind === "in"; }).length, nout = d.moves.length - nin, last = d.moves[0];
    return sec("pfcMvH", head({ kicker: "Roster moves", id: "pfcMvH", h: plural(d.moves.length, "move") + " in " + M.view.name + ".",
        p: last ? "The latest: " + esc(last.p.tag) + " " + (last.kind === "in" ? "arrived" : "left") + " on " + esc(M.etMonthDay(last.at)) + ". Only completed trades appear." : "Nothing has moved yet.",
        side: tabs("moves", [["all", 'All <span class="num">' + d.moves.length + "</span>"], ["in", 'Arrivals <span class="num">' + nin + "</span>"], ["out", 'Departures <span class="num">' + nout + "</span>"]], s.moves, "Which moves", "sm") }) +
      movesBody(t, s));
  }
  /* the History panel's Honors column, its own function so the title race repaints it alone (raceIn) */
  function clubHonors(t) {
    /* Honors (commissioner, 2026-11-21: team awards for the Presidents' Trophy, the Stanley Cup and the rest): the club's
       own trophies first, as rows like By season beside it, then its players' trophies and titles, then Players of the
       Week. Once the season's titles are filed the races are over, so the filed titles replace the race places. The season
       is the one the page tells (toldN: the season on screen, or the newest closed one while it has no games) */
    var hn = toldN(), hName = S2.seasonName(hn);
    var wonT = M.trophies(hn).filter(function (x) { return x.club === t.code; }), teamT = wonT.filter(function (x) { return x.team; }), playerT = wonT.filter(function (x) { return !x.team; });
    var filed = M.filedTitles(hn), titles = filed.length ? [] : M.titles().filter(function (x) { return x.club === t.code; });
    var mineF = filed.filter(function (x) { return x.club === t.code; });
    var potw = (filed.length ? M.honors.potwSeason(hn) : M.honors.potw).filter(function (h) { return h.club === t.code; }).sort(function (a, b) { return b.week - a.week; });   /* newest first, as M.honorRank */
    var nAw = playerT.length + mineF.length;
    var awRow = function (x, name) { var a = awardParts(x); return '<li><a class="pf-rec pf-press" href="' + esc(x.href || "#/stats?tab=awards") + '"><span class="pfx-hon-n d-num">S' + esc(hn) + '</span><span class="grow"><b>' + esc(x.tag) + "</b><span>" + esc(name + ", " + lcFirst(a[0]) + ": " + a[1] + ".") + "</span></span>" + S2.chev() + "</a></li>"; };
    var honH = teamT.length ? (teamT[0].key === "stanley_cup" ? "Stanley Cup champions." : teamT.map(function (x) { return x.short; }).join(" and ") + ".") :
      nAw === 1 ? (playerT[0] ? playerT[0].short + " for " + playerT[0].tag : mineF[0].label + " for " + mineF[0].tag) + "." : nAw ? cap(word(nAw)) + " awards for its players." :
      potw.length ? cap(word(potw.length)) + (potw.length === 1 ? " Player of the Week." : " Players of the Week.") : titles.length ? plural(titles.length, "place") + " in the title races." : filed.length ? "No " + hName + " honors." : "No honors yet.";
    return '<div class="pfx-col" id="pfcHon">' + head({ kicker: "Honors", id: "pfcHonH", h: honH,
        p: teamT.length || nAw ? hName + "'s trophies and titles, then Players of the Week, for this club and its players." :
          filed.length ? (potw.length ? "Players of the Week for this club's players. " + hName + "'s trophies and titles went to other clubs." : hName + "'s trophies, titles and Players of the Week went to other clubs.") :
          "Players of the Week and the statistical title races, for players on this club. Titles are decided when the regular season ends.", side: arrow("#/stats?tab=awards", "All awards") }) +
      (teamT.length || nAw || potw.length || titles.length ? '<ul class="pfx-rows pfx-hon">' +
        teamT.map(function (x) { return '<li class="pfx-hon-aw"><span class="pfx-hon-n d-num">S' + esc(hn) + '</span><span class="grow"><b>' + esc(x.name) + "</b><span>" + esc(awardLine(x)) + "</span></span></li>"; }).join("") +
        playerT.map(function (x) { return awRow(x, x.short); }).join("") +
        mineF.map(function (x) { return awRow(x, x.label); }).join("") +
        potw.map(function (h) { return '<li><a class="pf-rec pf-press" href="' + h.href + '"><span class="pfx-hon-n d-num">W' + esc(h.week) + '</span><span class="grow"><b>' + esc(h.tag) + "</b><span>" + esc(h.label) + ", Week " + esc(h.week) + ". " + esc(h.line) + "</span></span>" + S2.chev() + "</a></li>"; }).join("") +
        titles.map(function (x) { return '<li><a class="pf-rec pf-press" href="' + x.href + '"><span class="pfx-hon-n d-num">' + esc(ord(x.rank)) + '</span><span class="grow"><b>' + esc(x.tag) + "</b><span>" + esc(x.label + " race, " + x.display) + "</span></span>" + S2.chev() + "</a></li>"; }).join("") + "</ul>" : "") + "</div>";
  }
  function historyPanel(t, row) {
    var d = clubData(t.code), weeks = {}, all = {};
    M.games.forEach(function (g) {   /* points per club per week: win 2, overtime loss 1 (a forfeit never gives the OT point), as in the standings */
      if (!g.isFinal || g.stage !== "regular" || g.hs == null) return;
      [g.home, g.away].forEach(function (c) { var pts = g.winner === c ? 2 : g.decision === "ot" ? 1 : 0; all[g.week] = (all[g.week] || 0) + pts; if (c === t.code) weeks[g.week] = (weeks[g.week] || 0) + pts; });
    });
    var wk = Object.keys(all).sort(function (a, b) { return a - b; }), vals = wk.map(function (w) { return weeks[w] || 0; });
    var avg = wk.length ? wk.reduce(function (a, w) { return a + all[w]; }, 0) / (wk.length * Math.max(1, M.teams.length)) : 0;
    var bi = vals.indexOf(Math.max.apply(null, vals.concat([0])));
    var weeksSec = sec("pfcWkH", head({ kicker: "Points by week", id: "pfcWkH", h: vals.length ? "Best week: " + plural(vals[bi], "point") + " in Week " + wk[bi] + "." : "No weeks yet.",
        p: "Points earned each week, 2 for a win and 1 for an overtime loss, against the average club's week (the dashed line)." }) +
      (vals.length ? '<div class="pfc-bars">' + S2.charts.bars({ w: chartW(0.6), h: 220, values: vals, labels: wk.map(function (w) { return "Week " + w; }), showValues: true, ref: Math.round(avg * 10) / 10, refLabel: "League average " + S2.fmt(avg, 1), label: t.full + " points by week" }) + "</div>" : ""));
    /* each record is one row link named for itself (v2 review: four links all called "Game", 34px tall) */
    var rec = function (label, x, big, text) { return x ? '<li><a class="pfc-game pf-press" href="' + x.g.href + '"><span class="pfc-rec-n d-num">' + esc(big) + '</span><span class="grow"><b>' + esc(label) + "</b><span>" + esc(text) + "</span></span>" + S2.chev() + "</a></li>" : ""; };
    var vs = function (x) { return (x.home ? "vs " : "at ") + x.opp + ", " + M.etDate(x.g.at); };
    var recSec = sec("pfcRecH", head({ kicker: "Club records", id: "pfcRecH", h: d.best ? "Biggest win: " + d.best.gf + "-" + d.best.ga + (d.best.home ? " vs " : " at ") + d.best.opp + "." : "Club records.",
        p: M.view.name + ". Streaks count every result; biggest win and most goals leave out forfeits, whose score is set by rule." }) +
      '<ul class="pfx-rows pfc-recs">' +
        rec("Biggest win", d.best, d.best ? d.best.gf + "-" + d.best.ga : "", d.best ? vs(d.best) : "") +
        rec("Most goals in a game", d.most, d.most ? String(d.most.gf) : "", d.most ? vs(d.most) : "") +
        (d.longW.n ? rec("Longest win streak", d.longW.to, String(d.longW.n), plural(d.longW.n, "game") + ", " + M.etMonthDay(d.longW.from.g.at) + " to " + M.etMonthDay(d.longW.to.g.at)) : "") +
        (d.longL.n > 1 ? rec("Longest run without a win", d.longL.to, String(d.longL.n), plural(d.longL.n, "game") + ", " + M.etMonthDay(d.longL.from.g.at) + " to " + M.etMonthDay(d.longL.to.g.at)) : "") +
        rec("First win", d.firstWin, d.firstWin ? d.firstWin.gf + "-" + d.firstWin.ga : "", d.firstWin ? vs(d.firstWin) : "") +
        (row && row.forfeits_taken ? '<li><span class="pfc-game"><span class="pfc-rec-n d-num">' + row.forfeits_taken + '</span><span class="grow"><b>Forfeits taken</b><span>' + plural(row.forfeits_taken, "game") + " lost by forfeit</span></span></span></li>" : "") +
      "</ul>", "tint");
    var honors = clubHonors(t);
    /* By season: every season row (M.control.seasons, the seasons table) as it stands: closed ones as they finished
       (M.seasonClose), the season on screen in progress with its row, an upcoming one with its calendar */
    var byRow = function (n, title, text) { return '<li><span class="pfc-game"><span class="pfc-rec-n d-num">S' + esc(n) + '</span><span class="grow"><b>' + esc(title) + "</b><span>" + esc(text) + "</span></span></span></li>"; };
    var byRows = M.control.seasons.map(function (sz) {
      var n = sz.number, f = finOf(t.code, n);
      if (f) return byRow(n, sz.name, f.w + "-" + f.l + "-" + f.otl + ", " + f.pts + " points, " + ord(f.divRank) + " in the " + t.division + ". " + cap(seasonOut(f, t)) + ".");
      if (n === M.view.season && row && !M.view.empty.games) return byRow(n, sz.name + ", in progress", row.w + "-" + row.l + "-" + row.otl + ", " + row.pts + " points, " + ord(row.rank) + " in the " + t.division + (row.mark ? ", " + MARK[row.mark].toLowerCase() : ""));
      if (sz.status === "upcoming") return byRow(n, sz.name + ", upcoming", (seasonDay(n, "owners_decided_by") ? "Owners decided " + seasonDay(n, "owners_decided_by") + ", draft " : "Draft ") + (seasonDay(n, "draft_at") || "to be set") + ", puck drop " + (seasonDay(n, "starts_at") || "to be set") + ".");
      return "";
    }).join("");
    var up = M.control.seasons.filter(function (sz) { return sz.status === "upcoming"; })[0];
    var seasons = '<div class="pfx-col">' + head({ kicker: "By season", id: "pfcBySH", h: up ? up.name + (seasonDay(up.number, "starts_at") ? " starts " + seasonDay(up.number, "starts_at") + "." : " is next.") : M.view.name + (M.view.status === "complete" ? " is complete." : " is under way."),
        p: up ? "Every player reapplies, and rosters are rebuilt at the draft" + (seasonDay(up.number, "draft_at") ? " on " + seasonDay(up.number, "draft_at") : "") + "." : "" }) +
      '<ul class="pfx-rows">' + byRows + "</ul></div>";
    return weeksSec + recSec + '<section class="pfx-sec reveal pfx-split two" aria-label="Honors and seasons">' + honors + seasons + "</section>";
  }
  function panel(t, row, s) {
    var html = s.tab === "stats" ? statsPanel(t, s) : s.tab === "games" ? gamesPanel(t, s) : s.tab === "moves" ? movesPanel(t, s) : s.tab === "history" ? historyPanel(t, row) : rosterPanel(t);
    return '<div id="pfcPanel" role="region" aria-label="' + esc((TABS.filter(function (x) { return x[0] === s.tab; })[0] || TABS[0])[1]) + '">' + html + "</div>";
  }
  function others(code) {
    return '<nav class="pfx-sec pfc-others reveal" aria-label="Other clubs"><span class="kicker">' + (code ? "The other clubs" : "All " + word(M.teams.length) + " clubs") + '</span><div class="pfc-others-l">' + M.teams.filter(function (t) { return t.code !== code; }).map(function (t) {
      return '<a class="pf-press" href="' + t.href + '">' + M.crest(t.code, "lg") + "<span>" + esc(t.city) + "</span></a>"; }).join("") + "</div></nav>";
  }
  function aboutC(t, d) {
    /* the roster shape of the season on screen (viewRules) */
    var ru = viewRules(), lim = ru.composition, nm = esc(M.view.name);
    var shape = lim
      ? nm + " roster shape: up to " + plural(lim.F, "forward") + ", " + lim.D + " defense and " + plural(lim.G, "goaltender") + ", " + lim.total + " in all, per " + esc(ru.source) + "; training camp had no limit, and its salaries counted toward the cap."
      : nm + " roster shape: " + ru.limit + " players all season, the Owner's and the General Manager's seats included, with at least " + plural(ru.min.F, "forward") + ", " + ru.min.D + " defense and " + plural(ru.min.G, "goaltender") + " and no maximums (Rule S2.4); clubs keep no training camp of their own (Rule S2.5).";
    return about([
      "Standings count forfeits the way the rulebook does: a forfeit decides the win and the loss, and a recorded forfeit score counts toward goal difference. The magic number is the points this club gains, plus the points the closest chaser drops, needed to lock a top-" + M.cutLine.after + " finish.",
      "The goal difference line adds up goals scored minus goals allowed, game by game; the strip under it is every result, oldest on the left.",
      "Club lines count only the games a player played for " + esc(t.code) + ", players who have left included; a player's own page shows their whole season." + (d.unlinked ? " " + plural(d.unlinked, "box score line") + " had no linked player and " + (d.unlinked === 1 ? "is" : "are") + " not shown." : ""),
      "Club stats: time on attack and passing are EA's own club figures, every sitting of a game added together. Hits, blocks, takeaways, interceptions, giveaways, penalty minutes and faceoffs add up every player line in the club's box scores, so the club's faceoff figure counts every position. For giveaways and penalty minutes, fewer ranks higher.",
      "Power play: how often a man advantage ends in a goal. Penalty kill: how often a man disadvantage ends without one. Ranked among the " + league().length + " clubs.",
      shape + " Ratings run 75 to 99 with a median of 85; a gray one is provisional (under " + M.SETTLE_GP + " games).",
      "Roster moves fold moves inside the club" + (lim ? " (active roster and camp)" : "") + " into one stint, and only completed trades appear.",
      "Source: the league's standings, schedule, rosters and EA box scores, " + esc(M.view.name) + ", as of " + esc(M.etFull(M.generated)) + "."
    ]);
  }

  var CURC = null;
  S2.page("club", {
    tab: "clubs",
    title: function (r) { var t = M.team(r.arg); return t ? t.full : "Club"; },
    render: function (r) {
      fresh();
      var t = M.team(r.arg); CURC = t;
      if (!t) {
        return '<div class="pfc" id="pfcRoot"><header class="hero pfx-nf reveal">' + crumb([["#/clubs", "Clubs"]], "Not found") + '<h1 class="d-1">' + (r.arg ? "Club not found" : "Clubs") + '</h1><p class="lede-l">' +
          (r.arg ? "No club uses the code “" + esc(r.arg) + "”. Pick one of the " + word(M.teams.length) + " below." : "Pick a club.") + "</p></header>" + others("") + "</div>";
      }
      var s = cst(t.code); s.tab = r.q.tab && TABS.some(function (x) { return x[0] === r.q.tab; }) ? r.q.tab : "roster";   /* the address decides the tab, so a plain #/club/VAN link opens Roster */
      var row = standRow(t.code), d = clubData(t.code);
      return '<div class="pfc" id="pfcRoot">' + heroC(t, row) + nextBand(t, finOf(t.code) ? null : gamesData(t).up[0]) + seasonC(t, row, d) +
        '<div class="pfc-tabs reveal">' + tabs("tab", TABS.map(function (x) { return [x[0], esc(x[1])]; }), s.tab, "Club sections", "lg") + "</div>" + panel(t, row, s) + others(t.code) + aboutC(t, d) + "</div>";
    },
    after: function (page) {
      var root = S2.$("#pfcRoot", page), t = CURC; if (!root) return;
      pressFeedback(root);
      if (!t) return;
      var s = cst(t.code), row = standRow(t.code);
      var ctx = { onSeg: function (key, v) {
        if (key === "tab") {
          s.tab = v;
          try { history.replaceState(history.state, "", "#/club/" + t.code + (v === "roster" ? "" : "?tab=" + v)); } catch (e) { /* file:// or a sandbox: the tab still switches, it just is not in the address */ }
          swap("pfcPanel", panel(t, row, s), root, ctx, true);
          toPanel(false);
          return;
        }
        s[key] = v;
        if (key === "stats") { swap("pfcStHd", statsCopy(t, s), root, ctx); swap("pfcStatsB", statsBody(t, s), root, ctx, true); }
        else if (key === "games") { swap("pfcGaHd", gamesCopy(t, s), root, ctx); swap("pfcGamesB", gamesBody(t, s), root, ctx, true); }
        else if (key === "moves") swap("pfcMovesB", movesBody(t, s), root, ctx, true);
      } };
      /* the new panel starts right under the sticky tabs. always = asked for from elsewhere on the page (All results), so it
         scrolls down too; a tab switch only scrolls back up when the reader was deep in the old panel */
      function toPanel(always) {
        var tb = S2.$(".pfc-tabs", root), el = S2.$("#pfcPanel", root); if (!tb || !el) return;
        var bot = always ? (parseFloat(getComputedStyle(tb).top) || 0) + tb.offsetHeight : tb.getBoundingClientRect().bottom, pt = el.getBoundingClientRect().top;
        if (always || pt < bot) window.scrollBy({ top: pt - bot, behavior: always && !reduced() ? "smooth" : "auto" });
      }
      wire(root, ctx); grow(root);
      /* the market's reads change the acting club's Season 2 figures (S2.market.clubState): the open panel repaints in place */
      follow(function (e) { if (e.type === "load") swap("pfcPanel", panel(t, row, s), root, ctx); }, root);
      /* the race places of this club's players (History's Honors column, #pfcHon), repainted alone when History is open
         (QA round 2 review: the whole panel was swapped, which settled its entrance and dropped focus) */
      raceIn(root, function () { return JSON.stringify(M.titles().filter(function (x) { return x.club === t.code; }).map(function (x) { return [x.category, x.rank, x.id, x.value]; })); },
        function () {   /* only the Honors column, when History is the panel open; a row that held focus keeps it */
          var k = focusKey(S2.$("#pfcHon", root));
          focusBack(swap("pfcHon", clubHonors(t), root, ctx), k);
        });
      root.addEventListener("click", function (e) {
        var hq = e.target.closest("[data-hq]");
        if (hq) { e.preventDefault(); if (S2.has("commish") && S2.market && S2.market.setClub) S2.market.setClub(hq.dataset.hq); S2.go("#/hq"); return; }
        if (e.target.closest('[data-act="all-results"]')) {
          var sg = S2.$(".pfc-tabs [data-seg]", root); s.games = "results";
          if (s.tab === "games") { swap("pfcGaHd", gamesCopy(t, s), root, ctx); swap("pfcGamesB", gamesBody(t, s), root, ctx, true); var gs = S2.$('[data-seg="games"]', root); if (gs && gs._seg) gs._seg.set("results"); }
          else if (sg && sg._seg) sg._seg.set("games");
          toPanel(true); return;
        }
        if (e.target.closest('[data-act="moves-all"]')) {
          var shown = S2.$$("#pfcMovesB a.pfc-game", root).length; s.movesAll = true;
          swap("pfcMovesB", movesBody(t, s), root, ctx, false);
          var next = S2.$$("#pfcMovesB a.pfc-game", root)[shown]; if (next) next.focus({ preventScroll: true });   /* the button is gone: focus lands on the first row it revealed */
          return;
        }
        var a = e.target.closest('[data-act="sort"]'); if (!a || !root.contains(a)) return;
        var id = a.dataset.tbl, sv = SORT[id], k = a.dataset.k;
        sv.dir = sv.k === k && sv.dir === "desc" ? "asc" : sv.k === k ? "desc" : (k === "tag" || k === "posTop" ? "asc" : "desc"); sv.k = k;
        swap(id, table(id, statsCols(s.stats), statsRows(t, s), sv, t.full + " lines"), root, ctx);
        var f = S2.$("#" + id + ' [data-k="' + k + '"]'); if (f) f.focus();
      });
    }
  });
})();
