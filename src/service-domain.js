export const CASE_TRANSITIONS = {
  paid: ["intake_pending", "cancelled", "refunded", "chargeback"],
  intake_pending: ["submitted", "cancelled", "refunded", "chargeback"],
  submitted: ["triage", "clarification", "cancelled", "refunded", "chargeback"],
  triage: ["clarification", "assigned", "on_hold", "overdue"],
  clarification: ["submitted", "on_hold", "cancelled"],
  assigned: ["drafting", "on_hold", "overdue"],
  drafting: ["internal_review", "on_hold", "overdue"],
  internal_review: ["drafting", "published", "on_hold"],
  published: ["delivered"],
  delivered: ["acknowledged", "overdue"],
  acknowledged: ["revision_requested", "closed"],
  revision_requested: ["revised", "on_hold"],
  revised: ["delivered", "closed"],
  on_hold: ["triage", "assigned", "drafting", "internal_review", "cancelled", "refunded"],
  overdue: ["triage", "assigned", "drafting", "delivered", "on_hold"],
  closed: [], cancelled: [], refunded: [], chargeback: [],
};

export const PACKAGE_ENTITLEMENTS = {
  essentials: { weeks: 8, includedRevisions: 0 },
  complete: { weeks: 16, includedRevisions: 1 },
  annual: { weeks: 40, includedRevisions: 4 },
};
export const PACKAGE_SLA_BUSINESS_DAYS = { essentials:5, complete:7, annual:7 };

export class AccessDeniedError extends Error { constructor(message = "Access denied") { super(message); this.name = "AccessDeniedError"; } }
export class InvalidTransitionError extends Error { constructor(from, to) { super(`Cannot transition case from ${from} to ${to}`); this.name = "InvalidTransitionError"; } }

function clone(value) { return structuredClone(value); }
function now(clock) { return clock().toISOString(); }
function addBusinessDays(value,days){const date=new Date(value);let remaining=days;while(remaining>0){date.setUTCDate(date.getUTCDate()+1);if(![0,6].includes(date.getUTCDay()))remaining-=1}return date.toISOString()}

export class InMemoryBriteLinkRepository {
  constructor(seed = {}, { clock = () => new Date() } = {}) {
    this.clock = clock;
    this.data = {
      memberships: seed.memberships ?? [], households: seed.households ?? [], learners: seed.learners ?? [], educatorCapacities: seed.educatorCapacities ?? [],
      profiles: seed.profiles ?? [], cases: seed.cases ?? [], orders: seed.orders ?? [], plans: seed.plans ?? [], resources: seed.resources ?? [], activities: seed.activities ?? [],
      messages: seed.messages ?? [], revisions: seed.revisions ?? [], deliveries: seed.deliveries ?? [], reviews: seed.reviews ?? [], audits: seed.audits ?? [],
    };
  }

  membership(actorId, householdId) { return this.data.memberships.find((m) => m.userId === actorId && m.householdId === householdId); }
  requireMember(actor, householdId) { const membership = this.membership(actor.id, householdId); if (!membership) throw new AccessDeniedError(); return membership; }
  requireRole(actor, householdId, roles) { const membership = this.requireMember(actor, householdId); if (!roles.includes(membership.role)) throw new AccessDeniedError(`Role ${membership.role} cannot perform this action`); return membership; }
  requireCase(actor, caseId) { const item = this.data.cases.find((entry) => entry.id === caseId); if (!item) throw new AccessDeniedError(); this.requireMember(actor, item.householdId); return item; }
  audit(actor, householdId, eventType, subjectType, subjectId, metadata = {}) { this.data.audits.push({ id: `audit-${this.data.audits.length + 1}`, householdId, actorId: actor.id, eventType, subjectType, subjectId, metadata: clone(metadata), createdAt: now(this.clock) }); }

  listLearners(actor, householdId) { this.requireMember(actor, householdId); return clone(this.data.learners.filter((item) => item.householdId === householdId && !item.deletedAt)); }
  listCases(actor, householdId) { this.requireMember(actor, householdId); return clone(this.data.cases.filter((item) => item.householdId === householdId)); }
  getCase(actor, caseId) { return clone(this.requireCase(actor, caseId)); }

  saveProfile(actor, householdId, learnerId, planningContext, consent) {
    this.requireRole(actor, householdId, ["guardian", "admin"]);
    if (!consent?.noticeVersion || !consent?.purposes?.length) throw new Error("Versioned guardian consent is required");
    const learner = this.data.learners.find((item) => item.id === learnerId && item.householdId === householdId && !item.deletedAt);
    if (!learner) throw new AccessDeniedError();
    const versions = this.data.profiles.filter((item) => item.learnerId === learnerId);
    const profile = { id: `profile-${this.data.profiles.length + 1}`, householdId, learnerId, version: versions.length + 1, planningContext: clone(planningContext), consent: clone(consent), createdBy: actor.id, createdAt: now(this.clock) };
    this.data.profiles.push(profile); this.audit(actor, householdId, "profile.saved", "learner_profile", profile.id, { version: profile.version }); return clone(profile);
  }

  correctProfile(actor, householdId, profileId, planningContext, reason) {
    this.requireRole(actor,householdId,["guardian","admin"]); if(!reason?.trim())throw new Error("A correction reason is required");
    const previous=this.data.profiles.find((entry)=>entry.id===profileId&&entry.householdId===householdId); if(!previous)throw new AccessDeniedError();
    const corrected=this.saveProfile(actor,householdId,previous.learnerId,planningContext,previous.consent); corrected.correctsProfileId=profileId; corrected.correctionReason=reason.trim().slice(0,1000);
    const stored=this.data.profiles.find((entry)=>entry.id===corrected.id); Object.assign(stored,{correctsProfileId:profileId,correctionReason:corrected.correctionReason});
    this.audit(actor,householdId,"profile.corrected","learner_profile",corrected.id,{previousProfileId:profileId,reason:corrected.correctionReason}); return clone(stored);
  }

  saveLessonActivity(actor, householdId, learnerId, lessonId, status, note = "") {
    this.requireRole(actor, householdId, ["guardian", "admin"]);
    if (!['not_started','in_progress','paused','completed','skipped','rescheduled'].includes(status)) throw new Error("Invalid activity status");
    const learner = this.data.learners.find((item) => item.id === learnerId && item.householdId === householdId && !item.deletedAt); if (!learner) throw new AccessDeniedError();
    const existing = this.data.activities.find((item) => item.householdId === householdId && item.learnerId === learnerId && item.lessonId === lessonId);
    const record = { householdId, learnerId, lessonId, status, note: note.slice(0, 2000), updatedBy: actor.id, updatedAt: now(this.clock) };
    if (existing) Object.assign(existing, record); else this.data.activities.push(record);
    this.audit(actor, householdId, "lesson_activity.saved", "lesson", lessonId, { status }); return clone(record);
  }

  transitionCase(actor, caseId, nextStatus, reason = "") {
    const item = this.requireCase(actor, caseId); this.requireRole(actor, item.householdId, ["educator", "admin"]);
    if (!CASE_TRANSITIONS[item.status]?.includes(nextStatus)) throw new InvalidTransitionError(item.status, nextStatus);
    if (nextStatus === "published") {
      const latestPlan = this.data.plans.filter((plan) => plan.caseId === caseId).sort((a,b) => b.version-a.version)[0];
      const approved = this.data.reviews.some((review) => review.caseId === caseId && review.approvedAt && (!latestPlan || review.planId === latestPlan.id));
      if (!approved) throw new Error("An approved internal review is required before publishing");
      if (latestPlan) {
        const governance = this.checkResourceGovernance(actor, latestPlan.id);
        if (!governance.ready) throw new Error(`Resource governance is incomplete: ${governance.issues.join(", ")}`);
        for(const plan of this.data.plans.filter((entry)=>entry.caseId===caseId&&entry.id!==latestPlan.id&&entry.status==="published"))plan.status="archived";
        latestPlan.status = "published"; latestPlan.publishedAt = now(this.clock);
      }
    }
    const previous = item.status; item.status = nextStatus; item.updatedAt = now(this.clock); if (reason) item.statusReason = reason;
    this.audit(actor, item.householdId, "case.transitioned", "service_case", item.id, { from: previous, to: nextStatus, reason }); return clone(item);
  }

  acceptUsableIntake(actor,caseId){const item=this.requireCase(actor,caseId);this.requireRole(actor,item.householdId,["educator","admin"]);if(!["submitted","clarification"].includes(item.status))throw new Error("Case does not have a submitted intake");const profile=this.data.profiles.filter((entry)=>entry.learnerId===item.learnerId).sort((a,b)=>b.version-a.version)[0];const context=profile?.planningContext??{};const required=["grade","jurisdiction","interests","goals"];const missing=required.filter((key)=>!String(context[key]??"").trim());if(!profile?.consent?.noticeVersion||!profile?.consent?.purposes?.length||missing.length)throw new Error(`Intake is not usable${missing.length?`: missing ${missing.join(", ")}`:""}`);const receivedAt=now(this.clock);item.intakeReceivedAt=receivedAt;item.slaDueAt=addBusinessDays(receivedAt,PACKAGE_SLA_BUSINESS_DAYS[item.packageCode]??7);const previous=item.status;item.status="triage";item.updatedAt=receivedAt;this.audit(actor,item.householdId,"intake.accepted","service_case",caseId,{from:previous,slaDueAt:item.slaDueAt,profileVersion:profile.version});return clone(item)}

  triageQueue(actor,householdId){this.requireRole(actor,householdId,["educator","admin"]);const rank={overdue:0,triage:1,on_hold:2,assigned:3};return clone(this.data.cases.filter((item)=>item.householdId===householdId&&Object.hasOwn(rank,item.status)).sort((a,b)=>rank[a.status]-rank[b.status]||String(a.slaDueAt??"9999").localeCompare(String(b.slaDueAt??"9999"))||String(a.id).localeCompare(String(b.id))))}

  createPlanVersion(actor, caseId, content) {
    const item = this.requireCase(actor, caseId); this.requireRole(actor, item.householdId, ["educator", "admin"]);
    if (!["drafting", "internal_review", "revision_requested"].includes(item.status)) throw new Error("Case is not ready for plan authoring");
    if (!Array.isArray(content?.weeks) || !content.weeks.length) throw new Error("A plan requires at least one week");
    const previous = this.data.plans.filter((plan) => plan.caseId === caseId).sort((a,b) => b.version-a.version)[0];
    const plan = { id:`plan-${this.data.plans.length+1}`, householdId:item.householdId, caseId, learnerId:item.learnerId, version:(previous?.version??0)+1, status:"draft", authoredBy:actor.id, content:clone(content), createdAt:now(this.clock) };
    this.data.plans.push(plan); this.audit(actor,item.householdId,"plan.version_created","plan",plan.id,{version:plan.version,previousPlanId:previous?.id??null}); return clone(plan);
  }

  addResource(actor, planId, input) {
    const plan=this.data.plans.find((entry)=>entry.id===planId); if(!plan) throw new AccessDeniedError(); this.requireRole(actor,plan.householdId,["educator","admin"]);
    if (input.url && !/^https:\/\//i.test(input.url)) throw new Error("Resource URLs must use HTTPS");
    if (!["required","optional","substitute"].includes(input.requirement)) throw new Error("Invalid resource requirement");
    if (!["free","paid","library","household"].includes(input.accessType)) throw new Error("Invalid resource access type");
    if (input.accessType === "paid" && (!Number.isInteger(input.estimatedCostCents) || input.estimatedCostCents < 0)) throw new Error("Paid resources require an estimated cost");
    const resource={id:`resource-${this.data.resources.length+1}`,householdId:plan.householdId,planId,lessonId:input.lessonId,title:input.title?.trim(),url:input.url??null,requirement:input.requirement,accessType:input.accessType,estimatedCostCents:input.estimatedCostCents??0,region:input.region??null,edition:input.edition??null,accountRequired:Boolean(input.accountRequired),adsPresent:Boolean(input.adsPresent),privacyReviewedAt:input.privacyReviewedAt??null,rightsReviewedAt:input.rightsReviewedAt??null,linkCheckedAt:input.linkCheckedAt??null,attribution:input.attribution?.trim()??"",substituteResourceId:input.substituteResourceId??null};
    if(!resource.title) throw new Error("Resource title is required"); this.data.resources.push(resource); this.audit(actor,plan.householdId,"resource.saved","resource",resource.id,{planId}); return clone(resource);
  }

  checkResourceGovernance(actor, planId) {
    const plan=this.data.plans.find((entry)=>entry.id===planId); if(!plan) throw new AccessDeniedError(); this.requireMember(actor,plan.householdId);
    const issues=[]; for(const resource of this.data.resources.filter((entry)=>entry.planId===planId)) {
      if(resource.url&&!resource.linkCheckedAt) issues.push(`${resource.id}: link unchecked`);
      if(resource.url&&!resource.privacyReviewedAt) issues.push(`${resource.id}: privacy unchecked`);
      if(!resource.rightsReviewedAt||!resource.attribution) issues.push(`${resource.id}: rights or attribution missing`);
      if(!resource.region) issues.push(`${resource.id}: region missing`);
      if(resource.accessType==="paid"&&!Number.isInteger(resource.estimatedCostCents)) issues.push(`${resource.id}: cost missing`);
      if(resource.requirement==="required"&&!resource.substituteResourceId) issues.push(`${resource.id}: substitute missing`);
    }
    return {ready:issues.length===0,issues};
  }

  ingestPaymentStatus(actor, caseId, orderId, paymentStatus) {
    const item = this.requireCase(actor, caseId); this.requireRole(actor, item.householdId, ["admin"]);
    if (!["paid", "refunded", "chargeback"].includes(paymentStatus)) throw new Error("Unsupported payment status");
    let order = this.data.orders.find((entry) => entry.id === orderId);
    const record = { id: orderId, householdId: item.householdId, caseId, packageCode: item.packageCode, paymentStatus, updatedAt: now(this.clock) };
    if (order) Object.assign(order, record); else { order = record; this.data.orders.push(order); }
    if (["refunded", "chargeback"].includes(paymentStatus) && !["closed", "cancelled", "refunded", "chargeback"].includes(item.status)) {
      const previous = item.status; item.status = paymentStatus; item.statusReason = `Payment ${paymentStatus}`; item.updatedAt = now(this.clock);
      this.audit(actor, item.householdId, "case.transitioned", "service_case", item.id, { from: previous, to: paymentStatus, reason: item.statusReason });
    }
    this.audit(actor, item.householdId, "payment.status_ingested", "order", orderId, { paymentStatus }); return clone(order);
  }

  assignCase(actor, caseId, educatorId) {
    const item = this.requireCase(actor, caseId); this.requireRole(actor, item.householdId, ["admin"]);
    const educator = this.membership(educatorId, item.householdId);
    if (!educator || educator.role !== "educator") throw new AccessDeniedError("Assignee must be an educator in this household");
    const limit=this.data.educatorCapacities.find((entry)=>entry.householdId===item.householdId&&entry.educatorId===educatorId)?.maxActiveCases??Infinity;const active=this.data.cases.filter((entry)=>entry.householdId===item.householdId&&entry.assignedEducatorId===educatorId&&["assigned","drafting","internal_review"].includes(entry.status)&&entry.id!==caseId).length;if(active>=limit)throw new Error("Educator has reached active case capacity");
    item.assignedEducatorId = educatorId; item.updatedAt = now(this.clock);
    this.audit(actor, item.householdId, "case.assigned", "service_case", caseId, { educatorId }); return clone(item);
  }

  recordEducatorAbsence(actor, caseId, reason = "Educator unavailable") {
    const item = this.requireCase(actor, caseId); this.requireRole(actor, item.householdId, ["admin"]);
    if (!["assigned", "drafting", "internal_review"].includes(item.status)) throw new Error("Case is not in an educator-owned state");
    const previous = item.status; item.status = "on_hold"; item.statusReason = reason.slice(0, 500); item.previousOperationalStatus = previous; item.assignedEducatorId = null; item.updatedAt = now(this.clock);
    this.audit(actor, item.householdId, "educator.absence_recorded", "service_case", caseId, { from: previous, reason: item.statusReason }); return clone(item);
  }

  markOverdueCases(actor, asOf = this.clock()) {
    const dueAt = asOf instanceof Date ? asOf : new Date(asOf); if (Number.isNaN(dueAt.valueOf())) throw new Error("Invalid overdue evaluation time");
    const eligible = new Set(["triage", "assigned", "drafting", "delivered"]); const changed = [];
    for (const item of this.data.cases) {
      const membership = this.membership(actor.id, item.householdId); if (!membership || membership.role !== "admin" || !item.slaDueAt || !eligible.has(item.status) || new Date(item.slaDueAt) > dueAt) continue;
      const previous = item.status; item.status = "overdue"; item.statusReason = "SLA due time passed"; item.updatedAt = now(this.clock); changed.push(clone(item));
      this.audit(actor, item.householdId, "case.marked_overdue", "service_case", item.id, { from: previous, slaDueAt: item.slaDueAt });
    }
    return changed;
  }

  savePlanReview(actor, caseId, checks, notes = "") {
    const item = this.requireCase(actor, caseId); this.requireRole(actor, item.householdId, ["educator", "admin"]);
    if (!["internal_review","revision_requested"].includes(item.status)) throw new Error("Case must be in internal review or an accepted revision workflow");
    if(item.status==="revision_requested"&&!this.data.revisions.some((revision)=>revision.caseId===caseId&&revision.status==="accepted"))throw new Error("Revision must be accepted before review");
    const required = ["curriculum", "safeguarding", "accessibility", "resourceRights"];
    const approved = required.every((key) => checks[key] === true);
    const latestPlan = this.data.plans.filter((plan) => plan.caseId === caseId).sort((a,b) => b.version-a.version)[0];
    const review = { id: `review-${this.data.reviews.length + 1}`, householdId: item.householdId, caseId, planId: latestPlan?.id ?? null, reviewerId: actor.id, checks: clone(checks), notes: notes.slice(0, 4000), approvedAt: approved ? now(this.clock) : null, createdAt: now(this.clock) };
    this.data.reviews.push(review); this.audit(actor, item.householdId, approved ? "plan_review.approved" : "plan_review.saved", "plan_review", review.id, { checks: clone(checks) }); return clone(review);
  }

  sendMessage(actor, caseId, body, kind = "general") {
    const item = this.requireCase(actor, caseId); if (!body?.trim()) throw new Error("Message body is required");
    const membership=this.requireMember(actor,item.householdId); const staffIds=this.data.memberships.filter((entry)=>entry.householdId===item.householdId&&["educator","admin"].includes(entry.role)).map((entry)=>entry.userId);
    const responseOwnerId=membership.role==="guardian"?(item.assignedEducatorId??staffIds[0]??null):this.data.memberships.find((entry)=>entry.householdId===item.householdId&&entry.role==="guardian")?.userId??null;
    const createdAt=now(this.clock); const responseDueAt=responseOwnerId?new Date(new Date(createdAt).getTime()+2*24*60*60*1000).toISOString():null;
    const message = { id: `message-${this.data.messages.length + 1}`, householdId: item.householdId, caseId, senderId: actor.id, kind, body: body.trim().slice(0, 4000), responseOwnerId, responseDueAt, readBy:[actor.id], resolvedAt:null, createdAt };
    this.data.messages.push(message); this.audit(actor, item.householdId, "message.sent", "message", message.id, { caseId, kind, responseOwnerId, responseDueAt }); return clone(message);
  }
  listMessages(actor, caseId) { const item = this.requireCase(actor, caseId); return clone(this.data.messages.filter((message) => message.householdId === item.householdId && message.caseId === caseId)); }
  markMessageRead(actor,messageId){const message=this.data.messages.find((entry)=>entry.id===messageId);if(!message)throw new AccessDeniedError();this.requireMember(actor,message.householdId);message.readBy??=[];if(!message.readBy.includes(actor.id))message.readBy.push(actor.id);this.audit(actor,message.householdId,"message.read","message",messageId);return clone(message)}
  resolveMessage(actor,messageId){const message=this.data.messages.find((entry)=>entry.id===messageId);if(!message)throw new AccessDeniedError();this.requireMember(actor,message.householdId);if(message.responseOwnerId!==actor.id)this.requireRole(actor,message.householdId,["admin"]);message.resolvedAt=now(this.clock);this.audit(actor,message.householdId,"message.resolved","message",messageId);return clone(message)}
  messageInbox(actor,householdId,asOf=this.clock()){this.requireMember(actor,householdId);const evaluated=asOf instanceof Date?asOf:new Date(asOf);return clone(this.data.messages.filter((message)=>message.householdId===householdId&&message.senderId!==actor.id).map((message)=>({...message,unread:!message.readBy?.includes(actor.id),responseOverdue:message.responseOwnerId===actor.id&&!message.resolvedAt&&message.responseDueAt&&new Date(message.responseDueAt)<evaluated})))}

  recordDelivery(actor, caseId, channel, artifactVersion) {
    const item = this.requireCase(actor, caseId); this.requireRole(actor, item.householdId, ["educator", "admin"]); if (item.status !== "published" && item.status !== "revised") throw new Error("Only published or revised plans can be delivered");
    const delivery = { id: `delivery-${this.data.deliveries.length + 1}`, householdId: item.householdId, caseId, channel, artifactVersion, status: "sent", attemptCount: 1, sentAt: now(this.clock), lastError: null, acknowledgedAt: null };
    this.data.deliveries.push(delivery); this.transitionCase(actor, caseId, "delivered"); this.audit(actor, item.householdId, "delivery.sent", "delivery", delivery.id); return clone(delivery);
  }
  recordDeliveryFailure(actor, deliveryId, status, errorMessage) {
    const delivery = this.data.deliveries.find((item) => item.id === deliveryId); if (!delivery) throw new AccessDeniedError(); this.requireRole(actor, delivery.householdId, ["educator", "admin"]);
    if (!["failed", "bounced"].includes(status)) throw new Error("Delivery failure must be failed or bounced");
    delivery.status = status; delivery.lastError = errorMessage.trim().slice(0, 1000); delivery.failedAt = now(this.clock);
    this.audit(actor, delivery.householdId, `delivery.${status}`, "delivery", delivery.id, { attemptCount: delivery.attemptCount }); return clone(delivery);
  }
  retryDelivery(actor, deliveryId) {
    const delivery = this.data.deliveries.find((item) => item.id === deliveryId); if (!delivery) throw new AccessDeniedError(); this.requireRole(actor, delivery.householdId, ["educator", "admin"]);
    if (!["failed", "bounced"].includes(delivery.status)) throw new Error("Only failed or bounced deliveries can be retried");
    delivery.status = "sent"; delivery.attemptCount += 1; delivery.lastError = null; delivery.sentAt = now(this.clock);
    this.audit(actor, delivery.householdId, "delivery.retried", "delivery", delivery.id, { attemptCount: delivery.attemptCount }); return clone(delivery);
  }
  acknowledgeDelivery(actor, deliveryId) {
    const delivery = this.data.deliveries.find((item) => item.id === deliveryId); if (!delivery) throw new AccessDeniedError(); this.requireRole(actor, delivery.householdId, ["guardian", "admin"]);
    delivery.status = "acknowledged"; delivery.acknowledgedAt = now(this.clock); const serviceCase = this.data.cases.find((item) => item.id === delivery.caseId); if (serviceCase?.status === "delivered") serviceCase.status = "acknowledged";
    this.audit(actor, delivery.householdId, "delivery.acknowledged", "delivery", delivery.id); return clone(delivery);
  }

  requestRevision(actor, caseId, reason) {
    const item = this.requireCase(actor, caseId); this.requireRole(actor, item.householdId, ["guardian", "admin"]); if (item.status !== "acknowledged") throw new Error("Delivery must be acknowledged before requesting a revision");
    if(!reason?.trim())throw new Error("Revision reason is required");
    const entitlement = PACKAGE_ENTITLEMENTS[item.packageCode]; const used = this.data.revisions.filter((revision) => revision.caseId === caseId && revision.status !== "declined").length;
    if (!entitlement || used >= entitlement.includedRevisions) throw new Error("No included revisions remain");
    const revision = { id: `revision-${this.data.revisions.length + 1}`, householdId: item.householdId, caseId, reason: reason.trim().slice(0, 2000), status: "requested", requestedBy: actor.id, createdAt: now(this.clock) };
    this.data.revisions.push(revision); item.status = "revision_requested"; this.audit(actor, item.householdId, "revision.requested", "revision", revision.id, { remaining: entitlement.includedRevisions - used - 1 }); return clone(revision);
  }
  decideRevision(actor,revisionId,decision,dispositionReason=""){const revision=this.data.revisions.find((entry)=>entry.id===revisionId);if(!revision)throw new AccessDeniedError();this.requireRole(actor,revision.householdId,["educator","admin"]);if(revision.status!=="requested")throw new Error("Revision has already been decided");if(!["accepted","declined"].includes(decision))throw new Error("Revision decision must be accepted or declined");if(decision==="declined"&&!dispositionReason?.trim())throw new Error("A decline reason is required");revision.status=decision;revision.decidedBy=actor.id;revision.dispositionReason=dispositionReason.trim().slice(0,2000);revision.decidedAt=now(this.clock);const item=this.data.cases.find((entry)=>entry.id===revision.caseId);if(decision==="declined"&&item?.status==="revision_requested")item.status="acknowledged";this.audit(actor,revision.householdId,`revision.${decision}`,"revision",revisionId,{dispositionReason:revision.dispositionReason});return clone(revision)}
  completeRevision(actor,revisionId,changeSummary){const revision=this.data.revisions.find((entry)=>entry.id===revisionId);if(!revision)throw new AccessDeniedError();this.requireRole(actor,revision.householdId,["educator","admin"]);if(revision.status!=="accepted")throw new Error("Revision must be accepted before completion");if(!changeSummary?.trim())throw new Error("A change summary is required");const plans=this.data.plans.filter((plan)=>plan.caseId===revision.caseId).sort((a,b)=>b.version-a.version);const plan=plans[0];if(!plan||plan.version<2)throw new Error("A new plan version is required");if(!this.data.reviews.some((review)=>review.planId===plan.id&&review.approvedAt))throw new Error("The revised plan requires approved internal review");const governance=this.checkResourceGovernance(actor,plan.id);if(!governance.ready)throw new Error(`Resource governance is incomplete: ${governance.issues.join(", ")}`);for(const previous of plans.filter((entry)=>entry.id!==plan.id&&entry.status==="published"))previous.status="archived";plan.status="published";plan.publishedAt=now(this.clock);revision.status="completed";revision.completedPlanId=plan.id;revision.changeSummary=changeSummary.trim().slice(0,4000);revision.completedAt=now(this.clock);this.transitionCase(actor,revision.caseId,"revised","Approved revision completed");this.audit(actor,revision.householdId,"revision.completed","revision",revisionId,{planId:plan.id,planVersion:plan.version,changeSummary:revision.changeSummary});return clone(revision)}

  exportHousehold(actor, householdId) {
    this.requireRole(actor, householdId, ["guardian", "admin"]); const output = {};
    for (const [key, records] of Object.entries(this.data)) output[key] = clone(records.filter((record) => record.householdId === householdId || (key === "households" && record.id === householdId)));
    this.audit(actor, householdId, "privacy.exported", "household", householdId); return output;
  }
  deleteHousehold(actor, householdId) {
    this.requireRole(actor, householdId, ["guardian", "admin"]); const household = this.data.households.find((item) => item.id === householdId); if (!household) throw new AccessDeniedError();
    household.deletedAt = now(this.clock); for (const learner of this.data.learners.filter((item) => item.householdId === householdId)) learner.deletedAt = household.deletedAt;
    this.audit(actor, householdId, "privacy.deletion_requested", "household", householdId); return { householdId, deletedAt: household.deletedAt };
  }

  retentionCandidates(actor,householdId,{deletedHouseholdDays=30,closedCaseDays=365}={},asOf=this.clock()){
    this.requireRole(actor,householdId,["admin"]); const evaluated=asOf instanceof Date?asOf:new Date(asOf);if(Number.isNaN(evaluated.valueOf()))throw new Error("Invalid retention evaluation time");
    const olderThan=(value,days)=>Boolean(value)&&evaluated-new Date(value)>=days*24*60*60*1000;
    return {household:this.data.households.filter((item)=>item.id===householdId&&olderThan(item.deletedAt,deletedHouseholdDays)).map((item)=>item.id),cases:this.data.cases.filter((item)=>item.householdId===householdId&&item.status==="closed"&&olderThan(item.closedAt??item.updatedAt,closedCaseDays)).map((item)=>item.id)};
  }

  offboardMember(actor,householdId,userId,reason){this.requireRole(actor,householdId,["admin"]);if(!reason?.trim())throw new Error("An offboarding reason is required");const membership=this.membership(userId,householdId);if(!membership)throw new AccessDeniedError();if(membership.role==="guardian"&&this.data.memberships.filter((item)=>item.householdId===householdId&&item.role==="guardian").length===1)throw new Error("Cannot remove the last guardian");this.data.memberships=this.data.memberships.filter((item)=>item!==membership);for(const item of this.data.cases.filter((entry)=>entry.householdId===householdId&&entry.assignedEducatorId===userId)){item.assignedEducatorId=null;item.status="on_hold";item.statusReason="Assigned educator offboarded"}this.audit(actor,householdId,"member.offboarded","membership",userId,{role:membership.role,reason:reason.trim().slice(0,1000)});return {householdId,userId,role:membership.role}}
}

export function createServiceSeed() {
  return {
    households: [{ id: "house-a", displayName: "Morgan household" }, { id: "house-b", displayName: "Taylor household" }],
    memberships: [
      { householdId: "house-a", userId: "guardian-a", role: "guardian" }, { householdId: "house-a", userId: "educator-a", role: "educator" }, { householdId: "house-a", userId: "admin-a", role: "admin" },
      { householdId: "house-b", userId: "guardian-b", role: "guardian" }, { householdId: "house-b", userId: "educator-b", role: "educator" },
    ],
    educatorCapacities:[{householdId:"house-a",educatorId:"educator-a",maxActiveCases:2},{householdId:"house-b",educatorId:"educator-b",maxActiveCases:2}],
    learners: [{ id: "learner-a", householdId: "house-a", preferredName: "Riley" }, { id: "learner-b", householdId: "house-b", preferredName: "Sam" }],
    cases: [
      { id: "case-a", householdId: "house-a", learnerId: "learner-a", packageCode: "complete", status: "paid" },
      { id: "case-b", householdId: "house-b", learnerId: "learner-b", packageCode: "essentials", status: "paid" },
    ],
  };
}
