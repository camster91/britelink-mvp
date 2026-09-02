-- Recover a failed binary upload without creating a second message or attachment record.

create or replace function public.retry_message_attachment_upload(target_household uuid,target_attachment uuid)
returns table(attachment_id uuid,object_path text,attachment_status text)
language plpgsql security definer set search_path=public
as $$
declare attachment_row public.case_attachments%rowtype;
begin
  if not public.is_household_member(target_household) then raise exception 'household membership required';end if;
  select * into attachment_row from public.case_attachments where id=target_attachment and household_id=target_household and uploaded_by=auth.uid() and status='upload_failed' for update;
  if not found then raise exception 'failed owned attachment not found';end if;
  update public.case_attachments set status='pending_upload',sha256=null,uploaded_at=null where id=target_attachment;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  values(target_household,auth.uid(),'attachment.upload_retried','case_attachment',target_attachment,jsonb_build_object('caseId',attachment_row.case_id,'messageId',attachment_row.message_id));
  return query select target_attachment,attachment_row.object_path,'pending_upload';
end $$;

revoke all on function public.retry_message_attachment_upload(uuid,uuid) from public;
grant execute on function public.retry_message_attachment_upload(uuid,uuid) to authenticated;
