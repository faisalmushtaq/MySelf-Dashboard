/**
 * Bundle the functions for deployment.
 *
 * Cloud Build runs `npm install` on the uploaded directory, where pnpm's
 * `workspace:*` dependencies mean nothing — the survey repo documents the same
 * trap (docs/13 §5.1). So @myself-dashboard/core is bundled in, and the deploy
 * directory's package.json names only packages npm can fetch. pdfkit and exceljs
 * stay external because they read data files from their own install directory.
 */
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../../functions-bundle");
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const external = ["firebase-admin", "firebase-functions", "exceljs", "pdfkit"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(here, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: join(out, "index.js"),
  external: [...external, "firebase-admin/*", "firebase-functions/*"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  sourcemap: false,
  legalComments: "none",
});

writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: "myself-dashboard-functions",
      private: true,
      type: "module",
      main: "index.js",
      engines: { node: "22" },
      dependencies: Object.fromEntries(external.map((d) => [d, pkg.dependencies[d]])),
    },
    null,
    2,
  ),
);

for (const f of readdirSync(here)) {
  if (f.startsWith(".env.") && f !== ".env.example") copyFileSync(join(here, f), join(out, f));
}

// The CLI loads the bundle to discover its functions, so it needs node_modules.
if (!process.env.SKIP_BUNDLE_INSTALL) execSync("npm install --omit=dev --no-audit --no-fund", { cwd: out, stdio: "inherit" });
console.log(`bundled functions into ${out}${existsSync(join(out, "node_modules")) ? " (with node_modules)" : ""}`);
