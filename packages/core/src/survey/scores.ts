import type { ReleaseIndex } from "../manifest.js";
import { applyScheme, type SchemeScores } from "../scoring/engine.js";
import { yearGroupFromAnswer, yearGroupFromCode, type GroupSettings, type YearGroupSource } from "../scoring/groups.js";
import type { ScoringScheme } from "../scoring/scheme.js";
import type { StudyDataset } from "./dataset.js";

/**
 * Every linked sitting, scored with the study's schemes and placed in its
 * school and year group. Server-only: it reads the response rows. What leaves
 * the server is built from these by the aggregates in scoring/aggregate.ts.
 */

export interface ScoredSession {
  sessionId: string;
  participantId: string;
  wave: number;
  startedAt: string;
  releaseHash: string;
  studyCode: string | null;
  school: string | null;
  yearGroup: number | null;
  yearGroupSource: YearGroupSource | null;
  gender: string | null;
  /** By scheme key; only schemes whose instrument the sitting's version administers. */
  scores: Record<string, SchemeScores>;
}

export function scoreStudy(
  study: StudyDataset,
  input: { schemes: readonly ScoringScheme[]; releases: ReadonlyMap<string, ReleaseIndex>; groups: GroupSettings },
): ScoredSession[] {
  const bySession = new Map<string, StudyDataset["dataset"]["responses"]>();
  for (const r of study.dataset.responses) {
    const list = bySession.get(r.sessionId);
    if (list) list.push(r);
    else bySession.set(r.sessionId, [r]);
  }

  return study.dataset.sessions.map((s) => {
    const release = input.releases.get(s.releaseHash);
    const responses = bySession.get(s.sessionId) ?? [];
    const values = new Map<string, number | null>();
    const byVariable = new Map(responses.map((r) => [r.variable, r]));
    for (const r of responses) {
      let v = r.status === "answered" && typeof r.value === "number" ? r.value : null;
      // "Prefer not to say", "don't know" and the like are answers, but not scores.
      const option = v !== null ? release?.byKey.get(`${r.instrument}.${r.item}`)?.options?.find((o) => o.code === v) : undefined;
      if (option && option.kind !== "substantive") v = null;
      values.set(`${r.instrument}.${r.item}`, v);
    }

    const scores: Record<string, SchemeScores> = {};
    const administered = new Set(release?.questions.map((q) => q.instrument) ?? []);
    for (const scheme of input.schemes) {
      if (!administered.has(scheme.instrument)) continue;
      const prefix = `${scheme.instrument}.`;
      const answers: Record<string, number | null> = {};
      for (const [k, v] of values) if (k.startsWith(prefix)) answers[k.slice(prefix.length)] = v;
      scores[scheme.key] = applyScheme(scheme, answers);
    }

    let yearGroup: number | null = null;
    let yearGroupSource: YearGroupSource | null = null;
    for (const source of input.groups.yearGroup.order) {
      const y =
        source === "studyCode"
          ? yearGroupFromCode(s.studyCode, input.groups.yearGroup.rules)
          : source === "item"
            ? (() => {
                const r = byVariable.get(input.groups.yearGroup.itemVariable);
                return r && r.status === "answered" ? yearGroupFromAnswer(r.label, r.value) : null;
              })()
            : (study.schoolYearFromDob[s.sessionId] ?? null);
      if (y !== null) {
        yearGroup = y;
        yearGroupSource = source;
        break;
      }
    }
    const gender = byVariable.get("gender");
    const genderOption = gender?.value !== null && gender?.value !== undefined ? release?.byKey.get(`${gender.instrument}.${gender.item}`)?.options?.find((o) => o.code === gender.value) : undefined;

    return {
      sessionId: s.sessionId,
      participantId: s.participantId,
      wave: s.wave,
      startedAt: s.startedAt,
      releaseHash: s.releaseHash,
      studyCode: s.studyCode ?? null,
      school: s.site ?? null,
      yearGroup,
      yearGroupSource,
      gender: gender?.status === "answered" && genderOption?.kind === "substantive" ? (gender.label ?? null) : null,
      scores,
    };
  });
}
