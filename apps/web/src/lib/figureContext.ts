import { useMemo } from "react";
import { DATE_BASIS_LABELS, describeFilters, formatDay, OBSERVATIONS, rangeFor, RULES_VERSION, SCORE_GROUP_BYS, type FigureContext, type Observation, type ScoreFocus, type ScoreGroupBy } from "@myself-dashboard/core";
import { useFilters } from "../app/filters";
import { useStudyData } from "../app/data";
import { useAuth } from "../app/auth";
import { usePreference } from "./hooks";

/** What every figure's legend says about the data: the period, the filters, the study's rules. */
export function useFigureBasics(): Omit<FigureContext, "analytics" | "questions"> {
  const { filters } = useFilters();
  const { me } = useAuth();
  const { byNewest } = useStudyData();
  const policy = me?.policy;
  const timeZone = policy?.timeZone ?? "Europe/London";
  const versionLabel = (hash: string) => {
    const r = byNewest.find((x) => x.hash === hash);
    return r ? `v${r.version}` : "an unregistered version";
  };
  const period = useMemo(() => {
    const now = new Date();
    const r = rangeFor(filters, { now, timeZone });
    const basis = DATE_BASIS_LABELS[filters.dateBasis].replace(/ \(.*\)$/, "").toLowerCase();
    if (r.fromDay && r.toDay) return `${formatDay(r.fromDay)} to ${formatDay(r.toDay)} (by ${basis})`;
    if (r.toDay) return `up to ${formatDay(r.toDay)} (by ${basis})`;
    return `all dates to ${formatDay(now.toISOString().slice(0, 10))}`;
  }, [filters, timeZone]);
  const filterText = useMemo(
    () =>
      describeFilters(filters, { version: versionLabel })
        .filter((f) => f.key !== "date")
        .map((f) => f.label),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, byNewest],
  );
  return {
    period,
    filters: filterText,
    timeZone,
    rulesVersion: RULES_VERSION,
    requiredLevels: policy?.requiredLevels ?? ["hard", "soft"],
    abandonAfterHours: policy?.abandonAfterHours ?? 24,
    versionLabel,
  };
}

/** How scores are grouped and counted — shared by the Scores and Figures pages, kept in this browser only. */
export interface ScoresViewPrefs {
  scheme: string;
  groupBy: ScoreGroupBy;
  observation: Observation;
  focus: ScoreFocus;
}

const DEFAULT_PREFS: ScoresViewPrefs = { scheme: "sdq25_s", groupBy: "school", observation: "latest", focus: { school: null, yearGroup: null } };

export function useScoresPrefs(): [ScoresViewPrefs, (p: ScoresViewPrefs) => void] {
  const [raw, set] = usePreference<Partial<ScoresViewPrefs>>("scores-view", DEFAULT_PREFS);
  const prefs: ScoresViewPrefs = {
    scheme: typeof raw.scheme === "string" ? raw.scheme : DEFAULT_PREFS.scheme,
    groupBy: SCORE_GROUP_BYS.includes(raw.groupBy as ScoreGroupBy) ? (raw.groupBy as ScoreGroupBy) : DEFAULT_PREFS.groupBy,
    observation: OBSERVATIONS.includes(raw.observation as Observation) ? (raw.observation as Observation) : DEFAULT_PREFS.observation,
    focus: {
      school: typeof raw.focus?.school === "string" ? raw.focus.school : null,
      yearGroup: typeof raw.focus?.yearGroup === "number" ? raw.focus.yearGroup : null,
    },
  };
  return [prefs, set];
}
