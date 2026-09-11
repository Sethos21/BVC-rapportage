import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerOnderhoudBoekingenDiagnose } from "./genereerOnderhoudBoekingenDiagnose.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

function boekingRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "070",
    Boekstuk_Sleutel: "0705000001",
    Boeking_Dagboeknr: "50",
    Boeking_Boekjaar: 2025,
    Boeking_Boekperiode: "01",
    Boeking_Boekstuknr: "100",
    Boeking_Volgnr: "1",
    Boeking_Boekdatum: "01-01-2025",
    Boeking_Grootboeknr: "4300",
    Boeking_Bedrag_Debet: 100,
    Boeking_Bedrag_Credit: 0,
    Boeking_Omschrijving: "daklekkage herstel",
    Boeking_Complexnr: "001   ",
    Dagboekomschrijving: "Inkoop",
    Boeking_OGB_Kostensoort: "4200",
    Boeking_OGB_Kostensoort_Omschr: "Dak",
    Factuur_Relatienr: "C001",
    Factuur_Relatie_Naam_1: "Dakdekker BV",
    ...overrides,
  };
}

function unitRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { Bedrijfsnr: "070", Complexnummer: "001", Unitnummer: "0001", ...overrides };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-onderhoud-boekingen-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function schrijfBasisBronnen(boekingen: Record<string, unknown>[], units: Record<string, unknown>[]): void {
  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), boekingen);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), units);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);
  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
}

describe("genereerOnderhoudBoekingenDiagnose", () => {
  it("filtert op bedrijfsnr/boekjaar/periode/grootboekrekening en toont niet-gemodelleerde OGB-/complex-/factuurvelden", () => {
    schrijfBasisBronnen(
      [
        boekingRij(),
        // Ander bedrijfsnr — mag niet meetellen (boekingen is een gedeelde bron).
        boekingRij({ Bedrijfsnr: "071", Boekstuk_Sleutel: "0715000001", Boeking_Boekstuknr: "101" }),
        // Andere grootboekrekening — mag niet meetellen.
        boekingRij({ Boekstuk_Sleutel: "0705000002", Boeking_Boekstuknr: "102", Boeking_Grootboeknr: "1500" }),
        // Buiten de periode — mag niet meetellen.
        boekingRij({ Boekstuk_Sleutel: "0705000003", Boeking_Boekstuknr: "103", Boeking_Boekperiode: "02" }),
      ],
      [unitRij()],
    );

    const resultaat = genereerOnderhoudBoekingenDiagnose(root, "070_rooisezoom", {
      grootboekrekeningen: ["4300", "4330", "4340"],
      boekjaar: 2025,
      boekperiodeTotEnMet: "01",
    });

    expect(resultaat.aantalRegels).toBe(1);
    const regel = resultaat.regels[0]!;
    expect(regel.grootboeknr).toBe("4300");
    expect(regel.ogbKostensoort).toBe("4200");
    expect(regel.ogbKostensoortOmschrijving).toBe("Dak");
    expect(regel.complexnr).toBe("001");
    expect(regel.relatienr).toBe("C001");
    expect(regel.relatienaam).toBe("Dakdekker BV");
    expect(regel.dagboekomschrijving).toBe("Inkoop");
    expect(regel.saldo.toString()).toBe("100");

    const complex001 = resultaat.complex.perComplex.find((c) => c.complexnr === "001");
    expect(complex001?.bekendInComplexbron).toBe(true);
  });

  it("markeert een complexnummer dat niet in de units-bron voorkomt als onbekend", () => {
    schrijfBasisBronnen([boekingRij({ Boeking_Complexnr: "999" })], [unitRij({ Complexnummer: "001" })]);

    const resultaat = genereerOnderhoudBoekingenDiagnose(root, "070_rooisezoom", {
      grootboekrekeningen: ["4300"],
      boekjaar: 2025,
      boekperiodeTotEnMet: "01",
    });

    const complex999 = resultaat.complex.perComplex.find((c) => c.complexnr === "999");
    expect(complex999?.bekendInComplexbron).toBe(false);
  });

  it("gooit een duidelijke fout als het boekingen-bronbestand ontbreekt", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), []);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), []);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), []);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);
    expect(() =>
      genereerOnderhoudBoekingenDiagnose(root, "070_rooisezoom", {
        grootboekrekeningen: ["4300"],
        boekjaar: 2025,
        boekperiodeTotEnMet: "01",
      }),
    ).toThrow(/niet gevonden/);
  });
});
