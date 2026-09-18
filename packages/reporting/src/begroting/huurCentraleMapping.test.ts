import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenWerkelijkHuurViaCentraleMapping,
  resolveerHuurCategorieViaCentraleMapping,
  type HuurCentraleMappingInvoer,
  type HuurRuweBoekingRegel,
  type HuurWerkelijkViaCentraleMappingInvoer,
} from "./huurCentraleMapping.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE GAT-002B (2026-09-16) — eerste Werkelijk-productieketen voor de
 * economische module HUUR. Bronmapping (bevestigd tegen
 * `packages/config/README.md`, GAT-002B-opdracht §3/§4-brongate): GL8800 →
 * HUUROPBRENGST_BELAST, GL8801 → HUUROPBRENGST_ONBELAST, GL8805 →
 * VERLEENDE_HUURKORTING — alle drie uitsluitend GL-defaults (geen OGB-
 * verfijning bewezen of nodig). Testbedragen zijn expliciete testfixtures
 * (zie `werkelijkHuur.ts`-moduledoc: geen bronproef-eurobedrag in de repo
 * voor deze drie GL's, alleen de classificatie zelf is bronbewezen).
 */

const AANGEMAAKT = new Date("2026-09-16T00:00:00.000Z");

function mappingRegel(overrides: Partial<PnLBronmappingRegel> = {}): PnLBronmappingRegel {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "8800",
    ogbKostensoort: null,
    economischeModule: "HUUR",
    economischeCategorie: "HUUROPBRENGST_BELAST",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

/** BEWEZEN 070-bronmapping (§3) — uitsluitend GL-defaults, zie moduledoc. */
const MAPPING_070: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "8800", economischeCategorie: "HUUROPBRENGST_BELAST" }),
  mappingRegel({ grootboekrekening: "8801", economischeCategorie: "HUUROPBRENGST_ONBELAST" }),
  mappingRegel({ grootboekrekening: "8805", economischeCategorie: "VERLEENDE_HUURKORTING" }),
];

function invoer(overrides: Partial<HuurCentraleMappingInvoer> = {}): HuurCentraleMappingInvoer {
  return { bedrijfsnr: "070", grootboekrekening: "8800", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date("2026-09-16T12:00:00.000Z"), ...overrides };
}

describe("resolveerHuurCategorieViaCentraleMapping — bewezen GL8800/GL8801/GL8805 (070)", () => {
  it("GL8800 -> HUUROPBRENGST_BELAST via GL-default", () => {
    expect(resolveerHuurCategorieViaCentraleMapping(invoer({ grootboekrekening: "8800" }), null, MAPPING_070)).toEqual({ categorie: "HUUROPBRENGST_BELAST", specificiteit: "GL_DEFAULT" });
  });

  it("GL8801 -> HUUROPBRENGST_ONBELAST via GL-default", () => {
    expect(resolveerHuurCategorieViaCentraleMapping(invoer({ grootboekrekening: "8801" }), null, MAPPING_070)).toEqual({ categorie: "HUUROPBRENGST_ONBELAST", specificiteit: "GL_DEFAULT" });
  });

  it("GL8805 -> VERLEENDE_HUURKORTING via GL-default", () => {
    expect(resolveerHuurCategorieViaCentraleMapping(invoer({ grootboekrekening: "8805" }), null, MAPPING_070)).toEqual({ categorie: "VERLEENDE_HUURKORTING", specificiteit: "GL_DEFAULT" });
  });

  it("elke GL resolveert via het GL-default ONGEACHT welke OGB-code aanwezig is (geen kunstmatige OGB-verfijning, §3)", () => {
    expect(resolveerHuurCategorieViaCentraleMapping(invoer({ grootboekrekening: "8800" }), "1234", MAPPING_070)).toEqual({ categorie: "HUUROPBRENGST_BELAST", specificiteit: "GL_DEFAULT" });
  });

  it("E. een fictieve, niet-gemapte GL -> NIET_GEMAPT", () => {
    expect(resolveerHuurCategorieViaCentraleMapping(invoer({ grootboekrekening: "9999" }), null, MAPPING_070)).toBeNull();
  });

  it("module-invariant blijft hard: een andere economischeModule op deze mapping faalt fail-fast", () => {
    const kapotteMapping: PnLBronmappingRegel[] = [mappingRegel({ economischeModule: "LEEGSTAND", economischeCategorie: "OVERIGE_LEEGSTANDSKOSTEN" })];
    expect(() => resolveerHuurCategorieViaCentraleMapping(invoer(), null, kapotteMapping)).toThrow(/niet "HUUR"/);
  });
});

describe("berekenWerkelijkHuurViaCentraleMapping — J. de gewirede 070-productieketen", () => {
  function ruweBoeking(overrides: Partial<HuurRuweBoekingRegel> = {}): HuurRuweBoekingRegel {
    return { grootboekrekening: "8800", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(0), ...overrides };
  }
  function keteninvoer(overrides: Partial<HuurWerkelijkViaCentraleMappingInvoer> = {}): HuurWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "070", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date("2026-09-16T12:00:00.000Z"), ...overrides };
  }

  it("A/B/C. belast, onbelast en huurkorting classificeren correct en strikt gescheiden (testfixture, zie moduledoc)", () => {
    const boekingen = [
      ruweBoeking({ grootboekrekening: "8800", saldo: new Decimal("-200000") }), // opbrengst: credit-normaal, ruw negatief
      ruweBoeking({ grootboekrekening: "8801", saldo: new Decimal("-50000") }),
      ruweBoeking({ grootboekrekening: "8805", saldo: new Decimal("3000") }), // korting: debitering, ruw positief
    ];
    const { werkelijk, nietGemapt } = berekenWerkelijkHuurViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "HUUROPBRENGST_BELAST")!.categorieTotaal.toString()).toBe("-200000");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "HUUROPBRENGST_ONBELAST")!.categorieTotaal.toString()).toBe("-50000");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "VERLEENDE_HUURKORTING")!.categorieTotaal.toString()).toBe("3000");
    expect(werkelijk.moduleTotaal.toString()).toBe("-247000");
  });

  it("E. een fictieve, niet-gemapte GL -> expliciet NIET_GEMAPT, niet in een van de drie categorieën gegokt", () => {
    const boekingen = [ruweBoeking({ grootboekrekening: "9999", saldo: new Decimal(500) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkHuurViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "9999", ogbKostensoort: null }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("500");
  });

  it("H. correctieboekingen behouden hun ruwe tekensemantiek (geen sign-flip in de calculator zelf)", () => {
    const boekingen = [
      ruweBoeking({ grootboekrekening: "8800", saldo: new Decimal("-200000") }),
      // Een creditnota/correctie op belaste huur wordt geboekt als een (tegengestelde) debitering —
      // ruw positief, exact zoals een reguliere korting-boeking; de calculator behandelt beide identiek.
      ruweBoeking({ grootboekrekening: "8800", saldo: new Decimal("1500") }),
    ];
    const { werkelijk } = berekenWerkelijkHuurViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "HUUROPBRENGST_BELAST")!.categorieTotaal.toString()).toBe("-198500");
  });

  it("I. geen dubbele telling: Belast + Onbelast + Korting + nietGeclassificeerd = alle aangeleverde boekingen, moduleTotaal telt niet nogmaals apart mee", () => {
    const boekingen = [
      ruweBoeking({ grootboekrekening: "8800", saldo: new Decimal(-200000) }),
      ruweBoeking({ grootboekrekening: "8801", saldo: new Decimal(-50000) }),
      ruweBoeking({ grootboekrekening: "8805", saldo: new Decimal(3000) }),
      ruweBoeking({ grootboekrekening: "9999", saldo: new Decimal(75) }),
    ];
    const { werkelijk } = berekenWerkelijkHuurViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);
    const somAlleBoekingen = boekingen.reduce((t, b) => t.plus(b.saldo), new Decimal(0));
    const somCategorieen = werkelijk.perCategorie.reduce((t, c) => t.plus(c.categorieTotaal), new Decimal(0));
    expect(somCategorieen.plus(werkelijk.nietGeclassificeerdTotaal).toString()).toBe(somAlleBoekingen.toString());
    expect(werkelijk.moduleTotaal.toString()).toBe(somCategorieen.toString());
  });

  it("Module1/Contracten/RentRoll voegen geen omzet toe: deze keten kent uitsluitend Boekingen-invoer, geen contract-/rentroll-veld bestaat op HuurRuweBoekingRegel", () => {
    const boeking: HuurRuweBoekingRegel = ruweBoeking({ grootboekrekening: "8800", saldo: new Decimal(-1000) });
    expect(Object.keys(boeking).sort()).toEqual(["grootboekrekening", "ogbKostensoort", "ogbKostensoortOmschrijving", "saldo"]);
  });
});

describe("K. synthetische TEST071-administratie — dezelfde calculator/adapter/engine, uitsluitend andere GL-mapping", () => {
  const MAPPING_TEST071: PnLBronmappingRegel[] = [
    mappingRegel({ bedrijfsnr: "TEST071", grootboekrekening: "8000", economischeCategorie: "HUUROPBRENGST_BELAST" }),
    mappingRegel({ bedrijfsnr: "TEST071", grootboekrekening: "8010", economischeCategorie: "HUUROPBRENGST_ONBELAST" }),
    mappingRegel({ bedrijfsnr: "TEST071", grootboekrekening: "8020", economischeCategorie: "VERLEENDE_HUURKORTING" }),
  ];

  it("exact dezelfde functies (resolveerHuurCategorieViaCentraleMapping/berekenWerkelijkHuurViaCentraleMapping) werken op TEST071's eigen GL-nummers zonder enige codewijziging", () => {
    expect(resolveerHuurCategorieViaCentraleMapping({ bedrijfsnr: "TEST071", grootboekrekening: "8000", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() }, null, MAPPING_TEST071)).toEqual(
      { categorie: "HUUROPBRENGST_BELAST", specificiteit: "GL_DEFAULT" },
    );

    const boekingen: HuurRuweBoekingRegel[] = [
      { grootboekrekening: "8000", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(-90000) },
      { grootboekrekening: "8010", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(-10000) },
      { grootboekrekening: "8020", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(500) },
    ];
    const { werkelijk, nietGemapt } = berekenWerkelijkHuurViaCentraleMapping({ bedrijfsnr: "TEST071", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() }, boekingen, MAPPING_TEST071);

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "HUUROPBRENGST_BELAST")!.categorieTotaal.toString()).toBe("-90000");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "HUUROPBRENGST_ONBELAST")!.categorieTotaal.toString()).toBe("-10000");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "VERLEENDE_HUURKORTING")!.categorieTotaal.toString()).toBe("500");
  });

  it("070's mapping en TEST071's mapping leven volledig los van elkaar (bedrijfsnr-gescheiden) — 070-GL-nummers resolveren niet toevallig mee voor TEST071 en andersom", () => {
    // GL8800 bestaat wél voor 070 (MAPPING_070) maar niet voor TEST071 (MAPPING_TEST071).
    expect(resolveerHuurCategorieViaCentraleMapping({ bedrijfsnr: "TEST071", grootboekrekening: "8800", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() }, null, MAPPING_TEST071)).toBeNull();
    // GL8000 bestaat wél voor TEST071 maar niet voor 070.
    expect(resolveerHuurCategorieViaCentraleMapping({ bedrijfsnr: "070", grootboekrekening: "8000", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() }, null, MAPPING_070)).toBeNull();
  });
});
