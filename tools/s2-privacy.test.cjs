/* v5.00 swap (j1): nothing private rides the Season 2 swap into the public repo. Run: node tools/s2-privacy.test.cjs
   PLAN 6.8: the tree AND every commit not on origin/main must carry no concept data or deploy state (snapshot.js,
   src/s2/data, src/s2/assets, src/s2/site, share.html, share-files.json, .site-id), no JWT whose role is not anon, no
   Supabase secret key, no Discord webhook URL and no 17 to 19 digit Discord snowflake. This file spells none of
   them literally (its own added lines are scanned too), so the patterns and samples are assembled at run time.
   Scope: paths are checked over the whole tree (tracked, plus untracked files git does not ignore) and every path an
   unpushed commit touched; text is checked over what this checkout ADDS over origin/main (tools/ui/privacy-names.cjs
   addedLines: the working tree's added lines, untracked files, and each unpushed commit's added lines). Text already on
   origin/main is out of scope: it is public before this swap, and some of it holds snowflakes (docs, sql records).
   Real member names are checked separately by tools/ui/privacy-names.cjs, against a private list npm test cannot read.
   A hit prints its kind, file, line and commit, never the matched value. */
const P = require("./ui/privacy-names.cjs");
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more === undefined ? "" : "  " + JSON.stringify(more))); if (!cond) fails++; };

/* the same pattern as the pre-push hook (.git/hooks/pre-push in ~/Developer/cghl-swap), plus share-files.json */
const PRIVATE_PATH = /(^|\/)snapshot\.js$|^src\/s2\/(data|assets|site)(\/|$)|^src\/s2\/share(\.html|-files\.json)$|(^|\/)\.site-id$/;
const SNOWFLAKE = /(^|[^0-9])[0-9]{17,19}([^0-9]|$)/;
const WEBHOOK = /discord(app)?\.com\/api\/webhooks\//i;
/* 2026-11-24 (main session): a real Supabase secret key is the prefix plus a long key body; the bare prefix inside a
   test's own "never a secret key" pattern is not a key and was flagged (tools/ui/live-model.test.cjs). Matching the body
   still catches every real key. */
const SECRET = new RegExp("sb_" + "secret_[A-Za-z0-9_-]{20,}");
const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]*)?/g;
const jwtRole = (t) => { try { return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8")).role || "(no role)"; } catch (e) { return "(unreadable)"; } };

/* findings in text, as kinds; a line is scanned once for each pattern */
function textFindings(text) {
  const out = [];
  if (SNOWFLAKE.test(text)) out.push("snowflake");
  if (WEBHOOK.test(text)) out.push("webhook URL");
  if (SECRET.test(text)) out.push("secret key");
  for (const t of text.match(JWT) || []) { const r = jwtRole(t); if (r !== "anon") out.push("JWT role " + r); }
  return out;
}

console.log("## self-checks (synthetic values only)");
A("a 17, 18 and 19 digit run is a snowflake", ["x " + "7".repeat(17) + " y", "8".repeat(18), "id:" + "9".repeat(19) + ","].every((s) => textFindings(s).includes("snowflake")));
A("a 13 digit EA match id, a 16 and a 20 digit run are not", ["2790592930067", "1234567890123456", "12345678901234567890"].every((s) => !textFindings(s).includes("snowflake")));
const fakeJwt = (role) => "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".sig";
A("an anon JWT passes, a service_role or authenticated JWT does not", textFindings(fakeJwt("anon")).length === 0
  && textFindings(fakeJwt("service_role"))[0] === "JWT role service_role" && textFindings(fakeJwt("authenticated"))[0] === "JWT role authenticated");
const HOOK = "/api/web" + "hooks/x/y";
A("webhook URLs and Supabase secret keys are found", textFindings("https://discord.com" + HOOK)[0] === "webhook URL"
  && textFindings("https://discordapp.com" + HOOK)[0] === "webhook URL" && textFindings("k = 'sb_" + "secret_" + "Ab3x".repeat(8) + "'")[0] === "secret key"
  && textFindings("/sb_" + "secret_|eyJ/.test(src)").length === 0);
A("the private paths match, their neighbors do not", ["src/s2/data/snapshot.js", "data/snapshot.js", "src/s2/assets", "src/s2/assets/logos/x.png",
  "src/s2/site/index.html", "src/s2/share.html", "src/s2/share-files.json", "src/s2/.site-id"].every((p) => PRIVATE_PATH.test(p))
  && ["src/s2/js/data.js", "src/s2/assetsx", "src/s2/sharer.html", "tools/ui/run.cjs"].every((p) => !PRIVATE_PATH.test(p)));
const diff = ["commit " + "a".repeat(40), "diff --git a/x.js b/x.js", "--- a/x.js", "+++ b/x.js", "@@ -1,0 +5,2 @@", "+one", "++++ two",
  "diff --git a/y b/y", "--- a/y", "+++ /dev/null", "@@ -1 +0,0 @@", "-gone"].join("\n");
const parsed = P.parseDiff(diff, []);
A("the diff reader keeps file, line and commit, and a '+++' content line is content", parsed.length === 2 && parsed[0].file === "x.js"
  && parsed[0].line === 5 && parsed[1].line === 6 && parsed[1].text === "+++ two" && parsed[0].commit === "a".repeat(40), parsed);
const re = P.nameMatcher(["Zed_Qx7", "Mo Lark"]);
A("a name matches as a whole token in any case, never inside a longer word", ["by zed_qx7.", "(MO LARK)", "x Zed_Qx7"].every((s) => { re.lastIndex = 0; return re.test(s); })
  && ["Zed_Qx77", "aZed_Qx7", "Mo Larks"].every((s) => { re.lastIndex = 0; return !re.test(s); }));
A("the names report masks to the first letter plus asterisks", P.mask("Zed_Qx7") === "Z******"
  && P.scanNames([{ file: "f", line: 3, text: "hi Zed_Qx7", commit: null }], ["Zed_Qx7"])[0].masked === "Z******");
/* v5.00 swap (j2): the CLEAN list (files already cleaned of member names) is checked without the private list, and a
   hit in one exits 3, which tools/ui/run.cjs turns into a failed run; a synthetic one-word list stands in for the names */
const cleanErr = (() => { try { P.cleanLines(["src/s2/js/no-such-file.js"]); return null; } catch (e) { return String(e.message); } })();
A("a CLEAN entry that is not a file is an error, never a pass", /no-such-file\.js, not a file/.test(cleanErr || ""), cleanErr);
const cl = P.cleanLines(P.CLEAN);
A("every CLEAN entry is a file in the tree and is read whole", P.CLEAN.length >= 4 && P.CLEAN.every((f) => cl.some((l) => l.file === f && l.line === 1))
  && cl.filter((l) => l.file === P.CLEAN[0]).length === require("fs").readFileSync(require("path").join(P.REPO, P.CLEAN[0]), "utf8").split("\n").length, P.CLEAN);
const os = require("os"), fs = require("fs"), path = require("path");
const fakeList = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cghl-names-")), "list.txt");
fs.writeFileSync(fakeList, "# synthetic\npointsLeader\n");   /* a word src/s2/js/model.js (on the CLEAN list) carries */
const run = require("child_process").spawnSync(process.execPath, [path.join(__dirname, "ui/privacy-names.cjs")], { encoding: "utf8", env: Object.assign({}, process.env, { CGHL_DENYLIST: fakeList }) });
const last = String(run.stdout).trim().split("\n").pop();
A("a hit in a CLEAN file exits 3 with a REGRESSION last line that names the file and masks the word", run.status === 3 && /^privacy-names: REGRESSION \d+ hit/.test(last)
  && last.includes("src/s2/js/model.js") && !/pointsLeader/.test(run.stdout) && /CLEAN src\/s2\/js\/model\.js:\d+  p\*{11}/.test(run.stdout), { status: run.status, last, err: run.stderr });
fs.rmSync(path.dirname(fakeList), { recursive: true, force: true });

console.log("## the tree and every commit not on " + P.BASE);
const tracked = P.git(["ls-files", "-z"]).split("\0").filter(Boolean);
const untracked = P.git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
const touched = P.git(["log", "--format=", "--name-only", "--no-renames", P.BASE + "..HEAD"]).split("\n").filter(Boolean);
A("the tree is real (more than 500 tracked files, so an emptied index cannot pass)", tracked.length > 500, tracked.length);
const badPaths = Array.from(new Set(tracked.concat(untracked, touched))).filter((p) => PRIVATE_PATH.test(p));
A("no concept data, logos, site copy, share copy or deploy state is tracked, unignored or in an unpushed commit", badPaths.length === 0, badPaths);
const mustIgnore = ["src/s2/data/snapshot.js", "src/s2/assets", "src/s2/site/index.html", "src/s2/share.html", "src/s2/share-files.json", "src/s2/.site-id", "snapshot.js"];
const ignored = P.git(["check-ignore", "--no-index"].concat(mustIgnore)).split("\n").filter(Boolean);
A("git ignores every private path, the assets link included", mustIgnore.every((p) => ignored.includes(p)), mustIgnore.filter((p) => !ignored.includes(p)));

const lines = P.addedLines({ history: true });
A("the added lines were read (the swap adds src/s2)", lines.some((l) => l.file.startsWith("src/s2/")), lines.length);
const hits = [];
for (const l of lines) for (const kind of textFindings(l.text)) hits.push(kind + " at " + l.file + ":" + l.line + (l.commit ? " (commit " + l.commit.slice(0, 7) + ")" : ""));
A("no snowflake, webhook URL, Supabase secret key or non-anon JWT in anything this checkout adds", hits.length === 0, hits.slice(0, 40));

console.log(fails ? "\nFAIL (" + fails + ")" : "\nPASS");
process.exit(fails ? 1 : 0);
