import { createClient } from "@supabase/supabase-js";
import { validateBrowserSupabaseConfig } from "./supabase-config.js";
export { readSupabaseConfig } from "./supabase-config.js";

export function createBriteLinkSupabaseClient({ url, anonKey, fetch: customFetch } = {}) {
  const valid=validateBrowserSupabaseConfig(url,anonKey);
  return createClient(valid.url, valid.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: customFetch ? { fetch: customFetch } : undefined,
  });
}
