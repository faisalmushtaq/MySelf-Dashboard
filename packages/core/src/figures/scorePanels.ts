import { bandRange } from "../scoring/engine.js";
import type { ScoreResult, ScoresView } from "../scoring/benchmark.js";
import type { ScoreBenchmark, ScoreOutput, ScoringScheme, ThresholdSet } from "../scoring/scheme.js";
import type { ScoreSummary } from "../scoring/aggregate.js";
import {
  bottomAxis,
  bottomAxisHeight,
  categoryLabels,
  categoryLabelWidth,
  centreBaseline,
  drawLegend,
  hbar,
  leftAxis,
  leftAxisWidth,
  legendRows,
  line,
  rowsIn,
  text,
  thinTicks,
  topFor,
  type LegendItem,
} from "./draw.js";
import { decimalsFor, formatNumber, linear, niceTicks } from "./scale.js";
import { el, type El } from "./svg.js";
import { fitText, textWidth } from "./text.js";
import type { Theme } from "./theme.js";
import type { Box, FigureContext, PanelBuilder, PanelOutput } from "./types.js";

/**
 * Score panels: a distribution over its threshold bands, group means against
 * the study and a benchmark, and the share of each group in each band. Drawn
 * from the Scores view's aggregates; nothing about an individual.
 */

const RIGHT_PAD = 3;
const HIGHLIGHT = "#D55E00";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number | null | undefined, d = 3) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);

interface Resolved {
  view: ScoresView;
  scheme: ScoringScheme;
  output: ScoreOutput;
  result: ScoreResult | undefined;
  set: ThresholdSet | null;
  bench: ScoreBenchmark | null;
}

function resolve(spec: { scheme: string; output: string; thresholds?: string; benchmark?: string }, ctx: FigureContext): Resolved | null {
  const view = ctx.scores;
  if (!view || view.schemes.length === 0) return null;
  const scheme = view.schemes.find((s) => s.key === spec.scheme) ?? view.schemes[0]!;
  const output = scheme.outputs.find((o) => o.key === spec.output) ?? scheme.outputs.find((o) => o.primary) ?? scheme.outputs[0]!;
  const result = view.results.find((r) => r.scheme === scheme.key && r.output === output.key);
  const set = spec.thresholds === "none" ? null : (output.thresholds.find((t) => t.key === spec.thresholds) ?? output.thresholds[0] ?? null);
  const bench = spec.benchmark === "none" ? null : (output.benchmarks.find((b) => b.key === spec.benchmark) ?? output.benchmarks[0] ?? null);
  return { view, scheme, output, result, set, bench };
}

const title = (r: Resolved) => `${r.scheme.abbreviation ?? r.scheme.name}: ${r.output.label}`;
const fmt = (o: ScoreOutput, v: number, extra = 0) => formatNumber(v, Math.min(3, Math.max(o.decimals, 1) + extra));

function none(box: Box, theme: Theme, message: string, name: string): PanelOutput {
  return {
    body: [text(box.x + box.width / 2, box.y + box.height / 2, message, theme, { size: theme.size.note, anchor: "middle" })],
    legend: `${name}: no scores under the current filters.`,
    notes: [],
    source: { title: name, columns: ["Note"], rows: [[message]] },
    warnings: [`${name}: no scores to plot.`],
  };
}

function bandFill(set: ThresholdSet, i: number, theme: Theme, tint: boolean): string {
  const level = set.bands[i]!.level;
  if (level === null) return (tint ? theme.palette.descriptiveTints : theme.palette.descriptive)[i % theme.palette.descriptive.length]!;
  // A second no-concern band (SWEMWBS 'High wellbeing' beside 'Average') gets its own neutral, so the two stay apart.
  if (level === 0 && set.bands.slice(0, i).some((b) => b.level === 0)) return tint ? theme.palette.descriptiveTints[0] : theme.palette.descriptive[0];
  return tint ? theme.palette.levelTints[level] : theme.palette.levels[level];
}

/** The note shared by every score panel: how it was scored and whether that is verified. */
function methodNote(r: Resolved): string {
  const verified = r.scheme.verified ? "verified against its source" : "not yet verified against the licensed scoring documents";
  return `${r.scheme.abbreviation ?? r.scheme.name} scored with scheme ${r.scheme.key} v${r.scheme.version} (${verified}).`;
}

// ── Distribution over threshold bands ─────────────────────────────────────────

const distribution: PanelBuilder<"score_distribution"> = {
  name: "Score distribution with thresholds",
  preferredHeight: (_s, _c, width) => clamp(width * 0.6, 110, 170),
  render(spec, ctx, box, theme) {
    const r = resolve(spec, ctx);
    if (!r) return none(box, theme, "No scores", "Score distribution");
    const name = title(r);
    const focus = r.result?.focus;
    const main: ScoreSummary | null | undefined = focus ? focus.summary : r.result?.overall;
    const compare: ScoreSummary | null | undefined = focus ? focus.peers : null;
    if (!main?.histogram) return none(box, theme, "No scores under these filters", name);
    const o = r.output;
    const isWhole = main.histogram.every((b) => b.from === b.to);
    const [lo, hi] = o.range;
    const domain: [number, number] = isWhole ? [lo - 0.5, hi + 0.5] : [lo, hi];
    const share = (s: ScoreSummary) => s.histogram!.map((b) => (100 * b.count) / s.n);
    const mainShare = share(main);
    const compareShare = compare?.histogram ? share(compare) : null;
    const yMax = Math.max(5, ...mainShare, ...(compareShare ?? []));
    const yt = niceTicks(0, yMax, 4);
    const yLabels = yt.values.map((v) => ({ value: v, label: formatNumber(v, decimalsFor(yt.step)) }));
    const mainLabel = focus ? r.view.focus!.label : "All";
    const items: LegendItem[] = [
      { label: focus ? `${mainLabel} (n = ${formatNumber(main.n)})` : `n = ${formatNumber(main.n)}`, swatch: "box", colour: theme.palette.primary },
      ...(compareShare ? [{ label: `${r.view.focus!.peersLabel} (n = ${formatNumber(compare!.n)})`, swatch: "line" as const, colour: theme.palette.context, dash: theme.palette.contextDash }] : []),
      { label: "Mean", swatch: "rule", colour: theme.palette.ink },
      ...(r.bench ? [{ label: r.bench.label, swatch: "rule" as const, colour: theme.palette.ink, dash: "2 1.5" }] : []),
    ];
    const x0 = box.x + leftAxisWidth(yLabels, theme, true);
    const xt = niceTicks(lo, hi, 6, isWhole);
    const xTicks = xt.values.filter((v) => v >= lo && v <= hi).map((v) => ({ value: v, label: formatNumber(v, decimalsFor(xt.step)).replace("-", "−") }));
    const x1 = box.x + box.width - Math.max(RIGHT_PAD, textWidth(xTicks.at(-1)?.label ?? "", theme.size.tick) / 2 + 0.5);
    const legend = legendRows(items, x1 - x0, theme);
    const bandLabelRoom = r.set ? theme.size.note + 2 : 0;
    const top = box.y + topFor(legend) + bandLabelRoom;
    const bottom = box.y + box.height - bottomAxisHeight(theme, true);
    const xs = linear(domain, [x0, x1]);
    const ys = linear([0, yt.max], [bottom, top]);
    const body: El[] = [];

    // Threshold bands behind everything, labelled along the top.
    if (r.set) {
      let prev: number = domain[0];
      r.set.bands.forEach((b, i) => {
        const edge = b.max === null ? domain[1] : clamp(isWhole ? b.max + 0.5 : b.max, domain[0], domain[1]);
        if (edge > prev) {
          const a = xs(prev);
          const w = xs(edge) - a;
          body.push(el("rect", { x: a, y: top, width: w, height: bottom - top, fill: bandFill(r.set!, i, theme, true) }));
          const label = fitText(b.label, w - 2, theme.size.note);
          // A band too narrow for a readable label is named in the legend and caption instead.
          if (label && (label === b.label || label.length >= 7)) body.push(text(a + w / 2, top - 2, label, theme, { size: theme.size.note, anchor: "middle" }));
        }
        prev = Math.max(prev, edge);
      });
    }
    body.push(...leftAxis({ box, x: x0, top, bottom, scale: ys, ticks: yLabels, title: "% of sittings", theme }));
    main.histogram.forEach((b, i) => {
      const v = mainShare[i]!;
      if (v <= 0) return;
      const a = isWhole ? xs(b.from - 0.5) + theme.gap : xs(b.from) + theme.gap / 2;
      const w = isWhole ? xs(b.from + 0.5) - xs(b.from - 0.5) - 2 * theme.gap : xs(b.to) - xs(b.from) - theme.gap;
      body.push(el("rect", { x: a, y: ys(v), width: Math.max(0.2, w), height: ys(0) - ys(v), fill: theme.palette.primary }));
    });
    if (compareShare) {
      // The comparison as a step outline, so both read at once.
      const pts: string[] = [];
      compare!.histogram!.forEach((b, i) => {
        const a = isWhole ? xs(b.from - 0.5) : xs(b.from);
        const c = isWhole ? xs(b.from + 0.5) : xs(b.to);
        const y = ys(compareShare[i]!);
        pts.push(`${pts.length ? "L" : "M"}${round(a, 2)} ${round(y, 2)}`, `L${round(c, 2)} ${round(y, 2)}`);
      });
      body.push(el("path", { d: pts.join(" "), fill: "none", stroke: theme.palette.context, "stroke-width": theme.stroke.line, "stroke-dasharray": theme.palette.contextDash ?? undefined }));
    }
    body.push(...bottomAxis({ box, left: x0, right: x1, y: bottom, scale: xs, ticks: thinTicks(xTicks, xs, theme), title: o.label, theme }));
    const mark = (v: number, dash: string | null) => {
      const x = xs(clamp(v, domain[0], domain[1]));
      body.push(line(x, top, x, bottom, theme.palette.ink, theme.stroke.reference * (dash ? 1 : 1.6), dash));
    };
    mark(main.mean, null);
    if (r.bench) mark(r.bench.mean, "2 1.5");
    body.push(...drawLegend(legend, x0, box, theme));

    const who = focus ? `${mainLabel}` : "the selected sittings";
    const benchText = r.bench ? `; the dashed line marks ${r.bench.label} (mean ${fmt(o, r.bench.mean)})` : "";
    return {
      body,
      legend:
        `Distribution of ${o.label.toLowerCase()} (${r.scheme.abbreviation ?? r.scheme.name}) in ${who}, as a percentage of sittings` +
        (compareShare ? `, with ${r.view.focus!.peersLabel.toLowerCase()} outlined` : "") +
        `; the solid line marks the mean (${fmt(o, main.mean)})${benchText}.` +
        (r.set ? ` Shading shows the ${r.set.label.toLowerCase()} (${r.set.bands.map((b, i) => `${b.label.toLowerCase()} ${bandRange(r.set!, i, o)}`).join(", ")}).` : ""),
      notes: [methodNote(r), ...(r.set && !r.set.verified ? [`The ${r.set.label.toLowerCase()} are transcribed from ${r.set.source.split(":")[0]} and not yet verified.`] : [])],
      source: {
        title: `${name} — distribution`,
        columns: ["From", "To", `% ${mainLabel}`, ...(compareShare ? [`% ${r.view.focus!.peersLabel}`] : [])],
        rows: main.histogram.map((b, i) => [round(b.from), round(b.to), round(mainShare[i]!, 2), ...(compareShare ? [round(compareShare[i]!, 2)] : [])]),
      },
      warnings: main.n < 20 ? [`${name}: only ${main.n} scores — the distribution is rough.`] : [],
    };
  },
};

// ── Group means against the study and a benchmark ─────────────────────────────

function groupRows(r: Resolved) {
  const rows = (r.result?.groups ?? []).filter((g) => g.summary);
  return [{ key: "__all", label: r.view.overallLabel ?? "All", n: r.result?.overall?.n ?? 0, small: false, summary: r.result?.overall ?? null }, ...rows];
}

const groups: PanelBuilder<"score_groups"> = {
  name: "Score by group (mean, 95% CI)",
  preferredHeight: (spec, ctx) => {
    const r = resolve(spec, ctx);
    return 11 + 7.5 + Math.max(2, r ? groupRows(r).length : 2) * 12 + 22;
  },
  render(spec, ctx, full, theme) {
    const r = resolve(spec, ctx);
    if (!r) return none(full, theme, "No scores", "Score by group");
    const name = title(r);
    const box = { ...full, height: Math.min(full.height, groups.preferredHeight(spec, ctx, full.width, theme) * 1.2) };
    const rows = groupRows(r).filter((g) => g.summary);
    if (rows.length === 0) return none(box, theme, "No scores under these filters", name);
    const o = r.output;
    const overall = r.result?.overall ?? null;
    const focusKey = r.view.focus ? [r.view.focus.school, r.view.focus.yearGroup].filter((x) => x !== null && x !== undefined).join("|") : null;
    const isFocus = (key: string) => focusKey !== null && (key === focusKey || key === r.view.focus?.school || key === String(r.view.focus?.yearGroup));
    const values = rows.flatMap((g) => [g.summary!.ci?.[0] ?? g.summary!.mean, g.summary!.ci?.[1] ?? g.summary!.mean]);
    if (r.bench) values.push(r.bench.mean);
    const lo = Math.max(o.range[0], Math.min(...values));
    const hi = Math.min(o.range[1], Math.max(...values));
    const pad = Math.max((hi - lo) * 0.08, (o.range[1] - o.range[0]) * 0.02);
    const xt = niceTicks(Math.max(o.range[0], lo - pad), Math.min(o.range[1], hi + pad), 5);
    const labels = rows.map((g) => g.label);
    const nLabels = rows.map((g) => `n = ${formatNumber(g.n)}${g.small ? "*" : ""}`);
    const nW = Math.max(...nLabels.map((l) => textWidth(l, theme.size.tick)));
    const labelW = categoryLabelWidth(labels, box.width * 0.36, theme);
    const x0 = box.x + labelW;
    const x1 = box.x + box.width - nW - 6;
    const items: LegendItem[] = [
      { label: "Mean, 95% CI", swatch: "point", colour: theme.palette.primary },
      ...(focusKey ? [{ label: r.view.focus!.label, swatch: "point" as const, colour: HIGHLIGHT }] : []),
      ...(r.bench ? [{ label: r.bench.label, swatch: "rule" as const, colour: theme.palette.ink, dash: "2 1.5" }] : []),
    ];
    const legend = legendRows(items, x1 - x0, theme);
    const top = box.y + topFor(legend);
    const bottom = box.y + box.height - bottomAxisHeight(theme, true);
    const xs = linear([xt.min, xt.max], [x0, x1]);
    const layout = rowsIn(top, bottom, rows.length);
    const body: El[] = [...categoryLabels(labels, layout, x0, box.width * 0.36, theme)];
    const ticks = xt.values.map((v) => ({ value: v, label: formatNumber(v, decimalsFor(xt.step)).replace("-", "−") }));
    body.push(...bottomAxis({ box, left: x0, right: x1, y: bottom, scale: xs, ticks: thinTicks(ticks, xs, theme), title: o.label, theme }));
    body.push(line(x0, top, x0, bottom, theme.palette.ink, theme.stroke.axis));
    if (overall) body.push(line(xs(overall.mean), top, xs(overall.mean), bottom, theme.palette.context, theme.stroke.reference));
    if (r.bench && r.bench.mean >= xt.min && r.bench.mean <= xt.max) body.push(line(xs(r.bench.mean), top, xs(r.bench.mean), bottom, theme.palette.ink, theme.stroke.reference, "2 1.5"));
    rows.forEach((g, i) => {
      const s = g.summary!;
      const cy = layout.centre(i);
      const colour = isFocus(g.key) ? HIGHLIGHT : theme.palette.primary;
      if (s.ci) {
        const [a, b] = [xs(clamp(s.ci[0], xt.min, xt.max)), xs(clamp(s.ci[1], xt.min, xt.max))];
        const cap = theme.stroke.cap / 2;
        body.push(line(a, cy, b, cy, theme.palette.ink, theme.stroke.error));
        body.push(line(a, cy - cap, a, cy + cap, theme.palette.ink, theme.stroke.error));
        body.push(line(b, cy - cap, b, cy + cap, theme.palette.ink, theme.stroke.error));
      }
      body.push(
        g.small
          ? el("circle", { cx: xs(s.mean), cy, r: theme.pointRadius, fill: "#FFFFFF", stroke: colour, "stroke-width": 0.8 })
          : el("circle", { cx: xs(s.mean), cy, r: theme.pointRadius, fill: colour }),
      );
      body.push(text(box.x + box.width, centreBaseline(cy, theme.size.tick), nLabels[i]!, theme, { anchor: "end" }));
    });
    body.push(...drawLegend(legend, x0, box, theme));
    const small = rows.filter((g) => g.small);
    return {
      body,
      legend:
        `Mean ${o.label.toLowerCase()} ${r.view.groupsDescription ?? `by ${r.view.groupBy === "schoolYear" ? "school and year group" : r.view.groupBy === "yearGroup" ? "year group" : r.view.groupBy}`}, with 95% confidence intervals (t distribution)` +
        (overall ? `; the grey line marks ${(r.view.overallLabel ?? "all sittings").toLowerCase()} (mean ${fmt(o, overall.mean)})` : "") +
        (r.bench ? `${overall ? " and" : ";"} the dashed line ${r.bench.label} (mean ${fmt(o, r.bench.mean)}).` : ".") +
        (small.length ? ` Open circles and * mark groups of fewer than ${r.view.minCell}.` : ""),
      notes: [methodNote(r), `${o.higherIs === "better" ? "Higher scores are better." : o.higherIs === "worse" ? "Higher scores indicate more difficulty." : "Scores are descriptive: neither direction is better."}`],
      source: {
        title: `${name} — by group`,
        columns: ["Group", "n", "Mean", "95% CI lower", "95% CI upper", "SD", "Median"],
        rows: rows.map((g) => [g.label, g.n, round(g.summary!.mean), round(g.summary!.ci?.[0]), round(g.summary!.ci?.[1]), round(g.summary!.sd), round(g.summary!.median)]),
      },
      warnings: small.length ? [`${name}: ${small.map((g) => g.label).join(", ")} ha${small.length === 1 ? "s" : "ve"} fewer than ${r.view.minCell} scores — do not report them on their own.`] : [],
    };
  },
};

// ── Share in each band, by group ───────────────────────────────────────────────

const bands: PanelBuilder<"score_bands"> = {
  name: "Share in each threshold band",
  preferredHeight: (spec, ctx) => {
    const r = resolve(spec, ctx);
    const n = r ? groupRows(r).length + (r.set?.expected ? 1 : 0) : 2;
    return 11 + 15 + Math.max(2, n) * 12 + 22;
  },
  render(spec, ctx, full, theme) {
    const r = resolve(spec, ctx);
    if (!r || !r.set) return none(full, theme, "This score has no threshold bands", r ? title(r) : "Threshold bands");
    const name = title(r);
    const set = r.set;
    const box = { ...full, height: Math.min(full.height, bands.preferredHeight(spec, ctx, full.width, theme) * 1.2) };
    const rows: { label: string; n: number | null; shares: number[]; small: boolean }[] = [];
    if (set.expected) rows.push({ label: "Expected", n: null, shares: set.expected.map((e) => e * 100), small: false });
    for (const g of groupRows(r)) {
      const b = g.summary?.bands[set.key];
      if (b) rows.push({ label: g.label, n: g.n, shares: b.map((x) => x.share * 100), small: g.small });
    }
    if (rows.length === 0) return none(box, theme, "No scores under these filters", name);
    const labels = rows.map((x) => x.label);
    const nLabels = rows.map((x) => (x.n === null ? "" : `n = ${formatNumber(x.n)}${x.small ? "*" : ""}`));
    const nW = Math.max(...nLabels.map((l) => textWidth(l, theme.size.tick)));
    const labelW = categoryLabelWidth(labels, box.width * 0.36, theme);
    const x0 = box.x + labelW;
    const x1 = box.x + box.width - nW - 6;
    const items: LegendItem[] = set.bands.map((b, i) => ({ label: `${b.label} (${bandRange(set, i, r.output)})`, swatch: "box", colour: bandFill(set, i, theme, false) }));
    const legend = legendRows(items, box.x + box.width - x0, theme);
    const top = box.y + topFor(legend);
    const bottom = box.y + box.height - bottomAxisHeight(theme, true);
    const xs = linear([0, 100], [x0, x1]);
    const layout = rowsIn(top, bottom, rows.length);
    const thickness = Math.min(7, layout.pitch * 0.66);
    const body: El[] = [...categoryLabels(labels, layout, x0, box.width * 0.36, theme)];
    rows.forEach((row, i) => {
      const cy = layout.centre(i);
      let acc = 0;
      row.shares.forEach((v, j) => {
        if (v <= 0) return;
        const a = xs(acc) + (acc > 0 ? theme.gap / 2 : 0);
        const b = xs(acc + v) - (acc + v < 99.999 ? theme.gap / 2 : 0);
        const bar = hbar(a, b, cy, thickness, bandFill(set, j, theme, false));
        if (bar) body.push(bar);
        const label = `${Math.round(v)}%`;
        if (b - a > textWidth(label, theme.size.tick) + 2) {
          const dark = set.bands[j]!.level === 3 || (set.bands[j]!.level === 2 && theme.palette.levels[2] !== "#8C8C8C");
          body.push(el("text", { x: (a + b) / 2, y: centreBaseline(cy, theme.size.tick), "font-size": theme.size.tick, "text-anchor": "middle", fill: dark ? "#FFFFFF" : "#000000" }, label));
        }
        acc += v;
      });
      if (row.n !== null) body.push(text(box.x + box.width, centreBaseline(cy, theme.size.tick), nLabels[i]!, theme, { anchor: "end" }));
    });
    body.push(...bottomAxis({ box, left: x0, right: x1, y: bottom, scale: xs, ticks: [0, 25, 50, 75, 100].map((v) => ({ value: v, label: String(v) })), title: "% of sittings", theme }));
    body.push(...drawLegend(legend, x0, box, theme));
    const small = rows.filter((x) => x.small);
    return {
      body,
      legend:
        `Percentage of sittings in each band of the ${set.label.toLowerCase()} for ${r.output.label.toLowerCase()} (${r.scheme.abbreviation ?? r.scheme.name}), ${r.view.groupsDescription ?? "by group"}` +
        (set.expected ? `; 'Expected' shows the shares the bands were set to give in the reference population (${set.expected.map((e) => `${Math.round(e * 100)}%`).join("/")}).` : ".") +
        (small.length ? ` * fewer than ${r.view.minCell} scores.` : ""),
      notes: [methodNote(r), `Bands: ${set.source}${set.verified ? "" : " (not yet verified)"}.`],
      source: {
        title: `${name} — ${set.label}`,
        columns: ["Group", "n", ...set.bands.map((b) => `% ${b.label}`)],
        rows: rows.map((x) => [x.label, x.n, ...x.shares.map((v) => round(v, 2))]),
      },
      warnings: small.length ? [`${name}: shares for groups of fewer than ${r.view.minCell} are unreliable and can identify individuals.`] : [],
    };
  },
};

export const SCORE_PANELS = { score_distribution: distribution, score_groups: groups, score_bands: bands } as const;
