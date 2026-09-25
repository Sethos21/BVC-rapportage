import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenPnLPeriode, type PnLRuweBoekingRegel } from "./pnlPeriodeOrchestratie.js";
import { mappingRegel } from "./begroting/gat013_070Fixtures.js";
import { ALLE_BOEKINGEN_070, ALLE_MAPPING_070, BEDRIJFSNR, BOEKJAAR, OP_SYSTEEMTIJDSTIP, inBereik, type RuweRegel } from "./begroting/gat013_070Fixtures.js";

/**
 * DELTA BUILD (2026-09-18) — "Pure P&L → Worker + Renderer": bewijst het
 * NIEUWE risico dat GAT-013 zelf niet dekte: GAT-013's testharness voedde
 * elke module haar EIGEN, VOORAF gesorteerde boekingen-array. Een echte
 * productiebron levert alle boekingen van een administratie ONGESORTEERD,
 * DOOR ELKAAR aan. Deze test bewijst dat `berekenPnLPeriode` — met
 * PRECIES DEZELFDE, reeds bronbewezen 070-boekingen/-mapping als GAT-013,
 * nu als ÉÉN vlakke, gemengde lijst aangeboden — de partitioneringsstap
 * correct uitvoert en EXACT dezelfde H1-financiële-uitkomst reproduceert
 * (€341.734,81 / €30.555,15 / €311.179,66) zonder enige nieuwe
 * financiële rekenregel: de acht bestaande calculators/adapters en
 * `berekenPnLBoom` blijven ongewijzigd, alleen de routering ervoor is
 * nieuw.
 *
 * GEEN HERBEWIJS VAN DE FINANCIËLE LOGICA ZELF (die blijft in GAT-013,
 * `gat013_070Acceptance.test.ts`, ongewijzigd en groen) — uitsluitend de
 * orchestratielaag (partitionering + wiring) wordt hier getest.
 */

function naarPnLRuweBoekingRegel(r: RuweRegel): PnLRuweBoekingRegel {
  return { grootboekrekening: r.gl, ogbKostensoort: r.ogb, ogbKostensoortOmschrijving: r.ogbOms, complexnummer: r.complex, saldo: new Decimal(r.saldo) };
}

describe("berekenPnLPeriode — 070 H1 2026, ÉÉN gemengde boekingenstroom (nieuw risico: partitionering)", () => {
  const h1Boekingen = ALLE_BOEKINGEN_070.filter((r) => inBereik(r.periode, "01", "06")).map(naarPnLRuweBoekingRegel);

  const context = { bedrijfsnr: BEDRIJFSNR, boekjaar: BOEKJAAR, boekperiode: "06", opSysteemtijdstip: OP_SYSTEEMTIJDSTIP };
  const { resultaat, nietMeegenomen } = berekenPnLPeriode(context, h1Boekingen, ALLE_MAPPING_070);

  it("reproduceert de door GAT-013 bewezen exacte H1-bedragen (opbrengsten/kosten/EBITDA)", () => {
    expect(resultaat.totaalOpbrengsten.besteWetenSom.toString()).toBe("341734.81");
    expect(resultaat.totaalOpbrengsten.volledigheid).toEqual({ status: "VOLLEDIG" });
    expect(resultaat.totaalKosten.besteWetenSom.toString()).toBe("30555.15");
    expect(resultaat.ebitda.bedrag.toString()).toBe("311179.66");
    expect(resultaat.ebitda.bedrag.toDecimalPlaces(0).toString()).toBe("311180"); // legacy H1 EBITDA — exacte match, zie GAT-013
  });

  it("VERVOLGTRANCHE 6 — Unknown != zero: de bedragen blijven exact, maar Management, Leegstandskosten, Accountant- en Juridische kosten zijn voor 070 ONBEKEND (geen bewezen mapping) in plaats van een bevestigde €0; kosten en EBITDA zijn daardoor ONVOLLEDIG", () => {
    const onbekend = (volledigheid: (typeof resultaat)["totaalKosten"]["volledigheid"]) => (volledigheid.status === "ONVOLLEDIG" ? volledigheid.ontbrekend.map((o) => [o.regelSleutel, o.reden]) : []);
    expect(onbekend(resultaat.totaalKosten.volledigheid)).toEqual([
      ["MANAGEMENTVERGOEDING", "GEEN_BEOORDELING"],
      ["LEEGSTANDSKOSTEN", "NIET_GEMAPT"], // Vervolgtranche 8: geen bewezen LEEGSTAND-mapping voor 070 (Nuts/Servicekosten/Overige)
      ["ACCOUNTANT", "NIET_GEMAPT"],
      ["JURIDISCHE_KOSTEN", "NIET_GEMAPT"],
    ]);
    expect(resultaat.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
    // De wél bewezen posten (Makelaar, Bank, Overige algemene kosten) blijven BEKEND.
    const ak = resultaat.algemeneKosten.regels;
    for (const sleutel of ["ALGEMENE_KOSTEN", "MAKELAARSKOSTEN", "BANKKOSTEN"]) {
      expect(ak.find((r) => r.regelSleutel === sleutel)!.waarde.status).toBe("BEKEND");
    }
  });

  it("laat geen boekingen buiten de P&L vallen — nietMeegenomen is leeg voor deze volledig bronbewezen 070-mapping", () => {
    expect(nietMeegenomen).toEqual([]);
  });

  it("routeert boekingen naar de juiste module ondanks een gemengde, ongesorteerde invoerlijst (bv. Huur/Beheer/Onderhoud door elkaar)", () => {
    const huurRegel = resultaat.totaalOpbrengsten.regels.find((r) => r.regelSleutel === "HUUROPBRENGST_BELAST")!;
    expect(huurRegel.waarde).toEqual({ status: "BEKEND", bedrag: new Decimal("268456.65") });
    const beheerRegel = resultaat.managementEnBeheer.regels.find((r) => r.regelSleutel === "BEHEERKOSTEN")!;
    expect(beheerRegel.waarde).toEqual({ status: "BEKEND", bedrag: new Decimal("6445.64") });
    const skeRegel = resultaat.exploitatieLasten.regels.find((r) => r.regelSleutel === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(skeRegel.waarde).toEqual({ status: "BEKEND", bedrag: new Decimal("199.08") });
  });
});

describe("berekenPnLPeriode — completeness bij boekingen buiten de acht productieketens (nieuw risico, synthetisch)", () => {
  it("een volledig onbekende (GL, OGB)-combinatie belandt in nietMeegenomen met economischeModule=null, NOOIT als €0 of stilzwijgend weggelaten", () => {
    const boekingen: PnLRuweBoekingRegel[] = [{ grootboekrekening: "9999", ogbKostensoort: null, ogbKostensoortOmschrijving: null, complexnummer: null, saldo: new Decimal("123.45") }];
    const context = { bedrijfsnr: BEDRIJFSNR, boekjaar: BOEKJAAR, boekperiode: "06", opSysteemtijdstip: OP_SYSTEEMTIJDSTIP };
    const { resultaat, nietMeegenomen } = berekenPnLPeriode(context, boekingen, []);

    expect(nietMeegenomen).toEqual([{ economischeModule: null, totaal: new Decimal("123.45"), aantalBoekingen: 1 }]);
    expect(resultaat.totaalOpbrengsten.besteWetenSom.toString()).toBe("0");
    expect(resultaat.totaalKosten.besteWetenSom.toString()).toBe("0");
  });

  it("een boeking op een GL die naar een WEL bestaand, maar nog niet aangesloten hoofddomein (bv. RENTE) mapt, komt in nietMeegenomen terecht — nooit zelf als P&L-regel geconstrueerd", () => {
    const renteMapping = mappingRegel({ grootboekrekening: "4600", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" });
    const boekingen: PnLRuweBoekingRegel[] = [{ grootboekrekening: "4600", ogbKostensoort: null, ogbKostensoortOmschrijving: null, complexnummer: null, saldo: new Decimal("500") }];
    const context = { bedrijfsnr: BEDRIJFSNR, boekjaar: BOEKJAAR, boekperiode: "06", opSysteemtijdstip: OP_SYSTEEMTIJDSTIP };
    const { resultaat, nietMeegenomen } = berekenPnLPeriode(context, boekingen, [renteMapping]);

    expect(nietMeegenomen).toEqual([{ economischeModule: "RENTE", totaal: new Decimal("500"), aantalBoekingen: 1 }]);
    expect(resultaat.onderEbitda).toEqual([]); // geen fictieve Rente-regel geconstrueerd, noch boven noch onder EBITDA
    expect(resultaat.totaalKosten.besteWetenSom.toString()).toBe("0");
  });

  it("een gemengde batch (bekende + onbekende + niet-ondersteunde boekingen) classificeert elke boeking naar zijn eigen, juiste bestemming", () => {
    const mapping = [mappingRegel({ grootboekrekening: "4000", economischeModule: "BEHEER", economischeCategorie: "BEHEERKOSTEN" }), mappingRegel({ grootboekrekening: "4600", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" })];
    const boekingen: PnLRuweBoekingRegel[] = [
      { grootboekrekening: "4000", ogbKostensoort: null, ogbKostensoortOmschrijving: null, complexnummer: null, saldo: new Decimal("1000") },
      { grootboekrekening: "4600", ogbKostensoort: null, ogbKostensoortOmschrijving: null, complexnummer: null, saldo: new Decimal("200") },
      { grootboekrekening: "9999", ogbKostensoort: null, ogbKostensoortOmschrijving: null, complexnummer: null, saldo: new Decimal("50") },
    ];
    const context = { bedrijfsnr: BEDRIJFSNR, boekjaar: BOEKJAAR, boekperiode: "06", opSysteemtijdstip: OP_SYSTEEMTIJDSTIP };
    const { resultaat, nietMeegenomen } = berekenPnLPeriode(context, boekingen, mapping);

    expect(resultaat.managementEnBeheer.besteWetenSom.toString()).toBe("1000");
    expect(nietMeegenomen).toContainEqual({ economischeModule: "RENTE", totaal: new Decimal("200"), aantalBoekingen: 1 });
    expect(nietMeegenomen).toContainEqual({ economischeModule: null, totaal: new Decimal("50"), aantalBoekingen: 1 });
  });
});
