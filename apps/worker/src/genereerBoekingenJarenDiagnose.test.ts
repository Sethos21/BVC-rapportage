import Decimal from "decimal.js";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerBoekingenJarenDiagnose } from "./genereerBoekingenJarenDiagnose.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

function boekingRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "023",
    Boekstuk_Sleutel: "0235000001",
    Boeking_Dagboeknr: "50",
    Boeking_Boekjaar: 2023,
    Boeking_Boekperiode: "06",
    Boeking_Boekstuknr: "100",
    Boeking_Volgnr: "1",
    Boeking_Boekdatum: "15-06-2023",
    Boeking_Grootboeknr: "08830",
    Boeking_Bedrag_Debet: 0,
    Boeking_Bedrag_Credit: 150000,
    Boeking_Omschrijving: "Opbrengst verkoop pand",
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-boekingen-jaren-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "023_malconbeheer"), { recursive: true });
  schrijfAdministratieConfig(root, "023_malconbeheer", nieuweAdministratieConfig("023", "Malcon Beheer BV"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function schrijfBoekingenBron(boekingen: Record<string, unknown>[]): void {
  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), boekingen);
}

describe("genereerBoekingenJarenDiagnose", () => {
  it("filtert op bedrijfsnr + opgegeven grootboekrekeningen, ZONDER boekjaar/periode te filteren", () => {
    schrijfBoekingenBron([
      boekingRij({ Boeking_Boekjaar: 2022, Boeking_Boekperiode: "11", Boeking_Grootboeknr: "00166", Boeking_Bedrag_Debet: 535000, Boeking_Bedrag_Credit: 0 }),
      boekingRij({ Boeking_Boekjaar: 2022, Boeking_Boekperiode: "12", Boeking_Grootboeknr: "00167", Boeking_Bedrag_Debet: 100000, Boeking_Bedrag_Credit: 0 }),
      boekingRij({ Boeking_Boekjaar: 2023, Boeking_Boekperiode: "06", Boeking_Grootboeknr: "08830" }),
      // Ander bedrijfsnr — mag niet meetellen (boekingen is een gedeelde bron).
      boekingRij({ Bedrijfsnr: "013", Boekstuk_Sleutel: "0135000001", Boeking_Grootboeknr: "08830" }),
      // Niet-opgevraagde grootboekrekening — mag niet meetellen.
      boekingRij({ Boeking_Grootboeknr: "1500" }),
    ]);

    const resultaat = genereerBoekingenJarenDiagnose(root, "023_malconbeheer", { grootboekrekeningen: ["08830", "00166", "00167"] });

    expect(resultaat.aantalRegels).toBe(3);
    expect(resultaat.perGrootboekrekening.map((g) => g.grootboekrekening)).toEqual(["00166", "00167", "08830"]);

    const gl08830 = resultaat.perGrootboekrekening.find((g) => g.grootboekrekening === "08830")!;
    expect(gl08830.perJaar).toEqual([{ boekjaar: 2023, eerstePeriode: "06", laatstePeriode: "06", aantalRegels: 1, saldo: new Decimal(-150000) }]);
    expect(gl08830.saldo.toString()).toBe("-150000");
  });

  it("een boekjaar zonder enige boeking op de opgegeven rekeningen levert een lege perJaar-lijst op, geen fout", () => {
    schrijfBoekingenBron([boekingRij({ Boeking_Grootboeknr: "1500" })]);

    const resultaat = genereerBoekingenJarenDiagnose(root, "023_malconbeheer", { grootboekrekeningen: ["08830"] });

    expect(resultaat.aantalRegels).toBe(0);
    expect(resultaat.perGrootboekrekening).toEqual([]);
    expect(resultaat.totaalPerBoekjaar).toEqual([]);
  });

  it("bepaalt eerste/laatste boekperiode correct bij meerdere boekingen binnen hetzelfde boekjaar", () => {
    schrijfBoekingenBron([
      boekingRij({ Boeking_Boekjaar: 2023, Boeking_Boekperiode: "03", Boeking_Bedrag_Credit: 100000 }),
      boekingRij({ Boeking_Boekjaar: 2023, Boeking_Boekperiode: "09", Boeking_Bedrag_Credit: 50000, Boekstuk_Sleutel: "0235000002" }),
    ]);

    const resultaat = genereerBoekingenJarenDiagnose(root, "023_malconbeheer", { grootboekrekeningen: ["08830"] });

    const gl = resultaat.perGrootboekrekening.find((g) => g.grootboekrekening === "08830")!;
    expect(gl.perJaar).toHaveLength(1);
    expect(gl.perJaar[0]).toMatchObject({ boekjaar: 2023, eerstePeriode: "03", laatstePeriode: "09", aantalRegels: 2 });
    expect(gl.perJaar[0]!.saldo.toString()).toBe("-150000");
  });

  it("totaalPerBoekjaar sommeert over alle opgegeven rekeningen samen", () => {
    schrijfBoekingenBron([
      boekingRij({ Boeking_Grootboeknr: "08830", Boeking_Boekjaar: 2023, Boeking_Bedrag_Credit: 150000 }),
      boekingRij({ Boeking_Grootboeknr: "00166", Boeking_Boekjaar: 2023, Boeking_Bedrag_Debet: 535000, Boeking_Bedrag_Credit: 0, Boekstuk_Sleutel: "0235000002" }),
    ]);

    const resultaat = genereerBoekingenJarenDiagnose(root, "023_malconbeheer", { grootboekrekeningen: ["08830", "00166"] });

    expect(resultaat.totaalPerBoekjaar).toHaveLength(1);
    expect(resultaat.totaalPerBoekjaar[0]).toMatchObject({ boekjaar: 2023, aantalRegels: 2 });
    expect(resultaat.totaalPerBoekjaar[0]!.saldo.toString()).toBe("385000");
  });

  it("gooit een duidelijke fout als het boekingen-bronbestand ontbreekt", () => {
    expect(() => genereerBoekingenJarenDiagnose(root, "023_malconbeheer", { grootboekrekeningen: ["08830"] })).toThrow(/niet gevonden/);
  });
});
