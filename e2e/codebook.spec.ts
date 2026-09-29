import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { REVIEWER, signIn } from "./support";

test("any member reads the codebook: readable names, what each answer scores, and the quality review", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, REVIEWER);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Codebook" }).click();
  await expect(page.getByRole("heading", { name: "Codebook", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quality review" })).toBeVisible();

  // The review names what needs a decision, with its evidence.
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^Warnings/ }).click();
  const sdqForm = page.locator(".finding", { hasText: "SDQ items 19, 20 and 22 use the adult (18+) wording" });
  await expect(sdqForm).toContainText("Needs a decision");
  await expect(sdqForm).toContainText("youthinmind");

  // A question under its readable name, with its survey variable and what each answer scores.
  await page.getByRole("searchbox", { name: "Find" }).fill("unhappy");
  const table = page.getByRole("table", { name: /Questions in survey version/ });
  const row = table.locator("tbody > tr:not(.subrow)").first();
  await expect(row).toContainText("sdq_13_unhappy");
  await expect(row).toContainText("SDQ 13: Often unhappy, down-hearted or tearful");
  await expect(row).toContainText("SDQ: Emotional symptoms");
  await row.getByRole("button", { name: "sdq_13_unhappy" }).click();
  const codes = page.getByRole("table", { name: "Codes, labels and scores for sdq_13_unhappy" });
  await expect(codes.locator("tbody tr", { hasText: "Certainly True" })).toContainText("2");
  await expect(page.locator("tr.subrow")).toContainText("sdq25_q13");

  // The same codebook as a spreadsheet.
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Codebook (CSV)" }).click()]);
  expect(csv.suggestedFilename()).toMatch(/^myself_codebook_r[\d.]+\.csv$/);
  const text = readFileSync((await csv.path())!, "utf8");
  expect(text.split("\n")[0]).toContain("name,label,question_key,survey_variable,qualtrics_variable");
  expect(text).toContain("sdq_13_unhappy");

  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} — ${v.help}`)).toEqual([]);
});
