// Operator report for the private-beta success measure (#53, #13): aggregates from
// public.service_beta_funnel() (migration 051). Prints counts and medians only -- no names, no
// content, and household ids only with --rows. Needs the service-role key, so run it from the
// operator shell, never from CI or a browser.
//
//   BRITELINK_SUPABASE_URL=https://<api host> BRITELINK_SERVICE_ROLE_KEY=<key> npm run report:beta-funnel
//   add -- --include-synthetic to count the staging seed households, -- --rows for per-household rows
import { createClient } from "@supabase/supabase-js";
import { summarizeBetaFunnel } from "../src/beta-funnel.js";

const url = process.env.BRITELINK_SUPABASE_URL;
const key = process.env.BRITELINK_SERVICE_ROLE_KEY;
if (!url || !key) {
  process.stderr.write("Set BRITELINK_SUPABASE_URL and BRITELINK_SERVICE_ROLE_KEY (operator shell only).\n");
  process.exit(2);
}
const args = new Set(process.argv.slice(2));
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await client.rpc("service_beta_funnel");
if (error) {
  process.stderr.write(`service_beta_funnel failed: ${error.message}\n`);
  process.exit(3);
}
const summary = summarizeBetaFunnel(data ?? [], { includeSynthetic: args.has("--include-synthetic") });
const output = { generatedAt: new Date().toISOString(), ...summary };
if (args.has("--rows")) output.rows = (data ?? []).filter((row) => args.has("--include-synthetic") || !row.synthetic);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
