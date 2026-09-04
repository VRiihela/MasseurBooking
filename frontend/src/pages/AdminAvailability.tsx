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
  { value: 1, label: "Maanantai" },
  { value: 2, label: "Tiistai" },
  { value: 3, label: "Keskiviikko" },
  { value: 4, label: "Torstai" },
  { value: 5, label: "Perjantai" },
  { value: 6, label: "Lauantai" },
  { value: 7, label: "Sunnuntai" },
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
        setLoadError("Saatavuuttasi ei voitu ladata. Yritä hetken kuluttua uudelleen.");
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
      updateAddForm(weekday, { error: "Anna sekä alkamis- että päättymisaika." });
      return;
    }
    if (form.end <= form.start) {
      updateAddForm(weekday, { error: "Päättymisajan on oltava alkamisajan jälkeen." });
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
        error instanceof ApiError ? error.message : "Aikaväliä ei voitu lisätä. Yritä uudelleen.";
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
        error instanceof ApiError ? error.message : "Aikaväliä ei voitu poistaa. Yritä uudelleen.",
      );
    }
  }

  return (
    <div className="admin-availability page">
      {loadError && <p role="alert">{loadError}</p>}
      {deleteError && <p role="alert">{deleteError}</p>}
      {!loadError && rules === null && <p className="loading-text">Ladataan saatavuutta&hellip;</p>}

      {rules !== null && (
        <ul className="admin-availability-weekdays">
          {WEEKDAYS.map((weekday) => {
            const dayRules = rulesByWeekday.get(weekday.value) ?? [];
            const form = addForms[weekday.value];

            return (
              <li key={weekday.value} className="card" data-testid={`weekday-${weekday.value}`}>
                <h2>{weekday.label}</h2>

                {dayRules.length === 0 ? (
                  <p>Ei asetettuja aikoja</p>
                ) : (
                  <ul>
                    {dayRules.map((rule) => (
                      <li key={rule.id} data-testid={`rule-${rule.id}`}>
                        {rule.start_time.slice(0, 5)}&ndash;{rule.end_time.slice(0, 5)}
                        <button type="button" className="btn btn-secondary" onClick={() => void handleDeleteRule(rule.id)}>
                          Poista
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div>
                  <div className="field">
                    <label>
                      Alkamisaika
                      <input
                        type="time"
                        value={form.start}
                        onChange={(event) => updateAddForm(weekday.value, { start: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="field">
                    <label>
                      Päättymisaika
                      <input
                        type="time"
                        value={form.end}
                        onChange={(event) => updateAddForm(weekday.value, { end: event.target.value })}
                      />
                    </label>
                  </div>
                  <button type="button" className="btn btn-primary" onClick={() => void handleAddRule(weekday.value)}>
                    Lisää aikaväli
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
