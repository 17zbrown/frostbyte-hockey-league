/* Club notices — the front office's Discord copy of every signing, waiver, trade step, loan and
   roster move (v2.42). The database writes club_notices; this lane posts each row into the club's
   room exactly once. Run: node tools/club-notices.test.mjs */
import { createClubNotices, buildNoticeEmbed, KIND_STYLE } from "../bot/club-notices.mjs";
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const world = { teams: { "t-bos": { id: "t-bos", code: "BOS", discord_channel_id: "room-bos" }, "t-nyi": { id: "t-nyi", code: "NYI", discord_channel_id: null } },
  profiles: { "u-gm": { gamertag: "Mr. Plow" } }, claims: new Set(), posts: [], patches: [], unposted: [],
  /* failPost: false | 404 (Discord provably refused it) | 500 (edge error — delivery unknown) | "hang" (the
     socket never answers); postAttempts counts every POST /messages so "sent once" is provable */
  failPost: false, postAttempts: 0, failPatch: false };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = (opts.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(b === null ? null : JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (u.includes("/rest/v1/teams?id=eq.")) { const id = decodeURIComponent(u.split("id=eq.")[1].split("&")[0]); return J(world.teams[id] ? [world.teams[id]] : []); }
  if (u.includes("/rest/v1/profiles?id=eq.")) { const id = decodeURIComponent(u.split("id=eq.")[1].split("&")[0]); return J(world.profiles[id] ? [world.profiles[id]] : []); }
  if (u.includes("/rest/v1/discord_post_log") && m === "POST") { const ref = JSON.parse(opts.body).ref; if (world.claims.has(ref)) return J(null, 409); world.claims.add(ref); return J(null, 201); }
  if (u.includes("/rest/v1/discord_post_log") && m === "DELETE") { const ref = decodeURIComponent(u.split("ref=eq.")[1]); world.claims.delete(ref); return J(null, 204); }
  if (u.includes("/rest/v1/club_notices?posted_at=is.null")) return J(world.unposted);
  if (u.includes("/rest/v1/club_notices?id=eq.") && m === "PATCH") {
    if (world.failPatch) return new Response("db down", { status: 503 });
    world.patches.push({ id: decodeURIComponent(u.split("id=eq.")[1]), body: JSON.parse(opts.body) }); return J(null, 204);
  }
  if (u.includes("discord.com") && m === "POST") {
    world.postAttempts++;
    if (world.failPost === "hang") return new Promise(() => {});
    if (world.failPost === 404) return J({ message: "Unknown Channel" }, 404);
    if (world.failPost === 500) return new Response("nope", { status: 500 });
    world.posts.push({ channel: u.split("/channels/")[1].split("/")[0], body: JSON.parse(opts.body) }); return J({ id: "m" + world.posts.length });
  }
  return J([]);
};
const env = { SB_URL: "https://sb.invalid", SB_KEY: "k", BOT: "t" };
const row = (over) => ({ id: "n1", team_id: "t-bos", kind: "waive", title: "Waived: Jugg", body: "Jugg (RW) was waived — his cap hit clears (Rule 2.5).", actor_profile_id: "u-gm", created_at: "2026-09-14T01:00:00Z", posted_at: null, ...over });

console.log("— one row, one message in the club's room");
{
  const C = createClubNotices(env);
  A("posted", (await C.announce(row())) === "announced" && world.posts.length === 1);
  const p = world.posts[0];
  A("...into the club's private room, with no pings", p.channel === "room-bos" && p.body.allowed_mentions.parse.length === 0);
  const e = p.body.embeds[0];
  A("...styled by kind, titled by the database, signed by the actor", e.color === KIND_STYLE.waive.colour && /Waived: Jugg/.test(e.title) && /— Mr\. Plow$/.test(e.description));
  A("...linking Team HQ's roster page", /#\/hub\/roster$/.test(e.url));
  A("posted_at stamped after delivery", world.patches.some((x) => x.id === "n1" && x.body.posted_at && x.body.post_error === null));
  A("a second event for the same row is refused by the claim", (await C.announce(row())) === "claimed-elsewhere" && world.posts.length === 1);
}
console.log("\n— the cases that must not post");
{
  const C = createClubNotices(env);
  A("a club with no room is skipped", (await C.announce(row({ id: "n2", team_id: "t-nyi" }))) === "no-room" && world.posts.length === 1);
  A("an already-posted row is skipped", (await C.announce(row({ id: "n3", posted_at: "2026-09-14T01:01:00Z" }))) === "already");
  world.failPost = 404;
  const r = await C.announce(row({ id: "n4" }));
  world.failPost = false;
  A("a delivery Discord provably refused releases its claim and records the error", r === "error" && !world.claims.has("club:n4") && world.patches.some((x) => x.id === "n4" && x.body.post_error));
  A("...so a retry can land it", (await C.announce(row({ id: "n4" }))) === "announced");
}
console.log("\n— an unknown outcome is never re-sent, and never released (audit 2026-09-17, P2-12)");
{
  const C = createClubNotices(env, { discordTimeoutMs: 30 });
  world.failPost = 500; world.postAttempts = 0;
  const r = await C.announce(row({ id: "n7" }));
  A("a 5xx from Discord is 'unconfirmed', not an error to retry", r === "unconfirmed" && C.sum.unconfirmed === 1);
  A("...sent exactly ONCE — no retry loop on a 5xx", world.postAttempts === 1);
  A("...the claim is KEPT, so no lane can post it again", world.claims.has("club:n7"));
  A("...and the row says why, with posted_at still null", world.patches.some((x) => x.id === "n7" && /^unconfirmed:/.test(x.body.post_error) && !x.body.posted_at));
  world.failPost = false; world.postAttempts = 0;
  A("announcing it again (the catch-up) sends nothing", (await C.announce(row({ id: "n7" }))) === "unconfirmed" && world.postAttempts === 0);

  world.failPost = "hang"; world.postAttempts = 0;
  const t0 = Date.now();
  const r2 = await C.announce(row({ id: "n8" }));
  A("a socket that never answers is abandoned at the deadline, not waited on", r2 === "unconfirmed" && Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  A("...sent once, claim kept, marked as a timeout", world.postAttempts === 1 && world.claims.has("club:n8") && /timed out/.test(C.errors[C.errors.length - 1]));
  A("...and both count as lane errors for the heartbeat", C.sum.errors === 2 && C.sum.lastErrorAt && /n8/.test(C.sum.lastError));
  world.failPost = false;
}
console.log("\n— Discord accepted it, the stamp failed: the claim stays");
{
  const C = createClubNotices(env, { catchUpAgeMs: 0 });
  world.failPatch = true; world.postAttempts = 0;
  const before = world.posts.length;
  const r = await C.announce(row({ id: "n9" }));
  A("delivered, reported as announced-but-unstamped", r === "announced-unstamped" && world.posts.length === before + 1 && C.sum.announced === 1 && C.sum.stampFailed === 1);
  A("the claim is kept — releasing after a delivery is the other double post", world.claims.has("club:n9"));
  A("...and it is a lane error the heartbeat will show", C.sum.errors === 1 && /posted_at would not write/.test(C.sum.lastError));
  world.failPatch = false; world.postAttempts = 0;
  world.unposted = [row({ id: "n9" })];
  const n = await C.catchUp();
  A("the next catch-up writes the stamp WITHOUT posting again", world.postAttempts === 0 && world.posts.length === before + 1 && n === 0);
  A("...and posted_at lands", world.patches.some((x) => x.id === "n9" && x.body.posted_at));
  A("...after which the row is ordinary again", (await C.announce(row({ id: "n9" }))) === "claimed-elsewhere");
  world.unposted = [];
}
console.log("\n— the catch-up posts what realtime missed");
{
  const C = createClubNotices(env, { catchUpAgeMs: 0 });
  world.unposted = [row({ id: "n5", kind: "trade", title: "Trade completed with the Red Wings", body: "You send X and receive Y." }), row({ id: "n6", kind: "loan", title: "Pre-season loans arrived — 16 players", body: "…" })];
  const n = await C.catchUp();
  A("both unposted rows go out", n === 2 && world.posts.slice(-2).every((p) => p.channel === "room-bos"));
  A("a trade notice links the Trade Hub", /#\/hub\/tradehub$/.test(world.posts[world.posts.length - 2].body.embeds[0].url));
  A("the lane's sum reports it", C.sum.announced === 2);
}
console.log("\n— the embed builder is one definition (the sweep imports it for its backstop)");
{
  const e = buildNoticeEmbed({ kind: "offer", title: "Offer sent to Porky", body: "Mr. Plow offered Porky $1.25M × 2 seasons." }, null);
  A("no actor line when no actor", !/—/.test(e.description.slice(-4)) && /#\/hub\/freeagents$/.test(e.url) && e.color === KIND_STYLE.offer.colour);
}
console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
