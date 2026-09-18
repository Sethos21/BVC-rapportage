import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenWerkelijkVerzekeringenViaCentraleMapping,
  resolveerVerzekeringCategorieViaCentraleMapping,
  type VerzekeringCentraleMappingInvoer,
  type VerzekeringRuweBoekingRegel,
  type VerzekeringWerkelijkViaCentraleMappingInvoer,
} from "./verzekeringCentraleMapping.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE M7 — eerste Werkelijk-laag voor VERZEKERINGEN. Bronmapping: GL4130
 * "Verzekering" + OGB4131 "Brand-/opstalverzekering" (aangeleverd in de
 * M7-opdracht, GEEN eigen bronproef-eurobedrag beschikbaar in de repo — zie
 * `verzekeringCentraleMapping.ts`'s moduledoc). Testbedragen hieronder zijn
 * daarom EXPLICIET TESTFIXTURES, geen bewezen bronbedrag — de classificatie
 * (welke GL/OGB → welke categorie) is wél het aangeleverde bronfeit.
 */

const AANGEMAAKT = new Date("2026-09-15T00:00:00.000Z");

function mappingRegel(overrides: Partial<PnLBronmappingRegel> = {}): PnLBronmappingRegel {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4130",
    ogbKostensoort: "4131",
    economischeModule: "VERZEKERINGEN",
    economischeCategorie: "BRAND_OPSTALVERZEKERING",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

/** BEWEZEN bronmapping — uitsluitend GL4130/OGB4131, GEEN GL-default (zie moduledoc). */
const MAPPING_070: PnLBronmappingRegel[] = [mappingRegel()];

function invoer(overrides: Partial<VerzekeringCentraleMappingInvoer> = {}): VerzekeringCentraleMappingInvoer {
  return { bedrijfsnr: "070", grootboekrekening: "4130", boekjaar: 2026, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z"), ...overrides };
}

describe("resolveerVerzekeringCategorieViaCentraleMapping — bewezen GL4130/OGB4131", () => {
  it("GL4130 + OGB4131 resolveert naar BRAND_OPSTALVERZEKERING", () => {
    expect(resolveerVerzekeringCategorieViaCentraleMapping(invoer(), "4131", MAPPING_070)).toEqual({ categorie: "BRAND_OPSTALVERZEKERING", specificiteit: "GL_OGB" });
  });

  it("onbekende OGB-code op GL4130 (geen GL-default) -> NIET_GEMAPT", () => {
    expect(resolveerVerzekeringCategorieViaCentraleMapping(invoer(), "9999", MAPPING_070)).toBeNull();
  });

  it("boeking zonder OGB-kostensoort (null) op GL4130 -> NIET_GEMAPT (geen GL-default bewezen)", () => {
    expect(resolveerVerzekeringCategorieViaCentraleMapping(invoer(), null, MAPPING_070)).toBeNull();
  });

  it("module-invariant blijft hard: een andere economischeModule op deze mapping faalt fail-fast", () => {
    const kapotteMapping: PnLBronmappingRegel[] = [mappingRegel({ economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" })];
    expect(() => resolveerVerzekeringCategorieViaCentraleMapping(invoer(), "4131", kapotteMapping)).toThrow(/niet "VERZEKERINGEN"/);
  });
});

describe("berekenWerkelijkVerzekeringenViaCentraleMapping — de gewirede productieketen", () => {
  function ruweBoeking(overrides: Partial<VerzekeringRuweBoekingRegel> = {}): VerzekeringRuweBoekingRegel {
    return { grootboekrekening: "4130", ogbKostensoort: "4131", ogbKostensoortOmschrijving: "Brand-/opstalverzekering", complexnummer: "003", saldo: new Decimal(0), ...overrides };
  }
  function keteninvoer(overrides: Partial<VerzekeringWerkelijkViaCentraleMappingInvoer> = {}): VerzekeringWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "070", boekjaar: 2026, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z"), ...overrides };
  }

  it("GL4130/OGB4131-boekingen classificeren correct en tellen op tot het moduleTotaal (testfixture, zie moduledoc)", () => {
    const boekingen = [ruweBoeking({ saldo: new Decimal("1250.50") }), ruweBoeking({ saldo: new Decimal("890.25") })];
    const { werkelijk, nietGemapt } = berekenWerkelijkVerzekeringenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "BRAND_OPSTALVERZEKERING")!.categorieTotaal.toString()).toBe("2140.75");
    expect(werkelijk.moduleTotaal.toString()).toBe("2140.75");
    expect(werkelijk.nietGeclassificeerdAantalBoekingen).toBe(0);
  });

  it("onbekende OGB-code op GL4130 -> expliciet NIET_GEMAPT, niet geraden, niet meegeteld", () => {
    const boekingen = [ruweBoeking({ saldo: new Decimal(1000) }), ruweBoeking({ ogbKostensoort: "9999", ogbKostensoortOmschrijving: "onbekend", saldo: new Decimal(500) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkVerzekeringenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "4130", ogbKostensoort: "9999" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("500");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "BRAND_OPSTALVERZEKERING")!.categorieTotaal.toString()).toBe("1000");
  });

  it("boeking zonder OGB-kostensoort (null) -> expliciet NIET_GEMAPT, geen GL-default toegepast", () => {
    const boekingen = [ruweBoeking({ ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(250) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkVerzekeringenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "4130", ogbKostensoort: null }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("250");
  });

  it("GL wordt nooit uit OGB afgeleid: OGB4131 op een fictieve, niet-gemapte GL blijft NIET_GEMAPT", () => {
    const boekingen = [ruweBoeking({ grootboekrekening: "9999", saldo: new Decimal(777) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkVerzekeringenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "9999", ogbKostensoort: "4131" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("777");
  });

  it("geen vrije tekst: een misleidende ogbKostensoortOmschrijving verandert de categorie niet — uitsluitend de OGB-code/mapping bepaalt", () => {
    const boekingen = [ruweBoeking({ ogbKostensoortOmschrijving: "Aansprakelijkheidsverzekering (foutieve omschrijving)", saldo: new Decimal(400) })];
    const { werkelijk } = berekenWerkelijkVerzekeringenViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "BRAND_OPSTALVERZEKERING")!.categorieTotaal.toString()).toBe("400");
  });

  it("persistence → resolver → calculator (in-memory bewijs, echte SQLite-proof staat in @bvc/begroting-data): mapping teruggelezen als platte array werkt identiek", () => {
    // Simuleert het teruglezen van de mapping uit de repository (readonly array van PnLBronmappingRegel,
    // exact het contract dat leesPnLBronmappingRegels teruggeeft) — geen enkele extra bewerking nodig.
    const teruggelezenMapping: readonly PnLBronmappingRegel[] = [...MAPPING_070];
    const { werkelijk } = berekenWerkelijkVerzekeringenViaCentraleMapping(keteninvoer(), [ruweBoeking({ saldo: new Decimal(123.45) })], teruggelezenMapping);
    expect(werkelijk.moduleTotaal.toString()).toBe("123.45");
  });
});
