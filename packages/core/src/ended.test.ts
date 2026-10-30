import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "./policy.js";
import { buildSummary, ENDED_REASON_LABELS, WARNING_LABELS } from "./summary.js";
import type { Sitting } from "./types.js";

const at = (s: number) => new Date(Date.UTC(2026, 10, 2, 10, 0, s)).toISOString();
const ev = (seq: number, type: string, payload?: Record<string, unknown>) => ({ eventId: `e${seq}`, sessionId: "s1", seq, type, ...(payload ? { payload } : {}), tWall: at(seq), tMono: seq * 1000 });

describe("a sitting a researcher ended on the iPad (survey D-70)", () => {
  it("is summarised with the reason, as a signal that names it, and nothing that asks for review", () => {
    const sitting = {
      sessionId: "s1",
      complete: true,
      startedAt: at(0),
      events: [ev(0, "session.started"), ev(1, "session.ended_by_staff", { reason: "time", answered: 12, total: 80 }), ev(2, "session.completed", { endedBy: "staff", reason: "time" })],
    } as unknown as Sitting;
    const { summary } = buildSummary(sitting, null, DEFAULT_POLICY, { now: new Date(at(60)) });
    expect(summary.endedByStaff).toEqual({ reason: "time", at: at(1) });
    expect(summary.warnings).toContain("ended_by_researcher_time");
    expect(WARNING_LABELS["ended_by_researcher_time"]).toBe("Ended by a researcher: time was up");
    expect(ENDED_REASON_LABELS["distress"]).toBe("The participant was upset or unwell");
  });

  it("is not claimed for a sitting that reached the end", () => {
    const sitting = { sessionId: "s2", complete: true, startedAt: at(0), events: [ev(0, "session.started"), ev(1, "session.completed")] } as unknown as Sitting;
    const { summary } = buildSummary(sitting, null, DEFAULT_POLICY, { now: new Date(at(60)) });
    expect(summary.endedByStaff).toBeNull();
    expect(summary.warnings.some((w) => w.startsWith("ended_by_researcher"))).toBe(false);
  });
});
