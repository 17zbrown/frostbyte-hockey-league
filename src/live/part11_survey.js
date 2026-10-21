/* ================================================================
   SEASON 2 SURVEY (v4.23)
   The commissioner, 2026-10-20: "create a survey that goes over suggestions and complaints about season 1, and
   questions about season 2 including what player x-factors need to be banned at each tier of the x-factor, weekly
   game day preferences, and anything they would like to see in season 2 and beyond." It "should pop up when
   someone refreshes the website once a day, or whenever someone goes to sign up for season 2, it should pop up
   before they can fill out their info for the signup. The survey is skippable. Make sure the survey doesn't
   feel long or tedious so we can minimize the amount of people who skip it."
   Approved for the live site (2026-10-20): "Add the survey to the live site. Only show it on the user's
   first refresh of the calendar day, and when the click on the signup page for season 2." and "If a player has
   filled it out at any point, do not show them the survey again no matter what."

   v4.23: answers are saved through public.submit_season_survey and "finished" is read back through
   public.season_survey_done (sql/2026-10-20-season2-survey-v423.sql), so it follows the member to every device.
   This browser keeps the draft answers (a skip and a later return keep what was typed) and a finished flag that
   saves asking again. Preview mode (local hosts only) adds a floating panel for running both paths.

   The whole file sits in one function scope on purpose: the parts share ONE script, and a second top-level name
   that collides with another part's is a SyntaxError that takes the site down.
   ================================================================ */
(function(){
var SV = CG.SURVEY = {};

SV.KEY = "s2-2026";      /* one key per survey, so finishing this one can never hide the next */
SV.SEASON = 2;           /* the sign-up it gates, and the season it is about */
SV.PAINT_MS = 5000;      /* "never during the first seconds of a page load": the page paints first */
SV.IDLE_MS = 3000;       /* no key, tap or scroll for this long is an idle moment */
SV.POLL_MS = 3000;       /* a local check only; it touches no server */
SV.GIVEUP_MS = 120000;   /* the pop-up belongs to arriving on the site, not to the middle of a visit; after this the day is spent */
SV.STEP_MS = 350;        /* a second click this soon after a step change is the same click: a double click must not skip a screen */

/* THE ONE X-FACTOR LIST. These are the NHL 26 names from EA's official X-Factors hub, because no confirmed NHL 27
   list exists yet. Check them against the NHL 27 in-game menu and correct them HERE: all three tier screens, the
   answers and the tests read this list and nothing else. Alphabetical within each group. */
SV.XF = {
  skaters: ["Ankle Breaker", "Backhand Beauty", "Big Rig", "Big Tipper", "Born Leader", "Elite Edges", "Hipster",
            "No Contest", "One T", "Pressure+", "Quick Pick", "Quick Release", "Rocket", "Second Wind", "Send It",
            "Spark Plug", "Stick ’Em Up", "Tape to Tape", "Truculence", "Unstoppable Force", "Warrior", "Wheels"],
  goalies: ["Dialed In", "Post to Post", "Recharge", "Show Stopper", "Sponge"],
  /* v4.28 (commissioner, 2026-10-21: "remove the quick draw perk from the survey choices since that is not an x-factor
     available in world of chel"). A name taken off the list stays here with the reason, so earlier answers that picked
     it are said under the results chart (SV.tally) instead of reading as "a choice the survey does not offer", and a
     half-finished answer kept in this browser cannot send it (SV.payload). */
  removed: { "Quick Draw": "not an X-Factor in World of Chel" },
  /* banned today under Rule 4.5. Shown as a quiet "Banned now" tag, never pre-checked: the member is asked,
     not told. tools/season2-survey-v423.test.cjs holds these to the rulebook's own Rule 4.5 text. */
  bannedEvery: ["Truculence", "Spark Plug", "Hipster", "Pressure+", "Unstoppable Force", "Big Rig"],
  bannedRed: ["Stick ’Em Up", "Big Tipper"]
};
SV.TIERS = { gold: "Gold", blue: "Blue", red: "Red" };
SV.bannedNow = function(tier, name){
  return SV.XF.bannedEvery.indexOf(name) >= 0 || (tier === "red" && SV.XF.bannedRed.indexOf(name) >= 0);
};
SV.DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/* THE QUESTION SET, in order. Every question is optional: nothing here can block Next.
   Questions 1 and 2 are open text (commissioner, 2026-10-20: "Question 1 and 2 can be open answers that users can
   type out what they want."): one box each, an example in the placeholder, max caps what a box keeps. */
SV.Q = [
  { id: "worked", kind: "text", max: 1000, title: "Season 1: what worked?", hint: "Optional. A sentence or two is plenty.",
    ph: "For example: games started on time and the stats pages were easy to follow." },
  { id: "fix", kind: "text", max: 1000, title: "Season 1: what needs fixing?", hint: "Optional. A sentence or two is plenty.",
    ph: "For example: fewer no-shows, and clearer rules for disconnects." },
  { id: "positions", kind: "one", title: "Position locks for Season 2?", hint: "Choose one.",
    options: [["Bring back position locks", "Each player plays the position they signed up at."],
              ["Keep positions open", "Clubs may dress anyone anywhere, as now."],
              ["No preference", ""]] },
  { id: "nights", kind: "multi", all: true, cols: "days", title: "Which nights can you usually play?",
    hint: "Check any. Season 1 played Wednesday to Friday.", options: SV.DAYS,
    then: { id: "perWeek", title: "How many game nights a week?", options: ["1", "2", "3", "4 or more"] } },
  { id: "xfGold", kind: "xf", tier: "gold", title: "Gold (Specialist) X-Factors: which should be banned?" },
  { id: "xfBlue", kind: "xf", tier: "blue", same: ["xfGold"], title: "Blue (All-Star) X-Factors: which should be banned?" },
  { id: "xfRed", kind: "xf", tier: "red", same: ["xfGold", "xfBlue"], title: "Red (Elite) X-Factors: which should be banned?" },
  { id: "wish", kind: "text", title: "Anything you would like to see in Season 2 and beyond?", hint: "Optional." }
];
SV.COPY = {
  /* v4.24, the commissioner: "Can you actually name it the Season 1 survey?" It looks back on Season 1; the questions
     still say Season 2 where they ask about it, and SV.KEY ("s2-2026") stays, so nobody's finished survey resets */
  name: "Season 1 survey",
  introTitle: "Help shape Season 2",
  /* three of the eight are typed answers now, so the time promise says 3 minutes, not 2 */
  introSub: SV.Q.length + " quick questions, about 3 minutes. Skip anything you like.",
  gateTitle: "Before you sign up, help shape Season 2",
  start: "Start", skip: "Skip for now", gateSkip: "Skip to sign-up",
  doneTitle: "Thanks, that helps", done: "Done", gateDone: "Continue to sign-up",
  skipSurvey: "Skip survey"
};

/* ---------- the trigger rules (pure, so the test can hold them) ---------- */
/* the league day, in league time: "once a day" turns over at midnight Eastern */
SV.today = function(ms){
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
};
/* v4.23, "Only show it on the user's first refresh of the calendar day": a load is the day's first when the stamp the
   last load left names another day (or none) */
SV.firstOfDay = function(prev, day){ return prev !== day; };
/* "If a player has filled it out at any point, do not show them the survey again no matter what." status is the
   server's answer: true finished, false not yet, null unknown (not asked yet, or the call failed). FAIL CLOSED: only
   a confirmed false lets either path open, and a finished flag in this browser closes both without asking. */
/* (a) the daily pop-up: only on the day's first load, until finished. A skip waits for tomorrow's first load. */
SV.dailyDue = function(st, first, status){ return !!first && !st.done && status === false; };
/* (b) the sign-up gate: every visit to the sign-up until finished */
SV.gateDue = function(st, status){ return !st.done && status === false; };
/* only while Season 2 is still ahead, and only until its sign-up deadline (v4.23, the commissioner: "This survey should
   stop being show to members upon the signup deadline for season 2"). The deadline is read exactly as the sign-up page
   reads it (CG.ROUTES.register: signup_deadline_at, else registration_deadline), so moving the date in the database
   moves the survey with it. */
SV.inWindow = function(seasons, nowMs){
  var now = nowMs != null ? nowMs : (CG.now ? CG.now() : Date.now());
  return (seasons || []).some(function(s){
    if (!s || s.number !== SV.SEASON || s.status === "active" || s.status === "complete") return false;
    var dl = Date.parse(s.signup_deadline_at || s.registration_deadline || "");
    return isNaN(dl) || now < dl;
  });
};
/* "Never open on top of another open dialog or while a person is typing; wait for an idle moment." */
SV.canInterrupt = function(e){
  return !!(e.member && e.window && e.booted && e.visible && !e.dialog && !e.typing &&
            e.sinceLoad >= SV.PAINT_MS && e.idle >= SV.IDLE_MS &&
            e.route !== "register" && e.route !== "signin");    /* the sign-up has its own gate; sign-in is mid-flow */
};

/* ---------- preview mode (local hosts only) ---------- */
var host = location.hostname || "";
/* v4.23: the preview is a tool for local hosts. On any other host ?survey=preview does nothing: a production
   member must never get a guest preview, nor a pop-up the rules above would not open. */
SV.preview = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) || /\.localhost$/.test(host);
SV.explicit = SV.preview && /[?&]survey=preview(&|#|$)/.test(location.search + location.hash);
/* A guest is never asked, except in an explicit local preview, which plays a member so the real
   once-a-day path can be run while signed out. Plain localhost only gets the panel, so other
   local sessions never meet a pop-up they did not ask for. */
/* A banned member is never asked, not even in preview: the ban screen covers the page, and a survey under it would
   take focus and spend the day's showing unseen. */
SV.asMember = function(){
  var p = CG.auth && CG.auth.profile;
  return p ? !p.banned : SV.explicit;
};

/* ---------- state: the draft and the finished flag in this browser, "finished" on the server ---------- */
var who = function(){ return (CG.auth && CG.auth.profile && CG.auth.profile.id) || "preview"; };
var storeKey = function(){ return "cghl:survey:" + SV.KEY + ":" + who(); };
/* The load-day stamp, written as the page starts. A later load the same league day finds it and never opens the daily
   pop-up; if this first load cannot open it (no idle moment before GIVEUP_MS, a dialog open, the person leaves), the
   day is spent. One stamp per browser, not per member: who is signed in is not known this early. A storage error
   counts as not the first load (fail closed). */
var dayKey = "cghl:survey:" + SV.KEY + ":loadDay";
SV.firstLoad = (function(){
  var day = SV.today(Date.now()), prev;
  try { prev = localStorage.getItem(dayKey); localStorage.setItem(dayKey, day); }
  catch(e){ console.warn("survey: could not read or stamp the load day, so the daily pop-up stays shut on this load", e); return false; }
  return SV.firstOfDay(prev, day);
})();
SV.load = function(){
  var st = null;
  try { st = JSON.parse(localStorage.getItem(storeKey()) || "null"); }
  catch(e){ console.warn("survey: could not read saved answers", e); }
  if (!st || typeof st !== "object") st = {};
  if (!st.answers || typeof st.answers !== "object") st.answers = {};
  return st;
};
SV.save = function(st){
  try { localStorage.setItem(storeKey(), JSON.stringify(st)); }
  catch(e){ console.warn("survey: could not keep answers in this browser", e); }
  pvStatus();
};
/* What the site sends: only the questions' own ids, typed answers trimmed and cut to their caps, empty answers left
   out. The draft in this browser can hold anything an older build kept; the server refuses unknown keys, so a stale
   draft must never strand a member on the last question. submit_season_survey holds the same keys and caps. */
SV.payload = function(a){
  var out = {}, s = function(v){ return typeof v === "string" ? v.trim() : ""; };
  SV.Q.forEach(function(q){
    var v = a[q.id];
    if (q.kind === "text"){ if (s(v)) out[q.id] = s(v).slice(0, q.max || 2000); }
    else if (q.kind === "one"){ if (s(v)) out[q.id] = s(v); }
    else if (Array.isArray(v)){
      /* v4.28: an X-Factor answer keeps only names still on the list (a pick saved in this browser before a name was
         removed is invisible on screen, so it is never sent) */
      var xf = q.kind === "xf" ? SV.XF.skaters.concat(SV.XF.goalies) : null;
      var list = v.filter(function(x){ return s(x) && (!xf || xf.indexOf(x) >= 0); });
      if (list.length) out[q.id] = list;
    }
    if (q.kind === "xf" && a[q.id + "None"] === true) out[q.id + "None"] = true;
    if (q.then && s(a[q.then.id])) out[q.then.id] = s(a[q.then.id]);
  });
  return out;
};
/* the server's "finished?" per member for this page load: a call still in flight, or a true (see SV.status) */
var asked = {};
/* The one save. The Done screen waits for the confirmed write (fail loud): a refusal or a network error rejects, and
   finish() keeps the person on the last question with the reason. Only a confirmed true marks this browser finished. */
SV.submit = function(st, source){
  if (!CG.sb || !(CG.auth && CG.auth.user)) return Promise.reject(new Error("sign in first"));
  return CG.sb.rpc("submit_season_survey", { p_survey: SV.KEY, p_answers: SV.payload(st.answers), p_source: source })
    .then(function(r){
      if (r.error) throw new Error(String(r.error.message || "the league refused them").replace(/^.*SURVEY:\s*/, ""));
      if (r.data !== true) throw new Error("the league did not confirm the save");
      st.done = new Date().toISOString();
      SV.save(st);
      /* v4.23: in memory too, so a browser that refuses storage (SV.save only warns) still never shows it again this
         load: "If a player has filled it out at any point, do not show them the survey again no matter what." */
      var p = CG.auth && CG.auth.profile; if (p) asked[p.id] = Promise.resolve(true);
      return true;
    });
};
/* "Finished?" asked of the server at each opening (the daily pop-up's quiet moment, each arrival at the sign-up), never
   on a plain page load. A true is final: kept for the rest of this load and marked in this browser, so this device
   never asks again. A failed call is null: the survey stays shut (fail closed). */
SV.status = function(){
  var p = CG.auth && CG.auth.profile;
  if (!p) return Promise.resolve(SV.explicit ? false : null);    /* a local guest preview has no row to ask about */
  if (SV.load().done) return Promise.resolve(true);
  if (!asked[p.id]){
    var call = asked[p.id] = Promise.resolve(CG.sb ? CG.sb.rpc("season_survey_done", { p_survey: SV.KEY }) : { error: new Error("no database client") })
      .then(function(r){
        if (r.error || typeof r.data !== "boolean") throw (r.error || new Error("the answer was not true or false"));
        if (r.data){ var st = SV.load(); if (!st.done){ st.done = "server"; SV.save(st); } }
        return r.data;
      })
      .catch(function(e){ console.warn("survey: could not ask whether this member finished, so it stays shut", e); return null; })
      /* v4.23: share only the call in flight. A false goes stale the moment the member finishes on another device ("no
         matter what"), and a null the moment the network comes back, so the next opening asks again. A true stays,
         unless a save already put its own true in its place. */
      .then(function(v){ if (v !== true && asked[p.id] === call) delete asked[p.id]; return v; });
  }
  return asked[p.id];
};

/* ---------- rendering (pure strings; the test renders these too) ---------- */
var TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>';
function opt(type, name, value, on, inner, cls){
  return '<label class="sv-opt' + (cls ? " " + cls : "") + '"><input type="' + type + '" name="' + name + '" value="' + esc(value) + '"' +
    (on ? " checked" : "") + '><span class="sv-box">' + (type === "checkbox" ? TICK : "") + '</span><span class="sv-lbl">' + inner + '</span></label>';
}
function tool(act, label, extra){ return '<button type="button" class="sv-tool" data-sv="' + act + '"' + (extra || "") + '>' + esc(label) + '</button>'; }
function allPicked(list, picks){ return list.length > 0 && list.every(function(x){ return picks.indexOf(x) >= 0; }); }
function answered(a, id){ return !!((a[id] && a[id].length) || a[id + "None"]); }
/* "Same as Gold" shows pressed while this tier still matches the one it copied, so the copy is visible on a phone too */
function matches(a, id, from){
  var x = (a[id] || []).slice().sort().join("|"), y = (a[from] || []).slice().sort().join("|");
  return answered(a, from) && x === y && !!a[id + "None"] === !!a[from + "None"];
}
SV.questionHtml = function(q, a){
  var h = '<h3 class="sv-title" id="svTitle" tabindex="-1">' +
    (q.tier ? '<i class="sv-tier ' + q.tier + '" aria-hidden="true"></i>' : "") + esc(q.title) + '</h3>' +
    '<p class="sv-hint">' + esc(q.kind === "xf" ? "Check any. A tag marks what Rule 4.5 bans today." : q.hint) + '</p>';
  var picks = a[q.id] || [];
  if (q.kind === "multi"){
    if (q.all) h += '<div class="sv-tools">' + tool("all", allPicked(q.options, picks) ? "Clear all" : "Select all") + '</div>';
    h += '<div class="sv-grid' + (q.cols ? " " + q.cols : "") + '" role="group" aria-labelledby="svTitle">' +
      q.options.map(function(o){ return opt("checkbox", q.id, o, picks.indexOf(o) >= 0, esc(o)); }).join("") + '</div>';
    if (q.then){
      var t = q.then;
      h += '<p class="sv-sub" id="svThen">' + esc(t.title) + ' <span>Optional</span></p>' +
        '<div class="sv-pills" role="radiogroup" aria-labelledby="svThen">' +
        t.options.map(function(o){ return opt("radio", t.id, o, a[t.id] === o, esc(o), "sv-pill"); }).join("") + '</div>';
    }
  } else if (q.kind === "one"){
    h += '<div class="sv-grid c1" role="radiogroup" aria-labelledby="svTitle">' + q.options.map(function(o){
      return opt("radio", q.id, o[0], a[q.id] === o[0], '<b>' + esc(o[0]) + '</b>' + (o[1] ? '<small>' + esc(o[1]) + '</small>' : ""), "sv-one");
    }).join("") + '</div>';
  } else if (q.kind === "xf"){
    var every = SV.XF.skaters.concat(SV.XF.goalies), none = !!a[q.id + "None"];
    h += '<div class="sv-tools sv-xf-bar">' + tool("all", allPicked(every, picks) ? "Clear all" : "Select all") +
      tool("none", "None", ' aria-pressed="' + none + '"') +
      (q.same || []).map(function(from){
        var src = SV.Q.filter(function(x){ return x.id === from; })[0];
        return tool("same", "Same as " + SV.TIERS[src.tier], ' data-from="' + from + '" aria-pressed="' + matches(a, q.id, from) + '"' + (answered(a, from) ? "" : " disabled"));
      }).join("") +
      /* the list scrolls under this bar, so the bar carries the tier: no one loses which screen they are on */
      '<span class="sv-bar-tier"><i class="sv-tier ' + q.tier + '" aria-hidden="true"></i>' + SV.TIERS[q.tier] + '</span></div>';
    var group = function(label, names){
      return '<p class="sv-grp">' + label + '</p><div class="sv-grid sv-xf" role="group" aria-label="' + label + '">' +
        names.map(function(n){
          return opt("checkbox", q.id, n, picks.indexOf(n) >= 0,
            '<span>' + esc(n) + '</span>' + (SV.bannedNow(q.tier, n) ? '<span class="sv-tag">Banned now</span>' : ""));
        }).join("") + '</div>';
    };
    h += group("Skaters", SV.XF.skaters) + group("Goaltenders", SV.XF.goalies);
  } else if (q.kind === "text"){
    h += '<textarea data-svt="' + q.id + '" rows="5" maxlength="' + (q.max || 2000) + '" aria-labelledby="svTitle"' +
      (q.ph ? ' placeholder="' + esc(q.ph) + '"' : "") + '>' + esc(a[q.id] || "") + '</textarea>' +
      /* the cap shows, so a long note pasted from a phone is never cut short in silence */
      '<p class="sv-cnt" id="svCnt">' + (a[q.id] || "").length + " / " + (q.max || 2000) + '</p>';
  }
  return h;
};
/* step 0 is the intro, 1..N the questions, N+1 the thanks */
SV.stepHtml = function(step, a, from){
  var N = SV.Q.length, gate = from === "signup", C = SV.COPY;
  if (step === 0) return {
    body: '<div class="sv-intro"><p class="eyebrow chr">' + esc(C.name) + '</p>' +
      '<h3 class="sv-title" id="svTitle" tabindex="-1">' + esc(gate ? C.gateTitle : C.introTitle) + '</h3>' +
      '<p class="sv-lede">' + esc(C.introSub) + '</p></div>',
    /* a quiet link, like every question screen's: skipping is offered, not presented as the equal choice */
    foot: '<button type="button" class="sv-skip" data-close>' + esc(gate ? C.gateSkip : C.skip) + '</button>' +
      '<button type="button" class="btn btn-chrome" data-sv="start">' + esc(C.start) + '</button>' };
  if (step > N) return {
    body: '<div class="sv-done"><span class="sv-done-mark">' + CG.ic("check", 26) + '</span>' +
      '<h3 class="sv-title" id="svTitle" tabindex="-1">' + esc(C.doneTitle) + '</h3></div>',
    foot: '<button type="button" class="btn btn-chrome" data-close data-sv="done">' + esc(gate ? C.gateDone : C.done) + '</button>' };
  return {
    body: SV.questionHtml(SV.Q[step - 1], a),
    /* from the sign-up, every screen says where a skip goes */
    foot: '<button type="button" class="sv-skip" data-close>' + esc(gate ? C.gateSkip : C.skipSurvey) + '</button>' +
      '<button type="button" class="btn btn-ghost" data-sv="back">Back</button>' +
      '<button type="button" class="btn btn-chrome" data-sv="next">' + (step === N ? "Finish" : "Next") + '</button>' };
};
SV.progressHtml = function(step){
  var N = SV.Q.length, segs = "";
  for (var i = 1; i <= N; i++) segs += '<i' + (i <= step ? ' class="on"' : "") + '></i>';
  return '<span class="sv-segs" aria-hidden="true">' + segs + '</span>' +
    '<span class="sv-count">' + (step >= 1 && step <= N ? step + " of " + N : "") + '</span>';
};

/* ---------- the dialog ---------- */
var cur = null, stepAt = 0;
function modalEl(){ return document.querySelector("#overlay-root .modal.sv"); }
/* phones: the on-screen keyboard covers a bottom sheet (neither iOS Safari nor Android Chrome shrinks the layout
   viewport for it), so the sheet rides on the visual viewport and Next stays above the keys. Only the phone sheet,
   and not while pinch-zoomed, when the visual viewport is small for another reason. */
var vv = window.visualViewport, phone = window.matchMedia ? window.matchMedia("(max-width:560px)") : null;
function lift(){
  var m = modalEl(); if (!m || !vv) return;
  var kb = phone && phone.matches && vv.scale < 1.01 ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  m.style.bottom = kb ? kb + "px" : "";
  m.style.maxHeight = kb ? Math.round(vv.height - 8) + "px" : "";
}
if (vv){ vv.addEventListener("resize", lift); vv.addEventListener("scroll", lift); }
SV.open = function(from){
  shownThisLoad = true;                 /* any showing is this load's showing, however it is dismissed */
  cur = { from: from, step: 0, dir: 1, st: SV.load() };
  CG._lastFocus = document.activeElement;
  document.body.style.overflow = "hidden";
  document.getElementById("overlay-root").innerHTML =
    '<div class="ov-bg" data-close></div>' +
    '<div class="modal sv" role="dialog" aria-modal="true" aria-labelledby="svTitle">' +
      '<div class="mo-h"><div class="sv-prog" id="svProg"></div>' +
        '<button type="button" class="icon-btn" data-close aria-label="' + SV.COPY.skipSurvey + '">' + CG.ic("x") + '</button></div>' +
      '<div class="mo-b" id="svBody"></div><div class="mo-f" id="svFoot"></div>' +
    '</div>';
  wire(modalEl());
  paint();
};
function paint(){
  var m = modalEl(); if (!m || !cur) return;
  var s = SV.stepHtml(cur.step, cur.st.answers, cur.from), body = document.getElementById("svBody");
  /* desktop: every question screen is one height, so Next never moves and a quick second click meets Next again */
  m.classList.toggle("sv-q", cur.step >= 1 && cur.step <= SV.Q.length);
  /* a tap outside closes only the intro; mid-survey it is a tap to put the keyboard away, not a skip (X, Skip and
     Escape still close at every step) */
  var bg = document.querySelector("#overlay-root .ov-bg"); if (bg) bg.toggleAttribute("data-close", cur.step === 0);
  document.getElementById("svProg").innerHTML = SV.progressHtml(cur.step);
  body.innerHTML = '<div class="sv-step" data-dir="' + cur.dir + '">' + s.body + '</div>';
  body.scrollTop = 0;
  document.getElementById("svFoot").innerHTML = s.foot;
  var f = cur.step === 0 ? m.querySelector('[data-sv="start"]') : cur.step > SV.Q.length ? m.querySelector('[data-sv="done"]') : document.getElementById("svTitle");
  if (f) f.focus({ preventScroll: true });
}
function go(step){ stepAt = Date.now(); cur.dir = step >= cur.step ? 1 : -1; cur.step = step; paint(); }
function q(){ return SV.Q[cur.step - 1]; }
function keep(){ SV.save(cur.st); }
/* repaint the toolbar labels in place: an edit never re-renders the list under the pointer */
function syncTools(m){
  var qq = q(); if (!qq) return;
  var a = cur.st.answers, picks = a[qq.id] || [];
  var list = qq.kind === "xf" ? SV.XF.skaters.concat(SV.XF.goalies) : qq.options;
  var all = m.querySelector('[data-sv="all"]'); if (all) all.textContent = allPicked(list, picks) ? "Clear all" : "Select all";
  var none = m.querySelector('[data-sv="none"]'); if (none) none.setAttribute("aria-pressed", String(!!a[qq.id + "None"]));
  Array.prototype.forEach.call(m.querySelectorAll('[data-sv="same"]'), function(b){ b.setAttribute("aria-pressed", String(matches(a, qq.id, b.getAttribute("data-from")))); });
}
function setPicks(m, qq, picks){
  var a = cur.st.answers;
  a[qq.id] = picks;
  if (qq.kind === "xf" && picks.length) a[qq.id + "None"] = false;
  Array.prototype.forEach.call(m.querySelectorAll('input[name="' + qq.id + '"]'), function(i){ i.checked = picks.indexOf(i.value) >= 0; });
  keep(); syncTools(m);
}
function finish(btn){
  btn.disabled = true;
  SV.submit(cur.st, cur.from).then(function(ok){
    if (!ok) throw new Error("the save was not confirmed");
    go(SV.Q.length + 1);
  }).catch(function(e){
    btn.disabled = false;
    CG.toast("Couldn’t save your answers: " + ((e && e.message) || "try again"), "err");
  });
}
function wire(m){
  m.addEventListener("change", function(e){
    var t = e.target, qq = q(); if (!qq || !t.name) return;
    var a = cur.st.answers;
    if (t.type === "radio") a[t.name] = t.value;
    else a[t.name] = Array.prototype.map.call(m.querySelectorAll('input[name="' + t.name + '"]:checked'), function(i){ return i.value; });
    if (qq.kind === "xf" && a[qq.id].length) a[qq.id + "None"] = false;
    keep(); syncTools(m);
  });
  m.addEventListener("input", function(e){
    var k = e.target.getAttribute && e.target.getAttribute("data-svt");
    if (k){ cur.st.answers[k] = e.target.value; keep(); }
    var c = k && document.getElementById("svCnt"); if (c) c.textContent = e.target.value.length + " / " + e.target.maxLength;
  });
  m.addEventListener("click", function(e){
    var b = e.target.closest("[data-sv]"); if (!b || !cur) return;
    var act = b.getAttribute("data-sv"), qq = q(), a = cur.st.answers;
    /* the second half of a double click lands on the new screen's Next, Back or Done: swallow it, including Done's
       close (the page's own [data-close] handler runs after this one) */
    if ((act === "start" || act === "next" || act === "back" || act === "done") && Date.now() - stepAt < SV.STEP_MS){ e.stopPropagation(); return; }
    if (act === "start") go(1);
    else if (act === "back") go(cur.step - 1);
    else if (act === "next"){ if (cur.step >= SV.Q.length) finish(b); else go(cur.step + 1); }
    else if (act === "all"){
      var list = qq.kind === "xf" ? SV.XF.skaters.concat(SV.XF.goalies) : qq.options;
      setPicks(m, qq, allPicked(list, a[qq.id] || []) ? [] : list.slice());
    }
    else if (act === "none"){ a[qq.id + "None"] = !a[qq.id + "None"]; setPicks(m, qq, []); }
    else if (act === "same"){
      var from = b.getAttribute("data-from");
      a[qq.id + "None"] = !!a[from + "None"];
      setPicks(m, qq, (a[from] || []).slice());
    }
  });
  /* Enter moves on (Space still toggles a box); never inside a text box or on a button */
  m.addEventListener("keydown", function(e){
    if (e.key !== "Enter" || e.target.closest("textarea,button,a")) return;
    var p = m.querySelector('[data-sv="next"],[data-sv="start"]');
    if (p){ e.preventDefault(); p.click(); }
  });
}

/* ---------- trigger (a): the day's first load, at an idle moment ---------- */
var loadedAt = Date.now(), lastActive = 0, shownThisLoad = false, gateVisit = false, pendingGate = false;
["keydown", "input", "pointerdown", "wheel", "touchstart", "scroll"].forEach(function(ev){
  document.addEventListener(ev, function(){ lastActive = Date.now(); }, { capture: true, passive: true });
});
function routeName(){ return (location.hash || "#/home").replace(/^#\//, "").split("?")[0].split("/")[0] || "home"; }
function typingNow(){ var ae = document.activeElement; return !!(ae && ae.closest && ae.closest("input,textarea,select,[contenteditable]")); }
SV.dialogOpen = function(){
  var ov = document.getElementById("overlay-root");
  /* an open masthead menu counts: the survey must not open over it and leave it hanging under the scrim */
  return !!((ov && ov.children.length) || document.getElementById("palette") ||
            document.querySelector("#mobilenav.open,dialog[open],#masthead .mh-dd .pop:not([hidden])"));
};
SV.env = function(){
  return {
    member: SV.asMember(), window: SV.explicit || SV.inWindow(CG.SEASONS),
    booted: !CG.LIVE_MODE || !!CG.lg, visible: document.visibilityState !== "hidden",
    dialog: SV.dialogOpen(), typing: typingNow(),
    sinceLoad: Date.now() - loadedAt, idle: Date.now() - lastActive, route: routeName()
  };
};
/* Not the day's first load: no tick ever runs. Otherwise wait for a quiet moment, ask the server, and look again,
   because the answer can land after the moment has passed. Only a confirmed "not finished" keeps it waiting. */
function dailyTick(){
  if (!SV.firstLoad || shownThisLoad || Date.now() - loadedAt > SV.GIVEUP_MS) return;
  if (!SV.canInterrupt(SV.env())){ setTimeout(dailyTick, SV.POLL_MS); return; }
  SV.status().then(function(status){
    if (!SV.dailyDue(SV.load(), SV.firstLoad, status)) return;
    if (!shownThisLoad && Date.now() - loadedAt <= SV.GIVEUP_MS && SV.canInterrupt(SV.env())) SV.open("daily");
    else setTimeout(dailyTick, SV.POLL_MS);
  });
}
if (SV.firstLoad) setTimeout(dailyTick, SV.PAINT_MS);

/* ---------- trigger (b): before the Season 2 sign-up form, every visit until finished ---------- */
SV.gateApplies = function(){
  if (SV.explicit) return true;
  var s = CG.regSeason ? CG.regSeason() : null;
  /* only while Season 2 is still ahead: its sign-ups stay open into the season, until its movement deadline */
  return !!(document.getElementById("regSubmit") && s && s.number === SV.SEASON && SV.inWindow(CG.SEASONS));
};
var afterRegister = CG.AFTER.register;
CG.AFTER.register = function(){
  if (afterRegister) afterRegister.apply(this, arguments);
  /* the router also calls this to repaint the page in place; only a fresh arrival is gated */
  var forced = pendingGate, want = forced || (!gateVisit && SV.asMember() && !SV.load().done && SV.gateApplies());
  if (!want || SV.dialogOpen()) return;
  pendingGate = false; gateVisit = true;    /* claimed now, so a repaint while the answer is in flight never asks twice */
  /* the same status as the daily pop-up: finished or unknown goes straight to the form, and so does a person who left
     the page, opened something else or started typing while the answer was on its way */
  (forced ? Promise.resolve(null) : SV.status()).then(function(status){
    if (!(forced || SV.gateDue(SV.load(), status)) || routeName() !== "register" || SV.dialogOpen() || typingNow()) return;
    SV.open("signup");
  });
};
/* runs after the router's own hashchange, so leaving the sign-up re-arms the gate for the next visit */
window.addEventListener("hashchange", function(){ if (routeName() !== "register") gateVisit = false; });

/* ---------- the commissioner's results (v4.23): Control Center > Seasons ----------
   One read, public.season_survey_results (commissioners only; no name, profile id or row id leaves it), counted here
   from SV.Q and SV.XF, so the results can only ever name a question, a choice or an X-Factor the survey asked about.
   part_live.js composes it under the Seasons tab's season record, the settings these answers inform: a section of an
   existing tab, not a thirteenth one. */
SV.SHOW = 5;    /* written answers shown per question before "Show all" */
var res = { data: null, err: null, busy: false, all: {}, t: null };
var has = function(o, k){ return Object.prototype.hasOwnProperty.call(o, k); };
/* every answer a response can hold: the questions, plus the follow-up under the nights question */
function resParts(){
  var out = [];
  SV.Q.forEach(function(x){
    out.push(x);
    if (x.then) out.push({ id: x.then.id, kind: "one", title: x.then.title, options: x.then.options });
  });
  return out;
}
function choicesOf(x){
  return x.kind === "xf" ? SV.XF.skaters.concat(SV.XF.goalies)
    : (x.options || []).map(function(o){ return typeof o === "string" ? o : o[0]; });
}
/* Pure, so the test can hold it. rows: season_survey_results' responses, newest first (the order is the server's).
   Only a choice the survey offered is counted; anything else is counted as odd and said under its chart, never
   dropped in silence. A name repeated inside one answer counts once. */
SV.tally = function(rows){
  var t = { count: 0, daily: 0, signup: 0, q: {} }, parts = resParts();
  parts.forEach(function(x){
    var v = {}; choicesOf(x).forEach(function(c){ v[c] = 0; });
    t.q[x.id] = { answered: 0, none: 0, odd: 0, removed: {}, votes: v, texts: [] };
  });
  (rows || []).forEach(function(r){
    r = r || {};
    var a = (r.answers && typeof r.answers === "object") ? r.answers : {};
    t.count++;
    if (r.source === "daily") t.daily++; else if (r.source === "signup") t.signup++;
    parts.forEach(function(x){
      var s = t.q[x.id], v = a[x.id];
      if (x.kind === "text"){ if (typeof v === "string" && v.trim()) s.texts.push({ text: v.trim(), at: r.finished_at }); return; }
      var list = x.kind === "one" ? (typeof v === "string" && v ? [v] : []) : (Array.isArray(v) ? v : []);
      var none = x.kind === "xf" && a[x.id + "None"] === true;
      if (!list.length && !none) return;
      s.answered++;
      if (none) s.none++;
      var seen = {};
      list.forEach(function(c){
        if (typeof c !== "string" || has(seen, c)) return;
        seen[c] = true;
        if (has(s.votes, c)) s.votes[c]++;
        else if (x.kind === "xf" && has(SV.XF.removed, c)) s.removed[c] = (s.removed[c] || 0) + 1;   /* v4.28: said by name */
        else s.odd++;
      });
    });
  });
  return t;
};
function share(n, d){ return d ? Math.round(100 * n / d) : 0; }
function oddNote(s){
  /* v4.28: a removed X-Factor is named with the reason, before any other uncounted answer */
  var notes = Object.keys(s.removed || {}).map(function(c){
    var n = s.removed[c];
    return c + " was removed from the survey (" + SV.XF.removed[c] + "), so " + n + " earlier vote" + (n === 1 ? "" : "s") + " for it " +
      (n === 1 ? "is" : "are") + " not counted.";
  });
  if (s.odd) notes.push(s.odd + " answer" + (s.odd === 1 ? "" : "s") + " named a choice the survey does not offer, so " +
    (s.odd === 1 ? "it is" : "they are") + " not counted.");
  return notes.length ? notes.join(" ") : null;
}
/* one bar per choice, filled against the people who answered the question */
function voteBars(x, s, o){
  return CG.viz.hbars(choicesOf(x).map(function(c){
    var n = s.votes[c];
    return { k: c, v: n, cap: s.answered, tag: o.tag ? o.tag(c) : "",
             tip: c + ": " + n + " of " + s.answered + " (" + share(n, s.answered) + "%)" };
  }), { sort: !!o.sort, note: oddNote(s), fmt: function(v){ return o.pct ? v + " (" + share(v, s.answered) + "%)" : String(v); } });
}
function answeredOf(s, t){ return s.answered + " of " + t.count + " answered"; }
var NOBODY = '<p class="vz-note">No one has answered this yet.</p>';
/* the nights are columns (Monday to Sunday reads across); a one-choice answer, the follow-up included, is bars */
function choiceCard(x, t){
  var s = t.q[x.id], body = !s.answered ? NOBODY : x.kind === "multi"
    ? CG.viz.bars(choicesOf(x).map(function(c){
        /* three letters under a column: a full day name does not fit one */
        return { k: c.slice(0, 3), v: s.votes[c], tip: c + ": " + s.votes[c] + " of " + s.answered + " (" + share(s.votes[c], s.answered) + "%)" };
      }), { note: oddNote(s) })
    : voteBars(x, s, { pct: true });
  return CG.viz.card({ title: x.title, sub: answeredOf(s, t), body: body, rv: false });
}
function tierCard(x, t){
  var s = t.q[x.id];
  return CG.viz.card({ title: x.title.replace(/ X-Factors:.*$/, ""), rv: false,
    sub: answeredOf(s, t) + " · " + s.none + " voted None",
    body: s.answered ? voteBars(x, s, { sort: true, tag: function(c){ return SV.bannedNow(x.tier, c) ? "Banned now" : ""; } }) : NOBODY });
}
function when(at){ var ms = Date.parse(at || ""); return isFinite(ms) && CG.fmtDay ? CG.fmtDay(ms) : ""; }
function textCard(x, t){
  var s = t.q[x.id], all = !!res.all[x.id], list = all ? s.texts : s.texts.slice(0, SV.SHOW);
  return '<div class="card" data-svr-card="' + x.id + '"><div class="card-h"><h3>' + esc(x.title) + '</h3>' +
      '<span class="chip">' + s.texts.length + '</span></div>' +
    (s.texts.length
      ? '<ol class="svr-list">' + list.map(function(e){
          return '<li><p>' + esc(e.text) + '</p><span class="caption">' + esc(when(e.at)) + '</span></li>';
        }).join("") + '</ol>' +
        (s.texts.length > SV.SHOW ? '<div class="svr-more"><button type="button" class="btn btn-ghost btn-sm" data-svr-all="' + x.id +
          '" aria-expanded="' + all + '">' + (all ? "Show the newest " + SV.SHOW : "Show all " + s.texts.length) + '</button></div>' : "")
      : '<div class="card-b"><span class="caption">No written answers yet.</span></div>') + '</div>';
}
function kpi(n, label){ return '<div class="kpi"><b class="num">' + n + '</b><span>' + label + '</span></div>'; }
/* pure: the tally drawn, in the survey's own order */
SV.resultsBody = function(t){
  if (!t.count) return '<div class="card"><div class="empty"><div class="e-art">' + CG.ic("doc", 22) + '</div><b>No answers yet</b>' +
    '<p>Members meet the survey on their first visit of the day and before the Season ' + SV.SEASON + ' sign-up. Each finished survey lands here.</p></div></div>';
  var of = function(kinds){ return resParts().filter(function(x){ return kinds.indexOf(x.kind) >= 0; }); };
  return '<div class="svr-kpis">' + kpi(t.count, t.count === 1 ? "response" : "responses") +
      /* a hyphenated word wraps at its hyphen; three across a phone, "pop-" and "up" landed on two lines */
      kpi(t.daily, "from the daily <i>pop-up</i>") + kpi(t.signup, "from the <i>sign-up</i>") + '</div>' +
    '<div class="svr-cols">' + of(["one", "multi"]).map(function(x){ return choiceCard(x, t); }).join("") + '</div>' +
    '<h3 class="svr-h3">X-Factor bans</h3><p class="caption svr-cap">Votes to ban each X-Factor at each tier, most first. ' +
      'A tag marks what Rule 4.5 bans today.</p>' +
    '<div class="svr-cols">' + of(["xf"]).map(function(x){ return tierCard(x, t); }).join("") + '</div>' +
    '<h3 class="svr-h3">Written answers</h3><p class="caption svr-cap">Anonymous, newest first.</p>' +
    '<div class="svr-cols">' + of(["text"]).map(function(x){ return textCard(x, t); }).join("") + '</div>';
};
SV.resultsHtml = function(){
  var body = res.data ? SV.resultsBody(res.t) : res.err ? "" :
    '<div class="card"><div class="card-b"><span class="caption">Loading the answers…</span></div></div>';
  return '<section class="svr" id="svResults" aria-labelledby="svrTitle">' +
    '<div class="svr-head"><div><h2 class="h-sec" id="svrTitle">' + esc(SV.COPY.name) + '</h2>' +
      '<p class="lede">What members told the league ahead of Season ' + SV.SEASON + '. Anonymous: no name or account leaves the database.</p></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-svr="reload"' + (res.busy ? " disabled" : "") + '>' + (res.busy ? "Loading…" : "Refresh") + '</button></div>' +
    (res.err ? '<div class="note red" role="alert" style="margin-bottom:14px">Couldn’t load the survey results: ' + esc(res.err) + '</div>' : "") +
    body + '</section>';
};
/* repaint the section in place; the click listener rides on the section, so it is wired again with it */
function paintResults(){
  var el = document.getElementById("svResults"); if (!el) return;    /* the commissioner has left the Seasons tab */
  el.outerHTML = SV.resultsHtml();
  wireResults();
}
function wireResults(){
  var el = document.getElementById("svResults"); if (!el || el.getAttribute("data-wired")) return;
  el.setAttribute("data-wired", "1");
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-svr],[data-svr-all]"); if (!b) return;
    var id = b.getAttribute("data-svr-all");
    if (!id){ SV.loadResults(); return; }
    /* "Show all" redraws its own card only */
    res.all[id] = !res.all[id];
    var card = el.querySelector('[data-svr-card="' + id + '"]'), x = SV.Q.filter(function(y){ return y.id === id; })[0];
    if (card && x && res.t) card.outerHTML = textCard(x, res.t);
  });
}
/* Every arrival at the Seasons tab reads again (answers keep landing); the last answers stay on screen meanwhile. A
   refusal or a network error says so above them (fail loud), and Refresh is the retry. */
SV.loadResults = function(){
  if (!CG.role || CG.role() !== "commish") return;     /* the Control Center's own gate; the server refuses anyone else */
  if (res.busy){ wireResults(); return; }              /* a read already on its way paints this section when it lands */
  res.busy = true; paintResults();
  /* inside the promise, so even a client that throws on the spot lands in the catch and never leaves the section busy */
  new Promise(function(ok){
    if (!CG.sb) throw new Error("no database client");
    ok(CG.sb.rpc("season_survey_results", { p_survey: SV.KEY }));
  })
    .then(function(r){
      if (r.error) throw new Error(String(r.error.message || "the league refused").replace(/^.*SURVEY:\s*/, ""));
      if (!r.data || !Array.isArray(r.data.responses)) throw new Error("the league sent no list of answers");
      res.data = r.data; res.t = SV.tally(r.data.responses); res.err = null;
    })
    .catch(function(e){ console.error("survey results:", e); res.err = (e && e.message) || "unknown error"; })
    .then(function(){ res.busy = false; paintResults(); });
};

/* ---------- the preview panel (local hosts only) ---------- */
function pvStatus(){
  var el = document.getElementById("svPvSt"); if (!el) return;
  el.textContent = (SV.load().done ? "Finished in this browser" : "Not finished in this browser") + " · " +
    (SV.firstLoad ? "first load today" : "not the first load today");
}
function previewPanel(){
  if (!SV.preview || document.getElementById("svPreview")) return;
  var el = document.createElement("div");
  el.id = "svPreview"; el.className = "sv-pv";
  el.setAttribute("role", "region"); el.setAttribute("aria-label", "Survey preview");
  el.innerHTML =
    '<div class="sv-pv-h"><b>Survey preview</b><span class="chip chip-xs">Local</span>' +
      '<button type="button" class="sv-pv-min" data-pv="min" aria-expanded="true">Hide</button></div>' +
    '<p class="sv-pv-st" id="svPvSt"></p>' +
    '<div class="sv-pv-b">' +
      '<button type="button" class="btn btn-sm btn-ink" data-pv="daily">Show the daily pop-up</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-pv="gate">Show the sign-up gate</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-pv="reset">Reset</button>' +
    '</div>';
  document.body.appendChild(el);
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-pv]"); if (!b) return;
    var act = b.getAttribute("data-pv");
    if (act === "min"){
      var min = el.classList.toggle("min");
      b.textContent = min ? "Show" : "Hide"; b.setAttribute("aria-expanded", String(!min));
    } else if (act === "daily"){
      if (CG.closeOverlay) CG.closeOverlay();
      SV.open("daily");
    } else if (act === "gate"){
      if (CG.closeOverlay) CG.closeOverlay();
      if (routeName() === "register"){ gateVisit = true; SV.open("signup"); }
      else { pendingGate = true; location.hash = "#/register"; }
    } else if (act === "reset"){
      /* this browser only: a member whose answers the league already has stays finished */
      try { localStorage.removeItem(storeKey()); localStorage.removeItem(dayKey); }
      catch(err){ console.warn("survey: could not reset", err); CG.toast("Couldn’t reset: this browser refused its storage", "err"); return; }
      asked = {}; gateVisit = false; pvStatus();
      CG.toast(SV.asMember() ? "Reset in this browser. Refresh and it pops up after a few quiet seconds, unless the league already has your answers."
                             : "Survey reset. Signed out, open the page with ?survey=preview to test a refresh.", "ok");
    }
  });
  pvStatus();
}
if (document.body) previewPanel();
else document.addEventListener("DOMContentLoaded", previewPanel);
})();
