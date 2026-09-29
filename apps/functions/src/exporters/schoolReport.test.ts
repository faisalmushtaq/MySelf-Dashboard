import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSchoolReportView, DEFAULT_GROUP_SETTINGS, DEFAULT_SCHEMES, RULES_VERSION } from "@myself-dashboard/core";
import { demoReleases, generateDemoSittings } from "@myself-dashboard/core/node";
import { deriveStudyDataset, parseSurveyManifest, scoreStudy } from "@myself-dashboard/core/survey";
import { describe, expect, it } from "vitest";
import { pdfPages, pdfText } from "../../test/pdfText.js";
import { schoolReportPdf } from "./schoolReport.js";

const demo = demoReleases();
const manifests = new Map(demo.map((r) => {
  const p = parseSurveyManifest(r.manifest);
  if ("error" in p) throw new Error(p.error);
  return [r.index.hash, p.manifest] as const;
}));
const sittings = generateDemoSittings().map((d) => ({ ...d.doc, events: d.doc.events ?? [] }));
const study = deriveStudyDataset({ study: "demo", sittings, manifests });
const scored = scoreStudy(study, { schemes: DEFAULT_SCHEMES, releases: new Map(demo.map((r) => [r.index.hash, r.index])), groups: DEFAULT_GROUP_SETTINGS }).filter((s) => s.school !== "TST");
const settings = { ...DEFAULT_GROUP_SETTINGS, minCell: 5, schools: { NDC: "Northdale College" } };
const base = { period: "All time", filters: [], timeZone: "Europe/London", rulesVersion: RULES_VERSION, requiredLevels: ["hard"], abandonAfterHours: 24, versionLabel: (h: string) => h };
const now = new Date("2026-09-29T10:00:00Z");

function keep(name: string, body: Buffer) {
  const dir = process.env["PDF_OUT"];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}

describe("school report", () => {
  it("compares the school with the other schools combined and the benchmarks, naming no other school", async () => {
    const view = buildSchoolReportView(scored, { schemes: DEFAULT_SCHEMES, settings, observation: "latest", school: "NDC", yearGroup: null, now });
    expect(view.comparisonsShown).toBe(true);
    const pdf = await schoolReportPdf({ view, figureBase: base, generatedBy: "owner@example.org", generatedAt: now, timeZone: "Europe/London", period: "All time", filters: [] });
    keep("school-ndc.pdf", pdf);
    const text = pdfText(pdf);
    expect(pdfPages(pdf)).toBeGreaterThanOrEqual(2);
    for (const s of ["School report", "Northdale College", "How to read this report", "At a glance", "Other schools", "British norms, 11–15", "not a diagnosis"]) expect(text).toContain(s);
    // Other schools are never named, and no participant identifier appears.
    expect(text).not.toMatch(/\bBRD\b|\bLDS\b/);
    expect(text).not.toMatch(/[A-Z]{2}[0-9]{3}[A-Z]{2}/);
  });

  it("withholds groups below the minimum size, and other-school comparisons when fewer than two other schools took part", async () => {
    const strict = buildSchoolReportView(scored, { schemes: DEFAULT_SCHEMES, settings: { ...settings, minCell: 50 }, observation: "latest", school: "NDC", yearGroup: null, now });
    expect(strict.rows.every((r) => r.withheld && r.school === null)).toBe(true);
    const pdf = await schoolReportPdf({ view: strict, figureBase: base, generatedBy: "a@example.org", generatedAt: now, timeZone: "Europe/London", period: "All time", filters: [] });
    expect(pdfText(pdf)).toContain("No measure had scores for at least 50 pupils.");

    const two = buildSchoolReportView(scored.filter((s) => s.school !== "LDS"), { schemes: DEFAULT_SCHEMES, settings, observation: "latest", school: "NDC", yearGroup: null, now });
    expect(two.comparisonsShown).toBe(false);
    expect(two.rows.every((r) => r.others === null && r.all === null)).toBe(true);
  });

  it("reports one year group against the same year group elsewhere", async () => {
    const view = buildSchoolReportView(scored, { schemes: DEFAULT_SCHEMES, settings: { ...settings, minCell: 3 }, observation: "latest", school: "NDC", yearGroup: 7, now });
    expect(view.label).toBe("Northdale College, Year 7");
    expect(view.othersLabel).toBe("Year 7, other schools");
    const pdf = await schoolReportPdf({ view, figureBase: base, generatedBy: "a@example.org", generatedAt: now, timeZone: "Europe/London", period: "All time", filters: [] });
    keep("school-ndc-y7.pdf", pdf);
    expect(pdfText(pdf)).toContain("Year 7, other schools");
  });
});
