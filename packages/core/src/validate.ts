/**
 * Whether a recorded value is a valid answer to this question AS THIS RELEASE
 * DEFINES IT.
 *
 * The survey's own check, vendored with the completeness rules
 * (`vendor/myself/store/completeness.ts`), so an answer the dashboard calls invalid
 * is one the survey's researcher view does too. `empty` distinguishes a legitimately
 * empty answer the definition allows from a missing one; `reason` is shown to the
 * researcher, so it says what is wrong in words.
 */
export { validateAnswer, type ValidationResult } from "./vendor/myself/store/completeness.js";
