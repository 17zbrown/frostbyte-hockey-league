/* v4.04 (commissioner, 2026-10-14: "maximize the efficiency of this project so I dont use up all of our netlify usage"):
   tools/netlify-ignore.sh decides whether a push builds. Exit 0 skips, exit 1 builds. It must skip only when every changed
   file is never served or bundled, and build in every case it cannot be sure of. Run against a throwaway git repo. */
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync, spawnSync } = require("child_process");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const script = path.join(__dirname, "netlify-ignore.sh");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nlfy-"));
const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
const commit = (files) => { for (const f of files) put(f, f + Math.random()); git("add", "-A"); git("commit", "-q", "-m", "c"); return git("rev-parse", "HEAD"); };
const run = (base, head) => spawnSync("sh", [script], { cwd: dir, env: { ...process.env, CACHED_COMMIT_REF: base, COMMIT_REF: head }, encoding: "utf8" });
const c0 = commit(["src/live/part_live.js", "netlify.toml", "sql/a.sql", "bot/handlers.mjs", "bot/role-sync.mjs"]);
const cSql = commit(["sql/b.sql", "tools/x.test.cjs", "docs/notes.md", ".github/workflows/w.yml"]);
A("only records, tools, docs and workflows changed -> skip", run(c0, cSql).status === 0, run(c0, cSql).stdout);
const cBot = commit(["bot/role-sync.mjs", "bot/ea-poll.mjs"]);
A("only the VM bot's own files changed -> skip", run(cSql, cBot).status === 0);
const cBundled = commit(["bot/handlers.mjs"]);
A("bot/handlers.mjs is bundled into discord-sync -> build", run(cBot, cBundled).status === 1);
const cNotices = commit(["bot/club-notices.mjs"]);
A("bot/club-notices.mjs is bundled too -> build", run(cBundled, cNotices).status === 1);
const cSite = commit(["src/live/part_live.js", "sql/c.sql"]);
A("any site file among them -> build", run(cNotices, cSite).status === 1);
const cToml = commit(["netlify.toml"]);
A("netlify.toml -> build", run(cSite, cToml).status === 1);
const cShared = commit(["shared/roles.mjs"]);
A("shared/ is bundled into functions -> build", run(cToml, cShared).status === 1);
const cSpace = commit(["docs/a b.md"]);
A("a path with a space under docs/ -> skip", run(cShared, cSpace).status === 0);
const cOther = commit(["LG/x y.pdf"]);
A("an unknown path, even with a space -> build", run(cSpace, cOther).status === 1);
A("no earlier deploy -> build", run("", cOther).status === 1);
A("the same commit -> build", run(cOther, cOther).status === 1);
A("an unknown base commit -> build", run("0123456789abcdef0123456789abcdef01234567", cOther).status === 1);
const toml = fs.readFileSync(path.join(__dirname, "..", "netlify.toml"), "utf8");
A("netlify.toml runs it as the ignore command", /^\s*ignore = "sh tools\/netlify-ignore\.sh"$/m.test(toml));
A("the preview copy is no longer built on Netlify", /^\s*command = "node src\/live\/build\.cjs index\.html"$/m.test(toml) && !/^\s*command = .*preview/m.test(toml));
A("the dead functions and their routes are gone", ["discord-join", "nhl-stats", "parse-screenshots"].every((f) => !fs.existsSync(path.join(__dirname, "..", "netlify/functions", f + ".js"))) &&
  !/api\/parse-screenshots|api\/discord-join/.test(toml));
fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
