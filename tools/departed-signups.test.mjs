// Leaving the Discord does NOT withdraw a sign-up (rule retired 2026-09-14). This once pinned the
// sweep step that enforced the withdrawal; now it guards the opposite — that the automatic rule
// stays gone. The remove_departed_signups RPC and its season_registration_removals archive remain
// in the database as an office-only manual tool, but nothing calls them automatically.
// Run: node tools/departed-signups.test.mjs
import { readFileSync } from "node:fs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const src = readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");

A("the sweep no longer defines an automatic removeDepartedSignups helper",
  !src.includes("async function removeDepartedSignups"));
A("the sweep never calls the remove_departed_signups RPC",
  !src.includes("rpc/remove_departed_signups"));
A("nothing exports removeDepartedSignups from the sync module",
  !src.includes("removeDepartedSignups,") && !/removeDepartedSignups\b/.test(src));
A("the retirement is documented in the source where the rule used to live",
  src.includes("leaving the Discord no longer touches the sign-up board"));

/* the module still loads and exports its live internals (nothing else broke) */
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";
const { _internals: I } = await import(new URL("../netlify/functions/discord-sync.js", import.meta.url).pathname);
A("the sync module still imports and exposes its internals", I && typeof I === "object");
A("the removed helper is not on _internals", !("removeDepartedSignups" in (I || {})));

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
