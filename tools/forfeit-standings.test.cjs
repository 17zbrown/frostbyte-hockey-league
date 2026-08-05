/* A forfeit decides the result, not the goals. The three-disconnection forfeit of Rule 4.3 keeps
   the played score AND every stat line, so the forfeiting club can finish with more goals and
   still take the loss — the standings must rule the win, while goals for/against stay real.
   Run: node tools/forfeit-standings.test.cjs   (build index.html first) */
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

const noop = () => {};
const el = () => new Proxy(function () {}, {
  get(t, k) {
    if (k === "style") return new Proxy({}, { get: () => "", set: () => true });
    if (k === "classList") return { add: noop, remove: noop, toggle: noop, contains: () => false };
    if (k === "querySelectorAll") return () => [];
    if (k === "querySelector") return () => null;
    if (k === "getAttribute") return () => null;
    if (k === "length") return 0;
    if (["textContent","innerHTML","value","id","className"].includes(k)) return "";
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

CG.TEAMS = [
  { code:"BOS", name:"Bruins", city:"Boston", div:"East", color:"#FFB81C" },
  { code:"TOR", name:"Maple Leafs", city:"Toronto", div:"East", color:"#00205B" },
];
CG.TEAM = { BOS: CG.TEAMS[0], TOR: CG.TEAMS[1] };

const game = (home, away, hs, as, opts) => Object.assign({
  id: "g" + Math.random().toString(36).slice(2), week: 1, stage: "regular",
  home, away, at: Date.now() - 86400000, ot: false,
  score: { [home]: hs, [away]: as }, box: { [home]: {}, [away]: {} }, stars: [], entered: true,
}, opts || {});

/* aggregate also derives team ratings from the roster, so give it a minimal but real one:
   one rated player per club is enough for the ratings pass to run without touching W/L. */
const roster = (code) => [{ id: code + "-p1", tag: code + "One", team: code, pos: "C" }];
const run = (results) => {
  const players = [].concat(roster("BOS"), roster("TOR"));
  const ratings = {}; players.forEach((p) => { ratings[p.id] = { ovr: 75, parts: { saves: 60 } }; });
  const lg = { players, ratings, results, teams: {}, glog: {},
    byTeam: { BOS: roster("BOS"), TOR: roster("TOR") } };
  CG.aggregate(lg, {});
  return lg.teams;
};

console.log("— a normal final is unchanged");
{
  const t = run([game("BOS", "TOR", 4, 2)]);
  A("the higher score wins", t.BOS.w === 1 && t.TOR.l === 1);
  A("goals are recorded both ways", t.BOS.gf === 4 && t.BOS.ga === 2 && t.TOR.gf === 2);
  A("a regulation win counts as one", t.BOS.rw === 1);
  const ot = run([game("BOS", "TOR", 3, 2, { ot: true })]);
  A("an overtime loss still earns its point", ot.TOR.otl === 1 && ot.TOR.l === 0 && ot.TOR.pts === 1);
  A("...and is not a regulation win", ot.BOS.rw === 0 && ot.BOS.w === 1);
}

console.log("\n— a no-show forfeit (Rule 3.2): 1-0, and the ruling matches the score");
{
  const t = run([game("BOS", "TOR", 1, 0, { forfeit: "TOR" })]);
  A("the club that showed wins", t.BOS.w === 1 && t.TOR.l === 1);
  A("the forfeiting club gets no overtime point", t.TOR.otl === 0 && t.TOR.pts === 0);
  A("it counts as a regulation win for tiebreakers", t.BOS.rw === 1);
}

console.log("\n— the case this test exists for: a forfeit whose score favours the loser");
{
  /* BOS disconnected three times while leading 5-2. Rule 4.3: stats and score are KEPT,
     the game publishes as a forfeit loss for BOS anyway. */
  const t = run([game("BOS", "TOR", 5, 2, { forfeit: "BOS" })]);
  A("the forfeiting club takes the loss despite scoring more", t.BOS.l === 1 && t.BOS.w === 0);
  A("...and the opponent takes the win despite scoring fewer", t.TOR.w === 1 && t.TOR.l === 0);
  A("the real goals are kept for the forfeiting club", t.BOS.gf === 5 && t.BOS.ga === 2);
  A("...and for the opponent", t.TOR.gf === 2 && t.TOR.ga === 5);
  A("goal differential stays honest (Rule 8.2)", t.BOS.diff === 3 && t.TOR.diff === -3);
  A("points follow the ruling, not the goals", t.BOS.pts === 0 && t.TOR.pts === 2);
  A("games played still balance", t.BOS.gp === 1 && t.TOR.gp === 1);
  A("W+L+OTL equals games played", t.BOS.gp === t.BOS.w + t.BOS.l + t.BOS.otl);
}

console.log("\n— a forfeit never awards the overtime-loss point");
{
  /* even if the abandoned game happened to be in overtime when it died */
  const t = run([game("BOS", "TOR", 3, 3, { forfeit: "BOS", ot: true })]);
  A("no overtime point for the forfeiting club", t.BOS.otl === 0 && t.BOS.l === 1 && t.BOS.pts === 0);
  A("the win is a regulation win", t.TOR.rw === 1 && t.TOR.pts === 2);
}

console.log("\n— a tie score still resolves under a forfeit");
{
  const t = run([game("BOS", "TOR", 2, 2, { forfeit: "TOR" })]);
  A("the forfeiting club loses a level game", t.BOS.w === 1 && t.TOR.l === 1);
  A("nobody is credited a phantom draw", t.BOS.gp === 1 && t.TOR.gp === 1 && t.TOR.otl === 0);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
