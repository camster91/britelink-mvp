function decodeJwtRole(key){try{const parts=key.split(".");if(parts.length!==3)return null;const normalized=parts[1].replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(parts[1].length/4)*4,"=");const payload=JSON.parse(globalThis.atob(normalized));return payload?.role??null}catch{return null}}

export function validateBrowserSupabaseConfig(urlValue,keyValue){
  const url=new URL(String(urlValue));if(url.protocol!=="https:"&&!(["localhost","127.0.0.1","::1"].includes(url.hostname)&&url.protocol==="http:"))throw new TypeError("Supabase URL must use HTTPS");if(url.username||url.password||url.search||url.hash)throw new TypeError("Supabase URL must not contain credentials, query parameters, or fragments");
  const anonKey=String(keyValue??"").trim();if(!anonKey)throw new TypeError("Supabase public key is required");if(anonKey.startsWith("sb_secret_")||decodeJwtRole(anonKey)==="service_role")throw new TypeError("A Supabase server secret or service-role key must never be used in browser configuration");
  return{url:url.toString().replace(/\/$/,""),anonKey};
}

export function readSupabaseConfig(environment = import.meta.env) {
  const url = environment.VITE_SUPABASE_URL;
  const anonKey = environment.VITE_SUPABASE_ANON_KEY;
  const privacyNoticeVersion = environment.VITE_PRIVACY_NOTICE_VERSION?.trim() || null;
  if(!url||!anonKey)return { configured:false, url, anonKey, privacyNoticeVersion };
  return { configured:true, ...validateBrowserSupabaseConfig(url,anonKey), privacyNoticeVersion };
}
