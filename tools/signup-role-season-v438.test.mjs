/* v4.38 (2026-10-31). Commissioner: "I would like the not signed up role to be specific to the season that is eligible
   to be signed up for. Can you delete the old role and keep 1 role and rename it depending on what season the signups
   are attached to?" and "Also delete the season signups channel and remake it. Re enable the sign up reminders every 3
   days starting today as well in the new channel."
   Before: every lookup of the sign-up role was by NAME. A hand rename to "S2 Not Signed Up" (2026-10-25) made the sweep
   build a second "Not Signed Up" and froze the first on everyone who wore it. And nothing created #season-signups, so a
   remade channel would have had no webhook for the reminder.
   After: the role is the one whose id is stored (app_config.discord_not_signed_up_role_id), filed under "not signed up"
   in every role map (sweep, gateway bot, posting policy, rolecheck); the sweep names it "S<n> Not Signed Up" for the
   season taking sign-ups and reports look-alikes for the office to reap by id. #season-signups is an Information feed
   the sweep adopts or builds, with a "CGHL Sign-ups" webhook kept in discord_signup_webhook.
   Run: node tools/signup-role-season-v438.test.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";

let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");

const roles = await import(new URL("../shared/roles.mjs", import.meta.url).pathname);
const { roleIdMap, notSignedUpName, notSignedUpStrays, NOT_SIGNED_UP, managedRoleIds, desiredRolesFor } = roles;

console.log("1. One sign-up role, found by its stored id");
{
  const G = [{ id: "old", name: "S2 Not Signed Up" }, { id: "new", name: "S2 Not Signed Up" }, { id: "p", name: "Player" }];
  const m = roleIdMap(G, "new");
  A("the stored id wins over any name", m[NOT_SIGNED_UP] === "new");
  A("...and the other look-alike is reported as a stray, never adopted", JSON.stringify(notSignedUpStrays(G, m)) === JSON.stringify([{ id: "old", name: "S2 Not Signed Up" }]));
  A("the rest of the map is by name, as before", m["player"] === "p");
  A("two look-alikes and no stored id: nothing is guessed", roleIdMap(G, null)[NOT_SIGNED_UP] === undefined);
  A("a stored id that no longer exists is not trusted", roleIdMap(G, "gone")[NOT_SIGNED_UP] === undefined);
  A("no stored id: a role named exactly Not Signed Up is adopted (a fresh server)",
    roleIdMap([{ id: "x", name: "Not Signed Up" }, { id: "y", name: "S3 Not Signed Up" }], "")[NOT_SIGNED_UP] === "x");
  A("no stored id: the ONE season-named role is adopted", roleIdMap([{ id: "y", name: "S3 Not Signed Up" }], null)[NOT_SIGNED_UP] === "y");
  A("the season name", notSignedUpName(2) === "S2 Not Signed Up" && notSignedUpName(12) === "S12 Not Signed Up" && notSignedUpName(null) === "Not Signed Up");
  A("a season-named role is still a managed role (it is added and removed)", managedRoleIds(m, []).has("new") && !managedRoleIds(m, []).has("old"));
  const want = desiredRolesFor({ profile_id: "u1", role: "member", team_id: null },
    { roleId: m, teamRoleId: {}, registered: new Set(), playing: new Set(), regOpen: true, mgmtRoleByProfile: {}, deptByProfile: {}, posOf: {} });
  A("an unregistered member gets the season-named role while sign-ups are open", want.has("new") && !want.has("old"));
}

console.log("\n2. The posting policy reads the role by id, not by its season name");
{
  let patched = [];
  globalThis.fetch = async (url, opts = {}) => {
    const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    if (opts.method === "PATCH" && /\/roles\//.test(String(url))) patched.push({ id: String(url).split("/roles/")[1], perms: JSON.parse(opts.body).permissions });
    return J({});
  };
  const { _internals: I } = await import(new URL("../jobs/discord-sync.js", import.meta.url).pathname);
  const EMBED = 1n << 14n, ATTACH = 1n << 15n, FULL = 2248473465704001n;
  const G = [{ id: "nsu", name: "S2 Not Signed Up", permissions: String(FULL), managed: false }];
  await I.enforcePostingPolicy(G, [], { errors: [] }, { [NOT_SIGNED_UP]: "nsu" });
  const p = patched.find((x) => x.id === "nsu"), perms = p ? BigInt(p.perms) : null;
  A("S2 Not Signed Up gets the named-deny treatment: attach stripped", perms !== null && (perms & ATTACH) === 0n);
  A("...and keeps embed for the GIF picker", perms !== null && (perms & EMBED) === EMBED);
}

console.log("\n3. The sweep");
{
  const s = R("jobs/discord-sync.js");
  A("the sweep's role map is roleIdMap with the stored id",
    /const roleId = roleIdMap\(guildRoles, \(await sbCfgMany\(\["discord_not_signed_up_role_id"\]\)\)\.discord_not_signed_up_role_id\);/.test(s));
  A("...and so is the rolecheck report's", /const rid = roleIdMap\(roles, \(await sbCfgMany\(\["discord_not_signed_up_role_id"\]\)\)\.discord_not_signed_up_role_id\);/.test(s));
  A("no role map is built by name alone any more", !/for \(const r of guildRoles\) roleId\[r\.name\.toLowerCase\(\)\] = r\.id;/.test(s));
  A("the sign-up season's number is loaded", /seasons\?select=id,number,registration_open&registration_open=is\.true/.test(s) && /regNumber = s\.number \|\| null;/.test(s));
  A("the role is renamed to the season name only while a season takes sign-ups",
    /if \(regOpen && regNumber && roleId\[NOT_SIGNED_UP\]\) \{/.test(s) && /want = notSignedUpName\(regNumber\)/.test(s) && /dApi\("PATCH", `\/guilds\/\$\{GUILD\}\/roles\/\$\{rid\}`, \{ name: want \}\)/.test(s));
  A("look-alikes are reported in the result, never deleted by the sweep",
    /sum\.signupRoleStrays = strays/.test(s) && /signupRoleStrays: sum\.signupRoleStrays \|\| null/.test(s) && !/notSignedUpStrays[^\n]*DELETE/.test(s));
  A("the posting policy is given the role map", /enforcePostingPolicy\(guildRoles, teams, sum, roleId\)/.test(s) && /const name = r\.id === nsuId \? NOT_SIGNED_UP : /.test(s));
  A("#season-signups is an Information feed with its own webhook in discord_signup_webhook",
    /name: "season-signups",[\s\S]{0,200}hookName: "CGHL Sign-ups", cfgKey: "discord_signup_webhook"/.test(s));
  A("...built read-only like #announcements (everyone reads, the commissioners post)",
    /async function ensureInfoFeed\(/.test(s) && /\{ id: GUILD, type: 0, allow: String\(INFO_EVERYONE_ALLOW\), deny: String\(INFO_EVERYONE_DENY\) \}/.test(s)
    && /for \(const feed of INFO_FEEDS\) await ensureInfoFeed\(/.test(s));
  A("#announcements keeps its hook name and key", /hookName: "CGHL Announcements", cfgKey: "discord_announcements_webhook", sumKey: "announcements"/.test(s));
  A("a reaped channel leaves this run's list, so the feed is rebuilt in the same run",
    /const gi = guildChannels\.findIndex\(\(c\) => c\.id === String\(cid\)\); if \(gi >= 0\) guildChannels\.splice\(gi, 1\);/.test(s));
  A("the reap still runs before the feeds are ensured", s.indexOf('key=eq.discord_reap') < s.indexOf("await ensureAnnouncements(guildChannels, roleId, sum)"));
}

console.log("\n4. The gateway bot reads the same role");
{
  const b = R("bot/role-sync.mjs");
  A("the bot's role map is roleIdMap with the stored id",
    /sbGet\("app_config\?key=eq\.discord_not_signed_up_role_id&select=value"\)/.test(b) && /const roleId = roleIdMap\(guildRoles, nsuCfg && nsuCfg\[0\] && nsuCfg\[0\]\.value\);/.test(b));
}

console.log("\n5. The reminder");
{
  const d = R("jobs/discord-scheduler.js");
  const i = d.indexOf("async function signupReminder"), body = d.slice(i, d.indexOf("\n}\n", i));
  A("its copy has no dashes", !DASHES.test(body.slice(body.indexOf("const content ="), body.indexOf("if (dry)"))));
  A("it still posts every N days by window (3 unless set), through discord_signup_webhook",
    /parseInt\(cfg\.signup_reminder_days \|\| "3", 10\)/.test(body) && /cfg\.discord_signup_webhook \|\| cfg\.discord_default_webhook/.test(body) && /Math\.floor\(etDayNum\(et\.ymd\) \/ EVERY\)/.test(body));
}

console.log("\n6. The changelog");
{
  const CG = {}; new Function("CG", R("src/live/part3_content.js"))(CG);
  const e = CG.CONTENT.rulebook.changelog.find((c) => c.version === "4.38") || {};   /* by version: a later release takes changelog[0] */
  const t = JSON.stringify(e);
  A("the changelog has its 4.38 entry", e.dateIso === "2026-10-31" && typeof e.summary === "string" && Array.isArray(e.items) && e.items.length > 0);
  A("...naming the season role and the channel", /S2 Not Signed Up/.test(t) && /#season-signups/.test(t) && /every three days/i.test(t));
  A("...with no dashes and no gendered pronouns", !DASHES.test(t) && !/ - /.test(t) && !/\b(he|his|him|she|her|hers)\b/i.test(t));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
