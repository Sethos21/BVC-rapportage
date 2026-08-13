import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBalansTotaalEindsaldo, berekenGrootboekTotalen, berekenServicekostenPerKostensoort } from "./controlerapport.js";

describe("berekenGrootboekTotalen", () => {
  it("groepeert boekingen per grootboeknr en telt debet/credit op, saldo = debet - credit", () => {
    const totalen = berekenGrootboekTotalen([
      { grootboeknr: "1010", bedragDebet: new Decimal("100"), bedragCredit: new Decimal("0") },
      { grootboeknr: "1010", bedragDebet: new Decimal("50"), bedragCredit: new Decimal("0") },
      { grootboeknr: "8000", bedragDebet: new Decimal("0"), bedragCredit: new Decimal("150") },
    ]);
    expect(totalen).toEqual([
      { grootboeknr: "1010", debet: new Decimal("150"), credit: new Decimal("0"), saldo: new Decimal("150") },
      { grootboeknr: "8000", debet: new Decimal("0"), credit: new Decimal("150"), saldo: new Decimal("-150") },
    ]);
  });

  it("sorteert alfabetisch op grootboeknr", () => {
    const totalen = berekenGrootboekTotalen([
      { grootboeknr: "9000", bedragDebet: new Decimal("1"), bedragCredit: new Decimal("0") },
      { grootboeknr: "1010", bedragDebet: new Decimal("1"), bedragCredit: new Decimal("0") },
    ]);
    expect(totalen.map((t) => t.grootboeknr)).toEqual(["1010", "9000"]);
  });

  it("geeft een lege lijst voor geen boekingen (geen crash)", () => {
    expect(berekenGrootboekTotalen([])).toEqual([]);
  });
});

describe("berekenServicekostenPerKostensoort", () => {
  it("groepeert per kostensoort, past GEEN uitsluitingsregel toe (bewust — reconciliatie, geen KPI)", () => {
    const totalen = berekenServicekostenPerKostensoort([
      { kostensoort: "9600", omschrijving: "Afrekening vorig jaar", bedragDebet: new Decimal("0"), bedragCredit: new Decimal("500") },
      { kostensoort: "0014", omschrijving: "Onderhoud", bedragDebet: new Decimal("67.5"), bedragCredit: new Decimal("0") },
    ]);
    expect(totalen.map((t) => t.kostensoort)).toEqual(["0014", "9600"]);
    const kostensoort9600 = totalen.find((t) => t.kostensoort === "9600");
    expect(kostensoort9600?.saldo.toString()).toBe("-500");
  });
});

describe("berekenBalansTotaalEindsaldo", () => {
  it("telt eindsaldi op als controlegetal", () => {
    const totaal = berekenBalansTotaalEindsaldo([
      { grootboekrekeningnr: "1300", omschrijving: "Bank", eindsaldo: new Decimal("12000") },
      { grootboekrekeningnr: "1600", omschrijving: "Debiteuren", eindsaldo: new Decimal("-500") },
    ]);
    expect(totaal.toString()).toBe("11500");
  });
});
