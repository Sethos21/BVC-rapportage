import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de Gemeentelijke-lastenregels per GL — Vervolgtranche 4 (Master Contract §6.8, besluit
 * 2026-09-25): de gebruiker begroot RECHTSTREEKS per relevante grootboekpost; de regels tellen op tot de
 * ene P&L-post "Gemeentelijke lasten pand" (zie `begroteGemeentelijkeLastenGrootboekRegels.ts` in
 * `@bvc/reporting`, waar de som en alle validatie staan). UITSLUITEND concept-input: deze laag rekent niets
 * en valideert geen inhoud (een functioneel onvolledig CONCEPT moet opslaanbaar blijven).
 *
 * Exact hetzelfde complete-list-save-patroon als `correctiefDagelijksOnderhoudRegels.ts` (zie dat bestand
 * voor de onderbouwing van transactiegrens en versie-isolatie): `id: null` = nieuwe regel, `id: number` =
 * bestaande regel die aantoonbaar bij DEZE versie hoort; regels die niet meer voorkomen worden verwijderd;
 * dubbele ids in één save worden geweigerd. Het regel-`id` is de stabiele sleutel waarmee bevroren regels
 * en latere Estimated-koppelingen aan een regel hangen — nooit arraypositie of omschrijving.
 *
 * GEEN complexnummer, omschrijving of periodiciteit: de regel is GL (leidend) + optionele OGB (alleen
 * verfijning binnen dezelfde GL) + één jaarbedrag. `jaarbedrag: null` = nog niet ingevuld en wordt NOOIT
 * stilzwijgend `Decimal(0)` (bewust €0), in geen van beide richtingen.
 *
 * DE BEGROTINGSREGELS ZIJN BEWUST NIET AAN HET WOZ-VOORSTEL GEKOPPELD: er is geen functie die een regel uit
 * het WOZ-gebaseerde totaal afleidt of een totaal over GL's verdeelt.
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
export interface GemeentelijkeLastenRegelInvoer {
  id: number | null;
  grootboekrekening: string;
  ogbKostensoort: string | null;
  jaarbedrag: Decimal | null;
}

export interface GemeentelijkeLastenRegel {
  id: number;
  grootboekrekening: string;
  ogbKostensoort: string | null;
  jaarbedrag: Decimal | null;
}

interface RegelRow {
  id: number;
  grootboekrekening: string;
  ogb_kostensoort: string | null;
  jaarbedrag: string | null;
}

function rowToRegel(row: RegelRow): GemeentelijkeLastenRegel {
  return {
    id: row.id,
    grootboekrekening: row.grootboekrekening,
    ogbKostensoort: row.ogb_kostensoort,
    jaarbedrag: row.jaarbedrag !== null ? new Decimal(row.jaarbedrag) : null,
  };
}

/** Leest alle regels van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde, geen businessbetekenis. */
export function leesGemeentelijkeLastenRegels(db: DatabaseSync, versieId: string): readonly GemeentelijkeLastenRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, grootboekrekening, ogb_kostensoort, jaarbedrag
       FROM begroting_gemeentelijke_lasten_regel
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as RegelRow[];
  return rijen.map(rowToRegel);
}

/**
 * Schrijft de COMPLETE gewenste regellijst voor één begrotingsversie (complete-list save). Faalt vóór elke
 * mutatie als de parent niet bestaat, geen CONCEPT is, een meegegeven bestaande `id` niet bestaat, bij een
 * ANDERE begrotingsversie hoort, of dubbel voorkomt in dezelfde aanroep. Retourneert de resulterende
 * regellijst (met, voor nieuwe regels, het vers toegekende `id`) — een her-lezing ná de schrijfactie.
 */
export function schrijfGemeentelijkeLastenRegels(
  db: DatabaseSync,
  versieId: string,
  regels: readonly GemeentelijkeLastenRegelInvoer[],
): readonly GemeentelijkeLastenRegel[] {
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
      throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — Gemeentelijke-lastenregels mogen uitsluitend op een CONCEPT-versie worden geschreven.`);
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_gemeentelijke_lasten_regel WHERE id IN (${placeholders})`)
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
    const huidigeRijen = db.prepare(`SELECT id FROM begroting_gemeentelijke_lasten_regel WHERE begroting_versie_id = ?`).all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_gemeentelijke_lasten_regel WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(versieId, ...teVerwijderen);
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_gemeentelijke_lasten_regel
       SET grootboekrekening = ?, ogb_kostensoort = ?, jaarbedrag = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_gemeentelijke_lasten_regel (begroting_versie_id, grootboekrekening, ogb_kostensoort, jaarbedrag)
       VALUES (?, ?, ?, ?)`,
    );

    for (const regel of regels) {
      const jaarbedrag = regel.jaarbedrag !== null ? regel.jaarbedrag.toString() : null;

      if (regel.id === null) {
        insertStmt.run(versieId, regel.grootboekrekening, regel.ogbKostensoort, jaarbedrag);
        continue;
      }

      // Versiegebonden update: de WHERE-clausule bewijst de versie-isolatie opnieuw, onafhankelijk van de vooraf-ownership-check hierboven.
      const info = updateStmt.run(regel.grootboekrekening, regel.ogbKostensoort, jaarbedrag, regel.id, versieId);
      if (Number(info.changes) !== 1) {
        throw new Error(
          `Begrotingsversie ${versieId}: regel-id ${regel.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`,
        );
      }
    }

    return leesGemeentelijkeLastenRegels(db, versieId);
  });
}
