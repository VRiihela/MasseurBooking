import { useState, type FormEvent } from "react";
import { requestLoginLink } from "../api/client";

// Not meant to exactly replicate the backend's zod .email() check -- the
// backend is the sole source of truth and re-validates regardless. This is
// just enough to catch obviously malformed input before a round trip.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AdminLoginRequest() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Shown verbatim from the backend and never branched on outcome -- the
  // backend's own contract is that this message is identical whether or not
  // the email is registered.
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    if (!EMAIL_PATTERN.test(email.trim())) {
      setFormError("Enter a valid email address.");
      return;
    }
    setFormError(null);
    setSubmitting(true);

    try {
      const response = await requestLoginLink(email.trim());
      setResultMessage(response.message);
    } catch {
      setFormError("Something went wrong requesting your login link. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Masseur login</h1>
      {resultMessage ? (
        <p role="status">{resultMessage}</p>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          {formError && <p role="alert">{formError}</p>}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <button type="submit" data-testid="request-login-link" disabled={submitting}>
            {submitting ? "Sending…" : "Send login link"}
          </button>
        </form>
      )}
    </div>
  );
}
