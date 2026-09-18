import type Decimal from "decimal.js";
import type { EstimatedOnderhoudResultaat, OnderhoudWerkelijkCategorie } from "./werkelijkOnderhoud.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE GAT-008B (2026-09-17) — DE Pure P&L-adapter voor Estimated Onderhoud:
 * vertaalt een `EstimatedOnderhoudResultaat` (`werkelijkOnderhoud.ts`) naar de
 * canonieke, boven-EBITDA `PurePnLBronRegel`'s die de Pure P&L Engine
 * (`pnlEngine.ts`, commit d25783e) verwacht.
 *
 * ECONOMISCH HOOFDDOMEIN BLIJFT ONDERHOUD, DEZELFDE PRESENTATIE ALS WERKELIJK
 * (GAT-008B-opdracht, expliciet): drie regels, één per bestaande Werkelijk-
 * categorie (`ONDERHOUD_WERKELIJK_CATEGORIEEN` — Gebouwen/Terrein/
 * Installaties) — GEEN nieuwe, universele P&L-hoofdindeling "Gepland" versus
 * "Correctief/Dagelijks". Een toekomstige Werkelijk-Onderhoud-P&L-adapter
 * gebruikt dezelfde drie `regelSleutel`-waarden, zodat Werkelijk en Estimated
 * altijd in dezelfde P&L-regels naast elkaar kunnen worden getoond.
 *
 * GEEN ADMINISTRATIE-SPECIFIEKE KENNIS: uitsluitend de drie vaste economische
 * categorieën — GEEN GL/OGB/administratiecode, GEEN complexnummer.
 *
 * PLAATSING BOVEN EBITDA, GROEP EXPLOITATIE_LASTEN (zelfde groep als
 * Onderhoud's mede-exploitatiekostenposten Verzekeringen/Gemeentelijke
 * Lasten).
 *
 * TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE: dezelfde identiteitsnormalisatie
 * als de bestaande Onderhoud-Werkelijk-conventie (kosten komen al positief
 * door, bewezen bij M7).
 *
 * COMPLETENESS — REEDS BEREKEND DOOR DE CALCULATOR: `berekenEstimatedOnderhoud`
 * bepaalt al, per categorie, of `estimatedTotaal` bekend is; deze adapter
 * kiest uitsluitend de juiste `PnLDekkingReden` (Unknown != zero).
 */

export function onderhoudEstimatedNaarPnLBovenEbitdaRegels(resultaat: EstimatedOnderhoudResultaat): PurePnLBovenEbitdaRegel[] {
  return resultaat.perCategorie.map((c): PurePnLBovenEbitdaRegel => {
    const waarde = bijdrageVoorCategorie(c.categorie, c.estimatedTotaal, c.werkelijkVoldoendeBekend);
    return { regelSleutel: c.categorie, boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde };
  });
}

function bijdrageVoorCategorie(categorie: OnderhoudWerkelijkCategorie, estimatedTotaal: Decimal | null, werkelijkVoldoendeBekend: boolean): PnLBronBijdrage {
  if (estimatedTotaal !== null) {
    return { status: "BEKEND", bedrag: estimatedTotaal };
  }
  if (!werkelijkVoldoendeBekend) {
    return { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: `Estimated Onderhoud (${categorie}): Werkelijk-dekking voor de afgesloten periode is niet voldoende bevestigd.` };
  }
  return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Estimated Onderhoud (${categorie}): resterende-jaarverwachting is nog niet ingevuld/bevestigd.` };
}
