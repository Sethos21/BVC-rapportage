import type { BalansRegel, ResultaatRegel } from "@bvc/config";
import type { Balansstand, Boekingsregel } from "@bvc/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBalansPeriode } from "./balansPeriodeBerekening.js";

function balansRegel(overrides: Partial<BalansRegel> = {}): BalansRegel {
  return {
    grootboekrekening: "1010",
    soort: "BALANS",
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

describe("berekenBalansPeriode", () => {
  it("telt beginbalans + mutaties op tot het saldo op de peildatum en classificeert een netto-debetsaldo als Activa", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("1000"), beginbalansCredit: new Decimal(0) })],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("500"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010" })],
    );
    expect(resultaat.posten).toEqual([
      { grootboekrekening: "1010", omschrijving: "Bank", rapportagecategorie: "Activa", saldo: new Decimal("1500") },
    ]);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("classificeert een netto-creditsaldo structureel als Passiva, nooit op basis van omschrijving", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1711", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("2000"), rekeningOmschrijving: "Crediteuren" })],
      [],
      [balansRegel({ grootboekrekening: "1711" })],
    );
    expect(resultaat.posten).toEqual([
      { grootboekrekening: "1711", omschrijving: "Crediteuren", rapportagecategorie: "Passiva", saldo: new Decimal("-2000") },
    ]);
  });

  it("markeert een onbekende grootboekrekening met niet-nul mutatie als controleVereist, nooit stilzwijgend genegeerd", () => {
    const resultaat = berekenBalansPeriode(
      [],
      [boeking({ grootboeknr: "9999", bedragDebet: new Decimal("50"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010" })],
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([{ grootboekrekening: "9999", saldo: new Decimal("50"), reden: expect.any(String) }]);
  });

  it("laat een niet-gemapte rekening weg uit controleVereist als de mutatie in de periode per saldo nul is", () => {
    const resultaat = berekenBalansPeriode(
      [],
      [
        boeking({ grootboeknr: "9999", bedragDebet: new Decimal("50"), bedragCredit: new Decimal(0) }),
        boeking({ grootboeknr: "9999", bedragDebet: new Decimal(0), bedragCredit: new Decimal("50") }),
      ],
      [balansRegel({ grootboekrekening: "1010" })],
    );
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("markeert een BALANS-rekening zonder balansstand-rij (geen beginbalans bekend) met mutatie als controleVereist, nooit als 0 aangenomen", () => {
    const resultaat = berekenBalansPeriode(
      [],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("100"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010" })],
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toHaveLength(1);
    expect(resultaat.controleVereist[0]?.reden).toMatch(/Geen balansstand/);
  });

  it("markeert een BALANS-rekening waarvan beide beginbalanskanten ontbreken (null) als controleVereist", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1010", beginbalansDebet: null, beginbalansCredit: null })],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("100"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010" })],
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toHaveLength(1);
    expect(resultaat.controleVereist[0]?.reden).toMatch(/Beginbalans/);
  });

  it("behandelt een eenzijdig ontbrekende beginbalanskant (andere kant wél aangeleverd) als 0, geen datagat", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("300"), beginbalansCredit: null })],
      [],
      [balansRegel({ grootboekrekening: "1010" })],
    );
    expect(resultaat.posten[0]?.saldo.toString()).toBe("300");
  });

  it("markeert een inactieve BALANS-mapping met mutatie alsnog als controleVereist", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1010" })],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("50"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010", actief: false })],
    );
    expect(resultaat.controleVereist).toHaveLength(1);
  });

  it("negeert een RESULTAAT-rekening in posten/controleVereist maar telt de mutatie mee in resultaatTotaal", () => {
    const resultaat = berekenBalansPeriode(
      [],
      [boeking({ grootboeknr: "4000", bedragDebet: new Decimal("75"), bedragCredit: new Decimal(0) })],
      [resultaatRegel({ grootboekrekening: "4000" })],
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([]);
    expect(resultaat.aansluiting.resultaatTotaal.toString()).toBe("75");
  });

  it("groepeert posten per categorie in categorieTotalen (Activa en Passiva apart, geen abs())", () => {
    const resultaat = berekenBalansPeriode(
      [
        stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("1000"), beginbalansCredit: new Decimal(0) }),
        stand({ grootboekrekeningnr: "1711", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("400") }),
      ],
      [],
      [balansRegel({ grootboekrekening: "1010" }), balansRegel({ grootboekrekening: "1711" })],
    );
    const activa = resultaat.categorieTotalen.find((c) => c.rapportagecategorie === "Activa");
    const passiva = resultaat.categorieTotalen.find((c) => c.rapportagecategorie === "Passiva");
    expect(activa?.bedrag.toString()).toBe("1000");
    expect(passiva?.bedrag.toString()).toBe("-400");
  });

  it("sluit de aansluitingscontrole bij een complete, dubbel-boekhoudkundig consistente set (activa + passiva + resultaat = 0)", () => {
    const resultaat = berekenBalansPeriode(
      [
        stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal(0) }),
        stand({ grootboekrekeningnr: "1711", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal(0) }),
      ],
      [
        // Boekstuk balanceert zelf: bank omhoog, resultaat (opbrengst) omhoog.
        boeking({ grootboeknr: "1010", bedragDebet: new Decimal("500"), bedragCredit: new Decimal(0) }),
        boeking({ grootboeknr: "4000", bedragDebet: new Decimal(0), bedragCredit: new Decimal("500") }),
      ],
      [balansRegel({ grootboekrekening: "1010" }), balansRegel({ grootboekrekening: "1711" }), resultaatRegel({ grootboekrekening: "4000" })],
    );
    expect(resultaat.aansluiting.verschil.toString()).toBe("0");
    expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(true);
  });

  it("toont een echte aansluitingsafwijking wanneer een rekening niet gemapt is (verschil = -som(controleVereist))", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal(0) })],
      [
        boeking({ grootboeknr: "1010", bedragDebet: new Decimal("500"), bedragCredit: new Decimal(0) }),
        boeking({ grootboeknr: "9999", bedragDebet: new Decimal(0), bedragCredit: new Decimal("500") }),
      ],
      [balansRegel({ grootboekrekening: "1010" })],
    );
    expect(resultaat.controleVereist).toEqual([{ grootboekrekening: "9999", saldo: new Decimal("-500"), reden: expect.any(String) }]);
    expect(resultaat.aansluiting.verschil.toString()).toBe("500");
    expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(false);
  });

  it("geeft een leeg, sluitend resultaat voor lege invoer", () => {
    const resultaat = berekenBalansPeriode([], [], [balansRegel()]);
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([]);
    expect(resultaat.aansluiting.verschil.toString()).toBe("0");
    expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(true);
  });
});
