import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerServicekostenBronKolommenDiagnose } from "./genereerServicekostenBronKolommenDiagnose.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-servicekosten-kolommen-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerServicekostenBronKolommenDiagnose", () => {
  it("leest het RUWE bronbestand (niet de cache) en toont ook kolommen die niet in het schema staan", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), [
      {
        Bedrijfsnr: "070", Service_BK_Boekjaar: "2026", Service_BK_Boekperiode: "01", Service_BK_Dagboeknummer: "50",
        Service_BK_Boekstuknummer: "1", Service_BK_Volgnummer: "1", Service_BK_Kostensoort: "4300",
        Service_BK_Omschrijving: "Onderhoud dak", Service_BK_Bedrag_debet: "100", Service_BK_Bedrag_credit: "0",
        // Kolom die NIET in ServicekostenregelBronSchema staat — precies wat dit commando moet vinden.
        Service_BK_Grootboeknr: "1712",
      },
      {
        Bedrijfsnr: "070", Service_BK_Boekjaar: "2026", Service_BK_Boekperiode: "01", Service_BK_Dagboeknummer: "50",
        Service_BK_Boekstuknummer: "2", Service_BK_Volgnummer: "1", Service_BK_Kostensoort: "2000",
        Service_BK_Omschrijving: "Voorschot service", Service_BK_Bedrag_debet: "0", Service_BK_Bedrag_credit: "500",
        Service_BK_Grootboeknr: "1711",
      },
    ]);

    const resultaat = genereerServicekostenBronKolommenDiagnose(root, "070_rooisezoom");

    expect(resultaat.aantalRijen).toBe(2);
    const grootboek = resultaat.kolommen.find((k) => k.kolom === "Service_BK_Grootboeknr");
    expect(grootboek).toBeDefined();
    expect(grootboek?.reedsGemodelleerd).toBe(false);
    expect(grootboek?.voorbeeldwaarden.sort()).toEqual(["1711", "1712"]);

    const kostensoort = resultaat.kolommen.find((k) => k.kolom === "Service_BK_Kostensoort");
    expect(kostensoort?.reedsGemodelleerd).toBe(true);
  });

  it("gooit een duidelijke fout als het bronbestand ontbreekt", () => {
    expect(() => genereerServicekostenBronKolommenDiagnose(root, "070_rooisezoom")).toThrow(/niet gevonden/);
  });
});
