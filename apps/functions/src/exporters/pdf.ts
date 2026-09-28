import PDFDocument from "pdfkit";
import {
  ESTIMATE_REASON_LABELS,
  FLAG_REASONS,
  OUTCOME_LABELS,
  REVIEW_STATUS_LABELS,
  STATUS_LABELS,
  WARNING_LABELS,
  type Analytics,
  type ReviewDoc,
  type SectionView,
  type SessionListItem,
} from "@myself-dashboard/core";

/**
 * Formatted PDF reports, generated on the server with pdfkit's built-in
 * Helvetica — no fonts fetched, nothing leaves the function.
 */

/** Helvetica in pdfkit is WinAnsi: map what it cannot draw to what it can. */
const safe = (s: string | null | undefined): string =>
  (s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "*")
    .replace(/≈/g, "~")
    .replace(/→/g, "->")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);

function header(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.font("Helvetica-Bold").fontSize(16).text(safe(title));
  doc.font("Helvetica").fontSize(9).fillColor("#444444").text(safe(subtitle));
  doc.fillColor("#000000").moveDown(0.8);
}

function kv(doc: PDFKit.PDFDocument, rows: [string, string][]) {
  for (const [k, v] of rows) {
    doc.font("Helvetica-Bold").fontSize(9).text(`${safe(k)}: `, { continued: true });
    doc.font("Helvetica").text(safe(v));
  }
  doc.moveDown(0.6);
}

export interface SessionReportInput {
  item: SessionListItem;
  releaseLabel: string;
  sections: SectionView[] | null;
  review: ReviewDoc;
  warnings: string[];
  estimateReasons: string[];
  generatedBy: string;
  generatedAt: Date;
  includeStudyCode: boolean;
}

export function sessionReportPdf(input: SessionReportInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Session report ${input.item.sessionId}`, Author: "MySelf Research Dashboard" } });
  header(doc, "MySelf session report", `Generated ${input.generatedAt.toISOString()} by ${input.generatedBy}. Confidential research data - handle under the study's data management plan.`);
  kv(doc, [
    ["Session", input.item.sessionId],
    ...(input.includeStudyCode && input.item.studyCode ? ([["Study code", input.item.studyCode]] as [string, string][]) : []),
    ["Survey version", input.releaseLabel],
    ["Status", `${STATUS_LABELS[input.item.status.display]}${input.item.status.markers.length ? ` (${STATUS_LABELS[input.item.status.lifecycle]})` : ""}`],
    ["Required completion", `${input.item.estimated ? "~" : ""}${pct(input.item.requiredCompletion)}${input.item.requiredMissing !== null ? ` - ${input.item.requiredMissing} missing of ${input.item.requiredTotal}` : ""}`],
    ["Started", input.item.startedAt ?? "unknown"],
    ["Completed", input.item.completedAt ?? "not completed"],
    ["Last activity", input.item.lastActivityAt ?? "unknown"],
    ["Review", `${REVIEW_STATUS_LABELS[input.review.status]}; open flags: ${input.review.flags.filter((f) => f.open).map((f) => FLAG_REASONS.find((r) => r.id === f.reason)?.label ?? f.reason).join(", ") || "none"}`],
  ]);
  if (input.estimateReasons.length) {
    doc.font("Helvetica-Oblique").fontSize(9).text(safe(`Completeness is estimated: ${input.estimateReasons.map((r) => ESTIMATE_REASON_LABELS[r] ?? r).join("; ")}.`)).moveDown(0.5);
  }
  if (input.warnings.length) {
    doc.font("Helvetica-Bold").fontSize(10).text("Data-quality signals");
    doc.font("Helvetica").fontSize(9);
    for (const w of input.warnings) doc.text(safe(`- ${WARNING_LABELS[w] ?? w}`));
    doc.moveDown(0.6);
  }
  if (!input.sections) {
    doc.font("Helvetica-Oblique").fontSize(10).text("This session's survey version is not in the registry, so its answers cannot be shown against their questions.");
  } else {
    for (const s of input.sections) {
      if (doc.y > 720) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(11).text(safe(`${s.title}${s.applicable ? ` - ${pct(s.completion)}` : " - not applicable"}`));
      doc.moveDown(0.2);
      for (const a of s.answers) {
        if (doc.y > 760) doc.addPage();
        const answer = a.answer.redacted === "identifying" ? "[withheld - identifying]" : a.answer.redacted === "free_text" ? "[withheld - free text]" : (a.answer.display ?? "-");
        doc.font("Helvetica").fontSize(8).fillColor("#555555").text(safe(`${a.key}  ${OUTCOME_LABELS[a.outcome]}${a.countsAsRequired ? " - required" : ""}${a.invalidReason ? ` - ${a.invalidReason}` : ""}`));
        doc.fillColor("#000000").font("Helvetica").fontSize(9).text(safe(a.text), { indent: 8 });
        doc.font("Helvetica-Bold").fontSize(9).text(safe(answer), { indent: 8 });
        doc.moveDown(0.3);
      }
      doc.moveDown(0.4);
    }
  }
  return collect(doc);
}

export function completenessPdf(a: Analytics, meta: { filters: string[]; generatedBy: string; generatedAt: Date; dateRange: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: "Completeness summary", Author: "MySelf Research Dashboard" } });
  header(doc, "MySelf completeness summary", `Generated ${meta.generatedAt.toISOString()} by ${meta.generatedBy}. Date range: ${meta.dateRange}. Filters: ${meta.filters.join("; ") || "none"}.`);
  const m = a.metrics;
  kv(doc, [
    ["Sessions started", String(m.started)],
    ["Complete / incomplete / abandoned", `${m.complete} / ${m.incomplete} / ${m.abandoned}`],
    ["In progress / not started", `${m.inProgress} / ${m.notStarted}`],
    ["Completion rate", `${pct(m.completionRate)} of ${m.completionRateDenominator} finished or abandoned sessions`],
    ["Mean required completion (finished sessions)", pct(m.meanRequiredCompletion)],
    ["Median completion time", m.medianDurationMs === null ? `not shown (n=${m.durationN})` : `${(m.medianDurationMs / 60000).toFixed(1)} min (n=${m.durationN})`],
    ["Needs review / invalid", `${m.needsReview} / ${m.invalid}`],
  ]);
  doc.font("Helvetica-Bold").fontSize(11).text("Completion by section").moveDown(0.2);
  doc.font("Helvetica").fontSize(9);
  for (const s of a.sections) doc.text(safe(`${s.title}: ${pct(s.completion)} of required answers; applicable to ${s.sessionsApplicable} sessions; ${s.sessionsWithMissing} with gaps`));
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11).text("By survey version").moveDown(0.2);
  doc.font("Helvetica").fontSize(9);
  for (const v of a.versions) doc.text(safe(`${v.version ?? "unknown version"}: ${v.sessions} sessions, completion rate ${pct(v.completionRate)}`));
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11).text("Most commonly missing required questions").moveDown(0.2);
  doc.font("Helvetica").fontSize(9);
  for (const q of a.topMissing) doc.text(safe(`${q.count} x ${q.key} - ${q.text}`));
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11).text("Drop-off points (unfinished sessions)").moveDown(0.2);
  doc.font("Helvetica").fontSize(9);
  for (const q of a.dropOff) doc.text(safe(`${q.count} x ${q.key} - ${q.text}`));
  return collect(doc);
}
