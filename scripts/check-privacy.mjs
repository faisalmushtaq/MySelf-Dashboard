#!/usr/bin/env node
/**
 * A cheap guard for two privacy rules the code must never break:
 *
 *   - no console.log / console.info / console.debug in the web app (answers and
 *     identifiers must never be logged to a browser console);
 *   - no third-party analytics or tag scripts in the web app.
 *
 * Runs in CI. Deliberately simple: a grep that fails loudly beats a policy that
 * relies on remembering.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/web/src", "apps/web/index.html"];
const banned = [
  [/console\.(log|info|debug|table)\s*\(/, "console logging in the browser"],
  [/googletagmanager|google-analytics|gtag\(|segment\.com|mixpanel|hotjar|amplitude|fullstory|sentry/i, "third-party analytics or telemetry"],
  [/getAnalytics\s*\(\s*app/, "Firebase Analytics"],
];
const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else if (/\.(tsx?|html)$/.test(p) && !/\.test\.tsx?$/.test(p)) files.push(p);
};
roots.forEach(walk);
let bad = 0;
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const [re, what] of banned) {
      if (re.test(line)) {
        console.error(`${f}:${i + 1}: ${what}: ${line.trim()}`);
        bad += 1;
      }
    }
  });
}
if (bad) {
  console.error(`\n${bad} privacy violation(s).`);
  process.exit(1);
}
console.log(`privacy check: ${files.length} files clean`);
