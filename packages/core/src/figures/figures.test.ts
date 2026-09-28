import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { computeAnalytics, durationDistributionOf, quantile } from "../analytics.js";
import { buildRows } from "../query.js";
import { buildSummary } from "../summary.js";
import { DEFAULT_POLICY } from "../policy.js";
import { compareVersions } from "../manifest.js";
import { computeQuestionStats } from "../questions.js";
import { resolveRange } from "../dates.js";
import { makePredicate, DEFAULT_FILTERS } from "../filters.js";
import { generateDemoSittings, demoReleases } from "../node/synthetic.js";
import { composeFigure, columnsFor, sourceDataCsv } from "./compose.js";
import { crc32, encodeTiff, pngDpi, pixelSize, ppm, rgbaToRgb, setPngDpi } from "./raster.js";
import { dateTickCandidates, decimalsFor, formatNumber, niceTicks } from "./scale.js";
import { wilson } from "./stats.js";
import { escapeXml, n as fmt } from "./svg.js";
import { fitText, textWidth, wrapText } from "./text.js";
import { PT_PER_MM } from "./theme.js";
import { DEFAULT_FIGURE, defaultPanel, parseFigureSpec, PANEL_KINDS, type FigureContext, type FigureSpec } from "./types.js";

// ── A figure context from the synthetic study (never real data) ────────────────

const now = new Date("2026-09-28T12:00:00.000Z");
const tz = "Europe/London";
const rels = demoReleases().map((r) => r.index);
const byHash = new Map(rels.map((r) => [r.hash, r]));
const summaries = generateDemoSittings({ now }).map((s) => buildSummary(s.doc, byHash.get(s.doc.releaseHash!) ?? null, DEFAULT_POLICY, { now }).summary);
const rows = buildRows(summaries, new Map(), DEFAULT_POLICY, now).filter(makePredicate(DEFAULT_FILTERS, { now, timeZone: tz }));
const analytics = computeAnalytics(rows, { now, timeZone: tz, range: resolveRange("all", {}, now, tz), releases: rels });
const newest = [...rels].sort((a, b) => compareVersions(b.version, a.version))[0]!;
const stats = computeQuestionStats(rows, newest, ["hard", "soft"]);

function context(overrides: Partial<FigureContext> = {}): FigureContext {
  return {
    analytics,
    questions: { [newest.hash]: { version: newest.version, sessions: rows.length, stats } },
    period: "all dates to 28 September 2026 (date started)",
    filters: [],
    timeZone: tz,
    rulesVersion: "completeness@1",
    requiredLevels: ["hard", "soft"],
    abandonAfterHours: 24,
    versionLabel: (h) => (byHash.get(h) ? `v${byHash.get(h)!.version}` : "unknown version"),
    ...overrides,
  };
}

const optionQuestion = stats.find((q) => q.distribution.kind === "options")!;
const numericQuestion = stats.find((q) => q.distribution.kind === "numeric")!;

const everyPanel: FigureSpec = {
  ...DEFAULT_FIGURE,
  panels: [
    { kind: "participation", cumulative: true },
    { kind: "status" },
    { kind: "items", version: newest.hash, section: null, requiredOnly: true, order: "lowest", limit: 12, labels: "text" },
    { kind: "responses", version: newest.hash, question: optionQuestion.key },
    { kind: "responses", version: newest.hash, question: numericQuestion.key },
    { kind: "completion", group: "site", siteLabels: "anonymised" },
  ],
};

// ── SVG inspection helpers ─────────────────────────────────────────────────────

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Well-formedness: every element closes, in order. */
function balanced(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.replace(/<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== name) return false;
    } else stack.push(name!);
  }
  return stack.length === 0;
}

interface TextRun {
  x: number;
  y: number;
  size: number;
  bold: boolean;
  anchor: string;
  rotated: boolean;
  content: string;
}

function texts(svg: string): TextRun[] {
  return [...svg.matchAll(/<text ([^>]*)>(.*?)<\/text>/gs)].map((m) => {
    const attr = (k: string) => new RegExp(`${k}="([^"]*)"`).exec(m[1]!)?.[1];
    return {
      x: Number(attr("x")),
      y: Number(attr("y")),
      size: Number(attr("font-size")),
      bold: attr("font-weight") === "bold",
      anchor: attr("text-anchor") ?? "start",
      rotated: !!attr("transform"),
      content: unescape(m[2]!.replace(/<[^>]+>/g, "")),
    };
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("text metrics", () => {
  it("measures Helvetica advance widths", () => {
    // H 722 + e 556 + l 222 + l 222 + o 556 = 2278 units
    expect(textWidth("Hello", 10)).toBeCloseTo(22.78, 5);
    expect(textWidth("a", 8, true)).toBeCloseTo(4.448, 5);
  });

  it("shortens with an ellipsis and never exceeds the width", () => {
    const long = "How often have you felt that you were unable to control the important things in your life?";
    const out = fitText(long, 60, 6);
    expect(out.endsWith("…")).toBe(true);
    expect(textWidth(out, 6)).toBeLessThanOrEqual(60);
    expect(fitText("Short", 60, 6)).toBe("Short");
  });

  it("wraps onto two lines, fitting the second", () => {
    const lines = wrapText("I've been able to make up my own mind about things.", 70, 6, 2);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(textWidth(l, 6)).toBeLessThanOrEqual(70);
  });
});

describe("SVG output", () => {
  it("escapes markup and strips characters XML forbids", () => {
    expect(escapeXml(`<script>alert("x")</script> & 'y'\u0001`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &apos;y&apos;");
  });

  it("rounds coordinates to 0.01 pt without negative zero", () => {
    expect(fmt(12.3456)).toBe("12.35");
    expect(fmt(-0.001)).toBe("0");
  });

  it("never lets survey wording become markup", () => {
    const hostile = stats.map((q, i) => (i === 0 ? { ...q, text: '<script>alert(1)</script><image href="x"/>', eligible: Math.max(1, q.eligible), countsAsRequired: true } : q));
    const spec: FigureSpec = { ...DEFAULT_FIGURE, panels: [{ kind: "items", version: newest.hash, section: null, requiredOnly: false, order: "questionnaire", limit: 40, labels: "text" }] };
    const r = composeFigure(spec, context({ questions: { [newest.hash]: { version: newest.version, sessions: rows.length, stats: hostile } } }));
    expect(r.svg).not.toContain("<script");
    expect(r.svg).not.toContain("<image");
    expect(r.svg).toContain("&lt;script");
    expect(balanced(r.svg)).toBe(true);
  });
});

describe("scales", () => {
  it("chooses whole-number ticks for counts", () => {
    expect(niceTicks(0, 62, 4, true).values).toEqual([0, 20, 40, 60, 80]);
    expect(niceTicks(0, 3, 4, true).values).toEqual([0, 1, 2, 3]);
  });

  it("prints as many decimals as the step needs", () => {
    expect(decimalsFor(2.5)).toBe(1);
    expect(decimalsFor(0.25)).toBe(2);
    expect(decimalsFor(5)).toBe(0);
  });

  it("formats numbers the way journals set them", () => {
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(-3)).toBe("−3");
    expect(formatNumber(-0.04, 1)).toBe("0.0");
  });

  it("offers month ticks for long date ranges", () => {
    const first = Date.UTC(2026, 0, 10) / 86_400_000;
    const last = Date.UTC(2026, 11, 20) / 86_400_000;
    const monthly = dateTickCandidates(first, last).find((set) => set[0]!.label === "Feb");
    expect(monthly?.map((t) => t.label)).toEqual(["Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  });
});

describe("Wilson score interval", () => {
  it("matches published values", () => {
    const half = wilson(5, 10)!;
    expect(half.lo).toBeCloseTo(0.2366, 4);
    expect(half.hi).toBeCloseTo(0.7634, 4);
    const none = wilson(0, 10)!;
    expect(none.lo).toBe(0);
    expect(none.hi).toBeCloseTo(0.2775, 4);
    const all = wilson(10, 10)!;
    expect(all.hi).toBe(1);
    expect(all.lo).toBeCloseTo(0.7225, 4);
  });

  it("is undefined without observations", () => {
    expect(wilson(0, 0)).toBeNull();
    expect(wilson(3, 2)).toBeNull();
  });
});

describe("completion-time distribution", () => {
  it("bins every duration once, with long ones reported as overflow", () => {
    const mins = [3, 4, 4.5, 5, 6, 7, 8, 9, 10, 12, 14, 200];
    const d = durationDistributionOf(mins.map((m) => m * 60_000))!;
    expect(d.bins.reduce((s, b) => s + b.count, 0) + d.overflow).toBe(mins.length);
    expect(d.overflow).toBeGreaterThanOrEqual(1);
    expect(d.bins.length).toBeLessThanOrEqual(20);
    expect(d.medianMin).toBeCloseTo(quantile([...mins].sort((a, b) => a - b), 0.5), 6);
  });

  it("is withheld below five sessions", () => {
    expect(durationDistributionOf([60_000, 120_000])).toBeNull();
  });
});

describe("composed figures", () => {
  const r = composeFigure(DEFAULT_FIGURE, context(), { createdAt: now.toISOString() });

  it("is a well-formed SVG at the journal column width", () => {
    expect(balanced(r.svg)).toBe(true);
    expect(r.svg).toContain('width="183mm"');
    expect(r.widthPt).toBeCloseTo(183 * PT_PER_MM, 6);
    expect(r.svg).toMatch(/viewBox="0 0 518\.74 /);
  });

  it("sets type at 5–8 pt, with bold lowercase panel letters", () => {
    const runs = texts(r.svg);
    for (const t of runs) expect(t.size >= 5 && t.size <= 8).toBe(true);
    const letters = runs.filter((t) => t.bold).map((t) => t.content);
    expect(letters).toEqual(["a", "b", "c", "d"]);
    for (const t of runs.filter((x) => x.bold)) expect(t.size).toBe(8);
  });

  it("keeps every label inside the figure", () => {
    for (const spec of [DEFAULT_FIGURE, everyPanel, { ...everyPanel, width: "single" as const }, { ...everyPanel, width: "onehalf" as const }]) {
      const out = composeFigure(spec, context());
      for (const t of texts(out.svg)) {
        if (t.rotated) {
          const h = textWidth(t.content, t.size);
          expect(t.y - h / 2).toBeGreaterThanOrEqual(-0.5);
          expect(t.y + h / 2).toBeLessThanOrEqual(out.heightPt + 0.5);
          continue;
        }
        const w = textWidth(t.content, t.size, t.bold);
        const left = t.anchor === "end" ? t.x - w : t.anchor === "middle" ? t.x - w / 2 : t.x;
        expect(left, `${t.content} starts outside`).toBeGreaterThanOrEqual(-0.5);
        expect(left + w, `${t.content} ends outside`).toBeLessThanOrEqual(out.widthPt + 0.5);
        expect(t.y).toBeLessThanOrEqual(out.heightPt + 0.5);
      }
    }
  });

  it("writes a journal-style legend with every panel and the data behind it", () => {
    expect(r.legend.startsWith("Fig. 1 | Participation and data completeness in the MySelf study. a, ")).toBe(true);
    for (const l of ["b, ", "c, ", "d, "]) expect(r.legend).toContain(l);
    expect(r.legend).toContain("95% confidence interval (Wilson score)");
    expect(r.legend).toContain(`Data: ${analytics.metrics.started} sessions`);
    expect(r.legend).toContain("completeness@1");
    expect(r.legend.match(/Sessions flagged invalid are excluded\./g)).toHaveLength(1);
  });

  it("exports the plotted numbers as source data", () => {
    expect(r.source.map((t) => t.panel)).toEqual(["", "a", "b", "c", "d"]);
    const csv = sourceDataCsv(r);
    expect(csv.startsWith("﻿Figure\r\n")).toBe(true);
    expect(csv).toContain("Panel a: Participation over time");
    expect(csv).toContain("95% CI lower");
    const participation = r.source[1]!;
    expect(participation.rows.at(-1)![3]).toBe(analytics.series.reduce((s, p) => s + p.started, 0));
  });

  it("draws a single panel without a letter", () => {
    const one = composeFigure({ ...DEFAULT_FIGURE, panels: [{ kind: "status" }] }, context());
    expect(texts(one.svg).filter((t) => t.bold)).toHaveLength(0);
    expect(one.legend).not.toContain(" a, ");
  });

  it("uses only greys in greyscale", () => {
    const g = composeFigure({ ...everyPanel, colour: "greyscale" }, context());
    const colours = new Set([...g.svg.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]!.toUpperCase()));
    for (const c of colours) expect(c.slice(1, 3) === c.slice(3, 5) && c.slice(3, 5) === c.slice(5, 7), c).toBe(true);
  });

  it("warns instead of failing when a panel has nothing to draw", () => {
    for (const kind of PANEL_KINDS) {
      const out = composeFigure({ ...DEFAULT_FIGURE, panels: [defaultPanel(kind)] }, context({ analytics: null, questions: {} }));
      expect(balanced(out.svg)).toBe(true);
      expect(out.warnings.length).toBeGreaterThan(0);
    }
  });

  it("warns when the figure is deeper than a page", () => {
    const tall = composeFigure({ ...DEFAULT_FIGURE, width: "single", panels: Array.from({ length: 6 }, () => ({ kind: "items" as const, version: newest.hash, section: null, requiredOnly: false, order: "questionnaire" as const, limit: 40, labels: "text" as const })) }, context());
    expect(tall.warnings.some((w) => w.includes("deeper than a journal page"))).toBe(true);
  });

  it("flags site codes as identifying", () => {
    const out = composeFigure({ ...DEFAULT_FIGURE, panels: [{ kind: "completion", group: "site", siteLabels: "codes" }] }, context());
    expect(out.warnings.some((w) => w.includes("identify schools"))).toBe(true);
  });

  it("lays panels out in columns that suit the width", () => {
    expect(columnsFor("single", 4)).toBe(1);
    expect(columnsFor("onehalf", 3)).toBe(2);
    expect(columnsFor("double", 4)).toBe(2);
    expect(columnsFor("double", 3)).toBe(3);
    expect(columnsFor("double", 1)).toBe(1);
  });
});

describe("figure specs", () => {
  it("fall back to the default when stored settings are malformed", () => {
    expect(parseFigureSpec({ width: "poster", panels: [] })).toEqual(DEFAULT_FIGURE);
    expect(parseFigureSpec(null)).toEqual(DEFAULT_FIGURE);
  });

  it("fill in defaults for a new panel", () => {
    expect(defaultPanel("items", "abc")).toMatchObject({ kind: "items", version: "abc", requiredOnly: true, limit: 12 });
  });
});

describe("raster files", () => {
  // A 1×1 white PNG, built here so the test needs no fixture.
  function tinyPng(): Uint8Array {
    const chunk = (type: string, data: Uint8Array) => {
      const out = new Uint8Array(12 + data.length);
      const v = new DataView(out.buffer);
      v.setUint32(0, data.length);
      out.set([...type].map((c) => c.charCodeAt(0)), 4);
      out.set(data, 8);
      v.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
      return out;
    };
    const ihdr = new Uint8Array(13);
    const v = new DataView(ihdr.buffer);
    v.setUint32(0, 1);
    v.setUint32(4, 1);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const idat = new Uint8Array(deflateSync(Buffer.from([0, 255, 255, 255])));
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  it("computes the PNG CRC", () => {
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
  });

  it("records the print resolution in a PNG, replacing any earlier one", () => {
    const png = setPngDpi(setPngDpi(tinyPng(), 300), 600);
    expect(pngDpi(png)).toBe(600);
    expect(pngDpi(tinyPng())).toBeNull();
    expect(new TextDecoder().decode(png).match(/pHYs/g)).toHaveLength(1);
    expect(ppm(600)).toBe(23622);
  });

  it("writes a baseline RGB TIFF that decodes to the same pixels", () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128, 10, 20, 30, 0, 1, 2, 3, 255]);
    const rgb = rgbaToRgb(rgba);
    expect([...rgb.slice(3, 6)]).toEqual([127, 127, 255]);
    const tiff = encodeTiff({ width: 2, height: 2, dpi: 600, data: new Uint8Array(deflateSync(rgb)), compression: "deflate" });
    const v = new DataView(tiff.buffer);
    expect(String.fromCharCode(tiff[0]!, tiff[1]!)).toBe("II");
    expect(v.getUint16(2, true)).toBe(42);
    const ifd = v.getUint32(4, true);
    const tags = new Map<number, number>();
    for (let i = 0; i < v.getUint16(ifd, true); i += 1) {
      const at = ifd + 2 + i * 12;
      const type = v.getUint16(at + 2, true);
      tags.set(v.getUint16(at, true), type === 3 && v.getUint32(at + 4, true) === 1 ? v.getUint16(at + 8, true) : v.getUint32(at + 8, true));
    }
    expect(tags.get(256)).toBe(2);
    expect(tags.get(259)).toBe(8);
    expect(tags.get(296)).toBe(2);
    expect(v.getUint32(tags.get(282)!, true)).toBe(600);
    const data = tiff.subarray(tags.get(273)!, tags.get(273)! + tags.get(279)!);
    expect([...inflateSync(data)]).toEqual([...rgb]);
  });

  it("sizes a figure in pixels for its print resolution", () => {
    expect(pixelSize(89, 60, 300)).toEqual({ width: 1051, height: 709 });
  });
});
