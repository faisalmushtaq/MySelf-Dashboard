import type { ResearcherViewResponse } from "../api.js";
import type { SessionRow } from "../filters.js";
import { heldBackReason } from "../status.js";
import { headlineFigures, type SittingState } from "../vendor/myself/store/counting.js";
import type { StudyDataset } from "./dataset.js";

/**
 * The survey researcher view's Overview, over the sittings in the dashboard's filters.
 *
 * Computed by the researcher view's own code — `headlineFigures` in the survey's
 * counting rules, vendored — over the study the survey's own ingest linked
 * (`deriveStudyDataset`), with each sitting's lifecycle as the dashboard derived it,
 * which is the survey's `lifecycleOf` too. So with the default filters (every date,
 * production only) these are the numbers the researcher view shows with test sittings
 * left out, and with "Production and test" the numbers it shows with "Include test
 * sittings" ticked. A difference that remains is a difference in the sittings the two
 * hold: the researcher view counts what was last pulled into that browser, plus any
 * files imported there by hand.
 */
export function researcherViewFigures(study: StudyDataset, rows: readonly SessionRow[], now: Date): ResearcherViewResponse {
  let quarantined = 0;
  let unreadable = 0;
  const counted: SittingState[] = [];
  for (const r of rows) {
    const reason = heldBackReason(r.summary);
    if (reason === "quarantined") quarantined += 1;
    else if (reason === "unreadable") unreadable += 1;
    else counted.push({ sessionId: r.summary.sessionId, lifecycle: r.status.lifecycle });
  }
  const { dataset: _dataset, summary: _summary, ...figures } = headlineFigures(study.dataset, counted);
  void _dataset;
  void _summary;
  return { figures, quarantined, unreadable, computedAt: now.toISOString() };
}

/** Sittings in `rows` that a study dataset neither linked nor excluded: it was built before they arrived. */
export function unknownToStudy(study: StudyDataset, rows: readonly SessionRow[]): number {
  const known = new Set([...study.dataset.sessions.map((s) => s.sessionId), ...study.excluded.map((e) => e.sessionId)]);
  return rows.filter((r) => !known.has(r.summary.sessionId)).length;
}
