import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { leesBgContractFeitenVoorAdministratie } from "./contractenRentrollAdapter.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

/**
 * TRANCHE 12 — bewijst de Contracten/RentRoll → BgContractFeiten-adapter via ECHTE, synthetische
 * xlsx-bronbestanden door dezelfde `ExcelBronAdapter`/`resolveBron`-productieketen als
 * `genereerPnLPeriode.test.ts`. Dit is FIXTUREBEWIJS van de codeketen, geen bewijs van een
 * werkelijk BVC-productiecontract — zie het acceptatierapport voor het onderscheid.
 */

let root: string;
const ADMINISTRATIE_ID = "070_rooisezoom";
const BEDRIJFSNR = "070";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-contracten-rentroll-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, ADMINISTRATIE_ID), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function contractRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: BEDRIJFSNR,
    Contract: "0000000043",
    Complexnummer: "001",
    Unitnummer: "0001",
    Huurdernummer: "00000028",
    Huurder_Naam_1: "Voorbeeld Huurder BV",
    Ingangsdatum: "01-01-2020",
    Expiratie_Expiratiedatum: "31-12-2030",
    Verhoging_datum: "01-08-2026",
    Verhoging_opnieuw_na: 12,
    ...overrides,
  };
}

function rentrollRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnummer: BEDRIJFSNR,
    Contractnummer: "0000000043",
    Vorderingsoort: "01",
    Unitnummer: "0001",
    Complexnummer: "001",
    Prolongatie_bedrag_jaar: 12000,
    BTW_Y_N: "Y",
    ...overrides,
  };
}

describe("leesBgContractFeitenVoorAdministratie — Contracten/RentRoll → BgContractFeiten (Tranche 12, fixturebewijs)", () => {
  beforeEach(() => {
    schrijfAdministratieConfig(root, ADMINISTRATIE_ID, nieuweAdministratieConfig(BEDRIJFSNR, "Rooise Zoom"));
  });

  it("bouwt één BgContractFeiten met VS01+VS13-componenten, bewezen bronvelden correct doorgegeven", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [contractRij()]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [rentrollRij({ Vorderingsoort: "01", Prolongatie_bedrag_jaar: 12000 }), rentrollRij({ Vorderingsoort: "13", Prolongatie_bedrag_jaar: -500 })]);

    const resultaat = leesBgContractFeitenVoorAdministratie(root, ADMINISTRATIE_ID, BEDRIJFSNR);

    expect(resultaat.bronBeschikbaar).toBe(true);
    expect(resultaat.contracten).toHaveLength(1);
    const c = resultaat.contracten[0]!;
    expect(c.contractnummer).toBe("0000000043");
    expect(c.huurderNaam).toBe("Voorbeeld Huurder BV");
    expect(c.einddatum?.toISOString().slice(0, 10)).toBe("2030-12-31"); // Expiratie_Expiratiedatum, niet Afloopdatum
    expect(c.indexatiedatum?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(c.indexatieHerhalingMaanden).toBe(12);
    expect(c.rentrollComponenten).toHaveLength(2);
    expect(c.rentrollComponenten.find((r) => r.vorderingsoort === "01")!.bedragJaar.toString()).toBe("12000");
    expect(c.rentrollComponenten.find((r) => r.vorderingsoort === "01")!.btwYn).toBe("Y");
    expect(c.rentrollComponenten.find((r) => r.vorderingsoort === "13")!.bedragJaar.toString()).toBe("-500");
    expect(c.toekomstigeKortingswijzigingen).toEqual([]); // niet gebouwd in Tranche 12, zie moduledoc
  });

  it("filtert niet-relevante Vorderingsoort-regels (bv. '12', Compensatie OB) uit rentrollComponenten", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [contractRij()]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [rentrollRij({ Vorderingsoort: "01" }), rentrollRij({ Vorderingsoort: "12", Prolongatie_bedrag_jaar: 999 })]);

    const resultaat = leesBgContractFeitenVoorAdministratie(root, ADMINISTRATIE_ID, BEDRIJFSNR);
    expect(resultaat.contracten[0]!.rentrollComponenten).toHaveLength(1);
    expect(resultaat.contracten[0]!.rentrollComponenten[0]!.vorderingsoort).toBe("01");
  });

  it("administratie-isolatie: een contract/rentrollregel van een andere Bedrijfsnr/Bedrijfsnummer komt niet in de snapshot terecht (beide bronnen zijn gedeeld)", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [contractRij(), contractRij({ Bedrijfsnr: "003", Contract: "0000000099" })]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [rentrollRij(), rentrollRij({ Bedrijfsnummer: "003", Contractnummer: "0000000099" })]);

    const resultaat = leesBgContractFeitenVoorAdministratie(root, ADMINISTRATIE_ID, BEDRIJFSNR);
    expect(resultaat.contracten).toHaveLength(1);
    expect(resultaat.contracten[0]!.contractnummer).toBe("0000000043");
    expect(resultaat.aantalContractenNaFilter).toBe(1);
    expect(resultaat.aantalRentrollNaFilter).toBe(1);
    expect(resultaat.aantalRuweContractenRegels).toBe(2); // vóór filter: beide administraties zaten in het gedeelde bestand
  });

  it("een contract zonder enige rentrollregel krijgt een lege rentrollComponenten-lijst, geen verzonnen bedrag", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [contractRij()]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), []);

    const resultaat = leesBgContractFeitenVoorAdministratie(root, ADMINISTRATIE_ID, BEDRIJFSNR);
    expect(resultaat.contracten[0]!.rentrollComponenten).toEqual([]);
  });

  it("ontbreekt één van beide bronbestanden, dan blijft de volledige snapshot leeg (unknown ≠ €0, geen misleidende gedeeltelijke snapshot)", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [contractRij()]);
    // rentroll.xlsx bewust niet aangemaakt.

    const resultaat = leesBgContractFeitenVoorAdministratie(root, ADMINISTRATIE_ID, BEDRIJFSNR);
    expect(resultaat.bronBeschikbaar).toBe(false);
    expect(resultaat.contracten).toEqual([]);
  });
});
