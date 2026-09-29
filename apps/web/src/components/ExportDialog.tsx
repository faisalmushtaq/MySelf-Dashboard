import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import {
  EXPORT_KIND_LABELS,
  EXPORT_SCOPE_LABELS,
  EXPORT_FORMAT_LABELS,
  FORMATS_BY_KIND,
  type ExportFormat,
  type ExportJobView,
  type ExportKind,
  type ExportPreview,
  type ExportScope,
  type FilterState,
  type SortState,
} from "@myself-dashboard/core";
import { api, explain } from "../lib/api";
import { downloadExport } from "../lib/download";
import { firebase, STUDY } from "../lib/firebase";
import { useDebounced } from "../lib/hooks";
import { bytes, int } from "../lib/format";
import { useAuth } from "../app/auth";
import { useAnnounce } from "../app/announcer";
import { useStudyData } from "../app/data";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { Loading, Notice } from "./States";

/**
 * Configure → preview → confirm → generate (on the server) → download.
 * The preview shows exactly what the brief asks to be shown before an export:
 * type, number of sessions, date range, filters, versions, fields, free text,
 * identifiers, format, and a privacy warning where one applies. The server makes
 * every decision again when the export is created.
 */
export interface ExportInitial {
  kind?: ExportKind;
  scope?: ExportScope;
  format?: ExportFormat;
  sessionIds?: string[];
  filters: FilterState;
  sort?: SortState;
  versionHash?: string;
}

export function ExportDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: ExportInitial }) {
  const { can, me } = useAuth();
  const announce = useAnnounce();
  const { byNewest, activeRelease } = useStudyData();
  const rowLevel = can("export.sessions");
  const [kind, setKind] = useState<ExportKind>(initial.kind ?? (rowLevel ? "sessions" : "completeness_summary"));
  const [scope, setScope] = useState<ExportScope>(initial.scope ?? "filtered");
  const [format, setFormat] = useState<ExportFormat>(initial.format ?? "bids");
  const [includeAnswers, setIncludeAnswers] = useState(false);
  const [layout, setLayout] = useState<"wide" | "long">("wide");
  const [includeFreeText, setFreeText] = useState(false);
  // Identifiers are included by default (for linkage); de-identifying is a choice.
  const [identifiers, setIdentifiers] = useState(true);
  const [versionHash, setVersion] = useState(initial.versionHash ?? activeRelease?.hash ?? "");
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [job, setJob] = useState<ExportJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setJob(null);
    setError(null);
    setConfirmed(false);
    setKind(initial.kind ?? (rowLevel ? "sessions" : "completeness_summary"));
    setScope(initial.scope ?? "filtered");
    setFormat(initial.format ?? (initial.kind === "session_report" ? "pdf" : FORMATS_BY_KIND[initial.kind ?? (rowLevel ? "sessions" : "completeness_summary")][0]!));
    setIdentifiers(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!FORMATS_BY_KIND[kind].includes(format)) setFormat(FORMATS_BY_KIND[kind][0]!);
  }, [kind, format]);

  const spec = {
    kind,
    scope: kind === "session_report" ? "single" : scope,
    format,
    sessionIds: scope === "selected" || scope === "single" || kind === "session_report" ? initial.sessionIds ?? [] : [],
    filters: initial.filters,
    sort: initial.sort,
    includeAnswers: kind === "sessions" ? includeAnswers || format === "bids" : kind === "session_report",
    layout,
    includeFreeText,
    includeStudyCode: identifiers && can("export.studyCode"),
    deidentified: !identifiers,
    ...(kind === "question_summary" ? { versionHash } : {}),
  };
  const specKey = useDebounced(JSON.stringify(spec), 250);

  useEffect(() => {
    if (!open || job) return;
    let cancelled = false;
    setPreviewing(true);
    api
      .previewExport(JSON.parse(specKey))
      .then((p) => {
        if (!cancelled) {
          setPreview(p);
          setPreviewError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(explain(e).message);
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [specKey, open, job]);

  // While the server works, follow this person's newest job for its progress.
  useEffect(() => {
    if (!running || !me?.uid) return;
    const q = query(collection(firebase().db, `studies/${STUDY}/exportJobs`), where("requestedBy", "==", me.uid), orderBy("createdAt", "desc"), limit(1));
    return onSnapshot(q, (snap) => {
      const d = snap.docs[0]?.data();
      if (d && typeof d["progress"] === "number") setProgress(d["progress"] as number);
    });
  }, [running, me?.uid]);

  const create = async () => {
    setRunning(true);
    setProgress(0.02);
    setError(null);
    announce("Export started. This can take a little while for large exports.", "info", false);
    try {
      const j = await api.createExport(spec);
      setJob(j);
      if (j.status === "ready") announce(`Export ready: ${j.fileName}`, "success");
      else {
        setError(j.error ?? "The export failed.");
        announce(`Export failed. ${j.error ?? ""}`, "error");
      }
    } catch (e) {
      const m = explain(e).message;
      setError(m);
      announce(`Export failed. ${m}`, "error");
    } finally {
      setRunning(false);
    }
  };

  const download = async () => {
    if (!job) return;
    try {
      await downloadExport(job.id, job.fileName);
      announce("Download started.", "success");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const kinds: ExportKind[] = ["sessions", "session_report", "completeness_summary", "question_summary"];
  const scopes: ExportScope[] = ["all", "filtered", ...(initial.sessionIds?.length ? (["selected"] as ExportScope[]) : [])];

  return (
    <Dialog open={open} onClose={onClose} title="Export data" wide>
      {job ? (
        <div className="export-done">
          {job.status === "ready" ? (
            <>
              <p className="done-line">
                <Icon name="check" /> <strong>{job.fileName}</strong> is ready ({bytes(job.bytes)}, {int(job.rowCount)} rows).
              </p>
              <p className="hint">It can be downloaded by you (and administrators) until it is deleted in {preview?.retentionHours ?? 24} hours. The download is recorded in the audit log.</p>
              <div className="button-row">
                <button type="button" className="btn btn-primary" onClick={() => void download()}>
                  <Icon name="download" size={16} /> Download
                </button>
                <button type="button" className="btn btn-quiet" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          ) : (
            <Notice tone="warn">{job.error ?? "The export failed."}</Notice>
          )}
          {error ? <Notice tone="warn">{error}</Notice> : null}
        </div>
      ) : (
        <div className="export-grid">
          <form className="export-form" onSubmit={(e) => e.preventDefault()}>
            <label>
              What to export
              <select value={kind} onChange={(e) => setKind(e.target.value as ExportKind)}>
                {kinds.map((k) => (
                  <option key={k} value={k} disabled={(k === "sessions" || k === "session_report") && !rowLevel || (k === "session_report" && (initial.sessionIds?.length ?? 0) !== 1)}>
                    {EXPORT_KIND_LABELS[k]}
                    {(k === "sessions" || k === "session_report") && !rowLevel ? " (not available for your role)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {kind !== "session_report" ? (
              <label>
                Which sessions
                <select value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
                  {scopes.map((s) => (
                    <option key={s} value={s}>
                      {EXPORT_SCOPE_LABELS[s]}
                      {s === "selected" ? ` (${initial.sessionIds?.length ?? 0})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <fieldset className="radio-row">
              <legend>Format</legend>
              {FORMATS_BY_KIND[kind].map((f) => (
                <label key={f}>
                  <input type="radio" name="format" value={f} checked={format === f} onChange={() => setFormat(f)} disabled={f === "json" && !can("export.json")} />
                  {EXPORT_FORMAT_LABELS[f]}
                  {f === "bids" ? " — recommended" : ""}
                  {f === "json" && !can("export.json") ? " (administrators)" : ""}
                </label>
              ))}
            </fieldset>
            {kind === "question_summary" ? (
              <label>
                Survey version
                <select value={versionHash} onChange={(e) => setVersion(e.target.value)}>
                  {byNewest.map((r) => (
                    <option key={r.hash} value={r.hash}>
                      v{r.version}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {kind === "sessions" && format !== "bids" ? (
              <>
                <label className="check">
                  <input type="checkbox" checked={includeAnswers} onChange={(e) => setIncludeAnswers(e.target.checked)} />
                  Include answers (stored option codes, one column per question, plus a status column)
                </label>
                {includeAnswers ? (
                  <fieldset className="radio-row">
                    <legend>Layout</legend>
                    <label>
                      <input type="radio" name="layout" checked={layout === "wide"} onChange={() => setLayout("wide")} /> Wide (one row per session)
                    </label>
                    <label>
                      <input type="radio" name="layout" checked={layout === "long"} onChange={() => setLayout("long")} /> Long (one row per answer)
                    </label>
                  </fieldset>
                ) : null}
              </>
            ) : null}
            {(kind === "sessions" && (includeAnswers || format === "bids")) || kind === "session_report" ? (
              <label className="check">
                <input type="checkbox" checked={includeFreeText} disabled={!can("export.freeText")} onChange={(e) => setFreeText(e.target.checked)} />
                Include free-text answers{format === "bids" ? " and narrative logs" : ""} {!can("export.freeText") ? "(not permitted for your role)" : ""}
              </label>
            ) : null}
            {kind === "sessions" || kind === "session_report" ? (
              <label className="check">
                <input type="checkbox" checked={identifiers} disabled={!can("export.studyCode")} onChange={(e) => setIdentifiers(e.target.checked)} />
                <span>
                  Include identifiers for linkage
                  <span className="hint block">
                    {identifiers
                      ? "Participant codes, study codes, sitting and device IDs, and exact times."
                      : "De-identified: participant codes replaced by labels (P0001…) that mean nothing outside this file; no study codes or device IDs; dates only."}
                  </span>
                </span>
              </label>
            ) : null}
            <p className="hint">Names, dates of birth, UPNs, NHS numbers and secret-code answers are never exported from this dashboard.</p>
          </form>

          <section className="export-preview" aria-live="polite" aria-busy={previewing}>
            <h3>Before you export</h3>
            {previewError ? <Notice tone="warn">{previewError}</Notice> : null}
            {!preview && !previewError ? <Loading label="Checking what this export contains" /> : null}
            {preview ? (
              <>
                <dl className="kv">
                  <div><dt>Export</dt><dd>{preview.kindLabel}</dd></div>
                  <div><dt>Sessions</dt><dd><strong>{int(preview.sessionCount)}</strong> — {preview.scopeLabel.toLowerCase()}</dd></div>
                  <div><dt>Date range</dt><dd>{preview.dateRange}</dd></div>
                  <div><dt>Filters</dt><dd>{preview.filters.length ? preview.filters.join("; ") : "None"}</dd></div>
                  <div><dt>Survey versions</dt><dd>{preview.versions.length ? preview.versions.map((v) => `${v.version === "unknown" ? "unknown" : `v${v.version}`} (${v.sessions})`).join(", ") : "—"}</dd></div>
                  <div><dt>Fields</dt><dd className="fields">{preview.fields.join(", ")}</dd></div>
                  <div><dt>Free-text answers</dt><dd>{preview.includesFreeText ? "Included" : "Not included"}</dd></div>
                  <div><dt>Identifiers</dt><dd>{!preview.sensitive ? "None (summary)" : preview.deidentified ? "None (de-identified)" : "Participant codes, study codes, sitting and device IDs, exact times"}</dd></div>
                  <div><dt>Format</dt><dd>{EXPORT_FORMAT_LABELS[preview.format]}</dd></div>
                  <div><dt>File name</dt><dd><code>{preview.fileName}</code></dd></div>
                </dl>
                {preview.warnings.map((w) => (
                  <Notice key={w} tone="warn">
                    {w}
                  </Notice>
                ))}
                {!preview.allowed ? <Notice tone="warn">{preview.refusal}</Notice> : null}
                {preview.allowed && preview.sensitive ? (
                  <label className="check confirm">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                    I will store and share this file only as the study's data management plan allows.
                  </label>
                ) : null}
              </>
            ) : null}
            {running ? (
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Export progress">
                <div className="progress-fill" style={{ width: `${Math.max(4, progress * 100)}%` }} />
                <span>Generating on the server… {Math.round(progress * 100)}%</span>
              </div>
            ) : null}
            {error ? <Notice tone="warn">{error}</Notice> : null}
            <div className="button-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!preview || !preview.allowed || running || previewing || (preview.sensitive && !confirmed) || preview.sessionCount === 0}
                onClick={() => void create()}
              >
                <Icon name="download" size={16} /> {running ? "Generating…" : "Generate export"}
              </button>
              <button type="button" className="btn btn-quiet" onClick={onClose} disabled={running}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </Dialog>
  );
}
