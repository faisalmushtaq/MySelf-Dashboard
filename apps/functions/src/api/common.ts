import { HttpsError } from "firebase-functions/v2/https";
import type { ReleaseMetaView } from "@myself-dashboard/core";
import { ALLOWED_ORIGINS } from "../env.js";
import type { ReleaseMeta } from "../releases.js";

/** Options every browser-facing callable shares. */
export const callableOptions = { cors: ALLOWED_ORIGINS, enforceAppCheck: process.env["DASHBOARD_ENFORCE_APP_CHECK"] === "true" } as const;

export const releaseView = (m: ReleaseMeta): ReleaseMetaView => ({
  hash: m.hash,
  key: m.key,
  version: m.version,
  publishedAt: m.publishedAt,
  title: m.title,
  questionCount: m.questionCount,
  sectionCount: m.sectionCount,
});

export function requireString(value: unknown, name: string, max = 200): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new HttpsError("invalid-argument", `${name} is required`);
  }
  return value;
}

export function sessionIdArg(value: unknown): string {
  const id = requireString(value, "sessionId", 120);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new HttpsError("invalid-argument", "that is not a session id");
  return id;
}

export const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.min(max, Math.max(min, n));
};

export const searchArg = (v: unknown): string => (typeof v === "string" ? v.slice(0, 80) : "");
