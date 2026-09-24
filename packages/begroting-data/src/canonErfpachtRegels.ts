import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor Canon-erfpacht-regels (OB-034; één regel per bestaand
 * complex) — UITSLUITEND concept-input. Exact het complete-list-save-patroon van
 * `correctiefDagelijksOnderhoudRegels.ts` (zie dat bestand voor de volledige
 * onderbouwing van versie-isolatie en transactiegrens; hier alleen de
 * verschillen).
 *
 * `jaarcanon`/`indexPercentage`: `Decimal | null` — `null` ("niet ingevuld") mag
 * NOOIT stilzwijgend naar `Decimal(0)` (bewust geen erfpacht / 0%) worden
 * omgezet, in geen van beide richtingen.
 *
 * Stabiele ID: `id` is de persistentiesleutel van de regel; koppelingen (nu en
 * later, bv. Estimated) lopen via deze ID of het complexnummer, nooit via
 * arraypositie.
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

/** `id: null` = nieuwe regel. `id: number` = een bestaande regel die aantoonbaar bij DEZE begrotingsversie moet horen. */
export interface CanonErfpachtRegelInvoer {
  id: number | null;
  complexnummer: string;
  grootboekrekening: string;
  ogbKostensoort: string | null;
  jaarcanon: Decimal | null;
  indexPercentage: Decimal | null;
}

export interface CanonErfpachtRegel {
  id: number;
  complexnummer: string;
  grootboekrekening: string;
  ogbKostensoort: string | null;
  jaarcanon: Decimal | null;
  indexPercentage: Decimal | null;
}

interface RegelRow {
  id: number;
  complexnummer: string;
  grootboekrekening: string;
  ogb_kostensoort: string | null;
  jaarcanon: string | null;
  index_percentage: string | null;
}

function rowToRegel(row: RegelRow): CanonErfpachtRegel {
  return {
    id: row.id,
    complexnummer: row.complexnummer,
    grootboekrekening: row.grootboekrekening,
    ogbKostensoort: row.ogb_kostensoort,
    jaarcanon: row.jaarcanon !== null ? new Decimal(row.jaarcanon) : null,
    indexPercentage: row.index_percentage !== null ? new Decimal(row.index_percentage) : null,
  };
}

/** Leest alle regels van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde, geen businessbetekenis. */
export function leesCanonErfpachtRegels(db: DatabaseSync, versieId: string): readonly CanonErfpachtRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, complexnummer, grootboekrekening, ogb_kostensoort, jaarcanon, index_percentage
       FROM begroting_canon_erfpacht_regel
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as RegelRow[];
  return rijen.map(rowToRegel);
}

/**
 * Schrijft de COMPLETE gewenste regellijst voor één begrotingsversie
 * (complete-list save). Faalt vóór elke mutatie als de parent niet bestaat,
 * geen CONCEPT is, een meegegeven bestaande `id` niet bestaat, bij een ANDERE
 * begrotingsversie hoort of dubbel voorkomt. Retourneert de her-gelezen lijst.
 */
export function schrijfCanonErfpachtRegels(
  db: DatabaseSync,
  versieId: string,
  regels: readonly CanonErfpachtRegelInvoer[],
): readonly CanonErfpachtRegel[] {
  const bestaandeIds = regels.map((r) => r.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Begrotingsversie ${versieId}: dezelfde bestaande regel-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd, geen "laatste wint".`,
    );
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status !== "CONCEPT") {
      throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — Canon-erfpacht-regels mogen uitsluitend op een CONCEPT-versie worden geschreven.`);
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_canon_erfpacht_regel WHERE id IN (${placeholders})`)
        .all(...bestaandeIds) as unknown as { id: number; begroting_versie_id: string }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: regel-id ${id} bestaat niet — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(
            `Begrotingsversie ${versieId}: regel-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd, geen enkele mutatie uitgevoerd.`,
          );
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db.prepare(`SELECT id FROM begroting_canon_erfpacht_regel WHERE begroting_versie_id = ?`).all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_canon_erfpacht_regel WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(versieId, ...teVerwijderen);
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_canon_erfpacht_regel
       SET complexnummer = ?, grootboekrekening = ?, ogb_kostensoort = ?, jaarcanon = ?, index_percentage = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_canon_erfpacht_regel (begroting_versie_id, complexnummer, grootboekrekening, ogb_kostensoort, jaarcanon, index_percentage)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const regel of regels) {
      const jaarcanon = regel.jaarcanon !== null ? regel.jaarcanon.toString() : null;
      const indexPercentage = regel.indexPercentage !== null ? regel.indexPercentage.toString() : null;

      if (regel.id === null) {
        insertStmt.run(versieId, regel.complexnummer, regel.grootboekrekening, regel.ogbKostensoort, jaarcanon, indexPercentage);
        continue;
      }

      const info = updateStmt.run(regel.complexnummer, regel.grootboekrekening, regel.ogbKostensoort, jaarcanon, indexPercentage, regel.id, versieId);
      if (Number(info.changes) !== 1) {
        throw new Error(
          `Begrotingsversie ${versieId}: regel-id ${regel.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`,
        );
      }
    }

    return leesCanonErfpachtRegels(db, versieId);
  });
}
