import type { Sitting, SittingEvent } from "./types.js";
import { demoReleases } from "./node/synthetic.js";

/** Test helpers: hand-built sittings over the synthetic survey. */
export const releases = demoReleases().map((r) => r.index);
export const [v100, v110, v200] = releases as [typeof releases[0], typeof releases[0], typeof releases[0]];

export type Step =
  | ["p", string]
  | ["a", string, unknown]
  | ["skip", string]
  | ["decline", string]
  | ["fast", string]
  | ["end"];

export function sitting(steps: Step[], opts: Partial<Sitting> = {}): Sitting {
  const events: SittingEvent[] = [{ seq: 0, type: "session.started", tWall: "2026-09-01T09:00:00.000Z", tMono: 0 }];
  let complete = false;
  for (const s of steps) {
    const seq = events.length;
    const tWall = new Date(Date.UTC(2026, 8, 1, 9, 0, 0) + seq * 10_000).toISOString();
    const base = { seq, tWall, tMono: seq * 10_000 };
    switch (s[0]) {
      case "p":
        events.push({ ...base, type: "item.presented", itemKey: s[1] });
        break;
      case "a":
        events.push({ ...base, type: "response.recorded", itemKey: s[1], payload: { value: s[2] } });
        break;
      case "skip":
        events.push({ ...base, type: "item.skipped", itemKey: s[1] });
        break;
      case "decline":
        events.push({ ...base, type: "item.declined", itemKey: s[1] });
        break;
      case "fast":
        events.push({ ...base, type: "response.too_fast", itemKey: s[1] });
        break;
      case "end":
        complete = true;
        events.push({ ...base, type: "session.completed", payload: { totalMs: seq * 10_000, foregroundMs: seq * 9_000 } });
        break;
    }
  }
  return {
    sessionId: "01JTESTSESSION000000000001",
    study: "demo",
    studyCode: "NDC0001",
    releaseKey: v100.key,
    releaseHash: v100.hash,
    startedAt: "2026-09-01T09:00:00.000Z",
    complete,
    events,
    receivedAt: "2026-09-01T10:00:00.000Z",
    quarantined: false,
    provenance: "device",
    ...opts,
  };
}

/** Present-and-answer every step in `answers`. */
export const pa = (key: string, value: unknown): Step[] => [["p", key], ["a", key, value]];
export const choice = (code: number) => ({ kind: "choice", code });
export const num = (value: number) => ({ kind: "number", value });

/** A full, valid walk of v1.0.0 with a phone (so the social section applies). */
export function fullWalk(phone: 1 | 2 = 1): Step[] {
  return [
    ...pa("demo_consent.assent", { kind: "checkboxes", checked: ["understand", "voluntary"] }),
    ...pa("demo_about.first_name", { kind: "text", value: "Alex" }),
    ...pa("demo_about.age", num(12)),
    ...pa("demo_about.year_group", choice(8)),
    ...pa("demo_sleep.sleep_hours", num(8)),
    ...pa("demo_sleep.sleep_quality", choice(4)),
    ...pa("demo_phone.has_phone", choice(phone)),
    ...(phone === 1
      ? [
          ...pa("demo_social.platforms", { kind: "multi", codes: [1, 3] }),
          ...pa("demo_social.sm_hours", num(3)),
          ...pa("demo_social.sm_feel", choice(3)),
        ]
      : []),
    ...pa("demo_wellbeing.wb1", choice(3)),
    ...pa("demo_wellbeing.wb2", choice(3)),
    ...pa("demo_wellbeing.wb3", choice(4)),
    ...pa("demo_wellbeing.wb4", choice(2)),
    ...pa("demo_wellbeing.wb5", choice(5)),
    ...pa("demo_wellbeing.wb_extra", { kind: "text", value: "fine" }),
    ...pa("demo_gaming.plays_games", choice(3)),
    ...pa("demo_finish.ladder", num(6)),
    ...pa("demo_finish.future_message", { kind: "text", value: "hello" }),
  ];
}
