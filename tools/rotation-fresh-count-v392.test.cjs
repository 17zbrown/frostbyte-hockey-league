/* v3.92: the late sign-up rotation counts only placements made under it. Commissioner, 2026-10-10: "Mid season
   signups only seem to be going to Vancouver. Make sure each team gets one before you give a 2nd one to any team."
   v3.89 counted every league-office placement since the post-draft round, so Boston and Vancouver (2 each) were owed
   first; Boston's camp was full (10 of 10), and three of the first four rotation placements went to Vancouver.
   Rehearsed against production rolled back: the count became VAN 1, UTA 1, the rest 0, and the next draw set was
   DAL, DET, NYI, PIT, SEA, with BOS (camp full) held at the front of the line. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-10-rotation-fresh-count-v392.sql"), live = R("src/live/part_live.js");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 240))); } };

console.log("— the record");
A("a separate in_rotation flag, so the undo and reinstate trigger (which owns counts) can never hand an old row a turn",
  /alter table public\.random_assignments add column if not exists in_rotation boolean not null default true;/.test(sql));
A("Season 1 placements before the v3.89 migration (2026-10-08 02:26:52 UTC) are history, not turns",
  /set in_rotation = false\s+where season_id = \(select id from public\.seasons where number = 1\)\s+and placed_at < timestamptz '2026-10-08 02:26:52\+00';/.test(sql));
A("the draw counts rows that are counted AND in the rotation, patched by an anchor asserted unique",
  /v_new text := 'where ra\.season_id = v_reg\.season_id and ra\.team_id = t\.id and ra\.counts and ra\.in_rotation\)'/.test(sql) && /the rotation count anchor was not found exactly once/.test(sql));
A("the turns index follows the same predicate", /create index random_assignments_turns on public\.random_assignments \(season_id, team_id\) where counts and in_rotation;/.test(sql));
A("fail loud: the migration refuses to finish if any pre-rotation row still counts", /raise exception 'v3\.92: % pre-rotation rows still counted', v_bad;/.test(sql));

console.log("— the Control Center panel (runs the real CG.raRotationHtml)");
const fnSrc = (name) => { const i = live.indexOf("CG." + name + " = function"); const j = live.indexOf("\n};", i); return live.slice(i, j + 3); };
const ctx = { CG: { TEAMS: ["BOS","DAL","DET","NYI","PIT","SEA","UTA","VAN"].map((c) => ({ id: "t-" + c, code: c })), CAMP_MAX: 10 }, esc: (s) => String(s) };
vm.createContext(ctx); vm.runInContext(fnSrc("raRotationHtml"), ctx);
const camp = (k) => Array.from({ length: k }, () => ({ status: "active", squad: "tc" }));
const lg = { byTeam: { BOS: camp(10), DAL: camp(6), DET: camp(5), NYI: camp(6), PIT: camp(7), SEA: camp(4), UTA: camp(9), VAN: camp(5) } };
const rows = [];
const pre = { BOS: 2, DAL: 6, DET: 5, NYI: 4, PIT: 4, SEA: 4, UTA: 3, VAN: 2 };   // v3.89's season-long count
Object.keys(pre).forEach((c) => { for (let i = 0; i < pre[c]; i++) rows.push({ team_id: "t-" + c, counts: true, in_rotation: false }); });
rows.push({ team_id: "t-VAN", counts: true, in_rotation: true }, { team_id: "t-UTA", counts: true, in_rotation: true },
          { team_id: "t-VAN", counts: false, in_rotation: true }, { team_id: "t-VAN", counts: false, in_rotation: true });   // two undone
const html = ctx.CG.raRotationHtml(rows, lg);
A("pre-rotation rows are not counted: VAN 1, UTA 1, DAL 0", /VAN 1/.test(html) && /UTA 1/.test(html) && /DAL 0/.test(html), html);
A("the next draw is the five clubs that have had none and have room", /goes to DAL, DET, NYI, PIT or SEA, drawn at random/.test(html), html);
A("Boston, camp full, is held at the front of the line", /keeping its place in line: BOS \(0\)/.test(html), html);
A("a row from before v3.92 with no in_rotation field still counts (only an explicit false is history)",
  /VAN 1/.test(ctx.CG.raRotationHtml([{ team_id: "t-VAN", counts: true }], lg)));
A("the panel loads the flag", /\.select\("team_id,counts,in_rotation"\)/.test(live));

console.log("— the rulebook and changelog");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook;
const p = rb.chapters[2].sections[7].paragraphs[7];
A("Rule 2.8 counts placements under the rotation and says earlier ones do not count",
  /fewest placements under this rotation that season, so that every club receives one before any club receives a second; a placement made before the rotation took effect on October 8, 2026 is not counted\./.test(p));
const cl = rb.changelog.find((c) => c.version === "3.92");
A("changelog 3.92 is first and says what changed", rb.changelog[0].version === "3.92" && !!cl && /Rule 2\.8/.test(cl.summary) && cl.items.some((i) => /Dallas, Detroit, the Islanders, Pittsburgh and Seattle/.test(i)));
A("no em dash in what v3.92 added", !/—/.test(JSON.stringify(cl)) && !/—/.test(sql) && !/—/.test(p.slice(p.indexOf("with one difference"))));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
