#!/usr/bin/env node
/**
 * Copy the survey's data layer into packages/core/src/vendor/myself/, verbatim
 * apart from package imports (rewritten to relative paths) and a header.
 *
 *   node scripts/vendor-survey.mjs [path-to-MySelf-checkout]   (default ../MySelf)
 *
 * Run it when the survey changes its schema, its release hashing, scoring,
 * ingest, BIDS builder, or the completeness and counting rules the two tools
 * share, then run the tests: scripts/check-vendored.mjs fails CI until you do.
 *
 * `@myself/engine` resolves to vendor/engine.ts, which re-exports the vendored
 * engine files (vendor/myself/engine/).
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const VENDORED = {
  // `canonical` is the survey's one release-hash implementation: the dashboard
  // verifies a version MySelf Studio published with it before reading any
  // sitting under that version (docs/11). `link` holds the study and survey
  // id patterns and the participant link (D-56): the dashboard accepts and
  // builds exactly what the survey does (docs/12).
  schema: ["identifiers", "response-scale", "logic", "item", "instrument", "assessment", "canonical", "link", "index"],
  scoring: ["executor", "definitions", "references", "index"],
  store: ["dataset", "identity", "ingest", "bids", "narratives", "zip", "summary", "completeness", "counting"],
  // The engine's evaluator, answer store, cascading visibility and release
  // flattening: the dashboard decides "was this question shown?" exactly as
  // the iPad did, including a hidden question's answer not opening a branch
  // (survey D-63). vendor/engine.ts re-exports the parts the dashboard uses.
  engine: ["answers", "evaluate", "walker", "flatten"],
};
const REWRITES = {
  "@myself/schema": "../schema/index.js",
  "@myself/scoring": "../scoring/index.js",
  "@myself/engine": "../../engine.js",
};

export function vendoredBody(source) {
  let out = source;
  for (const [from, to] of Object.entries(REWRITES)) out = out.replaceAll(`from "${from}"`, `from "${to}"`);
  return out;
}

export function stripHeader(vendored) {
  return vendored.split("\n").filter((l, i) => !(i < 3 && l.startsWith("// "))).join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const survey = resolve(process.argv[2] ?? "../MySelf");
  const sha = execSync("git rev-parse --short HEAD", { cwd: survey }).toString().trim();
  for (const [pkg, names] of Object.entries(VENDORED)) {
    mkdirSync(`packages/core/src/vendor/myself/${pkg}`, { recursive: true });
    for (const n of names) {
      const src = readFileSync(join(survey, `packages/${pkg}/src/${n}.ts`), "utf8");
      const header =
        `// Vendored from faisalmushtaq/MySelf@${sha} packages/${pkg}/src/${n}.ts — do not edit.\n` +
        `// Only package imports are rewritten to relative paths; scripts/check-vendored.mjs\n` +
        `// fails CI if the survey's copy changes. Re-vendor with scripts/vendor-survey.mjs.\n`;
      writeFileSync(`packages/core/src/vendor/myself/${pkg}/${n}.ts`, header + vendoredBody(src));
    }
  }
  console.log(`vendored the survey data layer at ${sha}`);
}
