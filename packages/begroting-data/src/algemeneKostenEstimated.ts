import type { DatabaseSync } from "node:sqlite";
import {
  berekenEstimatedAlgemeneKosten,
  type BgAlgemeneKostenResultaat,
  type EstimatedAlgemeneKostenResultaat,
  type WerkelijkAlgemeneKostenResultaat,
} from "@bvc/reporting";
import { leesAlgemeneKostenCategorieState } from "./algemeneKostenCategorieState.js";
import { leesAlgemeneKostenClassificatie } from "./algemeneKostenClassificatie.js";
import { leesAlgemeneKostenEstimatedVerwachting, type AlgemeneKostenEstimatedVerwachting } from "./algemeneKostenEstimatedVerwachting.js";
import { leesAlgemeneKostenRegels } from "./algemeneKostenRegels.js";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import { leesFrozenAlgemeneKostenResultaat } from "./frozenAlgemeneKostenResultaat.js";
import { berekenAlgemeneKostenUitInvoer, type HerberekendAlgemeneKostenResultaat } from "./herberekenen.js";

/**
 * Estimated Algemene kosten (Vervolgtranche 5; FO OB-030/035/036): koppelt de Begroting van de versie, de
 * persistente handmatige resterende verwachting per post en het aangeleverde Werkelijk aan de bestaande pure
 * `berekenEstimatedAlgemeneKosten`. DUNNE laag: geen eigen financiële regels, schrijft NOOIT, slaat het samengestelde
 * resultaat niet op (afgeleid).
 *
 * Lifecycle (bestaand patroon, zoals `verzekeringEstimated.ts`): CONCEPT → Begroting herberekend uit de concept-regels;
 * VASTGESTELD → de bevroren Begroting-output (immutable). De handmatige verwachting wordt altijd ACTUEEL gelezen en
 * muteert de Begroting nooit; `begrotingTotaal` per post is de ongewijzigde doorgifte van de Begroting.
 *
 * Werkelijk is een aangeleverd bronfeit op MODULENIVEAU (uit Boekingen via de centrale mapping) en telt exact éénmaal
 * mee; `werkelijkDekkingBevestigd` blijft de expliciete voorwaarde van de pure calculator. Een post zonder
 * (bewezen) Werkelijk-mapping levert zo geen geraden Estimated op, maar `null` (onbekend).
 */

export interface AlgemeneKostenEstimatedInvoer {
  begroting: BgAlgemeneKostenResultaat;
  verwachting: AlgemeneKostenEstimatedVerwachting;
  werkelijk: WerkelijkAlgemeneKostenResultaat;
  werkelijkDekkingBevestigd: boolean;
}

/** Herberekend/bevroren resultaat (met regel-ids) terug naar de pure vorm — alleen de regel-uitkomsten worden uitgepakt. */
function naarPureBegroting(begroting: HerberekendAlgemeneKostenResultaat): BgAlgemeneKostenResultaat {
  return { ...begroting, perCategorie: begroting.perCategorie.map((c) => ({ ...c, regels: c.regels.map((r) => r.regel) })) };
}

/** PURE combinatie (geen I/O): rekent via de bestaande pure Estimated-calculator. */
export function combineerAlgemeneKostenEstimated(invoer: AlgemeneKostenEstimatedInvoer): EstimatedAlgemeneKostenResultaat {
  return berekenEstimatedAlgemeneKosten(invoer.begroting, invoer.werkelijk, invoer.werkelijkDekkingBevestigd, invoer.verwachting);
}

/** Leest Begroting (volgens lifecycle) + actuele handmatige verwachting in één leestransactie en combineert; schrijft nooit. */
export function leesAlgemeneKostenEstimatedResultaat(
  db: DatabaseSync,
  versieId: string,
  werkelijk: WerkelijkAlgemeneKostenResultaat,
  werkelijkDekkingBevestigd: boolean,
): EstimatedAlgemeneKostenResultaat {
  db.exec("BEGIN");
  let invoer: AlgemeneKostenEstimatedInvoer;
  try {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    let begroting: HerberekendAlgemeneKostenResultaat;
    if (versie.status === "VASTGESTELD") {
      const frozen = leesFrozenAlgemeneKostenResultaat(db, versieId);
      if (frozen === null) {
        throw new Error(`Begrotingsversie ${versieId} is VASTGESTELD, maar de bevroren Algemene-kosten-output ontbreekt (interne inconsistentie).`);
      }
      begroting = frozen;
    } else {
      begroting = berekenAlgemeneKostenUitInvoer(
        versieId,
        versie.begrotingsjaar,
        leesAlgemeneKostenRegels(db, versieId),
        leesAlgemeneKostenCategorieState(db, versieId),
        leesAlgemeneKostenClassificatie(db, versie.bedrijfsnr),
      );
    }
    invoer = { begroting: naarPureBegroting(begroting), verwachting: leesAlgemeneKostenEstimatedVerwachting(db, versieId), werkelijk, werkelijkDekkingBevestigd };
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return combineerAlgemeneKostenEstimated(invoer);
}
