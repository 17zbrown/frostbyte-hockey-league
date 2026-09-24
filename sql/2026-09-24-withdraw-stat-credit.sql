-- v3.08 — Rule 6.3: withdrawing a player's PERSONAL credit for a box-score line,
-- while the club keeps the line.
--
-- Commissioner, after the first game night: "the [player] from the first game of the 2 used to
-- fill the stats against VAN was the one who left and we dont need their personal stats anymore
-- but the team should still hold those stats."
--
-- WHO IT WAS. The two sittings of DAL v VAN (10:10 PM, game c4126ee2) were dumped from the
-- archive and compared player by player. Exactly one name is in the first sitting and not the
-- second: ATLASX27X, persona 1448733393, position `center`, 1200s — the player Dallas waived
-- that night (in_guild false, waived 11:06 PM, no club). Shadow_Prime150 took the seat for the
-- second sitting. BOTH sittings had the same goalies, Zurion413 for DAL (1200s then 2400s) and
-- lXlBMac24lXl for VAN, and both of those members are still here and still on their clubs, so
-- "the goalie" could only have meant the man who left. He was a center in all three of his games.
--
-- THE MECHANISM, and why a plain UPDATE would have rotted.
-- game_stats.profile_id is nullable and skater_name already carries the EA name, and part_live
-- keys an unlinked line as `ea:<row id>` — "unlinked EA players keep a synthetic key so they
-- still render but don't corrupt a profile's totals". So dropping the link is exactly the ask:
-- the club keeps the line, the game keeps its score, nobody's personal record moves.
-- BUT every filing path DELETEs a game's lines and re-POSTs them (a re-poll, a Rule 4.3 merge),
-- and resolveProfile would find him again — his persona is still on his profile and his other
-- games still teach the `prior` step. A hand-edit would have been undone by the next poll.
-- Hence a recorded withdrawal that the importer re-applies AFTER it resolves a player.
begin;

create table public.stat_credit_withdrawals (
  game_id      uuid not null references public.games(id) on delete cascade,
  ea_player_id text not null,
  profile_id   uuid references public.profiles(id) on delete set null,
  reason       text not null,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  primary key (game_id, ea_player_id)
);

-- TRAP, and it is not specific to this table. pg_default_acl in this project still grants
-- tables arwdDxtm to BOTH anon and authenticated (only FUNCTIONS were tightened, in v2.57).
-- Every new table is therefore born world-writable at the grant level, with RLS as the only
-- guard. `revoke ... from public` does NOT touch a role-specific grant. Name the roles.
alter table public.stat_credit_withdrawals enable row level security;
revoke all on public.stat_credit_withdrawals from anon, authenticated, public;
grant select on public.stat_credit_withdrawals to authenticated;
create policy scw_read_staff on public.stat_credit_withdrawals
  for select to authenticated using (public.is_stats_staff() or public.is_commissioner());

commit;

-- withdraw_stat_credit / restore_stat_credit: see the deployed definitions. Both are gated to
-- is_stats_staff() or is_commissioner(), and both fail loud — an UPDATE that touches no row
-- returns no error, so each one checks that a row actually came back before it claims success.
--
-- The RETURNS TABLE column names are for_game / ea_account / line_name on purpose: naming them
-- game_id / ea_player_id makes the ON CONFLICT clause inside the same function ambiguous (42702).
--
-- Applied: the 10:10 PM DAL v VAN line for persona 1448733393.
-- Verified after: 13 lines still on the game, 1 unlinked, score still DAL 2 VAN 6, and the
-- withdrawal on record. Rehearsed first with a full withdraw/restore round trip, rolled back.
