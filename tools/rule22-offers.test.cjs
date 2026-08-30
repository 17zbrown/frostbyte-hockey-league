/* Rule 2.2 free agency as a negotiation, Rule 2.3 trade review, Rule 5.2 pre-season uncapping.
   Run: node tools/rule22-offers.test.cjs

   Commissioner rulings (2026-08-29): a club offers, the player accepts, and the move passes —
   the league office confirms nothing. Transactions staff may send a completed trade back if it
   is not a natural hockey deal. Pre-season appearances are uncapped.

   The DB half is pinned by rolled-back rehearsals against production, which verified:
     · offers before free agency opens are refused; an offer moves nothing until accepted;
       a stranger cannot accept another player's offer ("awaiting the player");
     · the PLAYER accepting is the whole signing — roster spot, contract, registration flipped to
       'assigned', and a transaction row, with no league-office step;
     · a second club offering an already-rostered player is refused;
     · reverse_trade: refused for a club manager ("only the transactions department"), refused for
       a too-short reason, and a clean reversal put the player back on his original club and logged
       it publicly;
     · set_game_lineup dressed the SAME skater in 5 pre-season games (the cap was 3) while the
       regular season still refuses the 4th with the Rule 5.2 message;
     · guard_registration_columns silently reverted the registration status for BOTH signing paths
       (a pre-existing bug in sign_free_agent) until they raised the trusted-writer GUC. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js");
const desks = R("src/live/part9_staffdesks.js");
const content = R("src/live/part3_content.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the club offers, it does not sign");
{
  A("the free-agent board calls offer_free_agent", /rpc\("offer_free_agent",\{ p_registration:regId, p_salary:sal, p_years:yrs, p_note:note \}\)/.test(live));
  A("...and no longer signs unilaterally from the board", !/rpc\("sign_free_agent",\{ p_registration:regId/.test(live));
  A("the button says Offer", />Offer<\/button>/.test(live));
  A("the modal collects salary, term and a note", /id="faSal"/.test(live) && /id="faYears"/.test(live) && /id="faNote"/.test(live));
  A("the copy says the player decides", /You offer, the player decides \(Rule 2\.2\)/.test(live));
}

console.log("\n— the player decides, from his own dashboard");
{
  A("offers load for the signed-in player", /CG\.loadMyOffers = function\(\)/.test(live));
  A("...only the live ones", /\.in\("status", \["pending","countered"\]\)/.test(live));
  A("...and are cleared on sign-out", /CG\._myOffers = null; CG\._myOffersFp = "";/.test(live));
  A("the card renders on every dashboard variant",
    (live.match(/offers \+ _hubDashboardProto\(\)/g)||[]).length === 1 &&
    (live.match(/offers \+ CG\._mgmtDashboard\(mt\)/g)||[]).length === 1 &&
    /roster spot\.<\/p><\/div>'\+offers;/.test(live));
  A("accept / counter / decline are wired", /data-offer-accept/.test(live) && /data-offer-counter/.test(live) && /data-offer-deny/.test(live));
  A("...through respond_offer, from both sides", (live.match(/rpc\("respond_offer"/g)||[]).length === 6);
  A("...and bound before the hub's sub-page early returns", /if \(CG\.wireOfferActions\) CG\.wireOfferActions\(\);\n  if \(param==="messages"\)/.test(live));
  A("a counter cannot go below the league minimum", /Salary must be at least \$0\.75M/.test(live));
  A("the card says acceptance is the signing", /Accepting puts you on the club\\u2019s roster immediately/.test(live));
}

console.log("\n— transactions staff can send a trade back");
{
  A("completed trades carry a Send back control", /t\.status==="accepted"[\s\S]{0,120}data-tx-reverse/.test(desks));
  A("...calling reverse_trade with a reason", /rpc\("reverse_trade",\{ p_trade:id, p_reason:why\.trim\(\) \}\)/.test(desks));
  A("...refusing a thin reason client-side too", /Give a reason — both clubs are told what it says/.test(desks));
  A("the desk no longer calls itself read-only", !/This desk reads\./.test(desks));
  A("...and states the league has no say up front", /The league has no say in a trade as it is made/.test(desks));
}

console.log("\n— the rulebook says what the site does (v2.28)");
{
  const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
  const sec = (id) => { for (const c of rb.chapters) for (const s of c.sections) if (s.id === id) return s.paragraphs.join(" "); throw new Error("no " + id); };
  A("2.2: acceptance is the signing", /the signing takes effect the moment the player accepts/.test(sec("2.2")));
  A("2.2: the league office confirms nothing", /league office confirms nothing and has no say/.test(sec("2.2")));
  A("2.2: the counter loop is described", /counter with his own number/.test(sec("2.2")));
  A("2.2: accepting one offer withdraws the rest", /accepting one offer withdraws every other offer he holds/.test(sec("2.2")));
  A("2.2 no longer promises a league-office confirmation", !/only once the league office confirms it/.test(sec("2.2")));
  A("2.3: the department may send a trade back", /transactions department may review any completed trade/.test(sec("2.3")));
  A("2.3: ...and cannot once a piece has moved on", /cannot be reversed once a player or pick in it has moved on/.test(sec("2.3")));
  A("5.2: the cap is regular season and playoffs", /weekly appearance cap in the regular season and the playoffs/.test(sec("5.2")));
  A("5.2: ...and explicitly not the pre-season", /cap does not apply in the pre-season/.test(sec("5.2")));
  A("the changelog records v2.28", rb.changelog[0].version === "2.28" && rb.changelog[0].dateIso === "2026-08-29");
  A("...with dateIso throughout", rb.changelog.every((e) => !!e.dateIso));
}

console.log("\n— roadToFive's arithmetic states its dependency");
{
  A("it records that the pre-season is uncapped", /weekly appearance cap does not apply in the pre-season \(v2\.28\)/.test(live));
}

console.log("\n— the negotiation has BOTH sides (adversarial review, 2026-08-29)");
{
  A("the club's outgoing offers load too", /\.eq\("from_team_id", myTid\)/.test(live));
  A("...into their own store", /CG\._clubOffers = club;/.test(live));
  A("turn ownership comes from last_actor, not status", /CG\.offerAwaitsClub = function\(o\)\{ return \(o\.last_actor\|\|"team"\) === "player"; \}/.test(live));
  A("a countered offer reaches the club with his number", /He countered — your move/.test(live));
  A("...and the club can accept his terms", /data-coffer-accept/.test(live) && /Accept his terms/.test(live));
  A("...revise", /data-coffer-counter/.test(live));
  A("...or walk away", /data-coffer-deny/.test(live));
  A("the club card is rendered on the dashboard", /CG\.offersCardHtml\(\) \+ CG\.clubOffersCardHtml\(\)/.test(live));
  A("...and its actions are wired", /CG\.wireClubOfferActions\(\);/.test(live));
  A("the player card no longer shows dead read-only rows", /var mine = false;   \/\* offers awaiting the club are filtered out above \*\//.test(live));
  A("a GM doesn't see his own offer twice", /o\.player_id !== \(CG\.auth\.user\|\|\{\}\)\.id/.test(live));
  A("offers refresh with every league reload", /CG\.loadTrades\(\), CG\.loadMyOffers\(\)/.test(live));
  A("an empty first load doesn't force a repaint", /CG\._myOffers = null; CG\._myOffersFp = "";/.test(live));
  A("the board lede describes offers, not first-come-first-served",
    !/first come, first served/.test(live) && /sends real terms the player can accept, counter, or decline/.test(live));
}

console.log("\n— the pre-season uncapping reaches the client too");
{
  const hub = R("src/live/part6_hub.js");
  A("a helper knows when only pre-season games lie ahead", /CG\.preseasonOnlyAhead = function\(club\)/.test(hub));
  A("the Line Creator stops refusing a third goalie line", /if \(CG\.preseasonOnlyAhead && CG\.preseasonOnlyAhead\(club\)\) return null;/.test(hub));
  A("...and the copy stops stating the caps flatly", /There is no weekly appearance cap in the pre-season/.test(hub));
  A("...in both places", /No weekly cap applies in the pre-season/.test(hub));
  A("the rulebook carries no literal markup", !/<b>The cap does not apply/.test(content));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
