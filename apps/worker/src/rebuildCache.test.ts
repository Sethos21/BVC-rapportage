import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieCachePad, administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-cache-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "002_fergagne"), { recursive: true });
  mkdirSync(administratieDir(root, "003_cosinus"), { recursive: true });
  schrijfAdministratieConfig(root, "002_fergagne", nieuweAdministratieConfig("002", "Fergagne bv"));
  schrijfAdministratieConfig(root, "003_cosinus", nieuweAdministratieConfig("003", "Maatschap Cosinus Veghel"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("rebuildCache — administratiescheiding op een gedeelde bron", () => {
  it("neemt uit een gedeelde Boekingen-export met meerdere administraties alleen de rijen van de gekozen administratie op", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
      {
        Bedrijfsnr: "002", Boekstuk_Sleutel: "0024001", Boeking_Dagboeknr: "20", Boeking_Boekjaar: 2024,
        Boeking_Boekperiode: "01", Boeking_Boekstuknr: "024001", Boeking_Volgnr: "000001", Boeking_Boekdatum: "01-01-2024",
        Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 100, Boeking_Bedrag_Credit: 0, Boeking_Omschrijving: "admin 002",
      },
      {
        Bedrijfsnr: "003", Boekstuk_Sleutel: "0034001", Boeking_Dagboeknr: "20", Boeking_Boekjaar: 2024,
        Boeking_Boekperiode: "01", Boeking_Boekstuknr: "034001", Boeking_Volgnr: "000001", Boeking_Boekdatum: "01-01-2024",
        Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 200, Boeking_Bedrag_Credit: 0, Boeking_Omschrijving: "admin 003",
      },
    ]);

    const resultaatA = rebuildCache({ root, administratieId: "002_fergagne" });
    expect(resultaatA.rowCounts["boekingen"]).toBe(1);

    const cacheA = new DatabaseSync(administratieCachePad(root, "002_fergagne"), { readOnly: true });
    const rijenA = cacheA.prepare("SELECT bedrijfsnr, omschrijving FROM boekingen").all();
    cacheA.close();
    expect(rijenA).toEqual([{ bedrijfsnr: "002", omschrijving: "admin 002" }]);

    const resultaatB = rebuildCache({ root, administratieId: "003_cosinus" });
    expect(resultaatB.rowCounts["boekingen"]).toBe(1);
    const cacheB = new DatabaseSync(administratieCachePad(root, "003_cosinus"), { readOnly: true });
    const rijenB = cacheB.prepare("SELECT bedrijfsnr, omschrijving FROM boekingen").all();
    cacheB.close();
    expect(rijenB).toEqual([{ bedrijfsnr: "003", omschrijving: "admin 003" }]);

    // Kruiscontrole: geen enkele rij van de ene administratie lekt naar de cache van de andere.
    expect(rijenA.some((r) => (r as { bedrijfsnr: string }).bedrijfsnr === "003")).toBe(false);
    expect(rijenB.some((r) => (r as { bedrijfsnr: string }).bedrijfsnr === "002")).toBe(false);
  });

  it("meldt ontbrekende bronnen expliciet i.p.v. de cache stilzwijgend leeg te laten zonder signaal", () => {
    const resultaat = rebuildCache({ root, administratieId: "002_fergagne" });
    expect(resultaat.ontbrekendeBronnen).toContain("boekingen");
    expect(resultaat.rowCounts["boekingen"]).toBe(0);
  });

  it("is volledig herbouwbaar: twee keer achter elkaar herbouwen geeft hetzelfde resultaat", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
      {
        Bedrijfsnr: "002", Boekstuk_Sleutel: "0024001", Boeking_Dagboeknr: "20", Boeking_Boekjaar: 2024,
        Boeking_Boekperiode: "01", Boeking_Boekstuknr: "024001", Boeking_Volgnr: "000001", Boeking_Boekdatum: "01-01-2024",
        Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 100, Boeking_Bedrag_Credit: 0, Boeking_Omschrijving: "test",
      },
    ]);

    const eerste = rebuildCache({ root, administratieId: "002_fergagne" });
    const tweede = rebuildCache({ root, administratieId: "002_fergagne" });
    expect(tweede.rowCounts).toEqual(eerste.rowCounts);
  });
});
