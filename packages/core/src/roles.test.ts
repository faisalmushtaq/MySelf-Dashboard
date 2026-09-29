import { describe, expect, it } from "vitest";
import { can, CAPABILITIES, emailAllowed, maskStudyCode } from "./roles.js";

describe("role matrix", () => {
  it("administrators can do everything", () => {
    for (const c of CAPABILITIES) expect(can("owner", c)).toBe(true);
  });

  it("researchers review and export, but do not administer", () => {
    expect(can("researcher", "review.write")).toBe(true);
    expect(can("researcher", "export.sessions")).toBe(true);
    expect(can("researcher", "settings.access")).toBe(false);
    expect(can("researcher", "export.json")).toBe(false);
    expect(can("researcher", "audit.readAll")).toBe(false);
  });

  it("read-only reviewers view, but cannot change or export sensitive data", () => {
    expect(can("analyst", "view.dashboard")).toBe(true);
    expect(can("analyst", "review.write")).toBe(false);
    expect(can("analyst", "export.sessions")).toBe(false);
    expect(can("analyst", "export.aggregate")).toBe(true);
    expect(can("analyst", "view.studyCode")).toBe(false);
    expect(can("analyst", "view.participantCode")).toBe(false);
    expect(can("researcher", "view.participantCode")).toBe(true);
    expect(can("analyst", "views.share")).toBe(false);
  });

  it("free text for reviewers is a policy switch", () => {
    expect(can("analyst", "view.freeText")).toBe(false);
    expect(can("analyst", "view.freeText", { reviewerCanViewFreeText: true })).toBe(true);
  });

  it("no role, or an unknown one, can do nothing", () => {
    for (const c of CAPABILITIES) {
      expect(can(null, c)).toBe(false);
      expect(can("superuser" as never, c)).toBe(false);
    }
  });
});

describe("access policy", () => {
  const access = { emails: ["BrainPOPResearch@gmail.com"], domains: ["brainpop.example"] };
  it("allows the listed account, case-insensitively", () => {
    expect(emailAllowed("brainpopresearch@gmail.com", access)).toBe(true);
  });
  it("allows a Workspace domain", () => {
    expect(emailAllowed("someone@brainpop.example", access)).toBe(true);
  });
  it("refuses everyone else, and look-alikes", () => {
    expect(emailAllowed("brainpopresearch@gmail.com.evil.org", access)).toBe(false);
    expect(emailAllowed("x@notbrainpop.example", access)).toBe(false);
    expect(emailAllowed("brainpop.example", access)).toBe(false);
    expect(emailAllowed(null, access)).toBe(false);
  });
});

it("masks study codes to the site and last two digits", () => {
  expect(maskStudyCode("NDC0042")).toBe("NDC••42");
  expect(maskStudyCode("AB1")).toBe("•••");
  expect(maskStudyCode(null)).toBeNull();
});
