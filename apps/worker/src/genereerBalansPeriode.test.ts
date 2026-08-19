import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerBalansPeriode } from "./genereerBalansPeriode.js";
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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-balans-periode-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
    // periode 01: bank omhoog (1010), tegenboeking op een RESULTAAT-rekening (8800) — boekstuk balanceert zelf
    boekingRij({ Boeking_Boekperiode: "01", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 500, Boeking_Bedrag_Credit: 0 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024002", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000002", Boeking_Boekperiode: "01", Boeking_Grootboeknr: "8800", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 500 }),
    // periode 07: buiten de gevraagde t/m periode 06 — moet niet meetellen
    boekingRij({ Boekstuk_Sleutel: "0704020024003", Boeking_Boekstuknr: "024003", Boeking_Volgnr: "000003", Boeking_Boekperiode: "07", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 9999, Boeking_Bedrag_Credit: 0 }),
    // een nog niet gemapte rekening met een niet-nul mutatie — moet als controleVereist verschijnen
    boekingRij({ Boekstuk_Sleutel: "0704020024004", Boeking_Boekstuknr: "024004", Boeking_Volgnr: "000004", Boeking_Boekperiode: "02", Boeking_Grootboeknr: "9999", Boeking_Bedrag_Debet: 30, Boeking_Bedrag_Credit: 0 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024005", Boeking_Boekstuknr: "024005", Boeking_Volgnr: "000005", Boeking_Boekperiode: "02", Boeking_Grootboeknr: "1711", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 30 }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
    // Beginbalans van de gemapte BALANS-rekeningen samen op 0 (200 - 200) — zoals een echte, op jaarbegin
    // reeds sluitende balans (activa = passiva + eigen vermogen); dat maakt de aansluitingscontrole hieronder
    // demonstreerbaar zonder een niet-gemapte rekening als 0 te moeten aannemen.
    balansRij({ Grootboekrekeningnr: "1010", Beginbalans_debet: 200, Beginbalans_credit: 0, Rekening_omschrijving: "Bank" }),
    balansRij({ Grootboekrekeningnr: "1711", Beginbalans_debet: 0, Beginbalans_credit: 200, Rekening_omschrijving: "Crediteuren" }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(
    grootboekmappingPad(root, "070_rooisezoom"),
    JSON.stringify({
      versie: "0.1",
      administratieId: "070_rooisezoom",
      regels: [
        { grootboekrekening: "1010", soort: "BALANS", actief: true, status: "GOEDGEKEURD" },
        { grootboekrekening: "1711", soort: "BALANS", actief: true, status: "GOEDGEKEURD" },
        { grootboekrekening: "8800", soort: "RESULTAAT", rapportagepost: "Huuropbrengsten belast", rapportagecategorie: "Opbrengsten", tekenconventie: "OMGEKEERD", actief: true, status: "GOEDGEKEURD" },
      ],
    }),
    "utf-8",
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerBalansPeriode", () => {
  it("telt beginbalans + boekingen t/m de opgegeven periode op tot het saldo op de peildatum", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });

    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    const bank = resultaat.posten.find((p) => p.grootboekrekening === "1010");
    expect(bank?.saldo.toString()).toBe("700"); // 200 beginbalans + 500 (periode 01), NIET periode 07 (9999)
    expect(bank?.rapportagecategorie).toBe("Activa");
  });

  it("classificeert een netto-creditrekening structureel als Passiva", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    const crediteuren = resultaat.posten.find((p) => p.grootboekrekening === "1711");
    expect(crediteuren?.rapportagecategorie).toBe("Passiva");
    expect(crediteuren?.saldo.toString()).toBe("-230"); // -200 beginbalans - 30 mutatie (periode 02)
  });

  it("markeert de niet-gemapte rekening 9999 als controleVereist, nooit stilzwijgend weggelaten", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "9999")).toBe(true);
  });

  it("negeert de bekende RESULTAAT-rekening 8800 in posten/controleVereist maar telt mee in de aansluitingscontrole", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(resultaat.posten.some((p) => p.grootboekrekening === "8800")).toBe(false);
    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "8800")).toBe(false);
    expect(resultaat.aansluiting.resultaatTotaal.toString()).toBe("-500");
  });

  it("toont een aansluitingsafwijking exact gelijk aan de niet-gemapte 9999-mutatie", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    // Beginbalans van de gemapte BALANS-rekeningen sluit zelf op 0 (zie fixture hierboven), dus elke
    // resterende afwijking komt volledig van de niet-gemapte 9999-mutatie (+30) -> verschil = -30.
    expect(resultaat.aansluiting.verschil.toString()).toBe("-30");
    expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(false);
  });

  it("gooit een duidelijke fout als de grootboekmapping ontbreekt", () => {
    rmSync(grootboekmappingPad(root, "070_rooisezoom"));
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    expect(() => genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" })).toThrow(/Grootboekmapping ontbreekt/);
  });
});
