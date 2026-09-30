import {
  definitionOf,
  findItem,
  definitionKey,
  rewordable,
  scaleUsers,
  type Component,
  type Definition,
  type Item,
  type Json,
  type Section,
  type Workspace,
} from "./workspace.js";
import type { RequiredLevel } from "../manifest.js";

/**
 * The changes the survey editor can make (docs/11), one small, named step
 * each. A draft is its base version plus a list of these, so it can be
 * reviewed, replayed and undone one change at a time, and so what changed is
 * recorded as intent ("reworded the consent question") and not only as a
 * difference between two large documents.
 *
 * Every edit is checked here for what the editor itself must refuse — a
 * licensed instrument that may not be reworded, a scale a licensed instrument
 * also uses, a MyStory section that is not last. Everything the survey's
 * publish gate checks (references, conditions, scoring, assets, the protocol)
 * is left to the gate, which runs on every preview and publish.
 */

/** A simple show-only-if condition: the answer to one earlier question is, or is not, one option. */
export interface SimpleCondition {
  question: string; // `instrument.item`
  is: "selected" | "not_selected";
  code: number;
}

export interface NewQuestion {
  key: string;
  variable: string;
  type: "single_choice" | "multi_choice" | "text_short" | "text_long" | "numeric";
  text: string;
  options?: string[];
  required: RequiredLevel;
  min?: number;
  max?: number;
  showIf?: SimpleCondition;
}

export type Edit =
  | { op: "setTitle"; text: string }
  | { op: "setStudyLabel"; text: string }
  | { op: "setScreenText"; screen: string; field: "title" | "body"; text: string }
  | { op: "setSectionText"; section: string; field: "title" | "transition"; text: string }
  | { op: "moveSection"; section: string; to: number }
  | { op: "removeSection"; section: string }
  | { op: "restoreSection"; section: string; at: number }
  | { op: "moveComponent"; section: string; from: number; to: number }
  | { op: "removeComponent"; section: string; index: number }
  | { op: "restoreComponent"; section: string; component: Component; at: number }
  | { op: "setQuestionText"; question: string; field: "stem" | "lede" | "hint"; text: string }
  | { op: "setRequired"; question: string; required: RequiredLevel }
  | { op: "setOptionLabel"; scale: string; code: number; label: string }
  | { op: "addOption"; scale: string; label: string }
  | { op: "removeQuestion"; question: string }
  | { op: "addQuestion"; instrument: string; after: string | null; question: NewQuestion }
  | { op: "setShowIf"; question: string; condition: SimpleCondition | null }
  | { op: "setMyStory"; protocol: { key: string; version: string } | null; title?: string }
  | { op: "putProtocol"; protocol: Json };

export class EditError extends Error {}

const MYSTORY_SECTION = "mystory";

const sectionOf = (ws: Workspace, key: string): Section => {
  const s = ws.draft.sections.find((x) => x.key === key);
  if (!s) throw new EditError(`there is no section '${key}'`);
  return s;
};

const move = <T>(list: T[], from: number, to: number) => {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) throw new EditError("that position is outside the list");
  const [x] = list.splice(from, 1);
  list.splice(to, 0, x!);
};

function editableQuestion(ws: Workspace, key: string): { definition: Definition; item: Item } {
  const hit = findItem(ws, key);
  if (!hit) throw new EditError(`there is no question '${key}'`);
  if (!rewordable(hit.definition)) {
    throw new EditError(
      `'${hit.definition.name}' is a licensed instrument whose licence ${hit.definition.licence.modifiable === "no" ? "does not allow changes" : "allows changes only with permission"}; it can be left out or kept, but not reworded here`,
    );
  }
  return hit;
}

/**
 * A scale edit changes every question that uses the scale, so it is allowed
 * only when all of them may be reworded, and it moves the scale to a new major
 * version once per draft (as the ethnicity reordering did, D-53), so the
 * codebook can tell the two apart.
 */
function editableScale(ws: Workspace, key: string) {
  const scale = ws.scales[key];
  if (!scale) throw new EditError(`there is no scale '${key}'`);
  const users = scaleUsers(ws, key);
  const locked = users.find((u) => !rewordable(u.definition));
  if (locked) throw new EditError(`'${key}' is also used by '${locked.definition.name}', whose licence does not allow its options to change`);
  return { scale, users };
}

function bumpScale(ws: Workspace, key: string, baseScales: Workspace["scales"]) {
  const scale = ws.scales[key]!;
  const base = baseScales[key];
  if (base && scale.version === base.version) {
    const major = Number(scale.version.split(".")[0]) + 1;
    scale.version = `${major}.0.0`;
    for (const u of scaleUsers(ws, key)) u.item.scaleVersion = scale.version;
  }
}

function toLogic(ws: Workspace, c: SimpleCondition): Json {
  const target = findItem(ws, c.question);
  if (!target) throw new EditError(`the condition names '${c.question}', which is not a question here`);
  const [instrument, item] = c.question.split(".");
  return { op: c.is, target: { item: { instrument, item, revision: target.item.revision } }, code: c.code };
}

function newItem(ws: Workspace, instrument: string, q: NewQuestion): { item: Item; scale?: Json } {
  if (!/^[a-z][a-z0-9_]*$/.test(q.key)) throw new EditError("a question key is lower case letters, digits and underscores, starting with a letter");
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(q.variable)) throw new EditError("a variable name is lower case letters, digits and underscores, starting with a letter, at most 32 characters");
  if (findItem(ws, `${instrument}.${q.key}`)) throw new EditError(`'${instrument}.${q.key}' already exists`);
  const variables = new Set(Object.values(ws.definitions).flatMap((d) => d.forms[0]?.items.map((i) => i.variable) ?? []));
  if (variables.has(q.variable)) throw new EditError(`the variable name '${q.variable}' is already used`);
  if (!q.text.trim()) throw new EditError("a question needs its wording");
  const base: Item = {
    key: q.key,
    revision: 1,
    variable: q.variable,
    responseType: q.type,
    stem: { text: q.text.trim() },
    required: q.required,
    allowDecline: false,
    identifying: false,
    ...(q.showIf ? { displayIf: toLogic(ws, q.showIf) } : {}),
  };
  switch (q.type) {
    case "single_choice":
    case "multi_choice": {
      const labels = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (labels.length < 2) throw new EditError("a choice question needs at least two options");
      const scaleKey = `scale.${instrument}_${q.key}`;
      if (ws.scales[scaleKey]) throw new EditError(`a scale called '${scaleKey}' already exists`);
      const scale = { key: scaleKey, version: "1.0.0", name: q.text.trim().slice(0, 80), direction: "unordered", options: labels.map((label, i) => ({ code: i + 1, label, kind: "substantive", textEntry: false })) };
      const item: Item =
        q.type === "single_choice"
          ? { ...base, scale: scaleKey, scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true }
          : { ...base, scale: scaleKey, scaleVersion: "1.0.0", minSelections: q.required === "optional" ? 0 : 1 };
      return { item, scale };
    }
    case "text_short":
      return { item: { ...base, minChars: 0, maxChars: 200 } };
    case "text_long":
      return { item: { ...base, minChars: 0, maxChars: 5000 } };
    case "numeric":
      return { item: { ...base, integerOnly: true, ...(q.min !== undefined ? { min: q.min } : {}), ...(q.max !== undefined ? { max: q.max } : {}) } };
  }
}

/** Apply one edit to a copy of the working copy. `base` is the version the draft started from. */
export function applyEdit(current: Workspace, edit: Edit, base: Workspace): Workspace {
  const ws: Workspace = JSON.parse(JSON.stringify(current)) as Workspace;
  const d = ws.draft;
  switch (edit.op) {
    case "setTitle":
      if (!edit.text.trim()) throw new EditError("the title cannot be empty");
      d.title = edit.text.trim();
      break;
    case "setStudyLabel":
      d.studyLabel = edit.text.trim() || undefined;
      if (!d.studyLabel) delete d.studyLabel;
      break;
    case "setScreenText": {
      const screen = d.screens[edit.screen];
      if (!screen) throw new EditError(`there is no screen '${edit.screen}'`);
      if (edit.field === "body") {
        if (!edit.text.trim()) throw new EditError("a screen needs its text");
        screen.body = { ...screen.body, text: edit.text };
      } else if (edit.text.trim()) screen.title = { ...(screen.title ?? {}), text: edit.text };
      else delete screen.title;
      break;
    }
    case "setSectionText": {
      const s = sectionOf(ws, edit.section);
      if (edit.field === "title") {
        if (!edit.text.trim()) throw new EditError("a section needs a title");
        s.title = edit.text.trim();
      } else if (edit.text.trim()) s.transition = edit.text;
      else delete s.transition;
      break;
    }
    case "moveSection": {
      const i = d.sections.findIndex((s) => s.key === edit.section);
      if (i < 0) throw new EditError(`there is no section '${edit.section}'`);
      move(d.sections, i, edit.to);
      break;
    }
    case "removeSection": {
      if (d.sections.length === 1) throw new EditError("a survey needs at least one section");
      d.sections = d.sections.filter((s) => s.key !== edit.section);
      break;
    }
    case "restoreSection": {
      if (d.sections.some((s) => s.key === edit.section)) throw new EditError(`section '${edit.section}' is already in the survey`);
      const s = base.draft.sections.find((x) => x.key === edit.section);
      if (!s) throw new EditError(`section '${edit.section}' was not in the version this draft started from`);
      d.sections.splice(Math.min(edit.at, d.sections.length), 0, JSON.parse(JSON.stringify(s)) as Section);
      break;
    }
    case "moveComponent":
      move(sectionOf(ws, edit.section).components, edit.from, edit.to);
      break;
    case "removeComponent": {
      const s = sectionOf(ws, edit.section);
      if (!s.components[edit.index]) throw new EditError("that part is not in the section");
      if (s.components.length === 1) throw new EditError("a section needs at least one part; leave the section out instead");
      s.components.splice(edit.index, 1);
      break;
    }
    case "restoreComponent": {
      const s = sectionOf(ws, edit.section);
      const c = edit.component;
      if (c.kind === "instrument" || c.kind === "module") {
        if (!ws.definitions[definitionKey(c.ref)]) throw new EditError("that part was not in the version this draft started from");
      }
      s.components.splice(Math.min(edit.at, s.components.length), 0, c);
      break;
    }
    case "setQuestionText": {
      const { item } = editableQuestion(ws, edit.question);
      if (edit.field === "stem") {
        if (!edit.text.trim()) throw new EditError("a question needs its wording");
        item.stem = { ...item.stem, text: edit.text };
      } else if (edit.field === "lede") {
        if (edit.text.trim()) item.lede = { ...(item.lede ?? {}), text: edit.text };
        else delete item.lede;
      } else if (edit.text.trim()) item.hint = edit.text;
      else delete item.hint;
      break;
    }
    case "setRequired": {
      const { item } = editableQuestion(ws, edit.question);
      if (item.identifying && edit.required !== "hard") throw new EditError("identifying questions (name, date of birth) stay required: the sitting cannot be linked without them");
      item.required = edit.required;
      break;
    }
    case "setOptionLabel": {
      const { scale } = editableScale(ws, edit.scale);
      const option = scale.options.find((o) => o.code === edit.code);
      if (!option) throw new EditError(`'${edit.scale}' has no option coded ${edit.code}`);
      if (!edit.label.trim()) throw new EditError("an option needs a label");
      option.label = edit.label.trim();
      bumpScale(ws, edit.scale, base.scales);
      break;
    }
    case "addOption": {
      const { scale } = editableScale(ws, edit.scale);
      if (!edit.label.trim()) throw new EditError("an option needs a label");
      // A new code, never a reused one: an existing code keeps its meaning in every sitting that recorded it.
      const code = Math.max(...scale.options.map((o) => o.code)) + 1;
      scale.options.push({ code, label: edit.label.trim(), kind: "substantive", textEntry: false });
      bumpScale(ws, edit.scale, base.scales);
      break;
    }
    case "removeQuestion": {
      const { definition, item } = editableQuestion(ws, edit.question);
      if (item.identifying) throw new EditError("identifying questions (name, date of birth, address) cannot be removed here: they link the sitting to its participant");
      const items = definition.forms[0]!.items;
      if (items.length === 1) throw new EditError("this is the only question in its part; leave the part out instead");
      definition.forms[0]!.items = items.filter((i) => i !== item);
      break;
    }
    case "addQuestion": {
      const def = Object.values(ws.definitions).find((x) => x.instrument === edit.instrument && isPlaced(ws, x));
      if (!def) throw new EditError(`there is no part '${edit.instrument}' in the survey`);
      if (!rewordable(def)) throw new EditError(`'${def.name}' is a licensed instrument; questions can only be added to the study's own parts`);
      const { item, scale } = newItem(ws, edit.instrument, edit.question);
      if (scale) ws.scales[(scale as { key: string }).key] = scale as never;
      const items = def.forms[0]!.items;
      const at = edit.after === null ? 0 : items.findIndex((i) => i.key === edit.after) + 1;
      if (edit.after !== null && at === 0) throw new EditError(`there is no question '${edit.after}' in '${edit.instrument}'`);
      items.splice(at, 0, item);
      break;
    }
    case "setShowIf": {
      const { item } = editableQuestion(ws, edit.question);
      if (edit.condition) item.displayIf = toLogic(ws, edit.condition);
      else delete item.displayIf;
      break;
    }
    case "setMyStory": {
      d.sections = d.sections.filter((s) => !s.components.some((c) => c.kind === "narrative"));
      if (edit.protocol) {
        const id = `${edit.protocol.key}@${edit.protocol.version}`;
        if (!ws.narrativeProtocols[id]) throw new EditError(`the protocol '${id}' is not available to this draft; add it first`);
        // Always the last section: the survey, then MyStory, then the finish
        // screen and the hand-back to the researcher (survey D-54).
        d.sections.push({
          key: MYSTORY_SECTION,
          title: edit.title?.trim() || "MyStory",
          components: [{ kind: "narrative", protocol: edit.protocol.key, protocolVersion: edit.protocol.version }],
          randomiseComponents: false,
        });
        d.offline = { ...d.offline, narrativeConnectivity: d.offline.narrativeConnectivity ?? "online_required" };
      }
      break;
    }
    case "putProtocol": {
      const key = String(edit.protocol["key"] ?? "");
      const version = String(edit.protocol["version"] ?? "");
      if (!key || !version) throw new EditError("a protocol needs a key and a version");
      const id = `${key}@${version}`;
      const existing = ws.narrativeProtocols[id] ?? base.narrativeProtocols[id];
      // A key and version name one fixed protocol for good: a changed one needs a new version.
      if (existing && JSON.stringify(existing) !== JSON.stringify(edit.protocol) && base.narrativeProtocols[id]) {
        throw new EditError(`'${id}' was already published with different content; give the edited protocol a new version`);
      }
      ws.narrativeProtocols[id] = edit.protocol;
      break;
    }
  }
  // MyStory, when there is one, is always the last thing before the finish
  // screen and the hand-back (survey D-54): no edit may put anything after it.
  const story = d.sections.findIndex((s) => s.components.some((c) => c.kind === "narrative"));
  if (story >= 0 && story !== d.sections.length - 1) throw new EditError("MyStory stays the last section; put the other sections before it");
  return ws;
}

function isPlaced(ws: Workspace, def: Definition): boolean {
  return ws.draft.sections.some((s) => s.components.some((c) => (c.kind === "instrument" || c.kind === "module") && definitionOf(ws, c.ref) === def));
}

/** A draft: its base plus its edits in order. Stops at the first edit that no longer applies and says which. */
export function applyEdits(base: Workspace, edits: readonly Edit[]): { workspace: Workspace; failed?: { index: number; message: string } } {
  let ws = base;
  for (let i = 0; i < edits.length; i += 1) {
    try {
      ws = applyEdit(ws, edits[i]!, base);
    } catch (error) {
      return { workspace: ws, failed: { index: i, message: (error as Error).message } };
    }
  }
  return { workspace: ws };
}

/** The MyStory protocol a working copy ends with, if any. */
export function myStoryOf(ws: Workspace): { key: string; version: string } | null {
  for (const s of ws.draft.sections) for (const c of s.components) if (c.kind === "narrative") return { key: c.protocol, version: c.protocolVersion };
  return null;
}
