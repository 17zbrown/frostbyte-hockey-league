/* v3.82: the season box-score audit's corrections and guards. Commissioner, 2026-10-02: "Sift through each game played
   in the league so far to make sure players' stats are fully up to date and not missing anything using rosters as of
   right now." The database half was rehearsed in Postgres (recorded at the foot of the SQL file). This RUNS the
   importer's new one-credit-per-game rule and pins the record and the book. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 240))); } };
const src = R("netlify/functions/ingest-stats.js"), sql = R("sql/2026-10-02-stats-audit-v382.sql");

(async () => {
  console.log("— one member, one line per game (the importer)");
  const i = src.indexOf("async function oneCreditPerGame"), body = src.slice(i, src.indexOf("\n}\n", i) + 2);
  const make = (profiles) => new Function("sbGet", "console", body + "\nreturn oneCreditPerGame;")(
    async () => { if (profiles instanceof Error) throw profiles; return profiles; }, { log: () => {} });
  const LIL = "716136ec", BOW = "b90f2bd4";
  let rows = [{ ea_player_id: "1123662793", profile_id: LIL }, { ea_player_id: "1004486290545", profile_id: LIL }, { ea_player_id: "1960987555", profile_id: BOW }];
  await make([{ id: LIL, ea_player_id: "1123662793" }])(rows);
  A("two lines on one member: the line on his own persona keeps the credit", rows[0].profile_id === LIL && rows[1].profile_id === null, rows);
  A("...and a member on one line is untouched", rows[2].profile_id === BOW);
  rows = [{ ea_player_id: "1", profile_id: LIL }, { ea_player_id: "2", profile_id: LIL }];
  await make([{ id: LIL, ea_player_id: null }])(rows);
  A("no persona on record decides: credited to none of them", rows.every((r) => r.profile_id === null), rows);
  rows = [{ ea_player_id: "1", profile_id: LIL }, { ea_player_id: "2", profile_id: LIL }];
  await make(new Error("down"))(rows);
  A("the profiles cannot be read: credited to none (never a guess)", rows.every((r) => r.profile_id === null), rows);
  rows = [{ ea_player_id: "1", profile_id: LIL }];
  let called = false; await new Function("sbGet", "console", body + "\nreturn oneCreditPerGame;")(async () => { called = true; return []; }, { log: () => {} })(rows);
  A("no double credit: no lookup at all", !called && rows[0].profile_id === LIL);
  A("it runs before withdrawals and before personas are learned", /await oneCreditPerGame\(rows\);\n  await applyCreditWithdrawals\(game\.id, rows\);\n  await learnPersonas\(rows\);/.test(src));

  console.log("— the database record");
  A("the withdrawal is enforced on every write", /create trigger enforce_stat_credit_withdrawal_trg before insert or update of profile_id, game_id, ea_player_id on public\.game_stats/.test(sql));
  A("...and the restore door removes it before re-linking", /delete from public\.stat_credit_withdrawals w\n   where w\.game_id = p_game and w\.ea_player_id = p_ea_player_id;\n  update public\.game_stats gs set profile_id = v_prof/.test(sql));
  A("a line changing hands refreshes both holders", /if v_old is not null and v_old is distinct from v_new then perform public\.refresh_player_overall\(v_old\)/.test(sql));
  A("a game becoming final settles its held sittings", /create trigger settle_held_sittings_trg after update of status on public\.games/.test(sql));
  A("each correction refuses to run on a row that is not as audited", (sql.match(/if v_n <> 1 then raise exception/g) || []).length >= 6);
  A("the goalie rebuild keeps the saves / shots / goals guard", /s\.sv = t\.saves and s\.sa = t\.shots_against and s\.ga = t\.goals_against/.test(sql));
  A("rehearsed and applied", /REHEARSAL OK: T1 T2 \(guard \+ restore\) T3 T5/.test(sql) && /APPLIED 2026-10-02 as migration v382_stats_audit_corrections/.test(sql));

  console.log("— the book");
  global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
  const rb = CG.CONTENT.rulebook, s63 = rb.chapters.flatMap((c) => c.sections || []).find((s) => s.id === "6.3");
  A("Rule 6.3: at most one line in a game", /a member is credited with at most one line in a game/.test(s63.paragraphs.join(" ")));
  A("changelog 3.82", !!rb.changelog.find((c) => c.version === "3.82"));

  console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
  process.exit(fail ? 1 : 0);
})();
