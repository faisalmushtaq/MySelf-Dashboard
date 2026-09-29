import { copyFileSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { RESEARCHER, signIn } from "./support";

/**
 * Publication figures: a researcher builds a figure, changes its layout, and
 * downloads it in every format. Each file is opened and checked — right
 * physical size, right resolution, vector text in the PDF — and every
 * download is in their audit trail.
 */

async function download(page: Page, button: RegExp | string): Promise<{ name: string; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: button, exact: typeof button === "string" }).click()]);
  const path = (await d.path())!;
  // FIGURE_OUT keeps copies for a person to look at; the test never needs it.
  if (process.env["FIGURE_OUT"]) copyFileSync(path, `${process.env["FIGURE_OUT"]}/${d.suggestedFilename()}`);
  return { name: d.suggestedFilename(), bytes: readFileSync(path) };
}

function pngSize(png: Buffer) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function pngDpi(png: Buffer): number | null {
  const at = png.indexOf("pHYs");
  return at < 0 ? null : Math.round(png.readUInt32BE(at + 4) * 0.0254);
}

test("a researcher builds a publication figure and downloads it in every format", async ({ page }) => {
  await signIn(page, RESEARCHER);
  await page.getByRole("link", { name: "Figures" }).click();
  await expect(page.getByRole("heading", { name: "Figures", level: 1 })).toBeVisible();

  // The default figure: four lettered panels at double-column width.
  const paper = page.locator(".paper");
  await expect(paper.locator("svg")).toHaveAttribute("width", "183mm");
  await expect(paper.locator("svg text[font-weight=bold]")).toHaveText(["a", "b", "c", "d"]);
  const legend = page.locator(".figure-legend");
  await expect(legend).toContainText(/^Fig\. 1 \| Participation and data completeness in the MySelf study\. a, /);
  await expect(legend).toContainText("95% confidence interval (Wilson score)");
  await expect(paper).toHaveAttribute("aria-label", /Panel a: /);

  // Single column, greyscale, and a question panel added.
  await page.getByLabel("Single column (89 mm)").check();
  await page.getByLabel("Greyscale").check();
  await page.getByLabel("Add a panel").selectOption({ label: "Answers to one question" });
  const lastPanel = page.locator(".panel-item").last();
  await lastPanel.getByRole("combobox", { name: /^Question/ }).selectOption({ index: 1 });
  await expect(paper.locator("svg")).toHaveAttribute("width", "89mm");
  await expect(paper.locator("svg text[font-weight=bold]")).toHaveText(["a", "b", "c", "d", "e"]);
  await expect(legend).toContainText(/e, Answers to “/);
  await expect(page.locator(".paper-scroll")).toHaveAttribute("aria-busy", "false");
  // Greyscale really is grey: no Okabe–Ito blue left in the figure.
  expect(await paper.innerHTML()).not.toContain("#0072B2");

  // Vector PDF: one page, 89 mm wide, text set in Helvetica (not outlines).
  const pdf = await download(page, /PDF \(vector\)/);
  expect(pdf.name).toMatch(/^myself_fig1_single-column_\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdfText = pdf.bytes.toString("latin1");
  expect(pdfText.startsWith("%PDF-")).toBe(true);
  expect(pdfText).toContain("/BaseFont /Helvetica");
  expect(pdfText).toMatch(/\/MediaBox \[0 0 252\.28/);
  expect(pdfText.match(/\/Type \/Page\b/g)).toHaveLength(1);

  // SVG: the same figure, text live.
  const svg = await download(page, "SVG (vector)");
  expect(svg.bytes.toString("utf8")).toContain('width="89mm"');

  // PNG at 300 dpi: 89 mm → 1051 px, resolution recorded in the file.
  await page.getByLabel("Resolution").selectOption("300");
  const png = await download(page, "PNG");
  expect(png.name).toMatch(/_300dpi\.png$/);
  expect(png.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(pngSize(png.bytes).width).toBe(1051);
  expect(pngDpi(png.bytes)).toBe(300);

  // TIFF at 300 dpi: baseline RGB, Deflate, same pixel size.
  const tiff = await download(page, "TIFF");
  expect(tiff.name).toMatch(/_300dpi\.tif$/);
  const t = tiff.bytes;
  expect(t.subarray(0, 4)).toEqual(Buffer.from([0x49, 0x49, 42, 0]));
  const ifd = t.readUInt32LE(4);
  const tags = new Map<number, number>();
  for (let i = 0; i < t.readUInt16LE(ifd); i += 1) {
    const at = ifd + 2 + i * 12;
    const one = t.readUInt16LE(at + 2) === 3 && t.readUInt32LE(at + 4) === 1;
    tags.set(t.readUInt16LE(at), one ? t.readUInt16LE(at + 8) : t.readUInt32LE(at + 8));
  }
  expect(tags.get(256)).toBe(1051);
  expect(t.readUInt32LE(tags.get(282)!)).toBe(300);
  const pixels = inflateSync(t.subarray(tags.get(273)!, tags.get(273)! + tags.get(279)!));
  expect(pixels.length).toBe(1051 * tags.get(257)! * 3);

  // Source data: a block per panel, formula-safe CSV.
  const csv = (await download(page, "Source data (CSV)")).bytes.toString("utf8");
  expect(csv.startsWith("﻿Figure")).toBe(true);
  for (const p of ["a", "b", "c", "d", "e"]) expect(csv).toContain(`Panel ${p}: `);

  // The legend can be copied, and the source data are readable on the page.
  await page.getByText("Source data: the numbers drawn in each panel").click();
  await expect(page.locator(".source-data caption").first()).toContainText("Panel a:");

  // Every file is in the researcher's own audit trail.
  await page.getByRole("link", { name: "My activity" }).click();
  await expect(page.getByRole("heading", { name: "My activity" })).toBeVisible();
  await expect(page.locator("table.data")).toContainText("Exported a figure");
  expect(await page.locator("table.data tr", { hasText: "Exported a figure" }).count()).toBeGreaterThanOrEqual(5);
});
