/* v4.58 (commissioner, 2026-11-23, decision D2): the current site carries "the Season 2 text the database enforces" from the
   moment the Season 2 records apply until the switch, and the classic draft room must work on December 12 if the switch
   has not landed. The site reads the season's rules from the database (public.season_rules, CG.marketOn mirrors
   public.market_on), so every Season 2 branch below stays dormant until the draft-night guards record is applied, and
   Season 1 keeps its path. Pinned here: the classic draft room on 3 F / 2 D / 1 G with no maximums (review findings 4 and
   26), the Team HQ Assistant GM door after the draft from the club's own roster, the Season 2 Waive door with the ruled
   confirm and the not-inactive confirmation (finding 27), free agency closed, the training camp pool in place of depth
   placement, the Rule 2.7 application refusals, and the rulebook as rendered.
   Second round (main-session decisions, 2026-11-23): the application waitlist gone from the website, the Season 2 waiver
   claim door on the classic Team HQ (market_claim, refusals as returned, repainted in place), the weekly limits read from
   the season's rules (null is no limit), the Waivers row in place of Free agents in the Owner's permissions, the Rule 2.7
   refusals in the database's own sentences, and the refined involuntary draw (D-INVOLUNTARY) in Rule S2.4.
   Review round (2026-11-23): Rule 2.7 consistent with "there is no exception" (an office member may play but holds no club
   seat; the sit-out waiver for an owner application filed after leaving the staff, as the commissioner approved), Rule 9.2
   without the Media clause that cited a deleted rule, Users & roles with no Media exception, and a failed season_rules read
   shown in red with a Retry on Team HQ, the draft desk and the draft room, plus one toast per load.
   Run: node tools/s2-classic-bridge-v458.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), pub = R("src/live/part5a_public.js");
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const slice = (src, from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i + 1); if (i < 0 || j < 0) throw new Error("slice anchors missing: " + from + " / " + to); return src.slice(i, j); };

console.log("# the season's rules come from the database");
{
  const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, Promise };
  ctx.CG = { _UUID_RE: /^[0-9a-f-]{36}$/ }; vm.createContext(ctx);
  vm.runInContext(slice(live, "CG.SEASON_RULES = null;", "CG.fmt = function(key, s){"), ctx);
  const CG = ctx.CG;
  A("no rules loaded: no market", CG.marketOn() === false);
  CG.SEASON_RULES = { quota: { F: 7, D: 5, G: 3 } };
  A("Season 1's rules (no market key): no market", CG.marketOn() === false);
  CG.SEASON_RULES = { market: true, quota: { F: 12, D: 12, G: 12 }, quota_min: { F: 3, D: 2, G: 1 }, camp_max: 0 };
  A("Season 2's rules after the guards record: market", CG.marketOn() === true);
  CG.lg = { draftState: { status: "live" } }; A("the draft is not complete while live", CG.draftComplete() === false);
  CG.lg.draftState.status = "complete"; A("...and complete when draft_state says so", CG.draftComplete() === true);
}
A("a full load reads season_rules for the season on screen, a delta reuses the answer",
  /var _fullBuild = !\(\(opts\.delta \|\| opts\.roster \|\| opts\.slots\) && CG\._bootCache\);/.test(live) &&
  /CG\.SEASON_RULES = await CG\.seasonRulesLoad\(season\.id, _fullBuild && season\.id !== _hintUsed\);/.test(live) &&
  /CG\.sb\.rpc\("season_rules", \{ p_season:id \}\)/.test(live));
A("a failed read is reported, never silent", /CG\.LIVE\.partial\.season_rules = String\(\(e && e\.message\) \|\| e\);/.test(live) && /console\.warn\("season_rules failed to load/.test(live));
A("Season 1 keeps the format's figures, byte for byte; a market season overrides them after",
  /CG\.ROSTER_QUOTA = Object\.assign\(\{\}, CG\.fmt\("quota", season\)\);\n  CG\.CAMP_MAX = CG\.fmt\("camp_max", season\);\n  CG\.ROSTER_MIN = null;/.test(live) &&
  /if \(CG\.marketOn\(\)\)\{\n    var _sr = CG\.SEASON_RULES;/.test(live) && /CG\.ROSTER_MIN = _sr\.quota_min \|\| null;/.test(live) && /if \(_sr\.camp_max != null\) CG\.CAMP_MAX = _sr\.camp_max;/.test(live));
A("part6 has a market stub for the prototype build (part_live installs the real one)", /if \(!CG\.marketOn\) CG\.marketOn = function\(\)\{ return false; \};/.test(hub));

console.log("\n# the classic draft room (findings 4 and 26)");
function room(opts) {
  const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON };
  const grp = (p) => (p === "G" ? "G" : p === "LD" || p === "RD" ? "D" : "F");
  const CG = ctx.CG = {
    ROSTER_QUOTA: opts.quota, ROSTER_MAX: opts.max, ROSTER_MIN: opts.min || null,
    fmt: () => null, posGroup: grp, isCamp: (p) => p.squad === "tc",
    eligOf: () => ({ ok: true }),
    draftPicksCur: () => opts.picks || [],
    lg: { byTeam: { BOS: opts.roster }, draftPool: opts.pool || [] }
  };
  vm.createContext(ctx);
  vm.runInContext(slice(live, "CG.draftFits = function(club, pos){", "CG.draftPickModalLive = function(pickId, forCode){"), ctx);
  return CG;
}
const P = (pos, extra) => Object.assign({ pos, status: "active", squad: "pro", origin: "drafted" }, extra || {});
const many = (k, pos, extra) => Array.from({ length: k }, () => P(pos, extra));
const picks = (total, used) => Array.from({ length: total }, (_, i) => ({ ownerCode: "BOS", used: i < used }));
const poolAll = [{ profileId: "f", pos: "C" }, { profileId: "d", pos: "LD" }, { profileId: "g", pos: "G" }];
const S2 = { quota: { F: 12, D: 12, G: 12 }, max: 12, min: { F: 3, D: 2, G: 1 } };
{
  const CG = room(Object.assign({}, S2, { roster: [P("C", { mgmt: "owner" }), P("LW", { mgmt: "gm" })].concat(many(5, "C")), picks: picks(10, 5), pool: poolAll }));
  A("an 8th forward fits (Owner and GM forwards plus 5 drafted): no maximum, 3 short with 4 picks left", CG.draftFits("BOS", "C") === null, CG.draftFits("BOS", "C"));
}
{
  const CG = room(Object.assign({}, S2, { roster: many(7, "C").concat(many(4, "LD")), picks: picks(10, 9), pool: poolAll }));
  A("7 F, 4 D, 0 G with one pick left: a 5th defenseman is refused, a goaltender is still needed", CG.draftFits("BOS", "LD") === "needs 1 G first", CG.draftFits("BOS", "LD"));
  A("...and the goaltender itself fits, a pick in a short group always does", CG.draftFits("BOS", "G") === null);
}
{
  const CG = room(Object.assign({}, S2, { roster: many(7, "C").concat(many(4, "LD")), picks: picks(10, 9), pool: poolAll.filter((p) => p.pos !== "G") }));
  A("D-SUPPLY: with no undrafted goaltender left, the short goaltender group does not block the pick", CG.draftFits("BOS", "LD") === null, CG.draftFits("BOS", "LD"));
}
{
  const CG = room(Object.assign({}, S2, { roster: many(9, "C").concat(many(2, "LD")), picks: picks(10, 9).concat([]), pool: poolAll }));
  CG.lg.byTeam.BOS.push(P("C", { origin: "postdraft_random" }));
  A("a full roster of twelve is full", CG.draftFits("BOS", "G") === "roster full · 12", CG.draftFits("BOS", "G"));
}
{
  const CG = room(Object.assign({}, S2, { roster: many(6, "C").concat(many(3, "LD")), picks: picks(10, 8).map((p, i) => (i === 8 ? Object.assign(p, { skipped: true }) : p)), pool: poolAll }));
  CG.lg.byTeam.BOS.push(P("RW", { origin: "postdraft_random" }));
  /* 7 F (one placed for the skipped pick), 3 D, 0 G; two unused picks, one already filled by that placement: this pick
     leaves none, so a forward cannot come before the goaltender. Counting the placed player as a pick left would allow it. */
  A("a player already placed for a skipped pick is counted against the picks left", CG.draftFits("BOS", "C") === "needs 1 G first", CG.draftFits("BOS", "C"));
}
{
  const CG = room({ quota: { F: 7, D: 5, G: 3 }, max: 15, roster: many(7, "C"), picks: picks(12, 7), pool: poolAll });
  A("Season 1 (no minimums): a group at its cap is still refused as before", CG.draftFits("BOS", "C") === "no room · 7 F", CG.draftFits("BOS", "C"));
  const card = CG.rosterRoomCard("BOS");
  A("...and its card still reads 'of 7 filled' with the cap caption", /7 of 7 filled/.test(card) && /A group at its cap cannot take another pick/.test(card));
}
{
  const CG = room(Object.assign({}, S2, { roster: [P("C", { mgmt: "owner" }), P("G", { mgmt: "gm" })], picks: picks(10, 0), pool: poolAll }));
  const card = CG.rosterRoomCard("BOS");
  A("the Season 2 card shows the minimums still needed, never 'of 7' or a cap", /at least 3/.test(card) && /2 still needed/.test(card) && /minimum met/.test(card) && !/of 7 filled|of 12 filled|A group at its cap/.test(card), card);
  A("...with the Season 2 caption", /There are no position maximums\./.test(card) && /at least 3 forwards, 2 defensemen and 1 goaltender with the spots and picks it has left \(Rule S2\.4\)/.test(card));
  A("...and no dashes in it", !DASHES.test(card));
}
A("the pick dialog's caption and chip follow the minimums in Season 2",
  /'No position maximums: after each pick your club must still be able to reach at least '\+CG\.rosterMinWords\(\)/.test(live) &&
  /title="'\+\(CG\.ROSTER_MIN \? 'Rule S2\.4: after this pick the club must still be able to reach at least '/.test(live));
A("draftFits takes the minimum path only when the season has minimums", /if \(CG\.ROSTER_MIN\) return CG\.draftMinFit\(club, pos, counted, max\);/.test(live));

console.log("\n# the Team HQ front office doors");
A("the Assistant GM seat offers no Nominate button in Season 2 until the draft is complete",
  /var agmWaits=role==="agm" && CG\.marketOn\(\) && !CG\.draftComplete\(\);/.test(live) && /:agmWaits\?'<span class="chip chip-xs">Opens after the draft<\/span>'/.test(live) &&
  /:agmWaits\?'<span class="caption">Named after the draft, from your roster<\/span>'/.test(live));
A("the nominate dialog refuses an Assistant GM before the draft is complete", /if \(mk && role==="agm" && !CG\.draftComplete\(\)\)\{ CG\.toast\("An Assistant GM is named only after the draft is complete, from your own roster \(Rule S2\.3\)","err"\); return; \}/.test(live));
A("in Season 2 the in-season picker is the active roster only, never the training camp", /return x\.spotId && !x\.mgmt && !\(CG\.isWaived && CG\.isWaived\(x\.id\)\) && !\(mk && x\.squad==="tc"\);/.test(live));
A("the GM before the draft: anyone signed up, and required", /Before the draft you name your General Manager from anyone signed up for Season 2, on your club or not \(Rule 2\.6\)\./.test(live) &&
  /Every club must hold its Owner and General Manager seats before the draft begins \(Rules 2\.8 and S2\.3\)\./.test(live));
A("the Management page opens the Assistant GM need only after the draft in Season 2", /var mk=CG\.marketOn\(\), agmOpen=!mk \|\| CG\.draftComplete\(\);/.test(live) && /var needsAgm=agmOpen && !m\.t\.agm/.test(live));

{
  const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON };
  ctx.CG = { ROSTER_MAX: 12, ROSTER_MIN: { F: 3, D: 2, G: 1 } }; ctx.esc = (x) => String(x); vm.createContext(ctx);
  vm.runInContext(slice(live, "CG.rosterMinWords = function(){", "CG.rosterRoomFor = function(club){") + slice(hub, "CG.squadsCardMarket = function(", "CG.hubRoster = function"), ctx);
  const card = ctx.CG.squadsCardMarket([1, 2, 3, 4], [], () => 1, (g) => ({ F: 3, D: 1, G: 0 })[g], (l, v, c) => "<m>" + l + " " + v + "/" + c + "</m>");
  A("Team HQ's Squads card in Season 2: each group against its minimum, no camp limit, no shape maximums",
    /defensemen \(1 LD · 1 RD\) · at least 2/.test(card) && /goaltenders · at least 1/.test(card) && /<m>active roster 4\/12<\/m>/.test(card) &&
    !/training camp holds|at most/.test(card) && /no position maximums/.test(card) && !DASHES.test(card), card);
  A("...and the roster page uses it only in a market season", /tail \+= \(CG\.marketOn\(\) && CG\.ROSTER_MIN\) \? CG\.squadsCardMarket\(proSq, tcSq, posN, grpN, meter\) : '<div class="card"/.test(hub));
}

console.log("\n# the Waive door (finding 27)");
{
  const w = slice(hub, "if (CG.LIVE_MODE && CG.marketOn()){", "    if (CG.LIVE_MODE){\n      var sx");
  A("the ruled confirm comes first: no way back until they clear waivers and reach Saturday bidding",
    /CG\.confirm\("Place "\+p\.tag\+" on waivers\?", \[\n        "Your club cannot get "\+p\.tag\+" back until they clear waivers and become available in Saturday bidding\.",/.test(w));
  A("...the claim terms, no claim back, then the pool", /any other club with an open roster spot and room under the salary cap may claim them at that salary, and the first valid claim wins at once; your club may not claim them\. Unclaimed, they join the training camp pool \(Rule S2\.5\)\./.test(w));
  A("...and what pressing Waive attests (not inactive)", /Pressing Waive confirms this player is not being waived for being inactive\./.test(w));
  A("both the Owner's queue and the direct call carry p_not_inactive", /CG\.mgmtQueue\("waive_player", \{ p_profile:pid, p_not_inactive:true \}/.test(w) && /CG\.sb\.rpc\("waive_player",\{ p_profile:pid, p_not_inactive:true \}\)/.test(w));
  A("the toast tells the waiver window, not free agency", /placed on waivers: other clubs may claim them for "\+wh\+" hours, then they join the training camp pool/.test(w) && !/sign them now|free agent/.test(w));
  A("no dashes in the Season 2 copy", !DASHES.test(w));
}
A("Season 1's waive call is unchanged", /CG\.sb\.rpc\("waive_player",\{ p_profile:pid \}\)\.then/.test(hub));
A("no club camp in Season 2: an active player gets no send-down button", /if \(CG\.marketOn\(\) && p\.squad!=="tc"\) return "";/.test(hub));

A("the transaction log lists Season 2's claim, clear and placed moves (contracts/waivers-rpc.md)",
  /CG\.TX_MOVE_TYPES = \[[^\]]*"claim","clear","placed"\];/.test(pub) && /\(t === "waive" \|\| t === "release" \|\| t === "clear"\) \? "back"/.test(pub));

console.log("\n# free agency closed: the page is Waivers in Season 2");
A("the freeagents page is listed as Waivers in a market season (the page the database gates claims on)", /if \(CG\.LIVE_MODE && CG\.can\("roster\.manage"\)\) club\.push\(\["freeagents", CG\.marketOn\(\) \? "Waivers" : "Free agents", "search"\]\);/.test(hub));
A("the page in Season 2 is the claim door and says Season 2 has no free agency", /if \(CG\.marketOn\(\)\) return '<div style="margin-bottom:20px"><span class="eyebrow chr">'\+esc\(t\.name\)\+' · player acquisition<\/span>'\+\n    '<h1 class="h-sec" style="margin-top:8px">Waivers<\/h1>'/.test(live) &&
  /CG\.mkWaiversCard\(t\)\+\n    '<div class="note">Season 2 has no free agency and no signings\./.test(live) && !/no player is placed on a club automatically/.test(live));

console.log("\n# the training camp pool in place of depth placement");
[
  ["the hub registration card", /CG\.marketOn\(\) \? 'You registered after the sign-up cutoff, so you’re not in the draft: you join the league-wide training camp pool \(Rule S2\.5\)\.'/],
  ["the draft room's eligibility card", /CG\.marketOn\(\) \? "Registered by 11:59 PM ET the day before the draft\. That is the only test \(Rule 2\.8\): anyone who registers later still plays, from the league-wide training camp pool \(Rule S2\.5\)\."/],
  ["the draft room's skipped-pick card lapses", /A pick that cannot be filled then lapses: you fill the spot by a waiver claim or in Saturday bidding \(Rule S2\.3\)\./],
  ["the office's draft card", /Nobody else is placed: the players not selected join the training camp pool \(Rule S2\.3\)\./],
  ["the season calendar", /Miss it and you still play, from the league-wide training camp pool \(Rule S2\.5\)\."/],
  ["the commissioner's Players page", /late sign-ups join the league-wide training camp pool; nobody is placed on a club as depth/],
  ["the latecomer button places nobody", /if \(CG\.marketOn\(\)\)\{ CG\.toast\("Season 2 places no late sign-ups: they join the training camp pool \(Rule S2\.5\)","err"\); return; \}/],
  ["the unused-pick button fills picks only", /In Season 2 this fills only the picks clubs never used/],
].forEach(([name, re]) => A(name, re.test(live)));
A("the canonical pool states (CG.poolState) say training camp pool in Season 2, with the same keys",
  /return _mkPool \? \{ key:"late", label:"Late sign-up: training camp pool", chip:"chip-warn" \}/.test(live) &&
  /if \(_mkPool\) return \{ key:"undrafted_fa", label:"Training camp pool", chip:"chip-warn" \};/.test(live) &&
  /label:_mkPool \? "Training camp pool" : "Free agent"/.test(live));
A("the home page banner and deadlines", /'The draft sign-up cutoff has passed: sign up now and you join the league-wide training camp pool'/.test(pub) && /"Register by now and you are in the draft\. Later sign-ups still play, from the league-wide training camp pool\."/.test(pub));

console.log("\n# Rule 2.7: the application refusals");
A("a staffer (any department) or commissioner sees the owner application refused", /var r = CG\.role\(\), lockedFromOwning = \(r==="commish" \|\| r==="staff"\);/.test(live) &&
  /A member of league staff may not submit an owner application until they step down from the staff \(Rule 2\.7\), and no staff department is exempt\./.test(live));
A("a seat holder sees the staff application refused, and the submit refuses too", /var lockedFromStaff = \(r==="staff" \|\| r==="commish" \|\| r==="mgmt"\);/.test(live) &&
  /A seat holder may not submit a staff application until they step down from the seat, whatever the department \(Rule 2\.7\)\./.test(live) &&
  /if\(r0==="mgmt"\)\{ CG\.toast\("Owners, General Managers and Assistant General Managers cannot apply to join the league staff \(Rule 2\.7\)\. Step down from your club seat first, then apply\.","err"\); return; \}/.test(live));
A("v4.58: the owner submit refuses a commissioner and a staffer in the database's own sentences (guard_app_role_conflict)",
  /if\(r0==="commish"\)\{ CG\.toast\("Commissioners cannot apply to own a club \(Rule 2\.7\)\. Step down as commissioner first, then apply\.","err"\); return; \}/.test(live) &&
  /if\(r0==="staff"\)\{ CG\.toast\("Members of the league staff cannot apply to own a club \(Rule 2\.7\)\. Leave the staff first, then apply\.","err"\); return; \}/.test(live) &&
  !/can’t own or manage a club — you can still play/.test(live));
A("v4.58: the owner form tells a commissioner to step down first, with no dash", /'A commissioner may not submit an owner application until they step down as commissioner \(Rule 2\.7\)\. It keeps roster and management decisions impartial\. You’re welcome to play as a rostered member\.'/.test(live) &&
  !/ownership applications are disabled for your role/.test(live));

console.log("\n# the rulebook, as rendered");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook;
eval(R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0]);
const rendered = CG.rulebookForFormat(rb, "basic");
const inForce = JSON.stringify(rendered.chapters.filter((c) => !c.shelved)), shelved = JSON.stringify(rendered.chapters.filter((c) => c.shelved));
const sec = (id) => (rb.chapters.flatMap((c) => c.sections || []).find((s) => s.id === id) || { paragraphs: [] }).paragraphs.join(" ");
[
  ["S2.3: ten rounds", "The draft is ten (10) rounds."],
  ["S2.3: the Owner and GM before the draft", "Every club must have its Owner and its General Manager seated before the draft begins"],
  ["S2.3: the AGM after the draft from the own roster", "An Owner may nominate their Assistant General Manager only after the draft is complete, from the players then on the club's roster, never from another club's roster or the training camp pool (Rule 2.6)."],
  ["S2.3: the in-season GM from the own roster", "From the start of the draft, a General Manager is likewise nominated only from the players on the club's own roster."],
  ["S2.3: skipped picks at random, $750K", "drawn at random from those who keep the club able to meet the minimums of Rule S2.4, and signed at the league minimum salary, $750,000"],
  ["S2.3: a pick that cannot be filled then lapses (D-FILL)", "A selection it cannot fill, because the club's roster is full or no player who was not selected keeps the club able to meet the minimums, lapses: it is not filled later, the commissioners are told"],
  ["S2.3: no depth or late placement", "there is no placement as depth, and a player who registers after the cutoff joins the training camp pool (Rule S2.5)"],
  ["S2.3: the $30M cap", "The salary cap for Season 2 is $30,000,000 (Rule 2.5)."],
  ["S2.3: the ten-round scale", "a first-round selection is paid $3,000,000 and each later round $250,000 less, down to $750,000 in the tenth (10th) round"],
  ["S2.3: seat salaries, the AGM's in place of the drafted salary", "a player named Assistant General Manager is paid the seat's $2,000,000 in place of their drafted salary while they hold the seat, never both"],
  ["S2.4: 3/2/1, no maximum", "at least three (3) forwards, two (2) defensemen and one (1) goaltender from the draft onward, through the end of the playoffs, and no position group has a maximum"],
  ["S2.4: an empty group never holds back a pick (D-SUPPLY)", "save that a position group with no player left to select does not hold back a selection in another"],
  ["S2.4: the involuntary shortfall draw, refined (D-INVOLUNTARY): only a player leaving by an act the club did not make", "A club that falls below a minimum because a player leaves its roster by an act the club did not make (a ban, a removal for a suspension that runs for the rest of the season, the player leaving the league's Discord, a sign-up the league office withdraws, or the player's removal by the league office or a commissioner) is restored by a random draw"],
  ["S2.4: a trade or a position change never owes a draw", "A trade, whoever accepts or processes it, and a change of a player's position never give rise to a draw."],
  ["S2.5: 24-hour waivers, first valid claim", "A waived player stays on waivers for twenty-four (24) hours, during which any other club may claim them at the salary they carried, if the claiming club has an open roster spot and room under the salary cap for that salary; the first valid claim is accepted at once."],
  ["S2.5: the waiving club cannot claim", "The club that placed the player on waivers may not claim them"],
  ["S2.5: no free agency", "Season 2 has no free agency and no signings"],
  ["S2.5: claims open after the skipped-pick assignment (main-session decision, 2026-11-23)", "claims open once the assignment for skipped selections under Rule S2.3 has been made, so that a claim never takes a spot a skipped selection is owed; both close at the movement deadline (Rule 2.4)."],
  ["2.1: minimums, no maximums, no club camps", "with minimums of three (3) forwards, two (2) defensemen and one (1) goaltender, no maximum in any position group and no club training camps (Rules S2.4 and S2.5)"],
  ["2.2: no free agency or depth placement", "Season 2 has no free agency, no signings and no placement as depth"],
  ["2.6: the Season 2 windows", "For Season 2, Rule S2.3 governs the windows"],
  ["2.7: the application conflict rule, in the db-apps wording", "No staff department is exempt from this rule. A commissioner or staff member shall not file an application to own a club, and a club's Owner, General Manager or Assistant General Manager shall not file an application to join the staff, until they step down from, or are removed from, the conflicting seat."],
  /* v4.58 review: the commissioner-approved exception as an objective test that matches the filing rule in 2.7[1] */
  ["2.7: an owner application filed after leaving the staff is not a sit-out", "The one-season wait does not apply to a member who leaves the staff before their owner application is decided."],
  ["2.7: an office member may play, with no club seat in the sentence", "A member of the league office who plays has access by virtue of the office to other clubs' filed lineups"],
  ["9.2: the voters, with no Media clause", "Individual awards are decided by a vote the league office runs among every rostered player and league staff. Each voter casts one vote per award"],
  ["2.8: one pass, lapsing", "For Season 2 only the first pass is made, once, when the draft concludes"],
].forEach(([name, phrase]) => A(name, inForce.indexOf(JSON.stringify(phrase).slice(1, -1)) >= 0));
[
  ["no nine rounds", "nine (9) rounds"],
  ["no 5/3/1", "five (5) forwards, three (3) defensemen"],
  ["no AGM before the draft", "nominate their General Manager and their Assistant General Manager before the draft"],
  ["no Media exception", "Media is the one department whose members may also hold"],
  ["no single exception in 2.7", "with the single exception set out below"],
  ["no Season 1 Media sentence in 2.7 (v4.58)", "applied in Season 1 only"],
  ["no old application sentence in 2.7 (v4.58)", "until that member steps down from the seat they hold"],
  ["no old involuntary wording in S2.4 (v4.58)", "through a removal it did not make itself"],
  ["no motive test in 2.7 (v4.58 review)", "in order to submit an owner application"],
  ["no office member holding a club seat in 2.7 (v4.58 review)", "or holds a club seat"],
  ["no Media ballot clause citing a deleted rule in 9.2 (v4.58 review)", "a Media staffer who is not rostered holds no ballot"],
].forEach(([name, phrase]) => A("the rendered book: " + name, inForce.indexOf(phrase) < 0));
A("Rule 2.6 carries no waitlist (ruled 2026-11-23), in either format's text", !/waitlist/i.test(sec("2.6")) &&
  !/waitlist/i.test(((rb.chapters.flatMap((c) => c.sections || []).find((s) => s.id === "2.6") || {}).full || []).join(" ")));
A("Appendix A reprints none of it (the full copies were changed alongside)", !/For Season 2|Rule S2\.|waitlist/.test(shelved));
A("not yet enforced, so not written: committees, discipline caps, pool-request visibility, back-to-back bids",
  !/committee/i.test(inForce) && !/fourteen \(14\) days/.test(sec("S2.5") + sec("S2.4")) && !/public from then/.test(inForce) && !/bid twice in a row/.test(inForce));
A("Chapter S2 and the touched sections: no dashes, no gendered pronouns",
  ["S2.3", "S2.4", "S2.5", "0.2", "0.3", "0.5", "0.6", "1.1", "2.1", "2.2", "2.5", "2.6", "2.7", "2.8", "9.2"].every((id) => !DASHES.test(sec(id)) && !/\b(he|his|him|she|her)\b/.test(sec(id))));

A("the rendered book: no section mentions Media any more (Season 2 has no Media role, 2026-10-22)", !/Media/.test(inForce));

const desk = R("src/live/part9_staffdesks.js");
const noCm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

console.log("\n# v4.58 round 2: the application waitlist is gone from the website (ruling 2026-11-23)");
A("no page shows, offers or calls the waitlist (comments that record its rulings aside)", !/waitlist/i.test(noCm(live)) && !/waitlist/i.test(noCm(desk)));
A("the Review Board keeps its board and decisions, and its after-hook wires nothing", /<h3>The board<\/h3>/.test(desk) && /<h3>Recently decided<\/h3>/.test(desk) && /CG\.AFTER\._deskReviewBoard = function\(\)\{\};/.test(desk));
A("...and the rulings that retired the auto-fill stay on record in a comment", /"The waitlist should not automatically accept someone when a position opens up"/.test(desk) && /"Waitlist applications should not fill\n     automatically"/.test(desk));
A("Recently decided: DENIED only for a denial; another status names itself, escaped", /: a\.status==="denied" \? \["chip-loss","DENIED"\] : \["chip-warn", esc\(String\(a\.status\|\|"pending"\)\.toUpperCase\(\)\)\]/.test(desk));

console.log("\n# v4.58 round 2: the weekly limits read the season's rules (null is no limit)");
{
  const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, Infinity, isFinite };
  ctx.CG = {}; vm.createContext(ctx);
  vm.runInContext(slice(live, "CG.FORMAT_RULES = {", "CG.FORMAT_NAME = ") + slice(live, "CG.seasonFormat = function(s){", "CG.SEASON_RULES = null;") +
    slice(live, "CG.SEASON_RULES = null;", "CG._rulesLoads = {};") + slice(live, "CG.weeklyCap = function(o){", "/* Rule 8.3: regular-season games a player needs"), ctx);
  const CG = ctx.CG;
  A("Season 1 (no market): 6 skaters, 6 goaltenders, 3 camp, series 4, as before", CG.weeklyCap({ pos: "C" }) === 6 && CG.weeklyCap({ pos: "G" }) === 6 && CG.weeklyCap({ squad: "tc" }) === 3 && CG.seriesCap({ pos: "C" }) === 4);
  CG.SEASON_RULES = { market: true, cap_skater: null, cap_goalie: null, cap_camp: null, _season: "s2" };
  A("Season 2 (cap_* null): no weekly limit for anyone (Infinity)", CG.weeklyCap({ pos: "C" }) === Infinity && CG.weeklyCap({ pos: "G" }) === Infinity && CG.weeklyCap({ squad: "tc" }) === Infinity);
  A("...while the playoff series limit stays four (series_cap, as public.series_cap)", CG.seriesCap({ pos: "C" }) === 4 && CG.seriesCap({ pos: "G" }) === 4);
  A("...and a season other than the one on screen keeps the format's figures", CG.weeklyCap({ pos: "C", season: { id: "s1", format: "basic" } }) === 6);
  CG.SEASON_RULES = { market: true, cap_skater: 5, _season: "s2" };
  A("...a market season's own number is read where it sets one; a missing key falls back to the format", CG.weeklyCap({ pos: "C" }) === 5 && CG.weeklyCap({ pos: "G" }) === 6);
}
{
  const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, Infinity, isFinite, esc: escH };
  ctx.CG = {}; vm.createContext(ctx);
  vm.runInContext(slice(live, "CG.weekLoadChip = function(load, size){", "/* the week, game by game, with a reason on every line."), ctx);
  const chip = ctx.CG.weekLoadChip({ used: 3, cap: Infinity, left: Infinity, full: false, filed: 1, sat: 0, forfeit: 0, pid: "p", club: "BOS", gameId: "g", tag: "T" });
  A("the week chip with no limit shows the count alone, never 'of Infinity'", />3<span class="wk-split">\+1<\/span><\/button>$/.test(chip) && !/Infinity/.test(chip) && /3 games played this week, with no weekly limit\./.test(chip), chip);
  const chip6 = ctx.CG.weekLoadChip({ used: 3, cap: 6, left: 3, full: false, filed: 0, sat: 0, forfeit: 0, pid: "p", club: "BOS", gameId: "g", tag: "T" });
  A("...and a capped week still reads 3/6", />3\/6<\/button>$/.test(chip6) && /3 of 6 games played this week\./.test(chip6), chip6);
}
A("the week ledger reads no limit the same way", /'<div class="wk-sum"><b class="num">'\+load\.used\+\(isFinite\(load\.cap\)\?' of '\+load\.cap:''\)\+'<\/b>'/.test(live));
A("the lineup check and Dress the week go through gameCapFor, so Infinity never refuses", /var cap = CG\.gameCapFor\(p, game\), used = CG\.weekGamesFor\(p\.id, game, club\);/.test(hub) && /var cap = CG\.gameCapFor\(p, wkRefD\)/.test(hub) &&
  /return \(game\.stage === "playoff"\) \? CG\.seriesCap\(o\) : CG\.weeklyCap\(o\);/.test(live));
A("the Game limits card shows one 'None' tile and the S2.7 caption when there is no weekly limit",
  /var noWeekCap = !isFinite\(CG\.weeklyCap\(\{ pos:"C" \}\)\) && !isFinite\(CG\.weeklyCap\(\{ pos:"G" \}\)\);/.test(hub) &&
  /\? '<div><b class="num" style="font-size:22px">None<\/b><span class="caption" style="display:block">weekly game limit, rostered or from the pool<\/span><\/div>'/.test(hub) &&
  /\(noWeekCap \? 'There is no weekly limit on the games a player may play this season \(Rule S2\.7\)\. '/.test(hub));

console.log("\n# v4.58 round 2: the Owner's permissions table has no Free agents page in Season 2");
{
  const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON }; ctx.CG = {}; vm.createContext(ctx);
  vm.runInContext(slice(live, "CG.MGMT_PAGES = [", "/* the Management page is the Owner's unless opened") + slice(live, "CG.mgmtPageRow = function(pg){", "/* which seat the signed-in member holds"), ctx);
  const CG = ctx.CG;
  CG.marketOn = () => false;
  A("Season 1: the row and the label read Free agents", CG.mgmtPageLabel("freeagents") === "Free agents" && CG.mgmtPageRow(CG.MGMT_PAGES[4])[1] === "Free agents");
  CG.marketOn = () => true;
  const row = CG.mgmtPageRow(CG.MGMT_PAGES.find((x) => x[0] === "freeagents"));
  A("Season 2: the same key reads Waivers, the permission market_claim reads; no Free agents page", row[0] === "freeagents" && row[1] === "Waivers" && CG.mgmtPageLabel("freeagents") === "Waivers" && /only the Owner claims/.test(row[2]) && !DASHES.test(row[2]));
  A("...and every other row is untouched", CG.mgmtPageRow(CG.MGMT_PAGES[0]) === CG.MGMT_PAGES[0]);
}
A("the permissions card draws each row through mgmtPageRow", /var rows=CG\.MGMT_PAGES\.map\(function\(pg0\)\{\n    var pg=CG\.mgmtPageRow\(pg0\);/.test(live));

console.log("\n# v4.58 round 2: the waiver claim door on the classic Team HQ");
const door = slice(live, "CG._mkWaivers = null;", "CG.AFTER._hubFreeAgents = function(){");
A("the door never resets the page and never queues a claim", !/CG\.router\(|reloadLeague|mgmtQueue/.test(door));
A("it reads market_waivers' public columns explicitly (column grants refuse select *)", /\.from\("market_waivers"\)\.select\("id,profile_id,from_team_id,position,salary,waived_at,expires_at,status"\)\s*\.eq\("season_id", sid\)\.eq\("status", "open"\)/.test(door));
A("the hub after-hook loads the door in a market season, the Season 1 board otherwise", /if \(param==="freeagents"\)\{ if \(CG\.marketOn\(\)\) CG\.mkWaiversRepaint\(\); else CG\.AFTER\._hubFreeAgents\(\); return; \}/.test(live));

console.log("\n# v4.58 review: Users & roles states Rule 2.7 as it now stands (no Media exception)");
{
  const ur = slice(live, "Role separation: commissioners/staff can't hold a club seat.", "'<div class=\"kpi\" style=\"cursor:default\"><b class=\"num\">'+profs.length+");
  A("every staffer or commissioner holding a seat is a conflict, Media-only included", /return \(pr\.role==="staff"\|\|pr\.role==="commissioner"\) && mgmtBy\[pr\.id\];/.test(ur) && !/isMediaOnly/.test(noCm(ur)));
  A("no Media exception and no 'allowed' list on the page", !/Media is the exception|running a club \(allowed\)|mediaSeated|grandfathered for Season 1\)/.test(noCm(ur)));
  A("the copy says there is no exception and states the filing rule both ways",
    /There is no exception \(Rule 2\.7\)\./.test(ur) && /Staff can’t file an owner application, and an Owner, GM or AGM can’t file a staff application, until they step down from the seat they hold \(Rule 2\.7\)\./.test(ur));
  A("the copy has no dashes", !DASHES.test(noCm(ur).replace(/"—"/g, "")));
}

console.log("\n# v4.58 review: a failed season_rules read is loud");
A("one toast per load that failed, after both places that record the failure",
  /\n  if \(CG\.LIVE\.partial\.season_rules && CG\.toast\) CG\.toast\(CG\.SEASON_RULES_FAIL, "err"\);\n  var seasonId = season \? season\.id : null;/.test(live) &&
  live.indexOf("CG.toast(CG.SEASON_RULES_FAIL") > live.indexOf('CG.LIVE.partial.season_rules = "a market season without quota'));
A("Team HQ (every hubShell page, the draft desk and the staff draft room) carries the note", /CG\.hubShell = function\(section, inner\)\{\n[^\n]*\n  var notice = CG\.seasonRulesNote \? CG\.seasonRulesNote\(\) : "";/.test(hub) && /'<div>'\+notice\+inner\+'<\/div>/.test(hub));
A("the draft room carries it under its head, on every return path", /var _rulesNote = CG\.seasonRulesNote\(\);\n  if \(_rulesNote\) head \+= '<div class="shell">'\+_rulesNote\+'<\/div>';/.test(slice(live, "CG.ROUTES.draft = function(){", "var picks = lg.draftPicks||[];")));
A("Retry never calls the router: it rebuilds through the single-flight reload (quietRepaint)", !/CG\.router\(|reloadLeague/.test(slice(live, "CG.retrySeasonRules = function(btn){", "CG.safeCount = function(resp){")));
function rulesNote(rpcReply) {
  const toasts = [], reloads = [];
  const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, Promise, Error, esc: escH };
  const CG = ctx.CG = { _UUID_RE: /^[0-9a-f-]{36}$/, SEASON: { id: "00000000-0000-0000-0000-000000000002" }, LIVE: { partial: {} },
    toast: (m, k) => toasts.push([k, m]), liveReload: (o) => reloads.push(o === undefined ? "full" : o),
    sb: { rpc: () => Promise.resolve(rpcReply) } };
  vm.createContext(ctx);
  vm.runInContext(slice(live, "CG.SEASON_RULES = null;", "CG.fmt = function(key, s){"), ctx);
  vm.runInContext(slice(live, "CG.seasonRulesNote = function(){", "CG.safeCount = function(resp){"), ctx);
  return { CG, toasts, reloads };
}
{
  const { CG } = rulesNote(null);
  A("no failure, no note", CG.seasonRulesNote() === "");
  CG.LIVE.partial.season_rules = "timeout";
  const h = CG.seasonRulesNote();
  A("a failure is a red note with the ruled sentence and a Retry", /class="note red"/.test(h) && h.indexOf("The season’s rules did not load, so limits shown may be wrong. Refresh the page.") >= 0 && /onclick="CG\.retrySeasonRules\(this\)">Retry<\/button>/.test(h));
}

(async () => {
  const NOW = Date.parse("2026-12-14T02:00:00Z");
  const rowsDb = [
    { id: "w1", profile_id: "p1", from_team_id: "t-dal", position: "LD", salary: 1250000, expires_at: new Date(NOW + 5 * 3600000 + 12 * 60000).toISOString(), status: "open" },
    { id: "w2", profile_id: "p2", from_team_id: "t-bos", position: "C", salary: 750000, expires_at: new Date(NOW + 3600000).toISOString(), status: "open" },
    { id: "w3", profile_id: "p3", from_team_id: "t-dal", position: "G", salary: 900000, expires_at: new Date(NOW - 60000).toISOString(), status: "open" }
  ];
  function harness(rpcReply, readReply) {
    const toasts = [], rpcs = [], host = { outerHTML: "" }, buttons = [];
    const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, Date, Promise, isFinite, esc: escH };
    const CG = ctx.CG = {
      SEASON: { id: "s2" }, now: () => NOW, POS_NAME: { LD: "Left Defense", C: "Center", G: "Goaltender" },
      lg: { _profName: { p1: "<b>Kane</b>", p2: "Own Guy", p3: "Gone" }, _idToCode: { "t-dal": "DAL", "t-bos": "BOS" } },
      TEAM: { BOS: { name: "Boston Bruins", id: "t-bos", code: "BOS" }, DAL: { name: "Dallas Stars", id: "t-dal", code: "DAL" } },
      fmtMoney: (v) => "$" + (v / 1e6).toFixed(2) + "M", fmtFull: () => "Dec 13 · 9:12 PM ET",
      toast: (m, k) => toasts.push([k, m]), confirm: (t, m, l, fn) => fn(),
      sb: {
        rpc: (name, args) => { rpcs.push([name, args]); return Promise.resolve(rpcReply); },
        from: (tbl) => ({ _t: tbl, select() { return this; }, eq() { return this; }, order() { return Promise.resolve(readReply || { data: rowsDb, error: null }); } })
      }
    };
    CG.myManagedTeam = () => CG.TEAM.BOS;
    ctx.document = {
      getElementById: (id) => (id === "mkWaivers" ? host : null),
      querySelectorAll: (sel) => (sel === "[data-mk-claim]" ? buttons.splice(0) : [])
    };
    vm.createContext(ctx);
    vm.runInContext(door, ctx);
    const press = (html) => {
      const m = html.match(/data-mk-claim="([^"]+)" data-name="([^"]*)" data-salary="([^"]*)"/);
      let listener = null;
      const b = { disabled: false, getAttribute: (k) => ({ "data-mk-claim": m[1], "data-name": m[2].replace(/&lt;/g, "<").replace(/&gt;/g, ">"), "data-salary": m[3] })[k], addEventListener: (e, fn) => { listener = fn; } };
      buttons.push(b); CG.mkWaiversWire(); listener.call(b); return b;
    };
    return { CG, toasts, rpcs, host, press };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  {
    const h = harness({ data: null, error: null });
    A("before the read lands the card says it is reading (never an empty list)", /Reading the waivers\./.test(h.CG.mkWaiversCard(h.CG.TEAM.BOS)));
    await h.CG.mkWaiversLoad();
    const card = h.CG.mkWaiversCard(h.CG.TEAM.BOS);
    A("the open waivers with time left: the expired one is not offered", /2 open/.test(card) && !/Gone/.test(card), card);
    A("another club's waiver has a Claim button, the player's name escaped, with salary, club and time left",
      /data-mk-claim="w1"/.test(card) && /&lt;b&gt;Kane&lt;\/b&gt;/.test(card) && !/<b>Kane<\/b>/.test(card) && /\$1\.25M/.test(card) && /from the Dallas Stars/.test(card) && /5 h 12 min left/.test(card) && /Left Defense/.test(card), card);
    A("the club's own waiver offers no Claim (no claim back)", !/data-mk-claim="w2"/.test(card) && /your club waived them: no claim back/.test(card));
    A("...and no dashes in the card", !DASHES.test(card));
  }
  {
    const h = harness({ data: null, error: null }, { data: null, error: { message: "permission denied for table market_waivers" } });
    await h.CG.mkWaiversLoad();
    const card = h.CG.mkWaiversCard(h.CG.TEAM.BOS);
    A("a failed read is said on the card, loud, never shown as no waivers", /Couldn’t read the waivers: permission denied for table market_waivers/.test(card) && !/No player is on waivers/.test(card), card);
  }
  {
    const h = harness({ data: { ok: true, waiver_id: "w1", spot_id: "rs9", team_id: "t-bos", profile_id: "p1", salary: 1250000 }, error: null });
    await h.CG.mkWaiversLoad(); h.host.outerHTML = h.CG.mkWaiversCard(h.CG.TEAM.BOS);
    h.press(h.host.outerHTML); await tick(); await tick();
    A("Claim calls market_claim directly with the waiver and the club", h.rpcs.length === 1 && h.rpcs[0][0] === "market_claim" && h.rpcs[0][1].p_waiver === "w1" && h.rpcs[0][1].p_team === "t-bos", JSON.stringify(h.rpcs));
    A("...a confirmed claim (ok and the new spot) is a green toast", h.toasts.length === 1 && h.toasts[0][0] === "ok" && /<b>Kane<\/b> claimed: they join your roster at \$1\.25M/.test(h.toasts[0][1]), JSON.stringify(h.toasts));
    A("...and the card repaints in place from a fresh read", /id="mkWaivers"/.test(h.host.outerHTML) && /2 open/.test(h.host.outerHTML));
  }
  {
    const h = harness({ data: null, error: { message: "The Dallas Stars already claimed Kane at 9:05 PM ET. The first claim wins.", hint: "already_claimed" } });
    await h.CG.mkWaiversLoad(); h.host.outerHTML = h.CG.mkWaiversCard(h.CG.TEAM.BOS);
    const b = h.press(h.host.outerHTML); await tick(); await tick();
    A("a refusal is shown exactly as the database returns it, red, and the button comes back", h.toasts.length === 1 && h.toasts[0][0] === "err" && h.toasts[0][1] === "The Dallas Stars already claimed Kane at 9:05 PM ET. The first claim wins." && b.disabled === false, JSON.stringify(h.toasts));
  }
  {
    const h = harness({ data: { ok: true }, error: null });
    await h.CG.mkWaiversLoad(); h.host.outerHTML = h.CG.mkWaiversCard(h.CG.TEAM.BOS);
    h.press(h.host.outerHTML); await tick(); await tick();
    A("fail loud: an answer without the new roster spot is not a success", h.toasts.length === 1 && h.toasts[0][0] === "err" && /did not confirm the claim/.test(h.toasts[0][1]), JSON.stringify(h.toasts));
  }

  {
    const t = rulesNote({ data: null, error: { message: "canceling statement due to statement timeout" } });
    const btn = { disabled: false, textContent: "Retry" };
    await t.CG.retrySeasonRules(btn);
    A("v4.58 review: a Retry that fails again says so, red, gives the button back and rebuilds nothing",
      t.toasts.length === 1 && t.toasts[0][0] === "err" && /still did not load: canceling statement due to statement timeout/.test(t.toasts[0][1]) &&
      btn.disabled === false && btn.textContent === "Retry" && t.reloads.length === 0 && !t.CG._rulesLoads[t.CG.SEASON.id], JSON.stringify(t.toasts));
  }
  {
    const t = rulesNote({ data: { market: true, quota: { F: 12, D: 12, G: 12 }, quota_min: { F: 3, D: 2, G: 1 }, camp_max: 0 }, error: null });
    const btn = { disabled: false, textContent: "Retry" };
    await t.CG.retrySeasonRules(btn);
    A("v4.58 review: a Retry that reads the rules runs one full rebuild, which repaints in place", t.reloads.length === 1 && t.reloads[0] === "full" && t.toasts.length === 0 && btn.disabled === true, JSON.stringify(t.reloads));
  }

  console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
  process.exit(fail ? 1 : 0);
})();
