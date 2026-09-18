import type Decimal from "decimal.js";
import type { BgVerzekeringWerkelijkCategorie, EstimatedVerzekeringResultaat } from "./begroteVerzekeringen.js";
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
 */

export function verzekeringEstimatedNaarPnLBovenEbitdaRegels(resultaat: EstimatedVerzekeringResultaat): PurePnLBovenEbitdaRegel[] {
  return resultaat.perCategorie.map((c): PurePnLBovenEbitdaRegel => {
    const waarde = bijdrageVoorCategorie(c.categorie, c.estimatedTotaal, c.werkelijkVoldoendeBekend);
    return { regelSleutel: c.categorie, boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde };
  });
}

function bijdrageVoorCategorie(categorie: BgVerzekeringWerkelijkCategorie, estimatedTotaal: Decimal | null, werkelijkVoldoendeBekend: boolean): PnLBronBijdrage {
  if (estimatedTotaal !== null) {
    return { status: "BEKEND", bedrag: estimatedTotaal };
  }
  if (!werkelijkVoldoendeBekend) {
    return { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: `Estimated Verzekeringen (${categorie}): Werkelijk-dekking voor de afgesloten periode is niet voldoende bevestigd.` };
  }
  return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Estimated Verzekeringen (${categorie}): resterende-jaarverwachting is nog niet ingevuld/bevestigd.` };
}
