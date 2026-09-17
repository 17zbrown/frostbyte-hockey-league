# CGHL stress test and permissions audit — September 17, 2026

Read-only. Nothing was fixed, nothing in the live database or the Discord was changed. Every finding
below was verified against the live catalog (`pg_get_functiondef`, `pg_policies`,
`has_function_privilege`, `information_schema.column_privileges`), the repo at `79b9ed3`, Supabase's
edge/PostgREST/Postgres logs, or the guild itself before it was listed. Where a review lens
overstated something, the corrected impact is what appears here.

Method: `tools/loadtest.mjs` (anon key, GET/RPC only) for the live measurements; six review lenses in
parallel (grants/RLS, client gates, draft day, the game week, Netlify functions + bot, Discord
permissions) with an adversarial verification pass (61 findings verified, 52 stood, 5 refuted,
4 verifier crashes re-checked by hand); my own re-verification of every listed item.

## 1. Capacity — what the platform actually does under load

Compute: Nano/Micro class — `max_connections = 60`, `shared_buffers = 224 MB`, PostgREST pool ≈ 10
connections; `statement_timeout` 3 s for anon, 8 s for authenticated. Database 80 MB, 216 games,
246 profiles, 0 box scores yet.

| Scenario | Shape | Result |
|---|---|---|
| **site** — the page itself | 300 fetches, 60 concurrent | 2,121,408 B raw / ~585 KB brotli per visit, TTFB 1.3–2.0 s from the CDN, `cache-control: public, max-age=0, must-revalidate` (revalidated on every visit). The 4 errors and 144 s max in this run were my uplink saturating on 60 × 2 MB, not the CDN. |
| **boot** — a visitor's query set | 150 visitors arriving over 60 s × 16 requests | p50 50–80 ms, p95 130–180 ms, max < 1 s, 0 errors, 0 × 429. Per visit: games 121 KB, contracts 58 KB, registration_pool 46 KB, draft_picks 30 KB. |
| **draft** — a pick lands | 5 bursts × 170 open draft rooms × 2 tables (340 concurrent requests) | 0.6–0.9 s per burst (3.1 s cold), p50 675 ms, 0 errors. Draft day is fine as designed: the draft room applies the realtime row in place and refetches two small tables. |
| **herd** — a game goes final | 40 open tabs each re-running the whole boot set at once (640 concurrent requests), three waves | **p50 13 s, 25% of requests failed** (`503` from PostgREST, `522` from Cloudflare). 150 tabs: 60–90 s waves, ~50% failed. |

What the herd did server-side (Supabase logs, 14:30–14:56 UTC): 3,437 × `503`, 614 × `522`;
PostgREST `Warp server error: Thread killed by timeout manager` × 921; Postgres
`cron job 6 job startup timeout` (job 6 is the **draft clock**, `_draft_auto_advance` every minute)
and `cron job 13 job startup timeout` (`flush_mgmt_move_pending`). Read traffic from the public
site can starve the scheduled jobs.

Why the herd exists: every tab, guests included, subscribes to `league-live` (realtime on
`games`) and on any `games` row change calls `CG.liveReload()` — a 1 s debounce, then
`buildLiveLeague()` = the entire boot set again (plus manager/availability/trade loads for
signed-in users). On a game night each slot produces ~5 such events (server resolution at T-30,
then each final as EA reports it); three slots a night. At 40 open tabs the platform is already
returning errors to everyone; game-night attendance will be higher.

## 2. Findings, ranked

Severity: **P0** break the league or let an outsider change league data today; **P1** let a member
or manager act outside their seat, or will fail on the first game night; **P2** integrity and
operations gaps to close this season; **P3** hygiene.

### P0

**P0-1 · Players cannot accept, decline or counter a contract offer — `respond_offer` is not executable by signed-in users.**
`pg_proc.proacl` for `public.respond_offer(uuid,text,bigint,integer)` is
`{postgres=X, service_role=X}`; `has_function_privilege('authenticated', …, 'EXECUTE') = false`.
The client calls it directly with the player's session on "Accept and sign" / "Decline"
(`part_live.js:1832`, `:1844`) and management calls it for "Close the offer" / "Revise"
(`:1790`, `:1813`). Every such click will answer `permission denied for function respond_offer`.
This is the only one of the 101 RPC names the client calls that is not granted (the other five
ungranted names — `roster_block`, `schedule_pick`, `trade_cancel`, `trade_decline`,
`trade_propose` — are approval-queue keys, not RPCs, and are fine). `offer_free_agent` is granted,
so offers can be made but never answered: the basic-format waived-player signing path and the
Season 2 extension path are dead.
Fix: `grant execute on function public.respond_offer(uuid,text,bigint,integer) to authenticated;`
then a rehearsal with a test offer. Add the "every client RPC is executable by authenticated"
check to the release suite so a lost grant can't ship again.

**P0-2 · Anyone with the page's anon key can place any registrant on a club — `_assign_reg_random` is PUBLIC-executable with no authorization.**
`public._assign_reg_random(uuid,text,boolean,text)` is SECURITY DEFINER, owner `postgres`, ACL
`{=X, anon=X, authenticated=X, …}`. Its body checks only that the registration exists, is not
declined and is not already rostered, then inserts a `roster_spots` row on a random club, flips
the registration to `assigned` and logs a "League-office placement" transaction. `registration_pool()`
(also PUBLIC) hands out every registration id. Two `curl`s per registrant empties the draft pool
before Saturday. Its four callers (`preseason_random_assign`, `auto_assign_latecomers`,
`distribute_unproven_rookies`, `trg_autoassign_new_reg`) are all SECURITY DEFINER and owned by
`postgres`, so revoking the public grant changes nothing for them.
Today 144 of the 167 registrants are unrostered and draft-eligible; the same call works live
during the draft to pre-empt a pick. (For an anon caller the registration's `status` flip is
silently reverted by the column guard, so the board keeps saying "pending" while the player is
seated — an inconsistency, not a mitigation.) Same pattern, smaller door: `auto_assign_latecomers`
and `distribute_unproven_rookies` guard with `auth.uid() is not null and not is_commissioner()`,
which lets anon through to their own stage gates.
Fix: `revoke execute on function public._assign_reg_random(uuid,text,boolean,text) from public, anon, authenticated;`
and a defense-in-depth guard at the top (`if not (is_commissioner() or trusted_writer()) …`).
To stop the class recurring: `alter default privileges in schema public revoke execute on functions from public;`
and a release-suite check that fails on any SECURITY DEFINER function with anon/authenticated
EXECUTE and no auth reference in its body (the query this audit used).

**P0-3 · Game nights and draft day will overload the database as the site is built today (see §1).**
Three things compound: the compute tier (≈10 PostgREST connections), the league-live "rebuild
everything on every `games` change" pattern, and the boot set's weight (games + profiles + contracts
+ registration_pool ≈ 250 KB per rebuild). Measured: 40 tabs → 25% errors and a 13 s median; the
draft clock cron job timed out during the burst.
Fix (in order of leverage): (a) in `CG.subscribeLeague`, apply the changed `games` row in place
and refetch only `games` (and `game_stats` for that game) instead of `buildLiveLeague()`, and
jitter the debounce (1–10 s) so tabs don't fire together; (b) serve the anonymous boot set as one
CDN-cached snapshot (a Netlify function or a `league.json` regenerated on change) so the database
answers once, not once per tab; (c) upgrade compute to Small for the season (Supabase compute
add-on; 90 connections and a bigger PostgREST pool) — cheap insurance for Sep 19 and Sep 23;
(d) move the draft clock off `pg_cron` (the bot VM already runs a 1-second tick loop) or at least
alert when a cron start times out.

### P1

**P1-1 · The receiving club can rewrite a trade's terms, then accept it.**
`trades` policy `involved update trade` (UPDATE, `is_gm_of(from_team_id) OR is_gm_of(to_team_id)`)
is not column-scoped; `guard_trade_insert` fires only on `offered_pick_ids, requested_pick_ids,
season_id, status`. So the GM of `to_team_id` can PATCH `offered_profile_ids`,
`requested_profile_ids` and `retention` on a proposed trade and then call `accept_trade`, which
executes whatever the row says (no consent hash, no re-confirmation by the proposer).
Fix: revoke column UPDATE on the asset columns from `authenticated` (leave `status`/`note`), or a
BEFORE UPDATE trigger that rejects asset changes once `status = 'proposed'` unless the writer is the
proposer; simplest is to move proposal edits behind an RPC.

**P1-2 · Club management can rewrite a roster row's `profile_id`, `origin`, `jersey_number` — sign anyone by editing a row, or relabel a player as a non-counting loan.**
`roster_spots` policy `gm updates own team roster` is row-scoped only; the BEFORE UPDATE guard
(`guard_roster_immutable`) pins `squad_moves`, `position`, `status`, and `block_noncommish_salary`
pins `salary` — nothing pins `profile_id`, `origin` (`preseason_random` = uncapped loan) or
`season_id`. A PATCH swaps any member (unregistered or another club's free agent) into an existing
spot without draft, offer, cap or notice.
Fix: column-level `revoke update (profile_id, origin, season_id, team_id) on roster_spots from authenticated`
(the RPCs run as owner), or extend `guard_roster_immutable`.

**P1-3 · Private lobby codes and servers are readable by anyone, any time.**
`games` policy `games read` is `qual = true`; `game_code` and `server` are column-granted to
`anon`/`authenticated`; the client loads `select('*')` into `schedule[].code` for every visitor at
boot (`part_live.js:473`). The site promises "codes go live on each matchup page 30 minutes before
puck drop" and only to the confirmed lineup (`part4_ui.js:509`, `part6_hub.js:383`). The
`games_public` view with `can_see_match()` masking exists and is used by nothing. Anyone can join
the private EA lobby of any league game.
Fix: revoke column SELECT on `games.game_code`/`games.server` from `anon`/`authenticated`; read
codes through `games_public` (or a `game_code_for(p_game)` RPC) only at T-30 for dressed players,
management and officials.

**P1-4 · Emergency call-ups are accepted after puck drop and after the game is played, and nobody is told.**
`set_game_lineup` refuses post-lock writes unless `p_emergency`, with no upper bound: any time while
`status = 'scheduled'` — during the game and in the window between the final horn and the import.
A club that dressed a ringer can re-file post-game to include him; `check_weekly_cap_violations`
then sees him "on the filed lineup" and stays silent. `penalties_owed` increments but is shown only
to the club's own management (`part6_hub.js:1197`); the opponent and officials get nothing unless
the swapped-in player is a camp player — and in the basic format nobody is in camp, so that branch
cannot fire this season. Rule 5.3 says the substitution is reported before the game begins and
verified by the officials against the box score; today there is no record for them to check.
Fix: refuse `p_emergency` once `now() >= scheduled_at` (or a 5-minute grace) and notify the
opponent's front office + the officials desk on every post-lock change; surface `penalties_owed`
to the opponent.

**P1-5 · A club's management can erase a Rule 3.2 forfeit ruling.**
The manual lag-out merge in `ingest-stats.js` (`:967–1047`) lets either club's management merge
sittings from ±1 day into the fixture; it only refuses voided games, and it writes
`forfeit_team_id: null` (the comment calls it "mutual consent" — nothing checks the other club or
staff). The forfeiting club can undo a staff ruling on its own. The auto path correctly skips
forfeit-ruled games (`:388`, `:552`); the manual path does not.
Fix: management merges refuse games with `forfeit_team_id` set (staff only), and never clear a
ruling — staff use `unforfeit_game`.

**P1-6 · `waive_player`'s "not on your roster" guard is dead — any Owner/GM can log a public waiver of a player who was never on the club.**
```
delete from roster_spots … ; perform set_config('app.roster_reason','',true); get diagnostics v_n = row_count;
```
`row_count` reads the `PERFORM` (one row), so `v_n = 1` always. Calling `waive_player(<any profile>)`
deletes nothing, then inserts "<club> waived <him>" into the public transaction log, fires the
`#transactions` Discord post (with the player's @-mention and the club role), and returns success
so the client toasts "waived — any club may sign him now". Reachable from a stale tab or a
duplicate click as well as on purpose. (The cross-club `season_registrations.status = 'pending'`
write does *not* land for ordinary managers — `guard_registration_columns` silently reverts it —
which is its own defect: a legitimate waiver by a manager leaves the player's registration
`assigned`.)
Fix: check `found` immediately after the `delete`, before the `set_config`; and have the function
set `app.role_grant` (or run the status update through a trusted path) so a real waiver updates the
registration.

**P1-7 · Sign-ups can be backdated past the draft cutoff, and status / scout OVR can be self-set on insert.**
`season_registrations` INSERT policy pins only `profile_id` and `registration_open`;
`guard_registration_columns` is an UPDATE-only trigger. `is_draft_eligible` is
`created_at <= signup_deadline_at`. After tonight's cutoff a crafted insert with an earlier
`created_at` is draft-eligible; `status` and `scout_ovr` are accepted as sent.
Fix: revoke column INSERT on `created_at, status, scout_ovr` from `authenticated`, or make the
guard a BEFORE INSERT OR UPDATE trigger that forces them.

**P1-8 · `preseason_release_loans` is PUBLIC-executable with no authorization.**
SECURITY DEFINER, ACL `{=X, …}`, no guard: deletes every `origin = 'preseason_random'` roster spot
in the season it is given and posts a "loans returned" notice to every club room. Zero such rows
today (loans were released), so the blast radius is nil until pre-season loans exist again — but
the entry points that should own it (`preseason_release_now`, `start_draft`,
`preseason_autorelease`) are all SECURITY DEFINER, so the public grant is pure exposure.
Fix: `revoke execute … from public, anon, authenticated;` plus a guard.

### P2

**P2-0 · `discord-sync`'s HTTP entry points are dead, and a killed member pass is invisible.**
Since the function became scheduled (`config.schedule`), Netlify refuses external HTTP calls to it
(`?diag=`, `?register=`, `?setup=`, `?reconcile=`, the site's instant-sync POST and "Run now" all
get the 403 seen earlier). Scheduled functions get 30 s. The Automations chip shows "ok" from the
last *completed* sweep because the heartbeat is stamped at start and the result at end; a member
pass that needs hundreds of `PATCH /members` (registration opening for Season 2, a ban wave, the
bot down through draft day) is killed at 30 s with no record, and `resolve_due_servers` — called
only at the tail of that sweep — silently stops running on those nights.
Fix: a second, HTTP-only function for diag/run-now; a time budget in the sweep (stop the member
passes at ~60% of the limit, record `partial`), and `resolve_due_servers` on `pg_cron` (or the bot)
so server picks never depend on the sweep's tail.

**P2-1 · Filed lineups are world-readable before they lock.** `game_lineups_read` (and the dormant
`lineups_read`) are `qual = true`; the client hides the opponent's sheet until T-30, the database
does not. Fix: read policy = own club, officials, or `now() >= scheduled_at - 30 min`.

**P2-2 · `_mgmt_move_send` is PUBLIC-executable** — anyone can post arbitrary content to the
`#management-moves` webhook, with a club-role ping when `p_appointed`. Fix: revoke from public.

**P2-3 · The LFG lobby RPCs are public.** `lfg_form_lobby` (anon, CAS-guarded) and
`lfg_open_lobby` (any member) are only ever called by the service-key bot. Fix: revoke from
public/anon/authenticated.

**P2-4 · `game_stats` has no natural unique key** (only `id`). A double-delivered match — the
VM lane and the Netlify fallback overlapping after a 10-minute stale heartbeat, or any re-POST —
doubles the box score (caps survive via `DISTINCT`; totals, leaders and ratings do not). Fix:
unique `(game_id, team_id, ea_player_id)` + upsert with `merge-duplicates`.

**P2-5 · Waived players stay dressed.** `revalidate_lineups_on_roster_change` is AFTER UPDATE only;
a waiver is a DELETE, so the player stays in every filed `game_lineups` row, is counted by
`player_week_games` and dresses an ineligible player at lock. Fix: AFTER DELETE branch that clears
his slots and notifies the club.

**P2-6 · The Rule 5.2/5.3 check runs once.** `check_weekly_cap_violations` fires on
`UPDATE OF status`; lag-out merges (auto and manual) rewrite the box score without changing status,
so a player who only appears in the replay sitting is never examined. Fix: also fire on
`game_stats` writes, or call the check from the merge.

**P2-8 · Discord: the FAQ forum was renamed today and the reconciler spawned a duplicate.**
`ensureFaqForums` keys the forum by name + parent; `#management-faq` (1550142808936026162, the one
with the five seeded guide threads) was renamed to `#mgnt-faq`, and the next sweep created an empty
`#management-faq` (1550147338205532230) and repointed `app_config.discord_management_faq_channel_id`
at it. Fix: key by the stored channel id first, adopt renames, fall back to name only when the id
is gone. (Left as is — the audit is read-only; say the word and I'll repoint the config at the
renamed forum and remove the empty one.)

**P2-9 · Discord: elevated bits on ordinary roles.** Every auto-granted role (Not Signed Up, the
six positions, the ten departments, Owner/AGM) carries `CREATE_EVENTS` + `CREATE_GUILD_EXPRESSIONS`
(any member can create server events and upload emoji/stickers); `@everyone` and the club roles
carry `CREATE_PUBLIC_THREADS` (threads under post-only feeds); the third-party `DISBOARD.org` role
holds `MANAGE_CHANNELS` guild-wide and is exempt from every reconciler; the Team Management rooms
are creation-only (never reconciled — `#management-announcements` lets every Owner/GM/AGM post).
Fix: the sweep manages bits 43/44/35 on the roles it owns; drop DISBOARD to Send Messages; add the
Team Management category to `enforceReadOnlyCategories`.

**P2-10 · Any staff member, department-blind, can move any club's players between roster and camp.**
`set_roster_squad` / `swap_roster_squad` accept `is_staff()`. Fix: transactions/officials only.

**P2-11 · Every club manager reads every registrant's private note to the league office.**
`managers read registrations` is `is_any_manager()` over all columns (`note`, `scout_ovr`, EA ids).
Fix: a view without `note` for managers, or column-revoke `note`.

**P2-13 · The nickname → gamertag sync can collide on case.** The sweep rewrites `profiles.gamertag`
from the Discord display name every 2 minutes; `profiles_gamertag_key` is case-sensitive while every
consumer (`gamertag=ilike`, the @-pill regex, `fuzzyProfile`) is case-insensitive, so a member whose
nickname is another player's tag in different case creates two profiles that stat linking and
mentions cannot tell apart (an exact-case copy fails the unique index and just errors every tick).
Fix: a unique index on `lower(gamertag)` and refuse the rename when it would collide.

**P2-14 · `discord-join.js` is reachable without any auth.** A GET (or `?diag=1`) runs four
bot-token Discord calls and upserts `app_config`; a POST forwards whatever bearer string the caller
sends to Discord (a guaranteed 401). Anonymous traffic can burn the bot's invalid-request budget
with Discord. Fix: require a session or retire the function (the sign-in flow no longer uses it).

**P2-15 · The only working EA importer dies with the Discord gateway.** `bot/chel-bot.mjs` starts
the EA poller inside the gateway process and calls `process.exit(1)` on an unrecoverable gateway
close or login failure; the Netlify `ea-poll` fallback cannot reach EA (403) and cannot cover 8
clubs in its window. A Discord-side outage on a game night stops box scores until someone restarts
the VM service. Fix: run the poller as its own systemd unit (or `Restart=always` with the poller
detached from the gateway lifecycle).

**P2-12 · Message delivery is not idempotent in the sweep and the bot** (club-notice backstop
double-posts when the bookkeeping PATCH fails; `dApi` retries `POST /messages` on an ambiguous
5xx), and no Discord/Supabase call in the sweeps or the bot has a request timeout — the bot's
serial role-sync drain stalls on one hung socket.

### P3

- `ingest-stats` is sequential and chatty (36–72 Supabase round trips per new game), but Netlify's synchronous limit is 60 s (scheduled 30 s) and a worst-case slot of 4 new games costs ~10 s; the binding limit is the VM poller's own 30 s abort (`bot/ea-poll.mjs:66`) — align it with the platform and treat an abort as "unknown, re-check", and hoist the profile cache to the batch. Not a correctness defect.
- The weekly-cap gate in `set_game_lineup` is a read-then-write with no lock — two concurrent filings by the same club could dress a seventh game; rare, one `pg_advisory_xact_lock` fixes it.
- Rule 5.3's penalty count is per *slot* changed, the rule says per *player* — a C→LW shuffle plus one call-up records 2 penalties for one change. Count players, not slots.
- The availability table has no server-side record of lateness: `submitted_at` is client-supplied and overwritten, so a post-deadline flip is indistinguishable from an on-time answer (Rule 5.1 says late answers are accepted but *recorded as late*). Server-stamp it and add a `late` flag; do not lock the table.
- A commissioner who also holds a club seat passes `mgmt_gate` as "office" on `set_game_lineup` — the Owner's per-seat access setting does not apply to him.
- `resolve_game_server(p_game)` is callable by any member (writes the deterministic server pick early — no integrity impact; revoke anyway).
- `lineup_camp_warnings` is anon-callable and derives another club's availability (tiny surface).
- `profiles.is_admin` is not pinned by `guard_profile_role` — a member can turn on the client-only "View as" preview (RLS still applies to every read).
- `set_staff_profile` lets staff "edit" their own departments, but `guard_profile_role` silently reverts them — a silent no-op in the UI rather than an escalation; make the button commissioner-only.
- The Supabase service-role key is used as the `x-ingest-key` bearer instead of a scoped key.
- `trackDepartures` rewrites every `guild_members` row every 2 minutes.
- `news read` is `true` — there is no draft state on `news`, so nothing is actually exposed (refuted as an exposure; noted for when scheduling lands).
- The page is 2.1 MB with `max-age=0` — fine on the CDN, slow on phones; splitting the rulebook/content chunk out of the boot bundle would halve it.

## 3. Verified clean

- RLS is enabled on every public table; the tables with RLS and no policy (`lfg_lobbies`,
  `role_sync_queue`, `squad_move_history`, `welcomed_members`) are service-only by design.
- Every SECURITY DEFINER function sets `search_path`.
- `profiles.role`, `banned*`, `overall`, `departments`, `in_guild`, `discord_id` are pinned by a
  BEFORE UPDATE trigger — no self-promotion to commissioner or staff.
- `draft_make_pick` locks `draft_state` then the pick (same order as the buzzer), checks
  "already on a club" under the lock, and `roster_spots` is unique per season/profile — two clubs
  cannot draft the same player; 170 rooms reconciling at once is comfortably served.
- `forfeit_game`, `unforfeit_game`, `stats_game_*`, `stats_pickup_*` require statistics staff;
  `preseason_random_assign` / `preseason_release_now` require a commissioner.
- Waivers and signings are deadline-locked in the database (`guard_roster_waive` →
  `moves_locked`), not just in the client.
- `profiles.gamertag` is unique — the Discord-nickname sync cannot hijack another player's tag
  (the PATCH fails instead; it does log an error every 2 minutes for that member).
- All 101 RPC names the client calls exist and are executable by `authenticated`, except
  `respond_offer` (P0-1).

## 4. Suggested order of work

1. Grant `respond_offer` (P0-1) and revoke the five public helpers (P0-2, P1-8, P2-2, P2-3,
   P3 `resolve_game_server`) — one gated transaction, ten minutes, no client change.
2. Column revokes on `trades`, `roster_spots`, `games.game_code/server`,
   `season_registrations` (P1-1, P1-2, P1-3, P1-7) + the `games_public` read path in the client.
3. `waive_player` diagnostics fix, emergency call-up bound + notices, forfeit-safe manual merge
   (P1-4, P1-5, P1-6).
4. League-live incremental refresh + jitter, and the compute upgrade before Saturday (P0-3).
5. The sweep time budget + HTTP-only diag function, waived-player lineup cleanup, the
   `game_stats` unique key (P2-0, P2-4, P2-5) before Sep 23.
6. The rest of the P2 list through the first week; P3 as time allows.

Reproduce the measurements: `SB_KEY=$(grep -o 'CG.SB_KEY = "[^"]*"' src/live/part_live.js | cut -d'"' -f2) node tools/loadtest.mjs boot|draft|herd` (`TABS=40` scales the herd).

## 5. Status — fixed the same day (v2.57, September 17, 2026)

Everything below was applied live and is recorded in `sql/2026-09-17-audit-fixes.sql`,
`sql/2026-09-17-audit-fixes-b.sql` and commits `2207142` … `6dfa6e2`. Three rulings from the
commissioner shaped the fixes: in the basic format a waived player is **signed outright by a club**
(no offer, no acceptance — clubs move players, players are not asked); lobby codes are released
**30 minutes before the night's first game, to the two clubs' rosters and front offices only**;
every **post-lock lineup change is told to the opponent** so the penalties can be coordinated.

| Finding | Fix |
|---|---|
| P0-1 `respond_offer` ungranted | Granted (the shelved full format). In basic seasons the board's **Offer** became **Sign** — `sign_free_agent` at $750K outright, through the Owner-approval queue where set; offer/extension cards hidden. Rule 2.2 rewritten. |
| P0-2 `_assign_reg_random` public | Revoked from PUBLIC/anon/authenticated (with `preseason_release_loans`, `_mgmt_move_send`, `lfg_form_lobby`, `lfg_open_lobby`, `lineup_camp_warnings`). Default privileges for new functions no longer include PUBLIC or anon. `tools/sql/grant-audit.sql` is the standing check. |
| P0-3 the herd | League-live is a **delta**: a games event re-reads `games` + that game's box score + the codes view (3 requests, not 19), after a random 1–9 s. Re-measured at 40 tabs: p95 ≈ 250 ms, 0 errors (was 25% errors, 13 s median). `resolve_due_servers` moved to `pg_cron` (every 2 min, watched). Compute upgrade still recommended — the user's call. |
| P1-1 trade assets | `guard_trade_assets` BEFORE UPDATE trigger: assets, retention and parties are fixed once proposed. |
| P1-2 roster row identity | `guard_roster_identity`: `profile_id`, `season_id`, `origin` pinned. |
| P1-3 lobby codes | `games.game_code` / `server` no longer granted to the API roles; the client selects named columns and reads codes through `games_public` (owner-run view) masked by the night-based `can_see_match`. Rule 4.2 rewritten; matchup page, hub card and notification copy updated. |
| P1-4 emergency call-ups | Accepted until 10 minutes after puck drop, then refused; penalties counted per **player** changed; `_post_lock_notices` tells the opposing front office (site + club room), the commissioners and the officials desk who came out / went in / penalties owed, logs it, posts to #management-moves; the matchup page shows "Changed after lock · serves N". Rule 5.3 rewritten. |
| P1-5 forfeit erased by merge | Management merges refuse forfeit-ruled games; no ingest path writes `forfeit_team_id`. |
| P1-6 `waive_player` dead guard | `get diagnostics` now reads the DELETE; the registration flip runs under `app.role_grant` so a real waiver updates the registration. |
| P1-7 sign-up backdating | `guard_registration_columns` is BEFORE INSERT too: `created_at = now()`, `status = pending`, `scout_ovr = null` for members. |
| P1-8 `preseason_release_loans` | Revoked (see P0-2). |
| P2-0 dead sync door / killed passes | `discord-ops` HTTP function (key or member session; `/api/discord-ops`); the sweep has an 18-s member-pass budget with `partial`/`membersLeft`, a start stamp, cheap steps first; the site's ping and Run now use the door; Run now hidden for scheduled functions. |
| P2-1 lineups world-readable | `game_lineups_read` = own club, office, or after the game's lock. |
| P2-2 / P2-3 public helpers | Revoked (see P0-2). |
| P2-4 `game_stats` unique key | `game_stats_one_row_per_player` expression index; ingest treats 23505 as "another writer filed first". |
| P2-5 waived players dressed | `clear_lineups_on_roster_remove` AFTER DELETE / team change: empties his slots in upcoming filed lineups and tells the club. |
| P2-6 review once | `review_game_records(p_game)` runs on the final flip **and** on every `game_stats` insert (statement trigger), deduplicated per finding through `admin_audit`. |
| P2-7 weekly-cap race | `pg_advisory_xact_lock` per club-week in `set_game_lineup`. |
| P2-8 renamed forum duplicated | Forums and Team Management rooms are adopted by stored id first; config repointed at `#mgnt-faq`, the empty duplicate deleted, the waivers and lineups guides reissued there. |
| P2-9 role bits | Every owned role stripped of CREATE_EVENTS / CREATE_GUILD_EXPRESSIONS / thread creation (Staff, Commissioner, managed roles kept); @everyone lost thread creation; DISBOARD lost MANAGE_CHANNELS; new roles are born correct; Team Management rooms and the post-only feeds reconciled every sweep. |
| P2-10 staff move rosters | `set_roster_squad` / `swap_roster_squad` require the transactions department. |
| P2-11 registrant notes | `registration_notes` table (self + office RLS); the column is moved there by trigger; 51 notes migrated. |
| P2-12 / P2-13 / P2-14 | Timeouts on every Discord/Supabase call in the sweep and the bot; message POSTs are one-shot and claims are kept after delivery; nickname sync skips case-insensitive collisions; `discord-join` requires a session (POST) or the ops key (GET). |
| P2-15 poller dies with the gateway | `bot/ea-poll-service.mjs` + `chel-ea-poll.service` — its own unit, live on the VM. |
| P3 | `resolve_game_server` guarded; `is_admin` pinned; staff department self-edit removed from the UI; availability server-stamped with `late`/`late_at`, the form no longer hard-locks; penalties per player; ingest batch prefetch + archive-before-file; poller abort = unknown; `INGEST_KEY` preferred when set. |

Still open, and why: the compute tier (billing — recommend Small for the season); `INGEST_KEY` is
supported but not set (needs the Netlify env + `/etc/chel-bot.env`); a commissioner who also holds a
club seat still passes `mgmt_gate` as office (three grandfathered conflicts); the page weight
(2.1 MB, not a defect).
