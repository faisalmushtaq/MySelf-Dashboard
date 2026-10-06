import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The offline demo build (scripts/demo/README.md): the dashboard as it is, with
 * Firebase and the router's address handling swapped for the stand-ins in
 * demo/, over data recorded from the emulators. Output in dist-demo/.
 */
const demo = (file: string) => fileURLToPath(new URL(`./demo/${file}`, import.meta.url));
process.env["VITE_FIREBASE_CONFIG"] = JSON.stringify({ apiKey: "demo", projectId: "demo-myself-dashboard" });

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: [
      { find: /^firebase\/app$/, replacement: demo("firebase-app.ts") },
      { find: /^firebase\/auth$/, replacement: demo("firebase-auth.ts") },
      { find: /^firebase\/firestore$/, replacement: demo("firebase-firestore.ts") },
      { find: /^firebase\/functions$/, replacement: demo("firebase-functions.ts") },
      { find: /^react-router-dom$/, replacement: demo("router.ts") },
    ],
  },
  build: { outDir: "dist-demo", emptyOutDir: true, target: "es2022", sourcemap: false, chunkSizeWarningLimit: 2000, rollupOptions: { input: demo("index.html") } },
});
