import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerVastgoedKerncijfers } from "./genereerVastgoedKerncijfers.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, grootboekmappingPad, grootboekmappingenDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-vastgoed-kerncijfers-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  // Financiële bronnen: leeg/minimaal, deze module gebruikt ze niet — alleen aanwezig omdat rebuildCache ze verwacht.
  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);

  // Vastgoedbronnen: twee complexen — 001 sluit volledig, 002 heeft een unit zonder contract (leegstand) EN een complex_totalen-afwijking.
  schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), [
    { Bedrijfsnr: "070", Complexnummer: "001", Unitnummer: "0001", Unit_Non_actief: "Nee", Unitomschrijving: "Unit A", Unitsoort: "Kantoor", Unit_VVO: "100", Unit_BVO: "110" },
    { Bedrijfsnr: "070", Complexnummer: "002", Unitnummer: "0001", Unit_Non_actief: "Nee", Unitomschrijving: "Unit B", Unitsoort: "Kantoor", Unit_VVO: "50", Unit_BVO: "55" },
    { Bedrijfsnr: "070", Complexnummer: "002", Unitnummer: "0002", Unit_Non_actief: "Nee", Unitomschrijving: "Unit C (leeg)", Unitsoort: "Kantoor", Unit_VVO: "20", Unit_BVO: "22" },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [
    {
      Bedrijfsnummer: "070", Contractnummer: "C1", Vorderingsoort: "01", Unitnummer: "0001", Complexnummer: "001",
      Rapportage_datum: "30-06-2026", Prolongatie_bedrag_jaar: "10000", Korting_bedrag_jaar: null,
      Service_voorschot_jaar: null, Gehuurd_oppervlak: "100", Contract_expiratiedatum: null, Contract_opzegdatum: null,
    },
    {
      Bedrijfsnummer: "070", Contractnummer: "C2", Vorderingsoort: "01", Unitnummer: "0001", Complexnummer: "002",
      Rapportage_datum: "30-06-2026", Prolongatie_bedrag_jaar: "5000", Korting_bedrag_jaar: null,
      Service_voorschot_jaar: null, Gehuurd_oppervlak: "50", Contract_expiratiedatum: null, Contract_opzegdatum: null,
    },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), [
    { Bedrijfsnr: "070", Complexnr: "001", Totaal_Oppervlakte: "100", Totaal_Verhuurd: "100", Totaal_Leegstand: "0" },
    // Bewuste afwijking: complex_totalen zegt 0 leegstand, bottom-up (units - rentroll) zegt 20.
    { Bedrijfsnr: "070", Complexnr: "002", Totaal_Oppervlakte: "70", Totaal_Verhuurd: "50", Totaal_Leegstand: "0" },
  ]);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify({ versie: "0.1", administratieId: "070_rooisezoom", regels: [] }), "utf-8");

  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerVastgoedKerncijfers", () => {
  it("leest units/rentroll/complex_totalen uit de cache en berekent de vastgoed-KPI's bottom-up, momentopname", () => {
    const resultaat = genereerVastgoedKerncijfers(root, "070_rooisezoom");

    expect(resultaat.momentopname).toBe(true);
    expect(resultaat.bronPeildatum).toEqual(new Date("2026-06-30T00:00:00.000Z"));

    expect(resultaat.portefeuille.totaalVvo).toEqual({ type: "bekend", waarde: expect.anything() });
    if (resultaat.portefeuille.totaalVvo.type === "bekend") {
      expect(resultaat.portefeuille.totaalVvo.waarde.toString()).toBe("170");
    }
    if (resultaat.portefeuille.verhuurdeVvo.type === "bekend") {
      expect(resultaat.portefeuille.verhuurdeVvo.waarde.toString()).toBe("150");
    }
    if (resultaat.portefeuille.leegstandVvo.type === "bekend") {
      expect(resultaat.portefeuille.leegstandVvo.waarde.toString()).toBe("20");
    }

    const complex002 = resultaat.perComplex.find((c) => c.complexnr === "002");
    expect(complex002?.leegstandVvo).toEqual({ type: "bekend", waarde: expect.anything() });
    if (complex002?.leegstandVvo.type === "bekend") {
      expect(complex002.leegstandVvo.waarde.toString()).toBe("20");
    }

    // complex_totalen zegt 0 leegstand voor 002 — dat moet als controleVereist zichtbaar blijven, ook al is de KPI zelf betrouwbaar.
    expect(resultaat.controleVereist.some((i) => i.complexnr === "002" && i.ernst === "WAARSCHUWING" && i.bericht.includes("Totaal_Leegstand"))).toBe(true);
  });
});
