import * as XLSX from "xlsx";

/**
 * Leest de eerste sheet van een xlsx-bestand (alle onderzochte
 * bronbestanden hadden precies één tabblad — "Blad1", of "Sheet1" voor
 * de Grootboek_A-rubricering) en geeft rijen als kolomnaam -> ruwe waarde.
 * `raw: true` behoudt getallen/datums zo dicht mogelijk bij het onderliggende
 * celtype; de coerce-helpers in ./coerce.ts doen de eigenlijke normalisatie.
 */
export function readFirstSheetAsRows(buffer: Buffer | ArrayBuffer): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, { cellDates: true, raw: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Werkmap bevat geen tabbladen.");
  }
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw new Error(`Tabblad "${firstSheetName}" kon niet worden gelezen.`);
  }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
}
