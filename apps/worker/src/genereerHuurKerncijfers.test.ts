import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerHuurKerncijfers } from "./genereerHuurKerncijfers.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, grootboekmappingPad, grootboekmappingenDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-huur-kerncijfers-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);

  schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [
    {
      Bedrijfsnummer: "070", Contractnummer: "C1", Vorderingsoort: "01", Unitnummer: "0001", Complexnummer: "001",
      Rapportage_datum: "30-06-2026", Prolongatie_bedrag_jaar: "10000", Korting_bedrag_jaar: null,
      Service_voorschot_jaar: null, Gehuurd_oppervlak: "100", Contract_expiratiedatum: null, Contract_opzegdatum: null,
    },
    {
      Bedrijfsnummer: "070", Contractnummer: "C1", Vorderingsoort: "13", Unitnummer: null, Complexnummer: "001",
      Rapportage_datum: "30-06-2026", Prolongatie_bedrag_jaar: "-1000", Korting_bedrag_jaar: null,
      Service_voorschot_jaar: null, Gehuurd_oppervlak: "0", Contract_expiratiedatum: null, Contract_opzegdatum: null,
    },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [
    {
      Bedrijfsnr: "070", Contract: "C1", Complexnummer: "001", Unitnummer: "0001", Huurdernummer: "H1",
      Ingangsdatum: "01-01-2020", Afloopdatum: null, Check_Lopend_Contract: "Ja",
      Expiratie_Expiratiedatum: "31-12-2027", Expiratie_Opzegdatum: null, Expiratie_Aantal_per_optie: null, Expiratie_huidige: "Ja",
    },
  ]);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify({ versie: "0.1", administratieId: "070_rooisezoom", regels: [] }), "utf-8");

  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerHuurKerncijfers", () => {
  it("leest rentroll/contracten uit de cache en berekent bruto/netto jaarhuur + huur per m²", () => {
    const resultaat = genereerHuurKerncijfers(root, "070_rooisezoom");

    expect(resultaat.momentopname).toBe(true);
    expect(resultaat.bronPeildatum).toEqual(new Date("2026-06-30T00:00:00.000Z"));

    expect(resultaat.portefeuille.brutoJaarhuur).toEqual({ type: "bekend", waarde: expect.anything() });
    if (resultaat.portefeuille.brutoJaarhuur.type === "bekend") {
      expect(resultaat.portefeuille.brutoJaarhuur.waarde.toString()).toBe("10000");
    }
    if (resultaat.portefeuille.huurkortingen.type === "bekend") {
      expect(resultaat.portefeuille.huurkortingen.waarde.toString()).toBe("1000");
    }
    if (resultaat.portefeuille.nettoJaarhuur.type === "bekend") {
      expect(resultaat.portefeuille.nettoJaarhuur.waarde.toString()).toBe("9000");
    }
    if (resultaat.portefeuille.verhuurdeVvo.type === "bekend") {
      expect(resultaat.portefeuille.verhuurdeVvo.waarde.toString()).toBe("100");
    }
  });
});
