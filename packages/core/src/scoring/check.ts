import type { ReleaseIndex } from "../manifest.js";
import type { ScoringScheme } from "./scheme.js";

/**
 * A scheme checked against a survey version: does every item it scores exist
 * there, can it be scored, and do reversals and re-codings fit the codes the
 * version actually uses? A scheme that names an item the version does not have
 * would otherwise produce nothing but blanks, silently.
 */

export interface SchemeIssue {
  level: "error" | "warning";
  message: string;
}

export interface SchemeCheck {
  /** The version administers the scheme's instrument at all. */
  applies: boolean;
  issues: SchemeIssue[];
}

const SCORABLE = new Set(["single_choice", "numeric", "slider", "ladder"]);

export function itemsOf(scheme: ScoringScheme): string[] {
  const out = new Set<string>();
  for (const t of scheme.transforms) for (const i of t.items) out.add(i);
  for (const o of scheme.outputs) {
    if (o.calc.op === "sum" || o.calc.op === "mean") for (const i of o.calc.items) out.add(i);
    if (o.calc.op === "item") out.add(o.calc.item);
  }
  return [...out];
}

export function checkScheme(scheme: ScoringScheme, release: ReleaseIndex): SchemeCheck {
  const applies = release.questions.some((q) => q.instrument === scheme.instrument);
  if (!applies) return { applies, issues: [] };
  const issues: SchemeIssue[] = [];
  const q = (item: string) => release.byKey.get(`${scheme.instrument}.${item}`);
  for (const item of itemsOf(scheme)) {
    const def = q(item);
    if (!def) issues.push({ level: "error", message: `"${item}" is not a question of ${scheme.instrument} in v${release.version}, so every score that uses it will be blank.` });
    else if (!SCORABLE.has(def.responseType)) issues.push({ level: "error", message: `"${item}" is a ${def.responseType.replace("_", " ")} question and cannot be scored.` });
  }
  for (const t of scheme.transforms) {
    for (const item of t.items) {
      const codes = (q(item)?.options ?? []).filter((o) => o.kind === "substantive");
      if (!codes.length) continue;
      if (t.op === "reverse") {
        const lo = Math.min(...codes.map((o) => o.code));
        const hi = Math.max(...codes.map((o) => o.code));
        if (lo + hi !== t.maxPlusMin) issues.push({ level: "error", message: `"${item}" is coded ${lo}–${hi}, so it reverses with ${lo + hi}, not ${t.maxPlusMin}.` });
      } else {
        const unmapped = codes.filter((o) => !(String(o.code) in t.map));
        if (unmapped.length) issues.push({ level: "warning", message: `"${item}": ${unmapped.map((o) => `${o.code} (${o.label})`).join(", ")} ${unmapped.length === 1 ? "is" : "are"} not in the re-coding and will count as missing.` });
      }
    }
  }
  return { applies, issues };
}
