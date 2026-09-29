import type { HeldBackSittingView, ParticipantAttention, ParticipantSittingView, ParticipantsResponse, ParticipantView } from "../api.js";
import type { DisplayStatus } from "../status.js";
import type { StudyDataset } from "./dataset.js";

/**
 * The Participants page: the study as the survey links it — one row per
 * participant code with its sittings in wave order — plus everything the
 * linkage could not settle: sittings held back, codes two children share, and
 * sittings so close together they may be a restart or a duplicate.
 *
 * Nothing here repairs a link. Corrections and twin assignments are made in
 * the survey's researcher tool (Linkage tab), where the names are; this page
 * says what needs doing and shows the result once it is done.
 */

const DAY_MS = 86_400_000;

export interface SittingFacts {
  status: DisplayStatus;
  releaseVersion: string | null;
  site: string | null;
  startedAt: string | null;
}

export function participantsOverview(
  study: StudyDataset,
  facts: (sessionId: string) => SittingFacts | undefined,
  options: { codesShown: boolean; now: Date },
): ParticipantsResponse {
  const { dataset } = study;
  const bySession = new Map(dataset.sessions.map((s) => [s.sessionId, s]));
  const shared = new Set(study.collisions.map((c) => c.participantId));

  // Labels for roles that may not see codes: in order of first appearance, as the de-identified export numbers them.
  const order = [...dataset.participants].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen) || a.participantId.localeCompare(b.participantId));
  const labels = new Map(order.map((p, i) => [p.participantId, `P${String(i + 1).padStart(4, "0")}`]));
  const show = (code: string) => (options.codesShown ? code : (labels.get(code) ?? "P????"));

  const grouped = new Map<string, typeof dataset.sessions>();
  for (const s of dataset.sessions) {
    const list = grouped.get(s.participantId);
    if (list) list.push(s);
    else grouped.set(s.participantId, [s]);
  }

  let sameDay = 0;
  const participants: ParticipantView[] = order.map((p) => {
    const mine = [...(grouped.get(p.participantId) ?? [])].sort((a, b) => a.wave - b.wave || a.startedAt.localeCompare(b.startedAt));
    const sittings: ParticipantSittingView[] = mine.map((s, i) => {
      const f = facts(s.sessionId);
      const prev = mine[i - 1];
      return {
        sessionId: s.sessionId,
        wave: s.wave,
        startedAt: s.startedAt,
        finished: s.complete,
        status: f?.status ?? null,
        releaseVersion: f?.releaseVersion ?? null,
        site: s.site ?? f?.site ?? null,
        informant: s.informant && s.informant !== "self" ? s.informant : null,
        daysSincePrevious: prev ? Math.round((Date.parse(s.startedAt) - Date.parse(prev.startedAt)) / DAY_MS) : null,
      };
    });
    const attention: ParticipantAttention[] = [];
    if (shared.has(p.participantId)) attention.push("shared_code");
    // Two sittings by the same respondent within a day: a restart or a duplicate, rarely a real new wave.
    const selfReports = mine.filter((s) => !s.informant || s.informant === "self");
    if (selfReports.some((s, i) => i > 0 && Date.parse(s.startedAt) - Date.parse(selfReports[i - 1]!.startedAt) < DAY_MS)) {
      attention.push("same_day");
      sameDay += 1;
    }
    if (!mine.some((s) => s.complete)) attention.push("never_finished");
    return {
      code: show(p.participantId),
      sittings,
      waves: new Set(mine.map((s) => s.wave)).size,
      firstSeen: p.firstSeen,
      lastSeen: p.lastSeen,
      sites: [...p.sites].sort(),
      attention,
    };
  });

  const heldBack: HeldBackSittingView[] = study.excluded
    .map((e) => {
      const f = facts(e.sessionId);
      return { sessionId: e.sessionId, reason: e.reason, startedAt: f?.startedAt ?? null, status: f?.status ?? null, site: f?.site ?? null };
    })
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

  const waveCounts = new Map<number, number>();
  for (const p of participants) waveCounts.set(p.waves, (waveCounts.get(p.waves) ?? 0) + 1);

  return {
    computedAt: options.now.toISOString(),
    codesShown: options.codesShown,
    totals: {
      participants: participants.length,
      linkedSittings: bySession.size,
      heldBack: heldBack.length,
      multiWave: participants.filter((p) => p.waves > 1).length,
      byWave: [...waveCounts.entries()].sort((a, b) => a[0] - b[0]).map(([waves, n]) => ({ waves, participants: n })),
      sharedCodes: study.collisions.length,
      sameDay,
    },
    participants,
    heldBack,
    sharedCodes: study.collisions.map((c) => ({ code: show(c.participantId), sessionIds: c.sessionIds })),
  };
}
