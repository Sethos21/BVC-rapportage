import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerBoekingenBronKolommenDiagnose } from "./genereerBoekingenBronKolommenDiagnose.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-boekingen-kolommen-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerBoekingenBronKolommenDiagnose", () => {
  it("leest het RUWE bronbestand (niet de cache) en toont ook kolommen die niet in BoekingsregelBronSchema staan", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
      {
        Bedrijfsnr: "070", Boekstuk_Sleutel: "202550000001", Boeking_Dagboeknr: "50", Boeking_Boekjaar: "2025",
        Boeking_Boekperiode: "01", Boeking_Boekstuknr: "1", Boeking_Volgnr: "1", Boeking_Boekdatum: "2025-01-15",
        Boeking_Grootboeknr: "4300", Boeking_Bedrag_Debet: "100", Boeking_Bedrag_Credit: "0",
        Boeking_Omschrijving: "test onderhoud",
        // Kolommen die NIET in BoekingsregelBronSchema staan — precies wat dit commando moet vinden.
        Exploitatie_Kostensoort: "0014",
        Boeking_Activiteitcode: "PLAN",
      },
      {
        Bedrijfsnr: "070", Boekstuk_Sleutel: "202550000002", Boeking_Dagboeknr: "50", Boeking_Boekjaar: "2025",
        Boeking_Boekperiode: "02", Boeking_Boekstuknr: "2", Boeking_Volgnr: "1", Boeking_Boekdatum: "2025-02-10",
        Boeking_Grootboeknr: "4340", Boeking_Bedrag_Debet: "200", Boeking_Bedrag_Credit: "0",
        Boeking_Omschrijving: "test installatie",
        Exploitatie_Kostensoort: "0022",
        Boeking_Activiteitcode: "CORR",
      },
    ]);

    const resultaat = genereerBoekingenBronKolommenDiagnose(root, "070_rooisezoom");

    expect(resultaat.aantalRijen).toBe(2);

    const exploitatieKostensoort = resultaat.kolommen.find((k) => k.kolom === "Exploitatie_Kostensoort");
    expect(exploitatieKostensoort).toBeDefined();
    expect(exploitatieKostensoort?.reedsGemodelleerd).toBe(false);
    expect(exploitatieKostensoort?.voorbeeldwaarden.sort()).toEqual(["0014", "0022"]);

    const grootboeknr = resultaat.kolommen.find((k) => k.kolom === "Boeking_Grootboeknr");
    expect(grootboeknr?.reedsGemodelleerd).toBe(true);
  });

  it("gooit een duidelijke fout als het bronbestand ontbreekt", () => {
    expect(() => genereerBoekingenBronKolommenDiagnose(root, "070_rooisezoom")).toThrow(/niet gevonden/);
  });
});
