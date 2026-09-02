const SIGNAL_CODES=new Set(["attachment.scan_stale","delivery.failed","message.response_overdue","case.sla_overdue","deletion.job_due","payment.pending_stale","payment.case_binding_missing","operations.recent_error"]);
const SEVERITIES=new Set(["warning","error","critical"]);
const RESPONSE_KEYS=["entity_count","oldest_at","severity","signal_code","threshold_seconds"];

function requiredText(value,label){if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);return value.trim()}

export function validateHealthSignals(value){
  if(!Array.isArray(value))throw new Error("Operational health response must be an array");
  return value.map((row,index)=>{
    if(!row||typeof row!=="object"||Array.isArray(row))throw new Error(`Operational health signal ${index} is invalid`);
    const keys=Object.keys(row).sort();if(keys.length!==RESPONSE_KEYS.length||keys.some((key,position)=>key!==RESPONSE_KEYS[position]))throw new Error(`Operational health signal ${index} contains unexpected fields`);
    if(!SIGNAL_CODES.has(row.signal_code)||!SEVERITIES.has(row.severity))throw new Error(`Operational health signal ${index} is unknown`);
    const count=Number(row.entity_count);const threshold=Number(row.threshold_seconds);
    if(!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(threshold)||threshold<0)throw new Error(`Operational health signal ${index} has invalid counts`);
    if(row.oldest_at!==null&&Number.isNaN(new Date(row.oldest_at).valueOf()))throw new Error(`Operational health signal ${index} has an invalid timestamp`);
    return{signal_code:row.signal_code,severity:row.severity,entity_count:count,oldest_at:row.oldest_at,threshold_seconds:threshold};
  });
}

export function summarizeOperationalHealth(signals){const rows=validateHealthSignals(signals);const exitCode=rows.some(row=>row.severity==="critical"||row.severity==="error")?2:rows.length?1:0;return{status:exitCode===0?"healthy":exitCode===1?"warning":"unhealthy",exitCode,signalCount:rows.length,signals:rows}}

export async function fetchOperationalHealth({baseUrl,apiKey,accessToken,householdId,fetchImpl=globalThis.fetch,evaluatedAt=new Date().toISOString()}){
  const url=new URL(requiredText(baseUrl,"Supabase URL"));if(url.protocol!=="https:"&&!(["localhost","127.0.0.1","::1"].includes(url.hostname)&&url.protocol==="http:"))throw new TypeError("Supabase URL must use HTTPS");
  const projectKey=requiredText(apiKey,"Supabase public API key");const token=requiredText(accessToken,"Monitor access token");const household=requiredText(householdId,"Monitor household ID");const timestamp=new Date(evaluatedAt);if(Number.isNaN(timestamp.valueOf()))throw new TypeError("Health evaluation time is invalid");if(typeof fetchImpl!=="function")throw new TypeError("Fetch implementation is required");
  const response=await fetchImpl(new URL("/rest/v1/rpc/admin_operational_health_snapshot",url),{method:"POST",headers:{authorization:`Bearer ${token}`,apikey:projectKey,"content-type":"application/json"},body:JSON.stringify({target_household:household,evaluated_at:timestamp.toISOString()}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`Operational health request failed with HTTP ${response.status}`);
  return validateHealthSignals(await response.json());
}
