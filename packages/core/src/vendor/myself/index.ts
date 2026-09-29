/**
 * The survey's own data layer, vendored (see the header of each file): the
 * release schema, scoring, and `@myself/store` — ingest (participant codes,
 * waves, corrections, twin assignments, scores), the BIDS builder and the zip
 * writer. The dashboard's BIDS export uses these unchanged, so a dataset
 * exported here is the dataset the survey's own nightly export writes.
 *
 * Server-only: imported through `@myself-dashboard/core/survey`, never by the
 * web app.
 */
export { releaseManifest, type ReleaseManifest } from "./schema/index.js";
export { ingest, resolveAlias, type DeviceSession, type DeviceEvent, type IngestResult } from "./store/ingest.js";
export { emptyDataset, type Dataset, type SessionRow as DatasetSession, type ResponseRow as DatasetResponse, type ScoreRow as DatasetScore, type ParticipantRow as DatasetParticipant } from "./store/dataset.js";
export { buildBidsExport, type BidsFile, type BidsOptions } from "./store/bids.js";
export { type StoredNarrativeRun } from "./store/narratives.js";
export { buildZip, type ZipEntry } from "./store/zip.js";
export { deriveParticipantCode, isParticipantCode } from "./store/identity.js";
