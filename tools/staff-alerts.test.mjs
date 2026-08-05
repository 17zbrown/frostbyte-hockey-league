// Instant staff-desk alerts. Run: node tools/staff-alerts.test.mjs
//
// Two failures here are worse than no alerts at all, and most of this file is about them:
//   1. the substance of a case travelling to Discord instead of just its heading;
//   2. a club's private trade request leaving the club.
// After that: the right room, one message per arrival however many paths try to send it, and a
// 404 from Discord never counting as delivered.
import { route, createStaffAlerter, rowKey, TABLE_KEYS } from "../bot/staff-alerts.mjs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the two things that must never happen");
{
  A("a trade request never leaves the club", route("action_requests", { id: "c2", type: "trade_request" }) === null);
  /* Commissioner ruling 2026-07-20: ALL officials see ALL filings — action_requests.ar_read has no
     subject carve-out. An office-conduct complaint is therefore announced like any other; hiding
     the announcement would conceal nothing and only slow the response. What protects it is the
     authority rule (ar_update refuses the filer and the subject), not secrecy. */
  const office = route("action_requests", { id: "c1", type: "complaint", subject: "Commissioner or staff conduct" });
  A("an office-conduct complaint still reaches the officials", office.dept === "officiating");
  A("...and is not silently suppressed", !office.suppressed);
}

console.log("\n— each arrival finds its own desk");
{
  A("owner application -> review board", route("owner_applications", { id: "o1" }).dept === "applications");
  A("staff application -> review board", route("staff_applications", { id: "s1", departments: ["media"] }).dept === "applications");
  A("...and names the department applied for", /Media/.test(route("staff_applications", { id: "s1", departments: ["media"] }).line));
  A("management nomination -> review board", route("management_applications", { id: "m1", role: "gm" }).dept === "applications");
  A("...and names the seat", /General Manager/.test(route("management_applications", { id: "m1", role: "gm" }).line));
  A("a complaint -> officials", route("action_requests", { id: "c3", type: "complaint", subject: "Cheating or exploiting" }).dept === "officiating");
  A("a Discord-behavior complaint -> community, not officials",
    route("action_requests", { id: "c4", type: "complaint", subject: "Discord behavior" }).dept === "community");
  A("an appeal -> officials", route("action_requests", { id: "c5", type: "appeal", subject: "Season ban" }).dept === "officiating");
  A("...and cites the 48-hour window", /48 hours/.test(route("action_requests", { id: "c5", type: "appeal" }).cta));
  A("a position change is commissioner work, so no room",
    route("action_requests", { id: "c6", type: "position_change" }).suppressed === "commissioner-only");
  A("an unknown case type is suppressed, not misrouted",
    /unrouted/.test(route("action_requests", { id: "c7", type: "something_new" }).suppressed || ""));
  A("an unmatched EA import -> statistics",
    route("ea_ingest_log", { id: "e1", status: "unmatched", ea_match_id: "77" }).dept === "statistics");
  A("a clean EA import is not news", route("ea_ingest_log", { id: "e2", status: "matched" }) === null);
  A("a game incident -> officials", route("game_incidents", { id: "i1", kind: "late_start" }).dept === "officiating");
  A("a vote fans out to the departments it targets", (() => {
    const r = route("staff_votes", { id: "v1", title: "T", departments: ["officiating", "media"] });
    return r.depts.length === 2 && r.depts.includes("media");
  })());
  A("a vote with no departments does not guess a room",
    route("staff_votes", { id: "v2", title: "T", departments: [] }).depts === null);
  A("an unknown table is ignored", route("some_other_table", { id: "x" }) === null);
}

console.log("\n— the complaint body never appears in Discord");
{
  const r = route("action_requests", { id: "c8", type: "complaint", subject: "Harassment or abuse",
    body: "SECRET DETAIL THAT MUST NOT LEAK" });
  const blob = JSON.stringify(r);
  A("only the subject line travels", /Harassment or abuse/.test(blob));
  A("...never the body", !/SECRET DETAIL/.test(blob));
  A("...and staff are told to open the case instead", /not repeated here/.test(r.cta));
}

/* ---------------- delivery ---------------- */
const CHAN = { applications: "chan-apps", officiating: "chan-off", statistics: "chan-stats", community: "chan-comm" };
const ROLE = { applications: "role-apps", officiating: "role-off", statistics: "role-stats", community: "role-comm" };
let posts, claimed, released, failChannel, claimStatus;
function reset() { posts = []; claimed = []; released = []; failChannel = null; claimStatus = 201; }
reset();

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  if (u.includes("app_config?key=in.")) {
    return J([{ key: "discord_dept_channel_ids", value: JSON.stringify(CHAN) },
              { key: "discord_dept_role_ids", value: JSON.stringify(ROLE) }]);
  }
  if (u.includes("/rest/v1/profiles")) return J([{ gamertag: "Frosty" }]);
  if (u.includes("/rest/v1/teams")) return J([{ id: "T1", code: "MTL" }]);
  if (u.includes("/rest/v1/games")) return J([{ week: 3, home_team_id: "T1", away_team_id: "T2" }]);
  if (u.includes("/rest/v1/discord_post_log")) {
    if (m === "POST") { const ref = JSON.parse(opts.body).ref; if (claimStatus === 201) claimed.push(ref); return new Response("", { status: claimStatus }); }
    if (m === "DELETE") { released.push(decodeURIComponent(u.split("ref=eq.")[1] || "")); return new Response("", { status: 204 }); }
  }
  const mm = u.match(/channels\/([\w-]+)\/messages/);
  if (mm && m === "POST") {
    if (mm[1] === failChannel) return J({ message: "Unknown Channel" }, 404);
    posts.push({ channel: mm[1], body: JSON.parse(opts.body) });
    return J({ id: "msg" + posts.length });
  }
  return J([]);
};

const ENV = { SB_URL: "https://sb.invalid", SB_KEY: "k", BOT: "tok" };
const text = (p) => JSON.stringify(p.body);

console.log("\n— it lands in the right room, and it pings that department only");
{
  reset();
  const S = createStaffAlerter(ENV);
  const r = await S.announce("owner_applications", { id: "o9", profile_id: "p1", team_choice: "Montreal" });
  A("the alert goes out", r === "announced" && posts.length === 1);
  A("...into the review board's room", posts[0].channel === "chan-apps");
  A("...pinging the department role", posts[0].body.content === "<@&role-apps>");
  A("...and ONLY that role — never @everyone",
    posts[0].body.allowed_mentions.parse.length === 0 && posts[0].body.allowed_mentions.roles[0] === "role-apps");
  A("the applicant is named", /Frosty/.test(text(posts[0])));
  A("the club applied for is named", /Montreal/.test(text(posts[0])));
  A("a deep link to that desk is included", /#\/hub\/reviewboard/.test(text(posts[0])));
}

console.log("\n— one arrival, one message, however many paths try");
{
  reset();
  const S = createStaffAlerter(ENV);
  await S.announce("owner_applications", { id: "dup", profile_id: "p1" });
  A("the first path posts", posts.length === 1);
  A("...and claims the row", claimed.length === 1 && claimed[0] === "owner_applications:dup:applications");
  claimStatus = 409;                       // the catch-up sweep now tries the same row
  const again = await S.announce("owner_applications", { id: "dup", profile_id: "p1" });
  A("the second path is refused by the claim", posts.length === 1 && again === "no-op");
}

console.log("\n— a vote reaches every department it targets, claimed separately");
{
  reset();
  const S = createStaffAlerter(ENV);
  await S.announce("staff_votes", { id: "v9", title: "Adopt the new OT format", departments: ["officiating", "statistics"] });
  A("both rooms are told", posts.length === 2);
  A("...each in its own room", posts.map((p) => p.channel).sort().join() === "chan-off,chan-stats");
  A("...with a per-room claim so one failing cannot mute the other",
    claimed.length === 2 && claimed.every((c) => c.startsWith("staff_votes:v9:")));
}

console.log("\n— suppressed arrivals cost nothing and post nothing");
{
  reset();
  const S = createStaffAlerter(ENV);
  const r = await S.announce("action_requests", { id: "c9", type: "position_change" });
  A("nothing is posted", posts.length === 0 && r === "suppressed:commissioner-only");
  A("...and no claim is burned", claimed.length === 0);
  A("...and no profile lookup was needed", S.sum.suppressed === 1);
  const t = await S.announce("action_requests", { id: "c10", type: "trade_request" });
  A("a trade request is silently dropped", posts.length === 0 && t === "skip");
}

console.log("\n— failures never pretend to have delivered");
{
  reset(); failChannel = "chan-apps";
  const S = createStaffAlerter(ENV);
  const r = await S.announce("owner_applications", { id: "f1", profile_id: "p1" });
  A("a dead room is not counted as announced", r === "no-op" && S.sum.announced === 0);
  A("...it is recorded", S.errors.length > 0);
  A("...and the claim is handed back so the sweep can retry",
    released.length === 1 && released[0] === "owner_applications:f1:applications");

  reset();
  const S2 = createStaffAlerter(ENV);
  /* NO `id` field — ea_ingest_log genuinely has no id column, it is keyed on ea_match_id. An
     earlier version of this fixture invented one, which hid a bug that dropped every EA alert. */
  await S2.announce("ea_ingest_log", { status: "unmatched", ea_match_id: "9911", first_seen_at: "2026-08-05T19:00:00Z" });
  A("an unmatched import reaches the stats room", posts.length === 1 && posts[0].channel === "chan-stats");
  A("...naming the match id", /9911/.test(text(posts[0])));
  A("...claimed under its real key, not `undefined`", claimed[0] === "ea_ingest_log:9911:statistics");
}

console.log("\n— table identity matches the real schema");
{
  A("ea_ingest_log is keyed on ea_match_id", TABLE_KEYS.ea_ingest_log.id === "ea_match_id");
  A("...and clocked on first_seen_at", TABLE_KEYS.ea_ingest_log.ts === "first_seen_at");
  A("an ea row with no id still resolves", rowKey("ea_ingest_log", { ea_match_id: "42" }) === "42");
  A("a row with no usable key is refused", rowKey("owner_applications", {}) === null);
  A("an unknown table has no key", rowKey("nope", { id: "1" }) === null);
  reset();
  const S = createStaffAlerter(ENV);
  A("...and an unkeyed row is skipped, never posted",
    (await S.announce("owner_applications", { profile_id: "p1" })) === "skip" && posts.length === 0);
}

console.log("\n— a department with no room mapped fails loudly, not silently");
{
  reset();
  const S = createStaffAlerter(ENV);
  // 'media' is deliberately absent from CHAN
  const r = await S.announce("staff_votes", { id: "v10", title: "T", departments: ["media"] });
  A("nothing is posted", posts.length === 0 && r === "no-op");
  A("...and the missing mapping is reported", S.errors.some((e) => /no channel mapped for media/.test(e)));
}

console.log("\n— catch-up never floods, never replays, never loses");
{
  /* the first run must be SILENT: it stamps a watermark, so history is not announced */
  reset();
  let cfg = [];
  const base = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = opts.method || "GET";
    if (u.includes("app_config?key=eq.staff_alert_since")) {
      return new Response(JSON.stringify(cfg), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.endsWith("/rest/v1/app_config") && m === "POST") {
      cfg = [{ value: JSON.parse(opts.body).value }];
      return new Response("", { status: 201 });
    }
    if (/\/rest\/v1\/(owner_applications|staff_applications|management_applications|action_requests|staff_votes|game_incidents|ea_ingest_log)\?/.test(u)) {
      if (u.includes("owner_applications?")) {
        return new Response(JSON.stringify([{ id: "old1", profile_id: "p1", created_at: "2026-08-05T19:00:00Z" }]),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    return base(url, opts);
  };

  const S = createStaffAlerter(ENV);
  const first = await S.catchUp();
  A("the first ever run announces nothing", posts.length === 0 && !!first.seeded);
  A("...and stamps a watermark", cfg.length === 1);

  const second = await S.catchUp();
  A("the next run picks up the pending row", second.announced === 1 && posts.length === 1);
  A("...into the right room", posts[0].channel === "chan-apps");

  claimStatus = 409;                       // the live path already handled it
  const third = await S.catchUp();
  A("an already-announced row is never repeated", third.announced === 0 && posts.length === 1);

  globalThis.fetch = base;
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
