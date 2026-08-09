import { useEffect, useState, type FormEvent } from "react";
import { ApiError, createBooking, getAvailability, getServices } from "../api/client";
import type { Service } from "../api/types";

type Step = "select-service" | "select-slot" | "form" | "confirmation";

// Not meant to exactly replicate the backend's zod .email() check -- the
// backend is the sole source of truth and re-validates regardless. This is
// just enough to catch obviously malformed input before a round trip.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatSlotLocal(isoUtc: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoUtc));
}

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
      .catch(() => setServicesError("Could not load services. Please try again shortly."));
  }, []);

  async function fetchSlots(serviceId: string, forDate: string) {
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const result = await getAvailability(serviceId, forDate);
      setSlots(result);
    } catch {
      setSlotsError("Could not load available slots. Please try again shortly.");
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
      return "Name is required.";
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      return "Enter a valid email address.";
    }
    // Mirrors the backend's actual rule (bookingSchema.ts): non-empty only,
    // no format check. Adding a stricter client-only pattern here would
    // reject input the backend accepts.
    if (phone.trim().length === 0) {
      return "Phone is required.";
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
        setSlotTakenMessage("Sorry, that slot was just taken. Please pick another time.");
        setSelectedSlot(null);
        setStep("select-slot");
        void fetchSlots(selectedService.id, date);
      } else {
        setFormError("Something went wrong submitting your booking. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "confirmation" && confirmedBookingId) {
    return (
      <div>
        <h1>Request received</h1>
        <p data-testid="confirmation-pending">
          Your booking request has been sent and is awaiting the masseur&rsquo;s confirmation.
          You are not booked yet &mdash; you&rsquo;ll hear back once it&rsquo;s been reviewed.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Book a session</h1>

      {step === "select-service" && (
        <section aria-label="Choose a service">
          {servicesError && <p role="alert">{servicesError}</p>}
          {!servicesError && services === null && <p>Loading services&hellip;</p>}
          {services?.map((service) => (
            <button
              key={service.id}
              type="button"
              data-testid={`service-option-${service.id}`}
              onClick={() => handleSelectService(service)}
            >
              {service.name} &mdash; {service.duration_minutes} min &mdash; {service.price}
            </button>
          ))}
        </section>
      )}

      {step === "select-slot" && selectedService && (
        <section aria-label="Choose a date and time">
          <button type="button" onClick={() => setStep("select-service")}>
            Back
          </button>
          <p>{selectedService.name}</p>
          {slotTakenMessage && <p role="alert">{slotTakenMessage}</p>}
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(event) => handleDateChange(event.target.value)}
            />
          </label>
          {slotsLoading && <p>Loading available times&hellip;</p>}
          {slotsError && <p role="alert">{slotsError}</p>}
          {!slotsLoading && !slotsError && slots?.length === 0 && (
            <p>No available times on this date.</p>
          )}
          <div>
            {slots?.map((slot) => (
              <button
                key={slot}
                type="button"
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
        <section aria-label="Your details">
          <button type="button" onClick={() => setStep("select-slot")}>
            Back
          </button>
          <p>
            {selectedService.name} &mdash; {formatSlotLocal(selectedSlot)}
          </p>
          <form onSubmit={handleSubmit} noValidate>
            {formError && <p role="alert">{formError}</p>}
            <label>
              Name
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Phone
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
              />
            </label>
            <button type="submit" data-testid="submit-booking" disabled={submitting}>
              {submitting ? "Submitting…" : "Request booking"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
