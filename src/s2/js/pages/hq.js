/* #/hq (Team HQ). Stream e1 owns js/pages/hq.js and css/hq.css. Since e0's split (2026-11-24) the You page lives in
   js/pages/you.js (e3), the Lineups tab and the lineup sheet in js/pages/lineups.js (e2) and the inbox in js/inbox.js (f);
   this file reaches them through the forwarders at its foot and shares its own pieces as S2._hq. css/hq.css still styles
   all four (it is not split; see the e1 report).
   The club is the member's own seat's (or the commissioner's preview club), and the Front office tab, the approvals, the
   trade offers and requests, the trade block and the player sheet's block row are the league's own records and doors
   through S2.write (see THE LIVE FRONT OFFICE below; v5.00 swap, e1, 2026-11-24). A waiver hands off to the market's one
   waive door (S2.market.waiveDoor, stream b4); a claim and the bid board run on b4's S2.market actions, whose answers
   are Promises. Lineup sheets and availability are e2's (S2.lineups), server picks e2's lobby (S2.lobby.savePick), and
   the series limits the database's (set_game_lineup). Every write shows as done only once the database confirms it.
   v5.00 swap (i3c, 2026-11-25): demo mode is gone. This page runs only that path; the placeholder persona, the sample
   approvals, offers, requests, listings, sheets and series, the demo clocks, the rule overrides and the completed-moves
   list drawn from the demo engine went with it.
   Rules quoted from the rulebook (src/live/part3_content.js, read 2026-10-19): 2.1 squad freeze, 2.4 movement deadline,
   2.6 seats and applications, 5.1 availability, 5.2 weekly limits, 5.3 lineup lock, 8.3 playoff floor, S2.4 rosters.
   League website v2 (commissioner, 2026-10-19: "I love the way all the stats are presented, but I feel like the design
   feels too much like a dashboard and not a League Website"): both workspaces keep the gray app canvas and every working
   interaction, but wear the site's clothes. Titles are condensed uppercase (.d-1) under a kicker; each pane is a run of
   sections (a headline that carries the number, one sentence, then the list or the chart) instead of a wall of cards;
   Team HQ opens on a band in the club's own color with its crest; the next night is an ink match-center panel; chips
   give way to quiet text tags. The guest You page is a public join page on the white site canvas. Season 2 staffing
   ruling (2026-10-19): no departments, so the staff application offers optional committee interests instead.
   The Trades tab came from the commissioner's ask of 2026-10-19 ("allow me to click on the trade button and play around
   with the trade features"): offers, the trade block and the players' trade requests.
   The Season 2 player market (commissioner, 2026-11-02; spec data/market-spec.md, engine S2.market in js/market.js):
   Team HQ has a Bidding tab beside Trades ("I do want it to have its own tab similar to the trades where teams can set
   bid boards throughout the season on the different camp players before the upcoming Saturday bid nights"), the player
   sheet's Waive is the Season 2 waiver (24 hours, claims, the inactive confirmation), and the Overview counts the club's
   no-show forfeits ("I would like the team management to know how many of their own club games have been no-show
   forfeits.").
   The series limit (live v4.47; commissioner, 2026-11-06: "only base scheduling off box scores", "remove them from the
   lineup and send the team management a notification on the site", "only count box scores as games played in the regular
   season as well"): a player's count is games in the box scores, never a sheet, and the database keeps it
   (set_game_lineup, _series_limit_sweep). Every market widget repaints in place on "s2:market". */
(function () {
  "use strict";
  var S2 = window.S2;
  if (!S2 || !S2.page) return;
  var M = S2.M, esc = S2.esc;

  var SLOTS = ["LW", "C", "RW", "LD", "RD", "G"];
  var LOCK_MS = 30 * 60000, LATE_MS = 10 * 60000;   /* Rule 5.3: lock 30 min before puck drop; changes accepted to 10 min after */
  var YOU_TABS_ALL = [["week", "Your week", "calendar"], ["season", "Your season", "chart"], ["inbox", "Inbox", "inbox"], ["applications", "Applications", "doc"], ["settings", "Settings", "gear"]];
  /* staff and the commissioner file no owner or staff application (the league office holds no club seat), so their You
     has no Applications tab; a stale ?tab=applications falls back to the first tab */
  function youTabs() { return S2.has("staff") ? YOU_TABS_ALL.filter(function (x) { return x[0] !== "applications"; }) : YOU_TABS_ALL; }
  /* office: the Front office tab (commissioner, 2026-11-23, on the cutover list: bring back Team HQ management) */
  var HQ_TABS = [["overview", "Overview", "pulse"], ["roster", "Roster & cap", "people"], ["trades", "Trades", "swap"], ["bidding", "Bidding", "gavel"], ["lineups", "Lineups", "scores"], ["nights", "Game nights", "calendar"], ["office", "Front office", "shield"]];

  /* ---------- the page's state: lives as long as the tab ---------- */
  /* read and filter are the inbox's (js/inbox.js), lu the lineup sheets as read from the league (js/pages/lineups.js),
     late the member's late marks (js/pages/you.js), night the night on screen, blk, bpos and belig this page's filters.
     shortcut: sent is only js/inbox.js's demo path's; drop it when the inbox's owner removes that path */
  var ST = { late: {}, read: {}, filter: "all", lu: {}, night: null, sent: [], blk: "all", bpos: "all", belig: "all" };
  /* the league's own clock (the plan rows' countdowns, the tab badges, the next night, the lineup words and the server
     freeze all read this; e1, from e2's hand-over 2026-11-24) */
  function now() { return Date.now(); }

  /* ---------- small helpers ---------- */
  var IC = {
    grip: '<circle cx="9" cy="6.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="17.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="17.5" r="1.4" fill="currentColor" stroke="none"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    note: '<path d="M5 4h14v10l-6 6H5z"/><path d="M13 20v-6h6"/>'
  };
  function ic(name) { return IC[name] ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[name] + "</svg>" : S2.ic(name); }
  function team(code) { return M.team(code) || { code: code, city: code, name: code, full: code }; }
  function opp(g, code) { return g.home === code ? g.away : g.home; }
  function vs(g, code) { return (g.home === code ? "vs " : "at ") + team(opp(g, code)).full; }
  /* a narrow game row names the city ("at New York") beside the crest instead of cutting the full name ("vs Pittsburgh
     Pe...", audit 2026-11-09); the full name stays for wider rows and for a screen reader at every width */
  function vsHtml(g, code) {
    return '<span class="hqx-vs-l">' + esc(vs(g, code)) + '</span><span class="hqx-vs-s" aria-hidden="true">' + esc((g.home === code ? "vs " : "at ") + team(opp(g, code)).city) + "</span>";
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  /* M.money(0) prints "$0K" (a front-office seat or an empty camp); reported to the data owner. shortcut: guarded here,
     remove when model.js returns "$0" */
  function money(n) { return n === 0 ? "$0" : M.money(n); }
  function ord(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function iso(ms) { return new Date(ms).toISOString(); }
  function stamp(ms) { return M.etDateTime(iso(ms)); }
  function clock(ms) { return M.etTime(iso(ms)); }
  function noYear(s) { return String(s || "").replace(/, \d{4}$/, ""); }
  function etMinutes(at) { var t = /(\d+):(\d+)\s*(AM|PM)/.exec(M.etTime(at) || ""); return t ? (+t[1] % 12 + (t[3] === "PM" ? 12 : 0)) * 60 + +t[2] : 0; }
  /* a unit never breaks across lines ("Locks in 2 d 8 h" left a lone "h" at 320, review 2026-10-20), as today.js nb() */
  function nb(s) { return String(s).replace(/ /g, "\u00a0"); }
  function parts(ms) { var s = Math.max(0, Math.floor(ms / 1000)); return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 }; }
  function left(ms) {
    if (ms <= 0) return "0:00";
    var p = parts(ms);
    return nb(p.d ? p.d + " d " + p.h + " h" : p.h ? p.h + " h " + p.m + " min" : p.m + ":" + String(p.s).padStart(2, "0"));
  }
  /* the big countdown: numerals with small muted units, as Today's (today.js untilBig, .td-cd-n / .td-cd-u), so one idea
     looks the same in both areas (review 2026-10-20: the display face set "2 D 7 H" with units as big as the numbers) */
  function bigLeft(ms) {
    var p = parts(ms), u = function (n, unit) { return '<span class="hqx-cd-n">' + n + '</span><span class="hqx-cd-u">' + unit + "</span>"; }, two = function (n) { return String(n).padStart(2, "0"); };
    return p.d ? u(p.d, "d") + u(two(p.h), "h") : p.h ? u(p.h, "h") + u(two(p.m), "m") : u(p.m, "m") + u(two(p.s), "s");
  }
  function cd(target, done, cls) {
    var big = /\bd-num\b/.test(cls || ""), ms = target - now();
    return '<span class="' + (cls || "num") + '" data-hqcd="' + target + '" data-cd-done="' + esc(done || "0:00") + '"' + (big ? ' data-big="1"' : "") + ">" + (big && ms > 0 ? bigLeft(ms) : left(ms)) + "</span>";
  }
  function cal(n, key) { var s = M.control && M.control.season(n); return s ? s.calendar.filter(function (c) { return c.key === key; })[0] || null : null; }
  /* the seasons record closes Season 2 sign-ups Thu, Jan 7; Rule S2.1 says Fri, Jan 8. Until one is corrected every
     printing of that date carries the Season page's hedge (league.js timeline: "date to be confirmed") */
  /* the hedge is gone: the commissioner set Friday, January 8 on 2026-10-20 (v4.23), so the date is confirmed */
  function tbc() { return ""; }
  function calText(n, key) { var c = cal(n, key); return c ? noYear(c.date) + ", " + c.time + " ET" + tbc(n, key) : "date to be set"; }
  function valid(tabs, t) { return tabs.some(function (x) { return x[0] === t; }) ? t : ""; }
  function tabName(tabs, t) { return (tabs.filter(function (x) { return x[0] === t; })[0] || [0, ""])[1]; }
  function standing(code) { return M.standings("league").filter(function (r) { return r.code === code; })[0] || null; }
  function rec(row) { return row ? row.w + "-" + row.l + "-" + row.otl : "–"; }
  /* the kit's one empty state (S2.empty, audit 2026-11-09) */
  function empty(title, body) { return S2.empty("none", title, esc(body)); }
  function fail(title, err) {
    if (window.console) console.error("[hq] " + title + " failed to render", err);   /* fail loud: the console names the page and the error */
    return '<div class="page-head hqx-head"><h1 class="d-1">' + esc(title) + '</h1></div>' +
      S2.empty("err", "This page could not be drawn", "Something in the data was not what the page expected. Nothing you entered was lost.", '<button class="btn secondary sm" data-retry>Try again</button>');
  }
  /* ---------- website furniture (league website v2): a section is a head over its content, never a card wall ---------- */
  function arrow(label, href) { return '<a class="arrow" href="' + esc(href) + '"><span>' + esc(label) + "</span>" + S2.ic("chev") + "</a>"; }
  /* o.k (kicker), o.h (headline) and o.p (one sentence) are HTML the caller has escaped; o.go is [label, href] */
  function head(o) {
    return '<div class="sec-head hqx-hd"><div class="copy">' + (o.k ? '<span class="kicker"><span class="hqx-kt">' + o.k + "</span></span>" : "") + "<h" + (o.lv || 3) + ' class="' + (o.size || "d-2") + '">' + o.h + "</h" + (o.lv || 3) + ">" +
      (o.p ? "<p>" + o.p + "</p>" : "") + "</div>" + (o.side || "") + (o.go ? arrow(o.go[0], o.go[1]) : "") + "</div>";
  }
  /* sources and method sit in one small disclosure at the foot of a pane, not under every chart. QA visual 32 (2026-11-25):
     it is core's one disclosure (S2.about, the 2026-11-09 audit's one design for every page); Team HQ drew its own inline
     chevron. The router reveals its .reveal class with the rest of the page */
  function about(html) { return S2.about([html]); }
  /* quiet state: a colored dot and a small uppercase word, instead of a filled chip */
  function tag(tone, text) { return '<span class="hqx-tag ' + (tone || "") + '">' + esc(text) + "</span>"; }
  /* the Juventus date block: day, big date, month ("Wed, Oct 21" from the model) */
  function dateBlock(at) {
    var d = String(M.etDate(at) || "").split(/,?\s+/);
    return '<span class="hqx-date" aria-hidden="true"><span>' + esc(d[0] || "") + '</span><b class="d-num">' + esc(d[2] || "") + "</b><span>" + esc(d[1] || "") + "</span></span>";
  }
  /* text on a club color is core's S2.inkOn (QA worst 9, 2026-11-25: this file's copy is folded into it, as core's
     shortcut marker asked; league.js and today.js still keep theirs), and the band itself is core's S2.clubBand (QA round
     2 A4: the color, its ink and the ink-band fallback, written here by hand until then) */
  /* a dark-scoped block follows the chosen finish: tokens.css matches [data-theme][data-finish] on the same element */
  function inkAttrs() { return ' data-theme="dark" data-look-scope data-finish="' + esc(S2.state.finish) + '"'; }

  /* ---------- schedule, availability, floor, roster ---------- */
  var WEEK = {};
  function clubGames(code) { return M.games.filter(function (g) { return g.home === code || g.away === code; }); }
  function weekGames(code) {   /* the club's next game week: the first week with an upcoming game, oldest first */
    if (WEEK[code]) return WEEK[code];
    var up = clubGames(code).filter(function (g) { return g.state === "upcoming"; });
    return (WEEK[code] = up.length ? up.filter(function (g) { return g.week === up[0].week; }) : []);
  }
  function byNight(games) {
    var out = [], idx = {};
    games.forEach(function (g) {
      if (!(g.night in idx)) { idx[g.night] = out.length; out.push({ night: g.night, label: M.etLong(g.at), short: g.date, games: [] }); }
      out[idx[g.night]].games.push(g);
    });
    return out;
  }
  function curNight(nights) { return nights.filter(function (n) { return n.night === ST.night; })[0] || nights[0]; }
  function dueOf(games) {   /* Rule 5.1: availability is due at 7:30 PM ET on the week's first night */
    return games.length ? Date.parse(games[0].at) - (etMinutes(games[0].at) - (19 * 60 + 30)) * 60000 : null;
  }
  function lockOf(g) { var at = Date.parse(g.at); return { lock: at - LOCK_MS, at: at, close: at + LATE_MS }; }
  function lockState(g, t) { var k = lockOf(g); t = t == null ? now() : t; return t < k.lock ? "open" : t < k.close ? "locked" : "underway"; }
  /* the signed-in member's player in the season on screen (null signed out, or with no line, spot or sign-up there; the
     You page draws such a member from their profile, js/pages/you.js self()) */
  function me() { var id = S2.session && S2.session.profileId; return (id && M.player(id)) || null; }
  function squadOf(p) { return p.squad; }
  /* Rule 5.2 (Season 1): six games a week on the active roster, three in camp. Season 2 and beyond have no weekly limit
     (Rule S2.7; commissioner, 2026-10-12), so a season from 2 on has none, live or not (e2's hand-over, 2026-11-24) */
  function limitOf(p) { return M.view.season >= 2 ? Infinity : squadOf(p) === "tc" ? 3 : 6; }
  /* the club's answers, read by e2's lineup layer (js/pages/lineups.js S2.lineups.availOf, availability rows by game);
     until that layer is on the page nobody has answered */
  function availOf(p, g) { var LU = S2.lineups; return LU && LU.availOf ? LU.availOf(p, g) : null; }
  function availWord(a) { return a === "yes" ? "Available" : a === "no" ? "Not available" : "No answer yet"; }
  /* Rule 8.3: the one definition is the model's M.playoffFloor (v3.94 prorating, v4.00 rounding, the v4.43 Season 1
     floor of 14). This page computed its own copy until the model gained it (2026-11-02) */
  function floorOf(p) { return M.playoffFloor(p.id) || { floor: 0, base: 0, prorated: false, leftAtPlacement: 0, total: 0, since: null, gp: 0, group: null }; }
  /* "games at forward": the signed-up group the floor counts (commissioner, 2026-11-24; shipped v4.61, Rule S2.7 para 1
     and 8.3 para 4, public.playoff_eligibility_gp). fl.group is the model's p.unit: the roster spot's group, else the
     sign-up's. The database's _registered_group takes the SIGN-UP first when the two disagree; reported to the model's
     owner, because M.playoffFloor is the one definition */
  var GROUP_AT = { F: "forward", D: "defense", G: "goaltender" };
  function atGroup(fl) { return fl.group ? " at " + GROUP_AT[fl.group] : ""; }
  function rosterView(code) {
    var r = M.roster(code); if (!r) return null;
    var pro = [], tc = [];
    r.all.forEach(function (p) { (squadOf(p) === "tc" ? tc : pro).push(p); });
    var cnt = function (l) { return l.reduce(function (a, p) { if (p.unit) a[p.unit]++; a.total++; return a; }, { F: 0, D: 0, G: 0, total: 0 }); };
    var pay = function (l) { return l.reduce(function (a, p) { return a + (p.salary || 0); }, 0); };
    return { team: r.team, all: r.all, pro: pro, tc: tc, n: { pro: cnt(pro), tc: cnt(tc) }, pay: { pro: pay(pro), tc: pay(tc) }, cap: r.cap, limits: r.limits, seats: r.seats };
  }
  /* the ONE acting club (v5.00 swap, e1, 2026-11-24; the trade page reads it too): a front office's club is its own
     seat's (S2.session.teamCode, else the club whose teams.id is S2.session.teamId). A commissioner's is the club they
     preview (commissioner-club-preview v2.86), and that club is the market's acting club, S2.market.club(): Team HQ's
     View as, the club page's Open Team HQ and the bid room's and camp page's Acting for all set it through
     S2.market.setClub, so Team HQ, the trade page, the lobby's server picks (js/lobby.js reads S2._hq.club), the club page
     and the market act for one club. (i3c review, 2026-11-25: Team HQ kept its own copy in this device's store while the
     lobby and the club page read another, so a commissioner previewing Boston was shown, and would have saved, Detroit's
     picks under Boston's name.) This device remembers the last club Team HQ drew, as the current site keeps
     prefs.previewClub, and it stands while the market has none (after a reload, or Watching in the bid room); else their
     own club, else the first club. The market reads a seat before the preview, which only matters for a commissioner
     who holds a club seat, and the league office never does (role-conflict-rules: league office and club front office
     are exclusive) */
  var PREVIEW_KEY = "previewClub";
  function club() {
    var s = S2.session || {}, own = s.teamCode || (s.teamId ? idCode(s.teamId) : null);
    if (!S2.has("commish")) return own;
    var acting = S2.market && S2.market.club ? S2.market.club() : null, kept = S2.store.get(PREVIEW_KEY, null);
    return [acting, kept].filter(function (c) { return c && M.team(c); })[0] || own || (M.teams[0] && M.teams[0].code) || null;
  }
  /* a commissioner acts for code: the market takes it (its setClub refuses anyone but a commissioner) and this device
     keeps it. The one writer of the acting club outside the market; S2._hq.setClub shares it */
  function setClub(code) {
    if (!S2.has("commish") || !M.team(code)) return false;
    if (S2.store.get(PREVIEW_KEY, null) !== code) S2.store.set(PREVIEW_KEY, code);
    if (!S2.market || !S2.market.setClub) { console.error("[hq] S2.market.setClub is missing: the market would act for another club than Team HQ"); return false; }
    if (S2.market.club() !== code) S2.market.setClub(code);
    return true;
  }
  /* a club's row id (teams.id), and back: the way there is the one definition e2 made, S2.lobby.teamId (the seat's own
     id, the model's, else the league body's teams row), and the way back reads the same rows */
  function teamRows() { var b = S2.data && S2.data.body; return (b && b.teams) || []; }
  function tidOf(code) { return S2.lobby.teamId(code); }
  function idCode(id) {
    if (!id) return null;
    var t = M.teams.filter(function (x) { return x.id === id; })[0] || teamRows().filter(function (x) { return x.id === id; })[0];
    return t ? t.code : null;
  }
  /* a club's three seats are its teams row's pointers (owner_profile_id, gm_profile_id, agm_profile_id: where a seat
     lives, one-seat-one-holder v2.23), each holder from the league's people. The model's roster seats come from roster
     spots, so a holder with no spot (an Owner or GM seated before the draft) would read as an open seat. The model's
     seats stand in only when the league body carries no pointers */
  var SEAT_COL = { Owner: "owner_profile_id", GM: "gm_profile_id", AGM: "agm_profile_id" };
  function seatsOf(code) {
    var row = teamRows().filter(function (x) { return x.code === code; })[0], r = M.roster(code), out = { Owner: null, GM: null, AGM: null };
    if (!row || !(SEAT_COL.Owner in row)) return (r && r.seats) || out;
    Object.keys(SEAT_COL).forEach(function (k) { var id = row[SEAT_COL[k]]; if (id) out[k] = M.player(id) || { id: id, tag: "A member", posName: "Front office" }; });
    return out;
  }
  /* the seat a player holds at their club ("Owner", "GM", "AGM") or null: the model's roster seat, or the teams row's
     pointers (seatsOf), so a holder seated before the draft reads as one. Every manager door here (the trade
     block, Trade, Waive, the seat chip) reads this one (Rule 2.6) */
  function seatHeld(p) {
    if (!p) return null;
    if (p.seat) return p.seat;
    var se = seatsOf(p.club), hit = null;
    ["Owner", "GM", "AGM"].forEach(function (k) { if (se[k] && se[k].id === p.id) hit = k; });
    return hit;
  }

  /* ---------- lineups: one sheet per game per club, as js/pages/lineups.js reads it from the league ---------- */
  function luKey(code, g) { return code + ":" + g.id; }
  function luOf(code, g) { return ST.lu[luKey(code, g)] || (ST.lu[luKey(code, g)] = { slots: {}, filed: null, hist: [] }); }
  function slotOf(L, pid) { for (var i = 0; i < SLOTS.length; i++) if (L.slots[SLOTS[i]] === pid) return SLOTS[i]; return null; }
  function filledN(L) { return SLOTS.filter(function (s) { return L.slots[s]; }).length; }
  function luStatus(p, g) {
    var L = ST.lu[luKey(p.club, g)], s = L && slotOf(L, p.id);
    if (s) return (L.filed ? "Dressed at " : "Penciled in at ") + s + (L.filed ? "" : " (draft)");
    return L && L.filed ? "Not dressed" : "Lineup not filed yet";
  }

  /* ---------- the workspace frame: split view on desktop, grouped list + back chevron on phone ---------- */
  var LAST = null, SOFT = false, BACK_POPS = false;
  /* a re-render of the workspace already on screen (tab switch, theme, view-as) skips the page entrance; S2.route calls
     render() before it replaces #page, so the old markup is still there to ask */
  function soft(ws) { var cur = S2.$("#page [data-ws]"); return (SOFT = !!(cur && cur.dataset.ws === ws && LAST && LAST.ws === ws && LAST.role === S2.state.role)); }
  function frame(ws, r, tabs, o) {
    var tab = valid(tabs, r.q.tab), cur = tab || tabs[0][0], rv = soft(ws) ? "" : " reveal", name = tabName(tabs, cur);
    /* o.band: Team HQ's head is a band in the club's own color (club colors are the imagery; no photos by ruling), as
       S2.clubBand's style declarations */
    return '<div class="hqx" data-ws="' + ws + '" data-root="' + (!tab) + '" data-tab="' + cur + '">' +
      '<header class="page-head hqx-head' + (o.band ? " band club tight hqx-band" : "") + rv + '"' + (o.band ? ' style="' + esc(o.band) + '"' : "") + ">" +
        '<a class="hqx-back" href="#/' + ws + '" data-back>' + S2.ic("back") + "<span>" + esc(o.title) + "</span></a>" +
        '<div class="hqx-head-in"><div class="hqx-head-copy"><span class="kicker hqx-kick">' + o.kicker + "</span>" +
          '<h1 class="d-1"><span class="hqx-ws">' + esc(o.title) + '</span><span class="hqx-sec">' + esc(name) + "</span></h1>" +
          '<p class="hqx-lede">' + o.sub + "</p>" + (o.banner || "") + "</div>" + (o.art || "") + "</div></header>" +
      '<div class="hqx-split">' +
        '<nav class="hqx-side' + rv + '" aria-label="' + esc(o.title) + ' sections">' +
          '<div class="hqx-nav">' + navRows(ws, tabs, cur, o.meta) + "</div>" + (o.more || "") + "</nav>" +
        '<section class="hqx-pane' + rv + '" aria-labelledby="hqxPaneT"><h2 class="sr" id="hqxPaneT">' + esc(name) + "</h2>" + o.pane(cur) + "</section>" +
      "</div></div>";
  }
  /* the section list: on a phone a website menu (big condensed labels, a line of status, a count); on desktop a quiet
     source list where the current section carries a bar, not a filled pill */
  function navRows(ws, tabs, cur, meta) {
    return tabs.map(function (x) {
      var m = meta[x[0]] || {};
      return navRow("#/" + ws + "?tab=" + x[0], x[1], m.sub, m.badge, m.badgeLabel, x[0] === cur);
    }).join("");
  }
  function navRow(href, title, sub, badge, badgeLabel, current) {
    return '<a class="hqx-nav-row" href="' + href + '"' + (current ? ' aria-current="page"' : "") + '><span class="grow"><span class="hqx-nav-t">' + esc(title) + "</span>" +
      (sub ? '<span class="hqx-nav-s">' + esc(sub) + "</span>" : "") + "</span>" +
      (badge ? '<span class="hqx-badge num"><span aria-hidden="true">' + badge + '</span><span class="sr">' + esc(badgeLabel || "") + "</span></span>" : "") + S2.chev() + "</a>";
  }
  function refreshNav() {
    var host = S2.$(".hqx[data-ws]"), nav = host && S2.$(".hqx-nav", host); if (!nav) return;
    var ws = host.dataset.ws;
    keep(nav, function () { nav.innerHTML = navRows(ws, ws === "you" ? youTabs() : hqTabs(), host.dataset.tab, ws === "you" ? youMeta(me()) : hqMeta(club())); });
  }
  function repaint(name, html) { S2.$$('[data-w="' + name + '"]').forEach(function (el) { keep(el, function () { el.innerHTML = typeof html === "function" ? html() : html; }); }); }
  /* focus survives an in-place repaint: read the focused control's stable data keys, repaint, then focus the same control
     in the new markup, else the control for the same item (Approve becomes Undo, a bench chip becomes the spot it went
     to), else the repainted region itself, so a keyboard user never falls out to <body> or out of a dialog */
  var FKEYS = ["data-act", "data-x", "data-av", "data-v", "data-app", "data-note", "data-bnote"], IDKEYS = ["data-id", "data-pid", "data-g", "data-slot"];
  var FOCUSABLE = "button:not(:disabled), a[href], input, select, textarea, [tabindex]";
  function attrSel(el, keys) { return keys.filter(function (k) { return el.hasAttribute(k); }).map(function (k) { return "[" + k + '="' + CSS.escape(el.getAttribute(k)) + '"]'; }).join(""); }
  function keysOf(el) {
    var slot = el.classList.contains("hqx-slot"), id = attrSel(el, IDKEYS.filter(function (k) { return !(slot && k === "data-pid"); }));   /* a spot is its position, not its player */
    return [el.tagName.toLowerCase() + (slot ? ".hqx-slot" : el.classList.contains("hqx-chip") ? ".hqx-chip" : "") + attrSel(el, FKEYS) + id, id].filter(Boolean);
  }
  function keep(scope, fn, fallback) {
    var a = document.activeElement, keys = a && a !== document.body && a !== scope && scope.contains(a) ? keysOf(a) : null;
    fn();
    if (!keys || a.isConnected) return;
    for (var i = 0; i < keys.length; i++) {
      var n = S2.$$(keys[i], scope).filter(function (x) { return x.matches(FOCUSABLE); })[0];
      if (n) return n.focus({ preventScroll: true });
    }
    var f = fallback || scope; if (!f.hasAttribute("tabindex")) f.setAttribute("tabindex", "-1");
    f.focus({ preventScroll: true });
  }
  function timeHtml(g) { return '<span class="hqx-time"><b class="d-num">' + esc(g.time.replace(/\s?[AP]M$/, "")) + "</b><small>" + esc(g.time.slice(-2)) + "</small></span>"; }
  /* one game's result at the head of its row: a lettered square, not a chip (a run of results uses form()) */
  function mark(r) { return '<span class="hqx-mark5 ' + (r === "W" ? "w" : r === "L" ? "l" : "o") + '"><span aria-hidden="true">' + esc(r === "OTL" ? "OT" : r || "–") + '</span><span class="sr">' + esc(r === "W" ? "Win" : r === "L" ? "Loss" : r === "OTL" || r === "OT" ? "Overtime loss" : "No result") + "</span></span>"; }
  /* the kit's sheet, tagged so this page's styles reach it. o.back lists selectors, in order, for the control that
     opened it: when that control was repainted while the sheet was up, the kit's saved focus points at a removed node,
     so focus goes to its live replacement instead of <body> */
  function sheet(o) {
    var back = o.back, own = o.onClose;
    o.onClose = function () {
      if (own) own();
      /* focus left on a node the repaint removed counts as lost too (audit 2026-11-09: after a waiver the focus stayed on
         the detached "Put on waivers" button); with no live opener it lands on the pane's heading, never on nothing */
      var a = document.activeElement;
      if (a && a !== document.body && a.isConnected) return;
      if (back && back.some(function (s) { var t = S2.$(s); if (t) t.focus({ preventScroll: true }); return !!t; })) return;
      var h = S2.$(".hqx .sec-head h3, .hqx .sec-head h2");
      if (h) { if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    };
    var sh = S2.sheet(o); sh.el.classList.add("hqx-sheet"); return sh;
  }
  function closeOnLinks(sh) { sh.el.addEventListener("click", function (e) { if (e.target.closest("a[href]")) sh.close(); }); return sh; }
  /* a sheet's answers (its error line and actions) sit in a footer outside the scrolling body, as on the lineup sheet:
     data-autofocus on Accept or Withdraw no longer scrolls the body past You get and You send (review 2026-10-20: at
     320x568 the offer opened at scrollTop 532 of 972). Moved after the kit measures; say() still finds .hqx-err */
  function pinFoot(sh) {
    var foot = document.createElement("div"); foot.className = "hqx-sh-foot";
    S2.$$(".sheet-b .hqx-err, .sheet-b .hqx-actions", sh.el).forEach(function (n) { foot.appendChild(n); });
    sh.el.appendChild(foot); sh.el.classList.add("hqx-footed"); return sh;
  }

  /* =====================================================================================================================
     TEAM HQ
     ===================================================================================================================== */
  function hqMeta(code) {
    var rv = rosterView(code), n = byNight(weekGames(code))[0], wk = weekGames(code), pend = livePending(code).length;
    var unfiled = n ? n.games.filter(function (g) { return !luOf(code, g).filed && lockState(g) !== "underway"; }).length : 0;
    var missing = rv ? rv.pro.filter(function (p) { return wk.some(function (g) { return !availOf(p, g); }); }).length : 0;
    return {
      overview: { badge: pend || "", badgeLabel: plural(pend, "approval") + " waiting", sub: pend ? plural(pend, "approval") + " waiting for " + (!isOwnerish() ? "the Owner" : "you") : "Nothing waiting" },
      roster: { sub: (function () { var cs = S2.market && S2.market.clubState(code); return cs ? cs.active.total + " of " + cs.limit + " active · " + money(cs.room) + " room" : ""; })() },
      trades: (function () { var tid = tidOf(code), n = offReady(code) ? OFF.open.filter(function (x) { return x.to_team_id === tid; }).length : 0;
        return { badge: n || "", badgeLabel: plural(n, "offer") + " to answer", sub: n ? plural(n, "offer") + " to answer" : "No offers waiting" }; })(),
      bidding: bidMeta(code),
      lineups: { badge: unfiled || "", badgeLabel: plural(unfiled, "sheet") + " not filed", sub: n ? (unfiled ? plural(unfiled, "sheet") + " to file for " + n.short.split(",")[0] : "Every sheet filed for " + n.short.split(",")[0]) : "No games" },
      nights: { badge: missing || "", badgeLabel: plural(missing, "player") + " still to answer", sub: !wk.length ? "No games ahead" : missing ? plural(missing, "player") + " still to answer" : "Everyone has answered" },
      office: (function () { var open = ["GM", "AGM"].filter(function (s) { return !seatsOf(code)[s] && !pendingApp(code, s.toLowerCase()); }).length;
        return { sub: open ? plural(open, "seat") + " open" : "Owner, GM and AGM" }; })()
    };
  }
  /* ---- Front office (Rule 2.6): the club's three seats and its nominations (commissioner, 2026-11-23, on the cutover list:
     bring back Team HQ management) ---- */
  var SEAT_NAME = { Owner: "Owner", GM: "General Manager", AGM: "Assistant General Manager" };
  /* =====================================================================================================================
     THE LIVE FRONT OFFICE (v5.00 swap, stream e1, 2026-11-24). The doors are the classic
     site's Team HQ Management page (src/live/part_live.js CG.hubManagement, CG.mgmtApprovalsCard, CG.mgmtPermissionsCard,
     CG.removeManager, CG.submitMgmtApp, CG.withdrawMgmtMove, CG.setOnBlock). Every write goes through S2.write
     (contracts/client-api.md): nothing shows as done until the database confirms it, a refusal shows the database's own
     words and keeps what the member typed or picked, and every repaint is in place. The database decides every power
     (mgmt_gate, guard_mgmt_nominee, owner_remove_manager, RLS); what this page draws is a mirror of it, never the gate.
     Rulings: mgmt-permissions-v238 (the Owner alone seats and removes the GM and AGM and sets per-page access: full,
     Owner approves, hidden); one-seat-one-holder; seat-ends-not-the-spot (a removed manager keeps the roster spot);
     commissioner-club-preview (the league office acts as the Owner, and its moves are never queued); the Season 2 front
     office (commissioner, 2026-11-23: "The agm can be nominated only after the draft completes, and must be a player on
     the current roster. A team cannot nominate a player to be AGM from another roster, or training camp."; a replacement
     GM in season only from the club's own roster, "Correct"; seat salaries Owner $0, GM $0, AGM $2M in place of the
     drafted salary, never both: v4.58 guard_mgmt_nominee and _mgmt_nominee_seat_block, Rule S2.3); trade privacy (v3.35:
     the club's Discord room gets completed trades and roster moves, never an offer, a decline or a withdrawal). The vote
     on a nomination is named "the league office's vote": the reviewers until the staffing flip, every staffer and
     commissioner after it (rule-numbers.md: the all-staff wording is HELD until then). */
  /* the viewer's seat at this club; the league office acts as the Owner (v3.76 full control) */
  function mySeat() { return S2.has("commish") ? "office" : (S2.session && S2.session.seat) || null; }
  function isOwnerish() { var s = mySeat(); return s === "owner" || s === "office"; }
  /* a front-office read through the ONE read door, js/live.js S2.rd (QA round 2 A10, 2026-11-25: this page kept its own
     copy of the six-line reader): no client is an error, so an empty list here always means the league answered empty,
     never that nothing was asked; the answer is r.data (null when none), a refusal the database's words */
  function rd(q) { return S2.rd(q, { offline: "Not connected to the league, so the front office can't be read here. Reload the page and try again." }); }
  /* an archive is read only (QA round 2, 2026-11-25). ?season=1 drew every Team HQ tool over the archive: the block door
     wrote the season on screen's roster row (a Season 1 row, which RLS does not stop), the lineup sheet's lines and night
     plans that season's (js/pages/lineups.js), and the front office, the market and the server picks act on the current
     season whatever the page shows. The test is the trade doors' (js/trade.js seasonId): the season on screen is not the
     season the site opens on (S2.currentSeason). archErr() is that refusal, code S2_ARCHIVE, or null; on an archive no
     write control is drawn (ro()) and every door refuses with it before anything is sent */
  function archErr() {
    var cur = S2.currentSeason && S2.currentSeason(), v = M.view;
    if (!cur || !v || v.season === cur.number) return null;
    /* an earlier season is its archive; a later one (only on an address typed by hand) is named as it is */
    var name = cur.name || "Season " + cur.number, shown = v.season < cur.number ? v.name + "'s archive" : v.name;
    return Object.assign(new Error("This page shows " + shown + ", so Team HQ is read only here. Its tools act on " + name + ": open Team HQ without ?season in the address, then try again."), { code: "S2_ARCHIVE", season: name, shown: shown });
  }
  function ro() { return !!archErr(); }
  /* the doors act() opens (each one writes, or opens the sheet that writes): refused on an archive with archErr's words */
  var WRITE_ACTS = { "seat-nominate": 1, "seat-remove": 1, "nom-withdraw": 1, "mv-decide": 1, "mv-withdraw": 1, "perm-save": 1, "perm-reset": 1, "tr-accept": 1, "tr-decline": 1, "tr-withdraw": 1,
    "tr-reverse": 1, "tr-resend": 1, "rq": 1, "rq-reply": 1, "block-list": 1, "block": 1, claim: 1, badd: 1, ceil: 1, bmove: 1, bremove: 1, sheet: 1, "file-night": 1 };
  /* the season on screen's own row (seat salaries, its id for roster writes) */
  function seasonSettings() { var s = M.control && M.control.season(M.view.season); return (s && s.settings) || {}; }
  /* done is the model's ONE definition of the draft being complete (M.draftDone, QA round 2 A6, 2026-11-25: this page
     read draft_state itself, so a draft the market already called done still read as to come here and on the trade
     page's cards); started adds a draft under way */
  function draftPhase() {
    var st = M.draft && M.draft.state, s = st && st.status, done = M.draftDone();
    return { started: done || s === "live" || s === "paused", done: done };
  }
  /* Rule S2.4's minimums run from the draft through the playoffs: before the draft is complete (and before any final, for a
     season whose draft row is missing) a club at 0 F, 0 D, 0 G is not short of anything (QA visual 35, worst 20, 2026-11-25:
     Team HQ drew three red rules and x marks "below the minimum" on every club before the draft) */
  function minsInForce() { return draftPhase().done || !M.view.empty.finals; }
  function agoAt(at) { return M.ago((Date.now() - Date.parse(at)) / 60000); }
  /* the club's front office, read on every Team HQ render (at most once in four seconds) and after every write: the
     Owner's per-page policy, the approval queue (every pending move, plus the newest eight decided), the club's
     nominations and the newest twenty club notices. RLS decides what each seat reads (is_gm_of, the office; a
     nomination by its submitter, its nominee and the office) */
  var OFF = { seq: 0, code: null, at: 0, err: null, busy: null, busyCode: null, policy: {}, policyAt: null, pend: [], recent: [], apps: [], notices: [], open: [], answered: [], reqs: [], msgs: {} };
  var TR_COLS = "id,from_team_id,to_team_id,offered_profile_ids,requested_profile_ids,offered_pick_ids,requested_pick_ids,note,status,created_at,updated_at";
  var MV_COLS = "id,page,action,summary,requested_by,status,note,result,decided_at,created_at,requester:profiles!team_mgmt_moves_requested_by_fkey(gamertag)";
  var APP_COLS = "id,role,status,nominee_id,submitted_by,pitch,response,seat_block,created_at,decided_at,nominee:profiles!management_applications_nominee_id_fkey(gamertag)";
  var RQ_COLS = "id,profile_id,type,status,subject,details,response,created_at,updated_at,filer:profiles!action_requests_profile_id_fkey(gamertag)";
  var RM_COLS = "id,request_id,author_id,body,created_at,deleted_at,author:profiles!action_messages_author_id_fkey(gamertag)";
  function offReady(code) { return OFF.code === code && !!OFF.at && !OFF.err; }
  function loadOffice(code, force) {
    if (!code) return Promise.resolve(false);
    if (OFF.busy && OFF.busyCode === code) return OFF.busy;
    if (!force && OFF.code === code && OFF.at && !OFF.err && Date.now() - OFF.at < 4000) return Promise.resolve(true);
    var tid = tidOf(code), sid = seasonSettings().id, mine = "from_team_id.eq." + tid + ",to_team_id.eq." + tid;
    OFF.busyCode = code;
    var seq = ++OFF.seq;   /* only the newest read lands: a commissioner who switches clubs mid-read never sees the old club's records */
    /* shortcut: the pending moves and the nominations are read unpaged (PostgREST's 1000-row ceiling); a club holds a
       handful of each, and a newer request for the same target withdraws the older (mgmt_request_move). Page them by key
       (as CG.sbAll does) if a club ever nears it */
    OFF.busy = (!tid ? Promise.reject(new Error("The league data carries no id for " + code + ", so its front office can't be read")) : Promise.all([
      rd(function (c) { return c.from("team_mgmt_policy").select("policy,updated_at").eq("team_id", tid).maybeSingle(); }),
      rd(function (c) { return c.from("team_mgmt_moves").select(MV_COLS).eq("team_id", tid).eq("status", "pending").order("created_at", { ascending: false }); }),
      rd(function (c) { return c.from("team_mgmt_moves").select(MV_COLS).eq("team_id", tid).neq("status", "pending").order("created_at", { ascending: false }).limit(8); }),
      rd(function (c) { return c.from("management_applications").select(APP_COLS).eq("team_id", tid).order("created_at", { ascending: false }); }),
      rd(function (c) { return c.from("club_notices").select("id,kind,title,body,created_at,posted_at").eq("team_id", tid).order("created_at", { ascending: false }).limit(20); }),
      /* the club's trade offers this season: every open one, and the newest ten answered (RLS: the two front offices and
         the league office only, trade privacy v3.35) */
      rd(function (c) { return c.from("trades").select(TR_COLS).or(mine).eq("season_id", sid).eq("status", "proposed").order("created_at", { ascending: false }); }),
      rd(function (c) { return c.from("trades").select(TR_COLS).or(mine).eq("season_id", sid).neq("status", "proposed").order("updated_at", { ascending: false }).limit(10); }),
      /* the club's players' trade requests (Rule 2.3): route "manager", which RLS opens to the club's seats and the league
         office only. shortcut: the newest forty, a club holds a handful; page them by key if one ever nears it */
      rd(function (c) { return c.from("action_requests").select(RQ_COLS).eq("route", "manager").eq("team_id", tid).order("created_at", { ascending: false }).limit(40); })
    ]).then(function (r) {
      /* the replies on those requests (action_messages, the player's and the front office's; staff-only notes never reach a seat) */
      var ids = (r[7] || []).map(function (a) { return a.id; });
      return (ids.length ? rd(function (c) { return c.from("action_messages").select(RM_COLS).in("request_id", ids).order("created_at", { ascending: true }); }) : Promise.resolve([])).then(function (m) { r.push(m || []); return r; });
    })).then(function (r) {
      if (seq !== OFF.seq) return false;
      var pol = r[0] || null;
      OFF.code = code; OFF.at = Date.now(); OFF.err = null;
      OFF.policy = (pol && pol.policy) || {}; OFF.policyAt = pol ? pol.updated_at : null;
      OFF.pend = r[1] || []; OFF.recent = r[2] || []; OFF.apps = r[3] || []; OFF.notices = r[4] || []; OFF.open = r[5] || []; OFF.answered = r[6] || [];
      OFF.reqs = r[7] || []; OFF.msgs = {}; (r[8] || []).forEach(function (m) { (OFF.msgs[m.request_id] = OFF.msgs[m.request_id] || []).push(m); });
      return true;
    }, function (e) {
      if (seq !== OFF.seq) return false;
      console.error("[hq] the front office of " + code + " could not be read", e);   /* fail loud: said here and on the page */
      OFF.code = code; OFF.at = 0; OFF.err = (e && e.message) || String(e);
      return false;
    }).then(function (ok) { if (seq !== OFF.seq) return ok; OFF.busy = null; OFF.busyCode = null; paintOffice(code); return ok; });
    return OFF.busy;
  }
  /* the state line a front-office widget shows until its records are in hand, or when they could not be read: never
     "Nothing waiting" for a read that failed */
  function offWait(code) {
    if (OFF.code === code && OFF.err) return S2.empty("err", "The front office could not be read", esc(OFF.err) + ". Nothing was changed.", '<button type="button" class="btn secondary sm" data-act="off-retry">Try again</button>');
    return offReady(code) ? "" : S2.empty("none", "Reading the front office", "One moment.");
  }
  /* repaint every front-office widget in place once the records change; the permissions editor waits while it holds
     unsaved changes (seamless rule: an edit is never reset under the member) */
  function paintOffice(code) {
    if (club() !== code || !S2.$(".hqx[data-ws=\"hq\"]")) return;
    repaint("approvals", function () { return approvalsLive(code); });
    repaint("seats", function () { return seatsLive(code); });
    repaint("noms", function () { return nomsLive(code); });
    repaint("notices", function () { return noticesLive(code); });
    repaint("ovtrades", function () { return ovTradesInner(code); });
    repaint("troffers", function () { return offersLive(code); });
    repaint("treqs", function () { return reqsLive(code); });
    var cur = (S2.$(".hqx[data-ws=\"hq\"]") || {}).dataset;
    repaint("apnote", function () { return approveNote(code, cur && cur.tab); });
    if (!permDirty()) paintPerms(code);
    refreshNav();
    /* a tab the Owner has just hidden from this seat closes in place (the pane only; the router is never re-run) */
    var host = S2.$(".hqx[data-ws=\"hq\"]"), pane = host && S2.$(".hqx-pane", host), tab = host && host.dataset.tab;
    if (pane && TAB_PAGE[tab] && access(TAB_PAGE[tab]) === "hidden" && !S2.$("[data-hidden-tab]", pane)) keep(pane, function () { pane.innerHTML = '<h2 class="sr" id="hqxPaneT">' + esc(tabName(HQ_TABS, tab)) + "</h2>" + hiddenPane(tab); });
  }
  function reloadOffice(code) { return loadOffice(code, true); }

  /* ---- what each seat may see: the mirror of public.mgmt_access_for. owner and office: everything; a GM or AGM: the
     Owner's policy for the page, else the default (the front office tab hidden, every other page full access). It only
     decides what to draw: the database refuses a hidden page's moves and queues an approved page's (mgmt_gate) ---- */
  var TAB_PAGE = { roster: "roster", trades: "tradehub", bidding: "freeagents", lineups: "lines", nights: "schedule", office: "management" };
  function defMode(page) { return page === "management" ? "hidden" : "full"; }
  function access(page) {
    var s = mySeat(); if (s === "office" || s === "owner") return s; if (!s) return "none";
    var mode = ((OFF.policy || {})[s] || {})[page] || defMode(page);
    if (["full", "approve", "hidden"].indexOf(mode) < 0) mode = defMode(page);
    return page === "management" && mode === "approve" ? "full" : mode;
  }
  /* keep: a tab the address asks for while the Owner's settings are still being read. It is drawn (its widgets say they
     are reading), then closes in place if the settings hide it (paintOffice), so an opened Front office is never lost to
     the default before the settings arrive */
  function hqTabs(keep) { return HQ_TABS.filter(function (x) { return x[0] === keep || !TAB_PAGE[x[0]] || access(TAB_PAGE[x[0]]) !== "hidden"; }); }
  /* the classic CG.mgmtApprovalBanner: on a page the Owner approves, the seat is told before it acts that its moves wait
     for the Owner, with its own waiting moves and their Withdraw (a GM or AGM only) */
  function approveNote(code, tab) {
    var pg = TAB_PAGE[tab]; if (!pg || access(pg) !== "approve" || ro()) return "";
    var me_ = S2.session && S2.session.profileId, mine = offReady(code) ? OFF.pend.filter(function (m) { return m.page === pg && m.requested_by === me_; }) : [];
    return '<div class="hqx-callout hqx-apnote"><p class="t-sub hqx-ink"><b>The Owner approves ' + esc(pageLabel(pg).toLowerCase()) + " moves.</b> Everything you do on this page is sent to the Owner and takes effect only when they approve it, and you are told either way (Rule 2.6)." +
      (mine.length ? " " + esc(plural(mine.length, "move") + " of yours " + (mine.length === 1 ? "is" : "are") + " waiting: " + mine.map(function (m) { return m.summary; }).join("; ") + ".") : "") + "</p>" +
      (mine.length === 1 ? '<div class="hqx-actions"><button type="button" class="btn secondary sm" data-act="mv-withdraw" data-id="' + esc(mine[0].id) + '">Withdraw</button></div>' : "") + "</div>";
  }
  function hiddenPane(tab) {
    return '<div data-hidden-tab="' + esc(tab) + '">' + S2.empty("lock", "Not open to your seat", "The Owner has not opened " + esc(tabName(HQ_TABS, tab)) + " to the " + esc(SEAT_NAME[(mySeat() || "").toUpperCase()] || "seat you hold") + ". Ask the Owner, who sets each seat's access in Front office (Rule 2.6).") + "</div>";
  }

  /* ---- the seats ---- */
  function pendingApp(code, role) { return offReady(code) ? OFF.apps.filter(function (a) { return a.status === "pending" && a.role === role; })[0] || null : null; }
  function tagOf(id, join) { return (join && join.gamertag) || (M.player(id) || {}).tag || "A member"; }
  var SEAT_PAY = { Owner: "owner_salary", GM: "gm_salary", AGM: "agm_salary" };
  function seatPay(s) { var v = seasonSettings()[SEAT_PAY[s]]; return v == null ? "" : money(v) + " against the cap" + (s === "AGM" ? ", in place of the drafted salary" : ""); }
  function seatsLive(code) {
    var t = team(code), seats = seatsOf(code), own = seats.Owner, ph = draftPhase(), boss = isOwnerish(), ready = offReady(code), me_ = S2.session && S2.session.profileId;
    var dr = calText(M.view.season, "draft_at");
    var row = function (s) {
      var p = seats[s], pend = s === "Owner" ? null : pendingApp(code, s.toLowerCase()), agmWaits = s === "AGM" && !ph.done;
      var sub = p ? p.tag + (p.id === me_ ? " (you)" : "") + (p.posName ? " · " + p.posName : "") + (seatPay(s) ? " · " + seatPay(s) : "")
        : pend ? "Nominated: " + tagOf(pend.nominee_id, pend.nominee) + ", waiting for the league office's vote" + (pend.seat_block ? ". Held up: " + pend.seat_block : "")
        : agmWaits ? "Named after the draft, " + dr + ", from your active roster (Rule S2.3)"
        : s === "GM" && !ph.started ? "Required before the draft, " + dr + " (Rule S2.3)" : "Open";
      var btn = s === "Owner" || !boss || !ready || ro() ? "" : p ? '<button type="button" class="btn secondary sm" data-act="seat-remove" data-seat="' + s + '">Remove</button>'
        : pend ? '<button type="button" class="btn plain sm" data-act="nom-withdraw" data-id="' + esc(pend.id) + '" data-seat="' + s + '">Withdraw</button>'
        : agmWaits ? "" : '<button type="button" class="btn sm" data-act="seat-nominate" data-seat="' + s + '">Nominate</button>';
      return '<div class="row hqx-seat" data-seat="' + s + '"><span class="grow"><span class="title">' + esc(SEAT_NAME[s]) + '</span><span class="sub">' + esc(sub) + "</span></span>" + btn + "</div>";
    };
    return head({ k: "Front office · Rules 2.6 and S2.3", h: esc(own ? own.tag + " owns the " + t.full : "No Owner is seated"),
        p: "Every club holds its Owner and General Manager seats before the draft begins. The Assistant General Manager is named only after the draft is complete, from the players then on the club's active roster, never from another club or the training camp pool, and a General Manager named once the draft has begun comes from that roster too (Rule S2.3). The Owner alone nominates and removes them, and the league office votes on each nomination (Rule 2.6)." }) +
      '<div class="list hqx-list hqx-seats">' + ["Owner", "GM", "AGM"].map(row).join("") + "</div>" +
      (mySeat() === "office" ? '<p class="hqx-fine">As the league office you act for the Owner here: your appointment takes effect at once, without a vote.</p>' :
        !boss ? '<p class="hqx-fine">Only the Owner nominates or removes a General Manager or Assistant General Manager (Rule 2.6).</p>' : "") +
      offWait(code);
  }
  /* the nominee list: before the draft begins, a GM from anyone signed up for the season who holds no seat; from the
     draft on, a GM or AGM only from the club's active roster (Rule S2.3). Nobody already seated or nominated for another
     seat of this club (Rule 2.6). The database judges the nominee again (guard_mgmt_nominee, staff and commissioners
     included), and its refusal is shown in the sheet */
  function nomPool(code, s) {
    var r = M.roster(code), out = {}, ph = draftPhase();
    var seats = seatsOf(code); ["Owner", "GM", "AGM"].forEach(function (x) { if (seats[x]) out[seats[x].id] = 1; });
    /* QA nits 29 (2026-11-25): one club seat league-wide (Rule 2.6). An Owner or GM seated at ANOTHER club before the draft
       holds no roster spot there, so p.seat misses them and guard_mgmt_nominee refused every such name; every club's teams
       row names its holders */
    teamRows().forEach(function (t) { [t.owner_profile_id, t.gm_profile_id, t.agm_profile_id].forEach(function (id) { if (id) out[id] = 1; }); });
    OFF.apps.forEach(function (a) { if (a.status === "pending") out[a.nominee_id] = 1; });
    var list = s === "AGM" || ph.started ? (r ? r.active : []) : M.signups.filter(function (x) { return x.status !== "withdrawn"; }).map(function (x) { return x.player; });
    return list.filter(function (p) { return p && !p.seat && !out[p.id]; }).sort(function (a, b) { return String(a.tag).toLowerCase() < String(b.tag).toLowerCase() ? -1 : 1; });
  }
  function nominateLive(code, s) {
    if (!isOwnerish()) return S2.toast("Only the club's Owner nominates a General Manager or Assistant General Manager (Rule 2.6).", "err");
    if (!offReady(code)) return S2.toast("The front office is still being read. Try again in a moment.", "err");
    var ph = draftPhase(), office_ = mySeat() === "office", tid = tidOf(code);
    if (s === "AGM" && !ph.done) return S2.toast("An Assistant General Manager is named only after the draft is complete, from your own roster (Rule S2.3).", "err");
    var pool = nomPool(code, s), q = "", chosen = null, big = pool.length > 24;
    var say = s === "AGM" ? "From your club's active roster only, never another club or the training camp pool (Rule S2.3)." : ph.started ? "From your club's active roster only, now that the draft has begun (Rule S2.3)." :
      "Before the draft, anyone signed up for the season who holds no club seat, on your club or not (Rule S2.3).";
    var list = function () {
      var hit = pool.filter(function (p) { return !q || p.tag.toLowerCase().indexOf(q) >= 0; }), shown = hit.slice(0, 30);
      return shown.length ? shown.map(function (p) { return '<button type="button" class="row" data-pick="' + esc(p.id) + '" aria-pressed="' + (p.id === chosen) + '">' + M.crest(p.club) + '<span class="grow"><span class="title">' + esc(p.tag) + '</span><span class="sub">' + esc(p.posName + (p.club ? " · " + team(p.club).city : "")) + "</span></span>" + (p.id === chosen ? '<span class="hqx-tick">' + S2.ic("check") + "</span>" : "") + "</button>"; }).join("") +
          (hit.length > shown.length ? '<p class="hqx-fine">' + (hit.length - shown.length) + " more: keep typing to narrow it.</p>" : "")
        : '<p class="hqx-fine">' + (pool.length ? "Nobody by that name." : "Nobody can take the seat right now.") + "</p>";
    };
    var sh = sheet({ title: "Nominate " + (/^[AEIOU]/.test(SEAT_NAME[s]) ? "an " : "a ") + SEAT_NAME[s], back: ['[data-act="seat-nominate"][data-seat="' + s + '"]'], html: '<div class="hqx-nom"><p class="t-body">' + esc(say) + " " +
        (office_ ? "As the league office, your appointment takes effect at once." : "The league office votes on the nomination.") + "</p>" +
      (big ? '<label class="lg-search"><span class="sr">Find a member</span>' + S2.ic("search") + '<input class="input" type="search" data-x="q" placeholder="Find a member" autocomplete="off" spellcheck="false" data-autofocus></label>' : "") +
      '<div class="list hqx-list" data-x="list">' + list() + "</div>" +
      '<div class="field"><label for="hqxPitch">Why them? (optional)</label><textarea class="input" id="hqxPitch" rows="3" maxlength="600" placeholder="A line on why they should run your club."></textarea></div>' +
      '<p class="hqx-err" role="alert"></p><div class="hqx-actions"><button type="button" class="btn" data-x="go">' + (office_ ? "Appoint" : "Submit nomination") + '</button><button type="button" class="btn secondary" data-x="keep">Cancel</button></div></div>' });
    pinFoot(sh);
    var inp = S2.$('[data-x="q"]', sh.el), box = S2.$('[data-x="list"]', sh.el), err = function (m) { S2.$(".hqx-err", sh.el).textContent = m; };
    if (inp) inp.addEventListener("input", function () { q = inp.value.trim().toLowerCase(); box.innerHTML = list(); });   /* only the list repaints, never the field */
    sh.el.addEventListener("click", function (e) {
      var pk = e.target.closest("[data-pick]");
      if (pk) { chosen = pk.dataset.pick; keep(box, function () { box.innerHTML = list(); }); err(""); return; }
      var b = e.target.closest("button[data-x]"); if (!b) return;
      if (b.dataset.x === "keep") return sh.close();
      if (!chosen) return err("Pick a player first.");
      var pitch = (S2.$("#hqxPitch", sh.el).value || "").trim() || null, nominee = M.player(chosen);
      b.disabled = true; err("");
      /* office appointments are seated by the same insert (notify_mgmt_application), so the seats are read again too */
      S2.write("management_applications.insert", { row: { team_id: tid, role: s.toLowerCase(), submitted_by: S2.session.profileId, nominee_id: chosen, pitch: pitch } },
        { sections: office_ ? ["teams", "rosters"] : [], repaint: function () { reloadOffice(code); } }).then(function (res) {
        var id = res && res.data && res.data[0] && res.data[0].id;
        sh.close();
        if (!office_) return S2.toast(tagOf(chosen) + " is nominated as " + SEAT_NAME[s] + ". The league office votes on it.", "ok");
        /* the insert's RETURNING is the row as inserted; the office's appointment is decided after it, so read it back */
        return loadOffice(code).then(function () {
          var a = OFF.apps.filter(function (x) { return x.id === id; })[0];
          if (a && a.status === "approved") S2.toast((nominee ? nominee.tag : "The nominee") + " is seated as " + SEAT_NAME[s] + ".", "ok");
          else S2.toast("Filed, but not seated: " + (a ? a.seat_block || a.status : "its status could not be read back") + ". Check the nomination.", "err");
        });
      }, function (e2) { b.disabled = false; err(e2.message); });
    });
  }
  function removeLive(code, s) {
    var p = seatsOf(code)[s];
    if (!p || s === "Owner") return;
    if (!isOwnerish()) return S2.toast("Only the club's Owner removes a General Manager or Assistant General Manager (Rule 2.6).", "err");
    S2.confirm({ open: function (o) { o.back = ['[data-act="seat-nominate"][data-seat="' + s + '"]', '[data-act="seat-remove"][data-seat="' + s + '"]']; return sheet(o); },
      title: "Remove " + p.tag + " as " + SEAT_NAME[s] + "?", danger: true, ok: "Remove", cancel: "Keep " + p.tag,
      why: [p.tag + " keeps their roster spot, position and number. Only the seat ends: their cap figure becomes the league minimum unless the seat paid more (Rule 2.6).",
        "It takes effect at once, the move posts to the transaction wire, and the league office is told. No vote is needed to remove a manager."],
      html: '<p class="hqx-err" role="alert"></p>',
      onOk: function (sh) {
        var ok = S2.$('[data-cf="ok"]', sh.el); ok.disabled = true; S2.$(".hqx-err", sh.el).textContent = "";
        S2.write("owner_remove_manager", { p_team_code: code, p_role: s.toLowerCase() }, { sections: ["teams", "rosters"], repaint: function () { reloadOffice(code); refreshAll(); } }).then(function () {
          sh.close(); S2.toast(p.tag + " is no longer the " + SEAT_NAME[s] + ".", "ok");
        }, function (e) { ok.disabled = false; S2.$(".hqx-err", sh.el).textContent = e.message; });
        return false;   /* the sheet stays until the database answers */
      } });
  }
  function withdrawNomLive(code, id) {
    var a = OFF.apps.filter(function (x) { return x.id === id; })[0]; if (!a) return;
    S2.confirm({ open: function (o) { o.back = ['[data-act="seat-nominate"][data-seat="' + a.role.toUpperCase() + '"]']; return sheet(o); },
      title: "Withdraw this nomination?", ok: "Withdraw", cancel: "Keep it",
      why: tagOf(a.nominee_id, a.nominee) + "'s nomination as " + SEAT_NAME[a.role.toUpperCase()] + " is withdrawn and the league office stops voting on it.",
      html: '<p class="hqx-err" role="alert"></p>',
      onOk: function (sh) {
        var ok = S2.$('[data-cf="ok"]', sh.el); ok.disabled = true;
        S2.write("management_applications.update", { set: { status: "withdrawn", updated_at: new Date().toISOString() }, match: { id: id } }, { repaint: function () { reloadOffice(code); } }).then(function () {
          sh.close(); S2.toast("Nomination withdrawn", "ok");
        }, function (e) { ok.disabled = false; S2.$(".hqx-err", sh.el).textContent = e.message; });
        return false;
      } });
  }
  /* what the club sees of its own nominations: every one it can read, newest first, with the league office's answer */
  var APP_STATE = { pending: ["warn", "Waiting for the vote"], approved: ["win", "Approved"], denied: ["loss", "Denied"], withdrawn: ["", "Withdrawn"] };
  function nomsLive(code) {
    var wait = offWait(code); if (wait) return head({ k: "Nominations", size: "d-2 sec-h-sm", h: "Nominations" }) + wait;
    var list = OFF.apps;
    return head({ k: "Nominations · Rule 2.6", size: "d-2 sec-h-sm", h: list.length ? plural(list.length, "nomination") : "No nominations yet",
        p: "Each General Manager and Assistant General Manager nomination this club has filed, and the league office's answer. A nominee is seated the moment the vote approves them; a seat that is still held is never filled over (Rule 2.6)." }) +
      (list.length ? '<div class="list hqx-list">' + list.map(function (a) {
        var st = APP_STATE[a.status] || ["", a.status];
        return '<div class="row hqx-ap"><span class="grow"><span class="title">' + esc(tagOf(a.nominee_id, a.nominee) + ", " + (SEAT_NAME[String(a.role).toUpperCase()] || a.role)) + "</span>" +
          '<span class="sub">' + esc("Filed " + M.etDateTime(a.created_at) + (a.decided_at ? " · decided " + M.etDateTime(a.decided_at) : "")) + "</span>" +
          (a.seat_block ? '<span class="t-foot">' + esc("Held up: " + a.seat_block) + "</span>" : "") + (a.response ? '<span class="t-foot hqx-reply">' + esc(a.response) + "</span>" : "") + "</span>" +
          '<span class="hqx-ap-done">' + tag(st[0], st[1]) + "</span></div>";
      }).join("") + "</div>" : "");
  }

  /* ---- the approval queue (Rule 2.6): an Owner or the league office decides every pending move; a GM or AGM sees their
     own and may withdraw it. Approving runs the move through the league's usual checks at once (mgmt_decide_move); a
     move that can no longer be made comes back failed, with the reason, and nothing half happens ---- */
  var MGMT_PAGES = [
    ["roster", "Roster", "Waivers and trade-block listings", true],
    ["lines", "Lineups", "The lineup for each game", true],
    ["schedule", "Game nights", "Server picks for each game", true],
    ["tradehub", "Trades", "Propose, accept, decline and withdraw trades", true],
    ["freeagents", "Waivers", "Claims on players other clubs waived. A claim cannot wait for approval, so under Owner approves only the Owner claims", true],
    ["draft", "Draft", "The club's draft board and its picks on the clock", true],
    ["management", "Front office", "This tab: the Owner's alone unless opened. Opening it lets a manager read the seats, the queue and these settings", false]
  ];
  function pageLabel(pg) { return (MGMT_PAGES.filter(function (x) { return x[0] === pg; })[0] || [pg, pg])[1]; }
  function livePending(code) {
    if (!offReady(code)) return [];
    var me_ = S2.session && S2.session.profileId;
    return OFF.pend.filter(function (m) { return isOwnerish() || m.requested_by === me_; });
  }
  var MV_STATE = { pending: ["warn", "Waiting"], approved: ["win", "Approved"], denied: ["", "Denied"], withdrawn: ["", "Withdrawn"], failed: ["loss", "Could not be made"] };
  function moveRow(code, m, act) {
    var se = seatsOf(code), seat = se.GM && se.GM.id === m.requested_by ? "GM" : se.AGM && se.AGM.id === m.requested_by ? "AGM" : "";
    var st = MV_STATE[m.status] || ["", m.status], me_ = S2.session && S2.session.profileId;
    var btns = !act || m.status !== "pending" || ro() ? "" : isOwnerish()
      ? '<span class="hqx-ap-b"><button type="button" class="btn sm" data-act="mv-decide" data-v="1" data-id="' + esc(m.id) + '">Approve</button><button type="button" class="btn secondary sm" data-act="mv-decide" data-v="0" data-id="' + esc(m.id) + '">Deny</button></span>'
      : m.requested_by === me_ ? '<span class="hqx-ap-b"><button type="button" class="btn plain sm" data-act="mv-withdraw" data-id="' + esc(m.id) + '">Withdraw</button></span>' : "";
    return '<div class="row hqx-ap hqx-mv" data-mv="' + esc(m.id) + '"><span class="grow"><span class="title">' + esc(m.summary || "A move") + "</span>" +
      '<span class="sub">' + esc([tagOf(m.requested_by, m.requester) + (seat ? ", " + seat : ""), pageLabel(m.page), agoAt(m.status === "pending" || !m.decided_at ? m.created_at : m.decided_at)].join(" · ")) + "</span>" +
      (m.status === "failed" && m.result ? '<span class="t-foot hqx-bad">' + esc(m.result) + "</span>" : m.note ? '<span class="t-foot">' + esc("Note: " + m.note) + "</span>" : "") + "</span>" +
      (btns || '<span class="hqx-ap-done">' + tag(st[0], st[1]) + "</span>") + "</div>";
  }
  function approvalsLive(code) {
    var wait = offWait(code), boss = isOwnerish(), me_ = S2.session && S2.session.profileId;
    if (wait) return head({ size: "d-2 sec-h-sm", k: "Approvals · Rule 2.6", h: "Approvals" }) + wait;
    var pend = livePending(code), recent = OFF.recent.filter(function (m) { return boss || m.requested_by === me_; });
    return head({ size: "d-2 sec-h-sm", k: "Approvals · Rule 2.6", h: pend.length ? plural(pend.length, "move") + " waiting for " + (boss ? "you" : "the Owner") : "Nothing waiting",
        p: boss ? "When you set a page to Owner approves, your General Manager's and Assistant General Manager's moves on it wait here. Approving makes the move at once, through the league's usual checks; denying tells them why." :
          /* QA visual 37 (2026-11-25): the GM never sees the Owner's "set a page to Owner approves", so "a page" is said here */
          "When the Owner sets a page of moves to Owner approves, your moves there wait here until they decide, and you are told either way (Rule 2.6)." }) +
      (pend.length ? '<div class="list hqx-list hqx-approvals">' + pend.map(function (m) { return moveRow(code, m, true); }).join("") + "</div>" : "") +
      (recent.length ? '<h4 class="hqx-group-h">Recent decisions <span class="num">' + recent.length + '</span></h4><div class="list hqx-list">' + recent.map(function (m) { return moveRow(code, m, false); }).join("") + "</div>" : "");
  }
  function decideLive(code, id, approve) {
    var m = OFF.pend.filter(function (x) { return x.id === id; })[0]; if (!m) return S2.toast("That move is no longer waiting.", "err");
    var sh = sheet({ title: (approve ? "Approve: " : "Deny: ") + (m.summary || "this move"), back: ['[data-act="mv-decide"][data-id="' + id + '"][data-v="' + (approve ? 1 : 0) + '"]'], html: '<div class="hqx-rev">' +
      '<p class="t-sub">' + (approve ? "The move is made the moment you approve it, through the league's usual checks. If it can no longer be made, you both see why." : "Nothing changes, and your manager is told.") + "</p>" +
      '<div class="field"><label for="hqxDecNote">Note to your manager (optional)</label><input class="input" id="hqxDecNote" maxlength="200" autocomplete="off" placeholder="' + (approve ? "Go ahead" : "Not this week") + '" data-autofocus></div>' +
      '<p class="hqx-err" role="alert"></p><div class="hqx-actions"><button type="button" class="btn' + (approve ? "" : " danger") + '" data-x="go">' + (approve ? "Approve and make it" : "Deny") + '</button><button type="button" class="btn secondary" data-x="keep">Cancel</button></div></div>' });
    pinFoot(sh);
    sh.el.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-x]"); if (!b) return;
      if (b.dataset.x === "keep") return sh.close();
      var note = (S2.$("#hqxDecNote", sh.el).value || "").trim() || null;
      b.disabled = true; S2.$(".hqx-err", sh.el).textContent = "";
      /* an approved move can change the roster (a waiver, a block listing, a trade), so the rosters are read again */
      S2.write("mgmt_decide_move", { p_id: id, p_approve: approve, p_note: note }, { sections: ["rosters"], repaint: function () { reloadOffice(code); refreshAll(); } }).then(function (res) {
        var d = (res && res.data) || {};
        sh.close();
        if (d.status === "failed") S2.toast("Approved, but it could not be made: " + (d.error || d.result || "the league's checks refused it"), "err");
        else S2.toast(approve ? "Approved. The move is made." : "Denied. Your manager has been told.", "ok");
      }, function (e2) { b.disabled = false; S2.$(".hqx-err", sh.el).textContent = e2.message; });
    });
  }
  function withdrawMoveLive(code, id) {
    S2.confirm({ open: function (o) { o.back = ['[data-act="mv-withdraw"][data-id="' + id + '"]']; return sheet(o); },
      title: "Withdraw this move?", why: "It comes off the Owner's queue and nothing changes.", ok: "Withdraw", cancel: "Keep it", html: '<p class="hqx-err" role="alert"></p>',
      onOk: function (sh) {
        var ok = S2.$('[data-cf="ok"]', sh.el); ok.disabled = true;
        S2.write("mgmt_withdraw_move", { p_id: id }, { repaint: function () { reloadOffice(code); } }).then(function () { sh.close(); S2.toast("Move withdrawn", "ok"); },
          function (e) { ok.disabled = false; S2.$(".hqx-err", sh.el).textContent = e.message; });
        return false;
      } });
  }

  /* ---- the Owner's permissions (v2.38): per page and per seat, full access, Owner approves or hidden; only cells off
     the default are stored (set_team_mgmt_policy). Edits stay in this widget until Save; unsaved edits hold every
     automatic repaint (S2.holds), and Discard puts the saved settings back ---- */
  var MODES = [["full", "Full access"], ["approve", "Owner approves"], ["hidden", "Hidden"]];
  var PERM = { code: null, base: null, draft: null, said: "" };
  function permFrom(pol) {
    var o = {};
    ["gm", "agm"].forEach(function (s) { o[s] = {}; MGMT_PAGES.forEach(function (pg) {
      var m = ((pol || {})[s] || {})[pg[0]] || defMode(pg[0]);
      if (["full", "approve", "hidden"].indexOf(m) < 0 || (!pg[3] && m === "approve")) m = pg[3] ? defMode(pg[0]) : "full";
      o[s][pg[0]] = m; }); });
    return o;
  }
  function permDirty() { return !!(PERM.draft && PERM.base) && JSON.stringify(PERM.draft) !== JSON.stringify(PERM.base); }
  (S2.holds = S2.holds || []).push(function () { return permDirty() && !!S2.$('[data-w="perms"]'); });
  function permsLive(code) {
    var wait = offWait(code), boss = isOwnerish() && !ro(), held = seatsOf(code);   /* an archive shows the policy, never its editor */
    if (wait) return head({ k: "Permissions · Rule 2.6", size: "d-2 sec-h-sm", h: "Permissions" }) + wait;
    if (PERM.code !== code || !permDirty()) { PERM.code = code; PERM.base = permFrom(OFF.policy); PERM.draft = JSON.parse(JSON.stringify(PERM.base)); }
    var seats = [["gm", "GM", "General Manager"], ["agm", "AGM", "Assistant GM"]];
    var cell = function (sd, pg) {
      var mode = PERM.draft[sd[0]][pg[0]], word = (MODES.filter(function (x) { return x[0] === mode; })[0] || [mode, mode])[1];
      if (!boss) return '<td>' + tag(mode === "full" ? "win" : mode === "approve" ? "warn" : "", word) + "</td>";
      return '<td><div class="seg hqx-perm-seg" role="group" data-perm-seat="' + sd[0] + '" data-perm-page="' + pg[0] + '" aria-label="' + esc(sd[2] + ", " + pg[1]) + '">' +
        MODES.filter(function (md) { return pg[3] || md[0] !== "approve"; }).map(function (md) { return '<button type="button" data-v="' + md[0] + '" aria-pressed="' + (mode === md[0]) + '">' + esc(md[1]) + "</button>"; }).join("") + "</div></td>";
    };
    return head({ k: "Permissions · Rule 2.6", size: "d-2 sec-h-sm", h: boss ? "What your managers may do" : "What the Owner lets each seat do",
        p: "For every Team HQ page each seat has full access, Owner approves (the seat sees the page and every move on it waits for the Owner), or hidden (the page is withheld and its moves are refused). Everything starts at full access except Front office, which only the Owner sees unless it is opened. When the Owner seat changes hands these settings return to the defaults. The Owner's own seat is never limited, and the league office keeps its powers either way (Rule 2.6)." }) +
      '<div class="tbl-wrap hqx-perm-wrap"><table class="tbl hqx-perm"><caption class="sr">Permissions by page and seat</caption><thead><tr><th scope="col">Page</th>' +
        seats.map(function (sd) { var h = held[sd[1]]; return '<th scope="col">' + esc(sd[2]) + '<span class="t-foot">' + esc(h ? h.tag : "Vacant: applies when seated") + "</span></th>"; }).join("") + "</tr></thead><tbody>" +
        MGMT_PAGES.map(function (pg) { return '<tr><th scope="row"><span class="title">' + esc(pg[1]) + '</span><span class="t-foot">' + esc(pg[2]) + "</span></th>" + seats.map(function (sd) { return cell(sd, pg); }).join("") + "</tr>"; }).join("") +
      "</tbody></table></div>" +
      (boss ? '<div class="hqx-actions hqx-perm-a"><button type="button" class="btn" data-act="perm-save"' + (permDirty() ? "" : " disabled") + '>Save permissions</button><button type="button" class="btn secondary" data-act="perm-reset"' + (permDirty() ? "" : " disabled") + ">Discard changes</button>" +
        '<span class="t-foot" data-perm-status aria-live="polite">' + esc(PERM.said || (permDirty() ? "Unsaved changes." : OFF.policyAt ? "Last saved " + agoAt(OFF.policyAt) + "." : "Defaults: full access everywhere, and Front office is yours alone.")) + "</span></div>" : "");
  }
  /* repaint the editor and wire its segmented cells: a press changes the draft and the Save line, never the table */
  function paintPerms(code) {
    S2.$$('[data-w="perms"]').forEach(function (el) { keep(el, function () { el.innerHTML = permsLive(code); }); bindPerms(el); });
  }
  function bindPerms(root) {
    S2.$$(".hqx-perm-seg", root).forEach(function (el) {
      S2.segmented(el, function (v) { PERM.draft[el.dataset.permSeat][el.dataset.permPage] = v; PERM.said = ""; permLine(); });
    });
  }
  function permLine() {
    var d = permDirty();
    S2.$$('[data-act="perm-save"], [data-act="perm-reset"]').forEach(function (b) { b.disabled = !d; });
    S2.$$("[data-perm-status]").forEach(function (s) { s.textContent = PERM.said || (d ? "Unsaved changes." : "No changes."); });
  }
  function savePerms(code, btn) {
    if (!permDirty()) return;
    var draft = JSON.parse(JSON.stringify(PERM.draft)), se = seatsOf(code), seated = !!(se.GM || se.AGM);
    btn.disabled = true; PERM.said = "Saving…"; permLine(); btn.disabled = true;
    S2.write("set_team_mgmt_policy", { p_team_code: code, p_policy: draft }, { repaint: function () { reloadOffice(code); } }).then(function (res) {
      OFF.policy = (res && res.data) || draft; PERM.base = permFrom(OFF.policy); PERM.draft = JSON.parse(JSON.stringify(PERM.base));
      PERM.said = seated ? "Saved just now. Your managers have been told." : "Saved just now. It applies the moment a manager is seated.";
      paintPerms(code); S2.toast(seated ? "Permissions saved. Your managers have been told." : "Permissions saved", "ok");
    }, function (e) { PERM.said = "Not saved: " + e.message; permLine(); });
  }

  /* ---- club notices: what the league posts about this club in its own Discord room and to its front office
     (club_notify, v2.42: signings, waivers, claims, completed trades, squad and roster moves, trade-block listings). Trade
     offers, declines and withdrawals go to the front office alone and never into the room (v3.35, Rule 2.3) ---- */
  function noticesLive(code) {
    var wait = offWait(code); if (wait) return head({ k: "Club notices", size: "d-2 sec-h-sm", h: "Club notices" }) + wait;
    var list = OFF.notices;
    return head({ k: "Club notices · front office", size: "d-2 sec-h-sm", h: list.length ? (list.length === 20 ? "The newest 20 notices" : plural(list.length, "notice")) : "No club notices yet",
        p: "Every roster move, waiver, claim, completed trade and trade-block listing, as the league posts it in " + esc(team(code).city) + "'s own Discord room and tells its front office. Trade offers, declines and withdrawals stay with the front office and are never posted there: only a completed trade is public (Rule 2.3)." }) +
      (list.length ? '<div class="list hqx-list">' + list.map(function (n) {
        return '<div class="row hqx-ap hqx-cn"><span class="grow"><span class="title">' + esc(n.title || "Club notice") + "</span>" + (n.body ? '<span class="sub">' + esc(n.body) + "</span>" : "") +
          '<span class="t-foot">' + esc(agoAt(n.created_at)) + "</span></span>" + '<span class="hqx-ap-done">' + tag(n.posted_at ? "" : "warn", n.posted_at ? "In the club room" : "Not posted yet") + "</span></div>";
      }).join("") + "</div>" : "");
  }
  function paneOffice(code) {
    loadOffice(code);   /* the records come in after the first paint and repaint their widgets in place */
    return '<div class="hqx-stack"><section class="hqx-block" data-w="approvals">' + approvalsLive(code) + "</section>" +
      '<section class="hqx-block" data-w="seats">' + seatsLive(code) + "</section>" +
      '<section class="hqx-block" data-w="perms">' + permsLive(code) + "</section>" +
      '<section class="hqx-block" data-w="noms">' + nomsLive(code) + "</section>" +
      '<section class="hqx-block" data-w="notices">' + noticesLive(code) + "</section>" +
      about("Every record here is the league's own: the seats, the Owner's settings, the approval queue, the nominations and the club notices, read as you (each seat reads what the league lets it). Nothing is shown as done until the league confirms it.") + "</div>";
  }

  /* ---- trade offers (Rule 2.3): the classic Trade Hub's doors (CG.acceptTrade, CG.declineTrade, CG.cancelTrade). An
     offer is private to the two front offices and the league office; accepting completes the trade at once and posts it
     to the transaction wire, the only part of a trade that is public. Each door is queued for the Owner when the seat's
     Trades page is set to Owner approves (accept_trade's own mgmt_gate; the trades table's trigger for a decline or a
     withdrawal, named trade_decline and trade_cancel). Counter and the full reading open the trade page (stream e4) once
     it reads live offers; until then they are not offered here ---- */
  var TR_STATE = { proposed: ["warn", "Open"], accepted: ["win", "Accepted"], declined: ["loss", "Declined"], cancelled: ["", "Withdrawn"], reversed: ["", "Reversed"] };
  function tagsOf(ids) { return (ids || []).map(function (id) { return tagOf(id); }).join(", ") || "nobody"; }
  function picksOf(ids) { return ids && ids.length ? " and " + plural(ids.length, "draft pick") : ""; }
  function trRow(code, x) {
    var tid = tidOf(code), inn = x.to_team_id === tid, them = idCode(inn ? x.from_team_id : x.to_team_id), st = TR_STATE[x.status] || ["", x.status];
    var get = inn ? tagsOf(x.offered_profile_ids) + picksOf(x.offered_pick_ids) : tagsOf(x.requested_profile_ids) + picksOf(x.requested_pick_ids);
    var give = inn ? tagsOf(x.requested_profile_ids) + picksOf(x.requested_pick_ids) : tagsOf(x.offered_profile_ids) + picksOf(x.offered_pick_ids);
    var open = x.status === "proposed", b = function (v, label, cls) { return '<button type="button" class="btn ' + (cls || "secondary") + ' sm" data-act="tr-' + v + '" data-id="' + esc(x.id) + '">' + label + "</button>"; };
    return '<div class="row hqx-ap hqx-off" data-tr="' + esc(x.id) + '">' + (them ? M.crest(them) : "") + '<span class="grow"><span class="title">' + esc((inn ? "From the " : "To the ") + (them ? team(them).full : "another club")) + "</span>" +
      '<span class="sub"><b class="hqx-ink">You get</b> ' + esc(get) + '</span><span class="sub"><b class="hqx-ink">You send</b> ' + esc(give) + "</span>" +
      (x.note ? '<span class="t-foot hqx-reply">' + esc(x.note) + "</span>" : "") + '<span class="t-foot">' + esc(agoAt(open ? x.created_at : x.updated_at || x.created_at)) + "</span></span>" +
      (open && !ro() ? '<span class="hqx-ap-b">' + (inn ? b("accept", "Accept", " ") + b("decline", "Decline") : b("withdraw", "Withdraw")) + "</span>" : '<span class="hqx-ap-done">' + tag(st[0], st[1]) + (ro() ? "" : officeAct(x, b)) + "</span>") + "</div>";
  }
  /* gaps (2026-11-25): the league office's doors on an answered offer, as the classic Transactions desk offers them (Send
     back on a completed trade, Resend on a declined or withdrawn offer), through the site's one reversal and resend doors
     (js/flows.js S2.reverseTrade, S2.resendTrade). Shown to a reader the league calls staff or a commissioner (a display
     hint: reverse_trade and resend_trade decide) */
  function officeAct(x, b) {
    if (!S2.session || !(S2.session.isStaff || S2.session.isCommissioner)) return "";
    return x.status === "accepted" ? b("reverse", "Reverse") : x.status === "declined" || x.status === "cancelled" ? b("resend", "Resend") : "";
  }
  function officeTrade(code, id, v) {
    var x = OFF.answered.filter(function (y) { return y.id === id; })[0]; if (!x) return S2.toast("That offer is no longer on this page. Reload it and try again.", "err");
    var from = idCode(x.from_team_id), to = idCode(x.to_team_id), fn = function (c) { return c ? team(c).full : "another club"; };
    var done = function () { reloadOffice(code); refreshAll(); };
    if (v === "reverse") return S2.reverseTrade(id, { text: "The trade between the " + fn(from) + " and the " + fn(to) + ".", done: done });
    return S2.resendTrade(id, { text: "The " + fn(from) + " offer to the " + fn(to) + ".", to: fn(to), done: done });
  }
  function offersLive(code) {
    var wait = offWait(code), tid = tidOf(code);
    var side = ro() ? "" : '<button type="button" class="btn" data-flow="trade" data-club="' + esc(code) + '">Build a trade</button>';
    if (wait) return head({ k: "Trade Hub", h: "Trade offers", side: side }) + wait;
    var inn = OFF.open.filter(function (x) { return x.to_team_id === tid; }), out = OFF.open.filter(function (x) { return x.from_team_id === tid; });
    var grp = function (h, list, none) { return '<div class="hqx-tgrp"><h4 class="hqx-group-h">' + esc(h) + ' <span class="num">' + list.length + "</span></h4>" +
      (list.length ? '<div class="list hqx-list">' + list.map(function (x) { return trRow(code, x); }).join("") + "</div>" : '<p class="t-sub hqx-led-none">' + esc(none) + "</p>") + "</div>"; };
    return head({ k: "Trade Hub · Rule 2.3", h: inn.length ? plural(inn.length, "offer") + " waiting for your answer" : "No offers waiting for you",
        p: "An offer is private to the two front offices and the league office. Nothing moves until the club that received it accepts, and the roster and cap checks run again then (Rule 2.3).", side: side }) +
      grp("Received", inn, "Nothing waiting. A club's offer for your players lands here.") + grp("Sent", out, "No open offers. Build a trade to send one.") +
      (OFF.answered.length ? grp("Answered", OFF.answered, "") : "");
  }
  /* one door for the three answers: the database decides, the sheet waits for it and shows its words */
  function tradeAnswer(code, id, v) {
    var x = OFF.open.filter(function (y) { return y.id === id; })[0]; if (!x) return S2.toast("That offer is no longer open.", "err");
    var them = idCode(x.to_team_id === tidOf(code) ? x.from_team_id : x.to_team_id), name = them ? team(them).full : "the other club";
    var o = { accept: { title: "Accept this trade?", ok: "Accept the trade", why: ["The players change hands at once and the trade posts to the league's transaction log, the only part of a trade that is public. The roster and cap checks run again now (Rules 2.3 and S2.4)."] },
      decline: { title: "Decline this offer?", ok: "Decline", why: ["Nothing moves. Only the two clubs and the league office ever see the offer (Rule 2.3)."] },
      withdraw: { title: "Withdraw your offer?", ok: "Withdraw", why: ["Nothing moves, and the " + name + " can no longer accept it."] } }[v];
    S2.confirm({ open: function (q) { q.back = ['[data-act="tr-' + v + '"][data-id="' + id + '"]', '[data-w="troffers"] [data-flow="trade"]']; return sheet(q); },
      title: o.title, ok: o.ok, cancel: "Not now", danger: v !== "accept", why: o.why, html: '<p class="hqx-err" role="alert"></p>',
      onOk: function (sh) {
        var ok = S2.$('[data-cf="ok"]', sh.el); ok.disabled = true; S2.$(".hqx-err", sh.el).textContent = "";
        var w = v === "accept" ? S2.write("accept_trade", { p_trade: id }, { approval: "owner", sections: ["rosters"], repaint: function () { reloadOffice(code); refreshAll(); } })
          : S2.write("trades.update", { set: { status: v === "decline" ? "declined" : "cancelled", updated_at: new Date().toISOString() }, match: { id: id } },
            { approval: "owner", action: v === "decline" ? "trade_decline" : "trade_cancel", queueArgs: { p_trade: id }, repaint: function () { reloadOffice(code); } });
        w.then(function (res) {
          sh.close();
          S2.toast(res && res.queued ? "Sent to the Owner for approval." : v === "accept" ? "Trade completed. Both rosters are updated." : v === "decline" ? "Offer declined." : "Offer withdrawn. Nothing moved.", "ok");
        }, function (e) { ok.disabled = false; S2.$(".hqx-err", sh.el).textContent = e.message; });
        return false;
      } });
  }

  /* ---- players' trade requests (Rule 2.3): the classic club view (CG.hubClubRequests and CG.actionCard's club mode, v3.76
     and v4.32). A request comes to the club's Owner, GM and AGM and to nobody else; the league office neither receives
     nor rules on it. A seat replies (action_messages.insert, never a staff-only note) or answers it for good, Resolve or
     Deny, with the final decision statement the player reads on the request (action_requests.update status and response
     together: guard_decision_statement refuses one without the other; Rule 1.4). The live site has no door to reopen an
     answered request, so none is offered; a player's own reply is how it opens again ---- */
  var RQ_STATE = { resolved: ["win", "Resolved"], denied: ["", "Denied"] };
  function rqOpen(a) { return a.status !== "resolved" && a.status !== "denied"; }
  function reqsLive(code) {
    var k = "Trade requests · private", wait = offWait(code); if (wait) return head({ k: k, h: "Trade requests" }) + wait;
    var all = OFF.reqs, open = all.filter(rqOpen).length, me_ = S2.session && S2.session.profileId;
    return head({ k: k, h: open ? plural(open, "player") + (open === 1 ? " has" : " have") + " asked to be traded" : "No open trade requests",
        p: "A player's request comes to the Owner, GM and AGM and to nobody else. The league office neither receives it nor rules on it, and the club is under no obligation to act on it. Resolving or denying one takes a final decision statement, which the player reads on the request (Rules 1.4 and 2.3)." }) +
      (all.length ? '<div class="list hqx-list">' + all.map(function (a) {
        var st = RQ_STATE[a.status] || ["", a.status], msgs = (OFF.msgs[a.id] || []).filter(function (m) { return !m.deleted_at; });
        return '<div class="row hqx-ap hqx-req" data-rq="' + esc(a.id) + '"><span class="grow"><span class="title">' + esc(tagOf(a.profile_id, a.filer)) + '</span><span class="sub">' + esc(a.details || a.subject || "") + "</span>" +
          msgs.map(function (m) { return '<span class="t-foot hqx-reply">' + esc((m.author_id === me_ ? "You" : tagOf(m.author_id, m.author)) + ": " + m.body) + "</span>"; }).join("") +
          (a.response ? '<span class="t-foot hqx-reply">' + esc("Decision: " + a.response) + "</span>" : "") + '<span class="t-foot">' + esc(agoAt(a.created_at)) + "</span></span>" +
          (rqOpen(a) && !ro() ? '<span class="hqx-ap-b"><button type="button" class="btn secondary sm" data-act="rq-reply" data-id="' + esc(a.id) + '">Reply</button><button type="button" class="btn sm" data-act="rq" data-v="resolved" data-id="' + esc(a.id) + '">Resolve</button><button type="button" class="btn secondary sm" data-act="rq" data-v="denied" data-id="' + esc(a.id) + '">Deny</button></span>'
            : '<span class="hqx-ap-done">' + tag(st[0], st[1]) + "</span>") + "</div>";
      }).join("") + "</div>" : '<p class="t-sub hqx-led-none">A request from one of your players lands here, and every seat in the front office is told.</p>');
  }
  /* one sheet for a reply and for a decision: the text is kept on a refusal, and nothing reads as sent until the league confirms it */
  function reqSheet(code, id, v) {
    var a = OFF.reqs.filter(function (x) { return x.id === id; })[0]; if (!a) return S2.toast("That request is no longer on file.", "err");
    var who = tagOf(a.profile_id, a.filer), reply = v === "reply";
    var sh = sheet({ title: reply ? "Reply to " + who : (v === "resolved" ? "Resolve " : "Deny ") + who + "'s request", back: ['[data-act="' + (reply ? "rq-reply" : "rq") + '"][data-id="' + id + '"]' + (reply ? "" : '[data-v="' + v + '"]')],
      html: '<div class="hqx-rev"><p class="t-sub">' + (reply ? "The exchange stays private to " + esc(who) + " and your front office (Rule 2.3)." : "Your final decision statement: " + esc(who) + " reads it on the request and in the notice that tells them. It closes the request (Rules 1.4 and 2.3).") + "</p>" +
        '<div class="field"><label for="hqxRq">' + (reply ? "Your reply" : "Decision statement") + '</label><textarea class="input" id="hqxRq" rows="4" maxlength="2000" data-autofocus></textarea></div><p class="hqx-err" role="alert"></p>' +
        '<div class="hqx-actions"><button type="button" class="btn' + (v === "denied" ? " danger" : "") + '" data-x="go">' + (reply ? "Send reply" : v === "resolved" ? "Resolve" : "Deny") + '</button><button type="button" class="btn secondary" data-x="keep">Cancel</button></div></div>' });
    pinFoot(sh);
    var err = function (m) { S2.$(".hqx-err", sh.el).textContent = m; };
    sh.el.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-x]"); if (!b || b.disabled) return;
      if (b.dataset.x === "keep") return sh.close();
      var txt = (S2.$("#hqxRq", sh.el).value || "").trim();
      if (!txt) return err(reply ? "Write a reply first." : "Write the decision statement first: a request is never answered without one (Rule 1.4).");
      b.disabled = true; err("");
      var w = reply ? S2.write("action_messages.insert", { row: { request_id: id, author_id: S2.session.profileId, body: txt, internal: false } }, { repaint: function () { reloadOffice(code); } })
        : S2.write("action_requests.update", { set: { status: v, response: txt, updated_at: new Date().toISOString() }, match: { id: id } }, { repaint: function () { reloadOffice(code); } });
      w.then(function () {
        sh.close();
        S2.toast(reply ? "Reply sent. Only " + who + " and your front office see it." : "Request " + v + ". " + who + " reads your statement on the request.", "ok");
      }, function (e2) { b.disabled = false; err(e2.code === "S2_NO_ROWS" ? "Nothing changed: the league did not let this seat answer that request." : e2.message); });
    });
  }

  /* ---- roster moves that remain in Season 2. Club camps, call-ups and send-downs are gone (Rule S2.5), and so are direct
     signings (no free agency in Season 2): neither door is offered. The trade block is the classic CG.setOnBlock door
     (roster_spots.on_block, the one column a client may write, roster-delete-door-v426), queued for the Owner when the
     seat's Roster page is set to Owner approves. Waivers and claims are the market's (stream b4; waiveLive, claimDoor) ---- */
  function blockLive(p, on, done) {
    /* e1 review, 2026-11-24: the database has NO guard for this (protect_manager_spot refuses only a delete or a team
       change; the block gate, the deadline guard and the rest never read a seat), and notify_trade_block posts the
       listing in #trade-block. So this door refuses a manager here, before anything is sent, as the classic site hides
       its door (part6_hub.js "Management contract, protected"). Taking a listed manager off stays open: it corrects */
    var seat = seatHeld(p), ae = archErr();
    if (ae) return done(ae);
    if (on && seat) return done(new Error(p.tag + " holds the " + seat + " seat. An Owner, GM or AGM can't be put on the trade block (Rule 2.6)."));
    var sid = seasonSettings().id;
    if (!sid) return done(new Error("The season on screen has no id in the league data, so the trade block can't be changed here."));
    S2.write("roster_spots.update", { set: { on_block: !!on }, match: { season_id: sid, profile_id: p.id } },
      { approval: "owner", action: "roster_block", queueArgs: { p_profile: p.id, on_block: !!on }, summary: (on ? "put " : "take ") + p.tag + (on ? " on" : " off") + " the trade block",
        sections: ["rosters"], repaint: function () { refreshAll(); } }).then(function (res) { done(null, res); }, function (e) { done(e); });
  }
  function blockSaid(p, on, res) {
    return res && res.queued ? "Sent to the Owner for approval: " + (on ? "put " : "take ") + p.tag + (on ? " on" : " off") + " the trade block."
      : on ? p.tag + " is on the trade block. Every front office sees the listing." : p.tag + " is off the trade block.";
  }
  /* the hand-off to the market's one waive door (stream b4, js/market.js S2.market.waiveDoor): its popup is the
     ruled confirm (the club cannot reclaim the player until they clear waivers and become available in Saturday bidding,
     2026-11-23) with the not-inactive box, and it stays open with the database's sentence on a refusal. It resolves once,
     made or closed; this page says the outcome and repaints the roster widgets in place */
  function waiveLive(p) {
    var K = S2.market, ae = archErr();
    if (ae) return S2.toast(ae.message, "err");
    if (!K || typeof K.waiveDoor !== "function") { console.error("[hq] S2.market.waiveDoor is not on the page: the market (js/market.js, stream b4) owns the live waiver"); return S2.toast("Waivers can't be placed from this page yet. Nothing was changed.", "err"); }
    mkAnswer(K.waiveDoor(p.id), function (r) {
      if (!r.ok) return;   /* closed: the popup itself said any refusal while it was open */
      refreshAll();
      S2.toast(r.queued ? "Sent to the Owner for approval: put " + p.tag + " on waivers." : p.tag + " is on waivers. Any other club with an open spot and the cap room may claim them for 24 hours (Rule S2.5).", "ok");
    });
  }
  /* ---- Game nights: the club's server picks for the night (Rule 4.2), frozen with the code release; S2.lobby is the
     one model, shared with the Game Center ---- */
  function serversInner(code) {
    var n = curNight(byNight(weekGames(code))), L = S2.lobby; if (!n || !L || ro()) return "";
    var rel = L.releaseAt(n.games[0]), frozen = now() >= rel, at = nb(M.etTime(new Date(rel).toISOString()) + " ET");
    /* QA round 2 (2026-11-25): a picks read the league refused was said once in a toast and then drawn as "Not named" on
       every select, and a pick made over that blank sent the other half of the side as nothing, over the pick on file. The
       lobby keeps the refusal (S2.lobby.pickErr); until a read lands no select is drawn, and Try again reads the night
       again (S2.lobby.retryPicks) */
    var perr = !frozen && L.pickErr ? L.pickErr() : null;
    /* plain words first and the database's words after them, as You's readSaid says a refused read (QA round 2 nit,
       2026-11-25: the block opened on "permission denied for table game_vetoes").
       shortcut: the pattern is written here and in you.js readSaid; fold both into core's shared helper once core adds it */
    if (perr) return head({ k: "Servers · " + esc(n.label), h: "Picks freeze at " + esc(at) }) +
      S2.empty("err", "Your server picks could not be read", "The league did not answer as expected. The league said: " + esc(String(perr).replace(/[.\s]+$/, "")) + ". Nothing was changed. Read them again before you pick.",
        '<button type="button" class="btn secondary sm" data-act="srv-retry" data-g="' + esc(n.games[0].id) + '">Try again</button>');
    var opts = function (cur, none) { return [["", none]].concat(L.SERVERS.map(function (s) { return [s, s]; })).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (cur === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join(""); };
    var gname = function (g) { return (g.home === code ? "vs " : "at ") + team(opp(g, code)).city + " " + g.time; };
    var sel = function (g, side, key, label, cur, none) {
      return '<label class="hqx-srv-f"><span class="t-foot">' + label + '</span><select class="input" data-srv="' + esc(g.id) + '" data-side="' + side + '" data-key="' + key + '" aria-label="' + esc(label + ", " + gname(g)) + '">' + opts(cur, none) + "</select></label>";
    };
    return head({ k: "Servers · " + esc(n.label), h: frozen ? "Settled for the night" : "Picks freeze at " + esc(at),
        p: "At home you name a first and a second choice; away, one server you will not play on and, if you like, one you prefer. Each club's picks are its own until " + esc(at) + ", when the night settles and its codes go out (Rule 4.2). With nothing named, the game is on " + L.STANDARD + "." }) +
      '<div class="list hqx-list hqx-srv">' + n.games.map(function (g) {
        var home = g.home === code, pk = L.picks(g), st = L.settle(g);
        return '<div class="row hqx-srv-r"><span class="hqx-srv-g">' + M.crest(opp(g, code)) + '<span class="title">' + (home ? "vs " : "at ") + esc(team(opp(g, code)).city) + '</span><span class="t-foot num">' + esc(g.time) + "</span></span>" +
          (frozen ? '<span class="grow hqx-srv-s"><span class="title">' + esc(st.server) + '</span><span class="sub">' + esc(st.why.charAt(0).toUpperCase() + st.why.slice(1)) + " · code " + esc(L.code(g)) + "</span></span>"
            : '<span class="hqx-srv-c">' + (home ? sel(g, "home", "first", "First choice", pk.home.first, "Not named") + sel(g, "home", "second", "Second choice", pk.home.second, "Not named")
              : sel(g, "away", "veto", "Veto", pk.away.veto, "No veto") + sel(g, "away", "prefer", "Preferred", pk.away.prefer, "No preference")) + "</span>") + "</div>";
      }).join("") + "</div>";
  }
  /* the lobby read the club's picks again (js/lobby.js fires "s2:lobby", e2's hand-over 2026-11-24): the servers block
     repaints in place, never under a select in use (a native list would close under the finger); the field's focusout
     runs the repaint it owes */
  var SRV_OWED = false;
  function paintServers() {
    if (!S2.$('[data-w="servers"]')) { SRV_OWED = false; return; }
    var a = document.activeElement;
    if (a && a.dataset && a.dataset.srv) { SRV_OWED = true; return; }
    if (SRV_OWED) { SRV_OWED = false; repaint("servers", function () { return serversInner(club()); }); }
  }
  document.addEventListener("s2:lobby", function () { SRV_OWED = true; paintServers(); });
  /* an archive says so at the head of Team HQ, with the way to the current season's */
  function archBanner() {
    var ae = archErr(); if (!ae) return "";
    return '<div class="hqx-banner hqx-ro" role="note">' + S2.ic("lock") + '<span class="grow">' + esc(ae.shown.charAt(0).toUpperCase() + ae.shown.slice(1) + ": Team HQ is read only here. Its tools act on " + ae.season + ".") + "</span>" +
      '<a class="btn sm hqx-ghostbtn" href="' + esc(S2.seasonHref(null, "#/hq")) + '">Open ' + esc(ae.season) + "</a></div>";
  }
  function hqHtml(r) {
    var code = club(), t = M.team(code), st = standing(code), rv = rosterView(code);
    if (!t || !rv) return '<div class="page-head hqx-head"><h1 class="d-1">Team HQ</h1></div>' + empty("No club to show", "Team HQ opens for the club whose front office you sit in.");
    loadOffice(code);   /* the front office's records arrive after this paint and repaint their widgets in place */
    /* the market is read when a page asks (js/market.js ensure); Team HQ never asked, so a front office that came straight
       here drew its Bidding tab, bid board and cap room from no read at all (QA round 2, 2026-11-25). Its answer repaints
       the market's widgets in place (the market listener below) */
    /* a commissioner's preview club is the market's acting club too (b4's S2.market.setClub), so the Bidding tab, the cap
       card and a claim all read the club on screen, and this device remembers it (setClub). It goes first: setClub's own
       read is the one ensure then waits on (QA round 2 nit, 2026-11-25: ensure first read the old club, then setClub
       queued a second read) */
    if (S2.has("commish")) setClub(code);
    if (S2.market && S2.market.ensure) S2.market.ensure();
    return frame("hq", r, hqTabs(!offReady(code) ? r.q.tab : null), {
      /* QA worst 9 (2026-11-25): teams.color is nullable, and a club without one drew "--club: ;--club-ink: #fff", white type
         on the light canvas; every other club band falls back to the ink band, as this one does now. QA round 2 A4: the
         band is core's S2.clubBand, which also spells a short hex out ("#c00" kept its color only there) */
      title: "Team HQ", kicker: esc(t.full), band: S2.clubBand(t),
      sub: "Lineups, availability and the cap sheet, open only to the club's Owner, GM and AGM (Rule 2.6)." +
        /* each piece is one unit, so a phone breaks only at a middot (review 2026-10-20: "EAST" sat alone on a line) */
        recLine(st),
      /* the crest sits on a white medallion: on its own club color a mark like Detroit's wheel disappears */
      art: '<a class="hqx-medal" href="' + esc(t.href) + '" aria-label="' + esc(t.full) + ' club page">' + M.crest(code, "xl") + "</a>",
      banner: archBanner() + (S2.has("commish") ? '<div class="hqx-banner">' + S2.ic("eye") + '<span class="grow">Viewing ' + esc(t.city) + ' as its Owner, with full control.</span><button class="btn sm hqx-ghostbtn" data-act="view-as">Change club</button></div>' : ""),
      /* the nav lists only working sections (review 2026-10-19: a "Planned" menu of dead rows read as broken navigation);
         the trade forms live in Trades, and Saturday bidding opens from Roster & cap */
      meta: hqMeta(code),
      pane: function (tab) { return (TAB_PAGE[tab] ? '<div data-w="apnote">' + approveNote(code, tab) + "</div>" : "") +
        ({ overview: paneOverview, roster: paneRoster, trades: paneTrades, bidding: paneBidding, lineups: paneLineups, nights: paneNights, office: paneOffice })[tab](code); }
    });
  }

  /* ---- Overview: the next night on an ink match-center panel, then cap room and the playoff picture side by side,
     approvals, and lineup readiness ---- */
  function paneOverview(code) {
    return '<div class="hqx-stack"><div data-w="next">' + nextInner(code) + "</div>" +
      '<div class="hqx-two"><div data-w="cap">' + capCard(code, true) + "</div>" + playoffSec(code) + "</div>" +
      '<section class="hqx-block" data-w="approvals">' + approvalsLive(code) + "</section>" +
      '<section class="hqx-block" data-w="ovtrades">' + ovTradesInner(code) + "</section>" +
      '<section class="hqx-block" data-w="forfeits">' + forfeitInner(code) + "</section>" +
      '<div data-w="ready">' + readyInner(code) + "</div>" +
      about("Every figure here is the league's own record, read as you: the schedule, the lineups on file, the availability answers, the cap, the standings, the forfeits, the approval queue and the trade offers. Nothing is shown as done until the league confirms it.") + "</div>";
  }
  function nextInner(code) {
    var n = byNight(weekGames(code))[0];
    if (!n) return empty("No games ahead", "The next night appears here once the schedule has one.");
    var t = now(), first = n.games.filter(function (g) { return lockState(g, t) === "open"; })[0], filed = n.games.filter(function (g) { return luOf(code, g).filed; }).length;
    return '<section class="hqx-mc"' + inkAttrs() + ' aria-label="Next night, ' + esc(n.label) + '"><div class="hqx-ink-h">' + dateBlock(n.games[0].at) +
        '<div class="hqx-ink-copy"><span class="kicker">Next night · Week ' + n.games[0].week + '</span><h3 class="d-2">' + esc(plural(n.games.length, "game") + ", " + plural(filed, "sheet") + " filed") + "</h3></div>" +
        '<div class="hqx-cd">' + (first ? cd(lockOf(first).lock, "Locked", "d-num") + "<span>until the first lineup locks</span>" : '<b class="d-num">Locked</b><span>every lineup has locked</span>') + "</div></div>" +
      '<div class="hqx-plan-l">' + n.games.map(function (g) { return planRow(code, g, t); }).join("") + "</div>" +
      '<div class="hqx-ink-f">' + arrow("Plan the night", "#/hq?tab=lineups") + "</div></section>";
  }
  /* QA visual 15, worst 1, function 16 (2026-11-25): a season's standings count from its first final. Before it every club
     is 0-0-0 and a rank, a magic number or "0 games left" is a tiebreak among zeros (Team HQ read "3rd in the East" and
     "Magic number 1" before Season 2 had a schedule), so the head names the puck drop and the race waits for a final */
  function decided(st) { return !!st && st.w + st.l + st.otl > 0; }
  function startAt() { var c = M.view.empty.finals ? cal(M.view.season, "starts_at") : null; return c ? M.etLong(c.at) : null; }
  function recLine(st) {
    if (decided(st)) return '<span class="hqx-rec num">' + esc([rec(st), st.pts + " points", ord(st.div_rank) + " in the " + st.division].map(nb).join(" · ")) + "</span>";
    var go = startAt();
    return go ? '<span class="hqx-rec num">' + esc([M.view.name + " starts", go].map(nb).join(" ")) + "</span>" : "";
  }
  function playoffSec(code) {
    var st = standing(code), leftG = clubGames(code).filter(function (g) { return g.state === "upcoming"; }).length; if (!st) return "";
    if (M.view.empty.finals) return '<section class="hqx-block">' + head({ k: "Playoff picture", size: "d-2 sec-h-sm", h: "The race starts at puck drop",
        p: esc("No club has played yet, so no club holds a place: the standings count from the first final." + (startAt() ? " " + M.view.name + " starts " + startAt() + "." : "") + " The top 3 in each division make the playoffs."), go: ["The race", "#/standings?view=race"] }) + "</section>";
    return '<section class="hqx-block">' + head({ k: "Playoff picture", size: "d-2 sec-h-sm", h: esc(ord(st.div_rank) + " in the " + st.division),
        p: esc(st.pts + " points, " + rec(st) + ". " + (st.clinched ? "Playoff spot clinched." : st.eliminated ? "Eliminated from the playoffs." : "Magic number " + st.magic + ": points " + team(code).city + " gains plus points the closest chaser drops.") +
          " " + plural(leftG, "game") + " left; the top 3 in each division make the playoffs."), go: ["The race", "#/standings?view=race"] }) +
      form(st.last5) + "</section>";
  }
  /* form reads oldest first in small squares, as on Standings (league.js form()) and the club page; st.last5 comes
     newest first, so it is reversed here. Its own class (review 2026-10-20): it was .hqx-form, the edit sheet's class, and
     its flex row squeezed that sheet's select and textarea into one line */
  function form(last5) {
    var a = (last5 || []).slice().reverse(), name = { W: "Win", L: "Loss", OT: "Overtime loss", OTL: "Overtime loss" };
    if (!a.length) return "";   /* no decided game: no caption over an empty row (QA visual 15) */
    return '<div class="hqx-last5"><span class="hqx-last5-m" role="img" aria-label="Last five, oldest first: ' + esc(a.map(function (x) { return name[x] || x; }).join(", ")) + '">' +
      a.map(function (x) { return '<i class="' + (x === "W" ? "w" : x === "L" ? "l" : "o") + '"></i>'; }).join("") + '</span><span class="t-foot" aria-hidden="true">Last five, oldest first</span></div>';
  }
  function readyInner(code) {
    var n = byNight(weekGames(code))[0], rv = rosterView(code), wk = weekGames(code); if (!n || !rv) return "";
    var filed = n.games.filter(function (g) { return luOf(code, g).filed; }).length, all = rv.pro.length;
    var answered = rv.pro.filter(function (p) { return wk.every(function (g) { return availOf(p, g); }); }).length;
    var ice = n.games.filter(function (g) { return canIce(code, g).ok; }).length;
    var bar = function (label, a, b, note) { return '<div class="hqx-ready-r"><div class="hqx-ready-t"><span class="hqx-ink">' + esc(label) + '</span><span class="num hqx-b">' + a + ' <span class="t-foot">of ' + b + "</span></span></div>" +
      '<div class="hqx-meter"><i style="width:' + (a / Math.max(1, b) * 100).toFixed(1) + '%"></i></div>' + (note ? '<span class="t-foot">' + esc(note) + "</span>" : "") + "</div>"; };
    return '<section class="hqx-block">' + head({ size: "d-2 sec-h-sm", k: "Lineup readiness", h: esc(ice + " of " + plural(n.games.length, "game") + " can ice a lineup"),
        p: "From the players who said Available: three forwards, two defense and a goaltender for each game." }) +
      '<div class="hqx-bars">' + bar("Sheets filed for " + n.short.split(",")[0], filed, n.games.length, "Each sheet locks 30 minutes before its puck drop (Rule 5.3)") +
      bar("Games with enough available players", ice, n.games.length, "") +
      bar("Players who answered every game this week", answered, all, "Availability is due " + stamp(dueOf(wk)) + " (Rule 5.1)") + "</div></section>";
  }
  function canIce(code, g) {
    var r = M.roster(code), n = { F: 0, D: 0, G: 0 };
    (r ? r.active : []).forEach(function (p) { if (availOf(p, g) === "yes" && p.unit) n[p.unit]++; });
    return { n: n, ok: n.F >= 3 && n.D >= 2 && n.G >= 1 };
  }
  /* No-show forfeits, for the club's own management (commissioner, 2026-11-02: "I would like the team management to know how
     many of their own club games have been no-show forfeits."). A no-show forfeit is a forfeit with no box score: the
     game was never played (the forfeits that kept their box were played, then decided). Voided games are out. Rule 3.2's
     thresholds count every forfeit of the season, box or not, so the meter reads all of them: the league's results, read
     again by the pulse after a ruling at the Game desk */
  function noShows(code) {
    var ff = clubGames(code).filter(function (g) { return g.forfeit && !g.voided; }), mine = function (g) { return g.forfeit === code || g.forfeit === "both"; };
    var list = ff.filter(function (g) { return !g.hasBox; });
    return { list: list, own: list.filter(mine), them: list.filter(function (g) { return g.forfeit !== code; }), total: ff.filter(mine).length };
  }
  var FF_REVIEW = 10, FF_REMOVE = 16;   /* Rule 3.2: ten refer the club for review (Chapter 7); sixteen are grounds to remove management */
  function forfeitInner(code) {
    var f = noShows(code), t = team(code), n = f.list.length, a = f.own.length, b = f.them.length, N = Math.max(FF_REMOVE, f.total), cells = [];
    for (var i = 1; i <= N; i++) cells.push('<i class="' + (i <= f.total ? "on" : "") + (i >= FF_REMOVE ? " rm" : i >= FF_REVIEW ? " rv" : "") + '"></i>');
    /* QA visual 35, worst 20 (2026-11-25): before the club's first game nothing has gone ahead or failed to, so the block
       names the rule and claims nothing (it read "Every game Pittsburgh was due to play so far went ahead") */
    if (!clubGames(code).some(function (g) { return g.state !== "upcoming" && g.state !== "voided"; })) return head({ size: "d-2 sec-h-sm", k: "Forfeits · Rule 3.2", h: "No games played yet",
      p: esc("A no-show forfeit is a forfeit with no box score: nobody played. Every forfeit of the season counts toward Rule 3.2: ten refer a club to the league office for review under Chapter 7, and sixteen are grounds to remove its management.") }) +
      '<div data-noshow="0" data-own="0" data-them="0"></div>';
    var h = n ? plural(n, "no-show forfeit") + " in " + t.city + " games" : "Not one no-show forfeit in " + t.city + " games";
    var p = !n ? "Every game " + t.city + " was due to play so far went ahead, or was decided after it was played." :
      a && b ? t.city + " did not show for " + a + " of them; its opponents did not show for " + b + "." :
      a ? (n === 1 ? t.city + " was the club that did not show." : t.city + " was the club that did not show, every time.") :
      (n === 1 ? "It was the opponent that did not show; " : "Each time it was the opponent that did not show; ") + t.city + " was there.";
    var thr = f.total >= FF_REMOVE ? "That reaches the sixteen that are grounds to remove a club's management, which the league staff decide." : f.total >= FF_REVIEW ? "That reaches the ten that refer a club to the league office for review under Chapter 7; sixteen are grounds to remove its management." :
      plural(FF_REVIEW - f.total, "more forfeit") + " would refer " + t.city + " to the league office for review under Chapter 7; sixteen are grounds to remove its management.";
    return head({ size: "d-2 sec-h-sm", k: "Forfeits · Rule 3.2", h: esc(h), p: esc(p + " A no-show forfeit is a forfeit with no box score: nobody played.") }) +
      (n ? '<div class="list hqx-list hqx-ffl" data-noshow="' + n + '" data-own="' + a + '" data-them="' + b + '">' + f.list.map(function (g) {
        var own = g.forfeit === code || g.forfeit === "both", res = g.winner === code ? "W" : "L";
        return '<a class="row hqx-lg hqx-ff" href="' + esc(g.href) + '">' + mark(res) + M.crest(opp(g, code)) +
          /* who did not show rides the date line, so a phone keeps the opponent's name whole */
          '<span class="grow"><span class="title">' + esc(vs(g, code)) + '</span><span class="sub hqx-ff-s"><span>' + esc(g.date) + "</span>" + tag(own ? "loss" : "", g.forfeit === "both" ? "Neither club showed" : own ? "Your no-show" : "Their no-show") + "</span></span>" + S2.chev() + "</a>";
      }).join("") + "</div>" : '<div data-noshow="0" data-own="0" data-them="0"></div>') +
      '<div class="hqx-ffm"><p class="hqx-ffm-t"><b class="d-num" data-fftotal="' + f.total + '">' + f.total + '</b><span class="t-sub">' + esc((f.total === 1 ? "forfeit" : "forfeits") + " by " + t.city + " this season, every kind counted. " + thr) + "</span></p>" +
        '<div class="hqx-ffm-g" style="--n:' + N + '"><div class="hqx-ffm-c" role="img" aria-label="' + esc(f.total + " of " + FF_REMOVE + " forfeits; ten refer the club for review, sixteen are grounds to remove its management") + '">' + cells.join("") + "</div>" +
          '<span class="hqx-ffm-k" style="grid-column:' + FF_REVIEW + '">' + FF_REVIEW + " · Review</span>" + '<span class="hqx-ffm-k rm" style="grid-column:' + FF_REMOVE + '">' + FF_REMOVE + " · Management</span></div></div>";
  }
  /* half: the Overview's half column takes the small headline; full width (Roster & cap) keeps the pane's d-2. Season 2
     figures come from the one definition, S2.market.clubState (the lead's reading 9: "Season 2 payroll for bidding and
     claims = the club's ACTIVE roster salaries (in Season 2 there are no club camps)"), so this card, the Bidding tab, the
     bid room and the claim sheet say the same cap room (review 2026-11-02: three different numbers for Detroit) */
  function capCard(code, half) {
    var cs = S2.market && S2.market.clubState(code);
    if (!cs) return empty("No cap figures", "The Season 2 market did not load, so there is no cap room to show. The console names the error.");
    var cap = cs.cap, act = cs.payroll, room = cs.room, w = function (v) { return (Math.max(0, v) / Math.max(1, cap) * 100).toFixed(2) + "%"; };
    return '<section class="hqx-block hqx-cap">' + head({ k: "Season 2 salary cap · " + money(cap), size: half ? "d-2 sec-h-sm" : "d-2", h: esc(money(Math.abs(room)) + (room < 0 ? " over the cap" : " of cap room")),
        p: "Season 2 cap room: " + esc(money(cap)) + " less the active roster. Front-office seats count, and Season 2 has no club camps (Rule S2.5)." }) +
      '<div class="hqx-capbar" role="img" aria-label="Active roster ' + money(act) + ", room " + money(room) + '"><span class="a c-pct" style="--p:' + w(act) + ';width:var(--p)"></span></div>' +
      '<div class="hqx-legend"><span><i class="a"></i>Active roster <b class="num">' + money(act) + '</b></span><span><i class="c"></i>Room <b class="num' + (room < 0 ? " hqx-bad" : "") + '">' + money(room) + "</b></span></div></section>";
  }

  /* ---- Roster & cap: the cap, the ledger in rink order, the S2 twelve-player gauge with the S2.4 minimums (3 F / 2 D / 1 G since 2026-11-23), the rules in force ---- */
  /* Season 2 view (2026-11-02): the Season 1 Rule 2.1 composition card and its squad freeze went with the club camps.
     Its 7 F / 5 D / 3 G maximums flagged legal claims and bid signings as violations (review: "8 of 7 Forwards" in red),
     so the Season 1 figures now sit in About this data, labeled with their date, and nothing live is measured by them */
  function paneRoster(code) {
    return '<div class="hqx-stack"><div data-w="cap">' + capCard(code) + "</div>" + '<div data-w="ledger">' + ledgerInner(code) + "</div>" + gaugeCard(code) +
      about("The roster, salaries, seats and games played are the league's own records for " + esc(M.view.name) + ". The playoff floor counts regular-season games at each player's signed-up position group (Rules 8.3 and S2.7). The league's lineup check has the final word on who may play a playoff game.") + "</div>";
  }
  /* Rule S2.4 (v4.52, commissioner 2026-11-17: "Keep the roster size at 12 for the full season"): one limit from the draft
     through the playoffs, so the gauge has no before and after the draft any more (its Before/After switch went with it) */
  function gaugeCard(code) {
    var s2 = M.RULES.s2;
    return '<section class="hqx-block hqx-gaugecard">' + head({ k: "Rule S2.4", h: s2.limit + " players all season",
        p: "At least " + s2.min.F + " forwards, " + s2.min.D + " defense and " + s2.min.G + " goaltender from the draft on, measured against the active roster. Season 2 rosters are built at the draft, " + esc(calText(2, "draft_at")) +
          ": the Owner and GM are seated before it and " + s2.draftRounds + " rounds follow (Rule S2.3); the AGM is then named from the club's own roster (Rule 2.6)." }) +
      '<div data-w="gauge">' + gaugeInner(code) + "</div>" +
      /* the Season 2 moves that fill these limits: the trade page and the club's bid board (Bidding) */
      (ro() ? "" : '<div class="hqx-actions"><button type="button" class="btn secondary sm" data-flow="trade" data-club="' + code + '">Build a trade</button><a class="btn secondary sm" href="#/hq?tab=bidding">Saturday bidding</a></div>') + "</section>";
  }
  function gaugeInner(code) {
    var cs = S2.market && S2.market.clubState(code), s2 = M.RULES.s2, lim = s2.limit, n = cs ? cs.active : rosterView(code).n.pro, cells = [], N = Math.max(lim, n.total);
    ["F", "D", "G"].forEach(function (u) { for (var i = 0; i < n[u]; i++) cells.push(u); });
    while (cells.length < N) cells.push("");
    var over = Math.max(0, n.total - lim), mins = s2.min, live = minsInForce();
    return '<div class="hqx-gauge" style="--n:' + N + '"><div class="hqx-cells" role="img" aria-label="' + n.total + " players against a limit of " + lim + '">' + cells.map(function (u, i) { return '<i class="hqx-cell ' + u + (u && i >= lim ? " over" : "") + '"></i>'; }).join("") + "</div>" +
        '<span class="hqx-mark" data-lim="' + lim + '"><span class="t-foot num">Limit ' + lim + "</span></span></div>" +
      '<p class="hqx-gauge-t"><b class="d-num' + (over ? " hqx-bad" : "") + '">' + n.total + '</b> <span class="t-sub">' + (over ? "on the active roster, " + over + " over the " + lim + "-player limit" : "on the active roster, within the " + lim + "-player limit") + "</span></p>" +
      '<div class="hqx-mins">' + [["F", "Forwards"], ["D", "Defense"], ["G", "Goaltenders"]].map(function (u) {
        var ok = n[u[0]] >= mins[u[0]];
        return '<div class="hqx-min ' + (!live ? "pre" : ok ? "ok" : "short") + '"><span class="hqx-min-n"><span class="hqx-key ' + u[0] + '" aria-hidden="true"></span><b class="d-num">' + n[u[0]] + '</b></span><span class="t-foot hqx-min-l"><span>' + u[1] + "</span> <span>Minimum " + mins[u[0]] + "</span>" + (live ? "" : " <span>From the draft on</span>") + "</span>" +
          (live ? '<span class="hqx-min-i">' + S2.ic(ok ? "check" : "x") + '<span class="sr">' + (ok ? "meets the minimum" : "below the minimum") + "</span></span>" : "") + "</div>";
      }).join("") + "</div>";
  }
  /* the limit marker sits after the limit's cell; it sprang between 12 and 15 until v4.52 made the limit one number, so it
     is placed now, never moved */
  function placeMark(root) {
    S2.$$(".hqx-gauge", root).forEach(function (g) {
      var mk = S2.$(".hqx-mark", g), c = S2.$$(".hqx-cell", g)[+mk.dataset.lim - 1]; if (!c) return;
      mk.style.transform = "translateX(" + (c.offsetLeft + c.offsetWidth + 1) + "px)";
    });
  }
  function ledgerInner(code) {
    var rv = rosterView(code), sec = function (h, list, note, foot) {
      /* the group name and the column labels share one caps line (review 2026-10-20: a separate "# PLAYER PLAYOFF FLOOR
         SALARY" line sat on top of "ACTIVE ROSTER 15"); a phone shows the group name alone */
      return '<section class="hqx-led-sec"><div class="hqx-led-h"><h4 class="hqx-group-h">' + esc(h) + ' <span class="num">' + list.length + "</span></h4>" +
        (list.length ? '<span class="hqx-led-col" aria-hidden="true">Playoff floor</span><span class="hqx-led-col" aria-hidden="true">Salary</span>' : "") + "</div>" +
        (list.length ? (foot ? '<p class="t-foot hqx-led-note">' + esc(foot) + "</p>" : "") + '<div class="list hqx-list">' + list.map(ledgerRow).join("") + "</div>" : '<p class="t-sub hqx-led-none">' + esc(note) + "</p>") + "</section>";
    };
    /* Season 2 has no club camps (Rule S2.5): the ledger is the active roster */
    return '<section class="hqx-block">' + head({ k: "The roster", h: esc(plural(rv.n.pro.total, "player") + " on the active roster"),
        p: "Rink order, then number. Each player's bar counts regular-season games at their signed-up position group against the playoff floor; * marks a floor prorated for a late placement. Tap a player for waivers or the trade block." }) +
      sec("Active roster", rv.pro, "No one on the active roster.") + "</section>";
  }
  function ledgerRow(p) {
    var fl = floorOf(p), v = fl.floor ? Math.min(1, fl.gp / fl.floor) : 1, done = fl.gp >= fl.floor;
    return '<button class="row hqx-led" data-act="player" data-pid="' + p.id + '"><span class="hqx-num d-num">' + (p.num != null ? p.num : "–") + "</span>" +
      '<span class="hqx-led-main"><span class="hqx-led-name"><span class="title hqx-led-tag" title="' + esc(p.tag) + '">' + esc(p.tag) + "</span>" + (seatHeld(p) ? tag("accent", seatHeld(p)) : "") + "</span>" +
      '<span class="sub">' + esc(p.posName) + (p.ovr ? " · " + p.ovr.ovr + " OVR" + (p.ovr.provisional ? " (provisional)" : "") : " · no rating yet") + "</span></span>" +
      '<span class="hqx-led-floor"><span class="hqx-mini' + (done ? " done" : "") + '"><i style="width:' + (v * 100).toFixed(1) + '%"></i></span><span class="t-foot num">' + (fl.floor ? fl.gp + "/" + fl.floor + (fl.prorated ? "*" : "") : "No floor") + "</span></span>" +
      '<span class="hqx-led-sal num">' + money(p.salary) + "</span>" + S2.chev() + "</button>";
  }
  /* the player sheet: every row does something. Season 2 has no club camps (commissioner, 2026-11-02: "Rostered players
     can be sent down to the league training camps only after being placed on waivers"), so Call up and Send to training
     camp are gone (review 2026-11-02: a one-click send-down put an active player in the pool with no waiver, under the
     S2.4 minimums, and a call-up took a pool player off a running lot). The block and Waive are the league's doors, Trade
     opens the trade page; a manager's seat is a hard rule, said in place */
  function playerSheet(pid) {
    var p = M.player(pid); if (!p) return;
    var code = club(), fl = floorOf(p), seat = seatHeld(p);
    var row = function (x, title, sub) { return '<button class="row" data-x="' + x + '"><span class="grow"><span class="title">' + esc(title) + '</span><span class="sub">' + esc(sub) + "</span></span>" + S2.chev() + "</button>"; };
    var body =
      '<dl class="spec hqx-spec4">' + [["Position", p.posName], ["Games", p.gp], ["Playoff floor", fl.floor ? fl.gp + " of " + fl.floor + atGroup(fl) + (fl.prorated ? "*" : "") : "None"], ["Salary", money(p.salary)]].map(function (c) { return "<div><dt>" + esc(c[0]) + '</dt><dd class="num">' + esc(c[1]) + "</dd></div>"; }).join("") + "</dl>" +
      (fl.prorated ? '<p class="t-foot">*Prorated: placed ' + esc(fl.since) + " with " + fl.leftAtPlacement + " of " + fl.total + " games left.</p>" : "") +
      '<div class="list hqx-list"><a class="row" href="' + esc(p.href) + '"><span class="grow title">Open profile</span>' + S2.chev() + "</a>" +
        (ro() ? "" : row("block", p.onBlock ? "Take off the trade block" : "Put on the trade block", seat ? "Holds the " + seat + " seat, so they can't be listed (Rule 2.6)" + (p.onBlock ? "; taking them off is open" : "") : p.onBlock ? "Listed: every front office sees it (Rule 2.3)" : "A listing is public to every front office (Rule 2.3)") +
        row("trade", "Trade", seat ? "Holds the " + seat + " seat: a manager can't be traded (Rule 2.6)" : "Open until the Season 2 movement deadline, " + calText(2, "movement_deadline_fixed") + " (Rule 2.4)") +
        row("waive", "Put on waivers", seat ? "Holds the " + seat + " seat: a manager can't be waived (Rule 2.6)" : "Season 2: 24 hours of claims, then the training camp pool (Rule S2.5)")) + "</div>" +
      (ro() ? '<p class="hqx-fine">' + esc(archErr().message) + "</p>" : "");
    var sh = sheet({ title: (p.num != null ? "#" + p.num + " " : "") + p.tag, back: ['[data-act="player"][data-pid="' + pid + '"]'], html: '<div class="hqx-ps">' + body + '<p class="hqx-err" role="alert"></p></div>' });
    closeOnLinks(sh);
    var say = function (t) { S2.$(".hqx-err", sh.el).textContent = t; };
    sh.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-x]"); if (!b) return;
      var x = b.dataset.x;
      /* the league's door, queued for the Owner when the seat's Roster page is set to Owner approves. blockLive refuses a
         seat holder before anything is sent (the database does not); the database refuses a listing past the movement
         deadline, in its own words */
      if (x === "block") { var want = !p.onBlock; b.disabled = true; return blockLive(p, want, function (e, res) { b.disabled = false; if (e) return say(e.message); sh.close(); S2.toast(blockSaid(p, want, res), "ok"); }); }
      if (seat) return say(x === "trade" ? p.tag + " holds the " + seat + " seat. An Owner, GM or AGM can't be traded (Rule 2.6)." : p.tag + " holds the " + seat + " seat. Management cannot be waived or traded (Rule 2.6).");
      sh.close();
      if (x === "waive") return waiveLive(p);
      if (x === "trade") return tradeFrom(code, p);
    });
  }
  function texts(ps) { return (ps || []).map(function (x) { return x.text; }); }
  /* a market action answers with a Promise (b4, js/market.js: "a page wraps a call in Promise.resolve(...).then"); then(r)
     gets { ok, problems, queued }, and a rejection is said as a refusal, never dropped */
  function mkAnswer(r, then) {
    Promise.resolve(r).then(function (x) { then(x && typeof x === "object" ? x : { ok: false, problems: [{ text: "The market did not answer.", hard: true }] }); },
      function (e) { then({ ok: false, problems: [{ text: (e && e.message) || String(e), hard: true }] }); });
  }
  /* straight to the trade page, as Trades' "Build a trade" goes (audit 2026-11-09: one door, no deadline question of its
     own; the database refuses a trade past the movement deadline in its own words) */
  function tradeFrom(code, p) { S2.flow("trade", { club: code, player: p.id }); }
  /* the one claim door (Team HQ's board and the waiver list; the profile calls it as S2.claimDoor): the claiming club is
     the acting club. First come, first served; the claiming club needs an open spot and the cap room (the lead's
     readings 1 and 2); a claim of the club's own waiver is refused, and a commissioner (full control, v3.76) may claim for
     another club instead. market_claim through b4's S2.market.claim: nothing reads as claimed until the database
     confirms it, and every refusal is said in the sheet in the league's words */
  function claimDoor(pid, asClub) {
    var K = S2.market, w = K && K.waiver(pid), p = M.player(pid), ae = archErr();
    if (ae) return S2.toast(ae.message, "err");
    if (!S2.has("office")) return S2.locked({ title: "Claim " + (p ? p.tag : "a player") + " off waivers", who: "A club's front office: its Owner, GM and AGM",
      why: "Any club other than the one that placed a player on waivers may claim them within 24 hours, at the salary they carried, if it has an open roster spot and room under the cap (Rule S2.5)." });
    if (!w || !w.claimable) return S2.toast(!w ? (p ? p.tag : "That player") + " is not on waivers." : w.claimedBy ? "The " + team(w.claimedBy).full + " claimed " + w.tag + " first. The first claim wins (Rule S2.5)." : w.tag + "'s 24 hours on waivers ran out, so they joined the training camp pool (Rule S2.5).", "err");
    var code = asClub || club(), own = w.from === code, cs = K.clubState(code), fits = cs.freeSpots > 0 && cs.freeRoom >= w.salary;
    /* another club's figures are its spots and Season 2 cap room BEFORE the bids it leads: net of leads, the gap named the
       leader of a running lot (review 2026-11-02), and the bidding clubs stay hidden until a lot is over (Rule S2.6). The
       claim itself still counts the leads, and its refusal says so */
    var others = M.teams.filter(function (t) { return t.code !== w.from; }).map(function (t) { var s = K.clubState(t.code); return { t: t, s: s, ok: s.spots > 0 && s.room >= w.salary }; });
    var sh = sheet({ title: "Claim " + w.tag, back: ['[data-act="claim"][data-pid="' + pid + '"]'], html: '<div class="hqx-offer hqx-cl">' +
      '<p class="t-body">' + esc(w.tag) + " is on waivers from the " + esc(team(w.from).full) + " until " + esc(stamp(w.until)) + ". The first club to claim them takes them at once, at their " + esc(money(w.salary)) + " salary, onto its active roster (Rule S2.5).</p>" +
      (own ? '<p class="t-body hqx-ink">The ' + esc(team(code).full) + " placed " + esc(w.tag) + " on waivers, so it cannot claim them back; it may bid on them once they clear waivers and become available in Saturday bidding (Rules S2.5 and S2.6).</p>" +
          (S2.has("commish") ? '<h4 class="hqx-group-h">Claim for another club</h4><div class="list hqx-list">' + others.map(function (o) {
            return '<button class="row" data-x="as" data-v="' + o.t.code + '">' + M.crest(o.t.code) + '<span class="grow"><span class="title">' + esc(o.t.full) + '</span><span class="sub">' + esc(plural(o.s.spots, "open spot") + " · " + money(o.s.room) + " of cap room") + "</span></span>" + (o.ok ? "" : tag("warn", "Short")) + S2.chev() + "</button>"; }).join("") + "</div>" : "") :
        '<dl class="spec hqx-spec4">' + [["Salary", money(w.salary)], ["Your open spots", cs.freeSpots + " of " + cs.limit], ["Your cap room", money(cs.freeRoom)], ["Time left", left(w.left)]].map(function (c) { return "<div><dt>" + esc(c[0]) + '</dt><dd class="num">' + esc(c[1]) + "</dd></div>"; }).join("") + "</dl>" +
          (fits ? "" : '<p class="t-sub">' + esc(cs.freeSpots < 1 ? "The " + team(code).full + (/s$/.test(team(code).full) ? "'" : "'s") + " active roster has no open spot. A claim needs one, so it waits on a waiver of your own." : "The salary is more than your Season 2 cap room, the " + M.money(M.RULES.s2.cap) + " cap less the active roster.") + "</p>")) +
      '<p class="hqx-err" role="alert"></p><div class="hqx-actions">' + (own ? "" : '<button class="btn" data-x="claim" data-autofocus>Claim at ' + esc(money(w.salary)) + "</button>") + '<button class="btn secondary" data-x="keep">' + (own ? "Close" : "Not now") + "</button></div></div>" });
    pinFoot(sh);
    var say = function (t) { S2.$(".hqx-err", sh.el).textContent = t; };
    var run = function (c, btn) {
      if (btn.disabled) return;
      btn.disabled = true; say("");
      mkAnswer(K.claim(pid, { club: c }), function (r) {
        btn.disabled = false;
        if (!r.ok) return say(texts(r.problems).join(" "));
        sh.close(); refreshAll();
        S2.toast(w.tag + " is claimed for the " + team(c).full + " at " + money(w.salary) + ", onto the active roster (Rule S2.5).", "ok");   /* a claim is never queued for the Owner (client-api.md) */
      });
    };
    sh.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-x]"); if (!b) return;
      var x = b.dataset.x;
      if (x === "keep") return sh.close();
      if (x === "claim") return run(code, b);
      if (x === "as") return run(b.dataset.v, b);
    });
  }
  S2.claimDoor = claimDoor;
  /* every widget that reads rosters, offers or the block repaints in place; each repaint is a no-op when absent */
  function refreshAll() {
    var code = club(), p = me();
    repaint("ledger", function () { return ledgerInner(code); });
    repaintCap(code);
    repaint("grid", gridInner); repaint("gridh", function () { return gridHead(code); });
    repaintTrades();
    afterLineupChange();
    if (p && S2.$('[data-w="due"]')) repaint("due", function () { return dueInner(p); });
    repaint("forfeits", function () { return forfeitInner(code); });   /* a Game desk ruling changes M.games in place */
    repaintBidding();
    paintOffice(code);   /* the seats read the rosters the write just read again */
  }
  /* the cap card and the S2.4 gauge read the market (S2.market.clubState, and M.draftDone for the minimums), so a market
     read repaints them too */
  function repaintCap(code) {
    repaint("cap", function () { return capCard(code, !!S2.$('.hqx-two > [data-w="cap"]')); }); repaint("gauge", function () { return gaugeInner(code); });
    if (S2.$(".hqx-gauge")) placeMark(document);
  }
  /* a new alert (a move sent for the Owner's approval, a decision, a seat change) may change the front office: read it
     again while Team HQ is on screen (loadOffice keeps it to one read in four seconds) */
  S2.live.on("notifs", function () { if (S2.$('.hqx[data-ws="hq"]')) loadOffice(club()); });
  function repaintTrades() {
    var code = club();
    repaint("troffers", function () { return offersLive(code); }); repaint("ovtrades", function () { return ovTradesInner(code); });
    repaint("treqs", function () { return reqsLive(code); }); repaint("tblockh", function () { return blockHead(code); });
    repaint("tblock", function () { return blockInner(code); });
    refreshNav();
  }
  /* the market's own changes (a board edit, a bid, a room opening or closing, a waiver running out) repaint the Bidding
     widgets and the tab badge in place. A tick only moves the countdowns, which the ticker does; the busy kinds (bids,
     lots, requests) are folded into one repaint a frame */
  var MK_SYNC = { board: 1, claim: 1, waive: 1, expire: 1, restore: 1, clock: 1, room: 1 }, MK_RAF = 0;
  function marketRepaint() { MK_RAF = 0; repaintBidding(); if (S2.$('.hqx[data-ws="hq"]')) repaintCap(club()); if (S2.$(".hqx[data-ws]")) refreshNav(); }
  if (S2.market) S2.market.on(function (ev) {
    if (ev.type === "tick") return;
    if (MK_SYNC[ev.type]) { if (MK_RAF) { cancelAnimationFrame(MK_RAF); MK_RAF = 0; } return marketRepaint(); }
    if (!MK_RAF) MK_RAF = requestAnimationFrame(marketRepaint);
  });

  /* =====================================================================================================================
     TRADES. Offers are private to the two front offices and the league office; only completed trades are public (Rule
     2.3). The offers, the players' trade requests and the trade block are the league's own (trades, action_requests of
     route "manager", roster_spots.on_block): see offersLive, reqsLive and blockLive above. shortcut: the club's completed
     moves are not listed here until this tab reads the public wire (s2_league's lazy "wire" section, js/live.js); the
     league's Transactions page shows them meanwhile
     ===================================================================================================================== */
  /* the minutes since a moment, on the league's clock (js/inbox.js reads it too) */
  function minsAgo(at) { return Math.max(0, (Date.now() - Date.parse(at)) / 60000); }
  function paneTrades(code) {
    return '<div class="hqx-stack"><section class="hqx-block" data-w="troffers">' + offersLive(code) + "</section>" +
      '<section class="hqx-block" data-w="treqs">' + reqsLive(code) + "</section>" +
      '<section class="hqx-block"><div data-w="tblockh">' + blockHead(code) + "</div>" +
        '<div class="hqx-tools"><div class="seg" id="hqxBlk" aria-label="Position">' + BLK.map(function (b) { return '<button data-v="' + b[0] + '" aria-pressed="' + (ST.blk === b[0]) + '">' + b[1] + "</button>"; }).join("") + "</div></div>" +
        '<div data-w="tblock">' + blockInner(code) + "</div></section></div>";
  }

  /* the trade block: every club's listings, filtered by position group; your own players come off or go on here */
  var BLK = [["all", "All"], ["F", "Forwards"], ["D", "Defense"], ["G", "Goaltenders"]];
  /* every club's listings: the league's own (roster_spots.on_block for the season on screen, through the model) */
  function listed() {
    return M.players.filter(function (p) { return p.rostered && p.onBlock; }).map(function (p) { return { player: p, club: p.club, at: null }; });
  }
  function blockHead(code) {
    var all = listed(), mine = all.filter(function (l) { return l.club === code; }).length;
    return head({ k: "Trade block · public", h: all.length ? plural(all.length, "player") + " on the block" : "Nobody on the block",
      p: "A listing is the one public part of a trade before it is made: every front office sees it, with position, overall, season to date and cap hit. It obliges nobody (Rule 2.3)." + (mine ? " " + plural(mine, "is yours", "are yours").replace(/^1 is/, "One is") + "." : ""),
      side: ro() ? "" : '<button class="btn secondary sm" data-act="block-list">List a player</button>' });
  }
  function toDate(p) {
    var L = p.lines && p.lines[p.mainRole]; if (!L) return "no games yet";
    return p.mainRole === "G" ? (L.svpct != null ? M.display("sv_pct", L.svpct) + " in " : "") + plural(L.gp, "game") : plural(L.p, "point") + " in " + plural(L.gp, "game");
  }
  function blockInner(code) {
    var list = listed().filter(function (l) { return ST.blk === "all" || l.player.unit === ST.blk; });
    /* QA visual 13 / worst 10 (2026-11-25): the All filter read "No all on the block right now." */
    if (!list.length) return '<p class="t-sub">' + (ST.blk === "all" ? "Nobody is on the block right now." : "No " + esc(tabName(BLK, ST.blk).toLowerCase()) + " on the block right now.") + "</p>";
    return '<div class="list hqx-list">' + list.map(function (l) {
      var p = l.player, own = l.club === code, tv = S2.trade.tradeValue(p.id);   /* one rating: the one the value counts */
      return '<div class="row hqx-ap hqx-bl">' + M.crest(l.club) + '<a class="grow hqx-bl-main" href="' + esc(p.href) + '"><span class="title">' + esc(p.tag) + "</span>" +
        '<span class="sub">' + esc(p.posName + " · " + tv.overall + " OVR · " + toDate(p) + " · " + money(p.salary) + " · value " + tv.value) + '</span><span class="t-foot">' + esc(team(l.club).full + (l.at ? " · listed " + M.ago(minsAgo(l.at)) : "")) + "</span></a>" +
        (ro() ? "" : '<span class="hqx-ap-b">' + (own ? '<button class="btn secondary sm" data-act="block" data-pid="' + p.id + '">Take off the block</button>' : '<button class="btn secondary sm" data-flow="trade" data-club="' + code + '" data-player="' + p.id + '">Add to a trade</button>') + "</span>") + "</div>";
    }).join("") + "</div>";
  }
  function blockSheet(code) {
    /* a manager's row carries no List control (Rule 2.6); a press on it is refused in place by the door, nothing sent */
    var draw = function () { return '<p class="t-sub">A listing is public at once and ends the moment the player leaves the club (Rule 2.3).</p><div class="list hqx-list">' + M.roster(code).active.map(function (p) {
      var seat = seatHeld(p);
      return '<button class="row" data-x="' + p.id + '" aria-pressed="' + !!p.onBlock + '"><span class="grow"><span class="title">' + esc(p.tag) + '</span><span class="sub">' + esc(p.posName + (seat ? " · " + seat + ": management can't be listed (Rule 2.6)" : "")) + "</span></span>" +
        (p.onBlock ? tag("accent", "Listed") : seat ? "" : '<span class="hqx-add">' + S2.ic("plus") + "List</span>") + "</button>"; }).join("") + '</div><p class="hqx-err" role="alert"></p>'; };
    var sh = sheet({ title: "List a player", back: ['[data-act="block-list"]'], html: '<div data-w="blks">' + draw() + "</div>" });
    sh.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-x]"); if (!b) return;
      /* the league's door; the list redraws from the rosters read again after the write */
      var p = M.player(b.dataset.x), want = p && !p.onBlock; if (!p || b.disabled) return;
      b.disabled = true; S2.$(".hqx-err", sh.el).textContent = "";
      blockLive(p, want, function (er, res) { b.disabled = false; if (er) { S2.$(".hqx-err", sh.el).textContent = er.message; return; } repaint("blks", draw); S2.toast(blockSaid(p, want, res), "ok"); });
    });
  }

  /* the Overview's line on trades: the count, the offers waiting, and the way in */
  function ovTradesInner(code) {
    var tid = tidOf(code), inl = offReady(code) ? OFF.open.filter(function (x) { return x.to_team_id === tid; }) : [];
    return head({ size: "d-2 sec-h-sm", k: "Trades", h: inl.length ? plural(inl.length, "offer") + " waiting for you" : "No offers waiting",
        p: "Accept or decline in Trades. Only completed trades are public (Rule 2.3).", go: ["All trades", "#/hq?tab=trades"] }) +
      (inl.length ? '<div class="list hqx-list">' + inl.slice(0, 2).map(function (x) { return trRow(code, x); }).join("") + "</div>" : "");
  }

  /* =====================================================================================================================
     BIDDING. Commissioner, 2026-11-02: "I do want it to have its own tab similar to the trades where
     teams can set bid boards throughout the season on the different camp players before the upcoming Saturday bid
     nights." and "Only training camp players with at least 6 games played can be bid on at the saturday bidding events."
     The board is the club's private plan (ranked targets, a ceiling in the room's own $250K steps, a note); it never bids
     by itself (the lead's reading 7). The pool, the waivers, the clock and the rooms are S2.market's; nothing here keeps
     a second copy, and the countdowns here run on S2.market.now
     ===================================================================================================================== */
  function mkNow() { return S2.market ? S2.market.now() : now(); }
  /* a countdown in market time; the ticker below repaints it each second (done: the words once it runs out) */
  function mcd(target, done, big) {
    var ms = target - mkNow();
    return '<span class="' + (big ? "d-num" : "num") + '" data-mkcd="' + target + '" data-cd-done="' + esc(done) + '"' + (big ? ' data-big="1"' : "") + ">" + (ms > 0 ? (big ? bigLeft(ms) : left(ms)) : esc(done)) + "</span>";
  }
  function gamesWords(x) { return x.eligible ? "Eligible, " + plural(x.gp, "game") : x.gp + " of 6, " + (["", "one", "two", "three", "four", "five", "six"][x.needs] || x.needs) + " more"; }
  /* the tab's line and count: targets on the board that the next bid night could open on (in the pool with six games) */
  function bidMeta(code) {
    var K = S2.market; if (!K) return { sub: "" };
    /* on an archive the tab says where bidding runs, as its pane does, never the current market's line (QA round 2 nit,
       2026-11-25: "No bid nights yet" sat under the read-only band beside "Bidding runs in Season 2") */
    var ae = archErr(); if (ae) return { sub: "Runs in " + ae.season };
    var nb = K.nextBidNight(), b = K.board(code), n = b.filter(function (x) { return x.state === "pool" && x.eligible; }).length;
    return { badge: nb && n ? n : "", badgeLabel: plural(n, "target") + " eligible for " + (nb ? nb.short : "bidding"),
      sub: !nb ? noRoom(K).sub : b.length ? plural(n, "eligible target") + " for " + nb.short : "Bid night " + nb.short };
  }
  /* the Bidding tab with no room to show, in words that hold for the season as it stands (QA round 2, 2026-11-25: with no
     bid night on record the tab said "No bid nights left this season" and "Saturday bidding runs only before the movement
     deadline", for a season whose schedule, and so its Saturdays, is not set yet): while the market is read or when it
     could not be, before any bid night exists, a holiday Saturday with a night after it, and after the last one. h and p
     are the empty state's, sub the tab's line */
  /* the one wording of the market after the movement deadline, for noRoom and the bid head (QA round 2 nit, 2026-11-25:
     the two carried the same sentence twice) */
  var PAST_DEADLINE = "The movement deadline has passed, so clubs add players only through single-game requests from the training camp pool (Rule S2.5).";
  function noRoom(K) {
    var st = K.status(), t = K.now(), dl = K.deadline;
    if (st.error) return { err: true, h: "The bid nights could not be read", p: "The league did not answer just now (" + st.error + "). Reload the page to try again.", sub: "Could not be read" };
    if (!st.loaded) return { h: "Reading the bid nights", p: "One moment while the league's market is read.", sub: "Reading the bid nights" };
    if (!K.bidNights().length) return { h: "No bid nights yet", p: "Bid nights appear once the Season 2 schedule is set (Rule S2.6).", sub: "No bid nights yet" };
    var nx = K.bidNights().filter(function (x) { return !x.skipped && x.opens > t; })[0];
    if (nx) return { h: "No bidding this Saturday", p: "Holiday weeks have no games and no bidding. The next bid night is " + nx.label + " (Rule S2.6).", sub: "Next bid night " + nx.short };
    return { h: "No bid nights left", sub: "No bid nights left this season",
      p: dl != null && t < dl ? "No Saturday bidding is left before the movement deadline, " + M.etLong(iso(dl)) + ", and waivers and claims run until then (Rule S2.5)."
        : PAST_DEADLINE };
  }
  function paneBidding(code) {
    if (!S2.market) return empty("Bidding is not available", "The Season 2 market did not load, so there is nothing to plan here. The console names the error.");
    /* the bid board, the waivers and the bid nights are the current season's market, never the archive's */
    var ae = archErr();
    if (ae) return S2.empty("lock", "Bidding runs in " + ae.season, "Saturday bidding, the bid board and waivers belong to " + esc(ae.season) + ". This page shows " + esc(ae.shown) + ".",
      '<a class="btn secondary sm" href="' + esc(S2.seasonHref(null, "#/hq?tab=bidding")) + '">Open Bidding for ' + esc(ae.season) + "</a>");
    return '<div class="hqx-stack"><div class="hqx-bwrap"><div data-w="bhead">' + bidHeadInner(code) + "</div></div>" +
      '<section class="hqx-block" data-w="bstand">' + standInner(code) + "</section>" +
      '<section class="hqx-block"><div data-w="bboardh">' + boardHead(code) + '</div><div data-w="bboard">' + boardInner(code) + "</div></section>" +
      '<section class="hqx-block" data-w="bwire">' + wireInner(code) + "</section>" +
      '<section class="hqx-block" data-w="bres">' + resultsInner(code) + "</section>" +
      about("The pool, the waivers, the bid nights and the board are the league's own records, read as you, on the league's clock. The board is private to your front office and the league office, and it never bids for you: you bid in the room. A refusal is the league's own sentence, and nothing is shown as done until it is confirmed (Rules S2.5 and S2.6).") + "</div>";
  }
  /* the next bid night on the ink panel (Today's game night and the draft room wear the same): the date block, the state,
     the big countdown, every Saturday of the window with the holiday ones marked, and the doors to the room and the pool */
  function bidHeadInner(code) {
    var K = S2.market, r = K.room(null, { as: code }), t = K.now(), nights = K.bidNights();
    if (!r) { var nr = noRoom(K); return S2.empty(nr.err ? "err" : "none", nr.h, esc(nr.p)); }
    var st = r.state, b = r.night, onBoard = K.board(code).filter(function (x) { return x.state === "pool" && x.eligible; }).length;
    var off = nights.filter(function (x) { return x.skipped; }).map(function (x) { return x.short; });
    var h = st === "live" ? "Bidding is live" : st === "closing" ? "The last countdowns are running" : st === "closed" ? "Bidding is over for the season" : b.label, early = t < K.deadline;
    var p = st === "before" ? plural(r.lots.length, "pool player") + (r.lots.length === 1 ? " has" : " have") + " six games and would open for bidding at 9:00 PM" + (onBoard ? ", " + onBoard + " of them on your board" : "") + "." :
      st === "live" ? plural(r.running, "countdown") + " running and " + r.sold + " sold so far. Every bid starts five minutes again; no new player opens after 10:00 PM." :
      st === "closing" ? "No new player opens after 10:00 PM. The countdowns already running finish, and the room closes when the last one does." :
      /* a closed room is the last bid night; the movement deadline can still be days off, and waivers and claims run until
         it (review 2026-11-02: Jan 17 to 22 said the deadline had passed) */
      early ? "The last bid night was " + b.label + ". No Saturday bidding is left before the movement deadline, " + M.etLong(iso(K.deadline)) + ", and waivers and claims run until then." :
      PAST_DEADLINE;
    var big = st === "before" ? mcd(r.opens, "Opening", true) + "<span>until bidding opens</span>" : st === "live" ? mcd(r.newUntil, "10:00 PM", true) + "<span>until new bidding closes</span>" :
      st === "closing" ? '<b class="d-num">' + r.running + "</b><span>" + (r.running === 1 ? "countdown" : "countdowns") + " still running</span>" : '<b class="d-num">Done</b><span>no bid nights left</span>';
    var word = function (x) { return x.skipped ? "Holiday week, no bidding" : x.key === r.key ? (st === "live" ? "Live now" : st === "closing" ? "Closing" : st === "closed" ? "Held" : "Next") : x.newUntil <= t ? "Held" : "9 to 10 PM ET"; };
    return '<section class="hqx-mc hqx-bh"' + inkAttrs() + ' aria-label="' + esc(st === "before" ? "Next bid night, " + b.label : h) + '"><div class="hqx-ink-h">' + dateBlock(iso(b.opens)) +
        '<div class="hqx-ink-copy"><span class="kicker">' + (st === "live" || st === "closing" ? '<span class="hqx-live">Live</span> Saturday bidding · Rule S2.6' : st === "closed" ? "Last bid night · Rule S2.6" : "Next bid night · Rule S2.6") + '</span><h3 class="d-2">' + esc(h) + '</h3><p class="hqx-ink-p">' + esc(p) + "</p></div>" +
        '<div class="hqx-cd">' + big + "</div></div>" +
      '<ol class="hqx-bn" aria-label="Saturday bid nights">' + nights.map(function (x) {
        return '<li class="' + (x.skipped ? "off" : x.key === r.key ? "cur" : x.newUntil <= t ? "held" : "") + '"><b class="d-num">' + esc(x.short.replace(/^\w+, /, "")) + '</b><span>' + esc(word(x)) + "</span></li>"; }).join("") + "</ol>" +
      (off.length ? '<p class="hqx-ink-p hqx-bn-off">No bidding on ' + esc(off.join(" or ")) + ": holiday weeks have no games and no bidding (Rule S2.6).</p>" : "") +
      '<div class="hqx-ink-f"><span class="hqx-ink-go">' + arrow(st === "live" || st === "closing" ? "Bid in the room" : "The bid room", "#/bidding") + arrow("Training camp pool", "#/camp") + "</span></div></section>";
  }
  /* where the club stands for bidding and claims: spots and Season 2 cap room, counting the bids it leads in a live room
     (the lead's reading 5), the minimums, and the way out when it is full */
  function standInner(code) {
    var K = S2.market, cs = K.clubState(code), t = team(code), a = cs.active, m = cs.mins;
    var h = cs.freeSpots > 0 ? plural(cs.freeSpots, "open spot") + " and " + money(cs.freeRoom) + " of cap room" : "No open roster spot";
    var p = cs.freeSpots > 0 ? t.city + " may win or claim up to " + plural(cs.freeSpots, "player") + " right now, at most " + money(cs.freeRoom) + " in all. Every bid counts against both while " + t.city + " leads it (Rule S2.6)." :
      t.city + " has " + a.total + " of " + cs.limit + " on its active roster" + (cs.leading.length ? ", counting the bids it leads" : "") + ", so it cannot bid on or claim a player until a spot opens (Rule S2.4).";
    return head({ k: "Your club for Saturday", h: esc(h), p: esc(p) }) +
      '<dl class="spec hqx-spec4 hqx-bstand"><div><dt>Active roster</dt><dd class="num">' + a.total + " of " + cs.limit + "</dd></div>" +
        '<div><dt>Season 2 cap room</dt><dd class="num">' + esc(money(cs.room)) + "</dd></div>" +
        '<div><dt>Bids you lead</dt><dd class="num">' + (cs.leading.length ? cs.leading.length + " · " + esc(money(cs.committed)) : "None") + "</dd></div>" +
        '<div><dt>Active by group</dt><dd class="num">' + [["F", a.F], ["D", a.D], ["G", a.G]].map(function (u) { return '<span class="' + (minsInForce() && u[1] < m[u[0]] ? "hqx-bad" : "") + '">' + u[1] + " " + u[0] + " (min " + m[u[0]] + ")</span>"; }).join(" · ") + "</dd></div></dl>" +
      '<p class="hqx-fine">Season 2 cap room: the ' + esc(money(cs.cap)) + " cap less the active roster (" + esc(money(cs.payroll)) + "). The active roster keeps at least " + m.F + " forwards, " + m.D + " defense and " + m.G + " goaltender (Rule S2.4).</p>" +
      (cs.freeSpots > 0 ? "" : '<div class="hqx-actions"><a class="btn secondary sm" href="#/hq?tab=roster">Open a spot: put a player on waivers</a></div>');
  }
  function boardHead(code) {
    var K = S2.market, b = K.board(code), nb = K.nextBidNight(), el = b.filter(function (x) { return x.state === "pool" && x.eligible; }).length;
    return head({ k: "Bid board · private", h: b.length ? esc(plural(b.length, "target") + ", " + el + " eligible" + (nb ? " for " + nb.short : "")) : "No targets yet",
      p: "Rank the pool players you want and set the most you would pay. Only your front office and the league office see it, and it never bids for you: you bid in the room.",
      side: '<button class="btn" data-act="badd">' + S2.ic("plus") + "Add players</button>" });
  }
  var IC_MV = { up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>' };
  function mvIc(d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC_MV[d] + "</svg>"; }
  var BSTATE = { pool: ["", "In the pool"], waivers: ["warn", "On waivers"], signed: ["", "Signed"], gone: ["", "Off the market"] };
  function boardInner(code) {
    var K = S2.market, b = K.board(code), n = b.length, room = K.room(null, { as: code }), lots = {};
    /* while a room is live the board says where each target's lot stands; who is bidding stays hidden (Rule S2.6) */
    if (room && (room.state === "live" || room.state === "closing")) room.lots.forEach(function (l) { lots[l.pid] = l; });
    if (!n) return '<div class="hqx-bd-none"><p class="t-sub">Add players from the training camp pool to plan Saturday. A player needs six games before clubs can bid on them, so the pool shows who is close.</p>' +
      '<div class="hqx-actions"><a class="btn plain sm" href="#/camp">See the training camp pool</a></div></div>';
    return '<div class="list hqx-list hqx-board" role="list" aria-label="Bid board, in rank order">' + b.map(function (x) {
      var p = x.player || {}, w = x.state === "waivers" && K.waiver(x.pid), s = BSTATE[x.state] || BSTATE.gone, c = x.ceiling, top = c != null && c >= (M.RULES.s2.cap || 5e7);
      var lot = lots[x.pid], st = lot && lot.state === "running" ? tag("accent", lot.mine ? "You lead at " + money(lot.price) : "Live at " + money(lot.price) + ", bidder hidden") :
        lot && lot.state === "open" && lot.next ? tag("accent", "Open in the room at " + money(lot.next)) : x.state === "signed" ? tag(x.signedBy === code ? "win" : "", x.signedBy === code ? "Signed by you" : "Signed by " + team(x.signedBy).city) : x.state === "pool" && x.eligible ? tag("win", "Eligible Saturday") : tag(s[0], s[1]);
      return '<div class="row hqx-bd' + (x.state === "signed" || x.state === "gone" ? " is-out" : "") + '" role="listitem" data-bpid="' + x.pid + '">' +
        '<span class="hqx-bd-h" data-bgrip title="Drag to reorder"><span class="hqx-grip" aria-hidden="true">' + ic("grip") + '</span><b class="d-num hqx-bd-rank"><span class="sr">Rank </span>' + x.rank + "</b></span>" +
        '<span class="hqx-bd-main"><a class="title hqx-bd-tag" href="' + esc(p.href || "#/camp") + '" title="' + esc(x.tag) + '">' + esc(x.tag) + "</a>" +
          '<span class="sub">' + esc([p.pos, p.ovr ? p.ovr.ovr + " OVR" : "no rating yet", gamesWords(x)].filter(Boolean).join(" · ")) + "</span>" +
          '<span class="hqx-bd-st">' + st + (w ? '<span class="t-foot num">' + esc(left(w.left)) + " left</span>" + '<button class="btn sm hqx-bd-claim" data-act="claim" data-pid="' + x.pid + '">Claim</button>' : "") + "</span></span>" +
        '<span class="hqx-step" role="group" aria-label="' + esc("Ceiling for " + x.tag) + '">' +
          '<button class="hqx-step-b" data-act="ceil" data-v="down" data-pid="' + x.pid + '"' + (c == null || c <= S2.market.MIN ? " disabled" : "") + ' aria-label="' + esc("Lower the ceiling to " + money(Math.max(S2.market.MIN, (c || S2.market.MIN) - S2.market.STEP))) + '"><span aria-hidden="true">−</span></button>' +
          '<span class="hqx-step-v" aria-live="polite"><b class="num">' + (c == null ? "None" : esc(money(c))) + "</b><small>ceiling</small></span>" +
          '<button class="hqx-step-b" data-act="ceil" data-v="up" data-pid="' + x.pid + '"' + (top ? " disabled" : "") + ' aria-label="' + esc("Raise the ceiling to " + money(c == null ? S2.market.MIN : c + S2.market.STEP)) + '"><span aria-hidden="true">+</span></button></span>' +
        '<span class="hqx-bd-foot"><label class="hqx-bd-note">' + ic("note") + '<span class="sr">Note on ' + esc(x.tag) + '</span><input data-bnote="' + x.pid + '" maxlength="200" autocomplete="off" enterkeyhint="done" placeholder="Add a note" value="' + esc(x.note || "") + '"></label>' +
          '<span class="hqx-bd-acts"><button class="hqx-ib" data-act="bmove" data-v="up" data-pid="' + x.pid + '"' + (x.rank === 1 ? " disabled" : "") + ' aria-label="' + esc("Move " + x.tag + " up") + '">' + mvIc("up") + "</button>" +
            '<button class="hqx-ib" data-act="bmove" data-v="down" data-pid="' + x.pid + '"' + (x.rank === n ? " disabled" : "") + ' aria-label="' + esc("Move " + x.tag + " down") + '">' + mvIc("down") + "</button>" +
            '<button class="hqx-ib" data-act="bremove" data-pid="' + x.pid + '" aria-label="' + esc("Remove " + x.tag + " from the board") + '">' + S2.ic("x") + "</button></span></span></div>";
    }).join("") + "</div>" + '<div data-w="bplan">' + plannerInner(code) + "</div>";
  }
  /* the planner line: down the board in rank order, the targets the club could actually win this Saturday (eligible, in
     the pool) against its open spots and cap room, each at its ceiling (none set counts at the $750K opening bid) */
  function plannerOf(code) {
    var K = S2.market, cs = K.clubState(code), spots = cs.freeSpots, room = cs.freeRoom, take = [], wait = [];
    K.board(code).forEach(function (x) {
      if (x.state !== "pool" || !x.eligible) return;
      var c = x.ceiling == null ? K.MIN : x.ceiling;
      if (take.length < spots && c <= room) { take.push(x); room -= c; } else wait.push(x);
    });
    return { cs: cs, take: take, wait: wait, total: take.reduce(function (s, x) { return s + (x.ceiling == null ? K.MIN : x.ceiling); }, 0) };
  }
  function plannerInner(code) {
    var pl = plannerOf(code), cs = pl.cs, t = team(code), nm = function (l) { var a = l.map(function (x) { return x.tag; }); return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; };
    var line = !pl.take.length && !pl.wait.length ? "No target on the board can be bid on yet: a pool player needs six games first." :
      cs.freeSpots < 1 ? "With no open spot, " + t.city + " could win none of its " + plural(pl.wait.length, "eligible target") + " on Saturday. Open a spot first." :
      "At your ceilings, " + t.city + " could win " + nm(pl.take) + " for up to " + money(pl.total) + ", inside " + plural(cs.freeSpots, "open spot") + " and " + money(cs.freeRoom) + " of cap room." +
        (pl.wait.length ? " " + nm(pl.wait) + (pl.wait.length === 1 ? " does" : " do") + " not fit in what is left." : "");
    return '<p class="hqx-plan-line" data-planned="' + pl.total + '" data-take="' + pl.take.length + '"><b class="d-num">' + esc(money(pl.total)) + "</b><span>" + esc(line) + "</span></p>";
  }
  /* everyone on waivers now, league-wide: any club but the one that waived them may claim within the 24 hours */
  function wireInner(code) {
    var w = S2.market.waivers();
    return head({ k: "Waivers · Rule S2.5", size: "d-2 sec-h-sm", h: w.length ? plural(w.length, "player") + " on waivers" : "No one on waivers",
        p: "A waived player can be claimed by any other club for 24 hours, at the salary they carried, by a club with an open spot and the cap room. The first claim wins; after 24 hours they join the pool." }) +
      (w.length ? '<div class="list hqx-list">' + w.map(function (x) {
        var own = x.from === code;
        return '<div class="row hqx-ap hqx-wr">' + M.crest(x.from) + '<a class="grow hqx-bl-main" href="' + esc(x.player ? x.player.href : "#/camp") + '"><span class="title">' + esc(x.tag) + "</span>" +
          '<span class="sub">' + esc([x.player && x.player.pos, money(x.salary), "waived by " + team(x.from).city].filter(Boolean).join(" · ")) + '</span><span class="t-foot">' + esc(left(x.left) + " left, until " + stamp(x.until)) + "</span></a>" +
          '<span class="hqx-ap-b"><button class="btn ' + (own ? "secondary " : "") + 'sm" data-act="claim" data-pid="' + x.pid + '">' + (own ? "Yours" : "Claim") + "</button></span></div>";
      }).join("") + "</div>" : "");
  }
  /* the club's own results, night by night: who it signed, and the players it bid on and lost (bidders are shown once a
     lot is over, Rule S2.6) */
  function resultsInner(code) {
    var K = S2.market, held = K.bidNights().filter(function (b) { return !b.skipped; }).map(function (b) { return K.room(b.key, { as: code }); }).filter(function (r) { return r && r.state === "closed"; });
    var nb = K.nextBidNight();
    if (!held.length) return head({ k: "Results", size: "d-2 sec-h-sm", h: "No bid night held yet", p: "The players " + team(code).city + " signs, and the ones it bid on and lost, appear here after " + (nb ? nb.label : "the first bid night") + "." });
    var won = 0, rows = held.slice().reverse().map(function (r) {
      var mine = r.lots.filter(function (l) { return l.soldTo === code || l.history.some(function (h) { return h.mine; }); });
      won += mine.filter(function (l) { return l.soldTo === code; }).length;
      return '<div class="hqx-tgrp"><h4 class="hqx-group-h">' + esc(r.night.label) + '</h4><p class="t-sub hqx-res-t">' + esc(r.recap ? r.recap.text : "") + "</p>" +
        (mine.length ? '<div class="list hqx-list">' + mine.map(function (l) {
          var w = l.soldTo === code;
          return '<a class="row hqx-lg hqx-rs" href="' + esc(l.player ? l.player.href : "#/camp") + '">' + mark(w ? "W" : l.state === "void" ? "" : "L") + (l.soldTo ? M.crest(l.soldTo) : "<span></span>") + '<span class="grow"><span class="title">' + esc(l.tag) + '</span><span class="sub">' +
            esc(w ? "Signed at " + money(l.price) + " to the end of the season" : l.soldTo ? "Sold to " + team(l.soldTo).city + " at " + money(l.price) : l.state === "void" ? "Sale voided: " + (l.why || "the player left the pool while the countdown ran.") : "No sale: back to the pool") + "</span></span>" + S2.chev() + "</a>";
        }).join("") + "</div>" : '<p class="t-sub">' + esc(team(code).city) + " did not bid that night.</p>") + "</div>";
    }).join("");
    return head({ k: "Results", size: "d-2 sec-h-sm", h: won ? plural(won, "player") + " signed at Saturday bidding" : "No signings yet", p: "Your club's lots from each bid night, newest first. The night's full results are in the bid room." }) + rows;
  }
  /* every market widget in place; the board waits while a finger drags it or a note is being typed (never re-render an
     input mid-typing), and catches up when that ends */
  var BOARD_DIRTY = false;
  function boardBusy() { var a = document.activeElement; return !!(BD && BD.on) || !!(a && a.matches && a.matches("[data-bnote]")); }
  function repaintBidding() {
    if (!S2.market || !S2.$('[data-w="bhead"]')) return;
    var code = club();
    repaint("bhead", function () { return bidHeadInner(code); }); repaint("bstand", function () { return standInner(code); });
    repaint("bboardh", function () { return boardHead(code); }); repaint("bwire", function () { return wireInner(code); }); repaint("bres", function () { return resultsInner(code); });
    repaint("bpool", function () { return poolInner(code); });   /* the Add players sheet, when it is open */
    if (boardBusy()) { BOARD_DIRTY = true; repaint("bplan", function () { return plannerInner(code); }); }
    else { BOARD_DIRTY = false; repaint("bboard", function () { return boardInner(code); }); }
  }
  function boardAct(name, a, ev) {
    var K = S2.market, code = club(), pid = a.dataset.pid, x = K.onBoard(code, pid), r, prev = null;
    if (!x) return;
    if (name === "ceil") {
      var c = x.ceiling == null ? null : x.ceiling, to = a.dataset.v === "up" ? (c == null ? K.MIN : c + K.STEP) : Math.max(K.MIN, (c == null ? K.MIN : c) - K.STEP);
      r = K.boardSet(code, pid, { ceiling: to });
    } else if (name === "bmove") {
      prev = rowRects();
      r = K.boardMove(code, pid, x.rank + (a.dataset.v === "up" ? -1 : 1));
    } else if (name === "bremove") {
      r = K.boardRemove(code, pid);
    }
    if (r) mkAnswer(r, function (res) {
      if (!res.ok) return S2.toast(texts(res.problems).join(" "), "err");
      /* a pointer press slides the rows into place; a keyboard press does not animate (it repeats) */
      if (name === "bmove" && ev && ev.detail > 0) flipRows(prev, null);
      if (name === "bremove") S2.toast(x.tag + " is off your board.", "ok");
    });
  }
  /* Add players: the pool by rating with position and eligibility filters, players on waivers first; a row adds or takes
     off at a tap and the sheet stays open, so a front office can pick several */
  var BPOS = [["all", "All"], ["F", "Forwards"], ["D", "Defense"], ["G", "Goaltenders"]], BEL = [["all", "Everyone"], ["yes", "Eligible"], ["no", "Not yet"]];
  function poolInner(code) {
    var K = S2.market, onB = {}, wv = K.waivers();
    K.board(code).forEach(function (x) { onB[x.pid] = true; });
    var keep_ = function (x) { var u = x.unit || (x.player && x.player.unit); return (ST.bpos === "all" || u === ST.bpos) && (ST.belig === "all" || (ST.belig === "yes") === !!x.eligible); };
    var wl = wv.map(function (w) { var pp = K.poolPlayer(w.pid), p = w.player || {}; return { pid: w.pid, tag: w.tag, unit: p.unit, pos: p.pos, ovr: p.ovr ? p.ovr.ovr : null, gp: pp ? pp.gp : p.gp || 0, eligible: false, w: w }; }).filter(function (x) { return ST.belig !== "yes" && keep_(x); });
    var pl = K.pool().filter(keep_);
    var row = function (x) {
      var on = !!onB[x.pid], src = x.w ? "On waivers from " + team(x.w.from).city + ", " + left(x.w.left) + " left" : x.source === "camp" ? "Training camp, " + team(x.lastClub).city : x.lastClub ? "Unrostered, last with " + team(x.lastClub).city : "Unrostered";
      return '<button class="row hqx-pr" data-x="' + x.pid + '" aria-pressed="' + on + '">' + M.crest(x.w ? x.w.from : x.lastClub) + '<span class="grow"><span class="title">' + esc(x.tag) + '</span><span class="sub">' +
        esc([x.pos, x.ovr ? x.ovr + " OVR" : "no rating yet", x.w ? money(x.w.salary) : gamesWords(x)].join(" · ")) + '</span><span class="t-foot">' + esc(src) + "</span></span>" +
        (on ? '<span class="hqx-pr-on">' + S2.ic("check") + "On your board</span>" : '<span class="hqx-add">' + S2.ic("plus") + "Add</span>") + "</button>";
    };
    return (wl.length ? '<h4 class="hqx-group-h">On waivers <span class="num">' + wl.length + '</span></h4><div class="list hqx-list">' + wl.map(row).join("") + "</div>" : "") +
      '<h4 class="hqx-group-h' + (wl.length ? " hqx-pool-h2" : "") + '">Training camp pool <span class="num">' + pl.length + "</span></h4>" +
      (pl.length ? '<div class="list hqx-list">' + pl.map(row).join("") + "</div>" : '<p class="t-sub">No one in the pool matches. Try Everyone or All.</p>') + '<p class="hqx-err" role="alert"></p>';
  }
  function poolSheet(code) {
    var seg = function (id, opts, cur) { return '<div class="seg" id="' + id + '" aria-label="' + (id === "hqxBpos" ? "Position" : "Eligibility") + '">' + opts.map(function (o) { return '<button data-v="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '">' + o[1] + "</button>"; }).join("") + "</div>"; };
    var sh = sheet({ title: "Add players to your board", back: ['[data-w="bboardh"] [data-act="badd"]', '[data-act="badd"]'], html: '<div class="hqx-pool"><p class="t-sub">Only a pool player with six games may be bid on (Rule S2.6). A player on waivers is claimed, not bid on, but you can plan for them too.</p>' +
      '<div class="hqx-tools">' + seg("hqxBpos", BPOS, ST.bpos) + seg("hqxBel", BEL, ST.belig) + "</div>" + '<div data-w="bpool">' + poolInner(code) + "</div></div>" });
    S2.segmented(S2.$("#hqxBpos", sh.el), function (v) { ST.bpos = v; repaint("bpool", function () { return poolInner(code); }); });
    S2.segmented(S2.$("#hqxBel", sh.el), function (v) { ST.belig = v; repaint("bpool", function () { return poolInner(code); }); });
    sh.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-x]"); if (!b) return;
      var K = S2.market, pid = b.dataset.x, er = S2.$('[data-w="bpool"] .hqx-err', sh.el);
      if (er) er.textContent = "";
      mkAnswer(K.onBoard(code, pid) ? K.boardRemove(code, pid) : K.boardAdd(code, pid, { ceiling: K.MIN }), function (r) {
        var er2 = S2.$('[data-w="bpool"] .hqx-err', sh.el); if (!r.ok && er2) er2.textContent = texts(r.problems).join(" ");
      });
      /* the "board" event repaints this list and the tab behind it (the market listener below) */
    });
  }

  /* drag to reorder the board: the grip and the rank (mouse and finger alike, so the rest of the row keeps its buttons,
     note and scroll), 1:1 from the grab point, the other rows spring aside as it passes, a soft edge past the first and
     last place, and on release every row springs from where it was to its new place with the finger's speed (the house
     drag of the lineup sheet). Move up and Move down do the same for a keyboard */
  var BD = null;
  function rowRects() { var m = {}; S2.$$('[data-w="bboard"] [data-bpid]').forEach(function (el) { m[el.dataset.bpid] = el.getBoundingClientRect(); }); return m; }
  function flipRows(prev, vel) {
    if (S2.reduce.matches) return;
    S2.$$('[data-w="bboard"] [data-bpid]').forEach(function (el) {
      var a = prev[el.dataset.bpid]; if (!a) return;
      var dy = a.top - el.getBoundingClientRect().top; if (Math.abs(dy) < 1) return;
      var thrown = vel && vel.pid === el.dataset.bpid;
      el.classList.add("is-flying"); if (thrown) el.classList.add("is-thrown");
      el.style.transform = "translateY(" + dy + "px)";
      /* a thrown row keeps the finger's speed and settles with a little give; the rows it passed do not bounce */
      S2.spring({ from: dy, damping: thrown ? 0.82 : 1, response: 0.34, onUpdate: function (y) { el.style.transform = "translateY(" + y.toFixed(2) + "px)"; },
        onRest: function () { el.style.transform = ""; el.classList.remove("is-flying", "is-thrown"); } }).to(0, thrown ? vel.v : 0);
    });
  }
  function bdDown(e) {
    var g = e.target.closest("[data-bgrip]"); if (!g || BD || e.button > 0 || ro()) return;
    var row = g.closest("[data-bpid]"), list = row && row.parentNode; if (!row) return;
    var rows = S2.$$("[data-bpid]", list); if (rows.length < 2) return;
    e.preventDefault();   /* no text selection, no scroll: the grip is touch-action none */
    try { g.setPointerCapture(e.pointerId); } catch (x) { /* a synthetic pointer has no capture; window listeners still follow it */ }
    BD = { g: g, row: row, rows: rows, i: rows.indexOf(row), to: rows.indexOf(row), y0: e.clientY, id: e.pointerId, on: false, dy: 0, hist: [],
      tops: rows.map(function (r) { return r.offsetTop; }), hs: rows.map(function (r) { return r.offsetHeight; }), sp: [] };
    window.addEventListener("pointermove", bdMove, { passive: false }); window.addEventListener("pointerup", bdUp); window.addEventListener("pointercancel", bdUp);
  }
  function bdMove(e) {
    var d = BD; if (!d || e.pointerId !== d.id) return;
    var dy = e.clientY - d.y0, n = d.rows.length;
    if (!d.on) {
      if (Math.abs(dy) < 4) return;   /* a little hysteresis before it counts as a drag */
      d.on = true; d.row.classList.add("is-lifted-row");
      d.sp = d.rows.map(function (r) { return S2.spring({ from: 0, response: 0.28, damping: 1, onUpdate: function (y) { if (r !== d.row) r.style.transform = "translateY(" + y.toFixed(2) + "px)"; } }); });
    }
    e.preventDefault();
    var lo = d.tops[0] - d.tops[d.i], hi = d.tops[n - 1] + d.hs[n - 1] - d.tops[d.i] - d.hs[d.i];
    if (dy < lo) dy = lo - S2.rubber(lo - dy, 160); else if (dy > hi) dy = hi + S2.rubber(dy - hi, 160);   /* past the ends: resistance, not a wall */
    d.dy = dy; d.row.style.translate = "0 " + dy.toFixed(2) + "px";   /* the lift's scale is hq.css's .is-lifted-row */
    d.hist.push({ y: e.clientY, t: performance.now() }); if (d.hist.length > 6) d.hist.shift();
    var c = d.tops[d.i] + d.hs[d.i] / 2 + dy, to = 0;
    for (var k = 0; k < n; k++) if (k !== d.i && d.tops[k] + d.hs[k] / 2 < c) to++;
    if (to !== d.to) {
      d.to = to;
      d.rows.forEach(function (r, k) { if (k === d.i) return; d.sp[k].to(k > d.i && k <= to ? -d.hs[d.i] : k < d.i && k >= to ? d.hs[d.i] : 0); });
    }
  }
  function bdUp(e) {
    var d = BD; if (!d || (e && e.pointerId !== d.id)) return;
    window.removeEventListener("pointermove", bdMove); window.removeEventListener("pointerup", bdUp); window.removeEventListener("pointercancel", bdUp);
    if (!d.on) { BD = null; return; }
    var a = d.hist[0], b = d.hist[d.hist.length - 1], v = a && b && b !== a ? (b.y - a.y) / Math.max(16, b.t - a.t) * 1000 : 0;
    d.sp.forEach(function (s) { s.stop(); });
    var prev = rowRects(), pid = d.row.dataset.bpid, to = e && e.type === "pointerup" ? d.to : d.i;   /* a canceled drag goes home */
    BD = null;
    if (to !== d.i) mkAnswer(S2.market.boardMove(club(), pid, to + 1), function (r) { if (!r.ok) { S2.toast(texts(r.problems).join(" "), "err"); repaint("bboard", function () { return boardInner(club()); }); } });   /* the "board" event repaints the list */
    else repaint("bboard", function () { return boardInner(club()); });
    flipRows(prev, { pid: pid, v: v });
  }
  function nightSeg(nights, n, id) {
    return '<div class="seg hqx-nightseg" id="' + id + '" aria-label="Night">' + nights.map(function (x) { return '<button data-v="' + x.night + '" aria-pressed="' + (x.night === n.night) + '">' + esc(x.short.split(",")[0] + " " + x.short.split(" ").pop()) + "</button>"; }).join("") + "</div>";
  }
  function planRow(code, g, t) {
    var L = luOf(code, g), st = lockState(g, t), k = lockOf(g), o = opp(g, code), f = filledN(L);
    /* commissioner, 2026-11-24: "If a team does not set their initial lineup for that game before the deadline to set the
       lineups, that team forfeits the game." */
    var lost = st !== "open" && !L.filed && g.stage !== "playoff";
    var state = lost ? tag("loss", "Forfeit: no lineup") : st === "underway" ? tag("", "Under way") : L.filed ? tag("win", st === "locked" ? "Published" : "Filed") : f ? tag("warn", "Draft " + f + "/6") : tag("loss", "Not filed");
    var when = lost ? "No lineup by the " + esc(clock(k.lock)) + " lock, so the game is forfeited (Rule 3.2)" : st === "open" ? "Locks in " + cd(k.lock) + (L.filed ? "" : " · file it by then or forfeit") : st === "locked" ? "Published to " + esc(o) + " · changes free until " + esc(clock(k.close)) : "Who played comes from the box score";
    /* on an archive (or a later season) the row is the record, not a door to the sheet (QA round 2 nit, 2026-11-25) */
    var el = ro() ? "div" : "button";
    return "<" + el + ' class="row hqx-plan-r"' + (ro() ? "" : ' data-act="sheet" data-g="' + g.id + '"') + ">" + timeHtml(g) + M.crest(o) +
      '<span class="grow"><span class="title">' + (g.gameNo ? "Game " + g.gameNo + " · " : "") + vsHtml(g, code) + '</span><span class="sub">' + when + "</span></span>" +
      '<span class="hqx-plan-s">' + state + '<span class="hqx-dots" role="img" aria-label="' + f + ' of 6 spots filled">' + SLOTS.map(function (s) { return '<i class="' + (L.slots[s] ? "on" : "") + '"></i>'; }).join("") + "</span></span>" + (ro() ? "" : S2.chev()) + "</" + el + ">";
  }

  /* ---- Game nights: the availability grid for one night ---- */
  function paneNights(code) {
    var nights = byNight(weekGames(code)); if (!nights.length) return empty("No games ahead", "The availability grid opens when the schedule has a night for this club.");
    return '<div class="hqx-stack"><section class="hqx-block"><div data-w="gridh">' + gridHead(code) + "</div>" + '<div class="hqx-tools">' + nightSeg(nights, curNight(nights), "hqxNightN") + "</div>" + '<div data-w="grid">' + gridInner() + "</div></section>" +
      '<section class="hqx-block" data-w="servers">' + serversInner(code) + "</section>" +
      about("The roster, the schedule, every availability answer and the club's server picks are the league's own records, read as you. A pick reads as kept only once the league confirms it, and the lobby code reaches the two clubs at the night's code release (Rules 4.2 and 5.1).") + "</div>";
  }
  function gridHead(code) {
    var wk = weekGames(code), rv = rosterView(code), missing = rv ? rv.pro.filter(function (p) { return wk.some(function (g) { return !availOf(p, g); }); }).length : 0;
    return head({ k: "Availability · Week " + (wk[0] ? wk[0].week : ""), h: missing ? plural(missing, "player") + " still to answer" : "Everyone has answered",
      p: "Every rostered player answers each game by " + esc(stamp(dueOf(wk))) + " (Rule 5.1). Availability informs the lineup; it does not bind it." });
  }
  function gridInner() {
    var code = club(), n = curNight(byNight(weekGames(code))), rv = rosterView(code); if (!n || !rv) return "";
    var cell = function (p, g) { var a = availOf(p, g); return '<td><span class="hqx-a ' + (a || "none") + '" title="' + availWord(a) + '">' + (a === "yes" ? S2.ic("check") : a === "no" ? S2.ic("x") : "") + '<span class="sr">' + availWord(a) + "</span></span></td>"; };
    var row = function (p) { return '<tr><th scope="row"><span class="hqx-gname"><span class="num hqx-gnum">' + (p.num != null ? p.num : "") + '</span><span class="hqx-gtag" title="' + esc(p.tag) + '">' + esc(p.tag) + '</span><span class="t-foot">' + esc(p.pos) + "</span></span></th>" + n.games.map(function (g) { return cell(p, g); }).join("") + "</tr>"; };
    var grp = function (h, list) { return list.length ? '<tr class="hqx-grp"><th scope="rowgroup" colspan="' + (n.games.length + 1) + '">' + esc(h) + "</th></tr>" + list.map(row).join("") : ""; };
    var yes = n.games.map(function (g) { return rv.pro.filter(function (p) { return availOf(p, g) === "yes"; }).length; });
    return '<div class="hqx-surface"><div class="tbl-wrap hqx-gridwrap"><table class="tbl hqx-grid"><caption class="sr">Availability for ' + esc(n.label) + "</caption><thead><tr><th scope=\"col\">Player</th>" +
      n.games.map(function (g) { return '<th scope="col"><span class="hqx-gh">' + M.crest(opp(g, code)) + '<span>' + (g.home === code ? "vs " : "at ") + esc(opp(g, code)) + '</span><span class="num">' + esc(g.time) + "</span></span></th>"; }).join("") + "</tr></thead><tbody>" +
      grp("Active roster", rv.pro) + grp("Training camp", rv.tc) + "</tbody><tfoot><tr><th scope=\"row\">Can ice a lineup</th>" +
      n.games.map(function (g, i) { var c = canIce(code, g); return '<td><span class="hqx-ice ' + (c.ok ? "ok" : "short") + '">' + S2.ic(c.ok ? "check" : "x") + '<span class="sr">' + (c.ok ? "Yes" : "Short") + '</span></span><span class="t-foot num">' + yes[i] + " of " + rv.all.length + "</span></td>"; }).join("") +
      "</tr></tfoot></table></div></div>";
  }
  /* ---------- one ticker for every countdown and every lock that passes while you watch ---------- */
  var TICK = 0, SIG = "";
  function sig() {
    var code = club(), p = me(), t = now();
    var n = curNight(byNight(weekGames(code)));   /* the night's server freeze is a phase too (review 2026-11-23) */
    return weekGames(code).map(function (g) { return lockState(g, t); }).join("") + "|" + (p ? (t >= dueOf(weekGames(p.club)) ? 1 : 0) : "") + "|" + (S2.lobby && n ? (t >= S2.lobby.releaseAt(n.games[0]) ? 1 : 0) : "");
  }
  function startTicker() {
    SIG = sig();
    if (TICK) return;
    TICK = setInterval(function () {
      if (!S2.$(".hqx") && !S2._lineups.OPEN) { clearInterval(TICK); TICK = 0; return; }
      var t = now();
      S2.$$("[data-hqcd]").forEach(function (el) {
        var ms = +el.dataset.hqcd - t;
        if (ms > 0 && el.dataset.big) { var h = bigLeft(ms); if (el.innerHTML !== h) el.innerHTML = h; return; }
        var txt = ms > 0 ? left(ms) : el.dataset.cdDone || "0:00"; if (el.textContent !== txt) el.textContent = txt;
      });
      var mt = mkNow();   /* the Bidding tab's countdowns run on the market's clock */
      S2.$$("[data-mkcd]").forEach(function (el) {
        var ms = +el.dataset.mkcd - mt, h = ms > 0 ? (el.dataset.big ? bigLeft(ms) : left(ms)) : esc(el.dataset.cdDone || "0:00");
        if (el.innerHTML !== h) el.innerHTML = h;
      });
      var s = sig(); if (s !== SIG) { SIG = s; phaseChanged(); }
    }, 1000);
  }
  function phaseChanged() {   /* a lock or the availability deadline passed: repaint what depends on it, in place */
    var code = club(), p = me();
    if (S2._lineups.OPEN) paintSheet();
    afterLineupChange();
    if (p && S2.$('[data-w="due"]')) repaint("due", function () { return dueInner(p); });
    if (S2.$('[data-w="servers"]')) repaint("servers", function () { return serversInner(code); });
  }
  /* ---------- binding: one delegated listener per workspace root ---------- */
  function bind(root, ws) {
    var host = S2.$(".hqx", root) || S2.$(".hqx-guest", root);
    var retry = S2.$("[data-retry]", root); if (retry) retry.addEventListener("click", function () { S2.route(); });
    if (!host) return;
    if (S2.poolAsks) S2.poolAsks.bind(host);
    /* availability: the pressed look on pointer-down, the answer on click. A click never follows a pan (the browser
       cancels the pointer), so a scroll that starts on a button records nothing, least of all a late answer (Rule 5.1);
       Enter and Space still answer */
    host.addEventListener("pointerdown", function (e) {
      var b = e.target.closest("[data-av]"); if (!b || e.button > 0) return;
      b.classList.add("is-pressing");
      var up = function () { b.classList.remove("is-pressing"); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
      window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    });
    host.addEventListener("click", function (e) {
      var bk = e.target.closest("[data-back]");
      if (bk) {   /* back pops the stack when this workspace's list is the entry behind; otherwise it replaces, never pushes */
        if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (BACK_POPS) history.back(); else location.replace("#/" + ws);
        return;
      }
      var b = e.target.closest("[data-av]");
      if (b) return setAvail(b.dataset.g, b.dataset.av);
      var a = e.target.closest("[data-act]"); if (!a) return;
      act(a.dataset.act, a, ws, e);
    });
    host.addEventListener("pointerdown", bdDown);   /* the bid board's drag (Bidding) */
    /* a board note is kept when it is committed (change: Enter or leaving the field), never per keystroke, so the board
       is not redrawn under the typing; a repaint that waited for the field runs once focus has moved on */
    host.addEventListener("change", function (e) {
      var sv = e.target.dataset && e.target.dataset.srv, ae = archErr();
      if (ae && (sv || (e.target.dataset && e.target.dataset.bnote))) { S2.toast(ae.message, "err"); return repaint(sv ? "servers" : "bboard", function () { return sv ? serversInner(club()) : boardInner(club()); }); }
      if (sv) {   /* a server pick is kept the moment it changes; the select stays under the finger, nothing repaints (Rule 4.2) */
        var g = gameById(sv), d = e.target.dataset, v = e.target.value, label = { first: "First choice", second: "Second choice", veto: "Veto", prefer: "Preferred server" }[d.key];
        var said = function () { return label + ", " + (g.home === club() ? "vs " : "at ") + team(g.home === club() ? g.away : g.home).city + ": " + (v || "none"); };
        /* e2's hand-over, 2026-11-24: the club's game_vetoes row through the Owner's gate (S2.lobby.savePick). The pick
           reads as kept only once the database confirms it; savePick itself says a refusal or a move sent to the Owner
           and puts the select back, so its rejection needs no second word here */
        if (!g || !S2.lobby || !S2.lobby.savePick) { console.error("[hq] S2.lobby.savePick is not on the page: the lobby (js/lobby.js, stream e2) saves server picks"); S2.toast("Server picks can't be saved from this page yet. Nothing was changed.", "err"); return repaint("servers", function () { return serversInner(club()); }); }
        S2.lobby.savePick(g, d.side, d.key, v).then(function (res) { if (!(res && res.queued)) S2.toast(said(), "ok"); }, function () { /* said by savePick */ });
        return;
      }
      var pid = e.target.dataset && e.target.dataset.bnote; if (!pid || !S2.market) return;
      mkAnswer(S2.market.boardSet(club(), pid, { note: e.target.value }), function (r) { if (!r.ok) S2.toast(texts(r.problems).join(" "), "err"); });
    });
    host.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.dataset && e.target.dataset.bnote) e.target.blur(); });
    host.addEventListener("focusout", function (e) {
      if (e.target.dataset && e.target.dataset.bnote) { setTimeout(function () { if (BOARD_DIRTY && !boardBusy()) repaintBidding(); }, 0); return; }
      if (e.target.dataset && e.target.dataset.srv) setTimeout(paintServers, 0);   /* a repaint the lobby asked for while a pick was in hand */
    });
    var kind = S2.$("#hqxKind", host); if (kind) S2.segmented(kind, function (v) {
      ST.filter = v; history.replaceState(history.state, "", "#/you?tab=inbox" + (v === "all" ? "" : "&show=" + v)); repaint("inbox", function () { return inboxInner(me()); });
    });
    ["hqxNightL", "hqxNightN"].forEach(function (id) {
      var el = S2.$("#" + id, host); if (el) S2.segmented(el, function (v) { ST.night = v; repaint("plan", function () { return planInner(club()); }); repaint("grid", gridInner); repaint("servers", function () { return serversInner(club()); }); });
    });
    bindPerms(host);   /* the Owner's permissions editor (Front office) */
    var bk = S2.$("#hqxBlk", host); if (bk) S2.segmented(bk, function (v) { ST.blk = v; repaint("tblock", function () { return blockInner(club()); }); });
    requestAnimationFrame(function () { placeMark(host); });
  }
  function act(name, a, ws, ev) {
    var p = me(), code = club(), ae = ws === "hq" && WRITE_ACTS[name] ? archErr() : null;
    if (ae) return S2.toast(ae.message, "err");
    if (name === "msg") return openMsg(p, a.dataset.id);
    /* QA function 21 (2026-11-25): Mark all read is the bell's persisted door (S2.notifs.seen, js/live.js), so marked alerts
       stay read after a reload; the reader's own overrides then give way to what the league holds (read, or still unread
       when the write was refused, which seen() says in a toast). Not through S2.write: seen()'s filter (read=false)
       answers zero rows when another tab already marked them, a correct no-op S2.write would call S2_NO_ROWS. Mark all
       unread stays this page's own choice: the league keeps no unread mark */
    if (name === "read-all") {
      var any = inbox(p).some(function (i) { return !isRead(i); });
      if (!any || !S2.notifs || !S2.notifs.seen) { inbox(p).forEach(function (i) { ST.read[i.id] = any; }); return paintInbox(p); }
      a.disabled = true;
      return S2.notifs.seen().then(function () { inbox(p).forEach(function (i) { delete ST.read[i.id]; }); paintInbox(p); });
    }
    if (name === "seat-nominate") return nominateLive(code, a.dataset.seat);
    if (name === "seat-remove") return removeLive(code, a.dataset.seat);
    if (name === "nom-withdraw") return withdrawNomLive(code, a.dataset.id);
    if (name === "mv-decide") return decideLive(code, a.dataset.id, a.dataset.v === "1");
    if (name === "mv-withdraw") return withdrawMoveLive(code, a.dataset.id);
    if (name === "perm-save") return savePerms(code, a);
    if (name === "perm-reset") { PERM.draft = JSON.parse(JSON.stringify(PERM.base)); PERM.said = "Changes discarded."; return paintPerms(code); }
    if (name === "off-retry") return reloadOffice(code);
    if (name === "srv-retry") { var sg = gameById(a.dataset.g); if (!sg || !S2.lobby || !S2.lobby.retryPicks) return S2.toast("The server picks can't be read again from here. Reload the page.", "err"); a.disabled = true; return S2.lobby.retryPicks(sg); }
    if (name === "tr-accept" || name === "tr-decline" || name === "tr-withdraw") return tradeAnswer(code, a.dataset.id, name.slice(3));
    if (name === "tr-reverse" || name === "tr-resend") return officeTrade(code, a.dataset.id, name.slice(3));
    if (name === "app-withdraw") return withdrawSheet(a.dataset.app);
    /* applyLook changes the look in place and announces it with "s2:look", which repaints the Appearance rows */
    if (name === "theme") { S2.state.theme = a.dataset.v; S2.store.set("theme", a.dataset.v); return S2.applyLook(); }
    if (name === "discord") return dcSheet();
    if (name === "join") return joinSheet();
    if (name === "player") return playerSheet(a.dataset.pid);
    if (name === "rq" || name === "rq-reply") return reqSheet(code, a.dataset.id, name === "rq" ? a.dataset.v : "reply");
    if (name === "block-list") return blockSheet(code);
    if (name === "block") { var lp = M.player(a.dataset.pid); a.disabled = true; return lp && blockLive(lp, false, function (e, res) { a.disabled = false; if (e) S2.toast(e.message, "err"); else S2.toast(blockSaid(lp, false, res), "ok"); }); }
    if (name === "claim") return claimDoor(a.dataset.pid);
    if (name === "badd") return poolSheet(code);
    if (name === "ceil" || name === "bmove" || name === "bremove") return boardAct(name, a, ev);
    if (name === "sheet") return openSheet(code, a.dataset.g);
    if (name === "file-night") return fileNight(code);
    /* a commissioner's preview club (commissioner-club-preview v2.86), kept on this device; the workspace is drawn for it */
    if (name === "view-as") {
      var vs_ = sheet({ title: "View Team HQ as", back: ['[data-act="view-as"]'], html: '<p class="t-sub">Pick a club. You see it as its Owner and keep full control.</p><div class="list">' + M.teams.map(function (t) {
        return '<button class="row inset" data-x="' + t.code + '">' + M.crest(t.code) + '<span class="grow title">' + esc(t.full) + "</span>" + (t.code === code ? '<span class="hqx-tick">' + S2.ic("check") + "</span>" : "") + "</button>"; }).join("") + "</div>" });
      vs_.el.addEventListener("click", function (e) { var x = e.target.closest("[data-x]"); if (!x) return; setClub(x.dataset.x); ST.night = null; vs_.close(); S2.route(true); });
    }
  }

  /* ---------- after a render: direction-aware entrance inside a workspace, then bind ---------- */
  function after(root, r, ws) {
    var host = S2.$(".hqx", root), wide = matchMedia("(min-width: 900px)").matches;
    if (host) {
      var isRoot = host.dataset.root === "true", key = host.dataset.tab + "|" + isRoot;
      /* a detail reached from this workspace's own list (a link or Forward) has that list one entry behind it; a soft
         re-render of the same detail (theme, finish, view-as) keeps what it knew */
      BACK_POPS = !isRoot && SOFT && !!LAST && LAST.ws === ws && (LAST.root || (LAST.key === key && BACK_POPS));
      if (SOFT && LAST && LAST.key !== key && host.animate) {
        var dir = wide ? "swap" : LAST.root && !isRoot ? "push" : !LAST.root && isRoot ? "pop" : "swap";
        var el = dir === "pop" ? S2.$(".hqx-side", host) : S2.$(".hqx-pane", host);
        var frames = S2.reduce.matches || dir === "swap" ? [{ opacity: 0 }, { opacity: 1 }] :
          [{ opacity: 0, transform: "translateX(" + (dir === "push" ? 32 : -32) + "px)" }, { opacity: 1, transform: "none" }];   /* in from the side it will leave by */
        var split = S2.$(".hqx-split", host); split.style.overflowX = "clip";   /* the push must not widen the page for its 320ms */
        el.animate(frames, { duration: dir === "swap" ? 160 : 320, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }).onfinish = function () { split.style.overflowX = ""; };
      }
      LAST = { ws: ws, role: S2.state.role, key: key, root: isRoot };
    } else LAST = { ws: S2.$(".hqx-guest", root) ? "you-guest" : ws, role: S2.state.role, key: "", root: true };
    bind(root, ws);
    startTicker();
  }
  window.addEventListener("resize", function () { if (S2.$(".hqx-gauge")) placeMark(document); });

  /* ---------- pages ---------- */
  S2.page("hq", {
    /* "<section> · Team HQ", which the router gives S2.setTitle (QA round 2 A1, 2026-11-25: a tab named itself alone,
       "Roster & cap · CGHL", with no word of the workspace it is in) */
    title: function (r) { var t = valid(HQ_TABS, r.q.tab); return t ? tabName(HQ_TABS, t) + " · Team HQ" : "Team HQ"; },
    tab: "hq", views: HQ_TABS,   /* the header's Workspaces menu lists these (js/core.js navTabs) */
    render: function (r) { try { if (!M) throw new Error("S2.M is missing"); return hqHtml(r); } catch (e) { return fail("Team HQ", e); } },
    after: function (root, r) { try { after(root, r, "hq"); } catch (e) { console.error("[hq] Team HQ failed to wire up", e); } }
  });
  /* e0 split (2026-11-24): the inbox moved to js/inbox.js, the You page to js/pages/you.js and the Lineups tab
     (with the lineup sheet) to js/pages/lineups.js; they load after this file, in that order. This file reaches their
     functions through these forwarders, looked up by name at call time, reads the open lineup sheet as
     S2._lineups.OPEN, and shares its own pieces with them through S2._hq */
  function afterLineupChange() { return S2._lineups.afterLineupChange.apply(this, arguments); }
  function dcSheet() { return S2._you.dcSheet.apply(this, arguments); }
  function dueInner() { return S2._you.dueInner.apply(this, arguments); }
  function fileNight() { return S2._lineups.fileNight.apply(this, arguments); }
  function gameById() { return S2._lineups.gameById.apply(this, arguments); }
  function inbox() { return S2._inbox.inbox.apply(this, arguments); }
  function inboxInner() { return S2._inbox.inboxInner.apply(this, arguments); }
  function isRead() { return S2._inbox.isRead.apply(this, arguments); }
  function joinSheet() { return S2._you.joinSheet.apply(this, arguments); }
  function openMsg() { return S2._inbox.openMsg.apply(this, arguments); }
  function openSheet() { return S2._lineups.openSheet.apply(this, arguments); }
  function paintInbox() { return S2._inbox.paintInbox.apply(this, arguments); }
  function paintSheet() { return S2._lineups.paintSheet.apply(this, arguments); }
  function paneLineups() { return S2._lineups.paneLineups.apply(this, arguments); }
  function planInner() { return S2._lineups.planInner.apply(this, arguments); }
  function setAvail() { return S2._you.setAvail.apply(this, arguments); }
  function withdrawSheet() { return S2._you.withdrawSheet.apply(this, arguments); }
  function youMeta() { return S2._you.youMeta.apply(this, arguments); }
  S2._hq = { M: M, SLOTS: SLOTS, ST: ST, about: about, after: after, archErr: archErr, atGroup: atGroup, availOf: availOf, minsInForce: minsInForce,
    availWord: availWord, blockLive: blockLive, blockSaid: blockSaid, byNight: byNight, cal: cal, calText: calText, cd: cd, clock: clock,
    closeOnLinks: closeOnLinks, club: club, clubGames: clubGames, curNight: curNight, dateBlock: dateBlock,
    dueOf: dueOf, empty: empty, esc: esc, fail: fail, filledN: filledN,
    floorOf: floorOf, frame: frame, head: head, hqMeta: hqMeta,
    ic: ic, inkAttrs: inkAttrs, iso: iso, keep: keep, limitOf: limitOf, lockOf: lockOf, lockState: lockState,
    luOf: luOf, luStatus: luStatus, mark: mark, me: me, minsAgo: minsAgo, money: money,
    navRow: navRow, nextInner: nextInner, nightSeg: nightSeg, noYear: noYear, now: now, opp: opp, pinFoot: pinFoot,
    planRow: planRow, plural: plural,
    readyInner: readyInner, refreshNav: refreshNav, repaint: repaint,
    seatHeld: seatHeld, setClub: setClub, sheet: sheet,
    slotOf: slotOf, soft: soft, squadOf: squadOf, stamp: stamp, startTicker: startTicker,
    tabName: tabName, tag: tag, tbc: tbc, team: team, timeHtml: timeHtml, valid: valid,
    vs: vs, vsHtml: vsHtml, weekGames: weekGames, youTabs: youTabs };
})();
