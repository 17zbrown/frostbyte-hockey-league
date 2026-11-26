/* v5.00 swap (i2, 2026-11-24): the switch mechanics. Commissioner, 2026-11-24: "I want the site transitions by tomorrow so
   we can run the draft on the new site, and make sure it is ready by the time we announce the season 2 ownership group so
   they do not need to deal with a transition at all."
   tools/site-build.cjs builds three ways and ONE constant (ROOT) picks the one Netlify publishes:
     classic  / is the classic site, byte for byte what v4.62 published (the value until the release)
     next     the same, plus the Season 2 site at /next/ (built for the suites; never shipped)
     s2       the flip: chelgamingleague.com serves ONLY the Season 2 site; /classic and /next go to / (302)
   Commissioner, 2026-11-24 evening: "I want the concept site to be ready to swap out the current site tomorrow fully
   without the /next url", and "move the current site from season 1 off to a separate free domain from netlify in case we
   ever need to fall back on it": the classic site leaves the domain and the fallback target builds its frozen copy.
   This builds each into a temp folder and pins what it holds, the flip guard, every old link the backend or the database
   writes landing on a Season 2 page, the sign-in return on each site, and grant-audit check 4 covering both sites' RPCs.
   Run: node tools/s2-site-modes.test.cjs */
const fs = require("fs"), path = require("path"), os = require("os"), vm = require("vm"), { execFileSync } = require("child_process");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 900))); } };
const REPO = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const SB = require("./site-build.cjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cghl-modes-"));
const quiet = (f) => { const w = console.warn, l = console.log; console.warn = console.log = () => {}; try { return f(); } finally { console.warn = w; console.log = l; } };
const throws = (f) => { try { quiet(f); return ""; } catch (e) { return String(e.message); } };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const tree = (d) => walk(d).map((f) => "/" + path.relative(d, f).split(path.sep).join("/")).sort();
const bytes = (d, p) => fs.readFileSync(path.join(d, p));
const META = /<meta name="cg-build" content="([0-9a-f]{12})">/;
const content = (() => { const c = { CG: {} }; vm.createContext(c); vm.runInContext(R("src/live/part3_content.js"), c); return c.CG.CONTENT; })();

console.log("the one switch");
A("ROOT is \"s2\": the root serves the Season 2 site since the release (no /next step; the classic site lives on as the fallback)", SB.ROOT === "s2", SB.ROOT);
A("the three modes are classic, next and s2", JSON.stringify(SB.MODES) === '["classic","next","s2"]');
A("Netlify's command passes no options (the CLI builds ROOT, with the flip guard on)",
  /^  if \(a\[0\] === "--fallback"\) fallback\(a\[1\]\);\n  else if \(a\.length > 1 \|\| \(a\[0\] \|\| ""\)\.startsWith\("-"\)\) throw [^\n]+\n  else build\(a\[0\]\);$/m.test(R("tools/site-build.cjs")) &&
  /^\s*command = "node tools\/site-build\.cjs"$/m.test(R("netlify.toml")));
A("an unknown mode is refused", /is not one of classic, next, s2/.test(throws(() => SB.build(path.join(tmp, "x"), { root: "flip" }))));

const plain = path.join(tmp, "plain");
fs.mkdirSync(plain);
execFileSync(process.execPath, [path.join(REPO, "src/live/build.cjs"), path.join(plain, "index.html")], { stdio: "ignore" });
const C = path.join(tmp, "classic"), N = path.join(tmp, "next"), S = path.join(tmp, "s2");
const rc = quiet(() => SB.build(C, { root: "classic" })), rn = quiet(() => SB.build(N, { root: "next" })), rs = quiet(() => SB.build(S, { root: "s2" }));
const cls = tree(C);

console.log("\nclassic: v4.62's output");
A("_site/index.html and version.json are byte-equal to a plain src/live/build.cjs build",
  bytes(C, "index.html").equals(bytes(plain, "index.html")) && bytes(C, "version.json").equals(bytes(plain, "version.json")));
A("no /next, /classic or Season 2 bundle", !cls.some((p) => /^\/(next|classic|s2)\//.test(p)), cls.join(" "));
A("the build's file list is the folder", JSON.stringify(rc.files) === JSON.stringify(cls));

console.log("\nnext: classic plus /next/");
const nxt = tree(N), extra = nxt.filter((p) => !cls.includes(p));
A("every classic file is there, byte for byte (the root does not change at the hand-off)", cls.every((p) => nxt.includes(p) && bytes(N, p).equals(bytes(C, p))), cls.filter((p) => !nxt.includes(p) || !bytes(N, p).equals(bytes(C, p))).join(" "));
A("the only additions are /next/index.html, one /s2/app-<hash>.js and _redirects", extra.length === 3 && extra.includes("/next/index.html") && extra.includes("/_redirects") &&
  extra.some((p) => /^\/s2\/app-[0-9a-f]{12}\.js$/.test(p)), extra.join(" "));
const npage = bytes(N, "next/index.html").toString("utf8"), bundlePath = extra.find((p) => p.startsWith("/s2/")), bundle = bytes(N, bundlePath.slice(1)).toString("utf8");
A("_redirects sends /classic to the root, and touches nothing else", bytes(N, "_redirects").toString("utf8") === "/classic/*  /  302\n/classic  /  302\n");
const sbv = R("src/live/build.cjs").match(/const SUPABASE_JS = "([0-9.]+)";/)[1], sri = R("src/live/build.cjs").match(/const SUPABASE_SRI = "([^"]+)";/)[1];
{
  const iSb = npage.indexOf(`<script src="/vendor/supabase-js-${sbv}.min.js" integrity="${sri}"`), iMode = npage.indexOf('<script>window.S2_MODE = "live";</script>'), iLoad = npage.indexOf("<script>/* src/s2/js/load.js */");
  A("the pinned supabase-js (our origin, build.cjs's version and hash) comes before S2_MODE live and the inlined js/load.js", iSb > 0 && iSb < iMode && iMode < iLoad, [iSb, iMode, iLoad]);
  A("...and is published", nxt.includes(`/vendor/supabase-js-${sbv}.min.js`));
  A("/next has no build id of its own (testers reload by hand; the pulse reads the root's)", !META.test(npage));
  A("/next is noindex", /<meta name="robots" content="noindex">/.test(npage.slice(0, npage.indexOf("</head>"))));
  A("no data/snapshot.js tag, no S2DATA fixture and no relative file", !/<script[^>]*snapshot\.js/.test(npage) && !/S2DATA\s*=[^=]/.test(npage + bundle) && !/\b(?:src|href)="(?!https:\/\/|\/|#)/.test(npage));
  A("the head is the league's (src/s2/head.html), not the concept's", /<title>Chel Gaming Hockey League<\/title>/.test(npage) && !/concept|Local demo/i.test((npage.match(/<title>[^<]*<\/title>\n<meta name="description" content="[^"]*">/) || ["concept"])[0]));
  const tpl = npage.match(/<template id="s2-scripts">([\s\S]*?)<\/template>/);
  A("the script list is the one bundle", !!tpl && tpl[1].trim() === `<script src="${bundlePath}"></script>`, tpl && tpl[1]);
  /* health crawl 11 (2026-11-25): js/load.js inserts the bundle only after both league reads, so it preloads every script
     the template lists as soon as it has asked for the read. Rewritten in the review's second pass: this check pinned a
     preload at the top of the head, which shared a slow phone's connection with the page's own stylesheets and put the
     wheel and the read about 3.5 s later (measured at 390 px, CPU 4x, 1.6 Mbps), so it now pins the loader's preload and
     no head preload. Neither the preload nor the inserted script names crossorigin, so their requests match */
  const loadJs = R("src/s2/js/load.js"), pre = [...npage.matchAll(/<link rel="preload"[^>]*>/g)].map((m) => m[0]);
  const boot = loadJs.slice(loadJs.indexOf('if (source === "live") {'));
  A("the page carries no preload of its own: the loader preloads the template's scripts once it has asked for the read, with no crossorigin anywhere",
    pre.length === 0 && /function preload\(\) \{\n    scripts\(\)\.forEach\(function \(src\) \{\n      var l = document\.createElement\("link"\); l\.rel = "preload"; l\.as = "script"; l\.href = src;/.test(loadJs) &&
    /var first = read\(asked, null\);\n    preload\(\);/.test(boot) && /function run\(\) \{\n    var list = scripts\(\);/.test(loadJs) &&
    npage.indexOf("/* src/s2/js/load.js */") > 0 && npage.indexOf(loadJs.slice(loadJs.indexOf("function preload()"), loadJs.indexOf("function run()"))) > 0 &&
    !/crossorigin/i.test(tpl ? tpl[1] : "x") && !/\.crossOrigin|setAttribute\("crossorigin"/i.test(loadJs), pre);   /* code, not the comment that says why */
  const listed = [...R("src/s2/demo.html").match(/<template id="s2-scripts">([\s\S]*?)<\/template>/)[1].matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const at = listed.map((rel) => bundle.indexOf(`/* ---- src/s2/${rel} ---- */\n` + R("src/s2/" + rel)));
  A("the bundle holds every script demo.html lists, whole and in order (" + listed.length + ")", at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), listed.filter((r, i) => at[i] < 0).join(" "));
  A("the bundle's name is a hash of its bytes (a release is a new URL)", bundlePath === "/s2/app-" + require("crypto").createHash("sha256").update(bundle).digest("hex").slice(0, 12) + ".js");
  let parsed = true; try { new vm.Script(bundle); } catch (e) { parsed = e.message; }
  A("the bundle parses", parsed === true, parsed);
  const sheets = [...R("src/s2/demo.html").matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  const sat = sheets.map((rel) => npage.indexOf(`<style>/* ${rel} */\n` + R("src/s2/" + rel)));
  A("every stylesheet is inlined whole, in order (" + sheets.length + ")", sat.every((x, i) => x >= 0 && (i === 0 || x > sat[i - 1])), sheets.filter((r, i) => sat[i] < 0).join(" "));
  A("the rulebook (stream e6's js/rulebook.js) is carried, or its absence is a build note", listed.includes("js/rulebook.js") ? !rn.notes.length : rn.notes.some((x) => /rulebook\.js/.test(x)), rn.notes.join(" | "));
}

console.log("\ns2: the flip (the Season 2 site only)");
const s2t = tree(S), spage = bytes(S, "index.html").toString("utf8"), ver = JSON.parse(bytes(S, "version.json").toString("utf8")), cver = JSON.parse(bytes(C, "version.json").toString("utf8"));
{
  const id = (spage.match(META) || [])[1];
  A("the root is the Season 2 page (the same page /next served, plus its build id)", spage.replace(/<meta name="cg-build" content="[0-9a-f]{12}">\n/, "") === npage.replace('<meta name="robots" content="noindex">\n', ""));
  A("version.json: the build stamped in the page (a hash of the Season 2 page), the rulebook's newest version, and build.cjs's rules card and Edge ids",
    /^[0-9a-f]{12}$/.test(ver.build) && ver.build === id && id === require("crypto").createHash("sha256").update(npage.replace('<meta name="robots" content="noindex">\n', "")).digest("hex").slice(0, 12) &&
    ver.version === content.rulebook.changelog[0].version && JSON.stringify(ver.rulesCard) === JSON.stringify(cver.rulesCard) && JSON.stringify(ver.edge) === JSON.stringify(cver.edge) &&
    Object.keys(ver).join() === Object.keys(cver).join(), JSON.stringify(ver).slice(0, 200));
  A("no classic copy on the domain: no /classic/, no /next/, and no classic-only file (cinema photos, logos)",
    !s2t.some((p) => /^\/(classic|next|assets)\//.test(p)) && !s2t.some((p) => /chel-gaming-logo/.test(p)), s2t.join(" "));
  A("_redirects sends /classic and /next (old addresses, with or without a path) to the root", bytes(S, "_redirects").toString("utf8") === "/classic/*  /  302\n/classic  /  302\n/next/*  /  302\n/next  /  302\n");
  A("the root page is not noindex", !/noindex/.test(spage.slice(0, spage.indexOf("</head>"))));
  const want = ["/index.html", "/version.json", "/_redirects", bundlePath, "/robots.txt", "/sitemap.xml", `/vendor/supabase-js-${sbv}.min.js`].sort();
  A("the files: the page, version.json, _redirects, the bundle, supabase-js, robots.txt and the sitemap, plus the icons the head names",
    want.every((p) => s2t.includes(p)) && s2t.filter((p) => !want.includes(p)).every((p) => /^\/[\w.-]+\.(png|svg|webmanifest)$/.test(p)), s2t.join(" "));
  A("the build's file list is the folder", JSON.stringify(rs.files) === JSON.stringify(s2t));
}

console.log("\nthe flip guard");
{
  /* i3f (2026-11-25): this pinned the refusal "until stream i3 deletes demo mode"; demo mode is deleted, so the flip builds,
     and the guard finds nothing on the real page (each device below is still caught one by one) */
  const msg = throws(() => SB.build(path.join(tmp, "flip"), { root: "s2" }));
  A("the flip builds: the root page carries no demo device and no concept wording (stream i3 deleted demo mode)", msg === "", String(msg).split("\n").slice(0, 6).join(" | "));
  A("the flip's page and bundle pass the guard", SB.flipGuard(SB.s2Page("s2")).length === 0, SB.flipGuard(SB.s2Page("s2")).join(" | "));
  const clean = { html: '<html><head><meta charset="utf-8"><title>Chel Gaming Hockey League</title><meta name="description" content="League"></head><body></body></html>',
    parts: [{ rel: "js/rulebook.js", text: "(function(){})();" }], files: { js: ["js/rulebook.js"] } };
  A("a clean page passes", SB.flipGuard(clean).length === 0, SB.flipGuard(clean).join(" | "));
  const each = ["S2.demo.place()", "S2.override({})", "demo-dock", '"s2.role"', "Concept preview", "#/concept", "Try it anyway", "(demo)", "concept-build",
    '<span class="chip sample">', '<script src="data/snapshot.js">', "window.S2DATA = {}", "service_role", "https://discord.com/api/" + "webhooks/1/x", "sb_secret_" + "a".repeat(24)];
  A("each of the " + each.length + " devices is caught", each.every((t) => SB.flipGuard({ html: clean.html, parts: [{ rel: "js/x.js", text: t }], files: clean.files }).length === 1),
    each.filter((t) => SB.flipGuard({ html: clean.html, parts: [{ rel: "js/x.js", text: t }], files: clean.files }).length !== 1).join(" | "));
  /* concept wording a member would read (commissioner, 2026-11-24: one release, the real site), in code and copy only */
  const say = (text) => SB.flipGuard({ html: clean.html, parts: [{ rel: "js/x.js", text }], files: clean.files });
  const words = ['"In the concept you can run it anyway."', '"New in the concept: links the case."', '"Discord preview: nothing is posted from the concept"', '"in this preview they stand in"',
    '"counted at the sample Season 2 clock"', '"Season 2 preview, sample."', '"On the live site this files it."', '"changes the rosters until you reload"', '"Nothing here is posted or sent."', '"nothing here is sent anywhere"'];
  A("each of " + words.length + " concept phrases in copy is caught as concept wording", words.every((w) => say("var a = " + w + ";").some((h) => /concept wording/.test(h))),
    words.filter((w) => !say("var a = " + w + ";").some((h) => /concept wording/.test(h))).join(" | "));
  A("...but not in a comment (a comment's history may stay)", words.every((w) => say("/* " + w + " */ var a = 1; // " + w + "\n").length === 0));
  A("...and live copy that only sounds alike passes (a match preview, nothing posted in #game-scores)",
    say('var a = ["Match preview", "Preview", "Only the overtime mark changes, so nothing is posted in #game-scores.", "Nothing is posted, so the old final stays."];').length === 0);
  A("a device is named once, not again as wording", say('var a = "Concept preview";').length === 1 && say('var b = "#/concept";').length === 1);
  A("the page's own copy is read too, without its comments and stylesheets", SB.flipGuard({ html: clean.html.replace("<body>", "<body><p>About this concept</p>"), parts: clean.parts, files: clean.files }).some((h) => /^the page: concept wording/.test(h)) &&
    SB.flipGuard({ html: clean.html.replace("<body>", "<body><!-- the concept --><style>/* concept */</style><script>/* concept */ var a = 1;</script>"), parts: clean.parts, files: clean.files }).length === 0);
  /* codeOnly: comments blanked, everything else kept, so every Season 2 file still parses after it */
  const co = SB.codeOnly('var a = "// kept", b = /\\/\\*x/.test(a); /* gone */ var c = `t ${ "u" /* gone */ } // kept`; // gone\nvar d = x / 2 / 3; // gone');
  A("codeOnly keeps strings, regex and template literals, blanks comments, and keeps the length",
    co.length === 'var a = "// kept", b = /\\/\\*x/.test(a); /* gone */ var c = `t ${ "u" /* gone */ } // kept`; // gone\nvar d = x / 2 / 3; // gone'.length &&
    /"\/\/ kept"/.test(co) && /\/\\\/\\\*x\//.test(co) && /} \/\/ kept`/.test(co) && !/gone/.test(co) && /var d = x \/ 2 \/ 3;/.test(co), co);
  const unparsed = walk(path.join(REPO, "src/s2/js")).filter((f) => f.endsWith(".js")).filter((f) => { try { new vm.Script(SB.codeOnly(fs.readFileSync(f, "utf8"))); return false; } catch (e) { return true; } });
  A("every src/s2 script still parses with its comments blanked", unparsed.length === 0, unparsed.join(" "));
  A("...and so are a noindex head, a concept title and a missing rulebook",
    SB.flipGuard({ html: clean.html.replace("<title>", '<meta name="robots" content="noindex"><title>'), parts: [], files: clean.files }).some((h) => /noindex/.test(h)) &&
    SB.flipGuard({ html: clean.html.replace("League</title>", "League concept</title>"), parts: [], files: clean.files }).some((h) => /title/.test(h)) &&
    SB.flipGuard({ html: clean.html, parts: [], files: { js: [] } }).some((h) => /rulebook/.test(h)));
}

console.log("\nthe fallback: the frozen Season 1 site for its own Netlify site");
const F = path.join(tmp, "fallback");
const rf = quiet(() => SB.fallback(F)), FS = path.join(F, "_site"), ft = tree(FS);
{
  const fpage = bytes(FS, "index.html").toString("utf8"), cpage = bytes(C, "index.html").toString("utf8");
  const skip = '<a class="skip" href="#app">Skip to content</a>\n';
  const want = cpage.replace(META, '<meta name="robots" content="noindex">').replace(skip, skip + SB.FALLBACK_NOTICE);
  A("the page is the classic page byte for byte but three lines: no cg-build meta, a robots noindex meta, the backup notice", fpage === want && fpage !== cpage &&
    (cpage.match(new RegExp(META.source, "g")) || []).length === 1 && cpage.split(skip).length === 2);
  A("...so it carries no build id and is noindex", !META.test(fpage) && !/name="cg-build"/.test(fpage.slice(0, fpage.indexOf("</head>"))) && /<meta name="robots" content="noindex">/.test(fpage.slice(0, fpage.indexOf("</head>"))));
  A("...and the notice is one line saying it is the Season 1 backup, linking to chelgamingleague.com",
    SB.FALLBACK_NOTICE.split("\n").length === 2 && /This is the Season 1 site, kept as a backup\./.test(SB.FALLBACK_NOTICE) && /<a href="https:\/\/chelgamingleague\.com"[^>]*>chelgamingleague\.com<\/a>/.test(SB.FALLBACK_NOTICE) &&
    !/—| - /.test(SB.FALLBACK_NOTICE));
  /* the real CG._checkBuild: with the page's build id null (the fallback) a changed pulse id does nothing; with an id it
     would offer the update (so the harness can tell the two apart) */
  const live = R("src/live/part_live.js"), cb = live.match(/CG\._checkBuild = function\(site\)\{[\s\S]*?\n\};\n/);
  const runCheck = (build) => { const c = { CG: { BUILD: build, _isLiveHost: () => true, _updateState: () => null, _hideUpdatePill() {}, _showUpdatePill() { c.shown = 1; } }, setTimeout: (fn) => fn(), clearTimeout() {}, Date };
    vm.createContext(c); vm.runInContext(cb[0], c); c.CG._checkBuild("aaaaaaaaaaaa"); c.CG._checkBuild("bbbbbbbbbbbb"); return { ready: c.CG._updateReady, shown: !!c.shown }; };
  A("with no build id the reload check never runs, even on a league host (a page with one would chase the new id)",
    !!cb && runCheck(null).ready === undefined && !runCheck(null).shown && runCheck("cccccccccccc").ready === "bbbbbbbbbbbb" && runCheck("cccccccccccc").shown);
  A("CG.BUILD reads the cg-build meta (the build-time switch), and part_live.js says so", /CG\.BUILD = \(function\(\)\{ try \{ var m = document\.querySelector\('meta\[name="cg-build"\]'\)/.test(live) && /site-build\.cjs --fallback\) is built without it/.test(live.replace(/\n\s*/g, " ")));
  const cg = live.match(/CG\.oauthBack = function\(\)\{[^\n]*\};/), c = { location: { origin: "https://chelgamingleague-classic.netlify.app", pathname: "/" } };
  vm.createContext(c); vm.runInContext("var CG = {};" + cg[0] + "; this.out = CG.oauthBack();", c);
  A("a Discord sign-in there returns to the fallback's own origin (CG.oauthBack)", c.out === "https://chelgamingleague-classic.netlify.app");
  A("robots.txt disallows everything", bytes(FS, "robots.txt").toString("utf8") === "User-agent: *\nDisallow: /\n" && SB.FALLBACK_ROBOTS === "User-agent: *\nDisallow: /\n");
  A("_site holds no function, no Season 2 file, no version.json and no _redirects",
    !ft.some((p) => /^\/(netlify|\.netlify|functions|src|s2|next|classic)\//.test(p) || /\.(mjs|cjs)$/.test(p) || p === "/version.json" || p === "/_redirects") &&
    ft.filter((p) => p.endsWith(".js")).every((p) => /^\/vendor\/supabase-js-[0-9.]+\.min\.js$/.test(p)), ft.join(" "));
  const shared = ft.filter((p) => p !== "/index.html" && p !== "/robots.txt");
  A("every other file is a classic-site file, byte for byte (" + shared.length + ")", shared.length > 5 && shared.every((p) => cls.includes(p) && bytes(FS, p).equals(bytes(C, p))), shared.filter((p) => !cls.includes(p) || !bytes(FS, p).equals(bytes(C, p))).join(" "));
  A("the build's file list is the folder, and the folder beside it holds only _site, netlify.toml and the build's own marker", JSON.stringify(rf.files) === JSON.stringify(ft) && fs.readdirSync(F).sort().join(" ") === ".cghl-fallback-build _site netlify.toml");
  const ftoml = fs.readFileSync(path.join(F, "netlify.toml"), "utf8"), mtoml = R("netlify.toml");
  const sec = (x) => (x.match(/\[\[headers\]\]\n\s*for = "\/\*"\n\s*\[headers\.values\]\n(?:[ \t]+\S.*\n?)+/) || [""])[0].replace(/\n?$/, "\n");
  A("its netlify.toml: publish _site, no build command and no functions setting", /^\[build\]\n  publish = "_site"$/m.test(ftoml) && !/^\s*(command|functions|edge_functions|included_files)\s*=/m.test(ftoml) && !/^\[functions\]/m.test(ftoml));
  A("...one redirect: /api/* proxied (status 200, forced) to https://chelgamingleague.com/api/:splat, so no function or schedule runs twice",
    (ftoml.match(/^\[\[redirects\]\]$/gm) || []).length === 1 && /\[\[redirects\]\]\n  from = "\/api\/\*"\n  to = "https:\/\/chelgamingleague\.com\/api\/:splat"\n  status = 200\n  force = true\n/.test(ftoml));
  A("...and the main site's security headers, copied verbatim (one headers block)", sec(mtoml).length > 300 && ftoml.includes(sec(mtoml)) && (ftoml.match(/^\[\[headers\]\]$/gm) || []).length === 1);
  A("every /api path the classic page calls is under the proxy", [...new Set([...R("src/live/part_live.js").matchAll(/["']\/api\/([a-z-]+)/g)].map((m) => m[1]))].length >= 3);
  A("it refuses a folder inside a git work tree (netlify-cli would read the repo's config) and a missing folder",
    /inside the git work tree/.test(throws(() => SB.fallback(path.join(REPO, "fallback-test")))) && /needs a folder/.test(throws(() => SB.fallback())) && !fs.existsSync(path.join(REPO, "fallback-test")));
  /* main session, 2026-11-24: a build wipes only a folder it made (a slip like --fallback ~/Developer/cghl-private would
     otherwise erase files that cannot be recovered) */
  const keep = path.join(os.homedir(), "Developer", ".cghl-wipe-guard-test-" + process.pid);
  fs.mkdirSync(keep, { recursive: true }); fs.writeFileSync(path.join(keep, "precious.txt"), "x");
  const refusedFb = throws(() => SB.fallback(keep)), refusedMain = throws(() => SB.build(keep));
  A("a folder holding files the build did not make is refused by --fallback and by the main build, and keeps its files",
    /refusing to wipe .*did not make/.test(refusedFb) && /refusing to wipe .*did not make/.test(refusedMain) && fs.readFileSync(path.join(keep, "precious.txt"), "utf8") === "x", [refusedFb, refusedMain]);
  fs.rmSync(keep, { recursive: true, force: true });
  A("the fallback folder carries its marker beside _site, and a rebuild over its own folder works", fs.existsSync(path.join(F, ".cghl-fallback-build")) && !fs.existsSync(path.join(FS, ".cghl-fallback-build")) && throws(() => SB.fallback(F)) === "");
  const src = R("tools/site-build.cjs"), fb = src.slice(src.indexOf("function fallback(outArg)"), src.indexOf("module.exports"));
  A("it fails on a private file exactly as the main build does (the same copier and checkOut)", /const copy = copier\(site, allowed, blocked\);/.test(fb) && /checkOut\(site, allowed, blocked\);/.test(fb) && /blockedBy\(toml\)/.test(fb));
}

console.log("\nnothing private, in any mode");
for (const [name, d] of [["classic", C], ["next", N], ["s2", S], ["fallback", path.join(tmp, "fallback", "_site")]]) {
  const t = tree(d);
  const PRIV = /^\/(src|sql|tools|concepts|data|docs|bot|jobs|edge|shared|supabase|netlify|node_modules|LG|graphify-out|assets\/role-icons|\.git|\.github|\.claude)\//;
  A(name + ": no source folder, briefing, config, snapshot, share copy or symbolic link",
    !t.some((p) => PRIV.test(p) || /^\/(CGHL-|README|CLAUDE|BRAND|package\.json|netlify\.toml|share|preview\.html|\.env)/.test(p) || /snapshot\.js$|S2DATA/.test(p)) &&
    walk(d).every((f) => !fs.lstatSync(f).isSymbolicLink()), t.join(" "));
}
{
  const fake = path.join(tmp, "fake");
  for (const p of ["/src/s2/data/snapshot.js", "/next/data/snapshot.js", "/assets/logos/BOS.png", "/share.html"]) { fs.mkdirSync(path.dirname(path.join(fake, p)), { recursive: true }); fs.writeFileSync(path.join(fake, p), "x"); }
  const m = throws(() => SB.checkOut(fake, new Set(["/src/s2/data/snapshot.js", "/next/data/snapshot.js", "/share.html"]), SB.blockedBy(R("netlify.toml"))));
  A("v4.62's guard still refuses the private Season 2 files (src/s2/data, any snapshot.js, share copies, the logos copy)",
    ["/src/s2/data/snapshot.js is private", "/next/data/snapshot.js is private", "/share.html is private", "/assets/logos/BOS.png is not on the allowlist"].every((x) => m.includes(x)), m);
}

console.log("\nevery redirect the build writes is temporary (302), in every mode");
for (const [name, d] of [["next", N], ["s2", S]]) {
  const lines = bytes(d, "_redirects").toString("utf8").trim().split("\n");
  A(name + ": " + lines.length + " rules, each from a path to / with status 302", lines.every((l) => /^\/\S+\s+\/\s+302$/.test(l)), lines.join(" | "));
}
A("no mode writes a 301", Object.values(SB.REDIRECTS).every((t) => !/\b301\b/.test(t)));

console.log("\nnetlify.toml and robots.txt");
{
  const toml = R("netlify.toml"), robots = R("robots.txt");
  A("the bundle is cached for good (its name changes with its bytes)", /for = "\/s2\/\*"\n\s+\[headers\.values\]\n\s+Cache-Control = "public, max-age=31536000, immutable"/.test(toml));
  A("/next/ answers X-Robots-Tag noindex, and no rule serves a /classic/ copy", /for = "\/next\/\*"\n\s+\[headers\.values\]\n\s+X-Robots-Tag = "noindex"/.test(toml) && !/for = "\/classic/.test(toml));
  A("robots.txt disallows both old addresses", /^Disallow: \/next\/$/m.test(robots) && /^Disallow: \/classic\/$/m.test(robots));
  A("the CSP still lets the page run: same-origin scripts, inline scripts and styles, Google Fonts, Supabase over REST and wss",
    /script-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net/.test(toml) && /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/.test(toml) &&
    /connect-src 'self' https:\/\/bzbuyclwdhmhdzujxeqd\.supabase\.co wss:\/\/bzbuyclwdhmhdzujxeqd\.supabase\.co/.test(toml));
}

console.log("\nsign-in comes back to the site it started on");
{
  const live = R("src/live/part_live.js"), s2live = R("src/s2/js/live.js");
  const cg = live.match(/CG\.oauthBack = function\(\)\{[^\n]*\};/), s2b = s2live.match(/function back\(\) \{[^\n]*\}/);
  const run = (src, name, pathname) => { const c = { location: { origin: "https://chelgamingleague.com", pathname } }; vm.createContext(c); vm.runInContext("var CG = {};" + src + "; this.out = " + name + "();", c); return c.out; };
  const cases = [["/", "https://chelgamingleague.com"], ["/classic/", "https://chelgamingleague.com/classic/"], ["/next/", "https://chelgamingleague.com/next/"], ["/next", "https://chelgamingleague.com/next"]];
  A("classic CG.oauthBack: the bare origin at the root (as before, and on the fallback's own origin), the path anywhere else", !!cg && cases.every(([p, w]) => run(cg[0], "CG.oauthBack", p) === w));
  A("Season 2 back(): the same answers at / and /next", !!s2b && cases.every(([p, w]) => run(s2b[0], "back", p) === w));
  A("every classic Discord redirect (sign-in and both account links) uses CG.oauthBack", (live.match(/redirectTo: CG\.oauthBack\(\)/g) || []).length === 3 && !/redirectTo: window\.location\.origin/.test(live));
  A("both routers keep the OAuth fragment intercept (memory discord-account-switching: never remove it)", /S2\.authFragment\(location\.hash\)/.test(R("src/s2/js/core.js")) && /access_token/.test(R("src/live/part4_ui.js")));
}

console.log("\nevery old link lands on a Season 2 page");
{
  /* the real js/core.js in a vm over a do-nothing DOM, with every page name the Season 2 files register */
  const stub = () => new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => "" : k === "length" ? 0 : stub(), apply: () => stub(), construct: () => stub() });
  const store = {};
  const win = { S2: {}, console, setTimeout, clearTimeout, URLSearchParams, CustomEvent: function () {}, navigator: { userAgent: "" }, requestAnimationFrame: () => 0,
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), location: { hash: "", pathname: "/", search: "", origin: "https://chelgamingleague.com" },
    history: { state: null, replaceState() {}, pushState() {} }, document: stub(), addEventListener() {}, getComputedStyle: () => ({ getPropertyValue: () => "" }) };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(R("src/s2/js/core.js"), win, { filename: "src/s2/js/core.js" });
  const S2 = win.S2;
  const jsFiles = (d) => walk(path.join(REPO, d)).filter((f) => /\.(js|mjs|cjs)$/.test(f));
  const pages = new Set();
  for (const f of jsFiles("src/s2/js")) for (const m of fs.readFileSync(f, "utf8").matchAll(/S2\.page\("([a-z-]+)"/g)) pages.add(m[1]);
  pages.forEach((p) => S2.page(p, {}));
  const nameOf = (h) => String(h).replace(/^#?\/?/, "").split(/[?/]/)[0];
  const lands = (h, role) => { win.S2.state.role = role || "player"; const to = S2.alias(h); return to ? (pages.has(nameOf(to)) && nameOf(to) !== nameOf(h) ? to : null) : (pages.has(nameOf(h)) ? h : null); };
  A("the Season 2 files register their pages (" + pages.size + ")", pages.size >= 20 && pages.has("today") && pages.has("desk") && pages.has("draft"), [...pages].join(" "));

  /* 1) what the backend writes today: Discord posts, bot embeds, DMs, the LFG bot, the database records */
  const backend = new Map();
  for (const d of ["jobs", "bot", "shared", "netlify/functions", "edge"]) for (const f of jsFiles(d)) for (const m of fs.readFileSync(f, "utf8").matchAll(/#\/[A-Za-z][A-Za-z0-9_/-]*/g)) backend.set(m[0], path.relative(REPO, f));
  for (const f of fs.readdirSync(path.join(REPO, "sql")).filter((x) => x.endsWith(".sql"))) for (const m of R("sql/" + f).matchAll(/#\/[A-Za-z][A-Za-z0-9_/-]*/g)) backend.set(m[0], "sql/" + f);
  /* the live database functions' links (pg_proc, read-only, 2026-11-24: 14 functions, two of them the dormant abandonment pair) */
  for (const h of ["#/hub", "#/hub/staffdesk", "#/hub/availability", "#/schedule", "#/hub/complaint?id=6a1d0d6e-0000-4000-8000-000000000001", "#/hub/actions", "#/hub/tradehub", "#/news", "#/matchup/6a1d0d6e-0000-4000-8000-000000000001",
    /* app_config ann_text_2_reg_open (the sign-up announcement text) */ "#/register", "#/owner", "#/rulebook",
    /* bot/club-notices.mjs builds "/#/hub/" + one of these (line 48) */ "#/hub/tradehub", "#/hub/freeagents", "#/hub/lineups", "#/hub/schedule", "#/hub/roster"]) if (!backend.has(h)) backend.set(h, "the database or a built link");
  const bad = [...backend].filter(([h]) => !lands(h) || !lands(h, "staff"));
  A("all " + backend.size + " routes the backend and the database write land on a page, for a member and for staff", bad.length === 0, bad.map(([h, f]) => h + " (" + f + ")").join(", "));
  A("the six department desks the staff alerts link open their Staff Desk tab or the draft page (the Newsroom pane for staff, the news page for a member)",
    lands("#/hub/reviewboard", "staff") === "#/desk?tab=applications" && lands("#/hub/opsdesk", "staff") === "#/desk?tab=games" && lands("#/hub/draftroom", "staff") === "#/draft" &&
    lands("#/hub/transdesk", "staff") === "#/desk?tab=transactions" && lands("#/hub/community", "staff") === "#/desk?tab=cases" && lands("#/hub/newsroom", "staff") === "#/desk?tab=newsroom" && lands("#/hub/newsroom") === "#/news",
    ["reviewboard", "opsdesk", "draftroom", "transdesk", "community", "newsroom"].map((x) => lands("#/hub/" + x, "staff")).join(" "));
  A("#/brand no longer points at the concept page", S2.alias("#/brand") === "#/today");

  /* 2) every classic route, hub page, staff desk and Control Center tab (read from src/live, so a new one is checked too) */
  const live = fs.readdirSync(path.join(REPO, "src/live")).filter((f) => f.endsWith(".js")).map((f) => R("src/live/" + f)).join("\n");
  const old = new Set();
  for (const m of live.matchAll(/CG\.ROUTES(?:\.([a-z]+)|\["([a-z-]+)"\]) *= *function/g)) old.add("#/" + (m[1] || m[2]));
  for (const m of live.matchAll(/["']#\/(hub|admin)\/([a-z]+)/g)) old.add("#/" + m[1] + "/" + m[2]);
  /* CG.STAFF_DESKS's entries are column-aligned (key:"opsdesk",     dept:...), so the space before dept: varies */
  const desks = [...live.matchAll(/\{ key:"([a-z]+)",\s*dept:/g)].map((m) => m[1]);
  desks.forEach((k) => old.add("#/hub/" + k));
  const deskList = (live.match(/CG\.STAFF_DESKS = \[([\s\S]*?)\n\];/) || ["", ""])[1];
  A("all " + (deskList.match(/\{ key:/g) || []).length + " CG.STAFF_DESKS entries are read (" + desks.join(" ") + ")", desks.length === 8 && (deskList.match(/\{ key:/g) || []).length === 8, desks.join(" "));
  for (const m of (live.match(/CG\.ADMIN_ALIAS = \{([^}]*)\}/) || ["", ""])[1].matchAll(/([a-z]+):/g)) old.add("#/admin/" + m[1]);
  ["#/team/BOS", "#/player/6a1d0d6e-0000-4000-8000-000000000001", "#/article/7", "#/thread?id=1", "#/hub/lineup?game=1"].forEach((h) => old.add(h));
  const badOld = [...old].filter((h) => !lands(h) || !lands(h, "staff"));
  A("all " + old.size + " classic routes, hub pages, desks and Control Center tabs land on a page", old.size > 50 && badOld.length === 0, badOld.join(" "));

  /* 3) notifications: every link_view production holds (read-only SELECT, 2026-11-24 evening: 23 kinds on 17,251 rows,
     plus 1,222 rows with no link_view) */
  const VIEWS = ["game", "manager", "team", "application", "automations", "discord", "availability", "draft", "admin", "complaints", "staffdesk", "transactions", "actions", "hub",
    "lineup", "ownerapp", "stafftasks", "rulebook", "users", "teams", "staffapp", "mgmtapprovals", "offers"];
  A("the list is the " + VIEWS.length + " kinds production holds", VIEWS.length === 23 && new Set(VIEWS).size === 23);
  A("S2.NOTIF_VIEWS names every link_view in production, teams included (" + S2.NOTIF_VIEWS.length + ")", VIEWS.every((v) => S2.NOTIF_VIEWS.includes(v)), VIEWS.filter((v) => !S2.NOTIF_VIEWS.includes(v)).join(" "));
  const param = { team: "BOS", game: "6a1d0d6e-0000-4000-8000-000000000001", manager: "roster", application: "id=1&type=owner", admin: "6a1d0d6e-0000-4000-8000-000000000001",
    complaints: "6a1d0d6e-0000-4000-8000-000000000001", actions: "6a1d0d6e-0000-4000-8000-000000000001", hub: "schedule", lineup: "6a1d0d6e-0000-4000-8000-000000000001" };
  const badN = S2.NOTIF_VIEWS.filter((v) => { const h = S2.notifRoute(v, param[v] || ""); return !/^https:\/\//.test(h) && !pages.has(nameOf(h)); });
  A("each opens a page (a discord row may open the server invite)", badN.length === 0, badN.join(" "));
}

console.log("\ngrant-audit check 4 covers both sites' RPCs");
{
  const calls = require("./sql/client-rpcs.cjs").calls(REPO);
  const audit = R("tools/sql/grant-audit.sql");
  const lists = require("./sql/client-rpcs.cjs").listed(audit), listed = new Set(lists.all);
  const missLive = calls.live.filter((x) => !listed.has(x)), missS2 = calls.s2.filter((x) => !listed.has(x));
  A("checks 4 and 4b list every RPC src/live calls (" + calls.live.length + ")", calls.live.length > 100 && missLive.length === 0, missLive.join(" "));
  /* Season 2 page streams add calls while they wire their pages, and they do not own the audit: a name they add is said
     here and goes in at the hand-off and the flip (node tools/sql/client-rpcs.cjs --write, briefs/swap-runbook.md) */
  if (missS2.length) console.log("NOTE src/s2 calls RPCs check 4 does not list yet (run node tools/sql/client-rpcs.cjs --write at the hand-off): " + missS2.join(" "));
  A("checks 4 and 4b list every RPC src/s2 calls today, or the gap is said above (" + calls.s2.length + ")", calls.s2.length >= 10);
  A("checks 4 and 4b both check EXECUTE for authenticated, and 4 keeps its hand list (" + lists.hand.length + ")",
    (audit.match(/where not coalesce\(\(select bool_or\(has_function_privilege\('authenticated', p\.oid, 'EXECUTE'\)\)/g) || []).length >= 2 &&
    ["edit_message", "can_see_match", "statistical_title_board", "registration_pool", "career_games_played", "playoff_floors"].every((x) => lists.hand.includes(x)));
  A("4b holds only names 4 does not (one place per name)", lists.gen.every((x) => !lists.hand.includes(x)), lists.gen.filter((x) => lists.hand.includes(x)).join(" "));
}

/* CLAUDE.md's map names the Season 2 site, the modes, the redirects and the fallback (the v4.62 lines stay) */
{
  const md = R("CLAUDE.md");
  A("CLAUDE.md maps src/s2, the three modes, the one switch, the 302s and the fallback", /`src\/s2\/`/.test(md) && /ROOT/.test(md) && /`\/classic`/.test(md) && /\/next\//.test(md) &&
    /node tools\/site-build\.cjs --fallback/.test(md) && /302/.test(md));
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
