/* Rulebook v2.33 — fourteen rounds, a complete front office before the draft, no rookie bidding.
   Run: node tools/draft-14-and-no-bidding.test.cjs   (build index.html first)

   NOT COVERED HERE: the database — the 140-pick board (verified linear, every round identical,
   overall 1..140), start_draft's gate via draft_management_gaps() (rehearsed: refused naming
   SJS (GM); VAN (AGM); VGK (AGM)), and the removal of place_rookie_bid / resolve_rookie_auctions /
   is_rookie_bid_eligible / the rookie_bid_board view / both tables / the settle cron (verified gone,
   with no remaining function body naming any of them). Re-run those checks if you touch the SQL. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const content = R("src/live/part3_content.js"), live = R("src/live/part_live.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n?$/)[1]).rulebook;
const sec = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" "); throw new Error("no " + id); };
const secFull = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return (s.full || s.paragraphs).join(" "); throw new Error("no " + id); };

console.log("— round count is now a season setting (basic, v2.50)");
A("Rule 2.8 makes the round count a season setting", /The commissioner shall determine the number of rounds for each season's draft and shall publish it to the clubs/.test(sec("2.8")));
A("Chapter 0.5 defers to the number of rounds published for the season", /over the number of rounds published for the season \(Rule 2\.8\)/.test(sec("0.5")));
A("the pay table is a formula on the $750,000 minimum and $250,000 increment", /round N pays \$750,000 and round one pays \$750,000 plus \$250,000 multiplied by \(N − 1\)/.test(sec("2.8")));
A("...and says the scale follows the published round count", /the scale follows the number of rounds published for the season/.test(sec("2.8")));
A("...and the full scale is published with the round count", /The full scale for the season is published with the round count, before the draft/.test(sec("2.8")));

console.log("— fourteen rounds (full format, shelved)");
A("Rule 2.8 (full) says fourteen (14) rounds", /over fourteen \(14\) rounds/.test(secFull("2.8")));
A("...and no longer ten", !/ten \(10\) rounds/.test(secFull("2.8")));
A("Chapter 0.5 (full) says fourteen", /each of the fourteen rounds/.test(secFull("0.5")));
A("the pay table (full) is the fourteen-round one, ending at $750,000", /round fourteen \$750,000/.test(secFull("2.8")));
A("...opening at $4,000,000", /round one \$4,000,000/.test(secFull("2.8")));
A("...and prices the class at $33,250,000", /\$33,250,000/.test(secFull("2.8")));
A("...and discloses the cap consequence", /within \$750,000 of the cap/.test(secFull("2.8")));

console.log("— a complete front office before the draft");
A("Rule 2.8 requires Owner, GM and AGM", /must hold an Owner, a General Manager and an Assistant General Manager/.test(sec("2.8")));
A("...and says the draft will not start while a seat is empty", /the draft does not start while a seat is vacant/.test(sec("2.8")));
A("Rule 2.6 cross-references it", /all three seats before the entry draft begins/.test(sec("2.6")));
A("the draft room asks the database before confirming", /CG\.sb\.rpc\("draft_management_gaps"\)/.test(live));
A("...and names who is short", /The draft can’t start yet/.test(live) && /Still open:/.test(live));
A("...from a helper built on the loaded seats", /CG\.draftSeatGaps = function/.test(live));
A("...shown on the Build-the-board card too", /The draft cannot start yet<\/b> — every club needs an Owner, GM and AGM/.test(live));

console.log("— rookie bidding is gone");
for (const id of ["0.6", "2.2", "2.5"]) A(`section ${id} no longer mentions rookie bidding`, !/rookie bidding/i.test(sec(id)));
A("basic Rule 2.2 says there is no free-agency period at all", /The basic format has no free-agency period and no open market for player contracts/.test(sec("2.2")));
A("...every leftover and late registrant is placed as depth, not signed", /is placed on a club by the league office as depth at the league minimum/.test(sec("2.2")));
A("...and there are no rights classes in the basic format", /The basic format recognizes no classes of player rights/.test(sec("2.2")) && /no player is restricted/.test(sec("2.2")));
A("(full) Rule 2.2 says free agency is for ended contracts, not rookies", /for players whose contracts have ended/.test(secFull("2.2")) && /It is not for rookies/.test(secFull("2.2")));
A("...and states the exclusive re-signing window as a tampering rule with a start AND an end", /may negotiate only with the club that holds it — either side may open the conversation — at any point in that season, from the day its free agency opens until the free-agency period that FOLLOWS his contract's final season opens/.test(secFull("2.2")) && /is tampering under the paragraph above/.test(secFull("2.2")));
A("...says the club's right survives the rollover", /survives the contract's expiry at the season rollover/.test(secFull("2.2")));
A("...and is honest that the Season 2 draft-or-free-agency path is still to be published", /published before that season's registration opens/.test(secFull("2.2")));
A("...leaving the restricted-free-agent rights sentences in place (v2.35: the match mechanism is the office's to publish)", /RESTRICTED free agent until he has accrued four \(4\) off-seasons/.test(secFull("2.2")) && /exercises those rights when another club makes him an offer is set by the league office/.test(secFull("2.2")));
A("the free-agent page has no bidding board", !/Rookie bidding board|data-rookie-bid|rbAmt|rbGo/.test(live));
A("...and never calls the removed RPC or table", !/place_rookie_bid|rookie_auctions|_rookieAuctions/.test(live));
A("...and keeps one pool built from faFree, narrowed to genuine free agents (v2.35)", /var pool=\(lg\._registrationsRaw\|\|\[\]\)\.filter\(function\(r\)\{\n\s*if \(!faFree\(r\)\) return false;/.test(live) && /return ps==="free_agent" \|\| ps==="rfa";/.test(live));
A("no surviving copy still routes undrafted players to bidding", !/go to free agency and rookie bidding|first-year → rookie bidding/.test(live));
A("the Draft Room channel topic no longer promises a bidding board", !/bidding board/.test(R("shared/roles.mjs")));

console.log("— post-draft placement (v2.33)");
A("Rule 2.8 P7 says everyone unplaced is seated ten minutes after the draft", /a ten \(10\) minute period, after which every registered player still without a club/.test(sec("2.8")));
A("...in random order, no club choosing", /in random order/.test(sec("2.8")) && /No club selects/.test(sec("2.8")));
A("...as a one-season contract", /on a contract for the season \(Rule 2\.5\)/.test(sec("2.8")));
A("...and guarantees nobody is left without a club (basic has no unseatable case)", /No club selects, and no registered player is left without a club/.test(sec("2.8")));
A("Rule 2.8 P3 makes the sign-up cutoff an explicit test", /A registration filed after the cutoff does not enter the pool/.test(sec("2.8")));
A("Rule 2.5 says every contract has a term of exactly one season", /a term of one \(1\) season — the season in which it is signed/.test(sec("2.5")) && /A drafted player's contract carries the salary fixed for his round by Rule 2\.8/.test(sec("2.5")));
A("Chapter 0.6 says there is no free-agency week at all", /The basic format has no free-agency period/.test(sec("0.6")));
A("(full) ...as a one-season contract, unseatable reported not dropped", /The placement is a one-season contract/.test(secFull("2.8")) && /is reported to the commissioners rather than left in silence/.test(secFull("2.8")));
A("(full) Rule 2.8 P3 makes the deadline an explicit test", /a registration filed after it is never in the pool, however many pre-season games/.test(secFull("2.8")));
A("(full) Rule 2.5 says a first contract runs one season", /runs exactly one season at the salary Rule 2\.8 fixes/.test(secFull("2.5")));
A("(full) Chapter 0.6 says no rookie goes to free agency", /no rookie goes to free agency/.test(secFull("0.6")));
A("the client eligibility mirror tests the deadline first", /Date\.parse\(_reg\.created_at\) > Date\.parse\(_dl\)\) return false;/.test(live));
A("the pool state names the transient as awaiting placement, not a free agent", /label:"Awaiting placement"/.test(live) && !/label:"Undrafted FA"/.test(live));
A("the office button places everyone unplaced", /Place everyone unplaced/.test(live) && /CG\.sb\.rpc\("distribute_unproven_rookies"/.test(live));
A("...and its confirm no longer calls itself a no-op", !/Currently a stamped no-op/.test(live));
A("the jobs board describes the real job", /name:"Post-draft placement"/.test(live) && /Reports anyone it cannot seat/.test(live));
A("a placed player's profile says how he got there", /postdraft_random" \? "Placed by the league office after the draft"/.test(R("src/live/part5a_public.js")));
A("...and so does a late sign-up's", /latecomer_random" \? "Placed by the league office as a late sign-up"/.test(R("src/live/part5a_public.js")));
A("the free-agent page explains an empty board honestly", /Free agency is for players whose contracts have ended\. Undrafted players are placed on clubs automatically/.test(live));

console.log("— the record and the briefings");
{
  const v233 = rb.changelog.find((c) => c.version === "2.33");
  A("the changelog records v2.33", !!v233 && !!v233.dateIso);
  A("...naming all three rulings", !!v233 && /fourteen \(14\) rounds/.test(v233.summary) && /full front office/.test(v233.summary) && /Rookie bidding is abolished/.test(v233.summary) && /ten minutes after the draft concludes/.test(v233.summary) && /eighteen such contracts were closed/.test(v233.summary));
  A("...and the newest entry sits first", rb.changelog[0].version >= "2.33", rb.changelog[0].version);
}
for (const f of ["CGHL-Season1-Owners-Briefing.md", "CGHL-Season1-Owners-Briefing-DISCORD.txt"]) {
  const b = R(f);
  A(`${f}: 15 rounds in a snake (v2.48 basic format)`, /the working figure on the site is 15 rounds in a snake order/.test(b) && !/^10 rounds,/m.test(b) && !/^14 rounds,/m.test(b));
  A(`${f}: no rookie bidding, no free agency`, /There is no free agency/.test(b) && !/go to rookie bidding/.test(b) && !/rookie bidding/.test(b));
  A(`${f}: says the unplaced are placed, not signed`, /placed on one by the league office at \$750K/.test(b) && !/signs in open free agency like everyone else/.test(b));
  A(`${f}: says ten clubs, not twelve`, !/twelve clubs/.test(b));
  A(`${f}: front office must be complete`, /Your front office must be complete/.test(b));
  A(`${f}: the cap consequence is spelled out`, /\$43\.5M of the \$50M cap/.test(b));
  A(`${f}: the full-format edition is shelved beside it, not deleted`, /\$39\.25M of a \$40M cap/.test(R(f.replace(/\.md$/, "-FULL-FORMAT.md").replace(/-DISCORD\.txt$/, "-DISCORD-FULL-FORMAT.txt"))));
}
console.log(ok ? "\nPASS" : "\nFAIL"); process.exit(ok ? 0 : 1);
