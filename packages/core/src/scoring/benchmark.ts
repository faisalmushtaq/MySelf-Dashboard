import { compareToBenchmark, compareToGroup, pickObservations, summarise, type Comparison, type Observation, type ScoreSummary } from "./aggregate.js";
import type { SchemeScores } from "./engine.js";
import { schoolLabel, yearGroupLabel, type GroupSettings } from "./groups.js";
import type { ScoringScheme } from "./scheme.js";
import type { SchemeIssue } from "./check.js";

/**
 * The Scores view and the school reports: every score summarised overall, by
 * group, and — for a chosen school or year group — against its peers and the
 * benchmarks. Built on the server from scored sittings; only aggregates leave.
 */

export const SCORE_GROUP_BYS = ["school", "yearGroup", "schoolYear", "gender", "wave", "none"] as const;
export type ScoreGroupBy = (typeof SCORE_GROUP_BYS)[number];
export const SCORE_GROUP_BY_LABELS: Record<ScoreGroupBy, string> = {
  school: "School",
  yearGroup: "Year group",
  schoolYear: "School and year group",
  gender: "Gender",
  wave: "Wave",
  none: "No grouping",
};

export interface ScoredRow {
  participantId: string;
  wave: number;
  school: string | null;
  yearGroup: number | null;
  gender: string | null;
  scores: Record<string, SchemeScores>;
}

export interface ScoreFocus {
  school?: string | null;
  yearGroup?: number | null;
}

export interface GroupSummary {
  key: string;
  label: string;
  /** Sittings in the group with this score. */
  n: number;
  /** Fewer than the study's minimum cell size: marked here, suppressed in reports for schools. */
  small: boolean;
  summary: ScoreSummary | null;
}

export interface ScoreResult {
  scheme: string;
  output: string;
  overall: ScoreSummary | null;
  /** The whole selection against each benchmark, by benchmark key. */
  vsBenchmarks: Record<string, Comparison>;
  groups: GroupSummary[];
  focus?: {
    summary: ScoreSummary | null;
    peers: ScoreSummary | null;
    vsPeers: Comparison | null;
    vsBenchmarks: Record<string, Comparison>;
    small: boolean;
  };
}

export interface ScoresView {
  computedAt: string;
  observation: Observation;
  groupBy: ScoreGroupBy;
  minCell: number;
  counts: { sittings: number; participants: number; schools: number; yearGroups: number };
  schemes: ScoringScheme[];
  /** Problems found when each scheme was checked against the survey versions in use. */
  checks: Record<string, { version: string; issues: SchemeIssue[] }[]>;
  available: { schools: { key: string; label: string; n: number }[]; yearGroups: { key: string; label: string; n: number }[] };
  focus: { label: string; peersLabel: string; school: string | null; yearGroup: number | null } | null;
  results: ScoreResult[];
}

function groupKey(row: ScoredRow, by: ScoreGroupBy): string | null {
  switch (by) {
    case "school":
      return row.school;
    case "yearGroup":
      return row.yearGroup === null ? null : String(row.yearGroup);
    case "schoolYear":
      return row.school && row.yearGroup !== null ? `${row.school}|${row.yearGroup}` : null;
    case "gender":
      return row.gender;
    case "wave":
      return String(row.wave);
    case "none":
      return "all";
  }
}

function groupName(key: string, by: ScoreGroupBy, settings: GroupSettings): string {
  switch (by) {
    case "school":
      return schoolLabel(key, settings);
    case "yearGroup":
      return yearGroupLabel(Number(key));
    case "schoolYear": {
      const [school, year] = key.split("|");
      return `${schoolLabel(school, settings)}, Y${year}`;
    }
    case "wave":
      return `Wave ${key}`;
    case "none":
      return "Everyone";
    default:
      return key;
  }
}

const inFocus = (r: ScoredRow, f: ScoreFocus) => (f.school ? r.school === f.school : true) && (f.yearGroup !== null && f.yearGroup !== undefined ? r.yearGroup === f.yearGroup : true);

/**
 * Peers for a focus: the same year group at other schools for a school's year
 * group; other schools for a school; other year groups for a year group.
 */
function isPeer(r: ScoredRow, f: ScoreFocus): boolean {
  const hasYear = f.yearGroup !== null && f.yearGroup !== undefined;
  if (f.school) return r.school !== null && r.school !== f.school && (hasYear ? r.yearGroup === f.yearGroup : true);
  if (hasYear) return r.yearGroup !== null && r.yearGroup !== f.yearGroup;
  return false;
}

export function buildScoresView(
  scored: readonly ScoredRow[],
  input: {
    schemes: readonly ScoringScheme[];
    settings: GroupSettings;
    observation: Observation;
    groupBy: ScoreGroupBy;
    focus?: ScoreFocus | null;
    checks?: ScoresView["checks"];
    now: Date;
  },
): ScoresView {
  const rows = pickObservations(scored, input.observation);
  const { settings, groupBy } = input;
  const focus = input.focus && (input.focus.school || (input.focus.yearGroup !== null && input.focus.yearGroup !== undefined)) ? input.focus : null;

  const groupKeys = new Map<string, ScoredRow[]>();
  if (groupBy !== "none") {
    for (const r of rows) {
      const k = groupKey(r, groupBy);
      if (k === null) continue;
      const list = groupKeys.get(k);
      if (list) list.push(r);
      else groupKeys.set(k, [r]);
    }
  }
  const orderedGroups = [...groupKeys.entries()].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
  const focusRows = focus ? rows.filter((r) => inFocus(r, focus)) : [];
  const peerRows = focus ? rows.filter((r) => isPeer(r, focus)) : [];

  const results: ScoreResult[] = [];
  for (const scheme of input.schemes) {
    for (const output of scheme.outputs) {
      const pick = (list: readonly ScoredRow[]) =>
        list.filter((r) => r.scores[scheme.key]).map((r) => {
          const v = r.scores[scheme.key]!.outputs[output.key];
          return { value: v?.value ?? null, bands: v?.bands ?? {} };
        });
      const overall = summarise(pick(rows), output, { histogram: true });
      const vsBenchmarks = (s: ScoreSummary | null) => (s ? Object.fromEntries(output.benchmarks.map((b) => [b.key, compareToBenchmark(s, b)])) : {});
      const result: ScoreResult = {
        scheme: scheme.key,
        output: output.key,
        overall,
        vsBenchmarks: vsBenchmarks(overall),
        groups: orderedGroups.map(([key, list]) => {
          const summary = summarise(pick(list), output);
          const n = summary?.n ?? 0;
          return { key, label: groupName(key, groupBy, settings), n, small: n < settings.minCell, summary };
        }),
      };
      if (focus) {
        const summary = summarise(pick(focusRows), output, { histogram: true });
        const peers = summarise(pick(peerRows), output, { histogram: true });
        result.focus = {
          summary,
          peers,
          vsPeers: summary && peers ? compareToGroup(summary, peers) : null,
          vsBenchmarks: vsBenchmarks(summary),
          small: (summary?.n ?? 0) < settings.minCell,
        };
      }
      results.push(result);
    }
  }

  const count = (key: (r: ScoredRow) => string | null) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = key(r);
      if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
  };
  const schools = count((r) => r.school).map(([key, n]) => ({ key, label: schoolLabel(key, settings), n }));
  const yearGroups = count((r) => (r.yearGroup === null ? null : String(r.yearGroup))).map(([key, n]) => ({ key, label: yearGroupLabel(Number(key)), n }));

  let focusView: ScoresView["focus"] = null;
  if (focus) {
    const hasYear = focus.yearGroup !== null && focus.yearGroup !== undefined;
    const label = [focus.school ? schoolLabel(focus.school, settings) : null, hasYear ? yearGroupLabel(focus.yearGroup) : null].filter(Boolean).join(", ");
    const peersLabel = focus.school ? (hasYear ? `${yearGroupLabel(focus.yearGroup)} at other schools` : "Other schools") : "Other year groups";
    focusView = { label, peersLabel, school: focus.school ?? null, yearGroup: hasYear ? focus.yearGroup! : null };
  }

  return {
    computedAt: input.now.toISOString(),
    observation: input.observation,
    groupBy,
    minCell: settings.minCell,
    counts: { sittings: rows.length, participants: new Set(rows.map((r) => r.participantId)).size, schools: schools.length, yearGroups: yearGroups.length },
    schemes: [...input.schemes],
    checks: input.checks ?? {},
    available: { schools, yearGroups },
    focus: focusView,
    results,
  };
}
