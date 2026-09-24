const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function requireIdentifier(value, label = "Identifier") {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

export function requireEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new TypeError("Enter a valid email address");
  return email;
}

export function requireHttpUrl(value, label = "URL") {
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${label} is invalid`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError(`${label} is invalid`);
  return url.toString();
}

export function requireIsoTimestamp(value, label = "Timestamp") {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) throw new TypeError(`${label} is invalid`);
  const [,year,month,day] = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendarDate.getUTCFullYear() !== Number(year) || calendarDate.getUTCMonth() + 1 !== Number(month) || calendarDate.getUTCDate() !== Number(day)) throw new TypeError(`${label} is invalid`);
  return new Date(value).toISOString();
}

export function requireDate(value, label = "Date") {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw new TypeError(`${label} is invalid`);
  const [year,month,day]=value.split("-").map(Number); const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)throw new TypeError(`${label} is invalid`);
  return value;
}

export function requireText(value, label, { min = 1, max } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || (max && text.length > max)) throw new TypeError(`${label} must be between ${min} and ${max ?? "unlimited"} characters`);
  return text;
}

export function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

export function validateLessonActivityInput(input) {
  if (!input || typeof input !== "object") throw new TypeError("Lesson activity is required");
  const hasReason=Boolean(input.scheduleReason); const hasDate=Boolean(input.scheduledFor);
  if(hasReason!==hasDate)throw new TypeError("Schedule reason and date must be provided together");
  return {
    householdId: requireIdentifier(input.householdId, "Household ID"), learnerId: requireIdentifier(input.learnerId, "Learner ID"), lessonId: requireIdentifier(input.lessonId, "Lesson ID"),
    userId: requireIdentifier(input.userId, "User ID"), status: requireEnum(input.status, ["not_started","in_progress","paused","completed","skipped","rescheduled"], "Lesson status"),
    note: input.note ? requireText(input.note, "Caregiver note", { max: 2000 }) : "",
    scheduleReason: hasReason ? requireEnum(input.scheduleReason,["illness","travel","caregiver_schedule","catch_up","other"],"Schedule reason") : null,
    scheduledFor: hasDate ? requireDate(input.scheduledFor,"Scheduled date") : null,
  };
}

export function validateMessageInput(input) {
  if (!input || typeof input !== "object") throw new TypeError("Message is required");
  return {
    householdId: requireIdentifier(input.householdId, "Household ID"), caseId: requireIdentifier(input.caseId, "Case ID"), userId: requireIdentifier(input.userId, "User ID"),
    responseOwnerUserId: input.responseOwnerUserId ? requireIdentifier(input.responseOwnerUserId, "Response owner ID") : null,
    responseDueAt: input.responseDueAt ? requireIsoTimestamp(input.responseDueAt, "Response due time") : null, kind: requireEnum(input.kind ?? "general", ["general","clarification","revision","service"], "Message kind"), body: requireText(input.body, "Message body", { max: 4000 }),
  };
}

export function validateMessageReadInput(input, now = () => new Date().toISOString()) {
  if (!input || typeof input !== "object") throw new TypeError("Message acknowledgement is required");
  return {
    householdId: requireIdentifier(input.householdId, "Household ID"),
    messageId: requireIdentifier(input.messageId, "Message ID"),
    userId: requireIdentifier(input.userId, "User ID"),
    readAt: input.readAt ? requireIsoTimestamp(input.readAt, "Read time") : requireIsoTimestamp(now(), "Read time"),
  };
}

export const ATTACHMENT_MIME_TYPES=["application/pdf","image/jpeg","image/png","text/plain"];

export function validateAttachmentFile(file){
  if(!file||typeof file!=="object")throw new TypeError("Choose an attachment");
  const name=typeof file.name==="string"?file.name.trim():"";const type=typeof file.type==="string"?file.type:"";const size=Number(file.size);
  if(!name||name.length>180||/[\\/]/.test(name))throw new TypeError("Attachment file name is invalid");
  if(!ATTACHMENT_MIME_TYPES.includes(type))throw new TypeError("Attachment must be a PDF, JPEG, PNG, or plain-text file");
  if(!Number.isInteger(size)||size<1||size>10485760)throw new TypeError("Attachment must be between 1 byte and 10 MB");
  if(typeof file.arrayBuffer!=="function")throw new TypeError("Attachment content is unavailable");
  return{file,name,type,size};
}

export const INTAKE_SUBJECTS=["Language","Math","Science","Social studies","French","Arts","Health and physical education"];

export function validateGuardianIntake(input) {
  if(!input||typeof input!=="object")throw new TypeError("Guardian intake is required");
  const subjects=Array.isArray(input.subjects)?[...new Set(input.subjects)]:[];
  if(subjects.length<1||subjects.length>8||subjects.some(subject=>!INTAKE_SUBJECTS.includes(subject)))throw new TypeError("Choose at least one valid subject");
  if(input.guardianConsent!==true)throw new TypeError("Guardian consent is required before submission");
  return {
    householdId:requireIdentifier(input.householdId,"Household ID"),learnerId:requireIdentifier(input.learnerId,"Learner ID"),noticeVersion:requireText(input.noticeVersion,"Privacy notice version",{max:80}),
    purposes:["personalized_learning_plan"],
    context:{subjects,priorAttainment:requireText(input.priorAttainment,"Prior attainment",{max:1000}),strengthsInterests:requireText(input.strengthsInterests,"Strengths and interests",{max:1000}),goals:requireText(input.goals,"Learning goals",{max:1000}),learningSupports:input.learningSupports?requireText(input.learningSupports,"Learning supports",{max:1000}):"",language:requireText(input.language,"Learning language",{max:120}),weeklySchedule:requireText(input.weeklySchedule,"Weekly schedule",{max:500}),caregiverAvailability:requireText(input.caregiverAvailability,"Caregiver availability",{max:500}),deviceAccess:requireEnum(input.deviceAccess,["computer_printer","computer_no_printer","tablet","limited"],"Device access"),resourceBudget:requireEnum(input.resourceBudget,["free_only","up_to_25","up_to_50","discuss"],"Resource budget"),contentConstraints:input.contentConstraints?requireText(input.contentConstraints,"Content constraints",{max:1000}):"",accessibilityNeeds:input.accessibilityNeeds?requireText(input.accessibilityNeeds,"Accessibility needs",{max:1000}):""}
  };
}

export function validateRevisionRequest(input){
  if(!input||typeof input!=="object")throw new TypeError("Revision request is required");
  return{householdId:requireIdentifier(input.householdId,"Household ID"),caseId:requireIdentifier(input.caseId,"Case ID"),reason:requireText(input.reason,"Revision reason",{max:2000})};
}

export function validateDeletionRequest(input){
  if(!input||typeof input!=="object")throw new TypeError("Deletion request is required");
  if(input.confirmed!==true)throw new TypeError("Confirm that you understand deletion requires identity and retention review");
  return{householdId:requireIdentifier(input.householdId,"Household ID"),reason:input.reason?requireText(input.reason,"Deletion reason",{max:1000}):""};
}

export function validateStaffPlanDocument(input){
  if(!input||typeof input!=="object")throw new TypeError("Plan document is required");const weeks=Array.isArray(input.weeks)?input.weeks:[];if(weeks.length<1||weeks.length>52)throw new TypeError("Plan requires 1 to 52 weeks");let lessonCount=0;
  const document={weeks:weeks.map((week,weekIndex)=>{const days=Array.isArray(week.days)?week.days:[];if(days.length<1||days.length>7)throw new TypeError(`Week ${weekIndex+1} requires 1 to 7 days`);return{number:Number.isInteger(week.number)&&week.number>=1&&week.number<=52?week.number:(()=>{throw new TypeError("Week number is invalid")})(),theme:requireText(week.theme,"Week theme",{max:200}),days:days.map((day,dayIndex)=>{const lessons=Array.isArray(day.lessons)?day.lessons:[];if(lessons.length<1||lessons.length>20)throw new TypeError(`Day ${dayIndex+1} requires 1 to 20 lessons`);return{number:Number.isInteger(day.number)&&day.number>=1&&day.number<=7?day.number:(()=>{throw new TypeError("Day number is invalid")})(),plannedDate:day.plannedDate?requireDate(day.plannedDate,"Planned date"):null,lessons:lessons.map((lesson,index)=>{lessonCount+=1;const instructions=Array.isArray(lesson.instructions)?lesson.instructions.map(item=>requireText(item,"Instruction",{max:1000})):[];if(!instructions.length||instructions.length>20)throw new TypeError("Each lesson requires 1 to 20 instructions");const stringList=(value,label)=>{const items=Array.isArray(value)?value:[];if(items.length>20)throw new TypeError(`${label} has too many items`);return items.map(item=>requireText(item,label,{max:500}))};const adultHelp=lesson.adultHelpMinutes==null||lesson.adultHelpMinutes===""?null:Number(lesson.adultHelpMinutes);if(adultHelp!==null&&(!Number.isInteger(adultHelp)||adultHelp<0||adultHelp>480))throw new TypeError("Adult help minutes is invalid");const estimated=lesson.estimatedMinutes==null||lesson.estimatedMinutes===""?null:Number(lesson.estimatedMinutes);if(estimated!==null&&(!Number.isInteger(estimated)||estimated<5||estimated>240))throw new TypeError("Estimated minutes must be 5 to 240");const helpLevel=lesson.helpLevel?requireEnum(lesson.helpLevel,["independent","some_help","together"],"Help level"):null;const needsScreen=lesson.needsScreen==null||lesson.needsScreen===""?null:lesson.needsScreen===true||lesson.needsScreen==="true"?true:lesson.needsScreen===false||lesson.needsScreen==="false"?false:(()=>{throw new TypeError("Needs a screen must be yes or no")})();return{position:index+1,subject:requireText(lesson.subject,"Lesson subject",{max:100}),title:requireText(lesson.title,"Lesson title",{max:200}),objective:requireText(lesson.objective,"Lesson objective",{max:1000}),instructions,materials:stringList(lesson.materials,"Material"),accommodations:stringList(lesson.accommodations,"Accommodation"),adultHelpMinutes:adultHelp,estimatedMinutes:estimated,helpLevel,needsScreen}})}})}})};if(lessonCount>500)throw new TypeError("Plan has too many lessons");return document;
}

export function validateStaffResource(input){
  if(!input||typeof input!=="object")throw new TypeError("Resource is required");let url=null;if(input.url){url=requireHttpUrl(input.url,"Resource URL");if(!url.startsWith("https://"))throw new TypeError("Resource URL must use HTTPS")}
  const cost=input.estimatedCostCents==null||input.estimatedCostCents===""?null:Number(input.estimatedCostCents);if(cost!==null&&(!Number.isInteger(cost)||cost<0||cost>1000000))throw new TypeError("Resource cost is invalid");
  return{title:requireText(input.title,"Resource title",{max:200}),url,requirement:requireEnum(input.requirement,["required","optional","substitute"],"Resource requirement"),accessType:requireEnum(input.accessType,["free","paid","library","household"],"Resource access"),estimatedCostCents:cost,region:requireText(input.region,"Resource region",{max:120}),edition:input.edition?requireText(input.edition,"Resource edition",{max:120}):null,accountRequired:Boolean(input.accountRequired),adsPresent:Boolean(input.adsPresent),privacyReviewedAt:input.privacyReviewedAt?requireIsoTimestamp(input.privacyReviewedAt,"Privacy review time"):null,rightsReviewedAt:input.rightsReviewedAt?requireIsoTimestamp(input.rightsReviewedAt,"Rights review time"):null,linkCheckedAt:input.linkCheckedAt?requireIsoTimestamp(input.linkCheckedAt,"Link check time"):null,attribution:input.attribution?requireText(input.attribution,"Attribution",{max:500}):null,substituteResourceId:input.substituteResourceId?requireIdentifier(input.substituteResourceId,"Substitute resource ID"):null};
}
