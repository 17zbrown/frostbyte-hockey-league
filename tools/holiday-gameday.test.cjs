/* The Holidays card says whether a holiday lands on a game night.
   Run: node tools/holiday-gameday.test.cjs   (build index.html first)

   The toggles used to show only a date and the week it would cost, which made every holiday look
   like the same decision. It is not: the skip is always whole-week, so a MONDAY holiday removes a
   full slate of Wed/Thu/Fri games even though nobody would have been away for it — that is why
   Canadian Thanksgiving being on quietly pushed Season 1's last week into its own playoffs. These
   assertions hold the distinction the card now draws, against the real 2026 calendar. */
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

/* Season 1 exactly as it stands in the live database. */
CG.TEAMS = ["BOS","CAR","COL","DAL","MTL","NYI","PIT","SJS","TOR","UTA","VAN","VGK"].map((c) => ({ code:c, division:"A" }));
const SEASON = {
  id: "s1", number: 1, weeks: 8, nights_per_week: 3, night_slots: "21:00,21:35,22:10",
  preseason_starts_at: "2026-09-16T23:00:00Z", starts_at: "2026-10-08T01:00:00Z",
  skip_holidays: ["new-years-day","easter","ca-thanksgiving","us-thanksgiving","christmas-eve",
                  "christmas-day","boxing-day","new-years-eve","canada-day","independence-day"],
};
CG.SEASON = SEASON;

console.log("— the slate is read from the season, not a constant");
{
  A("three nights means Wed/Thu/Fri", CG.nightNames(SEASON).join("/") === "Wed/Thu/Fri", CG.nightNames(SEASON).join("/"));
  A("...a four-night season adds Saturday",
    CG.nightNames({ ...SEASON, nights_per_week: 4 }).join("/") === "Wed/Thu/Fri/Sat",
    CG.nightNames({ ...SEASON, nights_per_week: 4 }).join("/"));
}

console.log("\n— each holiday knows whether the league actually plays that day (2026 calendar)");
{
  const imp = CG.holidayImpact(SEASON);
  const on = (k) => imp[k] && imp[k].date;
  A("Canadian Thanksgiving resolves to Mon Oct 12", on("ca-thanksgiving") === "2026-10-12", on("ca-thanksgiving"));
  A("...and is NOT a game day", imp["ca-thanksgiving"].gameDay === false);
  A("US Thanksgiving resolves to Thu Nov 26", on("us-thanksgiving") === "2026-11-26", on("us-thanksgiving"));
  A("...and IS a game day", imp["us-thanksgiving"].gameDay === true);
  A("Remembrance Day resolves to Wed Nov 11", on("remembrance-day") === "2026-11-11", on("remembrance-day"));
  A("...and IS a game day", imp["remembrance-day"].gameDay === true);
  A("Halloween resolves to Sat Oct 31", on("halloween") === "2026-10-31", on("halloween"));
  A("...and is NOT a game day", imp["halloween"].gameDay === false);

  /* the flag must follow the season's night count, not a hard-coded Wed/Thu/Fri */
  const four = CG.holidayImpact({ ...SEASON, nights_per_week: 4 });
  A("with four nights, Saturday Halloween becomes a game day", four["halloween"].gameDay === true);
  A("...while Monday Canadian Thanksgiving still is not", four["ca-thanksgiving"].gameDay === false);
}

console.log("\n— the card renders the distinction");
{
  const h = CG.holidayCard();
  const rowOf = (key) => {
    const i = h.indexOf('data-hol="' + key + '"');
    return i < 0 ? "" : h.slice(i, h.indexOf("</button>", i));
  };
  A("a game-night holiday is called out", /FALLS ON A GAME NIGHT/.test(rowOf("us-thanksgiving")));
  A("...and Remembrance Day too", /FALLS ON A GAME NIGHT/.test(rowOf("remembrance-day")));
  A("a non-game-night holiday says so plainly", /no game that day/.test(rowOf("ca-thanksgiving")));
  A("...and Halloween too", /no game that day/.test(rowOf("halloween")));
  A("the two are never both on one row", !/FALLS ON A GAME NIGHT[\s\S]*no game that day/.test(rowOf("halloween")));

  A("the weekday is shown, which is the actual question", /Monday, Oct 12/.test(rowOf("ca-thanksgiving")), rowOf("ca-thanksgiving").slice(0, 0) || undefined);
  A("...for the game-night one as well", /Thursday, Nov 26/.test(rowOf("us-thanksgiving")));
  A("the week it would cost is still shown", /week of 11-25/.test(rowOf("us-thanksgiving")));

  A("the caption warns that a non-game-night holiday still costs a whole week",
    /still costs you a full week of Wed\/Thu\/Fri games/.test(h));

  /* Holidays outside the season have no week to cost, so they must not claim a game-night verdict. */
  A("an out-of-season holiday carries no game-night badge",
    !/FALLS ON A GAME NIGHT/.test(rowOf("victoria-day")) && !/no game that day/.test(rowOf("victoria-day")));
}

console.log("\n— the season's footprint is real, not a fixed guess");
{
  const imp = CG.holidayImpact(SEASON);
  const inSeason = Object.keys(imp).sort();
  /* The horizon used to be weeks + preseason + 20 holidays + 6 = 36 weeks, running to May 2027, so
     the card listed the following spring under "Land inside this season" and the chip claimed 8
     weeks skipped for a season that skips 2. */
  A("nothing from 2027 is claimed as inside a season that ends in Dec 2026",
    inSeason.every((k) => imp[k].date < "2027-01-01"),
    inSeason.map((k) => k + "=" + imp[k].date).join(" "));
  A("the December cluster is correctly OUTSIDE the playing weeks",
    !imp["christmas-day"] && !imp["new-years-eve"] && !imp["new-years-day"],
    "christmas=" + (imp["christmas-day"] && imp["christmas-day"].date));
  A("the two that really do land are still found",
    !!imp["ca-thanksgiving"] && !!imp["us-thanksgiving"] && !!imp["remembrance-day"] && !!imp["halloween"]);

  const onMap = new Set(SEASON.skip_holidays);
  const costs = Object.keys(imp).filter((k) => onMap.has(k));
  A("so the chip counts 2 weeks skipped, not 8", costs.length === 2, costs.join(","));
  A("...and they are the two Thanksgivings",
    costs.sort().join(",") === "ca-thanksgiving,us-thanksgiving", costs.sort().join(","));

  const h = CG.holidayCard();
  A("the card's chip text agrees", /2 weeks skipped/.test(h), (h.match(/\d+ weeks? skipped/) || [])[0]);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
