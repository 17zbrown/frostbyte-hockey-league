/* v3.03 — a matchup shows LIVE only while it is being played, and only if somebody in THAT
 * matchup is on air.
 *
 * Commissioner, game night one: "dont show the live asset unless you notice any streams from any
 * of the players on either team in any of those matchups" ... "and its past the scheduled game
 * time and until 30 mins later".
 *
 * Before this CG.liveStreamers had no clock at all: one streamer lit every game his club played
 * that night, so at 9:20 PM the 10:10 card was already flashing LIVE.
 *
 * The 30 minutes is not arbitrary and must not be widened casually: the night's games start 35
 * minutes apart, so anything longer lights the next slot's card while the current game is still on.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 200))); }
}

const pub = R("src/live/part5a_public.js");
const ui = R("src/live/part4_ui.js");
const head = R("src/live/part1_head.html");

/* run the real functions against a stub league */
const src = pub.slice(pub.indexOf("CG.GAME_LIVE_MS"), pub.indexOf("CG.twitchChip"));
const MIN = 60000;
function world(nowMs, players) {
  const CG = { now: () => nowMs, lg: { players } };
  new Function("CG", src)(CG);
  return CG;
}
const PIT_ON = [{ team: "PIT", tag: "zackbrown17", twitch: "zack_brown17", twitchLive: true }];
const GAME = { at: 1000000, home: "PIT", away: "UTA" };

console.log("\n— the window");
{
  const at = GAME.at;
  const cases = [
    ["an hour before puck drop", at - 60 * MIN, false],
    ["one minute before puck drop", at - 1 * MIN, false],
    ["exactly at puck drop", at, true],
    ["fifteen minutes in", at + 15 * MIN, true],
    ["exactly thirty minutes in", at + 30 * MIN, true],
    ["thirty-one minutes in", at + 31 * MIN, false],
    ["two hours later", at + 120 * MIN, false],
  ];
  for (const [label, now, want] of cases) {
    const CG = world(now, PIT_ON);
    A(`${label}: ${want ? "LIVE" : "not live"}`, CG.gameOnAir(GAME) === want, String(CG.gameOnAir(GAME)));
    A(`  ...and liveStreamers agrees`, (CG.liveStreamers(GAME).length > 0) === want);
  }
}

console.log("\n— only somebody in THIS matchup counts");
{
  const now = GAME.at + 5 * MIN;
  A("a streamer on the home club counts", world(now, PIT_ON).liveStreamers(GAME).length === 1);
  A("a streamer on the away club counts",
    world(now, [{ team: "UTA", tag: "x", twitch: "x", twitchLive: true }]).liveStreamers(GAME).length === 1);
  A("a streamer on a club NOT in this game does not",
    world(now, [{ team: "DAL", tag: "x", twitch: "x", twitchLive: true }]).liveStreamers(GAME).length === 0);
  A("a player in this game who is not on air does not",
    world(now, [{ team: "PIT", tag: "x", twitch: "x", twitchLive: false }]).liveStreamers(GAME).length === 0);
  A("a player on air with no handle to send anyone to does not",
    world(now, [{ team: "PIT", tag: "x", twitch: "", twitchLive: true }]).liveStreamers(GAME).length === 0);
  A("two on air give two links", world(now, PIT_ON.concat([{ team: "UTA", tag: "y", twitch: "y", twitchLive: true }])).liveStreamers(GAME).length === 2);
}

console.log("\n— a game with no time is never on air");
{
  const CG = world(GAME.at, PIT_ON);
  A("no scheduled_at, no badge", CG.gameOnAir({ home: "PIT", away: "UTA" }) === false);
  A("...and no streamers", CG.liveStreamers({ home: "PIT", away: "UTA" }).length === 0);
}

console.log("\n— the window is stated, and stated once");
{
  A("the constant is named", /CG\.GAME_LIVE_MS = 30\*60000;/.test(pub));
  A("both bands go through liveStreamers", (pub.match(/CG\.liveStreamers\(g\)/g) || []).length === 2,
    String((pub.match(/CG\.liveStreamers\(g\)/g) || []).length));
  /* flatten: the reason lives in a wrapped comment and a pin must not depend on where it wraps */
  A("the reason the window is 30 and not more is written down",
    /games start 35 minutes apart/.test(pub.replace(/\s+/g, " ")));
}

console.log("\n— the watch link actually opens the stream");
{
  A("the tonight card renders a watch chip per streamer", /data-twitch="'\+esc\(p\.twitch\)\+'"/.test(pub));
  A("...styled as a link for assistive tech", /role="link" tabindex="0"/.test(pub));
  A("...and it is NOT a nested anchor", !/rg-watch[\s\S]{0,200}<a /.test(pub));
  A("the reason a span is used instead of an anchor is recorded", /an <a> inside an <a> is invalid HTML/.test(pub));

  A("the click handler exists", /e\.target\.closest\("\[data-twitch\]"\)/.test(ui));
  A("...and runs BEFORE the card's own routing", ui.indexOf('closest("[data-twitch]")') < ui.indexOf('closest("[data-go]")'));
  A("...and says why that order matters", /or the card would swallow the click/.test(ui));
  A("...stopping the card from routing", /e\.preventDefault\(\); e\.stopPropagation\(\);/.test(ui));
  A("...opening Twitch in a new tab safely", /window\.open\("https:\/\/twitch\.tv\/" \+ encodeURIComponent\(h\), "_blank", "noopener"\)/.test(ui));
  A("...after normalizing whatever shape the handle was stored in",
    /replace\(\/\^@\/, ""\)/.test(ui) && /twitch\\\.tv/.test(ui));
  A("the keyboard reaches it too", /getAttribute\("data-twitch"\)\)\{\s*\n?\s*e\.preventDefault\(\); e\.stopPropagation\(\); e\.target\.click\(\)/.test(ui));

  A("the chips have styling", /\.rg-watch \.tw-go\{/.test(head) && /#9146FF/.test(head));
  A("...and wrap rather than overflow", /\.rg-watch\{display:flex;flex-wrap:wrap/.test(head));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
