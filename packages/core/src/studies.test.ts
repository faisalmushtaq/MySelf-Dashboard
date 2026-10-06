import { describe, expect, it } from "vitest";
import {
  accessListProblem,
  decideStudyAccess,
  isPublicMailDomain,
  isStudyId,
  isSurveyId,
  participantLink,
  readAccessList,
  studioLink,
  studyStatus,
} from "./studies.js";

const list = (emails: string[], domains: string[] = []) => ({ emails, domains });

describe("who may see which study", () => {
  const base = { defaultStudy: "ybm", list: null };
  it("administrators see every study, listed or not", () => {
    expect(decideStudyAccess({ ...base, role: "owner", email: "a@brainpop.example", study: "future" })).toBe(true);
  });

  it("everyone the dashboard admits sees the default study: its list is the dashboard's own", () => {
    for (const role of ["researcher", "analyst"] as const) expect(decideStudyAccess({ ...base, role, email: "r@brainpop.example", study: "ybm" })).toBe(true);
  });

  it("anyone else sees another study only when its own list names them or their domain", () => {
    const r = { role: "researcher" as const, email: "R@Uni.example", study: "future", defaultStudy: "ybm" };
    expect(decideStudyAccess({ ...r, list: null })).toBe(false);
    expect(decideStudyAccess({ ...r, list: list([]) })).toBe(false);
    expect(decideStudyAccess({ ...r, list: list(["r@uni.example"]) })).toBe(true);
    expect(decideStudyAccess({ ...r, list: list([], ["uni.example"]) })).toBe(true);
    expect(decideStudyAccess({ ...r, list: list(["someone@uni.example"], ["other.example"]) })).toBe(false);
    // A list for one study says nothing about another.
    expect(decideStudyAccess({ ...r, study: "stage_two", list: null })).toBe(false);
  });
});

describe("access lists", () => {
  it("are tidied as they arrive", () => {
    expect(readAccessList({ emails: [" A@Uni.example ", "a@uni.example", 3, ""], domains: ["@Uni.Example", "uni.example"] })).toEqual({ emails: ["a@uni.example"], domains: ["uni.example"] });
    expect(readAccessList(null)).toEqual({ emails: [], domains: [] });
  });

  it("refuse a public mail service as a domain rule, but not an address there", () => {
    expect(isPublicMailDomain("Gmail.com")).toBe(true);
    expect(isPublicMailDomain("@outlook.com")).toBe(true);
    expect(isPublicMailDomain("leeds.ac.uk")).toBe(false);
    expect(accessListProblem(list([], ["gmail.com"]))).toMatch(/public mail service/);
    expect(accessListProblem(list([], ["icloud.com"]))).toMatch(/public mail service/);
    expect(accessListProblem(list(["someone@gmail.com"], ["leeds.ac.uk"]))).toBeNull();
  });

  it("refuse what is not an address or a domain, and lists too long to check", () => {
    expect(accessListProblem(list(["not-an-email"]))).toMatch(/not an email address/);
    expect(accessListProblem(list([], ["localhost"]))).toMatch(/not a domain/);
    expect(accessListProblem(list(Array.from({ length: 501 }, (_, i) => `p${i}@uni.example`)))).toMatch(/too long/);
  });
});

describe("ids, status and links, as the survey reads and builds them", () => {
  it("accepts only the survey's ids, untouched", () => {
    expect(isStudyId("ybm")).toBe(true);
    expect(isStudyId("future_2027")).toBe(true);
    for (const bad of ["y", "YBM", "ybm/x", "ybm.", "1ybm", " ybm", "ybm%2F", "a".repeat(41)]) expect(isStudyId(bad)).toBe(false);
    expect(isSurveyId("ybm_nd2026_standard")).toBe(true);
    for (const bad of ["", "Survey", "a/b", "a-b", "a".repeat(65)]) expect(isSurveyId(bad)).toBe(false);
  });

  it("reads a study's status failing closed", () => {
    expect(studyStatus("open")).toBe("open");
    for (const v of ["closed", "Open", "", null, undefined, 1]) expect(studyStatus(v)).toBe("closed");
  });

  it("builds the participant link exactly as the survey's §11.2 says: both parameters, always", () => {
    expect(participantLink("https://faisalmushtaq.github.io/MySelf/", { study: "ybm", surveyId: "ybm_nd2026_standard" })).toBe(
      "https://faisalmushtaq.github.io/MySelf/?study=ybm&survey=ybm_nd2026_standard",
    );
    expect(participantLink("https://faisalmushtaq.github.io/MySelf/?x=1#/old", { study: "future", surveyId: "future_v1" })).toBe(
      "https://faisalmushtaq.github.io/MySelf/?study=future&survey=future_v1",
    );
    expect(() => participantLink("https://faisalmushtaq.github.io/MySelf/", { study: "Bad", surveyId: "x" })).toThrow();
  });

  it("points Edit in Studio at the survey's versions, in its own study", () => {
    const studio = "https://faisalmushtaq.github.io/MySelf/researcher/#/surveys";
    // The default study's pages keep the addresses they had before study spaces.
    expect(studioLink(studio, { study: "ybm", surveyId: "ybm_nd2026_standard" }, "ybm")).toBe("https://faisalmushtaq.github.io/MySelf/researcher/#/surveys/ybm_nd2026_standard/versions");
    // Any other study's carry its prefix, as Studio's own router writes them.
    expect(studioLink(studio, { study: "future", surveyId: "future_v1" }, "ybm")).toBe("https://faisalmushtaq.github.io/MySelf/researcher/#/study/future/surveys/future_v1/versions");
    expect(studioLink(studio, null, "ybm")).toBe("https://faisalmushtaq.github.io/MySelf/researcher/#/surveys");
  });
});
