import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { readSupabaseConfig } from "./supabase-config.js";
import "./styles.css";

const config=readSupabaseConfig();
async function boot(){
  let application=<App />;
  if(config.configured){
    const [{AuthenticatedApp},{createBriteLinkSupabaseClient},{SupabaseBriteLinkRepository}]=await Promise.all([import("./AuthenticatedApp.jsx"),import("./supabase-client.js"),import("./supabase-repository.js")]);
    const client=createBriteLinkSupabaseClient(config); application=<AuthenticatedApp client={client} repository={new SupabaseBriteLinkRepository(client)} privacyNoticeVersion={config.privacyNoticeVersion} />;
  }
  createRoot(document.getElementById("root")).render(<React.StrictMode>{application}</React.StrictMode>);
}
boot().catch(()=>{document.getElementById("root").textContent="BriteLink could not start. Refresh the page or contact support."});
