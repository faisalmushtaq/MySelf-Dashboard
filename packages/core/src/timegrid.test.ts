import { describe, expect, it } from "vitest";
import { answerCell, gridCell } from "./exportData.js";
import type { QuestionDef } from "./manifest.js";
import { renderAnswer } from "./present.js";

// "Time on each app" (D-66), as a release indexes it: its options are the rows it could have.
const grid = {
  key: "ybm_app_time.minutes_per_app",
  variable: "app_minutes",
  responseType: "time_grid",
  identifying: false,
  freeText: false,
  options: [
    { code: 2, label: "Snapchat", kind: "substantive" },
    { code: 3, label: "Instagram", kind: "substantive" },
    { code: 4, label: "TikTok or Douyin", kind: "substantive" },
  ],
  constraints: {},
} as unknown as QuestionDef;

const answer = { kind: "time_grid", minutes: { "2": 90, "3": 45 } };

describe("time grid answers (D-66)", () => {
  it("read as each app and its time, not as an unrecognised answer", () => {
    const r = renderAnswer(grid, answer, { freeText: false });
    expect(r.display).toBe("Snapchat: 1 h 30 min\nInstagram: 45 min");
    expect(r.redacted).toBeNull();
  });

  it("say when a row was left empty, and name a row this version doesn't have", () => {
    expect(renderAnswer(grid, { kind: "time_grid", minutes: { "2": null, "9": 5 } }, { freeText: false }).display).toBe(
      "Snapchat: not given\nCode 9: 5 min",
    );
    expect(renderAnswer(grid, { kind: "time_grid", minutes: {} }, { freeText: false }).display).toBe("No times given");
  });

  it("export as minutes: one column per app in the wide layout, the whole grid in one cell otherwise", () => {
    expect(gridCell(grid, answer, 2)).toBe(90);
    expect(gridCell(grid, answer, 3)).toBe(45);
    expect(gridCell(grid, answer, 4)).toBeNull();
    expect(answerCell(grid, answer, false)).toBe(JSON.stringify({ "2": 90, "3": 45 }));
  });
});
