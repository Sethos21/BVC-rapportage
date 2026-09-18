import type { BalansRegel, GrootboekMappingRegel, ResultaatRegel } from "@bvc/config";
import type { Boekingsregel } from "@bvc/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenTopOverigeUitgaven } from "./kasstroomTopUitgaven.js";

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
function boeking(boekstukSleutel: string, grootboeknr: string, bedragDebet: string, bedragCredit: string, boekdatum: string, omschrijving = "test"): Boekingsregel {
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
    omschrijving,
    bedragDebet: new Decimal(bedragDebet),
    bedragCredit: new Decimal(bedragCredit),
  };
}

const mapping: GrootboekMappingRegel[] = [
  balansRegel({ grootboekrekening: "1010", liquideMiddelen: true }),
  balansRegel({ grootboekrekening: "0840", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD", kasstroomCategorie: "EIGENAARONTTREKKING" }),
  balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
  resultaatRegel({ grootboekrekening: "4000" }),
  resultaatRegel({ grootboekrekening: "4300", rapportagepost: "Onderhoud" }),
];

describe("berekenTopOverigeUitgaven", () => {
  it("sluit een eigenaaronttrekking-boeking uit, ook binnen een verzamelboeking met meerdere onttrekkingen", () => {
    const boekingen: Boekingsregel[] = [
      boeking("F", "1010", "0", "1000", "2026-01-25", "Onderhoud A"),
      boeking("F", "4300", "1000", "0", "2026-01-25", "Onderhoud A"),
      boeking("F", "1010", "0", "6000", "2026-01-25", "Onttrekking 1"),
      boeking("F", "0840", "6000", "0", "2026-01-25", "Onttrekking 1"),
      boeking("F", "1010", "0", "6000", "2026-01-25", "Onttrekking 2"),
      boeking("F", "0840", "6000", "0", "2026-01-25", "Onttrekking 2"),
      boeking("F", "1010", "0", "500", "2026-01-25", "Servicekosten"),
      boeking("F", "1600", "500", "0", "2026-01-25", "Servicekosten"),
    ];
    const top = berekenTopOverigeUitgaven(boekingen, mapping);
    expect(top).toHaveLength(2);
    expect(top[0]?.omschrijving).toBe("Onderhoud A");
    expect(top[0]?.bedrag.toString()).toBe("1000");
    expect(top[1]?.bedrag.toString()).toBe("500");
    expect(top.some((r) => r.omschrijving.startsWith("Onttrekking"))).toBe(false);
  });

  it("geeft alleen de top-N (standaard 3), aflopend gesorteerd op bedrag", () => {
    const boekingen: Boekingsregel[] = [
      boeking("A", "1010", "0", "100", "2026-01-05", "kosten 1"),
      boeking("A", "4000", "100", "0", "2026-01-05", "kosten 1"),
      boeking("B", "1010", "0", "400", "2026-02-05", "kosten 2"),
      boeking("B", "4000", "400", "0", "2026-02-05", "kosten 2"),
      boeking("C", "1010", "0", "200", "2026-03-05", "kosten 3"),
      boeking("C", "4000", "200", "0", "2026-03-05", "kosten 3"),
      boeking("D", "1010", "0", "50", "2026-04-05", "kosten 4"),
      boeking("D", "4000", "50", "0", "2026-04-05", "kosten 4"),
    ];
    const top = berekenTopOverigeUitgaven(boekingen, mapping);
    expect(top.map((r) => r.bedrag.toString())).toEqual(["400", "200", "100"]);
  });

  it("negeert ontvangsten (positieve liquide mutaties)", () => {
    const boekingen: Boekingsregel[] = [boeking("A", "1010", "1000", "0", "2026-01-15"), boeking("A", "4000", "0", "1000", "2026-01-15")];
    const top = berekenTopOverigeUitgaven(boekingen, mapping);
    expect(top).toEqual([]);
  });

  it("respecteert een aangepast aantal (N)", () => {
    const boekingen: Boekingsregel[] = [
      boeking("A", "1010", "0", "100", "2026-01-05"),
      boeking("A", "4000", "100", "0", "2026-01-05"),
      boeking("B", "1010", "0", "400", "2026-02-05"),
      boeking("B", "4000", "400", "0", "2026-02-05"),
    ];
    const top = berekenTopOverigeUitgaven(boekingen, mapping, 1);
    expect(top).toHaveLength(1);
    expect(top[0]?.bedrag.toString()).toBe("400");
  });
});
