import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Build-time configuration (all public, none secret):
 *   VITE_FIREBASE_CONFIG  web app config JSON from the Firebase console
 *   VITE_USE_EMULATORS    "true" to talk to the local Emulator Suite
 *   VITE_STUDIO_URL       MySelf Studio's survey list (default the survey's GitHub Pages researcher view)
 *   VITE_PARTICIPANT_URL  the participant app, where participant links start (docs/12 §12.8)
 * The study is not configured here: the server lists those a person may see (docs/12).
 */
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
  preview: { port: 4173, strictPort: true, host: "127.0.0.1" },
  build: { sourcemap: false, target: "es2022", chunkSizeWarningLimit: 1200 },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
} as never);
