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
    rollupOptions: {
      // Two entry points: the popover UI, and the background page Owlbear
      // keeps alive so audio keeps playing when the popover is closed.
      input: {
        main: "index.html",
        background: "background.html",
      },
    },
  },
  server: {
    allowedHosts: true,
  },
});
