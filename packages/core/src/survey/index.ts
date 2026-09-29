/**
 * Server-only: the survey's data layer (vendored) and the dashboard's BIDS
 * export built on it. Imported as `@myself-dashboard/core/survey`.
 */
export * from "../vendor/myself/index.js";
export * from "./dataset.js";
export * from "./bids.js";
