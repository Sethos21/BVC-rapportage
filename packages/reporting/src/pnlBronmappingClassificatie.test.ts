import { describe, expect, it } from "vitest";
import { classificeerBoekingenViaPnLMapping, type PnLRuweBoekingBasis } from "./pnlBronmappingClassificatie.js";
import type { PnLBronmappingRegel } from "./pnlBronmapping.js";

/**
 * FASE M6 — dekkingsproef voor de generieke consolidatiehelper. Rente/
 * Leegstand bewijzen de ECONOMISCHE pariteit al (`renteCentraleMapping.test.ts`/
 * `leegstandCentraleMapping.test.ts`, ongewijzigd groen na deze consolidatie);
 * dit bestand test uitsluitend het TECHNISCHE gedrag van de helper zelf, los
 * van enige module.
 */

interface TestBoeking extends PnLRuweBoekingBasis {
  saldo: number;
}

function boeking(overrides: Partial<TestBoeking> = {}): TestBoeking {
  return { grootboekrekening: "1000", ogbKostensoort: "AAA", ogbKostensoortOmschrijving: "test", saldo: 0, ...overrides };
}

const CONTEXT = { bedrijfsnr: "070", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z") };

describe("classificeerBoekingenViaPnLMapping", () => {
  it("dedupliceert boekingen op (grootboekrekening, ogbKostensoort) — de resolver wordt per unieke combinatie precies één keer aangeroepen", () => {
    let aanroepen = 0;
    const resolveer = (): { categorie: "X"; specificiteit: "GL_OGB" } | null => {
      aanroepen += 1;
      return { categorie: "X", specificiteit: "GL_OGB" };
    };
    const boekingen = [boeking({ saldo: 1 }), boeking({ saldo: 2 }), boeking({ saldo: 3 })]; // alle drie dezelfde (GL, OGB)-combinatie
    classificeerBoekingenViaPnLMapping(CONTEXT, boekingen, [], resolveer);
    expect(aanroepen).toBe(1);
  });

  it("geeft de succesvol geresolvede categorie + omschrijving terug, gesleuteld op OGB-kostensoort", () => {
    const resolveer = (): { categorie: "MAKELAARSKOSTEN"; specificiteit: "GL_OGB" } => ({ categorie: "MAKELAARSKOSTEN", specificiteit: "GL_OGB" });
    const { perOgb, nietGemapt } = classificeerBoekingenViaPnLMapping(CONTEXT, [boeking({ ogbKostensoort: "4992", ogbKostensoortOmschrijving: "Makelaarskosten" })], [], resolveer);
    expect(nietGemapt).toEqual([]);
    expect(perOgb.get("4992")).toEqual({ categorie: "MAKELAARSKOSTEN", ogbKostensoortOmschrijving: "Makelaarskosten" });
  });

  it("een resolver die null teruggeeft (NIET_GEMAPT) belandt in nietGemapt, nooit in perOgb", () => {
    const resolveer = (): null => null;
    const { perOgb, nietGemapt } = classificeerBoekingenViaPnLMapping(CONTEXT, [boeking({ grootboekrekening: "9999", ogbKostensoort: "9999" })], [], resolveer);
    expect(perOgb.size).toBe(0);
    expect(nietGemapt).toEqual([{ grootboekrekening: "9999", ogbKostensoort: "9999" }]);
  });

  it("een boeking zonder OGB-kostensoort (null) wordt WEL aan de resolver aangeboden (geen kortsluiting) — resolveert de resolver naar null, dan NIET_GEMAPT", () => {
    let ontvangenOgb: string | null = "niet aangeroepen";
    const resolveer = (_invoer: unknown, ogbKostensoort: string | null): null => {
      ontvangenOgb = ogbKostensoort;
      return null;
    };
    const { nietGemapt } = classificeerBoekingenViaPnLMapping(CONTEXT, [boeking({ ogbKostensoort: null, ogbKostensoortOmschrijving: null })], [], resolveer);
    expect(ontvangenOgb).toBeNull(); // de resolver IS aangeroepen, met null — geen hardcoded kortsluiting in de helper zelf
    expect(nietGemapt).toEqual([{ grootboekrekening: "1000", ogbKostensoort: null }]);
  });

  it("geeft de aangeleverde context (bedrijfsnr/boekjaar/boekperiode/opSysteemtijdstip) exact door aan de resolver, per boeking de eigen grootboekrekening", () => {
    const ontvangen: unknown[] = [];
    const resolveer = (invoer: unknown): { categorie: "X"; specificiteit: "GL_OGB" } => {
      ontvangen.push(invoer);
      return { categorie: "X", specificiteit: "GL_OGB" };
    };
    classificeerBoekingenViaPnLMapping(CONTEXT, [boeking({ grootboekrekening: "2000", ogbKostensoort: "BBB" })], [], resolveer);
    expect(ontvangen).toEqual([{ bedrijfsnr: "070", grootboekrekening: "2000", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: CONTEXT.opSysteemtijdstip }]);
  });

  it("geeft de aangeleverde mappingregels ongewijzigd door aan de resolver — de helper filtert/muteert ze zelf niet", () => {
    const mappingregels: PnLBronmappingRegel[] = [
      {
        bedrijfsnr: "070",
        grootboekrekening: "1000",
        ogbKostensoort: "AAA",
        economischeModule: "ALGEMENE_KOSTEN",
        economischeCategorie: "X",
        geldigVanafBoekjaar: 2025,
        geldigVanafPeriode: "01",
        geldigTotBoekjaar: null,
        geldigTotPeriode: null,
        aangemaaktOp: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    let ontvangenMapping: readonly PnLBronmappingRegel[] | null = null;
    const resolveer = (_invoer: unknown, _ogb: string | null, mr: readonly PnLBronmappingRegel[]): null => {
      ontvangenMapping = mr;
      return null;
    };
    classificeerBoekingenViaPnLMapping(CONTEXT, [boeking()], mappingregels, resolveer);
    expect(ontvangenMapping).toBe(mappingregels);
  });

  it("M6a: een GL_DEFAULT-resolutie belandt in perGrootboek, gesleuteld op de grootboekrekening, NOOIT in perOgb", () => {
    const resolveer = (): { categorie: "VERKOOPOPBRENGST"; specificiteit: "GL_DEFAULT" } => ({ categorie: "VERKOOPOPBRENGST", specificiteit: "GL_DEFAULT" });
    const { perOgb, perGrootboek, nietGemapt } = classificeerBoekingenViaPnLMapping(
      CONTEXT,
      [boeking({ grootboekrekening: "08830", ogbKostensoort: "3010", grootboekOmschrijving: "Opbrengst verkoop pand" })],
      [],
      resolveer,
    );
    expect(nietGemapt).toEqual([]);
    expect(perOgb.size).toBe(0); // GL_DEFAULT hoort NOOIT in de OGB-array, ook al was ogbKostensoort niet-null
    expect(perGrootboek.get("08830")).toEqual({ categorie: "VERKOOPOPBRENGST", grootboekOmschrijving: "Opbrengst verkoop pand" });
  });

  it("M6a: grootboekOmschrijving valt terug op de grootboekrekening zelf wanneer niet aangeleverd", () => {
    const resolveer = (): { categorie: "X"; specificiteit: "GL_DEFAULT" } => ({ categorie: "X", specificiteit: "GL_DEFAULT" });
    const { perGrootboek } = classificeerBoekingenViaPnLMapping(CONTEXT, [boeking({ grootboekrekening: "5000", grootboekOmschrijving: null })], [], resolveer);
    expect(perGrootboek.get("5000")).toEqual({ categorie: "X", grootboekOmschrijving: "5000" });
  });

  it("M6a: dezelfde OGB-code op twee verschillende grootboekrekeningen met dezelfde uitkomst is toegestaan", () => {
    const resolveer = (invoer: { grootboekrekening: string }): { categorie: "X"; specificiteit: "GL_OGB" } => ({ categorie: "X", specificiteit: "GL_OGB" });
    const boekingen = [boeking({ grootboekrekening: "1000", ogbKostensoort: "AAA" }), boeking({ grootboekrekening: "2000", ogbKostensoort: "AAA" })];
    const { perOgb } = classificeerBoekingenViaPnLMapping(CONTEXT, boekingen, [], resolveer);
    expect(perOgb.get("AAA")).toEqual({ categorie: "X", ogbKostensoortOmschrijving: "test" });
  });

  it("M6a: dezelfde OGB-code op twee verschillende grootboekrekeningen met VERSCHILLENDE categorie faalt fail-fast (batch-brede consistentiecheck)", () => {
    const resolveer = (invoer: { grootboekrekening: string }): { categorie: "X" | "Y"; specificiteit: "GL_OGB" } => ({
      categorie: invoer.grootboekrekening === "1000" ? "X" : "Y",
      specificiteit: "GL_OGB",
    });
    const boekingen = [boeking({ grootboekrekening: "1000", ogbKostensoort: "AAA" }), boeking({ grootboekrekening: "2000", ogbKostensoort: "AAA" })];
    expect(() => classificeerBoekingenViaPnLMapping(CONTEXT, boekingen, [], resolveer)).toThrow(/resolveert binnen deze batch verschillend afhankelijk van de grootboekrekening/);
  });

  it("M6a: dezelfde OGB-code op twee verschillende grootboekrekeningen waarvan er één NIET_GEMAPT is faalt eveneens fail-fast", () => {
    const resolveer = (invoer: { grootboekrekening: string }): { categorie: "X"; specificiteit: "GL_OGB" } | null =>
      invoer.grootboekrekening === "1000" ? { categorie: "X", specificiteit: "GL_OGB" } : null;
    const boekingen = [boeking({ grootboekrekening: "1000", ogbKostensoort: "AAA" }), boeking({ grootboekrekening: "2000", ogbKostensoort: "AAA" })];
    expect(() => classificeerBoekingenViaPnLMapping(CONTEXT, boekingen, [], resolveer)).toThrow(/resolveert binnen deze batch verschillend afhankelijk van de grootboekrekening/);
  });

  it("M6a: het exacte GL08830/OGB3010-scenario — GL_OGB elders voor dezelfde code EN GL_DEFAULT hier zijn inconsistent binnen één batch, dus fail-fast (geen stille misclassificatie)", () => {
    // Dit is precies het gevaar dat de batch-brede check afdekt: OGB "3010" is specifiek gemapt op GL00166
    // (-> BOEKWAARDE_AFBOEKING), maar zou op GL08830 zonder specifieke mapping via het GL-default
    // (-> VERKOOPOPBRENGST) resolveren — een OGB-gesleutelde array kan dat verschil niet weergeven.
    const resolveer = (invoer: { grootboekrekening: string }): { categorie: "BOEKWAARDE_AFBOEKING" | "VERKOOPOPBRENGST"; specificiteit: "GL_OGB" | "GL_DEFAULT" } =>
      invoer.grootboekrekening === "00166" ? { categorie: "BOEKWAARDE_AFBOEKING", specificiteit: "GL_OGB" } : { categorie: "VERKOOPOPBRENGST", specificiteit: "GL_DEFAULT" };
    const boekingen = [boeking({ grootboekrekening: "00166", ogbKostensoort: "3010" }), boeking({ grootboekrekening: "08830", ogbKostensoort: "3010" })];
    expect(() => classificeerBoekingenViaPnLMapping(CONTEXT, boekingen, [], resolveer)).toThrow(/resolveert binnen deze batch verschillend afhankelijk van de grootboekrekening/);
  });
});
