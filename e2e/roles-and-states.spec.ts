import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN, RESEARCHER, REVIEWER, signIn } from "./support";

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
  // Participants: labels, never codes.
  await page.getByRole("link", { name: "Participants" }).click();
  await expect(page.getByText("Your role sees labels (P0001, P0002…) instead of participant codes.")).toBeVisible();
  await expect(page.locator("table.participants tbody th").first()).toContainText("P0001");
  // Neither a secret code nor an ID derived from name and date of birth (D-52),
  // in any cell. Cell by cell: the table's text runs its cells together, and a
  // label, two counts and a site can spell something ID-shaped by accident.
  const cells = await page.locator("table.participants th, table.participants td").allTextContents();
  expect(cells.length).toBeGreaterThan(0);
  expect(cells.filter((c) => /[A-Z]{2}[0-9]{3}[A-Z]{2}|\bP[0-9A-HJKMNP-TV-Z]{10}\b/.test(c))).toEqual([]);
  // Survey versions: a record of what MySelf Studio published, never a way to change it.
  await page.getByRole("link", { name: "Survey versions" }).click();
  await expect(page.getByText("The version built into the app.")).toBeVisible();
  await expect(page.locator(".versions-table tbody tr")).toHaveCount(3);
  await expect(page.locator(".versions-table")).toContainText("From the repository");
  await expect(page.getByRole("link", { name: /Edit in Studio/ })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByRole("button", { name: /publish|make live|draft|roll ?back|restore/i })).toHaveCount(0);
});

test("a researcher follows participants across waves and sees what the linkage could not settle", async ({ page }) => {
  await signIn(page, RESEARCHER);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Participants" }).click();
  await expect(page.getByRole("heading", { name: "Participants", level: 1 })).toBeVisible();
  // The twins sharing a code are called out, and held-back sittings are listed.
  await expect(page.getByText("One code is shared by more than one child — almost certainly twins.")).toBeVisible();
  await expect(page.getByText(/Held-back sittings \(\d+\)/)).toBeVisible();
  // Participants followed up at a second wave, and their sittings.
  await page.getByLabel("Waves").selectOption("several");
  const first = page.locator("table.participants tbody tr").first();
  await expect(first.locator("th")).toContainText(/[A-Z]{2}[0-9]{3}[A-Z]{2}/);
  await first.getByRole("button").click();
  const sittings = page.locator("tr.subrow tbody tr");
  await expect(sittings).toHaveCount(2);
  await expect(sittings.nth(1)).toContainText(/\d+ days?|same day/);
  // A code typed into the search box stays out of the address bar.
  const code = (await first.locator("th code").textContent())!;
  await page.getByLabel("Find").fill(code);
  await expect(page.locator("table.participants > tbody > tr:not(.subrow)")).toHaveCount(1);
  expect(page.url()).not.toContain(code);
  await sittings.nth(0).getByRole("link", { name: /Open session/ }).click();
  await expect(page.getByRole("heading", { name: /Answers — survey v/ })).toBeVisible();
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
  await expect(page.getByRole("region", { name: "Key figures" }).getByText("All required answered", { exact: true })).toBeVisible();
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
  await page.getByRole("link", { name: "Participants" }).click();
  await page.locator("table.participants tbody tr").first().getByRole("button").click();
  await expect(page.locator("tr.subrow")).toBeVisible();
  await page.getByText(/Held-back sittings/).click();
  await check("participants");
  await page.getByRole("link", { name: "Survey versions" }).click();
  await expect(page.locator(".versions-table")).toBeVisible();
  await check("survey versions");
});
