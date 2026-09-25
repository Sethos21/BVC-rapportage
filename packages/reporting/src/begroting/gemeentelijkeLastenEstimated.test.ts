import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenBegroteGemeentelijkeLasten,
  berekenEstimatedGemeentelijkeLasten,
  berekenWerkelijkGemeentelijkeLasten,
  type BgGemeentelijkeLastenAannames,
  type BgWozObjectInvoer,
  type WerkelijkGemeentelijkeLastenBoekingRegel,
} from "./begroteGemeentelijkeLasten.js";
import { gemeentelijkeLastenEstimatedNaarPnLBovenEbitdaRegels } from "./gemeentelijkeLastenEstimatedPnLAdapter.js";
import { berekenPnLBoom, type PnLDekkingReden } from "../pnlEngine.js";

/**
 * FASE GAT-008A (2026-09-17) — Estimated Gemeentelijke Lasten: bewijst A t/m
 * J. Anders dan Verzekeringen heeft de Begroting hier GEEN maandstructuur
 * (vlak jaarbedrag) — `verwachtingResterendJaar` blijft daarom PUUR
 * handmatig, zonder enige interne afleiding (zie moduledoc
 * `begroteGemeentelijkeLasten.ts`).
 */

function wozObject(overrides: Partial<BgWozObjectInvoer> = {}): BgWozObjectInvoer {
  return {
    complexnummer: "001",
    objectType: "GEHEEL_COMPLEX",
    unitnummer: null,
    aanslagjaar: 2026,
    waardepeildatum: new Date(Date.UTC(2026, 0, 1)),
    werkelijkeWoz: new Decimal(1000000),
    verwachteWozOverride: null,
    ...overrides,
  };
}
function aannames(overrides: Partial<BgGemeentelijkeLastenAannames> = {}): BgGemeentelijkeLastenAannames {
  return { begrotingsjaar: 2026, werkelijkeGemeentelijkeLasten: new Decimal(9000), wozStijgingPercentage: new Decimal(0), lastenPercentageStijging: new Decimal(0), begrotingsPercentageOverride: null, wozSetBevestigd: true, beoordeeld: true, ...overrides };
}
function boeking(overrides: Partial<WerkelijkGemeentelijkeLastenBoekingRegel> = {}): WerkelijkGemeentelijkeLastenBoekingRegel {
  return { economischeCategorie: "GEMEENTELIJKE_LASTEN", complexnummer: "001", saldo: new Decimal(0), ...overrides };
}

describe("berekenEstimatedGemeentelijkeLasten — A/B/C/D", () => {
  it("A/B. estimatedTotaal = werkelijkTotaal + verwachtingResterendJaar — NOOIT begrotingTotaal + werkelijkTotaal + verwachting", () => {
    const begroting = berekenBegroteGemeentelijkeLasten([wozObject({ werkelijkeWoz: new Decimal(1000000) })], aannames()); // begroteGemeentelijkeLasten = 9000/1000000*100% * 1000000/100 = 9000
    expect(begroting.begroteGemeentelijkeLasten!.toString()).toBe("9000");
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([boeking({ saldo: new Decimal(4000) })]); // niet gelijkmatig geboekt: t/m periode 6 al 4.000
    const resultaat = berekenEstimatedGemeentelijkeLasten(begroting, werkelijk, true, { GEMEENTELIJKE_LASTEN: new Decimal(5500) });

    const c = resultaat.perCategorie[0]!;
    expect(c.begrotingTotaal!.toString()).toBe("9000");
    expect(c.werkelijkTotaal.toString()).toBe("4000");
    expect(c.estimatedTotaal!.toString()).toBe("9500"); // 4000 + 5500, NIET 4000 + 9000 = 13000
  });

  it("C. handmatige wijziging van de resterende verwachting verandert Estimated voorspelbaar", () => {
    const begroting = berekenBegroteGemeentelijkeLasten([wozObject()], aannames());
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([boeking({ saldo: new Decimal(4000) })]);
    const eerst = berekenEstimatedGemeentelijkeLasten(begroting, werkelijk, true, { GEMEENTELIJKE_LASTEN: new Decimal(5000) });
    const gewijzigd = berekenEstimatedGemeentelijkeLasten(begroting, werkelijk, true, { GEMEENTELIJKE_LASTEN: new Decimal(6000) });
    expect(gewijzigd.moduleEstimatedTotaal!.minus(eerst.moduleEstimatedTotaal!).toString()).toBe("1000");
  });

  it("D. de Begroting zelf blijft ongewijzigd door een Estimated-aanroep", () => {
    const begroting = berekenBegroteGemeentelijkeLasten([wozObject()], aannames());
    const voorher = begroting.begroteGemeentelijkeLasten!.toString();
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([boeking({ saldo: new Decimal(4000) })]);
    berekenEstimatedGemeentelijkeLasten(begroting, werkelijk, true, { GEMEENTELIJKE_LASTEN: new Decimal(5000) });
    expect(begroting.begroteGemeentelijkeLasten!.toString()).toBe(voorher);
  });
});

describe("berekenEstimatedGemeentelijkeLasten — E/F. Unknown != zero (ongelijkmatige boekingen mogen NOOIT tot een 0-aanname leiden)", () => {
  it("E. ontbrekende resterende verwachting (null) -> estimatedTotaal blijft null", () => {
    const begroting = berekenBegroteGemeentelijkeLasten([wozObject()], aannames());
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([boeking({ saldo: new Decimal(4000) })]);
    const resultaat = berekenEstimatedGemeentelijkeLasten(begroting, werkelijk, true, { GEMEENTELIJKE_LASTEN: null });
    expect(resultaat.perCategorie[0]!.estimatedTotaal).toBeNull();
    expect(resultaat.moduleEstimatedTotaal).toBeNull();
  });

  it("F. onvolledige Werkelijk-dekking (brondekking niet bevestigd) maakt Estimated niet volledig bekend", () => {
    const begroting = berekenBegroteGemeentelijkeLasten([wozObject()], aannames());
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([boeking({ saldo: new Decimal(4000) })]);
    const resultaat = berekenEstimatedGemeentelijkeLasten(begroting, werkelijk, false, { GEMEENTELIJKE_LASTEN: new Decimal(5000) });
    expect(resultaat.perCategorie[0]!.estimatedTotaal).toBeNull();
  });
});

describe("gemeentelijkeLastenEstimatedNaarPnLBovenEbitdaRegels — G/H/I", () => {
  it("G. Estimated Gemeentelijke Lasten komt terecht in EXPLOITATIE_LASTEN, boven EBITDA, als KOSTEN", () => {
    const begroting = berekenBegroteGemeentelijkeLasten([wozObject()], aannames());
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([boeking({ saldo: new Decimal(4000) })]);
    const estimated = berekenEstimatedGemeentelijkeLasten(begroting, werkelijk, true, { GEMEENTELIJKE_LASTEN: new Decimal(5500) });
    const [regelPnL] = gemeentelijkeLastenEstimatedNaarPnLBovenEbitdaRegels(estimated);

    expect(regelPnL!.boomPositie).toBe("BOVEN_EBITDA");
    expect(regelPnL!.groep).toBe("EXPLOITATIE_LASTEN");
    expect(regelPnL!.contributieAard).toBe("KOSTEN");
    expect((regelPnL!.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("9500");
  });

  it("H. EBITDA gebruikt Estimated correct wanneer waardesoort ESTIMATED wordt berekend", () => {
    const begroting = berekenBegroteGemeentelijkeLasten([wozObject()], aannames());
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([boeking({ saldo: new Decimal(4000) })]);
    const estimated = berekenEstimatedGemeentelijkeLasten(begroting, werkelijk, true, { GEMEENTELIJKE_LASTEN: new Decimal(5500) });
    const kostenRegels = gemeentelijkeLastenEstimatedNaarPnLBovenEbitdaRegels(estimated);
    const opbrengstRegel = { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA" as const, groep: "OPBRENGSTEN" as const, contributieAard: "OPBRENGST" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(100000) } };

    const pnl = berekenPnLBoom("ESTIMATED", [opbrengstRegel, ...kostenRegels]);
    expect(pnl.waardesoort).toBe("ESTIMATED");
    expect(pnl.exploitatieLasten.besteWetenSom.toString()).toBe("9500");
    expect(pnl.ebitda.bedrag.toString()).toBe("90500");
    expect(pnl.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("I. onder-EBITDA-regels blijven onaangetast door Estimated Gemeentelijke Lasten", () => {
    const begroting = berekenBegroteGemeentelijkeLasten([wozObject()], aannames());
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([boeking({ saldo: new Decimal(4000) })]);
    const estimated = berekenEstimatedGemeentelijkeLasten(begroting, werkelijk, true, { GEMEENTELIJKE_LASTEN: new Decimal(5500) });
    const kostenRegels = gemeentelijkeLastenEstimatedNaarPnLBovenEbitdaRegels(estimated);
    const rentekosten = { regelSleutel: "RENTEKOSTEN", boomPositie: "ONDER_EBITDA" as const, contributieAard: "KOSTEN" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(50000) } };

    const pnl = berekenPnLBoom("ESTIMATED", [...kostenRegels, rentekosten]);
    expect(pnl.onderEbitda).toHaveLength(1);
    expect(pnl.exploitatieLasten.besteWetenSom.toString()).toBe("9500");
  });

  it("F (ONBEKEND doorgegeven aan de engine): een niet-bekende Estimated-bijdrage maakt de groep en EBITDA ONVOLLEDIG", () => {
    const begroting = berekenBegroteGemeentelijkeLasten([wozObject()], aannames());
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([boeking({ saldo: new Decimal(4000) })]);
    const estimated = berekenEstimatedGemeentelijkeLasten(begroting, werkelijk, true, { GEMEENTELIJKE_LASTEN: null });
    const [regelPnL] = gemeentelijkeLastenEstimatedNaarPnLBovenEbitdaRegels(estimated);
    expect(regelPnL!.waarde.status).toBe("ONBEKEND");
    expect((regelPnL!.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("GEEN_BEOORDELING");

    const pnl = berekenPnLBoom("ESTIMATED", [regelPnL!]);
    expect(pnl.exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(pnl.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });
});

describe("J. administratie-onafhankelijkheid", () => {
  it("berekenEstimatedGemeentelijkeLasten/de adapter kennen geen enkel GL/OGB/administratieveld", () => {
    const begroting = berekenBegroteGemeentelijkeLasten([wozObject({ werkelijkeWoz: new Decimal(2500000) })], aannames({ begrotingsjaar: 2031, werkelijkeGemeentelijkeLasten: new Decimal(20000) }));
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([boeking({ saldo: new Decimal(9999), complexnummer: "ANDERE-ADM-1" })]);
    const resultaat = berekenEstimatedGemeentelijkeLasten(begroting, werkelijk, true, { GEMEENTELIJKE_LASTEN: new Decimal(1) });
    expect(resultaat.moduleEstimatedTotaal!.toString()).toBe("10000");
  });
});
