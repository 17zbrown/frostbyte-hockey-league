-- v4.58 (2026-11-24): the lifecycle announcements speak Season 2 in a market season.
--
-- Why. announce_lifecycle (the lifecycle-announcements job, every five minutes) still holds Season 1's copy, and Season 2
-- has five posts left to fire: reg_close_24h (Thu Dec 10, 11:59 PM ET, the night the database freeze begins), reg_closed,
-- draft_tonight, season_tonight and, through #free-agency, the free-agency pair. Their text promises what Season 2 no
-- longer does: "placed on clubs automatically after the draft", "placed on a club as depth ten minutes after the draft
-- concludes", "can take offers from any club now", "placed on one with room automatically". Several carry em dashes.
-- Commissioner, 2026-11-23 (late night), the Season 2 go-ahead: "Yes, apply them" (the list named the lifecycle copy).
-- Commissioner, 2026-11-23 (late night): #free-agency "becomes the training camp pool channel".
--
-- What changes, only when public.market_on(season) is true (Season 2 and later basic seasons; db-guards owns market_on):
--  1. reg_open: the fallback text, used only when no ann_text_<n>_reg_open override is set. The override path is kept
--     (Season 2's own override already posted and is untouched).
--  2. reg_close_24h, reg_closed, draft_tonight and season_tonight: Season 2 copy. Late and undrafted players join the
--     training camp pool; a pick whose clock runs out is filled after the draft with a random undrafted player at $750K
--     (commissioner, 2026-11-23: "A skipped draft pick will be filled with a random assignment following the end of the
--     draft", and "750k works"); the Owner and General Manager are seated before the draft; pool requests lock with the
--     night's server picks.
--  3. fa_open: the full format's free-agency post never fires in a basic season, so a market season gets its own: the
--     training camp pool notice, once, when the draft completes, through the same discord_freeagency_webhook (#free-agency).
--     No new channel key is needed.
--  4. fa_closed: in a market season it becomes the ONE automatic Discord post at the movement deadline (commissioner,
--     2026-11-23: "One automatic Discord post at the movement deadline"; main session decision, 2026-11-23: fa_closed is
--     that post), once, in #free-agency, within a day of movement_deadline_at passing (the deadline is fixed once passed,
--     v3.98). The full format's free-agency close keyed on free_agency_closes_at never fires in a market season, and
--     fa_close_6h never posts there: there is no signing window to warn about, and a second post would break the ruling.
--     No other job may post at the deadline (main session decision, 2026-11-23: the movement-deadline sweep posts nothing
--     to Discord; fa_closed is the one deadline post).
-- Every other season reads exactly the old text: each Season 1 expression stays in place as the ELSE branch, and the
-- self-checks below prove each one is still present, byte for byte.
-- Patched by exact-anchor text replacement on the live definition, each anchor asserted to match exactly once
-- (CLAUDE.md, database change protocol step 3). CREATE OR REPLACE keeps owner, grants and SECURITY DEFINER.

do $pre$
begin
  if to_regprocedure('public.market_on(uuid)') is null then
    raise exception 'v4.58: public.market_on(uuid) is missing. Apply the Season 2 draft-night guards record (db-guards) first; every new branch here calls it.';
  end if;
end $pre$;

create temp table _s2_lifecycle_patch (
  ord int primary key,
  mode text not null check (mode in ('wrap', 'before', 'after', 'replace')),
  a text not null,
  s2 text not null
) on commit drop;

insert into _s2_lifecycle_patch (ord, mode, a, s2) values
(0, 'after',
 $a$declare s record; v_sent int := 0; v_regs int; v_assigned int; v_draft_done boolean;
begin
$a$,
 $s$  /* v4.58 (commissioner, 2026-11-23, the Season 2 go-ahead: "Yes, apply them"): a market season (Season 2 on, see
     public.market_on) has no depth placement, no latecomer placement and no free agency. Undrafted and late sign-ups join
     the training camp pool, and #free-agency becomes its channel. Each post below speaks that season's rules when
     market_on is true; every other season keeps its old text, which stays in place as the ELSE branch. */
$s$),
(1, 'wrap',
 $a$'Sign-ups for ' || coalesce(s.name,'the season') || ' are live on the site. Register by ' || public._fmt_et(s.registration_deadline) ||
      ' to be draft-eligible — join later and you''ll still play, you''ll just be placed on a club automatically after the draft.'$a$,
 $s$'Sign-ups for ' || coalesce(s.name,'the season') || ' are live on the site. Register by ' || public._fmt_et(s.registration_deadline) ||
      ' to be in the draft. Anyone who signs up later still plays: they join the training camp pool after the draft, where clubs sign players at Saturday bidding and request them for game nights.'$s$),
(2, 'wrap',
 $a$'Register for ' || coalesce(s.name,'the season') || ' by ' || public._fmt_et(s.registration_deadline) ||
      case when s.format = 'basic' then ' to enter the draft.' else ' to enter the pre-season and the draft.' end ||
      ' Late sign-ups still play — they''re placed on clubs automatically after the draft.'$a$,
 $s$'Register for ' || coalesce(s.name,'the season') || ' by ' || public._fmt_et(s.registration_deadline) ||
      ' to enter the draft. Late sign-ups still play: they join the training camp pool after the draft.'$s$),
(3, 'wrap',
 $a$v_regs || ' players registered in time for ' || coalesce(s.name,'the season') ||
        '. Registration stays open — anyone joining from here is placed on a club automatically after the draft.'$a$,
 $s$v_regs || ' players registered in time for ' || coalesce(s.name,'the season') ||
        '. Registration stays open: anyone who joins from here goes into the training camp pool after the draft.'$s$),
(4, 'wrap',
 $a$'The draft starts ' || public._fmt_et(s.draft_at) ||
      case when s.format = 'basic'
           then '. ' || coalesce((select max(round) from public.draft_picks dp where dp.season_number = s.number), (public.season_rules(s.id)->>'draft_rounds')::int) || ' rounds in a snake order (even rounds run in reverse), live on the site. Anyone undrafted is placed on a club as depth ten minutes after the draft concludes (Rule 2.8).'
           else '. Fourteen rounds, live on the site. Anyone undrafted, or short of three pre-season games, is placed on a club automatically ten minutes after the draft concludes (Rule 2.8).' end$a$,
 $s$'The draft starts ' || public._fmt_et(s.draft_at) || '. ' ||
      coalesce((select max(round) from public.draft_picks dp where dp.season_number = s.number), (public.season_rules(s.id)->>'draft_rounds')::int) ||
      ' rounds in a snake order (even rounds run in reverse), live on the site. Each club''s Owner and General Manager are seated before the first pick, and the picks fill the rest of the ' ||
      (public.season_rules(s.id)->>'roster_max') || '-player roster. A pick whose clock runs out is filled after the draft with a random undrafted player who fits the club''s position needs, at $750K. Everyone else who goes undrafted joins the training camp pool.'$s$),
(5, 'wrap',
 $a$coalesce(s.name,'The season') || ' opens ' || public._fmt_et(s.starts_at) || '. Server picks lock 30 minutes before each night''s first game.'$a$,
 $s$coalesce(s.name,'The season') || ' opens ' || public._fmt_et(s.starts_at) ||
      '. Server picks lock 30 minutes before each night''s first game, and so do training camp pool requests: a club may use up to three pool players a night, and at least half of every game lineup must be the club''s own players.'$s$),
(6, 'before',
 $a$  if s.format = 'full' and s.free_agency_opens_at is not null and s.free_agency_opens_at <= now()$a$,
 $s$  /* v4.58 (commissioner, 2026-11-23: #free-agency "becomes the training camp pool channel"): a market season has no free
     agency, and the full format's free-agency post below never fires in a basic season. The training camp pool notice
     takes its key and its webhook instead, once, within a day of the draft completing (draft_state complete). */
  -- shortcut: the bidding hour (9 to 10 PM ET) and the $750K opening bid are spelled out, revisit if a season's mk keys change
  if public.market_on(s.id)
     and exists (select 1 from public.draft_state ds where ds.season_number = s.number and ds.status = 'complete'
                   and ds.updated_at > now() - interval '24 hours') then
    if public._announce_once(s.number, 'fa_open', 'discord_freeagency_webhook', 'The training camp pool is open',
      'The draft is over. Once any skipped picks are filled, every player who went undrafted, and anyone who signs up from here, is in the training camp pool. Clubs sign pool players at bidding on the Saturday of every game week, 9 to 10 PM ET, until the movement deadline; bids open at $750K. A waived player spends 24 hours on waivers and joins the pool if no club claims them. A club may also use up to three pool players on a game night, as long as at least half of each game lineup is the club''s own players.') then v_sent := v_sent + 1; end if;
  end if;

$s$),
(7, 'replace',
 $a$     and s.free_agency_closes_at <= now() + interval '6 hours' then$a$,
 $s$     and s.free_agency_closes_at <= now() + interval '6 hours'
     and not public.market_on(s.id) then  /* v4.58: a market season has no signing window, so nothing closes */$s$),
(8, 'replace',
 $a$     and s.free_agency_closes_at > now() - interval '24 hours' then$a$,
 $s$     and s.free_agency_closes_at > now() - interval '24 hours'
     and not public.market_on(s.id) then  /* v4.58: a market season's fa_closed is the movement-deadline post below */$s$),
(9, 'before',
 $a$  if s.free_agency_closes_at is not null and s.free_agency_closes_at <= now()
$a$,
 $s$  /* v4.58 (commissioner, 2026-11-23: "One automatic Discord post at the movement deadline", and #free-agency "becomes
     the training camp pool channel"): in a market season fa_closed is that one post, once, within a day of the movement
     deadline passing. movement_deadline_at is the one definition of the deadline (fixed once passed, v3.98), and null
     until the deadline week is scheduled, which posts nothing. */
  if public.market_on(s.id) and public.movement_deadline_at(s.id) <= now()
     and public.movement_deadline_at(s.id) > now() - interval '24 hours' then
    if public._announce_once(s.number, 'fa_closed', 'discord_freeagency_webhook', 'Roster movement is closed',
      'The movement deadline has passed. Waivers, claims and Saturday bidding are closed for the season. Clubs may still use up to three training camp pool players a night, with at least half of each game lineup from the club, until the regular season ends; pool players do not play in the playoffs.') then v_sent := v_sent + 1; end if;
  end if;

$s$);

-- the patch: every anchor must match the live definition exactly once at its turn, or nothing is changed
do $patch$
declare r record; v_def text; v_b text; n int;
begin
  v_def := pg_get_functiondef('public.announce_lifecycle()'::regprocedure);
  for r in select * from _s2_lifecycle_patch order by ord loop
    n := (length(v_def) - length(replace(v_def, r.a, ''))) / length(r.a);
    if n <> 1 then raise exception 'v4.58: announce_lifecycle anchor % found % times', r.ord, n; end if;
    v_b := case r.mode
             when 'wrap'   then E'case when public.market_on(s.id)\n      then ' || r.s2 || E'\n      else ' || r.a || ' end'
             when 'before' then r.s2 || r.a
             when 'after'  then r.a || r.s2
             else r.s2 end;
    v_def := replace(v_def, r.a, v_b);
  end loop;
  execute v_def;
end $patch$;

-- self-checks
do $chk$
declare r record; v_def text; v_lit text; n int;
begin
  v_def := pg_get_functiondef('public.announce_lifecycle()'::regprocedure);
  for r in select * from _s2_lifecycle_patch order by ord loop
    if position(r.s2 in v_def) = 0 then raise exception 'v4.58 check: the new text of row % is missing', r.ord; end if;
    if r.mode <> 'replace' and position(r.a in v_def) = 0 then
      raise exception 'v4.58 check: the old text of row % is gone, so another season would read different copy', r.ord;
    end if;
    /* the house writing rule, on every string literal the new copy adds: no em or en dash, no spaced hyphen. Comments are
       stripped first, since an apostrophe in a comment would pair the quotes wrongly */
    for v_lit in select m[1] from regexp_matches(regexp_replace(regexp_replace(r.s2, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g'),
                                                 '''((?:[^'']|'''')*)''', 'g') m loop
      if v_lit ~ ('[' || chr(8212) || chr(8211) || ']') or position(' - ' in v_lit) > 0 then
        raise exception 'v4.58 check: row % adds a dash in copy: %', r.ord, v_lit;
      end if;
    end loop;
  end loop;
  n := (length(v_def) - length(replace(v_def, 'public.market_on(s.id)', ''))) / length('public.market_on(s.id)');
  if n <> 9 then raise exception 'v4.58 check: % market branches, expected 9', n; end if;
  if (select prosecdef from pg_proc where oid = 'public.announce_lifecycle()'::regprocedure) is not true then
    raise exception 'v4.58 check: announce_lifecycle lost SECURITY DEFINER';
  end if;
  if public.market_on((select id from public.seasons where number = 1)) then
    raise exception 'v4.58 check: Season 1 reads as a market season, so its copy would change';
  end if;
  if not public.market_on((select id from public.seasons where number = 2)) then
    raise exception 'v4.58 check: Season 2 is not a market season yet (db-guards first), so none of this would fire for it';
  end if;
  if not exists (select 1 from public.app_config where key = 'discord_freeagency_webhook') then
    raise exception 'v4.58 check: discord_freeagency_webhook is not configured, so the pool notice would fall back to the default channel';
  end if;
end $chk$;
