// Instant incident rulings (Rules 3.2 and 4.3). The ladder must match the database copy exactly,
// and the two clubs must get DIFFERENT sentences — the offender learns what it owes, the other
// learns the choice is theirs. Run: node tools/incident-rulings.test.mjs
import { ruling, createIncidentNotifier } from "../bot/incidents.mjs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— Rule 3.2, by the clock");
{
  A("under five minutes owes nothing", ruling({ kind: "late_start", minutes_late: 4 }).penalties === 0);
  A("five minutes owes one", ruling({ kind: "late_start", minutes_late: 5 }).penalties === 1);
  A("seven minutes still owes one", ruling({ kind: "late_start", minutes_late: 7 }).penalties === 1);
  A("eight minutes owes two", ruling({ kind: "late_start", minutes_late: 8 }).penalties === 2);
  const two = ruling({ kind: "late_start", minutes_late: 9 });
  A("...and names the choice", /5-on-3/.test(two.detail) && /5-on-4/.test(two.detail));
  const ff = ruling({ kind: "late_start", minutes_late: 10 });
  A("ten minutes is a forfeit", ff.forfeit === true && ff.penalties === -1);
  A("...and says it cannot be waived", /not waivable/i.test(ff.detail));
  A("no statistics survive a no-show forfeit", /no individual statistics/i.test(ff.detail));
}

console.log("\n— Rule 4.3, by the occurrence");
{
  const one = ruling({ kind: "disconnect", occurrence: 1 });
  A("first drop owes one", one.penalties === 1 && !one.forfeit);
  A("...timed to the drop", /within one minute/i.test(one.detail));
  const two = ruling({ kind: "disconnect", occurrence: 2 });
  A("second drop owes two", two.penalties === 2);
  A("...with the same choice as a late start", /5-on-3/.test(two.detail) && /5-on-4/.test(two.detail));
  const three = ruling({ kind: "disconnect", occurrence: 3 });
  A("third drop ends the game", three.forfeit === true);
  A("...keeping every statistic", /ALL statistics are retained/.test(three.detail));
  A("...and publishing as FFL even when ahead", /FFL/.test(three.detail) && /more goals/.test(three.detail));
}

console.log("\n— third-period timing");
{
  const t = ruling({ kind: "disconnect", occurrence: 1, period: 3, game_clock: "3rd 12:20" });
  A("a third-period drop shifts the penalty earlier", /five minutes of game clock EARLIER/.test(t.detail));
  A("...and quotes the clock", /3rd 12:20/.test(t.detail));
  const early = ruling({ kind: "disconnect", occurrence: 1, period: 3, early_third: true });
  A("inside the first five minutes, a single period is replayed", /entire first period as if it were the third/.test(early.detail));
  A("...with penalties as soon as possible", /as soon as possible after puck drop/.test(early.detail));
  A("...and NOT the five-minutes-earlier instruction", !/EARLIER/.test(early.detail));
  const p2 = ruling({ kind: "disconnect", occurrence: 1, period: 2 });
  A("a second-period drop gets no timing note", !/EARLIER/.test(p2.detail) && !/entire first period/.test(p2.detail));
}

/* ---- the announcement: two clubs, two different sentences ---- */
const GAME = { id: "g1", week: 4, stage: "regular", scheduled_at: "2026-10-21T21:00:00-04:00",
  home_team_id: "T1", away_team_id: "T2" };
const TEAMS = [
  { id: "T1", code: "BOS", name: "Bruins", discord_channel_id: "chan-bos" },
  { id: "T2", code: "TOR", name: "Maple Leafs", discord_channel_id: "chan-tor" },
];
let posts = [];
let failChannel = null;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  if (u.includes("/rest/v1/games?id=eq.g1")) return J([GAME]);
  if (u.includes("/rest/v1/teams?id=in.")) return J(TEAMS);
  const m = u.match(/channels\/([\w-]+)\/messages/);
  if (m && opts.method === "POST") {
    if (m[1] === failChannel) return J({ message: "Unknown Channel" }, 404);
    posts.push({ channel: m[1], body: JSON.parse(opts.body) });
    return J({ id: "msg" + posts.length });
  }
  return J([]);
};
const N = createIncidentNotifier({ SB_URL: "https://sb.invalid", SB_KEY: "k", BOT: "tok" });
const text = (p) => JSON.stringify(p.body);

console.log("\n— both clubs are told, and told different things");
{
  posts = [];
  const r = await N.announce({ game_id: "g1", team_id: "T1", kind: "late_start", minutes_late: 8, occurrence: 1 });
  A("the announcement goes out", r === "announced" && posts.length === 2);
  const off = posts.find((p) => p.channel === "chan-bos"), opp = posts.find((p) => p.channel === "chan-tor");
  A("the offending club is told what it owes", /BOS owes 2 penalt/.test(text(off)));
  A("the other club is told the choice is theirs", /Your call/.test(text(opp)));
  A("...and who to tell", /Tell BOS before the puck drops/.test(text(opp)));
  A("the waiver is mentioned to the club that can grant it", /agree to waive/.test(text(opp)));
  A("...and only to that club", !/agree to waive/.test(text(off)));
  A("neither message pings anyone", posts.every((p) => p.body.allowed_mentions.parse.length === 0));
  A("the fixture is named", /week 4/.test(text(off)));
}

console.log("\n— a forfeit reads as a forfeit on both sides");
{
  posts = [];
  await N.announce({ game_id: "g1", team_id: "T2", kind: "late_start", minutes_late: 12, occurrence: 1 });
  const off = posts.find((p) => p.channel === "chan-tor"), opp = posts.find((p) => p.channel === "chan-bos");
  A("the late club is told it forfeited", /Forfeit/.test(text(off)));
  A("the ready club is told it won", /ruled in your favour/.test(text(opp)));
  A("no waiver is offered on a forfeit", !/agree to waive/.test(text(opp)));
}

console.log("\n— failures never pretend to have delivered");
{
  posts = []; failChannel = "chan-bos";
  const r = await N.announce({ game_id: "g1", team_id: "T1", kind: "disconnect", occurrence: 2 });
  A("a dead channel makes the run an error", r === "error");
  A("...and is recorded", N.errors.length > 0);
  failChannel = null;
  posts = [];
  const r2 = await N.announce({ game_id: "g1", team_id: "T1", kind: "disconnect", occurrence: 1 });
  A("the next one still goes out", r2 === "announced" && posts.length === 2);
  const bad = await N.announce({ game_id: "nope", team_id: "T1", kind: "disconnect", occurrence: 1 });
  A("an unknown game is skipped, not crashed", bad === "no-game");
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
