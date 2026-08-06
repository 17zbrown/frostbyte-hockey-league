/* Membership analytics — load the BUILT bundle, inject an RPC-shaped payload, and assert what
   CG.membershipStats draws. Run: node tools/pop-stats.test.cjs   (build index.html first)

   The failure classes that matter:
     * aggregation lying — a weekly bucket summing the population LEVEL instead of carrying its
       last value, or net ≠ joins − departs;
     * the range toggle changing the headline gauges (they are fixed 7/30-day windows);
     * a clipped-baseline area chart keeping its gradient fill (magnitude claim without a zero);
     * a negative week rendering as a small positive bar instead of hanging below the axis. */
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
  addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, scrollTo: noop, alert: noop,
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; ctx.top = ctx;
ctx.document = Object.assign(el(), {
  addEventListener: noop, removeEventListener: noop, createElement: el, createTextNode: el,
  createDocumentFragment: el, getElementById: () => null, getElementsByTagName: () => [],
  documentElement: el(), head: el(), body: el(), visibilityState: "visible", readyState: "complete",
  cookie: "", title: "", querySelectorAll: () => [], querySelector: () => null,
});
vm.createContext(ctx);
for (const s of scripts) { try { vm.runInContext(s, ctx, { timeout: 30000 }); } catch (e) { console.error("bundle threw:", e.message); process.exit(1); } }
const CG = ctx.CG;

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* ---- fixture: 40 ET days ending 2026-08-06 (a Thursday), RPC-shaped ---- */
const days = [];
{
  let members = 100;
  const start = new Date("2026-06-28T12:00:00Z");
  for (let i = 0; i < 40; i++) {
    const d = new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10);
    const joins = (i * 7) % 5;                       // deterministic, varied
    const departs = i % 11 === 0 ? 3 : (i % 4 === 0 ? 1 : 0);
    members += joins - departs;
    days.push({ d, joins, departs, signups: i % 3 === 0 ? 2 : 0, accounts: i % 2, members });
  }
}
const P = {
  days, present: days[days.length - 1].members,
  reg_present: 89, linked_present: 110, signups_total: 93,
  meta: { depart_log_since: "2026-08-03" },
};

console.log("— bucketing arithmetic");
{
  const d = CG._popBuckets(days, "d");
  A("daily keeps the last 30 days", d.length === 30 && d[d.length-1].k === "2026-08-06");
  A("net = joins − departs on every bucket", d.every((b) => b.net === b.joins - b.departs));
  A("labels read as calendar days", /^[A-Z][a-z]{2} \d/.test(d[0].label));

  const w = CG._popBuckets(days, "w");
  A("weekly buckets key on the ISO Monday", w.every((b) => new Date(b.k + "T12:00:00Z").getUTCDay() === 1));
  A("2026-08-06 (a Thursday) lands in the Aug 3 week", w[w.length-1].k === "2026-08-03");
  const wk = w[w.length-2];                          // a FULL week (the last one is partial)
  const wkDays = days.filter((r) => {
    const dt = new Date(r.d + "T12:00:00Z"); const m = new Date(dt.getTime() - ((dt.getUTCDay()+6)%7)*864e5);
    return m.toISOString().slice(0,10) === wk.k;
  });
  A("a week's flows are the SUM of its days",
    wk.joins === wkDays.reduce((s,r)=>s+r.joins,0) && wk.signups === wkDays.reduce((s,r)=>s+r.signups,0));
  A("a week's population is its LAST day's level, never a sum",
    wk.members === wkDays[wkDays.length-1].members);

  const m = CG._popBuckets(days, "m");
  A("monthly groups by calendar month", m.map((b)=>b.k).join(",") === "2026-06,2026-07,2026-08");
  A("a month's population is its last day's level",
    m[1].members === days.filter((r)=>r.d.slice(0,7)==="2026-07").slice(-1)[0].members);
}

console.log("\n— the diverging bars");
{
  const h = CG.viz.dbars([{ k:"W1", v:5 }, { k:"W2", v:-3 }, { k:"W3", v:0 }]);
  A("renders", h.length > 0);
  A("a loss hangs below the axis", /vz-db neg/.test(h) && /class="dn"/.test(h));
  A("...and is labeled with its sign", /－3|-3/.test(h));
  A("a gain is labeled +", /\+5/.test(h));
  A("zero is neither up nor down", /vz-db zero/.test(h));
  A("direction exists even without color (up/dn structure)", /class="up"/.test(h) && /class="dn/.test(h));
  A("one bar is not a chart", CG.viz.dbars([{ k:"only", v:2 }]) === "");
}

console.log("\n— the population line is honest about its baseline");
{
  const filled = CG.viz.area([{v:180},{v:184},{v:190}], {});
  const line = CG.viz.area([{v:180},{v:184},{v:190}], { zero:false, line:true });
  A("default area keeps its gradient fill", /vz-afill/.test(filled));
  A("line mode drops the fill — a clipped baseline may not claim magnitude", !/vz-afill/.test(line));
  A("...but keeps the line and dots", /vz-aline/.test(line) && /vz-dot/.test(line));
}

console.log("\n— the rendered dashboard");
{
  CG._popStats = P;
  const h = CG.membershipStats();
  A("headline member count shows", new RegExp(">" + P.present + "<").test(h));
  A("all four chart cards render",
    /Member population/.test(h) && /Net member gain \/ loss/.test(h) &&
    /Season sign-ups/.test(h) && /New site accounts/.test(h));
  A("both conversion gauges render", /Registered for the season/.test(h) && /Linked to the site/.test(h));
  A("the registered donut carries its real fraction", /89 of \d+ members/.test(h));
  A("the range toggle offers all three views",
    /data-poprange="d"/.test(h) && /data-poprange="w"/.test(h) && /data-poprange="m"/.test(h));
  A("exactly one view is pressed", (h.match(/aria-pressed="true"/g) || []).length === 1);
  A("the reconstruction caveat is stated, dated from the departure log",
    /reconstructed from Discord join dates/.test(h) && /2026-08-03/.test(h));

  /* headline gauges are FIXED windows — the range toggle must not move them */
  const net7 = days.slice(-7).reduce((s,r)=>s+r.joins-r.departs,0);
  const has7 = new RegExp((net7>0?"▲ \\+"+net7 : net7<0 ? "▼ "+net7 : "— 0"));
  A("the 7-day momentum chip matches the daily series", has7.test(h));
  CG.store.set("popRange", "m");
  const hm = CG.membershipStats();
  CG.store.set("popRange", "d");
  A("switching to monthly leaves the 7-day chip untouched", has7.test(hm));
  A("...and re-labels the charts by month", /by month/.test(hm));

  CG._popStats = null;
  A("no data renders an empty placeholder, never a crash",
    CG.membershipStats() === '<div id="pop-stats-wrap"></div>');
}

console.log("\n— every mark explains itself on hover");
{
  CG._popStats = P;
  const h = CG.membershipStats();
  A("population points carry a dated tooltip with the join/leave breakdown",
    /data-tip="[^"]*members \(\+\d+ joined/.test(h));
  A("net bars break their number into joins and departures",
    /data-tip="[^"]*net [+\u2212-]?\d+ \(\d+ joined, \d+ left\)/.test(h));
  A("sign-up bars say what the number is", /data-tip="[^"]*sign-ups?"/.test(h));
  A("the donut states its fraction", /vz-donut" data-tip="89 of /.test(h));
  A("area hit targets are bigger than the dots", /vz-hit[^/]*r="11"/.test(h));
  const boot = CG.bootScreen();
  A("the boot screen exists as a pure function", boot.length > 0);
  A("...the logo's own arc is the spinner", /bl-carc/.test(boot) && /bl-arc/.test(boot));
  A("...and announces itself to screen readers", /role="status"/.test(boot));
  CG._popStats = null;
}

console.log("\n— wired into the overview");
{
  const src = fs.readFileSync(require("path").join(__dirname, "..", "src", "live", "part_live.js"), "utf8");
  A("the overview includes the membership section", /h \+= CG\.membershipStats\(\);/.test(src));
  A("the admin AFTER chain arms the toggle and the loader",
    /CG\.AFTER\._popStats\(\);/.test(src) && /CG\.loadPopStats\(\)/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
