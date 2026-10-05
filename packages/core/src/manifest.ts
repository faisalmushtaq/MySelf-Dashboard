import { z } from "zod";
import { codebookEntry } from "./codebook/index.js";
import type { LogicExpr } from "./vendor/engine.js";
import {
  indexReleaseQuestions,
  type OptionDef,
  type ReleaseQuestion,
  type ReleaseQuestions,
  type ReleaseSection,
  type RequiredLevel,
} from "./vendor/myself/store/completeness.js";

export type { OptionDef, RequiredLevel };

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

/**
 * One question as a particular release defines it: the survey's own reading of it
 * (`ReleaseQuestion`, from the completeness rules the two tools share) plus what the
 * dashboard adds — the codebook's names and the wording around the question.
 */
export interface QuestionDef extends ReleaseQuestion {
  /** Readable variable name from the codebook (docs/09); the survey variable when it has none. */
  name: string;
  /** Short label from the codebook; a shortened wording when it has none. */
  label: string;
  /** False when the codebook has no entry for this question yet. */
  named: boolean;
  /** The Qualtrics variable this question migrated from, where it did. */
  legacyVariable?: string;
  /** Context shown above the question, where there is some. */
  lede?: string;
  /** Unit of a numeric answer ("days"). */
  unit?: string;
  /** The survey's own note to researchers about this question. */
  researcherNote?: string;
  /** Answers are free text: never aggregated, restricted by role. */
  freeText: boolean;
  /** Question keys the display condition reads. */
  dependsOn: string[];
}

export type SectionDef = ReleaseSection;

export interface ReleaseIndex extends ReleaseQuestions {
  hash: string;
  key: string;
  version: string;
  study: string;
  title: string;
  publishedAt: string;
  questions: QuestionDef[];
  byKey: Map<string, QuestionDef>;
}

const FREE_TEXT_TYPES = new Set(["text_short", "text_long", "form_fields"]);

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
 * The questions, their order and their display conditions are the survey's own reading
 * (`indexReleaseQuestions`, vendored with the completeness rules), which walks sections →
 * components → items as `flattenManifest` in the participant app does, so "question 37"
 * and "would this have been shown" mean the same thing on the device, in the survey's
 * researcher view and here. What this adds is tolerance — an instrument or scale this
 * reader cannot parse is left out, and one that is placed but missing is a
 * `ManifestError` — and the codebook's names.
 */
export function indexRelease(raw: unknown, hashOverride?: string): ReleaseIndex {
  const manifest = parseManifest(raw);
  const hash = hashOverride ?? manifest.hash ?? "";
  const scales: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest.scales)) {
    const s = scale.safeParse(value);
    if (s.success) scales[key] = s.data;
  }
  const instruments: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest.instruments)) {
    const i = instrument.safeParse(value);
    if (i.success) instruments[key] = i.data;
  }

  let index: ReleaseQuestions;
  try {
    index = indexReleaseQuestions({ composition: manifest.composition, instruments, scales });
  } catch (e) {
    throw new ManifestError((e as Error).message);
  }

  const questions: QuestionDef[] = index.questions.map((q) => {
    const it = q.definition;
    const named = codebookEntry({ key: q.key, variable: q.variable, text: q.text });
    const lede = (it["lede"] as { text?: unknown } | undefined)?.text;
    return {
      ...q,
      name: named.name,
      label: named.label,
      named: named.fromCodebook,
      ...(typeof it["legacyVariable"] === "string" && it["legacyVariable"] ? { legacyVariable: (it["legacyVariable"] as string).trim() } : {}),
      ...(typeof lede === "string" && lede ? { lede } : {}),
      ...(typeof it["unitLabel"] === "string" ? { unit: it["unitLabel"] as string } : {}),
      ...(typeof it["researcherNote"] === "string" ? { researcherNote: it["researcherNote"] as string } : {}),
      freeText: FREE_TEXT_TYPES.has(q.responseType),
      dependsOn: [...referencedKeys(q.displayIf)],
    };
  });

  return {
    ...index,
    hash,
    key: manifest.release.key,
    version: manifest.release.version,
    study: manifest.release.study,
    title: manifest.composition.title,
    publishedAt: manifest.release.publishedAt,
    questions,
    byKey: new Map(questions.map((q) => [q.key, q])),
  };
}

/**
 * Canonical JSON exactly as the survey computes it for a release hash: the
 * survey's own implementation (its packages/schema/src/canonical.ts, vendored),
 * sorted keys, no whitespace, `undefined` members dropped. Hashing itself lives
 * in `./node`.
 */
export { canonicalJson } from "./vendor/myself/schema/canonical.js";

/** Compare two semver-ish version strings numerically ("7.10.0" > "7.9.0"). */
export function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}
