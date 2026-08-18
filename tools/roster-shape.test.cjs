/* Rule 2.1 — training camp sits BESIDE the seventeen, never inside it.
   Run: node tools/roster-shape.test.cjs

   Why this file exists: the rulebook says a club may carry up to three training-camp players
   "beyond its seventeen active spots", but every roster-space check counted all roster_spots
   rows — camp included — against roster_max. A club carrying 3 camp players had an effective
   14-man active roster: free agency, rookie bids, the Sign button and automatic placement all
   told them they were full three players early.

   Worse, the trigger that decides where a NEW signing lands still used the pre-v2.7 shape
   (forwards 6, defense 4 — twelve players), so a club's 7th forward or 5th defenseman was
   silently diverted into training camp with an active spot standing empty.

   Rehearsed against production and rolled back:
     · a complete 17-man shape now lands entirely on the active roster (active=17, camp=0)
     · an 18th player at a full position is parked in camp (active=17, camp=1)
     · calling him up is refused by check_roster_structure with the Rule 2.1 message
     · pro_roster_count reports 17 of 17 while 18 rows sit on file
   (check_roster_structure_trg is DEFERRABLE INITIALLY DEFERRED — it never fires inside a
    rolled-back DO block unless you SET CONSTRAINTS ... IMMEDIATE first.) */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const live = R("src/live/part_live.js");
const hub = R("src/live/part6_hub.js");
const pub = R("src/live/part5a_public.js");
const engine = R("src/live/part2_engine.js");
const content = R("src/live/part3_content.js");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the rulebook is the authority, and it says 'beyond'");
{
  const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
  const sec = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" "); throw new Error("no " + id); };
  const r21 = sec("2.1");
  A("camp is carried BEYOND the seventeen active spots",
    /up to three \(3\) training-camp players beyond its seventeen active spots/.test(r21));
  A("...and the active roster is the exact 17-man shape",
    /three \(3\) centers, three \(3\) left wings, three \(3\) right wings, three \(3\) left defensemen, three \(3\) right defensemen, and two \(2\) goaltenders/.test(r21));
}

console.log("\n— every client roster count excludes training camp");
{
  /* three separate sites counted byTeam wholesale; each one is a place a manager was told
     "full" while an active spot sat empty */
  const counts = live.match(/\(lg\.byTeam(?:&&lg\.byTeam)?\[?[^\]]*\]?\|\|\[\]\)\.filter\(function\(p\)\{ return p\.squad!=="tc"; \}\)\.length/g) || [];
  A("the manager dashboard, the free-agency desk and the random assigner all filter camp out",
    counts.length === 3, counts.length + " sites");
  A("no client site counts the raw roster length against the cap any more",
    !/var rosterN=\(lg\.byTeam(&&lg\.byTeam)?\[[^\]]*\]\|\|\[\]\)\.length/.test(live) &&
    !/counts\[t\.code\]=\(lg\.byTeam\[t\.code\]\|\|\[\]\)\.length;/.test(live));
  A("the Squad Room already used the real 17-man shape and still does",
    /cap = grp==="G"\?2:grp==="D"\?6:9/.test(hub));
  A("...counting only pro players toward it", /x\.squad!=="tc" && CG\.posGroup\(x\.pos\)===grp/.test(hub));
  A("...and camp itself is capped at three", /x\.squad==="tc"; \}\)\.length < 3/.test(hub));
}

console.log("\n— the roster size fallbacks tell the truth (17, not the pre-v2.7 12/15)");
{
  A("no stale ||15 fallback survives in the live bundle",
    !/roster_max\|\|15/.test(live) && !/ROSTER_MAX\|\|15/.test(live) && !/ROSTER_MAX\|\|15/.test(pub));
  A("ROSTER_MAX still derives from the season, defaulting to 17",
    /CG\.ROSTER_MAX = \(season && season\.roster_max\) \|\| 17;/.test(live));
  A("the public blurb quotes the same number", /\(CG\.ROSTER_MAX\|\|17\)\+"-player roster/.test(pub));
}

console.log("\n— the reason each fix exists is written down where the next reader will look");
{
  A("the dashboard counter cites the rule", /training-camp players are carried BEYOND the seventeen/.test(live));
  A("the free-agency desk explains the Sign button", /disabled the Sign button three players early/.test(live));
  A("the random assigner says why it filters", /active-roster spots only — camp is carried beyond the seventeen/.test(live));
}

console.log("\n— training-camp salaries are off the cap (Rule 2.5, commissioner ruling 2026-08-18)");
{
  A("the client payroll skips camp players",
    /\(waived\[p\.id\] \|\| p\.squad==="tc"\) \? 0 : \(p\.salary\|\|0\)/.test(engine));
  A("...and says why", /Training-camp salaries are off the cap/.test(engine));

  /* drive it: the same club, with and without a camp player carrying a big number */
  const vm = require("vm");
  const ctx = { console, Math, Object, Array, String, Number, JSON };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.CG = { CAP: 40000000 };
  vm.createContext(ctx);
  const m = engine.match(/CG\.teamPayroll = function[\s\S]*?\n\};/);
  if (!m) { A("located CG.teamPayroll", false); process.exit(1); }
  vm.runInContext(m[0], ctx);
  const lg = { byTeam: { NYI: [
    { id: "a", salary: 3000000 },                    /* squad undefined = active */
    { id: "b", salary: 2000000, squad: "pro" },
    { id: "c", salary: 9000000, squad: "tc" },       /* camp: must not count */
  ] } };
  A("an active roster of $3M + $2M with a $9M camp player reads $5M",
    ctx.CG.teamPayroll(lg, "NYI") === 5000000, String(ctx.CG.teamPayroll(lg, "NYI")));
  lg.byTeam.NYI[2].squad = "pro";                    /* call him up */
  A("...and $14M once that player is called up",
    ctx.CG.teamPayroll(lg, "NYI") === 14000000, String(ctx.CG.teamPayroll(lg, "NYI")));
}

console.log("\n— the rulebook carries the cap ruling too");
{
  const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
  const sec = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" "); throw new Error("no " + id); };
  A("Rule 2.5 says a camp salary is not part of the payroll",
    /training-camp player's salary is not part of that payroll/.test(sec("2.5")));
  A("...and that it starts counting on call-up",
    /begins to count only when he is called up to the active roster/.test(sec("2.5")));
  A("Rule 2.1 repeats it where camp is defined",
    /Their salaries do not count against the club's salary cap \(Rule 2\.5\)/.test(sec("2.1")));
  A("the changelog records v2.24",
    rb.changelog.some((c) => c.version === "2.24" && /does not count against the salary cap/.test(c.summary)));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
