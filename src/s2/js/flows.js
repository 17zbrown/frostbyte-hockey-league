/* CGHL Season 2: the filed forms. Every door that writes on the site (an application, a sign-up, a case, a message,
   the member's profile) opens here as a form whose fields, options and wording are the current site's (src/live
   part_live.js, part6_hub.js); where Season 2 changes a form (committees instead of departments) the Season 2 rule wins.
   A door is any element with data-flow="<name>" (data-* on it reach the flow as ctx). The trade door opens a page
   instead (def.page: the Team HQ trade builder, js/pages/tradebuild.js). A door this role may not use opens S2.locked
   (who may, and why); a guest at a member door meets Join with Discord (S2.joinSheet). Saturday bidding is not a form: a
   bid is one button with the exact next price in the Bid room (js/market.js), so this file has no bid flow.
   i3a (2026-11-25): the demo path that stood beside every form (sample answers, the demo receipt, filings kept in the
   tab, the seat and rule locks with their "anyway" doors, the placeholder committee managers and suspension requests)
   is gone; each form runs only its real door below. */
(function () {
  "use strict";
  var esc = S2.esc;
  function M() { return S2.M; }

  /* ---------- v5.00 swap (stream e5, 2026-11-24): the doors ----------
     Every filed form goes through S2.write to the door the current site files it through (src/live is the reference;
     write-paths.md section 3), and nothing shows as filed until the database confirms it. A refusal keeps every answer
     and shows the database's own words. A form with no door yet says so at its top and refuses to file (fail loud),
     never pretends. A confirmed filing fires "s2:filed" on document with { flow, data, result } for the pages that
     repaint from it. Every permission is the database's: a Rule 2.7 conflict or a closed window is a note on the form,
     never a lock (contracts/client-api.md: isStaff, isCommissioner and seat are display hints, never a gate for a
     write), and the database's refusal is what stops it. */
  function fail(msg, code) { var e = new Error(msg); e.code = code || "S2_FORM"; return e; }
  function fromDb(err) { var e = fail(err && err.message || "The league could not read that.", err && err.code); e.hint = err && err.hint || null; return e; }
  /* the database's sentence, without the machine prefix some guards lead with (the live site strips the same ones) */
  /* QA nits 2026-11-25: JOIN_DISCORD (require_registration_details) reached a member verbatim; APPLICATION
     (guard_app_insert) is stripped too */
  var PREFIX = /^[\s\S]*?\b(?:SIGN_UP_FIRST|ONE_EDIT|WITHDRAW|DETAILS|SURVEY|COMMITTEE|JOIN_DISCORD|APPLICATION):\s*/;
  function said(e) { return String(e && e.message || e || "").replace(PREFIX, "").trim() || "The league did not save that. Try again."; }
  function me() { return S2.session && S2.session.profileId || null; }
  function signedIn() { if (!me()) throw fail("Sign in with Discord first.", "S2_SIGNED_OUT"); return me(); }
  function trim(v) { return String(v == null ? "" : v).trim(); }
  function orNull(v) { return trim(v) || null; }
  /* the season taking sign-ups (CG.regSeason): the newest row with registration open, as the league read carries it */
  function regSeason() {
    var rows = M() && M().control ? M().control.seasons.map(function (s) { return s.settings; }) : [];
    return rows.filter(function (s) { return s && s.registration_open; }).sort(function (a, b) { return b.number - a.number; })[0] || null;
  }
  /* owner applications are open: the season taking sign-ups has an owner_app_deadline still ahead of the moment the league
     was read (M.now, as the Today band reads it). ONE reading for Team HQ's lock, the Season menu and You > Applications
     (QA functional 2026-11-25: after the close two of them still invited members to apply, and the database refused) */
  function ownerAppsOpen() {
    var s = regSeason(), now = M() && M().now ? M().now.getTime() : Date.now();
    return !!(s && s.owner_app_deadline && Date.parse(s.owner_app_deadline) > now);
  }
  /* the season on screen (CG.SEASON): what a case is filed under */
  function viewSeason() { var c = M() && M().control, v = M() && M().view, s = c && v ? c.season(v.season) : null; return s ? s.settings : null; }
  /* signed up for the season taking sign-ups: true, false, or null when this page holds another season's sign-ups */
  function signedUp() {
    var s = regSeason(), id = me();
    if (!s || !id || !M().view || M().view.season !== s.number) return null;
    return M().signups.some(function (r) { return r.pid === id && r.status !== "declined"; });
  }
  /* RULING 2026-11-23 ("Trade requests should be removed following the passing of the trade deadline"): from Season 2 a
     trade request cannot be filed once moves lock. The database refuses it (guard_trade_request_deadline, hint
     trade_requests_closed, record on db/s2-deadline) and the door goes once the deadline passes, or once the database
     has said so in this tab.
     shortcut: reads Season 2's deadline (M.s2cal.deadline); Season 3 needs the model to carry each season's own */
  var tradeClosedSaid = false;
  function tradeRequestsClosed() { var c = M() && M().s2cal; return tradeClosedSaid || !!(c && c.deadline && Date.now() >= Date.parse(c.deadline)); }
  /* members by name, for the "who" and "to" boxes: a typed name resolves to the member's profile. Every member the
     league read lists (M.members), not only the players (QA nits 2026-11-25: a member who never played or signed up, a
     Discord-only member for one, could not be picked) */
  function people() { return M() ? M().members || M().players : []; }
  function memberNames() { return people().map(function (p) { return p.tag; }).filter(Boolean); }
  function memberByName(name) { var n = trim(name).toLowerCase(); return n ? people().filter(function (p) { return String(p.tag || "").toLowerCase() === n; })[0] || null : null; }
  /* the member's own application, read before the form opens so an edit starts from what is on file (an upsert from an
     empty form would replace every answer) and the one edit is asked about before it is spent. The read client is
     js/live.js's (S2.ensureSb); no client is an error, never an empty answer */
  var OWN_COLS = "id,status,ea_id,availability,experience,preferred_club,franchise_2,franchise_3,pitch,edited_at", STAFF_COLS = "id,status,departments,availability,experience,pitch";
  /* kind "profile": the member's own details (the live site holds them in CG.auth.profile and fills Settings and the
     sign-up details from it). Review 2026-11-24: the League profile form opened empty, so a member setting only a jersey
     number had to retype the EA ID the box-score importer matches on, and a save without the server picked again wrote
     preferred_server null over the one their management reads (Rule 4.2). A member always has a profiles row, so none is
     an error, never an empty form */
  var PROFILE_COLS = "id,ea_id,platform,platform_gamertag,preferred_server,jersey_number";
  function mine(kind) {
    return Promise.resolve().then(function () {
      var sb = S2.ensureSb && S2.ensureSb(), id = signedIn(), s = regSeason();
      if (!sb) throw fail("Not connected to the league. Reload the page and try again.", "S2_OFFLINE");
      if (kind === "owner" && !s) throw fail("Owner applications are not open: no season is taking sign-ups.");
      var q = kind === "owner" ? sb.from("owner_applications").select(OWN_COLS).eq("profile_id", id).eq("season_id", s.id)
        : kind === "profile" ? sb.from("profiles").select(PROFILE_COLS).eq("id", id)
        : sb.from("staff_applications").select(STAFF_COLS).eq("profile_id", id);
      return q.maybeSingle().then(function (r) {
        if (r.error) throw fromDb(r.error);
        if (kind === "profile" && !r.data) throw fail("Your league profile was not found. Sign out, sign in again and retry.", "S2_NO_PROFILE");
        return r.data || null;
      });
    });
  }
  /* the three details the database needs before a sign-up (CG.regMissing's three), as the form holds them */
  function detailsFrom(d, p) { d.ea = p.ea_id || ""; d.console = p.platform || ""; d.tag = p.platform_gamertag || ""; }
  function detailsChanged(d, p) { return trim(d.ea) !== trim(p.ea_id) || (d.console || "") !== (p.platform || "") || trim(d.tag) !== trim(p.platform_gamertag); }
  function committeeKey(name) { var c = S2.COMMITTEE_DEFS.filter(function (x) { return x.name === name || x.key === name; })[0]; return c ? c.key : null; }
  function committeeName(key) { var c = S2.COMMITTEE_DEFS.filter(function (x) { return x.key === key; })[0]; return c ? c.name : null; }
  /* a { data } answer from a door that confirms in its payload (withdraw_owner_application, withdraw_staff_application) */
  function confirmed(r, status) {
    var d = r && r.data;
    if (!d || !d.ok || d.status !== status) throw fail("The league did not confirm it. Reload the page and check your application.", "S2_UNCONFIRMED");
    return d;
  }

  /* ---------- the ONE news writer (gaps, 2026-11-25): the Staff Desk's Write a story (FLOWS.story) and the Control
     Center's League news both publish through it, as the classic Newsroom does (src/live/part_live.js CG.newsForm:
     news.insert, a headline of at least eight characters, a body, one of CG.NEWS_CATS stored as written, the poster's name
     and seat as the byline, the season's id so the story shows in that season's newsroom). The INSERT fires
     on_news_notify_discord (notify_discord_news): the headline, the category and the first 280 characters of the story
     post to the Discord news channel for every category but the automatic 'Player Spotlight' (none of the six a person
     picks), and that post cannot be taken back from the site, so both forms say NEWS_SAYS and ask before publishing. The
     database decides who may (news RLS: a commissioner, or has_department('media'), which the held Season 2 staff powers
     record opens to every staffer) and its refusal is shown in its own words ---------- */
  var NEWS_SAYS = "It shows on the site at once and posts to the Discord news channel: the headline, the category and the start of the story, for everyone on the server. The Discord post cannot be taken back from the site.";
  function newsLabel(c) { return c.charAt(0) + c.slice(1).toLowerCase(); }   /* the kicker voice: sentence case on screen, stored as written */
  function newsCheck(o) {
    o = o || {};
    if (!trim(o.title)) return "Give the story a headline.";
    if (trim(o.title).length < 8) return "Give the story a real headline, at least eight characters.";
    if (!trim(o.body)) return "Write the story before publishing it.";
    if (S2.CG.NEWS_CATS.indexOf(o.category) < 0) return "Choose one of the newsroom's categories.";
    var s = viewSeason(); if (!s || !s.id) return "The season on screen was not read from the league, so the story would not show in its newsroom. Reload the page.";
    return "";
  }
  function newsPublish(o) {
    return Promise.resolve().then(function () {
      signedIn();
      var bad = newsCheck(o); if (bad) throw fail(bad, "S2_BAD_CALL");
      var p = S2.auth && S2.auth.profile, who = (p && (p.gamertag || p.display_name)) || "League office";
      return S2.write("news.insert", { row: { season_id: viewSeason().id, category: o.category, title: trim(o.title), body: trim(o.body),
        author: who + ", " + (S2.session.isCommissioner ? "Commissioner" : "League staff"), published_at: new Date().toISOString() } }, { sections: ["news"] });
    });
  }
  S2.news = { SAYS: NEWS_SAYS, label: newsLabel, check: newsCheck, publish: newsPublish };

  /* ---------- the league's own lists (one copy each, from the live site) ---------- */
  /* CG.NHL_FRANCHISES (part_live.js:4006) */
  var FRANCHISES = ["Anaheim Ducks", "Boston Bruins", "Buffalo Sabres", "Calgary Flames", "Carolina Hurricanes", "Chicago Blackhawks", "Colorado Avalanche",
    "Columbus Blue Jackets", "Dallas Stars", "Detroit Red Wings", "Edmonton Oilers", "Florida Panthers", "Los Angeles Kings", "Minnesota Wild", "Montreal Canadiens",
    "Nashville Predators", "New Jersey Devils", "New York Islanders", "New York Rangers", "Ottawa Senators", "Philadelphia Flyers", "Pittsburgh Penguins",
    "San Jose Sharks", "Seattle Kraken", "St. Louis Blues", "Tampa Bay Lightning", "Toronto Maple Leafs", "Utah Mammoth", "Vancouver Canucks",
    "Vegas Golden Knights", "Washington Capitals", "Winnipeg Jets"];
  /* CG.POS_NAME in the registration chip order (part_live.js:3415): Center first and selected */
  var POS = [["C", "Center"], ["LW", "Left Wing"], ["RW", "Right Wing"], ["LD", "Left Defense"], ["RD", "Right Defense"], ["G", "Goaltender"]];
  /* CG.PLATFORMS (part2_engine.js:115): the tag's label follows the console */
  var CONSOLES = [["XSX", "Xbox", "Xbox Gamertag"], ["PS5", "PlayStation", "PSN Name"]];
  var SERVERS = S2.lobby.SERVERS;   /* CG.SERVERS, Rule 4.2: one list, in js/lobby.js */
  /* Season 2 staffing (commissioner, 2026-10-19): one staff group, committees by topic, each with a manager */
  /* no Media committee: commissioner, 2026-10-22: "remove the Media staff position from the concept since we will not have that role next season" */
  /* RULING 2026-11-23 (commissioner): six committees. Game Operations is gone and its work went to Officiating ("Officiating
     and discipline" renamed); "Draft" renamed "Draft and Bidding". THE one definition: the staff form, the Staff Desk, the
     Control Center, search and the rulebook's Rule S2.8 all read it. Each committee has one manager, who sets its
     priorities and is the go-to person; every staffer and commissioner has the same vote (owner, staff, GM/AGM and committee
     manager applications pass at more than half of all of them); a manager seat is filled by staff applying and all the
     other staff voting. The ONLY seat with powers of its own is Draft and Bidding's (S2.has("draftbid")).
     charter: the topics, written as they read mid-sentence (proper nouns and initialisms keep their capitals; review
     2026-11-23: lowering every first letter printed "gM and AGM applications" and "saturday bidding") */
  S2.COMMITTEE_DEFS = [
    { key: "officiating", name: "Officiating", charter: ["complaints and appeals", "forfeits", "warnings and suspensions", "lineups and late changes", "game-night problems", "held games", "reschedules and the schedule"] },
    { key: "statistics", name: "Statistics and imports", charter: ["EA imports", "unmatched players", "games under an outside club", "the Stats manager", "corrections", "titles and trophies", "ratings", "Players of the Week"] },
    { key: "applications", name: "Applications", charter: ["owner applications", "staff applications", "GM and AGM applications", "committee manager applications", "keeping every staff vote moving"] },
    { key: "community", name: "Community", charter: ["Discord welcomes", "member questions", "Discord conduct reports", "departures", "news and announcements", "the survey", "pickup lobbies"] },
    { key: "transactions", name: "Transactions", charter: ["waivers and claims", "roster moves", "trades", "position changes", "contracts and the cap", "GM and AGM nominations", "the movement deadline"] },
    /* commissioner, 2026-11-23: a skipped pick is filled at $750K ("750k works") */
    { key: "draft", name: "Draft and Bidding", charter: ["draft night", "skipped picks, filled right after the draft by a random undrafted player who keeps the club able to meet the minimums, at $750K, or lapsing when none fits", "Saturday bidding", "the training camp pool"], powers: true }
  ];
  function upFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  /* "Complaints and appeals, forfeits, ... and reschedules and the schedule." for a card's line; upFirst for a list item */
  S2.committeeCovers = function (c) { var a = c.charter; return upFirst(a.slice(0, -1).join(", ") + " and " + a[a.length - 1]) + "."; };
  S2.committeeItem = upFirst;
  S2.COMMITTEES = S2.COMMITTEE_DEFS.map(function (c) { return c.name; });
  /* ONE table from a case type to the committee whose topic it is (review 2026-11-23: position changes were tagged
     Officiating in two places; they are Transactions' by the ruling). Every desk and Control Center tag reads it */
  S2.CASE_COMMITTEE = { complaint: "officiating", appeal: "officiating", forfeit_appeal: "officiating", position_change: "transactions", stats_correction: "statistics", stat_fix: "statistics", discipline: "officiating" };
  S2.caseCommittee = function (type) { return S2.CASE_COMMITTEE[type] || "officiating"; };

  /* ---------- Season 2 discipline: who may suspend, and for how long (commissioner, 2026-11-23, replacing Rule 7.2's
     staff limits from Season 2 on). Only a committee manager or a commissioner issues a suspension. A manager suspends a
     rostered member for up to eighteen (18) games in steps of three, or a member with no roster spot to a date up to
     fourteen (14) days away (the live split, which the commissioner kept); anything longer, and every suspension for the
     rest of a season with no exception, is applied for and a commissioner approves it or not. Other staff cannot suspend:
     they file a suspension request for a manager or a commissioner to act on. Bans are a commissioner's alone. Every
     staffer may still issue a formal warning.
     route(d) -> "issue" (in force now) | "approval" (waits for a commissioner) | "request" (waits for a manager or a
     commissioner) | "ban" (a commissioner's; the form's lock catches it first). Who holds a committee manager seat is the
     database's (public.committees, read into S2.session.committees and by the Staff Desk), never a list here ---------- */
  var DISC = { days: 14, games: 18 };
  /* calendar days from the league's today (Eastern) to the last day: a date exactly fourteen days on counts as fourteen
     (review 2026-11-23: rounding the hours up made it fifteen and sent it to a commissioner) */
  function discDays(until) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(until || "")); if (!m) return 0;
    var today = M() && M().now ? M().etDay(M().now.toISOString()) : new Date().toISOString().slice(0, 10), t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(+t[1], +t[2] - 1, +t[3])) / 864e5);
  }
  /* the length as a manager may issue it alone, or not: one definition for a new form and for a request a manager acts on */
  function withinManager(d) {
    if (d.kind === "season") return false;
    if (d.kind === "games") return +d.games <= DISC.games;
    if (d.kind === "date") return discDays(d.until) <= DISC.days;
    return true;
  }
  function discRoute(d) {
    if (!d || d.kind === "warn") return "issue";
    if (d.kind === "ban") return S2.has("commish") ? "issue" : "ban";
    if (S2.has("commish")) return "issue";
    if (!S2.has("manager")) return "request";
    return withinManager(d) ? "issue" : "approval";
  }
  function an(n) { return /^(8|11|18|8\d)$/.test(String(n)) ? "an " : "a "; }
  function readable(iso) { return M() && /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? M().etLong(iso + "T17:00:00Z") : String(iso || "a date"); }
  function discWhat(d) {
    return d.kind === "warn" ? "a formal warning" : d.kind === "ban" ? "a ban" : d.kind === "season" ? "a suspension through the season" :
      d.kind === "games" ? an(d.games) + (d.games || "?") + "-game suspension" : d.kind === "date" ? "a suspension of " + discDays(d.until) + " days, to " + readable(d.until) : "discipline";
  }
  S2.discipline = {
    LIMITS: DISC, days: discDays, route: discRoute, what: discWhat, within: withinManager,
    /* the suspension requests and applications waiting on a decision: public.suspension_requests, which the held staffing
       flip (db/s2-committees) creates; the Staff Desk reads it (desk.js). Production has no such table yet, so nothing
       waits. shortcut: none are counted here; read the pending rows when the flip lands */
    waiting: function () { return []; },
    ROUTE_SAY: { issue: "In force now", approval: "Waiting for a commissioner's approval", request: "Waiting for a committee manager or a commissioner" }
  };
  /* CG.ACTION_META (part_live.js:9004) and the complaint and appeal subjects of the Action Center modal */
  var CASE_TYPES = [
    ["complaint", "Complaint", "Conduct, cheating, no-shows or anything else the league office should know about."],
    ["appeal", "Suspension or ban appeal", "Appeal a suspension, ban or penalty within 48 hours (Rule 7.6)."],
    ["trade_request", "Trade request", "Ask your club's front office to trade you. Private to them (Rule 2.3)."],
    ["position_change", "Position change", "Ask to change your registered position."],
    /* the key is the database's (action_requests_type_check): "stat_fix" was the old form's own and would be refused */
    ["stats_correction", "Statistics correction", "Club management only: a box score the EA import got wrong (Rule 6.3)."],
    /* guard_forfeit_appeal takes only an automatic game-limit forfeit (Rule 5.2); Season 2 has no weekly limit, so any
       other ruling is a complaint, as the database's refusal says */
    ["forfeit_appeal", "Forfeit appeal", "Club management only: appeal an automatic forfeit for playing someone over the weekly game limit (Rule 5.2). A commissioner decides it. Any other forfeit, a missed lineup deadline included, is disputed with a complaint."]
  ];
  /* header v2: ONE gate for the case form's Type step and the header's Action Center (js/core.js S2.NAV), so a door never
     offers a type the form would drop. A trade request is a rostered player's (Rule 2.3: it goes to their own club's front
     office), so it is offered only to a member on a club this season (S2.session.teamId), as send() requires (QA round 2,
     2026-11-25: a member with no club was offered it and refused only after writing the reason) */
  S2.caseTypes = function () {
    return CASE_TYPES.filter(function (c) {
      return ((c[0] !== "stats_correction" && c[0] !== "forfeit_appeal") || S2.has("office")) &&
        (c[0] !== "trade_request" || !tradeRequestsClosed()) && (c[0] !== "trade_request" || !!(S2.session && S2.session.teamId));
    });
  };
  var COMPLAINT_ABOUT = ["Player conduct or toxicity", "Harassment or abuse", "Cheating or exploiting", "Trolling or griefing in game", "No-show or forfeit",
    "Lag or connection manipulation", "Manager or GM conduct", "Commissioner or staff conduct", "Rulebook violation", "Discord behavior", "Something else"];
  var APPEAL_WHAT = ["Single-game suspension", "Multi-game suspension", "Season ban", "Permanent ban", "Forfeit ruling", "Roster or cap penalty", "Warning or strike",
    "Trade reversal", "Something else"];
  /* the filer's own club (S2.session.teamCode), read when a form opens (header v2: a fixed "DET" listed Detroit's games for
     every club's statistics correction and forfeit appeal) */
  function home() { return S2.session.teamCode || null; }
  var OTHER_GAME = "other";

  /* the model's one money format ($750K, $1.25M), so the trade picker reads like the Season page and Team HQ */
  function money(n) { return M() ? M().money(n) : "$" + n; }
  function teams() { return M() ? M().teams.slice().sort(function (a, b) { return a.full.localeCompare(b.full); }) : []; }
  function playerOpt(p) { return [p.id, p.tag + " · " + (p.posName || p.pos || "")]; }
  function gameOpt(g) { return [g.id, (M().etMonthDay ? M().etMonthDay(g.at) + ": " : "") + g.away + " at " + g.home]; }
  /* the last twelve finals (a club's, or the ones it forfeited: g.forfeit is the forfeiting club, and only that club may
     appeal, part_live.js:9339), plus the game a door was opened from */
  function recentGames(code, forfeits, keep) {
    if (!M()) return [];
    var out = M().games.filter(function (g) { return g.isFinal && (!code || g.home === code || g.away === code) && (!forfeits || g.forfeit === code); }).slice(-12).reverse().map(gameOpt);
    var g = keep && M().game(keep);
    if (g && !out.some(function (o) { return o[0] === g.id; })) out.unshift(gameOpt(g));
    return out;
  }

  /* ---------- flows ----------
     A flow: { title, who: "member"|"office"|"staff"|"commish", lede, steps: [{ t, fields }], submit, done(data, ctx) }.
     A field: { k, label, type, req, opts, max, help, ph, show(data), refresh, min, step, check(v, data) }.
     Types: text, textarea, select, pills (one), multi (several, max), check, number, date, cards, players, html. */
  var FLOWS = {
    register: {
      title: "Register for Season 2", who: "member",
      lede: "Every player signs up again for Season 2, including everyone who played in Season 1 (Rule S2.2).",
      steps: [
        { t: "Your details", note: function () { return "The league needs your EA ID, console and tag before you can register. What you have on file is filled in: change anything that is wrong."; }, fields: [
          { k: "ea", label: "EA ID", type: "text", req: true, ph: "e.g. YourEAName", help: "Exactly as it shows on your box score.", min: 2 },
          { k: "console", label: "Console", type: "select", req: true, opts: CONSOLES.map(function (c) { return [c[0], c[1]]; }), help: "CGHL is played on console.", refresh: true },
          { k: "tag", label: function (d) { var c = CONSOLES.filter(function (x) { return x[0] === d.console; })[0]; return c ? c[2] : "Xbox Gamertag or PSN Name"; },
            type: "text", req: true, help: "Shown to your club's management and to league staff, never publicly.", min: 2 } ] },
        { t: "Position", fields: [
          { k: "pos", label: "Primary position", type: "pills", req: true, opts: POS, value: "C" } ] }
      ],
      submit: "Submit registration",
      /* the database refuses a sign-up from outside the league Discord (require_registration_details, JOIN_DISCORD), as
         the current site checks first (CG.registerForSeason): the form says so before the member fills it in (QA nits
         2026-11-25) */
      notes: function () { var pr = S2.auth && S2.auth.profile; return pr && pr.in_guild === false ? ["You must be in the Chel Gaming Discord server to register (Rule 1.1). Join it with the Discord account you signed in with, then re-check in Settings."] : []; },
      /* the details on file fill the first step (review 2026-11-24: a member with all three on file had to type their EA ID
         again, and the sign-up then wrote what they typed over the one the importer matches on) */
      prep: function (d, ctx) { return mine("profile").then(function (p) { ctx.onFile = p; detailsFrom(d, p); }); },
      readWhat: "Your details on file",
      /* CG.savePlayerDetails then CG.registerForSeason: the three details go on the profile first when one is missing or
         the member changed one (CG.regMissing: the live site asks only then), because the database refuses a sign-up
         without them (require_registration_details snapshots them onto the registration), then the registration for the
         season taking sign-ups, re-read so the sign-up shows across the site */
      send: function (d, ctx) {
        var s = regSeason(), id = signedIn(), p = ctx.onFile;
        if (!s || !s.id) return Promise.reject(fail("No season is taking sign-ups right now."));
        var details = p && !detailsChanged(d, p) ? Promise.resolve() :
          S2.write("profiles.update", { set: { ea_id: trim(d.ea), platform: d.console, platform_gamertag: trim(d.tag) }, match: { id: id } }).then(function () {
            ctx.onFile = Object.assign({}, p, { ea_id: trim(d.ea), platform: d.console, platform_gamertag: trim(d.tag) });   /* a refused sign-up retried does not write them twice */
          });
        return details.then(function () {
          return S2.write("season_registrations.upsert", { row: { season_id: s.id, profile_id: id, position: d.pos }, onConflict: "season_id,profile_id" }, { sections: ["signups"] });
        });
      },
      /* the cutoff only ends draft entry (part_live.js:3424) */
      done: function (d) { return { t: "You're registered for Season 2!", lines: ["Sign up by the draft cutoff, 11:59 PM ET the day before the draft, to be in the draft. A later sign-up, or a player not drafted, joins the league-wide training camp pool (Rule S2.5).",
        "Leaving the Discord server withdraws a sign-up after one day's grace (Rule 1.1)."], go: ["#/you?tab=season", "See Your season"] }; }
    },

    owner: {
      title: "Apply to own a club", who: "member",
      /* Rule 2.7, commissioner, 2026-11-23: "Staffers cannot submit owner applications and team managers cannot submit staff
         applications until they remove themselves or are removed from their seat." The database refuses it
         (guard_app_role_conflict); the form says so first in its notes, below */
      /* "the review board" was the Season 1 Applications department; Season 2: every staffer votes (2026-11-23) */
      lede: "Every club is decided again for Season 2, so current Owners apply too. Only a member signed up to play in Season 2 may apply. The staff may vote while applications are open, and none is decided before they close (Rule S2.2).",
      /* the real site reads the application on file first (mine): an edit starts from it, and the one edit (v4.20) is
         asked about before it is spent */
      prep: function (d, ctx) {
        return mine("owner").then(function (a) {
          ctx.prev = a;
          if (a) { d.ea = a.ea_id || ""; d.avail = a.availability || ""; d.exp = a.experience || ""; d.f1 = a.preferred_club || ""; d.f2 = a.franchise_2 || ""; d.f3 = a.franchise_3 || ""; d.why = a.pitch || ""; }
        });
      },
      /* what the database will say, said first (the words are guard_app_role_conflict's, ab_guard_owner_app_signed_up's and
         guard_owner_app_one_edit's); the form still files, and the database decides */
      notes: function (d, ctx) {
        var out = [], s = regSeason(), a = ctx.prev, close = s && Date.parse(s.owner_app_deadline);
        if (S2.session.isCommissioner) out.push("Commissioners cannot apply to own a club (Rule 2.7). Step down as commissioner first, then apply.");
        else if (S2.session.isStaff) out.push("Members of the league staff cannot apply to own a club (Rule 2.7). Leave the staff first, then apply.");
        if (signedUp() === false) out.push("Only a member signed up to play in " + (s.name || "Season " + s.number) + " may apply. Sign up first, then apply.");
        if (close && Date.now() >= close) out.push("Owner applications closed on " + M().etFull(new Date(close).toISOString()) + ".");
        if (a && a.status === "pending") out.push(a.edited_at ? "You have used your one edit, so your application is final unless the league office changes it. You may still withdraw it from Applications." :
          "Your application is in review. You may change it once: saving a change uses your one edit.");
        return out;
      },
      confirm: function (d, ctx) { var a = ctx.prev; return a && a.status === "pending" ? (ownerChanged(d, a) && !a.edited_at ? "Use your one edit" : "Save application") : a ? "File it again" : "Submit application"; },
      /* CG.submitOwnerApp: one row per member per season (onConflict profile_id,season_id since v3.95); the database
         stamps the season, checks the sign-up, Rule 2.7, the close and the one edit */
      send: function (d) {
        var s = regSeason(), id = signedIn();
        if (!s || !s.id) return Promise.reject(fail("Owner applications are not open: no season is taking sign-ups."));
        return S2.write("owner_applications.upsert", { row: { season_id: s.id, profile_id: id, ea_id: trim(d.ea), availability: orNull(d.avail), experience: orNull(d.exp),
          preferred_club: d.f1, franchise_2: orNull(d.f2), franchise_3: orNull(d.f3), pitch: trim(d.why), status: "pending", updated_at: new Date().toISOString() },
          onConflict: "profile_id,season_id", select: "id,status,edited_at" });
      },
      steps: [
        { t: "About you", fields: [
          { k: "ea", label: "EA ID", type: "text", req: true, ph: "Your EA account name" },
          { k: "avail", label: "Typical availability (optional)", type: "text", ph: "e.g. Weeknights after 9 PM ET" },
          { k: "exp", label: "League or management experience (optional)", type: "textarea", rows: 2, ph: "Leagues you've played or managed in" } ] },
        { t: "Franchises", note: "Pick the three NHL franchises you would most like to run, in order. Any of the 32 may be chosen. Your second and third choices cover you if your first goes to someone else. A franchise the CGHL does not field yet becomes a new club only when a commissioner gives the go-ahead after your application is approved.", fields: [
          { k: "f1", label: "1st choice", type: "select", req: true, opts: franchiseOpts },
          { k: "f2", label: "2nd choice", type: "select", opts: franchiseOpts, check: distinct("f2") },
          { k: "f3", label: "3rd choice", type: "select", opts: franchiseOpts, check: distinct("f3") } ] },
        { t: "Why you", fields: [
          { k: "why", label: "Why you?", type: "textarea", rows: 4, req: true, ph: "Tell the commissioners why you'd make a great owner" } ] }
      ],
      submit: "Submit application",
      /* a pending application can be withdrawn after the close too (ownWithdrawable, part_live.js:4182) */
      /* the dates come from the Season 2 calendar (M.s2cal, v4.31), never typed here */
      done: function (d, ctx) { var a = ctx && ctx.prev, edit = a && a.status === "pending"; return { t: edit ? "Application saved" : "Application submitted", lines: [(edit && ownerChanged(d, a) && !a.edited_at ? "That was your one edit. " : "") + "Every staffer and commissioner votes on it, and owners are decided by " + s2Day("ownersDecided") + ". Your first choice: " + d.f1 + ".",
        (edit ? "You may withdraw it at any time until it is decided." : "You may edit it once before applications close on " + s2Day("ownersClose") + ", and withdraw it at any time until it is decided.")], go: ["#/you?tab=applications", "See it in Applications"] }; }
    },

    staff: {
      title: "Apply to join the staff", who: "member",
      /* Rule 2.7's submission rule (2026-11-23): a club seat holder leaves the seat before applying. The database refuses
         it; the form says so first in its notes, as it does for a staffer or a commissioner (part_live.js:4411) */
      lede: "In Season 2 the staff is one group. Every staffer works the whole Staff Desk; each of the six committees has a manager who sets its priorities. Staff applications are decided by a vote of all staff and commissioners, and one passes when more than half of them approve.",
      prep: function (d, ctx) {
        return mine("staff").then(function (a) {
          ctx.prev = a;
          if (a) { d.areas = (a.departments || []).map(committeeName).filter(Boolean).slice(0, 2); d.avail = a.availability || ""; d.exp = a.experience || ""; d.why = a.pitch || ""; }
        });
      },
      notes: function (d, ctx) {
        var out = [], a = ctx.prev;
        if (S2.session.seat) out.push("Owners, General Managers and Assistant General Managers cannot apply to join the league staff (Rule 2.7). Step down from your club seat first, then apply.");
        if (S2.session.isCommissioner) out.push("As a commissioner you already have full staff access, so there is nothing to apply for.");
        else if (S2.session.isStaff) out.push("You're already on the league staff, so there is nothing to submit.");
        if (a && a.status === "pending") out.push("Your application is in review. Saving changes updates it.");
        return out;
      },
      confirm: function (d, ctx) { var a = ctx.prev; return a && a.status === "pending" ? "Save application" : a ? "File it again" : "Submit application"; },
      /* CG.submitStaffApp: one row per member (onConflict profile_id). Season 2 has committees where Season 1 had
         departments, so the picks go in departments as committee keys (public.committees.key); the cap of two is the
         database's (staff_app_department_cap) */
      send: function (d) {
        var id = signedIn(), keys = (d.areas || []).map(committeeKey).filter(Boolean);
        return S2.write("staff_applications.upsert", { row: { profile_id: id, departments: keys, availability: orNull(d.avail), experience: orNull(d.exp), pitch: trim(d.why),
          status: "pending", updated_at: new Date().toISOString() }, onConflict: "profile_id", select: "id,status" });
      },
      steps: [
        { t: "Committees", fields: [
          { k: "areas", label: "Committees you know best (optional)", type: "multi", max: 2, opts: function () { return S2.COMMITTEES.map(function (c) { return [c, c]; }); },
            help: "Naming a committee never limits what you may work on." } ] },
        { t: "About you", fields: [
          { k: "avail", label: "Availability (optional)", type: "text", ph: "e.g. most weeknights after 8" },
          { k: "exp", label: "Relevant experience (optional)", type: "text", ph: "e.g. reffed in two leagues, ran stats for a club" },
          /* the live form asks nothing about a club seat: Rule 2.7 is checked by the database at approval */
          { k: "why", label: "Why you?", type: "textarea", rows: 4, req: true, ph: "What would you bring to the league office?" } ] }
      ],
      submit: "Submit application",
      done: function (d, ctx) { var a = ctx && ctx.prev; return { t: a && a.status === "pending" ? "Application saved" : a ? "Application filed again" : "Application received", lines: [(a && a.status !== "pending" ? "It is voted on afresh. " : "") + "Every staffer and commissioner votes on it, and it passes when more than half of them approve. You'll get a notification either way.", "You can update or withdraw yours from Applications."], go: ["#/you?tab=applications", "See it in Applications"] }; }
    },

    "case": {
      title: "File a case", who: "member",
      lede: "Cases go to the league office and follow Chapter 7: submission, review, then a written decision. Appeals are due within 48 hours (Rule 7.6).",
      steps: [
        { t: "Type", fields: [
          { k: "type", label: "What do you need?", type: "cards", req: true, opts: function () { return S2.caseTypes(); }} ] },
        { t: "Details", fields: [
          { k: "about", label: "What's the complaint about?", type: "select", req: true, opts: COMPLAINT_ABOUT, show: is("type", "complaint") },
          { k: "what", label: "What are you appealing?", type: "select", req: true, opts: APPEAL_WHAT, show: is("type", "appeal") },
          { k: "game", label: function (d) { return d.type === "forfeit_appeal" ? "Which forfeit?" : d.type === "stats_correction" ? "Which game?" : "Which game? (optional)"; }, type: "select",
            req: function (d) { return d.type === "forfeit_appeal" || d.type === "stats_correction"; },
            /* a correction may name a game outside the list or a season total, as the live form allows (CG.fileActionRequest) */
            opts: function (d) { return recentGames(d.type === "complaint" ? null : home(), d.type === "forfeit_appeal", d.type === "complaint" ? d.game : null).concat(d.type === "stats_correction" ? [[OTHER_GAME, "Another game or a season total"]] : []); },
            show: function (d) { return d.type === "complaint" || d.type === "stats_correction" || d.type === "forfeit_appeal"; },
            /* the live filing refuses with the same words when the club has nothing to appeal (part_live.js:9339) */
            help: function (d) { return d.type === "complaint" ? "Links the case to the game." : d.type === "forfeit_appeal" && !recentGames(home(), true).length ? "Your club has no forfeit to appeal." : ""; } },
          { k: "who", label: "Who is this about? (optional)", type: "text", ph: "Type a name", show: is("type", "complaint"), list: memberNames,
            help: "Pick a name from the list to link the case to their record."},
          /* the live form asks for both (acCur, acReq, part_live.js:9330) */
          { k: "cur", label: "Current position", type: "pills", req: true, opts: POS, show: is("type", "position_change") },
          { k: "pos", label: "Requested position", type: "pills", req: true, opts: POS, show: is("type", "position_change"),
            check: function (v, d) { return v && v === d.cur ? "Pick a different position from your current one." : ""; } },
          /* live case details have no length limit, and only a complaint gets the what-happened prompt (part_live.js:9365) */
          { k: "details", label: function (d) { return d.type === "trade_request" ? "Why are you requesting a trade?" : "Details"; }, type: "textarea", rows: 5, req: true,
            ph: function (d) { return d.type === "complaint" ? "What happened, when, and in which game or channel. Link any evidence." : "Explain your request."; }} ] }
      ],
      submit: "Submit",
      /* CG.fileActionRequest: one action_requests row. A trade request is routed to the filer's own club ("manager", Rule
         2.3); every other case to the league office. The database fills the rest and checks it: a correction's club
         (guard_stats_correction), an appeal's suspension (link_appeal), a forfeit appeal's club and subject
         (guard_forfeit_appeal), the position change cutoff, the flood limit and, from Season 2, the trade deadline */
      send: function (d) {
        var t = d.type, id = signedIn(), view = viewSeason();
        var row = { profile_id: id, type: t, route: t === "trade_request" ? "manager" : "commissioner", details: trim(d.details), season_id: view && view.id || null };
        if (t === "complaint") { var who = memberByName(d.who); row.subject = d.about; row.target = orNull(d.who); row.target_profile_id = who ? who.id : null; if (d.game) row.game_id = d.game; }
        else if (t === "appeal") row.subject = d.what;
        else if (t === "position_change") { row.current_position = d.cur; row.requested_position = d.pos; }
        else if (t === "stats_correction") { var g = d.game === OTHER_GAME ? null : M().game(d.game); row.subject = g ? gameOpt(g)[1] : "Another game or a season total"; row.game_id = g ? g.id : null; }
        else if (t === "forfeit_appeal") row.game_id = d.game;
        else if (t === "trade_request") {
          if (!S2.session.teamId) return Promise.reject(fail("You need to be on a club roster to request a trade."));
          row.team_id = S2.session.teamId;
        }
        return S2.write("action_requests.insert", { row: row }).catch(function (e) {
          if (e && e.hint === "trade_requests_closed") tradeClosedSaid = true;   /* the door goes for the rest of this visit */
          throw e;
        });
      },
      /* a trade request is routed to the club's front office and never reaches a staff desk (route "manager", CG.staffCases);
         every other case, a position change included, goes to the league office (Rule 2.9) */
      done: function (d) {
        var front = d.type === "trade_request";
        return { t: front ? "Sent to your club's front office" : "Filed. The league office has it",
          lines: front ? ["Only your club's Owner, GM and AGM see a trade request, and they are notified on the site and on Discord. The league office does not receive it (Rule 2.3)."] :
            ["Commissioners are notified at once. You can follow the case and reply to the official in your Inbox."], go: ["#/you?tab=inbox", "Open your Inbox"] };
      }
    },

    /* live Messages is member to member: you pick one member (a commissioner, say) and a private conversation opens
       (part_live.js:6451); there is no path into a club room */
    message: {
      title: "New message", who: "member",
      steps: [{ t: "Message", fields: [
        { k: "to", label: "To", type: "text", req: true, ph: "A commissioner or another member", list: memberNames,
          help: "Pick a member from the list. A private conversation opens in your Inbox.",
          check: function (v) { var m = trim(v) ? memberByName(v) : true; return !m ? "Pick a member from the list." : m !== true && m.id === me() ? "Pick another member: this one is you." : ""; } },
        { k: "body", label: "Message", type: "textarea", rows: 5, req: true, max: 2000, ph: "Write a message" } ] }],
      submit: "Send", review: false,
      /* CG.dmSend: one direct_messages row (dm_insert refuses a banned sender or recipient) */
      send: function (d) {
        var id = signedIn(), to = memberByName(d.to);
        if (!to) return Promise.reject(fail("Pick a member from the list."));
        return S2.write("direct_messages.insert", { row: { sender_id: id, recipient_id: to.id, body: trim(d.body) } });
      },
      done: function (d) { return { t: "Message sent", lines: ["They are notified, and the conversation is in your Inbox."], go: ["#/you?tab=inbox", "Open your Inbox"] }; }
    },

    profile: {
      title: "League profile", who: "member",
      steps: [{ t: "Profile", fields: [
        /* Rule 1.1: the EA ID is public (v2.59 shows it on every profile); the console name is for club management and staff */
        { k: "ea", label: "EA ID", type: "text", req: true, ph: "e.g. YourEAName", help: "Exactly as it shows on your box score. It shows on your public profile so members can find you in game (Rule 1.1)." },
        { k: "console", label: "Console", type: "select", req: true, opts: CONSOLES.map(function (c) { return [c[0], c[1]]; }), refresh: true },
        { k: "tag", label: function (d) { var c = CONSOLES.filter(function (x) { return x[0] === d.console; })[0]; return c ? c[2] : "Xbox Gamertag or PSN Name"; }, type: "text", req: true },
        /* Rule 4.2: the away club vetoes and the clubs' picks decide; a player's answer only informs their own management */
        { k: "server", label: "Suggested server (optional)", type: "select", opts: [["", "No preference"]].concat(SERVERS.map(function (s) { return [s, s]; })), help: "The server you play best on. Your club's management sees the roster's answers when it sets each game's server picks and veto (Rule 4.2). It is a suggestion, not a vote." },
        { k: "num", label: "Jersey number (optional)", type: "number", min: 1, maxv: 99, ph: "1 to 99", help: "Unique on your club. A blank box keeps the number you have." } ] }],
      submit: "Save profile", review: false,
      /* every field starts from the profile on file (the live Settings card fills each from CG.auth.profile), so a save
         writes back what the member left alone, never a blank over it */
      prep: function (d, ctx) {
        return mine("profile").then(function (p) {
          ctx.onFile = p; detailsFrom(d, p); d.server = p.preferred_server || ""; d.num = p.jersey_number == null ? "" : String(p.jersey_number);
        });
      },
      readWhat: "Your profile on file",
      /* the live Settings save (profiles.update of the four, an empty row back counted as not saved) and CG.saveMyJersey
         (set_my_jersey_number, which puts it on the club's roster spot when it is free). v3.78: the number is sent only when
         the member changed it, so a save of the EA ID never touches it; a blank number changes nothing.
         shortcut: no way to clear a saved number here (the live card sends p_number null), add it if a member asks */
      send: function (d, ctx) {
        var id = signedIn(), was = ctx.onFile || {}, num = trim(d.num);
        ctx.jersey = null;
        return S2.write("profiles.update", { set: { ea_id: trim(d.ea), platform: d.console, platform_gamertag: trim(d.tag), preferred_server: orNull(d.server) }, match: { id: id } }, { sections: ["people"] }).then(function (r) {
          ctx.onFile = Object.assign({}, was, { ea_id: trim(d.ea), platform: d.console, platform_gamertag: trim(d.tag), preferred_server: orNull(d.server) });
          if (num === "" || num === (was.jersey_number == null ? "" : String(was.jersey_number))) return r;
          return S2.write("set_my_jersey_number", { p_number: +d.num }, { sections: ["people", "rosters"] }).then(function (j) {
            ctx.jersey = j && j.data || {}; ctx.onFile.jersey_number = ctx.jersey.chosen == null ? null : +ctx.jersey.chosen;
            return j;
          }, function (e) {
            /* the live card's words: the profile part is saved, only the number was refused (a teammate wears it) */
            var e2 = fail("Your profile was saved, but your number did not change: " + said(e), e && e.code); e2.hint = e && e.hint || null; throw e2;
          });
        });
      },
      /* the receipt says what the database answered for the number (CG.saveMyJersey's toast), never the
         number typed: a number chosen while a teammate wears it is a choice for the next club */
      done: function (d, ctx) {
        var t = M() && M().team(S2.session.teamCode), club = t ? " for the " + t.full + "." : ".";   /* the member's own club */
        var j = ctx.jersey;
        var head = !j || j.chosen == null ? "Profile saved" : j.wearing != null ? "Profile saved. You wear #" + j.wearing + club : "Profile saved. #" + j.chosen + " is yours when you join a club, if nobody there wears it.";
        return { t: head, lines: [] };
      }
    },

    /* commissioner, 2026-11-03: "instead of the trade page being a pop-up, can you integrate it into the entire page to be able
       to show more in-depth stats and lines?" The trade builder is a Team HQ page now (#/trade, js/pages/tradebuild.js).
       This door keeps every data-flow="trade" (Build a trade, Counter, Add to a trade, Trade for this player) and the
       front-office lock in one place, then hands the door's context to the page */
    trade: {
      title: function (ctx) { return ctx.counter ? "Counter the offer" : "Build a trade"; }, who: "office",
      page: function (ctx) { S2.go(S2.tradePage.href(ctx)); }
    },

    /* QA functional 2026-11-25: the discipline, reply, season and schedule forms had no door and nothing opened them (the
       Staff Desk and the Control Center use their own sheets), so they are gone with the "not connected" text they
       carried; tools/ui/flows.test.cjs checks that every form here files through a door or opens a page */

    /* RULING 2026-11-23: "current staff members can apply for committee manager positions that are not filled and are
       voted on by all other staff members". The door is apply_committee_seat (v4.59, sql/2026-11-24-s2-committees-v459.sql):
       a staffer not suspended from staff duty and not banned, never a commissioner, for an OPEN seat, one pending
       application per seat, a pitch of up to 2,000 characters; it bells every other voter, and the staff vote decides it
       like the other applications (can_vote_committee_app, _committee_app_resolve), an approval filling the seat. The notes
       say first, in the door's own words, what it will refuse, from the Staff Desk's read of the seats and applications
       (js/pages/desk.js loadComs and loadApps, S2._desk.LV) when it has one; the door decides either way */
    committee: {
      title: "Apply for a committee manager seat", who: "staff",
      lede: "A seat that has no manager is filled by staff applying and all the other staff voting. It passes when more than half of the staff and commissioners approve (Rule S2.8).",
      notes: function (d) {
        var L = S2._desk && S2._desk.LV.state === "ready" ? S2._desk.LV : null, out = [], c = (L && L.coms || []).filter(function (x) { return x.key === d.seat; })[0];
        if (S2.session.isCommissioner) out.push("Commissioners already hold every committee power, so they do not apply for a seat.");
        var nm = committeeName(d.seat) || (c && c.name);
        if (c && c.manager_profile_id === me()) out.push("You already manage the " + nm + " committee.");
        else if (c && c.manager_profile_id) out.push("The " + nm + " committee already has a manager. A seat is applied for only while it is open.");
        if (L && (L.apps || []).some(function (a) { return a.type === "committee" && a.seat === d.seat && a.profile_id === me() && a.outcome === "pending"; }))
          out.push("You already applied for this seat. Withdraw that application to file a new one.");
        return out;
      },
      steps: [{ t: "The seat", fields: [
        { k: "seat", label: "The committee", type: "select", req: true, refresh: true, opts: function () {
            var L = S2._desk && S2._desk.LV.state === "ready" ? S2._desk.LV : null;
            return S2.COMMITTEE_DEFS.map(function (c) { var r = (L && L.coms || []).filter(function (x) { return x.key === c.key; })[0];
              return [c.key, c.name + (r ? (r.manager_profile_id ? ", managed by " + ((r.manager && r.manager.gamertag) || "a staff member") : ", open") : "")]; }); },
          help: "A seat that already has a manager opens when its manager steps down or leaves the staff." },
        { k: "why", label: "Why you?", type: "textarea", rows: 4, req: true, max: 2000, ph: "What you would put first on this committee" } ] }],
      submit: "Apply",
      send: function (d) { signedIn(); return S2.write("apply_committee_seat", { p_committee: d.seat, p_pitch: trim(d.why) }).then(function (r) { return confirmed(r, "pending"); }); },
      done: function (d) { var c = S2.COMMITTEE_DEFS.filter(function (x) { return x.key === d.seat; })[0];
        return { t: "Application filed", lines: ["The other staff and the commissioners vote on it on the Staff Desk. If more than half of them approve, you manage " + (c ? c.name : "the committee") + "."], go: ["#/desk?tab=applications", "See it on the desk"] }; }
    },
    /* the news writer above (S2.news, shared with the Control Center): the review step is the confirm before the Discord post */
    story: {
      title: "Write a story", who: "staff",
      notes: function () { return [NEWS_SAYS]; },
      steps: [{ t: "Story", fields: [
        { k: "title", label: "Headline", type: "text", req: true, ph: "Sentence case, specific, no clickbait", min: 8 },
        /* the six categories as stored (CG.NEWS_CATS), shown in sentence case, the kicker voice (audit 2026-11-09) */
        { k: "cat", label: "Category", type: "select", req: true, opts: function () { return S2.CG.NEWS_CATS.map(function (c) { return [c, newsLabel(c)]; }); } },
        { k: "body", label: "Body", type: "textarea", rows: 8, req: true, ph: "Write like a beat reporter. Blank lines become paragraphs." } ] }],
      submit: "Publish and post to Discord",
      send: function (d) { return newsPublish({ title: d.title, category: d.cat, body: d.body }); },
      done: function () { return { t: "Story published", lines: ["It is on the site now and posted to the Discord news channel. It leads Top stories on Today while that module is switched on in the Newsroom."], go: ["#/today", "See Today"] }; }
    }
  };

  function franchiseOpts() {
    var mine = teams().map(function (t) { return t.full; });
    return [{ g: "In the CGHL", o: FRANCHISES.filter(function (f) { return mine.indexOf(f) >= 0; }) }, { g: "New to the league", o: FRANCHISES.filter(function (f) { return mine.indexOf(f) < 0; }) }];
  }
  function distinct(k) {
    return function (v, d) { if (!v) return ""; var others = ["f1", "f2", "f3"].filter(function (x) { return x !== k; }); return others.some(function (x) { return d[x] === v; }) ? "Pick a different franchise for each choice." : ""; };
  }
  function is(k, v) { return function (d) { return d[k] === v; }; }
  /* the live site's test of an edit (CG.submitOwnerApp): any answer differs from the application on file */
  function ownerChanged(d, a) {
    var same = function (x, y) { return (trim(x) || null) === (trim(y) || null); };
    return !(same(d.ea, a.ea_id) && same(d.avail, a.availability) && same(d.exp, a.experience) && same(d.f1, a.preferred_club) && same(d.f2, a.franchise_2) && same(d.f3, a.franchise_3) && same(d.why, a.pitch));
  }
  /* a Season 2 date (M.s2cal) as "November 28" for copy */
  function s2Day(k) { var c = M() && M().s2cal; return c ? M().etLong(c[k]).replace(/^\w+, /, "") : "the date in the calendar"; }
  function val(x, d) { return typeof x === "function" ? x(d) : x; }

  /* ---------- rendering ---------- */
  function optionList(opts, cur, ph) {
    var one = function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + esc(l) + "</option>"; };
    return (ph ? '<option value="">' + esc(ph) + "</option>" : "") + opts.map(function (o) {
      return o && o.g ? '<optgroup label="' + esc(o.g) + '">' + o.o.map(one).join("") + "</optgroup>" : one(o);
    }).join("");
  }
  function fieldHtml(f, d, err) {
    var id = "fl" + f.k, v = d[f.k], label = val(f.label, d), help = val(f.help, d), ph = val(f.ph, d) || "", opts = f.opts ? val(f.opts, d) : [], body;
    /* help and error belong to the control, so moving focus to a bad field reads the error, not only the label */
    var dby = [help ? id + "-h" : "", err ? id + "-e" : ""].filter(Boolean).join(" "), aria = (dby ? ' aria-describedby="' + dby + '"' : "") + (err ? ' aria-invalid="true"' : "");
    var helpP = help ? '<p class="fl-help" id="' + id + '-h">' + esc(help) + "</p>" : "", errP = err ? '<p class="fl-err" id="' + id + '-e" role="alert">' + esc(err) + "</p>" : "";
    /* a group's legend names it once; the group itself carries the description */
    var group = function (inner) { return '<fieldset class="fl-f' + (err ? " bad" : "") + '" data-k="' + f.k + '"' + aria + "><legend class=\"fl-l\">" + esc(label) +
      (f.type === "multi" && f.max ? ' <span class="fl-max">up to ' + f.max + "</span>" : "") + "</legend>" + inner + helpP + errP + "</fieldset>"; };
    switch (f.type) {
      case "html":   /* display only: no value, no label (the trade check); live: repainted in place as the step changes */
        return '<div class="fl-f"' + (f.live ? ' data-live="' + f.k + '"' : "") + ">" + f.html(d) + "</div>";
      case "textarea":
        body = '<textarea class="input" id="' + id + '" rows="' + (f.rows || 4) + '"' + (f.max ? ' maxlength="' + f.max + '"' : "") + aria + ' placeholder="' + esc(ph) + '">' + esc(v || "") + "</textarea>" +
          (f.max ? '<span class="fl-count num" data-count-for="' + id + '">' + String(v || "").length + " / " + f.max + "</span>" : "");
        break;
      case "select":
        body = '<select class="input" id="' + id + '"' + aria + ">" + optionList(opts, v == null ? "" : v, opts.length && !(opts[0] && opts[0][0] === "") ? "Choose…" : "") + "</select>";
        break;
      case "number":
        body = '<input class="input num" id="' + id + '" type="number" inputmode="numeric"' + aria + (f.min != null ? ' min="' + f.min + '"' : "") + (f.maxv != null ? ' max="' + f.maxv + '"' : "") + ' placeholder="' + esc(ph) + '" value="' + esc(v == null ? "" : v) + '">';
        break;
      case "date":
        body = '<input class="input" id="' + id + '" type="date"' + aria + ' value="' + esc(v || "") + '">';
        break;
      case "check":
        return '<div class="fl-f' + (err ? " bad" : "") + '" data-k="' + f.k + '"><label class="fl-check"><input type="checkbox" id="' + id + '"' + aria + (v ? " checked" : "") + "><span>" + esc(label) + "</span></label>" + errP + "</div>";
      case "pills": case "multi":
        var multi = f.type === "multi", sel = multi ? (v || []) : v;
        return group('<div class="fl-pills">' + opts.map(function (o, i) {
          var on = multi ? sel.indexOf(o[0]) >= 0 : String(sel) === String(o[0]);
          return '<label class="fl-pill"><input type="' + (multi ? "checkbox" : "radio") + '" name="' + id + '" value="' + esc(o[0]) + '"' + (on ? " checked" : "") + (i === 0 ? ' id="' + id + '"' : "") + "><span>" + esc(o[1]) + "</span></label>";
        }).join("") + "</div>");
      case "cards":
        return group('<div class="fl-cards">' + opts.map(function (o, i) {
          return '<label class="fl-card"><input type="radio" name="' + id + '" value="' + esc(o[0]) + '"' + (v === o[0] ? " checked" : "") + (i === 0 ? ' id="' + id + '"' : "") + '><span class="fl-card-t">' + esc(o[1]) + '</span><span class="fl-card-s">' + esc(o[2]) + "</span></label>";
        }).join("") + "</div>");
      case "players":
        var picked = v || [];
        return group('<div class="fl-list">' + (opts.length ? opts.map(function (o, i) {
          return '<label class="fl-li"><input type="checkbox" name="' + id + '" value="' + esc(o[0]) + '"' + (picked.indexOf(o[0]) >= 0 ? " checked" : "") + (i === 0 ? ' id="' + id + '"' : "") + "><span>" + esc(o[1]) + "</span></label>";
        }).join("") : '<p class="fl-help">Pick a trade partner first.</p>') + "</div>");
      default:
        /* f.list: names the browser offers as the reader types (the member picker: a name resolves to a profile on send) */
        var names = f.list ? val(f.list, d) || [] : null;
        body = '<input class="input" id="' + id + '" type="text" autocomplete="off"' + (names ? ' list="' + id + '-l"' : "") + aria + ' placeholder="' + esc(ph) + '" value="' + esc(v || "") + '">' +
          (names ? '<datalist id="' + id + '-l">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" : "");
    }
    return '<div class="fl-f' + (err ? " bad" : "") + '" data-k="' + f.k + '"><label class="fl-l" for="' + id + '">' + esc(label) + "</label>" + body + helpP + errP + "</div>";
  }
  function display(f, d) {
    var v = d[f.k], opts = f.opts ? val(f.opts, d) : [];
    var name = function (x) { var hit = null; opts.forEach(function (o) { if (o && o.g) o.o.forEach(function (y) { if (y === x) hit = y; }); else if (Array.isArray(o) ? String(o[0]) === String(x) : o === x) hit = Array.isArray(o) ? o[1] : o; }); return hit == null ? x : hit; };
    if (f.type === "check") return v ? "Yes" : "No";
    if (Array.isArray(v)) return v.length ? v.map(name).join(", ") : "None";
    if (v == null || v === "") return "Not given";
    if (f.type === "date") return (M() && M().etFull(v)) || v;   /* "Mon, Nov 2, 2026", not the ISO value */
    return name(v);
  }

  function visible(f, d) { return !f.show || f.show(d); }
  function errorFor(f, d) {
    if (!visible(f, d) || f.type === "html") return "";
    var v = d[f.k], req = val(f.req, d), empty = v == null || v === "" || v === false || (Array.isArray(v) && !v.length);
    if (req && empty) return f.type === "check" ? "Check this box to continue." : f.type === "players" ? "Pick at least one player." : "This is required.";
    if (!empty && f.min && typeof v === "string" && v.trim().length < f.min) return "At least " + f.min + " characters.";
    if (!empty && f.type === "number" && (+v < f.min || +v > f.maxv || Math.round(+v) !== +v)) return "Use a whole number from " + f.min + " to " + f.maxv + ".";
    if (f.max && Array.isArray(v) && f.type === "multi" && v.length > f.max) return "Pick up to " + f.max + ".";
    return f.check ? f.check(v, d) : "";
  }

  /* ---------- the runner ---------- */
  /* an answer the options no longer offer is no answer: the trade partner or the case type changed under it, and the old
     value would pass validation and print as a raw id in the review */
  function prune(f, d) {
    /* cards too (header v2): a door that pre-fills a case type this viewer may not file left it checked in no card, passing
       validation and printing the raw id in the review */
    if (f.type !== "select" && f.type !== "players" && f.type !== "cards") return;
    var keys = []; (val(f.opts, d) || []).forEach(function (o) { if (o && o.g) keys = keys.concat(o.o); else keys.push(String(Array.isArray(o) ? o[0] : o)); });
    if (f.type === "players") d[f.k] = (d[f.k] || []).filter(function (x) { return keys.indexOf(String(x)) >= 0; });
    else if (d[f.k] != null && d[f.k] !== "" && keys.indexOf(String(d[f.k])) < 0) d[f.k] = "";
  }
  /* who each door is for, and why, for the role lock (S2.locked: who may, and why; the database decides every write) */
  var WHO = { member: ["Any member, signed in with Discord", "Sign-ups, applications, cases and messages are made from a member's own account, which the site makes from their Discord name when they sign in."],
    office: ["A club's front office: its Owner, GM and AGM", "Front-office tools act for a club, so only its Owner, General Manager and Assistant General Manager use them (Rules 2.3 and 2.6)."],
    staff: ["The league staff", "Cases, replies, discipline and the newsroom are the league office's work (Chapter 7). Every staffer may work the whole Staff Desk."],
    commish: ["A commissioner", "Season settings and the schedule are set by a commissioner."] };
  /* a guest at a member door (Sign up, Register, a case) meets the league's front door, not a lock (audit 2026-11-09: the
     main sign-up door read "Who may do this" with View as Player and Close). It leads with Join with Discord, as the
     current site signs a member in (js/live.js S2.signIn), which comes back to this page */
  S2.joinSheet = function (title, then) {
    var sh = S2.sheet({ title: title, html: '<div class="lk"><p class="lk-why">Members sign up, apply and file cases from their own account. Join with Discord and the site makes it from your Discord name, then brings you straight back here.</p>' +
      '<div class="fl-actions"><button type="button" class="btn discord" data-join data-autofocus>Join with Discord</button><button type="button" class="btn secondary" data-close-x>Not now</button></div></div>' });
    S2.$("[data-close-x]", sh.el).addEventListener("click", function () { sh.close(); });
    S2.$("[data-join]", sh.el).addEventListener("click", function () {
      sh.close();
      if (S2.signIn) S2.signIn(); else S2.toast("Sign-in is not connected on this page. Reload it and try again.", "err");
    });
    return sh;
  };
  S2.flow = function (name, ctx) {
    ctx = ctx || {};
    var def = FLOWS[name];
    /* a door naming no form is a mistake in the page that drew it: said, never a stand-in form */
    if (!def) { console.error("S2.flow: no flow named " + name); S2.toast("That form is not available here. Reload the page and try again.", "err"); return null; }
    var title = val(def.title, ctx);
    /* a ROLE lock: who may, and the reason. Rule 2.7 conflicts and closed windows are never locks: the database decides,
       and def.notes says first what it will say */
    var need = WHO[def.who];
    if (need && def.who === "member" && S2.state.role === "guest") return S2.joinSheet(title, function () { S2.flow(name, ctx); });
    if (need && !S2.has(def.who === "member" ? "member" : def.who)) return S2.locked({ title: title, who: need[0], why: need[1] });
    if (def.page) return def.page(ctx);   /* a door that opens a page, not a form (the trade builder) */
    /* phase: loading (what is on file is read first) | failed (that read failed) | form | review | done;
       sending: a filing is on its way, so its button waits and a second press sends nothing */
    var d = {}, errs = {}, step = 0, phase = def.prep ? "loading" : "form", sendErr = "", sending = false, closed = false;
    ["kind", "type", "game", "club", "player", "rostered"].forEach(function (k) { if (ctx[k]) d[k] = ctx[k]; });   /* what the door already knows */
    def.steps.forEach(function (s) { s.fields.forEach(function (f) { if (d[f.k] != null) return; if (f.value != null) d[f.k] = f.value; else if (f.type === "multi" || f.type === "players") d[f.k] = []; }); });
    if (def.init) def.init(d, ctx);
    /* the form root is not a live region: moving focus announces each step, errors carry role=alert, and the receipt's
       heading takes focus. If the door that opened the flow was repainted meanwhile, focus goes to the page, not <body> */
    var sh = S2.sheet({ title: title, html: '<div class="fl"></div>', onClose: function () {
      closed = true;
      if (document.activeElement === document.body) { var pg = S2.$("#page"); if (pg) pg.focus({ preventScroll: true }); } } }), root = S2.$(".fl", sh.el);
    var steps = def.steps.length + 1;

    function stepper() {
      if (steps < 3 || phase === "done") return "";
      var labels = def.steps.map(function (s) { return s.t; }).concat(["Review"]), at = phase === "review" ? steps - 1 : step;
      return '<ol class="fl-steps" aria-label="Steps">' + labels.map(function (l, i) { return "<li" + (i === at ? ' aria-current="step"' : i < at ? ' class="past"' : "") + "><span>" + esc(l) + "</span></li>"; }).join("") + "</ol>";
    }
    /* noFocus: the first paint leaves focus to the sheet (it focuses Close), so a phone keyboard does not flash open */
    /* the notes: what the database will refuse or ask about */
    function notesHtml() {
      var out = def.notes ? def.notes(d, ctx) : [];
      return out.map(function (t) { return '<p class="fl-note fl-warn">' + esc(t) + "</p>"; }).join("");
    }
    function errHtml() { return sendErr ? '<p class="fl-err fl-senderr" role="alert">' + esc(sendErr) + "</p>" : ""; }
    function sendLabel(l) { return sending ? "Sending…" : l; }
    function busy() { return sending ? " disabled aria-busy=\"true\"" : ""; }
    function paint(focusSel, noFocus) {
      var html;
      if (phase === "loading" || phase === "failed") {
        html = phase === "loading" ? '<p class="fl-note" role="status">Reading what you have on file…</p>' :
          '<p class="fl-err" role="alert">' + esc(sendErr) + '</p><div class="fl-actions"><button type="button" class="btn" data-retry data-autofocus>Try again</button><button type="button" class="btn secondary" data-cancel>Close</button></div>';
      } else if (phase === "done") {
        var r = def.done(d, ctx);
        html = '<div class="fl-done"><svg class="fl-tick" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>' +
          '<h3 class="t-title2" tabindex="-1" data-autofocus>' + esc(r.t) + "</h3>" + r.lines.map(function (l) { return '<p class="t-body">' + esc(l) + "</p>"; }).join("") +
          '<div class="fl-actions"><button type="button" class="btn" data-cancel>Done</button>' + (r.go ? '<a class="btn secondary" href="' + r.go[0] + '">' + esc(r.go[1]) + "</a>" : "") + "</div></div>";
      } else if (phase === "review") {
        html = stepper() + notesHtml() + '<h3 class="fl-h">Check your answers</h3><dl class="fl-sum">' + def.steps.map(function (s, si) {
          return s.fields.filter(function (f) { return visible(f, d) && f.type !== "html"; }).map(function (f) {
            return '<div><dt>' + esc(val(f.label, d)) + '</dt><dd>' + esc(display(f, d)) + '</dd><button type="button" class="btn plain sm" data-edit="' + si + '" aria-label="Change ' + esc(val(f.label, d)) + '">Change</button></div>';
          }).join("");
        }).join("") + "</dl>" + errHtml() +
          '<div class="fl-actions"><button type="button" class="btn" data-send data-autofocus' + busy() + ">" + esc(sendLabel(def.confirm ? def.confirm(d, ctx) : val(def.submit, d))) + '</button><button type="button" class="btn secondary" data-back>Back</button></div>';
      } else {
        var s = def.steps[step], last = step === def.steps.length - 1, note = val(s.note, d);
        s.fields.forEach(function (f) { if (visible(f, d)) prune(f, d); });
        html = stepper() + (step === 0 && def.lede ? '<p class="t-sub fl-lede">' + esc(def.lede) + "</p>" : "") + (step === 0 ? notesHtml() : "") + (note ? '<p class="fl-note">' + esc(note) + "</p>" : "") +
          '<form class="fl-form" novalidate>' + s.fields.filter(function (f) { return visible(f, d); }).map(function (f) { return fieldHtml(f, d, errs[f.k]); }).join("") +
          (last && def.review === false ? errHtml() : "") +
          '<div class="fl-actions"><button type="submit" class="btn"' + (last && def.review === false ? busy() : "") + ">" + (!last ? "Continue" : def.review === false ? esc(sendLabel(val(def.submit, d))) : "Review") + "</button>" +
          (step > 0 ? '<button type="button" class="btn secondary" data-back>Back</button>' : '<button type="button" class="btn secondary" data-cancel>Cancel</button>') + "</div></form>";
      }
      root.innerHTML = html;
      if (!focusSel) sh.body.scrollTop = 0;
      if (S2.trade && !focusSel) S2.trade.hydrate(root);   /* the reading's one entrance, when a step first shows it */
      /* Back and every review Change land on the step's first field */
      var target = focusSel ? S2.$(focusSel, root) : S2.$("[data-autofocus]", root) || S2.$(".fl-f.bad input, .fl-f.bad select, .fl-f.bad textarea", root) ||
        S2.$(".fl-form input, .fl-form select, .fl-form textarea", root) || S2.$("button.btn", root);
      if (!noFocus && target && target.focus) target.focus({ preventScroll: true });
      /* a failed submit shows its first bad field and error, which can sit below the fold on a short phone */
      var bad = !focusSel && S2.$(".fl-f.bad", root); if (bad) bad.scrollIntoView({ block: "center" });
    }
    function fieldOf(k) { var hit = null; def.steps.forEach(function (s) { s.fields.forEach(function (f) { if (f.k === k) hit = f; }); }); return hit; }
    function read(el) {
      var box = el.closest("[data-k]"); if (!box) return null;
      var f = fieldOf(box.dataset.k); if (!f) return null;
      if (f.type === "multi" || f.type === "players") {
        d[f.k] = S2.$$("input:checked", box).map(function (i) { return i.value; });
        if (f.max && d[f.k].length > f.max) { el.checked = false; d[f.k] = d[f.k].filter(function (x) { return x !== el.value; }); S2.toast("Pick up to " + f.max + "."); }
      } else if (f.type === "pills" || f.type === "cards") { var c = S2.$("input:checked", box); d[f.k] = c ? c.value : ""; }
      else if (f.type === "check") d[f.k] = el.checked;
      else d[f.k] = el.value;
      return f;
    }
    function validate(s) {
      errs = {}; var ok = true;
      s.fields.forEach(function (f) { var e = errorFor(f, d); if (e) { errs[f.k] = e; ok = false; } });
      return ok;
    }

    /* the door, and the receipt only on the database's confirmation. A refusal goes back to where the
       filing was made (the review, or the form's last step) with every answer kept and the database's words above the
       button. Closed mid-send, the answer still reaches the reader as a toast */
    function file() {
      if (sending) return;
      sendErr = "";
      sending = true; paint();
      var data = JSON.parse(JSON.stringify(d));
      Promise.resolve().then(function () { return def.send(d, ctx); }).then(function (res) {
        sending = false; phase = "done";
        var r = def.done(d, ctx);
        if (closed) S2.toast(r.t, "ok"); else paint();
        document.dispatchEvent(new CustomEvent("s2:filed", { detail: { flow: name, data: data, ctx: ctx, result: res } }));
      }, function (e) {
        sending = false; sendErr = said(e);
        console.error("S2.flow: " + name + " was refused", e);
        if (closed) S2.toast(sendErr, "err"); else paint();
      });
    }
    root.addEventListener("input", function (e) {
      var f = read(e.target); if (!f) return;
      var cnt = S2.$('[data-count-for="' + e.target.id + '"]', root); if (cnt) cnt.textContent = e.target.value.length + " / " + f.max;
      if (errs[f.k] && !errorFor(f, d)) { delete errs[f.k]; var box = e.target.closest("[data-k]"); box.classList.remove("bad"); var m = S2.$(".fl-err", box); m && m.remove();
        S2.$$("[aria-invalid]", box).concat(box.hasAttribute("aria-invalid") ? [box] : []).forEach(function (x) { x.removeAttribute("aria-invalid"); }); }
    });
    /* a field with lock(v, d): a choice this role may not make goes back to the last allowed one and opens S2.locked,
       which says who may (a display hint: the database decides) */
    var kept = {};
    def.steps.forEach(function (s0) { s0.fields.forEach(function (f) { if (f.lock) kept[f.k] = d[f.k]; }); });
    root.addEventListener("change", function (e) {
      var f = read(e.target); if (!f) return;
      if (f.lock) {
        var lk = f.lock(d[f.k], d), want = d[f.k], sel0 = '[data-k="' + f.k + '"] ' + e.target.tagName.toLowerCase();
        if (lk) { d[f.k] = kept[f.k]; paint(sel0); S2.locked(lk); return; }
        kept[f.k] = want;
      }
      /* a live display field (the trade reading) follows every change in place, never a repaint of the step */
      S2.$$("[data-live]", root).forEach(function (el) { var lf = fieldOf(el.dataset.live); if (lf) { if (lf.patch) lf.patch(el, d); else el.innerHTML = lf.html(d); } });
      /* a field that decides what the step shows (console, partner, discipline kind) repaints the step in place, focus kept */
      if (f.refresh) paint('[data-k="' + f.k + '"] ' + (/radio|checkbox/.test(e.target.type) ? 'input[value="' + CSS.escape(e.target.value) + '"]' : e.target.tagName.toLowerCase()));
    });
    root.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!validate(def.steps[step])) { paint(); return; }
      if (step < def.steps.length - 1) { step++; paint(); } else if (def.review === false) file(); else { phase = "review"; paint(); }
    });
    root.addEventListener("click", function (e) {
      var b = e.target.closest("button, a"); if (!b) return;
      if (b.matches("a[href^='#/']")) { sh.close(); return; }
      if (b.hasAttribute("data-cancel")) { sh.close(); return; }
      if (b.hasAttribute("data-back")) { if (phase === "review") phase = "form"; else step = Math.max(0, step - 1); paint(); return; }
      if (b.hasAttribute("data-edit")) { phase = "form"; step = +b.dataset.edit; paint(); return; }
      if (b.hasAttribute("data-send")) file();
      if (b.hasAttribute("data-retry")) prep();
    });
    /* what the member has on file is read before the form shows (def.prep); a failed read is said, with Try
       again, never an empty form that would overwrite what is on file */
    function prep() {
      phase = "loading"; sendErr = ""; paint(null, true);
      Promise.resolve().then(function () { return def.prep(d, ctx); }).then(function () {
        phase = "form"; if (!closed) paint(null, true);
      }, function (e) {
        phase = "failed"; sendErr = (def.readWhat || "Your application on file") + " could not be read: " + said(e);
        console.error("S2.flow: " + name + " could not read what is on file", e);
        if (!closed) paint();
      });
    }
    if (phase === "loading") prep(); else paint(null, true);
    return sh;
  };
  /* ---------- the ONE trade reversal door (review 2026-10-19: Team HQ, the Staff Desk and the Control Center each had a
     sheet of their own: a ten-character reason on one, an empty reason on another, a canned one on the third). Rule 2.3:
     a reversal "is communicated to both clubs with the department's reasons", so a reason is required, with the live
     desk sheet's check (CG.AFTER._deskTransactions: at least ten characters). The door is reverse_trade (js/trade.js
     S2.trade.door.reverse, as part9_staffdesks.js calls it): the database decides who may reverse and refuses a trade a
     player in it has moved on from since; the sheet waits for its answer, and a refusal is said in its words with the
     reason kept. ref: the trade's id (trades.id). opts.text: a sentence naming the trade, for the sheet; opts.done(result)
     runs after the database confirms (the page repaints its own widget) ---------- */
  S2.reverseTrade = function (ref, opts) {
    opts = opts || {};
    if (!S2.trade || !S2.trade.door || !S2.trade.isId(ref)) { console.error("S2.reverseTrade: no trade id, or js/trade.js is not loaded", ref); S2.toast("That trade cannot be reversed from here. Reload the page and try again.", "err"); return null; }
    /* gaps (2026-11-25): the kit's one confirm sheet (S2.confirm, as the resend door below and the trade page's answers),
       which opens on the safe button and is held open while the league answers */
    var sending = false;
    return S2.confirm({ title: "Reverse this trade?", ok: "Reverse the trade", cancel: "Keep it", danger: true,
      why: [(opts.text ? opts.text + " " : "") + "Every player returns to the club that held them, placed by the same rule (Rule 2.1), and the reversal is posted to the transaction log. A trade may not be reversed once a player in it has moved again (Rule 2.3)."],
      html: '<div class="field"><label for="rvWhy">Reasons, sent to both clubs</label><textarea class="input" id="rvWhy" rows="3" maxlength="500" placeholder="For example: a lopsided giveaway between allied clubs, not a natural deal"></textarea></div>' +
        '<p class="fl-err" role="alert" data-rv-err hidden></p>',
      onOk: function (sh) {
        var inp = S2.$("#rvWhy", sh.el), err = S2.$("[data-rv-err]", sh.el), b = S2.$('[data-cf="ok"]', sh.el), why = (inp.value || "").trim();
        var say = function (t) { err.textContent = t; err.hidden = false; };
        if (sending) return false;
        if (why.length < 10) { say("Give a reason of at least ten characters: both clubs are told what it says."); inp.setAttribute("aria-invalid", "true"); inp.focus(); return false; }
        sending = true; b.disabled = true; b.setAttribute("aria-busy", "true"); err.hidden = true; inp.removeAttribute("aria-invalid");
        S2.trade.door.reverse(ref, why).then(function (r) {
          sending = false; sh.close();
          S2.toast("Trade reversed. Both clubs are told why.", "ok");
          if (opts.done) opts.done(r);
        }, function (e) {
          sending = false; b.disabled = false; b.removeAttribute("aria-busy");
          console.warn("S2.reverseTrade: refused", e);   /* said in the sheet, in the database's words */
          say(S2.trade.why(e));
        });
        return false;
      } });
  };
  /* ---------- the ONE resend door (gaps, 2026-11-25), beside the reversal door: the classic Transactions desk's Resend
     (part9_staffdesks.js; v3.68, commissioner, 2026-09-28: the league office may resend a declined or withdrawn offer as it
     was, and the receiving club still accepts or declines it). The door is resend_trade (S2.trade.door.resend): the
     database decides who may (has_department('transactions') or a commissioner; every staffer once the held staff powers
     record applies) and refuses an offer a player in it has since left. ref: trades.id; opts.text names the offer for the
     sheet and opts.to the receiving club for the toast; opts.done(result) runs after the database confirms (result.data: the new offer's id) ---------- */
  S2.resendTrade = function (ref, opts) {
    opts = opts || {};
    if (!S2.trade || !S2.trade.door || !S2.trade.isId(ref)) { console.error("S2.resendTrade: no trade id, or js/trade.js is not loaded", ref); S2.toast("That offer cannot be resent from here. Reload the page and try again.", "err"); return null; }
    var sending = false;
    return S2.confirm({ title: "Resend this offer?", ok: "Resend the offer", cancel: "Keep it closed",
      why: [(opts.text ? opts.text + " " : "") + "It goes back to the receiving club exactly as it was, marked as resent by the league office. They accept or decline it like any offer, and nothing moves until they do (Rule 2.3)."],
      html: '<p class="fl-err" role="alert" data-rs-err hidden></p>',
      onOk: function (sh) {
        var b = S2.$('[data-cf="ok"]', sh.el), err = S2.$("[data-rs-err]", sh.el);
        if (sending) return false;
        sending = true; b.disabled = true; b.setAttribute("aria-busy", "true"); err.hidden = true;
        S2.trade.door.resend(ref).then(function (r) {
          sending = false; sh.close();
          S2.toast("Offer resent to the " + (opts.to || "receiving club") + ".", "ok");
          if (opts.done) opts.done(r);
        }, function (e) {
          sending = false; b.disabled = false; b.removeAttribute("aria-busy");
          console.warn("S2.resendTrade: refused", e);
          err.textContent = S2.trade.why(e); err.hidden = false;
        });
        return false;
      } });
  };
  /* ---------- the application doors that are buttons, not forms (v5.00 swap, e5). The You page (e3) calls the two
     withdrawals and reads the applications on file with mine(); Team HQ's Front office (e1) calls nominate and its
     withdrawal. Each resolves only on the database's confirmation and rejects with its words (said(e) prints them). ---------- */
  /* withdraw_owner_application and withdraw_staff_application (v4.21, v4.22): success is the door's own confirmed status,
     never the absence of an error (guard_app_decision quietly put a direct status write back). Resolves { ok, status,
     final }: final means an owner application withdrawn after the close cannot be filed again this season */
  function withdrawApp(kind, appId) {
    return Promise.resolve().then(function () {
      signedIn();
      if (!appId) throw fail("There is no application on file to withdraw.", "S2_BAD_CALL");
      return S2.write(kind === "owner" ? "withdraw_owner_application" : "withdraw_staff_application", { p_app: appId });
    }).then(function (r) { return confirmed(r, "withdrawn"); });
  }
  /* CG.submitMgmtApp: the Owner (or the league office) nominates a GM or AGM for the staff vote. The database judges the
     nominee (guard_mgmt_nominee; in Season 2 _mgmt_nominee_seat_block: the AGM only after the draft and from the club's
     own roster, a replacement GM in season only from it). o: { teamId (teams.id), role "gm" | "agm", nomineeId, pitch }.
     notify_mgmt_application seats the league office's own nomination AFTER the insert, so the row the insert returns
     still reads pending: it is read again to say which happened. Resolves { id, status, seatBlock, reread } */
  function nominate(o) {
    o = o || {};
    return Promise.resolve().then(function () {
      var id = signedIn();
      if (o.role !== "gm" && o.role !== "agm") throw fail("A nomination is for the General Manager (gm) or the Assistant General Manager (agm) seat.", "S2_BAD_CALL");
      if (!o.teamId || !o.nomineeId) throw fail("Pick the club and the member to nominate.", "S2_BAD_CALL");
      return S2.write("management_applications.insert", { row: { team_id: o.teamId, role: o.role, submitted_by: id, nominee_id: o.nomineeId, pitch: orNull(o.pitch) }, select: "id,status" }, { sections: ["teams", "rosters"] });
    }).then(function (r) {
      var row = r.data[0], sb = S2.ensureSb && S2.ensureSb(), plain = { id: row.id, status: row.status, seatBlock: null, reread: false };
      if (!sb) return plain;
      return sb.from("management_applications").select("status,seat_block").eq("id", row.id).maybeSingle().then(function (q) {
        if (q.error || !q.data) { console.error("S2.forms.nominate: filed, but its status could not be read back", q.error); return plain; }
        return { id: row.id, status: q.data.status, seatBlock: q.data.seat_block || null, reread: true };
      });
    });
  }
  /* the nomination's withdrawal (the live Front office card): its submitter, before the vote decides it */
  function withdrawNomination(appId) {
    return Promise.resolve().then(function () {
      signedIn();
      if (!appId) throw fail("There is no nomination on file to withdraw.", "S2_BAD_CALL");
      return S2.write("management_applications.update", { set: { status: "withdrawn", updated_at: new Date().toISOString() }, match: { id: appId } });
    });
  }
  S2.forms = { said: said, regSeason: regSeason, signedUp: signedUp, ownerAppsOpen: ownerAppsOpen, tradeRequestsClosed: tradeRequestsClosed, mine: mine,
    withdrawOwner: function (id) { return withdrawApp("owner", id); }, withdrawStaff: function (id) { return withdrawApp("staff", id); },
    nominate: nominate, withdrawNomination: withdrawNomination };

  /* one list of franchises: the owner form here and the edit-once sheet in Applications (hq.js) */
  S2.FRANCHISES = FRANCHISES;
  S2.flows = FLOWS;

  /* every door: data-flow="<name>", optional data-kind etc. Delegated once, so re-rendered pages need no wiring */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-flow]"); if (!b || b.closest(".fl")) return;
    e.preventDefault();
    var ctx = {}; Object.keys(b.dataset).forEach(function (k) { if (k !== "flow") ctx[k] = b.dataset[k]; });
    /* a door inside an open sheet (a Season door's details) hands over to the flow: the details close first */
    var host = b.closest(".sheet"); if (host) { var x = S2.$("[data-close]", host); x && x.click(); }
    S2.flow(b.dataset.flow, ctx);
  });
})();
