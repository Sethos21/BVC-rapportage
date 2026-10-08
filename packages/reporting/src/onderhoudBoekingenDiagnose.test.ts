import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { diagnoseerOnderhoudBoekingen, type OnderhoudBoekingRegel } from "./onderhoudBoekingenDiagnose.js";

function regel(overrides: Partial<OnderhoudBoekingRegel>): OnderhoudBoekingRegel {
  return {
    boekjaar: 2025,
    boekperiode: "01",
    boekdatum: new Date("2025-01-15"),
    boekstukSleutel: "202550000001",
    dagboeknr: "50",
    dagboekomschrijving: "Inkoop",
    grootboeknr: "4300",
    bedragDebet: new Decimal(100),
    bedragCredit: new Decimal(0),
    omschrijving: "daklekkage herstel",
    ogbKostensoort: "4200",
    ogbKostensoortOmschrijving: "Dak",
    complexnr: "001",
    factuurnr: "F001",
    relatienr: "C001",
    relatienaam: "Dakdekker BV",
    ...overrides,
  };
}

describe("diagnoseerOnderhoudBoekingen", () => {
  it("berekent per-grootboekrekening vullingsgraad en totalen, exclusief lege OGB-kostensoort", () => {
    const regels = [
      regel({ grootboeknr: "4300", ogbKostensoort: "4200", bedragDebet: new Decimal(100) }),
      regel({ grootboeknr: "4300", ogbKostensoort: null, ogbKostensoortOmschrijving: null, bedragDebet: new Decimal(50) }),
      regel({ grootboeknr: "4330", ogbKostensoort: "4990", bedragDebet: new Decimal(200) }),
    ];

    const resultaat = diagnoseerOnderhoudBoekingen(regels, ["001"]);

    expect(resultaat.aantalRegels).toBe(3);
    const gl4300 = resultaat.perGrootboekrekening.find((g) => g.grootboekrekening === "4300");
    expect(gl4300).toMatchObject({ aantalRegels: 2, aantalOgbGevuld: 1, aantalOgbLeeg: 1, vullingspercentageOgb: 50 });
    expect(gl4300?.totaalSaldo.toString()).toBe("150");

    const gl4330 = resultaat.perGrootboekrekening.find((g) => g.grootboekrekening === "4330");
    expect(gl4330).toMatchObject({ aantalRegels: 1, aantalOgbGevuld: 1, vullingspercentageOgb: 100 });
  });

  it("bouwt de matrix grootboek x OGB-kostensoort met aantal en bedrag per combinatie", () => {
    const regels = [
      regel({ grootboeknr: "4300", ogbKostensoort: "4200", bedragDebet: new Decimal(100) }),
      regel({ grootboeknr: "4300", ogbKostensoort: "4200", bedragDebet: new Decimal(50) }),
      regel({ grootboeknr: "4300", ogbKostensoort: "4991", bedragDebet: new Decimal(30) }),
    ];

    const resultaat = diagnoseerOnderhoudBoekingen(regels, []);

    expect(resultaat.matrixGrootboekOgbKostensoort).toHaveLength(2);
    const combinatie4200 = resultaat.matrixGrootboekOgbKostensoort.find((m) => m.ogbKostensoort === "4200");
    expect(combinatie4200).toMatchObject({ grootboekrekening: "4300", aantalRegels: 2 });
    expect(combinatie4200?.totaalSaldo.toString()).toBe("150");
  });

  it("markeert complexnummers die niet in de authoritative complexbron voorkomen", () => {
    const regels = [
      regel({ complexnr: "001" }),
      regel({ complexnr: "999" }),
      regel({ complexnr: null }),
    ];

    const resultaat = diagnoseerOnderhoudBoekingen(regels, ["001", "002"]);

    expect(resultaat.complex).toMatchObject({ aantalGevuld: 2, aantalLeeg: 1, vullingspercentage: 66.67 });
    const complex001 = resultaat.complex.perComplex.find((c) => c.complexnr === "001");
    const complex999 = resultaat.complex.perComplex.find((c) => c.complexnr === "999");
    expect(complex001?.bekendInComplexbron).toBe(true);
    expect(complex999?.bekendInComplexbron).toBe(false);
  });

  it("nooit Math.abs: saldo blijft debet-credit, negatief bedrag blijft negatief zichtbaar", () => {
    const regels = [regel({ bedragDebet: new Decimal(0), bedragCredit: new Decimal(75) })];

    const resultaat = diagnoseerOnderhoudBoekingen(regels, []);

    expect(resultaat.regels[0]?.saldo.toString()).toBe("-75");
    expect(resultaat.totaalSaldoAlleRegels.toString()).toBe("-75");
  });
});
