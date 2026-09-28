import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN, REVIEWER, signIn } from "./support";

test("a read-only reviewer sees data but cannot change reviews or export session data", async ({ page }) => {
  await signIn(page, REVIEWER);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  // Navigation shows only what the role may use.
  await expect(page.getByRole("link", { name: "My activity" })).toBeVisible();
  await page.getByRole("link", { name: "Sessions", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export filtered" })).toHaveCount(0);
  // Study codes are masked.
  await expect(page.locator("tbody tr[data-row]").first()).toContainText("••");
  await page.locator("tbody tr[data-row]").first().click();
  await expect(page.getByText("Your role can read reviews but not change them.")).toBeVisible();
  await expect(page.getByLabel("Review status")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add flag" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add note" })).toHaveCount(0);
  // Free text is withheld for this role.
  await expect(page.locator("#q-demo_finish\\.future_message")).toContainText(/Free text — not shown for your role|—/);
  // Reports: session-level export is not offered.
  await page.getByRole("link", { name: "Reports and exports" }).click();
  await expect(page.locator(".report-card", { hasText: "Session data" })).toContainText("Not available for your role");
});

test("an administrator sees the audit log, access settings and filter-empty states", async ({ page }) => {
  await signIn(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Audit activity" }).click();
  await expect(page.getByRole("heading", { name: "Audit activity" })).toBeVisible();
  await expect(page.locator("table.data")).toContainText("Signed in");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Access" })).toBeVisible();
  await expect(page.getByText("stranger@gmail.com")).toBeVisible();
  // No results for a filter combination: explained, with a way out.
  await page.goto("/sessions?cmin=100&cmax=100&st=abandoned");
  await expect(page.getByRole("heading", { name: "No sessions match these filters" })).toBeVisible();
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(page.locator("tbody tr[data-row]").first()).toBeVisible();
});

test("the main screens have no serious accessibility violations (axe, WCAG 2.1 AA)", async ({ page }) => {
  await signIn(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Completion rate", { exact: true })).toBeVisible();
  const check = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${label}: ${v.id} — ${v.help} (${v.nodes.length})`)).toEqual([]);
  };
  await check("overview");
  await page.getByRole("link", { name: "Sessions", exact: true }).click();
  await expect(page.locator("tbody tr[data-row]").first()).toBeVisible();
  await check("sessions");
  await page.locator("tbody tr[data-row]").first().click();
  await expect(page.getByRole("heading", { name: /Answers — survey v/ })).toBeVisible();
  await check("session");
  await page.getByRole("link", { name: "Questions" }).click();
  await expect(page.locator("table.questions-table")).toBeVisible();
  await check("questions");
  await page.getByRole("link", { name: "Figures" }).click();
  await expect(page.locator(".paper svg")).toBeVisible();
  await page.getByText("Source data: the numbers drawn in each panel").click();
  await check("figures");
});
