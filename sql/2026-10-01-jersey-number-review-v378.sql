-- v3.78, second part: what the review of the chosen-number release found (applied the same day, before the site shipped).
--   1. apply_jersey_preference becomes the guarantor of a valid number on every join and every change of club: the
--      player's choice when it is free there; else the number the writer offered, when it is 1..99 and free; else
--      the lowest number free on the club. ensure_manager_rostered moved a seated player with his old number
--      unchecked, so a clash surfaced as a raw unique violation; any writer that ever offers a taken number is now
--      corrected instead of failing (or, behind an ON CONFLICT DO NOTHING, silently dropping the spot).
--   2. A swap trade could not give a player the number the player going the other way was wearing: the incoming
--      move ran first, while it was still worn. accept_trade and reverse_trade now settle every moved player's
--      choice once all of them have moved (public._settle_jersey_choices, up to three passes, so chains settle).
--   3. set_my_jersey_number checked for a clash and then wrote; a join landing in between raised a raw unique
--      violation. The write now catches it and names the wearer.
--   4. draft_make_pick, use_draft_pick and _activate_contract_spot inserted with a bare ON CONFLICT DO NOTHING,
--      which also swallowed a jersey clash and left a used pick (or an active contract) with no roster spot. They
--      now name the one conflict they mean, (season_id, profile_id): a player already on a roster is still skipped,
--      and anything else fails loudly.

create or replace function public.apply_jersey_preference() returns trigger
language plpgsql security definer set search_path = '' as $f$
declare v_pref int; v_free int;
begin
  select pr.jersey_number into v_pref from public.profiles pr where pr.id = new.profile_id;
  if v_pref between 1 and 99 and v_pref is distinct from new.jersey_number
     and not exists (select 1 from public.roster_spots rs
                      where rs.season_id = new.season_id and rs.team_id = new.team_id
                        and rs.jersey_number = v_pref and rs.profile_id <> new.profile_id) then
    new.jersey_number := v_pref;
    return new;
  end if;
  if new.jersey_number between 1 and 99
     and not exists (select 1 from public.roster_spots rs
                      where rs.season_id = new.season_id and rs.team_id = new.team_id
                        and rs.jersey_number = new.jersey_number and rs.profile_id <> new.profile_id) then
    return new;
  end if;
  select min(n) into v_free from generate_series(1, 99) n
   where not exists (select 1 from public.roster_spots rs
                      where rs.season_id = new.season_id and rs.team_id = new.team_id
                        and rs.jersey_number = n and rs.profile_id <> new.profile_id);
  /* none free: the number is left as offered and the unique key or the 1..99 check refuses the row loudly */
  if v_free is not null then new.jersey_number := v_free; end if;
  return new;
end $f$;
revoke all on function public.apply_jersey_preference() from public, anon, authenticated;

create or replace function public._settle_jersey_choices(p_season uuid, p_profiles uuid[]) returns void
language plpgsql security definer set search_path = '' as $f$
declare v_pass int; v_changed boolean; r record;
begin
  for v_pass in 1..3 loop
    v_changed := false;
    for r in select rs.id, rs.team_id, rs.profile_id, pr.jersey_number as pref
               from public.roster_spots rs join public.profiles pr on pr.id = rs.profile_id
              where rs.season_id = p_season and rs.profile_id = any(coalesce(p_profiles, '{}'::uuid[]))
                and pr.jersey_number between 1 and 99 and pr.jersey_number <> rs.jersey_number
              order by rs.profile_id loop
      if not exists (select 1 from public.roster_spots o
                      where o.season_id = p_season and o.team_id = r.team_id
                        and o.jersey_number = r.pref and o.profile_id <> r.profile_id) then
        update public.roster_spots set jersey_number = r.pref where id = r.id;
        v_changed := true;
      end if;
    end loop;
    exit when not v_changed;
  end loop;
end $f$;
revoke all on function public._settle_jersey_choices(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.set_my_jersey_number(p_number integer) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare
  v_uid uuid := auth.uid();
  v_season uuid := public.current_season_id();
  v_spot record; v_taken text;
begin
  if v_uid is null then raise exception 'You must be signed in.' using errcode = '28000'; end if;
  if p_number is not null and (p_number < 1 or p_number > 99) then
    raise exception 'A jersey number is a whole number from 1 to 99.' using errcode = '22023'; end if;
  select rs.id, rs.team_id, rs.jersey_number into v_spot
    from public.roster_spots rs where rs.season_id = v_season and rs.profile_id = v_uid;
  if v_spot.id is not null and p_number is not null and v_spot.jersey_number <> p_number then
    select coalesce(nullif(pr.gamertag, ''), 'another player') into v_taken
      from public.roster_spots rs join public.profiles pr on pr.id = rs.profile_id
     where rs.season_id = v_season and rs.team_id = v_spot.team_id and rs.profile_id <> v_uid
       and rs.jersey_number = p_number limit 1;
    if v_taken is not null then
      raise exception '#% is already worn by % on your club. Pick another number.', p_number, v_taken using errcode = '23505'; end if;
    begin
      update public.roster_spots set jersey_number = p_number where id = v_spot.id;
    exception when unique_violation then
      /* someone joined the club wearing it between the check and the write */
      select coalesce(nullif(pr.gamertag, ''), 'another player') into v_taken
        from public.roster_spots rs join public.profiles pr on pr.id = rs.profile_id
       where rs.season_id = v_season and rs.team_id = v_spot.team_id and rs.profile_id <> v_uid
         and rs.jersey_number = p_number limit 1;
      raise exception '#% was just taken by % on your club. Pick another number.', p_number, coalesce(v_taken, 'another player') using errcode = '23505';
    end;
  end if;
  update public.profiles set jersey_number = p_number where id = v_uid;
  return jsonb_build_object('chosen', p_number, 'team_id', v_spot.team_id,
                            'wearing', case when v_spot.id is null then null else coalesce(p_number, v_spot.jersey_number) end);
end $f$;
revoke all on function public.set_my_jersey_number(integer) from public, anon;
grant execute on function public.set_my_jersey_number(integer) to authenticated;

do $mig$
declare r record; d0 text; d text;
begin
  for r in select * from (values
      ('accept_trade',
       $a$  foreach pid in array t.requested_profile_ids loop perform public.move_player(pid, t.season_id, t.from_team_id); end loop;
$a$,
       $b$  foreach pid in array t.requested_profile_ids loop perform public.move_player(pid, t.season_id, t.from_team_id); end loop;
  /* v3.78: once everyone has moved, so a player may take the number vacated by one going the other way */
  perform public._settle_jersey_choices(t.season_id, coalesce(t.offered_profile_ids, '{}'::uuid[]) || coalesce(t.requested_profile_ids, '{}'::uuid[]));
$b$),
      ('reverse_trade',
       $a$  end loop;

  /* v3.72: each player going back takes the place of one leaving$a$,
       $b$  end loop;
  /* v3.78: once everyone has moved back, the chosen numbers settle (Rule 2.1) */
  perform public._settle_jersey_choices(t.season_id, coalesce(t.offered_profile_ids, '{}'::uuid[]) || coalesce(t.requested_profile_ids, '{}'::uuid[]));

  /* v3.72: each player going back takes the place of one leaving$b$),
      ('draft_make_pick', $a$public.draft_pick_salary(v_pick.season_number, v_pick.round)) on conflict do nothing;$a$,
                          $b$public.draft_pick_salary(v_pick.season_number, v_pick.round)) on conflict (season_id, profile_id) do nothing;$b$),
      ('use_draft_pick', $a$public.draft_pick_salary(v_pick.season_number, v_pick.round))
    on conflict do nothing;$a$,
                         $b$public.draft_pick_salary(v_pick.season_number, v_pick.round))
    on conflict (season_id, profile_id) do nothing;$b$),
      ('_activate_contract_spot', $a$c.salary, 'contract')
    on conflict do nothing;$a$,
                                  $b$c.salary, 'contract')
    on conflict (season_id, profile_id) do nothing;$b$)
    ) v(fn, old, new)
  loop
    select pg_get_functiondef(p.oid) into d0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if d0 is null then raise exception '% not found', r.fn; end if;
    if (length(d0) - length(replace(d0, r.old, ''))) / length(r.old) <> 1 then
      raise exception '%: the text to patch is not there exactly once', r.fn; end if;
    d := replace(d0, r.old, r.new);
    execute d;
  end loop;
end $mig$;

/* REHEARSED 2026-10-01 in one rolled-back transaction: "REHEARSAL OK: R1 R2 R3 R4 R5 R6".
     R1 an insert offering a number already worn on the club is corrected to the lowest free one, not refused;
     R2 a change of club keeping a number worn there (ensure_manager_rostered's shape) is corrected the same way;
     R3 a swap with the real move_player: X chose Y's number, X moved first and could not have it, Y moved the other
        way, and _settle_jersey_choices gave it to X;
     R4 accept_trade and reverse_trade call the settle, the three inserts name (season_id, profile_id), and the
        door catches the race; R5 the settle is no API role's; R6 the door (as authenticated) and the refusal by
        name still hold.
   APPLIED 2026-10-01 as migration v378_jersey_number_review. Afterwards: the trigger carries the fallback, both
   trade functions settle, the three inserts are narrowed, and no club has a duplicate number (162 spots). */
