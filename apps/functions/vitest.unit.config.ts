import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    // firebase-admin initialises at import; a project id keeps it quiet. No call
    // in the unit tests reaches Google.
    env: { GCLOUD_PROJECT: "demo-myself-dashboard", MYSELF_STUDY: "demo" },
  },
});
