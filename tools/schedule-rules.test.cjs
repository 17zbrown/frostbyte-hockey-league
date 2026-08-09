/* Two standing rules. Run: node tools/schedule-rules.test.cjs   (build index.html first)

   RULE 1 — playoffs always open the game week after the last regular-season week.
   RULE 2 — the holidays that are ticked are the holidays that get skipped.

   Both came from the same real failure. Season 1 was generated with its last week on Dec 9-11 while
   playoffs_start_at said Dec 9, so the season ran into its own playoffs; and it skipped the weeks of
   Nov 11 and Nov 25 although Canadian Thanksgiving was what stood ticked in the season row. The
   holiday toggles only painted the button until "Save holidays" was pressed, while the generator
   built from the saved row — so tick-then-generate used the PREVIOUS set and looked entirely fine. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part_live.js"), "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

const noop = () => {};
const el = () => new Proxy(function () {}, {
  get(t, k) {
    if (k === "style") return new Proxy({}, { get: () => "", set: () => true });
    if (k === "classList") return { add: noop, remove: noop, toggle: noop, contains: () => false };
    if (k === "querySelectorAll") return () => [];
    if (k === "querySelector") return () => null;
    if (k === "getAttribute") return () => null;
    if (k === "getBoundingClientRect") return () => ({ top:0,left:0,width:0,height:0,bottom:0,right:0 });
    if (k === "children" || k === "childNodes") return [];
    if (k === "parentNode" || k === "parentElement") return null;
    if (["textContent","innerHTML","value","id","className"].includes(k)) return "";
    if (k === "length") return 0;
    if (k === Symbol.toPrimitive || k === "toString") return () => "";
    return el();
  }, set: () => true, apply: () => el(),
});
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date, Object, Array,
  String, Number, Boolean, RegExp, Error, Map, Set, WeakMap, WeakSet, Symbol, Proxy, Reflect, Intl,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
  fetch: () => Promise.resolve({ ok:true, json:()=>Promise.resolve({}), text:()=>Promise.resolve("") }),
  requestAnimationFrame: (f)=>setTimeout(f,0), cancelAnimationFrame: noop,
  MutationObserver: class { observe(){} disconnect(){} takeRecords(){return[];} },
  IntersectionObserver: class { observe(){} unobserve(){} disconnect(){} },
  ResizeObserver: class { observe(){} unobserve(){} disconnect(){} },
  performance:{ now:()=>0 }, localStorage:{ getItem:()=>null,setItem:noop,removeItem:noop },
  sessionStorage:{ getItem:()=>null,setItem:noop,removeItem:noop },
  navigator:{ userAgent:"node", language:"en-US" },
  location:{ hash:"#/", href:"https://x/", pathname:"/", search:"", origin:"https://x" },
  history:{ pushState:noop, replaceState:noop },
  matchMedia: () => ({ matches:false, addEventListener:noop, removeEventListener:noop, addListener:noop }),
  getComputedStyle: () => new Proxy({}, { get: () => "" }),
  document: el(), URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Response, Request, Headers, Blob,
  addEventListener:noop, removeEventListener:noop, dispatchEvent:noop, scrollTo:noop, alert:noop,
  innerWidth:1280, innerHeight:800, scrollY:0, devicePixelRatio:1,
  CustomEvent: class {}, Event: class {}, Element: class {}, HTMLElement: class {}, Node: class {}, SVGElement: class {},
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; ctx.top = ctx;
vm.createContext(ctx);
scripts.forEach((s) => { try { vm.runInContext(s, ctx, { timeout: 20000 }); } catch (e) { console.error("bundle threw:", e.message); process.exit(1); } });
const CG = ctx.CG;

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

CG.TEAMS = ["BOS","CAR","COL","DAL","MTL","NYI","PIT","SJS","TOR","UTA","VAN","VGK"].map((c) => ({ code:c, division:"A" }));
const BASE = {
  id: "s1", number: 1, weeks: 8, nights_per_week: 3, night_slots: "21:00,21:35,22:10",
  preseason_starts_at: "2026-09-16T23:00:00Z", starts_at: "2026-10-08T01:00:00Z",
};
const LAST = (keys) => {
  const shape = CG.seasonShape({ ...BASE, skip_holidays: keys });
  const weeks = Math.ceil(shape.perClub / shape.perNight / shape.nights);
  const plan = CG.gameNights("2026-10-07", weeks, shape.nights, keys);
  return plan.nights[plan.nights.length - 1];
};
const PLAYOFF_AFTER = (keys) => {
  const last = LAST(keys);
  const shape = CG.seasonShape({ ...BASE, skip_holidays: keys });
  const po = CG.gameNights(CG.dayAdd(last.fri, 1), 1, shape.nights, keys);
  return { last, po: po.nights[0].wed };
};

console.log("— RULE 1: playoffs open the game week after the last regular week");
{
  /* the set Season 1 was actually generated with */
  let r = PLAYOFF_AFTER(["us-thanksgiving","remembrance-day"]);
  A("last week is Dec 9-11 for that set", r.last.wed === "2026-12-09" && r.last.fri === "2026-12-11",
    r.last.wed + ".." + r.last.fri);
  A("...so playoffs must be Dec 16, not Dec 9", r.po === "2026-12-16", r.po);
  A("...which is exactly one week after the last Wednesday",
    CG.dayAdd(r.last.wed, 7) === r.po);

  /* one skipped week instead of two */
  r = PLAYOFF_AFTER(["us-thanksgiving"]);
  A("a lighter holiday set ends Dec 4", r.last.fri === "2026-12-04", r.last.fri);
  A("...and playoffs follow on Dec 9", r.po === "2026-12-09", r.po);

  /* no skips at all */
  r = PLAYOFF_AFTER([]);
  A("skipping nothing ends Nov 27", r.last.fri === "2026-11-27", r.last.fri);
  A("...and playoffs follow on Dec 2", r.po === "2026-12-02", r.po);

  /* the playoff week must itself step over a holiday week */
  const shape = CG.seasonShape(BASE);
  const po = CG.gameNights(CG.dayAdd("2026-11-20", 1), 1, shape.nights, ["us-thanksgiving"]);
  A("the playoff week steps over a holiday week of its own",
    po.nights[0].wed === "2026-12-02" && po.skipped.length === 1, po.nights[0].wed);
}

console.log("\n— RULE 1 is enforced in code, not just true today");
{
  A("the generator derives the playoff date from the built weeks",
    /playoffs_start_at: CG\.etISO\(poWed,"21:00"\)/.test(src));
  A("...from the LAST week it actually laid down",
    /var lastWk = plan\.nights\[plan\.nights\.length-1\]/.test(src));
  A("...routed through gameNights so it skips a holiday week too",
    /var poPlan = CG\.gameNights\(CG\.dayAdd\(lastWk\.fri,1\), 1, shape\.nights, savedKeys\)/.test(src));
  A("...and ends_at is moved with it", /ends_at: CG\.etISO\(lastWk\.fri,"23:59"\)/.test(src));
  A("a failed playoff update is reported, not swallowed",
    /the playoff date could NOT be updated/.test(src));
  A("only the regular season drives it, never the pre-season",
    /if \(stage !== "regular"\)\{ CG\.toast\(done,"ok"\)/.test(src));
}

console.log("\n— RULE 1 drift is detected after the fact too");
{
  const mk = (playoffISO, lastFri) => {
    CG.SEASON = { ...BASE, skip_holidays: ["us-thanksgiving"], playoffs_start_at: playoffISO };
    CG.lg = { schedule: [
      { stage:"preseason", at: Date.parse("2026-09-16T21:00:00-04:00") },
      { stage:"regular",   at: Date.parse("2026-10-07T21:00:00-04:00") },
      { stage:"regular",   at: Date.parse(lastFri+"T21:00:00-05:00") },
      { stage:"playoff",   at: Date.parse(playoffISO) },
    ] };
    return CG.scheduleIssues();
  };
  let out = mk("2026-12-09T21:00:00-05:00", "2026-12-11");
  A("a season running into its own playoffs is flagged",
    out.some((m) => /run into its own playoffs/.test(m)), JSON.stringify(out));

  out = mk("2026-12-23T21:00:00-05:00", "2026-12-04");
  A("playoffs too far after the season are flagged",
    out.some((m) => /the week after the regular season is/.test(m)), JSON.stringify(out));

  out = mk("2026-12-09T21:00:00-05:00", "2026-12-04");
  A("the correct arrangement raises nothing",
    !out.some((m) => /playoff/i.test(m)), JSON.stringify(out));

  /* the old filter counted playoff games as regular, which moved "the last regular game" */
  A("playoff games are excluded from the regular-season window",
    /g\.stage!=="preseason" && g\.stage!=="playoff"/.test(src));
}

console.log("\n— RULE 2: a ticked holiday is a saved holiday");
{
  A("ticking writes immediately", /pending=setTimeout\(function\(\)\{ persist\(\)/.test(src));
  A("...and updates the season the generator reads, in the same breath",
    /CG\.SEASON\.skip_holidays = keys\.slice\(\)/.test(src));
  A("a refused write is loud, and says the tick is not in effect",
    /Holiday NOT saved — /.test(src) && /Your tick is not in effect/.test(src));
  A("the write is checked for the silent RLS block",
    /the database refused the write — commissioner only/.test(src));

  A("the generator compares what is ticked against what is saved",
    /if \(ticked && !CG\.sameHolidaySet\(ticked, savedKeys\)\)/.test(src));
  A("...and refuses rather than generating the wrong weeks",
    /Your holiday choices haven’t saved, so nothing was generated/.test(src));
  A("...naming the ones that would have been missed", /Ticked but not saved: /.test(src));
  A("the generator builds from that same saved set",
    /CG\.gameNights\(CG\.etYMD\(anchorIso\), weeks, shape\.nights, savedKeys\)/.test(src));
}

console.log("\n— the ticked-vs-saved comparison behaves");
{
  A("same set, different order, is the same", CG.sameHolidaySet(["a","b"], ["b","a"]));
  A("a missing tick differs", !CG.sameHolidaySet(["a"], ["a","b"]));
  A("an extra tick differs", !CG.sameHolidaySet(["a","b"], ["a"]));
  A("empty equals empty", CG.sameHolidaySet([], []));
  A("empty differs from non-empty", !CG.sameHolidaySet([], ["a"]));
  A("null is treated as empty", CG.sameHolidaySet(null, []));

  /* with no Holidays card on screen there is nothing to compare, and a stale [] must never be
     mistaken for "the commissioner unticked everything" */
  A("no card on screen returns null, not an empty list", CG.tickedHolidays() === null);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
