import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
// https://vitejs.dev/config/
export default defineConfig({
  // resolve: {
  //   alias: {
  //     '@': path.resolve(__dirname, 'src'),
  //   },
  // },
  plugins: [react(), visualizer({ open: false })],
  base: "/CloudFuze",
  server: {
    port: 3000,
    proxy: {
      "/api": {
        // The API server listens on 8787 (server/.env PORT). A previous conflict
        // resolution left this pointing at 3001, where nothing listens, so every
        // /api call from the dev server failed with ECONNREFUSED.
        // 127.0.0.1 rather than localhost: on Node 18+ localhost can resolve to
        // ::1 first and the proxy does not always fall back to IPv4.
        // Reverted to 8787 a second time: commit 4900cfc set this back to 3001
        // while keeping the comment above that explains why 3001 is wrong. If it
        // needs to be configurable, read it from an env var rather than editing
        // the literal — this has now regressed twice through merges.
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    minify: "esbuild",
    assetsDir: "static",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            return "vendor";
          }
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
});

// if (id.includes("node_modules")) {
//   return id.split("node_modules/")[1].split("/")[0];
// }
