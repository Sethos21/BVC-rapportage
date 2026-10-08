import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerVorderingenBronKolommenDiagnose } from "./genereerVorderingenBronKolommenDiagnose.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-vorderingen-kolommen-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerVorderingenBronKolommenDiagnose", () => {
  it("leest het RUWE bronbestand (niet de cache) en toont ook kolommen die niet in het schema staan, met waargenomenFormaat/aandachtKolommen", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "vorderingen_met_afboekingen.xlsx"), [
      {
        Bedrijfsnr: "070", Contractnr: "C1", Vordering_Volgnr: "1", Huurdernr: "H1",
        Datum_Vordering: "01-09-2026", Vordering_Totaalbedrag: 100, Bedrag_afgeboekt: 0, Vordering_openstaand: 100,
        // Kolommen die NIET in VorderingMetAfboekingBronSchema staan — precies wat dit commando moet vinden.
        Vordering_afgehandeld_datum: "15-09-2026",
        VS_01_Bedrag: "50.00",
      },
    ]);

    const resultaat = genereerVorderingenBronKolommenDiagnose(root, "070_rooisezoom");

    expect(resultaat.aantalRijen).toBe(1);

    const bekend = resultaat.kolommen.find((k) => k.kolom === "Datum_Vordering");
    expect(bekend?.reedsGemodelleerd).toBe(true);
    expect(bekend?.waargenomenFormaat).toBe("datum (dd-mm-jjjj)");

    const afgehandeldDatum = resultaat.kolommen.find((k) => k.kolom === "Vordering_afgehandeld_datum");
    expect(afgehandeldDatum?.reedsGemodelleerd).toBe(false);
    expect(afgehandeldDatum?.waargenomenFormaat).toBe("datum (dd-mm-jjjj)");
    expect(afgehandeldDatum?.voorbeeldwaarden).toEqual(["15-09-2026"]);

    const vs01 = resultaat.kolommen.find((k) => k.kolom === "VS_01_Bedrag");
    expect(vs01?.reedsGemodelleerd).toBe(false);
    expect(vs01?.waargenomenFormaat).toBe("numeriek");

    expect(resultaat.aandachtKolommen).toEqual(expect.arrayContaining(["Vordering_afgehandeld_datum", "VS_01_Bedrag", "Datum_Vordering", "Vordering_openstaand"]));
    expect(resultaat.aantalKolommen).toBe(resultaat.kolommen.length);
  });

  it("gooit een duidelijke fout als het bronbestand ontbreekt", () => {
    expect(() => genereerVorderingenBronKolommenDiagnose(root, "070_rooisezoom")).toThrow(/niet gevonden/);
  });
});
