/* v4.30 (2026-10-24). Commissioner: "Can you automatically suspend a player for the remainder of the season + through the
   next season when they are removed from their roster because of being out of the league discord for 24 hours?"
   Rulings the same day: from now on only, and the warning that starts the 24 hours says a suspension follows; "They can
   join back freely, but are still suspended and need to appeal to lift their suspension if the appeal is passed."; an
   unplaced member's withdrawn sign-up is covered too; Owners, GMs and AGMs stay a manual decision; announced through the
   club's removal notice, the public suspension record and the member's own site notice.
   Pins the SQL record (rehearsed on production, rolled back, then applied), the Edge job's handling of the new rows,
   the public record's wording, the rulebook as rendered, and the changelog entry (found by version).
   Run: node tools/departure-suspension-v430.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 240))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const strip = (s) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const fnBody = (src, head) => { const i = src.indexOf(head); return i < 0 ? "" : src.slice(i, src.indexOf("$function$;", i)); };

console.log("\n1. The database record");
const sql = R("sql/2026-10-24-departure-suspension-v430.sql"), body = strip(sql);
const door = fnBody(body, "create or replace function public._suspend_for_departure(p_profile uuid, p_reason text)");
const exempt = fnBody(body, "create or replace function public._departure_suspension_exempt(p_profile uuid)");
const roster = fnBody(body, "create or replace function public.sweep_roster_departures(p_grace_hours integer default 24)");
const signup = fnBody(body, "create function public.remove_departed_signups(p_grace_hours integer default 24)");
A("the header quotes the commissioner", /"Can you automatically suspend a player for the remainder of the season \+ through the next\n-- season when they are removed from their roster because of being out of the league discord for 24 hours\?"/.test(sql)
  && /"They can join back freely, but are still suspended and need to appeal to lift their\n-- suspension if the appeal is passed\."/.test(sql));
A("one door: internal, search_path '', no API grant", !!door && /security definer\s+set search_path to ''/.test(door)
  && /revoke all on function public\._suspend_for_departure\(uuid, text\) from public, anon, authenticated;/.test(body)
  && /revoke all on function public\._departure_suspension_exempt\(uuid\) from public, anon, authenticated;/.test(body));
A("...a straight insert, not _issue_suspension (a ruling by a person)", !/_issue_suspension\(/.test(door)
  && /insert into public\.suspensions \(profile_id, reason, mode, season_id, status, until_season, scope, grounds\)\s+values \(p_profile, btrim\(p_reason\), 'seasons', v_season, 'active', v_until, 'play', 'departure'\)/.test(door)
  && !/created_by/.test(door.slice(door.indexOf("insert into public.suspensions"))));
A("...the rest of the current season and all of the next, from current_season_id()", /v_season := public\.current_season_id\(\);/.test(door) && /v_until := public\._departure_suspension_until\(\);/.test(door)
  && /select s\.number \+ case when s\.status = 'active' then 1 else 0 end\s+from public\.seasons s where s\.id = public\.current_season_id\(\);/.test(body)
  && /raise exception 'Rule 1\.1 suspension: there is no current season to count from\.'/.test(door));
A("...idempotent: already suspended through that season (any rule) means no second row", /if v_have >= v_until then return v_have; end if;/.test(door)
  && door.indexOf("if v_have >= v_until") < door.indexOf("insert into public.suspensions")
  && /x\.mode = 'seasons' and x\.scope in \('play', 'both'\)\s+and public\.suspension_running_at\(x, now\(\)\)/.test(door));
A("...exempt first, and the exemptions are the ruling's", door.indexOf("if public._departure_suspension_exempt(p_profile)") < door.indexOf("v_season := public.current_season_id();")
  && /coalesce\(p\.banned, false\) or p\.role::text = 'commissioner'/.test(exempt) && /p_profile in \(t\.owner_profile_id, t\.gm_profile_id, t\.agm_profile_id\)/.test(exempt));
A("...audited as automatic", /log_admin_action\('suspension_issued', 'suspension', v_id::text,[\s\S]*'automatic', true\)/.test(door));
A("the markers: grounds (checked), the warned flag (old notices false), the sign-up notice table locked down",
  /alter table public\.suspensions add column grounds text;/.test(body) && /check \(grounds is null or grounds = 'departure'\)/.test(body)
  && /add column suspension_warned boolean not null default false;/.test(body)
  && /alter table public\.signup_departure_notices enable row level security;/.test(body)
  && /revoke all on table public\.signup_departure_notices from public, anon, authenticated;/.test(body));
A("roster sweep: written out in full on search_path ''", !!roster && /security definer\s+set search_path to ''/.test(roster) && /public\.trusted_writer\(\) or public\.is_commissioner\(\) or public\.is_staff\(\)/.test(roster));
A("...the notice warns of the suspension and marks itself", /values \(r\.profile_id, r\.season_id, r\.team_id, now\(\) \+ make_interval\(hours => v_grace\), v_until is not null\)/.test(roster)
  && /rejoined_at = null, removed_at = null, suspension_warned = excluded\.suspension_warned;/.test(roster)
  && /v_until := case when v_exempt then null else public\._departure_suspension_until\(\) end;/.test(roster)
  && /they are suspended through Season '\|\|v_until\|\|' \(Rules 1\.1 and 7\.2\); '\|\|\s+'rejoining after that does not lift the suspension\.'/.test(roster)
  && /else ' and they come off your squad \(Rule 1\.1\)\.' end/.test(roster));
A("...the suspension comes only for a marked notice, after the roster delete and before the club's removal notice",
  /if r\.warned then\s+v_until := public\._suspend_for_departure\(r\.profile_id,/.test(roster)
  && roster.indexOf("if r.done then") < roster.indexOf("delete from public.roster_spots rs")
  && roster.indexOf("public._suspend_for_departure(", roster.indexOf("delete from public.roster_spots rs")) > roster.indexOf("delete from public.roster_spots rs")
  && roster.indexOf("public._suspend_for_departure(", roster.indexOf("delete from public.roster_spots rs")) < roster.indexOf("has been removed from your squad"));
A("...a window that closes after the season is complete keeps the roster and still suspends",
  /detail:='season complete, roster kept; '\|\|case when v_until is not null then 'suspended through Season '\|\|v_until else 'not suspended' end;/.test(roster)
  && /and not exists \(select 1 from public\.guild_members g where g\.profile_id = n\.profile_id and g\.present\)/.test(roster)
  && /and \(p\.in_guild = true or exists \(select 1 from public\.guild_members g where g\.profile_id = n\.profile_id and g\.present\)\)/.test(roster));
A("...the removal notice says the suspension", /' is also suspended through Season '\|\|v_until\|\|\s+' \(Rules 1\.1 and 7\.2\); rejoining the server does not lift it\.'/.test(roster));
A("...the v3.11 ruling, the v3.50 incident and the savepoints are kept", /THE NOTICE IS THE CLOCK/.test(roster) && /v3\.50 \(2026-09-28\): the sweep had been dead since 2026-09-25 23:49 ET/.test(roster)
  && (roster.match(/exception when others then/g) || []).length === 3);
A("...they/them in what clubs read", !/'[^']*\b(He|he|His|his|him)\b[^']*'/.test(roster.replace(/\/\*[\s\S]*?\*\//g, "")));
A("sign-up sweep: DROP + CREATE with the new row shape and the job's grant only", /drop function public\.remove_departed_signups\(integer\);\ncreate function public\.remove_departed_signups/.test(body)
  && /returns table\(action text, profile_id uuid, gamertag text, detail text\)/.test(signup) && /#variable_conflict use_column/.test(signup)
  && /revoke all on function public\.remove_departed_signups\(integer\) from public, anon, authenticated;\ngrant execute on function public\.remove_departed_signups\(integer\) to service_role;/.test(body));
A("...warns first (the notice is the clock) and says the suspension", signup.indexOf("/* A. warn") < signup.indexOf("/* C. withdraw")
  && /'Rejoin the Discord to keep your sign-up'/.test(signup) && /you are suspended through Season '\|\|v_warn_until\|\|\s+' \(Rules 1\.1 and 7\.2\)/.test(signup)
  && /and \(w\.profile_id is null or w\.notified_at < gm\.last_seen\)/.test(signup));
A("...leaves rostered players and old club notices to the roster sweep", (signup.match(/where rs\.profile_id = p\.id and s2\.status <> 'complete'/g) || []).length === 2
  && /or \(n\.notified_at >= gm\.last_seen and not n\.suspension_warned\)/.test(signup));
A("...withdraws a warned member when the notice's window closes, and only then suspends", /and \(w\.profile_id is null or now\(\) >= w\.deadline_at\)/.test(signup)
  && /if r\.warned and not r\.was_banned then\s+v_until := public\._suspend_for_departure\(r\.pid,/.test(signup)
  && signup.indexOf("delete from public.season_registrations x where x.id = r.rid") < signup.indexOf("public._suspend_for_departure(r.pid"));
A("...one savepoint per row, failures reported as 'error'", (signup.match(/exception when others then/g) || []).length === 2 && /action := 'error'/.test(signup) && /for update skip locked/.test(signup));
A("...the member's notice no longer promises a fresh sign-up when suspended, and has no dash", /You are also suspended through Season '\|\|v_until\|\|/.test(signup) && !/—/.test(signup));
A("notify_suspension: own text, appeal any time, no DM (anchors asserted)", /if n <> 1 then raise exception 'v4\.30: notify_suspension anchor % found % times', i, n; end if;/.test(body)
  && /This is the Rule 1\.1 suspension for leaving the league Discord/.test(body) && /you may appeal on the site at any time while it runs, once/.test(body)
  && /and new\.grounds is distinct from 'departure';/.test(body));
A("lift_suspension: a notice for a member with no club", /You may sign up for a season again; a roster spot or sign-up you lost is restored only if the league office decides to\. It is vacated and no longer appears on the public record \(Rule 7\.2\)\./.test(body)
  && /'v4\.30: link_appeal anchor found % times'/.test(body) && /\/\* v4\.30: the newest not yet appealed \*\//.test(body)
  && /'v4\.30: lift_suspension anchor found % times'/.test(body));
A("_remove_for_discipline: 'complete', both places, asserted", /if n <> 2 then raise exception 'v4\.30: _remove_for_discipline season filter found % times, expected 2', n; end if;/.test(body)
  && /execute replace\(v_def, \$a\$s\.status::text <> 'completed'\$a\$, \$a\$s\.status <> 'complete'\$a\$\);/.test(body));
A("suspension_record exposes the grounds, same columns, definer rights kept", /create or replace view public\.suspension_record with \(security_invoker = false\) as/.test(body)
  && /coalesce\(s\.grounds,\s+\(select c\.type from public\.action_requests c where c\.id = s\.request_id and c\.type = 'abandonment'::text\)\) as grounds/.test(body));
A("the self-checks raise", ["a notice written before v4.30 is marked as warned", "signup_departure_notices is open to an API role", "a grant is wrong",
  "remove_departed_signups shape", "_remove_for_discipline season filter", "suspension_record", "a suspension trigger is missing"].every((m) => body.includes("v4.30 check: " + m)));
A("nothing in the record posts to Discord directly", !/net\.http_post|discord_http_post\(/.test(body));
A("rehearsed on production and rolled back", /Result: REHEARSAL OK: T0 T1 T14 T2 T3 T4 T5 T6 T7[^\n]* T8 T9[^\n]* T10 T11 T12 T15 T16 T13/.test(sql));
A("v4.30b words a between-seasons suspension as the whole season, anchored once, after v4.30",
  /new\.created_at < se\.starts_at\)   \/\* v4\.30b: issued between seasons/.test(sql) && /'for all of Season '/.test(sql)
  && /if n <> 1 then raise exception 'v4\.30b: notify_suspension seasons anchor found % times'/.test(sql)
  && /raise exception 'v4\.30b: apply v4\.30 first'/.test(sql));
A("v4.30b rehearsed and applied", /Result \(v4\.30b\): REHEARSAL OK: B1 B2 B3/.test(sql)
  && /Applied as migration v430b_between_seasons_wording; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));
A("applied and audited", /Applied as migration v430_departure_suspension; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));

console.log("\n2. The Edge job");
const sync = R("jobs/discord-sync.js");
const rds = sync.slice(sync.indexOf("async function removeDepartedSignups(sum)"), sync.indexOf("async function sbUpsertCfg"));
A("only removals are announced; old-shape rows still count as removals", /const removed = rows\.filter\(\(r\) => !r\.action \|\| r\.action === "removed"\);/.test(rds));
A("a failed row fails the run", /const bad = rows\.filter\(\(r\) => r\.action === "error"\);\s+if \(bad\.length\) sum\.errors\.push\(\{ signupRemoval:/.test(rds));
A("the public blurb no longer promises a fresh sign-up and has no dash", !/fresh sign-up/.test(rds) && !/—/.test(rds.slice(rds.indexOf("const blurb"), rds.indexOf("const chunks"))) && /archived and removed from the pool/.test(rds));

console.log("\n3. The public record");
const pub = R("src/live/part5a_public.js"), hub = R("src/live/part6_hub.js"), live = R("src/live/part_live.js");
{
  const ctx = { CG: { fmtDay: () => "d", fmtDate: () => "Oct 24", CONDUCT_REASONS: [], _seasonsRaw: [{ id: "s1", number: 1, starts_at: "2026-09-16T01:00:00Z" }, { id: "s2", number: 2, starts_at: "2026-12-17T02:00:00Z" }] },
                esc: (s) => String(s) };
  vm.createContext(ctx);
  for (const fn of ["suspensionLen", "suspensionHeadings", "suspensionStateWord", "disciplineRecordHtml"]) {
    const m = pub.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};"));
    A("located CG." + fn, !!m); if (m) vm.runInContext(m[0], ctx);
  }
  const C = ctx.CG, dep = { mode: "seasons", untilSeason: 2, season_id: "s1", grounds: "departure", status: "active", issued: "2026-10-24" };
  A("a suspension into the next season reads as the member's notice does", C.suspensionLen(dep) === "rest of Season 1 and all of Season 2", C.suspensionLen(dep));
  A("...one inside its season is unchanged", C.suspensionLen({ mode: "seasons", untilSeason: 2, season_id: "s2", issued: "2027-01-05T02:00:00Z" }) === "rest of Season 2" && C.suspensionLen({ mode: "seasons", untilSeason: 1 }) === "rest of Season 1");
  A("the heading names Rule 1.1", C.suspensionHeadings(dep) === "Left the league Discord (Rule 1.1)", C.suspensionHeadings(dep));
  A("...and an ice suspension keeps its heading", C.suspensionHeadings({ venue: "ice" }) === "Conduct on the ice");
  const html = C.disciplineRecordHtml(dep);
  A("...one issued between seasons is the whole season, as the notice says", C.suspensionLen({ mode: "seasons", untilSeason: 2, season_id: "s2", issued: "2026-11-25T02:00:00Z" }) === "all of Season 2"
    && C.suspensionLen({ mode: "seasons", untilSeason: 3, season_id: "s2", issued: "2026-11-25T02:00:00Z" }) === "all of Season 2 through Season 3");
  A("the record block, driven", /Discipline record<\/b>Suspended rest of Season 1 and all of Season 2, running\. Left the league Discord \(Rule 1\.1\)\. Issued Oct 24\./.test(html) && !/Reason/.test(html), html);
}
A("the block is the one definition: the Honors tab and the off-roster profile both use it", (pub.match(/CG\.disciplineRecordHtml\(/g) || []).length === 2
  && (pub.match(/<b style="display:block;font-family:var\(--f-disp\)">Discipline record<\/b>/g) || []).length === 1
  && /<div id="acctHdr" class="note">Loading account…<\/div>'\+\s+\/\*[^*]*\*\/\s+CG\.disciplineRecordHtml\(lg\.suspensions\.find\(function\(x\)\{ return x\.playerId===pid && x\.status!=="lifted"; \}\)\)/.test(pub));
A("Team HQ's tooltip uses the same length", /: s\.mode==="seasons" \? "for the "\+CG\.suspensionLen\(s\)/.test(hub));
A("the Register page says it, keeping the v2.47 words", /withdrawn automatically after about a day \(Rule 1\.1\), and you are suspended through the next season \(Rule 7\.2\)\. Rejoining after that does not lift the suspension; only a granted appeal does\./.test(live)
  && /Staying in the server keeps your sign-up alive/.test(live) && !/You must be in the Chel Gaming Discord to register —/.test(live));
A("the pool caption, the account switch card, the office's archive card and the appeal form say it", /withdraws a pending sign-up and brings a suspension through the next season \(Rule 1\.1\)/.test(live)
  && /withdrawn after about a day out of the server \(Rule 1\.1\) and you are suspended through the next season \(Rule 7\.2\), so join now\./.test(live)
  && !/otherwise the member simply rejoins and signs up again/.test(live)
  && /Appeal a ruling within 48 hours, or a suspension for leaving the Discord at any time while it runs \(Rule 7\.6\)\./.test(live));

console.log("\n4. The rulebook, as rendered");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = (id) => [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === id) || { paragraphs: [] };
eval(R("src/live/part5b_public2.js").match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/)[0]);
const book = (fmt) => JSON.stringify(CG.rulebookForFormat(rb, fmt).chapters);
for (const fmt of ["basic", "full"]) {
  const b = book(fmt);
  A("the " + fmt + " book suspends a withdrawn sign-up and lifts it only on appeal", /A player whose sign-up is withdrawn after that notice is also suspended for the remainder of the current season, including the playoffs, and for the whole of the following season, or, if the sign-up is withdrawn between seasons, for the whole of the season about to begin \(Rule 7\.2\)\./.test(b)
    && /it is lifted only when the league office grants the player's appeal \(Rule 7\.6\)/.test(b) && !/Rejoining the server restores nothing by itself/.test(b));
  A("the " + fmt + " book has the new 7.2 paragraph 7 and 7.6 paragraph 3", /A member is suspended automatically, without a ruling by an official, when, after a notice that warned that a suspension follows, their sign-up is withdrawn/.test(b) && /Where the season ends before those hours run out, the member keeps their place on the finished season's roster and is suspended all the same\./.test(b) && /may be appealed at any time while it runs, not only within the forty-eight \(48\) hours/.test(b));
}
const p11 = sec("1.1").paragraphs;
A("1.1.5: the club's notice warns, the removal suspends, the front office and commissioners are left to the office",
  /naming the player and the deadline and warning that a player who does not rejoin in time is removed and suspended \(Rule 7\.2\)/.test(p11[4])
  && /the spot is free for the club to fill, and they are suspended exactly as the preceding paragraph provides\./.test(p11[4])
  && /\(Owner, General Manager or Assistant General Manager\) is never removed automatically, nor suspended under this rule;/.test(p11[4])
  && /a commissioner who leaves is referred to the commissioners and is not suspended automatically/.test(p11[4]));
const p72 = sec("7.2").paragraphs, p76 = sec("7.6").paragraphs;
A("7.2: appended, so the pinned paragraphs keep their places", p72.length === 7 && /^A member is told of a sanction at the moment it is imposed/.test(p72[5]) && /^A member is suspended automatically/.test(p72[6]));
A("7.2.7 states the length, the between-seasons case, no DM, the appeal, the exemptions and the date", /for the whole of the following season; a member suspended between seasons, before the next season has begun, is suspended for the whole of that season only\./.test(p72[6])
  && /no direct message is sent/.test(p72[6]) && /it is lifted only when the league office grants the member's appeal under Rule 7\.6/.test(p72[6])
  && /are never suspended under this paragraph/.test(p72[6]) && /No member warned or removed before this paragraph took effect is suspended under it\./.test(p72[6]));
A("7.2: paragraph 7 is a commissioner-level length named in paragraph 1, and the one exception to one at a time", /other than under paragraph 4 or paragraph 7 of this rule,/.test(p72[0])
  && /A member is under one suspension at a time/.test(p72[3]) && /is the one exception to holding one suspension at a time/.test(p72[3]));
A("7.6: appended; 48 hours and once still stand for every other sanction", p76.length === 3 && /forty-eight \(48\) hours/.test(p76[0]) && /Each sanction may be appealed once/.test(p76[0]) && /It may still be appealed only once/.test(p76[2]));
A("0.3 in both formats", /withdrawn automatically after one day's grace and is suspended through the following season \(Rules 1\.1 and 7\.2\)/.test(sec("0.3").paragraphs.join(" "))
  && /after a day's grace \(Rule 1\.1\), and also brings a suspension through the following season \(Rule 7\.2\)/.test((sec("0.3").full || []).join(" ")));
const changed = JSON.stringify(["0.3", "1.1", "7.2", "7.6"].map((k) => [sec(k).paragraphs, sec(k).full || []]));
A("no dash as punctuation and no gendered pronoun in the changed sections", !/[—–]| - /.test(changed) && !/\b(he|his|him|she|her|hers)\b/i.test(changed));

console.log("\n5. The changelog");
const e = rb.changelog.find((c) => c.version === "4.30") || {};
A("4.30 is recorded, newest first", e.version === "4.30" && rb.changelog.indexOf(e) === rb.changelog.findIndex((c) => Number(c.version) <= 4.30));
A("...in key order", JSON.stringify(Object.keys(e)) === JSON.stringify(["version", "dateIso", "summary", "items"]));
A("...saying the suspension, the appeal, not retroactive, and naming the rules", /suspended for the rest of the season and all of the next one/.test(e.summary || "")
  && (e.items || []).some((i) => /only a granted appeal lifts it/.test(i)) && (e.items || []).some((i) => /Not retroactive/.test(i))
  && (e.items || []).some((i) => /Rules 0\.3, 1\.1, 7\.2 \(new paragraph 7\) and 7\.6 \(new paragraph 3\)/.test(i)));
A("...with no em dash or gendered pronoun", !/[—–]| - /.test(JSON.stringify(e)) && !/\b(he|his|him|she|her|hers)\b/i.test(JSON.stringify(e)));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
