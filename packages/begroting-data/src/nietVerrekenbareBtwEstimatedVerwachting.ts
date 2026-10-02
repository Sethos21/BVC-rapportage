import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { berekenEstimatedNietVerrekenbareBtw, type EstimatedNietVerrekenbareBtwResultaat, type WerkelijkNietVerrekenbareBtwResultaat } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de handmatige resterende verwachting van Estimated Niet verrekenbare BTW (technische afsluiting
 * Tranche 9, Master Contract §7 — definitief businessbesluit 29-09-2026): één bedrag per begrotingsversie, GEEN
 * categorieën, GEEN kwartaal-/maandverdeling — exact het patroon van `gemeentelijkeLastenEstimatedVerwachting.ts`
 * (migratie 35/36).
 *
 * BEWUST GEEN VASTGESTELD-triggers en geen CONCEPT-check (migratie 39): Estimated blijft het hele jaar wijzigbaar en
 * wordt NOOIT bevroren; de vastgestelde Begroting wordt er nooit door gemuteerd. Geen rij = niet ingevuld (onbekend,
 * nooit stil €0); expliciet `Decimal(0)` is een geldige, bekende keuze ("geen resterende BTW meer verwacht").
 */

/** Leest de handmatige resterende verwachting. `null` = nog niet ingevuld — werkt op elke versiestatus. */
export function leesNietVerrekenbareBtwEstimatedVerwachting(db: DatabaseSync, versieId: string): Decimal | null {
  const rij = db.prepare(`SELECT resterend_bedrag FROM begroting_niet_verrekenbare_btw_estimated_verwachting WHERE begroting_versie_id = ?`).get(versieId) as { resterend_bedrag: string } | undefined;
  return rij === undefined ? null : new Decimal(rij.resterend_bedrag);
}

/** `Decimal` = handmatige verwachting (ook `0`); `null` = niet ingevuld (verwijdert een eventuele rij). Bewust geen CONCEPT-check. */
export function schrijfNietVerrekenbareBtwEstimatedVerwachting(db: DatabaseSync, versieId: string, verwachting: Decimal | null): Decimal | null {
  if (verwachting !== null && verwachting.isNaN()) {
    throw new Error(`Begrotingsversie ${versieId}: ongeldige (NaN) resterende verwachting Niet verrekenbare BTW — operatie geweigerd.`);
  }
  db.exec("BEGIN");
  try {
    if (leesBegrotingsversie(db, versieId) === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (verwachting === null) {
      db.prepare(`DELETE FROM begroting_niet_verrekenbare_btw_estimated_verwachting WHERE begroting_versie_id = ?`).run(versieId);
    } else {
      db.prepare(
        `INSERT INTO begroting_niet_verrekenbare_btw_estimated_verwachting (begroting_versie_id, resterend_bedrag) VALUES (?, ?)
         ON CONFLICT(begroting_versie_id) DO UPDATE SET resterend_bedrag = excluded.resterend_bedrag`,
      ).run(versieId, verwachting.toString());
    }
    const resultaat = leesNietVerrekenbareBtwEstimatedVerwachting(db, versieId);
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Leest de actuele handmatige verwachting en combineert via de bestaande pure `berekenEstimatedNietVerrekenbareBtw`.
 * GEEN Begroting-lezing nodig: het businessbesluit (Master Contract §7) definieert Estimated uitsluitend als
 * Werkelijk + handmatige verwachting, zonder vergelijking met de Begroting (bewust anders dan Gemeentelijke
 * Lasten/Algemene Kosten, waar een `begrotingTotaal`/`afwijking`-veld puur informatief wordt meegevoerd maar door
 * geen enkele P&L-adapter wordt gebruikt — die niet-gevraagde vergelijking is hier bewust niet gekopieerd).
 */
export function leesNietVerrekenbareBtwEstimatedResultaat(
  db: DatabaseSync,
  versieId: string,
  werkelijk: WerkelijkNietVerrekenbareBtwResultaat,
  werkelijkDekkingBevestigd: boolean,
): EstimatedNietVerrekenbareBtwResultaat {
  const verwachting = leesNietVerrekenbareBtwEstimatedVerwachting(db, versieId);
  return berekenEstimatedNietVerrekenbareBtw(werkelijk, werkelijkDekkingBevestigd, verwachting);
}
