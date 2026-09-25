import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de handmatige Estimated-aanpassing PER POLIS (Verzekeringen,
 * besluit 2026-09-25): de handmatige resterende verwachting van één polis.
 * Exact het Estimated-patroon van `geplandOnderhoudEstimated.ts`:
 *  - BEWUST GEEN CONCEPT-statuscheck en NOOIT bevroren — Estimated blijft het
 *    hele jaar wijzigbaar en muteert de vastgestelde Begroting nooit;
 *  - koppeling uitsluitend via de stabiele `regel_id` (PRIMARY KEY + FK ON
 *    DELETE CASCADE naar `begroting_verzekering_regel`), nooit via positie.
 *
 * "Geen rij" = geen handmatige aanpassing (het automatische voorstel geldt).
 * Een rij bevat altijd een bedrag (NOT NULL): expliciet €0 is een geldige
 * handmatige verwachting ("geen premie meer verwacht") en verschilt daarmee
 * technisch van "geen aanpassing" — er is bewust maar één representatie voor
 * "geen aanpassing" (rij ontbreekt).
 */

function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const resultaat = fn();
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export interface VerzekeringEstimatedPolisInvoer {
  regelId: number;
  handmatigeResterendeVerwachting: Decimal;
}

export interface VerzekeringEstimatedPolis {
  regelId: number;
  handmatigeResterendeVerwachting: Decimal;
}

interface Row {
  regel_id: number;
  handmatige_resterende_verwachting: string;
}

/** Leest alle handmatige per-polis-aanpassingen van een begrotingsversie, `ORDER BY regel_id`. */
export function leesVerzekeringEstimatedPolissen(db: DatabaseSync, versieId: string): readonly VerzekeringEstimatedPolis[] {
  const rijen = db
    .prepare(
      `SELECT regel_id, handmatige_resterende_verwachting
       FROM begroting_verzekering_estimated_polis
       WHERE begroting_versie_id = ?
       ORDER BY regel_id`,
    )
    .all(versieId) as unknown as Row[];
  return rijen.map((r) => ({ regelId: r.regel_id, handmatigeResterendeVerwachting: new Decimal(r.handmatige_resterende_verwachting) }));
}

/**
 * Schrijft de COMPLETE gewenste lijst handmatige aanpassingen voor één
 * begrotingsversie (UPSERT-complete-list-save, gekeyed op `regelId`); een
 * weggelaten polis verliest haar handmatige aanpassing. Faalt vóór elke
 * mutatie als de versie niet bestaat, een `regelId` niet bestaat of bij een
 * ANDERE versie hoort, of dubbel voorkomt. BEWUST GEEN CONCEPT-check.
 */
export function schrijfVerzekeringEstimatedPolissen(
  db: DatabaseSync,
  versieId: string,
  polissen: readonly VerzekeringEstimatedPolisInvoer[],
): readonly VerzekeringEstimatedPolis[] {
  const regelIds = polissen.map((p) => p.regelId);
  const duplicaten = [...new Set(regelIds.filter((id, index) => regelIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(`Begrotingsversie ${versieId}: dezelfde regel-id komt meerdere keren voor in één Estimated-polis-save (${duplicaten.join(", ")}) — operatie geweigerd.`);
  }
  const ongeldig = polissen.find((p) => p.handmatigeResterendeVerwachting.isNaN());
  if (ongeldig !== undefined) {
    throw new Error(`Begrotingsversie ${versieId}: regel-id ${ongeldig.regelId} heeft een ongeldige (NaN) handmatige resterende verwachting — operatie geweigerd.`);
  }

  return withTransaction(db, () => {
    if (leesBegrotingsversie(db, versieId) === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }

    if (regelIds.length > 0) {
      const placeholders = regelIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_verzekering_regel WHERE id IN (${placeholders})`)
        .all(...regelIds) as unknown as { id: number; begroting_versie_id: string }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));
      for (const id of regelIds) {
        const eigenaar = eigenaarPerId.get(id);
        if (eigenaar === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: regel-id ${id} bestaat niet — Estimated-polis-operatie geweigerd.`);
        }
        if (eigenaar !== versieId) {
          throw new Error(`Begrotingsversie ${versieId}: regel-id ${id} behoort bij begrotingsversie ${eigenaar}, niet bij deze versie — Estimated-polis-operatie geweigerd.`);
        }
      }
    }

    const behouden = new Set(regelIds);
    const huidige = db.prepare(`SELECT regel_id FROM begroting_verzekering_estimated_polis WHERE begroting_versie_id = ?`).all(versieId) as unknown as { regel_id: number }[];
    const teVerwijderen = huidige.map((r) => r.regel_id).filter((id) => !behouden.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_verzekering_estimated_polis WHERE begroting_versie_id = ? AND regel_id IN (${placeholders})`).run(versieId, ...teVerwijderen);
    }

    const upsert = db.prepare(
      `INSERT INTO begroting_verzekering_estimated_polis (regel_id, begroting_versie_id, handmatige_resterende_verwachting)
       VALUES (?, ?, ?)
       ON CONFLICT(regel_id) DO UPDATE SET handmatige_resterende_verwachting = excluded.handmatige_resterende_verwachting`,
    );
    for (const polis of polissen) {
      upsert.run(polis.regelId, versieId, polis.handmatigeResterendeVerwachting.toString());
    }

    return leesVerzekeringEstimatedPolissen(db, versieId);
  });
}
