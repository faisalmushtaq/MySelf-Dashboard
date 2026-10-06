import { httpsCallable, type HttpsCallableResult } from "firebase/functions";
import type {
  AddNoteRequest,
  AnalyticsRequest,
  AnalyticsResponse,
  ExportJobView,
  ExportPreview,
  ExportRequest,
  ParticipantsResponse,
  SaveSchemeRequest,
  ScoresRequest,
  ScoresView,
  ScoringSettingsView,
  CodebookResponse,
  GroupSettings,
  QuerySessionsRequest,
  QuerySessionsResponse,
  QuestionAnalyticsRequest,
  QuestionAnalyticsResponse,
  QuestionHistoryResponse,
  ReleaseMetaView,
  ResearcherViewResponse,
  ReviewDoc,
  SessionDetailRequest,
  SessionDetailResponse,
  SettingsResponse,
  UpdateReviewRequest,
  WhoAmIRequest,
  WhoAmIResponse,
  Policy,
  StudyAccessResponse,
  StudyAccessView,
  SurveysResponse,
  SurveyVersionsResponse,
  UpdateStudyAccessRequest,
} from "@myself-dashboard/core";
import { firebase } from "./firebase";
import { currentStudy } from "./study";

/**
 * The backend, typed. Each call is a Firebase callable in europe-west2; the ID
 * token travels automatically and every call is authorised on the server.
 *
 * Every call names the study the dashboard is working in (lib/study.ts), unless
 * it names one itself (choosing a study; changing a study's access list). The
 * server checks the caller may see that study before it reads anything.
 */

function call<Req, Res>(name: string, timeout = 70_000) {
  return async (data: Req): Promise<Res> => {
    const fn = httpsCallable<Req, Res>(firebase().fns, name, { timeout });
    const study = currentStudy();
    const named = data && typeof data === "object" && "study" in (data as object);
    const r: HttpsCallableResult<Res> = await fn((study && !named ? { ...data, study } : data) as Req);
    return r.data;
  };
}

export const api = {
  whoAmI: call<WhoAmIRequest, WhoAmIResponse>("whoAmI"),
  querySessions: call<QuerySessionsRequest, QuerySessionsResponse>("querySessions"),
  getSessionDetail: call<SessionDetailRequest, SessionDetailResponse>("getSessionDetail"),
  getAnalytics: call<AnalyticsRequest, AnalyticsResponse>("getAnalytics"),
  getResearcherView: call<AnalyticsRequest, ResearcherViewResponse>("getResearcherView", 130_000),
  getQuestionAnalytics: call<QuestionAnalyticsRequest, QuestionAnalyticsResponse>("getQuestionAnalytics"),
  getQuestionHistory: call<{ key: string; filters?: AnalyticsRequest["filters"] }, QuestionHistoryResponse>("getQuestionHistory"),
  updateReview: call<UpdateReviewRequest, { review: ReviewDoc }>("updateReview"),
  addNote: call<AddNoteRequest, { id: string; noteCount: number }>("addNote"),
  previewExport: call<ExportRequest, ExportPreview>("previewExport"),
  createExport: call<ExportRequest, ExportJobView>("createExport", 560_000),
  getSettings: call<Record<string, never>, SettingsResponse>("getSettings"),
  updateAccessPolicy: call<{ emails: string[]; domains: string[] }, { emails: string[]; domains: string[] }>("updateAccessPolicy"),
  updatePolicy: call<Policy, { policy: Policy; rebuildRecommended: boolean }>("updatePolicy"),
  setDashboardRole: call<{ email: string; role: string | null }, { uid: string; email: string; role: string | null }>("setDashboardRole"),
  rebuildSummaries: call<{ onlyUnknownRelease?: boolean }, { scanned: number; written: number; unreadable: number }>("rebuildSummaries", 560_000),
  registerReleaseManifest: call<{ manifest: unknown }, ReleaseMetaView>("registerReleaseManifest"),
  logChartDownload: call<{ chart: string }, { ok: boolean }>("logChartDownload"),
  getParticipants: call<{ fresh?: boolean; filters?: AnalyticsRequest["filters"] }, ParticipantsResponse>("getParticipants", 130_000),
  getScores: call<ScoresRequest, ScoresView>("getScores", 300_000),
  getScoringSettings: call<Record<string, never>, ScoringSettingsView>("getScoringSettings", 130_000),
  getCodebook: call<{ release?: string; filters?: AnalyticsRequest["filters"] }, CodebookResponse>("getCodebook"),
  saveScoringScheme: call<SaveSchemeRequest, { key: string; version: string }>("saveScoringScheme"),
  saveGroupSettings: call<{ settings: GroupSettings; reason: string }, { ok: true }>("saveGroupSettings"),
  logFigureExport: call<{ format: string; panels: string[]; width: string; colour: string; dpi: number | null }, { ok: boolean }>("logFigureExport"),
  // The survey's version history (docs/11).
  listSurveyVersions: call<Record<string, never>, SurveyVersionsResponse>("listSurveyVersions"),
  exportSurveyProvenance: call<{ survey?: string }, { csv: string; json: string }>("exportSurveyProvenance"),
  getSurveyManifest: call<{ hash: string }, { manifestJson: string }>("getSurveyManifest"),
  // Study spaces and their surveys (docs/12).
  getSurveys: call<{ fresh?: boolean }, SurveysResponse>("getSurveys"),
  getStudyAccess: call<Record<string, never>, StudyAccessResponse>("getStudyAccess"),
  updateStudyAccess: call<UpdateStudyAccessRequest, StudyAccessView>("updateStudyAccess"),
};

export interface ApiError {
  code: string;
  message: string;
}

/** Turn anything thrown by a call into words a researcher can act on. */
export function explain(error: unknown): ApiError {
  const e = error as { code?: string; message?: string };
  const code = (e?.code ?? "unknown").replace(/^functions\//, "");
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { code: "offline", message: "You are offline. The dashboard will reload the data when the connection returns." };
  }
  switch (code) {
    case "unauthenticated":
      return { code, message: "Your sign-in has expired. Sign in again to continue." };
    case "permission-denied":
      return { code, message: e.message || "Your account is not permitted to do this." };
    case "unavailable":
    case "deadline-exceeded":
    case "internal":
      return { code, message: "The dashboard's server could not be reached or did not answer in time. Check your connection and try again." };
    case "not-found":
    case "invalid-argument":
    case "failed-precondition":
    case "aborted":
      return { code, message: e.message || "That request could not be completed." };
    default:
      return { code, message: e.message || "Something went wrong. Try again; if it keeps happening, tell the dashboard administrator." };
  }
}
