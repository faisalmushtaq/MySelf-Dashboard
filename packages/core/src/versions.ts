import { toCsv } from "./csv.js";
import { compareVersions, releaseManifestSchema } from "./manifest.js";
import type { SessionSummary } from "./summary.js";

/**
 * The survey's version history, as the Survey versions page shows it and its
 * provenance export writes it (docs/11).
 *
 * MySelf Studio, in the survey's researcher view, is the one place a version
 * is edited and published. It keeps a record of every version, the live
 * pointer the iPads follow and an audit trail (the survey's docs/16 §5.2,
 * §9.2). The dashboard reads those, adds what only it knows — how many
 * sittings each version collected — and writes nothing back. A version the
 * dashboard's registry holds but Studio has no record of (one published from
 * the repository before Studio was set up) is listed too, as from the
 * repository.
 *
 * Everything here is pure: the functions read Firestore and hand the records
 * in, so the merging and the live periods are tested without a database.
 */

export type VersionSource = "studio" | "repository";

/** MyStory, when a version ends with it: the final section's narrative component. */
export interface MyStoryFacts {
  protocol: string;
  protocolVersion: string | null;
}

/** What the dashboard reads from a version's manifest itself. */
export interface ManifestFacts {
  engineVersion: string | null;
  myStory: MyStoryFacts | null;
}

/** One stretch of time a version was the one the iPads were sent to. */
export interface LivePeriod {
  from: string;
  /** Null while it is still live. */
  to: string | null;
  /**
   * How it became live: Studio's set-up from the live survey (it was already
   * live, so its earlier time is not in Studio's trail), a publish, "make live
   * again", or — with no trail to go on — the live pointer itself.
   */
  how: "set_up" | "published" | "made_live_again" | "pointer";
  /** Who did it (their Studio list address), when the trail says. */
  by: string | null;
  /** Why it was made live again, as the publisher wrote it. */
  reason: string | null;
}

export interface SittingCounts {
  sittings: number;
  /** Reached the end (the device's own "complete"), as Studio counts them. */
  complete: number;
  partial: number;
  firstSitting: string | null;
  lastSitting: string | null;
}

export interface SurveyVersionView extends SittingCounts {
  /** Studio's survey, or null for a version only the dashboard's registry knows. */
  surveyId: string | null;
  version: string;
  releaseKey: string;
  hash: string;
  engineVersion: string | null;
  source: VersionSource;
  /** Studio holds a record of this version. */
  inStudio: boolean;
  /** In the dashboard's registry, so the sittings under it are read. */
  registered: boolean;
  authors: string[];
  publishedBy: string | null;
  publishedAt: string | null;
  basedOn: string | null;
  /** The version restored into the draft this one was published from, if one was. */
  restoredFrom: string | null;
  releaseNote: string | null;
  /** Studio's change summary, one line per change. */
  changes: string[];
  /** The smallest bump the changes needed, and the one the version number took. */
  requiredBump: string | null;
  chosenBump: string | null;
  /** Null when it does not end with MyStory, or when its manifest could not be read (`problem`). */
  myStory: MyStoryFacts | null;
  live: boolean;
  livePeriods: LivePeriod[];
  /** Why the dashboard cannot read this version, when it cannot. */
  problem: string | null;
}

export interface LiveVersionView {
  surveyId: string;
  title: string;
  version: string;
  hash: string;
  releaseKey: string;
  generation: number;
  /** When the current live period began, as far as the records say. */
  since: string | null;
}

export interface SurveyVersionsResponse {
  /**
   * False until an administrator presses "Set up from the live survey" in
   * Studio. Until then every iPad runs the version built into the survey app.
   */
  studioSetUp: boolean;
  live: LiveVersionView[];
  /** Newest first. */
  versions: SurveyVersionView[];
  /** Sittings under a version neither Studio nor the registry knows. */
  unknownSittings: number;
  computedAt: string;
}

// ── What the functions hand in ──────────────────────────────────────────────

/** Studio's `versions/{version}` record (its VersionDoc), with times as ISO strings. */
export interface StudioVersionRecord {
  surveyId: string;
  version: string;
  hash: string;
  releaseKey: string;
  engineVersion: string | null;
  source: VersionSource;
  releaseNote: string | null;
  changes: string[];
  requiredBump: string | null;
  chosenBump: string | null;
  basedOn: string | null;
  authors: string[];
  publishedBy: string | null;
  publishedAt: string | null;
}

/** Studio's public live pointer, `published/{surveyId}`. */
export interface StudioPointer {
  hash: string;
  version: string;
  releaseKey: string;
  generation: number;
  publishedAt: string | null;
}

/** An audit row that moved the live pointer: the set-up, a publish, or "make live again". */
export interface StudioLiveEvent {
  at: string;
  how: "set_up" | "published" | "made_live_again";
  version: string;
  /** Null when the row names only the version (the set-up does). */
  hash: string | null;
  by: string | null;
  reason: string | null;
}

export interface StudioSurveyRecord {
  surveyId: string;
  title: string;
  pointer: StudioPointer | null;
  versions: StudioVersionRecord[];
  events: StudioLiveEvent[];
  /** Each "Restore into draft": which version, when. */
  restores: { at: string; version: string }[];
}

/** A version in the dashboard's own registry. */
export interface RegistryRecord {
  hash: string;
  version: string;
  releaseKey: string;
  publishedAt: string | null;
  source: VersionSource;
}

export interface VersionHistoryInput {
  studio: readonly StudioSurveyRecord[];
  registry: readonly RegistryRecord[];
  sittings: ReadonlyMap<string, SittingCounts>;
  /** Per hash: what its manifest says, or why it could not be read. */
  facts: ReadonlyMap<string, ManifestFacts | { problem: string }>;
  now: Date;
}

// ── Reading a manifest ──────────────────────────────────────────────────────

/** Whether a manifest ends with MyStory, and with which protocol. */
export function myStoryOf(raw: unknown): MyStoryFacts | null {
  const parsed = releaseManifestSchema.safeParse(raw);
  if (!parsed.success) return null;
  const last = parsed.data.composition.sections.at(-1);
  const narrative = last?.components.find((c) => c.kind === "narrative");
  if (!narrative) return null;
  return { protocol: narrative.protocol ?? "", protocolVersion: narrative.protocolVersion ?? null };
}

export function manifestFacts(raw: unknown): ManifestFacts {
  const release = (raw as { release?: { engineVersion?: unknown } } | null)?.release;
  return { engineVersion: typeof release?.engineVersion === "string" ? release.engineVersion : null, myStory: myStoryOf(raw) };
}

export const myStoryLabel = (m: MyStoryFacts | null): string => (m ? `${m.protocol}${m.protocolVersion ? `@${m.protocolVersion}` : ""}` : "");

// ── Sittings ────────────────────────────────────────────────────────────────

/** Sittings per release hash, from the dashboard's summaries: counts and dates only. */
export function sittingsByRelease(summaries: Iterable<Pick<SessionSummary, "releaseHash" | "terminal" | "startedAt">>): Map<string, SittingCounts> {
  const out = new Map<string, SittingCounts>();
  for (const s of summaries) {
    if (!s.releaseHash) continue;
    const c = out.get(s.releaseHash) ?? { sittings: 0, complete: 0, partial: 0, firstSitting: null, lastSitting: null };
    c.sittings += 1;
    if (s.terminal) c.complete += 1;
    else c.partial += 1;
    const at = s.startedAt;
    if (at && (!c.firstSitting || at < c.firstSitting)) c.firstSitting = at;
    if (at && (!c.lastSitting || at > c.lastSitting)) c.lastSitting = at;
    out.set(s.releaseHash, c);
  }
  return out;
}

// ── When each version was live ──────────────────────────────────────────────

/**
 * Each version's live periods, by hash, from the rows of Studio's audit trail
 * that moved the pointer: each lasts until the next one. A version that was
 * live before Studio was set up was live before the trail began, so only its
 * time since the set-up is in it. With no trail at all, the pointer alone says
 * which version is live, from the time it records.
 */
export function livePeriods(events: readonly StudioLiveEvent[], pointer: StudioPointer | null, hashOf: (version: string) => string | null): Map<string, LivePeriod[]> {
  const out = new Map<string, LivePeriod[]>();
  const add = (hash: string, p: LivePeriod) => out.set(hash, [...(out.get(hash) ?? []), p]);
  const ordered = events
    .map((e) => ({ ...e, hash: e.hash ?? hashOf(e.version) }))
    .filter((e): e is StudioLiveEvent & { hash: string } => e.hash !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
  ordered.forEach((e, i) => add(e.hash, { from: e.at, to: ordered[i + 1]?.at ?? null, how: e.how, by: e.by, reason: e.reason }));
  if (ordered.length === 0 && pointer?.publishedAt) add(pointer.hash, { from: pointer.publishedAt, to: null, how: "pointer", by: null, reason: null });
  return out;
}

/**
 * The version restored into the draft that `version` was published from: the
 * last restore after the publish (or set-up) before it, if there was one — as
 * Studio's own provenance reads it.
 */
export function restoredFrom(events: readonly StudioLiveEvent[], restores: readonly { at: string; version: string }[], version: string): string | null {
  const published = events.find((e) => e.how === "published" && e.version === version);
  if (!published) return null;
  const since = events
    .filter((e) => (e.how === "published" || e.how === "set_up") && e.at < published.at)
    .reduce((latest, e) => (e.at > latest ? e.at : latest), "");
  const restore = restores.filter((r) => r.at > since && r.at < published.at).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  return restore?.version ?? null;
}

// ── The history ─────────────────────────────────────────────────────────────

const EMPTY: SittingCounts = { sittings: 0, complete: 0, partial: 0, firstSitting: null, lastSitting: null };

export function versionHistory(input: VersionHistoryInput): SurveyVersionsResponse {
  const registered = new Set(input.registry.map((r) => r.hash));
  const versions: SurveyVersionView[] = [];
  const live: LiveVersionView[] = [];
  const seen = new Set<string>();
  const factsOf = (hash: string) => {
    const f = input.facts.get(hash);
    return f && "problem" in f ? { engineVersion: null, myStory: null, problem: f.problem } : { engineVersion: f?.engineVersion ?? null, myStory: f?.myStory ?? null, problem: null };
  };

  for (const survey of input.studio) {
    const hashOf = (version: string) => survey.versions.find((v) => v.version === version)?.hash ?? (survey.pointer?.version === version ? survey.pointer.hash : null);
    const periods = livePeriods(survey.events, survey.pointer, hashOf);
    if (survey.pointer) {
      const open = (periods.get(survey.pointer.hash) ?? []).find((p) => p.to === null);
      live.push({ surveyId: survey.surveyId, title: survey.title, version: survey.pointer.version, hash: survey.pointer.hash, releaseKey: survey.pointer.releaseKey, generation: survey.pointer.generation, since: open?.from ?? survey.pointer.publishedAt });
    }
    for (const v of survey.versions) {
      seen.add(v.hash);
      const f = factsOf(v.hash);
      versions.push({
        surveyId: survey.surveyId,
        version: v.version,
        releaseKey: v.releaseKey,
        hash: v.hash,
        engineVersion: v.engineVersion ?? f.engineVersion,
        source: v.source,
        inStudio: true,
        registered: registered.has(v.hash),
        authors: v.authors,
        publishedBy: v.publishedBy,
        publishedAt: v.publishedAt,
        basedOn: v.basedOn,
        restoredFrom: restoredFrom(survey.events, survey.restores, v.version),
        releaseNote: v.releaseNote,
        changes: v.changes,
        requiredBump: v.requiredBump,
        chosenBump: v.chosenBump,
        myStory: f.myStory,
        live: survey.pointer?.hash === v.hash,
        livePeriods: periods.get(v.hash) ?? [],
        ...(input.sittings.get(v.hash) ?? EMPTY),
        problem: f.problem,
      });
    }
  }

  for (const r of input.registry) {
    if (seen.has(r.hash)) continue;
    seen.add(r.hash);
    const f = factsOf(r.hash);
    versions.push({
      surveyId: null,
      version: r.version,
      releaseKey: r.releaseKey,
      hash: r.hash,
      engineVersion: f.engineVersion,
      source: r.source,
      inStudio: false,
      registered: true,
      authors: [],
      publishedBy: null,
      publishedAt: r.publishedAt,
      basedOn: null,
      restoredFrom: null,
      releaseNote: null,
      changes: [],
      requiredBump: null,
      chosenBump: null,
      myStory: f.myStory,
      live: false,
      livePeriods: [],
      ...(input.sittings.get(r.hash) ?? EMPTY),
      problem: f.problem,
    });
  }

  versions.sort((a, b) => compareVersions(b.version, a.version) || (a.surveyId ?? "").localeCompare(b.surveyId ?? ""));
  let unknownSittings = 0;
  for (const [hash, c] of input.sittings) if (!seen.has(hash)) unknownSittings += c.sittings;
  return { studioSetUp: input.studio.length > 0, live, versions, unknownSittings, computedAt: input.now.toISOString() };
}

// ── The provenance export ───────────────────────────────────────────────────

/** How a period began, in the words of Studio's own provenance export. */
const HOW: Record<LivePeriod["how"], string> = {
  set_up: "set up from the live survey",
  published: "published",
  made_live_again: "made live again",
  pointer: "the live pointer",
};

export const describePeriod = (p: LivePeriod): string => `${p.from} to ${p.to ?? "now"} (${HOW[p.how]})`;

/**
 * The columns Studio's own provenance export writes (survey docs/16 §10.2), in
 * its order and with its formats, so the two files read alike; then what only
 * the dashboard knows.
 */
export const PROVENANCE_COLUMNS = [
  "version",
  "release_key",
  "hash",
  "engine_version",
  "status",
  "source",
  "authors",
  "publisher",
  "published_at",
  "based_on",
  "restored_from",
  "release_note",
  "change_summary",
  "required_bump",
  "chosen_bump",
  "mystory",
  "mystory_protocol",
  "sittings_complete",
  "sittings_partial",
  "live_periods",
  "survey",
  "in_studio",
  "read_by_dashboard",
  "sittings",
  "first_sitting",
  "last_sitting",
  "problem",
] as const;

/**
 * Every version's provenance, in one table a researcher can keep with a
 * paper's supplementary material, newest first. Written with `toCsv`, so a
 * release note that starts with `=` is shown, not run. A cell that could not
 * be read is left empty, never guessed.
 */
export function provenanceCsv(versions: readonly SurveyVersionView[]): string {
  const rows = [...versions]
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((v) => {
      const read = v.problem === null;
      return [
        v.version,
        v.releaseKey,
        v.hash,
        v.engineVersion,
        v.live ? "live" : "previous",
        v.source,
        v.authors.join("; "),
        v.publishedBy,
        v.publishedAt,
        v.basedOn,
        v.restoredFrom,
        v.releaseNote,
        v.changes.join(" | "),
        v.requiredBump,
        v.chosenBump,
        read ? (v.myStory ? "on" : "off") : null,
        myStoryLabel(v.myStory) || null,
        v.complete,
        v.partial,
        v.livePeriods.map(describePeriod).join("; "),
        v.surveyId,
        v.inStudio ? "yes" : "no",
        v.registered ? "yes" : "no",
        v.sittings,
        v.firstSitting,
        v.lastSitting,
        v.problem,
      ];
    });
  return toCsv(PROVENANCE_COLUMNS, rows);
}

/** What the live periods and counts can and cannot say, carried in the JSON export. */
export const PROVENANCE_NOTES = [
  "Versions are edited and published in MySelf Studio; this is the dashboard's read-only record of them.",
  "Live periods come from Studio's audit trail: each publish, each “make live again”, and the set-up from the live survey. A version that was live before Studio was set up was live before the trail began, so those earlier periods are not listed.",
  "Sittings are counts of the sittings the dashboard has recorded under each version's hash; no participant data is included.",
];
