import { describe, expect, it } from "vitest";
// The offline demo's made-up study: every state a sitting can be in, a test sitting, and
// the three sittings the real survey app recorded (fixtures/r9-scenarios.json).
// It imports the built core, so core must be built first, as for every suite here.
import { generateYbmStudy } from "../../../../scripts/demo/ybm-study.mjs";
import type { Analytics } from "../analytics.js";
import { computeAnalytics } from "../analytics.js";
import type { ResearcherViewResponse } from "../api.js";
import { resolveRange } from "../dates.js";
import { DEFAULT_FILTERS, makePredicate, type Dataset as DatasetFilter } from "../filters.js";
import { indexRelease } from "../manifest.js";
import { DEFAULT_POLICY } from "../policy.js";
import { buildRows } from "../query.js";
import { buildSummary } from "../summary.js";
import type { Sitting, SittingEvent } from "../types.js";
import type { ReleaseManifest } from "../vendor/myself/schema/index.js";
import { countSittings, DEFAULT_COUNTING_RULES, type CountResult } from "../vendor/myself/store/counting.js";
import { emptyDataset, type Dataset } from "../vendor/myself/store/dataset.js";
import { ingest, type DeviceSession } from "../vendor/myself/store/ingest.js";
import { deriveStudyDataset, parseSurveyManifest } from "./dataset.js";
import { researcherViewFigures } from "./researcherView.js";

/**
 * The survey's researcher view and this dashboard, fed the same sittings, must show the
 * same number under every label they share.
 *
 * They used not to. The researcher view said 93.8% "completed" where the dashboard said
 * 85.7% "complete", for one study: one meant "reached the end screen" and the other
 * "reached it with every required question answered", over different denominators, and
 * each left out sittings the other counted. The rules now live in the survey
 * (`packages/store/src/counting.ts`, vendored here), and this test holds both tools to
 * them from end to end.
 *
 * DOWN THE RESEARCHER VIEW'S ROAD, as apps/researcher does it: the pull leaves out
 * quarantined and unreadable sittings and counts them (`assemblePull`), `buildDataset`
 * ingests the rest release by release, oldest first, and `countStudy` counts them —
 * all with the survey's own code, vendored.
 *
 * DOWN THE DASHBOARD'S ROAD: a summary per sitting as the trigger writes it, statuses,
 * the Overview's filters and `computeAnalytics`; and the researcher view's figures as
 * the Overview shows them beside its own (`getResearcherView`).
 */

const now = new Date("2026-09-30T08:00:00.000Z");
const timeZone = "Europe/London";
const policy = DEFAULT_POLICY;

const { sittings: generated, releases: raws } = generateYbmStudy({ now }) as { sittings: Sitting[]; releases: unknown[] };
const indexes = new Map(raws.map((raw) => [indexRelease(raw).hash, indexRelease(raw)]));
const manifests = new Map<string, ReleaseManifest>();
for (const raw of raws) {
  const parsed = parseSurveyManifest(raw);
  if ("manifest" in parsed) manifests.set(parsed.manifest.hash!, parsed.manifest);
}

/** The same sitting under a new id, so an extra case never collides with the original. */
const copy = (s: Sitting, id: string, change: Partial<Sitting> = {}): Sitting => ({ ...structuredClone(s), sessionId: id, ...change });
const withoutIdentity = (events: SittingEvent[]) => events.filter((e) => !e.itemKey?.startsWith("ybm_identity."));
const lifecycleOf = (s: Sitting) => (s.complete ? "finished" : "unfinished");
const finished = generated.filter((s) => s.complete && !s.studyCode?.startsWith("TST") && !s.studyCode?.startsWith("SCN"));
const unfinished = generated.filter((s) => lifecycleOf(s) === "unfinished");

/** Every rule exercised: sittings nobody can be linked to, quarantined and unreadable ones, a second test code. */
const extras: Sitting[] = [
  // Reached the end without giving a name or date of birth.
  copy(finished[0]!, "ses_extra_no_name_finished", { events: withoutIdentity(finished[0]!.events) }),
  // Stopped part way, with no name or date of birth.
  copy(unfinished[0]!, "ses_extra_no_name_stopped", { events: withoutIdentity(unfinished[0]!.events) }),
  // Opened, and nothing answered: not started, and not linkable.
  copy(finished[1]!, "ses_extra_not_started", {
    events: finished[1]!.events.filter((e) => e.type === "session.started" || e.type === "item.presented").slice(0, 2),
    complete: false,
    completedAt: undefined,
  }),
  // Two copies of one sitting that contradict each other: quarantined by the survey.
  copy(finished[2]!, "ses_extra_quarantined_a", { quarantined: true }),
  copy(finished[3]!, "ses_extra_quarantined_b", { quarantined: true, complete: false }),
  // A spilled log with a chunk missing, as the dashboard's reader hands it over.
  copy(finished[4]!, "ses_extra_unreadable", { unreadable: true, events: [], chunkCount: 3 }),
  // A second test pattern.
  copy(finished[5]!, "ses_extra_zzz", { studyCode: "zzz0001" }),
];
const study: Sitting[] = [...generated, ...extras];

// ── The researcher view's road ─────────────────────────────────────────────

type Pulled = DeviceSession & { receivedAt?: string };

/** `assemblePull` (apps/researcher/src/lib/study.ts): quarantined and unreadable sittings are left out and counted. */
function pull(sittings: readonly Sitting[]) {
  const sessions: Pulled[] = [];
  let quarantined = 0;
  const unreadable: string[] = [];
  for (const s of sittings) {
    if (s.quarantined) quarantined += 1;
    else if (s.unreadable) unreadable.push(s.sessionId);
    else
      sessions.push({
        sessionId: s.sessionId,
        studyCode: s.studyCode ?? "",
        releaseKey: s.releaseKey ?? "",
        releaseHash: s.releaseHash ?? "",
        startedAt: s.startedAt!,
        ...(s.completedAt ? { completedAt: s.completedAt } : {}),
        complete: s.complete === true,
        events: s.events,
        ...(s.receivedAt ? { receivedAt: s.receivedAt } : {}),
      });
  }
  return { sessions, quarantined, unreadable };
}

/** `buildDataset` (apps/researcher/src/lib/build.ts): ingest release by release, oldest first, each pass carrying the last. */
function buildDataset(sessions: readonly Pulled[]): Dataset {
  const groups = new Map<string, Pulled[]>();
  for (const s of sessions) groups.set(s.releaseHash, [...(groups.get(s.releaseHash) ?? []), s]);
  const first = (rows: Pulled[]) => rows.reduce((m, r) => (r.startedAt < m ? r.startedAt : m), rows[0]!.startedAt);
  let dataset = emptyDataset();
  for (const [hash, group] of [...groups.entries()].sort((a, b) => first(a[1]).localeCompare(first(b[1])))) {
    const manifest = manifests.get(hash)!;
    dataset = ingest([...group].sort((a, b) => a.startedAt.localeCompare(b.startedAt)), { manifest, study: "ybm", existing: dataset }).dataset;
  }
  return dataset;
}

function researcherView(includeTest: boolean) {
  const pulled = pull(study);
  const dataset = buildDataset(pulled.sessions);
  // `countStudy` (build.ts): the survey's counting rules, with the dashboard's defaults.
  const counted = countSittings({ sittings: pulled.sessions, dataset, manifests, rules: DEFAULT_COUNTING_RULES, includeTest, now });
  return { counted, quarantined: pulled.quarantined, unreadable: pulled.unreadable.length };
}

// ── The dashboard's road ───────────────────────────────────────────────────

const summaries = study.map((s) => buildSummary(s, indexes.get(s.releaseHash ?? "") ?? null, policy, { now }).summary);
const rows = buildRows(summaries, new Map(), policy, now);
const linked = deriveStudyDataset({ study: "ybm", sittings: study, manifests });

function dashboard(dataset: DatasetFilter) {
  const filters = { ...DEFAULT_FILTERS, dataset };
  const ctx = { now, timeZone };
  const inFilters = rows.filter(makePredicate(filters, ctx));
  const analytics = computeAnalytics(inFilters, { ...ctx, range: resolveRange("all", {}, now, timeZone), releases: [...indexes.values()] });
  return { analytics, panel: researcherViewFigures(linked, inFilters, now) };
}

/** Every figure shown under a label both tools use: [researcher view, dashboard Overview, the Overview's researcher-view panel]. */
function sharedLabels(r: ReturnType<typeof researcherView>, a: Analytics, v: ResearcherViewResponse): Record<string, number[]> {
  const f = r.counted.figures;
  const m = a.metrics;
  return {
    Sittings: [f.sittings, m.started, v.figures.sittings],
    "not linked to a participant": [f.notLinked, v.figures.notLinked],
    Participants: [f.participants, v.figures.participants],
    "Followed up": [f.followedUp, v.figures.followedUp],
    "up to wave": [f.maxWave, v.figures.maxWave],
    "Reached the end": [f.reachedEnd, m.reachedEnd, v.figures.reachedEnd],
    "All required answered": [f.allRequiredAnswered, m.allRequiredAnswered, v.figures.allRequiredAnswered],
    "finished or abandoned sittings": [f.finishedOrAbandoned, m.completionRateDenominator, v.figures.finishedOrAbandoned],
    "All required answered (rate)": [f.allRequiredAnswered / f.finishedOrAbandoned, m.completionRate!, v.figures.allRequiredAnswered / v.figures.finishedOrAbandoned],
    Incomplete: [f.byLifecycle.incomplete, m.incomplete, v.figures.byLifecycle.incomplete],
    Abandoned: [f.byLifecycle.abandoned, m.abandoned, v.figures.byLifecycle.abandoned],
    "In progress": [f.byLifecycle.in_progress, m.inProgress, v.figures.byLifecycle.in_progress],
    "Not started": [f.byLifecycle.not_started, m.notStarted, v.figures.byLifecycle.not_started],
    "Median length": [f.durationMinutes.median!, v.figures.durationMinutes.median!],
    "Median length (sittings timed)": [f.durationMinutes.n, v.figures.durationMinutes.n],
    Skipped: [f.skipRate, v.figures.skipRate],
    "Skipped (questions answered, skipped or declined)": [f.answered + f.skipped, v.figures.answered + v.figures.skipped],
    "Answered very fast": [f.tooFastRate, v.figures.tooFastRate],
    "quarantined, left out": [r.quarantined, m.quarantined, v.quarantined],
    "unreadable, left out": [r.unreadable, m.unreadable, v.unreadable],
  };
}

describe("the researcher view and the dashboard count the same study the same way", () => {
  for (const [dataset, includeTest] of [["production", false], ["all", true]] as const) {
    describe(includeTest ? "test sittings included (Production and test)" : "test sittings left out (the default in both)", () => {
      const r = researcherView(includeTest);
      const { analytics, panel } = dashboard(dataset);
      const shared = sharedLabels(r, analytics, panel);

      for (const [label, values] of Object.entries(shared)) {
        it(`shows one number as "${label}"`, () => {
          expect(new Set(values).size, `${label}: ${values.join(" / ")}`).toBe(1);
        });
      }

      it("agrees on every headline figure, not only the ones on screen", () => {
        expect(panel.figures).toEqual(r.counted.figures);
      });

      it("agrees sitting by sitting on where each one stands", () => {
        const inFilters = rows.filter(makePredicate({ ...DEFAULT_FILTERS, dataset }, { now, timeZone })).filter((x) => !x.summary.quarantined && !x.summary.unreadable);
        expect(new Map(inFilters.map((x) => [x.summary.sessionId, x.status.lifecycle]))).toEqual(r.counted.lifecycles);
      });
    });
  }

  it("was given a study that exercises every rule", () => {
    const r = researcherView(false);
    const f = r.counted.figures;
    expect(r.counted.test.count).toBe(2); // TST… from the demo, and zzz… added here
    expect(f.notLinked).toBe(3);
    expect(r.quarantined).toBe(2);
    expect(r.unreadable).toBe(1);
    for (const lifecycle of ["complete", "incomplete", "abandoned", "in_progress", "not_started"] as const) {
      expect(f.byLifecycle[lifecycle], lifecycle).toBeGreaterThan(0);
    }
    expect(f.followedUp).toBeGreaterThan(0);
    // The real survey app's own recorded sittings are in it, not only generated ones.
    expect(study.filter((s) => s.studyCode?.startsWith("SCN")).map((s) => s.studyCode).sort()).toEqual(["SCN0001", "SCN0002", "SCN0003"]);
    for (const s of study.filter((x) => x.studyCode?.startsWith("SCN"))) expect(r.counted.lifecycles.has(s.sessionId)).toBe(true);
  });

  it("tells the two completion measures apart, which is what the old labels hid", () => {
    const f = researcherView(false).counted.figures;
    expect(f.reachedEnd).toBeGreaterThan(f.allRequiredAnswered);
    expect(f.reachedEnd - f.allRequiredAnswered).toBe(f.byLifecycle.incomplete);
  });
});
