import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  LEEGSTAND_CATEGORIEEN,
  berekenBegroteLeegstand,
  berekenEstimatedLeegstand,
  berekenWerkelijkLeegstand,
  type BgLeegstandCategorie,
  type BgLeegstandCategorieAannames,
  type BgLeegstandRegelInvoer,
  type LeegstandClassificatieRegel,
  type WerkelijkLeegstandBoekingRegel,
} from "./begroteLeegstand.js";

const BEGROTINGSJAAR = 2027;

function regel(overrides: Partial<BgLeegstandRegelInvoer> = {}): BgLeegstandRegelInvoer {
  return {
    categorie: "OVERIGE_LEEGSTANDSKOSTEN",
    complexnummer: null,
    complexomschrijving: null,
    omschrijving: "Testregel",
    q1: new Decimal(100),
    q2: new Decimal(100),
    q3: new Decimal(100),
    q4: new Decimal(100),
    ...overrides,
  };
}

function categorieAannames(overrides: Partial<BgLeegstandCategorieAannames> = {}): BgLeegstandCategorieAannames {
  return {
    beoordeeld: true,
    laatstBekendServicekostenvoorschotJaar: null,
    laatstBekendServicekostenvoorschotJaarHerkomst: null,
    verwachteLeegstandsperiodeMaanden: null,
    ...overrides,
  };
}

function alleAannames(
  overrides: Partial<Record<BgLeegstandCategorie, Partial<BgLeegstandCategorieAannames>>> = {},
): Record<BgLeegstandCategorie, BgLeegstandCategorieAannames> {
  return Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((categorie) => [categorie, categorieAannames(overrides[categorie])])) as Record<
    BgLeegstandCategorie,
    BgLeegstandCategorieAannames
  >;
}

/** Bewezen bronproef (2026-09, 070_Rooise_Zoom): OGB 4319 = "Servicekosten leegstand". */
const KLASSIFICATIE_070: LeegstandClassificatieRegel[] = [{ ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", categorie: "SERVICEKOSTEN_LEEGSTAND" }];

function kritieken(controleVereist: { ernst: string }[]): number {
  return controleVereist.filter((c) => c.ernst === "KRITIEK").length;
}

describe("berekenBegroteLeegstand", () => {
  it("A. drie categorieën afzonderlijk beschikbaar, geen samenvoeging", () => {
    const r = berekenBegroteLeegstand(
      [
        regel({ categorie: "NUTS_LEEGSTAND", q1: new Decimal(50), q2: new Decimal(50), q3: new Decimal(50), q4: new Decimal(50) }),
        regel({ categorie: "SERVICEKOSTEN_LEEGSTAND", q1: new Decimal(1000), q2: new Decimal(1000), q3: new Decimal(1000), q4: new Decimal(1000) }),
        regel({ categorie: "OVERIGE_LEEGSTANDSKOSTEN", q1: new Decimal(10), q2: new Decimal(10), q3: new Decimal(10), q4: new Decimal(10) }),
      ],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(r.nutsLeegstand.toString()).toBe("200");
    expect(r.servicekostenLeegstand.toString()).toBe("4000");
    expect(r.overigeLeegstandskosten.toString()).toBe("40");
    expect(r.moduleTotaal.toString()).toBe("4240");
    expect(r.perCategorie).toHaveLength(3);
    expect(r.perCategorie.map((c) => c.categorie)).toEqual(["NUTS_LEEGSTAND", "SERVICEKOSTEN_LEEGSTAND", "OVERIGE_LEEGSTANDSKOSTEN"]);
  });

  it("B. totaal = som Q1-Q4, meerdere regels per categorie", () => {
    const r = berekenBegroteLeegstand(
      [
        regel({ categorie: "NUTS_LEEGSTAND", omschrijving: "Gas", q1: new Decimal(120), q2: new Decimal(80), q3: new Decimal(60), q4: new Decimal(140) }),
        regel({ categorie: "NUTS_LEEGSTAND", omschrijving: "Elektra", q1: new Decimal(30), q2: new Decimal(30), q3: new Decimal(30), q4: new Decimal(30) }),
      ],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const cat = r.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!;
    expect(cat.regels[0]!.totaal.toString()).toBe("400");
    expect(cat.regels[1]!.totaal.toString()).toBe("120");
    expect(cat.categorieTotaal.toString()).toBe("520");
  });

  it("C. complex optioneel (null) — geldig, geen control", () => {
    const r = berekenBegroteLeegstand([regel({ complexnummer: null })], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("D. complex + complexomschrijving worden puur doorgegeven (geen lookup/validatie)", () => {
    const r = berekenBegroteLeegstand(
      [regel({ complexnummer: "003", complexomschrijving: "Rooise Zoom III" })],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const invoer = r.perCategorie.find((c) => c.categorie === "OVERIGE_LEEGSTANDSKOSTEN")!.regels[0]!.invoer;
    expect(invoer.complexnummer).toBe("003");
    expect(invoer.complexomschrijving).toBe("Rooise Zoom III");
  });

  it("E. lege omschrijving: KRITIEK, bedrag blijft financieel meetellen", () => {
    const r = berekenBegroteLeegstand([regel({ omschrijving: "  " })], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(kritieken(r.controleVereist)).toBe(1);
    expect(r.moduleTotaal.toString()).toBe("400");
  });

  it("F. elk van Q1-Q4 afzonderlijk: null -> KRITIEK + veilige 0, NaN -> KRITIEK + veilige 0", () => {
    const r = berekenBegroteLeegstand(
      [regel({ q1: null, q2: new Decimal(NaN), q3: new Decimal(100), q4: new Decimal(100) })],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(kritieken(r.controleVereist)).toBe(2);
    const regelUitkomst = r.perCategorie.find((c) => c.categorie === "OVERIGE_LEEGSTANDSKOSTEN")!.regels[0]!;
    expect(regelUitkomst.q1.toString()).toBe("0");
    expect(regelUitkomst.q2.toString()).toBe("0");
    expect(regelUitkomst.totaal.toString()).toBe("200");
  });

  it("G. negatief kwartaalbedrag: WAARSCHUWING, telt volledig mee", () => {
    const r = berekenBegroteLeegstand(
      [regel({ q1: new Decimal(-50), q2: new Decimal(100), q3: new Decimal(100), q4: new Decimal(100) })],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(kritieken(r.controleVereist)).toBe(0);
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);
    expect(r.perCategorie.find((c) => c.categorie === "OVERIGE_LEEGSTANDSKOSTEN")!.regels[0]!.totaal.toString()).toBe("250");
  });

  it("H. expliciete 0 is geldig voor elk kwartaal, geen control", () => {
    const r = berekenBegroteLeegstand(
      [regel({ q1: new Decimal(0), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) })],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(r.controleVereist).toHaveLength(0);
    expect(r.perCategorie.find((c) => c.categorie === "OVERIGE_LEEGSTANDSKOSTEN")!.regels[0]!.totaal.toString()).toBe("0");
  });

  it("I. reviewStatus: NOT_REVIEWED / REVIEWED_ZERO_RULES / REVIEWED_WITH_RULES, onafhankelijk per categorie", () => {
    const r = berekenBegroteLeegstand(
      [regel({ categorie: "SERVICEKOSTEN_LEEGSTAND" })],
      alleAannames({
        NUTS_LEEGSTAND: { beoordeeld: false },
        SERVICEKOSTEN_LEEGSTAND: { beoordeeld: true },
        OVERIGE_LEEGSTANDSKOSTEN: { beoordeeld: true },
      }),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(r.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!.reviewStatus).toBe("NOT_REVIEWED");
    expect(r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.reviewStatus).toBe("REVIEWED_WITH_RULES");
    expect(r.perCategorie.find((c) => c.categorie === "OVERIGE_LEEGSTANDSKOSTEN")!.reviewStatus).toBe("REVIEWED_ZERO_RULES");
  });

  it("J. rekenhulp: beide invoerwaarden geldig -> berekendVoorstel, wijzigt categorieTotaal niet", () => {
    const r = berekenBegroteLeegstand(
      [regel({ categorie: "SERVICEKOSTEN_LEEGSTAND", q1: new Decimal(500), q2: new Decimal(500), q3: new Decimal(500), q4: new Decimal(500) })],
      alleAannames({ SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(12000), verwachteLeegstandsperiodeMaanden: new Decimal(6) } }),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const cat = r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(cat.berekendVoorstel!.toString()).toBe("6000");
    expect(cat.categorieTotaal.toString()).toBe("2000");
  });

  it("K. rekenhulp: één van beide ontbreekt -> berekendVoorstel null, geen KRITIEK", () => {
    const r = berekenBegroteLeegstand(
      [],
      alleAannames({ SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(12000), verwachteLeegstandsperiodeMaanden: null } }),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.berekendVoorstel).toBeNull();
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("L. rekenhulp: negatieve invoer -> WAARSCHUWING, blijft rekenkundig verwerkt", () => {
    const r = berekenBegroteLeegstand(
      [],
      alleAannames({ SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(-1000), verwachteLeegstandsperiodeMaanden: new Decimal(3) } }),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const cat = r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(cat.berekendVoorstel!.toString()).toBe("-250");
    expect(kritieken(r.controleVereist)).toBe(0);
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);
  });

  it("M. rekenhulp: NaN invoer -> KRITIEK, berekendVoorstel null", () => {
    const r = berekenBegroteLeegstand(
      [],
      alleAannames({ SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(NaN), verwachteLeegstandsperiodeMaanden: new Decimal(3) } }),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const cat = r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(cat.berekendVoorstel).toBeNull();
    expect(kritieken(r.controleVereist)).toBe(1);
  });

  it("M2. rekenhulp: betrouwbare BRON-waarde aanwezig -> berekendVoorstel + herkomst BRON, categorieTotaal ongewijzigd", () => {
    const r = berekenBegroteLeegstand(
      [regel({ categorie: "SERVICEKOSTEN_LEEGSTAND", q1: new Decimal(500), q2: new Decimal(500), q3: new Decimal(500), q4: new Decimal(500) })],
      alleAannames({
        SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(21600), laatstBekendServicekostenvoorschotJaarHerkomst: "BRON", verwachteLeegstandsperiodeMaanden: new Decimal(3) },
      }),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const cat = r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(cat.laatstBekendServicekostenvoorschotJaarHerkomst).toBe("BRON");
    expect(cat.berekendVoorstel!.toString()).toBe("5400");
    expect(cat.categorieTotaal.toString()).toBe("2000"); // ongewijzigd — het voorstel muteert de begroting nooit
  });

  it("M3. rekenhulp: bronwaarde ontbreekt -> handmatige invoer toegestaan, herkomst HANDMATIG, zelfde berekening als BRON", () => {
    const r = berekenBegroteLeegstand(
      [],
      alleAannames({
        SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(9000), laatstBekendServicekostenvoorschotJaarHerkomst: "HANDMATIG", verwachteLeegstandsperiodeMaanden: new Decimal(6) },
      }),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const cat = r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(cat.laatstBekendServicekostenvoorschotJaarHerkomst).toBe("HANDMATIG");
    expect(cat.berekendVoorstel!.toString()).toBe("4500");
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("M4. geen bronwaarde en geen handmatige invoer: herkomst null, berekendVoorstel null, geen verzonnen bedrag", () => {
    const r = berekenBegroteLeegstand([], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    const cat = r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(cat.laatstBekendServicekostenvoorschotJaarHerkomst).toBeNull();
    expect(cat.berekendVoorstel).toBeNull();
  });

  it("M5. verwachteLeegstandsperiodeMaanden blijft ALTIJD handmatig, ongeacht de herkomst van het basisbedrag (BRON of HANDMATIG)", () => {
    const rMetBron = berekenBegroteLeegstand(
      [],
      alleAannames({ SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(12000), laatstBekendServicekostenvoorschotJaarHerkomst: "BRON", verwachteLeegstandsperiodeMaanden: new Decimal(3) } }),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(rMetBron.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.verwachteLeegstandsperiodeMaanden?.toString()).toBe("3");
    // Er bestaat geen "herkomst"-veld voor de leegstandsperiode zelf — het is uitsluitend een Decimal|null, altijd handmatig.
  });

  it("N. geen regels, geen aannames: moduleTotaal 0, geen controls", () => {
    const r = berekenBegroteLeegstand([], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(r.moduleTotaal.toString()).toBe("0");
    expect(r.controleVereist).toHaveLength(0);
  });
});

describe("berekenWerkelijkLeegstand", () => {
  function boeking(overrides: Partial<WerkelijkLeegstandBoekingRegel> = {}): WerkelijkLeegstandBoekingRegel {
    return { ogbKostensoort: "4319", complexnummer: "003", saldo: new Decimal(1000), ...overrides };
  }

  it("O. bronproef 070 (2025, GL 4350/OGB 4319): 6 boekingen, complex 003, saldo 1354.10", () => {
    const boekingen: WerkelijkLeegstandBoekingRegel[] = [
      boeking({ saldo: new Decimal(1000) }), // Prol 02/2025 003-0002
      boeking({ saldo: new Decimal(1000) }), // Prol 03/2025 003-0002
      boeking({ saldo: new Decimal(1000) }), // Prol 04/2025 003-0002
      boeking({ saldo: new Decimal("97.53") }), // Service-afrekening 0007
      boeking({ saldo: new Decimal("-1283.17") }), // Service-afrekening 0007
      boeking({ saldo: new Decimal("-460.26") }), // afboeking
    ];
    const r = berekenWerkelijkLeegstand(boekingen, KLASSIFICATIE_070);
    const cat = r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(cat.categorieTotaal.toString()).toBe("1354.1");
    expect(cat.perComplex).toEqual([{ complexnummer: "003", saldo: expect.any(Decimal), aantalBoekingen: 6 }]);
    expect(cat.perComplex[0]!.saldo.toString()).toBe("1354.1");
    expect(r.moduleTotaal.toString()).toBe("1354.1");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(0);
    expect(r.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!.categorieTotaal.toString()).toBe("0");
    expect(r.perCategorie.find((c) => c.categorie === "OVERIGE_LEEGSTANDSKOSTEN")!.categorieTotaal.toString()).toBe("0");
  });

  it("P. onbekende OGB-kostensoort: nooit geraden, apart gehouden, WAARSCHUWING", () => {
    const r = berekenWerkelijkLeegstand([boeking({ ogbKostensoort: "9999", saldo: new Decimal(500) })], KLASSIFICATIE_070);
    expect(r.moduleTotaal.toString()).toBe("0");
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("500");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(1);
    expect(r.controleVereist).toHaveLength(1);
    expect(r.controleVereist[0]!.ernst).toBe("WAARSCHUWING");
  });

  it("Q. ontbrekende OGB-kostensoort (null): nooit geraden, apart gehouden", () => {
    const r = berekenWerkelijkLeegstand([boeking({ ogbKostensoort: null, saldo: new Decimal(250) })], KLASSIFICATIE_070);
    expect(r.moduleTotaal.toString()).toBe("0");
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("250");
    expect(r.controleVereist[0]!.ogbKostensoort).toBeNull();
  });

  it("R. aggregatie op categorie + complex — meerdere complexen binnen dezelfde categorie", () => {
    const r = berekenWerkelijkLeegstand(
      [boeking({ complexnummer: "001", saldo: new Decimal(200) }), boeking({ complexnummer: "003", saldo: new Decimal(300) }), boeking({ complexnummer: "003", saldo: new Decimal(100) })],
      KLASSIFICATIE_070,
    );
    const cat = r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(cat.perComplex).toEqual([
      { complexnummer: "001", saldo: expect.any(Decimal), aantalBoekingen: 1 },
      { complexnummer: "003", saldo: expect.any(Decimal), aantalBoekingen: 2 },
    ]);
    expect(cat.perComplex.find((c) => c.complexnummer === "001")!.saldo.toString()).toBe("200");
    expect(cat.perComplex.find((c) => c.complexnummer === "003")!.saldo.toString()).toBe("400");
  });

  it("S. boeking zonder complexnummer: apart gegroepeerd (complexnummer null), nooit weggelaten", () => {
    const r = berekenWerkelijkLeegstand([boeking({ complexnummer: null, saldo: new Decimal(80) })], KLASSIFICATIE_070);
    const cat = r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(cat.perComplex).toEqual([{ complexnummer: null, saldo: expect.any(Decimal), aantalBoekingen: 1 }]);
    expect(cat.categorieTotaal.toString()).toBe("80");
  });

  it("T. geen boekingen: alle categorieën 0, geen controls", () => {
    const r = berekenWerkelijkLeegstand([], KLASSIFICATIE_070);
    expect(r.moduleTotaal.toString()).toBe("0");
    expect(r.controleVereist).toHaveLength(0);
    expect(r.perCategorie).toHaveLength(3);
  });
});

describe("berekenEstimatedLeegstand", () => {
  const BEGROTING = berekenBegroteLeegstand(
    [
      regel({ categorie: "NUTS_LEEGSTAND", q1: new Decimal(100), q2: new Decimal(100), q3: new Decimal(100), q4: new Decimal(100) }),
      regel({ categorie: "SERVICEKOSTEN_LEEGSTAND", q1: new Decimal(1000), q2: new Decimal(1000), q3: new Decimal(1000), q4: new Decimal(1000) }),
      regel({ categorie: "OVERIGE_LEEGSTANDSKOSTEN", q1: new Decimal(50), q2: new Decimal(50), q3: new Decimal(50), q4: new Decimal(50) }),
    ],
    alleAannames(),
    { begrotingsjaar: BEGROTINGSJAAR },
  );
  const WERKELIJK = berekenWerkelijkLeegstand(
    [{ ogbKostensoort: "4319", complexnummer: "003", saldo: new Decimal(1354.1) }],
    KLASSIFICATIE_070,
  );

  function geenVerwachting(): Record<BgLeegstandCategorie, Decimal | null> {
    return Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c) => [c, null])) as Record<BgLeegstandCategorie, Decimal | null>;
  }

  it("U. Begroting blijft ongewijzigd zichtbaar naast Estimated", () => {
    const r = berekenEstimatedLeegstand(BEGROTING, WERKELIJK, geenVerwachting());
    expect(r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.begrotingTotaal.toString()).toBe("4000");
    expect(r.moduleBegrotingTotaal.toString()).toBe(BEGROTING.moduleTotaal.toString());
  });

  it("V. geen verwachting ingevuld: estimatedTotaal en afwijking null, geen verzonnen bedrag", () => {
    const r = berekenEstimatedLeegstand(BEGROTING, WERKELIJK, geenVerwachting());
    for (const cat of r.perCategorie) {
      expect(cat.estimatedTotaal).toBeNull();
      expect(cat.afwijking).toBeNull();
    }
    expect(r.moduleEstimatedTotaal).toBeNull();
  });

  it("W. verwachting ingevuld voor één categorie: estimatedTotaal = werkelijk + verwachting, alleen die categorie", () => {
    const verwachting = geenVerwachting();
    verwachting.SERVICEKOSTEN_LEEGSTAND = new Decimal(2645.9);
    const r = berekenEstimatedLeegstand(BEGROTING, WERKELIJK, verwachting);
    const cat = r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(cat.werkelijkTotaal.toString()).toBe("1354.1");
    expect(cat.estimatedTotaal!.toString()).toBe("4000");
    expect(cat.afwijking!.toString()).toBe("0");
    expect(r.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!.estimatedTotaal).toBeNull();
    expect(r.moduleEstimatedTotaal).toBeNull();
  });

  it("X. verwachting ingevuld voor alle categorieën: moduleEstimatedTotaal is de som", () => {
    const verwachting: Record<BgLeegstandCategorie, Decimal | null> = {
      NUTS_LEEGSTAND: new Decimal(400),
      SERVICEKOSTEN_LEEGSTAND: new Decimal(2645.9),
      OVERIGE_LEEGSTANDSKOSTEN: new Decimal(200),
    };
    const r = berekenEstimatedLeegstand(BEGROTING, WERKELIJK, verwachting);
    expect(r.moduleEstimatedTotaal!.toString()).toBe("4600");
  });

  it("Y. afwijking: estimated hoger dan begroting is positief, lager is negatief", () => {
    const verwachting = geenVerwachting();
    verwachting.SERVICEKOSTEN_LEEGSTAND = new Decimal(5000);
    const rHoger = berekenEstimatedLeegstand(BEGROTING, WERKELIJK, verwachting);
    expect(rHoger.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.afwijking!.toString()).toBe("2354.1");

    const verwachtingLager = geenVerwachting();
    verwachtingLager.SERVICEKOSTEN_LEEGSTAND = new Decimal(0);
    const rLager = berekenEstimatedLeegstand(BEGROTING, WERKELIJK, verwachtingLager);
    expect(rLager.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.afwijking!.toString()).toBe("-2645.9");
  });

  it("Z. werkelijk geboekte correctie beïnvloedt Estimated maar wijzigt Begroting nooit (geen dubbeltelling)", () => {
    const werkelijkNaCorrectie = berekenWerkelijkLeegstand(
      [
        { ogbKostensoort: "4319", complexnummer: "003", saldo: new Decimal(3000) }, // 3x prolongatie voorschot
        { ogbKostensoort: "4319", complexnummer: "003", saldo: new Decimal("-1645.9") }, // afrekening/correctie, één keer verwerkt via saldo
      ],
      KLASSIFICATIE_070,
    );
    const r = berekenEstimatedLeegstand(BEGROTING, werkelijkNaCorrectie, geenVerwachting());
    expect(r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.werkelijkTotaal.toString()).toBe("1354.1");
    expect(r.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.begrotingTotaal.toString()).toBe("4000");
  });
});
