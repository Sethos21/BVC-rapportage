import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenEstimatedGeplandOnderhoud,
  type BgGeplandOnderhoudEstimatedAannames,
  type BgGeplandOnderhoudEstimatedOnlyActiviteitInvoer,
  type BgGeplandOnderhoudResterendeVerwachtingInvoer,
} from "./begroteGeplandOnderhoudEstimated.js";

/**
 * DELTA BUILD 2 (2026-09-24) — Estimated Gepland Onderhoud: bewijst de 12
 * genummerde scenario's uit de opdracht (§16).
 */

const AANNAMES_ALLE_KWARTALEN_RESTEND: BgGeplandOnderhoudEstimatedAannames = {
  begrotingsjaar: 2026,
  werkelijkTotaalTotAfgeslotenPeriode: new Decimal(100),
  resterendeKwartalen: ["Q1", "Q2", "Q3", "Q4"],
};

function verwachting(overrides: Partial<BgGeplandOnderhoudResterendeVerwachtingInvoer> = {}): BgGeplandOnderhoudResterendeVerwachtingInvoer {
  return { activiteitIndex: 0, q1: new Decimal(0), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0), ...overrides };
}

function estimatedOnly(overrides: Partial<BgGeplandOnderhoudEstimatedOnlyActiviteitInvoer> = {}): BgGeplandOnderhoudEstimatedOnlyActiviteitInvoer {
  return {
    complexnummer: "003",
    omschrijving: "Onvoorziene dakreparatie",
    grootboekrekening: "4300",
    q1: new Decimal(0),
    q2: new Decimal(0),
    q3: new Decimal(0),
    q4: new Decimal(0),
    ...overrides,
  };
}

describe("1. Werkelijk + resterend = Estimated", () => {
  it("werkelijk 100 + resterend 50 = estimated 150", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud(
      [verwachting({ q1: new Decimal(50) })],
      [],
      { ...AANNAMES_ALLE_KWARTALEN_RESTEND, werkelijkTotaalTotAfgeslotenPeriode: new Decimal(100) },
    );
    expect(resultaat.estimatedTotaal.toString()).toBe("150");
  });
});

describe("2. Meerdere activiteiten tellen correct op", () => {
  it("som van meerdere resterende verwachtingen", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud(
      [verwachting({ activiteitIndex: 0, q1: new Decimal(30) }), verwachting({ activiteitIndex: 1, q2: new Decimal(20) })],
      [],
      AANNAMES_ALLE_KWARTALEN_RESTEND,
    );
    expect(resultaat.somResterendBestaandeActiviteiten.toString()).toBe("50");
    expect(resultaat.estimatedTotaal.toString()).toBe("150"); // 100 + 50
  });
});

describe("3. Meerdere resterende kwartalen tellen correct op", () => {
  it("q1+q2+q3+q4 van dezelfde activiteit tellen op", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud(
      [verwachting({ q1: new Decimal(10), q2: new Decimal(20), q3: new Decimal(30), q4: new Decimal(40) })],
      [],
      AANNAMES_ALLE_KWARTALEN_RESTEND,
    );
    expect(resultaat.resterendeVerwachtingen[0]!.totaal.toString()).toBe("100");
  });
});

describe("4. Oorspronkelijke Begroting-Q1-Q4 worden niet gemuteerd", () => {
  it("de calculator ontvangt structureel GEEN Begroting-activiteitinvoer — kan Q1-Q4 dus niet muteren", () => {
    expect(berekenEstimatedGeplandOnderhoud.length).toBe(3); // (resterendeVerwachtingen, estimatedOnlyActiviteiten, aannames) — geen Begroting-parameter
  });
});

describe("5. Resterende verwachting €0 is geldig", () => {
  it("€0 telt mee, geen control", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud([verwachting({ q1: new Decimal(0) })], [], AANNAMES_ALLE_KWARTALEN_RESTEND);
    expect(resultaat.resterendeVerwachtingen[0]!.totaal.toString()).toBe("0");
    expect(resultaat.controleVereist).toHaveLength(0);
  });
});

describe("6. Negatieve resterende verwachting telt correct mee", () => {
  it("negatief bedrag telt volledig mee, levert WAARSCHUWING op", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud([verwachting({ q1: new Decimal(-500) })], [], AANNAMES_ALLE_KWARTALEN_RESTEND);
    expect(resultaat.resterendeVerwachtingen[0]!.q1.toString()).toBe("-500");
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);
  });
});

describe("7. Estimated-only activiteit telt mee in Estimated", () => {
  it("Estimated-only bedrag telt mee in estimatedTotaal", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud([], [estimatedOnly({ q1: new Decimal(750) })], AANNAMES_ALLE_KWARTALEN_RESTEND);
    expect(resultaat.somResterendEstimatedOnly.toString()).toBe("750");
    expect(resultaat.estimatedTotaal.toString()).toBe("850"); // 100 + 750
  });
});

describe("8. Estimated-only activiteit wijzigt oorspronkelijke Begroting niet", () => {
  it("Estimated-only heeft geen enkele koppeling naar/mutatie van Begroting-activiteiten", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud([], [estimatedOnly({ q1: new Decimal(750) })], AANNAMES_ALLE_KWARTALEN_RESTEND);
    expect(resultaat.estimatedOnlyActiviteiten[0]!.invoer).not.toHaveProperty("aanleidingType");
    expect(resultaat.estimatedOnlyActiviteiten[0]!.invoer).not.toHaveProperty("status");
  });
});

describe("9. Status verandert financiële optelling niet", () => {
  it("de calculator kent 'status' niet als invoer — kan de optelling dus niet beïnvloeden", () => {
    const invoer = verwachting({ q1: new Decimal(100) });
    expect(invoer).not.toHaveProperty("status");
    const resultaat = berekenEstimatedGeplandOnderhoud([invoer], [], AANNAMES_ALLE_KWARTALEN_RESTEND);
    expect(resultaat.resterendeVerwachtingen[0]!.totaal.toString()).toBe("100");
  });
});

describe("10. Werkelijk wordt niet automatisch over activiteiten verdeeld", () => {
  it("werkelijkTotaalTotAfgeslotenPeriode is één modulebreed bedrag, nooit gesplitst per activiteit", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud(
      [verwachting({ activiteitIndex: 0 }), verwachting({ activiteitIndex: 1 })],
      [],
      { ...AANNAMES_ALLE_KWARTALEN_RESTEND, werkelijkTotaalTotAfgeslotenPeriode: new Decimal(9000) },
    );
    expect(resultaat.werkelijkTotaalTotAfgeslotenPeriode.toString()).toBe("9000");
    expect(resultaat.resterendeVerwachtingen.every((r) => !("werkelijk" in r))).toBe(true);
  });
});

describe("11. Geen resterende verwachtingen → correcte veilige uitkomst", () => {
  it("lege lijsten leveren estimatedTotaal = werkelijk op", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud([], [], { ...AANNAMES_ALLE_KWARTALEN_RESTEND, werkelijkTotaalTotAfgeslotenPeriode: new Decimal(4200) });
    expect(resultaat.estimatedTotaal.toString()).toBe("4200");
    expect(resultaat.controleVereist).toHaveLength(0);
  });
});

describe("12. Grootboek/OGB uit Delta 1 blijven correct behouden waar relevant", () => {
  it("een Estimated-only activiteit draagt grootboekrekening/ogbKostensoort ongewijzigd in de uitkomst", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud([], [estimatedOnly({ grootboekrekening: "4310", ogbKostensoort: "OGB-9" })], AANNAMES_ALLE_KWARTALEN_RESTEND);
    expect(resultaat.estimatedOnlyActiviteiten[0]!.invoer.grootboekrekening).toBe("4310");
    expect(resultaat.estimatedOnlyActiviteiten[0]!.invoer.ogbKostensoort).toBe("OGB-9");
  });

  it("ontbrekende grootboekrekening op een Estimated-only activiteit levert KRITIEK op, bedrag blijft meetellen", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud([], [estimatedOnly({ grootboekrekening: "", q1: new Decimal(300) })], AANNAMES_ALLE_KWARTALEN_RESTEND);
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("grootboekrekening"))).toBe(true);
    expect(resultaat.estimatedOnlyActiviteiten[0]!.totaal.toString()).toBe("300");
  });
});

describe("Periodefilter (§5B): een bedrag buiten resterendeKwartalen telt niet mee", () => {
  it("een reeds afgesloten kwartaal met een bedrag telt NIET mee en levert een WAARSCHUWING op", () => {
    const resultaat = berekenEstimatedGeplandOnderhoud(
      [verwachting({ q1: new Decimal(999) })], // Q1 niet in resterendeKwartalen hieronder
      [],
      { begrotingsjaar: 2026, werkelijkTotaalTotAfgeslotenPeriode: new Decimal(0), resterendeKwartalen: ["Q2", "Q3", "Q4"] },
    );
    expect(resultaat.resterendeVerwachtingen[0]!.q1.toString()).toBe("0");
    expect(resultaat.estimatedTotaal.toString()).toBe("0");
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("Q1"))).toBe(true);
  });
});
