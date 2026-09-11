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

function schrijfVastgoedEnHuurFixtures(): void {
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
}

function schrijfBasisAdministratie(): void {
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));
  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify(basisMapping()), "utf-8");
}

describe("genereerManagementRapport — boekperiodeVan='01' (regressie)", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bvc-management-rapport-"));
    schrijfBasisAdministratie();

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
    schrijfVastgoedEnHuurFixtures();

    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("combineert kerncijfers/vastgoed/huur/kasstroom tot één HTML-rapport, zonder eigen berekening (exact gelijk aan het bevestigde regressiepunt)", () => {
    const resultaat = genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(existsSync(resultaat.pad)).toBe(true);
    expect(readFileSync(resultaat.pad, "utf-8")).toBe(resultaat.html);

    expect(resultaat.resultaat.periode.boekperiodeVan).toBe("01");
    expect(resultaat.resultaat.periode.totaleOpbrengsten.toString()).toBe("500");
    expect(resultaat.resultaat.periode.totaleKosten.toString()).toBe("200");
    expect(resultaat.resultaat.stand.bankstandEinde.toString()).toBe("1300");
    expect(resultaat.resultaat.stand.balansSluit).toBe(true);

    expect(resultaat.resultaat.vastgoed.momentopname).toBe(true);
    if (resultaat.resultaat.vastgoed.portefeuille.totaalVvo.type === "bekend") {
      expect(resultaat.resultaat.vastgoed.portefeuille.totaalVvo.waarde.toString()).toBe("100");
    }

    expect(resultaat.resultaat.huur.momentopname).toBe(true);
    if (resultaat.resultaat.huur.portefeuille.brutoJaarhuur.type === "bekend") {
      expect(resultaat.resultaat.huur.portefeuille.brutoJaarhuur.waarde.toString()).toBe("10000");
    }

    // Kasstroom periode 01–06 == YTD; met boekperiodeVan="01" is boekingenVoorPeriode leeg,
    // dus dit moet exact hetzelfde zijn als de bestaande YTD-kasstroomfunctie zou geven.
    expect(resultaat.resultaat.periode.kasstroom.bankstandBegin.toString()).toBe("1000");
    expect(resultaat.resultaat.periode.kasstroom.bankstandEind.toString()).toBe("1300");

    expect(resultaat.html).toContain("1. Managementsamenvatting");
    expect(resultaat.html).toContain("2. Vastgoed");
    expect(resultaat.html).toContain("3. Huur");
    expect(resultaat.html).toContain("4. Kasstroom");
    expect(resultaat.html).toContain("5. Servicekosten");
    expect(resultaat.html).toContain("6. Controle vereist");
  });

  it("gooit een duidelijke fout als de grootboekmapping ontbreekt", () => {
    rmSync(grootboekmappingPad(root, "070_rooisezoom"));
    expect(() => genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" })).toThrow(/Grootboekmapping ontbreekt/);
  });
});

describe("genereerManagementRapport — boekperiodeVan='04' (subperiode)", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bvc-management-rapport-subperiode-"));
    schrijfBasisAdministratie();

    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
      // Periode 01 — mag NIET meetellen in de periode-groep 04–06, wel in de YTD-stand-groep.
      boekingRij({ Boeking_Boekperiode: "01", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 1000, Boeking_Bedrag_Credit: 0 }),
      boekingRij({ Boekstuk_Sleutel: "0704020024001b", Boeking_Boekperiode: "01", Boeking_Boekstuknr: "024001b", Boeking_Volgnr: "000002", Boeking_Grootboeknr: "8800", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 1000 }),
      // Periode 05 — telt mee in 04–06.
      boekingRij({ Boekstuk_Sleutel: "0704020024002", Boeking_Boekperiode: "05", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000001", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 500, Boeking_Bedrag_Credit: 0 }),
      boekingRij({ Boekstuk_Sleutel: "0704020024002", Boeking_Boekperiode: "05", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000002", Boeking_Grootboeknr: "8800", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 500 }),
      // Periode 06 — telt mee in 04–06.
      boekingRij({ Boekstuk_Sleutel: "0704020024003", Boeking_Boekperiode: "06", Boeking_Boekstuknr: "024003", Boeking_Volgnr: "000001", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 300 }),
      boekingRij({ Boekstuk_Sleutel: "0704020024003", Boeking_Boekperiode: "06", Boeking_Boekstuknr: "024003", Boeking_Volgnr: "000002", Boeking_Grootboeknr: "4000", Boeking_Bedrag_Debet: 300, Boeking_Bedrag_Credit: 0 }),
    ]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
      balansRij({ Grootboekrekeningnr: "1010", Beginbalans_debet: 2000, Beginbalans_credit: 0, Rekening_omschrijving: "Bank" }),
      balansRij({ Grootboekrekeningnr: "1711", Beginbalans_debet: 0, Beginbalans_credit: 2000, Rekening_omschrijving: "Crediteuren" }),
    ]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);
    schrijfVastgoedEnHuurFixtures();

    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("bevat in de periode-groep (04–06) uitsluitend periode-05/06-boekingen, niet periode 01", () => {
    const resultaat = genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeVan: "04", boekperiodeTotEnMet: "06" });

    expect(resultaat.resultaat.periode.boekperiodeVan).toBe("04");
    expect(resultaat.resultaat.periode.boekperiodeTotEnMet).toBe("06");
    // Opbrengsten periode 04–06 = alleen periode 05 (500) — de 1000 uit periode 01 telt niet mee.
    expect(resultaat.resultaat.periode.totaleOpbrengsten.toString()).toBe("500");
    expect(resultaat.resultaat.periode.totaleKosten.toString()).toBe("300");
  });

  it("bankstand begin/eind van de periode-groep is de werkelijke bankstand, niet de jaarbeginstand + periode-boekingen", () => {
    const resultaat = genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeVan: "04", boekperiodeTotEnMet: "06" });
    const kasstroom = resultaat.resultaat.periode.kasstroom;

    // bankstandBegin periode 04 = jaarbegin (2000) + mutatie periode 01 (+1000) = 3000 — NIET de jaarbeginstand 2000 zelf.
    expect(kasstroom.bankstandBegin.toString()).toBe("3000");
    // bankstandEind periode 06 = 3000 + mutatie 05/06 (500 - 300 = 200) = 3200.
    expect(kasstroom.bankstandEind.toString()).toBe("3200");
    // Ontvangsten/uitgaven bevatten uitsluitend periode 05/06.
    expect(kasstroom.ontvangsten.toString()).toBe("500");
    expect(kasstroom.uitgaven.toString()).toBe("300");
    expect(kasstroom.nettoKasstroom.toString()).toBe("200");
  });

  it("harde controle 1: bankstandBegin + nettoKasstroom = bankstandEind van de periode-groep", () => {
    const resultaat = genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeVan: "04", boekperiodeTotEnMet: "06" });
    const kasstroom = resultaat.resultaat.periode.kasstroom;

    expect(kasstroom.bankstandBegin.plus(kasstroom.nettoKasstroom).toString()).toBe(kasstroom.bankstandEind.toString());
  });

  it("harde controle 2: bankstandEind van de periode-groep = bankstandEinde van de YTD-stand-groep voor dezelfde periodeTotEnMet", () => {
    const resultaat = genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeVan: "04", boekperiodeTotEnMet: "06" });

    expect(resultaat.resultaat.periode.kasstroom.bankstandEind.toString()).toBe(resultaat.resultaat.stand.bankstandEinde.toString());
  });

  it("balans/resultaat-huidig-boekjaar-YTD/vastgoed/huur blijven identiek, ongeacht boekperiodeVan", () => {
    const resultaatVan01 = genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeVan: "01", boekperiodeTotEnMet: "06" });
    const resultaatVan04 = genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeVan: "04", boekperiodeTotEnMet: "06" });

    expect(resultaatVan04.resultaat.stand.bankstandEinde.toString()).toBe(resultaatVan01.resultaat.stand.bankstandEinde.toString());
    expect(resultaatVan04.resultaat.stand.resultaatHuidigBoekjaarYtd).toEqual(resultaatVan01.resultaat.stand.resultaatHuidigBoekjaarYtd);
    expect(resultaatVan04.resultaat.stand.balansSluit).toBe(resultaatVan01.resultaat.stand.balansSluit);
    expect(resultaatVan04.resultaat.vastgoed).toEqual(resultaatVan01.resultaat.vastgoed);
    expect(resultaatVan04.resultaat.huur).toEqual(resultaatVan01.resultaat.huur);
  });
});

function servicekostenRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "070", Service_BK_Boekjaar: "2026", Service_BK_Boekperiode: "01", Service_BK_Dagboeknummer: "50",
    Service_BK_Boekstuknummer: "200", Service_BK_Volgnummer: "000001", Service_BK_Kostensoort: "0101",
    Service_BK_Bedrag_debet: "100", Service_BK_Bedrag_credit: "0", Kostensoort_Soort: "Kosten",
    ...overrides,
  };
}

describe("genereerManagementRapport — servicekosten-sectie", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bvc-management-rapport-servicekosten-"));
    schrijfBasisAdministratie();

    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
      boekingRij({ Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 500, Boeking_Bedrag_Credit: 0 }),
      boekingRij({ Boekstuk_Sleutel: "0704020024002", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000002", Boeking_Grootboeknr: "8800", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 500 }),
      // Servicekosten-tegenhanger op 1712, zelfde natuurlijke sleutel als servicekostenRij hieronder.
      boekingRij({ Boekstuk_Sleutel: "0704020024005", Boeking_Dagboeknr: "50", Boeking_Boekstuknr: "200", Boeking_Volgnr: "000001", Boeking_Grootboeknr: "1712", Boeking_Bedrag_Debet: 100, Boeking_Bedrag_Credit: 0 }),
    ]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
      balansRij({ Grootboekrekeningnr: "1010", Beginbalans_debet: 1000, Beginbalans_credit: 0, Rekening_omschrijving: "Bank" }),
      balansRij({ Grootboekrekeningnr: "1711", Beginbalans_debet: 0, Beginbalans_credit: 1000, Rekening_omschrijving: "Crediteuren" }),
    ]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), [servicekostenRij()]);
    schrijfVastgoedEnHuurFixtures();

    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("toont geen aparte gebruikersflag nodig: zonder servicekostenRekeningen in administratie.json wordt de reconciliatie overgeslagen met één duidelijke melding, nooit 1711/1712 aangenomen", () => {
    const resultaat = genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(resultaat.resultaat.servicekosten.actuelePositie.kostenSaldo.toString()).toBe("100");
    expect(resultaat.resultaat.servicekosten.reconciliatie.doelrekeningen).toEqual([]);
    expect(resultaat.resultaat.controleVereist).toContainEqual({
      sectie: "Servicekosten",
      ernst: "INFORMATIEF",
      referentie: null,
      bericht: expect.stringContaining("Geen doelrekeningen opgegeven"),
    });
  });

  it("resolveert servicekostenRekeningen uit administratie.json en reconcilieert exact, zonder WAARSCHUWING", () => {
    schrijfAdministratieConfig(root, "070_rooisezoom", {
      ...nieuweAdministratieConfig("070", "Rooise Zoom"),
      servicekostenRekeningen: { kostenrekening: "1712", voorschottenrekening: "1711" },
    });

    const resultaat = genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(resultaat.resultaat.servicekosten.reconciliatie.doelrekeningen).toEqual(["1712", "1711"]);
    const rek1712 = resultaat.resultaat.servicekosten.reconciliatie.perRekening.find((r) => r.grootboekrekening === "1712");
    expect(rek1712?.grootboekSaldo.toString()).toBe("100");
    expect(rek1712?.verschil.toString()).toBe("0");
    expect(resultaat.resultaat.controleVereist.filter((c) => c.sectie === "Servicekosten" && c.ernst === "WAARSCHUWING")).toHaveLength(0);
    expect(resultaat.html).toContain("5. Servicekosten");
  });

  it("houdt bestaande Financieel/Vastgoed/Huur/Kasstroom-cijfers ongewijzigd wanneer servicekosten wordt toegevoegd", () => {
    const resultaat = genereerManagementRapport(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });
    expect(resultaat.resultaat.periode.totaleOpbrengsten.toString()).toBe("500");
    expect(resultaat.resultaat.stand.bankstandEinde.toString()).toBe("1500");
  });
});
