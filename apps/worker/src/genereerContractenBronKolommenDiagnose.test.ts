import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerContractenBronKolommenDiagnose } from "./genereerContractenBronKolommenDiagnose.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-contracten-kolommen-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerContractenBronKolommenDiagnose", () => {
  it("leest het RUWE bronbestand (niet de cache) en toont ook kolommen die niet in het schema staan", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [
      {
        Bedrijfsnr: "070", Contract: "C1", Complexnummer: "001", Unitnummer: "0001", Huurdernummer: "H1",
        Ingangsdatum: "01-01-2020", Afloopdatum: null, Check_Lopend_Contract: "Ja",
        // Kolom die NIET in ContractBronSchema staat — precies wat dit commando moet vinden.
        Naam_1: "Voorbeeld Huurder BV",
      },
    ]);

    const resultaat = genereerContractenBronKolommenDiagnose(root, "070_rooisezoom");

    expect(resultaat.aantalRijen).toBe(1);
    const naam = resultaat.kolommen.find((k) => k.kolom === "Naam_1");
    expect(naam).toBeDefined();
    expect(naam?.reedsGemodelleerd).toBe(false);
    expect(naam?.voorbeeldwaarden).toEqual(["Voorbeeld Huurder BV"]);

    const huurdernummer = resultaat.kolommen.find((k) => k.kolom === "Huurdernummer");
    expect(huurdernummer?.reedsGemodelleerd).toBe(true);
  });

  it("gooit een duidelijke fout als het bronbestand ontbreekt", () => {
    expect(() => genereerContractenBronKolommenDiagnose(root, "070_rooisezoom")).toThrow(/niet gevonden/);
  });
});
