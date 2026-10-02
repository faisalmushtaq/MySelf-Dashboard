import { describe, expect, it } from "vitest";
import { demoManifest } from "@myself-dashboard/core/node";

// releases.ts imports env.ts, which initialises firebase-admin: fine without
// credentials as long as nothing is called.
import { checkStudioRelease, prepareRelease, ReleaseRejected } from "./releases.js";

/** A `publicReleases/{hex}` document as MySelf Studio writes one (survey docs/16 §5.2). */
function studioCopy(manifest: Record<string, any>, changes: Record<string, unknown> = {}) {
  return {
    surveyId: "demo_survey",
    study: manifest["release"]["study"],
    hash: manifest["hash"],
    version: manifest["release"]["version"],
    releaseKey: manifest["release"]["key"],
    engineVersion: manifest["release"]["engineVersion"],
    manifest: JSON.stringify(manifest),
    bytes: 1,
    publishedAt: "2026-09-04T09:00:00.000Z",
    ...changes,
  };
}

describe("reading a version MySelf Studio published", () => {
  it("accepts Studio's copy when its manifest hashes to the hash it is filed under", async () => {
    const m = demoManifest("2.0.0");
    const found = await checkStudioRelease(m["hash"] as string, studioCopy(m), "demo");
    expect(found).toMatchObject({ hash: m["hash"], surveyId: "demo_survey", version: "2.0.0" });
    expect(found.json).toBe(JSON.stringify(m));
  });

  it("refuses a copy changed after it was published", async () => {
    const m = demoManifest("2.0.0") as Record<string, any>;
    const changed = structuredClone(m);
    changed["composition"]["sections"][0]["title"] = "Changed after publishing";
    await expect(checkStudioRelease(m["hash"], studioCopy(changed), "demo")).rejects.toThrow(/does not hash to it/);
  });

  it("refuses a copy filed under another version's hash, or that disagrees with itself", async () => {
    const m = demoManifest("2.0.0") as Record<string, any>;
    const other = demoManifest("1.1.0")["hash"] as string;
    await expect(checkStudioRelease(other, studioCopy(m, { hash: other }), "demo")).rejects.toThrow(ReleaseRejected);
    await expect(checkStudioRelease(m["hash"], studioCopy(m, { version: "2.0.1" }), "demo")).rejects.toThrow(/version is 2.0.1/);
    await expect(checkStudioRelease(m["hash"], studioCopy(m, { hash: other }), "demo")).rejects.toThrow(/hash is/);
  });

  it("refuses a copy that is not a manifest, or another study's", async () => {
    const m = demoManifest("2.0.0") as Record<string, any>;
    await expect(checkStudioRelease(m["hash"], studioCopy(m, { manifest: "{not json" }), "demo")).rejects.toThrow(/not valid JSON/);
    await expect(checkStudioRelease(m["hash"], studioCopy(m, { manifest: undefined }), "demo")).rejects.toThrow(/no manifest/);
    await expect(checkStudioRelease(m["hash"], studioCopy(m), "ybm")).rejects.toThrow(/belongs to study/);
  });
});

describe("registering a release", () => {
  it("accepts a manifest whose content matches its hash", () => {
    const m = demoManifest("1.1.0");
    const { meta } = prepareRelease(m, "demo");
    expect(meta).toMatchObject({ version: "1.1.0", study: "demo", hash: m["hash"] });
  });

  it("refuses a tampered manifest", () => {
    const m = demoManifest("1.1.0") as Record<string, any>;
    m["composition"]["sections"][0]["title"] = "Changed after publishing";
    expect(() => prepareRelease(m, "demo")).toThrow(ReleaseRejected);
  });

  it("refuses a manifest with no hash, and another study's", () => {
    const { hash, ...unhashed } = demoManifest("1.0.0");
    void hash;
    expect(() => prepareRelease(unhashed, "demo")).toThrow(/no hash/);
    expect(() => prepareRelease(demoManifest("1.0.0"), "ybm")).toThrow(/belongs to study/);
  });
});
