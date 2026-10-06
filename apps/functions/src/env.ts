import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions/v2/options";

/**
 * Where and against what these functions run.
 *
 * REGION is set here, in the module every function file imports, for the reason
 * the survey learned the hard way (apps/functions/src/apps.ts in MySelf): ES
 * modules evaluate imports before the importing module's body, so options set in
 * index.ts arrive after the functions are defined. europe-west2 matches the
 * Firestore location, which a Firestore trigger requires.
 */
export const REGION = "europe-west2";
setGlobalOptions({ region: REGION, maxInstances: 10 });

if (getApps().length === 0) initializeApp();

/**
 * The deployment's default study (the survey's MYSELF_STUDY): `ybm` in
 * production. It is registered whether or not it has a registry document, a
 * request that names no study means it, and its settings and access list are
 * the dashboard's own (docs/12). Every other study is one an owner created in
 * the Studio.
 */
export const DEFAULT_STUDY = process.env["MYSELF_STUDY"] ?? "ybm";

/** The dashboard's own named Firestore database (docs/02 §2.1). */
export const DASHBOARD_DATABASE = process.env["DASHBOARD_DATABASE"] ?? "dashboard";

/**
 * The preview channels of one Hosting site: `https://<site>--<channel>-<hash>.web.app`.
 * Only someone who can deploy to the project can create one, so allowing them
 * lets a change be tried against the real functions without widening who can
 * call them. Site names are lower-case letters, digits and hyphens.
 */
export function previewOrigins(site: string | undefined): RegExp[] {
  if (!site || !/^[a-z0-9-]+$/.test(site)) return [];
  return [new RegExp(`^https://${site}--[a-z0-9-]+\\.web\\.app$`)];
}

/**
 * Browser origins allowed to call these functions. The Hosting site in
 * production, and its preview channels when DASHBOARD_PREVIEW_SITE names it;
 * the Vite dev server and emulator-hosted app locally.
 */
export const ALLOWED_ORIGINS: (string | RegExp)[] = [
  ...(process.env["DASHBOARD_ORIGINS"] ?? "https://myself-research-dashboard.web.app,https://myself-research-dashboard.firebaseapp.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  ...previewOrigins(process.env["DASHBOARD_PREVIEW_SITE"]),
  ...(process.env["FUNCTIONS_EMULATOR"] === "true" ? ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"] : []),
];

/** The survey's database: raw sittings. Read-only from this codebase. */
export const research = (): Firestore => getFirestore();

let dashDb: Firestore | null = null;
/** The dashboard's database: summaries, reviews, views, exports, audit. */
export const dash = (): Firestore => (dashDb ??= getFirestore(DASHBOARD_DATABASE));

export const auth = () => getAuth();
export const bucket = () => getStorage().bucket();

/** Storage prefix for generated exports. Not readable by any client (catch-all deny). */
export const EXPORT_PREFIX = "dashboard-exports";
