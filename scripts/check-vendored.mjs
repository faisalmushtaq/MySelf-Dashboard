#!/usr/bin/env node
/**
 * The dashboard evaluates the survey's display conditions with a verbatim copy
 * of the survey engine's evaluator (packages/core/src/vendor/engine.ts). This
 * compares the copied bodies with a checkout of faisalmushtaq/MySelf and fails
 * if they differ, so a change to branching semantics in the survey cannot
 * silently diverge from how the dashboard judges completeness.
 *
 *   node scripts/check-vendored.mjs [path-to-MySelf-checkout]   (default ../MySelf)
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const survey = resolve(process.argv[2] ?? "../MySelf");
if (!existsSync(join(survey, "packages/engine/src/evaluate.ts"))) {
  console.log(`no survey checkout at ${survey}; skipping (CI checks one out)`);
  process.exit(0);
}
const vendored = readFileSync("packages/core/src/vendor/engine.ts", "utf8");
const pieces = [
  ["packages/engine/src/answers.ts", /\/\*\*\n \* The engine's view[\s\S]*$/],
  ["packages/engine/src/evaluate.ts", /type Target = \{[\s\S]*$/],
];
let ok = true;
for (const [file, re] of pieces) {
  const src = readFileSync(join(survey, file), "utf8").match(re)?.[0]?.trim();
  if (!src || !vendored.includes(src)) {
    console.error(`DRIFT: ${file} no longer matches packages/core/src/vendor/engine.ts — re-vendor it and review the completeness tests.`);
    ok = false;
  }
}
// The data layer (schema, scoring, ingest, BIDS, and the completeness and
// counting rules both tools count by): every file, byte for byte apart from
// its header and rewritten package imports.
const { VENDORED, stripHeader, vendoredBody } = await import("./vendor-survey.mjs");
for (const [pkg, names] of Object.entries(VENDORED)) {
  for (const n of names) {
    const theirs = vendoredBody(readFileSync(join(survey, `packages/${pkg}/src/${n}.ts`), "utf8"));
    const ours = stripHeader(readFileSync(`packages/core/src/vendor/myself/${pkg}/${n}.ts`, "utf8"));
    if (theirs !== ours) {
      console.error(`DRIFT: packages/${pkg}/src/${n}.ts changed in the survey — run scripts/vendor-survey.mjs and review the BIDS export tests.`);
      ok = false;
    }
  }
}
if (!ok) process.exit(1);
console.log("vendored engine and data layer match the survey");
