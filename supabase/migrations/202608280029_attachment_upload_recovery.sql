-- 202608280029_attachment_upload_recovery.sql
-- Correctness review HIGH-2: attachment upload spans database metadata and
-- object storage without complete compensation. If the object upload succeeds
-- but the completion RPC fails (network drop, tab close, function error), the
-- object is stranded in the private bucket and the metadata row sits in
-- pending_upload with no retry token surfaced to the UI.
--
-- This migration adds a reconciliation RPC so a client or service job can
-- recover: it reconciles metadata against storage reality, finalises the row
-- when the object exists, and surfaces the retry path when it does not.
--
-- Read-only review artifact: this file has NOT been applied to any database.

-- Reconcile one attachment: the caller reports whether the object exists in
-- storage. The row is finalised to pending_scan when present, or reset to a
-- retryable upload_failed state when absent.
create or replace function public.reconcile_message_attachment_upload(
  target_household uuid,
  target_attachment uuid,
  object_exists boolean,
  content_sha256 text default null
) returns table(
  attachment_id uuid,
  attachment_status text,
  object_path text,
  needs_reupload boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  attachment_row public.case_attachments%rowtype;
begin
  if not public.is_household_member(target_household) then
    raise exception 'household membership required';
  end if;

  select * into attachment_row
  from public.case_attachments
  where id = target_attachment and household_id = target_household
  for update;
  if not found then raise exception 'attachment not found'; end if;

  -- Only the original uploader (or staff) may reconcile.
  if attachment_row.uploaded_by <> auth.uid()
     and not public.has_household_role(
       target_household, array['educator','admin']::public.membership_role[]
     ) then
    raise exception 'only the original uploader may reconcile this attachment';
  end if;

  if object_exists then
    -- Object is present: finalise to pending_scan so the scanner owns it next.
    if attachment_row.status not in ('pending_upload','upload_failed','pending_scan') then
      raise exception 'attachment is already finalised';
    end if;
    update public.case_attachments
       set status = 'pending_scan',
           sha256 = coalesce(content_sha256, sha256),
           uploaded_at = coalesce(uploaded_at, now())
     where id = target_attachment
     returning * into attachment_row;

    insert into public.audit_events(
      household_id, actor_user_id, event_type, subject_type, subject_id, metadata
    ) values (
      target_household, auth.uid(), 'attachment.reconciled_present', 'case_attachment',
      target_attachment,
      jsonb_build_object('caseId', attachment_row.case_id, 'messageId', attachment_row.message_id)
    );
  else
    -- Object is missing: make the row retryable again rather than stranding it.
    if attachment_row.status not in ('pending_upload','pending_scan') then
      raise exception 'attachment cannot be reset from status %', attachment_row.status;
    end if;
    update public.case_attachments
       set status = 'upload_failed'
     where id = target_attachment
     returning * into attachment_row;

    insert into public.audit_events(
      household_id, actor_user_id, event_type, subject_type, subject_id, metadata
    ) values (
      target_household, auth.uid(), 'attachment.reconciled_absent', 'case_attachment',
      target_attachment,
      jsonb_build_object('caseId', attachment_row.case_id, 'messageId', attachment_row.message_id)
    );
  end if;

  attachment_id := attachment_row.id;
  attachment_status := attachment_row.status;
  object_path := attachment_row.object_path;
  needs_reupload := attachment_row.status = 'upload_failed';
  return next;
end $$;

revoke all on function public.reconcile_message_attachment_upload(uuid, uuid, boolean, text) from public;
revoke all on function public.reconcile_message_attachment_upload(uuid, uuid, boolean, text) from anon;
grant execute on function public.reconcile_message_attachment_upload(uuid, uuid, boolean, text) to authenticated, service_role;

-- Service-role sweep: find attachments stranded mid-upload so a job can
-- reconcile them against storage. Bounded and read-only.
create or replace function public.admin_stranded_attachment_uploads(
  older_than interval default '15 minutes',
  batch_limit integer default 200
) returns table(
  attachment_id uuid,
  household_ref uuid,
  object_path text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select ca.id, ca.household_id, ca.object_path, ca.status, ca.created_at
  from public.case_attachments ca
  where ca.status in ('pending_upload','upload_failed')
    and ca.created_at < now() - older_than
  order by ca.created_at
  limit greatest(1, least(coalesce(batch_limit, 200), 2000));
end $$;

revoke all on function public.admin_stranded_attachment_uploads(interval, integer) from public, authenticated, anon;
grant execute on function public.admin_stranded_attachment_uploads(interval, integer) to service_role;

-- Regression assertion: the reconcile RPC must be reachable by members, and the
-- service sweep must not be reachable by clients.
do $$
declare client_can_see text;
begin
  select string_agg(distinct grantee, ', ')
  into client_can_see
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name = 'admin_stranded_attachment_uploads'
    and privilege_type = 'EXECUTE'
    and grantee in ('authenticated', 'anon', 'PUBLIC');

  if client_can_see is not null then
    raise exception 'stranded-upload sweep exposed to client roles: %', client_can_see;
  end if;

  if not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'reconcile_message_attachment_upload'
      and privilege_type = 'EXECUTE'
      and grantee = 'authenticated'
  ) then
    raise exception 'reconcile RPC was not granted to authenticated';
  end if;
end $$;
