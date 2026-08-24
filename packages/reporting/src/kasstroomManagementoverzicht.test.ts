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
  balansRegel({ grootboekrekening: "1310", liquideMiddelen: false, kasstroomCategorie: "HUURONTVANGST" }),
  balansRegel({ grootboekrekening: "0840", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD", liquideMiddelen: false, kasstroomCategorie: "EIGENAARONTTREKKING" }),
  balansRegel({ grootboekrekening: "1711", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD", liquideMiddelen: false, kasstroomCategorie: "OVERIG" }),
  balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD", liquideMiddelen: false, kasstroomCategorie: null }),
  resultaatRegel({ grootboekrekening: "4000", kasstroomCategorie: "EXPLOITATIE_UITGAVE" }),
];

const balansstanden: Balansstand[] = [stand({ beginbalansDebet: new Decimal("2000"), beginbalansCredit: new Decimal(0) })];

describe("berekenKasstroomManagementoverzicht", () => {
  it("classificeert huurontvangst via de tegenrekening Huurdebiteuren (1310), niet via een directe Opbrengsten-rekening", () => {
    const boekingen: Boekingsregel[] = [boeking("A", "1010", "1000", "0", "2026-01-15"), boeking("A", "1310", "0", "1000", "2026-01-15")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping, null);
    expect(resultaat.huurontvangsten.toString()).toBe("1000");
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("rapporteert exploitatie-uitgaven en eigenaaronttrekkingen als POSITIEF bedrag (omgekeerd t.o.v. het bank-credit-teken)", () => {
    const boekingen: Boekingsregel[] = [
      boeking("B", "1010", "0", "300", "2026-02-10"),
      boeking("B", "4000", "300", "0", "2026-02-10"),
      boeking("C", "1010", "0", "500", "2026-04-05"),
      boeking("C", "0840", "500", "0", "2026-04-05"),
    ];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping, null);
    expect(resultaat.exploitatieUitgaven.toString()).toBe("300");
    expect(resultaat.eigenaarOnttrekkingen.toString()).toBe("500");
  });

  it("houdt een bevestigde OVERIG-categorie apart (reconciliatie), niet meegeteld in de drie KPI's", () => {
    const boekingen: Boekingsregel[] = [boeking("D", "1010", "0", "50", "2026-03-01"), boeking("D", "1711", "50", "0", "2026-03-01")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping, null);
    expect(resultaat.overig.toString()).toBe("-50");
    expect(resultaat.huurontvangsten.toString()).toBe("0");
    expect(resultaat.exploitatieUitgaven.toString()).toBe("0");
    expect(resultaat.eigenaarOnttrekkingen.toString()).toBe("0");
  });

  it("markeert een tegenrekening met een onbevestigde kasstroomCategorie (null) als controleVereist, telt niet mee", () => {
    const boekingen: Boekingsregel[] = [boeking("E", "1010", "0", "20", "2026-05-01"), boeking("E", "1600", "20", "0", "2026-05-01")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping, null);
    expect(resultaat.controleVereist).toEqual([{ grootboekrekening: "1600", saldo: new Decimal("20"), reden: expect.stringContaining("Kasstroomcategorie") as unknown as string }]);
    expect(resultaat.overig.toString()).toBe("0");
  });

  it("markeert een niet-gemapte tegenrekening als controleVereist", () => {
    const boekingen: Boekingsregel[] = [boeking("G", "1010", "0", "10", "2026-01-20"), boeking("G", "9999", "10", "0", "2026-01-20")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping, null);
    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "9999")).toBe(true);
  });

  it("wijst een boekstuk met tegenrekeningen in VERSCHILLENDE categorieën niet toe aan één KPI, komt in controleVereist", () => {
    const boekingen: Boekingsregel[] = [
      boeking("F", "1010", "200", "0", "2026-01-25"),
      boeking("F", "1310", "0", "100", "2026-01-25"),
      boeking("F", "4000", "0", "100", "2026-01-25"),
    ];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping, null);
    expect(resultaat.huurontvangsten.toString()).toBe("0");
    expect(resultaat.exploitatieUitgaven.toString()).toBe("0");
    expect(resultaat.controleVereist).toHaveLength(1);
    expect(resultaat.controleVereist[0]?.reden).toContain("verschillende kasstroomcategorieën");
  });

  it("negeert een boekstuk dat uitsluitend liquide-middelen-regels bevat (geen tegenrekening, geen KPI van toepassing)", () => {
    const andereLiquideMapping = [...mapping, balansRegel({ grootboekrekening: "1020", liquideMiddelen: true })];
    const boekingen: Boekingsregel[] = [boeking("H", "1010", "0", "75", "2026-01-01"), boeking("H", "1020", "75", "0", "2026-01-01")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, andereLiquideMapping, null);
    expect(resultaat.controleVereist).toEqual([]);
    expect(resultaat.huurontvangsten.toString()).toBe("0");
    expect(resultaat.overig.toString()).toBe("0");
  });

  it("berekent bankstandBegin/Eind/nettoKasstroom door berekenKasstroomPeriode te hergebruiken (geen dubbele berekening)", () => {
    const boekingen: Boekingsregel[] = [boeking("A", "1010", "1000", "0", "2026-01-15"), boeking("A", "1310", "0", "1000", "2026-01-15")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping, null);
    expect(resultaat.bankstandBegin.toString()).toBe("2000");
    expect(resultaat.bankstandEind.toString()).toBe("3000");
    expect(resultaat.nettoKasstroom.toString()).toBe("1000");
  });

  it("splitst huurontvangsten en eigenaaronttrekkingen per kwartaal, met de uitbetalingsratio per kwartaal", () => {
    const boekingen: Boekingsregel[] = [
      boeking("A", "1010", "1000", "0", "2026-01-15"),
      boeking("A", "1310", "0", "1000", "2026-01-15"), // Q1: huur 1000
      boeking("C", "1010", "0", "500", "2026-04-05"),
      boeking("C", "0840", "500", "0", "2026-04-05"), // Q2: onttrekking 500
    ];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping, null);
    const q1 = resultaat.perKwartaal.find((k) => k.kwartaal === 1)!;
    const q2 = resultaat.perKwartaal.find((k) => k.kwartaal === 2)!;
    expect(q1.huurontvangsten.toString()).toBe("1000");
    expect(q1.eigenaarOnttrekkingen.toString()).toBe("0");
    expect(q1.uitbetalingsratio).toEqual({ type: "bekend", waarde: new Decimal("0") });
    expect(q2.huurontvangsten.toString()).toBe("0");
    expect(q2.eigenaarOnttrekkingen.toString()).toBe("500");
    expect(q2.uitbetalingsratio.type).toBe("onbekend");
  });

  it("berekent de totale uitbetalingsratio = eigenaarOnttrekkingen / huurontvangsten", () => {
    const boekingen: Boekingsregel[] = [
      boeking("A", "1010", "1000", "0", "2026-01-15"),
      boeking("A", "1310", "0", "1000", "2026-01-15"),
      boeking("C", "1010", "0", "500", "2026-04-05"),
      boeking("C", "0840", "500", "0", "2026-04-05"),
    ];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping, null);
    expect(resultaat.uitbetalingsratio).toEqual({ type: "bekend", waarde: new Decimal("0.5") });
  });

  it("geeft streefwaardeBankstand als onbekend terug als er geen waarde is meegegeven, nooit een aanname", () => {
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, [], mapping, null);
    expect(resultaat.streefwaardeBankstand.type).toBe("onbekend");
  });

  it("geeft de meegegeven streefwaardeBankstand door als bekend", () => {
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, [], mapping, new Decimal("50000"));
    expect(resultaat.streefwaardeBankstand).toEqual({ type: "bekend", waarde: new Decimal("50000") });
  });

  it("geeft onbekend terug voor de uitbetalingsratio als huurontvangsten nul zijn", () => {
    const boekingen: Boekingsregel[] = [boeking("C", "1010", "0", "500", "2026-04-05"), boeking("C", "0840", "500", "0", "2026-04-05")];
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingen, mapping, null);
    expect(resultaat.uitbetalingsratio.type).toBe("onbekend");
  });
});
