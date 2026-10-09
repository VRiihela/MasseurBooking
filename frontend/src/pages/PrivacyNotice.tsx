// Legal text: rendered verbatim from task 037's approved content. Do not
// paraphrase or "fix" wording here -- PrivacyNotice.test.tsx guards it.
export function PrivacyNotice() {
  return (
    <div className="page">
      <h1>Tietosuojaseloste</h1>
      <div className="card">
        <p>Päivitetty: [PÄIVÄMÄÄRÄ]</p>

        <h2>1. Rekisterinpitäjä</h2>
        <p>
          [YRITYKSEN NIMI]
          <br />
          Y-tunnus: [Y-TUNNUS]
          <br />
          [OSOITE]
          <br />
          Sähköposti: [SÄHKÖPOSTIOSOITE]
        </p>

        <h2>2. Mitä tietoja käsittelemme</h2>
        <p>Kun teet ajanvarauksen, käsittelemme seuraavia tietoja:</p>
        <ul>
          <li>Nimi</li>
          <li>Sähköpostiosoite</li>
          <li>Puhelinnumero</li>
          <li>Varauksen tiedot (palvelu, ajankohta, tila)</li>
        </ul>

        <h2>3. Käsittelyn tarkoitus ja oikeusperuste</h2>
        <p>
          Käsittelemme tietojasi ajanvarauksen tekemistä ja hoitamista varten: varausvahvistukset, muutokset ja
          peruutukset. Käsittelyn oikeusperuste on sopimuksen täytäntöönpano – tietojen antaminen on edellytys
          ajanvarauksen tekemiselle.
        </p>

        <h2>4. Kuinka kauan säilytämme tietoja</h2>
        <ul>
          <li>
            Vahvistettu varaus: nimi-, sähköposti- ja puhelinnumerotiedot korvataan automaattisesti merkinnällä
            &quot;Poistettu GDPR-syistä&quot; kolmen kuukauden kuluttua varatusta ajankohdasta. Itse varaustieto
            (palvelu, ajankohta, tila) säilyy kirjanpitoa varten ilman henkilötietoja.
          </li>
          <li>
            Käsittelemätön tai peruutettu varaus: koko varaustieto poistetaan kokonaan kuukauden kuluttua varatusta
            ajankohdasta, koska tietoa ei enää tarvita.
          </li>
        </ul>

        <h2>5. Kenelle tietoja luovutetaan</h2>
        <p>Käytämme seuraavia palveluntarjoajia varauksen käsittelyyn:</p>
        <ul>
          <li>
            Resend (sähköpostien lähetys, Yhdysvallat) – [VILLE: vahvista Resendin kanssa EU:n komission hyväksymien
            vakiosopimuslausekkeiden käyttö EU/ETA-alueen ulkopuolelle tapahtuvassa siirrossa]
          </li>
          <li>Railway (verkkosivun, taustapalvelun ja tietokannan isännöinti)</li>
        </ul>
        <p>Tietoja ei myydä tai luovuteta muihin tarkoituksiin.</p>

        <h2>6. Oikeutesi</h2>
        <p>Sinulla on oikeus:</p>
        <ul>
          <li>tarkastaa, mitä tietoja sinusta on tallennettu</li>
          <li>pyytää tietojen oikaisua</li>
          <li>pyytää tietojen poistamista</li>
          <li>vastustaa käsittelyä</li>
          <li>tehdä valitus valvontaviranomaiselle</li>
        </ul>
        <p>Ota yhteyttä käyttämällä yllä olevaa sähköpostiosoitetta.</p>
        <p>Valvontaviranomainen: Tietosuojavaltuutetun toimisto, tietosuoja@om.fi, https://tietosuoja.fi</p>

        <h2>7. Automaattinen päätöksenteko</h2>
        <p>Emme tee automaattista päätöksentekoa tai profilointia tiedoillasi.</p>
      </div>
    </div>
  );
}
