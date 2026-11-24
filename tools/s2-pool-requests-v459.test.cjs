/* v4.59: Season 2 training camp requests, per game, and the lineup deadline forfeit. node tools/s2-pool-requests-v459.test.cjs
   Commissioner, 2026-11-23: "A team is allowed to play with up to 3 training camp players per night. The requirement is
   that at least half the game lineup should consist of players on the club." 2026-11-24: "Can you do the requests per game
   instead of per night?" and "If a team does not set their initial lineup for that game before the deadline to set the
   lineups, that team forfeits the game." Pins the record (table, the three doors, the one-night guest in lineup_slot_ok
   and set_game_lineup, the code release, the review, suspensions by night, the two tick steps, the self-checks) and its
   rehearsal. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;
const BRITISH = /\b(centre|defence|colour|practis|organis|cancelled|licence|favour)/i;

const REC = "sql/2026-11-24-s2-pool-requests-v459.sql";
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC);
const fn = (name) => { const m = sql.match(new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\$f\\$([\\s\\S]*?)\\$f\\$;")); return m ? m[1] : ""; };
const patch = (sig) => { const i = sql.indexOf("pg_temp.vnnn_patch('" + sig + "'"); return i < 0 ? "" : sql.slice(i, sql.indexOf("\n\n", i)); };
const before = (s, a, b) => s.indexOf(a) >= 0 && s.indexOf(b) >= 0 && s.indexOf(a) < s.indexOf(b);
/* what a member or the office reads: comments, raise messages and one-line text literals (code with '::' is not text) */
const messages = [(sql.match(/^\s*--.*$/gm) || []).join("\n"), (sql.match(/\/\*[\s\S]*?\*\//g) || []).join("\n"),
  (sql.match(/raise exception '(?:[^']|'')*'/g) || []).join("\n"),
  (sql.match(/'(?:[^'\n]|'')*'/g) || []).filter((s) => / \w+ /.test(s) && !/::|\(/.test(s)).join("\n")].join("\n");

console.log("1. Rulings and preconditions");
A("the header quotes the per-night cap, the per-game requests and the lineup deadline rulings",
  sql.indexOf('"A team is allowed to play with up to 3\n--     training camp players per night. The requirement is that at least half the game lineup should consist of players\n--     on the club."') >= 0
  && sql.indexOf('"Can you do the requests per game instead of per night?"') >= 0
  && sql.indexOf('"If a team does not set their initial lineup for that game before the deadline to set the lineups, that\n--     team forfeits the game."') >= 0
  && sql.indexOf('"The league does not record double forfeits.') >= 0);
A("it refuses to run without the v4.58 market records, the steps end line, the one lineup_slot_ok or a definer night_lock_at",
  ["the v4.58 market records must be applied first", "market_tick has no steps end line",
   "expected exactly one public.lineup_slot_ok(uuid, text, uuid, uuid, text)",
   "public.market_pool_requests or public.market_lineup_deadlines already exists",
   "public.night_lock_at(uuid, date) must exist and be SECURITY DEFINER"].every((t) => sql.indexOf(t) >= 0));
A("the header carries the review decisions: a full six, ruled once at the lock, every stage, the night's lock fixed, backing out before the lock",
  /a lineup counts as set only when it names a full six; the forfeit is ruled ONCE per game, at that game's own lock/.test(sql)
  && /it applies in every stage, playoffs included; ruling or voiding a game does not move that night's lock\./.test(sql)
  && /the camp player may withdraw the acceptance and the club may release\n--\s+the guest/.test(sql));

console.log("\n2. The request table");
A("one row per club, player and game; six states; the live ask unique per game, one accepting club per game",
  /status text not null default 'pending'\n\s+check \(status in \('pending', 'accepted', 'declined', 'withdrawn', 'closed', 'lapsed'\)\)/.test(sql)
  && /create unique index market_pool_requests_one_live on public\.market_pool_requests \(game_id, team_id, profile_id\)\n\s+where status in \('pending', 'accepted'\);/.test(sql)
  && /create unique index market_pool_requests_one_club on public\.market_pool_requests \(game_id, profile_id\) where status = 'accepted';/.test(sql));
A("...it never stores a lobby code (the row is public after the lock): only the time the DM went",
  !/^\s+(game_)?code\s+text/m.test(sql.slice(sql.indexOf("create table public.market_pool_requests"), sql.indexOf("comment on table public.market_pool_requests")))
  && /code_dm_at timestamptz,/.test(sql) && !/\bset\s[^;]*\bgame_code\b/i.test(fn("_market_pool_sweep")));
A("...RLS on, every API grant revoked first, then SELECT on the columns that do not name who acted",
  before(sql, "alter table public.market_pool_requests enable row level security;", "revoke all on public.market_pool_requests from public, anon, authenticated;")
  && /grant select \(id, season_id, game_id, team_id, profile_id, game_at, created_at, status, answered_at, ended_at, note\)\n\s+on public\.market_pool_requests to anon, authenticated;/.test(sql)
  && !/grant (select|insert|update|delete|all)[^;]*\b(requested_by|ended_by|code_dm_at)\b[^;]*to/i.test(sql)
  && !/grant (insert|update|delete|all)[^;]*market_pool_requests/i.test(sql));
A("...one SELECT policy: the requesting club's seats, the player and the office, everyone once the night has locked",
  /create policy "pool requests: club, player and office, everyone after the lock" on public\.market_pool_requests\n\s+for select to anon, authenticated\n\s+using \(public\.is_commissioner\(\) or public\.is_staff\(\) or public\.is_gm_of\(team_id\) or profile_id = \(select auth\.uid\(\)\)\n\s+or now\(\) >= public\.night_lock_at\(game_id\)\);/.test(sql)
  && (sql.match(/create policy/g) || []).length === 1);
A("the deadline rulings: one row per game and night, office only (RLS on and every grant revoked right after the create, no policy, no grant)",
  /create table public\.market_lineup_deadlines \([\s\S]*?primary key \(game_id, night\)\n\);\nalter table public\.market_lineup_deadlines enable row level security;\nrevoke all on public\.market_lineup_deadlines from public, anon, authenticated;/.test(sql)
  && /outcome text not null check \(outcome in \('set', 'forfeit', 'void', 'officials'\)\)/.test(sql)
  && !/^grant [^;]*market_lineup_deadlines/im.test(sql) && !/^create policy[^;]*market_lineup_deadlines/im.test(sql)
  && /market_lineup_deadlines is office only, but % has %/.test(sql));
A("...the three live pulse triggers ('market' domain) and Realtime",
  (sql.match(/on public\.market_pool_requests\n\s+referencing [^;]*execute function public\._live_mark\('market', '', ''\);/g) || []).length === 3
  && /alter publication supabase_realtime add table public\.market_pool_requests;/.test(sql));

console.log("\n3. The doors");
const req = fn("market_pool_request"), ans = fn("market_pool_answer"), wd = fn("market_pool_withdraw"), night = fn("_market_pool_night_check");
A("request: the seat check in its own body, an Owner-approval seat sent to the Owner, then the market checks on the lineup page",
  before(req, "if not (v_office or public.is_gm_of(p_team)) then", "public.mgmt_access(p_team, 'lines') = 'approve'")
  && before(req, "public.mgmt_access(p_team, 'lines') = 'approve'", "v_season := public._market_ctx(p_team, 'lines');")
  && /hint = 'owner_requests'/.test(req));
A("...no camp players in the playoffs, only an open game, and closed at the night's lock judged on clock_timestamp()",
  /if coalesce\(v_g\.stage, 'regular'\) <> 'regular' then\n\s+raise exception 'Training camp players do not play in the playoffs\.'/.test(req)
  && /v_lock := public\.night_lock_at\(p_game\);\n\s+if clock_timestamp\(\) >= v_lock then/.test(req) && !/\bnow\(\)/.test(req));
A("...the pool is market_pool's (one definition), never a suspended player, never a player who declined that game",
  /if not exists \(select 1 from public\.market_pool\(v_season\) mp where mp\.profile_id = p_profile\) then/.test(req)
  && /if public\.is_suspended\(p_profile\) then/.test(req) && /hint = 'declined'/.test(req));
A("...the player's night lock, then the night rules, then the insert that names a second ask",
  before(req, "perform pg_advisory_xact_lock(hashtext('market:pool:' || p_profile::text || ':' || v_night::text));", "perform public._market_pool_night_check(p_team, p_profile, v_night);")
  && before(req, "perform public._market_pool_night_check(p_team, p_profile, v_night);", "on conflict (game_id, team_id, profile_id) where status in ('pending', 'accepted') do nothing")
  && /if v_id is null then\n\s+raise exception 'Your club already asked % to play this game\.'/.test(req));
A("...the player hears by bell and DM, with the lock time", /perform public\.create_notification\(p_profile, 'lineups',/.test(req) && /perform public\._market_dm\(p_profile, v_text\);/.test(req)
  && /Accept or decline on the CGHL site before /.test(req));
A("the night rules: one club a night for a player, three different camp players a night for a club, counted over accepted requests",
  /q\.profile_id = p_profile and q\.status = 'accepted' and q\.team_id <> p_team/.test(night) && /hint = 'other_club'/.test(night)
  && /count\(distinct q\.profile_id\)[\s\S]*q\.team_id = p_team and q\.status = 'accepted' and q\.profile_id <> p_profile/.test(night)
  && /if v_n >= 3 then/.test(night) && /hint = 'night_full'/.test(night) && /shortcut: the three is written here/.test(night));
A("answer: only the player asked, only a pending request (or an acceptance being withdrawn), only before the night's lock",
  before(ans, "if auth.uid() is null then", "if v_q.profile_id <> auth.uid() then")
  && /raise exception 'Only the player asked can answer this request\.' using errcode = '42501';/.test(ans)
  && before(ans, "if v_q.status <> 'pending' and not (v_q.status = 'accepted' and not p_accept) then", "clock_timestamp() >= v_lock") && !/\bnow\(\)/.test(ans)
  && /raise exception '%', \(case v_q\.status/.test(ans));   /* parenthesized CASE */
A("...both night locks are taken before the row is locked, in the same order as the withdraw door (no deadlock)",
  before(ans, "select q.* into v_q from public.market_pool_requests q where q.id = p_request;", "hashtext('market:pool:' || v_q.profile_id::text")
  && before(ans, "hashtext('market:pool:' || v_q.profile_id::text", "hashtext('market:poolclub:' || v_q.team_id::text")
  && before(ans, "hashtext('market:poolclub:' || v_q.team_id::text", "where q.id = p_request for update;")
  && before(wd, "hashtext('market:pool:' || v_q.profile_id::text", "hashtext('market:poolclub:' || v_q.team_id::text")
  && before(wd, "hashtext('market:poolclub:' || v_q.team_id::text", "where q.id = p_request for update;")
  && (ans.match(/pg_advisory_xact_lock/g) || []).length === 2);
A("...a player who accepted may withdraw before the lock: declined, off the club's sheet, the club's seats told",
  /if v_q\.status = 'accepted' then\n\s+v_off := public\._market_guest_off_sheet\(v_q\.game_id, v_q\.team_id, v_q\.profile_id\);\n\s+perform public\.club_notify\(v_q\.team_id, 'lineups', v_name \|\| ' withdrew from a game',/.test(ans)
  && /refile it with a full six before its lineup lock, or the club forfeits the game\./.test(ans));
A("...a decline tells the club's seats, never its room",
  /update public\.market_pool_requests set status = 'declined'/.test(ans) && /v_name \|\| ' declined your training camp request for the game ' \|\| v_words \|\| '\.', null, 'game', v_q\.game_id::text, null, false\);/.test(ans));
A("...an acceptance asks the night rules under both night locks, then accepts",
  before(ans, "hashtext('market:poolclub:' || v_q.team_id::text", "perform public._market_pool_night_check(v_q.team_id, v_q.profile_id, v_night);")
  && before(ans, "perform public._market_pool_night_check(v_q.team_id, v_q.profile_id, v_night);", "set status = 'accepted'"));
A("...the first acceptance closes other clubs' asks that night with a note that never names the club chosen",
  /q\.profile_id = v_q\.profile_id and q\.team_id <> v_q\.team_id and q\.status = 'pending'/.test(ans)
  && /note = 'The player accepted another club''s request for that night\. A training camp player plays for one club a night\.'/.test(ans));
A("...a club's third camp player closes its other open asks that night, except more games of the players it has",
  /if v_n >= 3 then\n\s+update public\.market_pool_requests q/.test(ans)
  && /and q\.profile_id not in \(select a\.profile_id from public\.market_pool_requests a/.test(ans));
A("withdraw: the club's seat, a pending request or the release of an accepted guest, only before the night's lock",
  before(wd, "if not (v_office or public.is_gm_of(v_q.team_id)) then", "perform public._market_ctx(v_q.team_id, 'lines');")
  && /if v_q\.status not in \('pending', 'accepted'\) then/.test(wd)
  && before(wd, "if v_q.status not in ('pending', 'accepted') then", "if v_lock is not null and clock_timestamp() >= v_lock then")
  && /where id = p_request and status = v_q\.status;\n\s+get diagnostics v_n = row_count;\n\s+if v_n <> 1 then/.test(wd) && !/\bnow\(\)/.test(wd)
  && !/A request cannot be withdrawn once the player accepts it/.test(sql));
A("...a released guest comes off the sheet, the player is told, and the answer says whether the sheet changed",
  /v_off := public\._market_guest_off_sheet\(v_q\.game_id, v_q\.team_id, v_q\.profile_id\);\n\s+v_text := 'The ' \|\| coalesce\(v_club, 'club'\) \|\| ' released you from the game '/.test(wd)
  && /'released', v_q\.status = 'accepted',\n\s+'off_sheet', v_off > 0\);/.test(wd) && /perform public\._market_dm\(v_q\.profile_id, v_text\);/.test(wd));
const off = fn("_market_guest_off_sheet");
A("the one sheet pull for an ended guest: nulls only that player on that club's sheet for that game, stamps updated_at, keeps a player now rostered on that club",
  /set center = nullif\(gl\.center, p_profile\), lw = nullif\(gl\.lw, p_profile\)/.test(off) && /updated_at = now\(\)/.test(off)
  && /where gl\.game_id = p_game and gl\.team_id = p_team/.test(off)
  && /rs\.season_id = g\.season_id and rs\.team_id = p_team and rs\.profile_id = p_profile/.test(off)
  && (sql.match(/public\._market_guest_off_sheet\((v_q|r)\.game_id/g) || []).length === 3);

console.log("\n4. The one-night guest");
const guest = fn("_market_guest");
A("_market_guest: an accepted request for that game and club, and no roster spot this season",
  /q\.game_id = p_game and q\.team_id = p_team and q\.profile_id = p_profile and q\.status = 'accepted'/.test(guest)
  && /not exists \(select 1 from public\.roster_spots rs\n\s+where rs\.season_id = g\.season_id and rs\.profile_id = p_profile\)/.test(guest));
const lso = patch("public.lineup_slot_ok(uuid,text,uuid,uuid,text)");
A("lineup_slot_ok: DROP plus CREATE with p_game, a guest passes for that game only, and the API roles lose EXECUTE",
  /p_stage text DEFAULT NULL::text, p_game uuid DEFAULT NULL::uuid\)\$b\$/.test(lso)
  && /if p_game is not null and public\._market_guest\(p_game, p_team, p_pid\) then return; end if;/.test(lso)
  && /'public\.lineup_slot_ok\(uuid,text,uuid,uuid,text,uuid\)'\);/.test(lso)
  && /revoke all on function public\.lineup_slot_ok\(uuid, text, uuid, uuid, text, uuid\) from public, anon, authenticated;/.test(sql));
const sgl = patch("public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)");
A("set_game_lineup: in a market season at least half of the sheet is the club's own (three guests at most in six)",
  /if public\.market_on\(v_game\.season_id\) then\n\s+declare v_guests int := \(select count\(\*\) from unnest\(v_players\) x where public\._market_guest\(p_game, p_team, x\)\);/.test(sgl)
  && /if 2 \* v_guests > cardinality\(v_players\) then/.test(sgl) && /hint = 'camp_half'/.test(sgl));
A("...a guest skips the contract test, and every slot check carries the game",
  /foreach v_p in array v_players loop\n\s+continue when public\._market_guest\(p_game, p_team, v_p\);/.test(sgl)
  && (sgl.match(/v_game\.stage, p_game\);/g) || []).length === 6);
A("...from the lock until the game is ruled, a club without six on file cannot complete its sheet; the office may still file",
  /if v_locked and public\.market_on\(v_game\.season_id\) and not public\.is_commissioner\(\)\n\s+and num_nonnulls\(v_old\.center, v_old\.lw, v_old\.rw, v_old\.ld, v_old\.rd, v_old\.goalie\) < 6\n\s+and not exists \(select 1 from public\.market_lineup_deadlines d where d\.game_id = p_game/.test(sgl)
  && /hint = 'lineup_deadline'/.test(sgl) && /A club without a full lineup of six by then forfeits the game\./.test(sgl));
A("...a dressed player on no roster is told the request is missing, in a market season only (the Season 1 sentence stays)",
  /if public\.market_on\(v_game\.season_id\)\n\s+and not exists \(select 1 from public\.roster_spots rs where rs\.season_id = v_game\.season_id and rs\.profile_id = v_p\) then/.test(sgl)
  && /hint = 'not_a_guest';\n\s+end if;\n\s+raise exception 'A dressed player is not on this club''s active roster\.' using errcode = '22023';/.test(sgl));
A("the patch helper proves every Season 1 body byte for byte: each change put back must give the old body",
  /for i in reverse array_length\(p_old, 1\) \.\. 1 loop/.test(sql) && /if v_back <> v_old then\n\s+raise exception 'v4.59 pool requests: % differs from its old body by more than this record''s changes', p_fn;/.test(sql)
  && /drop function pg_temp\.vnnn_patch\(text, text\[\], text\[\], text\);/.test(sql));
A("can_see_match: a player who accepted THIS game's request sees its code at the night's lock, inside the after-lock branch",
  /where rs\.profile_id = auth\.uid\(\)\)\n[\s\S]*?or exists \(select 1 from public\.market_pool_requests q where q\.game_id = p_game and q\.profile_id = auth\.uid\(\)\n\s+and q\.status = 'accepted'\) \) \) \)\$b\$/.test(patch("public.can_see_match(uuid)")));
A("review_game_records: an accepted guest of that game is never 'on no squad', and keeps no squad (the cap set_game_lineup applies)",
  /if not v_rostered and exists \(select 1 from public\.market_pool_requests q where q\.game_id = p_game\n\s+and q\.team_id = r\.team_id and q\.profile_id = r\.profile_id and q\.status = 'accepted'\) then\n\s+v_rostered := true;\n\s+end if;/.test(patch("public.review_game_records(uuid)"))
  && !/v_squad := 'tc'/.test(sql));

console.log("\n5. Suspensions by night");
const cs = patch("public.count_suspension_games()"), sn = fn("_market_pool_suspension_night");
A("count_suspension_games calls the night helper on a final and on a reopen, in market seasons only",
  (cs.match(/if public\.market_on\(new\.season_id\) then\n\s+perform public\._market_pool_suspension_night\(new\.season_id, \(new\.scheduled_at at time zone 'America\/New_York'\)::date\);/g) || []).length === 2);
A("...a pool player (signed up, on no roster) serves one league game night once, on a final unvoided game the suspension predates",
  /g\.status = 'final' and not coalesce\(g\.voided, false\)/.test(sn) && /s\.status = 'active' and s\.mode = 'games' and s\.created_at <= r\.scheduled_at/.test(sn)
  && /x\.status <> 'declined'/.test(sn) && /not exists \(select 1 from public\.roster_spots rs where rs\.season_id = p_season and rs\.profile_id = s\.profile_id\)/.test(sn)
  && /\(sg\.game_at at time zone 'America\/New_York'\)::date = p_night/.test(sn) && /< coalesce\(s\.games_total, 0\)/.test(sn));

console.log("\n6. The tick");
const ff = fn("_market_lineup_forfeits"), sw = fn("_market_pool_sweep"), tick = patch("public.market_tick()");
A("the lineup deadline: 5 seconds past the game's own lock and before its puck drop, on clock_timestamp(), one game per block",
  /clock_timestamp\(\) >= g\.scheduled_at - interval '30 minutes' \+ interval '5 seconds'\n\s+and clock_timestamp\(\) < g\.scheduled_at/.test(ff)
  && /for update of g skip locked/.test(ff)
  && /exception when others then\n\s+v_err := v_err \|\| /.test(ff) && /return v_err;/.test(ff) && !/\bnow\(\)/.test(ff));
A("...ruled ONCE: a game with a ruling for its night is never chosen again, and the ruling is written in the block with its result",
  /and not exists \(select 1 from public\.market_lineup_deadlines d\n\s+where d\.game_id = g\.id and d\.night = \(g\.scheduled_at at time zone 'America\/New_York'\)::date\)/.test(ff)
  && before(ff, "insert into public.market_lineup_deadlines (game_id, night, season_id, lock_at, home_set, away_set, outcome)", "continue when v_box or (v_home and v_away);")
  && before(ff, "begin\n      v_lock :=", "insert into public.market_lineup_deadlines"));
A("...a side is set only with a full six on file at the lock (a change after the lock means it had six, or the league pulled)",
  (ff.match(/num_nonnulls\(gl\.center, gl\.lw, gl\.rw, gl\.ld, gl\.rd, gl\.goalie\) = 6 or gl\.updated_at > v_lock\)/g) || []).length === 2
  && !/num_nonnulls\([^)]*\) > 0/.test(sql));
A("...a game with a box score in gets its ruling row and no result (the officials rule it); a playoff void tells staff the series needs a date",
  /v_box := r\.ea_match_id is not null or exists \(select 1 from public\.game_stats s where s\.game_id = r\.id\);/.test(ff)
  && /case when v_box then 'officials' when v_home and v_away then 'set' when v_home or v_away then 'forfeit' else 'void' end/.test(ff)
  && /case when r\.stage = 'playoff' then ' This is a playoff game, so the series needs the league office to reschedule it\.' else '' end/.test(ff)
  && (ff.match(/shortcut: /g) || []).length === 3);
A("...one club missing forfeits 1-0 (declare_forfeit's result); neither club voids the game (no double forfeits)",
  /update public\.games set home_score = 0, away_score = 0, went_ot = false, forfeit_team_id = null, voided = true,\n\s+ea_match_id = null, status = 'final'/.test(ff)
  && /forfeit_team_id = v_lose, voided = false, ea_match_id = null, status = 'final'/.test(ff)
  && /home_score = case when home_team_id = v_win then 1 else 0 end/.test(ff));
A("...the one #game-scores post is the games trigger's: the step posts nothing to Discord itself but the staff note",
  !/notify_discord\(/.test(ff) && !/discord_scores_webhook/.test(ff) && /perform public\.notify_staff_ch\('casework', /.test(ff)
  && /perform public\.log_admin_action\('lineup_deadline_forfeit', 'game', r\.id::text,/.test(ff));
A("the sweep: closes asks for games no longer open, lapses unanswered ones at the night's lock, closes live ones on a move, a departure or a suspension",
  /note = 'The game is no longer open for lineups\.'/.test(sw) && /set status = 'lapsed'/.test(sw) && /clock_timestamp\(\) >= public\.night_lock_at\(q\.game_id\)/.test(sw)
  && /when g\.scheduled_at is distinct from q\.game_at\n\s+and \(q\.status = 'pending' or clock_timestamp\(\) < public\.night_lock_at\(q\.game_id\)\n\s+or \(g\.scheduled_at at time zone 'America\/New_York'\)::date <> \(q\.game_at at time zone 'America\/New_York'\)::date\)/.test(sw)
  && /public\._market_waiver_void_why\(p_season, q\.profile_id\) is not null/.test(sw)
  && /when public\.is_suspended\(q\.profile_id\) then 'The player is suspended\.'/.test(sw) && /g\.scheduled_at > clock_timestamp\(\)/.test(sw));
A("...an accepted guest's game delayed within its night after the lock keeps the guest: game_at follows, player and club told",
  /update public\.market_pool_requests set game_at = r\.new_at where id = r\.id and status = 'accepted';/.test(sw)
  && /'Your game moved'/.test(sw) && /'A training camp guest''s game moved'/.test(sw));
A("...a closed acceptance takes the guest off the sheet and tells the club to refile",
  /if r\.was = 'accepted' then\n\s+v_off := public\._market_guest_off_sheet\(r\.game_id, r\.team_id, r\.profile_id\);/.test(sw)
  && /' They came off that game''s lineup, so refile it\.'/.test(sw));
A("...once the night has locked, each accepted player gets the code by DM once, through the bot's lane",
  /q\.status = 'accepted' and q\.code_dm_at is null/.test(sw) && /clock_timestamp\(\) >= public\.night_lock_at\(g\.id\)/.test(sw)
  && /perform public\._market_dm\(r\.profile_id, 'Your game for the '/.test(sw) && /set code_dm_at = clock_timestamp\(\)/.test(sw) && !/\bnow\(\)/.test(sw)
  && /perform public\.create_notification\(r\.profile_id, 'lineups', 'Your game code is ready',/.test(sw));
const nla = patch("public.night_lock_at(uuid,date)");
A("night_lock_at: the earliest ruled lock of the night holds it (a voided or moved game never moves a passed lock); every Season 1 night compared before and after",
  /select least\(min\(scheduled_at\) - interval '30 minutes',\n\s+\(select min\(d\.lock_at\) from public\.market_lineup_deadlines d where d\.season_id = p_season and d\.night = p_day\)\)\n\$b\$/.test(nla)
  && /if v_after is distinct from v_before then\n\s+raise exception 'v4.59 pool requests: night_lock_at changed a Season 1 night''s lock';/.test(sql)
  && before(sql, "into v_before", "perform pg_temp.vnnn_patch('public.night_lock_at(uuid,date)'"));
A("mgmt_request_move: a market-season queued lineup tells the Owner its deadline; Season 1 adds nothing",
  /p_action = 'set_game_lineup' and g\.id::text = p_args->>'p_game' and public\.market_on\(g\.season_id\)\), ''\),/.test(patch("public.mgmt_request_move(text,text,jsonb,text)")));
A("market_tick: the deadline, then the sweep, each in its own block, above the steps end line",
  before(tick, "v_errors := v_errors || public._market_lineup_forfeits(v_season);", "perform public._market_pool_sweep(v_season);")
  && before(tick, "perform public._market_pool_sweep(v_season);", "    -- market-tick steps end\n$b$")
  && (tick.match(/exception when others then\n\s+v_errors := v_errors \|\| /g) || []).length === 2);

console.log("\n7. Grants and self-checks");
A("only the three doors are granted, to authenticated; every helper is revoked from the API roles",
  /grant execute on function public\.market_pool_request\(uuid, uuid, uuid\) to authenticated;/.test(sql)
  && /grant execute on function public\.market_pool_answer\(uuid, boolean\) to authenticated;/.test(sql)
  && /grant execute on function public\.market_pool_withdraw\(uuid\) to authenticated;/.test(sql)
  && (sql.match(/grant execute on function/g) || []).length === 4   /* the three doors and lineup_slot_ok's service_role */
  && /execute 'revoke all on function ' \|\| f \|\| ' from public, anon, authenticated';/.test(sql));
A("every new function is a definer with search_path '' (the self-check and the text)",
  ["_market_guest", "_market_guest_off_sheet", "_market_pool_game_words", "_market_pool_night_check", "market_pool_request", "market_pool_answer", "market_pool_withdraw",
   "_market_pool_suspension_night", "_market_lineup_forfeits", "_market_pool_sweep"].every((n) =>
    new RegExp("create or replace function public\\." + n + "\\([^)]*\\)\\nreturns [^\\n]* security definer set search_path to '' as \\$f\\$").test(sql))
  && /'search_path=""' = any\(coalesce\(p\.proconfig, '\{\}'\)\)/.test(sql));
const waiversS1 = (R("sql/2026-11-24-s2-waivers-v458.sql").match(/s1_rules constant jsonb := '[^']*'::jsonb;/) || [])[0];
A("the self-checks compare season_rules(Season 1) to the captured literal, and Season 1 is never a market season",
  waiversS1 && sql.indexOf(waiversS1) >= 0 && /if public\.market_on\(\(select id from public\.seasons where number = 1\)\) then/.test(sql));
A("the self-checks hold the grants, the one lineup_slot_ok, the step order, RLS, the pulse and Realtime",
  ["a client RPC lost its grant", "expected exactly one lineup_slot_ok(uuid, text, uuid, uuid, text, uuid)", "a patched function gained an overload",
   "night_lock_at and set_game_lineup must read the deadline rulings", "market_lineup_deadlines must have RLS on and no policy (office only)",
   "market_tick must rule the lineup deadline, then sweep the requests", "must have RLS on and exactly one (SELECT) policy",
   "needs its three live_mark triggers and Realtime"].every((t) => sql.indexOf(t) >= 0));
A("plpgsql traps: no bare CASE in an IF condition, no any((select ...))", !/\n\s+(if|elsif) case /i.test(sql) && !/any\(\(select/i.test(sql)
  && !/\n\s+(if|elsif) [^\n]*\bcase when/i.test(sql.replace(/\(case when [^\n]*?end\)/g, "")));

console.log("\n8. Words");
A("no em or en dashes in the record or the rehearsal", !DASHES.test(sql) && !DASHES.test(R(REH)));
A("neutral pronouns in every message and comment", !GENDERED.test(messages), (messages.match(GENDERED) || [])[0]);
A("American spelling", !BRITISH.test(sql) && !BRITISH.test(R(REH)));
A("nothing new on Netlify: no function or job file calls the new doors",
  !fs.readdirSync(path.join(root, "netlify/functions")).some((f) => /market_pool_(request|answer|withdraw)/.test(R("netlify/functions/" + f))));

console.log("\n9. The rehearsal");
const reh = R(REH);
const embedded = (reh.match(/-- >>> record text: [^\n]*\n([\s\S]*?)-- <<< record text\n/) || [])[1] || "";
const cases = reh.replace(embedded, "");
/* up to the record's results comment, so the main session may write the rehearsal results into the record alone */
const toResults = (s) => s.slice(0, s.indexOf("\n/* Rehearsal:"));
A("it carries the record's text byte for byte (up to the results comment), inside one transaction",
  sql.indexOf("\n/* Rehearsal:") > 0 && toResults(embedded) === toResults(sql) && before(reh, "\nbegin;\n", "-- >>> record text: " + REC));
A("its header states the prerequisites and when it can run",
  /Prerequisites: the v4\.58 records live/.test(reh) && /When: any day before Season 2's first game night that has NO Season 2 game on it/.test(reh));
A("the world refuses a day with a Season 2 game, the minutes before midnight, a real game past its lock, and an open shortfall draw",
  /world: Season 2 has a game today/.test(cases) && /world: run this rehearsal outside the fifteen minutes before midnight ET/.test(cases)
  && /world: a real Season 2 game is past its lineup lock/.test(cases) && /world: a Season 2 shortfall draw is open/.test(cases)
  && /not in the fifteen minutes before\n-- midnight ET/.test(reh) && !/ten minutes before midnight/.test(reh));
A("every ask, answer and request id comes from the RPC's own return, never a lookup by time",
  !/order by [a-z_.]*created_at desc/i.test(cases) && (cases.match(/->>'request_id', true\);/g) || []).length >= 14);
A("each case is asserted: requests, refusals, visibility, answers, night rules, withdraw, lineups, code, late door, the lock, the tick, after the lock, the box score, closures, Season 1",
  ["T1 failed", "T2 failed", "T3 failed", "T4 failed", "T5 failed", "T6 failed", "T7 failed", "T8 failed", "T9 failed", "T10 failed",
   "T11 failed", "T12 failed", "T13 failed", "T14 failed", "T15 failed"].every((t) => cases.indexOf(t) >= 0));
A("the tick posts exactly one #game-scores line per ruled game and sends the code by DM once",
  /\(select count\(\*\) from net\.http_request_queue q where q\.id > v_q0 and q\.url = v_scores\) <> 2/.test(cases)
  && /T11 failed: a second tick posted, ruled or sent a DM again/.test(cases));
A("the review cases: a full six ruled once (a partial sheet forfeits, a drop after the ruling and a reopen are not ruled again), the night's lock kept, both back-out doors, the guest off the sheet",
  /T11 failed: C \(five players at the lock\) did not forfeit G2 1-0/.test(cases)
  && /T10 failed: a club completed a five-player sheet after the lineup deadline/.test(cases)
  && /T11 failed: a sheet that dropped below six after the ruling was ruled again/.test(cases)
  && /T13 failed: the tick ruled the reopened G2 again/.test(cases)
  && /T11 failed: voiding the night''s first game moved the night''s lock/.test(cases)
  && /T11 failed: a game delayed within its night after the lock lost its guests/.test(cases)
  && /T6 failed: B could not release its accepted guest P1 from G4, or P1 stayed on the sheet/.test(cases)
  && /T6 failed: P1 could not withdraw an acceptance before the lock/.test(cases)
  && /T10 failed: a club released its guest after the lock/.test(cases) && /T10 failed: a player withdrew an acceptance after the lock/.test(cases)
  && /T14 failed: P6 did not come off B''s G5 sheet/.test(cases) && /T14 failed: L, now on B''s own roster, kept the ask or came off B''s sheet/.test(cases));
A("...the N1 sheets are stamped as filed before the lock, and every bell probe reads only this transaction's rows",
  /update public\.game_lineups set updated_at = now\(\) - interval '1 hour' where game_id in \(v_g1, v_g2, v_g3\);/.test(cases)
  && !/from public\.notifications (n )?where (?![^;]*created_at >= now\(\))[^;]*;/.test(cases.replace(/\n\s*/g, " ")));
A("the positive controls: an unrequested pool player is flagged, a declined player is refused, a player rostered elsewhere loses the ask",
  /T13 failed: expected exactly one "on no squad" flag on G1, for the unrequested pool player/.test(cases)
  && /T7 failed: a player who declined was dressed/.test(cases) && /T14 failed: the rostered player''s ask did not close/.test(cases));
A("roles: anon and authenticated by set local role, reset before office reads", /set local role anon;/.test(cases) && /set local role authenticated;/.test(cases) && /reset role;/.test(cases));
A("the verdict block raises uncaught with every case named, and nothing catches it",
  /do \$v\$[\s\S]*raise exception 'REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15';\nend \$v\$;\s*$/.test(reh)
  && !/do \$v\$[\s\S]*exception when/.test(reh));
A("no dblink, no http, and no member named (players are picked inside the transaction)",
  !/dblink|http_get|http_post\(/i.test(cases) && !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
