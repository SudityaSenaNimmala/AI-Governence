import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Demo config — same UI, proxied to the mock server on 8788
export default defineConfig({
  plugins: [react()],
  base: "/CloudFuze",
  server: {
    port: 3001,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
      },
    },
  },
});
