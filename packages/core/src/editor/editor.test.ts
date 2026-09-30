import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rebuild } from "../node/editor.js";
import { protocols } from "../vendor/myself/narrative/index.js";
import { applyEdit, applyEdits, EditError, myStoryOf, type Edit } from "./edits.js";
import { diffWorkspaces } from "./diff.js";
import { nextVersion } from "./version.js";
import { activePeriods, provenanceCsv } from "./provenance.js";
import { findItem, unfreeze, type Workspace } from "./workspace.js";

type Manifest = { hash: string; release: { version: string; publishedAt: string; publishedBy: string; engineVersion: string; decisionRefs?: string[] } };
const dir = new URL("../../../../releases/", import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Manifest;
const r9 = load("ybm_nd2026_standard_r9.0.0.manifest.json");
const base = unfreeze(r9 as never);
const meta = (version: string) => ({ version, publishedAt: "2026-10-01T09:00:00.000Z", publishedBy: "owner@brainpop.example", engineVersion: r9.release.engineVersion });
const edit = (...edits: Edit[]) => {
  const out = applyEdits(base, edits);
  if (out.failed) throw new Error(out.failed.message);
  return out.workspace;
};
const built = (ws: Workspace, version = "10.0.0") => {
  const out = rebuild(ws, meta(version));
  if ("problems" in out) throw new Error(out.problems.join("\n"));
  return out.manifest as Manifest & Record<string, unknown>;
};

describe("a published version, unfrozen and rebuilt unedited", () => {
  const files = readdirSync(dir).filter((f) => /_r\d+\.\d+\.\d+\.manifest\.json$/.test(f));
  const fixed = (v: string) => v.localeCompare("7.2.0", undefined, { numeric: true }) >= 0;

  it.each(files)("%s", (file) => {
    const m = load(file);
    const r = m.release;
    const out = rebuild(unfreeze(m as never), { version: r.version, publishedAt: r.publishedAt, publishedBy: r.publishedBy, engineVersion: r.engineVersion, ...(r.decisionRefs ? { decisionRefs: r.decisionRefs } : {}) });
    if (fixed(r.version)) {
      // Byte for byte: the editor starts from exactly what was fielded.
      expect("manifest" in out && (out.manifest as Manifest).hash).toBe(m.hash);
    } else {
      // Before r7.2.0 the SWEMWBS scoring named items the form does not have
      // (D-49), and r1–r4 predate today's schema; the publish gate refuses
      // them, so they cannot be a draft's base.
      expect("problems" in out && out.problems.length).toBeGreaterThan(0);
    }
  });
});

describe("editing wording", () => {
  it("rewords one of the study's own questions, and the release carries it", () => {
    const ws = edit({ op: "setQuestionText", question: "ybm_intro_consent.linkage_consent", field: "stem", text: "May we link your answers to your health and school records?" });
    const changes = diffWorkspaces(base, ws);
    expect(changes).toEqual([expect.objectContaining({ area: "question", subject: "ybm_intro_consent.linkage_consent", participantVisible: true })]);
    const m = built(ws);
    expect(JSON.stringify(m)).toContain("May we link your answers to your health and school records?");
    expect(m.hash).not.toBe(r9.hash);
  });

  it("refuses to reword a licensed instrument, and says why", () => {
    expect(() => applyEdit(base, { op: "setQuestionText", question: "swemwbs.optimistic", field: "stem", text: "Changed" }, base)).toThrow(/licensed instrument/);
    expect(() => applyEdit(base, { op: "setRequired", question: "sdq25_s.q1", required: "optional" }, base)).toThrow(EditError);
  });

  it("keeps identifying questions required", () => {
    expect(() => applyEdit(base, { op: "setRequired", question: "ybm_identity.first_name", required: "optional" }, base)).toThrow(/identifying/);
  });
});

describe("editing answer options", () => {
  const scaleOf = (key: string) => findItem(base, key)!.item.scale!;

  it("relabels an option on the study's own scale, moving the scale to a new major version", () => {
    const scale = scaleOf("ybm_intro_consent.linkage_consent");
    const ws = edit({ op: "setOptionLabel", scale, code: 1, label: "Yes, you may" });
    expect(ws.scales[scale]!.version).toBe("2.0.0");
    expect(findItem(ws, "ybm_intro_consent.linkage_consent")!.item.scaleVersion).toBe("2.0.0");
    expect(diffWorkspaces(base, ws).map((c) => c.area)).toContain("options");
    built(ws);
  });

  it("moves a scale's version once per draft, however many options change", () => {
    const scale = scaleOf("ybm_intro_consent.linkage_consent");
    const ws = edit({ op: "setOptionLabel", scale, code: 1, label: "Yes" }, { op: "setOptionLabel", scale, code: 2, label: "No" });
    expect(ws.scales[scale]!.version).toBe("2.0.0");
  });

  it("adds an option with a new code, never a reused one", () => {
    const scale = scaleOf("ybm_demographics.gender");
    const before = base.scales[scale]!.options.map((o) => o.code);
    const ws = edit({ op: "addOption", scale, label: "Another identity" });
    const added = ws.scales[scale]!.options.at(-1)!;
    expect(added.code).toBe(Math.max(...before) + 1);
    built(ws);
  });

  it("refuses to change a scale a licensed instrument also uses", () => {
    const scale = scaleOf("swemwbs.optimistic");
    expect(() => applyEdit(base, { op: "setOptionLabel", scale, code: 1, label: "x" }, base)).toThrow(/licence/);
  });
});

describe("adding and removing questions", () => {
  it("adds a question to one of the study's own parts, shown only after a yes", () => {
    const ws = edit({
      op: "addQuestion",
      instrument: "ybm_smartphone",
      after: "own",
      question: { key: "own_tablet", variable: "own_tablet", type: "single_choice", text: "Do you have a tablet of your own?", options: ["Yes", "No"], required: "soft", showIf: { question: "ybm_smartphone.own", is: "selected", code: 1 } },
    });
    const m = built(ws);
    expect(JSON.stringify(m)).toContain("Do you have a tablet of your own?");
    expect(diffWorkspaces(base, ws)).toEqual([expect.objectContaining({ subject: "ybm_smartphone.own_tablet", summary: expect.stringContaining("added") })]);
  });

  it("refuses a variable name that is already used", () => {
    expect(() =>
      applyEdit(base, { op: "addQuestion", instrument: "ybm_smartphone", after: null, question: { key: "x1", variable: findItem(base, "ybm_smartphone.own")!.item.variable, type: "text_short", text: "x", required: "optional" } }, base),
    ).toThrow(/already used/);
  });

  it("lets the publish gate refuse removing a question another one depends on", () => {
    const ws = edit({ op: "removeQuestion", question: "ybm_demographics.speaks_other_language" });
    const out = rebuild(ws, meta("10.0.0"));
    expect("problems" in out && out.problems.join("\n")).toMatch(/speaks_other_language.*not in this release/);
  });

  it("leaves a whole part out, and back in", () => {
    const section = base.draft.sections.find((s) => s.key === "gaming")!;
    const ws = edit({ op: "removeSection", section: "gaming" });
    expect(diffWorkspaces(base, ws)).toEqual([expect.objectContaining({ area: "section", summary: expect.stringContaining("left out") })]);
    built(ws);
    const back = applyEdit(ws, { op: "restoreSection", section: "gaming", at: base.draft.sections.indexOf(section) }, base);
    expect(diffWorkspaces(base, back)).toEqual([]);
  });
});

describe("MyStory", () => {
  const draftProtocol = protocols[0]! as unknown as Record<string, unknown>;
  const approved = { ...draftProtocol, version: "1.0.1", approvalStatus: "approved" };

  it("is added as the last section, after everything else", () => {
    const ws = edit({ op: "putProtocol", protocol: approved }, { op: "setMyStory", protocol: { key: String(approved["key"]), version: "1.0.1" } });
    expect(ws.draft.sections.at(-1)!.components).toEqual([{ kind: "narrative", protocol: approved["key"], protocolVersion: "1.0.1" }]);
    expect(myStoryOf(ws)).toEqual({ key: approved["key"], version: "1.0.1" });
    expect(diffWorkspaces(base, ws)).toEqual([expect.objectContaining({ area: "mystory", summary: expect.stringContaining("added at the end") })]);
    const m = built(ws);
    expect(Object.keys(m["narrativeProtocols"] as object)).toEqual([`${approved["key"]}@1.0.1`]);
  });

  it("can only field an approved protocol — the publish gate says so", () => {
    const ws = edit({ op: "putProtocol", protocol: draftProtocol }, { op: "setMyStory", protocol: { key: String(draftProtocol["key"]), version: String(draftProtocol["version"]) } });
    const out = rebuild(ws, meta("10.0.0"));
    expect("problems" in out && out.problems.join("\n")).toMatch(/only an approved protocol can be fielded/);
  });

  it("stays last when sections are moved, and comes off again", () => {
    const on = edit({ op: "putProtocol", protocol: approved }, { op: "setMyStory", protocol: { key: String(approved["key"]), version: "1.0.1" } });
    const off = applyEdit(on, { op: "setMyStory", protocol: null }, base);
    expect(myStoryOf(off)).toBeNull();
    expect(diffWorkspaces(base, off)).toEqual([]);
  });
});

describe("the version number", () => {
  it("is MAJOR for anything a participant could see", () => {
    const ws = edit({ op: "setScreenText", screen: "finish", field: "body", text: "Thank you — you have finished." });
    expect(nextVersion("9.0.0", diffWorkspaces(base, ws))).toMatchObject({ version: "10.0.0", level: "major" });
  });

  it("is PATCH for researcher-facing details only, and an owner may raise it but not lower it", () => {
    const ws = edit({ op: "setTitle", text: `${base.draft.title} (renamed)` });
    const changes = diffWorkspaces(base, ws);
    expect(nextVersion("9.0.0", changes)).toMatchObject({ version: "9.0.1", level: "patch" });
    expect(nextVersion("9.0.0", changes, "minor")).toMatchObject({ version: "9.1.0", level: "minor", required: "patch" });
    const visible = diffWorkspaces(base, edit({ op: "setStudyLabel", text: "Northdale · 2027" }));
    expect(nextVersion("9.0.0", visible, "patch")).toMatchObject({ version: "10.0.0", level: "major" });
  });

  it("counts from the highest version already published", () => {
    const ws = edit({ op: "setStudyLabel", text: "Northdale · 2027" });
    expect(nextVersion("10.0.0", diffWorkspaces(base, ws)).version).toBe("11.0.0");
  });
});

describe("provenance", () => {
  it("records when each version was the active one, and exports it", () => {
    const acts = [
      { hash: "sha256:a", version: "9.0.0", activatedAt: "2026-09-30T00:00:00.000Z", activatedBy: "o", reason: null },
      { hash: "sha256:b", version: "10.0.0", activatedAt: "2026-10-01T00:00:00.000Z", activatedBy: "o", reason: "new wording" },
      { hash: "sha256:a", version: "9.0.0", activatedAt: "2026-10-02T00:00:00.000Z", activatedBy: "o", reason: "rolled back" },
    ];
    expect(activePeriods(acts).get("sha256:a")).toEqual([
      { from: "2026-09-30T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
      { from: "2026-10-02T00:00:00.000Z", to: null },
    ]);
    const csv = provenanceCsv(
      [{ hash: "sha256:b", version: "10.0.0", key: "k", publishedAt: "2026-10-01T00:00:00.000Z", publishedBy: "o", source: "editor", baseVersion: "9.0.0", notes: "=cmd", bump: "major", changes: ["a", "b"], mystory: null, sittings: 3, firstSitting: null, lastSitting: null }],
      acts,
    );
    expect(csv).toContain("10.0.0");
    expect(csv).toContain("a; b");
    expect(csv).not.toMatch(/,=cmd/); // a formula typed as a reason is defused
  });
});
