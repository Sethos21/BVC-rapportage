import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor Correctief/Dagelijks-Onderhoud-regels — fase CD-P1
 * (OB-028), UITSLUITEND concept-input. GEEN pure-calculator-integratie
 * (`@bvc/reporting`'s `berekenBegroteCorrectiefDagelijksOnderhoud` wordt
 * hier NERGENS aangeroepen), GEEN frozen output — die volgen pas in een
 * latere, apart te reviewen fase (CD-P3). Exact hetzelfde
 * complete-list-save-patroon als `geplandOnderhoudActiviteiten.ts` (GO-P1)
 * — zie dat bestand voor de volledige onderbouwing van de transactiegrens
 * en de versie-isolatie; hier uitsluitend de verschillen ten opzichte van
 * dat patroon.
 *
 * KLEINER REGELMODEL DAN GEPLAND ONDERHOUD (bewust, zie
 * `begroteCorrectiefDagelijksOnderhoud.ts`'s moduledoc): drie velden
 * (`omschrijving`, `complexnummer`, `jaarbedrag`) in plaats van GO's
 * twaalf — geen Q1-Q4, geen status/aanleiding/leverancier/offertebedrag/
 * notitie.
 *
 * `jaarbedrag: Decimal | null` — HIER IS DE HONESTE ROUND-TRIP HET
 * BELANGRIJKSTE VERSCHIL MET GO-P1: `null` (nog niet ingevuld) mag NOOIT
 * stilzwijgend naar `Decimal(0)` (bewust €0) worden omgezet, in geen van
 * beide richtingen (schrijven én lezen). `row.jaarbedrag === null` levert
 * dus `null` terug, nooit `new Decimal(0)`.
 *
 * `complexnummer: string | null` — `null` = NTB (nader te bepalen),
 * structureel geldig (OB028-003), geen validatie op dit veld.
 *
 * VERSIE-ISOLATIE EN TRANSACTIEGRENS: identiek aan GO-P1
 * (`geplandOnderhoudActiviteiten.ts`) — dezelfde dubbele beschermingslaag
 * (vooraf-ownership-check binnen de transactie + versiegebonden UPDATE met
 * `changes === 1`-guard), dezelfde duplicate-id-check vóór `BEGIN`.
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
export interface CorrectiefDagelijksOnderhoudRegelInvoer {
  id: number | null;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: Decimal | null;
}

export interface CorrectiefDagelijksOnderhoudRegel {
  id: number;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: Decimal | null;
}

interface RegelRow {
  id: number;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: string | null;
}

function rowToRegel(row: RegelRow): CorrectiefDagelijksOnderhoudRegel {
  return {
    id: row.id,
    omschrijving: row.omschrijving,
    complexnummer: row.complexnummer,
    jaarbedrag: row.jaarbedrag !== null ? new Decimal(row.jaarbedrag) : null,
  };
}

/** Leest alle regels van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde, geen businessbetekenis. */
export function leesCorrectiefDagelijksOnderhoudRegels(db: DatabaseSync, versieId: string): readonly CorrectiefDagelijksOnderhoudRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, omschrijving, complexnummer, jaarbedrag
       FROM begroting_correctief_dagelijks_onderhoud_regel
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as RegelRow[];
  return rijen.map(rowToRegel);
}

/**
 * Schrijft de COMPLETE gewenste regellijst voor één begrotingsversie
 * (complete-list save — geen los toevoegen/wijzigen/verwijderen-API). Faalt
 * vóór elke mutatie als de parent niet bestaat, geen CONCEPT is, een
 * meegegeven bestaande `id` niet bestaat, bij een ANDERE begrotingsversie
 * hoort, of dubbel voorkomt in dezelfde aanroep (zie moduledoc). Retourneert
 * de resulterende regellijst (met, voor nieuwe regels, het vers toegekende
 * `id`) — een her-lezing ná de schrijfactie, geen losse boekhouding van
 * toegekende ids.
 */
export function schrijfCorrectiefDagelijksOnderhoudRegels(
  db: DatabaseSync,
  versieId: string,
  regels: readonly CorrectiefDagelijksOnderhoudRegelInvoer[],
): readonly CorrectiefDagelijksOnderhoudRegel[] {
  // Zuivere inputvalidatie — raakt de database niet, mag daarom vóór BEGIN (zie moduledoc).
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
      throw new Error(
        `Begrotingsversie ${versieId} heeft status ${versie.status} — Correctief/Dagelijks-Onderhoud-regels mogen uitsluitend op een CONCEPT-versie worden geschreven.`,
      );
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_correctief_dagelijks_onderhoud_regel WHERE id IN (${placeholders})`)
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
    const huidigeRijen = db
      .prepare(`SELECT id FROM begroting_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = ?`)
      .all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(
        versieId,
        ...teVerwijderen,
      );
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_correctief_dagelijks_onderhoud_regel
       SET omschrijving = ?, complexnummer = ?, jaarbedrag = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_correctief_dagelijks_onderhoud_regel
         (begroting_versie_id, omschrijving, complexnummer, jaarbedrag)
       VALUES (?, ?, ?, ?)`,
    );

    for (const regel of regels) {
      const jaarbedrag = regel.jaarbedrag !== null ? regel.jaarbedrag.toString() : null;

      if (regel.id === null) {
        insertStmt.run(versieId, regel.omschrijving, regel.complexnummer, jaarbedrag);
        continue;
      }

      // Versiegebonden update: de WHERE-clausule bewijst de versie-isolatie opnieuw, onafhankelijk van de
      // vooraf-ownership-check hierboven (zie moduledoc — twee beschermingslagen, zelfde patroon als GO-P1).
      const info = updateStmt.run(regel.omschrijving, regel.complexnummer, jaarbedrag, regel.id, versieId);
      if (Number(info.changes) !== 1) {
        throw new Error(
          `Begrotingsversie ${versieId}: regel-id ${regel.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`,
        );
      }
    }

    return leesCorrectiefDagelijksOnderhoudRegels(db, versieId);
  });
}
