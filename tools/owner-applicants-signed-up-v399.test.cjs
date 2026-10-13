/* v3.99 (2026-10-13). Commissioner: "Make sure players currently playing in season 1 can sign up for season 2 when the
   signups open since they dont overlap. Make sure a player cannot apply for an ownership position unless they are already
   signed up for the season."
   Rehearsed on production rolled back after a simulated Oct 17 switch: a member with no Season 2 sign-up was refused; a
   player on a Season 1 roster signed up for Season 2 (no Season 2 spot made, the Season 1 spot kept); the signed-up
   player's application was stamped Season 2; withdrawing the sign-up withdrew the application and told the player; filing
   it again without a sign-up was refused. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-13-owner-applicants-signed-up-v399.sql"), live = R("src/live/part_live.js");
let fail = 0, n = 0;
const A = (name, cond) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name); } };

console.log("— the database");
A("an application needs the applicant's sign-up for its own season",
  /where r\.profile_id = new\.profile_id and r\.season_id = new\.season_id and r\.status <> 'declined'\) then/.test(sql) &&
  /raise exception 'SIGN_UP_FIRST: Sign up to play in Season % before applying to own a club\./.test(sql));
A("...checked when it is made and when a withdrawn one is filed again",
  /if tg_op = 'INSERT' then\n\s+v_check := true;/.test(sql) && /\(new\.status = 'pending' and old\.status is distinct from 'pending'\)/.test(sql));
A("...after the season is stamped (ab_ fires after aa_stamp_owner_app_season)",
  /create trigger ab_guard_owner_app_signed_up before insert or update on public\.owner_applications/.test(sql));
A("a sign-up withdrawn, removed or declined withdraws the pending application, and tells the member",
  /after delete or update of status on public\.season_registrations/.test(sql) &&
  /update public\.owner_applications set status = 'withdrawn'\n\s+where profile_id = v_pid and season_id = v_sid and status = 'pending';/.test(sql) &&
  /'Owner application withdrawn'/.test(sql));
A("...and never blocks the sign-up's own removal", /exception when others then\n\s+perform set_config\('app\.app_decide', '', true\);\n\s+perform public\.notify_commissioners/.test(sql));
A("the rule is kept at the application, not at approval (the resolver must not stall)", !/new\.status = 'approved'/.test(sql));
A("nothing in this file touches sign-ups themselves", !/create trigger [a-z_]+ before insert[^;]*on public\.season_registrations/.test(sql));
A("the opening post changes only while it has not gone out",
  /and not exists \(select 1 from public\.app_config where key = 'ann_2_reg_open'\);/.test(sql) &&
  /Everyone signs up again for Season 2, players on a Season 1 roster included\./.test(sql) && /only a signed-up player can apply\./.test(sql));

console.log("— the site");
A("the Owner page asks for the sign-up first and disables Submit",
  /var needSignup = !lockedFromOwning && !deadlineClosed && !\(CG\.isRegisteredNow && CG\.isRegisteredNow\(\)\);/.test(live) &&
  /\(lockedFromOwning\|\|deadlineClosed\|\|needSignup\)\?" disabled"/.test(live) && /href="#\/register">Sign up to play<\/a>/.test(live));
A("submitting without a sign-up sends the member to sign up", /only a signed-up player can apply","err"\); location\.hash="#\/register"; return; \}/.test(live));
A("the database's refusal reads as plain words", /\/SIGN_UP_FIRST:\/\.test\(em\) \? em\.replace\(/.test(live));
A("the sign-up page tells a Season 1 player it changes nothing about the current club",
  /The seasons don’t overlap, so it changes nothing about your current club/.test(live));
A("the registration the site loads is the season taking sign-ups", /sidA = \(\(CG\.regSeason && CG\.regSeason\(\)\) \|\| CG\.SEASON \|\| \{\}\)\.id/.test(live) &&
  /from\("season_registrations"\)\.select\("\*"\)\.eq\("season_id", sidA\)/.test(live));

console.log("— the rulebook and changelog");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = rb.chapters.flatMap((c) => c.sections || []);
const r26 = secs.find((x) => x.id === "2.6"), s22 = secs.find((x) => x.id === "S2.2");
A("Rule 2.6 says only a signed-up member applies, in both formats",
  [r26.paragraphs[3], r26.full[3]].every((p) => /^An owner application is made for one season, and only a member signed up to play in that season may make one;/.test(p)));
A("Chapter S2.2 says Season 1 players sign up for Season 2 like anyone else", /a player still playing out Season 1 signs up for Season 2 like anyone else/.test(s22.paragraphs[0]));
const cl = rb.changelog.find((c) => c.version === "3.99");
A("changelog 3.99 is in the book", !!cl && cl.items.length === 5);
A("no em dash in what v3.99 wrote", !/—/.test(JSON.stringify(cl)) && !/—/.test(sql));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
