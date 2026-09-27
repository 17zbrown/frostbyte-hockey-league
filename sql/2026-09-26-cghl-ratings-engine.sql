-- v3.49: overall ratings rebuilt on CGHL league play alone
-- 2026-09-26
--
-- Commissioner: "Actually use https://chelstats.app/ to calculate overalls in our league" and then
-- "Rate the league's players only based on their CGHL league play. Come up with your most fair
-- formulas for calculations based on these variables in this page.
-- https://chelstats.app/overall-ratings", and during the build: "remember to still not give a full
-- rating until 5+ games played. Players with 4 or less games played should still be more skewed
-- towards 70 until you can get more data for an accurate ranking."
--
-- WHAT CHELSTATS PUBLISHES, AND WHAT IT DOES NOT
--
-- Their page gives the variables and the category structure: SHOOTING, PASSING, HANDEYE,
-- PHYSICALITY and DEFENSE for skaters, REFLEXES, CONSISTENCY and CLUTCHNESS for goaltenders, with a
-- per-position weight table (Wingers, Centers, Defense). It says "each stat is multiplied by its
-- corresponding weight to calculate a category score. The score is then scaled with an exponential
-- function to produce a rating between 50-99. The overall rating is the average of all category
-- ratings." The exponential's constants are not published, and their API requires a login, which was
-- not attempted. Their ratings are career-wide across all EASHL play; ours are CGHL box scores only.
--
-- Of their 33 inputs EA sends 28. Dekes, offsides and fights won are absent from the EA payload
-- entirely. Three goalie inputs EA sends but we had never stored (diving saves, shutout periods,
-- penalty-shot saves and shots) were added to game_stats and backfilled from archived payloads:
-- all 30 final games had payloads, 60 of 60 goalie lines filled.
--
-- WHAT IS THEIRS AND WHAT IS OURS. Stated plainly because every player's number changed.
--
--   theirs: the variables, the category structure, the position groups, and the ideas of blended
--           position weighting, confidence weighting on thin percentages, and never punishing a
--           small sample.
--   ours:   standardizing every stat against the league before weighting it; the weights within each
--           category; the composite; the 50 to 99 curve and its constants; the five-game confidence
--           rule; the coverage discount.
--
-- WHY THEIR WEIGHTS COULD NOT BE REUSED AS PUBLISHED. Their weights multiply RAW values on
-- incompatible units. Inside SHOOTING a winger's shooting percentage (0 to 100) times 1.20 contributed
-- about 46 of Scorezov's 66 raw points; his 3.67 goals per game times 0.28 contributed 1.03. The
-- league's leading scorer by a factor of four barely moved his own shooting number. Once every stat
-- is a standard score the same table weights efficiency 4.3 times production, and he rated tenth.
-- So the weights are ours, designed for standardized inputs, with production leading every category.
--
-- THE ENGINE, in order
--
--   1. cghl_rates(profile): per-game rates and percentages WITH their attempt counts, and games by
--      position (gp_w, gp_c, gp_d, gp_g), from final regular-season and playoff games only.
--   2. cghl_group: W, C, D or G by the games actually played, not the listed position.
--   3. refresh_rating_norms, PASS 1: for every stat and position, the league's median, spread and
--      coverage. A position with fewer than 12 players on a stat borrows the whole skater population.
--   4. cghl_categories: each stat's standard score, times its weight, times the coverage factor,
--      blended across the positions the player skated, divided by the total weight.
--   5. PASS 2: each category's median and spread per position.
--   6. cghl_composite: 0.88 of the weighted mean of the category standard scores plus 0.12 of the
--      best one. PASS 3: the composite's median and spread per position.
--   7. cghl_overall: the composite's standard score, times the games confidence, through cghl_curve.
--      Every category rating goes through the same curve with the same confidence.
--
-- THE CURVE (ours):  rating = 50 + 49 / (1 + exp(-(z - 0.372))),  z clamped to [-3.5, 4]
--   median (z=0) -> 70,  90th percentile (z=1.2816) -> 85,  z=1.93 -> 90,  z=2.9 -> 95,  z=4 -> 97.7
--
-- THE CONFIDENCE RULE (the commissioner's, 2026-09-26):
--   games 1..4:  0.12 * gp        (.12 .24 .36 .48)
--   games 5+:    gp / (gp + 1.5)  (5 -> .77, 6 -> .80, 10 -> .87, 18 -> .92)
--   It multiplies the STANDARD SCORE, so it pulls a big number down and a poor one up alike: nobody
--   is punished for having played little. The fifth game is a real step, by instruction.
--
-- FOUR DEFECTS FOUND AND FIXED DURING CALIBRATION, each visible in the numbers before it was fixed
--
--   a. A stat where most of a position sits on zero (a defenseman's goals per game) has a median
--      absolute deviation of exactly zero, so the spread hit the 0.01 floor and any nonzero value
--      slammed into the clamp. FIX: the spread is the wider of the MAD and the median-to-p90 gap,
--      and only when both are zero does it fall back to the median-to-p99 gap (cghl_spread).
--   b. That p99 reading, taken as a co-equal maximum, was self-limiting: the league's best player
--      set the top of the distribution, so the spread measuring him was derived from his own number.
--      Scorezov, 22 goals in 6 games against a median near half a goal, scored z = 2.30. FIX: p99 is
--      a fallback only. His goals per game now sit at the clamp.
--   c. Fewer than 3 percent of defensemen ever record a deflection, so one deflection in three games
--      read as sixteen standard deviations, and deflections carried 1.60 of a defenseman's HANDEYE.
--      Kaz Kanada, 0 goals and 2 assists in 3 games, rated 89 and sixth in the league. FIX: a stat
--      fewer than 15 percent of the position records is discounted in proportion (cghl_cover_factor,
--      knee at 0.15). Above the knee it counts in full, so a defenseman's goals (19 percent) keep
--      full weight: rarity that IS the point must not be read as noise. Kaz Kanada is 69.
--   d. The overall as an average of the categories put the whole league inside 63 to 80. Almost
--      nobody is excellent at all five things. FIX: the composite is scored against its own
--      distribution (PASS 3), so the overall is shaped like a rating, not like an average.
--
-- BEFORE AND AFTER, the same 104 rated players
--   league average       69.3 -> 70.6
--   range                44 to 93 -> 58 to 85
--   at 80 or better      27 -> 3
--   at 85 or better      10 -> 1
--   at 90 or better       1 -> 0      (the fifth-game rule and the 6-game season; 90 needs z 1.93
--                                      at full confidence, and confidence is .80 at six games)
--   position medians     all four sit on 70 by construction; means 70.2 to 71.4. No position is
--                        advantaged, which a per-position scale is for.
--   the leading scorer   Scorezov, 22 G 33 P in 6: 82 -> 79, Shooting 89, Passing 68 (51.9 percent
--                        completion against a 74.4 median, 15 giveaways a game). Sixth, was tenth
--                        under the first draft of this engine.
--   the complaint of v3.48   Saqoy, 19 P in 4: 87 -> 79.  Ferdzyyyyyyyyyyyy, .885 in 3: 84 -> 75.
--   the top              biz, D, 7 G 7 A +14 in 4 games, 85 (Shooting 92), then two goaltenders at
--                        81 with five and three appearances.
--
-- COUNT WHAT CHANGED, NEVER WHAT YOU ATTEMPTED (v3.47's lesson, applied). guard_profile_role reverts
-- an overall write in silence unless is_commissioner() or trusted_writer(). The apply below asserts
-- commissioner claims first and raises if no row actually moved.
--
-- THE SWITCH-OVER. overall_breakdown(uuid, text) keeps its name and output contract (gp, overall,
-- category, components[], provisional; plus categories and confidence), so compute_overall,
-- compute_overall_cat, refresh_player_overall and all three triggers keep working. _ovr_curve has no
-- caller left and is dropped. trg_game_final_overall now refreshes the norms and re-rates everyone
-- with a league game, because a final moves the distribution every rating is measured against:
-- 882 ms for the norms, 449 ms for 104 players, 1.33 s per final, three finals a night.
--
-- CLIENT. CG.OVR_SETTLE_GP 3 -> 5 (mirror of cghl_settle_gp). The Rating breakdown card on a player's
-- profile had rendered Object.keys(r.parts) and in LIVE_MODE parts is {}, so it had been EMPTY since
-- launch. It now fetches player_rating in CG.AFTER.player and paints the category bars in place.
-- Every piece of copy that said three games says five, and says what the number is.
--
-- RULEBOOK. Rule 6.1 gains a paragraph stating what a rating is and what it is built from, never the
-- formula. Rule 0.4's "Overall ratings are compiled from regular-season play" was already true.
--
-- Test: tools/cghl-ratings.test.cjs (arithmetic twins of the curve, the confidence rule and the
-- coverage knee, plus the shipped client, the book and this record).

begin;

-- ---------------------------------------------------------------------------------------------
-- storage
-- ---------------------------------------------------------------------------------------------
alter table public.game_stats
  add column if not exists diving_saves int,
  add column if not exists shutout_periods int,
  add column if not exists pen_shot_saves int,
  add column if not exists pen_shots_against int;
-- backfilled from ea_match_archive payloads: 60/60 goalie lines (22 diving saves, 53 shutout periods,
-- 3 penalty shots); the ingest path stores them for every game from here on.

create table if not exists public.rating_norms (
  kind   text not null,          -- 'stat' | 'cat' | 'comp'
  key    text not null,          -- stat, category, or 'OVERALL'
  pos    text not null,          -- 'W' | 'C' | 'D' | 'G'
  center numeric not null,
  spread numeric not null default 1,
  n      int not null default 0,
  cover  numeric not null default 1,
  updated_at timestamptz not null default now(),
  primary key (kind, key, pos)
);
alter table public.rating_norms enable row level security;
drop policy if exists rating_norms_read on public.rating_norms;
create policy rating_norms_read on public.rating_norms for select using (true);
grant select on public.rating_norms to anon, authenticated;
comment on table public.rating_norms is
 'v3.49: the league''s own distribution, which is what a CGHL rating is measured against. kind=stat holds a stat''s median, spread and coverage per position; kind=cat a category''s; kind=comp the composite''s. Refreshed by refresh_rating_norms() on every final.';
comment on column public.rating_norms.cover is
 'v3.49: how much of this position actually records the stat (the share whose value differs from the median). A stat 90% of defensemen never record carries almost no information about the ones who do, at these sample sizes, so its weight inside a category is scaled by cghl_cover_factor(cover).';

alter table public.player_position_overalls add column if not exists categories jsonb;

-- ---------------------------------------------------------------------------------------------
-- constants and small helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.cghl_settle_gp() returns int
 language sql immutable as $fn$ select 5 $fn$;

/* A rating is not fully earned until the fifth game. Below that it stays pulled toward the league
   average: four games or fewer is not enough to tell a hot start from a good player. Commissioner's
   instruction, 2026-09-26. Because confidence shrinks the STANDARD SCORE toward zero rather than
   capping the rating, it pulls a big number down and a poor one up in equal measure. */
create or replace function public.cghl_confidence(p_gp numeric)
 returns numeric language sql immutable set search_path to 'public' as $fn$
  select case
    when coalesce(p_gp,0) <= 0 then 0
    when p_gp < public.cghl_settle_gp() then 0.12 * p_gp     -- 1 game .12, 2 .24, 3 .36, 4 .48
    else p_gp / (p_gp + 1.5)                                  -- 5 games .77, 6 .80, 10 .87, 18 .92
  end;
$fn$;

/* A percentage on few attempts is not evidence. Shrink it toward the league's neutral value by
   n/(n+k): at k attempts it is half-believed, and it converges on the raw figure as the sample grows. */
create or replace function public.cghl_conf(p_pct numeric, p_n numeric, p_k numeric, p_neutral numeric)
 returns numeric language sql immutable set search_path to 'public' as $fn$
  select case
    when p_pct is null or coalesce(p_n,0) <= 0 then p_neutral
    else p_neutral + (p_pct - p_neutral) * (p_n::numeric / (p_n + p_k))
  end;
$fn$;

/* Coverage is a rescue, not a reweighting. A stat fewer than 15% of the position ever records tells
   us almost nothing about the ones who do at this sample size, and is discounted in proportion.
   Above that line it counts in full. */
create or replace function public.cghl_cover_factor(p_cover numeric)
 returns numeric language sql immutable as $fn$
  select least(1, greatest(0, coalesce(p_cover,1)) / 0.15);
$fn$;

/* The 50 to 99 curve, one definition. A logistic on the standard score, offset so the league median
   lands on 70:  median (z=0) -> 70,  p90 (z=1.28) -> 85,  z=1.93 -> 90,  z=2.9 -> 95. */
create or replace function public.cghl_curve(p_z numeric)
 returns numeric language sql immutable set search_path to 'public' as $fn$
  select case when p_z is null then null else
    least(99, greatest(50,
      50 + 49 / (1 + exp(-(greatest(-3.5, least(4, p_z)) - 0.372)))))
  end;
$fn$;

/* A stat's spread: the wider of the MAD and the median-to-p90 gap; the median-to-p99 gap ONLY when
   both are zero (a point mass at the median). Taken as a maximum the p99 term was self-limiting:
   the league's runaway scorer set the top of the distribution and could never rate far above it. */
create or replace function public.cghl_spread(p_mad numeric, p_med numeric, p_p90 numeric, p_p99 numeric)
 returns numeric language sql immutable as $fn$
  select greatest(
    case when greatest(1.4826 * coalesce(p_mad,0), (coalesce(p_p90,p_med) - p_med) / 1.2816) > 0.001
         then greatest(1.4826 * coalesce(p_mad,0), (coalesce(p_p90,p_med) - p_med) / 1.2816)
         else (coalesce(p_p99,p_med) - p_med) / 2.3263 end,
    0.02);
$fn$;

/* Which population a player is measured against, by the games he actually played. */
create or replace function public.cghl_group(p_rates jsonb)
 returns text language sql immutable set search_path to 'public' as $fn$
  select case
    when coalesce((p_rates->>'gp_g')::int,0) > 0 then 'G'
    when coalesce((p_rates->>'gp_d')::int,0) >= coalesce((p_rates->>'gp_c')::int,0)
     and coalesce((p_rates->>'gp_d')::int,0) >= coalesce((p_rates->>'gp_w')::int,0) then 'D'
    when coalesce((p_rates->>'gp_c')::int,0) >= coalesce((p_rates->>'gp_w')::int,0) then 'C'
    else 'W' end;
$fn$;

create or replace function public.cghl_cat_label(p_cat text)
 returns text language sql immutable as $fn$
  select case p_cat
    when 'SHOOTING' then 'Shooting' when 'PASSING' then 'Passing'
    when 'HANDEYE' then 'Hand-eye' when 'PHYSICALITY' then 'Physicality'
    when 'DEFENSE' then 'Defense'  when 'REFLEXES' then 'Reflexes'
    when 'CONSISTENCY' then 'Consistency' when 'CLUTCHNESS' then 'Clutchness'
    else initcap(lower(p_cat)) end;
$fn$;

create or replace function public.cghl_norm(p_kind text, p_key text, p_pos text, p_default numeric default 0)
 returns numeric language sql stable set search_path to 'public' as $fn$
  select coalesce(
    (select center from public.rating_norms where kind=p_kind and key=p_key and pos=p_pos),
    (select center from public.rating_norms where kind=p_kind and key=p_key and pos='*'),
    p_default);
$fn$;

-- ---------------------------------------------------------------------------------------------
-- the tables of the design: what is read, how it is weighted
-- ---------------------------------------------------------------------------------------------
/* Every stat a rating reads: the attempt count that makes its percentage believable, the confidence
   constant k, and the sample a player needs before he counts toward the league's own distribution. */
create or replace function public.cghl_stat_meta()
 returns table(stat text, nkey text, conf_k numeric, min_n numeric, grp_kind text)
 language sql immutable set search_path to 'public' as $fn$
  select * from (values
    ('gpg',null,null,1,'S'),('apg',null,null,1,'S'),('spg',null,null,1,'S'),
    ('passpg',null,null,1,'S'),('saucpg',null,null,1,'S'),('gvpg',null,null,1,'S'),
    ('deflpg',null,null,1,'S'),('posspm',null,null,1,'S'),('hitpg',null,null,1,'S'),
    ('pimpg',null,null,1,'S'),('drawnpg',null,null,1,'S'),('intpg',null,null,1,'S'),
    ('blkpg',null,null,1,'S'),('tkpg',null,null,1,'S'),('pmpg',null,null,1,'S'),
    ('shotpct','shot_n',15,10,'S'),('onnetpct','onnet_n',20,10,'S'),
    ('passpct','pass_n',50,20,'S'),('fopct','fo_n',20,10,'S'),
    ('svpg',null,null,1,'G'),('dsvpg',null,null,1,'G'),('pokepg',null,null,1,'G'),
    ('sopg',null,null,1,'G'),('soppg',null,null,1,'G'),('gaa',null,null,1,'G'),
    ('savepct','save_n',60,20,'G'),('brkpct','brk_n',5,2,'G'),('penpct','pen_n',3,1,'G')
  ) v(stat,nkey,conf_k,min_n,grp_kind);
$fn$;

/* Our weights, for standardized scores. The variables and the categories are chelstats'; the
   balance within each category is ours, and production leads it. Dekes, offsides and fights won are
   absent because EA does not report them at all. */
create or replace function public.cghl_stat_weights()
 returns table(cat text, stat text, w_w numeric, w_c numeric, w_d numeric, w_g numeric)
 language sql immutable set search_path to 'public' as $fn$
  select * from (values
    ('SHOOTING','gpg',1.20,1.20,1.10,0),('SHOOTING','shotpct',0.55,0.55,0.45,0),
    ('SHOOTING','onnetpct',0.25,0.25,0.30,0),('SHOOTING','spg',0.15,0.15,0.25,0),
    ('PASSING','apg',1.10,1.15,1.00,0),('PASSING','passpct',0.45,0.45,0.50,0),
    ('PASSING','passpg',0.12,0.15,0.15,0),('PASSING','saucpg',0.10,0.08,0.20,0),
    ('PASSING','gvpg',-0.25,-0.25,-0.30,0),
    ('HANDEYE','fopct',0.70,0.90,0.30,0),('HANDEYE','deflpg',0.60,0.50,0.90,0),
    ('HANDEYE','posspm',0.50,0.50,0.50,0),
    ('PHYSICALITY','hitpg',0.70,0.70,0.85,0),('PHYSICALITY','pimpg',-0.35,-0.35,-0.35,0),
    ('PHYSICALITY','drawnpg',0.70,0.70,0.60,0),
    ('DEFENSE','intpg',0.60,0.60,0.60,0),('DEFENSE','blkpg',0.50,0.50,0.60,0),
    ('DEFENSE','tkpg',0.55,0.50,0.55,0),('DEFENSE','pmpg',0.50,0.50,0.55,0),
    ('REFLEXES','dsvpg',0,0,0,0.60),('REFLEXES','pokepg',0,0,0,0.30),
    ('REFLEXES','svpg',0,0,0,0.50),
    ('CONSISTENCY','savepct',0,0,0,1.20),('CONSISTENCY','gaa',0,0,0,-0.80),
    ('CLUTCHNESS','sopg',0,0,0,1.00),('CLUTCHNESS','soppg',0,0,0,0.60),
    ('CLUTCHNESS','brkpct',0,0,0,0.50),('CLUTCHNESS','penpct',0,0,0,0.35)
  ) v(cat,stat,w_w,w_c,w_d,w_g);
$fn$;

/* How much each category decides the overall. chelstats publishes an unweighted average, which
   rates a shutdown defenseman by his shooting as heavily as by his defending. */
create or replace function public.cghl_cat_weights()
 returns table(grp text, cat text, w numeric)
 language sql immutable set search_path to 'public' as $fn$
  select * from (values
    ('W','SHOOTING',0.28),('W','PASSING',0.26),('W','DEFENSE',0.20),('W','HANDEYE',0.16),('W','PHYSICALITY',0.10),
    ('C','SHOOTING',0.26),('C','PASSING',0.28),('C','DEFENSE',0.20),('C','HANDEYE',0.16),('C','PHYSICALITY',0.10),
    ('D','DEFENSE',0.32),('D','PASSING',0.24),('D','SHOOTING',0.16),('D','HANDEYE',0.16),('D','PHYSICALITY',0.12),
    ('G','CONSISTENCY',0.46),('G','REFLEXES',0.34),('G','CLUTCHNESS',0.20)
  ) v(grp,cat,w);
$fn$;

-- ---------------------------------------------------------------------------------------------
-- the engine
-- ---------------------------------------------------------------------------------------------
/* CGHL league play only: final regular-season and playoff games, not voided. Percentages carry
   their attempt counts so the caller can weight by confidence. */
create or replace function public.cghl_rates(p_profile uuid)
 returns jsonb language sql stable security definer set search_path to 'public' as $fn$
  with s as (
    select gs.*, gm.season_id as sid
    from public.game_stats gs
    join public.games gm on gm.id = gs.game_id
    where gs.profile_id = p_profile
      and gm.status = 'final' and not coalesce(gm.voided,false)
      and gm.stage in ('regular','playoff')          -- CGHL league play only
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
    'gp', gp, 'gp_g', gp_g, 'gp_c', gp_c, 'gp_d', gp_d, 'gp_w', gp_w,
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

/* Every stat as a standard score against the league, in one lookup (a diagnostic view of what
   cghl_categories does inline). */
create or replace function public.cghl_zmap(p_rates jsonb, p_grp text)
 returns jsonb language sql stable set search_path to 'public' as $fn$
  select coalesce(jsonb_object_agg(m.stat, q.z), '{}'::jsonb)
  from public.cghl_stat_meta() m
  join public.rating_norms n on n.kind='stat' and n.key=m.stat and n.pos=p_grp
  cross join lateral (select greatest(-3.5, least(4, (
      coalesce(case when m.nkey is null then (p_rates->>m.stat)::numeric
        else public.cghl_conf((p_rates->>m.stat)::numeric, (p_rates->>m.nkey)::numeric,
                              m.conf_k, n.center) end, n.center)
      - n.center) / n.spread)) z) q
  where m.grp_kind = case when p_grp = 'G' then 'G' else 'S' end;
$fn$;

/* A category score: our weights applied to standard scores, blended across the positions a player
   actually played, each weight scaled by how much of the position records that stat, divided by
   the total weight so every category lands on one scale. */
create or replace function public.cghl_categories(p_profile uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare r jsonb; g text; sk numeric; out jsonb;
begin
  r := public.cghl_rates(p_profile);
  if r is null or coalesce((r->>'gp')::int,0) = 0 then return null; end if;
  g := public.cghl_group(r);
  sk := nullif(coalesce((r->>'gp_w')::numeric,0) + coalesce((r->>'gp_c')::numeric,0)
             + coalesce((r->>'gp_d')::numeric,0), 0);

  select jsonb_object_agg(cat, val) into out from (
    select w.cat, sum(e.eff * cf.f * q.z) / nullif(sum(abs(e.eff * cf.f)),0) val
    from public.cghl_stat_weights() w
    join public.cghl_stat_meta() m on m.stat = w.stat
    join public.rating_norms n on n.kind='stat' and n.key=w.stat and n.pos=g
    cross join lateral (select public.cghl_cover_factor(n.cover) f) cf
    cross join lateral (select case when g = 'G' then w.w_g
      else (coalesce((r->>'gp_w')::numeric,0)*w.w_w + coalesce((r->>'gp_c')::numeric,0)*w.w_c
          + coalesce((r->>'gp_d')::numeric,0)*w.w_d) / sk end eff) e
    cross join lateral (select greatest(-3.5, least(4, (
        coalesce(case when m.nkey is null then (r->>m.stat)::numeric
          else public.cghl_conf((r->>m.stat)::numeric, (r->>m.nkey)::numeric,
                                m.conf_k, n.center) end, n.center)
        - n.center) / n.spread)) z) q
    where e.eff <> 0 and cf.f > 0
    group by w.cat
  ) s;
  if out is null then return null; end if;
  return out || jsonb_build_object('kind', case when g='G' then 'G' else 'S' end, 'grp', g);
end $fn$;

create or replace function public.cghl_catz(p_profile uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare c jsonb; g text; out jsonb;
begin
  c := public.cghl_categories(p_profile);
  if c is null then return null; end if;
  g := c->>'grp';
  select jsonb_object_agg(w.cat, q.z) into out
  from public.cghl_cat_weights() w
  join public.rating_norms n on n.kind='cat' and n.key=w.cat and n.pos=g
  cross join lateral (select greatest(-3.5, least(4,
    ((c->>w.cat)::numeric - n.center) / n.spread)) z) q
  where w.grp = g and (c->>w.cat) is not null;
  if out is null then return null; end if;
  return out || jsonb_build_object('grp', g);
end $fn$;

/* One composite per player, before it is put on a scale: mostly the weighted average of his
   categories, plus a small share of his best one. A league's most dangerous scorer should not read
   as average because he is average at four other things. */
create or replace function public.cghl_composite(p_catz jsonb, p_grp text)
 returns numeric language sql immutable set search_path to 'public' as $fn$
  select 0.88 * sum(w.w * (p_catz->>w.cat)::numeric) / nullif(sum(w.w),0)
       + 0.12 * max((p_catz->>w.cat)::numeric)
  from public.cghl_cat_weights() w
  where w.grp = p_grp and p_catz ? w.cat;
$fn$;

/* A player's full rating: every category on the 50 to 99 scale, and one overall on the same scale,
   the composite scored against its own distribution. */
create or replace function public.cghl_overall(p_profile uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare z jsonb; g text; gp numeric; conf numeric; comp numeric; cz numeric; out jsonb; n record;
begin
  z := public.cghl_catz(p_profile);
  if z is null then return null; end if;
  g := z->>'grp';
  select coalesce((public.cghl_rates(p_profile)->>'gp')::numeric,0) into gp;
  if gp <= 0 then return null; end if;
  conf := public.cghl_confidence(gp);

  comp := public.cghl_composite(z, g);
  select center, spread into n from public.rating_norms
   where kind='comp' and key='OVERALL' and pos=g;
  if n is null or comp is null then return null; end if;
  cz := (comp - n.center) / n.spread;

  select jsonb_object_agg(w.cat, round(public.cghl_curve((z->>w.cat)::numeric * conf))) into out
  from public.cghl_cat_weights() w where w.grp = g and z ? w.cat;

  return jsonb_build_object(
    'grp', g, 'gp', gp, 'categories', out, 'z', round(cz, 3),
    'confidence', round(conf, 3), 'settled', gp >= public.cghl_settle_gp(),
    'overall', round(public.cghl_curve(cz * conf))::int);
end $fn$;

-- ---------------------------------------------------------------------------------------------
-- the league's distribution: three passes
-- ---------------------------------------------------------------------------------------------
create or replace function public.refresh_rating_norms()
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_stats int; v_cats int; v_comp int;
begin
  if not (public.is_commissioner() or public.trusted_writer()) then
    raise exception 'refresh_rating_norms: league office only';
  end if;

  drop table if exists _r, _sv, _v, _cz;
  create temp table _r on commit drop as
    select p.id, public.cghl_rates(p.id) r from public.profiles p;
  delete from _r where r is null or (r->>'gp')::int = 0;
  alter table _r add column grp text;
  update _r set grp = public.cghl_group(r);

  create temp table _sv on commit drop as
    select m.stat, x.grp, (x.r->>m.stat)::numeric v
    from _r x join public.cghl_stat_meta() m
      on m.grp_kind = case when x.grp='G' then 'G' else 'S' end
    where (x.r->>m.stat) is not null
      and case when m.nkey is null then (x.r->>'gp')::numeric
               else coalesce((x.r->>m.nkey)::numeric,0) end >= m.min_n;

  /* PASS 1: every stat's centre, spread and coverage, per position. A position with fewer than 12
     players on record borrows the whole skater population: a distribution measured on four people is
     not a distribution. */
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

  /* PASS 2: each category's centre and spread, per position. No 99th-percentile fallback needed: a
     category score is a continuous blend with no point mass to rescue. */
  create temp table _v on commit drop as
    select e.key, x.grp, (e.value)::text::numeric v
    from (select id, grp, public.cghl_categories(id) c from _r) x, jsonb_each(x.c) e
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

  /* PASS 3: the composite's own centre and spread, so the overall is shaped like a rating instead of
     inheriting the flatness of an average of categories. */
  create temp table _cz on commit drop as
    select x.id, z->>'grp' grp, public.cghl_composite(z, z->>'grp') v
    from _r x, lateral (select public.cghl_catz(x.id) z) q where z is not null;
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
    'players', (select count(*) from _r), 'by_pos',
    (select jsonb_object_agg(grp, c) from (select grp, count(*) c from _r group by grp) z));
end $fn$;

-- ---------------------------------------------------------------------------------------------
-- the switch-over: same entry points, new engine underneath
-- ---------------------------------------------------------------------------------------------
create or replace function public.overall_breakdown(p_profile uuid, p_cat text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare o jsonb; comps jsonb;
begin
  o := public.cghl_overall(p_profile);
  if o is null then
    return jsonb_build_object('gp', 0, 'overall', 70, 'category', coalesce(p_cat,'W'),
      'components', '[]'::jsonb, 'provisional', true, 'categories', '{}'::jsonb);
  end if;

  select jsonb_agg(jsonb_build_object(
           'key', lower(w.cat), 'label', public.cghl_cat_label(w.cat),
           'score', (o->'categories'->>w.cat)::int, 'value', (o->'categories'->>w.cat)::int,
           'suffix', '', 'weight', w.w) order by w.w desc, w.cat)
    into comps
  from public.cghl_cat_weights() w
  where w.grp = o->>'grp' and (o->'categories') ? w.cat;

  return jsonb_build_object(
    'gp', (o->>'gp')::int, 'overall', (o->>'overall')::int, 'category', o->>'grp',
    'components', coalesce(comps,'[]'::jsonb), 'categories', o->'categories',
    'confidence', (o->>'confidence')::numeric,
    'provisional', not (o->>'settled')::boolean);
end $fn$;

create or replace function public.refresh_player_overall(p_profile uuid)
 returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_cat text; v_bd jsonb; v_ov int; v_gp int;
begin
  if p_profile is null then return; end if;
  v_cat := public.current_pos_cat(p_profile);
  v_bd := public.overall_breakdown(p_profile, v_cat);
  v_ov := (v_bd->>'overall')::int; v_gp := (v_bd->>'gp')::int;
  update public.profiles set overall=v_ov where id=p_profile;
  insert into public.player_position_overalls(profile_id,pos_cat,overall,gp,categories,updated_at)
    values(p_profile, coalesce(v_bd->>'category', v_cat), v_ov, v_gp, v_bd->'categories', now())
    on conflict (profile_id,pos_cat) do update
      set overall=excluded.overall, gp=excluded.gp,
          categories=excluded.categories, updated_at=now();
end;$fn$;

/* The public face of a rating, for the profile page's breakdown card. Reads stats only. */
create or replace function public.player_rating(p_profile uuid)
 returns jsonb language sql stable security definer set search_path to 'public' as $fn$
  select public.overall_breakdown(p_profile, public.current_pos_cat(p_profile));
$fn$;

/* A final changes the league's distribution, and every rating is measured against that
   distribution, so a final re-rates everyone with a league game, not only the players in it. */
create or replace function public.trg_game_final_overall()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare r record;
begin
  if new.status='final'::game_status and (old.status is distinct from new.status) then
    perform set_config('app.role_grant','on',true);
    perform public.refresh_rating_norms();
    for r in select distinct gs.profile_id as pid from public.game_stats gs
             join public.games gm on gm.id = gs.game_id
             where gm.status = 'final' and gm.stage in ('regular','playoff')
               and gs.profile_id is not null loop
      perform public.refresh_player_overall(r.pid);
    end loop;
  end if;
  return null;
end;$fn$;

drop function if exists public._ovr_curve(numeric);   -- no caller left

-- ---------------------------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------------------------
grant execute on function public.cghl_settle_gp(), public.cghl_confidence(numeric),
  public.cghl_conf(numeric,numeric,numeric,numeric), public.cghl_cover_factor(numeric),
  public.cghl_curve(numeric), public.cghl_spread(numeric,numeric,numeric,numeric),
  public.cghl_group(jsonb), public.cghl_cat_label(text), public.cghl_norm(text,text,text,numeric),
  public.cghl_stat_meta(), public.cghl_stat_weights(), public.cghl_cat_weights(),
  public.cghl_rates(uuid), public.cghl_zmap(jsonb,text), public.cghl_categories(uuid),
  public.cghl_catz(uuid), public.cghl_composite(jsonb,text), public.cghl_overall(uuid),
  public.player_rating(uuid)
  to anon, authenticated, service_role;
revoke all on function public.refresh_rating_norms() from public;
grant execute on function public.refresh_rating_norms() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- apply: count what changed, never what you attempted
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims','{"sub":"fa5f47dc-5380-4965-9258-82ed954b6fa7","role":"authenticated"}',true);
do $apply$
declare v_changed int; v_total int;
begin
  if not public.is_commissioner() then raise exception 'not running as commissioner'; end if;
  create temp table _old on commit drop as select id, overall from public.profiles;
  perform public.refresh_rating_norms();
  perform public.refresh_player_overall(x.pid) from (
    select distinct gs.profile_id pid from public.game_stats gs join public.games gm on gm.id=gs.game_id
    where gm.status='final' and gm.stage in ('regular','playoff') and gs.profile_id is not null) x;
  select count(*) filter (where p.overall <> o.overall), count(*) into v_changed, v_total
    from public.profiles p join _old o on o.id = p.id;
  if v_changed = 0 then raise exception 'refresh changed NOTHING: guard_profile_role reverted the writes'; end if;
  raise notice 'rated % profiles, % changed', v_total, v_changed;
end $apply$;

commit;

-- verification, as run after the apply
--   104 players, average 70.6, range 58 to 85, 3 at 80+, 1 at 85+, 0 at 90+
--   position medians W 70, C 70, D 70, G 70
--   top six: biz D 4gp 85 | lxlbmac24lxl G 3gp 81 | the16thgunner G 5gp 81 | Kxrpov- D 6gp 79 |
--            natsubi87 C 6gp 79 | Scorezov W 6gp 79
--   trigger path: norms 882 ms, 104 players re-rated in 449 ms, 1330 ms per final
