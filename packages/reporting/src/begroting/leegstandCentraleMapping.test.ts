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
import {
  berekenWerkelijkLeegstandViaCentraleMapping,
  bouwLeegstandClassificatieViaCentraleMapping,
  resolveerLeegstandCategorieViaCentraleMapping,
  type LeegstandCentraleMappingInvoer,
  type LeegstandRuweBoekingRegel,
  type LeegstandWerkelijkViaCentraleMappingInvoer,
} from "./leegstandCentraleMapping.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE M5 — migreert de bestaande Leegstand-Werkelijk-classificatie (OB-031)
 * naar de centrale P&L-bronmappingresolver, direct volgens het bewezen
 * M3b-patroon (Rente). Bewezen bronproef: 070_Rooise_Zoom, GL4350/OGB4319 →
 * SERVICEKOSTEN_LEEGSTAND, 6 boekingen, complex 003, totaal €1.354,10 (zie
 * `begroteLeegstand.test.ts`/`leegstandClassificatie.test.ts`).
 */

const BEGROTINGSJAAR = 2027;
const AANGEMAAKT = new Date("2026-09-15T00:00:00.000Z");

function regel(overrides: Partial<BgLeegstandRegelInvoer> = {}): BgLeegstandRegelInvoer {
  return {
    categorie: "SERVICEKOSTEN_LEEGSTAND",
    complexnummer: null,
    complexomschrijving: null,
    omschrijving: "Testregel",
    q1: new Decimal(0),
    q2: new Decimal(0),
    q3: new Decimal(0),
    q4: new Decimal(0),
    ...overrides,
  };
}

function alleAannames(): Record<BgLeegstandCategorie, BgLeegstandCategorieAannames> {
  return Object.fromEntries(
    LEEGSTAND_CATEGORIEEN.map((categorie) => [
      categorie,
      { beoordeeld: true, laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null },
    ]),
  ) as Record<BgLeegstandCategorie, BgLeegstandCategorieAannames>;
}

function boeking(overrides: Partial<WerkelijkLeegstandBoekingRegel> = {}): WerkelijkLeegstandBoekingRegel {
  return { ogbKostensoort: "4319", complexnummer: "003", saldo: new Decimal(1000), ...overrides };
}

function normaliseer(waarde: unknown): string {
  return JSON.stringify(waarde, (_key, v) => (v instanceof Decimal ? v.toString() : v));
}

/** OUDE, bewezen classificatie — exact zoals `begroteLeegstand.test.ts`/`leegstandClassificatie.test.ts` (070_Rooise_Zoom, GL4350, bronproef 2025). */
const OUDE_KLASSIFICATIE_070: LeegstandClassificatieRegel[] = [{ ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", categorie: "SERVICEKOSTEN_LEEGSTAND" }];

function mappingRegel(overrides: Partial<PnLBronmappingRegel>): PnLBronmappingRegel {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4350",
    ogbKostensoort: null,
    economischeModule: "LEEGSTAND",
    economischeCategorie: "SERVICEKOSTEN_LEEGSTAND",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

/**
 * NIEUWE centrale mapping voor 070/GL4350 — BEWUST uitsluitend de ÉNE
 * bewezen GL+OGB-specifieke rij (4319 → SERVICEKOSTEN_LEEGSTAND), GEEN
 * GL-default (zie moduledoc: pariteit met de OGB-only oude classificatie).
 * GEEN fictieve rij voor NUTS_LEEGSTAND/OVERIGE_LEEGSTANDSKOSTEN — die zijn
 * voor 070 niet bewezen (zie M5-opdracht §6).
 */
const MAPPING_070: PnLBronmappingRegel[] = [mappingRegel({ ogbKostensoort: "4319", economischeCategorie: "SERVICEKOSTEN_LEEGSTAND" })];

function invoer070(overrides: Partial<LeegstandCentraleMappingInvoer> = {}): LeegstandCentraleMappingInvoer {
  return { bedrijfsnr: "070", grootboekrekening: "4350", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z"), ...overrides };
}

describe("resolveerLeegstandCategorieViaCentraleMapping — 070/GL4350", () => {
  it("C. bewezen 070-mapping: OGB 4319 op GL4350 resolveert via de centrale mapping naar SERVICEKOSTEN_LEEGSTAND", () => {
    expect(resolveerLeegstandCategorieViaCentraleMapping(invoer070(), "4319", MAPPING_070)).toEqual({ categorie: "SERVICEKOSTEN_LEEGSTAND", specificiteit: "GL_OGB" });
  });

  it("G. onbekende OGB-code op een bekende Leegstand-GL -> NIET_GEMAPT (geen GL-default aanwezig, exacte pariteit met de oude 'onbekende code'-uitkomst)", () => {
    expect(resolveerLeegstandCategorieViaCentraleMapping(invoer070(), "9999", MAPPING_070)).toBeNull();
  });

  it("H. boeking zonder OGB-kostensoort (null) op een bekende Leegstand-GL -> NIET_GEMAPT (exacte pariteit met de oude 'ogbKostensoort===null'-uitkomst)", () => {
    expect(resolveerLeegstandCategorieViaCentraleMapping(invoer070(), null, MAPPING_070)).toBeNull();
  });

  it("module-invariant blijft hard: een (per ongeluk) toegevoegde GL-default met een andere module dan de GL+OGB-rij faalt fail-fast", () => {
    const kapotteMapping: PnLBronmappingRegel[] = [...MAPPING_070, mappingRegel({ ogbKostensoort: null, economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" })];
    expect(() => resolveerLeegstandCategorieViaCentraleMapping(invoer070(), "4319", kapotteMapping)).toThrow(/mag nooit naar een andere economische module springen/);
  });

  it("I/J. geen fictieve Nuts-/Overige-mapping voor 070: de bewezen mapping bevat uitsluitend de ÉNE SERVICEKOSTEN_LEEGSTAND-rij", () => {
    expect(MAPPING_070).toHaveLength(1);
    expect(MAPPING_070.every((r) => r.economischeCategorie === "SERVICEKOSTEN_LEEGSTAND")).toBe(true);
    // Onbevestigde categorieën blijven functioneel bestaan, maar resolveren zonder bronmapping naar NIET_GEMAPT — nooit geraden.
    expect(resolveerLeegstandCategorieViaCentraleMapping(invoer070(), "4998", MAPPING_070)).toBeNull(); // fictief "Nuts"-OGB, geen mapping
    expect(resolveerLeegstandCategorieViaCentraleMapping(invoer070(), "4700", MAPPING_070)).toBeNull(); // fictief "Overige"-OGB, geen mapping
  });
});

describe("bouwLeegstandClassificatieViaCentraleMapping — oud-vs-nieuw classificatie-array identiek", () => {
  it("070: de centrale mapping (1 GL+OGB-rij, geen default) reproduceert exact de oude 1-rij-classificatie", () => {
    const { classificatie, nietGemapt } = bouwLeegstandClassificatieViaCentraleMapping(
      invoer070(),
      OUDE_KLASSIFICATIE_070.map(({ ogbKostensoort, ogbKostensoortOmschrijving }) => ({ ogbKostensoort, ogbKostensoortOmschrijving })),
      MAPPING_070,
    );
    expect(nietGemapt).toEqual([]);
    expect(classificatie).toEqual(OUDE_KLASSIFICATIE_070);
  });

  it("een aangeleverde OGB-code zonder mapping wordt expliciet in nietGemapt gerapporteerd, nooit stil weggelaten", () => {
    const { classificatie, nietGemapt } = bouwLeegstandClassificatieViaCentraleMapping(invoer070(), [{ ogbKostensoort: "9999", ogbKostensoortOmschrijving: "onbekend" }], MAPPING_070);
    expect(classificatie).toEqual([]);
    expect(nietGemapt).toEqual(["9999"]);
  });
});

describe("berekenWerkelijkLeegstand — oud vs. nieuw, byte-identiek op de bewezen bronproef", () => {
  it("K. 070 (bronproef 2025, GL4350): 6 echte boekingen, complex 003, totaal 1.354,10 — identiek Werkelijk-resultaat", () => {
    const boekingen: WerkelijkLeegstandBoekingRegel[] = [
      boeking({ saldo: new Decimal(1000) }),
      boeking({ saldo: new Decimal(1000) }),
      boeking({ saldo: new Decimal(1000) }),
      boeking({ saldo: new Decimal("97.53") }),
      boeking({ saldo: new Decimal("-1283.17") }),
      boeking({ saldo: new Decimal("-460.26") }),
    ];
    const { classificatie: nieuweClassificatie } = bouwLeegstandClassificatieViaCentraleMapping(
      invoer070(),
      OUDE_KLASSIFICATIE_070.map(({ ogbKostensoort, ogbKostensoortOmschrijving }) => ({ ogbKostensoort, ogbKostensoortOmschrijving })),
      MAPPING_070,
    );

    const resultaatOud = berekenWerkelijkLeegstand(boekingen, OUDE_KLASSIFICATIE_070);
    const resultaatNieuw = berekenWerkelijkLeegstand(boekingen, nieuweClassificatie);

    expect(normaliseer(resultaatNieuw)).toBe(normaliseer(resultaatOud));
    expect(resultaatOud.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.categorieTotaal.toString()).toBe("1354.1");
  });

  it("onbekende OGB en ontbrekende OGB geven bij oud en nieuw identieke 'niet geclassificeerd'-uitkomst", () => {
    const boekingen: WerkelijkLeegstandBoekingRegel[] = [boeking({ ogbKostensoort: "9999", saldo: new Decimal(500) }), boeking({ ogbKostensoort: null, saldo: new Decimal(250) })];
    const { classificatie: nieuweClassificatie } = bouwLeegstandClassificatieViaCentraleMapping(
      invoer070(),
      OUDE_KLASSIFICATIE_070.map(({ ogbKostensoort, ogbKostensoortOmschrijving }) => ({ ogbKostensoort, ogbKostensoortOmschrijving })),
      MAPPING_070,
    );

    const resultaatOud = berekenWerkelijkLeegstand(boekingen, OUDE_KLASSIFICATIE_070);
    const resultaatNieuw = berekenWerkelijkLeegstand(boekingen, nieuweClassificatie);

    expect(normaliseer(resultaatNieuw)).toBe(normaliseer(resultaatOud));
    expect(resultaatOud.nietGeclassificeerdTotaal.toString()).toBe("750");
    expect(resultaatNieuw.nietGeclassificeerdTotaal.toString()).toBe("750");
  });
});

describe("berekenEstimatedLeegstand — oud vs. nieuw, byte-identiek", () => {
  it("L. Estimated op basis van het nieuwe Werkelijk-resultaat is byte-identiek aan Estimated op basis van het oude", () => {
    const BEGROTING = berekenBegroteLeegstand(
      [regel({ categorie: "SERVICEKOSTEN_LEEGSTAND", q1: new Decimal(1354.1), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) })],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    function geenVerwachting(): Record<BgLeegstandCategorie, Decimal | null> {
      return Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c) => [c, null])) as Record<BgLeegstandCategorie, Decimal | null>;
    }
    const { classificatie: nieuweClassificatie } = bouwLeegstandClassificatieViaCentraleMapping(
      invoer070(),
      OUDE_KLASSIFICATIE_070.map(({ ogbKostensoort, ogbKostensoortOmschrijving }) => ({ ogbKostensoort, ogbKostensoortOmschrijving })),
      MAPPING_070,
    );
    const boekingen: WerkelijkLeegstandBoekingRegel[] = [boeking({ saldo: new Decimal(1354.1) })];

    const werkelijkOud = berekenWerkelijkLeegstand(boekingen, OUDE_KLASSIFICATIE_070);
    const werkelijkNieuw = berekenWerkelijkLeegstand(boekingen, nieuweClassificatie);

    const estimatedOud = berekenEstimatedLeegstand(BEGROTING, werkelijkOud, geenVerwachting());
    const estimatedNieuw = berekenEstimatedLeegstand(BEGROTING, werkelijkNieuw, geenVerwachting());

    expect(normaliseer(estimatedNieuw)).toBe(normaliseer(estimatedOud));
    expect(estimatedNieuw.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.werkelijkTotaal.toString()).toBe("1354.1");
  });
});

describe("berekenWerkelijkLeegstandViaCentraleMapping — FASE M5: de daadwerkelijk gewirede productieketen", () => {
  function ruweBoeking(overrides: Partial<LeegstandRuweBoekingRegel> = {}): LeegstandRuweBoekingRegel {
    return { grootboekrekening: "4350", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", complexnummer: "003", saldo: new Decimal(1000), ...overrides };
  }

  function keteninvoer070(overrides: Partial<LeegstandWerkelijkViaCentraleMappingInvoer> = {}): LeegstandWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "070", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z"), ...overrides };
  }

  const RUWE_BOEKINGEN_070: LeegstandRuweBoekingRegel[] = [
    ruweBoeking({ saldo: new Decimal(1000) }),
    ruweBoeking({ saldo: new Decimal(1000) }),
    ruweBoeking({ saldo: new Decimal(1000) }),
    ruweBoeking({ saldo: new Decimal("97.53") }),
    ruweBoeking({ saldo: new Decimal("-1283.17") }),
    ruweBoeking({ saldo: new Decimal("-460.26") }),
  ];

  it("B. de gewirede keten gebruikt daadwerkelijk de aangeleverde centrale mapping (geen stille interne oude-classificatie-fallback)", () => {
    const mappingZonder4319 = MAPPING_070.filter((r) => r.ogbKostensoort !== "4319");
    const { werkelijk, nietGemapt } = berekenWerkelijkLeegstandViaCentraleMapping(keteninvoer070(), RUWE_BOEKINGEN_070, mappingZonder4319);

    expect(nietGemapt).toEqual([{ grootboekrekening: "4350", ogbKostensoort: "4319" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("1354.1");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.categorieTotaal.toString()).toBe("0");
  });

  it("D. volledig gewirede Werkelijk Servicekosten leegstand blijft exact €1.354,10, en is byte-identiek aan de oude keten", () => {
    const { werkelijk, nietGemapt } = berekenWerkelijkLeegstandViaCentraleMapping(keteninvoer070(), RUWE_BOEKINGEN_070, MAPPING_070);
    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.categorieTotaal.toString()).toBe("1354.1");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!.categorieTotaal.toString()).toBe("0");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "OVERIGE_LEEGSTANDSKOSTEN")!.categorieTotaal.toString()).toBe("0");
    expect(werkelijk.nietGeclassificeerdAantalBoekingen).toBe(0);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.perComplex).toEqual([{ complexnummer: "003", saldo: expect.any(Decimal), aantalBoekingen: 6 }]);

    const resultaatOud = berekenWerkelijkLeegstand(
      RUWE_BOEKINGEN_070.map((b) => ({ ogbKostensoort: b.ogbKostensoort, complexnummer: b.complexnummer, saldo: b.saldo })),
      OUDE_KLASSIFICATIE_070,
    );
    expect(normaliseer(werkelijk)).toBe(normaliseer(resultaatOud));
  });

  it("Estimated op basis van de volledig gewirede keten blijft byte-identiek aan Estimated op basis van de oude keten", () => {
    const BEGROTING = berekenBegroteLeegstand(
      [regel({ categorie: "SERVICEKOSTEN_LEEGSTAND", q1: new Decimal(1354.1), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) })],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    function geenVerwachting(): Record<BgLeegstandCategorie, Decimal | null> {
      return Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c) => [c, null])) as Record<BgLeegstandCategorie, Decimal | null>;
    }

    const { werkelijk: werkelijkNieuw } = berekenWerkelijkLeegstandViaCentraleMapping(keteninvoer070(), RUWE_BOEKINGEN_070, MAPPING_070);
    const werkelijkOud = berekenWerkelijkLeegstand(
      RUWE_BOEKINGEN_070.map((b) => ({ ogbKostensoort: b.ogbKostensoort, complexnummer: b.complexnummer, saldo: b.saldo })),
      OUDE_KLASSIFICATIE_070,
    );

    const estimatedNieuw = berekenEstimatedLeegstand(BEGROTING, werkelijkNieuw, geenVerwachting());
    const estimatedOud = berekenEstimatedLeegstand(BEGROTING, werkelijkOud, geenVerwachting());

    expect(normaliseer(estimatedNieuw)).toBe(normaliseer(estimatedOud));
    expect(estimatedNieuw.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.werkelijkTotaal.toString()).toBe("1354.1");
  });

  it("onbekende OGB-code binnen een bekende Leegstand-GL -> expliciet NIET_GEMAPT, niet stil verdwenen/genold/geraden", () => {
    const boekingen = [...RUWE_BOEKINGEN_070, ruweBoeking({ ogbKostensoort: "9999", ogbKostensoortOmschrijving: "onbekend", saldo: new Decimal(500) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkLeegstandViaCentraleMapping(keteninvoer070(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "4350", ogbKostensoort: "9999" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("500");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.categorieTotaal.toString()).toBe("1354.1");
  });

  it("boeking zonder OGB-kostensoort (null) -> expliciet NIET_GEMAPT, geen GL-default toegepast", () => {
    const boekingen = [...RUWE_BOEKINGEN_070, ruweBoeking({ ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(250) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkLeegstandViaCentraleMapping(keteninvoer070(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "4350", ogbKostensoort: null }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("250");
  });

  it("G. GL wordt nooit uit OGB afgeleid: dezelfde OGB-code op een ANDERE, niet-gemapte GL resolveert onafhankelijk (blijft NIET_GEMAPT)", () => {
    const boekingOpAndereGl = ruweBoeking({ grootboekrekening: "9999", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", saldo: new Decimal(777) });
    const { werkelijk, nietGemapt } = berekenWerkelijkLeegstandViaCentraleMapping(keteninvoer070(), [boekingOpAndereGl], MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "9999", ogbKostensoort: "4319" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("777");
    expect(werkelijk.perCategorie.every((c) => c.categorieTotaal.toString() === "0")).toBe(true);
  });

  it("E/F. geen unit-parsing/vrije-tekstclassificatie: een misleidende ogbKostensoortOmschrijving verandert de categorie niet — uitsluitend de OGB-code/mapping bepaalt", () => {
    // ogbKostensoortOmschrijving suggereert "Nuts", maar de OGB-code (4319) en de mapping bepalen de
    // categorie — de omschrijving is puur informatief/traceerbaarheid, nooit een classificatie-invoer.
    const boekingMetMisleidendeOmschrijving = ruweBoeking({ ogbKostensoortOmschrijving: "Nuts leegstand unit 12B", saldo: new Decimal(1354.1) });
    const { werkelijk, nietGemapt } = berekenWerkelijkLeegstandViaCentraleMapping(keteninvoer070(), [boekingMetMisleidendeOmschrijving], MAPPING_070);

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.categorieTotaal.toString()).toBe("1354.1");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!.categorieTotaal.toString()).toBe("0");
  });
});
