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
/* Optional override layer (argv[3]) — inserted after part_live.js, before init.
   Used to build preview.html with the redesign layer while index.html stays stock. */
const LAYER = process.argv[3] || null;

// Prototype build order + the live data adapter (part_live) just before init (part8),
// so CG.LIVE_MODE is set before part8's guarded init runs.
const PARTS = [
  "part2_engine.js", "part3_content.js", "part4_ui.js",
  "part5a_public.js", "part5b_public2.js", "part6_hub.js",
  "part7_admin.js", "part_live.js",
  /* per-department staff desks: chains CG.ROUTES.hub / CG.AFTER.hub, so it has to
     load after part_live installs its own overrides */
  "part9_staffdesks.js",
  /* community forums — new top-level routes, so it can load any time after the
     public page helpers (pageHead/ic) exist */
  "part10_forums.js",
  /* the Season 2 survey (v4.23): chains CG.AFTER.register to gate the sign-up form, so it has to
     load after part_live defines that hook */
  "part11_survey.js",
  ...(LAYER ? [LAYER] : []),           /* filename relative to src/live, e.g. preview_layer.js */
  "part8_blueprint_init.js",
];

let head = fs.readFileSync(path.join(DIR, "part1_head.html"), "utf8");
/* preview builds must never be indexed as the real site */
if (LAYER) head = head.replace('<meta name="viewport"', '<meta name="robots" content="noindex">\n  <meta name="viewport"');
const ANCHOR = '<div id="toast-root" aria-live="polite"></div>\n<script>';
if (!head.includes(ANCHOR)) throw new Error("head anchor not found");
/* Pinned, not floating. `@2` meant any 2.x publish became this site's boot path unattended, and
   without an integrity hash a bad or tampered build would run with full access to the session.
   The whole app is behind this script — if it fails, the page is the error panel. Bump both values
   together; the hash is `openssl dgst -sha384 -binary <file> | openssl base64 -A`. */
const SUPABASE_JS = "2.110.7";
const SUPABASE_SRI = "sha384-BmlQlKlDvXvKoxkn5OQuUo/aJQCTXeB+Kls6EccBmG4Kf8AXvp89RtO9MtPxP/r5";
/* Served from OUR origin, not a third party. The whole app is behind this file, and jsDelivr
   being unreachable — blocked network, corporate DNS, a CDN incident — took the entire league
   down with it. vendor/ is byte-identical to the CDN copy (same SRI), so if Netlify served the
   page it can serve this too. jsDelivr stays as an onerror fallback, and when the fallback
   finishes it re-runs the boot that failed without it. */
head = head.replace(
  ANCHOR,
  '<div id="toast-root" aria-live="polite"></div>\n' +
  `<script src="/vendor/supabase-js-${SUPABASE_JS}.min.js" integrity="${SUPABASE_SRI}" ` +
  `crossorigin="anonymous" onerror="(function(s){s.onerror=null;var f=document.createElement('script');` +
  `f.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SUPABASE_JS}';` +
  `f.integrity='${SUPABASE_SRI}';f.crossOrigin='anonymous';` +
  `f.onload=function(){try{if(window.CG&&CG.ensureSb&&CG.ensureSb()&&CG.bootLive)CG.bootLive();}catch(e){}};` +
  `document.head.appendChild(f);})(this)"></script>\n<script>`
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

/* v4.05: the build id. A hash of the page's own bytes, so a deploy that changes nothing a visitor runs (a function, a
   record) keeps the same id and reloads nobody. It is stamped into the page (meta cg-build, read as CG.BUILD) and written
   to version.json beside it, which the database reads every 10 minutes and copies into the league pulse; an open page
   running an older id takes the new build at its next click. Only the live build gets one: a preview never reloads. */
if (!LAYER) {
  const crypto = require("crypto");
  const id = crypto.createHash("sha256").update(head + "\n" + body).digest("hex").slice(0, 12);
  if (!head.includes('<meta charset="utf-8">')) throw new Error("charset meta not found for the build id");
  head = head.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta name="cg-build" content="${id}">`);
  const m = body.match(/"changelog":\[\{"version":"([0-9.]+)"/);
  fs.writeFileSync(path.join(path.dirname(path.resolve(OUT)), "version.json"),
    JSON.stringify({ build: id, version: m ? m[1] : null, commit: process.env.COMMIT_REF || null,
      rulesCard: rulesCard(), edge: require("../../edge/recipe.cjs").buildIds() }) + "\n");
}

/* v4.06: the #rules card's source, published beside the build id. discord-scheduler runs on Supabase, where it cannot open
   this repo's files, so the database copies this from version.json into app_config.rules_card (live_site_build_check)
   and the scheduler reads it there. The card shows the current version and the chapter titles, so that is all this
   carries. The build fails rather than publish a card with no rulebook behind it. */
function rulesCard() {
  const CG = {};
  new Function("CG", fs.readFileSync(path.join(DIR, "part3_content.js"), "utf8"))(CG);
  const rb = CG.CONTENT && CG.CONTENT.rulebook;
  if (!rb || !Array.isArray(rb.changelog) || !rb.changelog.length || !Array.isArray(rb.chapters) || !rb.chapters.length) {
    throw new Error("rules card: CG.CONTENT.rulebook has no changelog or chapters");
  }
  const cur = rb.changelog[0];
  return {
    changelog: [{ version: cur.version, date: cur.date || null, dateIso: cur.dateIso || null }],
    chapters: rb.chapters.map((c) => ({ num: c.num, title: c.title })),
  };
}

fs.writeFileSync(OUT, head + "\n" + body);
console.log(`built ${OUT} (${(head.length + body.length)} bytes)`);
