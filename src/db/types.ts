export type BookingStatus = "pending" | "confirmed" | "cancelled";

export interface Provider {
  id: string;
  name: string;
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
}

export interface EmailJob {
  id: string;
  type: "booking_request_received";
  payload: Record<string, unknown>;
  status: "queued" | "sent" | "failed";
  createdAt: Date;
}
