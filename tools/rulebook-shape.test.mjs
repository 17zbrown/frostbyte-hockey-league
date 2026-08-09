/* Rule 3.1's season-shape sentence. Run: node tools/rulebook-shape.test.mjs   (build index.html first)

   Rule 3.1 states the season's shape in words, and that shape is a per-season setting, so
   CG.rulebookShapeSync rewrites the sentence from the live season every time the rulebook renders.
   Two things make that delicate enough to pin down:

   1. The clause is delimited by its SECOND em-dash. v2.14 added a playoff sentence to the same
      paragraph containing a third em-dash, so a greedy match would now swallow the binding text in
      between and delete it. The stored source carried "six (6) game-weeks / fifty-four (54) games"
      long after the league moved to eight and seventy-two — the rendered page was right, the
      document behind it was not, and only the rewrite was hiding it.
   2. It mutates the shared CG.CONTENT.rulebook in place, so a non-idempotent rewrite grows a
      duplicate sentence on every render. That has happened before. */
import fs from "node:fs";
import vm from "node:vm";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
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
scripts.forEach((s) => { try { vm.runInContext(s, ctx, { timeout: 20000 }); } catch (e) {} });
const CG = ctx.CG;
CG.TEAMS = ["A","B","C","D","E","F","G","H","I","J","K","L"].map((c) => ({ code:c, division:"A" }));

const SENT = "The CGHL regular season runs";
const clauseOf = (rb) => {
  let found = null;
  (rb.chapters||[]).forEach((ch)=>(ch.sections||[]).forEach((sec)=>(sec.paragraphs||[]).forEach((p)=>{
    if (typeof p === "string" && p.indexOf(SENT) === 0 && !found) found = p;
  })));
  return found;
};
const fresh = () => JSON.parse(JSON.stringify(CG.CONTENT.rulebook));
const LIVE = { weeks: 8, nights_per_week: 3, night_slots: "21:00,21:35,22:10" };

console.log("— the stored document states the live shape, without relying on the rewrite");
{
  const stored = clauseOf(CG.CONTENT.rulebook);
  A("it is not the retired six-week claim", !/six \(6\) game-weeks/.test(stored));
  A("...nor fifty-four games", !/fifty-four/.test(stored), stored.slice(0, 120));
  A("it states eight game-weeks", /eight \(8\) game-weeks/.test(stored));
  A("...and 72 games per club", /for 72 games per club/.test(stored));
  CG.SEASON = { ...LIVE, id: "s" };
  A("and the rewrite leaves it untouched, because it already agrees",
    clauseOf(CG.rulebookShapeSync(fresh())) === stored);
}

console.log("\n— the numbers come from the season, not the text");
{
  const shapeFor = (o) => { CG.SEASON = { ...LIVE, ...o, id: "s" }; return clauseOf(CG.rulebookShapeSync(fresh())); };
  A("six weeks reads six and 54", /six \(6\) game-weeks/.test(shapeFor({ weeks: 6 })) &&
    /for 54 games per club/.test(shapeFor({ weeks: 6 })));
  A("four nights reads four, names Saturday, and gives 96",
    /four nights a week, Wednesday, Thursday, Friday and Saturday/.test(shapeFor({ nights_per_week: 4 })) &&
    /for 96 games per club/.test(shapeFor({ nights_per_week: 4 })));
  A("two slots a night halves the count",
    /two games a night/.test(shapeFor({ night_slots: "21:00,21:35" })) &&
    /for 48 games per club/.test(shapeFor({ night_slots: "21:00,21:35" })));
}

console.log("\n— the rewrite stops at the SECOND dash (v2.14 put a third in this paragraph)");
{
  CG.SEASON = { ...LIVE, weeks: 6, id: "s" };          // force an actual rewrite
  const out = clauseOf(CG.rulebookShapeSync(fresh()));
  A("the rewrite did happen", /six \(6\) game-weeks/.test(out));
  A("the binding sentence after the clause survives", /binding on all clubs/.test(out));
  A("...the holiday sentence survives", /does not shorten the season/.test(out));
  A("...and the playoff sentence, which carries the third dash", /playoffs open the game week/.test(out));
  A("the paragraph still holds all three dashes", (out.match(/—/g) || []).length === 3,
    String((out.match(/—/g) || []).length));
}

console.log("\n— rewriting in place is idempotent (it once grew a duplicate per render)");
{
  CG.SEASON = { ...LIVE, weeks: 6, id: "s" };
  const rb = fresh();
  const a = clauseOf(CG.rulebookShapeSync(rb));
  const b = clauseOf(CG.rulebookShapeSync(rb));
  const c = clauseOf(CG.rulebookShapeSync(rb));
  A("three passes leave the paragraph byte-identical", a === b && b === c);
  A("...with the opening sentence appearing once", (c.match(/The CGHL regular season runs/g) || []).length === 1,
    String((c.match(/The CGHL regular season runs/g) || []).length));
}

console.log("\n— nothing restates the season length as a literal any more");
{
  const live = fs.readFileSync(new URL("../src/live/part_live.js", import.meta.url), "utf8");
  const hub  = fs.readFileSync(new URL("../src/live/part6_hub.js", import.meta.url), "utf8");
  A("the Puck drop timeline reads the season", /"\+perClub\+" games, every stat imported/.test(live));
  A("...and computes it from the shape", /var perClub = \(CG\.seasonShape \? CG\.seasonShape\(s\)\.perClub/.test(live));
  A("the fallback constant matches the league's shape", /CG\.GAMES_PER_CLUB = 72;/.test(live));
  A("clubSeasonGames no longer carries a second literal", !/\|\| 54;/.test(hub));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
