import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels } from "./begroting/algemeneKostenWerkelijkPnLAdapter.js";
import { berekenWerkelijkAlgemeneKosten } from "./begroting/werkelijkAlgemeneKosten.js";
import { bepaalGemapteCategorieen, type PnLBronmappingRegel } from "./pnlBronmapping.js";
import { berekenPnLPeriode, type PnLRuweBoekingRegel } from "./pnlPeriodeOrchestratie.js";

/**
 * Vervolgtranche 6 — ketencontrole "Unknown != zero" voor Werkelijk: een categorie/module waarvoor de administratie
 * GEEN bewezen bronmapping heeft is ONBEKEND, nooit een bevestigde €0. Volledig gegevensgedreven per administratie.
 */

const T = new Date("2026-09-15T00:00:00.000Z");
const REFERENTIE = { boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date("2026-09-20T00:00:00.000Z") };

function m(overrides: Partial<PnLBronmappingRegel>): PnLBronmappingRegel {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4990",
    ogbKostensoort: null,
    economischeModule: "ALGEMENE_KOSTEN",
    economischeCategorie: "ALGEMENE_KOSTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: T,
    ...overrides,
  };
}

const MAPPING_A: PnLBronmappingRegel[] = [
  m({}),
  m({ ogbKostensoort: "4992", economischeCategorie: "MAKELAARSKOSTEN" }),
  m({ ogbKostensoort: "4995", economischeCategorie: "BANKKOSTEN" }),
];
// Andere administratie: accountant op een eigen GL (dezelfde code betekent per administratie iets anders).
const MAPPING_B: PnLBronmappingRegel[] = [m({ bedrijfsnr: "074", grootboekrekening: "4900", economischeCategorie: "ACCOUNTANT" })];

describe("bepaalGemapteCategorieen — administratiegebonden, geldigheid- en systeemtijd-bewust", () => {
  it("levert precies de bewezen gemapte categorieën van DEZE administratie", () => {
    expect([...bepaalGemapteCategorieen([...MAPPING_A, ...MAPPING_B], { bedrijfsnr: "070", economischeModule: "ALGEMENE_KOSTEN", ...REFERENTIE })].sort()).toEqual(["ALGEMENE_KOSTEN", "BANKKOSTEN", "MAKELAARSKOSTEN"]);
    expect([...bepaalGemapteCategorieen([...MAPPING_A, ...MAPPING_B], { bedrijfsnr: "074", economischeModule: "ALGEMENE_KOSTEN", ...REFERENTIE })]).toEqual(["ACCOUNTANT"]);
  });

  it("geen mapping voor de administratie of voor de module: lege set (geen 070-fallback)", () => {
    expect(bepaalGemapteCategorieen(MAPPING_A, { bedrijfsnr: "999", economischeModule: "ALGEMENE_KOSTEN", ...REFERENTIE }).size).toBe(0);
    expect(bepaalGemapteCategorieen(MAPPING_A, { bedrijfsnr: "070", economischeModule: "MANAGEMENT", ...REFERENTIE }).size).toBe(0);
  });

  it("een mapping die op het referentiepunt nog niet of niet meer geldt, of nog niet bekend was, telt niet mee", () => {
    const beeindigd = [m({ ogbKostensoort: "4992", economischeCategorie: "MAKELAARSKOSTEN", geldigTotBoekjaar: 2026, geldigTotPeriode: "03" })];
    expect(bepaalGemapteCategorieen(beeindigd, { bedrijfsnr: "070", economischeModule: "ALGEMENE_KOSTEN", ...REFERENTIE }).size).toBe(0);
    const laterBekend = [m({ economischeCategorie: "BANKKOSTEN", aangemaaktOp: new Date("2026-12-01T00:00:00.000Z") })];
    expect(bepaalGemapteCategorieen(laterBekend, { bedrijfsnr: "070", economischeModule: "ALGEMENE_KOSTEN", ...REFERENTIE }).size).toBe(0);
  });
});

describe("algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels — categorie zonder bewezen mapping is ONBEKEND", () => {
  const werkelijk = berekenWerkelijkAlgemeneKosten([{ economischeCategorie: "BANKKOSTEN", saldo: new Decimal(40) }]);
  const waarde = (regels: ReturnType<typeof algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels>, sleutel: string) => regels.find((r) => r.regelSleutel === sleutel)!.waarde;

  it("Accountant en Juridisch zonder mapping: ONBEKEND/NIET_GEMAPT; gemapte posten blijven BEKEND (ook een bewuste nul)", () => {
    const regels = algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, true, new Set(["ALGEMENE_KOSTEN", "MAKELAARSKOSTEN", "BANKKOSTEN"]));
    expect(waarde(regels, "ACCOUNTANT")).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
    expect(waarde(regels, "JURIDISCHE_KOSTEN")).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
    expect(waarde(regels, "BANKKOSTEN")).toEqual({ status: "BEKEND", bedrag: new Decimal(40) });
    expect(waarde(regels, "MAKELAARSKOSTEN")).toEqual({ status: "BEKEND", bedrag: new Decimal(0) }); // gemapt, geen boekingen = bevestigde nul
  });

  it("een administratie mét een Accountant-mapping (eigen GL) krijgt Accountant wél als BEKEND — geen hardcoding per administratie", () => {
    const regels = algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(berekenWerkelijkAlgemeneKosten([{ economischeCategorie: "ACCOUNTANT", saldo: new Decimal(1487.5) }]), true, new Set(["ACCOUNTANT"]));
    expect(waarde(regels, "ACCOUNTANT")).toEqual({ status: "BEKEND", bedrag: new Decimal("1487.5") });
    expect(waarde(regels, "JURIDISCHE_KOSTEN")).toMatchObject({ status: "ONBEKEND" });
  });

  it("zonder de optionele parameter blijft het bestaande gedrag (modulebrede dekking) ongewijzigd", () => {
    const regels = algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, true);
    expect(waarde(regels, "ACCOUNTANT")).toEqual({ status: "BEKEND", bedrag: new Decimal(0) });
  });
});

describe("berekenPnLPeriode — dekking per administratie", () => {
  const boekingen: PnLRuweBoekingRegel[] = [
    { grootboekrekening: "4990", ogbKostensoort: "4995", ogbKostensoortOmschrijving: "Bankkosten", complexnummer: null, saldo: new Decimal(40) },
  ];
  const onbekend = (r: ReturnType<typeof berekenPnLPeriode>, sleutel: string) => r.resultaat.algemeneKosten.regels.find((x) => x.regelSleutel === sleutel)!.waarde.status === "ONBEKEND";

  it("070-mapping: Accountant/Juridisch onbekend, Bank/Makelaar/Overige bekend; een 074-mapping met Accountant raakt 070 niet", () => {
    const r = berekenPnLPeriode({ bedrijfsnr: "070", ...REFERENTIE }, boekingen, [...MAPPING_A, ...MAPPING_B]);
    expect(onbekend(r, "ACCOUNTANT")).toBe(true);
    expect(onbekend(r, "JURIDISCHE_KOSTEN")).toBe(true);
    expect(onbekend(r, "BANKKOSTEN")).toBe(false);
    expect(r.resultaat.algemeneKosten.besteWetenSom.toString()).toBe("40");
    expect(r.resultaat.algemeneKosten.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("modules zonder enige mapping voor de administratie (Huur, Beheer, Management, …) zijn ONBEKEND, niet €0 — ook zonder boekingen", () => {
    const r = berekenPnLPeriode({ bedrijfsnr: "070", ...REFERENTIE }, [], MAPPING_A);
    expect(r.resultaat.totaalOpbrengsten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(r.resultaat.managementEnBeheer.volledigheid.status).toBe("ONVOLLEDIG");
    expect(r.resultaat.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });
});

describe("Leegstandskosten — Werkelijk per administratie (Vervolgtranche 8)", () => {
  const contextVan = (bedrijfsnr: string) => ({ bedrijfsnr, ...REFERENTIE });
  const boeking = (gl: string, ogb: string | null, saldo: number): PnLRuweBoekingRegel => ({ grootboekrekening: gl, ogbKostensoort: ogb, ogbKostensoortOmschrijving: null, complexnummer: "003", saldo: new Decimal(saldo) });
  const leegstandRegel = (o: Partial<PnLBronmappingRegel>) => m({ economischeModule: "LEEGSTAND", grootboekrekening: "4200", economischeCategorie: "NUTS_LEEGSTAND", ...o });
  const sleutels = (r: ReturnType<typeof berekenPnLPeriode>) => r.resultaat.exploitatieLasten.regels.map((x) => x.regelSleutel);
  const hoofd = (r: ReturnType<typeof berekenPnLPeriode>) => r.resultaat.exploitatieLasten.regels.find((x) => x.regelSleutel === "LEEGSTANDSKOSTEN")!;

  it("GL4350 wordt NIET zonder bewijs als leegstand-servicekosten behandeld: het bewezen GL+OGB-domein Servicekosten eigenaar draagt het bedrag in de eigen regels, Leegstandskosten blijft onbekend (geen mapping in het domein Leegstand) en er is geen dubbele telling", () => {
    const ske = [m({ grootboekrekening: "4350", ogbKostensoort: "4319", economischeModule: "SERVICEKOSTEN_EIGENAAR", economischeCategorie: "SERVICEKOSTEN_LEEGSTAND" })];
    const r = berekenPnLPeriode(contextVan("070"), [boeking("4350", "4319", 1354.1)], ske);
    expect(hoofd(r).waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
    const skeLeegstand = r.resultaat.exploitatieLasten.regels.find((x) => x.regelSleutel === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(skeLeegstand.waarde).toEqual({ status: "BEKEND", bedrag: new Decimal("1354.1") });
    expect(r.resultaat.exploitatieLasten.besteWetenSom.toString()).toBe("1354.1"); // exact één keer
    expect(sleutels(r).filter((s) => s === "LEEGSTANDSKOSTEN")).toHaveLength(1);
  });

  it("een administratie mét bewezen LEEGSTAND-mapping voor alle drie de kostensoorten heeft een bekende post (Actual exact één keer); een administratie zonder mapping onbekend — geen 070-hardcoding", () => {
    const mapping = [
      leegstandRegel({ bedrijfsnr: "005", ogbKostensoort: "N1", economischeCategorie: "NUTS_LEEGSTAND" }),
      leegstandRegel({ bedrijfsnr: "005", ogbKostensoort: "S1", economischeCategorie: "SERVICEKOSTEN_LEEGSTAND" }),
      leegstandRegel({ bedrijfsnr: "005", ogbKostensoort: "O1", economischeCategorie: "OVERIGE_LEEGSTANDSKOSTEN" }),
    ];
    const boekingen = [boeking("4200", "N1", 30), boeking("4200", "S1", 20), boeking("4200", "O1", 5)];
    const a = berekenPnLPeriode(contextVan("005"), boekingen, mapping);
    expect(hoofd(a).waarde).toEqual({ status: "BEKEND", bedrag: new Decimal(55) });
    expect(a.resultaat.exploitatieLasten.volledigheid.status === "ONVOLLEDIG" ? a.resultaat.exploitatieLasten.volledigheid.ontbrekend.some((o) => o.regelSleutel.startsWith("LEEGSTANDSKOSTEN")) : false).toBe(false);
    const b = berekenPnLPeriode(contextVan("070"), [], mapping);
    expect(hoofd(b).waarde.status).toBe("ONBEKEND");
  });

  it("een boeking op een LEEGSTAND-GL met een niet-gemapte OGB wordt niet stil genegeerd of verdeeld: ze staat zichtbaar in nietMeegenomen (module null) en telt niet mee in een kostensoort", () => {
    const mapping = [leegstandRegel({ bedrijfsnr: "005", ogbKostensoort: "N1", economischeCategorie: "NUTS_LEEGSTAND" })];
    const r = berekenPnLPeriode(contextVan("005"), [boeking("4200", "N1", 30), boeking("4200", "X9", 12)], mapping);
    expect(hoofd(r).waarde).toEqual({ status: "BEKEND", bedrag: new Decimal(30) });
    expect(r.nietMeegenomen).toEqual([{ economischeModule: null, totaal: new Decimal(12), aantalBoekingen: 1 }]);
  });
});
