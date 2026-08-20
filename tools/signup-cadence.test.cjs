/* The "not signed up" reminder fires every N days, not daily.
   Run: node tools/signup-cadence.test.cjs

   Two ways to get this wrong, both avoided deliberately:
     · keying the claim on the DATE (et.ymd) posts once per day — the original behaviour.
     · gating on `dayNum % N === 0` skips the ENTIRE window whenever the one 18:00 tick that
       would have fired is missed, turning a 3-day cadence into a 6-day one at random.
   Keying the claim on the WINDOW means the first successful run inside each window posts and
   every later run in that window is refused, so a missed tick just catches up the next evening.

   The day index comes off the ET calendar date rather than Date.now()/86400000, which drifts by
   an hour twice a year and could open a window early or late around a DST change. */
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "netlify/functions/discord-scheduler.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const m = src.match(/const etDayNum = \(ymd\) => \{[^}]*\};/);
A("located etDayNum", !!m);
if (!m) process.exit(1);
const etDayNum = new Function(m[0] + " return etDayNum;")();
const ref = (ymd, every) => `w${every}-${Math.floor(etDayNum(ymd) / every)}`;

console.log("— it fires every 3 days, evenly");
{
  const posts = []; let last = null;
  for (let d = 1; d <= 15; d++) {
    const ymd = "2026-09-" + String(d).padStart(2, "0");
    const r = ref(ymd, 3);
    if (r !== last) { posts.push(ymd); last = r; }
  }
  A("five posts across fifteen days", posts.length === 5, posts.join(" "));
  const gaps = posts.slice(1).map((p, i) => Math.round((Date.parse(p) - Date.parse(posts[i])) / 86400000));
  A("every gap is exactly three days", gaps.every((g) => g === 3), gaps.join(","));
}

console.log("\n— a missed tick catches up instead of skipping the window");
{
  /* the window covering Sep 4 is Sep 4-6; Sep 7 opens the next one */
  A("all three days of a window share one claim ref",
    ref("2026-09-04", 3) === ref("2026-09-05", 3) && ref("2026-09-05", 3) === ref("2026-09-06", 3));
  A("...so a tick missed on day one still posts on day two or three",
    ref("2026-09-04", 3) === ref("2026-09-06", 3));
  A("...and the following day opens a new window", ref("2026-09-07", 3) !== ref("2026-09-06", 3));
}

console.log("\n— the day index is calendar-based, so clocks cannot shift a window");
{
  /* Nov 1 2026 is the ET fall-back. A Date.now()-based index would wobble here. */
  const w = ["2026-10-31", "2026-11-01", "2026-11-02"].map((d) => ref(d, 3));
  A("the DST fall-back weekend stays inside one window", new Set(w).size === 1, w.join(" "));
  A("the year boundary does not reset the cadence",
    ref("2026-12-31", 3) === ref("2027-01-01", 3) && ref("2027-01-02", 3) !== ref("2027-01-01", 3));
  A("...and it is built from the ymd string, not Date.now()",
    /Date\.UTC\(y, m - 1, d\)/.test(m[0]) && !/Date\.now\(\)/.test(m[0]));
}

console.log("\n— wired into the job, and tunable without a deploy");
{
  A("the claim uses the window ref, not the date", /claim\("signup_reminder", windowRef\)/.test(src));
  A("...and so does the release, or a failed post would strand the window",
    /release\("signup_reminder", windowRef\)/.test(src));
  A("nothing still claims on et.ymd for this job", !/claim\("signup_reminder", et\.ymd\)/.test(src));
  A("the interval is a setting defaulting to 3",
    /parseInt\(cfg\.signup_reminder_days \|\| "3", 10\) \|\| 3/.test(src));
  A("...and can never be 0, which would divide by zero", /Math\.max\(1, parseInt\(cfg\.signup_reminder_days/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
