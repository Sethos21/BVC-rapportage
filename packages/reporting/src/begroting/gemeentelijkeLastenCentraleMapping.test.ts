import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenWerkelijkGemeentelijkeLastenViaCentraleMapping,
  resolveerGemeentelijkeLastenCategorieViaCentraleMapping,
  type GemeentelijkeLastenCentraleMappingInvoer,
  type GemeentelijkeLastenRuweBoekingRegel,
  type GemeentelijkeLastenWerkelijkViaCentraleMappingInvoer,
} from "./gemeentelijkeLastenCentraleMapping.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE M7 — eerste Werkelijk-laag voor GEMEENTELIJKE LASTEN. Bronmapping:
 * GL4700 "WOZ / OZB" + OGB4701 "OZB" (GL+OGB-specifiek) EN GL4710
 * "Gemeentelijke heffingen" (GL-default) — beide aangeleverd in de
 * M7-opdracht, GEEN eigen bronproef-eurobedrag beschikbaar (zie
 * `gemeentelijkeLastenCentraleMapping.ts`'s moduledoc). Testbedragen zijn
 * expliciete testfixtures, de classificatie zelf is het bronfeit.
 */

const AANGEMAAKT = new Date("2026-09-15T00:00:00.000Z");

function mappingRegel(overrides: Partial<PnLBronmappingRegel> = {}): PnLBronmappingRegel {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4700",
    ogbKostensoort: "4701",
    economischeModule: "GEMEENTELIJKE_LASTEN",
    economischeCategorie: "GEMEENTELIJKE_LASTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

/** BEWEZEN bronmapping: GL4700/OGB4701 (GL_OGB-specifiek) + GL4710 (GL-default). GEEN GL4700-default (niet bewezen). */
const MAPPING_070: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "4700", ogbKostensoort: "4701" }),
  mappingRegel({ grootboekrekening: "4710", ogbKostensoort: null }),
];

function invoer(overrides: Partial<GemeentelijkeLastenCentraleMappingInvoer> = {}): GemeentelijkeLastenCentraleMappingInvoer {
  return { bedrijfsnr: "070", grootboekrekening: "4700", boekjaar: 2026, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z"), ...overrides };
}

describe("resolveerGemeentelijkeLastenCategorieViaCentraleMapping — bewezen GL4700/OGB4701 en GL4710-default", () => {
  it("GL4700 + OGB4701 resolveert naar GEMEENTELIJKE_LASTEN (GL_OGB)", () => {
    expect(resolveerGemeentelijkeLastenCategorieViaCentraleMapping(invoer({ grootboekrekening: "4700" }), "4701", MAPPING_070)).toEqual({ categorie: "GEMEENTELIJKE_LASTEN", specificiteit: "GL_OGB" });
  });

  it("GL4710 zonder OGB resolveert naar GEMEENTELIJKE_LASTEN via GL-default", () => {
    expect(resolveerGemeentelijkeLastenCategorieViaCentraleMapping(invoer({ grootboekrekening: "4710" }), null, MAPPING_070)).toEqual({ categorie: "GEMEENTELIJKE_LASTEN", specificiteit: "GL_DEFAULT" });
  });

  it("GL4710 met een willekeurige OGB-code resolveert ook via het GL-default (geen specifieke OGB-verfijning bewezen)", () => {
    expect(resolveerGemeentelijkeLastenCategorieViaCentraleMapping(invoer({ grootboekrekening: "4710" }), "1234", MAPPING_070)).toEqual({ categorie: "GEMEENTELIJKE_LASTEN", specificiteit: "GL_DEFAULT" });
  });

  it("GL4700 zonder OGB4701 (geen GL-default bewezen voor GL4700) -> NIET_GEMAPT", () => {
    expect(resolveerGemeentelijkeLastenCategorieViaCentraleMapping(invoer({ grootboekrekening: "4700" }), null, MAPPING_070)).toBeNull();
  });

  it("onbekende OGB-code op GL4700 -> NIET_GEMAPT", () => {
    expect(resolveerGemeentelijkeLastenCategorieViaCentraleMapping(invoer({ grootboekrekening: "4700" }), "9999", MAPPING_070)).toBeNull();
  });

  it("module-invariant blijft hard: een andere economischeModule op deze mapping faalt fail-fast", () => {
    const kapotteMapping: PnLBronmappingRegel[] = [mappingRegel({ economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "OVERIGE_ALGEMENE_KOSTEN" })];
    expect(() => resolveerGemeentelijkeLastenCategorieViaCentraleMapping(invoer(), "4701", kapotteMapping)).toThrow(/niet "GEMEENTELIJKE_LASTEN"/);
  });
});

describe("berekenWerkelijkGemeentelijkeLastenViaCentraleMapping — de gewirede productieketen", () => {
  function ruweBoeking(overrides: Partial<GemeentelijkeLastenRuweBoekingRegel> = {}): GemeentelijkeLastenRuweBoekingRegel {
    return { grootboekrekening: "4700", ogbKostensoort: "4701", ogbKostensoortOmschrijving: "OZB", complexnummer: "003", saldo: new Decimal(0), ...overrides };
  }
  function keteninvoer(overrides: Partial<GemeentelijkeLastenWerkelijkViaCentraleMappingInvoer> = {}): GemeentelijkeLastenWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "070", boekjaar: 2026, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z"), ...overrides };
  }

  it("boekingen van GL4700/OGB4701 EN GL4710 (default) tellen op tot ÉÉN categorieTotaal — geen fictieve OZB/heffingen-splitsing (testfixture, zie moduledoc)", () => {
    const boekingen = [
      ruweBoeking({ grootboekrekening: "4700", ogbKostensoort: "4701", saldo: new Decimal("1850.75") }),
      ruweBoeking({ grootboekrekening: "4710", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal("420.25") }),
    ];
    const { werkelijk, nietGemapt } = berekenWerkelijkGemeentelijkeLastenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie).toHaveLength(1);
    expect(werkelijk.perCategorie[0]!.categorieTotaal.toString()).toBe("2271");
    expect(werkelijk.moduleTotaal.toString()).toBe("2271");
  });

  it("GL4700 zonder OGB4701 (geen GL-default) -> expliciet NIET_GEMAPT, niet stil in het GL4710-default gestopt", () => {
    const boekingen = [ruweBoeking({ grootboekrekening: "4700", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(500) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkGemeentelijkeLastenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "4700", ogbKostensoort: null }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("500");
  });

  it("onbekende OGB-code op GL4700 -> expliciet NIET_GEMAPT", () => {
    const boekingen = [ruweBoeking({ ogbKostensoort: "9999", ogbKostensoortOmschrijving: "onbekend", saldo: new Decimal(300) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkGemeentelijkeLastenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "4700", ogbKostensoort: "9999" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("300");
  });

  it("GL wordt nooit uit OGB afgeleid: OGB4701 op een fictieve, niet-gemapte GL blijft NIET_GEMAPT", () => {
    const boekingen = [ruweBoeking({ grootboekrekening: "9999", saldo: new Decimal(777) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkGemeentelijkeLastenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "9999", ogbKostensoort: "4701" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("777");
  });

  it("geen dubbele telling: som(categorieën) + nietGeclassificeerd = alle aangeleverde boekingen", () => {
    const boekingen = [
      ruweBoeking({ grootboekrekening: "4700", ogbKostensoort: "4701", saldo: new Decimal(1000) }),
      ruweBoeking({ grootboekrekening: "4710", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(500) }),
      ruweBoeking({ grootboekrekening: "4700", ogbKostensoort: "9999", ogbKostensoortOmschrijving: "onbekend", saldo: new Decimal(200) }),
    ];
    const { werkelijk } = berekenWerkelijkGemeentelijkeLastenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);
    const somAlleBoekingen = boekingen.reduce((t, b) => t.plus(b.saldo), new Decimal(0));
    const somCategorieen = werkelijk.perCategorie.reduce((t, c) => t.plus(c.categorieTotaal), new Decimal(0));
    expect(somCategorieen.plus(werkelijk.nietGeclassificeerdTotaal).toString()).toBe(somAlleBoekingen.toString());
  });
});
