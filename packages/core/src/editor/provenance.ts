import { toCsv } from "../csv.js";

/**
 * Every version's history, in one table a researcher can keep with a paper's
 * supplementary material: what each version is, where it came from, what
 * changed, who published it and why, and when it was the one iPads used.
 */

export interface VersionRecord {
  hash: string;
  version: string;
  key: string;
  publishedAt: string;
  publishedBy: string | null;
  source: "editor" | "repository";
  baseVersion: string | null;
  notes: string | null;
  bump: string | null;
  changes: string[];
  mystory: string | null;
  sittings: number;
  firstSitting: string | null;
  lastSitting: string | null;
}

export interface Activation {
  hash: string;
  version: string;
  activatedAt: string;
  activatedBy: string | null;
  reason: string | null;
}

/** When each version was the active one, from the activation history (newest last). */
export function activePeriods(activations: readonly Activation[]): Map<string, { from: string; to: string | null }[]> {
  const sorted = [...activations].sort((a, b) => a.activatedAt.localeCompare(b.activatedAt));
  const out = new Map<string, { from: string; to: string | null }[]>();
  sorted.forEach((a, i) => {
    const list = out.get(a.hash) ?? [];
    list.push({ from: a.activatedAt, to: sorted[i + 1]?.activatedAt ?? null });
    out.set(a.hash, list);
  });
  return out;
}

export function provenanceCsv(versions: readonly VersionRecord[], activations: readonly Activation[]): string {
  const periods = activePeriods(activations);
  const header = ["version", "hash", "key", "published_at", "published_by", "source", "base_version", "bump", "why", "changes", "mystory", "active_periods", "sittings", "first_sitting", "last_sitting"];
  const rows = [...versions]
    .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    .map((v) => [
      v.version,
      v.hash,
      v.key,
      v.publishedAt,
      v.publishedBy ?? "",
      v.source,
      v.baseVersion ?? "",
      v.bump ?? "",
      v.notes ?? "",
      v.changes.join("; "),
      v.mystory ?? "",
      (periods.get(v.hash) ?? []).map((p) => `${p.from} to ${p.to ?? "now"}`).join("; "),
      String(v.sittings),
      v.firstSitting ?? "",
      v.lastSitting ?? "",
    ]);
  return toCsv(header, rows);
}
