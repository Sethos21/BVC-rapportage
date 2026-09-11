import type { BalansRegel, GrootboekMappingRegel, ResultaatRegel } from "@bvc/config";
import type { Balansstand, Boekingsregel } from "@bvc/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenKasstroomPeriode } from "./kasstroomBerekening.js";

function balansRegel(overrides: Partial<BalansRegel> = {}): BalansRegel {
  return {
    grootboekrekening: "1010",
    soort: "BALANS",
    balanszijde: "ACTIVA",
    tekenconventie: "ZOALS_BRON",
    liquideMiddelen: true,
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

function stand(overrides: Partial<Balansstand> = {}): Balansstand {
  return {
    bedrijfsnr: "070",
    jaar: 2026,
    grootboekrekeningnr: "1010",
    saldoDebet: new Decimal(0),
    saldoCredit: new Decimal(0),
    eindsaldo: new Decimal(0),
    beginbalansDebet: new Decimal(0),
    beginbalansCredit: new Decimal(0),
    rekeningOmschrijving: "Bank",
    ...overrides,
  };
}

function boeking(overrides: Partial<Boekingsregel> = {}): Boekingsregel {
  return {
    bedrijfsnr: "070",
    boekjaar: 2026,
    dagboeknr: "20",
    boekstuknr: "024001",
    volgnr: "000001",
    boekstukSleutel: "0704020024001",
    grootboeknr: "1010",
    boekdatum: new Date("2026-03-15"),
    omschrijving: "test",
    bedragDebet: new Decimal(0),
    bedragCredit: new Decimal(0),
    ...overrides,
  };
}

describe("berekenKasstroomPeriode", () => {
  it("telt beginbalans + mutaties op voor een bevestigde liquide-middelen-rekening", () => {
    const resultaat = berekenKasstroomPeriode(
      [stand({ beginbalansDebet: new Decimal("1000"), beginbalansCredit: new Decimal(0) })],
      [boeking({ bedragDebet: new Decimal("500"), bedragCredit: new Decimal(0) })],
      [balansRegel({ liquideMiddelen: true })],
    );
    expect(resultaat.rekeningen).toEqual([
      { grootboekrekening: "1010", omschrijving: "Bank", beginbalans: new Decimal("1000"), mutatie: new Decimal("500"), eindstand: new Decimal("1500") },
    ]);
    expect(resultaat.beginstandTotaal.toString()).toBe("1000");
    expect(resultaat.mutatieTotaal.toString()).toBe("500");
    expect(resultaat.eindstandTotaal.toString()).toBe("1500");
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("sluit een BALANS-rekening met liquideMiddelen:false stil uit (bekend, geen liquide middelen)", () => {
    const resultaat = berekenKasstroomPeriode(
      [stand({ grootboekrekeningnr: "1310", beginbalansDebet: new Decimal("200"), beginbalansCredit: new Decimal(0), rekeningOmschrijving: "Huurdebiteuren" })],
      [boeking({ grootboeknr: "1310", bedragDebet: new Decimal("50"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1310", liquideMiddelen: false })],
    );
    expect(resultaat.rekeningen).toEqual([]);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("markeert een BALANS-rekening met onbevestigde liquideMiddelen (null) als controleVereist bij een niet-nul mutatie", () => {
    const resultaat = berekenKasstroomPeriode(
      [],
      [boeking({ bedragDebet: new Decimal("500"), bedragCredit: new Decimal(0) })],
      [balansRegel({ liquideMiddelen: null })],
    );
    expect(resultaat.rekeningen).toEqual([]);
    expect(resultaat.controleVereist).toEqual([
      { grootboekrekening: "1010", saldo: new Decimal("500"), reden: expect.stringContaining("Liquiditeitsclassificatie") as unknown as string },
    ]);
  });

  it("negeert een bekende RESULTAAT-rekening volledig (die hoort niet in de kasstroom)", () => {
    const resultaat = berekenKasstroomPeriode(
      [],
      [boeking({ grootboeknr: "4000", bedragDebet: new Decimal("100"), bedragCredit: new Decimal(0) })],
      [resultaatRegel()],
    );
    expect(resultaat.rekeningen).toEqual([]);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("markeert een niet-gemapte rekening met een niet-nul mutatie als controleVereist", () => {
    const resultaat = berekenKasstroomPeriode([], [boeking({ grootboeknr: "9999", bedragDebet: new Decimal("30"), bedragCredit: new Decimal(0) })], []);
    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "9999")).toBe(true);
  });

  it("houdt meerdere liquide-middelen-rekeningen apart en telt ze op tot de totalen", () => {
    const mapping: GrootboekMappingRegel[] = [balansRegel({ grootboekrekening: "1010", liquideMiddelen: true }), balansRegel({ grootboekrekening: "1020", liquideMiddelen: true })];
    const resultaat = berekenKasstroomPeriode(
      [
        stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("1000"), beginbalansCredit: new Decimal(0) }),
        stand({ grootboekrekeningnr: "1020", beginbalansDebet: new Decimal("200"), beginbalansCredit: new Decimal(0) }),
      ],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("500"), bedragCredit: new Decimal(0) }), boeking({ grootboeknr: "1020", bedragDebet: new Decimal(0), bedragCredit: new Decimal("50") })],
      mapping,
    );
    expect(resultaat.rekeningen).toHaveLength(2);
    expect(resultaat.beginstandTotaal.toString()).toBe("1200");
    expect(resultaat.mutatieTotaal.toString()).toBe("450"); // 500 - 50
    expect(resultaat.eindstandTotaal.toString()).toBe("1650");
  });

  it("geeft een leeg resultaat voor lege invoer", () => {
    const resultaat = berekenKasstroomPeriode([], [], []);
    expect(resultaat.rekeningen).toEqual([]);
    expect(resultaat.controleVereist).toEqual([]);
    expect(resultaat.beginstandTotaal.toString()).toBe("0");
    expect(resultaat.mutatieTotaal.toString()).toBe("0");
    expect(resultaat.eindstandTotaal.toString()).toBe("0");
  });
});
