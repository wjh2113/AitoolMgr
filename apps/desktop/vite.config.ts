import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@toolmgr/core": path.resolve(root, "../../packages/core/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:7788",
      "/health": "http://127.0.0.1:7788",
      "/hooks": "http://127.0.0.1:7788",
      "/hub": "http://127.0.0.1:7788",
      "/ws": {
        target: "ws://127.0.0.1:7788",
        ws: true,
      },
    },
  },
});
