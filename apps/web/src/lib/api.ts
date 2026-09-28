import { httpsCallable, type HttpsCallableResult } from "firebase/functions";
import type {
  AddNoteRequest,
  AnalyticsRequest,
  AnalyticsResponse,
  ExportJobView,
  ExportPreview,
  ExportRequest,
  QuerySessionsRequest,
  QuerySessionsResponse,
  QuestionAnalyticsRequest,
  QuestionAnalyticsResponse,
  QuestionHistoryResponse,
  ReleaseMetaView,
  ReviewDoc,
  SessionDetailRequest,
  SessionDetailResponse,
  SettingsResponse,
  UpdateReviewRequest,
  WhoAmIResponse,
  Policy,
} from "@myself-dashboard/core";
import { firebase } from "./firebase";

/**
 * The backend, typed. Each call is a Firebase callable in europe-west2; the ID
 * token travels automatically and every call is authorised on the server.
 */

function call<Req, Res>(name: string, timeout = 70_000) {
  return async (data: Req): Promise<Res> => {
    const fn = httpsCallable<Req, Res>(firebase().fns, name, { timeout });
    const r: HttpsCallableResult<Res> = await fn(data);
    return r.data;
  };
}

export const api = {
  whoAmI: call<{ signIn?: boolean }, WhoAmIResponse>("whoAmI"),
  querySessions: call<QuerySessionsRequest, QuerySessionsResponse>("querySessions"),
  getSessionDetail: call<SessionDetailRequest, SessionDetailResponse>("getSessionDetail"),
  getAnalytics: call<AnalyticsRequest, AnalyticsResponse>("getAnalytics"),
  getQuestionAnalytics: call<QuestionAnalyticsRequest, QuestionAnalyticsResponse>("getQuestionAnalytics"),
  getQuestionHistory: call<{ key: string }, QuestionHistoryResponse>("getQuestionHistory"),
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
