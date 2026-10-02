/* Every Netlify function is an ES module. package.json declares "type": "module", so Node loads every .js file
   in the repo as ESM, and Netlify's bundler (zip-it-and-ship-it 16.2, flag zisi_error_cjs_in_esm_scope, rolled
   out to this site in late Sep 2026) now refuses a CommonJS function file instead of shipping one that fails to
   load. netlify/functions/nhl-stats.js still said `exports.handler = ...`: every deploy from v3.76 (Oct 1) on
   failed at "Bundling of function nhl-stats", and the site stayed on v3.75. This pins the rule for every function
   file, present and future: a .js function uses import/export and no CommonJS; a CommonJS one must be named .cjs.
   FN_DIR overrides the folder (used to prove the test fails on the old tree). */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const DIR = process.env.FN_DIR || path.join(ROOT, "netlify", "functions");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };

/* code only: block comments, then line comments (a // right after ':' or a quote is a URL inside a string) */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
console.log("— the premise");
A("package.json declares \"type\": \"module\" (if this ever changes, revisit this test)", pkg.type === "module", pkg.type);

/* Netlify takes a function from a top-level file, or from a folder holding <name>.js/.mjs/.cjs or index.* */
const entries = [];
for (const e of fs.readdirSync(DIR, { withFileTypes: true })) {
  if (e.isFile() && /\.(js|mjs|cjs)$/.test(e.name)) entries.push(path.join(DIR, e.name));
  else if (e.isDirectory()) {
    for (const f of [e.name + ".js", e.name + ".mjs", e.name + ".cjs", "index.js", "index.mjs", "index.cjs"]) {
      const p = path.join(DIR, e.name, f);
      if (fs.existsSync(p)) { entries.push(p); break; }
    }
  }
}
console.log("— every function file (" + entries.length + ")");
A("the functions folder is found and holds functions", entries.length >= 10, entries.length);
for (const f of entries) {
  const rel = path.relative(DIR, f), src = code(fs.readFileSync(f, "utf8"));
  if (f.endsWith(".cjs")) { A(rel + ": named .cjs, so CommonJS is allowed", true); continue; }
  const cjs = [];
  if (/\bmodule\.exports\b/.test(src)) cjs.push("module.exports");
  if (/(^|[^.\w$])exports\.[A-Za-z_$][\w$]*\s*=/m.test(src)) cjs.push("exports.x =");
  if (/(^|[^.\w$])require\s*\(/m.test(src) && !/\bcreateRequire\b/.test(src)) cjs.push("require()");
  if (/(^|[^.\w$])__dirname\b|(^|[^.\w$])__filename\b/m.test(src)) cjs.push("__dirname/__filename");
  A(rel + ": no CommonJS (use import/export, or name the file .cjs)", cjs.length === 0, cjs.join(", "));
  A(rel + ": exports its entry point as ESM (export handler / export default)",
    /^\s*export\s+(const|let|var|async\s+function|function)\s+handler\b|^\s*export\s+default\b|^\s*export\s*\{[^}]*\b(handler|default)\b/m.test(src));
}

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
