import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerContractVerhogingenDiagnose } from "./genereerContractVerhogingenDiagnose.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, grootboekmappingPad, grootboekmappingenDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-contract-verhogingen-diagnose-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);

  schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [
    { Bedrijfsnr: "070", Contract: "C1", Complexnummer: "001", Unitnummer: "0001", Huurdernummer: "H1", Ingangsdatum: "01-01-2020", Check_Lopend_Contract: "Ja" },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [
    {
      Bedrijfsnummer: "070", Contractnummer: "C1", Vorderingsoort: "01", Unitnummer: "0001", Complexnummer: "001",
      Rapportage_datum: "31-07-2026", Prolongatie_bedrag_jaar: "9360", Gehuurd_oppervlak: "100",
    },
  ]);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify({ versie: "0.1", administratieId: "070_rooisezoom", regels: [] }), "utf-8");

  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerContractVerhogingenDiagnose", () => {
  it("meldt bronBestaat:false zonder crash als contract_verhogingen.xlsx nog niet bestaat", () => {
    const resultaat = genereerContractVerhogingenDiagnose(root, "070_rooisezoom");
    expect(resultaat.bronBestaat).toBe(false);
    expect(resultaat.historiePerContract).toEqual([]);
  });

  it("filtert strikt op Bedrijfsnr — een botsend contractnummer bij een andere administratie mag nooit meetellen", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contract_verhogingen.xlsx"), [
      {
        Bedrijfsnr: "070", Contract: "C1", Huurdernr: "H1", Complexnr: "001", Unitnr: "0001",
        Jaar: "2026", Periode: "01", Status: "Verwerkt", Verhogingsmethode: "Prijsindex", Waarde: "4",
        Totaal_Oud: "9000", Totaal_Nieuw: "9360", Bedrag_oud_VS_01: "9000", Bedrag_Nieuw_VS_01: "9360",
        Toekomstige_verhoging: "Nee", Regelnummer: "1",
      },
      {
        // Zelfde contractnummer, ANDERE administratie — mag niet meetellen voor 070.
        Bedrijfsnr: "002", Contract: "C1", Huurdernr: "H-anders", Complexnr: "999", Unitnr: "9999",
        Jaar: "2026", Periode: "01", Status: "Verwerkt", Waarde: "99", Totaal_Oud: "1", Totaal_Nieuw: "2",
      },
    ]);

    const resultaat = genereerContractVerhogingenDiagnose(root, "070_rooisezoom");

    expect(resultaat.bronBestaat).toBe(true);
    expect(resultaat.koppeling.aantalRegels070).toBe(1);
    expect(resultaat.historiePerContract).toHaveLength(1);
    expect(resultaat.historiePerContract[0]!.regels[0]!.regel.waarde?.toString()).toBe("4");

    const rec = resultaat.reconciliatie[0]!;
    expect(rec.kandidaatLaatsteRegel?.regel.jaar).toBe("2026");
    expect(rec.vsVergelijking[0]!.verschilMetBrutoJaarhuur?.toString()).toBe("0"); // VS_01 nieuw (9360) == rentroll bruto jaarhuur (9360).
  });
});
