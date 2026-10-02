import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerGrootboekInventarisatie } from "./genereerGrootboekInventarisatie.js";
import { bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-grootboek-inventarisatie-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerGrootboekInventarisatie", () => {
  it("inventariseert grootboekrekeningen over meerdere administraties uit de gedeelde bronnen", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
      {
        Bedrijfsnr: "070", Boekstuk_Sleutel: "0704020024001", Boeking_Dagboeknr: "20", Boeking_Boekjaar: 2026,
        Boeking_Boekperiode: "01", Boeking_Boekstuknr: "024001", Boeking_Volgnr: "000001", Boeking_Boekdatum: "01-01-2026",
        Boeking_Grootboeknr: "4000", Boeking_Bedrag_Debet: 100, Boeking_Bedrag_Credit: 0, Boeking_Omschrijving: "test",
      },
      {
        Bedrijfsnr: "074", Boekstuk_Sleutel: "0744020024001", Boeking_Dagboeknr: "20", Boeking_Boekjaar: 2026,
        Boeking_Boekperiode: "01", Boeking_Boekstuknr: "024001", Boeking_Volgnr: "000001", Boeking_Boekdatum: "01-01-2026",
        Boeking_Grootboeknr: "4000", Boeking_Bedrag_Debet: 50, Boeking_Bedrag_Credit: 0, Boeking_Omschrijving: "test",
      },
    ]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
      { Bedrijfsnr: "070", Jaar: 2026, Grootboekrekeningnr: "4000", Saldo_debet: "0", Saldo_credit: "0", Eindsaldo: "100", Rekening_omschrijving: "Beheerkosten", Balans_vw: "V&W" },
      { Bedrijfsnr: "074", Jaar: 2026, Grootboekrekeningnr: "4000", Saldo_debet: "0", Saldo_credit: "0", Eindsaldo: "50", Rekening_omschrijving: "Beheerkosten", Balans_vw: "V&W" },
    ]);

    const resultaat = genereerGrootboekInventarisatie(root);

    expect(resultaat.inventarisatie.totaalUniekeRekeningen).toBe(1);
    const regel = resultaat.inventarisatie.rekeningen[0]!;
    expect(regel.grootboekrekening).toBe("4000");
    expect(regel.bedrijven).toHaveLength(2);
    expect(regel.consistent).toBe(true);
  });

  it("markeert een rekening als inconsistent bij een afwijkende omschrijving tussen administraties", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
      {
        Bedrijfsnr: "070", Boekstuk_Sleutel: "0704020024001", Boeking_Dagboeknr: "20", Boeking_Boekjaar: 2026,
        Boeking_Boekperiode: "01", Boeking_Boekstuknr: "024001", Boeking_Volgnr: "000001", Boeking_Boekdatum: "01-01-2026",
        Boeking_Grootboeknr: "9999", Boeking_Bedrag_Debet: 10, Boeking_Bedrag_Credit: 0, Boeking_Omschrijving: "test",
      },
    ]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
      { Bedrijfsnr: "070", Jaar: 2026, Grootboekrekeningnr: "9999", Saldo_debet: "0", Saldo_credit: "0", Eindsaldo: "10", Rekening_omschrijving: "Diversen A", Balans_vw: "V&W" },
      { Bedrijfsnr: "074", Jaar: 2026, Grootboekrekeningnr: "9999", Saldo_debet: "0", Saldo_credit: "0", Eindsaldo: "0", Rekening_omschrijving: "Diversen B", Balans_vw: "V&W" },
    ]);

    const resultaat = genereerGrootboekInventarisatie(root);

    const regel = resultaat.inventarisatie.rekeningen.find((r) => r.grootboekrekening === "9999")!;
    expect(regel.consistent).toBe(false);
  });

  it("gooit een duidelijke fout als de gedeelde boekingen-bron ontbreekt", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
    expect(() => genereerGrootboekInventarisatie(root)).toThrow(/Gedeelde bron ontbreekt/);
  });
});
