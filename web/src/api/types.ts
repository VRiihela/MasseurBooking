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
