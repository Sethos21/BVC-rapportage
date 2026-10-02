import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  ALGEMENE_KOSTEN_CATEGORIEEN,
  berekenBegroteAlgemeneKosten,
  type BgAlgemeneKostenCategorie,
  type BgAlgemeneKostenCategorieAannames,
} from "./begroteAlgemeneKosten.js";
import { berekenEstimatedAlgemeneKosten, berekenWerkelijkAlgemeneKosten, type WerkelijkAlgemeneKostenBoekingRegel } from "./werkelijkAlgemeneKosten.js";
import { algemeneKostenEstimatedNaarPnLBovenEbitdaRegels } from "./algemeneKostenEstimatedPnLAdapter.js";
import { berekenWerkelijkAlgemeneKostenViaCentraleMapping, type AlgemeneKostenRuweBoekingRegel } from "./algemeneKostenCentraleMapping.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";
import { berekenPnLBoom, type PnLDekkingReden } from "../pnlEngine.js";

/**
 * FASE GAT-008A (2026-09-17) — Estimated Algemene Kosten: bewijst A t/m J
 * over de vijf bestaande, ongewijzigde categorieën.
 */

function aannames(): Record<BgAlgemeneKostenCategorie, BgAlgemeneKostenCategorieAannames> {
  return Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, { beoordeeld: true, vorigJaarBedrag: null, verwachteVerhogingPercentage: null }])) as Record<
    BgAlgemeneKostenCategorie,
    BgAlgemeneKostenCategorieAannames
  >;
}
function geenVerwachting(): Record<BgAlgemeneKostenCategorie, Decimal | null> {
  return Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, null])) as Record<BgAlgemeneKostenCategorie, Decimal | null>;
}
/** Alle vijf categorieën EXPLICIET op een bevestigde €0-verwachting (geen `null`) — voor tests die het moduletotaal willen zien zonder ELKE categorie apart te hoeven vullen. */
function alleNulVerwachting(): Record<BgAlgemeneKostenCategorie, Decimal | null> {
  return Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, new Decimal(0)])) as Record<BgAlgemeneKostenCategorie, Decimal | null>;
}
function boeking(overrides: Partial<WerkelijkAlgemeneKostenBoekingRegel> = {}): WerkelijkAlgemeneKostenBoekingRegel {
  return { economischeCategorie: "BANKKOSTEN", saldo: new Decimal(0), ...overrides };
}

describe("berekenEstimatedAlgemeneKosten — A/B/C/D per categorie", () => {
  it("A/B. estimatedTotaal per categorie = werkelijkTotaal + verwachtingResterendJaar — NOOIT begrotingTotaal + werkelijkTotaal + verwachting", () => {
    const begroting = berekenBegroteAlgemeneKosten(
      [{ categorie: "BANKKOSTEN", ogbKostensoortCode: null, omschrijving: "Bankkosten jaarbegroting", complexnummer: null, jaarbedrag: new Decimal(600) }],
      aannames(),
      [],
      { begrotingsjaar: 2026 },
    );
    expect(begroting.bankkosten.toString()).toBe("600"); // full-year begroting
    const werkelijk = berekenWerkelijkAlgemeneKosten([boeking({ saldo: new Decimal(300) })]); // t/m afgesloten periode
    const verwachting = alleNulVerwachting();
    verwachting.BANKKOSTEN = new Decimal(250); // resterend jaar
    const resultaat = berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, verwachting);

    const bankkosten = resultaat.perCategorie.find((c) => c.categorie === "BANKKOSTEN")!;
    expect(bankkosten.begrotingTotaal.toString()).toBe("600");
    expect(bankkosten.werkelijkTotaal.toString()).toBe("300");
    expect(bankkosten.estimatedTotaal!.toString()).toBe("550"); // 300 + 250, NIET 300 + 600 = 900
    expect(resultaat.moduleEstimatedTotaal!.toString()).toBe("550"); // overige vier categorieën: 0 werkelijk + 0 verwachting = 0
  });

  it("elke categorie behoudt haar eigen, onafhankelijke verwachting/estimatedTotaal — geen kruisbesmetting tussen categorieën", () => {
    const begroting = berekenBegroteAlgemeneKosten([], aannames(), [], { begrotingsjaar: 2026 });
    const werkelijk = berekenWerkelijkAlgemeneKosten([boeking({ economischeCategorie: "ACCOUNTANT", saldo: new Decimal(1000) }), boeking({ economischeCategorie: "BANKKOSTEN", saldo: new Decimal(300) })]);
    const verwachting = geenVerwachting();
    verwachting.ACCOUNTANT = new Decimal(500);
    const resultaat = berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, verwachting);

    expect(resultaat.perCategorie.find((c) => c.categorie === "ACCOUNTANT")!.estimatedTotaal!.toString()).toBe("1500");
    expect(resultaat.perCategorie.find((c) => c.categorie === "BANKKOSTEN")!.estimatedTotaal).toBeNull(); // verwachting niet ingevuld voor BANKKOSTEN
  });

  it("C. handmatige wijziging van de resterende verwachting verandert Estimated voorspelbaar", () => {
    const begroting = berekenBegroteAlgemeneKosten([], aannames(), [], { begrotingsjaar: 2026 });
    const werkelijk = berekenWerkelijkAlgemeneKosten([boeking({ saldo: new Decimal(300) })]);
    const v1 = alleNulVerwachting();
    v1.BANKKOSTEN = new Decimal(250);
    const v2 = alleNulVerwachting();
    v2.BANKKOSTEN = new Decimal(400);

    const eerst = berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, v1);
    const gewijzigd = berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, v2);
    expect(gewijzigd.moduleEstimatedTotaal!.minus(eerst.moduleEstimatedTotaal!).toString()).toBe("150");
  });

  it("D. de Begroting zelf blijft ongewijzigd door een Estimated-aanroep", () => {
    const begroting = berekenBegroteAlgemeneKosten(
      [{ categorie: "BANKKOSTEN", ogbKostensoortCode: null, omschrijving: "x", complexnummer: null, jaarbedrag: new Decimal(600) }],
      aannames(),
      [],
      { begrotingsjaar: 2026 },
    );
    const voorher = begroting.moduleTotaal.toString();
    const werkelijk = berekenWerkelijkAlgemeneKosten([boeking({ saldo: new Decimal(300) })]);
    const verwachting = geenVerwachting();
    verwachting.BANKKOSTEN = new Decimal(250);
    berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, verwachting);
    expect(begroting.moduleTotaal.toString()).toBe(voorher);
  });
});

describe("berekenEstimatedAlgemeneKosten — E/F. Unknown != zero", () => {
  it("E. ontbrekende resterende verwachting (null) -> estimatedTotaal blijft null voor die categorie", () => {
    const begroting = berekenBegroteAlgemeneKosten([], aannames(), [], { begrotingsjaar: 2026 });
    const werkelijk = berekenWerkelijkAlgemeneKosten([boeking({ saldo: new Decimal(300) })]);
    const resultaat = berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, geenVerwachting());
    expect(resultaat.perCategorie.find((c) => c.categorie === "BANKKOSTEN")!.estimatedTotaal).toBeNull();
    expect(resultaat.moduleEstimatedTotaal).toBeNull();
  });

  it("F. onvolledige Werkelijk-dekking (modulebreed) maakt Estimated voor ALLE categorieën niet volledig bekend", () => {
    const begroting = berekenBegroteAlgemeneKosten([], aannames(), [], { begrotingsjaar: 2026 });
    const werkelijk = berekenWerkelijkAlgemeneKosten([boeking({ saldo: new Decimal(300) })]);
    const verwachting = geenVerwachting();
    verwachting.BANKKOSTEN = new Decimal(250);
    const resultaat = berekenEstimatedAlgemeneKosten(begroting, werkelijk, false, verwachting);
    expect(resultaat.perCategorie.every((c) => !c.werkelijkVoldoendeBekend && c.estimatedTotaal === null)).toBe(true);
  });

  it("F (variant). nietGeclassificeerdTotaal != 0 maakt Estimated niet volledig bekend, zelfs met brondekkingBevestigd=true", () => {
    const begroting = berekenBegroteAlgemeneKosten([], aannames(), [], { begrotingsjaar: 2026 });
    const werkelijk = berekenWerkelijkAlgemeneKosten([boeking({ saldo: new Decimal(300) }), boeking({ economischeCategorie: null, saldo: new Decimal(50) })]);
    const verwachting = geenVerwachting();
    verwachting.BANKKOSTEN = new Decimal(250);
    const resultaat = berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, verwachting);
    expect(resultaat.perCategorie.find((c) => c.categorie === "BANKKOSTEN")!.estimatedTotaal).toBeNull();
  });
});

describe("algemeneKostenEstimatedNaarPnLBovenEbitdaRegels — G/H/I", () => {
  it("G. Estimated Algemene Kosten komt terecht in groep ALGEMENE_KOSTEN, boven EBITDA, vijf afzonderlijke regels, als KOSTEN", () => {
    const begroting = berekenBegroteAlgemeneKosten([], aannames(), [], { begrotingsjaar: 2026 });
    const werkelijk = berekenWerkelijkAlgemeneKosten([boeking({ saldo: new Decimal(300) })]);
    const verwachting = geenVerwachting();
    verwachting.BANKKOSTEN = new Decimal(250);
    const estimated = berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, verwachting);
    const regels = algemeneKostenEstimatedNaarPnLBovenEbitdaRegels(estimated);

    expect(regels).toHaveLength(5);
    expect(regels.every((r) => r.boomPositie === "BOVEN_EBITDA" && r.groep === "ALGEMENE_KOSTEN" && r.contributieAard === "KOSTEN")).toBe(true);
    expect(new Set(regels.map((r) => r.regelSleutel)).size).toBe(5); // geen dubbele telling
    const bankkosten = regels.find((r) => r.regelSleutel === "BANKKOSTEN")!;
    expect((bankkosten.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("550");
  });

  it("H. EBITDA gebruikt Estimated correct wanneer waardesoort ESTIMATED wordt berekend", () => {
    const begroting = berekenBegroteAlgemeneKosten([], aannames(), [], { begrotingsjaar: 2026 });
    const werkelijk = berekenWerkelijkAlgemeneKosten([boeking({ economischeCategorie: "ACCOUNTANT", saldo: new Decimal(1000) }), boeking({ economischeCategorie: "BANKKOSTEN", saldo: new Decimal(300) })]);
    const verwachting = geenVerwachting();
    verwachting.ACCOUNTANT = new Decimal(500);
    verwachting.BANKKOSTEN = new Decimal(250);
    verwachting.ALGEMENE_KOSTEN = new Decimal(0);
    verwachting.JURIDISCHE_KOSTEN = new Decimal(0);
    verwachting.MAKELAARSKOSTEN = new Decimal(0);
    const estimated = berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, verwachting);
    const kostenRegels = algemeneKostenEstimatedNaarPnLBovenEbitdaRegels(estimated);
    const opbrengstRegel = { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA" as const, groep: "OPBRENGSTEN" as const, contributieAard: "OPBRENGST" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(100000) } };

    const pnl = berekenPnLBoom("ESTIMATED", [opbrengstRegel, ...kostenRegels]);
    expect(pnl.waardesoort).toBe("ESTIMATED");
    expect(pnl.algemeneKosten.besteWetenSom.toString()).toBe("2050"); // (1000+500) + (300+250)
    expect(pnl.ebitda.bedrag.toString()).toBe("97950");
    expect(pnl.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("I. onder-EBITDA-regels blijven onaangetast door Estimated Algemene Kosten", () => {
    const begroting = berekenBegroteAlgemeneKosten([], aannames(), [], { begrotingsjaar: 2026 });
    const werkelijk = berekenWerkelijkAlgemeneKosten([boeking({ saldo: new Decimal(300) })]);
    const verwachting = geenVerwachting();
    verwachting.BANKKOSTEN = new Decimal(250);
    verwachting.ACCOUNTANT = new Decimal(0);
    verwachting.ALGEMENE_KOSTEN = new Decimal(0);
    verwachting.JURIDISCHE_KOSTEN = new Decimal(0);
    verwachting.MAKELAARSKOSTEN = new Decimal(0);
    const estimated = berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, verwachting);
    const kostenRegels = algemeneKostenEstimatedNaarPnLBovenEbitdaRegels(estimated);
    const rentekosten = { regelSleutel: "RENTEKOSTEN", boomPositie: "ONDER_EBITDA" as const, contributieAard: "KOSTEN" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(50000) } };

    const pnl = berekenPnLBoom("ESTIMATED", [...kostenRegels, rentekosten]);
    expect(pnl.onderEbitda).toHaveLength(1);
    expect(pnl.algemeneKosten.besteWetenSom.toString()).toBe("550");
  });

  it("F (ONBEKEND doorgegeven aan de engine): een ontbrekende verwachting voor één categorie maakt ALGEMENE_KOSTEN en EBITDA ONVOLLEDIG, andere categorieën blijven BEKEND", () => {
    const begroting = berekenBegroteAlgemeneKosten([], aannames(), [], { begrotingsjaar: 2026 });
    const werkelijk = berekenWerkelijkAlgemeneKosten([boeking({ saldo: new Decimal(300) })]);
    const verwachting = geenVerwachting();
    verwachting.ACCOUNTANT = new Decimal(0);
    verwachting.ALGEMENE_KOSTEN = new Decimal(0);
    verwachting.JURIDISCHE_KOSTEN = new Decimal(0);
    verwachting.MAKELAARSKOSTEN = new Decimal(0);
    // BANKKOSTEN blijft null (niet ingevuld).
    const estimated = berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, verwachting);
    const regels = algemeneKostenEstimatedNaarPnLBovenEbitdaRegels(estimated);

    const bankkosten = regels.find((r) => r.regelSleutel === "BANKKOSTEN")!;
    expect(bankkosten.waarde.status).toBe("ONBEKEND");
    expect((bankkosten.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("GEEN_BEOORDELING");
    expect(regels.find((r) => r.regelSleutel === "ACCOUNTANT")!.waarde.status).toBe("BEKEND");

    const pnl = berekenPnLBoom("ESTIMATED", regels);
    expect(pnl.algemeneKosten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(pnl.algemeneKosten.besteWetenSom.toString()).toBe("0"); // bekende deelsom (alle overige categorieën 0) blijft beschikbaar
    expect(pnl.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });
});

describe("J. generieke administratie — dezelfde Estimated-calculator/adapter over de volledige, reeds-bewezen GAT-009-mappingketen", () => {
  const AANGEMAAKT = new Date("2026-09-17T00:00:00.000Z");
  const MAPPING_TEST073: PnLBronmappingRegel[] = [
    {
      bedrijfsnr: "TEST073",
      grootboekrekening: "6600",
      ogbKostensoort: null,
      economischeModule: "ALGEMENE_KOSTEN",
      economischeCategorie: "BANKKOSTEN",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      aangemaaktOp: AANGEMAAKT,
    },
  ];

  it("Werkelijk via een synthetische TEST073-mapping (andere GL dan 070) voedt dezelfde berekenEstimatedAlgemeneKosten/adapter zonder enige codewijziging", () => {
    const boekingen: AlgemeneKostenRuweBoekingRegel[] = [{ grootboekrekening: "6600", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(300) }];
    const { werkelijk, nietGemapt } = berekenWerkelijkAlgemeneKostenViaCentraleMapping(
      { bedrijfsnr: "TEST073", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() },
      boekingen,
      MAPPING_TEST073,
    );
    expect(nietGemapt).toEqual([]);

    const begroting = berekenBegroteAlgemeneKosten([], aannames(), [], { begrotingsjaar: 2026 });
    const verwachting = geenVerwachting();
    verwachting.BANKKOSTEN = new Decimal(250);
    const estimated = berekenEstimatedAlgemeneKosten(begroting, werkelijk, true, verwachting);
    const regels = algemeneKostenEstimatedNaarPnLBovenEbitdaRegels(estimated);

    expect(regels.find((r) => r.regelSleutel === "BANKKOSTEN")!.waarde).toEqual({ status: "BEKEND", bedrag: new Decimal(550) });
  });
});
