import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readSupabaseConfig } from "./src/supabase-config.js";

export default defineConfig(({mode})=>{readSupabaseConfig(loadEnv(mode,process.cwd(),"VITE_"));return{
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
}});
