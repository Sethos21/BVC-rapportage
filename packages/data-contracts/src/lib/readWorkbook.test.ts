import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { readFirstSheetAsRows } from "./readWorkbook.js";
import { parseBoekingen } from "../sources/boekingen.js";

describe("readFirstSheetAsRows + parseBoekingen (round-trip via echte .xlsx-binaire indeling)", () => {
  it("leest een in-memory werkmap en levert rijen op die door het broncontract komen", () => {
    const sheet = XLSX.utils.json_to_sheet([
      {
        Bedrijfsnr: "002",
        Boekstuk_Sleutel: "202420024001",
        Boeking_Dagboeknr: "20",
        Boeking_Boekjaar: 2024,
        Boeking_Boekperiode: "01",
        Boeking_Boekstuknr: "024001",
        Boeking_Volgnr: "000002",
        Boeking_Boekdatum: "01-01-2024",
        Boeking_Grootboeknr: "1010",
        Boeking_Bedrag_Debet: 1665.54,
        Boeking_Bedrag_Credit: 0,
        Boeking_Omschrijving: "test",
        Boeking_Grootboek_A: "1010",
        Boeking_Grootboek_B: "1010",
        Boeking_Saldo: 1665.54,
      },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Blad1");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const ruweRijen = readFirstSheetAsRows(buffer);
    expect(ruweRijen).toHaveLength(1);

    const { rijen, issues } = parseBoekingen(ruweRijen);
    expect(issues).toHaveLength(0);
    expect(rijen[0]?.bedrijfsnr).toBe("002");
    expect(rijen[0]?.boekingSaldo.toString()).toBe("1665.54");
  });
});
