import { describe, expect, it } from "vitest";
import { dpaths } from "./paths.js";
import { sittingStudyProblem } from "./sittings.js";

// MYSELF_STUDY is "demo" in the unit-test environment (vitest.unit.config.ts).
describe("where each study's documents live (docs/12 §12.3)", () => {
  it("keeps the default study's settings where they always were, and gives any other study its own", () => {
    expect(dpaths.policyConfig("demo")).toBe("config/policy");
    expect(dpaths.groupsConfig("demo")).toBe("config/groups");
    expect(dpaths.policyConfig("future")).toBe("studies/future/config/policy");
    expect(dpaths.groupsConfig("future")).toBe("studies/future/config/groups");
    expect(dpaths.studyAccess("future")).toBe("studies/future/config/access");
  });

  it("files every study's records under its own id", () => {
    expect(dpaths.summary("demo", "s1")).toBe("studies/demo/sessionSummaries/s1");
    expect(dpaths.summary("future", "s1")).toBe("studies/future/sessionSummaries/s1");
    expect(dpaths.exportJob("future", "j1")).toBe("studies/future/exportJobs/j1");
    expect(dpaths.audit("future")).toBe("studies/future/auditLog");
  });
});

describe("a sitting's study", () => {
  it("is its path's: one that names another study is never read as either's", () => {
    expect(sittingStudyProblem("ybm", { study: "ybm" })).toBeNull();
    // Absent: the path decides, as for every sitting filed before the field existed.
    expect(sittingStudyProblem("ybm", {})).toBeNull();
    expect(sittingStudyProblem("ybm", { study: "future" })).toMatch(/another study/);
    expect(sittingStudyProblem("ybm", { study: 7 })).toMatch(/no study id/);
  });
});
