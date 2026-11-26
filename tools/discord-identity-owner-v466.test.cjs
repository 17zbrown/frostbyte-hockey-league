/* v4.66 (live health finding fit 0, 2026-11-25): ONE owner for a member's Discord name and avatar on public.profiles.
   The site's sign-in (src/s2/js/live.js S2.discordIdentityPatch, written from apply() on every page load) and the
   discord-sync job (jobs/discord-sync.js steps 1b and 1c, every 2-minute sweep) kept overwriting each other: the site
   wrote the Discord display name (custom_claims.global_name) and the avatar URL from the last sign-in, the job the @handle
   (mem.user.username) and the current avatar with ?size=128. Edge logs showed the same 17 profiles ping-ponging within
   minutes. Now: for a member discord-sync maintains (in_guild) the site writes nothing; for anyone else it writes the
   job's meaning, the handle (identity full_name; name is "<handle>#0"), and compares avatars without the query string.
   Production's Discord identities carry full_name, name and custom_claims, never user_name or preferred_username
   (read-only count, 331 of 331), so the fixtures here use that shape.
   Run: node tools/discord-identity-owner-v466.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
const REPO = path.join(__dirname, "..");
let n = 0, fails = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "ok   " : "FAIL ") + name + (cond || more === undefined ? "" : "  got: " + JSON.stringify(more))); if (!cond) fails++; };

/* the function as the site ships it, lifted out of live.js's IIFE (it is pure: user and profile in, a patch or null out) */
const LIVE = fs.readFileSync(path.join(REPO, "src/s2/js/live.js"), "utf8");
const m = LIVE.match(/\n  S2\.discordIdentityPatch = function \(user, profile\) \{[\s\S]*?\n  \};\n/);
A("live.js defines S2.discordIdentityPatch where this test reads it", !!m);
const S2 = {};
vm.runInNewContext(m[0], { S2 }, { filename: "live.js" });
const patch = S2.discordIdentityPatch;

const AV = "https://cdn.discordapp.com/avatars/1/x.png";
const user = (over) => ({ id: "u-1", identities: [Object.assign({ provider: "discord", id: "i-1", last_sign_in_at: "2026-11-25T00:00:00Z",
  identity_data: { provider_id: "1", sub: "1", full_name: "h", name: "h#0", custom_claims: { global_name: "G" }, avatar_url: AV } }, over || {})] });
const prof = (o) => Object.assign({ id: "u-1", discord_id: "1", discord_username: "h", avatar_url: AV + "?size=128", in_guild: false }, o);

console.log("\nthe job owns what it maintains");
A("a member in the server (in_guild) gets no patch, whatever the sign-in carries", patch(user(), prof({ in_guild: true, discord_username: "G", avatar_url: "https://cdn.discordapp.com/avatars/1/old.png?size=128" })) === null);
A("discord-sync step 1b still writes the @handle (mem.user.username) for everyone in the server",
  /\(1b\)[^\n]*\n\s*const handle = mem\.user && mem\.user\.username;\n\s*if \(handle && handle !== m\.discord_username\) \{ await sbPatch\(`profiles\?id=eq\.\$\{m\.profile_id\}`, \{ discord_username: handle \}\)/.test(fs.readFileSync(path.join(REPO, "jobs/discord-sync.js"), "utf8")));
A("discord-sync step 1c still keeps the avatar current with ?size=128", /\.png\?size=128` : null;/.test(fs.readFileSync(path.join(REPO, "jobs/discord-sync.js"), "utf8")));

console.log("\noutside the server the site writes the job's meaning");
A("the stored handle and the job's ?size=128 avatar are already right: no patch", patch(user(), prof()) === null);
A("a display name (global_name) stored by the old rule becomes the handle", JSON.stringify(patch(user(), prof({ discord_username: "G" }))) === JSON.stringify({ discord_username: "h" }), patch(user(), prof({ discord_username: "G" })));
A("with no full_name the handle is name without its #0", JSON.stringify(patch(user({ identity_data: { provider_id: "1", name: "h#0", avatar_url: AV } }), prof({ discord_username: null }))) === JSON.stringify({ discord_username: "h" }));
A("a new avatar hash is written", JSON.stringify(patch(user(), prof({ avatar_url: "https://cdn.discordapp.com/avatars/1/old.png?size=128" }))) === JSON.stringify({ avatar_url: AV }));
A("no stored avatar takes the sign-in's", JSON.stringify(patch(user(), prof({ avatar_url: null }))) === JSON.stringify({ avatar_url: AV }));
A("a custom picture (Supabase storage) is never replaced", patch(user(), prof({ avatar_url: "https://bzbuyclwdhmhdzujxeqd.supabase.co/storage/v1/object/public/avatars/u-1.png" })) === null);

console.log("\nwhat it never does");
A("a discord_id the league office pinned (none of this login's identities) is left alone", patch(user(), prof({ discord_id: "999", discord_username: "G" })) === null);
A("no Discord identity, no user or no profile: null", patch({ identities: [] }, prof()) === null && patch(null, prof()) === null && patch(user(), null) === null);
A("it never proposes discord_id or the gamertag", Object.keys(patch(user(), prof({ discord_username: "G", avatar_url: null })) || {}).sort().join() === "avatar_url,discord_username");

console.log(fails ? "\n" + fails + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fails ? 1 : 0);
