/* v3.46 — a player keeps his salary for the whole season, even if he is waived. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const rec = R("sql/2026-09-26-salary-survives-a-waiver.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const rb = (function(){ const c = R("src/live/part3_content.js"); return JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1)).rulebook; })();
const sec = (id) => { for (const c of rb.chapters) for (const x of c.sections) if (x.id === id) return x.paragraphs.join("\n"); return ""; };

console.log("\n— the record names the line and the loophole");
{
  A("it quotes the instruction", /players keep their salary for the whole season even if they are waived/.test(flat));
  A("it quotes the forced minimum", /if public\.season_is_basic\(v_season\.id\) then v_salary := 750000; end if;/.test(flat));
  A("...and the loophole it opened", /could waive a \$3\.25M player and any club, including the one that waived him, could pick him up at \$750,000/.test(flat));
  A("...in one sentence", /Being waived cost the player his salary and handed the league a discount on him/.test(flat));
}

console.log("\n— where the salary is read from, in order");
{
  A("the contract is first, and why it survives",
    /contract_on_waive sets status='expired' and team_id=null but LEAVES THE SALARY on the row/.test(flat));
  A("the archive is the second source", /roster_spot_removals, v3\.17/.test(flat));
  A("the minimum is a floor, not a reset", /as a FLOOR for a player with no salary on record/.test(flat) && /Never as a reset/.test(flat));
  A("the full format is untouched", /The full format is unchanged and still takes the offered salary/.test(flat));
  A("the contract writer needed nothing, and it says why",
    /it takes its else branch and writes a new contract at the roster spot's salary/.test(flat));
  A("the cap is still enforced where it was", /by guard_roster_cap on the insert/.test(flat));
  A("...so a club that cannot afford him is refused", /refused rather than quietly given a discount/.test(flat));
}

console.log("\n— the rehearsal used a real expensive player");
{
  A("it waived and re-signed the priciest active player", /The most expensive non-management active player in the league was waived by his own club and then signed by a different club/.test(flat));
  A("all three assertions are listed", /the new roster spot carries the SAME salary/.test(flat) && /the contract written for the new club carries it too/.test(flat));
  A("the live impact is stated honestly", /Nobody currently waived is affected: all six are at the league minimum already/.test(flat));
  A("...and when it will bite", /Utah alone has a \$3\.25M and a \$2\.75M player listed on the trade block tonight/.test(flat));
}

console.log("\n— the interpretation is on the record");
{
  A("the chosen reading is stated", /the PLAYER's salary following the PLAYER/.test(flat));
  A("the rejected reading is named", /the WAIVING club keeps paying it as dead cap/.test(flat));
  A("...and why it was rejected", /would have been described as such/.test(flat));
  A("...with the rulebook's own precedent for the wording",
    /A player who earned a larger salary before taking the seat keeps that salary/.test(flat));
  A("no em dash or spaced hyphen", !/—/.test(rec) && !/ - /.test(rec));
}

console.log("\n— the rules");
{
  A("2.2 signs at his own salary", /at the salary he was already earning/.test(sec("2.2")));
  A("...states the principle", /A player keeps his salary for the whole season: being waived does not reduce it/.test(sec("2.2")));
  A("...and the cap consequence", /the club that signs him takes on the figure his former club carried, against its own cap/.test(sec("2.2")));
  A("...keeping the minimum only as a floor", /Where a player has no salary on record for the season, the league minimum applies as a floor/.test(sec("2.2")));
  A("...and the old forced minimum is gone", !/may sign a waived player at the league minimum salary/.test(sec("2.2")));
  A("2.5 separates a depth placement from a waived player",
    /a depth placement's contract carries the league minimum salary\. A waived player carries the salary he already had/.test(sec("2.5")));
  A("2.5's unclaimed-waiver line follows", /may be signed by any club with room in his position group, at his own salary/.test(sec("2.5")));
  A("a drafted player is still paid by round", /A drafted player's contract carries the salary fixed for his round by Rule 2\.8/.test(sec("2.5")));
  A("depth placement is still at the minimum", /placed on a club by the league office as depth at the league minimum salary/.test(sec("2.2")));
  A("the increment rule is untouched", /every salary in the league is a multiple of \$250,000 above it/.test(sec("2.5")));
  A("the changelog records it", rb.changelog.some((e) => e.version === "3.46"));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
