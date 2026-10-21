/* v4.23: the Season 2 survey, live. The commissioner (2026-10-20): "create a survey that goes over suggestions and
   complaints about season 1, and questions about season 2 including what player x-factors need to be banned at each
   tier of the x-factor, weekly game day preferences, and anything they would like to see in season 2 and beyond."
   It "should pop up when someone refreshes the website once a day, or whenever someone goes to sign up for season 2
   ... before they can fill out their info for the signup. The survey is skippable."
   Approving it for the live site (2026-10-20): "Add the survey to the live site. Only show it on the user's first
   refresh of the calendar day, and when the click on the signup page for season 2." and "If a player has filled it
   out at any point, do not show them the survey again no matter what."
   This runs the real src/live/part11_survey.js in a sandbox (a fake clock, timers and database client) and pins the
   question set, the one X-Factor list, the trigger rules, the save and the database record
   sql/2026-10-20-season2-survey-v423.sql.
   Run: node tools/season2-survey-v423.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const src = R("src/live/part11_survey.js"), css = R("src/live/part1_head.html"), build = R("src/live/build.cjs"),
      ui = R("src/live/part4_ui.js"), content = R("src/live/part3_content.js"),
      sql = R("sql/2026-10-20-season2-survey-v423.sql"), audit = R("tools/sql/grant-audit.sql");
const flush = () => new Promise((r) => setImmediate(r));
const viz = ui.slice(ui.indexOf("CG.viz = (function(){"), ui.indexOf("\n})();", ui.indexOf("CG.viz = (function(){")) + 6),
      fmtDay = (ui.match(/CG\.fmtDay\s*=\s*function\(ts\)\{[^\n]*\};/) || [""])[0];
/* the commissioner's results section of the file, and the member side without it */
const resSrc = src.slice(src.indexOf("/* ---------- the commissioner's results"), src.indexOf("/* ---------- the preview panel")),
      memberSrc = src.replace(resSrc, "");
const saved = (x, id) => JSON.parse(x.store["cghl:survey:s2-2026:" + id] || "{}");   /* what this browser kept for a member */

/* A sandbox with just enough browser for the file to load; the real esc() from part4. o.store is the browser's
   localStorage (share one to play a second page load), o.now the clock, o.rpc the database's answer to each call. */
function load(o){
  o = o || {};
  const store = o.store || {}, afterCalls = [], timers = [], rpcCalls = [], opened = [], listeners = {}, clock = { t: o.now || Date.parse("2026-10-20T16:00:00Z") };
  class FakeDate extends Date { static now(){ return clock.t; } }
  const ctx = { console: { log(){}, warn(){}, error(){} }, Math, Object, Array, String, Number, JSON, Date: FakeDate, Intl, Promise, RegExp, Error };
  ctx.window = ctx;
  ctx.addEventListener = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };     /* window's, so a test can fire hashchange */
  ctx.setTimeout = (fn, ms) => { timers.push({ fn, at: clock.t + ms }); return timers.length; };
  ctx.location = Object.assign({ hostname: "chelgamingleague.com", search: "", hash: "#/home" }, o.loc || {});
  ctx.localStorage = o.brokenStorage
    ? { getItem(){ throw new Error("denied"); }, setItem(){ throw new Error("denied"); }, removeItem(){ throw new Error("denied"); } }
    : { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const els = o.els || {};
  ctx.document = { body: null, activeElement: null, visibilityState: "visible", addEventListener: () => {},
                   getElementById: (id) => els[id] || null, querySelector: () => null, querySelectorAll: () => [] };
  ctx.CG = { AFTER: { register: function(){ afterCalls.push([].slice.call(arguments)); } }, ROUTES: {},
             auth: { user: o.profile ? { id: o.profile.id } : null, profile: o.profile || null },
             SEASONS: [{ number: 1, status: "complete" }, { number: 2, status: "upcoming" }],
             regSeason: () => ({ number: 2 }), toast: () => {}, role: () => o.role || "guest",
             ic: (name) => "<svg data-ic=\"" + name + "\"></svg>" };
  if (o.rpc) ctx.CG.sb = { rpc: (fn, args) => { rpcCalls.push([fn, args]); return o.rpc(fn, args); } };
  vm.createContext(ctx);
  vm.runInContext(ui.match(/function esc\(s\)\{[\s\S]*?\}\); \}/)[0], ctx);
  vm.runInContext(viz + "\n" + fmtDay, ctx);      /* the real CG.viz and CG.fmtDay, for the commissioner's results */
  vm.runInContext(src, ctx);
  const SV = ctx.CG.SURVEY;
  SV.open = (from) => { opened.push(from); };     /* the dialog itself needs a page; the trigger rules do not */
  /* run every timer due by now (again and again, as a page would), letting each database answer land in between */
  const advance = async (ms) => {
    clock.t += ms;
    for (let guard = 0; guard < 50; guard++){
      const due = timers.filter((t) => t.at <= clock.t && !t.ran);
      if (!due.length) break;
      for (const t of due){ t.ran = true; t.fn(); await flush(); }
    }
    await flush();
  };
  /* leave for another page and come back to this one, as the router's hashchange would */
  const visit = (hash) => { ctx.location.hash = hash; (listeners.hashchange || []).forEach((fn) => fn()); };
  return { ctx, SV, store, afterCalls, timers, rpcCalls, opened, clock, advance, visit };
}
const { ctx, SV, store, afterCalls } = load();

console.log("— the bundle carries it");
{
  A("part11_survey.js is a bundle part", /"part10_forums\.js",[\s\S]{0,260}"part11_survey\.js",/.test(build));
  A("...loaded after part_live (it chains CG.AFTER.register) and before init",
    build.indexOf('"part_live.js"') < build.indexOf('"part11_survey.js"') && build.indexOf('"part11_survey.js"') < build.indexOf('"part8_blueprint_init.js"'));
  A("ES5 like every part: no let, const, arrows or template strings", !/\b(let|const)\s|=>|`/.test(src));
  A("one function scope: no top-level name can collide with another part", /^\(function\(\)\{\nvar SV = CG\.SURVEY = \{\};/m.test(src) && /\n\}\)\(\);\n?$/.test(src));
  A("the styles ship in the head", /\.modal\.sv\{/.test(css) && /\.sv-xf-bar\{position:sticky/.test(css));
  A("the mockup language is gone (file, styles, build list)", !/mockup/i.test(src) && !/survey \(mockup/i.test(css + build) && !/chip-xs">Mockup</.test(src));
}

console.log("— THE question set, in order");
{
  A("eight questions", SV.Q.length === 8, SV.Q.length);
  A("in the agreed order", JSON.stringify(SV.Q.map((q) => q.title)) === JSON.stringify([
    "Season 1: what worked?", "Season 1: what needs fixing?", "Position locks for Season 2?", "Which nights can you usually play?",
    "Gold (Specialist) X-Factors: which should be banned?", "Blue (All-Star) X-Factors: which should be banned?",
    "Red (Elite) X-Factors: which should be banned?", "Anything you would like to see in Season 2 and beyond?"]), SV.Q.map((q) => q.title));
  /* commissioner, 2026-10-20: "Question 1 and 2 can be open answers that users can type out what they want." */
  for (const qi of [0, 1]){
    const q = SV.Q[qi], h = SV.questionHtml(q, {});
    A("Q" + (qi + 1) + " is ONE open text box: no chips, no Tell us more", q.kind === "text" && !q.options && !q.more &&
      (h.match(/<textarea/g) || []).length === 1 && !/type="checkbox"|type="radio"|Tell us more/.test(h), h);
    A("Q" + (qi + 1) + ": optional, with a short example in the placeholder", /^Optional\./.test(q.hint) &&
      /^For example: /.test(q.ph) && q.ph.length <= 90 && h.indexOf('placeholder="' + q.ph + '"') > 0, q.ph);
    A("Q" + (qi + 1) + ": capped at 1000 characters, saved under its own id", q.max === 1000 && /maxlength="1000"/.test(h) && h.indexOf('data-svt="' + q.id + '"') > 0);
  }
  A("the Tell us more toggle is gone from the file", !/Tell us more|data-sv="more"|sv-more/.test(src + css));
  A("Q3 choose one: bring back, keep open, no preference", SV.Q[2].kind === "one" &&
    JSON.stringify(SV.Q[2].options.map((o) => o[0])) === JSON.stringify(["Bring back position locks", "Keep positions open", "No preference"]));
  A("...each lock option says what it means", /signed up at/.test(SV.Q[2].options[0][1]) && /anyone anywhere, as now/.test(SV.Q[2].options[1][1]));
  A("Q4 the seven nights, check any, with Select all", SV.Q[3].kind === "multi" && SV.Q[3].all &&
    JSON.stringify(SV.Q[3].options) === JSON.stringify(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]));
  A("...hinting that Season 1 played Wednesday to Friday", /Season 1 played Wednesday to Friday/.test(SV.Q[3].hint));
  A("...then an optional nights-a-week, choose one", SV.Q[3].then && JSON.stringify(SV.Q[3].then.options) === JSON.stringify(["1", "2", "3", "4 or more"]));
  A("Q5 to Q7 are three SEPARATE X-Factor questions, Gold, Blue, Red", JSON.stringify(SV.Q.slice(4, 7).map((q) => q.kind + ":" + q.tier)) === JSON.stringify(["xf:gold", "xf:blue", "xf:red"]));
  A("Blue offers Same as Gold; Red offers Same as Gold and Same as Blue",
    JSON.stringify(SV.Q[4].same || []) === "[]" && JSON.stringify(SV.Q[5].same) === '["xfGold"]' && JSON.stringify(SV.Q[6].same) === '["xfGold","xfBlue"]');
  A("Q8 optional free text, still 2000 characters", SV.Q[7].kind === "text" && /maxlength="2000"/.test(SV.questionHtml(SV.Q[7], {})));
  A("three typed answers in all (Q1, Q2, Q8): what the time promise is sized for",
    JSON.stringify(SV.Q.filter((q) => q.kind === "text").map((q) => q.id)) === '["worked","fix","wish"]');
  A("intro copy", SV.COPY.introTitle === "Help shape Season 2" && SV.COPY.introSub === "8 quick questions, about 3 minutes. Skip anything you like.");
  A("...the count comes from the list, so it cannot drift", /introSub: SV\.Q\.length \+ " quick questions/.test(src));
  A("from the sign-up: its own title and Skip to sign-up", SV.COPY.gateTitle === "Before you sign up, help shape Season 2" && SV.COPY.gateSkip === "Skip to sign-up");
  A("thanks, then Done or Continue to sign-up", SV.COPY.doneTitle === "Thanks, that helps" && SV.COPY.done === "Done" && SV.COPY.gateDone === "Continue to sign-up");
  A("nothing is required", !/\brequired\b/.test(src) && !/disabled[^;]*data-sv="next"|data-sv="next"[^;]*disabled/.test(src));
}

console.log("— THE X-Factor list");
{
  const sk = SV.XF.skaters, gk = SV.XF.goalies;
  /* v4.28 (commissioner, 2026-10-21): Quick Draw is not an X-Factor in World of Chel, so the list is 22 skaters, 27 in all
     (tools/survey-quick-draw-v428.test.cjs) */
  A("22 skater X-Factors, every name", JSON.stringify(sk) === JSON.stringify(["Ankle Breaker", "Backhand Beauty", "Big Rig", "Big Tipper", "Born Leader",
    "Elite Edges", "Hipster", "No Contest", "One T", "Pressure+", "Quick Pick", "Quick Release", "Rocket", "Second Wind", "Send It",
    "Spark Plug", "Stick ’Em Up", "Tape to Tape", "Truculence", "Unstoppable Force", "Warrior", "Wheels"]), sk);
  A("5 goaltender X-Factors", JSON.stringify(gk) === JSON.stringify(["Dialed In", "Post to Post", "Recharge", "Show Stopper", "Sponge"]), gk);
  A("alphabetical within each group", [sk, gk].every((l) => JSON.stringify(l) === JSON.stringify(l.slice().sort((a, b) => a.localeCompare(b)))));
  A("Stick ’Em Up keeps its curly apostrophe", sk.indexOf("Stick ’Em Up") >= 0 && !/Stick 'Em/.test(src));
  A("ONE list, with the NHL 26 provenance said where it lives", (src.match(/"Ankle Breaker"/g) || []).length === 1 &&
    /NHL 26 names from EA's official X-Factors hub, because no confirmed NHL 27\s+list exists yet/.test(src));
  A("banned now at every tier: the six", ["Truculence", "Spark Plug", "Hipster", "Pressure+", "Unstoppable Force", "Big Rig"].every((x) => ["gold", "blue", "red"].every((t) => SV.bannedNow(t, x))));
  A("Stick ’Em Up and Big Tipper only at Red", ["Stick ’Em Up", "Big Tipper"].every((x) => SV.bannedNow("red", x) && !SV.bannedNow("gold", x) && !SV.bannedNow("blue", x)));
  A("nothing else is tagged", [].concat(sk, gk).filter((x) => SV.bannedNow("red", x)).length === 8);
  const r45 = (content.match(/The following X-Factor abilities are banned at every tier the game offers them: [^"]*?Red tier only: [^.]*\./) || [""])[0];
  A("the tags match the rulebook's own Rule 4.5", r45 && SV.XF.bannedEvery.concat(SV.XF.bannedRed).every((x) => r45.indexOf(x) >= 0), r45.slice(0, 120));
  for (const qi of [4, 5, 6]){
    const q = SV.Q[qi], h = SV.questionHtml(q, {});
    A(q.tier + ": all 27 as check boxes", (h.match(/type="checkbox"/g) || []).length === 27);
    A(q.tier + ": Skaters then Goaltenders", h.indexOf(">Skaters<") > 0 && h.indexOf(">Skaters<") < h.indexOf(">Goaltenders<"));
    A(q.tier + ": nothing pre-checked", !/ checked/.test(h));
    A(q.tier + ": Select all and None", /data-sv="all"[^>]*>Select all</.test(h) && /data-sv="none"[^>]*>None</.test(h));
    A(q.tier + ": the Banned now tags", (h.match(/sv-tag">Banned now/g) || []).length === (q.tier === "red" ? 8 : 6));
  }
  const blue = SV.questionHtml(SV.Q[5], {}), red = SV.questionHtml(SV.Q[6], { xfGold: ["Rocket"] });
  A("Same as Gold waits until Gold has an answer", /data-from="xfGold"[^>]*disabled/.test(blue));
  A("...then is offered", /data-from="xfGold" aria-pressed="false">/.test(red) && /data-from="xfBlue"[^>]*disabled/.test(red));
  A("a kept answer renders checked again (Back keeps answers)", /value="Rocket" checked/.test(SV.questionHtml(SV.Q[4], { xfGold: ["Rocket"] })));
  A("None is an explicit answer, kept apart from no answer", /aria-pressed="true">None</.test(SV.questionHtml(SV.Q[4], { xfGold: [], xfGoldNone: true })));
}

console.log("— one question per screen; progress as segments");
{
  const N = SV.Q.length;
  A("intro, then one screen per question, then thanks", SV.stepHtml(0, {}, "daily").foot.indexOf('data-sv="start"') > 0 &&
    SV.Q.every((q, i) => SV.stepHtml(i + 1, {}, "daily").body.indexOf(q.title.replace(/'/g, "&#39;")) >= 0) && /Thanks, that helps/.test(SV.stepHtml(N + 1, {}, "daily").body));
  A("a quiet Skip survey on every question screen", SV.Q.every((q, i) => /class="sv-skip" data-close>Skip survey</.test(SV.stepHtml(i + 1, {}, "daily").foot)));
  A("the last question says Finish", />Finish</.test(SV.stepHtml(N, {}, "daily").foot));
  A("from the sign-up the buttons say so", />Skip to sign-up</.test(SV.stepHtml(0, {}, "signup").foot) && />Continue to sign-up</.test(SV.stepHtml(N + 1, {}, "signup").foot));
  const p = SV.progressHtml(3);
  A("segments, not a percentage", (p.match(/<i/g) || []).length === N && (p.match(/class="on"/g) || []).length === 3 && !/%/.test(p));
  A("user text is escaped", [0, 1, 7].every((i) => SV.questionHtml(SV.Q[i], { worked: "<img src=x>", fix: "<img src=x>", wish: "<img src=x>" }).indexOf("<img") < 0));
  A("Next is never blocked on an empty text box", [1, 2, 8].every((i) => /data-sv="next">Next</.test(SV.stepHtml(i, {}, "daily").foot) || (i === 8 && />Finish</.test(SV.stepHtml(i, {}, "daily").foot))));
  A("a kept typed answer renders back (Back keeps answers)", />Draft night was great<\/textarea>/.test(SV.questionHtml(SV.Q[0], { worked: "Draft night was great" })));
  /* review fixes, 2026-10-20 */
  A("every text box shows its cap as a counter", /<p class="sv-cnt" id="svCnt">21 \/ 1000<\/p>/.test(SV.questionHtml(SV.Q[0], { worked: "Draft night was great" })) &&
    /id="svCnt">0 \/ 2000</.test(SV.questionHtml(SV.Q[7], {})) && /c\.textContent = e\.target\.value\.length \+ " \/ " \+ e\.target\.maxLength/.test(src));
  A("the intro's skip is the quiet link, not a button as big as Start", /^<button type="button" class="sv-skip" data-close>Skip for now</.test(SV.stepHtml(0, {}, "daily").foot) &&
    !/btn-ghost" data-close/.test(SV.stepHtml(0, {}, "signup").foot));
  A("from the sign-up, every question screen says Skip to sign-up", SV.Q.every((q, i) => /class="sv-skip" data-close>Skip to sign-up</.test(SV.stepHtml(i + 1, {}, "signup").foot)));
  A("a double click cannot skip a screen: Start, Next, Back and Done are ignored for a moment after a step",
    /function go\(step\)\{ stepAt = Date\.now\(\);/.test(src) && SV.STEP_MS >= 300 &&
    /\(act === "start" \|\| act === "next" \|\| act === "back" \|\| act === "done"\) && Date\.now\(\) - stepAt < SV\.STEP_MS\)\{ e\.stopPropagation\(\); return; \}/.test(src));
  A("...and on desktop every question screen is one height, so Next does not move", /m\.classList\.toggle\("sv-q", cur\.step >= 1 && cur\.step <= SV\.Q\.length\)/.test(src) &&
    /@media\(min-width:561px\)\{\.modal\.sv\.sv-q\{height:min\(86vh,800px\)\}\}/.test(css));
  A("a tap outside closes only the intro, never a survey under way", /bg\.toggleAttribute\("data-close", cur\.step === 0\)/.test(src));
  A("phones: the sheet rides above the on-screen keyboard", /vv\.addEventListener\("resize", lift\); vv\.addEventListener\("scroll", lift\);/.test(src) &&
    /window\.innerHeight - vv\.height - vv\.offsetTop/.test(src));
}

(async () => {
console.log("— when it appears: the pure rules");
{
  A("the league day is Eastern", SV.today(Date.parse("2026-10-21T03:30:00Z")) === "2026-10-20" && SV.today(Date.parse("2026-10-21T04:30:00Z")) === "2026-10-21");
  A("a load is the day's first when the last stamp names another day, or none", SV.firstOfDay(null, "2026-10-20") &&
    SV.firstOfDay("2026-10-19", "2026-10-20") && !SV.firstOfDay("2026-10-20", "2026-10-20"));
  A("(a) due on the day's first load, for a member the server says has not finished", SV.dailyDue({}, true, false));
  A("(a) never on a later load the same day", !SV.dailyDue({}, false, false));
  A("(a) and (b) fail closed: an unknown status (not asked, or the call failed) opens neither",
    !SV.dailyDue({}, true, null) && !SV.dailyDue({}, true, undefined) && !SV.gateDue({}, null) && !SV.gateDue({}, undefined));
  A("finishing means never again: a server true or this browser's flag closes both paths",
    !SV.dailyDue({}, true, true) && !SV.gateDue({}, true) && !SV.dailyDue({ done: "x" }, true, false) && !SV.gateDue({ done: "x" }, false));
  A("(b) every sign-up visit until finished", SV.gateDue({}, false));
  const ok = { member: true, window: true, booted: true, visible: true, dialog: false, typing: false, sinceLoad: 6000, idle: 4000, route: "home" };
  const tweak = (k, v) => SV.canInterrupt(Object.assign({}, ok, { [k]: v }));
  A("at an idle moment on a settled page", SV.canInterrupt(ok));
  A("never for guests", !tweak("member", false));
  A("never in the first seconds of a load", !tweak("sinceLoad", 1200) && SV.PAINT_MS >= 3000);
  A("never on top of another dialog", !tweak("dialog", true));
  A("never while someone types", !tweak("typing", true) && !tweak("idle", 500));
  A("never on a hidden tab or before the league loads", !tweak("visible", false) && !tweak("booted", false));
  A("not on the sign-up (it has its own gate) or mid sign-in", !tweak("route", "register") && !tweak("route", "signin"));
  A("only while Season 2 is still ahead", SV.inWindow([{ number: 1, status: "complete" }, { number: 2, status: "upcoming" }]) &&
    !SV.inWindow([{ number: 2, status: "active" }]) && !SV.inWindow([]) && !tweak("window", false));
  /* v4.23: it stops at the Season 2 sign-up deadline, read the way the sign-up page reads it (signup_deadline_at first) */
  var dl = "2027-01-09T04:59:00Z", before = Date.parse(dl) - 60000, after = Date.parse(dl) + 60000;
  A("stops at the Season 2 sign-up deadline", SV.inWindow([{ number: 2, status: "upcoming", signup_deadline_at: dl }], before) &&
    !SV.inWindow([{ number: 2, status: "upcoming", signup_deadline_at: dl }], after) &&
    !SV.inWindow([{ number: 2, status: "upcoming", registration_deadline: dl }], after) &&
    SV.inWindow([{ number: 2, status: "upcoming", signup_deadline_at: dl, registration_deadline: "2027-01-01T00:00:00Z" }], before));
  A("the gate is the Season 2 sign-up form only, and only while Season 2 is still ahead",
    /document\.getElementById\("regSubmit"\) && s && s\.number === SV\.SEASON && SV\.inWindow\(CG\.SEASONS\)\)/.test(src) && SV.SEASON === 2);
  A("a guest is never a member", SV.asMember() === false);
  ctx.CG.auth.profile = { id: "p1" };
  A("a signed-in member is", SV.asMember() === true);
  ctx.CG.auth.profile = { id: "p1", banned: true };
  A("a banned member never is (the ban screen covers the page)", SV.asMember() === false);
  ctx.CG.auth.profile = null;
  A("...not even in a local preview", (() => { const x = load({ loc: { hostname: "localhost", search: "?survey=preview" } }); x.ctx.CG.auth.profile = { id: "p1", banned: true }; return x.SV.asMember() === false; })());
  A("an open masthead menu counts as a dialog", /#masthead \.mh-dd \.pop:not\(\[hidden\]\)/.test(src));
  A("the daily pop-up gives up after two minutes, and the day is spent",
    SV.GIVEUP_MS === 120000 && /if \(!SV\.firstLoad \|\| shownThisLoad \|\| Date\.now\(\) - loadedAt > SV\.GIVEUP_MS\) return;/.test(src));
}

console.log("— the first load of the day, played through");
{
  const member = { id: "m1" }, notDone = () => Promise.resolve({ data: false, error: null });
  const shared = {};
  const first = load({ store: shared, profile: member, rpc: notDone });
  A("the page stamps the league day as it starts", first.SV.firstLoad === true && shared["cghl:survey:s2-2026:loadDay"] === "2026-10-20");
  A("...and nothing opens in the first seconds", (await first.advance(1000), first.opened.length === 0 && first.rpcCalls.length === 0));
  await first.advance(5000);
  A("the day's first load opens it at an idle moment, once the server says not finished",
    JSON.stringify(first.opened) === '["daily"]' && first.rpcCalls.length === 1 && first.rpcCalls[0][0] === "season_survey_done" &&
    first.rpcCalls[0][1].p_survey === "s2-2026", { opened: first.opened, rpc: first.rpcCalls });
  const second = load({ store: shared, profile: member, rpc: notDone, now: Date.parse("2026-10-21T03:00:00Z") });
  await second.advance(10 * 60 * 1000);
  A("a second load the same league day never opens it, and never asks", second.SV.firstLoad === false && second.opened.length === 0 &&
    second.rpcCalls.length === 0 && second.timers.length === 0);
  const tomorrow = load({ store: shared, profile: member, rpc: notDone, now: Date.parse("2026-10-21T13:00:00Z") });
  await tomorrow.advance(6000);
  A("the next day's first load may open it again (a skip waits for tomorrow)", tomorrow.SV.firstLoad === true && JSON.stringify(tomorrow.opened) === '["daily"]');
  /* the first load could not open it (a dialog stayed open) and gave up: the day is spent */
  const busy = load({ store: {}, profile: member, rpc: notDone, els: { "overlay-root": { children: { length: 1 } } } });
  await busy.advance(5000); await busy.advance(60000); await busy.advance(70000);
  A("a first load that never finds a quiet moment gives up, and nothing reopens it that day",
    busy.opened.length === 0 && busy.timers.every((t) => t.ran || t.at > busy.clock.t) && busy.timers.filter((t) => !t.ran).length === 0);
  const again = load({ store: busy.store, profile: member, rpc: notDone });
  await again.advance(6000);
  A("...a reload after that is not the first load", again.SV.firstLoad === false && again.opened.length === 0);
  const blocked = load({ brokenStorage: true, profile: member, rpc: notDone });
  await blocked.advance(6000);
  A("a browser that refuses storage never gets the daily pop-up (fail closed)", blocked.SV.firstLoad === false && blocked.opened.length === 0);
  A("guests are never asked, and the server is never called for them", (await (async () => {
    const g = load({ rpc: notDone }); await g.advance(6000); await g.advance(130000); return g.opened.length === 0 && g.rpcCalls.length === 0; })()));
}

console.log("— never again, no matter what");
{
  const member = { id: "m2" };
  const done = load({ profile: member, rpc: () => Promise.resolve({ data: true, error: null }) });
  await done.advance(6000);
  A("a server true: the daily pop-up stays shut", done.opened.length === 0 && done.rpcCalls.length === 1);
  A("...and this browser is marked finished, so this device never asks again", !!saved(done, "m2").done &&
    (await done.SV.status()) === true && done.rpcCalls.length === 1);
  const gate = (o) => { const x = load(Object.assign({ profile: member, loc: { hash: "#/register" }, els: { regSubmit: {} } }, o)); return x; };
  const g1 = gate({ rpc: () => Promise.resolve({ data: true, error: null }) });
  g1.ctx.CG.AFTER.register(); await flush();
  A("a server true: the sign-up gate goes straight to the form", g1.opened.length === 0 && g1.rpcCalls.length === 1 && g1.afterCalls.length === 1);
  const g2 = gate({ rpc: () => Promise.resolve({ data: false, error: null }) });
  g2.ctx.CG.AFTER.register(); await flush();
  A("a server false: the gate opens before the form", JSON.stringify(g2.opened) === '["signup"]');
  g2.ctx.CG.AFTER.register(); await flush();
  A("...once per visit: the router's repaint in place is not a fresh arrival", g2.opened.length === 1 && g2.rpcCalls.length === 1);
  /* v4.23 review: the member skips, finishes on a phone, then comes back to the sign-up in this tab. The first false must
     not be reused: "If a player has filled it out at any point, do not show them the survey again no matter what." */
  g2.visit("#/home"); g2.visit("#/register");
  g2.ctx.CG.sb.rpc = (fn, args) => { g2.rpcCalls.push([fn, args]); return Promise.resolve({ data: true, error: null }); };
  g2.ctx.CG.AFTER.register(); await flush();
  A("...a false is never kept: finished on another device since, the next visit asks again and goes straight to the form",
    g2.opened.length === 1 && g2.rpcCalls.length === 2 && g2.rpcCalls[1][0] === "season_survey_done", { opened: g2.opened, rpc: g2.rpcCalls.map((c) => c[0]) });
  const g3 = gate({ rpc: () => Promise.resolve({ data: null, error: { message: "network down" } }) });
  g3.ctx.CG.AFTER.register(); await flush();
  A("a failed status call: the gate goes straight to the form (fail closed)", g3.opened.length === 0);
  const g4 = gate({ rpc: () => Promise.reject(new Error("offline")) });
  g4.ctx.CG.AFTER.register(); await flush();
  A("...and so does a rejected call", g4.opened.length === 0);
  g4.visit("#/home"); g4.visit("#/register");
  g4.ctx.CG.sb.rpc = (fn, args) => { g4.rpcCalls.push([fn, args]); return Promise.resolve({ data: false, error: null }); };
  g4.ctx.CG.AFTER.register(); await flush();
  A("...nor is a failure: once the network is back, the next visit asks again and the gate opens", JSON.stringify(g4.opened) === '["signup"]' && g4.rpcCalls.length === 2);
  /* production keeps a season's sign-ups open after it starts, until its movement deadline (flip_season_status) */
  const g5 = gate({ rpc: () => Promise.resolve({ data: false, error: null }) });
  g5.ctx.CG.SEASONS = [{ number: 1, status: "complete" }, { number: 2, status: "active", registration_open: true }];
  g5.ctx.CG.AFTER.register(); await flush();
  A("once Season 2 has started, its sign-up is never gated, and the server is never asked", g5.opened.length === 0 && g5.rpcCalls.length === 0);
  /* finished, in a browser that refuses storage: the confirmed save is kept in memory, so this load never shows it again */
  const rows = {};
  const g6 = gate({ brokenStorage: true, rpc: (fn) => {
    if (fn === "submit_season_survey"){ rows.m2 = true; return Promise.resolve({ data: true, error: null }); }
    return Promise.resolve({ data: !!rows.m2, error: null });
  } });
  g6.ctx.CG.AFTER.register(); await flush();
  const ok6 = await g6.SV.submit(g6.SV.load(), "signup");
  g6.visit("#/home"); g6.visit("#/register");
  g6.ctx.CG.AFTER.register(); await flush();
  A("finished where the browser refuses storage: the next visit in this tab goes straight to the form, without asking",
    ok6 === true && JSON.stringify(g6.opened) === '["signup"]' &&
    JSON.stringify(g6.rpcCalls.map((c) => c[0])) === '["season_survey_done","submit_season_survey"]', { opened: g6.opened, rpc: g6.rpcCalls.map((c) => c[0]) });
  A("a status true is kept for the load, a false or a failure only while the call is in flight",
    /if \(v !== true && asked\[p\.id\] === call\) delete asked\[p\.id\];/.test(src) &&
    /SV\.save\(st\);\n[^\n]*\n[^\n]*\n      var p = CG\.auth && CG\.auth\.profile; if \(p\) asked\[p\.id\] = Promise\.resolve\(true\);\n      return true;/.test(src));
  const d3 = load({ profile: member, rpc: () => Promise.resolve({ data: "yes", error: null }) });
  await d3.advance(6000); await d3.advance(20000);
  A("a daily load whose status is not a plain true or false stays shut, and does not ask again", d3.opened.length === 0 && d3.rpcCalls.length === 1);
  A("a finished flag in this browser closes the gate without asking", (() => {
    const x = gate({ rpc: () => Promise.resolve({ data: false, error: null }) });
    x.store["cghl:survey:s2-2026:m2"] = JSON.stringify({ done: "2026-10-20T16:00:00Z", answers: {} });
    x.ctx.CG.AFTER.register(); return x.opened.length === 0 && x.rpcCalls.length === 0;
  })());
  A("the gate asks the same status, and only a fresh arrival is gated",
    /\(forced \? Promise\.resolve\(null\) : SV\.status\(\)\)\.then\(function\(status\)\{/.test(src) &&
    /if \(routeName\(\) !== "register"\) gateVisit = false;/.test(src) && /!gateVisit && SV\.asMember\(\) && !SV\.load\(\)\.done && SV\.gateApplies\(\)/.test(src));
  ctx.CG.AFTER.register("x", { a: 1 });
  A("the page's own AFTER.register still runs, with its arguments", afterCalls.length === 1 && afterCalls[0][0] === "x");
}

console.log("— the save");
{
  const member = { id: "m3" };
  A("the member side calls exactly these RPCs, and reads or writes nothing else",
    resSrc.length > 2000 && JSON.stringify((memberSrc.match(/rpc\("[a-z_0-9]+"/g) || []).sort()) === '["rpc(\\"season_survey_done\\"","rpc(\\"submit_season_survey\\""]' &&
    !/\.from\(|fetch\(/.test(src), memberSrc.match(/rpc\("[a-z_0-9]+"/g));
  A("...and the commissioner's results exactly one, the read", JSON.stringify(resSrc.match(/rpc\("[a-z_0-9]+"/g)) === '["rpc(\\"season_survey_results\\""]', resSrc.match(/rpc\("[a-z_0-9]+"/g));
  const messy = { worked: "  Draft night ran smoothly.  ", fix: "x".repeat(1200), wish: "   ", positions: "Keep positions open", perWeek: "2",
    nights: ["Wednesday", "Friday"], xfGold: ["Rocket"], xfGoldNone: false, xfBlue: [], xfBlueNone: true, xfRed: [], workedMore: "stale",
    seenDay: "2026-10-19" };
  const p = SV.payload(messy);
  A("the payload carries only the questions' own keys, empty answers left out",
    JSON.stringify(Object.keys(p).sort()) === JSON.stringify(["fix", "nights", "perWeek", "positions", "worked", "xfBlueNone", "xfGold"]), Object.keys(p));
  A("...typed answers trimmed and cut to their caps", p.worked === "Draft night ran smoothly." && p.fix.length === 1000);
  A("...pick lists as arrays of strings, None only when chosen", JSON.stringify(p.nights) === '["Wednesday","Friday"]' && p.xfBlueNone === true && !("xfGoldNone" in p));
  A("...a stale draft from an older build (Q1 as chips) is dropped, not sent to be refused", JSON.stringify(SV.payload({ worked: ["Draft night"] })) === "{}");
  const ok = load({ profile: member, rpc: () => Promise.resolve({ data: true, error: null }) });
  const st = ok.SV.load(); st.answers = { worked: "Good league.", xfRedNone: true };
  const r1 = await ok.SV.submit(st, "signup");
  A("submit sends the survey key, the payload and where it was opened from", r1 === true && ok.rpcCalls.length === 1 && ok.rpcCalls[0][0] === "submit_season_survey" &&
    JSON.stringify(ok.rpcCalls[0][1]) === JSON.stringify({ p_survey: "s2-2026", p_answers: { worked: "Good league.", xfRedNone: true }, p_source: "signup" }), ok.rpcCalls);
  A("...and only a confirmed true marks this browser finished", !!saved(ok, "m3").done && (await ok.SV.status()) === true && ok.rpcCalls.length === 1);
  const refusals = [
    ["a refusal", () => Promise.resolve({ data: null, error: { message: "SURVEY: A banned account cannot answer the survey." } }), /^A banned account cannot answer the survey\.$/],
    ["an unconfirmed answer", () => Promise.resolve({ data: null, error: null }), /did not confirm/],
    ["a network error", () => Promise.reject(new Error("Failed to fetch")), /Failed to fetch/]];
  for (const [label, rpc, msg] of refusals){
    const x = load({ profile: member, rpc });
    const s = x.SV.load(); s.answers = { worked: "Fine." };
    let err = null; try { await x.SV.submit(s, "daily"); } catch(e){ err = e; }
    A(label + " fails loud and leaves the survey unfinished", err && msg.test(err.message) && !s.done && !x.store["cghl:survey:s2-2026:m3"], err && err.message);
  }
  const guest = load({ rpc: () => Promise.resolve({ data: true, error: null }) });
  let gerr = null; try { await guest.SV.submit(guest.SV.load(), "daily"); } catch(e){ gerr = e; }
  A("signed out, the save refuses before it calls anything", gerr && /sign in first/.test(gerr.message) && guest.rpcCalls.length === 0);
  A("Finish waits for the confirmed write: a refusal keeps the person on the last question with the reason",
    /SV\.submit\(cur\.st, cur\.from\)\.then\(function\(ok\)\{\n    if \(!ok\) throw new Error\("the save was not confirmed"\);\n    go\(SV\.Q\.length \+ 1\);/.test(src) &&
    /\}\)\.catch\(function\(e\)\{\n    btn\.disabled = false;\n    CG\.toast\("Couldn’t save your answers: "/.test(src));
  A("typing still saves the draft as it goes", /if \(k\)\{ cur\.st\.answers\[k\] = e\.target\.value; keep\(\); \}/.test(src));
}

console.log("The commissioner's results (Control Center > Seasons)");
{
  const live = R("src/live/part_live.js");
  A("composed under the Seasons tab's season record, not a thirteenth tab",
    live.indexOf('if (param==="seasons") return CG.adminShell("seasons", CG.admSeasonsLive() + CG.SURVEY.resultsHtml());') > 0 &&
    live.indexOf('if (param==="seasons"){ CG.AFTER._admSeasons(); CG.SURVEY.loadResults(); return; }') > 0 &&
    !/\["survey",/.test(live));
  A("commissioners only: the Control Center's own gate, checked again before the read", /CG\.ROUTES\.admin = function\(param, qs\)\{\n  if \(CG\.role\(\)!=="commish"\) return CG\.unauthorized/.test(live) &&
    /if \(!CG\.role \|\| CG\.role\(\) !== "commish"\) return;/.test(resSrc));
  A("ONE question list and ONE X-Factor list: the results name nothing of their own",
    ["\"Monday\"", "\"Bring back position locks\"", "\"Rocket\"", "\"4 or more\"", "\"Gold (Specialist)", "what worked"].every((s) => resSrc.indexOf(s) < 0) &&
    /SV\.XF\.skaters\.concat\(SV\.XF\.goalies\)/.test(resSrc) && /SV\.Q\.forEach/.test(resSrc));
  /* three responses, newest first as the server sends them, with a stale or odd value or two */
  const rows = [
    { source: "signup", finished_at: "2026-10-22T01:00:00Z", answers: { worked: "  <b>Draft night</b> ran clean.  ", positions: "Keep positions open",
      nights: ["Wednesday", "Thursday", "Thursday", "Funday"], perWeek: "3", xfGold: ["Rocket", "Truculence"], xfBlueNone: true, xfRed: ["Rocket"] } },
    { source: "daily", finished_at: "2026-10-21T16:00:00Z", answers: { fix: "Fewer no-shows.", positions: "Keep positions open", nights: ["Wednesday"],
      perWeek: "2", xfGold: ["Truculence"], xfBlue: ["Truculence"], xfRedNone: true, wish: "More tiers." } },
    { source: "daily", finished_at: "2026-10-20T16:00:00Z", answers: { worked: "Stats pages.", positions: "No preference" } }];
  const t = SV.tally(rows);
  A("the count and where each came from", t.count === 3 && t.daily === 2 && t.signup === 1, [t.count, t.daily, t.signup]);
  A("the position-lock vote, by the survey's own choices", t.q.positions.answered === 3 && t.q.positions.votes["Keep positions open"] === 2 &&
    t.q.positions.votes["No preference"] === 1 && t.q.positions.votes["Bring back position locks"] === 0, t.q.positions);
  A("each night's count; a night named twice in one answer counts once, a night the survey never offered is odd",
    t.q.nights.votes.Wednesday === 2 && t.q.nights.votes.Thursday === 1 && t.q.nights.votes.Monday === 0 && t.q.nights.odd === 1 &&
    t.q.nights.answered === 2 && JSON.stringify(Object.keys(t.q.nights.votes)) === JSON.stringify(SV.DAYS), t.q.nights);
  A("nights per week", t.q.perWeek.answered === 2 && t.q.perWeek.votes["3"] === 1 && t.q.perWeek.votes["2"] === 1);
  A("every tier holds all 27 X-Factors, with its ban votes and its None votes",
    ["xfGold", "xfBlue", "xfRed"].every((k) => Object.keys(t.q[k].votes).length === 27) &&
    t.q.xfGold.votes.Truculence === 2 && t.q.xfGold.votes.Rocket === 1 && t.q.xfGold.answered === 2 && t.q.xfGold.none === 0 &&
    t.q.xfBlue.answered === 2 && t.q.xfBlue.none === 1 && t.q.xfRed.none === 1 && t.q.xfRed.votes.Rocket === 1);
  A("the written answers: trimmed, newest first (the server's order)", JSON.stringify(t.q.worked.texts.map((e) => e.text)) ===
    JSON.stringify(["<b>Draft night</b> ran clean.", "Stats pages."]) && t.q.fix.texts.length === 1 && t.q.wish.texts[0].text === "More tiers.");
  const h = SV.resultsBody(t);
  const card = (title) => { const i = h.indexOf(">" + title + "<"); return i < 0 ? "" : h.slice(i, h.indexOf("</figure>", i)); };
  A("three counts across the top", /<b class="num">3<\/b><span>responses<\/span>/.test(h) && /<b class="num">2<\/b><span>from the daily <i>pop-up<\/i><\/span>/.test(h) &&
    /<b class="num">1<\/b><span>from the <i>sign-up<\/i><\/span>/.test(h));
  A("one card per question, in the survey's order", ["Position locks for Season 2?", "Which nights can you usually play?", "How many game nights a week?", "Gold (Specialist)",
    "Blue (All-Star)", "Red (Elite)", "Season 1: what worked?", "Season 1: what needs fixing?", "Anything you would like to see in Season 2 and beyond?"]
    .map((x) => h.indexOf(">" + x + "<")).every((i, k, a) => i > 0 && (k === 0 || i > a[k - 1])));
  const gold = card("Gold (Specialist)"), red = card("Red (Elite)"), blue = card("Blue (All-Star)");
  A("each tier lists every X-Factor, most votes first", (gold.match(/class="vz-hb"/g) || []).length === 27 &&
    /<em>Truculence<\/em>[\s\S]*<em>Rocket<\/em>[\s\S]*<em>Ankle Breaker<\/em>/.test(gold));
  A("...with its None votes", /2 of 3 answered · 0 voted None/.test(gold) && /2 of 3 answered · 1 voted None/.test(blue));
  A("...and the Banned now mark from Rule 4.5's list (six, eight at Red)", (gold.match(/vz-hbtag">Banned now</g) || []).length === 6 &&
    (red.match(/vz-hbtag">Banned now</g) || []).length === 8 && /<em>Truculence<\/em><b class="vz-hbtag">Banned now<\/b>/.test(gold) &&
    !/<em>Rocket<\/em><b class="vz-hbtag">/.test(gold));
  A("nights: a column for each day, then nights per week as its own card", (card("Which nights can you usually play?").match(/class="vz-bar( on)?"/g) || []).length === 7 &&
    /<b>How many game nights a week\?<\/b><span>2 of 3 answered<\/span>/.test(h) && /<em>3<\/em><\/span><span class="vz-hbv">1 \(50%\)</.test(card("How many game nights a week?")));
  A("an answer the survey never offered is said, not hidden", /1 answer named a choice the survey does not offer, so it is not counted\./.test(h));
  A("the position vote shows counts and shares of those who answered", /Keep positions open<\/em><\/span><span class="vz-hbv">2 \(67%\)</.test(h));
  A("written answers are escaped, dated and anonymous", h.indexOf("<b>Draft night</b>") < 0 && h.indexOf("&lt;b&gt;Draft night&lt;/b&gt; ran clean.") > 0 &&
    /Thu, Oct 22|Wed, Oct 21/.test(h) && !/profile|gamertag/i.test(h));
  A("static cards: a Refresh or Show all never replays the bars", !/data-rv=/.test(h) && (resSrc.match(/rv: false/g) || []).length === 2);
  const many = SV.tally([0, 1, 2, 3, 4, 5, 6].map((i) => ({ source: "daily", finished_at: "2026-10-2" + i + "T12:00:00Z", answers: { fix: "Note " + i } })));
  const mh = SV.resultsBody(many), fixCard = mh.slice(mh.indexOf('data-svr-card="fix"'), mh.indexOf('data-svr-card="wish"'));
  A("a long list shows the newest five, then Show all", (fixCard.match(/<li>/g) || []).length === 5 && /Note 0[\s\S]*Note 4/.test(fixCard) &&
    !/Note 5/.test(fixCard) && /data-svr-all="fix" aria-expanded="false">Show all 7</.test(fixCard));
  A("an empty state when no one has answered", /No answers yet/.test(SV.resultsBody(SV.tally([]))) && !/vz-hb/.test(SV.resultsBody(SV.tally([]))));
  A("a question no one answered says so", /No one has answered this yet\./.test(SV.resultsBody(SV.tally([{ source: "daily", answers: {} }]))));
  A("the chart tag is the house helper's, and only when asked", /<b class="vz-hbtag">Banned now<\/b>/.test(ctx.CG.viz.hbars([{ k: "A", v: 1, tag: "Banned now" }])) &&
    !/vz-hbtag/.test(ctx.CG.viz.hbars([{ k: "A", v: 1 }])) && /\.vz-hbtag\{/.test(css));

  /* the read itself, painted into a stand-in section */
  const section = () => { const attrs = {}, el = { painted: [], getAttribute: (k) => attrs[k] || null, setAttribute: (k, v) => { attrs[k] = v; },
    addEventListener: () => {}, querySelector: () => null }; Object.defineProperty(el, "outerHTML", { set(v){ el.painted.push(v); } }); return el; };
  const read = async (o) => { const el = section(); const x = load(Object.assign({ els: { svResults: el } }, o)); x.SV.loadResults(); await flush(); await flush(); return { x, el }; };
  const okR = await read({ role: "commish", rpc: () => Promise.resolve({ data: { survey: "s2-2026", count: 3, responses: rows }, error: null }) });
  A("the read: season_survey_results for this survey, painted in place", okR.x.rpcCalls.length === 1 && okR.x.rpcCalls[0][0] === "season_survey_results" &&
    JSON.stringify(okR.x.rpcCalls[0][1]) === '{"p_survey":"s2-2026"}' && /Loading…/.test(okR.el.painted[0]) &&
    /<b class="num">3<\/b><span>responses/.test(okR.el.painted[okR.el.painted.length - 1]) && /data-svr="reload">Refresh</.test(okR.el.painted[okR.el.painted.length - 1]));
  const refused = await read({ role: "commish", rpc: () => Promise.resolve({ data: null, error: { message: "SURVEY: Only a commissioner may read the survey results." } }) });
  A("a refusal fails loud, in words", /role="alert"[^>]*>Couldn’t load the survey results: Only a commissioner may read the survey results\.</.test(refused.el.painted[refused.el.painted.length - 1]));
  const offline = await read({ role: "commish", rpc: () => Promise.reject(new Error("Failed to fetch")) });
  A("...so does a network error", /Couldn’t load the survey results: Failed to fetch/.test(offline.el.painted[offline.el.painted.length - 1]));
  const odd = await read({ role: "commish", rpc: () => Promise.resolve({ data: { count: 0 }, error: null }) });
  A("...and an answer with no list in it", /Couldn’t load the survey results: the league sent no list of answers/.test(odd.el.painted[odd.el.painted.length - 1]));
  const thrown = await read({ role: "commish", rpc: () => { throw new Error("client not ready"); } });
  A("...and a client that throws on the spot, which leaves Refresh usable", /Couldn’t load the survey results: client not ready/.test(thrown.el.painted[thrown.el.painted.length - 1]) &&
    /data-svr="reload">Refresh</.test(thrown.el.painted[thrown.el.painted.length - 1]));
  const member = await read({ role: "player", rpc: () => Promise.resolve({ data: { responses: [] }, error: null }) });
  A("anyone but a commissioner: no read at all", member.x.rpcCalls.length === 0 && member.el.painted.length === 0);
}

console.log("— preview mode: local hosts only");
{
  A("off on the live site", SV.preview === false && SV.explicit === false);
  const qp = load({ loc: { search: "?survey=preview" } });
  A("?survey=preview does nothing on the live site: no preview, no guest member, no status",
    qp.SV.preview === false && qp.SV.explicit === false && qp.SV.asMember() === false && (await qp.SV.status()) === null);
  await qp.advance(6000);
  A("...and no pop-up", qp.opened.length === 0);
  const lh = load({ loc: { hostname: "localhost" } }).SV;
  A("on for localhost (panel only)", lh.preview === true && lh.explicit === false);
  const lq = load({ loc: { hostname: "localhost", search: "?survey=preview" } }).SV;
  A("localhost with ?survey=preview plays a member", lq.preview === true && lq.explicit === true && lq.asMember() === true);
  A("...also after the hash", load({ loc: { hostname: "127.0.0.1", hash: "#/home?survey=preview" } }).SV.explicit === true);
  A("the panel has the three controls", /Show the daily pop-up/.test(src) && /Show the sign-up gate/.test(src) && /data-pv="reset">Reset</.test(src));
}

console.log("— the database record");
{
  const fn = (name) => (sql.match(new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\nend \\$f\\$;")) || [""])[0];
  const submit = fn("submit_season_survey"), done = fn("season_survey_done"), results = fn("season_survey_results");
  A("a v4.23 header with the why and the commissioner's words", /^-- v4\.23 \(2026-10-20\): /.test(sql) &&
    /"If a\n-- player has filled it out at any point, do not show them the survey again no matter what\."/.test(sql) && /Only show it\n-- on the user's first refresh/.test(sql));
  A("the table: identity id, slug key, member, answers object with a size cap, source, finished_at, one row per member",
    /create table public\.season_survey_responses \(\n  id bigint generated always as identity primary key,/.test(sql) &&
    /survey_key text not null check \(survey_key ~ '\^\[a-z0-9\]\[a-z0-9-\]\{1,31\}\$'\)/.test(sql) &&
    /profile_id uuid not null references public\.profiles \(id\) on delete cascade/.test(sql) &&
    /check \(jsonb_typeof\(answers\) = 'object' and octet_length\(answers::text\) <= 32768\)/.test(sql) &&
    /source text not null check \(source in \('daily', 'signup'\)\)/.test(sql) && /finished_at timestamptz not null default now\(\)/.test(sql) &&
    /unique \(profile_id, survey_key\)/.test(sql));
  A("born shut: RLS on, every privilege revoked (the identity sequence too), no policies",
    /alter table public\.season_survey_responses enable row level security;/.test(sql) &&
    /revoke all on public\.season_survey_responses from public, anon, authenticated;/.test(sql) &&
    /revoke all on sequence %s from public, anon, authenticated/.test(sql) && !/create policy/i.test(sql) && !/grant [a-z, ]+ on public\.season_survey_responses/i.test(sql));
  for (const [name, sig, body] of [["submit_season_survey", "text, jsonb, text", submit], ["season_survey_done", "text", done], ["season_survey_results", "text", results]]){
    A(name + ": SECURITY DEFINER with an empty search_path", /\n  language plpgsql (stable )?security definer set search_path to '' as \$f\$/.test(body), body.slice(0, 160));
    A(name + ": revoked from public, anon and authenticated, EXECUTE for members only",
      sql.indexOf("revoke all on function public." + name + "(" + sig + ") from public, anon, authenticated;\ngrant execute on function public." + name + "(" + sig + ") to authenticated;") > 0 &&
      !new RegExp("grant [^;]*" + name + "[^;]* to [^;]*anon").test(sql));
  }
  A("submit: a signed-in member with a profile, not banned, the known survey and source",
    /if v_uid is null then raise exception 'SURVEY: Sign in to save your answers\.' using errcode = '42501';/.test(submit) &&
    /if not exists \(select 1 from public\.profiles p where p\.id = v_uid\) then\n    raise exception 'SURVEY: Your member profile was not found\./.test(submit) &&
    /if public\.is_banned\(v_uid\) then raise exception 'SURVEY: A banned account cannot answer the survey\.'/.test(submit) &&
    !/v_banned|\.banned\b/.test(submit) &&
    submit.indexOf("if p_survey is distinct from '" + SV.KEY + "' then raise exception") > 0 && /p_source not in \('daily', 'signup'\)/.test(submit));
  /* the server's key list and caps are the client's SV.Q, written in SQL: hold the two together */
  const arr = (n) => JSON.parse("[" + ((submit.match(new RegExp(n + " constant text\\[\\] := array\\[([^\\]]*)\\]")) || [])[1] || "").replace(/'/g, '"') + "]");
  const texts = JSON.parse((submit.match(/c_text constant jsonb := '([^']*)'/) || [])[1] || "{}");
  const want = {}; SV.Q.filter((q) => q.kind === "text").forEach((q) => { want[q.id] = q.max || 2000; });
  A("submit: the typed answers and their caps are SV.Q's", JSON.stringify(texts) === JSON.stringify(want), texts);
  A("submit: the one-choice answers are SV.Q's", JSON.stringify(arr("c_one")) === JSON.stringify(SV.Q.filter((q) => q.kind === "one").map((q) => q.id).concat(SV.Q.filter((q) => q.then).map((q) => q.then.id))));
  A("submit: the pick lists are SV.Q's", JSON.stringify(arr("c_list")) === JSON.stringify(SV.Q.filter((q) => q.kind === "multi" || q.kind === "xf").map((q) => q.id)));
  A("submit: the None flags are the X-Factor questions'", JSON.stringify(arr("c_flag")) === JSON.stringify(SV.Q.filter((q) => q.kind === "xf").map((q) => q.id + "None")));
  A("submit: text trimmed and capped, lists of short strings with a sane count, booleans for None, unknown keys refused",
    /v_t := left\(btrim\(v_val #>> '\{\}', E' \\t\\r\\n'\), \(c_text ->> v_key\)::int\);/.test(submit) &&
    /jsonb_array_length\(v_val\) > 40/.test(submit) && /not between 1 and 60/.test(submit) &&
    /if jsonb_typeof\(v_val\) <> 'boolean' then raise exception/.test(submit) && /raise exception 'SURVEY: "%" is not a question on this survey\.', v_key;/.test(submit));
  A("submit: a second device's submission keeps the first, and still says true",
    /insert into public\.season_survey_responses \(survey_key, profile_id, answers, source\)\n  values \(p_survey, v_uid, v_clean, p_source\)\n  on conflict \(profile_id, survey_key\) do nothing;\n  return true;/.test(submit));
  A("done: true when the caller has a row, false when not", /return exists \(select 1 from public\.season_survey_responses r\n\s+where r\.profile_id = auth\.uid\(\) and r\.survey_key = p_survey\);/.test(done) &&
    /returns boolean/.test(done) && /if auth\.uid\(\) is null then raise exception/.test(done));
  A("results: commissioners only", /if not public\.is_commissioner\(\) then\n    raise exception 'SURVEY: Only a commissioner may read the survey results\.' using errcode = '42501';/.test(results));
  A("results: count and every response's answers, source and time, newest first",
    /'count', count\(\*\)/.test(results) && /jsonb_build_object\('answers', r\.answers, 'source', r\.source, 'finished_at', r\.finished_at\)/.test(results) &&
    /order by r\.finished_at desc, r\.id desc/.test(results));
  A("results: no profile id, name or row id leaves it (the typed answers stay anonymous)",
    !/profile_id|gamertag|display_name|discord|'id'|profiles/.test(results.replace(/\/\*[\s\S]*?\*\//g, "")), results);
  A("the migration ends with self-checks that raise", /\ndo \$chk\$[\s\S]*relrowsecurity[\s\S]*has_table_privilege\(g\.rol, 'public\.season_survey_responses', p\.priv\)[\s\S]*has_sequence_privilege[\s\S]*r\.prosecdef[\s\S]*array\['search_path=""'\][\s\S]*aclexplode\(r\.proacl\) a where a\.grantee = 0[\s\S]*has_function_privilege\('anon', r\.oid, 'EXECUTE'\)[\s\S]*has_function_privilege\('authenticated', r\.oid, 'EXECUTE'\)[\s\S]*v_n <> 3[\s\S]*end \$chk\$;\s*$/.test(sql));
  A("the rehearsal is recorded and the migration applied, with a clean grant audit",
    /\n-- Rehearsal \(2026-10-20\): one transaction on the live database, rolled back by a closing raise\./.test(sql) &&
    /Result: REHEARSAL OK: T1 not done before/.test(sql) &&
    /Applied as migration v423_season2_survey \(2026-10-20\); tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
  A("no caught-error handler and no Discord post anywhere in the record", !/exception\s+when/i.test(sql) && !/net\.http_post|discord_http_post/.test(sql));
  A("the grant audit watches all three grants", /'set_my_jersey_number','submit_season_survey','season_survey_done','season_survey_results','withdraw_staff_application'/.test(audit));
}

console.log("— house writing rules");
{
  /* the survey's own styles: from its header to the toast rule that follows it */
  const block = css.slice(css.indexOf("/* ---------- Season 2 survey"), css.indexOf("\n#toast-root{"));
  A("...found the survey style block", block.length > 2000 && block.length < 12000, block.length);
  A("no em dashes in the survey, its styles or its SQL record", !/—/.test(src) && !/—/.test(block) && !/—/.test(sql));
  A("no spaced hyphens as punctuation in the copy", !/[a-z] - [a-z]/i.test(JSON.stringify(SV.Q) + JSON.stringify(SV.COPY)));
  A("reduced motion keeps a fade only", /@media\(prefers-reduced-motion:reduce\)\{\n  \.modal\.sv\{animation:fadein/.test(block));
  A("the phone gets the bottom sheet and one column", /@media\(max-width:560px\)\{[\s\S]*?\.modal\.sv\{top:auto;[\s\S]*?\.sv-grid\{grid-template-columns:1fr\}/.test(block));
  A("...but two columns of X-Factors from 360 px up", /@media\(max-width:560px\) and \(min-width:360px\)\{\n  \.sv-grid\.sv-xf\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(block));
  A("...and the X-Factor shortcuts are 44 px thumb targets there", /@media\(max-width:560px\)\{[\s\S]*?\.sv-tool\{min-height:44px/.test(block));
}

/* v4.23 changelog entry, found by version (never changelog[0]) */
(function(){
  var fs = require("fs"), path = require("path");
  var src = fs.readFileSync(path.join(__dirname, "../src/live/part3_content.js"), "utf8");
  var i = src.indexOf('{"version":"4.23"'), j = src.indexOf('{"version":', i + 10);
  var ent = i >= 0 ? JSON.parse(src.slice(i, j > i ? src.lastIndexOf("},", j) + 1 : undefined)) : null;
  A("the v4.23 changelog entry exists", !!ent && ent.dateIso === "2026-10-20");
  A("the entry names the survey, the first visit of the day, never again and the Friday, January 8 deadline", !!ent &&
    /survey/i.test(ent.summary) && ent.items.some(function(t){ return /first visit of the day/.test(t); }) &&
    ent.items.some(function(t){ return /never see it again/.test(t); }) && /Friday, January 8 at 11:59 PM ET/.test(ent.summary));
  A("the entry keeps the house rules (no dashes as punctuation)", !!ent && !/[\u2013\u2014]| - /.test(JSON.stringify(ent)));
})();

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL the test itself threw: " + (e && e.stack || e)); process.exit(1); });
