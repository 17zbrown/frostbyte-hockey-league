/* v2.33 — a member switches the Discord account the league follows, from Settings.
   Run: node tools/discord-switch.test.cjs   (build index.html first)

   NOT COVERED HERE: the database — switch_discord_account() and my_discord_accounts(). Rehearsed
   against production, rolled back: an id among the caller's own auth.identities was accepted and
   profiles.discord_id moved (proving the column guard opened for this one writer), a
   role_sync_queue row and an admin_audit row were written, an id NOT among their identities was
   refused, the same id twice reported changed=false, and a direct UPDATE of discord_id under
   member claims was still reverted by guard_profile_role. Re-run that rehearsal if the SQL moves. */
const fs = require("fs"), path = require("path");
const live = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the settings card");
A("Settings renders a Discord account card", /id="dcAcctCard"/.test(live) && /<h3>Discord account<\/h3>/.test(live));
A("...bound when the settings page mounts", /if \(document\.getElementById\("dcAcctCard"\)\) CG\.loadDiscordAccounts\(\);/.test(live));
A("it reads the member's linked accounts from the database", /CG\.sb\.rpc\("my_discord_accounts"\)/.test(live));
A("switching goes through the one sanctioned RPC", /CG\.sb\.rpc\("switch_discord_account",\{ p_discord_id:String\(id\) \}\)/.test(live));
A("...never a direct profiles write of discord_id", !/from\("profiles"\)\.update\(\{[^}]*discord_id/.test(live));

console.log("— linking a new account comes back here and switches on its own");
A("the link stashes a return to Settings, not the sign-in page", /cg_return", JSON\.stringify\(\{ h:"#\/hub\/settings"/.test(live));
A("...and a switch intent flag", /localStorage\.setItem\("cg_dc_switch"/.test(live));
A("the flag is consumed on read so a refresh cannot replay it", /localStorage\.removeItem\("cg_dc_switch"\)/.test(live));
A("only an identity linked AFTER the flag was set is auto-switched — never an older one", /Date\.parse\(a\.linked_at\) >= since - 60000/.test(live));
A("a failed link start clears the flag (both entry points)", (live.match(/localStorage\.removeItem\("cg_dc_switch"\)/g) || []).length >= 3);
A("the #/signin link button lands on Settings and switches too", /cg_return", JSON\.stringify\(\{ h:"#\/hub\/settings"/.test(live.slice(live.indexOf("dcLink\")"), live.indexOf("dcLink\")") + 2600)));
A("the server is pinged so roles move in seconds, not on the next sweep", /if \(CG\.pingDiscordSync\) CG\.pingDiscordSync\(\);\s*\/\* the server follows within seconds \*\//.test(live));

console.log("— honesty about the server");
A("the chip distinguishes in-server from not-yet", /"In the server" : "Not in the server yet"/.test(live));
A("a not-yet account gets the INVITE and a re-check — never the retired sign-out-and-back-in advice", /Join the server with this account/.test(live) && /id="dcRecheck"/.test(live) && !/Sign out and back in with it and you’ll be added/.test(live));
A("...and is told to join so their roles come across (the withdraw-on-leave rule is retired)", /join now so your roles come across/.test(live) && !/withdrawn after about a day out of the server/.test(live));
A("the re-check reads presence from the database, not the cached profile", /CG\.sb\.rpc\("my_discord_accounts"\)\.then\(function\(r\)\{\s*var dd=/.test(live));
A("the card says the league name follows the new account's display name", /Your league name follows the new account’s Discord display name/.test(live));
A("the old account's roles are promised within a couple of minutes, not instantly", /the old account’s league roles come off in the same sweep/.test(live) && !/the old account keeps nothing/.test(live));
A("the switch toast has two honest branches", /your Discord roles are moving over/.test(live) && /join the server with it for Discord roles/.test(live));
A("no client code ever proposes discord_id — switch_discord_account is the only writer", !/patch\.discord_id = /.test(live) && !/idPatch\.discord_id/.test(live));
A("the copy tells them to check WHICH account Discord has signed in", /log out at discord\.com first/.test(live));
A("the local profile is updated so the page does not lie until reload", /CG\.auth\.profile\.discord_id=String\(d\.discord_id\|\|id\); CG\.auth\.profile\.in_guild=!!d\.in_guild;/.test(live));
console.log(ok ? "\nPASS" : "\nFAIL"); process.exit(ok ? 0 : 1);
