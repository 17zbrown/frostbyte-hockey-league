// Tonight's lineup call: the nightly post that asks the front offices for that night's sheets by
// the moment the night's FIRST game locks. Run: node tools/lineup-reminder.test.mjs
//
// Commissioner's ruling (2026-09-22): clubs set lines the DAY OF, not for the whole week at once.
// What must never break: the deadline is derived from the night's own first puck drop (8:30 PM for
// a 9:00 start) and never pinned to a clock, so a shifted or rescheduled night moves with it; the
// window opens four hours out and stays open until that first lock, claimed once per ET day; the
// post counts only TONIGHT's sheets, not the week's; and it never implies the later games lock at
// 8:30 too, because Rule 5.3 locks each game 30 minutes before its own puck drop.
process.env.SUPABASE_URL = "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
process.env.DISCORD_BOT_TOKEN = "t";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const H = 3600 * 1000, MIN = 60000;
const TEAMS = [
  { id: "t1", code: "BOS", name: "Bruins", discord_channel_id: "ch1" },
  { id: "t2", code: "DAL", name: "Stars", discord_channel_id: "ch2" },
];
const ROLES = JSON.stringify({ owner: "OWN", "general manager": "GM", "assistant general manager": "AGM", "cghl management": "MGMT" });

let games, posts, claims, released, cfgRows, lineups, postStatus;
/* first puck drop `leadH` hours from now, then two more games 35 minutes apart */
function reset(over = {}) {
  const first = Date.now() + (over.leadH ?? 3) * H;
  games = over.games || [0, 35, 70].map((m, i) => ({
    id: `g${i}`, week: 1, stage: "regular", voided: false, status: "scheduled",
    home_team_id: i % 2 ? "t2" : "t1", away_team_id: i % 2 ? "t1" : "t2",
    scheduled_at: new Date(first + m * MIN).toISOString(),
  }));
  lineups = over.lineups || [{ game_id: "g0", team_id: "t1" }];
  cfgRows = over.cfgRows || [
    { key: "discord_mgmt_room_management_announcements_id", value: "mgmtroom" },
    { key: "discord_role_ids", value: ROLES },
  ];
  postStatus = over.postStatus || 204;
  posts = []; claims = new Set(); released = [];
}
reset();

globalThis.fetch = async (url, init = {}) => {
  const u = String(url), m = (init.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (u.includes("/rest/v1/rpc/week_availability_deadline")) return J(null);   // the weekly half stands down
  if (u.includes("/rest/v1/rpc/availability_missing")) return J([]);
  if (u.includes("/rest/v1/game_lineups")) return J(lineups);
  if (u.includes("/rest/v1/app_config")) {
    if (m !== "GET") return new Response(null, { status: 201 });
    if (u.includes("key=eq.")) return J([]);
    return J(cfgRows);
  }
  if (u.includes("/rest/v1/seasons")) return J([{ id: "S1", number: 1 }]);
  if (u.includes("/rest/v1/teams")) return J(TEAMS);
  if (u.includes("/rest/v1/games")) return J(games);
  if (u.includes("/rest/v1/discord_post_log")) {
    if (m === "POST") {
      const b = JSON.parse(init.body), k = `${b.kind}/${b.ref}`;
      if (claims.has(k)) return new Response(null, { status: 409 });
      claims.add(k); return new Response(null, { status: 201 });
    }
    if (m === "DELETE") { released.push(decodeURIComponent(u.split("ref=eq.")[1] || "")); return new Response(null, { status: 204 }); }
  }
  if (/discord\.com\/api\/v10\/channels\/[^/]+\/messages/.test(u)) {
    if (postStatus !== 204) return new Response("no", { status: postStatus });
    posts.push({ channel: u.match(/channels\/([^/]+)\//)[1], ...JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  }
  return J([]);
};

const mod = await import(new URL("../netlify/functions/discord-scheduler.js", import.meta.url).pathname);
const tick = () => mod.default(new Request("https://x/.netlify/functions/discord-scheduler"));
const now = (dry = false) => mod.runLineupReminder({ dry });
/* the ordinary tick ALSO fires the club game-night reminders through postChannel, so a count of
   every post is not a count of this one */
const calls = () => posts.filter((p) => p.channel === "mgmtroom");

console.log("— the call itself");
{
  reset();
  const r = await now();
  A("the run is clean", r.ok && r.errors.length === 0, JSON.stringify(r.errors));
  A("one post, to the management room", posts.length === 1 && posts[0].channel === "mgmtroom");
  const c = posts[0].content;
  A("it pings the one management role", /<@&MGMT>/.test(c) && !/<@&OWN>/.test(c));
  A("it says tonight, and how many games", /\*\*Tonight: 3 games/.test(c), c.split("\n")[1].slice(0, 90));
  A("it names the deadline as the night's FIRST lock", /All of tonight's sheets are due by .* when the night's first game locks/.test(c.replace(/\*/g, "")), c.split("\n")[2]);
  A("...counting only tonight's sheets (6 slots, 1 filed)", /Still to file tonight: \*\*5 of 6\*\*/.test(c), c.split("\n")[3]);
  A("...naming the clubs", /BOS 2/.test(c) && /DAL 3/.test(c), c.split("\n")[3]);
  A("it does NOT claim the later games lock then (Rule 5.3)",
    /own lock 30 minutes before its own puck drop/.test(c) && /can be changed until then at no cost/.test(c));
  A("...and still names the price of a post-lock change", /one in-game minor in that game/.test(c));
  A("no link preview", posts[0].flags === 4);
}

console.log("\n— the deadline is derived, never a fixed clock");
{
  reset();
  const r = await now(true);
  const firstPd = Math.min(...games.map((g) => Date.parse(g.scheduled_at)));
  A("due exactly 30 minutes before the night's first puck drop", Date.parse(r.lineups.dueAt) === firstPd - 30 * MIN,
    new Date(r.lineups.dueAt).toISOString() + " vs " + new Date(firstPd - 30 * MIN).toISOString());
  /* a night that starts at 8:15 must move its own deadline, not sit at 8:30 */
  reset({ leadH: 2.25 });
  const r2 = await now(true);
  A("...so a night that starts earlier moves its own deadline with it",
    Date.parse(r2.lineups.dueAt) === Math.min(...games.map((g) => Date.parse(g.scheduled_at))) - 30 * MIN);
}

console.log("\n— the window");
{
  reset({ leadH: 6 });
  let body = await (await tick()).json();
  A("six hours out it waits and says when it is due", /the reminder is due in \d+ min/.test(String(body.lineups)) && calls().length === 0, String(body.lineups));

  reset({ leadH: 3.5 });
  body = await (await tick()).json();
  A("inside four hours the ordinary tick sends it", calls().length === 1, String(body.lineups));

  reset({ leadH: 0.6 });
  body = await (await tick()).json();
  A("still open at T-36m, so a lost tick catches up", calls().length === 1, String(body.lineups));

  reset({ leadH: 0.4 });          // first lock already passed
  body = await (await tick()).json();
  A("once the first game has locked, tonight's call is over", calls().length === 0 && /no game night ahead/.test(String(body.lineups)), String(body.lineups));
}

console.log("\n— once a night, and only for that night");
{
  reset();
  await now();
  const first = posts.length;
  const again = await now();
  A("a second run posts nothing", posts.length === first && /already posted/.test(String(again.lineups)), String(again.lineups));
  A("the claim is keyed on the ET day", [...claims].length === 1 && /^lineup_reminder\/S1-\d{4}-\d{2}-\d{2}$/.test([...claims][0]), [...claims][0]);
}

console.log("\n— quiet and failure cases");
{
  reset({ lineups: [0, 1, 2].flatMap((i) => [{ game_id: `g${i}`, team_id: "t1" }, { game_id: `g${i}`, team_id: "t2" }]) });
  await now();
  A("a night with every sheet filed says so instead of a count", /Every sheet for tonight is already filed/.test(posts[0].content));

  for (const v of ["off", "paused", "false"]) {
    reset({ cfgRows: [{ key: "lineup_reminder_enabled", value: v }] });
    const r = await now();
    A(`"${v}" stops it`, posts.length === 0 && /^paused/.test(String(r.lineups)), String(r.lineups));
  }
  reset({ cfgRows: [{ key: "discord_role_ids", value: ROLES }] });
  let r = await now();
  A("an unset management room is reported as unconfigured", r.unconfigured.some((u) => /nightly lineup reminder/.test(u)) && posts.length === 0);

  reset({ postStatus: 403 });
  r = await now();
  A("a definitive rejection is reported and the claim handed back", /403/.test(String(r.errors[0])) && released.length === 1, JSON.stringify(r.errors));

  reset({ postStatus: 500 });
  r = await now();
  A("a 5xx keeps its claim", released.length === 0);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
