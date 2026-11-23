-- Data fix (2026-11-23): one message removed from the conversation on a management nomination, at the commissioner's
-- request: "can you remove the message from KwikTripJesus on the Bruins' Assistant GM nomination for ItzKloudzy".
-- Message 41e56302-39ed-44ed-a5f3-57c76c1cfd0e on management application 3beca9ce-70c3-4cfe-8462-e4259c227468 (BOS AGM,
-- nominee ItzKloudzy, already denied); it was the only message in that thread. The full row (text included) is kept in
-- admin_audit (action 'application_message_removed', target_id the message id), so it can be restored from there; this
-- public record leaves the text out. No notification, Discord DM or club notice carried the text, and
-- application_messages has only an AFTER INSERT trigger, so the delete sent nothing.

do $fix$
declare
  v_msg uuid := '41e56302-39ed-44ed-a5f3-57c76c1cfd0e';
  v_row public.application_messages%rowtype;
  v_n int;
begin
  select * into v_row from public.application_messages
   where id = v_msg and app_type = 'management' and application_id = '3beca9ce-70c3-4cfe-8462-e4259c227468';
  if v_row.id is null then raise exception 'precondition: the message is not the one asked for (or is already gone)'; end if;

  insert into public.admin_audit(actor, action, target_type, target_id, detail)
  values ('fa5f47dc-5380-4965-9258-82ed954b6fa7', 'application_message_removed', 'application_message', v_msg::text,
          jsonb_build_object('why', 'Commissioner asked to remove it (2026-11-23).', 'message', to_jsonb(v_row)));

  delete from public.application_messages where id = v_msg;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'the delete touched % rows, expected 1', v_n; end if;
end $fix$;

/* Applied 2026-11-23 through execute_sql (a data fix, not a migration; the live run also matched the message body).
   Read back: the message gone, the thread empty, the audit row holding the removed row. */
