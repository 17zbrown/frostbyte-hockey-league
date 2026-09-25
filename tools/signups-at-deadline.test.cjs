/* v3.29 — next season's sign-ups open when the movement deadline passes.
 *
 * Commissioner: "Can you set the season 2 signups to open just after the trade deadline as well as
 * open owner applications as well?"
 *
 * The flip is a database function rehearsed against the live schema. This file pins the client half
 * (owner applications following the registering season) and the decision record.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 240))); }
}
const live = R("src/live/part_live.js"), rec = R("sql/2026-09-25-signups-open-at-the-deadline.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
const content = R("src/live/part3_content.js");
const rb = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).rulebook;
const sec = (id) => { for (const c of rb.chapters) for (const s of c.sections) if (s.id === id) return s.paragraphs.join(" "); return ""; };

console.log("\n— owner applications follow the season taking sign-ups, so they need no separate switch");
{
  A("the page reads the registering season, not the season being played",
    /var s = \(CG\.regSeason && CG\.regSeason\(\)\) \|\| CG\.SEASON \|\| \{\};\s*\/\* owner applications are for the season taking sign-ups \*\//.test(live));
  A("CG.regSeason is the season with sign-ups open",
    /CG\.regSeason = function\(\)\{[\s\S]{0,200}return \(CG\.SEASONS\|\|\[\]\)\.find\(function\(s\)\{ return s\.registration_open; \}\)/.test(live));
  A("...and the close is that season's own deadline",
    /var deadlineClosed = !!\(s\.owner_app_deadline && Date\.parse\(s\.owner_app_deadline\) <= CG\.now\(\)\);/.test(live));
  A("the submit path checks it again rather than trusting the page",
    /if\(_s\.owner_app_deadline && Date\.parse\(_s\.owner_app_deadline\) <= CG\.now\(\)\)\{ CG\.toast\("Owner applications closed on /.test(live));
}

console.log("\n— the published rule, which the code now matches instead of contradicting");
{
  A("Rule 1.1 ties registration to the movement deadline",
    /Registration for a season ends when the following season's registration opens, which occurs automatically when the current season's movement deadline passes/.test(sec("1.1")));
  A("Chapter 0 says the same at the rollover",
    /Registration for the following season opens automatically when the current season's movement deadline passes/.test(sec("0.9")));
}

console.log("\n— the record");
{
  A("it quotes the instruction", /open just after the trade deadline/.test(flat));
  A("it says most of it was already built", /MOST OF THIS WAS ALREADY BUILT/.test(flat));
  A("...and names the cron job", /'season-status-flip'/.test(flat));
  A("THE TRAP: the schedule is in the database, not the repo",
    /A repo grep finds no caller, which is misleading/.test(flat) && /Check cron\.job before concluding an automation is dead/.test(flat));
  A("it quotes the condition that was wrong", />= s\.trade_deadline_week/.test(flat));
  A("...and why three days early", /Wed Oct 14/.test(flat) && /Sat Oct 17/.test(flat) && /three days early/.test(flat));
  A("it credits the rulebook for being right", /The rulebook was already right and the code disagreed with it/.test(flat));
  A("the override is deliberate, and said to be", /locking movement early opens the next sign-up early, on purpose/.test(flat));
  A("owner applications are explained as needing nothing", /OWNER APPLICATIONS NEEDED NOTHING/.test(flat));
  A("...with the line that makes it true", /var s = \(CG\.regSeason && CG\.regSeason\(\)\) \|\| CG\.SEASON \|\| \{\};/.test(flat));
  A("...and why they read closed today", /Season 1 is still the registering season/.test(flat));
  A("the dates are on the record", /Sat Oct 17 2026, 12:00 AM ET/.test(flat) && /Fri Jan 22 2027/.test(flat));
  A("both rehearsal directions are recorded", /with the deadline in the future nothing flips/.test(flat) && /Season 1 closes and Season 2 opens in the same pass/.test(flat));
  A("the four-month window is flagged and not silently changed",
    /FLAGGED TO THE COMMISSIONER, not changed/.test(flat) && /about four months/.test(flat));
  A("no em dash or spaced hyphen", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
