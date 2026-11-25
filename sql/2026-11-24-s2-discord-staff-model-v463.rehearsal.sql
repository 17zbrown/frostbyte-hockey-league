-- Rehearsal for sql/2026-11-24-s2-discord-staff-model-v463.sql and its reverse. The main session runs it on production
-- as ONE transaction that ends in an uncaught raise, so everything rolls back. It writes one app_config row and posts
-- nothing (no pg_net call anywhere in either record).
-- Prerequisite: the staff powers record is live, or its text (and the committees record's, if that is not live) is
-- pasted right after `begin;` below. Without it the forward record's precondition refuses, which is the first case.
-- Cases:
--   M0 before: staff_model is absent (Season 1's department model).
--   M1 forward: staff_model reads 'committees'; nothing else in app_config changed (row count +1 exactly).
--   M2 forward again: idempotent, still one row.
--   M3 reverse: the key is gone and the row count is back to M0's.

begin;

do $m0$
begin
  if exists (select 1 from public.app_config where key = 'staff_model') then
    raise exception 'rehearsal M0: staff_model is already set before the record';
  end if;
  perform set_config('rh.n0', (select count(*) from public.app_config)::text, true);
end $m0$;

-- ===== the record, byte for byte (sql/2026-11-24-s2-discord-staff-model-v463.sql, from `do $pre$` to the end) =====
do $pre$
declare d text;
begin
  if to_regprocedure('public.profile_has_department(uuid,text)') is null
     or to_regprocedure('public.is_any_committee_manager(uuid)') is null or to_regclass('public.committees') is null then
    raise exception 'v463 Discord staff model: the staff powers record (sql/2026-11-24-s2-staff-powers-v463.sql) must be applied first';
  end if;
  d := pg_get_functiondef('public.notify_staff_ch(text,text,boolean)'::regprocedure);
  if position('discord_staff_casework_webhook' in d) = 0 or position('''discord_staff_''||p_channel' in d) > 0 then
    raise exception 'v463 Discord staff model: notify_staff_ch does not post to the one staff channel yet (apply the staff powers record first)';
  end if;
  if (select count(*) from public.committees) <> 6 then
    raise exception 'v463 Discord staff model: expected the six committees, found %', (select count(*) from public.committees);
  end if;
end $pre$;

insert into public.app_config (key, value, updated_at) values ('staff_model', 'committees', now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

do $chk$
begin
  if (select value from public.app_config where key = 'staff_model') is distinct from 'committees' then
    raise exception 'v463 check: app_config.staff_model is not committees';
  end if;
end $chk$;
-- Applied as migration v463d_s2_discord_staff_model on 2026-11-25 (re-rehearsed on production that morning, rolled back, then applied after the v4.63 deploy); tools/sql/grant-audit.sql returned zero rows.
-- ===== end of the record =====

do $m1$
begin
  if (select value from public.app_config where key = 'staff_model') is distinct from 'committees'
     or (select count(*) from public.app_config) <> current_setting('rh.n0')::bigint + 1 then
    raise exception 'rehearsal M1: expected staff_model committees and exactly one new app_config row';
  end if;
end $m1$;

insert into public.app_config (key, value, updated_at) values ('staff_model', 'committees', now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
do $m2$
begin
  if (select count(*) from public.app_config where key = 'staff_model') <> 1 then
    raise exception 'rehearsal M2: applying twice made a second row';
  end if;
end $m2$;

-- ===== the reverse, byte for byte (sql/2026-11-24-s2-discord-staff-model-v463.reverse.sql, from `delete` to the end) =====
delete from public.app_config where key = 'staff_model';

do $chk$
begin
  if exists (select 1 from public.app_config where key = 'staff_model') then
    raise exception 'v463 reverse check: app_config.staff_model is still set';
  end if;
end $chk$;
-- ===== end of the reverse =====

do $m3$
begin
  if (select count(*) from public.app_config) <> current_setting('rh.n0')::bigint then
    raise exception 'rehearsal M3: app_config row count did not return to its starting value';
  end if;
  raise exception 'REHEARSAL OK: M0 (absent) M1 (committees, +1 row) M2 (idempotent) M3 (reverse restores) -- rolled back';
end $m3$;
