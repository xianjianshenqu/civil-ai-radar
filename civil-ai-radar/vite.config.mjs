import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": { target: "http://127.0.0.1:8791", changeOrigin: false },
      "/rss.xml": { target: "http://127.0.0.1:8791", changeOrigin: false },
      "/sitemap.xml": { target: "http://127.0.0.1:8791", changeOrigin: false },
      "/robots.txt": { target: "http://127.0.0.1:8791", changeOrigin: false },
      "/llms.txt": { target: "http://127.0.0.1:8791", changeOrigin: false },
      "/skills": { target: "http://127.0.0.1:8791", changeOrigin: false },
    },
    port: 5173,
    strictPort: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
