import type { Change } from "./diff.js";
import type { Edit } from "./edits.js";
import type { NextVersion } from "./version.js";
import type { Activation, VersionRecord } from "./provenance.js";

/** What the survey editor's functions send and receive (docs/11). */

export interface SurveyVersionsResponse {
  versions: VersionRecord[];
  activations: Activation[];
  /** The version devices use, or null while they use the one bundled in the app. */
  active: { hash: string; version: string; activatedAt: string | null } | null;
  canPublish: boolean;
}

export interface SurveyDraftSummary {
  id: string;
  name: string;
  baseHash: string;
  baseVersion: string;
  edits: number;
  status: "open" | "published";
  updatedAt: string | null;
  updatedBy: string | null;
  publishedVersion: string | null;
}

export interface SurveyDraftDoc {
  id: string;
  name: string;
  baseHash: string;
  baseVersion: string;
  edits: Edit[];
  status: "open" | "published";
  updatedAt: string | null;
  updatedBy: string | null;
  rev: number;
}

export interface SurveyDraftInput {
  baseHash: string;
  edits: Edit[];
  level?: "major" | "minor" | "patch";
}

export interface SurveyPreviewResponse {
  baseVersion: string;
  failed: { index: number; message: string } | null;
  changes: Change[];
  next: NextVersion;
  problems: string[];
  mystory: { key: string; version: string } | null;
  manifest: Record<string, unknown> | null;
}
