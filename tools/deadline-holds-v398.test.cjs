/* v3.98 (2026-10-13): the movement deadline holds once it passes, and nothing it closed stays open. Commissioner: "Make
   sure the locks for the season 1 deadline are ready to automatically launch at the deadline."
   Rehearsed on production rolled back with the deadline week set to week 3: the sign-up switch fixed the deadline and
   switched sign-ups to Season 2, and the opening post went out; setting the week back to 4 left the deadline where it was;
   the watchdog flagged the three open offers, the sweep closed them with 18 on-site notices (no club-room post, no
   #transactions line) and took down 23 trade-block listings without a post, and the watchdog went quiet; an Owner could no
   longer list a player or edit a join date or pre-seat salary; an office trade made after the deadline survived the sweep
   and its receiving Owner could still decline it; a queued waive was refused; a staff reinstatement was refused. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-13-deadline-holds-v398.sql"), live = R("src/live/part_live.js"),
      pub = R("src/live/part5a_public.js"), hub = R("src/live/part6_hub.js"), sched = R("jobs/discord-scheduler.js");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 240))); } };

console.log("— the database");
A("the deadline is fixed when it passes, and the deadline function reads it first",
  /add column if not exists movement_deadline_fixed timestamptz/.test(sql) &&
  /select coalesce\(s\.movement_deadline_fixed, case when s\.trade_deadline_week is null/.test(sql));
A("the sign-up switch fixes it before anything reads it", /perform public\._latch_movement_deadlines\(\);\n  update public\.seasons set status = ''active''/.test(sql));
A("declining or withdrawing an open offer is never refused by the deadline",
  /and not \(tg_op = ''UPDATE'' and new\.status in \(''declined'', ''cancelled''\)\)/.test(sql));
A("an unanswered offer closes at the deadline, on the site only (p_room false)",
  /new\.status = ''cancelled'' and v_op = ''deadline''/.test(sql) && /closed at the deadline'',\n\s+''Your offer of/.test(sql) &&
  /\(Rule 2\.4\)\.'', null, ''manager'', null, null, false\);/.test(sql));
A("the sweep closes only offers made before the deadline, and listings come down without a post",
  /status = 'proposed' and created_at < v_s\.dl/.test(sql) && /set_config\('app\.mgr_sync', '1', true\);\n\s+update public\.roster_spots set on_block = false/.test(sql));
A("the sweep runs as its own job, never inside the sign-up switch", /cron\.schedule\('deadline-sweep', '\*\/5 \* \* \* \*', 'select public\._deadline_sweep\(\)'\)/.test(sql));
A("no new listing after the deadline; taking one off is always allowed",
  /new\.on_block and not coalesce\(old\.on_block, false\) and public\.moves_locked\(new\.season_id\)/.test(sql));
A("the join date and pre-seat salary are the league's", /before update of created_at, pre_seat_salary, on_block on public\.roster_spots/.test(sql) &&
  /current_setting\('app\.mgr_sync', true\), ''\) = '1'\) then\n\s+raise exception 'A roster spot''s join date and pre-seat salary are kept by the league\.'/.test(sql));
A("the Owner queue refuses what the deadline closed, and the sweep withdraws what waits",
  /p_action in \(''waive_player'', ''trade_propose'', ''accept_trade'', ''offer_free_agent''\)/.test(sql) &&
  /result = 'closed at the movement deadline \(Rule 2\.4\)'/.test(sql));
A("past the deadline a reinstatement or a rostered withdrawal is a commissioner's",
  /only a commissioner can put a removed player back on a roster/.test(sql) && /only a commissioner can withdraw a rostered player''''s sign-up/.test(sql));
A("the watchdog checks the switch 20 minutes after a deadline and watches the new job",
  /now\(\) < v_dl \+ interval '20 minutes'/.test(sql) && /\(''deadline-sweep'', interval ''1 hour''\),/.test(sql) &&
  /perform public\._watch_season_switch\(\);/.test(sql));
A("internal functions are not callable by members",
  ["_latch_movement_deadlines", "_deadline_sweep", "_watch_season_switch", "guard_roster_after_deadline"]
    .every((f) => new RegExp("revoke execute on function public\\." + f + "\\(\\) from public, anon, authenticated;").test(sql)));

console.log("— the site");
A("the site reads the fixed deadline first", /if \(s\.movement_deadline_fixed\) return Date\.parse\(s\.movement_deadline_fixed\);/.test(pub));
A("the office keeps its buttons; everyone else sees them closed",
  /CG\.movesClosedForMe = function\(\)\{ return !!\(CG\.movesLockedNow && CG\.movesLockedNow\(\)\) && CG\.role\(\) !== "commish"; \};/.test(live));
A("the Trade Hub keeps Decline and Withdraw, drops Counter, Accept and the builder",
  /\(dlShut \? '' : '<button class="btn btn-ghost btn-sm" data-trade-counter=/.test(live) &&
  /\(dlShut \? '' : '<button class="btn btn-chrome btn-sm" data-trade-accept=/.test(live) && /return h\+\(dlShut\?'':build\)\+inc\+outCard/.test(live) &&
  /data-trade-decline="'\+tr\.id\+'">Decline<\/button>/.test(live) && /data-trade-cancel="'\+tr\.id\+'">Withdraw offer/.test(live));
A("the club's open offers are this season's", /\.eq\("status","proposed"\)\.eq\("season_id", \(CG\.SEASON\|\|\{\}\)\.id/.test(live));
A("Sign opens after the deadline only with a replacement signing",
  /from\("replacement_signings"\)\.select\("id"\)\.eq\("team_id", myTid\)/.test(live) && /if \(dlClosed && !dlRepl\) canSign = false;/.test(live));
A("the roster's To block, Trade and Waive close; Off block stays",
  /\(\(CG\.movesClosedForMe && CG\.movesClosedForMe\(\)\) && !onBlk\) \? '<button class="btn btn-ghost btn-sm" disabled/.test(hub) &&
  /if \(CG\.movesClosedForMe && CG\.movesClosedForMe\(\)\) return '<button class="btn btn-ghost btn-sm" disabled title="'\+esc\(CG\.MOVES_CLOSED\)\+'">Waive<\/button>';/.test(hub));
A("a Season 2 sign-up is told it joins the training camp pool, never a club",
  /\(upChR\n\s+\? \(\(reg\.created_at/.test(live) && /If you’re not drafted you join the league-wide training camp pool \(Chapter S2\)/.test(live));

console.log("— Discord");
A("the casework reminder skips owner applications that cannot be decided yet",
  /const oa = oaAll\.filter\(\(a\) => !\(appsClose\[a\.season_id\] > Date\.now\(\)\)\);/.test(sched) && /sbGet\("seasons\?select=id,owner_app_deadline"\)/.test(sched));

console.log("— the rulebook and changelog");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, r24 = rb.chapters.flatMap((c) => c.sections || []).find((x) => x.id === "2.4");
A("Rule 2.4 says the deadline is fixed when it passes, in both formats",
  [r24.paragraphs[0], r24.full[0]].every((p) => /The deadline is fixed at the moment it passes: rescheduling a game afterwards neither moves it nor reopens movement\./.test(p)));
const cl = rb.changelog.find((c) => c.version === "3.98");
A("changelog 3.98 is in the book", !!cl && cl.items.length >= 8);
A("no em dash in what v3.98 wrote", !/—/.test(JSON.stringify(cl)) && !/—/.test(sql) &&
  !/—/.test(r24.paragraphs[0].slice(r24.paragraphs[0].indexOf("The deadline is fixed"))));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
