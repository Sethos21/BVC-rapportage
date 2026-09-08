import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenBegroteGemeentelijkeLasten,
  type BgGemeentelijkeLastenAannames,
  type BgWozObjectInvoer,
} from "./begroteGemeentelijkeLasten.js";

const BEGROTINGSJAAR = 2027;

function aannames(overrides: Partial<BgGemeentelijkeLastenAannames> = {}): BgGemeentelijkeLastenAannames {
  return {
    begrotingsjaar: BEGROTINGSJAAR,
    werkelijkeGemeentelijkeLasten: new Decimal(9000),
    wozStijgingPercentage: new Decimal(10),
    lastenPercentageStijging: new Decimal(5),
    begrotingsPercentageOverride: null,
    beoordeeld: true,
    ...overrides,
  };
}

function wozObject(overrides: Partial<BgWozObjectInvoer> = {}): BgWozObjectInvoer {
  return {
    complexnummer: "001",
    wozObjectAdres: "Prins Willem-Alexander Sportpark 2",
    aanslagjaar: 2026,
    waardepeildatum: new Date(Date.UTC(2026, 0, 1)),
    werkelijkeWoz: new Decimal(1000000),
    verwachteWozOverride: null,
    ...overrides,
  };
}

function kritiekeMeldingen(controleVereist: { ernst: string; objectIndex: number | null }[], objectIndex: number | null = -1) {
  return controleVereist.filter((c) => c.ernst === "KRITIEK" && (objectIndex === -1 || c.objectIndex === objectIndex));
}

describe("berekenBegroteGemeentelijkeLasten", () => {
  it("A. exact rekenvoorbeeld uit de opdracht: 2 objecten, 10% WOZ-stijging, 5% lastenpercentage-stijging -> €10.395", () => {
    const r = berekenBegroteGemeentelijkeLasten(
      [
        wozObject({ complexnummer: "001", werkelijkeWoz: new Decimal(1000000) }),
        wozObject({ complexnummer: "002", werkelijkeWoz: new Decimal(2000000) }),
      ],
      aannames(),
    );
    expect(r.totaleWerkelijkeWoz.toString()).toBe("3000000");
    expect(r.historischLastenPercentage.toString()).toBe("0.3");
    expect(r.wozObjecten[0]?.automatischVerwachteWoz.toString()).toBe("1100000");
    expect(r.wozObjecten[1]?.automatischVerwachteWoz.toString()).toBe("2200000");
    expect(r.totaleAutomatischVerwachteWoz.toString()).toBe("3300000");
    expect(r.automatischBegrotingsPercentage.toString()).toBe("0.315");
    expect(r.effectiefBegrotingsPercentage.toString()).toBe("0.315");
    expect(r.totaleEffectiefVerwachteWoz.toString()).toBe("3300000");
    expect(r.begroteGemeentelijkeLasten.toString()).toBe("10395");
    expect(kritiekeMeldingen(r.controleVereist)).toHaveLength(0);
  });

  it("B. WOZ-override op één object: effectieve totale WOZ gebruikt de override, automatische waarde blijft zichtbaar", () => {
    const r = berekenBegroteGemeentelijkeLasten(
      [
        wozObject({ complexnummer: "001", werkelijkeWoz: new Decimal(1000000) }),
        wozObject({ complexnummer: "002", werkelijkeWoz: new Decimal(2000000), verwachteWozOverride: new Decimal(2500000) }),
      ],
      aannames(),
    );
    expect(r.wozObjecten[1]?.automatischVerwachteWoz.toString()).toBe("2200000"); // ongewijzigd, blijft referentie
    expect(r.wozObjecten[1]?.effectiefVerwachteWoz.toString()).toBe("2500000");
    expect(r.totaleEffectiefVerwachteWoz.toString()).toBe("3600000"); // 1.100.000 + 2.500.000
  });

  it("C. begrotingsPercentageOverride: begrote lasten gebruiken de override, automatisch percentage blijft traceerbaar", () => {
    const r = berekenBegroteGemeentelijkeLasten(
      [
        wozObject({ complexnummer: "001", werkelijkeWoz: new Decimal(1000000) }),
        wozObject({ complexnummer: "002", werkelijkeWoz: new Decimal(2000000) }),
      ],
      aannames({ begrotingsPercentageOverride: new Decimal("0.40") }),
    );
    expect(r.automatischBegrotingsPercentage.toString()).toBe("0.315");
    expect(r.effectiefBegrotingsPercentage.toString()).toBe("0.4");
    expect(r.begroteGemeentelijkeLasten.toString()).toBe("13200"); // 3.300.000 * 0,40%
  });

  it("D. expliciete €0 WOZ-override wordt gebruikt, valt NIET terug op automatisch berekende waarde", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject({ verwachteWozOverride: new Decimal(0) })], aannames());
    expect(r.wozObjecten[0]?.automatischVerwachteWoz.toString()).toBe("1100000");
    expect(r.wozObjecten[0]?.effectiefVerwachteWoz.toString()).toBe("0");
  });

  it("E. expliciete 0% begrotingspercentage-override -> effectief 0%, begrote lasten €0", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ begrotingsPercentageOverride: new Decimal(0) }));
    expect(r.effectiefBegrotingsPercentage.toString()).toBe("0");
    expect(r.begroteGemeentelijkeLasten.toString()).toBe("0");
  });

  it("F. 0% WOZ-stijging is geldig", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject({ werkelijkeWoz: new Decimal(1000000) })], aannames({ wozStijgingPercentage: new Decimal(0) }));
    expect(r.wozObjecten[0]?.automatischVerwachteWoz.toString()).toBe("1000000");
    expect(kritiekeMeldingen(r.controleVereist)).toHaveLength(0);
  });

  it("G. 0% lastenpercentage-stijging is geldig", () => {
    const r = berekenBegroteGemeentelijkeLasten(
      [wozObject({ complexnummer: "001", werkelijkeWoz: new Decimal(1000000) }), wozObject({ complexnummer: "002", werkelijkeWoz: new Decimal(2000000) })],
      aannames({ lastenPercentageStijging: new Decimal(0) }),
    );
    expect(r.automatischBegrotingsPercentage.toString()).toBe(r.historischLastenPercentage.toString());
    expect(kritiekeMeldingen(r.controleVereist)).toHaveLength(0);
  });

  it("H. negatieve WOZ-stijging: WAARSCHUWING, rekenkundig verwerkt", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject({ werkelijkeWoz: new Decimal(1000000) })], aannames({ wozStijgingPercentage: new Decimal(-5) }));
    expect(r.wozObjecten[0]?.automatischVerwachteWoz.toString()).toBe("950000");
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("wozStijgingPercentage"))).toBe(true);
    expect(kritiekeMeldingen(r.controleVereist)).toHaveLength(0);
  });

  it("I. negatieve lastenpercentage-stijging: WAARSCHUWING, rekenkundig verwerkt", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ lastenPercentageStijging: new Decimal(-5) }));
    // enkel object: werkelijkeWoz 1.000.000, lasten 9.000 -> historisch 0,9%; 0,9% * (1 - 0,05) = 0,855%.
    expect(r.historischLastenPercentage.toString()).toBe("0.9");
    expect(r.automatischBegrotingsPercentage.toString()).toBe("0.855");
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("lastenPercentageStijging"))).toBe(true);
  });

  it("J. negatieve werkelijke WOZ: WAARSCHUWING, rekenkundig verwerkt", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject({ werkelijkeWoz: new Decimal(-500000) })], aannames());
    expect(r.totaleWerkelijkeWoz.toString()).toBe("-500000");
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("werkelijkeWoz"))).toBe(true);
  });

  it("K. totale werkelijke WOZ = 0: geen deling door nul, KRITIEK, geen NaN/Infinity", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject({ werkelijkeWoz: new Decimal(0) })], aannames());
    expect(r.totaleWerkelijkeWoz.toString()).toBe("0");
    expect(r.historischLastenPercentage.toString()).toBe("0");
    expect(r.historischLastenPercentage.isFinite()).toBe(true);
    expect(r.automatischBegrotingsPercentage.isFinite()).toBe(true);
    expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("totale werkelijke WOZ is nul"))).toBe(true);
  });

  it("L. ontbrekende werkelijkeGemeentelijkeLasten: KRITIEK, geen crash, veilig percentage 0", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ werkelijkeGemeentelijkeLasten: null }));
    expect(r.historischLastenPercentage.toString()).toBe("0");
    expect(r.automatischBegrotingsPercentage.toString()).toBe("0");
    expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("werkelijkeGemeentelijkeLasten"))).toBe(true);
  });

  it("M. onvolledige WOZ-regel (ontbrekend complex/adres/datum/woz): KRITIEK per veld, veilige bijdrage, geen crash", () => {
    const r = berekenBegroteGemeentelijkeLasten(
      [wozObject({ complexnummer: null, wozObjectAdres: null, aanslagjaar: null, waardepeildatum: null, werkelijkeWoz: null })],
      aannames(),
    );
    expect(r.wozObjecten[0]?.effectiefVerwachteWoz.toString()).toBe("0");
    const kritiek = kritiekeMeldingen(r.controleVereist, 0);
    expect(kritiek.length).toBeGreaterThanOrEqual(5); // complex, adres, aanslagjaar, waardepeildatum, werkelijkeWoz
    expect(r.perComplex).toEqual([]); // geen geldig complexnummer
  });

  it("N. beoordeeld=false -> NOT_REVIEWED", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ beoordeeld: false }));
    expect(r.reviewStatus).toBe("NOT_REVIEWED");
  });

  it("O. beoordeeld=true + 0 objecten -> REVIEWED_ZERO_OBJECTS + WAARSCHUWING (geen KRITIEK uitsluitend vanwege 0 objecten)", () => {
    const r = berekenBegroteGemeentelijkeLasten([], aannames({ beoordeeld: true }));
    expect(r.reviewStatus).toBe("REVIEWED_ZERO_OBJECTS");
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("0 WOZ-objecten"))).toBe(true);
  });

  it("P. beoordeeld=true + objecten -> REVIEWED_WITH_OBJECTS", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ beoordeeld: true }));
    expect(r.reviewStatus).toBe("REVIEWED_WITH_OBJECTS");
  });

  it("Q. meerdere complexen: correcte aggregatie, modulebrede totalen kloppen, som per-complex-lasten exact gelijk aan modulebedrag", () => {
    const r = berekenBegroteGemeentelijkeLasten(
      [
        wozObject({ complexnummer: "001", werkelijkeWoz: new Decimal(1000000) }),
        wozObject({ complexnummer: "001", werkelijkeWoz: new Decimal(500000) }),
        wozObject({ complexnummer: "002", werkelijkeWoz: new Decimal(2000000) }),
      ],
      aannames(),
    );
    expect(r.perComplex).toHaveLength(2);
    const complex001 = r.perComplex.find((c) => c.complexnummer === "001")!;
    const complex002 = r.perComplex.find((c) => c.complexnummer === "002")!;
    // 1.500.000 * 1,10 = 1.650.000 (complex 001), 2.000.000 * 1,10 = 2.200.000 (complex 002).
    expect(complex001.effectiefVerwachteWoz.toString()).toBe("1650000");
    expect(complex002.effectiefVerwachteWoz.toString()).toBe("2200000");

    const somPerComplexLasten = complex001.begroteGemeentelijkeLasten.plus(complex002.begroteGemeentelijkeLasten);
    expect(somPerComplexLasten.toString()).toBe(r.begroteGemeentelijkeLasten.toString());
  });

  it("Decimal-exactheid: geen drijvendekomma-afronding bij optelling van meerdere objecten", () => {
    const r = berekenBegroteGemeentelijkeLasten(
      [
        wozObject({ complexnummer: "001", werkelijkeWoz: new Decimal("100.10"), verwachteWozOverride: new Decimal("100.10") }),
        wozObject({ complexnummer: "001", werkelijkeWoz: new Decimal("200.20"), verwachteWozOverride: new Decimal("200.20") }),
      ],
      aannames(),
    );
    expect(r.totaleEffectiefVerwachteWoz.toString()).toBe("300.3");
  });
});
