const PRIVACY_READS=[
 ["consents","listActiveConsents"],
 ["deliveries","listDeliveries"],
 ["revisions","listRevisions"],
 ["privacyRequests","listPrivacyRequests"]
];

export async function loadPrivacyWorkspaceData(repository,{householdId,learnerId,userId,caseId}){
 const tasks=[
  repository.listActiveConsents(householdId,learnerId,userId),
  caseId?repository.listDeliveries(householdId,caseId):Promise.resolve([]),
  caseId?repository.listRevisions(householdId,caseId):Promise.resolve([]),
  repository.listPrivacyRequests(householdId)
 ];
 const results=await Promise.allSettled(tasks);const data={warnings:[]};let available=0;
 for(let index=0;index<PRIVACY_READS.length;index+=1){const[key]=PRIVACY_READS[index],result=results[index];if(result.status==="fulfilled"){data[key]=result.value;available+=1}else{data[key]=[];data.warnings.push({panel:key,message:result.reason?.message??`${key} unavailable`})}}
 if(!available)throw new Error("Service and privacy records are temporarily unavailable");
 return data;
}
