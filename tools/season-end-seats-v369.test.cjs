/* v3.69: Q45 the GM and AGM seats end when the club's season ends; the Owner stays. Rehearsed in Postgres. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-season-end-seats-v369.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const live = R("src/live/part_live.js");
A("Q45 quoted", /management contracts end at the end of playoffs FOR THAT TEAM/.test(sqlF) && /Just the GM and AGM seats do\. The Owner stays for now\./.test(sqlF));
A("_set_team_seat accepts the season as the reason, with its own message", /'office'',''owner'',''season''/.test(sql) && /seats end with it \(Rule 2\.6\)/.test(sql));
A("only the GM and AGM seats are ended", /if t\.gm_profile_id is not null then perform public\._set_team_seat\(p_team, 'gm', null, 'season'\)/.test(sql) && /'agm', null, 'season'/.test(sql) && !/'owner', null, 'season'/.test(sql));
A("eliminated: the first series result names the loser", /create trigger series_ends_seats_trg after insert on public\.app_config/.test(sql) && /v_loser := case when new\.value = v_a::text then v_b when new\.value = v_b::text then v_a end;/.test(sql));
A("out of the playoffs: the frozen seeds, for the current season only", /create trigger seeds_end_seats_trg after insert on public\.site_config/.test(sql) && /split_part\(new\.key, '_', 3\) <> public\.current_season_num\(\)::text/.test(sql));
A("...with a reminder to reseat if round 1 is reseeded", /If round 1 is cleared and reseeded, clubs that qualify after all need their management reseated/.test(sql));
A("the final: every remaining seat ends with the season", /after update of status on public\.seasons/.test(sql) && /if new\.status <> 'complete' or old\.status = 'complete' then return new; end if;/.test(sql));
A("the rehearsal is recorded", /Result: REHEARSAL OK\. Applied as migration v369_season_end_seats\./.test(sql));
/* v4.53 (commissioner, 2026-11-20) superseded Q45: every seat, the Owner's included, ends 24 hours after the club's season
   ends, and the club role comes off the roster (tools/club-season-close-v453.test.cjs pins the new rule). The v3.69 record
   above stays as history; the caption and the rule text now say the new rule, with the Q45 quote kept in the comment. */
A("Team HQ says so (v4.53 wording)", /Just the GM and AGM seats do\. The Owner stays for now\./.test(live) && /Every seat, the Owner’s included, ends 24 hours after the club’s season ends/.test(live));
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.69");
A("changelog records 3.69", !!e);
A("2.6.3 (both formats): the seats end with the club's season (v4.53: every seat, 24 hours after)", ["paragraphs", "full"].every((k) => /Every front-office seat, the Owner's included, ends with its management contract twenty-four \(24\) hours after the club's season ends/.test(secs["2.6"][k][2]) && !/The Owner's seat continues\./.test(secs["2.6"][k][2])));
A("no em dashes or spaced hyphens in the 3.69 entry", !/—| - /.test(JSON.stringify(e)));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
