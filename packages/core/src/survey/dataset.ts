import { releaseManifest, type ReleaseManifest } from "../vendor/myself/schema/index.js";
import { ingest, type DeviceSession } from "../vendor/myself/store/ingest.js";
import { emptyDataset, type Dataset } from "../vendor/myself/store/dataset.js";
import type { Sitting } from "../types.js";
import { schoolYearOn } from "../scoring/groups.js";

/**
 * The study dataset, derived exactly as the survey's own export derives it
 * (MySelf apps/functions/src/export.ts `buildStudyDataset`): every sitting,
 * grouped by the release it was collected under, oldest group first, read
 * through the survey's `ingest` with the study's code corrections and twin
 * assignments — so participant codes and wave numbers here are the survey's.
 *
 * Two deliberate differences, both in the direction of saying more:
 *   - a sitting whose release cannot be read is listed as excluded, never read
 *     through a different release;
 *   - collisions are reported by code and sittings only — the names the
 *     survey's ingest uses to detect them never leave this function.
 */

export interface Excluded {
  sessionId: string;
  reason: string;
}

export interface StudyDataset {
  dataset: Dataset;
  excluded: Excluded[];
  collisions: { participantId: string; sessionIds: string[] }[];
  warnings: string[];
  /**
   * School year at each sitting, from the date of birth given in it. Only the
   * year is kept: the date of birth, like every identifying answer, is dropped.
   */
  schoolYearFromDob: Record<string, number>;
}

/**
 * A release manifest in the survey's schema. Releases r1.0.0–r4.0.0 store the
 * finish screen's body as a plain string where the current schema expects
 * `{ text }`; that is presentation only, so it is adapted and nothing else is.
 */
export function parseSurveyManifest(raw: unknown): { manifest: ReleaseManifest; adapted: boolean } | { error: string } {
  const strict = releaseManifest.safeParse(raw);
  if (strict.success) return { manifest: strict.data, adapted: false };
  const onlyPresentation = strict.error.issues.every((i) => i.path[0] === "composition" && i.path[1] === "screens");
  if (onlyPresentation && raw && typeof raw === "object") {
    const copy = structuredClone(raw) as { composition?: { screens?: Record<string, { body?: unknown }> } };
    for (const screen of Object.values(copy.composition?.screens ?? {})) {
      if (typeof screen.body === "string") screen.body = { text: screen.body };
    }
    const retry = releaseManifest.safeParse(copy);
    if (retry.success) return { manifest: retry.data, adapted: true };
  }
  const first = strict.error.issues[0];
  return { error: `${first?.path.join(".") ?? ""} ${first?.message ?? ""}`.trim() };
}

const earliest = (rows: readonly DeviceSession[]) => rows.reduce((m, r) => (r.startedAt < m ? r.startedAt : m), rows[0]!.startedAt);

export function deriveStudyDataset(input: {
  study: string;
  sittings: readonly Sitting[];
  manifests: ReadonlyMap<string, ReleaseManifest>;
  aliases?: Record<string, string>;
  assignments?: Record<string, string>;
  /** First month of the school year, for year groups from dates of birth (9 = September). */
  schoolYearStartMonth?: number;
}): StudyDataset {
  const excluded: Excluded[] = [];
  const warnings: string[] = [];
  const groups = new Map<string, DeviceSession[]>();
  for (const s of input.sittings) {
    if (s.quarantined) excluded.push({ sessionId: s.sessionId, reason: "quarantined in the survey" });
    else if (s.unreadable) excluded.push({ sessionId: s.sessionId, reason: "log incomplete (chunks missing)" });
    else if (!s.startedAt) excluded.push({ sessionId: s.sessionId, reason: "no start time recorded" });
    else if (!s.releaseHash || !input.manifests.has(s.releaseHash)) excluded.push({ sessionId: s.sessionId, reason: "survey version not readable" });
    else {
      const d: DeviceSession = {
        sessionId: s.sessionId,
        studyCode: s.studyCode ?? "",
        releaseKey: s.releaseKey ?? "",
        releaseHash: s.releaseHash,
        startedAt: s.startedAt,
        ...(s.completedAt ? { completedAt: s.completedAt } : {}),
        complete: s.complete === true,
        events: s.events,
      };
      const list = groups.get(s.releaseHash);
      if (list) list.push(d);
      else groups.set(s.releaseHash, [d]);
    }
  }

  let dataset = emptyDataset();
  const collisions: StudyDataset["collisions"] = [];
  const schoolYearFromDob: Record<string, number> = {};
  for (const [hash, group] of [...groups.entries()].sort((a, b) => earliest(a[1]).localeCompare(earliest(b[1])))) {
    const result = ingest(
      [...group].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
      {
        manifest: input.manifests.get(hash)!,
        study: input.study,
        existing: dataset,
        ...(input.aliases ? { aliases: input.aliases } : {}),
        ...(input.assignments ? { assignments: input.assignments } : {}),
      },
    );
    dataset = result.dataset;
    excluded.push(...result.rejected);
    warnings.push(...result.warnings);
    for (const c of result.collisions) collisions.push({ participantId: c.participantId, sessionIds: [...c.sessions] });
    for (const id of result.identity) {
      if (id.variable !== "dob") continue;
      const year = schoolYearOn(id.value, id.recordedAt, input.schoolYearStartMonth ?? 9);
      if (year !== null) schoolYearFromDob[id.sessionId] = year;
    }
  }
  return { dataset, excluded, collisions, warnings, schoolYearFromDob };
}

/**
 * The dataset restricted to some sittings: the survey's own function (vendored), so
 * a filtered export here and the researcher view's count restrict it the same way.
 */
export { subsetDataset } from "../vendor/myself/store/dataset.js";

/**
 * Participant codes replaced by labels that mean nothing outside this export
 * (P0001… in order of first appearance), study codes dropped and times cut to
 * the day. What makes the export de-identified rather than anonymous is said
 * in its README: answers themselves can still identify.
 */
export function pseudonymiseDataset(d: Dataset): { dataset: Dataset; labels: Map<string, string> } {
  const order = [...d.participants].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen) || a.participantId.localeCompare(b.participantId));
  const labels = new Map(order.map((p, i) => [p.participantId, `P${String(i + 1).padStart(4, "0")}`]));
  const day = (iso: string) => `${iso.slice(0, 10)}T00:00:00.000Z`;
  const relabel = (id: string) => labels.get(id) ?? "PUNKNOWN";
  return {
    labels,
    dataset: {
      ...d,
      participants: d.participants.map((p) => ({ ...p, participantId: relabel(p.participantId), firstSeen: day(p.firstSeen), lastSeen: day(p.lastSeen) })),
      sessions: d.sessions.map(({ studyCode: _code, completedAt: _done, ...s }) => ({ ...s, participantId: relabel(s.participantId), startedAt: day(s.startedAt) })),
      responses: d.responses.map((r) => ({ ...r, participantId: relabel(r.participantId) })),
      scores: d.scores.map((r) => ({ ...r, participantId: relabel(r.participantId) })),
    },
  };
}

/** Free-text answers removed: their columns are left out rather than emptied. */
export function withoutVariables(d: Dataset, variables: ReadonlySet<string>): Dataset {
  return { ...d, responses: d.responses.filter((r) => !variables.has(r.variable)) };
}
