import type { BalansRegel, ResultaatRegel } from "@bvc/config";
import type { Balansstand, Boekingsregel } from "@bvc/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBalansPeriode } from "./balansPeriodeBerekening.js";

function balansRegel(overrides: Partial<BalansRegel> = {}): BalansRegel {
  return {
    grootboekrekening: "1010",
    soort: "BALANS",
    balanszijde: "ACTIVA",
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
  it("telt beginbalans + mutaties op tot het saldo op de peildatum en gebruikt de vaste balanszijde uit de mapping", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("1000"), beginbalansCredit: new Decimal(0) })],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("500"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA" })],
    );
    expect(resultaat.posten).toEqual([
      { grootboekrekening: "1010", omschrijving: "Bank", rapportagecategorie: "ACTIVA", saldo: new Decimal("1500") },
    ]);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("houdt een PASSIVA-rekening op Passiva ook als het berekende saldo positief is (geen classificatie op saldoteken)", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1600", beginbalansDebet: new Decimal("300"), beginbalansCredit: new Decimal(0), rekeningOmschrijving: "Crediteuren" })],
      [],
      [balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA" })],
    );
    // Saldo is hier +300 (netto debet), maar 1600 is en blijft een PASSIVA-rekening (crediteuren).
    expect(resultaat.posten).toEqual([
      { grootboekrekening: "1600", omschrijving: "Crediteuren", rapportagecategorie: "PASSIVA", saldo: new Decimal("300") },
    ]);
  });

  it("houdt een ACTIVA-rekening op Activa ook als het berekende saldo negatief is (bv. een vooruitbetalende debiteur)", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1310", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("10000"), rekeningOmschrijving: "Huurdebiteuren" })],
      [],
      [balansRegel({ grootboekrekening: "1310", balanszijde: "ACTIVA" })],
    );
    expect(resultaat.posten).toEqual([
      { grootboekrekening: "1310", omschrijving: "Huurdebiteuren", rapportagecategorie: "ACTIVA", saldo: new Decimal("-10000") },
    ]);
  });

  it("markeert een BALANS-rekening met een nog niet bevestigde balanszijde (null) als controleVereist, verzint geen kant op basis van het saldoteken", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1506", beginbalansDebet: new Decimal("100"), beginbalansCredit: new Decimal(0), rekeningOmschrijving: "Afdrachten BTW" })],
      [],
      [balansRegel({ grootboekrekening: "1506", balanszijde: null })],
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([{ grootboekrekening: "1506", saldo: new Decimal("100"), reden: expect.any(String) }]);
    expect(resultaat.controleVereist[0]?.reden).toMatch(/[Bb]alanszijde/);
  });

  it("laat een BALANS-rekening met onbevestigde balanszijde weg uit controleVereist als het saldo nul is", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1506", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal(0) })],
      [],
      [balansRegel({ grootboekrekening: "1506", balanszijde: null })],
    );
    expect(resultaat.controleVereist).toEqual([]);
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
      [balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA" }), balansRegel({ grootboekrekening: "1711", balanszijde: "PASSIVA" })],
    );
    const activa = resultaat.categorieTotalen.find((c) => c.rapportagecategorie === "ACTIVA");
    const passiva = resultaat.categorieTotalen.find((c) => c.rapportagecategorie === "PASSIVA");
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
