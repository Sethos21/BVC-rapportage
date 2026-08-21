import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerRapportPeriode } from "./genereerRapportPeriode.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, grootboekmappingPad, grootboekmappingenDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

function boekingRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "070",
    Boekstuk_Sleutel: "0704020024001",
    Boeking_Dagboeknr: "20",
    Boeking_Boekjaar: 2026,
    Boeking_Boekperiode: "01",
    Boeking_Boekstuknr: "024001",
    Boeking_Volgnr: "000001",
    Boeking_Boekdatum: "01-01-2026",
    Boeking_Grootboeknr: "4000",
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
      { grootboekrekening: "1010", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "1711", soort: "BALANS", balanszijde: "PASSIVA", tekenconventie: "ZOALS_BRON", actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "8800", soort: "RESULTAAT", rapportagepost: "Huuropbrengsten belast", rapportagecategorie: "Opbrengsten", tekenconventie: "OMGEKEERD", actief: true, status: "GOEDGEKEURD" },
    ],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-rapport-periode-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
    // periode 01: bank omhoog (1010), tegenboeking op een RESULTAAT-rekening (8800) — boekstuk balanceert zelf
    boekingRij({ Boeking_Boekperiode: "01", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 500, Boeking_Bedrag_Credit: 0 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024002", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000002", Boeking_Boekperiode: "01", Boeking_Grootboeknr: "8800", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 500 }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
    balansRij({ Grootboekrekeningnr: "1010", Beginbalans_debet: 1000, Beginbalans_credit: 0, Rekening_omschrijving: "Bank" }),
    balansRij({ Grootboekrekeningnr: "1711", Beginbalans_debet: 0, Beginbalans_credit: 300, Rekening_omschrijving: "Crediteuren" }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify(basisMapping()), "utf-8");

  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerRapportPeriode", () => {
  it("schrijft één HTML-bestand naar rapporten/ dat zowel de resultatenrekening als de balans bevat", () => {
    const resultaat = genereerRapportPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(existsSync(resultaat.pad)).toBe(true);
    const geschreven = readFileSync(resultaat.pad, "utf-8");
    expect(geschreven).toBe(resultaat.html);
    expect(geschreven).toContain("Resultatenrekening");
    expect(geschreven).toContain("Balans");
    expect(geschreven).toContain("Huuropbrengsten belast");
    expect(geschreven).toContain("1010");
  });

  it("gebruikt dezelfde berekeningen als pl-periode/balans-periode (geen parallelle rekenlaag)", () => {
    const resultaat = genereerRapportPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    // Zelfde cijfers als de balans-periode-testcase: 1010 -> 1500 (1000 beginbalans + 500), 8800 -> netto +500.
    const bank = resultaat.balansResultaat.posten.find((p) => p.grootboekrekening === "1010");
    expect(bank?.saldo.toString()).toBe("1500");
    const opbrengsten = resultaat.plResultaat.categorieTotalen.find((c) => c.rapportagecategorie === "Opbrengsten");
    expect(opbrengsten?.bedrag.toString()).toBe("500");
  });

  it("gooit een duidelijke fout als de grootboekmapping ontbreekt", () => {
    rmSync(grootboekmappingPad(root, "070_rooisezoom"));
    expect(() => genereerRapportPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" })).toThrow(/Grootboekmapping ontbreekt/);
  });
});
