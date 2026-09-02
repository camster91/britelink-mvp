export function createHouseholdExportFile(payload, now=new Date()){
  if(!payload||typeof payload!=="object")throw new TypeError("Household export is unavailable");
  const date=(now instanceof Date?now:new Date(now));if(Number.isNaN(date.valueOf()))throw new TypeError("Export date is invalid");
  return{filename:`britelink-household-export-${date.toISOString().slice(0,10)}.json`,contents:JSON.stringify(payload,null,2)};
}

export function newestByCreatedAt(items){return[...(items??[])].sort((a,b)=>new Date(b.created_at??0)-new Date(a.created_at??0))[0]??null}

export function deliveryPresentation(delivery){
  if(!delivery)return{canAcknowledge:false,label:"No delivery",message:"No plan delivery has been recorded.",tone:"pending"};
  if(delivery.status==="sent")return{canAcknowledge:true,label:"Sent",message:"Your plan is ready in this secure workspace. Confirm only after you have opened it.",tone:"pending"};
  if(delivery.status==="acknowledged")return{canAcknowledge:false,label:"Acknowledged",message:`Plan received${delivery.acknowledged_at?` ${new Date(delivery.acknowledged_at).toLocaleString()}`:""}.`,tone:"success"};
  if(["failed","bounced"].includes(delivery.status))return{canAcknowledge:false,label:delivery.status==="bounced"?"Delivery bounced":"Delivery failed",message:"The plan was not delivered. BriteLink staff must retry it; contact support if this status does not change.",tone:"failure"};
  return{canAcknowledge:false,label:String(delivery.status??"pending").replaceAll("_"," "),message:"Delivery is still being prepared. Confirmation will become available after it is sent.",tone:"pending"};
}
