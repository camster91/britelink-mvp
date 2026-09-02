import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("../supabase/migrations/202608280001_core.sql", import.meta.url);
const operationsUrl = new URL("../supabase/migrations/202608280002_operations.sql", import.meta.url);
const schedulingUrl = new URL("../supabase/migrations/202608280003_lesson_scheduling.sql", import.meta.url);
const intakeUrl = new URL("../supabase/migrations/202608280004_guardian_intake.sql", import.meta.url);
const guardianServiceUrl = new URL("../supabase/migrations/202608280005_guardian_service_privacy.sql", import.meta.url);
const staffOperationsUrl = new URL("../supabase/migrations/202608280006_staff_operations.sql", import.meta.url);
const staffAuthoringUrl = new URL("../supabase/migrations/202608280007_staff_authoring_delivery.sql", import.meta.url);
const staffExceptionsUrl = new URL("../supabase/migrations/202608280008_staff_revision_messaging_exceptions.sql", import.meta.url);
const usableIntakeUrl = new URL("../supabase/migrations/202608280009_usable_intake_sla.sql", import.meta.url);
const paymentIntegrityUrl = new URL("../supabase/migrations/202608280010_payment_integrity.sql", import.meta.url);
const operationalControlsUrl = new URL("../supabase/migrations/202608280011_operational_controls.sql", import.meta.url);
const deletionSafeguardsUrl = new URL("../supabase/migrations/202608280012_deletion_safeguards.sql", import.meta.url);
const secureAttachmentsUrl = new URL("../supabase/migrations/202608280013_secure_attachments.sql", import.meta.url);
const storagePoliciesUrl = new URL("../supabase/storage-policies.sql", import.meta.url);
const authenticatedPrivilegesUrl = new URL("../supabase/migrations/202608280014_authenticated_privileges.sql", import.meta.url);
const operationalHealthUrl = new URL("../supabase/migrations/202608280015_operational_health.sql", import.meta.url);
const independentReviewUrl = new URL("../supabase/migrations/202608280016_independent_plan_review.sql", import.meta.url);
const tenantIntegrityUrl = new URL("../supabase/migrations/202608280017_tenant_reference_integrity.sql", import.meta.url);
const operationalMetadataUrl = new URL("../supabase/migrations/202608280018_operational_metadata_privacy.sql", import.meta.url);
const attachmentRetryUrl = new URL("../supabase/migrations/202608280019_attachment_retry.sql", import.meta.url);
const portableExportUrl = new URL("../supabase/migrations/202608280020_portable_export_manifest.sql", import.meta.url);
const recentAuthenticationUrl = new URL("../supabase/migrations/202608280021_recent_authentication.sql", import.meta.url);

test("every household-scoped private table enables row level security", async () => {
  const sql = await readFile(schemaUrl, "utf8");
  const tables = ["households", "memberships", "learners", "guardian_consents", "learner_profiles", "service_cases", "plans", "plan_weeks", "plan_days", "lessons", "lesson_activities", "audit_events"];
  for (const table of tables) assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
});

test("schema defines household membership and role enforcement helpers", async () => {
  const sql = await readFile(schemaUrl, "utf8");
  assert.match(sql, /is_household_member/);
  assert.match(sql, /has_household_role/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /plans_member_select/);
  assert.match(sql, /activities_member_select/);
  assert.match(sql, /activities_guardian_write/);
  assert.match(sql, /updated_by = auth\.uid\(\)/);
});

test("operations schema protects every new household-scoped table with RLS", async () => {
  const sql = await readFile(operationsUrl, "utf8");
  const tables = ["orders", "educator_capacities", "case_messages", "case_message_reads", "plan_reviews", "resources", "deliveries", "revision_requests"];
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql, new RegExp(`create policy [^;]+ on public\\.${table}`));
  }
  assert.match(sql, /sender_user_id = auth\.uid\(\)/);
  assert.match(sql, /requested_by = auth\.uid\(\)/);
});

test("resource schema captures plan scope, cost, substitute, and review evidence", async () => {
  const sql = await readFile(operationsUrl, "utf8");
  assert.match(sql, /plan_id uuid not null references public\.plans/);
  assert.match(sql, /substitute_resource_id uuid references public\.resources/);
  assert.match(sql, /privacy_reviewed_at/);
  assert.match(sql, /rights_reviewed_at/);
  assert.match(sql, /link_checked_at/);
  assert.match(sql, /access_type <> 'paid' or estimated_cost_cents is not null/);
});

test("lesson scheduling migration records privacy-minimal paired reason and date fields",async()=>{
  const sql=await readFile(schedulingUrl,"utf8");
  assert.match(sql,/schedule_reason in \('illness', 'travel', 'caregiver_schedule', 'catch_up', 'other'\)/);
  assert.match(sql,/lesson_activity_schedule_pair/);
  assert.match(sql,/scheduled_for date/);
  assert.match(sql,/never a diagnosis or free-text health field/);
});

test("guardian intake migration self-attributes consent and atomically versions profiles",async()=>{
  const sql=await readFile(intakeUrl,"utf8");
  assert.match(sql,/guardian_user_id,notice_version,purposes,consented_at/);assert.match(sql,/created_by\)/);assert.match(sql,/submit_guardian_intake/);assert.match(sql,/for update/);assert.match(sql,/max\(lp\.version\)/);assert.match(sql,/intake\.submitted/);assert.match(sql,/No direct insert\/update policy is recreated/);assert.match(sql,/has_active_guardian_consent/);assert.match(sql,/profiles_consent_limited_select/);assert.match(sql,/withdraw_guardian_consent/);assert.match(sql,/held_cases/);assert.match(sql,/revoke all on function public\.submit_guardian_intake/);
});

test("guardian service/privacy migration makes sensitive actions RPC-only and auditable",async()=>{
  const sql=await readFile(guardianServiceUrl,"utf8");assert.match(sql,/drop policy if exists revisions_guardian_insert/);assert.match(sql,/privacy_requests enable row level security/);assert.match(sql,/acknowledge_guardian_delivery/);assert.match(sql,/request_guardian_revision/);assert.match(sql,/export_guardian_household/);assert.match(sql,/request_guardian_household_deletion/);assert.match(sql,/privacy\.exported/);assert.match(sql,/privacy\.deletion_requested/);assert.match(sql,/revoke all on function public\.export_guardian_household/);
});

test("staff operations migration removes broad writes and enforces attributed RPC workflows",async()=>{
  const sql=await readFile(staffOperationsUrl,"utf8");
  for(const policy of ["cases_staff_write","plans_staff_write","reviews_staff_access","deliveries_staff_write"])assert.match(sql,new RegExp(`drop policy if exists ${policy}`));
  for(const rpc of ["staff_transition_case","staff_assign_case","staff_review_plan","staff_decide_revision"])assert.match(sql,new RegExp(`create or replace function public\\.${rpc}`));
  assert.match(sql,/educator has reached active case capacity/);assert.match(sql,/approved internal review required/);assert.match(sql,/reviewer_user_id.*auth\.uid\(\)/s);assert.match(sql,/decided_by=auth\.uid\(\)/);assert.match(sql,/case\.transitioned/);
});

test("staff authoring migration makes nested plans resources and delivery atomic RPC operations",async()=>{
  const sql=await readFile(staffAuthoringUrl,"utf8");for(const policy of ["weeks_staff_write","days_staff_write","lessons_staff_write","resources_staff_write"])assert.match(sql,new RegExp(`drop policy if exists ${policy}`));for(const rpc of ["staff_create_plan_version","staff_add_plan_resource","staff_record_delivery","staff_retry_delivery"])assert.match(sql,new RegExp(`create or replace function public\\.${rpc}`));assert.match(sql,/plan requires 1 to 52 weeks/);assert.match(sql,/resource URL must use HTTPS/);assert.match(sql,/published plan not found/);assert.match(sql,/delivery\.retried/);
});

test("staff completion messaging and exception operations are server-owned and audited",async()=>{const sql=await readFile(staffExceptionsUrl,"utf8");assert.match(sql,/drop policy if exists messages_member_insert/);for(const rpc of ["send_case_message","staff_resolve_case_message","staff_complete_revision","staff_record_educator_absence","staff_mark_overdue_cases"])assert.match(sql,new RegExp(`create or replace function public\\.${rpc}`));assert.match(sql,/response owner or admin required/);assert.match(sql,/new plan version required/);assert.match(sql,/previous_operational_status/);assert.match(sql,/case\.marked_overdue/)});
test("usable intake migration validates active consent and starts package business-day SLA atomically",async()=>{const sql=await readFile(usableIntakeUrl,"utf8");assert.match(sql,/staff_accept_usable_intake/);assert.match(sql,/add_business_days/);assert.match(sql,/personalized_learning_plan/);assert.match(sql,/missing required planning context/);assert.match(sql,/when 'essentials' then 5/);assert.match(sql,/intake\.accepted/)});
test("payment integrity migration is idempotent private and terminal-state safe",async()=>{const sql=await readFile(paymentIntegrityUrl,"utf8");assert.match(sql,/drop policy if exists orders_admin_write/);assert.match(sql,/payment_events enable row level security/);assert.match(sql,/provider_event_key text not null unique/);assert.match(sql,/admin_ingest_payment_event/);assert.match(sql,/payment event replay mismatch/);assert.match(sql,/terminal payment state cannot change/);assert.match(sql,/payment\.status_ingested/)});
test("operational controls enforce private quotas and bounded monitoring signals",async()=>{const sql=await readFile(operationalControlsUrl,"utf8");for(const table of ["operation_rate_windows","operational_events"])assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`));for(const action of ["message.send","intake.submit","revision.request","privacy.request","delivery.record","payment.ingest"])assert.match(sql,new RegExp(action.replace(".","\\.")));assert.match(sql,/operation rate limit exceeded/);assert.match(sql,/octet_length\(event_metadata::text\)>4096/);assert.match(sql,/admin_record_operational_event/);assert.match(sql,/operations\.event_recorded/)});
test("deletion safeguards require reviewed scheduling and an audited cancellation path",async()=>{const sql=await readFile(deletionSafeguardsUrl,"utf8");assert.match(sql,/deletion_jobs enable row level security/);assert.match(sql,/identity and co-guardian safeguards are required/);assert.match(sql,/requester cannot approve deletion/);assert.match(sql,/admin_schedule_household_deletion/);assert.match(sql,/admin_cancel_household_deletion/);assert.match(sql,/privacy\.deletion_scheduled/);assert.match(sql,/privacy\.deletion_cancelled/);assert.doesNotMatch(sql,/delete from public\./)});
test("secure attachment metadata is quarantined bounded and RPC-only",async()=>{const sql=await readFile(secureAttachmentsUrl,"utf8");assert.match(sql,/case_attachments enable row level security/);assert.match(sql,/10485760/);assert.match(sql,/message attachment limit exceeded/);assert.match(sql,/status='clean'/);for(const rpc of ["create_message_attachment_upload","complete_message_attachment_upload","admin_review_message_attachment"])assert.match(sql,new RegExp(rpc));for(const event of ["attachment.upload_created","attachment.uploaded","attachment.upload_failed","attachment.scan_reviewed"])assert.match(sql,new RegExp(event.replace(".","\\.")));assert.doesNotMatch(sql,/create policy .* for insert/)});
test("private storage policies bind object paths to clean attachment metadata",async()=>{const sql=await readFile(storagePoliciesUrl,"utf8");assert.match(sql,/PRIVATE bucket named case-attachments/);assert.match(sql,/a\.object_path=name/);assert.match(sql,/a\.uploaded_by=auth\.uid\(\)/);assert.match(sql,/a\.status='pending_upload'/);assert.match(sql,/a\.status='clean'/);assert.match(sql,/public\.is_household_member/);assert.doesNotMatch(sql,/for update|for delete/)});
test("authenticated privileges are explicit portable and mutation-minimal",async()=>{const sql=await readFile(authenticatedPrivilegesUrl,"utf8");assert.match(sql,/grant usage on schema public to authenticated/);assert.match(sql,/grant select on all tables in schema public to authenticated/);for(const table of ["lesson_activities","case_message_reads"])assert.match(sql,new RegExp(`grant insert,update on table public\\.${table}`));assert.match(sql,/alter default privileges in schema public grant select/);assert.doesNotMatch(sql,/grant (insert|update|delete) on all tables/)});
test("operational health signals are scoped aggregate and privacy-minimal",async()=>{const sql=await readFile(operationalHealthUrl,"utf8");assert.match(sql,/admin_operational_health_snapshot/);assert.match(sql,/admin access required/);for(const code of ["attachment.scan_stale","delivery.failed","message.response_overdue","case.sla_overdue","deletion.job_due","payment.pending_stale","payment.case_binding_missing","operations.recent_error"])assert.match(sql,new RegExp(code.replace(".","\\.")));assert.match(sql,/returns table\(signal_code text,severity text,entity_count bigint,oldest_at timestamptz,threshold_seconds integer\)/);assert.doesNotMatch(sql,/preferred_name|body|file_name|subject_id/)});
test("plan review migration enforces independent reviewer separation",async()=>{const sql=await readFile(independentReviewUrl,"utf8");assert.match(sql,/plan_row\.authored_by=auth\.uid\(\)/);assert.match(sql,/plan author cannot review their own plan/);assert.match(sql,/reviewer_user_id/);assert.match(sql,/grant execute on function public\.staff_review_plan/)});
test("direct-write foreign keys preserve household tenant integrity",async()=>{const sql=await readFile(tenantIntegrityUrl,"utf8");for(const key of ["lesson_activities_household_learner_fk","lesson_activities_household_lesson_fk","case_message_reads_household_message_fk"])assert.match(sql,new RegExp(key));for(const table of ["learners","lessons","case_messages"])assert.match(sql,new RegExp(`${table}_household_id_id_key`))});
test("operational metadata accepts only bounded non-content diagnostic dimensions",async()=>{const sql=await readFile(operationalMetadataUrl,"utf8");assert.match(sql,/operational_metadata_is_safe/);assert.match(sql,/operational_events_safe_metadata/);for(const key of ["operation","provider","statusCode","errorCode","attemptCount","durationBucket","queueDepth","objectCount","retryable","region"])assert.match(sql,new RegExp(`'${key}'`));assert.doesNotMatch(sql,/learnerName|messageBody|fileName|email/)});
test("failed attachment retry reuses an owned quarantined record",async()=>{const sql=await readFile(attachmentRetryUrl,"utf8");assert.match(sql,/retry_message_attachment_upload/);assert.match(sql,/uploaded_by=auth\.uid\(\)/);assert.match(sql,/status='upload_failed'/);assert.match(sql,/attachment\.upload_retried/);assert.doesNotMatch(sql,/insert into public\.case_attachments/)});
test("portable export manifest includes the authored hierarchy and explicit binary exclusions",async()=>{const sql=await readFile(portableExportUrl,"utf8");for(const key of ["schemaVersion","manifest","planWeeks","planDays","lessons","resources","attachmentMetadata","binaryAttachments"])assert.match(sql,new RegExp(`'${key}'`));assert.match(sql,/Binary files require separate authenticated retrieval/);assert.match(sql,/authentication_secrets/);assert.match(sql,/schema_version',2/);assert.match(sql,/guardian access required/)});
test("sensitive guardian RPCs require a recently issued authenticated token",async()=>{const sql=await readFile(recentAuthenticationUrl,"utf8");assert.match(sql,/require_recent_authentication/);assert.match(sql,/request\.jwt\.claims/);assert.match(sql,/request\.jwt\.claim\.iat/);assert.match(sql,/recent authentication required/);assert.match(sql,/interval '10 minutes'/);for(const rpc of ["export_guardian_household","request_guardian_household_deletion"])assert.match(sql,new RegExp(`create function public\\.${rpc}`));assert.match(sql,/revoke all on function public\.export_guardian_household_authorized/)});
