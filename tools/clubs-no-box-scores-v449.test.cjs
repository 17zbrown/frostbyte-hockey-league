/* v4.49: a club no longer brings in its own box scores.
   Commissioner, 2026-11-10: "Do not allow teams to bring in their own box scores. They should be automatic or dealt with
   by staff." Pins the four places that ruling lives: the importer's door (authForGame), Team HQ (no Game stats page, an
   old link explains), the management permission list (site mirror and SQL record), and Rule 6.2. The importer's
   behavior per seat is tools/manager-merge.test.mjs. Run: node tools/clubs-no-box-scores-v449.test.cjs */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const ingest = R("netlify/functions/ingest-stats.js"), live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"),
  content = R("src/live/part3_content.js"), sql = R("sql/2026-11-10-clubs-never-file-box-scores-v449.sql");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "PASS" : "FAIL"} ${l}${x ? "  (" + x + ")" : ""}`); };

console.log("## the importer");
const auth = ingest.slice(ingest.indexOf("async function authForGame(jwt, game) {"), ingest.indexOf("\n}\n", ingest.indexOf("async function authForGame(jwt, game) {")));
A("authForGame is staff and commissioners only", /const a = await staffActor\(jwt\);\n  if \(a\.ok\) return a;\n  return \{ ok: false, uid: a\.uid, who: a\.who, reason: STAFF_ONLY \};/.test(auth));
A("...it reads no club seat at all", !/owner_profile_id|gm_profile_id|mgmt_access_for/.test(auth));
A("no path in the importer still treats a club as an actor", !/actor\.via === "management"|via: "management"/.test(ingest));
A("every desk door answers with the one refusal", (ingest.match(/actor\.reason \|\| STAFF_ONLY/g) || []).length === 5);
A("the refusal says where box scores come from and who fixes one", /Box scores import automatically from EA, and a missing or wrong one goes to the statistics staff \(Rule 6\.3\)\./.test(ingest));
A("the ruling is quoted where the door is", /Do not allow teams to bring in their own box scores/.test(auth.length ? ingest : ""));

console.log("## Team HQ");
A("no Game stats entry in the Team HQ menu", !/\["gamestats","Game stats"/.test(hub));
A("the club desk's code is gone", !/CG\.hubGameStats = function|CG\._gsList = function|CG\._gsOne = function|CG\.AFTER\._hubGameStats/.test(live));
A("an old #/hub/gamestats link lands on an explanation, not a dead end", /if \(param==="gamestats"\) return CG\.hubShell\("gamestats", CG\.gameStatsGone\(\)\);/.test(live));
A("...which names the Statistics correction and Rule 6.3", /CG\.gameStatsGone = function/.test(live) && /<b>Statistics correction<\/b> in the Action Center and the statistics staff fix it \(Rule 6\.3\)/.test(live));
A("the management permission list has no Game stats row", !/\["gamestats",/.test(live));

console.log("## the database record");
A("mgmt_pages() drops gamestats", /select array\['roster','lines','schedule','tradehub','freeagents','draft','management'\]/.test(sql));
A("both functions are patched by an exact anchor, checked once each", (sql.match(/anchor is not unique/g) || []).length === 2);
A("stale saved entries are cleared with a qualified WHERE", /update public\.team_mgmt_policy\n\s+set policy = policy #- '\{gm,gamestats\}' #- '\{agm,gamestats\}'\n\s+where /.test(sql));
A("the rehearsal is recorded", /Result: REHEARSAL OK\./.test(sql));

console.log("## the rulebook (Rule 6.2)");
const C = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]);
const r62 = C.rulebook.chapters.reduce((a, ch) => a.concat(ch.sections || []), []).filter((x) => x.id === "6.2")[0];
const text = r62 ? JSON.stringify(r62) : "";
A("Rule 6.2 is found", !!r62);
A("it says no club files, attaches or combines its own box scores", /No club files, attaches or combines its own box scores: every box score is imported automatically or entered by the statistics staff or a commissioner/.test(text));
A("the stale sentence is gone", !/A club's management may attach the single sitting/.test(text));
A("a late game is filed from the Stats manager, not the club desk", /filed by the league's statistics staff from the Stats manager rather than imported automatically/.test(text) && !/club game stats desk/.test(text));
A("no rule anywhere still points at the club desk", !/club game stats desk/.test(JSON.stringify(C.rulebook.chapters)));
const v = (C.rulebook.changelog || []).filter((e) => e.version === "4.49")[0];
A("the 4.49 changelog entry exists and names Rule 6.2", !!v && /Rule 6\.2/.test(JSON.stringify(v)), v ? v.summary : "missing");

console.log(ok ? "\nALL PASSED" : "\nFAILED");
process.exit(ok ? 0 : 1);
