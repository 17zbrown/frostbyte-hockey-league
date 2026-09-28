-- v3.51 (part 3 of the suspension overhaul): the locks.
--
-- Commissioner, 2026-09-28: "Lock a player in the team HQ by graying them out and locking them while
-- they are suspended. If they are suspended they cannot be moved between the roster and training
-- camp as punishment to the team." And (Q7): a suspended member "is not allowed to be claimed".
--
-- Before v3.51 the only thing between a suspended player and a lineup was the browser: set_game_lineup
-- checked whether the MANAGER filing the sheet was suspended, never the six players on it, and the
-- one trigger that checked players sat on the legacy lineups table, which holds no rows.

/* The lineup and line tables refuse a suspended player in any slot that changes. Guarding the TABLE
   covers set_game_lineup, set_team_line and anything added later. Only a slot being filled is
   checked, so clearing a slot (or a trigger emptying one) is never refused because a different,
   untouched slot holds somebody. */
create or replace function public.guard_lineup_suspended()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v uuid; v_gt text;
begin
  foreach v in array array[new.center, new.lw, new.rw, new.ld, new.rd, new.goalie] loop
    if v is null then continue; end if;
    if tg_op = 'UPDATE' and v in (old.center, old.lw, old.rw, old.ld, old.rd, old.goalie) then continue; end if;
    if public.is_suspended(v) then
      select coalesce(gamertag, display_name, 'That player') into v_gt from public.profiles where id = v;
      raise exception '% is suspended and cannot be scheduled until it is served (Rule 7.2).', v_gt
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end $fn$;
revoke all on function public.guard_lineup_suspended() from public, anon, authenticated;
drop trigger if exists guard_lineup_suspended_trg on public.game_lineups;
create trigger guard_lineup_suspended_trg before insert or update on public.game_lineups
  for each row execute function public.guard_lineup_suspended();
drop trigger if exists guard_line_suspended_trg on public.team_lines;
create trigger guard_line_suspended_trg before insert or update on public.team_lines
  for each row execute function public.guard_lineup_suspended();

/* Locked where he is: no call-up or send-down while he is suspended. The league office (a
   commissioner) and the league's own automation still pass, as they do the weekly freeze. */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_squad_move()'::regprocedure);
  d := replace(d0,
    '  if NEW.squad is not distinct from OLD.squad then return NEW; end if;',
    '  if NEW.squad is not distinct from OLD.squad then return NEW; end if;
  /* v3.51 (commissioner, 2026-09-28): a suspended player is locked where he is on the roster, as a
     punishment to the club, until the suspension is served. */
  if public.is_suspended(NEW.profile_id) and not (public.is_commissioner() or public.trusted_writer()) then
    raise exception ''Rule 7.2: % is suspended and is locked where he is. He cannot be called up or sent down until it is served.'',
      coalesce((select gamertag from public.profiles where id = NEW.profile_id), ''This player'')
      using errcode = ''check_violation'';
  end if;');
  if d = d0 then raise exception 'guard_squad_move patch matched nothing'; end if;
  execute d;
end $mig$;

/* Not allowed to be claimed while suspended (Q7): sign_free_agent already refused a suspended or
   banned player through is_suspended(), so it follows the new definition with no change. */

/* The forums read the same definition as everything else, so a served suspension stops blocking
   posts the moment it ends instead of waiting for someone to lift it by hand. */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public._forum_guard()'::regprocedure);
  d := replace(d0,
    '  if exists (select 1 from public.suspensions
              where profile_id = me and status = ''active'' and mode <> ''warning'') then',
    '  if public.is_suspended(me) then');
  if d = d0 then raise exception '_forum_guard patch matched nothing'; end if;
  execute d;
end $mig$;

/* The member is told what the suspension takes and exactly when it ends. */
create or replace function public.notify_suspension()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_name text; v_by text; v_len text; v_body text; v_takes text;
begin
  if new.status <> 'active' then return new; end if;
  select coalesce(gamertag, display_name, 'A player') into v_name from public.profiles where id=new.profile_id;
  select coalesce(gamertag, display_name) into v_by from public.profiles where id=new.created_by;
  if new.mode='warning' then
    perform public.create_notification(new.profile_id, 'flag', 'The league office issued you a formal warning',
      coalesce(nullif(btrim(new.reason),''),'No reason was recorded.')||
      ' A warning is a record, not a suspension: you may keep playing. Chapter 7 of the rulebook covers discipline and appeals.',
      'rulebook', null);
    perform public.notify_staff_ch('casework', '**Warning issued**: '||v_name||' received a formal warning'||
      coalesce('. Reason: '||nullif(btrim(new.reason),''),'')||
      coalesce('. By '||v_by,'')||'. https://chelgamingleague.com/#/hub/staffdesk', false);
    return new;
  end if;
  v_len := case new.mode
    when 'games' then coalesce(new.games_total::text,'?')||' game'||case when new.games_total=1 then '' else 's' end||
                      ', counted on the games of whichever club you are on and carried into the next season if needed. It ends at 11:59 PM Eastern on the day of the last one'
    when 'seasons' then 'for the rest of Season '||coalesce(new.until_season::text,'?')
    else 'through '||coalesce(to_char(new.ends_at at time zone 'America/New_York','FMDay, Mon DD'),'further notice')||' at 11:59 PM Eastern' end;
  v_takes := case new.scope
    when 'staff' then 'While it runs you may not act as league staff: your desks and staff powers are switched off.'
    when 'both'  then 'While it runs you may not be scheduled or play, and your desks and staff powers are switched off.'
    else 'While it runs you may not be scheduled, dress or play, appear in a league lobby, or act as your club''s point of contact, and your club cannot move you between its roster and training camp.' end;
  v_body := 'You are suspended '||v_len||'. Reason: '||coalesce(nullif(btrim(new.reason),''),'not stated')||'. '||v_takes||
    ' If you want to appeal, you have 48 hours from now and must state your grounds (Rule 7.6).';
  perform public.create_notification(new.profile_id, 'flag', 'You have been suspended', v_body, 'rulebook', null);
  begin
    insert into public.discord_dms (profile_id, discord_id, kind, content)
      select p.id, p.discord_id, 'suspension',
        left(':no_entry: **You have been suspended '||v_len||'.** Reason: '||
             coalesce(nullif(btrim(new.reason),''),'not stated')||'. '||v_takes||
             ' To appeal you have 48 hours and must state your grounds (Rule 7.6): https://chelgamingleague.com/#/hub/actions', 1900)
        from public.profiles p where p.id = new.profile_id and coalesce(p.discord_id,'') <> '';
  exception when others then
    raise warning 'suspension DM failed for %: %', new.profile_id, sqlerrm;
  end;
  perform public.notify_staff_ch('casework', '**Suspension issued**: '||v_name||' suspended '||
    case new.mode when 'games' then new.games_total||' games' when 'seasons' then 'for the rest of Season '||new.until_season
         else 'through '||to_char(new.ends_at at time zone 'America/New_York','Mon DD') end||
    case when new.scope <> 'play' then ' ('||new.scope||' scope)' else '' end||
    '. Reason: '||coalesce(nullif(btrim(new.reason),''),'not stated')||
    coalesce('. By '||v_by,'')||'. https://chelgamingleague.com/#/hub/staffdesk', false);
  return new;
end $fn$;
