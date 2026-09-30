/**
 * The survey editor's working copy of a release (docs/11).
 *
 * A published manifest already holds everything that built it: the composition
 * (the draft), the frozen instrument forms, the scales, the scoring, the MyStory
 * protocols and the assets. So a draft is not written from scratch or from the
 * survey's question library — it is *unfrozen* from the version it starts
 * from, edited, and rebuilt by the survey's own release builder, which runs the
 * publish gate again (node/editor.ts).
 *
 * The types here are deliberately loose: the editor touches a handful of
 * fields, and everything else must pass through byte for byte, so the
 * definitions are carried as the JSON the manifest holds rather than re-typed.
 */

export type Json = Record<string, unknown>;

export interface ItemRef {
  instrument: string;
  item: string;
  revision: number;
}

export interface ScaleOption {
  code: number;
  label: string;
  kind?: string;
  [k: string]: unknown;
}

export interface Scale {
  key: string;
  version: string;
  name: string;
  options: ScaleOption[];
  [k: string]: unknown;
}

export interface Item {
  key: string;
  revision: number;
  variable: string;
  responseType: string;
  stem: { text: string; pipes?: Json };
  lede?: { text: string; pipes?: Json };
  hint?: string;
  required?: "hard" | "soft" | "optional";
  allowDecline?: boolean;
  identifying?: boolean;
  displayIf?: unknown;
  scale?: string;
  scaleVersion?: string;
  [k: string]: unknown;
}

export interface Definition {
  instrument: string;
  version: string;
  name: string;
  kind?: "module";
  licence: { status: string; modifiable: "yes" | "no" | "with_permission"; [k: string]: unknown };
  forms: { language: string; informant: string; readingLevel: string; variant?: string; items: Item[]; [k: string]: unknown }[];
  [k: string]: unknown;
}

export interface ComponentRef {
  instrument: string;
  version: string;
  language: string;
  informant: string;
  readingLevel: string;
  variant?: string;
}

export type Component =
  | { kind: "instrument" | "module"; ref: ComponentRef; displayIf?: unknown; overrides?: { required?: string; allowDecline?: boolean } }
  | { kind: "narrative"; protocol: string; protocolVersion: string; displayIf?: unknown }
  | { kind: "screen"; screen: string; displayIf?: unknown };

export interface Section {
  key: string;
  title: string;
  transition?: string;
  displayIf?: unknown;
  components: Component[];
  randomiseComponents?: boolean;
}

export interface Draft {
  key: string;
  study: string;
  title: string;
  studyLabel?: string;
  sections: Section[];
  screens: Record<string, { kind: string; title?: { text: string }; body: { text: string; pipes?: Json } }>;
  offline: { surveyOfflineCapable: true; narrativeConnectivity?: string };
  [k: string]: unknown;
}

export interface Workspace {
  /** The release this draft started from. */
  base: { hash: string; version: string; key: string; engineVersion: string };
  draft: Draft;
  /** Frozen definitions, keyed as the manifest keys them (`instrument@version/…`). */
  definitions: Record<string, Definition>;
  scales: Record<string, Scale>;
  scoring: Record<string, Json>;
  /** MyStory protocols, keyed `key@version`. */
  narrativeProtocols: Record<string, Json>;
  assets: Record<string, { path: string; sha256: string; bytes: number }>;
}

interface ManifestLike {
  hash?: string;
  release: { version: string; key: string; engineVersion: string };
  composition: unknown;
  instruments: Record<string, unknown>;
  scales: Record<string, unknown>;
  scoring: Record<string, unknown>;
  narrativeProtocols: Record<string, unknown>;
  assets: Record<string, { path: string; sha256: string; bytes: number }>;
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A published manifest, as a working copy the editor can change. */
export function unfreeze(manifest: ManifestLike): Workspace {
  return {
    base: { hash: manifest.hash ?? "", version: manifest.release.version, key: manifest.release.key, engineVersion: manifest.release.engineVersion },
    draft: copy(manifest.composition) as Draft,
    definitions: copy(manifest.instruments) as Record<string, Definition>,
    scales: copy(manifest.scales) as Record<string, Scale>,
    scoring: copy(manifest.scoring) as Record<string, Json>,
    narrativeProtocols: copy(manifest.narrativeProtocols) as Record<string, Json>,
    assets: copy(manifest.assets),
  };
}

export const definitionKey = (ref: ComponentRef): string =>
  `${ref.instrument}@${ref.version}${ref.variant ? `+${ref.variant}` : ""}/${ref.language}/${ref.informant}/${ref.readingLevel}`;

/** The definition a component administers, and its one frozen form. */
export function definitionOf(ws: Workspace, ref: ComponentRef): Definition | undefined {
  return ws.definitions[definitionKey(ref)];
}

/** Every administered question, in order, with where it lives. */
export function questions(ws: Workspace): { section: Section; component: Component & { kind: "instrument" | "module" }; definition: Definition; item: Item }[] {
  const out: { section: Section; component: Component & { kind: "instrument" | "module" }; definition: Definition; item: Item }[] = [];
  for (const section of ws.draft.sections) {
    for (const component of section.components) {
      if (component.kind !== "instrument" && component.kind !== "module") continue;
      const definition = definitionOf(ws, component.ref);
      for (const item of definition?.forms[0]?.items ?? []) out.push({ section, component, definition: definition!, item });
    }
  }
  return out;
}

/** Find a question by `instrument.item` in whichever definition administers it. */
export function findItem(ws: Workspace, key: string): { definition: Definition; item: Item } | undefined {
  const [instrument, itemKey] = key.split(".");
  for (const definition of Object.values(ws.definitions)) {
    if (definition.instrument !== instrument) continue;
    const item = definition.forms[0]?.items.find((i) => i.key === itemKey);
    if (item) return { definition, item };
  }
  return undefined;
}

/**
 * Whether a definition's wording may be changed here. Only where its licence
 * says so outright: `with_permission` means somebody has to ask first, and an
 * editor cannot know that they did.
 */
export const rewordable = (d: Definition): boolean => d.licence.modifiable === "yes";

/** The questions that share a scale — an edit to the scale changes all of them. */
export function scaleUsers(ws: Workspace, scaleKey: string): { definition: Definition; item: Item }[] {
  const out: { definition: Definition; item: Item }[] = [];
  for (const definition of Object.values(ws.definitions)) {
    for (const item of definition.forms[0]?.items ?? []) if (item.scale === scaleKey) out.push({ definition, item });
  }
  return out;
}

/** The registries `buildRelease` takes, rebuilt from the working copy. */
export function registriesOf(ws: Workspace): {
  instruments: Json[];
  modules: Json[];
  scales: Json[];
  scoring: Json[];
  narrativeProtocols: Json[];
  assets: Workspace["assets"];
} {
  const instruments: Json[] = [];
  const modules: Json[] = [];
  const placed = new Set<string>();
  for (const section of ws.draft.sections) {
    for (const component of section.components) {
      if (component.kind !== "instrument" && component.kind !== "module") continue;
      const key = definitionKey(component.ref);
      const def = ws.definitions[key];
      if (!def || placed.has(key)) continue;
      placed.add(key);
      (component.kind === "module" ? modules : instruments).push(def as unknown as Json);
    }
  }
  return {
    instruments,
    modules,
    scales: Object.values(ws.scales) as unknown as Json[],
    scoring: Object.values(ws.scoring),
    narrativeProtocols: Object.values(ws.narrativeProtocols),
    assets: ws.assets,
  };
}
