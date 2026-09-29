import { STUDY } from "./env.js";

/** Dashboard database layout (docs/02 §2.3). */
export const dpaths = {
  accessConfig: () => "config/access",
  policyConfig: () => "config/policy",
  user: (uid: string) => `users/${uid}`,
  releases: (study = STUDY) => `studies/${study}/releases`,
  release: (hash: string, study = STUDY) => `studies/${study}/releases/${hash}`,
  releaseManifests: (study = STUDY) => `studies/${study}/releaseManifests`,
  releaseManifest: (hash: string, study = STUDY) => `studies/${study}/releaseManifests/${hash}`,
  summaries: (study = STUDY) => `studies/${study}/sessionSummaries`,
  summary: (id: string, study = STUDY) => `studies/${study}/sessionSummaries/${id}`,
  freshness: (study = STUDY) => `studies/${study}/meta/freshness`,
  reviews: (study = STUDY) => `studies/${study}/reviews`,
  review: (id: string, study = STUDY) => `studies/${study}/reviews/${id}`,
  notes: (id: string, study = STUDY) => `studies/${study}/reviews/${id}/notes`,
  savedViews: (study = STUDY) => `studies/${study}/savedViews`,
  exportJobs: (study = STUDY) => `studies/${study}/exportJobs`,
  exportJob: (id: string, study = STUDY) => `studies/${study}/exportJobs/${id}`,
  audit: (study = STUDY) => `studies/${study}/auditLog`,
} as const;

/** Survey database layout (MySelf packages/firebase/src/layout.ts). */
export const spaths = {
  sessions: (study = STUDY) => `studies/${study}/sessions`,
  session: (id: string, study = STUDY) => `studies/${study}/sessions/${id}`,
  chunks: (id: string, study = STUDY) => `studies/${study}/sessions/${id}/chunks`,
  /** Code corrections (wrong code -> right code) and twin assignments (sitting -> code). */
  corrections: (study = STUDY) => `studies/${study}/corrections`,
  assignments: (study = STUDY) => `studies/${study}/assignments`,
  narratives: (study = STUDY) => `studies/${study}/narratives`,
} as const;
