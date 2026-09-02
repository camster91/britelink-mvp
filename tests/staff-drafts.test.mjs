import assert from"node:assert/strict";
import test from"node:test";
import{discardStaffDraft,loadStaffDraft,planToAuthoringWeeks,saveStaffDraft,staffDraftKey}from"../src/staff-drafts.js";

function memoryStorage(){const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}}

test("staff plan drafts are isolated by household, case, and author and can be discarded",()=>{
 const storage=memoryStorage();const key=staffDraftKey({householdId:"h1",caseId:"c1",userId:"u1"});const other=staffDraftKey({householdId:"h1",caseId:"c2",userId:"u1"});
 saveStaffDraft(storage,key,[{number:1,theme:"Fractions",days:[]}]);
 assert.equal(loadStaffDraft(storage,key).weeks[0].theme,"Fractions");assert.equal(loadStaffDraft(storage,other),null);
 discardStaffDraft(storage,key);assert.equal(loadStaffDraft(storage,key),null);
});

test("latest immutable plan can be cloned into editable authoring fields",()=>{
 const weeks=planToAuthoringWeeks({plan_weeks:[{theme:"Space",plan_days:[{planned_date:"2026-09-01",lessons:[{subject:"Science",title:"Orbit",objective:"Explain orbit",instructions:["Read","Model"],materials:["Ball"],accommodations:["Audio"],adult_help_minutes:15}]}]}]});
 assert.deepEqual(weeks[0].days[0].lessons[0],{subject:"Science",title:"Orbit",objective:"Explain orbit",instructions:"Read\nModel",materials:"Ball",accommodations:"Audio",adultHelpMinutes:15});
});
