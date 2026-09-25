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
    // BIND IPv4 LOOPBACK EXPLICITLY. Vite's default host is `localhost`, which on
    // Node 18+ resolves to ::1 first — so the dev server ends up listening ONLY on
    // [::1] and `http://127.0.0.1:3000` is refused outright, while
    // `http://localhost:3000` happens to work. Any link, script, curl or tool that
    // uses the IPv4 literal then looks like "the dev server is down" when it is
    // running fine. This is the same ::1-before-127.0.0.1 hazard already called out
    // on the proxy target below, applied to the listen address.
    //
    // 127.0.0.1 rather than `true`/0.0.0.0 on purpose: `true` would also publish
    // this server on every LAN interface, and it proxies /api to a backend holding
    // real credentials. Loopback only.
    host: "127.0.0.1",
    proxy: {
      "/api": {
        // The API server listens on 8787 (server/.env PORT). A previous conflict
        // resolution left this pointing at 3001, where nothing listens, so every
        // /api call from the dev server failed with ECONNREFUSED.
        // 127.0.0.1 rather than localhost: on Node 18+ localhost can resolve to
        // ::1 first and the proxy does not always fall back to IPv4.
        // This literal has flipped back to 3001 twice through merges, each time
        // leaving the explanation above intact — so if it needs to vary by
        // environment, read it from an env var rather than editing the value in
        // place. A wrong port here presents as "nothing is configured" rather than
        // as a connection error, which is why it kept surviving review.
        // The Atlas-SRV-lookup DNS issue mentioned in prior versions of this
        // comment is fixed at the source now — see server/src/db/mongodb.js,
        // which points Node's own resolver at a public DNS server so the
        // mongodb+srv:// URI's SRV/TXT lookups stop getting ECONNREFUSED from
        // this network's default nameserver. Back to the local backend.
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
