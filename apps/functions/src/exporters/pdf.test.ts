import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildRows,
  buildSummary,
  composeFigure,
  computeAnalytics,
  DEFAULT_FIGURE,
  DEFAULT_POLICY,
  presentAnswers,
  resolveRange,
  RULES_VERSION,
  toListItem,
  emptyReview,
  type ReviewDoc,
} from "@myself-dashboard/core";
import { demoReleases, generateDemoSittings } from "@myself-dashboard/core/node";
import { describe, expect, it } from "vitest";
import { completenessPdf, sessionReportPdf } from "./pdf.js";
import { formatMinutes, safe } from "./report.js";
import { pdfPages as pages, pdfText as drawnText } from "../../test/pdfText.js";

const now = new Date("2026-09-28T12:00:00.000Z");
const tz = "Europe/London";
const rels = demoReleases().map((r) => r.index);
const byHash = new Map(rels.map((r) => [r.hash, r]));
const sittings = generateDemoSittings({ now });
const built = sittings.map((s) => buildSummary(s.doc, byHash.get(s.doc.releaseHash!) ?? null, DEFAULT_POLICY, { now }));
const rows = buildRows(
  built.map((b) => b.summary),
  new Map(),
  DEFAULT_POLICY,
  now,
);

/** Set PDF_OUT=/some/dir to keep the rendered files for a look. */
function keep(name: string, body: Buffer) {
  const dir = process.env["PDF_OUT"];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}

describe("completeness report", () => {
  const analytics = computeAnalytics(rows, { now, timeZone: tz, range: resolveRange("all", {}, now, tz), releases: rels });
  const figure = composeFigure(
    { ...DEFAULT_FIGURE, title: "Participation and data completeness" },
    { analytics, questions: {}, period: "All time", filters: [], timeZone: tz, rulesVersion: RULES_VERSION, requiredLevels: ["hard", "soft"], abandonAfterHours: 24, versionLabel: (h) => `v${byHash.get(h)?.version ?? "?"}` },
  );

  it("lays out the headline figures, the figure and every table, with numbered pages", async () => {
    const pdf = await completenessPdf({
      analytics,
      figure,
      filters: ["Excluding test sessions"],
      dateRange: "All time",
      generatedBy: "owner@example.org",
      generatedAt: now,
      timeZone: tz,
      rulesVersion: RULES_VERSION,
      abandonAfterHours: 24,
      requiredLevels: ["hard", "soft"],
    });
    keep("completeness.pdf", pdf);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const n = pages(pdf);
    expect(n).toBeGreaterThanOrEqual(3);
    const text = drawnText(pdf);
    for (const heading of ["Data completeness report", "At a glance", "Completion by section", "By survey version", "By site", "Where unfinished sessions stopped", "Data-quality signals", "About this report"]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain(`Page ${n} of ${n}`);
    expect(text).toContain("CONFIDENTIAL RESEARCH DATA");
    // The figure is drawn as text and vectors, not an image.
    expect(text).toContain("Fig. 1");
    expect(pdf.toString("latin1")).not.toContain("/Subtype /Image");
  });

  it("still renders with no sessions", async () => {
    const empty = computeAnalytics([], { now, timeZone: tz, range: resolveRange("all", {}, now, tz), releases: rels });
    const pdf = await completenessPdf({ analytics: empty, figure: null, filters: [], dateRange: "All time", generatedBy: "a@example.org", generatedAt: now, timeZone: tz, rulesVersion: RULES_VERSION, abandonAfterHours: 24, requiredLevels: ["hard"] });
    expect(pages(pdf)).toBeGreaterThanOrEqual(1);
    expect(drawnText(pdf)).toContain("No required question is missing");
  });
});

describe("session report", () => {
  const pick = (pred: (i: number) => boolean) => {
    const i = built.findIndex((b, j) => b.summary.releaseKnown && pred(j));
    return { row: rows.find((r) => r.summary.sessionId === built[i]!.summary.sessionId)!, built: built[i]! };
  };

  it("groups answers by section, highlights missing required answers and keeps review apart", async () => {
    const { row, built: b } = pick((j) => (built[j]!.summary.counts.requiredMissing ?? 0) > 0 && built[j]!.summary.terminal);
    const release = byHash.get(row.summary.releaseHash!)!;
    const review: ReviewDoc = {
      ...emptyReview(row.summary.sessionId),
      status: "needs_review",
      flags: [
        { id: "f1", reason: "speeding", note: "Several pages under two seconds.", open: true, createdBy: "u1", createdByEmail: "reviewer@example.org", createdAt: "2026-09-20T10:00:00.000Z", resolvedBy: null, resolvedAt: null },
        { id: "f2", reason: "wrong_code", note: null, open: false, createdBy: "u1", createdByEmail: "reviewer@example.org", createdAt: "2026-09-18T10:00:00.000Z", resolvedBy: "u2", resolvedAt: "2026-09-19T10:00:00.000Z" },
      ],
      qualityConcerns: ["low_effort"],
    };
    const pdf = await sessionReportPdf({
      item: toListItem(row, { studyCodes: true }),
      releaseLabel: `v${release.version} (${release.key})`,
      sections: presentAnswers(b.assessment!, release, { freeText: false }),
      review,
      notes: [{ text: "Checked with the site lead — code confirmed. “Quotes” — and ≈ symbols 😀 survive.", authorEmail: "owner@example.org", createdAt: "2026-09-21T09:30:00.000Z" }],
      warnings: row.status.signals,
      estimateReasons: row.summary.estimateReasons,
      participant: {
        code: "JA101CD",
        wave: 2,
        sittings: [
          { sessionId: "01OTHER", wave: 1, startedAt: "2026-06-10T09:00:00.000Z", complete: true },
          { sessionId: row.summary.sessionId, wave: 2, startedAt: row.summary.startedAt!, complete: false },
        ],
      },
      generatedBy: "owner@example.org",
      generatedAt: now,
      timeZone: tz,
      includeStudyCode: true,
      includeFreeText: false,
      retentionHours: 24,
    });
    keep("session.pdf", pdf);
    const text = drawnText(pdf);
    for (const s of ["Session report", "Participant JA101CD", "Sections at a glance", "Answers", "Researcher review", "This participant's sittings", "Answered too quickly", "Missing"]) {
      expect(text).toContain(s);
    }
    expect(text).toContain("“Quotes” — and ~ symbols ? survive.");
    expect(text).toContain("could not be drawn in this PDF");
  });

  it("leaves out participant codes and study codes when the report is de-identified", async () => {
    const { row, built: b } = pick(() => true);
    const release = byHash.get(row.summary.releaseHash!)!;
    const pdf = await sessionReportPdf({
      item: toListItem(row, { studyCodes: false }),
      releaseLabel: `v${release.version}`,
      sections: presentAnswers(b.assessment!, release, { freeText: false }),
      review: emptyReview(row.summary.sessionId),
      notes: [],
      warnings: [],
      estimateReasons: [],
      participant: null,
      generatedBy: "a@example.org",
      generatedAt: now,
      timeZone: tz,
      includeStudyCode: false,
      includeFreeText: false,
      retentionHours: 24,
    });
    const text = drawnText(pdf);
    expect(text).not.toContain("Participant code");
    expect(text).not.toContain("Study code");
    expect(text).not.toContain(row.summary.studyCode ?? "never");
    expect(text).toContain("No notes.");
  });
});

describe("report text", () => {
  it("maps what Helvetica cannot draw and counts what is lost", () => {
    const lost = new Set<string>();
    expect(safe("a ≈ b → c − d ≥ e", lost)).toBe("a ~ b -> c - d >= e");
    expect(safe("‘x’ “y” – — … € £ é", lost)).toBe("‘x’ “y” – — … € £ é");
    expect(safe("日本 😀", lost)).toBe("?? ?");
    expect([...lost]).toEqual(["日", "本", "😀"]);
  });

  it("formats durations for people", () => {
    expect(formatMinutes(42_000)).toBe("42 s");
    expect(formatMinutes(6.5 * 60_000)).toBe("6.5 min");
    expect(formatMinutes(25 * 60_000)).toBe("25 min");
    expect(formatMinutes(135 * 60_000)).toBe("2 h 15 min");
    expect(formatMinutes(null)).toBe("–");
  });
});
