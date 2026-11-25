/* CGHL Season 2: the loader. v5.00 swap (c2, 2026-11-24). It gets the league data first, then loads the page's scripts in
   the order demo.html lists them in <template id="s2-scripts">, then calls window.S2_START (the theme and S2.boot).
     live     POST /rest/v1/rpc/s2_league with the public key, and the member's own token when one is signed in (the
              stored sign-in on the first read of a visit), so RLS decides what the body holds (contracts/s2-league.md). One read for the season on screen; when that season has no
              final yet, a second, smaller read of the last complete season's games, box scores and tenures, so its
              champion, trophies and Cup roster stay real (js/model.js closeOf).
   The source is live, always (i3f, 2026-11-25: the Oct 19 fixture source left with the suites' fixture mode; ?source=live
   still reads, anything else is said). The season on screen is ?season=<n>, else the current season (public.current_season_id()): Season 2 by
   default and Season 1 a switch away, the live site's rule (v4.54).
   A read that fails, or a body missing a section, stops here with a message and a way to try again: the page is never
   drawn from half the data. Nothing here polls: a page load is a fresh read (the pulse port is stream f's). */
(function () {
  "use strict";
  var S2 = window.S2 = window.S2 || {};
  /* the live site's own pair, public by design (src/live/part_live.js CG.SB_URL, CG.SB_KEY); the key reads only what RLS lets anon read */
  var URL = "https://bzbuyclwdhmhdzujxeqd.supabase.co", KEY = "sb_publishable_9OVgiNJSCSKKp0NfnCwbBQ_W1rcrK3Z";
  var TIMEOUT_MS = 20000;   /* the database stops an anon read at 3 s and a member's at 8 s; this only catches a network that never answers */
  var q = new URLSearchParams(location.search);
  var source = q.get("source") || "live";
  var asked = q.get("season") != null ? parseInt(q.get("season"), 10) : null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  /* the activity wheel (loader, 2026-11-25; commissioner: "can you make a nice looking loading wheel instead of the page
     just saying Loading the League?"). Apple's activity indicator: eight round-capped spokes, the brightest one leading a
     clockwise turn with a fading trail. Drawn ONCE here, since this file runs before core.js, and kept as S2.spinner, the
     one markup for any later wait; css/ui.css .spin holds the look and the motion (the delay, the trail, Reduce Motion).
     Each spoke is an HTML element with its index in --k, because the turn is one opacity animation per spoke, which the
     compositor runs while the main thread is busy (review 2026-11-25: the first cut turned an SVG in steps(), and WebKit
     keeps a stepped animation on the main thread, so on an iPhone it froze while the bundle parsed) */
  var WHEEL = (function () {
    var s = "";
    for (var k = 0; k < 8; k++) s += '<i style="--k:' + k + '"></i>';
    return '<span class="spin-w" aria-hidden="true">' + s + "</span>";
  })();
  /* label says what is loading: the caption under the wheel, and the status's only text, so a screen reader reads the
     words on screen once (review 2026-11-25: an aria-label over a caption marked aria-hidden left the status empty to
     assistive technology, because a live region is announced from the text that changes inside it and browse mode reads
     a container's text, never the aria-label of a plain div). role status implies aria-live polite. A status born with
     its text, as the boot screen's is, is read in place but rarely announced: a later wait inside a page that must be
     announced puts the spinner into a live region that is already in the page (core.js keeps the toasts' for that) */
  S2.spinner = function (label) {
    if (!label) throw new Error("S2.spinner needs a label that says what is loading");
    return '<div class="spin" role="status">' + WHEEL + '<p class="t-sub spin-t">' + esc(label) + "</p></div>";
  };
  /* the error screen the loader draws: core.js's state box markup (S2.empty), because core.js is not loaded yet. It sits in
     the boot screen's own centered frame, where the wheel was (review 2026-11-25: in .page it jumped to the top left, under
     an iPhone's status bar, since .page has no top inset) */
  function show(kind, title, text, retry) {
    var app = document.getElementById("app"); if (!app) return;
    app.innerHTML = '<main id="page" class="boot"><div class="empty-state ' + kind + '"' + (kind === "err" ? ' role="alert"' : ' aria-live="polite"') + '><div class="empty-t">' +
      '<p class="t-head">' + esc(title) + "</p>" + (text ? '<p class="t-foot">' + esc(text) + "</p>" : "") +
      (retry ? '<div class="empty-acts"><button type="button" class="btn" id="s2Retry">Try again</button></div>' : "") + "</div></div></main>";
    var b = document.getElementById("s2Retry"); if (b) b.addEventListener("click", function () { location.reload(); });
  }
  function fail(e) {
    console.error("S2 load:", e);
    var st = e && e.status, code = e && e.code;
    if (st === 401) show("err", "Sign in again", "Your sign-in has expired, so the league could not be read as you.", true);
    else if (code === "42501" || st === 403) show("err", "Not open to you", "The league did not let this account read it.", false);
    else if (code === "P0002") show("err", "No such season", "There is no Season " + asked + ". Remove ?season from the address to see the current season.", false);
    else if (code === "57014" || st === 503 || st === 504 || (e && e.name === "AbortError")) show("err", "The league did not answer", "The league's data service did not respond just now. Wait a minute, then try again.", true);
    else if (e && e.name === "TypeError") show("err", "The league did not load", "Check your connection, then try again.", true);
    else show("err", "The league did not load", (e && e.message) || String(e), true);
  }

  /* who a read goes out as: the member live.js has signed in (S2.session), else the sign-in supabase-js stored for this
     origin, which the first read of a visit, made before any script has run, would otherwise never carry. The key and the
     shape are the current site's own client's (createClient(SB_URL, SB_KEY, { auth: { persistSession: true } }) keeps the
     session as JSON under sb-<project>-auth-token, supabase-js 2.110.7); nothing here makes a second client. A stored
     sign-in that has expired is not sent: supabase-js renews it once it loads, and live.js then reads again as the member */
  var STORE = "sb-" + URL.split("//")[1].split(".")[0] + "-auth-token";
  function viewer() {
    if (S2.session && S2.session.accessToken) return { token: S2.session.accessToken, as: S2.session.profileId || null };
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { console.warn("S2 load: the stored sign-in could not be read, so the league is read as a visitor", e); return { token: null, as: null }; }
    if (!s || !s.access_token) return { token: null, as: null };
    if (s.expires_at && s.expires_at * 1000 < Date.now() + 30000) { console.warn("S2 load: the stored sign-in has expired, so the league is read as a visitor until it is renewed"); return { token: null, as: null }; }
    return { token: s.access_token, as: (s.user && s.user.id) || null };
  }
  /* one s2_league read: season is a number or null (the current season), sections an array or null (every default
     section), ids an array of game ids or null (p_game_ids: games and box come back for those games only). Resolves the
     body; rejects an Error carrying status, and code from PostgREST (a Postgres error code). A sign-in the database
     refuses (401: expired or revoked) is said in the console and the same read goes out as a visitor, never the error
     screen; S2.load.readAs is who the last read went out as (a profile id, or null for a visitor) */
  function read(season, sections, ids) {
    var w = viewer();
    return once(season, sections, ids, w.token).then(function (body) { S2.load.readAs = w.token ? w.as : null; return body; }, function (e) {
      if (!w.token || e.status !== 401) throw e;
      console.warn("S2 load: the league refused the stored sign-in (" + e.message + "), so this read goes out as a visitor");
      if (S2.data) S2.data.readAs = null;   /* part of the body is a visitor's now: the next session live.js applies reads it all again */
      return once(season, sections, ids, null).then(function (body) { S2.load.readAs = null; return body; });
    });
  }
  function once(season, sections, ids, token) {
    var args = {}; if (season != null) args.p_season = season; if (sections) args.p_sections = sections; if (ids && ids.length) args.p_game_ids = ids;
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : 0;
    var headers = { apikey: KEY, "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(URL + "/rest/v1/rpc/s2_league", { method: "POST", headers: headers, body: JSON.stringify(args), signal: ctl ? ctl.signal : undefined })
      .then(function (res) {
        clearTimeout(timer);
        return res.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (x) { /* a non-JSON answer is reported below with its status */ }
          if (!res.ok) { var err = new Error((j && j.message) || "s2_league answered " + res.status); err.status = res.status; err.code = j && j.code; throw err; }
          if (!j || typeof j !== "object") { var e2 = new Error("s2_league answered with no body"); e2.status = res.status; throw e2; }
          return j;
        });
      }, function (e) { clearTimeout(timer); throw e; });
  }
  /* the last complete season before the one on screen, when the one on screen has no final yet (null otherwise) */
  function archiveSeason(body) {
    var finals = (body.games || []).some(function (g) { return g.status === "final" && !g.voided; });
    if (finals) return null;
    var done = (body.seasons || []).filter(function (s) { return s.status === "complete" && s.number < body.season; }).map(function (s) { return s.number; });
    return done.length ? Math.max.apply(null, done) : null;
  }

  /* the page's scripts, in order, from <template id="s2-scripts"> (the one list; demo.html keeps it). Inserted at once and
     run in order (async false), so the last one's load is the moment every script has run */
  function run() {
    var tpl = document.getElementById("s2-scripts");
    var list = tpl ? Array.prototype.map.call(tpl.content.querySelectorAll("script[src]"), function (s) { return s.getAttribute("src"); }) : [];
    if (!list.length) return fail(new Error("demo.html has no <template id=\"s2-scripts\"> listing the page's scripts"));
    var broke = false;
    var onErr = function (ev) { if (broke) return; broke = true; fail(ev.error || new Error(ev.message || "a script failed")); };
    window.addEventListener("error", onErr);
    list.forEach(function (src, i) {
      var s = document.createElement("script"); s.src = src; s.async = false;
      s.onerror = function () { onErr({ message: src + " did not load" }); };
      if (i === list.length - 1) s.onload = function () {
        window.removeEventListener("error", onErr);
        if (broke) return;
        if (typeof window.S2_START !== "function") return fail(new Error("demo.html defines no window.S2_START"));
        window.S2_START();
      };
      document.body.appendChild(s);
    });
  }

  S2.load = { source: source, season: asked, read: read, readAs: null };
  /* After live.js applies a session (sign-in, sign-out, another account), the body is read again ONCE when it was read as
     someone else, so a member's own fields fill in without a reload and a signed-out tab drops them. Through S2.reread
     (live.js), the one re-read: every section this body holds, merged and built in place. -> Promise<boolean> */
  S2.load.matchViewer = function () {
    var d = S2.data, now = (S2.session && S2.session.profileId) || null;
    if (!d || d.source !== "live" || !d.body || d.readAs === now) return Promise.resolve(false);
    if (!S2.reread) { console.error("S2 load: there is no S2.reread (js/live.js), so the league is not read again as the member now signed in"); return Promise.resolve(false); }
    return S2.reread((d.body.sections || []).slice()).then(function (ok) {
      if (!ok) { console.error("S2 load: the league was not read again as the member now signed in; their own fields wait for a reload"); return false; }
      d.readAs = S2.load.readAs;
      return true;
    });
  };
  if (source === "live") {
    /* the boot screen until the page draws (S2.boot replaces #app): the wheel in the middle of the viewport, never a bare
       line of text in the corner. On a phone network it can stay up for seconds */
    var app = document.getElementById("app");
    if (app) app.innerHTML = '<main class="boot">' + S2.spinner("Loading the league") + "</main>";
    read(asked, null).then(function (body) {
      var a = archiveSeason(body), as = S2.load.readAs;
      return (a ? read(a, ["games", "box", "tenures"]) : Promise.resolve(null)).then(function (archive) {
        S2.data = { source: "live", body: body, archive: archive, readAs: as };
        run();
      });
    }).catch(fail);
  } else fail(new Error("?source must be live, not " + source));
})();
