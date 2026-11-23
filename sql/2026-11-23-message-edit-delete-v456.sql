-- v4.56 (2026-11-23): members can edit and delete the messages they send on the website.
-- Commissioner, 2026-11-23: "Can you make the text boxes wrap text if the text is longer than the single line box? Can
-- you also allow people to edit and delete messages they send in text boxes on the website similar to how discord allows
-- you to right click the text on desktop, or hold on mobile and a mini menu pops up with a copy, edit or delete option?"
-- Rulings asked and answered the same day:
--   deleting: "Gone, office keeps a copy": a deleted message leaves the conversation for its members, and the league
--     office can still read it;
--   editing: "Mark it, office keeps old text": an edited message says (edited), and the office can read what it said;
--   time limit: "Until it is decided": a message on an Action Center filing or an application (owner, staff or a
--     management nomination) can be changed by its author only while that filing or application is undecided; a direct
--     message at any time;
--   moderation: "Commissioners and staff, but keep the data so other staff and commissioners can still view them."
--
-- Three message tables: action_messages (Action Center filings, Rule 1.4), application_messages (owner, staff and
-- management applications) and direct_messages (member to member). Rule 1.3 states the rule.
-- 1. Each gains edited_at, deleted_at and deleted_by. A delete is soft: the row stays, so the live channel tells every
--    open view to drop it, but its text, attachments and media are emptied; the nonempty checks allow an emptied row
--    only once deleted_at is set. A BEFORE INSERT trigger clears the three columns, so nobody files a message
--    pre-marked as edited or deleted.
-- 2. public.message_history keeps the text as it stood before every edit, and the whole message at a delete. RLS: staff
--    and commissioners read the history of filing and application messages. Nobody reads a direct message's history
--    through the API: members' private conversations stay private, and the copy is kept in the database only.
-- 3. public.edit_message(source, id, body) and public.delete_message(source, id) are the only doors. The three tables
--    have no UPDATE or DELETE policy, so RLS refuses a direct write. The author may change their own message while they
--    can still see the conversation and it is undecided (a filing not resolved or denied, an application still
--    pending); a direct message at any time. A commissioner may delete any filing or application message, and a staff
--    member may too, save on a filing they made or are named in, or on their own application (the conflict rule the
--    Action Center already applies). Nobody edits another member's words. A banned member changes nothing.
-- 4. The bell notice a filing or application message rang carries its first 90 characters (notify_action_message,
--    notify_application_message). An edit rewrites that preview to the new words and a delete replaces it with
--    "A message was deleted.", matched by the notice type, by the message's own timestamp (the trigger writes the notice
--    in the same transaction, so the two share now()) and by the preview text itself. Direct messages ring no bell.
-- Nothing here posts to Discord.

-- 1) the columns, the insert guard and the relaxed checks ------------------------------------------------------------
alter table public.action_messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id) on delete set null;
alter table public.application_messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id) on delete set null;
alter table public.direct_messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id) on delete set null;

alter table public.action_messages drop constraint am_nonempty,
  add constraint am_nonempty check (deleted_at is not null or coalesce(btrim(body), '') <> '' or array_length(attachments, 1) is not null);
alter table public.direct_messages drop constraint direct_messages_body_check,
  add constraint direct_messages_body_check check (length(btrim(coalesce(body, ''))) <= 2000
    and (deleted_at is not null or media_path is not null or length(btrim(coalesce(body, ''))) >= 1));
alter table public.direct_messages drop constraint dm_body_or_media,
  add constraint dm_body_or_media check (deleted_at is not null or coalesce(nullif(btrim(body), ''), media_path) is not null);

create or replace function public._message_insert_clean()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
/* v4.56: a message is born unedited and undeleted. Only edit_message and delete_message set these. */
begin
  new.edited_at := null; new.deleted_at := null; new.deleted_by := null;
  return new;
end $function$;
revoke all on function public._message_insert_clean() from public, anon, authenticated;
create trigger trg_message_insert_clean before insert on public.action_messages
  for each row execute function public._message_insert_clean();
create trigger trg_message_insert_clean before insert on public.application_messages
  for each row execute function public._message_insert_clean();
create trigger trg_message_insert_clean before insert on public.direct_messages
  for each row execute function public._message_insert_clean();

-- 2) the history ------------------------------------------------------------------------------------------------------
create table public.message_history (
  id          uuid primary key default gen_random_uuid(),
  source      text not null check (source in ('action', 'application', 'direct')),
  message_id  uuid not null,
  kind        text not null check (kind in ('edit', 'delete')),
  body        text,            -- the text as it stood before this change
  detail      jsonb,           -- at a delete: attachments, media, the conversation it belonged to, its author
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index message_history_message on public.message_history (source, message_id, changed_at);
alter table public.message_history enable row level security;
revoke all on public.message_history from public, anon, authenticated;
grant select on public.message_history to authenticated;
create policy message_history_office_read on public.message_history for select to authenticated
  using (source <> 'direct' and (public.is_staff() or public.is_commissioner()));

-- 3) the bell previews ------------------------------------------------------------------------------------------------
create or replace function public._rewrite_message_notices(p_source text, p_created timestamptz, p_old text, p_new text)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
/* v4.56: the preview a message's bell notice carries follows the message. The snippet rules are notify_action_message's
   and notify_application_message's: the first 90 characters, with their fallbacks for an empty body. p_new null means
   the message was deleted. Internal: only edit_message and delete_message call it. */
declare v_type text; v_def text; v_old text; v_new text; v_n int;
begin
  if p_source = 'action' then v_type := 'action_reply'; v_def := 'Added evidence';
  elsif p_source = 'application' then v_type := 'app_message'; v_def := 'New message';
  else return 0; end if;
  v_old := left(coalesce(nullif(btrim(p_old), ''), v_def), 90);
  v_new := case when p_new is null then 'A message was deleted.' else left(coalesce(nullif(btrim(p_new), ''), v_def), 90) end;
  update public.notifications n set body = left(n.body, length(n.body) - length(v_old)) || v_new
   where n.type = v_type and n.created_at = p_created and right(n.body, length(v_old)) = v_old;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;
revoke all on function public._rewrite_message_notices(text, timestamptz, text, text) from public, anon, authenticated;

-- 4) the doors --------------------------------------------------------------------------------------------------------
create or replace function public.edit_message(p_source text, p_id uuid, p_body text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
/* v4.56 (commissioner, 2026-11-23): "allow people to edit and delete messages they send in text boxes on the website".
   Rulings: an edited message is marked (edited) and the office keeps what it said before; a message on a filing or an
   application changes only until that is decided; a direct message any time. Only the author edits; nobody edits
   another member's words. Rule 1.3. */
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_author uuid; v_old text; v_deleted timestamptz; v_created timestamptz;
  v_extra boolean := false; v_open boolean := false; v_sees boolean := false;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'NOT_AUTHORIZED: sign in to edit a message.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and coalesce(p.banned, false)) then
    raise exception 'NOT_AUTHORIZED: a banned member cannot change messages.' using errcode = 'P0001';
  end if;
  if p_source = 'action' then
    select m.author_id, m.body, m.deleted_at, m.created_at, coalesce(array_length(m.attachments, 1), 0) > 0,
           r.status not in ('resolved', 'denied'), public.can_see_request(m.request_id)
      into v_author, v_old, v_deleted, v_created, v_extra, v_open, v_sees
      from public.action_messages m join public.action_requests r on r.id = m.request_id
     where m.id = p_id for update of m;
  elsif p_source = 'application' then
    select m.sender_id, m.body, m.deleted_at, m.created_at, false,
           case m.app_type
             when 'owner' then exists (select 1 from public.owner_applications a where a.id = m.application_id and a.status = 'pending')
             when 'staff' then exists (select 1 from public.staff_applications a where a.id = m.application_id and a.status = 'pending')
             when 'management' then exists (select 1 from public.management_applications a where a.id = m.application_id and a.status = 'pending')
             else false end,
           public.is_staff() or public.is_commissioner() or public.owns_application(m.app_type, m.application_id)
      into v_author, v_old, v_deleted, v_created, v_extra, v_open, v_sees
      from public.application_messages m where m.id = p_id for update;
  elsif p_source = 'direct' then
    select m.sender_id, m.body, m.deleted_at, m.created_at, m.media_path is not null, true, true
      into v_author, v_old, v_deleted, v_created, v_extra, v_open, v_sees
      from public.direct_messages m where m.id = p_id for update;
  else
    raise exception 'BAD_REQUEST: unknown message source %.', p_source using errcode = '22023';
  end if;
  if v_author is null then raise exception 'NOT_FOUND: that message no longer exists.' using errcode = 'P0002'; end if;
  if v_author <> v_uid or not v_sees then
    raise exception 'NOT_AUTHORIZED: you can edit only your own messages.' using errcode = 'P0001';
  end if;
  if v_deleted is not null then raise exception 'GONE: that message was deleted.' using errcode = 'P0001'; end if;
  if not v_open then
    raise exception 'LOCKED: this has been decided, so its messages stand as the record and can no longer be changed.' using errcode = 'P0001';
  end if;
  if v_body = '' and not v_extra then
    raise exception 'EMPTY: a message needs some text. Delete it instead.' using errcode = '22023';
  end if;
  if p_source = 'direct' and length(v_body) > 2000 then
    raise exception 'TOO_LONG: a direct message holds at most 2,000 characters.' using errcode = '22023';
  end if;
  if v_body = btrim(coalesce(v_old, '')) then
    return jsonb_build_object('id', p_id, 'body', v_old, 'changed', false);
  end if;
  insert into public.message_history (source, message_id, kind, body, changed_by)
    values (p_source, p_id, 'edit', v_old, v_uid);
  if p_source = 'action' then
    update public.action_messages set body = v_body, edited_at = v_now where id = p_id;
  elsif p_source = 'application' then
    update public.application_messages set body = v_body, edited_at = v_now where id = p_id;
  else
    update public.direct_messages set body = v_body, edited_at = v_now where id = p_id;
  end if;
  perform public._rewrite_message_notices(p_source, v_created, v_old, v_body);
  return jsonb_build_object('id', p_id, 'body', v_body, 'edited_at', v_now, 'changed', true);
end $function$;
revoke all on function public.edit_message(text, uuid, text) from public, anon, authenticated;
grant execute on function public.edit_message(text, uuid, text) to authenticated;

create or replace function public.delete_message(p_source text, p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
/* v4.56 (commissioner, 2026-11-23): "allow people to edit and delete messages they send in text boxes on the website".
   Rulings: a deleted message leaves the conversation for its members and the league office keeps a copy; the author
   deletes their own only until the filing or application is decided (a direct message any time); "Commissioners and
   staff, but keep the data so other staff and commissioners can still view them." A staff member may not delete on a
   filing they made or are named in, or on their own application. The row stays, emptied, so every open view drops it
   live; the whole message goes to message_history first. Rule 1.3. */
declare
  v_uid uuid := auth.uid();
  v_author uuid; v_old text; v_deleted timestamptz; v_created timestamptz; v_detail jsonb;
  v_open boolean := false; v_sees boolean := false; v_mod boolean := false;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'NOT_AUTHORIZED: sign in to delete a message.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and coalesce(p.banned, false)) then
    raise exception 'NOT_AUTHORIZED: a banned member cannot change messages.' using errcode = 'P0001';
  end if;
  if p_source = 'action' then
    select m.author_id, m.body, m.deleted_at, m.created_at, r.status not in ('resolved', 'denied'),
           public.can_see_request(m.request_id),
           public.is_commissioner() or (public.is_staff() and r.profile_id is distinct from v_uid
                                        and r.target_profile_id is distinct from v_uid),
           jsonb_build_object('request_id', m.request_id, 'attachments', to_jsonb(m.attachments), 'internal', m.internal)
      into v_author, v_old, v_deleted, v_created, v_open, v_sees, v_mod, v_detail
      from public.action_messages m join public.action_requests r on r.id = m.request_id
     where m.id = p_id for update of m;
  elsif p_source = 'application' then
    select m.sender_id, m.body, m.deleted_at, m.created_at,
           case m.app_type
             when 'owner' then exists (select 1 from public.owner_applications a where a.id = m.application_id and a.status = 'pending')
             when 'staff' then exists (select 1 from public.staff_applications a where a.id = m.application_id and a.status = 'pending')
             when 'management' then exists (select 1 from public.management_applications a where a.id = m.application_id and a.status = 'pending')
             else false end,
           public.is_staff() or public.is_commissioner() or public.owns_application(m.app_type, m.application_id),
           public.is_commissioner() or (public.is_staff() and not public.owns_application(m.app_type, m.application_id)),
           jsonb_build_object('app_type', m.app_type, 'application_id', m.application_id)
      into v_author, v_old, v_deleted, v_created, v_open, v_sees, v_mod, v_detail
      from public.application_messages m where m.id = p_id for update;
  elsif p_source = 'direct' then
    select m.sender_id, m.body, m.deleted_at, m.created_at, true, (v_uid in (m.sender_id, m.recipient_id)), false,
           jsonb_build_object('recipient_id', m.recipient_id, 'media_path', m.media_path, 'media_type', m.media_type)
      into v_author, v_old, v_deleted, v_created, v_open, v_sees, v_mod, v_detail
      from public.direct_messages m where m.id = p_id for update;
  else
    raise exception 'BAD_REQUEST: unknown message source %.', p_source using errcode = '22023';
  end if;
  if v_author is null then raise exception 'NOT_FOUND: that message no longer exists.' using errcode = 'P0002'; end if;
  if not v_sees then raise exception 'NOT_AUTHORIZED: you cannot see that message.' using errcode = 'P0001'; end if;
  if v_deleted is not null then return jsonb_build_object('id', p_id, 'deleted_at', v_deleted, 'changed', false); end if;
  if not (v_mod or (v_author = v_uid and v_open)) then
    if v_author = v_uid then
      raise exception 'LOCKED: this has been decided, so its messages stand as the record and can no longer be changed.' using errcode = 'P0001';
    end if;
    raise exception 'NOT_AUTHORIZED: you can delete only your own messages.' using errcode = 'P0001';
  end if;
  insert into public.message_history (source, message_id, kind, body, detail, changed_by)
    values (p_source, p_id, 'delete', v_old, v_detail || jsonb_build_object('author_id', v_author), v_uid);
  if p_source = 'action' then
    update public.action_messages set body = null, attachments = '{}', deleted_at = v_now, deleted_by = v_uid where id = p_id;
  elsif p_source = 'application' then
    update public.application_messages set body = '', deleted_at = v_now, deleted_by = v_uid where id = p_id;
  else
    update public.direct_messages set body = '', media_path = null, media_type = null, deleted_at = v_now, deleted_by = v_uid
     where id = p_id;
  end if;
  perform public._rewrite_message_notices(p_source, v_created, v_old, null);
  return jsonb_build_object('id', p_id, 'deleted_at', v_now, 'changed', true);
end $function$;
revoke all on function public.delete_message(text, uuid) from public, anon, authenticated;
grant execute on function public.delete_message(text, uuid) to authenticated;

-- 5) self-checks ------------------------------------------------------------------------------------------------------
do $chk$
declare t text;
begin
  foreach t in array array['action_messages', 'application_messages', 'direct_messages'] loop
    if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = t
         and column_name in ('edited_at', 'deleted_at', 'deleted_by')) <> 3 then
      raise exception 'v4.56 check: % is missing a column', t;
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'trg_message_insert_clean') then
      raise exception 'v4.56 check: % has no insert guard', t;
    end if;
    if exists (select 1 from pg_policy where polrelid = ('public.' || t)::regclass and polcmd in ('w', 'd', '*')) then
      raise exception 'v4.56 check: % has an UPDATE or DELETE policy; the RPCs must be the only doors', t;
    end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('edit_message', 'delete_message')) <> 2 then
    raise exception 'v4.56 check: expected exactly one edit_message and one delete_message';
  end if;
  if not has_function_privilege('authenticated', 'public.edit_message(text, uuid, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.delete_message(text, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.edit_message(text, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_message(text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._rewrite_message_notices(text, timestamptz, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public._rewrite_message_notices(text, timestamptz, text, text)', 'EXECUTE') then
    raise exception 'v4.56 check: a grant is wrong';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.message_history'::regclass)
     or has_table_privilege('anon', 'public.message_history', 'SELECT')
     or has_table_privilege('authenticated', 'public.message_history', 'INSERT')
     or has_table_privilege('authenticated', 'public.message_history', 'UPDATE')
     or has_table_privilege('authenticated', 'public.message_history', 'DELETE') then
    raise exception 'v4.56 check: message_history must be RLS, office read only';
  end if;
end $chk$;

/* REHEARSAL (2026-11-23, one transaction on the live database, rolled back by a closing raise): parts 1 to 5 above,
   then a probe with real members as the subjects (a commissioner, a staff member, two members, an open filing whose
   filer is not office, a pending owner application) and test rows that died with the rollback.
   T1 a direct message inserted with edited_at and deleted_at set is born with both null (the insert guard).
   T2 its author edits it: text trimmed and saved, edited_at set, one history row holding the old text; a second edit to
      the same words changes nothing and writes no history.
   T3 the other party can neither edit nor delete it (NOT_AUTHORIZED).
   T4 as the authenticated role, a direct UPDATE and DELETE on the row touch 0 rows (no policy admits them).
   T5 its author deletes it: body emptied, deleted_at and deleted_by set, the history keeps the edited text and the
      recipient; an edit afterward is refused (GONE).
   T6 a filer's reply on an open filing rings the office's bells with its preview; the filer's edit rewrites every
      preview to the new words; once the filing is resolved the filer's edit and delete are refused (LOCKED); a
      commissioner then deletes it (body null, attachments empty) and every preview reads "A message was deleted.".
   T7 a staff member named in the filing cannot delete a message on it (NOT_AUTHORIZED); unnamed, they can.
   T8 an owner applicant edits their own message while pending; a staff member cannot edit it (NOT_AUTHORIZED) but can
      delete it.
   T9 the history: the applicant reads none of it; a commissioner reads the five filing and application rows and none of
      the direct message's.
   net.http_request_queue held 0 rows before and after.
   Result: REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 T8 T9 (pg_net queue 0 before, 0 after)
   Afterward message_history and edit_message did not exist, the three tables had none of the new columns, and
   am_nonempty was the old definition. */

-- Applied as migration v456_message_edit_delete; tools/sql/grant-audit.sql (with edit_message and delete_message added to
-- check 4, the client RPC list) returned zero rows.
