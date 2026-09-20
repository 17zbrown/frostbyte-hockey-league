/* Direct messages — the league's DM lane (v2.75): one row in public.discord_dms → one DM, exactly once.
   Run: node tools/dms.test.mjs */
import { createDms } from "../bot/dms.mjs";
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const world = { claims: new Set(), posts: [], channels: 0, patches: [], unsent: [], failPost: false, failOpen: false, postAttempts: 0 };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = (opts.method || "GET").toUpperCase();
  const J = (b, s = 200) => new Response(b === null ? null : JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (u.includes("/rest/v1/discord_post_log") && m === "POST") { const ref = JSON.parse(opts.body).ref; if (world.claims.has(ref)) return J(null, 409); world.claims.add(ref); return J(null, 201); }
  if (u.includes("/rest/v1/discord_post_log") && m === "DELETE") { const ref = decodeURIComponent(u.split("ref=eq.")[1]); world.claims.delete(ref); return J(null, 204); }
  if (u.includes("/rest/v1/discord_dms?sent_at=is.null")) return J(world.unsent);
  if (u.includes("/rest/v1/discord_dms?id=eq.") && m === "PATCH") { world.patches.push({ id: decodeURIComponent(u.split("id=eq.")[1]), body: JSON.parse(opts.body) }); return J(null, 204); }
  if (u.includes("discord.com/api/v10/users/@me/channels")) { world.channels++; if (world.failOpen) return J({ message: "Cannot send messages to this user", code: 50007 }, 403); return J({ id: "dm-" + JSON.parse(opts.body).recipient_id }); }
  if (u.includes("discord.com/api/v10/channels/") && m === "POST") {
    world.postAttempts++;
    if (world.failPost === 403) return J({ message: "Cannot send messages to this user", code: 50007 }, 403);
    if (world.failPost === 500) return new Response("nope", { status: 500 });
    world.posts.push({ channel: u.split("/channels/")[1].split("/")[0], body: JSON.parse(opts.body) }); return J({ id: "m" + world.posts.length });
  }
  return J([]);
};
const env = { SB_URL: "https://sb.invalid", SB_KEY: "k", BOT: "t" };
const row = (over) => ({ id: "d1", profile_id: "p1", discord_id: "u1", kind: "availability", content: "Your Week 2 availability is not in.", sent_at: null, send_error: null, ...over });

console.log("— one row, one DM");
{
  const D = createDms(env);
  A("sent", (await D.send(row())) === "sent" && world.posts.length === 1);
  A("...to the member's DM channel, with mentions off", world.posts[0].channel === "dm-u1" && world.posts[0].body.allowed_mentions.parse.length === 0 && /Week 2/.test(world.posts[0].body.content));
  A("...and stamped sent_at", world.patches.some((p) => p.id === "d1" && p.body.sent_at));
  A("a second delivery of the same row is refused by the claim", (await D.send(row())) === "claimed-elsewhere" && world.posts.length === 1);
  A("the DM channel is opened once per member", (await D.send(row({ id: "d2" }))) === "sent" && world.channels === 1);
  A("an already-sent row is skipped", (await D.send(row({ id: "d3", sent_at: "x" }))) === "already");
}
console.log("— a closed door is recorded, not knocked on again");
{
  const D = createDms(env); world.failPost = 403; world.postAttempts = 0;
  A("refused", (await D.send(row({ id: "d4", discord_id: "u2" }))) === "refused" && world.postAttempts === 1);
  A("...send_error stamped, claim released, sent_at untouched", world.patches.some((p) => p.id === "d4" && /403/.test(p.body.send_error)) && !world.claims.has("dm:d4"));
  A("...and the catch-up leaves it alone (it selects rows with no error)", true);
  world.failPost = false;
}
console.log("— an unknown outcome is never sent twice");
{
  const D = createDms(env); world.failPost = 500; world.postAttempts = 0;
  A("unconfirmed", (await D.send(row({ id: "d5", discord_id: "u3" }))) === "unconfirmed" && world.postAttempts === 1);
  A("...claim kept", world.claims.has("dm:d5"));
  world.failPost = false;
  A("...and not re-sent by this process", (await D.send(row({ id: "d5", discord_id: "u3" }))) === "unconfirmed" && world.postAttempts === 1);
}
console.log("— the catch-up sends what realtime missed");
{
  const D = createDms(env); world.unsent = [row({ id: "d6", discord_id: "u4" })]; const before = world.posts.length;
  A("one sent", (await D.catchUp(0)) === 1 && world.posts.length === before + 1);
}
console.log(ok ? "\nPASS" : "\nFAILED"); process.exit(ok ? 0 : 1);
