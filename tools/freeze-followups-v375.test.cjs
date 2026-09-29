/* v3.75: follow-ups from the adversarial review of v3.72. The database half was rehearsed in Postgres (recorded at
   the foot of the SQL file). */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-29-freeze-followups-v375.sql"), live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), pub = R("src/live/part5a_public.js");

A("a player released from camp in the freeze and signed back by the same club returns to camp",
  /if v_left\.team_id = NEW\.team_id and v_left\.squad = ''tc''/.test(sql) && /v_left\.removed_at >= public\.roster_freeze_ends_at\(\) - interval ''52 hours 30 minutes''/.test(sql) && /NEW\.squad := ''tc'';/.test(sql));
A("...the league office and automation pass, as they do the freeze", /if public\.roster_freeze_at\(\) and not \(public\.is_commissioner\(\) or public\.trusted_writer\(\)\) then/.test(sql));
A("signings count a called-up depth player like the shape check does", /not in \(''preseason_random'',''latecomer_random''\);   -- v3\.75/.test(sql));
A("a trade names each player once", /raise exception ''Rule 2\.3: a trade names each player once, on one side\. Build the offer again\.''/.test(sql));
A("...and the placement de-duplicates anyway", /select array_agg\(u\.pid order by u\.o\) into p_incoming/.test(sql));
A("the shape check judges the row as it stands, in its current group", /select \* into v_cur from public\.roster_spots where id = NEW\.id;/.test(sql) && /'  v_grp := public\.pos_group\(v_cur\.position\);'/.test(sql));
A("the rehearsal is recorded", /REHEARSAL OK: R1 ok; R1b ok; R2 ok; R3 ok; R4 ok; R5 ok\./.test(sql));

A("the site mirrors the movement deadline", /CG\.movesLockedNow = function\(\)\{/.test(live) && /s\.moves_lock_override === "locked"/.test(live));
A("...and the freeze notes say trades are open only before it", /if \(fzT\.on && !\(CG\.movesLockedNow && CG\.movesLockedNow\(\)\)\)/.test(live) && /Trades and waivers closed at the movement deadline \(Rule 2\.4\)\./.test(hub) && /" Trades stay open until the movement deadline\."/.test(live));
A("the over-limit note knows whether the freeze is on", /Send-downs are locked by the weekly roster freeze until '\+esc\(fzOv\.reopens\)/.test(hub) && /a waiver or a trade is the way to comply/.test(hub));
A("placement copy names the full-group case, everywhere it is shown",
  (live.match(/unless his position group or the active roster is full, when he joins training camp instead/g) || []).length >= 3 &&
  (hub.match(/unless his position group or the active roster is full, when he joins training camp instead/g) || []).length >= 2);
A("the camp toast is skipped when the reload failed", /\.then\(function\(ok\)\{\s+if \(ok === false\) return;/.test(live) && /return true;\s+\} catch\(e\)\{ CG\.toast\("Reload failed\. Refresh the page\.","err"\); return false; \}/.test(live));
A("the Control Center format note gives the camp limit", !/with unlimited camp, everyone/.test(live) && /" with a training camp of up to "\+r\.camp_max/.test(live));
A("the hover note reads naturally", /" games played" \+ at \+ "\. A rating is held toward 70/.test(pub));

global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const p3 = secs["2.1"].paragraphs[3], e = rb.changelog.find((c) => c.version === "3.75");
A("2.1.4: a player released and signed back in the freeze returns to the squad he left", /A player a club releases during the freeze and signs back before it lifts returns to the squad he left\./.test(p3));
A("...a management seat is a freeze exception", /a player named to a management seat from the training camp comes up to the active roster with the seat even in the window \(Rule 2\.6\)/.test(p3));
A("...no overclaim; a series arranged to dodge the freeze may be reversed", !/a trade never serves as a call-up/.test(p3) && /may be voided or reversed \(Rule 2\.3\)/.test(p3));
A("Appendix A carries the weekly freeze", /The roster freezes each week from Wednesday at 7:30 PM Eastern until midnight at the end of Friday/.test(secs["2.1"].full[2]) && /outside the weekly roster freeze/.test(secs["2.1"].full[2]));
A("changelog records 3.75", !!e && e.dateIso === "2026-09-29");
A("no em dashes or spaced hyphens in the 3.75 entry", !/—| - /.test(JSON.stringify(e)));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
