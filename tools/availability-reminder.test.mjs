// The weekly availability + lineup reminder, 24 hours before a week's window closes (Rule 5.1).
// Run: node tools/availability-reminder.test.mjs
//
// This is the runtime half: the real step runs against a stubbed Supabase and a stubbed Discord.
// A static grep cannot see a ReferenceError in a branch that only fires one hour a week, and that
// is exactly how the sign-up notice was dark for four days (tools/signup-reminder.test.mjs).
//
// What must never break: the window opens at the deadline minus 24 hours and STAYS open (a missed
// tick catches up, it does not skip the week); one claim per club plus one for the front offices,
// so a second tick posts nothing and one club's failure never re-posts to the other seven; the
// club room names the players who have not answered, by mention, and says nothing when they all
// have; the management post pings the three front-office roles and nobody else; and the copy never
// claims lineups lock at the availability deadline, because they lock 30 minutes before each game
// (Rule 5.3).
process.env.SUPABASE_URL = "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
process.env.DISCORD_BOT_TOKEN = "t";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const H = 3600 * 1000;

const TEAMS = [
  { id: "t1", code: "BOS", name: "Bruins", discord_channel_id: "ch1", discord_role_id: "r1" },
  { id: "t2", code: "DAL", name: "Stars", discord_channel_id: "ch2", discord_role_id: "r2" },
  { id: "t3", code: "VAN", name: "Canucks", discord_channel_id: "ch3", discord_role_id: "r3" },
];
const ROLE_IDS = JSON.stringify({ owner: "OWN", "general manager": "GM", "assistant general manager": "AGM", player: "PL", "cghl management": "MGMT" });
/* a guild that has not got the one-role-for-the-front-office role yet */
const ROLE_IDS_OLD = JSON.stringify({ owner: "OWN", "general manager": "GM", "assistant general manager": "AGM", player: "PL" });

let W, posts, claims, released, cfgRows, missing, lineups, postStatus;
/* `leadH` = how many hours from now the week's availability deadline sits */
function reset(over = {}) {
  const leadH = over.leadH ?? 20;
  const dl = new Date(Date.now() + leadH * H);
  const first = new Date(dl.getTime() + 90 * 60000);          // the deadline is 90 min before the first game
  W = {
    deadlines: over.deadlines || { w1: dl.toISOString() },
    games: over.games || [
      { id: "g1", week: 1, stage: "regular", home_team_id: "t1", away_team_id: "t2", scheduled_at: first.toISOString(), voided: false, status: "scheduled" },
      { id: "g2", week: 1, stage: "regular", home_team_id: "t3", away_team_id: "t1", scheduled_at: new Date(first.getTime() + 35 * 60000).toISOString(), voided: false, status: "scheduled" },
    ],
    teams: over.teams || TEAMS,
  };
  missing = over.missing || [
    { profile_id: "p1", team_id: "t1", gamertag: "AlphaGoalie", discord_id: "d1" },
    { profile_id: "p2", team_id: "t1", gamertag: "BravoWinger", discord_id: "d2" },
    { profile_id: "p3", team_id: "t2", gamertag: "NoDiscord", discord_id: null },
  ];
  lineups = over.lineups || [{ game_id: "g1", team_id: "t1" }];
  cfgRows = over.cfgRows || [
    { key: "discord_mgmt_room_management_announcements_id", value: "mgmtroom" },
    { key: "discord_role_ids", value: ROLE_IDS },
  ];
  postStatus = over.postStatus || 204;
  /* the nightly lineup call (tools/lineup-reminder.test.mjs) posts to the same room on the same
     tick; switch it off here so a count of these posts is a count of THIS step */
  cfgRows = cfgRows.concat([{ key: "lineup_reminder_enabled", value: "off" }]);
  posts = []; claims = new Set(); released = [];
}
reset();

globalThis.fetch = async (url, init = {}) => {
  const u = String(url), m = (init.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (u.includes("/rest/v1/rpc/week_availability_deadline")) {
    const key = JSON.parse(init.body).p_week_key;
    return J(W.deadlines[key] ?? null);
  }
  if (u.includes("/rest/v1/rpc/availability_missing")) return J(missing);
  if (u.includes("/rest/v1/game_lineups")) return J(lineups);
  if (u.includes("/rest/v1/app_config")) {
    if (m !== "GET") return new Response(null, { status: 201 });
    if (u.includes("key=eq.")) return J([]);            // the flood debounce asks for one key
    return J(cfgRows);
  }
  if (u.includes("/rest/v1/seasons")) return J([{ id: "S1", number: 1 }]);
  if (u.includes("/rest/v1/teams")) return J(W.teams);
  if (u.includes("/rest/v1/games")) return J(W.games);
  if (u.includes("/rest/v1/discord_post_log")) {
    if (m === "POST") {
      const b = JSON.parse(init.body), k = `${b.kind}/${b.ref}`;
      if (claims.has(k)) return new Response(null, { status: 409 });
      claims.add(k); return new Response(null, { status: 201 });
    }
    if (m === "DELETE") { released.push(decodeURIComponent(u.split("ref=eq.")[1] || "")); return new Response(null, { status: 204 }); }
  }
  if (/discord\.com\/api\/v10\/channels\/[^/]+\/messages/.test(u)) {
    const body = JSON.parse(init.body);
    if (postStatus !== 204 && postStatus !== 200) return new Response("nope", { status: postStatus });
    posts.push({ channel: u.match(/channels\/([^/]+)\//)[1], ...body });
    return new Response(null, { status: 204 });
  }
  if (u.includes("discord.com/api/webhooks")) return new Response(null, { status: 204 });
  return J([]);
};

const mod = await import(new URL("../netlify/functions/discord-scheduler.js", import.meta.url).pathname);
const tick = () => mod.default(new Request("https://x/.netlify/functions/discord-scheduler"));
const now = (dry = false) => mod.runAvailabilityReminder({ dry });
const club = (ch) => posts.find((p) => p.channel === ch);

console.log("— the club rooms");
{
  reset();
  const r = await now();
  A("the run is clean", r.ok && r.errors.length === 0, JSON.stringify(r.errors));
  A("every club with a game that week is reminded", posts.length === 4, `${posts.length} posts`);
  const bos = club("ch1");
  A("the deadline is named, with the rule", /Week 1 availability closes/.test(bos.content) && /Rule 5\.1/.test(bos.content), bos.content.split("\n")[0]);
  A("...and the players who have not answered are mentioned, not merely counted",
    /<@d1>/.test(bos.content) && /<@d2>/.test(bos.content) && /Still to answer \(2\)/.test(bos.content));
  A("a player with no Discord link is named in text rather than dropped", /NoDiscord/.test(club("ch2").content));
  A("the mention actually notifies him", JSON.stringify(bos.allowed_mentions) === JSON.stringify({ parse: ["users", "roles"] }));
  A("the link does not unfurl into a preview card (SUPPRESS_EMBEDS)", bos.flags === 4, JSON.stringify(bos.flags));
  A("the club's own games for the week are listed, grouped by night",
    /BOS this week \(times ET\): /.test(bos.content) && /vs DAL/.test(bos.content) && /at VAN/.test(bos.content)
    && /: \w{3} \d+:\d\d [AP]M (vs|at) \w+, \d+:\d\d [AP]M (vs|at) \w+$/.test(bos.content.split("\n").pop()), bos.content.split("\n").pop());
  A("the link goes to the availability page", /#\/hub\/availability/.test(bos.content));
  const van = club("ch3");
  A("a club with everyone in is told so, and pings nobody", /Nothing to do/.test(van.content) && !/<@/.test(van.content), van.content.split("\n")[1]);
}

console.log("\n— the management announcement");
{
  const mg = club("mgmtroom");
  A("it pings the one management role, not three (commissioner, 2026-09-22)",
    /<@&MGMT>/.test(mg.content) && !/<@&OWN>/.test(mg.content) && !/<@&GM>/.test(mg.content), mg.content.split("\n")[0]);
  A("...and nobody else", !/<@&PL>/.test(mg.content));
  /* v2.82 ruling: clubs set lines the DAY OF. The weekly post no longer asks for the week's sheets
     at once; it points at the nightly deadline and the reminder that carries it. */
  A("it does not ask for the whole week's lineups at once",
    /Lineups are set day by day/.test(mg.content) && /never asked to file the whole week at once/.test(mg.content), mg.content.split("\n")[2]);
  A("...it names the nightly deadline as that night's FIRST lock",
    /each night's sheets are due when that night's FIRST game locks/.test(mg.content) && /you get a reminder that afternoon/.test(mg.content));
  {
    /* on the week's first night that deadline is an hour after the window closes, which is the
       whole reason the hour was chosen; both times appear and must differ by 60 minutes */
    const hrs = mg.content.match(/\d+:\d\d [AP]M ET/g) || [];
    const mins = hrs.map((h) => { const [, H, M, ap] = h.match(/(\d+):(\d\d) ([AP]M)/); return ((+H % 12) + (ap === "PM" ? 12 : 0)) * 60 + +M; });
    A("...and that is an hour after availability closes on the week's first night",
      hrs.length >= 2 && ((mins[1] - mins[0] + 1440) % 1440) === 60, hrs.join(" then "));
  }
  A("it reports the week's filing progress (4 slots, 1 filed)", /Sheets filed for the week so far: \*\*1 of 4\*\*/.test(mg.content), mg.content.split("\n")[3]);
  A("...naming the clubs that still owe", /BOS 1/.test(mg.content) && /DAL 1/.test(mg.content) && /VAN 1/.test(mg.content));
  A("it carries the outstanding availability count", /Availability still outstanding: 3 players/.test(mg.content));
  A("it does NOT claim lineups lock at the availability deadline (Rule 5.3 is unchanged)",
    /locks 30 minutes before its own puck drop/.test(mg.content) && !/lineups lock at 7:30/i.test(mg.content));
  /* v3.08 — this pin used to demand the PRICE of a post-lock change: "one in-game minor per
     player changed". v3.05 abolished that penalty outright on the commissioner's ruling ("If a
     team needs a last minute switch, they are free to do so"), so the pin was asserting a rule
     the league no longer has, and the post it was holding in place was telling clubs to expect a
     penalty that does not exist. Re-pointed at what Rule 5.3 says now: the lock PUBLISHES the
     sheet, a late change is free, and the opponent is told. */
  A("...and it says what the lock actually does, not that it shuts the sheet",
    /publish the sheet to your opponent/.test(mg.content) && /it does not close it/.test(mg.content),
    mg.content.split("\n").pop().slice(0, 160));
  A("...and that a late change costs nothing",
    /at no cost/.test(mg.content) && !/in-game minor/.test(mg.content));
  A("...and that the other club is told", /reported to the other club automatically/.test(mg.content));
  A("...and it still names the conditions a late change has to meet",
    /active roster or in training camp/.test(mg.content) && /position rules/.test(mg.content));
  A("the lineup builder is linked", /#\/hub\/lineup/.test(mg.content));
}

{
  /* a guild without the combined role must still reach the front office, not silently ping nobody */
  const keep = posts.slice();
  reset({ cfgRows: [{ key: "discord_mgmt_room_management_announcements_id", value: "mgmtroom" }, { key: "discord_role_ids", value: ROLE_IDS_OLD }] });
  await now();
  const fb = club("mgmtroom");
  A("without that role it falls back to the three seats", /<@&OWN>/.test(fb.content) && /<@&GM>/.test(fb.content) && /<@&AGM>/.test(fb.content), fb.content.split("\n")[0]);
  posts.length = 0; posts.push(...keep);
}

console.log("\n— exactly once");
{
  const before = posts.length;
  const again = await now();
  A("a second run posts nothing", posts.length === before, `${posts.length - before} extra`);
  A("...and says so without erroring", again.ok && /reminded 0 clubs/.test(String(again.availability)), String(again.availability));
  A("the claims are per club plus one for the front offices",
    claims.size === 4 && [...claims].every((k) => k.startsWith("availability_reminder/S1-w1-")), [...claims].join(" "));
}

console.log("\n— the window");
{
  reset({ leadH: 30 });
  let body = await (await tick()).json();
  A("30 hours out it waits, and says when it is due", /the reminder is due in \d+ min/.test(String(body.availability)) && posts.length === 0, String(body.availability));

  reset({ leadH: 23.5 });
  body = await (await tick()).json();
  A("inside 24 hours the ordinary 5-minute tick sends it", posts.length === 4, String(body.availability));

  reset({ leadH: 0.5 });
  body = await (await tick()).json();
  A("a tick lost for a day catches up rather than skipping the week (still open at T-30m)", posts.length === 4, String(body.availability));

  reset({ leadH: -1, deadlines: { w1: new Date(Date.now() - H).toISOString(), w2: new Date(Date.now() + 20 * H).toISOString() },
    games: [
      { id: "g1", week: 1, stage: "regular", home_team_id: "t1", away_team_id: "t2", scheduled_at: new Date(Date.now() - H / 2).toISOString(), voided: false, status: "final" },
      { id: "g3", week: 2, stage: "regular", home_team_id: "t1", away_team_id: "t2", scheduled_at: new Date(Date.now() + 22 * H).toISOString(), voided: false, status: "scheduled" },
    ] });
  body = await (await tick()).json();
  A("once a week has closed it moves to the next one", /^week 2:/.test(String(body.availability)), String(body.availability));

  reset({ deadlines: {} });
  body = await (await tick()).json();
  A("no deadline (no schedule yet) is quiet, not an error", /no game week/.test(String(body.availability)) && posts.length === 0, String(body.availability));
}

console.log("\n— the off switch and the failure paths");
{
  for (const v of ["off", "paused", "false", "0", "no"]) {
    reset({ cfgRows: [{ key: "availability_reminder_enabled", value: v }, { key: "discord_role_ids", value: ROLE_IDS }] });
    const r = await now();
    A(`"${v}" stops it`, posts.length === 0 && /^paused/.test(String(r.availability)), String(r.availability));
  }
  reset({ teams: [TEAMS[0], { ...TEAMS[1], discord_channel_id: null }, TEAMS[2]] });
  let r = await now();
  A("a club with no Discord room is reported, and the others are still reminded",
    r.errors.some((e) => /DAL has no Discord room/.test(e)) && posts.length === 3, JSON.stringify(r.errors));

  reset({ postStatus: 403 });
  r = await now();
  A("a definitive rejection is reported...", r.errors.length === 4 && /403/.test(r.errors[0]), JSON.stringify(r.errors[0]));
  A("...and the claim is handed back so the next tick retries", released.length === 4, released.join(" "));

  reset({ postStatus: 500 });
  r = await now();
  A("a 5xx keeps its claim (the message may have landed; a double post is worse)", released.length === 0, released.join(" "));

  reset({ cfgRows: [{ key: "discord_role_ids", value: ROLE_IDS }] });
  r = await now();
  A("an unset management room is reported as unconfigured, not as healthy silence",
    r.unconfigured.some((u) => /management lineup reminder/.test(u)) && posts.length === 3, JSON.stringify(r.unconfigured));
}

console.log("\n— the dry run shows the office exactly what would go out");
{
  reset();
  const r = await now(true);
  A("nothing is posted and nothing is claimed", posts.length === 0 && claims.size === 0);
  A("...but the copy is returned in full", r.availability.clubs.length === 3 && /Week 1 availability closes/.test(r.availability.clubs[0]) && /<@&MGMT>/.test(r.availability.management));
  A("...with the counts", r.availability.missing === 3 && r.availability.sheetsOwed === 3, JSON.stringify({ m: r.availability.missing, s: r.availability.sheetsOwed }));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
