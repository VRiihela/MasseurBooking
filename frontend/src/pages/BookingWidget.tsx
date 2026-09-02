import { useEffect, useState, type FormEvent } from "react";
import { ApiError, createBooking, getAvailability, getServices } from "../api/client";
import type { Service } from "../api/types";
import { formatSlotLocal } from "../lib/formatSlotLocal";

type Step = "select-service" | "select-slot" | "form" | "confirmation";

// Not meant to exactly replicate the backend's zod .email() check -- the
// backend is the sole source of truth and re-validates regardless. This is
// just enough to catch obviously malformed input before a round trip.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function todayLocalDateInput(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function BookingWidget() {
  const [step, setStep] = useState<Step>("select-service");

  const [services, setServices] = useState<Service[] | null>(null);
  const [servicesError, setServicesError] = useState<string | null>(null);

  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [date, setDate] = useState(todayLocalDateInput);

  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotTakenMessage, setSlotTakenMessage] = useState<string | null>(null);

  // The exact UTC ISO string as returned by GET /availability -- never
  // reformatted or reconstructed, so it round-trips unmodified into
  // POST /bookings's start_at.
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [confirmedBookingId, setConfirmedBookingId] = useState<string | null>(null);

  useEffect(() => {
    getServices()
      .then(setServices)
      .catch(() => setServicesError("Palveluita ei voitu ladata. Yritä hetken kuluttua uudelleen."));
  }, []);

  async function fetchSlots(serviceId: string, forDate: string) {
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const result = await getAvailability(serviceId, forDate);
      setSlots(result);
    } catch {
      setSlotsError("Vapaita aikoja ei voitu ladata. Yritä hetken kuluttua uudelleen.");
    } finally {
      setSlotsLoading(false);
    }
  }

  function handleSelectService(service: Service) {
    setSelectedService(service);
    setSelectedSlot(null);
    setSlots(null);
    setSlotTakenMessage(null);
    setStep("select-slot");
    void fetchSlots(service.id, date);
  }

  function handleDateChange(newDate: string) {
    setDate(newDate);
    setSelectedSlot(null);
    if (selectedService) {
      void fetchSlots(selectedService.id, newDate);
    }
  }

  function handleSelectSlot(slot: string) {
    setSelectedSlot(slot);
    setFormError(null);
    setStep("form");
  }

  function validateForm(): string | null {
    if (name.trim().length === 0) {
      return "Nimi on pakollinen.";
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      return "Anna kelvollinen sähköpostiosoite.";
    }
    // Mirrors the backend's actual rule (bookingSchema.ts): non-empty only,
    // no format check. Adding a stricter client-only pattern here would
    // reject input the backend accepts.
    if (phone.trim().length === 0) {
      return "Puhelinnumero on pakollinen.";
    }
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedService || !selectedSlot || submitting) {
      return;
    }

    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(null);
    setSubmitting(true);

    try {
      const booking = await createBooking({
        service_id: selectedService.id,
        start_at: selectedSlot,
        customer: { name: name.trim(), email: email.trim(), phone: phone.trim() },
      });
      setConfirmedBookingId(booking.id);
      setStep("confirmation");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSlotTakenMessage("Valitettavasti tuo aika varattiin juuri. Valitse toinen aika.");
        setSelectedSlot(null);
        setStep("select-slot");
        void fetchSlots(selectedService.id, date);
      } else {
        setFormError("Varauksen lähettämisessä tapahtui virhe. Yritä uudelleen.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "confirmation" && confirmedBookingId) {
    return (
      <div className="page">
        <h1>Pyyntö vastaanotettu</h1>
        <div className="card">
          <p data-testid="confirmation-pending">
            Varauspyyntösi on lähetetty ja odottaa hierojan vahvistusta. Varaustasi ei ole vielä
            vahvistettu &mdash; saat viestin, kun pyyntösi on käsitelty.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Varaa aika</h1>

      {step === "select-service" && (
        <section className="card" aria-label="Valitse palvelu">
          {servicesError && <p role="alert">{servicesError}</p>}
          {!servicesError && services === null && <p className="loading-text">Ladataan palveluita&hellip;</p>}
          {services?.map((service) => (
            <button
              key={service.id}
              type="button"
              className="btn btn-secondary"
              data-testid={`service-option-${service.id}`}
              onClick={() => handleSelectService(service)}
            >
              {service.name} &mdash; {service.duration_minutes} min &mdash; {service.price} €
            </button>
          ))}
        </section>
      )}

      {step === "select-slot" && selectedService && (
        <section className="card" aria-label="Valitse päivä ja aika">
          <button type="button" className="btn btn-back" onClick={() => setStep("select-service")}>
            &lsaquo; Takaisin
          </button>
          <p>{selectedService.name}</p>
          {slotTakenMessage && <p role="alert">{slotTakenMessage}</p>}
          <div className="field">
            <label>
              Päivämäärä
              <input
                type="date"
                value={date}
                min={todayLocalDateInput()}
                onChange={(event) => handleDateChange(event.target.value)}
              />
            </label>
          </div>
          {slotsLoading && <p className="loading-text">Ladataan vapaita aikoja&hellip;</p>}
          {slotsError && <p role="alert">{slotsError}</p>}
          {!slotsLoading && !slotsError && slots?.length === 0 && (
            <p>Ei vapaita aikoja tälle päivälle.</p>
          )}
          <div>
            {slots?.map((slot) => (
              <button
                key={slot}
                type="button"
                className="btn btn-secondary btn-block"
                data-testid={`slot-option-${slot}`}
                onClick={() => handleSelectSlot(slot)}
              >
                {formatSlotLocal(slot)}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "form" && selectedService && selectedSlot && (
        <section className="card" aria-label="Omat tiedot">
          <button type="button" className="btn btn-back" onClick={() => setStep("select-slot")}>
            &lsaquo; Takaisin
          </button>
          <p>
            {selectedService.name} &mdash; {formatSlotLocal(selectedSlot)}
          </p>
          <form onSubmit={handleSubmit} noValidate>
            {formError && <p role="alert">{formError}</p>}
            <div className="field">
              <label>
                Nimi
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
            </div>
            <div className="field">
              <label>
                Sähköposti
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
            </div>
            <div className="field">
              <label>
                Puhelin
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  required
                />
              </label>
            </div>
            <button type="submit" className="btn btn-primary" data-testid="submit-booking" disabled={submitting}>
              {submitting ? "Lähetetään…" : "Lähetä varauspyyntö"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
