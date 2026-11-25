-- v463 REVERSE (DRAFT, 2026-11-24): undoes sql/2026-11-24-s2-all-staff-voting-v463.sql if the flip is rolled back
-- (PLAN section 8: restore the deploy, git revert, then the reverse migrations in the opposite order of the apply: the
-- staff copy reverse first, this one second, the staff powers reverse last). The applications department reviews again, as it did on 2026-11-24: is_app_reviewer,
-- app_reviewer_count, owner_app_read and staff_app_read come back byte for byte (the definitions below are the ones read
-- from production that day, and the self-checks compare them), and notify_mgmt_application's two patch pairs are undone
-- by exact anchor (the forward record's pairs, byte for byte). Ballots cast while every staffer voted stay on the record;
-- the department tally counts only the reviewers' ones, exactly as before. Nothing is decided by this record.
-- Apply as migration v463_s2_all_staff_voting_reverse. Rehearsed inside sql/2026-11-24-s2-all-staff-voting-v463.rehearsal.sql.

do $pre$
begin
  if position('public.is_staff_voter(p_uid)' in pg_get_functiondef('public.is_app_reviewer(uuid)'::regprocedure)) = 0
     or position('public.staff_voter_count()' in pg_get_functiondef('public.app_reviewer_count()'::regprocedure)) = 0 then
    raise exception 'v463 all-staff voting reverse: the all-staff vote is not applied, so there is nothing to reverse';
  end if;
end $pre$;

do $rev$
declare
  v_rev text := $old$CREATE OR REPLACE FUNCTION public.is_app_reviewer(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.profiles
    where id = p_uid and role in ('staff','commissioner') and 'applications' = any(coalesce(departments, '{}')));
$function$
$old$;
  v_cnt text := $old$CREATE OR REPLACE FUNCTION public.app_reviewer_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.profiles
    where role in ('staff','commissioner') and 'applications' = any(coalesce(departments, '{}'));
$function$
$old$;
begin
  execute v_rev;
  execute v_cnt;
  if pg_get_functiondef('public.is_app_reviewer(uuid)'::regprocedure) <> v_rev
     or pg_get_functiondef('public.app_reviewer_count()'::regprocedure) <> v_cnt then
    raise exception 'v463 all-staff voting reverse: a reviewer function did not come back byte for byte';
  end if;
end $rev$;

do $mgmt$
declare r record; v_def text; n int;
begin
  for r in select * from (values
-- >>> patch pairs
    (1, $o$           where role = 'staff'
             and 'applications' = any(coalesce(departments, '{}'))
             and id <> new.submitted_by and id is distinct from new.nominee_id
$o$, $n$           where role = 'staff'
             and public.is_staff_voter(id)   /* v463 (commissioner, 2026-11-23): every staff member votes on GM and AGM nominations, so every voter on the staff is told */
             and id <> new.submitted_by and id is distinct from new.nominee_id
$n$),
    (2, $o$      '. The Review Board votes on the appointment $o$ || chr(8212) || $o$ you''ll be notified of the decision.',
$o$, $n$      '. The league staff vote on the appointment, and you will be told the decision.',   /* v463: the whole staff votes from the flip */
$n$)
-- <<< patch pairs
  ) as x(ord, old_text, new_text) order by x.ord desc loop
    v_def := pg_get_functiondef('public.notify_mgmt_application()'::regprocedure);
    n := (length(v_def) - length(replace(v_def, r.new_text, ''))) / length(r.new_text);
    if n <> 1 then raise exception 'v463 all-staff voting reverse: notify_mgmt_application patch % stands % times', r.ord, n; end if;
    execute replace(v_def, r.new_text, r.old_text);
    v_def := pg_get_functiondef('public.notify_mgmt_application()'::regprocedure);
    if (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text) <> 1 then
      raise exception 'v463 all-staff voting reverse: notify_mgmt_application anchor % did not come back once', r.ord;
    end if;
  end loop;
end $mgmt$;

alter policy owner_app_read on public.owner_applications
  using ((profile_id = (select auth.uid())) or (public.is_staff() and not public.is_media_only_staff((select auth.uid()))) or public.is_commissioner());
alter policy staff_app_read on public.staff_applications
  using ((profile_id = (select auth.uid())) or (public.is_staff() and not public.is_media_only_staff((select auth.uid()))) or public.is_commissioner());

do $chk$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and cmd = 'SELECT'
        and ((tablename = 'owner_applications' and policyname = 'owner_app_read') or (tablename = 'staff_applications' and policyname = 'staff_app_read'))
        and qual = '((profile_id = ( SELECT auth.uid() AS uid)) OR (is_staff() AND (NOT is_media_only_staff(( SELECT auth.uid() AS uid)))) OR is_commissioner())') <> 2 then
    raise exception 'v463 all-staff voting reverse: an application read policy did not come back byte for byte';
  end if;
  if not has_function_privilege('anon', 'public.is_app_reviewer(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.app_reviewer_count()', 'EXECUTE') then
    raise exception 'v463 all-staff voting reverse: the reviewer functions lost or gained a grant';
  end if;
  raise notice 'v463 all-staff voting reverse: % reviewers (the applications department)', public.app_reviewer_count();
end $chk$;
