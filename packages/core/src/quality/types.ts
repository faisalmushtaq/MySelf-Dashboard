export type QualitySeverity = "error" | "warning" | "note";
export type QualityArea = "names" | "responses" | "scoring" | "wording" | "versions";

export const QUALITY_AREA_LABELS: Record<QualityArea, string> = {
  names: "Names and labels",
  responses: "Response options",
  scoring: "Scoring",
  wording: "Wording",
  versions: "Changes between versions",
};

export interface QualityFinding {
  /** Stable across runs, so a finding can be referred to. */
  id: string;
  severity: QualitySeverity;
  area: QualityArea;
  title: string;
  detail: string;
  /** Questions affected ("<instrument>.<item>"). */
  keys: string[];
  instrument?: string;
  scheme?: string;
  /** Survey versions it applies to, where that matters. */
  versions?: string[];
  source?: string;
  /** For the reviewer's own findings: where they stand. */
  status?: "open" | "fixed" | "decision";
}

/** How one question feeds one score, code by code. */
export interface ScoringUse {
  scheme: string;
  schemeName: string;
  schemeVersion: string;
  output: string;
  outputLabel: string;
  /** The value each option scores, aligned with the question's options; null = missing. Absent for a number answered directly. */
  values?: (number | null)[];
  transform: "reversed" | "recoded" | null;
}

/** One question in the codebook. */
export interface CodebookRow {
  key: string;
  instrument: string;
  item: string;
  name: string;
  label: string;
  named: boolean;
  variable: string;
  legacyVariable: string | null;
  section: string;
  text: string;
  lede: string | null;
  instructions: string | null;
  unit: string | null;
  researcherNote: string | null;
  responseType: string;
  required: string;
  identifying: boolean;
  freeText: boolean;
  conditional: boolean;
  options: { code: number; label: string; kind: string; value?: number }[];
  scoring: ScoringUse[];
  /** Survey versions that ask it. */
  versions: string[];
  /** Ids of findings that name it. */
  findings: string[];
}

export interface QualityReport {
  release: { hash: string; version: string };
  rows: CodebookRow[];
  findings: QualityFinding[];
  counts: Record<QualitySeverity, number>;
}
