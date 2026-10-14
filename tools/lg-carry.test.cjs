/* v4.03: a delta rebuild of the league (every game final, server pick, code change or roster change on a game night)
   replaces CG.lg and carries the manager state across through CG._LG_CARRY. Six fields that loadManagerData sets were
   missing (saved lines, night plan, cap exceptions, playoff floors, replacement signings, the sign-up load error), so a
   manager's lines vanished and the Sign button closed after every final. This fails if any field loadManagerData, or any
   other code outside the league build, puts on CG.lg is not carried. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got ? "  got: " + JSON.stringify(got) : "")); } };
const live = R("src/live/part_live.js");
const carry = new Set((live.match(/CG\._LG_CARRY = \[([\s\S]*?)\];/) || [, ""])[1].match(/"([^"]+)"/g).map((x) => x.slice(1, -1)));
const bi = live.indexOf("CG.buildLiveLeague = "), bj = live.indexOf("\n};\n", bi);
const missing = [];
for (const f of ["src/live/part_live.js", "src/live/part6_hub.js", "src/live/part9_staffdesks.js", "src/live/part5a_public.js", "src/live/part5b_public2.js", "src/live/part7_admin.js"]) {
  const t = R(f), re = /CG\.lg\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/g; let m;
  while ((m = re.exec(t))) {
    if (f === "src/live/part_live.js" && m.index >= bi && m.index <= bj) continue;   // the build itself makes these
    if (!carry.has(m[1]) && !missing.includes(m[1])) missing.push(m[1]);
  }
}
A("every field set on CG.lg outside the league build is carried across a delta rebuild", missing.length === 0, missing);
A("the six fields found missing on 2026-10-14 are carried", ["_teamLines", "_linePlan", "capExceptions", "playoffFloors", "_replacements", "_regLoadError"].every((k) => carry.has(k)));
console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
