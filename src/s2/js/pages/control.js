/* #/control: the Control Center, commissioner only (core.js sends every other role to the locked page).
   Seven tabs under one uppercase title: Overview, Tonight, Season setup, Growth & retention, Clubs, Staff, System.
   League website v2 (commissioner, 2026-10-19: "feels too much like a dashboard and not a League Website"): the page
   wears the site's type (a condensed uppercase title with a kicker, a sticky uppercase tab strip) and each tab is a run
   of full-width bands, each opening with a headline that states the finding with its number. Charts stay exactly as the
   commissioner likes them, each with one sentence above it; sources and method sit in ONE "About this data" disclosure
   per tab instead of a caption under every chart. Season 2 staffing (ruling 2026-10-19): no departments; one staff
   group and a manager per committee topic, with the questions the ruling leaves open listed as the commissioner's call.
   The open concept (commissioner, 2026-10-19: "The concept should be fully open for all buttons to play with so I can
   figure out if I need to make changes or not") ran every tool here in demo state until the S2 swap put each on the
   league's own door (below); i3d (2026-11-25) removed the demo paths, so the page runs only on the league's data.
   Data: S2.M (the league read) and the commissioner's own reads (s2_control, ops_job_health, season_survey_results, the
   clubs' rows, the award ballots, a member search) through the read client, and the Staff Desk's own reads
   (js/pages/desk.js S2._desk: what waits on the desk, the committees and the staff list).
   Rules this file keeps. Tabs, the members period, the audit filters, the cron sort and every write repaint in place
   (history.replaceState, never S2.route), so an interaction never resets the page. Charts are drawn at their measured
   width, so an 11px axis label is 11px on a phone, not a scaled-down 6px. Owner applications are shapes only.
   S2 swap (g3, 2026-11-24): every tool is on the current site's own door, through S2.write (contracts/client-api.md):
   seasons (settings, holidays, New season), the schedule generator (the classic CG.generateSchedule itself, previewed
   before it writes), clubs (teams.update, set_team_manager, the EA link, the classic logo upload), roles
   (set_member_role), site features (feature_flags), news (news.insert), awards (award_ballots, finalize_season_award),
   playoffs (draw_playoff_round, clear_playoff_round, the site_config pause), the rollover (start_next_season), and a game
   moved (ops_reschedule_game) or re-opened (reopen_game_final). Nothing shows as done until the league confirms it; a
   refusal shows the league's own words and keeps what was typed. The database decides who may do each (commissioners
   for all of these but news, which media staff may post too); core.js shows this page to commissioners only. */
(function () {
  "use strict";
  var S2 = window.S2, esc = S2.esc, fmt = S2.fmt, TZ = "America/New_York", uid = 0;
  /* plain text, no entities: the header's Workspaces menu escapes these labels (header v2) */
  var TABS = [["overview", "Overview"], ["tonight", "Tonight"], ["setup", "Season setup"], ["growth", "Growth and retention"],
    ["clubs", "Clubs"], ["staff", "Staff"], ["system", "System"]];
  /* Season 2 committees: TOPICS, each with a manager who knows it best; anyone on staff may pick up its work. */
  /* 2026-11-23: six committees, from the one definition (S2.COMMITTEE_DEFS, js/flows.js): [key, name, charter, the name the
     placeholder officials carry (model.js DEPTS)] */
  var COMMITTEES = S2.COMMITTEE_DEFS.map(function (c) { return [c.key, c.name, S2.committeeCovers(c), c.name]; });

  var EDGE_WHAT = { "discord-sync": "Keeps Discord roles and channels in step with the site", "twitch-live-sync": "Finds members who are streaming",
    "lfg-timers": "Times out pickup lobbies", "discord-scheduler": "Posts reminders on schedule", "discord-welcome": "Greets new members in #welcome" };

  /* page state that outlives a repaint (and a theme or finish change, which re-renders the route) */
  var st = { period: "week", cron: { key: "job", dir: 1 }, hb: { key: "ageMin", dir: -1 }, clock: 0,
    /* the schedule week on show, the discord-sync run in flight */
    schedWeek: 1, running: {},
    /* the Season 2 survey section: the X-Factor tier on show, the written lists opened in full */
    svTier: "gold", svAll: {},
    /* what the league confirmed since the model was built (keyed by season id, each with the model's generated stamp, so
       the next league read replaces it), and the actions in flight */
    confirmed: {}, written: {}, busy: {}, cfg: {}, poGames: {}, flags: {}, ballots: null };
  /* the season this tab sets up. shortcut: Season 2 by name (the stepper, the calendar and the rulings are Season 2's);
     when Season 3 setup starts, read the season after the current one instead */
  var SETUP_N = 2;

  /* ---------- small helpers ---------- */
  function f(n) { return (Math.round(n * 10) / 10).toString(); }
  function M() { return S2.M; }
  function pctOf(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function dayKey(iso) { return M().etDay(iso); }
  function daysUntil(iso) { return Math.round((Date.parse(dayKey(iso) + "T12:00:00Z") - Date.parse(dayKey(M().generated) + "T12:00:00Z")) / 864e5); }
  function inDays(n) { return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n > 1 ? "In " + n + " days" : -n + " days ago"; }
  /* a time never wraps away from its AM or PM (review 2026-10-20: "Watching since 9:25 / PM" on a phone): the space ICU
     puts before the meridiem becomes a no-break space */
  function nbm(s) { return s.replace(/\s(?=[AP]M$)/, "\u00a0"); }
  function hm(t) { return nbm(new Date(t).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })); }
  function hms(t) { return nbm(new Date(t).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" })); }
  /* one date format for every Season 2 date this page writes: "Sat, Nov 28, 11:59 PM ET" (the year dropped), as the
     Coming up list and the sheets print it; null when the row has no such date */
  function when(c) { return c ? c.date.replace(/, \d{4}$/, "") + ", " + nbm(c.time) + " ET" : null; }
  function niceStep(raw) { if (raw <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
  function copy(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
  var LOCK = '<svg class="cc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8.5 11V8a3.5 3.5 0 017 0v3"/></svg>';
  var WARN = '<svg class="cc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".6" fill="currentColor"/></svg>';
  function ic(name) { return name === "lock" ? LOCK : name === "warn" ? WARN : S2.ic(name, "cc-ic"); }
  function dot(tone) { return '<span class="cc-dot ' + (tone || "ok") + '" aria-hidden="true"></span>'; }
  function shapes(n, label, cls) { return S2.shapes(Math.max(1, n), label, cls); }   /* core's one count of dots */
  /* ---------- the website frame (ui.css league website layer): bands, section heads, arrow links, one disclosure ---------- */
  /* a full-width band; tone "a" is the page canvas, "w" the white surface, so a tab alternates without a single card wall.
     The ink band scopes the dark look to itself and follows the chosen finish (S2.applyLook updates data-look-scope). */
  function band(tone, inner, first, cls) {
    return '<section class="band cc-band cc-' + tone + (tone === "ink" ? " ink" : "") + (cls ? " " + cls : "") + (first ? " reveal" : "") + '"' +
      (tone === "ink" ? ' data-theme="dark" data-look-scope data-finish="' + esc(S2.state.finish) + '"' : "") + ">" + inner + "</section>";
  }
  /* core's one section head (S2.secHead, audit 2026-11-09); this tab's kicker and head arrive as escaped HTML */
  function secHead(kicker, head, sentence, aside, id) {
    return S2.secHead({ kh: kicker, hh: head, p: sentence, aside: aside, id: id, lvl: 3, cls: "cc-sec" });
  }
  /* a smaller head inside a band: what the chart or list below shows, said as one sentence */
  function lead(head, sentence, aside, id) {
    return '<div class="cc-lead"><div class="grow"><h4 class="d-3"' + (id ? ' id="' + id + '"' : "") + ">" + head + "</h4>" + (sentence ? "<p" + (id ? ' id="' + id + 'S"' : "") + ">" + sentence + "</p>" : "") + "</div>" + (aside || "") + "</div>";
  }
  function arrowLink(href, label, go) {
    return '<a class="arrow" href="' + href + '"' + (go ? ' data-cc-go="' + go + '"' : "") + "><span>" + label + "</span>" + S2.ic("chev") + "</a>";
  }
  /* sources and method, once per tab (rows: [what, how]), instead of a caption under every chart */
  /* core's one disclosure (S2.about, audit 2026-11-09: this tab had its own uppercase one); the rows read as a what/how list */
  function about(rows) {
    return S2.about('<dl class="about-dl">' + rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("") + "</dl>");
  }
  /* a tab whose last band is white ends on a short canvas band that holds its disclosure, so every tab meets the footer the same way */
  function tail(rows) { return band("a", about(rows), false, "cc-tail"); }
  function empty(msg) { return S2.empty("none", msg); }   /* core's one empty state (audit 2026-11-09) */
  function hbar(label, value, max, opts) {
    opts = opts || {};
    var p = max ? Math.max(1.5, value / max * 100) : 0;
    return '<div class="cc-hb' + (opts.cls ? " " + opts.cls : "") + '"><span class="cc-hb-l">' + label + '</span><span class="cc-hb-t"><i class="cc-grow" style="width:' + f(p) + '%"></i></span>' +
      '<span class="cc-hb-v num">' + fmt(value) + (opts.note ? ' <span class="t-foot">' + opts.note + "</span>" : "") + "</span></div>";
  }
  /* the bars' one entrance, on the page's first paint only (a tab switch or a repaint never runs it again): a clip-path wipe,
     which is composited and keeps the rounded ends, with a short stagger that restarts in each section, so the last bar
     lands inside half a second. Reduced motion: none; the pane's own fade covers it. */
  function growBars(pane) {
    if (S2.reduce.matches || !Element.prototype.animate) return;
    S2.$$("section", pane).forEach(function (sec) {
      S2.$$(".cc-grow", sec).forEach(function (el, i) {
        var r = " round " + getComputedStyle(el).borderTopRightRadius;
        el.animate([{ clipPath: "inset(0 100% 0 0" + r + ")" }, { clipPath: "inset(0 0 0 0" + r + ")" }], { duration: 420, delay: Math.min(i, 6) * 30, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "backwards" });
      });
    });
  }
  /* every sheet opened here closes when the route changes (a link inside it, Back, the search palette), so it never stays
     modal over another page; and when the control that opened it was repainted while it was open, focus goes to the
     control's replacement instead of falling to the body */
  var curSheet = null;
  function sheet(opts, refocus) {
    var sh, user = opts.onClose;
    opts.onClose = function () {
      if (curSheet === sh) curSheet = null;
      var a = document.activeElement, b = refocus && (!a || a === document.body) ? refocus() : null;
      if (b) b.focus();
      if (user) user();
    };
    sh = S2.sheet(opts);
    curSheet = sh;
    return sh;
  }

  /* ---------- the confirm sheet and the write sheet ---------- */
  /* the live site's CG.confirm, as a sheet: o = { title, why: [paragraphs], label, run, refocus, danger }. run() returns
     false to keep the sheet open (a refusal it has shown); anything else closes it. danger: an action that ends or removes
     something wears the kit's danger button (flows.js reverse-trade), never the blue default */
  /* core's one confirm sheet (S2.confirm, audit 2026-11-09: focus starts on Cancel, never on the action); this tab's
     sheet opener keeps the focus return (refocus) */
  function confirmSheet(o) {
    return S2.confirm({ title: o.title, why: o.why, html: o.html, ok: o.label, danger: o.danger,
      open: function (opts) { return sheet(opts, o.refocus); }, onOk: function (sh) { return o.run(sh); } });
  }
  /* one write from a confirm sheet (contracts/client-api.md): the sheet stays open and busy until the league answers. A
     confirmed write closes it and runs done (which repaints in place); a refusal shows the league's own words in the sheet
     and keeps whatever was typed; a write that partly landed (e.partial) says so, locks the button and runs o.partial.
     o.check(sh) may return the input to send, or false after showing its own message (sayErr) */
  function writeSheet(o) {
    var sh = confirmSheet({ title: o.title, why: o.why, html: (o.html || "") + '<p class="fl-err cc-ed-err" role="alert" data-cc-err hidden></p>', label: o.label, danger: o.danger, refocus: o.refocus,
      run: function (sh) {
        var b = S2.$('[data-cf="ok"]', sh.el), err = S2.$("[data-cc-err]", sh.el);
        if (b.disabled) return false;
        var input = o.check ? o.check(sh) : null;
        if (input === false) return false;
        b.disabled = true; b.setAttribute("aria-busy", "true"); err.hidden = true;
        Promise.resolve().then(function () { return o.send(sh, input); }).then(function (res) {
          sh.close(); if (o.done) o.done(res, input);
        }, function (e) {
          b.removeAttribute("aria-busy");
          sayErr(sh, e && e.message ? e.message : String(e));
          if (e && e.partial) { if (o.partial) o.partial(e); var no = S2.$('[data-cf="no"]', sh.el); if (no) no.textContent = "Close"; return; }
          b.disabled = false;
        });
        return false;
      } });
    if (o.opened) o.opened(sh);
    return sh;
  }
  function sayErr(sh, msg) { var err = S2.$("[data-cc-err]", sh.el); if (err) { err.textContent = msg; err.hidden = false; } return false; }
  function cal2(key) { var s2 = ctl().season(2); return s2 ? s2.calendar.filter(function (c) { return c.key === key; })[0] || null : null; }
  /* ET calendar days as "YYYY-MM-DD" strings: add days, and the weekday (0 Sunday), at noon UTC so no zone can tip them */
  function dayAdd(ymd, n) { return new Date(Date.parse(ymd + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10); }
  function dow(ymd) { return new Date(ymd + "T12:00:00Z").getUTCDay(); }
  /* the instant of an ET wall time ("9:00 PM" or "21:35") on an ET day; tries standard then daylight time and keeps
     the one that reads back as that day and time, so a date across a clock change still lands on the hour */
  function etAt(ymd, time) {
    var m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(time || "").trim()); if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    var h = +m[1] % (m[3] ? 12 : 24) + (/pm/i.test(m[3] || "") ? 12 : 0), p = ymd.split("-");
    for (var off = 5; off >= 4; off--) {
      var t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], h + off, +m[2])).toISOString();
      if (dayKey(t) === ymd && M().etTime(t) === new Date(Date.UTC(2000, 0, 1, h, +m[2])).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" })) return t;
    }
    return null;
  }
  /* Rule S2.1: registration for the draft closes at 11:59 PM ET the day before the draft. The check reads the Season 2
     row as it stands (an Edit settings in the demo moves it), so the warning goes when the dates agree. */
  function deadlineCheck() {
    var reg = cal2("registration_deadline"), dr = cal2("draft_at");
    if (!reg || !dr) return null;
    var want = dayAdd(dayKey(dr.at), -1), wantAt = etAt(want, "11:59 PM");
    return { reg: reg, want: want, wantLabel: wantAt ? M().etFull(wantAt).replace(/, \d{4}$/, "") : want, off: dayKey(reg.at) !== want || reg.time !== "11:59 PM" };
  }
  /* the ET day ("2027-01-13") a holiday falls on in year y, and its name: the classic calendar (js/cg-engine.js, CG.HOLIDAYS) */
  function holidayDay(key, y) { return S2.CG.HOLIDAY_BY_KEY[key] ? S2.CG.holidayDate(key, y) : null; }
  function holidayName(key) { return (S2.CG.HOLIDAY_BY_KEY[key] || {}).name || key; }
  /* job health, one definition for the System headline and the sidebar count. Missing data is never "healthy": a list
     that came back empty is named, and the page says it could not read the jobs.
     qa (visual 17): a job that stopped running is not healthy. A database job counts only when its last run did not fail
     AND it is not late (past twice its schedule and at least five minutes past it, the heartbeats' own rule); an Edge
     Function only when its last run was clean AND its heartbeat is fresh (or, with no heartbeat, its last run is not
     late). The headline said "All 35 jobs healthy" above "26 jobs need a look" with Late rows */
  function lateBy(cad, ago) { return !!cad && ago != null && ago > Math.max(2 * cad, cad + 5); }
  function cronLate(c) { return lateBy(c.cadenceMin, c.last_min_ago); }
  function cronOk(c) { return !!c && c.healthy && !cronLate(c); }
  function edgeOk(e, J) {
    var b = (J || ctl().jobs).heartbeats.filter(function (h) { return h.key === e.fn || h.key === "rl_" + e.fn; })[0];   /* the Edge workers beat as rl_<fn> */
    return !!e.healthy && (b ? !!b.fresh : !lateBy(e.every_min, e.ran_min_ago));
  }
  function jobHealth() {
    var J = ctl().jobs, all = J.cron.length + J.edge.length, ok = J.cron.filter(cronOk).length + J.edge.filter(function (e) { return edgeOk(e, J); }).length;
    var missing = [[J.edge, "Edge Functions"], [J.cron, "database jobs"], [J.heartbeats, "heartbeats"]].filter(function (x) { return !x[0].length; }).map(function (x) { return x[1]; });
    return { J: J, all: all, ok: ok, missing: missing, healthy: !missing.length && ok === all };
  }
  /* bind the kit's charts (and their binders) without replaying their entrance: used for repaints that are not page
     entrances. QA round 2 (2026-11-25): S2.settle (js/core.js), the one way a repainted region skips its entrances, shows
     its reveals and finishes the draw-ins hydrate starts in this same frame (it once lent hydrate a Reduce Motion answer
     for one call, a second way to do the same) */
  function hydrateQuiet(root) { S2.charts.hydrate(root); S2.settle(root); }

  /* ---------- monotone cubic path: smooth, but never overshoots the data (a member count cannot dip below a real value) */
  function curve(pts) {
    var n = pts.length, i, dx = [], m = [], t = [];
    if (n < 2) return n ? "M" + f(pts[0][0]) + "," + f(pts[0][1]) : "";
    for (i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1); }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (!m[i]) { t[i] = 0; t[i + 1] = 0; continue; }
      var a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { var k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    var d = "M" + f(pts[0][0]) + "," + f(pts[0][1]);
    for (i = 0; i < n - 1; i++) { var h = dx[i] / 3; d += "C" + f(pts[i][0] + h) + "," + f(pts[i][1] + h * t[i]) + " " + f(pts[i + 1][0] - h) + "," + f(pts[i + 1][1] - h * t[i + 1]) + " " + f(pts[i + 1][0]) + "," + f(pts[i + 1][1]); }
    return d;
  }
  /* scrubbing for every over-time chart here: answers on pointer-down, follows a finger or the mouse, arrow keys,
     Home and End; the readout below the chart is aria-live so a screen reader hears each point */
  function scrubber(svg, n, xOf, show, reset) {
    var idx = -1, W = svg.viewBox.baseVal.width;
    function at(e) { var r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W, best = 0, bd = Infinity;
      for (var i = 0; i < n; i++) { var dd = Math.abs(xOf(i) - x); if (dd < bd) { bd = dd; best = i; } } return best; }
    function go(i) { i = Math.max(0, Math.min(n - 1, i)); if (i === idx) return; idx = i; show(i); }
    svg.addEventListener("pointerdown", function (e) { if (e.pointerType !== "mouse") { try { svg.setPointerCapture(e.pointerId); } catch (x) { /* capture is a nicety */ } } go(at(e)); });
    svg.addEventListener("pointermove", function (e) { if (e.pointerType === "mouse" || e.buttons) go(at(e)); });
    svg.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") { idx = -1; reset(); } });
    svg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { go(idx < 0 ? n - 1 : idx + (e.key === "ArrowRight" ? 1 : -1)); e.preventDefault(); }
      else if (e.key === "Home") { go(0); e.preventDefault(); } else if (e.key === "End") { go(n - 1); e.preventDefault(); }
    });
    svg.addEventListener("blur", function () { idx = -1; reset(); });
  }
  function xTicks(n, iw, X, labels, H) {   /* anchored on the LAST point (today), evenly spaced backwards, never crowded */
    var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 72)))), s = "";
    for (var i = 0; i < n; i++) if ((n - 1 - i) % every === 0) s += '<text x="' + f(X(i)) + '" y="' + (H - 7) + '" text-anchor="' + (i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle") + '" class="cc-axis">' + esc(labels[i]) + "</text>";
    return s;
  }

  /* area chart with a comparison series. o: { w, h, labels, read[], series:[{name, values, dashed}], label, summary } */
  function areaChart(host, o) {
    var W = o.w, H = o.h, P = { l: 2, r: 44, t: 12, b: 26 }, iw = W - P.l - P.r, ih = H - P.t - P.b, n = o.labels.length, k = "ccg" + (++uid);
    var max = 0; o.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null && v > max) max = v; }); });
    if (!n || !max) { host.innerHTML = empty("No members recorded yet."); return; }
    var step = niceStep(max / 4), top = Math.max(step, Math.ceil(max / step) * step);
    var X = function (i) { return P.l + (n < 2 ? iw / 2 : i * iw / (n - 1)); }, Y = function (v) { return P.t + ih - v / top * ih; };
    var g = "";
    for (var v = 0; v <= top + 1e-9; v += step) g += '<line class="cc-gl' + (v ? "" : " base") + '" x1="' + P.l + '" x2="' + (P.l + iw) + '" y1="' + f(Y(v)) + '" y2="' + f(Y(v)) + '"/>' +
      '<text class="cc-axis num" x="' + (W - 2) + '" y="' + f(Y(v) + 4) + '" text-anchor="end">' + fmt(v) + "</text>";
    var lastPt = null;
    var marks = o.series.map(function (s, si) {
      var pts = []; s.values.forEach(function (val, i) { if (val != null) pts.push([X(i), Y(val)]); });
      if (!pts.length) return "";
      if (si === 0) lastPt = pts[pts.length - 1];
      /* qa (visual 26): one reading is a point, not an empty grid (the shared chart kit draws it the same way); the main
         series' point is the end mark below */
      if (pts.length === 1) return si ? '<circle cx="' + f(pts[0][0]) + '" cy="' + f(pts[0][1]) + '" r="4" fill="var(--chart-b)"/>' : "";
      var d = curve(pts);
      return (si === 0 ? '<path class="c-area" d="' + d + "L" + f(pts[pts.length - 1][0]) + "," + f(P.t + ih) + "L" + f(pts[0][0]) + "," + f(P.t + ih) + 'Z" fill="url(#' + k + ')"/>' : "") +
        '<path d="' + d + '" fill="none" stroke="' + (si ? "var(--chart-b)" : "var(--chart-a)") + '" stroke-width="' + (si ? 1.75 : 2.5) + '" stroke-linecap="round" stroke-linejoin="round"' +
        (s.dashed ? ' stroke-dasharray="3 5"' : ' class="c-draw"') + "/>";
    }).join("");
    var cursor = '<g class="cc-cur" style="opacity:0"><line y1="' + P.t + '" y2="' + (P.t + ih) + '"/>' + o.series.map(function (s, si) {
      return '<circle r="4.5" data-s="' + si + '" stroke="' + (si ? "var(--chart-b)" : "var(--chart-a)") + '"/>'; }).join("") + "</g>";
    host.innerHTML = '<figure class="cc-fig"><svg class="cc-svg" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" tabindex="0" aria-label="' + esc(o.label) + '">' +
      '<defs><linearGradient id="' + k + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--chart-a)" stop-opacity=".24"/><stop offset="1" stop-color="var(--chart-a)" stop-opacity="0"/></linearGradient></defs>' +
      g + xTicks(n, iw, X, o.labels, H) + marks + (lastPt ? '<circle class="cc-end" cx="' + f(lastPt[0]) + '" cy="' + f(lastPt[1]) + '" r="4"/>' : "") + cursor +
      '</svg><figcaption class="cc-read" aria-live="polite">' + o.summary + "</figcaption></figure>";
    var svg = S2.$("svg", host), cur = S2.$(".cc-cur", svg), read = S2.$(".cc-read", host);
    scrubber(svg, n, X, function (i) {
      var x = f(X(i)), ln = S2.$("line", cur); ln.setAttribute("x1", x); ln.setAttribute("x2", x); cur.style.opacity = "1";
      S2.$$("circle", cur).forEach(function (c) { var val = o.series[+c.dataset.s].values[i]; c.style.display = val == null ? "none" : ""; if (val != null) { c.setAttribute("cx", x); c.setAttribute("cy", f(Y(val))); } });
      read.innerHTML = "<b>" + esc(o.read[i]) + "</b>" + o.series.map(function (s, si) {
        return '<span class="cc-rk"><i class="cc-key ' + (si ? "b" : "a") + '"></i>' + esc(s.name) + ' <b class="num">' + (s.values[i] == null ? "–" : fmt(s.values[i])) + "</b></span>"; }).join("");
    }, function () { cur.style.opacity = "0"; read.innerHTML = o.summary; });
  }

  /* diverging weekly bars: joins above the line, departures below with the "had a club" share against the line.
     One scale for both sides, so a bar's length means the same number of people up or down. */
  function divergeChart(host, o) {
    var W = o.w, H = o.h, P = { l: 2, r: 34, t: 12, b: 26 }, iw = W - P.l - P.r, ih = H - P.t - P.b, n = o.up.length;
    if (!n) { host.innerHTML = empty("No joins or departures recorded yet."); return; }
    var mu = Math.max.apply(null, o.up.concat([1])), md = Math.max.apply(null, o.down.concat([1])), step = niceStep(Math.max(mu, md) / 3);
    var U = Math.ceil(mu / step) * step, Dn = md * 1.08, unit = ih / (U + Dn), z = P.t + U * unit;   /* the smaller side ends at its own peak, so no empty band below */
    var gap = iw / n, bw = Math.max(4, Math.min(22, gap * 0.62)), rx = Math.min(4, bw / 3);
    var X = function (i) { return P.l + i * gap + gap / 2; };
    var g = "";
    for (var v = step; v <= U + 1e-9; v += step) g += '<line class="cc-gl" x1="' + P.l + '" x2="' + (P.l + iw) + '" y1="' + f(z - v * unit) + '" y2="' + f(z - v * unit) + '"/><text class="cc-axis num" x="' + (W - 2) + '" y="' + f(z - v * unit + 4) + '" text-anchor="end">' + fmt(v) + "</text>";
    for (v = step; v <= Dn + 1e-9; v += step) g += '<line class="cc-gl" x1="' + P.l + '" x2="' + (P.l + iw) + '" y1="' + f(z + v * unit) + '" y2="' + f(z + v * unit) + '"/><text class="cc-axis num" x="' + (W - 2) + '" y="' + f(z + v * unit + 4) + '" text-anchor="end">−' + fmt(v) + "</text>";   /* departures are negative: the label says so */
    var bars = "", bands = "";
    for (var i = 0; i < n; i++) {
      var x = X(i) - bw / 2, o1 = "transform-origin:" + f(X(i)) + "px " + f(z) + "px;--d:" + (i * 24) + "ms";
      bands += '<rect class="cc-scrub" data-i="' + i + '" x="' + f(P.l + i * gap) + '" y="' + P.t + '" width="' + f(gap) + '" height="' + ih + '" rx="6"/>';
      if (o.up[i]) bars += '<rect class="c-bar" style="' + o1 + '" x="' + f(x) + '" y="' + f(z - o.up[i] * unit) + '" width="' + f(bw) + '" height="' + f(Math.max(1, o.up[i] * unit)) + '" rx="' + f(rx) + '" fill="var(--chart-a)"/>';
      if (o.down[i]) bars += '<rect class="c-bar" style="' + o1 + '" x="' + f(x) + '" y="' + f(z) + '" width="' + f(bw) + '" height="' + f(Math.max(1, o.down[i] * unit)) + '" rx="' + f(rx) + '" fill="var(--chart-b)"/>';
      if (o.hot[i]) bars += '<rect class="c-bar" style="' + o1 + '" x="' + f(x) + '" y="' + f(z) + '" width="' + f(bw) + '" height="' + f(Math.max(1, o.hot[i] * unit)) + '" rx="' + f(rx) + '" fill="var(--cc-strong)"/>';
    }
    host.innerHTML = '<figure class="cc-fig"><svg class="cc-svg" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" tabindex="0" aria-label="' + esc(o.label) + '">' + bands + g +
      '<line class="cc-zero" x1="' + P.l + '" x2="' + (P.l + iw) + '" y1="' + f(z) + '" y2="' + f(z) + '"/><text class="cc-axis num" x="' + (W - 2) + '" y="' + f(z + 4) + '" text-anchor="end">0</text>' +
      bars + xTicks(n, iw, X, o.labels, H) + '</svg><figcaption class="cc-read" aria-live="polite">' + o.summary + "</figcaption></figure>";
    var svg = S2.$("svg", host), read = S2.$(".cc-read", host), bandEls = S2.$$(".cc-scrub", svg);
    scrubber(svg, n, X, function (i) {
      bandEls.forEach(function (b, j) { b.classList.toggle("on", j === i); });
      read.innerHTML = "<b>" + esc(o.read[i]) + '</b><span class="cc-rk"><i class="cc-key a"></i>Joined <b class="num">' + o.up[i] + '</b></span><span class="cc-rk"><i class="cc-key b"></i>Left <b class="num">' + o.down[i] + "</b>" +
        (o.down[i] ? ' <span class="t-foot">(' + o.hot[i] + " had a club)</span>" : "") + "</span>";
    }, function () { bandEls.forEach(function (b) { b.classList.remove("on"); }); read.innerHTML = o.summary; });
  }

  /* stacked weekly bars: players who had played before, plus first-timers on top, the total above each bar */
  function stackChart(host, o) {
    var W = o.w, H = o.h, P = { l: 2, r: 2, t: 22, b: 26 }, iw = W - P.l - P.r, ih = H - P.t - P.b, n = o.a.length;
    if (!n) { host.innerHTML = empty("No games played yet."); return; }
    var tot = o.a.map(function (v, i) { return v + o.b[i]; }), step = niceStep(Math.max.apply(null, tot) / 3), top = Math.ceil(Math.max.apply(null, tot) / step) * step;
    var gap = iw / n, bw = Math.min(64, gap * 0.56), base = P.t + ih, s = "";
    for (var v = step; v <= top + 1e-9; v += step) s += '<line class="cc-gl" x1="' + P.l + '" x2="' + (P.l + iw) + '" y1="' + f(base - v / top * ih) + '" y2="' + f(base - v / top * ih) + '"/>';
    for (var i = 0; i < n; i++) {
      var x = P.l + i * gap + (gap - bw) / 2, ha = o.a[i] / top * ih, hb = o.b[i] / top * ih, org = "transform-origin:" + f(x + bw / 2) + "px " + f(base) + "px;--d:" + (i * 60) + "ms";
      s += '<g><title>' + esc(o.labels[i] + ": " + tot[i] + " players, " + o.b[i] + " playing their first week") + "</title>" +
        /* the whole bar in the light tint, the returning players drawn over its base: one shape, no seam between segments */
        '<rect class="c-bar cc-light" style="' + org + '" x="' + f(x) + '" y="' + f(base - ha - hb) + '" width="' + f(bw) + '" height="' + f(ha + hb) + '" rx="6"/>' +
        (ha ? '<rect class="c-bar" style="' + org + '" x="' + f(x) + '" y="' + f(base - ha) + '" width="' + f(bw) + '" height="' + f(ha) + '" rx="6" fill="var(--chart-a)"/>' : "") +
        '<text class="cc-val num" x="' + f(x + bw / 2) + '" y="' + f(base - ha - hb - 7) + '" text-anchor="middle">' + tot[i] + "</text>" +
        '<text class="cc-axis" x="' + f(x + bw / 2) + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(o.labels[i]) + "</text></g>";
    }
    host.innerHTML = '<svg class="cc-svg" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(o.label) + '"><line class="cc-zero" x1="' + P.l + '" x2="' + (P.l + iw) + '" y1="' + f(base) + '" y2="' + f(base) + '"/>' + s + "</svg>";
  }

  /* every measured chart on the page, by name; each draws into its host at the host's width */
  var DRAW = {
    members: function (host, w) {
      var C = ctl(), p = st.period, m = C.members.by(p), a = C.accounts.by(p), amap = {}, last = null;
      a.keys.forEach(function (key, i) { amap[key] = a.values[i]; });
      var acc = m.keys.map(function (key) { if (key in amap) last = amap[key]; return last; });   /* carry the running total over days with no new account */
      var n = m.values.length;
      var read = m.labels.map(function (l, i) { return (p === "week" ? "Week of " + l : l) + (p !== "day" && i === n - 1 ? ", so far" : ""); });
      areaChart(host, { w: w, h: w < 520 ? 210 : Math.round(Math.min(300, w * 0.3)), labels: m.labels, read: read, label: "Discord members and site accounts over time, by " + p,
        series: [{ name: "Discord members", values: m.values }, { name: "Site accounts", values: acc, dashed: true }],
        summary: '<span class="cc-rk"><i class="cc-key a"></i>Discord members <b class="num">' + fmt(m.values[n - 1]) + '</b></span><span class="cc-rk"><i class="cc-key b dash"></i>Site accounts <b class="num">' + fmt(acc[n - 1]) +
          '</b></span><span class="t-foot">Drag across the chart to read any ' + p + ".</span>" });
    },
    flow: function (host, w) {
      var j = ctl().joinsDeparts, n = j.joins.length;
      divergeChart(host, { w: w, h: w < 520 ? 230 : Math.round(Math.min(300, w * 0.3)), labels: j.weeks.map(function (k) { return M().etMonthDay(k); }), read: j.labels, up: j.joins, down: j.departs, hot: j.hadClub,
        label: "Weekly joins and departures since July",
        summary: '<span class="cc-rk"><i class="cc-key a"></i>Joined</span><span class="cc-rk"><i class="cc-key b"></i>Left</span>' + (liveRead() ? "" : '<span class="cc-rk"><i class="cc-key hot"></i>Left with a club</span>') + '<span class="t-foot">Drag to read a week.</span>' });
      host.dataset.n = n;
    },
    active: function (host, w) {
      var a = ctl().weeklyActive;
      stackChart(host, { w: w, h: w < 520 ? 190 : 220, labels: a.labels, a: a.players.map(function (v, i) { return v - a.firstTimers[i]; }), b: a.firstTimers, label: liveRead() ? "Players with a game each week" : "Players with a game each week, split into returning players and first-timers" });
    }
  };
  function draw(host, quiet) {
    var w = Math.round(host.clientWidth);
    if (!w) return;
    host.dataset.w = w;
    DRAW[host.dataset.ccDraw](host, w);
    if (quiet) hydrateQuiet(host);
  }
  function drawAll(root, quiet) { S2.$$("[data-cc-draw]", root).forEach(function (h) { draw(h, quiet); }); }
  var resizeRaf = 0;
  window.addEventListener("resize", function () {   /* redraw at the new width, without replaying any entrance */
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = 0;
      tabEdges(S2.$(".cc-tabs-in"));
      S2.$$("#ccPane [data-cc-draw]").forEach(function (h) { if (Math.abs(h.clientWidth - (+h.dataset.w || 0)) > 8) draw(h, true); });
    });
  });

  /* ==================================================================================================== OVERVIEW */
  /* what waits on the Staff Desk, as the desk itself reads it (js/pages/desk.js: S2.deskAttention over its own reads of
     the league office). The desk reads once a visit; this page asks it to when it has not (deskRead), and until it
     answers the column says so, never "clear" */
  function deskState() { return S2._desk ? S2._desk.LV.state : "missing"; }
  function deskNow() { return deskState() === "ready" && S2.deskAttention ? S2.deskAttention() : []; }
  function deskRead(root) {
    var D0 = S2._desk; if (!D0 || D0.LV.state === "ready" || D0.LV.state === "error") return;
    D0.loadAll().then(function () { deskRepaint(root); });
  }
  /* what the desk's reads feed, repainted in place when they land: the attention band, the Staff tab, the tab counts */
  function deskRepaint(root) {
    var pane = root && S2.$("#ccPane", root); if (!pane || !pane.isConnected) return;
    if (pane.dataset.tab === "overview") { var a = S2.$("#ccAttn", pane); if (a) a.outerHTML = attnHtml(); }
    if (pane.dataset.tab === "staff") repaintStaff(root);
    sideCounts(root);
  }
  function attention() {
    var Mm = M(), dl = deadlineCheck(), mine = [];
    if (dl && dl.off) mine.push({ icon: "warn", tone: "warn", label: "Check the Season 2 sign-up deadline", meta: "Sign-ups close " + when(dl.reg) + "; the rule gives " + dl.wantLabel + ", 11:59\u00a0PM ET", act: "step:5" });
    /* qa (visual 18, function 14): one row per club, and only the seats that can be filled now, in the order they are
       filled (Rule 2.6): an Owner comes from an approved owner application, the Owner nominates the GM, and the AGM is
       named after the draft from the club's own roster (RULING 2026-11-23), so before the draft an empty AGM seat is no
       gap. Twenty-four rows of three seats each buried the real work; the tab's count follows this list */
    var preDraft = !Mm.draftDone();   /* the one definition, js/model.js (QA round 2) */
    Mm.teams.forEach(function (t) {
      var r = Mm.roster(t.code); if (!r) return;
      if (!r.seats.Owner) { mine.push({ icon: "people", label: t.full + ": no Owner", meta: "Owners come from the owner applications on the Staff Desk; the Owner then nominates the GM (Rule 2.6).", href: "#/desk?tab=applications" }); return; }
      var open = (r.seats.GM ? [] : ["GM"]).concat(r.seats.AGM || preDraft ? [] : ["AGM"]);
      if (open.length) mine.push({ icon: "people", label: t.full + ": no " + open.join(", no "), act: "club:" + t.code,
        meta: "The Owner nominates " + (open.length > 1 ? "them" : "one") + " in Team HQ's Front office" + (open.indexOf("AGM") >= 0 ? ", the AGM from the club's own roster" : "") + "; you may also seat one in the club editor (Rule 2.6)." });
    });
    steps().filter(function (s) { return s.state === "blocked"; }).forEach(function (s) { mine.push({ icon: "lock", label: s.label + " is blocked", meta: "Season 2 setup, step " + s.step + ". " + detailOf(s), act: "step:" + s.step }); });
    /* Rule 2.3: a trade request is club business, so it is never Staff Desk work and never counts here (the desk's queue
       holds none) */
    var desk = deskNow().map(function (a) {
      var age = a.ageHours ? "About " + Math.round(a.ageHours / 24) + " days old" : null;
      return { icon: a.icon || (a.kind === "application" ? "doc" : a.kind === "import" ? "pulse" : a.kind === "discipline" ? "gavel" : "inbox"), label: a.label, shapes: a.shape && a.display == null ? 1 : 0, shapeLabel: a.label, count: a.shape ? null : a.display,
        meta: [age, a.note].filter(Boolean).join(". "), href: a.href, tone: a.kind === "import" ? "warn" : null };
    });
    return { mine: mine, desk: desk };
  }
  /* the attention band: what only you decide, then the Staff Desk's queue; repainted in place when the desk's reads land */
  function attnHtml() {
    var att = attention(), nm = att.mine.length, nd = att.desk.length, ds = deskState();
    var deskSay = ds === "ready" ? (nd ? "The Staff Desk is carrying " + nd + " more, and any staffer can pick those up." : "The Staff Desk is clear.")
      : ds === "error" ? "The Staff Desk could not be read, so its queue is not shown." : "Reading the Staff Desk.";
    var deskCol = ds === "ready" ? (nd ? att.desk.map(attnRow).join("") : empty("The Staff Desk is clear."))
      : ds === "error" ? S2.empty("err", "The Staff Desk did not load", esc((S2._desk && S2._desk.LV.err) || "The league did not answer.") + " Nothing here can be read as clear.") : empty("Reading the Staff Desk.");
    return '<div id="ccAttn">' + secHead("Needs your attention", nm ? nm + (nm === 1 ? " thing waits" : " things wait") + " on you" : "Nothing waits on you",
        "Decisions only a commissioner makes come first. " + deskSay, arrowLink("#/desk", "Open the Staff Desk")) +
      '<div class="cc-cols cc-attn"><div><h4 class="cc-col-h">Only you</h4><div class="list cc-list">' + (nm ? att.mine.map(attnRow).join("") : empty("Nothing waits on you.")) + "</div></div>" +
      '<div><h4 class="cc-col-h">On the Staff Desk</h4><div class="list cc-list">' + deskCol + "</div></div></div></div>";
  }
  function attnRow(a) {
    var inner = '<span class="cc-ico' + (a.tone ? " " + a.tone : "") + '">' + ic(a.icon) + '</span><span class="grow"><span class="title">' + esc(a.label) + '</span>' + (a.meta ? '<span class="sub">' + esc(a.meta) + "</span>" : "") +
      (a.shapes ? shapes(a.shapes, a.shapeLabel, "cc-shapes-in") : "") + "</span>" +   /* the narrow pane's copy (control.css): one of the two shows */
      (a.shapes ? shapes(a.shapes, a.shapeLabel) : a.count ? '<span class="cc-n num">' + esc(a.count) + "</span>" : "") + S2.chev();
    return a.act ? '<button class="row cc-arow" data-cc-act="' + a.act + '">' + inner + "</button>" : '<a class="row cc-arow" href="' + esc(a.href) + '">' + inner + "</a>";
  }
  function overview(first) {
    var Mm = M(), C = ctl(), s1 = C.season(1), s2 = C.season(2);
    var regular = Mm.games.filter(function (g) { return g.stage === "regular"; }), finals = regular.filter(function (g) { return g.isFinal; }).length;
    var nextNight = Mm.nights({ when: "upcoming" }).slice(-1)[0];   /* nights come newest first: the last upcoming one is the soonest */
    var cur = nextNight ? nextNight.week : null, weeks = [];
    regular.forEach(function (g) { var w = weeks[g.week - 1] || (weeks[g.week - 1] = { w: g.week, n: 0, done: 0 }); w.n++; if (g.isFinal) w.done++; });
    /* qa (function 13): the band is headed by the season on screen, so its playoff line is that season's (it read Season 1's
       and said a past date under "Season 2, regular season") */
    var sv = C.season(Mm.view ? Mm.view.season : 1), po = sv && sv.calendar.filter(function (c) { return c.key === "playoffs_start_at"; })[0], fmtP = sv && sv.playoff;
    var cal = [].concat(s1 ? s1.calendar.map(function (c) { return [1, c]; }) : [], s2 ? s2.calendar.map(function (c) { return [2, c]; }) : [])
      .filter(function (x) { return daysUntil(x[1].at) >= 0; }).sort(function (a, b) { return Date.parse(a[1].at) - Date.parse(b[1].at); }).slice(0, 5);   /* the next five; the rest live in Season setup */
    var dlOff = (deadlineCheck() || {}).off, vs = Mm.view ? Mm.view.season : 1;
    var seasonLine = (cur && nextNight ? "Week " + cur + " of " + weeks.length + " starts " + esc(nextNight.label) + ". " : "") +
      (po ? "The playoffs " + (daysUntil(po.at) < 0 ? "began " : "begin ") + esc(Mm.etLong(po.at)) + ", " + inDays(daysUntil(po.at)).toLowerCase() + (fmtP ? ": " + fmtP.per_div + " clubs per division, " + fmtP.rounds + " rounds, best of " + fmtP.best_of + "." : ".") : "");
    return '<h2 class="sr" id="ccPaneTitle">Overview</h2>' + band("a", attnHtml(), first) +
      band("ink", '<span class="kicker">The league today</span>' + todayHtml() + '<div class="cc-today-go">' +
        arrowLink("#/control?tab=growth", "Growth and retention", "growth") + arrowLink("#/control?tab=system", "System", "system") +
        /* gaps (2026-11-25): the league office reverses or resends a trade from ONE ledger, the Staff Desk's Transactions pane
           (the classic Transactions desk's Trade history), through js/flows.js S2.reverseTrade and S2.resendTrade */
        arrowLink("#/desk?tab=transactions", "Trades: reverse or resend") + "</div>", first) +
      band("w", secHead("Season " + esc(vs) + ", regular season", finals + " of " + regular.length + " games decided", seasonLine, arrowLink("#/control?tab=setup", "Every Season 2 date", "setup")) +
        /* qa (visual): before the schedule is written the column said nothing under its heading */
        '<div class="cc-cols cc-clock"><div><h4 class="cc-col-h">Week by week</h4>' + (weeks.length ? "" : empty("No games are scheduled yet. Season setup writes the schedule (step 8).")) + '<ol class="cc-weeks">' + weeks.map(function (w) {
            var all = w.done === w.n;
            return '<li class="cc-wk' + (w.w === cur ? " cur" : "") + '"><span class="cc-wk-n">Week ' + w.w + '</span><span class="cc-wk-t" aria-hidden="true"><i class="cc-grow" style="width:' + pctOf(w.done, w.n) + '%"></i></span>' +
              '<span class="cc-wk-v num">' + (all ? "All " + w.n : w.done ? w.done + " of " + w.n : w.w === cur && nextNight ? "Starts " + esc(nextNight.short.replace(/^\w+, /, "")) : w.n + " to play") + "</span></li>"; }).join("") + "</ol></div>" +
          '<div><h4 class="cc-col-h">Coming up</h4><ol class="cc-when">' + cal.map(function (x) {
            var c = x[1], md = Mm.etMonthDay(c.at).split(" "), check = x[0] === 2 && c.key === "registration_deadline" && dlOff;
            return '<li><span class="cc-date" aria-hidden="true"><span>' + esc(md[0]) + '</span><b class="d-num">' + esc(md[1]) + '</b></span><span class="grow"><span class="cc-when-t">' + esc(c.label) +
              (check ? ' <span class="chip warn">Check</span>' : "") + '</span><span class="t-foot">Season ' + x[0] + ", " + esc(c.date.replace(/, \d{4}$/, "")) + ", " + esc(c.time) + " ET" + (c.source !== "seasons" ? ", your ruling" : "") + "</span></span>" +
              '<span class="cc-in num">' + inDays(daysUntil(c.at)) + "</span></li>"; }).join("") + "</ol></div></div>", first) +
      band("a", '<div class="cc-cols"><div>' + newsHtml() + "</div><div>" + flagsHtml() + "</div></div>", first) + band("w", awardsHtml(), first) +
      band("a", about([["Needs your attention", "What only you decide is worked out from the Season 2 setup and the club seats; the Staff Desk rows are the desk's own queue (its cases, the applications waiting on your ballot, suspension requests and the games waiting on it), and a group of one is a single mark. Trade requests are left out: they go to the club's front office, not the staff (Rule 2.3)."],
          ["The league today", "Discord members from s2_control() and job health from ops_job_health(), both commissioners only, read when this page opens; Season 2 sign-ups from the league's own sign-up list. A read that is refused is said, never filled in."],
          ["Games and dates", finals + " games decided, forfeits included, and " + (regular.length - finals) + " still to play, from the schedule. Dates come from each season's row in seasons, in Eastern time; the owner decision window is your ruling."]]), first);
  }
  /* the league today is one sentence, not a row of tiles (review 2026-10-19: four unrelated big numbers read as a
     dashboard, and open cases repeated the list above it). The bright words carry the numbers, the rest is quiet. Its own
     block, because the live read feeds it (liveRepaint) */
  function todayHtml() {
    var k = {}, H = jobHealth(); M().control.kpis.forEach(function (x) { k[x.key] = x; });
    /* i3d (review 2026-11-25): the figures are s2_control()'s; until it answers, or when it is refused, the sentence says so
       instead of the model's figures, which are not the league's (M.partial.control) */
    if (!liveRead()) return '<p class="cc-today" id="ccToday">' + (liveErr("control") ? "<b>The membership figures could not be read</b>: the league refused s2_control() (" + esc(liveErr("control")) + ")."
      : "<b>Reading the league's figures.</b>") + "</p>";
    /* the members are s2_control()'s own count, read here and nowhere else (review 2026-11-25: through the model's kpis a
       refused ops_job_health left the model's 0 standing as the league's count); the sign-ups are the league read's */
    return '<p class="cc-today" id="ccToday">' + "<b>" + fmt(st.live.ctl.members.present) + "&nbsp;members</b> on the Discord, <b>" + fmt(k.s2_signups.value) + "&nbsp;signed up</b> for Season 2, and " +   /* a number never wraps away from its noun */
      (liveErr("jobs") ? "<b>the job health could not be read</b>: the league refused ops_job_health() (" + esc(liveErr("jobs")) + ")." : H.missing.length ? "<b>job health could not be read</b>." : H.healthy ? "<b>all&nbsp;" + H.all + "&nbsp;scheduled jobs are healthy</b>." : "<b>" + H.ok + "&nbsp;of&nbsp;" + H.all + "&nbsp;scheduled jobs are healthy</b>.") + "</p>";
  }
  /* ===================================================================================================== TONIGHT */
  /* tonight's slate from the league's own games (S2.M): each fixture, its state as the public game pages print it, and its
     Game desk one press away, under the league clock (the real time, Eastern). gaps (2026-11-25): each game still to be
     decided also shows whether each club has its lineup on file, ported from the classic Schedule desk's "Tonight's
     lineups" (src/live/part_live.js CG.renderLineupReadiness, v2.78), reads only. The classic panel shows no import
     status, and neither does this: the import results and the forfeit door are each game's Game desk's. */
  /* game_lineups for tonight's games (RLS: a commissioner reads them all), read when the tab opens and every 30 seconds
     while it shows, as the classic card repainted; Season 2 asks for a full six by each game's lock (Rule 3.2), the lock
     Team HQ shows (js/pages/hq.js S2._hq.lockOf, Rule 5.3). A failed read is said, never "nobody has filed". */
  var LU = { key: "", at: 0, rows: null, err: null, busy: false }, SIX = ["center", "lw", "rw", "ld", "rd", "goalie"];
  function luGames(N) { return N ? N.rows.filter(function (r) { return r.g.state !== "final" && r.g.state !== "voided"; }) : []; }
  function luKey() { return luGames(night()).map(function (r) { return r.g.id; }).join(); }
  function luRead(pane) {
    var G = luGames(night()); if (!G.length || LU.busy) return;
    var key = luKey();
    LU.busy = true;
    rd(function (c) { return c.from("game_lineups").select("game_id,team_id," + SIX.join(",")).in("game_id", G.map(function (r) { return r.g.id; })); })
      .then(function (rows) { LU = { key: key, at: Date.now(), rows: rows || [], err: null, busy: false }; }, function (e) { LU = { key: key, at: Date.now(), rows: null, err: e.message, busy: false }; })
      .then(function () { luPaint(pane); });
  }
  function luCell(g, code, t) {
    var tm = M().team(code), row = tm && (LU.rows || []).filter(function (x) { return x.game_id === g.id && x.team_id === tm.id; })[0];
    var n = row ? SIX.filter(function (k) { return row[k]; }).length : 0, mins = Math.ceil((S2._hq.lockOf(g).lock - t) / 6e4);
    var say = n === 6 ? "Full six on file" : mins > 0 ? (n ? n + " of six set" : "None filed") + ", " + mins + " min to the lock" : n ? "Locked with " + n + " of six" : "Locked, none filed";
    return '<span class="cc-fx-c"><span class="cc-ts">' + esc(code) + " lineup</span><span>" + (n === 6 ? "" : dot("warn")) + esc(say) + "</span></span>";
  }
  function luHtml(g, t) {
    if (g.state === "final" || g.state === "voided") return "";
    var inner = !LU.at || LU.key !== luKey() ? '<span class="cc-fx-c">Reading the lineups</span>' : LU.err ? '<span class="cc-fx-c">' + esc("The lineups could not be read: " + String(LU.err).replace(/\.$/, "") + ". This is not the same as none filed.") + "</span>" : luCell(g, g.away, t) + luCell(g, g.home, t);
    return '<span class="cc-fx-cs" data-cc-lu="' + esc(g.id) + '">' + inner + "</span>";
  }
  function luPaint(pane) {
    if (!pane || !pane.isConnected || pane.dataset.tab !== "tonight") return;
    var N = night(), t = Date.now();
    luGames(N).forEach(function (r) { var el = S2.$('[data-cc-lu="' + r.g.id + '"]', pane); if (el) el.outerHTML = luHtml(r.g, t); });   /* in place: the fixture, its focus and the scroll stay */
  }
  function night() {
    var today = M().etDay(new Date().toISOString()), n = M().nights().filter(function (x) { return x.date === today; })[0];
    if (!n || !n.games.length) return null;
    return { n: n, rows: n.games.map(function (g) { return { g: g, at: Date.parse(g.at), streaming: !!g.watch }; }) };
  }
  /* a live game's minutes since puck drop, the one figure the league has while it plays */
  function minIn(r, t) { return Math.max(0, Math.floor((t - r.at) / 6e4)) + " min in"; }
  /* the game's state as the public game pages print it (today.js .td-ts): small uppercase text, not chips, and the start
     time as plain text. A live game shows how long it has run and never a score or a period clock: EA sends the result
     only after the final buzzer, so the league never has either while a game is on (review 2026-10-19). */
  function stateLabel(r, t) {
    var g = r.g;
    /* i3d (review 2026-11-25): only an upcoming game shows its start time; past its 30-minute live window with no final it
       reads "Result pending" (M.STATE_LABEL, as the public game pages say it), a voided one "Voided", never a start time */
    return g.state === "live" ? '<span class="cc-ts live"><i class="dot-live" aria-hidden="true"></i>Live</span><span class="cc-ts" data-cc-since="' + esc(g.id) + '">' + minIn(r, t) + "</span>"
      : '<span class="cc-ts">' + esc(g.state === "upcoming" ? g.time : g.label) + "</span>";
  }
  /* one game, a discrete object: the matchup (big condensed numerals once it is final) and its state */
  function fixture(r, t) {
    var g = r.g, score = g.state === "final" && g.hs != null;
    var side = function (code, s, win) { return '<span class="cc-team' + (win ? " win" : "") + '">' + M().crest(code) + '<span class="cc-code">' + esc(code) + "</span>" + (score ? '<b class="d-num">' + s + "</b>" : "") + "</span>"; };
    return '<a class="cc-fx" href="#/desk/game/' + esc(g.id) + '">' +   /* no aria-label: the name is the whole row (score, state, the lineups) */
      '<span class="cc-fx-m">' + side(g.away, g.as, score && g.as > g.hs) + '<span class="cc-at">at</span>' + side(g.home, g.hs, score && g.hs > g.as) + '<span class="cc-fx-s">' + stateLabel(r, t) +
        (r.streaming ? '<span class="cc-ts">On stream</span>' : "") + "</span></span>" + luHtml(g, t) + '<span class="sr">, open in the Game desk</span>' + S2.chev() + "</a>";
  }
  function tonight(first) {
    var N = night(), t = Date.now(), up = M().nights({ when: "upcoming" }).slice(-1)[0];   /* nights come newest first: the last upcoming one is the soonest */
    /* every state M.gameState gives is counted (review 2026-11-25: a game past its live window with no final was counted
       nowhere and its slot read "Up next"); a state with no game is left out of the sentence */
    var counts = { final: 0, live: 0, pending: 0, upcoming: 0, voided: 0 }, done = function (r) { return r.g.state === "final" || r.g.state === "voided"; };
    if (N) N.rows.forEach(function (r) { counts[r.g.state]++; });
    var said = [[counts.final, "final"], [counts.live, "live"], [counts.pending, counts.pending === 1 ? "result pending" : "results pending"], [counts.upcoming, "up next"], [counts.voided, "voided"]]
      .filter(function (x) { return x[0]; }).map(function (x) { return x[0] + " " + x[1]; });
    var line = N ? svAnd(said).replace(/^./, function (c) { return c.toUpperCase(); }) + ". Each game opens its Game desk, where its sittings, result and box score are worked."
      : "No game is scheduled tonight." + (up ? " The next game night is " + esc(up.label) + ", " + up.games.length + " games." : "");
    var slots = N ? N.n.slots.map(function (s) {
      var rows = N.rows.filter(function (r) { return r.g.slot === s.slot; }), say = rows.every(done) ? "Final" : rows.some(function (r) { return r.g.state === "live" || r.g.state === "pending"; }) ? "In progress" : "Up next";
      return '<section class="cc-slot"><h4 class="cc-slot-h"><span class="d-3">' + esc(s.time) + ' ET</span><span class="cc-slot-s">' + say + ", " + rows.length + (rows.length === 1 ? " game" : " games") + "</span></h4>" +
        '<div class="cc-fxs">' + rows.map(function (r) { return fixture(r, t); }).join("") + "</div></section>";
    }).join("") : "";
    /* the clock and the two health lines stand on any night: the poller and the live refresh run every day */
    return '<h2 class="sr" id="ccPaneTitle">Tonight</h2>' + band("w", fixHtml(), first) +
      band("ink", '<div class="cc-night"><div class="copy"><span class="cc-night-k"><span class="kicker">' + (N ? "Game night, week " + N.n.week : "Tonight") + "</span></span>" +
          '<h3 class="d-1">' + (N ? esc(N.n.label) : "No games tonight") + '</h3><p class="cc-night-s">' + line + "</p></div>" +
          '<div class="cc-clockface"><span class="kicker">League time</span><span class="d-num" id="ccClock">' + hms(t) + "</span></div></div>" +
        healthHtml(), first) +
      band("a", slots + about([["The times", "They follow the rules: codes are issued at the first puck drop minus 30 (Rule 4.2), lineups lock at T-30, the EA window opens at T-10, and a club not ready at T+10 forfeits. Game codes never appear here. A live game shows how long it has run, never a score: EA sends the result only after the final buzzer."],
        ["The two health lines", "The EA poller's heartbeat and the live-flush job, from ops_job_health(), read when this page opens."]]), first);
  }
  /* the two health lines, their own block because the live read feeds them (liveRepaint). ops_job_health() returns a
     job's last run, not 24-hour counts, so the live line says when live-flush last ran and how, never "none failed" */
  function healthHtml() {
    /* i3d (review 2026-11-25): until ops_job_health() answers, or when it is refused, the lines say so in the league's
       words; the empty lists would otherwise read "Heartbeat missing" and "Not found", which the league never said */
    if (client() && (!st.live || liveErr("jobs"))) return '<div class="cc-health" id="ccHealth"><p>' + dot("warn") + "<span>" + (st.live ? "<b>The job health could not be read.</b> The league refused ops_job_health() (" + esc(liveErr("jobs")) + "), so the EA poller's heartbeat and the live refresh are unknown."
      : "<b>Reading the job health</b> from ops_job_health().") + "</span></p></div>";
    var J = ctl().jobs, hb = J.heartbeats.filter(function (h) { return h.key === "ea-poll-vm" || h.key === "rl_ea-poll-vm"; })[0], lf = J.cron.filter(function (c) { return c.job === "live-flush"; })[0];
    return '<div class="cc-health" id="ccHealth"><p>' + dot(hb && hb.fresh ? "ok" : "warn") + "<span><b>EA poller on the VM.</b> Heartbeat " + esc(hb ? hb.ago : "missing") + ", reads tonight's games every minute.</span></p>" +
      "<p>" + dot(cronOk(lf) ? "ok" : "warn") + "<span><b>Live refresh (live-flush).</b> " + (!lf ? "Not found" : J.live ? "Every 10 seconds; last ran " + esc(lf.ago) + ", " + esc(lf.last_status) :
        "Every 10 seconds, " + fmt(lf.runs_24h) + " runs in 24 hours, " + (lf.fails_24h ? lf.fails_24h + " failed" : "none failed")) + ".</span></p></div>";
  }
  function startClock(pane) {
    var N = night();
    clearInterval(st.clock);
    luRead(pane);
    st.clock = setInterval(function () {
      if (!pane.isConnected || pane.dataset.tab !== "tonight") { clearInterval(st.clock); return; }
      if (document.hidden) return;
      var t = Date.now(), c = S2.$("#ccClock", pane);
      if (c) c.textContent = hms(t);
      if (N) N.rows.forEach(function (r) { var m = S2.$('[data-cc-since="' + r.g.id + '"]', pane); if (m) m.textContent = minIn(r, t); });   /* text only: the row, its focus and the reader's scroll stay put */
      if (t - LU.at >= 30000) luRead(pane);   /* the lineups again every 30 seconds, as the classic card */
    }, 1000);
  }

  /* ================================================================================================ SEASON SETUP */
  var STATE = { done: ["Done", ""], next: ["Next", "accent"], open: ["Open now", "accent"], todo: ["To do", ""], blocked: ["Blocked", "warn"] };
  /* step details read the Season 2 row as it stands, with one date format (when()), instead of the model's hand-written
     lines, which mixed "Sat Jan 9, 9 PM ET" with "Thu, Jan 7, 2027, 11:59 PM ET" and carried engineering words ("row
     set", "Build owed") into copy (review 2026-10-20). A step with no builder, or a row missing its date, keeps the
     model's line. */
  var DETAIL = {
    settings: function (s2) { var x = s2.settings; return s2.name + ": " + x.weeks + " weeks, " + x.nights_per_week + " nights a week, " + x.roster_max + "-player roster all season, cap " + M().money(x.salary_cap); },
    owners: function () { var a = when(cal2("owner_app_deadline")), b = when(cal2("owners_decided_by")); return a && b && "Applications close " + a + "; owners decided by " + b; },
    clubs: function () { return "After owners are decided; a new franchise waits for your go-ahead"; },
    signups: function () { var a = when(cal2("registration_deadline")); return a && ctl().seasonReturn.signedUp + " signed up so far; sign-ups close " + a; },
    draft: function () { var a = when(cal2("draft_at")); return a && a + ", " + M().RULES.s2.draftRounds + " rounds"; },
    /* the pool, waivers and bid nights are live since v4.59 (#/camp, #/bidding, Team HQ's bid board) */
    /* gaps (2026-11-25): the pool forms at the draft and is requested one game at a time (Rule S2.5), as model.js says it */
    pool: function () { var b = bidNightsHeld()[0]; return "The training camp pool forms at the draft, requested one game at a time; waivers after the draft; Saturday bidding" + (b ? " from " + b.short + ", 9 PM ET" : ""); },
    playoffs: function () {
      var r = poRounds();
      return r >= 3 ? "Every round drawn" : (r ? "Round " + r + " of 3 drawn" : "Draws itself from the final table") + (poPaused() ? "; automatic draw paused" : "");
    },
    schedule: function () { var a = when(cal2("starts_at")); return a && "Generate once the clubs are seated; puck drop " + a; }
  };
  function steps() {
    var s2 = ctl().season(2);
    return ctl().setup.map(function (s0) {
      var s = copy(s0), d = s2 && DETAIL[s.key] && DETAIL[s.key](s2);
      if (d) s.detail = d;
      /* the standing order, from the row: holidays are set once skip_holidays is not NULL ([] is "skip nothing"), and the
         schedule step blocks until then */
      if (s.key === "holidays") {
        var hr = seasonRow(SETUP_N), hs = holidaysSet(SETUP_N);
        s.state = hs ? "done" : "next";
        s.detail = !hr ? "No season row" : !hs ? "Not set yet; the schedule waits on them" : hr.skip_holidays.length ? hr.skip_holidays.length + (hr.skip_holidays.length === 1 ? " holiday" : " holidays") + " skipped; the step lists them" : "Set: no holiday is skipped";
      }
      if (s.key === "schedule") {
        var sg = regularOf(SETUP_N), first = sg.slice().sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); })[0];
        s.state = sg.length ? "done" : holidaysSet(SETUP_N) ? "todo" : "blocked";
        s.detail = sg.length ? sg.length + " games, from " + M().etFull(first.at).replace(/, \d{4}$/, "") : holidaysSet(SETUP_N) ? s.detail : "Blocked until the holidays are set";
      }
      if (s.key === "playoffs" && poRounds() >= 3) s.state = "done";
      if (s.key === "pool" && s.state === "blocked") s.state = "todo";   /* the market's backend is live (v4.59); the model's step predates it */
      return s;
    });
  }
  function setupHead() {   /* the tab's headline: progress and what comes next, repainted by the holiday what-if */
    var ss = steps(), nx = ss.filter(function (s) { return s.state === "next"; })[0];
    return ss.filter(function (s) { return s.state === "done"; }).length + " of " + ss.length + " steps done" + (nx ? ", " + nx.label.toLowerCase() + " next" : "");
  }
  function stepperHtml() {
    var ss = steps(), done = ss.filter(function (s) { return s.state === "done"; }).length;
    return '<div class="cc-stepper" id="ccStepper">' + lead("Ten steps, in order", "Open any step to work on it. A step that waits on another stays blocked until that one is done.",
        '<div class="cc-prog" role="img" aria-label="' + done + " of " + ss.length + ' steps done">' + ss.map(function (s) { return '<i class="is-' + s.state + '"></i>'; }).join("") + "</div>") +
      '<ol class="cc-steps">' + ss.map(function (s) {
        var lab = STATE[s.state] || STATE.todo, gate = s.gate ? (s.state === "blocked" ? "Waits on step 2, Holidays" : "Unlocked: step 2, Holidays, is done") : "";
        return '<li class="cc-step is-' + s.state + '"><button class="cc-step-b" data-cc-step="' + s.step + '"><span class="sr">Step ' + s.step + ', </span><span class="cc-node" aria-hidden="true">' +
          (s.state === "done" ? S2.ic("check") : s.state === "blocked" ? LOCK : s.step) + '</span><span class="grow"><span class="cc-step-t">' + esc(s.label) + '</span><span class="cc-step-d">' + esc(detailOf(s)) + "</span>" +
          (gate ? '<span class="cc-gate">' + (s.state === "blocked" ? LOCK : S2.ic("link", "cc-ic")) + esc(gate) + "</span>" : "") + '</span><span class="chip ' + lab[1] + '">' + lab[0] + "</span>" + S2.chev() + "</button></li>";
      }).join("") + "</ol></div>";
  }
  function setup(first) {
    var Mm = M(), s2 = ctl().season(2);
    if (!s2) return '<h2 class="sr" id="ccPaneTitle">Season setup</h2>' + band("a", secHead("Season 2", "No Season 2 row yet", "Start with New season in step 1."), first);
    var cal = {}; s2.calendar.forEach(function (c) { cal[c.key] = c; });
    var long = function (c) { return c ? esc(Mm.etLong(c.at)) : ""; };
    var key = [["owner_app_deadline", "Owner applications close"], ["owners_decided_by", "Owners decided by"], ["draft_at", "Draft"], ["starts_at", "Puck drop"]].filter(function (x) { return cal[x[0]]; });
    var line = (cal.owner_app_deadline ? "Owner applications close " + long(cal.owner_app_deadline) + (cal.owners_decided_by ? " and you decide by " + long(cal.owners_decided_by) : "") + ". " : "") +
      (cal.draft_at ? "The draft is " + long(cal.draft_at) + (cal.starts_at ? ", and the puck drops " + long(cal.starts_at) : "") + ". " : "") + ctl().seasonReturn.signedUp + " people have signed up so far.";
    return '<h2 class="sr" id="ccPaneTitle">Season setup</h2>' +
      band("a", secHead("Season 2, " + esc(s2.format === "basic" ? "basic format" : s2.format), setupHead(), line, null, "ccSetupHead") +
        '<ol class="cc-dates">' + key.map(function (x) {
          var c = cal[x[0]], md = Mm.etMonthDay(c.at);
          return '<li><span class="cc-dates-l">' + esc(x[1]) + '</span><b class="d-num">' + esc(md) + '</b><span class="t-foot">' + esc(c.time) + " ET" + (c.source !== "seasons" ? ", your ruling" : "") + ", " + inDays(daysUntil(c.at)).toLowerCase() + "</span></li>";
        }).join("") + "</ol>", first) +
      band("w", stepperHtml(), first) + band("a", (svOn() ? svHtml() : "") + schedHtml() + about([["Dates", "From the Season 2 row in seasons, in Eastern time. Edit settings in step 1 changes them. The owner decision window is your ruling."],
        ["Step states", "Worked out from the season and your recorded rulings. Basic format only: no full-format step appears. Step 8 shows the standing order at work: no schedule before the holidays are set."],
        ["The schedule", "Built by the league's own schedule generator, the current site's, copied unchanged: one round per time slot, every club once in it, the circle rotation so no pair meets twice in a night, from the puck-drop week, and a week holding a skipped holiday stepped over. The regular season then ends that week's last night and the playoffs open the next game week. What it builds is shown before anything is written, and the games on show here are the league's own."]].concat(svOn() ? [
        [S2.SURVEY_NAME, "Every finished survey, from season_survey_results(), commissioners only. Anonymous: a response holds its answers and whether it came from the daily pop-up or the sign-up, never who gave it. Counted from the survey's own questions and X-Factor list, so only a choice it offered is counted; percentages are of the members who answered that question. The survey closes when Season 2 sign-ups close."]] : [])),
        first, svOn() || regularOf(SETUP_N).length ? "" : "cc-tail");
  }

  /* ---------- the Season 2 survey: what members said (anonymous) ----------
     Commissioner, 2026-10-20: "I do not need to see names but I would like to see answer statistics in the control center
     somewhere." The answers inform this tab's settings (nights a week, position locks, the X-Factor bans of Rule 4.5), so
     they sit here, under the stepper, as the live site keeps them under Control Center > Seasons (v4.23). Counted by
     S2.survey.tally from the survey's one question set and X-Factor list (js/survey.js), so this view can only name a choice
     the survey offered. The rows: season_survey_results(), the league's every finished survey (i3d, 2026-11-25: the
     concept counted this browser's answers and a made-up set). The tier switch and Show all repaint this section in place
     (svPaint), never the page. */
  var SV_SHOW = 5;   /* written answers shown per question before Show all */
  function svOn() { return !!(S2.survey && S2.SURVEY_ON); }
  /* the league's answers, turned back into this survey's shape (S2.survey.fromLive) and counted by its one tally */
  function svTally() { return S2.survey.tally(st.sv && st.sv.rows ? st.sv.rows : []); }
  function loadSurvey(root, again) {
    if (st.sv && (st.sv.busy || (!again && !st.sv.err))) return;
    st.sv = { busy: true, rows: null, err: null };
    rd(function (c) { return c.rpc("season_survey_results", { p_survey: S2.survey.KEY }); }).then(function (d) {
      if (!d || !Array.isArray(d.responses)) throw new Error("the league sent no list of answers");
      st.sv = { busy: false, err: null, rows: d.responses.map(function (r) { return { answers: S2.survey.fromLive(r.answers), from: r.source }; }) };
    }).catch(function (e) { st.sv = { busy: false, rows: null, err: String((e && e.message) || "the league refused").replace(/^.*SURVEY:\s*/, "") }; })
      .then(function () { svPaint(root); });
  }
  function svPart(t, k) { return t.parts.filter(function (p) { return p.k === k; })[0]; }
  function svOf(n, d) { return n + " of " + d + " (" + pctOf(n, d) + "%)"; }
  /* one bar per choice, filled against the members who answered the question; label is html (escaped here) */
  function svBars(p, s, order) {
    var idx = p.choices.map(function (c, i) { return i; });
    if (order) idx.sort(function (a, b) { return s.votes[p.choices[b]] - s.votes[p.choices[a]] || a - b; });
    return idx.map(function (i) {
      var c = p.choices[i], n = s.votes[c];
      /* a zero draws an empty track: hbar floors any bar at 1.5%, which read as a vote (review 2026-10-20) */
      return hbar(esc(p.labels[i]) + (p.kind === "xf" && S2.survey.bannedNow(c, p.tier) ? ' <span class="chip">Banned now</span>' : ""), n, n ? s.answered : 0, { note: pctOf(n, s.answered) + "%" });
    }).join("");
  }
  /* the leading choice, said as an escaped sentence ("Bring back position locks leads: 24 of 41 (59%)."); form(label, of)
     words it for its question */
  /* "a and b", "a, b, and c": every choice that shares the top count is named (review 2026-10-20: a three-way tie at Blue
     named two) */
  function svAnd(a) { return a.length < 3 ? a.join(" and ") : a.slice(0, -1).join(", ") + ", and " + a[a.length - 1]; }
  function svTop(p, s, form) {
    var best = p.choices.map(function (c, i) { return [esc(p.labels[i]), s.votes[c]]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (!best[0][1]) return "";
    var tops = best.filter(function (b) { return b[1] === best[0][1]; });
    if (tops.length > 1) return "A tie at the top: " + svAnd(tops.map(function (b) { return b[0]; })) + ", " + best[0][1] + " each.";
    return (form || function (l, of) { return l + " leads: " + of; })(best[0][0], svOf(best[0][1], s.answered)) + ".";
  }
  function svOdd(s) { return s.odd ? " " + s.odd + (s.odd === 1 ? " answer named a choice the survey does not offer, so it is" : " answers named choices the survey does not offer, so they are") + " not counted." : ""; }
  var SV_NOBODY = "No one has answered this yet.";
  function svXf(t) {
    var p = svPart(t, st.svTier), s = t.q[st.svTier], T = S2.survey.TIERS[st.svTier];
    var by = p.choices.slice().sort(function (a, b) { return s.votes[b] - s.votes[a]; }), top = by[0];
    var tops = by.filter(function (n) { return s.votes[n] === s.votes[top]; }), tie = tops.length > 1;
    return {
      say: !s.answered ? "No one has answered for " + T[0] + " yet." : (s.votes[top] ? "At " + T[0] + " (" + T[1] + "), " + (tie ? svAnd(tops.map(esc)) + " tie for the most ban votes, " + s.votes[top] + " each. " :
        esc(top) + " draws the most ban votes: " + svOf(s.votes[top], s.answered) + ". ") : "At " + T[0] + ", no X-Factor drew a ban vote. ") +
        s.none + (s.none === 1 ? " member" : " members") + " voted None." + svOdd(s),
      bars: s.answered ? svBars(p, s, true) : empty(SV_NOBODY) };
  }
  function svList(t, k) {
    var s = t.q[k], all = !!st.svAll[k], show = all ? s.texts : s.texts.slice(0, SV_SHOW);
    return '<div class="cc-sv-said-c" data-cc-svlist="' + k + '"><span class="cc-col-h">' + esc(svPart(t, k).q.t) + ' <span class="cc-count num">' + s.texts.length + "</span></span>" +
      (s.texts.length ? '<ol class="cc-sv-q">' + show.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>" +
        (s.texts.length > SV_SHOW ? '<button class="btn plain sm cc-sv-more" data-cc-svall="' + k + '" aria-expanded="' + all + '">' + (all ? "Show the first " + SV_SHOW : "Show all " + s.texts.length) + "</button>" : "")
        : '<p class="t-foot cc-sv-none">No written answers yet.</p>') + "</div>";
  }
  function svHtml() {
    var open = S2.survey.signupOpen(), dl = cal2("registration_deadline"), R = st.sv;
    var close = dl ? (open ? " The survey closes with sign-ups, " + when(dl) + "." : " Sign-ups closed " + when(dl) + ", and the survey with them.") : "";
    var kick = '<span class="cc-sv-k"><span class="kicker">' + esc(S2.SURVEY_NAME) + "</span></span>";
    /* the answers are season_survey_results(), the commissioner's read (v4.23): until it answers the section says so, and a
       refusal is said in the league's words with Try again, never an empty tally */
    if (!R || R.busy || R.err) return '<div class="cc-sv" id="ccSv"><header class="sec-head cc-sec"><div class="copy">' + kick + '<h3 class="d-2" id="ccSvHead">' + (R && R.err ? "The answers could not be read" : "Reading the answers") + "</h3></div></header>" +
      (R && R.err ? S2.empty("err", "The survey answers did not load", esc(R.err) + " Nothing here can be read as no answers.", '<button class="btn secondary sm" data-cc-svretry>Try again</button>') : "") + "</div>";
    var t = svTally();
    var head = '<header class="sec-head cc-sec"><div class="copy">' + kick +
      '<h3 class="d-2" id="ccSvHead">' + (t.count ? t.count + (t.count === 1 ? " answer" : " answers") + " so far" : "No answers yet") + "</h3><p>" +
      (t.count ? (t.daily === t.count ? (t.count === 1 ? "It came" : "All came") + " from the daily pop-up." : t.signup === t.count ? (t.count === 1 ? "It came" : "All came") + " from the sign-up." :
        t.daily + " came from the daily pop-up and " + t.signup + " from the sign-up.") + " Anonymous: answers only, never who gave them." :
        "Members meet the survey on the day's first visit and before the Season 2 sign-up. Each finished survey lands here, without a name.") + close + "</p></div></header>";
    if (!t.count) return '<div class="cc-sv" id="ccSv">' + head + empty("No one has finished the survey yet.") + "</div>";
    var lk = svPart(t, "locks"), ni = svPart(t, "nights"), pw = svPart(t, "perWeek"), sL = t.q.locks, sN = t.q.nights, sW = t.q.perWeek, x = svXf(t);
    var tiers = ["gold", "blue", "red"].map(function (k) { return '<button data-v="' + k + '" aria-pressed="' + (st.svTier === k) + '">' + esc(S2.survey.TIERS[k][0]) + "</button>"; }).join("");
    return '<div class="cc-sv" id="ccSv">' + head +
      /* in the survey's order; on a wide pane nights a week sits under position locks, beside the taller nights list */
      '<div class="cc-block cc-sv-top">' +
        '<div class="cc-sv-a">' + lead(esc(lk.q.t), sL.answered ? svTop(lk, sL) + svOdd(sL) : SV_NOBODY) + (sL.answered ? '<div class="cc-funnel">' + svBars(lk, sL) + "</div>" : "") + "</div>" +
        '<div class="cc-sv-b">' + lead(esc(ni.q.t), sN.answered ? svTop(ni, sN, function (l, of) { return l + " is the night most can play: " + of; }) + svOdd(sN) : SV_NOBODY) + (sN.answered ? '<div class="cc-funnel">' + svBars(ni, sN) + "</div>" : "") + "</div>" +
        '<div class="cc-sv-c">' + lead(esc(pw.t), sW.answered ? svTop(pw, sW, function (l, of) { return "The most asked for is " + l + " a week: " + of; }) + svOdd(sW) : SV_NOBODY) + (sW.answered ? '<div class="cc-funnel">' + svBars(pw, sW) + "</div>" : "") + "</div>" +
      "</div>" +
      '<div class="cc-block">' + lead("X-Factor bans", x.say, '<div class="seg cc-seg" id="ccSvTier" role="group" aria-label="X-Factor tier">' + tiers + "</div>", "ccSvXfH") +
        '<div class="cc-sv-xf" id="ccSvXf">' + x.bars + "</div></div>" +
      '<div class="cc-block">' + lead("In their own words", "The written answers, as members typed them, newest first. No names.") +
        '<div class="cc-sv-said">' + t.parts.filter(function (p) { return p.kind === "text"; }).map(function (p) { return svList(t, p.k); }).join("") + "</div></div>" +
      "</div>";
  }
  /* the section repaints itself in place: same scroll, focus handed to the replacement of the control that had it */
  function svPaint(root) {
    var el = root && S2.$("#ccSv", root); if (!el) return;
    var a = document.activeElement, hook = null;
    if (a && el.contains(a)) [].slice.call(a.attributes).forEach(function (at) { if (!hook && /^data-cc-sv/.test(at.name)) hook = "[" + at.name + '="' + CSS.escape(at.value) + '"]'; });
    el.outerHTML = svHtml();
    bindSv(root);
    var b = hook && S2.$(hook, root); if (b) b.focus({ preventScroll: true });
  }
  function bindSv(root) {
    var el = S2.$("#ccSv", root); if (!el) return;
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cc-svretry], [data-cc-svall]"); if (!b) return;
      e.preventDefault();
      if (b.hasAttribute("data-cc-svretry")) { b.disabled = true; b.setAttribute("aria-busy", "true"); loadSurvey(root, true); return; }
      var k = b.dataset.ccSvall; st.svAll[k] = !st.svAll[k];
      var c = S2.$('[data-cc-svlist="' + k + '"]', el); if (c) c.outerHTML = svList(svTally(), k);
      var nb = S2.$('[data-cc-svall="' + k + '"]', el); if (nb) nb.focus({ preventScroll: true });
    });
    var seg = S2.$("#ccSvTier", el);
    if (seg) S2.segmented(seg, function (v) {
      st.svTier = v;
      var x = svXf(svTally()), host = S2.$("#ccSvXf", el), say = S2.$("#ccSvXfHS", el);
      host.innerHTML = x.bars; if (say) say.innerHTML = x.say;
      if (!S2.reduce.matches) host.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });   /* the period switch's cross-fade */
    });
  }
  /* a survey finished on this page's tab is the league's once it is filed: the section reads the answers again, in place */
  document.addEventListener("s2:survey", function () { var root = S2.$("#page"); if (root && S2.$("#ccSv", root)) loadSurvey(root, true); });
  /* ================================================================ THE SCHEDULE GENERATOR
     S2 swap (g3, 2026-11-24): the classic generator itself, not a rewrite. CG.generateSchedule is copied byte for byte from
     src/live/part_live.js into js/cg-engine.js (tools/s2-engine-build.cjs) with the season shape, the holiday calendar and
     the week planner it reads, and runs here against a RECORDER: its confirm, its toasts and its two writes (the games rows,
     then ends_at and playoffs_start_at on the season row) are captured instead of sent, as tools/season-games.cjs does
     offline. The commissioner sees those rows a week at a time, and only Generate writes them, through S2.write: the same
     rows in ONE insert (one statement, so a refusal leaves no partial schedule, where the classic's chunks of 100 could),
     then the season patch. tools/schedule-port-g3.test.cjs runs this and the classic on Season 1's real settings and
     requires the same rows. Standing order (2026-09-15): no schedule before that season's holidays are set. skip_holidays
     NULL means never set (the classic would read it as the defaults), so this refuses before the generator runs. Every
     season is the basic format, so there is no pre-season stage here. */
  var GEN_OWN = ["SEASON", "TEAMS", "TEAM", "lg", "confirm", "toast", "assertCommissioner", "sb", "reloadLeague"];
  /* a thenable that answers at once, so the classic's promise chain (assertCommissioner, each insert, the season update)
     runs to its last toast inside one call, and S2.CG is handed back before anything else can read it */
  function at0(v) { return { then: function (ok) { ok(v); return { "catch": function () {} }; } }; }
  function undash(s) { return String(s).replace(/\s*—\s*/g, ": "); }   /* the classic's toasts predate the no-dash rule */
  /* season: the seasons row; teams: [{id, code, division}]; games: the season's games ({stage}).
     -> {rows, patch: {set, match}, ask: the classic confirm {title, body, label}, said: its toasts, refused, plan, shape} */
  function genRun(season, teams, games) {
    var CG = S2.CG, keep = {}, out = { rows: [], patch: null, ask: null, said: [], refused: null, plan: null, shape: null };
    if (!CG || typeof CG.generateSchedule !== "function") throw new Error("js/cg-engine.js has no CG.generateSchedule (node tools/s2-engine-build.cjs)");
    var reg = teams.map(function (t) { return { id: t.id, code: t.code, div: t.division || t.div || "East" }; })
      .sort(function (a, b) { return (a.div === b.div ? 0 : (a.div < b.div ? -1 : 1)) || (a.code < b.code ? -1 : 1); });   /* CG.TEAMS's own order (buildLiveLeague, part_live.js) */
    var lg = { schedule: games.map(function (g) { return { stage: g.stage }; }), _codeToId: {} };
    reg.forEach(function (t) { lg._codeToId[t.code] = t.id; });
    GEN_OWN.forEach(function (k) { keep[k] = CG[k]; });
    try {
      CG.SEASON = season; CG.TEAMS = reg; CG.TEAM = {}; reg.forEach(function (t) { CG.TEAM[t.code] = t; }); CG.lg = lg;
      CG.confirm = function (title, body, label, fn) { out.ask = { title: title, body: body, label: label }; fn(); };
      CG.toast = function (msg, kind) { out.said.push({ msg: String(msg), kind: kind || "info" }); };
      CG.assertCommissioner = function () { return at0(null); };
      CG.reloadLeague = function () {};
      CG.sb = { rpc: function (n) { throw new Error("the classic generator called " + n + ", which the recorder does not answer"); },
        from: function (table) {
          if (table === "games") return { insert: function (rows) { out.rows = out.rows.concat(rows); return at0({ data: null, error: null }); } };
          if (table === "seasons") return { update: function (set) { return { eq: function (col, val) { return { select: function () {
            var match = {}; match[col] = val; out.patch = { set: set, match: match }; return at0({ data: [{ id: val }], error: null }); } }; } }; } };
          throw new Error("the classic generator reached for " + table + ", which the recorder does not answer");
        } };
      CG.generateSchedule("regular");
      /* the week plan it built, recomputed the way tools/season-games.cjs planFor does (internal to the generator, deterministic) */
      if (season && season.starts_at) {
        var sh = out.shape = CG.seasonShape(season);
        out.plan = CG.gameNights(CG.etYMD(season.starts_at), Math.ceil(sh.perClub / sh.perNight / sh.nights), sh.nights, CG.seasonHolidayKeys(season));
      }
    } finally { GEN_OWN.forEach(function (k) { CG[k] = keep[k]; }); }
    var bad = out.said.filter(function (x) { return x.kind === "err"; })[0];
    if (bad) out.refused = undash(bad.msg);
    else if (!out.rows.length || !out.patch) out.refused = "The generator built no schedule and gave no reason. Nothing was written.";
    if (out.refused) { out.rows = []; out.patch = null; }
    return out;
  }
  /* the league's read client (js/live.js S2.ensureSb, live mode only), the page's test for whether it can read the league
     at all. Without one the page reads the model and every write is refused by S2.write. Every read goes through S2.rd
     (js/live.js), the one read door (QA round 2, A10: this kept the same ten lines as gamedesk.js), so an empty answer
     always means the league answered empty */
  function client() { return S2.ensureSb ? S2.ensureSb() : null; }
  function rd(q) { return S2.rd(q); }
  /* what the generator reads: fresh from the league when there is a read client (two tabs must never both see "no schedule
     yet"), else the model's (the fixture: the preview works, and S2.write refuses the write) */
  function genInputs(n) {
    var row = seasonRow(n);
    if (!row) return Promise.reject(new Error("There is no Season " + n + " row to build a schedule for."));
    if (!client()) return Promise.resolve({ season: row, teams: M().teams.map(function (t) { return { id: t.id || null, code: t.code, division: t.division }; }),
      games: M().view && M().view.season === n ? M().games : [] });
    return Promise.all([
      rd(function (c) { return c.from("seasons").select("*").eq("id", row.id).maybeSingle(); }),
      rd(function (c) { return c.from("teams").select("id,code,division"); }),
      rd(function (c) { return c.from("games").select("id,stage").eq("season_id", row.id).eq("stage", "regular").limit(1); })
    ]).then(function (r) {
      if (!r[0]) throw new Error("Season " + n + " was not found in the league. Reload the page.");
      if (!r[1] || !r[1].length) throw new Error("The league returned no clubs, so there is nothing to schedule.");
      return { season: r[0], teams: r[1], games: r[2] || [] };
    });
  }
  /* the season row as the model has it, with any change the league has confirmed since the model was built (a write's
     own answer, kept only until the next league read replaces the model) */
  function seasonRow(n) {
    var s = ctl().season(n); if (!s) return null;
    var o = st.confirmed[s.settings.id];
    return o && o.gen === M().generated ? Object.assign({}, s.settings, o.row) : s.settings;
  }
  function confirmRow(row) {   /* row: the seasons row fields a write returned */
    if (!row || !row.id) return;
    var o = st.confirmed[row.id], same = o && o.gen === M().generated;
    st.confirmed[row.id] = { gen: M().generated, row: Object.assign(same ? o.row : {}, row) };
  }
  function holidaysSet(n) { var r = seasonRow(n); return !!r && r.skip_holidays != null; }
  /* the regular season on the ice for season n: the model's games when it is the season on screen, else what this page
     wrote and the league confirmed */
  function regularOf(n) {
    var row = seasonRow(n), w = row && st.written[row.id];
    if (M().view && M().view.season === n) { var g = M().games.filter(function (x) { return x.stage === "regular"; }); if (g.length || !w || w.gen !== M().generated) return g; }
    return w && w.gen === M().generated ? w.games : [];
  }

  /* a schedule a week at a time. list: [{week, at, home, away}] (club codes) */
  function schedOf(list) {
    var byWeek = {}, weeks = [];
    list.slice().sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); }).forEach(function (g) {
      var w = byWeek[g.week]; if (!w) { w = byWeek[g.week] = { week: g.week, nights: [], byDay: {} }; weeks.push(w); }
      var day = dayKey(g.at), n = w.byDay[day]; if (!n) { n = w.byDay[day] = { day: day, at: g.at, slots: [], byAt: {} }; w.nights.push(n); }
      var sl = n.byAt[g.at]; if (!sl) { sl = n.byAt[g.at] = { label: hm(g.at), games: [] }; n.slots.push(sl); }
      sl.games.push(g);
    });
    weeks.sort(function (a, b) { return a.week - b.week; });
    return { weeks: weeks, games: list.length };
  }
  function schedWeekHtml(w) {
    return '<div class="cc-sched-wk" id="ccSchedGrid">' + w.nights.map(function (n) {
      return '<section class="cc-sn"><h4 class="cc-sn-h">' + esc(M().etFull(n.at).replace(/, \d{4}$/, "")) + "</h4>" + n.slots.map(function (sl) {
        return '<div class="cc-ss"><span class="cc-k">' + esc(sl.label) + ' ET</span><ul class="cc-sg">' + sl.games.map(function (g) {
          return '<li><span class="cc-team">' + M().crest(g.away) + '<span class="cc-code">' + esc(g.away) + '</span></span><span class="cc-at">at</span><span class="cc-team">' + M().crest(g.home) + '<span class="cc-code">' + esc(g.home) + "</span></span></li>";
        }).join("") + "</ul></div>";
      }).join("") + "</section>";
    }).join("") + "</div>";
  }
  function weekLabel(w) { return "Week " + w.week + ", " + M().etFull(w.nights[0].at).replace(/, \d{4}$/, "") + " to " + M().etFull(w.nights[w.nights.length - 1].at).replace(/, \d{4}$/, "").replace(/^\w+, /, ""); }
  function weekPicker(S, cur) {
    return '<div class="cc-sched-bar"><div class="seg cc-seg" data-cc-schedweek role="group" aria-label="Week">' + S.weeks.map(function (x) { return '<button data-v="' + x.week + '" aria-pressed="' + (x.week === cur.week) + '" aria-label="Week ' + x.week + '">' + x.week + "</button>"; }).join("") + "</div>" +
      '<p class="t-foot" data-cc-schedwk>' + esc(weekLabel(cur)) + "</p></div>";
  }
  /* the week picker repaints only the grid and its label, in place; the picker keeps focus */
  function bindWeeks(host, S) {
    var seg = S2.$("[data-cc-schedweek]", host);
    if (seg) S2.segmented(seg, function (v) {
      var w = S.weeks.filter(function (x) { return x.week === +v; })[0]; if (!w) return;
      st.schedWeek = w.week;
      var g = S2.$("#ccSchedGrid", host), l = S2.$("[data-cc-schedwk]", host);
      if (g) g.outerHTML = schedWeekHtml(w);
      if (l) l.textContent = weekLabel(w);
    });
  }
  /* the season's schedule under the stepper, from the league's own games (never from what was typed) */
  function schedHtml() {
    var games = regularOf(SETUP_N); if (!games.length) return "";
    var S = schedOf(games), w = S.weeks.filter(function (x) { return x.week === st.schedWeek; })[0] || S.weeks[0], last = S.weeks[S.weeks.length - 1], row = seasonRow(SETUP_N);
    var per = {}; games.forEach(function (g) { per[g.home] = (per[g.home] || 0) + 1; per[g.away] = (per[g.away] || 0) + 1; });
    var counts = Object.keys(per).map(function (k) { return per[k]; }), even = counts.every(function (c) { return c === counts[0]; });
    return '<div class="cc-sched" id="ccSched">' + secHead(esc(row.name || "Season " + SETUP_N) + " schedule", S.games + " games over " + S.weeks.length + " weeks",
        (even ? counts[0] + " games a club. " : "Games a club: " + esc(Object.keys(per).sort().map(function (k) { return k + " " + per[k]; }).join(", ")) + ". ") +
        "The regular season ends " + esc(M().etFull(last.nights[last.nights.length - 1].at).replace(/, \d{4}$/, "")) + (row.playoffs_start_at ? " and the playoffs begin " + esc(M().etFull(row.playoffs_start_at).replace(/, \d{4}$/, "")) : "") + ".",
        '<button class="btn secondary sm" data-cc-sclear>Clear the schedule</button>') +
      weekPicker(S, w) + schedWeekHtml(w) + "</div>";
  }
  function bindSched(root) {
    var host = S2.$("#ccSched", root); if (!host) return;
    bindWeeks(host, schedOf(regularOf(SETUP_N)));
    var c = S2.$("[data-cc-sclear]", host); if (c) c.addEventListener("click", function () { clearSchedule(root); });
  }
  /* the refusal sheet: the generator's or the league's own words, kept on screen until read */
  function refusal(title, msg, refocus) {
    var sh = sheet({ title: title, html: '<p class="fl-err" role="alert">' + esc(msg) + '</p><div class="cc-sh-acts"><button class="btn secondary" data-cc-x>Close</button></div>' }, refocus);
    S2.$("[data-cc-x]", sh.el).addEventListener("click", function () { sh.close(); });
    return sh;
  }
  /* Generate: read, refuse or preview, then write exactly the previewed rows */
  function generateSchedule(root) {
    var n = SETUP_N, back = function () { return S2.$('[data-cc-step="8"]', root); };
    if (st.busy.gen) return;
    st.busy.gen = true;
    genInputs(n).then(function (inp) {
      var gate = holidayGate(inp.season);
      if (gate) return refusal("Set the holidays first", gate, back);
      var out = genRun(inp.season, inp.teams, inp.games);
      if (out.refused) return refusal("Nothing was generated", out.refused, back);
      genPreview(root, n, inp, out);
    }).catch(function (e) { refusal("Nothing was generated", e.message, back); }).then(function () { st.busy.gen = false; });
  }
  /* the standing order's gate, before the generator runs: null when the season's holidays are set */
  function holidayGate(season) {
    return season.skip_holidays != null ? null : "Standing order: a season's schedule is never generated before its holidays are set. " + (season.name || "This season") +
      "'s holidays have never been set, so the generator would skip the default weeks without your say. Set them in step 2, Holidays, then generate.";
  }
  function genPreview(root, n, inp, out) {
    var code = {}; inp.teams.forEach(function (t) { code[t.id] = t.code; });
    var list = out.rows.map(function (r) { return { week: r.week, at: r.scheduled_at, home: code[r.home_team_id], away: code[r.away_team_id] }; });
    var S = schedOf(list), sh0 = out.shape, plan = out.plan, first = S.weeks[0], md = function (iso) { return M().etFull(iso).replace(/, \d{4}$/, ""); };
    var nights = S2.CG.NIGHT_NAMES(sh0.nights), times = first.nights[0].slots.map(function (x) { return x.label.replace(/\s?PM$/, ""); });
    var skipped = (plan && plan.skipped || []).map(function (h) { return h.name + " (week of " + M().etMonthDay(h.week + "T17:00:00Z") + ")"; });
    var why = [inp.teams.length + " clubs, " + sh0.perClub + " games each, " + sh0.perNight + " a night and " + sh0.perWeek + " a week (" + nights + ", " + times.join(", ") + " PM ET), " +
        S.weeks.length + " weeks from " + md(first.nights[0].at) + ". " + (skipped.length ? "Skipping " + skipped.join(", ") + "." : "No skipped holiday falls inside it."),
      out.rows.length + " games are written in one go. The regular season then ends " + md(out.patch.set.ends_at) + " and the playoffs begin " + md(out.patch.set.playoffs_start_at) + ", the game week after."];
    var host = null;
    writeSheet({ title: "Generate the " + (inp.season.name || "Season " + n) + " schedule?", label: "Generate schedule", why: why,
      html: '<div class="cc-gen-prev" data-cc-genprev>' + weekPicker(S, first) + schedWeekHtml(first) + "</div>",
      refocus: function () { return S2.$('[data-cc-step="8"]', root); },
      opened: function (sh) { host = S2.$("[data-cc-genprev]", sh.el); bindWeeks(host, S); },
      send: function () {
        return S2.write("games.insert", { row: out.rows }, { sections: [] }).then(function (r1) {
          var made = (r1.data || []).length;
          return S2.write("seasons.update", { set: out.patch.set, match: out.patch.match, select: "id,ends_at,playoffs_start_at" }, { sections: ["games", "seasons"] }).then(function (r2) {
            return { made: made, row: (r2.data || [])[0] };
          }, function (e) {
            var x = new Error(made + " games were written, but the end of the season and the playoff date could NOT be updated (" + e.message + "). Set the playoffs to " +
              md(out.patch.set.playoffs_start_at) + " by hand in step 1, or the season will run into them."); x.partial = true; throw x;
          });
        });
      },
      done: function (r) {
        confirmRow(r.row || Object.assign({ id: inp.season.id }, out.patch.set));
        st.written[inp.season.id] = { gen: M().generated, games: list };
        st.schedWeek = 1;
        repaintPane(root);
        S2.toast(r.made + " games generated: " + sh0.perClub + " a club over " + S.weeks.length + " weeks. The playoffs begin " + md(out.patch.set.playoffs_start_at) + ".", "ok");
      },
      partial: function () { delete st.confirmed[inp.season.id]; S2.reread(["games", "seasons"]).then(function () { repaintPane(root); }); } });
  }
  function clearSchedule(root) {
    var n = SETUP_N, row = seasonRow(n), games = regularOf(n), played = games.filter(function (g) { return g.isFinal; }).length;
    if (!row || !games.length) return;
    writeSheet({ title: "Clear the regular-season schedule?", label: "Clear schedule", danger: true, refocus: function () { return S2.$('[data-cc-step="8"]', root); },
      why: [games.length + " games go, including their codes and server picks" + (played ? ", and " + played + " finals with their box scores" : "") + ". This can't be undone."],
      send: function () { return S2.write("games.delete", { match: { season_id: row.id, stage: "regular" } }, { sections: ["games"] }); },
      done: function (r) {
        delete st.written[row.id];
        repaintPane(root);
        S2.toast("Regular season cleared: " + (r.data || []).length + " games removed", "ok");
      } });
  }
  function kv(rows) { return '<div class="list cc-flat cc-kv">' + rows.map(function (r) { return '<div class="row"><span class="grow">' + esc(r[0]) + '</span><span class="trail num">' + esc(r[1]) + "</span></div>"; }).join("") + "</div>"; }
  /* which skipped holidays fall inside the regular season (puck drop up to the playoffs), worked out from the dates */
  function holidayClaim(keys, start, end) {
    if (!start || !end) return "";
    var a = dayKey(start.at), b = dayKey(end.at), hits = [], undated = [];
    keys.forEach(function (k) {
      var name = holidayName(k);
      for (var y = +a.slice(0, 4); y <= +b.slice(0, 4); y++) {
        var d = holidayDay(k, y);
        if (d == null) { if (undated.indexOf(name) < 0) undated.push(name); }
        else if (d >= a && d < b) hits.push(name + ", " + M().etDate(d + "T17:00:00Z"));
      }
    });
    var span = " between puck drop on " + start.date.replace(/, \d{4}$/, "") + " and the playoffs on " + end.date.replace(/, \d{4}$/, "");
    /* the generator steps over the whole game week a skipped holiday falls in, never just the day (review 2026-11-24) */
    return '<p class="t-sub">' + esc(hits.length ? hits.join("; ") + (hits.length === 1 ? " falls" : " fall") + span + ", so the schedule skips " + (hits.length === 1 ? "that whole week" : "each of those weeks") + "."
      : (undated.length ? "Of the holidays this page can date, none falls" : "None of these falls") + span + ", so Season 2 loses no game week to them.") +
      (undated.length ? " " + esc(undated.join(", ")) + " could not be dated here." : "") + "</p>";
  }
  /* the league's shape in words, from the league read: "Eight clubs in two divisions of four" (QA round 2, 2026-11-25: it was
     typed in, and would have outlived an added franchise); "of four" only while every division holds the same number AND
     every club sits in one (QA round 2 review: nine clubs, one just approved and not yet placed, are not "two divisions of
     four") */
  function clubsSay(n) { var w = S2.words(n); return w.charAt(0).toUpperCase() + w.slice(1) + (n === 1 ? " club" : " clubs"); }
  function leagueShape(Mm) {
    var divs = Mm.league.divisions, n = Mm.teams.length, per = divs.map(function (d) { return Mm.teams.filter(function (t) { return t.division === d; }).length; });
    var even = per.length && per.every(function (k) { return k === per[0]; }) && per[0] > 0 && per[0] * per.length === n;
    return clubsSay(n) + " in " + S2.words(divs.length) + (divs.length === 1 ? " division" : " divisions") + (even ? " of " + S2.words(per[0]) : "");
  }
  /* step details come from the model; a changelog number such as "(v4.19)" is engineering, never copy the commissioner reads */
  function detailOf(s) { return String(s.detail || "").replace(/(\d+)-man\b/g, "$1-player").replace(/\s*\((?:ruling )?v\d+\.\d+\)/g, ""); }
  function stateLine(s) {   /* the pool sheet says its blocked detail in a callout, so its state line is the chip alone */
    var lab = STATE[s.state] || STATE.todo;
    return '<span class="chip ' + lab[1] + '">' + lab[0] + "</span>" + (s.key === "pool" && s.state === "blocked" ? "" : '<span class="t-foot">' + esc(detailOf(s)) + "</span>");
  }
  function stepSheet(n) {
    var Mm = M(), C = ctl(), s2 = C.season(2), s1 = C.season(1), R = Mm.RULES.s2, s = steps().filter(function (x) { return x.step === n; })[0], dl = deadlineCheck();
    var cal = {}; s2.calendar.forEach(function (c) { cal[c.key] = c; });
    var h = '<div class="cc-sh-state">' + stateLine(s) + "</div>";
    if (s.key === "settings") { var sr0 = seasonRow(SETUP_N);
      h += kv([["Weeks", sr0.weeks], ["Nights a week", sr0.nights_per_week], ["Puck drops (ET)", String(sr0.night_slots || "").split(",").map(function (t) { var x = etAt("2026-12-16", t); return x ? M().etTime(x) : t; }).join(", ")],
        ["Roster limit", sr0.roster_max], ["Draft rounds", sr0.draft_rounds], ["Salary cap", M().money(sr0.salary_cap)], ["AGM salary", M().money(sr0.agm_salary)],
        ["Trade deadline", sr0.trade_deadline_week ? "Week " + sr0.trade_deadline_week : "None"], ["Holidays skipped", sr0.skip_holidays == null ? "Not set" : String(sr0.skip_holidays.length)], ["Sign-ups", sr0.registration_open ? "Open" : "Closed"],
        ["Minimums from the draft", R.min.F + " F, " + R.min.D + " D, " + R.min.G + " G"], ["Format", "Basic"]].map(function (x) { return [x[0], x[1] == null ? "None" : String(x[1])]; })) +
      '<h4 class="t-cap cc-sub-h">Calendar</h4>' + kv(SEASON_DATES.filter(function (d) { return sr0[d[0]]; }).map(function (d) { return [d[1], M().etFull(sr0[d[0]]).replace(/, \d{4}$/, "") + ", " + M().etTime(sr0[d[0]]) + " ET"]; })) +
      '<div class="cc-sh-acts"><button class="btn" data-cc-season="edit">Edit settings</button><button class="btn secondary" data-cc-season="new">New season</button></div>'; }
    else if (s.key === "holidays") h += holListHtml(SETUP_N) + holidayClaim(holKeys(seasonRow(SETUP_N)), cal.starts_at, cal.playoffs_start_at);
    else if (s.key === "owners") {
      /* the owner applications waiting, as the Staff Desk reads them (its own read of owner_applications): shapes, never names */
      var L0 = deskLV(), pendO = L0 ? (L0.apps || []).filter(function (a) { return a.type === "owner" && a.stage === "ballot"; }).length : null;
      h += kv([["Applications close", when(cal.owner_app_deadline)], ["Owners decided by", when(cal.owners_decided_by) + ", your ruling"]]) +
        '<div class="cc-conf"><span class="t-cap">Pending</span>' + (pendO == null ? '<span class="t-foot">' + (deskState() === "error" ? "The applications could not be read on the Staff Desk." : "Reading the applications on the Staff Desk.") + "</span>"
          : pendO ? shapes(pendO, "Owner applications pending") + '<span class="t-foot">Confidential until decided: shown as shapes, never names.</span>' : '<span class="t-foot">No owner application is waiting.</span>') + "</div>" +
        '<p class="t-sub">An applicant may pick any of the 32 NHL franchises. By your ruling, a new club is held until you give the go-ahead.</p>' +
        '<div class="cc-sh-acts"><a class="btn" href="#/desk?tab=applications">Open applications</a></div>';
    }
    else if (s.key === "clubs") {
      h += '<div class="cc-divs">' + Mm.league.divisions.map(function (d) { return '<div><span class="t-cap">' + esc(d) + '</span><div class="cc-crests">' + Mm.teams.filter(function (t) { return t.division === d; }).map(function (t) { return '<span class="cc-cr">' + Mm.crest(t.code) + '<span class="t-foot">' + esc(t.code) + "</span></span>"; }).join("") + "</div></div>"; }).join("") + "</div>" +
        '<p class="t-sub">' + leagueShape(Mm) + ', one league, no tiers. A franchise added from the owner applications appears here once you approve it.</p><div class="cc-sh-acts"><button class="btn" data-cc-go-close="clubs">Open the club editor</button></div>';
    }
    else if (s.key === "signups") {
      var sr = C.seasonReturn, s1s = C.signups.filter(function (x) { return x.season === 1; })[0];
      h += '<div class="cc-pair"><div><span class="t-stat-sm num">' + sr.signedUp + '</span><span class="t-foot">signed up</span></div><div><span class="t-stat-sm num">' + sr.playedS1 + '</span><span class="t-foot">played in Season 1</span></div></div>' +
        kv([["Sign-ups close", when(cal.registration_deadline)], ["The rule gives", dl.wantLabel + ", 11:59\u00a0PM ET"]]) +
        (dl.off ? '<p class="cc-callout-s">' + WARN + "<span>The sign-up deadline is not 11:59 PM the day before the draft (Rule S2.1). Worth a look before sign-ups close.</span></p>"
          : '<p class="t-sub">' + S2.ic("check", "cc-ic") + " The deadline matches the rule: 11:59 PM the day before the draft (Rule S2.1).</p>") +
        '<div class="cc-sh-acts"><button class="btn' + (dl.off ? "" : " secondary") + '" data-cc-season="edit">Edit the date</button></div>' +
        '<p class="t-sub">Late sign-ups are placed in rotation: every club receives one before any club receives a second.' + (s1s ? " Season 1 for scale: " + s1s.active_regs + " sign-ups stayed active, " + s1s.withdrawn_or_removed + " were withdrawn or removed." : "") + "</p>";
    }
    else if (s.key === "draft") h += kv([["Draft", when(cal.draft_at)], ["Rounds", R.draftRounds], ["Seated before the draft", "Owner and GM; the AGM is named from the roster after it"], ["Roster", R.limit + " all season, the seats included"], ["Minimums from the draft", R.min.F + " F, " + R.min.D + " D, " + R.min.G + " G"]]) +
      '<p class="t-sub">The board, the order and the lottery live in the Draft room, which opens on draft night.' + (s1 ? " Season 1 drafted on " + esc((s1.calendar.filter(function (c) { return c.key === "draft_at"; })[0] || {}).date || "") + "." : "") +
        " The basic format draws every order at random (ruling 2026-09-28: \"Season 2 draft: fully random\").</p>" +
      '<div class="cc-sh-acts"><a class="btn" href="#/draft">Open the draft room</a></div>';
    else if (s.key === "pool") { var bn = bidNightsAll(), held = bn.filter(function (b) { return !b.skipped; }), off = bn.filter(function (b) { return b.skipped; });
      /* the rulings of 2026-11-02 (Rules S2.5 and S2.6 as proposed): six games to be bid on, $750K then exactly $250K, never
         two bids in a row by one club, never over the cap or the roster limit; waivers for 24 hours, first claim wins */
      h += '<p class="t-sub">The training camp pool, waivers and the Saturday bid room run from their own pages, with each club&rsquo;s bid board in Team HQ.</p>' +
        kv([["Bid nights", (held.length ? "Saturdays " + bidDays(held) : "Saturdays after the draft") + ", 9 to 10\u00a0PM\u00a0ET"]].concat(off.length ? [["No bidding", bidDays(off) + ", holiday weeks"]] : [])
          /* six games this season at any club, a waived player's earlier roster games included (Rule S2.5 tracks each
             pool player's games across every club; review 2026-11-03), never only the games played from the pool */
          .concat([["To be bid on", "Six games played this season, at any club"],["First bid", "$750K"], ["Each raise", "Exactly $250K"], ["Two bids in a row", "Never, by one club on one player"], ["Each bid", "Starts a five-minute countdown"],
            ["Every bid", "Within the cap and the roster limit, counting bids the club leads"], ["Waivers", "Twenty-four hours, the first claim wins, then the pool"]])) +
        /* a short read of S2.market.room (js/pages/bidding.js draws it and repaints it in place on "s2:market"), bidders
           hidden while bidding runs */
        '<div data-w="ccbids">' + (S2.bidding ? S2.bidding.ccBids() : "") + "</div>" +
        '<div class="cc-sh-acts"><a class="btn" href="#/bidding">Open the bid room</a><a class="btn secondary" href="#/camp">The training camp pool</a></div>' +
        '<p class="t-foot">Source: ' + esc(R.source) + "; the November 2 rulings on waivers and bidding (Rules S2.5 and S2.6).</p>"; }
    else if (s.key === "schedule") {
      var row = seasonRow(SETUP_N), shp = S2.CG.seasonShape(row), sg = regularOf(SETUP_N);
      h += kv([["Weeks", shp.weeks], ["Nights a week", shp.nights + " (" + S2.CG.NIGHT_NAMES(shp.nights) + ")"], ["Slots a night", s2.summary.filter(function (x) { return x.label === "Game slots (ET)"; })[0].value],
        ["Games a club", shp.perClub], ["Puck drop", when(cal.starts_at)], ["Regular season ends", when(cal.ends_at) || "Set when the schedule is generated"]]) +
        '<p class="t-sub">Generate shows every game it would write, a week at a time, and writes nothing until you confirm. It never opens on a game night, and clearing a schedule is behind its own guard.</p>' +
        (sg.length ? '<div class="cc-sh-acts"><button class="btn" data-cc-sgo>See the schedule</button><button class="btn secondary" data-cc-sclear>Clear the schedule</button></div>'
          : '<div class="cc-sh-acts"><button class="btn" data-cc-sgen>Generate schedule</button></div>' + (s.state === "blocked" ? '<p class="t-foot">The holidays are not set yet (step 2), so the generator will refuse: no schedule is ever generated before them.</p>' : ""));
    }
    else if (s.key === "playoffs") { var pf = s1 && s1.playoff;
      h += kv([["Qualify", (pf ? pf.per_div : 3) + " per division"], ["Rounds", pf ? pf.rounds : 3], ["Series", "Best of " + (pf ? pf.best_of : 7)], ["Games-played floor", s2.settings.playoff_min_gp + " games"], ["Playoffs begin", when(cal.playoffs_start_at)]]) +
        '<p class="t-sub">The first seed in each division has a bye; second meets third and the winner meets the first seed. The two division champions meet in the final.</p>' +
        '<h4 class="t-cap cc-sub-h">The bracket draws itself</h4>' + poCard();
    }
    else if (s.key === "rollover") { var flip = C.jobs.cron.filter(function (c) { return c.job === "season-status-flip"; })[0];
      h += '<div class="list cc-flat"><div class="row">' + dot(cronOk(flip) ? "ok" : "warn") + '<span class="grow"><span class="title">season-status-flip</span><span class="sub">' + (flip ? "Every 10 minutes, last ran " + esc(flip.ago) + ", " + (flip.fails_7d ? flip.fails_7d + " failures" : "no failures") + " in 7 days" : "Not found") + "</span></span></div></div>" +
        '<p class="t-sub">Season ' + SETUP_N + " becomes the current season by itself minutes after the Season " + (SETUP_N - 1) + " final. Run rollover stays here for parity, behind a confirmation; it is safe to run again and only fills gaps.</p>" +
        '<div class="cc-sh-acts"><button class="btn secondary" data-cc-roll>Run rollover</button></div>';
    }
    return h;
  }
  /* ---------- holidays (seasons.skip_holidays): the classic CG.holidayCard's choices, saved on every switch ----------
     NULL means never set (the classic generator reads it as the defaults); [] means skip nothing. That difference is the
     standing order's gate, so the sheet says which it is, and a season never set offers the defaults to confirm. A switch
     shows its new state only after the league confirms it; a refusal leaves it as saved and says why. */
  function holKeys(row) { return !row ? [] : row.skip_holidays == null ? S2.CG.HOLIDAY_DEFAULTS.slice() : row.skip_holidays.slice(); }
  function holListHtml(n) {
    var row = seasonRow(n); if (!row) return "";
    var keys = holKeys(row), set = row.skip_holidays != null, start = row.starts_at ? dayKey(row.starts_at) : null, end = row.playoffs_start_at ? dayKey(row.playoffs_start_at) : null;
    var y0 = start ? +start.slice(0, 4) : new Date().getFullYear(), y1 = end ? +end.slice(0, 4) : y0 + 1, years = [];
    for (var y = y0; y <= y1; y++) years.push(y);
    return '<div data-cc-hols>' + (set ? "" : '<p class="cc-callout-s">' + WARN + "<span>" + esc(row.name || "This season") + "&rsquo;s holidays have never been set. The usual ones are switched on below. Set them, or change any switch, before the schedule can be generated.</span></p>" +
        '<div class="cc-sh-acts"><button class="btn" data-cc-holset>Set these holidays</button></div>') +
      '<div class="list cc-flat cc-hols">' + S2.CG.HOLIDAYS.map(function (h) {
        var on = keys.indexOf(h.key) >= 0, dates = years.map(function (yy) { return holidayDay(h.key, yy); }).filter(function (d) { return d && start && d >= start && (!end || d < end); });
        var sub = h.where.replace("&", "and") + ". " + (!start ? "" : dates.length ? dates.map(function (d) { return M().etDate(d + "T17:00:00Z"); }).join(" and ") + (on ? ": that week is skipped" : ": a game week") : "Outside the regular season");
        return '<div class="row"><span class="grow"><span class="title">' + esc(h.name) + '</span><span class="sub">' + esc(sub) + "</span></span>" +
          '<button class="switch" role="switch" data-cc-hol="' + esc(h.key) + '" aria-checked="' + on + '" aria-label="Skip the week of ' + esc(h.name) + '"></button></div>';
      }).join("") + '</div><p class="fl-err" role="alert" data-cc-holerr hidden></p></div>';
  }
  function bindHols(sh, root) {
    var host = S2.$("[data-cc-hols]", sh.el); if (!host) return;
    host.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cc-hol],[data-cc-holset]"); if (!b || b.disabled) return;
      var keys = holKeys(seasonRow(SETUP_N)), k = b.dataset.ccHol;
      if (k) { var i = keys.indexOf(k); if (i >= 0) keys.splice(i, 1); else keys.push(k); }
      saveHols(sh, root, keys, b);
    });
  }
  function saveHols(sh, root, keys, btn) {
    var row = seasonRow(SETUP_N), err = S2.$("[data-cc-holerr]", sh.el), key = btn.dataset.ccHol || null;
    var all = S2.$$("[data-cc-hol],[data-cc-holset]", sh.el);
    all.forEach(function (b) { b.disabled = true; }); btn.setAttribute("aria-busy", "true"); err.hidden = true;
    S2.write("seasons.update", { set: { skip_holidays: keys }, match: { id: row.id }, select: "id,skip_holidays" }, { sections: ["seasons"] }).then(function (r) {
      confirmRow((r.data || [])[0]);
      var host = S2.$("[data-cc-hols]", sh.el);
      if (host && host.isConnected) {
        host.outerHTML = holListHtml(SETUP_N); bindHols(sh, root);
        var stl = S2.$(".cc-sh-state", sh.el); if (stl) stl.innerHTML = stateLine(steps().filter(function (x) { return x.key === "holidays"; })[0]);
        var f = key ? S2.$('[data-cc-hol="' + key + '"]', sh.el) : S2.$("[data-cc-hol]", sh.el); if (f) f.focus();
      }
      repaintSteps(root);
    }, function (e) {
      all.forEach(function (b) { b.disabled = false; }); btn.removeAttribute("aria-busy");
      err.textContent = "Not saved: " + e.message; err.hidden = false;
    });
  }
  function openStep(root, n) {
    var s = steps().filter(function (x) { return x.step === n; })[0];
    if (!s) return;
    var sh = sheet({ title: "Step " + n + ": " + s.label, html: stepSheet(n) }, function () { return S2.$('[data-cc-step="' + n + '"]', root); });
    /* each tool closes the step first, so its own sheet (a confirm, a lock, a flow) is the only one open */
    var tool = function (sel, fn) { var b = S2.$(sel, sh.el); if (b) b.addEventListener("click", function () { sh.close(); fn(); }); };
    tool("[data-cc-roll]", function () { runRollover(root); });
    tool("[data-cc-sclear]", function () { clearSchedule(root); });
    tool("[data-cc-sgo]", function () { var b = S2.$("#ccSched", root); if (b) b.scrollIntoView({ block: "start", behavior: S2.reduce.matches ? "auto" : "smooth" }); });
    tool("[data-cc-sgen]", function () { generateSchedule(root); });
    S2.$$("[data-cc-season]", sh.el).forEach(function (b) { b.addEventListener("click", function () { sh.close(); seasonSheet(root, b.dataset.ccSeason === "new"); }); });
    if (s.key === "holidays") bindHols(sh, root);
    if (s.key === "playoffs") poBind(root, sh, n);
    var go = S2.$("[data-cc-go-close]", sh.el);
    if (go) go.addEventListener("click", function () { sh.close(); switchTab(root, go.dataset.ccGoClose); });
  }
  /* ---------- Season 2 bid nights, read from the market's calendar (js/market.js, Rule S2.6 as ruled 2026-11-02) ---------- */
  function bidNightsAll() { return S2.market && S2.market.bidNights ? S2.market.bidNights() : []; }
  function bidNightsHeld() { return bidNightsAll().filter(function (b) { return !b.skipped; }); }
  /* "Dec 19, Jan 9 and Jan 16": bid nights by their date alone (each is a Saturday) */
  function bidDays(bn) { var d = bn.map(function (b) { return String(b.short).replace(/^\w+, /, ""); }); return d.length < 2 ? d.join("") : d.slice(0, -1).join(", ") + " and " + d[d.length - 1]; }
  /* ---------- the playoff autopilot (live v4.42, 2026-11-01): the bracket draws itself ----------
     The commissioner, 2026-11-01: "generate the first round of season 1 playoffs and automatically generate the following
     rounds when able. For the future, auto generate every playoff round." public._draw_playoff_round runs every five
     minutes (pg_cron playoff-autopilot): round 1 from the final table once the regular season's last game is final, each
     later round once every series of the round before it is decided. The seeds freeze with round 1, and a ruling that
     moves the final table after seeding goes to the commissioners instead of redrawing on its own (_playoff_seed_watch).
     Here, as on the classic Control Center (CG.playoffAutoCard, CG.generatePlayoffRound,
     CG.clearPlayoffRound): the pause switch (site_config playoff_auto_<n> {"paused": true}), Draw now (draw_playoff_round
     with p_dry for the confirm, then the same draw the autopilot runs) and Clear (clear_playoff_round, one call under the
     draw's lock). The rounds on show are the league's own playoff games; nothing here projects a bracket. */
  var PO_NAMES = ["Division semi-finals", "Division finals", "The final"];
  function poKey() { return "playoff_auto_" + SETUP_N; }
  function poPaused() {
    var c = st.cfg[poKey()], site = (M().config && M().config.site) || {};
    var v = c && c.gen === M().generated ? c.value : site[poKey()];
    return !!(v && v.paused === true);
  }
  function poGames() {
    var row = seasonRow(SETUP_N), w = row && st.poGames[row.id];
    if (w && w.gen === M().generated) return w.games;
    return M().view && M().view.season === SETUP_N ? M().games.filter(function (g) { return g.stage === "playoff"; }) : [];
  }
  function poRounds() { var r = 0; poGames().forEach(function (g) { if (+g.week > r) r = +g.week; }); return r; }
  /* the series of round r: each pair of clubs once, the club at home in its first game first */
  function poSeries(r) {
    var seen = {}, out = [];
    poGames().filter(function (g) { return +g.week === r; }).sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); }).forEach(function (g) {
      var k = [g.home, g.away].sort().join("|"); if (seen[k]) { seen[k].n++; return; } seen[k] = { hi: g.home, lo: g.away, n: 1, first: g.at }; out.push(seen[k]);
    });
    return out;
  }
  /* the classic's CG.playoffDrawWhy: a wait reads on its own; only an error needs a commissioner */
  function poWhyNot(v) {
    var t = String((v && (v.error || v.wait)) || "the league gave no reason");
    t = t.charAt(0).toUpperCase() + t.slice(1) + (/\.$/.test(t) ? "" : ".");
    return (v && v.error ? "The draw needs a commissioner. " : "") + t;
  }
  function poWhy() {
    var r = poRounds(), ends = cal2("ends_at");
    if (r >= 3) return "Every round of Season " + SETUP_N + " is drawn.";
    return (r === 0 ? "Round 1 is drawn from the final table as soon as the regular season ends" + (ends ? ", " + when(ends) : "") + "."
      : "Round " + (r + 1) + " is drawn as soon as every series of round " + r + " is decided.") +
      (poPaused() ? " The automatic draw is paused, so it waits for you." : " The league checks every five minutes.");
  }
  function poRoundHtml(r) {
    var t = function (c) { return (M().team(c) || { name: c }).name; };
    return '<li class="cc-po-r"><p class="cc-po-rh"><span class="t-cap">Round ' + r + ", " + esc((PO_NAMES[r - 1] || "round " + r).toLowerCase()) + "</span></p>" +
      '<div class="list cc-flat">' + poSeries(r).map(function (x) {
        return '<div class="row cc-po-m"><span class="cc-po-cr" aria-hidden="true">' + M().crest(x.hi) + M().crest(x.lo) + '</span><span class="grow"><span class="title">' + esc(t(x.hi) + " v " + t(x.lo)) + '</span><span class="sub">' +
          x.n + (x.n === 1 ? " game" : " games") + ", from " + esc(M().etFull(x.first).replace(/, \d{4}$/, "")) + "</span></span></div>";
      }).join("") + "</div></li>";
  }
  function poCard() {
    var paused = poPaused(), n = poRounds(), rows = "";
    for (var r = 1; r <= n; r++) rows += poRoundHtml(r);
    return '<div class="cc-po" id="ccPoAuto">' +
      '<div class="list cc-flat"><label class="row cc-hol" for="ccPoSw"><span class="grow"><span class="title">Automatic draw</span><span class="sub">' +
        (paused ? "Paused for Season " + SETUP_N + ". No round is drawn on its own until you resume it; Draw now still works." : "On for Season " + SETUP_N + ". Each round is drawn within five minutes of being ready.") + "</span></span>" +
        '<button class="switch" role="switch" id="ccPoSw" aria-checked="' + !paused + '" aria-label="Automatic draw"></button></label></div>' +
      '<p class="t-sub" id="ccPoWhy">' + esc(poWhy()) + "</p>" +
      (rows ? '<ol class="cc-po-rounds">' + rows + "</ol>" : "") +
      '<p class="fl-err" role="alert" data-cc-poerr hidden></p>' +
      '<div class="cc-sh-acts">' + (n < 3 ? '<button class="btn" data-cc-po="draw">Draw round ' + (n + 1) + " now</button>" : "") +
        (n ? '<button class="btn secondary" data-cc-po="clear">Clear round ' + n + "</button>" : "") + "</div></div>";
  }
  function repaintSteps(root) {
    var host = S2.$("#ccStepper", root); if (host) { host.outerHTML = stepperHtml(); bindStepper(root); }
    var hd = S2.$("#ccSetupHead", root); if (hd) hd.textContent = setupHead();
    sideCounts(root);
  }
  /* the card repaints in place inside the step's sheet (the switch keeps focus) once the league confirms the switch; Draw
     now and Clear close the step first, so their own sheet is the only one open, and reopen it on the result */
  function poBind(root, sh, n) {
    var sw = S2.$("#ccPoSw", sh.el); if (!sw) return;
    sw.addEventListener("click", function () {
      if (sw.disabled) return;
      var pause = !poPaused(), err = S2.$("[data-cc-poerr]", sh.el);
      sw.disabled = true; sw.setAttribute("aria-busy", "true"); err.hidden = true;
      S2.write("site_config.upsert", { row: { key: poKey(), value: { paused: pause } }, onConflict: "key", select: "key,value" }, { sections: ["config"] }).then(function (r) {
        var got = (r.data || [])[0];
        st.cfg[poKey()] = { gen: M().generated, value: got && got.value ? got.value : { paused: pause } };
        var card = S2.$("#ccPoAuto", sh.el);
        if (card && card.isConnected) { card.outerHTML = poCard(); poBind(root, sh, n); S2.$(".cc-sh-state", sh.el).innerHTML = stateLine(steps().filter(function (x) { return x.step === n; })[0]); S2.$("#ccPoSw", sh.el).focus(); }
        repaintSteps(root);
        S2.toast(pause ? "Automatic draws paused for Season " + SETUP_N : "Automatic draws resumed for Season " + SETUP_N, "ok");
      }, function (e) {
        sw.disabled = false; sw.removeAttribute("aria-busy");
        err.textContent = "Not saved: " + e.message; err.hidden = false;
      });
    });
    S2.$$("[data-cc-po]", sh.el).forEach(function (b) { b.addEventListener("click", function () { sh.close(); (b.dataset.ccPo === "draw" ? poDraw : poClear)(root, n); }); });
  }
  /* after a draw or a clear: the league's playoff games again, then the step reopens on them */
  /* qa (nits 20): the write is confirmed before this runs, so a failed re-read says the change stands but the list is
     the old one (toast), and the step still repaints; a rejected S2.reread had no handler and left the step unpainted */
  function poAfter(root, n, row) {
    var stale = function (e) {
      console.error("control: the playoff games could not be read again", e);
      S2.toast("Done, but the playoff games could not be read again (" + ((e && e.message) || "the league did not answer") + "). Reload to see them.", "err");
    };
    return S2.reread(["games"]).then(function () {
      return client() ? rd(function (c) { return c.from("games").select("id,week,stage,scheduled_at,home_team_id,away_team_id,status").eq("season_id", row.id).eq("stage", "playoff"); }).then(function (gs) {
        var code = {}; (S2.data && S2.data.body && S2.data.body.teams || []).forEach(function (t) { code[t.id] = t.code; });
        st.poGames[row.id] = { gen: M().generated, games: (gs || []).map(function (g) { return { id: g.id, week: g.week, stage: g.stage, at: g.scheduled_at, home: code[g.home_team_id] || g.home_team_id, away: code[g.away_team_id] || g.away_team_id, status: g.status }; }) };
      }, stale) : null;
    }, stale).then(function () { repaintSteps(root); setTimeout(function () { openStep(root, n); }, 0); });
  }
  function poDraw(root, n) {
    var row = seasonRow(SETUP_N), r = poRounds() + 1, back = function () { return S2.$('[data-cc-step="' + n + '"]', root); }, name = (PO_NAMES[r - 1] || "Round " + r).toLowerCase();
    if (st.busy.po) return; st.busy.po = true;
    S2.write("draw_playoff_round", { p_season: row.id, p_round: r, p_dry: true }, {}).then(function (res) {
      var v = res.data || {};
      if (!v.ok) return refusal("Round " + r + " is not drawn", poWhyNot(v), back);
      var ats = (v.plan || []).map(function (g) { return Date.parse(g.at); }).filter(function (t) { return !isNaN(t); });
      var span = ats.length ? ", " + M().etFull(new Date(Math.min.apply(null, ats)).toISOString()).replace(/, \d{4}$/, "") + " to " + M().etFull(new Date(Math.max.apply(null, ats)).toISOString()).replace(/, \d{4}$/, "") : "";
      writeSheet({ title: "Draw the " + name + " now?", label: "Draw round " + r, refocus: back,
        why: [(v.series || []).map(function (m) { return m.home + " v " + m.away; }).join(", ") + ": best of " + v.best_of + ", " + v.games + " games" + span + "." +
          (r === 1 ? " Seeding locks in with this bracket." : "") + " Unneeded games come off once a series is decided."],
        send: function () { return S2.write("draw_playoff_round", { p_season: row.id, p_round: r }, { sections: ["games"] }).then(function (r2) { var d = r2.data || {}; if (!d.ok) throw new Error(poWhyNot(d)); return d; }); },
        done: function (d) { S2.toast("Round " + r + " drawn: " + d.games + " games", "ok"); poAfter(root, n, row); } });
    }, function (e) { refusal("Round " + r + " is not drawn", "The preview was refused: " + e.message, back); }).then(function () { st.busy.po = false; });
  }
  function poClear(root, n) {
    var row = seasonRow(SETUP_N), r = poRounds(), mine = poGames().filter(function (g) { return +g.week === r; }), played = mine.filter(function (g) { return g.isFinal || g.status === "final"; }).length;
    writeSheet({ title: "Clear round " + r + "?", label: "Clear round " + r, danger: true, refocus: function () { return S2.$('[data-cc-step="' + n + '"]', root); },
      why: [mine.length + " games go" + (played ? ", including " + played + " finals with their box scores" : "") + ". This can't be undone." +
        (poPaused() ? " Automatic draws are paused, so the round stays empty until you draw it." : " Unless you pause automatic draws first, the round is drawn again within five minutes from the " + (r === 1 ? "current table." : "current results."))],
      send: function () { return S2.write("clear_playoff_round", { p_season: row.id, p_round: r }, { sections: ["games", "config"] }).then(function (res) {
        var d = res.data || {};
        if (mine.length && !d.games) throw new Error("Nothing was cleared: the league found no games in that round. Reload and check.");
        return d; }); },
      done: function (d) { S2.toast("Round " + r + " cleared: " + (d.games || 0) + (d.games === 1 ? " game" : " games") + (d.seeds_unlocked ? ", seeding unlocked" : ""), "ok"); poAfter(root, n, row); } });
  }
  /* ---------- the rollover (the classic Seasons tab's Run rollover: start_next_season) ---------- */
  function runRollover(root) {
    var row = seasonRow(SETUP_N), s1 = ctl().season(SETUP_N - 1), live = s1 && s1.status !== "complete";
    writeSheet({ title: "Run the rollover into " + (row.name || "Season " + SETUP_N) + "?", label: "Run rollover", danger: true, refocus: function () { return S2.$('[data-cc-step="10"]', root); },
      why: ["Contracts that ended with the previous season expire, and every player must sign up again (Rule 2.5). The basic format carries no player deal or extension between seasons. Safe to re-run; it only fills gaps."]
        .concat(live ? ["Season " + (SETUP_N - 1) + " is not complete yet, and the rollover runs by itself minutes after its final. Running it now ends that season's contracts mid-season."] : []),
      send: function () { return S2.write("start_next_season", { p_new_season: row.id }, { sections: ["rosters", "seasons", "league"] }); },
      done: function (res) {
        var d = res.data || {};
        repaintPane(root);
        S2.toast("Rollover done: " + (d.expired || 0) + " expired, " + (d.activated || 0) + " seated, " + (d.holds || 0) + " awaiting sign-up", "ok");
      } });
  }
  function bindStepper(root) { S2.$$("[data-cc-step]", root).forEach(function (b) { b.addEventListener("click", function () { openStep(root, +b.dataset.ccStep); }); }); }

  /* ====================================================================================================== GROWTH */
  /* every chart the commissioner likes stays; each band opens with the finding as a headline, each chart with one
     sentence above it, and the sources and method sit together in the tab's one "About this data" */
  function sum(a) { return a.reduce(function (s, v) { return s + (v || 0); }, 0); }
  /* the Growth tab from the live read (s2_control): members, joins and departures, accounts, weekly players, departures
     by club and the Season 2 sign-ups. The fixture's Season 1 funnel, retention, cohorts and stay lengths are not in
     that read, so they are named as missing in the tab's disclosure instead of drawn */
  function growthLive(first) {
    var Mm = M(), C = ctl(), gap = C.funnelGap, wa = C.weeklyActive, days = C.members.days, jd = C.joinsDeparts, sr = C.seasonReturn;
    if (!days.length) return '<h2 class="sr" id="ccPaneTitle">Growth and retention</h2>' + band("a", secHead("Growth and retention", "No membership history yet", "The member line starts once the server has a recorded day."), first);
    var last = days[days.length - 1], ago = days[Math.max(0, days.length - 31)], peak = days.reduce(function (a, d) { return d.members > a.members ? d : a; }, days[0]), d30 = last.members - ago.members;
    var seg = '<div class="seg cc-seg" id="ccPeriod" role="group" aria-label="Period">' + [["day", "Day"], ["week", "Week"], ["month", "Month"]].map(function (p) { return '<button data-v="' + p[0] + '" aria-pressed="' + (st.period === p[0]) + '">' + p[1] + "</button>"; }).join("") + "</div>";
    var churn = C.churnByClub.filter(function (c) { return c.inLeague; }), former = C.churnByClub.filter(function (c) { return !c.inLeague; });
    var cmax = Math.max.apply(null, C.churnByClub.map(function (c) { return c.n; }).concat([1])), formerN = sum(former.map(function (c) { return c.n; })), left = sum(jd.departs);
    var lw = wa.players.length - 1, lo = wa.players.length ? Math.min.apply(null, wa.players) : 0, hi = wa.players.length ? Math.max.apply(null, wa.players) : 0;
    return '<h2 class="sr" id="ccPaneTitle">Growth and retention</h2>' +
      band("a", secHead("Membership", fmt(last.members) + " members",
          "The Discord server has " + fmt(last.members) + " members today, " + (d30 >= 0 ? "up " : "down ") + Math.abs(d30) + " in 30 days. The peak was " + fmt(peak.members) + " on " + esc(Mm.etMonthDay(peak.d + "T17:00:00Z")) + ".") +
        '<div class="cc-block">' + lead("Members over time", "Site accounts run alongside as the dashed line.", seg) + '<div class="cc-chart" data-cc-draw="members" style="min-height:250px"></div></div>' +
        '<div class="cc-block">' + lead("Joins and departures", fmt(sum(jd.joins)) + " joins since the server opened, and " + fmt(left) + " departures since Aug 3, when they were first logged; " + fmt(sum(jd.registered)) + " of those who left had signed up for a season.") +
          '<div class="cc-chart" data-cc-draw="flow" style="min-height:270px"></div></div>', first) +
      band("w", secHead("Accounts", fmt(gap.withoutAccount) + " members have no account",
          "They can chat, but they cannot sign up, be placed on a club or appear in a box score until they sign in on the site once.") +
        '<div class="cc-gapn"><span class="d-num" data-count="' + gap.withoutAccount + '">' + fmt(gap.withoutAccount) + "</span><span>without an account, of " + fmt(gap.discordMembers) + " members</span></div>" +
        '<div class="cc-stackbar" role="img" aria-label="' + gap.withAccount + " with an account, " + gap.withoutAccount + ' without"><i class="cc-grow" style="width:' + f(gap.discordMembers ? gap.withAccount / gap.discordMembers * 100 : 0) + '%"></i></div>' +
        '<div class="cc-legend"><span><i class="cc-key a"></i>' + fmt(gap.withAccount) + " have an account</span><span><i class=\"cc-key fill\"></i>" + fmt(gap.withoutAccount) + " do not</span></div>", first) +
      band("a", secHead("Weekly players", wa.players.length ? fmt(wa.players[lw]) + " players in the " + esc(wa.labels[lw].toLowerCase()) : "No league games yet",
          wa.players.length ? "Weekly players have held between " + lo + " and " + hi + "." : "The weekly count starts with the first league game.") +
        (wa.players.length ? '<div class="cc-chart" data-cc-draw="active" style="min-height:190px"></div>' : ""), first) +
      band("w", secHead("Departures", fmt(left) + " departures since Aug 3",
          (C.stay ? "Members in the server today have been there " + C.stay.median + " days at the median. " : "") + (churn[0] ? esc(churn[0].team ? churn[0].team.full : churn[0].code) + " lost the most members who left while on a club, " + churn[0].n + "." : "")) +
        '<div class="cc-funnel cc-churn">' + churn.map(function (c) { return hbar(Mm.crest(c.code) + "<span>" + esc(c.team ? c.team.full : c.code) + "</span>", c.n, cmax); }).join("") +
          (former.length ? hbar('<span class="cc-crest-ph" aria-hidden="true"></span><span>Clubs no longer in the league (' + former.map(function (c) { return esc(c.code); }).join(", ") + ")</span>", formerN, cmax, { cls: "is-former" }) : "") + "</div>", first) +
      band("a", secHead("Season 2", sr.playedS1 + " of " + sr.signedUp + " sign-ups are returning players", fmt(C.regPresent) + " of the members in the server today have signed up.", arrowLink("#/control?tab=setup", "Season 2 setup", "setup")) +
        about([["Source", "s2_control(), commissioners only, read " + esc(hm(st.live.at)) + " ET. Members, joins and departures come from guild_members and guild_departures (departures are logged from Aug 3), accounts from profiles, weekly players from game_stats."],
          ["Not in this read", "The Season 1 account-to-regular funnel, week-to-week retention, cohorts and how long leavers stayed: s2_control() does not return them, so they are not drawn."]]), first);
  }
  function growth(first) {
    if (liveRead()) return growthLive(first);
    if (client() && (!st.live || liveErr("control"))) return '<h2 class="sr" id="ccPaneTitle">Growth and retention</h2>' + band("a", secHead("Growth and retention",
      st.live ? "The membership figures could not be read" : "Reading the membership figures", st.live ? "The league refused s2_control(): " + esc(liveErr("control")) + "." : "From s2_control(), commissioners only."), first);
    var Mm = M(), C = ctl(), gap = C.funnelGap, ten = C.tenure, sr = C.seasonReturn, wa = C.weeklyActive, days = C.members.days, jd = C.joinsDeparts;
    if (!days.length) return '<h2 class="sr" id="ccPaneTitle">Growth and retention</h2>' + band("a", secHead("Growth and retention", "No membership history yet", "The member line starts once the server has a recorded day."), first);
    var last = days[days.length - 1], ago = days[Math.max(0, days.length - 31)], peak = days.reduce(function (a, d) { return d.members > a.members ? d : a; }, days[0]);
    var d30 = last.members - ago.members, top = C.funnel.length ? C.funnel[0].value : 0;
    var step = function (re) { return (C.funnel.filter(function (s) { return re.test(s.label); })[0] || {}).value || 0; }, played = step(/^Played a game/), regulars = step(/^Played 3/);
    var seg = '<div class="seg cc-seg" id="ccPeriod" role="group" aria-label="Period">' + [["day", "Day"], ["week", "Week"], ["month", "Month"]].map(function (p) { return '<button data-v="' + p[0] + '" aria-pressed="' + (st.period === p[0]) + '">' + p[1] + "</button>"; }).join("") + "</div>";
    var hmax = Math.max.apply(null, ten.hist.map(function (x) { return x.n; }).concat([1])), big = ten.hist.reduce(function (a, x) { return x.n > a.n ? x : a; }, ten.hist[0] || { n: 0, label: "" });
    var churn = C.churnByClub.filter(function (c) { return c.inLeague; }), former = C.churnByClub.filter(function (c) { return !c.inLeague; });
    var cmax = Math.max.apply(null, C.churnByClub.map(function (c) { return c.n; }).concat([1])), formerN = sum(former.map(function (c) { return c.n; }));
    var hadClub = sum(jd.hadClub), lw = wa.players.length - 1, rates = C.retention.map(function (r) { return Math.round(r.rate * 100); });
    var co = C.cohorts.rows[0], coLast = co ? co.counts[co.counts.length - 1] : null, sMax = Math.max.apply(null, sr.byDay.map(function (x) { return x.n; }).concat([1]));
    var lo = Math.min.apply(null, wa.players), hi = Math.max.apply(null, wa.players);
    return '<h2 class="sr" id="ccPaneTitle">Growth and retention</h2>' +
      band("a", secHead("Membership", fmt(last.members) + " members, " + fmt(regulars) + " regulars",
          "The Discord server has " + fmt(last.members) + " members today, " + (d30 >= 0 ? "up " : "down ") + Math.abs(d30) + " in 30 days. " + fmt(regulars) + " people played three or more weeks of Season 1.") +
        '<div class="cc-block">' + lead("Members over time", "The peak was " + fmt(peak.members) + " on " + esc(Mm.etMonthDay(peak.d)) + ". Site accounts run alongside as the dashed line.", seg) +
          '<div class="cc-chart" data-cc-draw="members" style="min-height:250px"></div></div>' +
        '<div class="cc-block">' + lead("Joins and departures", fmt(sum(jd.joins)) + " joins since the server opened in July, and " + fmt(sum(jd.departs)) + " departures since Aug 3, when they were first logged; " + hadClub + " of the members who left were on a club.") +
          '<div class="cc-chart" data-cc-draw="flow" style="min-height:270px"></div></div>', first) +
      band("w", secHead("Accounts", fmt(gap.withoutAccount) + " members have no account",
          "They can chat, but they cannot sign up, be placed on a club or appear in a box score until they sign in on the site once.") +
        '<div class="cc-cols"><div>' + lead("From account to regular", "Of " + fmt(top) + " site accounts, " + fmt(played) + " played a game and " + fmt(regulars) + " played three weeks or more.") +
          (C.funnel.length ? '<div class="cc-funnel">' + C.funnel.map(function (s, i) {
            var discord = /Discord/.test(s.label);
            return hbar(esc(s.label) + (discord ? ' <span class="chip">today</span>' : ""), s.value, top, { note: i ? pctOf(s.value, top) + "%" : "", cls: discord ? "is-now" : "" });
          }).join("") + "</div>" : empty("No funnel yet: no site accounts were read.")) + "</div>" +
        "<div>" + lead("In the server, not on the site", fmt(gap.withAccount) + " of " + fmt(gap.discordMembers) + " members have a site account. " + fmt(gap.everSeen) + " people have been in the server at some point.") +
          '<div class="cc-gapn"><span class="d-num" data-count="' + gap.withoutAccount + '">' + fmt(gap.withoutAccount) + '</span><span>without an account</span></div>' +
          '<div class="cc-stackbar" role="img" aria-label="' + gap.withAccount + " with an account, " + gap.withoutAccount + ' without"><i class="cc-grow" style="width:' + f(gap.discordMembers ? gap.withAccount / gap.discordMembers * 100 : 0) + '%"></i></div>' +
          '<div class="cc-legend"><span><i class="cc-key a"></i>' + fmt(gap.withAccount) + " have an account</span><span><i class=\"cc-key fill\"></i>" + fmt(gap.withoutAccount) + " do not</span></div></div></div>", first) +
      band("a", secHead("Retention", fmt(wa.players[lw]) + " players in " + esc(wa.labels[lw].toLowerCase()),
          "Weekly players have held between " + lo + " and " + hi + ". " + (rates.length ? "From " + Math.min.apply(null, rates) + " to " + Math.max.apply(null, rates) + "% of one week's players came back the next." : "")) +
        '<div class="cc-cols"><div>' + lead("Weekly active players", wa.firstTimers[lw] + " of the " + wa.players[lw] + " in " + esc(wa.labels[lw]) + " were playing their first week.") +
          '<div class="cc-legend"><span><i class="cc-key a"></i>Played before</span><span><i class="cc-key light"></i>First week</span></div><div class="cc-chart" data-cc-draw="active" style="min-height:190px"></div>' +
          '<dl class="cc-ret">' + C.retention.map(function (r) {
            return '<div><dt>' + esc(r.label) + '</dt><dd><b class="d-num">' + Math.round(r.rate * 100) + '%</b><span class="t-foot">' + r.next + " of " + r.played + " came back</span></dd></div>"; }).join("") + "</dl></div>" +
        "<div>" + lead("Cohorts by first week", co ? coLast + " of the " + co.size + " players who started in Week 1 played in Week " + C.cohorts.cols.length + "." : "No cohort has played yet.") +
          S2.charts.heat({ rowHead: C.cohorts.rowHead, cols: C.cohorts.cols, rows: C.cohorts.rows, label: "Retention by first week played" }) + "</div></div>", first) +
      band("w", secHead("Departures", ten.left_within_7d + " of " + ten.n + " leavers went within a week",
          "The median stay was " + ten.median + " days. " + ten.left_within_1d + " left within a day, and " + ten.came_back + " later came back.") +
        '<div class="cc-cols"><div>' + lead("How long leavers stayed", "The largest group, " + big.n + ", left " + esc(/^under/i.test(big.label) ? "in " + big.label.toLowerCase() : "after " + big.label.toLowerCase()) + ".") +
          '<div class="cc-funnel">' + ten.hist.map(function (x) { return hbar(esc(x.label), x.n, hmax, { note: pctOf(x.n, ten.n) + "%" }); }).join("") + "</div></div>" +
        "<div>" + lead("Departures by club", hadClub + " members left while on a club" + (churn[0] ? "; " + esc(churn[0].team ? churn[0].team.full : churn[0].code) + " lost the most, " + churn[0].n : "") + ".") +
          '<div class="cc-funnel cc-churn">' + churn.map(function (c) { return hbar(Mm.crest(c.code) + "<span>" + esc(c.team ? c.team.full : c.code) + "</span>", c.n, cmax); }).join("") +
          (former.length ? hbar('<span class="cc-crest-ph" aria-hidden="true"></span><span>Clubs no longer in the league (' + former.map(function (c) { return esc(c.code); }).join(", ") + ")</span>", formerN, cmax, { cls: "is-former" }) : "") + "</div></div></div>", first) +
      band("a", secHead("Season 2", sr.playedS1 + " of " + sr.signedUp + " sign-ups are returning players",
          sr.playedS1 + " of the " + played + " people who played Season 1 have signed up again so far. The other " + (played - sr.playedS1) + " are the open question.", arrowLink("#/control?tab=setup", "Season 2 setup", "setup")) +
        '<div class="cc-cols"><div>' + lead("Returning players", Math.round(sr.share * 100) + "% of Season 2 sign-ups played Season 1, and " + pctOf(sr.playedS1, played) + "% of Season 1 players are back so far.") +
          '<div class="cc-return">' + S2.charts.rings({ size: 148, stroke: 15, rings: [{ value: sr.share, color: "var(--accent)", label: "Season 2 sign-ups who played Season 1", text: sr.playedS1 + " of " + sr.signedUp },
            { value: played ? sr.playedS1 / played : 0, color: "var(--cc-strong)", label: "Season 1 players signed up again", text: sr.playedS1 + " of " + played }] }) +
          '<div class="cc-return-t"><div><span class="cc-key a"></span><b class="num">' + sr.playedS1 + " of " + sr.signedUp + '</b><span class="t-foot">Season 2 sign-ups played in Season 1 (' + Math.round(sr.share * 100) + "%)</span></div>" +
          '<div><span class="cc-key strong"></span><b class="num">' + sr.playedS1 + " of " + played + '</b><span class="t-foot">Season 1 players have signed up again (' + pctOf(sr.playedS1, played) + "%)</span></div></div></div></div>" +
        "<div>" + lead("Sign-ups by day", (sr.byDay[0] ? sr.byDay[0].n + " signed up on " + esc(sr.byDay[0].label) + ", the day sign-ups opened." : "No sign-ups yet.")) +
          '<div class="cc-funnel">' + sr.byDay.map(function (d) { return hbar(esc(d.label), d.n, sMax); }).join("") + "</div></div></div>" +
        about([["Members over time", "Corrected: the count is re-anchored on the last day, so the line ends at today's " + fmt(C.members.present) + " members; member_pop_stats() anchors on its peak and read " + fmt(C.members.present - (C.members.anchor ? C.members.anchor.shift : 0)) + ". Before Aug 3 the line is an estimate and runs a little low: departures were not logged yet, and a member who rejoined counts from their latest join. Sources: member_pop_stats() with that correction, and profiles for site accounts."],
          ["Joins and departures", "Weeks start Monday. Joins count each member's latest join only, so joins less departures is not the change in members (the member line above is); departures are logged from Aug 3, so July shows none. The darker part of a departure bar is members who had been on a club. Sources: guild_members and guild_departures."],
          ["From account to regular", "Season 1, each step counted on its own, as a share of all " + fmt(top) + " site accounts. In the Discord counts accounts in the server today, so it sits below later steps that still count people who have since left. Sources: profiles, guild_members, season_registrations, roster_tenures, game_stats."],
          ["Members without an account", "guild_members matched to profiles by Discord account."],
          ["Weekly players and cohorts", "League weeks in Eastern time. Retention is the share of one week's players who played again the next week; each cohort row is the players whose first game came that week, and each cell the share of them with a game in a later week. Source: game_stats."],
          ["Departures", "Time from each member's join to their departure, " + fmt(ten.n) + " departures since Aug 3. By club counts members who left the server while on a club, by the club they were last on" + (former.length ? "; " + former.map(function (c) { return esc(c.code); }).join(", ") + " are clubs no longer in the league" : "") + ". Sources: guild_departures, guild_members and roster_tenures (_club_evidence)."],
          ["Season 2 return", "Sign-ups opened Oct 17. Sources: season_registrations and game_stats."]]), first);
  }

  /* ======================================================================================================= CLUBS */
  /* the clubs' own rows (EA link, Discord role and room, the three seats), read from the league for this tab, since the
     league read carries neither the EA link nor the Discord ids. Booleans and names only: no id is ever shown. Without a
     read client (the fixture) the Oct 19 link reading above stands in */
  function teamRows() { return st.tx && st.tx.gen === M().generated ? st.tx.byCode : null; }
  function loadTeams(root) {
    if (!client() || st.busy.tx) return Promise.resolve(null);
    st.busy.tx = true;
    return rd(function (c) { return c.from("teams").select("id,code,ea_club_id,ea_club_name,discord_role_id,discord_channel_id,owner_profile_id,gm_profile_id,agm_profile_id"); }).then(function (rows) {
      var by = {};
      (rows || []).forEach(function (t) { by[t.code] = { id: t.id, ea: t.ea_club_id != null, eaName: t.ea_club_name || null, role: !!t.discord_role_id, room: !!t.discord_channel_id, Owner: t.owner_profile_id || null, GM: t.gm_profile_id || null, AGM: t.agm_profile_id || null }; });
      st.tx = { gen: M().generated, byCode: by, err: null };
    }, function (e) {
      /* qa (function 22): the page says the links could not be read, with Try again; the league's own words go to the console */
      console.error("Control Center: the clubs' EA and Discord links could not be read:", e && e.message, e);
      st.tx = { gen: M().generated, byCode: null, err: (e && e.message) || "The league did not answer." };
    }).then(function () {
      st.busy.tx = false;
      var pane = root && S2.$("#ccPane", root);
      if (pane && pane.dataset.tab === "clubs") repaintPane(root);
    });
  }
  function clubData() {
    var Mm = M(), rows = {}, tx = teamRows(), pre = !Mm.draftDone();
    Mm.standings("league").forEach(function (r) { rows[r.code] = r; });
    return Mm.teams.map(function (t) {
      var r = Mm.roster(t.code), s = rows[t.code] || {}, x = tx && tx[t.code], seats = {};
      ["Owner", "GM", "AGM"].forEach(function (k) { var pid = x ? x[k] : r && r.seats[k] ? r.seats[k].id : null; seats[k] = pid; });
      /* the AGM is named after the draft, from the club's own roster (RULING 2026-11-23): before it, only the Owner and GM
         seats can be open */
      var vacant = ["Owner", "GM", "AGM"].filter(function (k) { return !seats[k] && (k !== "AGM" || !pre); });
      var lastBox = Mm.games.filter(function (g) { return g.hasBox && (g.home === t.code || g.away === t.code); }).slice(-1)[0];
      return { t: t, s: s, row: x || null, link: x || {}, seats: seats, vacant: vacant, pre: pre, lastBox: lastBox ? lastBox.date : null, counts: r ? r.counts : null };
    });
  }
  function swatch(hex, label) { var t = esc(label + " " + (hex ? hex.toUpperCase() : "not set")); return '<span class="cc-sw" style="--c:' + esc(hex || "transparent") + '" role="img" aria-label="' + t + '" title="' + t + '"></span>'; }
  function clubs(first) {
    var list = clubData(), Mm = M();
    if (!list.length) return '<h2 class="sr" id="ccPaneTitle">Clubs</h2>' + band("a", secHead("Clubs", "No clubs yet", "A club appears here once Season setup creates it."), first);
    /* qa (function 22): a failed read is not a pending one, so the link cells say Not read instead of Reading forever */
    var failed = !!(client() && st.tx && st.tx.err), linked = list.filter(function (c) { return c.link.ea; }).length, gaps = [], pending = client() && !teamRows() && !failed;
    list.forEach(function (c) { c.vacant.forEach(function (v) { gaps.push("the " + c.t.full + ": no " + v); }); });
    /* qa (visual 27): one or two gaps are named; more read as a count of clubs, since each row below shows its own seats */
    var gapClubs = list.filter(function (c) { return c.vacant.length; }).length, pre = list.length && list[0].pre;
    var cap = function (x) { return x.charAt(0).toUpperCase() + x.slice(1); };
    var gapSay = gaps.length > 2 ? "Front office seats are open at " + (gapClubs === 1 ? "one club" : gapClubs + " clubs") + "; each row shows which." + (pre ? " The AGM is named after the draft." : "")
      : gaps.length ? cap(gaps.join("; ")) + "." + (gaps.length === 1 ? " Every other front office seat is filled." : "") : "Every front office seat is filled.";
    var divs = Mm.league.divisions || ["East", "West"];
    return '<h2 class="sr" id="ccPaneTitle">Clubs</h2>' +
      band("a", secHead("Club editor", list.length + " clubs" + (pending || failed ? "" : ", " + (linked === list.length ? "all linked to EA" : linked + " linked to EA")),
          (pending ? "Reading each club's EA and Discord links. " : "") +   /* a failed read is said once, in the box below */
          esc(gapSay) + " Open a club to edit its name, colors, logo, division, EA club and seats.",
          arrowLink("#/clubs", "Public club pages")) +
        (failed ? '<div class="list cc-list cc-tx-err">' + S2.empty("err", "The clubs’ EA and Discord links could not be read", "Each club’s EA and Discord cells say Not read until they load; that is not the same as unlinked.", '<button type="button" class="btn sm secondary" data-cc-txretry>Try again</button>') + "</div>" : "") +
        '<div class="cc-club-head" aria-hidden="true"><span>Club</span><span>Colors</span><span>EA club</span><span>Discord</span><span>Seats</span><span>Last box score</span></div>' +
        '<div class="list cc-list cc-clubs">' + list.map(function (c) {
          var t = c.t, s = c.s, rd0 = pending ? '<span class="t-foot">Reading</span>' : failed ? '<span class="t-foot">Not read</span>' : null;
          return '<button class="row cc-club" data-cc-club="' + esc(t.code) + '"><span class="cc-club-n"><span class="cc-ring" style="--c:' + esc(t.color || "transparent") + '">' + Mm.crest(t.code) + '</span><span class="grow"><span class="title">' + esc(t.full) + '</span><span class="sub">' + esc(t.division) + ", " + (s.gp ? s.w + "-" + s.l + "-" + s.otl + ", " + s.pts + " points" : "no games yet") + "</span></span></span>" +
            '<span class="cc-club-meta"><span class="cc-club-c"><span class="sr">Colors </span>' + swatch(t.color, "Primary") + swatch(t.color2, "Secondary") + '<span class="mono t-foot" aria-hidden="true">' + esc((t.color || "").toUpperCase()) + "</span></span>" +
            '<span class="cc-club-c' + (c.link.ea ? " is-ok" : "") + '">' + (rd0 || dot(c.link.ea ? "ok" : "warn") + '<span class="cc-ml">EA club </span>' + (c.link.ea ? "Linked" : '<span class="cc-warn">Not linked</span>')) + "</span>" +
            '<span class="cc-club-c' + (c.link.role && c.link.room ? " is-ok" : "") + '">' + (rd0 || dot(c.link.role && c.link.room ? "ok" : "warn") + '<span class="cc-ml">Discord </span>' + (c.link.role && c.link.room ? "Role and room" : '<span class="cc-warn">Missing</span>')) + "</span>" +
            '<span class="cc-club-c' + (c.vacant.length ? "" : " is-ok") + '">' + dot(c.vacant.length ? "warn" : "ok") + '<span class="cc-ml">Seats </span>' + (c.vacant.length ? '<span class="cc-warn">' + esc(c.vacant.join(", ")) + " empty</span>" : c.pre && !c.seats.AGM ? "Owner and GM" : "3 of 3") + "</span>" +
            '<span class="cc-club-c t-foot">' + (c.lastBox ? '<span class="cc-ml">Last box score </span>' + esc(c.lastBox) : "No box score yet") + "</span></span>" + S2.chev() + "</button>";
        }).join("") + "</div>", first) +
      band("w", '<div class="cc-cols"><div>' + lead("One league, " + S2.words(divs.length) + (divs.length === 1 ? " division" : " divisions"), clubsSay(list.length) + " in the " + esc(divs.join(" and ")) + (divs.length === 1 ? " division" : " divisions") + " of the " + esc(Mm.league.name) + ". Tiers are not in use.") +
          '<div class="cc-divs cc-divs-lg">' + divs.map(function (d) { return '<div><span class="cc-col-h">' + esc(d) + '</span><div class="cc-crests">' + Mm.teams.filter(function (t) { return t.division === d; }).map(function (t) {
            return '<a class="cc-cr" href="' + esc(t.href) + '">' + Mm.crest(t.code, "lg") + '<span class="t-foot">' + esc(t.code) + "</span></a>"; }).join("") + "</div></div>"; }).join("") + "</div></div>" +
        "<div>" + lead("New clubs", "A franchise chosen in an approved owner application is added by your go-ahead on that application, which also seats its Owner (Staff Desk, Applications).") + "</div></div>", first) +
        tail([["Colors", "Club colors mark crests and small swatches only, never chart fills. Every club carries two colors: a save with the same primary and secondary is refused, as on the current site."],
          ["Sources", "teams for names, colors, divisions, logos, the EA link, the Discord role and room (as yes or no; the ids stay private) and the seats; the schedule for the last box score."]]);
  }
  /* the club sheet's EA row, from the club's row (the league's own reading) */
  function eaRow(c) {
    var ok = !!c.link.ea, nm = c.row && c.row.eaName;
    return dot(ok ? "ok" : "warn") + '<span class="grow"><span class="title">EA club</span><span class="sub">' +
      (ok ? "Linked" + (nm ? " to " + esc(nm) : "") + ". Box scores import for this club&rsquo;s games." : "Not linked. This club&rsquo;s games cannot import.") + "</span></span>";
  }
  /* v4.34 to v4.37: find the club on EA by name (pickup-import's search through the bot server, S2.ea) and link it, the
     classic CG.saveEAClub: teams.update of ea_club_id and ea_club_name, shown only once the league confirms the row */
  function eaBind(sh, c, root) {
    var q = S2.$("#ccEaQ", sh.el), out = S2.$("#ccEaOut", sh.el), res = null, seq = 0;
    if (S2.ea && S2.ea.paintStatus) S2.ea.paintStatus(sh.el);
    function search() {
      var name = q.value.trim(), mine = ++seq;
      if (name.length < 2) { out.innerHTML = '<p class="fl-err" role="alert">Type at least two letters of the club&rsquo;s EA name.</p>'; return; }
      if (!S2.ea || !S2.ea.post) { out.innerHTML = '<p class="fl-err" role="alert">EA search is not on this page.</p>'; return; }
      out.innerHTML = '<p class="t-foot cc-ea-wait">Searching EA for &ldquo;' + esc(name) + '&rdquo;. This can take up to 25 seconds.</p>';
      S2.ea.post("/api/pickup-import", { action: "search", clubName: name }).then(function (o) {
        if (mine !== seq || !out.isConnected) return;
        if (!o || o.error) { out.innerHTML = '<p class="fl-err" role="alert">' + esc((o && o.error) || "The server did not answer.") + "</p>"; return; }
        res = o.clubs || [];
        out.innerHTML = !res.length ? '<p class="t-sub">No EA club is called &ldquo;' + esc(name) + '&rdquo;. Check the exact spelling.</p>' :
          '<p class="t-cap cc-sub-h">Pick ' + esc(c.t.city || c.t.name) + '&rsquo;s club</p><div class="list cc-flat">' + res.map(function (x, i) {
            return '<div class="row"><span class="grow"><span class="title">' + esc(x.name) + '</span><span class="sub">' + (x.memberCount ? x.memberCount + " members" : "EA club") + '</span></span><button type="button" class="btn secondary sm" data-cc-ea-link="' + i + '">This is us</button></div>';
          }).join("") + "</div>";
        var first = S2.$("[data-cc-ea-link]", out); if (first) first.focus({ preventScroll: true });
      }, function (e) { if (mine === seq && out.isConnected) out.innerHTML = '<p class="fl-err" role="alert">' + esc(e.message) + "</p>"; });
    }
    S2.$("[data-cc-ea]", sh.el).addEventListener("click", search);
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(); } });
    out.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cc-ea-link]"); if (!b || !res || b.disabled) return;
      var x = res[+b.dataset.ccEaLink], id = c.row && c.row.id;
      if (!id) { out.insertAdjacentHTML("beforeend", '<p class="fl-err" role="alert">This club&rsquo;s row was not read, so it cannot be linked. Reload the page.</p>'); return; }
      b.disabled = true; b.setAttribute("aria-busy", "true");
      S2.write("teams.update", { set: { ea_club_id: String(x.clubId), ea_club_name: x.name }, match: { id: id }, select: "id,ea_club_id,ea_club_name" }, { sections: ["teams"] }).then(function (r) {
        var got = (r.data || [])[0] || {};
        if (st.tx && st.tx.byCode && st.tx.byCode[c.t.code]) { st.tx.byCode[c.t.code].ea = got.ea_club_id != null; st.tx.byCode[c.t.code].eaName = got.ea_club_name || null; }
        var row = S2.$("#ccEaRow", sh.el); if (row) { row.innerHTML = eaRow(clubData().filter(function (y) { return y.t.code === c.t.code; })[0] || c); row.setAttribute("tabindex", "-1"); row.focus({ preventScroll: true }); }
        out.innerHTML = ""; q.value = "";
        S2.toast(c.t.code + " linked to " + x.name + " on EA", "ok");
      }, function (e2) { b.disabled = false; b.removeAttribute("aria-busy"); out.insertAdjacentHTML("beforeend", '<p class="fl-err" role="alert">Not linked: ' + esc(e2.message) + "</p>"); });
    });
  }
  /* who may fill a seat: the club's own active roster and the season's sign-ups (Rule 2.6: one seat, one holder; the
     league refuses a seat its rules forbid, and says why) */
  function seatPool(code) {
    var seen = {}, out = [];
    var add = function (pid, tag, pos) { if (!pid || seen[pid]) return; seen[pid] = 1; out.push({ id: pid, tag: tag || "Member", pos: pos || "" }); };
    ((M().roster(code) || {}).active || []).forEach(function (p) { add(p.id, p.tag, p.posName); });
    (M().signups || []).forEach(function (s) { add(s.pid, s.tag, s.pos); });
    return out.sort(function (a, b) { return String(a.tag).toLowerCase().localeCompare(String(b.tag).toLowerCase()); });
  }
  function seatName(pid) { var p = pid && M().player(pid); return p ? p.tag : pid ? "A member" : "Empty"; }
  function openClub(code, root) {
    var c = clubData().filter(function (x) { return x.t.code === code; })[0];
    if (!c) return;
    var t = c.t, s = c.s, field = function (id, label, val, ph) { return '<div class="field"><label for="' + id + '">' + label + '</label><input class="input" id="' + id + '" value="' + esc(val || "") + '" placeholder="' + esc(ph || "") + '"></div>'; };
    var color = function (id, label, val) { return '<div class="field"><label for="' + id + '">' + label + '</label><label class="cc-color" for="' + id + '"><input type="color" id="' + id + '" value="' + esc(val || "#000000") + '" aria-label="' + label + '"><span class="mono" data-hex="' + id + '">' + esc((val || "").toUpperCase()) + "</span></label></div>"; };
    var pool = seatPool(code), divs = M().league.divisions || ["East", "West"];
    var sh = sheet({ title: "Edit club", label: "Edit " + t.full, html:
      '<div class="cc-ed-top"><span class="cc-ring lg" id="ccEdRing" style="--c:' + esc(t.color) + '">' + M().crest(t.code, "lg") + '</span><div><b class="t-head">' + esc(t.full) + '</b><p class="t-foot">' + esc(t.division) + " Division, " + esc(t.code) + (t.founded ? ", since Season " + t.founded : "") + "</p></div></div>" +
      '<div class="cc-form">' + field("ccEdCity", "City", t.city) + field("ccEdName", "Name", t.name) + field("ccEdArena", "Arena", t.arena, "Not set") +
        '<div class="field"><span class="cc-flabel" id="ccEdDivL">Division</span><div class="seg" id="ccEdDiv" role="group" aria-labelledby="ccEdDivL">' + divs.map(function (d) { return '<button data-v="' + esc(d) + '" aria-pressed="' + (t.division === d) + '">' + esc(d) + "</button>"; }).join("") + "</div></div>" +
        color("ccEdC1", "Primary color", t.color) + color("ccEdC2", "Secondary color", t.color2) +
        '<div class="field"><label for="ccEdLogo">Logo</label><input class="input" type="file" id="ccEdLogo" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"><span class="t-foot">PNG, JPEG, WebP, GIF or SVG; shrunk to 384 pixels and uploaded when you save. The Discord role icon follows within a few minutes.</span></div></div>' +
      '<h4 class="t-cap cc-sub-h">Links</h4><div class="list cc-flat">' +
        '<div class="row" id="ccEaRow">' + eaRow(c) + "</div>" +
        '<div class="row">' + dot(c.link.role ? "ok" : "warn") + '<span class="grow"><span class="title">Discord role</span><span class="sub">' + (c.link.role ? "Set" : "Missing") + "</span></span></div>" +
        '<div class="row">' + dot(c.link.room ? "ok" : "warn") + '<span class="grow"><span class="title">Club room</span><span class="sub">' + (c.link.room ? "Set" : "Missing") + "</span></span></div></div>" +
      '<h4 class="t-cap cc-sub-h">Find the EA club</h4><div class="cc-ea"><div class="field"><label for="ccEaQ">EA club name</label><div class="cc-ea-row">' +
        '<input class="input" type="search" id="ccEaQ" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. Chel Gaming Blades">' +
        '<button type="button" class="btn secondary" data-cc-ea>Search EA</button></div></div>' + (S2.ea && S2.ea.statusLine ? S2.ea.statusLine() : "") + '<div id="ccEaOut" aria-live="polite"></div></div>' +
      /* the classic Teams editor's seat pickers (set_team_manager per changed seat, after the club row): any seat may be
         filled, changed or vacated by a commissioner (commissioner powers, standing ruling) */
      '<h4 class="t-cap cc-sub-h">Front office</h4>' + ["Owner", "GM", "AGM"].map(function (k) {
          var cur = c.seats[k];
          return '<div class="field"><label for="ccEdSeat' + k + '">' + k + "</label>" + '<select class="input" id="ccEdSeat' + k + '" data-cc-seat="' + k + '" data-was="' + esc(cur || "") + '">' +
            (cur ? '<option value="' + esc(cur) + '" selected>' + esc(seatName(cur)) + " (now)</option>" : '<option value="" selected>Empty</option>') +
            pool.filter(function (p) { return p.id !== cur; }).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.tag + (p.pos ? ", " + p.pos : "")) + "</option>"; }).join("") +
            (cur ? '<option value="">Vacate the seat</option>' : "") + "</select></div>";
        }).join("") +
        '<p class="t-foot">One seat, one holder (Rule 2.6). The league refuses a seat its rules forbid and says why; the club is saved first, then each seat in turn.</p>' +
      '<h4 class="t-cap cc-sub-h">This season</h4>' + kv([["Record", s.gp ? s.w + "-" + s.l + "-" + s.otl + ", " + s.pts + " points" : "No games"], ["Last box score", c.lastBox || "None yet"],
        ["Roster", c.counts ? c.counts.active.total + " active" : "None yet"]]) +
      '<p class="fl-err cc-ed-err" role="alert" hidden></p><div class="cc-sh-acts"><button class="btn" data-cc-save>Save changes</button><button class="btn secondary" data-cc-cancel>Cancel</button></div>' }, function () { return S2.$('[data-cc-club="' + code + '"]', root || document); });
    var seg = S2.$("#ccEdDiv", sh.el); if (seg) S2.segmented(seg);
    eaBind(sh, c, root);
    ["ccEdC1", "ccEdC2"].forEach(function (id) {   /* live preview inside the sheet only; the list behind it stays as saved */
      var inp = S2.$("#" + id, sh.el);
      inp.addEventListener("input", function () { S2.$('[data-hex="' + id + '"]', sh.el).textContent = inp.value.toUpperCase(); if (id === "ccEdC1") S2.$("#ccEdRing", sh.el).style.setProperty("--c", inp.value); });
    });
    var save = S2.$("[data-cc-save]", sh.el), err = S2.$(".cc-ed-err", sh.el);
    var say = function (m, focus) { err.textContent = m; err.hidden = false; if (focus) focus.focus(); };
    save.addEventListener("click", function () {
      if (save.disabled) return;
      var v = function (id) { return S2.$("#" + id, sh.el).value.trim(); }, city = v("ccEdCity"), name = v("ccEdName");
      var div = (S2.$('#ccEdDiv [aria-pressed="true"]', sh.el) || {}).dataset, c1 = v("ccEdC1"), c2 = v("ccEdC2"), file = (S2.$("#ccEdLogo", sh.el).files || [])[0] || null;
      err.hidden = true;
      /* fail loud: the classic form's required fields and its two-color rule (memory team-colors, NEW-TEAM RULE) */
      if (!city || !name) return say("Give the club a " + (!city ? "city" : "name") + " before saving.", S2.$(!city ? "#ccEdCity" : "#ccEdName", sh.el));
      if (c1.toLowerCase() === c2.toLowerCase()) return say("Pick the club's secondary color too: the Discord gradient and the site's accents use both.", S2.$("#ccEdC2", sh.el));
      if (file && !S2.CG.UPLOAD_MIME.test(file.type || "")) return say("That file is not a PNG, JPEG, WebP, GIF or SVG image.", S2.$("#ccEdLogo", sh.el));
      if (!c.row || !c.row.id) return say("This club's row was not read from the league, so it cannot be saved. Reload the page.");
      var set = {};
      if (city !== (t.city || "")) set.city = city;
      if (name !== (t.name || "")) set.name = name;
      if (v("ccEdArena") !== (t.arena || "")) set.arena = v("ccEdArena") || null;
      if (div && div.v && div.v !== t.division) set.division = div.v;
      if (c1.toLowerCase() !== String(t.color || "").toLowerCase()) set.color = c1;
      if (c2.toLowerCase() !== String(t.color2 || "").toLowerCase()) set.color2 = c2;
      var seats = S2.$$("[data-cc-seat]", sh.el).filter(function (sel) { return sel.value !== sel.dataset.was; }).map(function (sel) { return { role: sel.dataset.ccSeat.toLowerCase(), profile: sel.value || null }; });
      var picked = S2.$$("[data-cc-seat]", sh.el).map(function (sel) { return sel.value; }).filter(Boolean);
      if (picked.some(function (x, i) { return picked.indexOf(x) !== i; })) return say("One member can hold only one seat on a club: pick different people for Owner, GM and AGM (Rule 2.6).");
      if (!Object.keys(set).length && !seats.length && !file) { sh.close(); S2.toast("No changes to save: " + t.full + " is as it was"); return; }
      save.disabled = true; save.setAttribute("aria-busy", "true");
      var clubSaved = false;
      (file ? uploadLogo(file, t.code).then(function (url) { set.logo_url = url; }) : Promise.resolve()).then(function () {
        return Object.keys(set).length ? S2.write("teams.update", { set: set, match: { id: c.row.id } }, { sections: seats.length ? [] : ["teams"] }) : null;
      }).then(function () {
        clubSaved = true;
        /* each seat in turn: the classic applies them one at a time, since each call clears the member's prior seat first */
        return seats.reduce(function (p, ch, i) {
          return p.then(function () { return S2.write("set_team_manager", { p_team_code: t.code, p_role: ch.role, p_profile: ch.profile }, { sections: i === seats.length - 1 ? ["teams", "rosters"] : [] }); });
        }, Promise.resolve());
      }).then(function () {
        sh.close();
        st.tx = null; loadTeams(root);
        repaintPane(root);
        S2.toast("Saved " + t.full + (set.logo_url ? ". The Discord role icon follows within a few minutes." : ""), "ok");
      }, function (e) {
        save.disabled = false; save.removeAttribute("aria-busy");
        if (clubSaved && seats.length) { say("The club was saved, but a front office change was refused: " + e.message); st.tx = null; loadTeams(root); return; }
        say("Not saved: " + e.message);
      });
    });
    S2.$("[data-cc-cancel]", sh.el).addEventListener("click", function () { sh.close(); });
  }
  /* the classic logo upload (CG.uploadTeamLogo, copied into js/cg-engine.js): shrunk to 384 pixels, uploaded to the
     team-logos bucket under a fresh timestamped name, and its public address returned for teams.logo_url.
     shortcut: storage is not an S2.write door (contracts/client-api.md names RPCs and tables), so this one write goes
     through the classic's own uploader on the read client; f should add an upload door and this should use it */
  function uploadLogo(file, code) {
    var c = client(), CG = S2.CG;
    if (!c || !c.auth || !c.storage) return Promise.reject(new Error("Not connected to the league, so the logo cannot be uploaded. Reload the page and try again."));
    CG.sb = c; CG.SB_URL = S2.SB_URL; CG.SB_KEY = S2.SB_KEY;
    /* the classic uploader's messages predate the no-dash rule: said through undash, as the generator's are (review 2026-11-24) */
    return Promise.resolve().then(function () { return CG.uploadTeamLogo(file, code); }).catch(function (e) { throw new Error(undash(e && e.message ? e.message : String(e))); });
  }

  /* ================================================================ OFFICE TOOLS (the classic Control Center's
     Newsroom, homepage switches, award ballots, users and roles, and the schedule's reschedule and re-open), each on its
     own door and repainted in place. A tool needs the league's read client to list anything; without one it says so. */
  var FLAG_NAMES = { aiImport: "AI box-score import", awards: "Awards", chat: "Chat", draft: "Draft room", freeagency: "Free agency", rankings: "Power rankings", signup: "Sign-ups", trades: "Trades" };
  var AWARDS = [["mvp", "Most Valuable Player"], ["best_goalie", "Best Goaltender"], ["best_defenseman", "Best Defenseman"], ["rookie_of_year", "Rookie of the Year"]];
  function flagsNow() {
    var f = Object.assign({}, (M().config && M().config.flags) || {});
    Object.keys(st.flags).forEach(function (k) { if (st.flags[k].gen === M().generated) f[k] = st.flags[k].on; });
    return f;
  }
  function viewSeasonId() { var s = ctl().season(M().view ? M().view.season : SETUP_N); return s && s.settings ? s.settings.id : null; }
  /* news: the ONE news writer, S2.news in js/flows.js (gaps, 2026-11-25), shared with the Staff Desk's Write a story:
     news.insert as the classic Newsroom publishes a story (CG.newsForm), its checks, its byline and the Discord post that
     on_news_notify_discord makes for every category a person picks, so the form says so and Publish asks first (review
     2026-11-24: the copy had said nothing posts to Discord). The categories are the classic six, S2.CG.NEWS_CATS; each
     stores as written and shows in sentence case, the kicker voice. */
  function catLabel(c) { return S2.news.label(c); }   /* looked up at call time: control.js loads after js/flows.js on the site, and alone in tools/schedule-port-g3.test.cjs */
  function newsHtml() {
    return '<div class="cc-block" id="ccNews">' + lead("League news", "Publish a story to the newsroom. It shows on the site at once and also posts to the Discord news channel.") +
      '<div class="cc-form"><div class="field"><label for="ccNwCat">Category</label><select class="input" id="ccNwCat">' + S2.CG.NEWS_CATS.map(function (c) { return '<option value="' + esc(c) + '">' + esc(catLabel(c)) + "</option>"; }).join("") + "</select></div>" +
      '<div class="field"><label for="ccNwTitle">Headline</label><input class="input" id="ccNwTitle" maxlength="140" autocomplete="off"></div>' +
      '<div class="field"><label for="ccNwBody">Story</label><textarea class="input" id="ccNwBody" rows="4"></textarea></div></div>' +
      '<p class="fl-err" role="alert" data-cc-nwerr hidden></p><div class="cc-sh-acts"><button class="btn" data-cc-nwpost>Publish</button></div></div>';
  }
  function bindNews(root) {
    var b = S2.$("[data-cc-nwpost]", root); if (!b) return;
    b.addEventListener("click", function () {
      var host = S2.$("#ccNews", root), err = S2.$("[data-cc-nwerr]", host), tEl = S2.$("#ccNwTitle", host), bEl = S2.$("#ccNwBody", host), title = tEl.value.trim(), body = bEl.value.trim();
      var say = function (m, el) { err.textContent = m; err.hidden = false; if (el) el.focus(); };
      err.hidden = true;
      var story = { title: title, body: body, category: S2.$("#ccNwCat", host).value }, bad = S2.news.check(story);
      if (bad) return say(bad, !title || title.length < 8 ? tEl : !body ? bEl : null);
      writeSheet({ title: "Publish this story?", label: "Publish story", refocus: function () { return S2.$("[data-cc-nwpost]", root); },
        html: kv([["Headline", title], ["Category", catLabel(story.category)]]),
        why: [S2.news.SAYS],
        send: function () { return S2.news.publish(story); },
        done: function () {
          var h = S2.$("#ccNews", root);   /* cleared only once the league has the story, and only if the reader has not started another */
          if (h && S2.$("#ccNwTitle", h).value.trim() === title && S2.$("#ccNwBody", h).value.trim() === body) { S2.$("#ccNwTitle", h).value = ""; S2.$("#ccNwBody", h).value = ""; }
          S2.toast("Published: " + title + ". It is on the site and posted to the Discord news channel.", "ok");
        } });
    });
  }
  /* -- feature switches: feature_flags.update of `enabled` on the key, the commissioner's door ("commissioner writes
     flags", is_commissioner()). Not an upsert: feature_flags.label is NOT NULL with no default, and Postgres checks NOT
     NULL before ON CONFLICT can turn the insert into an update, so an upsert of {key, enabled} is refused 23502 every time
     (the trap of memory archive-status-23502; the classic homepage switches send a label with theirs, part_live.js
     CG.AFTER._admHomepage). Only keys the league returned are listed, so the row always exists; a non-commissioner's
     update is filtered by RLS to no row, which S2.write rejects S2_NO_ROWS (review 2026-11-24). The table has no id
     column, so the write asks for key and enabled back. -- */
  function flagsHtml() {
    var f = flagsNow(), keys = Object.keys(f).sort();
    return '<div class="cc-block" id="ccFlags">' + lead("Site features", "Switch a part of the site on or off for everyone. A switch moves only once the league has saved it.") +
      (keys.length ? '<div class="list cc-flat">' + keys.map(function (k) {
        return '<div class="row"><span class="grow"><span class="title">' + esc(FLAG_NAMES[k] || k) + '</span><span class="sub mono">' + esc(k) + "</span></span>" +
          '<button class="switch" role="switch" data-cc-flag="' + esc(k) + '" aria-checked="' + !!f[k] + '" aria-label="' + esc(FLAG_NAMES[k] || k) + '"></button></div>';
      }).join("") + "</div>" : empty("No feature switches were read.")) + '<p class="fl-err" role="alert" data-cc-flerr hidden></p></div>';
  }
  function bindFlags(root) {
    var host = S2.$("#ccFlags", root); if (!host) return;
    host.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cc-flag]"); if (!b || b.disabled) return;
      var k = b.dataset.ccFlag, on = !flagsNow()[k], err = S2.$("[data-cc-flerr]", host);
      b.disabled = true; b.setAttribute("aria-busy", "true"); err.hidden = true;
      S2.write("feature_flags.update", { set: { enabled: on }, match: { key: k }, select: "key,enabled" }, { sections: ["config"] }).then(function (r) {
        var got = (r.data || [])[0];
        st.flags[k] = { gen: M().generated, on: got ? !!got.enabled : on };
        var h = S2.$("#ccFlags", root); if (h) { h.outerHTML = flagsHtml(); bindFlags(root); var nb = S2.$('[data-cc-flag="' + k + '"]', root); if (nb) nb.focus(); }
        S2.toast((FLAG_NAMES[k] || k) + (st.flags[k].on ? " switched on" : " switched off"), "ok");
      }, function (e2) { b.disabled = false; b.removeAttribute("aria-busy"); err.textContent = "Not saved: " + e2.message; err.hidden = false; });
    });
  }
  /* -- season awards: the commissioner's own ballot (award_ballots upsert on season, category and voter) and
     Finalize (finalize_season_award: counts the votes for playoff-eligible players and publishes the winner) -- */
  function awardsHtml() {
    var sid = viewSeasonId(), A0 = st.ballots && st.ballots.sid === sid ? st.ballots : null, me = S2.session && S2.session.profileId;
    var pool = M().players.filter(function (p) { return p.rostered || p.club; });
    if (!client()) return '<div class="cc-block" id="ccAwards">' + lead("Season awards", "The ballots are read from the league, which this page cannot reach here.") + "</div>";
    return '<div class="cc-block" id="ccAwards">' + lead("Season awards", A0 ? (A0.err ? "The ballots could not be read: " + esc(A0.err) : "Your vote in each award, the votes so far, and Finalize, which counts them and publishes the winner.") : "Reading the ballots.") +
      (A0 && !A0.err ? '<div class="list cc-flat">' + AWARDS.map(function (a) {
        var votes = A0.rows.filter(function (x) { return x.category === a[0]; }), mine = votes.filter(function (x) { return x.voter_id === me; })[0], cnt = {};
        votes.forEach(function (v) { cnt[v.profile_id] = (cnt[v.profile_id] || 0) + 1; });
        var top = Object.keys(cnt).sort(function (x, y) { return cnt[y] - cnt[x]; }).slice(0, 3).map(function (pid) { return seatName(pid) + " (" + cnt[pid] + ")"; });
        return '<div class="row cc-award" data-cc-award="' + a[0] + '"><span class="grow"><span class="title">' + esc(a[1]) + '</span><span class="sub">' + (votes.length ? votes.length + (votes.length === 1 ? " vote" : " votes") + "; leading: " + esc(top.join(", ")) : "No votes yet") + "</span></span>" +
          '<select class="input cc-sel" aria-label="Your vote for ' + esc(a[1]) + '" data-cc-vote="' + a[0] + '"><option value="">Your vote</option>' + pool.map(function (p) { return '<option value="' + esc(p.id) + '"' + (mine && mine.profile_id === p.id ? " selected" : "") + ">" + esc(p.tag) + "</option>"; }).join("") + "</select>" +
          '<button class="btn secondary sm" data-cc-votesave="' + a[0] + '">Save vote</button><button class="btn sm" data-cc-final="' + a[0] + '">Finalize</button></div>';
      }).join("") + '</div><p class="fl-err" role="alert" data-cc-awerr hidden></p>' : "") + "</div>";
  }
  function loadBallots(root) {
    var sid = viewSeasonId(); if (!client() || !sid || st.busy.ballots) return;
    st.busy.ballots = true;
    rd(function (c) { return c.from("award_ballots").select("category,voter_id,profile_id").eq("season_id", sid); }).then(function (rows) { st.ballots = { sid: sid, rows: rows || [], err: null }; },
      function (e) { st.ballots = { sid: sid, rows: [], err: e.message }; }).then(function () {
      st.busy.ballots = false;
      var h = S2.$("#ccAwards", root); if (h) { h.outerHTML = awardsHtml(); bindAwards(root); }
    });
  }
  function bindAwards(root) {
    var host = S2.$("#ccAwards", root); if (!host) return;
    if (client() && !(st.ballots && st.ballots.sid === viewSeasonId())) { loadBallots(root); return; }
    host.addEventListener("click", function (e) {
      var sv = e.target.closest("[data-cc-votesave]"), fin = e.target.closest("[data-cc-final]"), err = S2.$("[data-cc-awerr]", host);
      if (sv && !sv.disabled) {
        var cat = sv.dataset.ccVotesave, sel = S2.$('[data-cc-vote="' + cat + '"]', host);
        if (!sel.value) { err.textContent = "Pick a player first."; err.hidden = false; sel.focus(); return; }
        sv.disabled = true; err.hidden = true;
        S2.write("award_ballots.upsert", { row: { season_id: viewSeasonId(), category: cat, voter_id: S2.session.profileId, profile_id: sel.value, updated_at: new Date().toISOString() }, onConflict: "season_id,category,voter_id" }, {}).then(function () {
          st.ballots = null; loadBallots(root); S2.toast("Vote saved; change it any time", "ok");
        }, function (e2) { sv.disabled = false; err.textContent = "Not saved: " + e2.message; err.hidden = false; });
      }
      if (fin) {
        var c2 = fin.dataset.ccFinal, label = (AWARDS.filter(function (a) { return a[0] === c2; })[0] || [0, c2])[1];
        writeSheet({ title: "Finalize " + label + "?", label: "Finalize award", refocus: function () { return S2.$('[data-cc-final="' + c2 + '"]', root); },
          why: ["Counts the votes for playoff-eligible players and publishes the winner to the Awards page and the newsroom. A tied vote stops and asks you to pick one of the tied players."],
          send: function () { return S2.write("finalize_season_award", { p_season: viewSeasonId(), p_category: c2 }, { sections: ["honors", "news"] }); },
          done: function (r) { S2.toast(String(r.data || "The winner") + " wins " + label, "ok"); st.ballots = null; loadBallots(root); } });
      }
    });
  }
  /* -- users and roles: set_member_role (Member, Staff, Commissioner); club seats are set on the club, never here -- */
  var ROLE_NAMES = { member: "Member", staff: "Staff", commissioner: "Commissioner" };
  function rolesHtml() {
    return '<div class="cc-block" id="ccRoles">' + lead("Member roles", client() ? "Find a member by gamertag to make them staff or a commissioner, or a member again. Club seats are set on the club, under Clubs." : "Roles are read from the league, which this page cannot reach here.") +
      (client() ? '<div class="field"><label for="ccRoleQ">Gamertag</label><input class="input" type="search" id="ccRoleQ" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="Two letters or more"></div><div id="ccRoleOut" aria-live="polite"></div>' : "") + "</div>";
  }
  function roleRows(rows) {
    if (!rows.length) return '<p class="t-sub">Nobody matches.</p>';
    return '<div class="list cc-flat">' + rows.map(function (r) {
      var cur = r.role === "commissioner" || r.role === "staff" ? r.role : "member";
      return '<div class="row" data-cc-role-row="' + esc(r.id) + '"><span class="grow"><span class="title">' + esc(r.gamertag || r.display_name || "Member") + '</span><span class="sub">' + esc(ROLE_NAMES[cur] + (r.role && !ROLE_NAMES[r.role] ? ", " + r.role.toUpperCase() + " seat" : "")) + "</span></span>" +
        '<select class="input cc-sel" aria-label="Role for ' + esc(r.gamertag || "this member") + '" data-cc-role="' + esc(r.id) + '" data-was="' + cur + '">' + Object.keys(ROLE_NAMES).map(function (k) { return '<option value="' + k + '"' + (k === cur ? " selected" : "") + ">" + ROLE_NAMES[k] + "</option>"; }).join("") + "</select></div>";
    }).join("") + "</div>";
  }
  function bindRoles(root) {
    var q = S2.$("#ccRoleQ", root), out = S2.$("#ccRoleOut", root); if (!q) return;
    var seq = 0, timer = 0, rows = [];
    function search() {
      var t = q.value.trim(), mine = ++seq;
      if (t.length < 2) { out.innerHTML = ""; return; }
      rd(function (c) { return c.from("profiles").select("id,gamertag,display_name,role").ilike("gamertag", "%" + t.replace(/[%_\\]/g, "\\$&") + "%").order("gamertag").limit(20); }).then(function (r) {
        if (mine !== seq) return; rows = r || []; out.innerHTML = roleRows(rows);   /* only the results repaint, never the field being typed in */
      }, function (e) { if (mine === seq) out.innerHTML = '<p class="fl-err" role="alert">' + esc(e.message) + "</p>"; });
    }
    q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(search, 250); });
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); search(); } });
    out.addEventListener("change", function (e) {
      var sel = e.target.closest("[data-cc-role]"); if (!sel) return;
      var pid = sel.dataset.ccRole, role = sel.value, was = sel.dataset.was, r = rows.filter(function (x) { return x.id === pid; })[0] || {}, name = r.gamertag || "this member";
      sel.value = was;   /* the list shows the saved role until the league confirms a new one */
      writeSheet({ title: "Make " + name + " " + (role === "commissioner" ? "a Commissioner" : role === "staff" ? "Staff" : "a Member") + "?", label: "Set role", refocus: function () { return S2.$('[data-cc-role="' + pid + '"]', root); },
        why: [role === "commissioner" ? "Commissioners have full league control and can't hold a club seat. The last commissioner can't be demoted." : role === "staff" ? "Staff work the case queue and reviews, and can't own or manage a club." : "Member is a normal player account."],
        send: function () { return S2.write("set_member_role", { p_target: pid, p_role: role, p_team_code: null }, { sections: ["people"] }); },
        done: function () { S2.toast(name + " is now " + ROLE_NAMES[role], "ok"); search(); } });
    });
  }
  /* -- a game: reschedule (ops_reschedule_game, which re-derives the week, audits it and refuses a final) or re-open a
     wrongly matched final (reopen_game_final: the result and box score are cleared, the archived payload stays) -- */
  function fixHtml() {
    var gs = M().games.filter(function (g) { return g.stage !== "preseason"; }).slice().sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); });
    var lab = function (g) { return (g.stage === "playoff" ? "Playoffs" : "Week " + g.week) + ", " + M().etFull(g.at).replace(/, \d{4}$/, "") + " " + M().etTime(g.at) + ": " + g.away + " at " + g.home + (g.isFinal ? " (final)" : ""); };
    return '<div class="cc-block" id="ccFix">' + lead("Move or re-open a game", gs.length ? "A moved game is played on top of the week it lands in (Rule 3.3); a re-opened final loses its result and box score so the right import can land." : "This season has no games yet.") +
      (gs.length ? '<div class="cc-form"><div class="field"><label for="ccFixG">Game</label><select class="input" id="ccFixG"><option value="">Pick a game</option>' + gs.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(lab(g)) + "</option>"; }).join("") + "</select></div>" +
        '<div class="field"><label for="ccFixAt">New date and time (Eastern)</label><input class="input" type="datetime-local" id="ccFixAt"></div></div>' +
        '<div class="cc-sh-acts"><button class="btn" data-cc-move>Move the game</button><button class="btn secondary" data-cc-reopen>Re-open the final</button></div><p class="fl-err" role="alert" data-cc-fixerr hidden></p>' : "") + "</div>";
  }
  function bindFix(root) {
    var host = S2.$("#ccFix", root); if (!host || !S2.$("#ccFixG", host)) return;
    var err = S2.$("[data-cc-fixerr]", host), say = function (m) { err.textContent = m; err.hidden = false; };
    var pick = function () { var id = S2.$("#ccFixG", host).value; return id ? M().games.filter(function (g) { return g.id === id; })[0] : null; };
    S2.$("#ccFixG", host).addEventListener("change", function () { var g = pick(); err.hidden = true; if (g) S2.$("#ccFixAt", host).value = etLocal(g.at); });
    S2.$("[data-cc-move]", host).addEventListener("click", function () {
      var g = pick(), v = S2.$("#ccFixAt", host).value; err.hidden = true;
      if (!g) return say("Pick the game first.");
      if (g.isFinal) return say("A final cannot be moved. Re-open it first if its result was matched to the wrong game.");
      var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v), at = m && etAt(m[1], m[2]);
      if (!at) return say("Pick the new date and time.");
      writeSheet({ title: "Move " + g.away + " at " + g.home + "?", label: "Move the game", refocus: function () { return S2.$("[data-cc-move]", root); },
        why: ["To " + M().etFull(at).replace(/, \d{4}$/, "") + ", " + M().etTime(at) + " ET. Both clubs see the new time at once; codes and server picks carry over. A game moved into another week counts toward the week it is played in, on top of that week's games (Rule 3.3)."],
        send: function () { return S2.write("ops_reschedule_game", { p_game: g.id, p_at: at }, { sections: ["games"], gameIds: [g.id] }); },
        done: function () { S2.toast("Game moved to " + M().etFull(at).replace(/, \d{4}$/, "") + ", " + M().etTime(at) + " ET", "ok"); } });
    });
    S2.$("[data-cc-reopen]", host).addEventListener("click", function () {
      var g = pick(); err.hidden = true;
      if (!g) return say("Pick the game first.");
      if (!g.isFinal) return say("Only a final can be re-opened.");
      writeSheet({ title: "Re-open " + g.away + " at " + g.home + "?", label: "Re-open the game", danger: true, refocus: function () { return S2.$("[data-cc-reopen]", root); },
        why: ["The final score and every box-score stat for this game are cleared and it returns to the schedule. Use this when the EA match that claimed the slot was actually a different game (a scrim between the same clubs). The archived payload stays replayable."],
        send: function () { return S2.write("reopen_game_final", { p_game: g.id }, { sections: ["games", "box"], gameIds: [g.id] }); },
        done: function () { S2.toast("Game re-opened: the result and box score were cleared", "ok"); } });
    });
  }

  /* ======================================================================================================= STAFF */
  /* Season 2 staffing (commissioner ruling, 2026-10-19): "we will remove the different departments, and we will allow
     every staff member to be a part of one big group. We want to appoint committee managers that have more knowledge
     and focus in more on a specific topic, but everyone can do any staff role for the most part." Nothing here invents
     a permission: what a manager adds is a proposal, and the caps the ruling is silent on are the open decisions. */
  /* the commissioner's staffing rulings of 2026-11-23 (they replaced the open questions this list used to hold): one vote
     each, committees as topics, one manager each, and one seat with powers of its own */
  var RULINGS = [
    /* n: every voter, the staff and the commissioners (commissioner, 2026-11-23), from staff_voter_count() (the Staff Desk reads it, S2._desk.LV.voters); eleven on 2026-11-24, six to pass */
    ["Every staffer votes, commissioners too", function (n) { return "On owner, staff, GM or AGM and committee manager applications. One passes when more than half of them approve" + (n ? ": " + (Math.floor(n / 2) + 1) + " of " + n + " today" : "") + ". You vote like everyone, and may also decide one alone from its page on the Staff Desk (Rule 2.6)."; }],
    ["Who suspends", function () { return "A committee manager or a commissioner. A manager issues up to 14 days, or up to 18 games in steps of three; anything longer is applied for and you approve it or not. Other staff may request a suspension. Bans are yours alone."; }],
    ["How a manager is chosen", function () { return "Staff apply for an open manager seat, and the other staff and the commissioners vote, at more than half. Until a Draft and Bidding manager is seated, only a commissioner pauses and resumes Saturday bidding."; }]];
  var ADDS = [["The committee's priorities", "The manager decides what its topic takes on first."], ["The go-to person", "Questions and conversations about the topic go to them."],
    ["No extra vote", "Every staffer's vote counts the same, the manager's included."], ["Suspensions and appeals", "Every manager may suspend within Rule 7.2 and decide appeals (Rule 7.6)."],
    ["Draft and Bidding", "Its manager, or a commissioner, also pauses and resumes Saturday bidding and runs the draft room (Rule S2.8)."]];
  /* who holds each seat and who is on staff: the Staff Desk's own reads of public.committees and s2_desk() (js/pages/desk.js
     S2._desk.LV), one definition. The Control Center shows the holders and appoints nobody: a seat is filled by staff
     applying and the other staff voting (RULING 2026-11-23). Until the desk has read them, the tab says so */
  function deskLV() { return S2._desk && S2._desk.LV.state === "ready" ? S2._desk.LV : null; }
  function managers() {
    var m = {}, L = deskLV();
    COMMITTEES.forEach(function (c) { m[c[0]] = null; });
    if (L) (L.coms || []).forEach(function (x) { if (x.manager_profile_id && x.key in m) m[x.key] = (x.manager && x.manager.gamertag) || "A staff member"; });
    return m;
  }
  function managing(name) { var m = managers(); return COMMITTEES.filter(function (c) { return m[c[0]] === name; }); }
  function mgrHead() {
    if (!deskLV()) return deskState() === "error" ? "The seats could not be read" : "Reading the seats";
    var m = managers(), n = COMMITTEES.filter(function (c) { return m[c[0]]; }).length; return n + " of " + COMMITTEES.length + " committees have a manager";
  }
  /* what waits in a committee's topic right now: the Staff Desk's own queue, each item tagged with its committee. Trade
     requests are never in it: Rule 2.3 sends them to the club's front office, not the staff. */
  function queueOf(key) { return deskNow().filter(function (a) { return a.c === key; }).map(function (a) { return a.label; }); }
  function avatar(name) { return name ? '<span class="avatar cc-av" aria-hidden="true">' + esc(S2.initials(name)) + "</span>" : '<span class="avatar cc-av empty" aria-hidden="true"></span>'; }
  function committeesHtml() {
    var m = managers(), ready = !!deskLV();
    return '<ul class="cc-cmts" id="ccCmts">' + COMMITTEES.map(function (c) {
      var q = queueOf(c[0]), who = m[c[0]];
      return '<li class="cc-cmt"><div class="cc-cmt-t"><h5 class="cc-cmt-n">' + esc(c[1]) + "</h5><p>" + esc(c[2]) + "</p></div>" +
        '<p class="cc-cmt-q"><span class="cc-k">On the desk</span>' + (!ready ? '<span class="cc-calm">Reading the desk</span>' : q.length ? q.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") : '<span class="cc-calm">Nothing waiting</span>') + "</p>" +
        /* the holder, read-only: no Change, because no one appoints a manager (RULING 2026-11-23) */
        '<div class="cc-mgr" role="group" aria-label="' + esc(!ready ? "Reading who manages " + c[1] : (who ? who + " manages " : "No manager yet for ") + c[1]) + '">' + avatar(who) +
          '<span class="grow"><span class="title">' + esc(!ready ? "Reading the seat" : who || "No manager yet") + '</span><span class="sub">' + (!ready ? "From the league's committees" : who ? "Manager, chosen by a staff vote" : "Open: staff apply and the other staff vote") + "</span></span></div></li>";
    }).join("") + "</ul>";
  }
  function staffListHtml() {
    var L = deskLV();
    if (!L) return '<div id="ccStaffList">' + (deskState() === "error" ? S2.empty("err", "The staff list did not load", esc((S2._desk && S2._desk.LV.err) || "The league did not answer.")) : empty("Reading the staff list.")) + "</div>";
    if (!L.staff.length) return '<div id="ccStaffList">' + empty("The league returned no staff list.") + "</div>";
    return '<ul class="cc-staff" id="ccStaffList">' + L.staff.map(function (s) {
      var nm = s.gamertag || "A staff member", mg = managing(nm);
      return "<li>" + avatar(nm) + '<span class="grow"><span class="title">' + esc(nm) + '</span><span class="sub">' + (s.role === "commissioner" ? "Commissioner" : mg.length ? "Manages " + esc(mg.map(function (c) { return c[1]; }).join(" and ")) : "Staff, no committee to manage") + "</span></span>" +
        (mg.length ? '<span class="chip">Manager</span>' : "") + "</li>";
    }).join("") + "</ul>";
  }
  /* the two sentences that carry the staff count, repainted in place when the desk's reads land (repaintStaff) */
  function staffN() { var L = deskLV(); return L ? L.staff.filter(function (s) { return s.role !== "commissioner"; }).length : null; }
  function commishN() { var L = deskLV(); return L ? L.staff.filter(function (s) { return s.role === "commissioner"; }).length : null; }
  function staffHeadText() { var n = staffN(); return (n == null ? "The staff" : n + " staff") + ", six committees"; }
  function groupText() {
    var L = deskLV(), n = staffN(), pend = L ? (L.apps || []).filter(function (a) { return a.type === "staff" && a.stage === "ballot"; }).length : 0;
    /* qa (function 27): the list under this sentence holds the commissioners too, so the sentence counts both */
    var c = commishN();
    return (n == null ? "The staff in one list" : (n === 1 ? "One staffer" : n + " staffers") + (c ? " and " + (c === 1 ? "one commissioner" : c + " commissioners") : "") + " in one list") + ", each able to work any part of the desk." + (pend ? " " + (pend === 1 ? "One staff application is" : pend + " staff applications are") + " waiting." : "");
  }
  function staffPane(first) {
    var L = deskLV();
    return '<h2 class="sr" id="ccPaneTitle">Staff</h2>' +
      band("a", secHead("Season 2 staffing", staffHeadText(), "Departments are gone for Season 2. Every staffer can work the whole Staff Desk, and each committee has one manager who sets its priorities; anyone may still pick up its work.", arrowLink("#/desk", "Open the Staff Desk"), "ccStaffHead") +
        lead(mgrHead(), "A seat is filled by staff applying and all the other staff voting; the Control Center shows who holds each, and appoints no one.", "", "ccMgrHead") + committeesHtml(), first) +
      band("w", '<div class="cc-cols"><div>' + lead("What a manager adds", "Your ruling of November 23: priorities and questions, no extra vote, suspensions within Rule 7.2 and appeals for every manager, and the bidding pause and the draft room for the Draft and Bidding seat.", "") +
          '<ul class="cc-adds">' + ADDS.map(function (a) { return "<li><b>" + a[0] + "</b><span>" + a[1] + "</span></li>"; }).join("") + "</ul></div>" +
        "<div>" + lead("The staff group", groupText(), arrowLink("#/desk?tab=applications", "Applications"), "ccGroupHead") + staffListHtml() + "</div></div>" + rolesHtml(), first) +
      band("a", secHead("Your rulings, November 23", "One vote each, and who suspends", "Rule S2.8 holds each committee's charter and Rule 7.2 who may suspend.") +
        '<ul class="cc-decs">' + RULINGS.map(function (d) { return '<li><h4 class="d-3">' + esc(d[0]) + "</h4><p>" + esc(d[1](L && L.voters != null ? L.voters : null)) + "</p></li>"; }).join("") + "</ul>" +
        about([["The staff", "The staff list is s2_desk()'s and the seats are public.committees', both as the Staff Desk reads them."],
          ["On the desk", "Waiting items are the Staff Desk's own queue (its cases, applications, suspension requests and the games waiting on it), tagged to a committee by topic. Trade requests are not staff work: they go to the club's front office (Rule 2.3)."],
          ["Seats", "A seat changes only when a committee manager application is approved by the staff vote on the Staff Desk."],
          ["The rulings", "Season 2 staffing, commissioner, October 19, 2026: no departments, one staff group, committee managers by topic. November 23, 2026: six committees with their charters, every staffer's vote equal, managers chosen by a staff vote, the Draft and Bidding seat's powers, and who may suspend."]]), first);
  }
  function repaintStaff(root) {   /* in place: the committee list, the staff list and the count; nothing else moves */
    var a = S2.$("#ccCmts", root), b = S2.$("#ccStaffList", root), h = S2.$("#ccMgrHead", root);
    if (a) a.outerHTML = committeesHtml();
    if (b) b.outerHTML = staffListHtml();
    if (h) h.textContent = mgrHead();
    var sh = S2.$("#ccStaffHead", root), gs = S2.$("#ccGroupHeadS", root), dl = S2.$("#ccPane .cc-decs", root), L = deskLV();
    if (sh) sh.textContent = staffHeadText();
    if (gs) gs.textContent = groupText();
    if (dl) S2.$$("p", dl).forEach(function (p, i) { p.textContent = RULINGS[i][1](L && L.voters != null ? L.voters : null); });
    bindStaff(root);
  }
  function bindStaff() {}   /* nothing to bind: the seats are read-only here (2026-11-23) */

  /* ====================================================================================================== SYSTEM */
  function every(sched) {
    if (!sched) return "–";
    if (/second/.test(sched)) return "Every " + sched.replace(/ seconds?/, "\u00a0s");
    var p = sched.split(" ");
    if (p.length !== 5) return sched;
    if (p.join(" ") === "* * * * *") return "Every minute";
    if (/^\*\/\d+$/.test(p[0]) && p[1] === "*") return "Every " + p[0].slice(2) + "\u00a0min";
    if (/^\d+$/.test(p[0]) && p[1] === "*") return "Hourly at :" + ("0" + p[0]).slice(-2);
    if (/^\d+$/.test(p[0]) && /^\d+$/.test(p[1])) {
      var et = new Date(Date.UTC(2026, 9, 19, +p[1], +p[0])).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
      return (p[4] === "1" ? "Mondays " : p[4] !== "*" ? "Weekly " : "Daily ") + et + " ET";
    }
    return sched;
  }
  function ms(n) { return n == null ? "–" : n >= 1000 ? (n / 1000).toFixed(1) + "\u00a0s" : n + "\u00a0ms"; }   /* no-break space: a unit never wraps away from its number */
  /* a sortable table, one definition for the database jobs and the heartbeats: cols are [key, label, first-press
     direction, wide]; a narrow pane hides the wide columns and the first cell folds them in (.cc-meta-s, the audit
     table's pattern); s is the table's { key, dir } in st, so a sort outlives a repaint */
  function sortTable(id, cls, cols, rows, s, row, none) {
    if (!rows.length) return '<div id="' + id + '" class="cc-pad">' + empty(none) + "</div>";
    var k = s.key, d = s.dir, k0 = cols[0][0];
    rows = rows.slice().sort(function (a, b) { var x = a[k], y = b[k]; return (typeof x === "string" ? x.localeCompare(y) : (x || 0) - (y || 0)) * d || a[k0].localeCompare(b[k0]); });
    return '<div class="tbl-wrap" id="' + id + '"><table class="tbl cc-tbl cc-sort ' + cls + '"><thead><tr>' + cols.map(function (c) {
      var on = c[0] === k;
      return "<th" + (c[3] ? ' class="cc-wide"' : "") + (on ? ' aria-sort="' + (d > 0 ? "ascending" : "descending") + '"' : "") + '><button data-cc-sort="' + c[0] + '">' + c[1] +
        (on ? '<span aria-hidden="true">' + (d > 0 ? "↑" : "↓") + "</span>" : "") + "</button></th>"; }).join("") + "</tr></thead><tbody>" + rows.map(row).join("") + "</tbody></table></div>";
  }
  function bindSort(pane, id, cols, s, html) {
    S2.$$("#" + id + " [data-cc-sort]", pane).forEach(function (b) { b.addEventListener("click", function () {
      var k = b.dataset.ccSort; s.dir = s.key === k ? -s.dir : (cols.filter(function (c) { return c[0] === k; })[0] || [0, 0, 1])[2]; s.key = k;
      var host = S2.$("#" + id, pane), sl = host.scrollLeft; host.outerHTML = html(); S2.$("#" + id, pane).scrollLeft = sl; bindSort(pane, id, cols, s, html);
      var nb = S2.$("#" + id + ' [data-cc-sort="' + k + '"]', pane); if (nb) nb.focus();
    }); });
  }
  /* everything healthy waits behind one disclosure (heartbeats, database jobs): the summary says what it does open or shut */
  function showAll(show, hide, inner) {
    return '<details class="cc-all"><summary><span class="cc-show">' + show + '</span><span class="cc-hide">' + hide + '</span><span class="about-x" aria-hidden="true"></span></summary>' + inner + "</details>";
  }
  /* a database job needs a look when it failed in the last 7 days or is late: past twice its schedule and at least five
     minutes past it, the heartbeats' own rule (cronOk, the one definition jobHealth counts) */
  function cronWatch() { return ctl().jobs.cron.filter(function (c) { return !cronOk(c); }); }
  /* Failures, the number that matters, stays in view beside the job on a narrow pane */
  var CRON_COLS = [["job", "Job", 1], ["cadenceMin", "Schedule", 1, 1], ["last_min_ago", "Last ran", 1, 1], ["p50_ms", "Median run", -1, 1], ["runs_24h", "Runs, 24 h", -1, 1], ["fails_7d", "Failures, 7 days", -1]];
  /* ops_job_health gives each job's last run (when, how long, how it ended), not a 7-day tally, so the live table says that */
  var CRON_LIVE = [["job", "Job", 1], ["cadenceMin", "Schedule", 1, 1], ["last_min_ago", "Last ran", 1, 1], ["last_ms", "Last run took", -1, 1], ["last_status", "Last result", 1]];
  function cronCols() { return ctl().jobs.live ? CRON_LIVE : CRON_COLS; }
  function cronTable() {
    if (ctl().jobs.live) return sortTable("ccCron", "cc-cron", CRON_LIVE, ctl().jobs.cron, st.cron, function (c) {
      return "<tr><td>" + dot(cronOk(c) ? "ok" : c.healthy ? "warn" : "loss") + '<span class="mono">' + esc(c.job) + '</span><span class="cc-meta-s">' + esc(every(c.schedule) + ", ran " + c.ago + ", took " + ms(c.last_ms)) + "</span>" +
        '</td><td class="cc-wide">' + esc(every(c.schedule)) + '</td><td class="cc-wide">' + esc(c.ago) + '</td><td class="num cc-wide">' + ms(c.last_ms) +
        '</td><td class="' + (c.healthy ? "" : "cc-bad") + '">' + esc(!c.active ? "Switched off" : c.last_status === "succeeded" ? "Succeeded" : c.last_status === "failed" ? "Failed" : c.last_status) + "</td></tr>"; }, "No database jobs were read, so their health is unknown.");
    return sortTable("ccCron", "cc-cron", CRON_COLS, ctl().jobs.cron, st.cron, function (c) {
      return "<tr><td>" + dot(cronOk(c) ? "ok" : c.healthy ? "warn" : "loss") + '<span class="mono">' + esc(c.job) + '</span><span class="cc-meta-s">' + esc(every(c.schedule) + ", ran " + c.ago + ", " + fmt(c.runs_24h) + (c.runs_24h === 1 ? "\u00a0run" : "\u00a0runs") + " in 24\u00a0h, median " + ms(c.p50_ms)) + "</span>" +
        '</td><td class="cc-wide">' + esc(every(c.schedule)) + '</td><td class="cc-wide">' + esc(c.ago) + '</td><td class="num cc-wide">' + ms(c.p50_ms) + '</td><td class="num cc-wide">' + fmt(c.runs_24h) +
        '</td><td class="num' + (c.fails_7d ? " cc-bad" : "") + '">' + fmt(c.fails_7d) + "</td></tr>"; }, "No database jobs were read, so their health is unknown.");
  }
  /* heartbeats: a worker is stale past twice its schedule (and at least five minutes past it), or past an hour with no
     fixed schedule, the model's own rule (M.control.jobs.heartbeats .fresh); "close" is the last quarter before that */
  function span(min) { return min < 60 ? min + "\u00a0min" : min < 1440 ? Math.round(min / 60) + "\u00a0h" : Math.round(min / 1440) + "\u00a0days"; }
  /* qa (function 23): which heartbeats are a worker's pulse. ops_job_health returns every rl_ key app_config ever held
     (41 on 2026-11-25), and the System tab counted all of them: "22 workers need a look", most of them keys of pg_cron
     jobs whose old Netlify writer is gone (rl_rookie-distribution, 129 days) or that beat only when they have work
     (rl_night-recap). So a key reads by its job's name and is one of three kinds:
       beat     an Edge Function's (job_hosts) or a worker outside the database (VM_WORKERS): its heartbeat IS its health,
                so it is watched and counted;
       cron     a pg_cron job's (its name, with _ read as -, or the job's name ends with it, as automation-watchdog for
                rl_watchdog): that job's own run in the database jobs list is its health, so the key is listed, not counted;
       retired  nothing schedules it: listed under Show all, never counted.
     shortcut: VM_WORKERS names the bot server's workers by hand (bot/: the gateway bot, the EA poller and its fallback, the
     EA club search relay); a new worker outside the database joins this list, or it reads as retired */
  var VM_WORKERS = { "ea-poll-vm": 1, "ea-poll": 1, "gateway-bot": 1, "ea-lookup": 1 };
  function hbJob(key, J) {
    var m = /^(?:rl_)?(.+?)(_result|_started)?$/.exec(key), base = m[1], name = base + (m[2] ? " (" + m[2].slice(1) + ")" : "");
    if (VM_WORKERS[base] || J.edge.some(function (e) { return e.fn === base; })) return { name: name, kind: "beat" };
    var dash = base.replace(/_/g, "-"), c = J.cron.filter(function (x) { return x.job === base || x.job === dash || x.job.slice(-dash.length - 1) === "-" + dash; })[0];
    return c ? { name: name, kind: "cron", job: c.job } : { name: name, kind: "retired" };
  }
  function hbRows() {
    var J = ctl().jobs;
    return J.heartbeats.map(function (h) {
      var cad = h.cadenceMin, lim = cad ? Math.max(2 * cad, cad + 5) : 60, job = hbJob(h.key, J);
      return { key: job.name, raw: h.key, live: job.kind === "beat", kind: job.kind, job: job.job, ago: h.ago, ageMin: h.ageMin, fresh: h.fresh, close: h.fresh && h.ageMin >= 0.75 * lim, every: cad || 1e9, lim: lim,   /* no schedule sorts as the longest */
        sched: job.kind === "cron" ? "Judged by its database job, " + job.job : job.kind === "retired" ? "Retired: nothing schedules it" : cad ? (cad >= 10080 ? "Weekly" : cad >= 1440 ? "Daily" : "Every\u00a0" + cad + "\u00a0min") : "No fixed schedule" };
    });
  }
  var HB_COLS = [["key", "Worker", 1], ["ageMin", "Last check-in", -1], ["every", "Schedule", 1, 1], ["lim", "Stale after", 1, 1]];
  function hbTable() {
    return sortTable("ccHbs", "cc-beats", HB_COLS, hbRows(), st.hb, function (h) {
      if (!h.live) return "<tr><td>" + dot("off") + '<span class="mono">' + esc(h.key) + '</span><span class="cc-meta-s">' + esc(h.sched) + "</span>" +
        '</td><td class="t-foot">' + esc(h.ago) + '</td><td class="cc-wide">' + esc(h.sched) + '</td><td class="cc-wide">–</td></tr>';
      return "<tr><td>" + dot(!h.fresh ? "loss" : h.close ? "warn" : "ok") + '<span class="mono">' + esc(h.key) + '</span><span class="cc-meta-s">' + esc(h.sched + ", stale after " + span(h.lim)) + "</span>" +
        '</td><td class="' + (!h.fresh ? "cc-bad" : h.close ? "cc-warn" : "") + '">' + esc(h.ago) + '</td><td class="cc-wide">' + esc(h.sched) + '</td><td class="cc-wide">' + span(h.lim) + "</td></tr>"; },
      "No heartbeats were read, so no worker can be called fresh.");
  }
  function system(first) {
    /* before ops_job_health() answers the lists are empty, and empty is not "nothing came back" (review 2026-11-25) */
    if (client() && !st.live) return '<h2 class="sr" id="ccPaneTitle">System</h2>' + band("a", secHead("System", "Reading the job health", "From ops_job_health(), commissioners only."), first);
    var H = jobHealth(), J = H.J, all = H.all, ok = H.ok, miss = H.missing;
    var HB = hbRows(), beating = HB.filter(function (h) { return h.live; }), retired = HB.length - beating.length;
    var byJob = HB.filter(function (h) { return h.kind === "cron"; }).length;
    retired -= byJob;
    var fresh = beating.filter(function (h) { return h.fresh; }).length, fails = J.live ? J.cron.filter(function (c) { return c.last_status === "failed"; }).length : J.cron.reduce(function (s, c) { return s + (c.fails_7d || 0); }, 0);
    var again = client() ? '<button class="btn secondary sm" data-cc-relive' + (st.busy.live ? ' disabled aria-busy="true"' : "") + ">Read again</button>" : null;
    var watch = beating.filter(function (h) { return !h.fresh || h.close; }).sort(function (a, b) { return b.ageMin / b.lim - a.ageMin / a.lim; });   /* nearest to stale first */
    var cw = cronWatch();
    return '<h2 class="sr" id="ccPaneTitle">System</h2>' +
      band("a", secHead("System", miss.length ? "Job health could not be read" : H.healthy ? "All " + all + " jobs healthy" : ok + " of " + all + " jobs healthy",
          miss.length ? (liveErr("jobs") ? "The league refused the job read (" + esc(liveErr("jobs")) + "), " : "No " + (miss.length > 1 ? miss.slice(0, -1).join(", ") + " or " : "") + miss[miss.length - 1] + " came back, ") + "so this page cannot call the jobs healthy."
            : J.edge.length + " Edge Functions and " + J.cron.length + " database jobs, " + (J.live ? (fails ? fails + (fails === 1 ? " whose last run failed" : " whose last runs failed") : "every last run succeeded") + ", read " + esc(hm(st.live.at)) + " ET" : "with " + (fails ? fails + " failures" : "no failures") + " in the last 7 days") + ". " + fresh + " of " + beating.length + " heartbeats are fresh.", again) +   /* qa (function 23): the watched workers, as the heartbeat band counts */
        lead(J.edge.length + " automations", "The jobs that post to Discord, all on Supabase Edge since October 15.") +
        (J.edge.length ? '<div class="list cc-list">' + J.edge.map(function (e) {
          return edgeRow(e); }).join("") + "</div>" : empty("No Edge Functions were read, so their health is unknown.")), first) +
      /* database jobs: what needs a look leads, and all of them wait behind Show all (review 2026-10-20: 27 identical green
         rows were the wall the heartbeats had already lost) */
      band("w", lead(J.cron.length + " database jobs", !J.cron.length ? "" : cw.length ? (cw.length === 1 ? "One job needs" : cw.length + " jobs need") + " a look; every other one ran on schedule."
          : "Every pg_cron job ran on schedule, with no failures in the last 7 days.") +
        (cw.length ? '<div class="list cc-list">' + cw.map(function (c) {
          var late = cronLate(c);
          return '<div class="row cc-auto">' + dot(c.healthy ? "warn" : "loss") + '<span class="grow"><span class="title mono">' + esc(c.job) + '</span><span class="sub">' +
            esc((c.fails_7d ? c.fails_7d + (c.fails_7d === 1 ? " failure" : " failures") + " in 7 days. " : !c.active ? "Switched off. " : "") + (late ? "Late: " : "") + every(c.schedule) + ", ran " + c.ago + ".") + "</span></span></div>"; }).join("") + "</div>" : "") +
        (J.cron.length ? showAll("Show all " + J.cron.length + " database jobs", "Hide the database jobs", '<p class="t-foot cc-count-l">Sort by any column; times are Eastern.</p>' + cronTable()) : cronTable()), first) +
      band("a", lead(fresh + " of " + beating.length + " heartbeats fresh", (!J.heartbeats.length ? "" : watch.length ? (watch.length === 1 ? "One worker needs" : watch.length + " workers need") + " a look; every other one checked in on time."
          : "Every worker checked in on time, and none is close to going stale.") +
          (byJob || retired ? " Under Show all, too: " + [byJob ? (byJob === 1 ? "one key of a database job, judged by that job's run" : byJob + " keys of database jobs, judged by each job's run") : "",
            retired ? (retired === 1 ? "one retired key nothing schedules" : retired + " retired keys nothing schedules") : ""].filter(Boolean).join(", and ") + "." : "")) +
        (watch.length ? '<div class="list cc-list">' + watch.map(function (h) {   /* only what needs a look; the rest wait behind Show all */
          return '<div class="row cc-auto">' + dot(h.fresh ? "warn" : "loss") + '<span class="grow"><span class="title mono">' + esc(h.key) + '</span><span class="sub">' +
            esc((h.fresh ? "Close to stale: " : "Stale: ") + "checked in " + h.ago + ". " + h.sched + ", stale after " + span(h.lim) + ".") + "</span></span></div>"; }).join("") + "</div>" : "") +
        (J.heartbeats.length ? showAll("Show all " + J.heartbeats.length + " heartbeats", "Hide the heartbeats", hbTable())
          : empty("No heartbeats were read, so no worker can be called fresh.")), first) +
        tail([["Automations", "Host from job_hosts; the Netlify stand-ins stay as the rollback path. Healthy means the last run succeeded with no drift and no lost runs. Read from ops_job_health(), commissioners only."],
          ["Database jobs", "cron.job and each job's last run, through ops_job_health(); Run now exists for discord-sync only."],
          ["Heartbeats", "A heartbeat counts as stale at twice its schedule and at least five minutes past it, or after an hour for a worker with no fixed schedule; close means inside the last quarter before that. Freshness is read from each heartbeat's own value, never the row's update time. Source: app_config heartbeats."],
          ["Audit log", "admin_audit is not shown on this page."]]);
  }
  /* one Edge Function row; Run now is the live door (the scheduler's own run, part_live.js ~11920): no confirm, the button
     says Running… while it runs, then the row shows the new run and a toast says how it went */
  function edgeRow(e) {
    var busy = !!st.running[e.fn];
    return '<div class="row cc-auto" data-cc-edge="' + esc(e.fn) + '">' + dot(edgeOk(e) ? "ok" : e.healthy ? "warn" : "loss") + '<span class="grow"><span class="title mono">' + esc(e.fn) + '</span><span class="sub">' + esc(EDGE_WHAT[e.fn] || "") + "</span></span>" +
      '<span class="cc-auto-m"><span class="t-foot">On ' + (e.host === "edge" ? "Edge" : esc(e.host)) + ", every " + e.every_min + "\u00a0min, ran " + esc(e.ago) + ", " + ms(e.last_ms) + "</span></span>" +
      (e.fn === "discord-sync" ? '<button class="btn secondary sm" data-cc-run="' + esc(e.fn) + '"' + (busy ? ' aria-busy="true"' : "") + ">" + (busy ? "Running\u2026" : "Run now") + "</button>" : "") + "</div>";
  }
  /* ---------- the commissioner's reads: s2_control() and ops_job_health() (v4.57) ----------
     The league read never carries them (model.js M.partial.control and .jobs say so). With a read client this page reads
     both once a visit and again on Refresh, and maps them onto the shapes the tabs draw; M.control's own figures are the
     fixture's (the Oct 19 snapshot) and stand only where there is no read client. A read that fails says so in place: a
     job list that did not come back is never called healthy. What s2_control does not return (the Season 1 funnel,
     week-to-week retention, cohorts, how long leavers stayed) is named as missing, never drawn from the fixture. */
  function ctl() { var c = M().control, L = st.live; return L && L.ctl ? Object.assign({}, c, L.ctl) : c; }
  function liveRead() { return !!(st.live && st.live.ctl && st.live.ctl.members); }
  /* pg_cron schedule -> minutes between runs (model.js cadence, the same reading). shortcut: a second copy of that small
     reader; live-model can export it and this should use it */
  function cadence(sched) {
    if (!sched) return null; if (/second/.test(sched)) return 1;
    var p = sched.split(" "); if (p.length !== 5) return null;
    if (/^\*\/(\d+)$/.test(p[0])) return +p[0].slice(2); if (p[0] === "*") return 1; if (p[1] === "*") return 60; if (p[4] !== "*") return 10080; return 1440;
  }
  function minsSince(iso, now) { var t = Date.parse(iso || ""); return isNaN(t) ? null : Math.max(0, Math.round((now - t) / 60000)); }
  /* day, week (Monday) or month buckets: a flow sums, a level keeps its last day (membership-analytics: summing a level is
     the classic aggregation lie). rows: [{d, <key>}] in day order */
  function buckets(rows, key, period, level) {
    var map = {}, keys = [];
    rows.forEach(function (r) {
      var k = period === "month" ? r.d.slice(0, 7) : period === "week" ? dayAdd(r.d, -((dow(r.d) + 6) % 7)) : r.d;
      if (!(k in map)) { keys.push(k); map[k] = level ? null : 0; }
      map[k] = level ? r[key] : map[k] + (+r[key] || 0);
    });
    return { keys: keys, values: keys.map(function (k) { return map[k]; }),
      labels: keys.map(function (k) { return period === "month" ? new Date(k + "-15T16:00:00Z").toLocaleString("en-US", { month: "short", timeZone: TZ }) : M().etMonthDay(k + "T17:00:00Z"); }) };
  }
  function jobsOf(jh, now) {
    var hosts = (jh.hosts || []).map(function (h) {
      var m = minsSince(h.run_started || h.edge_seen, now);
      return { fn: h.fn, host: h.host, every_min: h.every_min, last_ms: h.last_ms, ran_min_ago: m, ago: m == null ? "never" : M().ago(m), lost_count: h.lost_count || 0,
        healthy: !!h.last_ok && !h.failing && !h.lost_count && h.edge_ready !== false };
    });
    var cron = (jh.cron || []).map(function (c) {
      var m = minsSince(c.last_started, now);
      return { job: c.name, schedule: c.schedule, active: !!c.active, cadenceMin: cadence(c.schedule), last_min_ago: m == null ? 1e9 : m, ago: m == null ? "never" : M().ago(m),
        last_ms: c.last_seconds == null ? null : Math.round(c.last_seconds * 1000), last_status: c.last_status || "never ran", healthy: !!c.active && c.last_status !== "failed" };
    });
    var cad = {}; hosts.forEach(function (h) { cad[h.fn] = cad["rl_" + h.fn] = cad["rl_" + h.fn + "_result"] = h.every_min; });   /* qa: the Edge workers beat as rl_<fn> */ cron.forEach(function (c) { cad["rl_" + c.job] = cad["rl_" + c.job + "_result"] = c.cadenceMin; });
    var beats = (jh.heartbeats || []).map(function (h) {
      var age = Math.round((+h.age_seconds || 0) / 60), c = cad[h.key] != null ? cad[h.key] : h.key === "watchdog" ? 15 : null;
      return { key: h.key, ageMin: age, ago: M().ago(age), cadenceMin: c, fresh: c == null ? age <= 60 : age <= Math.max(2 * c, c + 5) };
    }).sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    return { edge: hosts, cron: cron, heartbeats: beats, live: true };
  }
  function ctlOf(sc, now) {
    var pop = sc.pop || {}, gu = sc.guild || {}, days = (pop.days || []).slice();
    var acc = [], cum = 0; (sc.accounts_by_day || []).forEach(function (r) { cum += +r.n || 0; acc.push({ d: r.day, cum: cum }); });
    var wk = {}, weeks = [];
    var put = function (day, k, n) { var w = dayAdd(day, -((dow(day) + 6) % 7)); if (!wk[w]) { wk[w] = { joins: 0, departs: 0, registered: 0 }; weeks.push(w); } wk[w][k] += +n || 0; };
    (gu.joined_by_day || []).forEach(function (r) { put(r.day, "joins", r.n); });
    (gu.departures_by_day || []).forEach(function (r) { put(r.day, "departs", r.n); put(r.day, "registered", r.registered); });
    weeks.sort();
    var active = sc.active_by_week || [];
    return {
      members: { present: +pop.present || 0, anchor: null, days: days, by: function (p) { return buckets(days, "members", p || "day", true); } },
      accounts: { total: cum, days: acc, by: function (p) { return buckets(acc, "cum", p || "day", true); } },
      joinsDeparts: { weeks: weeks, labels: weeks.map(function (w) { return "Week of " + M().etMonthDay(w + "T17:00:00Z"); }), joins: weeks.map(function (w) { return wk[w].joins; }),
        departs: weeks.map(function (w) { return wk[w].departs; }), registered: weeks.map(function (w) { return wk[w].registered; }), hadClub: weeks.map(function () { return 0; }) },
      funnelGap: { discordMembers: +gu.present || 0, withAccount: +gu.linked || 0, withoutAccount: (+gu.present || 0) - (+gu.linked || 0), everSeen: null },
      weeklyActive: { labels: active.map(function (w) { return "Week of " + M().etMonthDay(w.week + "T17:00:00Z"); }), players: active.map(function (w) { return +w.players || 0; }), firstTimers: active.map(function () { return 0; }), games: active.map(function (w) { return +w.games || 0; }) },
      churnByClub: (gu.departures_by_club || []).map(function (c) { return { code: c.club, n: +c.n || 0, inLeague: !!M().team(c.club), team: M().team(c.club) }; }).sort(function (a, b) { return b.n - a.n; }),
      stay: gu.days_in_server || null, signupsBy: sc.signups || [], regPresent: +pop.reg_present || 0, signupsTotal: +pop.signups_total || 0,
      generated: sc.generated || null
    };
  }
  /* -> resolves when both reads have answered (or failed); repaints the pane in place */
  function loadLive(root, again) {
    if (!client() || st.busy.live || (st.live && !again)) return Promise.resolve();
    st.busy.live = true;
    var now = Date.now(), L = { ctl: null, jobs: null, err: {}, at: now };
    return Promise.all([
      rd(function (c) { return c.rpc("s2_control"); }).then(function (sc) { if (!sc) throw new Error("s2_control returned nothing"); L.ctl = ctlOf(sc, now); }, function (e) { L.err.control = e.message; }),
      rd(function (c) { return c.rpc("ops_job_health"); }).then(function (jh) { if (!jh) throw new Error("ops_job_health returned nothing"); L.jobs = jobsOf(jh, now); }, function (e) { L.err.jobs = e.message; })
    ]).then(function () {
      if (L.ctl) L.ctl.jobs = L.jobs || { edge: [], cron: [], heartbeats: [], live: true, err: L.err.jobs };
      else if (L.jobs) L.ctl = { jobs: L.jobs };
      /* no kpis copy: the Overview's sentence reads the members from L.ctl and the jobs through jobHealth() (review
         2026-11-25: the copy was built only when both reads answered, so one refusal left the model's figures standing) */
      st.live = L; st.busy.live = false;
      liveRepaint(root);
    });
  }
  /* what the live read feeds, repainted in place when it answers, and nothing else: on Overview the league-today
     sentence, on Tonight the two health lines, and the tab counts. Growth and System are drawn wholly from the read and
     hold no typed field under a read client (the audit search is the snapshot's alone), so their pane repaints whole.
     Every other block keeps its fields as they are: a headline being typed, an award pick, a gamertag search or a game
     picker survives the read, and so do Refresh and Run now (CLAUDE.md: never re-render an input mid-typing; review
     2026-11-24 found the whole pane rebuilt on every tab) */
  var LIVE_BLOCKS = { overview: [["#ccToday", todayHtml]], tonight: [["#ccHealth", healthHtml]] };
  function liveRepaint(root) {
    var pane = root && S2.$("#ccPane", root); if (!pane || !pane.isConnected) return;
    var tab = pane.dataset.tab;
    if (tab === "growth" || tab === "system") { repaintPane(root); return; }
    (LIVE_BLOCKS[tab] || []).forEach(function (b) { var el = S2.$(b[0], pane); if (el) el.outerHTML = b[1](); });
    sideCounts(root);
  }
  function liveErr(which) { return st.live && st.live.err && st.live.err[which]; }
  /* Run now: only discord-sync has a door on demand (the classic Automations panel: /api/discord-ops?run=now; Netlify
     refuses HTTP calls to scheduled functions, and the other four run on Edge on their own schedule) */
  function bindRun(pane, b) {
    b.addEventListener("click", function () {
      var fn = b.dataset.ccRun;
      if (fn !== "discord-sync" || st.running[fn]) return;
      st.running[fn] = 1; b.textContent = "Running…"; b.setAttribute("aria-busy", "true");
      var finish = function (msg, kind) {
        delete st.running[fn];
        var nb = S2.$('[data-cc-run="' + fn + '"]', pane); if (nb) { nb.textContent = "Run now"; nb.removeAttribute("aria-busy"); }
        S2.toast(msg, kind);
      };
      (S2.ea && S2.ea.post ? S2.ea.post("/api/discord-ops?run=now", {}) : Promise.reject(new Error("The run door is not on this page."))).then(function (o) {
        if (!o || o.error) throw new Error((o && o.error) || "The server did not answer.");
        finish("discord-sync ran: " + JSON.stringify(o).slice(0, 120), "ok");
        loadLive(S2.$("#page"), true);
      }).catch(function (e) { finish("discord-sync did not run: " + e.message, "err"); });
    });
  }
  function bindSystem(pane) {
    S2.$$("[data-cc-run]", pane).forEach(function (b) { bindRun(pane, b); });
    bindSort(pane, "ccCron", cronCols(), st.cron, cronTable);
    var rl = S2.$("[data-cc-relive]", pane); if (rl) rl.addEventListener("click", function () { if (rl.disabled) return; rl.disabled = true; rl.setAttribute("aria-busy", "true"); loadLive(S2.$("#page"), true); });
    bindSort(pane, "ccHbs", HB_COLS, st.hb, hbTable);
  }


  /* ======================================================================================================== PAGE */
  var PANES = { overview: overview, tonight: tonight, setup: setup, growth: growth, clubs: clubs, staff: staffPane, system: system };
  function tabOf(r) { var t = (r && r.q && r.q.tab) || "overview"; return PANES[t] ? t : "overview"; }
  /* a pane that throws becomes a fail-loud band in its place (the console says why), never a half-switched page: the
     URL, the tab strip and the pane only move once the pane's HTML exists */
  function paneHtml(tab, first) {
    try { return PANES[tab](first); }
    catch (e) {
      if (window.console) console.error("Control Center: the " + tab + " tab could not be drawn", e);
      return '<h2 class="sr" id="ccPaneTitle">' + TABS.filter(function (t) { return t[0] === tab; })[0][1] + '</h2><section class="band cc-band cc-a" data-cc-failed><div class="cc-error" role="alert">' + WARN +
        '<div><h3 class="d-3">This tab could not be drawn</h3><p class="t-sub">Part of its data is missing or malformed, so nothing here would be true. The other tabs still work; the snapshot needs a look.</p><p class="t-foot">' + esc(e && e.message || String(e)) + "</p></div></div></section>";
    }
  }
  /* the tab strip shows a count only where it means "look here": what waits on you, setup progress, open staffing
     questions, job health ("!" when the jobs could not be read) */
  function sideCounts(root) {
    var att = attention(), H = jobHealth(), ss = steps();
    var c = { overview: String(att.mine.length + att.desk.length), setup: ss.filter(function (s) { return s.state === "done"; }).length + "/" + ss.length,
      staff: "", system: client() && !st.live ? "" : H.missing.length ? "!" : H.healthy ? "OK" : String(H.all - H.ok) };   /* no alarm while the read is on its way */
    if (root) ["overview", "setup", "system"].forEach(function (k) { var el = S2.$('[data-cc-tab="' + k + '"] .count', root); if (el) el.textContent = c[k]; });   /* the two a what-if can move */
    return c;
  }
  function tabsHtml(tab) {
    var counts = sideCounts(null);
    return '<nav class="cc-tabs reveal" aria-label="Control Center"><div class="cc-tabs-in">' + TABS.map(function (t) {
      return '<a href="#/control' + (t[0] === "overview" ? "" : "?tab=" + t[0]) + '" data-cc-tab="' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : "") + "><span>" + t[1] + "</span>" +
        (counts[t[0]] ? '<span class="count num">' + counts[t[0]] + "</span>" : "") + "</a>";
    }).join("") + "</div></nav>";
  }
  function bindPane(root, pane, first) {
    if (client() && !st.live && !st.busy.live) loadLive(root);
    var tab = pane.dataset.tab;
    if (S2.$("[data-cc-failed]", pane)) return;   /* nothing to bind on the fail-loud band */
    drawAll(pane, false);
    if (first) growBars(pane);
    S2.$$("[data-cc-go]", pane).forEach(function (a) { a.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   /* a new tab or window still gets the real link, as in the tab strip */
      e.preventDefault(); switchTab(root, a.dataset.ccGo);
    }); });
    S2.$$("[data-cc-act]", pane).forEach(function (b) { b.addEventListener("click", function () {
      var p = b.dataset.ccAct.split(":");
      if (p[0] === "step") { switchTab(root, "setup"); openStep(root, +p[1]); }
      else if (p[0] === "club") { switchTab(root, "clubs"); openClub(p[1], root); }
      else if (p[0] === "tab") switchTab(root, p[1]);
    }); });
    if (tab === "growth") {
      var seg = S2.$("#ccPeriod", pane);
      if (seg) S2.segmented(seg, function (v) {
        st.period = v;
        var host = S2.$('[data-cc-draw="members"]', pane);
        draw(host, true);
        if (!S2.reduce.matches) host.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });   /* a quick cross-fade, not a replayed draw-in: this is pressed often */
      });
    }
    if (tab === "overview" || tab === "staff" || tab === "setup") deskRead(root);
    if (tab === "overview") { bindNews(root); bindFlags(root); bindAwards(root); }
    if (tab === "setup") { bindStepper(root); bindSched(root); bindSv(root); if (svOn()) loadSurvey(root); }
    if (tab === "clubs") {
      S2.$$("[data-cc-club]", pane).forEach(function (b) { b.addEventListener("click", function () { openClub(b.dataset.ccClub, root); }); });
      if (client() && !teamRows() && !(st.tx && st.tx.gen === M().generated)) loadTeams(root);
      var txr = S2.$("[data-cc-txretry]", pane);
      if (txr) txr.addEventListener("click", function () { txr.disabled = true; txr.textContent = "Reading…"; st.tx = null; loadTeams(root); });
    }
    if (tab === "staff") { bindStaff(root); bindRoles(root); }
    if (tab === "system") bindSystem(pane);
    if (tab === "tonight") { bindFix(root); startClock(pane); }
  }
  /* repaint the open tab in place after a demo action: same tab, same scroll, no entrance replayed, and focus handed to
     the replacement of the control that had it (by its data-cc-* hook) instead of falling to the page */
  function repaintPane(root) {
    var pane = root && S2.$("#ccPane", root); if (!pane || !PANES[pane.dataset.tab]) return;
    var y = window.scrollY, a = document.activeElement, hook = null;
    if (a && pane.contains(a)) [].slice.call(a.attributes).forEach(function (at) { if (!hook && /^data-cc-/.test(at.name)) hook = "[" + at.name + '="' + CSS.escape(at.value) + '"]'; });
    /* a list the reader opened (Show all, an about) stays open: keyed by its summary with the counts taken out, since a
       count is what a repaint changes */
    var key = function (d) { var sm = d.querySelector("summary"); return sm ? sm.textContent.replace(/\d+/g, "#") : ""; };
    var opened = S2.$$("details[open]", pane).map(key);
    pane.innerHTML = paneHtml(pane.dataset.tab, false);
    if (opened.length) S2.$$("details", pane).forEach(function (d) { if (opened.indexOf(key(d)) >= 0) d.open = true; });
    bindPane(root, pane, false);
    hydrateQuiet(pane);   /* its reveals show with it (S2.settle) */
    sideCounts(root);
    window.scrollTo(0, y);
    var b = hook && S2.$(hook, pane); if (b) b.focus({ preventScroll: true });
  }
  /* the strip's fades (control.css is-l, is-r): only on a side with more tabs behind it */
  function tabEdges(side) {
    if (!side) return;
    var max = side.scrollWidth - side.clientWidth;
    side.classList.toggle("is-l", max > 1 && side.scrollLeft > 1);
    side.classList.toggle("is-r", max > 1 && side.scrollLeft < max - 1);
  }
  function centerChip(root, smooth) {   /* narrow screens: the tab strip scrolls sideways; keep the current tab in view */
    var side = S2.$(".cc-tabs-in", root), cur = side && S2.$('[aria-current="page"]', side);
    tabEdges(side);
    if (!cur || side.scrollWidth <= side.clientWidth) return;
    var left = cur.getBoundingClientRect().left - side.getBoundingClientRect().left + side.scrollLeft - (side.clientWidth - cur.offsetWidth) / 2;
    side.scrollTo({ left: Math.max(0, left), behavior: smooth && !S2.reduce.matches ? "smooth" : "auto" });
  }
  function switchTab(root, tab) {
    var pane = S2.$("#ccPane", root);
    if (!pane || !PANES[tab] || pane.dataset.tab === tab) return;
    var html = paneHtml(tab, false);
    /* replaceState, as every ?tab= and ?view= in the concept does: it fires no hashchange, so no route and no reset. A
       pushed entry would bring the reset back on Back, because the kit answers every hashchange with a full route, and
       its hashchange listener on window runs before any listener a page adds there (window keeps registration order,
       even for capture listeners). Back therefore leaves the Control Center. Tab history needs an in-page route hook in
       core.js (S2.route calling def.update for a same-page change); with that hook, this becomes pushState again. */
    try { history.replaceState(null, "", "#/control" + (tab === "overview" ? "" : "?tab=" + tab)); } catch (e) { /* file:// in some browsers: the tab still switches */ }
    S2.$$("[data-cc-tab]", root).forEach(function (a) { if (a.dataset.ccTab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    centerChip(root, true);
    pane.dataset.tab = tab;
    pane.innerHTML = html;
    bindPane(root, pane, false);
    hydrateQuiet(pane);
    pane.animate(S2.reduce.matches ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    /* a reader scrolled down the old tab lands at the top of the new one, just under the header and the sticky strip */
    var strip = S2.$(".cc-tabs", root), nav = S2.$("#navbar"), top = pane.getBoundingClientRect().top + window.scrollY - (nav ? nav.offsetHeight : 60) - (strip ? strip.offsetHeight : 0);
    if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
    var h = S2.$("#ccPaneTitle", pane); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }

  /* ---------- Season settings: the classic Seasons tab's editor (CG.seasonForm), basic format only ----------
     seasons.update of what changed (or seasons.insert for a new season), shown only once the league returns the row. Every
     season is the basic format (standing order, 2026-09-15), so the format is not offered and the full format's dates
     (off-season, pre-season, free agency) are not here. Times are Eastern, as the classic form's. The playoff floor is
     six games in every basic season (Rule 8.3), so it is shown, never typed. A schedule that exists is not moved by a
     change of puck drop, weeks, nights or slots: the sheet says so, and the generator builds from the row as saved. */
  var SEASON_DATES = [["owner_app_deadline", "Owner applications close"], ["registration_deadline", "Sign-ups close"], ["draft_at", "Draft"], ["starts_at", "Puck drop"],
    ["ends_at", "Regular season ends"], ["playoffs_start_at", "Playoffs begin"]];
  var SEASON_MONEY = [["salary_cap", "Salary cap ($M)"], ["owner_salary", "Owner salary ($M)"], ["gm_salary", "GM salary ($M)"], ["agm_salary", "AGM salary ($M)"]];
  function etLocal(iso) {   /* ISO -> the value of an ET datetime-local field */
    if (!iso) return "";
    var p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
    var g = function (t) { return (p.filter(function (x) { return x.type === t; })[0] || {}).value; };
    return g("year") + "-" + g("month") + "-" + g("day") + "T" + (g("hour") === "24" ? "00" : g("hour")) + ":" + g("minute");
  }
  function seasonSheet(root, isNew) {
    var base = seasonRow(SETUP_N), FR = S2.CG.FORMAT_RULES.basic, all = ctl().seasons;
    var maxN = all.reduce(function (m, x) { return Math.max(m, x.number || 0); }, 0);
    var s = isNew ? { name: "Season " + (maxN + 1), number: maxN + 1, weeks: FR.weeks, nights_per_week: 3, night_slots: S2.CG.NIGHT_SLOTS.join(","), salary_cap: FR.salary_cap, roster_max: FR.roster_max,
      trade_deadline_week: FR.trade_deadline_week, owner_salary: 0, gm_salary: 0, agm_salary: 2000000, registration_open: false, moves_lock_override: "auto" } : base;
    var hasSched = !isNew && regularOf(SETUP_N).length > 0;
    var inp = function (k, label, val, type, extra) { return '<div class="field"><label for="ccSs_' + k + '">' + label + '</label><input class="input" id="ccSs_' + k + '" data-k="' + k + '" type="' + (type || "text") + '" value="' + esc(val == null ? "" : val) + '"' + (extra || "") + "></div>"; };
    var sh = sheet({ title: isNew ? "New season" : "Season settings: " + (s.name || ""), html:
      '<p class="t-sub">Basic format, as every season runs until you say otherwise. Times are Eastern.</p>' +
      '<div class="cc-form">' + inp("name", "Name", s.name) + (isNew ? inp("number", "Number", s.number, "number", ' min="1"') : "") +
        SEASON_DATES.map(function (d) { return inp(d[0], d[1], etLocal(s[d[0]]), "datetime-local"); }).join("") +
        inp("weeks", "Regular-season weeks", s.weeks, "number", ' min="1" max="20"') + inp("nights_per_week", "Nights a week", s.nights_per_week, "number", ' min="1" max="7"') +
        inp("night_slots", "Puck drops (24-hour, ET, comma between)", s.night_slots) +
        SEASON_MONEY.map(function (m) { return inp(m[0], m[1], s[m[0]] == null ? "" : s[m[0]] / 1e6, "number", ' min="0" step="0.25"'); }).join("") +
        inp("roster_max", "Roster limit", s.roster_max, "number", ' min="9" max="' + FR.roster_max + '"') + inp("trade_deadline_week", "Trade deadline (week)", s.trade_deadline_week, "number", ' min="1" max="20"') +
        '<div class="field"><label for="ccSs_registration_open">Sign-ups</label><select class="input" id="ccSs_registration_open" data-k="registration_open"><option value="1"' + (s.registration_open ? " selected" : "") + '>Open</option><option value="0"' + (!s.registration_open ? " selected" : "") + ">Closed</option></select></div>" +
        '<div class="field"><label for="ccSs_moves_lock_override">Roster moves</label><select class="input" id="ccSs_moves_lock_override" data-k="moves_lock_override">' + ["auto", "locked", "open"].map(function (x) { return '<option value="' + x + '"' + ((s.moves_lock_override || "auto") === x ? " selected" : "") + ">" + (x === "auto" ? "By the calendar" : x === "locked" ? "Locked" : "Open") + "</option>"; }).join("") + "</select></div>" +
      "</div>" + kv([["Playoff games-played floor", (s.playoff_floor_ruled != null ? s.playoff_floor_ruled + " games, your ruling for this season" : "6 games (Rule 8.3)")], ["Format", "Basic"]]) +
      (hasSched ? '<p class="cc-callout-s">' + WARN + "<span>This season has a schedule. Changing the puck drop, the weeks, the nights or the puck drops does not move its games: clear it and generate again to match.</span></p>" : "") +
      '<p class="fl-err cc-ed-err" role="alert" hidden></p><div class="cc-sh-acts"><button class="btn" data-cc-ssave>' + (isNew ? "Create season" : "Save settings") + '</button><button class="btn secondary" data-cc-cancel>Cancel</button></div>' },
      function () { return S2.$('[data-cc-step="1"]', root); });
    var err = S2.$(".cc-ed-err", sh.el), save = S2.$("[data-cc-ssave]", sh.el);
    var say = function (m, k) { err.textContent = m; err.hidden = false; var f = k && S2.$("#ccSs_" + k, sh.el); if (f) f.focus(); return null; };
    /* the form as a seasons row; a field that cannot be read throws {msg, k} and nothing is sent */
    function read() {
      var v = {}, no = function (msg, k) { throw { msg: msg, k: k }; };
      S2.$$("[data-k]", sh.el).forEach(function (el) { v[el.dataset.k] = el.value.trim(); });
      var rec = { name: v.name };
      if (!v.name) no("Give the season a name.", "name");
      if (isNew) { rec.number = parseInt(v.number, 10); if (!(rec.number > 0)) no("Give the season a number.", "number"); if (all.some(function (x) { return x.number === rec.number; })) no("Season " + rec.number + " already exists.", "number"); }
      SEASON_DATES.forEach(function (d) {
        var x = v[d[0]]; if (!x) { rec[d[0]] = null; return; }
        var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(x), at = m && etAt(m[1], m[2]);
        if (!at) no(d[1] + ": that date and time could not be read.", d[0]);
        rec[d[0]] = at;
      });
      var int = function (k, lo, hi, label) { var n = parseInt(v[k], 10); if (!(n >= lo && n <= hi) || String(n) !== v[k]) no(label + " must be a whole number from " + lo + " to " + hi + ".", k); return n; };
      rec.weeks = int("weeks", 1, 20, "Regular-season weeks");
      rec.nights_per_week = int("nights_per_week", 1, 7, "Nights a week");
      rec.roster_max = int("roster_max", 9, FR.roster_max, "The roster limit");
      rec.trade_deadline_week = int("trade_deadline_week", 1, 20, "The trade deadline week");
      var slots = v.night_slots.split(",").map(function (t) { return t.trim(); });
      if (!slots.every(function (t) { return /^\d{1,2}:\d{2}$/.test(t) && +t.split(":")[0] < 24 && +t.split(":")[1] < 60; })) no("Puck drops are 24-hour times with a comma between, like 21:00,21:35,22:10.", "night_slots");
      rec.night_slots = slots.join(",");
      SEASON_MONEY.forEach(function (m) { var n = parseFloat(v[m[0]]); if (!isFinite(n) || n < 0) no(m[1].replace(" ($M)", "") + " must be a number of millions, 0 or more.", m[0]); rec[m[0]] = Math.round(n * 1e6); });
      if (!(rec.salary_cap > 0)) no("The salary cap must be more than zero.", "salary_cap");
      rec.registration_open = v.registration_open === "1"; rec.moves_lock_override = v.moves_lock_override;
      return rec;
    }
    save.addEventListener("click", function () {
      if (save.disabled) return;
      err.hidden = true;
      var rec; try { rec = read(); } catch (x) { if (!x || !x.msg) throw x; say(x.msg, x.k); return; }
      var set = {};
      if (isNew) set = Object.assign(rec, { status: "upcoming", format: "basic" });
      else Object.keys(rec).forEach(function (k) { var a = rec[k], b = s[k]; if (/_at$|deadline$/.test(k) ? (a ? Date.parse(a) : null) !== (b ? Date.parse(b) : null) : String(a == null ? "" : a) !== String(b == null ? "" : b)) set[k] = a; });
      if (!Object.keys(set).length) { sh.close(); S2.toast("No changes to save: " + s.name + " is as it was"); return; }
      save.disabled = true; save.setAttribute("aria-busy", "true");
      (isNew ? S2.write("seasons.insert", { row: set, select: "*" }, { sections: ["seasons"] }) : S2.write("seasons.update", { set: set, match: { id: s.id }, select: "*" }, { sections: ["seasons"] })).then(function (r) {
        var row = (r.data || [])[0];
        if (!isNew) confirmRow(row || Object.assign({ id: s.id }, set));
        sh.close(); repaintPane(root);
        S2.toast(isNew ? (set.name + " created") : "Saved " + (set.name || s.name) + ": " + Object.keys(set).length + (Object.keys(set).length === 1 ? " setting" : " settings"), "ok");
      }, function (e) { save.disabled = false; save.removeAttribute("aria-busy"); say("Not saved: " + e.message); });
    });
    S2.$("[data-cc-cancel]", sh.el).addEventListener("click", function () { sh.close(); });
    return sh;
  }
  S2.page("control", {
    title: "Control Center", tab: "control", views: TABS,   /* the header's Workspaces menu lists these (js/core.js navTabs) */
    render: function (r) {
      var Mm = M();
      if (!Mm || !ctl() || !ctl().setup) return '<header class="page-head cc-head"><span class="kicker">Commissioner</span><h1 class="d-1">Control Center</h1></header><section class="cc-error" role="alert">' + WARN +
        '<div><h2 class="d-3">The Control Center data did not load</h2><p class="t-sub">The league read is missing or incomplete, so nothing here would be true. Reload the page.</p><button class="btn" onclick="location.reload()">Reload</button></div></section>';
      var tab = tabOf(r), next = Mm.nights({ when: "upcoming" }).slice(-1)[0];
      return '<header class="page-head cc-head reveal"><span class="kicker">Commissioner</span><h1 class="d-1">Control Center</h1><p class="lede-l">' + esc(Mm.etLong(Mm.generated)) + ", league time." +
          (next ? " Week " + next.week + " starts " + esc(next.label) + "." : "") + "</p></header>" + tabsHtml(tab) +
        '<div class="cc-pane" id="ccPane" data-tab="' + tab + '">' + paneHtml(tab, true) + "</div>";
    },
    after: function (root) {
      var pane = S2.$("#ccPane", root);
      if (!pane) return;
      S2.$$("[data-cc-tab]", root).forEach(function (a) { a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   /* a new tab or window still gets the real link */
        e.preventDefault(); switchTab(root, a.dataset.ccTab);
      }); });
      var strip = S2.$(".cc-tabs-in", root), edgeRaf = 0;
      if (strip) strip.addEventListener("scroll", function () { if (!edgeRaf) edgeRaf = requestAnimationFrame(function () { edgeRaf = 0; tabEdges(strip); }); }, { passive: true });
      centerChip(root, false);
      bindPane(root, pane, true);   /* the route then calls S2.charts.hydrate(page): the one orchestrated entrance */
    }
  });

  /* a route change (a link inside a sheet, Back, the search palette) closes any sheet this page opened, so a sheet never
     stays modal over the next page; the kit has already routed by the time this runs */
  window.addEventListener("hashchange", function () { if (curSheet) curSheet.close(); });
  /* for tools/schedule-port-g3.test.cjs, which runs the ported generator beside the classic one */
  S2._control = { genRun: genRun, holidayGate: holidayGate, schedOf: schedOf };
})();
