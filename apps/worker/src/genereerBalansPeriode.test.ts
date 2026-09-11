import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
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

function basisMapping(overrides: Record<string, unknown>[] = []): Record<string, unknown> {
  const basis = [
    { grootboekrekening: "1010", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", liquideMiddelen: null, kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
    { grootboekrekening: "1711", soort: "BALANS", balanszijde: "PASSIVA", tekenconventie: "ZOALS_BRON", liquideMiddelen: null, kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
    { grootboekrekening: "8800", soort: "RESULTAAT", rapportagepost: "Huuropbrengsten belast", rapportagecategorie: "Opbrengsten", tekenconventie: "OMGEKEERD", kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
  ];
  const overrideRekeningen = new Set(overrides.map((r) => r["grootboekrekening"]));
  return {
    versie: "0.1",
    administratieId: "070_rooisezoom",
    regels: [...basis.filter((r) => !overrideRekeningen.has(r.grootboekrekening)), ...overrides],
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
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
    balansRij({ Grootboekrekeningnr: "1010", Beginbalans_debet: 1000, Beginbalans_credit: 0, Rekening_omschrijving: "Bank" }),
    balansRij({ Grootboekrekeningnr: "1711", Beginbalans_debet: 0, Beginbalans_credit: 300, Rekening_omschrijving: "Crediteuren" }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify(basisMapping()), "utf-8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerBalansPeriode", () => {
  it("telt beginbalans + boekingen t/m de opgegeven periode op tot het (met ZOALS_BRON ongewijzigd getoonde) saldo", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });

    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    const bank = resultaat.posten.find((p) => p.grootboekrekening === "1010");
    expect(bank?.saldo.toString()).toBe("1500"); // 1000 beginbalans + 500 (periode 01), NIET periode 07 (9999)
    expect(bank?.rapportagecategorie).toBe("ACTIVA");
  });

  it("gebruikt de vaste balanszijde uit de mapping voor 1711 (PASSIVA), niet het saldoteken", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    const crediteuren = resultaat.posten.find((p) => p.grootboekrekening === "1711");
    expect(crediteuren?.rapportagecategorie).toBe("PASSIVA");
    expect(crediteuren?.saldo.toString()).toBe("-300"); // ZOALS_BRON: ongewijzigd getoond
  });

  it("markeert de niet-gemapte rekening 9999 als controleVereist, nooit stilzwijgend weggelaten", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "9999")).toBe(true);
  });

  it("negeert de bekende RESULTAAT-rekening 8800 volledig in posten/controleVereist (die hoort in de P&L)", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(resultaat.posten.some((p) => p.grootboekrekening === "8800")).toBe(false);
    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "8800")).toBe(false);
  });

  it("berekent resultaatHuidigBoekjaar via dezelfde boekingen met de P&L-module (@bvc/reporting's berekenPlPeriode + berekenNettoResultaat)", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const { resultaatHuidigBoekjaar } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    // 8800 raw saldo = 0 - 500 = -500; OMGEKEERD -> gepresenteerd +500 (Opbrengsten); standaard teken Opbrengsten = +1.
    expect(resultaatHuidigBoekjaar).toEqual({ type: "bekend", waarde: new Decimal("500") });
  });

  it("de aansluitingscontrole gebruikt activaTotaal - passivaTotaal - resultaatHuidigBoekjaar", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    // activaTotaal 1500 (1010), passivaTotaal -300 (1711), resultaat 500 -> verschil = 1500 - (-300) - 500 = 1300.
    expect(resultaat.aansluiting.verschil).toEqual({ type: "bekend", waarde: new Decimal("1300") });
    expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(false);
  });

  it("houdt 1010 (Bank, ACTIVA) op Activa ook als het saldo op de peildatum negatief zou zijn", () => {
    // Beginbalans 1010 nu negatief (credit-overschot) — 1010 blijft desondanks een ACTIVA-rekening.
    schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
      balansRij({ Grootboekrekeningnr: "1010", Beginbalans_debet: 0, Beginbalans_credit: 800, Rekening_omschrijving: "Bank" }),
      balansRij({ Grootboekrekeningnr: "1711", Beginbalans_debet: 0, Beginbalans_credit: 300, Rekening_omschrijving: "Crediteuren" }),
    ]);
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });

    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    const bank = resultaat.posten.find((p) => p.grootboekrekening === "1010");
    expect(bank?.saldo.toString()).toBe("-300"); // -800 beginbalans + 500 (periode 01) = -300, nog steeds negatief
    expect(bank?.rapportagecategorie).toBe("ACTIVA"); // blijft Activa, verhuist niet naar Passiva
  });

  it("markeert een BALANS-rekening met een nog niet bevestigde balanszijde (null) als controleVereist", () => {
    writeFileSync(
      grootboekmappingPad(root, "070_rooisezoom"),
      JSON.stringify(
        basisMapping([{ grootboekrekening: "1010", soort: "BALANS", balanszijde: null, tekenconventie: null, liquideMiddelen: null, kasstroomCategorie: null, actief: true, status: "VOORGESTELD" }]),
      ),
      "utf-8",
    );
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });

    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(resultaat.posten.some((p) => p.grootboekrekening === "1010")).toBe(false);
    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "1010")).toBe(true);
  });

  it("markeert een BALANS-rekening met bevestigde balanszijde maar onbevestigde tekenconventie (null) als controleVereist", () => {
    writeFileSync(
      grootboekmappingPad(root, "070_rooisezoom"),
      JSON.stringify(
        basisMapping([{ grootboekrekening: "1010", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: null, liquideMiddelen: null, kasstroomCategorie: null, actief: true, status: "VOORGESTELD" }]),
      ),
      "utf-8",
    );
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });

    const { resultaat } = genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(resultaat.posten.some((p) => p.grootboekrekening === "1010")).toBe(false);
    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "1010")).toBe(true);
  });

  it("gooit een duidelijke fout als de grootboekmapping ontbreekt", () => {
    rmSync(grootboekmappingPad(root, "070_rooisezoom"));
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    expect(() => genereerBalansPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" })).toThrow(/Grootboekmapping ontbreekt/);
  });
});
