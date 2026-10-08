import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenWerkelijkBeheerViaCentraleMapping,
  resolveerBeheerCategorieViaCentraleMapping,
  type BeheerCentraleMappingInvoer,
  type BeheerRuweBoekingRegel,
  type BeheerWerkelijkViaCentraleMappingInvoer,
} from "./beheerCentraleMapping.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE GAT-002C (2026-09-16) — eerste Werkelijk-productieketen voor de
 * economische module BEHEER. Bronmapping: GL4000 → BEHEERKOSTEN, GL-default
 * (geen OGB-verfijning bewezen — zie `werkelijkBeheer.ts`-moduledoc).
 *
 * BRONPROEF (echte 070-cache, `rekeningactiviteit-4000-070-2026.json`):
 * Q1 2026 (t/m boekperiode 03): €1.979,17 + €1.148,41 = €3.127,58.
 * Q2 2026 (t/m boekperiode 06): €1.148,41 + €2.169,65 = €3.318,06.
 * H1-totaal: €6.445,64 — reconcilieert (afgerond) met de aangeleverde
 * H1-2026-rapportagecijfers (Q1 €3.128 / Q2 €3.318 / H1 €6.446).
 */

const AANGEMAAKT = new Date("2026-09-16T00:00:00.000Z");

function mappingRegel(overrides: Partial<PnLBronmappingRegel> = {}): PnLBronmappingRegel {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4000",
    ogbKostensoort: null,
    economischeModule: "BEHEER",
    economischeCategorie: "BEHEERKOSTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

/** BEWEZEN 070-bronmapping — uitsluitend GL-default, zie moduledoc. */
const MAPPING_070: PnLBronmappingRegel[] = [mappingRegel()];

function invoer(overrides: Partial<BeheerCentraleMappingInvoer> = {}): BeheerCentraleMappingInvoer {
  return { bedrijfsnr: "070", grootboekrekening: "4000", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date("2026-09-16T12:00:00.000Z"), ...overrides };
}

describe("resolveerBeheerCategorieViaCentraleMapping — bewezen GL4000 (070)", () => {
  it("GL4000 -> BEHEERKOSTEN via GL-default", () => {
    expect(resolveerBeheerCategorieViaCentraleMapping(invoer(), null, MAPPING_070)).toEqual({ categorie: "BEHEERKOSTEN", specificiteit: "GL_DEFAULT" });
  });

  it("resolveert via het GL-default ONGEACHT welke OGB-code aanwezig is (geen OGB-verfijning bewezen)", () => {
    expect(resolveerBeheerCategorieViaCentraleMapping(invoer(), "9999", MAPPING_070)).toEqual({ categorie: "BEHEERKOSTEN", specificiteit: "GL_DEFAULT" });
  });

  it("een fictieve, niet-gemapte GL -> NIET_GEMAPT", () => {
    expect(resolveerBeheerCategorieViaCentraleMapping(invoer({ grootboekrekening: "9999" }), null, MAPPING_070)).toBeNull();
  });

  it("module-invariant blijft hard: een andere economischeModule op deze mapping faalt fail-fast", () => {
    const kapotteMapping: PnLBronmappingRegel[] = [mappingRegel({ economischeModule: "HUUR", economischeCategorie: "HUUROPBRENGST_BELAST" })];
    expect(() => resolveerBeheerCategorieViaCentraleMapping(invoer(), null, kapotteMapping)).toThrow(/niet "BEHEER"/);
  });
});

describe("berekenWerkelijkBeheerViaCentraleMapping — de gewirede 070-productieketen en bronreconciliatie", () => {
  function ruweBoeking(overrides: Partial<BeheerRuweBoekingRegel> = {}): BeheerRuweBoekingRegel {
    return { grootboekrekening: "4000", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(0), ...overrides };
  }
  function keteninvoer(overrides: Partial<BeheerWerkelijkViaCentraleMappingInvoer> = {}): BeheerWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "070", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date("2026-09-16T12:00:00.000Z"), ...overrides };
  }

  it("gemapte beheerboekingen worden correct meegenomen en zijn ruw positief (kosten komen positief door)", () => {
    const boekingen = [ruweBoeking({ saldo: new Decimal("1979.17") }), ruweBoeking({ saldo: new Decimal("1148.41") })];
    const { werkelijk, nietGemapt } = berekenWerkelijkBeheerViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "BEHEERKOSTEN")!.categorieTotaal.toString()).toBe("3127.58");
    expect(werkelijk.moduleTotaal.toString()).toBe("3127.58");
  });

  it("H1-2026-bronreconciliatie: de vier echte boekingen uit rekeningactiviteit-4000-070-2026.json reconciliëren op Q1/Q2/H1", () => {
    const q1Boekingen = [ruweBoeking({ saldo: new Decimal("1979.17") }), ruweBoeking({ saldo: new Decimal("1148.41") })];
    const q2Boekingen = [ruweBoeking({ saldo: new Decimal("1148.41") }), ruweBoeking({ saldo: new Decimal("2169.65") })];

    const q1 = berekenWerkelijkBeheerViaCentraleMapping(keteninvoer({ boekperiode: "03" }), q1Boekingen, MAPPING_070).werkelijk;
    const q2 = berekenWerkelijkBeheerViaCentraleMapping(keteninvoer({ boekperiode: "06" }), q2Boekingen, MAPPING_070).werkelijk;
    const h1 = berekenWerkelijkBeheerViaCentraleMapping(keteninvoer({ boekperiode: "06" }), [...q1Boekingen, ...q2Boekingen], MAPPING_070).werkelijk;

    expect(q1.moduleTotaal.toDecimalPlaces(0).toString()).toBe("3128");
    expect(q2.moduleTotaal.toDecimalPlaces(0).toString()).toBe("3318");
    expect(h1.moduleTotaal.toDecimalPlaces(0).toString()).toBe("6446");
    expect(h1.moduleTotaal.toString()).toBe("6445.64");
  });

  it("niet-gemapte bedragen verdwijnen niet: een fictieve, niet-gemapte GL -> expliciet NIET_GEMAPT", () => {
    const boekingen = [ruweBoeking({ saldo: new Decimal("1979.17") }), ruweBoeking({ grootboekrekening: "9999", saldo: new Decimal(500) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkBeheerViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);

    expect(nietGemapt).toEqual([{ grootboekrekening: "9999", ogbKostensoort: null }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("500");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "BEHEERKOSTEN")!.categorieTotaal.toString()).toBe("1979.17"); // ongewijzigd, 9999 telt nergens mee
  });

  it("geen dubbele telling: BEHEERKOSTEN + nietGeclassificeerd = alle aangeleverde boekingen, moduleTotaal telt niet nogmaals apart mee", () => {
    const boekingen = [ruweBoeking({ saldo: new Decimal(1979.17) }), ruweBoeking({ saldo: new Decimal(1148.41) }), ruweBoeking({ grootboekrekening: "9999", saldo: new Decimal(75) })];
    const { werkelijk } = berekenWerkelijkBeheerViaCentraleMapping(keteninvoer(), boekingen, MAPPING_070);
    const somAlleBoekingen = boekingen.reduce((t, b) => t.plus(b.saldo), new Decimal(0));
    const somCategorieen = werkelijk.perCategorie.reduce((t, c) => t.plus(c.categorieTotaal), new Decimal(0));
    expect(somCategorieen.plus(werkelijk.nietGeclassificeerdTotaal).toString()).toBe(somAlleBoekingen.toString());
    expect(werkelijk.moduleTotaal.toString()).toBe(somCategorieen.toString());
  });

  it("geen koppeling met Module 2/Managementvergoeding: BeheerRuweBoekingRegel kent geen vergoedingspercentage/grondslag/management-veld", () => {
    const boeking: BeheerRuweBoekingRegel = ruweBoeking({ saldo: new Decimal(1000) });
    expect(Object.keys(boeking).sort()).toEqual(["grootboekrekening", "ogbKostensoort", "ogbKostensoortOmschrijving", "saldo"]);
  });
});
