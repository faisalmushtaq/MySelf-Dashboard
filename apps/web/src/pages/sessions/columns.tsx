import type { ReactNode } from "react";
import { FLAG_REASONS, REVIEW_STATUS_LABELS, WARNING_LABELS, type SessionListItem, type SortKey } from "@myself-dashboard/core";
import { dateTime, duration, int, pct, shortId } from "../../lib/format";
import { StatusBadge } from "../../components/Status";
import { Icon } from "../../components/Icon";

/** Sessions (../Sessions.tsx): every column the list can show, and the ones it shows by default. */

export interface Column {
  id: string;
  label: string;
  sort?: SortKey;
  numeric?: boolean;
  render: (s: SessionListItem, ctx: { versionLabel: (h: string) => string }) => ReactNode;
}

export const COLUMNS: Column[] = [
  { id: "session", label: "Session ID", sort: "sessionId", render: (s) => <code title={s.sessionId}>{shortId(s.sessionId)}</code> },
  { id: "code", label: "Study code", sort: "studyCode", render: (s) => (s.studyCode ? <span title={s.studyCodeMasked ? "Partly hidden for your role" : undefined}>{s.studyCode}</span> : "—") },
  { id: "started", label: "Started", sort: "startedAt", render: (s) => dateTime(s.startedAt) },
  { id: "last", label: "Last activity", sort: "lastActivityAt", render: (s) => dateTime(s.lastActivityAt) },
  { id: "completed", label: "Completed", sort: "completedAt", render: (s) => (s.completedAt ? dateTime(s.completedAt) : "—") },
  { id: "version", label: "Version", sort: "version", render: (s, c) => (s.releaseKnown && s.releaseHash ? c.versionLabel(s.releaseHash) : <span title={s.releaseHash ?? ""}>Unknown</span>) },
  {
    id: "completion",
    label: "Completion",
    sort: "completion",
    numeric: true,
    render: (s) =>
      s.requiredCompletion === null ? (
        <span className="muted">n/a</span>
      ) : (
        <span className="completion-cell" title={s.estimated ? "Estimated" : undefined}>
          <span className="mini-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(s.requiredCompletion * 100)}%` }} />
          </span>
          {pct(s.requiredCompletion, s.estimated)}
        </span>
      ),
  },
  { id: "section", label: "Current / final section", sort: "section", render: (s) => s.finalSectionTitle ?? s.finalSectionKey ?? "—" },
  { id: "status", label: "Status", sort: "status", render: (s) => <StatusBadge status={s.status} /> },
  { id: "missing", label: "Missing required", sort: "missingRequired", numeric: true, render: (s) => (s.requiredMissing === null ? "—" : int(s.requiredMissing)) },
  {
    id: "signals",
    label: "Validation warnings",
    sort: "warnings",
    render: (s) => {
      const important = s.status.signals.filter((w) => !["imported", "backfilled", "resumed", "no_presentation_events"].includes(w));
      return important.length ? <span title={important.map((w) => WARNING_LABELS[w] ?? w).join("\n")}>{important.length} <Icon name="alert" size={13} /></span> : "—";
    },
  },
  {
    id: "flags",
    label: "Review flags",
    sort: "flags",
    render: (s) =>
      s.status.openFlags ? (
        <span title={s.flagReasons.map((r) => FLAG_REASONS.find((f) => f.id === r)?.label ?? r).join(", ")}>
          <Icon name="flag" size={13} /> {s.status.openFlags}
        </span>
      ) : (
        "—"
      ),
  },
  { id: "review", label: "Review status", sort: "reviewStatus", render: (s) => REVIEW_STATUS_LABELS[s.reviewStatus] },
  { id: "reviewed", label: "Last reviewed", sort: "lastReviewedAt", render: (s) => dateTime(s.lastReviewedAt) },
  { id: "duration", label: "Duration", sort: "duration", numeric: true, render: (s) => duration(s.durationMs ?? s.wallClockMs) },
  { id: "received", label: "Last received", sort: "receivedAt", render: (s) => dateTime(s.receivedAt) },
];

export const DEFAULT_COLS = ["session", "code", "started", "version", "completion", "section", "status", "missing", "signals", "flags", "review"];
