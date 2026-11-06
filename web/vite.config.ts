import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same /api proxy setup as llm-file-test-app.
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
