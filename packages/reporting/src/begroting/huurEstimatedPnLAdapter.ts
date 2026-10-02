import type { EstimatedHuurResultaat } from "./begroteHuurEstimated.js";
import { HUUR_NIET_GECLASSIFICEERD_SLEUTEL } from "./huurWerkelijkPnLAdapter.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * Estimated Huur → pure P&L (Vervolgtranche 7): dezelfde drie regels en dezelfde sleutels als de Werkelijk-adapter
 * (`huurWerkelijkNaarPnLBovenEbitdaRegels`), zodat Werkelijk en Estimated in exact dezelfde P&L-regels terechtkomen:
 * HUUROPBRENGST_BELAST en HUUROPBRENGST_ONBELAST (bruto, positief) en VERLEENDE_HUURKORTING (aftrekpost, negatief).
 * De korting staat dus precies één keer in de boom en niet ook nog in een netto-bedrag; het totaal is de netto huur.
 *
 * Geen tekenomkering hier: `EstimatedHuurResultaat` is al in P&L-richting (die ene omkering gebeurt in de calculator).
 * ONBEKEND blijft ONBEKEND: onbevestigde Werkelijk-dekking → NIET_GEMAPT; onbetrouwbare Begroting-basis →
 * GEEN_BEOORDELING. Resterende huur van contracten met onbekende BTW-classificatie komt als een aparte ONBEKEND-regel
 * (`HUUR_NIET_GECLASSIFICEERD`) in de boom — nooit toegewezen aan belast/onbelast en nooit stil weggelaten.
 */
export function huurEstimatedNaarPnLBovenEbitdaRegels(resultaat: EstimatedHuurResultaat): PurePnLBovenEbitdaRegel[] {
  const regels: PurePnLBovenEbitdaRegel[] = resultaat.perCategorie.map((c): PurePnLBovenEbitdaRegel => {
    let waarde: PnLBronBijdrage;
    if (c.estimatedTotaal !== null) {
      waarde = { status: "BEKEND", bedrag: c.estimatedTotaal };
    } else if (!resultaat.werkelijkVoldoendeBekend) {
      waarde = { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: `Estimated Huur (${c.categorie}): Werkelijk-dekking voor de afgesloten periode is niet voldoende bevestigd.` };
    } else {
      waarde = { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Estimated Huur (${c.categorie}): de Begroting-huur waarop de resterende verwachting rust is niet betrouwbaar.` };
    }
    return { regelSleutel: c.categorie, boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde };
  });

  if (!resultaat.resterendNettoOnbekendeBtw.isZero()) {
    regels.push({
      regelSleutel: HUUR_NIET_GECLASSIFICEERD_SLEUTEL,
      boomPositie: "BOVEN_EBITDA",
      groep: "OPBRENGSTEN",
      contributieAard: "OPBRENGST",
      waarde: {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Estimated Huur: resterend netto ${resultaat.resterendNettoOnbekendeBtw.toString()} van contracten met onbekende belast/onbelast-classificatie — niet toe te rekenen aan belast of onbelast.`,
      },
    });
  }
  return regels;
}
