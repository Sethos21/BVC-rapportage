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
