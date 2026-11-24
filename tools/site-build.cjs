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
 * Pinned by tools/site-build-v462.test.cjs. */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.join(__dirname, "..");
/* The one switch (swap-mechanics 3.1): which site the root serves. Only the classic site exists in this build; the /classic
   and Season 2 modes come later and change this line. */
const ROOT = "classic";
/* written by src/live/build.cjs, never copied from the repo (a local index.html is a stale preview) */
const BUILT = ["/index.html", "/version.json"];
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

function build(outArg) {
  if (ROOT !== "classic") throw new Error(`site-build: ROOT "${ROOT}" has no build here; only "classic" exists`);
  const out = path.resolve(outArg || path.join(REPO, "_site"));
  /* the folder is wiped first, so it must never be the repo or a folder holding it */
  const up = path.relative(out, REPO);
  if (out === path.parse(out).root || up === "" || !up.startsWith("..")) throw new Error(`site-build: refusing to wipe ${out}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  execFileSync(process.execPath, [path.join(REPO, "src/live/build.cjs"), path.join(out, "index.html")], { stdio: "inherit" });
  for (const p of BUILT) if (!fs.existsSync(path.join(out, p))) throw new Error(`site-build: src/live/build.cjs did not write ${p}`);

  const toml = fs.readFileSync(path.join(REPO, "netlify.toml"), "utf8");
  const blocked = blockedBy(toml);
  const allowed = new Set(BUILT);
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

  for (const p of BUILT) for (const r of refs(fs.readFileSync(path.join(out, p), "utf8"))) copy(r, p);
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
  console.log(`site-build: ${ROOT} root, ${allowed.size} files in ${out}: ${[...allowed].sort().join(" ")}`);
  return { out, files: [...allowed].sort(), blocked };
}

module.exports = { ROOT, PRIVATE, refs, blockedBy, isPrivate, checkOut, build };
if (require.main === module) build(process.argv[2]);
