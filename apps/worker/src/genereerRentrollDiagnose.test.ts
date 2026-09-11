import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerRentrollDiagnose } from "./genereerRentrollDiagnose.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, grootboekmappingPad, grootboekmappingenDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-rentroll-diagnose-"));
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
      Rapportage_datum: "30-06-2026", Prolongatie_bedrag_jaar: "-1000", Korting_bedrag_jaar: "-1000",
      Service_voorschot_jaar: null, Gehuurd_oppervlak: "0", Contract_expiratiedatum: null, Contract_opzegdatum: null,
    },
    {
      // Contractnummer zonder match in contracten.xlsx — moet als "niet_gevonden" gemeld worden.
      Bedrijfsnummer: "070", Contractnummer: "C2", Vorderingsoort: "01", Unitnummer: "0002", Complexnummer: "001",
      Rapportage_datum: "30-06-2026", Prolongatie_bedrag_jaar: "5000", Korting_bedrag_jaar: null,
      Service_voorschot_jaar: null, Gehuurd_oppervlak: "50", Contract_expiratiedatum: null, Contract_opzegdatum: null,
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

describe("genereerRentrollDiagnose", () => {
  it("leest rentroll/contracten uit de cache en koppelt/aggregeert zonder te gokken", () => {
    const resultaat = genereerRentrollDiagnose(root, "070_rooisezoom");

    expect(resultaat.regels).toHaveLength(3);

    const c1Huur = resultaat.regels.find((r) => r.contractnummer === "C1" && r.vorderingsoort === "01");
    expect(c1Huur?.contract).toEqual({
      status: "gekoppeld",
      ingangsdatum: new Date("2020-01-01T00:00:00.000Z"),
      afloopdatum: null,
      expiratieExpiratiedatum: new Date("2027-12-31T00:00:00.000Z"),
      checkLopendContract: "Ja",
    });

    const c2 = resultaat.regels.find((r) => r.contractnummer === "C2");
    expect(c2?.contract).toEqual({ status: "niet_gevonden" });

    const totaal01 = resultaat.totalenPerVorderingsoort.find((t) => t.vorderingsoort === "01");
    expect(totaal01?.somProlongatieBedragJaar.toString()).toBe("15000");
    expect(totaal01?.somGehuurdOppervlak.toString()).toBe("150");
    expect(totaal01?.aantalUniekeContracten).toBe(2);

    const totaal13 = resultaat.totalenPerVorderingsoort.find((t) => t.vorderingsoort === "13");
    expect(totaal13?.somProlongatieBedragJaar.toString()).toBe("-1000");

    expect(resultaat.onverwachteVorderingsoorten).toEqual([]);
  });
});
