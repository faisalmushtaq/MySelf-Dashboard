import { z } from "zod";
import { codebookEntry } from "./codebook/index.js";
import type { LogicExpr } from "./vendor/engine.js";

/**
 * Release manifests, read tolerantly.
 *
 * The survey's own schema (`@myself/schema` `releaseManifest`) is strict because it
 * guards publishing. The dashboard only READS manifests, including ones a future
 * Survey Studio will write with fields nobody here has heard of, so this schema
 * checks the parts the dashboard depends on and passes everything else through.
 */

const displayText = z.object({ text: z.string() }).passthrough();

const scaleOption = z
  .object({
    code: z.number(),
    label: z.string(),
    kind: z.string().optional(),
    value: z.number().optional(),
  })
  .passthrough();

const scale = z
  .object({ key: z.string(), version: z.string().optional(), options: z.array(scaleOption) })
  .passthrough();

const item = z
  .object({
    key: z.string(),
    revision: z.number().int().default(1),
    variable: z.string(),
    responseType: z.string(),
    stem: displayText,
    required: z.enum(["hard", "soft", "optional"]).default("soft"),
    allowDecline: z.boolean().default(false),
    identifying: z.boolean().default(false),
    displayIf: z.unknown().optional(),
    scale: z.string().optional(),
  })
  .passthrough();

const form = z.object({ items: z.array(item), instructions: z.string().optional() }).passthrough();

const instrument = z.object({ instrument: z.string(), forms: z.array(form).min(1) }).passthrough();

const instrumentRef = z
  .object({
    instrument: z.string(),
    version: z.string(),
    variant: z.string().optional(),
    language: z.string(),
    informant: z.string().default("self"),
    readingLevel: z.string().default("standard"),
  })
  .passthrough();

const component = z
  .object({
    kind: z.string(),
    ref: instrumentRef.optional(),
    displayIf: z.unknown().optional(),
    protocol: z.string().optional(),
    protocolVersion: z.string().optional(),
  })
  .passthrough();

const section = z
  .object({
    key: z.string(),
    title: z.string(),
    displayIf: z.unknown().optional(),
    components: z.array(component),
  })
  .passthrough();

export const releaseManifestSchema = z
  .object({
    manifestVersion: z.number().optional(),
    release: z
      .object({
        key: z.string(),
        version: z.string(),
        assessment: z.string().optional(),
        study: z.string(),
        publishedAt: z.string(),
        publishedBy: z.string().optional(),
      })
      .passthrough(),
    composition: z
      .object({ key: z.string().optional(), title: z.string(), sections: z.array(section).min(1) })
      .passthrough(),
    instruments: z.record(z.string(), z.unknown()),
    scales: z.record(z.string(), z.unknown()).default({}),
    hash: z.string().optional(),
  })
  .passthrough();

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export type RequiredLevel = "hard" | "soft" | "optional";

export interface OptionDef {
  code: number;
  label: string;
  /** substantive | decline | dont_know | not_applicable | other_specify */
  kind: string;
  /** The number the code stands for, where it is not the code itself (an age band's age). */
  value?: number;
}

/** One question as a particular release defines it. */
export interface QuestionDef {
  /** Stable id: "<instrument>.<item>". */
  key: string;
  instrument: string;
  item: string;
  revision: number;
  /** The survey's own variable name, as stored. */
  variable: string;
  /** Readable variable name from the codebook (docs/09); the survey variable when it has none. */
  name: string;
  /** Short label from the codebook; a shortened wording when it has none. */
  label: string;
  /** False when the codebook has no entry for this question yet. */
  named: boolean;
  /** The Qualtrics variable this question migrated from, where it did. */
  legacyVariable?: string;
  sectionKey: string;
  sectionTitle: string;
  /** Position among the release's questions, 0-based. */
  order: number;
  /** Participant-facing wording in this release (pipes left as placeholders). */
  text: string;
  /** Context shown above the question, where there is some. */
  lede?: string;
  /** The instrument's instructions, shown before its first question. */
  instructions?: string;
  /** Unit of a numeric answer ("days"). */
  unit?: string;
  /** The survey's own note to researchers about this question. */
  researcherNote?: string;
  responseType: string;
  required: RequiredLevel;
  allowDecline: boolean;
  identifying: boolean;
  /** Answers are free text: never aggregated, restricted by role. */
  freeText: boolean;
  /** Section ∧ component ∧ item conditions, as the participant's device builds it. */
  displayIf?: LogicExpr;
  /** Question keys the display condition reads. */
  dependsOn: string[];
  scaleKey?: string;
  options?: OptionDef[];
  constraints: Record<string, unknown>;
}

export interface SectionDef {
  key: string;
  title: string;
  order: number;
  conditional: boolean;
  questionKeys: string[];
}

export interface ReleaseIndex {
  hash: string;
  key: string;
  version: string;
  study: string;
  title: string;
  publishedAt: string;
  sections: SectionDef[];
  questions: QuestionDef[];
  byKey: Map<string, QuestionDef>;
  /** Every presentable unit key, including info screens and instructions. */
  unitKeys: Set<string>;
  /** Section of every presentable unit (for "current section" of a sitting). */
  unitSection: Map<string, string>;
  /** Presentation order of every unit, for drop-off ordering. */
  unitOrder: Map<string, number>;
}

const FREE_TEXT_TYPES = new Set(["text_short", "text_long", "form_fields"]);

const CONSTRAINT_KEYS = [
  "min",
  "max",
  "step",
  "integerOnly",
  "minChars",
  "maxChars",
  "pattern",
  "minSelections",
  "maxSelections",
  "rungs",
  "lowestValue",
  "minYear",
  "maxYear",
  "fields",
  "statements",
  "groups",
] as const;

const and = (a: LogicExpr | undefined, b: LogicExpr | undefined): LogicExpr | undefined => {
  if (a && b) return { op: "all", args: [a, b] };
  return a ?? b;
};

/** Every question key a condition reads. */
export function referencedKeys(expr: LogicExpr | undefined, into = new Set<string>()): Set<string> {
  if (!expr) return into;
  switch (expr.op) {
    case "all":
    case "any":
      for (const a of expr.args) referencedKeys(a, into);
      return into;
    case "not":
      return referencedKeys(expr.arg, into);
    default:
      into.add(`${expr.target.item.instrument}.${expr.target.item.item}`);
      return into;
  }
}

/** The key the survey uses for a frozen instrument (apps/participant flatten.ts). */
export function instrumentRefKey(ref: z.infer<typeof instrumentRef>): string {
  return `${ref.instrument}@${ref.version}${ref.variant ? `+${ref.variant}` : ""}/${ref.language}/${ref.informant}/${ref.readingLevel}`;
}

export class ManifestError extends Error {}

export function parseManifest(raw: unknown): ReleaseManifest {
  const parsed = releaseManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ManifestError(`not a release manifest: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim());
  }
  return parsed.data;
}

/**
 * Build the dashboard's view of one release.
 *
 * Walks sections → components → items in the same order and with the same
 * condition conjunction as `flattenManifest` in the participant app, so "question
 * 37" and "would this have been shown" mean the same thing on both sides.
 */
export function indexRelease(raw: unknown, hashOverride?: string): ReleaseIndex {
  const manifest = parseManifest(raw);
  const hash = hashOverride ?? manifest.hash ?? "";
  const scales = new Map<string, OptionDef[]>();
  for (const [key, value] of Object.entries(manifest.scales)) {
    const s = scale.safeParse(value);
    if (s.success) {
      scales.set(
        key,
        s.data.options.map((o) => ({ code: o.code, label: o.label, kind: o.kind ?? "substantive", ...(o.value !== undefined && o.value !== o.code ? { value: o.value } : {}) })),
      );
    }
  }

  const frozen = new Map<string, z.infer<typeof instrument>>();
  for (const [key, value] of Object.entries(manifest.instruments)) {
    const i = instrument.safeParse(value);
    if (i.success) frozen.set(key, i.data);
  }

  const sections: SectionDef[] = [];
  const questions: QuestionDef[] = [];
  const unitKeys = new Set<string>();
  const unitSection = new Map<string, string>();
  const unitOrder = new Map<string, number>();
  let unitIndex = 0;

  const addUnit = (key: string, sectionKey: string) => {
    unitKeys.add(key);
    unitSection.set(key, sectionKey);
    if (!unitOrder.has(key)) unitOrder.set(key, unitIndex);
    unitIndex += 1;
  };

  manifest.composition.sections.forEach((sec, sectionOrder) => {
    const def: SectionDef = {
      key: sec.key,
      title: sec.title,
      order: sectionOrder,
      conditional: sec.displayIf !== undefined,
      questionKeys: [],
    };
    sections.push(def);
    for (const comp of sec.components) {
      if (comp.kind === "narrative" && comp.protocol) {
        addUnit(`${comp.protocol}.__narrative_${comp.protocol.replace(/^np\./, "")}`, sec.key);
        continue;
      }
      if ((comp.kind !== "instrument" && comp.kind !== "module") || !comp.ref) continue;
      const inst = frozen.get(instrumentRefKey(comp.ref));
      if (!inst) {
        throw new ManifestError(`manifest inconsistency: '${instrumentRefKey(comp.ref)}' is placed but not frozen`);
      }
      const form = inst.forms[0]!;
      const componentCondition = and(sec.displayIf as LogicExpr | undefined, comp.displayIf as LogicExpr | undefined);
      if (form.instructions) addUnit(`${comp.ref.instrument}.__instructions_${comp.ref.instrument}`, sec.key);
      for (const it of form.items) {
        const key = `${comp.ref.instrument}.${it.key}`;
        addUnit(key, sec.key);
        if (it.responseType === "info") continue;
        const displayIf = and(componentCondition, it.displayIf as LogicExpr | undefined);
        const constraints: Record<string, unknown> = {};
        const rawItem = it as Record<string, unknown>;
        for (const c of CONSTRAINT_KEYS) if (rawItem[c] !== undefined) constraints[c] = rawItem[c];
        const named = codebookEntry({ key, variable: it.variable, text: it.stem.text });
        const lede = (rawItem["lede"] as { text?: unknown } | undefined)?.text;
        const q: QuestionDef = {
          key,
          instrument: comp.ref.instrument,
          item: it.key,
          revision: it.revision,
          variable: it.variable,
          name: named.name,
          label: named.label,
          named: named.fromCodebook,
          ...(typeof rawItem["legacyVariable"] === "string" && rawItem["legacyVariable"] ? { legacyVariable: (rawItem["legacyVariable"] as string).trim() } : {}),
          sectionKey: sec.key,
          sectionTitle: sec.title,
          order: questions.length,
          text: it.stem.text,
          ...(typeof lede === "string" && lede ? { lede } : {}),
          ...(form.instructions ? { instructions: form.instructions } : {}),
          ...(typeof rawItem["unitLabel"] === "string" ? { unit: rawItem["unitLabel"] as string } : {}),
          ...(typeof rawItem["researcherNote"] === "string" ? { researcherNote: rawItem["researcherNote"] as string } : {}),
          responseType: it.responseType,
          required: it.required,
          allowDecline: it.allowDecline,
          identifying: it.identifying,
          freeText: FREE_TEXT_TYPES.has(it.responseType),
          ...(displayIf ? { displayIf } : {}),
          dependsOn: [...referencedKeys(displayIf)],
          ...(it.scale ? { scaleKey: it.scale } : {}),
          ...(it.scale && scales.has(it.scale) ? { options: scales.get(it.scale)! } : {}),
          constraints,
        };
        questions.push(q);
        def.questionKeys.push(key);
      }
    }
  });

  return {
    hash,
    key: manifest.release.key,
    version: manifest.release.version,
    study: manifest.release.study,
    title: manifest.composition.title,
    publishedAt: manifest.release.publishedAt,
    sections,
    questions,
    byKey: new Map(questions.map((q) => [q.key, q])),
    unitKeys,
    unitSection,
    unitOrder,
  };
}

/**
 * Canonical JSON exactly as the survey computes it for a release hash
 * (faisalmushtaq/MySelf packages/release/src/canonical.ts): sorted keys, no
 * whitespace, `undefined` members dropped. Hashing itself lives in `./node`.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Compare two semver-ish version strings numerically ("7.10.0" > "7.9.0"). */
export function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}
