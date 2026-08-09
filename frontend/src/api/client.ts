import type { CreateBookingRequest, CreateBookingResponse, Service } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

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
