-- v3.74: a rating for each position a player plays; the headline overall is his signed-up position's.
-- Commissioner, 2026-09-29 (answering Q30's engine question):
--   "Show the overall of the player's signed up position. When a someone selects one of their other positions,
--    their overall for that position should pop up in it's place in order to differentiate a player's ratings
--    between positions. Remember to skew towards 70 until 5 games played to ensure accurate calculations.
--    6 games may be better if you so choose."
--
-- Before: ONE rating per player. cghl_group put him in the group he had played most (and in goal after a single
-- goalie game), and ALL his games, at every position, fed that one rating and were divided by his total games.
-- Now: one rating per group (center C, wing W, defense D, goal G), each from the games he played AT that group
-- only, scored against the league at that group, and held toward 70 by the games at that group. The headline
-- overall (profiles.overall, shown everywhere) is the rating at the group of his signed-up position.
-- The hold is six games, not five: a group's sample is a share of a player's games, and six is one full week at
-- the weekly limit (Rule 5.2). The rating groups (center, wing, defense, goal) are not the roster groups of Rule
-- 2.1, where centers and wings are both forwards.

/* ---- the hold: six games ---------------------------------------------------------------------------------- */
create or replace function public.cghl_settle_gp() returns integer language sql immutable as $fn$ select 6 $fn$;
create or replace function public.cghl_confidence(p_gp numeric)
 returns numeric language sql immutable set search_path to 'public' as $fn$
  select case
    when coalesce(p_gp,0) <= 0 then 0
    when p_gp < public.cghl_settle_gp() then (0.6 / public.cghl_settle_gp()) * p_gp   -- 1 game .10 ... 5 games .50
    else p_gp / (p_gp + 1.5)                                                           -- 6 games .80, 10 .87, 18 .92
  end;
$fn$;

/* ---- a position code (registration, roster or box score) to its rating group ------------------------------ */
create or replace function public.cghl_pos_group(p_pos text)
 returns text language sql immutable set search_path to 'public' as $fn$
  select case when p_pos is null then null
              when p_pos = 'G' then 'G' when p_pos = 'C' then 'C'
              when p_pos in ('LW','RW','W') then 'W' when p_pos in ('D','LD','RD') then 'D' end;
$fn$;

/* ---- the signed-up group: the ONE definition of which rating is the headline ------------------------------- */
create or replace function public.current_pos_cat(p_profile uuid)
 returns text language plpgsql stable security definer set search_path to 'public' as $fn$
/* v3.74: the position he signed up at. The current season's sign-up first, then his latest sign-up, then his
   latest roster position; a member who never signed up is rated at the group he has played most. */
declare v_pos text; v_grp text;
begin
  select sr.position::text into v_pos from public.season_registrations sr
   where sr.profile_id = p_profile and sr.season_id = public.current_season_id() and sr.status <> 'declined'
   limit 1;
  if v_pos is null then
    select sr.position::text into v_pos from public.season_registrations sr join public.seasons s on s.id = sr.season_id
     where sr.profile_id = p_profile and sr.status <> 'declined' order by s.number desc limit 1;
  end if;
  if v_pos is null then
    select rs.position::text into v_pos from public.roster_spots rs join public.seasons s on s.id = rs.season_id
     where rs.profile_id = p_profile and rs.position is not null order by s.number desc limit 1;
  end if;
  v_grp := public.cghl_pos_group(v_pos);
  if v_grp is not null then return v_grp; end if;
  select x.g into v_grp from (
    select case when gs.is_goalie then 'G' when gs.position = 'C' then 'C'
                when public.pos_group(gs.position) = 'D' then 'D'
                when public.pos_group(gs.position) = 'F' then 'W' end g, count(*) n
      from public.game_stats gs join public.games gm on gm.id = gs.game_id
     where gs.profile_id = p_profile and gm.status = 'final' and not coalesce(gm.voided, false)
     group by 1) x
   where x.g is not null order by x.n desc, x.g limit 1;
  return coalesce(v_grp, 'C');
end $fn$;

/* ---- rates from the games AT one group ------------------------------------------------------------------ */
create or replace function public.cghl_rates(p_profile uuid, p_grp text)
 returns jsonb language sql stable security definer set search_path to 'public' as $fn$
  with s as (
    select gs.*, gm.season_id as sid
    from public.game_stats gs
    join public.games gm on gm.id = gs.game_id
    where gs.profile_id = p_profile
      and gm.status = 'final' and not coalesce(gm.voided,false)
      and gm.stage in ('regular','playoff')          -- CGHL league play only
      and case p_grp
            when 'G' then gs.is_goalie
            when 'C' then not gs.is_goalie and gs.position = 'C'
            when 'D' then not gs.is_goalie and public.pos_group(gs.position) = 'D'
            when 'W' then not gs.is_goalie and public.pos_group(gs.position) = 'F' and gs.position <> 'C'
            else false end
  ), agg as (
    select
      count(distinct game_id)                                          as gp,
      count(*) filter (where is_goalie)                                as gp_g,
      count(*) filter (where not is_goalie and position = 'C')         as gp_c,
      count(*) filter (where not is_goalie and public.pos_group(position) = 'D') as gp_d,
      count(*) filter (where not is_goalie and public.pos_group(position) = 'F' and position <> 'C') as gp_w,
      sum(goals) g, sum(assists) a, sum(shots) sh, sum(shot_attempts) sat,
      sum(hits) hit, sum(pim) pim, sum(penalties_drawn) drawn,
      sum(blocked_shots) blk, sum(interceptions) intc, sum(takeaways) tk,
      sum(giveaways) gv, sum(plus_minus) pm,
      sum(passes_completed) pc, sum(passes_attempted) pa, sum(saucer_passes) sauc,
      sum(deflections) defl, sum(possession_seconds) poss, sum(time_on_ice_seconds) toi,
      sum(faceoffs_won) fow, sum(faceoffs_lost) fol,
      sum(saves) sv, sum(shots_against) sa, sum(goals_against) ga,
      sum((shutout)::int) so, sum(shutout_periods) sop,
      sum(breakaway_saves) brsv, sum(breakaway_shots) brsh,
      sum(pen_shot_saves) pssv, sum(pen_shots_against) pssh,
      sum(diving_saves) dsv, sum(poke_checks) poke
    from s
  )
  select jsonb_build_object(
    'grp', p_grp, 'gp', gp, 'gp_g', gp_g, 'gp_c', gp_c, 'gp_d', gp_d, 'gp_w', gp_w,
    'gpg', round((g::numeric)/nullif(gp,0),4), 'apg', round((a::numeric)/nullif(gp,0),4),
    'spg', round((sh::numeric)/nullif(gp,0),4), 'passpg', round((pc::numeric)/nullif(gp,0),4),
    'saucpg', round((sauc::numeric)/nullif(gp,0),4), 'gvpg', round((gv::numeric)/nullif(gp,0),4),
    'deflpg', round((defl::numeric)/nullif(gp,0),4), 'hitpg', round((hit::numeric)/nullif(gp,0),4),
    'pimpg', round((pim::numeric)/nullif(gp,0),4), 'drawnpg', round((drawn::numeric)/nullif(gp,0),4),
    'intpg', round((intc::numeric)/nullif(gp,0),4), 'blkpg', round((blk::numeric)/nullif(gp,0),4),
    'tkpg', round((tk::numeric)/nullif(gp,0),4), 'pmpg', round((pm::numeric)/nullif(gp,0),4),
    'posspm', round((poss::numeric)/nullif(toi/60.0,0),4),
    'svpg', round((sv::numeric)/nullif(gp,0),4), 'dsvpg', round((coalesce(dsv,0)::numeric)/nullif(gp,0),4),
    'pokepg', round((coalesce(poke,0)::numeric)/nullif(gp,0),4),
    'gaa', round((ga::numeric)/nullif(gp,0),4), 'sopg', round((so::numeric)/nullif(gp,0),4),
    'soppg', round((coalesce(sop,0)::numeric)/nullif(gp,0),4),
    'shotpct', round(100.0*g/nullif(sh,0),3),        'shot_n', sh,
    'onnetpct', round(100.0*sh/nullif(sat,0),3),     'onnet_n', sat,
    'passpct', round(100.0*pc/nullif(pa,0),3),       'pass_n', pa,
    'fopct', round(100.0*fow/nullif(fow+fol,0),3),   'fo_n', fow+fol,
    'savepct', round(100.0*sv/nullif(sa,0),3),       'save_n', sa,
    'brkpct', round(100.0*brsv/nullif(brsh,0),3),    'brk_n', brsh,
    'penpct', round(100.0*pssv/nullif(pssh,0),3),    'pen_n', pssh
  ) from agg;
$fn$;

/* ---- categories, category z-scores and the overall, at one group -------------------------------------------- */
create or replace function public.cghl_categories(p_profile uuid, p_grp text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare r jsonb; out jsonb;
begin
  if p_grp is null or p_grp not in ('C','W','D','G') then return null; end if;
  r := public.cghl_rates(p_profile, p_grp);
  if r is null or coalesce((r->>'gp')::int,0) = 0 then return null; end if;
  select jsonb_object_agg(cat, val) into out from (
    select w.cat, sum(e.eff * cf.f * q.z) / nullif(sum(abs(e.eff * cf.f)),0) val
    from public.cghl_stat_weights() w
    join public.cghl_stat_meta() m on m.stat = w.stat
    join public.rating_norms n on n.kind='stat' and n.key=w.stat and n.pos=p_grp
    cross join lateral (select public.cghl_cover_factor(n.cover) f) cf
    cross join lateral (select case p_grp when 'G' then w.w_g when 'W' then w.w_w when 'C' then w.w_c else w.w_d end eff) e
    cross join lateral (select greatest(-3.5, least(4, (
        coalesce(case when m.nkey is null then (r->>m.stat)::numeric
          else public.cghl_conf((r->>m.stat)::numeric, (r->>m.nkey)::numeric,
                                m.conf_k, n.center) end, n.center)
        - n.center) / n.spread)) z) q
    where e.eff <> 0 and cf.f > 0
    group by w.cat
  ) s;
  if out is null then return null; end if;
  return out || jsonb_build_object('kind', case when p_grp='G' then 'G' else 'S' end, 'grp', p_grp);
end $fn$;

create or replace function public.cghl_catz(p_profile uuid, p_grp text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare c jsonb; out jsonb;
begin
  c := public.cghl_categories(p_profile, p_grp);
  if c is null then return null; end if;
  select jsonb_object_agg(w.cat, q.z) into out
  from public.cghl_cat_weights() w
  join public.rating_norms n on n.kind='cat' and n.key=w.cat and n.pos=p_grp
  cross join lateral (select greatest(-3.5, least(4,
    ((c->>w.cat)::numeric - n.center) / n.spread)) z) q
  where w.grp = p_grp and (c->>w.cat) is not null;
  if out is null then return null; end if;
  return out || jsonb_build_object('grp', p_grp);
end $fn$;

create or replace function public.cghl_overall(p_profile uuid, p_grp text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare z jsonb; gp numeric; conf numeric; comp numeric; cz numeric; out jsonb; n record;
begin
  z := public.cghl_catz(p_profile, p_grp);
  if z is null then return null; end if;
  gp := coalesce((public.cghl_rates(p_profile, p_grp)->>'gp')::numeric, 0);
  if gp <= 0 then return null; end if;
  conf := public.cghl_confidence(gp);

  comp := public.cghl_composite(z, p_grp);
  select center, spread into n from public.rating_norms
   where kind='comp' and key='OVERALL' and pos=p_grp;
  if n is null or comp is null then return null; end if;
  cz := (comp - n.center) / n.spread;

  select jsonb_object_agg(w.cat, round(public.cghl_curve((z->>w.cat)::numeric * conf))) into out
  from public.cghl_cat_weights() w where w.grp = p_grp and z ? w.cat;

  return jsonb_build_object(
    'grp', p_grp, 'gp', gp, 'categories', out, 'z', round(cz, 3),
    'confidence', round(conf, 3), 'settled', gp >= public.cghl_settle_gp(),
    'overall', round(public.cghl_curve(cz * conf))::int);
end $fn$;

/* The one-argument forms stay, as the headline (signed-up) group, so nothing that still calls them drifts. */
create or replace function public.cghl_categories(p_profile uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
begin return public.cghl_categories(p_profile, public.current_pos_cat(p_profile)); end $fn$;
create or replace function public.cghl_catz(p_profile uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
begin return public.cghl_catz(p_profile, public.current_pos_cat(p_profile)); end $fn$;
create or replace function public.cghl_overall(p_profile uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
begin return public.cghl_overall(p_profile, public.current_pos_cat(p_profile)); end $fn$;

/* ---- the breakdown the site reads, at any group; player_rating(p, group) for the profile's picker ----------- */
create or replace function public.overall_breakdown(p_profile uuid, p_cat text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare g text; v_head text; o jsonb; comps jsonb;
begin
  v_head := public.current_pos_cat(p_profile);
  g := case when p_cat in ('C','W','D','G') then p_cat else v_head end;
  o := public.cghl_overall(p_profile, g);
  if o is null then
    return jsonb_build_object('gp', coalesce((public.cghl_rates(p_profile, g)->>'gp')::int, 0), 'overall', 70,
      'category', g, 'headline', g = v_head, 'components', '[]'::jsonb, 'provisional', true,
      'categories', '{}'::jsonb, 'confidence', 0);
  end if;

  select jsonb_agg(jsonb_build_object(
           'key', lower(w.cat), 'label', public.cghl_cat_label(w.cat),
           'score', (o->'categories'->>w.cat)::int, 'value', (o->'categories'->>w.cat)::int,
           'suffix', '', 'weight', w.w) order by w.w desc, w.cat)
    into comps
  from public.cghl_cat_weights() w
  where w.grp = g and (o->'categories') ? w.cat;

  return jsonb_build_object(
    'gp', (o->>'gp')::int, 'overall', (o->>'overall')::int, 'category', g, 'headline', g = v_head,
    'components', coalesce(comps,'[]'::jsonb), 'categories', o->'categories',
    'confidence', (o->>'confidence')::numeric,
    'provisional', not (o->>'settled')::boolean);
end $fn$;

create or replace function public.player_rating(p_profile uuid, p_cat text)
 returns jsonb language sql stable security definer set search_path to 'public' as $fn$
  select public.overall_breakdown(p_profile, p_cat);
$fn$;
grant execute on function public.player_rating(uuid, text) to anon, authenticated;

/* ---- one row per rated group; the headline row is the signed-up group's --------------------------------- */
alter table public.player_position_overalls add column if not exists headline boolean not null default false;

create or replace function public.refresh_player_overall(p_profile uuid)
 returns void language plpgsql security definer set search_path to 'public' as $fn$
/* v3.74: a row for the signed-up group (even at no games) and for every group he has league games at. Rows for
   any other group are removed, so a group he no longer has is never shown. profiles.overall is the headline. */
declare v_head text; v_groups text[]; v_grp text; v_bd jsonb; v_ov int := 70; v_prev text;
begin
  if p_profile is null then return; end if;
  v_head := public.current_pos_cat(p_profile);
  select array_agg(distinct x.g) into v_groups from (
    select v_head as g
    union
    select case when gs.is_goalie then 'G' when gs.position = 'C' then 'C'
                when public.pos_group(gs.position) = 'D' then 'D'
                when public.pos_group(gs.position) = 'F' then 'W' end
      from public.game_stats gs join public.games gm on gm.id = gs.game_id
     where gs.profile_id = p_profile and gm.status = 'final' and not coalesce(gm.voided, false)
       and gm.stage in ('regular','playoff')) x
   where x.g is not null;

  delete from public.player_position_overalls where profile_id = p_profile and not (pos_cat = any(v_groups));
  /* the headline moves first: one headline per player (ppo_one_headline), so the old one is cleared before
     the new group's row is written */
  update public.player_position_overalls set headline = false
   where profile_id = p_profile and headline and pos_cat <> v_head;
  foreach v_grp in array v_groups loop
    v_bd := public.overall_breakdown(p_profile, v_grp);
    insert into public.player_position_overalls(profile_id, pos_cat, overall, gp, categories, headline, updated_at)
      values (p_profile, v_grp, (v_bd->>'overall')::int, (v_bd->>'gp')::int, v_bd->'categories', v_grp = v_head, now())
      on conflict (profile_id, pos_cat) do update
        set overall = excluded.overall, gp = excluded.gp, categories = excluded.categories,
            headline = excluded.headline, updated_at = now();
    if v_grp = v_head then v_ov := coalesce((v_bd->>'overall')::int, 70); end if;
  end loop;

  v_prev := coalesce(current_setting('app.ovr_engine', true), '');
  perform set_config('app.ovr_engine', 'on', true);   -- v3.67 (Q59): the one writer of an overall
  update public.profiles set overall = v_ov where id = p_profile and overall is distinct from v_ov;
  perform set_config('app.ovr_engine', v_prev, true);
end $fn$;

/* ---- the engine's flag is enough to write an overall ---------------------------------------------------------
   guard_profile_role reverted an overall twice: once unless app.ovr_engine is on (v3.67), and again, from an
   older line, for any caller who is not a commissioner or trusted automation. So a re-rate run under a member's
   own action (his sign-up, a manager's signing) was silently undone. The second revert now honors the flag. */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_profile_role()'::regprocedure);
  d := replace(d0,
'  if new.overall      is distinct from old.overall      then new.overall      := old.overall;      end if;',
'  if new.overall      is distinct from old.overall and coalesce(current_setting(''app.ovr_engine'', true), '''') <> ''on''
                                                        then new.overall      := old.overall;      end if;');
  if d = d0 then raise exception 'guard_profile_role patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- the league distribution, per group, from each player's games at that group --------------------------- */
create or replace function public.refresh_rating_norms()
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_stats int; v_cats int; v_comp int;
begin
  if not (public.is_commissioner() or public.trusted_writer()) then
    raise exception 'refresh_rating_norms: league office only';
  end if;

  drop table if exists _r, _sv, _v, _cz;
  /* v3.74: one line per player per group he has league games at, each with the rates of those games alone */
  create temp table _r on commit drop as
    select l.id, l.grp, public.cghl_rates(l.id, l.grp) r
    from (select distinct gs.profile_id id,
                 case when gs.is_goalie then 'G' when gs.position = 'C' then 'C'
                      when public.pos_group(gs.position) = 'D' then 'D'
                      when public.pos_group(gs.position) = 'F' then 'W' end grp
            from public.game_stats gs join public.games gm on gm.id = gs.game_id
           where gm.status = 'final' and not coalesce(gm.voided, false) and gm.stage in ('regular','playoff')
             and gs.profile_id is not null) l
    where l.grp is not null;
  delete from _r where r is null or (r->>'gp')::int = 0;
  /* fail safe: with no league games at all, keep the norms there are rather than wipe them */
  if not exists (select 1 from _r) then
    return jsonb_build_object('skipped', 'no league games', 'players', 0);
  end if;

  create temp table _sv on commit drop as
    select m.stat, x.grp, (x.r->>m.stat)::numeric v
    from _r x join public.cghl_stat_meta() m
      on m.grp_kind = case when x.grp='G' then 'G' else 'S' end
    where (x.r->>m.stat) is not null
      and case when m.nkey is null then (x.r->>'gp')::numeric
               else coalesce((x.r->>m.nkey)::numeric,0) end >= m.min_n;

  /* PASS 1: every stat's center, spread and coverage, per group. A group with fewer than 12 lines on record
     borrows the whole skater population: a distribution measured on four people is not a distribution. */
  delete from public.rating_norms where kind = 'stat';
  with q as (
    select stat, grp, count(*) n,
           percentile_cont(0.5)  within group (order by v) m,
           percentile_cont(0.90) within group (order by v) p90,
           percentile_cont(0.99) within group (order by v) p99
    from _sv group by stat, grp
  ), mad as (
    select s.stat, s.grp, percentile_cont(0.5) within group (order by abs(s.v - q.m)) d
    from _sv s join q on q.stat=s.stat and q.grp=s.grp group by s.stat, s.grp
  ), pq as (
    select stat, count(*) n, percentile_cont(0.5) within group (order by v) m,
           percentile_cont(0.90) within group (order by v) p90,
           percentile_cont(0.99) within group (order by v) p99
    from _sv where grp <> 'G' group by stat
  ), pmad as (
    select s.stat, percentile_cont(0.5) within group (order by abs(s.v - p.m)) d
    from _sv s join pq p on p.stat=s.stat where s.grp <> 'G' group by s.stat
  ), pick as (
    select q.stat, q.grp, q.n, (q.n >= 12 or q.grp='G') own,
      (case when q.n >= 12 or q.grp='G' then q.m   else pq.m   end)::numeric ctr,
      (case when q.n >= 12 or q.grp='G' then q.p90 else pq.p90 end)::numeric p90,
      (case when q.n >= 12 or q.grp='G' then q.p99 else pq.p99 end)::numeric p99,
      (case when q.n >= 12 or q.grp='G' then mad.d else pmad.d end)::numeric mad
    from q join mad on mad.stat=q.stat and mad.grp=q.grp
         left join pq on pq.stat=q.stat left join pmad on pmad.stat=q.stat
  )
  insert into public.rating_norms (kind, key, pos, center, spread, n, cover)
  select 'stat', k.stat, k.grp, k.ctr,
         public.cghl_spread(k.mad, k.ctr, k.p90, k.p99), k.n, cv.cover
  from pick k
  cross join lateral (
    select coalesce(avg(case when s.v <> k.ctr then 1 else 0 end), 0) cover
    from _sv s where s.stat = k.stat
      and ((k.own and s.grp = k.grp) or (not k.own and s.grp <> 'G'))
  ) cv;
  select count(*) into v_stats from public.rating_norms where kind='stat';

  /* PASS 2: each category's center and spread, per group. */
  create temp table _v on commit drop as
    select e.key, x.grp, (e.value)::text::numeric v
    from (select id, grp, public.cghl_categories(id, grp) c from _r) x, jsonb_each(x.c) e
    where x.c is not null and e.key not in ('kind','grp');

  delete from public.rating_norms where kind = 'cat';
  with q as (
    select key, grp, count(*) n, percentile_cont(0.5) within group (order by v) m,
           percentile_cont(0.90) within group (order by v) p90 from _v group by key, grp
  )
  insert into public.rating_norms (kind, key, pos, center, spread, n)
  select 'cat', q.key, q.grp, q.m,
         greatest(1.4826 * d.mad, (q.p90 - q.m) / 1.2816, 0.20)::numeric, q.n
  from q join (
    select v.key, v.grp, percentile_cont(0.5) within group (order by abs(v.v - q2.m)) mad
    from _v v join q q2 on q2.key=v.key and q2.grp=v.grp group by v.key, v.grp
  ) d on d.key=q.key and d.grp=q.grp;
  select count(*) into v_cats from public.rating_norms where kind='cat';

  /* PASS 3: the composite's own center and spread, per group. */
  create temp table _cz on commit drop as
    select x.id, x.grp, public.cghl_composite(z, x.grp) v
    from _r x, lateral (select public.cghl_catz(x.id, x.grp) z) q where z is not null;
  delete from _cz where v is null;

  delete from public.rating_norms where kind = 'comp';
  with q as (
    select grp, count(*) n, percentile_cont(0.5) within group (order by v) m,
           percentile_cont(0.90) within group (order by v) p90 from _cz group by grp
  )
  insert into public.rating_norms (kind, key, pos, center, spread, n)
  select 'comp', 'OVERALL', q.grp, q.m,
         greatest(1.4826 * d.mad, (q.p90 - q.m) / 1.2816, 0.20)::numeric, q.n
  from q join (
    select c.grp, percentile_cont(0.5) within group (order by abs(c.v - q2.m)) mad
    from _cz c join q q2 on q2.grp = c.grp group by c.grp
  ) d on d.grp = q.grp;
  select count(*) into v_comp from public.rating_norms where kind='comp';

  return jsonb_build_object('stat_norms', v_stats, 'cat_norms', v_cats, 'comp_norms', v_comp,
    'players', (select count(distinct id) from _r), 'lines', (select count(*) from _r), 'by_pos',
    (select jsonb_object_agg(grp, c) from (select grp, count(*) c from _r group by grp) z));
end $fn$;

/* ---- a changed sign-up re-rates the player (the headline may move to another group) ------------------------ */
create or replace function public.trg_registration_overall()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if tg_op = 'UPDATE' and new.position is not distinct from old.position and new.status is not distinct from old.status then
    return null;
  end if;
  /* a rating refresh is never worth refusing a sign-up: the next final re-rates everyone anyway */
  begin
    perform public.refresh_player_overall(new.profile_id);
  exception when others then
    raise warning 'rating refresh after a sign-up change failed for %: %', new.profile_id, sqlerrm;
  end;
  return null;
end $fn$;
revoke all on function public.trg_registration_overall() from public, anon, authenticated;
drop trigger if exists trg_registration_overall on public.season_registrations;
create trigger trg_registration_overall after insert or update of position, status on public.season_registrations
  for each row execute function public.trg_registration_overall();

/* ---- rebuild: norms per group, then every profile's rows and headline ------------------------------------ */
do $mig$ declare r record; v jsonb; n int := 0; begin
  perform set_config('app.role_grant', 'on', true);
  v := public.refresh_rating_norms();
  perform set_config('app.role_grant', '', true);
  if coalesce((v->>'lines')::int, 0) = 0 then raise exception 'norms rebuilt from no lines: %', v; end if;
  delete from public.player_position_overalls where profile_id is not null;   -- qualified: pg_safeupdate
  for r in select id from public.profiles loop
    perform public.refresh_player_overall(r.id); n := n + 1;
  end loop;
  raise notice 'v3.74 rebuild: % ; % profiles rated', v, n;
end $mig$;

do $mig$ begin
  if exists (select 1 from public.player_position_overalls where pos_cat not in ('C','W','D','G')) then
    raise exception 'a rating row has a group outside C/W/D/G';
  end if;
end $mig$;
alter table public.player_position_overalls drop constraint if exists ppo_pos_cat_check;
alter table public.player_position_overalls add constraint ppo_pos_cat_check check (pos_cat in ('C','W','D','G'));
create unique index if not exists ppo_one_headline on public.player_position_overalls (profile_id) where headline;

/* REHEARSAL (2026-09-29, one transaction on the live database, rolled back by a closing raise):
   The first run caught two defects before anything shipped. (1) No headline changed: guard_profile_role's
   older second revert undid every overall written by a caller that is neither a commissioner nor trusted
   automation, the engine flag notwithstanding (fixed above). (2) Moving a headline to another group failed on
   ppo_one_headline, because the new row was marked before the old one was cleared, and trg_registration_overall
   swallowed the error (fixed: the old headline is cleared first).
   The second run, with both fixes: rebuild 1.2 s; a full final (norms + every rated player) 1.0 s; a box-score
   write 4 ms. 104 rated players: 75 headlines moved, average 70.6 to 70.3, range 60 to 81, 20 at 70, 2 up and
   4 down by 5 or more (biz 85 to 75 on two games at defense). Rows C 128, W 78, D 50, G 33; every profile has
   exactly one headline and it equals profiles.overall; player_rating(p, group) agrees with every row;
   14 players are rated at two groups; 10 headlines are settled (6+ games there); 6 players have played but not
   yet at the position they signed up at, so they show a provisional 70. A member changing his own sign-up from
   wing to center (as himself, not trusted, not a commissioner) moved his headline W 72 to C 70 and
   profiles.overall followed. */
/* APPLIED 2026-09-29 14:07 UTC in two migrations, because the single call returned a gateway 503 and a check
   showed nothing had been applied (cghl_settle_gp still 5, no headline column, last migration v3.73):
   v374_position_ratings_engine (everything above the norms function, the guard patch and the trigger), then
   v374_position_ratings_norms_rebuild (refresh_rating_norms, the rebuild, the check and the index). No game
   was final in between. Afterwards: settle 6; rows C 128, W 78, D 50, G 33; no profile without a headline; no
   headline differing from profiles.overall; rated average 70.3, as rehearsed. */
