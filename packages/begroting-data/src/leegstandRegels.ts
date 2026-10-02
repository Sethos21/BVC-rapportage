import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgLeegstandCategorie } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de Leegstandskosten-begrotingsregels (OB-031) —
 * UITSLUITEND concept-input. GEEN pure-calculator-integratie, GEEN concept-
 * herberekening, GEEN frozen output — die volgen in `herberekenen.ts`/
 * `frozenLeegstandResultaat.ts`.
 *
 * Exact hetzelfde complete-list-save-patroon als `algemeneKostenRegels.ts`
 * (OB-035/036) — hier uitsluitend de Leegstandskosten-specifieke verschillen:
 * GEEN OGB-koppeling op de regel (zie migratie 18/`begroteLeegstand.ts`'s
 * moduledoc), WEL `complexomschrijving` (puur presentatie naast
 * `complexnummer`) en vier kwartaalbedragen `q1`..`q4` i.p.v. één
 * `jaarbedrag`. `omschrijving` blijft bewust NOT NULL (lege string = "nog
 * niet ingevuld"). `complexnummer`/`complexomschrijving`/`q1`..`q4` blijven
 * NULLABLE.
 *
 * VERSIE-ISOLATIE EN TRANSACTIEGRENS: identiek aan de eerdere modules.
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

/** `id: null` = nieuwe regel (SQLite kent een verse rowid toe). `id: number` = een bestaande regel die aantoonbaar bij DEZE begrotingsversie moet horen. */
export interface LeegstandRegelInvoer {
  id: number | null;
  categorie: BgLeegstandCategorie;
  complexnummer: string | null;
  complexomschrijving: string | null;
  omschrijving: string;
  q1: Decimal | null;
  q2: Decimal | null;
  q3: Decimal | null;
  q4: Decimal | null;
}

export interface LeegstandRegel {
  id: number;
  categorie: BgLeegstandCategorie;
  complexnummer: string | null;
  complexomschrijving: string | null;
  omschrijving: string;
  q1: Decimal | null;
  q2: Decimal | null;
  q3: Decimal | null;
  q4: Decimal | null;
}

interface LeegstandRegelRow {
  id: number;
  categorie: BgLeegstandCategorie;
  complexnummer: string | null;
  complexomschrijving: string | null;
  omschrijving: string;
  q1: string | null;
  q2: string | null;
  q3: string | null;
  q4: string | null;
}

function rowToLeegstandRegel(row: LeegstandRegelRow): LeegstandRegel {
  return {
    id: row.id,
    categorie: row.categorie,
    complexnummer: row.complexnummer,
    complexomschrijving: row.complexomschrijving,
    omschrijving: row.omschrijving,
    q1: row.q1 !== null ? new Decimal(row.q1) : null,
    q2: row.q2 !== null ? new Decimal(row.q2) : null,
    q3: row.q3 !== null ? new Decimal(row.q3) : null,
    q4: row.q4 !== null ? new Decimal(row.q4) : null,
  };
}

/** Leest alle Leegstandskosten-regels van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde, geen businessbetekenis. */
export function leesLeegstandRegels(db: DatabaseSync, versieId: string): readonly LeegstandRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, categorie, complexnummer, complexomschrijving, omschrijving, q1, q2, q3, q4
       FROM begroting_leegstand_regel
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as LeegstandRegelRow[];
  return rijen.map(rowToLeegstandRegel);
}

/**
 * Schrijft de COMPLETE gewenste Leegstandskosten-regellijst voor één
 * begrotingsversie (complete-list save). Faalt vóór elke mutatie als de
 * parent niet bestaat, geen CONCEPT is, een meegegeven bestaande `id` niet
 * bestaat, bij een ANDERE begrotingsversie hoort, of dubbel voorkomt in
 * dezelfde aanroep.
 */
export function schrijfLeegstandRegels(db: DatabaseSync, versieId: string, regels: readonly LeegstandRegelInvoer[]): readonly LeegstandRegel[] {
  const bestaandeIds = regels.map((r) => r.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Begrotingsversie ${versieId}: dezelfde bestaande Leegstand-regel-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd, geen "laatste wint".`,
    );
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status !== "CONCEPT") {
      throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — Leegstand-regels mogen uitsluitend op een CONCEPT-versie worden geschreven.`);
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db.prepare(`SELECT id, begroting_versie_id FROM begroting_leegstand_regel WHERE id IN (${placeholders})`).all(...bestaandeIds) as unknown as {
        id: number;
        begroting_versie_id: string;
      }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: Leegstand-regel-id ${id} bestaat niet — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(
            `Begrotingsversie ${versieId}: Leegstand-regel-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd, geen enkele mutatie uitgevoerd.`,
          );
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db.prepare(`SELECT id FROM begroting_leegstand_regel WHERE begroting_versie_id = ?`).all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_leegstand_regel WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(versieId, ...teVerwijderen);
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_leegstand_regel
       SET categorie = ?, complexnummer = ?, complexomschrijving = ?, omschrijving = ?, q1 = ?, q2 = ?, q3 = ?, q4 = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_leegstand_regel
         (begroting_versie_id, categorie, complexnummer, complexomschrijving, omschrijving, q1, q2, q3, q4)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const regel of regels) {
      const q1 = regel.q1 !== null ? regel.q1.toString() : null;
      const q2 = regel.q2 !== null ? regel.q2.toString() : null;
      const q3 = regel.q3 !== null ? regel.q3.toString() : null;
      const q4 = regel.q4 !== null ? regel.q4.toString() : null;

      if (regel.id === null) {
        insertStmt.run(versieId, regel.categorie, regel.complexnummer, regel.complexomschrijving, regel.omschrijving, q1, q2, q3, q4);
        continue;
      }

      // Versiegebonden update: de WHERE-clausule bewijst de versie-isolatie opnieuw, onafhankelijk van de
      // vooraf-ownership-check hierboven (zelfde patroon als eerdere modules).
      const info = updateStmt.run(regel.categorie, regel.complexnummer, regel.complexomschrijving, regel.omschrijving, q1, q2, q3, q4, regel.id, versieId);
      if (Number(info.changes) !== 1) {
        throw new Error(
          `Begrotingsversie ${versieId}: Leegstand-regel-id ${regel.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`,
        );
      }
    }

    return leesLeegstandRegels(db, versieId);
  });
}
