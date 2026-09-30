/**
 * The survey's own data layer, vendored (see the header of each file): the
 * release schema, scoring, and `@myself/store` — ingest (participant codes,
 * waves, corrections, twin assignments, scores), the BIDS builder and the zip
 * writer. The dashboard's BIDS export uses these unchanged, so a dataset
 * exported here is the dataset the survey's own nightly export writes. And the
 * completeness and counting rules the survey's researcher view counts by
 * (store/completeness.ts, store/counting.ts), which the dashboard's own
 * completeness, status and Overview are built on — those reach the web app
 * through the main entry (completeness.ts, status.ts), not through this one.
 *
 * Server-only: imported through `@myself-dashboard/core/survey`, never by the
 * web app.
 */
export { releaseManifest, type ReleaseManifest } from "./schema/index.js";
// Where versions published from the dashboard live in the survey's database, and their documents (survey D-54).
export { publishedPaths, publishedReleaseDoc, activeReleaseDoc, type PublishedReleaseDoc, type ActiveReleaseDoc } from "./schema/index.js";
export { ingest, resolveAlias, type DeviceSession, type DeviceEvent, type IngestResult } from "./store/ingest.js";
export { emptyDataset, type Dataset, type SessionRow as DatasetSession, type ResponseRow as DatasetResponse, type ScoreRow as DatasetScore, type ParticipantRow as DatasetParticipant } from "./store/dataset.js";
export { buildBidsExport, type BidsFile, type BidsOptions } from "./store/bids.js";
export { type StoredNarrativeRun } from "./store/narratives.js";
export { buildZip, type ZipEntry } from "./store/zip.js";
export { deriveParticipantCode, isParticipantCode } from "./store/identity.js";
export { countSittings, headlineFigures, isTestCode, DEFAULT_COUNTING_RULES, type CountResult, type HeadlineFigures, type SittingState } from "./store/counting.js";
export { summarise, type DatasetSummary } from "./store/summary.js";
