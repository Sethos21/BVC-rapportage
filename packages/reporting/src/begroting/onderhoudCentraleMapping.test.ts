import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenWerkelijkOnderhoudViaCentraleMapping,
  resolveerOnderhoudCategorieViaCentraleMapping,
  type OnderhoudCentraleMappingInvoer,
  type OnderhoudRuweBoekingRegel,
  type OnderhoudWerkelijkViaCentraleMappingInvoer,
} from "./onderhoudCentraleMapping.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE M7 — eerste Werkelijk-laag voor de economische module ONDERHOUD.
 * Bronmapping: GL4300 → Onderhoud gebouwen, GL4330 → Onderhoud terrein,
 * GL4340 → Onderhoud installaties (alle drie GL-defaults, aangeleverd in de
 * M7-opdracht, GEEN eigen bronproef-eurobedrag beschikbaar — zie
 * `onderhoudCentraleMapping.ts`'s moduledoc). Testbedragen zijn expliciete
 * testfixtures, de classificatie zelf is het bronfeit.
 */

const AANGEMAAKT = new Date("2026-09-15T00:00:00.000Z");

function mappingRegel(overrides: Partial<PnLBronmappingRegel> = {}): PnLBronmappingRegel {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4300",
    ogbKostensoort: null,
    economischeModule: "ONDERHOUD",
    economischeCategorie: "ONDERHOUD_GEBOUWEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

/** BEWEZEN bronmapping — alle drie uitsluitend GL-defaults, geen OGB-verfijning bewezen. */
const MAPPING_070: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "4300", economischeCategorie: "ONDERHOUD_GEBOUWEN" }),
  mappingRegel({ grootboekrekening: "4330", economischeCategorie: "ONDERHOUD_TERREIN" }),
  mappingRegel({ grootboekrekening: "4340", economischeCategorie: "ONDERHOUD_INSTALLATIES" }),
];

function invoer(overrides: Partial<OnderhoudCentraleMappingInvoer> = {}): OnderhoudCentraleMappingInvoer {
  return { bedrijfsnr: "070", grootboekrekening: "4300", boekjaar: 2026, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z"), ...overrides };
}

describe("resolveerOnderhoudCategorieViaCentraleMapping — bewezen GL4300/GL4330/GL4340", () => {
  it("GL4300 -> ONDERHOUD_GEBOUWEN via GL-default", () => {
    expect(resolveerOnderhoudCategorieViaCentraleMapping(invoer({ grootboekrekening: "4300" }), null, MAPPING_070)).toEqual({ categorie: "ONDERHOUD_GEBOUWEN", specificiteit: "GL_DEFAULT" });
  });

  it("GL4330 -> ONDERHOUD_TERREIN via GL-default", () => {
    expect(resolveerOnderhoudCategorieViaCentraleMapping(invoer({ grootboekrekening: "4330" }), null, MAPPING_070)).toEqual({ categorie: "ONDERHOUD_TERREIN", specificiteit: "GL_DEFAULT" });
  });

  it("GL4340 -> ONDERHOUD_INSTALLATIES via GL-default", () => {
    expect(resolveerOnderhoudCategorieViaCentraleMapping(invoer({ grootboekrekening: "4340" }), null, MAPPING_070)).toEqual({ categorie: "ONDERHOUD_INSTALLATIES", specificiteit: "GL_DEFAULT" });
  });

  it("elke GL resolveert via het GL-default ONGEACHT welke OGB-code aanwezig is (geen OGB-verfijning bewezen)", () => {
    expect(resolveerOnderhoudCategorieViaCentraleMapping(invoer({ grootboekrekening: "4300" }), "1234", MAPPING_070)).toEqual({ categorie: "ONDERHOUD_GEBOUWEN", specificiteit: "GL_DEFAULT" });
  });

  it("een fictieve, niet-gemapte GL -> NIET_GEMAPT", () => {
    expect(resolveerOnderhoudCategorieViaCentraleMapping(invoer({ grootboekrekening: "9999" }), null, MAPPING_070)).toBeNull();
  });

  it("module-invariant blijft hard: een andere economischeModule op deze mapping faalt fail-fast", () => {
    const kapotteMapping: PnLBronmappingRegel[] = [mappingRegel({ economischeModule: "LEEGSTAND", economischeCategorie: "OVERIGE_LEEGSTANDSKOSTEN" })];
    expect(() => resolveerOnderhoudCategorieViaCentraleMapping(invoer(), null, kapotteMapping)).toThrow(/niet "ONDERHOUD"/);
  });
});

describe("berekenWerkelijkOnderhoudViaCentraleMapping — de gewirede productieketen", () => {
  function ruweBoeking(overrides: Partial<OnderhoudRuweBoekingRegel> = {}): OnderhoudRuweBoekingRegel {
    return { grootboekrekening: "4300", ogbKostensoort: null, ogbKostensoortOmschrijving: null, complexnummer: "003", saldo: new Decimal(0), ...overrides };
  }
  function keteninvoer(overrides: Partial<OnderhoudWerkelijkViaCentraleMappingInvoer> = {}): OnderhoudWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "070", boekjaar: 2026, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z"), ...overrides };
  }

  it("boekingen op de drie bewezen GL's classificeren correct naar hun eigen categorie, strikt gescheiden (testfixture, zie moduledoc)", () => {
    const boekingen = [
      ruweBoeking({ grootboekrekening: "4300", saldo: new Decimal("1200.50") }),
      ruweBoeking({ grootboekrekening: "4330", saldo: new Decimal("340.10") }),
      ruweBoeking({ grootboekrekening: "4340", saldo: new Decimal("890.00") }),
    ];
    const { werkelijk, nietGemapt } = berekenWerkelijkOnderhoudViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_GEBOUWEN")!.categorieTotaal.toString()).toBe("1200.5");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_TERREIN")!.categorieTotaal.toString()).toBe("340.1");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_INSTALLATIES")!.categorieTotaal.toString()).toBe("890");
    expect(werkelijk.moduleTotaal.toString()).toBe("2430.6");
  });

  it("een fictieve, niet-gemapte GL -> expliciet NIET_GEMAPT, niet in een van de drie categorieën gegokt", () => {
    const boekingen = [ruweBoeking({ grootboekrekening: "9999", saldo: new Decimal(500) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkOnderhoudViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "9999", ogbKostensoort: null }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("500");
  });

  it("GEEN AUTOMATISCHE GEPLAND/CORRECTIEF-CLASSIFICATIE: een misleidende ogbKostensoortOmschrijving die 'gepland'/'correctief' suggereert verandert de categorie niet", () => {
    const boekingen = [
      ruweBoeking({ grootboekrekening: "4300", ogbKostensoort: "1", ogbKostensoortOmschrijving: "Correctief dagelijks onderhoud dak", saldo: new Decimal(1000) }),
      ruweBoeking({ grootboekrekening: "4300", ogbKostensoort: "2", ogbKostensoortOmschrijving: "MJOP gepland groot onderhoud", saldo: new Decimal(2000) }),
    ];
    const { werkelijk } = berekenWerkelijkOnderhoudViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);
    // Beide boekingen blijven ONDERHOUD_GEBOUWEN (via het GL4300-default) — de omschrijving beïnvloedt niets,
    // en er bestaat geen "gepland"/"correctief"-categorie in dit resultaat om per ongeluk naartoe te routeren.
    expect(werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_GEBOUWEN")!.categorieTotaal.toString()).toBe("3000");
    expect(werkelijk.perCategorie.every((c) => c.categorie !== ("GEPLAND" as never) && c.categorie !== ("CORRECTIEF" as never))).toBe(true);
  });

  it("geen dubbele telling: Gebouwen + Terrein + Installaties + nietGeclassificeerd = alle aangeleverde boekingen, en moduleTotaal telt niet nogmaals apart mee", () => {
    const boekingen = [
      ruweBoeking({ grootboekrekening: "4300", saldo: new Decimal(1000) }),
      ruweBoeking({ grootboekrekening: "4330", saldo: new Decimal(500) }),
      ruweBoeking({ grootboekrekening: "4340", saldo: new Decimal(250) }),
      ruweBoeking({ grootboekrekening: "9999", saldo: new Decimal(75) }),
    ];
    const { werkelijk } = berekenWerkelijkOnderhoudViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);
    const somAlleBoekingen = boekingen.reduce((t, b) => t.plus(b.saldo), new Decimal(0));
    const somCategorieen = werkelijk.perCategorie.reduce((t, c) => t.plus(c.categorieTotaal), new Decimal(0));
    expect(somCategorieen.plus(werkelijk.nietGeclassificeerdTotaal).toString()).toBe(somAlleBoekingen.toString());
    expect(werkelijk.moduleTotaal.toString()).toBe(somCategorieen.toString());
  });
});
