import type { BookingEmailPayload, EmailJobType } from "../db/types.js";
import type { EmailMessage } from "./emailSender.js";

/**
 * Emails are plain text, not HTML, so there's no markup to escape. The only
 * risk left is a crafted multi-line value (customerName, cancellationReason)
 * making the subject line look like something it isn't -- strip control
 * characters (newlines, carriage returns, other C0 codes) as defense in depth.
 */
function sanitizeForSubject(value: string): string {
  // eslint-disable-next-line no-control-regex -- intentionally matching C0 control chars to strip them
  return value.replace(/[\x00-\x1F\x7F]+/g, " ").trim();
}

function renderRequestReceived(payload: BookingEmailPayload): EmailMessage {
  const name = sanitizeForSubject(payload.customerName);
  return {
    to: payload.customerEmail,
    subject: `Your ${payload.serviceName} booking request has been received`,
    body: `Hi ${name},

We've received your request for ${payload.serviceName} on ${payload.startAtLocal}.
The masseur will confirm or decline it shortly -- you'll get another email as soon as they do.

Booking reference: ${payload.bookingId}`,
  };
}

function renderConfirmed(payload: BookingEmailPayload): EmailMessage {
  const name = sanitizeForSubject(payload.customerName);
  return {
    to: payload.customerEmail,
    subject: `Your ${payload.serviceName} booking is confirmed`,
    body: `Hi ${name},

Good news -- your ${payload.serviceName} appointment on ${payload.startAtLocal} is confirmed.

Booking reference: ${payload.bookingId}`,
  };
}

function renderDeclined(payload: BookingEmailPayload): EmailMessage {
  const name = sanitizeForSubject(payload.customerName);
  const reasonLine = payload.cancellationReason
    ? `\nReason: ${sanitizeForSubject(payload.cancellationReason)}\n`
    : "";
  return {
    to: payload.customerEmail,
    subject: `Your ${payload.serviceName} booking request could not be accommodated`,
    body: `Hi ${name},

Unfortunately your request for ${payload.serviceName} on ${payload.startAtLocal} could not be accommodated.
${reasonLine}
Booking reference: ${payload.bookingId}`,
  };
}

export function renderEmail(type: EmailJobType, payload: BookingEmailPayload): EmailMessage {
  switch (type) {
    case "booking_request_received":
      return renderRequestReceived(payload);
    case "booking_confirmed":
      return renderConfirmed(payload);
    case "booking_declined":
      return renderDeclined(payload);
  }
}
