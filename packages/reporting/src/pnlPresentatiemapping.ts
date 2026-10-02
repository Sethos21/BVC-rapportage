import type { PnLEconomischeModule } from "./pnlBronmapping.js";

/**
 * P&L-PRESENTATIEMAPPING (Vervolgtranche 9 — sluit ARCHITECTUURPUNT §8.10, Tranche 8).
 *
 * ARCHITECTUURBESLUIT (2026-09-29): een OGB verandert nooit het bron-hoofddomein
 * van een boeking (M4b, `pnlBronmapping.ts`, ongewijzigd). Een expliciet
 * BEWEZEN combinatie (bronHoofddomein, bronCategorie) mag echter, via een
 * AFZONDERLIJKE, expliciete P&L-PRESENTATIEmapping, economisch onder een
 * andere canonieke P&L-post worden GEPRESENTEERD. Dit is zuiver een
 * presentatieclassificatie: de onderliggende Werkelijk-calculator/-categorie
 * en haar bron-hoofddomein veranderen niet — alleen welke P&L-regel het reeds
 * berekende bedrag ontvangt.
 *
 * Toegestaan is dit UITSLUITEND wanneer:
 *  1. de combinatie GL+OGB uit brondata/mapping al bewezen is (deze module
 *     ontvangt uitsluitend het RESULTAAT daarvan — bronHoofddomein/
 *     bronCategorie — nooit een GL/OGB/omschrijving zelf);
 *  2. de economische betekenis ondubbelzinnig bewezen is;
 *  3. de mapping expliciet is vastgelegd (een `PnLPresentatieMappingRegel`,
 *     aangeleverd door de aanroeper — nooit een constante/hardcode hierin);
 *  4. geen omschrijvingsherkenning wordt gebruikt;
 *  5. geen fuzzy matching of heuristiek wordt gebruikt (exacte match op
 *     bedrijfsnr+bronHoofddomein+bronCategorie);
 *  6. geen bedrag wordt verdeeld of geschat (de volledige, reeds berekende
 *     categoriebijdrage verhuist in zijn geheel);
 *  7. de oorspronkelijke bronboeking niet wordt verplaatst of gemuteerd (de
 *     bron-Werkelijk-calculator/-mapping blijft ongewijzigd — alleen de
 *     WEERGAVE van haar reeds berekende uitkomst wordt gerouteerd);
 *  8. de boeking in de uiteindelijke P&L exact één keer wordt meegenomen (de
 *     aanroeper sluit de categorie uit bij haar EIGEN P&L-adapter zodra hij
 *     haar elders presenteert — zie `pnlPeriodeOrchestratie.ts`).
 *
 * GEEN 070-SPECIFIEKE CODE HIER, GEEN LEEGSTAND-SPECIFIEKE CODE HIER: deze
 * module kent geen enkele concrete administratie, GL, OGB of P&L-post — die
 * kennis is uitsluitend administratiegebonden DATA (`PnLPresentatieMappingRegel[]`),
 * aangeleverd door de aanroeper (zie `apps/worker`'s presentatiemapping-
 * configuratie voor de concrete, bewezen 070-regel). Iedere nieuwe cross-
 * domain presentatiemapping is een eigen, afzonderlijk bewezen regel — er is
 * geen impliciete overerving tussen administraties of tussen categorieën.
 */

export interface PnLPresentatieMappingRegel {
  bedrijfsnr: string;
  /** Het economische hoofddomein zoals bepaald door de bestaande, ongewijzigde bronmapping (M4b). */
  bronHoofddomein: PnLEconomischeModule;
  /** De economische categorie binnen dat hoofddomein (bv. `SERVICEKOSTEN_LEEGSTAND` onder `SERVICEKOSTEN_EIGENAAR`). */
  bronCategorie: string;
  /** Het hoofddomein waaronder het bedrag wordt GEPRESENTEERD — verandert het bron-hoofddomein niet. */
  doelHoofddomein: PnLEconomischeModule;
  /** De categorie/het onderdeel binnen het doel-hoofddomein waaronder het bedrag wordt gepresenteerd. */
  doelCategorie: string;
}

/**
 * Zoekt de expliciete presentatiemapping voor deze (bedrijfsnr, bronHoofddomein, bronCategorie) —
 * exacte match, geen fuzzy/omschrijvingslogica. `null` = geen routing: het bedrag blijft bij zijn
 * eigen bron-P&L-adapter (het huidige, ongewijzigde gedrag).
 */
export function vindPnLPresentatieRouting(
  regels: readonly PnLPresentatieMappingRegel[],
  bedrijfsnr: string,
  bronHoofddomein: PnLEconomischeModule,
  bronCategorie: string,
): PnLPresentatieMappingRegel | null {
  return regels.find((r) => r.bedrijfsnr === bedrijfsnr && r.bronHoofddomein === bronHoofddomein && r.bronCategorie === bronCategorie) ?? null;
}
