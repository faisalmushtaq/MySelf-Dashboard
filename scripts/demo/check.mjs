#!/usr/bin/env node
/**
 * Open the built demo (apps/web/dist-demo, served at DEMO_URL) in a browser and
 * visit every page, failing on any page error, console error or failed call.
 * DEMO_SHOTS=<folder> keeps a screenshot of each page.
 */
import { mkdirSync } from "node:fs";
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
async function visit(route) {
  await page.goto(`${URL_}#/${route}`);
  await page.waitForTimeout(1500);
  const heading = await page.locator("main h1").first().textContent({ timeout: 10_000 }).catch(() => "(no heading)");
  const alerts = (await page.locator("[role=alert], .notice-error, .state-error").allTextContents()).filter((t) => t.trim());
  console.log(`${route.padEnd(24)} ${heading?.trim()}${alerts.length ? `  ALERT: ${alerts.join(" | ").slice(0, 200)}` : ""}`);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-${route.replace(/\W+/g, "_")}.png`, fullPage: true });
  }
}
for (const r of routes) await visit(r);

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

// The survey editor: a draft from the newest version opens, and a change registers.
await page.goto(`${URL_}#/survey`);
await page.getByRole("button", { name: /New draft from v/ }).click();
await page.getByRole("heading", { name: /Changes to v/ }).waitFor({ timeout: 20_000 }).catch((e) => problems.push(`editor: ${e.message}`));
const wording = page.locator("li.question").filter({ has: page.locator("code", { hasText: "ybm_intro_consent.linkage_consent" }) }).getByLabel("Wording");
await wording.fill("May we link your answers to your health and school records?").catch((e) => problems.push(`editor: ${e.message}`));
await wording.blur().catch(() => {});
await page.getByRole("tab", { name: /Changes and publish/ }).click().catch((e) => problems.push(`editor: ${e.message}`));
console.log("editor:", (await page.locator(".changes-panel h2").first().textContent().catch(() => "no changes panel"))?.trim());
if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-editor.png`, fullPage: true });

console.log(problems.length ? `\n${problems.length} problems:\n${[...new Set(problems)].join("\n")}` : "\nno problems");
await browser.close();
process.exit(problems.length ? 1 : 0);
