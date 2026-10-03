/* v3.84: CerealTiger takes the Penguins' Owner seat with the room requirement set aside. Commissioner, 2026-10-02:
   "Promote CerealTiger to owner of the Penguins and disregard the roster size limit as he will solve that upon his
   entry to the owner seat." Pins the record (the shape check is off for the one seating statement only, every other
   check still runs) and the book. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-10-02-cerealtiger-pit-owner.sql");
A("the seat must be vacant", /raise exception 'the Penguins'' Owner seat is not vacant'/.test(sql));
A("the shape check is off for the seating statement only, and back on before commit",
  /disable trigger check_roster_structure_trg';\n  perform public\._assign_team_role\(v_pit, 'owner', v_ct\);\n  execute 'alter table public\.roster_spots enable trigger check_roster_structure_trg';/.test(sql));
A("seated through _assign_team_role (one person, one seat), so the seat triggers roster, contract and announce him", /_assign_team_role\(v_pit, 'owner', v_ct\)/.test(sql));
A("the ruling is on the record", /'owner_appointed', 'team'/.test(sql) && /set aside by the commissioner for this appointment/.test(sql));
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, s = rb.chapters.flatMap((c) => c.sections || []).find((x) => x.id === "2.6");
A("Rule 2.6 records the power, in both formats", /A commissioner appointing an Owner may set that requirement aside/.test(s.paragraphs.join(" ")) && /A commissioner appointing an Owner may set that requirement aside/.test(s.full.join(" ")));
A("...and the office's no-clock paragraph names the exception", /save that an Owner may be appointed to a club with no room in his group \(paragraph 3 of this rule\)/.test(s.paragraphs[6]));
A("changelog 3.84", !!rb.changelog.find((c) => c.version === "3.84"));
console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
