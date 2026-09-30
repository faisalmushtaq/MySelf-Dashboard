#!/usr/bin/env node
/**
 * Build the offline dashboard demo from scratch (README.md in this folder):
 *
 *   1. build core, functions and a web app pointed at the demo emulators;
 *   2. start the Emulator Suite on its own ports (firebase.demo.json), seed the
 *      made-up study and record the dashboard running for real (seed.mjs, record.mjs);
 *   3. pack the recording and build apps/web/dist-demo (pack.mjs, vite.demo.config.ts).
 *
 *   pnpm demo:build
 *
 * The result is a static site: open dist-demo/demo/index.html from any web server.
 *
 * With --check-editor (`pnpm demo:check-editor`) it walks the survey editor end
 * to end instead of recording (editor-walk.mjs), and builds no demo.
 */
import { spawn, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;
const CHECK_EDITOR = process.argv.includes("--check-editor");
const PORTS = { auth: 9109, firestore: 8291, functions: 5111, web: 4273 };
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts, env: { ...process.env, ...opts.env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
};

run("pnpm", ["--filter", "@myself-dashboard/core", "build"]);
run("pnpm", ["--filter", "@myself-dashboard/functions", "build"]);
run("pnpm", ["--filter", "@myself-dashboard/web", "exec", "vite", "build", "--outDir", "dist-record"], {
  env: {
    VITE_USE_EMULATORS: "true",
    VITE_STUDY: "ybm",
    VITE_AUTH_EMULATOR_PORT: String(PORTS.auth),
    VITE_FIRESTORE_EMULATOR_PORT: String(PORTS.firestore),
    VITE_FUNCTIONS_EMULATOR_PORT: String(PORTS.functions),
  },
});

// The functions serve study "ybm" to the recording's web origin. .env.local is
// read only by the emulator, is not committed, and is removed afterwards: left
// behind, it would point the e2e suite's emulators at the demo study.
const ENV_LOCAL = new URL("apps/functions/.env.local", `file://${ROOT}`);
writeFileSync(ENV_LOCAL, `MYSELF_STUDY=ybm\nDASHBOARD_ORIGINS=http://127.0.0.1:${PORTS.web}\n`);

const web = spawn("pnpm", ["--filter", "@myself-dashboard/web", "exec", "vite", "preview", "--outDir", "dist-record", "--port", String(PORTS.web), "--host", "127.0.0.1", "--strictPort"], { cwd: ROOT, stdio: "ignore" });
try {
  run("pnpm", ["exec", "firebase", "emulators:exec", "--only", "auth,firestore,functions,storage", "--project", "demo-myself-dashboard", "--config", "firebase.demo.json", `node scripts/demo/seed.mjs && node scripts/demo/${CHECK_EDITOR ? "editor-walk" : "record"}.mjs`], {
    env: { MYSELF_STUDY: "ybm", DEMO_WEB: `http://127.0.0.1:${PORTS.web}`, DEMO_FUNCTIONS: `127.0.0.1:${PORTS.functions}` },
  });
} finally {
  web.kill();
  rmSync(ENV_LOCAL, { force: true });
}

if (CHECK_EDITOR) process.exit(0);
run("node", ["scripts/demo/pack.mjs"]);
run("pnpm", ["--filter", "@myself-dashboard/web", "exec", "vite", "build", "--config", "vite.demo.config.ts"]);
console.log("\nThe demo is in apps/web/dist-demo — open demo/index.html from any web server.");
