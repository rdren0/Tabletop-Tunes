import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Owlbear Rodeo embeds extensions in an iframe served from your own host
// (e.g. Netlify). Relative base keeps asset paths correct wherever it's deployed.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    allowedHosts: true,
  },
});
