/* discord-scheduler correctness — the cluster the pre-launch audit confirmed.
   Run: node tools/scheduler-integrity.test.cjs

   Four distinct defects, each of which fires on a specific date:
     · The Friday #standings post blended pre-season and playoff games into the regular table,
       counted voided games, and ignored forfeit rulings — wrong from the first regular Friday.
     · The job selected the NEWEST season row, so creating Season 2 (opens at the Nov 20 trade
       deadline, mid-playoffs) would silently move every feed to the empty new season.
     · Casework nudges (confidential) fell back to the PUBLIC default webhook when their own was
       unset.
     · #rules showed a blank effective date because the two newest changelog entries wrote `date`
       while the reader (and every older entry) used `dateIso`.
   computeStandings is extracted and DRIVEN — the stage/void/forfeit logic is arithmetic. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "netlify/functions/discord-scheduler.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "..", "src/live/part3_content.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the standings table counts only regular, non-void, forfeit-aware games");
{
  const ctx = { console, Object }; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  const m = src.match(/function computeStandings\(games, teamById\) \{[\s\S]*?\n\}/);
  if (!m) { A("located computeStandings", false); process.exit(1); }
  vm.runInContext(m[0] + "\nthis.computeStandings = computeStandings;", ctx);
  const teamById = { A: { name: "A", division: "East" }, B: { name: "B", division: "East" } };
  const cs = (games) => ctx.computeStandings(games, teamById);

  let t = cs([{ status: "final", stage: "preseason", home_team_id: "A", away_team_id: "B", home_score: 5, away_score: 0 }]);
  A("a pre-season final does not touch the table", t.A.gp === 0 && t.A.pts === 0);

  t = cs([{ status: "final", stage: "playoff", home_team_id: "A", away_team_id: "B", home_score: 5, away_score: 0 }]);
  A("a playoff final does not either", t.A.gp === 0);

  t = cs([{ status: "final", stage: "regular", voided: true, home_team_id: "A", away_team_id: "B", home_score: 5, away_score: 0 }]);
  A("a voided regular game is skipped", t.A.gp === 0);

  t = cs([{ status: "final", stage: "regular", home_team_id: "A", away_team_id: "B", home_score: 3, away_score: 2, went_ot: true }]);
  A("a regular OT game: winner 2, loser 1", t.A.pts === 2 && t.B.pts === 1 && t.B.otl === 1);

  t = cs([{ status: "final", stage: "regular", home_team_id: "A", away_team_id: "B", home_score: 6, away_score: 0, forfeit_team_id: "A" }]);
  A("a forfeit hands the win to the club that did NOT forfeit, no OT point",
    t.B.pts === 2 && t.B.w === 1 && t.A.l === 1 && t.A.otl === 0, JSON.stringify({ A: t.A.pts, B: t.B.pts }));

  t = cs([{ status: "final", stage: null, home_team_id: "A", away_team_id: "B", home_score: 4, away_score: 1 }]);
  A("a null stage is treated as regular (legacy rows)", t.A.pts === 2);
}

console.log("\n— the job follows the ACTIVE season, not merely the newest");
{
  A("it asks for the active season first", /seasons\?select=id,number&status=eq\.active/.test(src));
  A("...and only falls back to newest NON-COMPLETE when none is active", /status=neq\.complete&order=number\.desc&limit=1/.test(src));
  A("the old unconditional newest-season query is gone",
    !/const seasons = await sbGet\("seasons\?select=id,number&order=number\.desc&limit=1"\)/.test(src));
}

console.log("\n— confidential casework never falls back to the public webhook");
{
  A("casework falls back to the general STAFF channel, not the default",
    /discord_staff_casework_webhook \|\| cfg\.discord_staff_webhook/.test(src));
  A("...and never to discord_default_webhook", !/discord_staff_casework_webhook \|\| cfg\.discord_default_webhook/.test(src));
}

console.log("\n— the sign-up reminder stops naming a passed deadline");
{
  A("the draft-deadline line is guarded on the deadline still being in the future",
    /\(deadline && new Date\(deadline\)\.getTime\(\) > Date\.now\(\)\)/.test(src));
}

console.log("\n— #rules shows an effective date again");
{
  A("the reader accepts both dateIso and date", /cur\.dateIso \|\| cur\.date/.test(src));
  const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
  A("...and every changelog entry now carries dateIso at the source",
    rb.changelog.every((e) => !!e.dateIso), rb.changelog.filter((e) => !e.dateIso).map((e) => e.version).join(","));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
