import { describe, expect, it } from "vitest";
import { previewOrigins } from "./env.js";

describe("preview channel origins", () => {
  const [origin] = previewOrigins("myself-research-dashboard");

  it("allows the named site's preview channels", () => {
    expect(origin!.test("https://myself-research-dashboard--preview-ab12cd34.web.app")).toBe(true);
  });

  it("allows nothing else", () => {
    for (const other of [
      "https://myself-research-dashboard.web.app.evil.example",
      "https://myself-research-dashboard--preview-ab12cd34.web.app.evil.example",
      "https://evil--myself-research-dashboard--x.web.app",
      "http://myself-research-dashboard--preview-ab12cd34.web.app",
      "https://myself-research-dashboardXweb.app",
      "https://other-site--preview-ab12cd34.web.app",
    ]) {
      expect(origin!.test(other), other).toBe(false);
    }
  });

  it("allows no pattern at all for a missing or malformed site name", () => {
    expect(previewOrigins(undefined)).toEqual([]);
    expect(previewOrigins("")).toEqual([]);
    expect(previewOrigins("a.b")).toEqual([]);
    expect(previewOrigins(".*")).toEqual([]);
  });
});
