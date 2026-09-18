-- Malware-scan adapter trust boundary and rejected/orphan-object alerting.
--
-- docs/ATTACHMENT_OPERATIONS.md lists six deployment requirements. Three already existed
-- (the private bucket and its policies, the quarantine states, and the owner-upload /
-- clean-download rules). This migration adds the remaining ones:
--   * a server-adapter-only RPC that records a scan verdict (never a browser control),
--   * object reconciliation, so "rejected objects appear" and "metadata exists without a
--     matching object" become observable rather than assumed,
--   * privacy-minimal signals for both, plus a signal for the case where nobody has
--     reconciled at all.
--
-- Fail-closed by design: case_attachments has no 'scan_failed' state, and deliberately so.
-- A scanner outage must leave the object in pending_scan quarantine, which escalates through
-- the existing attachment.scan_stale signal after 15 minutes. There is no path by which a
-- failed scan can make an object downloadable.
--
-- These functions are NOT granted to authenticated. The scanner holds service credentials
-- and is not a household member, so a household admin cannot drive them -- and a client can
-- never mark its own upload clean, which is the property that matters most here.

-- Current-state mirror of the private bucket, written only by the reconciling adapter.
-- Household-scoped and cascading like every other household table; it is not an audit
-- record, so losing it with the household is correct.
create table public.attachment_object_observations(
  household_id uuid not null references public.households(id) on delete cascade,
  object_path text not null check(char_length(object_path) between 20 and 500),
  observed_at timestamptz not null default now(),
  primary key (household_id, object_path)
);
alter table public.attachment_object_observations enable row level security;
-- Intentionally no policies: 202608280014 grants authenticated select on tables created
-- after it, so a select grant will exist -- RLS with no policy is what denies every row.

-- Records a scan verdict. Only the scanner adapter may call this.
--
-- The local copies of the parameters are load-bearing, not decoration. plpgsql resolves a
-- bare name against BOTH the function's parameters and the columns of any table in scope, so
-- "scan_provider" and "scan_result_code" collide with case_attachments' own columns and the
-- UPDATE below is genuinely ambiguous -- the harness caught that as a runtime error the first
-- time a verdict was recorded. Qualifying with a block label does NOT fix it: parameters live
-- in an implicit block outside the labelled body, so "lbl.scan_provider" fails to parse
-- (verified against Postgres 16: 'missing FROM-clause entry for table "lbl"').
-- Copying into distinctly-named locals is explicit, needs no pragma, and leaves the RPC's
-- argument names -- which are the adapter's published interface -- untouched.
create or replace function public.admin_record_attachment_scan(
  target_household uuid,
  target_attachment uuid,
  scan_provider text,
  scan_verdict text,
  scan_result_code text,
  content_sha256 text default null
) returns table(attachment_id uuid,attachment_status text,scanned_at timestamptz,already_recorded boolean)
language plpgsql security definer set search_path=public
as $$
declare
  attachment_row public.case_attachments%rowtype;
  recorded timestamptz:=now();
  provider text:=btrim(scan_provider);
  verdict text:=scan_verdict;
  result_code text:=scan_result_code;
  content_digest text:=content_sha256;
begin
  -- Each null check is explicit. "char_length(x) not between 2 and 80" evaluates to NULL when
  -- x is NULL, and a plpgsql IF treats NULL as false -- so without the "is null or" a null
  -- provider or verdict would sail through validation and only fail later on a table
  -- constraint, with an error that says nothing about the real problem.
  if provider is null or char_length(provider) not between 2 and 80 then raise exception 'scan provider is invalid';end if;
  if verdict is null or verdict not in ('clean','rejected') then raise exception 'scan verdict must be clean or rejected';end if;
  -- Bounded and structured: a result code must never become a place to put a file name,
  -- a subject line, or an error message containing content.
  if result_code is null or result_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$' then raise exception 'scan result code is invalid';end if;
  -- A digest is optional: an attachment uploaded without one has nothing to compare against.
  if content_digest is not null and content_digest !~ '^[a-f0-9]{64}$' then raise exception 'scanned content digest is invalid';end if;

  select * into attachment_row from public.case_attachments
   where id=target_attachment and household_id=target_household for update;
  if not found then raise exception 'attachment not found in household';end if;

  -- The digest proves the adapter scanned the same bytes the browser hashed. A mismatch
  -- means the object changed under us, which must never be recorded as a verdict.
  if content_digest is not null and attachment_row.sha256 is not null and content_digest<>attachment_row.sha256 then
    raise exception 'scanned content digest does not match the uploaded attachment';
  end if;

  -- Terminal verdicts are final. Re-running the same verdict is a no-op so the adapter is
  -- retry-safe; flipping clean to rejected (or back) is refused rather than silently
  -- ignored, because a signature refresh is an operator decision, not an adapter one.
  if attachment_row.status in ('clean','rejected') then
    if attachment_row.status<>verdict then
      raise exception 'attachment scan verdict is already final as %', attachment_row.status;
    end if;
    return query select attachment_row.id,attachment_row.status,attachment_row.scanned_at,true;
    return;
  end if;

  -- A binary that never uploaded has nothing to scan; scanning it would be a false clean.
  if attachment_row.status<>'pending_scan' then
    raise exception 'attachment is not awaiting a scan (status %)', attachment_row.status;
  end if;

  update public.case_attachments
     set status=verdict,scanned_at=recorded,scan_provider=provider,scan_result_code=result_code
   where id=target_attachment;

  insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  values(target_household,null,'attachment.scan_recorded','case_attachment',target_attachment,
         jsonb_build_object('provider',provider,'verdict',verdict,'resultCode',result_code));

  -- A rejected upload is a security event, not just a state change. Recording it in
  -- operational_events makes it alertable through the existing monitors too.
  -- occurred_at has no default and is NOT NULL, so it must be supplied (as 011 and 018 do);
  -- for a scan verdict the event happened when the verdict was recorded.
  if verdict='rejected' then
    insert into public.operational_events(household_id,actor_user_id,component,severity,event_code,metadata,occurred_at)
    values(target_household,null,'attachment_scanner','critical','attachment.scan_rejected',
           jsonb_build_object('operation','attachment.scan','provider',provider,'errorCode',result_code),recorded);
  end if;

  return query select target_attachment,verdict,recorded,false;
end $$;

-- The adapter's work queue. Deliberately NOT household-scoped: the scanner is a service
-- job that sweeps all households. Defining the queue here means the adapter does not depend
-- on implicit service_role table grants, and the shape of what a scanner may see is ours.
create or replace function public.admin_list_pending_scan_attachments(max_rows integer default 25)
returns table(household_id uuid,attachment_id uuid,object_path text,size_bytes integer,sha256 text,created_at timestamptz)
language plpgsql security definer set search_path=public
as $$
begin
  if max_rows not between 1 and 500 then raise exception 'max_rows is invalid';end if;
  return query
    select ca.household_id,ca.id,ca.object_path,ca.size_bytes,ca.sha256,ca.created_at
      from public.case_attachments ca
     where ca.status='pending_scan'
     order by ca.created_at
     limit max_rows;
end $$;

-- Replaces the observed object set for one household. The adapter obtains the listing with
-- service credentials; SQL cannot enumerate a bucket on its own.
create or replace function public.admin_reconcile_attachment_objects(target_household uuid,present_object_paths text[])
returns table(observed_count bigint,observed_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare reconciled timestamptz:=now(); paths text[]:=coalesce(present_object_paths,array[]::text[]); observed bigint;
begin
  if not exists(select 1 from public.households where id=target_household) then raise exception 'household not found';end if;
  if array_length(paths,1)>10000 then raise exception 'object listing is too large to reconcile';end if;
  if exists(select 1 from unnest(paths) as p where char_length(p) not between 20 and 500) then raise exception 'object listing contains an invalid path';end if;

  delete from public.attachment_object_observations where household_id=target_household;
  insert into public.attachment_object_observations(household_id,object_path,observed_at)
  select target_household,p,reconciled from (select distinct p from unnest(paths) as p) as unique_paths;
  select count(*) into observed from public.attachment_object_observations where household_id=target_household;
  return query select observed,reconciled;
end $$;

-- Integrity signals, in the same shape as admin_operational_health_snapshot (202608280015).
create or replace function public.admin_attachment_integrity_snapshot(target_household uuid,evaluated_at timestamptz default now())
returns table(signal_code text,severity text,entity_count bigint,oldest_at timestamptz,threshold_seconds integer)
language plpgsql security definer set search_path=public
as $$
begin
  if not public.has_household_role(target_household,array['admin']::public.membership_role[]) then raise exception 'admin access required';end if;
  if evaluated_at>now()+interval '5 minutes' or evaluated_at<now()-interval '1 hour' then raise exception 'integrity evaluation time is invalid';end if;
  return query select integrity.* from (
    -- Malware reached the bucket and was quarantined. Always worth surfacing, however old.
    select 'attachment.rejected_present'::text as signal_code,'critical'::text as severity,count(*) as entity_count,min(ca.scanned_at) as oldest_at,0 as threshold_seconds
      from public.case_attachments ca where ca.household_id=target_household and ca.status='rejected' having count(*)>0
    -- Metadata with no object behind it: the guardian sees an attachment that cannot be fetched.
    union all select 'attachment.metadata_orphaned','error',count(*),min(ca.created_at),0
      from public.case_attachments ca
     where ca.household_id=target_household and ca.status in ('pending_scan','clean','rejected')
       and exists(select 1 from public.attachment_object_observations o where o.household_id=target_household)
       and not exists(select 1 from public.attachment_object_observations o where o.household_id=target_household and o.object_path=ca.object_path) having count(*)>0
    -- An object nobody references: either a lost upload or a failed delete of rejected content.
    union all select 'attachment.object_orphaned','warning',count(*),min(o.observed_at),0
      from public.attachment_object_observations o
     where o.household_id=target_household
       and not exists(select 1 from public.case_attachments ca where ca.household_id=target_household and ca.object_path=o.object_path) having count(*)>0
    -- Nobody has reconciled, or not recently. Without this the two orphan signals above are
    -- silently empty and read as healthy, which is exactly the vacuous-green failure mode
    -- this project has already been burned by.
    union all select 'attachment.reconciliation_stale','warning',count(*),min(ca.created_at),3600
      from public.case_attachments ca
      left join (select max(o.observed_at) as observed_at from public.attachment_object_observations o where o.household_id=target_household) recent on true
     where ca.household_id=target_household and ca.status in ('pending_scan','clean','rejected')
       and (recent.observed_at is null or recent.observed_at<evaluated_at-interval '1 hour') having count(*)>0
  ) as integrity
  order by case integrity.severity when 'critical' then 1 when 'error' then 2 else 3 end,integrity.signal_code;
end $$;

revoke all on function public.admin_record_attachment_scan(uuid,uuid,text,text,text,text) from public;
revoke all on function public.admin_reconcile_attachment_objects(uuid,text[]) from public;
revoke all on function public.admin_list_pending_scan_attachments(integer) from public;

revoke all on function public.admin_attachment_integrity_snapshot(uuid,timestamptz) from public;
grant execute on function public.admin_attachment_integrity_snapshot(uuid,timestamptz) to authenticated;
