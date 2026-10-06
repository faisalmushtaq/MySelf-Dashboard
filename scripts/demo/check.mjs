#!/usr/bin/env node
/**
 * Open the built demo (apps/web/dist-demo, served at DEMO_URL) in a browser and
 * visit every page, failing on any page error, console error or failed call.
 * Survey versions is checked more closely: Studio's history, the links to
 * Studio, each survey's participant link, no editing controls, and its three
 * downloads. Then the survey filter, and the second study space (docs/12):
 * switched to, every page visited in it, and back.
 * DEMO_SHOTS=<folder> keeps a screenshot of each page.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const URL_ = process.env.DEMO_URL ?? "http://127.0.0.1:4280/demo/index.html";
const SHOTS = process.env.DEMO_SHOTS;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
// A missing file is reported below with its address; the console's copy has none.
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));
page.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/favicon.ico") && problems.push(`HTTP ${r.status()}: ${r.url()}`));

const routes = ["overview", "sessions", "sessions?st=incomplete", "completeness", "questions", "codebook", "figures", "scores", "participants", "reports", "views", "audit", "settings", "settings/scoring", "help", "survey"];
let n = 0;
async function visit(route, where = "") {
  await page.goto(`${URL_}#/${route}`);
  await page.waitForTimeout(1500);
  const heading = await page.locator("main h1").first().textContent({ timeout: 10_000 }).catch(() => "(no heading)");
  const alerts = (await page.locator("[role=alert], .notice-error, .state-error").allTextContents()).filter((t) => t.trim());
  console.log(`${`${where}${route}`.padEnd(24)} ${heading?.trim()}${alerts.length ? `  ALERT: ${alerts.join(" | ").slice(0, 200)}` : ""}`);
  if (alerts.length) problems.push(`${where}${route}: ${alerts.join(" | ").slice(0, 200)}`);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-${`${where}${route}`.replace(/\W+/g, "_")}.png`, fullPage: true });
  }
}
for (const r of routes) await visit(r);

// Survey versions: MySelf Studio's history, read-only, the way to Studio, and its downloads.
await page.goto(`${URL_}#/survey`);
await page.locator(".versions-table").first().waitFor({ timeout: 10_000 }).catch((e) => problems.push(`survey versions: ${e.message}`));
// One "Edit in Studio" per survey, each on its own survey's page in Studio.
const studioLinks = page.getByRole("link", { name: /Edit in Studio/ });
const surveysShown = await studioLinks.count();
if (surveysShown !== 2) problems.push(`survey versions: ${surveysShown} surveys shown in YBM, not 2`);
for (let i = 0; i < surveysShown; i += 1) {
  const [href, target, rel] = await Promise.all(["href", "target", "rel"].map((a) => studioLinks.nth(i).getAttribute(a).catch(() => null)));
  if (!/^https:\/\/.+#\/surveys\/[a-z0-9_]+\/versions$/.test(href ?? "") || target !== "_blank" || rel !== "noopener noreferrer") problems.push(`survey versions: Edit in Studio is ${href} ${target} ${rel}`);
}
const versionRows = await page.locator(".versions-table tbody tr:not(.row-detail):not(.row-problem)").count();
for (const want of [
  "v9.0.0, live since", "Versions are edited, previewed and published in", "np.phone_wellbeing", "already live when Studio was set up", "made live again by", "MyStory needs the newer app on every iPad first", "Written by",
  // Each live survey's participant link, built as the survey builds it.
  "https://faisalmushtaq.github.io/MySelf/?study=ybm&survey=ybm_nd2026_standard", "https://faisalmushtaq.github.io/MySelf/?study=ybm&survey=ybm_mpmb_followup", "MyPhone MyBrain: follow-up",
]) {
  if ((await page.getByText(want, { exact: false }).count()) === 0) problems.push(`survey versions: "${want}" is not on the page`);
}
for (const name of [/publish/i, /make live/i, /draft/i, /roll ?back/i, /restore/i]) {
  if ((await page.getByRole("button", { name }).count()) > 0) problems.push(`survey versions: a button matching ${name} — the page should change nothing`);
}
const fetchDownload = async (button) => {
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 10_000 }), button.click()]);
  return { name: download.suggestedFilename(), text: readFileSync(await download.path(), "utf8") };
};
try {
  const manifest = await fetchDownload(page.getByRole("button", { name: /Manifest/ }).first());
  const csv = await fetchDownload(page.getByRole("button", { name: /Version history \(CSV\)/ }));
  const json = await fetchDownload(page.getByRole("button", { name: "JSON", exact: true }));
  const lines = csv.text.replace(/^﻿/, "").trim().split("\r\n");
  if (!/^\uFEFFversion,release_key,hash,engine_version,status,source,authors,publisher,/.test(csv.text)) problems.push("survey versions: the CSV does not start with its header");
  if (lines.length !== versionRows + 1) problems.push(`survey versions: the CSV has ${lines.length - 1} rows for ${versionRows} versions`);
  const parsed = JSON.parse(json.text);
  console.log(
    `survey versions          ${versionRows} versions; ${manifest.name} (${JSON.parse(manifest.text).hash.slice(0, 15)}…); ${csv.name} ${lines.length - 1} rows; ${json.name} live v${parsed.live[0]?.version}`,
  );
} catch (e) {
  problems.push(`survey versions downloads: ${e.message}`);
}
if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-survey-versions.png`, fullPage: true });

// The survey filter: every sitting of YBM, then the follow-up's alone.
const count = async () => Number(((await page.locator(".result-count strong").textContent({ timeout: 10_000 }).catch(() => "")) ?? "").replace(/\D/g, ""));
await page.goto(`${URL_}#/sessions`);
await page.waitForTimeout(1500);
const allSurveys = await count();
const surveyFilter = page.getByRole("combobox", { name: "Survey", exact: true });
await surveyFilter.selectOption({ label: "MyPhone MyBrain: follow-up" }).catch((e) => problems.push(`survey filter: ${e.message}`));
await page.waitForTimeout(1500);
const followUp = await count();
if (!page.url().includes("sv=ybm_mpmb_followup") || !(followUp > 0 && followUp < allSurveys)) problems.push(`survey filter: ${allSurveys} sittings in all, ${followUp} in the follow-up (${page.url()})`);
console.log(`survey filter            ${allSurveys} sittings, ${followUp} of them the follow-up's`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-survey-filter.png`, fullPage: true });

// The second study space: chosen in the header, every page visited in it, then back.
const studySwitcher = page.getByRole("combobox", { name: "Study", exact: true });
const studies = await studySwitcher.locator("option").allTextContents();
if (studies.length !== 2 || !studies.includes("Perspectives of the future")) problems.push(`study switcher: ${JSON.stringify(studies)}`);
await studySwitcher.selectOption({ label: "Perspectives of the future" }).catch((e) => problems.push(`study switcher: ${e.message}`));
await page.locator(".study-tag", { hasText: "Perspectives of the future" }).waitFor({ timeout: 10_000 }).catch(() => problems.push("study switcher: the future study did not open"));
for (const r of routes) await visit(r, "future: ");
await page.goto(`${URL_}#/survey`);
await page.waitForTimeout(1500);
if ((await page.getByText("https://faisalmushtaq.github.io/MySelf/?study=future&survey=future_perspectives", { exact: false }).count()) === 0) problems.push("future survey versions: its participant link is not on the page");
const futureStudio = await page.getByRole("link", { name: /Edit in Studio/ }).first().getAttribute("href").catch(() => null);
if (!futureStudio?.endsWith("#/study/future/surveys/future_perspectives/versions")) problems.push(`future survey versions: Edit in Studio is ${futureStudio}`);
await page.goto(`${URL_}#/sessions`);
await page.waitForTimeout(1500);
console.log(`future sessions          ${await count()} sittings`);
await studySwitcher.selectOption({ index: 0 }).catch((e) => problems.push(`study switcher back: ${e.message}`));
await page.locator(".study-tag", { hasNotText: "Perspectives of the future" }).waitFor({ timeout: 10_000 }).catch(() => problems.push("study switcher: YBM did not open again"));

// A session, then the next one, then a flag and a note.
await page.goto(`${URL_}#/sessions`);
await page.waitForTimeout(1200);
await page.locator("tbody tr[data-row]").first().click();
await page.waitForTimeout(1500);
console.log("session page:", (await page.locator(".detail-nav .position").textContent({ timeout: 10_000 }).catch(() => "no position"))?.trim());
await page.getByLabel("Flag reason").selectOption({ label: "Inconsistent answers" }).catch((e) => problems.push(`flag: ${e.message}`));
await page.getByRole("button", { name: "Add flag" }).click().catch((e) => problems.push(`flag: ${e.message}`));
await page.waitForTimeout(800);
console.log("flags:", (await page.locator(".flags").textContent().catch(() => "none"))?.trim().slice(0, 120));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-session.png`, fullPage: true });
await page.getByRole("button", { name: "Next", exact: true }).click().catch((e) => problems.push(`next: ${e.message}`));
await page.waitForTimeout(1200);
console.log("next:", (await page.locator(".detail-nav .position").textContent().catch(() => "no position"))?.trim());

console.log(problems.length ? `\n${problems.length} problems:\n${[...new Set(problems)].join("\n")}` : "\nno problems");
await browser.close();
process.exit(problems.length ? 1 : 0);
