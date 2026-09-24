import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenEstimatedCorrectiefDagelijksOnderhoud,
  type BgCorrectiefDagelijksEstimatedAannames,
  type BgCorrectiefDagelijksEstimatedOnlyRegelInvoer,
  type BgCorrectiefDagelijksResterendeVerwachtingInvoer,
} from "./begroteCorrectiefDagelijksOnderhoudEstimated.js";

/**
 * DELTA BUILD 2 (2026-09-24) — Estimated Correctief/Dagelijks Onderhoud:
 * bewijst de 12 genummerde scenario's uit de opdracht (§17).
 */

const AANNAMES: BgCorrectiefDagelijksEstimatedAannames = { begrotingsjaar: 2026, werkelijkTotaalTotAfgeslotenPeriode: new Decimal(100) };

function verwachting(overrides: Partial<BgCorrectiefDagelijksResterendeVerwachtingInvoer> = {}): BgCorrectiefDagelijksResterendeVerwachtingInvoer {
  return { regelIndex: 0, resterendBedrag: new Decimal(0), ...overrides };
}

function estimatedOnly(overrides: Partial<BgCorrectiefDagelijksEstimatedOnlyRegelInvoer> = {}): BgCorrectiefDagelijksEstimatedOnlyRegelInvoer {
  return { omschrijving: "Onvoorziene lekkage", complexnummer: "003", grootboekrekening: "4300", resterendBedrag: new Decimal(0), ...overrides };
}

describe("1. Werkelijk + resterend = Estimated", () => {
  it("werkelijk 100 + resterend 50 = estimated 150", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud([verwachting({ resterendBedrag: new Decimal(50) })], [], AANNAMES);
    expect(resultaat.estimatedTotaal.toString()).toBe("150");
  });
});

describe("2. Meerdere regels tellen correct op", () => {
  it("som van meerdere resterende verwachtingen", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud(
      [verwachting({ regelIndex: 0, resterendBedrag: new Decimal(30) }), verwachting({ regelIndex: 1, resterendBedrag: new Decimal(20) })],
      [],
      AANNAMES,
    );
    expect(resultaat.somResterendBestaandeRegels.toString()).toBe("50");
    expect(resultaat.estimatedTotaal.toString()).toBe("150");
  });
});

describe("3. Resterende verwachting €0 is geldig", () => {
  it("expliciet €0 telt mee, geen control", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud([verwachting({ resterendBedrag: new Decimal(0) })], [], AANNAMES);
    expect(resultaat.resterendeVerwachtingen[0]!.bedrag.toString()).toBe("0");
    expect(resultaat.controleVereist).toHaveLength(0);
  });
});

describe("4. Leeg en €0 blijven onderscheiden", () => {
  it("null en Decimal(0) leveren beide bedrag 0 op, maar invoer blijft onderscheidbaar", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud(
      [verwachting({ regelIndex: 0, resterendBedrag: null }), verwachting({ regelIndex: 1, resterendBedrag: new Decimal(0) })],
      [],
      AANNAMES,
    );
    expect(resultaat.resterendeVerwachtingen[0]!.invoer.resterendBedrag).toBeNull();
    expect(resultaat.resterendeVerwachtingen[1]!.invoer.resterendBedrag).not.toBeNull();
    expect(resultaat.resterendeVerwachtingen[0]!.bedrag.toString()).toBe("0");
    expect(resultaat.resterendeVerwachtingen[1]!.bedrag.toString()).toBe("0");
  });
});

describe("5. Negatieve resterende verwachting telt correct mee", () => {
  it("negatief bedrag telt volledig mee, levert WAARSCHUWING op", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud([verwachting({ resterendBedrag: new Decimal(-500) })], [], AANNAMES);
    expect(resultaat.resterendeVerwachtingen[0]!.bedrag.toString()).toBe("-500");
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);
  });
});

describe("6. Estimated-only regel telt mee", () => {
  it("Estimated-only bedrag telt mee in estimatedTotaal", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud([], [estimatedOnly({ resterendBedrag: new Decimal(750) })], AANNAMES);
    expect(resultaat.somResterendEstimatedOnly.toString()).toBe("750");
    expect(resultaat.estimatedTotaal.toString()).toBe("850");
  });
});

describe("7. Estimated-only regel wijzigt oorspronkelijke Begroting niet", () => {
  it("Estimated-only heeft geen Q1-Q4/status/bron-velden — kan de Begroting-regel dus niet raken", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud([], [estimatedOnly()], AANNAMES);
    expect(resultaat.estimatedOnlyRegels[0]!.invoer).not.toHaveProperty("q1");
    expect(resultaat.estimatedOnlyRegels[0]!.invoer).not.toHaveProperty("status");
  });
});

describe("8. Geen kwartaal-/maandlogica wordt geïntroduceerd", () => {
  it("de invoertypes kennen geen q1-q4/maandvelden", () => {
    const v = verwachting();
    const e = estimatedOnly();
    expect(v).not.toHaveProperty("q1");
    expect(e).not.toHaveProperty("q1");
    expect(v).not.toHaveProperty("maand");
  });
});

describe("9. Werkelijk wordt niet automatisch over regels verdeeld", () => {
  it("werkelijkTotaalTotAfgeslotenPeriode is één modulebreed bedrag, nooit gesplitst per regel", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud(
      [verwachting({ regelIndex: 0 }), verwachting({ regelIndex: 1 })],
      [],
      { ...AANNAMES, werkelijkTotaalTotAfgeslotenPeriode: new Decimal(9000) },
    );
    expect(resultaat.werkelijkTotaalTotAfgeslotenPeriode.toString()).toBe("9000");
    expect(resultaat.resterendeVerwachtingen.every((r) => !("werkelijk" in r))).toBe(true);
  });
});

describe("10. Complex NTB blijft geldig", () => {
  it("complexnummer null op een Estimated-only regel levert geen control op", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud([], [estimatedOnly({ complexnummer: null })], AANNAMES);
    expect(resultaat.controleVereist.some((c) => c.bericht.includes("complexnummer"))).toBe(false);
  });
});

describe("11. OGB blijft optioneel", () => {
  it("ontbrekende ogbKostensoort levert geen control op", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud([], [estimatedOnly()], AANNAMES);
    expect(resultaat.controleVereist.some((c) => c.bericht.includes("ogb") || c.bericht.toLowerCase().includes("kostensoort"))).toBe(false);
  });
});

describe("12. Grootboek blijft verplicht waar een complete Estimated-only regel wordt vastgelegd", () => {
  it("ontbrekende grootboekrekening levert KRITIEK op, bedrag blijft meetellen", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud([], [estimatedOnly({ grootboekrekening: "", resterendBedrag: new Decimal(300) })], AANNAMES);
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("grootboekrekening"))).toBe(true);
    expect(resultaat.estimatedOnlyRegels[0]!.bedrag.toString()).toBe("300");
  });

  it("ontbrekend resterend bedrag op een Estimated-only regel levert KRITIEK op (anders dan een bestaande regel)", () => {
    const resultaat = berekenEstimatedCorrectiefDagelijksOnderhoud([], [estimatedOnly({ resterendBedrag: null })], AANNAMES);
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("resterend bedrag"))).toBe(true);
    expect(resultaat.estimatedOnlyRegels[0]!.bedrag.toString()).toBe("0");
  });
});
