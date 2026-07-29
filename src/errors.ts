export class AppError extends Error {
  readonly statusCode: number;
  readonly clientMessage: string;

  constructor(statusCode: number, clientMessage: string) {
    super(clientMessage);
    this.statusCode = statusCode;
    this.clientMessage = clientMessage;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}

export class ServiceNotFoundError extends AppError {
  constructor() {
    super(404, "Service not found");
  }
}

export class SlotUnavailableError extends AppError {
  constructor() {
    super(409, "slot no longer available");
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super(401, "Unauthorized");
  }
}

export class BookingNotFoundError extends AppError {
  constructor() {
    super(404, "Booking not found");
  }
}

export class BookingNotPendingError extends AppError {
  constructor() {
    super(409, "Booking is not pending");
  }
}
