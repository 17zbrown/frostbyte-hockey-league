// The club's game-night Discord post. Run: node tools/game-night-post.test.mjs
//
// Commissioner's ruling (2026-09-23), reversing the v2.78 lead: the post must WAIT for the night
// to lock and then say everything in ONE message. Before this it became eligible when a club's
// first game was 75 minutes away and carried the private lobby codes with it: 45 minutes before
// Rule 4.2 releases them, and while the server picks were still open, so it could not name a
// server at all.
//
// What must never break:
//   - nothing is posted before the night locks, and the gate is the DATABASE (public.night_board
//     returns no rows until then), not this file's clock;
//   - the one message names every one of that club's games tonight, with its time, its settled
//     server and its lobby code;
//   - a club's post is claimed once per night, so a wide catch-up window cannot double-post;
//   - it tells the truth about Rule 5.3: at the night's lock only the FIRST game's sheet is shut.
process.env.SUPABASE_URL = "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
process.env.DISCORD_BOT_TOKEN = "t";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const MIN = 60000, H = 60 * MIN;
const TEAMS = [
  { id: "t1", code: "BOS", name: "Bruins", discord_channel_id: "ch1", discord_role_id: "r1" },
  { id: "t2", code: "DAL", name: "Stars", discord_channel_id: "ch2", discord_role_id: "r2" },
  { id: "t3", code: "VAN", name: "Canucks", discord_channel_id: null, discord_role_id: "r3" },
];

let games, posts, claims, released, boardCalls, boardGate, cfgRows;

/* A night of three games 35 minutes apart, the first of them `leadH` hours from now. The night's
   lock is first puck drop minus 30 minutes, so leadH 0.5 is exactly the lock. */
function reset(over = {}) {
  const first = Date.now() + (over.leadH ?? 1.25) * H;
  games = over.games || [
    { id: "g1", week: 1, stage: "regular", voided: false, status: "scheduled", home_team_id: "t1", away_team_id: "t2", scheduled_at: new Date(first).toISOString(), game_code: "AAA111" },
    { id: "g2", week: 1, stage: "regular", voided: false, status: "scheduled", home_team_id: "t2", away_team_id: "t1", scheduled_at: new Date(first + 35 * MIN).toISOString(), game_code: "BBB222" },
    { id: "g3", week: 1, stage: "regular", voided: false, status: "scheduled", home_team_id: "t1", away_team_id: "t2", scheduled_at: new Date(first + 70 * MIN).toISOString(), game_code: "CCC333" },
  ];
  cfgRows = over.cfgRows || [{ key: "discord_mgmt_room_management_announcements_id", value: "mgmtroom" }];
  boardGate = over.boardGate ?? null;   // null = honor the real lock; true/false = force
  posts = []; claims = new Set(); released = []; boardCalls = [];
}
reset();

/* The stand-in for public.night_board: it applies the SAME rule the real one does — no rows until
   the night's first puck drop minus 30 minutes — and settles a server for each game. */
const nightBoard = (day) => {
  boardCalls.push(day);
  const night = games.filter((g) => !g.voided && etYmd(g.scheduled_at) === day)
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  if (!night.length) return [];
  const lock = Date.parse(night[0].scheduled_at) - 30 * MIN;
  const open = boardGate === null ? Date.now() >= lock : boardGate;
  if (!open) return [];
  const SRV = ["NA Central", "NA West", "NA Northeast"];
  return night.map((g, i) => ({
    game_id: g.id, scheduled_at: g.scheduled_at, home_team_id: g.home_team_id, away_team_id: g.away_team_id,
    game_code: g.game_code, server: SRV[i % SRV.length],
    lineup_lock_at: new Date(Date.parse(g.scheduled_at) - 30 * MIN).toISOString(),
  }));
};
const etYmd = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));

globalThis.fetch = async (url, init = {}) => {
  const u = String(url), m = (init.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (u.includes("/rest/v1/rpc/night_board")) return J(nightBoard(JSON.parse(init.body).p_day));
  if (u.includes("/rest/v1/rpc/week_availability_deadline")) return J(null);
  if (u.includes("/rest/v1/rpc/availability_missing")) return J([]);
  if (u.includes("/rest/v1/game_lineups")) return J([]);
  if (u.includes("/rest/v1/game_vetoes")) return J([]);
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
    posts.push({ channel: u.match(/channels\/([^/]+)\//)[1], ...JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  }
  return J([]);
};

const mod = await import(new URL("../netlify/functions/discord-scheduler.js", import.meta.url).pathname);
const tick = () => mod.default(new Request("https://x/.netlify/functions/discord-scheduler"));
/* only the club game-night post: the tick also fires the lineup and server-pick asks */
const clubPosts = () => posts.filter((p) => /Game night\./.test(p.content || ""));

console.log("— before the night locks, nothing goes out");
{
  reset({ leadH: 1.25 });                 // 75 minutes out: exactly where the old bug fired
  const body = await (await tick()).json();
  A("no club post at T-75", clubPosts().length === 0, String(body.reminders));
  A("...and it says when the night locks", /nothing to post yet/.test(String(body.reminders)), String(body.reminders));
  A("no lobby code reached Discord", !posts.some((p) => /AAA111|BBB222|CCC333/.test(p.content || "")));
  A("no claim was taken, so the real post is not blocked later", ![...claims].some((k) => k.startsWith("game_reminder/")));

  reset({ leadH: 0.6 });                  // 36 minutes out: still 6 minutes before the lock
  await tick();
  A("still nothing six minutes before the lock", clubPosts().length === 0);
}

console.log("\n— at the lock, one message per club with everything in it");
{
  reset({ leadH: 0.5 });                  // the lock exactly
  const body = await (await tick()).json();
  A("both roomed clubs are posted to", clubPosts().length === 2, String(body.reminders));
  const bos = clubPosts().find((p) => p.channel === "ch1");
  A("BOS got its own room", !!bos);
  const c = bos.content;
  A("it names all three of the night's games", (c.match(/^• /gm) || []).length === 3, (c.match(/^• /gm) || []).length);
  A("...each with its time", /9:|10:|:\d\d [AP]M ET/.test(c));
  A("...each with its settled server", /server \*\*NA Central\*\*/.test(c) && /server \*\*NA West\*\*/.test(c) && /server \*\*NA Northeast\*\*/.test(c));
  A("...each with its lobby code", /`AAA111`/.test(c) && /`BBB222`/.test(c) && /`CCC333`/.test(c));
  A("it is ONE message, not one per game", clubPosts().filter((p) => p.channel === "ch1").length === 1);
  A("it says the picks are locked and the servers final", /Server picks are locked for the night/.test(c));
  A("it says the codes are not for a public channel", /never a public channel/.test(c));
  A("it does NOT claim every sheet is locked — only the first game's is (Rule 5.3)",
    /Lineups lock 30 minutes before each game's OWN puck drop/.test(c) && /the rest are still open/.test(c));
  A("...and it names each open sheet with its own deadline, in words",
    /the \d?\d:\d\d [AP]M sheet until \d?\d:\d\d [AP]M/.test(c), c.split("\n").find((l) => /sheet until/.test(l)));
  A("no link preview", bos.flags === 4);
  A("the board was asked for exactly one night", new Set(boardCalls).size === 1, boardCalls.join(","));
}

console.log("\n— it never double-posts, and it catches up");
{
  reset({ leadH: 0.5 });
  await tick();
  const firstRound = clubPosts().length;
  await tick();
  A("a second tick in the same night posts nothing more", clubPosts().length === firstRound, `${firstRound} then ${clubPosts().length}`);

  reset({ leadH: -0.4 });                 // the first game started 24 min ago: a lost tick catching up
  await tick();
  A("a tick after puck drop still delivers the night", clubPosts().length === 2, String(clubPosts().length));
  const c = clubPosts()[0].content;
  A("...and still lists the game already under way", (c.match(/^• /gm) || []).length === 3);
  A("...and says the remaining sheets are still open", /still open:/.test(c));

  reset({ leadH: -0.1 });                 // the first game is under way, the last is not
  await tick();
  const late = clubPosts()[0];
  A("a catch-up mid-night still names the sheets still open", late && /still open:/.test(late.content));

  reset({ leadH: -2 });                   // the night's LAST game has already started
  const over = await (await tick()).json();
  A("once the night's last game has started the window is shut", clubPosts().length === 0, String(over.reminders));
  A("...and it says so rather than failing silently", /no game night ahead/.test(String(over.reminders)), String(over.reminders));
}

console.log("\n— a club with no Discord room is reported, never silently dropped");
{
  reset({ leadH: 0.5, games: [
    { id: "gx", week: 1, stage: "regular", voided: false, status: "scheduled", home_team_id: "t1", away_team_id: "t3", scheduled_at: new Date(Date.now() + 0.5 * H).toISOString(), game_code: "ZZZ999" },
  ] });
  const body = await (await tick()).json();
  const errs = JSON.stringify(body.errors || []);
  A("the roomless club is named in errors", /VAN has no Discord room/.test(errs), errs.slice(0, 160));
  A("...and its opponent is still posted to", clubPosts().length === 1);
}

console.log("\n— it never asserts a server the resolver did not choose");
{
  reset({ leadH: 0.5 });
  const real = globalThis.fetch;
  globalThis.fetch = async (u, i) => {
    if (String(u).includes("rpc/night_board")) {
      const rows = nightBoard(JSON.parse(i.body).p_day).map((r, k) => (k === 1 ? { ...r, server: null } : r));
      return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    }
    return real(u, i);
  };
  await tick();
  globalThis.fetch = real;
  const c = clubPosts()[0].content;
  const settling = c.split("\n").find((l) => /settling/.test(l)) || "";
  A("an unsettled game says so", /still settling/.test(c), settling);
  A("...and that line names NO server at all, standard or otherwise", settling && !/server \*\*/.test(settling), settling);
  A("...and it points at where the answer will be", /check the schedule desk/.test(settling));
  A("...and the post drops the word 'final' when one is missing", !/servers above are final/.test(c));
  A("the settled games in the same post still name their own server", /server \*\*NA Central\*\*/.test(c));
}

console.log("\n— a voided game is never announced");
{
  reset({ leadH: 0.5 });
  games[1].voided = true;
  await tick();
  const c = clubPosts()[0].content;
  A("the voided game is left out", !/BBB222/.test(c) && (c.match(/^• /gm) || []).length === 2);
}

console.log("\n— if the board cannot be read, nothing is invented");
{
  reset({ leadH: 0.5 });
  const real = globalThis.fetch;
  globalThis.fetch = async (u, i) => (String(u).includes("rpc/night_board")
    ? new Response("boom", { status: 500 }) : real(u, i));
  const body = await (await tick()).json();
  globalThis.fetch = real;
  A("no post goes out on a failed board", clubPosts().length === 0, String(body.reminders));
  A("...and the failure is reported, not swallowed", /night board/i.test(JSON.stringify(body.errors || []) + String(body.reminders)));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
