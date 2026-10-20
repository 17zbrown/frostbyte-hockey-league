/* v4.24: the sign-up cutoff is the day before the draft. The commissioner, 2026-10-20, asked whether the general rules
   should read "the day before the draft" instead of "the Thursday before the draft" (a Season 1 pattern: Thursday,
   September 17 before the Saturday, September 19 draft), answered: "Yes say 'the day before the draft.'"
   Chapter S2 and the Season 2 row already said Friday, January 8, 2027 at 11:59 PM ET for the Saturday, January 9 draft
   (v4.23); this release brings the general rules (Chapter 0.3, Rules 1.1, 2.8 and 2.9, and the full-format text), the
   site copy and the Control Center's Auto-space in line. Season 1's own record (its Thursday cutoff) stays as history.
   This renders the rulebook in both formats, pins the copy, and runs the real Auto-space handler from part_live.js in a
   sandbox for a winter Saturday, a summer Saturday, other weekdays and both DST changes.
   Run: node tools/signup-day-before-draft-v424.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const live = R("src/live/part_live.js"), pub2 = R("src/live/part5b_public2.js");

console.log("\n1. The rendered rulebook says the day before the draft");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook;
const K = {}, c0 = pub2.indexOf("CG.rulebookForFormat = function");
new Function("CG", pub2.slice(c0, pub2.indexOf("\nCG.ROUTES.rulebook", c0)))(K);
const basic = K.rulebookForFormat(rb, "basic"), full = K.rulebookForFormat(rb, "full");
const bound = (book, id) => (book.chapters.filter((c) => !c.shelved).flatMap((c) => c.sections).find((s) => s.id === id) || { paragraphs: [] }).paragraphs.join(" ");
A("Chapter 0.3 (basic, binding): the cutoff is 11:59 PM Eastern Time on the day before the draft",
  /The sign-up cutoff, 11:59 PM Eastern Time on the day before the draft, is a draft-eligibility cutoff and not a closure of registration\./.test(bound(basic, "0.3")));
A("Rule 1.1 (basic): each season's cutoff is the day before that season's draft (Chapter 0, Step two)",
  /Each season's sign-up cutoff is 11:59 PM Eastern Time on the day before that season's draft \(Chapter 0, Step two\);/.test(bound(basic, "1.1")));
A("Rule 2.8 (basic): the draft pool sentence", /Every player who registers by the sign-up cutoff, 11:59 PM Eastern Time on the day before the draft \(Chapter 0, Step two\), enters the draft pool\./.test(bound(basic, "2.8")));
A("Rule 2.9 (basic): position changes close at the same cutoff", /Position changes close at the sign-up cutoff, which is 11:59 PM Eastern Time on the day before the draft\./.test(bound(basic, "2.9")));
A("Chapter S2.1 already says the same, so the general rule and Season 2 agree", /Player registration for the draft closes at 11:59 PM Eastern the day before the draft\./.test(bound(basic, "S2.1")) &&
  /the draft is Saturday, January 9, 2027 at 9:00 PM and registration for it closes Friday, January 8 at 11:59 PM/.test(bound(basic, "S2.1")));
A("the full format says it too: 0.3, 0.4, 1.1 and 2.8", /the sign-up deadline, 11:59 PM Eastern on the day before the draft, is a draft-eligibility cutoff/.test(bound(full, "0.3")) &&
  /sign-ups stay open right through it, until 11:59 PM Eastern on the day before the draft \(Rule 1\.1\)\./.test(bound(full, "0.4")) &&
  /Each season's draft-eligibility deadline is 11:59 PM Eastern on the day before that season's draft \(Chapter 0, Step two\)\./.test(bound(full, "1.1")) &&
  /The deadline is 11:59 PM Eastern on the day before the draft \(Chapter 0\.3\);/.test(bound(full, "2.8")));
/* every sentence of every chapter, binding and Appendix A, in both renderings */
const sentences = [].concat(...[basic, full].map((b) => b.chapters.flatMap((c) => c.sections).flatMap((s) => s.paragraphs).flatMap((p) => p.split(/(?<=\.)\s+/))));
const thuCutoff = sentences.filter((t) => /Thursday (preceding|before) (the|that season's) draft|(cutoff|deadline)[^.]*Thursday|Thursday[^.]*(cutoff|deadline)/.test(t));
A("no rule, binding or shelved, still puts the cutoff on a Thursday", thuCutoff.length === 0, thuCutoff.slice(0, 2));
/* review: full 0.4 (and Appendix A.0.4 in the basic book) said "A Thursday sign-up can still play the final Friday’s
   three games and qualify.", written to justify the old Thursday deadline; the latest sign-up is now the final Friday */
A("no rendered sentence pairs a Thursday with a sign-up", sentences.filter((t) => /Thursday sign-up/.test(t)).length === 0, sentences.filter((t) => /Thursday sign-up/.test(t)));
A("...full 0.4 and the basic book’s Appendix A.0.4 both say the final Friday instead",
  sentences.filter((t) => t === "A player who signs up as late as the final Friday, before that night’s games, can still play them and qualify.").length === 2);
A("the rule text carries no em dash and no gendered pronoun where it changed", !sentences.filter((t) => /day before (the|that season's) draft/.test(t)).some((t) => /[—–]|\b(he|his|him|she|her)\b/i.test(t)));
const hist = (v) => JSON.stringify(rb.changelog.find((c) => c.version === v) || {});
A("Season 1's record stays as history: v2.48 still says sign-ups closed Thursday September 17", /sign-ups close Thursday September 17 at 11:59 PM ET/.test(hist("2.48")));

console.log("\n2. Site copy");
A("the brand voice example says the day before the draft, without a dash", live.indexOf("“Register to play: sign-ups close at 11:59 PM ET the day before the draft.”") > -1 &&
  R("BRAND.md").indexOf("\"Register to play: sign-ups close at 11:59 PM ET the day before the draft.\"") > -1);
A("the draft page's Eligibility card: the day before the draft in both formats, the appearance test only with a pre-season",
  /\["Eligibility", CG\.fmt\("preseason"\)\s*\? "Registered by 11:59 PM ET the day before the draft and, for randomly assigned first-years, at least 3 pre-season appearances \(Rule 2\.8\)\./.test(live) &&
  /: "Registered by 11:59 PM ET the day before the draft\. That is the only test \(Rule 2\.8\): anyone who registers later still plays, placed on a club as depth after the draft\."\]/.test(live));
A("Auto-space's help names the day before the draft in both formats", (live.match(/sign-ups open until 11:59 PM ET the day before it/g) || []).length === 2);
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");   /* comments keep the history; shown copy must not */
const stale = fs.readdirSync(path.join(ROOT, "src/live")).filter((f) => /\.(js|html)$/.test(f) && f !== "part3_content.js")
  .filter((f) => /Thursday (before|preceding) (the draft|it)|Thursday cutoff/.test(code(R("src/live/" + f))));
A("no other site file names a Thursday cutoff", stale.length === 0, stale);
A("the member guides' sources say it too", /sign-up cutoff \(11:59 PM ET on the day before the draft\) closes it/.test(R("tools/guides/src/draft.html")) &&
  /Register by the sign-up cutoff \(11:59 PM ET on the day before the draft\)/.test(R("tools/guides/src/getting_started.html")) && !/Thursday night/.test(R("tools/guides/src/getting_started.html")));

console.log("\n3. Auto-space computes the day before the draft");
/* the real click handler and the real date helpers; the season's shape and holidays are fixed (six weeks, three nights,
   nothing ticked), so only the arithmetic under test moves */
const grab = (name) => { const i = live.indexOf("CG." + name + " = function"); if (i < 0) throw new Error("no CG." + name); return live.slice(i, live.indexOf("\nCG.", i + 5)); };
const h0 = live.indexOf('document.getElementById("ssSpace").addEventListener("click", function(){');
const handler = live.slice(live.indexOf("function(){", h0), live.indexOf('\n  document.getElementById("ssGo")', h0)).replace(/\);\s*$/, "");
const dtSrc = live.slice(live.indexOf("  function dt(v){"), live.indexOf("\n  }\n", live.indexOf("  function dt(v){")) + 4);
A("the handler and dt() were found", handler.length > 2000 && /var cutoffDay = CG\.dayAdd\(draftDay, -1\);/.test(handler) && /function dt\(v\)/.test(dtSrc), handler.length);
function space(o){
  const els = {}, ids = ["ssDraft","ssRegDl","ssStarts","ssEnds","ssPlayoffs","ssOwnDl","ssOff","ssPre","ssFaOpen","ssFaClose"];
  ids.forEach((id) => { els[id] = { value: (o.inputs || {})[id] || "" }; });
  const toasts = [];
  const ctx = { Date, Intl, Math, String, Object, console, document: { getElementById: (id) => els[id] },
                fmtSel: { value: o.format }, s: { weeks: 6 }, CG: { SEASON: {}, PRESEASON_WEEKS: 2, OFFSEASON_DARK_DAYS: 14, FA_WINDOW_DAYS: 7, NIGHTS_PER_WEEK: 3,
                  FORMAT_RULES: { basic: { weeks: 6 }, full: { weeks: 8 } }, toast: (m, k) => toasts.push([k, m]),
                  seasonShape: (x) => ({ weeks: x.weeks, nights: 3, perNight: 3, perClub: x.weeks * 9 }),
                  seasonHolidayKeys: () => [], holidayWeek: (wed) => (o.holidays || {})[wed] || null } };
  vm.createContext(ctx);
  vm.runInContext(["dayAdd","dayOfWeek","etISO","gameNights","holidayWeekLabel"].map(grab).join("\n") + "\n" + dtSrc + "\nvar run = " + handler + ";", ctx);
  ctx.run();
  const out = {}; ids.forEach((id) => { out[id] = els[id].value; });
  out.toasts = toasts;
  /* what Save writes: both deadline columns from ssRegDl, through the same ET conversion */
  out.saved = out.ssRegDl ? vm.runInContext('CG.etISO("' + out.ssRegDl.slice(0, 10) + '","' + out.ssRegDl.slice(11, 16) + '")', ctx) : null;
  return out;
}
const w = space({ format: "basic", inputs: { ssDraft: "2027-01-09T21:00" } });
A("winter Saturday: a January 9, 2027 draft closes sign-ups Friday, January 8 at 11:59 PM ET", w.ssRegDl === "2027-01-08T23:59", w.ssRegDl);
A("...which Save stores as 04:59 UTC on January 9 (EST)", w.saved === "2027-01-09T04:59:00.000Z", w.saved);
A("...the same instant Chapter S2 and the Season 2 row hold (Fri 2027-01-08 23:59 ET)", w.saved === new Date("2027-01-08T23:59:00-05:00").toISOString());
A("...every other date is unchanged: draft 9 PM, puck drop the Wednesday after, six weeks, playoffs the week after",
  w.ssDraft === "2027-01-09T21:00" && w.ssStarts === "2027-01-13T21:00" && w.ssEnds === "2027-02-19T23:59" && w.ssPlayoffs === "2027-02-24T21:00", w);
A("...and the owner-apps default keeps its old anchor, a week before the old Thursday (Thursday, December 31 at 8 PM)", w.ssOwnDl === "2026-12-31T20:00", w.ssOwnDl);
A("...an owner deadline already filled in is left alone", space({ format: "basic", inputs: { ssDraft: "2027-01-09T21:00", ssOwnDl: "2026-12-12T23:59" } }).ssOwnDl === "2026-12-12T23:59");
A("...and the toast names the Friday cutoff", w.toasts.length === 1 && w.toasts[0][0] === "ok" && /cutoff 2027-01-08 → draft 2027-01-09/.test(w.toasts[0][1]), w.toasts);
const su = space({ format: "basic", inputs: { ssDraft: "2026-09-19T21:00" } });
A("summer Saturday (EDT): a September 19 draft closes sign-ups Friday, September 18 at 11:59 PM ET, 03:59 UTC on the 19th",
  su.ssRegDl === "2026-09-18T23:59" && su.saved === "2026-09-19T03:59:00.000Z", [su.ssRegDl, su.saved]);
A("...not Thursday, September 17, the Season 1 cutoff under the old rule", su.ssRegDl.slice(0, 10) !== "2026-09-17");
const sun = space({ format: "basic", inputs: { ssDraft: "2027-01-10T21:00" } });
A("another weekday: a Sunday draft closes sign-ups that Saturday", sun.ssRegDl === "2027-01-09T23:59" && sun.saved === "2027-01-10T04:59:00.000Z", [sun.ssRegDl, sun.saved]);
const tue = space({ format: "basic", inputs: { ssDraft: "2027-06-15T21:00" } });
A("...a Tuesday draft closes them the Monday (EDT)", tue.ssRegDl === "2027-06-14T23:59" && tue.saved === "2027-06-15T03:59:00.000Z", [tue.ssRegDl, tue.saved]);
const spring = space({ format: "basic", inputs: { ssDraft: "2027-03-15T21:00" } });
A("DST begins: a Monday, March 15, 2027 draft closes sign-ups Sunday, March 14 (the change day) at 11:59 PM EDT", spring.saved === "2027-03-15T03:59:00.000Z", spring.saved);
const fall = space({ format: "basic", inputs: { ssDraft: "2027-11-08T21:00" } });
A("DST ends: a Monday, November 8, 2027 draft closes sign-ups Sunday, November 7 (the change day) at 11:59 PM EST", fall.saved === "2027-11-08T04:59:00.000Z", fall.saved);
const fu = space({ format: "full", inputs: { ssPre: "2027-08-04T21:00" } });
A("the full format: the cutoff is the final pre-season Friday, the day before its Saturday draft (EDT)",
  fu.ssDraft === "2027-08-14T21:00" && fu.ssRegDl === "2027-08-13T23:59" && fu.saved === "2027-08-14T03:59:00.000Z", [fu.ssDraft, fu.ssRegDl, fu.saved]);
A("...the other full-format dates are unchanged (free agency 24 hours after the draft for a week, puck drop the Wednesday after)",
  fu.ssFaOpen === "2027-08-15T19:00" && fu.ssFaClose === "2027-08-22T19:00" && fu.ssStarts === "2027-08-25T21:00" && fu.ssOwnDl === "2027-07-28T20:00", fu);
/* review: a skipped holiday week printed "[object Object]" in both Auto-space toasts; CG.holidayWeekLabel names it */
const hol = (wed, name) => ({ [wed]: { key: "x", name: name, date: wed, week: wed } });
const hb = space({ format: "basic", inputs: { ssDraft: "2027-01-09T21:00" }, holidays: hol("2027-01-20", "Test Day") });
A("a skipped holiday week is named in the basic toast, not [object Object]", hb.toasts.length === 1 && /holiday week skipped: Test Day \(week of 2027-01-20\)$/.test(hb.toasts[0][1]) && !/object Object/.test(hb.toasts[0][1]), hb.toasts);
const hf = space({ format: "full", inputs: { ssPre: "2027-08-04T21:00" }, holidays: Object.assign(hol("2027-09-01", "Day A"), hol("2027-09-08", "Day B")) });
A("...and in the full toast, every week by name", hf.toasts.length === 1 && /holiday weeks skipped: Day A \(week of 2027-09-01\), Day B \(week of 2027-09-08\)$/.test(hf.toasts[0][1]), hf.toasts);
A("the schedule generator’s confirm uses the same label", /plan\.skipped\.map\(CG\.holidayWeekLabel\)/.test(live) && (live.match(/\.map\(CG\.holidayWeekLabel\)/g) || []).length === 3);
A("Save writes both deadline columns from the one field", /registration_deadline:iso\("ssRegDl"\),\s*signup_deadline_at:iso\("ssRegDl"\)/.test(live));
A("the generator comment quotes the ruling", (live.match(/v4\.24 \(commissioner, 2026-10-20\): "Yes say 'the day before the draft\.'"/g) || []).length >= 2);

/* v4.24, the commissioner: "Can you actually name it the Season 1 survey?" One label, used by the pop-up and the results */
const sv = R("src/live/part11_survey.js");
A("the survey is named the Season 1 survey, once", /\n  name: "Season 1 survey",\n/.test(sv) && (sv.match(/Season 1 survey/g) || []).length >= 1);
A("...the pop-up's label and the commissioner's results heading both read that one name",
  /<p class="eyebrow chr">' \+ esc\(C\.name\) \+ '<\/p>/.test(sv) && /id="svrTitle">' \+ esc\(SV\.COPY\.name\) \+ '<\/h2>/.test(sv));
A("...no visible string still calls it the Season 2 survey, and the survey key is unchanged (no finished survey resets)",
  !/'[^']*Season 2 survey[^']*'|"[^"]*Season 2 survey[^"]*"/.test(sv) && /SV\.KEY = "s2-2026";/.test(sv));
/* the v4.24 changelog entry, found by version */
const e424 = rb.changelog.find((c) => c.version === "4.24");
A("the v4.24 changelog entry names the day before the draft and the Season 1 survey", !!e424 && e424.dateIso === "2026-10-20" &&
  /day before the draft/.test(JSON.stringify(e424)) && /Season 1 survey/.test(JSON.stringify(e424)) && !/[\u2013\u2014]| - /.test(JSON.stringify(e424)), e424);

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
