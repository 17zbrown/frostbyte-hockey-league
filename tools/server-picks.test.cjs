/* v2.96 — the league's server list, the standard server, the player's suggestion, and the
   nightly ask for picks that have not been filed.

   The list changed (NA East retired, NA Southeast and NA West added) and the standard server
   became NA Central. Four separate copies of that list exist by necessity: the browser, the
   pickup bot, the scheduler's Discord copy and the database resolver. This file is what keeps
   them from drifting apart. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 200))); }
}

const hub = R("src/live/part6_hub.js");
const live = R("src/live/part_live.js");
const head = R("src/live/part1_head.html");
const sched = R("netlify/functions/discord-scheduler.js");
const ops = R("netlify/functions/discord-ops.js");
const lfg = R("netlify/functions/discord-interactions.js");
const admin = R("src/live/part7_admin.js");

const WANT = ["NA Northeast", "NA Southeast", "NA Central", "NA West"];
const STD = "NA Central";

console.log("\n— the list is the same list everywhere");
{
  const m = hub.match(/CG\.SERVERS = (\[[^\]]*\]);/);
  A("CG.SERVERS is set", !!m);
  const browser = m ? JSON.parse(m[1].replace(/'/g, '"')) : [];
  A("the browser offers exactly the four the commissioner named", JSON.stringify(browser) === JSON.stringify(WANT), JSON.stringify(browser));

  const lm = lfg.match(/const SERVERS = (\[[^\]]*\]);/);
  A("the pickup bot has the same four, in the same order", lm && JSON.stringify(JSON.parse(lm[1])) === JSON.stringify(WANT), lm && lm[1]);

  const sm = sched.match(/const SERVER_LIST = (\[[^\]]*\]);/);
  A("the scheduler quotes the same four", sm && JSON.stringify(JSON.parse(sm[1])) === JSON.stringify(WANT), sm && sm[1]);

  /* NA East is retired: a stray copy would offer a server the resolver cannot settle on */
  for (const [label, src] of [["the browser", hub], ["the live layer", live], ["the pickup bot", lfg],
                              ["the scheduler", sched], ["the settings-sheet templates", admin]]) {
    A(label + " no longer names NA East", !src.includes("NA East"));
  }
}

console.log("\n— the standard server");
{
  A("CG.DEFAULT_SERVER is " + STD, new RegExp('CG\\.DEFAULT_SERVER = "' + STD + '"').test(hub));
  A("it is one of the four", WANT.includes(STD));
  A("the scheduler's copy agrees", new RegExp('const DEFAULT_SERVER = "' + STD + '"').test(sched));
  /* the desk has to say what happens when a club files nothing, BEFORE it files nothing */
  A("a club with no pick is told where the game lands", /No pick from either club and this game is played on/.test(hub));
  A("the home side shows it only while unfilled", /\(mine\.pref1 \? "" : noPick\)/.test(hub));
  A("the away side shows it only while unfilled", /\(\(mine\.veto\|\|mine\.preferred\) \? "" : noPick\)/.test(hub));
}

console.log("\n— a player's suggested server");
{
  A("the column rides down with the league load", /departments,timezone,preferred_server"/.test(live));
  A("every roster player carries it", /server: p\.preferred_server \|\| null,/.test(live));
  A("Settings offers the choice", /id="sSrvLive"/.test(live));
  A("No preference is a real answer", /<option value="">No preference<\/option>/.test(live));
  A("the options come from the league's list, not a second copy", /\(CG\.SERVERS\|\|\[\]\)\.map/.test(live));
  A("a server off the list is refused rather than stored", /indexOf\(srv\)<0\)\{ CG\.toast\("That server is not one the league plays on"/.test(live));
  A("the write goes through the fail-loud select\\(\\)", /preferred_server:srv\|\|null \}\)\.eq\("id",CG\.auth\.user\.id\)\.select\("id"\)/.test(live));
  A("the loaded roster row is repainted, so the board does not need a reload", /lp\.id===CG\.auth\.user\.id\) lp\.server=srv\|\|null/.test(live));
}

console.log("\n— what the club's management sees");
{
  A("CG.suggestedServers counts the roster", /CG\.suggestedServers = function\(club\)/.test(hub));
  A("CG.serverSuggestCard draws it", /CG\.serverSuggestCard = function\(club\)/.test(hub));
  A("the schedule desk draws it once, not per game", (live.match(/CG\.serverSuggestCard\(club\)/g) || []).length === 1);
  A("it says the picks are still management's", /A suggestion, not a vote/.test(hub));
  A("it names the standard server", /played on <b>'\+esc\(CG\.DEFAULT_SERVER\)/.test(hub));
  A("the bars have CSS", /\.srv-bar\{/.test(head) && /\.srv-who\{/.test(head));
  A("it re-flows on a phone", /@media\(max-width:560px\)\{\.srv-nm\{/.test(head));

  /* the counting itself: run the two functions against a stub league */
  const CG = { SERVERS: WANT, DEFAULT_SERVER: STD, lg: { byTeam: { BOS: [
    { tag: "a", server: "NA Central" }, { tag: "b", server: "NA Central" },
    { tag: "c", server: "NA West" }, { tag: "d", server: null },
    { tag: "e", server: "NA Atlantis" },        /* a server the league does not play on */
  ] } } };
  const src = hub.slice(hub.indexOf("CG.suggestedServers = function"), hub.indexOf("CG.serverSuggestCard = function"));
  new Function("CG", "esc", src)(CG, (x) => x);
  const s = CG.suggestedServers("BOS");
  A("the most-suggested server comes first", s.top === "NA Central", s.top);
  A("only real servers are counted", s.rows.length === 2, JSON.stringify(s.rows));
  A("no preference and an unknown server both count as unanswered", s.none === 2 && s.answered === 3, s.none + "/" + s.answered);
  A("a club nobody has answered for is empty, not an error", CG.suggestedServers("NOPE").rows.length === 0);
}

console.log("\n— the nightly ask for picks that are still open");
{
  A("the step exists", /async function serverPickReminder\(/.test(sched));
  A("it runs on the tick", /sum\.serverPicks = await serverPickReminder\(/.test(sched));
  A("it opens 90 minutes before the night's first puck drop", /const SERVER_PICK_LEAD_MS = 90 \* 60000;/.test(sched));
  A("it reads the night's own first puck drop, not a clock", /const opensAt = firstAt - SERVER_PICK_LEAD_MS;/.test(sched));
  A("it stays open until the picks actually freeze", /const l = nightLockAt\(byDay\[d\]\);/.test(sched));
  A("it is claimed once per ET day", /claim\("server_pick_reminder", ref\)/.test(sched));
  A("a failed post keeps its retry", /release\("server_pick_reminder", ref\)/.test(sched));
  A("it can be paused with no deploy", /app_config\.server_pick_reminder_enabled/.test(sched));
  A("a night where everyone has filed gets NO post", /if \(!missing\) return `\$\{ymd\}: every club has filed its picks, nothing to ask`;/.test(sched));
  A("one role covers the front offices", /roles\["cghl management"\]/.test(sched));
  A("the post names the standard server", /the game is played on \$\{DEFAULT_SERVER\}/.test(sched));
  A("the post lists the servers", /\$\{SERVER_LIST\.join\(", "\)\}/.test(sched));
  A("it points at the desk that sets them", /#\/hub\/schedule/.test(sched));
  A("the ops door can send it early", /post=server-reminder/.test(ops) && /runServerPickReminder/.test(ops));
  A("the game-night post has the same door", /post=game-night/.test(ops) && /runGameNight/.test(ops));
  A("...and it can never be forced before the lock, because the board is the gate",
    /It cannot be forced EARLY/.test(sched));
  A("...and a dry run takes no claims", /a dry run must not take the claims/.test(sched));
  A("the scheduler exports that door", /export async function runServerPickReminder/.test(sched));

  /* what counts as an answer: a row of nulls is not one */
  const vm = sched.match(/const vetoAnswered = ([^;]+);/);
  A("vetoAnswered is defined", !!vm);
  const vetoAnswered = new Function("return " + vm[1])();
  A("no row at all is unanswered", !vetoAnswered(null, true) && !vetoAnswered(undefined, false));
  A("a row of nulls is unanswered", !vetoAnswered({ pref1: null, pref2: null, veto: null, preferred: null }, true));
  A("the home club answers with a 1st choice", vetoAnswered({ pref1: "NA West" }, true));
  A("a home club's 2nd choice alone is not an answer", !vetoAnswered({ pref2: "NA West" }, true));
  A("the away club answers with a veto", vetoAnswered({ veto: "NA West" }, false));
  A("...or with a preferred", vetoAnswered({ preferred: "NA West" }, false));
  A("the away club's pref1 is not its answer", !vetoAnswered({ pref1: "NA West" }, false));
}

console.log("\n— the rulebook carries the procedure it is cited for");
{
  const content = R("src/live/part3_content.js");
  const obj = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  let s42 = null, s101 = null;
  for (const ch of obj.rulebook.chapters) for (const sec of ch.sections) {
    if (sec.id === "4.2") s42 = sec;
    if (sec.id === "10.1") s101 = sec;
  }
  A("Rule 4.2 exists", !!s42);
  A("its title covers servers as well as codes", /server selection/i.test(s42.title), s42 && s42.title);
  const body = s42.paragraphs.join(" ");
  for (const sv of WANT) A("4.2 names " + sv, body.includes(sv));
  A("4.2 does not offer NA East", !body.includes("NA East"));
  A("4.2 names the standard server", /standard server, which is NA Central/.test(body));
  A("4.2 sets out home's two choices and away's veto", /first choice and a second choice/.test(body) && /the one server it will not play on, its veto/.test(body));
  A("4.2 states the order of resolution", /unless the Away club vetoed it/.test(body));
  A("4.2 states the freeze", /thirty \(30\) minutes before that night's first scheduled puck drop/.test(body));
  A("4.2 states the nightly ask", /ninety \(90\) minutes before the night's first puck drop/.test(body));
  A("4.2 says a player's suggestion is advisory", /Those answers are advisory/.test(body));
  A("10.1 defines the standard server", /Standard server/.test(s101.paragraphs.join(" ")));
  A("10.1 defines the veto", /the one server the Away club declares it/.test(s101.paragraphs.join(" ")));
  A("4.2 records the notice the office owes each club", /the league office posts each club, in its own club room, a single notice/.test(body));
  A("...and that none of it goes out early", /Nothing of that notice is sent before the night\s+locks/.test(body.replace(/\s+/g, " ")) || /Nothing of that notice is sent before the night locks/.test(body));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
