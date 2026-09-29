import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN, RESEARCHER, REVIEWER, signIn, signOut } from "./support";

test("a researcher reads scores against thresholds and benchmarks, and makes a school report", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, RESEARCHER);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Scores", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Scores", level: 1 })).toBeVisible();
  await page.getByLabel("Instrument").selectOption("sdq25_s");

  // The scheme says how it scores and that its cut-points are not yet verified.
  const scheme = page.locator(".scheme-card");
  await expect(scheme).toContainText("youthinmind scoring");
  await expect(scheme).toContainText("Official method");
  await expect(scheme).toContainText("Not yet verified against the scoring documents");

  // Total difficulties first: statistics, bands against expected shares, distance from British norms, and the chart.
  const total = page.locator(".output-card").first();
  await expect(total.getByRole("heading", { name: "Total difficulties" })).toBeVisible();
  await expect(total).toContainText("Mean (95% CI)");
  await expect(total).toContainText("(expected 80%)");
  await expect(total).toContainText(/SD (above|below) British norms, 11–15 \(mean 10\.3, SD 5\.2\)/);
  await expect(total.locator(".paper svg")).toBeVisible();

  // Focus on one school: its difference from the others, and a report to share with it.
  await page.getByLabel("Focus on school").selectOption("NDC");
  await expect(total).toContainText(/NDC:.*points (above|below) other schools/);
  await page.getByRole("button", { name: /School report for NDC/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Written to be shared with the school")).toBeVisible();
  await dialog.getByRole("button", { name: "Generate export" }).click();
  await expect(dialog.getByText(/is ready/)).toBeVisible({ timeout: 60_000 });
  const [pdf] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download" }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/^myself_school-report-ndc_.*\.pdf$/);
  expect(readFileSync((await pdf.path())!).subarray(0, 5).toString()).toBe("%PDF-");
});

test("an administrator changes a threshold as a new, audited version; a reviewer can only read", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/settings/scoring");
  await expect(page.getByRole("heading", { name: "Scoring", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Open the Karolinska Sleepiness Scale scheme" }).click();
  const editor = page.locator(".scheme-editor");
  await editor.getByLabel("Band 1 upper limit").fill("5");
  await editor.getByLabel("Why (kept with the version)").fill("Our protocol treats 6 as sleepy");
  await editor.getByRole("button", { name: "Preview the effect" }).click();
  await expect(editor.getByText("With this draft")).toBeVisible();
  await editor.getByRole("button", { name: "Save v1.1.0" }).click();
  await expect(page.getByRole("status").getByText(/^Saved kss v1.1.0./)).toBeVisible();
  await expect(page.locator("tr", { hasText: "KSS" })).toContainText("v1.1.0");
  await page.getByRole("link", { name: "Audit activity" }).click();
  await expect(page.locator("table.data")).toContainText("Changed a scoring scheme");

  await signOut(page);
  await signIn(page, REVIEWER);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/settings/scoring");
  await expect(page.getByText("Read-only: scoring is changed by dashboard administrators.")).toBeVisible();
  await page.getByRole("button", { name: "Open the Strengths and Difficulties Questionnaire (self-report) scheme" }).click();
  await expect(page.locator(".scheme-editor").getByRole("button", { name: /^Save/ })).toHaveCount(0);
});

test("the scores and scoring screens have no serious accessibility violations", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  const check = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${label}: ${v.id} — ${v.help} (${v.nodes.length})`)).toEqual([]);
  };
  await page.getByRole("link", { name: "Scores", exact: true }).click();
  await expect(page.locator(".output-card .paper svg").first()).toBeVisible();
  await page.getByLabel("Show tables").check();
  await check("scores");
  await page.goto("/settings/scoring");
  await page.getByRole("button", { name: "Open the Short Warwick–Edinburgh Mental Wellbeing Scale scheme" }).click();
  await expect(page.locator(".scheme-editor")).toBeVisible();
  await check("scoring settings");
});
