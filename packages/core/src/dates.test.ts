import { describe, expect, it } from "vitest";
import { addDays, dayKey, resolveRange, startOfDayUtc, weekStart } from "./dates.js";

const tz = "Europe/London";

describe("study-local dates", () => {
  it("puts a late-evening UTC time on the next London day in summer", () => {
    expect(dayKey(Date.parse("2026-07-01T23:30:00Z"), tz)).toBe("2026-07-02");
    expect(dayKey(Date.parse("2026-12-01T23:30:00Z"), tz)).toBe("2026-12-01");
  });

  it("starts a London day at the right UTC instant either side of the clocks changing", () => {
    expect(new Date(startOfDayUtc("2026-07-01", tz)).toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(new Date(startOfDayUtc("2026-12-01", tz)).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    // Clocks go back on 25 Oct 2026: that day is 25 hours long.
    const len = startOfDayUtc("2026-10-26", tz) - startOfDayUtc("2026-10-25", tz);
    expect(len).toBe(25 * 3_600_000);
  });

  it("resolves every preset against 'now' in the study time zone", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    expect(resolveRange("today", {}, now, tz)).toMatchObject({ fromDay: "2026-09-28", toDay: "2026-09-28" });
    expect(resolveRange("7d", {}, now, tz)).toMatchObject({ fromDay: "2026-09-22", toDay: "2026-09-28" });
    expect(resolveRange("30d", {}, now, tz)).toMatchObject({ fromDay: "2026-08-30", toDay: "2026-09-28" });
    expect(resolveRange("this_month", {}, now, tz)).toMatchObject({ fromDay: "2026-09-01", toDay: "2026-09-28" });
    expect(resolveRange("prev_month", {}, now, tz)).toMatchObject({ fromDay: "2026-08-01", toDay: "2026-08-31" });
    expect(resolveRange("all", {}, now, tz)).toMatchObject({ from: null, to: null });
  });

  it("custom ranges are inclusive, tolerate reversed ends and ignore garbage", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    const r = resolveRange("custom", { from: "2026-09-10", to: "2026-09-01" }, now, tz);
    expect(r).toMatchObject({ fromDay: "2026-09-01", toDay: "2026-09-10" });
    expect(r.to! - r.from!).toBe(10 * 86_400_000);
    expect(resolveRange("custom", { from: "not-a-date" }, now, tz)).toMatchObject({ from: null, to: null });
    expect(resolveRange("custom", { from: "2026-02-30" }, now, tz).from).toBeNull();
  });

  it("prev month works across a year boundary", () => {
    expect(resolveRange("prev_month", {}, new Date("2027-01-15T12:00:00Z"), tz)).toMatchObject({ fromDay: "2026-12-01", toDay: "2026-12-31" });
  });

  it("weeks start on Monday", () => {
    expect(weekStart("2026-09-27")).toBe("2026-09-21");
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
