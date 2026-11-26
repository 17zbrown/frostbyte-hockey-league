#!/usr/bin/env node
/* v4.62: the Netlify build. It builds the site into _site/ and publishes only that folder (netlify.toml publish = "_site").
 *
 *   node tools/site-build.cjs            -> writes _site/ at the repo root (what Netlify runs)
 *   node tools/site-build.cjs <dir>      -> writes <dir> instead (the tests)
 *
 * Why: `publish = "."` served the whole repo root, so every file nobody remembered to block went public. Three Season 1
 * briefing files answered 200 with no rule (found 2026-11-24), after /src, /sql and /netlify/functions had each been
 * found the same way (2026-07 and 2026-10-15). The 404 rules list what must NOT be served, so a new root file is public
 * until someone adds a line. This build turns that around: it serves only what the built page, the manifest and robots.txt
 * reference, plus the paths netlify.toml names, and it fails the deploy if _site/ holds anything else or anything private.
 *
 * _site/index.html and _site/version.json are exactly what `node src/live/build.cjs _site/index.html` writes (same bytes,
 * same build id), so the league pulse and open tabs see no change from this build.
 * Functions and their included_files (assets/role-icons) are bundled from the repo, not from the publish folder.
 *
 * tools/ is skipped by tools/netlify-ignore.sh, so that script names this file as one that always builds.
 * Pinned by tools/site-build-v462.test.cjs.
 *
 * v5.00 swap (i2, 2026-11-24; briefs/swap-mechanics.md 3.1 to 3.3): the Season 2 site builds here too, and ONE constant,
 * ROOT, decides which site the root serves (commissioner, 2026-11-24: "I want the site transitions by tomorrow so we can
 * run the draft on the new site", and before the Season 2 ownership group is announced, "so they do not need to deal with
 * a transition at all"):
 *   "classic"  / is the classic site (src/live), exactly v4.62's output.
 *   "next"     / is still the classic site, byte for byte, and /next/ serves the Season 2 site (src/s2): the rehearsal on
 *              the real domain, same sign-in, noindex, no build id of its own (testers reload by hand).
 *   "s2"       the flip: chelgamingleague.com serves ONLY the Season 2 site. No classic copy stays on the domain; /classic
 *              and /next answer a temporary redirect to /. Commissioner, 2026-11-24 evening: "I want the concept site to be
 *              ready to swap out the current site tomorrow fully without the /next url", staff tools "all native first",
 *              and "move the current site from season 1 off to a separate free domain from netlify in case we ever need
 *              to fall back on it": that frozen copy is the "fallback" target below, deployed to its own Netlify site.
 *              The switch is ONE release that sets ROOT to "s2"; the rollback is restoreSiteDeploy (seconds), then git
 *              revert (runbook in the private briefs). "next" still builds (the suites use it) but nothing ships it.
 *   fallback   node tools/site-build.cjs --fallback <dir>: <dir>/_site is the classic page byte for byte except three
 *              lines (no cg-build meta, so it never chases the new root's build id; a robots noindex meta; a one-line
 *              notice that it is the Season 1 backup), robots.txt disallows everything, and <dir>/netlify.toml proxies
 *              /api/* to chelgamingleague.com (status 200) and carries the main site's security headers. It deploys with
 *              NO functions, so no function or schedule runs twice. Same private-file guard as the main build.
 * The Season 2 page is ONE html file plus ONE script bundle: demo.html (the shell the suites also serve) with its
 * stylesheets inlined, its <template id="s2-scripts"> list joined into /s2/app-<hash>.js (immutable, so a returning
 * visitor downloads it once per release; netlify.toml), the pinned supabase-js before js/load.js (inlined), and the real
 * head (src/s2/head.html). Every path in it is absolute, so /next and /next/ load the same files (the v4.62 crawl
 * follows absolute paths only). Never in it: data/snapshot.js (the private fixture) or any relative file.
 * The build id: at "s2" a hash of the Season 2 page is stamped into it and into version.json (build.cjs's shape: the
 * classic build still runs, aside, for the version, the rules card and the Edge ids, and its page is thrown away). At
 * "next" the root's id is build.cjs's own and /next carries none. The flip refuses to build while the root page still carries a
 * demo device or concept wording a member would read (flipGuard: stream i3 deletes demo mode, page owners reword). */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.join(__dirname, "..");
/* The one switch (swap-mechanics 3.1): which site the root serves, "classic" | "next" | "s2" (see the header). It stays
   "classic" until the release, whose commit changes this line to "s2" and nothing else here ("next" is never shipped: no
   /next step, commissioner 2026-11-24). Pinned by tools/s2-site-modes.test.cjs. */
const ROOT = "s2";
const MODES = ["classic", "next", "s2"];
/* written by this build, never copied from the repo (a local index.html is a stale preview); the bundle's name is added
   when it is written */
const BUILT = { classic: ["/index.html", "/version.json"], next: ["/index.html", "/version.json", "/next/index.html", "/_redirects"],
  s2: ["/index.html", "/version.json", "/_redirects"] };
/* Netlify's _redirects in the published folder: a path that is not a folder in this mode goes to the root, keeping the #/
   route (a browser carries the fragment across a redirect), so an old /next/ or /classic/ link still opens the league.
   No path here is a file in its own mode, so nothing is shadowed. Every rule is a 302 (temporary): a rollback reverses
   them, and a browser keeps a 301 and would go on sending an old address to / after the rollback */
const REDIRECTS = { next: "/classic/*  /  302\n/classic  /  302\n", s2: "/classic/*  /  302\n/classic  /  302\n/next/*  /  302\n/next  /  302\n" };
const S2_DIR = path.join(REPO, "src/s2");
/* the bundle's folder: one path in every mode, so /next and the flipped root share it (netlify.toml caches it for good) */
const BUNDLE_DIR = "/s2/";
/* Crawlers ask for robots.txt by name and nothing links to it; everything else is found by crawling from the page. */
const SEEDS = ["/robots.txt"];
/* Files the crawl reads for further references (the manifest names the app icons, robots.txt names the sitemap). */
const TEXT = /\.(html|json|webmanifest|txt|xml|css|svg)$/;
/* Never published, whatever references them. netlify.toml's forced 404 rules are added to this when the build runs. */
const PRIVATE = ["/src/", "/sql/", "/tools/", "/concepts/", "/data/", "/share.html", "/node_modules/", "/.git/", "/.env",
  "/.claude/", "/.github/", "/.netlify/"];

/* Every absolute path a text file references: "/x", '/x', (/x) or a full URL on our own domain. Query and hash dropped. */
function refs(text) {
  const out = new Set();
  const rx = /(?:https?:)?\/\/(?:www\.)?chelgamingleague\.com(\/[^\s"'`<>()\\?#]*)|["'`(]\s*(\/[A-Za-z0-9_][^\s"'`<>()\\?#]*)/g;
  for (const m of text.matchAll(rx)) {
    let p = m[1] || m[2];
    try { p = decodeURI(p); } catch (e) { /* a malformed escape stays as written; it matches no file */ }
    if (p.length > 1) out.add(p);
  }
  return out;
}

/* netlify.toml's [[redirects]] and [[headers]] blocks, read as plain key = "value" lines. */
function tomlBlocks(toml, kind) {
  return toml.split(/\n(?=\s*\[)/).filter((b) => b.trim().startsWith(`[[${kind}]]`)).map((b) => {
    const o = {};
    for (const m of b.matchAll(/^\s*(\w+)\s*=\s*(?:"([^"]*)"|(\S+))/gm)) o[m[1]] = m[2] !== undefined ? m[2] : m[3];
    return o;
  });
}

/* the forced 404 rules: "/dir/*" and "/README*" are prefixes (Netlify's trailing splat), anything else is exact */
function blockedBy(toml) {
  return tomlBlocks(toml, "redirects").filter((r) => r.status === "404" && r.force === "true").map((r) => r.from);
}

function isPrivate(p, blocked) {
  if (path.posix.basename(p) === "snapshot.js") return true;
  if (PRIVATE.some((x) => (x.endsWith("/") ? p.startsWith(x) : p === x || p.startsWith(x + ".")))) return true;
  return blocked.some((b) => (b.endsWith("*") ? p.startsWith(b.slice(0, -1)) : p === b));
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    return e.isDirectory() ? walk(f, base) : ["/" + path.relative(base, f).split(path.sep).join("/")];
  });
}

/* Fails if the output holds a file off the allowlist or a private one. Every problem is listed, not just the first. */
function checkOut(out, allowed, blocked) {
  const bad = [];
  for (const p of walk(out)) {
    if (isPrivate(p, blocked)) bad.push(p + " is private");
    else if (!allowed.has(p)) bad.push(p + " is not on the allowlist");
  }
  if (bad.length) throw new Error("site-build: refusing to publish:\n  " + bad.join("\n  "));
}

/* old must be found exactly once (house rule for scripted edits): a moved or doubled anchor is an error, never a skip */
function once(text, old, rep, what) {
  const n = typeof old === "string" ? text.split(old).length - 1 : (text.match(new RegExp(old.source, "g")) || []).length;
  if (n !== 1) throw new Error(`site-build: ${what} is found ${n} times; it must be found exactly once`);
  return typeof old === "string" ? text.split(old).join(typeof rep === "function" ? rep() : rep) : text.replace(old, rep);
}
const sha = (t) => require("crypto").createHash("sha256").update(t).digest("hex").slice(0, 12);
const s2File = (rel, what) => {
  const f = path.join(S2_DIR, rel);
  if (!/^(css|js)\/[\w./-]+\.(css|js)$/.test(rel) || rel.includes("..") || !fs.existsSync(f)) throw new Error(`site-build: ${what} ${rel} is not a file under src/s2`);
  if (fs.lstatSync(f).isSymbolicLink()) throw new Error(`site-build: src/s2/${rel} is a symbolic link (the private assets and data are linked in that way)`);
  return fs.readFileSync(f, "utf8");
};
/* the text after a file's leading comments and blank space (one comment at a time: a single regex over all of them
   backtracks for minutes on a long header that is not followed by a match) */
function lead(t) {
  let i = 0;
  for (;;) {
    while (i < t.length && /\s/.test(t[i])) i++;
    if (t.startsWith("/*", i)) { const e = t.indexOf("*/", i + 2); if (e < 0) return ""; i = e + 2; }
    else if (t.startsWith("//", i)) { const e = t.indexOf("\n", i); if (e < 0) return ""; i = e + 1; }
    else return t.slice(i, i + 40);
  }
}
/* the pinned supabase-js, read from src/live/build.cjs so both sites load the same file with the same hash (one definition) */
function supabaseJs() {
  const b = fs.readFileSync(path.join(REPO, "src/live/build.cjs"), "utf8");
  const v = (b.match(/const SUPABASE_JS = "([0-9.]+)";/) || [])[1], sri = (b.match(/const SUPABASE_SRI = "(sha384-[A-Za-z0-9+/=]+)";/) || [])[1];
  if (!v || !sri) throw new Error("site-build: src/live/build.cjs no longer names SUPABASE_JS and SUPABASE_SRI");
  return { v, sri, src: `/vendor/supabase-js-${v}.min.js` };
}

/* The Season 2 page for root "next" (served at /next/) or "s2" (served at /). -> { html, bundle, bundlePath, files, notes }.
   Order and content come from demo.html, the one list (live-model: every script tag goes inside the template). */
function s2Page(root) {
  let html = fs.readFileSync(path.join(S2_DIR, "demo.html"), "utf8");
  const notes = [];
  /* the real head in place of the dev shell's title and description (which name the suites' shell, not the league) */
  html = once(html, /<title>[^<]*<\/title>\n<meta name="description" content="[^"]*">\n/, () => fs.readFileSync(path.join(S2_DIR, "head.html"), "utf8"), "the <title> and description lines");
  /* /next is a rehearsal: never indexed (the flipped root must be) */
  if (root === "next") html = once(html, '<meta name="viewport"', '<meta name="robots" content="noindex">\n<meta name="viewport"', "the viewport meta");
  /* each stylesheet inlined in its own <style>, in the shell's order, so the cascade is unchanged */
  const css = [];
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, rel) => {
    const t = s2File(rel, "a stylesheet");
    if (/<\/style/i.test(t) || /@import/.test(t)) throw new Error(`site-build: src/s2/${rel} holds </style or @import, which an inlined stylesheet cannot carry`);
    css.push(rel);
    return `<style>/* ${rel} */\n${t}\n</style>`;
  });
  if (!css.length) throw new Error("site-build: the Season 2 shell lists no stylesheet");
  /* the template's scripts joined into one bundle: every file is an IIFE with "use strict" inside it (checked below), so
     one script runs exactly as the separate ones did, and js/load.js fails the page on any error either way */
  const list = [];
  html = once(html, /<template id="s2-scripts">([\s\S]*?)<\/template>/, (m, inner) => {
    const rest = inner.replace(/<script src="([^"]+)"><\/script>/g, (x, rel) => { list.push(rel); return ""; });
    if (rest.trim()) throw new Error("site-build: <template id=\"s2-scripts\"> holds something besides <script src> tags: " + rest.trim().slice(0, 120));
    return "\u0000BUNDLE\u0000";
  }, "<template id=\"s2-scripts\">");
  if (!list.length) throw new Error("site-build: <template id=\"s2-scripts\"> lists no script");
  const dup = list.filter((x, i) => list.indexOf(x) !== i);
  if (dup.length) throw new Error("site-build: the template lists " + dup.join(", ") + " twice");
  const vm = require("vm");
  const parts = list.map((rel) => {
    const t = s2File(rel, "the script");
    try { new vm.Script(t, { filename: "src/s2/" + rel }); } catch (e) { throw new Error(`site-build: src/s2/${rel} does not parse: ${e.message}`); }
    /* a directive prologue at the top of a file would turn into a plain string statement inside the bundle (or make the
       whole bundle strict if it came first): every file keeps "use strict" inside its own function */
    if (/^["']use strict["']/.test(lead(t))) throw new Error(`site-build: src/s2/${rel} opens with a file-level "use strict"; put it inside the file's function`);
    return `/* ---- src/s2/${rel} ---- */\n${t}\n;\n`;
  });
  const bundle = parts.join("");
  try { new vm.Script(bundle, { filename: "bundle" }); } catch (e) { throw new Error("site-build: the joined Season 2 bundle does not parse: " + e.message); }
  const bundlePath = BUNDLE_DIR + "app-" + sha(bundle) + ".js";
  html = html.replace("\u0000BUNDLE\u0000", `<template id="s2-scripts">\n<script src="${bundlePath}"></script>\n</template>`);
  /* the bundle downloads while the league is read (health crawl 11, 2026-11-25): js/load.js preloads every script the
     template lists as soon as it has asked for the read. Not a preload here at the top of the head: that shared a slow
     phone's connection with the page's own stylesheets and put the wheel and the read 3.5 s later (review, 2026-11-25) */
  /* the generated rulebook (stream e6, one book): the flip needs it (flipGuard); before that a missing one is said, never skipped */
  if (!list.includes("js/rulebook.js")) {
    notes.push(fs.existsSync(path.join(S2_DIR, "js/rulebook.js"))
      ? "src/s2/js/rulebook.js exists but demo.html's script list does not name it, so the Season 2 page does not carry the published rulebook"
      : "src/s2/js/rulebook.js is not on this branch yet (stream e6), so the Season 2 page shows league.js's own rulebook copy, not the published one");
  }
  /* the private fixture's tag left the shell with fixture mode (i3f, 2026-11-25); js/load.js reads s2_league. A tag that
     comes back is refused twice over: below as a relative file, and by flipGuard */
  /* supabase-js before js/load.js, from our own origin with its integrity hash and the jsDelivr fallback (src/live/build.cjs);
     S2_MODE = "live" makes this the real site even if the library is late (js/core.js S2.LIVE; js/live.js then says sign-in
     is off instead of the page falling back to the demo); js/load.js inlined, since it is what loads the bundle */
  const sb = supabaseJs(), load = s2File("js/load.js", "the loader");
  if (/<\/script/i.test(load)) throw new Error("site-build: src/s2/js/load.js holds </script, which an inline script cannot carry");
  html = once(html, '<script src="js/load.js"></script>', () =>
    `<script src="${sb.src}" integrity="${sb.sri}" crossorigin="anonymous" onerror="(function(s){s.onerror=null;var f=document.createElement('script');` +
    `f.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${sb.v}';f.integrity='${sb.sri}';f.crossOrigin='anonymous';document.head.appendChild(f);})(this)"></script>\n` +
    `<script>window.S2_MODE = "live";</script>\n<script>/* src/s2/js/load.js */\n${load}\n</script>`, "the js/load.js tag");
  /* closed: no relative file is left for a browser to ask for (the allowlist publishes absolute paths only) */
  const loose = [...html.matchAll(/\b(?:src|href)="(?!https:\/\/|\/|#)([^"]*)"/g)].map((m) => m[1]);
  if (loose.length) throw new Error("site-build: the Season 2 page still names relative files: " + loose.join(" "));
  return { html, bundle, bundlePath, files: { css, js: list }, parts: list.map((rel, i) => ({ rel, text: parts[i] })), notes };
}

/* swap-mechanics 3.3: the flip build refuses while the root page carries a demo device or a pretend action, so the flip
   cannot ship with any left (stream i3 deletes demo mode; page streams wire the real doors). /next may carry them. Tokens
   are matched in the page and in each bundled file, and every hit is named. -> [] when clean */
const FLIP_TOKENS = [
  [/\bS2\.demo\w*/g, "the demo kit (S2.demo, S2.demoNow)"], [/\bS2\.override\b/g, "S2.override (Try it anyway)"], [/demo-dock/g, "the demo dock"],
  [/s2\.role/g, "the dock's stored role"], [/Concept preview/g, "the concept footer"], [/#\/concept\b/g, "the concept page"],
  [/Try it anyway/g, "a pretend action"], [/\(demo\)/g, "a (demo) label"], [/concept-build/g, "the concept's update channel"],
  [/chip sample/g, "a sample chip (sample data on the real site)"], [/<script[^>]+snapshot\.js/g, "the private fixture's tag"],
  [/S2DATA\s*=[^=]/g, "fixture data in the page"], [/service_role/g, "a service-role reference"], [/discord(?:app)?\.com\/api\/webhooks/g, "a webhook URL"],
  [/sb_secret_[A-Za-z0-9_-]{20,}/g, "a secret key"], [/css\/concept\.css/g, "the concept stylesheet"]
];
/* Concept wording a member would read (commissioner, 2026-11-24: the switch makes this the league's real site, "fully
   without the /next url"): matched in code and copy with comments blanked (codeOnly), so a comment's history may stay,
   and with the devices above blanked too, so a device is named once. Page owners and stream i3 clear the hits. */
const WORDING_TOKENS = [
  [/\bconcepts?\b/gi, "the word concept"], [/\b(?:this|Season 2) preview\b/gi, "preview wording (this preview, Season 2 preview)"],
  [/\bsample (?:Season 2 )?(?:clock|player|set|time)\b/gi, "a sample clock, player or set"],
  [/\bthe live (?:site|build)\b/gi, "the live site or build, as if this were another site"], [/\buntil you reload\b/gi, "until you reload (a pretend change)"],
  [/\bnothing (?:(?:here|done here) is (?:sent|posted)|is (?:sent|posted)(?: or (?:sent|posted))? (?:anywhere|from))\b/gi, "nothing here is sent or posted (pretend copy)"]
];
/* JavaScript with every comment blanked to spaces (same length, same line numbers); strings, template literals and
   regular expression literals are kept. A regex literal is told from division by what precedes it, which can misjudge
   odd code: flipGuard checks the result still parses and, if not, scans the file as written and says so. */
function codeOnly(t) {
  let out = "", i = 0, prev = "";
  const tpl = [];   /* one open-brace count per ${ inside a template literal */
  const regexOk = () => prev === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /\b(?:return|typeof|case|do|else|in|of|void|throw|new|delete)$/.test(out.slice(-12).trimEnd());
  while (i < t.length) {
    const c = t[i], d = t[i + 1];
    if (c === "/" && d === "*") { const e = t.indexOf("*/", i + 2), end = e < 0 ? t.length : e + 2; out += t.slice(i, end).replace(/[^\n]/g, " "); i = end; continue; }
    if (c === "/" && d === "/") { const e = t.indexOf("\n", i), end = e < 0 ? t.length : e; out += " ".repeat(end - i); i = end; continue; }
    if (c === "'" || c === '"') { let j = i + 1; while (j < t.length && t[j] !== c && t[j] !== "\n") j += t[j] === "\\" ? 2 : 1; out += t.slice(i, j + 1); i = j + 1; prev = c; continue; }
    if (c === "`" || (c === "}" && tpl.length && tpl[tpl.length - 1] === 0)) {
      if (c === "}") tpl.pop();
      let j = i + 1;
      while (j < t.length && t[j] !== "`" && !(t[j] === "$" && t[j + 1] === "{")) j += t[j] === "\\" ? 2 : 1;
      if (t[j] === "$") { tpl.push(0); out += t.slice(i, j + 2); i = j + 2; prev = "{"; } else { out += t.slice(i, j + 1); i = j + 1; prev = "`"; }
      continue;
    }
    if (c === "/" && regexOk()) {
      let j = i + 1, cls = false;
      while (j < t.length && t[j] !== "\n" && (cls || t[j] !== "/")) { if (t[j] === "\\") j++; else if (t[j] === "[") cls = true; else if (t[j] === "]") cls = false; j++; }
      out += t.slice(i, j + 1); i = j + 1; prev = "/"; continue;
    }
    if (tpl.length && c === "{") tpl[tpl.length - 1]++;
    else if (tpl.length && c === "}") tpl[tpl.length - 1]--;
    out += c; if (!/\s/.test(c)) prev = c; i++;
  }
  return out;
}
function flipGuard(page) {
  const vm = require("vm");
  const hits = [];
  const scan = (where, text, words) => {
    for (const [rx, why] of FLIP_TOKENS) { const n = (text.match(rx) || []).length; if (n) hits.push(`${where}: ${why} (${n})`); }
    const plain = FLIP_TOKENS.reduce((s, [rx]) => s.replace(rx, (m) => " ".repeat(m.length)), words);
    for (const [rx, why] of WORDING_TOKENS) { const n = (plain.match(rx) || []).length; if (n) hits.push(`${where}: concept wording: ${why} (${n})`); }
  };
  /* the page's copy: no HTML comment, no stylesheet, each inline script with its comments blanked */
  const html = page.html.replace(/<script src="\/s2\/[^"]+"><\/script>/, "");
  scan("the page", html, html.replace(/<!--[\s\S]*?-->/g, "").replace(/<style>[\s\S]*?<\/style>/g, "").replace(/(<script>)([\s\S]*?)(<\/script>)/g, (m, a, js, z) => a + codeOnly(js) + z));
  for (const p of page.parts) {
    let code = codeOnly(p.text);
    /* s2Page refuses a file that does not parse, so a failure here is codeOnly misreading it (the tests' fragments aside) */
    const parses = (s) => { try { new vm.Script(s); return true; } catch (e) { return false; } };
    if (!parses(code)) {
      if (parses(p.text)) hits.push(`src/s2/${p.rel}: its comments could not be told from its code, so the wording scan read them too`);
      code = p.text;
    }
    scan("src/s2/" + p.rel, p.text, code);
  }
  const head = page.html.slice(0, page.html.indexOf("</head>"));
  if (/noindex/.test(head)) hits.push("the page: noindex in the head");
  if (/concept|demo/i.test((head.match(/<title>[^<]*<\/title>/) || [""])[0] + (head.match(/<meta name="description" content="[^"]*">/) || [""])[0])) hits.push("the page: concept or demo in the title or description");
  if (!page.files.js.includes("js/rulebook.js")) hits.push("the page: no js/rulebook.js (the one published rulebook, briefs/one-book.md)");
  return hits;
}

/* -> copy(p, why): publishes the repo file at p into out and puts it on the allowlist, then everything it references, in
   turn (text files only); a private file fails the build. true when p is published (or was already), false when the
   repo has no such file */
function copier(out, allowed, blocked) {
  const repoFile = (p) => {
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO + path.sep)) return null;
    const st = fs.statSync(f, { throwIfNoEntry: false });
    return st && st.isFile() ? f : null;
  };
  const copy = (p, why) => {
    if (allowed.has(p)) return true;
    const f = repoFile(p);
    if (!f) return false;
    if (isPrivate(p, blocked)) throw new Error(`site-build: ${why} references ${p}, which is private`);
    fs.mkdirSync(path.dirname(path.join(out, p)), { recursive: true });
    fs.copyFileSync(f, path.join(out, p));
    allowed.add(p);
    if (TEXT.test(p)) for (const r of refs(fs.readFileSync(f, "utf8"))) copy(r, p);
    return true;
  };
  return copy;
}

/* the folder a build wipes and writes: never the filesystem root, the repo or a folder holding it.
   main session, 2026-11-24 (review of i2b): that alone let `--fallback ~/Developer/cghl-private` (one tab-completion away
   from the runbook's ~/Developer/cghl-classic-fallback) erase the private briefs, denylist and fixtures, which cannot be
   recovered. A destructive action gets a guard (CLAUDE.md): a build now wipes only a folder it made. `mark` names the
   file a target writes at its folder's top (the fallback's, outside the _site it deploys); without a mark, only a
   folder inside the repo (the default _site) or the system temp folder (the tests) may hold anything. A missing or
   empty folder is always fine. */
const FALLBACK_MARK = ".cghl-fallback-build";
function wipeable(outArg, mark) {
  const out = path.resolve(outArg);
  const up = path.relative(out, REPO);
  if (out === path.parse(out).root || up === "" || !up.startsWith("..")) throw new Error(`site-build: refusing to wipe ${out}`);
  let entries = [];
  try { entries = fs.readdirSync(out); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (!entries.length) return out;
  const inside = (base) => { const r = path.relative(fs.realpathSync(base), fs.realpathSync(out)); return r !== "" && !r.startsWith("..") && !path.isAbsolute(r); };
  const ours = mark ? entries.includes(mark) : inside(REPO) || inside(require("os").tmpdir());
  if (!ours) throw new Error(`site-build: refusing to wipe ${out}: it holds files this build did not make` + (mark ? ` (no ${mark} marker)` : "") + "; pick an empty or new folder");
  return out;
}

/* opts (the tests only; Netlify runs the CLI below, which passes none): root, one of MODES (default ROOT). i3f
   (2026-11-25): allowDemo, which built a flip page that still carried demo devices for the tests, is gone with demo mode:
   every flip build has the guard on */
function build(outArg, opts) {
  opts = opts || {};
  const root = opts.root || ROOT;
  if (!MODES.includes(root)) throw new Error(`site-build: ROOT "${root}" is not one of ${MODES.join(", ")}`);
  const out = wipeable(outArg || path.join(REPO, "_site"));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  /* the classic site: the root at "classic" and "next"; at "s2" it is built aside, outside the output, only for version.json */
  const classicDir = root === "s2" ? fs.mkdtempSync(path.join(require("os").tmpdir(), "cghl-classic-")) : out;
  let classicVer;
  try {
    execFileSync(process.execPath, [path.join(REPO, "src/live/build.cjs"), path.join(classicDir, "index.html")], { stdio: "inherit" });
    for (const f of ["index.html", "version.json"]) if (!fs.existsSync(path.join(classicDir, f))) throw new Error(`site-build: src/live/build.cjs did not write ${f}`);
    classicVer = JSON.parse(fs.readFileSync(path.join(classicDir, "version.json"), "utf8"));
  } finally {
    if (classicDir !== out) fs.rmSync(classicDir, { recursive: true, force: true });
  }

  const notes = [];
  let page = null;
  if (root !== "classic") {
    page = s2Page(root);
    notes.push(...page.notes);
    fs.mkdirSync(path.join(out, BUNDLE_DIR), { recursive: true });
    fs.writeFileSync(path.join(out, page.bundlePath), page.bundle);
  }
  if (REDIRECTS[root]) fs.writeFileSync(path.join(out, "_redirects"), REDIRECTS[root]);
  if (root === "next") {
    fs.mkdirSync(path.join(out, "next"), { recursive: true });
    fs.writeFileSync(path.join(out, "next/index.html"), page.html);
  }
  if (root === "s2") {
    const hits = flipGuard(page);
    if (hits.length) throw new Error("site-build: refusing to flip the root to the Season 2 site while it carries demo devices:\n  " + hits.join("\n  "));
    /* the release id: a hash of the Season 2 page (its bundle's name is a hash of the bundle), stamped in the page and in
       version.json, whose other fields are build.cjs's (the database copies the rules card and reads the Edge ids) */
    const id = sha(page.html);
    fs.writeFileSync(path.join(out, "index.html"), once(page.html, '<meta charset="utf-8">', `<meta charset="utf-8">\n<meta name="cg-build" content="${id}">`, "the charset meta"));
    fs.writeFileSync(path.join(out, "version.json"), JSON.stringify(Object.assign(classicVer, { build: id })) + "\n");
  }

  const toml = fs.readFileSync(path.join(REPO, "netlify.toml"), "utf8");
  const blocked = blockedBy(toml);
  const allowed = new Set(BUILT[root]);
  if (page) allowed.add(page.bundlePath);
  const copy = copier(out, allowed, blocked);

  /* every page, version.json and the bundle are crawled for the absolute paths they use */
  for (const p of [...BUILT[root], ...(page ? [page.bundlePath] : [])]) for (const r of refs(fs.readFileSync(path.join(out, p), "utf8"))) copy(r, p);
  for (const p of SEEDS) if (!copy(p, "the seed list")) throw new Error(`site-build: ${p} is missing from the repo`);

  /* every exact path netlify.toml serves a header for or rewrites to must be in the deploy; functions deploy from the repo */
  const named = [...tomlBlocks(toml, "headers").map((h) => h.for), ...tomlBlocks(toml, "redirects").map((r) => r.to)];
  for (const p of named) {
    if (!p || p === "/" || p.includes("*") || p.includes(":")) continue;
    const fn = p.match(/^\/\.netlify\/functions\/([\w-]+)$/);
    if (fn) {
      if (![".js", ".mjs", ".cjs"].some((x) => fs.existsSync(path.join(REPO, "netlify/functions", fn[1] + x)))) {
        throw new Error(`site-build: netlify.toml routes to the function ${fn[1]}, which does not exist`);
      }
    } else if (!copy(p, "netlify.toml")) {
      throw new Error(`site-build: netlify.toml names ${p}, which is neither built nor in the repo`);
    }
  }

  checkOut(out, allowed, blocked);
  for (const n of notes) console.warn("site-build: NOTE " + n);
  console.log(`site-build: ${root} root, ${allowed.size} files in ${out}: ${[...allowed].sort().join(" ")}`);
  /* built: what this build wrote (never copied from the repo, so never a tracked file) */
  return { out, root, files: [...allowed].sort(), built: BUILT[root].concat(page ? [page.bundlePath] : []).sort(), blocked, notes, page };
}

/* ---- the fallback: the frozen Season 1 site on its own free Netlify site (see the header) ----
   Commissioner, 2026-11-24: "move the current site from season 1 off to a separate free domain from netlify in case we
   ever need to fall back on it". <dir>/_site is what is published, <dir>/netlify.toml its config; the runbook deploys it
   from <dir> with no functions. The page differs from the classic page in exactly three ways:
   1. no cg-build meta: CG.BUILD is null, so CG._checkBuild never runs (src/live/part_live.js). The pulse it reads is the
      main site's, and that build id is the Season 2 page's: a fallback that took it as "a new version" would reload
      forever toward a page it can never become. No version.json either (the database reads only chelgamingleague.com's).
   2. a robots noindex meta (and robots.txt disallows everything): the league has one home.
   3. a one-line notice under the skip link that this is the Season 1 backup, linking to chelgamingleague.com. */
const FALLBACK_NOTICE = '<p class="fallback-note" role="note" style="margin:0;padding:8px 16px;text-align:center;font-size:13px;line-height:1.45;' +
  'background:var(--paper);color:var(--steel);border-bottom:1px solid var(--line)">This is the Season 1 site, kept as a backup. ' +
  'The league is at <a href="https://chelgamingleague.com" style="color:var(--ink)">chelgamingleague.com</a>.</p>\n';
const FALLBACK_ROBOTS = "User-agent: *\nDisallow: /\n";
/* the page's own calls: /api/discord-ops, /api/ingest-stats and /api/pickup-import, each a function on the main site */
const FALLBACK_API = "https://chelgamingleague.com/api/:splat";
/* the fallback's netlify.toml: the /api proxy, and the main site's security headers block copied verbatim (one definition:
   a change to the main CSP reaches the next fallback build) */
function fallbackToml(mainToml) {
  const sec = mainToml.match(/\[\[headers\]\]\n\s*for = "\/\*"\n\s*\[headers\.values\]\n(?:[ \t]+\S.*\n?)+/);
  if (!sec || !/Content-Security-Policy = /.test(sec[0]) || !/X-Frame-Options = /.test(sec[0])) throw new Error("site-build: netlify.toml has no \"/*\" security headers block to copy");
  return [
    "# The frozen Season 1 site (CGHL), its own free Netlify site. WRITTEN by node tools/site-build.cjs --fallback <dir>:",
    "# rebuild it, never edit it. Deploy from this folder with NO functions (no functions setting, no netlify/functions",
    "# folder), so no Netlify function or schedule runs twice: the private briefs' swap runbook has the commands.",
    "[build]",
    "  publish = \"_site\"",
    "",
    "# The page's calls to the league's functions go to the main site (a proxy: the browser stays on this origin).",
    "# shortcut: the Control Center's Run now for a job other than discord-sync calls /.netlify/functions/<job> directly, which",
    "# 404s here (every job runs on Supabase Edge since 2026-10-15); proxy it too if this site is ever used for operations.",
    "[[redirects]]",
    "  from = \"/api/*\"",
    `  to = "${FALLBACK_API}"`,
    "  status = 200",
    "  force = true",
    "",
    "# The main site's security headers, copied from its netlify.toml when this was built.",
    sec[0].replace(/\n?$/, "\n")
  ].join("\n");
}
function fallback(outArg) {
  if (!outArg) throw new Error("site-build: --fallback needs a folder outside any git repository, for example ~/Developer/cghl-classic-fallback");
  const out = wipeable(outArg, FALLBACK_MARK);
  /* netlify-cli reads the config and repository root of the folder it deploys from: inside a git work tree (this repo
     above all, whose netlify.toml names every function) it could deploy more than this folder holds */
  for (let d = out; d !== path.dirname(d); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) throw new Error(`site-build: the fallback folder ${out} is inside the git work tree at ${d}; build it outside any repository`);
  }
  fs.rmSync(out, { recursive: true, force: true });
  const site = path.join(out, "_site");
  fs.mkdirSync(site, { recursive: true });
  fs.writeFileSync(path.join(out, FALLBACK_MARK), "tools/site-build.cjs --fallback made this folder; a later --fallback may wipe it\n");
  execFileSync(process.execPath, [path.join(REPO, "src/live/build.cjs"), path.join(site, "index.html")], { stdio: "inherit" });
  if (!fs.existsSync(path.join(site, "index.html"))) throw new Error("site-build: src/live/build.cjs did not write index.html");
  fs.rmSync(path.join(site, "version.json"), { force: true });
  let html = fs.readFileSync(path.join(site, "index.html"), "utf8");
  html = once(html, /<meta charset="utf-8">\n<meta name="cg-build" content="[0-9a-f]{12}">/, '<meta charset="utf-8">\n<meta name="robots" content="noindex">', "the classic page's cg-build meta");
  html = once(html, '<a class="skip" href="#app">Skip to content</a>\n', () => '<a class="skip" href="#app">Skip to content</a>\n' + FALLBACK_NOTICE, "the classic page's skip link");
  fs.writeFileSync(path.join(site, "index.html"), html);
  fs.writeFileSync(path.join(site, "robots.txt"), FALLBACK_ROBOTS);

  const toml = fs.readFileSync(path.join(REPO, "netlify.toml"), "utf8");
  const blocked = blockedBy(toml);
  const allowed = new Set(["/index.html", "/robots.txt"]);
  const copy = copier(site, allowed, blocked);
  for (const r of refs(html)) copy(r, "the classic page");
  fs.writeFileSync(path.join(out, "netlify.toml"), fallbackToml(toml));
  checkOut(site, allowed, blocked);
  /* the marker (wipeable) sits beside _site, never inside what deploys */
  const top = fs.readdirSync(out).filter((n) => n !== FALLBACK_MARK).sort().join(" ");
  if (!fs.existsSync(path.join(out, FALLBACK_MARK))) throw new Error("site-build: the fallback folder lost its " + FALLBACK_MARK + " marker");
  if (top !== "_site netlify.toml") throw new Error("site-build: the fallback folder holds " + top + ", not just _site and netlify.toml");
  console.log(`site-build: fallback, ${allowed.size} files in ${site} (+ ${path.join(out, "netlify.toml")}): ${[...allowed].sort().join(" ")}`);
  return { out, site, files: [...allowed].sort(), toml: fs.readFileSync(path.join(out, "netlify.toml"), "utf8"), html };
}

module.exports = { ROOT, MODES, PRIVATE, FLIP_TOKENS, WORDING_TOKENS, codeOnly, REDIRECTS, FALLBACK_NOTICE, FALLBACK_ROBOTS, FALLBACK_API, refs, blockedBy, isPrivate, checkOut, s2Page, flipGuard, build, fallback };
/* Netlify runs it with no argument (ROOT, into _site/); --fallback <dir> builds the Season 1 fallback site */
if (require.main === module) {
  const a = process.argv.slice(2);
  if (a[0] === "--fallback") fallback(a[1]);
  else if (a.length > 1 || (a[0] || "").startsWith("-")) throw new Error("site-build: usage: node tools/site-build.cjs [dir] | --fallback <dir>");
  else build(a[0]);
}
