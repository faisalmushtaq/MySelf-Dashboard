import { describe, expect, it } from "vitest";
import { studioHome } from "./links";

describe("the dashboard's link to MySelf Studio", () => {
  it("opens the study's own survey list, and the default study's without a prefix", () => {
    expect(studioHome({ study: "ybm", isDefault: true })).toBe("https://faisalmushtaq.github.io/MySelf/researcher/#/surveys");
    expect(studioHome({ study: "social_media_break_lab", isDefault: false })).toBe(
      "https://faisalmushtaq.github.io/MySelf/researcher/#/study/social_media_break_lab/surveys",
    );
  });
});
