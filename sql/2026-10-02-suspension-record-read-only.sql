-- 2026-10-02: suspension_record made read-only for the API roles. Found by the v3.79 security review.
--
-- public.suspension_record is a simple view over public.suspensions, so Postgres makes it automatically updatable,
-- and it runs with its owner's privileges (security_invoker = false). The default grants had given anon and
-- authenticated INSERT, UPDATE and DELETE on it, so anyone holding the public API key (it ships in the site) could
-- lift, rewrite or delete any suspension the view shows, past every RLS policy on suspensions and every check in
-- suspend_player / lift_suspension. The site only reads the view; every write goes through those doors.
-- games_public, the only other updatable owner-privilege view, already had these grants revoked.
revoke insert, update, delete, truncate, references, trigger on public.suspension_record from public, anon, authenticated;
grant select on public.suspension_record to anon, authenticated;

/* APPLIED 2026-10-02 as migration suspension_record_read_only. Afterwards: anon and authenticated hold SELECT only on
   the view. Checked for abuse first: the table held one suspension, and no lifted suspension lacked its
   'suspension_lifted' or 'suspension_superseded' audit row (a deletion would leave no trace, so this is not proof).
   tools/sql/grant-audit.sql check 8 now returns a row for any updatable owner-privilege view an API role can write. */
