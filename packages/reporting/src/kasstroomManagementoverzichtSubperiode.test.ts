import type { BalansRegel, GrootboekMappingRegel, ResultaatRegel } from "@bvc/config";
import type { Balansstand, Boekingsregel } from "@bvc/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenKasstroomManagementoverzicht } from "./kasstroomManagementoverzicht.js";
import { berekenKasstroomManagementoverzichtSubperiode } from "./kasstroomManagementoverzichtSubperiode.js";

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
    beginbalansDebet: new Decimal("1000"),
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
  balansRegel({ grootboekrekening: "0840", liquideMiddelen: false, kasstroomCategorie: "EIGENAARONTTREKKING" }),
  resultaatRegel({ grootboekrekening: "8800", rapportagecategorie: "Opbrengsten", tekenconventie: "OMGEKEERD" }),
  resultaatRegel({ grootboekrekening: "4000", rapportagecategorie: "Kosten" }),
];
const balansstanden: Balansstand[] = [stand({ beginbalansDebet: new Decimal("1000") })];

// Periode 01-03 (Q1): bank +1000 (periode 02, tegen 8800), bank -200 (periode 03, tegen 4000).
const boekingenVoorPeriode: Boekingsregel[] = [
  boeking("F1", "1010", "1000", "0", "2026-02-10"),
  boeking("F1", "8800", "0", "1000", "2026-02-10"),
  boeking("F2", "1010", "0", "200", "2026-03-15"),
  boeking("F2", "4000", "200", "0", "2026-03-15"),
];
// Periode 04-06 (Q2) erbovenop: bank +500 (periode 05, tegen 8800), bank -300 met eigenaaronttrekking 0840 (periode 06).
const boekingenAlleenPeriode0406: Boekingsregel[] = [
  boeking("F3", "1010", "500", "0", "2026-05-05"),
  boeking("F3", "8800", "0", "500", "2026-05-05"),
  boeking("F4", "1010", "0", "300", "2026-06-20"),
  boeking("F4", "0840", "300", "0", "2026-06-20"),
];
const boekingenTotEnMetPeriode: Boekingsregel[] = [...boekingenVoorPeriode, ...boekingenAlleenPeriode0406];

describe("berekenKasstroomManagementoverzichtSubperiode", () => {
  it("berekent ontvangsten/uitgaven/eigenaarOnttrekkingen uitsluitend voor periode 04-06 (verschil van twee YTD-uitkomsten)", () => {
    const resultaat = berekenKasstroomManagementoverzichtSubperiode({
      balansstanden,
      boekingenVoorPeriode,
      boekingenTotEnMetPeriode,
      mappingRegels: mapping,
    });

    expect(resultaat.ontvangsten.toString()).toBe("500"); // alleen periode 05, niet periode 02
    expect(resultaat.uitgaven.toString()).toBe("300"); // alleen periode 06, niet periode 03
    expect(resultaat.eigenaarOnttrekkingen.toString()).toBe("300");
    expect(resultaat.overigeUitgaven.toString()).toBe("0");
    expect(resultaat.nettoKasstroom.toString()).toBe("200");
  });

  it("harde controle 1: bankstandBegin + nettoKasstroom = bankstandEind", () => {
    const resultaat = berekenKasstroomManagementoverzichtSubperiode({
      balansstanden,
      boekingenVoorPeriode,
      boekingenTotEnMetPeriode,
      mappingRegels: mapping,
    });

    expect(resultaat.bankstandBegin.plus(resultaat.nettoKasstroom).toString()).toBe(resultaat.bankstandEind.toString());
    expect(resultaat.bankstandBegin.toString()).toBe("1800"); // 1000 (jaarbegin) + 1000 (netto periode 01-03)
    expect(resultaat.bankstandEind.toString()).toBe("2000");
  });

  it("harde controle 2: bankstandEind van de sub-periode is identiek aan een onafhankelijke YTD-aanroep voor dezelfde periodeTotEnMet", () => {
    const subperiode = berekenKasstroomManagementoverzichtSubperiode({
      balansstanden,
      boekingenVoorPeriode,
      boekingenTotEnMetPeriode,
      mappingRegels: mapping,
    });
    const onafhankelijkeYtd = berekenKasstroomManagementoverzicht(balansstanden, boekingenTotEnMetPeriode, mapping);

    expect(subperiode.bankstandEind.toString()).toBe(onafhankelijkeYtd.bankstandEind.toString());
  });

  it("perKwartaal toont uitsluitend Q2 (04-06), Q1 wordt exact 0 (niet negatief/vervuild)", () => {
    const resultaat = berekenKasstroomManagementoverzichtSubperiode({
      balansstanden,
      boekingenVoorPeriode,
      boekingenTotEnMetPeriode,
      mappingRegels: mapping,
    });

    const q1 = resultaat.perKwartaal.find((k) => k.kwartaal === 1)!;
    const q2 = resultaat.perKwartaal.find((k) => k.kwartaal === 2)!;
    expect(q1.ontvangsten.toString()).toBe("0");
    expect(q1.uitgaven.toString()).toBe("0");
    expect(q2.ontvangsten.toString()).toBe("500");
    expect(q2.uitgaven.toString()).toBe("300");
    expect(q2.eigenaarOnttrekkingen.toString()).toBe("300");
  });

  it("boekperiodeVan = '01' (lege boekingenVoorPeriode) geeft EXACT hetzelfde resultaat als de bestaande YTD-functie — geen regressie", () => {
    const subperiode = berekenKasstroomManagementoverzichtSubperiode({
      balansstanden,
      boekingenVoorPeriode: [], // periode 01 heeft geen "voorafgaande periode"
      boekingenTotEnMetPeriode,
      mappingRegels: mapping,
    });
    const bestaandeYtd = berekenKasstroomManagementoverzicht(balansstanden, boekingenTotEnMetPeriode, mapping);

    expect(subperiode).toEqual(bestaandeYtd);
  });

  it("combineert controleVereist van beide aanroepen, geen dubbele rekeningen", () => {
    const mappingMetOnbekend: GrootboekMappingRegel[] = [balansRegel({ grootboekrekening: "1010", liquideMiddelen: true })];
    const metOnbekendeRekening: Boekingsregel[] = [...boekingenVoorPeriode, boeking("F9", "9999", "50", "0", "2026-01-20")];
    const totEnMet: Boekingsregel[] = [...metOnbekendeRekening, ...boekingenAlleenPeriode0406];

    const resultaat = berekenKasstroomManagementoverzichtSubperiode({
      balansstanden,
      boekingenVoorPeriode: metOnbekendeRekening,
      boekingenTotEnMetPeriode: totEnMet,
      mappingRegels: mappingMetOnbekend,
    });

    expect(resultaat.controleVereist.filter((c) => c.grootboekrekening === "9999")).toHaveLength(1);
  });
});
