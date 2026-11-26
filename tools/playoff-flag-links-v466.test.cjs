/* v466 (drafted 2026-11-25 by the core health fixer of the Season 2 swap; the main session numbers, rehearses and applies
   it): a playoff flag's link opens the game it is about (health links 4).
   node tools/playoff-flag-links-v466.test.cjs
   public.check_playoff_violations sends the commissioners three flags ("Review the game.") with view 'transactions' and
   no parameter, which opened the classic home page and, on the new site, the league's trades list. The record patches the
   three calls to view 'game' with the game's id. Pins the record (the anchored patch, the byte proof, the self-checks),
   its rehearsal (the record's text byte for byte, the before and after cases) and the client half: both views open
   where this record relies on (S2.notifRoute: game to the game, transactions still to the trades list). */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;

const REC = "sql/2026-11-25-playoff-flag-links-v466.sql", REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC), reh = R(REH), core = R("src/s2/js/core.js");
const OLD = "'transactions', null)", NEW = "'game', new.id::text)";

console.log("1. The record");
A("the anchor and its replacement are the three views and nothing more",
  sql.indexOf("a text := '''transactions'', null)';") >= 0 && sql.indexOf("b text := '''game'', new.id::text)';") >= 0);
A("the anchor is asserted to match exactly three times, and a function already patched is refused",
  /if n <> 3 then raise exception 'v466 playoff flag links: the anchor % matched % times, expected exactly 3', a, n; end if;/.test(sql)
  && /if position\(b in v_old\) > 0 then raise exception/.test(sql));
A("new.id is a game id only while the function is the games trigger, so the record checks that first",
  /t\.tgname = 'trg_playoff_violations' and t\.tgrelid = 'public\.games'::regclass/.test(sql));
A("the new body differs from the old by the three views only (byte proof), with none left and exactly three game views",
  /execute replace\(v_old, a, b\);/.test(sql) && /if replace\(v_new, b, a\) <> v_old then/.test(sql)
  && /if position\(a in v_new\) > 0 then/.test(sql) && /length\(b\) <> 3 then/.test(sql));
A("self-checks: still SECURITY DEFINER, the search_path setting kept, no transactions view left",
  /if not p\.prosecdef then raise exception/.test(sql) && /p\.proconfig is distinct from array\['search_path=public'\]/.test(sql));
/* the v4.61 record is the newest text of the two flags it added; each named the transactions view (the series-cap
   flag's text predates the sql records in this repo, read live on 2026-11-25) */
const v461 = R("sql/2026-11-24-s2-playoff-rules-v461.sql");
A("the v4.61 record's two flags are among the three the anchor finds", v461.split(OLD).length - 1 === 2 && /Review the game\.', 'transactions', null\);/.test(v461));
A("the header says why, who receives the flags and what stays (accept_trade and reverse_trade keep transactions)",
  /Review the game\./.test(sql) && /accept_trade and reverse_trade keep it/.test(sql) && /Posts nothing and writes no row\./.test(sql));

console.log("2. The rehearsal");
const carried = (reh.split("-- >>> record text")[1] || "").split("-- <<< record text")[0];
const body = sql.slice(sql.indexOf("do $patch$"));
A("it carries the record's text byte for byte", carried.slice(carried.indexOf("\n") + 1) === body);
A("it ends in an uncaught raise, never a handler that would commit", /raise exception 'REHEARSAL OK \(rolled back\)/.test(reh) && !/exception when/i.test(reh));
A("R1 pins the live function read on 2026-11-25 (md5) and its three transactions notices", /md5\(d\) <> 'd64e56625186953d128506d7380941ae'/.test(reh));
A("R3 proves the three game views, the failure notice untouched, the byte proof and the grants unchanged",
  /<> 3 then raise exception 'R3: not three game views'/.test(reh) && /Check its box score by hand \(Rule 8\.3\)\.'', ''admin'', null\)/.test(reh)
  && /<> b\.def then raise exception 'R3: more than the three views changed'/.test(reh) && /is distinct from b\.grants/.test(reh));

console.log("3. Where the two views open on the new site");
const old = core.slice(core.indexOf("S2.notifRoute = function"), core.indexOf("S2.siteConfig ="));
A("view game with an id opens #/matchup/<id>, which the alias table sends to #/game/<id>",
  /game: p \? "#\/matchup\/" \+ encodeURIComponent\(p\) : "#\/schedule"/.test(old) && /"matchup": arg\("#\/game\/", "#\/games"\)/.test(core));
A("view transactions still opens the league's trades (accept_trade and reverse_trade)", /transactions: "#\/clubs\?view=moves&kind=trade"/.test(old));

console.log("4. Writing rules");
[REC, REH].forEach((f) => {
  const t = R(f);
  A(f + ": no em or en dash, no gendered pronoun", !DASHES.test(t) && !GENDERED.test(t));
});
A("this file: no em or en dash", !DASHES.test(R("tools/playoff-flag-links-v466.test.cjs")));

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
