import type { BalansRegel, ResultaatRegel } from "@bvc/config";
import type { Balansstand, Boekingsregel, OnbekendOf } from "@bvc/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBalansPeriode } from "./balansPeriodeBerekening.js";

function balansRegel(overrides: Partial<BalansRegel> = {}): BalansRegel {
  return {
    grootboekrekening: "1010",
    soort: "BALANS",
    balanszijde: "ACTIVA",
    tekenconventie: "ZOALS_BRON",
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

function bekendResultaat(waarde: string): OnbekendOf<Decimal> {
  return { type: "bekend", waarde: new Decimal(waarde) };
}

const onbekendResultaat: OnbekendOf<Decimal> = { type: "onbekend", reden: "test: nog geen P&L-resultaat aangeleverd" };

describe("berekenBalansPeriode", () => {
  it("telt beginbalans + mutaties op tot het rauwe saldo en toont dat ongewijzigd bij tekenconventie ZOALS_BRON", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("1000"), beginbalansCredit: new Decimal(0) })],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("500"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([
      { grootboekrekening: "1010", omschrijving: "Bank", rapportagecategorie: "ACTIVA", saldo: new Decimal("1500") },
    ]);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("keert het teken om bij OMGEKEERD, bv. een credit-normale Passiva-rekening die als positief schuldbedrag getoond moet worden", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1600", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("2000"), rekeningOmschrijving: "Crediteuren" })],
      [],
      [balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" })],
      onbekendResultaat,
    );
    // Rauw saldo is -2000 (credit-heavy); met OMGEKEERD getoond als +2000 (schuldbedrag).
    expect(resultaat.posten).toEqual([
      { grootboekrekening: "1600", omschrijving: "Crediteuren", rapportagecategorie: "PASSIVA", saldo: new Decimal("2000") },
    ]);
  });

  it("voert GEEN generieke tekenomkering per balanszijde uit: twee PASSIVA-rekeningen met verschillende tekenconventie tonen verschillend", () => {
    const resultaat = berekenBalansPeriode(
      [
        stand({ grootboekrekeningnr: "1600", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("2000"), rekeningOmschrijving: "Crediteuren" }),
        stand({ grootboekrekeningnr: "0840", beginbalansDebet: new Decimal("500"), beginbalansCredit: new Decimal(0), rekeningOmschrijving: "Onttrekkingen - Uitkeringen" }),
      ],
      [],
      [
        balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
        balansRegel({ grootboekrekening: "0840", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
      ],
      onbekendResultaat,
    );
    const crediteuren = resultaat.posten.find((p) => p.grootboekrekening === "1600");
    const onttrekkingen = resultaat.posten.find((p) => p.grootboekrekening === "0840");
    // Zelfde tekenconventie (OMGEKEERD), maar tegengesteld getoond teken — puur een gevolg van hun eigen rauwe saldo, geen categorie-brede regel.
    expect(crediteuren?.saldo.toString()).toBe("2000");
    expect(onttrekkingen?.saldo.toString()).toBe("-500");
  });

  it("houdt een PASSIVA-rekening op Passiva ook als het GETOONDE saldo positief is (geen classificatie op saldoteken)", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1600", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("300"), rekeningOmschrijving: "Crediteuren" })],
      [],
      [balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" })],
      onbekendResultaat,
    );
    expect(resultaat.posten[0]?.rapportagecategorie).toBe("PASSIVA");
    expect(resultaat.posten[0]?.saldo.toString()).toBe("300");
  });

  it("houdt een ACTIVA-rekening op Activa ook als het saldo negatief is (bv. een vooruitbetalende debiteur)", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1310", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("10000"), rekeningOmschrijving: "Huurdebiteuren" })],
      [],
      [balansRegel({ grootboekrekening: "1310", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([
      { grootboekrekening: "1310", omschrijving: "Huurdebiteuren", rapportagecategorie: "ACTIVA", saldo: new Decimal("-10000") },
    ]);
  });

  it("markeert een BALANS-rekening met een nog niet bevestigde balanszijde (null) als controleVereist, verzint geen kant op basis van het saldoteken", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1506", beginbalansDebet: new Decimal("100"), beginbalansCredit: new Decimal(0), rekeningOmschrijving: "Afdrachten BTW" })],
      [],
      [balansRegel({ grootboekrekening: "1506", balanszijde: null, tekenconventie: null })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([{ grootboekrekening: "1506", saldo: new Decimal("100"), reden: expect.any(String) }]);
    expect(resultaat.controleVereist[0]?.reden).toMatch(/[Bb]alanszijde/);
  });

  it("markeert een BALANS-rekening met bevestigde balanszijde maar onbevestigde tekenconventie als controleVereist", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1711", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("300"), rekeningOmschrijving: "Tussenrekening servicekst" })],
      [],
      [balansRegel({ grootboekrekening: "1711", balanszijde: "PASSIVA", tekenconventie: null })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([{ grootboekrekening: "1711", saldo: new Decimal("-300"), reden: expect.any(String) }]);
    expect(resultaat.controleVereist[0]?.reden).toMatch(/[Tt]ekenconventie/);
  });

  it("laat een BALANS-rekening met onbevestigde balanszijde weg uit controleVereist als het saldo nul is", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1506", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal(0) })],
      [],
      [balansRegel({ grootboekrekening: "1506", balanszijde: null, tekenconventie: null })],
      onbekendResultaat,
    );
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("markeert een onbekende grootboekrekening met niet-nul mutatie als controleVereist, nooit stilzwijgend genegeerd", () => {
    const resultaat = berekenBalansPeriode(
      [],
      [boeking({ grootboeknr: "9999", bedragDebet: new Decimal("50"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010" })],
      onbekendResultaat,
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
      onbekendResultaat,
    );
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("markeert een BALANS-rekening zonder balansstand-rij (geen beginbalans bekend) met mutatie als controleVereist, nooit als 0 aangenomen", () => {
    const resultaat = berekenBalansPeriode(
      [],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("100"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010" })],
      onbekendResultaat,
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
      onbekendResultaat,
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
      onbekendResultaat,
    );
    expect(resultaat.posten[0]?.saldo.toString()).toBe("300");
  });

  it("markeert een inactieve BALANS-mapping met mutatie alsnog als controleVereist", () => {
    const resultaat = berekenBalansPeriode(
      [stand({ grootboekrekeningnr: "1010" })],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("50"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010", actief: false })],
      onbekendResultaat,
    );
    expect(resultaat.controleVereist).toHaveLength(1);
  });

  it("negeert een RESULTAAT-rekening volledig in posten/controleVereist (die hoort in de P&L, niet hier)", () => {
    const resultaat = berekenBalansPeriode(
      [],
      [boeking({ grootboeknr: "4000", bedragDebet: new Decimal("75"), bedragCredit: new Decimal(0) })],
      [resultaatRegel({ grootboekrekening: "4000" })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("groepeert posten per categorie in categorieTotalen (Activa en Passiva apart, geen abs())", () => {
    const resultaat = berekenBalansPeriode(
      [
        stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("1000"), beginbalansCredit: new Decimal(0) }),
        stand({ grootboekrekeningnr: "1711", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("400") }),
      ],
      [],
      [
        balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" }),
        balansRegel({ grootboekrekening: "1711", balanszijde: "PASSIVA", tekenconventie: "ZOALS_BRON" }),
      ],
      onbekendResultaat,
    );
    const activa = resultaat.categorieTotalen.find((c) => c.rapportagecategorie === "ACTIVA");
    const passiva = resultaat.categorieTotalen.find((c) => c.rapportagecategorie === "PASSIVA");
    expect(activa?.bedrag.toString()).toBe("1000");
    expect(passiva?.bedrag.toString()).toBe("-400");
  });

  describe("aansluitingscontrole (activaTotaal - passivaTotaal - resultaatHuidigBoekjaar)", () => {
    it("sluit wanneer activa, passiva (getoond) en het aangeleverde resultaat aan elkaar gelijk zijn", () => {
      const resultaat = berekenBalansPeriode(
        [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("500"), beginbalansCredit: new Decimal(0) })],
        [],
        [balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" })],
        bekendResultaat("500"),
      );
      expect(resultaat.aansluiting.verschil).toEqual({ type: "bekend", waarde: new Decimal("0") });
      expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(true);
    });

    it("toont een echt verschil wanneer activa/passiva niet overeenkomen met het resultaat", () => {
      const resultaat = berekenBalansPeriode(
        [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("500"), beginbalansCredit: new Decimal(0) })],
        [],
        [balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" })],
        bekendResultaat("470"),
      );
      expect(resultaat.aansluiting.verschil).toEqual({ type: "bekend", waarde: new Decimal("30") });
      expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(false);
    });

    it("is onbekend (nooit stilzwijgend sluitend) als het resultaat huidig boekjaar zelf onbekend is", () => {
      const resultaat = berekenBalansPeriode([], [], [balansRegel()], onbekendResultaat);
      expect(resultaat.aansluiting.verschil.type).toBe("onbekend");
      expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(false);
    });
  });

  it("geeft een leeg resultaat voor lege invoer (sluit bij resultaat 0)", () => {
    const resultaat = berekenBalansPeriode([], [], [balansRegel()], bekendResultaat("0"));
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([]);
    expect(resultaat.aansluiting.verschil).toEqual({ type: "bekend", waarde: new Decimal("0") });
    expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(true);
  });
});
