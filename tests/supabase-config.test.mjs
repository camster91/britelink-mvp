import assert from "node:assert/strict";
import test from "node:test";
import { readSupabaseConfig } from "../src/supabase-client.js";

test("Supabase configuration stays disabled until both public values exist", () => {
  assert.deepEqual(readSupabaseConfig({}), { configured:false, url:undefined, anonKey:undefined, privacyNoticeVersion:null, attachmentsEnabled:false });
  assert.equal(readSupabaseConfig({ VITE_SUPABASE_URL:"https://example.supabase.co" }).configured,false);
  assert.deepEqual(readSupabaseConfig({ VITE_SUPABASE_URL:"https://example.supabase.co/", VITE_SUPABASE_ANON_KEY:"sb_publishable_public" }), { configured:true, url:"https://example.supabase.co", anonKey:"sb_publishable_public", privacyNoticeVersion:null, attachmentsEnabled:false });
});

test("privacy notice version is trimmed and remains disabled when unapproved",()=>{
  assert.equal(readSupabaseConfig({VITE_SUPABASE_URL:"https://example.supabase.co",VITE_SUPABASE_ANON_KEY:"public-key"}).privacyNoticeVersion,null);
  assert.equal(readSupabaseConfig({VITE_SUPABASE_URL:"https://example.supabase.co",VITE_SUPABASE_ANON_KEY:"public-key",VITE_PRIVACY_NOTICE_VERSION:" notice-v2 "}).privacyNoticeVersion,"notice-v2");
});

test("attachments stay off unless the build says exactly true",()=>{
  const base={VITE_SUPABASE_URL:"https://example.supabase.co",VITE_SUPABASE_ANON_KEY:"public-key"};
  assert.equal(readSupabaseConfig(base).attachmentsEnabled,false);
  for(const value of [""," ","false","1","yes","TRUE"])assert.equal(readSupabaseConfig({...base,VITE_ATTACHMENTS_ENABLED:value}).attachmentsEnabled,false,value);
  assert.equal(readSupabaseConfig({...base,VITE_ATTACHMENTS_ENABLED:" true "}).attachmentsEnabled,true);
});

test("browser configuration rejects insecure URLs credentials and server secrets",()=>{for(const config of [{VITE_SUPABASE_URL:"http://example.supabase.co",VITE_SUPABASE_ANON_KEY:"public-key"},{VITE_SUPABASE_URL:"https://user:pass@example.supabase.co",VITE_SUPABASE_ANON_KEY:"public-key"},{VITE_SUPABASE_URL:"https://example.supabase.co?secret=value",VITE_SUPABASE_ANON_KEY:"public-key"},{VITE_SUPABASE_URL:"https://example.supabase.co",VITE_SUPABASE_ANON_KEY:"sb_secret_private"},{VITE_SUPABASE_URL:"https://example.supabase.co",VITE_SUPABASE_ANON_KEY:"e30.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature"}])assert.throws(()=>readSupabaseConfig(config),/HTTPS|credentials|server secret/)});
