import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { berekenEstimatedGemeentelijkeLasten, type EstimatedGemeentelijkeLastenResultaat, type WerkelijkGemeentelijkeLastenResultaat } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import { leesFrozenGemeentelijkeLastenResultaat } from "./frozenGemeentelijkeLastenResultaat.js";
import { leesGemeentelijkeLastenModule } from "./gemeentelijkeLastenModule.js";
import { leesGemeentelijkeLastenRegels } from "./gemeentelijkeLastenRegels.js";
import { leesRelevanteGemeentelijkeLastenGrootboekenVoorAdministratie } from "./gemeentelijkeLastenRelevanteGrootboeken.js";
import { berekenGemeentelijkeLastenUitInvoer } from "./herberekenen.js";
import { leesWozObjecten } from "./wozObjecten.js";

/**
 * Estimated Gemeentelijke lasten (Vervolgtranche 6; Master Contract §6.8): `Estimated = Werkelijk t/m afgesloten
 * periode + handmatig bekende aanvullende aanslag/correctie`. De begrotingspost waartegen wordt vergeleken is de SOM
 * VAN DE GL-REGELS (`grootboekRegels.begroteGemeentelijkeLastenPost`), NOOIT het WOZ-voorstel (besluit na tranche 4).
 *
 * Persistence (migratie 36): één handmatige resterende verwachting per versie — nooit bevroren, geen CONCEPT-check;
 * geen rij = niet ingevuld (onbekend), expliciet €0 = geen aanvullende aanslag verwacht. Estimated muteert de
 * Begroting nooit. De combinatie schrijft niets en bewaart het samengestelde resultaat niet (afgeleid).
 *
 * Lifecycle (bestaand patroon): CONCEPT → begrotingspost uit de concept-regels herberekend; VASTGESTELD → de bevroren
 * post. Een vóór migratie 33 bevroren begroting zonder GL-regels levert een onbekende post (`null`): Estimated blijft
 * berekenbaar uit Werkelijk + verwachting, de afwijking t.o.v. de begroting is onbekend.
 */

export function leesGemeentelijkeLastenEstimatedVerwachting(db: DatabaseSync, versieId: string): Decimal | null {
  const rij = db.prepare(`SELECT resterend_bedrag FROM begroting_gemeentelijke_lasten_estimated_verwachting WHERE begroting_versie_id = ?`).get(versieId) as { resterend_bedrag: string } | undefined;
  return rij === undefined ? null : new Decimal(rij.resterend_bedrag);
}

/** `Decimal` = handmatige verwachting (ook `0`); `null` = niet ingevuld (verwijdert een eventuele rij). Bewust geen CONCEPT-check. */
export function schrijfGemeentelijkeLastenEstimatedVerwachting(db: DatabaseSync, versieId: string, verwachting: Decimal | null): Decimal | null {
  if (verwachting !== null && verwachting.isNaN()) {
    throw new Error(`Begrotingsversie ${versieId}: ongeldige (NaN) resterende verwachting Gemeentelijke lasten — operatie geweigerd.`);
  }
  db.exec("BEGIN");
  try {
    if (leesBegrotingsversie(db, versieId) === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (verwachting === null) {
      db.prepare(`DELETE FROM begroting_gemeentelijke_lasten_estimated_verwachting WHERE begroting_versie_id = ?`).run(versieId);
    } else {
      db.prepare(
        `INSERT INTO begroting_gemeentelijke_lasten_estimated_verwachting (begroting_versie_id, resterend_bedrag) VALUES (?, ?)
         ON CONFLICT(begroting_versie_id) DO UPDATE SET resterend_bedrag = excluded.resterend_bedrag`,
      ).run(versieId, verwachting.toString());
    }
    const resultaat = leesGemeentelijkeLastenEstimatedVerwachting(db, versieId);
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** De begrotingspost (som van de GL-regels) volgens de lifecycle van de versie; `null` = onbekend. Leest, schrijft nooit. */
function leesBegrotingsPost(db: DatabaseSync, versieId: string): Decimal | null {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status === "VASTGESTELD") {
    const frozen = leesFrozenGemeentelijkeLastenResultaat(db, versieId);
    if (frozen === null) {
      throw new Error(`Begrotingsversie ${versieId} is VASTGESTELD, maar de bevroren Gemeentelijke-lasten-output ontbreekt (interne inconsistentie).`);
    }
    return frozen.grootboekRegels === null ? null : frozen.grootboekRegels.begroteGemeentelijkeLastenPost;
  }
  const resultaat = berekenGemeentelijkeLastenUitInvoer(
    versieId,
    versie.begrotingsjaar,
    leesWozObjecten(db, versieId),
    leesGemeentelijkeLastenModule(db, versieId),
    leesGemeentelijkeLastenRegels(db, versieId),
    leesRelevanteGemeentelijkeLastenGrootboekenVoorAdministratie(db, versie.bedrijfsnr, versie.begrotingsjaar),
  );
  return resultaat.grootboekRegels.begroteGemeentelijkeLastenPost;
}

/** Leest begrotingspost (volgens lifecycle) + actuele handmatige verwachting in één leestransactie en rekent via de bestaande pure calculator. */
export function leesGemeentelijkeLastenEstimatedResultaat(
  db: DatabaseSync,
  versieId: string,
  werkelijk: WerkelijkGemeentelijkeLastenResultaat,
  werkelijkDekkingBevestigd: boolean,
): EstimatedGemeentelijkeLastenResultaat {
  db.exec("BEGIN");
  let post: Decimal | null;
  let verwachting: Decimal | null;
  try {
    post = leesBegrotingsPost(db, versieId);
    verwachting = leesGemeentelijkeLastenEstimatedVerwachting(db, versieId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return berekenEstimatedGemeentelijkeLasten(post, werkelijk, werkelijkDekkingBevestigd, { GEMEENTELIJKE_LASTEN: verwachting });
}
