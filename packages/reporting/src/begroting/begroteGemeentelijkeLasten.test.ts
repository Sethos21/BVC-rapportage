import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenBegroteGemeentelijkeLasten,
  berekenEstimatedGemeentelijkeLasten,
  berekenWerkelijkGemeentelijkeLasten,
  type BgGemeentelijkeLastenAannames,
  bepaalWozHistorie,
  type BgWozObjectInvoer,
  type WerkelijkGemeentelijkeLastenBoekingRegel,
} from "./begroteGemeentelijkeLasten.js";

const BEGROTINGSJAAR = 2027;

function aannames(overrides: Partial<BgGemeentelijkeLastenAannames> = {}): BgGemeentelijkeLastenAannames {
  return {
    begrotingsjaar: BEGROTINGSJAAR,
    werkelijkeGemeentelijkeLasten: new Decimal(9000),
    wozStijgingPercentage: new Decimal(10),
    lastenPercentageStijging: new Decimal(5),
    begrotingsPercentageOverride: null,
    wozSetBevestigd: true,
    beoordeeld: true,
    ...overrides,
  };
}

function wozObject(overrides: Partial<BgWozObjectInvoer> = {}): BgWozObjectInvoer {
  return {
    complexnummer: "001",
    objectType: "GEHEEL_COMPLEX",
    unitnummer: null,
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
    expect(r.historischLastenPercentage!.toString()).toBe("0.3");
    expect(r.wozObjecten[0]?.automatischVerwachteWoz.toString()).toBe("1100000");
    expect(r.wozObjecten[1]?.automatischVerwachteWoz.toString()).toBe("2200000");
    expect(r.totaleAutomatischVerwachteWoz.toString()).toBe("3300000");
    expect(r.automatischBegrotingsPercentage!.toString()).toBe("0.315");
    expect(r.effectiefBegrotingsPercentage!.toString()).toBe("0.315");
    expect(r.totaleEffectiefVerwachteWoz.toString()).toBe("3300000");
    expect(r.begroteGemeentelijkeLasten!.toString()).toBe("10395");
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
    expect(r.automatischBegrotingsPercentage!.toString()).toBe("0.315");
    expect(r.effectiefBegrotingsPercentage!.toString()).toBe("0.4");
    expect(r.begroteGemeentelijkeLasten!.toString()).toBe("13200"); // 3.300.000 * 0,40%
  });

  it("D. expliciete €0 WOZ-override wordt gebruikt, valt NIET terug op automatisch berekende waarde", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject({ verwachteWozOverride: new Decimal(0) })], aannames());
    expect(r.wozObjecten[0]?.automatischVerwachteWoz.toString()).toBe("1100000");
    expect(r.wozObjecten[0]?.effectiefVerwachteWoz.toString()).toBe("0");
  });

  it("E. expliciete 0% begrotingspercentage-override -> effectief 0%, begrote lasten €0", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ begrotingsPercentageOverride: new Decimal(0) }));
    expect(r.effectiefBegrotingsPercentage!.toString()).toBe("0");
    expect(r.begroteGemeentelijkeLasten!.toString()).toBe("0");
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
    expect(r.automatischBegrotingsPercentage!.toString()).toBe(r.historischLastenPercentage!.toString());
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
    expect(r.historischLastenPercentage!.toString()).toBe("0.9");
    expect(r.automatischBegrotingsPercentage!.toString()).toBe("0.855");
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("lastenPercentageStijging"))).toBe(true);
  });

  it("J. niet-positieve werkelijke WOZ: KRITIEK (Master Contract §6.8: positieve WOZ verplicht), de waarde blijft rekenkundig verwerkt", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject({ werkelijkeWoz: new Decimal(-500000) })], aannames());
    expect(r.totaleWerkelijkeWoz.toString()).toBe("-500000");
    expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("moet positief zijn"))).toBe(true);
  });

  it("K. één object aanwezig maar totale werkelijke WOZ = 0: geen deling door nul, KRITIEK, geen NaN/Infinity, REVIEWED_WITH_OBJECTS", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject({ werkelijkeWoz: new Decimal(0) })], aannames());
    expect(r.totaleWerkelijkeWoz.toString()).toBe("0");
    expect(r.historischLastenPercentage!.toString()).toBe("0");
    expect(r.historischLastenPercentage!.isFinite()).toBe(true);
    expect(r.automatischBegrotingsPercentage!.isFinite()).toBe(true);
    expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("totale werkelijke WOZ is nul"))).toBe(true);
    expect(r.reviewStatus).toBe("REVIEWED_WITH_OBJECTS"); // aannames() default heeft beoordeeld: true
  });

  it("K2. meerdere objecten waarvan de werkelijke WOZ optelt tot 0 (elkaar opheffend): geen deling door nul, KRITIEK", () => {
    const r = berekenBegroteGemeentelijkeLasten(
      [
        wozObject({ complexnummer: "001", werkelijkeWoz: new Decimal(100000) }),
        wozObject({ complexnummer: "002", werkelijkeWoz: new Decimal(-100000) }),
      ],
      aannames(),
    );
    expect(r.totaleWerkelijkeWoz.toString()).toBe("0");
    expect(r.historischLastenPercentage!.toString()).toBe("0");
    expect(r.historischLastenPercentage!.isFinite()).toBe(true);
    expect(r.automatischBegrotingsPercentage!.isFinite()).toBe(true);
    expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("totale werkelijke WOZ is nul"))).toBe(true);
  });

  it("L. ontbrekende werkelijkeGemeentelijkeLasten: KRITIEK, geen crash, veilig percentage 0", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ werkelijkeGemeentelijkeLasten: null }));
    expect(r.historischLastenPercentage!.toString()).toBe("0");
    expect(r.automatischBegrotingsPercentage!.toString()).toBe("0");
    expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("werkelijkeGemeentelijkeLasten"))).toBe(true);
  });

  it("M. onvolledige WOZ-regel (ontbrekend complex/adres/datum/woz): KRITIEK per veld, veilige bijdrage, geen crash", () => {
    const r = berekenBegroteGemeentelijkeLasten(
      [wozObject({ complexnummer: null, objectType: null, aanslagjaar: null, waardepeildatum: null, werkelijkeWoz: null })],
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

  it("O. beoordeeld=true + 0 objecten -> REVIEWED_ZERO_OBJECTS + WAARSCHUWING, geen enkele KRITIEK", () => {
    const r = berekenBegroteGemeentelijkeLasten([], aannames({ beoordeeld: true }));
    expect(r.reviewStatus).toBe("REVIEWED_ZERO_OBJECTS");
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("0 WOZ-objecten"))).toBe(true);
    expect(kritiekeMeldingen(r.controleVereist)).toHaveLength(0);
  });

  it("O2 (OB033-016-correctie). beoordeeld=false + 0 objecten + ALLE module-aannames null: NOT_REVIEWED, geen KRITIEK, begrote lasten €0", () => {
    const r = berekenBegroteGemeentelijkeLasten(
      [],
      aannames({
        beoordeeld: false,
        werkelijkeGemeentelijkeLasten: null,
        wozStijgingPercentage: null,
        lastenPercentageStijging: null,
        begrotingsPercentageOverride: null,
      }),
    );
    expect(r.reviewStatus).toBe("NOT_REVIEWED");
    expect(kritiekeMeldingen(r.controleVereist)).toHaveLength(0);
    expect(r.controleVereist).toEqual([]); // ook geen WAARSCHUWING (beoordeeld=false)
    expect(r.totaleWerkelijkeWoz.toString()).toBe("0");
    expect(r.historischLastenPercentage!.toString()).toBe("0");
    expect(r.automatischBegrotingsPercentage!.toString()).toBe("0");
    expect(r.begroteGemeentelijkeLasten!.toString()).toBe("0");
  });

  it("O3 (OB033-016-correctie). beoordeeld=true + 0 objecten + ALLE module-aannames null: REVIEWED_ZERO_OBJECTS, uitsluitend de WAARSCHUWING, GEEN KRITIEK, begrote lasten €0", () => {
    const r = berekenBegroteGemeentelijkeLasten(
      [],
      aannames({
        beoordeeld: true,
        werkelijkeGemeentelijkeLasten: null,
        wozStijgingPercentage: null,
        lastenPercentageStijging: null,
        begrotingsPercentageOverride: null,
      }),
    );
    expect(r.reviewStatus).toBe("REVIEWED_ZERO_OBJECTS");
    expect(kritiekeMeldingen(r.controleVereist)).toHaveLength(0);
    expect(r.controleVereist).toHaveLength(1);
    expect(r.controleVereist[0]?.ernst).toBe("WAARSCHUWING");
    expect(r.controleVereist[0]?.bericht).toContain("0 WOZ-objecten");
    expect(r.begroteGemeentelijkeLasten!.toString()).toBe("0");
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

    const somPerComplexLasten = complex001.begroteGemeentelijkeLasten!.plus(complex002.begroteGemeentelijkeLasten!);
    expect(somPerComplexLasten.toString()).toBe(r.begroteGemeentelijkeLasten!.toString());
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

describe("berekenWerkelijkGemeentelijkeLasten — FASE M7 (nieuw patroon: reeds geclassificeerde invoer, geen GL/OGB-kennis)", () => {
  function boeking(overrides: Partial<WerkelijkGemeentelijkeLastenBoekingRegel> = {}): WerkelijkGemeentelijkeLastenBoekingRegel {
    return { economischeCategorie: "GEMEENTELIJKE_LASTEN", complexnummer: "003", saldo: new Decimal(0), ...overrides };
  }

  it("34. geclassificeerde boekingen (van beide bewezen GL's) tellen op tot ÉÉN categorieTotaal — geen OZB/water/riool-splitsing", () => {
    const r = berekenWerkelijkGemeentelijkeLasten([boeking({ saldo: new Decimal(1500) }), boeking({ saldo: new Decimal(750) })]);
    expect(r.perCategorie).toHaveLength(1);
    expect(r.perCategorie[0]!.categorie).toBe("GEMEENTELIJKE_LASTEN");
    expect(r.perCategorie[0]!.categorieTotaal.toString()).toBe("2250");
    expect(r.moduleTotaal.toString()).toBe("2250");
  });

  it("35. economischeCategorie: null (NIET_GEMAPT) wordt nooit geraden — apart gehouden", () => {
    const r = berekenWerkelijkGemeentelijkeLasten([boeking({ economischeCategorie: null, saldo: new Decimal(300) })]);
    expect(r.moduleTotaal.toString()).toBe("0");
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("300");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(1);
  });

  it("36. complexaggregatie: per complex correct opgeteld", () => {
    const r = berekenWerkelijkGemeentelijkeLasten([boeking({ complexnummer: "001", saldo: new Decimal(400) }), boeking({ complexnummer: "001", saldo: new Decimal(100) }), boeking({ complexnummer: "002", saldo: new Decimal(50) })]);
    const cat = r.perCategorie[0]!;
    expect(cat.perComplex.find((c) => c.complexnummer === "001")!.saldo.toString()).toBe("500");
    expect(cat.perComplex.find((c) => c.complexnummer === "002")!.saldo.toString()).toBe("50");
  });

  it("37. geen dubbele telling: som(perCategorie) + nietGeclassificeerd = alle aangeleverde boekingen", () => {
    const boekingen = [boeking({ saldo: new Decimal(1000) }), boeking({ economischeCategorie: null, saldo: new Decimal(200) })];
    const r = berekenWerkelijkGemeentelijkeLasten(boekingen);
    const somAlleBoekingen = boekingen.reduce((t, b) => t.plus(b.saldo), new Decimal(0));
    const somCategorieen = r.perCategorie.reduce((t, c) => t.plus(c.categorieTotaal), new Decimal(0));
    expect(somCategorieen.plus(r.nietGeclassificeerdTotaal).toString()).toBe(somAlleBoekingen.toString());
  });
});

describe("WOZ-object = bestaand complex + geheel complex of bestaande unit (Master Contract §6.8)", () => {
  const kritiek = (objecten: BgWozObjectInvoer[]) => berekenBegroteGemeentelijkeLasten(objecten, aannames()).controleVereist.filter((c) => c.ernst === "KRITIEK");

  it("geldige objectkeuzes: geheel complex (zonder unitnummer) en unit (met unitnummer) geven geen KRITIEK", () => {
    expect(kritiek([wozObject({ objectType: "GEHEEL_COMPLEX", unitnummer: null })])).toEqual([]);
    expect(kritiek([wozObject({ objectType: "UNIT", unitnummer: "A-12" })])).toEqual([]);
  });

  it("geen objectkeuze, unit zonder unitnummer of geheel complex mét unitnummer: KRITIEK, bedrag blijft meetellen", () => {
    for (const ongeldig of [wozObject({ objectType: null }), wozObject({ objectType: "UNIT", unitnummer: " " }), wozObject({ objectType: "GEHEEL_COMPLEX", unitnummer: "A-1" })]) {
      const r = berekenBegroteGemeentelijkeLasten([ongeldig], aannames());
      expect(r.controleVereist.filter((c) => c.ernst === "KRITIEK" && (c.bericht.includes("objectkeuze") || c.bericht.includes("unitnummer")))).toHaveLength(1);
      expect(r.totaleEffectiefVerwachteWoz.toString()).toBe("1100000");
    }
  });

  it("de objectkeuze beïnvloedt geen bedrag: unit en geheel complex met dezelfde WOZ geven identieke totalen", () => {
    const unit = berekenBegroteGemeentelijkeLasten([wozObject({ objectType: "UNIT", unitnummer: "A-12" })], aannames());
    const geheel = berekenBegroteGemeentelijkeLasten([wozObject()], aannames());
    expect(unit.begroteGemeentelijkeLasten!.toString()).toBe(geheel.begroteGemeentelijkeLasten!.toString());
  });

  it("positieve WOZ: geen KRITIEK; €0 en negatief: KRITIEK", () => {
    expect(kritiek([wozObject({ werkelijkeWoz: new Decimal(1) })])).toEqual([]);
    expect(kritiek([wozObject({ werkelijkeWoz: new Decimal(0) })]).some((c) => c.bericht.includes("moet positief zijn"))).toBe(true);
  });
});

describe("bepaalWozHistorie — ontwikkeling per complex/unit", () => {
  const obj = (o: Partial<BgWozObjectInvoer>) => wozObject(o);
  const objecten = [
    obj({ complexnummer: "001", aanslagjaar: 2026, werkelijkeWoz: new Decimal(1100000) }),
    obj({ complexnummer: "001", aanslagjaar: 2024, werkelijkeWoz: new Decimal(1000000) }),
    obj({ complexnummer: "001", aanslagjaar: 2025, werkelijkeWoz: new Decimal(1050000) }),
    obj({ complexnummer: "001", objectType: "UNIT", unitnummer: "A-12", aanslagjaar: 2025, werkelijkeWoz: new Decimal(200000) }),
    obj({ complexnummer: "001", objectType: "UNIT", unitnummer: "A-12", aanslagjaar: 2026, werkelijkeWoz: new Decimal(190000) }),
    obj({ complexnummer: "002", aanslagjaar: 2026, werkelijkeWoz: new Decimal(500000) }),
  ];

  it("per object per aanslagjaar oplopend, ontwikkeling in € en %; eerste jaar heeft geen ontwikkeling (null, geen 0)", () => {
    const h = bepaalWozHistorie(objecten);
    const geheel001 = h.regels.filter((r) => r.complexnummer === "001" && r.objectType === "GEHEEL_COMPLEX");
    expect(geheel001.map((r) => r.aanslagjaar)).toEqual([2024, 2025, 2026]);
    expect(geheel001[0]!.ontwikkelingBedrag).toBeNull();
    expect(geheel001[0]!.ontwikkelingPercentage).toBeNull();
    expect(geheel001[1]!.ontwikkelingBedrag!.toString()).toBe("50000");
    expect(geheel001[1]!.ontwikkelingPercentage!.toString()).toBe("5");
    expect(geheel001[2]!.ontwikkelingBedrag!.toString()).toBe("50000");
  });

  it("objecten (geheel complex, unit, ander complex) hebben elk hun eigen historie; een daling is een negatieve ontwikkeling", () => {
    const h = bepaalWozHistorie(objecten);
    const unit2026 = h.regels.find((r) => r.objectType === "UNIT" && r.aanslagjaar === 2026)!;
    expect(unit2026.unitnummer).toBe("A-12");
    expect(unit2026.ontwikkelingBedrag!.toString()).toBe("-10000");
    expect(unit2026.ontwikkelingPercentage!.toString()).toBe("-5");
    expect(h.regels.find((r) => r.complexnummer === "002")!.ontwikkelingBedrag).toBeNull();
  });

  it("filter op complex en periode; de ontwikkeling van het eerste gefilterde jaar blijft t.o.v. het jaar vóór het filter", () => {
    const h = bepaalWozHistorie(objecten, { complexnummer: "001", aanslagjaarVan: 2026, aanslagjaarTot: 2026 });
    expect(h.regels.every((r) => r.complexnummer === "001" && r.aanslagjaar === 2026)).toBe(true);
    const geheel = h.regels.find((r) => r.objectType === "GEHEEL_COMPLEX")!;
    expect(geheel.ontwikkelingBedrag!.toString()).toBe("50000");
  });

  it("invoervolgorde is niet van invloed op de uitkomst", () => {
    const voor = bepaalWozHistorie(objecten).regels.map((r) => [r.complexnummer, r.objectType, r.unitnummer, r.aanslagjaar, r.ontwikkelingBedrag?.toString() ?? null]);
    const achter = bepaalWozHistorie([...objecten].reverse()).regels.map((r) => [r.complexnummer, r.objectType, r.unitnummer, r.aanslagjaar, r.ontwikkelingBedrag?.toString() ?? null]);
    expect(achter).toEqual(voor);
  });

  it("onvolledige objecten worden expliciet uitgesloten gemeld, nooit stil weggelaten; voorgaande waarde 0 geeft geen percentage", () => {
    const h = bepaalWozHistorie([obj({ objectType: null }), obj({ aanslagjaar: null }), obj({ werkelijkeWoz: null }), obj({ aanslagjaar: 2025, werkelijkeWoz: new Decimal(0) }), obj({ aanslagjaar: 2026 })]);
    expect(h.uitgeslotenObjectIndices).toEqual([0, 1, 2]);
    const laatste = h.regels.find((r) => r.aanslagjaar === 2026)!;
    expect(laatste.ontwikkelingBedrag!.toString()).toBe("1000000");
    expect(laatste.ontwikkelingPercentage).toBeNull();
  });
});

describe("WOZ-set compleet bevestigen (besluit 2026-09-25)", () => {
  it("VÓÓR bevestiging: geen historisch lastenpercentage, geen automatisch begrotingsvoorstel en geen begroting (null, nooit 0) + KRITIEK", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ wozSetBevestigd: false }));
    expect(r.wozSetBevestigd).toBe(false);
    expect(r.historischLastenPercentage).toBeNull();
    expect(r.automatischBegrotingsPercentage).toBeNull();
    expect(r.effectiefBegrotingsPercentage).toBeNull();
    expect(r.begroteGemeentelijkeLasten).toBeNull();
    expect(r.perComplex.every((c) => c.begroteGemeentelijkeLasten === null)).toBe(true);
    expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.objectIndex === null && c.bericht.includes("nog niet als compleet bevestigd"))).toBe(true);
  });

  it("vóór bevestiging blijft de verwachte WOZ per object beschikbaar en telt de totale WOZ mee (alleen percentage/voorstel wachten)", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ wozSetBevestigd: false }));
    expect(r.totaleWerkelijkeWoz.toString()).toBe("1000000");
    expect(r.wozObjecten[0]!.effectiefVerwachteWoz.toString()).toBe("1100000");
  });

  it("een handmatige begrotingspercentage-override maakt de begroting vóór bevestiging niet bekend", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ wozSetBevestigd: false, begrotingsPercentageOverride: new Decimal(1) }));
    expect(r.begroteGemeentelijkeLasten).toBeNull();
  });

  it("NA bevestiging: identiek aan het bestaande rekengedrag, geen bevestigings-KRITIEK", () => {
    const r = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ wozSetBevestigd: true }));
    expect(r.historischLastenPercentage!.toString()).toBe("0.9");
    expect(r.begroteGemeentelijkeLasten).not.toBeNull();
    expect(r.controleVereist.some((c) => c.bericht.includes("bevestigd"))).toBe(false);
  });

  it("zonder WOZ-objecten is er geen set om te bevestigen: het bestaande bewust-€0-pad blijft ongewijzigd (ook onbevestigd)", () => {
    const r = berekenBegroteGemeentelijkeLasten([], aannames({ wozSetBevestigd: false }));
    expect(r.reviewStatus).toBe("REVIEWED_ZERO_OBJECTS");
    expect(r.begroteGemeentelijkeLasten!.isZero()).toBe(true);
    expect(r.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(false);
  });

  it("Estimated: een onbekende (onbevestigde) Begroting geeft begrotingTotaal/afwijking null; Estimated zelf blijft berekenbaar uit Werkelijk + verwachting", () => {
    const begroting = berekenBegroteGemeentelijkeLasten([wozObject()], aannames({ wozSetBevestigd: false }));
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([{ economischeCategorie: "GEMEENTELIJKE_LASTEN", complexnummer: "001", saldo: new Decimal(9000) }]);
    const r = berekenEstimatedGemeentelijkeLasten(begroting.begroteGemeentelijkeLasten, werkelijk, true, { GEMEENTELIJKE_LASTEN: new Decimal(0) });
    expect(r.moduleBegrotingTotaal).toBeNull();
    expect(r.perCategorie[0]!.afwijking).toBeNull();
    expect(r.moduleEstimatedTotaal!.toString()).toBe("9000");
  });
});
