import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenBegroteVerzekeringen,
  berekenEstimatedVerzekeringen,
  berekenWerkelijkVerzekeringen,
  type BgVerzekeringAannames,
  type BgVerzekeringRegelInvoer,
  type WerkelijkVerzekeringBoekingRegel,
} from "./begroteVerzekeringen.js";
import { verzekeringEstimatedNaarPnLBovenEbitdaRegels } from "./verzekeringEstimatedPnLAdapter.js";
import { berekenPnLBoom, type PnLDekkingReden } from "../pnlEngine.js";

/**
 * FASE GAT-008A (2026-09-17) — Estimated Verzekeringen: bewijst A t/m J uit
 * de GAT-008A-opdracht. Zie `begroteVerzekeringen.ts`-moduledoc voor het
 * volledige ontwerp (`estimatedTotaal = werkelijkTotaal + verwachtingResterendJaar`,
 * met een expliciete Werkelijk-dekkingsvoorwaarde).
 */

function regel(overrides: Partial<BgVerzekeringRegelInvoer> = {}): BgVerzekeringRegelInvoer {
  return {
    complexnummer: "001",
    verzekeraar: "Assuradeuren Gilde B.V.",
    grootboekrekening: "4130",
    ingangsdatum: new Date(Date.UTC(2020, 6, 1)),
    looptijdMaanden: 12,
    bedrag: new Decimal(12000),
    indexPercentage: new Decimal(0),
    handmatigBegrootOverride: null,
    ...overrides,
  };
}
const AANNAMES: BgVerzekeringAannames = { begrotingsjaar: 2026, beoordeeld: true };

function boeking(overrides: Partial<WerkelijkVerzekeringBoekingRegel> = {}): WerkelijkVerzekeringBoekingRegel {
  return { economischeCategorie: "BRAND_OPSTALVERZEKERING", complexnummer: "001", saldo: new Decimal(0), ...overrides };
}

describe("berekenEstimatedVerzekeringen — A/B. full-year Estimated, geen dubbele telling", () => {
  it("A/B. estimatedTotaal = werkelijkTotaal (t/m afgesloten periode) + verwachtingResterendJaar — NOOIT begrotingTotaal + werkelijkTotaal + verwachting", () => {
    const begroting = berekenBegroteVerzekeringen([regel({ bedrag: new Decimal(12000) })], AANNAMES); // jaarbegroting 12.000
    const werkelijk = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(7000) })]); // t/m periode 6: 7.000
    const resultaat = berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: new Decimal(5000) }); // resterend jaar: 5.000

    const c = resultaat.perCategorie[0]!;
    expect(c.begrotingTotaal.toString()).toBe("12000");
    expect(c.werkelijkTotaal.toString()).toBe("7000");
    expect(c.estimatedTotaal!.toString()).toBe("12000"); // 7000 + 5000, NIET 7000 + 12000 = 19000
    expect(resultaat.moduleEstimatedTotaal!.toString()).toBe("12000");
  });

  it("C. handmatige wijziging van de resterende verwachting verandert Estimated voorspelbaar (1-op-1)", () => {
    const begroting = berekenBegroteVerzekeringen([regel()], AANNAMES);
    const werkelijk = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(7000) })]);

    const eerst = berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: new Decimal(5000) });
    const gewijzigd = berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: new Decimal(5500) });

    expect(gewijzigd.moduleEstimatedTotaal!.minus(eerst.moduleEstimatedTotaal!).toString()).toBe("500");
  });

  it("D. de Begroting zelf blijft ongewijzigd door een Estimated-aanroep (pure functie, geen mutatie)", () => {
    const begroting = berekenBegroteVerzekeringen([regel({ bedrag: new Decimal(12000) })], AANNAMES);
    const begrotingKopie = JSON.parse(JSON.stringify(begroting, (_k, v) => (v instanceof Decimal ? v.toString() : v)));
    const werkelijk = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(7000) })]);

    berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: new Decimal(5000) });

    expect(JSON.parse(JSON.stringify(begroting, (_k, v) => (v instanceof Decimal ? v.toString() : v)))).toEqual(begrotingKopie);
    expect(begroting.totaalEffectiefBegroot.toString()).toBe("12000"); // ongewijzigd
  });
});

describe("berekenEstimatedVerzekeringen — E/F. Unknown != zero", () => {
  it("E. ontbrekende resterende verwachting (null) -> estimatedTotaal blijft null, NOOIT stilzwijgend 0", () => {
    const begroting = berekenBegroteVerzekeringen([regel()], AANNAMES);
    const werkelijk = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(7000) })]);
    const resultaat = berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: null });

    expect(resultaat.perCategorie[0]!.estimatedTotaal).toBeNull();
    expect(resultaat.moduleEstimatedTotaal).toBeNull();
  });

  it("F. onvolledige Werkelijk-dekking (brondekking niet bevestigd) maakt Estimated niet volledig bekend, ondanks een ingevulde verwachting", () => {
    const begroting = berekenBegroteVerzekeringen([regel()], AANNAMES);
    const werkelijk = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(7000) })]);
    const resultaat = berekenEstimatedVerzekeringen(begroting, werkelijk, false, { BRAND_OPSTALVERZEKERING: new Decimal(5000) });

    expect(resultaat.perCategorie[0]!.estimatedTotaal).toBeNull();
    expect(resultaat.perCategorie[0]!.werkelijkVoldoendeBekend).toBe(false);
  });

  it("F (variant). nietGeclassificeerdTotaal != 0 maakt Estimated niet volledig bekend, zelfs met brondekkingBevestigd=true", () => {
    const begroting = berekenBegroteVerzekeringen([regel()], AANNAMES);
    const werkelijk = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(7000) }), boeking({ economischeCategorie: null, saldo: new Decimal(200) })]);
    const resultaat = berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: new Decimal(5000) });

    expect(resultaat.perCategorie[0]!.werkelijkVoldoendeBekend).toBe(false);
    expect(resultaat.perCategorie[0]!.estimatedTotaal).toBeNull();
  });
});

describe("verzekeringEstimatedNaarPnLBovenEbitdaRegels — G/H/I. Pure P&L Engine", () => {
  it("G. Estimated Verzekeringen komt terecht in EXPLOITATIE_LASTEN, boven EBITDA, als KOSTEN", () => {
    const begroting = berekenBegroteVerzekeringen([regel({ bedrag: new Decimal(12000) })], AANNAMES);
    const werkelijk = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(7000) })]);
    const estimated = berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: new Decimal(5000) });
    const [regelPnL] = verzekeringEstimatedNaarPnLBovenEbitdaRegels(estimated);

    expect(regelPnL!.boomPositie).toBe("BOVEN_EBITDA");
    expect(regelPnL!.groep).toBe("EXPLOITATIE_LASTEN");
    expect(regelPnL!.contributieAard).toBe("KOSTEN");
    expect((regelPnL!.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("12000");
  });

  it("H. EBITDA gebruikt Estimated correct wanneer waardesoort ESTIMATED wordt berekend", () => {
    const begroting = berekenBegroteVerzekeringen([regel({ bedrag: new Decimal(12000) })], AANNAMES);
    const werkelijk = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(7000) })]);
    const estimated = berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: new Decimal(5000) });
    const kostenRegels = verzekeringEstimatedNaarPnLBovenEbitdaRegels(estimated);
    const opbrengstRegel = { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA" as const, groep: "OPBRENGSTEN" as const, contributieAard: "OPBRENGST" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(100000) } };

    const pnl = berekenPnLBoom("ESTIMATED", [opbrengstRegel, ...kostenRegels]);
    expect(pnl.waardesoort).toBe("ESTIMATED");
    expect(pnl.exploitatieLasten.besteWetenSom.toString()).toBe("12000");
    expect(pnl.ebitda.bedrag.toString()).toBe("88000");
    expect(pnl.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("I. onder-EBITDA-regels blijven onaangetast door Estimated Verzekeringen", () => {
    const begroting = berekenBegroteVerzekeringen([regel({ bedrag: new Decimal(12000) })], AANNAMES);
    const werkelijk = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(7000) })]);
    const estimated = berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: new Decimal(5000) });
    const kostenRegels = verzekeringEstimatedNaarPnLBovenEbitdaRegels(estimated);
    const rentekosten = { regelSleutel: "RENTEKOSTEN", boomPositie: "ONDER_EBITDA" as const, contributieAard: "KOSTEN" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(50000) } };

    const pnl = berekenPnLBoom("ESTIMATED", [...kostenRegels, rentekosten]);
    expect(pnl.onderEbitda).toHaveLength(1);
    expect(pnl.exploitatieLasten.besteWetenSom.toString()).toBe("12000"); // ongewijzigd door de onder-EBITDA-post
  });

  it("F (ONBEKEND doorgegeven aan de engine): een niet-bekende Estimated-bijdrage maakt de groep en EBITDA ONVOLLEDIG", () => {
    const begroting = berekenBegroteVerzekeringen([regel()], AANNAMES);
    const werkelijk = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(7000) })]);
    const estimated = berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: null });
    const [regelPnL] = verzekeringEstimatedNaarPnLBovenEbitdaRegels(estimated);
    expect(regelPnL!.waarde.status).toBe("ONBEKEND");
    expect((regelPnL!.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("GEEN_BEOORDELING");

    const pnl = berekenPnLBoom("ESTIMATED", [regelPnL!]);
    expect(pnl.exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(pnl.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });
});

describe("J. administratie-onafhankelijkheid", () => {
  it("berekenEstimatedVerzekeringen/verzekeringEstimatedNaarPnLBovenEbitdaRegels kennen geen enkel GL/OGB/administratieveld — dezelfde functies werken op willekeurige, administratie-onbekende invoer zonder wijziging", () => {
    const begroting = berekenBegroteVerzekeringen([regel({ bedrag: new Decimal(99999) })], { begrotingsjaar: 2031, beoordeeld: true });
    const werkelijk = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(12345), complexnummer: "XYZ-999" })]);
    const resultaat = berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: new Decimal(1000) });
    expect(resultaat.moduleEstimatedTotaal!.toString()).toBe("13345");
    // Geen van de aangeroepen types/functies heeft ooit een bedrijfsnr/GL/OGB-parameter nodig gehad.
  });
});
