/* v2.95 — a player is TOLD when he is dressed, and a manager can see availability while he builds.
   Run: node tools/lineup-visibility.test.cjs
 *
 * Three things a club asked for on the eve of the season: tell the player himself when he is put
 * in a lineup (he had to go and look, or find out on game night); show the week's availability on
 * the page where lines are actually built; and give the per-game page a name and a place in the
 * nav, since it was routed but unlisted and named after its mechanism.
 */
const fs = require("fs"), path = require("path");
const hub = fs.readFileSync(path.join(__dirname, "..", "src/live/part6_hub.js"), "utf8");
const live = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "src/live/part1_head.html"), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the player is told");
{
  A("'lineups' notifications have their own icon, not the default bell", /lineups:"grid"/.test(live));
  A("...and so does the availability nudge", /availability:"cal"/.test(live));
  A("a notification carrying a game id lands on that game's matchup page",
    /case "game":\s*return p \? "#\/matchup\/"\+encodeURIComponent\(p\)/.test(live));
  /* the write itself lives in set_game_lineup (sql/2026-09-23-dressed-notifications.sql); what the
     client must get right is where it lands and what it looks like */
}

console.log("\n— availability, where the lines are built");
{
  A("every roster card carries the week's availability", /\(CG\.lcAvStrip\?CG\.lcAvStrip\(club,p\):""\)/.test(hub));
  A("...on the camp board too", (hub.match(/CG\.lcAvStrip\?CG\.lcAvStrip\(club,p\)/g) || []).length === 2);
  A("one mark per night, aggregated from that night's games",
    /var vals = games\.map\(function\(g\)\{ return CG\.avGame \? CG\.avGame\(av, n\.key, g\.id\) : "nr"; \}\);/.test(hub));
  A("all yes is yes, all no is no, a mix is neither, nothing is no answer",
    /var st  = \(yes === vals\.length\) \? "yes" : \(no === vals\.length\) \? "no" : \(yes \|\| no\) \? "mb" : "nr";/.test(hub));
  A("it uses the availability grid's own marks, so both pages read alike",
    /<span class="avcell '\+st\+'/.test(hub) && /\.lc-av-strip \.avcell\{width:15px/.test(css));
  A("a week with no games renders nothing rather than a row of dashes",
    /if \(!nights\.length \|\| !CG\.avFor\) return "";/.test(hub));
}

console.log("\n— the per-game page is findable and named for the job");
{
  A("it is in the club nav", /club\.push\(\["lineup","Game lineups","cal"\]\)/.test(hub));
  A("...beside the board, which keeps its own name", /club\.push\(\["lines","Lineup builder","grid"\]\)/.test(hub));
  A("the page calls itself a game lineup", /Game lineup'\+nightSwitch/.test(hub) && !/>Per-game adjustments/.test(hub));
}

console.log("\n— one box, two pages");
{
  A("a line slot wears the per-game slot's anatomy: position, name, rating",
    /<span class="sl-pos">'\+CG\.POS_NAME\[pos\]\+'<\/span>/.test(hub) &&
    /<span class="sl-name">'\+esc\(pl\.tag\)\+'<\/span><span class="sl-sub">OVR /.test(hub));
  A("...and an empty one says so", /<span class="sl-sub">Empty<\/span>/.test(hub));
  A("the avatar is gone from the line slot, which crowded the name six across",
    !/CG\.lcAv\(pl,26\)/.test(hub));
  A("the styles exist for the grid's scale", /\.lc-slot \.sl-pos\{/.test(css) && /\.lc-slot \.sl-name\{/.test(css) && /\.lc-slot \.sl-sub\{/.test(css));
  A("the drag and drop still keys on the slot itself, untouched",
    /document\.querySelectorAll\("\.lc-slot"\)/.test(hub) && /data-line="'\+n\+'" data-slot="'\+pos\+'"/.test(hub));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
