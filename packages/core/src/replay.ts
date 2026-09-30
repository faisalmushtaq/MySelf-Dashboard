/**
 * Replaying a sitting's event log into per-question facts.
 *
 * The survey's own replay, vendored with the completeness rules it feeds
 * (`vendor/myself/store/completeness.ts`): events in `seq` order, and the last
 * statement about an item wins — the same rule the survey's `ingest` uses, and how
 * the participant experienced it. Nothing here judges completeness; it only records
 * what happened.
 */
export { replaySitting, type ItemFacts, type LoggedSitting, type ReplayResult, type ResponseKind } from "./vendor/myself/store/completeness.js";
