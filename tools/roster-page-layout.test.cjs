/* v3.28 — the Team HQ roster page: the roster directly under the cap boxes, and a cap outlook that
 * fills its own box.
 *
 * Commissioner, 2026-09-25, with a screenshot: "Make this module on the team HQ Roster page more
 * intuitive. Either fill the space better or shrink the box. I also want the actual roster to appear
 * directly under the active payroll, cap space, and salary cap boxes."
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 240))); }
}
const hub = R("src/live/part6_hub.js"), head = R("src/live/part1_head.html");
const body = hub.slice(hub.indexOf("CG.hubRoster = function"), hub.indexOf("CG.renderCapOutlook"));
const at = (s) => body.indexOf(s);
/* which variable a section is appended to decides where it PRINTS, not where it is written */
const target = (marker) => {
  const i = at(marker); if (i < 0) return "(missing)";
  const stmt = body.slice(body.lastIndexOf("\n", i), i).trim();
  return stmt.startsWith("tail") ? "tail" : stmt.startsWith("h") ? "h" : "?";
};

console.log("\n— the roster prints directly under the cap boxes");
{
  A("the KPI row is still built first", at("Salary cap</span></div></div>") > 0);
  A("a tail is declared right after it",
    at("var tail = \"\";") > at("Salary cap</span></div></div>"));
  A("the roster table prints in place", target("<h3>Roster — ") === "h");
  A("the cap outlook is deferred to the tail", target('id="capOutlookCard"') === "tail");
  A("...and so is Squads", target("<h3>Squads</h3>") === "tail");
  A("...and Game limits", target("<h3>Game limits</h3>") === "tail");
  A("the tail is flushed after the roster",
    at("h += tail;") > at("<h3>Roster — "), "tail flush at " + at("h += tail;") + ", roster at " + at("<h3>Roster — "));
  /* slice on whole LINES: `<h3>Roster — ` sits mid-line, and cutting there leaves the roster's own
     `h += '<div class="card">...` at the end of the slice, which reads as a stray append */
  const lines = body.split("\n");
  const iTail = lines.findIndex((l) => l.includes('var tail = ""'));
  const iRos  = lines.findIndex((l) => l.includes("<h3>Roster — "));
  const between = lines.slice(iTail + 1, iRos).filter((l) => /^\s*h\s*\+=/.test(l));
  A("nothing else still prints between the cap boxes and the roster", between.length === 0,
    between.map((l) => l.trim().slice(0, 80)).join(" | "));
  A("...and everything that used to sit there now goes to the tail",
    lines.slice(iTail + 1, iRos).filter((l) => /^\s*tail\s*\+=/.test(l)).length === 5);
}

console.log("\n— the cap outlook fills its box when there is one season to show");
{
  const CG = { fmt: (k) => (k === "extensions" ? false : null), fmtMoney: (v) => "$" + (v / 1e6).toFixed(2) + "M" };
  const store = { innerHTML: "" };
  const doc = { getElementById: (id) => (id === "capOutlookBody" ? store : null) };
  const src = hub.slice(hub.indexOf("CG.renderCapOutlook = function"), hub.indexOf("CG.AFTER._roster"));
  new Function("CG", "esc", "document", src)(CG, (x) => String(x), doc);

  const one = [{ season: 1, current: true, space: 17250000, committed: 32750000, management: 2000000,
                 expiring_after: 30750000, deals: Array.from({ length: 19 }, (_, k) => ({ name: "P" + k, final: true })) }];
  CG.renderCapOutlook(one);
  A("one season renders the full-width layout", /class="cap-solo"/.test(store.innerHTML));
  A("...and not a four-column grid with three empty columns", !/grid g4/.test(store.innerHTML));
  A("...with the four figures across the top",
    (store.innerHTML.match(/cs-figs/g) || []).length === 1 && (store.innerHTML.match(/<div><b class="num"/g) || []).length === 4);
  A("...and the expiring deals in their own block", /cs-off/.test(store.innerHTML));
  A("the cap-space figure still carries its own color", /var\(--green\)/.test(store.innerHTML));
  CG.renderCapOutlook([{ season: 1, current: true, space: -1000000, committed: 1, management: 0, expiring_after: 0, deals: [] }]);
  A("...red when a club is over", /var\(--red\)/.test(store.innerHTML));
  A("no expiring block when nothing expires", !/cs-off/.test(store.innerHTML));

  CG.fmt = (k) => (k === "extensions" ? true : null);
  CG.renderCapOutlook([1, 2, 3, 4].map((s) => ({ season: s, current: s === 1, space: 1e6, committed: 1e6, management: 0, expiring_after: 0, deals: [] })));
  A("several seasons still render as the four-across grid",
    /grid g4/.test(store.innerHTML) && !/cap-solo/.test(store.innerHTML));
  A("an empty outlook still says so, rather than rendering an empty box",
    (CG.renderCapOutlook([]), /No outlook yet/.test(store.innerHTML)));
}

console.log("\n— the CSS");
{
  A(".cap-solo lays its figures out across the width",
    /\.cap-solo \.cs-figs\{display:grid;gap:12px;grid-template-columns:repeat\(auto-fit,minmax\(150px,1fr\)\)\}/.test(head));
  A("...with min-width:0 so a long figure cannot push the row wide", /\.cap-solo \.cs-figs>div\{[^}]*min-width:0/.test(head));
  A("...and two up on a phone", /@media \(max-width:560px\)\{ \.cap-solo \.cs-figs\{grid-template-columns:repeat\(2,1fr\)\} \}/.test(head));
  A("the expiring list is set apart, not shouted in mono", /\.cap-solo \.cs-off\{padding:12px 14px;border:1px dashed/.test(head));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
