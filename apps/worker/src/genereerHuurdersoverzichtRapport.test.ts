import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerHuurdersoverzichtRapport } from "./genereerHuurdersoverzichtRapport.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, grootboekmappingPad, grootboekmappingenDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-huurdersoverzicht-rapport-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "070 Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);

  schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [
    {
      Bedrijfsnr: "070", Contract: "0000000043", Complexnummer: "001", Unitnummer: null, Huurdernummer: "00000028",
      Ingangsdatum: "28-08-2021", Afloopdatum: null, Check_Lopend_Contract: "Ja",
      Expiratie_Expiratiedatum: "31-05-2030", Expiratie_Opzegdatum: "31-05-2029", Expiratie_Aantal_per_optie: 12, Expiratie_huidige: "Ja",
      Huurder_Naam_1: "Destiny B.V.", Waarborgsom: "0", Complexomschrijving: "Villa I",
      Verhoging_datum: "01-06-2027", Verhoging_Jaar_vlgd: "2027", Verhoging_Periode_vlgd: "06",
      Verhoging_percentage: "0", Verhoging_methode: "Prijsindex", Omschrijving_indextabel: "CPI 2025 = 100",
    },
  ]);

  schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [
    {
      Bedrijfsnummer: "070", Contractnummer: "0000000043", Vorderingsoort: "01", Unitnummer: null, Complexnummer: "001",
      Rapportage_datum: "31-07-2026", Prolongatie_bedrag_jaar: "92875.92", Korting_bedrag_jaar: "0",
      Service_voorschot_jaar: "59700", Gehuurd_oppervlak: "750",
      Contract_expiratiedatum: "31-05-2030", Contract_opzegdatum: "31-05-2029",
    },
  ]);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify({ versie: "0.1", administratieId: "070_rooisezoom", regels: [] }), "utf-8");

  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerHuurdersoverzichtRapport", () => {
  it("schrijft een zelfstandig HTML-rapport naar rapporten/, met de administratienaam en het bewezen resultaat", () => {
    const { html, pad, resultaat } = genereerHuurdersoverzichtRapport(root, "070_rooisezoom");

    expect(existsSync(pad)).toBe(true);
    expect(pad).toContain("huurdersoverzicht-");
    expect(readFileSync(pad, "utf-8")).toBe(html);

    expect(html).toContain("070 Rooise Zoom");
    expect(html).toContain("Destiny B.V.");
    expect(html).toContain("niet geregistreerd"); // contract 0000000043 zonder unitnummer, nooit verzonnen.
    expect(html).toContain("€ 92.875,92");
    expect(html).toContain("750 m²");

    expect(resultaat.contracten).toHaveLength(1);
    expect(resultaat.contracten[0]!.unitnummer).toBeNull();
  });
});
