import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenWerkelijkManagementViaCentraleMapping,
  resolveerManagementCategorieViaCentraleMapping,
  type ManagementCentraleMappingInvoer,
  type ManagementRuweBoekingRegel,
  type ManagementWerkelijkViaCentraleMappingInvoer,
} from "./managementCentraleMapping.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE GAT-002D (2026-09-16) — eerste Werkelijk-productieketen voor de
 * economische module MANAGEMENT. Bronmapping: GL04001 → MANAGEMENTVERGOEDING,
 * GL-default (geen OGB-verfijning bewezen ondanks aanwezige OGB 4003 — zie
 * `werkelijkManagement.ts`-moduledoc).
 *
 * BRONPROEF (echte 023_Malcon_Beheer_BV-cache,
 * `rekeningactiviteit-04001-023-2026.json`, herbevestigd tegen Informant):
 * januari €27.533,77 + €1.104,81 = €28.638,58; februari t/m juni ieder
 * €28.638,58; H1-totaal (periode 01-06) = €171.831,48 — reconcilieert exact.
 */

const AANGEMAAKT = new Date("2026-09-16T00:00:00.000Z");

function mappingRegel(overrides: Partial<PnLBronmappingRegel> = {}): PnLBronmappingRegel {
  return {
    bedrijfsnr: "023",
    grootboekrekening: "04001",
    ogbKostensoort: null,
    economischeModule: "MANAGEMENT",
    economischeCategorie: "MANAGEMENTVERGOEDING",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

/** BEWEZEN 023-bronmapping — uitsluitend GL-default, zie moduledoc. */
const MAPPING_023: PnLBronmappingRegel[] = [mappingRegel()];

function invoer(overrides: Partial<ManagementCentraleMappingInvoer> = {}): ManagementCentraleMappingInvoer {
  return { bedrijfsnr: "023", grootboekrekening: "04001", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date("2026-09-16T12:00:00.000Z"), ...overrides };
}

describe("resolveerManagementCategorieViaCentraleMapping — bewezen GL04001 (023)", () => {
  it("GL04001 -> MANAGEMENTVERGOEDING via GL-default", () => {
    expect(resolveerManagementCategorieViaCentraleMapping(invoer(), null, MAPPING_023)).toEqual({ categorie: "MANAGEMENTVERGOEDING", specificiteit: "GL_DEFAULT" });
  });

  it("resolveert via het GL-default ONGEACHT welke OGB-code aanwezig is (OGB 4003 bewijst geen tweede categorie, geen kunstmatige verfijning)", () => {
    expect(resolveerManagementCategorieViaCentraleMapping(invoer(), "4003", MAPPING_023)).toEqual({ categorie: "MANAGEMENTVERGOEDING", specificiteit: "GL_DEFAULT" });
  });

  it("een fictieve, niet-gemapte GL -> NIET_GEMAPT", () => {
    expect(resolveerManagementCategorieViaCentraleMapping(invoer({ grootboekrekening: "99999" }), null, MAPPING_023)).toBeNull();
  });

  it("module-invariant blijft hard: een andere economischeModule op deze mapping faalt fail-fast", () => {
    const kapotteMapping: PnLBronmappingRegel[] = [mappingRegel({ economischeModule: "BEHEER", economischeCategorie: "BEHEERKOSTEN" })];
    expect(() => resolveerManagementCategorieViaCentraleMapping(invoer(), null, kapotteMapping)).toThrow(/niet "MANAGEMENT"/);
  });
});

describe("berekenWerkelijkManagementViaCentraleMapping — de gewirede 023-productieketen en H1-bronreconciliatie", () => {
  function ruweBoeking(overrides: Partial<ManagementRuweBoekingRegel> = {}): ManagementRuweBoekingRegel {
    return { grootboekrekening: "04001", ogbKostensoort: "4003", ogbKostensoortOmschrijving: "Management fee", saldo: new Decimal(0), ...overrides };
  }
  function keteninvoer(overrides: Partial<ManagementWerkelijkViaCentraleMappingInvoer> = {}): ManagementWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "023", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date("2026-09-16T12:00:00.000Z"), ...overrides };
  }

  it("de acht echte H1-2026-boekingen (regulier én de afwijkende indexatie-correctieboeking) reconciliëren exact op €171.831,48", () => {
    const boekingen: ManagementRuweBoekingRegel[] = [
      ruweBoeking({ saldo: new Decimal("27533.77") }), // januari, regulier
      ruweBoeking({ saldo: new Decimal("1104.81") }), // januari, afwijkende indexatie-correctieboeking
      ruweBoeking({ saldo: new Decimal("28638.58") }), // februari
      ruweBoeking({ saldo: new Decimal("28638.58") }), // maart
      ruweBoeking({ saldo: new Decimal("28638.58") }), // april
      ruweBoeking({ saldo: new Decimal("28638.58") }), // mei
      ruweBoeking({ saldo: new Decimal("28638.58") }), // juni
    ];
    const { werkelijk, nietGemapt } = berekenWerkelijkManagementViaCentraleMapping(keteninvoer(), boekingen, MAPPING_023);

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "MANAGEMENTVERGOEDING")!.categorieTotaal.toString()).toBe("171831.48");
    expect(werkelijk.moduleTotaal.toString()).toBe("171831.48");
  });

  it("afwijkende/correctieboekingen worden als echte boekingen meegenomen (geen aparte, uitgesloten 'correctie'-tak)", () => {
    const regulier = ruweBoeking({ saldo: new Decimal("27533.77") });
    const correctie = ruweBoeking({ saldo: new Decimal("1104.81") });
    const { werkelijk } = berekenWerkelijkManagementViaCentraleMapping(keteninvoer(), [regulier, correctie], MAPPING_023);
    expect(werkelijk.moduleTotaal.toString()).toBe("28638.58");
  });

  it("niet-gemapte bedragen verdwijnen niet: een fictieve, niet-gemapte GL -> expliciet NIET_GEMAPT", () => {
    const boekingen = [ruweBoeking({ saldo: new Decimal("27533.77") }), ruweBoeking({ grootboekrekening: "99999", saldo: new Decimal(500) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkManagementViaCentraleMapping(keteninvoer(), boekingen, MAPPING_023);

    expect(nietGemapt).toEqual([{ grootboekrekening: "99999", ogbKostensoort: "4003" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("500");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "MANAGEMENTVERGOEDING")!.categorieTotaal.toString()).toBe("27533.77"); // ongewijzigd
  });

  it("geen dubbele telling: MANAGEMENTVERGOEDING + nietGeclassificeerd = alle aangeleverde boekingen, moduleTotaal telt niet nogmaals apart mee", () => {
    const boekingen = [ruweBoeking({ saldo: new Decimal(27533.77) }), ruweBoeking({ saldo: new Decimal(1104.81) }), ruweBoeking({ grootboekrekening: "99999", saldo: new Decimal(75) })];
    const { werkelijk } = berekenWerkelijkManagementViaCentraleMapping(keteninvoer(), boekingen, MAPPING_023);
    const somAlleBoekingen = boekingen.reduce((t, b) => t.plus(b.saldo), new Decimal(0));
    const somCategorieen = werkelijk.perCategorie.reduce((t, c) => t.plus(c.categorieTotaal), new Decimal(0));
    expect(somCategorieen.plus(werkelijk.nietGeclassificeerdTotaal).toString()).toBe(somAlleBoekingen.toString());
    expect(werkelijk.moduleTotaal.toString()).toBe(somCategorieen.toString());
  });

  it("geen koppeling met de Managementvergoeding-Begroting: ManagementRuweBoekingRegel kent geen vergoedingspercentage/grondslag/relatieveld", () => {
    const boeking: ManagementRuweBoekingRegel = ruweBoeking({ saldo: new Decimal(1000) });
    expect(Object.keys(boeking).sort()).toEqual(["grootboekrekening", "ogbKostensoort", "ogbKostensoortOmschrijving", "saldo"]);
  });
});
