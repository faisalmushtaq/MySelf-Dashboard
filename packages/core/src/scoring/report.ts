import { compareToBenchmark, compareToGroup, pickObservations, summarise, type Comparison, type Observation, type ScoreSummary } from "./aggregate.js";
import type { ScoredRow, ScoreResult, ScoresView } from "./benchmark.js";
import { schoolLabel, yearGroupLabel, type GroupSettings } from "./groups.js";
import type { ScoringScheme } from "./scheme.js";

/**
 * A report for one school, or one year group in it, to be shared outside the
 * research team: this school against the other schools combined and against
 * the benchmarks, and its own year groups. Other schools are never named, no
 * distribution of individual scores is shown, and any group smaller than the
 * study's minimum cell size is withheld rather than reported.
 */

export interface SchoolReportRow {
  scheme: string;
  output: string;
  /** Null when the school's group is below the minimum size: the score is withheld. */
  school: ScoreSummary | null;
  others: ScoreSummary | null;
  all: ScoreSummary | null;
  vsOthers: Comparison | null;
  vsBenchmarks: Record<string, Comparison>;
  withheld: boolean;
  /** Pupils in the school's group who have this score (reported only when not withheld). */
  n: number;
}

export interface SchoolReportView {
  school: string;
  schoolName: string;
  yearGroup: number | null;
  label: string;
  othersLabel: string;
  allLabel: string;
  minCell: number;
  observation: Observation;
  counts: { pupils: number; otherSchools: number; otherPupils: number };
  /** For the report's charts: overall = all schools; groups = this school, the others, and the school's year groups (large enough ones only). */
  chartView: ScoresView;
  rows: SchoolReportRow[];
  /** Year groups in the school left out for being too small. */
  withheldYearGroups: number;
  /** False when fewer than two other schools took part, so no comparison with other schools is shown. */
  comparisonsShown: boolean;
}

export function buildSchoolReportView(
  scored: readonly ScoredRow[],
  input: { schemes: readonly ScoringScheme[]; settings: GroupSettings; observation: Observation; school: string; yearGroup: number | null; now: Date },
): SchoolReportView {
  const { settings, school, yearGroup } = input;
  const rows = pickObservations(scored, input.observation).filter((r) => (yearGroup === null ? true : r.yearGroup === yearGroup));
  const mine = rows.filter((r) => r.school === school);
  const others = rows.filter((r) => r.school !== null && r.school !== school);
  const schoolName = schoolLabel(school, settings);
  const label = yearGroup === null ? schoolName : `${schoolName}, ${yearGroupLabel(yearGroup)}`;
  const othersLabel = yearGroup === null ? "Other schools" : `${yearGroupLabel(yearGroup)}, other schools`;
  const allLabel = yearGroup === null ? "All schools" : `${yearGroupLabel(yearGroup)}, all schools`;
  // With fewer than two other schools, "other schools" is one school and "all schools" gives it away by subtraction.
  const otherSchools = new Set(others.map((r) => r.school)).size;
  const compareShown = otherSchools >= 2;
  const years = yearGroup === null ? [...new Set(mine.map((r) => r.yearGroup).filter((y): y is number => y !== null))].sort((a, b) => a - b) : [];

  const results: ScoreResult[] = [];
  const reportRows: SchoolReportRow[] = [];
  let withheldYearGroups = 0;
  for (const scheme of input.schemes) {
    for (const output of scheme.outputs) {
      const pick = (list: readonly ScoredRow[]) =>
        list.filter((r) => r.scores[scheme.key]).map((r) => {
          const v = r.scores[scheme.key]!.outputs[output.key];
          return { value: v?.value ?? null, bands: v?.bands ?? {} };
        });
      const s = summarise(pick(mine), output);
      const o = compareShown ? summarise(pick(others), output) : null;
      const a = compareShown ? summarise(pick(rows), output) : null;
      const withheld = !s || s.n < settings.minCell;
      const bench = (x: ScoreSummary | null) => (x ? Object.fromEntries(output.benchmarks.map((b) => [b.key, compareToBenchmark(x, b)])) : {});
      reportRows.push({
        scheme: scheme.key,
        output: output.key,
        school: withheld ? null : s,
        others: o && o.n >= settings.minCell ? o : null,
        all: a,
        vsOthers: !withheld && o && o.n >= settings.minCell ? compareToGroup(s!, o) : null,
        vsBenchmarks: withheld ? {} : bench(s),
        withheld,
        n: withheld ? 0 : s!.n,
      });
      const groups: ScoreResult["groups"] = [];
      if (!withheld) groups.push({ key: school, label: yearGroup === null ? "This school" : `This school, ${yearGroupLabel(yearGroup)}`, n: s!.n, small: false, summary: s });
      if (o && o.n >= settings.minCell) groups.push({ key: "others", label: othersLabel, n: o.n, small: false, summary: o });
      for (const y of years) {
        const ys = summarise(pick(mine.filter((r) => r.yearGroup === y)), output);
        if (!ys || ys.n < settings.minCell) {
          if (scheme === input.schemes[0] && output === scheme.outputs[0] && ys) withheldYearGroups += 1;
          continue;
        }
        groups.push({ key: String(y), label: `This school, ${yearGroupLabel(y)}`, n: ys.n, small: false, summary: ys });
      }
      results.push({ scheme: scheme.key, output: output.key, overall: a, vsBenchmarks: bench(a), groups, ...(withheld ? {} : { focus: { summary: s, peers: o, vsPeers: null, vsBenchmarks: bench(s), small: false } }) });
    }
  }

  const chartView: ScoresView = {
    overallLabel: allLabel,
    groupsDescription: `for ${label}${compareShown ? `, ${othersLabel.toLowerCase()} and ${allLabel.toLowerCase()}` : ""}${yearGroup === null ? ", and the school's year groups" : ""}`,
    computedAt: input.now.toISOString(),
    observation: input.observation,
    groupBy: "school",
    minCell: settings.minCell,
    counts: { sittings: rows.length, participants: new Set(rows.map((r) => r.participantId)).size, schools: new Set(rows.map((r) => r.school)).size, yearGroups: 0 },
    schemes: [...input.schemes],
    checks: {},
    available: { schools: [], yearGroups: [] },
    focus: { label, peersLabel: othersLabel, school, yearGroup },
    results,
  };
  return {
    school,
    schoolName,
    yearGroup,
    label,
    othersLabel,
    allLabel,
    minCell: settings.minCell,
    observation: input.observation,
    counts: { pupils: new Set(mine.map((r) => r.participantId)).size, otherSchools, otherPupils: compareShown ? new Set(others.map((r) => r.participantId)).size : 0 },
    comparisonsShown: compareShown,
    chartView,
    rows: reportRows,
    withheldYearGroups,
  };
}
