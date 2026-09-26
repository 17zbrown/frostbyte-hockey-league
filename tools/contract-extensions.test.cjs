/* Rulebook v2.34 — contract extensions inside the exclusive window.
   Run: node tools/contract-extensions.test.cjs   (build index.html first)

   NOT COVERED HERE: the database — extension_window_open, _extendable_contract, team_cap_committed,
   team_cap_outlook, offer_extension, request_extension, the future-season path in respond_offer,
   the signed→active flip in _activate_contract_spot and start_next_season, contract_on_waive,
   sync_contract_team, and the future-season check in accept_trade. All rehearsed against
   production and rolled back:
     · refused before the season's free agency opened; allowed after, with no deadline term
     · refused from an outside club, and via free agency with it OPEN; off-lattice refused; 4 seasons refused
     · club offer → player counter → club accept wrote a SIGNED deal beside the intact current one
     · player ask (lands as a counter, notifies every seated manager) → player withdrew it
     · club offer → trade → offer withdrawn, accept lapsed; trade refused on NEXT season's cap
     · next-season projection reserves the front office: $36M refused, $34M allowed, no double count
     · S2 created and the player REGISTERED BEFORE the rollover → seated via his signed deal, 'assigned'
     · rollover: old deal expired, signed deal active (extended count returned)
     · post-rollover, pre-FA: rival club refused; own club re-signs the expired player → ACTIVE now, seated
     · after S2 free agency opens → rights over, refused
     · rights-held player loaned to another club for the S2 PRE-SEASON: loan club refused, own club
       allowed, the loan's release did NOT kill the new deal, seated on his own club
     · rights end on a real seat elsewhere (drafted by VAN → BOS refused; accept lapses) and on a
       re-sign already done (second re-sign refused)
   Re-run those rehearsals if the SQL moves. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), content = R("src/live/part3_content.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n?$/)[1]).rulebook;
const sec = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" "); throw new Error(id); };
const secFull = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return (s.full || s.paragraphs).join(" "); throw new Error(id); };

/* run the real helpers */
const CG = { SEASON: null, lg: null, auth: null, TEAM: {}, _myOffers: [] };
const grab = (name) => { const i = live.indexOf("CG." + name + " = function"); if (i < 0) throw new Error("no CG." + name); return live.slice(i, live.indexOf("\nCG.", i + 5)); };
/* v2.48: the helpers read the season format — load the format block first, and drive the extension
   cases as a FULL-format season (the basic format has no extensions or held rights at all) */
const fmtBlock = live.slice(live.indexOf("CG.FORMAT_RULES = {"), live.indexOf("CG.GROUP_NAME = {"));
vm.runInNewContext(fmtBlock + "\n" + ["etISO","etYMD","capYearOpensAt","extensionWindowOpen","contractOf","rightsHeldContractOf","seatedElsewhere","extendableContractOf","signedExtensionOf","isExpiring","contractClubCode","contractHeldIds"].map(grab).join("\n"), { CG, Date, Intl, isNaN, Object, Infinity });
const _origSeason = Object.getOwnPropertyDescriptor(CG, "SEASON");
/* every SEASON the cases below assign is a full-format one unless it says otherwise */
Object.defineProperty(CG, "SEASON", { configurable: true, enumerable: true,
  get(){ return this._season; }, set(v){ this._season = (v && v.format == null) ? Object.assign({ format: "full" }, v) : v; } });

console.log("— the window opens with the season's free agency, as extension_window_open() does");
{
  CG.SEASON = { number: 1, free_agency_opens_at: "2026-09-27T04:00:00Z", starts_at: "2026-10-07T04:00:00Z" };
  A("the cap year opens at free agency, not puck drop", CG.capYearOpensAt() === Date.parse("2026-09-27T04:00:00Z"));
  /* pin the clock on both sides of the date — the live clock crossed it on Sep 27 and would have
     exercised only the open branch from then on */
  { var realNow = Date.now;
    Date.now = function(){ return Date.parse("2026-09-20T00:00:00Z"); };
    A("the window is closed before that date", CG.extensionWindowOpen() === false);
    Date.now = function(){ return Date.parse("2026-09-27T04:00:00Z"); };
    A("...and opens the moment free agency does", CG.extensionWindowOpen() === true);
    Date.now = realNow; }
  CG.SEASON = { number: 1, free_agency_opens_at: "2020-01-01T00:00:00Z" };
  A("...and stays open the whole final season — no movement-deadline term anywhere", CG.extensionWindowOpen() === true && !/movementDeadlineAt/.test(live));
  CG.SEASON = { number: 1, starts_at: "2020-01-01T00:00:00Z" };
  A("puck drop is the fallback when no free-agency date exists", CG.extensionWindowOpen() === true);
  CG.SEASON = { number: 1 };
  A("a season with neither date is a setup state, not a gate", CG.extensionWindowOpen() === true);
}

console.log("— contract helpers");
{
  CG.SEASON = { number: 1 };
  CG.lg = { _idToCode: { T1: "BOS", T2: "VAN" }, _contractsRaw: [
    { profile_id: "p1", team_id: "T1", status: "active", start_season: 1, end_season: 1, salary: 1250000 },
    { profile_id: "p2", team_id: "T1", status: "active", start_season: 1, end_season: 2, salary: 1000000 },
    { profile_id: "p3", team_id: "T1", status: "active", start_season: 1, end_season: 1, salary: 1000000 },
    { profile_id: "p3", team_id: "T1", status: "signed", start_season: 2, end_season: 4, salary: 2250000 },
    { profile_id: "m1", team_id: "T1", status: "active", start_season: 1, end_season: 1, salary: 3000000, is_manager: true },
    { profile_id: "x1", team_id: null, status: "expired", start_season: 1, end_season: 1, salary: 750000 },
    /* p4: his one-season deal ended with season 1 and the rollover expired it — T1 still holds his rights */
    { profile_id: "p4", team_id: "T1", status: "expired", start_season: 1, end_season: 1, salary: 1000000 }
  ] };
  A("a one-season deal in season 1 is expiring", CG.isExpiring("p1") === true);
  A("a deal through season 2 is not", CG.isExpiring("p2") === false);
  A("a player who already signed his extension is not", CG.isExpiring("p3") === false);
  A("...and his signed deal is found", CG.signedExtensionOf("p3") && CG.signedExtensionOf("p3").end_season === 4);
  A("a management contract is never an expiring player deal", CG.contractOf("m1") === null);
  A("an expired club-less contract is not a contract", CG.contractOf("x1") === null);
  A("the holding club resolves to a code", CG.contractClubCode("p1") === "BOS");
  /* post-rollover, pre-free-agency: rights held on the player whose deal ended last season */
  CG.SEASON = { number: 2, free_agency_opens_at: "2099-01-01T00:00:00Z" };
  A("a deal that ended last season is rights-held until this season's free agency", CG.rightsHeldContractOf("p4") && CG.rightsHeldContractOf("p4").team_id === "T1");
  A("...and is the extendable deal in that window", CG.extendableContractOf("p4") && CG.extendableContractOf("p4").status === "expired");
  A("...while a club-less expired deal confers no rights", CG.rightsHeldContractOf("x1") === null);
  CG.SEASON = { number: 2, free_agency_opens_at: "2020-01-01T00:00:00Z" };
  A("...but not once free agency has opened", CG.rightsHeldContractOf("p4") === null && CG.extendableContractOf("p4") === null);
  CG.SEASON = { number: 2, starts_at: "2099-01-01T00:00:00Z" };
  A("...and a season with no free-agency date has no rights window — puck drop is NOT a fallback here, matching the database", CG.rightsHeldContractOf("p4") === null);
  /* rights end the moment something real happens to him this season */
  CG.SEASON = { number: 2, free_agency_opens_at: "2099-01-01T00:00:00Z", id: "S2" };
  CG.lg._rosterRaw = [{ profile_id: "p4", season_id: "S2", team_id: "T2", origin: "draft" }];
  A("a real seat on another club ends the old club's rights", CG.extendableContractOf("p4") === null && CG.seatedElsewhere("p4", "T1") === true);
  CG.lg._rosterRaw = [{ profile_id: "p4", season_id: "S2", team_id: "T2", origin: "preseason_random" }];
  A("...but a pre-season loan does not", CG.extendableContractOf("p4") && CG.extendableContractOf("p4").team_id === "T1");
  CG.lg._rosterRaw = [];
  CG.SEASON = { number: 2 };
  const held = CG.contractHeldIds();
  A("in season 2 a SIGNED deal holds the player out of the pool", held.p3 === true);
  A("...and an active multi-season deal still does", held.p2 === true);
  A("...but a deal that ended with season 1 does not", !held.p1);
}

console.log("— Team HQ");
{
  A("the roster row shows a Final season chip", /Final season<\/span>/.test(hub) && /CG\.isExpiring\(p\.id\)/.test(hub));
  A("...and a Signed thru chip once extended", /Signed thru S'\+esc\(String\(signedExt\.end_season\)\)/.test(hub));
  A("the Extend button appears only for an extendable deal (final season in window, or rights held)", /CG\.extendableContractOf && CG\.extendableContractOf\(p\.id\)/.test(hub));
  A("...and only when that deal is the viewing club's", /extRow\.team_id === \(lg\._codeToId\|\|\{\}\)\[club\]/.test(hub));
  A("the rights-held list is built from the same predicate as the button", /var x = CG\.extendableContractOf\(c\.profile_id\); if \(!x \|\| x\.id!==c\.id\) return;/.test(hub));
  A("the Re-sign modal says a rights-held deal is for THIS season and checked against this season's space", /A deal for Season '\+sn\+' — the season now under way/.test(hub) && /r\.season===target/.test(hub));
  A("an open negotiation shows on the row", /'His ask':'Offer out'/.test(hub));
  A("the roster page lists rights-held players with a Re-sign action", /Rights held until free agency opens/.test(hub) && /data-extend="'\+esc\(r\.id\)\+'">Re-sign/.test(hub));
  A("the waive confirm names the extension it voids", /His signed extension through Season "\+sx\.end_season\+" is voided with the waiver/.test(hub));
  A("...and calls the one RPC", /CG\.sb\.rpc\("offer_extension",\{ p_profile:pid, p_salary:Math\.round\(v\*1e6\), p_years:y, p_note:note \}\)/.test(hub));
  A("...validating the lattice first", /bad=CG\.salaryProblem\(Math\.round\(v\*1e6\)\)/.test(hub.slice(hub.indexOf("data-extend"))));
  A("...with a term capped by the format's max contract years", /id="exYrs">'\+\[1,2,3\]\.slice\(0, CG\.fmt\("max_contract_years"\)\)\.map/.test(hub));
  A("it warns when a negotiation is already open", /A negotiation with him is already open/.test(hub));
}

console.log("— the player's dashboard");
{
  A("the contract card rides with the offers for everyone", /CG\.offersCardHtml\(\) \+ CG\.clubOffersCardHtml\(\) \+ CG\.extensionCardHtml\(\)/.test(live));
  A("before the window it names the date talks open", /From <b>'\+\(dl\?esc\(CG\.fmtFull\(dl\)\)/.test(live) && /the opening of this season’s free agency/.test(live));
  A("...and says the new deal is checked against next season's space", /checked against the space '\+esc\(club\)\+' will have then/.test(live));
  A("...and says no other club may approach", (live.match(/No other club may approach you/g) || []).length >= 2);
  A("in the window the player can open with his own number", /id="askResign"/.test(live) && /CG\.sb\.rpc\("request_extension",\{ p_salary:Math\.round\(v\*1e6\), p_years:y, p_note:note \}\)/.test(live));
  A("a signed extension is shown through its last season", /Signed through Season '\+esc\(String\(signed\.end_season\)\)/.test(live));
  A("the card is wired where offer actions are wired", /CG\.wireClubOfferActions = function\(\)\{\s*CG\.wireExtensionCard\(\);/.test(live));
  A("a player can withdraw his own ask", /id="withdrawAsk"/.test(live) && /p_action:"deny"/.test(live.slice(live.indexOf('getElementById("withdrawAsk")'), live.indexOf('getElementById("withdrawAsk")') + 900)));
  A("the rights-held state has its own card", /Rights held by '\+esc\(rcode\|\|rclub\)/.test(live));
  A("...which says the deal is for THIS season and takes effect on acceptance", /A deal signed now is for <b>this<\/b> season: it takes effect the moment you accept/.test(live));
  A("...and points an unregistered player at the register page", /Register for the season<\/a> so a signed deal can seat you/.test(live));
  A("the ask modal targets this season for a rights-held player", /var target = rights \? sn : sn \+ 1;/.test(live));
  A("the free-agent board locks rights-held players against the club the board is FOR", /rhCode !== t\.code/.test(live));
  A("the register page words a signed next-season deal as such", /Your next deal with '\+esc\(ctName\)\+' is signed through Season/.test(live));
  A("the Trade Hub discloses a signed extension travelling with a player", /signed S'\+esc\(String\(sx\.start_season\)\)\+'–S'\+esc\(String\(sx\.end_season\)\)/.test(live));
  A("the register page treats a signed deal for this season as a contract", /c\.status==="signed" && !c\.is_manager && c\.team_id &&\s*\(c\.start_season\|\|1\)<=snumR/.test(live));
  A("the free-agent board disables Approach and Offer on a rights-held player", /Exclusive to '\+esc\(rhCode\)\+' until free agency opens — approaching him is tampering/.test(live) && /\(canSign&&!full&&!held\)/.test(live));
  A("the rollover confirm and toast mention extensions", /extensions signed during the exclusive window come into force/.test(live) && /extension"\+\(\(d\.extended\|\|0\)===1\?"":"s"\)\+" in force/.test(live));
  A("the Discord sweep and the bot treat a signed deal as holding the player", /status=in\.\(active,signed\)/.test(R("netlify/functions/discord-sync.js")) && /status=in\.\(active,signed\)/.test(R("bot/role-sync.mjs")));
  A("the profile card shows a signed extension", /Signed thru S'\+esc\(String\(CG\.signedExtensionOf\(p\.id\)\.end_season\)\)/.test(R("src/live/part5a_public.js")));
}

console.log("— the cap outlook");
{
  A("Team HQ renders a cap outlook card", /id="capOutlookCard"/.test(hub) && /<h3>Cap outlook<\/h3>/.test(hub));
  A("...filled from the one RPC the cap checks share", /CG\.sb\.rpc\("team_cap_outlook",\{ p_team: tid \}\)/.test(hub));
  A("...one column per season, space colored by sign", /Season '\+r\.season\+'/.test(hub) && /neg\?"var\(--red\)":"var\(--green\)"/.test(hub));
  A("...naming what comes off the books after each season", /comes off after this season/.test(hub));
  A("...and explaining that next-season deals are checked against next season", /checked against <b>next<\/b> season’s space/.test(hub));
  A("the Extend modal shows the target season's space before the number is typed", /Season '\+target\+' space right now: <b>'\+CG\.fmtMoney\(nx\.space\)/.test(hub));
  A("...and says the server refuses anything that would not fit", /the server refuses anything that would not fit/.test(hub));
}

console.log("— the offer cards tell the truth about extensions");
{
  A("an offer from the holding club is labelled an extension", (live.match(/<span class="chip chip-chrome">Extension/g) || []).length === 2);
  A("the player's accept says re-sign, not sign", /Accept'\+\(o\.immediate\?' and sign':\(ext\?' and re-sign':''\)\)/.test(live));
  A("...and the confirm says a next-season deal changes nothing this season", /A next-season deal changes nothing this season and comes into force with next season’s cap year/.test(live));
  A("the accept confirms use the cap-year vocabulary, both kinds", /comes into force with next season’s cap year; a rights-held re-sign takes effect the moment it is accepted/.test(live) && /comes into force with next season’s cap year; a rights-held re-sign takes effect now/.test(live) && !/at the season rollover/.test(live));
  A("the club's accept toast says re-signed, not welcome aboard", /nm\+" re-signed — his new deal starts with next season’s cap year"/.test(live));
  A("the club's counter chip has one honest label", /'His number — your move'/.test(live) && !/He countered — your move/.test(live));
  A("no term select offers four seasons any more", !/\[1,2,3,4\]/.test(live) && !/\[1,2,3,4\]/.test(hub));
}

console.log("— the rulebook says the same thing");
{
  A("the changelog records v2.34, with nothing older above it", rb.changelog.some(function(c){ return c.version === "2.34" && /Contract extensions/.test(c.summary); }) && rb.changelog[0].version >= "2.34");
  A("the changelog head is now v2.48 or later, the season-format switch", rb.changelog.some(function(c){ return c.version === "2.48" && /season format/i.test(c.summary); }) && rb.changelog[0].version >= "2.48");
  /* FULL format: extensions, rights, and multi-season deals still live word for word in Appendix A */
  A("[full] Rule 2.5 describes the extension", /A club re-signs its own player through an extension/.test(secFull("2.5")));
  A("[full] ...opening with the final season's free agency, for the whole season", /at any point in the final season of his deal — from the day that season's free agency opens/.test(secFull("2.5")));
  A("[full] ...defining the cap year as free agency to free agency", /The cap year runs from one free-agency opening to the next/.test(secFull("2.5")));
  A("[full] ...checking a future deal against the future season's space, front office included", /counting every deal already signed for that season and the three front-office seats/.test(secFull("2.5")));
  A("[full] ...with a hard stop and no exception", /refuses any signing, now or for a future season, that would not fit inside the cap it is checked against; there is no exception/.test(secFull("2.5")));
  A("[full] ...and promising the three-season outlook", /cap space for the current season and the three that follow/.test(secFull("2.5")));
  A("[full] ...as a signed deal for the following season that changes nothing now", /An extension accepted during the final season is a signed deal for the following season, and comes into force with that season's cap year: nothing about the current season changes/.test(secFull("2.5")));
  A("[full] ...that travels on a trade and dies on a waiver", /travels with the player if he is traded and is voided if he is waived/.test(secFull("2.5")));
  A("[full] ...one at a time", /A player may hold one signed extension at a time/.test(secFull("2.5")));
  A("[full] Rule 2.2 says either side may open the conversation, any point in the season", /either side may open the conversation — at any point in that season, from the day its free agency opens/.test(secFull("2.2")));
  A("[full] Rule 2.5 P1 no longer says a first deal is 'renegotiated only when it ends'", !/renegotiated only when it ends/.test(secFull("2.5")) && /through the extension window below or through free agency/.test(secFull("2.5")));
  A("[full] ...and says an expired deal's club alone may re-sign him until free agency", /until that free agency opens, the club that held the deal alone may re-sign him/.test(secFull("2.5")));
  A("[full] Rule 2.4 carves extensions out of the movement freeze", /except a contract extension under Rule 2\.5, which changes no roster this season/.test(secFull("2.4")));
  A("[full] Chapter 0.2 no longer says 'from scratch'", !/rebuilt from scratch every season/.test(secFull("0.2")) && /the contracts that carry over/.test(secFull("0.2")));
  A("[full] Chapter 0.6 no longer opens the window at the movement deadline", !/movement deadline until/.test(secFull("0.6")) && /at any point in that season, and on until the free agency that follows it opens/.test(secFull("0.6")));
  A("[full] Rule 2.5 states the post-rollover re-sign takes effect at once", /A player re-signed after the rollover, before that season's free agency opens, is signed for the season now under way/.test(secFull("2.5")));
  A("[full] ...and that the exclusive right survives the rollover until free agency", /the club's exclusive right to re-sign the player survives until the free agency that follows that season opens/.test(secFull("2.5")));
  A("[full] ...without claiming the money 'comes off the books' at a moment the system does not honour", !/comes off the club's books/.test(secFull("2.5")));
  A("[full] ...and outside clubs wait for free agency", /No club other than the one that holds his current deal may offer him anything until that deal has ended and free agency has opened/.test(secFull("2.5")));
  for (const f of ["CGHL-Season1-Owners-Briefing.md", "CGHL-Season1-Owners-Briefing-DISCORD.txt"]) {
    const b = R(f);
    /* v2.48: Season 1 runs the basic format — the current briefing says every deal is one season; the
       full-format edition that explains re-signing is shelved beside it, not deleted */
    A(`${f}: tells owners every contract runs one season (basic)`, /Every contract runs one season/.test(b) && /no extensions, no re-signings, no held rights/.test(b));
    A(`${f}: ...while the shelved edition still tells owners how re-signing works`, (function(){ const s = R(f.replace(/\.md$/, "-FULL-FORMAT.md").replace(/-DISCORD\.txt$/, "-DISCORD-FULL-FORMAT.txt")); return /Re-signing your own players/.test(s) && /Cap outlook/.test(s) && /you still hold his rights until then/.test(s); })());
  }
  /* BASIC format is now the live standard: one-season deals, no extensions, no held rights */
  A("[basic] Rule 2.5 says no extensions, no re-signings and no held rights", /The basic format provides for no contract extension, no re-signing and no retained player rights/.test(sec("2.5")));
  A("[basic] ...and every contract runs a term of exactly one season", /a term of one \(1\) season — the season in which it is signed/.test(sec("2.5")));
  A("[basic] ...so a club cannot claim a player for a future season", /A club may not offer a player terms for a future season, and nothing a club does in a season confers any claim on a player for the next/.test(sec("2.5")));
  A("[basic] Rule 2.2 has no free-agency period and no open market", /The basic format has no free-agency period: no window in the calendar during which contracts are negotiated, and no open market in which a club bids for a player who is not on a roster/.test(sec("2.2")));
  A("[basic] ...and there are no rights classes", /The basic format recognizes no classes of player rights: no club holds a player's rights once his season ends, and no player is restricted/.test(sec("2.2")));
}
console.log(ok ? "\nPASS" : "\nFAIL"); process.exit(ok ? 0 : 1);
