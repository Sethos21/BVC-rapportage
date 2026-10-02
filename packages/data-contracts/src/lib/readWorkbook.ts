import * as XLSX from "xlsx";

/**
 * Leest de eerste sheet van een xlsx-bestand (alle onderzochte
 * bronbestanden hadden precies één tabblad — "Blad1", of "Sheet1" voor
 * de Grootboek_A-rubricering) en geeft rijen als kolomnaam -> ruwe waarde.
 * `raw: true` behoudt getallen/datums zo dicht mogelijk bij het onderliggende
 * celtype; de coerce-helpers in ./coerce.ts doen de eigenlijke normalisatie.
 */
export function readFirstSheetAsRows(buffer: Buffer | ArrayBuffer): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, { cellDates: true, raw: true, dense: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Werkmap bevat geen tabbladen.");
  }
  return readSheetByName(workbook, firstSheetName);
}

export function listSheetNames(buffer: Buffer | ArrayBuffer): string[] {
  return XLSX.read(buffer, { bookSheets: true }).SheetNames;
}

/**
 * BVC_Begrotingsformat_v0.2.xlsx heeft meerdere tabbladen (Instellingen,
 * Exploitatie, Servicekosten, Controle, Toelichting, Bronnen) met elk een
 * eigen kolomstructuur. `hint` matcht hoofdletterongevoelig op een
 * deel van de tabbladnaam i.p.v. een exacte naam te eisen — de exacte
 * schrijfwijze/hoofdlettergebruik van de tabbladnamen is niet apart
 * binair geverifieerd, alleen via de tekstuele inhoud van het bestand.
 */
export function readSheetAsRows(buffer: Buffer | ArrayBuffer, hint: string): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, { cellDates: true, raw: true, dense: true });
  const naam = workbook.SheetNames.find((n) => n.toLowerCase().includes(hint.toLowerCase()));
  if (!naam) {
    throw new Error(`Geen tabblad gevonden dat overeenkomt met "${hint}". Beschikbare tabbladen: ${workbook.SheetNames.join(", ")}.`);
  }
  return readSheetByName(workbook, naam);
}

function readSheetByName(workbook: XLSX.WorkBook, naam: string): Record<string, unknown>[] {
  const sheet = workbook.Sheets[naam];
  if (!sheet) {
    throw new Error(`Tabblad "${naam}" kon niet worden gelezen.`);
  }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
}

/**
 * BVC_Begrotingsformat_v0.2.xlsx-tabbladen beginnen met een herhaalde
 * titelrij (bv. "Exploitatie Eigenaarsexploitatie" in elke kolom) vóórdat
 * de echte kolomkoppen komen. `headerRowIndex` (0-based) wijst de rij met
 * de echte kolomnamen aan; alle rijen daarna zijn data.
 */
export function readSheetRowsWithHeaderRow(
  buffer: Buffer | ArrayBuffer,
  hint: string,
  headerRowIndex: number,
): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, { cellDates: true, raw: true, dense: true });
  const naam = workbook.SheetNames.find((n) => n.toLowerCase().includes(hint.toLowerCase()));
  if (!naam) {
    throw new Error(`Geen tabblad gevonden dat overeenkomt met "${hint}". Beschikbare tabbladen: ${workbook.SheetNames.join(", ")}.`);
  }
  const sheet = workbook.Sheets[naam];
  if (!sheet) {
    throw new Error(`Tabblad "${naam}" kon niet worden gelezen.`);
  }
  const rijenAlsArrays = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const headerRij = rijenAlsArrays[headerRowIndex];
  if (!headerRij) {
    throw new Error(`Tabblad "${naam}" heeft geen rij op index ${headerRowIndex} voor kolomkoppen.`);
  }
  const kolomnamen = headerRij.map((cel) => String(cel ?? ""));
  return rijenAlsArrays.slice(headerRowIndex + 1).map((rij) => {
    const record: Record<string, unknown> = {};
    kolomnamen.forEach((naam, index) => {
      if (naam) record[naam] = rij[index] ?? null;
    });
    return record;
  });
}
