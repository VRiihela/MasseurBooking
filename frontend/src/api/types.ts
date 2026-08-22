export interface Service {
  id: string;
  name: string;
  price: number;
  duration_minutes: number;
}

export interface CreateBookingRequest {
  service_id: string;
  start_at: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
}

export interface CreateBookingResponse {
  id: string;
  status: "pending";
  start_at: string;
  end_at: string;
}

export type AdminBookingStatus = "pending" | "confirmed" | "cancelled";

// "all" is a frontend-only filter value meaning "omit the status query param" --
// the backend's adminBookingsQuerySchema has no such value on the wire.
export type AdminBookingStatusFilter = AdminBookingStatus | "all";

export interface AdminBooking {
  id: string;
  status: AdminBookingStatus;
  service_name: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  start_at: string;
  end_at: string;
  start_at_local: string;
  end_at_local: string;
  created_at: string;
}

export interface LoginRequestResponse {
  message: string;
}

export interface ExchangeLoginTokenResponse {
  token: string;
}

export interface LogoutResponse {
  message: string;
}

export interface ConfirmBookingResponse {
  id: string;
  status: AdminBookingStatus;
  confirmed_at: string | null;
}

export interface DeclineBookingResponse {
  id: string;
  status: AdminBookingStatus;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

export interface CustomerBookingView {
  id: string;
  status: AdminBookingStatus;
  service_id: string;
  service_name: string;
  start_at_local: string;
  end_at_local: string;
}

export interface CancelBookingResponse {
  id: string;
  status: AdminBookingStatus;
  cancelled_at: string | null;
}

export interface RescheduleBookingResponse {
  id: string;
  status: "pending";
  start_at: string;
  end_at: string;
}
