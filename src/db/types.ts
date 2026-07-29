export type BookingStatus = "pending" | "confirmed" | "cancelled";

export interface Provider {
  id: string;
  name: string;
  timezone: string;
}

export type AvailabilityExceptionType = "blocked" | "open";

export interface AvailabilityRule {
  id: string;
  providerId: string;
  weekday: number; // ISO 8601: 1 = Monday .. 7 = Sunday
  startTime: string; // "HH:MM:SS" local wall time
  endTime: string;
}

export interface AvailabilityException {
  id: string;
  providerId: string;
  date: string; // "YYYY-MM-DD"
  type: AvailabilityExceptionType;
  startTime: string;
  endTime: string;
}

export interface Service {
  id: string;
  providerId: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface Booking {
  id: string;
  providerId: string;
  serviceId: string;
  customerId: string;
  startAt: Date;
  endAt: Date;
  status: BookingStatus;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
}

export type EmailJobType =
  | "booking_request_received"
  | "booking_confirmed"
  | "booking_declined";

export interface EmailJob {
  id: string;
  type: EmailJobType;
  payload: Record<string, unknown>;
  status: "queued" | "sent" | "failed";
  createdAt: Date;
}
