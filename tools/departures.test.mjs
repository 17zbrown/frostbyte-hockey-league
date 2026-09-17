// The Discord departure log — who left the server, worked out by diffing member censuses.
// Run: node tools/departures.test.mjs
//
// The failure that matters is a FALSE mass departure: a partial member read looks exactly like an
// exodus, and announcing one would page the commissioners with a fiction. Most of this file is
// about that.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

let DB = { guild_members: [], guild_departures: [], season_registrations: [] };
const posts = [];
let failMemberWrite = false;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  const J = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { "content-type": "application/json" } });
  if (u.includes("/rest/v1/guild_members") && m === "GET") return J(DB.guild_members.filter((r) => r.present));
  if (u.includes("/rest/v1/season_registrations")) return J(DB.season_registrations);
  if (u.includes("/rest/v1/guild_members") && m === "POST") {
    if (failMemberWrite) return J({ message: "boom" }, 500);
    JSON.parse(opts.body).forEach((r) => {
      const i = DB.guild_members.findIndex((x) => x.discord_id === r.discord_id);
      if (i >= 0) DB.guild_members[i] = { ...DB.guild_members[i], ...r }; else DB.guild_members.push({ ...r });
    });
    return J([]);
  }
  if (u.includes("/rest/v1/guild_members") && m === "PATCH") {
    const id = decodeURIComponent((u.match(/discord_id=eq\.([^&]+)/) || [])[1] || "");
    const r = DB.guild_members.find((x) => x.discord_id === id);
    if (r) Object.assign(r, JSON.parse(opts.body));
    return J([]);
  }
  if (u.includes("/rest/v1/guild_departures") && m === "POST") { DB.guild_departures.push(...JSON.parse(opts.body)); return J([]); }
  /* the league card the database builds for the post (public.member_league_card) */
  if (u.includes("/rest/v1/rpc/member_league_card")) {
    const id = JSON.parse(opts.body).p_discord_id;
    return J(DB.cards && DB.cards[id] ? DB.cards[id] : { linked: false, kind: "none", standing: null });
  }
  if (u.includes("discord.com")) { if (m === "POST") posts.push(JSON.parse(opts.body || "{}")); return J({ id: "msg" }); }
  return J([]);
};

const { _internals: I } = await import(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname);

const member = (id, name, joinedDaysAgo = 30) => [id, {
  user: { id, username: name, global_name: name, bot: false }, nick: null,
  joined_at: new Date(Date.now() - joinedDaysAgo * 86400000).toISOString() }];
const census = (ids) => new Map(ids.map((id) => member(id, "user" + id)));
const seed = (ids) => { DB.guild_members = ids.map((id) => ({ discord_id: id, username: "user" + id, present: true,
  joined_guild_at: new Date(Date.now() - 30 * 86400000).toISOString() })); };
const run = async (ids, listOk = true, links = [], teams = []) => {
  DB.guild_departures = []; posts.length = 0;
  const sum = { errors: [], __departChanId: "chan1" };
  await I.trackDepartures(census(ids), listOk, links, teams, sum);
  return { sum, departures: DB.guild_departures.slice(), posts: posts.slice() };
};

console.log("— a normal departure");
{
  seed(["1","2","3"]);
  const r = await run(["1","2"]);
  A("one departure recorded", r.departures.length === 1 && r.departures[0].discord_id === "3");
  A("days in server captured", r.departures[0].days_in_server === 30, r.departures[0].days_in_server + "d");
  A("marked absent, not deleted", DB.guild_members.find((x) => x.discord_id === "3").present === false);
  A("announced once", r.posts.length === 1);
  A("names them in the title", /user3 has left the server/.test(JSON.stringify(r.posts[0])));
  const b0 = JSON.stringify(r.posts[0]);
  A("a visitor with no site account is described kindly, with no Discord id in the post", /here as a visitor/.test(b0) && !/`3`/.test(b0) && !/never signed in/.test(b0));
  A("...and how long they were with us", /With us for 30 days/.test(b0));
  A("no mass-departure flag", !r.sum.departSuspicious);
}

console.log("\n— a member who was on a club and signed up (the public-facing post)");
{
  seed(["1","9"]);
  DB.season_registrations = [{ profile_id: "p9" }];
  DB.cards = { "9": { linked: true, gamertag: "Sniper", kind: "management", standing: "General Manager of the Boston Bruins", club_code: "BOS", club: "Boston Bruins", registered: true } };
  const links = [{ discord_id: "9", profile_id: "p9", gamertag: "Sniper", team_id: "t1" }];
  const r = await run(["1"], true, links, [{ id: "t1", code: "BOS" }]);
  A("club recorded", r.departures[0].club === "BOS", r.departures[0].club);
  A("registration recorded", r.departures[0].was_registered === true);
  A("profile linked", r.departures[0].profile_id === "p9");
  const body = JSON.stringify(r.posts[0]);
  A("the post names their place in the league — the club seat", /General Manager of the Boston Bruins/.test(body) && /front office has an open seat/.test(body));
  A("...and their site name when it differs from their Discord name", /user9 \(Sniper on the site\) has left the server/.test(body));
  A("...never a raw Discord id or a 'no linked account' line", !/`9`/.test(body) && !/No linked site account/.test(body));
  A("a management departure is highlighted in league yellow", r.posts[0].embeds[0].color === 0xFFE500);
  A("...with no pings", r.posts[0].allowed_mentions.parse.length === 0);
  DB.season_registrations = []; DB.cards = null;
}

console.log("\n— when the card lookup fails, the post still goes out");
{
  seed(["1","7"]);
  DB.cards = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => (String(url).includes("member_league_card") ? new Response("nope", { status: 500 }) : realFetch(url, opts));
  const links = [{ discord_id: "7", profile_id: "p7", gamertag: "Backup", team_id: null }];
  const r = await run(["1"], true, links, []);
  globalThis.fetch = realFetch;
  A("announced from what the sweep already knew", r.posts.length === 1 && /Backup/.test(JSON.stringify(r.posts[0])));
  A("...and the failure is surfaced, not swallowed", r.sum.errors.some((e) => e.departCard === "7"));
}

console.log("\n— the guards against a fake exodus");
{
  seed(["1","2","3","4","5"]);
  const a = await run([], false);                       // census failed
  A("a failed census reports nobody", a.departures.length === 0 && a.posts.length === 0, a.sum.departSkipped);
  A("...and says why", !!a.sum.departSkipped);

  seed(["1","2","3","4","5"]);
  const b = await run([], true);                        // census returned zero members
  A("an EMPTY census is treated as failed, not as everyone leaving", b.departures.length === 0 && b.posts.length === 0);

  seed(Array.from({ length: 100 }, (_, i) => "u" + i));
  const c = await run(Array.from({ length: 40 }, (_, i) => "u" + i));   // 60% gone in one tick
  A("a 60% drop is still RECORDED", c.departures.length === 60, c.departures.length + " rows");
  A("...but never announced", c.posts.length === 0);
  A("...and is flagged for a human", !!c.sum.departSuspicious, c.sum.departSuspicious);

  seed(Array.from({ length: 100 }, (_, i) => "u" + i));
  const d = await run(Array.from({ length: 90 }, (_, i) => "u" + i));   // 10% — a plausible day
  A("a plausible drop announces normally", d.posts.length === 10 && !d.sum.departSuspicious);
}

console.log("\n— the census is written only where it changes (2026-09-17)");
{
  /* every sweep used to rewrite every present row to move last_seen by two minutes — ~150 upserts
     a tick for a timestamp nobody reads at that resolution */
  const writes = [];
  const base = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes("/rest/v1/guild_members") && opts.method === "POST") writes.push(JSON.parse(opts.body).length);
    return base(url, opts);
  };
  seed(["1","2","3"]);
  const fresh = new Date().toISOString();
  DB.guild_members.forEach((r) => { r.last_seen = fresh; });
  let r = await run(["1","2","3"]);
  A("a census identical to the last one within the hour writes no rows", writes.length === 0 && r.sum.departRowsWritten === 0, JSON.stringify(writes));

  DB.guild_members.find((x) => x.discord_id === "2").last_seen = new Date(Date.now() - 2 * 3600000).toISOString();
  r = await run(["1","2","3","4"]);
  A("a stale row (older than an hour) and a new member are the only rows written", writes.length === 1 && writes[0] === 2 && r.sum.departRowsWritten === 2, JSON.stringify(writes));
  A("...and the stale row's timestamp moved", Date.now() - Date.parse(DB.guild_members.find((x) => x.discord_id === "2").last_seen) < 60000);

  writes.length = 0;
  /* a member who left (present:false) and came back flips present, so their row IS written */
  DB.guild_members.find((x) => x.discord_id === "3").present = false;
  r = await run(["1","2","3","4"]);
  A("a returning member's row is written (present flips)", writes.length === 1 && writes[0] === 1 && DB.guild_members.find((x) => x.discord_id === "3").present === true);
  A("the touch window is an hour", I.DEPART_TOUCH_MS === 60 * 60 * 1000);
  globalThis.fetch = base;
}

console.log("\n— it does not invent departures");
{
  seed(["1","2","3"]);
  const r = await run(["1","2","3"]);
  A("nobody left, nothing written", r.departures.length === 0 && r.posts.length === 0);
  seed([]);
  const f = await run(["1","2"]);
  A("first ever run announces nothing", f.departures.length === 0 && f.posts.length === 0);
  A("...but remembers everyone for next time", DB.guild_members.length === 2);
}

console.log("\n— a failed write does not half-report");
{
  seed(["1","2"]); failMemberWrite = true;
  const r = await run(["1"]);
  A("a failed census write aborts before announcing", r.posts.length === 0 && r.departures.length === 0);
  A("...and surfaces the error", r.sum.errors.length > 0, JSON.stringify(r.sum.errors[0]));
  failMemberWrite = false;
}

console.log("\n— @everyone belongs to the league office only");
{
  /* BigInt throughout: a real permission bitfield does not fit in the 32 bits JS bitwise ops use,
     and computing the fixture with `|` would have quietly agreed with a broken implementation. */
  const ME = I.MENTION_EVERYONE;              // 1n << 17n
  const role = (name, perms, managed) => ({ id: "r-" + name, name, permissions: String(perms), managed: !!managed });
  /* the real league-role bitfield ALREADY carries the mention bit — deriving the clean baseline
     from it (rather than reusing it) is what makes the "never had it" case meaningful */
  const GRANTED = 2248473465835073n;          // a real league role, as it was found live
  const BASE = GRANTED & ~ME;                 // the same role with only the mention bit cleared
  const roles = [
    role("Commissioner", GRANTED),
    role("Staff", GRANTED),
    role("Media", GRANTED),
    role("Center", GRANTED),
    role("Owner", GRANTED),
    role("Not Signed Up", GRANTED),
    role("Chel Gaming", GRANTED, true),     // the bot's own integration role
    role("Server Booster", GRANTED, true),  // managed BUT editable — a boost must not buy a megaphone
    role("Player", BASE),                     // already clean, must not be touched
  ];
  const patched = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.method === "PATCH" && /\/roles\//.test(String(url))) {
      patched.push({ id: String(url).split("/roles/")[1], perms: JSON.parse(opts.body).permissions });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const sum = { errors: [] };
  await I.enforceMentionPolicy(roles, sum);
  const hit = (n) => patched.some((p) => p.id === "r-" + n);

  A("a position role loses it", hit("Center"));
  A("a club-seat role loses it", hit("Owner"));
  A("an unregistered member's role loses it", hit("Not Signed Up"));
  A("boosting the server does not buy a megaphone", hit("Server Booster"));
  A("commissioners keep it", !hit("Commissioner"));
  A("staff keep it", !hit("Staff"));
  /* Media WAS exempt and must not be again: a media-only staffer wears the Media role and NEITHER
     Commissioner nor Staff, so exempting it handed the megaphone to exactly the people Rule 1.3
     excludes. Found in production by listing who WORE the roles, not which roles held the bit. */
  A("media loses it — a media-only staffer wears neither Commissioner nor Staff", hit("Media"));
  A("the bot's own integration role is left alone", !hit("Chel Gaming"));
  A("a role that never had it is not touched", !hit("Player"));
  A("the count is reported", sum.mentionStripped === 5);
  A("only the mention bit is cleared, other permissions survive",
    patched.every((p) => BigInt(p.perms) === BASE));
  A("...and the value is NOT 32-bit truncated (permissions are 64-bit)",
    patched.every((p) => BigInt(p.perms) > 4294967295n));
  A("nothing errored", sum.errors.length === 0);

  /* ADMINISTRATOR implies every permission, so a role holding it can ping without bit 17. The
     guard cannot strip its way out of that — it must at least say so rather than report a clean
     server. This is the blind spot that made the Media leak invisible in the role audit. */
  A("an admin role is named as able to bypass the policy",
    (sum.mentionViaAdmin || []).includes("Commissioner") === false);
  {
    const ADMIN = 1n << 3n;
    const sumA = { errors: [] };
    await I.enforceMentionPolicy([
      role("Commissioner", GRANTED | ADMIN),          // admin by design, allow-listed
      role("Chel Gaming", GRANTED | ADMIN, true),     // managed integration role, expected
      role("Tournament Host", (GRANTED & ~ME) | ADMIN), // NOT allow-listed: can ping via admin
    ], sumA);
    A("a non-office admin role is reported as a bypass",
      (sumA.mentionViaAdmin || []).includes("Tournament Host"));
    A("...and the office's own admin role is not noise",
      !(sumA.mentionViaAdmin || []).includes("Commissioner"));
    A("...nor is the bot's managed integration role",
      !(sumA.mentionViaAdmin || []).includes("Chel Gaming"));
  }

  /* second sweep over the corrected list is a no-op */
  patched.length = 0;
  const sum2 = { errors: [] };
  await I.enforceMentionPolicy(roles, sum2);
  A("a clean server needs no writes", patched.length === 0 && !sum2.mentionStripped);
}

/* The guard above passed while the sweep was dead in production: the test called the function
   directly, so it never saw that the CALL SITE sat above `const sum`. A temporal-dead-zone
   ReferenceError threw, the catch block touched `sum` and threw again, and the whole sweep died
   before writing its result — heartbeat fresh, result frozen. Assert the ordering itself. */
console.log("\n— the guard is wired in where `sum` actually exists");
{
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8"));
  const lines = src.split("\n");
  const declared = lines.findIndex((l) => /^\s*const sum = \{/.test(l));
  const called = lines.findIndex((l) => /await enforceMentionPolicy\(/.test(l));
  A("`sum` is declared in the sweep", declared > -1);
  A("the guard is called", called > -1);
  A("...after `sum` exists, not before it", called > declared,
    `declared at line ${declared + 1}, called at line ${called + 1}`);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
