import { describe, expect, it } from "vitest";
import { applyReviewChange, emptyReview, ReviewError, validateNote } from "./review.js";

const actor = { uid: "u1", email: "r@example.org" };
const now = new Date("2026-09-28T12:00:00.000Z");
let n = 0;
const id = () => `f${++n}`;

describe("review changes", () => {
  it("adding a flag records who and why, and asks for review", () => {
    const { next, after } = applyReviewChange(emptyReview("s"), { kind: "add_flag", reason: "speeding", note: " too quick " }, actor, now, id);
    expect(next.flags[0]).toMatchObject({ reason: "speeding", note: "too quick", open: true, createdBy: "u1" });
    expect(next.status).toBe("needs_review");
    expect(next.rev).toBe(1);
    expect(next.updatedBy).toBe("u1");
    expect(after.flags).toHaveLength(1);
  });

  it("refuses unknown reasons and an unexplained 'other'", () => {
    expect(() => applyReviewChange(emptyReview("s"), { kind: "add_flag", reason: "because" as never }, actor, now, id)).toThrow(ReviewError);
    expect(() => applyReviewChange(emptyReview("s"), { kind: "add_flag", reason: "other" }, actor, now, id)).toThrow(/say what/);
  });

  it("resolves and reopens a flag, never one that does not exist", () => {
    const { next } = applyReviewChange(emptyReview("s"), { kind: "add_flag", reason: "duplicate" }, actor, now, id);
    const flagId = next.flags[0]!.id;
    const resolved = applyReviewChange(next, { kind: "resolve_flag", flagId }, actor, now, id).next;
    expect(resolved.flags[0]).toMatchObject({ open: false, resolvedBy: "u1" });
    expect(() => applyReviewChange(resolved, { kind: "resolve_flag", flagId }, actor, now, id)).toThrow(/already resolved/);
    expect(applyReviewChange(resolved, { kind: "reopen_flag", flagId }, actor, now, id).next.flags[0]!.open).toBe(true);
    expect(() => applyReviewChange(resolved, { kind: "resolve_flag", flagId: "nope" }, actor, now, id)).toThrow(/does not exist/);
  });

  it("marking reviewed stamps the reviewer", () => {
    const { next } = applyReviewChange(emptyReview("s"), { kind: "set_status", status: "reviewed" }, actor, now, id);
    expect(next.lastReviewedBy).toBe("u1");
    expect(next.lastReviewedAt).toBe(now.toISOString());
  });

  it("quality concerns are a known vocabulary", () => {
    expect(applyReviewChange(emptyReview("s"), { kind: "set_quality", concerns: ["timing", "low_effort", "timing"] }, actor, now, id).next.qualityConcerns).toEqual(["low_effort", "timing"]);
    expect(() => applyReviewChange(emptyReview("s"), { kind: "set_quality", concerns: ["vibes"] }, actor, now, id)).toThrow();
  });

  it("notes must be non-empty text within the limit", () => {
    expect(validateNote("  checked with site lead  ")).toBe("checked with site lead");
    expect(() => validateNote("   ")).toThrow();
    expect(() => validateNote("x".repeat(5000))).toThrow();
    expect(() => validateNote(42)).toThrow();
  });
});
