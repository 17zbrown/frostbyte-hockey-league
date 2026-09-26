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
  /* v2.57: the FULL format offers and the player decides; the BASIC format has no player-side step —
     the club signs a waived player outright at the minimum (sign_free_agent) and the button says Sign */
  A("the full format offers; the basic format signs outright", /rpc\("offer_free_agent"/.test(live) && /rpc\("sign_free_agent",\{ p_registration:regId, p_salary:750000 \}/.test(live));
  A("the direct signing is gated to the basic format", /if \(basicOffer\)\{[\s\S]{0,400}sign_free_agent/.test(live));
  A("the button says Offer in full and Sign in basic", /\(basicFA\?'Sign':'Offer'\)/.test(live));
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
  /* seven since v2.34: accept/deny/counter on each side, plus the player withdrawing his own ask */
  A("...through respond_offer, from both sides", (live.match(/rpc\("respond_offer"/g)||[]).length === 7);
  A("...and bound before the hub's sub-page early returns", /if \(CG\.wireOfferActions\) CG\.wireOfferActions\(\);[\s\S]{0,1100}?\n  if \(param==="messages"\)/.test(live)   /* v2.38: the approval banner's Withdraw wiring sits between; v2.49 adds the hub-rail scroll */);
  /* v2.31 moved this guard from an inline ">= 0.75" check to the shared CG.salaryProblem(), which
     enforces the league minimum AND the $250K lattice (Rule 2.5). The rule this line exists to
     pin — a counter can never go below the minimum — is unchanged; only its mechanism moved. */
  /* four since v2.34: offer, revise, counter, and the player's ask-to-re-sign — every negotiated
     figure on the site goes through the one predicate */
  A("a counter cannot go below the league minimum, or land off the $250K lattice",
    (live.match(/CG\.salaryProblem\(Math\.round\(v\*1e6\)\)/g) || []).length === 4 &&
    !/Salary must be at least/.test(live));
  A("the card says acceptance of a free-agent offer is the signing", /Accepting a free-agent offer puts you on the club\\u2019s roster immediately/.test(live));
  A("...and that an extension changes nothing this season", /Accepting an extension signs your next deal and changes nothing this season/.test(live));
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
  const secFull = (id) => { for (const c of rb.chapters) for (const s of c.sections) if (s.id === id) return (s.full || s.paragraphs).join(" "); throw new Error("no " + id); };
  /* FULL format: the open-market negotiation, preserved word for word in Appendix A */
  A("[full] 2.2: acceptance is the signing", /the signing takes effect the moment the player accepts/.test(secFull("2.2")));
  A("[full] 2.2: the league office confirms nothing", /league office confirms nothing and has no say/.test(secFull("2.2")));
  A("[full] 2.2: the counter loop is described", /counter with his own number/.test(secFull("2.2")));
  A("[full] 2.2: accepting one offer withdraws the rest", /accepting one offer withdraws every other offer he holds/.test(secFull("2.2")));
  A("[full] 2.2 no longer promises a league-office confirmation", !/only once the league office confirms it/.test(secFull("2.2")));
  A("[full] 2.3: the department may send a trade back", /transactions department may review any completed trade/.test(secFull("2.3")));
  A("[full] 2.3: ...and cannot once a piece has moved on", /cannot be reversed once a player or pick in it has moved on/.test(secFull("2.3")));
  A("5.2: the weekly cap is a regular-season cap (v2.51) and 8.3's series cap applies in its place in the playoffs",
    /weekly appearance cap in the regular season, counted across the game-week/.test(sec("5.2")) && /In the playoffs the cap of Rule 8\.3 applies in its place/.test(sec("5.2")));
  A("[full] 5.2: ...and explicitly not the pre-season", /cap does not apply in the pre-season/.test(secFull("5.2")));
  /* BASIC format is now the live standard: waived-player signing, players-only trades */
  A("[basic] 2.2: no free-agency period and no open market", /The basic format has no free-agency period: no window in the calendar during which contracts are negotiated, and no open market in which a club bids for a player who is not on a roster/.test(sec("2.2")));
  A("[basic] 2.2: ...but it does not claim the league has no free agents", /It does have free agents, and the next paragraph but one says who they are/.test(sec("2.2")));
  A("[basic] 2.2: the league office confirms nothing about a waiver signing either", /the league office confirms nothing and has no part in the move/.test(sec("2.2")));
  A("[basic] 2.2: waived players are signable from the draft's conclusion until the deadline", /From the conclusion of the draft until the movement deadline \(Rule 2\.4\), any club with room in the player's position group may sign a waived player at the league minimum salary/.test(sec("2.2")));
  A("[basic] 2.3: trades are players only — no pick is a trade asset", /Draft picks are not tradeable assets in the basic format: a trade consists of players for players, and an offer that includes a draft pick is refused at the point of entry/.test(sec("2.3")));
  /* by version, not by position: pinning changelog[0] made every LATER rulebook change fail this
     unrelated test (v2.29 did exactly that) */
  A("the changelog records v2.28", rb.changelog.some((e) => e.version === "2.28" && e.dateIso === "2026-08-29"));
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
  A("a countered offer reaches the club with his number", /His number — your move/.test(live));
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
