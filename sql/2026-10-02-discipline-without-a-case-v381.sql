-- v3.81: a commissioner disciplines a member directly, without a case being filed.
-- Commissioner, 2026-10-02: "allow me to suspend players through the control centers without the need of a case to
-- be filed."
-- The case-free door already existed (suspend_player, used by Control Center -> Users and roles and the community
-- desk), but it could not say which season a season-long suspension runs through, so the site refused that length
-- ("A suspension through a season is issued from a case") and a formal warning had no direct door at all. Every rule
-- about who may impose what still lives in public._issue_suspension, which both doors call: a season-long suspension,
-- anything over the staff ceilings, and any sanction against league staff remain commissioner rulings.
-- DROP + CREATE, not CREATE OR REPLACE: a new defaulted argument would make an overload, and the old eight-argument
-- callers could bind to the old function (the club_notify lesson, v3.11).

drop function if exists public.suspend_player(uuid, text, timestamptz, integer, text, text[], text, boolean);
create function public.suspend_player(p_profile uuid, p_mode text, p_ends_at timestamptz, p_games integer, p_reason text,
                                      p_codes text[] default null, p_scope text default 'play', p_keep_length boolean default false,
                                      p_until_season integer default null)
returns uuid
language plpgsql security definer set search_path to 'public' as $function$
begin
  /* v3.81: p_until_season carries a season-long suspension (Rule 7.2: a commissioner ruling, checked in _issue_suspension) */
  return public._issue_suspension(p_profile, p_mode, p_games, p_ends_at, p_until_season, p_reason, p_codes,
                                  p_scope, p_keep_length, null);
end $function$;
revoke all on function public.suspend_player(uuid, text, timestamptz, integer, text, text[], text, boolean, integer) from public, anon;
grant execute on function public.suspend_player(uuid, text, timestamptz, integer, text, text[], text, boolean, integer) to authenticated;

do $chk$
begin
  if (select count(*) from pg_proc where proname = 'suspend_player' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'suspend_player: expected exactly one'; end if;
end $chk$;

/* REHEARSED 2026-10-02 in one rolled-back transaction, as the commissioner through the API role:
   "REHEARSAL OK: S1 seasons, S2 warning, S3 old shape, S4 member refused, S5 grants".
     S1 a rostered member suspended for the rest of Season 1 with no case (mode seasons, until_season 1, no request);
     S2 a formal warning with no case; S3 the old eight-argument positional call still binds (3 games);
     S4 a plain member calling it is refused by _issue_suspension; S5 anon cannot execute it.
   APPLIED 2026-10-02 as migration v381_discipline_without_a_case; exactly one suspend_player remains. */
