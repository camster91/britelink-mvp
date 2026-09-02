import { fetchOperationalHealth, summarizeOperationalHealth } from "../src/operational-health.js";

try{
  const signals=await fetchOperationalHealth({baseUrl:process.env.BRITELINK_SUPABASE_URL,apiKey:process.env.BRITELINK_SUPABASE_ANON_KEY,accessToken:process.env.BRITELINK_MONITOR_JWT,householdId:process.env.BRITELINK_MONITOR_HOUSEHOLD_ID});
  const summary=summarizeOperationalHealth(signals);
  process.stdout.write(`${JSON.stringify({checked_at:new Date().toISOString(),status:summary.status,signal_count:summary.signalCount,signals:summary.signals})}\n`);
  process.exitCode=summary.exitCode;
}catch(error){process.stderr.write(`${JSON.stringify({status:"probe_failed",message:error instanceof Error?error.message:"Unknown operational health error"})}\n`);process.exitCode=3}
