/* Control Center overview charts — load the BUILT bundle, inject production-shaped league data,
   and assert exactly what CG.overviewCharts draws.
   Run: node tools/overview-charts.test.cjs   (build index.html first)

   These charts are designed for a league that has NOT started: zero final games and an empty
   game_stats, so anything about goals or standings would draw an empty box. What they answer is
   who has signed up, who is still unplaced, which positions are short, and which clubs have nobody
   running them. The numbers in the fixtures below were taken from the live database. */
const fs = require("fs"), vm = require("vm");
const html = fs.readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
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

/* ---- production-shaped fixtures (numbers verified against the live DB) ---- */
const SEASON_ID = "s1";
CG.SEASON = { id: SEASON_ID, number: 1 };
const POS = { C:15, LW:13, RW:12, G:12, LD:8, RD:7 };            // 67 total
const TEAM_SEATS = { DAL:3, BOS:2, CAR:2, PIT:2, VGK:2, SJS:1, TBL:1, TOR:1, UTA:1, VAN:1 };  // 16 of 30
CG.TEAMS = Object.keys(TEAM_SEATS).map((code) => ({ code, color:"#00205B" }));

// 67 registrations across 15 distinct ET days spanning 17 calendar days (2026-07-18 .. 2026-08-03),
// deliberately leaving 07-22 and 07-24 empty so the gap-filling is exercised.
const DAYS = ["2026-07-18","2026-07-19","2026-07-20","2026-07-21","2026-07-23","2026-07-25","2026-07-26",
              "2026-07-27","2026-07-28","2026-07-29","2026-07-30","2026-07-31","2026-08-01","2026-08-02","2026-08-03"];
const regs = [];
let i = 0;
for (const [pos, n] of Object.entries(POS)) for (let k = 0; k < n; k++) {
  regs.push({ profile_id: "p" + i, season_id: SEASON_ID, position: pos,
              created_at: DAYS[i % DAYS.length] + "T18:00:00Z" });
  i++;
}
// 15 of the registrants are rostered, plus one person holding a spot who never registered
const rosteredIds = {}; regs.slice(0, 15).forEach((r) => { rosteredIds[r.profile_id] = true; });
rosteredIds["ghost"] = true;

const players = [];
Object.entries(TEAM_SEATS).forEach(([code, n]) => {
  for (let s = 0; s < n; s++) players.push({ team: code, mgmt: ["owner","gm","agm"][s] });
});

CG.lg = {
  _registrationsRaw: regs,
  _rosteredIds: rosteredIds,
  _profilesRaw: Array.from({ length: 94 }, (_, n) => ({ id: "acct" + n })),
  players,
};

const out = CG.overviewCharts();
let ok = true;
const assert = (label, pass, extra) => { if (!pass) ok = false; console.log(`${pass?"ok  ":"FAIL"} ${label}${extra?"  — "+extra:""}`); };

assert("renders markup", !!out && out.length > 500, (out||"").length + " chars");
const titles = [...out.matchAll(/<div class="vz-t"><b>([^<]+)</g)].map((m) => m[1]);
console.log("\ncharts drawn: " + titles.join(" | ") + "\n");
assert("four charts", titles.length === 4, titles.length + " drawn");

// 1 — cumulative sign-ups: 17 points (gaps filled), ending at 67
const dots = (out.match(/class="vz-dot"/g) || []).length;
assert("sign-up curve fills calendar gaps (17 points, not 15)", dots === 17, dots + " points");
assert("curve ends at the true total", /class="vz-v"[^>]*data-to="67"/.test(out) || />67</.test(out));
assert("axis labels the real span", out.includes("Jul 18") && out.includes("Aug 3"));

// 2 — funnel, strictly nested
assert("funnel: 94 accounts", /Signed in to the site<\/em><\/span><span class="vz-hbv">94</.test(out));
assert("funnel: 67 registered", /Registered for the season<\/em><\/span><span class="vz-hbv">67</.test(out));
assert("funnel: 15 placed (registered AND rostered, not 16)", /Placed on a club<\/em><\/span><span class="vz-hbv">15</.test(out));
assert("funnel flags the 52 waiting", out.includes("52 registered players still waiting on a club"));
assert("funnel flags the roster spot with no registration", /1 holds a roster spot without registering/.test(out));

// 3 — positions vs 10 jobs, in fixed order, shortages named
const posOrder = [...out.matchAll(/<em>(Center|Left Wing|Right Wing|Left Defense|Right Defense|Goaltender)<\/em>/g)].map((m)=>m[1]);
assert("positions stay in ice order, not sorted by count", posOrder.join(",") === "Center,Left Wing,Right Wing,Left Defense,Right Defense,Goaltender", posOrder.join(","));
assert("right defense shows 7 / 10", /Right Defense<\/em><\/span><span class="vz-hbv">7 \/ 10</.test(out));
assert("goaltender shows 12 / 10", /Goaltender<\/em><\/span><span class="vz-hbv">12 \/ 10</.test(out));
assert("shortages named in words", out.includes("2 short at left defense") && out.includes("3 short at right defense"));

// 4 — front-office seats
assert("seats corner value 16 / 30", out.includes("16 / 30"));
assert("DAL shows 3 / 3", /DAL<\/em><\/span><span class="vz-hbv">3 \/ 3</.test(out));
assert("solo clubs counted", out.includes("5 clubs running on one person"));

// resilience: empty league must not throw or emit a broken shell
CG.lg = { _registrationsRaw: [], _rosteredIds: {}, _profilesRaw: [], players: [] };
let empty; try { empty = CG.overviewCharts(); } catch (e) { empty = "THREW: " + e.message; }
assert("an empty league renders nothing rather than throwing", empty === "", JSON.stringify(empty).slice(0, 80));
CG.lg = null;
let nolg; try { nolg = CG.overviewCharts(); } catch (e) { nolg = "THREW: " + e.message; }
assert("no league loaded is handled", nolg === "");

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
