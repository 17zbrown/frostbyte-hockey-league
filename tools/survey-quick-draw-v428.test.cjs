/* v4.28 (2026-10-21). Commissioner: "remove the quick draw perk from the survey choices since that is not an x-factor
   available in world of chel."
   Quick Draw leaves the one X-Factor list (src/live/part11_survey.js SV.XF), so all three tier questions offer 27 names.
   Sixteen members had already answered, six of them with Quick Draw picked: those answers are kept as they are, and
   the commissioner's results say by name that Quick Draw was removed and its earlier votes are not counted (SV.XF.removed),
   instead of the generic "a choice the survey does not offer". A pick saved in a browser before the removal is never
   sent (SV.payload). The concept site's copy of the list (concepts/s2/js/survey.js, local only) loses it too.
   Run: node tools/survey-quick-draw-v428.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const src = R("src/live/part11_survey.js"), ui = R("src/live/part4_ui.js");

/* the real survey file in a sandbox with the real esc() and CG.viz, as tools/season2-survey-v423.test.cjs does */
const ctx = { console: { log(){}, warn(){}, error(){} }, Math, Object, Array, String, Number, JSON, Date, Intl, Promise, RegExp, Error };
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.setTimeout = () => 0;
ctx.location = { hostname: "chelgamingleague.com", search: "", hash: "#/home" };
ctx.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
ctx.document = { body: null, visibilityState: "visible", addEventListener: () => {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
ctx.CG = { AFTER: { register(){} }, ROUTES: {}, auth: { user: null, profile: null }, SEASONS: [], regSeason: () => ({ number: 2 }),
           toast: () => {}, role: () => "guest", ic: () => "" };
vm.createContext(ctx);
vm.runInContext(ui.match(/function esc\(s\)\{[\s\S]*?\}\); \}/)[0], ctx);
vm.runInContext(ui.slice(ui.indexOf("CG.viz = (function(){"), ui.indexOf("\n})();", ui.indexOf("CG.viz = (function(){")) + 6) + "\n" +
  (ui.match(/CG\.fmtDay\s*=\s*function\(ts\)\{[^\n]*\};/) || [""])[0], ctx);
vm.runInContext(src, ctx);
const SV = ctx.CG.SURVEY, all = SV.XF.skaters.concat(SV.XF.goalies);

console.log("— the list");
A("Quick Draw is off the list", all.indexOf("Quick Draw") < 0 && !/"Quick Draw", "Quick Pick"/.test(src));
A("22 skaters and 5 goaltenders, still alphabetical", SV.XF.skaters.length === 22 && SV.XF.goalies.length === 5 &&
  JSON.stringify(SV.XF.skaters) === JSON.stringify(SV.XF.skaters.slice().sort((a, b) => a.localeCompare(b))));
A("...kept as removed, with the commissioner's reason", SV.XF.removed && SV.XF.removed["Quick Draw"] === "not an X-Factor in World of Chel" &&
  /remove the quick draw perk from the survey choices since that is not an x-factor\s+available in world of chel/.test(src));
for (const qi of [4, 5, 6]){
  const h = SV.questionHtml(SV.Q[qi], {});
  A(SV.Q[qi].tier + ": 27 boxes and no Quick Draw", (h.match(/type="checkbox"/g) || []).length === 27 && !/Quick Draw/.test(h));
}

console.log("— a half-finished answer");
const sent = SV.payload({ xfGold: ["Quick Draw", "Rocket"], xfRed: ["Quick Draw"], nights: ["Friday"] });
A("a pick saved before the removal is never sent", JSON.stringify(sent.xfGold) === '["Rocket"]' && !("xfRed" in sent) && JSON.stringify(sent.nights) === '["Friday"]', sent);

console.log("— the commissioner's results");
const rows = [
  { source: "daily", finished_at: "2026-10-20T18:00:00Z", answers: { xfGold: ["Quick Draw", "Truculence"], xfBlue: ["Quick Draw"], xfRed: ["Made Up"] } },
  { source: "signup", finished_at: "2026-10-20T17:00:00Z", answers: { xfGold: ["Quick Draw", "Rocket"] } }];
const t = SV.tally(rows);
A("earlier Quick Draw votes are counted as removed, never as a choice", t.q.xfGold.removed["Quick Draw"] === 2 && t.q.xfBlue.removed["Quick Draw"] === 1 &&
  !("Quick Draw" in t.q.xfGold.votes) && t.q.xfGold.odd === 0, t.q.xfGold);
A("...and the answers still count as answers", t.q.xfGold.answered === 2 && t.q.xfGold.votes.Truculence === 1 && t.q.xfGold.votes.Rocket === 1);
A("a name the survey never offered is still the generic odd answer", t.q.xfRed.odd === 1 && !Object.keys(t.q.xfRed.removed).length);
const h = SV.resultsBody(t);
A("the results say it by name, with the reason and the count", h.indexOf("Quick Draw was removed from the survey (not an X-Factor in World of Chel), so 2 earlier votes for it are not counted.") > 0 &&
  h.indexOf("Quick Draw was removed from the survey (not an X-Factor in World of Chel), so 1 earlier vote for it is not counted.") > 0);
A("...and still say an unknown name plainly", h.indexOf("1 answer named a choice the survey does not offer, so it is not counted.") > 0);
A("no Quick Draw bar in any tier chart", !/<em>Quick Draw<\/em>/.test(h));

console.log("— the concept site's copy");
const cp = path.join(ROOT, "concepts/s2/js/survey.js");
if (fs.existsSync(cp)) A("the concept survey offers no Quick Draw either", !/"Quick Draw"/.test(fs.readFileSync(cp, "utf8")));
else console.log("skip the concept survey is local only (git-ignored) and not in this checkout");

console.log("— the changelog");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));   /* the repo's own content file */
const rb = CG.CONTENT.rulebook, e = rb.changelog.find((c) => c.version === "4.28") || {};
A("4.28 is recorded, right before 4.27", e.version === "4.28" && (rb.changelog[rb.changelog.indexOf(e) + 1] || {}).version === "4.27");
A("...in key order, saying what happened to the earlier votes", JSON.stringify(Object.keys(e)) === JSON.stringify(["version", "dateIso", "summary", "items"]) &&
  /Quick Draw/.test(e.summary || "") && (e.items || []).some((i) => /earlier/.test(i)));
A("...with no em dash or gendered pronoun", !/[—–]| - /.test(JSON.stringify(e)) && !/\b(he|his|him|she|her)\b/i.test(JSON.stringify(e)));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
