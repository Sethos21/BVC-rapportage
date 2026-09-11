import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor Geplande-Verkoop-Begrotingsregels — OB-039, UITSLUITEND
 * concept-input. GEEN pure-calculator-integratie hier (`@bvc/reporting`'s
 * `berekenBegroteGeplandeVerkoop` wordt hier NERGENS aangeroepen, zie
 * `herberekenen.ts` daarvoor), GEEN frozen output (zie
 * `frozenGeplandeVerkoopResultaat.ts`). Zelfde complete-list-save-patroon als
 * `correctiefDagelijksOnderhoudRegels.ts`/`renteRegels.ts` — zie die
 * bestanden voor de volledige onderbouwing van de transactiegrens en de
 * versie-isolatie; hier uitsluitend de verschillen.
 *
 * ONBEKEND BLIJFT ONBEKEND (OB039-008, zie `begroteGeplandeVerkoop.ts`'s
 * moduledoc): `geplandeVerkoopdatum`/`verwachteVerkoopopbrengst`/
 * `verwachteBoekwaarde`/`verwachteVerkoopkosten`/
 * `verwachteEinddatumHuurExploitatie` zijn allemaal `null`-abel — `null`
 * round-tript hier ALTIJD als `null`, in geen van beide richtingen ooit
 * stilzwijgend een default (zoals `Decimal(0)` of "vandaag").
 *
 * DATUMOPSLAG: `TEXT NULL`, geschreven via `.toISOString()`, gelezen via
 * `new Date(rij.x)` — zelfde conventie als `begrotingsversies.ts`
 * (`createdAt`/`vastgeseldAt`).
 *
 * `objectreferentie` is een vrij tekstveld (GEEN gevalideerde/gejoinde
 * complexnummer-koppeling, zie `begroteGeplandeVerkoop.ts`'s moduledoc).
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
export interface GeplandeVerkoopRegelInvoer {
  id: number | null;
  objectreferentie: string;
  omschrijving: string;
  geplandeVerkoopdatum: Date | null;
  verwachteVerkoopopbrengst: Decimal | null;
  verwachteBoekwaarde: Decimal | null;
  verwachteVerkoopkosten: Decimal | null;
  verwachteEinddatumHuurExploitatie: Date | null;
  toelichting: string | null;
}

export interface GeplandeVerkoopRegel {
  id: number;
  objectreferentie: string;
  omschrijving: string;
  geplandeVerkoopdatum: Date | null;
  verwachteVerkoopopbrengst: Decimal | null;
  verwachteBoekwaarde: Decimal | null;
  verwachteVerkoopkosten: Decimal | null;
  verwachteEinddatumHuurExploitatie: Date | null;
  toelichting: string | null;
}

interface RegelRow {
  id: number;
  objectreferentie: string;
  omschrijving: string;
  geplande_verkoopdatum: string | null;
  verwachte_verkoopopbrengst: string | null;
  verwachte_boekwaarde: string | null;
  verwachte_verkoopkosten: string | null;
  verwachte_einddatum_huur_exploitatie: string | null;
  toelichting: string | null;
}

function rowToRegel(row: RegelRow): GeplandeVerkoopRegel {
  return {
    id: row.id,
    objectreferentie: row.objectreferentie,
    omschrijving: row.omschrijving,
    geplandeVerkoopdatum: row.geplande_verkoopdatum !== null ? new Date(row.geplande_verkoopdatum) : null,
    verwachteVerkoopopbrengst: row.verwachte_verkoopopbrengst !== null ? new Decimal(row.verwachte_verkoopopbrengst) : null,
    verwachteBoekwaarde: row.verwachte_boekwaarde !== null ? new Decimal(row.verwachte_boekwaarde) : null,
    verwachteVerkoopkosten: row.verwachte_verkoopkosten !== null ? new Decimal(row.verwachte_verkoopkosten) : null,
    verwachteEinddatumHuurExploitatie: row.verwachte_einddatum_huur_exploitatie !== null ? new Date(row.verwachte_einddatum_huur_exploitatie) : null,
    toelichting: row.toelichting,
  };
}

/** Leest alle regels van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde, geen businessbetekenis. */
export function leesGeplandeVerkoopRegels(db: DatabaseSync, versieId: string): readonly GeplandeVerkoopRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, objectreferentie, omschrijving, geplande_verkoopdatum, verwachte_verkoopopbrengst, verwachte_boekwaarde, verwachte_verkoopkosten, verwachte_einddatum_huur_exploitatie, toelichting
       FROM begroting_geplande_verkoop_regel
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
 * hoort, of dubbel voorkomt in dezelfde aanroep.
 */
export function schrijfGeplandeVerkoopRegels(db: DatabaseSync, versieId: string, regels: readonly GeplandeVerkoopRegelInvoer[]): readonly GeplandeVerkoopRegel[] {
  const bestaandeIds = regels.map((r) => r.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(`Begrotingsversie ${versieId}: dezelfde bestaande regel-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd, geen "laatste wint".`);
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status !== "CONCEPT") {
      throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — Geplande-Verkoop-regels mogen uitsluitend op een CONCEPT-versie worden geschreven.`);
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db.prepare(`SELECT id, begroting_versie_id FROM begroting_geplande_verkoop_regel WHERE id IN (${placeholders})`).all(...bestaandeIds) as unknown as {
        id: number;
        begroting_versie_id: string;
      }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: regel-id ${id} bestaat niet — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(`Begrotingsversie ${versieId}: regel-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db.prepare(`SELECT id FROM begroting_geplande_verkoop_regel WHERE begroting_versie_id = ?`).all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_geplande_verkoop_regel WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(versieId, ...teVerwijderen);
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_geplande_verkoop_regel
       SET objectreferentie = ?, omschrijving = ?, geplande_verkoopdatum = ?, verwachte_verkoopopbrengst = ?, verwachte_boekwaarde = ?, verwachte_verkoopkosten = ?, verwachte_einddatum_huur_exploitatie = ?, toelichting = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_geplande_verkoop_regel
         (begroting_versie_id, objectreferentie, omschrijving, geplande_verkoopdatum, verwachte_verkoopopbrengst, verwachte_boekwaarde, verwachte_verkoopkosten, verwachte_einddatum_huur_exploitatie, toelichting)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const regel of regels) {
      const geplandeVerkoopdatum = regel.geplandeVerkoopdatum !== null ? regel.geplandeVerkoopdatum.toISOString() : null;
      const verwachteVerkoopopbrengst = regel.verwachteVerkoopopbrengst !== null ? regel.verwachteVerkoopopbrengst.toString() : null;
      const verwachteBoekwaarde = regel.verwachteBoekwaarde !== null ? regel.verwachteBoekwaarde.toString() : null;
      const verwachteVerkoopkosten = regel.verwachteVerkoopkosten !== null ? regel.verwachteVerkoopkosten.toString() : null;
      const verwachteEinddatumHuurExploitatie = regel.verwachteEinddatumHuurExploitatie !== null ? regel.verwachteEinddatumHuurExploitatie.toISOString() : null;

      if (regel.id === null) {
        insertStmt.run(
          versieId,
          regel.objectreferentie,
          regel.omschrijving,
          geplandeVerkoopdatum,
          verwachteVerkoopopbrengst,
          verwachteBoekwaarde,
          verwachteVerkoopkosten,
          verwachteEinddatumHuurExploitatie,
          regel.toelichting,
        );
        continue;
      }

      const info = updateStmt.run(
        regel.objectreferentie,
        regel.omschrijving,
        geplandeVerkoopdatum,
        verwachteVerkoopopbrengst,
        verwachteBoekwaarde,
        verwachteVerkoopkosten,
        verwachteEinddatumHuurExploitatie,
        regel.toelichting,
        regel.id,
        versieId,
      );
      if (Number(info.changes) !== 1) {
        throw new Error(`Begrotingsversie ${versieId}: regel-id ${regel.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`);
      }
    }

    return leesGeplandeVerkoopRegels(db, versieId);
  });
}
