import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  livePeriods,
  manifestFacts,
  myStoryOf,
  provenanceCsv,
  sittingsByRelease,
  versionHistory,
  type StudioSurveyRecord,
  type StudioVersionRecord,
} from "./versions.js";

const ybm = (v: string) =>
  JSON.parse(readFileSync(new URL(`../test-fixtures/ybm/ybm_nd2026_standard_r${v}.manifest.json`, import.meta.url), "utf8")) as {
    composition: { sections: { key: string; title: string; components: Record<string, unknown>[] }[] };
  } & Record<string, unknown>;

const H = (n: number) => `sha256:${String(n).repeat(64).slice(0, 64)}`;

const record = (version: string, hash: string, more: Partial<StudioVersionRecord> = {}): StudioVersionRecord => ({
  surveyId: "ybm_nd2026_standard",
  version,
  hash,
  releaseKey: `ybm_nd2026_standard_r${version.replaceAll(".", "_")}`,
  engineVersion: "0.3.0",
  source: "studio",
  releaseNote: null,
  changes: [],
  bump: null,
  basedOn: null,
  authors: [],
  publishedBy: null,
  publishedAt: null,
  ...more,
});

describe("reading MyStory from a manifest", () => {
  it("finds MyStory only as the final section's narrative component", () => {
    const m = ybm("7.1.0");
    expect(myStoryOf(m)).toBeNull();
    const withMyStory = structuredClone(m);
    withMyStory.composition.sections.push({ key: "mystory", title: "MyStory", components: [{ kind: "narrative", protocol: "np.phone_wellbeing", protocolVersion: "0.1.1" }] });
    expect(myStoryOf(withMyStory)).toEqual({ protocol: "np.phone_wellbeing", protocolVersion: "0.1.1" });
    expect(manifestFacts(withMyStory)).toEqual({ engineVersion: "0.1.0", myStory: { protocol: "np.phone_wellbeing", protocolVersion: "0.1.1" } });
    // Not last: not "ends with MyStory".
    const notLast = structuredClone(withMyStory);
    notLast.composition.sections.push(notLast.composition.sections[0]!);
    expect(myStoryOf(notLast)).toBeNull();
    expect(myStoryOf({ not: "a manifest" })).toBeNull();
  });
});

describe("when each version was live", () => {
  it("follows the set-up, each publish and each make-live-again, each until the next", () => {
    const periods = livePeriods(
      [
        { at: "2026-09-22T09:00:00.000Z", how: "published", version: "10.0.0", hash: H(3), reason: null },
        { at: "2026-09-01T09:00:00.000Z", how: "set_up", version: "8.0.0", hash: null, reason: null },
        { at: "2026-09-04T09:00:00.000Z", how: "published", version: "9.0.0", hash: H(2), reason: null },
        { at: "2026-09-23T09:00:00.000Z", how: "made_live_again", version: "9.0.0", hash: H(2), reason: "Wrong consent text" },
      ],
      { hash: H(2), version: "9.0.0", releaseKey: "k", generation: 4, publishedAt: "2026-09-04T09:00:00.000Z" },
      (v) => (v === "8.0.0" ? H(1) : null),
    );
    expect(periods.get(H(1))).toEqual([{ from: "2026-09-01T09:00:00.000Z", to: "2026-09-04T09:00:00.000Z", how: "set_up", reason: null }]);
    expect(periods.get(H(2))).toEqual([
      { from: "2026-09-04T09:00:00.000Z", to: "2026-09-22T09:00:00.000Z", how: "published", reason: null },
      { from: "2026-09-23T09:00:00.000Z", to: null, how: "made_live_again", reason: "Wrong consent text" },
    ]);
    expect(periods.get(H(3))).toEqual([{ from: "2026-09-22T09:00:00.000Z", to: "2026-09-23T09:00:00.000Z", how: "published", reason: null }]);
  });

  it("falls back on the live pointer when there is no trail", () => {
    const periods = livePeriods([], { hash: H(1), version: "8.0.0", releaseKey: "k", generation: 1, publishedAt: "2026-06-01T00:00:00.000Z" }, () => null);
    expect(periods.get(H(1))).toEqual([{ from: "2026-06-01T00:00:00.000Z", to: null, how: "pointer", reason: null }]);
    expect(livePeriods([], null, () => null).size).toBe(0);
  });
});

describe("the version history", () => {
  const studio: StudioSurveyRecord = {
    surveyId: "ybm_nd2026_standard",
    title: "Your Brain Matters",
    pointer: { hash: H(2), version: "9.0.0", releaseKey: "ybm_nd2026_standard_r9_0_0", generation: 2, publishedAt: "2026-09-04T09:00:00.000Z" },
    versions: [
      record("8.0.0", H(1), { source: "repository", releaseNote: "Published from the repository before MySelf Studio", publishedBy: "repository" }),
      record("9.0.0", H(2), { releaseNote: "Shorter sleep section", changes: ["Question ybm_sleep.bedtime changed (wording)"], bump: "major", basedOn: "8.0.0", authors: ["a@brainpop.example", "b@brainpop.example"], publishedBy: "a@brainpop.example", publishedAt: "2026-09-04T09:00:00.000Z" }),
      record("10.0.0", H(3), { releaseNote: "=HYPERLINK(\"http://evil\")" }),
    ],
    events: [
      { at: "2026-09-01T09:00:00.000Z", how: "set_up", version: "8.0.0", hash: null, reason: null },
      { at: "2026-09-04T09:00:00.000Z", how: "published", version: "9.0.0", hash: H(2), reason: null },
    ],
  };
  const sittings = sittingsByRelease([
    { releaseHash: H(2), terminal: true, startedAt: "2026-09-08T09:00:00.000Z" },
    { releaseHash: H(2), terminal: false, startedAt: "2026-09-07T09:00:00.000Z" },
    { releaseHash: H(4), terminal: true, startedAt: "2026-05-01T09:00:00.000Z" },
    { releaseHash: H(9), terminal: true, startedAt: "2026-05-01T09:00:00.000Z" },
    { releaseHash: null, terminal: true, startedAt: null },
  ]);
  const history = versionHistory({
    studio: [studio],
    registry: [
      { hash: H(1), version: "8.0.0", releaseKey: "ybm_nd2026_standard_r8_0_0", publishedAt: "2026-06-01T00:00:00.000Z", source: "repository" },
      { hash: H(2), version: "9.0.0", releaseKey: "ybm_nd2026_standard_r9_0_0", publishedAt: "2026-09-04T09:00:00.000Z", source: "studio" },
      { hash: H(4), version: "7.3.0", releaseKey: "ybm_nd2026_standard_r7_3_0", publishedAt: "2026-05-01T00:00:00.000Z", source: "repository" },
    ],
    sittings,
    facts: new Map([
      [H(1), { engineVersion: "0.2.0", myStory: null }],
      [H(2), { engineVersion: "0.3.0", myStory: null }],
      [H(3), { problem: "Studio's copy does not hash to its hash." }],
      [H(4), { engineVersion: "0.1.0", myStory: { protocol: "np.phone_wellbeing", protocolVersion: "0.1.1" } }],
    ]),
    now: new Date("2026-10-01T00:00:00.000Z"),
  });

  it("lists Studio's versions and the registry's others, newest first", () => {
    expect(history.studioSetUp).toBe(true);
    expect(history.versions.map((v) => [v.version, v.source, v.inStudio, v.registered])).toEqual([
      ["10.0.0", "studio", true, false],
      ["9.0.0", "studio", true, true],
      ["8.0.0", "repository", true, true],
      ["7.3.0", "repository", false, true],
    ]);
  });

  it("says which version is live, since when, and when each one was", () => {
    expect(history.live).toEqual([
      { surveyId: "ybm_nd2026_standard", title: "Your Brain Matters", version: "9.0.0", hash: H(2), releaseKey: "ybm_nd2026_standard_r9_0_0", generation: 2, since: "2026-09-04T09:00:00.000Z" },
    ]);
    const v9 = history.versions.find((v) => v.version === "9.0.0")!;
    expect(v9.live).toBe(true);
    expect(v9.livePeriods).toEqual([{ from: "2026-09-04T09:00:00.000Z", to: null, how: "published", reason: null }]);
    expect(history.versions.find((v) => v.version === "8.0.0")!.livePeriods[0]).toMatchObject({ how: "set_up", to: "2026-09-04T09:00:00.000Z" });
  });

  it("counts sittings per version, and those under a version nobody knows", () => {
    expect(history.versions.find((v) => v.version === "9.0.0")).toMatchObject({ sittings: 2, complete: 1, partial: 1, firstSitting: "2026-09-07T09:00:00.000Z", lastSitting: "2026-09-08T09:00:00.000Z" });
    expect(history.versions.find((v) => v.version === "7.3.0")).toMatchObject({ sittings: 1, myStory: { protocol: "np.phone_wellbeing", protocolVersion: "0.1.1" } });
    expect(history.unknownSittings).toBe(1);
  });

  it("carries Studio's provenance, and says why a version cannot be read", () => {
    expect(history.versions.find((v) => v.version === "9.0.0")).toMatchObject({ authors: ["a@brainpop.example", "b@brainpop.example"], publishedBy: "a@brainpop.example", basedOn: "8.0.0", bump: "major", releaseNote: "Shorter sleep section" });
    expect(history.versions.find((v) => v.version === "10.0.0")!.problem).toMatch(/does not hash/);
  });

  it("before Studio is set up, lists the registry alone", () => {
    const before = versionHistory({ studio: [], registry: [{ hash: H(1), version: "8.0.0", releaseKey: "k", publishedAt: null, source: "repository" }], sittings: new Map(), facts: new Map(), now: new Date() });
    expect(before.studioSetUp).toBe(false);
    expect(before.live).toEqual([]);
    expect(before.versions).toHaveLength(1);
  });

  it("exports the provenance as a spreadsheet-safe CSV, newest first", () => {
    const csv = provenanceCsv(history.versions);
    expect(csv.startsWith("﻿survey,version,release_key,hash,engine_version,status,source,")).toBe(true);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain(",10.0.0,");
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(lines[2]).toContain(",live,studio,yes,yes,a@brainpop.example; b@brainpop.example,");
    expect(lines[2]).toContain("2026-09-04T09:00:00.000Z to now (published)");
    expect(lines[4]).toContain(",on,np.phone_wellbeing@0.1.1,1,1,0,");
  });
});
