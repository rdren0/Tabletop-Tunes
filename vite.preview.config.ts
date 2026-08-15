import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Local-only config for eyeballing the panel outside Owlbear. It swaps the
 * Owlbear SDK for an in-memory mock, so the real App renders in a plain tab
 * instead of waiting forever on an `onReady` that never fires.
 *
 * Deliberately separate from vite.config.ts: the production build must never
 * resolve the mock, and keeping the alias out of the shipping config is the
 * only way to guarantee that.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@owlbear-rodeo/sdk": fileURLToPath(new URL("./src/preview/obrMock.ts", import.meta.url)),
    },
  },
  server: {
    open: "/preview.html",
  },
});
