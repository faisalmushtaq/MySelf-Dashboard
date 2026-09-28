import { defineConfig } from "vitest/config";

/**
 * Handlers against the real Auth, Firestore (both databases) and Storage
 * emulators. Run through `pnpm test:integration`, which starts them.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      GCLOUD_PROJECT: "demo-myself-dashboard",
      FIREBASE_CONFIG: JSON.stringify({ projectId: "demo-myself-dashboard", storageBucket: "demo-myself-dashboard.appspot.com" }),
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8181",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
      MYSELF_STUDY: "demo",
    },
  },
});
