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
  /* v3.55 (Q1): 2.5.4 no longer describes a claim window; the salary still travels */
  A("2.5's waiver line follows", /any club may sign him at the salary he carried until the movement deadline/.test(sec("2.5")));
  A("a drafted player is still paid by round", /A drafted player's contract carries the salary fixed for his round by Rule 2\.8/.test(sec("2.5")));
  A("depth placement is still at the minimum", /placed on a club by the league office as depth at the league minimum salary/.test(sec("2.2")));
  A("the increment rule is untouched", /every salary in the league is a multiple of \$250,000 above it/.test(sec("2.5")));
  A("the changelog records it", rb.changelog.some((e) => e.version === "3.46"));
}

console.log("\n— the client half");
{
  const live = R("src/live/part_live.js");
  A("the client no longer names a salary", !/p_salary:750000/.test(live));
  A("...it passes null and lets the database decide", /p_salary:null/.test(live));
  A("there is a client mirror of the read", /CG\.waivedSalaryOf = function\(pid\)/.test(live));
  A("...defined before the page that uses it, not inside a call",
    live.indexOf("CG.waivedSalaryOf = function") < live.indexOf("CG.hubFreeAgents = function"));
  A("the dialog names his real salary and the cap room", /the salary he was already earning, which a waiver does not reduce \(Rule 2\.2\)/.test(live) && /of room\./.test(live));
  A("the board row shows the figure", /He keeps this salary for the season \(Rule 2\.2\)/.test(live));
  A("no page copy still promises the minimum", !/\$750K to the end of the season/.test(live) && !/the league minimum, \$750K/.test(live));
  A("the record covers the client half", /THE CLIENT HALF, WHICH ALMOST SHIPPED WRONG/.test(flat));
  A("...and the splice mistake, with the tool that finds it", /node --check. names the line in one second/.test(flat));
  A("the unimplemented waiver period is flagged, not fixed",
    /Rule 2\.5 describes a waiver system that does not exist/.test(flat) && /left for the commissioner to rule on/.test(flat));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
