/* The Season 2 training camp pool, #/camp (camp builder, briefs/market-spec.md). A public league page, website not
   dashboard: a statement hero, then On waivers, Tonight, Road to six, The whole pool, How the pool works and one "About
   this data".
   The commissioner, 2026-11-02: "2. I would like that" (a training camp pool board), and the ruling: "Only training camp
   players with at least 6 games played can be bid on at the saturday bidding events. Rostered players can be sent down
   to the league training camps only after being placed on waivers. Any team can pick up a player placed on waivers up to
   24 hours after they have been waived, like real life. Their salary cap and roster space needs to comply to be able to
   be waived. Teams must not waive inactive players but should report them to league staff".
   Everything it prints comes from S2.market (js/market.js), the league's own market (sql v4.58 and v4.59), the one
   definition of the pool, waivers, requests and bid boards; this page computes no rule of its own. Doors (each the
   database's, through S2.write): a front office, or a commissioner once they choose the club they act for, requests a
   pool player for one of its games, withdraws a request or releases an accepted guest, claims off waivers and adds to
   its bid board; the member in the pool accepts, declines or withdraws an acceptance. Nothing shows as done before the
   database confirms it, a refusal is the database's own sentence said in place, and the button waits while the door is
   open. Anyone else meets S2.locked once, from the hero.
   Seamless: every section is a host repainted in place on the market's "load" (one repaint per burst, focus kept by
   data-k), the filters and the sort repaint only the list, and the tick (once a second) only rewrites countdown text,
   unless a boundary passed (the lock, a night ending, a room opening), which repaints.
   v5.00 swap (i3e, 2026-11-25): the page runs only on the league's market; the demo's sample clock, availability marks,
   Discord previews, forced requests and claims and the pool player stand-in are gone. */
(function () {
  "use strict";
  var S2 = window.S2, M = S2 && S2.M, K = S2 && S2.market, esc = S2 && S2.esc;
  var UNITS = [["all", "All"], ["F", "Forwards"], ["D", "Defense"], ["G", "Goaltenders"]];
  var ELIG = [["all", "Everyone"], ["yes", "Six or more"], ["no", "Under six"]];
  var SORTS = { tag: "player", pos: "position", ovr: "rating", gp: "games", club: "last club" };
  var FEW = { tn: 8, road: 10, pool: 30 };
  /* the page's own view state: filters, sort, what is expanded, the refusal said in place and the row just acted on */
  var CP = { unit: "all", elig: "all", sort: "ovr", dir: -1, more: { tn: false, road: false, pool: false }, say: null, just: null, sig: "", door: null };

  /* ---------- small helpers ---------- */
  var NUMW = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  function word(n) { return NUMW[n] || String(n); }
  function cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function iso(ms) { return new Date(ms).toISOString(); }
  function team(code) { return M.team(code); }
  function city(code) { var t = team(code); return t ? t.city : String(code || ""); }
  function full(code) { var t = team(code); return t ? t.full : String(code || ""); }
  /* a crest beside a visible name is decoration (the name is read once) */
  function crest(code) { return code ? '<span class="cp-cr" aria-hidden="true">' + M.crest(code) + "</span>" : ""; }
  function rule(id) { return '<a href="#/rulebook?rule=' + id + '">Rule ' + id + "</a>"; }
  function arrow(href, label) { return '<a class="arrow" href="' + esc(href) + '"><span>' + esc(label) + "</span>" + S2.ic("chev") + "</a>"; }
  function tagLink(p, fallback) { return p ? '<a class="cp-tag" href="' + esc(p.href) + '">' + esc(p.tag) + "</a>" : '<span class="cp-tag">' + esc(fallback || "A player") + "</span>"; }
  function pos(p) { var n = p && M.posName(p.pos); return p && p.pos ? (n ? '<abbr title="' + esc(n) + '">' + esc(p.pos) + "</abbr>" : esc(p.pos)) : "–"; }
  function ovrOf(p) { return p && p.ovr ? p.ovr.ovr : null; }
  function meta(p, gp) { var o = ovrOf(p); return pos(p) + " · " + (o != null ? o + " OVR" : "Unrated") + (gp != null ? " · " + plural(gp, "game") : ""); }
  function texts(r) { return r.problems.map(function (x) { return x.text; }); }
  function sameDay(a, b) { return M.etDay(iso(a)) === M.etDay(iso(b)); }
  /* time left in words, for clocks read at a glance: "23 h 12 min", "42 min", "2 days 4 h" */
  function dur(ms) {
    if (!(ms > 0)) return "no time";
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 2) return d + " days " + (h % 24) + " h";
    if (h >= 1) return h + " h " + (m % 60) + " min";
    return m >= 1 ? m + " min" : "under a minute";
  }
  /* a countdown as the big condensed numeral: the units sit small beside the figures, so "8 H 55 MIN" never reads as a
     time of day next to "9:00 PM" */
  function big(ms) {
    ms = Math.max(0, ms);
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24), n = function (v, u) { return '<span class="d-num">' + v + '</span> <span class="cp-u">' + u + "</span> "; };   /* the spaces are for screen readers; flex drops them on screen */
    return '<span class="cp-big">' + (h >= 48 ? n(d, "days") : h >= 1 ? n(h, "h") + n(m % 60, "min") : m >= 1 ? n(m, "min") + n(s % 60, "s") : n(s % 60, "s")) + "</span>";
  }
  function say(k) { return CP.say && CP.say.k === k ? '<p class="cp-say" role="alert">' + esc(CP.say.text) + "</p>" : ""; }
  function just(pid) { return CP.just === pid ? " cp-just" : ""; }
  /* the kit's one section head (S2.secHead, audit 2026-11-09); the heading takes focus after a repaint */
  function head(o) { return S2.secHead({ kicker: o.kicker, h: o.title, id: o.id, focus: true, p: o.text, aside: o.aside, cls: "cp-sh" }); }
  function more(key, shown, total, what) {
    if (total <= FEW[key]) return "";
    /* website furniture wears the website button, as Show more does on the league, draft and profile pages (QA 2026-11-25) */
    return '<button type="button" class="btn site outline cp-more" data-cp="more" data-key="' + key + '" data-k="more:' + key + '" aria-expanded="' + CP.more[key] + '">' +
      (CP.more[key] ? "Show fewer" : "Show all " + total + " " + what) + "</button>";
  }
  /* games to be bid on: the season's own figure (season_rules mk.bid_gp), read with the market */
  function six() { return K.SIX; }
  /* the club doors: a front office, or a commissioner once they have chosen the club they act for (review 2026-11-24:
     until then they only watch, so no Claim or Request can write for a club nobody chose) */
  function office() { return S2.has("office") && !!K.club(); }
  function club() { return K.club(); }
  /* the commissioner's Acting for, the same choice as the bid room's (S2.market.setClub); Watching first */
  function actFor() {
    if (!S2.has("commish")) return "";
    var c = club();
    return '<label class="cp-actfor"><span class="kicker">Acting for</span><select class="input" data-cp-club data-k="actfor"><option value=""' + (c ? "" : " selected") + ">Watching</option>" +
      M.teams.map(function (t) { return '<option value="' + esc(t.code) + '"' + (t.code === c ? " selected" : "") + ">" + esc(t.full) + "</option>"; }).join("") + "</select></label>";
  }
  /* the pressed button waits while a door is open, so a second press cannot send it twice. A disabled button drops focus
     to the page, so the door that waits is remembered (CP.door, its data-k) and the repaint after the database's answer
     gives focus back to it, or to what stands in its place (i3e, 2026-11-25) */
  function busy(b, on) { if (!b) return; b.disabled = !!on; if (on) { b.setAttribute("aria-busy", "true"); CP.door = b.getAttribute("data-k"); } else { b.removeAttribute("aria-busy"); CP.door = null; } }
  /* the time a night's requests close: its lineup lock (8:30 PM for a 9:00 first game) */
  function lockTime(tn) { return M.etTime(iso(tn.requestsCloseAt)); }

  /* ---------- the hero: how many are in the pool, how many can be bid on, when the next bid night is ---------- */
  function liveRoom() { var r = K.room(); return r && (r.state === "live" || r.state === "closing") ? r : null; }
  function heroSide() {
    var lr = liveRoom(), nb = K.nextBidNight();
    if (lr) return '<a class="cp-cd" href="#/bidding"><span class="d-num cp-live">Live</span><span class="cp-cd-l">' +
      (lr.state === "live" ? "Saturday bidding is open until 10:00 PM ET." : "No new bidding after 10:00 PM; the last countdowns are running.") + " Open the bid room</span></a>";
    if (!nb) return "";
    return '<div class="cp-cd">' + big(nb.opens - K.now()) + ' <span class="cp-cd-l">until Saturday bidding opens, ' + esc(nb.short) + ", 9:00 PM ET</span></div>";
  }
  /* no bid night left: before the movement deadline waivers and claims still run, so only after it is bidding "over"
     (review 2026-11-02: from Sun, Jan 17 to Fri, Jan 22 the page said the deadline had passed) */
  function noBidLeft() {
    if (K.deadline == null) return ". The bid nights follow the Season 2 schedule, which is not set yet.";
    if (K.now() >= K.deadline) return ". Bidding ended at the movement deadline, so clubs now add players only through single-game requests from the training camp pool (Rule S2.5).";
    var held = K.bidNights().filter(function (b) { return !b.skipped && b.newUntil <= K.now(); }).pop();
    return "." + (held ? " The last bid night was " + esc(held.label) + "." : "") + " No Saturday bidding is left before the movement deadline, " + esc(M.etLong(iso(K.deadline))) + ".";
  }
  /* the market before it has answered, when it could not be read, and before the draft: said, never an empty pool */
  function liveHero() {
    var st = K.status(), draft = M.s2cal && M.s2cal.draft;
    var t = st.error ? "The training camp pool could not be read" : !st.loaded ? "Reading the training camp pool" : !st.draftDone ? "The pool opens after the draft" : null;
    if (!t) return null;
    var lede = st.error ? "The league did not answer just now (" + esc(st.error) + "). Reload the page to try again."
      : !st.loaded ? "One moment while the league's market is read." : "The training camp pool is every Season 2 player without a club roster spot once the draft is complete" + (draft ? ", " + esc(M.etLong(draft)) : "") + ". Clubs then request them for games, claim waived players and bid on Saturdays.";
    return '<div class="cp-hero-copy"><span class="kicker">Season 2, training camp</span><h1 class="d-hero cp-h1">' + esc(t) + "</h1></div>" +
      '<div class="cp-hero-foot"><div class="cp-hero-text"><p class="lede-l"' + (st.error ? ' role="alert"' : ' aria-live="polite"') + ">" + lede + '</p><div class="cp-cta"><a class="btn site" href="#/bidding">Open the bid room</a></div></div>' +
      '<div class="cp-hero-side" id="cpHeroSide"></div></div>';
  }
  /* QA 2026-11-25 (visual, phone, worst case and function lenses): before the draft there is no pool, so Game nights, Road
     to six and The whole pool have nothing true to say (they read "The regular season is over", "Everyone in the pool has
     six" and "0 players in the pool" under a hero that said the pool opens after the draft). Until the market says the
     draft is done (and while it is still being read, or could not be read) the page is the hero, On waivers and How the
     pool works; repaint() shows the rest once it is */
  function preDraft() { return !K.status().draftDone; }
  var AFTER_DRAFT = ["#cpTn", "#cpRoad", "#cpPool"];
  function heroIn() {
    var lh = liveHero(); if (lh) return lh;
    var pool = K.pool(), el = pool.filter(function (x) { return x.eligible; }).length, nb = K.nextBidNight(), w = K.waivers().length;
    var title = nb ? plural(pool.length, "player") + ", " + (el ? el + " ready for Saturday" : "none ready for Saturday yet") : plural(pool.length, "player") + " in the pool";
    var lede = "The training camp pool is every player without a club roster spot. Clubs request them for game nights, and a pool player with six games can be bid on at Saturday bidding" +
      (liveRoom() ? ". Bidding is open now, until 10:00 PM ET." : nb ? ", next on " + esc(nb.label) + " from 9:00 PM ET." : noBidLeft()) +
      (w ? " " + cap(word(w)) + (w === 1 ? " player is" : " players are") + " on waivers." : "");
    /* QA 2026-11-25: a public page's hero wears the website button (.btn.site, the rule recorded at js/core.js S2.footer),
       never the app's pill */
    var cta = '<a class="btn site" href="#/bidding">Open the bid room</a>' + (office() ? '<a class="btn site outline" href="#/hq?tab=bidding">Your bid board</a>'
      : actFor() ? "" : '<button type="button" class="btn site outline" data-cp="office">Front office tools</button>') + actFor();
    return '<div class="cp-hero-copy"><span class="kicker">Season 2, training camp</span><h1 class="d-hero cp-h1">' + esc(title) + "</h1></div>" +
      '<div class="cp-hero-foot"><div class="cp-hero-text"><p class="lede-l">' + lede + '</p><div class="cp-cta">' + cta + "</div></div>" +
      '<div class="cp-hero-side" id="cpHeroSide">' + heroSide() + "</div></div>";
  }

  /* ---------- On waivers: the 24-hour clock, the salary, the club that waived them, the Claim door ---------- */
  /* every waiver of the season, newest first, latest per player */
  function wireLog() {
    var seen = {};
    return K.waivers().concat(M.players.map(function (p) { return K.waiver(p.id); }).filter(function (w) { return w && !w.claimable; }))
      .filter(function (w) { if (seen[w.pid]) return false; seen[w.pid] = 1; return true; }).sort(function (a, b) { return b.at - a.at; });
  }
  function barFrac(left) { return K.WAIVER_MS ? Math.max(0, Math.min(1, left / K.WAIVER_MS)) : 0; }
  function wvRow(w) {
    var p = w.player, mine = w.from === club(), frac = barFrac(w.left);
    var act = !office() ? "" : mine ? '<span class="cp-note">Your club placed them</span>' :
      '<button type="button" class="btn sm" data-cp="claim" data-pid="' + esc(w.pid) + '" data-k="wv:' + esc(w.pid) + '">Claim at ' + esc(M.money(w.salary)) + "</button>";
    return '<li class="cp-row cp-wv' + just(w.pid) + '" data-row="' + esc(w.pid) + '">' +
      '<div class="cp-who">' + tagLink(p, w.tag) + '<span class="cp-meta">' + meta(p) + " · " + esc(M.money(w.salary)) + "</span></div>" +
      '<div class="cp-from">' + crest(w.from) + "<span>Waived by " + esc(city(w.from)) + "</span></div>" +
      '<div class="cp-clock"><span class="cp-left" data-cp-until="' + w.until + '">' + esc(dur(w.left)) + " left</span>" +
        '<span class="cp-bar" aria-hidden="true"><i data-cp-bar="' + w.until + '" style="transform:scaleX(' + frac.toFixed(4) + ')"></i></span>' +
        '<span class="cp-until">Claims close ' + esc(M.etDateTime(iso(w.until))) + "</span></div>" +
      '<div class="cp-act">' + act + "</div>" + say("wv:" + w.pid) + "</li>";
  }
  /* a voided waiver in plain words (review wf_74093353-9c3). The database's reason (market_waivers.void_why) is the
     office's alone, since it can name a ban, so the page says only what the league shows anyway: the club that now has
     them, or that they are no longer signed up for the season (a ban withdraws the sign-up too) */
  function voidWords(w) {
    var p = w.player;
    return p && p.rostered && p.club ? "Waiver ended early: they were placed with the " + full(p.club) + ", so no club could claim them"
      : "Waiver ended early: they are no longer signed up for the season, so no club could claim them and they did not join the pool";
  }
  function pastRow(w) {
    var how = w.claimedBy ? crest(w.claimedBy) + "<span>Claimed by " + esc(city(w.claimedBy)) + ", " + esc(M.etDateTime(iso(w.claimedAt))) + "</span>"
      : w.voided ? "<span>" + esc(voidWords(w)) + "</span>" : '<span>Joined the pool, ' + esc(M.etDateTime(iso(w.until))) + "</span>";
    /* a claim refused because another club got there first is said here, where the player now is */
    return '<li class="cp-row cp-past' + just(w.pid) + '" data-row="' + esc(w.pid) + '"><div class="cp-who">' + tagLink(w.player, w.tag) + '<span class="cp-meta">Waived by ' + esc(city(w.from)) + " · " + esc(M.money(w.salary)) + "</span></div>" +
      '<div class="cp-from">' + how + "</div>" + say("wv:" + w.pid) + "</li>";
  }
  function waiversIn() {
    var now = K.waivers(), past = wireLog().filter(function (w) { return !w.claimable; }).slice(0, 6);
    var title = now.length ? (now.length === 1 ? "One player on waivers" : cap(word(now.length)) + " players on waivers") : "Nobody is on waivers";
    var list = now.length ? '<ul class="cp-list" aria-labelledby="cpWvH">' + now.map(wvRow).join("") + "</ul>" :
      '<p class="cp-empty">Nobody is on waivers right now. A club places a player on waivers from its roster in Team HQ, and they show here for twenty-four hours.</p>';
    return head({ kicker: "On waivers", id: "cpWvH", title: title,
        text: "Any other club with an open roster spot and room under the cap may claim a waived player at the salary they carried. The first claim wins, and a player nobody claims within twenty-four hours joins the pool (" + rule("S2.5") + ")." }) +
      '<div class="cp-split solo"><div class="cp-main">' + list +
        (past.length ? '<h3 class="kicker cp-subh" id="cpPastH">Earlier waivers</h3><ul class="cp-list cp-quiet" aria-labelledby="cpPastH">' + past.map(pastRow).join("") + "</ul>" : "") + "</div></div>";
  }

  /* ---------- Tonight: who is available, who is requested; requests and withdrawals close when lineups lock, 30 minutes
     before the first puck drop (S2.market's requestsCloseAt, 8:30 PM for a 9:00 first game) ---------- */
  function reqOpen(tn) { return !!tn && K.now() < tn.requestsCloseAt; }
  /* who may see which club asked (PROPOSED 2026-11-23, commissioner): the requesting club and the staff until the lineup
     lock, 30 minutes before the first puck drop (S2.market's publicAt); everyone after it. Before then anyone else reads
     "Requested" with no club named */
  function seesClub(by, tn) { return !!by && (!tn || K.now() >= tn.publicAt || S2.has("staff") || (office() && by === club())); }
  /* per-game requests (PROPOSED, commissioner, 2026-11-24: "Can you do the requests per game instead of per night?"): a
     club asks for one of its games and the player accepts or declines that game; the first acceptance wins, and a camp
     player plays for one club a night */
  function gameWord(list) { return list.length === 1 ? "game " + list[0] : "games " + list.slice(0, -1).join(", ") + " and " + list[list.length - 1]; }
  function myAsks(pid) { return office() ? K.asks(club()).filter(function (a) { return a.pid === pid; }) : []; }
  function tnRow(x, tn) {
    var by = x.tonight.requestedBy, before = tn.state === "before", c = club(), open = seesClub(by, tn), mine = myAsks(x.pid);
    var waiting = mine.filter(function (a) { return a.state === "pending"; }).map(function (a) { return a.game; });
    var status = by && !open ? "<span>Taken tonight</span>" : by ? crest(by) + "<span>" + (before ? "Accepted " + gameWord(x.tonight.games) + ", " : tn.state === "live" ? "Playing for " : "Played for ") + esc(city(by)) + "</span>" :
      waiting.length ? "<span>Asked for " + gameWord(waiting) + ", waiting for an answer</span>" : x.tonight.asked.length ? "<span>Requested" + (S2.has("staff") ? " by " + plural(x.tonight.asked.length, "club") : "") + "</span>" : "<span>Available</span>";
    /* one door per player: the sheet that asks for one game at a time (requests and answers close at the lock) */
    var act = !office() || !reqOpen(tn) || (by && by !== c) ? "" : '<button type="button" class="btn sm' + (mine.length || by === c ? " secondary" : "") + '" data-cp="games" data-pid="' + esc(x.pid) + '" data-k="tn:' + esc(x.pid) + '">' + (mine.length || by === c ? "Requests" : "Request") + "</button>";
    return '<li class="cp-row cp-tn' + (by ? " is-req" : "") + just(x.pid) + '" data-row="' + esc(x.pid) + '"><div class="cp-who">' + tagLink(x.player, x.tag) + '<span class="cp-meta">' + meta(x.player, x.gp) + "</span></div>" +
      '<div class="cp-from">' + status + '</div><div class="cp-act">' + act + "</div></li>";
  }
  /* the request sheet: the club's three games tonight, one request each */
  function gamesBody(pid) {
    var tn = K.tonight(), x = K.poolPlayer(pid), c = club(), mine = myAsks(pid), placed = x && x.tonight.requestedBy === c ? x.tonight.games : [];
    if (!tn || !x) return '<p class="t-sub">' + esc(tagOf(pid)) + " is not in the pool tonight.</p>";
    var games = K.clubGames(c, tn.key);
    if (!games.length) return '<p class="t-sub">' + esc(city(c)) + " has no game " + esc(tn.short) + ", so there is nothing to request.</p>";
    return '<p class="t-sub">Ask ' + esc(x.tag) + " for one of " + esc(city(c)) + "'s games " + esc(tn.short) + ". They accept or decline each game on the site before lineups lock at " + esc(lockTime(tn)) + ", and they play for one club a night (" + rule("S2.5") + ").</p>" +
      '<div class="list cp-games">' + games.map(function (g) {
        var k = g.k, a = mine.filter(function (q) { return q.game === k; }).pop(), st = placed.indexOf(k) >= 0 ? "accepted" : a ? a.state : "";
        var time = M.etTime(iso(g.at)) + (g.opp ? " vs " + city(g.opp) : "");
        /* a club releases an accepted guest until the lock (sql v4.59, decision 2026-11-24) */
        var btn = st === "pending" ? '<button type="button" class="btn sm secondary" data-cg="release" data-game="' + k + '">Withdraw</button>' :
          st === "accepted" ? '<button type="button" class="btn sm secondary" data-cg="release" data-game="' + k + '">Release</button>' :
          st === "lapsed" ? "" : '<button type="button" class="btn sm" data-cg="request" data-game="' + k + '">Request this game</button>';
        var line = { accepted: "Accepted: add them to this game's lineup in Team HQ", pending: "Waiting for their answer", declined: "Declined", withdrawn: "Withdrawn", closed: "Closed: " + ((a && a.why) || "no longer open"), lapsed: "Lapsed unanswered" }[st] || "Not requested";
        return '<div class="row cp-game" data-game="' + k + '"><span class="grow"><span class="title">Game ' + k + " · " + esc(time) + '</span><span class="sub">' + esc(line) + "</span></span>" + btn + "</div>";
      }).join("") + '</div><p class="cp-say" role="alert" data-cg-say></p>';
  }
  function gamesSheet(pid) {
    var sh = S2.sheet({ title: "Request " + tagOf(pid), html: '<div class="cp-gsheet">' + gamesBody(pid) + "</div>" });
    var host = S2.$(".cp-gsheet", sh.el);
    sh.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cg]"); if (!b) return;
      if (b.disabled) return;
      var k = +b.getAttribute("data-game"), what = b.getAttribute("data-cg"), was = b.textContent;
      var paint = function (msg) { host.innerHTML = gamesBody(pid); var say = S2.$("[data-cg-say]", host); if (say && msg) say.textContent = msg; var f = S2.$('[data-game="' + k + '"] button', host) || S2.$("button", host); if (f) f.focus({ preventScroll: true }); };
      busy(b, true);
      (what === "request" ? K.request(pid, { club: club(), game: k }) : K.release(pid, { club: club(), game: k })).then(function (r) {
        busy(b, false);
        if (r.ok) { paint(""); S2.toast(what === "request" ? tagOf(pid) + " requested for game " + k + "; they answer on the site." : was === "Release" ? tagOf(pid) + " released from game " + k + "." : "Request for game " + k + " withdrawn.", "ok"); return; }
        paint(texts(r).join(" "));
      });
    });
    return sh;
  }
  /* the pool player's answers (their own door): the camp page, the Inbox and the You page show it to the member in the
     pool (S2.market.poolMe). Each request is one club's game */
  function asksCard(gameId) {
    /* the inbox shows this card too (js/inbox.js), often before any page has read the real market: a member asks for it
       here, and until it answers the card is an empty host that the market's "load" fills in place (the handler at the
       foot of this file swaps #cpAsk wherever it is), never a card that silently stays away */
    /* review 2026-11-24: the card follows the member, never the role. S2.roleOf ranks a commissioner, a seat and a
       staffer before a player, so a staffer or commissioner in the pool never saw Accept, and their requests lapsed at
       the lock while market_pool_answer would have taken their answer. The card is the signed-in member's when they are
       in the pool or have a request (S2.market.poolMe).
       A member on a club roster this season is never in the pool, and a seat holds a roster spot (Owner and GM count in
       the twelve), so their Inbox never pays for the market read; whether anyone else is in it is the market's answer */
    var me0 = S2.session && S2.session.profileId, pl = me0 ? M.player(me0) : null;
    if (!me0 || S2.session.seat || (pl && pl.rostered)) return "";
    K.ensure();
    /* gameId: the card cut to one game, for the Game Center (health links 5, 2026-11-25: a request's notification opens
       #/game/<id>, which had no Accept or Decline). The host carries it, so the market's "load" (the handler at the foot of
       this file) repaints the same cut wherever the card is; with no request for that game the host stays empty */
    var only = gameId ? ' data-game-id="' + esc(gameId) + '"' : "", none = '<div id="cpAsk"' + only + " hidden></div>";
    if (!K.tonight() || !K.poolMe()) return none;
    var me = K.poolMe(), tn = K.tonight();
    /* on the Game Center the card is a section under the match room's h1, beside S2.secHead's h2s; in the Inbox and on the
       camp page it sits under an h2 (the review of links 5, 2026-11-25: h1, h3, h2 on the game page) */
    var hl = gameId ? "h2" : "h3";
    var head0 = '<div class="cp-ask" id="cpAsk"' + only + ' aria-labelledby="cpAskH"><' + hl + ' class="cp-ask-h" id="cpAskH">Requests for you</' + hl + ">";
    var mine = K.asksFor(me).filter(function (a) { return !gameId || a.gameId === gameId; }), open = mine.filter(function (a) { return a.state === "pending"; });
    if (gameId && !mine.length) return none;
    return head0 + '<p class="t-foot">' + (open.length ? "Answer by " + esc(lockTime(tn)) + ", when lineups lock; an unanswered request lapses." : "Nothing waits for an answer.") + "</p>" +
      '<div class="list cp-ask-l">' + mine.map(function (a) {
        var ids = ' data-pid="' + esc(a.pid) + '" data-club="' + esc(a.club) + '" data-game="' + a.game + '"' + (a.id ? ' data-id="' + esc(a.id) + '"' : "");
        /* the player withdraws an acceptance until the lock (sql v4.59, decision 2026-11-24) */
        var st = a.state, act = st === "pending" ? '<span class="cp-ask-b"><button type="button" class="btn sm" data-cp="accept"' + ids + '>Accept</button><button type="button" class="btn sm secondary" data-cp="decline"' + ids + ">Decline</button></span>"
          : st === "accepted" && K.now() < tn.requestsCloseAt ? '<span class="cp-ask-b"><button type="button" class="btn sm secondary" data-cp="decline"' + ids + ">Withdraw</button></span>" : "";
        var line = { pending: "Waiting for your answer", accepted: "Accepted: the lobby code reaches you by bot DM for this game", declined: "You declined", withdrawn: "Withdrawn by the club", closed: "Closed: " + (a.why || "no longer open"), lapsed: "Lapsed unanswered" }[st] || st;
        return '<div class="row cp-ask-r" data-ask="' + esc(a.club + ":" + a.game) + '">' + crest(a.club) + '<span class="grow"><span class="title">' + esc(full(a.club)) + " · game " + a.game + ", " + esc(a.time.replace(/ /g, "\u00a0")) + '</span><span class="sub">' + esc(line) + "</span></span>" + act + "</div>";
      }).join("") + '</div><p class="t-foot">You play for one club a night, with no roster spot, contract or club room; the slip ends with the game (' + rule("S2.5") + ').</p></div>';
  }
  function answerAsk(b, yes) {
    if (b.disabled) return;
    var pid = b.getAttribute("data-pid"), o = { club: b.getAttribute("data-club"), game: +b.getAttribute("data-game"), id: b.getAttribute("data-id") || null }, was = b.textContent;
    busy(b, true);
    (yes ? K.accept(pid, o) : K.decline(pid, o)).then(function (r) {
      busy(b, false);
      if (r.ok) return S2.toast(yes ? "You accepted the " + full(o.club) + "'s game " + o.game + ". The lobby code comes by bot DM." : was === "Withdraw" ? "You withdrew from the " + full(o.club) + "'s game " + o.game + "." : "You declined the " + full(o.club) + "'s game " + o.game + ".", "ok");
      S2.toast(texts(r).join(" "), "err");
    });
  }
  /* the bell is the league's (js/live.js) */
  S2.poolAsks = { html: asksCard, bind: function (root) {
    var c = S2.$("#cpAsk", root); if (!c || c.dataset.bound) return; c.dataset.bound = "1";
    c.addEventListener("click", function (e) { var b = e.target.closest('[data-cp="accept"], [data-cp="decline"]'); if (b) answerAsk(b, b.getAttribute("data-cp") === "accept"); });
  } };
  function tnLeft(tn) {
    if (!reqOpen(tn)) return "";
    var at = M.etTime(new Date(tn.requestsCloseAt).toISOString());
    return '<div class="cp-cd">' + big(tn.requestsCloseAt - K.now()) + ' <span class="cp-cd-l">' + (sameDay(K.now(), tn.at) ? "until requests close at " + at + ", when lineups lock" : "until requests close, " + esc(tn.short) + " at " + at) + "</span></div>";
  }
  /* no night tonight and none ahead: over only once the season's regular nights exist and every one has passed. With none
     scheduled yet (K.gameNights(), the same regular nights K.tonight() reads) the schedule is simply not set (QA
     2026-11-25: before the schedule the page said the regular season was over). Never M.games: it holds playoff games too */
  function noNightIn() {
    if (K.gameNights().length) return head({ kicker: "Game nights", id: "cpTnH", title: "The regular season is over", text: "No game nights remain, and pool players are not requested in the playoffs (" + rule("S2.7") + ")." });
    var pd = M.s2cal && M.s2cal.puckDrop, ahead = pd && Date.parse(pd) > K.now();
    return head({ kicker: "Game nights", id: "cpTnH", title: "No game nights yet",
      text: "The game nights follow the Season 2 schedule, which is not set yet" + (ahead ? "; puck drop is " + esc(M.etLong(pd)) : "") + ". Clubs then request pool players for their games (" + rule("S2.5") + ")." });
  }
  function tonightIn() {
    var tn = K.tonight(), t = K.now();
    if (!tn) return noNightIn();
    var pool = K.pool(), reqs = K.requests(), c = club();
    /* rating order, never re-sorted by a request: the row a person just tapped stays under their finger. Collapsed, the
       list keeps the viewer's own requests wherever they sit (their Withdraw door), but not every club's (break-ui: with
       every player requested the collapsed list ran to fifty rows) */
    var rows = pool.filter(function (x) { return x.tonight.available || x.tonight.requestedBy; }), shown = CP.more.tn ? rows : rows.filter(function (x, i) { return i < FEW.tn || (office() && (x.tonight.requestedBy === c || myAsks(x.pid).length)); });
    var asked = rows.filter(function (x) { return x.tonight.requestedBy; }), free = rows.filter(function (x) { return !x.tonight.requestedBy; });
    var same = sameDay(t, tn.at), when = same ? "Tonight, " + tn.short : "Next game night, " + tn.short, before = tn.state === "before";
    var nAsk = asked.length, nAv = free.length + nAsk, mine = reqs.filter(function (q) { return q.club === c; });
    var title = reqOpen(tn) ? (same ? "Requests close at " + M.etTime(new Date(tn.requestsCloseAt).toISOString()) : "Requests are open for " + tn.label.split(",")[0])
      : tn.state === "done" ? "Tonight's games are done" : "Requests closed when lineups locked";
    var text = tn.state === "before" ? cap(plural(nAv, "pool player")) + " can be asked, and " + (nAsk ? word(nAsk) + (nAsk === 1 ? " has" : " have") + " been requested" : "no club has requested one yet") +
        '. A club requests a camp player for one of its games, and the player accepts or declines that game on the site; the first acceptance wins, and a camp player plays for one club a night. A club uses up to ' + word(M.RULES.s2.poolNight) + ' different camp players a night and three in any one game. Requests and answers close when lineups lock with the server picks at ' + lockTime(tn) + ', an unanswered request lapses then, and which club asked stays between that club and the staff until then (' + rule("S2.5") + ")."
      : tn.state === "live" ? cap(plural(nAsk, "camp player")) + (nAsk === 1 ? " is" : " are") + " filling in for the clubs whose games they accepted. Each game counts toward six once the night ends."
      : cap(plural(nAsk, "camp player")) + " filled in tonight, one game toward six for each game played. Requests for the next game night open at midnight.";
    var waits = office() ? K.asks(c).filter(function (a) { return a.state === "pending"; }) : [];
    var you = office() && reqOpen(tn) ? '<p class="cp-you">' + (mine.length || waits.length ? esc(city(c)) + (mine.length ? " has " + mine.map(function (q) { var p = M.player(q.pid); return esc(p ? p.tag : "a player") + " for " + gameWord(q.games); }).join(", ") + " (" + mine.length + " of " + M.RULES.s2.poolNight + " camp players for the night)" : " has no camp player yet") +
        (waits.length ? "; " + plural(waits.length, "request") + " " + (waits.length === 1 ? "waits" : "wait") + " for an answer" : "") + "."
      : esc(city(c)) + " has not requested anyone for " + (same ? "tonight" : esc(tn.short)) + ".") + "</p>" : "";
    return head({ kicker: when, id: "cpTnH", title: title, text: text, aside: '<div id="cpTnLeft">' + tnLeft(tn) + "</div>" }) + you + asksCard() +
      '<div class="cp-split solo"><div class="cp-main">' + (rows.length ? '<ul class="cp-list" aria-labelledby="cpTnH">' + shown.map(function (x) { return tnRow(x, tn); }).join("") + "</ul>" :
        '<p class="cp-empty">No training camp player can be asked for ' + esc(tn.label) + " yet.</p>") +
        more("tn", shown.length, rows.length, "available") + "</div></div>";
  }

  /* ---------- Road to six: who is short, and what a requested night does (three games) ---------- */
  function pips(gp, next) {
    var h = "", n = six() || 0; for (var i = 0; i < n; i++) h += '<i class="' + (i < gp ? "on" : i < gp + next ? "next" : "") + '"></i>';
    return '<span class="cp-pips" aria-hidden="true">' + h + "</span>";
  }
  function roadRow(x, tn) {
    /* each game a player accepted adds one once the night ends (per-game requests, PROPOSED 2026-11-24) */
    var by = x.tonight.requestedBy, g = x.tonight.games.length, next = by && tn && tn.state !== "done" ? Math.min(g, x.needs) : 0;
    var note = next ? (seesClub(by, tn) ? (tn.state === "live" ? "Playing for " : "Filling in for ") + esc(city(by)) : "Filling in") + " tonight: " + (x.needs <= g ? "eligible once the night ends" : (x.gp + g) + " of " + six() + " after it")
      : plural(x.needs, "game") + " to go";
    return '<li class="cp-row cp-road' + just(x.pid) + '" data-row="' + esc(x.pid) + '"><div class="cp-who">' + tagLink(x.player, x.tag) + '<span class="cp-meta">' + meta(x.player) + "</span></div>" +
      '<div class="cp-prog">' + pips(x.gp, next) + '<span class="cp-gp"><b class="num">' + x.gp + "</b> of " + six() + " games</span></div>" +
      '<p class="cp-road-n' + (next ? " is-next" : "") + '">' + note + "</p></li>";
  }
  function roadIn() {
    var tn = K.tonight(), short = K.pool().filter(function (x) { return !x.eligible; })
      .sort(function (a, b) { return a.needs - b.needs || (b.ovr || 0) - (a.ovr || 0) || String(a.tag).localeCompare(String(b.tag)); });
    var shown = CP.more.road ? short : short.slice(0, FEW.road), one = short.filter(function (x) { return x.needs <= 3; }).length;
    /* an empty pool is nobody, never "everyone has six" (QA 2026-11-25, worst case) */
    return head({ kicker: "Road to six", id: "cpRoadH", title: short.length ? plural(short.length, "player") + " short of six" : K.pool().length ? "Everyone in the pool has six" : "Nobody in the pool yet",
        text: "Six games played makes a pool player eligible for Saturday bidding (" + rule("S2.6") + "). Every game of the season counts, at any club, and each game a pool player accepts and plays adds one. " +
          (short.length ? cap(word(one)) + " of them " + (one === 1 ? "is" : "are") + " three games or fewer away." : "") }) +
      (short.length ? '<ul class="cp-list cp-roads" aria-labelledby="cpRoadH">' + shown.map(function (x) { return roadRow(x, tn); }).join("") + "</ul>" + more("road", shown.length, short.length, "short of six") : "");
  }

  /* ---------- The whole pool: sortable, filtered by position and eligibility, with the bid board door ---------- */
  function filtered() {
    return K.pool().filter(function (x) { return (CP.unit === "all" || x.unit === CP.unit) && (CP.elig === "all" || (CP.elig === "yes") === x.eligible); });
  }
  function sorted(list) {
    var k = CP.sort, d = CP.dir, val = function (x) { return k === "tag" ? String(x.tag).toLowerCase() : k === "pos" ? M.POS_RANK[x.pos] || 9 : k === "club" ? city(x.lastClub).toLowerCase() : k === "gp" ? x.gp : x.ovr == null ? -1 : x.ovr; };
    /* ties keep the pool's own order (rating, then games, then gamertag), so a sort never shuffles equal rows */
    return list.map(function (x, i) { return { x: x, i: i, v: val(x) }; }).sort(function (a, b) { return (a.v < b.v ? -1 : a.v > b.v ? 1 : 0) * d || a.i - b.i; }).map(function (o) { return o.x; });
  }
  function poolHead() {
    var pool = K.pool(), top = pool[0];
    return head({ kicker: "The whole pool", id: "cpPoolH", title: top && top.ovr != null ? top.tag + " tops the pool at " + top.ovr : plural(pool.length, "player") + " in the pool",
      text: "Every pool player, best rated first. " + (office() ? "Add the ones your club wants to its bid board, then set ceilings and notes in Team HQ before Saturday." : "Each one links to their profile."),
      aside: office() ? arrow("#/hq?tab=bidding", "Your bid board") : arrow("#/bidding", "Bid room") });
  }
  function th(key, label, cls) {
    var on = CP.sort === key;
    return '<th scope="col"' + (cls ? ' class="' + cls + '"' : "") + (on ? ' aria-sort="' + (CP.dir < 0 ? "descending" : "ascending") + '"' : "") + '><button type="button" data-cp="sort" data-key="' + key + '" data-k="sort:' + key + '">' + label +
      '<span class="cp-dir" aria-hidden="true">' + (on ? (CP.dir < 0 ? "↓" : "↑") : "") + "</span></button></th>";
  }
  function poolRow(x) {
    var by = x.tonight.requestedBy, ob = office() ? K.onBoard(club(), x.pid) : null;
    var six = x.eligible ? '<span class="cp-ok">Eligible</span>' : x.needs + " to go", from = x.lastClub ? crest(x.lastClub) + "<span>" + esc(x.lastClub) + (x.source === "waivers" ? ", off waivers" : "") + "</span>" : "<span>None</span>";
    var tn = by ? (seesClub(by, K.tonight()) ? "Filling in, " + esc(city(by)) : "Taken tonight") : x.tonight.available ? "Available" : '<span class="cp-dim">Not available</span>';
    var act = !office() ? "" : '<td class="cp-c-act">' + (ob ? '<a class="cp-onb" href="#/hq?tab=bidding" data-k="pl:' + esc(x.pid) + '">' + S2.ic("check", "cp-onb-i") + '<span class="cp-wide">On board </span>#' + ob.rank + "</a>" :
      '<button type="button" class="btn sm secondary" data-cp="board" data-pid="' + esc(x.pid) + '" data-k="pl:' + esc(x.pid) + '"><span>Add<span class="cp-wide"> to bid board</span></span></button>') + say("pl:" + x.pid) + "</td>";
    return '<tr class="' + just(x.pid).trim() + '" data-row="' + esc(x.pid) + '"><td class="cp-c-who">' + tagLink(x.player, x.tag) +
        '<span class="cp-sub">' + esc(x.pos || "") + " · " + (x.eligible ? "Eligible" : x.needs + " to six") + (x.lastClub ? " · " + esc(x.lastClub) : "") + "</span></td>" +
      '<td class="cp-c-pos">' + pos(x.player) + '</td><td class="num">' + (x.ovr == null ? "–" : x.ovr) + '</td><td class="num">' + x.gp + "</td>" +
      '<td class="cp-c-six">' + six + '</td><td class="cp-c-club"><span class="cp-clubc">' + from + '</span></td><td class="cp-c-tn">' + tn + "</td>" + act + "</tr>";
  }
  function poolList() {
    var all = K.pool().length, list = sorted(filtered()), shown = CP.more.pool ? list : list.slice(0, FEW.pool), draft = M.s2cal && M.s2cal.draft;
    /* an empty pool is said as one, never as a filter that matched nobody (QA 2026-11-25) */
    if (!all) return '<p class="cp-count" aria-live="polite">' + (preDraft() ? "The pool forms when the draft is complete" + (draft ? ", " + esc(M.etLong(draft)) : "") + "."
      : "Nobody is in the pool right now.") + "</p>";
    if (!list.length) return '<p class="cp-count" aria-live="polite">No pool player matches these filters.</p>';
    return '<p class="cp-count" aria-live="polite">Showing ' + (shown.length < list.length ? shown.length + " of " : "") + plural(list.length, "player") + (list.length < all ? ", of " + all + " in the pool" : "") + ", by " + SORTS[CP.sort] + ".</p>" +
      '<div class="tbl-wrap cp-tblw"><table class="tbl cp-tbl"><caption class="sr">The training camp pool</caption><thead><tr>' + th("tag", "Player") + th("pos", "Pos", "cp-c-pos") + th("ovr", "OVR") + th("gp", "GP") +
        '<th scope="col" class="cp-c-six">To six</th>' + th("club", "Last club", "cp-c-club") + '<th scope="col" class="cp-c-tn">Tonight</th>' + (office() ? '<th scope="col" class="cp-c-act"><span class="sr">Bid board</span></th>' : "") +
      "</tr></thead><tbody>" + shown.map(poolRow).join("") + "</tbody></table></div>" + more("pool", shown.length, list.length, "players");
  }
  function seg(id, items, cur, label) {
    return '<div class="seg cp-seg" id="' + id + '" role="group" aria-label="' + esc(label) + '">' + items.map(function (it) { return '<button type="button" data-v="' + it[0] + '" aria-pressed="' + (it[0] === cur) + '">' + it[1] + "</button>"; }).join("") + "</div>";
  }

  /* ---------- How the pool works (the rules in plain words; the rulebook holds the formal text) ---------- */
  function howHtml() {
    var off = K.bidNights().filter(function (b) { return b.skipped; }).map(function (b) { return b.label; });
    var blocks = [
      ["Who is in it", "S2.5", "Every player without a club roster spot. A rostered player joins only through waivers: for twenty-four hours any other club with an open roster spot and cap room may claim them at their salary, and the first claim wins. A club never waives a player for being inactive; it reports them to the league office instead.",
        '<button type="button" class="cp-link" data-flow="case" data-type="complaint">Report an inactive player</button>'],
      ["Game nights", "S2.5", "A club requests them for one of its games, and they accept or decline each game on the site: the first acceptance wins, a camp player plays for one club a night, and the same club may ask for more of its games. A club uses up to three different camp players a night and three in any one game, so at least half of every lineup, three of its six, comes from its own roster. Until the lock a club may withdraw a request or release a player who accepted, and the player may withdraw an acceptance; an unanswered request lapses at the lock. An accepted request is a one-game permission slip, with no roster spot, contract or cap figure; the player's stats count in full and toward six. Requests and withdrawals both close when lineups lock with the server picks, 30 minutes before the night's first puck drop (8:30 PM ET for a 9:00 game); until then only the requesting club and the staff see who asked, and after it everyone does. The pool's Discord channel, #free-agency, is private to league staff, club management and the pool: management may ask there who can fill in, but only a request on the site counts. It gets one automatic post at the movement deadline.", ""],
      ["Saturday bidding", "S2.6", "Once a pool player has six games, clubs may bid on them on Saturdays from 9 to 10 PM ET before the movement deadline. Bids open at " + (K.MIN != null ? M.money(K.MIN) + " and rise by exactly " + M.money(K.STEP) : "the season's opening price and rise by exactly one step") + "; a club holding the top bid waits for another club to raise it. A player nobody bids on stays in the pool, still eligible." +
        (off.length ? " No bidding on " + off.join(" or ") + ": holiday weeks." : ""), '<a class="cp-link" href="#/bidding">The bid room</a>'],
      ["Roster and cap", "S2.4", "A club carries up to " + word(M.RULES.s2.limit) + " active players all season and keeps at least " + word(M.RULES.s2.min.F) + " forwards, " + word(M.RULES.s2.min.D) + " defense and " + word(M.RULES.s2.min.G) + " goaltender. Season 2 cap room is the " + M.money(M.RULES.s2.cap) + " cap less the active roster, and no claim or bid may take a club past " + word(M.RULES.s2.limit) + " or over the cap, counting every bid it leads.", ""]
    ];
    return head({ kicker: "How the pool works", id: "cpHowH", title: "Six games, then Saturday", text: "The pool in plain words. The rulebook holds the formal text." }) +
      '<div class="cp-how">' + blocks.map(function (b) {
        return '<div class="cp-how-b"><h3 class="d-3">' + esc(b[0]) + "</h3><p>" + esc(b[2]) + '</p><p class="cp-how-l">' + rule(b[1]) + (b[3] ? '<span aria-hidden="true">·</span>' + b[3] : "") + "</p></div>";
      }).join("") + "</div>";
  }

  /* ---------- painting in place ---------- */
  function sig() {
    var tn = K.tonight(), nb = K.nextBidNight(), lr = liveRoom();
    return [tn ? tn.key + tn.state + (reqOpen(tn) ? "" : "L") : "-", nb ? nb.key : "-", lr ? lr.key + lr.state : "-", K.waivers().length].join("|");   /* the lock is a boundary too */
  }
  /* replace a host's html, and give focus back to the same control (data-k) if it was inside; a control that is gone
     hands focus to the section's headline, never to the top of the page */
  function paint(sel, html) {
    var host = document.querySelector(sel); if (!host) return;
    var a = document.activeElement, k = a && host.contains(a) ? a.getAttribute("data-k") : null, had = a && host.contains(a);
    /* focus fell to the page while a door in this host waited on the database: it goes back to that door */
    if (!had && CP.door && (!a || a === document.body) && S2.$$("[data-k]", host).some(function (e) { return e.getAttribute("data-k") === CP.door; })) { had = true; k = CP.door; }
    host.innerHTML = html;
    if (!had) return;
    var f = k && S2.$$("[data-k]", host).filter(function (e) { return e.getAttribute("data-k") === k; })[0];
    (f || S2.$("h2[tabindex]", host) || host).focus({ preventScroll: true });
  }
  function repaint() {
    if (!document.getElementById("cpRoot")) return;
    paint("#cpHeroIn", heroIn()); paint("#cpWv", waiversIn()); paint("#cpTn", tonightIn()); paint("#cpRoad", roadIn());
    paint("#cpPoolHead", poolHead()); paint("#cpPoolList", poolList());
    paint("#cpHow", howHtml());   /* its bid ladder is the season's own figures, known once the market is read */
    var pre = preDraft(); AFTER_DRAFT.forEach(function (sel) { var e = document.querySelector(sel); if (e && e.hidden !== pre) e.hidden = pre; });
    CP.sig = sig(); CP.just = null;
  }
  /* one repaint per burst: a claim fires "s2:market" and "s2:demo", a skip fires dozens */
  var queued = false;
  function later() { if (queued) return; queued = true; Promise.resolve().then(function () { queued = false; repaint(); }); }
  /* a quiet settle for a list a filter or a sort just redrew (Emil: tens of times a session, so 160ms of opacity only) */
  function settle(sel) { var h = document.querySelector(sel); if (h && h.animate) h.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 160, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }); }
  /* once a second: countdown text only, unless a boundary passed */
  function tick() {
    if (sig() !== CP.sig) return later();
    var t = K.now();
    S2.$$("#cpRoot [data-cp-until]").forEach(function (e) { e.textContent = dur(+e.getAttribute("data-cp-until") - t) + " left"; });
    S2.$$("#cpRoot [data-cp-bar]").forEach(function (e) { e.style.transform = "scaleX(" + barFrac(+e.getAttribute("data-cp-bar") - t).toFixed(4) + ")"; });
    var hs = S2.$("#cpHeroSide"), tl = S2.$("#cpTnLeft");
    if (hs) hs.innerHTML = heroSide();
    if (tl) tl.innerHTML = tnLeft(K.tonight());
  }
  function setQ() {
    var q = [CP.unit !== "all" ? "pos=" + CP.unit : "", CP.elig !== "all" ? "elig=" + CP.elig : ""].filter(Boolean).join("&");
    try { history.replaceState(history.state, "", "#/camp" + (q ? "?" + q : "")); } catch (e) { console.warn("camp: the address could not be updated (" + e.message + "); the list still changed"); }
  }

  /* ---------- the doors ---------- */
  function sayIn(k, r) { CP.say = { k: k, text: texts(r).join(" ") }; later(); }
  function tagOf(pid) { var p = M.player(pid); return p ? p.tag : "That player"; }
  /* a claim: the database's refusal (no open spot, no cap room, claimed first) is said under the row */
  function claim(pid, b) {
    busy(b, true);
    K.claim(pid, { club: club() }).then(function (r) {
      busy(b, false);
      if (r.ok) { CP.say = null; S2.toast(full(club()) + " claimed " + tagOf(pid) + " off waivers.", "ok"); return; }
      sayIn("wv:" + pid, r);
    });
  }
  function board(pid, b) {
    var c = club();
    busy(b, true);
    K.boardAdd(c, pid, {}).then(function (r) {
      busy(b, false);
      if (!r.ok) return sayIn("pl:" + pid, r);
      CP.say = null; CP.just = pid;
      S2.toast("Added " + tagOf(pid) + " to " + city(c) + "'s bid board.", "ok");
      /* the kit's toast takes text only: the link to the board goes in after it (the row keeps its own "On board" link) */
      var t = S2.$$(".toast-root .toast").pop();
      if (t) { var a = document.createElement("a"); a.className = "cp-toast-a"; a.href = "#/hq?tab=bidding"; a.textContent = "Open the board"; t.appendChild(a); }
    });
  }
  function officeOnly() {
    S2.locked({ title: "Claims, requests and bid boards", who: "A club's Owner, GM or AGM",
      why: "A front office requests pool players for game nights, claims players off waivers and keeps a private bid board for Saturday bidding (Rules S2.5 and S2.6)." });
  }
  function onClick(e) {
    var b = e.target.closest("[data-cp]"); if (!b) return;
    var k = b.getAttribute("data-cp"), pid = b.getAttribute("data-pid");
    if (k === "office") return officeOnly();
    if (k === "more") { var key = b.getAttribute("data-key"); CP.more[key] = !CP.more[key]; return repaint(); }
    if (k === "sort") { var s = b.getAttribute("data-key"); if (CP.sort === s) CP.dir = -CP.dir; else { CP.sort = s; CP.dir = s === "tag" || s === "pos" || s === "club" ? 1 : -1; } paint("#cpPoolList", poolList()); return settle("#cpPoolList"); }
    /* the pool player's own answers come before the front-office doors */
    if (k === "accept" || k === "decline") return answerAsk(b, k === "accept");
    if (!office()) return officeOnly();
    if (k === "games") return gamesSheet(pid);
    if (b.disabled) return;
    if (k === "claim") return claim(pid, b);
    if (k === "board") return board(pid, b);
  }

  /* ---------- the page ---------- */
  /* the league pulse never re-routes the page: the market's own domains read the market again (its "load" repaints every
     section in place), and the rest (ratings, schedule, clubs, people) repaint the sections in place from the model */
  if (S2.LIVE_DOMAINS) Object.keys(S2.LIVE_DOMAINS).forEach(function (d) {
    if (d === "market" || d === "rosters" || d === "signups") return;
    S2.live.on(d, function () { if (document.getElementById("cpRoot")) later(); });
  });
  S2.page("camp", {
    title: "Training camp", repaintsItself: true,
    render: function (r) {
      if (!M || !K) return '<header class="hero"><span class="kicker">Season 2</span><h1 class="d-1">Training camp</h1><p class="lede-l" role="alert">The Season 2 market did not load, so the pool cannot be shown. Reload the page.</p></header>';
      CP.unit = UNITS.some(function (u) { return u[0] === r.q.pos; }) ? r.q.pos : "all";
      CP.elig = ELIG.some(function (u) { return u[0] === r.q.elig; }) ? r.q.elig : "all";
      CP.say = null; CP.just = null; CP.more = { tn: false, road: false, pool: false };
      K.ensure();   /* the market is read when a page asks; each answer repaints every section in place */
      var hide = preDraft() ? " hidden" : "";
      return '<div class="cp" id="cpRoot">' +
        '<header class="hero cp-hero reveal" id="cpHeroIn">' + heroIn() + "</header>" +
        '<section class="cp-sec reveal" id="cpWv" aria-labelledby="cpWvH">' + waiversIn() + "</section>" +
        '<section class="band ink cp-band reveal" id="cpTn" aria-labelledby="cpTnH" data-theme="dark" data-look-scope data-finish="' + esc(S2.state.finish) + '"' + hide + ">" + tonightIn() + "</section>" +
        '<section class="cp-sec reveal" id="cpRoad" aria-labelledby="cpRoadH"' + hide + ">" + roadIn() + "</section>" +
        '<section class="band tint cp-band reveal" id="cpPool" aria-labelledby="cpPoolH"' + hide + '><div id="cpPoolHead">' + poolHead() + "</div>" +
          '<div class="cp-tools">' + seg("cpUnit", UNITS, CP.unit, "Position") + seg("cpElig", ELIG, CP.elig, "Games toward six") + "</div>" +
          '<div id="cpPoolList">' + poolList() + "</div></section>" +
        '<section class="cp-sec reveal" id="cpHow" aria-labelledby="cpHowH">' + howHtml() + "</section>" +
        S2.about([
          "The pool, the games toward six, the waivers and the requests come from the league's own market, the same one the bid room and Team HQ read, and they follow it as it changes.",
          "Games toward six count box scores of the season's regular-season games at any club. Which club asked a player stays between that club, the player and the staff until the night's lineups lock, and is open to everyone after it."
        ]) + "</div>";
    },
    after: function (root) {
      var cr = S2.$("#cpRoot", root); if (!cr) return;
      cr.addEventListener("click", onClick);
      /* Acting for: the market reads that club (its state and board) and its "load" repaints every section in place */
      cr.addEventListener("change", function (e) { if (e.target.matches("[data-cp-club]")) K.setClub(e.target.value); });
      S2.segmented(S2.$("#cpUnit", cr), function (v) { CP.unit = v; CP.more.pool = false; setQ(); paint("#cpPoolList", poolList()); settle("#cpPoolList"); });
      S2.segmented(S2.$("#cpElig", cr), function (v) { CP.elig = v; CP.more.pool = false; setQ(); paint("#cpPoolList", poolList()); settle("#cpPoolList"); });
      CP.sig = sig();
    }
  });

  /* registered once, at load: it looks for the page and does nothing when another page is showing, except the pool
     player's answers card, which repaints wherever it is (the Inbox, the You page) */
  if (K) K.on(function (e) {
    if (e.type !== "tick" && !document.getElementById("cpRoot")) { var ask = S2.$("#cpAsk"); if (ask) { ask.outerHTML = asksCard(ask.getAttribute("data-game-id")); S2.poolAsks.bind(document); } }
    if (!document.getElementById("cpRoot")) return;
    if (e.type === "tick") return tick();
    later();
  });
})();
