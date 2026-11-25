/* The league office's public pages the concept had left out, brought back (commissioner, 2026-11-23, on the cutover list's
   live features: "go ahead on all of these"): #/news and #/news/<id> (the live site's News and Article, 401 stories),
   #/terms and #/privacy (the live Terms & Privacy page, split in two), and #/pickup-import (the page the LFG bot links
   after every pickup game). Each is a website page in the kit's grammar: a statement hero, sections with headlines that
   say something, a reading measure, breadcrumbs on deep pages. Namespace .of- (css/office.css).
   Data (v5.00 swap, e7, 2026-11-24; the real path only since i3b, 2026-11-25): News is the league's own news table,
   s2_league's lazy news section read once per visit through S2.load.read: the season on screen's stories and those filed
   for no season, so the night recaps are the recap job's own posts (post_night_recap), never a second copy counted here.
   It reads again when the pulse names the news kind. A staffer's story (the Newsroom's Write a story, g1: news.insert,
   whose policies still key on the retired Media department until the staffing flip) comes back here by that same news
   kind; S2.reread cannot reach the lazy news section, so a write naming sections ["news"] re-reads nothing. The pickup
   import is the real importer (js/pages/pickups.js, g5: the bot server's EA club search and /api/pickup-import through
   S2.ea.post), with a link to the pickup games on file. Terms and Privacy are the live page's text. Gone with the demo:
   the session's sample stories, the fixture's recaps and rankings written here, and the sample search. */
(function () {
  "use strict";
  var S2 = window.S2, M = S2.M, esc = S2.esc;
  function fail(where) { return '<section class="hero reveal"><h1 class="d-1">' + esc(where) + " could not be drawn.</h1><p class=\"lede-l\">The league data did not load. The console names the error.</p></section>"; }
  function hero(k, title, lede) {
    return '<header class="hero of-hero reveal"><span class="kicker">' + esc(k) + '</span><h1 class="d-hero">' + esc(title) + "</h1>" + (lede ? '<p class="lede-l">' + lede + "</p>" : "") + "</header>";
  }

  /* =================================== NEWS =================================== */
  /* the news rows, read on the first visit and again after the pulse says the news changed; a failed read is said
     with a way to try again, never shown as no news */
  var NEWS = { rows: null, err: null, wait: null, stale: false };
  function readNews() {
    if ((NEWS.rows && !NEWS.stale) || NEWS.wait) return NEWS.wait || Promise.resolve();
    NEWS.err = null;
    NEWS.wait = Promise.resolve().then(function () {
      if (!(S2.load && S2.load.read)) throw new Error("the league read (js/load.js S2.load.read) is not on the page");
      return S2.load.read(M.view.season, ["news"]);
    }).then(function (b) {
      if (!b || !Array.isArray(b.news)) throw new Error("s2_league returned no news section");
      NEWS.rows = b.news; NEWS.stale = false;
    }).catch(function (e) { console.error(NEWS.rows ? "News: the stories could not be read again; the list on screen is the earlier read:" : "News:", e); NEWS.err = e; })
      .then(function () { NEWS.wait = null; });
    return NEWS.wait;
  }
  /* the pulse's news kind (a story published, edited or taken down; live.js S2.LIVE_DOMAINS). s2_league's news section is
     lazy, so S2.reread holds none of it and the rows here would stay as first read for the whole visit (v5.00 swap, e7,
     2026-11-24). They are marked stale: the quiet repaint live.js runs right after this event draws News with the rows on
     hand, and after() reads the stories again and repaints in place, so the list never blanks to "Loading" */
  if (S2.live) S2.live.on("news", function () { NEWS.stale = true; });
  function liveStories() {
    return NEWS.rows.map(function (n) { var body = String(n.body || ""), cat = n.category || "League news";
      return { id: "n-" + n.id, kind: cat, kicker: cat, title: n.title || "Untitled story", at: n.published_at, date: M.etLong(n.published_at) || "", line: body.split(/\n\s*\n/)[0], body: body }; });
  }
  function stories() { return liveStories(); }
  function storyById(id) { return stories().filter(function (s) { return s.id === id; })[0] || null; }
  function newsList() {
    var all = stories(); if (!all.length) return S2.empty("none", "No stories yet", "Night recaps appear here after each game night's last final, and the staff's stories when they publish them.");
    var lead = all[0], rest = all.slice(1);
    var item = function (s) { return '<li><a class="of-n-row" href="#/news/' + esc(s.id) + '"><span class="kicker">' + esc(s.kicker) + '</span><span class="d-3 of-n-t">' + esc(s.title) + '</span><span class="t-sub of-n-l">' + esc(s.line) + '</span><span class="t-foot">' + esc(s.date) + "</span></a></li>"; };
    return '<section class="of-lead reveal" aria-labelledby="ofLeadH"><a class="of-lead-a" href="#/news/' + esc(lead.id) + '"><span class="kicker">' + esc(lead.kicker) + "</span>" +
        '<h2 class="d-1 of-lead-t" id="ofLeadH">' + esc(lead.title) + '</h2><p class="lede-l">' + esc(lead.line) + '</p><span class="t-foot">' + esc(lead.date) + '</span><span class="arrow"><span>Read it</span>' + S2.ic("chev") + "</span></a></section>" +
      /* QA worst 15 (2026-11-25): one story is the lead alone, never a "0 more stories" heading over an empty list */
      (rest.length ? '<section class="of-sec reveal" aria-labelledby="ofMoreH">' + S2.secHead({ kicker: "More from the season", id: "ofMoreH", h: rest.length + " more " + (rest.length === 1 ? "story" : "stories"), p: "Newest first. A recap posts after the last final of each game night." }) +
      '<ol class="of-n-list">' + rest.map(item).join("") + "</ol></section>" : "");
  }
  function article(s) {
    var body = s.body.split(/\n\s*\n/).map(function (p) { return '<p class="of-p">' + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
    return S2.crumbs([["#/news", "News"], ["", s.title]]) +
      '<article class="of-art reveal"><header class="of-art-h"><span class="kicker">' + esc(s.kicker) + '</span><h1 class="d-1">' + esc(s.title) + '</h1><p class="t-foot">' + esc(s.date) + "</p></header>" +
      '<div class="of-art-b">' + body + "</div></article>" +
      '<p class="of-back"><a class="arrow" href="#/news"><span>All news</span>' + S2.ic("chev") + "</a></p>";
  }
  function newsPage(r) {
    if (r.arg) {
      var s = storyById(r.arg);
      return s ? article(s) : '<section class="hero reveal"><span class="kicker">News</span><h1 class="d-1">Story not found</h1><p class="lede-l">That address does not match a story. It may have been taken down.</p><p><a class="btn site" href="#/news">All news</a></p></section>';
    }
    return hero("News", "League news", "Every game night gets a recap the moment its last final is in, and the staff write the rest.") + newsList() +
      S2.about(["These are the league's own stories for " + esc(M.view.name) + ", newest first, with any filed for no season. Each also posts to the Discord news channel."]);
  }
  /* QA visual 16 and nits 23 (2026-11-25): ONE body for #ofNews, drawn by the render, the in-place repaint and Try again
     alike. Before the first read lands (loading, or failed) the list page keeps its hero, so a failure never leaves the
     page without its heading; the reason stays on screen (fail loud). When a re-read fails while the earlier stories are
     on screen, a status line says they may be out of date, with its own Try again, instead of the console alone */
  var RETRY = '<button type="button" class="btn site outline" data-news="retry">Try again</button>';
  function newsBody(r) {
    if (!NEWS.rows) return (r.arg ? "" : hero("News", "League news", "")) + (NEWS.err
      ? S2.empty("err", "The news did not load", "The league's data service did not answer. " + esc(NEWS.err.message || ""), RETRY)
      : S2.empty("none", "Loading the news", ""));
    var note = NEWS.wait ? "Reading the news again." : NEWS.err ? "The news could not be refreshed; these stories are from the earlier read." : "";
    return (note ? '<p class="of-stale" role="status">' + S2.ic("alert") + "<span>" + note + "</span>" + (NEWS.wait ? "" : RETRY) + "</p>" : "") + newsPage(r);
  }
  S2.page("news", {
    title: function (r) { var s = r.arg && M && NEWS.rows && storyById(r.arg); return s ? s.title : "News"; }, tab: "news",
    render: function (r) {
      if (!M) return fail("News");
      return '<div id="ofNews">' + newsBody(r) + "</div>";
    },
    /* the first visit (or the first draw after the pulse marked the news stale) reads the news, then repaints this page's
       own host in place (the router is never re-run) */
    after: function (root, r) {
      if (!M) return;
      var bind = function () {
        var again = S2.$('[data-news="retry"]', root);
        if (again) again.addEventListener("click", function () {
          NEWS.err = null; var read = readNews(), h = S2.$("#ofNews", root);
          if (h) { h.innerHTML = newsBody(r); S2.reveal(root); }
          read.then(paint);
        });
      };
      var paint = function () {
        var host = S2.$("#ofNews", root); if (!host || S2.parse().name !== "news") return;   /* the reader has moved on */
        host.outerHTML = '<div id="ofNews">' + newsBody(r) + "</div>";
        /* the router titled the page before the read landed ("News"), so a story's own title is set here, as desk.js does
           for its in-place repaints (review 2026-11-24: an article read live kept the tab title "News") */
        var t = S2.pages.news.title(r), it = S2.$("#inlineTitle"); document.title = t + " · CGHL"; if (it) it.textContent = t;
        S2.reveal(root);
        bind();
      };
      if (NEWS.err) { bind(); if (!NEWS.rows) return; }   /* the render drew the failure; its Try again reads again */
      if (NEWS.rows && !NEWS.stale) return;
      readNews().then(paint);
    }
  });

  /* =================================== TERMS AND PRIVACY =================================== */
  /* the live page (src/live/part_live.js CG.ROUTES.legal, last updated July 16, 2026), word for word but for its two em
     dashes (house style), split into the two pages a footer links to */
  var LEGAL = {
    terms: { k: "League office", t: "Terms of play", lede: "What you agree to by playing in the league.", secs: [
      ["Terms of play", ["Chel Gaming Hockey League is a free, community-run competitive EA Sports NHL league. Registering commits you to the rulebook, availability, conduct and game-night procedures included. The commissioners may suspend or remove accounts that break it.",
        "League decisions (rulings, forfeits, suspensions, roster moves) follow the <a href=\"#/rulebook\">rulebook</a> and are made by league staff and commissioners. The complaint and appeal process is in Chapter 7.",
        "The league is not affiliated with EA Sports, the NHL, Discord, or Twitch. Club names and marks belong to their owners."]]] },
    privacy: { k: "League office", t: "Privacy", lede: "Exactly what the league stores about you, where it lives, and how to have it deleted.", secs: [
      ["What we store", ["<b>From Discord, when you sign in:</b> your Discord id, username, display name, and avatar. Discord also passes your email to our sign-in provider, but the league never uses or displays it. If you're not in the Chel Gaming server yet, you'll get an in-site notification with the invite.",
        "<b>From you:</b> your EA ID and platform, season registrations, weekly availability, applications, and anything you write on the site (messages, complaints, trade notes).",
        "<b>From play:</b> scores and full box-score statistics import automatically from the EA NHL match record after every league game. These form the league's permanent competitive record.",
        "Availability is visible only to your club's management and league staff. Complaint evidence is private to the league office."]],
      ["Where it lives", ["The site runs on Netlify, data lives in Supabase (Postgres), game-night automation posts to the league's Discord server, and stream status is checked against Twitch. Each processor sees only what it needs to run its part.",
        "Backups of the league database are taken nightly and kept encrypted for 30 days."]],
      ["Deleting your data", ["Message any commissioner from <a href=\"#/you?tab=inbox\">your inbox</a> (or on Discord) to delete your account. Deletion removes your profile, registrations, availability, applications, and messages. The permanent game record, box scores and results, is retained with your gamertag, the same way any league's record book works.",
        "Questions about any of this go to the league office: reach the commissioners in the league Discord."]]] }
  };
  function legal(key) {
    var L = LEGAL[key], other = key === "terms" ? ["#/privacy", "Privacy"] : ["#/terms", "Terms of play"];
    return hero(L.k, L.t, esc(L.lede)) + '<div class="of-legal reveal">' + L.secs.map(function (s, i) {
        return '<section class="of-l-sec" aria-labelledby="ofL' + i + '"><h2 class="d-3" id="ofL' + i + '">' + esc(s[0]) + "</h2>" + s[1].map(function (p) { return '<p class="of-p">' + p + "</p>"; }).join("") + "</section>";
      }).join("") +
      '<p class="t-foot of-upd">Last updated July 16, 2026. Applies to chelgamingleague.com and the league Discord.</p>' +
      '<p class="of-back"><a class="arrow" href="' + other[0] + '"><span>' + other[1] + "</span>" + S2.ic("chev") + "</a></p></div>";
  }
  S2.page("terms", { title: "Terms of play", tab: "", render: function () { return legal("terms"); } });
  S2.page("privacy", { title: "Privacy", tab: "", render: function () { return legal("privacy"); } });

  /* =================================== PICKUP IMPORT =================================== */
  /* the live page (CG.ROUTES["pickup-import"], the page the LFG bot links after every pickup game): search an EASHL club,
     pick the game (or several sittings of one that lagged out) from EA's recent matches, and its box score attaches to
     each player's profile as pickup stats, kept apart from league play: never eligibility, standings or rating. The
     importer is g5's port (S2.pickups.importHtml and bindImport, js/pages/pickups.js), the one the statistics staff use
     on #/pickups; a confirmed import lists the game among the pickup games on file */
  S2.page("pickup-import", {
    title: "Import a pickup game", tab: "",
    render: function () {
      var member = S2.has("member");
      return hero("Pickup stats", "Import a pickup game", "Played a pickup between two EASHL clubs? Find your club, pick the game from EA's recent matches, and its box score goes onto each player's profile as pickup stats.") +
        '<section class="of-sec of-pu reveal" aria-labelledby="ofPuH">' + S2.secHead({ kicker: "Kept apart from league play", id: "ofPuH", h: "Pickup lines never touch the league record",
          p: "They show on profiles under Pickup and never count toward eligibility, standings, ratings or awards." }) +
        (member ? '<div id="ofPu">' + S2.pickups.importHtml() + "</div>"
          : S2.empty("lock", "Join to import a game", "Importing is tied to your account, so it opens once you join with Discord.", '<a class="btn site discord" href="#/you">Join with Discord</a>')) +
        '<p class="of-back"><a class="arrow" href="' + esc(S2.pickups.href()) + '"><span>Pickup games on file</span>' + S2.ic("chev") + "</a></p></section>" +
        S2.about(["EA keeps only each club's last few private matches, so import soon after playing. A game that lagged out comes back as several short sittings: tick them together and they import as one game."]);
    },
    after: function (root) { var host = S2.$("#ofPu", root); if (host) S2.pickups.bindImport(host); }
  });
})();
