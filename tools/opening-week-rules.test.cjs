/* v3.40 — the three rule changes from the opening-week announcement. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), html = R("index.html");
const rec = R("sql/2026-09-26-opening-week-rule-changes.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const rb = (function(){ const c = R("src/live/part3_content.js"); return JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1)).rulebook; })();
const sec = (id) => { for (const c of rb.chapters) for (const x of c.sections) if (x.id === id) return x.paragraphs.join("\n"); return ""; };

console.log("\n— 1. position locks are lifted, as a setting");
{
  A("the client mirrors the season setting", /CG\.posLocksOn = function\(s\)\{ var sn = s \|\| CG\.SEASON; return !!\(sn && sn\.position_locks\); \}/.test(live));
  A("the lineup builder reads it", /var locksOn = !CG\.posLocksOn \|\| CG\.posLocksOn\(\);/.test(hub));
  A("...and flex() is everybody when it is off", /function flex\(p\)\{ return !locksOn \|\|/.test(hub));
  A("the line creator reads it too", /if \(\(!CG\.posLocksOn \|\| CG\.posLocksOn\(\)\) && p\.squad!=="tc"/.test(hub));
  A("2.1 makes the lock a season setting",
    /Whether that assignment governs where he may be dressed is a season setting, the position lock/.test(sec("2.1")));
  A("...records that it is off for Season 1, with the date",
    /The lock is not in force for Season 1; it was lifted by announcement of the league office on 26 September 2026/.test(sec("2.1")));
  A("...and that the appearance limits survived it",
    /the appearance limits of Rule 5\.2 were not touched by that decision/.test(sec("2.1")));
  A("composition is now a separate question from dressing",
    /Where a club may dress each of those players is a separate question, governed by the position lock/.test(sec("2.1")));
  A("5.2 conditions the group rule on the lock",
    /Where the position lock is in force \(Rule 2\.1\) position assignment operates by group/.test(sec("5.2")));
  A("...and says the caps apply unchanged when it is off",
    /the appearance limits of this rule apply to him unchanged/.test(sec("5.2")));
  A("5.3 only reports an out-of-group box score while the lock is on",
    /where the position lock is in force, appearing outside his position group, is reported automatically/.test(sec("5.3")));
  A("10.1 defines the position lock", /“Position lock” means the season setting/.test(sec("10.1")));
  A("...and lists it among the season settings", /and whether the position lock is in force/.test(sec("10.1")));
  A("the record says why it is a setting rather than a deletion", /"\(for now\)" is doing work in that sentence/.test(flat));
  A("...and names the two places that would have contradicted it within hours",
    /review_game_records/.test(flat) && /would have paged the Officials' desk about every legal lineup/.test(flat));
}

console.log("\n— 2. a trade no longer waits on three games; a waiver still does");
{
  A("the client's minimum-service text is waive-only", /regular-season games a player needs this season before he can be waived\."/.test(live));
  A("...and no longer says 'or traded'", !/before he can be waived or traded/.test(live));
  A("the trade picker greys nobody out", /return '<button class="gamecard" data-tpick-p="'\+p\.id\+'"/.test(live));
  A("the roster page still gates the WAIVE button", /only the WAIVE waits for his games now/.test(hub));
  A("...and the Trade button is outside that gate",
    /'<button class="btn btn-ghost btn-sm" data-trade="'\+p\.id\+'">Trade<\/button>'\+\s*\n\s*\(function\(\)\{ var mv = CG\.canMovePlayer/.test(hub));
  A("2.3 drops the proviso", /A traded player needs no minimum service: a club may trade a player on the day it acquires him/.test(sec("2.3")));
  A("...and the old proviso is gone", !/provided every player in the trade has appeared in three/.test(sec("2.3")));
  A("2.4 is a waive rule now", /A club may not waive a player who has appeared in fewer than three \(3\) regular-season games/.test(sec("2.4")));
  A("...and says so explicitly, with the date", /It does not apply to a trade: a club may trade a player it has never dressed/.test(sec("2.4")));
  A("10.1 redefines minimum service", /before his club may waive him \(Rule 2\.4\); it does not restrict a trade/.test(sec("10.1")));
  A("the record names all four callers and which two went",
    /accept_trade/.test(flat) && /guard_trade_insert/.test(flat) && /waive_player/.test(flat));
  A("...and why accept_trade was edited by text replace", /rather than by re-typing a hundred lines/.test(flat));
}

console.log("\n— 3. the weekly roster freeze");
{
  A("the client mirrors the window", /CG\.rosterFreeze = function\(at\)\{/.test(live));
  A("...in Eastern wall clock", /timeZone:"America\/New_York"/.test(live) && /dow==="Wed" && mins >= 19\*60\+30/.test(live));
  A("...covering Thursday and Friday whole", /dow==="Thu" \|\| dow==="Fri"/.test(live));
  A("the roster buttons go dead in the window", /var fz = CG\.rosterFreeze \? CG\.rosterFreeze\(\) : \{ on:false \};/.test(hub) && /frozen<\/span>/.test(hub));
  A("...for both directions, from the one button", /\(p\.squad==="tc" \? "Call up" : "To camp"\)\+'<\/button>'\+/.test(hub));
  A("2.1 carries the freeze", /the roster freezes each week from Wednesday at 7:30 PM Eastern Time/.test(sec("2.1")));
  A("...naming the availability hour it starts at", /the hour availability is due under Rule 5\.1/.test(sec("2.1")));
  A("...with the reason", /The week's games are played against the roster a club held when the week's first puck dropped/.test(sec("2.1")));
  A("...and the league-office door", /The league office may move a player in the window where a club would otherwise be unable to ice a lineup/.test(sec("2.1")));
  A("the record puts it on the trigger, not the two doors",
    /enforced on the TRIGGER, guard_squad_move, and not on set_roster_squad and swap_roster_squad/.test(flat));
  A("...and justifies both bypasses", /trusted_writer\(\), because the league's own automation/.test(flat));
  A("...and records the DST probes", /after the November 1 fall back/.test(flat));
  A("...and that the first freeze rehearsal was invalid, and why",
    /the first attempt as a commissioner sailed through and the bypass was the reason/.test(flat));
}

console.log("\n— the caps the announcement kept");
{
  A("6 games for a rostered player is still the rule", /No active-roster player — skater or goaltender — may be dressed in more than six \(6\) games in a game-week/.test(sec("5.2")));
  A("3 games for a camp player is still the rule", /Training-camp players are subject to a cap of three \(3\) games in a game-week/.test(sec("5.2")));
  A("...and the built site carries both", /more than six \(6\) games in a game-week/.test(html) && /cap of three \(3\) games in a game-week/.test(html));
  A("the changelog records v3.40", rb.changelog.some((e) => e.version === "3.40"));
  A("no em dash or spaced hyphen in the record", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
