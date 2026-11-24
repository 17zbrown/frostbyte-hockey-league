/* v4.62: the Netlify build publishes _site/ only (tools/site-build.cjs, netlify.toml publish = "_site").
   `publish = "."` served the whole repo, and three Season 1 briefing files with no 404 rule answered 200 (found 2026-11-24).
   This pins that the page is the same bytes as before, that everything the page needs is published, and that nothing
   private is. Run: node tools/site-build-v462.test.cjs */
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const REPO = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const SB = require("./site-build.cjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cghl-site-"));
const throws = (f) => { try { f(); return ""; } catch (e) { return String(e.message); } };

console.log("the page is byte-equal to a plain src/live/build.cjs build of the same commit");
const plain = path.join(tmp, "plain");
fs.mkdirSync(plain);
execFileSync(process.execPath, [path.join(REPO, "src/live/build.cjs"), path.join(plain, "index.html")], { stdio: "ignore" });
const out = path.join(tmp, "_site");
const res = SB.build(out);
const page = fs.readFileSync(path.join(out, "index.html"));
A("_site/index.html is byte-equal to the plain build", page.equals(fs.readFileSync(path.join(plain, "index.html"))));
A("_site/version.json is byte-equal too (same build id, version, rules card and Edge ids)",
  fs.readFileSync(path.join(out, "version.json")).equals(fs.readFileSync(path.join(plain, "version.json"))));
{
  const id = (page.toString("utf8").match(/<meta name="cg-build" content="([0-9a-f]{12})">/) || [])[1];
  A("version.json carries the build id stamped in the page", !!id && JSON.parse(fs.readFileSync(path.join(out, "version.json"), "utf8")).build === id, id);
}

console.log("\nevery allowlisted path is published and is a tracked repo file");
const tracked = new Set(execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" }).split("\0").filter(Boolean).map((f) => "/" + f));
const missing = res.files.filter((p) => !fs.statSync(path.join(out, p), { throwIfNoEntry: false }));
A("every allowlisted path exists in _site/", missing.length === 0, missing.join(" "));
const untracked = res.files.filter((p) => !["/index.html", "/version.json"].includes(p) && !tracked.has(p));
A("every copied file is tracked in git, so Netlify's checkout has it too", untracked.length === 0, untracked.join(" "));
const sbjs = R("src/live/build.cjs").match(/const SUPABASE_JS = "([0-9.]+)";/)[1];
const NEED = ["/index.html", "/version.json", `/vendor/supabase-js-${sbjs}.min.js`, "/favicon.svg", "/og.png", "/apple-touch-icon.png",
  "/site.webmanifest", "/icon-192.png", "/icon-512.png", "/logo-light.svg", "/chel-gaming-logo-1024.png",
  "/chel-gaming-logo-light-1024.png", "/chel-gaming-logo-light-tile-1024.png", "/robots.txt", "/sitemap.xml"];
const lacking = NEED.filter((p) => !res.files.includes(p));
A("the page's script, icons, logos, manifest icons, robots.txt and sitemap are all published", lacking.length === 0, lacking.join(" "));
const cinema = [...new Set(page.toString("utf8").match(/\/assets\/cinema\/[\w.-]+/g) || [])];
A("...and every photo the page draws", cinema.length > 0 && cinema.every((p) => res.files.includes(p)), cinema.join(" "));
for (const h of ["/version.json", "/favicon.svg", "/og.png", "/site.webmanifest"]) {
  A(`netlify.toml's header target ${h} is in the deploy`, res.files.includes(h) && new RegExp(`for = "${h.replace(/\./g, "\\.")}"`).test(R("netlify.toml")));
}

console.log("\nnothing private is published");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const shipped = walk(out).map((f) => "/" + path.relative(out, f).split(path.sep).join("/"));
A("the folder holds exactly the allowlist", shipped.length === res.files.length && shipped.every((p) => res.files.includes(p)), shipped.join(" "));
const PRIV = /^\/(src|sql|tools|concepts|data|docs|bot|jobs|edge|shared|supabase|netlify|node_modules|LG|graphify-out|\.git|\.github|\.claude)\//;
A("nothing under src/, sql/, tools/, concepts/ or any other source folder", !shipped.some((p) => PRIV.test(p)), shipped.filter((p) => PRIV.test(p)).join(" "));
const ROOTPRIV = /^\/(CGHL-|README|CLAUDE|BRAND|server\.js|package\.json|jsconfig\.json|netlify\.toml|preview\.html|share\.html|\.env|\.gitignore)/;
A("no briefing, note, config or preview file from the repo root", !shipped.some((p) => ROOTPRIV.test(p)), shipped.filter((p) => ROOTPRIV.test(p)).join(" "));
A("no snapshot.js anywhere", !shipped.some((p) => /snapshot\.js$/.test(p)));
A("no role-icon artwork (it is bundled into the functions from the repo, never served)", !shipped.some((p) => /^\/assets\/role-icons\//.test(p)));

console.log("\nthe guard fails the build, listing every problem");
{
  const fake = path.join(tmp, "fake");
  const bad = ["/src/live/part_live.js", "/sql/a.sql", "/tools/t.test.cjs", "/concepts/s2/core.js", "/data/snapshot.js", "/share.html",
    "/CGHL-Season1-Owners-Briefing.md", "/docs/x.md", "/.env.local"];
  for (const p of [...bad, "/stray.txt", "/favicon.svg"]) { fs.mkdirSync(path.dirname(path.join(fake, p)), { recursive: true }); fs.writeFileSync(path.join(fake, p), "x"); }
  const blocked = SB.blockedBy(R("netlify.toml"));
  /* private wins even when the allowlist names the file */
  const msg = throws(() => SB.checkOut(fake, new Set([...bad, "/favicon.svg"]), blocked));
  A("each private file is named", bad.every((p) => msg.includes(p + " is private")), msg);
  A("a file off the allowlist is named", msg.includes("/stray.txt is not on the allowlist"));
  A("an allowlisted public file passes", !msg.includes("/favicon.svg"));
  A("blockedBy reads all 19 forced 404 rules from netlify.toml", blocked.length >= 19 && blocked.includes("/docs/*") && blocked.includes("/README*"), blocked.length);
  A("the build refuses to wipe the repo or a folder holding it",
    /refusing to wipe/.test(throws(() => SB.build(REPO))) && /refusing to wipe/.test(throws(() => SB.build(path.dirname(REPO)))));
}

console.log("\nthe crawl");
{
  const r = SB.refs(`<link href="/favicon.svg"> url(\\'/assets/cinema/a.jpg\\') "https://chelgamingleague.com/og.png?v=3" ` +
    `src='/vendor/x.min.js#h' Disallow: /src/ "https://cdn.jsdelivr.net/npm/x" "//chelgamingleague.com/sitemap.xml" "/#/draft" "/"`);
  A("finds quoted, url() and own-domain paths, without query or hash",
    ["/favicon.svg", "/assets/cinema/a.jpg", "/og.png", "/vendor/x.min.js", "/sitemap.xml"].every((p) => r.has(p)), [...r].join(" "));
  A("...and nothing else (no robots Disallow line, other host, hash route or bare /)", r.size === 5, [...r].join(" "));
}

console.log("\nnetlify.toml, .gitignore and the moved briefings");
{
  const toml = R("netlify.toml");
  A("ROOT is classic (the /classic and Season 2 modes come later)", SB.ROOT === "classic");
  A("publish = \"_site\"", /^\s*publish = "_site"$/m.test(toml) && !/^\s*publish = "\."$/m.test(toml));
  A("the build command is the site builder", /^\s*command = "node tools\/site-build\.cjs"$/m.test(toml));
  A("functions and their included role icons still come from the repo",
    /^\s*functions = "netlify\/functions"$/m.test(toml) && /included_files = \["assets\/role-icons\/\*", "assets\/role-icons\/\*\*"\]/.test(toml));
  A("_site/ is gitignored", /^_site\/$/m.test(R(".gitignore")));
  const moved = ["CGHL-Season1-Format-Announcement.txt", "CGHL-Season1-Owners-Briefing-DISCORD-FULL-FORMAT.txt", "CGHL-Season1-Owners-Briefing-FULL-FORMAT.md"];
  A("the three unblocked briefings moved into docs/ (blocked by /docs/* if publish ever returns to the root)",
    moved.every((f) => tracked.has("/docs/" + f) && !tracked.has("/" + f)) && /from = "\/docs\/\*"/.test(toml));
}

/* v4.62: the changelog entry, found by version (never changelog[0]), and CLAUDE.md names the new build */
{ const vm = require("vm"); const c = { CG: {} }; vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src/live/part3_content.js"), "utf8"), c);
  const e = c.CG.CONTENT.rulebook.changelog.find((x) => x.version === "4.62");
  A("the 4.62 changelog entry exists and says the page is unchanged", !!e && /byte for byte the same/.test(e.items.join(" ")));
  const md = fs.readFileSync(path.join(__dirname, "..", "CLAUDE.md"), "utf8");
  A("CLAUDE.md describes the _site build, not publish = \".\"", /node tools\/site-build\.cjs/.test(md) && /publishes only `_site\/`/.test(md) && md.indexOf("`publish = \".\"` serves the repo root") < 0); }
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
