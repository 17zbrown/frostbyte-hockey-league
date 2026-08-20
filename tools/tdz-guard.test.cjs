/* The temporal-dead-zone guard for discord-sync's `sum`.
   Run: node tools/tdz-guard.test.cjs

   This bug has now shipped TWICE. `sum` is a `const` declared partway down the request handler,
   and a dozen blocks report into it. Put a block even one line above the declaration and you get
   "Cannot access 'sum' before initialization" — which throws from the body AND again from the
   catch that tries to record the error, killing the entire sweep. Roles, welcomes, departures and
   channel locks all stop, every five minutes, silently.

   `node --check` does NOT catch it: a TDZ violation is a runtime error, not a syntax error, so the
   file parses cleanly while production dies. That is exactly what happened both times.

   The check is scope-aware on purpose: ~120 textual uses of `sum.` sit above the declaration in
   OTHER functions that take it as a parameter, so a naive "does sum. appear earlier" scan reports
   a false failure. Only uses inside the declaring function count. */
const fs = require("fs"), path = require("path");
const lines = fs.readFileSync(path.join(__dirname, "..", "netlify/functions/discord-sync.js"), "utf8").split("\n");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const declIdx = lines.findIndex((l) => /const sum = \{ checked/.test(l));
A("located the sum declaration", declIdx > -1);
if (declIdx < 0) process.exit(1);

let start = 0;
for (let i = declIdx; i >= 0; i--) {
  if (/^(export |const |async function |function )/.test(lines[i]) && /[({]\s*$/.test(lines[i])) { start = i; break; }
}
A("located the declaring scope", start > 0, "line " + (start + 1));

const offenders = [];
lines.slice(start, declIdx).forEach((l, i) => {
  if (/\bsum\./.test(l)) offenders.push(`line ${start + i + 1}: ${l.trim().slice(0, 80)}`);
});
A("nothing in the handler touches `sum` before it is declared", offenders.length === 0, offenders.join(" | "));

/* the two blocks that have actually caused this, pinned by position */
const rightsIdx = lines.findIndex((l) => /Rights classes \(Rule 2\.2\)/.test(l));
A("the rights block sits below the declaration", rightsIdx === -1 || rightsIdx > declIdx,
  rightsIdx > -1 ? `rights at ${rightsIdx + 1}, decl at ${declIdx + 1}` : "block not found");
const everyoneIdx = lines.findIndex((l) => /@everyone\/@here stays with the league office/.test(l));
A("the @everyone block sits below it too", everyoneIdx === -1 || everyoneIdx > declIdx);

A("the declaration still carries the warning for the next reader",
  lines.slice(declIdx, declIdx + 14).join("\n").includes("temporal dead zone") ||
  lines.slice(declIdx, declIdx + 14).join("\n").includes("temporal-dead-zone"));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
