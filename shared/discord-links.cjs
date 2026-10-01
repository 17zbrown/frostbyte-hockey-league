// No link previews in anything the league posts to Discord. ONE definition for every lane: the Netlify
// functions, the always-on gateway bot (bot/), and the database's webhook posts (public.discord_no_previews,
// sql/2026-10-01-no-link-previews-v377.sql, is the same rule in SQL).
//
// Commissioner, 2026-10-01: "make sure in the future to always remove the embed when you use a link in any
// text on the server."
//
// Discord unfurls every link in a message's `content` into a preview card. Two ways to stop it:
//   1. the message flag SUPPRESS_EMBEDS (1 << 2 = 4). Authoritative, and it leaves the text alone. But it
//      hides EVERY embed on the message, including the rich embeds our cards are built from, so it is only
//      safe on a message that has none.
//   2. wrapping each link in angle brackets: <https://…>, or [text](<https://…>) for a masked link. Visible
//      text is unchanged (Discord hides the brackets) and rich embeds survive.
// So: a new message with no rich embeds gets the flag; anything carrying rich embeds gets its content links
// wrapped. An EDIT that does not restate its embeds may be editing a message that has some, so it is
// wrapped too and its flags are left alone. Links INSIDE a rich embed (description, fields, url) never
// unfurl, so only `content` is ever touched.
//
// CommonJS on purpose, like shared/game-window.cjs: the CommonJS Netlify functions can require() it and the
// ES-module lanes (the bot, the v2 functions) import it by name, because Node's lexer reads the
// `exports.x =` lines at the foot of this file. Keep them in that form.

const SUPPRESS_EMBEDS = 4;
const MAX_CONTENT = 2000;

// One left-to-right pass. At each point the first alternative that matches wins, so a code span (fenced or
// inline) or a link already inside <...> is consumed whole and copied as is: nothing inside it is ever looked
// at again. That matters for a link that carries another link in it (https://a.com/?u=https://b.com), whose
// inner half would otherwise be wrapped a second time. A bracket printed inside code would show literally,
// and Discord does not unfurl links in code anyway.
// A bare link is one not glued to a word or path character in front. A masked link [text](https://...) is a
// bare link preceded by "(": wrapping it with its unbalanced ")" peeled off gives exactly [text](<https://...>).
const TOKEN_RE = /(```[\s\S]*?```|`[^`\n]*`|<https?:\/\/[^\s<>]*>)|(?<![<\w\/])https?:\/\/[^\s<>]+/gi;
const TRAILING = /[.,;:!?'"*_~|\u2019\u201D\u00BB\u203A\u2026]/;

function hasLink(text) {
  return typeof text === "string" && /https?:\/\/\S/i.test(text);
}

// Trailing punctuation belongs to the sentence, not the link ("see https://x.com/a." or "(https://x.com/a)"),
// typographic closers included (a curly quote, a guillemet, an ellipsis).
// A ")" stays only while the link has an unmatched "(" of its own (wiki style URLs).
function peel(url) {
  let tail = "";
  for (;;) {
    const last = url.slice(-1);
    if (!last) break;
    if (TRAILING.test(last)) { tail = last + tail; url = url.slice(0, -1); continue; }
    if (last === ")") {
      const open = (url.match(/\(/g) || []).length, close = (url.match(/\)/g) || []).length;
      if (close > open) { tail = last + tail; url = url.slice(0, -1); continue; }
    }
    break;
  }
  return [url, tail];
}

// Wrap every link in `text` so Discord shows no preview for it. Text with no link comes back untouched. If
// the brackets would push a message over Discord's 2000-character limit the original text is returned:
// a message that arrives with a preview beats one Discord refuses outright.
function wrapLinks(text) {
  if (!hasLink(text)) return text;
  const out = text.replace(TOKEN_RE, (m, kept) => {
    if (kept) return kept;
    const [url, tail] = peel(m);
    return /^https?:\/\/\S/i.test(url) ? "<" + url + ">" + tail : m;
  });
  if (out.length > MAX_CONTENT && text.length <= MAX_CONTENT) return text;
  return out;
}

function hasRichEmbeds(p) {
  return Array.isArray(p.embeds) && p.embeds.length > 0;
}

function messageBody(p, edit) {
  const out = { ...p };
  if (hasRichEmbeds(p)) {
    if (typeof p.content === "string") out.content = wrapLinks(p.content);
  } else if (edit && !Array.isArray(p.embeds)) {
    // An edit that leaves the embeds as they are: the message may well have rich ones the flag would hide.
    if (typeof p.content === "string") out.content = wrapLinks(p.content);
  } else {
    out.flags = (Number(p.flags) || 0) | SUPPRESS_EMBEDS;
  }
  return out;
}

/* noLinkPreviews(payload, { edit }) returns a copy of a Discord write payload with every link preview
   suppressed. It understands the three shapes the league sends:
     - a message: channel POST, webhook execute, discord.js send()/reply()/followUp(), or (with edit: true) a
       channel/webhook PATCH or discord.js edit()/editReply();
     - a forum post / thread create: { name, message: {...} }, where the message is a new one;
     - an interaction callback: { type, data }. Type 4 creates a message, type 7 edits the one the button sits
       on; every other type (deferrals, modals, autocomplete, pongs) is returned unchanged, because a flag
       set on a deferral would hide the rich embeds of whatever the follow-up edit puts there.
   A thread or channel body with no message ({ name, type, ... }) is returned unchanged, and so is anything
   that is not an object (a bare string, null). The input is never mutated. */
function noLinkPreviews(payload, opts) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const edit = !!(opts && opts.edit);
  // An interaction callback: a numeric type and never a top-level content (a message body has no `type`).
  if (typeof payload.type === "number" && !("content" in payload) && !("embeds" in payload)) {
    const data = payload.data && typeof payload.data === "object" ? payload.data : null;
    if (data && payload.type === 4) return { ...payload, data: messageBody(data, false) };
    if (data && payload.type === 7) return { ...payload, data: messageBody(data, true) };
    return payload;
  }
  if (payload.message && typeof payload.message === "object" && !Array.isArray(payload.message)) {
    return { ...payload, message: messageBody(payload.message, false) };
  }
  // A thread or channel body with no message in it ({ name, type, auto_archive_duration }): not a message,
  // and a flag there is not ours to set.
  if ("name" in payload && !("content" in payload) && !("embeds" in payload)) return payload;
  return messageBody(payload, edit);
}

const noLinkPreviewsEdit = (payload) => noLinkPreviews(payload, { edit: true });

exports.SUPPRESS_EMBEDS = SUPPRESS_EMBEDS;
exports.hasLink = hasLink;
exports.wrapLinks = wrapLinks;
exports.noLinkPreviews = noLinkPreviews;
exports.noLinkPreviewsEdit = noLinkPreviewsEdit;
