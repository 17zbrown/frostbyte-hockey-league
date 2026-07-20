#!/usr/bin/env node
/* Build script for the live (real-data) Chel Gaming site.
 *
 * Concatenates the part files into a single self-contained HTML file, injecting
 * the Supabase JS client into the <head>. part_live.js sets CG.LIVE_MODE and
 * boots asynchronously from Supabase (real teams/rosters/contracts/games),
 * replacing the simulated engine used by the prototype build.
 *
 *   node src/live/build.js            -> writes chelgaming-live.html at repo root (staging)
 *   node src/live/build.js index.html -> writes to a specific target (cutover)
 */
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const OUT = process.argv[2] || path.join(DIR, "../../chelgaming-live.html");

// Prototype build order + the live data adapter (part_live) just before init (part8),
// so CG.LIVE_MODE is set before part8's guarded init runs.
const PARTS = [
  "part2_engine.js", "part3_content.js", "part4_ui.js",
  "part5a_public.js", "part5b_public2.js", "part6_hub.js",
  "part7_admin.js", "part_live.js", "part8_blueprint_init.js",
];

let head = fs.readFileSync(path.join(DIR, "part1_head.html"), "utf8");
const ANCHOR = '<div id="toast-root" aria-live="polite"></div>\n<script>';
if (!head.includes(ANCHOR)) throw new Error("head anchor not found");
head = head.replace(
  ANCHOR,
  '<div id="toast-root" aria-live="polite"></div>\n' +
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n<script>'
);

const body = PARTS.map((f) => fs.readFileSync(path.join(DIR, f), "utf8")).join("\n");

/* Every byte in here is downloaded by every visitor before the page can do anything, so inlined
   artwork is uniquely expensive. Two prototype club logos and a set of bundled avatars once cost
   ~113 KB of the bundle while being unreachable in the live build. Small inline SVG/icon data URIs
   are fine; anything sizeable belongs in Supabase storage behind a URL the browser can cache. */
const MAX_INLINE_IMAGE = 2048;
const oversized = [];
for (const m of (head + body).matchAll(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g)) {
  if (m[0].length > MAX_INLINE_IMAGE) oversized.push(m[0].length);
}
if (oversized.length) {
  throw new Error(
    `refusing to build: ${oversized.length} inlined image(s) over ${MAX_INLINE_IMAGE} bytes ` +
    `(${oversized.map((n) => `${(n / 1024).toFixed(0)}KB`).join(", ")}). ` +
    `Upload the artwork and reference it by URL instead.`
  );
}

fs.writeFileSync(OUT, head + "\n" + body);
console.log(`built ${OUT} (${(head.length + body.length)} bytes)`);
