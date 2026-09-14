import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  RENTE_CATEGORIEEN,
  berekenBegroteRente,
  berekenEstimatedRente,
  berekenWerkelijkRente,
  type BgRenteCategorie,
  type BgRenteCategorieAannames,
  type BgRenteRegelInvoer,
  type RenteClassificatieRegel,
  type WerkelijkRenteBoekingRegel,
} from "./begroteRente.js";
import {
  berekenWerkelijkRenteViaCentraleMapping,
  bouwRenteClassificatieViaCentraleMapping,
  resolveerRenteCategorieViaCentraleMapping,
  type RenteCentraleMappingInvoer,
  type RenteRuweBoekingRegel,
  type RenteWerkelijkViaCentraleMappingInvoer,
} from "./renteCentraleMapping.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE M3-regressieproef: bewijst dat de centrale P&L-bronmappingresolver
 * (commit 5ece248) de bestaande Rente-Werkelijk-classificatie (OB-037/038)
 * kan vervangen met een economisch identieke uitkomst, op basis van de
 * bewezen bronproeven 023_Malcon_Beheer_BV (GL4600, Rentekosten) en
 * 013 (GL4620, Rente opbrengsten).
 */

const BEGROTINGSJAAR = 2027;
const AANGEMAAKT = new Date("2026-09-14T00:00:00.000Z");

function regel(overrides: Partial<BgRenteRegelInvoer> = {}): BgRenteRegelInvoer {
  return {
    categorie: "RENTEKOSTEN",
    omschrijving: "Testfinanciering",
    complexnummer: null,
    ogbReferentie: null,
    laatstBekendSaldo: null,
    rentepercentage: null,
    begrotingsbedrag: new Decimal(1000),
    ...overrides,
  };
}

function alleAannames(): Record<BgRenteCategorie, BgRenteCategorieAannames> {
  return Object.fromEntries(RENTE_CATEGORIEEN.map((categorie) => [categorie, { beoordeeld: true }])) as Record<BgRenteCategorie, BgRenteCategorieAannames>;
}

function boeking(overrides: Partial<WerkelijkRenteBoekingRegel> = {}): WerkelijkRenteBoekingRegel {
  return { ogbKostensoort: "4601", saldo: new Decimal(1000), ...overrides };
}

function normaliseer(waarde: unknown): string {
  return JSON.stringify(waarde, (_key, v) => (v instanceof Decimal ? v.toString() : v));
}

/** OUDE, bewezen classificatie — exact zoals `begroteRente.test.ts`'s eigen fixtures (023_Malcon_Beheer_BV, GL4600, bronproef 2025). */
const OUDE_KLASSIFICATIE_023: RenteClassificatieRegel[] = [
  { ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", categorie: "RENTEKOSTEN" },
  { ogbKostensoort: "4602", ogbKostensoortOmschrijving: "Rente en Provisie ING R/C", categorie: "RENTEKOSTEN" },
  { ogbKostensoort: "4603", ogbKostensoortOmschrijving: "Rente lening .586", categorie: "RENTEKOSTEN" },
  { ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente lening .500", categorie: "RENTEKOSTEN" },
  { ogbKostensoort: "4606", ogbKostensoortOmschrijving: "rente lening 747", categorie: "RENTEKOSTEN" },
  { ogbKostensoort: "4620", ogbKostensoortOmschrijving: "Overige rentes", categorie: "RENTEKOSTEN" },
];

/** OUDE, bewezen classificatie — 013, GL4620, bronproef 2024. */
const OUDE_KLASSIFICATIE_013: RenteClassificatieRegel[] = [
  { ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente r/c", categorie: "RENTE_OPBRENGSTEN" },
  { ogbKostensoort: "4621", ogbKostensoortOmschrijving: "Rente opbrengst telerek", categorie: "RENTE_OPBRENGSTEN" },
];

function mappingRegel(overrides: Partial<PnLBronmappingRegel>): PnLBronmappingRegel {
  return {
    bedrijfsnr: "023",
    grootboekrekening: "4600",
    ogbKostensoort: null,
    economischeModule: "RENTE",
    economischeCategorie: "RENTEKOSTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

/** NIEUWE centrale mapping voor 023/GL4600 — BEWUST uitsluitend GL+OGB-specifieke rijen, GEEN GL-default (zie moduledoc). */
const MAPPING_023: PnLBronmappingRegel[] = [
  mappingRegel({ ogbKostensoort: "4601", economischeCategorie: "RENTEKOSTEN" }),
  mappingRegel({ ogbKostensoort: "4602", economischeCategorie: "RENTEKOSTEN" }),
  mappingRegel({ ogbKostensoort: "4603", economischeCategorie: "RENTEKOSTEN" }),
  mappingRegel({ ogbKostensoort: "4604", economischeCategorie: "RENTEKOSTEN" }),
  mappingRegel({ ogbKostensoort: "4606", economischeCategorie: "RENTEKOSTEN" }),
  mappingRegel({ ogbKostensoort: "4620", economischeCategorie: "RENTEKOSTEN" }),
];

/** NIEUWE centrale mapping voor 013/GL4620 — idem, uitsluitend GL+OGB-specifiek. Bronproef is boekjaar 2024, dus geldigVanaf moet dat dekken. */
const MAPPING_013: PnLBronmappingRegel[] = [
  mappingRegel({ bedrijfsnr: "013", grootboekrekening: "4620", ogbKostensoort: "4604", economischeCategorie: "RENTE_OPBRENGSTEN", geldigVanafBoekjaar: 2024 }),
  mappingRegel({ bedrijfsnr: "013", grootboekrekening: "4620", ogbKostensoort: "4621", economischeCategorie: "RENTE_OPBRENGSTEN", geldigVanafBoekjaar: 2024 }),
];

function invoer023(overrides: Partial<RenteCentraleMappingInvoer> = {}): RenteCentraleMappingInvoer {
  return { bedrijfsnr: "023", grootboekrekening: "4600", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-14T12:00:00.000Z"), ...overrides };
}
function invoer013(overrides: Partial<RenteCentraleMappingInvoer> = {}): RenteCentraleMappingInvoer {
  return { bedrijfsnr: "013", grootboekrekening: "4620", boekjaar: 2024, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-14T12:00:00.000Z"), ...overrides };
}

describe("resolveerRenteCategorieViaCentraleMapping — 023/GL4600 en 013/GL4620", () => {
  it.each(OUDE_KLASSIFICATIE_023)("023: OGB $ogbKostensoort resolveert via centrale mapping naar exact dezelfde categorie als de oude classificatie", (regel) => {
    expect(resolveerRenteCategorieViaCentraleMapping(invoer023(), regel.ogbKostensoort, MAPPING_023)).toEqual({ categorie: regel.categorie, specificiteit: "GL_OGB" });
  });

  it.each(OUDE_KLASSIFICATIE_013)("013: OGB $ogbKostensoort resolveert via centrale mapping naar exact dezelfde categorie als de oude classificatie", (regel) => {
    expect(resolveerRenteCategorieViaCentraleMapping(invoer013(), regel.ogbKostensoort, MAPPING_013)).toEqual({ categorie: regel.categorie, specificiteit: "GL_OGB" });
  });

  it("kernbewijs herhaald op de centrale resolver: dezelfde OGB-code 4604 geeft bij 023 RENTEKOSTEN en bij 013 RENTE_OPBRENGSTEN", () => {
    expect(resolveerRenteCategorieViaCentraleMapping(invoer023(), "4604", MAPPING_023)!.categorie).toBe("RENTEKOSTEN");
    expect(resolveerRenteCategorieViaCentraleMapping(invoer013(), "4604", MAPPING_013)!.categorie).toBe("RENTE_OPBRENGSTEN");
  });

  it("F1. onbekende OGB-code op een bekende Rente-GL -> NIET_GEMAPT (geen GL-default aanwezig, exacte pariteit met de oude 'onbekende code'-uitkomst)", () => {
    expect(resolveerRenteCategorieViaCentraleMapping(invoer023(), "9999", MAPPING_023)).toBeNull();
  });

  it("F2. boeking zonder OGB-kostensoort (null) op een bekende Rente-GL -> NIET_GEMAPT (exacte pariteit met de oude 'ogbKostensoort===null'-uitkomst)", () => {
    expect(resolveerRenteCategorieViaCentraleMapping(invoer023(), null, MAPPING_023)).toBeNull();
  });

  it("G. module-invariant blijft hard: een (per ongeluk) toegevoegde GL-default met een andere module dan de GL+OGB-rijen faalt fail-fast", () => {
    const kapotteMapping: PnLBronmappingRegel[] = [...MAPPING_023, mappingRegel({ ogbKostensoort: null, economischeModule: "LEEGSTAND", economischeCategorie: "NUTS_LEEGSTAND" })];
    expect(() => resolveerRenteCategorieViaCentraleMapping(invoer023(), "4601", kapotteMapping)).toThrow(/mag nooit naar een andere economische module springen/);
  });
});

describe("bouwRenteClassificatieViaCentraleMapping — oud-vs-nieuw classificatie-array identiek", () => {
  it("023: de centrale mapping (6 GL+OGB-rijen, geen default) reproduceert exact de oude 6-rijen-classificatie", () => {
    const { classificatie, nietGemapt } = bouwRenteClassificatieViaCentraleMapping(
      invoer023(),
      OUDE_KLASSIFICATIE_023.map(({ ogbKostensoort, ogbKostensoortOmschrijving }) => ({ ogbKostensoort, ogbKostensoortOmschrijving })),
      MAPPING_023,
    );
    expect(nietGemapt).toEqual([]);
    const gesorteerdNieuw = [...classificatie].sort((a, b) => a.ogbKostensoort.localeCompare(b.ogbKostensoort));
    const gesorteerdOud = [...OUDE_KLASSIFICATIE_023].sort((a, b) => a.ogbKostensoort.localeCompare(b.ogbKostensoort));
    expect(gesorteerdNieuw).toEqual(gesorteerdOud);
  });

  it("013: de centrale mapping (2 GL+OGB-rijen, geen default) reproduceert exact de oude 2-rijen-classificatie", () => {
    const { classificatie, nietGemapt } = bouwRenteClassificatieViaCentraleMapping(
      invoer013(),
      OUDE_KLASSIFICATIE_013.map(({ ogbKostensoort, ogbKostensoortOmschrijving }) => ({ ogbKostensoort, ogbKostensoortOmschrijving })),
      MAPPING_013,
    );
    expect(nietGemapt).toEqual([]);
    expect(classificatie).toEqual(OUDE_KLASSIFICATIE_013);
  });

  it("F3. een aangeleverde OGB-code zonder mapping wordt expliciet in nietGemapt gerapporteerd, nooit stil weggelaten", () => {
    const { classificatie, nietGemapt } = bouwRenteClassificatieViaCentraleMapping(invoer023(), [{ ogbKostensoort: "9999", ogbKostensoortOmschrijving: "onbekend" }], MAPPING_023);
    expect(classificatie).toEqual([]);
    expect(nietGemapt).toEqual(["9999"]);
  });
});

describe("berekenWerkelijkRente — oud vs. nieuw, byte-identiek op de echte bronproeven", () => {
  it("023 (bronproef 2025, GL4600): 6 echte boekingen, totaal 1.148.524,51 — identiek Werkelijk-resultaat", () => {
    const boekingen: WerkelijkRenteBoekingRegel[] = [
      boeking({ ogbKostensoort: "4601", saldo: new Decimal("522837.15") }),
      boeking({ ogbKostensoort: "4602", saldo: new Decimal("49045.59") }),
      boeking({ ogbKostensoort: "4603", saldo: new Decimal("104989.35") }),
      boeking({ ogbKostensoort: "4604", saldo: new Decimal("66211.49") }),
      boeking({ ogbKostensoort: "4606", saldo: new Decimal("357440.93") }),
      boeking({ ogbKostensoort: "4620", saldo: new Decimal("48000") }),
    ];
    const { classificatie: nieuweClassificatie } = bouwRenteClassificatieViaCentraleMapping(
      invoer023(),
      OUDE_KLASSIFICATIE_023.map(({ ogbKostensoort, ogbKostensoortOmschrijving }) => ({ ogbKostensoort, ogbKostensoortOmschrijving })),
      MAPPING_023,
    );

    const resultaatOud = berekenWerkelijkRente(boekingen, OUDE_KLASSIFICATIE_023);
    const resultaatNieuw = berekenWerkelijkRente(boekingen, nieuweClassificatie);

    expect(normaliseer(resultaatNieuw)).toBe(normaliseer(resultaatOud));
    expect(resultaatOud.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.categorieTotaal.toString()).toBe("1148524.51");
  });

  it("013 (bronproef 2024, GL4620): 2 echte boekingen, totaal -1.250,09 — identiek Werkelijk-resultaat", () => {
    const boekingen: WerkelijkRenteBoekingRegel[] = [boeking({ ogbKostensoort: "4604", saldo: new Decimal("-1215.67") }), boeking({ ogbKostensoort: "4621", saldo: new Decimal("-34.42") })];
    const { classificatie: nieuweClassificatie } = bouwRenteClassificatieViaCentraleMapping(
      invoer013(),
      OUDE_KLASSIFICATIE_013.map(({ ogbKostensoort, ogbKostensoortOmschrijving }) => ({ ogbKostensoort, ogbKostensoortOmschrijving })),
      MAPPING_013,
    );

    const resultaatOud = berekenWerkelijkRente(boekingen, OUDE_KLASSIFICATIE_013);
    const resultaatNieuw = berekenWerkelijkRente(boekingen, nieuweClassificatie);

    expect(normaliseer(resultaatNieuw)).toBe(normaliseer(resultaatOud));
    expect(resultaatOud.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!.categorieTotaal.toString()).toBe("-1250.09");
  });

  it("F4. onbekende OGB en ontbrekende OGB geven bij oud en nieuw identieke 'niet geclassificeerd'-uitkomst", () => {
    const boekingen: WerkelijkRenteBoekingRegel[] = [boeking({ ogbKostensoort: "9999", saldo: new Decimal(500) }), boeking({ ogbKostensoort: null, saldo: new Decimal(250) })];
    const { classificatie: nieuweClassificatie } = bouwRenteClassificatieViaCentraleMapping(
      invoer023(),
      OUDE_KLASSIFICATIE_023.map(({ ogbKostensoort, ogbKostensoortOmschrijving }) => ({ ogbKostensoort, ogbKostensoortOmschrijving })),
      MAPPING_023,
    );

    const resultaatOud = berekenWerkelijkRente(boekingen, OUDE_KLASSIFICATIE_023);
    const resultaatNieuw = berekenWerkelijkRente(boekingen, nieuweClassificatie);

    expect(normaliseer(resultaatNieuw)).toBe(normaliseer(resultaatOud));
    expect(resultaatOud.nietGeclassificeerdTotaal.toString()).toBe("750");
    expect(resultaatNieuw.nietGeclassificeerdTotaal.toString()).toBe("750");
  });
});

describe("berekenEstimatedRente — oud vs. nieuw, byte-identiek", () => {
  const BEGROTING = berekenBegroteRente(
    [regel({ categorie: "RENTEKOSTEN", begrotingsbedrag: new Decimal(1148524.51) }), regel({ categorie: "RENTE_OPBRENGSTEN", begrotingsbedrag: new Decimal(-1250.09) })],
    alleAannames(),
    { begrotingsjaar: BEGROTINGSJAAR },
  );

  function geenVerwachting(): Record<BgRenteCategorie, Decimal | null> {
    return Object.fromEntries(RENTE_CATEGORIEEN.map((c) => [c, null])) as Record<BgRenteCategorie, Decimal | null>;
  }

  it("Estimated op basis van het nieuwe Werkelijk-resultaat is byte-identiek aan Estimated op basis van het oude", () => {
    const { classificatie: nieuweClassificatie } = bouwRenteClassificatieViaCentraleMapping(
      invoer023(),
      OUDE_KLASSIFICATIE_023.map(({ ogbKostensoort, ogbKostensoortOmschrijving }) => ({ ogbKostensoort, ogbKostensoortOmschrijving })),
      MAPPING_023,
    );
    const boekingen: WerkelijkRenteBoekingRegel[] = [boeking({ ogbKostensoort: "4601", saldo: new Decimal(522837.15) })];

    const werkelijkOud = berekenWerkelijkRente(boekingen, OUDE_KLASSIFICATIE_023);
    const werkelijkNieuw = berekenWerkelijkRente(boekingen, nieuweClassificatie);

    const verwachting = geenVerwachting();
    verwachting.RENTEKOSTEN = new Decimal(625687.36);

    const estimatedOud = berekenEstimatedRente(BEGROTING, werkelijkOud, verwachting);
    const estimatedNieuw = berekenEstimatedRente(BEGROTING, werkelijkNieuw, verwachting);

    expect(normaliseer(estimatedNieuw)).toBe(normaliseer(estimatedOud));
    expect(estimatedOud.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.estimatedTotaal!.toString()).toBe("1148524.51");
  });
});

describe("berekenWerkelijkRenteViaCentraleMapping — FASE M3b: de daadwerkelijk gewirede productieketen", () => {
  function ruweBoeking(overrides: Partial<RenteRuweBoekingRegel> = {}): RenteRuweBoekingRegel {
    return { grootboekrekening: "4600", ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", saldo: new Decimal(1000), ...overrides };
  }

  function keteninvoer023(overrides: Partial<RenteWerkelijkViaCentraleMappingInvoer> = {}): RenteWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "023", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-14T12:00:00.000Z"), ...overrides };
  }
  function keteninvoer013(overrides: Partial<RenteWerkelijkViaCentraleMappingInvoer> = {}): RenteWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "013", boekjaar: 2024, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-14T12:00:00.000Z"), ...overrides };
  }

  const RUWE_BOEKINGEN_023: RenteRuweBoekingRegel[] = [
    ruweBoeking({ grootboekrekening: "4600", ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", saldo: new Decimal("522837.15") }),
    ruweBoeking({ grootboekrekening: "4600", ogbKostensoort: "4602", ogbKostensoortOmschrijving: "Rente en Provisie ING R/C", saldo: new Decimal("49045.59") }),
    ruweBoeking({ grootboekrekening: "4600", ogbKostensoort: "4603", ogbKostensoortOmschrijving: "Rente lening .586", saldo: new Decimal("104989.35") }),
    ruweBoeking({ grootboekrekening: "4600", ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente lening .500", saldo: new Decimal("66211.49") }),
    ruweBoeking({ grootboekrekening: "4600", ogbKostensoort: "4606", ogbKostensoortOmschrijving: "rente lening 747", saldo: new Decimal("357440.93") }),
    ruweBoeking({ grootboekrekening: "4600", ogbKostensoort: "4620", ogbKostensoortOmschrijving: "Overige rentes", saldo: new Decimal("48000") }),
  ];
  const RUWE_BOEKINGEN_013: RenteRuweBoekingRegel[] = [
    ruweBoeking({ grootboekrekening: "4620", ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente r/c", saldo: new Decimal("-1215.67") }),
    ruweBoeking({ grootboekrekening: "4620", ogbKostensoort: "4621", ogbKostensoortOmschrijving: "Rente opbrengst telerek", saldo: new Decimal("-34.42") }),
  ];

  it("B. de gewirede keten gebruikt daadwerkelijk de aangeleverde centrale mapping (geen stille interne oude-classificatie-fallback)", () => {
    // Verwijder OGB 4602 uit de mapping — als de functie stiekem de oude, hardcoded classificatie zou
    // gebruiken, zou 4602 (49045.59) alsnog als RENTEKOSTEN meetellen. Met alleen de aangeleverde mapping
    // moet dit bedrag naar "niet geclassificeerd" verschuiven.
    const mappingZonder4602 = MAPPING_023.filter((r) => r.ogbKostensoort !== "4602");
    const { werkelijk, nietGemapt } = berekenWerkelijkRenteViaCentraleMapping(keteninvoer023(), RUWE_BOEKINGEN_023, mappingZonder4602);

    expect(nietGemapt).toEqual([{ grootboekrekening: "4600", ogbKostensoort: "4602" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("49045.59");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.categorieTotaal.toString()).toBe("1099478.92"); // 1148524.51 - 49045.59
  });

  it("C. 023 (Malcon Beheer BV): volledig gewirede Werkelijk Rentekosten blijft exact €1.148.524,51", () => {
    const { werkelijk, nietGemapt } = berekenWerkelijkRenteViaCentraleMapping(keteninvoer023(), RUWE_BOEKINGEN_023, MAPPING_023);
    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.categorieTotaal.toString()).toBe("1148524.51");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!.categorieTotaal.toString()).toBe("0");
    expect(werkelijk.nietGeclassificeerdAantalBoekingen).toBe(0);
    // Byte-identiek aan de oude keten (M3-bewijs herhaald op het NIEUWE, volledig gewirede pad).
    const resultaatOud = berekenWerkelijkRente(
      RUWE_BOEKINGEN_023.map((b) => ({ ogbKostensoort: b.ogbKostensoort, saldo: b.saldo })),
      OUDE_KLASSIFICATIE_023,
    );
    expect(normaliseer(werkelijk)).toBe(normaliseer(resultaatOud));
  });

  it("D. 013 (bewezen bronproef): volledig gewirede Werkelijk Rente opbrengsten blijft exact -€1.250,09", () => {
    const { werkelijk, nietGemapt } = berekenWerkelijkRenteViaCentraleMapping(keteninvoer013(), RUWE_BOEKINGEN_013, MAPPING_013);
    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!.categorieTotaal.toString()).toBe("-1250.09");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.categorieTotaal.toString()).toBe("0");
    const resultaatOud = berekenWerkelijkRente(
      RUWE_BOEKINGEN_013.map((b) => ({ ogbKostensoort: b.ogbKostensoort, saldo: b.saldo })),
      OUDE_KLASSIFICATIE_013,
    );
    expect(normaliseer(werkelijk)).toBe(normaliseer(resultaatOud));
  });

  it("E. Estimated op basis van de volledig gewirede keten blijft byte-identiek aan Estimated op basis van de oude keten", () => {
    const BEGROTING = berekenBegroteRente(
      [regel({ categorie: "RENTEKOSTEN", begrotingsbedrag: new Decimal(1148524.51) }), regel({ categorie: "RENTE_OPBRENGSTEN", begrotingsbedrag: new Decimal(-1250.09) })],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    function geenVerwachting(): Record<BgRenteCategorie, Decimal | null> {
      return Object.fromEntries(RENTE_CATEGORIEEN.map((c) => [c, null])) as Record<BgRenteCategorie, Decimal | null>;
    }
    // RUWE_BOEKINGEN_023 dekt hier al het volledige jaartotaal (1.148.524,51) — geen resterende
    // verwachting nodig; Estimated moet dan exact gelijk zijn aan Werkelijk.
    const verwachting = geenVerwachting();

    const { werkelijk: werkelijkNieuw } = berekenWerkelijkRenteViaCentraleMapping(keteninvoer023(), RUWE_BOEKINGEN_023, MAPPING_023);
    const werkelijkOud = berekenWerkelijkRente(
      RUWE_BOEKINGEN_023.map((b) => ({ ogbKostensoort: b.ogbKostensoort, saldo: b.saldo })),
      OUDE_KLASSIFICATIE_023,
    );

    const estimatedNieuw = berekenEstimatedRente(BEGROTING, werkelijkNieuw, verwachting);
    const estimatedOud = berekenEstimatedRente(BEGROTING, werkelijkOud, verwachting);

    expect(normaliseer(estimatedNieuw)).toBe(normaliseer(estimatedOud));
    expect(estimatedNieuw.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.werkelijkTotaal.toString()).toBe("1148524.51");
  });

  it("F. onbekende OGB-code binnen een bekende Rente-GL -> expliciet NIET_GEMAPT, niet stil verdwenen/genold/geraden", () => {
    const boekingen = [...RUWE_BOEKINGEN_023, ruweBoeking({ grootboekrekening: "4600", ogbKostensoort: "9999", ogbKostensoortOmschrijving: "onbekend", saldo: new Decimal(500) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkRenteViaCentraleMapping(keteninvoer023(), boekingen, MAPPING_023);

    expect(nietGemapt).toEqual([{ grootboekrekening: "4600", ogbKostensoort: "9999" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("500");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.categorieTotaal.toString()).toBe("1148524.51"); // ongewijzigd — 9999 telt nergens mee
  });

  it("G. boeking zonder OGB-kostensoort (null) -> expliciet NIET_GEMAPT, geen GL-default toegepast", () => {
    const boekingen = [...RUWE_BOEKINGEN_023, ruweBoeking({ grootboekrekening: "4600", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(250) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkRenteViaCentraleMapping(keteninvoer023(), boekingen, MAPPING_023);

    expect(nietGemapt).toEqual([{ grootboekrekening: "4600", ogbKostensoort: null }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("250");
  });

  it("H. GL wordt nooit uit OGB afgeleid: dezelfde OGB-code op een ANDERE, niet-gemapte GL resolveert onafhankelijk (blijft NIET_GEMAPT, geen toevallige match via de OGB-waarde)", () => {
    // OGB "4601" bestaat wél in de mapping voor GL 4600/023, maar NIET voor een fictieve andere GL "9999".
    const boekingOpAndereGl = ruweBoeking({ grootboekrekening: "9999", ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", saldo: new Decimal(777) });
    const { werkelijk, nietGemapt } = berekenWerkelijkRenteViaCentraleMapping(keteninvoer023(), [boekingOpAndereGl], MAPPING_023);

    expect(nietGemapt).toEqual([{ grootboekrekening: "9999", ogbKostensoort: "4601" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("777");
    expect(werkelijk.perCategorie.every((c) => c.categorieTotaal.toString() === "0")).toBe(true);
  });
});
