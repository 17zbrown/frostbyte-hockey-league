-- v2.67 (2026-09-19): the playoff eligibility floor (Rule 8.3) is a commissioner-published season
-- setting, like the draft round count (v2.64). The basic format's default drops from 18 to 16
-- regular-season games; Season 1 is set to 16 explicitly. Applied live in one gated transaction,
-- rehearsed first with a rollback. Repo record only: do not re-run blindly.
begin;
select set_config('request.jwt.claims','{"sub":"fa5f47dc-5380-4965-9258-82ed954b6fa7","role":"authenticated"}',true);
alter table public.seasons add column if not exists playoff_min_gp integer;
alter table public.seasons drop constraint if exists seasons_playoff_min_gp_check;
alter table public.seasons add constraint seasons_playoff_min_gp_check check (playoff_min_gp is null or (playoff_min_gp >= 0 and playoff_min_gp <= 200));
comment on column public.seasons.playoff_min_gp is 'Rule 8.3 season setting (v2.67): regular-season games a player needs to be dressed in the playoffs. null = the format''s figure, 0 = no floor.';
-- season_rules() overlays every per-season figure onto the format's rules; nulls fall through to the
-- format, an explicit 0 is honored (no floor).
create or replace function public.season_rules(p_season uuid) returns jsonb language sql stable set search_path to 'public' as $f$
  select public.format_rules(public.season_format(p_season))
      || coalesce((select jsonb_strip_nulls(jsonb_build_object('draft_rounds', s.draft_rounds, 'playoff_min_gp', s.playoff_min_gp))
                   from public.seasons s where s.id = p_season), '{}'::jsonb)
$f$;
-- the league standard: 16
select public._splice_fn('format_rules(text)', '"playoff_min_gp":18', '"playoff_min_gp":16', '1');
update public.seasons set playoff_min_gp = 16 where number = 1;
do $chk$ begin
  if (public.format_rules('basic')->>'playoff_min_gp')::int <> 16 then raise exception 'format default not 16'; end if;
  if (select public.playoff_min_gp(id) from public.seasons where number=1) <> 16 then raise exception 'S1 floor not 16'; end if;
  if (select public.playoff_min_gp(id) from public.seasons where number=2) <> 16 then raise exception 'S2 does not inherit 16'; end if;
  if (select (public.season_rules(id)->>'draft_rounds')::int from public.seasons where number=1) <> 12 then raise exception 'draft_rounds overlay lost'; end if;
end $chk$;
commit;
-- set_game_lineup already reads public.playoff_min_gp(season) -> season_rules(), so the playoff gate
-- follows the season setting with no further change. Grant audit (tools/sql/grant-audit.sql): empty.
-- comment inside set_game_lineup brought in line (the gate itself already read playoff_min_gp(season)):
select public._splice_fn('set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)',
  E'a games-played floor for the playoffs where the format sets one (basic: eighteen\n         regular-season games).',
  E'a games-played floor for the playoffs where the season publishes one (v2.67:\n         public.playoff_min_gp reads the season setting, then the format''s default).', '1');
