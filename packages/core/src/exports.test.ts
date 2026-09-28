import { describe, expect, it } from "vitest";
import { authoriseExport, exportFileName, parseExportSpec, ExportSpecError } from "./exportSpec.js";
import { codebookTable, sessionsTable } from "./exportData.js";
import { buildRows } from "./query.js";
import { buildSummary } from "./summary.js";
import { DEFAULT_POLICY } from "./policy.js";
import { generateDemoSittings, demoReleases } from "./node/synthetic.js";
import { toCsv } from "./csv.js";

const now = new Date("2026-09-28T12:00:00.000Z");
const rels = demoReleases().map((r) => r.index);
const byHash = new Map(rels.map((r) => [r.hash, r]));
const built = generateDemoSittings({ now }).map((s) => {
  const release = byHash.get(s.doc.releaseHash!) ?? null;
  const b = buildSummary(s.doc, release, DEFAULT_POLICY, { now });
  return { scenario: s.scenario, release, ...b };
});
const rows = buildRows(built.map((b) => b.summary), new Map(), DEFAULT_POLICY, now);
const records = rows.map((row, i) => ({ row, assessment: built[i]!.assessment, ...(built[i]!.release ? { release: built[i]!.release! } : {}) }));

describe("export requests", () => {
  it("fills safe defaults: de-identified, no free text, no study codes", () => {
    const spec = parseExportSpec({ kind: "sessions", format: "csv", scope: "filtered" });
    expect(spec).toMatchObject({ deidentified: true, includeFreeText: false, includeStudyCode: false, includeAnswers: false });
  });

  it("refuses impossible combinations", () => {
    expect(() => parseExportSpec({ kind: "session_report", format: "csv", scope: "single", sessionIds: ["a"] })).toThrow(ExportSpecError);
    expect(() => parseExportSpec({ kind: "sessions", format: "csv", scope: "selected" })).toThrow(/no sessions/);
    expect(() => parseExportSpec({ kind: "question_summary", format: "csv", scope: "filtered" })).toThrow(/version/);
    expect(() => parseExportSpec({ kind: "sessions", format: "exe", scope: "all" })).toThrow();
  });

  it("study codes need de-identification switched off", () => {
    expect(parseExportSpec({ kind: "sessions", format: "csv", scope: "all", includeStudyCode: true }).includeStudyCode).toBe(false);
    expect(parseExportSpec({ kind: "sessions", format: "csv", scope: "all", includeStudyCode: true, deidentified: false }).includeStudyCode).toBe(true);
  });

  it("applies the role matrix on the server", () => {
    const rowLevel = parseExportSpec({ kind: "sessions", format: "csv", scope: "filtered" });
    const aggregate = parseExportSpec({ kind: "completeness_summary", format: "csv", scope: "filtered" });
    const freeText = parseExportSpec({ kind: "sessions", format: "csv", scope: "filtered", includeAnswers: true, includeFreeText: true });
    const json = parseExportSpec({ kind: "sessions", format: "json", scope: "filtered" });
    expect(authoriseExport("analyst", rowLevel).ok).toBe(false);
    expect(authoriseExport("analyst", aggregate).ok).toBe(true);
    expect(authoriseExport("researcher", freeText).ok).toBe(true);
    expect(authoriseExport("researcher", json).ok).toBe(false);
    expect(authoriseExport("owner", json).ok).toBe(true);
    expect(authoriseExport(null, aggregate).ok).toBe(false);
  });

  it("names files descriptively and safely", () => {
    const spec = parseExportSpec({ kind: "sessions", format: "csv", scope: "filtered" });
    expect(exportFileName(spec, { fromDay: "2026-09-01", toDay: "2026-09-28" }, now)).toBe(
      "myself_sessions-filtered_2026-09-01_to_2026-09-28_deidentified_created-20260928-1200.csv",
    );
    const single = parseExportSpec({ kind: "session_report", format: "pdf", scope: "single", sessionIds: ["01J../../etc/passwd"] });
    expect(exportFileName(single, { fromDay: null, toDay: null }, now)).toMatch(/^myself_session-report_session-01jetcpasswd_created-20260928-1200\.pdf$/);
  });
});

describe("export contents", () => {
  const withAnswers = (extra: Record<string, unknown> = {}) =>
    parseExportSpec({ kind: "sessions", format: "csv", scope: "all", includeAnswers: true, ...extra });

  it("never contains identifying answers, for any role or option", () => {
    const t = sessionsTable(records, withAnswers({ includeFreeText: true, deidentified: false, includeStudyCode: true }), "Europe/London");
    expect(t.headers).not.toContain("first_name");
    expect(t.headers.some((h) => h.startsWith("first_name"))).toBe(false);
    const csv = toCsv(t.headers, t.rows);
    for (const name of ["Alex", "Sam", "Jordan", "Riley", "Casey", "Morgan"]) expect(csv).not.toContain(name);
  });

  it("includes free text only when asked and allowed", () => {
    const col = (t: ReturnType<typeof sessionsTable>) => t.headers.indexOf("future_message");
    const without = sessionsTable(records, withAnswers(), "Europe/London");
    expect(without.rows.every((r) => r[col(without)] === null)).toBe(true);
    const withText = sessionsTable(records, withAnswers({ includeFreeText: true }), "Europe/London");
    expect(withText.rows.some((r) => typeof r[col(withText)] === "string")).toBe(true);
  });

  it("neutralises a formula typed by a participant", () => {
    const t = sessionsTable(records, withAnswers({ includeFreeText: true }), "Europe/London");
    const csv = toCsv(t.headers, t.rows);
    expect(csv).toContain(`"'=HYPERLINK(`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it("de-identified exports drop codes and device ids and keep dates to the day", () => {
    const t = sessionsTable(records, parseExportSpec({ kind: "sessions", format: "csv", scope: "all" }), "Europe/London");
    expect(t.headers).not.toContain("study_code");
    expect(t.headers).not.toContain("device_id");
    const started = t.headers.indexOf("started_at");
    expect(t.rows.every((r) => r[started] === null || /^\d{4}-\d{2}-\d{2}$/.test(String(r[started])))).toBe(true);
  });

  it("marks questions a sitting's version did not have, rather than calling them missing", () => {
    const t = sessionsTable(records, withAnswers(), "Europe/London");
    const status = t.headers.indexOf("school_travel__status");
    const version = t.headers.indexOf("release_version");
    const v1 = t.rows.filter((r) => r[version] === "1.0.0");
    expect(v1.length).toBeGreaterThan(0);
    expect(v1.every((r) => r[status] === "not_in_version")).toBe(true);
  });

  it("writes stored option codes, not labels", () => {
    const t = sessionsTable(records, withAnswers(), "Europe/London");
    const col = t.headers.indexOf("sleep_quality");
    expect(t.rows.some((r) => typeof r[col] === "number")).toBe(true);
  });

  it("long layout has one row per sitting × question, without identifying items", () => {
    const t = sessionsTable(records, withAnswers({ layout: "long" }), "Europe/London");
    const key = t.headers.indexOf("question_key");
    expect(t.rows.some((r) => r[key] === "demo_about.first_name")).toBe(false);
    expect(t.rows.length).toBeGreaterThan(rows.length * 10);
  });

  it("the codebook describes every exported question per version", () => {
    const t = codebookTable(rels);
    expect(t.rows.some((r) => r[1] === "demo_about.first_name")).toBe(false);
    expect(t.rows.filter((r) => r[1] === "demo_sleep.sleep_quality").map((r) => r[5])).toEqual([
      "How well did you sleep last night?",
      "How well have you slept this week?",
      "How well have you slept this week?",
    ]);
  });
});
