/* CGHL Season 2: the Season 2 survey (css/survey.css). Commissioner, 2026-10-20: "can you create a survey that
   goes over suggestions and complaints about season 1, and questions about season 2 including what player x-factors need
   to be banned at each tier of the x-factor, weekly game day preferences, and anything they would like to see in season
   2 and beyond?" ... "This should pop up when someone refreshes the website once a day, or whenever someone goes to sign
   up for season 2, it should pop up before they can fill out their info for the signup. The survey is skippable. Make
   sure the survey doesn't feel long or tedious so we can minimize the amount of people who skip it."
   When it opens (members only, never a guest, never once finished):
   - once a day, on a page load: three seconds after the boot, at the first idle moment (no sheet, palette or menu open,
     nothing focused for typing, two quiet seconds). Skipping it, or closing it, waits until the next day.
   - before the Season 2 sign-up form: every register door goes through S2.flow (js/flows.js), which is wrapped below.
     "Skip to sign-up" goes straight to the form; closing the sheet (X, Escape) leaves the sign-up too.
   Not tedious: one question per screen, every question optional, Next always works, Back keeps the answers, Back and
   Next never move between questions (the sheet keeps one height), the X-Factor lists have Select all, None and Same as.
   The two looking-back questions are open boxes, like the last one. Commissioner, 2026-10-20: "Question 1 and 2 can be
   open answers that users can type out what they want." So no chips there: one box each, an example in the placeholder,
   a cap with the form kit's counter, and the intro's time promise counts the typing (about 3 minutes). The wording and
   the caps are the live mockup's (part11_survey.js SV.Q, pinned by tools/season2-survey.test.cjs), so the commissioner
   approves one question set in both (review 2026-10-20).
   Where answers go: a finished survey goes to the database (submit_season_survey, below); the half-done draft is kept in
   this browser as it is typed (S2.store), with finished, so a reload keeps it and tomorrow's pop-up resumes where the
   member stopped (i3f: the concept's automatic-update carry is gone).
   The live rules (v4.23, approved 2026-10-20), kept here exactly.
   Commissioner: "Only show it on the user's first refresh of the calendar day, and when the click on the signup page for
   season 2." "If a player has filled it out at any point, do not show them the survey again no matter what." "This
   survey should stop being show to members upon the signup deadline for season 2." So: never a guest; the daily pop-up
   only on the FIRST page load of the league day (the load day is stamped as the page starts; if that load cannot open
   it, the day is spent); the sign-up shows it first on every visit until it is finished; finished means never again on
   either path; and both paths stop at the Season 2 sign-up deadline. The answers feed the Control Center's Season 2
   survey section (js/pages/control.js), counted by S2.survey.tally from the question set below. */
(function () {
  "use strict";
  var esc = S2.esc;
  /* ONE flag guards every trigger, and the Control Center's survey section reads it (js/pages/control.js). The survey runs
     on the site (v4.23); i3a (2026-11-25): the shared copies that left it out are gone */
  S2.SURVEY_ON = true;
  /* one name for the survey, matching the live site (v4.24: "Can you actually name it the Season 1 survey?") */
  S2.SURVEY_NAME = "Season 1 survey";
  /* v5.00 swap (stream e5, 2026-11-24): the answers go to the database through S2.write("submit_season_survey"), the thanks screen waits for its confirmation and a refusal
     keeps the member on the last question with the database's words; "finished" is the server's (season_survey_done,
     asked before either path opens, failing closed: no answer is no survey), kept per member in this browser. The key is
     the live site's (part11_survey.js SV.KEY), so a member who finished there is finished here, and the answers are sent
     in the live site's own keys and choice words (payload), so the Control Center counts both sites as one survey. */
  var KEY = "s2-2026";

  /* ---------- the one question set ---------- */
  /* the open boxes; each one's cap (q.max) is long enough for a few sentences, short enough that nobody pastes an essay */
  var TEXT = ["worked", "fix", "ideas"];
  var LOCKS = [["locks", "Bring back position locks", "Each player plays the position they signed up at."], ["open", "Keep positions open", "Clubs may dress anyone anywhere, as now."], ["none", "No preference", ""]];
  var DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var PER_WEEK = [["1", "1"], ["2", "2"], ["3", "3"], ["4+", "4 or more"]], PER_WEEK_Q = "How many game nights a week?";
  /* EA's official NHL 26 X-Factors hub (ea.com/games/nhl/nhl-26/nhl26-x-factors-hub): no confirmed NHL 27 list exists yet,
     so the commissioner corrects names HERE after checking the NHL 27 in-game menu. Every ability comes in all three
     tiers, so the three questions list the same names. Alphabetical inside each group */
  var XF = {
    /* commissioner, 2026-10-21: "remove the quick draw perk from the survey choices since that is not an x-factor
       available in world of chel" (live site v4.28) */
    skaters: ["Ankle Breaker", "Backhand Beauty", "Big Rig", "Big Tipper", "Born Leader", "Elite Edges", "Hipster", "No Contest", "One T", "Pressure+",
      "Quick Pick", "Quick Release", "Rocket", "Second Wind", "Send It", "Spark Plug", "Stick ’Em Up", "Tape to Tape", "Truculence", "Unstoppable Force", "Warrior", "Wheels"],
    goalies: ["Dialed In", "Post to Post", "Recharge", "Show Stopper", "Sponge"]
  };
  /* banned today under Rule 4.5 (rulebook v2.53): six at every tier, two more at the Red tier only */
  var BAN_ALL = ["Truculence", "Spark Plug", "Hipster", "Pressure+", "Unstoppable Force", "Big Rig"], BAN_RED = ["Stick ’Em Up", "Big Tipper"];
  /* EA's tier colors: Specialist is gold, All-Star blue, Elite red */
  var TIERS = { gold: ["Gold", "Specialist"], blue: ["Blue", "All-Star"], red: ["Red", "Elite"] };
  var ALL_XF = XF.skaters.concat(XF.goalies);
  function bannedNow(name, tier) { return BAN_ALL.indexOf(name) >= 0 || (tier === "red" && BAN_RED.indexOf(name) >= 0); }
  /* fail loud at load: a corrected name that no longer matches the ban list would drop its "Banned now" tag silently */
  BAN_ALL.concat(BAN_RED).forEach(function (n) { if (ALL_XF.indexOf(n) < 0) console.error("S2 survey: Rule 4.5 bans " + n + ", which is not in the X-Factor list"); });
  ALL_XF.forEach(function (n, i) { if (ALL_XF.indexOf(n) !== i) console.error("S2 survey: " + n + " is listed twice"); });

  /* screens: 0 the intro, 1 to 8 the questions, 9 thanks */
  var Q = [null,
    { k: "worked", kick: "Looking back", t: "Season 1: what worked?", hint: "Optional. A sentence or two is plenty.", kind: "text", max: 1000,
      ph: "For example: games started on time and the stats pages were easy to follow." },
    { k: "fix", kick: "Looking back", t: "Season 1: what needs fixing?", hint: "Optional. A sentence or two is plenty.", kind: "text", max: 1000,
      ph: "For example: fewer no-shows, and clearer rules for disconnects." },
    { k: "locks", kick: "Season 2", t: "Position locks for Season 2?", hint: "Choose one.", kind: "one" },
    { k: "nights", kick: "Season 2", t: "Which nights can you usually play?", hint: "Check any. Season 1 played Wednesday to Friday.", kind: "days" },
    { tier: "gold", kind: "xf" }, { tier: "blue", kind: "xf" }, { tier: "red", kind: "xf" },
    { k: "ideas", kick: "Your ideas", t: "Anything you would like to see in Season 2 and beyond?", hint: "Optional.", kind: "text", max: 2000 }];
  var LAST = Q.length - 1;
  Q.forEach(function (q) { if (q && q.kind === "xf") { q.kick = "X-Factors"; q.t = TIERS[q.tier][0] + " (" + TIERS[q.tier][1] + ") X-Factors: which should be banned?"; q.hint = "Check any. A tag marks what Rule 4.5 bans today."; } });

  /* ---------- the live site's answer shape (part11_survey.js SV.Q, SV.payload; submit_season_survey's keys) ----------
     The two sites ask the same questions with different internal names: the live site keys "positions", "wish" and
     xfGold, and stores a choice as its words ("Bring back position locks", "4 or more"). payload turns this survey's
     draft into exactly what the live site sends (typed answers trimmed and capped, empty answers left out, an X-Factor
     only while it is on the list); fromLive turns a stored answer back, for the Control Center's tally. */
  var LIVE_TIER = { gold: "xfGold", blue: "xfBlue", red: "xfRed" };
  var PER_WEEK_SAY = {}; PER_WEEK.forEach(function (w) { PER_WEEK_SAY[w[0]] = w[1]; });
  function payload(a) {
    a = a || blank();
    var out = {}, s = function (v) { return typeof v === "string" ? v.trim() : ""; }, lock = LOCKS.filter(function (l) { return l[0] === a.locks; })[0];
    if (s(a.worked)) out.worked = s(a.worked).slice(0, 1000);
    if (s(a.fix)) out.fix = s(a.fix).slice(0, 1000);
    if (lock) out.positions = lock[1];
    var nights = (a.nights || []).filter(function (d) { return DAYS.indexOf(d) >= 0; });
    if (nights.length) out.nights = nights;
    if (PER_WEEK_SAY[a.perWeek]) out.perWeek = PER_WEEK_SAY[a.perWeek];
    Object.keys(LIVE_TIER).forEach(function (t) {
      var list = ((a.xf || {})[t] || []).filter(function (n) { return ALL_XF.indexOf(n) >= 0; });
      if (list.length) out[LIVE_TIER[t]] = list;
      else if ((a.xfNone || {})[t] === true) out[LIVE_TIER[t] + "None"] = true;
    });
    if (s(a.ideas)) out.wish = s(a.ideas).slice(0, 2000);
    return out;
  }
  function fromLive(x) {
    x = x && typeof x === "object" ? x : {};
    var a = blank(), lock = LOCKS.filter(function (l) { return l[1] === x.positions; })[0], week = PER_WEEK.filter(function (w) { return w[1] === x.perWeek; })[0];
    a.worked = typeof x.worked === "string" ? x.worked : ""; a.fix = typeof x.fix === "string" ? x.fix : ""; a.ideas = typeof x.wish === "string" ? x.wish : "";
    a.locks = lock ? lock[0] : (typeof x.positions === "string" ? x.positions : "");   /* an unknown choice stays, so the tally counts it as odd */
    a.nights = Array.isArray(x.nights) ? x.nights.slice() : [];
    a.perWeek = week ? week[0] : (typeof x.perWeek === "string" ? x.perWeek : "");
    Object.keys(LIVE_TIER).forEach(function (t) { a.xf[t] = Array.isArray(x[LIVE_TIER[t]]) ? x[LIVE_TIER[t]].slice() : []; a.xfNone[t] = x[LIVE_TIER[t] + "None"] === true; });
    return a;
  }

  /* ---------- state ---------- */
  function blank() { return { worked: "", fix: "", locks: "", nights: [], perWeek: "", xf: { gold: [], blue: [], red: [] }, xfNone: { gold: false, blue: false, red: false }, ideas: "" }; }
  var draft = blank(), cur = null, shownThisLoad = false;
  /* per member in this browser, as the live site keys it (one member's finished survey never hides another's on a shared
     browser): { done: iso | "server", from: "daily" | "signup", last: answers, draft } */
  function recKey() { return S2.session && S2.session.profileId ? "survey." + KEY + "." + S2.session.profileId : "survey"; }
  function rec() { var r = S2.store.get(recKey(), null); return r && typeof r === "object" ? r : {}; }
  function note(patch) { S2.store.set(recKey(), Object.assign(rec(), patch)); }
  /* the draft as it stands, kept until the survey is finished (review 2026-10-20: a reload lost the typed answers, and the
     day was already marked, so the member started again from empty boxes) */
  function keep() { if (!rec().done) note({ draft: draft }); }
  /* "once a day" is the league's day: Eastern time, like every date on the site, on the member's own clock */
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }

  /* ---------- the rules (the live site's part11_survey.js, v4.23) ---------- */
  /* the load-day stamp, written as the page starts (this file runs before S2.boot). A later load the same league day finds
     it and never opens the daily pop-up; if this first load cannot open it (a guest, no quiet moment, the person leaves),
     the day is spent. One stamp per browser, as on the live site. A storage error counts as not the first load (fail
     closed), so it reads localStorage itself: S2.store would answer an error with "no stamp", which reads as first */
  var DAY_KEY = "s2.surveyLoadDay", firstLoad = (function () {
    var day = today(), prev;
    try { prev = localStorage.getItem(DAY_KEY); localStorage.setItem(DAY_KEY, day); }
    catch (e) { console.warn("S2 survey: could not read or stamp the load day, so the daily pop-up stays shut on this load", e); return false; }
    return prev !== day;
  })();
  /* finished on either path, as this browser keeps it for the member (the server's answer included, serverDone below):
     "do not show them the survey again no matter what" */
  function finished() { return !!rec().done; }
  /* the Season 2 sign-up deadline: the registration_deadline on the Season 2 row (S2.M), read at each use, so Edit settings
     in the Control Center moves it here too. No deadline on the row: shut, and said once (fail closed) */
  var noDeadline = false;
  function deadline() {
    var s2 = S2.M && S2.M.control && S2.M.control.season(2);
    return (s2 && s2.calendar.filter(function (c) { return c.key === "registration_deadline"; })[0]) || null;
  }
  function signupOpen() {
    var c = deadline(), at = c ? Date.parse(c.at) : NaN;
    if (!isFinite(at)) { if (!noDeadline) console.error("S2 survey: the Season 2 row has no sign-up deadline, so the survey stays shut"); noDeadline = true; return false; }
    return Date.now() < at;
  }
  /* either path may open now: a member, not finished, sign-ups still open, no survey already up */
  function due() { return S2.SURVEY_ON && S2.has("member") && !finished() && signupOpen() && !cur; }
  /* the server is asked too, at each opening, never on a plain page load: true is final for this load and
     kept in this browser; an error or a missing client is null, and the survey stays shut (fail closed) */
  var askedDone = null;
  function serverDone() {
    if (rec().done) return Promise.resolve(true);
    if (askedDone) return askedDone;
    var sb = S2.ensureSb && S2.ensureSb();
    if (!sb) { console.warn("S2 survey: there is no league client to ask whether this member finished, so it stays shut"); return Promise.resolve(null); }
    var call = askedDone = Promise.resolve().then(function () { return sb.rpc("season_survey_done", { p_survey: KEY }); }).then(function (r) {
      if (r.error || typeof r.data !== "boolean") throw r.error || new Error("the answer was not true or false");
      if (r.data) note({ done: "server" });
      return r.data;
    }).catch(function (e) { console.warn("S2 survey: could not ask whether this member finished, so it stays shut", e); return null; })
      .then(function (v) { if (v !== true && askedDone === call) askedDone = null; return v; });
    return call;
  }
  /* -> Promise of true when the survey may open now */
  function ready() { return due() ? serverDone().then(function (v) { return v === false && due(); }) : Promise.resolve(false); }

  /* ---------- screens ---------- */
  function foot(inner) { return '<div class="sv-foot">' + inner + "</div>"; }
  function pill(type, k, v, label, on) {
    return '<label class="fl-pill"><input type="' + type + '" name="sv-' + k + '" data-k="' + k + '" value="' + esc(v) + '"' + (on ? " checked" : "") + "><span>" + esc(label) + "</span></label>";
  }
  function allLabel(n, of) { return n === of ? "Clear all" : "Select all"; }
  function xfBody(tier) {
    var picks = draft.xf[tier], row = function (n) {
      return '<label class="sv-xf"><input type="checkbox" data-xf="' + tier + '" value="' + esc(n) + '"' + (picks.indexOf(n) >= 0 ? " checked" : "") + '><span class="sv-xf-n">' + esc(n) + "</span>" +
        (bannedNow(n, tier) ? '<span class="sv-now">Banned now</span>' : "") + "</label>";
    };
    var same = tier === "blue" ? ["gold"] : tier === "red" ? ["gold", "blue"] : [];
    /* the tools stay at the top of the scrolling list on a phone, so Select all is always one tap away */
    return '<div class="sv-tools"><button type="button" class="btn secondary sm" data-sv="all" data-tier="' + tier + '">' + allLabel(picks.length, ALL_XF.length) + "</button>" +
      '<button type="button" class="btn secondary sm sv-none" data-sv="none" data-tier="' + tier + '" aria-pressed="' + draft.xfNone[tier] + '">None</button>' +
      same.map(function (t) { return '<button type="button" class="btn secondary sm" data-sv="same" data-tier="' + tier + '" data-from="' + t + '">Same as ' + TIERS[t][0] + "</button>"; }).join("") +
      '<span class="sv-count num" aria-live="polite">' + countText(tier) + "</span></div>" +
      '<p class="t-cap sv-grp">Skaters</p><div class="sv-xfs">' + XF.skaters.map(row).join("") + "</div>" +
      '<p class="t-cap sv-grp">Goaltenders</p><div class="sv-xfs">' + XF.goalies.map(row).join("") + "</div>";
  }
  function countText(tier) { return draft.xfNone[tier] ? "None banned" : draft.xf[tier].length ? draft.xf[tier].length + " of " + ALL_XF.length : ""; }
  function body(q) {
    var d = draft;
    switch (q.kind) {
      case "one": return '<fieldset class="sv-f" aria-labelledby="svQ"><div class="fl-cards sv-cards">' + LOCKS.map(function (o) {
          return '<label class="fl-card"><input type="radio" name="sv-locks" data-k="locks" value="' + o[0] + '"' + (d.locks === o[0] ? " checked" : "") + '><span class="fl-card-t">' + esc(o[1]) + "</span>" +
            (o[2] ? '<span class="fl-card-s">' + esc(o[2]) + "</span>" : "") + "</label>";
        }).join("") + "</div></fieldset>";
      case "days": return '<fieldset class="sv-f" aria-labelledby="svQ"><div class="fl-pills">' + DAYS.map(function (o) { return pill("checkbox", "nights", o, o, d.nights.indexOf(o) >= 0); }).join("") +
          '<button type="button" class="btn plain sm sv-all" data-sv="all">' + allLabel(d.nights.length, DAYS.length) + "</button></div></fieldset>" +
        '<fieldset class="sv-f sv-sub"><legend class="sv-l">' + PER_WEEK_Q + '</legend><div class="fl-pills">' + PER_WEEK.map(function (o) { return pill("radio", "perWeek", o[0], o[1], d.perWeek === o[0]); }).join("") + "</div></fieldset>";
      case "xf": return '<fieldset class="sv-f" aria-labelledby="svQ">' + xfBody(q.tier) + "</fieldset>";
      /* the question is the label; the counter is the form kit's (flows.css .fl-count), so the limit is never a surprise */
      case "text": return '<div class="fl-f"><textarea class="input sv-text" id="sv-' + q.k + '" data-k="' + q.k + '" aria-labelledby="svQ" aria-describedby="svH" rows="6" maxlength="' + q.max + '"' +
          (q.ph ? ' placeholder="' + esc(q.ph) + '"' : "") + ">" + esc(d[q.k]) + '</textarea><span class="fl-count num" data-count-for="sv-' + q.k + '">' + d[q.k].length + " / " + q.max + "</span></div>";
    }
    return "";
  }
  function screen(at, signup) {
    if (at === 0) return '<div class="sv-scroll sv-intro"><h3 class="d-2 sv-h" tabindex="-1" data-autofocus>' + (signup ? "Before you sign up, help shape Season 2" : "Help shape Season 2") + "</h3>" +
      '<p class="sv-lede">' + LAST + " quick questions, about 3 minutes. Skip anything you like.</p></div>" +
      /* Start sits where every Next will be, and the way out is the quiet one (review 2026-10-20: Start was small at the
         left with a bigger Skip pill beside it) */
      foot('<button type="button" class="btn plain sv-skip" data-sv="skip">' + (signup ? "Skip to sign-up" : "Skip for now") + '</button><span class="sv-gap"></span><button type="button" class="btn" data-sv="next">Start</button>');
    if (at > LAST) return '<div class="sv-scroll sv-done"><svg class="fl-tick" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>' +
      '<h3 class="d-2 sv-h" tabindex="-1" data-autofocus>Thanks, that helps</h3><p class="sv-lede">Your answers go to the league office.</p></div>' +
      foot('<span class="sv-gap"></span><button type="button" class="btn" data-sv="end">' + (signup ? "Continue to sign-up" : "Done") + "</button>");
    var q = Q[at], prog = "";
    for (var i = 1; i <= LAST; i++) prog += "<li" + (i <= at ? ' class="on"' : "") + "></li>";
    return '<form class="sv-form" novalidate><div class="sv-top"><ol class="sv-prog" aria-hidden="true">' + prog + '</ol><span class="sv-of num">' + at + " of " + LAST + "</span></div>" +
      '<div class="sv-scroll"><p class="kicker sv-k">' + esc(q.kick) + (q.tier ? '<span class="sv-tier ' + q.tier + '" aria-hidden="true"></span><span>' + TIERS[q.tier][0] + "</span>" : "") + "</p>" +
      '<h3 class="sv-q" id="svQ" tabindex="-1">' + esc(q.t) + '</h3><p class="sv-hint" id="svH">' + esc(q.hint) + "</p>" + body(q) + "</div>" +
      /* the database's refusal of the answers, above Finish (role=alert reads it out when it appears) */
      (at === LAST ? '<p class="sv-err" role="alert" hidden></p>' : "") +
      foot('<button type="button" class="btn plain sv-skip" data-sv="skip">' + (signup ? "Skip to sign-up" : "Skip survey") + '</button><span class="sv-gap"></span>' +
        '<button type="button" class="btn secondary" data-sv="back">Back</button><button type="submit" class="btn">' + (at === LAST ? "Finish" : "Next") + "</button>") + "</form>";
  }

  /* ---------- the survey sheet. o: { from: "daily" | "signup", then: fn (the sign-up form, for "signup") } ---------- */
  function open(o) {
    if (cur) return cur.sh;
    /* the kept draft comes back (after a reload too); one from before the open boxes held pick lists there, so it is
       left out loud rather than shown as "a,b" in a box */
    var kept = rec().draft;
    if (kept && typeof kept === "object" && kept.xf && TEXT.every(function (k) { return typeof kept[k] === "string"; })) draft = Object.assign(blank(), kept);
    else if (kept) console.warn("S2 survey: the kept draft is from an older question set, so the survey starts empty");
    o = o || {};
    /* stepAt: when the screen last changed. Next stays in one place, so a double click must not skip the next question
       unseen (review 2026-10-20: a double click on the nights screen landed on Blue, and Gold was never shown) */
    var signup = o.from === "signup", at = 0, byKey = false, stepAt = 0;
    /* any showing is this load's showing, however it is dismissed (live part11_survey.js; review 2026-10-20: a sign-up
       door closed before the quiet moment let the daily pop-up open on the same load) */
    shownThisLoad = true;
    /* the phone keyboard (review 2026-10-20: it covered Next and the counter on the open boxes) is S2.sheet's own lift
       now, for every sheet (QA phone 2026-11-25) */
    /* the first screen is in the html S2.sheet measures, so the phone sheet slides in from its real height. A tap on the
       scrim does not close it during the questions: on a phone that tap is how the keyboard is put away */
    /* the commissioner (2026-10-20, live v4.24): "Can you actually name it the Season 1 survey?" */
    var sh = S2.sheet({ title: S2.SURVEY_NAME, html: '<div class="sv">' + screen(0, signup) + "</div>",
      holdScrim: function () { return at >= 1 && at <= LAST; },
      onClose: function () { cur = null; keep(); } });
    var root = S2.$(".sv", sh.el);
    cur = { sh: sh };
    function paint(dir) {
      var fixed = at >= 1 && at <= LAST, h0 = sh.el.offsetHeight;
      root.toggleAttribute("data-fixed", fixed);
      root.innerHTML = screen(at, signup);
      var h1 = sh.el.offsetHeight, anim = !byKey && sh.el.animate;
      /* intro and thanks are compact, the questions one fixed height: the sheet grows into the questions once */
      if (anim && h0 !== h1 && !S2.reduce.matches) sh.el.animate([{ height: h0 + "px" }, { height: h1 + "px" }], { duration: 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
      /* a pressed Next slides the new question in from the side it came from; a key press swaps at once (keyboard actions
         never animate), and Reduce Motion cross-fades */
      var sc = S2.$(".sv-scroll", root);
      if (anim && sc) sc.animate(S2.reduce.matches ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateX(" + 14 * dir + "px)" }, { opacity: 1, transform: "none" }],
        { duration: S2.reduce.matches ? 160 : 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
      var h = S2.$(".sv-q, .sv-h", root); if (h) h.focus({ preventScroll: true });   /* the question is read first; Tab reaches the answers */
    }
    function go(to) { stepAt = Date.now(); keep(); var dir = to < at ? -1 : 1; at = to; paint(dir); }
    function finish() {
      save(JSON.parse(JSON.stringify(draft)));
    }
    /* the thanks screen only on the database's true. While it is on its way Finish waits; a refusal stays
       on this question with the database's words and every answer kept. Closed mid-save, the answer comes as a toast */
    var saving = false;
    function save(a) {
      if (saving) return;
      var btn = S2.$('.sv-foot [type="submit"]', root), err = S2.$(".sv-err", root);
      saving = true; if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Saving…"; } if (err) err.hidden = true;
      S2.write("submit_season_survey", { p_survey: KEY, p_answers: payload(a), p_source: o.from === "signup" ? "signup" : "daily" }).then(function (r) {
        if (!r || r.data !== true) throw new Error("The league did not confirm your answers. Try again.");
        saving = false;
        note({ done: new Date().toISOString(), from: o.from === "signup" ? "signup" : "daily", last: a, draft: null });
        askedDone = Promise.resolve(true);
        draft = blank();
        if (cur && cur.sh === sh) go(LAST + 1); else S2.toast("Thanks, your survey answers were saved.", "ok");
      }).catch(function (e) {
        saving = false;
        var m = String(e && e.message || "The league did not save your answers.").replace(/^[\s\S]*?\bSURVEY:\s*/, "");
        console.error("S2 survey: the answers were refused", e);
        if (!(cur && cur.sh === sh)) { S2.toast("Your survey answers were not saved: " + m, "err"); return; }
        if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = "Finish"; }
        if (err) { err.textContent = "Not saved: " + m; err.hidden = false; }
      });
    }
    /* Skip, Done and Continue to sign-up go on to the form when the sign-up opened it; closing the sheet (X, Escape, a
       flick down) leaves the sign-up too */
    function leave() { sh.close(); if (o.then) o.then(); }
    root.addEventListener("pointerdown", function () { byKey = false; });
    root.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") byKey = true; });
    var settling = function () { return Date.now() - stepAt < 350; };
    root.addEventListener("submit", function (e) { e.preventDefault(); if (settling() || saving) return; if (at === LAST) finish(); else go(at + 1); });
    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-sv]");
      if (!b) return;
      var k = b.dataset.sv, tier = b.dataset.tier;
      /* Done and Continue to sign-up sit where Finish was, so they wait too */
      if ((k === "next" || k === "back" || k === "end") && settling()) return;
      if (saving && (k === "back" || k === "skip")) return;   /* the answers are on their way: the screen stays until the league answers */
      if (k === "next") go(at + 1);
      else if (k === "back") go(at - 1);
      else if (k === "skip" || k === "end") leave();
      else if (k === "all" && tier) setXf(tier, draft.xf[tier].length === ALL_XF.length ? [] : ALL_XF.slice(), false);
      else if (k === "all") { var all = draft.nights.length === DAYS.length; draft.nights = all ? [] : DAYS.slice(); S2.$$('[data-k="nights"]', root).forEach(function (i) { i.checked = !all; }); b.textContent = allLabel(draft.nights.length, DAYS.length); }
      else if (k === "none") setXf(tier, [], !draft.xfNone[tier]);
      else if (k === "same") {
        var from = b.dataset.from;
        /* nothing is disabled: an empty source answers with why instead of quietly clearing this list */
        if (!draft.xf[from].length && !draft.xfNone[from]) { S2.toast("Nothing is checked on " + TIERS[from][0] + " yet."); return; }
        setXf(tier, draft.xf[from].slice(), draft.xfNone[from]);
      }
    });
    /* an X-Factor list changes in place (scroll and focus stay put): the boxes, the count, Select all and None */
    function setXf(tier, picks, none) {
      draft.xf[tier] = ALL_XF.filter(function (n) { return picks.indexOf(n) >= 0; }); draft.xfNone[tier] = none && !picks.length;
      S2.$$('[data-xf="' + tier + '"]', root).forEach(function (i) { i.checked = draft.xf[tier].indexOf(i.value) >= 0; });
      syncXf(tier);
    }
    function syncXf(tier) {
      var all = S2.$('[data-sv="all"][data-tier="' + tier + '"]', root), none = S2.$('[data-sv="none"][data-tier="' + tier + '"]', root), c = S2.$(".sv-count", root);
      if (all) all.textContent = allLabel(draft.xf[tier].length, ALL_XF.length);
      if (none) none.setAttribute("aria-pressed", String(draft.xfNone[tier]));
      if (c) c.textContent = countText(tier);
    }
    /* a choose-one answer can be taken back: pressing the chosen one again clears it (every question is optional) */
    var was = null;
    root.addEventListener("pointerdown", function (e) { var l = e.target.closest("label"), r = l && S2.$('input[type="radio"]', l); was = r && r.checked ? r : null; });
    root.addEventListener("change", function (e) {
      var t = e.target;
      if (t.dataset.xf) { setXf(t.dataset.xf, S2.$$('[data-xf="' + t.dataset.xf + '"]:checked', root).map(function (i) { return i.value; }), false); return; }
      var k = t.dataset.k; if (!k) return;
      if (t.type === "checkbox") {
        draft[k] = S2.$$('[data-k="' + k + '"]:checked', root).map(function (i) { return i.value; });
        var sa = k === "nights" && S2.$(".sv-all", root); if (sa) sa.textContent = allLabel(draft.nights.length, DAYS.length);
      } else if (t.type === "radio") draft[k] = t.value;
    });
    root.addEventListener("click", function (e) {
      if (!was || e.target !== was) return;
      was.checked = false; draft[was.dataset.k] = ""; was = null;
    });
    root.addEventListener("input", function (e) {
      var t = e.target, k = t.dataset.k; if (!k || t.tagName !== "TEXTAREA") return;
      draft[k] = t.value;
      var c = S2.$('[data-count-for="' + t.id + '"]', root); if (c) c.textContent = t.value.length + " / " + t.maxLength;
    });
    /* every answer is kept as it is given (these run after the handlers above, so the draft is already updated) */
    ["input", "change", "click"].forEach(function (n) { root.addEventListener(n, keep); });
    return sh;
  }

  /* ---------- trigger 1: before the Season 2 sign-up form, on every visit until finished or sign-ups close. Every register
     door (the announcement strip, the Season page, the footer, Your season) opens S2.flow("register"), looked up at call
     time, so wrapping it here reaches all of them; a guest meets the join door (due() is false for a guest) ---------- */
  var flow = S2.flow;
  S2.flow = function (name, ctx) {
    if (name !== "register" || !due()) return flow.apply(this, arguments);
    /* the server is asked first; anything but a clear "not finished" goes straight to the form */
    ready().then(function (yes) { if (yes) open({ from: "signup", then: function () { flow(name, ctx); } }); else flow(name, ctx); });
  };

  /* ---------- trigger 2: the day's first page load only, at an idle moment ---------- */
  var lastInput = 0;
  ["pointerdown", "keydown", "wheel", "touchmove", "scroll"].forEach(function (n) { window.addEventListener(n, function () { lastInput = Date.now(); }, { capture: true, passive: true }); });
  function typing() {
    var a = document.activeElement, t = a && a.tagName;
    return !!a && (t === "TEXTAREA" || t === "SELECT" || a.isContentEditable || (t === "INPUT" && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/.test(a.type)));
  }
  function idle() {
    var c = document.documentElement.classList;
    /* nor over an open popover menu, such as the Staff Desk's Assign menu (review 2026-10-20) */
    return !S2.layer.top() && !c.contains("menu-open") && !c.contains("nav-open") && !S2.$('.dk-pop, [aria-haspopup][aria-expanded="true"]') &&
      document.visibilityState === "visible" && !typing() && Date.now() - lastInput >= 2000;
  }
  document.addEventListener("s2:boot", function () {
    if (!firstLoad || !due()) return;
    var t0 = Date.now();
    /* the page paints and settles first; then it waits for a quiet moment. Two minutes of steady use and it gives up: it
       belongs to arriving on the site, not to the middle of reading a page, and the day is spent (tomorrow's first load
       tries again) */
    setTimeout(function () {
      var iv = setInterval(function () {
        if (shownThisLoad || !due() || Date.now() - t0 > 120000) { clearInterval(iv); return; }
        if (idle()) { clearInterval(iv); ready().then(function (yes) { if (yes && !shownThisLoad && idle()) open({ from: "daily" }); }); }
      }, 1000);
    }, 3000);
  });

  /* ---------- the answers, for the Control Center (js/pages/control.js) ----------
     Commissioner, 2026-10-20: "I do not need to see names but I would like to see answer statistics in the control
     center somewhere." A response is { answers, from: "daily" | "signup" }: what was said and where, never who. */
  function source(from) { return from === "signup" ? "signup" : "daily"; }
  /* the viewer's own finished survey, as this browser kept it when the database confirmed it */
  function mine() {
    var r = rec();
    return r.done && r.last && typeof r.last === "object" ? { answers: r.last, from: source(r.from) } : null;
  }
  /* every answer a response can hold, in the survey's order: the questions, plus nights a week under the nights question */
  function parts() {
    var out = [];
    Q.forEach(function (q) {
      if (!q) return;
      if (q.kind === "one") out.push({ k: q.k, q: q, kind: "one", choices: LOCKS.map(function (o) { return o[0]; }), labels: LOCKS.map(function (o) { return o[1]; }) });
      else if (q.kind === "days") {
        out.push({ k: "nights", q: q, kind: "many", choices: DAYS.slice(), labels: DAYS.slice() });
        out.push({ k: "perWeek", q: q, t: PER_WEEK_Q, kind: "one", choices: PER_WEEK.map(function (o) { return o[0]; }), labels: PER_WEEK.map(function (o) { return o[1]; }) });
      } else if (q.kind === "xf") out.push({ k: q.tier, q: q, kind: "xf", tier: q.tier, choices: ALL_XF.slice(), labels: ALL_XF.slice() });
      else if (q.kind === "text") out.push({ k: q.k, q: q, kind: "text" });
    });
    return out;
  }
  /* Pure. rows: responses, newest first. Only a choice the survey offered is counted (anything else is counted as odd, so
     the view can say so); a choice repeated inside one answer counts once; written answers keep the rows' order */
  function tally(rows) {
    var P = parts(), t = { count: 0, daily: 0, signup: 0, parts: P, q: {} };
    P.forEach(function (p) { var v = {}; (p.choices || []).forEach(function (c) { v[c] = 0; }); t.q[p.k] = { answered: 0, none: 0, odd: 0, votes: v, texts: [] }; });
    (rows || []).forEach(function (r) {
      r = r || {};
      var a = r.answers && typeof r.answers === "object" ? r.answers : {};
      t.count++; t[source(r.from)]++;
      P.forEach(function (p) {
        var s = t.q[p.k];
        if (p.kind === "text") { var x = typeof a[p.k] === "string" ? a[p.k].trim() : ""; if (x) s.texts.push(x); return; }
        var v = p.kind === "xf" ? a.xf && a.xf[p.tier] : a[p.k], none = p.kind === "xf" && !!(a.xfNone && a.xfNone[p.tier]);
        var list = p.kind === "one" ? (typeof v === "string" && v ? [v] : []) : Array.isArray(v) ? v : [], seen = {};
        if (!list.length && !none) return;
        s.answered++; if (none) s.none++;
        list.forEach(function (c) {
          if (typeof c !== "string" || seen[c]) return;
          seen[c] = 1;
          if (Object.prototype.hasOwnProperty.call(s.votes, c)) s.votes[c]++; else s.odd++;
        });
      });
    });
    return t;
  }
  /* fail loud at load: the tally must count exactly what the survey asks, or the Control Center would mislead */
  (function () {
    var t = tally([{ answers: { locks: "locks", nights: ["Monday", "Monday", "Someday"], perWeek: "3", xf: { gold: ["Truculence"], blue: [], red: [] }, xfNone: { gold: false, blue: true, red: false }, fix: " Fewer no-shows. " }, from: "signup" }]);
    var ok = t.count === 1 && t.signup === 1 && t.q.locks.votes.locks === 1 && t.q.nights.votes.Monday === 1 && t.q.nights.odd === 1 && t.q.perWeek.votes["3"] === 1 &&
      t.q.gold.votes.Truculence === 1 && t.q.blue.none === 1 && t.q.blue.answered === 1 && t.q.red.answered === 0 && t.q.fix.texts[0] === "Fewer no-shows." && t.q.worked.texts.length === 0;
    if (!ok) console.error("S2 survey: the answer tally failed its self-check, so the Control Center's survey numbers are wrong");
  })();

  /* fail loud at load: the live shape must round-trip, or the real site would send what submit_season_survey refuses */
  (function () {
    var a = blank(); a.worked = " Kept. "; a.locks = "open"; a.nights = ["Friday", "Someday"]; a.perWeek = "4+"; a.xf.gold = ["Truculence", "Quick Draw"]; a.xfNone.blue = true; a.ideas = "More";
    var p = payload(a), back = fromLive(p);
    var ok = p.worked === "Kept." && p.positions === "Keep positions open" && p.nights.join() === "Friday" && p.perWeek === "4 or more" && p.xfGold.join() === "Truculence" && p.xfBlueNone === true &&
      !("xfRed" in p) && !("xfRedNone" in p) && p.wish === "More" && Object.keys(payload(blank())).length === 0 && back.locks === "open" && back.perWeek === "4+" && back.xfNone.blue && back.xf.gold.join() === "Truculence" && back.ideas === "More";
    if (!ok) console.error("S2 survey: the live answer shape failed its self-check, so the real site would send answers the league refuses");
  })();

  /* shortcut: the Control Center's "Sample answers" switch still asks for made-up answers (js/pages/control.js svTally);
     none are made up any more, so it gets none. Drop this when control.js reads season_survey_results through fromLive */
  function sample() { return []; }
  S2.survey = { open: open, due: due, ready: ready, finished: finished, signupOpen: signupOpen, deadline: deadline, mine: mine, sample: sample, tally: tally,
    payload: payload, fromLive: fromLive, KEY: KEY, TIERS: TIERS, bannedNow: bannedNow };
})();
