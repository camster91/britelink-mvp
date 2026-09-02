import React from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "/src/AuthenticatedApp.jsx";
import "/src/styles.css";

const state={calls:[]};globalThis.multiHouseholdQaState=state;
const memberships=[{household_id:"household-family",role:"guardian",households:{id:"household-family",display_name:"Family workspace"}},{household_id:"household-staff",role:"admin",households:{id:"household-staff",display_name:"Operations workspace"}}];
const scoped=(name,result)=>(householdId,...rest)=>{state.calls.push([name,householdId,...rest]);return typeof result==="function"?result(householdId,...rest):result};
const repository={
  async listMemberships(){state.calls.push(["listMemberships"]);return memberships},
  listLearners:scoped("listLearners",householdId=>[{id:householdId==="household-family"?"learner-family":"learner-staff",preferred_name:householdId==="household-family"?"Family learner":"Staff learner",grade_label:"Grade 4"}]),
  listCases:scoped("listCases",[]),loadLatestProfile:scoped("loadLatestProfile",null),loadPublishedPlans:scoped("loadPublishedPlans",[]),listLessonActivities:scoped("listLessonActivities",[]),listMessages:scoped("listMessages",[]),listActiveConsents:scoped("listActiveConsents",[]),listPrivacyRequests:scoped("listPrivacyRequests",[]),
  listStaffProfiles:scoped("listStaffProfiles",[]),listStaffPlans:scoped("listStaffPlans",[]),listStaffReviews:scoped("listStaffReviews",[]),listStaffRevisions:scoped("listStaffRevisions",[]),listEducatorCapacities:scoped("listEducatorCapacities",[]),listStaffDeliveries:scoped("listStaffDeliveries",[]),listStaffMessages:scoped("listStaffMessages",[]),
  async signOut(){state.calls.push(["signOut"])}
};
createRoot(document.getElementById("root")).render(<Workspace repository={repository} session={{user:{id:"user-multi",email:"multi@example.test"}}} privacyNoticeVersion={null}/>);
