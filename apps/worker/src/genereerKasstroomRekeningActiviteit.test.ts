import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerKasstroomRekeningActiviteit } from "./genereerKasstroomRekeningActiviteit.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, grootboekmappingPad, grootboekmappingenDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

function boekingRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "070",
    Boekstuk_Sleutel: "0704020024001",
    Boeking_Dagboeknr: "90",
    Boeking_Boekjaar: 2026,
    Boeking_Boekperiode: "01",
    Boeking_Boekstuknr: "024001",
    Boeking_Volgnr: "000001",
    Boeking_Boekdatum: "26-01-2026",
    Boeking_Grootboeknr: "1506",
    Boeking_Bedrag_Debet: 0,
    Boeking_Bedrag_Credit: 0,
    Boeking_Omschrijving: "test",
    Boeking_Saldo: "0",
    ...overrides,
  };
}

function balansRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "070",
    Jaar: 2026,
    Grootboekrekeningnr: "1010",
    Beginbalans_debet: 0,
    Beginbalans_credit: 0,
    Saldo_debet: 0,
    Saldo_credit: 0,
    Eindsaldo: 0,
    Rekening_omschrijving: "Bank",
    Balans_vw: "Balans",
    ...overrides,
  };
}

function basisMapping(): Record<string, unknown> {
  return {
    versie: "0.1",
    administratieId: "070_rooisezoom",
    regels: [
      { grootboekrekening: "1010", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", liquideMiddelen: true, kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "1600", soort: "BALANS", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD", liquideMiddelen: false, kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "1506", soort: "BALANS", balanszijde: null, tekenconventie: null, liquideMiddelen: false, kasstroomCategorie: null, actief: true, status: "VOORGESTELD" },
    ],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-rekeningactiviteit-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
    boekingRij({ Boeking_Grootboeknr: "1506", Boeking_Bedrag_Debet: 31617, Boeking_Bedrag_Credit: 0, Boeking_Omschrijving: "BTW Q4 2025" }),
    boekingRij({ Boeking_Volgnr: "000002", Boeking_Grootboeknr: "1600", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 31617, Boeking_Omschrijving: "BTW Q4 2025" }),
    boekingRij({
      Boekstuk_Sleutel: "0704020024002",
      Boeking_Boekstuknr: "024002",
      Boeking_Volgnr: "000001",
      Boeking_Boekperiode: "02",
      Boeking_Boekdatum: "10-02-2026",
      Boeking_Dagboeknr: "20",
      Boeking_Grootboeknr: "1600",
      Boeking_Bedrag_Debet: 31617,
      Boeking_Bedrag_Credit: 0,
      Boeking_Omschrijving: "Betaalbatch week 6",
    }),
    boekingRij({
      Boekstuk_Sleutel: "0704020024002",
      Boeking_Boekstuknr: "024002",
      Boeking_Volgnr: "000002",
      Boeking_Boekperiode: "02",
      Boeking_Boekdatum: "10-02-2026",
      Boeking_Dagboeknr: "20",
      Boeking_Grootboeknr: "1010",
      Boeking_Bedrag_Debet: 0,
      Boeking_Bedrag_Credit: 31617,
      Boeking_Omschrijving: "Betaalbatch week 6",
    }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [balansRij({ Grootboekrekeningnr: "1010" })]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify(basisMapping()), "utf-8");

  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerKasstroomRekeningActiviteit", () => {
  it("toont de factuurregistratie en de latere betaling op 1600, met kasstroom-relevantie", () => {
    const regels = genereerKasstroomRekeningActiviteit(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06", doelRekening: "1600" });
    expect(regels).toHaveLength(2);
    expect(regels[0]?.omschrijving).toBe("BTW Q4 2025");
    expect(regels[0]?.isKasstroomRelevant).toBe(false);
    expect(regels[1]?.omschrijving).toBe("Betaalbatch week 6");
    expect(regels[1]?.isKasstroomRelevant).toBe(true);
  });
});
