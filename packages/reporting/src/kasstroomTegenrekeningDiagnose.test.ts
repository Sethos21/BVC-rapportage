import type { BalansRegel, GrootboekMappingRegel, ResultaatRegel } from "@bvc/config";
import type { Boekingsregel } from "@bvc/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { diagnoseerKasstroomTegenrekening } from "./kasstroomTegenrekeningDiagnose.js";

function balansRegel(overrides: Partial<BalansRegel> = {}): BalansRegel {
  return {
    grootboekrekening: "1010",
    soort: "BALANS",
    balanszijde: "ACTIVA",
    tekenconventie: "ZOALS_BRON",
    liquideMiddelen: false,
    kasstroomCategorie: null,
    actief: true,
    status: "GOEDGEKEURD",
    ...overrides,
  };
}

function resultaatRegel(overrides: Partial<ResultaatRegel> = {}): ResultaatRegel {
  return {
    grootboekrekening: "4000",
    soort: "RESULTAAT",
    rapportagepost: "Beheerkosten",
    rapportagecategorie: "Kosten",
    tekenconventie: "ZOALS_BRON",
    kasstroomCategorie: null,
    actief: true,
    status: "GOEDGEKEURD",
    ...overrides,
  };
}

let volgnrTeller = 0;
function boeking(boekstukSleutel: string, grootboeknr: string, bedragDebet: string, bedragCredit: string, boekdatum: string): Boekingsregel {
  volgnrTeller += 1;
  return {
    bedrijfsnr: "070",
    boekjaar: 2026,
    dagboeknr: "20",
    boekstuknr: boekstukSleutel,
    volgnr: String(volgnrTeller).padStart(4, "0"),
    boekstukSleutel,
    grootboeknr,
    boekdatum: new Date(boekdatum),
    omschrijving: "test",
    bedragDebet: new Decimal(bedragDebet),
    bedragCredit: new Decimal(bedragCredit),
  };
}

const mapping: GrootboekMappingRegel[] = [
  balansRegel({ grootboekrekening: "1010", liquideMiddelen: true }),
  balansRegel({ grootboekrekening: "0840", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD", kasstroomCategorie: "EIGENAARONTTREKKING" }),
  balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
  resultaatRegel({ grootboekrekening: "4000" }),
];

describe("diagnoseerKasstroomTegenrekening", () => {
  it("markeert een boekstuk dat vandaag meetelt als eigenaaronttrekking", () => {
    const boekingen: Boekingsregel[] = [boeking("C", "1010", "0", "500", "2026-04-05"), boeking("C", "0840", "500", "0", "2026-04-05")];
    const resultaat = diagnoseerKasstroomTegenrekening(boekingen, mapping, "0840");
    expect(resultaat.doelRekeningMappingGevonden).toBe(true);
    expect(resultaat.doelRekeningKasstroomCategorie).toBe("EIGENAARONTTREKKING");
    expect(resultaat.doelRekeningIsAlsLiquideGeclassificeerd).toBe(false);
    expect(resultaat.boekstukken).toHaveLength(1);
    expect(resultaat.boekstukken[0]?.teltNuMeeAlsEigenaarOnttrekking).toBe(true);
    expect(resultaat.boekstukken[0]?.redenNietMeegeteld).toBeNull();
    expect(resultaat.totaalBedragMeegeteld.toString()).toBe("500");
    expect(resultaat.totaalBedragNietMeegeteld.toString()).toBe("0");
  });

  it("legt uit dat een boekstuk met een niet-negatief liquide-bedrag wordt uitgesloten", () => {
    const boekingen: Boekingsregel[] = [boeking("D", "1010", "500", "0", "2026-04-05"), boeking("D", "0840", "0", "500", "2026-04-05")];
    const resultaat = diagnoseerKasstroomTegenrekening(boekingen, mapping, "0840");
    expect(resultaat.boekstukken[0]?.teltNuMeeAlsEigenaarOnttrekking).toBe(false);
    expect(resultaat.boekstukken[0]?.redenNietMeegeteld).toContain("niet negatief");
    expect(resultaat.totaalBedragNietMeegeteld.toString()).toBe("500");
  });

  it("legt uit dat een boekstuk zonder liquide-regel niet meetelt", () => {
    const boekingen: Boekingsregel[] = [boeking("E", "0840", "500", "0", "2026-04-05"), boeking("E", "1600", "0", "500", "2026-04-05")];
    const resultaat = diagnoseerKasstroomTegenrekening(boekingen, mapping, "0840");
    expect(resultaat.boekstukken[0]?.teltNuMeeAlsEigenaarOnttrekking).toBe(false);
    expect(resultaat.boekstukken[0]?.redenNietMeegeteld).toContain("Geen enkele regel");
  });

  it("signaleert als de doelrekening zelf (onverwacht) als liquide is geclassificeerd", () => {
    const foutieveMapping: GrootboekMappingRegel[] = [...mapping.filter((r) => r.grootboekrekening !== "0840"), balansRegel({ grootboekrekening: "0840", liquideMiddelen: true, kasstroomCategorie: "EIGENAARONTTREKKING" })];
    const boekingen: Boekingsregel[] = [boeking("C", "1010", "0", "500", "2026-04-05"), boeking("C", "0840", "500", "0", "2026-04-05")];
    const resultaat = diagnoseerKasstroomTegenrekening(boekingen, foutieveMapping, "0840");
    expect(resultaat.doelRekeningIsAlsLiquideGeclassificeerd).toBe(true);
    // Als "liquide", wordt 0840 nooit als tegenrekening bekeken -- de bank- en 0840-regel heffen elkaar op tot een niet-negatief liquide-bedrag.
    expect(resultaat.boekstukken[0]?.redenNietMeegeteld).toContain("niet negatief");
  });

  it("meldt een gemengd boekstuk (0840 samen met een andere, niet-onttrekking tegenrekening)", () => {
    const boekingen: Boekingsregel[] = [
      boeking("F", "1010", "0", "200", "2026-01-25"),
      boeking("F", "0840", "100", "0", "2026-01-25"),
      boeking("F", "4000", "100", "0", "2026-01-25"),
    ];
    const resultaat = diagnoseerKasstroomTegenrekening(boekingen, mapping, "0840");
    expect(resultaat.boekstukken[0]?.teltNuMeeAlsEigenaarOnttrekking).toBe(false);
    expect(resultaat.boekstukken[0]?.redenNietMeegeteld).toContain("mix van tegenrekeningen");
  });

  it("geeft een leeg resultaat als de doelrekening in geen enkel boekstuk voorkomt", () => {
    const boekingen: Boekingsregel[] = [boeking("A", "1010", "1000", "0", "2026-01-15"), boeking("A", "4000", "0", "1000", "2026-01-15")];
    const resultaat = diagnoseerKasstroomTegenrekening(boekingen, mapping, "0840");
    expect(resultaat.boekstukken).toEqual([]);
    expect(resultaat.totaalBedragMeegeteld.toString()).toBe("0");
  });

  it("meldt duidelijk als de doelrekening helemaal niet in de mapping voorkomt", () => {
    const resultaat = diagnoseerKasstroomTegenrekening([], mapping, "9999");
    expect(resultaat.doelRekeningMappingGevonden).toBe(false);
    expect(resultaat.doelRekeningKasstroomCategorie).toBeNull();
  });
});
