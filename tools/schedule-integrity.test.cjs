// exercise CG.scheduleIssues in isolation against the real implementation
const fs = require("fs");
const src = fs.readFileSync("src/live/part_live.js", "utf8");
const CG = { SEASON:null, lg:null };
CG.etYMD = (iso) => new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date(iso));
CG.fmtDate = (s) => s;
// pull just the scheduleIssues body out of the source so we test the shipped code, not a copy
const m = src.match(/CG\.scheduleIssues = function\(\)\{[\s\S]*?\n\};/);
if (!m) { console.error("could not locate CG.scheduleIssues"); process.exit(1); }
eval(m[0]);

const D = (s) => Date.parse(s);
const mk = (stage, iso) => ({ stage, at: D(iso) });

function run(label, season, schedule, expectCount) {
  CG.SEASON = season; CG.lg = { schedule };
  const out = CG.scheduleIssues();
  const pass = out.length === expectCount;
  console.log(`${pass ? "ok  " : "FAIL"} ${label} -> ${out.length} issue(s)`);
  out.forEach(t => console.log("        · " + t));
  return pass;
}

let ok = true;
// the real, corrected production shape
ok &= run("production (re-anchored)", {
  preseason_starts_at:"2026-09-16T21:00:00-04:00", draft_at:"2026-09-26T19:00:00-04:00", starts_at:"2026-10-07T21:00:00-04:00"
}, [mk("preseason","2026-09-16T21:00:00-04:00"), mk("preseason","2026-09-25T22:10:00-04:00"),
    mk("regular","2026-10-07T21:00:00-04:00"),  mk("regular","2026-12-04T22:10:00-04:00")], 0);

// the exact bug this shipped to catch
ok &= run("the bug we just fixed", {
  preseason_starts_at:"2026-09-16T21:00:00-04:00", draft_at:"2026-09-26T19:00:00-04:00", starts_at:"2026-10-07T21:00:00-04:00"
}, [mk("preseason","2026-09-23T21:00:00-04:00"), mk("preseason","2026-10-02T22:10:00-04:00"),
    mk("regular","2026-10-07T21:00:00-04:00")], 2);   // wrong start + runs past draft (it did NOT overlap the season)

ok &= run("regular season drifted from puck drop", {
  preseason_starts_at:"2026-09-16T21:00:00-04:00", draft_at:"2026-09-26T19:00:00-04:00", starts_at:"2026-10-07T21:00:00-04:00"
}, [mk("preseason","2026-09-16T21:00:00-04:00"), mk("preseason","2026-09-25T22:10:00-04:00"),
    mk("regular","2026-10-14T21:00:00-04:00")], 1);

ok &= run("pre-season overlapping the season", {
  preseason_starts_at:"2026-09-16T21:00:00-04:00", draft_at:"2026-09-26T19:00:00-04:00", starts_at:"2026-10-07T21:00:00-04:00"
}, [mk("preseason","2026-09-16T21:00:00-04:00"), mk("preseason","2026-10-09T22:10:00-04:00"),
    mk("regular","2026-10-07T21:00:00-04:00")], 2);

ok &= run("no schedule yet", { preseason_starts_at:"2026-09-16T21:00:00-04:00" }, [], 0);

process.exit(ok ? 0 : 1);
