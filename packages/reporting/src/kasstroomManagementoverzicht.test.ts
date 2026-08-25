import type { BalansRegel, GrootboekMappingRegel, ResultaatRegel } from "@bvc/config";
import type { Balansstand, Boekingsregel } from "@bvc/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenKasstroomManagementoverzicht } from "./kasstroomManagementoverzicht.js";

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
  balansRegel({ grootboekrekening: "1310" }),
  balansRegel({ grootboekrekening: "0840", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD", kasstroomCategorie: "EIGENAARONTTREKKING" }),
  balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
  resultaatRegel({ grootboekrekening: "4000" }),
];

const balansstanden: Balansstand[] = [stand({ beginbalansDebet: new Decimal("2000"), beginbalansCredit: new Decimal(0) })];

describe("berekenKasstroomManagementoverzicht (vereenvoudigd, 2026-08-24)", () => {
  it("leidt ontvangsten/uitgaven uitsluitend af uit mutaties op de liquide-middelen-rekening, ongeacht de tegenrekening", () => {
    const boekingen: Boekingsregel[] = [
      boeking("A", "1010", "1000", "0", "2026-01-15"),
      boeking("A", "1310", "0", "1000", "2026-01-15"),
      boeking("B", "1010", "0", "300", "2026-02-10"),
      boeking("B", "4000", "300", "0", "2026-02-10"),
    ];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping);
    expect(resultaat.ontvangsten.toString()).toBe("1000");
    expect(resultaat.uitgaven.toString()).toBe("300");
  });

  it("splitst eigenaaronttrekkingen uit de uitgaven via de tegenrekening (kasstroomCategorie EIGENAARONTTREKKING)", () => {
    const boekingen: Boekingsregel[] = [boeking("C", "1010", "0", "500", "2026-04-05"), boeking("C", "0840", "500", "0", "2026-04-05")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping);
    expect(resultaat.uitgaven.toString()).toBe("500");
    expect(resultaat.eigenaarOnttrekkingen.toString()).toBe("500");
    expect(resultaat.overigeUitgaven.toString()).toBe("0");
  });

  it("telt een uitgave zonder bevestigde eigenaaronttrekking-tegenrekening mee in overigeUitgaven, geen controleVereist nodig", () => {
    const boekingen: Boekingsregel[] = [boeking("B", "1010", "0", "300", "2026-02-10"), boeking("B", "4000", "300", "0", "2026-02-10")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping);
    expect(resultaat.overigeUitgaven.toString()).toBe("300");
    expect(resultaat.eigenaarOnttrekkingen.toString()).toBe("0");
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("telt ook een uitgave met een ONBEKENDE/ongemapte tegenrekening mee in overigeUitgaven zonder classificatie te eisen", () => {
    const boekingen: Boekingsregel[] = [boeking("G", "1010", "0", "10", "2026-01-20"), boeking("G", "9999", "10", "0", "2026-01-20")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping);
    expect(resultaat.uitgaven.toString()).toBe("10");
    expect(resultaat.overigeUitgaven.toString()).toBe("10");
    expect(resultaat.eigenaarOnttrekkingen.toString()).toBe("0");
  });

  it("meldt (informatief) een uitgave-boekstuk met GEDEELTELIJK eigenaaronttrekking-tegenrekeningen, telt toch mee in overigeUitgaven", () => {
    const boekingen: Boekingsregel[] = [
      boeking("F", "1010", "0", "200", "2026-01-25"),
      boeking("F", "0840", "100", "0", "2026-01-25"),
      boeking("F", "4000", "100", "0", "2026-01-25"),
    ];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping);
    expect(resultaat.uitgaven.toString()).toBe("200");
    expect(resultaat.overigeUitgaven.toString()).toBe("200");
    expect(resultaat.eigenaarOnttrekkingen.toString()).toBe("0");
    expect(resultaat.controleVereist).toHaveLength(1);
    expect(resultaat.controleVereist[0]?.reden).toContain("gedeeltelijk");
  });

  it("houdt de aansluiting ontvangsten - uitgaven = nettoKasstroom altijd sluitend", () => {
    const boekingen: Boekingsregel[] = [
      boeking("A", "1010", "1000", "0", "2026-01-15"),
      boeking("A", "1310", "0", "1000", "2026-01-15"),
      boeking("B", "1010", "0", "300", "2026-02-10"),
      boeking("B", "4000", "300", "0", "2026-02-10"),
      boeking("C", "1010", "0", "500", "2026-04-05"),
      boeking("C", "0840", "500", "0", "2026-04-05"),
    ];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping);
    expect(resultaat.ontvangsten.minus(resultaat.uitgaven).toString()).toBe(resultaat.nettoKasstroom.toString());
    expect(resultaat.nettoKasstroom.toString()).toBe("200"); // 1000 - 300 - 500
  });

  it("houdt de aansluiting eigenaarOnttrekkingen + overigeUitgaven = uitgaven altijd sluitend", () => {
    const boekingen: Boekingsregel[] = [
      boeking("B", "1010", "0", "300", "2026-02-10"),
      boeking("B", "4000", "300", "0", "2026-02-10"),
      boeking("C", "1010", "0", "500", "2026-04-05"),
      boeking("C", "0840", "500", "0", "2026-04-05"),
    ];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping);
    expect(resultaat.eigenaarOnttrekkingen.plus(resultaat.overigeUitgaven).toString()).toBe(resultaat.uitgaven.toString());
  });

  it("berekent bankstandBegin/Eind door berekenKasstroomPeriode te hergebruiken (geen dubbele berekening)", () => {
    const boekingen: Boekingsregel[] = [boeking("A", "1010", "1000", "0", "2026-01-15"), boeking("A", "1310", "0", "1000", "2026-01-15")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping);
    expect(resultaat.bankstandBegin.toString()).toBe("2000");
    expect(resultaat.bankstandEind.toString()).toBe("3000");
  });

  it("splitst ontvangsten, uitgaven, eigenaaronttrekkingen en nettoKasstroom per kwartaal", () => {
    const boekingen: Boekingsregel[] = [
      boeking("A", "1010", "1000", "0", "2026-01-15"),
      boeking("A", "1310", "0", "1000", "2026-01-15"), // Q1: ontvangst 1000
      boeking("C", "1010", "0", "500", "2026-04-05"),
      boeking("C", "0840", "500", "0", "2026-04-05"), // Q2: uitgave 500, onttrekking 500
    ];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping);
    const q1 = resultaat.perKwartaal.find((k) => k.kwartaal === 1)!;
    const q2 = resultaat.perKwartaal.find((k) => k.kwartaal === 2)!;
    expect(q1.ontvangsten.toString()).toBe("1000");
    expect(q1.uitgaven.toString()).toBe("0");
    expect(q1.nettoKasstroom.toString()).toBe("1000");
    expect(q2.uitgaven.toString()).toBe("500");
    expect(q2.eigenaarOnttrekkingen.toString()).toBe("500");
    expect(q2.nettoKasstroom.toString()).toBe("-500");
  });

  it("draagt onbevestigde liquide-middelen-controleVereist door vanuit berekenKasstroomPeriode", () => {
    const onbevestigdeMapping: GrootboekMappingRegel[] = [balansRegel({ grootboekrekening: "1010", liquideMiddelen: null })];
    const boekingen: Boekingsregel[] = [boeking("A", "1010", "500", "0", "2026-01-15")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, onbevestigdeMapping);
    expect(resultaat.ontvangsten.toString()).toBe("0"); // 1010 telt niet mee zolang liquideMiddelen onbevestigd is
    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "1010")).toBe(true);
  });

  it("geeft een leeg resultaat voor lege invoer", () => {
    const resultaat = berekenKasstroomManagementoverzicht([], [], mapping);
    expect(resultaat.ontvangsten.toString()).toBe("0");
    expect(resultaat.uitgaven.toString()).toBe("0");
    expect(resultaat.nettoKasstroom.toString()).toBe("0");
    expect(resultaat.eigenaarOnttrekkingen.toString()).toBe("0");
    expect(resultaat.overigeUitgaven.toString()).toBe("0");
    expect(resultaat.controleVereist).toEqual([]);
  });
});
