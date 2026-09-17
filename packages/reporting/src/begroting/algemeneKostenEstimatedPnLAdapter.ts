import type Decimal from "decimal.js";
import type { BgAlgemeneKostenCategorie } from "./begroteAlgemeneKosten.js";
import type { EstimatedAlgemeneKostenResultaat } from "./werkelijkAlgemeneKosten.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE GAT-008A (2026-09-17) — DE Pure P&L-adapter voor Estimated Algemene
 * Kosten: vertaalt een `EstimatedAlgemeneKostenResultaat`
 * (`werkelijkAlgemeneKosten.ts`) naar de canonieke, boven-EBITDA
 * `PurePnLBronRegel`'s die de Pure P&L Engine (`pnlEngine.ts`, commit
 * d25783e) verwacht — zelfde regelSleutel/groep/contributieAard-conventie
 * als `algemeneKostenWerkelijkPnLAdapter.ts` (GAT-009), zodat Estimated en
 * Werkelijk in exact dezelfde P&L-regels terechtkomen.
 *
 * GEEN ADMINISTRATIE-SPECIFIEKE KENNIS: uitsluitend de vijf bestaande,
 * ongewijzigde economische categorieën (`ALGEMENE_KOSTEN_CATEGORIEEN`).
 * "Taxatie/Verhuurbemiddeling" blijft een presentatielabel binnen
 * MAKELAARSKOSTEN — geen eigen regel, geen dubbele telling (zelfde grens als
 * `algemeneKostenWerkelijkPnLAdapter.ts`).
 *
 * PLAATSING BOVEN EBITDA, GROEP ALGEMENE_KOSTEN (GAT-008A-opdracht,
 * expliciet) — vijf afzonderlijke regels, geen samengevoegde "Algemene
 * Kosten"-regel.
 *
 * TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE: dezelfde identiteitsnormalisatie
 * als `algemeneKostenWerkelijkPnLAdapter.ts` (kosten komen al positief door).
 *
 * COMPLETENESS — REEDS BEREKEND DOOR DE CALCULATOR: `berekenEstimatedAlgemeneKosten`
 * bepaalt al, per categorie, of `estimatedTotaal` bekend is; deze adapter
 * kiest uitsluitend de juiste `PnLDekkingReden` (Unknown != zero).
 */

export function algemeneKostenEstimatedNaarPnLBovenEbitdaRegels(resultaat: EstimatedAlgemeneKostenResultaat): PurePnLBovenEbitdaRegel[] {
  return resultaat.perCategorie.map((c): PurePnLBovenEbitdaRegel => {
    const waarde = bijdrageVoorCategorie(c.categorie, c.estimatedTotaal, c.werkelijkVoldoendeBekend);
    return { regelSleutel: c.categorie, boomPositie: "BOVEN_EBITDA", groep: "ALGEMENE_KOSTEN", contributieAard: "KOSTEN", waarde };
  });
}

function bijdrageVoorCategorie(categorie: BgAlgemeneKostenCategorie, estimatedTotaal: Decimal | null, werkelijkVoldoendeBekend: boolean): PnLBronBijdrage {
  if (estimatedTotaal !== null) {
    return { status: "BEKEND", bedrag: estimatedTotaal };
  }
  if (!werkelijkVoldoendeBekend) {
    return { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: `Estimated Algemene Kosten (${categorie}): Werkelijk-dekking voor de afgesloten periode is niet voldoende bevestigd.` };
  }
  return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Estimated Algemene Kosten (${categorie}): resterende-jaarverwachting is nog niet ingevuld/bevestigd.` };
}
