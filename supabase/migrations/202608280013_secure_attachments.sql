-- Quarantined case-message attachment metadata. Binary objects live in the private case-attachments bucket.

create table public.case_attachments(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  case_id uuid not null references public.service_cases(id) on delete cascade,
  message_id uuid not null references public.case_messages(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  object_path text not null unique check(char_length(object_path) between 20 and 500),
  file_name text not null check(char_length(file_name) between 1 and 180 and file_name !~ '[\\/]'),
  mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','text/plain')),
  size_bytes integer not null check(size_bytes between 1 and 10485760),
  sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending_upload' check(status in ('pending_upload','pending_scan','clean','rejected','upload_failed')),
  uploaded_at timestamptz,
  scanned_at timestamptz,
  scan_provider text check(scan_provider is null or char_length(scan_provider) between 2 and 80),
  scan_result_code text check(scan_result_code is null or char_length(scan_result_code) between 2 and 80),
  created_at timestamptz not null default now(),
  check((status in ('pending_upload','upload_failed') and scanned_at is null) or status='pending_scan' or (status in ('clean','rejected') and scanned_at is not null and scan_provider is not null and scan_result_code is not null))
);
alter table public.case_attachments enable row level security;
create policy case_attachments_member_select on public.case_attachments for select using(public.is_household_member(household_id) and (status='clean' or uploaded_by=auth.uid() or public.has_household_role(household_id,array['educator','admin']::public.membership_role[])));
create index case_attachments_message_idx on public.case_attachments(message_id,created_at);
create index case_attachments_pending_scan_idx on public.case_attachments(created_at) where status='pending_scan';

create or replace function public.create_message_attachment_upload(target_household uuid,target_message uuid,attachment_file_name text,attachment_mime_type text,attachment_size_bytes integer)
returns table(attachment_id uuid,object_path text,attachment_status text)
language plpgsql security definer set search_path=public
as $$
declare message_row public.case_messages%rowtype;new_attachment uuid;new_path text;existing_count integer;existing_bytes bigint;
begin
  if not public.is_household_member(target_household) then raise exception 'household membership required';end if;
  if char_length(btrim(attachment_file_name)) not between 1 and 180 or attachment_file_name ~ '[\\/]' then raise exception 'attachment file name is invalid';end if;
  if attachment_mime_type not in ('application/pdf','image/jpeg','image/png','text/plain') or attachment_size_bytes not between 1 and 10485760 then raise exception 'attachment type or size is invalid';end if;
  select * into message_row from public.case_messages where id=target_message and household_id=target_household and sender_user_id=auth.uid();if not found then raise exception 'owned message not found';end if;
  select count(*)::integer,coalesce(sum(size_bytes),0) into existing_count,existing_bytes from public.case_attachments where message_id=target_message and status<>'upload_failed';
  if existing_count>=3 or existing_bytes+attachment_size_bytes>20971520 then raise exception 'message attachment limit exceeded';end if;
  new_attachment:=gen_random_uuid();new_path:=target_household::text||'/'||message_row.case_id::text||'/'||target_message::text||'/'||new_attachment::text;
  insert into public.case_attachments(id,household_id,case_id,message_id,uploaded_by,object_path,file_name,mime_type,size_bytes) values(new_attachment,target_household,message_row.case_id,target_message,auth.uid(),new_path,btrim(attachment_file_name),attachment_mime_type,attachment_size_bytes);
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'attachment.upload_created','case_attachment',new_attachment,jsonb_build_object('caseId',message_row.case_id,'messageId',target_message,'mimeType',attachment_mime_type,'sizeBytes',attachment_size_bytes));
  return query select new_attachment,new_path,'pending_upload';
end $$;

create or replace function public.complete_message_attachment_upload(target_household uuid,target_attachment uuid,content_sha256 text,upload_succeeded boolean)
returns table(attachment_id uuid,attachment_status text,uploaded_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare attachment_row public.case_attachments%rowtype;completed timestamptz:=now();next_status text;
begin
  if not public.is_household_member(target_household) then raise exception 'household membership required';end if;
  if upload_succeeded and content_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'attachment checksum is invalid';end if;
  select * into attachment_row from public.case_attachments where id=target_attachment and household_id=target_household and uploaded_by=auth.uid() and status='pending_upload' for update;if not found then raise exception 'pending owned attachment not found';end if;
  next_status:=case when upload_succeeded then 'pending_scan' else 'upload_failed' end;
  update public.case_attachments set status=next_status,sha256=case when upload_succeeded then content_sha256 end,uploaded_at=case when upload_succeeded then completed end where id=target_attachment;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),case when upload_succeeded then 'attachment.uploaded' else 'attachment.upload_failed' end,'case_attachment',target_attachment,jsonb_build_object('caseId',attachment_row.case_id,'messageId',attachment_row.message_id));
  return query select target_attachment,next_status,case when upload_succeeded then completed end;
end $$;

create or replace function public.admin_review_message_attachment(target_household uuid,target_attachment uuid,review_decision text,scanner_name text,scanner_result_code text)
returns table(attachment_id uuid,attachment_status text,scanned_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare attachment_row public.case_attachments%rowtype;reviewed timestamptz:=now();
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required';end if;
  if review_decision not in ('clean','rejected') or char_length(btrim(scanner_name)) not between 2 and 80 or char_length(btrim(scanner_result_code)) not between 2 and 80 then raise exception 'attachment scan result is invalid';end if;
  select * into attachment_row from public.case_attachments where id=target_attachment and household_id=target_household and status='pending_scan' for update;if not found then raise exception 'pending attachment scan not found';end if;
  update public.case_attachments set status=review_decision,scanned_at=reviewed,scan_provider=btrim(scanner_name),scan_result_code=btrim(scanner_result_code) where id=target_attachment;
  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata) values(target_household,auth.uid(),'attachment.scan_reviewed','case_attachment',target_attachment,jsonb_build_object('caseId',attachment_row.case_id,'messageId',attachment_row.message_id,'decision',review_decision,'scanner',btrim(scanner_name),'resultCode',btrim(scanner_result_code)));
  return query select target_attachment,review_decision,reviewed;
end $$;

revoke all on function public.create_message_attachment_upload(uuid,uuid,text,text,integer) from public;
revoke all on function public.complete_message_attachment_upload(uuid,uuid,text,boolean) from public;
revoke all on function public.admin_review_message_attachment(uuid,uuid,text,text,text) from public;
grant execute on function public.create_message_attachment_upload(uuid,uuid,text,text,integer) to authenticated;
grant execute on function public.complete_message_attachment_upload(uuid,uuid,text,boolean) to authenticated;
grant execute on function public.admin_review_message_attachment(uuid,uuid,text,text,text) to authenticated;
