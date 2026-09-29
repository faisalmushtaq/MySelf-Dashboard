import { DEMO_CODEBOOK } from "./demo.js";
import { DEFAULT_CODEBOOK, type CodebookEntry } from "./names.js";

export { DEFAULT_CODEBOOK, type CodebookEntry } from "./names.js";
export { DEMO_CODEBOOK } from "./demo.js";

/** Valid unchanged in R, Python, SPSS and Stata. */
export const NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
export const LABEL_MAX = 80;

export type Codebook = Readonly<Record<string, CodebookEntry>>;

/** The survey's codebook, and the demo survey's for the synthetic study (their keys never overlap). */
export const BUILT_IN_CODEBOOK: Codebook = { ...DEMO_CODEBOOK, ...DEFAULT_CODEBOOK };

/**
 * The readable name and label for one question. A question the codebook does
 * not know yet (a new survey version, a synthetic one) keeps its survey variable
 * as its name and a shortened wording as its label, and `codebookProblems()`
 * reports it, so it is never silently unnamed.
 */
export function codebookEntry(q: { key: string; variable: string; text: string }, codebook: Codebook = BUILT_IN_CODEBOOK): CodebookEntry & { fromCodebook: boolean } {
  const entry = codebook[q.key];
  if (entry) return { ...entry, fromCodebook: true };
  const text = q.text.replace(/\s+/g, " ").trim();
  return { name: q.variable, label: text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1).trimEnd()}…` : text, fromCodebook: false };
}

export interface CodebookProblem {
  level: "error" | "warning";
  key: string;
  message: string;
}

/**
 * What is wrong with the codebook for these questions: a question with no
 * entry, a name that is not a safe identifier, two questions under one name,
 * and labels that are empty or too long.
 */
export function codebookProblems(questions: readonly { key: string; variable: string }[], codebook: Codebook = BUILT_IN_CODEBOOK): CodebookProblem[] {
  const problems: CodebookProblem[] = [];
  const keys = [...new Set(questions.map((q) => q.key))];
  for (const key of keys) {
    if (!codebook[key]) problems.push({ level: "error", key, message: `'${key}' has no readable name or label in the codebook; it is shown under its survey variable.` });
  }
  // Names only need to be unique among the questions that appear together.
  const byName = new Map<string, string[]>();
  for (const key of keys) {
    const entry = codebook[key];
    if (!entry) continue;
    if (!NAME_PATTERN.test(entry.name)) problems.push({ level: "error", key, message: `'${entry.name}' is not a safe variable name (lower case, letters, digits and _, at most 32 characters, starting with a letter).` });
    if (!entry.label.trim()) problems.push({ level: "error", key, message: `'${entry.name}' has no label.` });
    else if (entry.label.length > LABEL_MAX) problems.push({ level: "warning", key, message: `The label of '${entry.name}' is ${entry.label.length} characters; keep labels to ${LABEL_MAX}.` });
    byName.set(entry.name, [...(byName.get(entry.name) ?? []), key]);
  }
  for (const [name, owners] of byName) {
    if (owners.length > 1) problems.push({ level: "error", key: owners[0]!, message: `'${name}' names ${owners.length} different questions: ${owners.join(", ")}.` });
  }
  return problems;
}
