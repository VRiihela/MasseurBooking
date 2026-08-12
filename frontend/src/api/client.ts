import type {
  AdminBooking,
  AdminBookingStatusFilter,
  CancelBookingResponse,
  ConfirmBookingResponse,
  CreateBookingRequest,
  CreateBookingResponse,
  CustomerBookingView,
  DeclineBookingResponse,
  ExchangeLoginTokenResponse,
  LoginRequestResponse,
  LogoutResponse,
  RescheduleBookingResponse,
  Service,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const SESSION_TOKEN_STORAGE_KEY = "masseurSessionToken";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "Request failed";
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

export function getStoredSessionToken(): string | null {
  return localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
}

export function setStoredSessionToken(token: string): void {
  localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
}

export function clearStoredSessionToken(): void {
  localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
}

// Attaches the stored bearer token to every call and clears it on any 401 --
// the one place session expiry is detected, so every admin view reacts the
// same way instead of each call site re-implementing the check.
async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredSessionToken();
  try {
    return await request<T>(path, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearStoredSessionToken();
    }
    throw error;
  }
}

export function getServices(): Promise<Service[]> {
  return request<Service[]>("/services");
}

export function getAvailability(serviceId: string, date: string): Promise<string[]> {
  const params = new URLSearchParams({ service_id: serviceId, date });
  return request<string[]>(`/availability?${params.toString()}`);
}

export function createBooking(payload: CreateBookingRequest): Promise<CreateBookingResponse> {
  return request<CreateBookingResponse>("/bookings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function requestLoginLink(email: string): Promise<LoginRequestResponse> {
  return request<LoginRequestResponse>("/auth/login-request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function exchangeLoginToken(token: string): Promise<ExchangeLoginTokenResponse> {
  const params = new URLSearchParams({ token });
  return request<ExchangeLoginTokenResponse>(`/auth/login?${params.toString()}`);
}

export function logout(): Promise<LogoutResponse> {
  return authRequest<LogoutResponse>("/auth/logout", { method: "POST" });
}

export function getAdminBookings(status?: AdminBookingStatusFilter): Promise<AdminBooking[]> {
  const params = status && status !== "all" ? `?${new URLSearchParams({ status }).toString()}` : "";
  return authRequest<AdminBooking[]>(`/admin/bookings${params}`);
}

export function confirmBooking(id: string): Promise<ConfirmBookingResponse> {
  return authRequest<ConfirmBookingResponse>(`/bookings/${id}/confirm`, { method: "POST" });
}

export function declineBooking(id: string, reason?: string): Promise<DeclineBookingResponse> {
  const trimmedReason = reason?.trim();
  return authRequest<DeclineBookingResponse>(`/bookings/${id}/decline`, {
    method: "POST",
    body: JSON.stringify(trimmedReason ? { reason: trimmedReason } : {}),
  });
}

// Masseur cancelling a booking they already confirmed -- distinct from the
// customer's own token-based cancelBooking below, which uses a completely
// different auth model (possession of a magic-link token, not a session).
export function cancelBookingAsAdmin(id: string, reason?: string): Promise<DeclineBookingResponse> {
  const trimmedReason = reason?.trim();
  return authRequest<DeclineBookingResponse>(`/admin/bookings/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify(trimmedReason ? { reason: trimmedReason } : {}),
  });
}

// These three take the raw customer token as a query param, not an
// Authorization header -- it's a non-expiring, multi-use, possession-based
// token (task 007), not a bearer session, and is never persisted to
// localStorage like the masseur session token.
export function getBookingForCustomer(id: string, token: string): Promise<CustomerBookingView> {
  const params = new URLSearchParams({ token });
  return request<CustomerBookingView>(`/bookings/${id}?${params.toString()}`);
}

export function cancelBooking(id: string, token: string): Promise<CancelBookingResponse> {
  const params = new URLSearchParams({ token });
  return request<CancelBookingResponse>(`/bookings/${id}/cancel?${params.toString()}`, {
    method: "POST",
  });
}

export function rescheduleBooking(
  id: string,
  token: string,
  newStartAt: string,
): Promise<RescheduleBookingResponse> {
  const params = new URLSearchParams({ token });
  return request<RescheduleBookingResponse>(`/bookings/${id}/reschedule?${params.toString()}`, {
    method: "POST",
    body: JSON.stringify({ newStartAt }),
  });
}
