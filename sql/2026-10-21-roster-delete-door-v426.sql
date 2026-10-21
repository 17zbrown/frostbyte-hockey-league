-- v4.26 (2026-10-21): a club releases a player only through the waiver, and the API roles keep only the privileges on
-- public.roster_spots that the site uses.
-- Audit F-2-18 (docs/audits/2026-09-27-rulebook-audit.md, Rule 2.2.3), raised again by the v4.25 review (2026-10-21).
--
-- Before:
--   1. The RLS policy "gm deletes own team roster" (DELETE, USING is_gm_of(team_id)) let an Owner, GM or AGM delete
--      their club's roster row straight through PostgREST with their own JWT. That skipped public.waive_player, so no
--      season_registrations.waived_at stamp was written (the player never reached the waived board, and the next
--      placement sweep could hand them to a club at random) and no transactions row was added: a release the league
--      never recorded. Rule 2.2 promises that a waiver is posted to the transaction log. v4.25 put the suspended-player
--      bar on the delete trigger (public.guard_roster_waive), so suspensions were covered; the unrecorded release was not.
--   2. anon and authenticated held every table privilege on roster_spots (SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
--      REFERENCES, TRIGGER), Supabase's default for a table created in public. RLS gated the row writes, but TRUNCATE is
--      not subject to RLS, and the UPDATE policy "gm updates own team roster" reached every column.
-- What the API roles actually use (read 2026-10-21):
--   - the site reads roster_spots everywhere, signed out (anon) and signed in (authenticated), and over Realtime;
--   - CG.assignRegistration (part_live.js) INSERTs a roster row as a commissioner (policy "commissioner writes rosters");
--   - CG.setOnBlock (part_live.js) UPDATEs on_block, and nothing else, as a seat holder or a commissioner;
--   - nothing in src/live, bot, netlify, jobs, edge or shared deletes, upserts or updates any other column directly.
--   Every server-side roster writer (31 functions: waive_player, admin_remove_from_roster, the draft, trades, signings,
--   the sweeps) is SECURITY DEFINER owned by postgres, which owns the table, so none of them needs the API roles'
--   grants. The bot, the jobs and the Netlify functions write with the service role, which this file does not touch.
-- After:
--   1. The DELETE policy is gone. A roster row leaves only through a SECURITY DEFINER door: the waiver for a club
--      (recorded, stamped, guarded), the office's removal doors for the league office.
--   2. anon: SELECT only. authenticated: SELECT, INSERT (the commissioner's assign; RLS still limits it to a
--      commissioner) and UPDATE of on_block only (RLS still limits it to the club's seat holders and a commissioner).
--      No DELETE, TRUNCATE, REFERENCES or TRIGGER for either. The policy "commissioner writes rosters" (ALL) stays for
--      the INSERT and the on_block UPDATE; with no DELETE grant its delete half is inert, so the commissioner also
--      removes players only through the recorded doors.
--   3. tools/sql/grant-audit.sql check 9 returns a row if a DELETE policy reappears on roster_spots or an API role
--      regains DELETE or TRUNCATE on it.
-- guard_roster_waive keeps its v4.25 bar unchanged as the second lock (its comment still names the policy as the
-- reason; the comment records why the bar was put there and stays).

drop policy "gm deletes own team roster" on public.roster_spots;

revoke all on table public.roster_spots from public, anon, authenticated;
grant select on table public.roster_spots to anon, authenticated;
grant insert on table public.roster_spots to authenticated;
grant update (on_block) on table public.roster_spots to authenticated;

do $chk$
declare v_cols text;
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roster_spots' and cmd = 'DELETE') then
    raise exception 'v4.26 check: a DELETE policy still exists on roster_spots';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roster_spots' and cmd = 'ALL'
             and qual is distinct from 'is_commissioner()') then
    raise exception 'v4.26 check: an ALL policy on roster_spots reaches someone other than a commissioner';
  end if;
  if not has_table_privilege('anon', 'public.roster_spots', 'SELECT')
     or not has_table_privilege('authenticated', 'public.roster_spots', 'SELECT')
     or not has_table_privilege('authenticated', 'public.roster_spots', 'INSERT')
     or not has_column_privilege('authenticated', 'public.roster_spots', 'on_block', 'UPDATE') then
    raise exception 'v4.26 check: a privilege the site uses is missing';
  end if;
  if has_table_privilege('anon', 'public.roster_spots', 'INSERT')
     or has_any_column_privilege('anon', 'public.roster_spots', 'INSERT')
     or has_any_column_privilege('anon', 'public.roster_spots', 'UPDATE')
     or has_table_privilege('authenticated', 'public.roster_spots', 'UPDATE')
     or has_table_privilege('anon', 'public.roster_spots', 'DELETE') or has_table_privilege('authenticated', 'public.roster_spots', 'DELETE')
     or has_table_privilege('anon', 'public.roster_spots', 'TRUNCATE') or has_table_privilege('authenticated', 'public.roster_spots', 'TRUNCATE')
     or has_table_privilege('anon', 'public.roster_spots', 'REFERENCES') or has_table_privilege('authenticated', 'public.roster_spots', 'REFERENCES')
     or has_table_privilege('anon', 'public.roster_spots', 'TRIGGER') or has_table_privilege('authenticated', 'public.roster_spots', 'TRIGGER') then
    raise exception 'v4.26 check: an API role still holds a privilege the site does not use';
  end if;
  select string_agg(a.attname, ',' order by a.attname) into v_cols from pg_attribute a
   where a.attrelid = 'public.roster_spots'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', 'public.roster_spots', a.attname, 'UPDATE');
  if v_cols is distinct from 'on_block' then
    raise exception 'v4.26 check: authenticated may update % (expected on_block only)', v_cols;
  end if;
  if not has_table_privilege('service_role', 'public.roster_spots', 'DELETE') then
    raise exception 'v4.26 check: service_role lost DELETE (the jobs and the bot need it)';
  end if;
end $chk$;

/* REHEARSAL (2026-10-21, one transaction on the live database with the migration and the $chk$ block, rolled back by a
   closing raise; releases and the trade block are closed for Season 1, so T3 and T5 reopen moves inside their own
   undone pass):
   T0 preconditions: the NYI Owner (c02ff3d4) holds the seat, Pip is rostered on NYI and not suspended, Tager is
      suspended, releases are closed.
   T1 as the NYI Owner (set local role authenticated, their JWT claims) a direct DELETE of Pip's roster row, the old
      policy door, is refused with "permission denied for table roster_spots"; the same for anon; the row stays.
   T2 the second lock: with DELETE granted back to authenticated for one undone pass, the Owner's DELETE through RLS
      affects zero rows (no DELETE policy is left); afterward authenticated holds no DELETE again.
   T3 the Owner's waiver still works: waive_player(Pip) as the Owner removes the row, stamps waived_at (status pending)
      and adds one "waived <b>Pip</b>" transaction row (undone).
   T4 the site's reads: anon and the signed-in Owner each read all 168 Season 1 roster rows.
   T5 the site's trade-block write (CG.setOnBlock shape, filtered by season and profile): the Owner sets on_block on Pip
      and one row comes back (undone).
   T6 the Owner updating salary is refused with "permission denied for table roster_spots"; anon updating on_block too.
   T7 the commissioner's assign (CG.assignRegistration shape): zackbrown17 inserts Pearl Stenberg on DAL returning the
      jersey number (#11) as authenticated (undone).
   Result: REHEARSAL OK: T0 T1 T2 T3(Pip) T4(168) T5 T6 T7(#11).
   Afterward the policy and the old grants were still live, Pip was still rostered and unflagged with no waived_at,
   Pearl Stenberg was unrostered, releases were still closed, and no transaction row had been written.
   Before the apply, tools/sql/grant-audit.sql (with the new check 9) returned five rows: the policy, and DELETE and
   TRUNCATE for anon and authenticated.
   Applied as migration v426_roster_delete_door; tools/sql/grant-audit.sql returned zero rows. */
