import { releaseManifest, type ReleaseManifest } from "../vendor/myself/schema/index.js";
import { ingest, type DeviceSession } from "../vendor/myself/store/ingest.js";
import { emptyDataset, type Dataset, type ParticipantRow } from "../vendor/myself/store/dataset.js";
import type { Sitting } from "../types.js";

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
  }
  return { dataset, excluded, collisions, warnings };
}

/**
 * The dataset restricted to some sittings. Wave numbers stay as derived from
 * the whole study — a filtered export may hold a child's wave 2 without their
 * wave 1, and that is the truth — while each participant's summary row is
 * recomputed from the sittings actually included.
 */
export function subsetDataset(d: Dataset, sessionIds: ReadonlySet<string>): Dataset {
  const sessions = d.sessions.filter((s) => sessionIds.has(s.sessionId));
  const byParticipant = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = byParticipant.get(s.participantId);
    if (list) list.push(s);
    else byParticipant.set(s.participantId, [s]);
  }
  const participants: ParticipantRow[] = d.participants
    .filter((p) => byParticipant.has(p.participantId))
    .map((p) => {
      const mine = [...byParticipant.get(p.participantId)!].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      return {
        ...p,
        sessionCount: mine.length,
        firstSeen: mine[0]!.startedAt,
        lastSeen: mine[mine.length - 1]!.startedAt,
        sites: [...new Set(mine.map((s) => s.site).filter((x): x is string => !!x))],
      };
    });
  return {
    generatedAt: d.generatedAt,
    releaseHashes: [...new Set(sessions.map((s) => s.releaseHash))],
    participants,
    sessions,
    responses: d.responses.filter((r) => sessionIds.has(r.sessionId)),
    scores: d.scores.filter((r) => sessionIds.has(r.sessionId)),
  };
}

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
