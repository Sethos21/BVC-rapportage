import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerServicekostenAfrekeningDiagnose } from "./genereerServicekostenAfrekeningDiagnose.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-servicekosten-afrekening-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function basisRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "070", Service_BK_Boekjaar: "2026", Service_BK_Boekperiode: "01", Service_BK_Dagboeknummer: "50",
    Service_BK_Boekstuknummer: "1", Service_BK_Volgnummer: "1", Service_BK_Kostensoort: "0014",
    Service_BK_Bedrag_debet: "100", Service_BK_Bedrag_credit: "0", Kostensoort_Soort: "Kosten",
    ...overrides,
  };
}

describe("genereerServicekostenAfrekeningDiagnose", () => {
  it("leest het RUWE bronbestand, filtert op bedrijfsnr, en vult de metadata", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), [
      basisRij({ Service_BK_Boekstuknummer: "1" }),
      basisRij({ Bedrijfsnr: "074", Service_BK_Boekstuknummer: "2" }), // andere administratie, mag niet meetellen
      basisRij({
        Service_BK_Boekstuknummer: "3", Service_BK_Kostensoort: "2000", Kostensoort_Soort: "Voorschotten",
        Service_BK_Bedrag_debet: "0", Service_BK_Bedrag_credit: "500",
      }),
      basisRij({ Service_BK_Boekstuknummer: "4", Service_BK_Kostensoort: "9600", Kostensoort_Soort: "Nvt", Service_BK_Jaar_Afrekening: "2025" }),
    ]);

    const resultaat = genereerServicekostenAfrekeningDiagnose(root, "070_rooisezoom");

    expect(resultaat.metadata.administratieId).toBe("070_rooisezoom");
    expect(resultaat.metadata.bedrijfsnr).toBe("070");
    expect(resultaat.metadata.diagnoseVersie).toBe("1.0.0");
    expect(resultaat.metadata.aantalRuweRijen).toBe(4);
    expect(resultaat.metadata.aantalGeparsedeRijen).toBe(3); // 074-rij eruit gefilterd
    expect(resultaat.metadata.bronBestand).toContain("servicekosten.xlsx");

    expect(resultaat.analyse.aantalRegelsTotaal).toBe(3);
    expect(resultaat.analyse.voorschotten.bevat2000).toBe(true);
    expect(resultaat.analyse.kostensoort9600.aantalRegels).toBe(1);
    expect(resultaat.analyse.kostensoort9600.regelsMetAfrekeningsvelden.voorbeeld[0]?.jaarAfrekening).toBe("2025");
    expect(resultaat.parseIssues.aantalTotaal).toBe(0);
  });

  it("meldt een rij die niet aan het schema voldoet als parseIssue, zonder de andere rijen te raken", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), [
      basisRij({ Service_BK_Boekstuknummer: "1", Service_BK_Kostensoort: null }), // verplicht veld ontbreekt
      basisRij({ Service_BK_Boekstuknummer: "2" }),
    ]);

    const resultaat = genereerServicekostenAfrekeningDiagnose(root, "070_rooisezoom");

    expect(resultaat.metadata.aantalRuweRijen).toBe(2);
    expect(resultaat.metadata.aantalGeparsedeRijen).toBe(1);
    expect(resultaat.parseIssues.aantalTotaal).toBe(1);
    expect(resultaat.analyse.aantalRegelsTotaal).toBe(1);
  });

  it("gooit een duidelijke fout als het bronbestand ontbreekt", () => {
    expect(() => genereerServicekostenAfrekeningDiagnose(root, "070_rooisezoom")).toThrow(/niet gevonden/);
  });
});
