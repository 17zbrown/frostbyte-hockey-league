-- v3.78: a player chooses his own jersey number in his league profile (Rule 2.1).
-- Commissioner, 2026-10-01: "add a spot in the players' league profile to choose and edit their jersey number."
--
-- Until now (v2.91) a number lived only on the roster spot, set by club management, and every way onto a roster
-- (draft, signing, assignment, contract rollover, reinstatement, a trade's move) handed the newcomer the lowest
-- free number. Now:
--   * profiles.jersey_number (already there: smallint, CHECK null or 1..99) is the number the player CHOSE.
--   * public.set_my_jersey_number(p_number) is his door. It saves the choice and, if he holds a roster spot this
--     season, puts it on that spot at once, unless anyone on his club (active or camp, any status: the unique key
--     is (season, team, number) over every spot) already wears it; then nothing changes and the wearer is named.
--     A null clears the choice and leaves the spot's number as it is (a spot always wears one).
--   * public.apply_jersey_preference(), a BEFORE trigger on roster_spots INSERT and on a change of team_id, puts
--     the chosen number on the spot whenever it is free on that club. One definition for every writer, present
--     and future: the writers keep choosing a fallback (lowest free, or his old number), and the trigger only
--     upgrades it. A plain renumber (management's set_jersey_number, or this door) never fires it.
--   * sign_free_agent, respond_offer and reinstate_roster_spot announce "#N" from a local variable, which the
--     trigger can make stale: each insert now reads the number back (returning jersey_number into ...).
--   * set_jersey_number (v2.91) looked for a clash among ACTIVE spots only, while the unique key spans every
--     spot, so a clash with a non-active spot surfaced as a raw unique violation; it now names the wearer too.
-- Club management keeps its v2.91 power to renumber its own players; that changes the spot, not the player's
-- choice, which comes back into play the next time he joins a club.

create or replace function public.apply_jersey_preference() returns trigger
language plpgsql security definer set search_path = '' as $f$
declare v_pref int;
begin
  select pr.jersey_number into v_pref from public.profiles pr where pr.id = new.profile_id;
  if v_pref is null or v_pref = new.jersey_number or v_pref < 1 or v_pref > 99 then return new; end if;
  if not exists (select 1 from public.roster_spots rs
                  where rs.season_id = new.season_id and rs.team_id = new.team_id
                    and rs.jersey_number = v_pref and rs.profile_id <> new.profile_id) then
    new.jersey_number := v_pref;
  end if;
  return new;
end $f$;
revoke all on function public.apply_jersey_preference() from public, anon, authenticated;

drop trigger if exists jersey_preference_ins_trg on public.roster_spots;
create trigger jersey_preference_ins_trg before insert on public.roster_spots
  for each row execute function public.apply_jersey_preference();
drop trigger if exists jersey_preference_move_trg on public.roster_spots;
create trigger jersey_preference_move_trg before update of team_id on public.roster_spots
  for each row when (old.team_id is distinct from new.team_id) execute function public.apply_jersey_preference();

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
    update public.roster_spots set jersey_number = p_number where id = v_spot.id;
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
      ('sign_free_agent', $a$case when v_to_camp then 'tc' end);$a$,
                          $b$case when v_to_camp then 'tc' end)
    returning jersey_number into v_jersey;$b$),
      ('respond_offer', $a$coalesce(v_reg.position, 'C'), o.salary, 'free_agency');$a$,
                        $b$coalesce(v_reg.position, 'C'), o.salary, 'free_agency')
        returning jersey_number into v_jersey;$b$),
      ('reinstate_roster_spot', $a$r.salary, r.origin, coalesce(r.on_block,false), coalesce(r.squad,'pro'));$a$,
                                $b$r.salary, r.origin, coalesce(r.on_block,false), coalesce(r.squad,'pro'))
  returning jersey_number into v_j;$b$),
      ('set_jersey_number', $a$and coalesce(rs.status,'active') = 'active' and rs.jersey_number = p_number$a$,
                            $b$and rs.jersey_number = p_number$b$)
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

/* REHEARSED 2026-10-01 in one rolled-back transaction: "REHEARSAL OK: S1 S2 S3 S4 S5 S6 S7 S8 S9 S10 S11".
     S1  a rostered player, as the API role (authenticated), sets a free number: his spot and his choice both
         change, and nothing is queued to Discord;
     S2  a teammate's number is refused (23505) with the teammate named, and nothing changes;
     S3  0, 100 and -5 are refused (22023);  S4 clearing the choice keeps the spot's number;
     S5  an unrostered member saves a choice only;
     S6  joining a club (a writer-style insert offering the lowest free number): he gets his choice;
     S7  his choice worn on that club: he keeps the writer's number;
     S8  the real move_player carries his choice to the new club;
     S9  a plain renumber (management) is never overridden;
     S10 the three announcers read the number back, and set_jersey_number checks every spot;
     S11 authenticated may call the door, anon may not, and no API role may call the trigger function.
   APPLIED 2026-10-01 as migration v378_player_jersey_number. Afterwards: the door exists (authenticated only),
   both triggers are on roster_spots, sign_free_agent reads its number back, and tools/sql/grant-audit.sql
   (set_my_jersey_number added to check 4) returns zero rows.
   AT APPLY, 11 profiles already held a jersey_number, all members who joined July 7 to 14 (how it was set is
   not recorded; 8 are rostered, each wearing a different number). They are kept as those players' choices: the League profile card shows both numbers, and
   nothing changes on a current club until the player saves or moves. */
