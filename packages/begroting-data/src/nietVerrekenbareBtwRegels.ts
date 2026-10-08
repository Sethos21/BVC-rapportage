import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de Niet-Verrekenbare-BTW-begrotingsregels (Vervolgtranche 9 Deel B) —
 * UITSLUITEND concept-input. GEEN pure-calculator-integratie (`@bvc/reporting`'s
 * `berekenBegroteNietVerrekenbareBtw` wordt hier NERGENS aangeroepen), GEEN concept-
 * herberekening, GEEN frozen output — die volgen in `herberekenen.ts`/
 * `frozenNietVerrekenbareBtwResultaat.ts`.
 *
 * Exact hetzelfde complete-list-save-patroon als `algemeneKostenRegels.ts`/`verzekeringRegels.ts`
 * — zie die bestanden voor de volledige onderbouwing van de transactiegrens en de
 * versie-isolatie. GEEN OGB-koppeling (geen classificatieconcept voor deze post, zie
 * `begroteNietVerrekenbareBtw.ts`'s moduledoc).
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
export interface NietVerrekenbareBtwRegelInvoer {
  id: number | null;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: Decimal | null;
}

export interface NietVerrekenbareBtwRegel {
  id: number;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: Decimal | null;
}

interface NietVerrekenbareBtwRegelRow {
  id: number;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: string | null;
}

function rowToRegel(row: NietVerrekenbareBtwRegelRow): NietVerrekenbareBtwRegel {
  return { id: row.id, omschrijving: row.omschrijving, complexnummer: row.complexnummer, jaarbedrag: row.jaarbedrag !== null ? new Decimal(row.jaarbedrag) : null };
}

/** Leest alle Niet-Verrekenbare-BTW-regels van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde, geen businessbetekenis. */
export function leesNietVerrekenbareBtwRegels(db: DatabaseSync, versieId: string): readonly NietVerrekenbareBtwRegel[] {
  const rijen = db
    .prepare(`SELECT id, omschrijving, complexnummer, jaarbedrag FROM begroting_niet_verrekenbare_btw_regel WHERE begroting_versie_id = ? ORDER BY id`)
    .all(versieId) as unknown as NietVerrekenbareBtwRegelRow[];
  return rijen.map(rowToRegel);
}

/**
 * Schrijft de COMPLETE gewenste regellijst voor één begrotingsversie (complete-list save — geen
 * los toevoegen/wijzigen/verwijderen-API). Faalt vóór elke mutatie als de parent niet bestaat,
 * geen CONCEPT is, een meegegeven bestaande `id` niet bestaat, bij een ANDERE begrotingsversie
 * hoort, of dubbel voorkomt in dezelfde aanroep. Retourneert de resulterende regellijst (met,
 * voor nieuwe regels, het vers toegekende `id`).
 */
export function schrijfNietVerrekenbareBtwRegels(db: DatabaseSync, versieId: string, regels: readonly NietVerrekenbareBtwRegelInvoer[]): readonly NietVerrekenbareBtwRegel[] {
  const bestaandeIds = regels.map((r) => r.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(`Begrotingsversie ${versieId}: dezelfde bestaande Niet-Verrekenbare-BTW-regel-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd, geen "laatste wint".`);
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status !== "CONCEPT") {
      throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — Niet-Verrekenbare-BTW-regels mogen uitsluitend op een CONCEPT-versie worden geschreven.`);
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db.prepare(`SELECT id, begroting_versie_id FROM begroting_niet_verrekenbare_btw_regel WHERE id IN (${placeholders})`).all(...bestaandeIds) as unknown as {
        id: number;
        begroting_versie_id: string;
      }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: Niet-Verrekenbare-BTW-regel-id ${id} bestaat niet — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(`Begrotingsversie ${versieId}: Niet-Verrekenbare-BTW-regel-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db.prepare(`SELECT id FROM begroting_niet_verrekenbare_btw_regel WHERE begroting_versie_id = ?`).all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_niet_verrekenbare_btw_regel WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(versieId, ...teVerwijderen);
    }

    const updateStmt = db.prepare(`UPDATE begroting_niet_verrekenbare_btw_regel SET omschrijving = ?, complexnummer = ?, jaarbedrag = ? WHERE id = ? AND begroting_versie_id = ?`);
    const insertStmt = db.prepare(`INSERT INTO begroting_niet_verrekenbare_btw_regel (begroting_versie_id, omschrijving, complexnummer, jaarbedrag) VALUES (?, ?, ?, ?)`);

    for (const regel of regels) {
      const jaarbedrag = regel.jaarbedrag !== null ? regel.jaarbedrag.toString() : null;

      if (regel.id === null) {
        insertStmt.run(versieId, regel.omschrijving, regel.complexnummer, jaarbedrag);
        continue;
      }

      const info = updateStmt.run(regel.omschrijving, regel.complexnummer, jaarbedrag, regel.id, versieId);
      if (Number(info.changes) !== 1) {
        throw new Error(`Begrotingsversie ${versieId}: Niet-Verrekenbare-BTW-regel-id ${regel.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`);
      }
    }

    return leesNietVerrekenbareBtwRegels(db, versieId);
  });
}
