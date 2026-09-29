import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Build-time configuration (all public, none secret):
 *   VITE_FIREBASE_CONFIG  web app config JSON from the Firebase console
 *   VITE_USE_EMULATORS    "true" to talk to the local Emulator Suite
 *   VITE_STUDY            study id (default "ybm"; the emulator seed uses "demo")
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
