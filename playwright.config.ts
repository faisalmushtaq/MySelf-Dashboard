import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the full Firebase Emulator Suite (Auth, Firestore
 * with both databases, Functions, Storage) and the emulator build of the web app.
 *
 *   pnpm e2e:build      # core, functions and the emulator web build
 *   pnpm test:e2e       # starts the emulators, seeds synthetic data, runs this
 *
 * Where browsers were installed elsewhere (and `playwright install` is not
 * allowed), point at the binary: PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome.
 *
 * The app is served on 127.0.0.1:4173. If something else already listens there
 * (the survey's own `vite preview` uses the same port), set E2E_PORT to a free
 * port: otherwise reuseExistingServer quietly tests whatever app is on 4173.
 */
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];
const port = Number(process.env["E2E_PORT"] ?? 4173);

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 }, ...(executablePath ? { launchOptions: { executablePath } } : {}) },
    },
  ],
  webServer: {
    command: `pnpm --filter @myself-dashboard/web exec vite preview --outDir dist-emulators --port ${port} --host 127.0.0.1 --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
