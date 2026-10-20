/**
 * The survey engine, as the dashboard uses it: re-exported from the verbatim
 * copies in vendor/myself/engine/ (scripts/vendor-survey.mjs), which
 * scripts/check-vendored.mjs compares with the survey on every CI run.
 *
 * The dashboard must decide "would this question have been shown?" exactly the
 * way the participant's device did — including that a hidden question's answer
 * never opens a branch below it (survey D-63) — so this is the survey's own code,
 * not a re-implementation.
 */
export type { LogicExpr } from "./myself/schema/index.js";
export { AnswerStore, refKey, type AnswerLookup, type AnswerRecord, type AnswerValue } from "./myself/engine/answers.js";
export { ageOn, evaluate } from "./myself/engine/evaluate.js";
export { computeVisibility, type PresentableUnit, type Visibility, type VisibilityUnit } from "./myself/engine/walker.js";
export { flattenManifest, type FlattenedRelease } from "./myself/engine/flatten.js";
// The time grid (survey D-66): its rows, the condition that hides it when it
// would have none, and one variable per row.
export {
  checkTimeGrid,
  formatMinutes,
  timeGridCandidates,
  timeGridCondition,
  timeGridMax,
  timeGridRows,
  timeGridVariable,
  type GridOption,
  type GridSourceItem,
  type TimeGridItem,
  type TimeGridRow,
} from "./myself/engine/timegrid.js";
