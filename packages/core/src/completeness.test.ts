import { describe, expect, it } from "vitest";
import { assessSitting, nextMissingRequired } from "./completeness.js";
import { replaySitting } from "./replay.js";
import { choice, fullWalk, num, pa, sitting, v100, v200, type Step } from "./testkit.test-util.js";

const assess = (steps: Step[], release = v100, levels: ("hard" | "soft" | "optional")[] = ["hard", "soft"], complete?: boolean) => {
  const s = sitting(steps);
  if (complete !== undefined) s.complete = complete;
  return assessSitting(replaySitting(s), release, { requiredLevels: levels });
};
const outcome = (a: ReturnType<typeof assess>, key: string) => a.outcomes.find((o) => o.key === key)!.outcome;

describe("completeness@1", () => {
  it("a full sitting is 100% with nothing missing", () => {
    const a = assess([...fullWalk(1), ["end"]]);
    expect(a.terminal).toBe(true);
    expect(a.counts.requiredMissing).toBe(0);
    expect(a.requiredCompletion).toBe(1);
    expect(a.estimated).toBe(false);
  });

  it("does not count questions hidden by valid branching as incomplete", () => {
    // No phone: the whole social-media section is skipped by the survey's logic.
    const a = assess([...fullWalk(2), ["end"]]);
    expect(outcome(a, "demo_social.sm_feel")).toBe("hidden_branching");
    expect(a.counts.requiredMissing).toBe(0);
    expect(a.requiredCompletion).toBe(1);
    const social = a.sections.find((s) => s.key === "social_media")!;
    expect(social.applicable).toBe(false);
    expect(social.completion).toBeNull();
  });

  it("applies item-level conditions (game hours only for players)", () => {
    const player = assess([...fullWalk(2).filter((s) => s[1] !== "demo_gaming.plays_games"), ...pa("demo_gaming.plays_games", choice(1)), ["end"]]);
    expect(outcome(player, "demo_gaming.game_hours")).toBe("eligible_not_shown");
    const nonPlayer = assess([...fullWalk(2), ["end"]]);
    expect(outcome(nonPlayer, "demo_gaming.game_hours")).toBe("hidden_branching");
  });

  it("counts a skipped required question as missing and the sitting as having gaps", () => {
    const steps = fullWalk(2).filter((s) => s[1] !== "demo_sleep.sleep_quality");
    const a = assess([...steps, ["p", "demo_sleep.sleep_quality"], ["skip", "demo_sleep.sleep_quality"], ["end"]]);
    expect(outcome(a, "demo_sleep.sleep_quality")).toBe("skipped");
    expect(a.missingRequiredKeys).toEqual(["demo_sleep.sleep_quality"]);
    expect(a.requiredCompletion).toBeLessThan(1);
  });

  it("treats an explicit decline as a response, not a gap", () => {
    const steps = fullWalk(2).filter((s) => s[1] !== "demo_gaming.plays_games");
    const a = assess([...steps, ["p", "demo_gaming.plays_games"], ["decline", "demo_gaming.plays_games"], ["end"]]);
    expect(outcome(a, "demo_gaming.plays_games")).toBe("declined");
    expect(a.counts.requiredMissing).toBe(0);
  });

  it("marks an answer outside this version's options as invalid (and missing)", () => {
    const steps = fullWalk(2).filter((s) => s[1] !== "demo_sleep.sleep_quality");
    const a = assess([...steps, ...pa("demo_sleep.sleep_quality", choice(99)), ["end"]]);
    const o = a.outcomes.find((x) => x.key === "demo_sleep.sleep_quality")!;
    expect(o.outcome).toBe("invalid");
    expect(o.invalidReason).toMatch(/does not exist/);
    expect(a.invalidKeys).toEqual(["demo_sleep.sleep_quality"]);
    expect(a.missingRequiredKeys).toContain("demo_sleep.sleep_quality");
  });

  it("marks a response with no value as corrupted", () => {
    const steps = fullWalk(2).filter((s) => s[1] !== "demo_about.age");
    const a = assess([...steps, ["p", "demo_about.age"], ["a", "demo_about.age", null], ["end"]]);
    expect(a.outcomes.find((x) => x.key === "demo_about.age")!.invalidReason).toMatch(/corrupted/);
  });

  it("accepts a legitimately empty answer the definition allows", () => {
    const steps = fullWalk(1).filter((s) => s[1] !== "demo_social.platforms");
    const a = assess([...steps, ...pa("demo_social.platforms", { kind: "multi", codes: [] }), ["end"]]);
    const o = a.outcomes.find((x) => x.key === "demo_social.platforms")!;
    expect(o.outcome).toBe("answered");
    expect(o.emptyValue).toBe(true);
  });

  it("an unfinished sitting counts unreached required questions as missing", () => {
    const a = assess([...pa("demo_consent.assent", { kind: "checkboxes", checked: ["understand", "voluntary"] }), ...pa("demo_about.age", num(12))]);
    expect(a.terminal).toBe(false);
    expect(outcome(a, "demo_wellbeing.wb1")).toBe("not_reached");
    expect(a.counts.requiredMissing).toBeGreaterThan(5);
  });

  it("says eligibility is unknown when a condition reads a question never reached, and marks the result estimated", () => {
    const a = assess([...pa("demo_consent.assent", { kind: "checkboxes", checked: ["understand", "voluntary"] })]);
    // The social section depends on has_phone, which was never reached.
    expect(outcome(a, "demo_social.sm_feel")).toBe("undetermined");
    // platforms, sm_hours, sm_feel (section reads has_phone) and game_hours (reads plays_games)
    expect(a.counts.requiredUndetermined).toBe(4);
    expect(a.estimated).toBe(true);
    expect(a.estimateReasons).toContain("undetermined_eligibility");
  });

  it("uses three-valued logic: any(yes, unknown) is yes (v2 game hours)", () => {
    // In v2 game hours shows for plays_games 1 OR 2.
    const a = assessSittingV2([...pa("demo_gaming.plays_games", choice(2))]);
    expect(a.outcomes.find((o) => o.key === "demo_gaming.game_hours")!.outcome).toBe("not_reached");
  });

  it("distinguishes an eligible question never shown after a review edit", () => {
    // Said no phone, finished, then changed to yes from the review screen.
    const a = assess([...fullWalk(2), ["p", "demo_phone.has_phone"], ["a", "demo_phone.has_phone", choice(1)], ["end"]]);
    expect(outcome(a, "demo_social.sm_feel")).toBe("eligible_not_shown");
    expect(a.missingRequiredKeys).toEqual(expect.arrayContaining(["demo_social.sm_feel"]));
  });

  it("keeps but does not count an answer later hidden by a changed answer", () => {
    const a = assess([...fullWalk(1), ["p", "demo_phone.has_phone"], ["a", "demo_phone.has_phone", choice(2)], ["end"]]);
    expect(outcome(a, "demo_social.sm_feel")).toBe("answered_hidden");
    expect(a.counts.requiredMissing).toBe(0);
    expect(a.outcomes.find((o) => o.key === "demo_social.sm_feel")!.value).toEqual(choice(3));
  });

  it("records 'shown, no response' separately from not reached", () => {
    const a = assess([...pa("demo_consent.assent", { kind: "checkboxes", checked: ["understand", "voluntary"] }), ["p", "demo_about.first_name"], ["p", "demo_about.age"]]);
    expect(outcome(a, "demo_about.age")).toBe("no_response");
    expect(outcome(a, "demo_about.year_group")).toBe("not_reached");
  });

  it("infers 'shown' from responses in a legacy log, and says so", () => {
    const steps = fullWalk(2).filter((s) => s[0] !== "p");
    const a = assess([...steps, ["end"]]);
    expect(a.estimated).toBe(true);
    expect(a.estimateReasons).toContain("no_presentation_events");
    expect(a.counts.requiredMissing).toBe(0);
  });

  it("reports item ids the release does not define", () => {
    const a = assess([...fullWalk(2), ...pa("demo_about.shoe_size", num(5)), ["end"]]);
    expect(a.unknownItemKeys).toEqual(["demo_about.shoe_size"]);
  });

  it("is unavailable, not wrong, when the version is unknown", () => {
    const a = assessSitting(replaySitting(sitting([...fullWalk(2), ["end"]])), null, { requiredLevels: ["hard", "soft"] });
    expect(a.releaseKnown).toBe(false);
    expect(a.requiredCompletion).toBeNull();
    expect(a.outcomes).toEqual([]);
  });

  it("honours the policy's required levels", () => {
    const steps = fullWalk(2).filter((s) => s[1] !== "demo_sleep.sleep_quality");
    const skipped: Step[] = [...steps, ["p", "demo_sleep.sleep_quality"], ["skip", "demo_sleep.sleep_quality"], ["end"]];
    expect(assess(skipped, v100, ["hard", "soft"]).counts.requiredMissing).toBe(1);
    // Only hard-required: a soft skip is not a missing required answer.
    expect(assess(skipped, v100, ["hard"]).counts.requiredMissing).toBe(0);
  });

  it("finds the drop-off point and the section it was in", () => {
    const a = assess([...pa("demo_consent.assent", { kind: "checkboxes", checked: ["understand", "voluntary"] }), ...pa("demo_about.age", num(12)), ["p", "demo_sleep.sleep_hours"]]);
    expect(a.lastPresentedKey).toBe("demo_sleep.sleep_hours");
    expect(a.finalSectionKey).toBe("sleep");
  });

  it("steps to the next missing required answer, wrapping round", () => {
    const a = assess([...pa("demo_consent.assent", { kind: "checkboxes", checked: ["understand", "voluntary"] })]);
    const first = nextMissingRequired(a);
    expect(first).toBe(a.missingRequiredKeys[0]);
    expect(nextMissingRequired(a, first)).toBe(a.missingRequiredKeys[1]);
    expect(nextMissingRequired(a, a.missingRequiredKeys.at(-1))).toBe(a.missingRequiredKeys[0]);
  });
});

function assessSittingV2(steps: Step[]) {
  const s = sitting(steps, { releaseHash: v200.hash, releaseKey: v200.key });
  return assessSitting(replaySitting(s), v200, { requiredLevels: ["hard", "soft"] });
}
