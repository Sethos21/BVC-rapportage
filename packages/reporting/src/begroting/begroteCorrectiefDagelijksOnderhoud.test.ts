import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenBegroteCorrectiefDagelijksOnderhoud,
  type BgCorrectiefDagelijksAannames,
  type BgCorrectiefDagelijksRegelInvoer,
} from "./begroteCorrectiefDagelijksOnderhoud.js";

const BEGROTINGSJAAR = 2027;

function aannames(overrides: Partial<BgCorrectiefDagelijksAannames> = {}): BgCorrectiefDagelijksAannames {
  return { begrotingsjaar: BEGROTINGSJAAR, beoordeeld: true, ...overrides };
}

function regel(overrides: Partial<BgCorrectiefDagelijksRegelInvoer> = {}): BgCorrectiefDagelijksRegelInvoer {
  return {
    omschrijving: "Reparatie CV-installatie",
    complexnummer: "003",
    jaarbedrag: new Decimal(1200),
    ...overrides,
  };
}

function kritiekeMeldingen(
  controleVereist: { ernst: string; regelIndex: number | null }[],
  regelIndex: number | null = null,
) {
  return controleVereist.filter((c) => c.ernst === "KRITIEK" && (regelIndex === null || c.regelIndex === regelIndex));
}

describe("berekenBegroteCorrectiefDagelijksOnderhoud", () => {
  it("1. nul regels + beoordeeld=false -> NOT_REVIEWED, totaal 0, geen control", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([], aannames({ beoordeeld: false }));
    expect(r.reviewStatus).toBe("NOT_REVIEWED");
    expect(r.totaalJaar.toString()).toBe("0");
    expect(r.controleVereist).toHaveLength(0);
    expect(r.beoordeeld).toBe(false);
  });

  it("2. nul regels + beoordeeld=true -> REVIEWED_ZERO_RULES, geen control", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([], aannames({ beoordeeld: true }));
    expect(r.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    expect(r.controleVereist).toHaveLength(0);
  });

  it("3. één regel -> REVIEWED_WITH_RULES, correcte som", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([regel({ jaarbedrag: new Decimal(1500) })], aannames());
    expect(r.reviewStatus).toBe("REVIEWED_WITH_RULES");
    expect(r.regels[0]?.jaarbedrag.toString()).toBe("1500");
    expect(r.totaalJaar.toString()).toBe("1500");
  });

  it("4. meerdere regels -> som van alle jaarbedragen", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud(
      [regel({ jaarbedrag: new Decimal(1000) }), regel({ jaarbedrag: new Decimal(2500) })],
      aannames(),
    );
    expect(r.totaalJaar.toString()).toBe("3500");
    expect(r.regels).toHaveLength(2);
  });

  it("5. bewust jaarbedrag €0 -> geldig, geen control, telt mee als 0", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([regel({ jaarbedrag: new Decimal(0) })], aannames());
    expect(r.regels[0]?.jaarbedrag.toString()).toBe("0");
    expect(r.controleVereist).toHaveLength(0);
  });

  it("6. negatief jaarbedrag -> WAARSCHUWING, bedrag blijft ongewijzigd meetellen", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([regel({ jaarbedrag: new Decimal(-300) })], aannames());
    expect(r.regels[0]?.jaarbedrag.toString()).toBe("-300");
    expect(r.totaalJaar.toString()).toBe("-300");
    expect(r.controleVereist).toContainEqual(
      expect.objectContaining({ ernst: "WAARSCHUWING", regelIndex: 0, bericht: expect.stringContaining("negatief") }),
    );
    expect(kritiekeMeldingen(r.controleVereist)).toHaveLength(0);
  });

  it("7. lege omschrijving -> KRITIEK, bedrag blijft financieel meetellen (functioneel incompleet ≠ financieel onberekenbaar)", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([regel({ omschrijving: "  ", jaarbedrag: new Decimal(750) })], aannames());
    expect(r.regels[0]?.jaarbedrag.toString()).toBe("750");
    expect(r.totaalJaar.toString()).toBe("750");
    expect(kritiekeMeldingen(r.controleVereist, 0)).toHaveLength(1);
  });

  it("8. jaarbedrag=null -> KRITIEK, veilige bijdrage 0", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([regel({ jaarbedrag: null })], aannames());
    expect(r.regels[0]?.jaarbedrag.toString()).toBe("0");
    expect(r.regels[0]?.invoer.jaarbedrag).toBeNull();
    expect(kritiekeMeldingen(r.controleVereist, 0)).toHaveLength(1);
    expect(r.controleVereist[0]?.bericht).toContain("ontbreekt");
  });

  it("9. jaarbedrag=NaN-Decimal -> KRITIEK, veilige bijdrage 0", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([regel({ jaarbedrag: new Decimal(NaN) })], aannames());
    expect(r.regels[0]?.jaarbedrag.toString()).toBe("0");
    expect(kritiekeMeldingen(r.controleVereist, 0)).toHaveLength(1);
    expect(r.controleVereist[0]?.bericht).toContain("NaN");
  });

  it("10. complexnummer=null (NTB) -> structureel geldig, geen control", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([regel({ complexnummer: null })], aannames());
    expect(r.regels[0]?.invoer.complexnummer).toBeNull();
    expect(r.controleVereist).toHaveLength(0);
  });

  it("11. complexnummer ingevuld -> geldig, geen control", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([regel({ complexnummer: "010" })], aannames());
    expect(r.regels[0]?.invoer.complexnummer).toBe("010");
    expect(r.controleVereist).toHaveLength(0);
  });

  it("12. reviewStatus NOT_REVIEWED ongeacht aantal regels wanneer beoordeeld=false", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([regel(), regel()], aannames({ beoordeeld: false }));
    expect(r.reviewStatus).toBe("NOT_REVIEWED");
    expect(r.beoordeeld).toBe(false);
  });

  it("13. reviewStatus REVIEWED_ZERO_RULES bij beoordeeld=true en geen regels", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([], aannames({ beoordeeld: true }));
    expect(r.reviewStatus).toBe("REVIEWED_ZERO_RULES");
  });

  it("14. reviewStatus REVIEWED_WITH_RULES bij beoordeeld=true en minstens 1 regel", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud([regel()], aannames({ beoordeeld: true }));
    expect(r.reviewStatus).toBe("REVIEWED_WITH_RULES");
  });

  it("15. beoordeeld is pure doorgifte, onafhankelijk van regelmutaties (geen afgeleide state)", () => {
    const r1 = berekenBegroteCorrectiefDagelijksOnderhoud([regel(), regel(), regel()], aannames({ beoordeeld: false }));
    expect(r1.beoordeeld).toBe(false);
    const r2 = berekenBegroteCorrectiefDagelijksOnderhoud([], aannames({ beoordeeld: true }));
    expect(r2.beoordeeld).toBe(true);
  });

  it("16. Decimal-exactheid: geen drijvendekomma-afronding bij optelling", () => {
    const r = berekenBegroteCorrectiefDagelijksOnderhoud(
      [regel({ jaarbedrag: new Decimal("100.10") }), regel({ jaarbedrag: new Decimal("200.20") })],
      aannames(),
    );
    expect(r.totaalJaar.toString()).toBe("300.3");
  });
});
