#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
drill_dir="$(mktemp -d "${TMPDIR:-/tmp}/britelink-restore-drill.XXXXXX")"
source_data="$drill_dir/source-data"
restore_data="$drill_dir/restore-data"
socket_dir="$drill_dir/socket"
backup_dir="$drill_dir/backup"
restore_files="$drill_dir/restored-files"
report_file="$project_dir/qa/operations/local-restore-drill-report.json"
source_port=$((54000 + ($$ % 500)))
restore_port=$((source_port + 500))
source_started=false
restore_started=false

cleanup(){
  if $source_started;then pg_ctl -D "$source_data" -m fast stop >/dev/null 2>&1 || true;fi
  if $restore_started;then pg_ctl -D "$restore_data" -m fast stop >/dev/null 2>&1 || true;fi
  rm -rf "$drill_dir"
}
trap cleanup EXIT

mkdir -p "$socket_dir" "$backup_dir" "$restore_files"
chmod 700 "$drill_dir" "$backup_dir" "$restore_files"

bootstrap_cluster(){
  local port="$1"
  psql -X -v ON_ERROR_STOP=1 -h "$socket_dir" -p "$port" postgres <<'SQL' >/dev/null
create schema auth;
create table auth.users(id uuid primary key,email text unique);
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
do $$begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;end$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
SQL
}

manifest(){
  local port="$1"
  psql -X -At -F '|' -h "$socket_dir" -p "$port" postgres <<'SQL'
create temporary table restore_manifest(table_name text,row_count bigint,row_digest text);
do $body$
declare item record;
begin
  for item in select tablename from pg_tables where schemaname='public' order by tablename loop
    execute format('insert into restore_manifest select %L,count(*),coalesce(md5(string_agg(row_text,%L order by row_text)),md5(%L)) from (select row_to_json(t)::text row_text from public.%I t) rows',item.tablename,'','',item.tablename);
  end loop;
end $body$;
select table_name,row_count,row_digest from restore_manifest order by table_name;
SQL
}

start_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
initdb -D "$source_data" --auth=trust --no-instructions >/dev/null
pg_ctl -D "$source_data" -o "-F -k $socket_dir -p $source_port" -w start >/dev/null
source_started=true
bootstrap_cluster "$source_port"

for migration in "$project_dir"/supabase/migrations/*.sql;do
  psql -X -v ON_ERROR_STOP=1 -h "$socket_dir" -p "$source_port" -f "$migration" postgres >/dev/null
done

attachment_bytes="$drill_dir/attachment-source/10000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001"
mkdir -p "$(dirname "$attachment_bytes")"
printf '%s' 'Synthetic BriteLink recovery attachment' > "$attachment_bytes"
attachment_sha="$(shasum -a 256 "$attachment_bytes" | awk '{print $1}')"
attachment_size="$(wc -c < "$attachment_bytes" | tr -d ' ')"

psql -X -v ON_ERROR_STOP=1 -h "$socket_dir" -p "$source_port" postgres \
  -v attachment_sha="$attachment_sha" -v attachment_size="$attachment_size" <<'SQL' >/dev/null
insert into auth.users(id,email) values
('20000000-0000-0000-0000-000000000001','guardian-a@example.test'),
('20000000-0000-0000-0000-000000000002','admin-a@example.test'),
('20000000-0000-0000-0000-000000000003','admin-b@example.test');
insert into public.households(id,display_name) values
('10000000-0000-0000-0000-000000000001','Synthetic household A'),
('10000000-0000-0000-0000-000000000002','Synthetic household B');
insert into public.memberships(household_id,user_id,role) values
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','guardian'),
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','admin'),
('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','admin');
insert into public.learners(id,household_id,preferred_name,grade_label,jurisdiction) values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic learner','Grade 4','Ontario');
insert into public.service_cases(id,household_id,learner_id,package_code,status) values('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','complete','paid');
insert into public.case_messages(id,household_id,case_id,sender_user_id,kind,body) values('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','general','Synthetic restore message');
insert into public.case_attachments(id,household_id,case_id,message_id,uploaded_by,object_path,file_name,mime_type,size_bytes,sha256,status,uploaded_at,scanned_at,scan_provider,scan_result_code)
values('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001','restore.txt','text/plain',:'attachment_size',:'attachment_sha','clean',now(),now(),'synthetic-scanner','clean');
insert into public.audit_events(household_id,actor_user_id,event_type,subject_type,subject_id) values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','restore.seeded','household','10000000-0000-0000-0000-000000000001');
SQL

source_manifest="$drill_dir/source-manifest.txt"
manifest "$source_port" > "$source_manifest"
pg_dump -h "$socket_dir" -p "$source_port" -d postgres --schema=public --schema-only --clean --if-exists --no-owner > "$backup_dir/schema.sql"
pg_dump -h "$socket_dir" -p "$source_port" -d postgres --table=auth.users --data-only --inserts --no-owner --no-privileges > "$backup_dir/auth-data.sql"
pg_dump -h "$socket_dir" -p "$source_port" -d postgres --schema=public --data-only --inserts --disable-triggers --no-owner --no-privileges > "$backup_dir/data.sql"
tar -C "$drill_dir/attachment-source" -cf "$backup_dir/storage.tar" .

passphrase_file="$drill_dir/backup-passphrase"
openssl rand -hex 32 > "$passphrase_file"
chmod 600 "$passphrase_file"
tar -C "$backup_dir" -cf - schema.sql auth-data.sql data.sql storage.tar | openssl enc -aes-256-cbc -salt -pbkdf2 -pass "file:$passphrase_file" -out "$drill_dir/britelink-backup.enc"
rm "$backup_dir/schema.sql" "$backup_dir/auth-data.sql" "$backup_dir/data.sql" "$backup_dir/storage.tar"

initdb -D "$restore_data" --auth=trust --no-instructions >/dev/null
pg_ctl -D "$restore_data" -o "-F -k $socket_dir -p $restore_port" -w start >/dev/null
restore_started=true
bootstrap_cluster "$restore_port"

openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$passphrase_file" -in "$drill_dir/britelink-backup.enc" | tar -C "$backup_dir" -xf -
psql -X -v ON_ERROR_STOP=1 --single-transaction -h "$socket_dir" -p "$restore_port" -f "$backup_dir/schema.sql" postgres >/dev/null
psql -X -v ON_ERROR_STOP=1 --single-transaction -h "$socket_dir" -p "$restore_port" --command 'set session_replication_role=replica' -f "$backup_dir/auth-data.sql" -f "$backup_dir/data.sql" postgres >/dev/null
tar -C "$restore_files" -xf "$backup_dir/storage.tar"

restore_manifest="$drill_dir/restore-manifest.txt"
manifest "$restore_port" > "$restore_manifest"
diff -u "$source_manifest" "$restore_manifest" >/dev/null

table_count="$(psql -X -At -h "$socket_dir" -p "$restore_port" postgres -c "select count(*) from pg_tables where schemaname='public'")"
rls_count="$(psql -X -At -h "$socket_dir" -p "$restore_port" postgres -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity")"
if [[ "$table_count" != "$rls_count" ]];then echo "RLS coverage mismatch after restore" >&2;exit 1;fi

cross_house_count="$(psql -X -At -h "$socket_dir" -p "$restore_port" postgres <<'SQL'
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
select count(*) from public.learners where household_id='10000000-0000-0000-0000-000000000001';
SQL
)"
if [[ "${cross_house_count##*$'\n'}" != "0" ]];then echo "Cross-household RLS failed after restore" >&2;exit 1;fi

own_house_count="$(psql -X -At -h "$socket_dir" -p "$restore_port" postgres <<'SQL'
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select count(*) from public.learners where household_id='10000000-0000-0000-0000-000000000001';
SQL
)"
if [[ "${own_house_count##*$'\n'}" != "1" ]];then echo "Own-household access failed after restore" >&2;exit 1;fi

restored_attachment="$restore_files/10000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001"
restored_sha="$(shasum -a 256 "$restored_attachment" | awk '{print $1}')"
database_sha="$(psql -X -At -h "$socket_dir" -p "$restore_port" postgres -c "select sha256 from public.case_attachments where id='60000000-0000-0000-0000-000000000001'")"
if [[ "$restored_sha" != "$database_sha" ]];then echo "Attachment object checksum mismatch after restore" >&2;exit 1;fi

post_restore_message="$(psql -X -At -h "$socket_dir" -p "$restore_port" postgres <<'SQL'
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
select message_id from public.send_case_message('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','general','Post-restore write verification');
SQL
)"
if [[ -z "${post_restore_message##*$'\n'}" ]];then echo "Post-restore write failed" >&2;exit 1;fi

end_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
duration_ms=$((end_ms-start_ms))
mkdir -p "$(dirname "$report_file")"
node - "$report_file" "$duration_ms" "$table_count" "$restored_sha" <<'NODE'
import {writeFileSync} from "node:fs";
const [report,duration,tables,objectSha]=process.argv.slice(2);
writeFileSync(report,JSON.stringify({generatedAt:new Date().toISOString(),scope:"local disposable PostgreSQL logical restore rehearsal",productionRestore:false,encryptedArchive:true,databaseSchemaDataRestored:true,authDependencyRestored:true,storageObjectBytesRestored:true,storageMetadataChecksumMatched:true,publicTableCount:Number(tables),allPublicTablesRlsEnabled:true,rowFingerprintsMatched:true,crossHouseholdReadDenied:true,ownHouseholdReadAllowed:true,postRestoreWriteSucceeded:true,rehearsalDurationMs:Number(duration),localSnapshotRpoSeconds:0,attachmentSha256:objectSha},null,2)+"\n");
NODE

printf 'Local restore drill passed: %s public tables, encrypted database/object archive, RLS, fingerprints, attachment checksum, and post-restore write (%sms).\n' "$table_count" "$duration_ms"
