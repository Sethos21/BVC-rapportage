import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { ALGEMENE_KOSTEN_CATEGORIEEN, berekenBegroteAlgemeneKosten, type BgAlgemeneKostenCategorie, type BgAlgemeneKostenCategorieAannames, type BgAlgemeneKostenClassificatieRegel } from "./begroteAlgemeneKosten.js";
import {
  berekenWerkelijkAlgemeneKostenViaCentraleMapping,
  bouwAlgemeneKostenClassificatieViaCentraleMapping,
  resolveerAlgemeneKostenCategorieViaCentraleMapping,
  type AlgemeneKostenCentraleMappingInvoer,
  type AlgemeneKostenRuweBoekingRegel,
  type AlgemeneKostenWerkelijkViaCentraleMappingInvoer,
} from "./algemeneKostenCentraleMapping.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE M2-regressieproef: bewijst dat de centrale P&L-bronmappingresolver
 * (commit 5ece248) een veilige, economisch identieke vervanging is voor de
 * bestaande, handmatig ingevulde `algemeneKostenClassificatie`-tabel — op
 * basis van de bewezen 070/GL4990-bronproef (boekjaar 2025, zie de
 * P&L-dekkingsanalyse-sessie).
 */

const BEDRIJFSNR = "070";
const GL = "4990";
const AANGEMAAKT = new Date("2026-09-14T00:00:00.000Z");

/** De centrale mapping voor 070/GL4990 — precies de drie rijen die het M1-fixture al bewees (default + twee GL+OGB-verfijningen). */
const MAPPING_070_GL4990: PnLBronmappingRegel[] = [
  {
    bedrijfsnr: BEDRIJFSNR,
    grootboekrekening: GL,
    ogbKostensoort: null,
    economischeModule: "ALGEMENE_KOSTEN",
    economischeCategorie: "ALGEMENE_KOSTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
  },
  {
    bedrijfsnr: BEDRIJFSNR,
    grootboekrekening: GL,
    ogbKostensoort: "4992",
    economischeModule: "ALGEMENE_KOSTEN",
    economischeCategorie: "MAKELAARSKOSTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
  },
  {
    bedrijfsnr: BEDRIJFSNR,
    grootboekrekening: GL,
    ogbKostensoort: "4995",
    economischeModule: "ALGEMENE_KOSTEN",
    economischeCategorie: "BANKKOSTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
  },
];

function invoer(overrides: Partial<AlgemeneKostenCentraleMappingInvoer> = {}): AlgemeneKostenCentraleMappingInvoer {
  return { bedrijfsnr: BEDRIJFSNR, grootboekrekening: GL, boekjaar: 2025, boekperiode: "06", opSysteemtijdstip: new Date("2026-09-14T12:00:00.000Z"), ...overrides };
}

describe("resolveerAlgemeneKostenCategorieViaCentraleMapping", () => {
  it("4990 (Diverse alg kosten) -> ALGEMENE_KOSTEN via GL-default", () => {
    expect(resolveerAlgemeneKostenCategorieViaCentraleMapping(invoer(), "4990", MAPPING_070_GL4990)).toEqual({ categorie: "ALGEMENE_KOSTEN", specificiteit: "GL_DEFAULT" });
  });

  it("4991 (Afronding/betalingsversch) -> ALGEMENE_KOSTEN via GL-default (geen aparte categorie bewezen)", () => {
    expect(resolveerAlgemeneKostenCategorieViaCentraleMapping(invoer(), "4991", MAPPING_070_GL4990)).toEqual({ categorie: "ALGEMENE_KOSTEN", specificiteit: "GL_DEFAULT" });
  });

  it("4992 (makelaarskosten) -> MAKELAARSKOSTEN via GL+OGB", () => {
    expect(resolveerAlgemeneKostenCategorieViaCentraleMapping(invoer(), "4992", MAPPING_070_GL4990)).toEqual({ categorie: "MAKELAARSKOSTEN", specificiteit: "GL_OGB" });
  });

  it("4995 (Bankkosten) -> BANKKOSTEN via GL+OGB", () => {
    expect(resolveerAlgemeneKostenCategorieViaCentraleMapping(invoer(), "4995", MAPPING_070_GL4990)).toEqual({ categorie: "BANKKOSTEN", specificiteit: "GL_OGB" });
  });

  it("D. onbekende grootboekrekening -> null (NIET_GEMAPT), expliciet, geen gok", () => {
    expect(resolveerAlgemeneKostenCategorieViaCentraleMapping(invoer({ grootboekrekening: "9999" }), "1234", MAPPING_070_GL4990)).toBeNull();
  });

  it("E. GL+OGB-mapping met een andere economischeModule dan de GL-default faalt hard (geen coercie)", () => {
    const kapotteMapping: PnLBronmappingRegel[] = [
      MAPPING_070_GL4990[0]!,
      { ...MAPPING_070_GL4990[1]!, economischeModule: "LEEGSTAND", economischeCategorie: "NUTS_LEEGSTAND" },
    ];
    expect(() => resolveerAlgemeneKostenCategorieViaCentraleMapping(invoer(), "4992", kapotteMapping)).toThrow(/mag nooit naar een andere economische module springen/);
  });

  it("resolveert naar economischeModule buiten ALGEMENE_KOSTEN -> harde fout (defensief, adapter-eigen check)", () => {
    const verkeerdeModuleMapping: PnLBronmappingRegel[] = [{ ...MAPPING_070_GL4990[0]!, economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" }];
    expect(() => resolveerAlgemeneKostenCategorieViaCentraleMapping(invoer(), null, verkeerdeModuleMapping)).toThrow(/niet "ALGEMENE_KOSTEN"/);
  });
});

describe("bouwAlgemeneKostenClassificatieViaCentraleMapping — oud-vs-nieuw-bewijs (070/GL4990)", () => {
  const OGB_CODES_070_GL4990 = [
    { ogbKostensoort: "4990", ogbKostensoortOmschrijving: "Diverse alg kosten" },
    { ogbKostensoort: "4991", ogbKostensoortOmschrijving: "Afronding/betalingsversch" },
    { ogbKostensoort: "4992", ogbKostensoortOmschrijving: "makelaarskosten" },
    { ogbKostensoort: "4995", ogbKostensoortOmschrijving: "Bankkosten" },
  ];

  /**
   * De OUDE, handmatig te configureren `algemeneKostenClassificatie`-vorm —
   * zoals die er vandaag voor 070 zou moeten uitzien om exact dezelfde vier
   * bewezen OGB-codes te dekken. Vier expliciete rijen nodig (geen
   * GL-default-concept in het oude systeem).
   */
  const OUDE_CLASSIFICATIE: BgAlgemeneKostenClassificatieRegel[] = [
    { ogbKostensoort: "4990", ogbKostensoortOmschrijving: "Diverse alg kosten", categorie: "ALGEMENE_KOSTEN" },
    { ogbKostensoort: "4991", ogbKostensoortOmschrijving: "Afronding/betalingsversch", categorie: "ALGEMENE_KOSTEN" },
    { ogbKostensoort: "4992", ogbKostensoortOmschrijving: "makelaarskosten", categorie: "MAKELAARSKOSTEN" },
    { ogbKostensoort: "4995", ogbKostensoortOmschrijving: "Bankkosten", categorie: "BANKKOSTEN" },
  ];

  it("A. de centrale mapping (3 rijen: default + 2 verfijningen) reproduceert exact de 4-rijen-oude-classificatie", () => {
    const { classificatie, nietGemapt } = bouwAlgemeneKostenClassificatieViaCentraleMapping(invoer(), OGB_CODES_070_GL4990, MAPPING_070_GL4990);

    expect(nietGemapt).toEqual([]);
    expect(classificatie).toHaveLength(4);
    // Volgorde-onafhankelijke vergelijking — inhoud moet identiek zijn aan de oude, hand-geconfigureerde tabel.
    const gesorteerdNieuw = [...classificatie].sort((a, b) => a.ogbKostensoort.localeCompare(b.ogbKostensoort));
    const gesorteerdOud = [...OUDE_CLASSIFICATIE].sort((a, b) => a.ogbKostensoort.localeCompare(b.ogbKostensoort));
    expect(gesorteerdNieuw).toEqual(gesorteerdOud);
  });

  it("D. een OGB-code zonder enige mapping wordt expliciet als nietGemapt gerapporteerd, nooit stil weggelaten of foutief geclassificeerd", () => {
    const { classificatie, nietGemapt } = bouwAlgemeneKostenClassificatieViaCentraleMapping(
      invoer({ grootboekrekening: "9999" }),
      [{ ogbKostensoort: "1234", ogbKostensoortOmschrijving: "onbekend" }],
      MAPPING_070_GL4990,
    );
    expect(classificatie).toEqual([]);
    expect(nietGemapt).toEqual(["1234"]);
  });
});

describe("berekenBegroteAlgemeneKosten — calculator ongewijzigd, oud vs. nieuw geeft byte-identieke uitkomst", () => {
  function aannames(): Record<BgAlgemeneKostenCategorie, BgAlgemeneKostenCategorieAannames> {
    return Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, { beoordeeld: true, vorigJaarBedrag: null, verwachteVerhogingPercentage: null }])) as Record<
      BgAlgemeneKostenCategorie,
      BgAlgemeneKostenCategorieAannames
    >;
  }

  const OGB_CODES_070_GL4990 = [
    { ogbKostensoort: "4990", ogbKostensoortOmschrijving: "Diverse alg kosten" },
    { ogbKostensoort: "4991", ogbKostensoortOmschrijving: "Afronding/betalingsversch" },
    { ogbKostensoort: "4992", ogbKostensoortOmschrijving: "makelaarskosten" },
    { ogbKostensoort: "4995", ogbKostensoortOmschrijving: "Bankkosten" },
  ];
  const OUDE_CLASSIFICATIE: BgAlgemeneKostenClassificatieRegel[] = [
    { ogbKostensoort: "4990", ogbKostensoortOmschrijving: "Diverse alg kosten", categorie: "ALGEMENE_KOSTEN" },
    { ogbKostensoort: "4991", ogbKostensoortOmschrijving: "Afronding/betalingsversch", categorie: "ALGEMENE_KOSTEN" },
    { ogbKostensoort: "4992", ogbKostensoortOmschrijving: "makelaarskosten", categorie: "MAKELAARSKOSTEN" },
    { ogbKostensoort: "4995", ogbKostensoortOmschrijving: "Bankkosten", categorie: "BANKKOSTEN" },
  ];

  it("een Begrotingsregel met ogbKostensoortCode=4992 geeft identiek resultaat met de oude en de via-centrale-mapping-afgeleide classificatie", () => {
    const { classificatie: nieuweClassificatie } = bouwAlgemeneKostenClassificatieViaCentraleMapping(invoer(), OGB_CODES_070_GL4990, MAPPING_070_GL4990);

    const regelsInvoer = [{ categorie: "MAKELAARSKOSTEN" as const, ogbKostensoortCode: "4992", omschrijving: "bma bemiddeling verhuur", complexnummer: null, jaarbedrag: new Decimal(6067.24) }];

    const resultaatOud = berekenBegroteAlgemeneKosten(regelsInvoer, aannames(), OUDE_CLASSIFICATIE, { begrotingsjaar: 2027 });
    const resultaatNieuw = berekenBegroteAlgemeneKosten(regelsInvoer, aannames(), nieuweClassificatie, { begrotingsjaar: 2027 });

    const normaliseer = (r: unknown) => JSON.stringify(r, (_key, v) => (v instanceof Decimal ? v.toString() : v));
    expect(normaliseer(resultaatNieuw)).toBe(normaliseer(resultaatOud));
    expect(resultaatOud.makelaarskosten.toString()).toBe("6067.24");
    expect(resultaatOud.controleVereist).toHaveLength(0);
  });

  it("een onbekende OGB-code geeft bij zowel oud als nieuw dezelfde KRITIEK-controlemelding (geen stille default in de bestaande validatiestroom)", () => {
    const { classificatie: nieuweClassificatie } = bouwAlgemeneKostenClassificatieViaCentraleMapping(invoer(), OGB_CODES_070_GL4990, MAPPING_070_GL4990);
    const regelsInvoer = [{ categorie: "ALGEMENE_KOSTEN" as const, ogbKostensoortCode: "0000", omschrijving: "test", complexnummer: null, jaarbedrag: new Decimal(100) }];

    const resultaatOud = berekenBegroteAlgemeneKosten(regelsInvoer, aannames(), OUDE_CLASSIFICATIE, { begrotingsjaar: 2027 });
    const resultaatNieuw = berekenBegroteAlgemeneKosten(regelsInvoer, aannames(), nieuweClassificatie, { begrotingsjaar: 2027 });

    expect(resultaatOud.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(true);
    expect(resultaatNieuw.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(true);
    // Belangrijk: de via-centrale-mapping-afgeleide classificatie kent GEEN GL-default-concept in DEZE aanroep,
    // want "0000" is een geheel onbekende OGB-code die niet eens via bouwAlgemeneKostenClassificatieViaCentraleMapping
    // is aangeleverd — de bestaande calculator behandelt dit dus voor beide identiek als "onbekende code".
  });
});

describe("070/GL4990 — bedragsvergelijking op de echte bronproefcijfers (boekjaar 2025)", () => {
  /** Reeds-bewezen OGB-totalen uit de echte 070-diagnose (matrixGrootboekOgbKostensoort, GL4990). */
  const ECHTE_OGB_TOTALEN: { ogbKostensoort: string; saldo: Decimal }[] = [
    { ogbKostensoort: "4990", saldo: new Decimal("572.99") },
    { ogbKostensoort: "4991", saldo: new Decimal("-0.62") },
    { ogbKostensoort: "4992", saldo: new Decimal("6067.24") },
    { ogbKostensoort: "4995", saldo: new Decimal("40.15") },
  ];

  const OUDE_CLASSIFICATIE: BgAlgemeneKostenClassificatieRegel[] = [
    { ogbKostensoort: "4990", ogbKostensoortOmschrijving: "Diverse alg kosten", categorie: "ALGEMENE_KOSTEN" },
    { ogbKostensoort: "4991", ogbKostensoortOmschrijving: "Afronding/betalingsversch", categorie: "ALGEMENE_KOSTEN" },
    { ogbKostensoort: "4992", ogbKostensoortOmschrijving: "makelaarskosten", categorie: "MAKELAARSKOSTEN" },
    { ogbKostensoort: "4995", ogbKostensoortOmschrijving: "Bankkosten", categorie: "BANKKOSTEN" },
  ];

  function totaalPerCategorie(classificatie: readonly BgAlgemeneKostenClassificatieRegel[]): Record<string, Decimal> {
    const totalen: Record<string, Decimal> = {};
    for (const { ogbKostensoort, saldo } of ECHTE_OGB_TOTALEN) {
      const categorie = classificatie.find((c) => c.ogbKostensoort === ogbKostensoort)!.categorie;
      totalen[categorie] = (totalen[categorie] ?? new Decimal(0)).plus(saldo);
    }
    return totalen;
  }

  it("groepering via de OUDE classificatie geeft de bewezen bedragen (restregel 572,37 / makelaars 6067,24 / bank 40,15 / totaal 6679,76)", () => {
    const totalen = totaalPerCategorie(OUDE_CLASSIFICATIE);
    expect(totalen.ALGEMENE_KOSTEN!.toString()).toBe("572.37");
    expect(totalen.MAKELAARSKOSTEN!.toString()).toBe("6067.24");
    expect(totalen.BANKKOSTEN!.toString()).toBe("40.15");
  });

  it("groepering via de NIEUWE, centrale-mapping-afgeleide classificatie geeft EXACT dezelfde bedragen én hetzelfde GL-totaal", () => {
    const invoerContext = invoer();
    const { classificatie: nieuweClassificatie, nietGemapt } = bouwAlgemeneKostenClassificatieViaCentraleMapping(
      invoerContext,
      ECHTE_OGB_TOTALEN.map((r) => ({ ogbKostensoort: r.ogbKostensoort, ogbKostensoortOmschrijving: r.ogbKostensoort })),
      MAPPING_070_GL4990,
    );
    expect(nietGemapt).toEqual([]);

    const totalenOud = totaalPerCategorie(OUDE_CLASSIFICATIE);
    const totalenNieuw = totaalPerCategorie(nieuweClassificatie);

    expect(totalenNieuw).toEqual(totalenOud);

    const glTotaal = ECHTE_OGB_TOTALEN.reduce((acc, r) => acc.plus(r.saldo), new Decimal(0));
    const somPerCategorieNieuw = Object.values(totalenNieuw).reduce((acc, v) => acc.plus(v), new Decimal(0));
    expect(glTotaal.toString()).toBe("6679.76");
    expect(somPerCategorieNieuw.toString()).toBe(glTotaal.toString());
  });
});

/**
 * FASE GAT-009 (2026-09-16) — de nieuwe Werkelijk-productieketen
 * (`berekenWerkelijkAlgemeneKostenViaCentraleMapping`), gebouwd bovenop
 * dezelfde `resolveerAlgemeneKostenCategorieViaCentraleMapping` als hierboven.
 * Bewijst A/B/C/D/E uit de GAT-009-opdracht.
 */
describe("berekenWerkelijkAlgemeneKostenViaCentraleMapping — de gewirede 070-Werkelijk-productieketen", () => {
  const MAPPING_070_GL4990: PnLBronmappingRegel[] = [
    {
      bedrijfsnr: "070",
      grootboekrekening: "4990",
      ogbKostensoort: null,
      economischeModule: "ALGEMENE_KOSTEN",
      economischeCategorie: "ALGEMENE_KOSTEN",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      aangemaaktOp: AANGEMAAKT,
    },
    {
      bedrijfsnr: "070",
      grootboekrekening: "4990",
      ogbKostensoort: "4992",
      economischeModule: "ALGEMENE_KOSTEN",
      economischeCategorie: "MAKELAARSKOSTEN",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      aangemaaktOp: AANGEMAAKT,
    },
    {
      bedrijfsnr: "070",
      grootboekrekening: "4990",
      ogbKostensoort: "4995",
      economischeModule: "ALGEMENE_KOSTEN",
      economischeCategorie: "BANKKOSTEN",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      aangemaaktOp: AANGEMAAKT,
    },
  ];

  function ruweBoeking(overrides: Partial<AlgemeneKostenRuweBoekingRegel> = {}): AlgemeneKostenRuweBoekingRegel {
    return { grootboekrekening: "4990", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(0), ...overrides };
  }
  function keteninvoer(overrides: Partial<AlgemeneKostenWerkelijkViaCentraleMappingInvoer> = {}): AlgemeneKostenWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "070", boekjaar: 2025, boekperiode: "06", opSysteemtijdstip: new Date("2026-09-16T12:00:00.000Z"), ...overrides };
  }

  it("A/B. de vier echte OGB-boekingen (070/GL4990, boekjaar 2025) reconciliëren op de bewezen categoriebedragen en het GL-totaal €6.679,76", () => {
    const boekingen: AlgemeneKostenRuweBoekingRegel[] = [
      ruweBoeking({ ogbKostensoort: "4990", saldo: new Decimal("572.99") }),
      ruweBoeking({ ogbKostensoort: "4991", saldo: new Decimal("-0.62") }),
      ruweBoeking({ ogbKostensoort: "4992", saldo: new Decimal("6067.24") }),
      ruweBoeking({ ogbKostensoort: "4995", saldo: new Decimal("40.15") }),
    ];
    const { werkelijk, nietGemapt } = berekenWerkelijkAlgemeneKostenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070_GL4990);

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ALGEMENE_KOSTEN")!.categorieTotaal.toString()).toBe("572.37"); // 572.99 + (-0.62), GL-default
    expect(werkelijk.perCategorie.find((c) => c.categorie === "MAKELAARSKOSTEN")!.categorieTotaal.toString()).toBe("6067.24");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "BANKKOSTEN")!.categorieTotaal.toString()).toBe("40.15");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ACCOUNTANT")!.categorieTotaal.toString()).toBe("0");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "JURIDISCHE_KOSTEN")!.categorieTotaal.toString()).toBe("0");
    expect(werkelijk.moduleTotaal.toString()).toBe("6679.76");
  });

  it("C. geen dubbele telling: som van de vijf categorieën + nietGeclassificeerdTotaal = alle aangeleverde boekingen, moduleTotaal telt niet nogmaals apart mee", () => {
    const boekingen: AlgemeneKostenRuweBoekingRegel[] = [
      ruweBoeking({ ogbKostensoort: "4990", saldo: new Decimal("572.99") }),
      ruweBoeking({ ogbKostensoort: "4991", saldo: new Decimal("-0.62") }),
      ruweBoeking({ ogbKostensoort: "4992", saldo: new Decimal("6067.24") }),
      ruweBoeking({ ogbKostensoort: "4995", saldo: new Decimal("40.15") }),
      ruweBoeking({ grootboekrekening: "9999", saldo: new Decimal(75) }),
    ];
    const { werkelijk } = berekenWerkelijkAlgemeneKostenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070_GL4990);
    const somAlleBoekingen = boekingen.reduce((t, b) => t.plus(b.saldo), new Decimal(0));
    const somCategorieen = werkelijk.perCategorie.reduce((t, c) => t.plus(c.categorieTotaal), new Decimal(0));
    expect(somCategorieen.plus(werkelijk.nietGeclassificeerdTotaal).toString()).toBe(somAlleBoekingen.toString());
    expect(werkelijk.moduleTotaal.toString()).toBe(somCategorieen.toString());
  });

  it("E. een fictieve, niet-gemapte GL -> expliciet NIET_GEMAPT, niet in een van de vijf categorieën gegokt", () => {
    const boekingen = [ruweBoeking({ ogbKostensoort: "4990", saldo: new Decimal("572.99") }), ruweBoeking({ grootboekrekening: "9999", saldo: new Decimal(500) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkAlgemeneKostenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070_GL4990);

    expect(nietGemapt).toEqual([{ grootboekrekening: "9999", ogbKostensoort: null }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("500");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ALGEMENE_KOSTEN")!.categorieTotaal.toString()).toBe("572.99"); // ongewijzigd
  });

  it("geen koppeling met Module 2: AlgemeneKostenRuweBoekingRegel kent geen jaarbedrag/verwachte-verhogingveld", () => {
    const boeking: AlgemeneKostenRuweBoekingRegel = ruweBoeking({ saldo: new Decimal(1000) });
    expect(Object.keys(boeking).sort()).toEqual(["grootboekrekening", "ogbKostensoort", "ogbKostensoortOmschrijving", "saldo"]);
  });
});

describe("D. synthetische TEST072-administratie — dezelfde calculator/mapping-orchestratie, uitsluitend andere GL/OGB-nummers", () => {
  const MAPPING_TEST072: PnLBronmappingRegel[] = [
    {
      bedrijfsnr: "TEST072",
      grootboekrekening: "5500",
      ogbKostensoort: null,
      economischeModule: "ALGEMENE_KOSTEN",
      economischeCategorie: "ALGEMENE_KOSTEN",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      aangemaaktOp: AANGEMAAKT,
    },
    {
      bedrijfsnr: "TEST072",
      grootboekrekening: "5500",
      ogbKostensoort: "77",
      economischeModule: "ALGEMENE_KOSTEN",
      economischeCategorie: "ACCOUNTANT",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      aangemaaktOp: AANGEMAAKT,
    },
    {
      bedrijfsnr: "TEST072",
      grootboekrekening: "5510",
      ogbKostensoort: null,
      economischeModule: "ALGEMENE_KOSTEN",
      economischeCategorie: "JURIDISCHE_KOSTEN",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      aangemaaktOp: AANGEMAAKT,
    },
  ];

  it("exact dezelfde functies (resolveerAlgemeneKostenCategorieViaCentraleMapping/berekenWerkelijkAlgemeneKostenViaCentraleMapping) werken op TEST072's eigen GL/OGB-nummers zonder enige codewijziging", () => {
    expect(resolveerAlgemeneKostenCategorieViaCentraleMapping({ bedrijfsnr: "TEST072", grootboekrekening: "5500", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() }, "77", MAPPING_TEST072)).toEqual(
      { categorie: "ACCOUNTANT", specificiteit: "GL_OGB" },
    );

    const boekingen: AlgemeneKostenRuweBoekingRegel[] = [
      { grootboekrekening: "5500", ogbKostensoort: "77", ogbKostensoortOmschrijving: null, saldo: new Decimal(2500) },
      { grootboekrekening: "5500", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(300) }, // GL-default
      { grootboekrekening: "5510", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(1250) },
    ];
    const { werkelijk, nietGemapt } = berekenWerkelijkAlgemeneKostenViaCentraleMapping(
      { bedrijfsnr: "TEST072", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() },
      boekingen,
      MAPPING_TEST072,
    );

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ACCOUNTANT")!.categorieTotaal.toString()).toBe("2500");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ALGEMENE_KOSTEN")!.categorieTotaal.toString()).toBe("300");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "JURIDISCHE_KOSTEN")!.categorieTotaal.toString()).toBe("1250");
    expect(werkelijk.moduleTotaal.toString()).toBe("4050");
  });

  it("070's mapping en TEST072's mapping leven volledig los van elkaar (bedrijfsnr-gescheiden)", () => {
    expect(resolveerAlgemeneKostenCategorieViaCentraleMapping({ bedrijfsnr: "070", grootboekrekening: "5500", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() }, null, MAPPING_TEST072)).toBeNull();
  });
});
