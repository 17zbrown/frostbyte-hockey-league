/* Club notices — the front office's Discord copy of every signing, waiver, trade step, loan and
   roster move (v2.42). The database writes club_notices; this lane posts each row into the club's
   room exactly once. Run: node tools/club-notices.test.mjs */
import { createClubNotices, buildNoticeEmbed, KIND_STYLE } from "../bot/club-notices.mjs";
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const world = { teams: { "t-bos": { id: "t-bos", code: "BOS", discord_channel_id: "room-bos" }, "t-nyi": { id: "t-nyi", code: "NYI", discord_channel_id: null } },
  profiles: { "u-gm": { gamertag: "Mr. Plow" } }, claims: new Set(), posts: [], patches: [], failPost: false, unposted: [] };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = (opts.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(b === null ? null : JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (u.includes("/rest/v1/teams?id=eq.")) { const id = decodeURIComponent(u.split("id=eq.")[1].split("&")[0]); return J(world.teams[id] ? [world.teams[id]] : []); }
  if (u.includes("/rest/v1/profiles?id=eq.")) { const id = decodeURIComponent(u.split("id=eq.")[1].split("&")[0]); return J(world.profiles[id] ? [world.profiles[id]] : []); }
  if (u.includes("/rest/v1/discord_post_log") && m === "POST") { const ref = JSON.parse(opts.body).ref; if (world.claims.has(ref)) return J(null, 409); world.claims.add(ref); return J(null, 201); }
  if (u.includes("/rest/v1/discord_post_log") && m === "DELETE") { const ref = decodeURIComponent(u.split("ref=eq.")[1]); world.claims.delete(ref); return J(null, 204); }
  if (u.includes("/rest/v1/club_notices?posted_at=is.null")) return J(world.unposted);
  if (u.includes("/rest/v1/club_notices?id=eq.") && m === "PATCH") { world.patches.push({ id: decodeURIComponent(u.split("id=eq.")[1]), body: JSON.parse(opts.body) }); return J(null, 204); }
  if (u.includes("discord.com") && m === "POST") { if (world.failPost) return new Response("nope", { status: 500 }); world.posts.push({ channel: u.split("/channels/")[1].split("/")[0], body: JSON.parse(opts.body) }); return J({ id: "m" + world.posts.length }); }
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
  world.failPost = true;
  const r = await C.announce(row({ id: "n4" }));
  world.failPost = false;
  A("a failed delivery releases its claim and records the error", r === "error" && !world.claims.has("club:n4") && world.patches.some((x) => x.id === "n4" && x.body.post_error));
  A("...so a retry can land it", (await C.announce(row({ id: "n4" }))) === "announced");
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
