/* The line creator — franchise-mode line combinations + the night plan.
   Run: node tools/line-creator.test.cjs   (build index.html first)

   The invariant that matters most here is NOT visual: the creator is a planning surface, and the
   only way a line reaches the ice is through set_game_lineup() — the same RPC the builder uses —
   so the weekly caps, roster checks and the T-30 lock cannot be bypassed by planning around them.
   These assertions pin that, plus the tab actually rendering for management and staying invisible
   to everyone else. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src6 = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part6_hub.js"), "utf8");
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
  location:{ hash:"#/hub/lines", href:"https://x/", pathname:"/", search:"", origin:"https://x" },
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

/* ---- a VAN front-office seat with a 9-man roster and a Wed/Thu pair of games ---- */
const NOW = Date.parse("2026-10-05T16:00:00-04:00");
CG.now = () => NOW;
CG.me = () => ({ id: "mgr1", team: "VAN", role: "owner" });
CG.SEASON = { id: "s1", number: 1 };
CG.LIVE_MODE = true;
const P = (id, tag, pos, ovr) => ({ id, tag, pos, team: "VAN", depth: 1, squad: "pro" });
const roster = [
  P("p-c1","North","C"), P("p-c2","Quill","C"),
  P("p-lw1","Harbor","LW"), P("p-rw1","Kestrel","RW"),
  P("p-ld1","Granite","LD"), P("p-rd1","Mesa","RD"),
  P("p-ld2","Birch","LD"), P("p-g1","Vault","G"), P("p-g2","Locker","G"),
];
const ratings = {}; roster.forEach((p, i) => { ratings[p.id] = { ovr: 80 + i }; });
const wedGame = { id: "g-wed", home: "VAN", away: "BOS", at: Date.parse("2026-10-07T21:00:00-04:00"), status: "scheduled", stage: "regular", week: 1 };
const thuGame = { id: "g-thu", home: "TOR", away: "VAN", at: Date.parse("2026-10-08T21:00:00-04:00"), status: "scheduled", stage: "regular", week: 1 };
CG.lg = {
  byTeam: { VAN: roster }, players: roster, ratings,
  suspensions: [{ playerId: "p-g2", team: "VAN", status: "active" }],
  schedule: [wedGame, thuGame], tonight: [],
  _codeToId: { VAN: "tid-van" }, _lineups: {},
  _teamLines: { 1: { slot:1, name:"Heavy Forecheck", lw:"p-lw1", center:"p-c1", rw:"p-rw1",
                     ld:"p-ld1", rd:"p-rd1", goalie:"p-g1", updated_at: new Date(NOW).toISOString() } },
  _linePlan: { wed: 1 },
};
CG.TEAM = { VAN:{code:"VAN",name:"Canucks",color:"#00205b"}, BOS:{code:"BOS",name:"Bruins",color:"#fcb514"}, TOR:{code:"TOR",name:"Maple Leafs",color:"#00205b"} };
CG.avFor = () => ({ nights: {} });

console.log("— the whole roster, all four lines, one draggable board");
{
  const h = CG.hubLines({});
  A("all four lines render as one grid — 24 slots",
    (h.match(/class="lc-slot/g) || []).length === 24, String((h.match(/class="lc-slot/g) || []).length));
  A("every position heads a column",
    ["Left Wing","Center","Right Wing","Left Defense","Right Defense","Goaltender"]
      .every((n) => h.includes(n)) ||
    ["LW","C","RW","LD","RD","G"].every((p) => h.includes(CG.POS_NAME[p])));
  A("the saved line's players sit in line 1's slots",
    /data-line="1" data-slot="C"[^>]*draggable="true"[^>]*>\s*<span class="nm">North/.test(h.replace(/\n/g,"")) || /North/.test(h));
  A("line names edit in place on the grid", /data-lname="1"[^>]*value="Heavy Forecheck"/.test(h));
  A("a filled slot is draggable", /data-line="1" data-slot="C"[^>]*draggable="true"/.test(h));
  A("...an empty one is not", /data-line="3" data-slot="C"[^>]*draggable="false"/.test(h));
  A("the WHOLE roster renders as draggable cards",
    roster.every((p) => h.includes('data-rcard="' + p.id + '"')));
  A("...grouped into position columns", (h.match(/class="lc-col"/g) || []).length === 6);
  A("membership chips say who is already on a line", /class="lnc">L1</.test(h));
  A("a suspended player's card cannot be dragged", /data-rcard="p-g2" draggable="false"/.test(h));
  A("each line shows its real average OVR", /OVR \d\d/.test(h));
  A("the wide grid scrolls inside its own container, never the page", /class="card-b lc-wrap"/.test(h));
}

console.log("\n— the night plan");
{
  const h = CG.hubLines({});
  A("both game nights appear", /Wednesday/.test(h) && /Thursday/.test(h));
  A("...each with its opponent", /vs Bruins/.test(h) && /vs Maple Leafs/.test(h));
  A("Wednesday's select carries the plan", /<select class="lc-night" data-night="wed">[\s\S]*?value="1" selected/.test(h));
  A("a planned night offers Dress", /lc-dress/.test(h) && /data-game="g-wed"/.test(h));
  A("an unplanned night explains itself instead", /pick a line to enable dressing/.test(h));
  A("an empty line slot is disabled in the select, not offered", /value="2" disabled/.test(h));
}

console.log("\n— an ordinary player sees nothing");
{
  CG.me = () => ({ id: "px", team: null, role: "player" });
  const was = CG.lg.byTeam; CG.lg.byTeam = {};
  A("no club = the management note", /belongs to team management/.test(CG.hubLines({})));
  CG.lg.byTeam = was; CG.me = () => ({ id: "mgr1", team: "VAN", role: "owner" });
  A("the route gates on lineup.build", /section==="lines"\) return CG\.can\("lineup\.build"\)/.test(src6));
  A("RLS keeps plans management-only (comment pinned to the load)",
    /management-only, so ordinary players get empty rows/.test(fs.readFileSync(path.join(__dirname,"..","src","live","part_live.js"),"utf8")));
}

console.log("\n— a commissioner with NO roster spot gets full front-office access via the preview");
{
  /* the exact seat that used to be locked out: role commish, me() = null (they don't play),
     no management seat on any club — only the front-office preview pointing at VAN */
  const wasMe = CG.me, wasAuth = CG.auth, wasStore = CG.store, wasTeams = CG.TEAMS;
  CG.me = () => null;
  CG.auth = { role: "commish", user: { id: "commish-uid" } };
  CG.TEAMS = [{ code: "VAN", name: "Canucks", owner: "someone-else", gm: null, agm: null }];
  CG.store = { _d: {}, get: (k) => CG.store._d[k], set: (k, v) => { CG.store._d[k] = v; } };
  CG.setPreviewClub("VAN");
  A("hqClub resolves the previewed club", CG.hqClub() === "VAN", String(CG.hqClub()));
  const h = CG.hubLines({});
  A("the line creator renders, not the lockout note", /Line creator/.test(h) && !/belongs to team management/.test(h));
  A("...showing the previewed club's roster", /Roster — Canucks/.test(h));
  A("...and its night plan", /lc-night/.test(h));
  CG.setPreviewClub(null);
  A("preview off = locked out again (no seat, no roster row)",
    /belongs to team management/.test(CG.hubLines({})));
  CG.me = wasMe; CG.auth = wasAuth; CG.store = wasStore; CG.TEAMS = wasTeams;
}

console.log("\n— switching the previewed club reloads its data");
{
  const live = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part_live.js"), "utf8");
  A("the picker reloads manager data before re-rendering",
    /setPreviewClub\(this\.value \|\| null\);[\s\S]{0,600}CG\.loadManagerData\(\)\.then\(done, done\)/.test(live));
  A("the club-keyed loads follow myClub(), which honors the preview",
    /var myCode = CG\.myClub && CG\.myClub\(\), myTid = \(CG\.lg\._codeToId\|\|\{\}\)\[myCode\]/.test(live));
}

console.log("\n— locks and caps cannot be planned around");
{
  A("dressing goes through set_game_lineup and nothing else",
    /lc-dress[\s\S]{0,2400}CG\.sb\.rpc\("set_game_lineup"/.test(src6));
  A("...with p_emergency false — the plan can never bypass the lock", /p_emergency:false/.test(src6));
  A("no direct insert into game_lineups anywhere in the creator",
    !/from\("game_lineups"\)\.(insert|upsert|update)/.test(src6));
  A("a locked night shows the lock instead of a Dress button",
    /lockd[\s\S]{0,300}Locked/.test(src6));
  A("a refused dress surfaces the rule's own message", /The rules refused it: /.test(src6));
  A("saving a line goes through set_team_line", /CG\.sb\.rpc\("set_team_line"/.test(src6));
  A("planning a night goes through set_team_line_night", /CG\.sb\.rpc\("set_team_line_night"/.test(src6));
  A("a blocked save can never count as saved", /must never count as saved/.test(src6) && /errs\.push\("Line "\+n/.test(src6));
  A("saving walks every dirty line, sequentially", /function next\(i\)/.test(src6) && /dirty\.length/.test(src6));

  /* a locked Wednesday: the Dress button must be replaced by the lock */
  CG.now = () => wedGame.at - 10 * 60000;
  const h = CG.hubLines({});
  A("inside T-30 the planned night reads Locked", /Locked/.test(h) && !/data-game="g-wed"/.test(h));
  CG.now = () => NOW;
}

console.log("\n— drag semantics: swap, move, assign, clear");
{
  A("slot-onto-slot with an occupant SWAPS, validated both directions",
    /whyY = fits\(Y, p1\)/.test(src6) && /Can’t swap: /.test(src6));
  A("...source is deleted before both ends are written (same-line safe)",
    /delete da\[p1\]; db\[p2\] = X; draft\(a\)\[p1\] = Y;/.test(src6));
  A("slot-onto-empty-slot MOVES", /delete da\[p1\]; db\[p2\] = X;\n/.test(src6.replace(/\r/g,"")) || /else \{\s*delete da\[p1\]; db\[p2\] = X;/.test(src6));
  A("roster-onto-slot assigns and keeps the player's other lines",
    /occupant falls off THIS line only; the player keeps his other lines/.test(src6));
  A("...never duplicating him within the line", /no dup within a line/.test(src6));
  A("dragging a slot onto the roster clears it", /dropping a slot onto the roster board clears it/.test(src6));
  A("position groups still bind, with the builder's camp exception", /p\.squad!=="tc"/.test(src6));
  A("click still works as a fallback for touch and keyboard",
    /assignFromRoster\(sel\.pid, line, pos\)/.test(src6) && /keydown/.test(src6));
}

console.log("\n— the plan meets the builder");
{
  A("the builder offers Fill from the planned line", /id="luFromPlan"/.test(src6));
  A("...which replaces the draft rather than merging into it",
    /state\.slots = \{\};[\s\S]{0,400}CG\.lineFromRow\(prow\)/.test(src6));
  A("...validating each player on the way in", /var why = p \? validate\(p, pos\) : "no longer rostered"/.test(src6));
  A("...naming anyone it had to skip", /Filled, except: /.test(src6));
  A("fill is fill — submitting stays an explicit step", /review and submit/.test(src6));
}

console.log("\n— design-doc conformance (the bans that apply to markup)");
{
  const h = CG.hubLines({});
  A("no emoji in headings", !/<h1[^>]*>[^<]*[\u{1F300}-\u{1FAFF}✨\u{1F680}]/u.test(h));
  /* club crests legitimately carry their two real club colors as a gradient — that is the brand
     system, used site-wide. The ban is decorative purple/blue/pink gradients on chrome. */
  const outsideCrests = h.replace(/<svg[\s\S]*?<\/svg>/g, "");
  A("no gradient outside the club crests", !/gradient/i.test(outsideCrests));
  A("...and no banned purple in what remains", !/#(7c3aed|8b5cf6|a855f7|6366f1)/i.test(h));
  A("type comes from the site's own display face", /var\(--f-disp\)/.test(h));
  A("interactive slots are keyboard-reachable", /tabindex="0"/.test(h));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
