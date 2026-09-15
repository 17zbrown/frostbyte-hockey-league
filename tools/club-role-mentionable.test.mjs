// Club roles are mentionable so a club's management can @Club in the team channel and in any
// channel they can post in (2026-09-14). Discord's only other way to let someone ping a
// non-mentionable role is MENTION_EVERYONE — the server-wide megaphone enforceMentionPolicy keeps
// with the league office — so a mentionable club role (it pings only that club's members) is the
// right tool. Run: node tools/club-role-mentionable.test.mjs
//
// The reconcile lives inside the big sweep function and is not unit-exported, so this asserts the
// source contract (like role-sync.test.mjs asserts the sweep imports the shared rules): both
// club-role creation sites ask for mentionable:true, the sweep reconciles it every pass, and the
// mention-permission guard is NOT what we changed (it still governs MENTION_EVERYONE only).
import fs from "node:fs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const src = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");

/* both places that CREATE a club role must ask for a mentionable role */
const createMentionable = (src.match(/roles`, \{ name: t\.name, color: wantColor, mentionable: true \}/g) || []).length;
A("both club-role creation sites create a mentionable role", createMentionable === 2, `found ${createMentionable}/2`);
A("no club-role creation site still creates a non-mentionable role",
  !src.includes("{ name: t.name, color: wantColor, mentionable: false }"));

/* the every-sweep reconcile flips an existing club role back to mentionable if it drifted off */
A("the sweep reads each club role's current mentionable flag",
  src.includes("const roleMentionableById = Object.fromEntries(guildRoles.map((r) => [r.id, !!r.mentionable]))"));
A("the sweep reconciles a club role to mentionable when it is not",
  /roleMentionableById\[t\.discord_role_id\] !== true[\s\S]{0,120}patch\.mentionable = true/.test(src));

/* the megaphone guard is untouched: it still governs the MENTION_EVERYONE permission, not the
   mentionable flag, and still exempts only the two roles the rulebook names */
A("the mention-permission guard still targets MENTION_EVERYONE (bit 17), not the mentionable flag",
  src.includes("const MENTION_EVERYONE = 1n << 17n") && src.includes('const MENTION_ALLOWED = new Set(["commissioner", "staff"])'));

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
