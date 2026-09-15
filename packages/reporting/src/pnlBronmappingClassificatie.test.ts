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
});
