/* v2.49 — the phone layer. Pins the structural fixes from the 390×844 audit so they cannot quietly
   regress: the hub grid's min-width guard (the root cause of every clipped Team HQ page), the
   masthead that fits, the grouped mobile menu with search and a scroll lock, the ticker as a
   flickable strip on touch, scroll-linked table shadows instead of an unconditional fade, the
   roster ledger and permissions matrix re-flowed, the line creator per line, bottom-sheet modals,
   game cards with unbreakable sides, shell gutters never wiped by a padding shorthand.
   Run: node tools/mobile-layer.test.cjs */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const css = R("src/live/part1_head.html"), ui = R("src/live/part4_ui.js"), hub = R("src/live/part6_hub.js"), pub = R("src/live/part5a_public.js"), pub2 = R("src/live/part5b_public2.js"), live = R("src/live/part_live.js");
const all = [live, hub, pub, pub2, R("src/live/part10_forums.js"), R("src/live/part9_staffdesks.js"), R("src/live/part7_admin.js")].join("\n");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the root cause: an honest hub column");
A("the hub grid's children may shrink", /\.hub-grid>\*\{min-width:0\}/.test(css));
A("the unconditional table fade is gone", !/\.tblwrap:after\{content:""/.test(css));
A("...replaced by scroll-linked shadows (background-attachment: local)", /\.tblwrap\{position:relative;\s*background:linear-gradient\(90deg,var\(--paper\) 30%,transparent\) 0 0\/40px 100% no-repeat local/.test(css));
A("the last column never hugs the edge", /\.tbl th:last-child,\.tbl td:last-child\{padding-right:14px\}/.test(css));

console.log("— chrome");
A("the phone masthead drops search and the sub-line so the burger fits", /#searchBtn\{display:none\}/.test(css) && /\.mh-brand \.wm span\{display:none\}/.test(css) && /\.mh-right\{gap:6px\}/.test(css));
A("touch controls sit on the 44px floor", /@media\(pointer:coarse\)\{[\s\S]*?\.icon-btn,\.avatar\{width:44px;height:44px\}/.test(css));
A("the burger has a distinct accessible name and the menu is a dialog", /id="burger" aria-label="Open site menu" aria-controls="mobilenav"/.test(ui) && /mnv\.setAttribute\("role","dialog"\)/.test(ui));
A("the menu leads with search and keeps the nav groups", /<button class="mn-search" type="button" data-mn-search>/.test(ui) && /\(CG\.NAV_GROUPS\|\|\[\]\)\.map\(function\(g\)\{ return '<div class="mn-g">'\+esc\(g\[0\]\)\+'<\/div>'/.test(ui));
A("...locks the page behind it and unlocks on close", /document\.body\.style\.overflow="hidden"; var fl=\$\("#mobilenav a"\)/.test(ui) && /if \(mn\.classList\.contains\("open"\)\) document\.body\.style\.overflow = "";/.test(ui));
A("...and opens the palette from its search row", /if \(e\.target\.closest\("\[data-mn-search\]"\)\)\{ CG\.closeMobileNav\(\); CG\.openPalette\(\); return; \}/.test(ui));
A("the ticker is a flickable strip on touch, the marquee on desktop", /#ticker \.tk-track\{animation:none;width:auto;overflow-x:auto;scroll-snap-type:x mandatory/.test(css) && /#ticker \.tk-track>div\[aria-hidden\]\{display:none\}/.test(css));
A("the hub sidebar is a one-row rail with the group names as dividers", /\.hub-side\{flex-wrap:nowrap;overflow-x:auto;gap:6px;margin:0 -16px/.test(css) && /\.hub-side \.hs-group\{display:flex;align-items:center;flex:none/.test(css));
A("...and the active section is scrolled into view", /\.hub-side a\.on"\); if \(on && on\.scrollIntoView && window\.innerWidth <= 720\)/.test(live));
A("the footer pairs its link groups under a spanning brand block", /footer\.site \.ft-top>div:first-child\{grid-column:1\/-1\}/.test(css) && !/@media\(max-width:430px\)\{\s*footer\.site \.ft-top\{grid-template-columns:1fr\}/.test(css) && /@media\(max-width:360px\)\{\s*footer\.site \.ft-top\{grid-template-columns:1fr\}/.test(css));
A("modals are bottom sheets on phones, with a safe-area footer", /\.modal\{top:auto;bottom:0;left:0;right:0;transform:none;width:100%;max-height:92dvh/.test(css) && /calc\(12px \+ env\(safe-area-inset-bottom\)\)/.test(css));
A("the viewport declares viewport-fit=cover so env() is real", /viewport-fit=cover/.test(css));
A("notification rows give the body the full width", /\.notif \.nf-t\{position:absolute;top:13px;right:16px;margin:0\}/.test(css));
A("card headers wrap instead of splitting a pill", /\.card-h\{flex-wrap:wrap;row-gap:8px\}/.test(css) && /\.card-h \.chip,\.card-h \.sec-link\{white-space:nowrap/.test(css));

console.log("— Team HQ re-flows");
A("the roster ledger carries data-l labels and the roster-tbl class", /class="tbl keepcols roster-tbl"/.test(hub) && /data-l="Cap"/.test(hub) && /data-l="Term"/.test(hub) && /data-l="GP"/.test(hub) && /data-l="Pos"/.test(hub));
A("...and becomes cards at ≤720 with the status row surviving the column-hiding rule", /\.tbl\.roster-tbl tr\{display:flex;flex-wrap:wrap/.test(css) && /\.tbl\.roster-tbl td:nth-child\(7\):not\(:last-child\)\{display:block/.test(css));
A("row-action clusters never stack one per line", /\.row-actions\{display:grid !important;grid-template-columns:1fr 1fr/.test(css) && (hub.match(/class="row-actions"/g)||[]).length === 2 && (live.match(/class="row-actions"/g)||[]).length === 2);
A("the permissions matrix linearizes with the seat named on each control", /data-seat="'\+esc\(sd\[1\]\+\(sd\[2\]&&names\[sd\[2\]\]\?" · "\+names\[sd\[2\]\]:""\)\)\+'"/.test(live) && /\.perm-tbl td\[data-seat\]::before\{content:attr\(data-seat\)/.test(css));
A("...and the registration bar keeps its wrapping seg alone", /@media \(max-width:760px\)\{\.reg-bar \.seg\{flex-wrap:wrap\}/.test(css));
A("the line creator re-flows per line, three slots across", /\.lc-grid\{grid-template-columns:repeat\(3,1fr\);min-width:0;gap:6px\}/.test(css) && /\.lc-slot\[data-slot\]::before\{content:attr\(data-slot\)/.test(css));
A("...with touch-aware instructions", /matchMedia\("\(pointer:coarse\)"\)\.matches\)\?'Tap a player, then tap the slot/.test(hub));
A("the game-stats desk hides its diagnostic column on phones", /class="tbl keepcols gs-tbl"/.test(live) && /hide-xs-col/.test(css));

console.log("— public pages");
A("no .shell ever gets the padding shorthand (it wiped the phone gutters)", !/class="shell" style="padding:\d/.test(all));
/* v3.10 — the card became a scoreboard: the away club reads name-then-crest so its badge sits
   beside the score, the home club crest-then-name, and each score is its own element so the phone
   can move it back beside its own club. This pin used to demand `<span class="side away">'+
   CG.crest(g.away,26)`, which is the old order at the old size. What must not break is the
   phone contract: one club per line, its own score right-aligned, and the home line saying "at". */
A("game cards keep each side as one unit", /<span class="side '\+which\+'">/.test(pub) && /which==="away" \? nm\+CG\.crest\(code,19\) : CG\.crest\(code,19\)\+nm/.test(pub));
A("...with the home line marked 'at' on phones", /\.gamecard \.gc-match \.side\.home::before\{content:"at"/.test(css));
A("...and each club's score stacked on its own row, not hidden", /\.gamecard \.gc-score\.away\{grid-column:2;grid-row:1\}/.test(css) && /\.gamecard \.gc-score\.home\{grid-column:2;grid-row:2\}/.test(css));
A("...with a grid track that can shrink below its own minimum on a narrow phone",
  /repeat\(auto-fill,minmax\(min\(540px,100%\),1fr\)\)/.test(css));
A("...and keep the status chip on phones", /\.gamecard \.gc-tag\{display:inline-flex;grid-column:2;justify-self:start;min-width:0\}/.test(css) && !/\.gamecard \.gc-tag\{display:none\}/.test(css));
A("the stat band is a 2×2 on phones", /\.statline\{display:grid;grid-template-columns:1fr 1fr;gap:0 14px\}/.test(css));
A("the club page: short tab labels, paired stat tiles, OVR beside the name", /'Roster<span class="hide-xs"> &amp; stats<\/span>'/.test(pub) && /class="grid g4 team-stats"/.test(css.length ? pub : "") && /<th class="tleft">Player<\/th>'\+\(archived\?"":'<th>OVR<\/th>'\)\+'<th>POS<\/th><th class="hide-xs-col">#<\/th>/.test(pub));
/* v2.61: the hero is a named-area grid on phones (crest + badge on the top line, the words beneath) */
A("the club hero puts crest and rating on one row", /grid-template-areas:"crest ovr" "main main"/.test(css) && /\.hero-row \.crest3d\{grid-area:crest/.test(css) && /\.hero-row \.hero-ovr\{grid-area:ovr/.test(css));
A("...the crest is phone-sized and the name cannot clip", /\.hero-row \.crest3d \.crest\{width:56px !important/.test(css) && /\.hero-main \.h-page\{font-size:clamp\(24px,7\.4vw,34px\);line-height:1\.02;overflow-wrap:anywhere/.test(css));
A("ranking cards re-flow with the commentary full width", (pub2.match(/class="card-b pr-card"/g)||[]).length === 2 && (pub2.match(/class="pr-body"/g)||[]).length === 2 && /\.pr-card \.pr-body\{grid-column:1\/-1\}/.test(css));
A("the rulebook's version history is collapsed, the contents stays first", /<details class="card rb-history"/.test(pub2) && !/\.rb-page \.hub-side\{order:2\}/.test(css));
A("the KPI grids pair up", /\.grid:has\(>\.kpi:first-child\):not\(:has\(>:not\(\.kpi\)\)\)\{grid-template-columns:1fr 1fr !important\}/.test(css));

console.log(ok ? "\nPASS" : "\nFAIL"); process.exit(ok ? 0 : 1);
