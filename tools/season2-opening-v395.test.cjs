/* v3.95 (2026-10-13): Season 2 opens on the commissioner's off-season timeline. Rulings: owner applications close the
   Saturday of the week after Season 1's final (Dec 12); a draft or cut-off in a holiday week moves to the next clear
   week (draft Jan 9, cut-off Jan 8, puck drop Jan 13); every club is decided again (everyone reapplies); the Season 2
   format is published at the opening. Rehearsed on production rolled back: before the flip an application is refused
   (Season 1's window closed); after it, an application the page stamps Season 1 is stamped Season 2, a second one is
   refused, an edit never moves it, a commissioner's early decision is refused with the Dec 12 date, the ballot
   resolver waits, and Season 1's 17 applications are untouched. This pins the record, the site and the rulebook. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-13-season2-opening-v395.sql"), live = R("src/live/part_live.js"), pub2 = R("src/live/part5b_public2.js"), pubA = R("src/live/part5a_public.js"), ui = R("src/live/part4_ui.js");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 240))); } };

console.log("— the Season 2 row and the opening post");
A("dates: owner close Dec 12 11:59 PM, cut-off Jan 8 11:59 PM, draft Jan 9 9 PM, puck drop Jan 13", /owner_app_deadline    = timestamptz '2026-12-12 23:59:00 America\/New_York'/.test(sql)
  && /signup_deadline_at    = timestamptz '2027-01-08 23:59:00 America\/New_York'/.test(sql) && /draft_at              = timestamptz '2027-01-09 21:00:00 America\/New_York'/.test(sql) && /starts_at             = timestamptz '2027-01-13 21:00:00 America\/New_York'/.test(sql));
A("10 rounds and a floor of 17", /draft_rounds          = 10,/.test(sql) && /playoff_min_gp        = 17/.test(sql));
A("the opening post reads the season's own title and text", /''ann_title_'' \|\| s\.number \|\| ''_reg_open''/.test(sql) && /''ann_text_'' \|\| s\.number \|\| ''_reg_open''/.test(sql) && /\('ann_text_2_reg_open',/.test(sql));
A("...which says every club is decided again and links Chapter S2", /Every club is decided again for Season 2, so current Owners apply too\./.test(sql) && /#\/rulebook\?rule=S2\.1/.test(sql));

console.log("— owner applications per season, decided after they close");
A("one application per member per season", /drop constraint if exists owner_applications_profile_id_key/.test(sql) && /on public\.owner_applications \(profile_id, season_id\)/.test(sql));
A("the database stamps the season taking registrations and never moves an application", /new\.season_id := \(select id from public\.seasons where registration_open and status <> 'complete' order by number desc limit 1\);/.test(sql) && /new\.season_id := old\.season_id;   -- an application never moves to another season/.test(sql));
A("no decision before the close: every path refused, the ballot resolver waits", /raise exception 'Owner applications for this season are decided after they close on %, not before\.'/.test(sql) && /if p_type = ''owner'' and not public\._owner_app_decidable\(p_id\) then return; end if;/.test(sql));
A("the site loads and saves the application for the season taking registrations", /\.eq\("profile_id", uid\)\.eq\("season_id", sidA\)/.test(live) && /upsert\(payload,\{onConflict:"profile_id,season_id"\}\)/.test(live) && /var payload=\{ season_id: _s\.id\|\|null,/.test(live));
A("the owner page and the review card name the season, and point to Chapter S2", /Every club is decided again for '\+esc\(s\.name/.test(live) && /fields \+= row\("Season", appSeason/.test(live));

console.log("— the site");
A("the home page counts each season's sign-ups apart", /r\.season_id === s\.id; \}\)\.length;/.test(pubA) && /"Signed up for " \+ \(sNext\.name/.test(pubA) && !/Season 1 at a glance/.test(pubA));
A("no hard-coded Season 1 in the ticker, the statline, the empty schedule or the chip", !/SEASON 1<\/span><b>The inaugural season/.test(ui) && !/The Season 1 slate posts after the draft/.test(pubA) && !/Season 1 — not yet under way/.test(pubA));
A("the sign-up page points a Chapter S2 season to it", /This season runs a new format, with a league-wide training camp and Saturday bidding: see the rulebook, Chapter S2\./.test(live));
A("the rulebook labels an upcoming season's chapter", /ch\.upcomingSeason \? esc\(ch\.title\)/.test(pub2));

console.log("— the rulebook and changelog");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook;
const s2 = rb.chapters.find((c) => c.num === "S2");
A("Chapter S2 exists for Season 2 with seven sections", !!s2 && s2.upcomingSeason === 2 && s2.sections.length === 7 && s2.sections[0].id === "S2.1");
const t = JSON.stringify(s2);
A("...the calendar rule and its Season 2 dates", /close at 11:59 PM Eastern on the Saturday of the following week/.test(t) && /Saturday, December 12, 2026 at 11:59 PM/.test(t) && /Saturday, January 9, 2027 at 9:00 PM/.test(t));
A("...every club decided again; none decided before the close", /Every club's ownership is decided again for Season 2/.test(t) && /No owner application is decided before applications close\./.test(t));
A("...the format: 10 rounds, 12 then 15, 5/3/1, league-wide camp, Saturday bidding, no weekly limits, 16 (v4.01: 30% of the season, always)", /ten \(10\) rounds/.test(t) && /twelve \(12\) players until the draft concludes and fifteen \(15\)/.test(t) && /five \(5\) forwards, three \(3\) defensemen and one \(1\) goaltender/.test(t)
  && /one league-wide training camp pool/.test(t) && /every Saturday at 9:00 PM Eastern and runs for one hour/.test(t) && /There is no weekly limit/.test(t) && /sixteen \(16\) games while Season 2 is fifty-four \(54\) games long/.test(t));
const cl = rb.changelog.find((c) => c.version === "3.95");
A("changelog 3.95 says what changed", !!cl && /Chapter S2/.test(cl.summary));
A("no em dash in what v3.95 wrote", !/—/.test(t) && !/—/.test(JSON.stringify(cl)) && !/—/.test(sql.replace(/to be draft-eligible — join later/g, "")));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
