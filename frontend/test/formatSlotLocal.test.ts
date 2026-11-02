import { describe, expect, it } from "vitest";
import { formatSlotDate, formatSlotLocal, formatSlotTime } from "../src/lib/formatSlotLocal";

describe("formatSlotTime", () => {
  it("formats a time only, in Finnish 24-hour format", () => {
    expect(formatSlotTime("2026-11-02T10:00:00.000Z")).toBe("12.00");
  });

  it("does not zero-pad morning hours", () => {
    expect(formatSlotTime("2026-11-02T07:00:00.000Z")).toBe("9.00");
  });

  it("uses the provider's offset on each side of the DST change", () => {
    // Finland leaves summer time on 25 Oct 2026: the same UTC time of day reads
    // an hour earlier the day after.
    expect(formatSlotTime("2026-10-24T09:00:00.000Z")).toBe("12.00");
    expect(formatSlotTime("2026-10-25T09:00:00.000Z")).toBe("11.00");
  });
});

describe("formatSlotDate", () => {
  it("formats a date input value with weekday and year", () => {
    expect(formatSlotDate("2026-11-02")).toBe("ma 2.11.2026");
  });

  it("gets the weekday right on the DST change day itself", () => {
    expect(formatSlotDate("2026-10-25")).toBe("su 25.10.2026");
  });

  it("returns an empty string instead of throwing on a cleared date input", () => {
    expect(formatSlotDate("")).toBe("");
  });

  it("returns an empty string instead of throwing on a malformed date", () => {
    expect(formatSlotDate("not-a-date")).toBe("");
  });
});

describe("header date and tile times", () => {
  it("agree on the day for a late-evening slot that's already tomorrow in UTC+9", () => {
    // 23.30 on 2 Nov in Helsinki, but 3 Nov in Tokyo. Run the suite with
    // TZ=Asia/Tokyo to exercise this against a browser in another timezone.
    const slot = "2026-11-02T21:30:00.000Z";

    expect(formatSlotDate("2026-11-02")).toBe("ma 2.11.2026");
    expect(formatSlotTime(slot)).toBe("23.30");
    expect(formatSlotLocal(slot)).toBe("ma 2.11. klo 23.30");
  });
});
