import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";

/** Testhulp: schrijft rijen als een echte .xlsx (niet gefabriceerde data, wel synthetische testwaarden). */
export function schrijfXlsxFixture(pad: string, rijen: Record<string, unknown>[]): void {
  const sheet = XLSX.utils.json_to_sheet(rijen);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Blad1");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  writeFileSync(pad, buffer);
}

/** Twee boekingsregels voor bedrijfsnr 002 die samen sluiten (boekstukcontrole). */
export function boekingenFixtureRijen(bedrijfsnr = "002") {
  return [
    {
      Bedrijfsnr: bedrijfsnr, Boekstuk_Sleutel: `${bedrijfsnr}420024001`, Boeking_Dagboeknr: "20",
      Boeking_Boekjaar: 2024, Boeking_Boekperiode: "01", Boeking_Boekstuknr: "024001", Boeking_Volgnr: "000001",
      Boeking_Boekdatum: "01-01-2024", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 100, Boeking_Bedrag_Credit: 0,
      Boeking_Omschrijving: "test debet", Boeking_Grootboek_A: "1010", Boeking_Grootboek_B: "1010", Boeking_Saldo: 100,
    },
    {
      Bedrijfsnr: bedrijfsnr, Boekstuk_Sleutel: `${bedrijfsnr}420024001`, Boeking_Dagboeknr: "20",
      Boeking_Boekjaar: 2024, Boeking_Boekperiode: "01", Boeking_Boekstuknr: "024001", Boeking_Volgnr: "000002",
      Boeking_Boekdatum: "01-01-2024", Boeking_Grootboeknr: "8000", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 100,
      Boeking_Omschrijving: "test credit", Boeking_Grootboek_A: "8000", Boeking_Grootboek_B: "8000", Boeking_Saldo: -100,
    },
  ];
}
