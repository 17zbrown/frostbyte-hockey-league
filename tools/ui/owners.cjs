/* v5.00 swap (W0.5): the merge check's ownership gate. Reads paths on stdin, one per line, and exits 1 if any is not
   owned by the named agent today (tools/ui/owners.json: longest matching key, LAST dated entry is the current owner).
     git diff --name-only s2-swap...s2/<agent> | node tools/ui/owners.cjs <agent>
     node tools/ui/owners.cjs --check   every tracked file under src/s2 and tools/ui has an owner; the file is well formed */
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, "owners.json"), "utf8")).paths;
const keys = Object.keys(MAP);

function ownerOf(p) {
  let best = MAP[p] ? p : null;
  if (!best) for (const k of keys) if (k.endsWith("/") && p.startsWith(k) && (!best || k.length > best.length)) best = k;
  return best ? MAP[best][MAP[best].length - 1].owner : null;
}

const arg = process.argv[2];
if (!arg) { console.error("usage: node tools/ui/owners.cjs <agent> < paths  |  node tools/ui/owners.cjs --check"); process.exit(2); }
const owners = new Set(keys.map((k) => ownerOf(k)));

if (arg === "--check") {
  let bad = 0;
  for (const k of keys) {
    const list = MAP[k];
    if (!Array.isArray(list) || !list.length) { console.log("FAIL " + k + ": no entries"); bad++; continue; }
    let prev = "";
    for (const e of list) {
      if (!e.owner || !/^\d{4}-\d{2}-\d{2}$/.test(e.since || "") || !e.why) { console.log("FAIL " + k + ": entry needs owner, since (YYYY-MM-DD) and why"); bad++; }
      if (e.since < prev) { console.log("FAIL " + k + ": entries out of date order"); bad++; }
      prev = e.since;
    }
  }
  const repo = path.resolve(__dirname, "../..");
  const tracked = execFileSync("git", ["ls-files", "src/s2", "tools/ui"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const f of tracked) if (!ownerOf(f)) { console.log("FAIL unowned: " + f); bad++; }
  console.log(bad ? bad + " problem(s)" : "owners.json OK: " + keys.length + " paths, " + tracked.length + " tracked files owned, owners " + [...owners].sort().join(" "));
  process.exit(bad ? 1 : 0);
}

if (!owners.has(arg)) { console.error("owners.cjs: no path is owned by \"" + arg + "\" (owners: " + [...owners].sort().join(" ") + ")"); process.exit(2); }
const paths = fs.readFileSync(0, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
if (!paths.length) { console.error("owners.cjs: no paths on stdin"); process.exit(2); }
let bad = 0;
for (const p of paths) { const o = ownerOf(p); if (o !== arg) { console.log("NOT " + arg + "'s: " + p + " (" + (o ? "owner " + o : "no owner") + ")"); bad++; } }
console.log(bad ? bad + " of " + paths.length + " path(s) outside " + arg + "'s ownership" : "all " + paths.length + " path(s) are " + arg + "'s");
process.exit(bad ? 1 : 0);
