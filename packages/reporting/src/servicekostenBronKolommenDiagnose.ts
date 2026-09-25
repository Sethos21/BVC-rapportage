/**
 * Servicekosten-bronkolommen-diagnose (2026-08-26) — TIJDELIJK,
 * ALLEEN-LEZEN, en voorafgaand aan `servicekostenDiagnose.ts`: de gebruiker
 * gaf aan dat `Service_BK_Kostensoort` NIET hetzelfde concept is als een
 * grootboekrekening (bekende structuur: grootboek 1712 = werkelijke
 * servicekosten per kostensoort, grootboek 1711 + kostensoort 2000 =
 * vooraf ontvangen voorschotten, kostensoort 9600 = afrekening voorgaand
 * jaar). `ServicekostenregelBronSchema` (`@bvc/data-contracts`) modelleert
 * maar 16 van de gerapporteerde ~111 bronkolommen — vóórdat een join met
 * `boekingen` (of een schema-uitbreiding) gebouwd wordt, moet eerst
 * vastgesteld worden of de RUWE bron zelf al een grootboekrekening-achtig
 * veld bevat (rekeningnummer/grootboeknr/GL-account/Informant-equivalent).
 *
 * Werkt bewust op de RUWE, ongevalideerde rijen (vóór Zod-parsing) — dat is
 * precies het punt: kolommen die niet in het schema staan, zijn na parsing
 * al verdwenen. Telt en toont per kolom alleen wat er is (aantal
 * niet-lege waarden, een paar distincte voorbeeldwaarden) — classificeert
 * niets, voegt niets toe aan schema/cache/domain.
 */

export interface ServicekostenBronKolomOverzicht {
  kolom: string;
  aantalNietLegeWaarden: number;
  /** Maximaal 5 distincte, niet-lege waarden, in volgorde van voorkomen — puur ter inspectie. */
  voorbeeldwaarden: string[];
  /** true als deze kolomnaam al in `ServicekostenregelBronSchema` staat (dus al in cache/domain terechtkomt). */
  reedsGemodelleerd: boolean;
}

export interface ServicekostenBronKolommenDiagnoseResultaat {
  aantalRijen: number;
  kolommen: ServicekostenBronKolomOverzicht[];
}

function isLeeg(waarde: unknown): boolean {
  return waarde === null || waarde === undefined || waarde === "";
}

export function inventariseerServicekostenBronKolommen(
  ruweRijen: readonly Record<string, unknown>[],
  reedsGemodelleerdeKolommen: readonly string[],
): ServicekostenBronKolommenDiagnoseResultaat {
  const alleKolommen = new Set<string>();
  for (const rij of ruweRijen) {
    for (const kolom of Object.keys(rij)) alleKolommen.add(kolom);
  }

  const bekendeKolommenSet = new Set(reedsGemodelleerdeKolommen);
  const kolommen: ServicekostenBronKolomOverzicht[] = Array.from(alleKolommen)
    .sort()
    .map((kolom) => {
      let aantalNietLegeWaarden = 0;
      const voorbeeldwaarden: string[] = [];
      const gezien = new Set<string>();
      for (const rij of ruweRijen) {
        const waarde = rij[kolom];
        if (isLeeg(waarde)) continue;
        aantalNietLegeWaarden += 1;
        const tekst = String(waarde);
        if (voorbeeldwaarden.length < 5 && !gezien.has(tekst)) {
          gezien.add(tekst);
          voorbeeldwaarden.push(tekst);
        }
      }
      return { kolom, aantalNietLegeWaarden, voorbeeldwaarden, reedsGemodelleerd: bekendeKolommenSet.has(kolom) };
    });

  return { aantalRijen: ruweRijen.length, kolommen };
}
