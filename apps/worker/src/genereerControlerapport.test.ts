import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerControlerapport } from "./genereerControlerapport.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-controlerapport-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
    {
      Bedrijfsnr: "070", Boekstuk_Sleutel: "0704020024001", Boeking_Dagboeknr: "20", Boeking_Boekjaar: 2024,
      Boeking_Boekperiode: "01", Boeking_Boekstuknr: "024001", Boeking_Volgnr: "000001", Boeking_Boekdatum: "01-01-2024",
      Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 1665.54, Boeking_Bedrag_Credit: 0, Boeking_Omschrijving: "Huur", Boeking_Saldo: "#REF!",
    },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
    { Bedrijfsnr: "070", Jaar: 2024, Grootboekrekeningnr: "1300", Saldo_debet: "0", Saldo_credit: "0", Eindsaldo: "-1487022.79", Rekening_omschrijving: "Bank" },
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), [
    {
      Bedrijfsnr: "070", Service_BK_Boekjaar: 2024, Service_BK_Boekperiode: "01", Service_BK_Dagboeknummer: "50",
      Service_BK_Boekstuknummer: "003", Service_BK_Volgnummer: "001", Service_BK_Kostensoort: "0014",
      Kostensoort_omschrijving: "Onderhoud", Service_BK_Bedrag_debet: "67.5", Service_BK_Bedrag_credit: "0",
    },
  ]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerControlerapport", () => {
  it("bouwt het rapport uit een echte cache en schrijft het naar rapporten/", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const resultaat = genereerControlerapport(root, "070_rooisezoom");

    expect(existsSync(resultaat.pad)).toBe(true);
    expect(resultaat.pad).toContain(join("070_rooisezoom", "rapporten"));
    const geschrevenInhoud = readFileSync(resultaat.pad, "utf-8");
    expect(geschrevenInhoud).toBe(resultaat.html);

    expect(resultaat.html).toContain("Rooise Zoom");
    expect(resultaat.html).toContain("1010"); // grootboeknr uit boekingen
    expect(resultaat.html).toContain("1300"); // grootboekrekeningnr uit balans
    expect(resultaat.html).toContain("0014"); // kostensoort uit servicekosten
  });

  it("meldt ouderdomsanalyse als niet-geladen (geen boekjaar/boekperiode/peildatum meegegeven bij rebuild)", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const resultaat = genereerControlerapport(root, "070_rooisezoom");
    expect(resultaat.html).toContain("Ouderdomsanalyse: nog niet geladen");
  });

  it("meldt begroting als nog niet gekoppeld, zonder te blokkeren", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const resultaat = genereerControlerapport(root, "070_rooisezoom");
    expect(resultaat.html).toContain("Begroting");
    expect(resultaat.html).toContain("blokkeert dit rapport niet");
  });

  it("gooit een duidelijke fout als er nog geen cache is (eerst rebuild-cache draaien)", () => {
    expect(() => genereerControlerapport(root, "070_rooisezoom")).toThrow(/Cache ontbreekt/);
  });
});
