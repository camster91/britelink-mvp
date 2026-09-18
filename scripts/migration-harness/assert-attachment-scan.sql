-- Behavioural assertions for 202608280023_attachment_scan_adapter.sql.
--
-- Run after assert-retention-execution.sql, against the same throwaway Postgres. Kept in its
-- own file and its own UUID namespace because the retention run deletes household b01 and
-- leaves b02 mutated; sharing fixtures would make failures point at the wrong migration.
--
-- Every check raises on failure, so psql -v ON_ERROR_STOP=1 exits non-zero.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Trust boundary: no client role can reach the writer functions, and the one
--    function that IS client-reachable is admin-gated. This is the property that
--    matters most -- a client can never mark its own upload clean.
-- ---------------------------------------------------------------------------
do $$
declare policies int; rls boolean;
begin
  if has_function_privilege('authenticated','public.admin_record_attachment_scan(uuid,uuid,text,text,text,text)','execute') then
    raise exception 'ASSERT FAILED: authenticated can record its own scan verdict';
  end if;
  if has_function_privilege('anon','public.admin_record_attachment_scan(uuid,uuid,text,text,text,text)','execute') then
    raise exception 'ASSERT FAILED: anon can record a scan verdict';
  end if;
  if has_function_privilege('authenticated','public.admin_reconcile_attachment_objects(uuid,text[])','execute') then
    raise exception 'ASSERT FAILED: authenticated can rewrite the observed object set';
  end if;
  -- The work queue crosses household boundaries, so it must not be client-reachable.
  if has_function_privilege('authenticated','public.admin_list_pending_scan_attachments(integer)','execute') then
    raise exception 'ASSERT FAILED: authenticated can enumerate every household''s pending scans';
  end if;
  if not has_function_privilege('authenticated','public.admin_attachment_integrity_snapshot(uuid,timestamptz)','execute') then
    raise exception 'ASSERT FAILED: the admin-gated snapshot should be reachable by authenticated';
  end if;

  -- 202608280014 grants authenticated select on tables created after it, so the grant DOES
  -- exist here; RLS with no policy is what denies the rows. Asserting the grant is present
  -- keeps this from being a vacuous statement about privileges that were never issued.
  if not has_table_privilege('authenticated','public.attachment_object_observations','select') then
    raise exception 'ASSERT FAILED: expected 014 to grant authenticated select, so RLS is the only barrier';
  end if;
  select count(*) into policies from pg_policies where schemaname='public' and tablename='attachment_object_observations';
  select relrowsecurity into rls from pg_class where oid='public.attachment_object_observations'::regclass;
  if policies<>0 then raise exception 'ASSERT FAILED: the observation table has % policy(ies)', policies; end if;
  if rls is not true then raise exception 'ASSERT FAILED: the observation table has RLS disabled'; end if;
  raise notice 'ok 1: scan writers are service-only; the snapshot is admin-gated and RLS denies the rest';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Seed one household with attachments in every status the adapter distinguishes.
-- ---------------------------------------------------------------------------
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-000000000a05','scan-admin@example.test'),
  ('00000000-0000-0000-0000-000000000a06','scan-educator@example.test');

insert into public.households(id,display_name) values
  ('00000000-0000-0000-0000-000000000b11','Household Scan'),
  ('00000000-0000-0000-0000-000000000b12','Household Unreconciled');

-- Deliberately an educator, not an admin: a non-admin household member must not be able to
-- drive any of these functions either.
insert into public.memberships(household_id,user_id,role) values
  ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000a05','admin'),
  ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000a06','educator'),
  ('00000000-0000-0000-0000-000000000b12','00000000-0000-0000-0000-000000000a05','admin');

insert into public.learners(id,household_id,preferred_name,grade_label,jurisdiction) values
  ('00000000-0000-0000-0000-000000000c11','00000000-0000-0000-0000-000000000b11','Scan Learner','5','Ontario'),
  ('00000000-0000-0000-0000-000000000c12','00000000-0000-0000-0000-000000000b12','Quiet Learner','5','Ontario');

insert into public.service_cases(id,household_id,learner_id,package_code,status) values
  ('00000000-0000-0000-0000-000000000d11','00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000c11','essentials','paid'),
  ('00000000-0000-0000-0000-000000000d12','00000000-0000-0000-0000-000000000b12','00000000-0000-0000-0000-000000000c12','essentials','paid');

insert into public.case_messages(id,household_id,case_id,sender_user_id,body) values
  ('00000000-0000-0000-0000-000000000e11','00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000d11','00000000-0000-0000-0000-000000000a05','Assessment attached'),
  ('00000000-0000-0000-0000-000000000e12','00000000-0000-0000-0000-000000000b12','00000000-0000-0000-0000-000000000d12','00000000-0000-0000-0000-000000000a05','Worksheet attached');

-- f11: pending_scan WITH a digest -> exercises the digest-mismatch refusal
-- f12: pending_scan WITHOUT a digest -> exercises the branch where no digest is compared
-- f13: already clean -> exercises "terminal verdicts are final"
-- f14: pending_upload -> exercises "not awaiting a scan"; a binary that never uploaded must
--      never be scannable, because scanning it would produce a false clean.
insert into public.case_attachments(id,household_id,case_id,message_id,uploaded_by,object_path,file_name,mime_type,size_bytes,sha256,status,scanned_at,scan_provider,scan_result_code) values
  ('00000000-0000-0000-0000-000000000f11','00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000d11','00000000-0000-0000-0000-000000000e11','00000000-0000-0000-0000-000000000a05','household-b11/case-d11/msg-e11/f11.pdf','assessment.pdf','application/pdf',2048,encode(digest('real uploaded bytes','sha256'),'hex'),'pending_scan',null,null,null),
  ('00000000-0000-0000-0000-000000000f12','00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000d11','00000000-0000-0000-0000-000000000e11','00000000-0000-0000-0000-000000000a05','household-b11/case-d11/msg-e11/f12.pdf','worksheet.pdf','application/pdf',4096,null,'pending_scan',null,null,null),
  ('00000000-0000-0000-0000-000000000f13','00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000d11','00000000-0000-0000-0000-000000000e11','00000000-0000-0000-0000-000000000a05','household-b11/case-d11/msg-e11/f13.pdf','scan.pdf','application/pdf',512,encode(digest('already scanned','sha256'),'hex'),'clean',now()-interval '2 hours','clamav','ok'),
  ('00000000-0000-0000-0000-000000000f14','00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000d11','00000000-0000-0000-0000-000000000e11','00000000-0000-0000-0000-000000000a05','household-b11/case-d11/msg-e11/f14.pdf','never-uploaded.pdf','application/pdf',1024,null,'pending_upload',null,null,null),
  -- Sits in the unreconciled household so attachment.reconciliation_stale has something to count.
  ('00000000-0000-0000-0000-000000001f11','00000000-0000-0000-0000-000000000b12','00000000-0000-0000-0000-000000000d12','00000000-0000-0000-0000-000000000e12','00000000-0000-0000-0000-000000000a05','household-b12/case-d12/msg-e12/1f11.pdf','worksheet.pdf','application/pdf',1024,null,'pending_scan',null,null,null);

do $$
declare seeded_atts int; seeded_pending int;
begin
  -- Scoped to this file's fixtures so a second assertion file cannot break these counts.
  select count(*) into seeded_atts from public.case_attachments
   where id in ('00000000-0000-0000-0000-000000000f11','00000000-0000-0000-0000-000000000f12',
                '00000000-0000-0000-0000-000000000f13','00000000-0000-0000-0000-000000000f14',
                '00000000-0000-0000-0000-000000001f11');
  select count(*) into seeded_pending from public.admin_list_pending_scan_attachments(500)
   where attachment_id in ('00000000-0000-0000-0000-000000000f11','00000000-0000-0000-0000-000000000f12','00000000-0000-0000-0000-000000001f11');
  if seeded_atts<>5 then raise exception 'ASSERT FAILED: expected 5 seeded attachments, found %', seeded_atts; end if;
  if seeded_pending<>3 then raise exception 'ASSERT FAILED: expected 3 pending scans, found %', seeded_pending; end if;
  if exists (select 1 from public.admin_list_pending_scan_attachments(500) where attachment_id in ('00000000-0000-0000-0000-000000000f13','00000000-0000-0000-0000-000000000f14')) then
    raise exception 'ASSERT FAILED: the queue returned an attachment that is not pending_scan';
  end if;
  -- The queue is deliberately NOT household-scoped: the scanner is a service job sweeping all
  -- households, and scoping it per household would let one household's backlog starve another.
  if (select count(distinct household_id) from public.admin_list_pending_scan_attachments(500))<2 then
    raise exception 'ASSERT FAILED: the scan queue is not sweeping every household';
  end if;
  raise notice 'ok 2: seeded 5 attachments; the queue sweeps households and returns only pending scans';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The recorder validates its inputs instead of trusting the adapter.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean;
begin
  refused:=false;
  begin perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','x','clean','ok',null);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: accepted a 1-character provider'; end if;

  refused:=false;
  begin perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','   ','clean','ok',null);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: accepted a whitespace-only provider'; end if;

  refused:=false;
  begin perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav','maybe','ok',null);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: accepted a verdict of "maybe"'; end if;

  refused:=false;
  begin perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav','clean','has space',null);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: accepted a result code containing a space'; end if;

  refused:=false;
  begin perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav','clean','-leading-dash',null);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: accepted a result code that does not start alphanumeric'; end if;

  refused:=false;
  begin perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav','clean','a',null);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: accepted a 1-character result code'; end if;

  refused:=false;
  begin perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav','clean',null,null);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: accepted a null result code'; end if;

  -- NULL needs its own cases. "char_length(x) not between 2 and 80" is NULL when x is NULL,
  -- and a plpgsql IF treats NULL as false, so a null provider or verdict passes a validation
  -- that was not written with an explicit null check. These two assertions are what caught it.
  refused:=false;
  begin perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11',null,'clean','ok',null);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: accepted a null provider'; end if;

  refused:=false;
  begin perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav',null,'ok',null);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: accepted a null verdict'; end if;

  -- And it must be the recorder's own message, not a table constraint firing later: a
  -- confusing error here is how the gap stayed invisible.
  begin
    perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11',null,'clean','ok',null);
  exception when others then
    if sqlerrm not like '%scan provider is invalid%' then
      raise exception 'ASSERT FAILED: a null provider failed for the wrong reason: %', sqlerrm;
    end if;
  end;
  begin
    perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav',null,'ok',null);
  exception when others then
    if sqlerrm not like '%scan verdict must be%' then
      raise exception 'ASSERT FAILED: a null verdict failed for the wrong reason: %', sqlerrm;
    end if;
  end;

  -- Nothing above may have left the attachment touched.
  if (select status from public.case_attachments where id='00000000-0000-0000-0000-000000000f11')<>'pending_scan' then
    raise exception 'ASSERT FAILED: a rejected input still changed the attachment status';
  end if;
  raise notice 'ok 3: the recorder rejects malformed providers, verdicts, and result codes';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The digest is compared, and a mismatch is refused rather than recorded.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean:=false;
begin
  begin
    perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav','clean','ok',encode(digest('different bytes','sha256'),'hex'));
  exception when others then
    refused:=true;
    if sqlerrm not like '%does not match%' then raise exception 'ASSERT FAILED: unexpected error for a digest mismatch: %',sqlerrm; end if;
  end;
  if not refused then raise exception 'ASSERT FAILED: a digest mismatch was accepted as a verdict'; end if;
  if (select status from public.case_attachments where id='00000000-0000-0000-0000-000000000f11')<>'pending_scan' then
    raise exception 'ASSERT FAILED: a refused digest still changed the attachment status';
  end if;

  -- A malformed digest never reaches the comparison either.
  refused:=false;
  begin
    perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav','clean','ok','not-a-digest');
  exception when others then refused:=true;
  end;
  if not refused then raise exception 'ASSERT FAILED: a malformed digest was accepted'; end if;
  raise notice 'ok 4: scanned content must match the uploaded digest, and nothing is recorded on a mismatch';
end $$;

-- ---------------------------------------------------------------------------
-- 5. A clean verdict is recorded once, is retry-safe, and cannot be flipped.
-- ---------------------------------------------------------------------------
do $$
declare already boolean; audits_before int; audits_after int; status_after text; provider_after text;
begin
  select count(*) into audits_before from public.audit_events where household_id='00000000-0000-0000-0000-000000000b11' and event_type='attachment.scan_recorded';

  select r.already_recorded into already from public.admin_record_attachment_scan(
    '00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav','clean','ok',
    (select sha256 from public.case_attachments where id='00000000-0000-0000-0000-000000000f11')) as r;
  if already is not false then raise exception 'ASSERT FAILED: first record reported already_recorded=%', already; end if;

  select status,scan_provider into status_after,provider_after from public.case_attachments where id='00000000-0000-0000-0000-000000000f11';
  if status_after<>'clean' then raise exception 'ASSERT FAILED: status is % after a clean verdict', status_after; end if;
  if provider_after<>'clamav' then raise exception 'ASSERT FAILED: provider is % after a clean verdict', provider_after; end if;
  if not exists (select 1 from public.case_attachments where id='00000000-0000-0000-0000-000000000f11' and scanned_at is not null) then
    raise exception 'ASSERT FAILED: a clean verdict left scanned_at null, violating the 013 check constraint';
  end if;
  if not exists (select 1 from public.audit_events where household_id='00000000-0000-0000-0000-000000000b11' and event_type='attachment.scan_recorded' and subject_id='00000000-0000-0000-0000-000000000f11') then
    raise exception 'ASSERT FAILED: no audit event was written for the clean verdict';
  end if;
  -- A clean verdict is not a security incident, so it must not raise an operational alert.
  if exists (select 1 from public.operational_events where household_id='00000000-0000-0000-0000-000000000b11' and event_code='attachment.scan_rejected') then
    raise exception 'ASSERT FAILED: a clean verdict raised a rejection alert';
  end if;

  -- Retry-safe: an adapter that re-runs after a crash must not error or double-record.
  select r.already_recorded into already from public.admin_record_attachment_scan(
    '00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav','clean','ok') as r;
  if already is not true then raise exception 'ASSERT FAILED: a repeated identical verdict reported already_recorded=%', already; end if;
  select count(*) into audits_after from public.audit_events where household_id='00000000-0000-0000-0000-000000000b11' and event_type='attachment.scan_recorded';
  if audits_after<>audits_before+1 then raise exception 'ASSERT FAILED: the audit trail grew from % to % across a retry', audits_before, audits_after; end if;

  -- Flipping a terminal verdict is an operator decision, not an adapter one.
  begin
    perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f11','clamav','rejected','Eicar-Test-Signature');
    raise exception 'ASSERT FAILED: a clean verdict was flipped to rejected';
  exception when others then
    if sqlerrm like '%ASSERT FAILED%' then raise; end if;
    if sqlerrm not like '%already final%' then raise exception 'ASSERT FAILED: unexpected error flipping a verdict: %',sqlerrm; end if;
  end;
  raise notice 'ok 5: a clean verdict is recorded once, retry-safe, and cannot be flipped';
end $$;

-- ---------------------------------------------------------------------------
-- 6. A rejected verdict is recorded AND raised as a security event.
-- ---------------------------------------------------------------------------
do $$
declare already boolean; severity_after text; code_after text;
begin
  -- f12 has no stored digest, so the digest comparison is skipped entirely. That branch must
  -- behave, not silently reject a legitimately digest-less attachment.
  select r.already_recorded into already from public.admin_record_attachment_scan(
    '00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f12','clamav','rejected','Eicar-Test-Signature',
    encode(digest('whatever the scanner read','sha256'),'hex')) as r;
  if already is not false then raise exception 'ASSERT FAILED: first rejection reported already_recorded=%', already; end if;

  if (select status from public.case_attachments where id='00000000-0000-0000-0000-000000000f12')<>'rejected' then
    raise exception 'ASSERT FAILED: the rejected attachment did not reach the rejected state';
  end if;
  select severity,event_code into severity_after,code_after from public.operational_events
   where household_id='00000000-0000-0000-0000-000000000b11' and component='attachment_scanner' and event_code='attachment.scan_rejected';
  if severity_after is null then raise exception 'ASSERT FAILED: a rejected upload raised no operational event'; end if;
  if severity_after<>'critical' then raise exception 'ASSERT FAILED: a rejected upload was recorded at severity %', severity_after; end if;

  -- The alert metadata must stay bounded: no file name, no signature payload, nothing that
  -- would put content or subject matter into an operational record.
  if exists (select 1 from public.operational_events
              where household_id='00000000-0000-0000-0000-000000000b11' and event_code='attachment.scan_rejected'
                and metadata::text ~* '(pdf|worksheet|assessment)') then
    raise exception 'ASSERT FAILED: the rejection alert leaked a file name';
  end if;
  raise notice 'ok 6: a rejected upload is recorded and raised as a critical operational event';
end $$;

-- ---------------------------------------------------------------------------
-- 7. States that must never be scannable, and a household mismatch.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean;
begin
  -- f13 is already clean AND has no stored digest; a rejection for it must be refused as a
  -- verdict flip rather than accepted.
  refused:=false;
  begin
    perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f13','clamav','rejected','Eicar-Test-Signature');
  exception when others then refused:=true;
  end;
  if not refused then raise exception 'ASSERT FAILED: a pre-existing clean attachment was re-verdictable'; end if;

  -- f14 never uploaded. Scanning it would fabricate a clean verdict for bytes that do not exist.
  refused:=false;
  begin
    perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000f14','clamav','clean','ok');
  exception when others then
    refused:=true;
    if sqlerrm not like '%not awaiting a scan%' then raise exception 'ASSERT FAILED: unexpected error for a never-uploaded attachment: %',sqlerrm; end if;
  end;
  if not refused then raise exception 'ASSERT FAILED: a never-uploaded attachment was scanned'; end if;

  -- The household argument is part of the identity of the attachment, not decoration.
  refused:=false;
  begin
    perform public.admin_record_attachment_scan('00000000-0000-0000-0000-000000000b12','00000000-0000-0000-0000-000000000f12','clamav','clean','ok');
  exception when others then refused:=true;
  end;
  if not refused then raise exception 'ASSERT FAILED: an attachment was scanned under the wrong household'; end if;
  raise notice 'ok 7: final, never-uploaded, and cross-household attachments are all refused';
end $$;

-- ---------------------------------------------------------------------------
-- 8. Reconciliation replaces the observed set rather than accumulating it.
-- ---------------------------------------------------------------------------
do $$
declare observed bigint; refused boolean; before_count int;
begin
  refused:=false;
  begin
    perform public.admin_reconcile_attachment_objects('00000000-0000-0000-0000-0000000000ff',array['household-ff/case-x/msg-y/object-z.pdf']);
  exception when others then refused:=true;
  end;
  if not refused then raise exception 'ASSERT FAILED: reconciliation accepted a household that does not exist'; end if;

  refused:=false;
  begin
    perform public.admin_reconcile_attachment_objects('00000000-0000-0000-0000-000000000b11',array['too-short']);
  exception when others then refused:=true;
  end;
  if not refused then raise exception 'ASSERT FAILED: reconciliation accepted an invalid object path'; end if;

  select observed_count into observed from public.admin_reconcile_attachment_objects('00000000-0000-0000-0000-000000000b11',
    array['household-b11/case-d11/msg-e11/f11.pdf','household-b11/case-d11/msg-e11/f12.pdf','household-b11/case-d11/msg-e11/f11.pdf']);
  if observed<>2 then raise exception 'ASSERT FAILED: expected 2 distinct observed paths, got %', observed; end if;

  -- A second reconcile with a narrower set must REPLACE, not union. If it unioned, the
  -- orphan signal would never fire and the whole reconciler would be decorative.
  select observed_count into observed from public.admin_reconcile_attachment_objects('00000000-0000-0000-0000-000000000b11',
    array['household-b11/case-d11/msg-e11/f11.pdf']);
  if observed<>1 then raise exception 'ASSERT FAILED: reconciliation accumulated instead of replacing (% rows)', observed; end if;
  select count(*) into before_count from public.attachment_object_observations where household_id='00000000-0000-0000-0000-000000000b11';
  if before_count<>1 then raise exception 'ASSERT FAILED: % observation rows survived a replacing reconcile', before_count; end if;
  raise notice 'ok 8: reconciliation validates its inputs and replaces the observed set';
end $$;

-- ---------------------------------------------------------------------------
-- 9. The integrity snapshot is admin-gated and each signal fires on its own trigger.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean; signals text[];
begin
  -- The gate is asserted by its message, not by an SQLSTATE. Admin gates across this schema
  -- raise the default P0001 ("admin access required" appears in 10 migrations), while the
  -- guardian gates in 004/005 raise 42501 -- and 022, the one admin gate that uses 42501, is
  -- the outlier. Pinning 42501 here would pin 023 to that outlier rather than to the house
  -- convention. The property that matters is that the call is refused BY THE GATE, so the
  -- message is what is checked. The 022 inconsistency is worth reconciling separately.
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000a06',true);
  refused:=false;
  begin
    perform public.admin_attachment_integrity_snapshot('00000000-0000-0000-0000-000000000b11',now());
  exception when others then
    refused:=true;
    if sqlerrm<>'admin access required' then raise exception 'ASSERT FAILED: an educator was refused for the wrong reason: %',sqlerrm; end if;
  end;
  if not refused then raise exception 'ASSERT FAILED: a non-admin educator read the integrity snapshot'; end if;

  -- Unauthenticated must fail closed too: auth.uid() is NULL, so has_household_role is false
  -- rather than accidentally true.
  perform set_config('request.jwt.claim.sub','',true);
  refused:=false;
  begin
    perform public.admin_attachment_integrity_snapshot('00000000-0000-0000-0000-000000000b11',now());
  exception when others then
    refused:=true;
    if sqlerrm<>'admin access required' then raise exception 'ASSERT FAILED: an unauthenticated caller was refused for the wrong reason: %',sqlerrm; end if;
  end;
  if not refused then raise exception 'ASSERT FAILED: an unauthenticated caller read the integrity snapshot'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000a05',true);

  -- Now, as the household admin. b11 has one rejected attachment and one observation row for
  -- f11 only -- so f12 (rejected, no object) is orphaned metadata, and f13's object (never
  -- listed) is only visible as missing-object metadata.
  select array(select s.signal_code from public.admin_attachment_integrity_snapshot('00000000-0000-0000-0000-000000000b11',now()) as s) into signals;
  if not ('attachment.rejected_present'=any(signals)) then raise exception 'ASSERT FAILED: the rejection did not surface; signals were %', signals; end if;
  if not ('attachment.metadata_orphaned'=any(signals)) then raise exception 'ASSERT FAILED: metadata with no observed object did not surface; signals were %', signals; end if;
  if 'attachment.reconciliation_stale'=any(signals) then raise exception 'ASSERT FAILED: reconciliation was just recorded but read as stale'; end if;

  -- Ordering: critical severity must sort first, so a monitor triaging the head of the list
  -- sees malware before housekeeping. signals[] preserves the function's own ORDER BY.
  if signals[1]<>'attachment.rejected_present' then
    raise exception 'ASSERT FAILED: the critical signal did not sort first; order was %', signals;
  end if;

  -- An object nobody references: either a lost upload or a rejected object whose deletion
  -- failed. Both need to be visible.
  perform public.admin_reconcile_attachment_objects('00000000-0000-0000-0000-000000000b11',
    array['household-b11/case-d11/msg-e11/f11.pdf','household-b11/case-d11/msg-e11/stranded-object.pdf']);
  select array(select s.signal_code from public.admin_attachment_integrity_snapshot('00000000-0000-0000-0000-000000000b11',now()) as s) into signals;
  if not ('attachment.object_orphaned'=any(signals)) then raise exception 'ASSERT FAILED: an unreferenced object did not surface; signals were %', signals; end if;

  -- The vacuous-green guard: b12 has never been reconciled, so its two orphan signals are
  -- structurally empty. Without reconciliation_stale that reads as healthy.
  select array(select s.signal_code from public.admin_attachment_integrity_snapshot('00000000-0000-0000-0000-000000000b12',now()) as s) into signals;
  if not ('attachment.reconciliation_stale'=any(signals)) then
    raise exception 'ASSERT FAILED: an unreconciled household reported no staleness; signals were %', signals;
  end if;
  if exists (select 1 from public.admin_attachment_integrity_snapshot('00000000-0000-0000-0000-000000000b12',now()) as s where s.signal_code='attachment.object_orphaned') then
    raise exception 'ASSERT FAILED: an unreconciled household claimed an orphan, which it cannot know';
  end if;

  -- The evaluation window is bounded so a stale or skewed caller cannot rewrite "now".
  refused:=false;
  begin
    perform public.admin_attachment_integrity_snapshot('00000000-0000-0000-0000-000000000b11',now()+interval '10 minutes');
  exception when others then refused:=true;
  end;
  if not refused then raise exception 'ASSERT FAILED: a future evaluation time was accepted'; end if;
  refused:=false;
  begin
    perform public.admin_attachment_integrity_snapshot('00000000-0000-0000-0000-000000000b11',now()-interval '10 hours');
  exception when others then refused:=true;
  end;
  if not refused then raise exception 'ASSERT FAILED: a stale evaluation time was accepted'; end if;
  raise notice 'ok 9: the snapshot is admin-gated and every integrity signal fires on its own trigger';
end $$;

-- ---------------------------------------------------------------------------
-- 10. The queue is bounded and ordered oldest-first, so a backlog cannot starve.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean; rows_returned int; ordered boolean; pending int;
begin
  -- Own fixtures: assertions 5 and 6 give verdicts to f11 and f12, which drains the queue the
  -- seed created. Depending on what earlier sections left behind would make this assertion
  -- about leftover state rather than about the bound it is meant to test.
  insert into public.case_attachments(id,household_id,case_id,message_id,uploaded_by,object_path,file_name,mime_type,size_bytes,status) values
    ('00000000-0000-0000-0000-000000002f01','00000000-0000-0000-0000-000000000b12','00000000-0000-0000-0000-000000000d12','00000000-0000-0000-0000-000000000e12','00000000-0000-0000-0000-000000000a05','household-b12/case-d12/msg-e12/2f01.pdf','a.pdf','application/pdf',100,'pending_scan'),
    ('00000000-0000-0000-0000-000000002f02','00000000-0000-0000-0000-000000000b12','00000000-0000-0000-0000-000000000d12','00000000-0000-0000-0000-000000000e12','00000000-0000-0000-0000-000000000a05','household-b12/case-d12/msg-e12/2f02.pdf','b.pdf','application/pdf',100,'pending_scan'),
    ('00000000-0000-0000-0000-000000002f03','00000000-0000-0000-0000-000000000b12','00000000-0000-0000-0000-000000000d12','00000000-0000-0000-0000-000000000e12','00000000-0000-0000-0000-000000000a05','household-b12/case-d12/msg-e12/2f03.pdf','c.pdf','application/pdf',100,'pending_scan');

  refused:=false;
  begin perform public.admin_list_pending_scan_attachments(0);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: max_rows=0 was accepted'; end if;

  refused:=false;
  begin perform public.admin_list_pending_scan_attachments(501);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: max_rows=501 was accepted'; end if;

  refused:=false;
  begin perform public.admin_list_pending_scan_attachments(-1);
  exception when others then refused:=true; end;
  if not refused then raise exception 'ASSERT FAILED: a negative max_rows was accepted'; end if;

  select count(*) into pending from public.admin_list_pending_scan_attachments(500);
  if pending<4 then raise exception 'ASSERT FAILED: expected at least 4 pending scans, found %', pending; end if;
  select count(*) into rows_returned from public.admin_list_pending_scan_attachments(2);
  if rows_returned<>2 then raise exception 'ASSERT FAILED: max_rows=2 returned % rows', rows_returned; end if;

  -- Oldest-first, asserted order-independently: sorting what the queue returned must not
  -- change it. Comparing against a globally oldest row would break as soon as another
  -- fixture file exists, and would not actually test the function's ORDER BY.
  select array_agg(created_at order by created_at)=array_agg(created_at) into ordered
    from public.admin_list_pending_scan_attachments(500);
  if ordered is not true then raise exception 'ASSERT FAILED: the queue is not ordered oldest-first'; end if;
  raise notice 'ok 10: the scan queue is bounded, ordered oldest-first, and rejects out-of-range sizes';
end $$;

\echo '=== all attachment scan adapter assertions passed ==='
