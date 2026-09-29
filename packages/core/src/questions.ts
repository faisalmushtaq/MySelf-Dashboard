import { canonicalJson, type QuestionDef, type ReleaseIndex, type RequiredLevel } from "./manifest.js";
import type { SessionRow } from "./filters.js";
import { outcomeOf } from "./summary.js";
import { EXCLUDED, type Outcome } from "./completeness.js";
import { median } from "./analytics.js";

/**
 * Question-level analysis for ONE release (docs/03 §3.6).
 *
 * Distributions are counted by stored option code and labelled with THIS
 * release's labels, so a relabelled option can never be pooled under the wrong
 * wording. Free-text questions get counts only — their content never leaves the
 * server in an aggregate.
 */

export type Distribution =
  | { kind: "options"; total: number; options: { code: number; label: string; optionKind: string; count: number }[]; unknownCodes: { code: number; count: number }[]; multi: boolean }
  | { kind: "numeric"; total: number; bins: { label: string; from: number; to: number; count: number }[]; median: number | null; mean: number | null }
  | { kind: "none"; reason: string };

export interface QuestionStat {
  key: string;
  instrument: string;
  item: string;
  variable: string;
  /** Readable name and label from the codebook. */
  name: string;
  label: string;
  revision: number;
  text: string;
  sectionKey: string;
  sectionTitle: string;
  order: number;
  responseType: string;
  required: RequiredLevel;
  countsAsRequired: boolean;
  identifying: boolean;
  freeText: boolean;
  conditional: boolean;
  sessions: number;
  eligible: number;
  undetermined: number;
  shown: number;
  answered: number;
  declined: number;
  skipped: number;
  noResponse: number;
  notReached: number;
  eligibleNotShown: number;
  invalid: number;
  hiddenBranching: number;
  answeredHidden: number;
  /** Eligible, but neither answered nor declined. */
  unanswered: number;
  /** answered ÷ shown */
  responseRate: number | null;
  /** answered ÷ eligible */
  coverage: number | null;
  /** Unfinished sittings whose last shown question was this one. */
  dropOffs: number;
  distribution: Distribution;
}

function numericDistribution(q: QuestionDef, values: number[]): Distribution {
  if (values.length === 0) return { kind: "numeric", total: 0, bins: [], median: null, mean: null };
  const c = q.constraints;
  const lo = typeof c["lowestValue"] === "number" ? (c["lowestValue"] as number) : typeof c["min"] === "number" ? (c["min"] as number) : Math.min(...values);
  const hi =
    typeof c["rungs"] === "number"
      ? lo + (c["rungs"] as number) - 1
      : typeof c["max"] === "number"
        ? (c["max"] as number)
        : Math.max(...values);
  const integral = values.every(Number.isInteger);
  let bins: { label: string; from: number; to: number; count: number }[];
  if (integral && hi - lo <= 20) {
    bins = [];
    for (let v = lo; v <= hi; v += 1) bins.push({ label: String(v), from: v, to: v, count: 0 });
    for (const v of values) {
      const b = bins.find((x) => x.from === v);
      if (b) b.count += 1;
    }
  } else {
    const n = 10;
    const width = (hi - lo) / n || 1;
    bins = Array.from({ length: n }, (_, i) => {
      const from = lo + i * width;
      const to = i === n - 1 ? hi : lo + (i + 1) * width;
      return { label: `${+from.toFixed(1)}–${+to.toFixed(1)}`, from, to, count: 0 };
    });
    for (const v of values) {
      const i = Math.min(n - 1, Math.max(0, Math.floor((v - lo) / width)));
      bins[i]!.count += 1;
    }
  }
  return {
    kind: "numeric",
    total: values.length,
    bins,
    median: median(values),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

export function computeQuestionStats(
  rows: readonly SessionRow[],
  release: ReleaseIndex,
  requiredLevels: readonly RequiredLevel[],
): QuestionStat[] {
  const mine = rows.filter((r) => r.summary.releaseHash === release.hash && !r.status.markers.includes("invalid"));
  const entries = mine.map((r) => new Map(r.summary.items.map((i) => [i.k, i])));
  const dropOffs = new Map<string, number>();
  for (const r of mine) {
    if (!r.summary.terminal && r.summary.hasResponses && r.summary.lastPresentedKey) {
      dropOffs.set(r.summary.lastPresentedKey, (dropOffs.get(r.summary.lastPresentedKey) ?? 0) + 1);
    }
  }

  return release.questions.map((q) => {
    const tally = new Map<Outcome, number>();
    let shown = 0;
    const codeCounts = new Map<number, number>();
    const numbers: number[] = [];
    let valued = 0;
    for (const m of entries) {
      const e = m.get(q.key);
      if (!e) continue;
      const o = outcomeOf(e);
      tally.set(o, (tally.get(o) ?? 0) + 1);
      if (e.s === 1) shown += 1;
      if (o === "answered") {
        if (e.v !== undefined) {
          valued += 1;
          if (q.options) codeCounts.set(e.v, (codeCounts.get(e.v) ?? 0) + 1);
          else numbers.push(e.v);
        }
        if (e.m) {
          valued += 1;
          for (const c of e.m) codeCounts.set(c, (codeCounts.get(c) ?? 0) + 1);
        }
      }
    }
    const t = (o: Outcome) => tally.get(o) ?? 0;
    let eligible = 0;
    for (const [o, n] of tally) if (!EXCLUDED.has(o)) eligible += n;
    const answered = t("answered");
    const declined = t("declined");

    let distribution: Distribution;
    if (q.identifying) distribution = { kind: "none", reason: "Identifying question — values are never aggregated here." };
    else if (q.freeText) distribution = { kind: "none", reason: "Free-text question — responses are counted, not summarised." };
    else if (q.options) {
      const known = new Set(q.options.map((o) => o.code));
      distribution = {
        kind: "options",
        total: valued,
        multi: q.responseType === "multi_choice",
        options: q.options.map((o) => ({ code: o.code, label: o.label, optionKind: o.kind, count: codeCounts.get(o.code) ?? 0 })),
        unknownCodes: [...codeCounts.entries()].filter(([c]) => !known.has(c)).map(([code, count]) => ({ code, count })),
      };
    } else if (["numeric", "slider", "ladder"].includes(q.responseType)) distribution = numericDistribution(q, numbers);
    else distribution = { kind: "none", reason: "This answer type has no distribution view." };

    return {
      key: q.key,
      instrument: q.instrument,
      item: q.item,
      variable: q.variable,
      name: q.name,
      label: q.label,
      revision: q.revision,
      text: q.text,
      sectionKey: q.sectionKey,
      sectionTitle: q.sectionTitle,
      order: q.order,
      responseType: q.responseType,
      required: q.required,
      countsAsRequired: requiredLevels.includes(q.required),
      identifying: q.identifying,
      freeText: q.freeText,
      conditional: q.displayIf !== undefined,
      sessions: mine.length,
      eligible,
      undetermined: t("undetermined"),
      shown,
      answered,
      declined,
      skipped: t("skipped"),
      noResponse: t("no_response"),
      notReached: t("not_reached"),
      eligibleNotShown: t("eligible_not_shown"),
      invalid: t("invalid"),
      hiddenBranching: t("hidden_branching"),
      answeredHidden: t("answered_hidden"),
      unanswered: Math.max(0, eligible - answered - declined),
      responseRate: shown > 0 ? answered / shown : null,
      coverage: eligible > 0 ? answered / eligible : null,
      dropOffs: dropOffs.get(q.key) ?? 0,
      distribution,
    };
  });
}

// ── Versions ────────────────────────────────────────────────────────────────

export type ChangeKind =
  | "wording"
  | "type"
  | "options_added"
  | "options_removed"
  | "labels"
  | "required"
  | "branching"
  | "revision"
  | "section"
  | "variable";

export type Compatibility = "compatible" | "caution" | "incompatible";

export const CHANGE_LABELS: Record<ChangeKind, string> = {
  wording: "Wording changed",
  type: "Answer type changed",
  options_added: "Option codes added",
  options_removed: "Option codes removed",
  labels: "Option labels changed",
  required: "Required level changed",
  branching: "Display condition changed",
  revision: "Item revision changed",
  section: "Moved to another section",
  variable: "Export variable renamed",
};

const INCOMPATIBLE: ReadonlySet<ChangeKind> = new Set(["type", "options_added", "options_removed"]);
const CAUTION: ReadonlySet<ChangeKind> = new Set(["wording", "labels", "branching", "required"]);

export function compatibilityOf(kinds: readonly ChangeKind[]): Compatibility {
  if (kinds.some((k) => INCOMPATIBLE.has(k))) return "incompatible";
  if (kinds.some((k) => CAUTION.has(k))) return "caution";
  return "compatible";
}

export function diffQuestion(a: QuestionDef, b: QuestionDef): { kinds: ChangeKind[]; details: string[] } {
  const kinds: ChangeKind[] = [];
  const details: string[] = [];
  if (a.text !== b.text) {
    kinds.push("wording");
    details.push(`Wording: “${a.text}” → “${b.text}”`);
  }
  if (a.responseType !== b.responseType) {
    kinds.push("type");
    details.push(`Answer type: ${a.responseType} → ${b.responseType}`);
  }
  const ac = new Map((a.options ?? []).map((o) => [o.code, o.label]));
  const bc = new Map((b.options ?? []).map((o) => [o.code, o.label]));
  const added = [...bc.keys()].filter((c) => !ac.has(c));
  const removed = [...ac.keys()].filter((c) => !bc.has(c));
  const relabelled = [...ac.keys()].filter((c) => bc.has(c) && ac.get(c) !== bc.get(c));
  if (added.length) {
    kinds.push("options_added");
    details.push(`Codes added: ${added.map((c) => `${c} “${bc.get(c)}”`).join(", ")}`);
  }
  if (removed.length) {
    kinds.push("options_removed");
    details.push(`Codes removed: ${removed.map((c) => `${c} “${ac.get(c)}”`).join(", ")}`);
  }
  if (relabelled.length) {
    kinds.push("labels");
    details.push(`Relabelled: ${relabelled.map((c) => `${c} “${ac.get(c)}” → “${bc.get(c)}”`).join(", ")}`);
  }
  if (a.required !== b.required) {
    kinds.push("required");
    details.push(`Required: ${a.required} → ${b.required}`);
  }
  if (canonicalJson(a.displayIf ?? null) !== canonicalJson(b.displayIf ?? null)) {
    kinds.push("branching");
    details.push(a.displayIf && b.displayIf ? "Display condition changed" : b.displayIf ? "Display condition added" : "Display condition removed");
  }
  if (a.revision !== b.revision) {
    kinds.push("revision");
    details.push(`Revision: r${a.revision} → r${b.revision}`);
  }
  if (a.sectionKey !== b.sectionKey) {
    kinds.push("section");
    details.push(`Section: ${a.sectionTitle} → ${b.sectionTitle}`);
  }
  if (a.variable !== b.variable) {
    kinds.push("variable");
    details.push(`Variable: ${a.variable} → ${b.variable}`);
  }
  return { kinds, details };
}

export interface QuestionChange {
  key: string;
  text: string;
  kinds: ChangeKind[];
  details: string[];
  compatibility: Compatibility;
}

export interface ReleaseComparison {
  from: { hash: string; version: string };
  to: { hash: string; version: string };
  added: { key: string; text: string; sectionTitle: string }[];
  removed: { key: string; text: string; sectionTitle: string }[];
  changed: QuestionChange[];
  unchanged: number;
}

export function compareReleases(from: ReleaseIndex, to: ReleaseIndex): ReleaseComparison {
  const added = to.questions.filter((q) => !from.byKey.has(q.key)).map((q) => ({ key: q.key, text: q.text, sectionTitle: q.sectionTitle }));
  const removed = from.questions.filter((q) => !to.byKey.has(q.key)).map((q) => ({ key: q.key, text: q.text, sectionTitle: q.sectionTitle }));
  const changed: QuestionChange[] = [];
  let unchanged = 0;
  for (const q of to.questions) {
    const prev = from.byKey.get(q.key);
    if (!prev) continue;
    const { kinds, details } = diffQuestion(prev, q);
    if (kinds.length === 0) unchanged += 1;
    else changed.push({ key: q.key, text: q.text, kinds, details, compatibility: compatibilityOf(kinds) });
  }
  return {
    from: { hash: from.hash, version: from.version },
    to: { hash: to.hash, version: to.version },
    added,
    removed,
    changed,
    unchanged,
  };
}

export interface QuestionVersionEntry {
  hash: string;
  version: string;
  publishedAt: string;
  present: boolean;
  question?: Pick<QuestionDef, "text" | "responseType" | "required" | "options" | "revision" | "variable" | "sectionTitle"> & { conditional: boolean };
  /** Changes relative to the previous version that contained the question. */
  changes: ChangeKind[];
  details: string[];
  compatibility: Compatibility;
}

/** A stable question across every release, oldest first. */
export function questionHistory(key: string, releases: readonly ReleaseIndex[]): QuestionVersionEntry[] {
  const ordered = [...releases].sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  let previous: QuestionDef | undefined;
  return ordered.map((r) => {
    const q = r.byKey.get(key);
    if (!q) return { hash: r.hash, version: r.version, publishedAt: r.publishedAt, present: false, changes: [], details: [], compatibility: "compatible" as const };
    const diff = previous ? diffQuestion(previous, q) : { kinds: [] as ChangeKind[], details: [] as string[] };
    previous = q;
    return {
      hash: r.hash,
      version: r.version,
      publishedAt: r.publishedAt,
      present: true,
      question: {
        text: q.text,
        responseType: q.responseType,
        required: q.required,
        ...(q.options ? { options: q.options } : {}),
        revision: q.revision,
        variable: q.variable,
        sectionTitle: q.sectionTitle,
        conditional: q.displayIf !== undefined,
      },
      changes: diff.kinds,
      details: diff.details,
      compatibility: compatibilityOf(diff.kinds),
    };
  });
}

/** The worst compatibility of a question across the given releases. */
export function poolingCompatibility(key: string, releases: readonly ReleaseIndex[]): Compatibility {
  const order: Compatibility[] = ["compatible", "caution", "incompatible"];
  let worst: Compatibility = "compatible";
  for (const e of questionHistory(key, releases)) {
    if (order.indexOf(e.compatibility) > order.indexOf(worst)) worst = e.compatibility;
  }
  return worst;
}
