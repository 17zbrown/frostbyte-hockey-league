/* v4.58: the Season 2 waive hold. node tools/s2-waive-hold-v458.test.cjs
   In a market season public.waive_player refuses with "Season 2 waivers open when the draft completes." until the
   Season 2 waivers record replaces the hold with the 24-hour claim market (commissioner, 2026-11-02: "Any team can pick
   up a player placed on waivers up to 24 hours after they have been waived, like real life."). Pins the record (the
   anchored patch, the Season 1 byte-identity proof, the self-checks) and its rehearsal. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;

const REC = "sql/2026-11-24-s2-waive-hold-v458.sql";
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC);
const part = (tag) => { const m = sql.match(new RegExp("\\$" + tag + "\\$([\\s\\S]*?)\\$" + tag + "\\$")); return m ? m[1] : ""; };
const anchor = part("a"), hold = part("h");
const before = (s, a, b) => s.indexOf(a) >= 0 && s.indexOf(b) >= 0 && s.indexOf(a) < s.indexOf(b);

console.log("1. The record");
A("the header quotes the commissioner's waiver ruling",
  /"Any team can pick up a player placed\n-- on waivers up to 24 hours after they have been waived, like real life\."/.test(sql));
A("it refuses to run before db-guards has created market_on",
  /if to_regprocedure\('public\.market_on\(uuid\)'\) is null then/.test(sql) && /Apply the db-guards record first/.test(sql));
A("the anchor is the season line of the live waive_player (the newest record that writes it)",
  anchor === "  if v_season.id is null then raise exception 'No active season.'; end if;\n"
  && R("sql/2026-10-21-commissioner-powers-v427.sql").indexOf(anchor) >= 0);
A("...asserted to match exactly once before the replacement",
  /if v_n <> 1 then raise exception 'v4.58 waive hold: the season anchor matched % times, expected exactly 1', v_n; end if;/.test(sql)
  && /execute replace\(v_old, v_anchor, v_anchor \|\| v_hold\);/.test(sql));
A("the hold branches on market_on and refuses with the one sentence, a check_violation and a hint",
  /^  if public\.market_on\(v_season\.id\) then\n    raise exception 'Season 2 waivers open when the draft completes\.' using errcode = 'check_violation', hint = 'waivers_not_open';\n  end if;\n$/m.test(hold));
A("...and carries its version and the commissioner's words", /v4.58 \(Season 2 waive hold\)/.test(hold) && /like real life\."/.test(hold));
A("the Season 1 path is proved byte-identical (the new body less the hold block is the old body)",
  /if replace\(v_new, v_hold, ''\) <> v_old then/.test(sql));
A("CREATE OR REPLACE keeps the signature and grants: no DROP", !/drop\s+function/i.test(sql));
A("self-checks: one waive_player, the branch once and before the delete, definer with an empty search_path, grants, Season 1 not a market season",
  ["expected exactly one public.waive_player'", "the market branch is not in waive_player exactly once", "the hold must come before the roster delete",
   "must stay SECURITY DEFINER with search_path", "waive_player grants changed (authenticated yes, anon no)", "Season 1 must not be a market season"]
    .every((t) => sql.indexOf(t) >= 0));
A("the record has no dashes and no gendered pronouns outside quoted live text",
  !DASHES.test(sql) && !/ - /.test((sql.match(/^--.*$/gm) || []).join("\n") + (sql.match(/raise exception '(?:[^']|'')*'/g) || []).join("\n"))
  && !GENDERED.test(sql));
A("the record posts nothing", !/discord_http_post|notify_discord|_announce_once|discord_dms|club_notify/.test(sql));
A("it names no other record's number (the waivers record reads the hold's number from the live body)",
  !/(waivers|roster-minimums|draft-night-guards|front-office)-v4.58/.test(sql) && !/\(v4.58, db-waivers\)/.test(sql)
  && (sql.match(/v4.58/g) || []).length === (sql.match(/v4.58 (\(2026-11-24\)|\(Season 2 waive hold\)|waive hold:)|s2-waive-hold-v4.58|v4.58_s2_waive_hold/g) || []).length);

console.log("\n2. The rehearsal");
const reh = R(REH);
const embedded = (reh.match(/-- >>> record text: [^\n]*\n([\s\S]*?)-- <<< record text\n/) || [])[1] || "";
A("it carries the record's text byte for byte", embedded === sql.replace(/\n?$/, "\n"));
A("...after a marked place for db-guards' record", reh.indexOf("-- >>> db-guards record text goes here") > 0
  && reh.indexOf("-- >>> db-guards record text goes here") < reh.indexOf("-- >>> record text: "));
const world = (reh.match(/do \$w\$([\s\S]*?)end \$w\$;/) || [])[1] || "";
A("the world models the commissioner's Season 2 rollover while it is owed (start_next_season under a commissioner's claims), and hand-expires nothing",
  /if exists \(select 1 from public\.contracts c where c\.status in \('active', 'signed'\) and not coalesce\(c\.is_manager, false\)\n\s+and c\.start_season < \(select s\.number from public\.seasons s where s\.id = v_s2\)\) then\n\s+perform set_config\('request\.jwt\.claims', json_build_object\('sub', v_c, 'role', 'authenticated'\)::text, true\);\n\s+perform public\.start_next_season\(v_s2\);/.test(world)
  && before(world, "start_next_season(v_s2)", "update public.teams set owner_profile_id") && !/update public\.contracts/.test(reh));
A("one transaction: begins once and never commits", (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh));
A("the Owner and a commissioner, signed in as API users, are refused with the exact sentence",
  /set local role authenticated;/.test(reh) && (reh.match(/if sqlerrm <> 'Season 2 waivers open when the draft completes\.' then raise; end if;/g) || []).length === 2);
A("expected refusals sit in inner blocks that re-raise anything else; the verdict block has no handler",
  /do \$v\$[\s\S]*raise exception 'REHEARSAL OK: T1 T2 T3 T4(?:[^']|'')*';\nend \$v\$;\s*$/.test(reh) && !/do \$v\$[\s\S]*exception when/.test(reh));
A("it checks nothing moved (spot kept, no waive transaction, no waived_at stamp)",
  ["T4 failed: the roster spot is gone", "T4 failed: a waive transaction was written", "T4 failed: the player was stamped waived"].every((t) => reh.indexOf(t) >= 0));
A("no dblink, no http", !/dblink|http_get|http_post\(/i.test(reh));
A("the rehearsal names no member (players are picked inside the transaction)", !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
