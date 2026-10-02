import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * DELTA BUILD 2 (2026-09-24, FO/UX-conformering): persistentie voor
 * Estimated Correctief/Dagelijks Onderhoud — exact hetzelfde patroon als
 * `geplandOnderhoudEstimated.ts` (zie dat bestand voor de volledige
 * onderbouwing van de transactiegrens, de UPSERT-1-op-1-resterende-
 * verwachting en het bewust ontbreken van een CONCEPT-statuscheck), hier
 * uitsluitend de verschillen ten opzichte van dat patroon.
 *
 * KLEINER REGELMODEL (zelfde reden als Delta Build 1's
 * `correctiefDagelijksOnderhoudRegels.ts`): één `resterend_bedrag` in plaats
 * van Q1-Q4 — GEEN kwartaallogica (OB-028 kent die niet).
 *
 * `resterend_bedrag: TEXT NULL` — `NULL` ("nog niet ingevuld") en expliciet
 * `'0'` (bewust €0) blijven, net als bij Delta Build 1's `jaarbedrag`,
 * technisch onderscheiden in beide richtingen (schrijven én lezen).
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

// ===== Resterende verwachting (1-op-1 met een bestaande regel) =====

export interface CorrectiefDagelijksOnderhoudEstimatedVerwachtingInvoer {
  regelId: number;
  /** `null` = nog niet ingevuld — structureel geldig. Expliciet `Decimal(0)` blijft onderscheiden (zie moduledoc). */
  resterendBedrag: Decimal | null;
}

export interface CorrectiefDagelijksOnderhoudEstimatedVerwachting {
  regelId: number;
  resterendBedrag: Decimal | null;
}

interface VerwachtingRow {
  regel_id: number;
  resterend_bedrag: string | null;
}

function rowToVerwachting(row: VerwachtingRow): CorrectiefDagelijksOnderhoudEstimatedVerwachting {
  return { regelId: row.regel_id, resterendBedrag: row.resterend_bedrag !== null ? new Decimal(row.resterend_bedrag) : null };
}

/** Leest alle resterende-verwachtingsrijen van een begrotingsversie, `ORDER BY regel_id`. */
export function leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db: DatabaseSync, versieId: string): readonly CorrectiefDagelijksOnderhoudEstimatedVerwachting[] {
  const rijen = db
    .prepare(
      `SELECT regel_id, resterend_bedrag
       FROM begroting_correctief_dagelijks_onderhoud_estimated_verwachting
       WHERE begroting_versie_id = ?
       ORDER BY regel_id`,
    )
    .all(versieId) as unknown as VerwachtingRow[];
  return rijen.map(rowToVerwachting);
}

/**
 * Schrijft de COMPLETE gewenste resterende-verwachtingenlijst voor één
 * begrotingsversie (UPSERT-complete-list-save, gekeyed op `regelId`). Faalt
 * vóór elke mutatie als de parent niet bestaat, een meegegeven `regelId` niet
 * bestaat, bij een ANDERE begrotingsversie hoort, of dubbel voorkomt.
 * BEWUST GEEN CONCEPT-check.
 */
export function schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(
  db: DatabaseSync,
  versieId: string,
  verwachtingen: readonly CorrectiefDagelijksOnderhoudEstimatedVerwachtingInvoer[],
): readonly CorrectiefDagelijksOnderhoudEstimatedVerwachting[] {
  const regelIds = verwachtingen.map((v) => v.regelId);
  const duplicaten = [...new Set(regelIds.filter((id, index) => regelIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Begrotingsversie ${versieId}: dezelfde regel-id komt meerdere keren voor in één Estimated-verwachting-save (${duplicaten.join(", ")}) — operatie geweigerd.`,
    );
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }

    if (regelIds.length > 0) {
      const placeholders = regelIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_correctief_dagelijks_onderhoud_regel WHERE id IN (${placeholders})`)
        .all(...regelIds) as unknown as { id: number; begroting_versie_id: string }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of regelIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: regel-id ${id} bestaat niet — Estimated-verwachting-operatie geweigerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(
            `Begrotingsversie ${versieId}: regel-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — Estimated-verwachting-operatie geweigerd.`,
          );
        }
      }
    }

    const behoudenIds = new Set(regelIds);
    const huidigeRijen = db
      .prepare(`SELECT regel_id FROM begroting_correctief_dagelijks_onderhoud_estimated_verwachting WHERE begroting_versie_id = ?`)
      .all(versieId) as unknown as { regel_id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.regel_id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_correctief_dagelijks_onderhoud_estimated_verwachting WHERE begroting_versie_id = ? AND regel_id IN (${placeholders})`).run(
        versieId,
        ...teVerwijderen,
      );
    }

    const upsertStmt = db.prepare(
      `INSERT INTO begroting_correctief_dagelijks_onderhoud_estimated_verwachting (regel_id, begroting_versie_id, resterend_bedrag)
       VALUES (?, ?, ?)
       ON CONFLICT(regel_id) DO UPDATE SET resterend_bedrag = excluded.resterend_bedrag`,
    );
    for (const verwachting of verwachtingen) {
      upsertStmt.run(verwachting.regelId, versieId, verwachting.resterendBedrag !== null ? verwachting.resterendBedrag.toString() : null);
    }

    return leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versieId);
  });
}

// ===== Estimated-only regels =====

/** `id: null` = nieuwe Estimated-only regel. `id: number` = een bestaande Estimated-only regel die aantoonbaar bij DEZE begrotingsversie moet horen. */
export interface CorrectiefDagelijksOnderhoudEstimatedOnlyRegelInvoer {
  id: number | null;
  omschrijving: string;
  complexnummer: string | null;
  grootboekrekening: string;
  ogbKostensoort: string | null;
  resterendBedrag: Decimal | null;
}

export interface CorrectiefDagelijksOnderhoudEstimatedOnlyRegel {
  id: number;
  omschrijving: string;
  complexnummer: string | null;
  grootboekrekening: string;
  ogbKostensoort: string | null;
  resterendBedrag: Decimal | null;
}

interface EstimatedOnlyRegelRow {
  id: number;
  omschrijving: string;
  complexnummer: string | null;
  grootboekrekening: string;
  ogb_kostensoort: string | null;
  resterend_bedrag: string | null;
}

function rowToEstimatedOnlyRegel(row: EstimatedOnlyRegelRow): CorrectiefDagelijksOnderhoudEstimatedOnlyRegel {
  return {
    id: row.id,
    omschrijving: row.omschrijving,
    complexnummer: row.complexnummer,
    grootboekrekening: row.grootboekrekening,
    ogbKostensoort: row.ogb_kostensoort,
    resterendBedrag: row.resterend_bedrag !== null ? new Decimal(row.resterend_bedrag) : null,
  };
}

/** Leest alle Estimated-only regels van een begrotingsversie, `ORDER BY id`. */
export function leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db: DatabaseSync, versieId: string): readonly CorrectiefDagelijksOnderhoudEstimatedOnlyRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, omschrijving, complexnummer, grootboekrekening, ogb_kostensoort, resterend_bedrag
       FROM begroting_correctief_dagelijks_onderhoud_estimated_only_regel
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as EstimatedOnlyRegelRow[];
  return rijen.map(rowToEstimatedOnlyRegel);
}

/**
 * Schrijft de COMPLETE gewenste Estimated-only-regellijst voor één
 * begrotingsversie (complete-list-save — zelfde patroon als
 * `correctiefDagelijksOnderhoudRegels.ts`, maar BEWUST GEEN CONCEPT-check).
 */
export function schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(
  db: DatabaseSync,
  versieId: string,
  regels: readonly CorrectiefDagelijksOnderhoudEstimatedOnlyRegelInvoer[],
): readonly CorrectiefDagelijksOnderhoudEstimatedOnlyRegel[] {
  const bestaandeIds = regels.map((r) => r.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Begrotingsversie ${versieId}: dezelfde bestaande Estimated-only-regel-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd.`,
    );
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_correctief_dagelijks_onderhoud_estimated_only_regel WHERE id IN (${placeholders})`)
        .all(...bestaandeIds) as unknown as { id: number; begroting_versie_id: string }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: Estimated-only-regel-id ${id} bestaat niet — operatie geweigerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(
            `Begrotingsversie ${versieId}: Estimated-only-regel-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd.`,
          );
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db
      .prepare(`SELECT id FROM begroting_correctief_dagelijks_onderhoud_estimated_only_regel WHERE begroting_versie_id = ?`)
      .all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_correctief_dagelijks_onderhoud_estimated_only_regel WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(
        versieId,
        ...teVerwijderen,
      );
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_correctief_dagelijks_onderhoud_estimated_only_regel
       SET omschrijving = ?, complexnummer = ?, grootboekrekening = ?, ogb_kostensoort = ?, resterend_bedrag = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_correctief_dagelijks_onderhoud_estimated_only_regel
         (begroting_versie_id, omschrijving, complexnummer, grootboekrekening, ogb_kostensoort, resterend_bedrag)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const regel of regels) {
      const resterendBedrag = regel.resterendBedrag !== null ? regel.resterendBedrag.toString() : null;

      if (regel.id === null) {
        insertStmt.run(versieId, regel.omschrijving, regel.complexnummer, regel.grootboekrekening, regel.ogbKostensoort, resterendBedrag);
        continue;
      }

      const info = updateStmt.run(regel.omschrijving, regel.complexnummer, regel.grootboekrekening, regel.ogbKostensoort, resterendBedrag, regel.id, versieId);
      if (Number(info.changes) !== 1) {
        throw new Error(
          `Begrotingsversie ${versieId}: Estimated-only-regel-id ${regel.id} kon niet worden bijgewerkt (0 rijen geraakt) — operatie geweigerd, transactie wordt teruggedraaid.`,
        );
      }
    }

    return leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versieId);
  });
}
