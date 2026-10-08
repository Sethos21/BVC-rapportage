import Decimal from "decimal.js";
import { bepaalWozHistorie, type BgWozHistorieFilter, type BgWozObjectInvoer } from "./begroteGemeentelijkeLasten.js";

/**
 * WOZ-historie CSV-export (Master Contract §6.8, besluiten 2026-09-25; UX §9.2).
 *
 * KOLOMMEN (vastgesteld, exact deze volgorde en namen): Administratie | Complex |
 * Unit/Geheel complex | Aanslagjaar | Waardepeildatum | Werkelijke WOZ |
 * Verschil € vorig jaar | Verschil % vorig jaar. Filters op complex en periode
 * (aanslagjaar, grenzen inclusief) lopen via `bepaalWozHistorie`; de ontwikkeling wordt
 * dus op de volledige historie van het object berekend en pas daarna gefilterd.
 *
 * BESCHIKBAARHEID: "Zonder bevestigde historie blijft export zichtbaar maar uitgeschakeld"
 * (UX §9.2) — bij een niet-bevestigde WOZ-set is het resultaat `beschikbaar: false` en wordt
 * geen CSV opgebouwd.
 *
 * FORMAAT (vastgesteld besluit 2026-09-25, vervolgtranche 3): scheidingsteken `;`, DECIMALE
 * KOMMA in alle getalcellen, datums als ISO `YYYY-MM-DD`, CRLF, LEGE cel voor onbekend/n.v.t.
 * (eerste jaar, of voorgaande waarde niet positief — nooit 0), en formule-injectiebescherming:
 * tekstcellen (administratie/complex/unit) die met `=`, `+`, `@`, tab of CR beginnen krijgen een
 * voorloop-`'`. Het PERCENTAGE wordt uitsluitend IN DE EXPORT op 2 decimalen afgerond (half-up,
 * altijd 2 decimalen, bv. `5,00`); de onderliggende berekening (`bepaalWozHistorie`) blijft
 * ongerond. WOZ en Verschil € zijn exacte Decimal-waarden (alleen decimale komma, geen
 * duizendtallen, geen afronding). Technische keuzes buiten het besluit: header als eerste regel,
 * velden met `;`/`"`/regeleinde tussen dubbele aanhalingstekens (RFC-4180-escaping), geen BOM.
 */

export const WOZ_HISTORIE_CSV_KOLOMMEN = [
  "Administratie",
  "Complex",
  "Unit/Geheel complex",
  "Aanslagjaar",
  "Waardepeildatum",
  "Werkelijke WOZ",
  "Verschil € vorig jaar",
  "Verschil % vorig jaar",
] as const;

export interface BgWozHistorieCsvInvoer {
  /** Administratiecode (bedrijfsnr) van de begrotingsversie. */
  administratie: string;
  wozObjecten: readonly BgWozObjectInvoer[];
  /** De expliciete "WOZ-set compleet"-bevestiging; zonder bevestiging is de export niet beschikbaar. */
  wozSetBevestigd: boolean;
  filter?: BgWozHistorieFilter;
}

export type BgWozHistorieCsvResultaat =
  | { beschikbaar: false; reden: "WOZ_SET_NIET_BEVESTIGD" }
  | { beschikbaar: true; csv: string; aantalRegels: number; uitgeslotenObjectIndices: number[] };

const REGELEINDE = "\r\n";

function tekstCel(waarde: string): string {
  const veilig = /^[=+@\t\r]/.test(waarde) ? `'${waarde}` : waarde;
  return celMetEscaping(veilig);
}

function celMetEscaping(waarde: string): string {
  return /[;"\r\n]/.test(waarde) ? `"${waarde.replace(/"/g, '""')}"` : waarde;
}

/** Exacte Decimal-tekst met decimale komma (geen duizendtallen, geen afronding). */
function getalCel(waarde: Decimal): string {
  return waarde.toString().replace(".", ",");
}

/** Percentage uitsluitend voor de export: half-up op precies 2 decimalen, decimale komma; een afgerond nulresultaat is `0,00` (nooit `-0,00`). */
function percentageCel(waarde: Decimal): string {
  const afgerond = waarde.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return (afgerond.isZero() ? new Decimal(0) : afgerond).toFixed(2).replace(".", ",");
}

function isoDatum(datum: Date): string {
  const jaar = datum.getUTCFullYear().toString().padStart(4, "0");
  const maand = (datum.getUTCMonth() + 1).toString().padStart(2, "0");
  const dag = datum.getUTCDate().toString().padStart(2, "0");
  return `${jaar}-${maand}-${dag}`;
}

export function bouwWozHistorieCsv(invoer: BgWozHistorieCsvInvoer): BgWozHistorieCsvResultaat {
  if (!invoer.wozSetBevestigd) {
    return { beschikbaar: false, reden: "WOZ_SET_NIET_BEVESTIGD" };
  }

  const historie = bepaalWozHistorie(invoer.wozObjecten, invoer.filter ?? {});
  const regels = historie.regels.map((r) =>
    [
      tekstCel(invoer.administratie),
      tekstCel(r.complexnummer),
      tekstCel(r.objectType === "UNIT" ? (r.unitnummer as string) : "Geheel complex"),
      String(r.aanslagjaar),
      isoDatum(r.waardepeildatum),
      getalCel(r.werkelijkeWoz),
      r.ontwikkelingBedrag !== null ? getalCel(r.ontwikkelingBedrag) : "",
      r.ontwikkelingPercentage !== null ? percentageCel(r.ontwikkelingPercentage) : "",
    ].join(";"),
  );

  const csv = [WOZ_HISTORIE_CSV_KOLOMMEN.map(celMetEscaping).join(";"), ...regels].join(REGELEINDE) + REGELEINDE;
  return { beschikbaar: true, csv, aantalRegels: regels.length, uitgeslotenObjectIndices: historie.uitgeslotenObjectIndices };
}
