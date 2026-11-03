/* v4.44: leaving the league Discord no longer brings a suspension (Rules 1.1 and 7.2). node tools/departure-no-suspension-v444.test.cjs
   Commissioner, 2026-11-03: "can you remove the auto suspension feature for players leaving the league?", then, asked about
   the seven members already serving a departure suspension, "Keep them running". The 24-hour windows and the removals stay;
   only the suspension and every promise of it go. Pins the SQL record, the site copy, the rendered rulebook and the
   changelog entry. tools/departure-suspension-v430.test.cjs keeps what still serves the seven running suspensions. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };

console.log("1. The database record");
const sql = R("sql/2026-11-03-no-departure-suspension-v444.sql");
const fn = (name) => { const m = sql.match(new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\nend \\$function\\$;")); return m ? m[0] : ""; };
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");   /* the history in the comments names the v4.30 door on purpose */
const roster = fn("sweep_roster_departures"), signup = fn("remove_departed_signups");
A("the header quotes the commissioner, both times", /"can you remove the auto suspension feature for players leaving the league\?"/.test(sql) && /"Keep them running"/.test(sql));
A("both sweeps are written out in full, same signatures (CREATE OR REPLACE keeps the grants)", !!roster && !!signup
  && !/drop function public\.(sweep_roster_departures|remove_departed_signups)/.test(sql)
  && /returns table\(action text, gamertag text, club text, detail text\)/.test(roster) && /returns table\(action text, profile_id uuid, gamertag text, detail text\)/.test(signup));
A("...and neither issues or promises a suspension", [roster, signup].every((f) => !/(_suspend_for_departure|_departure_suspension_until|_departure_suspension_exempt|suspended through|suspension follows|lift the suspension)/.test(code(f))));
A("...each carries its v4.44 note and keeps the history it had", [roster, signup].every((f) => /v4\.44 \(commissioner, 2026-11-03\)/.test(f))
  && /THE NOTICE IS THE CLOCK/.test(roster) && /v3\.50 \(2026-09-28\): the sweep had been dead since 2026-09-25 23:49 ET/.test(roster));
A("the club's notice warns of the removal only and marks nothing", /' ET to rejoin\. If they do not, their sign-up is revoked and they come off your squad \(Rule 1\.1\)\.'/.test(roster)
  && /insert into public\.roster_departure_notices\(profile_id, season_id, team_id, deadline_at\)/.test(roster) && /suspension_warned = false;/.test(roster));
A("the rejoin notice drops \"no suspension follows\"", /Their spot is safe and there is nothing to do\./.test(roster) && !/no suspension follows/.test(roster));
A("the removal is unchanged apart from the suspension (archive, both deletes, the guard, the replacement, the audit)",
  /'left_discord', to_jsonb\(sr\.\*\)/.test(roster) && /if v_n = 0 then raise exception 'Rule 1\.1 removal touched no roster spot/.test(roster)
  && /_grant_replacement\(r\.season_id, r\.team_id, r\.profile_id, 'they left the league Discord'\)/.test(roster)
  && /jsonb_build_object\('player',r\.gt,'club',r\.tc,'deadline',r\.deadline_at\)\);/.test(roster) && /detail:='did not return';/.test(roster));
A("a window that closes after the season is complete keeps the roster and suspends nobody", /detail:='season complete, roster kept';/.test(roster));
A("the sign-up warning says the withdrawal only, and every departing member is warned", /' ET, or your season sign-up is withdrawn \(Rule 1\.1\)\.'/.test(signup)
  && !/_departure_suspension_exempt/.test(code(signup)) && !/suspension_warned/.test(code(signup)));
A("...the withdrawal tells the member to rejoin and sign up again", /Rejoin the server and sign up again any time; a new sign-up follows the normal '\|\|\s+'draft-eligibility rules\./.test(signup)
  && /detail := case when r\.warned then 'after the site notice' else 'no notice for this departure' end;/.test(signup));
A("...one savepoint per row is kept", (signup.match(/exception when others then/g) || []).length === 2 && /for update skip locked/.test(signup));
A("the three v4.30 doors are dropped", /drop function public\._suspend_for_departure\(uuid, text\);/.test(sql) && /drop function public\._departure_suspension_until\(\);/.test(sql)
  && /drop function public\._departure_suspension_exempt\(uuid\);/.test(sql));
A("the self-checks raise on a promise, a door, a grant or a missing piece that serves the running seven",
  ["still issues or promises a departure suspension", "a retired departure suspension door still exists", "a sweep grant is wrong", "what serves a running departure suspension is missing"].every((t) => sql.indexOf(t) >= 0));
A("nothing in the record posts to Discord directly", !/net\.http_post|discord_http_post\(/.test(sql));
A("rehearsed on production, rolled back, applied, audited", /Result: REHEARSAL OK: T0 T1 T2 T3 T4 T5/.test(sql)
  && /Applied as migration v444_no_departure_suspension; md5\(prosrc\) of both sweeps equals this file's text;\s+tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
A("no dash as punctuation in the record's words", !/[—–]/.test(sql));

console.log("\n2. The site");
const live = R("src/live/part_live.js");
A("the Register page: withdrawn after a day, and rejoin to sign up again", /leave it and your registration is withdrawn automatically after about a day \(Rule 1\.1\)\. Rejoin and you can sign up again\. By registering/.test(live));
A("the pool caption", /Leaving the Discord withdraws a pending sign-up after about a day \(Rule 1\.1\)\.<\/p>/.test(live));
A("the office's archive card", /counted from the warning the site sends them\. The member may rejoin and sign up again\. The full registration is archived with its original sign-up date, so the office can restore one that was removed in error\./.test(live));
A("the account switch card", /'\. A pending sign-up is withdrawn after about a day out of the server \(Rule 1\.1\), so join now\.'/.test(live));
A("no site copy promises a departure suspension any more", !/brings a suspension through the next season|you are suspended through the next season|is also suspended through the next season|lifting the suspension first/.test(live));
A("the appeal form still covers the suspensions already running", /Appeal a ruling within 48 hours, or a suspension for leaving the Discord at any time while it runs \(Rule 7\.6\)\./.test(live));

console.log("\n3. The rulebook, as rendered");
/* eval of this repo's own source (the content file and the site's format filter), as departure-suspension-v430 does */
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = (id) => [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === id) || { paragraphs: [] };
eval(R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0]);
for (const fmt of ["basic", "full"]) {
  const b = JSON.stringify(CG.rulebookForFormat(rb, fmt).chapters);
  A("the " + fmt + " book: a withdrawn sign-up carries no suspension", /which gives the deadline\. Leaving the server carries no suspension: a player whose sign-up is withdrawn may rejoin and sign up again\./.test(b)
    && !/warns that a suspension follows/.test(b) && !/is also suspended for the remainder of the current season/.test(b) && !/brings a suspension through the following season/.test(b));
  A("the " + fmt + " book: 7.2 paragraph 7 is the transitional paragraph", /No member is suspended for leaving the league Discord\. Until November 3, 2026,/.test(b) && /a suspension issued that way stands and runs as issued\./.test(b)
    && !/A member is suspended automatically, without a ruling by an official/.test(b));
}
const p11 = sec("1.1").paragraphs, p72 = sec("7.2").paragraphs;
A("1.1.5: the club's notice warns of the removal only, and nothing suspends", /warning that a player who does not rejoin in time is removed, and the club's management/.test(p11[4])
  && /they are removed from the club's roster or training camp, and the spot is free for the club to fill\./.test(p11[4])
  && /is never removed automatically; the league office/.test(p11[4]) && /a commissioner who leaves is referred to the commissioners, and a club seat/.test(p11[4]) && !/suspend/i.test(p11[4]));
A("7.2: still seven paragraphs, and paragraph 7 says how a running one is lifted", p72.length === 7
  && /It is lifted only when the league office grants the member's appeal under Rule 7\.6, and lifting it restores no roster spot or sign-up by itself\./.test(p72[6]));
A("0.3 in both formats: the day of grace, no suspension", /withdrawn automatically after one day's grace \(Rule 1\.1\)\./.test(sec("0.3").paragraphs.join(" "))
  && /does the same thing automatically after a day's grace \(Rule 1\.1\)\. Once placed/.test((sec("0.3").full || []).join(" ")));
const changed = JSON.stringify(["0.3", "1.1", "7.2"].map((k) => [sec(k).paragraphs, sec(k).full || []]));
A("no dash as punctuation and no gendered pronoun in the changed sections", !/[—–]| - /.test(changed) && !/\b(he|his|him|she|her|hers)\b/i.test(changed));

console.log("\n4. The changelog");
const e = rb.changelog.find((c) => c.version === "4.44") || {};
A("4.44 is recorded, newest first", e.version === "4.44" && rb.changelog.indexOf(e) === rb.changelog.findIndex((c) => Number(c.version) <= 4.44));
A("...in key order", JSON.stringify(Object.keys(e)) === JSON.stringify(["version", "dateIso", "summary", "items"]));
A("...saying no suspension, the removal kept, the running ones kept, and naming the rules", /no longer brings a suspension/.test(e.summary || "")
  && /still stand and can be appealed at any time while they run \(Rule 7\.6\)/.test(JSON.stringify(e.items)) && /Rules changed: 0\.3, 1\.1 \(paragraphs 4 and 5\) and 7\.2 \(paragraph 7\)\./.test(JSON.stringify(e.items)));
A("...with no em dash or gendered pronoun", !/[—–]| - /.test(JSON.stringify(e)) && !/\b(he|his|him|she|her|hers)\b/i.test(JSON.stringify(e)));

console.log("\n" + pass + "/" + (pass + fail) + " passed");
if (fail) process.exit(1);
