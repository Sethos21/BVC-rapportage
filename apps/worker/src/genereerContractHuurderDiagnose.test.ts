import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerContractHuurderDiagnose } from "./genereerContractHuurderDiagnose.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, grootboekmappingPad, grootboekmappingenDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

function servicekostenRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "070", Service_BK_Boekjaar: "2026", Service_BK_Boekperiode: "01", Service_BK_Dagboeknummer: "50",
    Service_BK_Boekstuknummer: "100", Service_BK_Volgnummer: "1", Service_BK_Kostensoort: "2000",
    Service_BK_Bedrag_debet: "0", Service_BK_Bedrag_credit: "1200", Kostensoort_Soort: "Voorschotten",
    Service_BK_Contractnummer: "C1", Huurdernummer: "H1",
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-contract-huurder-diagnose-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), [servicekostenRij()]);

  schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [
    {
      Bedrijfsnummer: "070", Contractnummer: "C1", Vorderingsoort: "01", Unitnummer: "0001", Complexnummer: "001",
      Rapportage_datum: "30-06-2026", Prolongatie_bedrag_jaar: "10000", Korting_bedrag_jaar: null,
      Service_voorschot_jaar: "1200", Gehuurd_oppervlak: "100",
      Contract_expiratiedatum: "31-12-2027", Contract_opzegdatum: "30-09-2027",
    },
  ]);

  schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [
    {
      Bedrijfsnr: "070", Contract: "C1", Complexnummer: "001", Unitnummer: "0001", Huurdernummer: "H1",
      Ingangsdatum: "01-01-2020", Afloopdatum: null, Check_Lopend_Contract: "Ja",
      Expiratie_Expiratiedatum: "31-12-2027", Expiratie_Opzegdatum: "30-09-2027",
      Expiratie_Aantal_per_optie: 60, Expiratie_huidige: "Ja",
      Waarborgsom: "4513.29", Waarborg_niet_geprolongeerd: "0", Waarborgbeheer: "Eigenaar",
      Complexomschrijving: "Pater van den Elsenlaan",
      Datum_laatst_geprolongreerd: "01-08-2026", Jaar_laatst_geprolongreerd: "2026", Periode_laatst_geprolongreerd: "08",
      Verhoging_datum: "01-07-2027", Verhoging_Jaar_vlgd: "2027", Verhoging_Periode_vlgd: "07",
      Verhoging_percentage: "4.4", Verhoging_methode: "Prijsindex", Omschrijving_indextabel: "CPI 2025 = 100",
    },
  ]);

  schrijfXlsxFixture(join(bronGedeeldDir(root), "saldo_huurders.xlsx"), [
    { Bedrijfsnr: "070", Huurdernr: "H1", Achterstand: "500", Achterstand_tm_30_dagen: "500", Achterstand_tm_60_dagen: "0", Achterstand_tm_90_dagen: "0", Achterstand_90plus_dagen: "0", Vooruitbetaling: "0", Saldo: "500" },
  ]);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify({ versie: "0.1", administratieId: "070_rooisezoom", regels: [] }), "utf-8");

  rebuildCache({
    root,
    administratieId: "070_rooisezoom",
    onVoortgang: () => {},
    ouderdomsanalyseMetadata: { boekjaar: 2026, boekperiode: "06", peildatum: new Date("2026-06-30T00:00:00.000Z") },
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerContractHuurderDiagnose", () => {
  it("zet contracten/rentroll/ouderdomsanalyse/ruwe contractvelden naast elkaar zonder classificatie", () => {
    const resultaat = genereerContractHuurderDiagnose(root, "070_rooisezoom");

    expect(resultaat.contracten).toHaveLength(1);
    const c1 = resultaat.contracten[0]!;
    expect(c1.contractnummer).toBe("C1");
    expect(c1.rentrollRegels).toHaveLength(1);
    expect(c1.rentrollRegels[0]?.serviceVoorschotJaar?.toString()).toBe("1200");
    expect(c1.rentrollRegels[0]?.contractExpiratiedatum).toEqual(new Date("2027-12-31T00:00:00.000Z"));

    expect(c1.ruweContractvelden).not.toBeNull();
    expect(c1.ruweContractvelden?.waarborgsom).toBe("4513.29");
    expect(c1.ruweContractvelden?.complexomschrijving).toBe("Pater van den Elsenlaan");
    expect(c1.ruweContractvelden?.verhogingDatum).toEqual(new Date("2027-07-01T00:00:00.000Z"));
    expect(c1.ruweContractvelden?.verhogingPercentage).toBe("4.4");

    expect(c1.ouderdomsanalyse).toHaveLength(1);
    expect(c1.ouderdomsanalyse[0]?.saldo.toString()).toBe("500");

    // Zonder opgegeven boekjaar/periode: geen servicekostenvoorschot-vergelijking.
    expect(resultaat.servicekostenPeriode).toBeNull();
    expect(c1.servicekostenVoorschot).toEqual([]);

    expect(resultaat.aantalContractenZonderRuweMatch).toBe(0);
    expect(resultaat.aantalRentrollRegelsZonderContractmatch).toBe(0);
    expect(resultaat.aantalOuderdomsanalyseRegelsZonderHuurdermatch).toBe(0);
  });

  it("voegt de geboekte servicekostenvoorschotten alleen toe als boekjaar/periode zijn opgegeven, apart van rentroll.service_voorschot_jaar", () => {
    const resultaat = genereerContractHuurderDiagnose(root, "070_rooisezoom", {
      servicekostenPeriode: { boekjaar: 2026, boekperiodeTotEnMet: "06" },
    });

    expect(resultaat.servicekostenPeriode).toEqual({ boekjaar: 2026, boekperiodeVan: "01", boekperiodeTotEnMet: "06" });
    const c1 = resultaat.contracten[0]!;
    expect(c1.servicekostenVoorschot).toHaveLength(1);
    expect(c1.servicekostenVoorschot[0]?.saldo.toString()).toBe("-1200");
    // rentroll.service_voorschot_jaar blijft apart zichtbaar, niet samengevoegd.
    expect(c1.rentrollRegels[0]?.serviceVoorschotJaar?.toString()).toBe("1200");
  });
});
