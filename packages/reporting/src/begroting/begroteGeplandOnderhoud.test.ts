import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBegroteGeplandOnderhoud, type BgGeplandOnderhoudActiviteitInvoer, type BgGeplandOnderhoudAannames } from "./begroteGeplandOnderhoud.js";

const BEGROTINGSJAAR = 2027;

function aannames(overrides: Partial<BgGeplandOnderhoudAannames> = {}): BgGeplandOnderhoudAannames {
  return { begrotingsjaar: BEGROTINGSJAAR, beoordeeld: true, ...overrides };
}

function activiteit(overrides: Partial<BgGeplandOnderhoudActiviteitInvoer> = {}): BgGeplandOnderhoudActiviteitInvoer {
  return {
    complexnummer: "003",
    omschrijving: "Vervangen dakbedekking",
    aanleidingType: "MJOP",
    aanleidingToelichting: "MJOP 2027 regel 14",
    q1: new Decimal(25000),
    q2: new Decimal(0),
    q3: new Decimal(0),
    q4: new Decimal(0),
    status: "GEPLAND",
    ...overrides,
  };
}

function kritiekeMeldingen(
  controleVereist: { ernst: string; activiteitIndex: number | null; bericht: string }[],
  activiteitIndex: number | null = null,
) {
  return controleVereist.filter((c) => c.ernst === "KRITIEK" && (activiteitIndex === null || c.activiteitIndex === activiteitIndex));
}

describe("berekenBegroteGeplandOnderhoud", () => {
  it("1. nul activiteiten + beoordeeld=false -> NOT_REVIEWED, alle totalen 0", () => {
    const r = berekenBegroteGeplandOnderhoud([], aannames({ beoordeeld: false }));
    expect(r.reviewStatus).toBe("NOT_REVIEWED");
    expect(r.totaalJaar.toString()).toBe("0");
    expect(r.controleVereist).toHaveLength(0);
  });

  it("2. nul activiteiten + beoordeeld=true -> REVIEWED_ZERO_ACTIVITIES, geen warning", () => {
    const r = berekenBegroteGeplandOnderhoud([], aannames({ beoordeeld: true }));
    expect(r.reviewStatus).toBe("REVIEWED_ZERO_ACTIVITIES");
    expect(r.controleVereist).toHaveLength(0);
  });

  it("3. één activiteit met alle kwartalen €0 -> geldig, jaartotaal 0, geen control", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [activiteit({ q1: new Decimal(0), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) })],
      aannames(),
    );
    expect(r.activiteiten[0]?.jaartotaal.toString()).toBe("0");
    expect(r.controleVereist).toHaveLength(0);
  });

  it("4. één activiteit met positieve bedragen -> correcte som", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [activiteit({ q1: new Decimal(1000), q2: new Decimal(2000), q3: new Decimal(3000), q4: new Decimal(4000) })],
      aannames(),
    );
    expect(r.activiteiten[0]?.jaartotaal.toString()).toBe("10000");
    expect(r.totaalJaar.toString()).toBe("10000");
  });

  it("5/6. negatief kwartaalbedrag -> WAARSCHUWING, bedrag blijft ongewijzigd meetellen", () => {
    const r = berekenBegroteGeplandOnderhoud([activiteit({ q1: new Decimal(-500), q2: new Decimal(1000) })], aannames());
    expect(r.activiteiten[0]?.q1.toString()).toBe("-500");
    expect(r.activiteiten[0]?.jaartotaal.toString()).toBe("500");
    expect(r.controleVereist).toContainEqual(
      expect.objectContaining({ ernst: "WAARSCHUWING", activiteitIndex: 0, bericht: expect.stringContaining("Q1") }),
    );
    expect(kritiekeMeldingen(r.controleVereist)).toHaveLength(0);
  });

  it("6/7. meerdere activiteiten, zelfde complex -> perComplex heeft 1 regel met som van alle", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [activiteit({ complexnummer: "003", q1: new Decimal(1000) }), activiteit({ complexnummer: "003", q1: new Decimal(500) })],
      aannames(),
    );
    expect(r.perComplex).toHaveLength(1);
    expect(r.perComplex[0]).toMatchObject({ complexnummer: "003", aantalActiviteiten: 2 });
    expect(r.perComplex[0]?.jaartotaal.toString()).toBe("1500");
  });

  it("7/8. meerdere activiteiten, verschillende complexen -> perComplex heeft N regels, correct gesommeerd", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [activiteit({ complexnummer: "001", q1: new Decimal(1000) }), activiteit({ complexnummer: "004", q1: new Decimal(2000) })],
      aannames(),
    );
    expect(r.perComplex.map((c) => c.complexnummer)).toEqual(["001", "004"]);
    expect(r.perComplex.find((c) => c.complexnummer === "001")?.jaartotaal.toString()).toBe("1000");
    expect(r.perComplex.find((c) => c.complexnummer === "004")?.jaartotaal.toString()).toBe("2000");
  });

  it("8/9. alle zes statussen -> bedragen identiek behandeld, status wijzigt niets rekenkundig", () => {
    const statussen = ["GEPLAND", "IN_UITVOERING", "UITGESTELD", "VERVALLEN", "AFGEROND", "ONVOORZIEN"] as const;
    for (const status of statussen) {
      const r = berekenBegroteGeplandOnderhoud([activiteit({ status, q1: new Decimal(1234) })], aannames());
      expect(r.activiteiten[0]?.jaartotaal.toString()).toBe("1234");
      expect(kritiekeMeldingen(r.controleVereist, 0)).toHaveLength(0);
    }
  });

  it("9. jaartotaal activiteit = som Q1-Q4", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [activiteit({ q1: new Decimal(111), q2: new Decimal(222), q3: new Decimal(333), q4: new Decimal(444) })],
      aannames(),
    );
    expect(r.activiteiten[0]?.jaartotaal.toString()).toBe("1110");
  });

  it("10. moduletotaal via kwartalen = som activiteit-jaartotalen (twee routes aantoonbaar gelijk)", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [
        activiteit({ complexnummer: "001", q1: new Decimal(100), q2: new Decimal(50) }),
        activiteit({ complexnummer: "002", q3: new Decimal(75), q4: new Decimal(25) }),
      ],
      aannames(),
    );
    const viaKwartalen = r.kwartaalTotalen.q1.plus(r.kwartaalTotalen.q2).plus(r.kwartaalTotalen.q3).plus(r.kwartaalTotalen.q4);
    const viaActiviteiten = r.activiteiten.reduce((t, a) => t.plus(a.jaartotaal), new Decimal(0));
    expect(viaKwartalen.toString()).toBe(r.totaalJaar.toString());
    expect(viaActiviteiten.toString()).toBe(r.totaalJaar.toString());
  });

  it("11. per-complex-totalen = relevante activiteitensommen, en totaalJaar reconcilieert met perComplex + totaalZonderGeldigComplex", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [
        activiteit({ complexnummer: "001", q1: new Decimal(100) }),
        activiteit({ complexnummer: "", q1: new Decimal(50) }),
      ],
      aannames(),
    );
    expect(r.perComplex[0]?.jaartotaal.toString()).toBe("100");
    expect(r.totaalZonderGeldigComplex.toString()).toBe("50");
    const viaPerComplex = som(r.perComplex.map((c) => c.jaartotaal)).plus(r.totaalZonderGeldigComplex);
    expect(viaPerComplex.toString()).toBe(r.totaalJaar.toString());
  });

  it("12. optionele velden afwezig -> geen fout", () => {
    const invoer = activiteit();
    delete invoer.leverancier;
    delete invoer.offertebedrag;
    delete invoer.notitie;
    const r = berekenBegroteGeplandOnderhoud([invoer], aannames());
    expect(r.activiteiten[0]?.invoer.leverancier).toBeUndefined();
  });

  it("13. optionele velden aanwezig -> correct doorgegeven", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [activiteit({ leverancier: "Weerts van de Zanden", offertebedrag: new Decimal(24500), notitie: "offerte ontvangen" })],
      aannames(),
    );
    expect(r.activiteiten[0]?.invoer.leverancier).toBe("Weerts van de Zanden");
    expect(r.activiteiten[0]?.invoer.offertebedrag?.toString()).toBe("24500");
    expect(r.activiteiten[0]?.invoer.notitie).toBe("offerte ontvangen");
  });

  it("14. ongeldige aanleidingType -> KRITIEK, financieel totaal blijft ongewijzigd", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [activiteit({ aanleidingType: "NIET_BESTAAND" as unknown as "OVERIG", q1: new Decimal(10000) })],
      aannames(),
    );
    expect(r.activiteiten[0]?.jaartotaal.toString()).toBe("10000");
    expect(kritiekeMeldingen(r.controleVereist, 0).some((c) => c.bericht.includes("aanleidingType"))).toBe(true);
  });

  it("15/case 4. ontbrekend complexnummer -> KRITIEK, modulebreed totaal blijft, niet in perComplex", () => {
    const r = berekenBegroteGeplandOnderhoud([activiteit({ complexnummer: "", q1: new Decimal(10000) })], aannames());
    expect(r.totaalJaar.toString()).toBe("10000");
    expect(r.totaalZonderGeldigComplex.toString()).toBe("10000");
    expect(r.perComplex).toHaveLength(0);
    expect(kritiekeMeldingen(r.controleVereist, 0).some((c) => c.bericht.includes("complexnummer"))).toBe(true);
  });

  it("16/case 1. ontbrekende omschrijving + €10.000 -> KRITIEK, financieel totaal blijft €10.000", () => {
    const r = berekenBegroteGeplandOnderhoud([activiteit({ omschrijving: "", q1: new Decimal(10000) })], aannames());
    expect(r.activiteiten[0]?.jaartotaal.toString()).toBe("10000");
    expect(r.totaalJaar.toString()).toBe("10000");
    expect(kritiekeMeldingen(r.controleVereist, 0).some((c) => c.bericht.includes("omschrijving"))).toBe(true);
  });

  it("17/case 2. ontbrekende aanleidingToelichting + €10.000 -> KRITIEK, financieel totaal blijft €10.000", () => {
    const r = berekenBegroteGeplandOnderhoud([activiteit({ aanleidingToelichting: "", q1: new Decimal(10000) })], aannames());
    expect(r.activiteiten[0]?.jaartotaal.toString()).toBe("10000");
    expect(kritiekeMeldingen(r.controleVereist, 0).some((c) => c.bericht.includes("aanleidingToelichting"))).toBe(true);
  });

  it("18/case 3. ongeldige status + €10.000 -> KRITIEK, financieel totaal blijft €10.000", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [activiteit({ status: "NIET_BESTAAND" as unknown as "GEPLAND", q1: new Decimal(10000) })],
      aannames(),
    );
    expect(r.activiteiten[0]?.jaartotaal.toString()).toBe("10000");
    expect(kritiekeMeldingen(r.controleVereist, 0).some((c) => c.bericht.includes("status"))).toBe(true);
  });

  it("case 5. één NaN-kwartaal naast geldige kwartalen -> alleen dat kwartaal veilige 0-bijdrage, overige blijven", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [activiteit({ q1: new Decimal(10000), q2: new Decimal(NaN), q3: new Decimal(5000), q4: new Decimal(0) })],
      aannames(),
    );
    const a = r.activiteiten[0]!;
    expect(a.q1.toString()).toBe("10000");
    expect(a.q2.toString()).toBe("0");
    expect(a.q3.toString()).toBe("5000");
    expect(a.jaartotaal.toString()).toBe("15000");
    expect(kritiekeMeldingen(r.controleVereist, 0).some((c) => c.bericht.includes("Q2"))).toBe(true);
  });

  it("ongeldig geldbedrag (18) is hetzelfde scenario als case 5 — hier expliciet met alle vier kwartalen NaN", () => {
    const r = berekenBegroteGeplandOnderhoud(
      [activiteit({ q1: new Decimal(NaN), q2: new Decimal(NaN), q3: new Decimal(NaN), q4: new Decimal(NaN) })],
      aannames(),
    );
    expect(r.activiteiten[0]?.jaartotaal.toString()).toBe("0");
    expect(kritiekeMeldingen(r.controleVereist, 0)).toHaveLength(4);
  });

  it("19. beoordeeld=false rekent door — totalen identiek aan beoordeeld=true met dezelfde activiteiten", () => {
    const invoer = [activiteit({ q1: new Decimal(1000) })];
    const rFalse = berekenBegroteGeplandOnderhoud(invoer, aannames({ beoordeeld: false }));
    const rTrue = berekenBegroteGeplandOnderhoud(invoer, aannames({ beoordeeld: true }));
    expect(rFalse.totaalJaar.toString()).toBe(rTrue.totaalJaar.toString());
    expect(rFalse.reviewStatus).toBe("NOT_REVIEWED");
    expect(rTrue.reviewStatus).toBe("REVIEWED_WITH_ACTIVITIES");
  });

  it("20. beoordeeld=true wijzigt niet door activiteitenaantal — pure doorgifte, geen afleiding", () => {
    const rLeeg = berekenBegroteGeplandOnderhoud([], aannames({ beoordeeld: true }));
    const rMetActiviteit = berekenBegroteGeplandOnderhoud([activiteit()], aannames({ beoordeeld: true }));
    expect(rLeeg.beoordeeld).toBe(true);
    expect(rMetActiviteit.beoordeeld).toBe(true);
  });

  it("21. activiteit met ongeldig complexnummer blijft zichtbaar in activiteiten[], alleen afwezig in perComplex", () => {
    const r = berekenBegroteGeplandOnderhoud([activiteit({ complexnummer: "   ", q1: new Decimal(500) })], aannames());
    expect(r.activiteiten).toHaveLength(1);
    expect(r.activiteiten[0]?.jaartotaal.toString()).toBe("500");
    expect(r.perComplex).toHaveLength(0);
  });

  it("case 7. beoordeeld=true + KRITIEKE control -> reviewStatus is REVIEWED_..., KRITIEKE control blijft bestaan (onafhankelijke dimensies)", () => {
    const r = berekenBegroteGeplandOnderhoud([activiteit({ omschrijving: "", q1: new Decimal(1000) })], aannames({ beoordeeld: true }));
    expect(r.reviewStatus).toBe("REVIEWED_WITH_ACTIVITIES");
    expect(kritiekeMeldingen(r.controleVereist, 0).length).toBeGreaterThan(0);
  });
});

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}
