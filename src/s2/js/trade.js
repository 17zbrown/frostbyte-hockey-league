/* CGHL Season 2: S2.trade, the ONE way to draw the trade reading (an Eval, worked out from the league model).
   Commissioner, 2026-10-20: "For the trade features, can the trade page itself be more detailed with stats and
   comparisons, to show the strength of the trade per side so players can have a little more assistance on making fair
   trades?" Every view draws the same reading through these calls: the Team HQ trade page (js/pages/tradebuild.js, since
   2026-11-03: the full detail under its own match center, and each roster row's player block), Team HQ Trades (hq.js: each offer's reading and its Details sheet) and the Staff Desk
   Transactions pane (desk.js). A website section, not a dashboard: the sentence first, then the two sides in their club
   colors, one balance bar with the reading under it, and the rosters after the trade.

   API (html strings; every call takes an Eval from S2.trade.evaluate, below)
     S2.trade.detail(ev, { me, proposing }) -> html   the full reading. me: the viewer's club (the reading says "you");
                                                      proposing: a trade still being built (says the check runs again)
     S2.trade.compact(ev, { me }) -> html            the live reading: the verdict, the value each club gets, the bar
     S2.trade.patch(host, ev, { me })                repaints a compact reading in place; the bar glides to its new split
     S2.trade.pill(ev, { me }) -> html               the verdict alone ("Favors you by 12%", "Even"), for a list row
     S2.trade.verdict(ev, me) -> "Favors you by 12%"
     S2.trade.playerBody(PlayerEval) -> html          one player's rating, lines, ranks and form
     S2.trade.hydrate(root)                          the one entrance (rank bars, the radar, the bar); call once
                                                      after the detail is in the page
   A sheet that shows the detail adds the class "tr-wide" (css/trade.css), so both sides sit side by side on a desktop. */
(function () {
  "use strict";
  var S2 = window.S2, esc = S2.esc;
  function M() { return S2.M; }
  function team(code) { return M().team(code) || { code: code, city: code, name: code, full: code, color: null }; }
  function city(code) { return team(code).city; }
  function cash(n) { n = Math.abs(+n || 0); return n === 0 ? "$0" : M().money(n); }
  function list(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  /* the club a reading speaks for: the viewer's when they are one of the two, else the proposing club */
  function left(ev, me) { return me && (me === ev.from || me === ev.to) ? me : ev.from; }
  function other(ev, code) { return code === ev.from ? ev.to : ev.from; }
  function gets(ev, code) { return code === ev.from ? ev.sides[1] : ev.sides[0]; }   /* sides[0] is what `from` sends */
  function who(code, me, cap) { return code === me ? (cap ? "You" : "you") : city(code); }
  function getsWord(code, me) { return code === me ? "You get" : city(code) + " gets"; }
  function getsLow(code, me) { return code === me ? "you get" : city(code) + " gets"; }

  S2.trade = {};
  var T = S2.trade;
  T.verdict = function (ev, me) {
    var r = ev.reading;
    return r.state === "favors" ? "Favors " + who(r.favors, me) + " by " + r.pct + "%" : r.text;
  };
  /* the dot's tone for this reader. A trade that leans their way is good news, so it takes the neutral accent, never
     the warning or loss color (audit 2026-11-09: "Favors you by 26%" wore the red dot); a lean the other way keeps it */
  T.tone = function (ev, me) { var r = ev.reading; return r.state === "favors" && me && r.favors === me ? "mine" : r.tone; };
  T.pill = function (ev, o) {
    o = o || {};
    return '<span class="tr-pill" data-tone="' + T.tone(ev, o.me) + '"><span class="tr-tone" aria-hidden="true"></span>' + esc(T.verdict(ev, o.me)) + "</span>";
  };

  /* ---------- the balance bar: one track, the left club's share of the value the two clubs receive ----------
     Review 2026-10-20: the ends printed each club's share ("You get 33%") beside a verdict that is the gap as a share of
     the larger side ("Favors Boston by 51%"), two percentages that read as a contradiction, and the detail rounded each
     share on its own (38% and 63%). The ends now print the value each club receives, as the live legend prints what each
     club sends (part_live.js CG.tradeBalanceCard, tb-legend); the share lives only in the bar's width and its label,
     rounded once. Before both sides have players the track is neutral and the ends are blank, not a balanced 50/50 */
  function split(ev, me) {
    var L = left(ev, me), s = ev.share[L] == null ? 0.5 : ev.share[L];
    return { L: L, R: other(ev, L), s: s, pl: Math.round(s * 100), empty: ev.reading.state === "empty" };
  }
  function barLabel(ev, me, k) {
    return k.empty ? "No players yet" : getsWord(k.L, me) + " " + ev.receives[k.L] + " in value, " + k.pl + "% of the whole; " + getsLow(k.R, me) + " " + ev.receives[k.R] + ", " + (100 - k.pl) + "%";
  }
  function fill(k) { return "scaleX(" + (k.empty ? 0 : k.s).toFixed(4) + ")"; }
  function bar(ev, me, sm) {
    var k = split(ev, me);
    return '<div class="tr-bar' + (sm ? " sm" : "") + (k.empty ? " is-empty" : "") + '" role="img" aria-label="' + esc(barLabel(ev, me, k)) + '">' +
      '<i class="tr-bar-a" style="transform:' + fill(k) + '"></i><span class="tr-bar-mid" aria-hidden="true"></span></div>';
  }
  function endVal(ev, k, code) { return k.empty ? "\u2013" : String(ev.receives[code]); }
  function ends(ev, me) {
    var k = split(ev, me);
    return '<div class="tr-ends"><span>' + M().crest(k.L) + '<span class="tr-end-t">' + esc(getsWord(k.L, me)) + ' <b class="num tr-l-v">' + endVal(ev, k, k.L) + "</b></span></span>" +
      '<span class="r"><span class="tr-end-t"><b class="num tr-r-v">' + endVal(ev, k, k.R) + "</b> " + esc(getsLow(k.R, me)) + "</span>" + M().crest(k.R) + "</span></div>";
  }
  /* the lead and its sentence as one line (the compact reading has room for one) */
  function sentence(ev) { return ev.reading.state === "empty" ? "Pick players on both sides to read the trade." : ev.headline.lead + ". " + ev.headline.rest; }

  /* ---------- compact: the verdict, the values, the bar in one band (the builder sheet's live reading until 2026-11-03) ---------- */
  T.compact = function (ev, o) {
    o = o || {};
    return '<div class="tr-mini" data-tone="' + T.tone(ev, o.me) + '">' +
      '<p class="tr-mini-h"><span class="tr-tone" aria-hidden="true"></span><b class="tr-mini-v">' + esc(T.verdict(ev, o.me)) + '</b><span class="tr-mini-k">The reading, a guide (Rule 2.3)</span></p>' +
      ends(ev, o.me) + bar(ev, o.me, true) +
      '<p class="tr-mini-s">' + esc(sentence(ev)) + "</p></div>";
  };
  /* in place: the bar keeps its element, so its transform transitions to the new split (interruptible as players are
     ticked on and off); everything else is text */
  T.patch = function (host, ev, o) {
    o = o || {};
    var mini = host && S2.$(".tr-mini", host);
    if (!mini) { if (host) host.innerHTML = T.compact(ev, o); return; }
    var k = split(ev, o.me), b = S2.$(".tr-bar", mini);
    mini.dataset.tone = ev.reading.tone;
    S2.$(".tr-mini-v", mini).textContent = T.verdict(ev, o.me);
    S2.$(".tr-l-v", mini).textContent = endVal(ev, k, k.L); S2.$(".tr-r-v", mini).textContent = endVal(ev, k, k.R);
    S2.$(".tr-bar-a", mini).style.transform = fill(k);
    b.classList.toggle("is-empty", k.empty); b.setAttribute("aria-label", barLabel(ev, o.me, k));
    S2.$(".tr-mini-s", mini).textContent = sentence(ev);
  };

  /* ---------- one player: a quiet row with the numbers that matter and thin bars against their position ---------- */
  /* the one rating (the headline row): what the value counts, said the same way in every view. Review 2026-10-20: three
     ratings were in play ("Not rated yet" here, the top row in the builder's options, 70 in the value) */
  function ratingText(x) {
    var h = x.headline, r = x.rating;
    var also = x.others.length ? "; also rated " + x.others.map(function (o) { return o.ovr + " at " + o.posName + " in " + S2.plural(o.gp, "game"); }).join(" and ") : "";
    if (h.start) return "Rated " + h.ovr + " at " + (h.posName || "their signed-up position") + ", the starting rating before any games there" + also;
    if (!r || r.pos === h.pos) return "Rated " + h.ovr + " at " + h.posName + (h.provisional ? " (provisional, under six games)" : "");
    /* the headline is the rating at their signed-up position (v3.74), which the value counts */
    return "Rated " + r.ovr + " at " + r.posName + (r.provisional ? " (provisional)" : "") + "; headline " + h.ovr + " at " + h.posName + ", which the value counts";
  }
  /* each part kept whole, so a record such as 4-8-0 never breaks at its hyphens on a phone */
  function lineHtml(l) {
    var D = M().display;
    var parts = l.role === "G"
      ? [l.gp + " GP", D("sv_pct", l.svp) + " SV%", D("gaa", l.gaa) + " GAA", l.w + " W", l.so + " SO", l.record ? l.record + " W-L-OTL" : null]
      : [l.gp + " GP", l.g + " G", l.a + " A", l.p + " P", D("pts_pg", l.ppg) + " P/GP", D("pm", l.pm) + " +/-", l.sog + " SOG", D("shot_pct", l.shotPct) + " SH", l.toi ? M().toi(l.toi) + " TOI/GP" : null];
    return parts.filter(Boolean).map(function (t) { return '<span class="nw">' + esc(t) + "</span>"; }).join(" · ");
  }
  /* rank bars place a line in the position group it was PLAYED at, which the caption names (it can differ from the
     registered position above it). The first look (2026-10-20) read a 6th percentile here as sixth of 18, and the
     commissioner ruled: "Instead of showing stats in percentile, can you just list it like 1st in this category or tied
     for 24th or something? Then the numbers may not confuse people as much." So each measure says its rank in words
     (M.rank: "1st of 18", "Tied for 24th of 36") and the bar is that rank's score: full for first, empty for last, the
     tick at the middle of the pack. Tone: top quarter good, bottom quarter weak */
  function rankRows(R) {
    var rk = R.ranks; if (!rk.length) return "";
    if (rk.some(function (p) { return p.few; })) return '<p class="tr-few">Too few ' + (R.role === "G" ? "games in goal" : "skating games") + " to rank: ranks need six games at a position.</p>";
    var cap = "Rank among " + rk[0].n + " " + rk[0].groupMany + " with six or more games";   /* "35 defense players", not "35 defense" */
    return '<p class="tr-pc-cap">' + esc(cap) + '</p><div class="tr-pcts" role="list" aria-label="' + esc(cap) + '">' + rk.map(function (p) {
      return '<div class="tr-pc" role="listitem" title="' + esc(p.label + ": " + p.display + ", median " + p.median) + '"><span class="tr-pc-l">' + esc(p.short) + "</span>" +
        '<span class="tr-pc-t" aria-hidden="true"><i class="c-pct" style="--p:' + p.score.toFixed(1) + '%"></i><span class="tr-pc-m"></span></span>' +
        '<span class="tr-pc-v num ' + p.tone + '"><span class="sr">' + esc(p.label + " " + p.display + ", ") + "</span>" + esc(p.text) + "</span></div>";
    }).join("") + "</div>";
  }
  function formText(R) {
    var f = R.form; if (!f) return "";
    var D = M().display, txt = f.role === "G" ? "Last " + f.n + ": " + D("sv_pct", f.svp) + " SV%, " + f.record
      : "Last " + f.n + ": " + f.values.join(", ") + (f.n === 1 && f.values[0] === 1 ? " point" : " points");
    return '<p class="tr-form">' + S2.charts.spark(f.values, { w: 64, h: 20 }) + "<span>" + esc(txt) + "</span></p>";
  }
  /* one role in full; a two-role player gets both, each named, since the value counts both (data/README.md: "Every line
     counts: show both") */
  function roleHtml(R, two) {
    return '<p class="tr-p-l num">' + (two ? '<span class="tr-p-role">' + (R.role === "G" ? "In goal" : "Skating") + "</span> " : "") + lineHtml(R.line) + "</p>" + rankRows(R) + formText(R);
  }
  function playerRow(x, recv, me) {
    if (x.missing) return '<li class="tr-p"><div class="tr-p-a"><span class="tr-p-n is-gone">' + esc(x.tag) + '</span><span class="tr-p-m">Not on a roster</span></div>' +
      '<div class="tr-p-v"><b class="num">0</b><span>value</span></div><p class="tr-p-r">No longer on a roster, so they count 0 and the offer cannot go through.</p></li>';
    var notes = [];
    if (x.joins && x.joins.club) notes.push("Would join " + (x.joins.club === me ? "your" : city(x.joins.club) + "'s") + (x.joins.squad === "tc" ? " training camp" : " active roster"));
    var v = x.value, two = !!(x.line && x.other);
    var tip = "Rating " + v.ovr + ", production " + v.prod + ", salary " + v.cap + (v.ovr + v.prod + v.cap < 0 ? ", floored at 0" : "");
    return '<li class="tr-p">' +
      '<div class="tr-p-a"><a class="tr-p-n" href="' + esc(x.href) + '">' + esc(x.tag) + '</a><span class="tr-p-m">' + esc([x.posName, x.squad === "tc" ? "Camp" : "Active", cash(x.salary)].filter(Boolean).join(" · ")) + "</span></div>" +
      '<div class="tr-p-v" title="' + esc(tip) + '"><b class="num">' + v.value + "</b><span>value</span></div>" +
      body(x, two) + (notes.length ? '<p class="tr-p-x">' + esc(notes.join(" · ")) + "</p>" : "") + "</li>";
  }
  /* the rating, both lines, the ranks and the form: the part of a player the reading and the trade page share */
  function body(x, two) {
    return '<p class="tr-p-r">' + esc(ratingText(x)) + "</p>" +
      (x.line ? roleHtml(x, two) : '<p class="tr-p-l">No games this season yet</p>') + (x.other ? roleHtml(x.other, true) : "");
  }
  /* one player's numbers outside a reading (the trade page's roster rows, js/pages/tradebuild.js) */
  T.playerBody = function (x) { return x && !x.missing ? '<div class="tr-p tr-p-body">' + body(x, !!(x.line && x.other)) + "</div>" : ""; };
  function sideHtml(ev, code, me) {
    var S = gets(ev, code), t = team(code), from = other(ev, code);
    var allG = S.n && S.goalies === S.n - S.missing && S.goalies > 0;
    return '<section class="tr-side">' +
      '<header class="tr-side-h">' + M().crest(code, "lg") + '<div class="tr-side-t"><span class="kicker">' + esc(code === me ? "You receive" : "Receives") + '</span><span class="d-3">' + esc(t.full) + '</span><span class="t-foot">From the ' + esc(team(from).full) + "</span></div>" +
        '<div class="tr-side-v"><b class="d-num">' + ev.receives[code] + "</b><span>value</span></div></header>" +
      (S.players.length ? '<ul class="tr-plist">' + S.players.map(function (x) { return playerRow(x, code, me); }).join("") + "</ul>" : '<p class="tr-few">Nobody picked yet.</p>') +
      (S.n ? '<p class="tr-side-f">' + esc(S2.plural(S.n, "player") + " · average rating " + (S.n - S.missing ? S.avgOvr : "–") + " · " + cash(S.salary) + " in salary · " + (allG ? S2.plural(S.gp, "game") + " played" : S2.plural(S.p, "point"))) + "</p>" : "") +
      "</section>";
  }

  /* ---------- head to head: the best player each club gets, against their own position ---------- */
  /* cross: the two rank in different pools, so the narrow cell keeps the pool size ("T-9th of 18" over "T-13th of 35"):
     "T-9th" over "T-13th" alone read as the better rank (review 2026-10-20) */
  function rankCell(x, lead, cross) {
    var full = x.text + " " + x.groupMany;
    return '<td class="num' + (lead ? " lead" : "") + '" title="' + esc(full) + '"><span class="tr-rk-l" aria-hidden="true">' + esc(x.text) + '</span><span class="tr-rk-s" aria-hidden="true">' + esc(cross ? x.shortText + " of " + x.n : x.shortText) + '</span><span class="sr">' + esc(full) + "</span></td>";
  }
  function compareHtml(ev, me) {
    var c = ev.compare; if (!c) return "";
    var L = left(ev, me), A = L === ev.from ? c.a : c.b, B = L === ev.from ? c.b : c.a;   /* c.a is what `from` gets */
    var head = '<div class="tr-sec-h"><span class="kicker">Head to head</span><h4 class="d-3">' + esc(A.tag + " and " + B.tag) + "</h4>";
    if (!c.ok) return '<section class="tr-cmp">' + head + '<p class="tr-p-l">' + esc(c.why) + "</p></div></section>";
    var av = L === ev.from ? c.av : c.bv, bv = L === ev.from ? c.bv : c.av, ar = L === ev.from ? c.ar : c.br, br = L === ev.from ? c.br : c.ar;
    /* "ranks higher" only within one pool (M.rankBetter), where rank, bar and value agree. Across position groups the
       ranks come from pools of different sizes and do not compare: the first look said a center 9th of 18 "ranks higher"
       than a defender 13th of 35 while the radar drew the defender outside on every spoke (review 2026-10-20), so then
       nothing is bold and the sentence says why */
    var cmp = ar.map(function (x, i) { return M().rankBetter(x, br[i]); }), cross = cmp.some(function (v) { return v === null; });
    var aw = cmp.map(function (v) { return v === 1; }), bw = cmp.map(function (v) { return v === -1; });
    var wins = aw.filter(Boolean).length, losses = bw.filter(Boolean).length;
    var say = cross ? "They rank in different position groups (" + ar[0].n + " " + ar[0].groupMany + ", " + br[0].n + " " + br[0].groupMany + "), so neither is marked higher; the radar shows where each stands in their own group."
      : wins !== losses ? (wins > losses ? A.tag : B.tag) + " ranks higher on " + Math.max(wins, losses) + " of " + c.axes.length + " measures."
      : wins ? "Each ranks higher on " + S2.plural(wins, "measure") + " of " + c.axes.length + "." : "Neither ranks higher on any of the " + c.axes.length + " measures.";
    return '<section class="tr-cmp">' + head + "<p>" + esc(say + " Each measure is their rank at their own position, among players with six or more games there.") + "</p></div>" +
      '<div class="tr-cmp-g"><div class="tr-cmp-r">' + S2.charts.radar({ axes: c.axes, a: av.map(function (v) { return v / 100; }), b: bv.map(function (v) { return v / 100; }), size: 260,
        label: "Rank profiles, a full spoke is first: " + A.tag + " solid, " + B.tag + " dashed" }) +
        '<p class="tr-legend"><span><i class="sw a"></i>' + esc(A.tag) + " (" + esc(L === me ? "you get" : city(L)) + ')</span><span><i class="sw b"></i>' + esc(B.tag) + " (" + esc(city(other(ev, L))) + ")</span></p></div>" +
      /* the columns are named by side, not by gamertag: two long tags in tracked capitals outgrew a 320 phone and widened
         the whole reading (review 2026-10-20); the legend above names the players, and a reader hears them */
      '<table class="tr-tbl tr-cmp-t"><caption class="tr-cap">Rank at their own position, among players with six or more games there: 1st is the best, and T- marks a tie</caption><thead><tr><th scope="col">Measure</th>' +
        '<th scope="col"><i class="sw a" aria-hidden="true"></i>' + esc(L === me ? "You get" : city(L)) + '<span class="sr"> ' + esc(A.tag) + "</span></th>" +
        '<th scope="col"><i class="sw b" aria-hidden="true"></i>' + esc(city(other(ev, L))) + '<span class="sr"> ' + esc(B.tag) + "</span></th></tr></thead><tbody>" +
      /* the rank in full ("Tied for 24th of 36") where the table has room, the short one ("T-24th") in a narrow reading
         (css/trade.css); the full one with the position is its title and what a reader hears */
      c.axes.map(function (k, i) { return "<tr><th scope=\"row\">" + esc(c.labels[i]) + "</th>" + rankCell(ar[i], aw[i], cross) + rankCell(br[i], bw[i], cross) + "</tr>"; }).join("") +
      "</tbody></table></div></section>";
  }

  /* ---------- after the trade: each club's cap room and roster shape, now and after, against the rules ---------- */
  function clubAfter(ev, code, me) {
    var c = ev.clubs[code], b = c.before, a = c.after, lim = c.limits, min = c.min;
    var cell = function (now, then, bad) { return '<td class="num">' + now + '</td><td class="num' + (then !== now ? " ch" : "") + (bad ? " bad" : "") + '">' + then + "</td>"; };
    var row = function (label, now, then, rule, bad) { return '<tr><th scope="row">' + esc(label) + "</th>" + cell(now, then, bad) + '<td class="tr-rule">' + esc(rule) + "</td></tr>"; };
    /* Season 2 (Rule S2.4, audit 2026-11-09, v4.52): a minimum by position and twelve in all, no group maximum, no camp */
    var unit = function (u, label) { var n = a.active[u]; return row(label, b.active[u], n, "Min " + min[u], n < min[u]); };
    var room = function (r) { return r < 0 ? cash(r) + " over" : cash(r); };
    var items = c.flags.map(function (t) { return '<li class="bad">' + esc(t) + "</li>"; }).concat(c.needs.map(function (t) { return "<li>" + esc(t) + "</li>"; }));
    return '<section class="tr-club"><h5 class="tr-club-h">' + M().crest(code) + "<span>" + esc(code === me ? "Your club, the " + c.team.full : c.team.full) + "</span></h5>" +
      '<table class="tr-tbl"><caption class="sr">' + esc(c.team.full + " now and after the trade") + '</caption><thead><tr><th scope="col"><span class="sr">Measure</span></th><th scope="col">Now</th><th scope="col">After</th><th scope="col">Rule</th></tr></thead><tbody>' +
      row("Cap room", room(b.room), room(a.room), c.cap ? cash(c.cap) + " cap" : "No cap", a.room < 0) +
      unit("F", "Forwards") + unit("D", "Defense") + unit("G", "Goaltenders") +
      row("Active roster", b.active.total, a.active.total, "Max " + lim.total, a.active.total > lim.total) +
      "</tbody></table>" + (items.length ? '<ul class="tr-needs">' + items.join("") + "</ul>" : '<p class="tr-needs-none">No limit crossed and no position left short.</p>') + "</section>";
  }
  function afterHtml(ev, me, o) {
    var L = left(ev, me), R = other(ev, L), chk = ev.check, body;
    /* a past trade first: a reversed trade's players are home again, so its check passes and read as if it could go
       through now (review 2026-10-20) */
    if (ev.status === "accepted" || ev.status === "reversed")
      return '<section class="tr-after"><div class="tr-sec-h"><span class="kicker">The rosters</span><h4 class="d-3">Where the players are now</h4></div>' +
        '<p class="tr-chk">' + esc(ev.status === "accepted" ? "This trade is complete, so the rosters already include it. The values above are the players' as they stand today." : "This trade was sent back by the league office, and every player returned to the club that held them (Rule 2.3).") + "</p></section>";
    if (ev.clubs) {
      var n = chk.problems.length;
      body = '<p class="tr-chk ' + (n ? "bad" : "ok") + '">' + S2.ic(n ? "x" : "check") + "<span>" + esc(n ? (n === 1 ? "One problem" : n + " problems") + " if it went through now, called out below." + (o.proposing ? " You can still propose it: the check runs again when they accept, and the trade is refused if it still fails." : "")
        : "Passes the Season 2 roster and cap checks as if it went through now (Rule S2.4).") + "</span></p>" +
        '<div class="tr-after-g">' + clubAfter(ev, L, me) + clubAfter(ev, R, me) + "</div>";
    } else if (chk === null) {
      body = '<p class="tr-chk">Pick players on both sides to see each club after the trade.</p>';
    } else {
      body = '<ul class="tr-needs">' + chk.problems.map(function (x) { return '<li class="bad">' + esc(x.text) + "</li>"; }).join("") + "</ul>";
    }
    return '<section class="tr-after"><div class="tr-sec-h"><span class="kicker">After the trade</span><h4 class="d-3">Cap room and roster shape, now and after</h4><p>Season 2 rules (Rule S2.4): up to ' + M().RULES.s2.limit + ' on the active roster all season, at least ' + M().RULES.s2.min.F + ' forwards, ' + M().RULES.s2.min.D + ' defense and ' + M().RULES.s2.min.G + ' goaltender, and the payroll of the active roster under the ' + esc(cash(M().RULES.s2.cap)) + ' cap. Every player who arrives joins the active roster.</p></div>' + body + "</section>";
  }

  /* ---------- the full detail ---------- */
  T.detail = function (ev, o) {
    o = o || {};
    var me = o.me, L = left(ev, me), R = other(ev, L), r = ev.reading;
    var guide = "A guide to the strength of each side, not a ruling: the league office may still reverse a trade it judges not to be a bona fide hockey transaction (Rule 2.3). The value counts each player's rating, this season's production and their salary.";
    return '<article class="tr" data-tr>' +
      '<header class="tr-hd"><p class="tr-k"><span class="kicker">The trade reading</span></p>' +
        /* the compound keeps one line: a phone broke the headline at its hyphen ("HIGHER-" over "RATED PLAYER") */
        '<h3 class="tr-h">' + esc(ev.headline.lead).replace("higher-rated", '<span class="nw">higher-rated</span>') + '</h3><p class="tr-h-s">' + esc(ev.headline.rest) + "</p>" + T.pill(ev, o) + "</header>" +
      '<div class="tr-sides">' + sideHtml(ev, L, me) + sideHtml(ev, R, me) + "</div>" +
      '<section class="tr-bal" data-tone="' + T.tone(ev, me) + '">' + ends(ev, me) + bar(ev, me, false) +
        '<p class="tr-verdict"><span class="tr-tone" aria-hidden="true"></span><b>' + esc(T.verdict(ev, me)) + "</b></p>" +
        '<p class="tr-guide">' + esc(guide) + "</p></section>" +
      compareHtml(ev, me) + afterHtml(ev, me, o) +
      '<details class="tr-about"><summary>How the reading is worked out</summary><div>' +
        "<p>" + esc("Each player's value starts from their headline rating (a player with no games yet at their signed-up position starts at the league median of 85). Ratings moved to a 75 to 99 scale in v4.48, so the rating is first read back on the old 50 to 99 scale (99 minus 29/14 of the gap to 99) and counts 10 for every point above 60 there, which keeps a typical player near 100. Then comes this season's production once they have games: a skater's points per game times 40, a goaltender's save percentage above .880 times 2,000 plus 3 a win, weighted in over their first five games. It costs 8 for every $1M of salary. A player's value is never below zero, and a side's value is the sum of its players'.") + "</p>" +
        "<p>" + esc("The reading compares what each club receives. Under an 8% gap it is Even; otherwise it favors the club that receives more, by the gap as a share of the larger side. It is the same number the league's Trade Hub shows, and it is a reading, not a rule.") + "</p>" +
        "<p>" + esc("Ranks place a player among everyone at the same position group with six or more games there, so 1st is the best. Players level at the precision shown share a rank (tied for 24th) and the next rank skips. A full bar is first and an empty one last. Ratings, statistics, salaries and rosters are the league's own records for the season on screen; the roster check follows the one the league runs at acceptance.") + "</p></div></details>" +
      "</article>";
  };

  /* ---------- entrance: once, when the detail first appears (reduced motion: none; the kit cross-fades the sheet) ---------- */
  T.hydrate = function (root) {
    if (!root || !S2.$("[data-tr], .tr-mini", root)) return;
    S2.charts.hydrate(root);   /* rank bars clip in, the radar breathes out (both skipped under reduced motion) */
    if (S2.reduce.matches) return;
    S2.$$(".tr-bal .tr-bar-a", root).forEach(function (b) {
      var to = b.style.transform;
      /* QA motion 2026-11-25: 450ms and no delay, inside the kit's under-a-second budget (S2.charts.hydrate) */
      b.animate([{ transform: "scaleX(0.5)" }, { transform: to }], { duration: 450, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    });
  };

  /* =====================================================================================================================
     THE READING: ONE definition for every view (moved from js/demo.js by i3a, 2026-11-25, which deletes the demo; the
     code is the demo kit's own, unchanged but for the names below). Commissioner, 2026-10-20: "For the trade features,
     can the trade page itself be more detailed with stats and comparisons, to show the strength of the trade per side so
     players can have a little more assistance on making fair trades?" The value math is a straight port of the live
     trade intel (v2.72, src/live/part_live.js:14886-15030: CG.tradeStats, CG.tradeValue, CG.tradeSide and the verdict in
     CG.tradeBalanceCard); evaluate() adds what the model can show beside it (ratings by position, ranks at the position,
     recent form, the roster and cap before and after under the Season 2 rules, Rule S2.4). Pure: it reads S2.M and
     changes nothing, so the trade page (js/pages/tradebuild.js), Team HQ Trades (hq.js) and the Staff Desk (desk.js)
     all read one number through the renderer above. The check it carries is a reading of the one the database runs at
     acceptance (accept_trade), never the gate: the database decides.
       S2.trade.evaluate({ from, to, send, get } | Offer) -> Eval      S2.trade.playerEval(pid) -> PlayerEval
       S2.trade.check({ from, to, send, get }) -> { ok, problems, placements, after }
       S2.trade.tradeValue(pid), tradeStats(pid), tradeSide(pids)     the live CG.tradeValue, CG.tradeStats, CG.tradeSide
     Changed in the move: a club lookup is club(code) (null when there is none; team() above always answers an object),
     an offer is passed whole (no lookup by id), and a training camp pool player is refused as "not on the club's roster"
     (the demo market's own pool test is gone with it; a pool player holds no roster spot). ================ */
  function club(code) { return M().team(code); }
  function P(pid) { return M().player(pid); }
  function num(x) { return typeof x === "number" && isFinite(x) ? x : 0; }
  function prob(code, text, hard, c, pid) { return { code: code, text: text, hard: !!hard, club: c || null, pid: pid || null }; }
  function tag(pid) { var p = P(pid); return p ? p.tag : "a player"; }
  function poss(code) { var t = club(code), f = t ? t.full : String(code || "a club"); return "the " + f + (/s$/.test(f) ? "'" : "'s"); }
  /* the placement under the Season 2 rules (Rule S2.4): no club camps and no group limits, every arrival joins the active
     roster, a club carries up to its limit and keeps the minimums (M.RULES.s2.min: 3 F / 2 D / 1 G), and cap room is the
     season's cap less the ACTIVE payroll. moves: [{ pid, from, to }]; room is judged after every player has moved */
  function count(ps) { return ps.reduce(function (a, p) { if (p.unit) a[p.unit]++; a.total++; return a; }, { F: 0, D: 0, G: 0, total: 0 }); }
  function plan(moves) {
    var clubs = {}, problems = [], placements = [], after = {}, s2 = M().RULES.s2, lim = s2.limit, min = s2.min, cap = s2.cap;
    var slot = function (c) { return clubs[c] = clubs[c] || { out: [], inn: [] }; };
    moves.forEach(function (m) { if (m.from) slot(m.from).out.push(m.pid); if (m.to) slot(m.to).inn.push(m.pid); });
    Object.keys(clubs).forEach(function (code) {
      var r = M().roster(code); if (!r) return;
      var c = clubs[code], gone = {};
      c.out.forEach(function (x) { gone[x] = 1; });
      var stay = r.active.filter(function (p) { return !gone[p.id]; }), act = count(stay), was = count(r.active);
      var pay = stay.reduce(function (a, p) { return a + num(p.salary); }, 0);
      c.inn.map(P).filter(Boolean).forEach(function (p) {
        if (p.unit) act[p.unit]++; act.total++; pay += num(p.salary);
        placements.push({ pid: p.id, tag: p.tag, club: code, squad: "pro" });
      });
      after[code] = { active: act, camp: r.camp.length, limit: lim, min: min, payroll: pay, cap: cap, room: cap == null ? null : cap - pay };
      var The = poss(code).replace(/^the/, "The");
      if (c.inn.length && act.total > lim) problems.push(prob("over_limit", The + " active roster would hold " + act.total + " players, over the Season 2 limit of " + lim + " (Rule S2.4).", false, code));
      if (c.inn.length && cap != null && pay > cap) problems.push(prob("over_cap", The + " payroll would be " + M().money(pay) + ", over the " + M().money(cap) + " salary cap (Rule S2.4).", false, code));
      /* the words waive() uses for the same lock */
      if (c.out.length) ["F", "D", "G"].forEach(function (u) {
        if (act[u] < min[u] && act[u] < was[u]) problems.push(prob("minimum", The + " active roster would fall to " + words(act[u]) + " " + unitWord(u, act[u]) +
          ", under the Season 2 minimum of " + min[u] + " (Rule S2.4).", false, code));
      });
    });
    moves.forEach(function (m) { if (!m.to) placements.push({ pid: m.pid, tag: tag(m.pid), club: null, squad: null }); });
    return { problems: problems, placements: placements, after: after };
  }
  function sideProblems(code, pids, seen) {
    var out = [];
    (pids || []).forEach(function (pid) {
      var p = P(pid);
      if (!p) out.push(prob("missing", "A player in this offer is not in the league records.", true, code, pid));
      else if (seen[pid]) out.push(prob("both_sides", p.tag + " is on both sides of the offer.", true, code, pid));
      else if (!p.rostered || p.club !== code) out.push(prob("not_on_club", p.tag + " is no longer on " + poss(code) + " roster, so this offer cannot go through.", true, code, pid));
      else if (p.seat) out.push(prob("manager", p.tag + " holds " + poss(code) + " " + p.seat + " seat. An Owner, GM or AGM can't be traded (Rule 2.6).", true, code, pid));
      seen[pid] = 1;
    });
    return out;
  }
  function check(o) {
    o = o || {};
    var from = String(o.from || "").toUpperCase(), to = String(o.to || "").toUpperCase(), send = o.send || [], get = o.get || [], ps = [];
    if (!club(from) || !club(to)) ps.push(prob("no_partner", "Pick a trade partner.", true));
    else if (from === to) ps.push(prob("same_club", "Pick another club to trade with.", true));
    if (!send.length || !get.length) ps.push(prob("empty", "Add at least one player on each side. Draft picks are not traded in the basic format (Rule 2.3).", true));
    if (ps.length) return { ok: false, problems: ps, placements: [], after: {} };
    var seen = {};
    ps = sideProblems(from, send, seen).concat(sideProblems(to, get, seen));
    if (ps.length) return { ok: false, problems: ps, placements: [], after: {} };
    var pl = plan(send.map(function (x) { return { pid: x, from: from, to: to }; }).concat(get.map(function (x) { return { pid: x, from: to, to: from }; })));
    return { ok: !pl.problems.length, problems: pl.problems, placements: pl.placements, after: pl.after };
  }
  var NUMW = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  function words(n) { return NUMW[n] || String(n); }
  /* CG.tradeStats: each role over its own games (sgp skating, gs in goal); gp counts every game once (v4.08, v4.11).
     Points, plus/minus and penalties come from skating lines only, as CG.addStatLine adds them */
  function tradeStats(pid) {
    var p = P(pid), S = p && p.lines.S, G = p && p.lines.G, games = {};
    if (p) ["S", "G"].forEach(function (rl) { if (p.lines[rl]) M().log(pid, rl).forEach(function (r) { games[r.game] = 1; }); });
    var sgp = S ? num(S.gp) : 0, gs = G ? num(G.gp) : 0, sa = G ? num(G.sa) : 0, sv = G ? num(G.sv) : 0;
    var pts = S ? num(S.p) : 0;
    return { goalie: !!(p && p.pos === "G"), gp: Object.keys(games).length, sgp: sgp, gs: gs, g: S ? num(S.g) : 0, a: S ? num(S.a) : 0, p: pts,
      pm: S ? num(S.pm) : 0, pim: S ? num(S.pim) : 0, ppg: sgp ? pts / sgp : 0, w: G ? num(G.w) : 0, l: G ? num(G.l) : 0, otl: G ? num(G.otl) : 0,
      svp: sa ? sv / sa : null, gaa: gs ? num(G.ga) / gs : null, so: G ? num(G.so) : 0 };
  }
  /* CG.tPlayer (part_live.js:14704) finds a player among ROSTERED players only, so a player waived or gone since an
     offer was made counts as missing in the live reading: value 0, "not on a roster" (CG.tradePlayerRow). Review
     2026-10-20: the port read every player in the records, so a waived player kept his full value in a pending offer */
  function TP(pid) { var p = P(pid); return p && p.rostered ? p : null; }
  /* the ONE rating every trade view shows and the value counts: profiles.overall, which the live engine sets to the
     HEADLINE row of player_position_overalls (part_live.js:1077). refresh_player_overall writes that row at the signed-up
     group even before any games there, at 70 and provisional (overall_breakdown's no-games branch,
     sql/2026-09-29-position-ratings-v374.sql:208-281), so the live picker, the live OVR and the live value all read 70.
     Review 2026-10-20: the views mixed three ratings (M().player's top row, this, and "not rated yet"), so the sentence
     contradicted the numbers beside it for 32 rostered players.
     shortcut: the snapshot's query 07 keeps only rows with games (o.gp > 0), so those zero-game headline rows are rebuilt
     here at 70; re-export 07 without that filter and the real row is read. Two players already have
     games at their roster group, so their signed-up group is not in the snapshot and pos stays null */
  var RATE_GROUP = { C: "Center", W: "Wing", D: "Defense", G: "Goaltender" };
  function headRow(pid) {
    var rows = M().ratings(pid), h = rows.filter(function (r) { return r.headline; })[0], p = P(pid);
    if (h) return { pos: h.pos, posName: h.posName, ovr: h.ovr, gp: h.gp, provisional: h.provisional, start: false };
    var g = p && M().GROUP[p.pos], known = g && !rows.some(function (r) { return r.pos === g; });
    return { pos: known ? g : null, posName: known ? RATE_GROUP[g] : null, ovr: M().OVR_CENTER, gp: 0, provisional: true, start: true };   /* cghl_center() (v4.48) */
  }
  /* CG.tradeValue: 10 per rating point above 60 on the OLD 50 to 99 scale (the headline rating, headRow above, read back
     with M().oldOvr as live v4.48 does: 39 - (99 - overall) * 29 / 14, so a typical player keeps a value near 100),
     plus production weighted in over the first five games (a skater's points per game x 40; a goaltender's save
     percentage above .880 x 2000, plus 3 a win; a two-role player's split by role games), minus 8 per $1M of salary */
  function tradeValue(pid) {
    var p = TP(pid); if (!p) return { value: 0, ovr: 0, prod: 0, cap: 0, missing: true, overall: null, weight: 0, stats: null };
    var st = tradeStats(pid), overall = headRow(pid).ovr, ovr = Math.round(Math.max(0, M().oldOvr(overall) - 60) * 10), prod = 0, weight = 0;
    if (st.gp >= 1) {
      var gProd = st.gs ? Math.max(0, ((st.svp || 0) - 0.880) * 2000) + st.w * 3 : 0;
      var sProd = st.sgp ? st.ppg * 40 : 0;
      prod = (sProd * st.sgp + gProd * st.gs) / Math.max(1, st.sgp + st.gs);
      weight = Math.min(1, st.gp / 5);
      prod = Math.round(prod * weight);
    }
    var cap = -Math.round((num(p.salary) / 1e6) * 8);
    return { value: Math.max(0, Math.round(ovr + prod + cap)), ovr: ovr, prod: Math.round(prod), cap: cap, missing: false, overall: overall, weight: weight, stats: st };
  }
  /* CG.tradeSide: one side's totals (what one club sends) */
  function tradeSide(pids) {
    var out = { n: 0, ovrSum: 0, salary: 0, value: 0, gp: 0, g: 0, a: 0, p: 0, goalies: 0, camp: 0, missing: 0 };
    (pids || []).forEach(function (pid) {
      var pl = TP(pid), v = tradeValue(pid);
      out.n++; out.value += v.value;
      if (!pl) { out.missing++; return; }
      out.ovrSum += v.overall; out.salary += num(pl.salary); if (pl.squad === "tc") out.camp++;
      out.gp += v.stats.gp; if (v.stats.goalie) out.goalies++;
      out.g += v.stats.g; out.a += v.stats.a; out.p += v.stats.p;
    });
    out.avgOvr = (out.n - out.missing) ? Math.round(out.ovrSum / (out.n - out.missing)) : 0;
    return out;
  }
  /* the verdict in CG.tradeBalanceCard: A is what aCode sends, so a lopsided trade favors the club that RECEIVES more */
  function reading(A, B, aCode, bCode) {
    var total = A.value + B.value, diff = total ? Math.abs(A.value - B.value) / Math.max(A.value, B.value, 1) : 0, favors = null, state, tone, text;
    if (!A.n && !B.n) { state = "empty"; tone = "none"; text = "Add players to read it"; }
    else if (!A.n || !B.n) { state = "one"; tone = "warn"; text = "One side is empty"; }
    else if (diff < 0.08) { state = "even"; tone = "even"; text = "Even"; }
    else { state = "favors"; favors = A.value > B.value ? bCode : aCode; tone = diff < 0.25 ? "lean" : "lopsided"; text = "Favors " + city(favors) + " by " + Math.round(diff * 100) + "%"; }
    return { state: state, tone: tone, text: text, favors: favors, pct: Math.round(diff * 100), diff: diff, total: total,
      aPct: total ? Math.round(A.value / total * 100) : 50 };   /* aPct: the live meter, the share of the value aCode sends */
  }

  /* one player as the reading shows them: rating where they would play, the role-aware season line, ranks (6+ games at
     that position, else "too few games"), the last five games, salary and squad */
  /* review 2026-10-20: saves per game measures the shots a goaltender faces, not how well they stop them, so it is not a
     measure a goaltender "ranks higher" on; breakaway save percentage is (all four are in M().rankKeys("G")) */
  var KEYS = { S: ["pts_pg", "g_pg", "a_pg", "shot_pct", "pm_pg"], G: ["sv_pct", "gaa", "so_pg", "brk_sv_pct"] };
  /* one role's season line as the reading shows it: the line, ranks (M().rank: six games at the group played) and the last
     five games. Both roles of a two-role player get one (data/README.md: "Every line counts: show both"), since the
     value counts both (review 2026-10-20: the second role had shrunk to "also 6 GP in goal") */
  function roleEval(pid, L, role) {
    var line = role === "G" ? { role: "G", gp: num(L.gp), svp: L.sv_pct, gaa: L.gaa, w: num(L.w), l: num(L.l), otl: num(L.otl), so: num(L.so), record: L.record }
      : { role: "S", gp: num(L.gp), g: num(L.g), a: num(L.a), p: num(L.p), ppg: L.pts_pg, pm: num(L.pm), sog: num(L.sog), shotPct: L.shot_pct, toi: num(L.toi_pg) > 0 ? L.toi_pg : null };
    /* commissioner, 2026-10-20: ranks, not percentiles ("1st in this category or tied for 24th"); score (best 100, last 0)
       draws the bars and the radar, and is null under six games at the position */
    var ranks = KEYS[role].map(function (k) {
      var x = M().rank(L, k); if (!x) return null;
      return { key: k, label: x.label, short: x.short, display: x.display, rank: x.rank, tied: x.tied, score: x.score, text: x.text, shortText: x.shortText, tone: x.tone,
        few: x.few, n: x.n, group: x.group, groupName: x.groupName, groupMany: x.groupMany, median: x.medianDisplay };   /* group: M().rankBetter */
    }).filter(Boolean);
    var last = M().log(pid, role).slice(-5), form = null;
    if (last.length) {
      if (role === "G") { var sv5 = last.reduce(function (a, r) { return a + num(r.sv); }, 0), sa5 = last.reduce(function (a, r) { return a + num(r.sa); }, 0);
        form = { role: "G", n: last.length, values: last.map(function (r) { return r.sa ? r.sv / r.sa : null; }), svp: sa5 ? sv5 / sa5 : null,
          record: last.filter(function (r) { return r.result === "W"; }).length + "-" + last.filter(function (r) { return r.result === "L"; }).length + "-" + last.filter(function (r) { return r.result === "OTL"; }).length }; }
      else form = { role: "S", n: last.length, values: last.map(function (r) { return num(r.p); }), p: last.reduce(function (a, r) { return a + num(r.p); }, 0) };
    }
    return { role: role, line: line, ranks: ranks, form: form };
  }
  function playerEval(pid, joins) {
    var p = TP(pid), v = tradeValue(pid);
    if (!p) { var gone = P(pid); return { pid: pid, missing: true, tag: gone ? gone.tag : "A player", href: gone ? gone.href : null, value: v, salary: 0 }; }
    /* the role they would play is their registered one, as the live reading leads with it (CG.tradeStats); a player with
       no line in that role shows the one they have first */
    var st = v.stats, role = p.pos === "G" ? "G" : "S";
    if (!p.lines[role] && p.lines[role === "G" ? "S" : "G"]) role = role === "G" ? "S" : "G";
    var oRole = role === "G" ? "S" : "G", L = p.lines[role] || null, O = p.lines[oRole] || null;
    var main = L ? roleEval(pid, L, role) : null;
    /* the position they would play is their registered one (the live builder places by position group, Rule 2.1) */
    var grp = M().GROUP[p.pos], rows = M().ratings(pid), at = rows.filter(function (r) { return r.pos === grp; })[0] || null, head = headRow(pid);
    return { pid: pid, missing: false, tag: p.tag, href: p.href, club: p.rostered ? p.club : null, pos: p.pos, posName: p.posName, unit: p.unit, squad: p.squad,
      salary: num(p.salary), seat: p.seat || null, role: role,
      line: main ? main.line : null, ranks: main ? main.ranks : [], form: main ? main.form : null,
      other: O ? roleEval(pid, O, oRole) : null,   /* the second role, in full */
      rating: at ? { pos: at.pos, posName: at.posName, ovr: at.ovr, gp: at.gp, provisional: at.provisional } : null,
      headline: head,   /* the one rating (headRow): what the value counts and every view prints */
      others: rows.filter(function (r) { return head.start || r.pos !== head.pos; }).map(function (r) { return { pos: r.pos, posName: r.posName, ovr: r.ovr, gp: r.gp }; }),
      value: v,
      joins: joins || null };   /* { club, squad } where the plan places them, when it can be placed */
  }
  function units(list) { return list.reduce(function (a, p) { if (p && p.unit) a[p.unit]++; a.total++; return a; }, { F: 0, D: 0, G: 0, total: 0 }); }
  var UNIT_WORD = { F: ["forward", "forwards"], D: ["defenseman", "defensemen"], G: ["goaltender", "goaltenders"] };
  function unitWord(u, n) { return UNIT_WORD[u][n === 1 ? 0 : 1]; }
  /* a club before and after under the Season 2 rules (Rule S2.4, audit 2026-11-09): the active roster by unit against
     the Season 2 minimums and the limit of twelve, the active payroll and the room under the season's cap. After is
     the plan's (check.after), so the reading and the check can never disagree */
  function clubState(code, out, inn, c) {
    var r = M().roster(code); if (!r) return null;
    var a = c.after[code], s2 = M().RULES.s2, cap = s2.cap, pay = r.payroll.active;
    var before = { active: units(r.active), payroll: pay, room: cap == null ? null : cap - pay };
    var after = { active: a.active, payroll: a.payroll, room: a.room };
    var lim = { total: s2.limit }, min = s2.min, cty = city(code), flags = [], needs = [];
    ["F", "D", "G"].forEach(function (u) {
      var b = before.active[u], n = after.active[u];
      if (n < b) {
        if (n < min[u]) return;   /* the check's own "minimum" problem says it, below */
        if (u === "G" && n === 1) needs.push("Leaves " + cty + " one goaltender on the active roster.");
        else if (n === min[u]) needs.push("Leaves " + cty + " at the Season 2 minimum of " + min[u] + " " + unitWord(u, min[u]) + ".");
        else needs.push(cty + " goes from " + b + " to " + n + " " + unitWord(u, n) + " on the active roster.");
      } else if (n > b) needs.push(cty + " adds depth: " + n + " " + unitWord(u, n) + " on the active roster, up from " + b + ".");
    });
    /* the limit, the cap and the minimums are the check's own words (plan above), so nothing is said twice */
    c.problems.forEach(function (x) { if (x.club === code) flags.push(x.text); });
    return { code: code, team: club(code), before: before, after: after, limits: lim, cap: cap, min: min, flags: flags, needs: needs };
  }
  function an(word) { return /^[aeiou]/i.test(String(word)) ? "an " : "a "; }
  /* what the reading leads with: a short lead (who gets the higher-rated player, or that both get the same rating) and
     one plain sentence under it (that player, then what the other club gets: cap room, depth or the players by name).
     The rating is the one the value counts (headRow), and any word about value is read from ev.receives, the same
     numbers as the verdict. Review 2026-10-20: the tie branches named the club that got the single best-valued player as
     getting "the most value" while the verdict favored the other club, and the whole sentence was set as the headline */
  function headlineOf(ev) {
    var live = ev.sides[0].players.concat(ev.sides[1].players).filter(function (x) { return !x.missing; });
    if (!ev.sides[0].n || !ev.sides[1].n) return { lead: "Pick players on both sides", rest: "The reading follows every player you add." };
    var gone = ev.sides[0].missing + ev.sides[1].missing;
    if (ev.sides.some(function (s) { return s.n === s.missing; }))
      return { lead: gone === 1 ? "A player here is no longer on a roster" : "Players here are no longer on a roster", rest: "A player who is off every roster counts 0 in the reading, and the offer cannot go through." };
    var rate = function (x) { return x.value.overall; };
    var best = live.slice().sort(function (a, b) { return rate(b) - rate(a) || b.value.value - a.value.value; })[0];
    var getsBest = ev.sides[0].players.indexOf(best) >= 0 ? ev.sides[1].club : ev.sides[0].club;   /* side 0 is what `from` sends */
    var other = getsBest === ev.from ? ev.to : ev.from, oSide = other === ev.from ? ev.sides[1] : ev.sides[0], gSide = other === ev.from ? ev.sides[0] : ev.sides[1];
    var top = [ev.sides[0], ev.sides[1]].map(function (s) { return s.players.filter(function (x) { return !x.missing; }).reduce(function (a, x) { return Math.max(a, rate(x)); }, 0); });
    var R = ev.receives, hi = ev.reading.favors, lo = hi ? (hi === ev.from ? ev.to : ev.from) : null;
    var done = ev.status === "accepted" || ev.status === "reversed", got = done ? "got " : "gets ";   /* a completed trade is told in the past tense */
    var who = best.tag + ", " + (best.posName ? an(best.posName) + best.posName.toLowerCase() : "a player") + " rated " + rate(best) + (best.headline.provisional ? " (provisional)" : "") + ".";
    var room = ev.clubs && ev.clubs[other] ? ev.clubs[other].after.room - ev.clubs[other].before.room : gSide.salary - oSide.salary;
    /* what the other club gets, as a phrase, so a tie can fold it into the value sentence when it is the same club */
    var what = room > 0 ? (done ? "cleared " : "clears ") + cash(room) + " of cap room"
      : got + (oSide.n > gSide.n ? "depth, " + words(oSide.n) + " players for " + words(gSide.n) : list(oSide.players.map(function (x) { return x.tag; })));
    var then = city(other) + " " + what + ".";
    if (top[0] !== top[1]) return { lead: city(getsBest) + " " + got + "the higher-rated player", rest: who + " " + then };
    var value = ev.reading.state === "even" ? "The value is about even, " + Math.max(R[ev.from], R[ev.to]) + " to " + Math.min(R[ev.from], R[ev.to]) + ". " + then
      : city(hi) + " " + got + "more value, " + R[hi] + " to " + R[lo] + (hi === other ? ", and " + what.replace(/^(gets|got) /, "") + "." : ". " + then);
    return { lead: "Both clubs " + (done ? "got" : "get") + " a player rated " + top[0], rest: value };
  }
  /* the paired comparison: one player each club gets, in the same role and both ranked (six games at their position),
     the pair with the most value; else the best by value on each side and the reason there is no profile */
  function compareOf(ev) {
    var ready = function (x) { return x.ranks.filter(function (y) { return y.score != null; }).length >= 3; };
    var pool = function (s) { return s.players.filter(function (x) { return !x.missing; }).sort(function (p, q) { return q.value.value - p.value.value; }); };
    var A = pool(ev.sides[1]), B = pool(ev.sides[0]), a = A[0] || null, b = B[0] || null, best = -1;   /* a: what `from` gets; b: what `to` gets */
    if (!a || !b) return null;
    A.filter(ready).forEach(function (x) { B.filter(ready).forEach(function (y) { if (x.role === y.role && x.value.value + y.value.value > best) { best = x.value.value + y.value.value; a = x; b = y; } }); });
    if (best < 0) return { ok: false, a: a, b: b, why: a.role !== b.role ? "A skater for a goaltender: their numbers are not on one scale, so each is read against their own position above."
      : "Too few games to compare their profiles: ranks need six games at a position." };
    var keys = KEYS[a.role].filter(function (k) { return a.ranks.some(function (x) { return x.key === k && x.score != null; }) && b.ranks.some(function (x) { return x.key === k && x.score != null; }); });
    var at = function (x, k) { return x.ranks.filter(function (y) { return y.key === k; })[0]; };
    return { ok: true, a: a, b: b, role: a.role, axes: keys.map(function (k) { return at(a, k).short; }), labels: keys.map(function (k) { return at(a, k).label; }),
      av: keys.map(function (k) { return at(a, k).score; }), bv: keys.map(function (k) { return at(b, k).score; }),   /* rank scores, 0 to 100 */
      ar: keys.map(function (k) { return at(a, k); }), br: keys.map(function (k) { return at(b, k); }) };              /* the ranks themselves, for their text */
  }
  /* S2.trade.evaluate({ from, to, send, get }) or an offer -> the reading (the views above draw it) */
  function evaluate(o) {
    o = o || {};
    var from = String(o.from || "").toUpperCase(), to = String(o.to || "").toUpperCase(), send = (o.send || []).slice(), get = (o.get || []).slice();
    var A = tradeSide(send), B = tradeSide(get), rd = reading(A, B, from, to);
    var c = club(from) && club(to) && from !== to && send.length && get.length ? check({ from: from, to: to, send: send, get: get }) : null;
    var placed = c && c.placements.length, land = {};
    if (placed) c.placements.forEach(function (pl) { land[pl.pid] = { club: pl.club, squad: pl.squad }; });
    var side = function (code, S, pids) { var s = Object.assign({ club: code, team: club(code) }, S); s.players = pids.map(function (x) { return playerEval(x, land[x]); }); return s; };
    var ev = { from: from, to: to, send: send, get: get, status: o.status || null,
      sides: [side(from, A, send), side(to, B, get)],   /* sides[0] is what `from` sends, sides[1] what `to` sends */
      reading: rd, total: rd.total,
      receives: {}, share: {},                            /* by club: the value it receives and its share of the whole */
      check: c, clubs: null };
    ev.receives[from] = B.value; ev.receives[to] = A.value;
    ev.share[from] = rd.total ? B.value / rd.total : 0.5; ev.share[to] = rd.total ? A.value / rd.total : 0.5;
    if (placed) { ev.clubs = {}; ev.clubs[from] = clubState(from, send, get, c); ev.clubs[to] = clubState(to, get, send, c); }
    ev.headline = headlineOf(ev);
    ev.compare = compareOf(ev);
    return ev;
  }
  /* self-check at load (fail loud): the reading must agree with the live verdict on a hand-built case */
  (function () {
    var r = reading({ n: 1, value: 100 }, { n: 1, value: 120 }, "AAA", "BBB"), e = reading({ n: 1, value: 100 }, { n: 1, value: 107 }, "AAA", "BBB");
    if (r.state !== "favors" || r.favors !== "AAA" || r.pct !== 17 || e.state !== "even") console.error("S2.trade: the trade reading no longer matches the live verdict (part_live.js CG.tradeBalanceCard)", r, e);
  })();
  T.evaluate = evaluate; T.playerEval = playerEval; T.check = check; T.tradeValue = tradeValue; T.tradeStats = tradeStats; T.tradeSide = tradeSide;

  /* =====================================================================================================================
     THE LEAGUE'S TRADE DOORS (v5.00 swap, stream e4, 2026-11-24): every trade action's real door, ONE definition for the
     trade page (js/pages/tradebuild.js), Team HQ Trades (hq.js) and the Staff Desk (desk.js). The current site's doors
     are the reference (src/live/part_live.js CG.proposeTrade, CG.acceptTrade, CG.declineTrade, CG.cancelTrade,
     CG.setOnBlock; part9_staffdesks.js reverse_trade and resend_trade). Every call goes through S2.write
     (contracts/client-api.md): it resolves only after the database confirms the write, and rejects with the database's
     own code and words (a deadline: "Roster moves are locked"; a minimum: accept_trade's "Season 2 roster minimums: ...",
     hint below_minimum, Rule S2.4), which the page shows as it is.
     Owner approval (Rule 2.6, v2.38): a club door is sent with approval "owner"; the database's mgmt_gate decides who
     waits for the Owner (a GM or AGM whose Trades page the Owner approves) and S2.write then files the move with
     mgmt_request_move, resolving { queued: true }. The executor (_mgmt_execute) runs the same insert or update when the
     Owner approves, and a queued counter carries countered_id, so the offer it answers closes then.
     Trade privacy (v3.35, Rule 2.3): an offer, a counter, a decline and a withdrawal reach the two front offices and the
     league office only. These doors post nothing anywhere; the database's own triggers tell the seats, and only an
     accepted or reversed trade reaches the public wire. An offer is read only through RLS ("trades visible to involved"
     and the staff read), so a member outside the two clubs reads nothing, whatever the address asks for.
       S2.trade.read(id) -> Promise<Offer | null>       one offer, as the reader may see it (null: not theirs, or none)
       S2.trade.offerOf(row) -> Offer                   a trades row in the pages' shape (Offer: from, to, send,
                                                        get, note, status pending|accepted|declined|withdrawn|reversed, at)
       S2.trade.door.propose({ from, to, send, get, note, counter }) -> Promise<{ data, id, queued, counterOpen }>
       S2.trade.door.accept(id) / decline(id) / cancel(id) -> Promise<{ data, queued }>
       S2.trade.door.reverse(id, reason) / resend(id) -> Promise<{ data }>      league office (the database's gate)
       S2.trade.door.block(pid, on) -> Promise<{ data, queued }>                 the trade block (roster_spots.on_block)
     ===================================================================================================================== */
  T.COLS = "id,season_id,from_team_id,to_team_id,from_profile_id,offered_profile_ids,requested_profile_ids,note,status,created_at,updated_at";
  /* trade_status (proposed, accepted, declined, cancelled, reversed) in the pages' words; a withdrawal is "cancelled" */
  T.STATUS = { proposed: "pending", accepted: "accepted", declined: "declined", cancelled: "withdrawn", reversed: "reversed" };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  T.isId = function (id) { return UUID.test(String(id || "")); };
  function codeOfId(id) { var t = M().teams.filter(function (x) { return x.id === id; })[0]; return t ? t.code : null; }
  /* a club's teams.id, which every door names. A missing id is an error, never a guess */
  function teamId(code) {
    var t = M().team(code);
    if (!t || !t.id) throw Object.assign(new Error("The league data carries no id for " + (t ? "the " + t.full : code) + ", so the trade can't be sent from here. Reload the page and try again."), { code: "S2_NO_TEAM_ID" });
    return t.id;
  }
  /* the season on screen's id (its seasons row in M.control): an offer is always for one season */
  /* the season a trade or a block change is for: the current one, never an archive on screen (QA nits 2026-11-25: on
     ?season=1 Team HQ showed Season 1's club and the block door wrote a Season 1 roster row, which RLS does not stop) */
  function seasonId() {
    var cur = S2.currentSeason && S2.currentSeason(), v = M().view;
    if (!cur || !cur.id) throw Object.assign(new Error("The league data carries no current season, so this can't be sent from here. Reload the page and try again."), { code: "S2_NO_SEASON_ID" });
    if (v && v.season !== cur.number) throw Object.assign(new Error("This page shows " + v.name + ". Trades and the trading block are for " + (cur.name || "Season " + cur.number) + ": open it without ?season in the address, then try again."), { code: "S2_ARCHIVE" });
    return cur.id;
  }
  function stamp() { return new Date().toISOString(); }
  T.offerOf = function (r) {
    var from = codeOfId(r.from_team_id), to = codeOfId(r.to_team_id);
    if (!from || !to) throw new Error("The offer names a club the league data does not carry. Reload the page and try again.");
    return { id: r.id, from: from, to: to, send: (r.offered_profile_ids || []).slice(), get: (r.requested_profile_ids || []).slice(), note: r.note || "",
      status: T.STATUS[r.status] || r.status, at: r.created_at, updatedAt: r.updated_at, by: r.from_profile_id, season: r.season_id, live: true };
  };
  /* one read through f's client (js/live.js S2.ensureSb), the same shape as gamedesk.js rd(): no client is an error, so a
     null here always means the league answered with no row the reader may see.
     shortcut: a third copy of that six-line reader (hq.js and gamedesk.js keep theirs), until js/live.js exports one read door */
  T.read = function (id) {
    if (!T.isId(id)) return Promise.resolve(null);   /* a forged id is no offer; PostgREST would refuse the cast */
    return Promise.resolve().then(function () {
      var c = S2.ensureSb ? S2.ensureSb() : null;
      if (!c) throw new Error("Not connected to the league, so the offer can't be read here. Reload the page and try again.");
      return c.from("trades").select(T.COLS).eq("id", id);
    }).then(function (r) {
      if (r && r.error) throw new Error(r.error.message || "The league did not answer.");
      var row = r && r.data && (Array.isArray(r.data) ? r.data[0] : r.data);
      return row ? T.offerOf(row) : null;
    });
  };
  var MOVED = ["rosters", "tenures", "wire"];   /* what a completed or reversed trade changes in the league read */
  T.door = {
    /* trades.insert, as CG.proposeTrade. A counter declines the offer it answers once the new one is in (the same deal is
       never live twice); when that second write fails the counter still stands, and counterOpen carries why */
    propose: function (o) {
      return Promise.resolve().then(function () {
        var sid = seasonId(), to = teamId(o.to), note = String(o.note || "").trim() || null;
        var row = { season_id: sid, from_team_id: teamId(o.from), to_team_id: to, from_profile_id: S2.session.profileId,
          offered_profile_ids: o.send.slice(), requested_profile_ids: o.get.slice(), note: note };
        return S2.write("trades.insert", { row: row }, { approval: "owner", action: "trade_propose",
          queueArgs: { to_team_id: to, season_id: sid, offered_profile_ids: row.offered_profile_ids, requested_profile_ids: row.requested_profile_ids,
            offered_pick_ids: [], requested_pick_ids: [], note: note, countered_id: o.counter || null },
          summary: "propose a trade to the " + team(o.to).name + " (" + o.send.length + " for " + o.get.length + ")" });
      }).then(function (res) {
        if (res.queued) return res;
        res.id = res.data && res.data[0] ? res.data[0].id : null;
        if (!o.counter) return res;
        return T.door.decline(o.counter).then(function () { return res; }, function (e) { res.counterOpen = e; return res; });
      });
    },
    /* accept_trade: the database moves every player, places them, checks the cap and the Season 2 minimums, and posts the
       completed trade to the public wire, all or nothing */
    accept: function (id) {
      return S2.write("accept_trade", { p_trade: id }, { approval: "owner", sections: MOVED, summary: "accept a trade offer" });
    },
    /* a decline or a withdrawal moves nobody, so the movement deadline never refuses it (v3.98). The status filter makes
       an offer answered in the meantime come back as no row (S2_NO_ROWS), never a second "declined" */
    decline: function (id) { return answer(id, "declined", "trade_decline", "decline a trade offer"); },
    cancel: function (id) { return answer(id, "cancelled", "trade_cancel", "withdraw a trade offer"); },
    /* the league office's doors: the database lets a commissioner and the transactions staff through (Season 2: every
       staffer, once the held staff powers record applies), and refuses everyone else in its own words */
    reverse: function (id, reason) { return S2.write("reverse_trade", { p_trade: id, p_reason: String(reason || "").trim() }, { sections: MOVED }); },
    resend: function (id) { return S2.write("resend_trade", { p_trade: id }, {}); },
    /* the trade block, as CG.setOnBlock: a listing is the one public part of a trade before it is made (Rule 2.3) */
    block: function (pid, on) {
      return Promise.resolve().then(function () {
        var p = M().player(pid);
        return S2.write("roster_spots.update", { set: { on_block: !!on }, match: { season_id: seasonId(), profile_id: pid } },
          { approval: "owner", action: "roster_block", queueArgs: { p_profile: pid, on_block: !!on }, sections: ["rosters"],
            summary: (on ? "put " : "take ") + (p ? p.tag : "a player") + (on ? " on" : " off") + " the trade block" });
      });
    }
  };
  function answer(id, status, action, summary) {
    return S2.write("trades.update", { set: { status: status, updated_at: stamp() }, match: { id: id, status: "proposed" } },
      { approval: "owner", action: action, queueArgs: { p_trade: id }, summary: summary });
  }
  /* the database's words for a refusal, or what S2.write's own codes mean here */
  T.why = function (e) {
    if (e && e.code === "S2_NO_ROWS") return "That offer is no longer open: it was answered, withdrawn or changed in the meantime. Nothing was saved.";
    return (e && e.message) || "The league did not answer. Nothing was saved.";
  };

})();
