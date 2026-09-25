import { bepaalWozHistorie, type BgWozHistorieFilter, type BgWozObjectInvoer } from "./begroteGemeentelijkeLasten.js";

/**
 * WOZ-historie CSV-export (Master Contract §6.8, besluit 2026-09-25; UX §9.2).
 *
 * KOLOMMEN (vastgesteld, exact deze volgorde en namen): Administratie | Complex |
 * Unit/Geheel complex | Aanslagjaar | Waardepeildatum | Werkelijke WOZ |
 * Verschil € vorig jaar | Verschil % vorig jaar. Filters op complex en periode
 * (aanslagjaar, grenzen inclusief) lopen via \`bepaalWozHistorie\`; de ontwikkeling wordt
 * dus op de volledige historie van het object berekend en pas daarna gefilterd.
 *
 * BESCHIKBAARHEID: "Zonder bevestigde historie blijft export zichtbaar maar uitgeschakeld"
 * (UX §9.2) — bij een niet-bevestigde WOZ-set is het resultaat \`beschikbaar: false\` en wordt
 * geen CSV opgebouwd.
 *
 * SERIALISATIE (uitsluitend technische keuzes, geen businessregels; het besluit legt alleen de
 * kolommen en filters vast): scheidingsteken \`;\`, regeleinde CRLF, header als eerste regel,
 * velden met \`;\`/\`"\`/regeleinde tussen dubbele aanhalingstekens (RFC-4180-escaping), getallen
 * als exacte Decimal-tekst met decimale punt zonder duizendtallen en ZONDER afronding
 * (presentatieafronding is aan de consument), datums als ISO \`YYYY-MM-DD\`, geen BOM. Een
 * ontbrekende ontwikkeling (eerste jaar, of voorgaande waarde niet positief) is een LEGE cel —
 * nooit 0. Tekstcellen (administratie/complex/unit) die met \`=\`, \`+\`, \`@\`, tab of CR beginnen
 * krijgen een voorloop-\`'\` zodat een spreadsheet ze niet als formule uitvoert.
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
      r.werkelijkeWoz.toString(),
      r.ontwikkelingBedrag !== null ? r.ontwikkelingBedrag.toString() : "",
      r.ontwikkelingPercentage !== null ? r.ontwikkelingPercentage.toString() : "",
    ].join(";"),
  );

  const csv = [WOZ_HISTORIE_CSV_KOLOMMEN.map(celMetEscaping).join(";"), ...regels].join(REGELEINDE) + REGELEINDE;
  return { beschikbaar: true, csv, aantalRegels: regels.length, uitgeslotenObjectIndices: historie.uitgeslotenObjectIndices };
}
