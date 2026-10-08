import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgRenteCategorie } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de Rente-begrotingsregels (OB-037/038) — UITSLUITEND
 * concept-input. GEEN pure-calculator-integratie, GEEN concept-
 * herberekening, GEEN frozen output — die volgen in `herberekenen.ts`/
 * `frozenRenteResultaat.ts`.
 *
 * Exact hetzelfde complete-list-save-patroon als `leegstandRegels.ts` — hier
 * uitsluitend de Rente-specifieke verschillen: GEEN Q1-Q4 (één jaarlijks
 * `begrotingsbedrag`, zoals bij Algemene Kosten), WEL `ogbReferentie`
 * (puur informatief tekstveld, GEEN OGB-classificatie/join — zie
 * `begroteRente.ts`'s moduledoc) en de PER-REGEL rekenhulpvelden
 * `laatstBekendSaldo`/`rentepercentage`. `omschrijving` blijft bewust NOT
 * NULL (lege string = "nog niet ingevuld"). `complexnummer`/`ogbReferentie`/
 * `laatstBekendSaldo`/`rentepercentage`/`begrotingsbedrag` blijven NULLABLE.
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
export interface RenteRegelInvoer {
  id: number | null;
  categorie: BgRenteCategorie;
  omschrijving: string;
  complexnummer: string | null;
  ogbReferentie: string | null;
  laatstBekendSaldo: Decimal | null;
  rentepercentage: Decimal | null;
  begrotingsbedrag: Decimal | null;
}

export interface RenteRegel {
  id: number;
  categorie: BgRenteCategorie;
  omschrijving: string;
  complexnummer: string | null;
  ogbReferentie: string | null;
  laatstBekendSaldo: Decimal | null;
  rentepercentage: Decimal | null;
  begrotingsbedrag: Decimal | null;
}

interface RenteRegelRow {
  id: number;
  categorie: BgRenteCategorie;
  omschrijving: string;
  complexnummer: string | null;
  ogb_referentie: string | null;
  laatst_bekend_saldo: string | null;
  rentepercentage: string | null;
  begrotingsbedrag: string | null;
}

function rowToRenteRegel(row: RenteRegelRow): RenteRegel {
  return {
    id: row.id,
    categorie: row.categorie,
    omschrijving: row.omschrijving,
    complexnummer: row.complexnummer,
    ogbReferentie: row.ogb_referentie,
    laatstBekendSaldo: row.laatst_bekend_saldo !== null ? new Decimal(row.laatst_bekend_saldo) : null,
    rentepercentage: row.rentepercentage !== null ? new Decimal(row.rentepercentage) : null,
    begrotingsbedrag: row.begrotingsbedrag !== null ? new Decimal(row.begrotingsbedrag) : null,
  };
}

/** Leest alle Rente-regels van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde, geen businessbetekenis. */
export function leesRenteRegels(db: DatabaseSync, versieId: string): readonly RenteRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, categorie, omschrijving, complexnummer, ogb_referentie, laatst_bekend_saldo, rentepercentage, begrotingsbedrag
       FROM begroting_rente_regel
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as RenteRegelRow[];
  return rijen.map(rowToRenteRegel);
}

/**
 * Schrijft de COMPLETE gewenste Rente-regellijst voor één begrotingsversie
 * (complete-list save). Faalt vóór elke mutatie als de parent niet bestaat,
 * geen CONCEPT is, een meegegeven bestaande `id` niet bestaat, bij een
 * ANDERE begrotingsversie hoort, of dubbel voorkomt in dezelfde aanroep.
 */
export function schrijfRenteRegels(db: DatabaseSync, versieId: string, regels: readonly RenteRegelInvoer[]): readonly RenteRegel[] {
  const bestaandeIds = regels.map((r) => r.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(`Begrotingsversie ${versieId}: dezelfde bestaande Rente-regel-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd, geen "laatste wint".`);
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status !== "CONCEPT") {
      throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — Rente-regels mogen uitsluitend op een CONCEPT-versie worden geschreven.`);
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db.prepare(`SELECT id, begroting_versie_id FROM begroting_rente_regel WHERE id IN (${placeholders})`).all(...bestaandeIds) as unknown as {
        id: number;
        begroting_versie_id: string;
      }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: Rente-regel-id ${id} bestaat niet — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(`Begrotingsversie ${versieId}: Rente-regel-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db.prepare(`SELECT id FROM begroting_rente_regel WHERE begroting_versie_id = ?`).all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_rente_regel WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(versieId, ...teVerwijderen);
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_rente_regel
       SET categorie = ?, omschrijving = ?, complexnummer = ?, ogb_referentie = ?, laatst_bekend_saldo = ?, rentepercentage = ?, begrotingsbedrag = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_rente_regel
         (begroting_versie_id, categorie, omschrijving, complexnummer, ogb_referentie, laatst_bekend_saldo, rentepercentage, begrotingsbedrag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const regel of regels) {
      const laatstBekendSaldo = regel.laatstBekendSaldo !== null ? regel.laatstBekendSaldo.toString() : null;
      const rentepercentage = regel.rentepercentage !== null ? regel.rentepercentage.toString() : null;
      const begrotingsbedrag = regel.begrotingsbedrag !== null ? regel.begrotingsbedrag.toString() : null;

      if (regel.id === null) {
        insertStmt.run(versieId, regel.categorie, regel.omschrijving, regel.complexnummer, regel.ogbReferentie, laatstBekendSaldo, rentepercentage, begrotingsbedrag);
        continue;
      }

      // Versiegebonden update: de WHERE-clausule bewijst de versie-isolatie opnieuw, onafhankelijk van de
      // vooraf-ownership-check hierboven (zelfde patroon als eerdere modules).
      const info = updateStmt.run(regel.categorie, regel.omschrijving, regel.complexnummer, regel.ogbReferentie, laatstBekendSaldo, rentepercentage, begrotingsbedrag, regel.id, versieId);
      if (Number(info.changes) !== 1) {
        throw new Error(`Begrotingsversie ${versieId}: Rente-regel-id ${regel.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`);
      }
    }

    return leesRenteRegels(db, versieId);
  });
}
