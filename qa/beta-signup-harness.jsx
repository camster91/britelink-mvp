// Beta signup QA harness. ?mode= picks the entry point:
//   signin  - signed out, on the join form (nothing may be provisioned before the link is followed)
//   auto    - signed in from a join link: learner details arrive as signup metadata
//   manual  - signed in with no household and no metadata (form starts empty)
//   fail    - as auto, but provisioning fails once
import React from "react";
import { createRoot } from "react-dom/client";
import { AuthenticatedApp, Workspace } from "/src/AuthenticatedApp.jsx";
import "/src/styles.css";

const mode=new URLSearchParams(location.search).get("mode")??"signin";
const state={calls:[],memberships:[],failNext:mode==="fail"};globalThis.betaSignupQaState=state;
const household={household_id:"household-beta",role:"guardian",households:{id:"household-beta",display_name:"Household - Riley"}};
const repository={
  async session(){return null},
  async joinBeta(email,redirectTo,details){state.calls.push(["joinBeta",email,details])},
  async signInWithEmail(email){state.calls.push(["signInWithEmail",email])},
  async signOut(){state.calls.push(["signOut"])},
  async provisionBetaHousehold(details){
    state.calls.push(["provisionBetaHousehold",details]);
    if(state.failNext){state.failNext=false;throw new Error("Set up your household: temporarily unavailable")}
    state.memberships=[household];return{household_id:household.household_id,created:true};
  },
  async listMemberships(){state.calls.push(["listMemberships"]);return state.memberships},
  async listLearners(){return[{id:"learner-beta",preferred_name:"Riley",grade_label:"Grade 3"}]},
  async listCases(){return[]},async loadLatestProfile(){return null},async loadPublishedPlans(){return[]},async listLessonActivities(){return[]},
  async listMessages(){return[]},async listActiveConsents(){return[]},async listPrivacyRequests(){return[]},
};
const client={auth:{onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}}}};
const metadata=mode==="auto"||mode==="fail"?{beta_learner_name:"Riley",beta_learner_grade:"Grade 3"}:{};
const root=createRoot(document.getElementById("root"));
root.render(mode==="signin"
  ?<AuthenticatedApp client={client} repository={repository}/>
  :<Workspace repository={repository} session={{user:{id:"beta-user",email:"family@example.test",user_metadata:metadata}}} privacyNoticeVersion={null}/>);
