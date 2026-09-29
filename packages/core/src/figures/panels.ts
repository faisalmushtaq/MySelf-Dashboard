import type { QuestionStat } from "../questions.js";
import { el, pathOf, type El } from "./svg.js";
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
  rowPitch,
  rowsIn,
  text,
  thinTicks,
  topFor,
  type LegendItem,
  type TickLabel,
} from "./draw.js";
import {
  dateTickCandidates,
  dayNumber,
  decimalsFor,
  formatNumber,
  formatPercent,
  linear,
  niceTicks,
  PERCENT_TICKS,
} from "./scale.js";
import { wilson } from "./stats.js";
import { textWidth } from "./text.js";
import type { Theme } from "./theme.js";
import type { Box, FigureContext, PanelBuilder, PanelKind, PanelOf, PanelOutput } from "./types.js";
import { SCORE_PANELS } from "./scorePanels.js";

/**
 * The panels a figure can hold. Each draws from aggregates only, returns its
 * sentence for the figure legend, the definitions a reader needs, and the exact
 * numbers it plotted as a source-data table.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pct1 = (k: number, total: number) => (total > 0 ? Math.round((k / total) * 1000) / 10 : null);
const RIGHT_PAD = 3;
/** Right padding so an axis's last tick label, centred on the edge of the plot, stays inside. */
const endPad = (label: string, theme: Theme) => Math.max(RIGHT_PAD, textWidth(label, theme.size.tick) / 2 + 0.5);
/** Share of a panel's width row labels may take before they wrap. */
const ITEM_CAP = 0.45;
const SECTION_CAP = 0.42;
const INVALID_NOTE = "Sessions flagged invalid are excluded.";
const PERCENT_LABELS: TickLabel[] = PERCENT_TICKS.values.map((v) => ({ value: v, label: String(v) }));

/** Space a row of a bar or dot chart takes. */
const ROW = 10;

function rowsHeight(count: number, theme: Theme, legendLines = 1, pitch = ROW): number {
  return 11 + Math.max(0, legendLines - 1) * 7.5 + Math.max(1, count) * pitch + bottomAxisHeight(theme, true) + 2;
}

/**
 * Row-based charts keep close to their natural height, top-aligned, when a
 * taller neighbour sets the row height — stretched rows read as sparse.
 */
function fit(box: Box, natural: number): Box {
  return { ...box, height: Math.min(box.height, natural * 1.2) };
}

function empty(box: Box, theme: Theme, message: string, title: string, warning: string): PanelOutput {
  return {
    body: [text(box.x + box.width / 2, box.y + box.height / 2, message, theme, { size: theme.size.note, anchor: "middle" })],
    legend: `${title}: no data under the current filters.`,
    notes: [],
    source: { title, columns: ["Note"], rows: [[message]] },
    warnings: [warning],
  };
}

/** Horizontal percentage bars with a value label after each bar. */
function percentBars(o: {
  box: Box;
  theme: Theme;
  labels: string[];
  values: (number | null)[];
  valueLabels: string[];
  xTitle: string;
  labelCap: number;
}): El[] {
  const { box, theme } = o;
  const labelW = categoryLabelWidth(o.labels, o.labelCap, theme);
  const valueW = Math.max(0, ...o.valueLabels.map((l) => textWidth(l, theme.size.tick))) + 2;
  const x0 = box.x + labelW;
  const x1 = box.x + box.width - valueW - RIGHT_PAD;
  const top = box.y + topFor([]);
  const bottom = box.y + box.height - bottomAxisHeight(theme, true);
  const xs = linear([0, 100], [x0, x1]);
  const rows = rowsIn(top, bottom, o.labels.length);
  const thickness = Math.min(6, rows.pitch * 0.62);
  const out: El[] = [...categoryLabels(o.labels, rows, x0, o.labelCap, theme)];
  o.values.forEach((v, i) => {
    const cy = rows.centre(i);
    const bar = v === null ? null : hbar(x0, xs(v), cy, thickness, theme.palette.primary);
    if (bar) out.push(bar);
    out.push(text((v === null ? x0 : xs(v)) + 1.5, centreBaseline(cy, theme.size.tick), o.valueLabels[i]!, theme));
  });
  out.push(...bottomAxis({ box, left: x0, right: x1, y: bottom, scale: xs, ticks: PERCENT_LABELS, title: o.xTitle, theme }));
  out.push(line(x0, top, x0, bottom, theme.palette.ink, theme.stroke.axis));
  return out;
}

// ── a. Participation over time ─────────────────────────────────────────────────

const participation: PanelBuilder<"participation"> = {
  name: "Participation over time",
  preferredHeight: (_s, _c, width) => clamp(width * 0.62, 110, 175),
  render(spec, ctx, box, theme) {
    const a = ctx.analytics;
    const title = "Participation over time";
    if (!a || a.series.length === 0) return empty(box, theme, "No dated sessions under these filters", title, "Participation: no dated sessions to plot.");
    const step = a.granularity === "week" ? 7 : 1;
    const unit = a.granularity === "week" ? "week" : "day";
    let cs = 0;
    let cc = 0;
    const pts = a.series.map((p) => {
      cs += p.started;
      cc += p.completed;
      return { day: dayNumber(p.bucket), bucket: p.bucket, started: p.started, completed: p.completed, cumStarted: cs, cumCompleted: cc };
    });
    const first = pts[0]!.day;
    const end = pts[pts.length - 1]!.day + step;
    const yOf = (p: (typeof pts)[number], k: "started" | "completed") =>
      spec.cumulative ? (k === "started" ? p.cumStarted : p.cumCompleted) : p[k];
    const yMax = Math.max(1, ...pts.map((p) => yOf(p, "started")), ...pts.map((p) => yOf(p, "completed")));
    const yt = niceTicks(0, yMax, 4, true);
    const yLabels = yt.values.map((v) => ({ value: v, label: formatNumber(v) }));
    const items: LegendItem[] = [
      { label: "Started", swatch: "line", colour: theme.palette.context, dash: theme.palette.contextDash },
      { label: "Completed", swatch: "line", colour: theme.palette.primary },
    ];
    const x0 = box.x + leftAxisWidth(yLabels, theme, true);
    const x1 = box.x + box.width - RIGHT_PAD;
    const rows = legendRows(items, x1 - x0, theme);
    const top = box.y + topFor(rows);
    const bottom = box.y + box.height - bottomAxisHeight(theme, true);
    const ys = linear([0, yt.max], [bottom, top]);
    const xs = linear([first, end], [x0, x1]);

    // Cumulative counts are drawn at the end of each period ("by the end of the
    // day"), per-period counts at its middle.
    const xAt = (d: number) => (spec.cumulative ? xs(d + step) : xs(d + step / 2));
    const seriesPath = (k: "started" | "completed"): [number, number][] => [
      ...(spec.cumulative ? ([[xs(first), ys(0)]] as [number, number][]) : []),
      ...pts.map((p) => [xAt(p.day), ys(yOf(p, k))] as [number, number]),
    ];
    const body: El[] = [];
    body.push(...leftAxis({ box, x: x0, top, bottom, scale: ys, ticks: yLabels, title: spec.cumulative ? "Cumulative sessions" : `Sessions per ${unit}`, theme }));

    let ticks: TickLabel[] = [];
    for (const cand of dateTickCandidates(first, end)) {
      const set = cand.filter((t) => t.day >= first && t.day <= end).map((t) => ({ value: t.day, label: t.label }));
      const inside = set.filter((t) => xs(t.value) - textWidth(t.label, theme.size.tick) / 2 >= box.x && xs(t.value) + textWidth(t.label, theme.size.tick) / 2 <= box.x + box.width);
      if (inside.length > 9) continue;
      const thin = thinTicks(inside, xs, theme);
      if (thin.length === inside.length && inside.length >= Math.min(2, set.length)) {
        ticks = inside;
        break;
      }
    }
    body.push(...bottomAxis({ box, left: x0, right: x1, y: bottom, scale: xs, ticks, title: "Date", theme }));
    const lineEl = (k: "started" | "completed", colour: string, dash: string | null) =>
      el("path", { d: pathOf(seriesPath(k)), fill: "none", stroke: colour, "stroke-width": theme.stroke.line, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": dash ?? undefined });
    body.push(lineEl("started", theme.palette.context, theme.palette.contextDash));
    body.push(lineEl("completed", theme.palette.primary, null));
    if (pts.length === 1) {
      for (const [k, c] of [["started", theme.palette.context], ["completed", theme.palette.primary]] as const) {
        body.push(el("circle", { cx: xAt(pts[0]!.day), cy: ys(yOf(pts[0]!, k)), r: theme.pointRadius, fill: c }));
      }
    }
    body.push(...drawLegend(rows, x0, box, theme));

    return {
      body,
      legend: spec.cumulative
        ? `Cumulative number of sessions started and completed, by ${unit}.`
        : `Number of sessions started and completed per ${unit}.`,
      notes: [
        `Sessions are counted as started ${unit === "week" ? "in the week" : "on the day"} they began and as completed ${unit === "week" ? "in the week" : "on the day"} they were completed, by the participant device's clock (${ctx.timeZone}).`,
      ],
      source: {
        title,
        columns: [`${unit === "week" ? "Week" : "Day"} starting`, "Started", "Completed", "Cumulative started", "Cumulative completed"],
        rows: pts.map((p) => [p.bucket, p.started, p.completed, p.cumStarted, p.cumCompleted]),
      },
      warnings: [],
    };
  },
};

// ── Session status ─────────────────────────────────────────────────────────────

const STATUS_ROWS = [
  ["complete", "Complete"],
  ["incomplete", "Incomplete"],
  ["abandoned", "Abandoned"],
  ["inProgress", "In progress"],
  ["notStarted", "Not started"],
] as const;

const status: PanelBuilder<"status"> = {
  name: "Session status",
  preferredHeight: (_s, _c, _w, theme) => rowsHeight(STATUS_ROWS.length, theme, 1, 12),
  render(spec, ctx, full, theme) {
    const box = fit(full, status.preferredHeight(spec, ctx, full.width, theme));
    const m = ctx.analytics?.metrics;
    const title = "Session status";
    if (!m || m.started === 0) return empty(box, theme, "No sessions under these filters", title, "Status: no sessions.");
    const counts = STATUS_ROWS.map(([k]) => m[k]);
    const values = counts.map((c) => (c / m.started) * 100);
    return {
      body: percentBars({
        box,
        theme,
        labels: STATUS_ROWS.map(([, l]) => l),
        values,
        valueLabels: counts.map((c, i) => `${formatNumber(c)} (${formatNumber(values[i]!, values[i]! > 0 && values[i]! < 1 ? 1 : 0)}%)`),
        xTitle: "Sessions (%)",
        labelCap: box.width * 0.4,
      }),
      legend: `Status of all ${formatNumber(m.started)} sessions: number and percentage.`,
      notes: [
        `Complete, reached the end with every required question answered or declined; incomplete, reached the end with at least one required answer missing; abandoned, not finished and no contact for more than ${ctx.abandonAfterHours} h; in progress, not finished but in contact within ${ctx.abandonAfterHours} h; not started, opened with no question answered.`,
      ],
      source: {
        title,
        columns: ["Status", "Sessions", "Percentage of all sessions"],
        rows: STATUS_ROWS.map(([, l], i) => [l, counts[i]!, pct1(counts[i]!, m.started)]),
      },
      warnings: [],
    };
  },
};

// ── Completion rate with 95% intervals ─────────────────────────────────────────

interface Group {
  label: string;
  code: string;
  finished: number;
  complete: number;
}

function groupsFor(spec: PanelOf<"completion">, ctx: FigureContext): Group[] {
  const a = ctx.analytics;
  if (!a) return [];
  if (spec.group === "site") {
    return a.sites
      .filter((s) => s.finished > 0)
      .map((s, i) => ({ label: spec.siteLabels === "codes" ? s.site : `Site ${i + 1}`, code: s.site, finished: s.finished, complete: s.finishedComplete }));
  }
  const known = a.versions.filter((v) => v.finished > 0 && v.known).reverse();
  const unknown = a.versions.filter((v) => v.finished > 0 && !v.known);
  return [
    ...known.map((v) => ({ label: v.version ? `v${v.version}` : v.hash.slice(0, 8), code: v.hash, finished: v.finished, complete: v.finishedComplete })),
    ...unknown.map((v) => ({ label: "Unknown version", code: v.hash, finished: v.finished, complete: v.finishedComplete })),
  ];
}

const completion: PanelBuilder<"completion"> = {
  name: "Completion rate with 95% CI",
  preferredHeight: (spec, ctx, _w, theme) => rowsHeight(groupsFor(spec, ctx).length, theme, 1, 12),
  render(spec, ctx, full, theme) {
    const box = fit(full, completion.preferredHeight(spec, ctx, full.width, theme));
    const groups = groupsFor(spec, ctx);
    const title = spec.group === "site" ? "Completion rate by site" : "Completion rate by survey version";
    if (groups.length === 0) return empty(box, theme, "No finished sessions under these filters", title, "Completion: no finished sessions.");
    const m = ctx.analytics!.metrics;
    const overall = m.completionRate;
    const ci = groups.map((g) => wilson(g.complete, g.finished)!);
    const nLabels = groups.map((g) => `n = ${formatNumber(g.finished)}`);
    const nW = Math.max(...nLabels.map((l) => textWidth(l, theme.size.tick)));
    const labels = groups.map((g) => g.label);
    const items: LegendItem[] = groups.length > 1 && overall !== null ? [{ label: "All finished sessions", swatch: "rule", colour: theme.palette.ink, dash: "2 1.5" }] : [];
    const labelW = categoryLabelWidth(labels, box.width * 0.35, theme);
    const x0 = box.x + labelW;
    const x1 = box.x + box.width - nW - 6;
    const legend = legendRows(items, x1 - x0, theme);
    const top = box.y + topFor(legend);
    const bottom = box.y + box.height - bottomAxisHeight(theme, true);
    const xs = linear([0, 100], [x0, x1]);
    const rows = rowsIn(top, bottom, groups.length);
    const body: El[] = [...categoryLabels(labels, rows, x0, box.width * 0.35, theme)];
    body.push(...bottomAxis({ box, left: x0, right: x1, y: bottom, scale: xs, ticks: PERCENT_LABELS, title: "Finished sessions complete (%)", theme }));
    body.push(line(x0, top, x0, bottom, theme.palette.ink, theme.stroke.axis));
    if (items.length && overall !== null) body.push(line(xs(overall * 100), top, xs(overall * 100), bottom, theme.palette.ink, theme.stroke.reference, "2 1.5"));
    const colour = theme.palette.primary;
    ci.forEach((c, i) => {
      const cy = rows.centre(i);
      const cap = theme.stroke.cap / 2;
      body.push(line(xs(c.lo * 100), cy, xs(c.hi * 100), cy, theme.palette.ink, theme.stroke.error));
      body.push(line(xs(c.lo * 100), cy - cap, xs(c.lo * 100), cy + cap, theme.palette.ink, theme.stroke.error));
      body.push(line(xs(c.hi * 100), cy - cap, xs(c.hi * 100), cy + cap, theme.palette.ink, theme.stroke.error));
      body.push(el("circle", { cx: xs(c.p * 100), cy, r: theme.pointRadius, fill: colour }));
      body.push(
        el(
          "text",
          { x: box.x + box.width, y: centreBaseline(cy, theme.size.tick), "font-size": theme.size.tick, "text-anchor": "end" },
          el("tspan", { "font-style": "italic" }, "n"),
          ` = ${formatNumber(groups[i]!.finished)}`,
        ),
      );
    });
    body.push(...drawLegend(legend, x0, box, theme));
    const small = groups.filter((g) => g.finished < 10);
    return {
      body,
      legend:
        `Proportion of finished sessions that were complete, by ${spec.group === "site" ? "site" : "survey version"}. ` +
        `Points show the proportion and error bars its 95% confidence interval (Wilson score)` +
        (items.length && overall !== null ? `; the dashed line marks all finished sessions (${formatPercent(overall)}).` : ".") +
        ` n, finished sessions.`,
      notes: [
        "Finished sessions are those complete, incomplete or abandoned.",
        INVALID_NOTE,
        ...(spec.group === "site" && spec.siteLabels === "anonymised" ? ["Sites are numbered by number of sessions, largest first."] : []),
      ],
      source: {
        title,
        columns: [spec.group === "site" ? "Site" : "Survey version", "Finished sessions", "Complete", "Proportion complete", "95% CI lower", "95% CI upper"],
        rows: groups.map((g, i) => [g.label, g.finished, g.complete, round4(ci[i]!.p), round4(ci[i]!.lo), round4(ci[i]!.hi)]),
      },
      warnings: [
        ...(small.length ? [`${title}: ${small.map((g) => g.label).join(", ")} ha${small.length === 1 ? "s" : "ve"} fewer than 10 finished sessions — the intervals are wide.`] : []),
        ...(spec.group === "site" && spec.siteLabels === "codes" ? ["Site codes can identify schools. Use anonymised labels in anything you publish."] : []),
      ],
    };
  },
};

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

// ── Reach and completion by section ────────────────────────────────────────────

function sectionRows(spec: PanelOf<"sections">, ctx: FigureContext) {
  const secs = ctx.analytics?.sections ?? [];
  return spec.measure === "reached" ? secs.filter((s) => s.sessionsApplicable > 0) : secs.filter((s) => s.required > 0);
}

const sections: PanelBuilder<"sections"> = {
  name: "Reach or completion by section",
  preferredHeight: (spec, ctx, width, theme) => {
    const rows = sectionRows(spec, ctx);
    return rowsHeight(rows.length, theme, 1, rowPitch(rows.map((s) => s.title), width * SECTION_CAP, theme, ROW));
  },
  render(spec, ctx, full, theme) {
    const box = fit(full, sections.preferredHeight(spec, ctx, full.width, theme));
    const rowsData = sectionRows(spec, ctx);
    const reached = spec.measure === "reached";
    const title = reached ? "Sessions reaching each section" : "Required answers given, by section";
    if (rowsData.length === 0) return empty(box, theme, "No sections to show under these filters", title, "Sections: nothing to show.");
    const values = rowsData.map((s) => (reached ? (s.sessionsReached / s.sessionsApplicable) * 100 : (s.resolved / s.required) * 100));
    return {
      body: percentBars({
        box,
        theme,
        labels: rowsData.map((s) => s.title),
        values,
        valueLabels: values.map((v) => `${formatNumber(v)}%`),
        xTitle: reached ? "Sessions reaching section (%)" : "Required answers given (%)",
        labelCap: box.width * SECTION_CAP,
      }),
      legend: reached
        ? "Percentage of sessions that reached each section of the survey, in questionnaire order, among sessions to which the section applied."
        : "Percentage of required answers given (answered or declined) in each section, pooled across sessions, in questionnaire order.",
      notes: [
        reached
          ? "A section is reached when any of its questions was shown or answered; it applies when at least one of its questions applied to the participant."
          : `Required questions are those marked ${ctx.requiredLevels.join(" or ")}-required; questions hidden by the survey's branching are not counted.`,
        INVALID_NOTE,
      ],
      source: {
        title,
        columns: ["Section", "Sessions applicable", "Sessions reached", "Reached (%)", "Required answers due", "Given", "Given (%)"],
        rows: rowsData.map((s) => [s.title, s.sessionsApplicable, s.sessionsReached, pct1(s.sessionsReached, s.sessionsApplicable), s.required, s.resolved, pct1(s.resolved, s.required)]),
      },
      warnings: [],
    };
  },
};

// ── Item outcomes ──────────────────────────────────────────────────────────────

const notAnswered = (q: QuestionStat) => q.skipped + q.noResponse + q.invalid + q.eligibleNotShown;

function itemRows(spec: PanelOf<"items">, ctx: FigureContext): { shown: QuestionStat[]; total: number } {
  const data = ctx.questions[spec.version];
  if (!data) return { shown: [], total: 0 };
  const pool = data.stats.filter((q) => q.eligible > 0 && (!spec.requiredOnly || q.countsAsRequired) && (!spec.section || q.sectionKey === spec.section));
  const sorted =
    spec.order === "lowest"
      ? [...pool].sort((a, b) => a.answered / a.eligible - b.answered / b.eligible || a.order - b.order)
      : [...pool].sort((a, b) => a.order - b.order);
  return { shown: sorted.slice(0, spec.limit), total: pool.length };
}

const items: PanelBuilder<"items"> = {
  name: "Item outcomes",
  preferredHeight: (spec, ctx, width, theme) => {
    const { shown } = itemRows(spec, ctx);
    const labels = shown.map((q) => (spec.labels === "variable" ? q.variable : q.text));
    return rowsHeight(shown.length, theme, width < 200 ? 2 : 1, rowPitch(labels, width * ITEM_CAP, theme, 9));
  },
  render(spec, ctx, full, theme) {
    const box = fit(full, items.preferredHeight(spec, ctx, full.width, theme));
    const { shown, total } = itemRows(spec, ctx);
    const version = ctx.versionLabel(spec.version);
    const title = `Question outcomes (${version})`;
    if (!ctx.questions[spec.version]) return empty(box, theme, "Choose a survey version for this panel", title, "Item outcomes: no survey version chosen.");
    if (shown.length === 0) return empty(box, theme, "No questions match this panel's settings", title, "Item outcomes: no questions match.");
    const p = theme.palette;
    const parts = [
      { label: "Answered", colour: p.answered, of: (q: QuestionStat) => q.answered },
      { label: "Declined", colour: p.declined, of: (q: QuestionStat) => q.declined },
      { label: "Not answered", colour: p.unanswered, of: notAnswered },
      { label: "Not reached", colour: p.notReached, of: (q: QuestionStat) => q.notReached },
    ];
    const labels = shown.map((q) => (spec.labels === "variable" ? q.variable : q.text));
    const cap = box.width * ITEM_CAP;
    const x0 = box.x + categoryLabelWidth(labels, cap, theme);
    const x1 = box.x + box.width - endPad("100", theme);
    const legend = legendRows(parts.map((x) => ({ label: x.label, swatch: "box", colour: x.colour })), box.x + box.width - x0, theme);
    const top = box.y + topFor(legend);
    const bottom = box.y + box.height - bottomAxisHeight(theme, true);
    const xs = linear([0, 100], [x0, x1]);
    const rows = rowsIn(top, bottom, shown.length);
    const thickness = Math.min(6, rows.pitch * 0.7);
    const body: El[] = [...categoryLabels(labels, rows, x0, cap, theme)];
    shown.forEach((q, i) => {
      const cy = rows.centre(i);
      let acc = 0;
      for (const part of parts) {
        const v = (part.of(q) / q.eligible) * 100;
        if (v <= 0) continue;
        const a = xs(acc);
        const b = xs(acc + v);
        const isLast = acc + v >= 99.999;
        const bar = hbar(a, isLast ? b : Math.max(a, b - theme.gap), cy, thickness, part.colour);
        if (bar) body.push(bar);
        acc += v;
      }
    });
    body.push(...bottomAxis({ box, left: x0, right: x1, y: bottom, scale: xs, ticks: PERCENT_LABELS, title: "Applicable sessions (%)", theme }));
    body.push(line(x0, top, x0, bottom, theme.palette.ink, theme.stroke.axis));
    body.push(...drawLegend(legend, x0, box, theme));
    const which = spec.requiredOnly ? "required question" : "question";
    const scope = spec.section ? ` in the section "${shown[0]!.sectionTitle}"` : "";
    const ordering =
      shown.length < total
        ? spec.order === "lowest"
          ? `; the ${shown.length} of ${total} ${which}s${scope} with the lowest answered percentage`
          : `; the first ${shown.length} of ${total} ${which}s${scope} in questionnaire order`
        : spec.order === "lowest"
          ? `${scope}, lowest answered percentage first`
          : `${scope}, in questionnaire order`;
    return {
      body,
      legend: `Outcome of each ${which} in survey ${version}, as a percentage of the sessions to which it applied${ordering}.`,
      notes: [
        "Declined, the participant chose a 'prefer not to say' option; not answered, skipped, left blank, recorded with an invalid value or due but not shown; not reached, the session ended before the question. Questions hidden by the survey's branching are not counted.",
      ],
      source: {
        title,
        columns: ["Question ID", "Variable", "Question", "Section", "Sessions applicable", "Answered", "Declined", "Not answered", "Not reached", "Answered (%)"],
        rows: shown.map((q) => [q.key, q.variable, q.text, q.sectionTitle, q.eligible, q.answered, q.declined, notAnswered(q), q.notReached, pct1(q.answered, q.eligible)]),
      },
      warnings: shown.some((q) => q.eligible < 10) ? [`${title}: some questions applied to fewer than 10 sessions.`] : [],
    };
  },
};

// ── One question's answers ─────────────────────────────────────────────────────

function questionOf(spec: PanelOf<"responses">, ctx: FigureContext): QuestionStat | undefined {
  return ctx.questions[spec.version]?.stats.find((q) => q.key === spec.question);
}

const responses: PanelBuilder<"responses"> = {
  name: "Answers to one question",
  preferredHeight(spec, ctx, width, theme) {
    const d = questionOf(spec, ctx)?.distribution;
    if (d?.kind === "options") return rowsHeight(d.options.length, theme, 1, rowPitch(d.options.map((o) => o.label), width * ITEM_CAP, theme, 11));
    return clamp(width * 0.6, 100, 160);
  },
  render(spec, ctx, box, theme) {
    const q = questionOf(spec, ctx);
    const version = ctx.versionLabel(spec.version);
    const title = q ? `Answers to ${q.variable} (${version})` : "Answers to one question";
    if (!ctx.questions[spec.version]) return empty(box, theme, "Choose a survey version for this panel", title, "Answers: no survey version chosen.");
    if (!q) return empty(box, theme, "Choose a question for this panel", title, "Answers: no question chosen.");
    const d = q.distribution;
    if (d.kind === "none") return empty(box, theme, d.reason, title, `Answers: ${d.reason}`);
    if (d.total === 0) return empty(box, theme, "No answers under these filters", title, "Answers: no answers to plot.");
    const quoted = `“${q.text.replace(/\s+/g, " ").trim()}”`;
    if (d.kind === "options") {
      const fitted = fit(box, responses.preferredHeight(spec, ctx, box.width, theme));
      const values = d.options.map((o) => (o.count / d.total) * 100);
      const unknown = d.unknownCodes.reduce((s, u) => s + u.count, 0);
      return {
        body: percentBars({
          box: fitted,
          theme,
          labels: d.options.map((o) => o.label),
          values,
          valueLabels: values.map((v) => `${formatNumber(v)}%`),
          xTitle: "Respondents (%)",
          labelCap: box.width * ITEM_CAP,
        }),
        legend:
          `Answers to ${quoted} (${q.variable}; survey ${version}; n = ${formatNumber(d.total)} respondents)` +
          (d.multi ? "; respondents could choose more than one option, so percentages can sum to more than 100%." : "."),
        notes: [],
        source: {
          title,
          columns: ["Option code", "Option", "Respondents", "Percentage of respondents"],
          rows: d.options.map((o) => [o.code, o.label, o.count, pct1(o.count, d.total)]),
        },
        warnings: unknown ? [`${title}: ${unknown} answer(s) carry an option code this version does not define and are not drawn.`] : [],
      };
    }
    // Numeric scale: columns, one per value or bin, with the median marked.
    const bins = d.bins;
    const yMax = Math.max(1, ...bins.map((b) => (b.count / d.total) * 100));
    const yt = niceTicks(0, yMax, 4);
    const yLabels = yt.values.map((v) => ({ value: v, label: formatNumber(v, decimalsFor(yt.step)) }));
    const x0 = box.x + leftAxisWidth(yLabels, theme, true);
    const x1 = box.x + box.width - RIGHT_PAD;
    const top = box.y + topFor([]);
    const bottom = box.y + box.height - bottomAxisHeight(theme, true);
    const ys = linear([0, yt.max], [bottom, top]);
    const slot = (x1 - x0) / bins.length;
    const xs = (i: number) => x0 + slot * (i + 0.5);
    const body: El[] = [];
    body.push(...leftAxis({ box, x: x0, top, bottom, scale: ys, ticks: yLabels, title: "Respondents (%)", theme }));
    bins.forEach((b, i) => {
      const h = (b.count / d.total) * 100;
      const w = Math.min(slot * 0.72, 14);
      if (h > 0) body.push(el("rect", { x: xs(i) - w / 2, y: ys(h), width: w, height: ys(0) - ys(h), fill: theme.palette.primary }));
    });
    const tickScale = (v: number) => xs(v);
    const tickLabels = thinTicks(bins.map((b, i) => ({ value: i, label: b.label })), tickScale, theme);
    body.push(...bottomAxis({ box, left: x0, right: x1, y: bottom, scale: tickScale, ticks: tickLabels, title: "Answer", theme }));
    if (d.median !== null) {
      // Position the median along the value axis the columns represent.
      const idx = bins.findIndex((b) => d.median! >= b.from && d.median! <= b.to);
      if (idx >= 0) {
        const b = bins[idx]!;
        const frac = b.to > b.from ? (d.median - b.from) / (b.to - b.from) : 0.5;
        const mx = b.to > b.from ? x0 + slot * (idx + frac) : xs(idx);
        body.push(line(mx, top, mx, bottom, theme.palette.ink, theme.stroke.reference, "2 1.5"));
        const label = `Median ${formatNumber(d.median, Number.isInteger(d.median) ? 0 : 1)}`;
        const fitsRight = mx + 2 + textWidth(label, theme.size.note) <= x1;
        body.push(text(fitsRight ? mx + 2 : mx - 2, top + theme.size.note, label, theme, { size: theme.size.note, anchor: fitsRight ? "start" : "end" }));
      }
    }
    return {
      body,
      legend: `Answers to ${quoted} (${q.variable}; survey ${version}; n = ${formatNumber(d.total)} respondents). The dashed line marks the median.`,
      notes: [],
      source: {
        title,
        columns: ["Answer", "From", "To", "Respondents", "Percentage of respondents"],
        rows: bins.map((b) => [b.label, b.from, b.to, b.count, pct1(b.count, d.total)]),
      },
      warnings: [],
    };
  },
};

// ── Completion time ────────────────────────────────────────────────────────────

const duration: PanelBuilder<"duration"> = {
  name: "Completion time",
  preferredHeight: (_s, _c, width) => clamp(width * 0.6, 105, 165),
  render(_spec, ctx, box, theme) {
    const d = ctx.analytics?.durationDistribution ?? null;
    const title = "Completion time";
    if (!d) return empty(box, theme, "Fewer than 5 timed, complete sessions", title, "Completion time: fewer than 5 complete, uninterrupted sessions to plot.");
    const yMax = Math.max(1, ...d.bins.map((b) => b.count));
    const yt = niceTicks(0, yMax, 4, true);
    const yLabels = yt.values.map((v) => ({ value: v, label: formatNumber(v) }));
    const x0 = box.x + leftAxisWidth(yLabels, theme, true);
    const xt = niceTicks(0, d.overflowFromMin, 5, d.overflowFromMin >= 5);
    const lastX = xt.values.filter((v) => v <= d.overflowFromMin).at(-1) ?? 0;
    const x1 = box.x + box.width - (lastX === d.overflowFromMin ? endPad(formatNumber(lastX, decimalsFor(xt.step)), theme) : RIGHT_PAD);
    const top = box.y + topFor([]);
    const bottom = box.y + box.height - bottomAxisHeight(theme, true);
    const ys = linear([0, yt.max], [bottom, top]);
    const xs = linear([0, d.overflowFromMin], [x0, x1]);
    const xLabels = thinTicks(
      xt.values.filter((v) => v <= d.overflowFromMin).map((v) => ({ value: v, label: formatNumber(v, decimalsFor(xt.step)) })),
      xs,
      theme,
    );
    const body: El[] = [];
    body.push(...leftAxis({ box, x: x0, top, bottom, scale: ys, ticks: yLabels, title: "Sessions", theme }));
    for (const b of d.bins) {
      if (b.count === 0) continue;
      const a = xs(b.fromMin) + theme.gap / 2;
      const w = xs(b.toMin) - xs(b.fromMin) - theme.gap;
      body.push(el("rect", { x: a, y: ys(b.count), width: Math.max(0.2, w), height: ys(0) - ys(b.count), fill: theme.palette.primary }));
    }
    body.push(...bottomAxis({ box, left: x0, right: x1, y: bottom, scale: xs, ticks: xLabels, title: "Completion time (min)", theme }));
    const mx = xs(d.medianMin);
    body.push(line(mx, top, mx, bottom, theme.palette.ink, theme.stroke.reference, "2 1.5"));
    const label = `Median ${formatNumber(d.medianMin, d.medianMin < 10 ? 1 : 0)} min`;
    const fitsRight = mx + 2 + textWidth(label, theme.size.note) <= x1;
    body.push(text(fitsRight ? mx + 2 : mx - 2, top + theme.size.note, label, theme, { size: theme.size.note, anchor: fitsRight ? "start" : "end" }));
    const f1 = (v: number) => formatNumber(v, v < 10 ? 1 : 0);
    return {
      body,
      legend:
        `Time taken by the ${formatNumber(d.n)} complete sessions that were never interrupted and resumed, in ${formatNumber(d.binMinutes, d.binMinutes < 1 ? 1 : 0)}-min bins; ` +
        `the dashed line marks the median (${f1(d.medianMin)} min; interquartile range ${f1(d.q1Min)}–${f1(d.q3Min)} min).` +
        (d.overflow ? ` ${formatNumber(d.overflow)} session${d.overflow === 1 ? "" : "s"} taking ${formatNumber(d.overflowFromMin)} min or longer ${d.overflow === 1 ? "is" : "are"} not drawn.` : ""),
      notes: ["Completion time is measured by the participant's device, from the start of the session to its completion."],
      source: {
        title,
        columns: ["From (min)", "To (min)", "Sessions"],
        rows: [...d.bins.map((b) => [b.fromMin, b.toMin, b.count]), [d.overflowFromMin, null, d.overflow]],
      },
      warnings: d.n < 20 ? [`Completion time: only ${d.n} timed sessions — the histogram is coarse.`] : [],
    };
  },
};

export const PANELS: { [K in PanelKind]: PanelBuilder<K> } = { participation, status, completion, sections, items, responses, duration, ...SCORE_PANELS };

export const PANEL_NAMES: Record<PanelKind, string> = Object.fromEntries(
  Object.entries(PANELS).map(([k, b]) => [k, b.name]),
) as Record<PanelKind, string>;
