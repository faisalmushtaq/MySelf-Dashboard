import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { RESEARCHER, STRANGER, signIn, signOut } from "./support";

/**
 * The research journey the brief sets out, end to end, against the emulators:
 *
 *  1. an authorised researcher signs in
 *  2. the Overview loads
 *  3. they filter to incomplete sessions
 *  4. open a session
 *  5. inspect answers in the survey version that session actually used
 *  6. move to the next session in the filtered list
 *  7. add a review flag and a note
 *  8. return to the table at the position they left it
 *  9. export the filtered dataset
 * 10. the export was authorised and is in the audit log
 * 11. an unauthorised account is denied
 */
test("a researcher reviews incomplete sessions and exports them; a stranger is denied", async ({ page }) => {
  // 1. Sign in.
  await signIn(page, RESEARCHER);

  // 2. The Overview loads with real figures.
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Completion rate", { exact: true })).toBeVisible();
  const incompleteCard = page.locator(".metric", { has: page.getByText("Incomplete", { exact: true }) });
  const incompleteCount = Number(await incompleteCard.locator(".metric-value").innerText());
  expect(incompleteCount).toBeGreaterThan(1);
  await expect(page.getByRole("img", { name: /Sessions started and completed/ })).toBeVisible();

  // 3. Filter to incomplete sessions (from the metric, which carries the filter).
  await incompleteCard.getByRole("link", { name: /Open the sessions counted in Incomplete/ }).click();
  await expect(page).toHaveURL(/\/sessions\?.*st=incomplete/);
  await expect(page.getByText("Status: incomplete")).toBeVisible();
  await expect(page.locator(".result-count")).toContainText(`${incompleteCount} session`);
  const rows = page.locator("tbody tr[data-row]");
  await expect(rows).toHaveCount(incompleteCount);
  await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
  // Sort by completion ascending so the order is something the researcher chose.
  await page.getByRole("button", { name: /Sort by Completion/ }).click();
  await page.getByRole("button", { name: /Sort by Completion, currently descending/ }).click();
  await expect(page).toHaveURL(/sort=completion&dir=asc|dir=asc&.*sort=completion|sort=completion.*dir=asc/);
  // The list keeps the previous rows on screen (dimmed) while a new sort loads;
  // read the rows only once the sorted result has arrived.
  await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("button", { name: /Sort by Completion, currently ascending/ })).toBeVisible();
  const firstId = await rows.first().getAttribute("data-row");
  const secondId = await rows.nth(1).getAttribute("data-row");
  const firstVersion = (await rows.first().locator("td").nth(4).innerText()).trim();

  // 4. Open the first session.
  await rows.first().click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${firstId}`));
  await expect(page.locator(".detail-nav .position")).toHaveText(`Session 1 of ${incompleteCount}`);

  // 5. Answers are shown in the wording of the version this session used.
  const answersHeading = page.getByRole("heading", { name: /Answers — survey v/ });
  await expect(answersHeading).toContainText(firstVersion);
  const quality = page.locator("#q-demo_sleep\\.sleep_quality .answer-text");
  await expect(quality).toHaveText(firstVersion === "v1.0.0" ? "How well did you sleep last night?" : "How well have you slept this week?");
  // Identifying answers never reach the browser.
  await expect(page.locator("#q-demo_about\\.first_name")).toContainText("Withheld — identifying");
  // Missing required answers are marked and reachable.
  await page.getByRole("button", { name: /Next missing answer/ }).click();
  await expect(page.locator(".answer.is-missing:focus")).toHaveCount(1);

  // 6. Next follows the filtered, sorted list.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${secondId}`));
  await expect(page.locator(".detail-nav .position")).toHaveText(`Session 2 of ${incompleteCount}`);

  // 7. Add a flag and a note.
  await page.getByLabel("Flag reason").selectOption({ label: "Inconsistent answers" });
  await page.getByLabel(/^Note \(optional/).fill("Answers to the wellbeing items contradict each other.");
  await page.getByRole("button", { name: "Add flag" }).click();
  await expect(page.locator(".flags")).toContainText("Inconsistent answers");
  await expect(page.locator(".flags")).toContainText("contradict each other");
  await expect(page.locator(".detail-sub .badge").first()).toContainText("Needs review");
  await page.getByLabel("Add a note").fill("Checked with the site lead: keep in the dataset.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.locator(".notes")).toContainText("Checked with the site lead");

  // 8. Back to results: same filters and sort, and the current row is focused.
  await page.getByRole("button", { name: "Back to results" }).click();
  await expect(page).toHaveURL(/\/sessions\?/);
  await expect(page).toHaveURL(/st=incomplete/);
  await expect(page).toHaveURL(/sort=completion/);
  await expect(page.getByText("Status: incomplete")).toBeVisible();
  await expect(page.locator(`tr[data-row="${secondId}"]`)).toBeFocused();
  await expect(page.locator(`tr[data-row="${secondId}"]`)).toContainText("1");

  // 9. Export the filtered dataset. BIDS, with identifiers for linkage, is the default.
  await page.getByRole("button", { name: "Export filtered" }).click();
  const dialog = page.getByRole("dialog", { name: "Export data" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/BIDS dataset/)).toBeChecked();
  await expect(dialog.getByLabel(/Include identifiers for linkage/)).toBeChecked();
  const preview = dialog.locator(".export-preview");
  await expect(preview).toContainText(`${incompleteCount} — current filtered sessions`);
  await expect(preview).toContainText("Status: incomplete");
  await expect(preview).toContainText("Participant codes, study codes, sitting and device IDs, exact times");
  await expect(preview).toContainText(/myself_sessions-filtered_all-time_bids_created-\d{8}-\d{4}\.zip/);
  await dialog.getByLabel(/I will store and share this file only/).check();
  await dialog.getByRole("button", { name: "Generate export" }).click();
  await expect(dialog.getByText(/is ready/)).toBeVisible({ timeout: 60_000 });
  const [bids] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download" }).click()]);
  expect(bids.suggestedFilename()).toMatch(/^myself_sessions-filtered_.*_bids_.*\.zip$/);
  // Stored (uncompressed) zip entries: file names and contents are readable in the bytes.
  const zip = readFileSync((await bids.path())!).toString("latin1");
  expect(zip.startsWith("PK")).toBe(true);
  for (const f of ["dataset_description.json", "participants.tsv", "README.md", "linkage.tsv", "export_manifest.json", "phenotype/demo_sleep.tsv"]) expect(zip).toContain(f);
  expect(zip).toContain("participant_code\tstudy_code");
  expect(zip).toMatch(/sub-[A-Z]{2}[0-9]{3}[A-Z]{2}/);
  // Names and secret-code answers never leave: the identity items are not in the data.
  expect(zip).not.toContain("ps_mother_initials");
  expect(zip).not.toContain("first_name\t");
  await page.keyboard.press("Escape");

  // …and a de-identified CSV is one click away, with no identifier in it.
  await page.getByRole("button", { name: "Export filtered" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("CSV", { exact: true }).check();
  await dialog.getByLabel(/Include identifiers for linkage/).uncheck();
  await dialog.getByLabel(/Include answers/).check();
  await expect(preview).toContainText("None (de-identified)");
  await expect(preview).toContainText(/myself_sessions-filtered_all-time_deidentified_created-\d{8}-\d{4}\.csv/);
  await dialog.getByLabel(/I will store and share this file only/).check();
  await dialog.getByRole("button", { name: "Generate export" }).click();
  await expect(dialog.getByText(/is ready/)).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^myself_sessions-filtered_.*\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8");
  // A BOM so Excel reads UTF-8 (String.trim would strip it, so check first).
  expect(csv.startsWith("\uFEFFsession_id,participant_label,wave,")).toBe(true);
  const lines = csv.trim().split(/\r?\n/);
  expect(lines).toHaveLength(incompleteCount + 1);
  expect(csv).not.toContain("first_name");
  expect(csv).not.toContain("study_code");
  expect(csv).not.toContain("participant_code");
  await page.keyboard.press("Escape");

  // 10. The export (and its download) are in the researcher's audit trail.
  await page.getByRole("link", { name: "My activity" }).click();
  await expect(page.getByRole("heading", { name: "My activity" })).toBeVisible();
  const log = page.locator("table.data");
  await expect(log).toContainText("Created an export");
  await expect(log).toContainText("Downloaded an export");
  await expect(log).toContainText("Changed a review");
  await expect(log).toContainText("Added a note");
  await expect(log).toContainText("Viewed a session");

  // 11. An unauthorised Google account is denied, and sees no study data.
  await signOut(page);
  await signIn(page, STRANGER);
  await expect(page.getByRole("heading", { name: /Access not granted/ })).toBeVisible();
  await expect(page.getByText(/not an approved BrainPOP Research account/)).toBeVisible();
  await page.goto("/sessions");
  await expect(page.getByRole("heading", { name: /Access not granted/ })).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
});
