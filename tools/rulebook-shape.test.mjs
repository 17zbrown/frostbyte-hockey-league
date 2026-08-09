/* Rule 3.1's season-shape sentence, on BOTH published surfaces.
   Run: node tools/rulebook-shape.test.mjs   (build index.html first)

   The website reconciles Rule 3.1 against the live season at render time; the Discord #rules mirror
   read the raw file and did not. So the site showed "eight (8) game-weeks ... 72 games per club"
   while #rules published "six (6) ... fifty-four (54)" — two published surfaces disagreeing about
   how long the season is, which is worse than either being stale on its own. Both now generate the
   same sentence, and these assertions fail the moment the two copies drift. */
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "g";

import fs from "node:fs";
import vm from "node:vm";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* ---- the Netlify (Discord mirror) copy ---- */
const sched = await import(new URL("../netlify/functions/discord-scheduler.js", import.meta.url).pathname);

/* ---- the browser copy, out of the built bundle ---- */
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
const freshRulebook = () => JSON.parse(JSON.stringify(CG.CONTENT.rulebook));

const SHAPES = [
  { label: "the live season", weeks: 8, nights_per_week: 3, night_slots: "21:00,21:35,22:10" },
  { label: "the old six-week shape", weeks: 6, nights_per_week: 3, night_slots: "21:00,21:35,22:10" },
  { label: "four nights", weeks: 8, nights_per_week: 4, night_slots: "21:00,21:35,22:10" },
  { label: "two slots a night", weeks: 10, nights_per_week: 3, night_slots: "21:00,21:35" },
  { label: "a single night, single slot", weeks: 1, nights_per_week: 1, night_slots: "21:00" },
];

console.log("— the site and the Discord mirror generate the SAME sentence");
for (const sh of SHAPES) {
  CG.SEASON = { ...sh, id: "s" };
  const site = clauseOf(CG.rulebookShapeSync(freshRulebook()));
  const disc = clauseOf(sched.syncRulebookShape(freshRulebook(), sh));
  A(`${sh.label}: identical`, site === disc, site === disc ? "" : `\n      site: ${site}\n      disc: ${disc}`);
}

console.log("\n— the numbers are the season's own, not baked in");
{
  CG.SEASON = { ...SHAPES[0], id: "s" };
  const line = sched.rulebookShapeLine(sched.seasonShapeOf(SHAPES[0]));
  A("eight weeks x three nights x three slots = 72", /eight \(8\) game-weeks/.test(line) && /for 72 games per club/.test(line), line);
  const four = sched.rulebookShapeLine(sched.seasonShapeOf(SHAPES[2]));
  A("four nights gives 96 and names Saturday", /for 96 games per club/.test(four) && /Saturday/.test(four), four);
  const two = sched.rulebookShapeLine(sched.seasonShapeOf(SHAPES[3]));
  A("two slots over ten weeks gives 60", /for 60 games per club/.test(two), two);
  A("a one-night week reads in the singular", /one nights? a week, Wednesday, one games a night/.test(
    sched.rulebookShapeLine(sched.seasonShapeOf(SHAPES[4]))));
}

console.log("\n— rewriting is idempotent on both (it once grew a duplicate per render)");
for (const impl of [
  { name: "site", run: (rb) => CG.rulebookShapeSync(rb) },
  { name: "discord", run: (rb) => sched.syncRulebookShape(rb, SHAPES[0]) },
]) {
  CG.SEASON = { ...SHAPES[0], id: "s" };
  const rb = freshRulebook();
  const once = clauseOf(impl.run(rb));
  const twice = clauseOf(impl.run(rb));
  const thrice = clauseOf(impl.run(rb));
  A(`${impl.name}: three passes leave the paragraph byte-identical`, once === twice && twice === thrice);
  A(`${impl.name}: ...the opening sentence is not duplicated`,
    (twice.match(/The CGHL regular season runs/g) || []).length === 1,
    String((twice.match(/The CGHL regular season runs/g) || []).length));
  /* The clause is delimited by the SECOND em-dash, and the paragraph legitimately holds a third in
     the playoff sentence (v2.14). A greedy match would swallow everything up to it and delete the
     binding text in between, so check the downstream sentences survived. */
  A(`${impl.name}: ...and the rewrite stops at the second dash`,
    /binding on all clubs/.test(twice) && /playoffs open the game week/.test(twice) &&
    /does not shorten the season/.test(twice));
}

console.log("\n— the STORED text already matches, so a raw read is correct on its own");
{
  const stored = clauseOf(CG.CONTENT.rulebook);
  const live = sched.rulebookShapeLine(sched.seasonShapeOf(SHAPES[0]));
  A("part3_content.js states the live shape verbatim", stored.indexOf(live) === 0,
    `\n      stored: ${stored.slice(0, 160)}\n      live  : ${live}`);
  A("...and no longer claims six weeks", !/six \(6\) game-weeks/.test(stored));
  A("...nor fifty-four games", !/fifty-four/.test(stored));
  A("the holiday clause survives the rewrite (it sits past the second dash)",
    /does not shorten the season/.test(clauseOf(sched.syncRulebookShape(freshRulebook(), SHAPES[0]))));
}

console.log("\n— the mirror actually applies it before publishing");
{
  const src = fs.readFileSync(new URL("../netlify/functions/discord-scheduler.js", import.meta.url), "utf8");
  A("rulesUpkeep syncs the shape before building the card",
    /syncRulebookShape\(rb, seas\[0\]\)/.test(src) &&
    src.indexOf("syncRulebookShape(rb, seas[0])") < src.indexOf("const card = buildRulesLink(rb)"));
  A("...reading the season it publishes for", /seasons\?select=weeks,nights_per_week,night_slots/.test(src));
  A("...and a failure is recorded, not silent", /rulesShape: String\(e\.message/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
