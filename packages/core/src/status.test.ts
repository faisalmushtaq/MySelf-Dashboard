import { describe, expect, it } from "vitest";
import { buildSummary } from "./summary.js";
import { DEFAULT_POLICY } from "./policy.js";
import { deriveStatus, matchesStatus } from "./status.js";
import { emptyReview, type ReviewDoc } from "./review.js";
import { choice, fullWalk, pa, sitting, v100, type Step } from "./testkit.test-util.js";

const now = new Date("2026-09-02T12:00:00.000Z");
const summarise = (steps: Step[], opts: Parameters<typeof sitting>[1] = {}) =>
  buildSummary(sitting(steps, opts), v100, DEFAULT_POLICY, { now }).summary;
const status = (steps: Step[], opts: Parameters<typeof sitting>[1] = {}, review?: ReviewDoc, when = now) =>
  deriveStatus(summarise(steps, opts), review, DEFAULT_POLICY, when);

describe("lifecycle", () => {
  it("complete: finished with nothing missing", () => {
    expect(status([...fullWalk(2), ["end"]]).lifecycle).toBe("complete");
  });

  it("incomplete: finished with a missing required answer", () => {
    const steps = fullWalk(2).filter((s) => s[1] !== "demo_sleep.sleep_quality");
    expect(status([...steps, ["p", "demo_sleep.sleep_quality"], ["skip", "demo_sleep.sleep_quality"], ["end"]]).lifecycle).toBe("incomplete");
  });

  it("not started: opened but nothing answered", () => {
    expect(status([["p", "demo_consent.assent"]]).lifecycle).toBe("not_started");
  });

  it("in progress within the abandonment window, abandoned after it — by the server's clock", () => {
    const partial: Step[] = [...pa("demo_consent.assent", { kind: "checkboxes", checked: ["understand"] })];
    const received = "2026-09-02T00:00:00.000Z";
    expect(status(partial, { receivedAt: received }, undefined, new Date("2026-09-02T12:00:00.000Z")).lifecycle).toBe("in_progress");
    expect(status(partial, { receivedAt: received }, undefined, new Date("2026-09-03T01:00:00.000Z")).lifecycle).toBe("abandoned");
  });

  it("a finished sitting with an unknown version is complete, with completeness unavailable", () => {
    const s = buildSummary(sitting([...fullWalk(2), ["end"]]), null, DEFAULT_POLICY, { now }).summary;
    expect(deriveStatus(s, null, DEFAULT_POLICY, now).lifecycle).toBe("complete");
    expect(s.requiredCompletion).toBeNull();
  });
});

describe("markers", () => {
  it("quarantined sittings are invalid, and invalid outranks everything", () => {
    const d = status([...fullWalk(2), ["end"]], { quarantined: true, studyCode: "TST0001" });
    expect(d.markers).toEqual(["invalid", "test"]);
    expect(d.display).toBe("invalid");
    expect(matchesStatus(d, "complete")).toBe(true);
  });

  it("test codes follow the policy's patterns", () => {
    expect(status([...fullWalk(2), ["end"]], { studyCode: "TST0042" }).markers).toContain("test");
    expect(status([...fullWalk(2), ["end"]], { studyCode: "ZZZ0042" }).markers).toContain("test");
    expect(status([...fullWalk(2), ["end"]], { studyCode: "NDC0042" }).markers).not.toContain("test");
  });

  it("a researcher can mark a sitting as test or invalid", () => {
    const review = { ...emptyReview("x"), markedTest: true, markedInvalid: true };
    expect(status([...fullWalk(2), ["end"]], {}, review).markers).toEqual(["invalid", "test"]);
  });

  it("an open flag means needs review until the sitting is reviewed", () => {
    const flagged: ReviewDoc = {
      ...emptyReview("x"),
      status: "in_review",
      flags: [{ id: "f", reason: "other", note: "x", open: true, createdBy: "u", createdByEmail: null, createdAt: "", resolvedAt: null, resolvedBy: null }],
    };
    expect(status([...fullWalk(2), ["end"]], {}, flagged).display).toBe("needs_review");
    expect(status([...fullWalk(2), ["end"]], {}, { ...flagged, status: "reviewed" }).markers).not.toContain("needs_review");
  });

  it("automatic signals ask for review only while the sitting is unreviewed", () => {
    const steps = fullWalk(2).filter((s) => s[1] !== "demo_sleep.sleep_quality");
    const invalid: Step[] = [...steps, ...pa("demo_sleep.sleep_quality", choice(42)), ["end"]];
    expect(status(invalid).markers).toContain("needs_review");
    expect(status(invalid, {}, { ...emptyReview("x"), status: "reviewed" }).markers).not.toContain("needs_review");
  });

  it("too-fast answering becomes a signal at the policy's threshold", () => {
    const fast: Step[] = [...fullWalk(2).flatMap((s) => (s[0] === "a" ? [s, ["fast", s[1]] as Step] : [s])), ["end"]];
    const d = status(fast);
    expect(d.signals).toContain("too_fast");
    expect(d.markers).toContain("needs_review");
  });
});
