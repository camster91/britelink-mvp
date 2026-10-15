import {lessonInstructionTexts} from './authenticated-workspace.js';
export const emptyLesson=()=>({subject:"",title:"",objective:"",instructions:"",materials:"",accommodations:"",adultHelpMinutes:"",estimatedMinutes:"",helpLevel:"",needsScreen:""});
export const emptyDay=number=>({number,plannedDate:"",lessons:[emptyLesson()]});
export const emptyWeek=number=>({number,theme:"",days:[emptyDay(1)]});

export function staffDraftKey({householdId,caseId,userId}){return`britelink:staff-plan-draft:${householdId}:${caseId}:${userId}`}
// Reading sessionStorage itself throws when the browser blocks site data, so every access is guarded:
// a missing backup must never take the authoring screen down with it.
export function browserSessionStorage(){try{return globalThis.sessionStorage??null}catch{return null}}
export function loadStaffDraft(storage,key){try{const value=JSON.parse(storage?.getItem(key)??"null");return Array.isArray(value?.weeks)&&value.weeks.length?value:null}catch{return null}}
// Returns false when the backup could not be written (no storage, blocked, or over quota).
export function saveStaffDraft(storage,key,weeks){if(!storage)return false;try{storage.setItem(key,JSON.stringify({version:1,weeks,savedAt:new Date().toISOString()}));return true}catch{return false}}
export function discardStaffDraft(storage,key){try{storage?.removeItem(key)}catch{}}

export function planToAuthoringWeeks(plan){
 if(!plan?.plan_weeks?.length)return[emptyWeek(1)];
 return plan.plan_weeks.map((week,wi)=>({number:wi+1,theme:week.theme??"",days:(week.plan_days??[]).map((day,di)=>({number:di+1,plannedDate:day.planned_date??"",lessons:(day.lessons??[]).map(item=>({subject:item.subject??"",title:item.title??"",objective:item.objective??"",instructions:lessonInstructionTexts(item.instructions).join("\n"),materials:(item.materials??[]).join("\n"),accommodations:(item.accommodations??[]).join("\n"),adultHelpMinutes:item.adult_help_minutes??"",estimatedMinutes:item.estimated_minutes??"",helpLevel:item.help_level??"",needsScreen:item.needs_screen==null?"":String(item.needs_screen)}))}))}));
}
