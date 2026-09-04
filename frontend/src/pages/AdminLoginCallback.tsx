import { useEffect, useState } from "react";
import { ApiError, exchangeLoginToken, setStoredSessionToken } from "../api/client";

type Status = "exchanging" | "missing-token" | "error";

function RequestNewLinkLink() {
  return <a href="/admin">Pyydä uusi kirjautumislinkki</a>;
}

export function AdminLoginCallback() {
  const [status, setStatus] = useState<Status>("exchanging");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("missing-token");
      return;
    }

    exchangeLoginToken(token)
      .then((response) => {
        setStoredSessionToken(response.token);
        window.location.assign("/admin");
      })
      .catch((error: unknown) => {
        setErrorMessage(
          error instanceof ApiError ? error.message : "Kirjautumislinkkiäsi ei voitu vahvistaa.",
        );
        setStatus("error");
      });
  }, []);

  if (status === "missing-token") {
    return (
      <div className="page">
        <h1>Virheellinen kirjautumislinkki</h1>
        <p role="alert">Tästä kirjautumislinkistä puuttuu sen tunniste.</p>
        <RequestNewLinkLink />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="page">
        <h1>Ongelma kirjautumislinkissä</h1>
        <p role="alert">{errorMessage}</p>
        <RequestNewLinkLink />
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Kirjaudutaan sisään&hellip;</h1>
    </div>
  );
}
