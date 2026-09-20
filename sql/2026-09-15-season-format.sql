-- v2.48 — THE SEASON FORMAT SWITCH (applied to project bzbuyclwdhmhdzujxeqd on 2026-09-15 ET).
-- One column, seasons.format ('basic' | 'full'), gates every format-dependent rule in the database.
-- BASIC is the league standard; FULL is the previous model kept on the shelf. public.format_rules()
-- is the source of truth for both; src/live/part_live.js CG.FORMAT_RULES mirrors it and
-- tools/season-format.test.cjs pins the two together. Applied in chunks A–E below, each inside a
-- transaction gated by assertions; the Season 1 data migration (loans released, pre-season fixtures
-- removed, the row re-spaced, the board rebuilt as drawn over fifteen snake rounds, 216 games) is
-- recorded at the end. Kept in the repo so the switch — either direction — is a documented change,
-- never a rewrite.

-- ====================================================================
-- ===== A. season format column, defaults, helpers =====
alter table public.seasons add column if not exists format text not null default 'basic'
  constraint seasons_format_chk check (format in ('basic','full'));
comment on column public.seasons.format is 'basic | full — the season format. basic (the league standard): no pre-season, 15-round snake draft, 18-man 9F/6D/3G roster with management inside, everyone 3 games a week, $50M cap, 6 weeks, deadline after week 4, players-only trades, one-season contracts, 6-of-8 playoffs. full (shelved): the richer model — see public.format_rules().';
alter table public.seasons alter column salary_cap set default 50000000;
alter table public.seasons alter column roster_max set default 18;
alter table public.seasons alter column trade_deadline_week set default 4;
alter table public.seasons alter column weeks set default 6;

create or replace function public.format_rules(p_format text)
returns jsonb language sql immutable as $$
  select case when p_format = 'full' then
    '{"format":"full","roster_max":17,"quota":{"F":9,"D":6,"G":2},"camp_max":3,"cap_skater":3,"cap_goalie":6,"cap_camp":3,
      "salary_cap":40000000,"weeks":8,"trade_deadline_week":6,"draft_rounds":14,"draft_snake":false,"max_contract_years":3,
      "extensions":true,"rights":true,"pick_trades":true,"preseason":true,"fa_window":true,"playoff_per_div":4,"playoff_best_of":7}'::jsonb
  else
    '{"format":"basic","roster_max":18,"quota":{"F":9,"D":6,"G":3},"camp_max":3,"cap_skater":3,"cap_goalie":3,"cap_camp":3,
      "salary_cap":50000000,"weeks":6,"trade_deadline_week":4,"draft_rounds":15,"draft_snake":true,"max_contract_years":1,
      "extensions":false,"rights":false,"pick_trades":false,"preseason":false,"fa_window":false,"playoff_per_div":3,"playoff_best_of":7}'::jsonb
  end $$;
comment on function public.format_rules(text) is 'The two season formats as one table. The client mirrors it as CG.FORMAT_RULES; keep the two identical.';

create or replace function public.season_format(p_season uuid)
returns text language sql stable set search_path = public as $$
  select coalesce((select s.format from public.seasons s where s.id = p_season), 'basic') $$;
create or replace function public.season_format_n(p_number integer)
returns text language sql stable set search_path = public as $$
  select coalesce((select s.format from public.seasons s where s.number = p_number), 'basic') $$;
create or replace function public.season_is_basic(p_season uuid)
returns boolean language sql stable set search_path = public as $$
  select public.season_format(p_season) = 'basic' $$;
create or replace function public.season_rules(p_season uuid)
returns jsonb language sql stable set search_path = public as $$
  select public.format_rules(public.season_format(p_season)) $$;
create or replace function public.group_cap(p hockey_position, p_season uuid)
returns integer language sql stable set search_path = public as $$
  select (public.season_rules(p_season)->'quota'->>public.pos_group(p))::int $$;
create or replace function public.group_cap_of(p_group text, p_season uuid)
returns integer language sql stable set search_path = public as $$
  select (public.season_rules(p_season)->'quota'->>p_group)::int $$;
create or replace function public.camp_max(p_season uuid)
returns integer language sql stable set search_path = public as $$
  select (public.season_rules(p_season)->>'camp_max')::int $$;
create or replace function public.max_contract_years(p_season uuid)
returns integer language sql stable set search_path = public as $$
  select (public.season_rules(p_season)->>'max_contract_years')::int $$;
create or replace function public.weekly_cap(p_season uuid, p_squad text, p_pos text, p_stage text)
returns integer language sql stable set search_path = public as $$
  /* Rule 5.2 / 8.3: the appearance cap for one player in one game week (and, in the playoffs, one
     series). Full: skaters 3, goaltenders 6, camp 3, no cap in the pre-season. Basic: 3 for everyone. */
  select case when p_stage = 'preseason' and (r->>'preseason')::boolean then 999999
              when p_squad = 'tc' then (r->>'cap_camp')::int
              when p_pos = 'G' then (r->>'cap_goalie')::int
              else (r->>'cap_skater')::int end
    from public.season_rules(p_season) r $$;
create or replace function public.playoff_per_div(p_season uuid)
returns integer language sql stable set search_path = public as $$
  /* basic: fixed by the format (Rule 8.1). full: the Control Center setting in site_config.playoff_format, default 4. */
  select case when public.season_is_basic(p_season) then (public.season_rules(p_season)->>'playoff_per_div')::int
              else coalesce((select (value->>'perDiv')::int from public.site_config where key = 'playoff_format'), 4) end $$;
create or replace function public.playoff_best_of(p_season uuid)
returns integer language sql stable set search_path = public as $$
  select case when public.season_is_basic(p_season) then (public.season_rules(p_season)->>'playoff_best_of')::int
              else coalesce((select (value->>'bestOf')::int from public.site_config where key = 'playoff_format'), 7) end $$;
create or replace function public.playoff_rounds(p_season uuid)
returns integer language sql stable set search_path = public as $$
  /* enough rounds to crown a division champion, plus the final between the two */
  select 1 + ceil(ln(public.playoff_per_div(p_season)) / ln(2) - 1e-9)::int $$;
create or replace function public.playoff_round_name(p_season uuid, p_round integer)
returns text language sql stable set search_path = public as $$
  select case when p_round >= k then 'final'
              when k - p_round = 1 then 'division final'
              when k - p_round = 2 then 'division semi-final'
              when k - p_round = 3 then 'division quarter-final'
              else 'division round ' || p_round end
    from (select public.playoff_rounds(p_season) k) x $$;
create or replace function public.fa_open(p_season uuid)
returns boolean language sql stable set search_path = public as $$
  /* Rule 2.2: when a club may sign an unrostered player. full: from the free-agency opening date.
     basic: there is no free-agency week — signings open the moment the draft concludes (and from
     puck drop regardless), and stay open until the movement deadline. */
  select case when public.season_is_basic(s.id) then
              exists (select 1 from public.draft_state ds where ds.season_number = s.number and ds.status = 'complete')
              or (s.starts_at is not null and now() >= s.starts_at)
         else s.free_agency_opens_at is not null and now() >= s.free_agency_opens_at end
    from public.seasons s where s.id = p_season $$;
grant execute on function public.format_rules(text), public.season_format(uuid), public.season_format_n(integer), public.season_is_basic(uuid),
  public.season_rules(uuid), public.group_cap(hockey_position, uuid), public.group_cap_of(text, uuid), public.camp_max(uuid),
  public.max_contract_years(uuid), public.weekly_cap(uuid, text, text, text), public.playoff_per_div(uuid), public.playoff_best_of(uuid),
  public.playoff_rounds(uuid), public.playoff_round_name(uuid, integer), public.fa_open(uuid) to anon, authenticated;

-- a season row must be self-consistent with its format
create or replace function public.guard_season_format()
returns trigger language plpgsql set search_path = public as $$
declare r jsonb := public.format_rules(new.format); v_max int;
begin
  v_max := (r->'quota'->>'F')::int + (r->'quota'->>'D')::int + (r->'quota'->>'G')::int;
  if new.roster_max is distinct from v_max then
    raise exception 'A % season carries a %-man active roster (% forwards, % defensemen, % goaltenders — Rule 2.1); roster_max % does not fit the format.',
      new.format, v_max, r->'quota'->>'F', r->'quota'->>'D', r->'quota'->>'G', new.roster_max using errcode = 'check_violation';
  end if;
  if new.trade_deadline_week is not null and new.weeks is not null and new.trade_deadline_week >= new.weeks then
    raise exception 'The movement deadline (week %) has to fall before the last regular-season week (%).', new.trade_deadline_week, new.weeks using errcode = 'check_violation';
  end if;
  if new.format = 'basic' and new.preseason_starts_at is not null then
    raise exception 'A basic-format season has no pre-season — clear the pre-season date or switch the season to the full format.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists guard_season_format_trg on public.seasons;
-- bound AFTER the data migration below (the live rows are still 17/8/6 at this point)

-- the reusable count-asserted splice: edit a live function body without retyping it
create or replace function public._splice_fn(p_fn text, variadic p_edits text[])
returns void language plpgsql as $$
declare v_def text; i int; v_from text; v_to text; v_n int; v_cnt int;
begin
  if array_length(p_edits, 1) % 3 <> 0 then raise exception '_splice_fn: edits come in (from, to, count) triples'; end if;
  select pg_get_functiondef(p_fn::regprocedure) into v_def;
  i := 1;
  while i <= array_length(p_edits, 1) loop
    v_from := p_edits[i]; v_to := p_edits[i+1]; v_n := p_edits[i+2]::int;
    v_cnt := (length(v_def) - length(replace(v_def, v_from, ''))) / greatest(length(v_from), 1);
    if v_cnt <> v_n then
      raise exception '% — expected % occurrence(s) of [%], found %', p_fn, v_n, left(v_from, 90), v_cnt;
    end if;
    v_def := replace(v_def, v_from, v_to);
    i := i + 3;
  end loop;
  execute v_def;
end $$;
revoke all on function public._splice_fn(text, text[]) from public, anon, authenticated;

-- ====================================================================
-- ===== B. roster shape, camp, placement =====
create or replace function public.pro_roster_count(p_season uuid, p_team uuid)
returns integer language sql stable security definer set search_path = public as $$
  /* the club's ACTIVE roster count for the "N of roster_max" gates: contracted players on the
     active squad. Camp sits outside; so do pre-season loans and basic-format depth placements,
     which never count against the shape (Rule 2.1). Waived rows are not on the roster. */
  select count(*)::int from public.roster_spots rs
   where rs.season_id = p_season and rs.team_id = p_team and rs.status = 'active'
     and coalesce(rs.squad, 'pro') <> 'tc'
     and coalesce(rs.origin,'') not in ('preseason_random','latecomer_random','depth_random') $$;

create or replace function public.check_roster_structure()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_season uuid; v_team uuid; f int; d int; g int; qf int; qd int; qg int;
begin
  v_season := coalesce(NEW.season_id, OLD.season_id);
  v_team   := coalesce(NEW.team_id,   OLD.team_id);
  -- Rule 2.1: the ACTIVE roster is at most the format's shape — 9 F / 6 D / 2 G (17) in the full
  -- format, 9 F / 6 D / 3 G (18) in the basic format — counted by position group among CONTRACTED
  -- players. Pre-season loans (full format) and depth placements (basic format: undrafted and late
  -- sign-ups placed by the league office) ride the roster without counting, so every registered
  -- player has a club. Training camp is not counted here at all.
  qf := public.group_cap_of('F', v_season); qd := public.group_cap_of('D', v_season); qg := public.group_cap_of('G', v_season);
  select
    count(*) filter (where squad='pro' and public.pos_group(position)='F' and coalesce(origin,'') not in ('preseason_random','latecomer_random','depth_random')),
    count(*) filter (where squad='pro' and public.pos_group(position)='D' and coalesce(origin,'') not in ('preseason_random','latecomer_random','depth_random')),
    count(*) filter (where squad='pro' and public.pos_group(position)='G' and coalesce(origin,'') not in ('preseason_random','latecomer_random','depth_random'))
    into f, d, g
    from roster_spots where season_id=v_season and team_id=v_team and status='active';
  if f > qf or d > qd or g > qg then
    raise exception 'Rule 2.1 — the active roster holds % forwards, % defensemen and % goaltenders; this club would have % forwards / % defensemen / % goaltenders. Send someone to training camp first, or swap within the position group. (Loans and league-office depth placements do not count.)', qf, qd, qg, f, d, g
      using errcode='check_violation';
  end if;
  return null;
end $$;

create or replace function public.place_new_roster_spot()
returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; n_pro int; n_tc int;
begin
  NEW.squad_moves := coalesce((select h.moves from public.squad_move_history h
     where h.season_id = NEW.season_id and h.team_id = NEW.team_id
       and h.profile_id = NEW.profile_id), 0);
  if NEW.squad is null then NEW.squad := 'pro'; end if;
  -- Loans and depth placements ride on the active roster without counting against the shape and
  -- are never bumped to camp: a club may hold as many as it is assigned (Rule 2.1).
  if coalesce(NEW.origin,'') in ('preseason_random','latecomer_random','depth_random') then
    return NEW;
  end if;
  if NEW.squad = 'pro' then
    -- Rule 2.1: by position group, contracted only — the format's quota (9/6/2 or 9/6/3)
    cap := public.group_cap(NEW.position, NEW.season_id);
    select count(*) into n_pro from roster_spots
      where season_id = NEW.season_id and team_id = NEW.team_id and status = 'active'
        and squad = 'pro' and public.pos_group(position) = public.pos_group(NEW.position)
        and coalesce(origin,'') not in ('preseason_random','latecomer_random','depth_random');
    if n_pro >= cap then
      select count(*) into n_tc from roster_spots
        where season_id = NEW.season_id and team_id = NEW.team_id and status = 'active' and squad = 'tc'
          and coalesce(origin,'') not in ('preseason_random','latecomer_random','depth_random');
      if n_tc < public.camp_max(NEW.season_id) then NEW.squad := 'tc'; end if;   -- genuinely full in that group: park in camp
    end if;
  end if;
  return NEW;
end $$;

select public._splice_fn('public.guard_squad_move()',
  $a$    if v_camp >= 3 then
      raise exception 'Rule 2.1 — training camp is full: a club may carry at most three (3) camp players.'$a$,
  $b$    if v_camp >= public.camp_max(NEW.season_id) then
      raise exception 'Rule 2.1 — training camp is full: a club may carry at most % camp players.', public.camp_max(NEW.season_id)$b$, '1');

-- _assign_reg_random: quotas from the format; camp cap from the format; in the basic format every
-- league-office random placement (post-draft, late sign-up) lands as DEPTH — on the active roster,
-- never counted against the shape, never parked in camp — so everyone registered gets a club.
select public._splice_fn('public._assign_reg_random(uuid,text,boolean,text)',
  $a$  v_camp   boolean := false;
begin$a$,
  $b$  v_camp   boolean := false;
  v_origin text;
  v_basic  boolean;
begin$b$, '1',
  $a$  v_max := coalesce(v_reg.roster_max, 17);
  v_pos := coalesce(v_reg.position, 'C');$a$,
  $b$  v_max := coalesce(v_reg.roster_max, 17);
  v_pos := coalesce(v_reg.position, 'C');
  v_basic := public.season_is_basic(v_reg.season_id);
  v_origin := p_origin;
  -- basic format (Rule 2.8): league-office placements are depth. They fill genuine open seats first
  -- (exact, then any group), then overflow — and whichever step seats them, they are never counted
  -- against the roster shape and never sent to camp.
  if v_basic and p_origin in ('postdraft_random','latecomer_random') then
    v_origin := 'depth_random';
    if p_mode in ('legacy','fill') then p_mode := 'fill'; end if;
  end if;$b$, '1',
  $a$              < public.group_cap(v_pos)$a$,
  $b$              < public.group_cap(v_pos, v_reg.season_id)$b$, '1',
  $a$              < case grp.g when 'G' then 2 when 'D' then 6 else 9 end$a$,
  $b$              < public.group_cap_of(grp.g, v_reg.season_id)$b$, '1',
  $a$                 where rs.season_id = v_reg.season_id and rs.team_id = t.id and rs.status = 'active' and rs.squad = 'tc') < 3$a$,
  $b$                 where rs.season_id = v_reg.season_id and rs.team_id = t.id and rs.status = 'active' and rs.squad = 'tc') < public.camp_max(v_reg.season_id)$b$, '1',
  $a$    values (v_reg.season_id, v_team, v_reg.profile_id, coalesce(v_jersey,0), v_slot, 0, p_origin, case when v_camp then 'tc' else null end);$a$,
  $b$    values (v_reg.season_id, v_team, v_reg.profile_id, coalesce(v_jersey,0), v_slot, 0, v_origin, case when v_camp then 'tc' else null end);$b$, '1',
  $a$        'Random assignment — a sign-up was placed on ' || coalesce(v_tag,'a club')$a$,
  $b$        case when v_origin = 'depth_random' then 'League-office placement — a registered player joins ' else 'Random assignment — a sign-up was placed on ' end || coalesce(v_tag,'a club')
        || case when v_origin = 'depth_random' then ' as depth (Rule 2.8)' else '' end$b$, '1');

-- the pre-season assignment does not exist in the basic format
select public._splice_fn('public.preseason_random_assign()',
  $a$  if v_season.id is null then raise exception 'No season is open.'; end if;$a$,
  $b$  if v_season.id is null then raise exception 'No season is open.'; end if;
  if public.season_is_basic(v_season.id) then
    raise exception 'This season runs the basic format — there is no pre-season and no pre-season loans. Everyone registered by the cutoff enters the draft; anyone undrafted is placed as depth after it (Rule 2.8).';
  end if;$b$, '1');

drop function if exists public.group_cap(hockey_position);

-- ====================================================================
-- ===== C. the draft: rounds by format, snake order, reuse of a drawn order, eligibility =====
create or replace function public.is_draft_eligible(p_profile uuid, p_season uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with cur as (select number, format, coalesce(signup_deadline_at, registration_deadline) as cutoff
                 from public.seasons where id = p_season)
  select
    exists (select 1 from public.season_registrations sr, cur
             where sr.profile_id = p_profile and sr.season_id = p_season and sr.status <> 'declined'
               and (cur.cutoff is null or sr.created_at <= cur.cutoff))
    and (
      -- basic format (Rule 2.8): registered by the cutoff is the whole test — no pre-season, no appearance count
      (select format from cur) = 'basic'
      -- full format: veteran — drafted in a prior cycle
      or exists (select 1 from public.draft_picks dp, cur
               where dp.player_id = p_profile and dp.used and dp.season_number < cur.number)
      -- or rostered in a prior season
      or exists (select 1 from public.roster_spots rs join public.seasons s on s.id = rs.season_id, cur
                  where rs.profile_id = p_profile and s.number < cur.number)
      -- or 5+ career games on record
      or (select count(*) from public.game_stats gs join public.games g on g.id = gs.game_id
           where gs.profile_id = p_profile and g.status='final' and not g.voided) >= 5
      -- or 3+ pre-season appearances this cycle (Rule 2.8, v2.46 — was 5)
      or (select count(distinct gs.game_id) from public.game_stats gs join public.games g on g.id = gs.game_id
           where gs.profile_id = p_profile and g.season_id = p_season and g.stage='preseason'
             and g.status='final' and not g.voided) >= 3
    );
$$;

-- generate_draft_board: (1) the round count is the format's (fifteen basic / fourteen full);
-- (2) basic drafts SNAKE — even rounds run in reverse; (3) a sixth style, as_drawn, rebuilds the
-- board from the order already drawn in draft_state.order_meta instead of redrawing it.
select public._splice_fn('public.generate_draft_board(integer,integer,text,uuid[])',
  $a$  v_nonpo uuid[]; v_po uuid[]; v_draws int;
begin$a$,
  $b$  v_nonpo uuid[]; v_po uuid[]; v_draws int;
  v_fmt text; v_snake boolean; v_want_rounds int; v_prev_meta jsonb;
begin$b$, '1',
  $a$  if p_rounds < 1 or p_rounds > 20 then raise exception 'Rounds must be 1–20.'; end if;
  if p_style not in ('reverse_standings','lottery','random','manual','nhl_lottery') then$a$,
  $b$  if p_rounds < 1 or p_rounds > 20 then raise exception 'Rounds must be 1–20.'; end if;
  v_fmt := public.season_format_n(p_season_number);
  v_snake := (public.format_rules(v_fmt)->>'draft_snake')::boolean;
  v_want_rounds := (public.format_rules(v_fmt)->>'draft_rounds')::int;
  if p_rounds <> v_want_rounds then
    raise exception 'A %-format draft runs % rounds (Rule 2.8) — the board is built to the format, not to a number typed in.', v_fmt, v_want_rounds;
  end if;
  if p_style not in ('reverse_standings','lottery','random','manual','nhl_lottery','as_drawn') then$b$, '1',
  $a$  if p_style = 'reverse_standings' then
    v_order := v_pool;$a$,
  $b$  if p_style = 'as_drawn' then
    /* keep the order already drawn for this season (its style and any fallback are kept in the
       meta too) — used when the board is rebuilt for a new round count or pattern */
    select order_meta into v_prev_meta from public.draft_state where season_number = p_season_number;
    if v_prev_meta is null or jsonb_typeof(v_prev_meta->'order') <> 'array' then
      raise exception 'No drawn order to keep for season % — build the board with a real order style first.', p_season_number;
    end if;
    select array_agg(x::uuid order by o) into v_order from jsonb_array_elements_text(v_prev_meta->'order') with ordinality t(x, o);
    if coalesce(array_length(v_order,1),0) <> v_n
       or exists (select 1 from unnest(v_order) x where x not in (select id from public.teams)) then
      raise exception 'The drawn order no longer matches the league''s clubs — draw a fresh order.';
    end if;
  elsif p_style = 'reverse_standings' then
    v_order := v_pool;$b$, '1',
  $a$      insert into public.draft_picks(season_number, round, original_team_id, current_team_id, overall_pick)
        values (p_season_number, r, v_order[i], v_order[i], (r-1)*v_n + i);$a$,
  $b$      insert into public.draft_picks(season_number, round, original_team_id, current_team_id, overall_pick)
        values (p_season_number, r, v_order[i], v_order[i],
                case when v_snake and r % 2 = 0 then (r-1)*v_n + (v_n - i + 1) else (r-1)*v_n + i end);$b$, '1',
  $a$  v_meta := jsonb_build_object('style', p_style, 'rounds', p_rounds,
    'order', to_jsonb(v_order), 'codes', to_jsonb(v_codes), 'generated_at', now())
    || case when v_fallback is not null then jsonb_build_object('fallback', v_fallback) else '{}'::jsonb end;$a$,
  $b$  v_meta := jsonb_build_object('style', case when p_style = 'as_drawn' then coalesce(v_prev_meta->>'style', 'manual') else p_style end,
    'rounds', p_rounds, 'snake', v_snake, 'format', v_fmt,
    'order', to_jsonb(v_order), 'codes', to_jsonb(v_codes), 'generated_at', now())
    || case when v_fallback is not null then jsonb_build_object('fallback', v_fallback)
            when p_style = 'as_drawn' and v_prev_meta ? 'fallback' then jsonb_build_object('fallback', v_prev_meta->>'fallback')
            else '{}'::jsonb end
    || case when p_style = 'as_drawn' then jsonb_build_object('reused_order', true, 'drawn_at', v_prev_meta->'generated_at') else '{}'::jsonb end;$b$, '1');

select public._splice_fn('public.draft_make_pick(uuid,uuid)',
  $a$    raise exception 'That player isn''t draft-eligible - first-year players need five pre-season games. They''ll be placed on a club automatically after the draft.';$a$,
  $b$    if public.season_is_basic(v_season) then
      raise exception 'That player isn''t draft-eligible — he registered after the sign-up cutoff. He''ll be placed on a club as depth after the draft (Rule 2.8).';
    end if;
    raise exception 'That player isn''t draft-eligible - first-year players need three pre-season games. They''ll be placed on a club automatically after the draft.';$b$, '1');

-- the stale default: a caller that omits the round count now prices against the basic scale
alter function public.draft_round_salary(integer, integer) rename to draft_round_salary_v1;
create or replace function public.draft_round_salary(p_round integer, p_rounds integer default 15)
returns bigint language sql immutable set search_path = public as $$
  select 750000::bigint
       + (greatest(coalesce(p_rounds,15),1) - greatest(least(coalesce(p_round,1), greatest(coalesce(p_rounds,15),1)),1))
         * 250000;
$$;
drop function public.draft_round_salary_v1(integer, integer);

create or replace function public.draft_pick_salary(p_season_number integer, p_round integer)
returns bigint language sql stable set search_path = public as $$
  /* pay by round on the season's scale: the last round pays the minimum. The scale is sized from
     the board that exists; before a board exists, from the format's round count. */
  select public.draft_round_salary(
           p_round,
           coalesce((select max(round) from public.draft_picks where season_number = p_season_number),
                    (public.format_rules(public.season_format_n(p_season_number))->>'draft_rounds')::int));
$$;

-- ====================================================================
-- ===== D. weekly / series caps and the playoffs =====
select public._splice_fn('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)',
  $a$    v_cap := case when v_game.stage = 'preseason' then 999999 when v_squad = 'tc' then 3 when v_pos = 'G' then 6 else 3 end;$a$,
  $b$    v_cap := public.weekly_cap(v_game.season_id, v_squad, v_pos, v_game.stage);   -- Rule 5.2, by format$b$, '1');

select public._splice_fn('public.set_team_line(uuid,uuid,integer,text,uuid,uuid,uuid,uuid,uuid,uuid)',
  $a$  v_glines int;
  v_gname text;$a$,
  $b$  v_glines int;
  v_gname text;
  v_glmax int;$b$, '1',
  $a$    if v_glines >= 2 and not public.preseason_next(p_team, p_season) then   -- Rule 5.2: no weekly cap in the pre-season (v2.36)
      select coalesce(nullif(gamertag,''),'That goaltender') into v_gname
        from public.profiles where id = p_goalie;
      raise exception '% already backstops two lines — a goaltender''s six-game week is two nights (Rule 5.2).',
        v_gname using errcode = '22023';$a$,
  $b$    /* Rule 5.2: a goaltender's weekly cap in nights — six games is two nights (full format), three
       games is one night (basic format). No weekly cap in the full format's pre-season (v2.36). */
    v_glmax := greatest(1, public.weekly_cap(p_season, 'pro', 'G', 'regular') / 3);
    if v_glines >= v_glmax and not public.preseason_next(p_team, p_season) then
      select coalesce(nullif(gamertag,''),'That goaltender') into v_gname
        from public.profiles where id = p_goalie;
      raise exception '% already backstops % — a goaltender''s %-game week is % (Rule 5.2).',
        v_gname, case when v_glmax = 1 then 'a line' else v_glmax || ' lines' end,
        public.weekly_cap(p_season, 'pro', 'G', 'regular'), case when v_glmax = 1 then 'one night' else v_glmax || ' nights' end
        using errcode = '22023';$b$, '1');

select public._splice_fn('public.lineup_camp_warnings(uuid,uuid)',
  $a$            < case when pos_group(rs.position) = 'G' then 6 else 3 end$a$,
  $b$            < public.weekly_cap(v_g.season_id, 'pro', pos_group(rs.position), v_g.stage)$b$, '1');

select public._splice_fn('public.lineup_slot_ok(uuid,text,uuid,uuid,text)',
  $a$      case when p_stage = 'preseason' then ' (and, in the pre-season, the club''s Owner, GM and AGM).' else ' — in the pre-season, management too.' end$a$,
  $b$      case when p_stage = 'preseason' then ' (and, in the pre-season, the club''s Owner, GM and AGM).'
           when public.season_is_basic(p_season) then '.'
           else ' — in the pre-season, management too.' end$b$, '1');

-- the series-cap audit (Rule 8.3) read the v2.7 numbers (skaters only, > 4); it now audits every
-- appearance against the format's cap, goaltenders included
create or replace function public.check_playoff_violations()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record; v_series_gp int; v_name text; v_team text; v_cap int; v_squad text;
begin
  if not (new.stage = 'playoff' and new.status = 'final' and old.status is distinct from new.status) then
    return new;
  end if;
  begin
    for r in select distinct gs.profile_id, gs.team_id, bool_or(coalesce(gs.is_goalie,false)) as is_goalie
               from public.game_stats gs
             where gs.game_id = new.id and gs.profile_id is not null
             group by gs.profile_id, gs.team_id
    loop
      select coalesce(nullif(gamertag,''),'a player') into v_name from public.profiles where id = r.profile_id;
      select code into v_team from public.teams where id = r.team_id;
      select rs.squad into v_squad from public.roster_spots rs
        where rs.season_id = new.season_id and rs.team_id = r.team_id and rs.profile_id = r.profile_id limit 1;
      -- Rule 8.3: the weekly cap serves as the series cap — full format skaters 3 / goaltenders 6,
      -- basic format 3 for everyone
      v_cap := public.weekly_cap(new.season_id, v_squad, case when r.is_goalie then 'G' else 'C' end, 'playoff');
      select count(distinct g.id) into v_series_gp from public.game_stats gs
        join public.games g on g.id = gs.game_id
        where gs.profile_id = r.profile_id
          and g.season_id = new.season_id and g.stage = 'playoff' and g.status = 'final'
          and g.week = new.week
          and ((g.home_team_id = new.home_team_id and g.away_team_id = new.away_team_id)
            or (g.home_team_id = new.away_team_id and g.away_team_id = new.home_team_id));
      if v_series_gp > v_cap then
        perform public.notify_commissioners(null, 'flag', 'Playoff series-cap violation (Rule 8.3)',
          v_name || ' (' || coalesce(v_team,'?') || ') has now played ' || v_series_gp ||
          ' games in this playoff series — the cap is ' || v_cap || '. Review the game.', 'transactions', null);
        perform public.log_admin_action('playoff_violation_series_cap','game',new.id::text,
          jsonb_build_object('player',v_name,'club',v_team,'series_games',v_series_gp,'cap',v_cap));
      end if;
    end loop;
  exception when others then
    raise warning 'check_playoff_violations failed for game %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

-- clinches: the qualifier count comes from the format (basic: top three per division, the #1
-- seed rests through the opening round; full: the Control Center setting, default four)
select public._splice_fn('public.check_playoff_clinches(uuid)',
  $a$  v_rec text; v_left int; v_codes jsonb;
begin$a$,
  $b$  v_rec text; v_left int; v_codes jsonb; v_per int; v_basic boolean;
begin$b$, '1',
  $a$  if v_num is null then return 0; end if;$a$,
  $b$  if v_num is null then return 0; end if;
  v_per := public.playoff_per_div(p_season); v_basic := public.season_is_basic(p_season);$b$, '1',
  $a$    if rivals_alive <= 2 and t.pts > 0 then$a$,
  $b$    if rivals_alive <= v_per - 1 and t.pts > 0 then$b$, '1',
  $a$          t.division || ' Division''s top three (Rule 8.1).' || E'\n\n' ||
          'Their seed is still in play — division winners take the top two seeds and a quarter-final bye, so the closing schedule decides whether they start the postseason resting or working. The projected bracket on the standings page now shows them locked in.');$a$,
  $b$          t.division || ' Division''s top ' || case v_per when 2 then 'two' when 3 then 'three' when 4 then 'four' when 5 then 'five' when 6 then 'six' else v_per::text end || ' (Rule 8.1).' || E'\n\n' ||
          case when v_basic
               then 'Their seed is still in play — the division''s top seed rests through the opening round while the second and third seeds play, so the closing schedule decides whether they start the postseason resting or working.'
               else 'Their seed is still in play — the closing schedule decides who they open against inside the division.' end ||
          ' The projected bracket on the standings page now shows them locked in.');$b$, '1');

-- series conclusion: series length, round count and round names come from the format helpers, so
-- a champion is crowned at the LAST round whatever the bracket shape
select public._splice_fn('public.trg_conclude_series()',
  $a$  select coalesce((value->>'bestOf')::int, 3) into v_best
    from public.site_config where key='playoff_format';
  if v_best is null then v_best := 3; end if;$a$,
  $b$  v_best := public.playoff_best_of(new.season_id);$b$, '1',
  $a$  v_round := case new.week when 1 then 'quarter-final' when 2 then 'semi-final' else 'final' end;

  if new.week >= 3 then$a$,
  $b$  v_round := public.playoff_round_name(new.season_id, new.week);

  if new.week >= public.playoff_rounds(new.season_id) then$b$, '1');

-- ====================================================================
-- ===== E. trades, free agency, contracts, extensions, lifecycle, rollover, deadlines =====

-- players-only trades in the basic format (Rule 2.3): refused at the table, at acceptance and in the Owner queue
create or replace function public.guard_trade_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.moves_locked(new.season_id) and not public.is_commissioner() then
    raise exception 'Roster moves are locked — the trade deadline has passed (or a commissioner locked moves).';
  end if;
  if public.season_is_basic(new.season_id)
     and (coalesce(cardinality(new.offered_pick_ids),0) + coalesce(cardinality(new.requested_pick_ids),0)) > 0 then
    raise exception 'Rule 2.3 — draft picks are not traded in the basic season format. Trade players only.';
  end if;
  return new;
end $$;
drop trigger if exists on_trade_insert_guard on public.trades;
do $$
declare v_old text;
begin
  -- whatever the guard's trigger is called today, rebind it for insert AND update
  for v_old in select tgname from pg_trigger where tgrelid = 'public.trades'::regclass and not tgisinternal
                and tgfoid = 'public.guard_trade_insert()'::regprocedure loop
    execute format('drop trigger %I on public.trades', v_old);
  end loop;
  create trigger on_trade_insert_guard before insert or update of offered_pick_ids, requested_pick_ids, season_id, status
    on public.trades for each row execute function public.guard_trade_insert();
end $$;

select public._splice_fn('public.accept_trade(uuid)',
  $a$  if public.moves_locked(t.season_id) and not public.is_commissioner() then
    raise exception 'Roster moves are locked — the trade deadline has passed.';
  end if;$a$,
  $b$  if public.moves_locked(t.season_id) and not public.is_commissioner() then
    raise exception 'Roster moves are locked — the trade deadline has passed.';
  end if;
  if public.season_is_basic(t.season_id)
     and (coalesce(cardinality(t.offered_pick_ids),0) + coalesce(cardinality(t.requested_pick_ids),0)) > 0 then
    raise exception 'Rule 2.3 — draft picks are not traded in the basic season format. Withdraw this offer and trade players only.';
  end if;$b$, '1');

select public._splice_fn('public._mgmt_describe(uuid,text,jsonb)',
  $a$    if (cardinality(v_arr) + cardinality(v_k)) = 0 or (cardinality(v_arr2) + cardinality(v_k2)) = 0 then raise exception 'Add at least one player or pick on each side.'; end if;$a$,
  $b$    if public.season_is_basic(v_season) and (cardinality(v_k) + cardinality(v_k2)) > 0 then raise exception 'Rule 2.3 — draft picks are not traded in the basic season format. Trade players only.'; end if;
    if (cardinality(v_arr) + cardinality(v_k)) = 0 or (cardinality(v_arr2) + cardinality(v_k2)) = 0 then raise exception 'Add at least one player or pick on each side.'; end if;$b$, '1');

-- free agency opens by format (fa_open), contract terms are capped by format
select public._splice_fn('public.sign_free_agent(uuid,bigint)',
  $a$  if v_season.free_agency_opens_at is null or now() < v_season.free_agency_opens_at then
    raise exception 'Free agency has not opened yet.';
  end if;$a$,
  $b$  if not public.fa_open(v_season.id) then
    raise exception 'Free agency has not opened yet.';
  end if;
  if public.moves_locked(v_season.id) and not public.is_commissioner() then
    raise exception 'Roster moves are locked — the deadline has passed.';
  end if;$b$, '1');
select public._splice_fn('public.offer_free_agent(uuid,bigint,integer,text)',
  $a$  if v_season.free_agency_opens_at is null or now() < v_season.free_agency_opens_at then
    raise exception 'Free agency has not opened yet.';
  end if;$a$,
  $b$  if not public.fa_open(v_season.id) then
    raise exception 'Free agency has not opened yet.';
  end if;$b$, '1',
  $a$  if p_years is null or p_years < 1 or p_years > 3 then raise exception 'Contracts run 1 to 3 seasons (Rule 2.5).'; end if;$a$,
  $b$  if p_years is null or p_years < 1 or p_years > public.max_contract_years(v_season.id) then
    raise exception '%', case when public.max_contract_years(v_season.id) = 1 then 'Every contract runs one season in the basic format (Rule 2.5).' else 'Contracts run 1 to ' || public.max_contract_years(v_season.id) || ' seasons (Rule 2.5).' end;
  end if;$b$, '1');
select public._splice_fn('public.respond_offer(uuid,text,bigint,integer)',
  $a$  elsif p_action = 'edit' then
    if p_years is null or p_years < 1 or p_years > 3 then raise exception 'Contracts run 1 to 3 seasons (Rule 2.5).'; end if;$a$,
  $b$  elsif p_action = 'edit' then
    if p_years is null or p_years < 1 or p_years > public.max_contract_years(public.current_season_id()) then
      raise exception '%', case when public.max_contract_years(public.current_season_id()) = 1 then 'Every contract runs one season in the basic format (Rule 2.5).' else 'Contracts run 1 to ' || public.max_contract_years(public.current_season_id()) || ' seasons (Rule 2.5).' end;
    end if;$b$, '1',
  $a$      v_next := o.start_season;
      select * into v_season from public.seasons where id = public.current_season_id();$a$,
  $b$      v_next := o.start_season;
      select * into v_season from public.seasons where id = public.current_season_id();
      if public.season_is_basic(v_season.id) then
        raise exception 'Extensions are not part of the basic season format — every contract runs one season and every player re-enters the draft (Rule 2.5).';
      end if;$b$, '1');

-- extensions and held rights exist only in the full format
create or replace function public.extension_window_open(p_season uuid)
returns boolean language sql stable security definer set search_path = public as $$
  /* full format: open once the season's cap year has begun (free agency opening; puck drop as a
     fallback for a season with no free-agency date; a season with neither date set is a setup
     state, not a gate). basic format: never — contracts run one season (Rule 2.5). */
  select case when s.format = 'basic' then false
              else coalesce(now() >= coalesce(s.free_agency_opens_at, s.starts_at), true) end
    from public.seasons s where s.id = p_season;
$$;
select public._splice_fn('public._extendable_contract(uuid,seasons)',
  $a$   where c.profile_id = p_profile and not coalesce(c.is_manager,false) and c.team_id is not null
     and ($a$,
  $b$   where c.profile_id = p_profile and not coalesce(c.is_manager,false) and c.team_id is not null
     and p_season.format = 'full'   -- Rule 2.5: no extensions or held rights in the basic format
     and ($b$, '1');
select public._splice_fn('public.offer_extension(uuid,bigint,integer,text)',
  $a$  if v_season.id is null then raise exception 'No active season.'; end if;
  v_ct := public._extendable_contract(p_profile, v_season);$a$,
  $b$  if v_season.id is null then raise exception 'No active season.'; end if;
  if public.season_is_basic(v_season.id) then
    raise exception 'Extensions are not part of the basic season format — every contract runs one season and every player re-enters the draft (Rule 2.5).';
  end if;
  v_ct := public._extendable_contract(p_profile, v_season);$b$, '1');
select public._splice_fn('public.request_extension(bigint,integer,text)',
  $a$  if v_season.id is null then raise exception 'No active season.'; end if;
  v_ct := public._extendable_contract(auth.uid(), v_season);$a$,
  $b$  if v_season.id is null then raise exception 'No active season.'; end if;
  if public.season_is_basic(v_season.id) then
    raise exception 'Re-signing is not part of the basic season format — every contract runs one season and every player re-enters the draft (Rule 2.5).';
  end if;
  v_ct := public._extendable_contract(auth.uid(), v_season);$b$, '1');

-- rollover into a basic season: everyone re-enters the draft, so every player deal from earlier
-- seasons closes and nothing signed ahead survives (Rule 2.5)
select public._splice_fn('public.start_next_season(uuid)',
  $a$  update public.contracts set status = 'expired', updated_at = now()
    where status = 'active' and end_season < s.number;
  get diagnostics v_expired = row_count;$a$,
  $b$  if s.format = 'basic' then
    update public.contracts set status = 'expired', updated_at = now()
      where status in ('active','signed') and not coalesce(is_manager,false) and start_season < s.number;
  else
    update public.contracts set status = 'expired', updated_at = now()
      where status = 'active' and end_season < s.number;
  end if;
  get diagnostics v_expired = row_count;$b$, '1');

-- the next season inherits the format
select public._splice_fn('public.flip_season_status()',
  $a$    insert into public.seasons (number, name, status, registration_open,
        roster_max, salary_cap, weeks, nights_per_week, night_slots,
        div_games, nondiv_games, trade_deadline_week,
        owner_salary, gm_salary, agm_salary, skip_holidays)
      values (v_next, 'Season ' || v_next, 'upcoming', true,
        v_s.roster_max, v_s.salary_cap, v_s.weeks, v_s.nights_per_week, v_s.night_slots,
        v_s.div_games, v_s.nondiv_games, v_s.trade_deadline_week,
        v_s.owner_salary, v_s.gm_salary, v_s.agm_salary, v_s.skip_holidays);$a$,
  $b$    insert into public.seasons (number, name, status, registration_open, format,
        roster_max, salary_cap, weeks, nights_per_week, night_slots,
        div_games, nondiv_games, trade_deadline_week,
        owner_salary, gm_salary, agm_salary, skip_holidays)
      values (v_next, 'Season ' || v_next, 'upcoming', true, v_s.format,
        v_s.roster_max, v_s.salary_cap, v_s.weeks, v_s.nights_per_week, v_s.night_slots,
        v_s.div_games, v_s.nondiv_games, v_s.trade_deadline_week,
        v_s.owner_salary, v_s.gm_salary, v_s.agm_salary, v_s.skip_holidays);$b$, '1');

-- the movement deadline is ONE clock: placement closes when trades do
select public._splice_fn('public.auto_assign_latecomers(boolean)',
  $a$  if v_season.trade_deadline_week is not null then
    select max(g.scheduled_at) + interval '1 day' into v_deadline
      from public.games g
      where g.season_id = v_season.id and g.stage = 'regular'
        and g.week <= v_season.trade_deadline_week;
    if v_deadline is not null and now() > v_deadline and not p_force then
      return 0;
    end if;
  end if;$a$,
  $b$  if public.moves_locked(v_season.id) and not p_force then return 0; end if;   -- Rule 2.4: one deadline for every move$b$, '1',
  $a$  perform public._club_batch_notices(v_season.id, 'latecomer_random', now(), 'loan', 'Late sign-ups placed',
    'Placed for the pre-season on the same terms as any loan (Rule 0.4):');$a$,
  $b$  if public.season_is_basic(v_season.id) then
    perform public._club_batch_notices(v_season.id, 'depth_random', now(), 'sign', 'Late sign-ups placed',
      'Placed by the league office as depth on one-season contracts at the league minimum (Rule 2.8):');
  else
    perform public._club_batch_notices(v_season.id, 'latecomer_random', now(), 'loan', 'Late sign-ups placed',
      'Placed for the pre-season on the same terms as any loan (Rule 0.4):');
  end if;$b$, '1');

select public._splice_fn('public.distribute_unproven_rookies(boolean)',
  $a$  perform public._club_batch_notices(v_season.id, 'postdraft_random', now(), 'sign', 'Post-draft placements',
    'Placed by the league office after the draft on one-season contracts at the league minimum (Rule 2.8):');$a$,
  $b$  perform public._club_batch_notices(v_season.id, case when public.season_is_basic(v_season.id) then 'depth_random' else 'postdraft_random' end, now(), 'sign', 'Post-draft placements',
    'Placed by the league office after the draft on one-season contracts at the league minimum (Rule 2.8):');$b$, '1',
  $a$      v_skip || ' registered player(s) could not be placed — every club with room at their position is at its cap or roster limit. Place them from Pre-season central once a club has room.', 'preseason', null);$a$,
  $b$      v_skip || ' registered player(s) could not be placed — every club with room at their position is at its cap or roster limit. Place them from ' || case when public.season_is_basic(v_season.id) then 'Draft & placement' else 'Pre-season central' end || ' once a club has room.', 'preseason', null);$b$, '1');

-- Rule 2.9: with no pre-season the position-change deadline is the sign-up cutoff
create or replace function public.position_change_deadline(p_season uuid)
returns timestamp with time zone language sql stable set search_path = public as $$
  with s as (select * from public.seasons where id = p_season),
  gd as (
    select coalesce(
      (select min(g.scheduled_at at time zone 'America/New_York')::date
         from public.games g where g.season_id = p_season and g.stage = 'preseason'),
      (select (preseason_starts_at at time zone 'America/New_York')::date from s)
    ) as d
  )
  select case
    when (select format from s) = 'basic' or (select d from gd) is null then
      (select coalesce(signup_deadline_at, registration_deadline) from s)
    else
    (((select d from gd)
       - (case when ((extract(isodow from (select d from gd))::int - 2 + 7) % 7) = 0
               then 7
               else ((extract(isodow from (select d from gd))::int - 2 + 7) % 7) end) * interval '1 day'
     )::date + time '23:59') at time zone 'America/New_York'
  end;
$$;
select public._splice_fn('public.guard_position_change_deadline()',
  $a$    raise exception 'Position changes closed at 11:59 PM ET on the Tuesday before the first pre-season game (%). Your position is set for this season.',
      to_char(v_deadline at time zone 'America/New_York', 'Dy Mon FMDD');$a$,
  $b$    raise exception 'Position changes closed % (%). Your position is set for this season.',
      case when public.season_is_basic(v_season) then 'at the sign-up cutoff' else 'at 11:59 PM ET on the Tuesday before the first pre-season game' end,
      to_char(v_deadline at time zone 'America/New_York', 'Dy Mon FMDD HH12:MI AM');$b$, '1');

-- lifecycle posts say what the format actually does
select public._splice_fn('public.announce_lifecycle()',
  $a$      ' to enter the pre-season and the draft. Late sign-ups still play — they''re placed on clubs automatically after the draft.') then v_sent := v_sent + 1; end if;$a$,
  $b$      case when s.format = 'basic' then ' to enter the draft.' else ' to enter the pre-season and the draft.' end ||
      ' Late sign-ups still play — they''re placed on clubs automatically after the draft.') then v_sent := v_sent + 1; end if;$b$, '1',
  $a$  if s.preseason_starts_at is not null and s.preseason_starts_at > now()$a$,
  $b$  if s.format = 'full' and s.preseason_starts_at is not null and s.preseason_starts_at > now()$b$, '1',
  $a$'. Two game weeks, random rosters, real games — and five pre-season games played makes a player draft-eligible (Rule 2.8).')$a$,
  $b$'. Two game weeks, random rosters, real games — and three pre-season games played makes a player draft-eligible (Rule 2.8).')$b$, '1',
  $a$      'The draft starts ' || public._fmt_et(s.draft_at) || '. Fourteen rounds, live on the site. Anyone undrafted, or short of five pre-season games, is placed on a club automatically ten minutes after the draft concludes (Rule 2.8).') then v_sent := v_sent + 1; end if;$a$,
  $b$      'The draft starts ' || public._fmt_et(s.draft_at) ||
      case when s.format = 'basic'
           then '. Fifteen rounds in a snake order — even rounds run in reverse — live on the site. Anyone undrafted is placed on a club as depth ten minutes after the draft concludes (Rule 2.8).'
           else '. Fourteen rounds, live on the site. Anyone undrafted, or short of three pre-season games, is placed on a club automatically ten minutes after the draft concludes (Rule 2.8).' end) then v_sent := v_sent + 1; end if;$b$, '1',
  $a$  if s.free_agency_opens_at is not null and s.free_agency_opens_at <= now()$a$,
  $b$  if s.format = 'full' and s.free_agency_opens_at is not null and s.free_agency_opens_at <= now()$b$, '1');

-- ===================================================================
-- ===== F. Season 1 data migration (run as the commissioner; every step asserted) =====
-- 1. select public.preseason_release_loans('0f1198ee-c6e0-451b-b108-2c7b1e7b6bcc', 'Season format changed to basic — there is no pre-season');  -- 145
-- 2. delete from public.games where season_id = '0f1198ee-…' and stage = 'preseason' and status = 'scheduled';  -- 72
-- 3. update public.seasons set format='basic', roster_max=18, salary_cap=50000000, weeks=6, trade_deadline_week=4,
--      preseason_starts_at=null, offseason_starts_at=null, free_agency_opens_at=null, free_agency_closes_at=null,
--      registration_deadline='2026-09-18 03:59+00', signup_deadline_at='2026-09-18 03:59+00',
--      draft_at='2026-09-19 23:00+00', starts_at='2026-09-24 01:00+00', ends_at='2026-10-31 03:59+00', playoffs_start_at='2026-11-05 02:00+00'
--      where number = 1;
-- 4. the format guard — bound to the columns it reasons about only, so a registration flip or a
--    status change on a row that is not yet converted (Season 2) never trips it:
--    create trigger guard_season_format_trg before insert or update of format, roster_max, weeks, trade_deadline_week, preseason_starts_at
--      on public.seasons for each row execute function public.guard_season_format();
-- 4b. the depth origin (caught by the end-to-end rehearsal — the CHECK constraint did not know it):
--    alter table public.roster_spots drop constraint roster_spots_origin_check;
--    alter table public.roster_spots add constraint roster_spots_origin_check
--      check (origin = any (array['assigned','preseason_random','draft','free_agency','rookie_random','latecomer_random','contract','postdraft_random','depth_random']));
-- 5. select public.generate_draft_board(1, 15, 'as_drawn');   -- 120 picks, order NYI,VAN,PIT,DAL,SEA,BOS,UTA,DET kept, even rounds reversed
-- 6. 216 regular-season games inserted from tools/season-games.cjs (input: starts_at Wed 2026-09-23 21:00 ET, weeks 6, three nights, three slots)
-- Season 2 (a7c6a1ef-…): still to convert — see the changelog / memory note (280 full-format fixtures to clear, row to re-space, 216 games to insert).

-- ===================================================================
-- ===== F. v2.51 (2026-09-16) — the temporary player-availability layout (applied live, gated) =====
-- basic: 15 = two full lines plus three players of any position (group caps overlap; the total binds),
-- camp unlimited at 3 games/week, every active player 6 games/week, a 4-game series cap, an 18-game
-- regular-season floor for the playoffs. Keys added to format_rules: lines, flex, series_cap, playoff_min_gp.
create or replace function public.format_rules(p_format text)
returns jsonb language sql immutable as $$
  select case when p_format = 'full' then
    '{"format":"full","roster_max":17,"quota":{"F":9,"D":6,"G":2},"lines":null,"flex":null,"camp_max":3,"cap_skater":3,"cap_goalie":6,"cap_camp":3,"series_cap":null,"playoff_min_gp":0,
      "salary_cap":40000000,"weeks":8,"trade_deadline_week":6,"draft_rounds":14,"draft_snake":false,"max_contract_years":3,
      "extensions":true,"rights":true,"pick_trades":true,"preseason":true,"fa_window":true,"playoff_per_div":4,"playoff_best_of":7}'::jsonb
  else
    '{"format":"basic","roster_max":15,"quota":{"F":9,"D":7,"G":5},"lines":2,"flex":3,"camp_max":999,"cap_skater":6,"cap_goalie":6,"cap_camp":3,"series_cap":4,"playoff_min_gp":18,
      "salary_cap":50000000,"weeks":6,"trade_deadline_week":4,"draft_rounds":15,"draft_snake":true,"max_contract_years":1,
      "extensions":false,"rights":false,"pick_trades":false,"preseason":false,"fa_window":false,"playoff_per_div":3,"playoff_best_of":7}'::jsonb
  end $$;
-- helpers: series_cap(season, squad, pos) → format series_cap else weekly_cap(…,'playoff'); playoff_min_gp(season);
-- regular_gp(season, profile) = distinct final, non-voided regular-season games in game_stats.
-- guard_season_format: roster_max must equal the format's roster_max (the group caps no longer sum to it).
-- check_roster_structure: per-group caps AND total ≤ roster_max (counted rows only).
-- place_new_roster_spot: parks in camp when the group OR the total is full; camp_max 999 = unlimited.
-- set_game_lineup (playoff): refuses a player with regular_gp < playoff_min_gp (a goaltender seated after the
-- movement deadline is exempt — Rule 2.4's emergency provision) and applies series_cap in place of the weekly cap.
-- check_playoff_violations audits against series_cap. seasons.roster_max = 15 for Seasons 1 and 2.

-- ===== G. (v2.51, 2026-09-16) Rule 2.2 basic: a waived player signs at the league minimum =====
-- Applied live through execute_sql in one gated transaction (rehearsed with a rollback first).
-- offer_free_agent: after v_salary is snapped to the lattice —
--   if public.season_is_basic(v_season.id) and v_salary <> 750000 then
--     raise exception 'A waived player signs at the league minimum in the basic format — $750,000 to the end of the season (Rule 2.2).';
--   end if;
-- respond_offer ('edit' branch): after p_salary is snapped —
--   if public.season_is_basic(public.current_season_id()) and p_salary <> 750000 then
--     raise exception '… there is nothing to counter on money (Rule 2.2).';
--   end if;
-- The client mirrors it: the Free agents page is titled "Waived players" in basic, the offer
-- dialog fixes the salary at $750K with no term picker (every deal ends with the season).

-- ===== H. (v2.55, 2026-09-16) Rule 5.2: the week is counted from the box score =====
-- Applied live through execute_sql in one gated transaction (rehearsed with a rollback first).
-- public.player_week_games(p_season, p_stage, p_week, p_profile, p_exclude_game) — the games that
--   count toward a player's week: a final game WITH a box score counts by the box score (he played
--   it or he did not); every other game (still to come, or final but not yet imported) counts by
--   the lineup his club filed; voided games never count.
-- set_game_lineup: v_dressed := player_week_games(...); the cap is series_cap() for a playoff game
--   (the gate used weekly_cap = 6 there before — the 4-game series cap now applies at filing) and
--   weekly_cap() otherwise; the refusal reads "has already played or been dressed in N games this
--   week/series — the limit is C".
-- check_weekly_cap_violations() + trg_weekly_cap_violations (AFTER UPDATE OF status ON games):
--   on a regular-season final, every box-score player is checked — over the weekly count, or not
--   in the lineup his club filed, or a club that filed none — and flagged to the staff desk
--   (notify_commissioners 'flag' → transactions) with an admin-log row.

-- ---------------------------------------------------------------------------------------------
-- v2.67 (2026-09-19): the playoff eligibility floor is a season setting (seasons.playoff_min_gp,
-- overlaid by season_rules(); see sql/2026-09-19-playoff-floor-setting.sql) and the basic format's
-- default drops from 18 to 16. Applied live as a one-key splice; the literal in force is this one.
create or replace function public.format_rules(p_format text)
returns jsonb language sql immutable as $$
  select case when p_format = 'full' then
    '{"format":"full","roster_max":17,"quota":{"F":9,"D":6,"G":2},"lines":null,"flex":null,"camp_max":3,"cap_skater":3,"cap_goalie":6,"cap_camp":3,"series_cap":null,"playoff_min_gp":0,
      "salary_cap":40000000,"weeks":8,"trade_deadline_week":6,"draft_rounds":14,"draft_snake":false,"max_contract_years":3,
      "extensions":true,"rights":true,"pick_trades":true,"preseason":true,"fa_window":true,"playoff_per_div":4,"playoff_best_of":7}'::jsonb
  else
    '{"format":"basic","roster_max":15,"quota":{"F":9,"D":7,"G":5},"lines":2,"flex":3,"camp_max":999,"cap_skater":6,"cap_goalie":6,"cap_camp":3,"series_cap":4,"playoff_min_gp":16,
      "salary_cap":50000000,"weeks":6,"trade_deadline_week":4,"draft_rounds":15,"draft_snake":true,"max_contract_years":1,
      "extensions":false,"rights":false,"pick_trades":false,"preseason":false,"fa_window":false,"playoff_per_div":3,"playoff_best_of":7}'::jsonb
  end $$;

-- ---------------------------------------------------------------------------------------------
-- v2.74 (2026-09-20): min_service_gp (Rule 2.4 minimum service before a waiver or trade), basic 3,
-- full 0. Applied live as a one-key splice on each literal; the literal in force is this one.
create or replace function public.format_rules(p_format text)
returns jsonb language sql immutable as $$
  select case when p_format = 'full' then
    '{"format":"full","roster_max":17,"quota":{"F":9,"D":6,"G":2},"lines":null,"flex":null,"camp_max":3,"cap_skater":3,"cap_goalie":6,"cap_camp":3,"series_cap":null,"playoff_min_gp":0,"min_service_gp":0,
      "salary_cap":40000000,"weeks":8,"trade_deadline_week":6,"draft_rounds":14,"draft_snake":false,"max_contract_years":3,
      "extensions":true,"rights":true,"pick_trades":true,"preseason":true,"fa_window":true,"playoff_per_div":4,"playoff_best_of":7}'::jsonb
  else
    '{"format":"basic","roster_max":15,"quota":{"F":9,"D":7,"G":5},"lines":2,"flex":3,"camp_max":999,"cap_skater":6,"cap_goalie":6,"cap_camp":3,"series_cap":4,"playoff_min_gp":16,"min_service_gp":3,
      "salary_cap":50000000,"weeks":6,"trade_deadline_week":4,"draft_rounds":15,"draft_snake":true,"max_contract_years":1,
      "extensions":false,"rights":false,"pick_trades":false,"preseason":false,"fa_window":false,"playoff_per_div":3,"playoff_best_of":7}'::jsonb
  end $$;
