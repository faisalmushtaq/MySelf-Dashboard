import {
  composeFigure,
  formatNumber,
  OBSERVATION_LABELS,
  parseFigureSpec,
  SCHEME_STATUS_LABELS,
  type Comparison,
  type FigureContext,
  type SchoolReportRow,
  type SchoolReportView,
  type ScoreOutput,
  type ScoreSummary,
  type ScoringScheme,
} from "@myself-dashboard/core";
import { C, formatWhen, Report, type Row, type Tone } from "./report.js";

/**
 * The report for one school (or one year group in it): how its pupils'
 * scores compare with the other schools combined and with published
 * benchmarks. Written to be shared with the school: group averages only, no
 * distributions of individual scores, other schools never named, and any
 * group below the study's minimum size withheld.
 */

export interface SchoolReportInput {
  view: SchoolReportView;
  figureBase: Omit<FigureContext, "analytics" | "questions" | "scores">;
  generatedBy: string;
  generatedAt: Date;
  timeZone: string;
  period: string;
  filters: string[];
}

const fmt = (o: ScoreOutput, v: number | null | undefined) => (v === null || v === undefined ? "–" : formatNumber(v, Math.max(1, o.decimals)).replace(/^-/, "−"));
const withCi = (o: ScoreOutput, s: ScoreSummary | null) => (s ? `${fmt(o, s.mean)}${s.ci ? ` (${fmt(o, s.ci[0])} to ${fmt(o, s.ci[1])})` : ""}` : "–");
const pct = (v: number) => `${Math.round(v * 100)}%`;

function difference(o: ScoreOutput, c: Comparison | null): { text: string; sub?: string; color?: string } {
  if (!c) return { text: "–" };
  const d = fmt(o, c.difference);
  const sign = c.difference > 0 ? "+" : "";
  const clear = c.ci ? c.ci[0] > 0 || c.ci[1] < 0 : false;
  const worse = o.higherIs === "neutral" ? false : o.higherIs === "better" ? c.difference < 0 : c.difference > 0;
  return {
    text: `${sign}${d}`,
    ...(c.ci ? { sub: `95% CI ${fmt(o, c.ci[0])} to ${fmt(o, c.ci[1])}${clear ? "" : " · could be chance"}` } : {}),
    ...(clear && o.higherIs !== "neutral" ? { color: worse ? C.danger : C.accent } : {}),
  };
}

function versusBenchmark(o: ScoreOutput, row: SchoolReportRow): { text: string; sub?: string } {
  const b = o.benchmarks[0];
  const c = b ? row.vsBenchmarks[b.key] : undefined;
  if (!b || !c) return { text: "–" };
  const sd = c.standardised;
  const size = sd !== null ? `${formatNumber(Math.abs(sd), 2)} SD` : fmt(o, Math.abs(c.difference));
  return { text: `${size} ${c.difference >= 0 ? "above" : "below"}`, sub: `${b.label} (mean ${fmt(o, b.mean)})` };
}

/** Share of the group in the bands that signal the most concern (level 2 or 3). */
function concernShare(o: ScoreOutput, s: ScoreSummary | null): string {
  const t = o.thresholds[0];
  if (!t || !s) return "–";
  const idx = t.bands.map((b, i) => (b.level !== null && b.level >= 2 ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return "–";
  return pct(idx.reduce((a, i) => a + (s.bands[t.key]?.[i]?.share ?? 0), 0));
}

function concernLabel(o: ScoreOutput): string | null {
  const t = o.thresholds[0];
  if (!t) return null;
  const names = t.bands.filter((b) => b.level !== null && b.level >= 2).map((b) => b.label.toLowerCase());
  return names.length ? names.join(" or ") : null;
}

const primary = (s: ScoringScheme) => s.outputs.find((o) => o.primary) ?? s.outputs[0]!;

export function schoolReportPdf(input: SchoolReportInput): Promise<Buffer> {
  const { view, timeZone } = input;
  const generated = `${formatWhen(input.generatedAt.toISOString(), timeZone)} (${timeZone})`;
  const r = new Report({
    title: `MySelf school report: ${view.label}`,
    kind: "School report",
    author: input.generatedBy,
    footer: `${view.label}. Generated ${generated} by ${input.generatedBy}. Group averages only: no pupil can be identified from this report, and groups of fewer than ${view.minCell} are withheld.`,
  });
  const schemes = view.chartView.schemes;
  const row = (scheme: string, output: string) => view.rows.find((x) => x.scheme === scheme && x.output === output)!;
  const reported = schemes.filter((s) => s.outputs.some((o) => !row(s.key, o.key).withheld));
  // Measures with a direction (wellbeing, difficulties, use) are benchmarked; descriptive ones (handedness, status ladders) are listed at the end.
  // Published norms first, then published bands, then conventional or study bands, then the rest.
  const rank = (s: ScoringScheme) => {
    const o = primary(s);
    const concern = (basis: string) => o.thresholds.some((t) => t.basis === basis && t.bands.some((b) => b.level !== null && b.level >= 2));
    const evidence = o.benchmarks.length ? 0 : concern("published") ? 1 : concern("convention") || concern("study") ? 2 : 3;
    return (o.higherIs === "neutral" ? 100 : 0) + evidence * 10 + ["official", "adapted", "study"].indexOf(s.status);
  };
  const byRank = [...reported].sort((a, b) => rank(a) - rank(b));
  const ordered = byRank.filter((s) => primary(s).higherIs !== "neutral");
  const descriptive = byRank.filter((s) => primary(s).higherIs === "neutral");

  r.titleBlock("School report", `${view.label}  ·  ${input.period}`);
  r.facts([
    ["School", view.schoolName],
    ["Year group", view.yearGroup === null ? "All year groups" : `Year ${view.yearGroup}`],
    ["Pupils", `${formatNumber(view.counts.pupils)} (${OBSERVATION_LABELS[view.observation].toLowerCase()})`],
    ["Compared with", view.comparisonsShown ? `${view.othersLabel}: ${formatNumber(view.counts.otherSchools)} schools, ${formatNumber(view.counts.otherPupils)} pupils` : "Published benchmarks only — fewer than two other schools took part"],
    ["Period", input.period],
    ["Filters", input.filters.join("; ") || "None"],
    ["Generated", `${generated} by ${input.generatedBy}`],
    ["Measures reported", `${ordered.length + descriptive.length} of ${schemes.length}`],
  ]);

  r.callout("neutral", "How to read this report", [
    "Every figure is an average for a group of pupils. No individual pupil's answers are shown or can be worked out, and any group of fewer than " + view.minCell + " pupils is withheld.",
    "Threshold bands describe how scores are spread in a reference population. They are screening information about a group, not a diagnosis of any pupil.",
    "Differences come with 95% confidence intervals. Where an interval includes zero, the difference could be down to chance.",
    ...(view.comparisonsShown ? [`'${view.othersLabel}' combines the other schools; none is named.`] : []),
  ]);

  // At a glance.
  r.heading(null, "At a glance", 120);
  const glance: Row[] = ordered.map((s) => {
    const o = primary(s);
    const x = row(s.key, o.key);
    if (x.withheld) return { cells: [{ text: s.abbreviation ?? s.name, sub: o.label }, { text: `Withheld — fewer than ${view.minCell} pupils`, italic: true, color: C.muted }, null, null, null, null] };
    const d = difference(o, x.vsOthers);
    const bench = versusBenchmark(o, x);
    return {
      cells: [
        { text: s.abbreviation ?? s.name, sub: `${o.label}; ${o.higherIs === "better" ? "higher is better" : o.higherIs === "worse" ? "higher is more difficulty" : "descriptive"}` },
        { text: withCi(o, x.school), sub: `n = ${formatNumber(x.n)}` },
        view.comparisonsShown ? withCi(o, x.others) : null,
        { text: d.text, ...(d.sub ? { sub: d.sub } : {}), ...(d.color ? { color: d.color } : {}) },
        { text: bench.text, ...(bench.sub ? { sub: bench.sub } : {}) },
        concernLabel(o)
          ? { text: concernShare(o, x.school), sub: `${concernLabel(o)}${view.comparisonsShown && x.others ? ` · others ${concernShare(o, x.others)}` : ""}${o.thresholds[0]?.expected ? ` · expected ${pct(o.thresholds[0].bands.reduce((a, b, i) => a + (b.level !== null && b.level >= 2 ? o.thresholds[0]!.expected![i]! : 0), 0))}` : ""}` }
          : null,
      ],
    };
  });
  r.table(
    [
      { header: "Measure", width: 23 },
      { header: "This school (95% CI)", width: 17 },
      { header: view.comparisonsShown ? view.othersLabel : "Other schools", width: 15 },
      { header: "Difference", width: 15 },
      { header: "Against benchmark", width: 16 },
      { header: "High-concern bands", width: 14 },
    ],
    glance,
    { empty: `No measure had scores for at least ${view.minCell} pupils.` },
  );
  if (view.withheldYearGroups) r.paragraph(`${view.withheldYearGroups} year group${view.withheldYearGroups === 1 ? " has" : "s have"} fewer than ${view.minCell} pupils and ${view.withheldYearGroups === 1 ? "is" : "are"} not shown separately.`, { italic: true, color: C.muted });

  // One section per measure.
  ordered.forEach((s, i) => {
    const o = primary(s);
    r.heading(String(i + 1), `${s.name}${s.abbreviation ? ` (${s.abbreviation})` : ""}`, 200);
    r.paragraph(
      `${SCHEME_STATUS_LABELS[s.status]}${s.verified ? `, checked against the scoring documents by ${s.verified.by}` : ", not yet checked against the licensed scoring documents"}. ${s.method}`,
      { size: 8, after: 4 },
    );
    const panels = [
      { kind: "score_groups", scheme: s.key, output: o.key, benchmark: "" },
      ...(o.thresholds.length ? [{ kind: "score_bands", scheme: s.key, output: o.key, thresholds: "" }] : []),
    ];
    if (!row(s.key, o.key).withheld) {
      const figure = composeFigure(
        parseFigureSpec({ width: "double", colour: "colour", number: i + 1, title: `${s.abbreviation ?? s.name}: ${o.label}, ${view.label}`, panels }),
        { ...input.figureBase, analytics: null, questions: {}, scores: view.chartView },
      );
      r.figure(figure.svg, figure.widthPt, figure.heightPt, figure.legend);
    }
    const tone = (x: SchoolReportRow): Tone | undefined => (x.withheld ? "muted" : undefined);
    r.table(
      [
        { header: "Score", width: 26 },
        { header: "This school (95% CI)", width: 20 },
        { header: view.comparisonsShown ? view.othersLabel : "Other schools", width: 18 },
        { header: "Difference", width: 18 },
        { header: "Against benchmark", width: 18 },
      ],
      s.outputs.map((out): Row => {
        const x = row(s.key, out.key);
        if (x.withheld) return { cells: [{ text: out.label }, { text: `Withheld (fewer than ${view.minCell})`, italic: true, color: C.muted }, null, null, null], ...(tone(x) ? { tone: tone(x)! } : {}) };
        const d = difference(out, x.vsOthers);
        const b = versusBenchmark(out, x);
        return {
          cells: [
            { text: out.label, sub: `n = ${formatNumber(x.n)}; range ${out.range[0]}–${out.range[1]}` },
            withCi(out, x.school),
            view.comparisonsShown ? withCi(out, x.others) : null,
            { text: d.text, ...(d.sub ? { sub: d.sub } : {}), ...(d.color ? { color: d.color } : {}) },
            { text: b.text, ...(b.sub ? { sub: b.sub } : {}) },
          ],
        };
      }),
    );
  });

  if (descriptive.length) {
    r.heading(String(ordered.length + 1), "Other measures", 80);
    r.paragraph("Descriptive measures, where neither a higher nor a lower score is better: shown as averages only.", { size: 8 });
    r.table(
      [
        { header: "Measure", width: 40 },
        { header: "This school (95% CI)", width: 30 },
        { header: view.comparisonsShown ? view.othersLabel : "Other schools", width: 30 },
      ],
      descriptive.flatMap((s) =>
        s.outputs.map((out): Row => {
          const x = row(s.key, out.key);
          return x.withheld
            ? { cells: [{ text: `${s.abbreviation ?? s.name}: ${out.label}` }, { text: `Withheld (fewer than ${view.minCell})`, italic: true, color: C.muted }, null] }
            : { cells: [{ text: `${s.abbreviation ?? s.name}: ${out.label}`, sub: `n = ${formatNumber(x.n)}` }, withCi(out, x.school), view.comparisonsShown ? withCi(out, x.others) : null] };
        }),
      ),
    );
  }

  // Sources.
  const sources: [string, string][] = [];
  for (const s of ordered) {
    for (const o of s.outputs) {
      for (const t of o.thresholds) sources.push([`${s.abbreviation ?? s.name}: ${t.label}`, `${t.source}${t.verified ? "" : " (not yet verified)"}`]);
      for (const b of o.benchmarks) sources.push([`${s.abbreviation ?? s.name}: ${b.label}`, `${b.population}. ${b.source}${b.verified ? "" : " (not yet verified)"}`]);
    }
  }
  const unique = [...new Map(sources.map((x) => [x.join("|"), x])).values()];
  if (unique.length) {
    r.heading(null, "Thresholds and benchmarks", Math.min(160, r.definitionsHeight(unique)));
    r.definitions(unique);
  }
  r.paragraph(`Scoring schemes: ${schemes.map((s) => `${s.key} v${s.version}`).join(", ")}.`, { size: 7.5, color: C.muted });
  return r.finish();
}
