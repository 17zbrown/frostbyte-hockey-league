/* v3.93 (2026-10-12): weekly game limits count only games played; playing someone past the limit is an automatic,
   appealable forfeit; a moved game can count toward its original week or none (Rule 3.3).
   Commissioner: "remove the player games played limits for that rescheduled game. For all weeks moving forward for the
   season. Any game played with a player over their limit of weekly games will be an automatic forfeit loss for that
   team. The team management has the opportunity to appeal the forfeit if there is a mistake of some kind. In the
   scheduler, make sure to only count the games played from box scores and mid games forfeits as their counter."
   Rehearsed on production in rolled-back transactions: the counter dropped the filed NYI sheet (week 4: 1 to 0); with
   the start date opened, re-finalizing SEA at BOS (Oct 9) ruled BOS a forfeit through the trigger (ItzKloudzy game 7 of
   6, Marran game 4 of 3, camp); the BOS Owner filed an appeal, a bare status close was refused, Overturn restored the
   final as played and recorded exceptions so a re-check rules nothing; an appeal of a non-limit forfeit was refused.
   This pins those records and the site. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const one = R("sql/2026-10-12-limit-week-v393.sql"), two = R("sql/2026-10-12-over-limit-forfeit-v393.sql");
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), desks = R("src/live/part9_staffdesks.js");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 240))); } };

console.log("— the counter: games played");
const pwg = two.slice(two.indexOf("create or replace function public.player_week_games"), two.indexOf("$function$;", two.indexOf("create or replace function public.player_week_games")));
A("only FINAL games with a box-score line for him", /and g\.status = 'final'/.test(pwg) && /exists \(select 1 from public\.game_stats gs where gs\.game_id = g\.id and gs\.profile_id = p_profile\)/.test(pwg));
A("...a filed lineup no longer counts (no game_lineups branch)", !/game_lineups/.test(pwg.replace(/\/\*[\s\S]*?\*\//g, "")));
A("...voided and office-exempted games count for no one", /not coalesce\(g\.voided, false\)/.test(pwg) && /not coalesce\(g\.limits_exempt, false\)/.test(pwg));
A("...counted toward the limit week", /coalesce\(g\.limit_week, g\.week\) = p_week/.test(pwg));
A("the lineup gate skips an exempt game and says 'played'", /v_dressed := case when coalesce\(v_game\.limits_exempt, false\) and v_game\.stage = ''regular'' then 0/.test(two)
  && /% has already played % games this %; the limit is % \(%\)\. Playing him again would forfeit the game \(Rule 5\.2\)\./.test(two));

console.log("— the automatic forfeit");
A("from 12 October 2026 (app_config limit_forfeit_from)", /values \('limit_forfeit_from', '2026-10-12T04:00:00Z'\)/.test(two) && /if g\.scheduled_at < v_from then return null; end if;/.test(two));
A("a running count in schedule order, up to and including this game", /\(g2\.scheduled_at < g\.scheduled_at or \(g2\.scheduled_at = g\.scheduled_at and g2\.id <= g\.id\)\)/.test(two));
A("over the cap and not excepted is a violation", /if v_n > v_cap and not public\.has_cap_exception\(g\.id, r\.profile_id\) then/.test(two));
A("one club: forfeit, result as played kept (forfeit_team_id only)", /update public\.games set forfeit_team_id = v_team where id = g\.id;   -- the result as played stays on record/.test(two));
A("both clubs: no automatic ruling, the commissioners are told once", /if array_length\(v_teams, 1\) > 1 then/.test(two) && /'limit_forfeit_both'/.test(two));
A("both clubs, the officiating desk and the scores channel are told", /club_notify\(v_team, 'flag', 'Forfeit: a player went over the weekly game limit'/.test(two)
  && /club_notify\(v_opp, 'flag', 'Win by forfeit: '/.test(two) && /notify_department\('officiating', 'flag', 'Automatic forfeit/.test(two) && /notify_discord\('discord_scores_webhook',/.test(two));
A("the forfeiting club is told how to appeal", /file a case on the site, choose Forfeit appeal and pick this game/.test(two));
A("the trigger sorts first among the final triggers and never blocks a final", /create trigger trg_a_limit_forfeit after update of status on public\.games/.test(two)
  && /exception when others then\s+raise warning 'trg_limit_forfeit failed/.test(two));
A("a later final of the same week sharing a player is re-checked (a held game merged late)", /\(g2\.scheduled_at > new\.scheduled_at or \(g2\.scheduled_at = new\.scheduled_at and g2\.id > new\.id\)\)/.test(two));
A("the check is not callable through the API", /revoke execute on function public\._limit_forfeit_check\(uuid\) from public, anon, authenticated;/.test(two));

console.log("— the appeal");
A("a forfeit_appeal case type with the game it is about", /'forfeit_appeal'\]\)\)/.test(two) && /add column if not exists game_id uuid references public\.games\(id\)/.test(two));
A("filed only by the forfeiting club's Owner, GM or AGM, only for an automatic limit forfeit, once", /new\.profile_id in \(t\.owner_profile_id, t\.gm_profile_id, t\.agm_profile_id\)/.test(two)
  && /a\.action = 'limit_forfeit' and a\.target_id = g\.id::text/.test(two) && /This forfeit has already been appealed/.test(two));
A("only decide_forfeit_appeal closes one (a bare status change is refused)", /current_setting\('app\.forfeit_appeal_decide', true\)/.test(two) && /A forfeit appeal is decided with Overturn or Deny on the case, by a commissioner\./.test(two));
A("commissioner only", /raise exception 'Only a commissioner decides a forfeit appeal\.'/.test(two) && /grant execute on function public\.decide_forfeit_appeal\(uuid, boolean, text\) to authenticated;/.test(two));
A("Overturn records exceptions so a re-final never re-rules it, clears the forfeit, keeps the result", /insert into public\.weekly_cap_exceptions/.test(two) && /update public\.games set forfeit_team_id = null where id = g\.id;   -- final as played/.test(two));

console.log("— the moved game");
A("a week ruling (limit_week) and an exemption (limits_exempt), each through one logged office door", /create or replace function public\.ops_set_limit_week/.test(one) && /create or replace function public\.ops_exempt_game_limits/.test(two));
A("API roles read both columns and write neither", /grant select \(limit_week\) on public\.games to anon, authenticated;/.test(one) && /grant select \(limits_exempt\) on public\.games to anon, authenticated;/.test(two));
A("Islanders at Stars is exempt, its Week 3 ruling cleared by the same door", /ops_exempt_game_limits\('d6359d09-9414-4bea-9f67-9a153b01ee49', true,/.test(two) && /limit_week = case when coalesce\(p_exempt, false\) then null else limit_week end/.test(two));
A("every limit reader reads the limit week", ["player_week_games", "set_game_lineup", "clear_game_lineup", "grant_cap_exception", "review_game_records", "lineup_camp_warnings", "tc_week_overages"].every((f) => one.includes("public." + f + "(")));

console.log("— the site");
A("games load both columns", /forfeit_team_id,voided,limit_week,limits_exempt";/.test(live) && /limitsExempt: !!g\.limits_exempt,/.test(live));
A("a filed sheet does not count; an exempt game counts for no one", /filed:   \{ counts:false/.test(live) && /exempt:  \{ counts:false/.test(live) && /else if \(g\.limitsExempt\) v = "exempt";/.test(live));
A("the week ledger, the line builder and the officials' desk compare limit weeks", /CG\.limitWeekOf\(g\) !== CG\.limitWeekOf\(game\)/.test(live) && /CG\.limitWeekOf\(g\) !== CG\.limitWeekOf\(ref\)/.test(hub) && /CG\.limitWeekOf\(x\) === CG\.limitWeekOf\(g\)/.test(desks));
A("a night opening with a made-up game is represented by a game of the week it is played", /else if \(CG\.limitWeekOf\(seen\[k\]\.game\) !== seen\[k\]\.game\.week && CG\.limitWeekOf\(g\) === g\.week\) seen\[k\]\.game = g;/.test(hub));
A("Dress the week warns, in forfeit terms", /a club that plays a player past it forfeits that game \(Rule 5\.2\)/.test(hub) && /games already played, /.test(hub));
A("the case form offers Forfeit appeal to club management, listing the club's forfeits", /forfeit_appeal:  \{ label:"Forfeit appeal"/.test(live) && /mgmtOnly:true, blurb:"For club management: appeal a game your club was ruled to forfeit/.test(live)
  && /g\.status==="final" && g\.forfeit===mtF\.code/.test(live) && /if \(type==="forfeit_appeal"\) payload\.game_id = gEl\.value;/.test(live));
A("a commissioner gets Overturn and Deny on the case, with a reason, through the RPC", /data-ffa-decide="overturn"/.test(live) && /a\.type==="forfeit_appeal" && !closed && isCommish/.test(live) && /CG\.sb\.rpc\("decide_forfeit_appeal", \{ p_request:id, p_overturn:overturn, p_response:txt \}\)/.test(live));
A("...and the generic Resolve, Deny and discipline buttons are off a forfeit appeal", /\(isPos \|\| a\.type==="forfeit_appeal" \? "" :/.test(live));

console.log("— the rulebook and changelog");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook;
const sec = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s; };
const r52 = sec("5.2").paragraphs[1];
A("Rule 5.2: games played, from the official record; filed lineups do not count", /A player's games in a game-week are the games he has played, read from the official record/.test(r52) && /A lineup filed for a game still to be played does not count/.test(r52));
A("...over the cap is an automatic forfeit loss, result as played kept", /forfeits the game in which he went beyond it: when that game is made final the league's tools rule it a forfeit loss for the club automatically, the result as played stays on record/.test(r52));
A("...both clubs: a commissioner rules; one appeal; from 12 October 2026", /no forfeit is ruled automatically and a commissioner rules the game/.test(r52) && /may appeal once, through its Owner, General Manager or Assistant General Manager/.test(r52) && /from 12 October 2026/.test(r52));
A("Rule 3.3: original week, or no week at all", /counts toward the week it was originally scheduled in, or toward no week at all, for players' weekly game limits \(Rule 5\.2\)/.test(sec("3.3").paragraphs[0]));
const cl = rb.changelog.find((c) => c.version === "3.93");
A("changelog 3.93 is first and says what changed", rb.changelog[0].version === "3.93" && !!cl && /count only games played/.test(cl.summary) && cl.items.some((i) => /Islanders at Stars/.test(i)));
const added = [JSON.stringify(cl), r52, two.slice(two.indexOf("create or replace function public._limit_forfeit_check"))].join(" ");
A("no em dash in what v3.93 wrote (the anchors it replaced aside)", !/—/.test(added.replace(/% has already played or been dressed in % games this % — the limit is/g, "")));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
