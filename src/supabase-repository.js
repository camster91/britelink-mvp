import { requireEmail, requireHttpUrl, requireIdentifier, validateAttachmentFile, validateDeletionRequest, validateGuardianIntake, validateLessonActivityInput, validateMessageInput, validateMessageReadInput, validateRevisionRequest, validateStaffPlanDocument, validateStaffResource } from "./input-validation.js";

function unwrap(result, operation) {
  if (result.error) {
    const error = new Error(`${operation}: ${result.error.message}`);
    error.code = result.error.code ?? null;
    error.status = result.error.status ?? result.status ?? null;
    error.details = result.error.details ?? null;
    throw error;
  }
  return result.data;
}

export class SupabaseBriteLinkRepository {
  constructor(client) { if (!client) throw new Error("Supabase client is required"); this.client = client; }

  async session() { const result = await this.client.auth.getSession(); return unwrap(result, "Read session")?.session ?? null; }
  async signInWithEmail(email, redirectTo) { return unwrap(await this.client.auth.signInWithOtp({ email: requireEmail(email), options: { emailRedirectTo: requireHttpUrl(redirectTo, "Sign-in redirect URL"), shouldCreateUser: false } }), "Send sign-in link"); }
  // The learner details ride along as signup metadata. Nothing is provisioned until the family
  // follows the link: provision_beta_household (migration 041) only serves a signed-in,
  // email-confirmed caller, so an unauthenticated visitor can no longer create or look up accounts.
  async joinBeta(email, redirectTo, {learnerName,learnerGrade}={}) { return unwrap(await this.client.auth.signInWithOtp({ email: requireEmail(email), options: { emailRedirectTo: requireHttpUrl(redirectTo, "Beta redirect URL"), shouldCreateUser: true, data: { beta_learner_name: String(learnerName||"").trim(), beta_learner_grade: String(learnerGrade||"").trim() } } }), "Join beta"); }
  async provisionBetaHousehold({learnerName,learnerGrade,jurisdiction="Ontario"}) {const rows=unwrap(await this.client.rpc("provision_beta_household",{learner_name:String(learnerName||"").trim(),learner_grade:String(learnerGrade||"").trim(),learner_jurisdiction:String(jurisdiction||"Ontario").trim()}),"Set up your household");return rows?.[0]??null}
  async requestFreshSignIn(email, redirectTo) { return unwrap(await this.client.auth.signInWithOtp({ email: requireEmail(email), options: { emailRedirectTo: requireHttpUrl(redirectTo, "Reauthentication redirect URL"), shouldCreateUser: false } }), "Send fresh sign-in link"); }
  async signOut() { return unwrap(await this.client.auth.signOut(), "Sign out"); }

  async listMemberships() {
    return unwrap(await this.client.from("memberships").select("household_id, role, households(id, display_name)").order("created_at"), "Load memberships");
  }
  async listLearners(householdId) {
    requireIdentifier(householdId,"Household ID");
    return unwrap(await this.client.from("learners").select("id, preferred_name, grade_label, jurisdiction, updated_at").eq("household_id", householdId).is("deleted_at", null).order("created_at"), "Load learners");
  }
  async listCases(householdId) {
    requireIdentifier(householdId,"Household ID");
    return unwrap(await this.client.from("service_cases").select("id, learner_id, package_code, status, sla_due_at, assigned_educator_id, updated_at").eq("household_id", householdId).order("created_at", { ascending: false }), "Load cases");
  }
  async loadLatestProfile(householdId, learnerId) {
    requireIdentifier(householdId,"Household ID"); requireIdentifier(learnerId,"Learner ID");
    const rows=unwrap(await this.client.from("learner_profiles").select("id, version, planning_context, submitted_at, created_at").eq("household_id",householdId).eq("learner_id",learnerId).order("version",{ascending:false}).limit(1),"Load learner intake");
    return rows?.[0]??null;
  }
  async submitGuardianIntake(input) {
    const valid=validateGuardianIntake(input);
    const rows=unwrap(await this.client.rpc("submit_guardian_intake",{target_household:valid.householdId,target_learner:valid.learnerId,notice_version:valid.noticeVersion,consent_purposes:valid.purposes,context:valid.context}),"Submit guardian intake");
    return rows?.[0]??null;
  }
  async listActiveConsents(householdId,learnerId,userId){
    requireIdentifier(householdId,"Household ID");requireIdentifier(learnerId,"Learner ID");requireIdentifier(userId,"User ID");
    return unwrap(await this.client.from("guardian_consents").select("id, notice_version, purposes, consented_at").eq("household_id",householdId).eq("learner_id",learnerId).eq("guardian_user_id",userId).is("withdrawn_at",null).order("consented_at",{ascending:false}),"Load active consent");
  }
  async withdrawConsent(householdId,consentId){requireIdentifier(householdId,"Household ID");requireIdentifier(consentId,"Consent ID");return unwrap(await this.client.rpc("withdraw_guardian_consent",{target_household:householdId,target_consent:consentId}),"Withdraw consent")}
  async loadPublishedPlans(householdId, learnerId) {
    requireIdentifier(householdId,"Household ID"); requireIdentifier(learnerId,"Learner ID");
    return unwrap(await this.client.from("plans").select("id, version, status, published_at, plan_schedules(start_date, school_days, days_off, updated_at), plan_weeks(id, week_number, theme, plan_days(id, day_number, planned_date, lessons(*, resources(*))))").eq("household_id", householdId).eq("learner_id", learnerId).eq("status", "published").order("version", { ascending: false }), "Load published plans");
  }
  async listLessonActivities(householdId, learnerId) {
    requireIdentifier(householdId,"Household ID"); requireIdentifier(learnerId,"Learner ID");
    return unwrap(await this.client.from("lesson_activities").select("id, lesson_id, status, caregiver_note, schedule_reason, scheduled_for, updated_at").eq("household_id", householdId).eq("learner_id", learnerId).order("updated_at", { ascending: false }), "Load lesson activity");
  }
  // The family calendar for a published plan (migration 043). startDate null = own pace.
  async setPlanSchedule({ householdId, planId, startDate = null, schoolDays, daysOff = [] }) {
    requireIdentifier(householdId, "Household ID"); requireIdentifier(planId, "Plan ID");
    if (startDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new TypeError("Start date must be a date");
    const days = [...new Set((schoolDays ?? []).map(Number))];
    if (!days.length || days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw new TypeError("Choose at least one school day");
    if ((daysOff ?? []).some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day))) throw new TypeError("Days off must be dates");
    const rows = unwrap(await this.client.rpc("set_plan_schedule", { target_household: householdId, target_plan: planId, schedule_start: startDate, schedule_school_days: days, schedule_days_off: daysOff ?? [] }), "Save your calendar");
    return rows?.[0] ?? null;
  }
  async saveLessonActivity(input) {
    const valid=validateLessonActivityInput(input);
    return unwrap(await this.client.from("lesson_activities").upsert({ household_id: valid.householdId, learner_id: valid.learnerId, lesson_id: valid.lessonId, status: valid.status, caregiver_note: valid.note, schedule_reason: valid.scheduleReason, scheduled_for: valid.scheduledFor, updated_by: valid.userId }, { onConflict: "learner_id,lesson_id" }).select().single(), "Save lesson activity");
  }
  async listMessages(householdId, caseId) {
    requireIdentifier(householdId,"Household ID"); requireIdentifier(caseId,"Case ID");
    return unwrap(await this.client.from("case_messages").select("id, sender_user_id, kind, body, response_owner_user_id, response_due_at, resolved_at, created_at, case_message_reads!case_message_reads_message_id_fkey(user_id, read_at), case_attachments(id, file_name, mime_type, size_bytes, status, object_path, created_at, uploaded_at, scanned_at, scan_result_code)").eq("household_id", householdId).eq("case_id", caseId).order("created_at"), "Load case messages");
  }
  async sendMessage(input) {
    const valid=validateMessageInput(input);
    const rows=unwrap(await this.client.rpc("send_case_message",{target_household:valid.householdId,target_case:valid.caseId,message_kind:valid.kind,message_body:valid.body}),"Send case message");const saved=rows?.[0]??{};return{id:saved.message_id,sender_user_id:valid.userId,kind:valid.kind,body:valid.body,response_owner_user_id:saved.response_owner_user_id,response_due_at:saved.response_due_at,resolved_at:null,created_at:saved.created_at,case_message_reads:[],case_attachments:[]};
  }
  async markMessageRead(input) {
    const valid=validateMessageReadInput(input);
    return unwrap(await this.client.from("case_message_reads").upsert({ household_id: valid.householdId, message_id: valid.messageId, user_id: valid.userId, read_at: valid.readAt }, { onConflict: "message_id,user_id" }).select().single(), "Mark message read");
  }
  async uploadMessageAttachment({householdId,messageId,file}){
    requireIdentifier(householdId,"Household ID");requireIdentifier(messageId,"Message ID");const valid=validateAttachmentFile(file);if(!globalThis.crypto?.subtle)throw new Error("Secure attachment hashing is unavailable");
    const digest=await globalThis.crypto.subtle.digest("SHA-256",await valid.file.arrayBuffer());const checksum=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
    const createdRows=unwrap(await this.client.rpc("create_message_attachment_upload",{target_household:householdId,target_message:messageId,attachment_file_name:valid.name,attachment_mime_type:valid.type,attachment_size_bytes:valid.size}),"Create attachment upload");const created=createdRows?.[0];if(!created?.attachment_id||!created?.object_path)throw new Error("Create attachment upload: backend returned no upload target");
    const uploaded=await this.client.storage.from("case-attachments").upload(created.object_path,valid.file,{contentType:valid.type,upsert:false});
    if(uploaded.error){await this.client.rpc("complete_message_attachment_upload",{target_household:householdId,target_attachment:created.attachment_id,content_sha256:null,upload_succeeded:false});const error=new Error(`Upload attachment: ${uploaded.error.message}`);error.attachmentRetry={attachmentId:created.attachment_id,messageId,file:valid.file};throw error}
    const completedRows=unwrap(await this.client.rpc("complete_message_attachment_upload",{target_household:householdId,target_attachment:created.attachment_id,content_sha256:checksum,upload_succeeded:true}),"Complete attachment upload");return{...created,...completedRows?.[0],file_name:valid.name,mime_type:valid.type,size_bytes:valid.size};
  }
  async retryMessageAttachmentUpload({householdId,attachmentId,file}){
    requireIdentifier(householdId,"Household ID");requireIdentifier(attachmentId,"Attachment ID");const valid=validateAttachmentFile(file);if(!globalThis.crypto?.subtle)throw new Error("Secure attachment hashing is unavailable");
    const digest=await globalThis.crypto.subtle.digest("SHA-256",await valid.file.arrayBuffer());const checksum=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
    const retryRows=unwrap(await this.client.rpc("retry_message_attachment_upload",{target_household:householdId,target_attachment:attachmentId}),"Retry attachment upload");const retry=retryRows?.[0];if(retry?.attachment_id!==attachmentId||!retry?.object_path)throw new Error("Retry attachment upload: backend returned no upload target");
    const uploaded=await this.client.storage.from("case-attachments").upload(retry.object_path,valid.file,{contentType:valid.type,upsert:false});
    if(uploaded.error){await this.client.rpc("complete_message_attachment_upload",{target_household:householdId,target_attachment:attachmentId,content_sha256:null,upload_succeeded:false});const error=new Error(`Retry attachment upload: ${uploaded.error.message}`);error.attachmentRetry={attachmentId,file:valid.file};throw error}
    const completedRows=unwrap(await this.client.rpc("complete_message_attachment_upload",{target_household:householdId,target_attachment:attachmentId,content_sha256:checksum,upload_succeeded:true}),"Complete retried attachment upload");return{...retry,...completedRows?.[0],file_name:valid.name,mime_type:valid.type,size_bytes:valid.size};
  }
  async createAttachmentDownloadUrl(attachment){if(!attachment||attachment.status!=="clean")throw new TypeError("Attachment is not available until its security scan passes");if(typeof attachment.object_path!=="string"||attachment.object_path.length<20)throw new TypeError("Attachment path is invalid");const result=await this.client.storage.from("case-attachments").createSignedUrl(attachment.object_path,60,{download:attachment.file_name});return unwrap(result,"Create attachment download link")?.signedUrl??null}
  async listDeliveries(householdId,caseId){requireIdentifier(householdId,"Household ID");requireIdentifier(caseId,"Case ID");return unwrap(await this.client.from("deliveries").select("id, plan_id, plan_version, channel, status, attempt_count, sent_at, acknowledged_at, created_at").eq("household_id",householdId).eq("case_id",caseId).order("created_at",{ascending:false}),"Load deliveries")}
  async acknowledgeDelivery(householdId,deliveryId){requireIdentifier(householdId,"Household ID");requireIdentifier(deliveryId,"Delivery ID");const rows=unwrap(await this.client.rpc("acknowledge_guardian_delivery",{target_household:householdId,target_delivery:deliveryId}),"Acknowledge delivery");return rows?.[0]??null}
  async listRevisions(householdId,caseId){requireIdentifier(householdId,"Household ID");requireIdentifier(caseId,"Case ID");return unwrap(await this.client.from("revision_requests").select("id, reason, entitlement_index, status, disposition_reason, change_summary, created_at, completed_at").eq("household_id",householdId).eq("case_id",caseId).order("created_at",{ascending:false}),"Load revisions")}
  async requestRevision(input){const valid=validateRevisionRequest(input);const rows=unwrap(await this.client.rpc("request_guardian_revision",{target_household:valid.householdId,target_case:valid.caseId,request_reason:valid.reason}),"Request revision");return rows?.[0]??null}
  async exportHousehold(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.rpc("export_guardian_household",{target_household:householdId}),"Export household")}
  async listPrivacyRequests(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("privacy_requests").select("id, kind, status, reason, created_at, resolved_at, resolution_note").eq("household_id",householdId).order("created_at",{ascending:false}),"Load privacy requests")}
  async requestDeletion(input){const valid=validateDeletionRequest(input);const rows=unwrap(await this.client.rpc("request_guardian_household_deletion",{target_household:valid.householdId,request_reason:valid.reason||null}),"Request household deletion");return rows?.[0]??null}
  async listStaffProfiles(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("learner_profiles").select("id, learner_id, version, planning_context, submitted_at, created_at").eq("household_id",householdId).order("version",{ascending:false}),"Load staff intake queue")}
  async listStaffPlans(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("plans").select("id, case_id, learner_id, version, status, authored_by, reviewed_by, published_at, created_at, plan_weeks(id, week_number, theme, plan_days(id, day_number, planned_date, lessons(*, resources(*))))").eq("household_id",householdId).order("created_at",{ascending:false}),"Load staff plans")}
  async listStaffReviews(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("plan_reviews").select("id, plan_id, reviewer_user_id, curriculum_checked, safeguarding_checked, accessibility_checked, resource_rights_checked, notes, approved_at, created_at").eq("household_id",householdId).order("created_at",{ascending:false}),"Load plan reviews")}
  async listStaffRevisions(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("revision_requests").select("id, case_id, requested_by, reason, entitlement_index, status, disposition_reason, change_summary, created_at, completed_at").eq("household_id",householdId).order("created_at",{ascending:false}),"Load staff revisions")}
  async listEducatorCapacities(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("educator_capacities").select("educator_user_id, max_active_cases, updated_at").eq("household_id",householdId).order("updated_at",{ascending:false}),"Load educator capacity")}
  async listStaffDeliveries(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("deliveries").select("id, case_id, plan_id, plan_version, channel, status, attempt_count, last_error_code, sent_at, acknowledged_at, created_at").eq("household_id",householdId).order("created_at",{ascending:false}),"Load staff deliveries")}
  async listStaffMessages(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("case_messages").select("id, case_id, sender_user_id, kind, body, response_owner_user_id, response_due_at, resolved_at, created_at, case_message_reads!case_message_reads_message_id_fkey(user_id, read_at), case_attachments(id, file_name, mime_type, size_bytes, status, object_path, created_at, uploaded_at, scanned_at, scan_result_code)").eq("household_id",householdId).order("created_at"),"Load staff messages")}
  async listStaffOrders(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("orders").select("id, external_checkout_id, package_code, payment_status, currency, amount_cents, last_event_at, created_at, updated_at").eq("household_id",householdId).order("created_at",{ascending:false}),"Load staff orders")}
  async listStaffPaymentEvents(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("payment_events").select("id, case_id, order_id, provider_event_key, external_checkout_id, payment_status, package_code, currency, amount_cents, occurred_at, processed_at").eq("household_id",householdId).order("occurred_at",{ascending:false}),"Load staff payment events")}
  async listAdminOperationalEvents(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("operational_events").select("id, component, severity, event_code, correlation_key, metadata, occurred_at, recorded_at").eq("household_id",householdId).order("occurred_at",{ascending:false}).limit(100),"Load operational events")}
  async getAdminOperationalHealth(householdId,evaluatedAt=new Date().toISOString()){requireIdentifier(householdId,"Household ID");const timestamp=new Date(evaluatedAt);if(Number.isNaN(timestamp.valueOf()))throw new TypeError("Health evaluation time is invalid");return unwrap(await this.client.rpc("admin_operational_health_snapshot",{target_household:householdId,evaluated_at:timestamp.toISOString()}),"Load operational health")}
  async listAdminDeletionJobs(householdId){requireIdentifier(householdId,"Household ID");return unwrap(await this.client.from("deletion_jobs").select("id, privacy_request_id, status, eligible_at, approved_by, approval_basis, identity_verified, co_guardian_reviewed, legal_hold, created_at, cancelled_at, cancellation_reason, started_at, completed_at, failure_code").eq("household_id",householdId).order("created_at",{ascending:false}),"Load deletion jobs")}
  async scheduleAdminDeletion({householdId,requestId,eligibleAt,retentionBasis,identityVerified,coGuardianReviewed}){requireIdentifier(householdId,"Household ID");requireIdentifier(requestId,"Privacy request ID");const timestamp=new Date(eligibleAt);if(Number.isNaN(timestamp.valueOf()))throw new TypeError("Deletion eligibility time is invalid");const basis=typeof retentionBasis==="string"?retentionBasis.trim():"";if(basis.length<10||basis.length>2000)throw new TypeError("Retention basis must be between 10 and 2000 characters");if(identityVerified!==true||coGuardianReviewed!==true)throw new TypeError("Identity and co-guardian safeguards are required");const rows=unwrap(await this.client.rpc("admin_schedule_household_deletion",{target_household:householdId,target_request:requestId,deletion_eligible_at:timestamp.toISOString(),retention_basis:basis,identity_verified:true,co_guardian_reviewed:true}),"Schedule household deletion");return rows?.[0]??null}
  async cancelAdminDeletion({householdId,jobId,reason}){requireIdentifier(householdId,"Household ID");requireIdentifier(jobId,"Deletion job ID");const value=typeof reason==="string"?reason.trim():"";if(!value||value.length>1000)throw new TypeError("Cancellation reason must be between 1 and 1000 characters");const rows=unwrap(await this.client.rpc("admin_cancel_household_deletion",{target_household:householdId,target_job:jobId,cancel_reason:value}),"Cancel household deletion");return rows?.[0]??null}
  async retentionCandidates({householdId,deletedHouseholdDays=30,closedCaseDays=365,asOf}={}){
    requireIdentifier(householdId,"Household ID");
    for(const [label,days] of [["Deleted-household window",deletedHouseholdDays],["Closed-case window",closedCaseDays]]){if(!Number.isInteger(days)||days<1||days>3650)throw new TypeError(`${label} must be a whole number of days between 1 and 3650`)}
    const evaluated=asOf===undefined||asOf===null?new Date():new Date(asOf);if(Number.isNaN(evaluated.valueOf()))throw new TypeError("Retention evaluation time is invalid");
    const rows=unwrap(await this.client.rpc("admin_retention_candidates",{target_household:householdId,deleted_household_days:deletedHouseholdDays,closed_case_days:closedCaseDays,as_of:evaluated.toISOString()}),"Evaluate retention candidates");
    const candidates=rows??[];
    return{household:candidates.filter(row=>row.candidate_type==="household").map(row=>row.candidate_id),cases:candidates.filter(row=>row.candidate_type==="case").map(row=>row.candidate_id)};
  }
  async transitionStaffCase({householdId,caseId,status,reason=""}){requireIdentifier(householdId,"Household ID");requireIdentifier(caseId,"Case ID");if(!String(status).trim())throw new Error("Case status is required");const rows=unwrap(await this.client.rpc("staff_transition_case",{target_household:householdId,target_case:caseId,next_status:status,transition_reason:String(reason).trim()||null}),"Transition case");return rows?.[0]??null}
  async createStaffCase({householdId,learnerId,packageCode}){requireIdentifier(householdId,"Household ID");requireIdentifier(learnerId,"Learner ID");if(!["essentials","complete","annual"].includes(packageCode))throw new TypeError("Package code is invalid");const rows=unwrap(await this.client.rpc("staff_create_case",{target_household:householdId,target_learner:learnerId,target_package_code:packageCode}),"Create case");return rows?.[0]??null}
  async assignStaffCase({householdId,caseId,educatorId}){requireIdentifier(householdId,"Household ID");requireIdentifier(caseId,"Case ID");requireIdentifier(educatorId,"Educator ID");const rows=unwrap(await this.client.rpc("staff_assign_case",{target_household:householdId,target_case:caseId,target_educator:educatorId}),"Assign case");return rows?.[0]??null}
  async reviewStaffPlan({householdId,planId,checks,notes=""}){requireIdentifier(householdId,"Household ID");requireIdentifier(planId,"Plan ID");const rows=unwrap(await this.client.rpc("staff_review_plan",{target_household:householdId,target_plan:planId,curriculum_checked:checks?.curriculum===true,safeguarding_checked:checks?.safeguarding===true,accessibility_checked:checks?.accessibility===true,resource_rights_checked:checks?.resourceRights===true,review_notes:String(notes).trim()||null}),"Review plan");return rows?.[0]??null}
  async decideStaffRevision({householdId,revisionId,decision,reason=""}){requireIdentifier(householdId,"Household ID");requireIdentifier(revisionId,"Revision ID");if(!["accepted","declined"].includes(decision))throw new Error("Revision decision must be accepted or declined");const rows=unwrap(await this.client.rpc("staff_decide_revision",{target_household:householdId,target_revision:revisionId,decision,decision_reason:String(reason).trim()||null}),"Decide revision");return rows?.[0]??null}
  async createStaffPlanVersion({householdId,caseId,document}){requireIdentifier(householdId,"Household ID");requireIdentifier(caseId,"Case ID");const rows=unwrap(await this.client.rpc("staff_create_plan_version",{target_household:householdId,target_case:caseId,plan_document:validateStaffPlanDocument(document)}),"Create plan version");return rows?.[0]??null}
  async addStaffPlanResource({householdId,planId,lessonId,resource}){requireIdentifier(householdId,"Household ID");requireIdentifier(planId,"Plan ID");requireIdentifier(lessonId,"Lesson ID");const rows=unwrap(await this.client.rpc("staff_add_plan_resource",{target_household:householdId,target_plan:planId,target_lesson:lessonId,resource_document:validateStaffResource(resource)}),"Add plan resource");return rows?.[0]??null}
  async recordStaffDelivery({householdId,caseId,channel="secure_portal"}){requireIdentifier(householdId,"Household ID");requireIdentifier(caseId,"Case ID");if(!["secure_portal","email_notice"].includes(channel))throw new TypeError("Delivery channel is invalid");const rows=unwrap(await this.client.rpc("staff_record_delivery",{target_household:householdId,target_case:caseId,delivery_channel:channel}),"Record delivery");return rows?.[0]??null}
  async retryStaffDelivery({householdId,deliveryId}){requireIdentifier(householdId,"Household ID");requireIdentifier(deliveryId,"Delivery ID");const rows=unwrap(await this.client.rpc("staff_retry_delivery",{target_household:householdId,target_delivery:deliveryId}),"Retry delivery");return rows?.[0]??null}
  async resolveStaffMessage({householdId,messageId}){requireIdentifier(householdId,"Household ID");requireIdentifier(messageId,"Message ID");const rows=unwrap(await this.client.rpc("staff_resolve_case_message",{target_household:householdId,target_message:messageId}),"Resolve message");return rows?.[0]??null}
  async completeStaffRevision({householdId,revisionId,changeSummary}){requireIdentifier(householdId,"Household ID");requireIdentifier(revisionId,"Revision ID");const summary=typeof changeSummary==="string"?changeSummary.trim():"";if(!summary||summary.length>4000)throw new TypeError("Change summary must be between 1 and 4000 characters");const rows=unwrap(await this.client.rpc("staff_complete_revision",{target_household:householdId,target_revision:revisionId,revision_change_summary:summary}),"Complete revision");return rows?.[0]??null}
  async recordStaffAbsence({householdId,caseId,reason}){requireIdentifier(householdId,"Household ID");requireIdentifier(caseId,"Case ID");const value=typeof reason==="string"?reason.trim():"";if(!value||value.length>500)throw new TypeError("Absence reason must be between 1 and 500 characters");const rows=unwrap(await this.client.rpc("staff_record_educator_absence",{target_household:householdId,target_case:caseId,absence_reason:value}),"Record educator absence");return rows?.[0]??null}
  async markStaffOverdue(householdId,evaluatedAt=new Date().toISOString()){requireIdentifier(householdId,"Household ID");const timestamp=new Date(evaluatedAt);if(Number.isNaN(timestamp.valueOf()))throw new TypeError("Overdue evaluation time is invalid");return unwrap(await this.client.rpc("staff_mark_overdue_cases",{target_household:householdId,evaluated_at:timestamp.toISOString()}),"Evaluate overdue cases")}
  async acceptStaffIntake({householdId,caseId}){requireIdentifier(householdId,"Household ID");requireIdentifier(caseId,"Case ID");const rows=unwrap(await this.client.rpc("staff_accept_usable_intake",{target_household:householdId,target_case:caseId}),"Accept usable intake");return rows?.[0]??null}
}
