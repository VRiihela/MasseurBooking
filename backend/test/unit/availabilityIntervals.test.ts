import { describe, expect, it } from "vitest";
import {
  sliceIntoSlots,
  subtractIntervals,
  unionIntervals,
} from "../../src/services/availabilityIntervals.js";

describe("unionIntervals", () => {
  it("returns an empty array for no intervals", () => {
    expect(unionIntervals([])).toEqual([]);
  });

  it("leaves disjoint intervals separate", () => {
    const result = unionIntervals([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ]);
    expect(result).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ]);
  });

  it("merges overlapping intervals", () => {
    const result = unionIntervals([
      { start: 0, end: 10 },
      { start: 5, end: 15 },
    ]);
    expect(result).toEqual([{ start: 0, end: 15 }]);
  });

  it("merges exactly-adjacent intervals", () => {
    const result = unionIntervals([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ]);
    expect(result).toEqual([{ start: 0, end: 20 }]);
  });

  it("merges regardless of input order", () => {
    const result = unionIntervals([
      { start: 20, end: 30 },
      { start: 0, end: 10 },
      { start: 5, end: 25 },
    ]);
    expect(result).toEqual([{ start: 0, end: 30 }]);
  });
});

describe("subtractIntervals", () => {
  it("removes an interval that fully covers the base", () => {
    const result = subtractIntervals([{ start: 0, end: 10 }], [{ start: -5, end: 15 }]);
    expect(result).toEqual([]);
  });

  it("splits a base interval when the removal is in the middle", () => {
    const result = subtractIntervals([{ start: 0, end: 10 }], [{ start: 3, end: 6 }]);
    expect(result).toEqual([
      { start: 0, end: 3 },
      { start: 6, end: 10 },
    ]);
  });

  it("trims the left edge", () => {
    const result = subtractIntervals([{ start: 0, end: 10 }], [{ start: -5, end: 4 }]);
    expect(result).toEqual([{ start: 4, end: 10 }]);
  });

  it("trims the right edge", () => {
    const result = subtractIntervals([{ start: 0, end: 10 }], [{ start: 6, end: 15 }]);
    expect(result).toEqual([{ start: 0, end: 6 }]);
  });

  it("leaves the base untouched when the removal doesn't overlap", () => {
    const result = subtractIntervals([{ start: 0, end: 10 }], [{ start: 20, end: 30 }]);
    expect(result).toEqual([{ start: 0, end: 10 }]);
  });

  it("applies multiple removals in sequence", () => {
    const result = subtractIntervals(
      [{ start: 0, end: 100 }],
      [
        { start: 10, end: 20 },
        { start: 50, end: 60 },
      ],
    );
    expect(result).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 50 },
      { start: 60, end: 100 },
    ]);
  });

  it("drops zero-length remainders", () => {
    const result = subtractIntervals([{ start: 0, end: 10 }], [{ start: 0, end: 10 }]);
    expect(result).toEqual([]);
  });
});

describe("sliceIntoSlots", () => {
  const HOUR = 60 * 60_000;
  const FIFTEEN_MIN = 15 * 60_000;

  it("produces slot starts at the given granularity while the duration fits", () => {
    const result = sliceIntoSlots([{ start: 0, end: HOUR }], HOUR, FIFTEEN_MIN);
    expect(result).toEqual([0]);
  });

  it("produces multiple overlapping-start slots across a longer interval", () => {
    const result = sliceIntoSlots([{ start: 0, end: 2 * HOUR }], HOUR, FIFTEEN_MIN);
    expect(result).toEqual([0, FIFTEEN_MIN, 2 * FIFTEEN_MIN, 3 * FIFTEEN_MIN, 4 * FIFTEEN_MIN]);
  });

  it("produces no slots when the interval is shorter than the required duration", () => {
    const result = sliceIntoSlots([{ start: 0, end: 30 * 60_000 }], HOUR, FIFTEEN_MIN);
    expect(result).toEqual([]);
  });

  it("never emits a slot that overruns the interval end", () => {
    const result = sliceIntoSlots([{ start: 0, end: 90 * 60_000 }], HOUR, FIFTEEN_MIN);
    for (const start of result) {
      expect(start + HOUR).toBeLessThanOrEqual(90 * 60_000);
    }
  });

  it("handles multiple free intervals independently", () => {
    const result = sliceIntoSlots(
      [
        { start: 0, end: HOUR },
        { start: 3 * HOUR, end: 4 * HOUR },
      ],
      HOUR,
      FIFTEEN_MIN,
    );
    expect(result).toEqual([0, 3 * HOUR]);
  });
});
