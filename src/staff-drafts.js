import {lessonInstructionTexts} from './authenticated-workspace.js';
import {discardDraft,draftKey,loadDraft,saveDraft} from './form-drafts.js';
export const emptyLesson=()=>({subject:"",title:"",objective:"",instructions:"",materials:"",accommodations:"",adultHelpMinutes:"",estimatedMinutes:"",helpLevel:"",needsScreen:""});
export const emptyDay=number=>({number,plannedDate:"",lessons:[emptyLesson()]});
export const emptyWeek=number=>({number,theme:"",days:[emptyDay(1)]});

// Kept with every other draft (src/form-drafts.js): on this device for up to 24 hours, for the same
// educator only, and removed on save, on "Discard draft", or when anyone presses Sign out.
export function staffDraftKey({householdId,caseId,userId}){return draftKey(userId,"staff-plan",householdId,caseId)}
export function loadStaffDraft(storage,key,now){const value=loadDraft(storage,key,now);return Array.isArray(value?.weeks)&&value.weeks.length?value:null}
// Returns false when the backup could not be written (no storage, blocked, or over quota).
export function saveStaffDraft(storage,key,weeks,now){return saveDraft(storage,key,{version:1,weeks},now)}
export function discardStaffDraft(storage,key){discardDraft(storage,key)}

export function planToAuthoringWeeks(plan){
 if(!plan?.plan_weeks?.length)return[emptyWeek(1)];
 return plan.plan_weeks.map((week,wi)=>({number:wi+1,theme:week.theme??"",days:(week.plan_days??[]).map((day,di)=>({number:di+1,plannedDate:day.planned_date??"",lessons:(day.lessons??[]).map(item=>({subject:item.subject??"",title:item.title??"",objective:item.objective??"",instructions:lessonInstructionTexts(item.instructions).join("\n"),materials:(item.materials??[]).join("\n"),accommodations:(item.accommodations??[]).join("\n"),adultHelpMinutes:item.adult_help_minutes??"",estimatedMinutes:item.estimated_minutes??"",helpLevel:item.help_level??"",needsScreen:item.needs_screen==null?"":String(item.needs_screen)}))}))}));
}
