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
      setFormError("Anna kelvollinen sähköpostiosoite.");
      return;
    }
    setFormError(null);
    setSubmitting(true);

    try {
      const response = await requestLoginLink(email.trim());
      setResultMessage(response.message);
    } catch {
      setFormError("Kirjautumislinkin pyytämisessä tapahtui virhe. Yritä uudelleen.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <h1>Hierojan kirjautuminen</h1>
      <div className="card">
        {resultMessage ? (
          <p role="status">{resultMessage}</p>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            {formError && <p role="alert">{formError}</p>}
            <div className="field">
              <label>
                Sähköposti
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
            </div>
            <button type="submit" className="btn btn-primary" data-testid="request-login-link" disabled={submitting}>
              {submitting ? "Lähetetään…" : "Lähetä kirjautumislinkki"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
