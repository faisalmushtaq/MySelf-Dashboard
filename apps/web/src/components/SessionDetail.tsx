import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ESTIMATE_REASON_LABELS, WARNING_LABELS, type AnswerView, type FilterState, type SessionDetailResponse, type SortState } from "@myself-dashboard/core";
import { api, explain } from "../lib/api";
import { dateTime, duration, int, pct, shortId } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useAnnounce } from "../app/announcer";
import { Icon } from "./Icon";
import { StatusBadge } from "./Status";
import { ErrorState, Notice, Skeleton } from "./States";
import { InfoTip } from "./InfoTip";
import { ExportDialog } from "./ExportDialog";
import { OutcomeBadge } from "./session-detail/OutcomeBadge";
import { ReviewPanel } from "./session-detail/ReviewPanel";

/**
 * One session, in full. Used by the full-page view and the split view.
 *
 * Answers are grouped by section in the wording of the survey version the
 * participant actually received. Identifying answers never arrive from the
 * server; free text arrives only for roles that may read it.
 */

export interface DetailContext {
  filters: FilterState;
  sort: SortState;
  search: string;
  pageSize: number;
}

type Show = "all" | "problems" | "answered" | "not_shown";

export function SessionDetail({
  sessionId,
  context,
  onNavigate,
  onBack,
  split = false,
}: {
  sessionId: string;
  context: DetailContext | null;
  onNavigate: (id: string) => void;
  onBack?: (page: number | null) => void;
  split?: boolean;
}) {
  const announce = useAnnounce();
  const ctxKey = JSON.stringify(context);
  const { data, error, loading, reload, setData } = useLoad<SessionDetailResponse>(
    () => api.getSessionDetail({ sessionId, ...(context ? { context } : {}) }),
    [sessionId, ctxKey],
  );
  const [show, setShow] = useState<Show>("all");
  const [jump, setJump] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const lastMissing = useRef<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    lastMissing.current = undefined;
    root.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [sessionId]);

  useEffect(() => {
    if (data) announce(`Session ${data.neighbours?.position ?? ""} ${data.neighbours ? `of ${data.neighbours.total}` : ""} loaded`, "info", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.item.sessionId]);

  const missing = useMemo(() => data?.answers?.flatMap((s) => s.answers).filter((a) => a.missing).map((a) => a.key) ?? [], [data]);

  const nextMissing = useCallback(() => {
    if (missing.length === 0) {
      announce("No missing required answers in this session.");
      return;
    }
    const i = lastMissing.current ? missing.indexOf(lastMissing.current) : -1;
    const key = missing[(i + 1) % missing.length]!;
    lastMissing.current = key;
    setShow("all");
    setTimeout(() => {
      const el = document.getElementById(`q-${key}`);
      el?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      el?.focus();
    }, 0);
    announce(`Missing answer ${missing.indexOf(key) + 1} of ${missing.length}: ${key}`);
  }, [missing, announce]);

  const n = data?.neighbours ?? null;

  // Keyboard: j/k (→/←) next/previous, m next missing, f next flagged, b/Esc back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable=true], dialog[open]") || e.metaKey || e.ctrlKey || e.altKey)) return;
      if ((e.key === "j" || e.key === "ArrowRight") && n?.nextId) onNavigate(n.nextId);
      else if ((e.key === "k" || e.key === "ArrowLeft") && n?.previousId) onNavigate(n.previousId);
      else if (e.key === "m") nextMissing();
      else if (e.key === "f" && n?.nextFlaggedId) onNavigate(n.nextFlaggedId);
      else if ((e.key === "b" || e.key === "Escape") && onBack) onBack(n?.page ?? null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n, onNavigate, onBack, nextMissing]);

  if (error && !data) {
    return <ErrorState title="This session could not be opened" message={error.message} onRetry={reload} />;
  }
  if (!data) {
    return (
      <div className="detail" aria-busy="true">
        <Skeleton lines={4} />
        <Skeleton lines={8} />
      </div>
    );
  }

  const it = data.item;
  const filterAnswer = (a: AnswerView) =>
    show === "all" ||
    (show === "problems" && (a.missing || a.outcome === "invalid" || a.outcome === "undetermined")) ||
    (show === "answered" && (a.outcome === "answered" || a.outcome === "declined" || a.outcome === "answered_hidden")) ||
    (show === "not_shown" && !a.shown);

  const submitJump = (e: FormEvent) => {
    e.preventDefault();
    const pos = Number(jump);
    if (!n || !Number.isInteger(pos) || pos < 1 || pos > n.total) {
      announce(`Enter a number between 1 and ${n?.total ?? 1}.`, "error");
      return;
    }
    // Positions are 1-based within the filtered list: fetch the page holding it.
    void api
      .querySessions({ filters: context!.filters, sort: context!.sort, search: context!.search, page: Math.ceil(pos / 25), pageSize: 25 })
      .then((r) => {
        const target = r.items[(pos - 1) % 25];
        if (target) onNavigate(target.sessionId);
      })
      .catch((err) => announce(explain(err).message, "error"));
  };

  return (
    <div className={`detail ${loading ? "dimmed" : ""} ${split ? "detail-split" : ""}`} ref={root} aria-busy={loading}>
      <nav className="detail-nav" aria-label="Session navigation">
        {onBack ? (
          <button type="button" className="btn btn-quiet" onClick={() => onBack(n?.page ?? null)}>
            <Icon name="chevronLeft" size={16} /> Back to results
          </button>
        ) : null}
        {n ? (
          <>
            <button type="button" className="btn" disabled={!n.previousId} onClick={() => n.previousId && onNavigate(n.previousId)} aria-keyshortcuts="k">
              <Icon name="chevronLeft" size={16} /> Previous
            </button>
            <span className="position" aria-live="polite">
              {n.position ? (
                <>
                  Session <strong>{int(n.position)}</strong> of {int(n.total)}
                </>
              ) : (
                "Not in the current results"
              )}
            </span>
            <button type="button" className="btn" disabled={!n.nextId} onClick={() => n.nextId && onNavigate(n.nextId)} aria-keyshortcuts="j">
              Next <Icon name="chevronRight" size={16} />
            </button>
            <form className="jump" onSubmit={submitJump}>
              <label>
                <span className="sr-only">Jump to session number</span>
                <input type="number" min={1} max={n.total} value={jump} onChange={(e) => setJump(e.target.value)} placeholder="#" inputMode="numeric" />
              </label>
              <button type="submit" className="btn btn-small">
                Go
              </button>
            </form>
            <button type="button" className="btn btn-quiet" disabled={!n.nextFlaggedId} onClick={() => n.nextFlaggedId && onNavigate(n.nextFlaggedId)} aria-keyshortcuts="f">
              <Icon name="flag" size={16} /> Next flagged
            </button>
          </>
        ) : null}
        <button type="button" className="btn btn-quiet" onClick={nextMissing} disabled={missing.length === 0} aria-keyshortcuts="m">
          <Icon name="skipNext" size={16} /> Next missing answer{missing.length ? ` (${missing.length})` : ""}
        </button>
      </nav>

      <header className="detail-head">
        <div>
          <h2 tabIndex={-1}>
            Session <code>{split ? shortId(it.sessionId) : it.sessionId}</code>
          </h2>
          <div className="detail-sub">
            <StatusBadge status={it.status} />
            {it.studyCode ? (
              <span className="pill" title={it.studyCodeMasked ? "Study code partly hidden for your role" : "Study code (pseudonymous)"}>
                {it.studyCode}
              </span>
            ) : null}
            <span className="pill">{data.release ? `Survey v${data.release.version}` : "Unknown survey version"}</span>
            {it.provenance === "imported" ? <span className="pill">Imported from file</span> : null}
          </div>
        </div>
        <div className="detail-score">
          <div className="score-value">{it.requiredCompletion === null ? "n/a" : pct(it.requiredCompletion, it.estimated)}</div>
          <div className="score-label">
            required answers
            <InfoTip label="Required completion">
              Required questions answered or declined ÷ required questions that applied to this participant, in this session's survey version.
            </InfoTip>
          </div>
          {data.counts ? (
            <div className="score-sub">
              {int(data.counts.requiredResolved)} of {int(data.counts.required)} · {int(data.counts.requiredMissing)} missing
            </div>
          ) : null}
          {data.permissions.review || data.permissions.freeText ? (
            <button type="button" className="btn btn-small" onClick={() => setExportOpen(true)}>
              <Icon name="download" size={14} /> Export this session
            </button>
          ) : null}
        </div>
      </header>

      {data.estimateReasons.length ? (
        <Notice>Completeness is an estimate: {data.estimateReasons.map((r) => ESTIMATE_REASON_LABELS[r] ?? r).join("; ")}.</Notice>
      ) : null}
      {!data.release ? (
        <Notice tone="warn">This session's survey version ({it.releaseHash ?? "none recorded"}) is not in the registry, so its answers cannot be shown against their questions. An administrator can register it in Settings.</Notice>
      ) : null}

      <div className={split ? "detail-body-split" : "detail-body"}>
        <div className="detail-main">
          <section className="card meta">
            <h3>Session record</h3>
            <dl className="kv kv-grid">
              <div><dt>Started</dt><dd>{dateTime(it.startedAt)}</dd></div>
              <div><dt>Last activity</dt><dd>{dateTime(it.lastActivityAt)}</dd></div>
              <div><dt>Completed</dt><dd>{it.completedAt ? dateTime(it.completedAt) : "Not completed"}</dd></div>
              <div><dt>First received (server)</dt><dd>{dateTime(it.firstReceivedAt)}</dd></div>
              <div><dt>Last received (server)</dt><dd>{dateTime(it.receivedAt)}</dd></div>
              <div><dt>Duration (device)</dt><dd>{duration(it.durationMs)}</dd></div>
              <div><dt>Start to last activity</dt><dd>{duration(it.wallClockMs)}</dd></div>
              <div><dt>Resumed</dt><dd>{int(data.resumedCount)} time{data.resumedCount === 1 ? "" : "s"}</dd></div>
              <div><dt>Answers edited from review</dt><dd>{int(data.reviewEdits)}</dd></div>
              <div><dt>Back navigations</dt><dd>{int(data.backNavigations)}</dd></div>
              <div><dt>Too-fast answers</dt><dd>{int(data.tooFastCount)}</dd></div>
              <div><dt>Events in log</dt><dd>{int(data.eventCount)}</dd></div>
              {data.deviceId ? <div><dt>Device</dt><dd><code>{data.deviceId}</code></dd></div> : null}
              <div><dt>Current / final section</dt><dd>{data.answers?.find((s) => s.key === it.finalSectionKey)?.title ?? it.finalSectionKey ?? "—"}</dd></div>
            </dl>
            {data.warnings.length ? (
              <ul className="signals" aria-label="Data-quality signals">
                {data.warnings.map((w) => (
                  <li key={w}>
                    <Icon name="alert" size={14} /> {WARNING_LABELS[w] ?? w}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {data.answers ? (
            <section className="answers" aria-label="Answers">
              <div className="answers-head">
                <h3>Answers — survey v{data.release?.version}</h3>
                <label className="inline-select">
                  Show
                  <select value={show} onChange={(e) => setShow(e.target.value as Show)}>
                    <option value="all">All questions</option>
                    <option value="problems">Missing, invalid or unknown</option>
                    <option value="answered">Answered</option>
                    <option value="not_shown">Not shown to the participant</option>
                  </select>
                </label>
              </div>
              <ol className="section-progress" aria-label="Completion by section">
                {data.answers.map((s) => (
                  <li key={s.key}>
                    <a href={`#sec-${s.key}`}>
                      <span>{s.title}</span>
                      <span className="sp-value">{s.applicable ? pct(s.completion) : "n/a"}</span>
                    </a>
                  </li>
                ))}
              </ol>
              {data.answers.map((s) => {
                const rows = s.answers.filter(filterAnswer);
                if (rows.length === 0) return null;
                return (
                  <section key={s.key} id={`sec-${s.key}`} className="answer-section">
                    <h4>
                      {s.title}
                      <span className="sec-meta">
                        {s.applicable ? `${int(s.resolved)} of ${int(s.required)} required answered` : "Did not apply to this participant"}
                        {s.conditional ? " · conditional section" : ""}
                      </span>
                    </h4>
                    <ol className="answer-list">
                      {rows.map((a) => (
                        <li key={a.key} id={`q-${a.key}`} tabIndex={-1} className={`answer ${a.missing ? "is-missing" : ""} outcome-row-${a.outcome}`}>
                          <div className="answer-q">
                            <div className="answer-ids">
                              <code>{a.key}</code>
                              <span className="muted-id" title={`Survey variable ${a.variable}`}>{a.name} · r{a.revision} · {a.responseType.replace("_", " ")}</span>
                            </div>
                            <p className="answer-text">{a.text}</p>
                            <div className="answer-tags">
                              <OutcomeBadge outcome={a.outcome} />
                              {a.countsAsRequired ? <span className="tag">Required ({a.required})</span> : <span className="tag tag-quiet">{a.required === "optional" ? "Optional" : `Not counted (${a.required})`}</span>}
                              {a.conditional ? <span className="tag tag-quiet">Conditional</span> : null}
                              <span className="tag tag-quiet">{a.shown ? `Shown${a.presentedCount > 1 ? ` ${a.presentedCount}×` : ""}` : "Not shown"}</span>
                              {a.changed ? <span className="tag tag-quiet">Changed</span> : null}
                              {a.tooFast ? <span className="tag tag-warn">Too fast</span> : null}
                              {a.inconsistent ? <span className="tag tag-warn">Inconsistent</span> : null}
                            </div>
                          </div>
                          <div className="answer-a">
                            {a.answer.redacted === "identifying" ? (
                              <span className="withheld">
                                <Icon name="lock" size={14} /> Withheld — identifying
                              </span>
                            ) : a.answer.redacted === "free_text" ? (
                              <span className="withheld">
                                <Icon name="lock" size={14} /> Free text — not shown for your role
                              </span>
                            ) : a.answer.display !== null ? (
                              <span className="answer-value">
                                {a.answer.display}
                                {a.emptyValue ? <span className="tag tag-quiet">empty, allowed</span> : null}
                                {typeof a.answer.code === "number" && a.answer.kind === "choice" ? <span className="code">code {a.answer.code}</span> : null}
                              </span>
                            ) : (
                              <span className="no-answer">—</span>
                            )}
                            {a.invalidReason ? (
                              <span className="invalid-reason">
                                <Icon name="alert" size={14} /> {a.invalidReason}
                              </span>
                            ) : null}
                            {a.respondedAt ? <span className="answer-time">{dateTime(a.respondedAt)}{a.dwellMs !== null ? ` · ${duration(a.dwellMs)} on screen` : ""}</span> : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                );
              })}
              {data.notInVersion.length ? (
                <section className="answer-section">
                  <h4>
                    Not in this version
                    <span className="sec-meta">Questions added in v{data.notInVersion[0]!.version} — never asked in this session. Not missing.</span>
                  </h4>
                  <ul className="not-in-version">
                    {data.notInVersion.map((q) => (
                      <li key={q.key}>
                        <code>{q.key}</code> {q.text}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </section>
          ) : null}
        </div>
        <ReviewPanel
          detail={data}
          onChange={(review) => {
            // Show the change at once, then reload: the session's status (e.g. "Needs
            // review") is derived on the server from the review, and so are the
            // neighbours for "Next flagged".
            setData({ ...data, review, item: { ...data.item, reviewStatus: review.status } });
            void reload();
          }}
          onNoteAdded={reload}
        />
      </div>
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        initial={{ kind: "session_report", scope: "single", format: "pdf", sessionIds: [it.sessionId], filters: context?.filters ?? (undefined as never) }}
      />
    </div>
  );
}
