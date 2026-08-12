import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  bankaansluiting,
  boekingSaldo,
  boekstukcontrole,
  budgetafwijkingPct,
  nietGemapteRekeningenMetSaldo,
  procentueleVerandering,
  rapportbedrag,
} from "./finance.js";
import type { Balansstand, Boekingsregel } from "./types.js";

function boeking(overrides: Partial<Boekingsregel> = {}): Boekingsregel {
  return {
    bedrijfsnr: "072",
    boekjaar: 2024,
    dagboeknr: "50",
    boekstuknr: "0000008",
    volgnr: "0001",
    boekstukSleutel: "202450000008",
    grootboeknr: "1300",
    boekdatum: new Date("2024-01-01"),
    omschrijving: "test",
    bedragDebet: new Decimal(0),
    bedragCredit: new Decimal(0),
    ...overrides,
  };
}

describe("boekingSaldo (CAL-FIN-001)", () => {
  it("is debet minus credit", () => {
    const saldo = boekingSaldo({ bedragDebet: new Decimal("100.00"), bedragCredit: new Decimal("40.00") });
    expect(saldo.toString()).toBe("60");
  });
});

describe("rapportbedrag (CAL-FIN-002)", () => {
  it("vermenigvuldigt saldo met de presentatiefactor, wijzigt nooit de bronwaarde", () => {
    const saldo = new Decimal("-50.00");
    expect(rapportbedrag(saldo, { presentatiefactor: -1 }).toString()).toBe("50");
    expect(rapportbedrag(saldo, { presentatiefactor: 1 }).toString()).toBe("-50");
  });
});

describe("boekstukcontrole (CAL-FIN-006)", () => {
  it("markeert een boekstuk dat binnen tolerantie sluit als sluitend", () => {
    const boekingen = [
      boeking({ bedragDebet: new Decimal("100.00"), bedragCredit: new Decimal("0") }),
      boeking({ bedragDebet: new Decimal("0"), bedragCredit: new Decimal("100.00") }),
    ];
    const [resultaat] = boekstukcontrole(boekingen, new Decimal("0.01"));
    expect(resultaat?.sluitBinnenTolerantie).toBe(true);
    expect(resultaat?.som.toString()).toBe("0");
  });

  it("markeert een niet-sluitend boekstuk als afwijkend (reproduceert het type bevinding uit het foutdossier, administratie 072)", () => {
    const boekingen = [
      boeking({ boekstukSleutel: "202450000008", bedragDebet: new Decimal("100.00"), bedragCredit: new Decimal("0") }),
      boeking({ boekstukSleutel: "202450000008", bedragDebet: new Decimal("0"), bedragCredit: new Decimal("95.87") }),
    ];
    const [resultaat] = boekstukcontrole(boekingen, new Decimal("0.01"));
    expect(resultaat?.sluitBinnenTolerantie).toBe(false);
    expect(resultaat?.som.toString()).toBe("4.13");
  });

  it("groepeert afzonderlijk per Bedrijfsnr + Boekstuk_Sleutel", () => {
    const boekingen = [
      boeking({ bedrijfsnr: "072", boekstukSleutel: "A", bedragDebet: new Decimal("10"), bedragCredit: new Decimal("0") }),
      boeking({ bedrijfsnr: "073", boekstukSleutel: "A", bedragDebet: new Decimal("0"), bedragCredit: new Decimal("10") }),
    ];
    const resultaten = boekstukcontrole(boekingen, new Decimal("0.01"));
    expect(resultaten).toHaveLength(2);
    expect(resultaten.every((r) => !r.sluitBinnenTolerantie)).toBe(true);
  });
});

describe("procentueleVerandering (CAL-FIN-008)", () => {
  it("is onbekend bij een vergelijkingswaarde van nul, nooit een verzonnen percentage", () => {
    const resultaat = procentueleVerandering(new Decimal("10"), { type: "bekend", waarde: new Decimal("0") });
    expect(resultaat.type).toBe("onbekend");
  });

  it("gebruikt de absolute vergelijkingswaarde als noemer", () => {
    const resultaat = procentueleVerandering(new Decimal("10"), { type: "bekend", waarde: new Decimal("-50") });
    expect(resultaat.type).toBe("bekend");
    if (resultaat.type === "bekend") {
      expect(resultaat.waarde.toString()).toBe("20");
    }
  });
});

describe("budgetafwijkingPct (CAL-FIN-010)", () => {
  it("is onbekend bij budget nul", () => {
    const resultaat = budgetafwijkingPct(new Decimal("100"), { type: "bekend", waarde: new Decimal("0") });
    expect(resultaat.type).toBe("onbekend");
  });
});

describe("bankaansluiting", () => {
  it("beginstand + mutaties moet exact aansluiten op eindstand (FA-005 uit het foutdossier)", () => {
    const resultaat = bankaansluiting(new Decimal("-1456"), new Decimal("71431"), new Decimal("73038"), new Decimal("1"));
    expect(resultaat.verschil.toString()).toBe("-3063");
    expect(resultaat.sluitBinnenTolerantie).toBe(false);
  });
});

describe("nietGemapteRekeningenMetSaldo (PAR-MAP-001)", () => {
  it("blokkeert iedere rekening met niet-nul saldo zonder goedgekeurde mapping", () => {
    const standen: Balansstand[] = [
      { bedrijfsnr: "072", jaar: 2024, grootboekrekeningnr: "1300", saldoDebet: new Decimal(0), saldoCredit: new Decimal(0), eindsaldo: new Decimal("500") },
      { bedrijfsnr: "072", jaar: 2024, grootboekrekeningnr: "1400", saldoDebet: new Decimal(0), saldoCredit: new Decimal(0), eindsaldo: new Decimal("0") },
    ];
    const geblokkeerd = nietGemapteRekeningenMetSaldo(standen, new Set(["072::1400"]));
    expect(geblokkeerd).toHaveLength(1);
    expect(geblokkeerd[0]?.grootboekrekeningnr).toBe("1300");
  });
});
