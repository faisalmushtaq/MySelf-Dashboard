import { DEFAULT_STUDY } from "./env.js";

/**
 * Dashboard database layout (docs/02 §2.3, docs/12 §12.3). Everything about a
 * study is under `studies/{study}/`; `ybm`'s documents are where they always
 * were. The default study's settings stay at the top level, in `config/`; any
 * other study's are its own, under `studies/{study}/config/`.
 */
const settings = (kind: "policy" | "groups", study: string) => (study === DEFAULT_STUDY ? `config/${kind}` : `studies/${study}/config/${kind}`);

export const dpaths = {
  /** Who may use the dashboard at all; the default study's access list too. */
  accessConfig: () => "config/access",
  /** Who else may see a study other than the default one. */
  studyAccess: (study: string) => `studies/${study}/config/access`,
  policyConfig: (study: string) => settings("policy", study),
  groupsConfig: (study: string) => settings("groups", study),
  scoringSchemes: (study: string) => `studies/${study}/scoringSchemes`,
  scoringScheme: (study: string, key: string) => `studies/${study}/scoringSchemes/${key}`,
  scoringSchemeVersions: (study: string, key: string) => `studies/${study}/scoringSchemes/${key}/versions`,
  user: (uid: string) => `users/${uid}`,
  releases: (study: string) => `studies/${study}/releases`,
  release: (study: string, hash: string) => `studies/${study}/releases/${hash}`,
  releaseManifests: (study: string) => `studies/${study}/releaseManifests`,
  releaseManifest: (study: string, hash: string) => `studies/${study}/releaseManifests/${hash}`,
  summaries: (study: string) => `studies/${study}/sessionSummaries`,
  summary: (study: string, id: string) => `studies/${study}/sessionSummaries/${id}`,
  freshness: (study: string) => `studies/${study}/meta/freshness`,
  reviews: (study: string) => `studies/${study}/reviews`,
  review: (study: string, id: string) => `studies/${study}/reviews/${id}`,
  notes: (study: string, id: string) => `studies/${study}/reviews/${id}/notes`,
  savedViews: (study: string) => `studies/${study}/savedViews`,
  exportJobs: (study: string) => `studies/${study}/exportJobs`,
  exportJob: (study: string, id: string) => `studies/${study}/exportJobs/${id}`,
  audit: (study: string) => `studies/${study}/auditLog`,
} as const;

/** Survey database layout (MySelf packages/firebase/src/layout.ts), read and never written here. */
export const spaths = {
  /** The study registry (survey docs/16 §11.4): one document per study space. */
  studies: () => "studies",
  study: (study: string) => `studies/${study}`,
  sessions: (study: string) => `studies/${study}/sessions`,
  session: (study: string, id: string) => `studies/${study}/sessions/${id}`,
  chunks: (study: string, id: string) => `studies/${study}/sessions/${id}/chunks`,
  /** Code corrections (wrong code -> right code) and twin assignments (sitting -> code). */
  corrections: (study: string) => `studies/${study}/corrections`,
  assignments: (study: string) => `studies/${study}/assignments`,
  narratives: (study: string) => `studies/${study}/narratives`,
  /**
   * MySelf Studio's records (survey docs/16 §5.2), read and never written here:
   * each survey, its immutable versions, the public live pointers the iPads
   * follow (one per survey with a live version), the immutable published
   * manifests keyed by the hex part of their hash, and the audit trail.
   */
  studioSurveys: (study: string) => `studies/${study}/surveys`,
  studioVersions: (study: string, surveyId: string) => `studies/${study}/surveys/${surveyId}/versions`,
  publishedPointers: (study: string) => `studies/${study}/published`,
  publishedPointer: (study: string, surveyId: string) => `studies/${study}/published/${surveyId}`,
  publicRelease: (study: string, hashHex: string) => `studies/${study}/publicReleases/${hashHex}`,
  studioAudit: (study: string) => `studies/${study}/studioAudit`,
} as const;
