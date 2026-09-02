import type {
  BookingEmailPayload,
  EmailJobPayload,
  EmailJobType,
  MasseurBookingChangeEmailPayload,
  MasseurLoginLinkEmailPayload,
} from "../db/types.js";
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
    subject: `Varauspyyntösi palveluun ${payload.serviceName} on vastaanotettu`,
    body: `Hei ${name},

Olemme vastaanottaneet varauspyyntösi palveluun ${payload.serviceName} ajankohta: ${payload.startAtLocal}.
Hieroja vahvistaa tai hylkää pyynnön pian -- saat siitä uuden sähköpostiviestin heti kun päätös on tehty.

Hallinnoi varaustasi: ${payload.manageUrl}

Varausnumero: ${payload.bookingId}`,
  };
}

function renderConfirmed(payload: BookingEmailPayload): EmailMessage {
  const name = sanitizeForSubject(payload.customerName);
  return {
    to: payload.customerEmail,
    subject: `Varauksesi palveluun ${payload.serviceName} on vahvistettu`,
    body: `Hei ${name},

Hyviä uutisia -- varauksesi palveluun ${payload.serviceName} ajankohta: ${payload.startAtLocal} on vahvistettu.

Hallinnoi varaustasi: ${payload.manageUrl}

Varausnumero: ${payload.bookingId}`,
  };
}

function renderDeclined(payload: BookingEmailPayload): EmailMessage {
  const name = sanitizeForSubject(payload.customerName);
  const reasonLine = payload.cancellationReason
    ? `\nSyy: ${sanitizeForSubject(payload.cancellationReason)}\n`
    : "";
  return {
    to: payload.customerEmail,
    subject: `Varauspyyntöäsi palveluun ${payload.serviceName} ei valitettavasti voitu toteuttaa`,
    body: `Hei ${name},

Valitettavasti pyyntöäsi palveluun ${payload.serviceName} ajankohta: ${payload.startAtLocal} ei voitu toteuttaa.
${reasonLine}
Hallinnoi varaustasi: ${payload.manageUrl}

Varausnumero: ${payload.bookingId}`,
  };
}

function renderCancelledByCustomer(payload: BookingEmailPayload): EmailMessage {
  const name = sanitizeForSubject(payload.customerName);
  return {
    to: payload.customerEmail,
    subject: `Varauksesi palveluun ${payload.serviceName} on peruttu`,
    body: `Hei ${name},

Pyyntösi mukaisesti varauksesi palveluun ${payload.serviceName} ajankohta: ${payload.startAtLocal} on peruttu.

Hallinnoi varaustasi: ${payload.manageUrl}

Varausnumero: ${payload.bookingId}`,
  };
}

function renderCancelledByMasseur(payload: BookingEmailPayload): EmailMessage {
  const name = sanitizeForSubject(payload.customerName);
  const reasonLine = payload.cancellationReason
    ? `\nSyy: ${sanitizeForSubject(payload.cancellationReason)}\n`
    : "";
  return {
    to: payload.customerEmail,
    subject: `Aikasi palveluun ${payload.serviceName} on peruttu`,
    body: `Hei ${name},

Valitettavasti vahvistettu varauksesi palveluun ${payload.serviceName} ajankohta: ${payload.startAtLocal} on jouduttu perumaan.
${reasonLine}
Hallinnoi varaustasi: ${payload.manageUrl}

Varausnumero: ${payload.bookingId}`,
  };
}

function renderMasseurBookingChangeNotice(payload: MasseurBookingChangeEmailPayload): EmailMessage {
  const reasonLine = payload.cancellationReason
    ? `Syy: ${sanitizeForSubject(payload.cancellationReason)}\n`
    : "";
  return {
    to: payload.adminEmail,
    subject: `Aikataulumuutos -- ${payload.serviceName} ajankohta: ${payload.startAtLocal}`,
    body: `Asiakas muutti juuri varausta aikataulussasi.

${payload.serviceName} ajankohta: ${payload.startAtLocal} ei ole enää varattu -- kyseinen aika on nyt vapaa.
${reasonLine}
Varausnumero: ${payload.bookingId}`,
  };
}

function renderMasseurLoginLink(payload: MasseurLoginLinkEmailPayload): EmailMessage {
  return {
    to: payload.adminEmail,
    subject: "Kirjautumislinkkisi hallintapaneeliin",
    body: `Kirjaudu sisään alla olevasta linkistä. Linkki vanhenee 15 minuutissa ja sen voi käyttää vain kerran.

${payload.loginUrl}

Jos et pyytänyt tätä, voit jättää tämän viestin huomiotta.`,
  };
}

export function renderEmail(type: EmailJobType, payload: EmailJobPayload): EmailMessage {
  switch (type) {
    case "booking_request_received":
      return renderRequestReceived(payload as BookingEmailPayload);
    case "booking_confirmed":
      return renderConfirmed(payload as BookingEmailPayload);
    case "booking_declined":
      return renderDeclined(payload as BookingEmailPayload);
    case "booking_cancelled_by_customer":
      return renderCancelledByCustomer(payload as BookingEmailPayload);
    case "booking_cancelled_by_masseur":
      return renderCancelledByMasseur(payload as BookingEmailPayload);
    case "masseur_booking_change_notice":
      return renderMasseurBookingChangeNotice(payload as MasseurBookingChangeEmailPayload);
    case "masseur_login_link":
      return renderMasseurLoginLink(payload as MasseurLoginLinkEmailPayload);
  }
}
