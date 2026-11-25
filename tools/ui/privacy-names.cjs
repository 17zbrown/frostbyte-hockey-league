/* v5.00 swap (j1): real member names (gamertags, display names, EA ids) must not enter the public repo through the
   Season 2 swap. COMMON.md: "Real member names ... must not be hard-coded in committed files."
     node tools/ui/privacy-names.cjs              lines this checkout would newly publish: the working tree against
                                                  its merge base with origin/main (added lines only) plus untracked
                                                  files git does not ignore
     node tools/ui/privacy-names.cjs --history    also every line added by a commit not on origin/main
   The names come from the PRIVATE denylist ~/Developer/cghl-private/privacy-denylist.txt (one per line, # comments),
   written by the main session; CGHL_DENYLIST overrides the path. A missing or empty list is an error, never a pass.
   Output names the file and line of each hit with the name MASKED (first letter plus asterisks), so a log never
   carries a name; it never prints the list. Exit 0 clean, 1 on any hit, 2 when it cannot check, 3 when a file on the
   CLEAN list below has a hit (tools/ui/run.cjs fails the run on 3 and on 2; a 1 only reports until the tree is clean).
   Names already on origin/main are out of scope: they are public before this swap, and only added lines are read.
   tools/s2-privacy.test.cjs reuses addedLines(), so "what the swap publishes" has one definition. */
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const REPO = path.resolve(__dirname, "../..");
const BASE = "origin/main";
const LIST = process.env.CGHL_DENYLIST || path.join(os.homedir(), "Developer/cghl-private/privacy-denylist.txt");
/* v5.00 swap (j2, 2026-11-24): files already cleaned of member names stay at zero while the other owners finish theirs,
   so a regression in one fails loudly instead of hiding among the report-only hits. The WHOLE file is read, not only
   its added lines. Checked: every entry must be a file in this tree (a typo would guard nothing), so a stream that
   deletes or renames one of these files edits this list in the same commit. Append a path once its owner has cleaned
   it; when the whole tree is clean, run.cjs gates on exit 1 and this list can go. */
/* i3f (2026-11-25): js/demo.js and js/pages/concept.js are deleted; the shell and the forms, which this change touched and
   which hold no name, take their places */
const CLEAN = ["src/s2/js/model.js", "src/s2/js/core.js", "src/s2/demo.html", "src/s2/js/flows.js"];

const git = (args) => execFileSync("git", ["-c", "core.quotePath=false"].concat(args), { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 30 });

function loadDenylist(file) {
  if (!fs.existsSync(file)) throw new Error("privacy-names: the denylist " + file + " is missing; the main session writes it (never commit it)");
  const names = fs.readFileSync(file, "utf8").split("\n").map((s) => s.trim()).filter((s) => s && s[0] !== "#");
  if (!names.length) throw new Error("privacy-names: the denylist " + file + " has no names");
  return names;
}

const mask = (s) => { const c = Array.from(s); return c[0] + "*".repeat(c.length - 1); };

/* a name counts only as a whole token: no letter or digit may touch either end ("Ace" never hits "Aces" or "Race") */
function nameMatcher(names) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const uniq = Array.from(new Set(names.map((n) => n.toLowerCase()))).sort((a, b) => b.length - a.length);
  return new RegExp("(?<![\\p{L}\\p{N}])(?:" + uniq.map(esc).join("|") + ")(?![\\p{L}\\p{N}])", "giu");
}

/* unified diff (-U0) to added lines {file, line, text, commit}; a "+++ " line is a header only right after "--- " */
function parseDiff(text, out) {
  let file = null, n = 0, commit = null, prev = "";
  for (const l of text.split("\n")) {
    if (/^commit [0-9a-f]{40}$/.test(l)) commit = l.slice(7);
    else if (l.startsWith("+++ ") && prev.startsWith("--- ")) file = l === "+++ /dev/null" ? null : l.slice(6);
    else if (l.startsWith("@@ ")) { const m = /\+(\d+)/.exec(l); n = m ? +m[1] : 0; }
    else if (l[0] === "+" && file !== null) out.push({ file, line: n++, text: l.slice(1), commit });
    prev = l;
  }
  return out;
}

/* every line this checkout would newly publish against origin/main; history adds each unpushed commit's lines */
function addedLines(opts) {
  opts = opts || {};
  try { git(["rev-parse", "--verify", "-q", BASE + "^{commit}"]); }
  catch (e) { throw new Error("privacy: no " + BASE + " ref in " + REPO + " (git fetch origin), so nothing can be compared"); }
  /* the merge base, not origin/main itself: once main moves on (v4.62 did, mid-run), a plain diff would count every
     line main changed since this branch left it as "added" here */
  const fork = git(["merge-base", BASE, "HEAD"]).trim();
  const out = parseDiff(git(["diff", "-U0", "--no-color", "--no-ext-diff", fork]), []);
  for (const f of git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)) {
    const st = fs.lstatSync(path.join(REPO, f));
    if (!st.isFile()) continue;   /* a link or socket publishes no text of its own; s2-privacy checks paths */
    fs.readFileSync(path.join(REPO, f), "utf8").split("\n").forEach((text, i) => out.push({ file: f, line: i + 1, text, commit: null, untracked: true }));
  }
  if (opts.history) parseDiff(git(["log", "-p", "-U0", "--no-color", "--no-ext-diff", "--format=commit %H", BASE + "..HEAD"]), out);
  return out;
}

/* hits as {file, line, commit, masked}; the name itself never leaves this function */
function scanNames(lines, names) {
  const re = nameMatcher(names), hits = [];
  for (const l of lines) { re.lastIndex = 0; let m; while ((m = re.exec(l.text))) hits.push({ file: l.file, line: l.line, commit: l.commit, masked: mask(m[0]) }); }
  return hits;
}

/* every line of each CLEAN file, as addedLines() shapes them; a listed path that is not a file is an error, never a pass */
function cleanLines(list) {
  const gone = list.filter((f) => { try { return !fs.statSync(path.join(REPO, f)).isFile(); } catch (e) { return true; } });
  if (gone.length) throw new Error("privacy-names: the CLEAN list names " + gone.join(", ") + ", not a file in " + REPO + "; whoever moved or deleted it updates CLEAN in tools/ui/privacy-names.cjs");
  return list.flatMap((f) => fs.readFileSync(path.join(REPO, f), "utf8").split("\n").map((text, i) => ({ file: f, line: i + 1, text, commit: null })));
}

module.exports = { REPO, BASE, LIST, CLEAN, git, loadDenylist, mask, nameMatcher, parseDiff, addedLines, cleanLines, scanNames };

if (require.main === module) {
  try {
    const history = process.argv.includes("--history");
    const names = loadDenylist(LIST), regress = scanNames(cleanLines(CLEAN), names);
    const hits = scanNames(addedLines({ history }), names);
    const where = (h) => h.file + ":" + h.line + (h.commit ? " (commit " + h.commit.slice(0, 7) + ")" : "");
    hits.forEach((h) => console.log("  " + where(h) + "  " + h.masked));
    const per = {};
    hits.forEach((h) => { const k = h.file + (h.commit ? " (history)" : ""); per[k] = (per[k] || 0) + 1; });
    const files = Object.keys(per).sort((a, b) => per[b] - per[a] || (a < b ? -1 : 1));
    if (files.length) { console.log("hits per file:"); files.forEach((f) => console.log("  " + String(per[f]).padStart(5) + "  " + f)); }
    const summary = hits.length ? "privacy-names: FAIL " + hits.length + " hit(s) in " + files.length + " file(s), names masked" + (history ? " (tree and history)" : " (tree)")
      : "privacy-names: no member name in what this checkout adds over " + BASE + (history ? " (tree and history)" : " (tree)");
    if (regress.length) {
      regress.forEach((h) => console.log("  CLEAN " + where(h) + "  " + h.masked));
      console.log(summary);
      /* the last line is what run.cjs shows */
      console.log("privacy-names: REGRESSION " + regress.length + " hit(s) in a file on the CLEAN list (" + Array.from(new Set(regress.map((h) => h.file))).join(", ") + "), names masked; it must stay at zero");
      process.exit(3);
    }
    console.log(summary + "; the " + CLEAN.length + " CLEAN file(s) hold none");
    process.exit(hits.length ? 1 : 0);
  } catch (e) { console.error(String(e && e.message || e)); process.exit(2); }
}
