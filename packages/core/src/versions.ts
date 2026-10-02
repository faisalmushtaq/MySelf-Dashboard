import { toCsv } from "./csv.js";
import type { SurveyVersionView } from "./api.js";

/**
 * Every version's history, in one table a researcher can keep with a paper's
 * supplementary material: what each version is, when it was published and how
 * many sittings it collected (docs/11).
 */

export function provenanceCsv(versions: readonly SurveyVersionView[]): string {
  const header = ["version", "hash", "release_key", "published_at", "sittings", "first_sitting", "last_sitting"];
  const rows = [...versions]
    .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    .map((v) => [v.version, v.hash, v.releaseKey, v.publishedAt, String(v.sittings), v.firstSitting ?? "", v.lastSitting ?? ""]);
  return toCsv(header, rows);
}
