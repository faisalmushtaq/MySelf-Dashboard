import { STUDY } from "./env.js";

/** Dashboard database layout (docs/02 §2.3). */
export const dpaths = {
  accessConfig: () => "config/access",
  policyConfig: () => "config/policy",
  groupsConfig: () => "config/groups",
  scoringSchemes: (study = STUDY) => `studies/${study}/scoringSchemes`,
  scoringScheme: (key: string, study = STUDY) => `studies/${study}/scoringSchemes/${key}`,
  scoringSchemeVersions: (key: string, study = STUDY) => `studies/${study}/scoringSchemes/${key}/versions`,
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
  /**
   * MySelf Studio's records (survey docs/16 §5.2), read and never written here:
   * each survey, its immutable versions, the public live pointer the iPads
   * follow, the immutable published manifests keyed by the hex part of their
   * hash, and the audit trail.
   */
  studioSurveys: (study = STUDY) => `studies/${study}/surveys`,
  studioVersions: (surveyId: string, study = STUDY) => `studies/${study}/surveys/${surveyId}/versions`,
  publishedPointer: (surveyId: string, study = STUDY) => `studies/${study}/published/${surveyId}`,
  publicRelease: (hashHex: string, study = STUDY) => `studies/${study}/publicReleases/${hashHex}`,
  studioAudit: (study = STUDY) => `studies/${study}/studioAudit`,
} as const;
