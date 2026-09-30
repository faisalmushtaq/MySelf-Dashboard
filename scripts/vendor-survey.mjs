#!/usr/bin/env node
/**
 * Copy the survey's data layer into packages/core/src/vendor/myself/, verbatim
 * apart from package imports (rewritten to relative paths) and a header.
 *
 *   node scripts/vendor-survey.mjs [path-to-MySelf-checkout]   (default ../MySelf)
 *
 * Run it when the survey changes its schema, scoring, ingest, BIDS builder,
 * release builder or MyStory protocol code, then run the tests:
 * scripts/check-vendored.mjs fails CI until you do.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const VENDORED = {
  schema: ["identifiers", "response-scale", "logic", "item", "instrument", "assessment", "index"],
  scoring: ["executor", "definitions", "references", "index"],
  store: ["dataset", "identity", "ingest", "bids", "narratives", "zip"],
  // The release builder and publish gate, for the survey editor (docs/11), with
  // the parts of the MyStory protocol code and model config it needs.
  release: ["builder", "canonical"],
  narrative: ["protocol", "config", "toml", "prompts", "protocols"],
  llm: ["types"],
};
const REWRITES = {
  "@myself/schema": "../schema/index.js",
  "@myself/scoring": "../scoring/index.js",
  // The survey's @myself/narrative index also exports its model runner, which
  // the dashboard does not need; narrative/index.ts here exports the rest.
  "@myself/narrative": "../narrative/index.js",
  "@myself/llm": "../llm/types.js",
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
