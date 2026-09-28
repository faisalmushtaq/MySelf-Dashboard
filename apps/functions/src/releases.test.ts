import { describe, expect, it } from "vitest";
import { demoManifest } from "@myself-dashboard/core/node";

// releases.ts imports env.ts, which initialises firebase-admin: fine without
// credentials as long as nothing is called.
import { prepareRelease, ReleaseRejected } from "./releases.js";

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
