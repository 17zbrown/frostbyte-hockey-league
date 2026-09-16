/* v2.48 — the season format switch. Two formats, one seasons.format column; BASIC is the league
   standard, FULL is on the shelf. Pins: the client's CG.FORMAT_RULES equals the database's
   format_rules() (as recorded in sql/2026-09-15-season-format.sql); every reader goes through the
   format (no stray 17 / 40M / 6-goalie literals); the rulebook's basic text and its shelved full
   variants; the pure renderer that builds Appendix A; the fifteen-round pay scale; the Seasons
   editor's format select and defaults; the Season 1 calendar the book states.
   Run: node tools/season-format.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), pub2 = R("src/live/part5b_public2.js"),
      pub = R("src/live/part5a_public.js"), content = R("src/live/part3_content.js"), sql = R("sql/2026-09-15-season-format.sql");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— one table, two formats, client and database agree");
const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, Infinity, parseInt, parseFloat };
ctx.window = ctx; ctx.globalThis = ctx; ctx.CG = {}; vm.createContext(ctx);
const fmtBlock = live.slice(live.indexOf("CG.FORMAT_RULES = {"), live.indexOf("CG.GROUP_NAME = {"));
A("the format block exists in part_live.js", fmtBlock.length > 500);
vm.runInContext(fmtBlock, ctx);
const CG = ctx.CG;
const dbRules = {};
for (const f of ["basic", "full"]) {
  /* the literal ends at the closing brace right before ::jsonb — the quota object nests one level */
  /* the migration file records every version of the table — the LAST literal is the one in force */
  const all = [...sql.matchAll(new RegExp('\\{"format":"' + f + '"[\\s\\S]*?\\}\'::jsonb', 'g'))];
  const m = all.length ? all[all.length - 1] : null;
  A("the SQL records the " + f + " rules", !!m);
  if (m) dbRules[f] = JSON.parse(m[0].slice(0, -"'::jsonb".length).replace(/\s+/g, ""));
}
for (const f of ["basic", "full"]) {
  const a = CG.FORMAT_RULES[f], b = dbRules[f] || {};
  const keys = Object.keys(a).sort();
  A(f + ": the client and database key sets match", JSON.stringify(keys) === JSON.stringify(Object.keys(b).sort()), JSON.stringify(Object.keys(b).sort()));
  A(f + ": every value matches", keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k])), keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).join(","));
}
A("basic is the standard (v2.51 layout): 15 = two lines + three flex (caps 9 F / 7 D / 5 G), camp unlimited, everyone 6 a week (camp 3), 4 a series, 18-GP floor, $50M, 6 weeks, deadline week 4, 15 snake rounds, 1-season deals, no extensions/rights/picks/pre-season/FA, top 3, best of 7",
  CG.FORMAT_RULES.basic.roster_max === 15 && CG.FORMAT_RULES.basic.lines === 2 && CG.FORMAT_RULES.basic.flex === 3 && CG.FORMAT_RULES.basic.quota.F === 9 && CG.FORMAT_RULES.basic.quota.D === 7 && CG.FORMAT_RULES.basic.quota.G === 5 &&
  CG.FORMAT_RULES.basic.camp_max === 999 && CG.FORMAT_RULES.basic.cap_skater === 6 && CG.FORMAT_RULES.basic.cap_camp === 3 && CG.FORMAT_RULES.basic.series_cap === 4 && CG.FORMAT_RULES.basic.playoff_min_gp === 18 &&
  CG.FORMAT_RULES.basic.salary_cap === 50000000 && CG.FORMAT_RULES.basic.weeks === 6 &&
  CG.FORMAT_RULES.basic.trade_deadline_week === 4 && CG.FORMAT_RULES.basic.draft_rounds === 15 && CG.FORMAT_RULES.basic.draft_snake === true && CG.FORMAT_RULES.basic.max_contract_years === 1 &&
  !CG.FORMAT_RULES.basic.extensions && !CG.FORMAT_RULES.basic.rights && !CG.FORMAT_RULES.basic.pick_trades && !CG.FORMAT_RULES.basic.preseason && !CG.FORMAT_RULES.basic.fa_window &&
  CG.FORMAT_RULES.basic.playoff_per_div === 3 && CG.FORMAT_RULES.basic.playoff_best_of === 7 && CG.FORMAT_RULES.basic.cap_goalie === 6);
A("full is the shelf: 17 = 9/6/2, $40M, 8 weeks, deadline week 6, 14 linear rounds, 3-season deals, goaltenders 6, top 4",
  CG.FORMAT_RULES.full.roster_max === 17 && CG.FORMAT_RULES.full.quota.G === 2 && CG.FORMAT_RULES.full.salary_cap === 40000000 && CG.FORMAT_RULES.full.weeks === 8 &&
  CG.FORMAT_RULES.full.trade_deadline_week === 6 && CG.FORMAT_RULES.full.draft_rounds === 14 && !CG.FORMAT_RULES.full.draft_snake && CG.FORMAT_RULES.full.max_contract_years === 3 &&
  CG.FORMAT_RULES.full.cap_goalie === 6 && CG.FORMAT_RULES.full.playoff_per_div === 4 && CG.FORMAT_RULES.full.series_cap === null && CG.FORMAT_RULES.full.playoff_min_gp === 0);
A("full: the roster shape adds up to roster_max", (function(){ const r = CG.FORMAT_RULES.full; return r.quota.F + r.quota.D + r.quota.G === r.roster_max; })());
A("basic: two lines plus three flex fit inside every group cap (6+3 F, 4+3 D, 2+3 G) and the total binds", (function(){ const r = CG.FORMAT_RULES.basic; return r.quota.F === 3*r.lines+r.flex && r.quota.D === 2*r.lines+r.flex && r.quota.G === r.lines+r.flex && r.roster_max === 6*r.lines+r.flex; })());
A("basic goaltending covers a nine-game week with room (2 G x 6 games)", CG.FORMAT_RULES.basic.lines * CG.FORMAT_RULES.basic.cap_goalie >= 9);
A("the series cap and the floor read through the helpers", CG.seriesCap({ pos:"G", season:{ format:"basic" } }) === 4 && CG.seriesCap({ squad:"tc", season:{ format:"basic" } }) === 4 && CG.seriesCap({ pos:"G", season:{ format:"full" } }) === 6 && CG.seriesCap({ pos:"C", season:{ format:"full" } }) === 3 && CG.playoffMinGp({ format:"basic" }) === 18 && CG.playoffMinGp({ format:"full" }) === 0);
A("the composition in words", CG.rosterShapeWords({ format:"basic" }) === "two full lines plus three players of any position" && CG.rosterShapeWords({ format:"full" }) === "9 F / 6 D / 2 G");

console.log("\n— the helpers");
A("anything but 'full' is basic", CG.seasonFormat({}) === "basic" && CG.seasonFormat({ format: "basic" }) === "basic" && CG.seasonFormat({ format: "full" }) === "full" && CG.seasonFormat(null) === "basic");
A("CG.fmt reads the season passed in", CG.fmt("roster_max", { format: "full" }) === 17 && CG.fmt("roster_max", { format: "basic" }) === 15);
A("weeklyCap: basic 6/6/3", CG.weeklyCap({ pos: "G", season: { format: "basic" } }) === 6 && CG.weeklyCap({ pos: "C", season: { format: "basic" } }) === 6 && CG.weeklyCap({ squad: "tc", season: { format: "basic" } }) === 3);
A("weeklyCap: full 3 skater / 6 goalie / 3 camp / uncapped pre-season", CG.weeklyCap({ pos: "G", season: { format: "full" } }) === 6 && CG.weeklyCap({ pos: "C", season: { format: "full" } }) === 3 && CG.weeklyCap({ squad: "tc", pos: "G", season: { format: "full" } }) === 3 && CG.weeklyCap({ pos: "G", stage: "preseason", season: { format: "full" } }) === Infinity);
A("...and the basic pre-season is not a thing (no exemption)", CG.weeklyCap({ pos: "G", stage: "preseason", season: { format: "basic" } }) === 6);
A("spots outside the shape: loans (full) and depth (basic), never management", CG.spotOutsideShape({ origin: "depth_random" }) && CG.spotOutsideShape({ origin: "preseason_random" }) && CG.spotOutsideShape({ origin: "latecomer_random" }) && !CG.spotOutsideShape({ origin: "assigned" }) && !CG.spotOutsideShape({ origin: "depth_random", mgmt: "gm" }));
A("the default quota before a season loads is the standard's", CG.ROSTER_QUOTA.G === 5 && CG.CAMP_MAX === 999);

console.log("\n— every reader goes through the format (no stray literals)");
A("the season load derives cap / roster / quota / camp from the format", /CG\.CAP = \(season && season\.salary_cap\) \? season\.salary_cap : CG\.fmt\("salary_cap", season\);/.test(live) && /CG\.ROSTER_QUOTA = Object\.assign\(\{\}, CG\.fmt\("quota", season\)\);/.test(live) && /CG\.CAMP_MAX = CG\.fmt\("camp_max", season\);/.test(live));
A("no `|| 17` roster fallback survives in the live client", !/\|\|\s*17\b/.test(live + hub + pub + pub2));
A("no `? 6 : 3` goalie cap survives", !/\? 6 : 3/.test(live + hub + pub + pub2));
A("the Squad Room reads the quota and camp size", /cap = CG\.ROSTER_QUOTA\[grp\]/.test(hub) && /< CG\.CAMP_MAX;/.test(hub) && !/CG\.SQUAD_CAPS/.test(hub));
A("the Squads meter caps camp at CG.CAMP_MAX and goaltenders at the quota", /meter\("training camp",tcSq\.length,CG\.CAMP_MAX>=999\?null:CG\.CAMP_MAX\)/.test(hub) && /meter\("goaltenders",grpN\("G"\),qG\)/.test(hub) && /meter\("active roster",proSq\.length,CG\.ROSTER_MAX\)/.test(hub));
A("the line creator's goalie rule follows the weekly cap", /var gMax = Math\.max\(1, Math\.floor\(CG\.weeklyCap\(\{ pos:"G" \}\) \/ 3\)\);/.test(hub));
A("the playoff series flag follows the weekly cap", /CG\.weeklyCap\(\{ pos: isGoalie \? "G" : "C", stage:"playoff" \}\)/.test(pub2));
A("playoffs: per-division and series length are the format's in basic", /if \(CG\.isBasic\(\)\) return CG\.fmt\("playoff_per_div"\);/.test(live) && /if \(CG\.isBasic\(\)\) return CG\.fmt\("playoff_best_of"\);/.test(live));
A("Road to N is empty without a pre-season; eligibility is the cutoff alone in basic", /if \(!CG\.fmt\("preseason"\)\) return out;/.test(live) && /if \(CG\.isBasic\(_sR\)\) return true;/.test(live));
A("rights classes only exist in full", /if \(CG\.fmt\("rights"\) && served > 0/.test(live));
A("trades: picks are not assets in basic", /if \(!CG\.fmt\("pick_trades"\)\) return \[\];/.test(live) && /Draft picks are not traded in the basic format — trade players only \(Rule 2\.3\)/.test(live));
A("term selects follow the format", (live.match(/\[1,2,3\]\.slice\(0, CG\.fmt\("max_contract_years"\)\)/g) || []).length === 4 && /\[1,2,3\]\.slice\(0, CG\.fmt\("max_contract_years"\)\)/.test(hub));
A("the draft board is built to the format's round count, snake copy gated", /var rounds = CG\.fmt\("draft_rounds"\);/.test(live) && /\["as_drawn","Keep the drawn order"/.test(live) && /CG\.fmt\("draft_snake"\)\?CG\.fmt\("draft_rounds"\)\+' rounds in a snake/.test(live));
A("Rule 2.9 in basic is the sign-up cutoff", /if \(CG\.isBasic\(\)\)\{\s*var s0 = CG\.SEASON \|\| \{\}, dl0 = s0\.signup_deadline_at \|\| s0\.registration_deadline;/.test(live));

console.log("\n— the Seasons editor");
A("a Format select, first in the form", /<select id="ssFormat">/.test(live) && /CG\.FORMAT_NAME\[f\]/.test(live));
A("new seasons default to the standard", /format:"basic",\s*salary_cap:CG\.FORMAT_RULES\.basic\.salary_cap, roster_max:CG\.FORMAT_RULES\.basic\.roster_max,/.test(live));
A("roster_max is the format's, never typed", /roster_max:fr\.roster_max,/.test(live) && /id="ssRoster" type="number" min="6" max="30" value="'\+\(s\.roster_max\|\|CG\.fmt\("roster_max", s\)\)\+'" readonly/.test(live));
A("Auto-space has a basic path spaced from draft night", /if \(fmtSel\.value === "basic"\)\{/.test(live) && /the Thursday strictly before/.test(live) && /the Wednesday strictly after/.test(live));
A("a basic season refuses pre-season / free-agency dates on save", /A basic-format season has no pre-season or free-agency window/.test(live));
A("the format travels with the save", /status:document\.getElementById\("ssStatus"\)\.value, format:fmtV,/.test(live));

console.log("\n— the rulebook: basic binding, full shelved");
const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
const find = (id) => { for (const c of rb.chapters) for (const s of c.sections) if (s.id === id) return s; throw new Error("no " + id); };
const sec = (id) => find(id).paragraphs.join(" "), secFull = (id) => (find(id).full || find(id).paragraphs).join(" ");
const shelved = ["0.2","0.3","0.4","0.5","0.6","0.7","0.8","0.9","1.1","2.1","2.2","2.3","2.4","2.5","2.6","2.8","2.9","3.1","5.2","8.1","8.3"];
A("every format-dependent section carries a full variant", shelved.every((id) => Array.isArray(find(id).full) && find(id).full.length > 0), shelved.filter((id) => !find(id).full).join(","));
A("...and no other section does", rb.chapters.every((c) => c.sections.every((s) => shelved.includes(s.id) || !s.full)));
A("0.1 explains the two formats and Appendix A", /basic format is the league standard/.test(sec("0.1")) && /full format/.test(sec("0.1")) && /Appendix A/.test(sec("0.1")));
A("2.1: season-settings roster shape, management inside, depth outside the shape", /determine, for each season, the size of the active roster and its composition by position group/.test(sec("2.1")) && /shall publish these figures to the clubs before that season's draft/.test(sec("2.1")) && /counted within the published composition in their own position groups/.test(sec("2.1")) && /counts against neither the published composition nor any roster limit/.test(sec("2.1")));
A("2.1 (shelved): seventeen, two goaltenders, loans", /seventeen \(17\) players/.test(secFull("2.1")) && /two \(2\) goaltenders/.test(secFull("2.1")) && /Pre-season loans are the one exception/.test(secFull("2.1")));
A("2.8: rounds a season setting, snake, random every season, cutoff is the whole test, no pick trading, depth placement", /commissioner shall determine the number of rounds for each season's draft/.test(sec("2.8")) && /bears no relation to the previous season/.test(sec("2.8")) && /registration by the cutoff is the sole test/.test(sec("2.8")) && /Draft picks are not club assets under the basic format/.test(sec("2.8")) && /as depth \(Rule 2\.1\)/.test(sec("2.8")));
/* the pay scale is now a formula, not fifteen fixed figures — the round count itself is a season setting */
A("...the draft pay scale is a formula on the $750K floor and $250K increment, published with the round count", /round N pays \$750,000 and round one pays \$750,000 plus \$250,000 multiplied by \(N − 1\)/.test(sec("2.8")) && /league minimum salary is \$750,000/.test(sec("2.5")) && /multiple of \$250,000 above it/.test(sec("2.5")) && /published with the round count/.test(sec("2.8")));
A("...every selection in a round carries an identical cap hit", /Every selection in a round carries an identical cap hit/.test(sec("2.8")));
A("2.8 (shelved) keeps fourteen rounds, the lottery and pick trading, with the five-game slip corrected", /fourteen \(14\) rounds/.test(secFull("2.8")) && /NHL-style draft lottery/.test(secFull("2.8")) && /Draft picks are club assets/.test(secFull("2.8")) && !/five-game/.test(secFull("2.8")) && /three-game/.test(secFull("2.8")));
A("0.6 (shelved) also corrected", !/five-game/.test(secFull("0.6")));
A("2.2: no market, waived players signable from the draft's conclusion, no rights classes", /no free-agency period and no open market/.test(sec("2.2")) && /From the conclusion of the draft until the movement deadline/.test(sec("2.2")) && /The basic format recognizes no classes of player rights/.test(sec("2.2")));
A("2.3: players only", /Draft picks are not tradeable assets in the basic format/.test(sec("2.3")));
A("2.4: midnight after the Friday of the fourth game week; registration for the next season opens", /Friday of the fourth \(4th\) game-week/.test(sec("2.4")) && /Registration for the following season opens when the deadline passes/.test(sec("2.4")));
A("2.5: one-season deals, no extensions, no held rights, the cap year is the season", /term of one \(1\) season/.test(sec("2.5")) && /no contract extension, no re-signing and no retained player rights/.test(sec("2.5")) && /The cap year is the season/.test(sec("2.5")) && /\{\{CAP\}\}/.test(sec("2.5")));
A("2.6: a manager holds a roster spot in the published composition", /holds one of the club's active-roster spots in his own position group within the published composition \(Rule 2\.1\)/.test(sec("2.6")));
A("2.9: the sign-up cutoff", /Position changes close at the sign-up cutoff/.test(sec("2.9")));
A("3.1 stored clause states the live shape (six weeks, 54)", /runs six \(6\) game-weeks/.test(sec("3.1")) && /for 54 games per club/.test(sec("3.1")));
A("5.2: active players six a week, camp three, the playoff cap takes over in the playoffs", /No active-roster player — skater or goaltender — may be dressed in more than six \(6\) games in a game-week/.test(sec("5.2")) && /Training-camp players are subject to a cap of three \(3\) games in a game-week/.test(sec("5.2")) && /In the playoffs the cap of Rule 8\.3 applies in its place/.test(sec("5.2")));
A("5.1: no availability quota", /The league sets no weekly availability quota beyond the appearance cap of Rule 5\.2/.test(sec("5.1")) && !/at least six \(6\) of the week/.test(sec("5.1")));
A("8.1: top three, six-club field, the first seed byes", /top three \(3\) clubs in each division/.test(sec("8.1")) && /six-club field/.test(sec("8.1")) && /first seed receives a bye through the opening round/.test(sec("8.1")));
A("8.3: best-of-seven 2-2-3, three a series for everyone, byes", /best-of-seven series played within a single game-week in a 2-2-3 format/.test(sec("8.3")) && /no player — skater, goaltender or training-camp player — may be dressed in more than four \(4\) games of a single series/.test(sec("8.3")) && /appeared in at least eighteen \(18\) regular-season games/.test(sec("8.3")) && /first seed plays no series in the opening week/.test(sec("8.3")));
A("0.4/0.6 carry their shelved titles", find("0.4").fullTitle === "Step three — the pre-season" && find("0.6").fullTitle === "Step five — rookie placement and free agency" && find("0.4").title === "Step three — draft week");
A("10.1 defines Season format and Depth", /“Season format” means/.test(sec("10.1")) && /“Depth” or “depth placement” means/.test(sec("10.1")));
A("the 2.48 changelog entry exists and the head is at least 2.48", (() => { const e = rb.changelog.find((c) => c.version === "2.48"); return !!e && /Saturday September 19/.test(e.summary) && /puck drop Wednesday September 23/.test(e.summary) && /playoffs from November 4/.test(e.summary) && parseFloat(rb.changelog[0].version) >= 2.48; })());
A("American spelling throughout the basic text", !/practis|colour|centre|organis|defence|favour/i.test(shelved.map(sec).join(" ") + sec("0.1") + sec("10.1")));

console.log("\n— the renderer: pure, and the appendix carries the other format");
const rctx = { console, Object, Array, JSON, String }; rctx.CG = { CONTENT: { rulebook: rb } }; vm.createContext(rctx);
vm.runInContext(pub2.match(/CG\.rulebookForFormat = function[\s\S]*?\n\};/)[0], rctx);
const before = JSON.stringify(rb);
const basicBook = rctx.CG.rulebookForFormat(rb, "basic"), fullBook = rctx.CG.rulebookForFormat(rb, "full");
A("the input rulebook is never mutated", JSON.stringify(rb) === before);
const appx = (b) => b.chapters.find((c) => c.num === "A");
A("basic: chapters 0–10 bind, Appendix A holds the full variants", basicBook.format === "basic" && appx(basicBook) && appx(basicBook).shelved && appx(basicBook).sections.length === shelved.length && /full format — on the shelf/.test(appx(basicBook).title));
A("...numbered A.<id> with the shelved text", appx(basicBook).sections.every((s) => /^A\./.test(s.id)) && appx(basicBook).sections.find((s) => s.of === "2.1").paragraphs.join(" ").includes("seventeen (17) players"));
A("...and the binding 2.1 is the basic one", basicBook.chapters[2].sections.find((s) => s.id === "2.1").paragraphs.join(" ").includes("determine, for each season, the size of the active roster"));
A("full: the roles swap — 2.1 binds with seventeen, Appendix A holds the basic text", fullBook.format === "full" && fullBook.chapters[2].sections.find((s) => s.id === "2.1").paragraphs.join(" ").includes("seventeen (17) players") && appx(fullBook).sections.find((s) => s.of === "2.1").paragraphs.join(" ").includes("determine, for each season, the size of the active roster") && /basic format/.test(appx(fullBook).title));
A("...with the shelved titles restored for the full book", fullBook.chapters[0].sections.find((s) => s.id === "0.4").title === "Step three — the pre-season");
A("the page head names the format and the appendix", /This season runs the basic format — the league standard; the full format is preserved in Appendix A\./.test(pub2) && /rb-shelved/.test(pub2));

console.log("\n— the public surfaces follow the format");
A("home: the timeline drops the pre-season row and says snake in basic", /CG\.fmt\("preseason"\) \? sD\.preseason_starts_at : null/.test(pub) && /CG\.fmt\("draft_snake"\) \? CG\.fmt\("draft_rounds"\)\+" rounds, snake order, live on the site"/.test(pub));
A("standings hero: the spots-per-division is read, not stated", /playoff spots per division/.test(pub) && !/Three playoff spots per division/.test(pub));
A("the live bracket names rounds from the generator's function and shows byes", /CG\.playoffRoundName\(rd\)/.test(pub) && /BYE<\/span>/.test(pub));

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
