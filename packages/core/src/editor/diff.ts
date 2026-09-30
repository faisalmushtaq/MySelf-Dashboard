import { questions, type Component, type Item, type Workspace } from "./workspace.js";

/**
 * What changed between two versions of the survey, worked out from their
 * content rather than from the edits that produced it: a version built in the
 * repository and one built in the editor are compared the same way, and
 * nothing an edit did can be left out of the list.
 *
 * Each change says whether a participant could experience it. That, and
 * nothing else, decides the version number (survey docs/06 §3; version.ts).
 */

export type ChangeArea = "survey" | "screen" | "section" | "part" | "question" | "options" | "mystory";

export interface Change {
  area: ChangeArea;
  /** What it is about: a section key, `instrument.item`, a scale key, a screen. */
  subject: string;
  summary: string;
  /** Could a participant read, choose or be routed differently? */
  participantVisible: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const componentId = (c: Component): string =>
  c.kind === "narrative" ? `mystory:${c.protocol}` : c.kind === "screen" ? `screen:${c.screen}` : `${c.kind}:${c.ref.instrument}`;

const TEXT_FIELDS: [keyof Item, string][] = [
  ["stem", "wording"],
  ["lede", "text under the question"],
  ["hint", "hint"],
  ["moreInfo", "“more information”"],
];
const HANDLED = new Set(["stem", "lede", "hint", "moreInfo", "required", "displayIf", "scaleVersion", "revision"]);

export function diffWorkspaces(before: Workspace, after: Workspace): Change[] {
  const changes: Change[] = [];
  const add = (c: Change) => changes.push(c);
  const b = before.draft;
  const a = after.draft;

  // ── The survey as a whole ────────────────────────────────────────────────
  if (b.title !== a.title) add({ area: "survey", subject: "title", summary: `Title: “${clip(a.title)}”`, participantVisible: false });
  if ((b.studyLabel ?? "") !== (a.studyLabel ?? "")) {
    add({ area: "survey", subject: "studyLabel", summary: `Label on the opening screen: “${a.studyLabel ?? "(none)"}”`, participantVisible: true });
  }
  for (const key of new Set([...Object.keys(b.screens), ...Object.keys(a.screens)])) {
    if (!same(b.screens[key], a.screens[key])) add({ area: "screen", subject: key, summary: `The ${key} screen's text`, participantVisible: true });
  }

  // ── Sections and their parts ─────────────────────────────────────────────
  const bSections = new Map(b.sections.map((s) => [s.key, s]));
  const aSections = new Map(a.sections.map((s) => [s.key, s]));
  // A section that is only MyStory is reported once, as a MyStory change, below.
  const onlyStory = (s: { components: Component[] }) => s.components.every((c) => c.kind === "narrative");
  for (const s of b.sections) if (!aSections.has(s.key) && !onlyStory(s)) add({ area: "section", subject: s.key, summary: `Section “${s.title}” left out`, participantVisible: true });
  for (const s of a.sections) {
    const old = bSections.get(s.key);
    if (!old) {
      if (!onlyStory(s)) add({ area: "section", subject: s.key, summary: `Section “${s.title}” added`, participantVisible: true });
      continue;
    }
    if (old.title !== s.title) add({ area: "section", subject: s.key, summary: `Section title: “${s.title}”`, participantVisible: true });
    if ((old.transition ?? "") !== (s.transition ?? "")) add({ area: "section", subject: s.key, summary: `Text introducing “${s.title}”`, participantVisible: true });
    if (!same(old.displayIf, s.displayIf)) add({ area: "section", subject: s.key, summary: `Who is shown “${s.title}”`, participantVisible: true });
    const oldIds = old.components.map(componentId);
    const newIds = s.components.map(componentId);
    for (const id of oldIds) if (!newIds.includes(id)) add({ area: "part", subject: id, summary: `${label(id)} left out of “${s.title}”`, participantVisible: true });
    for (const id of newIds) if (!oldIds.includes(id)) add({ area: "part", subject: id, summary: `${label(id)} added to “${s.title}”`, participantVisible: true });
    const kept = oldIds.filter((id) => newIds.includes(id));
    if (!same(kept, newIds.filter((id) => oldIds.includes(id)))) add({ area: "section", subject: s.key, summary: `Order of the parts in “${s.title}”`, participantVisible: true });
    for (const c of s.components) {
      const prev = old.components.find((x) => componentId(x) === componentId(c));
      if (prev && (!same(prev.displayIf, c.displayIf) || !same((prev as { overrides?: unknown }).overrides, (c as { overrides?: unknown }).overrides))) {
        add({ area: "part", subject: componentId(c), summary: `${label(componentId(c))}: who sees it, or how it is required`, participantVisible: true });
      }
    }
  }
  const bOrder = b.sections.map((s) => s.key).filter((k) => aSections.has(k));
  const aOrder = a.sections.map((s) => s.key).filter((k) => bSections.has(k));
  if (!same(bOrder, aOrder)) add({ area: "survey", subject: "sections", summary: "Order of the sections", participantVisible: true });

  // ── Questions ────────────────────────────────────────────────────────────
  const bq = new Map(questions(before).map((q) => [`${q.definition.instrument}.${q.item.key}`, q.item]));
  const aq = new Map(questions(after).map((q) => [`${q.definition.instrument}.${q.item.key}`, q.item]));
  // A part left out or added as a whole is reported once, above, not question by question.
  const placed = (ws: Workspace) => new Set(questions(ws).map((q) => q.definition.instrument));
  const inBefore = placed(before);
  const inAfter = placed(after);
  for (const [key, item] of bq) {
    if (!aq.has(key) && inAfter.has(key.split(".")[0]!)) add({ area: "question", subject: key, summary: `Question removed: “${clip(item.stem.text)}”`, participantVisible: true });
  }
  for (const [key, item] of aq) {
    const old = bq.get(key);
    if (!old) {
      if (inBefore.has(key.split(".")[0]!)) add({ area: "question", subject: key, summary: `Question added: “${clip(item.stem.text)}”`, participantVisible: true });
      continue;
    }
    for (const [field, name] of TEXT_FIELDS) {
      if (!same(old[field], item[field])) add({ area: "question", subject: key, summary: `${key}: ${name}`, participantVisible: true });
    }
    if ((old.required ?? "soft") !== (item.required ?? "soft")) add({ area: "question", subject: key, summary: `${key}: now ${item.required ?? "soft"}`, participantVisible: true });
    if (!same(old.displayIf, item.displayIf)) add({ area: "question", subject: key, summary: `${key}: who is asked it`, participantVisible: true });
    const rest = (i: Item) => Object.fromEntries(Object.entries(i).filter(([k]) => !HANDLED.has(k)));
    if (!same(rest(old), rest(item))) add({ area: "question", subject: key, summary: `${key}: how it is answered`, participantVisible: true });
  }

  // ── Answer options (only the scales a question in the new version uses) ──
  const used = new Set([...aq.values()].map((i) => i.scale).filter((s): s is string => Boolean(s)));
  for (const key of used) {
    const old = before.scales[key];
    const now = after.scales[key];
    if (!old || !now) continue; // a new question's own scale: its question is already listed
    const oldCodes = old.options.map((o) => o.code);
    const newCodes = now.options.map((o) => o.code);
    for (const o of now.options) {
      const prev = old.options.find((x) => x.code === o.code);
      if (!prev) add({ area: "options", subject: key, summary: `Option added to ${key}: “${o.label}”`, participantVisible: true });
      else if (!same(prev, o)) add({ area: "options", subject: key, summary: `${key}: option ${o.code} is now “${o.label}”`, participantVisible: true });
    }
    for (const c of oldCodes) if (!newCodes.includes(c)) add({ area: "options", subject: key, summary: `${key}: option ${c} removed`, participantVisible: true });
    if (!same(oldCodes.filter((c) => newCodes.includes(c)), newCodes.filter((c) => oldCodes.includes(c)))) {
      add({ area: "options", subject: key, summary: `${key}: order of the options`, participantVisible: true });
    }
  }

  // ── MyStory ──────────────────────────────────────────────────────────────
  const story = (ws: Workspace) => {
    for (const s of ws.draft.sections) for (const c of s.components) if (c.kind === "narrative") return `${c.protocol}@${c.protocolVersion}`;
    return null;
  };
  const bs = story(before);
  const as = story(after);
  if (bs !== as) {
    add({ area: "mystory", subject: as ?? bs ?? "", summary: as ? (bs ? `MyStory now uses ${as} (was ${bs})` : `MyStory added at the end, using ${as}`) : `MyStory removed (was ${bs})`, participantVisible: true });
  } else if (as && !same(before.narrativeProtocols[as], after.narrativeProtocols[as])) {
    add({ area: "mystory", subject: as, summary: `MyStory protocol ${as} changed`, participantVisible: true });
  }

  return changes;
}

function label(id: string): string {
  const [kind, name] = id.split(":");
  return kind === "mystory" ? `MyStory (${name})` : kind === "screen" ? `The ${name} screen` : `“${name}”`;
}
