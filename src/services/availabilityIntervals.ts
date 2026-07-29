export interface Interval {
  start: number; // epoch ms
  end: number; // epoch ms
}

export function unionIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) {
    return [];
  }
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [{ ...sorted[0] }];

  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

export function subtractIntervals(base: Interval[], toRemove: Interval[]): Interval[] {
  let result = base.map((interval) => ({ ...interval }));

  for (const remove of toRemove) {
    const next: Interval[] = [];
    for (const interval of result) {
      if (remove.end <= interval.start || remove.start >= interval.end) {
        next.push(interval);
        continue;
      }
      if (remove.start > interval.start) {
        next.push({ start: interval.start, end: Math.min(remove.start, interval.end) });
      }
      if (remove.end < interval.end) {
        next.push({ start: Math.max(remove.end, interval.start), end: interval.end });
      }
    }
    result = next;
  }

  return result.filter((interval) => interval.end > interval.start);
}

/**
 * Walks each free interval at `granularityMs` steps, keeping a slot start
 * only when the full `slotDurationMs` block fits before the interval ends.
 */
export function sliceIntoSlots(
  intervals: Interval[],
  slotDurationMs: number,
  granularityMs: number,
): number[] {
  const starts: number[] = [];
  for (const interval of intervals) {
    for (let cursor = interval.start; cursor + slotDurationMs <= interval.end; cursor += granularityMs) {
      starts.push(cursor);
    }
  }
  return starts.sort((a, b) => a - b);
}
