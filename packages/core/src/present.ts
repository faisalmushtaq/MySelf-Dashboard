import type { Assessment, Outcome } from "./completeness.js";
import type { QuestionDef, ReleaseIndex } from "./manifest.js";
import { formatMinutes } from "./vendor/engine.js";

/**
 * Turning a recorded value into something a researcher can read — and deciding
 * what must NOT be shown.
 *
 * Identifying answers (names, date of birth, code components) are withheld for
 * every role: they belong to the identity project, not to this dashboard.
 * Free-text answers are withheld unless the caller's role may read free text.
 * Withholding happens here, on the server, before anything is serialised.
 */

export type Redaction = "identifying" | "free_text" | null;

export interface RenderedAnswer {
  /** Human-readable rendering; null when withheld or absent. */
  display: string | null;
  /** Stored option code(s) or number, where the answer has one. */
  code: number | number[] | null;
  redacted: Redaction;
  kind: string | null;
}

const text = (v: unknown) => (typeof v === "string" ? v : null);

export function renderAnswer(q: QuestionDef, value: unknown, options: { freeText: boolean }): RenderedAnswer {
  const v = (value ?? null) as Record<string, unknown> | null;
  const kind = v && typeof v["kind"] === "string" ? (v["kind"] as string) : null;
  if (q.identifying) return { display: null, code: null, redacted: "identifying", kind };
  if (q.freeText && !options.freeText) return { display: null, code: null, redacted: "free_text", kind };
  if (!v) return { display: null, code: null, redacted: null, kind: null };
  const label = (code: number) => q.options?.find((o) => o.code === code)?.label;
  switch (kind) {
    case "choice": {
      const code = v["code"] as number;
      const l = label(code);
      return { display: l ? `${l}` : `Code ${code} (not in this version)`, code, redacted: null, kind };
    }
    case "multi": {
      const codes = Array.isArray(v["codes"]) ? (v["codes"] as number[]) : [];
      return {
        display: codes.length ? codes.map((c) => label(c) ?? `Code ${c}`).join("; ") : "None selected",
        code: codes,
        redacted: null,
        kind,
      };
    }
    case "number": {
      const n = v["value"] as number;
      const unit = typeof q.constraints["unitLabel"] === "string" ? ` ${q.constraints["unitLabel"]}` : "";
      return { display: `${n}${unit}`, code: n, redacted: null, kind };
    }
    case "text":
      return { display: text(v["value"]) ?? "", code: null, redacted: null, kind };
    case "date":
      return { display: text(v["iso"])?.slice(0, 10) ?? "", code: null, redacted: null, kind };
    case "fields": {
      const values = (v["values"] ?? {}) as Record<string, unknown>;
      const fields = (Array.isArray(q.constraints["fields"]) ? q.constraints["fields"] : []) as { key: string; label?: string }[];
      const lines = Object.entries(values)
        .filter(([, x]) => typeof x === "string" && x.trim().length > 0)
        .map(([k, x]) => `${fields.find((f) => f.key === k)?.label ?? k}: ${x as string}`);
      return { display: lines.join("\n") || "(empty)", code: null, redacted: null, kind };
    }
    case "checkboxes": {
      const checked = Array.isArray(v["checked"]) ? (v["checked"] as string[]) : [];
      const statements = (Array.isArray(q.constraints["statements"]) ? q.constraints["statements"] : []) as { key: string; text?: { text?: string } }[];
      return {
        display: checked.length ? checked.map((k) => statements.find((s) => s.key === k)?.text?.text ?? k).join("; ") : "None ticked",
        code: null,
        redacted: null,
        kind,
      };
    }
    case "group_rank": {
      const assignments = (v["assignments"] ?? {}) as Record<string, { group?: string; rank?: number }>;
      const byGroup = new Map<string, string[]>();
      for (const [code, a] of Object.entries(assignments)) {
        const g = a.group ?? "?";
        const item = `${label(Number(code)) ?? code}${a.rank ? ` (#${a.rank})` : ""}`;
        byGroup.set(g, [...(byGroup.get(g) ?? []), item]);
      }
      return { display: [...byGroup.entries()].map(([g, xs]) => `${g}: ${xs.join(", ")}`).join("\n"), code: null, redacted: null, kind };
    }
    case "time_grid": {
      // Minutes per row; the rows are the options of the question it was built from.
      const minutes = (v["minutes"] ?? {}) as Record<string, unknown>;
      const rows = (q.options ?? []).filter((o) => String(o.code) in minutes);
      const known = new Set(rows.map((o) => String(o.code)));
      const lines = [
        ...rows.map((o) => [o.label, minutes[String(o.code)]] as const),
        ...Object.entries(minutes).filter(([c]) => !known.has(c)).map(([c, n]) => [`Code ${c}`, n] as const),
      ].map(([l, n]) => `${l}: ${typeof n === "number" ? formatMinutes(n) : "not given"}`);
      return { display: lines.join("\n") || "No times given", code: null, redacted: null, kind };
    }
    default:
      return { display: kind ? `Unrecognised answer (${kind})` : "Unrecognised answer", code: null, redacted: null, kind };
  }
}

export interface AnswerView {
  key: string;
  variable: string;
  /** Readable name from the codebook. */
  name: string;
  revision: number;
  text: string;
  responseType: string;
  required: string;
  countsAsRequired: boolean;
  conditional: boolean;
  identifying: boolean;
  freeText: boolean;
  outcome: Outcome;
  shown: boolean;
  presentedCount: number;
  answer: RenderedAnswer;
  emptyValue: boolean;
  invalidReason: string | null;
  respondedAt: string | null;
  changed: boolean;
  tooFast: boolean;
  inconsistent: boolean;
  dwellMs: number | null;
  missing: boolean;
  options: { code: number; label: string }[] | null;
}

export interface SectionView {
  key: string;
  title: string;
  conditional: boolean;
  completion: number | null;
  required: number;
  resolved: number;
  applicable: boolean;
  reached: boolean;
  answers: AnswerView[];
}

/** The session's answers grouped by section, in the wording of ITS OWN release. */
export function presentAnswers(assessment: Assessment, release: ReleaseIndex, options: { freeText: boolean }): SectionView[] {
  const outcomes = new Map(assessment.outcomes.map((o) => [o.key, o]));
  const sectionResults = new Map(assessment.sections.map((s) => [s.key, s]));
  return release.sections.map((s) => {
    const r = sectionResults.get(s.key);
    return {
      key: s.key,
      title: s.title,
      conditional: s.conditional,
      completion: r?.completion ?? null,
      required: r?.required ?? 0,
      resolved: r?.resolved ?? 0,
      applicable: r?.applicable ?? false,
      reached: r?.reached ?? false,
      answers: s.questionKeys.map((key) => {
        const q = release.byKey.get(key)!;
        const o = outcomes.get(key)!;
        const hasValue = o.outcome === "answered" || o.outcome === "invalid" || o.outcome === "answered_hidden";
        return {
          key,
          variable: q.variable,
          name: q.name,
          revision: q.revision,
          text: q.text,
          responseType: q.responseType,
          required: q.required,
          countsAsRequired: o.requiredLevel,
          conditional: q.displayIf !== undefined,
          identifying: q.identifying,
          freeText: q.freeText,
          outcome: o.outcome,
          shown: o.shown,
          presentedCount: o.presentedCount,
          answer: hasValue
            ? renderAnswer(q, o.value, options)
            : { display: null, code: null, redacted: q.identifying ? "identifying" : null, kind: null },
          emptyValue: o.emptyValue,
          invalidReason: o.invalidReason ?? null,
          respondedAt: o.respondedAt ?? null,
          changed: o.changed,
          tooFast: o.tooFast,
          inconsistent: o.inconsistent,
          dwellMs: o.dwellMs ?? null,
          missing: o.missing,
          options: q.options ? q.options.map((x) => ({ code: x.code, label: x.label })) : null,
        };
      }),
    };
  });
}
