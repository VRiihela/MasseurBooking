import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  createAvailabilityRule,
  deleteAvailabilityRule,
  getAvailabilityRules,
} from "../api/client";
import type { AvailabilityRule } from "../api/types";

interface Props {
  onSessionEnded: () => void;
}

// The API's weekday convention: 1 = Monday .. 7 = Sunday. Deliberately not
// derived from Date.getDay() (0 = Sunday .. 6 = Saturday) or Intl -- this is
// a static weekly-pattern editor, not calendar-linked, and building the
// label list from a different convention than the wire format would swap
// Sunday and Monday silently.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

interface AddFormState {
  start: string;
  end: string;
  error: string | null;
}

function emptyAddForms(): Record<number, AddFormState> {
  return Object.fromEntries(
    WEEKDAYS.map((weekday) => [weekday.value, { start: "", end: "", error: null }]),
  );
}

// <input type="time"> emits "HH:MM" with no seconds; the backend requires
// strict HH:MM:SS (adminAvailabilitySchema.ts's timeOfDay regex). There's no
// reason to expose seconds-level precision to the masseur for business
// hours, so append ":00" here rather than using a seconds-capable picker.
function toWireTime(inputValue: string): string {
  return `${inputValue}:00`;
}

export function AdminAvailability({ onSessionEnded }: Props) {
  const [rules, setRules] = useState<AvailabilityRule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addForms, setAddForms] = useState<Record<number, AddFormState>>(emptyAddForms);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setRules(null);

    getAvailabilityRules()
      .then((result) => {
        if (!cancelled) {
          setRules(result);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          onSessionEnded();
          return;
        }
        setLoadError("Could not load your availability. Please try again shortly.");
      });

    return () => {
      cancelled = true;
    };
  }, [onSessionEnded]);

  const rulesByWeekday = useMemo(() => {
    const map = new Map<number, AvailabilityRule[]>();
    for (const weekday of WEEKDAYS) {
      map.set(weekday.value, []);
    }
    for (const rule of rules ?? []) {
      map.get(rule.weekday)?.push(rule);
    }
    return map;
  }, [rules]);

  function updateAddForm(weekday: number, patch: Partial<AddFormState>) {
    setAddForms((current) => ({ ...current, [weekday]: { ...current[weekday], ...patch } }));
  }

  async function handleAddRule(weekday: number) {
    const form = addForms[weekday];
    if (!form.start || !form.end) {
      updateAddForm(weekday, { error: "Enter both a start and end time." });
      return;
    }
    if (form.end <= form.start) {
      updateAddForm(weekday, { error: "End time must be after start time." });
      return;
    }
    updateAddForm(weekday, { error: null });

    try {
      const rule = await createAvailabilityRule({
        weekday,
        start_time: toWireTime(form.start),
        end_time: toWireTime(form.end),
      });
      setRules((current) => (current ? [...current, rule] : [rule]));
      updateAddForm(weekday, { start: "", end: "", error: null });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnded();
        return;
      }
      const message =
        error instanceof ApiError ? error.message : "Could not add this time range. Please try again.";
      updateAddForm(weekday, { error: message });
    }
  }

  async function handleDeleteRule(id: string) {
    setDeleteError(null);
    try {
      await deleteAvailabilityRule(id);
      setRules((current) => current?.filter((rule) => rule.id !== id) ?? current);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnded();
        return;
      }
      setDeleteError(
        error instanceof ApiError ? error.message : "Could not delete this time range. Please try again.",
      );
    }
  }

  return (
    <div className="admin-availability">
      {loadError && <p role="alert">{loadError}</p>}
      {deleteError && <p role="alert">{deleteError}</p>}
      {!loadError && rules === null && <p>Loading availability&hellip;</p>}

      {rules !== null && (
        <ul className="admin-availability-weekdays">
          {WEEKDAYS.map((weekday) => {
            const dayRules = rulesByWeekday.get(weekday.value) ?? [];
            const form = addForms[weekday.value];

            return (
              <li key={weekday.value} data-testid={`weekday-${weekday.value}`}>
                <h2>{weekday.label}</h2>

                {dayRules.length === 0 ? (
                  <p>No hours set</p>
                ) : (
                  <ul>
                    {dayRules.map((rule) => (
                      <li key={rule.id} data-testid={`rule-${rule.id}`}>
                        {rule.start_time.slice(0, 5)}&ndash;{rule.end_time.slice(0, 5)}
                        <button type="button" onClick={() => void handleDeleteRule(rule.id)}>
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div>
                  <label>
                    Start time
                    <input
                      type="time"
                      value={form.start}
                      onChange={(event) => updateAddForm(weekday.value, { start: event.target.value })}
                    />
                  </label>
                  <label>
                    End time
                    <input
                      type="time"
                      value={form.end}
                      onChange={(event) => updateAddForm(weekday.value, { end: event.target.value })}
                    />
                  </label>
                  <button type="button" onClick={() => void handleAddRule(weekday.value)}>
                    Add time range
                  </button>
                  {form.error && <p role="alert">{form.error}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
