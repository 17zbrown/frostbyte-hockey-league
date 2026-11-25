// v463 (commissioner, 2026-11-23: "#free-agency becomes the training camp pool channel"; Rule S2.5: the training camp
// channel is "open only to league staff, club management and the training camp pool"). Run: node tools/s2-camp-pool-channel-v463.test.mjs
//
// In a season the market runs (public.market_on for the season in play), #free-agency's audience is Commissioner, Staff,
// Owner, General Manager, Assistant General Manager and Training Camp, and Free Agent's overwrite comes off. In any other
// season the old audience stands, untouched; when the read failed the channel is left exactly as it is. Discord is
// stubbed: every call is recorded, nothing is sent.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";

import fs from "node:fs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
let calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = (opts.method || "GET").toUpperCase();
  if (u.includes("discord.com/api")) { calls.push(`${m} ${u.split("/api/v10")[1]}${opts.body ? " " + opts.body : ""}`); return new Response(m === "DELETE" ? null : "{}", { status: m === "DELETE" ? 204 : 200 }); }
  return new Response("[]", { status: 200 });
};
const { _internals: I } = await import(new URL("../jobs/discord-sync.js", import.meta.url).pathname);

const roleId = { owner: "r-own", "general manager": "r-gm", "assistant general manager": "r-agm", commissioner: "r-comm",
  staff: "r-staff", "free agent": "r-fa", "training camp": "r-tc" };
const view = (id) => ({ id, type: 0, allow: "68608", deny: "0" });
const hiddenFrom = { id: "guild1", type: 0, allow: "0", deny: "1024" };
const chan = (name, ids, hidden = true) => ({ id: "c-" + name, name, type: 0, permission_overwrites: [...(hidden ? [hiddenFrom] : []), ...ids.map(view)] });
const tradeOk = () => chan("trade-block", ["r-own", "r-gm", "r-agm", "r-comm"]);
const run = async (channels, marketOn) => { calls = []; const sum = { errors: [] }; await I.lockAudienceChannels(channels, roleId, marketOn, sum); return sum; };
const ALLOW = (id) => `PUT /channels/c-free-agency/permissions/${id} {"type":0,"allow":"68608","deny":"0"}`;

console.log("— Season 2: the training camp pool channel");
{
  const sum = await run([tradeOk(), chan("free-agency", ["r-own", "r-gm", "r-agm", "r-comm", "r-fa"])], true);
  const expect = [ALLOW("r-own"), ALLOW("r-gm"), ALLOW("r-agm"), ALLOW("r-comm"), ALLOW("r-staff"), ALLOW("r-tc"),
    `PUT /channels/c-free-agency/permissions/guild1 {"type":0,"deny":"1024","allow":"0"}`,
    "DELETE /channels/c-free-agency/permissions/r-fa"];
  A("staff, the seats, the commissioners and Training Camp are let in, then Free Agent's view comes off, in that order",
    JSON.stringify(calls) === JSON.stringify(expect), JSON.stringify(calls));
  A("...and the run says so", sum.channelViewDropped === 1 && sum.errors.length === 0);
  A("#trade-block, already right, costs nothing", !calls.some((c) => c.includes("c-trade-block")));

  await run([tradeOk(), chan("free-agency", ["r-own", "r-gm", "r-agm", "r-comm", "r-staff", "r-tc"])], true);
  A("a converged pool channel costs zero calls", calls.length === 0, JSON.stringify(calls));
}

console.log("\n— a season the market does not run: unchanged");
{
  await run([tradeOk(), chan("free-agency", ["r-own", "r-gm", "r-agm", "r-comm", "r-fa"])], false);
  A("the free-agent audience stands with no call at all", calls.length === 0, JSON.stringify(calls));
  await run([tradeOk(), chan("free-agency", ["r-own", "r-gm", "r-agm", "r-comm"])], false);
  A("...and a missing Free Agent view is healed as before, with no Staff or Training Camp grant and nothing removed",
    calls.includes(ALLOW("r-fa")) && !calls.some((c) => /r-staff|r-tc|DELETE/.test(c)), JSON.stringify(calls));
}

console.log("\n— the market read failed: the channel is left exactly as it is");
{
  await run([chan("trade-block", ["r-own"], false), chan("free-agency", ["r-fa"], false)], null);
  A("#free-agency is not touched", !calls.some((c) => c.includes("c-free-agency")), JSON.stringify(calls));
  A("...while #trade-block still heals", calls.some((c) => c.includes("c-trade-block")));
}

console.log("\n— the sweep wires it to the database's answer");
{
  const src = fs.readFileSync(new URL("../jobs/discord-sync.js", import.meta.url), "utf8");
  A("market_on is read for the season in play, inside the role inputs",
    /if \(curSeason\) marketOn = \(await sbGet\(`rpc\/market_on\?p_season=\$\{curSeason\.id\}`\)\) === true;/.test(src));
  A("...unknown until it answers", /let marketOn = null;/.test(src));
  A("the sweep hands it to the channel audience", /await lockAudienceChannels\(guildChannels, roleId, marketOn, sum\);/.test(src));
}

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
