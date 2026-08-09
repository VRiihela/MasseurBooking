import { describe, expect, it } from "vitest";
import { toIsoDateString } from "../../src/services/adminCatalogService.js";

describe("toIsoDateString", () => {
  it("round-trips a local-time Date the same way postgres-date constructs one from a DATE column", () => {
    // Mirrors postgres-date's "force YYYY-MM-DD dates to be parsed as local
    // time" behavior (new Date(year, month, day)) -- must be read back with
    // local getters, not toISOString(), or the date shifts by one whenever
    // the process isn't running in UTC.
    const date = new Date(2026, 11, 25); // December 25, 2026, local midnight
    expect(toIsoDateString(date)).toBe("2026-12-25");
  });

  it("pads single-digit month and day", () => {
    const date = new Date(2026, 0, 5); // January 5, 2026
    expect(toIsoDateString(date)).toBe("2026-01-05");
  });
});
