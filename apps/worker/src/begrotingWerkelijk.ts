import type { DatabaseSync } from "node:sqlite";
import {
  bepaalResterendeKwartalen,
  bepaalResterendeMaanden,
  bouwEstimatedPnLInvoer,
  leesVastgesteldeBegrotingsversieVoorJaar,
  leesVergelijkendeBegrotingsPnL,
  type Begrotingsversie,
  type VergelijkendeBegrotingsPnLResultaat,
} from "@bvc/begroting-data";
import { haalPnLPeriodeResultaatOp } from "./genereerPnLPeriode.js";

/**
 * TRANCHE 11 — dunne orchestratielaag die de bestaande, geaccepteerde productie-Werkelijk-
 * ophaal (`haalPnLPeriodeResultaatOp`, ongewijzigd) verbindt met de nieuwe vergelijkende
 * begrotings-P&L (`@bvc/begroting-data`'s `leesVergelijkendeBegrotingsPnL`). Rekent zelf niets:
 * bepaalt uitsluitend WELKE periode ("huidig jaar" = `nieuweVersie.begrotingsjaar - 1`, t/m de
 * expliciet meegegeven laatst afgesloten boekperiode — CLAUDE.md §6, periodekeuze altijd
 * expliciet) en WELKE vorigjaarversie (de VASTGESTELDE begroting van hetzelfde jaar, indien die
 * bestaat) relevant zijn, en geeft ze door.
 */
export function leesBegrotingsWerkomgeving(
  root: string,
  administratieId: string,
  bedrijfsnr: string,
  db: DatabaseSync,
  nieuweVersie: Begrotingsversie,
  laatstAfgeslotenBoekperiode: string,
): VergelijkendeBegrotingsPnLResultaat {
  const huidigJaar = nieuweVersie.begrotingsjaar - 1;
  const periode = haalPnLPeriodeResultaatOp(root, administratieId, { boekjaar: huidigJaar, boekperiodeTotEnMet: laatstAfgeslotenBoekperiode });
  const estimatedInvoer = bouwEstimatedPnLInvoer(periode.moduleWerkelijk, bepaalResterendeMaanden(laatstAfgeslotenBoekperiode), bepaalResterendeKwartalen(laatstAfgeslotenBoekperiode));
  const vorigJaarVersie = leesVastgesteldeBegrotingsversieVoorJaar(db, bedrijfsnr, huidigJaar);
  return leesVergelijkendeBegrotingsPnL(db, { nieuweVersieId: nieuweVersie.id, vorigJaarVersieId: vorigJaarVersie?.id ?? null }, periode.resultaat, estimatedInvoer);
}
