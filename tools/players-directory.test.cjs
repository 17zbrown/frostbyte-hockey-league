/* The player directory and the search palette must cover EVERY signed-in account, not just
   roster_spots — and an account with no club wears the league mark, not a broken crest.
   Run: node tools/players-directory.test.cjs   (build index.html first) */
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

/* ---- fixtures: two rostered players, two bare accounts (one registered, one not) ---- */
CG.SEASON = { id: "s1", number: 1 };
CG.TEAMS = [{ code:"BOS", name:"Bruins", city:"Boston", div:"East", color:"#FFB81C", color2:"#010101" }];
CG.TEAM = { BOS: CG.TEAMS[0] };
const rostered = [
  { id:"r1", tag:"IceWizard", team:"BOS", pos:"C", jersey:9,  rookie:false, overall:88 },
  { id:"r2", tag:"NetMinder", team:"BOS", pos:"G", jersey:31, rookie:true,  overall:84 },
];
CG.lg = {
  players: rostered,
  ratings: { r1:{ovr:88}, r2:{ovr:84} },
  pstats:  { r1:{gp:0,p:0}, r2:{gp:0,sv:0,sa:0} },
  suspensions: [], schedule: [], results: [], allResults: [],
  _registrationsRaw: [
    { profile_id:"u1", season_id:"s1", position:"RD" },   // registered, no club
  ],
  _rosteredIds: { r1:true, r2:true },
  _profilesRaw: [
    { id:"r1", gamertag:"IceWizard", overall:88 },
    { id:"r2", gamertag:"NetMinder", overall:84 },
    { id:"u1", gamertag:"DraftHopeful", overall:77 },     // signed up, waiting on the draft
    { id:"u2", gamertag:"JustBrowsing", overall:null },   // signed in, never registered
    { id:"u3", gamertag:"BadActor", overall:60, banned:true },
  ],
};

console.log("— the directory shows every signed-in account");
{
  const out = CG.ROUTES.players("", {});
  A("rostered players render", out.includes("IceWizard") && out.includes("NetMinder"));
  A("a registered-but-unrostered account renders", out.includes("DraftHopeful"));
  A("a never-registered account renders too", out.includes("JustBrowsing"));
  A("banned accounts stay out", !out.includes("BadActor"));
  A("the league mark stands in as their crest", /aria-label="Chel Gaming"/.test(out));
  A("registration position carried", />RD</.test(out));
  A("header counts accounts, not just rosters", out.includes("4 players") && out.includes("2 on club rosters"));
  A("unrostered row links to the profile", out.includes('data-go="#/player/u1"'));
  A("club filter offers No club yet", out.includes('value="FA"') && out.includes("No club yet"));
}

console.log("\n— filters treat the two groups correctly");
{
  const fa = CG.ROUTES.players("", { team:"FA" });
  A("No club yet shows only unrostered", fa.includes("DraftHopeful") && !fa.includes("IceWizard"));
  const bos = CG.ROUTES.players("", { team:"BOS" });
  A("a club filter shows only that club", bos.includes("IceWizard") && !bos.includes("DraftHopeful"));
  const rd = CG.ROUTES.players("", { pos:"RD" });
  A("position filter reaches registrations", rd.includes("DraftHopeful") && !rd.includes("IceWizard"));
  const rk = CG.ROUTES.players("", { flag:"rookie" });
  A("rookie flag stays a roster concept", rk.includes("NetMinder") && !rk.includes("JustBrowsing"));
}

console.log("\n— the search palette covers accounts and teams");
{
  const ix = CG.searchIndex();
  const labels = ix.filter((r) => r.cat === "Players").map((r) => r.label);
  A("rostered players indexed", labels.includes("IceWizard"));
  A("unrostered accounts indexed", labels.includes("DraftHopeful") && labels.includes("JustBrowsing"));
  A("banned accounts not indexed", !labels.includes("BadActor"));
  A("teams indexed", ix.some((r) => r.cat === "Teams" && r.label === "Bruins"));
  const hop = ix.find((r) => r.label === "DraftHopeful");
  A("unrostered route goes to the profile", hop && hop.route === "#/player/u1");
  A("no duplicate entries for rostered players", labels.filter((l) => l === "IceWizard").length === 1);
}

console.log("\n— goalie DNA");
{
  const elite = CG.goalieDNA({ gp: 10, sv: 94, sa: 100, ga: 6, qs: 9, so: 3, w: 9 });
  const weak  = CG.goalieDNA({ gp: 10, sv: 78, sa: 100, ga: 22, qs: 2, so: 0, w: 2 });
  A("six axes, six values", CG.GOALIE_DNA_AXES.length === 6 && elite.length === 6);
  A("a .940 goalie out-stops a .780 goalie", elite[0] > weak[0], elite[0] + " vs " + weak[0]);
  A("lower GAA scores higher", elite[1] > weak[1]);
  A("quality starts separate them", elite[3] > weak[3]);
  A("shutouts and wins register", elite[4] > weak[4] && elite[5] > weak[5]);
  A("values clamp to the 4..100 band", [...elite, ...weak].every((v) => v >= 4 && v <= 100));
  A("equal workload reads equal", elite[2] === weak[2]);
  const zero = CG.goalieDNA({ gp: 0, sv: 0, sa: 0, ga: 0, qs: 0, so: 0, w: 0 });
  A("an empty line floors instead of NaN", zero.every((v) => Number.isFinite(v) && v >= 4));
  const svg = CG.vizRadar(CG.GOALIE_DNA_AXES, elite, null, "Tendy");
  A("the radar renders every axis label", CG.GOALIE_DNA_AXES.every((ax) => svg.includes(ax.toUpperCase())));
  A("...as a real SVG with the player named", svg.includes("<svg") && svg.includes("Tendy"));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
