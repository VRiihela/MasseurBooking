import type { ReactElement } from "react";
import { formatSlotDate, formatSlotTime } from "../lib/formatSlotLocal";

interface SlotPickerHeaderProps {
  serviceName: string;
  // The picker's "YYYY-MM-DD" date input value -- the same day GET
  // /availability was asked for.
  date: string;
}

export function SlotPickerHeader({ serviceName, date }: SlotPickerHeaderProps): ReactElement {
  return (
    <div className="slot-picker-header">
      <span>{serviceName}</span>
      <span className="slot-picker-date">{formatSlotDate(date)}</span>
    </div>
  );
}

interface SlotGridProps {
  slots: string[];
  selectedSlot: string | null;
  onSelect: (slot: string) => void;
}

export function SlotGrid({ slots, selectedSlot, onSelect }: SlotGridProps): ReactElement {
  return (
    <div className="slot-grid" role="group" aria-label="Vapaat ajat">
      {slots.map((slot) => {
        const isSelected = slot === selectedSlot;
        return (
          <button
            key={slot}
            type="button"
            className="btn btn-secondary slot-tile"
            data-testid={`slot-option-${slot}`}
            aria-pressed={isSelected}
            onClick={() => onSelect(slot)}
          >
            <span className="slot-tile-line">{formatSlotTime(slot)}</span>
            {isSelected && (
              <span className="slot-tile-line slot-tile-selected-label">
                <span aria-hidden="true">✓ </span>Valittu
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
