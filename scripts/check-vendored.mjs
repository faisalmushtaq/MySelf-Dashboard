#!/usr/bin/env node
/**
 * The dashboard evaluates the survey's display conditions, scores and ingests
 * sittings with verbatim copies of the survey's code (packages/core/src/vendor/
 * myself/). This compares the copies with a checkout of faisalmushtaq/MySelf
 * and fails if they differ, so a change to branching semantics in the survey
 * cannot silently diverge from how the dashboard judges completeness.
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
let ok = true;
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
