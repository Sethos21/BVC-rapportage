import type { EstimatedVerzekeringResultaat } from "./begroteVerzekeringen.js";
import { VERZEKERINGEN_PNL_SLEUTEL } from "./begrotingPnLAdapters.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE GAT-008A (2026-09-17) — DE Pure P&L-adapter voor Estimated
 * Verzekeringen: vertaalt een `EstimatedVerzekeringResultaat`
 * (`begroteVerzekeringen.ts`) naar de canonieke, boven-EBITDA
 * `PurePnLBronRegel`'s die de Pure P&L Engine (`pnlEngine.ts`, commit
 * d25783e) verwacht — DEZELFDE regelSleutel/groep/contributieAard als een
 * (nog te bouwen) Werkelijk-adapter voor deze module zou gebruiken, exact
 * zoals de GAT-008A-opdracht vereist ("sluit aan op dezelfde economische
 * P&L-regels als hun Werkelijk/Begroting-tegenhanger").
 *
 * GEEN ADMINISTRATIE-SPECIFIEKE KENNIS: deze module bevat GEEN
 * grootboekrekening, GEEN OGB-code, GEEN administratiecode — uitsluitend de
 * ene vaste economische categorie (`VERZEKERING_WERKELIJK_CATEGORIEEN`).
 *
 * PLAATSING BOVEN EBITDA, GROEP EXPLOITATIE_LASTEN (GAT-008A-opdracht,
 * expliciet).
 *
 * TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE: `EstimatedVerzekeringResultaat`'s
 * `estimatedTotaal` is opgebouwd uit `WerkelijkVerzekeringResultaat.
 * categorieTotaal` (RUW, CAL-FIN-001, al bewezen positief voor deze GL) plus
 * een handmatige, in dezelfde richting aangeleverde `verwachtingResterendJaar`
 * — de vaste `contributieAard` is `"KOSTEN"`, en de ÉNE normalisatiestap hier
 * is de IDENTITEIT (geen tekenomkering nodig), zelfde conventie als de
 * bestaande Werkelijk-adapters (Huur/Beheer/Management/Algemene Kosten).
 *
 * COMPLETENESS — REEDS BEREKEND DOOR DE CALCULATOR, HIER UITSLUITEND
 * DOORGEGEVEN: `berekenEstimatedVerzekeringen` heeft al bepaald of
 * `estimatedTotaal` bekend is (Werkelijk-dekking bevestigd ÉN een geldige
 * `verwachtingResterendJaar`) — deze adapter herhaalt die logica niet, maar
 * kiest uitsluitend de juiste `PnLDekkingReden` op basis van WELK van de twee
 * voorwaarden ontbreekt, voor een bruikbare toelichting (Unknown != zero,
 * nooit €0 bij `estimatedTotaal === null`).
 *
 * MASTER CONTRACT §18.3 HERSTEL (2026-10-06): deze functie geeft ÉÉN canonieke
 * regel (`VERZEKERINGEN_PNL_SLEUTEL`) terug — dezelfde sleutel als de Begroting-
 * adapter (`verzekeringenBegrotingNaarPnLBovenEbitdaRegels`) — in plaats van één
 * regel per onderliggende categorie. `resultaat.moduleEstimatedTotaal` is de
 * reeds bestaande, ongewijzigde som van de categorieën (`null` zodra één
 * categorie onbekend is, "Unknown != zero"); `resultaat.perCategorie` blijft op
 * het calculatorresultaat zelf onaangetast beschikbaar voor drill-down — deze
 * adapter verwijdert geen detail, hij projecteert het uitsluitend naar de
 * canonieke P&L-presentatie. Hiervoor is GEEN tweede/nieuw datatype nodig.
 */

export function verzekeringEstimatedNaarPnLBovenEbitdaRegels(resultaat: EstimatedVerzekeringResultaat): PurePnLBovenEbitdaRegel[] {
  return [{ regelSleutel: VERZEKERINGEN_PNL_SLEUTEL, boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: moduleBijdrage(resultaat) }];
}

function moduleBijdrage(resultaat: EstimatedVerzekeringResultaat): PnLBronBijdrage {
  if (resultaat.moduleEstimatedTotaal !== null) {
    return { status: "BEKEND", bedrag: resultaat.moduleEstimatedTotaal };
  }
  if (resultaat.perCategorie.some((c) => !c.werkelijkVoldoendeBekend)) {
    return { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: "Estimated Verzekeringen: Werkelijk-dekking voor de afgesloten periode is voor minstens één categorie niet voldoende bevestigd." };
  }
  return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: "Estimated Verzekeringen: de resterende-jaarverwachting is nog niet voor elke categorie ingevuld/bevestigd." };
}
