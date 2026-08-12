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
  name: string;
  price: number | null;
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
  | "booking_declined"
  | "booking_cancelled_by_customer"
  | "booking_cancelled_by_masseur"
  | "masseur_booking_change_notice"
  | "masseur_login_link";

export type EmailJobStatus = "queued" | "sending" | "sent" | "failed";

export interface EmailJob {
  id: string;
  type: EmailJobType;
  payload: Record<string, unknown>;
  status: EmailJobStatus;
  createdAt: Date;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  nextAttemptAt: Date;
  claimedAt: Date | null;
}

export interface BookingEmailPayload {
  bookingId: string;
  customerEmail: string;
  customerName: string;
  serviceName: string;
  startAtLocal: string;
  cancellationReason?: string | null;
  manageUrl: string;
}

export interface MasseurLoginLinkEmailPayload {
  adminEmail: string;
  loginUrl: string;
}

/**
 * Sent to ADMIN_EMAIL whenever a customer action (cancel, or the cancel half
 * of a reschedule) frees a slot on the masseur's schedule. No token/link --
 * the masseur acts through their own authenticated admin session, not a
 * customer magic link.
 */
export interface MasseurBookingChangeEmailPayload {
  adminEmail: string;
  bookingId: string;
  serviceName: string;
  startAtLocal: string;
  cancellationReason: string | null;
}

export type EmailJobPayload =
  | BookingEmailPayload
  | MasseurLoginLinkEmailPayload
  | MasseurBookingChangeEmailPayload;
