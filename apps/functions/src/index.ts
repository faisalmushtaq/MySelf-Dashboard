/**
 * MySelf Research Dashboard — backend (Firebase Functions codebase "dashboard").
 *
 * `./env.js` is imported first by every module, so the region applies to all.
 */
export { onSessionWritten } from "./summaries.js";
export { onOpsRequest } from "./ops.js";
export { whoAmI } from "./api/access.js";
export { querySessions, getSessionDetail } from "./api/sessions.js";
export { getAnalytics, getQuestionAnalytics, getQuestionHistory } from "./api/analytics.js";
export { updateReview, addNote } from "./api/review.js";
export {
  getSettings,
  updateAccessPolicy,
  updatePolicy,
  setDashboardRole,
  rebuildSummaries,
  registerReleaseManifest,
  logChartDownload,
  logFigureExport,
} from "./api/admin.js";
export { previewExport, createExport, downloadExport, cleanupExports } from "./api/exports.js";
export { getParticipants } from "./api/participants.js";
export { getScores, getScoringSettings, saveScoringScheme, saveGroupSettings } from "./api/scores.js";
export { getCodebook } from "./api/codebook.js";
export {
  listSurveyDrafts,
  getSurveyDraft,
  saveSurveyDraft,
  deleteSurveyDraft,
  previewSurveyDraft,
  publishSurveyVersion,
  activateSurveyVersion,
  listSurveyVersions,
  exportSurveyProvenance,
  getSurveyManifest,
} from "./api/editor.js";
