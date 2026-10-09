import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "../src/App";

// Approved content from agents/tasks/037-privacy-notice-page.json, with the
// one approved deviation applied: ASCII "--" rendered as an en dash.
const APPROVED_CONTENT = "# Tietosuojaseloste\n\nPäivitetty: [PÄIVÄMÄÄRÄ]\n\n## 1. Rekisterinpitäjä\n\n[YRITYKSEN NIMI]\nY-tunnus: [Y-TUNNUS]\n[OSOITE]\nSähköposti: [SÄHKÖPOSTIOSOITE]\n\n## 2. Mitä tietoja käsittelemme\n\nKun teet ajanvarauksen, käsittelemme seuraavia tietoja:\n\n- Nimi\n- Sähköpostiosoite\n- Puhelinnumero\n- Varauksen tiedot (palvelu, ajankohta, tila)\n\n## 3. Käsittelyn tarkoitus ja oikeusperuste\n\nKäsittelemme tietojasi ajanvarauksen tekemistä ja hoitamista varten: varausvahvistukset, muutokset ja peruutukset. Käsittelyn oikeusperuste on sopimuksen täytäntöönpano – tietojen antaminen on edellytys ajanvarauksen tekemiselle.\n\n## 4. Kuinka kauan säilytämme tietoja\n\n- Vahvistettu varaus: nimi-, sähköposti- ja puhelinnumerotiedot korvataan automaattisesti merkinnällä \"Poistettu GDPR-syistä\" kolmen kuukauden kuluttua varatusta ajankohdasta. Itse varaustieto (palvelu, ajankohta, tila) säilyy kirjanpitoa varten ilman henkilötietoja.\n- Käsittelemätön tai peruutettu varaus: koko varaustieto poistetaan kokonaan kuukauden kuluttua varatusta ajankohdasta, koska tietoa ei enää tarvita.\n\n## 5. Kenelle tietoja luovutetaan\n\nKäytämme seuraavia palveluntarjoajia varauksen käsittelyyn:\n\n- Resend (sähköpostien lähetys, Yhdysvallat) – [VILLE: vahvista Resendin kanssa EU:n komission hyväksymien vakiosopimuslausekkeiden käyttö EU/ETA-alueen ulkopuolelle tapahtuvassa siirrossa]\n- Railway (verkkosivun, taustapalvelun ja tietokannan isännöinti)\n\nTietoja ei myydä tai luovuteta muihin tarkoituksiin.\n\n## 6. Oikeutesi\n\nSinulla on oikeus:\n\n- tarkastaa, mitä tietoja sinusta on tallennettu\n- pyytää tietojen oikaisua\n- pyytää tietojen poistamista\n- vastustaa käsittelyä\n- tehdä valitus valvontaviranomaiselle\n\nOta yhteyttä käyttämällä yllä olevaa sähköpostiosoitetta.\n\nValvontaviranomainen: Tietosuojavaltuutetun toimisto, tietosuoja@om.fi, https://tietosuoja.fi\n\n## 7. Automaattinen päätöksenteko\n\nEmme tee automaattista päätöksentekoa tai profilointia tiedoillasi.";

function expectedLines(): string[] {
  return APPROVED_CONTENT.split("\n")
    .map((line) => line.replace(/^(#{1,2} |- )/, "").trim())
    .filter((line) => line.length > 0);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("PrivacyNotice", () => {
  function renderAtPrivacyPath() {
    window.history.pushState({}, "", "/tietosuoja");
    render(<App />);
  }

  it("is routed at /tietosuoja instead of the booking widget", () => {
    renderAtPrivacyPath();

    expect(screen.getByRole("heading", { level: 1, name: "Tietosuojaseloste" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Varaa aika" })).not.toBeInTheDocument();
  });

  it("renders every line of the approved content verbatim", () => {
    renderAtPrivacyPath();

    const pageText = normalize(document.body.textContent ?? "");
    for (const line of expectedLines()) {
      expect(pageText).toContain(normalize(line));
    }
  });

  it("renders nothing beyond the approved content", () => {
    renderAtPrivacyPath();

    // Whitespace is dropped on both sides because <br>/block boundaries add
    // none to textContent; this still catches any added, removed or changed
    // character.
    const stripWhitespace = (text: string) => text.replace(/\s+/g, "");
    const pageText = document.querySelector(".page")?.textContent ?? "";
    expect(stripWhitespace(pageText)).toBe(stripWhitespace(expectedLines().join("")));
  });

  it("keeps all placeholders unfilled", () => {
    renderAtPrivacyPath();

    const pageText = document.body.textContent ?? "";
    for (const placeholder of [
      "[YRITYKSEN NIMI]",
      "[Y-TUNNUS]",
      "[OSOITE]",
      "[SÄHKÖPOSTIOSOITE]",
      "[PÄIVÄMÄÄRÄ]",
      "[VILLE: vahvista Resendin kanssa",
    ]) {
      expect(pageText).toContain(placeholder);
    }
  });

  it("contains no ASCII double hyphens and no links", () => {
    renderAtPrivacyPath();

    expect(document.body.textContent).not.toContain("--");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("uses the shared page and card layout", () => {
    renderAtPrivacyPath();

    expect(document.querySelector(".page .card")).not.toBeNull();
  });
});
