import { contentHash } from "./hash.js";
import { indexRelease, type QuestionDef, type ReleaseIndex } from "../manifest.js";
import type { SittingDoc, SittingEvent } from "../types.js";
import { AnswerStore, evaluate, type AnswerValue, type LogicExpr } from "../vendor/engine.js";

/**
 * SYNTHETIC data for development, tests and demonstrations.
 *
 * Nothing here is, or is derived from, participant data. The survey is a small
 * made-up wellbeing questionnaire in the same manifest format as the real YBM
 * releases, published in three versions that differ in exactly the ways the
 * dashboard must handle (reworded question, relabelled options, added option
 * codes, changed branching, added and removed questions). The sittings are
 * generated from a seeded PRNG so every run — and every test — sees the same data.
 */

export const DEMO_STUDY = "demo";

type Json = Record<string, unknown>;

const text = (t: string) => ({ text: t });
const ref = (instrument: string, item: string) => ({ instrument, item, revision: 1 });
const sel = (instrument: string, item: string, code: number): LogicExpr => ({ op: "selected", target: { item: ref(instrument, item) }, code });

function scale(key: string, options: [number, string, string?][]): Json {
  return {
    key,
    version: "1.0.0",
    name: key,
    direction: "ascending",
    options: options.map(([code, label, kind]) => ({ code, label, kind: kind ?? "substantive", textEntry: false })),
  };
}

function item(key: string, variable: string, responseType: string, stem: string, extra: Json = {}): Json {
  return {
    key,
    revision: 1,
    variable,
    responseType,
    stem: text(stem),
    required: "soft",
    allowDecline: false,
    identifying: false,
    ...extra,
  };
}

function instrument(key: string, items: Json[], instructions?: string): Json {
  return {
    instrument: key,
    version: "1.0",
    name: key,
    construct: "synthetic demonstration",
    licence: { status: "open", modifiable: "yes", verified: true },
    forms: [{ language: "en-GB", readingLevel: "standard", informant: "self", label: key, ...(instructions ? { instructions } : {}), items, presentationFidelity: "stepped_allowed" }],
    timeEstimates: [{ ageBand: "11-13", medianSeconds: 60, provenance: "estimated-heuristic" }],
    changelog: "synthetic",
    approvalStatus: "approved",
    owner: "dashboard-dev",
  };
}

const refKey = (key: string) => `${key}@1.0/en-GB/self/standard`;
const component = (key: string, displayIf?: LogicExpr) => ({
  kind: "instrument",
  ref: { instrument: key, version: "1.0", language: "en-GB", informant: "self", readingLevel: "standard" },
  ...(displayIf ? { displayIf } : {}),
});

/** The survey's standard measures in the demo: its item keys, placeholder wording, answered by `standardAnswer`. */
const STANDARD_ITEMS = {
  swemwbs: ["optimistic", "useful", "relaxed", "problems", "thinking", "close", "mind"],
  sdq25_s: Array.from({ length: 25 }, (_, i) => `q${i + 1}`),
  kss: ["q1"],
  ehi_sf: ["writing", "throwing", "toothbrush", "spoon"],
} as const;
const STANDARD = new Set(Object.keys(STANDARD_ITEMS));

function standardItem(key: string, variable: string, stem: string, scaleKey: string): Json {
  return item(key, variable, "single_choice", stem, { required: "optional", scale: scaleKey, scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true });
}

export type DemoVersion = "1.0.0" | "1.1.0" | "2.0.0";

/** Build one version of the synthetic survey as a release manifest (with hash). */
export function demoManifest(version: DemoVersion): Json {
  const v11 = version !== "1.0.0";
  const v2 = version === "2.0.0";

  const scales: Json = {
    "scale.yes_no": scale("scale.yes_no", [[1, "Yes"], [2, "No"]]),
    "scale.year_group": scale("scale.year_group", [[7, "Year 7"], [8, "Year 8"], [9, "Year 9"], [10, "Year 10"], [11, "Year 11"]]),
    "scale.quality5": scale("scale.quality5", [[1, "Very badly"], [2, "Badly"], [3, "OK"], [4, "Well"], [5, "Very well"]]),
    "scale.freq5": scale("scale.freq5", [[1, "None of the time"], [2, v11 ? "Not often" : "Rarely"], [3, "Some of the time"], [4, "Often"], [5, "All of the time"]]),
    "scale.platforms": scale("scale.platforms", [[1, "Video app"], [2, "Photo app"], [3, "Messaging app"], [4, "Forum"], [5, "Other"]]),
    "scale.feel": scale(
      "scale.feel",
      v2
        ? [[1, "Much worse"], [2, "A bit worse"], [3, "No different"], [4, "A bit better"], [5, "Much better"], [6, "I don't really use it", "not_applicable"]]
        : [[1, "Much worse"], [2, "A bit worse"], [3, "No different"], [4, "A bit better"], [5, "Much better"]],
    ),
    "scale.games": scale("scale.games", [[1, "Yes, most days"], [2, "Sometimes"], [3, "No"]]),
    "scale.travel": scale("scale.travel", [[1, "Walk"], [2, "Bike"], [3, "Bus"], [4, "Car"], [5, "Other"]]),
    // The survey's standard measures, with its real item keys and codes (item wording is placeholder).
    "scale.swemwbs_5pt": scale("scale.swemwbs_5pt", [[1, "None of the time"], [2, "Rarely"], [3, "Some of the time"], [4, "Often"], [5, "All of the time"]]),
    "scale.sdq_3pt": scale("scale.sdq_3pt", [[0, "Not True"], [1, "Somewhat True"], [2, "Certainly True"]]),
    "scale.kss_9pt": scale("scale.kss_9pt", Array.from({ length: 9 }, (_, i) => [i + 1, `Level ${i + 1}`] as [number, string])),
    "scale.ehi_sf_5pt": scale("scale.ehi_sf_5pt", [[1, "Always right"], [2, "Usually right"], [3, "Both equally"], [4, "Usually left"], [5, "Always left"]]),
    "scale.month": scale("scale.month", ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => [i + 1, m] as [number, string])),
  };

  const instruments: Json = {
    [refKey("demo_consent")]: instrument("demo_consent", [
      item("assent", "assent", "checkbox_set", "Before we start, please tick each statement you agree with.", {
        required: "hard",
        statements: [
          { key: "understand", text: text("I understand what this survey is about."), required: true },
          { key: "voluntary", text: text("I know I can stop at any time."), required: true },
        ],
      }),
    ]),
    [refKey("demo_about")]: instrument("demo_about", [
      item("first_name", "first_name", "text_short", "What is your first name?", { identifying: true, maxChars: 40, minChars: 0 }),
      item("age", "age_years", "numeric", "How old are you?", { min: 10, max: 19, integerOnly: true, required: "hard" }),
      item("year_group", "year_group", "single_choice", "Which year are you in at school?", { scale: "scale.year_group", scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true }),
      ...(v2 ? [item("school_travel", "school_travel", "single_choice", "How do you usually get to school?", { scale: "scale.travel", scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true })] : []),
    ]),
    // The survey's secret code, with the item keys its ingest derives the
    // participant code from (MySelf packages/store/src/ingest.ts). Identifying:
    // the dashboard never shows or aggregates these answers.
    [refKey("ybm_identity")]: instrument("ybm_identity", [
      item("ps_mother_initials", "ps_mother_initials", "text_short", "The first two letters of your mum's (or carer's) first name", { identifying: true, required: "optional", maxChars: 2, minChars: 0 }),
      item("ps_house_digit", "ps_house_digit", "text_short", "The first number of your house", { identifying: true, required: "optional", maxChars: 1, minChars: 0 }),
      item("ps_birth_month", "ps_birth_month", "single_choice", "The month you were born", { identifying: true, required: "optional", scale: "scale.month", scaleVersion: "1.0.0", presentation: "list", spectrumReverse: false, autoAdvance: true }),
      item("ps_postcode_letters", "ps_postcode_letters", "text_short", "The last two letters of your postcode", { identifying: true, required: "optional", maxChars: 2, minChars: 0 }),
    ]),
    [refKey("demo_sleep")]: instrument("demo_sleep", [
      item("sleep_hours", "sleep_hours", "numeric", "About how many hours did you sleep last night?", { min: 0, max: 14, integerOnly: true }),
      item(
        "sleep_quality",
        "sleep_quality",
        "single_choice",
        v11 ? "How well have you slept this week?" : "How well did you sleep last night?",
        { scale: "scale.quality5", scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true },
      ),
    ]),
    [refKey("demo_phone")]: instrument("demo_phone", [
      item("has_phone", "has_phone", "single_choice", "Do you have your own mobile phone?", {
        required: "hard",
        allowDecline: v2,
        scale: "scale.yes_no",
        scaleVersion: "1.0.0",
        presentation: "cards",
        spectrumReverse: false,
        autoAdvance: true,
      }),
    ]),
    [refKey("demo_social")]: instrument("demo_social", [
      item("platforms", "sm_platforms", "multi_choice", "Which of these do you use?", { scale: "scale.platforms", scaleVersion: "1.0.0", minSelections: 0 }),
      item("sm_hours", "sm_hours", "slider", "On a school day, how many hours do you spend on social media?", { min: 0, max: 12, step: 1, showValue: true }),
      item("sm_feel", "sm_feel", "single_choice", "After using social media, how do you usually feel?", { scale: "scale.feel", scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true }),
    ], "These questions are about social media."),
    [refKey("demo_wellbeing")]: instrument(
      "demo_wellbeing",
      [
        item("wb1", "wb_optimistic", "single_choice", "I've been feeling optimistic about the future.", { scale: "scale.freq5", scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true }),
        item("wb2", "wb_useful", "single_choice", "I've been feeling useful.", { scale: "scale.freq5", scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true }),
        item("wb3", "wb_relaxed", "single_choice", "I've been feeling relaxed.", { scale: "scale.freq5", scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true }),
        item("wb4", "wb_problems", "single_choice", "I've been dealing with problems well.", { scale: "scale.freq5", scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true }),
        item("wb5", "wb_close", "single_choice", "I've been feeling close to other people.", { scale: "scale.freq5", scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true }),
        ...(v11 ? [item("wb6", "wb_mind", "single_choice", "I've been able to make up my own mind about things.", { scale: "scale.freq5", scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true })] : []),
        ...(!v2 ? [item("wb_extra", "wb_extra", "text_short", "Is there anything else about how you've been feeling?", { required: "optional", maxChars: 200, minChars: 0 })] : []),
      ],
      "For each statement, choose the answer that best describes your experience over the last two weeks.",
    ),
    [refKey("demo_gaming")]: instrument("demo_gaming", [
      item("plays_games", "plays_games", "single_choice", "Do you play video games?", { allowDecline: true, scale: "scale.games", scaleVersion: "1.0.0", presentation: "cards", spectrumReverse: false, autoAdvance: true }),
      item("game_hours", "game_hours", "numeric", "About how many hours a week do you play?", {
        min: 0,
        max: 60,
        integerOnly: true,
        displayIf: v2
          ? { op: "any", args: [sel("demo_gaming", "plays_games", 1), sel("demo_gaming", "plays_games", 2)] }
          : sel("demo_gaming", "plays_games", 1),
      }),
    ]),
    [refKey("swemwbs")]: instrument("swemwbs", STANDARD_ITEMS.swemwbs.map((k, i) => standardItem(k, `swemwbs_q${i + 1}`, `Wellbeing statement ${i + 1} (synthetic wording)`, "scale.swemwbs_5pt"))),
    [refKey("sdq25_s")]: instrument("sdq25_s", STANDARD_ITEMS.sdq25_s.map((k, i) => standardItem(k, `sdq25_q${i + 1}`, `Strengths and difficulties statement ${i + 1} (synthetic wording)`, "scale.sdq_3pt"))),
    [refKey("kss")]: instrument("kss", [standardItem("q1", "kss_q1", "How sleepy are you feeling right now? (synthetic wording)", "scale.kss_9pt")]),
    [refKey("ehi_sf")]: instrument("ehi_sf", STANDARD_ITEMS.ehi_sf.map((k) => standardItem(k, `ehi_${k}`, `Which hand do you use: ${k}? (synthetic wording)`, "scale.ehi_sf_5pt"))),
    [refKey("demo_finish")]: instrument("demo_finish", [
      item("ladder", "status_ladder", "ladder", "Where would you put yourself on this ladder?", { rungs: 10, lowestValue: 1 }),
      item("future_message", "future_message", "text_long", "If you could send a message to yourself in five years, what would it say?", { required: "optional", maxChars: 2000, minChars: 0 }),
    ]),
  };

  const sections = [
    { key: "welcome", title: "Welcome", components: [component("demo_consent")] },
    { key: "about_you", title: "About you", components: [component("demo_about"), component("ybm_identity")] },
    { key: "sleep", title: "Sleep", components: [component("demo_sleep")] },
    { key: "phones", title: "Phones", components: [component("demo_phone")] },
    { key: "social_media", title: "Your social media", displayIf: sel("demo_phone", "has_phone", 1), components: [component("demo_social")] },
    { key: "wellbeing", title: "How you've been feeling", components: [component("demo_wellbeing")] },
    { key: "gaming", title: "Gaming", components: [component("demo_gaming")] },
    { key: "finish", title: "Finishing up", components: [component("demo_finish")] },
    // Last, and optional, so the completeness picture of the demo is unchanged by them.
    { key: "measures", title: "Standard measures", components: [component("swemwbs"), component("sdq25_s"), component("kss"), component("ehi_sf")] },
  ].map((s) => ({ ...s, randomiseComponents: false }));

  const published: Record<DemoVersion, string> = {
    "1.0.0": "2026-06-01T09:00:00.000Z",
    "1.1.0": "2026-07-06T09:00:00.000Z",
    "2.0.0": "2026-08-24T09:00:00.000Z",
  };

  const body: Json = {
    manifestVersion: 1,
    release: {
      key: `demo_wellbeing_r${version.replaceAll(".", "_")}`,
      version,
      assessment: "demo_wellbeing",
      study: DEMO_STUDY,
      publishedAt: published[version],
      publishedBy: "synthetic",
      engineVersion: "0.1.0",
    },
    composition: {
      key: "demo_wellbeing",
      study: DEMO_STUDY,
      title: "MySelf demonstration wellbeing survey (synthetic)",
      language: "en-GB",
      readingLevel: "standard",
      ageBand: "11-13",
      allowBackNavigation: true,
      resumption: "resume_same_device",
      progressIndicator: "sections",
      participantCode: { pattern: "^[A-Za-z]{3}[0-9]{4}$", hint: "Three letters then four numbers", label: "Your study code", variable: "val_id" },
      offline: { surveyOfflineCapable: true },
      sections,
      screens: {},
    },
    instruments,
    scales,
    scoring: {},
    narrativeProtocols: {},
    prompts: {},
    modelConfigs: {},
    assets: {},
  };
  return { ...body, hash: contentHash(body) };
}

export const DEMO_VERSIONS: DemoVersion[] = ["1.0.0", "1.1.0", "2.0.0"];

export function demoReleases(): { manifest: Json; index: ReleaseIndex }[] {
  return DEMO_VERSIONS.map((v) => {
    const manifest = demoManifest(v);
    return { manifest, index: indexRelease(manifest) };
  });
}

// ── Sittings ────────────────────────────────────────────────────────────────

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID from a timestamp and the seeded PRNG, the id shape the survey uses. */
export function ulid(ms: number, rnd: () => number): string {
  let time = "";
  let t = ms;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  let random = "";
  for (let i = 0; i < 16; i += 1) random += CROCKFORD[Math.floor(rnd() * 32)]!;
  return time + random;
}

/** Mulberry32: tiny, seeded, good enough for synthetic data. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Scenario =
  | "complete"
  | "complete_no_phone"
  | "incomplete_skips"
  | "abandoned"
  | "in_progress"
  | "not_started"
  | "invalid_answer"
  | "declined"
  | "test"
  | "quarantined"
  | "review_edit"
  | "legacy_no_presented"
  | "unknown_release"
  | "clock_ahead"
  | "speeder"
  | "free_text_injection";

export interface DemoSitting {
  doc: SittingDoc;
  scenario: Scenario;
}

interface WalkOptions {
  stopAfter?: number;
  skipRate?: number;
  forcePhone?: 1 | 2;
  invalid?: boolean;
  decline?: boolean;
  noPresented?: boolean;
  tooFast?: boolean;
  textOverride?: string;
  /** The synthetic child answering: their secret-code components and first name. */
  child?: Child;
  /** Drives the standard measures: a wellbeing trait (SD units), a handedness draw, and their own random stream. */
  standard?: { trait: number; hand: number; rnd: () => number; site: string };
}

/** A synthetic child. Returning children and twins reuse the same components. */
export interface Child {
  initials: string;
  digit: string;
  month: number;
  postcode: string;
  firstName: string;
  /** Leaves the postcode letters unanswered, so no participant code can be derived. */
  incomplete?: boolean;
}

function answerFor(q: QuestionDef, rnd: () => number, opts: WalkOptions): AnswerValue {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  switch (q.responseType) {
    case "single_choice": {
      if (q.key === "demo_phone.has_phone" && opts.forcePhone) return { kind: "choice", code: opts.forcePhone };
      const codes = (q.options ?? []).map((o) => o.code);
      return { kind: "choice", code: pick(codes) };
    }
    case "multi_choice": {
      const codes = (q.options ?? []).map((o) => o.code).filter(() => rnd() < 0.45);
      return { kind: "multi", codes };
    }
    case "numeric": {
      const min = (q.constraints["min"] as number) ?? 0;
      const max = (q.constraints["max"] as number) ?? 10;
      return { kind: "number", value: Math.round(min + rnd() * Math.min(max - min, 12)) };
    }
    case "slider":
      return { kind: "number", value: Math.round(rnd() * 8) };
    case "ladder":
      return { kind: "number", value: 1 + Math.floor(rnd() * 10) };
    case "checkbox_set":
      return { kind: "checkboxes", checked: ["understand", "voluntary"] };
    case "text_short":
      return { kind: "text", value: q.identifying ? pick(["Alex", "Sam", "Jordan", "Riley", "Casey", "Morgan"]) : pick(["Fine", "A bit tired", "Busy week"]) };
    case "text_long":
      return {
        kind: "text",
        value:
          opts.textOverride ??
          pick(["Keep going, it gets better.", "Remember to be kind to yourself.", "I hope you still like football.", "Don't stress about exams."]),
      };
    default:
      return { kind: "text", value: "?" };
  }
}

/** Differences between the demo schools, in SD units of wellbeing, so benchmarking has something to show. */
const SCHOOL_EFFECT: Record<string, number> = { NDC: 0.35, LDS: 0, BRD: -0.3, TST: 0 };

function standardAnswer(q: QuestionDef, s: NonNullable<WalkOptions["standard"]>, yearGroup: number): number {
  const noise = () => {
    // Box–Muller: a standard normal from two uniforms.
    const u = Math.max(1e-9, s.rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * s.rnd());
  };
  const z = s.trait + (SCHOOL_EFFECT[s.site] ?? 0) - 0.12 * (yearGroup - 7);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
  if (q.instrument === "swemwbs") return clamp(3.3 + 0.75 * z + 0.6 * noise(), 1, 5);
  if (q.instrument === "kss") return clamp(4.2 - 0.6 * z + 1.4 * noise(), 1, 9);
  if (q.instrument === "ehi_sf") {
    if (s.hand < 0.1) return clamp(4.7 + 0.4 * noise(), 4, 5);
    if (s.hand < 0.13) return clamp(3 + noise(), 2, 4);
    return clamp(1.2 + 0.4 * noise(), 1, 2);
  }
  // SDQ: problem items rise as wellbeing falls; positively worded ones (7, 11, 14, 21, 25) the other way.
  const n = Number(q.item.slice(1));
  if ([1, 4, 9, 17, 20].includes(n)) return clamp(1.5 + 0.2 * z + 0.5 * noise(), 0, 2);
  if ([7, 11, 14, 21, 25].includes(n)) return clamp(1.45 + 0.35 * z + 0.55 * noise(), 0, 2);
  return clamp(0.55 - 0.45 * z + 0.55 * noise(), 0, 2);
}

/**
 * Walk the synthetic survey as a participant would: in order, only questions
 * whose display condition holds, recording the events the real app records.
 */
function walk(release: ReleaseIndex, start: number, rnd: () => number, opts: WalkOptions) {
  const events: SittingEvent[] = [];
  const store = new AnswerStore();
  let seq = 0;
  let t = start;
  let mono = 0;
  const push = (type: string, itemKey?: string, payload?: Record<string, unknown>) => {
    events.push({ seq: seq++, type, ...(itemKey ? { itemKey } : {}), ...(payload ? { payload } : {}), tWall: new Date(t).toISOString(), tMono: mono });
  };
  const tick = (ms: number) => {
    t += ms;
    mono += ms;
  };

  push("session.started", undefined, { releaseHash: release.hash });
  let asked = 0;
  let stopped = false;
  let invalidDone = false;
  let declineDone = false;
  for (const q of release.questions) {
    if (q.displayIf && !evaluate(q.displayIf, store)) continue;
    if (opts.stopAfter !== undefined && asked >= opts.stopAfter) {
      stopped = true;
      break;
    }
    if (q.key.startsWith("ybm_identity.")) {
      // Answered from the child, with fixed timing and no random draws, so the
      // rest of the synthetic study is unchanged by their presence.
      const child = opts.child;
      const [instrument = "", itemKey = ""] = q.key.split(".");
      tick(8000);
      if (!opts.noPresented) push("item.presented", q.key, { visit: 1, returning: false });
      if (!child || (child.incomplete && itemKey === "ps_postcode_letters")) {
        push("item.skipped", q.key);
        store.set(ref(instrument, itemKey), { status: "skipped" });
      } else {
        const value: AnswerValue =
          itemKey === "ps_birth_month"
            ? { kind: "choice", code: child.month }
            : { kind: "text", value: itemKey === "ps_mother_initials" ? child.initials : itemKey === "ps_house_digit" ? child.digit : child.postcode };
        push("response.recorded", q.key, { value, timing: { tooFast: false } });
        store.set(ref(instrument, itemKey), { status: "answered", value });
      }
      tick(300);
      push("item.left", q.key, { totalDwellMs: 3000, visit: 1 });
      continue;
    }
    if (STANDARD.has(q.instrument)) {
      // Answered from the child's traits on a stream of their own, so the rest
      // of the synthetic study is unchanged by these questions.
      if (!opts.standard) continue;
      const yearCode = (store.get(ref("demo_about", "year_group"))?.value as { code?: number } | undefined)?.code ?? 7;
      const value: AnswerValue = { kind: "choice", code: standardAnswer(q, opts.standard, yearCode) };
      tick(6000);
      if (!opts.noPresented) push("item.presented", q.key, { visit: 1, returning: false });
      push("response.recorded", q.key, { value, timing: { tooFast: false } });
      store.set(ref(q.instrument, q.item), { status: "answered", value });
      tick(300);
      push("item.left", q.key, { totalDwellMs: 3000, visit: 1 });
      continue;
    }
    asked += 1;
    tick(opts.tooFast ? 700 : 12000 + Math.floor(rnd() * 40000));
    if (!opts.noPresented) push("item.presented", q.key, { visit: 1, returning: false });
    const [instrument = "", itemKey = ""] = q.key.split(".");
    const skippable = q.required !== "hard";
    if (opts.decline && !declineDone && q.allowDecline) {
      declineDone = true;
      push("item.declined", q.key);
      store.set(ref(instrument, itemKey), { status: "declined" });
    } else if (skippable && rnd() < (opts.skipRate ?? 0.02)) {
      push("skip.confirmed", q.key);
      push("item.skipped", q.key);
      store.set(ref(instrument, itemKey), { status: "skipped" });
    } else {
      let value = answerFor(q, rnd, opts);
      if (q.key === "demo_about.first_name" && opts.child) value = { kind: "text", value: opts.child.firstName };
      if (opts.invalid && !invalidDone && q.responseType === "single_choice" && q.key !== "demo_phone.has_phone") {
        value = { kind: "choice", code: 99 };
        invalidDone = true;
      }
      push("response.recorded", q.key, { value, timing: { tooFast: opts.tooFast === true } });
      if (opts.tooFast) push("response.too_fast", q.key, { sinceShownMs: 700, thresholdMs: 1500 });
      store.set(ref(instrument, itemKey), { status: "answered", value });
    }
    tick(300);
    push("item.left", q.key, { totalDwellMs: 3000, visit: 1 });
  }
  return { events, stopped, end: t, mono, store };
}

export interface GenerateOptions {
  count?: number;
  seed?: number;
  /** "Now" for the generated study: in-progress sittings are recent relative to it. */
  now?: Date;
  study?: string;
}

/**
 * A synthetic study: at least 30 sittings (default 64) across three versions and
 * four months, covering every state the dashboard distinguishes.
 */
export function generateDemoSittings(options: GenerateOptions = {}): DemoSitting[] {
  const count = Math.max(30, options.count ?? 64);
  const rnd = prng(options.seed ?? 20260928);
  const now = options.now ?? new Date("2026-09-28T12:00:00.000Z");
  const study = options.study ?? DEMO_STUDY;
  const releases = demoReleases().map((r) => r.index);
  const periodStart = Date.parse("2026-06-02T08:00:00.000Z");
  const periodEnd = now.getTime() - 2 * 3_600_000;

  // Fixed scenarios first so every case exists whatever the count, then a
  // realistic mix for the rest.
  const fixed: Scenario[] = [
    "complete_no_phone", "incomplete_skips", "abandoned", "in_progress", "not_started", "invalid_answer",
    "declined", "test", "test", "quarantined", "review_edit", "legacy_no_presented", "unknown_release",
    "clock_ahead", "speeder", "free_text_injection", "abandoned", "incomplete_skips", "in_progress",
  ];
  const mix: [Scenario, number][] = [
    ["complete", 0.55], ["complete_no_phone", 0.12], ["incomplete_skips", 0.12], ["abandoned", 0.12], ["not_started", 0.03], ["speeder", 0.03], ["declined", 0.03],
  ];
  const scenarios: Scenario[] = [...fixed];
  while (scenarios.length < count) {
    let x = rnd();
    let chosen: Scenario = "complete";
    for (const [s, p] of mix) {
      if (x < p) {
        chosen = s;
        break;
      }
      x -= p;
    }
    scenarios.push(chosen);
  }

  const sites = ["NDC", "LDS", "BRD"];
  const out: DemoSitting[] = [];
  // Who each sitting is. Most children take part once; every sixth sitting from
  // the 24th is a child returning for a second wave; one pair are twins (same
  // secret code, different names — the collision the survey's ingest reports);
  // and one child leaves their code incomplete, so their sitting is held back.
  const idRnd = prng(((options.seed ?? 20260928) ^ 0x5eed) >>> 0);
  const letters = "ABCDEFGHJKLMNPRSTUVWY";
  const two = () => letters[Math.floor(idRnd() * letters.length)]! + letters[Math.floor(idRnd() * letters.length)]!;
  const names = ["Alex", "Sam", "Jordan", "Riley", "Casey", "Morgan", "Taylor", "Jamie", "Robin", "Charlie"];
  const children: Child[] = [];
  // The twin's sibling: the last child to finish a sitting, and when they sat.
  let lastComplete: { child: Child; start: number; release: ReleaseIndex } | null = null;
  const TWIN = 31;
  const childFor = (i: number): Child => {
    if (i >= 24 && i % 6 === 0 && children.length > 4) return children[(i * 7) % Math.min(children.length, 20)]!;
    if (i === TWIN && lastComplete) {
      const sibling = lastComplete.child;
      return { ...sibling, firstName: names.find((n) => n !== sibling.firstName)! };
    }
    const child: Child = { initials: two(), digit: String(1 + Math.floor(idRnd() * 9)), month: 1 + Math.floor(idRnd() * 12), postcode: two(), firstName: names[Math.floor(idRnd() * names.length)]! };
    if (i === 20) child.incomplete = true;
    children.push(child);
    return child;
  };
  // Traits for the standard measures, on their own stream (see standardAnswer); a returning child keeps theirs.
  const traitRnd = prng(((options.seed ?? 20260928) ^ 0x7a17) >>> 0);
  const traits = new Map<Child, { trait: number; hand: number }>();
  scenarios.forEach((scenario, i) => {
    // Spread start times over the period, oldest first; in-progress ones are recent.
    let start =
      scenario === "in_progress"
        ? now.getTime() - (2 + Math.floor(rnd() * 6)) * 3_600_000
        : periodStart + Math.floor(((i * 7919) % count) / count * (periodEnd - periodStart - 3 * 86_400_000));
    // School hours, London.
    const d = new Date(start);
    d.setUTCHours(8 + Math.floor(rnd() * 6), Math.floor(rnd() * 60), 0, 0);
    start = scenario === "in_progress" ? start : d.getTime();

    // Twins sit together: same school visit, twenty minutes apart, same version.
    if (i === TWIN && lastComplete) start = lastComplete.start + 20 * 60_000;
    const release = i === TWIN && lastComplete ? lastComplete.release : [...releases].reverse().find((r) => Date.parse(r.publishedAt) <= start) ?? releases[0]!;
    const site = sites[i % sites.length]!;
    const code = scenario === "test" ? `TST${String(1 + i).padStart(4, "0")}` : `${site}${String(1000 + i).padStart(4, "0")}`;
    const sessionId = ulid(start, rnd);

    if (i === TWIN) scenario = "complete";
    const opts: WalkOptions = { child: childFor(i) };
    const u1 = Math.max(1e-9, traitRnd());
    const drawn = { trait: Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * traitRnd()), hand: traitRnd() };
    const traitOf = opts.child ? (traits.get(opts.child) ?? drawn) : drawn;
    if (opts.child && !traits.has(opts.child)) traits.set(opts.child, traitOf);
    opts.standard = { ...traitOf, site: code.slice(0, 3), rnd: prng(((options.seed ?? 20260928) ^ ((i + 1) * 0x9e3779b1)) >>> 0) };
    let terminal = true;
    switch (scenario) {
      case "complete":
        opts.skipRate = 0;
        break;
      case "complete_no_phone":
        opts.forcePhone = 2;
        opts.skipRate = 0;
        break;
      case "incomplete_skips":
        opts.skipRate = 0.25;
        break;
      case "abandoned":
        opts.stopAfter = 3 + Math.floor(rnd() * 12);
        terminal = false;
        break;
      case "in_progress":
        opts.stopAfter = 4 + Math.floor(rnd() * 8);
        terminal = false;
        break;
      case "not_started":
        opts.stopAfter = 0;
        terminal = false;
        break;
      case "invalid_answer":
        opts.invalid = true;
        opts.skipRate = 0;
        break;
      case "declined":
        opts.decline = true;
        opts.skipRate = 0;
        break;
      case "legacy_no_presented":
        opts.noPresented = true;
        opts.skipRate = 0;
        break;
      case "speeder":
        opts.tooFast = true;
        opts.skipRate = 0;
        break;
      case "free_text_injection":
        opts.skipRate = 0;
        opts.textOverride = '=HYPERLINK("http://example.invalid","click")';
        break;
      case "review_edit":
        opts.forcePhone = 2;
        opts.skipRate = 0;
        break;
      default:
        opts.skipRate = 0.02;
    }

    const w = walk(release, start, rnd, opts);
    if (scenario === "complete" && opts.child && !opts.child.incomplete) lastComplete = { child: opts.child, start, release };
    const events = w.events;
    let t = w.end;
    let mono = w.mono;
    const push = (type: string, itemKey?: string, payload?: Record<string, unknown>) => {
      t += 1500;
      mono += 1500;
      events.push({ seq: events.length, type, ...(itemKey ? { itemKey } : {}), ...(payload ? { payload } : {}), tWall: new Date(t).toISOString(), tMono: mono });
    };
    if (scenario === "review_edit") {
      // Changed "has phone" from the review screen after finishing: the social
      // media section becomes eligible but was never shown (audit F12).
      push("review.opened", undefined, { from: "finish" });
      push("item.presented", "demo_phone.has_phone", { visit: 2, returning: true });
      push("response.changed", "demo_phone.has_phone", { value: { kind: "choice", code: 1 } });
      push("review.edited", "demo_phone.has_phone");
    }
    if (terminal) push("session.completed", undefined, { totalMs: mono, foregroundMs: Math.round(mono * 0.95) });

    const completedAt = terminal ? new Date(t).toISOString() : undefined;
    let receivedAt =
      scenario === "in_progress"
        ? new Date(Math.min(now.getTime() - 60_000, t + 60_000)).toISOString()
        : new Date(t + (5 + Math.floor(rnd() * 240)) * 60_000).toISOString();
    let startedAt = new Date(start).toISOString();
    if (scenario === "clock_ahead") {
      // Device clock three hours fast: the sitting appears to start after the
      // server received it.
      receivedAt = new Date(start - 3 * 3_600_000 + 20 * 60_000).toISOString();
      startedAt = new Date(start).toISOString();
    }

    const doc: SittingDoc = {
      sessionId,
      deviceId: `inst_syn_${(i % 5) + 1}`,
      study,
      studyCode: code,
      releaseKey: release.key,
      releaseHash: scenario === "unknown_release" ? "sha256:" + "0".repeat(63) + "1" : release.hash,
      startedAt,
      ...(completedAt ? { completedAt } : {}),
      complete: terminal,
      events,
      chunkCount: 0,
      eventCount: events.length,
      receivedAt,
      quarantined: scenario === "quarantined",
      provenance: i % 9 === 4 ? "imported" : "device",
    };
    out.push({ doc, scenario });
  });
  return out.sort((a, b) => (a.doc.startedAt ?? "").localeCompare(b.doc.startedAt ?? ""));
}
