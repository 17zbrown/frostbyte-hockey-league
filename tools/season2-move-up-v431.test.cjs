/* v4.31 (2026-10-24): Season 2 moves up four weeks. The commissioner: "Lets push the season 2 start up to what we
   discussed the other day where we play on vetrans day week so we can get season 2 week 1 in before christmas and the
   new year." Veterans Day (holiday key remembrance-day) comes off both seasons' holiday lists, so Season 1's playoffs
   run Nov 4 to 6, Nov 11 to 13 and Nov 18 to 20, and Rule S2.1 counted from that final puts the owner close on Nov 28,
   the decisions by Dec 5, the cutoff on Dec 11, the draft on Dec 12 and puck drop on Dec 16. This runs the site's own
   calendar helpers from part_live.js on the holiday lists, pins the SQL record against what they compute, renders the
   rulebook in both formats, and checks the changelog and the copy. The older pins of the January dates
   (tools/season2-opening-v395.test.cjs, tools/signup-day-before-draft-v424.test.cjs, tools/owner-decision-week-v396
   .test.cjs, tools/owner-any-franchise-v419.test.cjs) moved with this ruling; their SQL records stay as history.
   Run: node tools/season2-move-up-v431.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 300))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const live = R("src/live/part_live.js"), pub2 = R("src/live/part5b_public2.js"), survey = R("src/live/part11_survey.js");
const sql = R("sql/2026-10-24-season2-move-up-v431.sql");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const rx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

console.log("\n1. The calendar, from the site's own helpers");
const grab = (name) => { const key = "\nCG." + name + " = "; const i = live.indexOf(key); if (i < 0) throw new Error("no CG." + name); return live.slice(i + 1, live.indexOf("\nCG.", i + key.length)); };
const ctx = { CG: {}, Intl, Date, Math, JSON, String, Number, Array, Object };
vm.createContext(ctx);
["NIGHTS_PER_WEEK", "dayAdd", "dayOfWeek", "etISO", "etYMD", "HOLIDAY_RULES", "HOLIDAYS", "HOLIDAY_BY_KEY", "HOLIDAY_DEFAULTS",
 "holidayDate", "seasonHolidayKeys", "holidayWeek", "holidayWeekLabel", "gameNights"].forEach((k) => vm.runInContext(grab(k), ctx));
const CG = ctx.CG;
/* both seasons' skip_holidays as read on production, 2026-10-24, before this change */
const BEFORE = ["remembrance-day", "us-thanksgiving", "new-years-day", "easter", "canada-day", "independence-day", "christmas-eve", "christmas-day", "boxing-day", "new-years-eve"];
const AFTER = BEFORE.filter((k) => k !== "remembrance-day");
A("Veterans Day 2026 is Wednesday, November 11, a game night, and new seasons never default it on", CG.holidayDate("remembrance-day", 2026) === "2026-11-11" && CG.dayOfWeek("2026-11-11") === 3 && CG.HOLIDAY_DEFAULTS.indexOf("remembrance-day") < 0);
/* the playoff generator: Round 1 from playoffs_start_at, later rounds two days after the last playoff game, three
   nights from the season's own holiday list. Pinned so the rounds below model the real generator. */
A("the generator anchors Round 1 on playoffs_start_at and later rounds two days after the last playoff game, over the season's holidays",
  /var anchor = s\.playoffs_start_at \? CG\.etYMD\(s\.playoffs_start_at\)/.test(live) && /anchor=CG\.dayAdd\(CG\.etYMD\(new Date\(last\)\.toISOString\(\)\),2\);/.test(live) &&
  /var plan=CG\.gameNights\(anchor, 3, shpP\.nights, CG\.seasonHolidayKeys\(s\)\);/.test(live));
const rounds = (keys) => { let anchor = CG.etYMD("2026-11-05T02:00:00Z"), out = []; for (let r = 1; r <= 3; r++) { const wk = CG.gameNights(anchor, 3, 3, keys).nights[0].days; out.push(wk[0] + ".." + wk[2]); anchor = CG.dayAdd(wk[2], 2); } return out; };
const was = rounds(BEFORE), now = rounds(AFTER);
A("before: Round 2 skipped Veterans Day week and the final fell on December 2 to 4", JSON.stringify(was) === JSON.stringify(["2026-11-04..2026-11-06", "2026-11-18..2026-11-20", "2026-12-02..2026-12-04"]), was);
A("after: Season 1's playoffs are Nov 4 to 6, Nov 11 to 13 and the final Nov 18 to 20", JSON.stringify(now) === JSON.stringify(["2026-11-04..2026-11-06", "2026-11-11..2026-11-13", "2026-11-18..2026-11-20"]), now);
/* Rule S2.1 from that final: the Saturday of the following week, the week after that, the Saturday of the week after */
const finalFri = "2026-11-20", ownerClose = CG.dayAdd(finalFri, 8), decideBy = CG.dayAdd(ownerClose, 7), draft = CG.dayAdd(decideBy, 7), cutoff = CG.dayAdd(draft, -1);
A("Rule S2.1 from the Nov 20 final: owner close Sat Nov 28, decided by Sat Dec 5, cutoff Fri Dec 11, draft Sat Dec 12",
  ownerClose === "2026-11-28" && decideBy === "2026-12-05" && draft === "2026-12-12" && cutoff === "2026-12-11" && [ownerClose, decideBy, draft].every((d) => CG.dayOfWeek(d) === 6), [ownerClose, decideBy, cutoff, draft]);
A("...and the draft week and the cutoff are clear of holidays, so neither moves", !CG.holidayWeek("2026-12-09", AFTER));
A("...the owner close sits in Thanksgiving week, which Rule S2.1 does not move", !!CG.holidayWeek("2026-11-25", AFTER));
const reg = CG.gameNights("2026-12-16", 6, 3, AFTER), weeks = reg.nights.map((x) => x.wed + ".." + x.fri);
A("Season 2: Week 1 Dec 16 to 18, Christmas Eve and New Year's Eve weeks skipped, Weeks 2 to 6 Jan 6 to Feb 5",
  JSON.stringify(weeks) === JSON.stringify(["2026-12-16..2026-12-18", "2027-01-06..2027-01-08", "2027-01-13..2027-01-15", "2027-01-20..2027-01-22", "2027-01-27..2027-01-29", "2027-02-03..2027-02-05"]) &&
  JSON.stringify(reg.skipped.map((h) => h.week)) === JSON.stringify(["2026-12-23", "2026-12-30"]), [weeks, reg.skipped.map((h) => h.week)]);
A("...the movement deadline is the end of Week 4, Friday, January 22", reg.nights[3].fri === "2027-01-22");
const po = CG.gameNights(CG.dayAdd(reg.nights[5].fri, 1), 3, 3, AFTER).nights.map((x) => x.wed + ".." + x.fri);
A("...and the playoffs are Feb 10 to 12, Feb 17 to 19 and Feb 24 to 26", JSON.stringify(po) === JSON.stringify(["2027-02-10..2027-02-12", "2027-02-17..2027-02-19", "2027-02-24..2027-02-26"]), po);

console.log("\n2. The SQL record");
const want = {
  owner_app_deadline: [ownerClose, "23:59"], registration_deadline: [cutoff, "23:59"], signup_deadline_at: [cutoff, "23:59"],
  draft_at: [draft, "21:00"], starts_at: [reg.nights[0].wed, "21:00"], ends_at: [reg.nights[5].fri, "23:59"], playoffs_start_at: ["2027-02-10", "21:00"]
};
Object.keys(want).forEach((col) => {
  const [d, hm] = want[col], utc = CG.etISO(d, hm).replace("T", " ").replace(":00.000Z", ":00+00");
  A("SQL sets " + col + " to " + d + " " + hm + " ET and self-checks the same instant (" + utc + ")",
    new RegExp(col + "\\s+= timestamptz '" + d + " " + hm + ":00 America/New_York'").test(sql) && new RegExp("s2\\." + col + "\\s+<> timestamptz '" + rx(utc) + "'").test(sql));
});
A("each update is keyed on the old value and must hit exactly one row", /and owner_app_deadline\s+= timestamptz '2026-12-13 04:59:00\+00'/.test(sql) && /and draft_at\s+= timestamptz '2027-01-10 02:00:00\+00'/.test(sql) &&
  /and playoffs_start_at\s+= timestamptz '2027-02-25 02:00:00\+00'/.test(sql) && (code(sql).match(/if n <> 1 then raise exception/g) || []).length === 3);
A("Veterans Day comes off both seasons' lists, guarded on being there", (code(sql).match(/skip_holidays\s+= array_remove\(skip_holidays, 'remembrance-day'\)/g) || []).length === 2 &&
  (code(sql).match(/'remembrance-day' = any\(skip_holidays\)/g) || []).length === 2);
A("...and the self-check pins the remaining nine, the same on both seasons", new RegExp("array\\['" + AFTER.slice(0, 5).join("','") + "',\\s*'" + AFTER.slice(5).join("','") + "'\\]::text\\[\\]").test(sql) && /s2\.skip_holidays is distinct from s1\.skip_holidays/.test(sql));
A("owner_decision_by_2 moves from Dec 19 to Dec 5, keyed on the old value", /set value = '2026-12-05T23:59:00-05:00'\s+where key = 'owner_decision_by_2' and value = '2026-12-19T23:59:00-05:00'/.test(sql));
A("Season 1's playoffs_start_at is checked, never set", /s1\.playoffs_start_at <> timestamptz '2026-11-05 02:00:00\+00'/.test(sql) && !/set[^;]*playoffs_start_at[^;]*where number = 1/.test(code(sql)));
A("the pre-check refuses when playoff games, Season 2 games, picks or a draft room already exist", /g\.stage = 'playoff'/.test(sql) && /from public\.draft_picks dp where dp\.season_number = 2/.test(sql) && /from public\.draft_state ds where ds\.season_number = 2/.test(sql));
A("nothing posts at change time: the reg_open marker is required and every new instant is a day off", /key = 'ann_2_reg_open'/.test(sql) && /s2\.registration_deadline <= now\(\) \+ interval '24 hours'/.test(sql));
A("the record quotes the commissioner, has no exception handler, and no em dash", /"Lets push the season 2 start up to what we discussed the other day/.test(sql) && !/exception when/i.test(code(sql)) && !/[\u2013\u2014]/.test(sql));
A("applied and audited", /-- Applied 2026-10-24 with apply_migration v431_season2_move_up; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
A("the rehearsal probe ends in an uncaught raise and is commented out of the migration", /raise exception 'REHEARSAL OK:/.test(sql) && !/REHEARSAL OK/.test(code(sql)));
A("the stored opening post keeps its old text (history; it is never posted again)", !/ann_text_2_reg_open'?\s*(=|,)/.test(code(sql)));

console.log("\n3. The rendered rulebook");
const P3 = {}; new Function("CG", R("src/live/part3_content.js"))(P3);
const rb = P3.CONTENT.rulebook;
const K = {}, c0 = pub2.indexOf("CG.rulebookForFormat = function");
new Function("CG", pub2.slice(c0, pub2.indexOf("\nCG.ROUTES.rulebook", c0)))(K);
const books = { basic: K.rulebookForFormat(rb, "basic"), full: K.rulebookForFormat(rb, "full") };
const bound = (book, id) => (book.chapters.filter((c) => !c.shelved).flatMap((c) => c.sections).find((s) => s.id === id) || { paragraphs: [] }).paragraphs.join(" ");
Object.keys(books).forEach((f) => {
  const s21 = bound(books[f], "S2.1"), s22 = bound(books[f], "S2.2");
  A(f + ": S2.1 counts from the November 18 to 20 final", /with Season 1's final scheduled for November 18 to 20, 2026: owner applications close Saturday, November 28, 2026 at 11:59 PM; owners are decided and assigned by Saturday, December 5; registration for the draft closes Friday, December 11 at 11:59 PM; the draft is Saturday, December 12, 2026 at 9:00 PM; and the first game is Wednesday, December 16, 2026\./.test(s21), s21.slice(0, 200));
  A(f + ": ...Week 1 before Christmas, two holiday weeks skipped, the deadline and the playoffs", /The first game-week is played December 16 to 18\. The weeks of December 21 and December 28 are holiday weeks and are skipped \(Rule 3\.1\), so the remaining five \(5\) game-weeks are played from January 6 to February 5, 2027; the movement deadline is midnight Eastern Time at the end of Friday, January 22, 2027, the close of the fourth \(4th\) game-week \(Rule 2\.4\); and the playoffs are played February 10 to 12, February 17 to 19 and February 24 to 26, 2027 \(Chapter 8\)\./.test(s21));
  A(f + ": ...the general rule and the republish clause stay", /close at 11:59 PM Eastern on the Saturday of the following week/.test(s21) && /If Season 1's final moves, these dates move by the same rule and are published again\./.test(s21));
  A(f + ": S2.2 decides by Saturday, December 5", /assigns the clubs in the week that follows, by Saturday, December 5\./.test(s22));
  const s2text = books[f].chapters.filter((c) => c.num === "S2").map((c) => JSON.stringify(c)).join(" ");
  const stale = ["December 2 to 4", "Saturday, December 12, 2026 at 11:59 PM", "December 19", "January 9", "January 8", "January 13", "so the draft is"].filter((t) => s2text.indexOf(t) > -1);
  A(f + ": no old Season 2 date is left in Chapter S2", stale.length === 0, stale);
});
const s2raw = JSON.stringify(rb.chapters.find((c) => c.num === "S2"));
A("Chapter S2 still has seven sections, no full texts, no em dash and no gendered pronoun", rb.chapters.find((c) => c.num === "S2").sections.length === 7 && !/"full"/.test(s2raw) && !/[\u2013\u2014]/.test(s2raw) && !/\b(he|his|him|she|her)\b/i.test(s2raw));
A("the holiday rule itself is unchanged (Rules 0.7 and 3.1 skip a week holding an observed holiday)", /A game-week containing a league-observed holiday is skipped in full/.test(bound(books.basic, "0.7")) && /Game-weeks holding a league-observed holiday are skipped in full/.test(bound(books.basic, "3.1")));

console.log("\n4. The changelog");
const e = rb.changelog.find((c) => c.version === "4.31") || {};
const ej = JSON.stringify(e);
A("4.31 is dated 2026-10-24 and says what moved", e.dateIso === "2026-10-24" && /Veterans Day week is now played/.test(e.summary || "") && /Saturday, December 12/.test(e.summary || "") && /November 18 to 20/.test(e.summary || ""), e);
A("...naming the owner close, the decisions, the cutoff and survey, the draft, Week 1, the deadline and the playoffs", ["November 28", "December 5", "December 11", "Season 1 survey", "December 12", "December 16 to 18", "January 22", "February 10 to 26"].every((t) => ej.indexOf(t) > -1));
A("...and the rules it changed, with no em dash, spaced hyphen or gendered pronoun", /Rules S2\.1 and S2\.2/.test(ej) && !/[\u2013\u2014]| - /.test(ej) && !/\b(he|his|him|she|her)\b/i.test(ej));
A("...placed above 4.28 (newest first; 4.29 and 4.30 sit between when they ship first)", rb.changelog.indexOf(e) > -1 && rb.changelog.indexOf(e) < rb.changelog.findIndex((c) => c.version === "4.28"));
A("history stays: 3.95 and 4.23 still carry the January dates they shipped", /Jan|January/.test(JSON.stringify(rb.changelog.find((c) => c.version === "3.95") || {})) && /Friday, January 8 at 11:59 PM ET/.test(JSON.stringify(rb.changelog.find((c) => c.version === "4.23") || {})));

console.log("\n5. Site copy");
A("the Awards page no longer promises a December finale", !/December finale/.test(pub2) && /season hardware after the final\."\);/.test(pub2));
const shown = fs.readdirSync(path.join(ROOT, "src/live")).filter((f) => /\.(js|html)$/.test(f) && f !== "part3_content.js")
  .filter((f) => /December (2 to 4|12, 2026 at 11:59|19)|January (8|9|13), 2027/.test(code(R("src/live/" + f))));
A("no other site file shows an old Season 2 date outside comments", shown.length === 0, shown);
/* the survey stops at the Season 2 sign-up deadline read from the row, so the new row stops it on Dec 11 */
const iw = survey.slice(survey.indexOf("SV.inWindow = function"), survey.indexOf("\n};", survey.indexOf("SV.inWindow = function")) + 3);
const SV = { SEASON: 2 }; new Function("SV", "CG", iw)(SV, {});
const row = [{ number: 1, status: "active" }, { number: 2, status: "upcoming", signup_deadline_at: "2026-12-12T04:59:00Z", registration_deadline: "2026-12-12T04:59:00Z" }];
A("the Season 1 survey shows through Fri Dec 11 11:58 PM ET and stops at 11:59 PM ET", SV.inWindow(row, Date.parse("2026-12-12T04:58:00Z")) && !SV.inWindow(row, Date.parse("2026-12-12T04:59:00Z")));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
