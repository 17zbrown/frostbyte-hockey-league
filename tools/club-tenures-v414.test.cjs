/* v4.14 (2026-10-15): "Relink a traded player's old-club box lines". The automatic relink (v4.08) credited a line filed
   under an EA name the league did not yet have on record only when the member was on that club's roster TODAY, so a
   traded or waived player's line for a former club stayed credited to nobody. Nothing recorded which club a player was
   on at a given time (a trade moves the roster spot in place). v4.14 adds public.roster_tenures (kept by a trigger,
   Season 1 backfilled) and public._club_evidence, and the relink asks it. Part 2 makes the records review and the weekly
   limit forfeit read the roster at the game's time; part 3 (the review's fixes) rebuilds the opening-week stints the
   removal archive never saw, carries a merged account's stint, and hardens the trigger.
   The SQL ran as a rolled-back rehearsal on production before it was applied (results recorded in the SQL file); this
   pins the record, the rule and the changelog. Run: node tools/club-tenures-v414.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sql = R("sql/2026-10-15-club-tenures-v414.sql");
const body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

console.log("— the record of the clubs each player has been on");
A("one row per stint: season, member, club, spot, position and squad, joined and left with how", /create table if not exists public\.roster_tenures \([\s\S]*joined_at\s+timestamptz not null,[\s\S]*left_at\s+timestamptz,[\s\S]*joined_how\s+text not null,[\s\S]*left_how\s+text,/.test(body));
A("...a stint never ends before it starts", /constraint roster_tenures_order check \(left_at is null or left_at >= joined_at\)/.test(body));
A("...and a player has at most one open stint a season (roster_spots holds one spot a season)", /create unique index if not exists roster_tenures_one_open on public\.roster_tenures \(season_id, profile_id\) where left_at is null;/.test(body));
A("...internal: RLS on, nothing granted to members", /alter table public\.roster_tenures enable row level security;/.test(body) && /revoke all on public\.roster_tenures from public, anon, authenticated;/.test(body));

console.log("\n— kept by every roster write, whatever path makes it");
A("the trigger fires on insert, delete and a change of club, position or squad", /create trigger roster_tenure_track_trg after insert or delete or update of team_id, position, squad on public\.roster_spots\s+for each row execute function public\._roster_tenure_track\(\);/.test(body));
A("a new spot opens a stint with its origin", /if tg_op = 'INSERT' then[\s\S]*coalesce\(new\.created_at, now\(\)\), coalesce\(nullif\(new\.origin, ''\), 'placed'\)\);/.test(body));
A("a change of club closes the stint and opens the next", /if new\.team_id is distinct from old\.team_id then\s+update public\.roster_tenures set left_at = now\(\), left_how = 'moved to another club'[\s\S]*'moved from another club'\);/.test(body));
A("a removal closes it with the reason the caller set (app.roster_reason, as archive_roster_spot reads it)", /set left_at = now\(\), left_how = coalesce\(v_why, 'removed'\)/.test(body) && /current_setting\('app\.roster_reason', true\)/.test(body));
A("the trigger does not swallow a failure (a roster write whose history cannot be recorded does not go through)", !/exception when/.test(body.slice(body.indexOf("create or replace function public._roster_tenure_track"), body.indexOf("$function$;", body.indexOf("create or replace function public._roster_tenure_track")))));

console.log("\n— Season 1 rebuilt from the spots, the removals and the trades");
A("each spot's life: the spots on rosters now and the removed ones", /from public\.roster_spots rs\s+union all\s+select r\.season_id, r\.profile_id, r\.spot_id, r\.team_id, r\.spot_created_at, r\.removed_at/.test(body));
A("split at every accepted trade (trades.updated_at), each side moving the right way", /t\.from_team_id, t\.to_team_id, t\.updated_at, 'traded'[\s\S]*offered_profile_ids[\s\S]*t\.to_team_id, t\.from_team_id, t\.updated_at, 'traded'[\s\S]*requested_profile_ids/.test(body));
A("a reversed trade: accepted when its transactions row says (reverse_trade overwrote updated_at), sent back at updated_at",
  /x\.description like rv\.fname \|\| ' traded <b>%'/.test(body) && /if v_n <> 1 then raise exception 'v4\.14 backfill: reversed trade % has % acceptance records, expected 1'/.test(body) &&
  /rv\.updated_at, 'trade reversed'/.test(body));
A("the rebuild refuses to land if any move does not start on the stint's club, a spot ends elsewhere, or a move falls outside every spot",
  /does not start on the stint''s club/.test(body) && /ends on another club/.test(body) && /trade moves outside every spot/.test(body) && /raise exception 'v4\.14 backfill is inconsistent: %'/.test(body));
A("the rehearsal's checks are recorded: 322 stints, one open for each of 169 rostered players, no overlaps; the 13 other lines' first reading is marked wrong and points to part 3",
  /322 stints, one open stint for each of the 169 rostered players, no two stints of a\s*\n--\s+player overlap/.test(sql) && /The other 13/.test(sql) &&
  /That reading was WRONG \(corrected by part 3,\s*\n--\s+sql\/2026-10-15-tenure-fixes-v414\.sql\)/.test(sql) && !/says so truthfully/.test(sql));

console.log("\n— one definition: did this member play for this club in this game");
const ev = body.slice(body.indexOf("create or replace function public._club_evidence"), body.indexOf("revoke all on function public._club_evidence"));
A("a stint on the club inside the game's window (ten minutes before puck drop to three hours after, Rule 6.2)",
  /rt\.joined_at <= g\.scheduled_at \+ interval '3 hours'/.test(ev) && /rt\.left_at is null or rt\.left_at >= g\.scheduled_at - interval '10 minutes'/.test(ev));
A("...or the club's own lineup for that game naming the member", /p_profile in \(gl\.center, gl\.lw, gl\.rw, gl\.ld, gl\.rd, gl\.goalie\)/.test(ev));
A("...internal, not callable by members", /revoke all on function public\._club_evidence\(uuid, uuid, uuid\) from public, anon, authenticated;/.test(body));

console.log("\n— the relink asks it instead of today's roster");
A("the club check is replaced by _club_evidence, anchored exactly once", /select e\.how, e\.pos, e\.squad into v_how, v_pos, v_squad from public\._club_evidence\(p_profile, r\.team_id, r\.game_id\) e limit 1;/.test(body) &&
  /raise exception 'v4\.14: relink anchor \(club check\)'/.test(body));
A("the position group is checked on a roster stint (camp fills any position); a lineup is the club's own word", /continue when v_how = ''roster'' and coalesce\(v_squad, ''''\) <> ''tc'' and v_grp <> v_rowgrp;/.test(body));
A("the old today-only roster lookup is the anchor being replaced", /select rs\.position::text, rs\.squad into v_pos, v_squad from public\.roster_spots rs\s+where rs\.profile_id = p_profile and rs\.season_id = v_season and rs\.team_id = r\.team_id limit 1;/.test(body));
A("the migration proves itself: the relink asks _club_evidence and nothing internal is open to members",
  /v4\.14: the relink does not ask _club_evidence/.test(body) && /v4\.14: an internal function is executable by members/.test(body) && /v4\.14: roster_tenures is readable by members/.test(body));
A("the rehearsal on production: refused by the old rule, credited by the new, never for a club he never played for",
  /refused by the old rule \(0 linked\)\s*\n--\s+and credited by the new one \(1 linked\)/.test(sql) && /stayed\s*\n--\s+unlinked/.test(sql));

console.log("\n— part 2: the records review and the limit forfeit read the game's time, not now");
{
  const sql2 = R("sql/2026-10-15-review-at-game-time-v414.sql");
  const b2 = sql2.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  A("one definition of the game's window: _tenures_at_game; _club_evidence is built on it and prefers the stint containing puck drop",
    /create or replace function public\._tenures_at_game\(p_profile uuid, p_game uuid\)/.test(b2) &&
    /from public\._tenures_at_game\(p_profile, p_game\) t join public\.games g on g\.id = p_game/.test(b2) &&
    /order by \(t\.joined_at <= g\.scheduled_at and \(t\.left_at is null or t\.left_at > g\.scheduled_at\)\) desc, t\.joined_at desc/.test(b2));
  A("review_game_records: membership, squad and position from a ROSTER stint at the game (a lineup is not membership)",
    /select e\.squad, e\.pos into v_squad, v_pos from public\._club_evidence\(r\.profile_id, r\.team_id, p_game\) e\s+where e\.how = 'roster' limit 1;\s+v_rostered := found;/.test(b2));
  A("...the club named is the club the player was on at the time, and the words say was", /from public\._tenures_at_game\(r\.profile_id, p_game\) tg/.test(b2) &&
    /was on neither its active roster nor its training camp when the game was played/.test(b2) && /At the time the player was on /.test(b2) && !/He is rostered by/.test(b2.slice(b2.indexOf("b3 text"))));
  A("...the weekly limit counts the games up to and including this one, through the one helper both checks use",
    /v_n := public\.player_week_games_through\(p_game, r\.profile_id\);/.test(b2) && /v_n := public\.player_week_games_through\(g\.id, r\.profile_id\);/.test(b2) &&
    /and \(g\.scheduled_at < g0\.scheduled_at or \(g\.scheduled_at = g0\.scheduled_at and g\.id <= g0\.id\)\)/.test(b2));
  A("_limit_forfeit_check reads the squad from the stint at the game", /select e\.squad, e\.pos into v_squad, v_pos from public\._club_evidence\(r\.profile_id, r\.team_id, g\.id\) e\s+where e\.how = 'roster' limit 1;/.test(b2));
  A("a squad move now ends a stint (the squad at every game is on record from now on); a position change stays on the open stint",
    /if new\.team_id is distinct from old\.team_id or new\.squad is distinct from old\.squad then/.test(b2) && /'moved to training camp'/.test(b2) && /'moved up to the active roster'/.test(b2) &&
    /elsif new\.position is distinct from old\.position then/.test(b2));
  A("a backfilled stint that ended in a trade carries no guessed squad", /update public\.roster_tenures set squad = null\s+where left_how in \('traded', 'trade reversed'\) and squad is not null;/.test(b2));
  A("every replaced passage is anchored exactly once and the migration proves the result",
    (b2.match(/raise exception 'v4\.14b: review anchor \d/g) || []).length === 7 && /v4\.14b: review_game_records still reads today''s roster or the whole week/.test(b2) &&
    /v4\.14b: _limit_forfeit_check still reads today''s roster or counts on its own/.test(b2));
  A("the rehearsal's results are recorded: 196 false flags down to 11 (then found false too and fixed by part 3), 113 limit findings down to 37",
    /would have raised 196 such flags; it then raised 11/.test(sql2) && /with them on record a full re-review raises none/.test(sql2) && !/all true/.test(sql2) &&
    /113 such flags on a full re-review/.test(sql2) && /37 over-limit findings remain/.test(sql2));
}

console.log("\n— part 3: the review's fixes");
{
  const sql3 = R("sql/2026-10-15-tenure-fixes-v414.sql");
  const b3 = sql3.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  const rows = b3.match(/^\s+\('[^']+',\s+'[A-Z]{3}', '2026-09-\d\d [\d:.]+\+00'/gm) || [];
  A("nine opening-week stints, each opened and closed by a record found exactly as cited, or the migration stops",
    rows.length === 9 && /raise exception 'v4\.14c: no % record opens % on % at %'/.test(b3) && /raise exception 'v4\.14c: no % record closes % on % at %'/.test(b3) &&
    /from public\.draft_picks dp/.test(b3) && /from public\.random_assignments ra/.test(b3) && /cn\.body like 'Placed by the league office after the draft%'/.test(b3) &&
    /tr\.type = 'waive' and tr\.occurred_at = r\.left_at/.test(b3));
  A("...no squad is guessed for them (every rebuilt row's squad is null)",
    (b3.match(/^\s+\('[^']+',\s+'[A-Z]{3}',[^\n]*\n/gm) || []).every((l) => /,\s+null(::text)?,\s+'(draft|notice|placement)',/.test(l)));
  A("...a position comes from the opening record or the member's next stint, never left empty",
    /rt\.joined_at >= r\.left_at/.test(b3) && /raise exception 'v4\.14c: no position on record for % on %'/.test(b3));
  A("the merged account carries exactly one stint of the earlier account", /old\.gamertag = 'Jugg_PRKz'/.test(b3) && /if v_ok <> 1 then raise exception 'v4\.14c: expected one Jugg_PRKz stint to carry over/.test(b3));
  const trg = b3.slice(b3.indexOf("create or replace function public._roster_tenure_track"), b3.indexOf("$function$;", b3.indexOf("create or replace function public._roster_tenure_track")));
  A("the trigger also follows a spot passed to another account", /create trigger roster_tenure_track_trg after insert or delete or update of team_id, position, squad, profile_id, season_id/.test(b3) &&
    /'spot passed to another account'/.test(trg) && /'spot passed from another account'/.test(trg));
  A("...refuses a write that finds the record out of step (not exactly one open stint, on the club being left)",
    /if v_n <> 1 or v_open\.team_id is distinct from old\.team_id then\s+raise exception 'roster_tenures is out of step/.test(trg));
  A("...never ends a stint before it began, and closes and opens at the same moment",
    /v_at := greatest\(now\(\), v_open\.joined_at\);/.test(trg) && /set left_at = v_at, left_how = v_move where id = v_open\.id;/.test(trg) && /new\.squad, v_at,/.test(trg));
  A("...a position change starts a new stint too", /else 'position changed' end;/.test(trg) && !/set position = new\.position/.test(trg));
  A("...and swallows no failure", !/exception when/.test(trg));
  A("a lineup's evidence carries the place the lineup gave the member",
    /case when gl\.goalie = p_profile then 'G' when gl\.ld = p_profile then 'LD' when gl\.rd = p_profile then 'RD'/.test(b3));
  A("the relink holds every line to the position group, lineup evidence included (one definition with Rule 6.3)",
    /b2 text := \$b\$    continue when coalesce\(v_squad, ''\) <> 'tc' and v_grp <> v_rowgrp;\$b\$;/.test(b3) && /raise exception 'v4\.14c: relink anchor 2'/.test(b3));
  A("a withdrawn line is never reconsidered, by the relink or by the sweep (both anchors counted)",
    (b3.match(/not exists \(select 1 from public\.stat_credit_withdrawals w where w\.game_id = gs\.game_id and w\.ea_player_id = gs\.ea_player_id\)/g) || []).length === 2 &&
    /raise exception 'v4\.14c: sweep anchor \(expected 2\)'/.test(b3));
  A("the migration proves the record: every credited line inside a stint at its club, one open stint per spot, no overlaps",
    /raise exception 'v4\.14c: % credited line\(s\) lie outside every roster stint: %'/.test(b3) && /raise exception 'v4\.14c: % open stints for % spots/.test(b3) &&
    /raise exception 'v4\.14c: % overlapping stints'/.test(b3) && /v4\.14c: an internal function is executable by members/.test(b3));
  A("the rehearsal's results are recorded: lines outside a stint 13 -> 0, unrostered flags 11 -> 0, limits and forfeits unchanged",
    /credited lines outside a stint at their club 13 -> 0/.test(sql3) && /"unrostered player" flags on a full re-review\s*\n--\s+11 -> 0/.test(sql3) &&
    /over-limit readings 37 -> 37 and automatic forfeits none -> none/.test(sql3));
}

console.log("\n— Rule 6.3 and the changelog");
{
  const C = {}; new Function("CG", R("src/live/part3_content.js"))(C);
  const rb = C.CONTENT.rulebook;
  const sec = (id) => { for (const ch of rb.chapters) for (const s of (ch.sections || [])) if (s.id === id) return s; };
  const p = sec("6.3").paragraphs[1];
  A("Rule 6.3: credited automatically only with one matching member who played for that club at the time of the game",
    /credited automatically only when exactly one member matches that name and the member played for the club the line was recorded for at the time of the game/.test(p) &&
    /the league's record of the clubs each player has been on shows the member on that club within the game's window \(Rule 6\.2\), or that club's own lineup for the game names the member/.test(p) &&
    /A traded or waived player's line for the club the player has since left is credited the same way\. Any other line waits for the league office\./.test(p));
  A("...and a member can hold one line in each role in a restarted game (as v4.11 built it)", /or one in each role where the same EA account skated in one sitting of a restarted game and played goal in another \(Rule 4\.3\)/.test(p));
  A("Rule 4.2: rosters are checked as they stood when the game was played", /checked against the two clubs' rosters as they stood when the game was played, read from the league's record of the clubs each player has been on \(Rule 6\.3\)/.test(sec("4.2").paragraphs[2]));
  A("Rule 5.2: the forfeited game is found by counting the week up to it, at the squad held then", /found by counting the player's games of the game-week in schedule order up to and including that game, at the cap of the squad the player held with the club when it was played/.test(sec("5.2").paragraphs[1]));
  A("Rule 6.3: the position group is the one held with that club at the time (roster or lineup place), camp excepted",
    /The line must also be in the position group the member held with that club at the time, on the roster or in the place the lineup gave the member, unless the member was in training camp\./.test(p));
  A("...and the paragraph guesses no pronoun", !/\b(he|his|him)\b/.test(p));
  const e414 = rb.changelog.find((c) => c.version === "4.14") || {};   /* by version: a later release takes changelog[0] */
  A("the changelog has its 4.14 entry, right after 4.13", e414.version === "4.14" && (rb.changelog[rb.changelog.indexOf(e414) + 1] || {}).version === "4.13");
  A("...and it tells what part 3 did: opening-week stints rebuilt, a merged account carried, every credited game inside a stint",
    /Stints from opening week, before the league kept its archive of removals, were rebuilt from the draft, placement and waiver records that name them/.test(JSON.stringify(e414)) &&
    /a merged account carries the earlier account's stints/.test(JSON.stringify(e414)) && /Every credited game this season now lies inside a stint at its club/.test(JSON.stringify(e414)));
  A("...with no em dashes and no guessed pronouns", !/—/.test(JSON.stringify(e414)) && !/\b(he|his|him)\b/i.test(JSON.stringify(e414)));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
