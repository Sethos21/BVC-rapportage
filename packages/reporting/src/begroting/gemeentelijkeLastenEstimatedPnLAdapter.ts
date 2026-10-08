import type Decimal from "decimal.js";
import type { BgGemeentelijkeLastenWerkelijkCategorie, EstimatedGemeentelijkeLastenResultaat } from "./begroteGemeentelijkeLasten.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE GAT-008A (2026-09-17) — DE Pure P&L-adapter voor Estimated
 * Gemeentelijke Lasten: vertaalt een `EstimatedGemeentelijkeLastenResultaat`
 * (`begroteGemeentelijkeLasten.ts`) naar de canonieke, boven-EBITDA
 * `PurePnLBronRegel`'s die de Pure P&L Engine (`pnlEngine.ts`, commit
 * d25783e) verwacht — zelfde patroon als `verzekeringEstimatedPnLAdapter.ts`.
 *
 * GEEN ADMINISTRATIE-SPECIFIEKE KENNIS: uitsluitend de ene vaste economische
 * categorie (`GEMEENTELIJKE_LASTEN_WERKELIJK_CATEGORIEEN`) — GEEN GL/OGB/
 * administratiecode, GEEN automatische WOZ-/GL4700/4710-kennis.
 *
 * PLAATSING BOVEN EBITDA, GROEP EXPLOITATIE_LASTEN (GAT-008A-opdracht,
 * expliciet).
 *
 * TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE: dezelfde identiteitsnormalisatie
 * als de bestaande Werkelijk-adapters (kosten komen al positief door).
 *
 * COMPLETENESS — REEDS BEREKEND DOOR DE CALCULATOR: `berekenEstimatedGemeentelijkeLasten`
 * bepaalt al of `estimatedTotaal` bekend is; deze adapter kiest uitsluitend
 * de juiste `PnLDekkingReden` (Unknown != zero, nooit €0 bij `estimatedTotaal
 * === null` — met name relevant hier omdat gemeentelijke lasten bewezen NIET
 * gelijkmatig maandelijks geboekt worden, zie moduledoc `begroteGemeentelijkeLasten.ts`).
 */

export function gemeentelijkeLastenEstimatedNaarPnLBovenEbitdaRegels(resultaat: EstimatedGemeentelijkeLastenResultaat): PurePnLBovenEbitdaRegel[] {
  return resultaat.perCategorie.map((c): PurePnLBovenEbitdaRegel => {
    const waarde = bijdrageVoorCategorie(c.categorie, c.estimatedTotaal, c.werkelijkVoldoendeBekend);
    return { regelSleutel: c.categorie, boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde };
  });
}

function bijdrageVoorCategorie(categorie: BgGemeentelijkeLastenWerkelijkCategorie, estimatedTotaal: Decimal | null, werkelijkVoldoendeBekend: boolean): PnLBronBijdrage {
  if (estimatedTotaal !== null) {
    return { status: "BEKEND", bedrag: estimatedTotaal };
  }
  if (!werkelijkVoldoendeBekend) {
    return { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: `Estimated Gemeentelijke Lasten (${categorie}): Werkelijk-dekking voor de afgesloten periode is niet voldoende bevestigd.` };
  }
  return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Estimated Gemeentelijke Lasten (${categorie}): resterende-jaarverwachting is nog niet ingevuld/bevestigd.` };
}
