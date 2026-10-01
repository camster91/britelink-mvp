import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { readSupabaseConfig } from "./supabase-config.js";
import "./styles.css";

const config=readSupabaseConfig();

// Bootstrap failure screens.
//
// These cannot be React components: they run when rendering is impossible, so they
// are written as markup. They use classes from styles.css rather than inline styles
// for two reasons -- one visual, one security.
//
// Visual: inline styles here drifted from the app's own tokens. A recovery screen
// that looks like a different product reads as "this site is broken", which is the
// exact moment the user is already worried.
//
// Security: inline style attributes force `style-src 'unsafe-inline'` into the CSP,
// and that exception applies to the whole origin, not just this screen. Since the
// app already ships a stylesheet, removing the inline attributes lets the policy
// drop the exception entirely. A stylesheet that fails to load is the one thing this
// screen cannot survive, but it is same-origin and already required by the app.
function fallbackScreen({ title, body, hint }) {
  const root = document.getElementById("root");
  if (!root) return;
  root.textContent = "";
  const shell = document.createElement("div");
  shell.className = "boot-fallback";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = body;
  shell.append(heading, paragraph);
  if (hint) {
    const extra = document.createElement("p");
    extra.className = "boot-fallback-hint";
    const strong = document.createElement("strong");
    strong.textContent = "Try: ";
    extra.append(strong, document.createTextNode(hint));
    shell.append(extra);
  }
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "primary";
  reload.textContent = "Reload page";
  reload.addEventListener("click", () => location.reload());
  shell.append(reload);
  root.append(shell);
}

async function boot(){
  let application=<App />;
  if(config.configured){
    try{
      const [{AuthenticatedApp},{createBriteLinkSupabaseClient},{SupabaseBriteLinkRepository}]=await Promise.all([import("./AuthenticatedApp.jsx"),import("./supabase-client.js"),import("./supabase-repository.js")]);
      const client=createBriteLinkSupabaseClient(config); application=<AuthenticatedApp client={client} repository={new SupabaseBriteLinkRepository(client)} privacyNoticeVersion={config.privacyNoticeVersion} attachmentsEnabled={config.attachmentsEnabled} />;
    }catch(error){
      console.error("Authenticated mode failed to load:", error);
      fallbackScreen({
        title: "Secure mode unavailable",
        body: "The authenticated workspace could not load. This may be a configuration issue.",
        hint: "Clearing your browser cache, or running the interactive demo instead by removing the Supabase configuration.",
      });
      return;
    }
  }
  createRoot(document.getElementById("root")).render(<React.StrictMode>{application}</React.StrictMode>);
};
boot().catch((error)=>{
  console.error("BriteLink bootstrap failed:", error);
  fallbackScreen({
    title: "BriteLink could not start",
    body: "A critical error prevented the application from loading. Please refresh the page or contact support if the problem continues.",
  });
});
