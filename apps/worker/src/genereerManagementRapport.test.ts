import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerManagementRapport } from "./genereerManagementRapport.js";
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
    Boeking_Grootboeknr: "1010",
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
      { grootboekrekening: "1711", soort: "BALANS", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD", liquideMiddelen: false, kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "8800", soort: "RESULTAAT", rapportagepost: "Huuropbrengsten belast", rapportagecategorie: "Opbrengsten", tekenconventie: "OMGEKEERD", kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "4000", soort: "RESULTAAT", rapportagepost: "Overige kosten", rapportagecategorie: "Kosten", tekenconventie: "ZOALS_BRON", kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
    ],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-management-rapport-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
    boekingRij({ Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 500, Boeking_Bedrag_Credit: 0 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024002", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000002", Boeking_Grootboeknr: "8800", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 500 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024003", Boeking_Boekstuknr: "024003", Boeking_Volgnr: "000001", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 200 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024003", Boeking_Boekstuknr: "024003", Boeking_Volgnr: "000002", Boeking_Grootboeknr: "4000", Boeking_Bedrag_Debet: 200, Boeking_Bedrag_Credit: 0 }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
    balansRij({ Grootboekrekeningnr: "1010", Beginbalans_debet: 1000, Beginbalans_credit: 0, Rekening_omschrijving: "Bank" }),
    balansRij({ Grootboekrekeningnr: "1711", Beginbalans_debet: 0, Beginbalans_credit: 1000, Rekening_omschrijving: "Crediteuren" }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);

  schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), [
    { Bedrijfsnr: "070", Complexnummer: "001", Unitnummer: "0001", Unit_Non_actief: "Nee", Unitomschrijving: "Unit A", Unitsoort: "Kantoor", Unit_VVO: "100", Unit_BVO: "110" },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [
    {
      Bedrijfsnummer: "070", Contractnummer: "C1", Vorderingsoort: "01", Unitnummer: "0001", Complexnummer: "001",
      Rapportage_datum: "30-06-2026", Prolongatie_bedrag_jaar: "10000", Korting_bedrag_jaar: null,
      Service_voorschot_jaar: null, Gehuurd_oppervlak: "80", Contract_expiratiedatum: null, Contract_opzegdatum: null,
    },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [
    {
      Bedrijfsnr: "070", Contract: "C1", Complexnummer: "001", Unitnummer: "0001", Huurdernummer: "H1",
      Ingangsdatum: "01-01-2020", Afloopdatum: null, Check_Lopend_Contract: "Ja",
      Expiratie_Expiratiedatum: "31-12-2027", Expiratie_Opzegdatum: null, Expiratie_Aantal_per_optie: null, Expiratie_huidige: "Ja",
    },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify(basisMapping()), "utf-8");

  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerManagementRapport", () => {
  it("combineert kerncijfers/vastgoed/huur/kasstroom tot één HTML-rapport, zonder eigen berekening", () => {
    const resultaat = genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(existsSync(resultaat.pad)).toBe(true);
    expect(readFileSync(resultaat.pad, "utf-8")).toBe(resultaat.html);

    // Financieel (sectie 1) — zelfde cijfers als het al bewezen genereerKerncijfers-regressiepunt.
    expect(resultaat.resultaat.managementsamenvatting.totaleOpbrengsten.toString()).toBe("500");
    expect(resultaat.resultaat.managementsamenvatting.totaleKosten.toString()).toBe("200");
    expect(resultaat.resultaat.managementsamenvatting.bankstandEinde.toString()).toBe("1300");
    expect(resultaat.resultaat.managementsamenvatting.balansSluit).toBe(true);

    // Vastgoed (sectie 2) — momentopname, los van boekjaar/periode.
    expect(resultaat.resultaat.vastgoed.momentopname).toBe(true);
    if (resultaat.resultaat.vastgoed.portefeuille.totaalVvo.type === "bekend") {
      expect(resultaat.resultaat.vastgoed.portefeuille.totaalVvo.waarde.toString()).toBe("100");
    }

    // Huur (sectie 3) — momentopname, eigen VVO-definitie.
    expect(resultaat.resultaat.huur.momentopname).toBe(true);
    if (resultaat.resultaat.huur.portefeuille.brutoJaarhuur.type === "bekend") {
      expect(resultaat.resultaat.huur.portefeuille.brutoJaarhuur.waarde.toString()).toBe("10000");
    }

    // Kasstroom (sectie 4) — volledige detail, zelfde bankstand als sectie 1.
    expect(resultaat.resultaat.kasstroom.bankstandEind.toString()).toBe("1300");

    // HTML bevat alle vijf secties.
    expect(resultaat.html).toContain("1. Managementsamenvatting");
    expect(resultaat.html).toContain("2. Vastgoed");
    expect(resultaat.html).toContain("3. Huur");
    expect(resultaat.html).toContain("4. Kasstroom");
    expect(resultaat.html).toContain("5. Controle vereist");
  });

  it("gooit een duidelijke fout als de grootboekmapping ontbreekt", () => {
    rmSync(grootboekmappingPad(root, "070_rooisezoom"));
    expect(() => genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" })).toThrow(/Grootboekmapping ontbreekt/);
  });
});
