import { expect, test, type Page } from "@playwright/test";
import { ADMIN, RESEARCHER, REVIEWER, signIn } from "./support";

/**
 * Study spaces and surveys (docs/12), in the browser: the seed's second study,
 * "pilot", has two surveys with 6 and 4 sittings; the researcher is on its list
 * and the reviewer is not (scripts/emulator-setup.mjs).
 */

const study = (page: Page) => page.getByRole("combobox", { name: "Study", exact: true });
const survey = (page: Page) => page.getByRole("combobox", { name: "Survey", exact: true });

test("a researcher switches to another study they may see, filters it by survey, and finds its participant links", async ({ page }) => {
  await signIn(page, RESEARCHER);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  // Their studies, from the server: the default and the one that lists them.
  await expect(study(page).locator("option")).toHaveText([/.+/, "Pilot of the new questions"]);
  await study(page).selectOption({ label: "Pilot of the new questions" });
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.locator(".study-tag")).toHaveText("Study: Pilot of the new questions");

  // Every sitting of the study; then one survey's, and the versions list follows it.
  await page.getByRole("link", { name: "Sessions", exact: true }).click();
  await expect(page.locator(".result-count")).toContainText("10 sessions");
  await expect(survey(page).locator("option")).toHaveText(["All surveys", "Pilot: extra questions", "Pilot: main questionnaire"]);
  await survey(page).selectOption({ label: "Pilot: extra questions" });
  await expect(page).toHaveURL(/sv=pilot_extra/);
  await expect(page.locator(".result-count")).toContainText("4 sessions");
  await expect(page.getByText("Survey: Pilot: extra questions")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Survey version" }).locator("option")).toHaveText(["All survey versions", /^v1\.0\.0/, "Unknown version"]);

  // Survey versions: a section per survey, each with its participant link.
  await page.getByRole("link", { name: "Survey versions" }).click();
  await expect(page.getByText("https://faisalmushtaq.github.io/MySelf/?study=pilot&survey=pilot_main")).toBeVisible();
  await expect(page.getByText("https://faisalmushtaq.github.io/MySelf/?study=pilot&survey=pilot_extra")).toBeVisible();
  await expect(page.getByRole("link", { name: /Edit in Studio/ })).toHaveCount(2);

  // Remembered for them: a reload stays in the pilot study.
  await page.reload();
  await expect(page.locator(".study-tag")).toHaveText("Study: Pilot of the new questions");
  await study(page).selectOption({ index: 0 });
  await expect(page.locator(".study-tag")).not.toHaveText("Study: Pilot of the new questions");
});

test("a reviewer who is on no other study's list has nothing to switch to", async ({ page }) => {
  await signIn(page, REVIEWER);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(study(page)).toHaveCount(0);
});

test("an administrator sees who may see each study, and a public mail domain is refused", async ({ page }) => {
  await signIn(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  const access = page.getByRole("region", { name: "Study access" });
  await expect(access).toContainText("The default study: everyone on the dashboard's access list who holds a role.");
  const pilot = access.locator("fieldset", { hasText: "Pilot of the new questions" });
  await expect(pilot.getByLabel(/People who may see it/)).toHaveValue(RESEARCHER);
  await pilot.getByLabel("Google Workspace domains").fill("gmail.com");
  await pilot.getByRole("button", { name: /Save who may see/ }).click();
  await expect(pilot).toContainText("gmail.com is a public mail service");
  // The people table says who sees what.
  await expect(page.locator("tr", { hasText: RESEARCHER })).toContainText("Pilot of the new questions");
});
