import { useEffect, useState } from "react";
import { ApiError, exchangeLoginToken, setStoredSessionToken } from "../api/client";

type Status = "exchanging" | "missing-token" | "error";

function RequestNewLinkLink() {
  return <a href="/admin">Request a new login link</a>;
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
          error instanceof ApiError ? error.message : "Could not verify your login link.",
        );
        setStatus("error");
      });
  }, []);

  if (status === "missing-token") {
    return (
      <div>
        <h1>Invalid login link</h1>
        <p role="alert">This login link is missing its token.</p>
        <RequestNewLinkLink />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div>
        <h1>Login link problem</h1>
        <p role="alert">{errorMessage}</p>
        <RequestNewLinkLink />
      </div>
    );
  }

  return (
    <div>
      <h1>Signing you in&hellip;</h1>
    </div>
  );
}
