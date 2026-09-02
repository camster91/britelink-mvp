-- Apply after creating a PRIVATE bucket named case-attachments with a 10 MB file-size limit
-- and MIME allow-list: application/pdf,image/jpeg,image/png,text/plain.

create policy case_attachment_owner_upload on storage.objects for insert to authenticated
with check (
  bucket_id='case-attachments'
  and exists(
    select 1 from public.case_attachments a
    where a.object_path=name and a.uploaded_by=auth.uid() and a.status='pending_upload'
      and (storage.foldername(name))[1]=a.household_id::text
  )
);

create policy case_attachment_clean_download on storage.objects for select to authenticated
using (
  bucket_id='case-attachments'
  and exists(
    select 1 from public.case_attachments a
    where a.object_path=name and a.status='clean' and public.is_household_member(a.household_id)
      and (storage.foldername(name))[1]=a.household_id::text
  )
);

-- No authenticated update or delete policy. Scanner/quarantine and lifecycle deletion use service-role jobs.
