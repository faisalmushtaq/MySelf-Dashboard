#!/usr/bin/env node
/**
 * The survey editor, end to end (docs/11), against the emulators seeded by
 * ./seed.mjs — run by ./check-editor.mjs (`pnpm demo:check-editor`).
 *
 * As the demo owner: open Survey versions, start a draft from v9.0.0, reword
 * the linkage question, check a licensed instrument is locked, approve a
 * MyStory protocol under a new version and end the survey with it, save, run
 * the publish checks, publish v10.0.0, then read the survey's database to see
 * that devices would get it (hash, MyStory last, protocol frozen) and the
 * registry kept its provenance; finally roll back to v9.0.0. Fails on any
 * wrong step, page error or unexpected dialog.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const BASE = process.env.DEMO_WEB ?? "http://127.0.0.1:4273";
const SHOTS = process.env.DEMO_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror ${e.message}`));
page.on("console", (m) => m.type() === "error" && problems.push(`console ${m.text().slice(0, 200)}`));
page.on("dialog", (d) => { problems.push(`dialog: ${d.message()}`); void d.dismiss(); });
let n = 0;
const shot = async (label) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-${label}.png`, fullPage: true }) : undefined);
const step = (s) => console.log("·", s);
const expect = (ok, what) => {
  if (!ok) {
    console.error(`FAILED: ${what}`);
    process.exit(1);
  }
};

await page.goto(BASE + "/");
await page.getByLabel("Emulated Google account").fill("demo.researcher@brainpop.example");
await page.getByRole("button", { name: "Sign in (emulator)" }).click();
await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 60_000 });
step("signed in");

await page.getByRole("link", { name: "Survey versions" }).click();
await page.getByRole("heading", { name: "Survey versions" }).waitFor();
await page.waitForTimeout(1500);
await shot("versions-before");
step("versions page: " + (await page.locator("table.data").last().locator("tbody tr").count()) + " rows");

await page.getByRole("button", { name: /New draft from v9\.0\.0/ }).click();
await page.getByRole("heading", { name: /Changes to v9\.0\.0/ }).waitFor({ timeout: 30_000 });
step("draft opened");
await shot("editor-open");

// Reword the linkage question (in the Welcome section).
const linkage = page.locator("li.question", { has: page.locator("code", { hasText: "ybm_intro_consent.linkage_consent" }) });
await linkage.getByLabel("Wording").fill("May we link your answers to your health and school records? It never shows who you are.");
await linkage.getByLabel("Wording").blur();
step("reworded linkage");

// A licensed instrument shows its lock.
await page.getByRole("button", { name: /Sleep/ }).first().click();
await page.waitForTimeout(500);
expect((await page.locator(".tag", { hasText: "licensed" }).count()) > 0, "a licensed instrument is shown locked");
step("licensed instrument shown locked");
await shot("sleep-locked");

// MyStory: take the first protocol, approve it under a new version, use it.
await page.getByRole("tab", { name: "MyStory" }).click();
const toml = page.locator("textarea.code");
expect(await toml.waitFor({ timeout: 8000 }).then(() => true, () => false), `the MyStory tab opens (${problems.join("; ")})`);
let text = await toml.inputValue();
text = text.replace(/approval_status = "[a-z_]+"/, 'approval_status = "approved"');
text = text.replace(/(\[myself\][\s\S]*?\nversion = ")([^"]+)"/, (_, a, v) => `${a}${v.replace(/(\d+)$/, (m) => String(Number(m) + 1))}"`);
await toml.fill(text);
await page.waitForTimeout(300);
const hint = await page.locator(".mystory .hint").last().textContent();
step("toml: " + hint?.slice(0, 160));
await page.getByRole("button", { name: /End this version with MyStory/ }).click();
await page.waitForTimeout(500);
const story = (await page.locator(".mystory .card p").first().textContent()) ?? "";
expect(story.includes("ends with MyStory"), "MyStory is added");
step("mystory: " + story.slice(0, 140));
await shot("mystory");

// Changes and publish.
await page.getByRole("tab", { name: /Changes and publish/ }).click();
step("heading: " + (await page.locator(".changes-panel h2").first().textContent()));
step("changes: " + (await page.locator(".changes-panel ul.changes li").allTextContents()).join(" | "));
await page.getByRole("button", { name: "Save the draft" }).click();
await page.waitForURL(/\/survey\/drafts\/(?!new)/, { timeout: 30_000 });
step("saved: " + page.url());
await page.getByRole("tab", { name: /Changes and publish/ }).click();
await page.getByRole("button", { name: /Run the publish checks/ }).click();
await page.locator(".ok-line, .changes-panel .notice-warn").first().waitFor({ timeout: 60_000 });
const checks = (await page.locator(".ok-line, .changes-panel .notice-warn").first().textContent()) ?? "";
expect(checks.includes("Passes every publish check"), `the publish checks pass: ${checks.slice(0, 300)}`);
step("checks: " + checks.slice(0, 120));
await shot("checked");
await page.getByRole("button", { name: /Publish v10\.0\.0…/ }).click();
await page.getByLabel(/Why this version/).fill("Clearer linkage wording; MyStory at the end (editor end-to-end test).");
await page.getByRole("button", { name: /Publish v10\.0\.0 to every iPad/ }).click();
await page.waitForURL(/\/survey\?published=/, { timeout: 90_000 });
await page.waitForTimeout(2000);
await shot("versions-after");
step("after publish: " + (await page.locator("section.card").first().textContent())?.slice(0, 200));

// What the survey's database now holds.
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8291";
const survey = getFirestore(initializeApp({ projectId: "demo-myself-dashboard" }));
const active = (await survey.doc("studies/ybm/config/activeRelease").get()).data();
expect(active?.version === "10.0.0", "devices are pointed at v10.0.0");
step("survey activeRelease: " + JSON.stringify(active));
const rel = (await survey.doc(`studies/ybm/releases/${active?.hash}`).get()).data();
const m = rel ? JSON.parse(rel.manifestJson) : null;
expect(m && m.hash === active.hash, "the survey database holds v10.0.0 under its hash");
expect(m.composition.sections.at(-1).key === "mystory" && Object.keys(m.narrativeProtocols).length === 1, "MyStory is the last section, with its protocol frozen");
step(`survey release doc: ${m.release.version}; last section ${m.composition.sections.at(-1).key}; protocol ${Object.keys(m.narrativeProtocols)}`);
const dash = getFirestore("dashboard");
const meta = (await dash.doc(`studies/ybm/releases/${active?.hash}`).get()).data();
expect(meta?.source === "editor" && meta?.baseVersion === "9.0.0" && meta?.changes?.length === 2 && meta?.notes, "the registry keeps the version's provenance");
step("dashboard registry: " + JSON.stringify({ version: meta?.version, source: meta?.source, base: meta?.baseVersion, bump: meta?.bump, changes: meta?.changes, notes: meta?.notes }));
const acts = await dash.collection("studies/ybm/releaseActivations").get();
step("activations: " + acts.size);

// Roll back to v9.0.0.
const row = page.locator("table.data tbody tr", { has: page.locator("strong", { hasText: "v9.0.0" }) });
await row.getByRole("button", { name: "Make active" }).click();
await page.getByLabel(/Why \(kept/).fill("Rollback check");
await page.getByRole("dialog").getByRole("button", { name: "Make active" }).click();
await page.waitForTimeout(3000);
const again = (await survey.doc("studies/ybm/config/activeRelease").get()).data();
expect(again?.version === "9.0.0", "rolling back points devices at v9.0.0 again");
step("after rollback: active " + again?.version);
await shot("versions-rollback");

expect(problems.length === 0, `no page errors or dialogs: ${problems.join("; ")}`);
console.log("the survey editor works end to end");
await browser.close();
process.exit(0);
