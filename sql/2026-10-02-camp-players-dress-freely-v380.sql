-- v3.80: a training-camp player may be dressed whether or not an available roster player is left out.
-- Commissioner, 2026-10-02 (game night, a manager refused on the lineup builder): "A manager is trying to add a
-- Training Camp player to their lineup but they are getting an error. I know this is a rule, but remove the
-- mechanic for it."
-- v3.65 (Q14, sql/2026-09-28-roster-first-v365.sql) made set_game_lineup refuse a sheet that dressed a camp player
-- while an active-roster player of the same kind who said yes for that game, was not suspended, was playoff
-- eligible and within his limit was left out. That block is removed whole. Everything else on a sheet still holds:
-- positions (camp players fill any slot), suspensions, the weekly and series limits (3 a week for a camp player,
-- Rule 5.2), the playoff floor, duplicates, the lock. public.available_for_game stays (it reads the availability
-- grid and costs nothing idle); nothing else called the rule.

do $mig$
declare d0 text; d text; i0 int; i1 int;
  v_start constant text := $s$  /* v3.65 (commissioner, 2026-09-28, Q14): "Roster players also must be prioritized in a lineup when$s$;
  v_end   constant text := $e$  v_lock := v_game.scheduled_at - interval '30 minutes';$e$;
begin
  select pg_get_functiondef(p.oid) into d0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_game_lineup';
  if d0 is null then raise exception 'set_game_lineup not found'; end if;
  if (length(d0) - length(replace(d0, v_start, ''))) / length(v_start) <> 1
     or (length(d0) - length(replace(d0, v_end, ''))) / length(v_end) <> 1 then
    raise exception 'set_game_lineup: the roster-first block is not there exactly once'; end if;
  i0 := position(v_start in d0); i1 := position(v_end in d0);
  if i1 <= i0 then raise exception 'set_game_lineup: markers out of order'; end if;
  if substr(d0, i0, i1 - i0) !~ 'Rule 5\.2: roster players come first' then
    raise exception 'set_game_lineup: the text between the markers is not the roster-first rule'; end if;
  d := substr(d0, 1, i0 - 1)
    || $c$  /* v3.80 (commissioner, 2026-10-02): the v3.65 roster-first rule (Q14) is withdrawn. A training-camp player
     may be dressed whoever else is available; his own limit (Rule 5.2) still applies above. */

$c$
    || substr(d0, i1);
  execute d;
end $mig$;

/* REHEARSED 2026-10-02 in one rolled-back transaction, with DAL's real sheet for its 9:00 PM game against SEA and a
   DAL camp skater under his weekly limit put in at center by DAL's Owner:
     before: "Rule 5.2: roster players come first. I Jawa x71 I, MFN_Steve15, Taaaylorswift, xW3RMZx are available for
              this game and not in the lineup, so a training-camp player cannot take a skater's spot. ..."
     after:  accepted.
   And the block is gone while the weekly limit (a camp player at 3 of 3 is still refused, seen in the first try),
   lineup_slot_ok, the office's T+10 exemption (v3.79) and the club notices are all still there; the grant holds.
   APPLIED 2026-10-02 as migration v380_camp_players_dress_freely, on game night, so managers filing that evening were
   unblocked in the database before the site's builder shipped. */
