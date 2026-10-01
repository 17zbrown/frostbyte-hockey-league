/* v3.77: no link previews in anything the league posts to Discord. Commissioner, 2026-10-01: "make sure in
   the future to always remove the embed when you use a link in any text on the server."
   Part 1 pins the shared helper (shared/discord-links.cjs); part 2 pins that every lane that writes a Discord
   message goes through it (the Netlify functions, the gateway bot, the FAQ guide poster, the database). */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const { SUPPRESS_EMBEDS, wrapLinks, noLinkPreviews, noLinkPreviewsEdit, hasLink } = require("../shared/discord-links.cjs");
const J = (x) => JSON.stringify(x);

console.log("— the flag, on a new message with no cards of its own");
A("SUPPRESS_EMBEDS is 1 << 2", SUPPRESS_EMBEDS === 4);
A("a plain message with a link gets flag 4, text untouched", J(noLinkPreviews({ content: "Read https://chelgamingleague.com/#/rules" })) === J({ content: "Read https://chelgamingleague.com/#/rules", flags: 4 }));
A("...and keeps the flags it had (silent 4096 + 4)", noLinkPreviews({ content: "x https://a.com", flags: 4096 }).flags === 4100);
A("...a message with no link still gets it (a later edit may add one)", noLinkPreviews({ content: "hello" }).flags === 4);
A("an explicitly empty embeds list counts as none", noLinkPreviews({ content: "https://a.com", embeds: [] }).flags === 4);
A("the input is never mutated", (() => { const p = { content: "https://a.com" }; noLinkPreviews(p); return !("flags" in p); })());

console.log("— rich cards survive: links in content are wrapped instead");
const rich = noLinkPreviews({ content: "Box score: https://chelgamingleague.com/#/game/12", embeds: [{ title: "Final" }] });
A("no flag on a message with rich embeds (it would hide the card)", !("flags" in rich), J(rich));
A("...the link is wrapped", rich.content === "Box score: <https://chelgamingleague.com/#/game/12>", rich.content);
A("...the embed itself is untouched", J(rich.embeds) === J([{ title: "Final" }]));

console.log("— wrapping");
A("trailing period stays outside", wrapLinks("See https://a.com/x.") === "See <https://a.com/x>.");
A("prose parentheses stay outside", wrapLinks("(https://a.com/x)") === "(<https://a.com/x>)");
A("a link with its own balanced parens keeps them", wrapLinks("https://en.wikipedia.org/wiki/Foo_(bar) ok") === "<https://en.wikipedia.org/wiki/Foo_(bar)> ok");
A("bold markers stay outside", wrapLinks("**https://a.com**") === "**<https://a.com>**");
A("masked links get the bracket form", wrapLinks("[the rules](https://a.com/r)") === "[the rules](<https://a.com/r>)");
A("already wrapped links are left alone", wrapLinks("<https://a.com> and [x](<https://b.com>)") === "<https://a.com> and [x](<https://b.com>)");
A("inline code is left alone", wrapLinks("run `curl https://a.com` then https://b.com") === "run `curl https://a.com` then <https://b.com>");
A("fenced code is left alone", wrapLinks("```\nhttps://a.com\n```\nhttps://b.com") === "```\nhttps://a.com\n```\n<https://b.com>");
A("several links, all wrapped", wrapLinks("a https://a.com b http://b.com/c?d=1&e=2") === "a <https://a.com> b <http://b.com/c?d=1&e=2>");
A("a link carrying another link is wrapped once, whole", wrapLinks("go https://a.com/?u=http://b.com now") === "go <https://a.com/?u=http://b.com> now");
A("...and left alone once wrapped", wrapLinks("<https://a.com/?u=http://b.com>") === "<https://a.com/?u=http://b.com>");
A("...and as a masked link, wrapped once", wrapLinks("[x](https://a.com/?u=http://b.com)") === "[x](<https://a.com/?u=http://b.com>)");
A("a masked link to a wiki style URL keeps its own parens", wrapLinks("[w](https://w.org/Foo_(bar))") === "[w](<https://w.org/Foo_(bar)>)");
A("an unclosed bracket is not mistaken for a wrapped link", wrapLinks("a <https://a.com b") === "a <https://a.com b");
A("typographic closers stay outside", wrapLinks("\u2018quoted https://a.com\u2019 \u201Chttps://b.com\u201D https://c.com\u2026") === "\u2018quoted <https://a.com>\u2019 \u201C<https://b.com>\u201D <https://c.com>\u2026");
A("text with no link is returned as is", wrapLinks("no links here") === "no links here");
A("a URL glued to a word is not a link Discord would see", wrapLinks("xhttps://a.com") === "xhttps://a.com");
const long = "x".repeat(1985) + " https://a.com";
A("brackets that would break the 2000 limit fall back to the original text", wrapLinks(long) === long);
A("hasLink sees http and https only", hasLink("go https://a.com") && hasLink("http://a.com") && !hasLink("a.com") && !hasLink(null));

console.log("— edits");
const ed = noLinkPreviewsEdit({ content: "Updated: https://a.com" });
A("an edit that leaves embeds alone wraps instead of flagging", !("flags" in ed) && ed.content === "Updated: <https://a.com>", J(ed));
A("an edit that clears embeds may flag", noLinkPreviewsEdit({ content: "https://a.com", embeds: [] }).flags === 4);
A("an edit that restates rich embeds wraps", noLinkPreviewsEdit({ content: "https://a.com", embeds: [{ title: "t" }] }).content === "<https://a.com>");
A("an edit with only components is left alone", J(noLinkPreviewsEdit({ components: [] })) === J({ components: [] }));

console.log("— other shapes");
const fp = noLinkPreviews({ name: "FAQ: waivers", message: { content: "https://a.com/faq" }, applied_tags: ["1"] });
A("a forum post flags its message, not the thread", fp.message.flags === 4 && !("flags" in fp) && fp.name === "FAQ: waivers");
A("a bare thread body is left alone", J(noLinkPreviews({ name: "t", type: 11, auto_archive_duration: 1440 })) === J({ name: "t", type: 11, auto_archive_duration: 1440 }));
A("interaction type 4 flags its data and keeps ephemeral (64)", noLinkPreviews({ type: 4, data: { content: "https://a.com", flags: 64 } }).data.flags === 68);
A("interaction type 4 with a card wraps", noLinkPreviews({ type: 4, data: { content: "https://a.com", embeds: [{}] } }).data.content === "<https://a.com>");
A("interaction type 7 (update) is an edit", (() => { const r = noLinkPreviews({ type: 7, data: { content: "https://a.com" } }); return !("flags" in r.data) && r.data.content === "<https://a.com>"; })());
A("a deferral (type 5) is untouched", J(noLinkPreviews({ type: 5, data: { flags: 64 } })) === J({ type: 5, data: { flags: 64 } }));
A("a modal (type 9) is untouched", J(noLinkPreviews({ type: 9, data: { custom_id: "m", title: "t", components: [] } })) === J({ type: 9, data: { custom_id: "m", title: "t", components: [] } }));
A("a pong (type 1) is untouched", J(noLinkPreviews({ type: 1 })) === J({ type: 1 }));
A("non-objects pass through", noLinkPreviews("text") === "text" && noLinkPreviews(null) === null);

console.log("— the module loads both ways");
const src = R("shared/discord-links.cjs");
A("named exports are written as exports.x = (Node's ESM lexer reads only that form)", ["SUPPRESS_EMBEDS", "hasLink", "wrapLinks", "noLinkPreviews", "noLinkPreviewsEdit"].every((k) => new RegExp("^exports\\." + k + " = ", "m").test(src)));
const { execFileSync } = require("child_process");
let esm = "";
try { esm = execFileSync(process.execPath, ["--input-type=module", "-e", "import { noLinkPreviews } from './shared/discord-links.cjs'; console.log(noLinkPreviews({ content: 'https://a.com' }).flags);"], { cwd: path.join(__dirname, ".."), encoding: "utf8" }).trim(); } catch (e) { esm = String(e.message); }
A("an ES module can import it by name", esm === "4", esm);

console.log("— part 2: every lane that writes a Discord message goes through it");
const fsx = require("fs");
const ls = (d, re) => fsx.readdirSync(path.join(__dirname, "..", d)).filter((f) => re.test(f)).map((f) => d + "/" + f);
const MARK = /\/messages|\/webhooks\/|\/threads|\/callback|_webhook|discord\.com\/api/;
/* Files that name a Discord endpoint but write no message. Adding one here needs a reason. */
const NO_MESSAGES = {
  "netlify/functions/discord-join.js": "guild reads and the member PUT that adds a user to the server",
  "bot/role-sync.mjs": "member role PATCHes only",
};
const lanes = [...ls("netlify/functions", /\.js$/), ...ls("bot", /\.mjs$/), ...ls("tools/discord", /\.mjs$/)];
const writers = lanes.filter((f) => MARK.test(R(f)) && !NO_MESSAGES[f]);
const unguarded = writers.filter((f) => !/from "\.\.\/(\.\.\/)?shared\/discord-links\.cjs"/.test(R(f)) || !/noLinkPreviews(Edit)?\(/.test(R(f)));
A("every file that writes a Discord message imports and calls the helper", unguarded.length === 0, unguarded.join(", "));
A("...and that is at least the thirteen known writers", writers.length >= 13, writers.length + ": " + writers.join(", "));
A("the exceptions still exist (a stale exception hides nothing)", Object.keys(NO_MESSAGES).every((f) => fsx.existsSync(path.join(__dirname, "..", f))));
const adhoc = writers.filter((f) => /flags\s*:\s*4\s*[,}]/.test(R(f)));
A("no competing hand-set flags: 4 left beside the helper", adhoc.length === 0, adhoc.join(", "));

const gated = (f) => /method === "POST" && [A-Za-z_]*\.test\(p(ath)?\) \? noLinkPreviews\(body\)|if \(method === "POST" && [A-Z_]+\.test\(path\)\) return noLinkPreviews\(body\);|if \(method === "POST" && \/\^\\\/channels/.test(R(f));
A("generic REST helpers apply it to message paths only, by method", ["bot/dms.mjs", "bot/handlers.mjs", "netlify/functions/discord-interactions.js", "netlify/functions/lfg-timers.js", "netlify/functions/discord-sync.js", "netlify/functions/discord-scheduler.js", "netlify/functions/discord-welcome.js"].every(gated), ["bot/dms.mjs", "bot/handlers.mjs", "netlify/functions/discord-interactions.js", "netlify/functions/lfg-timers.js", "netlify/functions/discord-sync.js", "netlify/functions/discord-scheduler.js", "netlify/functions/discord-welcome.js"].filter((f) => !gated(f)).join(", "));
A("...edits by PATCH get the edit rule", ["bot/dms.mjs", "bot/handlers.mjs", "netlify/functions/discord-interactions.js", "netlify/functions/lfg-timers.js", "netlify/functions/discord-sync.js", "netlify/functions/discord-scheduler.js", "netlify/functions/discord-welcome.js"].every((f) => /method === "PATCH" && .{0,80}noLinkPreviewsEdit\(body\)/.test(R(f))));
A("every interaction callback goes out through respond(), which applies it", /const respond = \(obj\) => \(\{[^\n]*JSON\.stringify\(noLinkPreviews\(obj\)\)/.test(R("netlify/functions/discord-interactions.js")));
A("the scheduler's webhook poster applies it to every post", /payload = noLinkPreviews\(payload\);/.test(R("netlify/functions/discord-scheduler.js")));
A("the FAQ guide poster flags the forum post's message", /JSON\.stringify\(noLinkPreviews\(\{ name: g\.title/.test(R("tools/discord/post-faq-guides.mjs")));

const sql = R("sql/2026-10-01-no-link-previews-v377.sql"), audit = R("tools/sql/grant-audit.sql");
A("the database: one wrapper, the seven writers moved onto it", /create or replace function public\.discord_http_post\(url text/.test(sql) && /body := public\.discord_no_previews\(body\)/.test(sql)
  && ["_announce_once', 1", "_mgmt_move_send', 1", "automation_watchdog', 5", "notify_discord', 1", "notify_staff_ch', 1", "notify_trade_block', 1", "withdraw_registration', 1"].every((k) => sql.includes("('" + k + ")"))
  && /d := replace\(d0, 'net\.http_post\(', 'public\.discord_http_post\('\);/.test(sql));
A("...internal only", /revoke all on function public\.discord_http_post\(text, jsonb, jsonb, integer\) from public, anon, authenticated;/.test(sql));
A("...rehearsed and applied", /REHEARSAL OK: W\(23\) W2 N1-6 P1 F1-3 E1 G1/.test(sql) && /APPLIED 2026-10-01 as migration v377_no_link_previews/.test(sql));
A("the grant audit catches a future direct post", /'discord-post-without-no-previews'/.test(audit) && /p\.proname <> 'discord_http_post'/.test(audit) && /'_place_trade_arrivals','discord_http_post'\)/.test(audit));
A("the SQL twin uses the JS helper's punctuation set", /\[\.,;:!\?''"\*_~\|’”»›…\]/.test(sql) && /\\u2019\\u201D\\u00BB\\u203A\\u2026/.test(R("shared/discord-links.cjs")));

const C = (() => { const t = R("src/live/part3_content.js"); return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); })();
const findCl = (o) => { if (o && typeof o === "object") { if (Array.isArray(o.changelog)) return o.changelog; for (const v of Object.values(o)) { const r = findCl(v); if (r) return r; } } return null; };
const e377 = (findCl(C) || []).find((e) => e.version === "3.77");
A("the site changelog records 3.77", !!e377 && /no longer open a preview card/.test(e377.summary));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
