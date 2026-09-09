import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { readSupabaseConfig } from "./supabase-config.js";
import "./styles.css";

const config=readSupabaseConfig();
async function boot(){
  let application=<App />;
  if(config.configured){
    try{
      const [{AuthenticatedApp},{createBriteLinkSupabaseClient},{SupabaseBriteLinkRepository}]=await Promise.all([import("./AuthenticatedApp.jsx"),import("./supabase-client.js"),import("./supabase-repository.js")]);
      const client=createBriteLinkSupabaseClient(config); application=<AuthenticatedApp client={client} repository={new SupabaseBriteLinkRepository(client)} privacyNoticeVersion={config.privacyNoticeVersion} />;
    }catch(error){
      console.error("Authenticated mode failed to load:", error);
      const root = document.getElementById("root");
      root.innerHTML = `<div style="max-width:600px;margin:80px auto;padding:40px;background:#fff;border:1px solid #dfe5ee;border-radius:20px;text-align:center;"><h1 style="color:#1e293b;font-size:28px;margin:0 0 16px;">Secure mode unavailable</h1><p style="color:#64748b;line-height:1.65;margin:0 0 20px;">The authenticated workspace could not load. This may be a configuration issue.</p><p style="color:#64748b;line-height:1.65;margin:0 0 24px;"><strong>Try:</strong> Clearing your browser cache, or running the interactive demo instead by removing the Supabase configuration.</p><button onclick="location.reload()" style="padding:12px 20px;border:1px solid #3b7dd8;border-radius:10px;background:#3b7dd8;color:#fff;font-weight:700;cursor:pointer;">Reload page</button></div>`;
      return;
    }
  }
  createRoot(document.getElementById("root")).render(<React.StrictMode>{application}</React.StrictMode>);
}
boot().catch((error)=>{
  console.error("BriteLink bootstrap failed:", error);
  const root = document.getElementById("root");
  root.innerHTML = `<div style="max-width:600px;margin:80px auto;padding:40px;background:#fff;border:1px solid #dfe5ee;border-radius:20px;text-align:center;"><h1 style="color:#1e293b;font-size:28px;margin:0 0 16px;">BriteLink could not start</h1><p style="color:#64748b;line-height:1.65;margin:0 0 24px;">A critical error prevented the application from loading. Please refresh the page or contact support if the problem continues.</p><button onclick="location.reload()" style="padding:12px 20px;border:1px solid #3b7dd8;border-radius:10px;background:#3b7dd8;color:#fff;font-weight:700;cursor:pointer;">Reload page</button></div>`;
});
