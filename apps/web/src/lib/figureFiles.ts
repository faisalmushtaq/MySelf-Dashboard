import { encodeTiff, pixelSize, rgbaToRgb, setPngDpi, FONT_FAMILY, type FigureResult } from "@myself-dashboard/core";
import arimo400 from "@fontsource/arimo/files/arimo-latin-400-normal.woff2?url";
import arimo700 from "@fontsource/arimo/files/arimo-latin-700-normal.woff2?url";
import arimo400i from "@fontsource/arimo/files/arimo-latin-400-italic.woff2?url";

/**
 * Figure files, made in the browser from the figure's SVG. Nothing here sees a
 * participant row: the SVG was drawn from aggregates the server authorised.
 *
 * - SVG and PDF are vector, with live text (PDF text is set in Helvetica).
 * - PNG and TIFF are rendered at the chosen resolution with Arimo, the
 *   metric-compatible open version of Arial, embedded so the image looks the
 *   same on every machine. The resolution is written into the file.
 */

export type FigureFormat = "pdf" | "svg" | "png" | "tiff";

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function svgBlob(fig: FigureResult): Blob {
  return new Blob([fig.svg], { type: "image/svg+xml" });
}

function parseSvg(svg: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg" || doc.getElementsByTagName("parsererror").length) throw new Error("The figure could not be prepared.");
  return root as unknown as SVGSVGElement;
}

export async function pdfBlob(fig: FigureResult, title: string): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const doc = new jsPDF({
    unit: "pt",
    format: [fig.widthPt, fig.heightPt],
    orientation: fig.widthPt > fig.heightPt ? "landscape" : "portrait",
    compress: true,
  });
  doc.setProperties({ title, subject: fig.description.slice(0, 500), creator: "MySelf Research Dashboard" });
  // svg2pdf reads computed styles, so the SVG is attached (hidden) while it draws.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  host.appendChild(document.importNode(parseSvg(fig.svg), true));
  document.body.appendChild(host);
  try {
    await svg2pdf(host.firstElementChild as SVGElement, doc, { x: 0, y: 0, width: fig.widthPt, height: fig.heightPt });
  } finally {
    host.remove();
  }
  return doc.output("blob");
}

// ── Raster ─────────────────────────────────────────────────────────────────────

let fontCss: Promise<string> | null = null;

async function dataUrl(url: string, type: string): Promise<string> {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

/** @font-face rules with the fonts inlined: an SVG drawn as an image cannot fetch. */
function embeddedFonts(): Promise<string> {
  fontCss ??= Promise.all([dataUrl(arimo400, "font/woff2"), dataUrl(arimo700, "font/woff2"), dataUrl(arimo400i, "font/woff2")]).then(
    ([r, b, i]) =>
      `@font-face{font-family:FigureSans;src:url(${r}) format("woff2");font-weight:400;font-style:normal}` +
      `@font-face{font-family:FigureSans;src:url(${b}) format("woff2");font-weight:700;font-style:normal}` +
      `@font-face{font-family:FigureSans;src:url(${i}) format("woff2");font-weight:400;font-style:italic}`,
  );
  return fontCss;
}

function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** The figure drawn on a white canvas at `dpi`. */
export async function rasterise(fig: FigureResult, dpi: number): Promise<HTMLCanvasElement> {
  const css = await embeddedFonts();
  const svg = fig.svg
    .replace(/^<\?xml[^>]*>\s*/, "")
    .replace(`font-family="${FONT_FAMILY}"`, `font-family="FigureSans, ${FONT_FAMILY}"`)
    .replace(/<svg([^>]*)>/, `<svg$1><style>${css}</style>`);
  const { width, height } = pixelSize(fig.widthMm, fig.heightMm, dpi);
  const src = `data:image/svg+xml;base64,${utf8Base64(svg)}`;
  // Draw once to make the embedded fonts load, then again once they have.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw images of this size.");
  for (let pass = 0; pass < 2; pass += 1) {
    const img = await loadImage(src);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    if (pass === 0) await new Promise((r) => setTimeout(r, 60));
  }
  return canvas;
}

export async function pngBlob(fig: FigureResult, dpi: number): Promise<Blob> {
  const canvas = await rasterise(fig, dpi);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The image could not be created.");
  const stamped = setPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
  return new Blob([stamped as BlobPart], { type: "image/png" });
}

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function tiffBlob(fig: FigureResult, dpi: number): Promise<Blob> {
  const canvas = await rasterise(fig, dpi);
  const ctx = canvas.getContext("2d")!;
  const rgb = rgbaToRgb(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  const packed = await deflate(rgb);
  const tiff = encodeTiff({ width: canvas.width, height: canvas.height, dpi, data: packed ?? rgb, compression: packed ? "deflate" : "none" });
  return new Blob([tiff as BlobPart], { type: "image/tiff" });
}
