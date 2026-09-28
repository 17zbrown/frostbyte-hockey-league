-- v3.60: season awards. Commissioner, 2026-09-28:
--   Q37: "allow all players to put 1 vote in per award. Statistical awards should be awarded by you based on
--        per game averages for the awards. A player must be playoff eligible to be eligible to receive the award."
--   Q38: (may the commissioner name a winner other than the ballot leader?) "If it is statistical, no."
--   Q39: Rookie of the Year in Season 1: "yes."
-- Before this, only league staff and commissioners (Media excepted) could vote, nothing checked who could be
-- voted for, and the statistical titles of Rule 9.2.2 were not computed anywhere.

/* ---- who may win ----------------------------------------------------------------------------------- */
create or replace function public.award_eligible(p_season uuid, p_profile uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $fn$
  /* Rule 9.3 (v3.60): playoff eligible (the season's games-played floor, Rule 8.3) and not serving a
     season-length suspension */
  select public.regular_gp(p_season, p_profile) >= public.playoff_min_gp(p_season)
     and not exists (select 1 from public.suspensions s where s.profile_id = p_profile and s.status = 'active'
                       and s.mode = 'seasons' and s.until_season >= (select number from public.seasons where id = p_season))
$fn$;
grant execute on function public.award_eligible(uuid, uuid) to anon, authenticated, service_role;

/* ---- who may vote: every rostered player, and league staff and commissioners ------------------------ */
create or replace function public.can_vote_awards(p_season uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select auth.uid() is not null and not coalesce(public.is_banned(auth.uid()), false) and (
       exists (select 1 from public.roster_spots rs where rs.season_id = p_season and rs.profile_id = auth.uid() and rs.status = 'active')
    or public.is_commissioner()
    /* Rule 2.7: a Media staffer holds no ballot AS STAFF; one who is rostered votes as a player above */
    or (public.is_staff() and not public.is_media_staff(auth.uid())))
$fn$;
grant execute on function public.can_vote_awards(uuid) to authenticated, service_role;

drop policy if exists "office casts own ballot" on public.award_ballots;
drop policy if exists "office updates own ballot" on public.award_ballots;
drop policy if exists "office reads ballots" on public.award_ballots;
create policy "voters cast their own ballot" on public.award_ballots for insert to authenticated
  with check (voter_id = (select auth.uid()) and public.can_vote_awards(season_id));
create policy "voters change their own ballot" on public.award_ballots for update to authenticated
  using (voter_id = (select auth.uid()))
  with check (voter_id = (select auth.uid()) and public.can_vote_awards(season_id));
create policy "voters read their own ballot, the office reads all" on public.award_ballots for select to authenticated
  using (voter_id = (select auth.uid()) or public.is_staff() or public.is_commissioner());
revoke all on public.award_ballots from anon;
grant select, insert, update on public.award_ballots to authenticated;

/* ---- what a vote may be ------------------------------------------------------------------------------ */
create or replace function public.guard_award_ballot()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_pos text; v_team uuid; v_mine uuid[]; v_name text;
begin
  if new.category not in ('mvp','best_goalie','best_defenseman','rookie_of_year') then
    raise exception 'That award is not decided by a vote (Rule 9.2).' using errcode = '22023'; end if;
  if exists (select 1 from public.awards a where a.season_id = new.season_id and a.week is null and a.category = new.category) then
    raise exception 'That award has been decided; the vote is closed.' using errcode = '22023'; end if;
  if new.profile_id = new.voter_id then
    raise exception 'A vote for yourself is not counted (Rule 9.2).' using errcode = '22023'; end if;
  select rs.position::text, rs.team_id into v_pos, v_team from public.roster_spots rs
   where rs.season_id = new.season_id and rs.profile_id = new.profile_id and rs.status = 'active' limit 1;
  if v_team is null then raise exception 'Only a player on a club this season can be voted for.' using errcode = '22023'; end if;
  select coalesce(gamertag, 'That player') into v_name from public.profiles where id = new.profile_id;
  /* Rule 9.2.1: no vote for a member of your own club, whether you play for it or run it */
  select array_agg(distinct x) into v_mine from (
    select rs.team_id x from public.roster_spots rs where rs.season_id = new.season_id and rs.profile_id = new.voter_id and rs.status = 'active'
    union select t.id from public.teams t where new.voter_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id)) s;
  if v_team = any(coalesce(v_mine, '{}')) then
    raise exception '% plays for your own club; a vote goes to a player on another club (Rule 9.2).', v_name using errcode = '22023'; end if;
  if new.category = 'best_goalie' and v_pos <> 'G' then
    raise exception '% is not rostered as a goaltender.', v_name using errcode = '22023'; end if;
  if new.category = 'best_defenseman' and v_pos not in ('LD','RD') then
    raise exception '% is not rostered as a defenseman.', v_name using errcode = '22023'; end if;
  if new.category = 'rookie_of_year' and exists (select 1 from public.roster_spots rs join public.seasons s on s.id = rs.season_id
       where rs.profile_id = new.profile_id and s.number < (select number from public.seasons where id = new.season_id)) then
    raise exception '% is not in his first CGHL season (Rule 9.1).', v_name using errcode = '22023'; end if;
  new.updated_at := now();
  return new;
end $fn$;
revoke all on function public.guard_award_ballot() from public, anon, authenticated;
drop trigger if exists guard_award_ballot_trg on public.award_ballots;
create trigger guard_award_ballot_trg before insert or update on public.award_ballots
  for each row execute function public.guard_award_ballot();

/* ---- deciding a voted award: the eligible player with the most votes ------------------------------ */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.finalize_season_award(uuid,text,uuid)'::regprocedure);
  d := replace(d0,
'  if p_winner is not null then
    v_winner := p_winner;
  else
    select profile_id, count(*) into v_winner, v_votes
      from public.award_ballots where season_id = p_season and category = p_category
      group by profile_id order by count(*) desc limit 1;
    if v_winner is null then raise exception ''No ballots cast for % yet.'', p_category; end if;
    select count(*) into v_ties from (
      select profile_id from public.award_ballots
      where season_id = p_season and category = p_category
      group by profile_id having count(*) = v_votes) t;
    if v_ties > 1 then
      raise exception ''The % vote is tied — pick the winner explicitly to break the tie.'', p_category;
    end if;
  end if;',
'  /* v3.60 (Q37): only a playoff-eligible player can win (award_eligible); votes for anyone else are
     not counted. The commissioner picks only to break a tie among the leaders. */
  select profile_id, count(*) into v_winner, v_votes
    from public.award_ballots where season_id = p_season and category = p_category
     and public.award_eligible(p_season, profile_id)
    group by profile_id order by count(*) desc limit 1;
  if v_winner is null then raise exception ''No votes for an eligible player in % yet.'', p_category; end if;
  select count(*) into v_ties from (
    select profile_id from public.award_ballots
    where season_id = p_season and category = p_category and public.award_eligible(p_season, profile_id)
    group by profile_id having count(*) = v_votes) t;
  if v_ties > 1 then
    if p_winner is null or p_winner not in (select profile_id from public.award_ballots
         where season_id = p_season and category = p_category and public.award_eligible(p_season, profile_id)
         group by profile_id having count(*) = v_votes) then
      raise exception ''The % vote is tied at the top; pick one of the tied players to break it.'', p_category;
    end if;
    v_winner := p_winner;
  elsif p_winner is not null and p_winner <> v_winner then
    raise exception ''The winner is the eligible player with the most votes; a commissioner picks only to break a tie.'';
  end if;');
  d := replace(d, ''', decided by staff ballot. Season hardware lives on the Awards page.''', ''', decided by a vote of the league''''s players and staff. Season hardware lives on the Awards page.''');
  if position('award_eligible' in d) = 0 or position('players and staff' in d) = 0 then raise exception 'finalize_season_award patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- statistical titles: per-game averages, from the record, no override (Q37, Q38) ---------------- */
/* The awards table's category check must know the four titles (the v3.53 lesson: when code writes a new
   value, widen the constraint in the same change). The rehearsal caught it. */
alter table public.awards drop constraint if exists awards_category_check;
alter table public.awards add constraint awards_category_check check (category = any (array[
  'potw_skater','potw_goalie','champion','mvp','best_goalie','best_defenseman','rookie_of_year',
  'points_title','goals_title','assists_title','goaltending_title']));
create or replace function public.statistical_titles(p_season uuid)
 returns table(category text, profile_id uuid, team_id uuid, gp int, total int, per_game numeric)
 language sql stable security definer set search_path to 'public' as $fn$
  with lines as (
    select gs.profile_id, bool_or(coalesce(gs.is_goalie,false)) g, gs.game_id,
           sum(coalesce(gs.goals,0)) goals, sum(coalesce(gs.assists,0)) assists, sum(coalesce(gs.goals_against,0)) ga,
           max(coalesce(gs.time_on_ice_seconds,0)) toi
      from public.game_stats gs join public.games gm on gm.id = gs.game_id
     where gm.season_id = p_season and coalesce(gm.stage,'regular') = 'regular' and gm.status = 'final'
       and not coalesce(gm.voided,false) and gs.profile_id is not null
     group by gs.profile_id, gs.game_id),
  sk as (select l.profile_id, count(*)::int gp, sum(l.goals)::int goals, sum(l.assists)::int assists
           from lines l where not l.g and l.toi > 0 group by l.profile_id),
  gl as (select l.profile_id, count(*)::int gp, sum(l.ga)::int ga from lines l where l.g and l.toi > 0 group by l.profile_id),
  cand as (
    select 'points_title'::text c, profile_id, gp, goals + assists tot, (goals + assists)::numeric / gp pg, true high from sk
    union all select 'goals_title', profile_id, gp, goals, goals::numeric / gp, true from sk
    union all select 'assists_title', profile_id, gp, assists, assists::numeric / gp, true from sk
    union all select 'goaltending_title', profile_id, gp, ga, ga::numeric / gp, false from gl),
  ranked as (
    select c.*, row_number() over (partition by c.c
             order by case when c.high then -c.pg else c.pg end, case when c.high then -c.tot else c.tot end, -c.gp,
                      (select gamertag from public.profiles p where p.id = c.profile_id)) rn
      from cand c where public.award_eligible(p_season, c.profile_id) and c.gp > 0)
  select r.c, r.profile_id,
         (select rs.team_id from public.roster_spots rs where rs.season_id = p_season and rs.profile_id = r.profile_id limit 1),
         r.gp, r.tot, round(r.pg, 3)
    from ranked r where r.rn = 1
$fn$;
grant execute on function public.statistical_titles(uuid) to anon, authenticated, service_role;

create or replace function public.file_statistical_titles(p_season uuid)
 returns int language plpgsql security definer set search_path to 'public' as $fn$
declare r record; n int := 0; v_label text; v_name text; v_line text;
begin
  if not (public.is_commissioner() or public.trusted_writer() or auth.uid() is null) then
    raise exception 'The statistical titles are filed by the league''s own record.' using errcode = '42501'; end if;
  if exists (select 1 from public.games g where g.season_id = p_season and coalesce(g.stage,'regular') = 'regular'
               and g.status <> 'final' and not coalesce(g.voided,false)) then
    return 0;   -- the regular season is not over; nothing is filed early
  end if;
  for r in select * from public.statistical_titles(p_season) loop
    v_label := case r.category when 'points_title' then 'Scoring Title' when 'goals_title' then 'Goal-scoring Title'
                               when 'assists_title' then 'Playmaking Title' else 'Goaltending Title' end;
    v_line := case r.category when 'goaltending_title' then to_char(r.per_game, 'FM0.00') || ' goals against per game over ' || r.gp || ' games'
                              else to_char(r.per_game, 'FM0.00') || ' per game (' || r.total || ' in ' || r.gp || ' games)' end;
    insert into public.awards (season_id, week, category, profile_id, team_id, stat_line, decided_by)
      values (p_season, null, r.category, r.profile_id, r.team_id, v_line, 'record')
      on conflict (season_id, week, category) do nothing;
    if found then
      n := n + 1;
      select coalesce(gamertag, 'A player') into v_name from public.profiles where id = r.profile_id;
      insert into public.news (season_id, category, title, author, published_at, body)
        values (p_season, 'Awards', v_name || ' wins the ' || v_label, 'CGHL Wire', now(),
          v_name || ' takes the ' || v_label || ' at ' || v_line || '. Statistical titles are decided by per-game averages from the official record among playoff-eligible players, and are not voted on (Rule 9.2).');
    end if;
  end loop;
  if n > 0 then perform public.log_admin_action('statistical_titles_filed', 'season', p_season::text, jsonb_build_object('filed', n)); end if;
  return n;
end $fn$;
revoke all on function public.file_statistical_titles(uuid) from public, anon;
grant execute on function public.file_statistical_titles(uuid) to authenticated, service_role;

/* filed automatically the moment the last regular-season game goes final */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.trg_check_clinches()'::regprocedure);
  d := replace(d0,
'    perform public.check_playoff_clinches(new.season_id);
  end if;',
'    perform public.check_playoff_clinches(new.season_id);
    /* v3.60: the statistical titles are filed once the regular season is complete (idempotent) */
    if not exists (select 1 from public.games g where g.season_id = new.season_id and coalesce(g.stage,''regular'') = ''regular''
                     and g.status <> ''final'' and not coalesce(g.voided,false)) then
      /* the league''s own filing, whoever''s write completed the season (a staffer''s result correction,
         the importer): the trusted-writer flag is raised for the call alone */
      begin
        perform set_config(''app.role_grant'', ''on'', true);
        perform public.file_statistical_titles(new.season_id);
        perform set_config(''app.role_grant'', '''', true);
      exception when others then
        perform set_config(''app.role_grant'', '''', true);
        raise warning ''statistical titles for season % failed: %'', new.season_id, sqlerrm;
      end;
    end if;
  end if;');
  if d = d0 then raise exception 'trg_check_clinches patch matched nothing'; end if;
  execute d;
end $mig$;

/* REHEARSAL (2026-09-28, rolled back): every check passed.
   T1  a rostered member (no staff role) can vote; votes for another club's forward, goaltender and
       defenseman are accepted.
   T2  refused: a teammate ("plays for your own club"), himself, a forward as Best Goaltender, a vote on a
       statistical title.
   T3  a stranger cannot vote; a rostered Media staffer can, as a player.
   T4  finalize with the Season 1 floor (16) finds no eligible player; with the floor at 0 it names the
       leader; a commissioner's pick against a clear vote is refused; the news says players and staff;
       a decided award takes no more votes.
   T5  statistical_titles returns four; file_statistical_titles files nothing while regular games remain,
       files four once they are done, files nothing twice, writes four news items, and refuses a player.
   Found by the battery: awards_category_check did not know the four titles. */
