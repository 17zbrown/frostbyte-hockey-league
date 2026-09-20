#!/usr/bin/env node
/* v2.68 — the draft room's prospect pool is searchable, and the site points players at the room on draft night. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const live = fs.readFileSync(path.join(root, "src/live/part_live.js"), "utf8");
const hub  = fs.readFileSync(path.join(root, "src/live/part6_hub.js"), "utf8");
const pub  = fs.readFileSync(path.join(root, "src/live/part5a_public.js"), "utf8");
let fails = 0;
function A(name, cond){ console.log((cond ? "ok   " : "FAIL ") + name); if (!cond) fails++; }

console.log("— the room pool has a search box and position chips that repaint the list alone");
A("search input above the room pool", /id="roomSearch" placeholder="Search gamertag, EA ID or position…"/.test(live));
A("position chips", /data-room-pos="'\+px\+'"/.test(live) && /\["ALL","C","LW","RW","LD","RD","G"\]\.map\(function\(px\)\{\s*var on = px===CG\._roomUI\.pos;/.test(live));
A("the filter survives a realtime repaint (kept in CG._roomUI)", /CG\._roomUI = CG\._roomUI \|\| \{ q:"", pos:"ALL" \};/.test(live));
A("typing repaints only the list", /rs\.addEventListener\("input", function\(\)\{ CG\._roomUI\.q = this\.value; CG\._poolPage\.room = 0; rerenderRoomPool\(\); \}\)/.test(live) && /el\.innerHTML = CG\._roomPoolRows\(CG\.lg\.draftPool\|\|\[\]\); CG\.wirePoolPager\(el, rerenderRoomPool\);/.test(live));

console.log("— CG._roomPoolRows filters on gamertag, EA ID and position, keeps whole-pool ranks");
{
  const m = live.match(/CG\._roomPoolRows = function\(pool\)\{[\s\S]*?\n\};\n/);
  A("the row builder exists", !!m);
  if (m){
    const ctx = { CG: { _roomUI:{ q:"", pos:"ALL" }, POS_NAME:{ C:"Center", LW:"Left wing", RW:"Right wing", LD:"Left defense", RD:"Right defense", G:"Goaltender" },
      poolPager: function(){ return ""; }, poolSlice: function(n, l){ return l; }, lg:{ preGp:{} }, eligOf: function(){ return { vet:true }; }, PRESEASON_MIN_GP:3 },
      esc: function(s){ return String(s); } };
    vm.createContext(ctx); vm.runInContext(m[0], ctx);
    const pool = [ { tag:"Sn1p3r_Kid", eaId:"snipes99", pos:"C", profileId:"a" }, { tag:"WallOfGlass", eaId:"wall-ea", pos:"G", profileId:"b" }, { tag:"DangleMan", eaId:null, pos:"LW", profileId:"c" } ];
    const rows = (q, pos) => { ctx.CG._roomUI = { q, pos }; return ctx.CG._roomPoolRows(pool); };
    A("empty filter lists everyone", (rows("", "ALL").match(/leaderrow/g)||[]).length === 3);
    A("gamertag match, case-insensitive", /Sn1p3r_Kid/.test(rows("sn1p", "ALL")) && !/WallOfGlass/.test(rows("sn1p", "ALL")));
    A("EA ID match", /WallOfGlass/.test(rows("wall-ea", "ALL")) && (rows("wall-ea", "ALL").match(/leaderrow/g)||[]).length === 1);
    A("position name match", /WallOfGlass/.test(rows("goaltender", "ALL")) && !/DangleMan/.test(rows("goaltender", "ALL")));
    A("position chip", (rows("", "LW").match(/leaderrow/g)||[]).length === 1 && /DangleMan/.test(rows("", "LW")));
    A("a filtered row keeps its rank in the whole pool", /<span class="rk num">3<\/span>/.test(rows("", "LW")));
    A("the count note appears only when filtering", /2 of 3 match|1 of 3 match/.test(rows("", "LW")) && !/of 3 match/.test(rows("", "ALL")));
    A("no match says so", /No available prospect matches “zzz”\./.test(rows("zzz", "ALL")));
  }
}

console.log("— draft night is findable by players: a front-page strip and a dashboard card link to #/draft");
A("the helper exists and is silent once the draft is complete", /CG\.draftNightBand = function\(where\)\{/.test(live) && /if \(status === "complete"\) return "";/.test(live));
A("...shown while live or paused, or from draft-day morning", /live = status === "live" \|\| status === "paused";/.test(live) && /now >= at - 18\*3600000 && now < at \+ 12\*3600000/.test(live));
A("the front page carries the big hero button, not a strip (one door, not two)", /\(CG\.draftNightBand \? CG\.draftNightBand\("hero"\) : ""\)\+/.test(pub) && !/CG\.draftNightBand\("home"\)/.test(pub) && /id="heroDraftCta" class="btn btn-chrome hero-cta"/.test(live));
A("...and checks once a minute whether the draft is still on, removing the button in place when it completes", /CG\._draftCtaPoll = setInterval\(/.test(pub) && /from\("draft_state"\)\.select\("season_number,status"\)/.test(pub) && /if \(cta\) cta\.outerHTML = next;/.test(pub));
A("the dashboard renders it for non-management", /if \(CG\.draftNightBand && !\(CG\.managesClub && CG\.managesClub\(\)\)\)\{ var dnb = CG\.draftNightBand\("hub"\); if \(dnb\) cards\.push\(dnb\); \}/.test(hub));
A("both link to the room", (live.match(/href="#\/draft"/g)||[]).length >= 2);

console.log("— v2.69: the board is one round per page, landing on the live round, following the clock until pinned");
A("a round strip with one tab per round, the live round dotted", /class="rtabs" role="tablist" aria-label="Draft rounds"/.test(live) && /data-room-round="'\+rn\+'" aria-selected="'\+on\+'"/.test(live) && /isLive\?'<span class="live-dot"><\/span>':''/.test(live));
A("the view follows the clock unless the visitor pinned a round", /var pinned = CG\._roomUI\.round != null && roundList\.indexOf\(CG\._roomUI\.round\) >= 0;/.test(live) && /var viewRound = pinned \? CG\._roomUI\.round : \(liveRound \|\| \(dstatus==="complete" \? roundList\[roundList\.length-1\] : roundList\[0\]\)\);/.test(live));
A("only that round's picks are in the table", /var roundRows = cur\.filter\(function\(p\)\{ return p\.round===viewRound; \}\);/.test(live) && /roundRows\.map\(function\(p\)\{/.test(live) && !/\n    cur\.map\(function\(p\)\{\n      var isCurrent/.test(live));
A("a Live round chip brings a pinned visitor back to the clock", /data-room-round="live"/.test(live) && /CG\._roomUI\.round = v==="live" \? null : parseInt\(v,10\);/.test(live));
A("previous / next round under the table, honest at the ends", /'‹ First round'/.test(live) && /'Last round ›'/.test(live));
A("wired for spectators too, before the early return", /CG\.wireRoundPages\(\);\n  if \(role!=="mgmt" && role!=="commish" && role!=="staff"\)\{/.test(live));

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
